use crate::api::{compatibility, http_client, server_error, ApiResponse, ServerClient, ServerInfo};
use crate::credentials::{account, CredentialStore};
use crate::error::{NativeError, Result};
use crate::local::{is_workspace_id, LocalConnection, LocalRuntime};
use crate::profiles::{normalize_server, validate_name, LocalMeta, Profile, ProfileStore, SessionMeta};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Where native events go: the Tauri window in the app, a collector in tests.
pub trait EventSink: Send + Sync + 'static {
    fn emit(&self, event: &str, payload: Value);
}

/// Opens URLs with the operating system (disabled in tests).
pub type Opener = Arc<dyn Fn(&str) -> bool + Send + Sync>;

pub const AUTH_EVENT: &str = "alice://auth";
pub const PROFILE_EVENT: &str = "alice://profile";
pub const DEEPLINK_EVENT: &str = "alice://deeplink";
pub const CAPTURE_EVENT: &str = "alice://capture";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    #[serde(flatten)]
    pub profile: Profile,
    pub active: bool,
    pub signed_in: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfilesView {
    pub active: Option<String>,
    pub profiles: Vec<ProfileView>,
    /// Whether this installation can create and open Local workspaces.
    pub local_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub profile: String,
    pub server: String,
    pub tls: &'static str,
    pub server_name: String,
    pub server_version: String,
    pub client_api: crate::api::ClientApiRange,
    pub compatible: bool,
    pub upgrade: Option<&'static str>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStarted {
    pub profile: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

pub struct Core {
    pub config_dir: PathBuf,
    profiles: Mutex<ProfileStore>,
    store: Box<dyn CredentialStore>,
    http: reqwest::Client,
    /// Access credentials per profile, in memory only. The async lock also serializes refresh.
    access: tokio::sync::Mutex<HashMap<String, String>>,
    login: Mutex<Option<(String, tokio::task::AbortHandle)>>,
    stream: Mutex<Option<(String, tokio::task::AbortHandle)>>,
    /// A validated deep link waiting until its profile is signed in and compatible.
    pending_link: Mutex<Option<crate::deeplink::DeepLink>>,
    /// The latest capture shortcut press, kept until the UI is signed in and takes it (once).
    pending_capture: Mutex<Option<(u64, crate::shortcuts::CaptureIntent)>>,
    capture_seq: std::sync::atomic::AtomicU64,
    pub sink: Arc<dyn EventSink>,
    pub opener: Opener,
    device_name: String,
    /// Local workspaces; None when no Alice runtime is installed.
    pub local: Option<LocalRuntime>,
    /// Live daemon connections per Local workspace id (address + capability, memory only).
    local_conns: tokio::sync::Mutex<HashMap<String, LocalConnection>>,
    /// Keeps the active Local daemon alive while Desktop shows it.
    presence: Mutex<Option<(String, tokio::task::AbortHandle)>>,
}

const IDEMPOTENCY_HEADER: &str = "idempotency-key";

impl Core {
    pub fn new(config_dir: PathBuf, store: Box<dyn CredentialStore>, sink: Arc<dyn EventSink>, opener: Opener) -> Result<Self> {
        let profiles = ProfileStore::load(&config_dir)?;
        let local = LocalRuntime::detect(&config_dir);
        let device_name = gethostname::gethostname().to_string_lossy().chars().take(120).collect::<String>();
        Ok(Self {
            config_dir,
            profiles: Mutex::new(profiles),
            store,
            http: http_client(),
            access: tokio::sync::Mutex::new(HashMap::new()),
            login: Mutex::new(None),
            stream: Mutex::new(None),
            pending_link: Mutex::new(None),
            pending_capture: Mutex::new(None),
            capture_seq: std::sync::atomic::AtomicU64::new(0),
            sink,
            opener,
            device_name: if device_name.is_empty() { "unknown device".into() } else { device_name },
            local,
            local_conns: tokio::sync::Mutex::new(HashMap::new()),
            presence: Mutex::new(None),
        })
    }

    /// Replaces the running event stream (aborting the previous one).
    pub(crate) fn replace_stream(&self, next: Option<(String, tokio::task::AbortHandle)>) {
        let old = std::mem::replace(&mut *self.stream.lock().unwrap(), next);
        if let Some((_, handle)) = old {
            handle.abort();
        }
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.http
    }

    pub fn credential_store_name(&self) -> &'static str {
        self.store.name()
    }

    fn profile(&self, name: &str) -> Result<Profile> {
        if is_workspace_id(name) {
            return self.local_profile(name);
        }
        self.profiles.lock().unwrap().get(name).cloned().ok_or_else(|| NativeError::new("NO_PROFILE", format!("No profile named \"{name}\"")))
    }

    /// A Local workspace presented as a profile: its name is the immutable id and it has no server URL.
    fn local_profile(&self, id: &str) -> Result<Profile> {
        let runtime = self.local.as_ref().ok_or_else(|| NativeError::new("RUNTIME_UNAVAILABLE", "Local workspaces need the Alice runtime; reinstall Alice Desktop"))?;
        let ws = runtime.workspace(id)?;
        Ok(Profile {
            name: ws.id,
            server: String::new(),
            insecure: false,
            created_at: ws.created_at,
            session: None,
            local: Some(LocalMeta { alias: ws.alias, display_name: ws.name, state: ws.state }),
        })
    }

    pub fn active_profile(&self) -> Result<Profile> {
        let active = self.profiles.lock().unwrap().data.active.clone();
        match active {
            Some(id) if is_workspace_id(&id) => self.local_profile(&id),
            _ => self.profiles.lock().unwrap().active().cloned().ok_or_else(|| NativeError::new("NO_PROFILE", "No workspace is selected")),
        }
    }

    fn has_credential(&self, p: &Profile) -> bool {
        p.local.is_some() || matches!(self.store.get(&account(&p.name, &p.server)), Ok(Some(_)))
    }

    fn require_remote(p: &Profile) -> Result<()> {
        if p.local.is_some() {
            return Err(NativeError::new("LOCAL_WORKSPACE", "Local workspaces need no sign-in"));
        }
        Ok(())
    }

    /// Address and bearer credential for requests to `p`: the daemon and its capability for a Local
    /// workspace (starting or re-validating it when `reconnect`), the server and access token otherwise.
    pub async fn endpoint(&self, p: &Profile, reconnect: bool) -> Result<(String, String)> {
        if p.local.is_none() {
            let token = self.access_token(p, reconnect).await?;
            return Ok((p.server.clone(), token));
        }
        let mut conns = self.local_conns.lock().await;
        if !reconnect {
            if let Some(c) = conns.get(&p.name) {
                return Ok((c.base_url.clone(), c.capability.clone()));
            }
        }
        let runtime = self.local.as_ref().ok_or_else(|| NativeError::new("RUNTIME_UNAVAILABLE", "The Alice runtime is not installed"))?;
        let root_id = p.name.clone();
        let runtime = runtime.clone();
        // runtime ทำงานแบบ blocking (spawn + รอ health) — ย้ายออกจาก async worker
        let conn = tokio::task::spawn_blocking(move || runtime.connect(&root_id))
            .await
            .map_err(|_| NativeError::new("RUNTIME_FAILED", "The Alice runtime stopped unexpectedly"))??;
        if conn.version != env!("CARGO_PKG_VERSION") {
            return Err(NativeError::new("RUNTIME_MISMATCH", format!("This workspace runs Alice {} but Desktop is {}; repair or update Alice", conn.version, env!("CARGO_PKG_VERSION"))));
        }
        conns.insert(p.name.clone(), conn.clone());
        Ok((conn.base_url, conn.capability))
    }

    /// Renews the active Local workspace's presence lease every minute so its daemon never idles out.
    fn start_presence(self: &Arc<Self>, id: &str) {
        let me = Arc::clone(self);
        let ws = id.to_string();
        let handle = tauri::async_runtime::spawn(async move {
            loop {
                if let Ok(p) = me.local_profile(&ws) {
                    if let Ok((origin, token)) = me.endpoint(&p, false).await {
                        let _ = ServerClient { http: &me.http, origin: &origin }.local_call("POST", "/presence", Some(&json!({ "seconds": 150 })), &token).await;
                    }
                }
                tokio::time::sleep(Duration::from_secs(60)).await;
            }
        });
        if let Some((_, old)) = self.presence.lock().unwrap().replace((id.to_string(), handle.inner().abort_handle())) {
            old.abort();
        }
    }

    fn stop_presence(&self) {
        if let Some((_, old)) = self.presence.lock().unwrap().take() {
            old.abort();
        }
    }

    // ---------- profiles ----------

    pub fn profiles_list(&self) -> ProfilesView {
        let store = self.profiles.lock().unwrap();
        let active = store.data.active.clone();
        let profiles = store
            .data
            .profiles
            .iter()
            .map(|p| ProfileView { profile: p.clone(), active: Some(&p.name) == active.as_ref(), signed_in: self.has_credential(p) })
            .collect::<Vec<_>>();
        drop(store);
        // Local workspaces มาก่อน (อ่านจาก registry ทุกครั้ง จึงเห็นที่ CLI สร้างด้วย)
        let mut all: Vec<ProfileView> = self
            .local
            .as_ref()
            .and_then(|r| r.workspaces().ok())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|w| self.local_profile(&w.id).ok())
            .map(|p| ProfileView { active: Some(&p.name) == active.as_ref(), signed_in: true, profile: p })
            .collect();
        all.extend(profiles);
        ProfilesView { active, profiles: all, local_available: self.local.is_some() }
    }

    pub fn profile_add(&self, name: &str, server: &str, insecure_dev: bool, make_active: bool) -> Result<ProfilesView> {
        validate_name(name)?;
        if is_workspace_id(name) {
            return Err(NativeError::invalid("Profile names must not look like a workspace id"));
        }
        let (origin, insecure) = normalize_server(server, insecure_dev)?;
        {
            let mut store = self.profiles.lock().unwrap();
            if store.get(name).is_some() {
                return Err(NativeError::invalid(format!("A profile named \"{name}\" already exists")));
            }
            store.data.profiles.push(Profile { name: name.into(), server: origin, insecure, created_at: now_iso(), session: None, local: None });
            if make_active || store.data.active.is_none() {
                store.data.active = Some(name.into());
            }
            store.save()?;
        }
        self.emit_profile();
        Ok(self.profiles_list())
    }

    /// Switching is deliberate: the WebView must drop every cached view of the previous profile.
    pub fn profile_use(&self, name: &str) -> Result<ProfilesView> {
        self.profile(name)?;
        self.replace_stream(None);
        self.stop_presence();
        // capture ที่ค้างไว้เป็นของ workspace เดิม: ห้ามไปสร้างงานใน workspace ใหม่
        *self.pending_capture.lock().unwrap() = None;
        {
            let mut store = self.profiles.lock().unwrap();
            store.data.active = Some(name.into());
            store.save()?;
        }
        self.emit_profile();
        Ok(self.profiles_list())
    }

    pub async fn profile_remove(&self, name: &str) -> Result<ProfilesView> {
        let profile = self.profile(name)?;
        if profile.local.is_some() {
            return Err(NativeError::new("LOCAL_WORKSPACE", "Delete Local workspaces from Settings → Workspaces; it needs a typed confirmation"));
        }
        if self.stream.lock().unwrap().as_ref().is_some_and(|(p, _)| p == name) {
            self.replace_stream(None);
        }
        self.sign_out(&profile).await;
        {
            let mut store = self.profiles.lock().unwrap();
            store.data.profiles.retain(|p| p.name != name);
            if store.data.active.as_deref() == Some(name) {
                store.data.active = None;
            }
            store.save()?;
        }
        self.emit_profile();
        Ok(self.profiles_list())
    }

    pub async fn profile_test(self: &Arc<Self>, name: &str) -> Result<ConnectionTest> {
        let p = self.profile(name)?;
        if let Some(meta) = &p.local {
            // Local: สตาร์ทหรือใช้ daemon เดิม แล้วตรวจ version ให้ตรงกันพอดี — ไม่มีหน้า sign-in
            self.endpoint(&p, true).await?;
            if self.active_profile().map(|a| a.name == p.name).unwrap_or(false) {
                self.start_presence(&p.name);
            }
            return Ok(ConnectionTest {
                profile: p.name.clone(),
                server: String::new(),
                tls: "local",
                server_name: meta.display_name.clone(),
                server_version: env!("CARGO_PKG_VERSION").into(),
                client_api: crate::api::ClientApiRange { current: crate::api::CLIENT_API_VERSION, minimum: crate::api::CLIENT_API_VERSION },
                compatible: true,
                upgrade: None,
                message: "Local workspace".into(),
            });
        }
        let info = ServerClient { http: &self.http, origin: &p.server }.info().await?;
        let c = compatibility(&info);
        Ok(ConnectionTest {
            profile: p.name.clone(),
            server: p.server.clone(),
            tls: if p.insecure { "none" } else { "verified" },
            server_name: info.name,
            server_version: info.server_version,
            client_api: info.client_api,
            compatible: c.compatible,
            upgrade: c.upgrade,
            message: c.message,
        })
    }

    fn emit_profile(&self) {
        let active = self.profiles.lock().unwrap().data.active.clone();
        self.sink.emit(PROFILE_EVENT, json!({ "active": active }));
    }

    // ---------- sign-in ----------

    pub async fn server_info(&self, p: &Profile) -> Result<ServerInfo> {
        ServerClient { http: &self.http, origin: &p.server }.info().await
    }

    /// Starts device authorization; polling continues in the background and reports through AUTH_EVENT.
    pub async fn login_start(self: &Arc<Self>, name: &str) -> Result<LoginStarted> {
        let p = self.profile(name)?;
        Self::require_remote(&p)?;
        let client = ServerClient { http: &self.http, origin: &p.server };
        let info = client.info().await?;
        let c = compatibility(&info);
        if !c.compatible {
            return Err(NativeError::new("CLIENT_INCOMPATIBLE", c.message).with_details(json!({ "upgrade": c.upgrade })));
        }
        let start = client
            .call(
                "POST",
                "/device/authorize",
                Some(&json!({ "clientKind": "desktop", "clientName": "Alice Desktop", "deviceName": self.device_name, "clientVersion": env!("CARGO_PKG_VERSION") })),
                None,
            )
            .await?;
        let device_code = start["deviceCode"].as_str().unwrap_or_default().to_string();
        let started = LoginStarted {
            profile: p.name.clone(),
            user_code: start["userCode"].as_str().unwrap_or_default().to_string(),
            verification_uri: start["verificationUriComplete"].as_str().unwrap_or_default().to_string(),
            expires_in: start["expiresIn"].as_u64().unwrap_or(600),
        };
        let interval = start["interval"].as_u64().unwrap_or(5);
        if !started.verification_uri.starts_with(&p.server) {
            return Err(NativeError::new("PROTOCOL_ERROR", "The server returned an unexpected sign-in address"));
        }
        (self.opener)(&started.verification_uri);

        let me = Arc::clone(self);
        let profile = p.clone();
        let expires = started.expires_in;
        let handle = tauri::async_runtime::spawn(async move {
            let outcome = me.poll_device(&profile, &device_code, interval, expires).await;
            let payload = match outcome {
                Ok(actor) => json!({ "profile": profile.name, "status": "signed_in", "actor": actor }),
                Err(e) => json!({ "profile": profile.name, "status": match e.code.as_str() {
                    "DEVICE_ACCESS_DENIED" => "denied",
                    "DEVICE_CODE_EXPIRED" => "expired",
                    _ => "failed",
                }, "message": e.message }),
            };
            me.sink.emit(AUTH_EVENT, payload);
        });
        if let Some((_, old)) = self.login.lock().unwrap().replace((p.name.clone(), handle.inner().abort_handle())) {
            old.abort();
        }
        self.sink.emit(AUTH_EVENT, json!({ "profile": p.name, "status": "pending", "userCode": started.user_code }));
        Ok(started)
    }

    pub fn login_cancel(&self) {
        if let Some((profile, handle)) = self.login.lock().unwrap().take() {
            handle.abort();
            self.sink.emit(AUTH_EVENT, json!({ "profile": profile, "status": "cancelled" }));
        }
    }

    async fn poll_device(&self, p: &Profile, device_code: &str, mut interval: u64, expires_in: u64) -> Result<Value> {
        let client = ServerClient { http: &self.http, origin: &p.server };
        let deadline = Instant::now() + Duration::from_secs(expires_in);
        loop {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            if Instant::now() > deadline {
                return Err(NativeError::new("DEVICE_CODE_EXPIRED", "The sign-in code expired before it was approved"));
            }
            match client.call("POST", "/device/token", Some(&json!({ "deviceCode": device_code })), None).await {
                Ok(creds) => return self.store_credentials(p, &creds).await,
                Err(e) if e.code == "DEVICE_AUTHORIZATION_PENDING" || e.code == "NETWORK_ERROR" || e.code == "RATE_LIMITED" => continue,
                Err(e) if e.code == "DEVICE_SLOW_DOWN" => {
                    interval = e.details.as_ref().and_then(|d| d["interval"].as_u64()).unwrap_or(interval + 5);
                }
                Err(e) => return Err(e),
            }
        }
    }

    async fn store_credentials(&self, p: &Profile, creds: &Value) -> Result<Value> {
        let refresh = creds["refreshToken"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "Missing credentials"))?;
        let access = creds["accessToken"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "Missing credentials"))?;
        self.store.set(&account(&p.name, &p.server), refresh)?;
        self.access.lock().await.insert(p.name.clone(), access.to_string());
        let actor = creds["actor"].clone();
        {
            let mut store = self.profiles.lock().unwrap();
            if let Some(profile) = store.get_mut(&p.name) {
                profile.session = Some(SessionMeta {
                    id: creds["session"]["id"].as_str().unwrap_or_default().into(),
                    actor_id: actor["id"].as_str().unwrap_or_default().into(),
                    actor_name: actor["displayName"].as_str().unwrap_or_default().into(),
                });
            }
            store.save()?;
        }
        // ส่งกลับเฉพาะข้อมูล actor — ไม่มี credential
        Ok(json!({ "id": actor["id"], "displayName": actor["displayName"], "kind": actor["kind"], "isOwner": actor["isOwner"] }))
    }

    /// Revokes the server session using the refresh credential (best effort) and forgets it locally.
    async fn sign_out(&self, p: &Profile) -> bool {
        let acct = account(&p.name, &p.server);
        let mut revoked = false;
        if let Ok(Some(refresh)) = self.store.get(&acct) {
            revoked = ServerClient { http: &self.http, origin: &p.server }
                .call("POST", "/auth/revoke", Some(&json!({ "refreshToken": refresh })), None)
                .await
                .is_ok();
        }
        self.forget(p).await;
        revoked
    }

    async fn forget(&self, p: &Profile) {
        let _ = self.store.delete(&account(&p.name, &p.server));
        self.access.lock().await.remove(&p.name);
        let mut store = self.profiles.lock().unwrap();
        if let Some(profile) = store.get_mut(&p.name) {
            profile.session = None;
        }
        let _ = store.save();
    }

    pub async fn logout(&self, name: &str) -> Result<bool> {
        let p = self.profile(name)?;
        Self::require_remote(&p)?;
        self.replace_stream(None);
        let revoked = self.sign_out(&p).await;
        self.sink.emit(AUTH_EVENT, json!({ "profile": p.name, "status": "signed_out", "reason": "logout" }));
        Ok(revoked)
    }

    /// Returns a valid access credential, rotating the refresh credential when needed.
    pub async fn access_token(&self, p: &Profile, force_refresh: bool) -> Result<String> {
        let mut cache = self.access.lock().await;
        if !force_refresh {
            if let Some(token) = cache.get(&p.name) {
                return Ok(token.clone());
            }
        }
        let acct = account(&p.name, &p.server);
        let refresh = self.store.get(&acct)?.ok_or_else(|| NativeError::new("NOT_SIGNED_IN", format!("Sign in to {}", p.name)))?;
        let res = ServerClient { http: &self.http, origin: &p.server }.call("POST", "/auth/refresh", Some(&json!({ "refreshToken": refresh })), None).await;
        match res {
            Ok(creds) => {
                let new_refresh = creds["refreshToken"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "Missing credentials"))?;
                let access = creds["accessToken"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "Missing credentials"))?.to_string();
                self.store.set(&acct, new_refresh)?;
                cache.insert(p.name.clone(), access.clone());
                Ok(access)
            }
            Err(e) if e.code == "UNAUTHENTICATED" => {
                cache.remove(&p.name);
                drop(cache);
                self.forget(p).await;
                self.sink.emit(AUTH_EVENT, json!({ "profile": p.name, "status": "signed_out", "reason": "revoked" }));
                Err(NativeError::new("NOT_SIGNED_IN", "The session expired or was revoked; sign in again"))
            }
            Err(e) => Err(e),
        }
    }

    // ---------- deep links ----------

    /// Validates an incoming `alice://` link. Malformed links and unknown profiles never navigate and
    /// never fall back to the active profile; a known profile becomes active before the UI navigates.
    pub fn handle_deep_link(&self, raw: &str) -> &'static str {
        let link = match crate::deeplink::parse(raw) {
            Ok(link) => link,
            Err(reason) => {
                self.sink.emit(DEEPLINK_EVENT, json!({ "status": "rejected", "message": reason }));
                return "rejected";
            }
        };
        // Local: เลือก workspace ตาม id ที่ไม่เปลี่ยน; id ที่ไม่รู้จักไม่ fallback ไปค้นใน workspace อื่น
        if let Some(ws) = link.workspace.clone() {
            if self.local_profile(&ws).is_err() {
                *self.pending_link.lock().unwrap() = None;
                self.sink.emit(DEEPLINK_EVENT, json!({ "status": "unknown_workspace", "workspace": ws }));
                return "unknown_workspace";
            }
            *self.pending_link.lock().unwrap() = Some(link.clone());
            if self.active_profile().map(|p| p.name != ws).unwrap_or(true) {
                let _ = self.profile_use(&ws);
            }
            self.sink.emit(DEEPLINK_EVENT, json!({ "status": "accepted", "link": link, "path": link.path() }));
            return "accepted";
        }
        let Some(profile) = link.profile.clone().filter(|p| self.profile(p).is_ok()) else {
            *self.pending_link.lock().unwrap() = None;
            self.sink.emit(DEEPLINK_EVENT, json!({ "status": "unknown_profile", "profile": link.profile }));
            return "unknown_profile";
        };
        *self.pending_link.lock().unwrap() = Some(link.clone());
        let switching = self.active_profile().map(|p| p.name != profile).unwrap_or(true);
        if switching {
            // เปลี่ยน profile ตามลิงก์อย่างชัดเจน (UI ล้าง cache และตรวจ sign-in/compat ใหม่ก่อน navigate)
            let _ = self.profile_use(&profile);
        }
        self.sink.emit(DEEPLINK_EVENT, json!({ "status": "accepted", "link": link, "path": link.path() }));
        "accepted"
    }

    /// The UI takes the pending link once its profile is active, signed in and compatible.
    /// A capture shortcut was pressed. The newest press replaces an untaken one, so a burst of presses
    /// while signed out still yields exactly one Pad action once the UI is ready.
    pub fn capture_intent(&self, intent: crate::shortcuts::CaptureIntent) -> u64 {
        let id = self.capture_seq.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
        *self.pending_capture.lock().unwrap() = Some((id, intent));
        self.sink.emit(CAPTURE_EVENT, json!({ "id": id, "intent": intent }));
        id
    }

    /// The pending capture intent, handed out once.
    pub fn capture_take(&self) -> Option<serde_json::Value> {
        self.pending_capture.lock().unwrap().take().map(|(id, intent)| json!({ "id": id, "intent": intent }))
    }

    pub fn deeplink_take(&self) -> Option<serde_json::Value> {
        let active = self.active_profile().ok()?.name;
        let mut pending = self.pending_link.lock().unwrap();
        if pending.as_ref().is_some_and(|l| l.profile.as_deref().or(l.workspace.as_deref()) == Some(active.as_str())) {
            let link = pending.take().unwrap();
            return Some(json!({ "link": link, "path": link.path() }));
        }
        None
    }

    // ---------- Local workspaces ----------

    fn runtime(&self) -> Result<&LocalRuntime> {
        self.local.as_ref().ok_or_else(|| NativeError::new("RUNTIME_UNAVAILABLE", "Local workspaces need the Alice runtime; reinstall Alice Desktop"))
    }

    async fn run_cli(&self, args: Vec<String>) -> Result<Value> {
        let runtime = self.runtime()?.clone();
        tokio::task::spawn_blocking(move || runtime.cli(&args.iter().map(String::as_str).collect::<Vec<_>>()))
            .await
            .map_err(|_| NativeError::new("RUNTIME_FAILED", "The Alice runtime stopped unexpectedly"))?
    }

    /// First run: the `Personal` workspace (created once) becomes Desktop's active workspace.
    pub async fn local_first_run(&self) -> Result<ProfilesView> {
        let data = self.run_cli(vec!["local".into(), "first-run".into()]).await?;
        let id = data["workspace"]["id"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "The runtime returned no workspace"))?.to_string();
        self.profile_use(&id)
    }

    pub async fn workspace_create(&self, name: &str) -> Result<ProfilesView> {
        let data = self.run_cli(vec!["workspace".into(), "create".into(), name.into()]).await?;
        let id = data["id"].as_str().ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "The runtime returned no workspace"))?.to_string();
        self.profile_use(&id)
    }

    pub async fn workspace_rename(&self, id: &str, name: &str) -> Result<ProfilesView> {
        self.local_profile(id)?;
        self.run_cli(vec!["workspace".into(), "rename".into(), id.into(), name.into()]).await?;
        self.emit_profile();
        Ok(self.profiles_list())
    }

    pub async fn workspace_alias(&self, id: &str, alias: &str) -> Result<ProfilesView> {
        self.local_profile(id)?;
        if self.profiles.lock().unwrap().get(alias).is_some() {
            return Err(NativeError::invalid(format!("\"{alias}\" is already a Remote profile name")));
        }
        self.run_cli(vec!["workspace".into(), "alias".into(), id.into(), alias.into()]).await?;
        self.emit_profile();
        Ok(self.profiles_list())
    }

    /// Renames the Local Owner of the active Local workspace (onboarding and Settings).
    pub async fn owner_rename(&self, display_name: &str) -> Result<Value> {
        let p = self.active_profile()?;
        if p.local.is_none() {
            return Err(NativeError::invalid("Your Remote name is managed on the server"));
        }
        let (origin, token) = self.endpoint(&p, false).await?;
        ServerClient { http: &self.http, origin: &origin }.local_call("PATCH", "/owner", Some(&json!({ "displayName": display_name })), &token).await
    }

    /// Recovery: replace the workspace with its newest backup (current data is backed up first).
    pub async fn local_restore_latest(&self, id: &str) -> Result<ProfilesView> {
        let p = self.local_profile(id)?;
        let name = p.local.as_ref().map(|l| l.display_name.clone()).unwrap_or_default();
        self.replace_stream(None);
        self.stop_presence();
        self.local_conns.lock().await.remove(id);
        self.run_cli(vec!["workspace".into(), "restore".into(), id.into(), "--latest".into(), "--replace".into(), "--confirm".into(), name, "--yes".into()]).await?;
        self.emit_profile();
        Ok(self.profiles_list())
    }

    /// Recovery: the read-only `alice doctor` report for one workspace (no content, no credentials).
    pub async fn local_diagnostics(&self, id: &str) -> Result<Value> {
        self.local_profile(id)?;
        self.run_cli(vec!["doctor".into(), "--workspace".into(), id.into()]).await
    }

    // ---------- agent integrations ----------

    fn agent_client(client: &str) -> Result<&'static str> {
        match client {
            "codex" => Ok("codex"),
            "claude-code" | "claude" => Ok("claude-code"),
            _ => Err(NativeError::invalid("Unknown agent")),
        }
    }

    /// Onboarding consent: installs only what the person ticked (launcher, Codex, Claude Code).
    pub async fn tools_apply(&self, cli: bool, codex: bool, claude: bool) -> Result<Value> {
        let mut done = Vec::new();
        if cli {
            self.run_cli(vec!["local".into(), "install-launcher".into()]).await?;
            done.push("cli");
        }
        for (wanted, client) in [(codex, "codex"), (claude, "claude-code")] {
            if wanted {
                self.run_cli(vec!["integration".into(), "enable".into(), client.into()]).await?;
                done.push(client);
            }
        }
        Ok(json!({ "installed": done }))
    }

    pub async fn integrations_status(&self) -> Result<Value> {
        self.run_cli(vec!["integration".into(), "list".into()]).await
    }

    pub async fn integration_set(&self, client: &str, enabled: bool) -> Result<Value> {
        let client = Self::agent_client(client)?;
        self.run_cli(vec!["integration".into(), if enabled { "enable" } else { "disable" }.into(), client.into()]).await
    }

    pub async fn integration_unassign(&self, client: &str, workspace: &str) -> Result<Value> {
        let client = Self::agent_client(client)?;
        self.local_profile(workspace)?;
        self.run_cli(vec!["integration".into(), "unassign".into(), client.into(), "--workspace".into(), workspace.into(), "--yes".into()]).await
    }

    /// Opens the data folder of a Local workspace in the OS file manager (recovery action).
    pub fn local_open_folder(&self, id: &str) -> Result<bool> {
        self.local_profile(id)?;
        let dir = self.runtime()?.data_dir(id);
        Ok((self.opener)(&dir.to_string_lossy()))
    }

    // ---------- Client API proxy ----------

    /// The WebView's only network path: a Client API call on the active profile's server, with the
    /// bearer credential added here. Paths are confined to the Client API prefix.
    pub async fn api_request(&self, expected_profile: &str, method: &str, path: &str, query: &[(String, String)], body: Option<Value>, headers: &HashMap<String, String>) -> Result<ApiResponse> {
        validate_api_request(method, path)?;
        let p = self.active_profile()?;
        if p.name != expected_profile {
            return Err(NativeError::new("PROFILE_CHANGED", "The active profile changed; the request was not sent"));
        }
        let mut extra = Vec::new();
        for (k, v) in headers {
            let key = k.to_ascii_lowercase();
            if key == IDEMPOTENCY_HEADER && v.len() <= 128 && v.chars().all(|c| c.is_ascii_alphanumeric() || "_.:-".contains(c)) {
                extra.push((key, v.clone()));
            }
        }
        let (origin, token) = match self.endpoint(&p, false).await {
            Ok(e) => e,
            // daemon ของ Local อาจหยุดหรือย้าย port: เชื่อมต่อใหม่หนึ่งครั้ง
            Err(e) if p.local.is_some() && e.code == "NETWORK_ERROR" => self.endpoint(&p, true).await?,
            Err(e) => return Err(e),
        };
        let res = match (ServerClient { http: &self.http, origin: &origin }).send(method, path, query, body.as_ref(), Some(&token), &extra).await {
            Err(e) if p.local.is_some() && e.code == "NETWORK_ERROR" => {
                let (origin, token) = self.endpoint(&p, true).await?;
                return ServerClient { http: &self.http, origin: &origin }.send(method, path, query, body.as_ref(), Some(&token), &extra).await;
            }
            other => other?,
        };
        if res.status == 401 {
            let (origin, renewed) = self.endpoint(&p, true).await?;
            return ServerClient { http: &self.http, origin: &origin }.send(method, path, query, body.as_ref(), Some(&renewed), &extra).await;
        }
        Ok(res)
    }

    /// Anonymous Client API call for pre-login checks (server info).
    pub async fn anonymous(&self, p: &Profile, path: &str) -> Result<Value> {
        let res = ServerClient { http: &self.http, origin: &p.server }.send("GET", path, &[], None, None, &[]).await?;
        if (200..300).contains(&res.status) { Ok(res.data) } else { Err(server_error(&res)) }
    }
}

