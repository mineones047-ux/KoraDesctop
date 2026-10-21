//! The Tauri entry point: create the window, wire the single `kora_rpc` command and
//! perform the `core.hello` handshake before the frontend can ask for anything.
//!
//! Security posture mirrors `electron/main.ts` (docs/PROJECT_HANDOFF §5):
//!   * no Node integration is exposed to the webview — the renderer only ever sees
//!     the commands registered here;
//!   * `core.hello` runs at startup, so a call before the handshake is impossible
//!     rather than merely rejected;
//!   * every privileged call still goes through the core, which re-validates it.
//!
//! The window is frameless with a custom title bar, matching the Electron build, so
//! the React UI in `src/` needs no changes at all.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use kora_desktop::{CoreHost, WindowAction};
use serde_json::Value;
use tauri::{Manager, State, Window};

/// The single command the renderer is allowed to call.
///
/// It is deliberately generic — a method name plus params — because that is exactly
/// the `kora-rpc/1` surface, and duplicating every typed command in Rust would be a
/// second source of truth to keep in sync with the core. The TS shim
/// (`shell/tauri-shim.ts`) provides the typed `window.kora.*` API on top of this.
#[tauri::command]
async fn kora_rpc(
    host: State<'_, Arc<CoreHost>>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    let params = params.unwrap_or(Value::Array(Vec::new()));
    let outcome = host.call(&method, params).await?;
    outcome.into_result()
}

/// The shell-level window controls.
///
/// Window management is **not** a core method: it never reaches the
/// `kora-rpc/1` method table, so the core's capability model is unchanged. The
/// action names are parsed by [`WindowAction`], which is unit-tested without a
/// window.
///
/// `maximize` toggles, exactly like the Electron build's `window:maximize`
/// handler — the renderer calls one "maximise" button, and the shell decides
/// whether that means maximising or restoring.
#[tauri::command]
async fn kora_window(window: Window, action: String) -> Result<Value, String> {
    match WindowAction::parse(&action)? {
        WindowAction::Minimize => window.minimize().map_err(|e| e.to_string())?,
        WindowAction::ToggleMaximize => {
            if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize().map_err(|e| e.to_string())?;
            } else {
                window.maximize().map_err(|e| e.to_string())?;
            }
        }
        WindowAction::Close => window.close().map_err(|e| e.to_string())?,
        WindowAction::IsMaximized => {
            return Ok(Value::Bool(window.is_maximized().map_err(|e| e.to_string())?))
        }
    }
    Ok(Value::Null)
}

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(CoreHost::new()))
        .invoke_handler(tauri::generate_handler![kora_rpc, kora_window])
        .setup(|app| {
            // The handshake is awaited inside the Tauri runtime before the window is
            // shown, so the renderer can never observe an uninitialised core.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let host = handle.state::<Arc<CoreHost>>();
                match host.hello().await {
                    Ok(out) if out.error.is_none() => {
                        let result = out.result.unwrap_or(Value::Null);
                        eprintln!(
                            "[kora] core ready: protocol {}, version {}",
                            result["protocol"], result["coreVersion"]
                        );
                    }
                    Ok(out) => eprintln!("[kora] core handshake failed: {:?}", out.error),
                    Err(e) => eprintln!("[kora] core handshake error: {e}"),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start kora-desktop");
}
