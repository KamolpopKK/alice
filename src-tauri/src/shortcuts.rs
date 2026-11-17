//! Configurable global capture shortcuts for Task Pads. The OS-level registration sits
//! behind `ShortcutBackend` so validation, conflict handling and persistence are testable without a
//! window system. Preferences belong to this Desktop installation (config dir), not to the server.

use crate::error::{NativeError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureIntent {
    /// Focus Alice, open the most recent Pad and focus a fresh capture line.
    OpenLast,
    /// Focus Alice, create a date-and-time Pad and focus its first Task line.
    NewPad,
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(windows) {
        "windows"
    } else {
        "linux"
    }
}

/// Platform defaults: Option+Space / Option+Shift+Space on macOS; Alt+Space opens the window menu on
/// Windows and many Linux desktops, so those platforms use Ctrl+Alt instead.
pub fn defaults_for(platform: &str) -> (&'static str, &'static str) {
    match platform {
        "macos" => ("Alt+Space", "Alt+Shift+Space"),
        _ => ("Ctrl+Alt+Space", "Ctrl+Alt+Shift+Space"),
    }
}

const MODIFIERS: [&str; 4] = ["Ctrl", "Alt", "Shift", "Super"];

fn modifier(token: &str) -> Option<&'static str> {
    match token.to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some("Ctrl"),
        "alt" | "option" | "opt" => Some("Alt"),
        "shift" => Some("Shift"),
        "super" | "cmd" | "command" | "meta" | "win" => Some("Super"),
        _ => None,
    }
}

fn key(token: &str) -> Option<String> {
    let t = token.trim();
    if t.len() == 1 && t.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Some(t.to_ascii_uppercase());
    }
    let lower = t.to_ascii_lowercase();
    match lower.as_str() {
        "space" => return Some("Space".into()),
        "enter" | "return" => return Some("Enter".into()),
        "period" | "." => return Some("Period".into()),
        "comma" | "," => return Some("Comma".into()),
        "slash" | "/" => return Some("Slash".into()),
        "semicolon" | ";" => return Some("Semicolon".into()),
        "quote" | "'" => return Some("Quote".into()),
        "backquote" | "`" => return Some("Backquote".into()),
        _ => {}
    }
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&n) {
            return Some(format!("F{n}"));
        }
    }
    if let Some(c) = lower.strip_prefix("key").filter(|c| c.len() == 1) {
        return key(c);
    }
    if let Some(d) = lower.strip_prefix("digit").filter(|d| d.len() == 1) {
        return key(d);
    }
    None
}

/// Canonical accelerator, e.g. `alt+shift+space` → `Alt+Shift+Space`. Requires at least one
/// modifier other than Shift (a bare or Shift-only key would steal ordinary typing system-wide).
pub fn normalize(raw: &str) -> std::result::Result<String, String> {
    let parts: Vec<&str> = raw.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
    if parts.is_empty() || raw.len() > 64 {
        return Err("Enter a shortcut such as Alt+Shift+Space".into());
    }
    let (last, mods) = parts.split_last().unwrap();
    let key = key(last).ok_or_else(|| format!("\"{last}\" is not a supported key"))?;
    let mut seen = Vec::new();
    for m in mods {
        let m = modifier(m).ok_or_else(|| format!("\"{m}\" is not a modifier (use Ctrl, Alt/Option, Shift or Cmd/Super)"))?;
        if !seen.contains(&m) {
            seen.push(m);
        }
    }
    if !seen.iter().any(|m| *m != "Shift") {
        return Err("A global shortcut needs Ctrl, Alt/Option or Cmd/Super so it never replaces normal typing".into());
    }
    let ordered: Vec<&str> = MODIFIERS.iter().copied().filter(|m| seen.contains(m)).collect();
    Ok(format!("{}+{key}", ordered.join("+")))
}

