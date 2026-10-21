//! Kora agent core — the Rust port of `src/agent/*` (docs/ROADMAP.md §6.4).
//!
//! Contract that must not change (docs/CORE_RPC.md §4/§6/§7):
//!   * the `[kora:<reason>]` marker and the decision protocol
//!     "one JSON object" are cross-process contracts;
//!   * `<tool_output>` markers + sanitisation wrap every observation;
//!   * every tool re-validates its input inside the core (`kora-security`).
//!
//! Modules: [`guards`] (budget/loop/repetition), [`decision`] (the single
//! JSON-object protocol), [`tools`] (registry + built-ins), [`loop_agent`]
//! (the think → call_tool → observe → finish cycle).

pub mod decision;
pub mod guards;
pub mod loop_agent;
pub mod tools;

pub use decision::{parse_agent_response, AgentDecision, DecisionAction};
pub use guards::{
    backoff_delay_ms, backoff_delay_ms_jittered, bound_tool_error, detect_degenerate_repetition,
    is_empty_response, is_retryable_reason, parse_llm_error_reason, IterationBudget, ToolLoopGuard,
};
pub use loop_agent::{
    build_core_system_prompt, entry_tokens, estimate_tokens, extract_path, fit_to_token_budget,
    is_file_system_query, parse_agent_response as parse_decision, run_cycle, sanitize_tool_output,
    summarize_result, wrap_tool_output, AgentEvent, AgentLlmOptions, CycleOutcome, LlmGateway,
    MemoryEntry, MAX_AGENT_STEPS, MAX_TOOL_OUTPUT, RETRY_CORRECTIONS,
};
pub use tools::{build_tool_list, tool_error, Tool, ToolMetadata, ToolRegistry, ToolResult};
