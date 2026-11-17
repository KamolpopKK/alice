//! Deep links never navigate on malformed input and never substitute another profile.

mod support;

use support::*;

#[test]
fn deep_links_resolve_only_to_the_named_profile() {
    let h = harness();
    let core = &h.core;
    core.profile_add("work", "https://alice.example.com", false, true).unwrap();
    core.profile_add("staging", "https://staging.example.com", false, false).unwrap();
    let count = |kind: &str| h.events.0.lock().unwrap().iter().filter(|(e, v)| e == "alice://deeplink" && v["status"] == kind).count();

    assert_eq!(core.handle_deep_link("alice://open/task/tsk_abcd1234?profile=work&server=https://evil.example"), "rejected");
    assert_eq!(core.handle_deep_link("alice://open/task/tsk_abcd1234?profile=nope"), "unknown_profile");
    assert_eq!(count("rejected"), 1);
    assert_eq!(count("unknown_profile"), 1);
    // ไม่มีการเปลี่ยน profile และไม่มีลิงก์ค้างให้ navigate
    assert_eq!(core.active_profile().unwrap().name, "work");
    assert!(core.deeplink_take().is_none());

    // ลิงก์ไปยัง profile อื่นที่รู้จัก → เปลี่ยน profile ก่อน แล้วจึงให้ UI navigate
    assert_eq!(core.handle_deep_link("alice://open/document/doc_abcd1234?profile=staging"), "accepted");
    assert_eq!(core.active_profile().unwrap().name, "staging");
    assert!(h.events.0.lock().unwrap().iter().any(|(e, v)| e == "alice://profile" && v["active"] == "staging"));
    let taken = core.deeplink_take().unwrap();
    assert_eq!(taken["path"], "/documents/doc_abcd1234");
    assert!(core.deeplink_take().is_none(), "taken once");

    // ถ้าผู้ใช้เปลี่ยน profile ก่อน UI มารับลิงก์ ลิงก์จะไม่ถูกส่งไปยัง profile อื่น
    core.handle_deep_link("alice://open/task/tsk_abcd1234?profile=work");
    core.profile_use("staging").unwrap();
    assert!(core.deeplink_take().is_none());
}
