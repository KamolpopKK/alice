//! Alice Desktop: a remote client. The Rust core owns profiles, credentials and every network
//! request; the WebView renders the shared React UI and talks to it through a few commands.

pub mod api;
pub mod commands;
pub mod core;
pub mod credentials;
pub mod deeplink;
pub mod drafts;
pub mod error;
pub mod events;
pub mod local;
pub mod profiles;
pub mod runtime;
pub mod shortcuts;
pub mod updates;

use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Registers capture shortcuts with the OS through the global-shortcut plugin.
struct PluginShortcuts(tauri::AppHandle);

impl shortcuts::ShortcutBackend for PluginShortcuts {
    fn register(&self, accelerator: &str) -> std::result::Result<u32, String> {
        let shortcut: Shortcut = accelerator.parse().map_err(|e| format!("{e}"))?;
        self.0.global_shortcut().register(shortcut).map_err(|e| e.to_string())?;
        Ok(shortcut.id())
    }
    fn unregister_all(&self) {
        let _ = self.0.global_shortcut().unregister_all();
    }
}

struct WindowSink(tauri::AppHandle);

impl core::EventSink for WindowSink {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = self.0.emit_to("main", event, payload);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // ต้องลงทะเบียนก่อน plugin อื่น: instance ที่สองส่งลิงก์ต่อให้ instance แรกแล้วปิดตัว
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| focus_main(app)))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // ปิดหน้าต่างหลักขณะมีเอกสารที่ยังไม่บันทึก: พักไว้แล้วถาม UI ก่อน
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() != "main" {
                    return;
                }
                if hold(window.app_handle(), drafts::LeaveAction::Close) {
                    api.prevent_close();
                }
            }
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let Some(registry) = app.try_state::<Arc<shortcuts::Shortcuts>>() else { return };
                    let Some(intent) = registry.intent_for(shortcut.id()) else { return };
                    focus_main(app);
                    if let Some(core) = app.try_state::<Arc<core::Core>>() {
                        core.capture_intent(intent);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            // ติดตั้ง/สลับ runtime ที่มากับแอปก่อนเปิด core (ข้ามเมื่อ dev ชี้ runtime เอง)
            let runtime_status = if std::env::var("ALICE_DESKTOP_RUNTIME").is_err() {
                let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())).unwrap_or_default();
                app.path().resource_dir().ok().and_then(|res| runtime::bundled(&res, &exe_dir)).map(|b| match runtime::install_bundled(&local::app_data_root(), &b) {
                    Ok(v) => v,
                    Err(message) => serde_json::json!({ "status": "failed", "message": message }),
                })
            } else {
                None
            };
            app.manage(commands::RuntimeStatus(std::sync::Mutex::new(runtime_status)));
            let opener: core::Opener = Arc::new(|url: &str| open::that_detached(url).is_ok());
            let core = core::Core::new(dir, credentials::select_store(), Arc::new(WindowSink(app.handle().clone())), opener)
                .map_err(|e| Box::<dyn std::error::Error>::from(e.message))?;
            // updater ทำงานเฉพาะ build ที่มี config (release) — ไม่มี public key ก็ไม่มีการอัปเดต
            let configured = app.config().plugins.0.contains_key("updater");
            if configured {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(commands::Updates { configured, pending: std::sync::Mutex::new(None) });
            if configured && std::env::var("ALICE_DESKTOP_SMOKE").as_deref() == Ok("update") {
                smoke_update(app.handle().clone());
            }
            let core = Arc::new(core);
            app.manage(Arc::clone(&core));
            app.manage(Arc::new(drafts::LeaveGuard::new()));
            // shortcut ผูกกับเครื่องนี้ (config dir) ไม่ใช่กับ server หรือ profile
            let registry = shortcuts::Shortcuts::new(core.config_dir.clone(), shortcuts::platform(), Box::new(PluginShortcuts(app.handle().clone())));
            app.manage(Arc::new(registry));
            if let Ok(raw) = std::env::var("ALICE_DESKTOP_CAPTURE") {
                // packaging smoke test: จำลองการกด shortcut โดยไม่ต้องสังเคราะห์คีย์ของ OS
                match raw.as_str() {
                    "open-last" => core.capture_intent(shortcuts::CaptureIntent::OpenLast),
                    _ => core.capture_intent(shortcuts::CaptureIntent::NewPad),
                };
            }

            #[cfg(any(windows, target_os = "linux"))]
            let _ = app.deep_link().register_all();
            let handle = app.handle().clone();
            let warm = Arc::clone(&core);
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    report_deep_link(warm.handle_deep_link(url.as_str()));
                }
                focus_main(&handle);
            });
            // cold start: ลิงก์ที่ทำให้แอปถูกเปิด (และ hook สำหรับ smoke test)
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                for url in urls {
                    report_deep_link(core.handle_deep_link(url.as_str()));
                }
            }
            if let Ok(raw) = std::env::var("ALICE_DESKTOP_OPEN_URL") {
                report_deep_link(core.handle_deep_link(&raw));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::profiles_list,
            commands::profile_add,
            commands::profile_use,
            commands::profile_remove,
            commands::profile_test,
            commands::auth_status,
            commands::auth_login_start,
            commands::auth_login_cancel,
            commands::auth_logout,
            commands::api_request,
            commands::events_subscribe,
            commands::events_unsubscribe,
            commands::open_external,
            commands::deeplink_take,
            commands::update_check,
            commands::update_install,
            commands::capture_take,
            commands::shortcuts_get,
            commands::shortcuts_set,
            commands::shortcuts_reset,
            commands::local_first_run,
            commands::workspace_create,
            commands::workspace_rename,
            commands::workspace_alias,
            commands::owner_rename,
            commands::local_open_folder,
            commands::local_restore_latest,
            commands::local_diagnostics,
            commands::tools_apply,
            commands::integrations_status,
            commands::integration_set,
            commands::integration_unassign,
            commands::editor_dirty_set,
            commands::editor_leave_reply,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Alice Desktop")
        .run(|app, event| {
            // Quit (เมนู/⌘Q) ขณะมีเอกสารที่ยังไม่บันทึก: พักไว้แล้วถาม UI ก่อน
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if hold(app, drafts::LeaveAction::Exit) {
                    api.prevent_exit();
                }
            }
        });
}

