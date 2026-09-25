# ROADMAP — planned work, and the plan to rewrite the core in Rust

> **Purpose of this file:** the single place where *planned* work lives — what we intend to build,
> in what order, and why. It is the forward-looking counterpart of [`FIXES.md`](FIXES.md)
> (what was already shipped) and of §13 "Known limitations" in [`PROJECT_HANDOFF.md`](PROJECT_HANDOFF.md).
>
> **Status: work started (see §11 changelog).** A ticked box (`[x]`) means the item is done
> **and verified** — tests + the three `tsc` checks; unticked items are still only a plan.
> **Last updated:** 2026-09-25. **Baseline:** commit `9fa2481`, release `1.0.0`.
> **Russian translation:** [`ROADMAP.ru.md`](ROADMAP.ru.md) — kept for the maintainer; **this file is authoritative**.

---

## 1. How to use this file

1. **Planned work goes here** (future). **Shipped work goes to [`FIXES.md`](FIXES.md)** with a date
   and a "problem → fix → verification" note (convention §15.5 in PROJECT_HANDOFF).
2. Tick an item (`[x]`) only when it is done **and verified** (tests + the three `tsc` checks today,
   `cargo test` + `clippy` after the migration).
3. Unlike the dated audit documents, this file **may be rewritten freely** — it is not a snapshot.
4. The two hard invariants of the project survive every plan in this document:
   **renderer ↔ main only through the bridge**, and **main → disk only through validated atomic writes**.

---

## 2. Measured baseline (2026-09-22)

Numbers taken on the development machine before any work in this document started.
They exist so that "faster" and "lighter" can be verified later instead of argued about.

| Metric | Measured value | Note |
|---|---|---|
| Installer | **81.4 MB** (`release/Kora-Setup-1.0.0.exe`) | Windows NSIS |
| Unpacked application | **274 MB / 74 files** (`release/win-unpacked`) | the runtime dominates, not our code |
| Renderer bundle | **429 KB / 3 files** (`dist/`) | UI code is already tiny |
| Main-process bundle | **130 KB / 25 separate CJS files** (`dist-electron/`) | one `require` + one disk read per module |
| RAM after launch | **354.6 MB** (4 `Kora.exe` processes) | idle, one window |
| Start → visible window | cold **10.4 s**, warm **4.7 / 2.5 / 2.3 s** | PowerShell polling of `MainWindowHandle` |
| Electron version | **32.3.3** (Chromium 128) | latest stable at the time: **44.4.3** (Chromium 152) |
| npm dependencies | 497 top-level directories in `node_modules` | |
| Source size | renderer **36 files / 7096 lines**, main **25 files / 3336 lines** | tests excluded |
| Tests | **100 passed / 7 files / 581 lines** | all green |
| Bridge surface | **59 IPC channels** (55 in `electron/ipc/*` + 4 `window:*` in `main.ts`) + 2 event pushes | full list in §6.1 |
| Tools | **28 built-in** ids + dynamic `mcp__<server>__<tool>` | see §6.3 |
| `!` commands | 29 handled command names, 9 of them dangerous | see §6.4 |

**Re-measured after Phase 0 (2026-09-25):**

| Metric | Measured value | Note |
|---|---|---|
| Installer | **110.9 MB** (`Kora-Setup-1.0.0.exe`, 116,232,159 bytes) | the Electron 44 runtime costs ~30 MB extra; the MCP npm closure was removed from the package |
| Unpacked application | **381.2 MB / 78 files** | grew with the Electron 44 runtime |
| Renderer bundle | **439 KB / 3 files** (`dist/`) | essentially unchanged (423 KB JS + 25 KB CSS + 1 KB HTML) |
| Main-process bundle | **108 KB / 2 files** (`dist-electron/main.js` 104 KB + `preload.js` 6.6 KB) + 3 self-contained MCP bundles (~1.6 MB each) | was 25 separate CJS files |
| RAM after launch | **352–355 MB** (4 `Kora.exe` processes) | exit criterion < 300 MB **not met** yet — see FIXES.md |
| Start → visible window | warm **0.63 / 0.43 / 0.42 s** (2026-09-25, `MainWindowHandle` polling) | exit criterion < 1.5 s **met**; cold 3.22 s was measured on 2026-09-23 (a reboot is needed to re-measure) |
| Tests | **138 passed / 12 files / 871 lines** | plus 46 `cargo test` cases in `crates/kora-security` |
| Source size | renderer **39 files / 7644 lines**, main **26 files / 3629 lines** | tests excluded |
| Electron version | **44.4.5** (Chromium 152) | |

