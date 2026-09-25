# PROJECT_HANDOFF — full technical context for Kora

> **Purpose of this file:** a complete, self-contained technical brief about this repository.
> It is written so that a *new contributor or an AI agent* can understand **how the project works,
> why it is built this way, where every piece lives, and what to avoid breaking** — without
> reverse-engineering the code.
>
> Read this together with:
> - [`README.md`](../README.md) — what the product is, how to install/run/build
> - [`ARCHITECTURE.md`](ARCHITECTURE.md) — narrative architecture overview
> - [`FIXES.md`](FIXES.md) — chronological journal of every fix/optimisation (the authoritative history)
> - [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md) / [`SECURITY_FIXES.md`](SECURITY_FIXES.md) / [`CODE_REVIEW.md`](CODE_REVIEW.md) — dated audit snapshots
>
> **Last updated:** 2026-09-25 (Phase 0 in the working tree; public baseline commit `9fa2481`, release `1.0.0`).

---

## 1. Project at a glance

| | |
|---|---|
| Product | **Kora** — local-first AI desktop assistant (JARVIS-style) |
| Type | Electron desktop app: React UI + privileged Node main process |
| Source of truth | This repository (`main` branch) |
| Repo on GitHub | https://github.com/mineones047-ux/KoraDesctop |
| Language | TypeScript (strict) everywhere; JSX in the renderer |
| Renderer | React 18 + Vite 5 + Tailwind CSS 3 |
| Main process | Electron 44.4.5 (Chromium 152), plain Node APIs |
| Tests | Vitest 4 — **138 tests / 12 files**, plus 46 `cargo test` cases in `crates/kora-security` |
| Persistence | Plain JSON files in `~/.kora/` (no database) |
| License | MIT (`LICENSE`, mirrored in `package.json#license`) |
| Current release | `1.0.0` — installer asset `Kora-Setup-1.0.0.exe` on the Releases page |

**Core idea:** the renderer never touches Node. Every privileged action (filesystem, shell,
network, TTS, MCP, config, audit) goes through explicit IPC channels exposed as `window.kora.*`.
Security is enforced in the **main** process; the renderer's own checks are only a convenience layer.

---

## 2. Repository layout (what lives where)

```
KoraDesctop/
├─ index.html                  # Vite entry; CSP meta tag; Google Fonts
├─ package.json                # scripts, deps, electron-builder "build" config, metadata
├─ vite.config.ts              # Vite: alias "@/" -> src/, base './', target esnext, port 5173 (strict)
├─ tsconfig.json               # renderer typecheck (noEmit), strict, paths "@/*"
├─ tsconfig.electron.json      # main-process typecheck only (noEmit; the build is scripts/build-main.cjs)
├─ tsconfig.node.json          # composite, typechecks vite.config.ts only
├─ postcss.config.js           # Tailwind + autoprefixer
├─ tailwind.config.js          # kora-* colour tokens from CSS variables, fonts, animations
├─ start.bat                   # Windows launcher: build-main (esbuild) -> vite -> electron (manual dev path)
├─ .gitignore                  # node_modules, dist*, release, *.log, *.tsbuildinfo, .env*
├─ .gitattributes              # LF in repo, CRLF only for *.bat
├─ LICENSE                     # MIT
├─ README.md                   # EN product readme (GitHub landing page)
├─ README.ru.md                # RU readme (kept for the maintainer)
├─ scripts/
│  ├─ dev.cjs                  # `npm run dev`: port preflight (5173), spawns vite + electron-dev
│  ├─ electron-dev.cjs         # build-main (esbuild) -> wait for vite -> electron; retries once with --disable-gpu
│  ├─ build-main.cjs           # esbuild bundle: main.ts + preload.ts + self-contained MCP servers -> dist-electron/
│  ├─ after-pack.cjs           # electron-builder afterPack hook: embeds build-assets/icon.ico via rcedit
│  └─ generate-icon.ps1        # re-runnable icon generator (PowerShell + System.Drawing) -> build-assets/icon.ico
├─ src/                        # RENDERER (see §4)
│  ├─ main.tsx                 # ReactDOM entry
│  ├─ App.tsx                  # composition: TitleBar/Sidebar/Chat|Graph/Settings/System/Agent
│  ├─ config.ts                # CONFIG — the only renderer limits actually consumed
│  ├─ types/index.ts           # all shared types + PROVIDERS, THEMES, COMMANDS, PROMPT_TEMPLATES
│  ├─ i18n/{en,ru}.ts          # UI strings, `en` is the type source of truth
│  ├─ styles/global.css        # theme CSS variables, drag regions, scrollbars
│  ├─ hooks/                   # useChat, useUnifiedChat, useConfig, useSystem, useTTS,
│  │                           # useSpeechRecognition, useI18n
│  ├─ agent/                   # ReAct agent (orchestrator, planner, memory, guards,
│  │                           # tool-registry, intent, prompts) + __tests__
│  ├─ lib/                     # commands (! commands), path-security, resolve-provider,
│  │                           # tts-speech + __tests__
│  ├─ components/              # Chat, Sidebar, Settings (+MCPSettings), Graph, System, Agent, Layout
│  └─ __tests__/ patterns live next to the code (src/**/__tests__)
├─ electron/                   # MAIN PROCESS (see §4)
│  ├─ main.ts                  # window, security hardening, handler registration
│  ├─ preload.ts               # contextBridge -> window.kora.* (the only bridge)
│  ├─ ipc/*.ts                 # one file per IPC domain (fs, shell, web, system, ai, mcp, tts,
│  │                           #  chats, clipboard, obsidian)
│  ├─ lib/*.ts                 # PURE security modules shared with tests (shell/regex/web)
│  └─ services/                # api.ts (LLM gateway), config.ts, tts.ts, audit-log.ts, mcp/
└─ docs/                       # this documentation set
```

