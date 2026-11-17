//! Native boundary tests: the Rust core against a real Alice Server and SQLite database.

mod support;

use alice_desktop::credentials::account;
use serde_json::json;
use std::collections::HashMap;
use std::time::Duration;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn desktop_core_profiles_login_requests_and_revocation() {
    let server = start_server();
    let owner = Human::bootstrap(&server.url).await;
    let h = harness();
    let core = &h.core;

    // HTTPS by default; loopback HTTP accepted and flagged insecure
    assert_eq!(core.profile_add("prod", "http://alice.example.com", false, true).unwrap_err().code, "INVALID_REQUEST");
    let view = core.profile_add("work", &server.url, false, true).unwrap();
    assert_eq!(view.active.as_deref(), Some("work"));
    assert!(view.profiles[0].profile.insecure);

    let test = core.profile_test("work").await.unwrap();
    assert!(test.compatible);
    assert_eq!(test.tls, "none");

    // ยังไม่ได้ login → ไม่มี credential และ request ถูกปฏิเสธในฝั่ง native
    let headers = HashMap::new();
    let err = core.api_request("work", "GET", "/tasks", &[], None, &headers).await.unwrap_err();
    assert_eq!(err.code, "NOT_SIGNED_IN");

    let actor = sign_in(&h, "work", &owner).await;
    assert_eq!(actor["actor"]["displayName"], "Olivia Owner");
    assert_eq!(h.opened.lock().unwrap().len(), 1, "verification page opened in the system browser");
    assert!(h.opened.lock().unwrap()[0].starts_with(&format!("{}/device?code=", server.url)));

    let acct = account("work", &server.url);
    let refresh = h.store.0.lock().unwrap().get(&acct).cloned().unwrap();
    assert!(refresh.starts_with("alice_cr_"));
    let profiles_file = std::fs::read_to_string(h.dir.path().join("profiles.json")).unwrap();
    assert!(!profiles_file.contains("alice_cr_") && !profiles_file.contains("alice_ca_"));
    // payload ของ event ไม่มี credential
    assert!(!format!("{:?}", h.events.0.lock().unwrap()).contains("alice_c"));

    let me = core.api_request("work", "GET", "/auth/me", &[], None, &headers).await.unwrap();
    assert_eq!(me.status, 200);
    assert_eq!(me.data["via"], "client");
    let created = core.api_request("work", "POST", "/tasks", &[], Some(json!({ "title": "From Desktop" })), &headers).await.unwrap();
    assert_eq!(created.status, 201);
    assert_eq!(created.data["task"]["createdBy"]["kind"], "human");

    // idempotency key ผ่าน native layer ได้ ส่วน header อื่นถูกตัดทิ้ง
    let mut idem = HashMap::new();
    idem.insert("Idempotency-Key".to_string(), "desktop-key-0001".to_string());
    idem.insert("Authorization".to_string(), "Bearer forged".to_string());
    let a = core.api_request("work", "POST", "/tasks", &[], Some(json!({ "title": "Once" })), &idem).await.unwrap();
    let b = core.api_request("work", "POST", "/tasks", &[], Some(json!({ "title": "Once" })), &idem).await.unwrap();
    assert_eq!(a.data, b.data);

    // the WebView cannot reach native-only endpoints or other profiles
    assert_eq!(core.api_request("work", "POST", "/device/token", &[], None, &headers).await.unwrap_err().code, "INVALID_REQUEST");
    assert_eq!(core.api_request("work", "GET", "/../api/tasks", &[], None, &headers).await.unwrap_err().code, "INVALID_REQUEST");
    assert_eq!(core.api_request("other", "GET", "/tasks", &[], None, &headers).await.unwrap_err().code, "PROFILE_CHANGED");

    // refresh rotates the stored credential
    let p = core.active_profile().unwrap();
    core.access_token(&p, true).await.unwrap();
    let rotated = h.store.0.lock().unwrap().get(&acct).cloned().unwrap();
    assert_ne!(rotated, refresh);
    assert_eq!(core.api_request("work", "GET", "/tasks", &[], None, &headers).await.unwrap().status, 200);

    // a second profile has its own session
    core.profile_add("admin", &server.url, false, false).unwrap();
    core.profile_use("admin").unwrap();
    sign_in(&h, "admin", &owner).await;
    assert_eq!(core.api_request("admin", "GET", "/tasks", &[], None, &headers).await.unwrap().status, 200);
    assert!(h.events.0.lock().unwrap().iter().any(|(e, v)| e == "alice://profile" && v["active"] == "admin"));

    // revocation from the web dashboard → next request is refused and the local credential is gone
    let sessions = owner.get("/client/v1/client-sessions").await;
    let admin_session = core.profiles_list().profiles.iter().find(|p| p.profile.name == "admin").unwrap().profile.session.clone().unwrap().id;
    assert!(sessions["items"].as_array().unwrap().iter().any(|s| s["id"] == admin_session.as_str()));
    let (status, _) = owner.post(&format!("/client/v1/client-sessions/{admin_session}/revoke"), json!({})).await;
    assert_eq!(status, 200);
    let err = core.api_request("admin", "GET", "/tasks", &[], None, &headers).await.unwrap_err();
    assert_eq!(err.code, "NOT_SIGNED_IN");
    assert!(h.store.0.lock().unwrap().get(&account("admin", &server.url)).is_none());
    h.events.wait_for(|e, v| e == "alice://auth" && v["profile"] == "admin" && v["status"] == "signed_out" && v["reason"] == "revoked", Duration::from_secs(2)).await;

    // the work profile is untouched; logging it out revokes its server session
    core.profile_use("work").unwrap();
    assert_eq!(core.api_request("work", "GET", "/tasks", &[], None, &headers).await.unwrap().status, 200);
    assert!(core.logout("work").await.unwrap());
    let all = owner.get("/client/v1/client-sessions?include=all").await;
    let work_session = all["items"].as_array().unwrap().iter().filter(|s| s["clientKind"] == "desktop").all(|s| !s["revokedAt"].is_null());
    assert!(work_session, "every desktop session revoked");

    // removing a profile deletes it and its credential
    let view = core.profile_remove("admin").await.unwrap();
    assert!(view.profiles.iter().all(|p| p.profile.name != "admin"));
}

#[tokio::test(flavor = "multi_thread")]
async fn denied_sign_in_is_reported_without_credentials() {
    let server = start_server();
    let owner = Human::bootstrap(&server.url).await;
    let h = harness();
    h.core.profile_add("work", &server.url, false, true).unwrap();
    let started = h.core.login_start("work").await.unwrap();
    let (status, _) = owner.post("/client/v1/device/deny", json!({ "userCode": started.user_code })).await;
    assert_eq!(status, 200);
    let ev = h.events.wait_for(|e, v| e == "alice://auth" && v["status"] != "pending", Duration::from_secs(15)).await;
    assert_eq!(ev["status"], "denied");
    assert!(h.store.0.lock().unwrap().is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn unreachable_and_incompatible_servers_fail_safely() {
    let h = harness();
    h.core.profile_add("down", "http://127.0.0.1:1", false, true).unwrap();
    let err = h.core.profile_test("down").await.unwrap_err();
    assert_eq!(err.code, "NETWORK_ERROR");
    let err = h.core.login_start("down").await.unwrap_err();
    assert_eq!(err.code, "NETWORK_ERROR");
}
