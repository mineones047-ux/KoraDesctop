//! Kora LLM gateway — the Rust port of `electron/services/api.ts`.
//!
//! Contract that must not change:
//!   * errors embed the **frozen** marker `[kora:<reason>]`
//!     (`rate_limit`, `auth`, `model_not_found`, `context_overflow`,
//!     `server_error`, `network`, `timeout`, `unknown`) — the agent parses it;
//!   * only retryable reasons (`rate_limit`, `server_error`, `network`,
//!     `timeout`) are retried, with jittered backoff / `Retry-After`;
//!     `auth` / `model_not_found` / `context_overflow` fail fast;
//!   * `data:` SSE lines: `[DONE]` ends the stream, Anthropic `error` events
//!     become `server_error`, and the tail buffer is always flushed.

use std::time::Duration;

pub mod provider;

use serde_json::{json, Value};
use thiserror::Error;

// ── Error classification ──

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorReason {
    RateLimit,
    Auth,
    ModelNotFound,
    ContextOverflow,
    ServerError,
    Network,
    Timeout,
    Unknown,
}

impl ErrorReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorReason::RateLimit => "rate_limit",
            ErrorReason::Auth => "auth",
            ErrorReason::ModelNotFound => "model_not_found",
            ErrorReason::ContextOverflow => "context_overflow",
            ErrorReason::ServerError => "server_error",
            ErrorReason::Network => "network",
            ErrorReason::Timeout => "timeout",
            ErrorReason::Unknown => "unknown",
        }
    }

    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            ErrorReason::RateLimit
                | ErrorReason::ServerError
                | ErrorReason::Network
                | ErrorReason::Timeout
        )
    }
}

/// `Display` renders the frozen reason token, so `LlmError`'s `thiserror`
/// template produces the byte-exact `[kora:<reason>] <message>` marker the
/// TypeScript agent parses.
impl std::fmt::Display for ErrorReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// `FromStr` mirrors the frozen token list, so a wire value can be turned back
/// into a reason without a hand-written match at every call site.
impl std::str::FromStr for ErrorReason {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "rate_limit" => Ok(ErrorReason::RateLimit),
            "auth" => Ok(ErrorReason::Auth),
            "model_not_found" => Ok(ErrorReason::ModelNotFound),
            "context_overflow" => Ok(ErrorReason::ContextOverflow),
            "server_error" => Ok(ErrorReason::ServerError),
            "network" => Ok(ErrorReason::Network),
            "timeout" => Ok(ErrorReason::Timeout),
            "unknown" => Ok(ErrorReason::Unknown),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Error)]
#[error("[kora:{reason}] {message}")]
pub struct LlmError {
    pub reason: ErrorReason,
    pub message: String,
}

impl LlmError {
    pub fn new(reason: ErrorReason, message: impl Into<String>) -> Self {
        Self {
            reason,
            message: message.into(),
        }
    }

    /// The `[kora:<reason>]` marker prefix of the rendered message.
    pub fn marker(&self) -> String {
        format!("[kora:{}]", self.reason.as_str())
    }
}

const CONTEXT_OVERFLOW_PATTERNS: [&str; 6] = [
    "context_length_exceeded",
    "maximum context length",
    "context window",
    "too many tokens",
    "input length exceeds",
    "reduce the length",
];

pub fn classify_http_error(status: u16, body: &str) -> ErrorReason {
    match status {
        429 => ErrorReason::RateLimit,
        401 | 403 => ErrorReason::Auth,
        404 => {
            // OpenAI-compatible servers return 404 for unknown model paths too.
            if body.to_lowercase().contains("model") {
                ErrorReason::ModelNotFound
            } else {
                ErrorReason::Unknown
            }
        }
        _ => {
            let lower = body.to_lowercase();
            if CONTEXT_OVERFLOW_PATTERNS.iter().any(|p| lower.contains(p)) {
                return ErrorReason::ContextOverflow;
            }
            if status >= 500 {
                ErrorReason::ServerError
            } else {
                ErrorReason::Unknown
            }
        }
    }
}

pub fn classify_network_error(msg: &str) -> ErrorReason {
    let m = msg.to_lowercase();
    if m.contains("timeout") || m.contains("etimedout") || m.contains("timed out") {
        return ErrorReason::Timeout;
    }
    if m.contains("econnrefused")
        || m.contains("enotfound")
        || m.contains("econnreset")
        || m.contains("epipe")
        || m.contains("ehostunreach")
        || m.contains("enetunreach")
        || m.contains("fetch failed")
        || m.contains("network")
        || m.contains("connection refused")
        || m.contains("connection reset")
    {
        return ErrorReason::Network;
    }
    // Fail fast like Hermes ssl_cert_verification.
    if m.contains("certificate") || m.contains("ssl") {
        return ErrorReason::Unknown;
    }
    ErrorReason::Unknown
}

