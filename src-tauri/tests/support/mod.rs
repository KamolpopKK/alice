//! Boots the real Alice Server (Node) against a temporary SQLite database for native tests.
#![allow(dead_code)]

use alice_desktop::core::{Core, EventSink};
use alice_desktop::credentials::CredentialStore;
use alice_desktop::error::Result;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

pub struct Server {
    pub url: String,
    pub child: Child,
    pub data: Option<tempfile::TempDir>,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub const BOOTSTRAP: &str = "native-test-bootstrap-token-0123456789";

pub fn start_server() -> Server {
    let data = tempfile::tempdir().unwrap();
    let mut server = start_server_at(data.path(), 0);
    server.data = Some(data);
    server
}

/// Starts (or restarts) a server on a given data directory and port (0 = any).
pub fn start_server_at(data: &Path, port: u16) -> Server {
    let mut child = Command::new("node")
        .args(["--import", "tsx", "src/server/cli.ts", "serve"])
        .current_dir(repo_root())
        .env("NODE_ENV", "test")
        .env("ALICE_DATA_DIR", data)
        .env("ALICE_HOST", "127.0.0.1")
        .env("ALICE_PORT", port.to_string())
        .env("ALICE_LOG_LEVEL", "info")
        .env("ALICE_BOOTSTRAP_TOKEN", BOOTSTRAP)
        .env("ALICE_DEVICE_POLL_INTERVAL", "1")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("node must be installed to run native tests");
    let stdout = child.stdout.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(|l| l.ok()) {
            if line.contains("alice.listening") {
                if let Ok(v) = serde_json::from_str::<Value>(&line) {
                    let _ = tx.send(v["url"].as_str().unwrap_or_default().to_string());
                }
            }
        }
    });
    let url = rx.recv_timeout(Duration::from_secs(30)).expect("Alice server did not start");
    Server { url, child, data: None }
}

/// A browser-like human session (cookie + CSRF) used to approve device requests.
pub struct Human {
    pub base: String,
    pub cookie: String,
    pub csrf: String,
    http: reqwest::Client,
}

impl Human {
    pub async fn bootstrap(base: &str) -> Human {
        let http = reqwest::Client::new();
        let res = http
            .post(format!("{base}/client/v1/auth/bootstrap"))
            .json(&json!({ "bootstrapToken": BOOTSTRAP, "username": "owner", "displayName": "Olivia Owner", "password": "owner-password-123" }))
            .send()
            .await
            .unwrap();
        assert_eq!(res.status(), 201);
        let cookie = res.headers().get_all("set-cookie").iter().find_map(|v| v.to_str().ok()?.split(';').next().filter(|c| c.starts_with("alice_session=")).map(String::from)).unwrap();
        let body: Value = res.json().await.unwrap();
        Human { base: base.into(), cookie, csrf: body["csrfToken"].as_str().unwrap().into(), http }
    }

    pub async fn post(&self, path: &str, body: Value) -> (u16, Value) {
        let res = self.http.post(format!("{}{path}", self.base)).header("cookie", &self.cookie).header("x-csrf-token", &self.csrf).json(&body).send().await.unwrap();
        let status = res.status().as_u16();
        (status, res.json().await.unwrap_or(Value::Null))
    }

    pub async fn get(&self, path: &str) -> Value {
        self.http.get(format!("{}{path}", self.base)).header("cookie", &self.cookie).send().await.unwrap().json().await.unwrap()
    }
}

#[derive(Default)]
pub struct MemoryStore(pub Mutex<BTreeMap<String, String>>);

impl CredentialStore for MemoryStore {
    fn name(&self) -> &'static str {
        "memory"
    }
    fn get(&self, a: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().get(a).cloned())
    }
    fn set(&self, a: &str, s: &str) -> Result<()> {
        self.0.lock().unwrap().insert(a.into(), s.into());
        Ok(())
    }
    fn delete(&self, a: &str) -> Result<()> {
        self.0.lock().unwrap().remove(a);
        Ok(())
    }
}

/// Shares one store between the core and the test so the test can inspect it.
pub struct SharedStore(pub Arc<MemoryStore>);
impl CredentialStore for SharedStore {
    fn name(&self) -> &'static str {
        "memory"
    }
    fn get(&self, a: &str) -> Result<Option<String>> {
        self.0.get(a)
    }
    fn set(&self, a: &str, s: &str) -> Result<()> {
        self.0.set(a, s)
    }
    fn delete(&self, a: &str) -> Result<()> {
        self.0.delete(a)
    }
}

