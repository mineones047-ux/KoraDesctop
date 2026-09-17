# Kora — how the project works

_Date: September 15, 2026. Describes the current state of the codebase after the fixes listed in FIXES.md._

---

## What it is

Kora is a local-first AI desktop assistant in the spirit of JARVIS. An Electron app: an LLM chat plus
a ReAct agent that can work with files, the shell, the web and the system on its own. Providers are
local (LM Studio, Ollama) or cloud-based (any OpenAI-compatible API, Anthropic, OpenRouter). Voice —
synthesis (msedge-tts) and speech recognition. Tool extension — via MCP servers.

## Two processes and the bridge between them

```
┌─────────────────────┐   window.kora.*   ┌──────────────────────────┐
│  Renderer (React)   │ ◄──── preload ───►│  Main (Electron/Node)    │
│  src/               │    IPC channels   │  electron/               │
│  UI + agent + chat  │                   │  fs, shell, net, TTS     │
└─────────────────────┘                   └──────────────────────────┘
```

- **Renderer** (`src/`, compiled by Vite): React 18 + TypeScript + Tailwind. All of the UI, chat,
  ReAct agent and tool registry live here.
- **Main** (`electron/`, compiled by `tsc -p tsconfig.electron.json` into `dist-electron/`): every
  privileged operation — filesystem, shell, network, TTS, MCP, config, audit. The renderer has no
  direct Node access — only through the `window.kora.*` IPC channels declared in `preload.ts`.
- **Shared security logic** (`electron/lib/`): pure modules with no Electron imports, so both the
  main process and the tests import them — tests always exercise exactly the code that runs in
  production (fix of Sept 15).

## Message flow

Entry point — `useUnifiedChat.sendMessage()` (src/hooks/useUnifiedChat.ts). Every message goes
through a fork:

1. **`needsAgent()`** (`src/agent/intent.ts`) decides: is this a conversation or a task for the computer?
2. **Conversation / `!commands`** → `useChat.sendMessage()`: LLM response streaming via
   `ai:chatStream`, plus handling of `!` commands (shell, file, dir, calc, search, etc. —
   `src/lib/commands.ts`).
3. **Task (files, shell, system)** → the ReAct agent `useReActAgent.startCycle()` — the
   "thought → tool → observation" loop; the result is appended to the same chat.

## The agent's ReAct loop (src/agent/)

`startCycle` → `runStep` (recursive, up to `MAX_STEPS`):

1. **Context is assembled** — system prompt (`prompts.ts`) + history from memory (`memory.ts`, ref
   mirrors against stale closures) + the current request.
2. **The LLM is streamed** (`streamDecisionText`) and must answer with a JSON decision:
   `{"action":"call_tool","tool":...,"parameters":...}` or `{"action":"finish","answer":...}`.
   `parseAgentResponse` carefully extracts JSON even from markdown fences.
3. **Retry policy** (ported from the Hermes agent, `guards.ts`): invalid JSON → corrective prompts;
   an empty response twice in a row → stop; degeneration into repeated text → the
   `detectDegenerateRepetition` detector; rate_limit / server_error / network / timeout → retry with
   exponential backoff; context overflow → drop the older half of the history once.
4. **Hang protection**: `IterationBudget` (step limit), `ToolLoopGuard` (identical consecutive tool
   calls → a synthetic warning injected into the model), error truncation `boundToolError` (one error
   cannot flood the context).
5. **Tool execution** — via `ToolRegistry.execute()`:
   - `requiresConfirmation: true` → not executed immediately; it returns
     `{status:'pending_confirmation'}`; the UI asks the user, and `resumeAfterConfirmation(approved)`
     either executes or refuses.
   - **Grounding guard**: if the question is about the filesystem and no tool was used, the agent
     forcibly runs `dir` on the path from the request before trusting the model's answer
     (anti-hallucination).
6. **The observation** is appended to memory and the loop repeats until the model says `finish` or
   hits the limits. `stop()` (the Stop button) extinguishes the loop instantly: abort checks run both
   after the LLM call and before tool execution — a "dead" decision is never executed.

## Tool registry (src/agent/tool-registry.ts)

- **Built-in** (`BUILTIN_TOOL_METADATA`): shell, file (read/write/delete/...), patch_file, grep, open,
  dir, write, rename, delete, mkdir, stat, exists, volume/mute/brightness/windows/shutdown/restart/
  sleep/lock, search (DuckDuckGo), clipboard, help, ai_chat/ai_list_models/ai_test_connection,
  tts_synthesize/tts_voices. Each carries metadata: parameters, description and a confirmation flag.
- **MCP tools**: loaded from running servers (`refreshMcpTools`); metadata is converted from JSON
  Schema; a server's `destructiveHint` automatically enables confirmation. An unknown MCP tool is
  never executed blindly.
- Every call goes through the `window.kora.*` IPC — the renderer cannot do anything privileged by itself.

## IPC channels (electron/ipc/)

| Module | Channels | What it does |
|---|---|---|
| filesystem.ts | `fs:readFile/writeFile/patchFile/grep/readDir/delete/rename/copy/mkdir/stat/exists/findFiles` | file operations with path validation, atomic writes and ReDoS-safe grep |
| shell.ts | `shell:execute` | command execution with a dangerous-command filter and auditing |
| web.ts | `web:search`, `web:fetch` | DuckDuckGo search, page fetching with SSRF protection |
| system.ts | `system:openApp/shutdown/restart/sleep/lock/volume/mute/brightness/windows` | system control |
| ai.ts | `ai:chat/chatStream/listModels/testConnection` | LLM gateway (SSE streaming) |
| mcp.ts | `mcp:listTools/call/...` | MCP tool invocation |
| tts.ts | `tts:synthesize/voices` | msedge-tts speech synthesis |
| chats.ts | `chats:load/save/saveSync` | chat history persistence |
| clipboard.ts, obsidian.ts | — | clipboard; Obsidian vault scanning for the knowledge graph |