/// True when the close/quit must wait for the person; asks the UI once per held action.
fn hold(app: &tauri::AppHandle, action: drafts::LeaveAction) -> bool {
    let Some(guard) = app.try_state::<Arc<drafts::LeaveGuard>>() else { return false };
    match guard.request(action) {
        drafts::Decision::Proceed => false,
        drafts::Decision::Wait => true,
        drafts::Decision::Ask(request) => {
            focus_main(app);
            let _ = app.emit_to("main", drafts::LEAVE_EVENT, request);
            true
        }
    }
}

fn focus_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Packaging smoke tests read the outcome from stdout (never the link itself).
fn report_deep_link(outcome: &str) {
    if std::env::var("ALICE_DESKTOP_SMOKE").is_ok() {
        println!("alice-desktop: deeplink {outcome}");
    }
}

/// Packaging test: check, verify and install an update without UI, then report and quit.
fn smoke_update(app: tauri::AppHandle) {
    use tauri_plugin_updater::UpdaterExt;
    tauri::async_runtime::spawn(async move {
        let outcome = match app.updater() {
            Err(_) => "error".to_string(),
            Ok(updater) => match updater.check().await {
                Err(_) => "check-failed".into(),
                Ok(None) => "not-newer".into(),
                Ok(Some(update)) => {
                    let api = update.raw_json.get("aliceClientApi").and_then(|v| v.as_u64()).map(|v| v as u32);
                    match updates::evaluate(&update.current_version, &update.version, api, None) {
                        updates::Decision::Install => match update.download_and_install(|_, _| {}, || {}).await {
                            Ok(()) => format!("installed {}", update.version),
                            Err(_) => "verify-failed".into(),
                        },
                        other => format!("{other:?}").to_lowercase(),
                    }
                }
            },
        };
        println!("alice-desktop: update {outcome}");
        app.exit(0);
    });
}
