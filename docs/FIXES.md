# Kora — Fixes Journal

## September 25, 2026 — ROADMAP Phase 0 close-out

Verification re-run end-to-end: `npm test` → **138/138** (12 files), three `tsc` checks → exit 0,
`cargo test` → **46/46**, `cargo clippy` → clean apart from two unused-import warnings in
`crates/kora-security` tests (formatting drift recorded for the P2 cleanup).

Metrics re-measured with the same harness as ROADMAP §2 (now kept in ROADMAP §2 "Re-measured after
Phase 0"): installer **110.85 MiB**, unpacked **381.2 MiB / 78 files**, warm start
**0.63 / 0.43 / 0.42 s** (criterion < 1.5 s met), idle RAM **352–355 MiB** (criterion < 300 MB not
met — the big cut arrives with the Rust core), graceful close with zero leftover processes.

Docs re-synced against the code (ROADMAP EN/RU §2/§3/§4.1/§6.8/§7/§8/§11, PROJECT_HANDOFF §1/§2/§6.4/
§7/§8/§9/§10/§11/§13, ARCHITECTURE, README EN/RU, docs/README index). The Phase 0 work was committed
in five logical commits and pushed; the first CI run on GitHub is **green**:
https://github.com/mineones047-ux/KoraDesctop/actions/runs/36137701650

---

## September 23, 2026 — ROADMAP Phase 0 (part 1)

Verification for everything below (per ROADMAP §1.2): `npm test` → **100/100 green**, `tsc` ×3
(renderer / electron / node) → **exit 0**, full `npm run electron:build` → installer produced,
packaged MCP handshake tested against `release/win-unpacked`.

### Electron 32.3.3 → 44.4.5 (ROADMAP §3)
Problem: twelve majors of V8/Chromium behind; the hardened flags (`contextIsolation`, `sandbox`,
no `remote`) already matched Electron's defaults, so the upgrade was expected to be mechanical.
→ `electron@^44` in devDependencies; `vite.config.ts` comment updated; README stack updated.
No code changes were needed: all three typechecks and the100 tests passed unchanged.

### Main process bundled with esbuild (ROADMAP §3 "one file")
Problem: `tsc` emitted 25 separate CJS modules — one `require` + one disk read per module at boot.
→ New `scripts/build-main.cjs` (`npm run build:main`): wipes `dist-electron/`, bundles
`main.ts` + `preload.ts` into **2 files** (`main.js` 96 KB, `preload.js` 6.5 KB) in ~40 ms,
`packages: 'external'` keeps runtime deps (msedge-tts) as normal requires. Type checking moved to
`tsc -p tsconfig.electron.json` with `noEmit: true`. `scripts/electron-dev.cjs` and `start.bat`
now call the bundle script instead of `tsc`; `electron-builder` packs the bundle as before.

### asar made explicit (ROADMAP §3)
Problem: asar was on by default but not declared, and nothing was unpacked — which broke child
processes (see next item). Electron-builder reports "default Electron icon is used" — icon and
code signing remain open (need an asset / certificate).
→ `"asar": true` + `"asarUnpack": ["dist-electron/mcp/**"]` in package.json `build`.

### Lazy service init — window first (ROADMAP §3)
Problem: `main.ts` awaited `mcpManager.init()` (which spawns MCP servers) **before** `createWindow()`,
delaying first paint by the whole MCP autostart.
→ Order changed: config read (fast, so the renderer never sees an empty MCP list) → handlers →
`createWindow()` → handler registration → `mcpManager.init()` **not awaited**. Quit safety: the
manager gained a `disposed` flag set by `shutdown()`; `startServer`/`doStart` check it before and
after `client.start()`, so a quick quit cannot leak an in-flight child (the `taskkill /T` tree-kill
path in `client.ts` is unchanged and still covers user-configured `cmd` servers).

### MCP servers no longer spawn `npx` (ROADMAP §3 "biggest single real-world win")
Problem: each reference server launched as `cmd /c npx -y <pkg>` cost a whole extra Node process
(hundreds of MB, seconds) and, for first runs, a runtime download; on Windows it was also the
`cmd → npx → node` tree behind the zombie-process bug in FIXES (Aug 26, critical #3).
→ Each of the three `@modelcontextprotocol/server-*` packages is now bundled **self-contained**
(`dist-electron/mcp/server-*.mjs`, ~1.6 MB each, ESM because
`server-filesystem` uses top-level await) and spawned as
`ELECTRON_RUN_AS_NODE=1 <app-exe> <bundle.mjs>` — a single process, no npx, no npm cache lookup.
Packages moved to **devDependencies** (the installer no longer ships their131-package closure).
`~/.kora/mcp.json` entries that still say `npx -y <pkg>` are migrated automatically on load
(only when the package resolves locally; unknown packages keep the `npx` fallback; this
machine's config had already been hand-migrated to a local `node.exe` on 2026-09-22, so the
loader migration had nothing to rewrite here — it covers fresh installs and genuinely-npx
configs).
Gotcha found while testing: **`ELECTRON_RUN_AS_NODE` cannot `require()` from inside `app.asar`**
(the first packaged test failed with `Cannot find module 'fast-deep-equal'`), hence both the
self-contained bundles and the `asarUnpack` rule. Also `server-sequential-thinking` reads its own
`package.json` at startup for the handshake version — `build-main.cjs` copies it next to the
bundles.
Verification: `initialize` + `tools/list` handshakes OK for all three bundles via Electron 44 in
Node mode, both from `dist-electron/` (dev) and planned packaged path; all MCP config tests/type
checks green.

### CI (ROADMAP §3)
→ `.github/workflows/ci.yml`: on push/PR — `npm ci`, `npm test`, three `tsc` checks,
`npm run build:main`, `npm run build` on ubuntu-latest/Node 22. The same commands pass locally;
confirmed green on the first real push (2026-09-25, run
https://github.com/mineones047-ux/KoraDesctop/actions/runs/36137701650).

### Environment fixes (this machine)
- npm's install-script allow-list: `esbuild@0.28.2` / `esbuild@0.21.5` approved, `msedge-tts`
  denied (`only-allow pnpm` preinstall would break `npm install`), recorded in package.json
  `allowScripts`.
- Electron's binary postinstall had never run — downloaded manually via
  `node node_modules/electron/install.js`.

### Structured output for agent decisions — `response_format` (ROADMAP §3)
Problem: agent decisions relied on the prompt saying "reply with ONLY a JSON object" plus a
corrective-retry loop — every malformed reply cost a **full extra LLM pass** (the loop allows up
to 14 rounds per step).
→ The decision call now sets `jsonMode: true` in `AgentLLMOptions` (orchestrator) and flows
through `window.kora.ai.chatStream` → IPC → `APIClient`/`LMStudioClient`, where `buildBody()`
adds `response_format: { type: 'json_object' }` for every OpenAI-compatible provider — local
(LM Studio / Ollama) and cloud alike. Anthropic has no such parameter and keeps the prompt-only
path. If a provider rejects the parameter (`isJsonModeRejected`: matches `response_format` /
`json_object` / json-mode wording, never auth / model_not_found / context_overflow), the request
is retried **once** without it — behaviour on unsupported servers is unchanged, on supported
servers most corrective retries disappear. The existing `parseAgentResponse` tolerance for
fenced/prose-wrapped JSON stays as the safety net.
Verification: **115/115 tests** (15 new: `src/lib/__tests__/api-json-mode.test.ts` covers
`buildBody` + fallback guard against the real gateway module; `src/agent/__tests__/decision-parse.test.ts`
covers the now-exported production parser) + three `tsc` checks green. GBNF grammars (llama.cpp)
intentionally deferred to the `llama.cpp` provider item.

---

### Two-tier model routing — small tier decides, large tier answers (ROADMAP §3)
Problem: every agent step — including the most frequent call in the loop, *"which tool next?"* —
hit the single configured model; tool decisions and the final answer paid the same price.
→ New **optional** decision tier: `agentDecisionModel` (+ `agentDecisionProvider`) added to
`ConfigData`, whitelisted in the main process `config:set`, editable in Settings → Provider tab
(select "same as main provider" + model id; EN/RU strings). `resolveDecisionLlmOptions()` turns
the config into request options and returns **null** when the feature is off or unsafe: empty
model, cloud provider without an API key, or `custom` while the main provider owns the shared
`apiBaseUrl`; when the tier switches to a different catalog provider the catalog `baseUrl` wins
(so the main provider's endpoint is never reused by mistake).
The orchestrator (`runStep`) picks the decision tier when it differs from the main one, keeps the
`jsonMode` + temperature cap on those calls, and — only in that case — after `action:"finish"`
makes **one** additional call to the LARGE model with the new `buildFinalAnswerPrompt()` to write
the final prose answer from the same conversation (correction-prompt messages stripped; Stop is
honoured before/after the call; on error the small tier's answer is kept so a finished cycle never
degrades into a failure). With no decision model configured the behaviour is byte-for-byte the
old single tier.
Verification: **122/122 tests** (7 new `decision-routing` cases against the real resolver) +
three `tsc` checks + `build:main` green.

### Token budget + summarisation for memory (ROADMAP §3)
Problem: the agent trimmed history by entry COUNT only (and halved the entry list when the
provider reported `context_overflow`) — a few long tool outputs could blow the context while
dozens of short turns were kept.
→ New pure module `src/agent/token-budget.ts` (`estimateTokens` ≈ 4 chars/token + per-message
overhead; `fitToTokenBudget` drops the OLDEST entries first and always keeps the newest 4 so the
immediate exchange never disappears). `CONFIG.agent.HISTORY_TOKEN_BUDGET = 8000`. The orchestrator
fits every decision call's history to the budget and, for each newly dropped segment, makes ONE
summarisation call (`buildMemorySummaryPrompt`) — using the main model, not the small tier —
injecting the compact note as an `[Earlier conversation summary]` system message (later drops are
re-summarised together with the previous note; failures and Stop are non-fatal, the cycle simply
continues unsummarised). The `context_overflow` hard-trim path is kept as a fallback.

### llama.cpp / llama-server as a provider (ROADMAP §3)
→ `llamacpp` added to the `Provider` union and the PROVIDERS catalog (`http://localhost:8080`,
local, no key) with `llamacppUrl` in the config (default, whitelist), a Settings URL input +
model picker + refresh, a resolver branch, API-key exemptions in `APIClient.chat / chatStream /
testConnection`, and local-tier treatment in the two-tier decision resolver. Prompt caching and
GPU offload are llama-server CLI flags (`--cache-prompt`, `-ngl …`) — the app speaks the
OpenAI-compatible API to it and the Settings hint points users at the binary.

### Local whisper.cpp STT (ROADMAP §3)
Problem: voice input relied solely on the Web Speech API — which WebView2 does not implement
(the scheduled Phase-3 blocker from the risk register).
→ Settings → Voice gained an engine select (System / Local whisper.cpp) plus binary and model
path inputs (EN/RU). New `stt:transcribe` IPC handler: validates engine, paths, the `RIFF` header
and a 25 MB cap, writes a temp WAV, runs the user's `whisper-cli -m … -f … -l … -nt -np`
(`shell: false`, 120 s timeout, temp file removed afterwards) and returns stdout text, stripping
timestamps defensively for older builds. The renderer side is `useWhisperSTT`: MediaRecorder →
Web Audio `decodeAudioData` → downmix/resample to 16 kHz mono → WAV via the new pure
`src/lib/wav.ts` → base64 → IPC. `App` keeps both engines mounted and switches on
`config.sttEngine`; the Web Speech path remains the default.

### App icon — generated, embedded, verified (ROADMAP §3, half of "icon + code signing")
Problem: the installer and exe carried the default Electron icon; `win.signAndEditExecutable`
had been disabled in an earlier fix because electron-builder's `winCodeSign` bundle cannot be
extracted on machines without symlink privileges (`ERROR: Cannot create symbolic link …
libcrypto.dylib` → build fails and retries).
→ `scripts/generate-icon.ps1` (pure PowerShell + System.Drawing, re-runnable) renders a crimson
"K" plate at 7 sizes and assembles a PNG-compressed multi-size `build-assets/icon.ico`
(+ `icon.png`); `win.icon` points NSIS at it. For the exe itself the winCodeSign path is bypassed
with an `afterPack` hook (`scripts/after-pack.cjs`) that runs `rcedit` directly.
Gotchas hit and fixed while wiring this up: `rcedit@5` is ESM-only (the CJS hook loads it via
`await import()`), and a UTF-8 BOM written by PowerShell before a shebang makes Node fail to
`require` the hook (`node --check` catches it) — the file is now BOM-free without a shebang.
Verification: the build log shows `[afterPack] icon embedded via rcedit` and no longer
"default Electron icon is used"; extracting the icon from `release/win-unpacked/Kora.exe`
returns our artwork — 9/9 sampled pixels match `build-assets/icon.png` (plate `#0C0C0E`,
glyph `#E05042`). Installer rebuilt: 110.8 MB. **Code signing remains open**: it needs a real
certificate (a purchase/CI-secret decision, ROADMAP §10) — a self-signed cert would only add
warnings, so it was deliberately left out.

### What did NOT improve (honest notes for the Phase 0 exit criteria)

- **Installer grew 81.4 → 110.9 MB**, unpacked app 274 → 381.2 MB / 78 files (bigger Electron 44
  runtime; the previous baseline had no MCP packages in the app at all; moving the MCP server
  packages to devDependencies removed their ~131-package closure from both numbers).
- **Start time re-measured with the same `MainWindowHandle` harness as §2 of the ROADMAP:**
  cold **3.22 s** (baseline 10.4 s), warm **0.6 s** (baseline 2.3–4.7 s) — the Phase 0 exit
  criterion "warm start < 1.5 s" is **MET**. Launches and kills cleanly (0 leftover processes
  after `taskkill /T`).
- **RAM re-measured: 357.5 MB across 4 processes** (baseline 354.6 MB) — the exit criterion
  "< 300 MB" is **NOT met**; no RAM-specific work has been done yet (candidates: defer more
  services behind first use, trim background fetches/polling; realistically the big cut arrives
  with the Rust core per §4.1).
- The Phase 0 exit criteria are therefore only **partially met** (warm start ✅, tests ✅,
  FIXES note ✅, RAM ❌) — and Phase 0 items below are still open, so the phase as a whole stays open.
- The size target belongs to the Rust phases (§4.1), not Phase 0 — re-baseline after the
  remaining Phase 0 items.
- Warm start < 1.5 s / RAM < 300 MB: see "Start time" / "RAM" bullets above — warm start MET,
  RAM NOT met yet.
- Still open in Phase 0: **code signing** (needs a real certificate — the icon half of the item
  is done, see the ROADMAP §10 open decision), plus everything in the Rust phases (§4+).

---

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