**Interpretation (drives the whole plan).** The renderer is not the bottleneck: 439 KB of UI code and
60 ms render coalescing already. The four metrics that can actually be improved are **install size**,
**RAM**, **start time** and **the cost of spawning child processes (MCP)**. The fifth metric users
complain about — *"the assistant answers slowly"* — is **LLM latency** and is addressed in Phase 0,
not by a rewrite. Be honest about this in PRs: a Rust rewrite will *not* make answers faster.

---

## 3. Phase 0 — cheap wins first, no rewrite (days, not months)

Do this **before** any porting work. It is cheap, reversible, and it either removes the need for a
rewrite or tells us exactly what still hurts.

- [x] **Electron 32 → 44.x.** Twelve majors of V8/Chromium improvements. The app already satisfies
      the hardened defaults (`contextIsolation`, `sandbox`, no `remote`), so this should be near-mechanical.
- [x] **Bundle the main process into one file** (esbuild or `electron-vite`) instead of 25 `tsc`-emitted
      CJS modules — fewer disk reads and `require` calls at boot.
- [x] **Ship as `asar`**, `asarUnpack` only for what really needs real files.
- [x] **Lazy service init in `main.ts`:** window first, then MCP manager / Obsidian cache / TTS / system polling.
- [x] **Stop spawning `npx` for MCP servers.** A reference server launched through `npx` costs a whole
      Node process (hundreds of MB, seconds). Biggest single real-world win, and it also removes the
      Windows zombie-process problem documented in `FIXES.md`.
- [x] **Structured output for agent decisions** (GBNF grammar / `response_format`): the current
      "please answer with a JSON object" + corrective-retry loop costs *extra full LLM passes*.
- [x] **Two-tier model routing:** a small model decides which tool to call; the large model only writes
      the final answer. Tool decisions are the most frequent LLM call in the loop.
- [x] **Token budget + summarisation for memory** (today history is trimmed by entry count only).
- [x] **`llama.cpp` / `llama-server` as a first-class provider option** (prompt caching, GPU offload).
- [x] **Local `whisper.cpp` STT option** instead of relying on the Web Speech API — also unblocks Phase 3.
- [x] **CI (GitHub Actions):** `vitest` + the three `tsc` checks on every push.
- [x] **App icon** — generated by `scripts/generate-icon.ps1` and embedded via `afterPack`/rcedit
      (done and verified 2026-09-23).
- [ ] **Code signing** — the installer is unsigned; needs a real certificate (open decision §10).

**Exit criteria for Phase 0:** warm start < 1.5 s (**met**: 0.42–0.63 s), idle RAM < 300 MB
(**not met** yet: 352–355 MB — no RAM-specific work has been done; the big cut arrives with the Rust
core, §4.1), 138 tests still green (**met**), and a written note in FIXES.md about what got better
and what did not (**done**).

---

## 4. The goal: core in Rust, thin front-ends on top

### 4.1 What we are aiming for

| Metric | Today | Target after the migration |
|---|---|---|
| Installer | 110.9 MB | **8–15 MB** |
| Unpacked application | 381.2 MB | **15–30 MB** |
| RAM idle | 352–355 MB | **80–180 MB** |
| Warm start | 0.42–0.63 s | **0.4–1.0 s** |
| Cold start | 3.22 s | **1–3 s** |
| MCP server start | bundled ESM via `ELECTRON_RUN_AS_NODE` (no `npx`) | in-process or single small binary |
| UI rendering speed | Chromium 152 | **the same** (WebView2 is Chromium too) |
| LLM answer latency | model-bound | **unchanged — by design** |