/// Jittered backoff: `min(15 s, 1 s * 2^(attempt-1)) * (0.7..1.3)`.
pub fn backoff_delay_ms(attempt: u32, rand01: f64) -> u64 {
    let base = (1000_u64.saturating_mul(1 << attempt.saturating_sub(1))).min(15_000);
    (base as f64 * (0.7 + rand01 * 0.6)) as u64
}

/// Jittered backoff honouring `Retry-After` (seconds, capped at 120).
pub fn backoff_with_retry_after_ms(
    attempt: u32,
    rand01: f64,
    retry_after_secs: Option<u64>,
) -> u64 {
    let base = (1000_u64.saturating_mul(1 << attempt.saturating_sub(1))).min(20_000);
    let mut delay = (base as f64 * (0.7 + rand01 * 0.6)) as u64;
    if let Some(secs) = retry_after_secs.filter(|s| *s <= 120) {
        delay = delay.max(secs * 1000);
    }
    delay
}

pub fn sleep_duration(ms: u64) -> Duration {
    Duration::from_millis(ms)
}

// ── Request building (parity with api.ts buildBody/getHeaders) ──

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

pub fn provider_requires_key(provider: &str) -> bool {
    !matches!(provider, "lmstudio" | "ollama" | "llamacpp")
}

pub fn default_model(provider: &str) -> &'static str {
    match provider {
        "anthropic" => "claude-3-5-sonnet-20241022",
        "openrouter" => "openai/gpt-3.5-turbo",
        _ => "gpt-3.5-turbo",
    }
}

pub fn get_endpoint(base_url: &str, provider: &str) -> String {
    if provider == "anthropic" {
        format!("{base_url}/v1/messages")
    } else {
        format!("{base_url}/v1/chat/completions")
    }
}

pub fn get_models_endpoint(base_url: &str, provider: &str) -> Option<String> {
    if provider == "anthropic" {
        return None;
    }
    Some(format!("{base_url}/v1/models"))
}

