//! Live invalidation stream owned by the Rust core: delivery, reconnect with resume, reset and revocation.

mod support;

use serde_json::json;
use std::time::Duration;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn stream_delivers_resumes_resets_and_stops_on_revocation() {
    let data = tempfile::tempdir().unwrap();
    let server = start_server_at(data.path(), 0);
    let port: u16 = server.url.rsplit(':').next().unwrap().parse().unwrap();
    let owner = Human::bootstrap(&server.url).await;
    let h = harness();
    h.core.profile_add("work", &server.url, false, true).unwrap();
    sign_in(&h, "work", &owner).await;

    // แบบเดียวกับ Tauri: sync command รันบน main thread ที่ไม่มี Tokio context
    let core = h.core.clone();
    std::thread::spawn(move || core.events_subscribe("work", None)).join().expect("subscribe must not panic outside a Tokio runtime").unwrap();
    let ready = h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "ready", Duration::from_secs(5)).await;
    assert_eq!(ready["profile"], "work");

    let (_, created) = owner.post("/client/v1/tasks", json!({ "title": "Live one" })).await;
    let id = created["task"]["id"].as_str().unwrap().to_string();
    let ev = h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "invalidate" && v["data"]["id"] == id.as_str(), Duration::from_secs(5)).await;
    assert_eq!(ev["data"]["kind"], "task");
    assert_eq!(ev["data"]["mutation"], "task.created");
    // event ไม่มีข้อมูลจริงของ resource
    assert!(ev["data"].get("title").is_none());

    // server หยุด → disconnected; กลับมาที่ port เดิม → resume ต่อจากตำแหน่งเดิม (ไม่ reset)
    drop(server);
    h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "disconnected", Duration::from_secs(10)).await;
    let server = start_server_at(data.path(), port);
    let (_, after) = owner.post("/client/v1/tasks", json!({ "title": "After restart" })).await;
    let id2 = after["task"]["id"].as_str().unwrap().to_string();
    h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "invalidate" && v["data"]["id"] == id2.as_str(), Duration::from_secs(20)).await;
    assert!(!h.events.0.lock().unwrap().iter().any(|(e, v)| e == "alice://events" && v["type"] == "reset"));

    // ตำแหน่งที่ server ไม่รู้จัก → reset อย่างชัดเจน
    h.core.events_subscribe("work", Some(10_000_000)).unwrap();
    let reset = h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "reset", Duration::from_secs(5)).await;
    assert_eq!(reset["data"]["reason"], "position_ahead_of_server");

    // ห้าม subscribe ให้ profile ที่ไม่ได้ active
    assert_eq!(h.core.events_subscribe("other", None).unwrap_err().code, "PROFILE_CHANGED");

    // revoke จากเว็บ → stream แจ้ง unauthorized และ UI กลับไปหน้า sign-in
    let session = h.core.profiles_list().profiles[0].profile.session.clone().unwrap().id;
    owner.post(&format!("/client/v1/client-sessions/{session}/revoke"), json!({})).await;
    h.events.wait_for(|e, v| e == "alice://events" && v["type"] == "unauthorized", Duration::from_secs(10)).await;
    h.events.wait_for(|e, v| e == "alice://auth" && v["status"] == "signed_out", Duration::from_secs(5)).await;
    drop(server);
}