### 4.2 Why Rust (and not "just faster")

1. **No bundled browser and no Node runtime** — that is where the 381 MB and most of the RAM go.
2. **A real core instead of a "god hook":** the agent loop, tools, MCP and security become a
   standalone library that can be unit-tested and reused by a CLI or a web front.
3. **Memory safety for an app that executes shell commands** on the user's machine.
4. **Linear-time regex** (the `regex` crate) simplifies the ReDoS layer that currently exists in
   `electron/lib/regex-security.ts`.
5. **One binary, many fronts:** desktop (Tauri), CLI, and later a browser/Web UI over the same core.

---

## 5. Target architecture

```
┌──────────────────────────────┐        ┌───────────────────────────────────────────┐
│  kora-desktop (Tauri 2)      │        │  kora-core (Rust, headless)               │
│  WebView2 / WKWebView        │◄──────►│  agent loop · tool registry · security ·  │
│  React UI — unchanged        │ JSON-  │  config · audit · MCP · LLM gateway       │
│  window.kora.* kept as a     │  RPC   │                                           │
│  thin adapter over invoke()  │ stdio  │  also: kora-cli (same binary, headless)    │
└──────────────────────────────┘        └───────────────────────────────────────────┘
```

**The key tactic:** keep the renderer **byte-for-byte unchanged** at first. The new shell implements
the same `window.kora.*` object that `electron/preload.ts` exposes today, but every method forwards
to the core. That way the 7096 lines of React, Tailwind themes, i18n, markdown rendering and the
Obsidian graph do not have to be touched during the port — only the layer below them changes.

**Proposed crate layout**

```
crates/
  kora-core/        agent loop, planner, guards, memory, prompts, tool registry
  kora-security/    shell filter, path rules, regex guard, SSRF guard, policy engine
  kora-llm/         provider gateway (OpenAI-compatible, Anthropic, OpenRouter), SSE, retry
  kora-mcp/         MCP client + manager (rmcp), config, lifecycle
  kora-store/       config, chats, mcp.json, audit log (atomic writes, keyring for secrets)
  kora-rpc/         JSON-RPC 2.0 types + transport (stdio today, localhost later)
  kora-cli/         headless front (runs the agent without any UI)
  kora-desktop/     Tauri 2 shell (src-tauri) + the React bundle
```

---

## 6. Migration map — exactly what has to be ported

Everything below is derived from the current code, not from an idealised design.
Counts are from the 2026-09-22 baseline.

### 6.1 The bridge: 59 channels → Rust commands

| Domain | Channels | Today | After |
|---|---|---|---|
| `window` | 4 (+1 event) | `electron/main.ts` | Tauri window API + a small adapter |
| `system` | 14 | `electron/ipc/system.ts` (239 lines) | native OS calls / `windows` crate — **no more PowerShell per call** |
| `fs` | 13 | `electron/ipc/filesystem.ts` (343 lines) | `kora-security` path policy + `tokio::fs`, atomic writes |
| `mcp` | 11 (+1 event) | `electron/services/mcp/*` (~890 lines) | `kora-mcp` on `rmcp` |
| `ai` | 4 | `electron/ipc/ai.ts` + `services/api.ts` (365 lines) | `kora-llm` (reqwest + SSE) |
| `obsidian` | 3 | `electron/ipc/obsidian.ts` (206 lines) | Rust walker, rayon-parallel parse |
| `chats` | 3 | `electron/ipc/chats.ts` | `kora-store` |
| `tts` | 2 | `electron/services/tts.ts` + `msedge-tts` | see §6.6 |
| `clipboard` | 2 | `electron/ipc/clipboard.ts` | Tauri clipboard plugin |
| `web` | 2 | `electron/ipc/web.ts` (112 lines) | `kora-llm`/`kora-security` SSRF guard + reqwest |
| `shell` | 1 | `electron/ipc/shell.ts` | `kora-security` filter + `tokio::process` |
| **Total** | **59 + 2 events** | 25 files / 3336 lines | ~8 crates |

