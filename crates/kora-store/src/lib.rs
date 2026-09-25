//! Kora persistence layer — `~/.kora/*` without the Electron runtime.
//!
//! Ported from (docs/ROADMAP.md §6.5):
//!   * `electron/services/config.ts`      -> [`config`]  (atomic tmp+rename, write queue, `enc:` keys)
//!   * `electron/ipc/chats.ts`            -> [`chats`]   (sanitise per field, `.corrupt-*` backup)
//!   * `electron/services/mcp/config.ts`  -> [`mcp`]     (server list, defaults, normalisation)
//!   * `electron/services/audit-log.ts`   -> [`audit`]   (JSON lines, 10 MB rotation)
//!
//! Hard rules:
//!   * **file formats are frozen** — existing `~/.kora/*` files must load and round-trip
//!     without losing a single field (docs/ROADMAP.md §6.9);
//!   * every write is atomic (tmp + rename), never in place;
//!   * tests never touch the real `~/.kora` directory — they use `tempfile` dirs.
//!
//! TODO(port): modules are added by the `kora-store` task.
