//! kora-rpc/1 — the JSON-RPC 2.0 boundary between the Kora core and every
//! shell (docs/CORE_RPC.md; Rust port of the TypeScript `core/protocol.ts` +
//! `core/dispatch.ts`, which are the reference implementation).
//!
//! Contract that must not change:
//!   * protocol version `kora-rpc/1`, negotiated in `core.hello` once;
//!   * error codes: standard JSON-RPC plus −32001 `kora_error`,
//!     −32002 `not_initialized`, −32003 `denied`, −32004 `timeout`,
//!     −32010 `llm_error` (carrying `data.koraReason`);
//!   * `data.koraReason` keeps the exact `[kora:<reason>]` values;
//!   * framing: one JSON object per line, UTF-8, no pretty-printing;
//!   * notifications (no `id`) never produce a response.

pub mod dispatch;
pub mod protocol;

pub use dispatch::{
    create_dispatch_state, handle_message, method_group, DispatchOptions, DispatchState,
    MethodSpec, MethodTable, RpcHandler, RpcHandlerFuture,
};
pub use protocol::{
    error_response, frame, parse_frame, with_kora_marker, ErrorCodes, ParsedFrame, RpcFailure,
    RpcNotification, RpcRequest, RpcResponse, RpcSuccess, KORA_REASONS, PROTOCOL_VERSION,
};
