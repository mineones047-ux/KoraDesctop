//! kora-desktop — the Tauri 2 shell (docs/ROADMAP.md §7, phase P4).
//!
//! The shell is deliberately **thin**. It owns a window, a config file and one
//! `kora_rpc` command; every privileged operation lives in the `kora-rpc/1` core
//! (`kora-methods`), so the security model is unchanged when Electron is retired:
//! the renderer talks to `window.kora.*`, and every one of those calls is
//! re-validated inside the core (docs/CORE_RPC.md §6).
//!
//! Why the core is in-process here rather than spawned over stdio: the same
//! `kora-rpc/1` boundary is used, but a Tauri command already runs in the app
//! process, so a second process would only add latency. `kora-cli serve` remains
//! the transport for a future out-of-process core.
//!
//! Everything except the Tauri glue is pure and unit-tested here:
//! [`CoreHost::call`] is the whole boundary — a method name, params, and the
//! JSON-RPC response — and it is exercised without a window.

use std::sync::Arc;

use kora_methods::{create_method_table, Env};
use kora_rpc::{
    create_dispatch_state, handle_message, DispatchState, RpcResponse, PROTOCOL_VERSION,
};
use serde_json::{json, Value};
use tokio::sync::Mutex;

/// The capability groups this shell declares in `core.hello`.
///
/// Deliberately limited to what the core actually implements today. Declaring a
/// group the core cannot serve would only produce `-32601 method not found` later;
/// asking for exactly these keeps the contract honest while P3 is in progress.
pub const SHELL_CAPABILITIES: [&str; 4] = ["fs", "shell", "config", "chats"];

/// What the shell should do with the window.
///
/// The window is a **shell** concern, not a core one: it never reaches the
/// `kora-rpc/1` method table, so the core's capability model stays exactly as
/// it is. Parsing lives here (rather than in the Tauri command) so the accepted
/// action names are unit-tested without a window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowAction {
    Minimize,
    /// Toggle: maximise a normal window, restore a maximised one.
    ToggleMaximize,
    Close,
    IsMaximized,
}

impl WindowAction {
    /// The action names the renderer may send.
    pub const NAMES: [&'static str; 4] = ["minimize", "maximize", "close", "is_maximized"];

    /// Parse the action name coming from the frontend.
    pub fn parse(action: &str) -> Result<Self, String> {
        match action {
            "minimize" => Ok(Self::Minimize),
            "maximize" => Ok(Self::ToggleMaximize),
            "close" => Ok(Self::Close),
            "is_maximized" => Ok(Self::IsMaximized),
            other => Err(format!(
                "Unknown window action \"{other}\" (expected one of: {})",
                Self::NAMES.join(", ")
            )),
        }
    }
}

/// The outcome of one boundary call, ready to cross into the frontend.
#[derive(Debug, Clone, PartialEq)]
pub struct RpcOutcome {
    pub id: i64,
    pub result: Option<Value>,
    pub error: Option<Value>,
}

impl RpcOutcome {
    /// Unwrap into the value the renderer's `window.kora.*` wrapper expects, or an
    /// `Err` whose message is the core's own text.
    pub fn into_result(self) -> Result<Value, String> {
        match (self.result, self.error) {
            (Some(v), _) => Ok(v),
            (None, Some(err)) => Err(err["message"]
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| err.to_string())),
            (None, None) => Err("Empty response from the Kora core".to_string()),
        }
    }

    /// The JSON-RPC error code, when there is one.
    pub fn error_code(&self) -> Option<i64> {
        self.error.as_ref().and_then(|e| e["code"].as_i64())
    }
}

/// The in-process core: the dispatcher, its method table and the handshake state.
pub struct CoreHost {
    options: kora_rpc::DispatchOptions,
    state: Mutex<DispatchState>,
    next_id: std::sync::atomic::AtomicI64,
    /// The capability groups this host declares in its handshake. Narrowing it is how
    /// the `denied` path is exercised: a shell that does not ask for a group must not
    /// be able to call it even though the core implements it.
    granted: Vec<&'static str>,
}

impl CoreHost {
    /// Build a host over the real environment (`~/.kora`, or `KORA_DATA_DIR`),
    /// declaring every capability the core currently serves.
    pub fn new() -> Self {
        Self::with_env(Env::current())
    }

