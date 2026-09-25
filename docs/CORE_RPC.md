# CORE RPC — the contract between the Rust core and every shell

> **Status:** design specification (Phase P1 of [`ROADMAP.md`](ROADMAP.md)). Nothing in this file is
> implemented yet on the Rust side; the TypeScript app in `src/` + `electron/` is the reference
> implementation that must keep working unchanged.
>
> **Why this file exists:** during the migration two shells (Electron today, Tauri tomorrow) and a CLI
> have to drive the same core. Without a written contract every shell would re-invent the boundary and
> the "one source of truth" rules of `PROJECT_HANDOFF.md` §12 would rot.
>
> **Last updated:** 2026-09-22.

---

## 1. Shape of the thing

```
┌────────────────────────────┐        kora-rpc/1        ┌────────────────────────────┐
│ shell: Electron | Tauri    │  newline-delimited       │ kora-core (Rust)           │
│ window.kora.* adapter      │◄──── JSON-RPC 2.0 ──────►│ security · store · llm ·   │
│ kora-cli (headless)        │        over stdio        │ mcp · agent loop          │
└────────────────────────────┘                          └────────────────────────────┘
```

The core is a **process**, not a library call, for three reasons: it can be reused by a browser front
later, a crash cannot take the UI down, and the renderer keeps the same "no Node, no direct syscalls"
posture it has today.

## 2. Transport and framing

| Aspect | Decision |
|---|---|
| Encoding | UTF-8 text, one JSON object per line (`\n`), no pretty-printing |
| Protocol | JSON-RPC 2.0 |
| Version | `kora-rpc/1` — declared in `core.hello`, negotiated once at startup |
| Streams | stdin/stdout = protocol only; **stderr = logs** (never parsed as protocol) |
| Correlation | `id` is an integer, monotonically increasing per direction; notifications carry no `id` |
| Backpressure | the core may emit notifications at any rate; a shell must not block stdout while handling one |

This mirrors the MCP transport Kora already speaks (`electron/services/mcp/protocol.ts`), so one client
implementation in Rust can serve both MCP servers and the Kora core.

## 3. Handshake

1. Shell → `core.hello` `{ "client": "kora-desktop", "clientVersion": "2.0.0-alpha.1", "protocol": "kora-rpc/1" }`
2. Core → result `{ "coreVersion": "2.0.0-alpha.1", "protocol": "kora-rpc/1", "capabilities": ["fs","shell","system","ai","config","chats","tts","web","mcp","agent","obsidian"], "dataDir": "C:\\Users\\<user>\\.kora" }`
3. Any request before a successful `core.hello` → error `-32002` (`not_initialized`).

Unknown capabilities must be ignored by the shell, not fatal: that is how a future core can add
features without breaking an older UI.

## 4. Error model

JSON-RPC error object, with Kora-specific data:

```json
{ "jsonrpc": "2.0", "id": 7, "error": {
    "code": -32010,
    "message": "rate limited by provider",
    "data": { "koraReason": "rate_limit", "retryable": true, "detail": "..." } } }
```

| Code | Meaning |
|---|---|
| `-32700` / `-32600` / `-32601` / `-32602` / `-32603` | standard JSON-RPC parse/invalid-request/method-not-found/invalid-params/internal |
| `-32001` | `kora_error` (domain failure, details in `data.detail`) |
| `-32002` | `not_initialized` |
| `-32003` | `denied` — the capability/permission model refused the call (§6) |
| `-32004` | `timeout` |
| `-32010` | `llm_error` — carries `data.koraReason` |

**Compatibility rule:** the LLM failure reason inside `data.koraReason` keeps the exact values of the
current marker `[kora:<reason>]` (`rate_limit`, `auth`, `model_not_found`, `context_overflow`,
`server_error`, `network`, `timeout`, `unknown`). The core additionally **renders** the legacy marker
into the message text so existing renderer logic keeps working during the transition.

---

## 5. Method map — the 59 existing channels + the agent

Every method that exists today keeps its name, argument order and return shape. The Electron shell
becomes a thin adapter: `window.kora.fs.readFile(path, maxBytes)` →
`request("fs.readFile", [path, maxBytes])`. Renaming fields during the port is forbidden — the renderer
and the 100 tests are the specification.

| Domain | Methods | Today |
|---|---|---|
| `window` | `minimize`, `maximize`, `close`, `isMaximized` | `electron/main.ts` |
| `system` | `info`, `processes`, `openApp`, `killProcess`, `shutdown`, `restart`, `sleep`, `lock`, `volume`, `volumeUp`, `volumeDown`, `mute`, `brightness`, `windows` | `electron/ipc/system.ts` |
| `fs` | `readDir`, `readFile`, `writeFile`, `patchFile`, `grep`, `homeDir`, `deleteFile`, `rename`, `copy`, `mkdir`, `stat`, `exists`, `findFiles` | `electron/ipc/filesystem.ts` |
| `shell` | `execute` | `electron/ipc/shell.ts` |
| `ai` | `chat`, `chatStream`, `listModels`, `testConnection` | `electron/ipc/ai.ts` + `services/api.ts` |
| `config` | `get`, `set` | `electron/services/config.ts` |
| `chats` | `load`, `save`, `saveSync` | `electron/ipc/chats.ts` |
| `tts` | `synthesize`, `voices` | `electron/services/tts.ts` |
| `clipboard` | `read`, `write` | `electron/ipc/clipboard.ts` |
| `web` | `search`, `fetch` | `electron/ipc/web.ts` |
| `mcp` | `list`, `getConfig`, `listTools`, `start`, `stop`, `restart`, `upsert`, `remove`, `setEnabled`, `call`, `diagnostics` | `electron/services/mcp/*` |
| `obsidian` | `scan`, `readNote`, `pickVault` | `electron/ipc/obsidian.ts` |
| **`agent`** | **`startCycle`, `resumeAfterConfirmation`, `cancel`, `status`** | new — the loop currently lives in the renderer (`src/agent/*`), it moves into the core |