**Build outputs (never commit):** `dist/` (renderer), `dist-electron/` (main), `release/`
(electron-builder output incl. `Kora-Setup-<version>.exe`), `*.tsbuildinfo`, logs.

---

## 3. Runtime architecture

```
┌────────────────────────────┐                        ┌───────────────────────────────┐
│  RENDERER (React, src/)    │                        │  MAIN (Electron, electron/)   │
│                            │                        │                               │
│  App.tsx                   │                        │  main.ts                      │
│   └─ useUnifiedChat ───────┼── window.kora.ai ─────►│   └─ ipc/ai.ts ──► services/api.ts
│       ├─ useChat           │                        │                               │
│       └─ useReActAgent ────┼── window.kora.* ──────►│   └─ ipc/*.ts ──► services/*  │
│           └─ tool-registry │                        │                               │
└────────────────────────────┘                        └───────────────────────────────┘
```

- **Sandbox**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  (`electron/main.ts`). No `nodeIntegrationInSubFrames`, webviews are blocked
  (`will-attach-webview` → `preventDefault`).
- **preload.ts** is the *only* bridge. It `contextBridge.exposeInMainWorld('kora', {...})` and
  exposes namespaced groups: `window`, `system`, `fs`, `shell`, `ai`, `config`, `chats`, `tts`,
  `clipboard`, `web`, `mcp`, `obsidian`. Every method is a thin `ipcRenderer.invoke` /
  `ipcRenderer.send` wrapper — no business logic in the preload.
- **Window**: frameless (`frame: false`), custom `TitleBar.tsx`, min 800×600, theme colour `#0a0a0a`.
- **Navigation lockdown**: `will-navigate` allows only (a) the exact dev-server `host:port`
  (never `startsWith` — that would allow `localhost:5173.evil.com`) or (b) the exact packaged
  `index.html`; `window.open` is denied and external URLs are handed to `shell.openExternal`.
- **Console/error plumbing**: renderer `console.error` and crashes are forwarded to the main
  process log (`render-process-gone`, `did-fail-load`).
- **Dev bootstrapping**: `npm run dev` → `scripts/dev.cjs` (fails fast if port 5173 is taken, and
  names the offending process) → spawns Vite and `scripts/electron-dev.cjs`
  (tsc → wait for Vite → `electron .`; if Electron dies with the known GPU crash exit code it is
  restarted once with `--disable-gpu`). `VITE_DEV_SERVER_URL` is set for the main process.

### 3.1 The `window.kora.*` surface (complete)

| Group | Methods (all `invoke` unless noted) |
|---|---|
| `window` | `minimize`, `maximize`, `close`, `isMaximized` (sync), `onMaximizedChange` (event) |
| `system` | `getInfo`, `getProcesses`, `openApp`, `killProcess`, `shutdown`, `restart`, `sleep`, `lock`, `volume`, `volumeUp`, `volumeDown`, `mute`, `brightness`, `windows` |
| `fs` | `readDir`, `readFile(path, maxBytes?)`, `writeFile`, `patchFile(path, oldText, newText, replaceAll?)`, `grep(dir, pattern, opts)`, `getHomeDir`, `deleteFile`, `rename`, `copy`, `mkdir`, `stat`, `exists`, `findFiles(pattern, opts)` |
| `shell` | `execute(command, { bypassDangerCheck? })` |
| `ai` | `chat`, `chatStream` (see §6), `listModels`, `testConnection` |
| `config` | `get`, `set(key, value)` |
| `chats` | `load`, `save`, `saveSync` |
| `tts` | `synthesize(text, voice?)`, `voices` |
| `clipboard` | `read`, `write` |
| `web` | `search`, `fetch(url)` |
| `mcp` | `list`, `getConfig`, `listTools`, `start`, `stop`, `restart`, `upsert`, `remove`, `setEnabled`, `call`, `diagnostics`, `onChanged` (event) |
| `obsidian` | `scan`, `readNote`, `pickVault` |

**Rule for contributors:** never add a bridge method that the main process does not validate
(defensively) on the other side.

---

## 4. End-to-end flows

### 4.1 Every user message: the routing fork

Entry point is **`useUnifiedChat.sendMessage(content, config, t)`** (`src/hooks/useUnifiedChat.ts`):

```
sendMessage
  ├─ needsAgent(content) === false  → useChat.sendMessage   (chat / ! commands)
  └─ needsAgent(content) === true   → agent.startCycle      (tool-backed task)
```

