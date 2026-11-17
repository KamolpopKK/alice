//! Local workspaces through the native core: first run, activation of a real
//! daemon, isolation between workspaces, deep links, capture intents and the event stream.

mod support;

use alice_desktop::shortcuts::CaptureIntent;
use serde_json::json;
use std::time::Duration;
use support::*;

#[tokio::test(flavor = "multi_thread")]
async fn local_workspaces_activate_switch_and_stay_isolated() {
    let h = local_harness();
    let core = &h.core;
    assert!(core.profiles_list().local_available);

    // ครั้งแรก: Personal ถูกสร้างครั้งเดียวและเป็น workspace ที่ active ของ Desktop
    let view = core.local_first_run().await.unwrap();
    let personal = view.active.clone().unwrap();
    assert!(personal.starts_with("wsp_"));
    assert_eq!(core.local_first_run().await.unwrap().profiles.iter().filter(|p| p.profile.local.is_some()).count(), 1);
    let test = core.profile_test(&personal).await.unwrap();
    assert!(test.compatible);
    assert_eq!(test.tls, "local");
    assert_eq!(core.login_start(&personal).await.unwrap_err().code, "LOCAL_WORKSPACE");

    let created = core.api_request(&personal, "POST", "/tasks", &[], Some(json!({ "title": "Only in Personal" })), &Default::default()).await.unwrap();
    assert_eq!(created.status, 201, "{}", created.data);
    core.owner_rename("Kim").await.unwrap();

    core.events_subscribe(&personal, None).unwrap();
    h.events.wait_for(|e, v| e == "alice://events" && v["profile"] == personal.as_str() && v["type"] == "ready", Duration::from_secs(20)).await;

    // workspace ที่สอง: สลับแล้ว capture ที่ค้างของ workspace เดิมถูกทิ้ง และข้อมูลไม่รั่ว
    core.capture_intent(CaptureIntent::NewPad);
    let side = core.workspace_create("Side").await.unwrap().active.unwrap();
    assert_ne!(side, personal);
    assert!(core.capture_take().is_none());
    core.profile_test(&side).await.unwrap();
    let list = core.api_request(&side, "GET", "/tasks", &[], None, &Default::default()).await.unwrap();
    assert_eq!(list.data["items"].as_array().unwrap().len(), 0, "{}", list.data);
    let stale = core.api_request(&personal, "GET", "/tasks", &[], None, &Default::default()).await.unwrap_err();
    assert_eq!(stale.code, "PROFILE_CHANGED");

    // ชื่อซ้ำได้ แต่ alias ไม่ซ้ำ และไม่ชนกับชื่อ Remote profile
    core.workspace_rename(&side, "Personal").await.unwrap();
    core.profile_add("team", "https://alice.example.com", false, false).unwrap();
    assert!(core.workspace_alias(&side, "team").await.is_err());
    core.workspace_alias(&side, "hobby").await.unwrap();
    let names: Vec<_> = core.profiles_list().profiles.iter().filter_map(|p| p.profile.local.clone()).map(|l| (l.display_name, l.alias)).collect();
    assert!(names.contains(&("Personal".into(), "personal".into())) && names.contains(&("Personal".into(), "hobby".into())), "{names:?}");

    // deep link: id ที่ไม่รู้จักไม่ fallback; id ที่รู้จักเลือก workspace ก่อน
    assert_eq!(core.handle_deep_link("alice://open/task/tsk_abcd1234?workspace=wsp_unknown00000000"), "unknown_workspace");
    assert_eq!(core.active_profile().unwrap().name, side);
    let task = created.data["task"]["id"].as_str().or(created.data["id"].as_str()).unwrap().to_string();
    assert_eq!(core.handle_deep_link(&format!("alice://open/task/{task}?workspace={personal}")), "accepted");
    assert_eq!(core.active_profile().unwrap().name, personal);
    assert_eq!(core.deeplink_take().unwrap()["path"], format!("/tasks/{task}"));
    let shown = core.api_request(&personal, "GET", &format!("/tasks/{task}"), &[], None, &Default::default()).await.unwrap();
    assert_eq!(shown.status, 200);
    assert!(shown.data.to_string().contains("Kim"), "owner name from onboarding: {}", shown.data);

    // capability ไม่ถูกเก็บในไฟล์ของ Desktop
    let mut desktop_files = String::new();
    for entry in walk(&h.dir.path().join("config")) {
        desktop_files.push_str(&std::fs::read_to_string(entry).unwrap_or_default());
    }
    assert!(!desktop_files.contains("alice_lc_"));
    stop_local_daemons(&h);
}

fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let p = entry.path();
        if p.is_dir() { out.extend(walk(&p)) } else { out.push(p) }
    }
    out
}
