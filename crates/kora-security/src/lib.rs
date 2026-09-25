//! Kora security core — the Rust port of the project's security modules.
//!
//! Ported (docs/ROADMAP.md §6.2) with parity tests that mirror the TypeScript suite
//! assertion by assertion:
//!
//! | TypeScript source | Rust module | Parity tests |
//! |---|---|---|
//! | `electron/lib/shell-security.ts` | [`shell`] | `tests/parity_shell.rs` |
//! | `electron/lib/regex-security.ts` | [`regex_guard`] | `tests/parity_filesystem.rs` |
//! | `electron/lib/web-security.ts` | [`net`] | `tests/parity_web.rs` |
//! | `src/lib/path-security.ts` + the write blocklist from `electron/ipc/filesystem.ts` | [`path`] | `tests/parity_path.rs` |
//! | — (JS regex semantics, shared by all of them) | [`js_regex`] | `tests/js_semantics.rs` |
//!
//! Rules that survive the port:
//!   * the pipe-to-shell check runs BEFORE command normalisation (normalisation replaces
//!     `|` with a space and would destroy the evidence);
//!   * "every command re-validates its input inside the core" — a UI confirmation is never a
//!     security boundary;
//!   * the functions are pure, so the tests exercise exactly the code the application runs.
//!     The only environment access is [`path::PlatformEnv::current`], which is why the
//!     blocklists take explicit inputs in tests.
//!
//! Deliberate differences from the TypeScript implementation are enumerated in
//! `tests/js_semantics.rs`; every one of them blocks *more*, never less. The reason there are
//! any at all: JS RegExp and the Rust `regex` crate are different languages, and the guard
//! now protects the engine that actually runs the pattern.
//!
//! Not ported yet: `kora-security::policy` — the confirmation / capability model
//! (docs/ROADMAP.md §6.2 and open decision 6).

#![forbid(unsafe_code)]

pub mod js_regex;
pub mod net;
pub mod path;
pub mod regex_guard;
pub mod shell;