`needsAgent()` (`src/agent/intent.ts`) is a **deterministic, rule-based** classifier — no LLM call:
- `!command` prefix → never the agent (it is a chat command).
- Conversational overrides (`привет`, `как ты`, `hello`, `thanks`, …) → never the agent.
- Otherwise the agent is used when the text matches tool-intent patterns (file/shell/web verbs in
  EN and RU) **or** contains a filesystem-looking path (`C:\…`, `~/…`, `/Users/…`, `/home/…`).

### 4.2 Chat pipeline (`src/hooks/useChat.ts`)

1. A chat is created on demand; the user message is appended with `crypto.randomUUID()`.
2. The LLM is called through `window.kora.ai.chatStream(messages, options, onChunk)`.
   - `options` comes from `resolveProviderConfig(config)` (`src/lib/resolve-provider.ts`) plus
     `temperature`.
3. **Stream protocol** (see §6): chunks arrive as plain-text deltas; the terminator arrives as a
   control string — `'[DONE]'`, `'[ERROR] <message>'` or `'[ABORT]'`.
4. **Render coalescing**: tokens accumulate in `acc`, but `updateMessage` fires at most once per
   `CONFIG.stream.RENDER_INTERVAL_MS` (60 ms). `done()` always flushes the final text, so nothing is
   lost on `[DONE]`, error, timeout or Stop.
5. Retries: one automatic retry for retryable stream errors (`[kora:rate_limit|server_error|network|
   timeout]`) when nothing has been streamed yet.
6. Timeouts: `CONFIG.stream.TIMEOUT_MS` (120 s) — on timeout the partial text is kept with a notice.
7. Stop: the renderer sends `'[ABORT]'` on the control channel; a finisher map resolves the promise
   immediately so the UI never hangs; partial content is preserved.
8. `!` commands found in the **model's** reply are *never* auto-executed — they are rendered as text
   with an informational notice (anti prompt-injection decision).
9. Persistence: chats are saved (debounced by `CONFIG.chat.SAVE_DEBOUNCE_MS`) via `chats:save`, and
   synchronously via `chats:saveSync` on window close.

### 4.3 The ReAct agent loop (`src/agent/orchestrator.ts`)

`startCycle(query, llmOptions)` → `runStep()` recursively, bounded by `CONFIG.agent.MAX_STEPS` (15)
through `IterationBudget`:

1. **Context build** — `buildSystemPrompt()` (`prompts.ts`) lists every tool with its parameters and
   confirmation flag, plus the `!` command cheat-sheet; memory history is appended
   (`memory.ts`, refs to avoid stale closures).
2. **Decision** — the model must answer with a single JSON object:
   `{"thought": "...", "action": "call_tool", "tool": "<id>", "parameters": {...}}`
   or `{"thought": "...", "action": "finish", "answer": "..."}`.
   `parseAgentResponse()` tolerates markdown fences and extracts the first `{...}` block.
3. **Failure policy** (`guards.ts`, ported from the Hermes agent):
   - invalid JSON → up to 2 corrective prompts (`RETRY_CORRECTIONS`);
   - empty response twice → stop;
   - degenerate repetition → `detectDegenerateRepetition()` → finish with what we have;
   - `rate_limit | server_error | network | timeout` → exponential jittered backoff
     (`backoffDelayMs`) then retry; `auth | model_not_found | context_overflow` → fail fast;
   - context overflow → drop the older half of the history once, then retry.
4. **Anti-loop guards** — `ToolLoopGuard` records `(tool, params-hash, result-hash)` and injects a
   synthetic warning into the conversation on identical repeated calls or long same-tool streaks;
   `boundToolError()` caps a single tool error at ~2 KB so it cannot flood the context.
5. **Tool execution** — `agentRegistry.execute(tool, params, { approved })` (see §5).
6. **Grounding guard** — if the user's request looks filesystem-related (`FS_QUERY_REGEX`) and no
   tool has been used yet, the agent *forcibly* calls `dir` on the path extracted from the request
   before trusting the model (hallucination defence).
7. **Abort discipline** — `abortRef`/`runningRef` are checked after the LLM call and before tool
   execution, so Stop can never execute an already-received decision.
8. **Result** — `finishCycle()` produces `ReActResult { success, answer?, error? }`, which
   `useUnifiedChat` appends to the same chat as an assistant message. The live "thinking" transcript
   is shown by `AgentDisplay.tsx` (coalesced updates).
9. **Dangerous tools** return `{ status: 'pending_confirmation' }` instead of executing; the UI shows
   a modal and calls `resumeAfterConfirmation(approved)` to proceed, or feeds the agent a
   "denied by user" observation.

### 4.4 Tools (`src/agent/tool-registry.ts` + `planner.ts`)

Built-in ids: `shell, file, patch_file, grep, open, dir, write, rename, delete, mkdir, stat, exists,
help, volume, mute, brightness, windows, shutdown, restart, sleep, lock, search, clipboard,
ai_chat, ai_list_models, ai_test_connection, tts_synthesize, tts_voices`,
plus dynamic `mcp__<server>__<tool>`.