    /// Build a host over an explicit environment — used by the tests so they never
    /// touch the real user profile.
    pub fn with_env(env: Env) -> Self {
        Self::restricted(env, SHELL_CAPABILITIES.to_vec())
    }

    /// Build a host that declares only `granted`. Used to prove the capability model:
    /// a method whose group was not declared comes back as `-32003 denied`, not as a
    /// result.
    pub fn restricted(env: Env, granted: Vec<&'static str>) -> Self {
        let data_dir = env.data_dir.clone();
        Self {
            options: create_method_table(Arc::new(env)),
            state: Mutex::new(create_dispatch_state(&data_dir)),
            next_id: std::sync::atomic::AtomicI64::new(1),
            granted,
        }
    }

    fn next_id(&self) -> i64 {
        self.next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
    }

    /// Perform the `core.hello` handshake. Must succeed before any other call; the
    /// dispatcher answers `-32002 not_initialized` until it does.
    pub async fn hello(&self) -> Result<RpcOutcome, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": self.next_id(),
            "method": "core.hello",
            "params": {
                "client": "kora-desktop",
                "clientVersion": env!("CARGO_PKG_VERSION"),
                "protocol": PROTOCOL_VERSION,
                "capabilities": self.granted,
            }
        });
        self.dispatch(request).await
    }

    /// One `kora-rpc/1` call. `params` uses the positional form for ported methods
    /// and the named-object form for new ones — the core accepts both.
    pub async fn call(&self, method: &str, params: Value) -> Result<RpcOutcome, String> {
        let request = json!({
            "jsonrpc": "2.0",
            "id": self.next_id(),
            "method": method,
            "params": params,
        });
        self.dispatch(request).await
    }

    async fn dispatch(&self, message: Value) -> Result<RpcOutcome, String> {
        let mut state = self.state.lock().await;
        let response = handle_message(message, &mut state, &self.options)
            .await
            .ok_or("The Kora core returned no response".to_string())?;
        Ok(to_outcome(response))
    }
}

impl Default for CoreHost {
    fn default() -> Self {
        Self::new()
    }
}

