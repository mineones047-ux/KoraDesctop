//! Kora MCP client and manager — the Rust port of `electron/services/mcp/*`
//! (docs/ROADMAP.md §6.1, §7; protocol contract in `electron/services/mcp/protocol.ts`).
//!
//! Wire format: JSON-RPC 2.0, newline-delimited, over stdio.
//! Protocol version: `2024-11-05` (must match `MCP_PROTOCOL_VERSION`).
//!
//! Responsibilities:
//!   * [`client`] — one server connection: spawn (no shell), `initialize`,
//!     `notifications/initialized`, `tools/list`, `tools/call`, request/startup timeouts,
//!     stderr tail (last 50 lines) for diagnostics;
//!   * [`manager`] — lifecycle: start mutex (no double spawn), lazy start on first use,
//!     restart, stop with the **whole process tree** killed on Windows (`taskkill /T /F`,
//!     fixes the zombie `npx -> node` problem documented in FIXES.md);
//!   * unknown tools are never executed blindly; MCP servers are treated as untrusted.
//!
//! Preferences for the port: no `npx` spawning, tool metadata must keep the
//! `mcp__<server>__<tool>` naming used by the agent registry.
//!
//! TODO(port): modules are added by the `kora-mcp` task.