Rule that must survive the port: **every command re-validates its input inside the core** —
user confirmation in the UI is not a security boundary.

### 6.2 Security modules (port first — they have the tests)

| Today | Lines | After | Note |
|---|---|---|---|
| `electron/lib/shell-security.ts` | 84 | `kora-security::shell` | keep the "pipe-to-shell checked **before** normalisation" ordering |
| `electron/lib/regex-security.ts` | 78 | `kora-security::regex_guard` | the `regex` crate is linear-time; keep the depth/size limits, drop the backtracking heuristics if parity tests allow |
| `electron/lib/web-security.ts` | 17 | `kora-security::net` | same blocklist, plus redirect-hop checking |
| `src/lib/path-security.ts` | 3214 B | `kora-security::path` | `validatePath` / `validatePathRead` |
| `assertNotBlockedWrite`, `BLOCKED_WRITE_PATHS` | in `ipc/filesystem.ts` | `kora-security::path` | same per-OS blocklists |
| Confirmation model (`requiresConfirmation`, `DANGEROUS_COMMANDS`) | `tool-registry.ts`, `commands.ts` | `kora-security::policy` | recommended upgrade: a capability/token model instead of a boolean (see §13 of PROJECT_HANDOFF) |

### 6.3 Tools: 28 built-ins

`shell, file, patch_file, grep, open, dir, write, rename, delete, mkdir, stat, exists, help, volume,
mute, brightness, windows, shutdown, restart, sleep, lock, search, clipboard, ai_chat, ai_list_models,
ai_test_connection, tts_synthesize, tts_voices` + dynamic `mcp__<server>__<tool>`.

In Rust each becomes a trait implementation (`trait Tool { fn metadata(); async fn run(); }`) with the
same metadata shape, so that `buildSystemPrompt()` keeps working unchanged. Confirmation stays a
first-class field of the metadata, and handler failures must still be returned as
`{ success: false, error }` — never panics, never exceptions into the loop.

### 6.4 `!` commands and the agent loop

- `src/lib/commands.ts` (29 commands, 9 dangerous) → `kora-core::commands`. Keep `!calc` as a
  hand-written parser — **never** introduce an expression evaluator that can execute code.
- `src/agent/*` (orchestrator 16 KB, tool-registry 19 KB, guards, planner, memory, prompts) →
  `kora-core`. The retry/guard primitives (`IterationBudget`, `ToolLoopGuard`,
  `detectDegenerateRepetition`, `boundToolError`, `parseLlmErrorReason`) must be ported **with their
  tests**, not rewritten from scratch.
- Cross-process contracts to preserve byte-for-byte: `[kora:<reason>]`, `[DONE]`, `[ERROR] `, `[ABORT]`,
  and the single-JSON-object decision protocol.

### 6.5 Configuration, secrets, audit

| Today | After |
|---|---|
| `~/.kora/config.json`, atomic tmp+rename, write queue | `kora-store` with `serde` + `tempfile` + `rename`, same file format (keep the schema, do not break user data) |
| API keys encrypted with Electron `safeStorage`, `enc:<base64>` | OS keyring via the `keyring` crate (Windows Credential Manager / macOS Keychain / libsecret) |
| `~/.kora/chats.json`, `sanitizeChats()`, `.corrupt-*` backup | same behaviour, same format |
| `~/.kora/mcp.json` | same format |
| `~/.kora/audit.log` (JSON lines, 10 MB rotation) | same format, `tracing` appender |

