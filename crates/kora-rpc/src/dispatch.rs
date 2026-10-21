//! kora-rpc/1 dispatcher — the core side of the boundary (Rust port of
//! `core/dispatch.ts`): handshake, capability enforcement, routing and error
//! capture. Pure async functions over injected handlers; transports live in
//! the runner (`kora-cli serve`).

use std::collections::HashSet;

use serde_json::{json, Value};

use crate::protocol::{
    error_response, ErrorCodes, RpcResponse, CORE_CAPABILITIES, PROTOCOL_VERSION,
};

/// An async handler for one method. Receives the raw `params` value.
pub type RpcHandlerFuture =
    std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>>;

pub type RpcHandler = Box<dyn Fn(Option<Value>) -> RpcHandlerFuture + Send + Sync>;

/// One registered method: its capability group and its handler.
pub struct MethodSpec {
    pub capability: &'static str,
    pub handler: RpcHandler,
}

pub type MethodTable = std::collections::HashMap<String, MethodSpec>;

/// Capability groups the shell was granted, plus the initialized flag.
pub struct DispatchState {
    pub initialized: bool,
    pub granted: HashSet<String>,
    pub data_dir: String,
}

/// Handle one raw (already frame-parsed) protocol message.
pub struct DispatchOptions {
    pub methods: MethodTable,
    /// Capability groups the CORE itself supports (defaults to all).
    pub core_capabilities: Option<Vec<&'static str>>,
}

/// Create a fresh (not initialized) dispatch state.
pub fn create_dispatch_state(data_dir: &str) -> DispatchState {
    DispatchState {
        initialized: false,
        granted: HashSet::new(),
        data_dir: data_dir.to_string(),
    }
}

/// Extract the capability prefix of a method name: `"fs.readFile"` → `"fs"`.
pub fn method_group(method: &str) -> &str {
    match method.split_once('.') {
        Some((group, _)) => group,
        None => method,
    }
}

/// Handle one parsed message. Returns a response for requests (with an `id`),
/// `None` for notifications and for messages that cannot be correlated.
pub async fn handle_message(
    message: Value,
    state: &mut DispatchState,
    options: &DispatchOptions,
) -> Option<RpcResponse> {
    let id = message.get("id").and_then(Value::as_i64);
    let method = message.get("method").and_then(Value::as_str);

    // JSON-RPC notifications (no id) never get a response — including error
    // responses for stale/uninitialized state.
    if id.is_none() && method.is_some() {
        return None;
    }

    let Some(method) = method else {
        return id.map(|id| {
            error_response(
                Some(id),
                ErrorCodes::INVALID_REQUEST,
                "Invalid request: missing method",
                None,
            )
            .into()
        });
    };
    if message.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return id.map(|id| {
            error_response(
                Some(id),
                ErrorCodes::INVALID_REQUEST,
                "Invalid request: jsonrpc must be \"2.0\"",
                None,
            )
            .into()
        });
    }

    let params = message.get("params").cloned();

    // Handshake (docs/CORE_RPC.md §3).
    if method == "core.hello" {
        return Some(handle_hello(id, params, state, options));
    }

    if !state.initialized {
        return Some(
            error_response(
                id,
                ErrorCodes::NOT_INITIALIZED,
                "Not initialized: send core.hello first",
                None,
            )
            .into(),
        );
    }

    let Some(spec) = options.methods.get(method) else {
        return Some(
            error_response(
                id,
                ErrorCodes::METHOD_NOT_FOUND,
                &format!("Method not found: {method}"),
                None,
            )
            .into(),
        );
    };

    let core_has = options.core_capabilities.as_deref();
    // An unspecified core capability list means "the core supports everything"
    // (MSRV 1.80: written as a `match` rather than `Option::is_none_or`, 1.82+).
    let granted_by_core = match core_has {
        Some(c) => c.contains(&spec.capability),
        None => true,
    };
    if !granted_by_core || !state.granted.contains(spec.capability) {
        return Some(
            error_response(
                id,
                ErrorCodes::DENIED,
                &format!("Capability not granted: {}", spec.capability),
                Some(json!({ "capability": spec.capability })),
            )
            .into(),
        );
    }

    match (spec.handler)(params).await {
        Ok(result) => Some(RpcResponse::Success(crate::protocol::RpcSuccess {
            jsonrpc: "2.0".into(),
            id: id.unwrap_or_default(),
            result,
        })),
        Err(detail) => Some(
            error_response(
                id,
                ErrorCodes::KORA_ERROR,
                &detail,
                Some(json!({ "detail": detail })),
            )
            .into(),
        ),
    }
}

