# Kora — Fixes Journal

## August 26, 2026

### Diagnostics and audit
- A full code audit was performed (renderer + main process): 6 critical, ~15 major and ~20 minor defects were found
- MCP was verified end-to-end: the JSON-RPC protocol (initialize → tools/list → tools/call) for server-memory, server-filesystem and mcp-server-fetch
- Runtime services were verified: TTS (msedge-tts), web search (DuckDuckGo), chat persistence

---

### Critical fixes

**1. The ReAct agent could not see tool results (`src/agent/memory.ts`)**
`getFullHistory()`/`getContext()` closed over the initial empty state (a stale closure) and always
returned `[]`. The agent called tools blindly up to the step limit.
→ Ref mirrors of the state were added; the getters now return current data.

**2. Infinite confirmation loop for dangerous commands (`src/hooks/useChat.ts`)**
`!confirm` re-invoked `processCommand`, which asked for confirmation again — the action could not be
confirmed in principle.
→ Added a `bypassConfirm` parameter: a confirmed command executes immediately.

**3. Zombie MCP server processes on Windows (`electron/services/mcp/client.ts`)**
SIGTERM/SIGKILL only killed `cmd.exe`; the grandchildren (`npx → node`) lived forever on every
stop/restart/exit.
→ Added `taskkill /PID <pid> /T /F` for Windows — it kills the whole process tree.

**4. UI freeze after pressing Stop (`src/hooks/useChat.ts`)**
The stream promise stayed unresolved until the 120-second timeout: the Stop button hung and input was
blocked.
→ The promise is resolved instantly through a finisher map; auto-execution of commands from the model
response is disabled after Stop.

**5. API key leak (`electron/services/config.ts`)**
Custom-provider keys were written to disk in plain text.
→ Encryption via safeStorage with the `enc:` prefix; legacy plaintext keys are migrated on the first save.

**6. Unsafe config write (`electron/services/config.ts`)**
config.json was the only file written directly, without tmp+rename — a crash mid-write produced invalid
JSON and silently reset all settings.
→ Atomic tmp+rename write plus a write queue.

### Security

- **SSRF via `web:fetch`** (`electron/ipc/web.ts`) — blocks localhost, private subnets (10.x, 172.16/12, 192.168.x, 169.254.x metadata) and non-http(s) protocols
- **Extended filesystem write blocklist** (`electron/ipc/filesystem.ts`) — added Startup, Program Files, ProgramData, `.ssh`, `.gnupg`
- **will-navigate bypass** (`electron/main.ts`) — `startsWith(devServerUrl)` let `http://localhost:5173.attacker.com` through; replaced with an exact host:port comparison / path resolve
- **Unknown MCP tools** (`src/agent/tool-registry.ts`) — are no longer executed blindly without metadata/confirmation
- **Agent abort checks** (`src/agent/orchestrator.ts`) — after the LLM call and before tool execution: Stop no longer allows an already-received decision to run
- **ReDoS protection for `fs:grep`** — heuristic detection of catastrophic backtracking (`(a+)+`, `(a?b)+`, `(\d{2,}){3}`) plus a depth limit and symlink skipping

### Reliability

- **MCP manager**: start mutex (removed the double-spawn race and orphan processes); honest `success:false` for a failed server instead of `success:true`
- **chats.json**: a corrupted file is backed up to `.corrupt-*` instead of silently losing the whole history; unique tmp file names (removed the async/sync write race)
- **SSE streaming** (`electron/services/api.ts`): final flush of the tail buffer (the last chunk is not lost), reader `releaseLock`, Anthropic stream error handling, abort-aware retry, 10 s timeouts for listModels/testConnection, diagnostics instead of silently empty responses
- **TTS** (`electron/services/tts.ts`): 30 s synthesis timeout plus a 5000-character text limit
- **Obsidian scan** (`electron/ipc/obsidian.ts`): protection against symlink/junction loops, limits of 5000 files / depth 15, BOM trimming, each file read once instead of twice
- **UI races**: debounced loadModels in settings, a seq guard in MCPSettings, `.catch` on readNote in GraphView, system process polling only while the monitor is open
- **ID collisions**: `Date.now().toString()` → `crypto.randomUUID()` for messages and chats
- **openrouter** no longer ignores a user-provided baseUrl

### Interface

- **Leaving the knowledge graph** — the "Graph" button used to be a dead end. It now toggles to "← Chat" with highlighting; clicking a chat or "New chat" also returns to chat mode
- **Obsidian settings** were moved out of the custom prompt-template block — the section is now always visible, not only when a custom template is selected