pub fn build_body(
    messages: &[ChatMessage],
    model: &str,
    provider: &str,
    stream: bool,
    temperature: Option<f64>,
    json_mode: bool,
) -> Value {
    if provider == "anthropic" {
        // Anthropic has no `response_format` — JSON output is prompt-enforced.
        let system = messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone())
            .unwrap_or_default();
        return json!({
            "model": model,
            "max_tokens": 64000,
            "system": system,
            "messages": messages.iter()
                .filter(|m| m.role != "system")
                .map(|m| json!({"role": m.role, "content": m.content}))
                .collect::<Vec<_>>(),
            "stream": stream,
        });
    }

    let mut body = json!({
        "model": model,
        "messages": messages.iter()
            .map(|m| json!({"role": m.role, "content": m.content}))
            .collect::<Vec<_>>(),
        "temperature": temperature.unwrap_or(0.7),
        "stream": stream,
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    body
}

/// `isJsonModeRejected` parity: true when the server rejected the request
/// because of `response_format` — safe to retry once without jsonMode.
/// Auth / model / context errors are never json-mode rejections.
pub fn is_json_mode_rejected(err: &LlmError) -> bool {
    if matches!(
        err.reason,
        ErrorReason::Auth | ErrorReason::ModelNotFound | ErrorReason::ContextOverflow
    ) {
        return false;
    }
    let msg = err.message.to_lowercase();
    msg.contains("response_format")
        || msg.contains("json_object")
        || msg.contains("json mode")
        || msg.contains("json format")
}

// ── SSE parsing (pure, over string chunks — the HTTP layer feeds it) ──

#[derive(Debug, PartialEq)]
pub enum SseEvent {
    /// A text delta.
    Delta(String),
    /// `data: [DONE]` — the stream is complete.
    Done,
    /// An Anthropic-style error event.
    Error(String),
    /// A `data:` line that was not valid JSON (skipped by the TS parser too).
    Skipped,
}

/// Parse one SSE `data:` line payload (already trimmed, `data: ` prefix
/// removed). Mirrors `streamReader`'s per-line handling.
pub fn parse_sse_data(data: &str, provider: &str) -> SseEvent {
    if data == "[DONE]" {
        return SseEvent::Done;
    }
    let parsed: Value = match serde_json::from_str(data) {
        Ok(v) => v,
        Err(_) => return SseEvent::Skipped,
    };
    if provider == "anthropic" {
        match parsed["type"].as_str() {
            Some("content_block_delta") => {
                SseEvent::Delta(parsed["delta"]["text"].as_str().unwrap_or("").to_string())
            }
            Some("error") => SseEvent::Error(
                parsed["error"]["message"]
                    .as_str()
                    .unwrap_or("unknown")
                    .to_string(),
            ),
            _ => SseEvent::Delta(String::new()),
        }
    } else {
        SseEvent::Delta(
            parsed["choices"][0]["delta"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string(),
        )
    }
}

/// Incremental SSE line parser: feed raw network chunks, get events.
/// Keeps the tail (partial line) between chunks; `finish()` flushes it.
#[derive(Default)]
pub struct SseParser {
    buffer: String,
}

impl SseParser {
    pub fn push_chunk(&mut self, chunk: &str, provider: &str) -> Vec<SseEvent> {
        self.buffer.push_str(chunk);
        let mut events = Vec::new();
        let mut consumed = 0;
        // `split_inclusive` keeps the '\n' on every complete line, which is how
        // a complete line is recognised; the trailing partial piece stays in the
        // buffer until its newline arrives (`split('\n')` would drop the
        // delimiter, making every line look partial — no events at all).
        for line in self.buffer.split_inclusive('\n') {
            if !line.ends_with('\n') {
                // partial line — stays in the buffer for the next chunk
                continue;
            }
            consumed += line.len();
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with("data: ") {
                continue;
            }
            events.push(parse_sse_data(&trimmed[6..], provider));
        }
        if consumed > 0 {
            self.buffer.drain(..consumed);
        }
        events
    }

    /// Flush the trailing buffer: some servers end the stream without a final
    /// newline. Never drops the last chunk (the TS contract).
    pub fn finish(&mut self, provider: &str) -> Vec<SseEvent> {
        let tail = std::mem::take(&mut self.buffer);
        let trimmed = tail.trim();
        if trimmed.starts_with("data: ") && &trimmed[6..] != "[DONE]" {
            return vec![parse_sse_data(&trimmed[6..], provider)];
        }
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn err_str(e: LlmError) -> String {
        e.to_string()
    }

    #[test]
    fn marker_is_frozen() {
        let e = LlmError::new(ErrorReason::Network, "boom");
        assert_eq!(e.marker(), "[kora:network]");
        assert_eq!(err_str(e), "[kora:network] boom");
    }

    #[test]
    fn http_classification_parity() {
        assert_eq!(classify_http_error(429, ""), ErrorReason::RateLimit);
        assert_eq!(classify_http_error(401, ""), ErrorReason::Auth);
        assert_eq!(classify_http_error(403, ""), ErrorReason::Auth);
        assert_eq!(
            classify_http_error(404, "model not found"),
            ErrorReason::ModelNotFound
        );
        assert_eq!(classify_http_error(404, "nope"), ErrorReason::Unknown);
        assert_eq!(
            classify_http_error(400, "maximum context length exceeded"),
            ErrorReason::ContextOverflow
        );
        assert_eq!(classify_http_error(500, ""), ErrorReason::ServerError);
        assert_eq!(
            classify_http_error(400, "bad request"),
            ErrorReason::Unknown
        );
    }

    #[test]
    fn network_classification_parity() {
        assert_eq!(
            classify_network_error("connection refused"),
            ErrorReason::Network
        );
        assert_eq!(
            classify_network_error("ECONNRESET while streaming"),
            ErrorReason::Network
        );
        assert_eq!(
            classify_network_error("operation timed out"),
            ErrorReason::Timeout
        );
        assert_eq!(
            classify_network_error("ssl certificate error"),
            ErrorReason::Unknown
        );
        assert_eq!(classify_network_error("weird"), ErrorReason::Unknown);
    }

    #[test]
    fn retryability_parity() {
        for r in [
            ErrorReason::RateLimit,
            ErrorReason::ServerError,
            ErrorReason::Network,
            ErrorReason::Timeout,
        ] {
            assert!(r.is_retryable(), "{} must be retryable", r.as_str());
        }
        for r in [
            ErrorReason::Auth,
            ErrorReason::ModelNotFound,
            ErrorReason::ContextOverflow,
            ErrorReason::Unknown,
        ] {
            assert!(!r.is_retryable(), "{} must fail fast", r.as_str());
        }
    }

    #[test]
    fn backoff_bounds() {
        assert!(backoff_delay_ms(1, 0.0) >= 700 && backoff_delay_ms(1, 1.0) <= 1300);
        assert!(backoff_delay_ms(5, 0.5) <= 15_000, "capped at 15 s");
    }

    #[test]
    fn retry_after_is_honoured_and_capped() {
        assert_eq!(backoff_with_retry_after_ms(1, 0.0, Some(10)), 10_000);
        // > 120 s is ignored (TS: seconds <= 120)
        assert!(backoff_with_retry_after_ms(1, 0.0, Some(500)) < 5_000);
    }

    #[test]
    fn build_body_openai_json_mode() {
        let msgs = vec![ChatMessage {
            role: "user".into(),
            content: "hi".into(),
        }];
        let body = build_body(&msgs, "m1", "openai", false, Some(0.5), true);
        assert_eq!(body["response_format"], json!({"type": "json_object"}));
        assert_eq!(body["temperature"], 0.5);
        let plain = build_body(&msgs, "m1", "openai", false, None, false);
        assert!(plain.get("response_format").is_none());
        assert_eq!(plain["temperature"], 0.7);
    }

    #[test]
    fn build_body_anthropic_has_no_response_format() {
        let msgs = vec![
            ChatMessage {
                role: "system".into(),
                content: "sys".into(),
            },
            ChatMessage {
                role: "user".into(),
                content: "hi".into(),
            },
        ];
        let body = build_body(&msgs, "claude", "anthropic", true, None, true);
        assert!(body.get("response_format").is_none());
        assert_eq!(body["system"], "sys");
        assert_eq!(body["max_tokens"], 64000);
        assert_eq!(body["messages"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn json_mode_rejection_parity() {
        assert!(is_json_mode_rejected(&LlmError::new(
            ErrorReason::Unknown,
            "response_format is not supported"
        )));
        assert!(is_json_mode_rejected(&LlmError::new(
            ErrorReason::Unknown,
            "json_object unsupported"
        )));
        // Auth/model/context errors mentioning the word still fail fast.
        assert!(!is_json_mode_rejected(&LlmError::new(
            ErrorReason::Auth,
            "response_format with bad key"
        )));
        assert!(!is_json_mode_rejected(&LlmError::new(
            ErrorReason::ContextOverflow,
            "json_object too long"
        )));
    }

    #[test]
    fn endpoints_parity() {
        assert_eq!(
            get_endpoint("http://x", "openai"),
            "http://x/v1/chat/completions"
        );
        assert_eq!(
            get_endpoint("http://x", "anthropic"),
            "http://x/v1/messages"
        );
        assert_eq!(
            get_models_endpoint("http://x", "openai").as_deref(),
            Some("http://x/v1/models")
        );
        assert_eq!(get_models_endpoint("http://x", "anthropic"), None);
    }

    #[test]
    fn key_requirement_parity() {
        assert!(!provider_requires_key("lmstudio"));
        assert!(!provider_requires_key("ollama"));
        assert!(!provider_requires_key("llamacpp"));
        assert!(provider_requires_key("openai"));
        assert!(provider_requires_key("anthropic"));
    }

    #[test]
    fn sse_openai_deltas_and_done() {
        let mut p = SseParser::default();
        let events = p.push_chunk(
            "data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\ndata: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\ndata: [DONE]\n",
            "openai",
        );
        assert_eq!(
            events,
            vec![
                SseEvent::Delta("he".into()),
                SseEvent::Delta("llo".into()),
                SseEvent::Done
            ]
        );
    }

    #[test]
    fn sse_anthropic_delta_and_error_event() {
        let mut p = SseParser::default();
        let events = p.push_chunk(
            "data: {\"type\":\"content_block_delta\",\"delta\":{\"text\":\"A\"}}\ndata: {\"type\":\"error\",\"error\":{\"message\":\"bad\"}}\n",
            "anthropic",
        );
        assert_eq!(
            events,
            vec![SseEvent::Delta("A".into()), SseEvent::Error("bad".into())]
        );
    }

    #[test]
    fn sse_tail_is_flushed_not_lost() {
        let mut p = SseParser::default();
        let mut events = p.push_chunk(
            "data: {\"choices\":[{\"delta\":{\"content\":\"par\"}}]}\ndata: {\"choices\":[{\"del",
            "openai",
        );
        assert_eq!(events, vec![SseEvent::Delta("par".into())]);
        // The second line arrives in the next chunk, split mid-JSON.
        events = p.push_chunk("ta\":{\"content\":\"tial\"}}]}\n", "openai");
        assert_eq!(events, vec![SseEvent::Delta("tial".into())]);
        // Stream ends without a final newline — finish() must not drop it.
        p.push_chunk(
            "data: {\"choices\":[{\"delta\":{\"content\":\"end\"}}]}",
            "openai",
        );
        let tail = p.finish("openai");
        assert_eq!(tail, vec![SseEvent::Delta("end".into())]);
    }

    #[test]
    fn sse_malformed_data_is_skipped_not_fatal() {
        let mut p = SseParser::default();
        let events = p.push_chunk("data: not json\ndata: [DONE]\n", "openai");
        assert_eq!(events, vec![SseEvent::Skipped, SseEvent::Done]);
    }
}