/// Convenience: parse one raw line and dispatch it.
pub async fn handle_line(
    line: &str,
    state: &mut DispatchState,
    options: &DispatchOptions,
) -> Option<RpcResponse> {
    match crate::protocol::parse_frame(line) {
        crate::protocol::ParsedFrame::Ok(message) => handle_message(message, state, options).await,
        crate::protocol::ParsedFrame::Malformed => {
            Some(error_response(None, ErrorCodes::PARSE, "Parse error", None).into())
        }
    }
}

fn handle_hello(
    id: Option<i64>,
    params: Option<Value>,
    state: &mut DispatchState,
    options: &DispatchOptions,
) -> RpcResponse {
    // Accept both named-object params and a single positional object.
    let p = match params {
        Some(Value::Array(a)) if a.len() == 1 => Some(a.into_iter().next().unwrap()),
        Some(v) => Some(v),
        None => None,
    };
    let Some(p) = p.filter(|v| v.is_object()) else {
        return error_response(
            id,
            ErrorCodes::INVALID_PARAMS,
            "core.hello requires { client, protocol }",
            None,
        )
        .into();
    };

    if p.get("protocol").and_then(Value::as_str) != Some(PROTOCOL_VERSION) {
        let received = p.get("protocol").and_then(Value::as_str).unwrap_or("none");
        return error_response(
            id,
            ErrorCodes::INVALID_REQUEST,
            &format!("Protocol mismatch: client speaks {received}, core speaks {PROTOCOL_VERSION}"),
            Some(json!({ "expected": PROTOCOL_VERSION, "received": received })),
        )
        .into();
    }

    // The shell declares what it wants; an omitted field grants only the
    // read-only basics every shell needs.
    let requested: Vec<String> = match p.get("capabilities").and_then(Value::as_array) {
        Some(arr) => arr
            .iter()
            .filter_map(Value::as_str)
            .filter(|c| CORE_CAPABILITY_SET.contains(c))
            .map(str::to_string)
            .collect(),
        None => vec!["config".to_string(), "chats".to_string()],
    };

    let core_has = options
        .core_capabilities
        .as_deref()
        .unwrap_or(&CORE_CAPABILITIES);
    state.granted = requested
        .into_iter()
        .filter(|c| core_has.contains(&c.as_str()))
        .collect();
    state.initialized = true;

    RpcResponse::Success(crate::protocol::RpcSuccess {
        jsonrpc: "2.0".into(),
        id: id.unwrap_or_default(),
        result: json!({
            "coreVersion": env!("CARGO_PKG_VERSION"),
            "protocol": PROTOCOL_VERSION,
            "capabilities": state.granted.iter().cloned().collect::<Vec<_>>(),
            "dataDir": state.data_dir,
        }),
    })
}

