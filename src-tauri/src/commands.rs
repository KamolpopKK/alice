use crate::api::ApiResponse;
use crate::core::{validate_external_url, ConnectionTest, Core, LoginStarted, ProfilesView};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::State;

pub type CoreState<'a> = State<'a, Arc<Core>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: &'static str,
    client_api: u32,
    credential_store: &'static str,
    /// Result of installing the bundled Local runtime at startup (None in development).
    runtime: Option<Value>,
}

/// Outcome of the bundled runtime install/activation at startup.
pub struct RuntimeStatus(pub std::sync::Mutex<Option<Value>>);

/// The UI calls this once after it renders. With `ALICE_DESKTOP_SMOKE=exit` the app reports that the
/// production frontend loaded and talked to Rust, then quits (used by packaging smoke tests).
#[tauri::command]
pub fn app_info(app: tauri::AppHandle, core: CoreState<'_>, runtime: State<'_, RuntimeStatus>) -> AppInfo {
    if let Ok(mode) = std::env::var("ALICE_DESKTOP_SMOKE") {
        println!("alice-desktop: ui-ready");
        if mode == "exit" {
            app.exit(0);
        }
    }
    AppInfo { version: env!("CARGO_PKG_VERSION"), client_api: crate::api::CLIENT_API_VERSION, credential_store: core.credential_store_name(), runtime: runtime.0.lock().unwrap().clone() }
}

