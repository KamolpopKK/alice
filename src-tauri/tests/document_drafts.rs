//! Closing or quitting with unsaved document drafts: hold, ask once, run a confirmed action once.

use alice_desktop::drafts::{Decision, LeaveAction, LeaveGuard, ReplyError};

fn asked(d: Decision) -> String {
    match d {
        Decision::Ask(r) => r.request_id,
        other => panic!("expected a question, got {other:?}"),
    }
}

#[test]
fn clean_close_and_quit_go_straight_through() {
    let g = LeaveGuard::new();
    assert_eq!(g.request(LeaveAction::Close), Decision::Proceed);
    assert_eq!(g.request(LeaveAction::Exit), Decision::Proceed);
}

#[test]
fn a_dirty_close_waits_for_one_answer_and_stay_keeps_the_window() {
    let g = LeaveGuard::new();
    g.set_dirty(true);
    let id = asked(g.request(LeaveAction::Close));
    // อีกครั้งระหว่างรอ: ไม่ถามซ้ำ
    assert_eq!(g.request(LeaveAction::Close), Decision::Wait);
    assert_eq!(g.request(LeaveAction::Exit), Decision::Wait);
    assert_eq!(g.reply(&id, false), Ok(None));
    assert!(g.is_dirty());
    // ตอบซ้ำด้วย id เดิม: ปฏิเสธ
    assert_eq!(g.reply(&id, true), Err(ReplyError::UnknownRequest));
    // ปิดใหม่: ถามใหม่ด้วย id ใหม่
    let again = asked(g.request(LeaveAction::Close));
    assert_ne!(again, id);
}

#[test]
fn discard_runs_the_held_action_once_without_asking_again() {
    let g = LeaveGuard::new();
    g.set_dirty(true);
    let id = asked(g.request(LeaveAction::Exit));
    assert_eq!(g.reply(&id, true), Ok(Some(LeaveAction::Exit)));
    assert!(!g.is_dirty());
    // app.exit ที่ตามมา: ผ่านเลย ไม่ถามซ้ำ (และหน้าต่างที่ถูกปิดระหว่าง quit ก็ผ่าน)
    assert_eq!(g.request(LeaveAction::Close), Decision::Proceed);
    assert_eq!(g.request(LeaveAction::Exit), Decision::Proceed);
    // คำตอบเดิมส่งมาซ้ำ: ไม่ทำ action อีก
    assert_eq!(g.reply(&id, true), Err(ReplyError::UnknownRequest));
}

#[test]
fn stale_or_forged_replies_never_run_an_action() {
    let g = LeaveGuard::new();
    assert_eq!(g.reply("leave-1-1", true), Err(ReplyError::UnknownRequest));
    g.set_dirty(true);
    let id = asked(g.request(LeaveAction::Close));
    assert_eq!(g.reply("leave-forged", true), Err(ReplyError::UnknownRequest));
    // บันทึกแล้ว (ไม่ dirty): คำถามที่ค้างหมดความหมาย
    g.set_dirty(false);
    assert_eq!(g.reply(&id, true), Err(ReplyError::UnknownRequest));
    assert_eq!(g.request(LeaveAction::Close), Decision::Proceed);
}

#[test]
fn the_webview_can_call_only_the_two_new_commands_from_the_main_window() {
    let capability: serde_json::Value = serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
    assert_eq!(capability["windows"], serde_json::json!(["main"]));
    let permissions: Vec<&str> = capability["permissions"].as_array().unwrap().iter().map(|p| p.as_str().unwrap()).collect();
    for p in ["allow-editor-dirty-set", "allow-editor-leave-reply"] {
        assert!(permissions.contains(&p), "{p}");
    }
    // ไม่มีสิทธิ์ทั่วไปของ window/shell/fs เพิ่มเข้ามา
    assert!(permissions.iter().all(|p| !p.starts_with("core:window") && !p.starts_with("shell:") && !p.starts_with("fs:")));
    let build = include_str!("../build.rs");
    assert!(build.contains("\"editor_dirty_set\"") && build.contains("\"editor_leave_reply\""));
}