**Confirmation required:** `shell, file, patch_file, open, write, rename, delete, mkdir,
shutdown, restart, sleep, lock, clipboard`.
**No confirmation:** `grep, dir, stat, exists, help, volume, mute, brightness, windows, search,
ai_chat, ai_list_models, ai_test_connection, tts_synthesize, tts_voices`.

Rules baked into the registry:
- unknown built-in id → `throw`;
- unknown MCP tool → **never executed blindly** (`Unknown MCP tool: ...`);
- MCP tool metadata (JSON Schema → parameter descriptions) is refreshed at every `startCycle()`;
- MCP servers are untrusted: their `destructiveHint` enables confirmation, and calls go through
  `window.kora.mcp.call` with `bypassDangerCheck: true` only after explicit user approval;
- every handler failure is caught and returned as `{ success: false, error }` — it never throws into
  the agent loop.

### 4.5 `!` commands (`src/lib/commands.ts`, executed by `useChat`)

Handled **before** any LLM call. Command regex: `!(shell|file|open|dir|write|rename|delete|mkdir|
stat|exists|help|calc|random|uuid|time|shutdown|restart|sleep|lock|volume|mute|brightness|windows|
find|clipboard|search|confirm|deny)`.

`DANGEROUS_COMMANDS = { shell, file, delete, write, rename, mkdir, open, shutdown, restart }`
require `!confirm` / `!deny` (`pendingConfirmRef`, and the confirmed retry passes
`bypassConfirm=true`). `!calc` uses a hand-written recursive-descent parser — **no `eval`**.

---

## 5. Security model (defence in depth)

The design rule: **the renderer is untrusted**. All checks below are enforced in the *main* process;
the renderer duplicates a few of them only for nicer UX errors.