#[tauri::command]
pub fn profiles_list(core: CoreState<'_>) -> ProfilesView {
    core.profiles_list()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileAddInput {
    name: String,
    server: String,
    #[serde(default)]
    insecure_dev: bool,
    #[serde(default = "yes")]
    make_active: bool,
}
fn yes() -> bool {
    true
}

#[tauri::command]
pub fn profile_add(core: CoreState<'_>, input: ProfileAddInput) -> Result<ProfilesView> {
    core.profile_add(&input.name, &input.server, input.insecure_dev, input.make_active)
}

#[tauri::command]
pub fn profile_use(core: CoreState<'_>, name: String) -> Result<ProfilesView> {
    core.profile_use(&name)
}

#[tauri::command]
pub async fn profile_remove(core: CoreState<'_>, name: String) -> Result<ProfilesView> {
    core.profile_remove(&name).await
}

#[tauri::command]
pub async fn profile_test(core: CoreState<'_>, name: String) -> Result<ConnectionTest> {
    let core = Arc::clone(&core);
    core.profile_test(&name).await
}

// ---------- Local workspaces ----------

#[tauri::command]
pub async fn local_first_run(core: CoreState<'_>) -> Result<ProfilesView> {
    core.local_first_run().await
}

#[tauri::command]
pub async fn workspace_create(core: CoreState<'_>, name: String) -> Result<ProfilesView> {
    core.workspace_create(&name).await
}

#[tauri::command]
pub async fn workspace_rename(core: CoreState<'_>, id: String, name: String) -> Result<ProfilesView> {
    core.workspace_rename(&id, &name).await
}

#[tauri::command]
pub async fn workspace_alias(core: CoreState<'_>, id: String, alias: String) -> Result<ProfilesView> {
    core.workspace_alias(&id, &alias).await
}

#[tauri::command]
pub async fn owner_rename(core: CoreState<'_>, display_name: String) -> Result<Value> {
    core.owner_rename(&display_name).await
}

#[tauri::command]
pub fn local_open_folder(core: CoreState<'_>, id: String) -> Result<bool> {
    core.local_open_folder(&id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    profile: Option<crate::core::ProfileView>,
    signed_in: bool,
}

#[tauri::command]
pub fn auth_status(core: CoreState<'_>) -> AuthStatus {
    let view = core.profiles_list();
    let profile = view.profiles.into_iter().find(|p| p.active);
    let signed_in = profile.as_ref().is_some_and(|p| p.signed_in);
    AuthStatus { profile, signed_in }
}

#[tauri::command]
pub async fn auth_login_start(core: CoreState<'_>, profile: String) -> Result<LoginStarted> {
    let core = Arc::clone(&core);
    core.login_start(&profile).await
}

#[tauri::command]
pub fn auth_login_cancel(core: CoreState<'_>) {
    core.login_cancel()
}

#[tauri::command]
pub async fn auth_logout(core: CoreState<'_>, profile: String) -> Result<bool> {
    core.logout(&profile).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiRequestInput {
    /// The profile the WebView believes is active; a mismatch is refused (no cross-profile leaks).
    profile: String,
    method: String,
    path: String,
    #[serde(default)]
    query: Vec<(String, String)>,
    body: Option<Value>,
    #[serde(default)]
    headers: HashMap<String, String>,
}

#[tauri::command]
pub async fn api_request(core: CoreState<'_>, input: ApiRequestInput) -> Result<ApiResponse> {
    core.api_request(&input.profile, &input.method, &input.path, &input.query, input.body, &input.headers).await
}

#[tauri::command]
pub fn open_external(core: CoreState<'_>, url: String) -> Result<()> {
    let url = validate_external_url(&url)?;
    (core.opener)(&url);
    Ok(())
}

#[tauri::command]
pub fn events_subscribe(core: CoreState<'_>, profile: String, after: Option<u64>) -> Result<()> {
    core.inner().events_subscribe(&profile, after)
}

#[tauri::command]
pub fn events_unsubscribe(core: CoreState<'_>) {
    core.events_unsubscribe()
}

#[tauri::command]
pub fn deeplink_take(core: CoreState<'_>) -> Option<Value> {
    core.deeplink_take()
}

/// Whether this build carries updater configuration (release builds do; local builds do not).
pub struct Updates {
    pub configured: bool,
    pub pending: std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    configured: bool,
    available: bool,
    current_version: &'static str,
    version: Option<String>,
    notes: Option<String>,
    #[serde(flatten)]
    decision: Option<crate::updates::Decision>,
}

#[tauri::command]
pub async fn update_check(app: tauri::AppHandle, core: CoreState<'_>, updates: State<'_, Updates>) -> Result<UpdateStatus> {
    use tauri_plugin_updater::UpdaterExt;
    let mut status = UpdateStatus { configured: updates.configured, available: false, current_version: env!("CARGO_PKG_VERSION"), version: None, notes: None, decision: None };
    if !updates.configured {
        return Ok(status);
    }
    let updater = app.updater().map_err(|_| crate::error::NativeError::new("UPDATE_ERROR", "Updates are not available in this build"))?;
    let Some(update) = updater.check().await.map_err(|_| crate::error::NativeError::new("UPDATE_ERROR", "Could not check for updates"))? else {
        return Ok(status);
    };
    let client_api = update.raw_json.get("aliceClientApi").and_then(Value::as_u64).map(|v| v as u32);
    // ตรวจว่า version ใหม่ยังคุยกับ server ที่ใช้อยู่ได้ (ถ้าติดต่อ server ได้)
    let range = match core.active_profile() {
        Ok(p) => core.server_info(&p).await.ok().map(|i| i.client_api),
        Err(_) => None,
    };
    let decision = crate::updates::evaluate(&update.current_version, &update.version, client_api, range.as_ref());
    status.available = decision == crate::updates::Decision::Install;
    status.version = Some(update.version.clone());
    status.notes = update.body.clone();
    status.decision = Some(decision);
    *updates.pending.lock().unwrap() = if status.available { Some(update) } else { None };
    Ok(status)
}

/// Downloads, verifies (signature checked by the updater against the built-in key) and installs the
/// update found by the last check, then restarts. Profiles and keyring credentials are untouched.
#[tauri::command]
pub async fn update_install(app: tauri::AppHandle, updates: State<'_, Updates>) -> Result<()> {
    let update = updates.pending.lock().unwrap().take().ok_or_else(|| crate::error::NativeError::invalid("Check for updates first"))?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|_| crate::error::NativeError::new("UPDATE_ERROR", "The update could not be verified or installed; nothing was changed"))?;
    app.restart()
}

#[tauri::command]
pub fn capture_take(core: CoreState<'_>) -> Option<Value> {
    core.capture_take()
}

#[tauri::command]
pub fn shortcuts_get(shortcuts: State<'_, Arc<crate::shortcuts::Shortcuts>>) -> crate::shortcuts::ShortcutsView {
    shortcuts.view()
}

#[tauri::command]
pub fn shortcuts_set(shortcuts: State<'_, Arc<crate::shortcuts::Shortcuts>>, input: crate::shortcuts::ShortcutsInput) -> Result<crate::shortcuts::ShortcutsView> {
    shortcuts.update(input)
}

#[tauri::command]
pub fn shortcuts_reset(shortcuts: State<'_, Arc<crate::shortcuts::Shortcuts>>) -> Result<crate::shortcuts::ShortcutsView> {
    shortcuts.reset()
}

#[tauri::command]
pub async fn local_restore_latest(core: CoreState<'_>, id: String) -> Result<ProfilesView> {
    core.local_restore_latest(&id).await
}

#[tauri::command]
pub async fn local_diagnostics(core: CoreState<'_>, id: String) -> Result<Value> {
    core.local_diagnostics(&id).await
}

#[derive(Deserialize)]
pub struct ToolsInput {
    cli: bool,
    codex: bool,
    claude: bool,
}

#[tauri::command]
pub async fn tools_apply(core: CoreState<'_>, input: ToolsInput) -> Result<Value> {
    core.tools_apply(input.cli, input.codex, input.claude).await
}

#[tauri::command]
pub async fn integrations_status(core: CoreState<'_>) -> Result<Value> {
    core.integrations_status().await
}

#[tauri::command]
pub async fn integration_set(core: CoreState<'_>, client: String, enabled: bool) -> Result<Value> {
    core.integration_set(&client, enabled).await
}

#[tauri::command]
pub async fn integration_unassign(core: CoreState<'_>, client: String, workspace: String) -> Result<Value> {
    core.integration_unassign(&client, &workspace).await
}

/// Only the main window may report drafts or answer the close/quit question.
fn main_window_only(window: &tauri::Window) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(crate::error::NativeError::invalid("Only the main window can do this"))
    }
}

/// Whether any document in the UI has unsaved changes. Never receives the content.
#[tauri::command]
pub fn editor_dirty_set(window: tauri::Window, guard: State<'_, Arc<crate::drafts::LeaveGuard>>, dirty: bool) -> Result<()> {
    main_window_only(&window)?;
    guard.set_dirty(dirty);
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveReply {
    request_id: String,
    discard: bool,
}

/// The person's answer to `alice://editor-leave-requested`: Discard runs the held close/quit once.
#[tauri::command]
pub fn editor_leave_reply(app: tauri::AppHandle, window: tauri::Window, guard: State<'_, Arc<crate::drafts::LeaveGuard>>, input: LeaveReply) -> Result<()> {
    use tauri::Manager;
    main_window_only(&window)?;
    let action = guard
        .reply(&input.request_id, input.discard)
        .map_err(|_| crate::error::NativeError::invalid("This close request is no longer open"))?;
    match action {
        Some(crate::drafts::LeaveAction::Close) => {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.close();
            }
        }
        Some(crate::drafts::LeaveAction::Exit) => app.exit(0),
        None => {}
    }
    Ok(())
}
