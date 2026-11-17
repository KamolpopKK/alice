//! Live invalidations: the Rust core holds the authenticated SSE stream and forwards typed events.

use crate::api::{CLIENT_API_PREFIX, CLIENT_API_VERSION, CLIENT_NAME};
use crate::core::{Core, AUTH_EVENT};
use crate::error::{NativeError, Result};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

pub const EVENTS_EVENT: &str = "alice://events";
/// A silent stream for this long is treated as dead (the server sends a heartbeat every 25 s).
const IDLE_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// Incremental parser for `text/event-stream` frames.
#[derive(Default)]
pub struct SseParser {
    buffer: String,
}

#[derive(Debug, PartialEq)]
pub struct Frame {
    pub event: String,
    pub data: String,
    pub id: Option<String>,
}

impl SseParser {
    pub fn push(&mut self, chunk: &str) -> Vec<Frame> {
        self.buffer.push_str(&chunk.replace("\r\n", "\n"));
        let mut frames = Vec::new();
        while let Some(idx) = self.buffer.find("\n\n") {
            let block: String = self.buffer.drain(..idx + 2).collect();
            let (mut event, mut data, mut id) = (String::from("message"), Vec::new(), None);
            for line in block.lines() {
                if line.starts_with(':') || line.is_empty() {
                    continue;
                }
                let (field, value) = match line.split_once(':') {
                    Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
                    None => (line, ""),
                };
                match field {
                    "event" => event = value.to_string(),
                    "data" => data.push(value.to_string()),
                    "id" => id = Some(value.to_string()),
                    _ => {}
                }
            }
            if !data.is_empty() || event != "message" {
                frames.push(Frame { event, data: data.join("\n"), id });
            }
        }
        frames
    }
}

fn stream_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .tcp_keepalive(Duration::from_secs(30))
        .user_agent(CLIENT_NAME)
        .build()
        .expect("stream client")
}

enum StreamEnd {
    /// Connection dropped or went idle; reconnect with backoff.
    Disconnected,
    /// The server says the credential is no longer valid.
    Unauthorized,
}

impl Core {
    /// Starts (or replaces) the live stream for the active profile, resuming after `after` when given.
    pub fn events_subscribe(self: &Arc<Self>, profile: &str, after: Option<u64>) -> Result<()> {
        let p = self.active_profile()?;
        if p.name != profile {
            return Err(NativeError::new("PROFILE_CHANGED", "The active profile changed"));
        }
        let me = Arc::clone(self);
        // sync command ของ Tauri รันบน main thread ซึ่งไม่มี Tokio context — tokio::spawn ตรงนี้ panic (และ abort แอป)
        let handle = tauri::async_runtime::spawn(async move { me.run_stream(p, after).await });
        self.replace_stream(Some((profile.to_string(), handle.inner().abort_handle())));
        Ok(())
    }

    pub fn events_unsubscribe(&self) {
        self.replace_stream(None);
    }

    fn emit_events(&self, profile: &str, kind: &str, data: Value) {
        self.sink.emit(EVENTS_EVENT, json!({ "profile": profile, "type": kind, "data": data }));
    }

    async fn run_stream(self: Arc<Self>, p: crate::profiles::Profile, mut position: Option<u64>) {
        let client = stream_client();
        let mut backoff = Duration::from_secs(1);
        let mut refreshed_after_401 = false;
        loop {
            let (origin, token) = match self.endpoint(&p, backoff > Duration::from_secs(1) && p.local.is_some()).await {
                Ok(t) => t,
                Err(e) if e.code == "NOT_SIGNED_IN" => return self.emit_events(&p.name, "unauthorized", json!({})),
                Err(_) => {
                    self.emit_events(&p.name, "disconnected", json!({ "retryInMs": backoff.as_millis() as u64 }));
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                    continue;
                }
            };
            let mut req = client
                .get(format!("{}{}/events", origin, CLIENT_API_PREFIX))
                .bearer_auth(&token)
                .header("accept", "text/event-stream")
                .header("alice-client-api", CLIENT_API_VERSION.to_string())
                .header("alice-client", CLIENT_NAME);
            if let Some(pos) = position {
                req = req.header("last-event-id", pos.to_string());
            }
            let end = match req.send().await {
                Ok(res) if res.status().as_u16() == 401 => StreamEnd::Unauthorized,
                Ok(res) if res.status().is_success() => {
                    backoff = Duration::from_secs(1);
                    refreshed_after_401 = false;
                    self.read_stream(&p.name, res, &mut position).await
                }
                _ => StreamEnd::Disconnected,
            };
            match end {
                StreamEnd::Unauthorized => {
                    // access อาจหมดอายุเฉย ๆ: refresh หนึ่งครั้ง ถ้าไม่ได้ = session ถูก revoke
                    if !refreshed_after_401 && self.endpoint(&p, true).await.is_ok() {
                        refreshed_after_401 = true;
                        continue;
                    }
                    self.emit_events(&p.name, "unauthorized", json!({}));
                    self.sink.emit(AUTH_EVENT, json!({ "profile": p.name, "status": "signed_out", "reason": "revoked" }));
                    return;
                }
                StreamEnd::Disconnected => {
                    self.emit_events(&p.name, "disconnected", json!({ "retryInMs": backoff.as_millis() as u64 }));
                    tokio::time::sleep(backoff).await;
                    backoff = (backoff * 2).min(MAX_BACKOFF);
                }
            }
        }
    }

    async fn read_stream(&self, profile: &str, res: reqwest::Response, position: &mut Option<u64>) -> StreamEnd {
        let mut parser = SseParser::default();
        let mut body = res.bytes_stream();
        loop {
            let chunk = match tokio::time::timeout(IDLE_TIMEOUT, body.next()).await {
                Ok(Some(Ok(bytes))) => bytes,
                _ => return StreamEnd::Disconnected,
            };
            for frame in parser.push(&String::from_utf8_lossy(&chunk)) {
                let data: Value = serde_json::from_str(&frame.data).unwrap_or(Value::Null);
                match frame.event.as_str() {
                    "ready" | "reset" | "invalidate" => {
                        if let Some(pos) = data["position"].as_u64() {
                            *position = Some(pos);
                        }
                        self.emit_events(profile, &frame.event, data);
                    }
                    "unauthorized" => return StreamEnd::Unauthorized,
                    _ => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frames_across_chunks() {
        let mut p = SseParser::default();
        assert!(p.push("retry: 3000\n\nid: 4\nevent: ready\ndata: {\"position\":4}\n").is_empty());
        let frames = p.push("\n: keep-alive\n\nid: 5\nevent: inval");
        assert_eq!(frames, vec![Frame { event: "ready".into(), data: "{\"position\":4}".into(), id: Some("4".into()) }]);
        let frames = p.push("idate\r\ndata: {\"position\":5}\r\n\r\n");
        assert_eq!(frames[0].event, "invalidate");
        assert_eq!(frames[0].id.as_deref(), Some("5"));
    }
}