const DENIED_PREFIXES: [&str; 4] = ["/device/", "/auth/refresh", "/auth/revoke", "/events"];

pub fn validate_api_request(method: &str, path: &str) -> Result<()> {
    if !matches!(method, "GET" | "POST" | "PATCH" | "PUT" | "DELETE") {
        return Err(NativeError::invalid("Unsupported method"));
    }
    let ok = path.starts_with('/')
        && path.len() <= 512
        && !path.contains("..")
        && !path.contains("//")
        && path.chars().all(|c| c.is_ascii_alphanumeric() || "/_-.~%".contains(c));
    if !ok {
        return Err(NativeError::invalid("Invalid API path"));
    }
    if DENIED_PREFIXES.iter().any(|d| path == d.trim_end_matches('/') || path.starts_with(d)) {
        return Err(NativeError::invalid("This endpoint is handled by the native layer"));
    }
    Ok(())
}

/// External links (document sources) open in the system browser; only http(s) with a host is allowed.
pub fn validate_external_url(raw: &str) -> Result<String> {
    let url = url::Url::parse(raw).map_err(|_| NativeError::invalid("Not a valid URL"))?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(NativeError::invalid("Only http and https links can be opened"));
    }
    Ok(url.to_string())
}

fn now_iso() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_paths_are_confined() {
        assert!(validate_api_request("GET", "/tasks").is_ok());
        assert!(validate_api_request("POST", "/tasks/tsk_1/complete").is_ok());
        for bad in ["tasks", "/../admin", "//evil.example/x", "/tasks?x=1", "/tasks#x", "/device/token", "/auth/refresh", "/events", "/x y"] {
            assert!(validate_api_request("GET", bad).is_err(), "{bad}");
        }
        assert!(validate_api_request("TRACE", "/tasks").is_err());
    }

    #[test]
    fn external_urls_are_restricted() {
        assert!(validate_external_url("https://example.com/a?b=c").is_ok());
        for bad in ["file:///etc/passwd", "javascript:alert(1)", "alice://open/task/tsk_1?profile=x", "smb://host/share", "https://user:pw@example.com", "notaurl"] {
            assert!(validate_external_url(bad).is_err(), "{bad}");
        }
    }
}
