//! Kora persistence layer — `~/.kora/*` without the Electron runtime.
//!
//! Ported from (docs/ROADMAP.md §6.5):
//!   * `electron/services/config.ts`      -> [`config`]  (atomic tmp+rename, `enc:` legacy keys)
//!   * `electron/ipc/chats.ts`            -> [`chats`]   (sanitise per field, `.corrupt-*` backup)
//!   * `electron/services/audit-log.ts`   -> [`audit`]   (JSON lines, 10 MB rotation)
//!
//! Hard rules:
//!   * **file formats are frozen** — existing `~/.kora/*` files must load and round-trip
//!     without losing a single field (docs/ROADMAP.md §6.9);
//!   * every write is atomic (tmp + rename), never in place;
//!   * tests never touch the real `~/.kora` directory — they use `tempfile` dirs.

pub mod atomic;
pub mod audit;
pub mod chats;
pub mod config;

pub use atomic::write_atomic;
pub use audit::AuditLog;
pub use chats::{load_chats, sanitize_chats, save_chats};
pub use config::Config;