/// Combinations the operating system (or a screen reader) owns. Alice never takes these.
pub fn reserved_reason(platform: &str, canonical: &str) -> Option<&'static str> {
    let common: &[(&str, &str)] = &[("Alt+Tab", "switches applications"), ("Ctrl+Alt+Delete", "is reserved by the system"), ("Alt+F4", "closes windows")];
    let specific: &[(&str, &str)] = match platform {
        "macos" => &[
            ("Super+Space", "opens Spotlight"),
            ("Alt+Super+Space", "opens Finder search"),
            ("Ctrl+Space", "switches input sources"),
            ("Ctrl+Alt+Space", "switches input sources"),
            ("Super+Tab", "switches applications"),
            ("Super+Q", "quits applications"),
            ("Super+W", "closes windows"),
            ("Super+H", "hides applications"),
            ("Super+M", "minimizes windows"),
            ("Ctrl+Super+Q", "locks the screen"),
            ("Shift+Super+3", "takes screenshots"),
            ("Shift+Super+4", "takes screenshots"),
            ("Shift+Super+5", "takes screenshots"),
            ("Alt+Super+F5", "opens Accessibility Shortcuts"),
            ("Ctrl+Alt+F5", "is used by VoiceOver"),
            ("Super+F5", "toggles VoiceOver"),
        ],
        "windows" => &[
            ("Alt+Space", "opens the window menu"),
            ("Super+L", "locks the computer"),
            ("Super+D", "shows the desktop"),
            ("Super+Space", "switches input languages"),
            ("Ctrl+Shift+Escape", "opens Task Manager"),
            ("Ctrl+Alt+Enter", "is used by Narrator"),
            ("Ctrl+Super+Enter", "toggles Narrator"),
        ],
        _ => &[("Alt+Space", "opens the window menu"), ("Super+Space", "switches input sources"), ("Super+L", "locks the screen"), ("Ctrl+Alt+L", "locks the screen"), ("Ctrl+Alt+T", "opens a terminal"), ("Alt+Super+S", "toggles the Orca screen reader")],
    };
    common.iter().chain(specific).find(|(combo, _)| *combo == canonical).map(|(_, why)| *why)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutPrefs {
    pub enabled: bool,
    pub open_last: String,
    pub new_pad: String,
}

