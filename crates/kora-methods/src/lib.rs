//! The `kora-rpc/1` **method table** in Rust — the counterpart of `core/methods.ts`,
//! and the layer the future shells (Tauri/CLI) actually call.
//!
//! Why this crate exists (docs/ROADMAP.md §6.1, P3/P4):
//!   * `core/methods.ts` proved the contract but runs inside Node. The Electron shell
//!     cannot be replaced until the *same* method names, argument order and return
//!     shapes exist in Rust;
//!   * every method here re-validates its input **inside the core**. The caller on the
//!     other side of the boundary is untrusted, so a UI confirmation is never a
//!     security boundary — `shell.execute` deliberately ignores a `bypassDangerCheck`
//!     parameter coming from the wire, and `kora-security` re-runs the path and
//!     denylist checks on every fs/shell call.
//!
//! Frozen contracts this crate must not break:
//!   * method names: `fs.readFile`, `shell.execute`, `chats.load`, ... (docs/CORE_RPC.md §5);
//!   * params: positional arrays (ported methods) or named objects (new methods);
//!   * return values: exactly what the current IPC handlers return, `{ success, error,
//!     data }`-style where that is the existing shape. A shell must never have to
//!     reinterpret a payload;
//!   * chats are sanitised field by field and a corrupted file is backed up, never
//!     wiped (delegated to `kora-store`).

pub mod fs;
pub mod shell;
pub mod store_domains;

use std::path::PathBuf;
use std::sync::Arc;

use kora_rpc::{DispatchOptions, MethodTable};
use serde_json::Value;

pub use store_domains::ChatsPath;

/// `~/.kora` — the data directory (docs/PROJECT_HANDOFF §7).
pub fn default_data_dir() -> PathBuf {
    home_dir().join(".kora")
}

/// `os.homedir()` equivalent, with the same fallbacks the TS code uses.
pub fn home_dir() -> PathBuf {
    for key in ["USERPROFILE", "HOME"] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                return PathBuf::from(v);
            }
        }
    }
    PathBuf::from(".")
}

/// Positional params → the element at `index`, or `None`.
///
/// Ported methods use positional arrays, but the named-object form is accepted too
/// (`{"path": ...}`), because that is what the RPC contract allows for new methods and
/// it costs nothing to be liberal on input.
pub fn positional(params: Option<&Value>, index: usize) -> Option<&Value> {
    match params {
        Some(Value::Array(a)) => a.get(index),
        Some(Value::Object(o)) => {
            // Named form: try the conventional keys for this position, then fall back
            // to a nested `params` array.
            let keys: &[&str] = match index {
                0 => &[
                    "path", "dir", "command", "chats", "key", "url", "query", "fullName",
                ],
                1 => &["content", "newPath", "value", "maxBytes", "oldPath"],
                2 => &["newText", "replaceAll"],
                3 => &["replaceAll"],
                _ => &[],
            };
            let mut out = None;
            for k in keys {
                if let Some(v) = o.get(*k) {
                    out = Some(v);
                    break;
                }
            }
            out.or_else(|| {
                o.get("params")
                    .and_then(|p| p.as_array())
                    .and_then(|a| a.get(index))
            })
        }
        _ => None,
    }
}

/// A required string parameter, with the TS error wording (`"<name> must be a string"`).
pub fn require_str(params: Option<&Value>, index: usize, name: &str) -> Result<String, String> {
    positional(params, index)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| format!("{name} must be a string"))
}

/// The environment inputs the guards need. Built once per process and shared, because
/// `blocked_write_paths` allocates a `Vec<String>` on every call.
#[derive(Clone)]
pub struct Env {
    pub platform: kora_security::path::PlatformEnv,
    pub home: String,
    pub data_dir: String,
}

impl Env {
    /// Build from the real process environment.
    ///
    /// `KORA_DATA_DIR` overrides the `~/.kora` location, which is what the headless
    /// runner, the tests and any sandboxed shell use instead of touching the real
    /// user profile.
    pub fn current() -> Self {
        let home = home_dir();
        let data_dir = std::env::var("KORA_DATA_DIR")
            .ok()
            .filter(|d| !d.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".kora"));
        Self {
            home: home.to_string_lossy().into_owned(),
            platform: kora_security::path::PlatformEnv::current(),
            data_dir: data_dir.to_string_lossy().into_owned(),
        }
    }

    /// Deterministic environment for tests.
    pub fn for_home(home: &str) -> Self {
        use kora_security::path::{Platform, PlatformEnv};
        let platform = if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Other
        };
        Self {
            home: home.to_string(),
            platform: PlatformEnv {
                platform,
                sys_root: if cfg!(windows) {
                    "C:\\Windows".into()
                } else {
                    "/etc".into()
                },
                home: home.to_string(),
                app_data: if cfg!(windows) {
                    format!("{home}\\AppData\\Roaming")
                } else {
                    format!("{home}/.config")
                },
            },
            data_dir: PathBuf::from(home)
                .join(".kora")
                .to_string_lossy()
                .into_owned(),
        }
    }
}

impl Default for Env {
    fn default() -> Self {
        Self::current()
    }
}

/// Build the full method table for the domains implemented in Rust.
///
/// Domains that are not here yet (`ai`, `mcp`, `tts`, `web`, `system`, `obsidian`,
/// `agent`) are honestly absent: a shell calling them gets the standard
/// `-32601 method not found` from the dispatcher, which is the truthful answer until
/// the port lands. See docs/ROADMAP.md §7 (P3) for the order.
pub fn create_method_table(env: Arc<Env>) -> DispatchOptions {
    let mut table: MethodTable = MethodTable::new();

    fs::register(&mut table, env.clone());
    shell::register(&mut table, env.clone());
    store_domains::register(&mut table, env.clone());

    DispatchOptions {
        methods: table,
        core_capabilities: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positional_reads_arrays_and_named_objects() {
        let arr = serde_json::json!(["C:/x", 5]);
        assert_eq!(positional(Some(&arr), 0).unwrap().as_str(), Some("C:/x"));
        assert_eq!(positional(Some(&arr), 1).unwrap().as_u64(), Some(5));

        let obj = serde_json::json!({ "path": "C:/y" });
        assert_eq!(positional(Some(&obj), 0).unwrap().as_str(), Some("C:/y"));

        let cmd = serde_json::json!({ "command": "dir" });
        assert_eq!(positional(Some(&cmd), 0).unwrap().as_str(), Some("dir"));

        assert!(positional(None, 0).is_none());
        assert!(positional(Some(&serde_json::json!(7)), 0).is_none());
    }

    #[test]
    fn require_str_reports_the_ts_message() {
        let err = require_str(Some(&serde_json::json!([1])), 0, "path").unwrap_err();
        assert_eq!(err, "path must be a string");
    }

    #[test]
    fn for_home_builds_a_deterministic_data_dir() {
        let env = Env::for_home("/tmp/kora-test");
        assert_eq!(env.data_dir.replace('\\', "/"), "/tmp/kora-test/.kora");
    }
}
