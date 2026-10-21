//! kora-rpc/1 protocol types and framing — Rust port of `core/protocol.ts`.
//!
//! Every constant here is byte-frozen against the TypeScript reference
//! implementation (the vitest suite pins the same values on the other side).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "kora-rpc/1";

/// Capability groups declared in `core.hello` (docs/CORE_RPC.md §5/§6).
pub const CORE_CAPABILITIES: [&str; 11] = [
    "fs", "shell", "system", "ai", "config", "chats", "tts", "web", "mcp", "agent", "obsidian",
];

/// Error codes (docs/CORE_RPC.md §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ErrorCodes;

impl RpcResponse {
    pub fn failure(f: RpcFailure) -> Self {
        RpcResponse::Failure(f)
    }

    pub fn parse_error() -> Self {
        RpcResponse::Failure(error_response(None, ErrorCodes::PARSE, "Parse error", None))
    }
}

impl From<RpcFailure> for RpcResponse {
    fn from(f: RpcFailure) -> Self {
        RpcResponse::Failure(f)
    }
}

impl ErrorCodes {
    pub const PARSE: i64 = -32700;
    pub const INVALID_REQUEST: i64 = -32600;
    pub const METHOD_NOT_FOUND: i64 = -32601;
    pub const INVALID_PARAMS: i64 = -32602;
    pub const INTERNAL: i64 = -32603;
    pub const KORA_ERROR: i64 = -32001;
    pub const NOT_INITIALIZED: i64 = -32002;
    pub const DENIED: i64 = -32003;
    pub const TIMEOUT: i64 = -32004;
    pub const LLM_ERROR: i64 = -32010;
}

/// The LLM failure reasons — frozen byte-for-byte with the `[kora:<reason>]`
/// marker parsed by `src/agent/guards.ts`.
pub const KORA_REASONS: [&str; 8] = [
    "rate_limit",
    "auth",
    "model_not_found",
    "context_overflow",
    "server_error",
    "network",
    "timeout",
    "unknown",
];

pub fn is_kora_reason(v: &str) -> bool {
    KORA_REASONS.contains(&v)
}

/// Render the legacy `[kora:<reason>]` marker into a message text.
pub fn with_kora_marker(reason: &str, message: &str) -> String {
    format!("[kora:{reason}] {message}")
}

// ── JSON-RPC 2.0 messages ──

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: i64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcNotification {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcSuccess {
    pub jsonrpc: String,
    pub id: i64,
    pub result: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcErrorObject {
    pub code: i64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcFailure {
    pub jsonrpc: String,
    pub id: Option<i64>,
    pub error: RpcErrorObject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum RpcResponse {
    Success(RpcSuccess),
    Failure(RpcFailure),
}

// ── Framing: newline-delimited JSON ──

/// Serialise one protocol message (one line, no pretty-printing) with the
/// trailing newline.
pub fn frame<T: Serialize>(message: &T) -> String {
    let mut line = serde_json::to_string(message).expect("protocol message must serialize");
    line.push('\n');
    line
}

/// One parsed frame result.
#[derive(Debug, Clone, PartialEq)]
pub enum ParsedFrame {
    Ok(Value),
    /// Unparseable JSON or a non-object payload.
    Malformed,
}

/// Parse one line of protocol input. Never panics.
pub fn parse_frame(line: &str) -> ParsedFrame {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ParsedFrame::Malformed;
    }
    match serde_json::from_str::<Value>(trimmed) {
        Ok(v) if v.is_object() => ParsedFrame::Ok(v),
        _ => ParsedFrame::Malformed,
    }
}

/// Build a protocol error response. `id` is None when the request id is unknown.
pub fn error_response(
    id: Option<i64>,
    code: i64,
    message: &str,
    data: Option<Value>,
) -> RpcFailure {
    RpcFailure {
        jsonrpc: "2.0".into(),
        id,
        error: RpcErrorObject {
            code,
            message: message.to_string(),
            data,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pins_protocol_version() {
        assert_eq!(PROTOCOL_VERSION, "kora-rpc/1");
    }

    #[test]
    fn declares_all_capability_groups() {
        let mut caps = CORE_CAPABILITIES.to_vec();
        caps.sort();
        assert_eq!(
            caps,
            [
                "agent", "ai", "chats", "config", "fs", "mcp", "obsidian", "shell", "system",
                "tts", "web"
            ]
        );
    }

    #[test]
    fn frozen_llm_reasons() {
        assert_eq!(
            KORA_REASONS.to_vec(),
            vec![
                "rate_limit",
                "auth",
                "model_not_found",
                "context_overflow",
                "server_error",
                "network",
                "timeout",
                "unknown"
            ]
        );
        assert!(is_kora_reason("rate_limit"));
        assert!(!is_kora_reason("RATE_LIMIT"));
        assert!(!is_kora_reason("totally_new"));
    }

    #[test]
    fn renders_legacy_marker() {
        assert_eq!(with_kora_marker("network", "boom"), "[kora:network] boom");
    }

    #[test]
    fn frame_is_one_line() {
        let out = frame(&RpcSuccess {
            jsonrpc: "2.0".into(),
            id: 1,
            result: json!({"a": 1}),
        });
        assert_eq!(out, "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"a\":1}}\n");
        assert_eq!(out.matches('\n').count(), 1);
    }

    #[test]
    fn parse_frame_never_panics() {
        assert!(matches!(
            parse_frame("{\"jsonrpc\":\"2.0\",\"id\":7}"),
            ParsedFrame::Ok(_)
        ));
        assert!(matches!(parse_frame("not json"), ParsedFrame::Malformed));
        assert!(matches!(parse_frame(""), ParsedFrame::Malformed));
        assert!(matches!(parse_frame("   "), ParsedFrame::Malformed));
        assert!(matches!(parse_frame("[1,2,3]"), ParsedFrame::Malformed));
        assert!(matches!(parse_frame("\"str\""), ParsedFrame::Malformed));
    }

    #[test]
    fn error_response_omits_absent_data() {
        let r = error_response(Some(7), ErrorCodes::LLM_ERROR, "rate limited", None);
        assert_eq!(r.error.code, -32010);
        assert!(r.error.data.is_none());
        let with_data = error_response(
            Some(7),
            ErrorCodes::LLM_ERROR,
            "rate limited",
            Some(json!({"koraReason": "rate_limit"})),
        );
        assert_eq!(
            with_data.error.data.unwrap(),
            json!({"koraReason": "rate_limit"})
        );
    }
}
