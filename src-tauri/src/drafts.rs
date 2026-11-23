//! Unsaved document drafts and closing the app.
//!
//! The WebView tells the core only whether any document has unsaved changes (`editor_dirty_set`), never
//! the content. When the person closes the main window or quits while that flag is set, the core holds
//! the action and asks the WebView (`alice://editor-leave-requested`). The WebView shows its own dialog
//! and replies (`editor_leave_reply`) with the same request id: Stay drops the held action, Discard runs
//! it exactly once. Replies with an unknown or already answered id are rejected.

use serde::Serialize;
use std::sync::Mutex;

pub const LEAVE_EVENT: &str = "alice://editor-leave-requested";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LeaveAction {
    Close,
    Exit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LeaveRequest {
    pub request_id: String,
    pub action: LeaveAction,
}

/// What the window or app should do with a close/quit that just arrived.
#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    /// Nothing unsaved, or the person already chose Discard: let it happen.
    Proceed,
    /// Hold it and ask the WebView with this request.
    Ask(LeaveRequest),
    /// A question is already open: hold it and do not ask again.
    Wait,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ReplyError {
    /// No question with this id is open (never asked, already answered or replaced).
    UnknownRequest,
}

#[derive(Default)]
struct State {
    dirty: bool,
    pending: Option<LeaveRequest>,
    /// An action the person confirmed; the next matching close/quit goes through without asking.
    approved: Option<LeaveAction>,
    next: u64,
}

#[derive(Default)]
pub struct LeaveGuard {
    state: Mutex<State>,
}

impl LeaveGuard {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn set_dirty(&self, dirty: bool) {
        let mut s = self.state.lock().unwrap();
        s.dirty = dirty;
        if !dirty {
            // ไม่มีอะไรค้างแล้ว: คำถามที่เปิดอยู่ไม่มีความหมาย
            s.pending = None;
        }
    }

    pub fn is_dirty(&self) -> bool {
        self.state.lock().unwrap().dirty
    }

    pub fn request(&self, action: LeaveAction) -> Decision {
        let mut s = self.state.lock().unwrap();
        if s.approved == Some(action) || (action == LeaveAction::Close && s.approved == Some(LeaveAction::Exit)) {
            if action == s.approved.unwrap() {
                s.approved = None;
            }
            return Decision::Proceed;
        }
        if !s.dirty {
            return Decision::Proceed;
        }
        if s.pending.is_some() {
            return Decision::Wait;
        }
        s.next += 1;
        let request = LeaveRequest { request_id: format!("leave-{}-{}", std::process::id(), s.next), action };
        s.pending = Some(request.clone());
        Decision::Ask(request)
    }

    /// Answers the open question. `Ok(Some(action))` means run that action now (once).
    pub fn reply(&self, request_id: &str, discard: bool) -> Result<Option<LeaveAction>, ReplyError> {
        let mut s = self.state.lock().unwrap();
        match &s.pending {
            Some(p) if p.request_id == request_id => {
                let action = p.action;
                s.pending = None;
                if discard {
                    s.dirty = false;
                    s.approved = Some(action);
                    Ok(Some(action))
                } else {
                    Ok(None)
                }
            }
            _ => Err(ReplyError::UnknownRequest),
        }
    }
}