#[derive(Default)]
pub struct Events(pub Mutex<Vec<(String, Value)>>);

impl EventSink for Events {
    fn emit(&self, event: &str, payload: Value) {
        self.0.lock().unwrap().push((event.into(), payload));
    }
}

impl Events {
    pub async fn wait_for(&self, pred: impl Fn(&str, &Value) -> bool, timeout: Duration) -> Value {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some((_, v)) = self.0.lock().unwrap().iter().find(|(e, v)| pred(e, v)) {
                return v.clone();
            }
            if Instant::now() > deadline {
                panic!("event not seen; got {:?}", self.0.lock().unwrap());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }
}

pub struct Harness {
    pub core: Arc<Core>,
    pub store: Arc<MemoryStore>,
    pub events: Arc<Events>,
    pub opened: Arc<Mutex<Vec<String>>>,
    pub dir: tempfile::TempDir,
}

pub fn harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(MemoryStore::default());
    let events = Arc::new(Events::default());
    let opened = Arc::new(Mutex::new(Vec::new()));
    let o = Arc::clone(&opened);
    let mut core = Core::new(dir.path().to_path_buf(), Box::new(SharedStore(Arc::clone(&store))), events.clone(), Arc::new(move |u: &str| {
        o.lock().unwrap().push(u.to_string());
        true
    }))
    .unwrap();
    // Remote-only: ห้ามเห็น Local workspaces จริงของเครื่องที่รันเทสต์ (~/Library/Application Support/Alice)
    core.local = None;
    Harness { core: Arc::new(core), store, events, opened, dir }
}

/// Runs the device flow through the core; `approver` approves the code in its browser session.
pub async fn sign_in(h: &Harness, profile: &str, approver: &Human) -> Value {
    let started = h.core.login_start(profile).await.unwrap();
    let (status, body) = approver.post("/client/v1/device/approve", json!({ "userCode": started.user_code })).await;
    assert_eq!(status, 200, "{body}");
    h.events
        .wait_for(|e, v| e == "alice://auth" && v["profile"] == profile && v["status"] == "signed_in", Duration::from_secs(15))
        .await
}

/// A harness whose core opens Local workspaces through the CLI runtime from source.
pub fn local_harness() -> Harness {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("app-data");
    let store = Arc::new(MemoryStore::default());
    let events = Arc::new(Events::default());
    let opened = Arc::new(Mutex::new(Vec::new()));
    let o = Arc::clone(&opened);
    let mut core = Core::new(dir.path().join("config"), Box::new(SharedStore(Arc::clone(&store))), events.clone(), Arc::new(move |u: &str| {
        o.lock().unwrap().push(u.to_string());
        true
    }))
    .unwrap();
    let repo = repo_root();
    let tsx = |entry: &str| vec!["node".to_string(), "--import".into(), "tsx".into(), repo.join(entry).to_string_lossy().into_owned()];
    core.local = Some(alice_desktop::local::LocalRuntime {
        root: root.clone(),
        command: tsx("src/cli/index.ts"),
        cli_config_dir: dir.path().join("cli"),
        env: vec![
            ("NODE_ENV".into(), "test".into()),
            ("ALICE_CREDENTIAL_STORE".into(), format!("file:{}", dir.path().join("credentials.json").display())),
            ("ALICE_RUNTIME_COMMAND".into(), serde_json::to_string(&tsx("src/server/cli.ts")).unwrap()),
            // Desktop และ runtime ต้องเป็นเวอร์ชันเดียวกันพอดี
        ],
    });
    Harness { core: Arc::new(core), store, events, opened, dir }
}

/// Stops every Local daemon under a harness's application-data root.
pub fn stop_local_daemons(h: &Harness) {
    let root = h.dir.path().join("app-data").join("workspaces");
    for entry in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if let Ok(text) = std::fs::read_to_string(entry.path().join("daemon.json")) {
            if let Some(pid) = serde_json::from_str::<Value>(&text).ok().and_then(|v| v["pid"].as_u64()) {
                let _ = std::process::Command::new("kill").arg(pid.to_string()).status();
            }
        }
    }
}