**Params.** Positional arrays are allowed for the ported methods (they mirror the current signatures
exactly); new methods use named objects. Both are `params` of a JSON-RPC request:
`{"jsonrpc":"2.0","id":12,"method":"fs.readFile","params":["C:\\x.txt",1024]}`.

**Return values.** Exactly what the IPC handler returns today (`{ success, error, data }` style where it
exists) — a shell must never have to reinterpret a payload during the migration.

## 6. Capabilities and permissions

The core enforces policy, the shell only asks. Two layers:

1. **Capability groups** declared in `core.hello`. A shell that omits `mcp` cannot call `mcp.*`
   (error `-32003 denied`). This is the clean separation the audit asked for (see
   `PROJECT_HANDOFF.md` §13, "capability-based permissions in preload").
2. **Confirmation flow** for dangerous operations — unchanged semantics, moved into the core:
   the core does **not** execute a dangerous tool; it answers
   `{ "status": "pending_confirmation", "tool": "...", "description": "..." }` and waits for
   `agent.resumeAfterConfirmation { approved: true|false, token }`. The `token` binds the approval to
   that exact request (single use), so a stale UI cannot approve something else — this replaces the
   boolean `bypassConfirm` flag the renderer passes around today.

`shell.execute` keeps the same rule as today: the main process (now the core) re-validates the command
with `kora-security::shell` even when the caller claims the user already confirmed.

---

## 7. Streaming

Long operations never block a JSON-RPC response. They return a handle and then push notifications.

**Chat streaming** (replaces `ai:chatStream` + the per-call reply channel):

| Direction | Message | Payload |
|---|---|---|
| shell → core | `ai.chatStream` (request) | `{ messages, options }` → result `{ streamId }` |
| core → shell | `ai.delta` (notification) | `{ streamId, text }` — raw token deltas, **not** coalesced (the CLI wants them raw) |
| core → shell | `ai.done` | `{ streamId }` |
| core → shell | `ai.error` | `{ streamId, message, koraReason }` |
| shell → core | `ai.abort` (request) | `{ streamId }` → result `{ aborted: true }` |

**Compatibility:** the Electron adapter synthesises the legacy control strings (`[DONE]`, `[ERROR] <msg>`,
`[ABORT]`) for the renderer, so `useChat.ts` keeps working byte-for-byte during the transition. The
60 ms render coalescing stays in the UI layer (see `PROJECT_HANDOFF.md` §11).

**Agent cycles** (the loop moves from `src/agent/*` into the core):

| Direction | Message | Payload |
|---|---|---|
| shell → core | `agent.startCycle` (request) | `{ input, config }` → result `{ cycleId }` |
| core → shell | `agent.thought` | `{ cycleId, text }` — live transcript for `AgentDisplay` |
| core → shell | `agent.toolRequest` | `{ cycleId, tool, params, requiresConfirmation }` |
| core → shell | `agent.pendingConfirmation` | `{ cycleId, token, tool, description }` |
| core → shell | `agent.toolResult` | `{ cycleId, tool, ok, summary }` (already bounded, ~2 KB) |
| core → shell | `agent.finished` | `{ cycleId, success, answer?, error? }` |
| shell → core | `agent.resumeAfterConfirmation` | `{ cycleId, token, approved }` → result `{ resumed: true }` |
| shell → core | `agent.cancel` | `{ cycleId }` |

The iteration budget, loop guard, degenerate-repetition detector, error bounding and the grounding guard
(`docs/PROJECT_HANDOFF.md` §4.3) move into the core with their tests.

## 8. Event pushes (core → shell notifications)

| Notification | Replaces (today) |
|---|---|
| `window.maximizedChanged { maximized }` | the `onMaximizedChange` ipc event |
| `mcp.changed { }` | `mcp:onChanged` |
| `config.changed { key, value }` | renderer polling / manual refresh |

## 9. Division of labour after the migration

| Layer | Owns |
|---|---|
| **Core** (`kora-*` crates) | security policy, path/shell/web rules, storage, LLM gateway, MCP lifecycle, the agent loop, confirmation tokens |
| **Shell** (Tauri/Electron) | window chrome, React UI, i18n, themes, markdown rendering, graph canvas, audio playback of synthesised speech |
| **CLI** (`kora-cli`) | headless use of the same core: stream `agent.*` notifications to stdout |

Audio: `tts.synthesize` returns audio bytes from the core (the Edge-TTS port), but decoding and playing
stays in the shell — the core never touches an audio device.

## 10. Non-goals and open questions

**Non-goals for v1:** HTTP/REST transport (localhost HTTP may come later for a web front — the method
names are deliberately transport-agnostic), multi-core multiplexing (one core process per shell), remote
cores (the core is local-only by design).

**Open questions to answer before P4:**
1. Binary payloads: v1 sends bytes base64-encoded inside JSON; revisit if file writes of tens of MB
   become common (the current cap is 5 MB per read, `PROJECT_HANDOFF.md` §8.2).
2. Does the core supervise MCP servers as its own children (recommended: one process tree, one kill
   path) or as detached processes? Windows tree-kill semantics favour children.
3. How does a Tauri webview receive notifications — an event channel or polling? Needs a spike, not a
   guess.
4. Does `kora-cli` ship in the same binary as the core (single file, `--headless`) or separately?