### User data fix

- Restored the Obsidian vault path in `~/.kora/config.json`: a mangled value containing Cyrillic and quotes → the correct `C:\Users\<user>\<...>\obsid`
- Added path sanitization against stray quotes at the IPC boundary (`fs:*`) and in `config.set`

### New MCP server connected

- **mcp-server-fetch** (`~/.kora/mcp.json`) — reading web pages and documentation without API keys; autostart verified

### Code cleanup

- Removed dead i18n keys from both locales: `titleBar.*`, `inputBar.mute/unmute`, `settings.previewing`, `agent.observing/aborted/completed/error/close`
- Implemented the agent `help` tool, which was declared but never worked
- Fixed `tsconfig.node.json`: removed the erroneous `electron/**/*` include, added target ES2020 (minus 9 false typecheck errors)
- Added `.gitignore` (node_modules, dist, release, logs, .env, caches)

### Verification

- ✅ Typecheck: tsconfig.json, tsconfig.electron.json, tsconfig.node.json
- ✅ Production build (vite build)
---

## September 15, 2026

### Diagnostics

- Ran: vitest (100 tests, 1 failing), a typecheck of the renderer and main process, and a production build
- Cross-checked with CODE_REVIEW.md of Sept 13: of the 4 "critical" bugs, three had already been fixed
  in the code (pipe-to-shell is checked before normalization; the leading `/` in paths is preserved;
  tmp files get a crypto suffix and `0600` permissions). One bug and one systemic problem genuinely
  remained — both are fixed below

### Fixes

**1. The ReDoS filter let incomplete quantifiers through (`a{1,`)** — `electron/lib/regex-security.ts`
In JavaScript, `new RegExp('a{1,')` does not throw: the unterminated quantifier is silently treated as
the literal text `{1,`. `isUnsafeRegex` let such a pattern through, so `fs:grep` would search for the
literal string "a{1," instead of "the character a, one or more times" — a misleading result instead of
an error. This was the project's only failing test (99/100).
→ Added rule #5: `{n` or `{n,` without a closing `}` is rejected as invalid syntax. Escaped `\{` and the
contents of character classes `[...]` are neutralized before the check, so safe patterns (`a{2,5}`,
`a{`, `colou{2,}r`) still pass.

**2. Security tests were testing copies of the code, not production** — the main source of "invisible" regressions
`shell-security.test.ts`, `filesystem-security.test.ts` and `web-security.test.ts` recreated the logic
from `electron/ipc/*.ts` inline ("Since it's not exported, we'll recreate the logic here"). Any change to
the production filters had no effect on the tests: they stayed green even if the code diverged from the
copy. That is exactly why three of the four bugs from the Sept 13 review "fixed themselves" unnoticed by
the tests, and the failing `a{1,` test had been testing the wrong code for years.
→ The pure logic was extracted into three new `electron/lib/` modules (with no Electron imports, so they
are imported both by the main process and by vitest):
- `shell-security.ts` — `isDangerousCommand` / `isSafeCommand` plus all blocking patterns
- `regex-security.ts` — `isUnsafeRegex` / `matchGlob`
- `web-security.ts` — `isBlockedHost` / `isAllowedProtocol`
→ `electron/ipc/shell.ts`, `filesystem.ts` and `web.ts` now import these modules; all three tests import
the very same code. The duplicates were removed.
→ Bonus: the protocol check in `web:fetch` and the protocol tests now use a single `isAllowedProtocol`
function instead of two independent copies of the condition.

### Verification

- ✅ vitest: **100/100** (was 99/100)
- ✅ typecheck: tsconfig.json (renderer) + tsconfig.electron.json (main) — no errors
- ✅ production build `vite build` — successful
---

## September 15, 2026 — performance optimization

Goal: remove redundant work from the renderer's hot paths. Baseline: `vite build` 2.59 s, chat streaming
re-rendered the whole history on every token, graph physics was O(n²).

### Runtime

**1. Chat streaming re-rendered the whole history on every token** — `src/hooks/useChat.ts`, `src/components/Chat/MessageBubble.tsx`, `src/App.tsx`
Every incoming token called `setChats` (mapping over all chats and messages) and the entire
`MessageBubble` list re-rendered while re-parsing the growing markdown text — O(messages × tokens), the
main cause of the sluggish streaming.
→ Screen updates are coalesced (`CONFIG.stream.RENDER_INTERVAL_MS = 60` ms): at most ~16 times per second
instead of once per token. The final text is always committed on `[DONE]`, on error, on timeout and on Stop.
→ `MessageBubble` is wrapped in `React.memo`, and the `onSpeak`/`onSend`/`onStartListening` callbacks in
`App` are stabilized with `useCallback`. During streaming only the current message re-renders.