**Migration requirement (do not skip):** existing users have keys encrypted with `safeStorage`. The
first Rust release must either read the legacy `enc:` values once and re-store them in the OS keyring,
or keep a documented decryption path during a transition window. Silently losing API keys is the one
unacceptable outcome of the whole rewrite.

### 6.6 Voice (the highest-risk area of the port)

| Capability | Today | Problem after the port | Plan |
|---|---|---|---|
| TTS | `msedge-tts` (Node package) in the main process | no Node runtime any more; the package is barely maintained | either re-implement the Edge read-aloud WebSocket call in Rust, or use Windows SAPI / a `tts` crate, or an online TTS provider — decide in a spike |
| STT | Web Speech API in the renderer (`useSpeechRecognition`) | **WebView2 does not implement the Web Speech API** (W3C WebView CG support tables, Sept 2026) — the microphone button would simply stop working | `whisper.cpp` (local, private, and a speed win) as the primary path, cloud STT as an option |
| Voice list / language switching | `tts:voices` | — | expose the same UI contract from the new backend |

### 6.7 Renderer: what is kept and what changes

**Kept as-is (do not touch during the port):** `App.tsx`, all `components/*` (Chat, Sidebar, Settings,
MCPSettings, Graph, System, Agent, Layout), `hooks/useChat.ts`, `hooks/useUnifiedChat.ts`, `i18n/*`,
`styles/global.css`, Tailwind config, markdown rendering.

**Changed:** `hooks/useConfig.ts`, `hooks/useSystem.ts`, `hooks/useTTS.ts` and the `window` interface in
`src/types/index.ts` — but only through the `window.kora.*` shim, so the diff stays small.
`electron/preload.ts` is deleted and replaced by that shim.

**Not worth doing:** swapping React for Svelte/Solid/Preact. The renderer is 439 KB; the perceived
speed difference is negligible next to any item in Phase 0.

### 6.8 Tests: 138 → Rust

The iron rule transfers unchanged: **tests import the real production modules, never a copy of the
logic.** Target: the same 138 scenarios as `cargo test` (unit + parity tests), plus new tests for what
currently has none — `kora-store` atomic writes and corruption recovery, `kora-llm` retry/backoff,
`kora-mcp` lifecycle, and the new capability/policy model.

### 6.9 Parity checklist — things that must not regress

A port replaces everything below the UI, so it needs an explicit checklist:

- [ ] every one of the 59 channels has a Rust counterpart and a smoke test
- [ ] dangerous tools still require confirmation; the `!confirm` flow behaves identically
- [ ] commands found in **model output** are still never executed
- [ ] `[kora:<reason>]` markers and stream terminators unchanged
- [ ] `~/.kora/*` file formats unchanged; legacy `enc:` keys readable once
- [ ] audit log unchanged in shape
- [ ] i18n EN/RU complete; all 4 themes render correctly in WebView2 (and WKWebView)
- [ ] Obsidian graph still usable at 5000+ notes

---

## 7. Phases

| Phase | Deliverable | Exit criteria | Relative effort |
|---|---|---|---|
| **P0** | Electron 44, single-file main, asar, lazy init, MCP without `npx`, structured output, two-tier routing, token budget, llama.cpp, whisper.cpp, icon | warm start < 1.5 s ✅ (0.42–0.63 s), RAM < 300 MB ❌ (352–355 MB — deferred to the Rust core), 138 tests green ✅ | 1 |
| **P1** | Core boundary defined **in TypeScript first**: a JSON-RPC schema + a headless runner | the agent runs headless from a script; the Electron app uses that same core module; tests green | 2 |
| **P2** | `kora-security` (ported: 46 parity/unit tests green under `cargo test`) + `kora-store` (stub) on Rust with parity tests | the ported scenarios are green under `cargo test` (pure functions — the cheapest part of the port); `~/.kora/*` formats unchanged | 3 |
| **P3** | `kora-core` + `kora-llm` + `kora-mcp` in Rust; `kora-cli` usable | `kora-cli` completes a full agent cycle (tools, MCP, retries) with no UI at all | 5 |
| **P4** | `kora-desktop`: Tauri 2 shell + the `window.kora.*` shim, JsAPI behind a `capabilities` file | the §6.9 parity checklist passes; installer < 15 MB; warm start < 1 s | 4 |
| **P5** | Voice on Rust (whisper.cpp + new TTS), updater, code signing | no Node/Electron left in the shipped app; the release pipeline is green on a clean machine | 3 |