static CORE_CAPABILITY_SET: [&str; 11] = CORE_CAPABILITIES;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{ErrorCodes, ParsedFrame, PROTOCOL_VERSION};
    use serde_json::json;
    use std::sync::Arc;

    fn make_options() -> DispatchOptions {
        let mut methods = MethodTable::new();
        methods.insert(
            "fs.exists".into(),
            MethodSpec {
                capability: "fs",
                handler: Box::new(|_| Box::pin(async { Ok(json!({ "exists": true })) })),
            },
        );
        methods.insert(
            "shell.execute".into(),
            MethodSpec {
                capability: "shell",
                handler: Box::new(|_| Box::pin(async { Ok(json!({ "success": true })) })),
            },
        );
        methods.insert(
            "fs.boom".into(),
            MethodSpec {
                capability: "fs",
                handler: Box::new(|_| Box::pin(async { Err("disk on fire".to_string()) })),
            },
        );
        DispatchOptions {
            methods,
            core_capabilities: None,
        }
    }

    fn hello(capabilities: Value) -> Value {
        json!({
            "jsonrpc": "2.0",
            "id": 0,
            "method": "core.hello",
            "params": { "client": "kora-test", "protocol": PROTOCOL_VERSION, "capabilities": capabilities }
        })
    }

    #[tokio::test]
    async fn handshake_answers_with_version_and_capabilities() {
        let mut state = create_dispatch_state("C:\\t\\.kora");
        let options = make_options();
        let res = handle_message(hello(json!(["fs"])), &mut state, &options)
            .await
            .unwrap();
        match res {
            RpcResponse::Success(s) => {
                assert_eq!(s.result["protocol"], "kora-rpc/1");
                assert_eq!(s.result["dataDir"], "C:\\t\\.kora");
                assert_eq!(s.result["capabilities"], json!(["fs"]));
            }
            _ => panic!("expected success"),
        }
    }

    #[tokio::test]
    async fn request_before_hello_is_not_initialized() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":5,"method":"fs.exists"}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::NOT_INITIALIZED);
                assert!(f.error.message.contains("core.hello"));
            }
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn protocol_mismatch_is_rejected() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":1,"method":"core.hello","params":{"client":"c","protocol":"kora-rpc/0"}}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::INVALID_REQUEST);
                assert_eq!(f.error.data.unwrap()["expected"], "kora-rpc/1");
            }
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn capability_not_granted_is_denied() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        handle_message(hello(json!(["fs"])), &mut state, &options).await;
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":4,"method":"shell.execute"}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::DENIED);
                assert_eq!(f.error.data.unwrap()["capability"], "shell");
            }
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn no_declared_capabilities_denies_everything() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        handle_message(hello(json!([])), &mut state, &options).await;
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":5,"method":"fs.exists"}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => assert_eq!(f.error.code, ErrorCodes::DENIED),
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn unknown_method_is_method_not_found() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        handle_message(hello(json!(["fs"])), &mut state, &options).await;
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":6,"method":"fs.nope"}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => assert_eq!(f.error.code, ErrorCodes::METHOD_NOT_FOUND),
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn handler_error_becomes_kora_error_with_detail() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        handle_message(hello(json!(["fs"])), &mut state, &options).await;
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":7,"method":"fs.boom"}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::KORA_ERROR);
                assert_eq!(f.error.message, "disk on fire");
                assert_eq!(f.error.data.unwrap()["detail"], "disk on fire");
            }
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn notifications_produce_no_response() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        let res = handle_message(
            json!({"jsonrpc":"2.0","method":"something.happened"}),
            &mut state,
            &options,
        )
        .await;
        assert!(res.is_none());
    }

    #[tokio::test]
    async fn malformed_line_is_parse_error_with_null_id() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        let res = handle_line("garbage {{", &mut state, &options)
            .await
            .unwrap();
        match res {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::PARSE);
                assert_eq!(f.id, None);
            }
            _ => panic!("expected failure"),
        }
    }

    #[tokio::test]
    async fn empty_line_is_malformed_not_crash() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        assert!(handle_line("", &mut state, &options).await.is_some());
        assert!(handle_line("  \n", &mut state, &options).await.is_some());
    }

    #[tokio::test]
    async fn positional_object_params_form_of_hello_works() {
        let mut state = create_dispatch_state("x");
        let options = make_options();
        let res = handle_message(
            json!({"jsonrpc":"2.0","id":2,"method":"core.hello","params":[{"client":"c","protocol":PROTOCOL_VERSION}]}),
            &mut state,
            &options,
        )
        .await
        .unwrap();
        match res {
            RpcResponse::Success(s) => assert_eq!(s.result["protocol"], "kora-rpc/1"),
            _ => panic!("expected success"),
        }
    }

    #[test]
    fn method_group_splits_domain() {
        assert_eq!(method_group("fs.readFile"), "fs");
        assert_eq!(method_group("agent.startCycle"), "agent");
        assert_eq!(method_group("core.hello"), "core");
    }

    #[test]
    fn shared_state_behind_arc_compiles() {
        // The dispatcher state is used behind Arc<Mutex<_>> by kora-cli serve.
        let options = Arc::new(make_options());
        assert!(options.methods.contains_key("fs.exists"));
    }

    #[test]
    fn parse_frame_ok_roundtrip() {
        let parsed = crate::protocol::parse_frame("{\"jsonrpc\":\"2.0\",\"id\":7}");
        assert!(matches!(parsed, ParsedFrame::Ok(_)));
    }
}