/// Split a protocol response into the flat shape the frontend consumes.
fn to_outcome(response: RpcResponse) -> RpcOutcome {
    match response {
        RpcResponse::Success(s) => RpcOutcome {
            id: s.id,
            result: Some(s.result),
            error: None,
        },
        RpcResponse::Failure(f) => {
            RpcOutcome {
                id: f.id.unwrap_or(0),
                result: None,
                // `RpcErrorObject` is a typed struct; the frontend wants the JSON shape,
                // so it goes through serde rather than being rebuilt field by field.
                error: Some(serde_json::to_value(f.error).unwrap_or_else(
                    |_| json!({ "code": -32603, "message": "Unserialisable error" }),
                )),
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    async fn connected(home: &str) -> CoreHost {
        let host = CoreHost::with_env(Env::for_home(home));
        let hello = host.hello().await.expect("handshake must succeed");
        assert_eq!(
            hello.error_code(),
            None,
            "the handshake must not report an error"
        );
        host
    }

    fn temp_home() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[tokio::test]
    async fn handshake_reports_the_protocol_and_the_granted_capabilities() {
        let dir = temp_home();
        let host = CoreHost::with_env(Env::for_home(&dir.path().to_string_lossy()));
        let out = host.hello().await.unwrap();
        let result = out.result.expect("a successful handshake returns a result");
        assert_eq!(result["protocol"], PROTOCOL_VERSION);
        assert_eq!(result["coreVersion"], env!("CARGO_PKG_VERSION"));
        assert!(result["dataDir"].as_str().unwrap().contains(".kora"));
        for cap in SHELL_CAPABILITIES {
            let granted = result["capabilities"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c == cap);
            assert!(granted, "{cap} was not granted");
        }
    }

    #[tokio::test]
    async fn a_call_before_the_handshake_is_refused() {
        let dir = temp_home();
        let host = CoreHost::with_env(Env::for_home(&dir.path().to_string_lossy()));
        let out = host.call("fs.homeDir", json!([])).await.unwrap();
        assert_eq!(out.error_code(), Some(-32002));
    }

    #[tokio::test]
    async fn fs_read_write_roundtrip_through_the_boundary() {
        let dir = temp_home();
        let host = connected(&dir.path().to_string_lossy()).await;
        let file = dir.path().join("via-rpc.txt");

        host.call(
            "fs.writeFile",
            json!([file.to_string_lossy(), "written through kora-rpc/1"]),
        )
        .await
        .unwrap()
        .into_result()
        .unwrap();

        let read = host
            .call("fs.readFile", json!([file.to_string_lossy()]))
            .await
            .unwrap()
            .into_result()
            .unwrap();
        assert_eq!(read.as_str(), Some("written through kora-rpc/1"));
    }

    #[tokio::test]
    async fn a_dangerous_shell_command_is_blocked_inside_the_core() {
        let dir = temp_home();
        let host = connected(&dir.path().to_string_lossy()).await;
        let out = host
            .call("shell.execute", json!(["format C:"]))
            .await
            .unwrap()
            .into_result()
            .unwrap();
        assert_eq!(out["blocked"], json!(true));
        assert_eq!(out["requiresConfirmation"], json!(true));
    }

    #[tokio::test]
    async fn a_method_outside_the_declared_capabilities_is_denied() {
        let dir = temp_home();
        // The core implements `shell.execute`, but this shell only asked for `fs`,
        // so the capability model must refuse it — that is the point of §6.
        let host = CoreHost::restricted(Env::for_home(&dir.path().to_string_lossy()), vec!["fs"]);
        host.hello().await.unwrap();
        let out = host.call("shell.execute", json!(["dir"])).await.unwrap();
        assert_eq!(out.error_code(), Some(-32003));
    }

    #[tokio::test]
    async fn an_unknown_method_is_method_not_found() {
        let dir = temp_home();
        let host = connected(&dir.path().to_string_lossy()).await;
        let out = host.call("fs.teleport", json!([])).await.unwrap();
        assert_eq!(out.error_code(), Some(-32601));
    }

    #[tokio::test]
    async fn config_and_chats_survive_a_restart_of_the_host() {
        let dir = temp_home();
        let home = dir.path().to_string_lossy().into_owned();

        let host = connected(&home).await;
        host.call("config.set", json!(["language", "ru"]))
            .await
            .unwrap()
            .into_result()
            .unwrap();
        host.call("chats.save", json!([[{ "id": "c1", "title": "Kept" }]]))
            .await
            .unwrap()
            .into_result()
            .unwrap();

        // A second host over the same directory = a fresh process reading the files.
        let restarted = connected(&home).await;
        let cfg = restarted
            .call("config.get", json!([]))
            .await
            .unwrap()
            .into_result()
            .unwrap();
        assert_eq!(cfg["language"], json!("ru"));

        let chats = restarted
            .call("chats.load", json!([]))
            .await
            .unwrap()
            .into_result()
            .unwrap();
        assert_eq!(chats[0]["title"], json!("Kept"));
    }

    #[tokio::test]
    async fn concurrent_calls_are_serialised_behind_the_core_lock() {
        let dir = temp_home();
        let host = Arc::new(connected(&dir.path().to_string_lossy()).await);
        let mut handles = Vec::new();
        for _ in 0..8 {
            let host = host.clone();
            handles.push(tokio::spawn(async move {
                host.call("fs.homeDir", json!([]))
                    .await
                    .unwrap()
                    .into_result()
            }));
        }
        for h in handles {
            assert!(h.await.unwrap().is_ok());
        }
    }

    #[test]
    fn window_actions_parse_and_reject_anything_else() {
        assert_eq!(WindowAction::parse("minimize").unwrap(), WindowAction::Minimize);
        assert_eq!(
            WindowAction::parse("maximize").unwrap(),
            WindowAction::ToggleMaximize
        );
        assert_eq!(WindowAction::parse("close").unwrap(), WindowAction::Close);
        assert_eq!(
            WindowAction::parse("is_maximized").unwrap(),
            WindowAction::IsMaximized
        );

        let err = WindowAction::parse("explode").unwrap_err();
        assert!(err.contains("explode"), "the message must name the action: {err}");
        assert!(err.contains("minimize"), "the message must list the valid ones");
    }

    #[test]
    fn outcome_converts_an_error_into_a_message() {
        let out = RpcOutcome {
            id: 1,
            result: None,
            error: Some(json!({ "code": -32001, "message": "disk on fire" })),
        };
        assert_eq!(out.error_code(), Some(-32001));
        assert_eq!(out.into_result().unwrap_err(), "disk on fire");
    }
}