| # | Layer | Where | What it does |
|---|---|---|---|
| 1 | Electron hardening | `electron/main.ts` | sandbox, contextIsolation, no Node in renderer, webviews blocked, navigation pinned to the exact dev host / packaged `index.html`, external links → `shell.openExternal` |
| 2 | Path safety | `electron/ipc/filesystem.ts` | `resolveSafePath()` (strip quotes, expand `~`, `path.resolve`, ≤4096 chars) + `assertNotBlockedWrite()` against System32, SysWOW64, Boot, `C:\`, Program Files (x2), ProgramData, Startup, `.ssh`, `.gnupg` and the Unix equivalents |
| 3 | Path pre-check (UX) | `src/lib/path-security.ts` | `validatePath` / `validatePathRead` — blocks drive roots, system dirs, null bytes, `..`; **not** a security boundary by itself |
| 4 | Shell filter | `electron/lib/shell-security.ts` | `isDangerousCommand()`: **pipe-to-shell patterns are checked BEFORE normalisation** (normalisation replaces `\|` with a space and would destroy the evidence), then dangerous ops on the normalised string: `format/del/rd/rmdir/rm -rf`, `Invoke-WebRequest/RestMethod`, `Start-BitsTransfer`, `certutil -urlfetch`, `Stop-Process/Service/NetAdapter`, `Remove-Item`, `Set-ExecutionPolicy`, `regsvr32`, `reg add/delete`, `shutdown/poweroff/reboot/halt`, `diskpart/mkfs/fdisk`, `taskkill`, `netsh interface`, `ipconfig /renew|release` |
| 5 | Grep safety | `electron/lib/regex-security.ts` | `isUnsafeRegex()` rejects catastrophic backtracking (nested quantifiers, overlapping adjacent quantifiers, duplicate alternation branches, double quantifiers, incomplete quantifiers like `a{1,`), patterns > 200 chars; `matchGlob()` for the `include` filter; walk depth-limited, skips `node_modules`, `.git`, hidden dirs, symlinks |
| 6 | SSRF guard | `electron/lib/web-security.ts` | only `http:`/`https:`; blocks `localhost`, `127.`, `10.`, `172.16-31.`, `192.168.`, `169.254.`, `0.0.0.0`, IPv6 ULA/link-local; response body capped at 5 MB |
| 7 | Blocked open paths | `electron/ipc/system.ts` | `openApp` refuses cmd/powershell/regedit/msconfig/taskmgr and `/bin/sh`, `/bin/bash`, `sudo` |
| 8 | Secret storage | `electron/services/config.ts` | API keys encrypted with `safeStorage`, stored as `enc:<base64>`; legacy plaintext keys are migrated on first save |
| 9 | Atomic writes | `config.ts`, `chats.ts`, `mcp/config.ts` | tmp file (+ crypto suffix, mode 0600 for config) → `rename`; write queues to serialise; corrupted `chats.json` is backed up to `.corrupt-*` |
| 10 | Audit trail | `electron/services/audit-log.ts` | every shell execution is appended to `~/.kora/audit.log` (JSON lines, 10 MB rotation) |
| 11 | Human confirmation | `tool-registry.ts`, `commands.ts` | dangerous tools and `!` commands require explicit approval; `bypassDangerCheck`/`bypassConfirm` are only set *after* the user approves |
| 12 | No auto-execution | `useChat.ts` | commands inside model output are displayed as text, never run |

**Testing note:** layers 4–6 are pure modules in `electron/lib/` precisely so that Vitest imports the
same code the main process runs (see §9).

---

## 6. Protocols and contracts

### 6.1 AI streaming (`window.kora.ai.chatStream`)

- The renderer invents a one-shot channel: `ai:stream:<Date.now()>_<rand>` and
  `ipcRenderer.send('ai:chatStream', messages, options, channel)`.
- It then listens on `channel` (payloads) and `` `${channel}:ctl` `` (control).
- **Main → renderer payloads**: plain text deltas, or control strings:
  - `'[DONE]'` — always sent in `finally` (normal end);
  - `'[ERROR] <message>'` — failure (message may embed a `[kora:<reason>]` marker).
- **Renderer → main control**: `'[ABORT]'` on the ctl channel → main aborts the `AbortController`.
- `ipc/ai.ts` removes its ctl listener in `finally`; LM Studio/Ollama go through
  `services/lmstudio.ts`, which is a thin wrapper over the same `APIClient`.

### 6.2 Error markers

`services/api.ts` throws `LlmError` whose message is prefixed `[kora:<reason>]`, where
`reason ∈ { rate_limit, auth, model_not_found, context_overflow, server_error, network, timeout,
unknown }`. `parseLlmErrorReason()` (`agent/guards.ts`) extracts it from any error/string;
`isRetryableReason()` defines the retryable subset. **Keep this marker format stable** — both the
renderer and the agent depend on it.

### 6.3 Agent decision protocol

The model's reply must be a single JSON object (`{"thought","action":"call_tool"|"finish","tool"?,
"parameters"?,"answer"?}`). `parseAgentResponse()` strips ``` fences, slices from the first `{` to the
last `}` and validates the `action` field.

### 6.4 On-disk formats

- `~/.kora/config.json` — `ConfigData` (provider, lmstudioUrl, ollamaUrl, llamacppUrl, selectedModel,
  apiKey *(encrypted `enc:`)*, apiBaseUrl, apiModel, customProviders[], systemPrompt, temperature,
  agentDecisionModel, agentDecisionProvider, sttEngine, whisperPath, whisperModel, activeTemplate,
  ttsVoice, theme, language, obsidianVaultPath, graphLinkColor, graphNodeColor).
- `~/.kora/chats.json` — `Chat[]`: `{ id, title, createdAt, updatedAt, messages: [{ id, role,
  content, timestamp }] }`; sanitised field-by-field on load/save by `sanitizeChats()`.
- `~/.kora/mcp.json` — `{ version: 1, servers: [...] }`, seeded on first run with the official
  reference servers (filesystem disabled, memory + sequential-thinking enabled).
- `~/.kora/audit.log` — JSON lines: `{ type, action, details, success, blocked?, timestamp }`.

---

## 7. LLM gateway (`electron/services/api.ts`)

Single class `APIClient` (+ `LMStudioClient` as a keyless wrapper). Used by `electron/ipc/ai.ts`.

| Concern | Detail |
|---|---|
| Providers | `lmstudio`, `ollama`, `llamacpp` → OpenAI-compatible endpoints, no key, URL from config; `anthropic` → `/v1/messages`, its own body/headers (`x-api-key`, `anthropic-version`); `openrouter` → `/api/v1/...`, custom `baseUrl` respected; everything else (`openai`, `gemini`, `groq`, `deepseek`, `mistral`, `xai`, `custom`) → OpenAI-compatible `/v1/chat/completions` |
| Error classification | `classifyHttpError()` / `classifyNetworkError()` → `FailoverReason` (`rate_limit`, `auth`, `model_not_found`, `context_overflow`, `server_error`, `network`, `timeout`, `unknown`); the reason is embedded in the thrown message as `[kora:<reason>]` |
| Retry | `fetchWithRetry()` — max 2 retries, jittered backoff, honours `Retry-After`; **only** for `rate_limit / server_error / network / timeout`; `auth`, `model_not_found`, `context_overflow`, SSL problems fail fast; abort-aware |
| SSE | `data:`-line parsing, `[DONE]` handling, Anthropic error events, **final flush of the tail buffer** (the last chunk is never lost), `releaseLock()`, correct abort semantics |
| Introspection | `listModels()` and `testConnection()` with 10 s timeouts; Anthropic returns a hardcoded model list |
| JSON mode | agent decision calls set `response_format: { type: 'json_object' }`; providers that reject it (`isJsonModeRejected`) are retried once without it — never for auth / model_not_found / context_overflow |
| Abort | every streaming call takes an `AbortSignal`; `ipc/ai.ts` aborts on the renderer's `[ABORT]` |

Provider resolution on the renderer side lives in `src/lib/resolve-provider.ts`
(`resolveProviderConfig(cfg, baseUrlOverride?, modelOverride?)`) — **the single source of truth** for
turning `ConfigData` into `{ provider, model?, apiKey?, baseUrl? }`. Never hand-roll that mapping
(that duplication was a real bug, see FIXES.md).

---

## 8. Configuration

### 8.1 Renderer `CONFIG` (`src/config.ts`) — complete and exhaustive

| Key | Value | Consumer |
|---|---|---|
| `agent.MAX_STEPS` | 15 | `orchestrator.ts` (iteration budget) |
| `agent.HISTORY_TOKEN_BUDGET` | 8000 | `token-budget.ts` (agent history cap before summarisation) |
| `agent.SUMMARIZE_INPUT_CAP` | 8000 | `orchestrator.ts` (summarisation input cap) |
| `stream.TIMEOUT_MS` | 120000 | `useChat.ts` (chat stream timeout) |
| `stream.RENDER_INTERVAL_MS` | 60 | `useChat.ts` + `orchestrator.ts` (paint coalescing) |
| `chat.SAVE_DEBOUNCE_MS` | 300 | `useChat.ts` (persistence debounce) |
| `chat.MAX_TITLE_LENGTH` | 50 | `useChat.ts` (rename clamp) |

That is **all** of `CONFIG`. The main process defines its own constants next to the code that uses
them (it cannot import from `src/`). Do not re-add unused keys "for later" — dead config was a real
problem here (see FIXES.md).

### 8.2 Main-process constants (by file)

`electron/ipc/filesystem.ts`: `MAX_PATH_LENGTH=4096`, read limit 5 MB default, `patchFile` newText
≤ 100000 chars, grep file cap 2 MB, `BLOCKED_WRITE_PATHS` (per-OS). `electron/ipc/shell.ts`:
timeout 30 s, maxBuffer 10 MB. `electron/services/audit-log.ts`: `MAX_LOG_SIZE` 10 MB.
`electron/services/tts.ts`: 5000 chars, 30 s. `electron/ipc/web.ts`: 5 MB, 10–15 s.
`electron/ipc/obsidian.ts`: 5000 files, depth 15, cache TTL 30 s.
`electron/services/mcp/client.ts`: request timeout 30 s, startup timeout 20 s, 4 MB stdout cap.

---

## 9. Build, packaging and release

```bash
npm run dev            # dev: build-main (esbuild) + vite + electron
npm run build          # renderer production build -> dist/
npm run build:main     # main-process bundle -> dist-electron/main.js + preload.js (+ mcp/)
npm run electron:build # renderer build + electron-builder -> release/
npm test               # vitest run (138 tests)
npx tsc -p tsconfig.json --noEmit        # renderer typecheck
npx tsc -p tsconfig.electron.json        # main typecheck (noEmit; the build is npm run build:main)
npx tsc -p tsconfig.node.json --noEmit   # vite.config.ts typecheck
```

`package.json → "build"` (electron-builder) currently:

```json
"win":   { "target": "nsis", "icon": "build-assets/icon.ico", "signAndEditExecutable": false },
"nsis":  { "oneClick": false, "allowToChangeInstallationDirectory": true,
           "artifactName": "Kora-Setup-${version}.${ext}" },
"asar": true, "asarUnpack": ["dist-electron/mcp/**"],
"afterPack": "scripts/after-pack.cjs",
"files": ["dist/**/*", "dist-electron/**/*"],
"directories": { "output": "release" }
```

### 9.1 The two Windows build traps (already solved — do not regress)

1. **`Cannot create symbolic link ... winCodeSign\\...dylib`**
   electron-builder downloads `winCodeSign`, whose archive contains macOS symlinks; 7-Zip cannot
   create them without the `SeCreateSymbolicLinkPrivilege` (admin or Windows Developer Mode).
   **Fix applied:** `win.signAndEditExecutable: false` — verified in
   `node_modules/app-builder-lib/out/winPackager.js` that it short-circuits `signApp()` and the
   sign transformer, so `winCodeSign` is never needed. Trade-off: exe metadata/icon editing is
   skipped, so the icon is embedded separately by `scripts/after-pack.cjs` (rcedit) — added in
   Phase 0; code signing itself remains open (see §13).
2. **Downloading `nsis-*.7z` from github.com times out**
   (region-dependent). **Fix applied:** set the mirror env var before building:
   `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`
   (verified reachable; the direct URL was not). If a future build hangs on a download, test the URL
   with a HEAD request first and switch mirrors — do not assume it is a code bug.

### 9.2 Release checklist

1. `npm run electron:build` (with the mirror env var if needed).
2. Artifacts appear in `release/`: `Kora-Setup-<version>.exe`, `.blockmap`, `latest.yml`.
3. GitHub → **Releases → Draft a new release** → tag `v<version>` (target `main`), fill notes,
   drag the `.exe` (+ `.blockmap`/`latest.yml` for auto-update support) → **Publish release**.
4. GitHub resolves the license badge from `LICENSE` and `package.json#license` automatically.

`release/` is git-ignored; only `package.json` config changes are committed.

---

## 10. Testing

| File | Tests | Covers |
|---|---|---|
| `src/lib/__tests__/shell-security.test.ts` | 28 | `isDangerousCommand` / `isSafeCommand` (destructive, remote-exec, powershell, chaining, bypass attempts) |
| `src/lib/__tests__/web-security.test.ts` | 18 | SSRF host/protocol blocking |
| `src/lib/__tests__/filesystem-security.test.ts` | 14 | blocked write paths, traversal, findFiles pattern safety |
| `src/agent/__tests__/guards.test.ts` | 13 | error markers, retryability, `IterationBudget`, `ToolLoopGuard`, repetition guard |
| `src/lib/__tests__/path-security.test.ts` | 11 | `validatePath` / `validatePathRead` |
| `src/agent/__tests__/intent.test.ts` | 9 | `needsAgent` / `hasToolIntent` / `isCommandMessage` |
| `src/lib/__tests__/tts-speech.test.ts` | 7 | markdown → speech normalisation, chunking |
| `src/agent/__tests__/decision-parse.test.ts` | 7 | `parseAgentResponse` (fenced/prose-wrapped JSON) |
| `src/agent/__tests__/token-budget.test.ts` | 7 | history fits the token budget; summarisation input |
| `src/lib/__tests__/api-json-mode.test.ts` | 8 | `buildBody` json mode + rejection fallback |
| `src/lib/__tests__/decision-routing.test.ts` | 10 | two-tier `resolveDecisionLlmOptions` |
| `src/lib/__tests__/wav.test.ts` | 6 | 16 kHz mono WAV encoding for whisper.cpp |
| **Total** | **138** | all green |

**Iron rule:** security tests import the *real* production modules from `electron/lib/*` — never copy
logic into a test. Copied logic once drifted from production and let three "fixed" bugs go unnoticed
(see FIXES.md, 15 September).

Environment notes:
- Vitest reads `vite.config.ts` (no separate config); tests run in the default **node** environment.
- Running tests from PowerShell can *look* like a failure: Vite prints a CJS-deprecation warning on
  stderr and PowerShell turns it into `NativeCommandError` / exit 1. Run through
  `cmd /c "npx vitest run 1> out.txt 2> err.txt"` and read the files.
- `--reporter=basic` no longer exists in Vitest 4 — do not add it back.

---

## 11. Performance decisions (do not regress)

| Area | Decision | Where |
|---|---|---|
| Chat streaming | token updates coalesced to ≤1 render per `RENDER_INTERVAL_MS`; `done()` always flushes the final text | `useChat.ts` |
| Message list | `MessageBubble` wrapped in `React.memo`; only the streaming message re-renders | `MessageBubble.tsx` |
| Input | `InputBar` wrapped in `React.memo`; `App` provides stable callbacks (`handleSend`, `handleSpeak`, `handleStartListening`, `handleToggleTTS`) | `App.tsx` |
| Agent transcript | `setLiveTranscript` coalesced the same way; the full text for retry/guard logic stays in an internal buffer | `orchestrator.ts` |
| Memory | entries live in refs; no React state → no re-renders on `addEntry` | `memory.ts` |
| Obsidian graph | repulsion uses a 300 px uniform grid (only 9 neighbouring cells) — mathematically identical to the O(n²) pairwise loop but ~O(n); physics sleeps when settled | `GraphView.tsx` |
| Bundle | `build.target: 'esnext'` (Electron 44 = Chromium 152) | `vite.config.ts` |

---

## 12. Conventions and rules for contributors (and AI agents)

1. **TypeScript is strict**; the renderer tsconfig also sets `noUnusedLocals`/`noUnusedParameters`.
   Do not loosen it.
2. Path alias: `@/` → `src/` (Vite + tsconfig `paths`).
3. **Renderer ↔ main boundary**: renderer code may only call `window.kora.*`. A new capability means
   an IPC handler in `electron/ipc/*` + a preload wrapper + a type in `src/types/index.ts` — and
   defensive input validation in the handler.
4. **Never trust the renderer**: the main process re-validates everything.
5. **Never duplicate** `resolveProviderConfig`, `CONFIG` keys, or security logic — one source of truth
   each (this repo has been burned by all three).
6. Security-relevant pure logic goes to `electron/lib/` (no Electron imports) so tests can import it.
7. UI strings go to `src/i18n/en.ts` **and** `src/i18n/ru.ts` (`en` is the type source).
8. Keep `[kora:<reason>]` error markers and the stream control strings (`[DONE]`, `[ERROR] `, `[ABORT]`)
   byte-compatible — they are cross-process contracts.
9. Atomic writes (tmp + rename) for every persisted file; never write JSON in place.
10. Every new dangerous tool / `!` command must set `requiresConfirmation: true` / join
    `DANGEROUS_COMMANDS`.
11. Commit style in use: `feat:`, `fix:`, `docs:`, `chore:`, `build:`, `perf:`.
12. Docs live in `docs/`; audit reports are dated snapshots — do not rewrite them in place, record
    changes in `docs/FIXES.md`.
13. Deleting "dead" code is welcome here, but **prove it is dead first** (grep the whole repo) and
    run the full verification suite afterwards.

---

## 13. Known limitations / open work (as of 2026-09-25)

> These items are tracked as planned work in [`ROADMAP.md`](ROADMAP.md) — Phase 0 (cheap wins)
> and the Rust migration plan map onto this list one by one.

| Item | Status | Notes |
|---|---|---|
| `useReActAgent` is a ~450-line "god hook" | open | recommended split: agent loop / retry policy / history manager / tool executor |
| Prompt injection via tool results | open | tool output reaches the model context unsanitised; markers + sanitisation recommended |
| Capability-based permissions in preload | open | `window.kora.shell` / `fs.write` should require explicit grants |
| Rate limiting / spend budget on LLM calls | open | no `RateLimiter` service |
| Token-based memory + summarisation | **done** | `src/agent/token-budget.ts` + `CONFIG.agent.HISTORY_TOKEN_BUDGET` (Phase 0, 2026-09-23) |
| CI (GitHub Actions) | **present** | `.github/workflows/ci.yml` — vitest + the three typechecks on push/PR |
| App icon | **done** | `scripts/generate-icon.ps1` + `afterPack`/rcedit (Phase 0, 2026-09-23) |
| Code signing | absent | Windows SmartScreen will warn about the published installer |
| First commit author | `amkhl <amkhl@users.noreply.github.com>` | historical; rewriting needs a force-push |
| Repository name | `KoraDesctop` | typo for "Desktop"; renaming changes all URLs |
| Non-Windows builds | unverified | only `win/nsis` is configured and tested |
| GitHub topics | cosmetic | only `ai`, `assistant` are set |

---

## 14. Glossary — identifiers to grep

| Identifier | Meaning |
|---|---|
| `useUnifiedChat` / `useChat` / `useReActAgent` | the three chat layers (routing / chat+commands / agent) |
| `needsAgent`, `hasToolIntent`, `isCommandMessage` | deterministic routing (`agent/intent.ts`) |
| `startCycle`, `runStep`, `finishCycle`, `streamDecisionText`, `parseAgentResponse` | agent loop (`orchestrator.ts`) |
| `think` / `act` / `observe`, `requestConfirmation`, `resumeAfterConfirmation` | agent state machine (`planner.ts`) |
| `addEntry`, `getFullHistory` | conversation memory (`memory.ts`) |
| `IterationBudget`, `ToolLoopGuard`, `detectDegenerateRepetition`, `boundToolError`, `backoffDelayMs`, `parseLlmErrorReason`, `isRetryableReason`, `isEmptyResponse` | fault-tolerance primitives (`guards.ts`) |
| `BUILTIN_TOOL_METADATA`, `agentRegistry`, `MCP_TOOL_METADATA`, `isMcpToolId`, `requiresConfirmation` | tool registry |
| `buildSystemPrompt`, `COMMAND_DOC` | agent system prompt (`prompts.ts`) |
| `resolveProviderConfig` | provider → `{ baseUrl, apiKey, model }` |
| `validatePath`, `validatePathRead` | renderer path checks |
| `isDangerousCommand`, `isSafeCommand`, `DANGEROUS_COMMANDS` | shell filter (`electron/lib/shell-security.ts`, `src/lib/commands.ts`) |
| `isUnsafeRegex`, `matchGlob` | grep safety (`electron/lib/regex-security.ts`) |
| `isBlockedHost`, `isAllowedProtocol` | SSRF guard (`electron/lib/web-security.ts`) |
| `resolveSafePath`, `assertNotBlockedWrite`, `BLOCKED_WRITE_PATHS`, `stripQuotes`, `expand` | fs guard (`electron/ipc/filesystem.ts`) |
| `APIClient`, `LMStudioClient`, `LlmError`, `fetchWithRetry`, `getEndpoint`, `getHeaders`, `buildBody`, `classifyHttpError`, `classifyNetworkError` | LLM gateway (`electron/services/api.ts`) |
| `MCPManager`, `MCPClient`, `MCPConfig`, `callTool`, `refreshTools`, `fullName` (`mcp__srv__tool`) | MCP stack |
| `sanitizeChats`, `loadChatsWithBackup` | chat persistence (`electron/ipc/chats.ts`) |
| `encryptSecret`, `decryptSecret`, `ENC_PREFIX` (`enc:`) | key storage (`electron/services/config.ts`) |
| `logShellExecution`, `logAuditEvent`, `rotateLogIfNeeded` | audit trail |
| `normalizeForSpeech`, `splitForSpeech`, `speechWordsForVoice` | TTS text preparation |
| `PROVIDERS`, `THEMES`, `COMMANDS`, `PROMPT_TEMPLATES` | static catalogues (`src/types/index.ts`) |
| `KORA_DISABLE_GPU`, `VITE_DEV_SERVER_URL`, `ELECTRON_BUILDER_BINARIES_MIRROR` | env switches |

---

## 15. Quick-start for an AI agent working on this repo

1. Read §1–§4, then jump to the section matching your task.
2. Before changing anything, `grep` the identifier you plan to touch (§14 is the index).
3. Remember the two hard boundaries: renderer↔main (IPC only) and main→disk (validated + atomic).
4. If your change touches `electron/lib/*`, `useChat.ts`, `orchestrator.ts` or any IPC handler —
   run the full suite: `npm test`, the three `tsc` checks and `npx vite build`.
5. Record the change in `docs/FIXES.md` (dated entry, problem → fix → verification).
6. Do not "clean up" dated audit documents, and do not delete code you have not proven unused.

