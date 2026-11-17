//! Local workspaces: the native core reads the non-secret registry itself and asks the
//! installed Alice runtime to create workspaces and to start or reuse a workspace's daemon. The runtime
//! hands back the loopback address and the owner capability over a pipe; neither is logged, persisted
//! by the core, or exposed to the WebView.

use crate::error::{NativeError, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspace {
    pub id: String,
    pub name: String,
    pub alias: String,
    #[serde(default = "active_state")]
    pub state: String,
    pub created_at: String,
    #[serde(default)]
    pub last_used_at: Option<String>,
}

fn active_state() -> String {
    "active".into()
}

#[derive(Debug, Default, Deserialize)]
struct Registry {
    #[serde(default)]
    workspaces: Vec<LocalWorkspace>,
}

/// A live connection to one workspace daemon. Kept in memory only.
#[derive(Clone)]
pub struct LocalConnection {
    pub base_url: String,
    pub capability: String,
    pub version: String,
}

impl std::fmt::Debug for LocalConnection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // capability ต้องไม่หลุดไปกับ debug output
        f.debug_struct("LocalConnection").field("base_url", &self.base_url).field("version", &self.version).finish()
    }
}

pub fn is_workspace_id(value: &str) -> bool {
    value.strip_prefix("wsp_").is_some_and(|rest| (4..=60).contains(&rest.len()) && rest.chars().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase()))
}

/// The application-data root shared with the CLI: `ALICE_HOME`, else the platform location.
pub fn app_data_root() -> PathBuf {
    if let Ok(home) = std::env::var("ALICE_HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    let home = std::env::var("HOME").map(PathBuf::from).unwrap_or_default();
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support/Alice")
    } else if cfg!(windows) {
        std::env::var("APPDATA").map(PathBuf::from).unwrap_or(home).join("Alice")
    } else {
        std::env::var("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|_| home.join(".local/share")).join("alice")
    }
}

#[derive(Clone)]
pub struct LocalRuntime {
    pub root: PathBuf,
    /// Command that runs the `alice` CLI of the installed runtime.
    pub command: Vec<String>,
    /// Desktop's own CLI state (never the user's CLI active workspace).
    pub cli_config_dir: PathBuf,
    /// Extra environment for the runtime (tests point it at a file credential store).
    pub env: Vec<(String, String)>,
}

impl LocalRuntime {
    /// `ALICE_DESKTOP_RUNTIME` (JSON array, development and tests), else the installed runtime launcher.
    pub fn detect(config_dir: &Path) -> Option<Self> {
        let root = app_data_root();
        let command = match std::env::var("ALICE_DESKTOP_RUNTIME") {
            Ok(raw) if !raw.is_empty() => serde_json::from_str::<Vec<String>>(&raw).ok()?,
            _ => crate::runtime::installed_cli_command(&root)?,
        };
        if command.is_empty() {
            return None;
        }
        Some(Self { root, command, cli_config_dir: config_dir.join("cli"), env: Vec::new() })
    }

    pub fn workspaces(&self) -> Result<Vec<LocalWorkspace>> {
        let file = self.root.join("registry.json");
        match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str::<Registry>(&text)
                .map(|r| r.workspaces)
                .map_err(|_| NativeError::new("STORAGE_ERROR", "The Local workspace registry is damaged; run alice doctor")),
            Err(_) => Ok(Vec::new()),
        }
    }

    pub fn workspace(&self, id: &str) -> Result<LocalWorkspace> {
        self.workspaces()?.into_iter().find(|w| w.id == id).ok_or_else(|| NativeError::new("NO_WORKSPACE", "That Local workspace no longer exists"))
    }

    pub fn data_dir(&self, id: &str) -> PathBuf {
        self.root.join("workspaces").join(id)
    }

    /// Runs `alice <args> --json` and returns the envelope's data, mapping failures to native errors.
    pub fn cli(&self, args: &[&str]) -> Result<Value> {
        let mut cmd = Command::new(&self.command[0]);
        cmd.args(&self.command[1..])
            .args(args)
            .arg("--json")
            .env("ALICE_HOME", &self.root)
            .env("ALICE_CONFIG_DIR", &self.cli_config_dir)
            .env_remove("ALICE_WORKSPACE")
            .env_remove("ALICE_AGENT")
            .envs(self.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let out = cmd.output().map_err(|_| NativeError::new("RUNTIME_UNAVAILABLE", "The Alice runtime could not be started"))?;
        let body: Value = serde_json::from_slice(&out.stdout).map_err(|_| {
            let stderr = String::from_utf8_lossy(&out.stderr);
            // stderr ของ runtime ไม่มี capability (ส่งทาง stdout เท่านั้น) จึงแสดงบรรทัดแรกเป็นรายละเอียดได้
            NativeError::new("RUNTIME_FAILED", "The Alice runtime did not answer").with_details(serde_json::json!({ "detail": stderr.lines().next().unwrap_or_default() }))
        })?;
        if body["ok"].as_bool() == Some(true) {
            Ok(body["data"].clone())
        } else {
            let code = body["error"]["code"].as_str().unwrap_or("RUNTIME_FAILED").to_string();
            let message = body["error"]["message"].as_str().unwrap_or("The Alice runtime reported an error").to_string();
            Err(NativeError::new(&code, message))
        }
    }

    pub fn connect(&self, id: &str) -> Result<LocalConnection> {
        let data = self.cli(&["local", "connect", "--workspace", id])?;
        let field = |k: &str| data[k].as_str().map(str::to_string).ok_or_else(|| NativeError::new("PROTOCOL_ERROR", "The Alice runtime returned an incomplete connection"));
        let base_url = field("baseUrl")?;
        if !base_url.starts_with("http://127.0.0.1:") {
            return Err(NativeError::new("PROTOCOL_ERROR", "The Local workspace must listen on loopback"));
        }
        Ok(LocalConnection { base_url, capability: field("capability")?, version: field("version")? })
    }
}