**Transition strategy:** keep the Electron build alive until P4 passes the parity checklist. Two shells
sharing one core for a while is a feature, not a mess — it makes the migration reversible at any point.

---

## 8. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| WebView2 lacks the Web Speech API → the microphone button dies | high (visible feature loss) | do §6.6 / whisper.cpp **before** the desktop port |
| Two webview engines (WebView2 + WKWebView) → CSS/API divergence | medium | visual regression pass per engine; avoid cutting-edge CSS; test macOS before advertising it |
| Losing user API keys in the `safeStorage` → OS keyring move | high (trust) | the migration path in §6.5 + an explicit test with a legacy config fixture |
| No Rust equivalent for `msedge-tts` | medium | spike early; fall back to SAPI / a provider |
| Rust learning curve slows feature velocity | medium | port the pure modules first (P2), where both the payoff and the tests are |
| Tauri plugin gaps (tray, updater, deep links) | low–medium | verify each plugin at P1/P2, not at P4 |
| Installer/updater signing still missing (CI exists since Phase 0) | medium | signing: certificate decision (§10); updater in P5 |
| Scope creep — "while we are at it, let's redesign the UI too" | high | §9 Non-goals is binding |
| Cold start on a machine without the WebView2 Runtime | low (Windows 11 ships it) | Tauri bootstrapper; document it |

---

## 9. Non-goals (deliberately out of scope)

1. **Rewriting the UI framework.** React + Tailwind + i18n + the graph canvas stay.
2. **Expecting a stack change to make LLM answers faster.** Only model choice, routing and prompting do that.
3. **Redesigning the `~/.kora/*` formats** for their own sake — user-data migration is risk without reward.
4. **Rewriting the dated audit documents.** New findings go to `FIXES.md`.
5. **Dropping the Windows-first focus.** Windows stays the primary target; other platforms are "works, unverified".

---

## 10. Open decisions (need a human choice)

| # | Question | Options | Recommendation |
|---|---|---|---|
| 1 | Which shell? | Tauri 2 (Rust) · Wails v3 (Go) · .NET + WebView2 · Electrobun 2.0 | **Tauri 2** — same language as the core, Rust MCP SDK exists, best size/startup numbers |
| 2 | Core transport | JSON-RPC over stdio · localhost HTTP · in-process only | stdio first (keeps `kora-cli` free), localhost later |
| 3 | Keep Electron during the transition? | yes · switch in one step | yes, until the §6.9 checklist passes |
| 4 | STT | whisper.cpp local · cloud · Windows SAPI | whisper.cpp (privacy + speed + it unblocks the port) |
| 5 | TTS | Rust port of Edge TTS · SAPI · provider | spike both, decide by output quality |
| 6 | Confirmation model | keep the boolean `requiresConfirmation` · capability tokens | capability tokens (also a known limitation in PROJECT_HANDOFF §13) |
| 7 | Version numbering | 1.x → 2.0 · stay 1.x | **2.0** — replacing the runtime deserves a major bump |

---

## 11. Changelog for this file