**2. `InputBar` re-rendered on every token** — `src/components/Chat/InputBar.tsx`
→ `React.memo` plus stable props: the input field no longer re-renders while a response is generating.

**3. The agent's live transcript updated on every token** — `src/agent/orchestrator.ts`
→ `setLiveTranscript` is coalesced with the same interval; the full text for retry/guard logic is still
kept in an internal buffer.

**4. Obsidian graph physics was O(n²)** — `src/components/Graph/GraphView.tsx`
Repulsion iterated over every pair of nodes on every frame — for vaults of up to 5000 notes that is
~12.5M checks per frame while the layout settles.
→ Nodes are bucketed into a uniform 300 px grid: a pair interacts only when |dx|,|dy| ≤ 300, which means
both points necessarily fall into the same or an adjacent cell. Only 9 cells are checked — the result is
mathematically identical to the original, at ~O(n) cost.

### Build

- `vite.config.ts`: `build.target: 'esnext'` — the renderer only ever runs inside Electron 32's Chromium,
  so downlevel transpilation is unnecessary. The build got faster (2.59 s → ~1.6–2.1 s); bundle size is
  unchanged (~411 kB).

### Verification

- ✅ vitest: **100/100**
- ✅ typecheck: tsconfig.json (renderer) + tsconfig.electron.json (main) — no errors
---

## September 15, 2026 — code cleanup

- Documentation was moved out of the project root into a separate folder (FIXES, PROJECT_LOGIC, SECURITY_AUDIT, SECURITY_FIXES, CODE_REVIEW).
- Removed the dead `setCallHandler`/`callStack` mechanism in `src/agent/planner.ts` (plus its call in `orchestrator.ts`): the ref was assigned but never invoked.
- Removed the unused `addCommandsToPrompt` export (`src/agent/prompts.ts`, `src/agent/index.ts`).
- Fixed a typo in the system prompt (`prompts.ts`): a stray word "dangerously" in "Remember: dangerously, never invent…".
- `src/config.ts` was reduced to the keys that are actually used (about 35 were dead: `agent.MAX_RETRIES`, `fs.*`, `web.*`, `search.*`, `grep.*`, `audit.*`, `mcp.*`, `tts.*`, `shell.*`, parts of `stream`/`chat`). The renderer never read them, and the main process cannot import `src/` — they were a second, misleading source of truth.
- Removed clutter from the project root: `dev-run.log`, `electron.log`, `kora-dev.log`, `kora-run.log`, `vite.log`, `tsconfig.node.tsbuildinfo` (all covered by `.gitignore`).

### Verification

- ✅ vitest: **100/100**
- ✅ typecheck: tsconfig.json + tsconfig.electron.json — no errors
- ✅ production build `vite build` — successful (1.52 s, bundle 410 kB)

---

## September 15, 2026 — code cleanup (second pass)

- `src/agent/memory.ts`: removed the unused `clear`, `getContext` and the `memoryBank`/`contextWindow` state. That state was read only through `useReActAgent`, which nothing used — and every `addEntry` triggered a pointless re-render. Memory stays on refs; only `addEntry` and `getFullHistory` are exposed.
- `src/agent/orchestrator.ts`: removed fields from the `useReActAgent` return object that neither `useUnifiedChat` nor `AgentDisplay` reads: `reset`, `agentRegistry`, `memoryBank`, `contextWindow`, `addEntry`, `getContext`, `getFullHistory`.
- `src/hooks/useConfig.ts`: removed the unused `isLoading` and `reload` from the return value (`App` only reads `config` and `updateConfig`).
- `src/config.ts`: removed the unused `export type Config`.
- Removed duplicated provider resolution: `Settings.tsx` (2 places) and `AgentDisplay.tsx` computed `baseUrl`/`apiKey`/`model` by hand instead of using the existing `resolveProviderConfig` (as the chat does). All places now use the shared helper — a behavioural divergence is gone.
- Searched for duplicated constants between `src` and `electron`: after shrinking `src/config.ts` there are none (each main-process module owns its own limits).

### Verification

- ✅ vitest: **100/100**
- ✅ typecheck: tsconfig.json + tsconfig.electron.json — no errors
- ✅ production build `vite build` — successful (1.58 s, bundle 409.6 kB)
