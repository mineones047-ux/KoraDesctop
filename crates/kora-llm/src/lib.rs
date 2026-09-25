//! Kora LLM gateway — the Rust port of `electron/services/api.ts` (docs/ROADMAP.md §6.1, §7).
//!
//! Responsibilities:
//!   * provider resolution: `lmstudio`, `ollama`, OpenAI-compatible (`openai`, `gemini`, `groq`,
//!     `deepseek`, `mistral`, `xai`, `custom`), `anthropic` (own body/headers), `openrouter`;
//!   * error classification into [`ErrorReason`] and the **frozen cross-process marker**
//!     `[kora:<reason>]` embedded in the error message (the renderer and the agent parse it);
//!   * retry with jittered backoff + `Retry-After`, only for retryable reasons
//!     (`rate_limit`, `server_error`, `network`, `timeout`); auth/model_not_found fail fast;
//!   * SSE streaming: `data:` line parsing, `[DONE]`, Anthropic error events, abort support and a
//!     final flush of the tail buffer so the last chunk is never lost.
//!
//! Contract that must not change: `[kora:<reason>]` markers and the stream terminators
//! `[DONE]` / `[ERROR] ` / `[ABORT]` are byte-compatible across processes.
//!
//! TODO(port): modules are added by the `kora-llm` task.