| Date | Change |
|---|---|
| 2026-09-22 | File created. Baseline measured (§2), Phase 0 defined (§3), Rust migration plan drafted (§4–§10). Nothing implemented. |
| 2026-09-22 | **Rust workspace scaffolded (separate from the row above):** `Cargo.toml` (workspace, version `2.0.0-alpha.1`) + `crates/` — `kora-security` ported with parity tests (**46 cases green under `cargo test`**: shell 10, path 11, web 15, JS-semantics 10), `kora-store` / `kora-llm` / `kora-mcp` stubs with port notes; `docs/CORE_RPC.md` written as the P1 `kora-rpc/1` design (nothing implemented on the Rust core side yet). |
| 2026-09-23 | Phase 0 started — 6 items done and verified (100 tests + 3 `tsc` green, full `electron:build` + packaged MCP handshake tested): Electron 32 → **44.4.5**; main process bundled by esbuild (`dist-electron/main.js` + `preload.js`, 2 files instead of 25); `asar` made explicit with `asarUnpack: dist-electron/mcp/**`; lazy service init in `main.ts` (window first, MCP autostart in background with a `disposed` quit-guard); MCP servers no longer spawn `npx` — self-contained ESM bundles under `dist-electron/mcp/` launched via `ELECTRON_RUN_AS_NODE` (bundled packages moved to devDependencies; `~/.kora/mcp.json` migrated automatically), because `ELECTRON_RUN_AS_NODE` cannot read inside `app.asar`; CI workflow `.github/workflows/ci.yml` added (runs on GitHub still to be confirmed on first push). Still open in Phase 0: structured output, two-tier routing, token budget, llama.cpp provider, whisper.cpp STT, icon + code signing. Note: installer grew 81.4 → 110.9 MB (Electron 44 runtime); re-baseline after Phase 0. |
| 2026-09-23 | **Structured output** done and verified (115 tests + 3 `tsc` green): agent decision calls now send `response_format: {type:"json_object"}` end-to-end (orchestrator → preload → IPC → gateway), including local providers via LMStudioClient; Anthropic (no such parameter) keeps the prompt-only path; providers that reject the parameter are retried once without it (`isJsonModeRejected`, auth/model/context errors never retried). New tests: `api-json-mode` (8), `decision-parse` (7, production parser now exported). |
| 2026-09-23 | **Two-tier model routing** done and verified (3 `tsc` green; new `decision-routing` suite with 10 cases): optional `agentDecisionModel`/`agentDecisionProvider` (Settings UI, EN/RU) — the small tier answers "which tool next?", the large model writes the final prose via `buildFinalAnswerPrompt()`; `resolveDecisionLlmOptions()` returns null when the feature is off or unsafe (empty model, cloud provider without a key, `custom` sharing `apiBaseUrl`); with no decision model configured the behaviour is byte-for-byte the old single tier. |
| 2026-09-23 | **Token budget + summarisation, `llama.cpp` provider, local `whisper.cpp` STT** done and verified (138 tests + 3 `tsc` green): `src/agent/token-budget.ts` fits agent history to `CONFIG.agent.HISTORY_TOKEN_BUDGET` (oldest dropped first, newest four kept) and the orchestrator summarises newly dropped segments once per cycle via `buildMemorySummaryPrompt` into an `[Earlier conversation summary]` system note (failures non-fatal); `llamacpp` is a first-class local provider (localhost:8080, no key, `llamacppUrl` config + Settings UI + resolver + key exemptions) usable in both tiers; voice input gained an offline engine — the `stt:transcribe` IPC runs the user's `whisper-cli` on a 16 kHz mono WAV produced by the new renderer pipeline (`useWhisperSTT` + pure `src/lib/wav.ts`), Web Speech stays the default. App icon generated by `scripts/generate-icon.ps1` and wired into `win.icon`; code signing remains open (requires a real certificate — human decision, see §10). |
| 2026-09-25 | **Phase 0 close-out pass:** full re-verification green — vitest **138/138** (12 files), three `tsc` checks, `cargo test` **46/46**, clippy clean apart from two unused-import warnings in `kora-security` tests (fmt drift noted for the P2 cleanup); metrics re-measured (§2 above): warm start met (0.42–0.63 s), RAM criterion deferred; both ROADMAP files and the other docs re-synced against the code. CI: first run on GitHub pending the push of this pass. |
