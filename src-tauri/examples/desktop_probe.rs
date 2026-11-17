//! Test driver for the real Alice Desktop Rust core (no WebView). Reads JSON commands on stdin, writes
//! JSON lines on stdout: replies, and every native event the UI would receive. Used by the cross-client
//! system story so Desktop's actual network, credential and event code takes part.
//!
//! Commands: {"cmd":"add_profile","name","server"} {"cmd":"login","profile"} {"cmd":"subscribe","after"?}
//!           {"cmd":"unsubscribe"} {"cmd":"request","id","method","path","body"?,"query"?} {"cmd":"quit"}

use alice_desktop::core::{Core, EventSink};
use alice_desktop::credentials::CredentialStore;
use alice_desktop::error::Result;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Default)]
struct MemoryStore(Mutex<BTreeMap<String, String>>);
impl CredentialStore for MemoryStore {
    fn name(&self) -> &'static str {
        "probe memory"
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

struct StdoutSink;
impl EventSink for StdoutSink {
    fn emit(&self, event: &str, payload: Value) {
        out(json!({ "event": event, "payload": payload }));
    }
}

fn out(v: Value) {
    let mut stdout = std::io::stdout().lock();
    let _ = writeln!(stdout, "{v}");
    let _ = stdout.flush();
}

#[tokio::main]
async fn main() {
    let dir = std::env::temp_dir().join(format!("alice-probe-{}", std::process::id()));
    let core = Arc::new(Core::new(dir, Box::new(MemoryStore::default()), Arc::new(StdoutSink), Arc::new(|_: &str| true)).expect("core"));
    out(json!({ "ready": true }));
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let cmd: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = cmd["id"].clone();
        let reply = |r: std::result::Result<Value, alice_desktop::error::NativeError>| match r {
            Ok(v) => out(json!({ "reply": id, "ok": true, "value": v })),
            Err(e) => out(json!({ "reply": id, "ok": false, "error": e })),
        };
        match cmd["cmd"].as_str().unwrap_or_default() {
            "add_profile" => reply(core.profile_add(cmd["name"].as_str().unwrap(), cmd["server"].as_str().unwrap(), false, true).map(|v| json!(v))),
            "login" => reply(core.login_start(cmd["profile"].as_str().unwrap()).await.map(|v| json!(v))),
            "subscribe" => reply(core.events_subscribe(&core.active_profile().unwrap().name, cmd["after"].as_u64()).map(|_| json!(null))),
            "unsubscribe" => {
                core.events_unsubscribe();
                reply(Ok(json!(null)))
            }
            "request" => {
                let profile = core.active_profile().map(|p| p.name).unwrap_or_default();
                let query: Vec<(String, String)> = cmd["query"].as_object().map(|m| m.iter().map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_string())).collect()).unwrap_or_default();
                let body = if cmd["body"].is_null() { None } else { Some(cmd["body"].clone()) };
                let res = core.api_request(&profile, cmd["method"].as_str().unwrap_or("GET"), cmd["path"].as_str().unwrap_or("/"), &query, body, &HashMap::new()).await;
                reply(res.map(|r| json!(r)))
            }
            "quit" => break,
            _ => reply(Err(alice_desktop::error::NativeError::invalid("unknown command"))),
        }
    }
}
