//! Task Pad capture shortcuts: registration status, conflicts, persistence across restarts, and
//! capture intents that wait for sign-in and are handed to the UI exactly once.

mod support;

use alice_desktop::shortcuts::{CaptureIntent, ShortcutBackend, Shortcuts, ShortcutsInput};
use std::sync::{Arc, Mutex};
use support::*;

/// Records registrations; accelerators listed in `taken` fail like an OS conflict.
#[derive(Default, Clone)]
struct FakeBackend {
    registered: Arc<Mutex<Vec<String>>>,
    taken: Arc<Mutex<Vec<String>>>,
}

impl ShortcutBackend for FakeBackend {
    fn register(&self, accelerator: &str) -> Result<u32, String> {
        if self.taken.lock().unwrap().iter().any(|t| t == accelerator) {
            return Err("HotKey already registered".into());
        }
        let mut list = self.registered.lock().unwrap();
        list.push(accelerator.to_string());
        Ok(list.len() as u32)
    }
    fn unregister_all(&self) {
        self.registered.lock().unwrap().clear();
    }
}

fn input(enabled: bool, open_last: &str, new_pad: &str) -> ShortcutsInput {
    serde_json::from_value(serde_json::json!({ "enabled": enabled, "openLast": open_last, "newPad": new_pad })).unwrap()
}

#[test]
fn macos_defaults_register_option_space_and_option_shift_space() {
    let dir = tempfile::tempdir().unwrap();
    let backend = FakeBackend::default();
    let s = Shortcuts::new(dir.path().to_path_buf(), "macos", Box::new(backend.clone()));
    let view = s.view();
    assert_eq!((view.open_last.as_str(), view.new_pad.as_str()), ("Alt+Space", "Alt+Shift+Space"));
    assert_eq!(view.status["openLast"].state, "registered");
    assert_eq!(view.status["newPad"].state, "registered");
    assert_eq!(*backend.registered.lock().unwrap(), vec!["Alt+Space", "Alt+Shift+Space"]);
    assert_eq!(s.intent_for(1), Some(CaptureIntent::OpenLast));
    assert_eq!(s.intent_for(2), Some(CaptureIntent::NewPad));
    assert_eq!(s.intent_for(99), None);
}

#[test]
fn other_platforms_use_safe_defaults_and_never_take_reserved_keys() {
    for platform in ["windows", "linux"] {
        let dir = tempfile::tempdir().unwrap();
        let backend = FakeBackend::default();
        let s = Shortcuts::new(dir.path().to_path_buf(), platform, Box::new(backend.clone()));
        assert_eq!(s.view().open_last, "Ctrl+Alt+Space");
        assert_eq!(s.view().status["openLast"].state, "registered");
        // Alt+Space เปิดเมนูหน้าต่าง: บันทึกได้แต่ไม่ลงทะเบียน และบอกเหตุผล
        let view = s.update(input(true, "Alt+Space", "Ctrl+Alt+N")).unwrap();
        assert_eq!(view.status["openLast"].state, "reserved");
        assert!(view.status["openLast"].message.as_deref().unwrap().contains("window menu"));
        assert_eq!(view.status["newPad"].state, "registered");
        assert_eq!(*backend.registered.lock().unwrap(), vec!["Ctrl+Alt+N"]);
    }
}

#[test]
fn conflicts_and_invalid_input_are_visible_and_recoverable() {
    let dir = tempfile::tempdir().unwrap();
    let backend = FakeBackend::default();
    backend.taken.lock().unwrap().push("Alt+Shift+Space".into());
    let s = Shortcuts::new(dir.path().to_path_buf(), "macos", Box::new(backend.clone()));
    let status = &s.view().status["newPad"];
    assert_eq!(status.state, "conflict");
    assert!(status.message.as_deref().unwrap().contains("Another app may already use it"));
    assert_eq!(s.view().status["openLast"].state, "registered");

    let err = s.update(input(true, "Space", "Alt+Shift+N")).unwrap_err();
    assert_eq!(err.code, "VALIDATION_ERROR");
    assert!(s.update(input(true, "Alt+N", "option+n")).is_err(), "duplicates are refused");
    // เปลี่ยนเป็นคีย์อื่น → ใช้งานได้
    let fixed = s.update(input(true, "Alt+Space", "Alt+Shift+N")).unwrap();
    assert_eq!(fixed.status["newPad"].state, "registered");
}

#[test]
fn changing_or_disabling_shortcuts_survives_restart() {
    let dir = tempfile::tempdir().unwrap();
    let backend = FakeBackend::default();
    let s = Shortcuts::new(dir.path().to_path_buf(), "macos", Box::new(backend.clone()));
    s.update(input(false, "ctrl+alt+p", "ctrl+alt+shift+p")).unwrap();
    assert!(backend.registered.lock().unwrap().is_empty(), "disabled shortcuts are unregistered");
    drop(s);

    let again = FakeBackend::default();
    let restarted = Shortcuts::new(dir.path().to_path_buf(), "macos", Box::new(again.clone()));
    let view = restarted.view();
    assert!(!view.enabled);
    assert_eq!(view.open_last, "Ctrl+Alt+P");
    assert_eq!(view.status["openLast"].state, "disabled");
    assert!(again.registered.lock().unwrap().is_empty());

    let enabled = restarted.update(input(true, &view.open_last, &view.new_pad)).unwrap();
    assert_eq!(enabled.status["openLast"].state, "registered");
    let reset = restarted.reset().unwrap();
    assert_eq!(reset.open_last, "Alt+Space");
}

#[test]
fn capture_intents_wait_for_the_ui_and_are_taken_exactly_once() {
    let h = harness();
    // ยังไม่มี profile / ยังไม่ sign in: intent ถูกเก็บไว้ ไม่หาย
    let first = h.core.capture_intent(CaptureIntent::NewPad);
    let second = h.core.capture_intent(CaptureIntent::NewPad);
    assert!(second > first);
    let emitted: Vec<_> = h.events.0.lock().unwrap().iter().filter(|(e, _)| e == "alice://capture").map(|(_, v)| v.clone()).collect();
    assert_eq!(emitted.len(), 2);
    assert_eq!(emitted[1]["intent"], "new-pad");
    // กดซ้ำระหว่างรอ = ได้ Pad ใหม่เพียงหนึ่งเดียวเมื่อ UI พร้อม
    let taken = h.core.capture_take().unwrap();
    assert_eq!(taken["id"], second);
    assert_eq!(taken["intent"], "new-pad");
    assert!(h.core.capture_take().is_none(), "taken once");
    h.core.capture_intent(CaptureIntent::OpenLast);
    assert_eq!(h.core.capture_take().unwrap()["intent"], "open-last");
}