impl ShortcutPrefs {
    pub fn defaults(platform: &str) -> Self {
        let (open_last, new_pad) = defaults_for(platform);
        Self { enabled: true, open_last: open_last.into(), new_pad: new_pad.into() }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutStatus {
    /// `registered`, `disabled`, `reserved`, `conflict` or `failed`.
    pub state: &'static str,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsView {
    pub platform: &'static str,
    pub enabled: bool,
    pub open_last: String,
    pub new_pad: String,
    pub defaults: HashMap<&'static str, &'static str>,
    pub status: HashMap<&'static str, ShortcutStatus>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutsInput {
    pub enabled: bool,
    pub open_last: String,
    pub new_pad: String,
}

/// OS registration. `register` returns an id that the press handler reports back.
pub trait ShortcutBackend: Send + Sync {
    fn register(&self, accelerator: &str) -> std::result::Result<u32, String>;
    fn unregister_all(&self);
}

pub struct Shortcuts {
    path: PathBuf,
    platform: &'static str,
    backend: Box<dyn ShortcutBackend>,
    prefs: Mutex<ShortcutPrefs>,
    status: Mutex<HashMap<&'static str, ShortcutStatus>>,
    intents: Mutex<HashMap<u32, CaptureIntent>>,
}

impl Shortcuts {
    /// Loads saved preferences (or platform defaults) and registers them.
    pub fn new(config_dir: PathBuf, platform: &'static str, backend: Box<dyn ShortcutBackend>) -> Self {
        let path = config_dir.join("shortcuts.json");
        let prefs = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<ShortcutPrefs>(&bytes).ok())
            .unwrap_or_else(|| ShortcutPrefs::defaults(platform));
        let s = Self { path, platform, backend, prefs: Mutex::new(prefs), status: Mutex::new(HashMap::new()), intents: Mutex::new(HashMap::new()) };
        s.apply();
        s
    }

    pub fn view(&self) -> ShortcutsView {
        let prefs = self.prefs.lock().unwrap().clone();
        let (open_last, new_pad) = defaults_for(self.platform);
        ShortcutsView {
            platform: self.platform,
            enabled: prefs.enabled,
            open_last: prefs.open_last,
            new_pad: prefs.new_pad,
            defaults: HashMap::from([("openLast", open_last), ("newPad", new_pad)]),
            status: self.status.lock().unwrap().clone(),
        }
    }

    /// Validates, saves and re-registers. Reserved or conflicting combinations are saved but reported,
    /// so the user sees exactly why a shortcut is inactive and can change it.
    pub fn update(&self, input: ShortcutsInput) -> Result<ShortcutsView> {
        let open_last = normalize(&input.open_last).map_err(|m| NativeError::new("VALIDATION_ERROR", format!("Open last pad: {m}")))?;
        let new_pad = normalize(&input.new_pad).map_err(|m| NativeError::new("VALIDATION_ERROR", format!("New pad: {m}")))?;
        if open_last == new_pad {
            return Err(NativeError::new("VALIDATION_ERROR", "The two shortcuts must be different"));
        }
        let prefs = ShortcutPrefs { enabled: input.enabled, open_last, new_pad };
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| NativeError::new("INTERNAL_ERROR", format!("Could not save shortcuts: {e}")))?;
        }
        let bytes = serde_json::to_vec_pretty(&prefs).expect("prefs serialize");
        std::fs::write(&self.path, bytes).map_err(|e| NativeError::new("INTERNAL_ERROR", format!("Could not save shortcuts: {e}")))?;
        *self.prefs.lock().unwrap() = prefs;
        self.apply();
        Ok(self.view())
    }

    pub fn reset(&self) -> Result<ShortcutsView> {
        let d = ShortcutPrefs::defaults(self.platform);
        self.update(ShortcutsInput { enabled: true, open_last: d.open_last, new_pad: d.new_pad })
    }

    fn apply(&self) {
        self.backend.unregister_all();
        let prefs = self.prefs.lock().unwrap().clone();
        let mut status = HashMap::new();
        let mut intents = HashMap::new();
        for (name, accel, intent) in [("openLast", &prefs.open_last, CaptureIntent::OpenLast), ("newPad", &prefs.new_pad, CaptureIntent::NewPad)] {
            let result = if !prefs.enabled {
                ShortcutStatus { state: "disabled", message: None }
            } else if let Err(m) = normalize(accel) {
                ShortcutStatus { state: "failed", message: Some(m) }
            } else if let Some(why) = reserved_reason(self.platform, accel) {
                // ไม่แย่งคีย์ที่ระบบหรือ screen reader ใช้ ถึงแม้ OS จะยอมให้ลงทะเบียน
                ShortcutStatus { state: "reserved", message: Some(format!("{accel} {why} on this system. Choose another shortcut.")) }
            } else {
                match self.backend.register(accel) {
                    Ok(id) => {
                        intents.insert(id, intent);
                        ShortcutStatus { state: "registered", message: None }
                    }
                    Err(e) => ShortcutStatus {
                        state: "conflict",
                        message: Some(format!("{accel} could not be registered ({e}). Another app may already use it; choose another shortcut.")),
                    },
                }
            };
            status.insert(name, result);
        }
        *self.status.lock().unwrap() = status;
        *self.intents.lock().unwrap() = intents;
    }

    /// The capture intent of a pressed shortcut id, if it is one of ours.
    pub fn intent_for(&self, id: u32) -> Option<CaptureIntent> {
        self.intents.lock().unwrap().get(&id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_and_validates_accelerators() {
        assert_eq!(normalize("option+shift+space").unwrap(), "Alt+Shift+Space");
        assert_eq!(normalize("Shift + Ctrl + p").unwrap(), "Ctrl+Shift+P");
        assert_eq!(normalize("cmd+KeyK").unwrap(), "Super+K");
        assert_eq!(normalize("Ctrl+F13").unwrap(), "Ctrl+F13");
        assert!(normalize("Space").is_err(), "bare keys steal typing");
        assert!(normalize("Shift+A").is_err(), "shift-only steals typing");
        assert!(normalize("Hyper+A").is_err());
        assert!(normalize("Ctrl+Banana").is_err());
        assert!(normalize("").is_err());
    }

    #[test]
    fn canonical_accelerators_parse_in_the_os_plugin() {
        use std::str::FromStr;
        for raw in ["Alt+Space", "Alt+Shift+Space", "Ctrl+Alt+Space", "Ctrl+Alt+Shift+Space", "Super+K", "Ctrl+F13", "Alt+Period", "Ctrl+Alt+7", "Alt+Slash", "Ctrl+Quote"] {
            let canonical = normalize(raw).unwrap();
            assert!(tauri_plugin_global_shortcut::Shortcut::from_str(&canonical).is_ok(), "{canonical} must parse");
        }
    }

    #[test]
    fn platform_defaults_avoid_reserved_combinations() {
        for p in ["macos", "windows", "linux"] {
            let (a, b) = defaults_for(p);
            assert_eq!(normalize(a).unwrap(), a);
            assert_eq!(normalize(b).unwrap(), b);
            assert!(reserved_reason(p, a).is_none(), "{p} {a}");
            assert!(reserved_reason(p, b).is_none(), "{p} {b}");
        }
        assert_eq!(defaults_for("macos"), ("Alt+Space", "Alt+Shift+Space"));
        assert!(reserved_reason("windows", "Alt+Space").is_some());
        assert!(reserved_reason("macos", "Super+Space").is_some());
    }
}