## Security layers

Protection follows the principle "the renderer does not trust itself, the main process does not trust
the renderer":

1. **Renderer pre-check** (`src/lib/path-security.ts`): `validatePath` blocks drive roots, system
   directories, null bytes and `..` traversal. It is duplicated in case the UI is compromised — the
   real check still happens in the main process.
2. **Main — paths**: `resolveSafePath` (expand `~`, `path.resolve`, length limit) +
   `assertNotBlockedWrite` (System32, Program Files, ProgramData, Startup, `.ssh`, `.gnupg`, `/etc`, ...).
   Writes are always atomic: a tmp file with a crypto suffix and `0600` permissions → rename.
3. **Main — commands** (`electron/lib/shell-security.ts`): pipe-to-shell patterns (`curl | bash`) are
   checked BEFORE normalization (normalization replaces `|` with a space, which would break detection);
   then dangerous patterns (format, rm -rf, taskkill, reg, shutdown, ...) are matched on the
   normalized string.
4. **Main — grep** (`electron/lib/regex-security.ts`): `isUnsafeRegex` rejects catastrophic
   backtracking (`(a+)+`), adjacent quantifiers, duplicate alternation branches and incomplete
   quantifiers (`a{1,` — rule #5, added Sept 15); pattern length limit is 200.
5. **Main — network** (`electron/lib/web-security.ts`): http/https only; blocks localhost, 127/8,
   10/8, 172.16/12, 192.168/16, 169.254/16 (SSRF/metadata) and private IPv6 ranges; response body
   limit 5 MB.

6. **Confirmations**: any destructive tool (and any `!` command) requires an explicit `!confirm` or a
   click. `!confirm` executes with `bypassConfirm=true` — without asking again (fix for the infinite
   loop described in FIXES.md).
7. **API keys** (`electron/services/config.ts`): encrypted via `safeStorage` (prefix `enc:`), with
   migration of legacy plaintext keys.
8. **Audit** (`electron/services/audit-log.ts`): every shell execution is logged.
9. **Electron configuration** (`electron/main.ts`): sandbox, exact host:port comparison for the dev
   server (no `startsWith` bypass), navigation blocking.

## LLM gateway (electron/services/api.ts)

- Providers: `lmstudio` / `ollama` (keyless, local URLs), OpenAI-compatible, `anthropic` (its own body
  and header format), `openrouter` (a custom baseUrl is respected).
- **Error classification**: 429 → rate_limit; 401/403 → auth; 404 + "model" → model_not_found; context
  overflow patterns; 5xx → server_error; network errors → network/timeout. Retry with jittered backoff
  and respect for `Retry-After` applies only to retryable reasons; auth and model_not_found fail fast.
- **SSE streaming**: `data:` line parsing, a final flush of the tail buffer (the last chunk is not
  lost), reader `releaseLock`, handling of Anthropic errors inside the stream, and correct termination
  on abort.

## Persistence (`~/.kora/`)

- `config.json` — settings (provider, model, encrypted keys, theme, language, Obsidian path); atomic
  tmp+rename write with a write queue.
- `chats.json` — chat history; a corrupted file is backed up to `.corrupt-*` instead of being silently
  lost; flushed when the window closes.
- `mcp.json` — list of MCP servers; the manager (`electron/services/mcp/manager.ts`) uses a start
  mutex; on Windows it kills with `taskkill /T /F` — taking down the whole process tree (otherwise
  `npx → node` zombies remain).

## Voice

- TTS: msedge-tts (`electron/services/tts.ts`), 30 s timeout, 5000-character limit; volume control in
  the UI.
- Recognition: the Web Speech API in the renderer (`useSpeechRecognition`), language ru-RU/en-US based
  on the UI language.

## Running and verifying

```
npm run dev        # vite + electron (scripts/electron-dev.cjs: tsc → wait for vite → electron .)
npm run test       # vitest run — 100 tests (7 files)
npx tsc -p tsconfig.json --noEmit          # renderer typecheck
npx tsc -p tsconfig.electron.json          # main typecheck + build
npx vite build     # production renderer build
npm run electron:build  # + electron-builder (NSIS installer)
```

## Key file map

```
src/
  App.tsx                     — UI composition
  hooks/useUnifiedChat.ts     — chat/agent routing
  hooks/useChat.ts            — chat, streaming, ! commands, Stop
  agent/orchestrator.ts       — ReAct loop, retry policy, grounding
  agent/planner.ts            — agent state machine (think/act/observe)
  agent/memory.ts             — conversation memory (ref mirrors)
  agent/guards.ts             — iteration budget, loop guard, repetition guard
  agent/tool-registry.ts      — tool registry + MCP
  agent/intent.ts             — whether the agent is needed
  lib/commands.ts             — ! commands
  lib/path-security.ts        — path pre-checks
electron/
  main.ts / preload.ts        — window, window.kora.* bridge
  ipc/*.ts                    — all IPC handlers
  lib/shell-security.ts       — dangerous-command filter (shared with tests)
  lib/regex-security.ts       — ReDoS protection for grep (shared with tests)
  lib/web-security.ts         — SSRF protection (shared with tests)
  services/api.ts             — LLM gateway, retry, SSE
  services/config.ts          — config, key encryption
  services/mcp/               — MCP client/manager/protocol
  services/audit-log.ts       — shell audit
docs/FIXES.md                 — fixes journal
docs/SECURITY_AUDIT.md, docs/SECURITY_FIXES.md, docs/CODE_REVIEW.md — security reviews
```
