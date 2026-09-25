# Kora — AI Desktop Assistant

A local-first AI desktop assistant in the spirit of JARVIS. Built with **Electron**: an LLM chat
plus a **ReAct agent** that can work with files, the shell, the web and the system on its own.

Providers are local (**LM Studio**, **Ollama**, **llama.cpp**) or cloud-based (any OpenAI-compatible API,
**Anthropic**, **OpenRouter**, Gemini, Groq, DeepSeek, Mistral, xAI). It includes speech synthesis
and recognition (Web Speech API or offline **whisper.cpp**), and tool extension through **MCP** servers.

## Features

- 💬 **Streaming chat** — token-by-token responses, markdown rendering, read-aloud.
- 🧠 **ReAct agent** — a "thought → tool → observation" loop with an iteration budget and guards
  against loops, repeated calls and hallucination.
- 🛠 **Tools** — files and folders, shell, grep, web search, clipboard, system control
  (volume, brightness, lock/sleep/shutdown), TTS. Dangerous operations require confirmation.
- 🔌 **MCP** — connect any Model Context Protocol server (managed and diagnosed from the UI).
- 🕸 **Obsidian graph** — visualize a notes vault: tags, links, force layout on canvas.
- 🔊 **Voice** — synthesis (msedge-tts) and recognition (Web Speech API, or the offline **whisper.cpp** engine), language follows the UI locale.
- 🎨 **Themes** — Dark / Crimson / Light / Retro; **EN / RU** localization.

## Download

### For users — get the ready-to-run app
Check the [**Releases**](https://github.com/mineones047-ux/KoraDesctop/releases) page for a prebuilt
installer (`.exe` on Windows, `.dmg` on macOS, `.AppImage` on Linux). If no release has been published
yet, use one of the developer options below.

### For developers — get the source code

Using Git:

```bash
git clone https://github.com/mineones047-ux/KoraDesctop.git
cd KoraDesctop
```

Without Git: open the repository page, click the green **Code → Download ZIP** button, then unpack the archive.

Either way, continue with [Requirements](#requirements) and [Install](#install) below.

## Requirements

- **Node.js 18+** and npm
- Windows / macOS / Linux
- For local models — a running LM Studio (port `1234`), Ollama (port `11434`) or llama.cpp `llama-server` (port `8080`)

## Install

```bash
npm install
```

## Run (development)

```bash
npm run dev
```

The script bundles the main process (`esbuild` via `scripts/build-main.cjs`), starts the Vite dev server and launches Electron.
Windows alternative: `start.bat`.

## Build

```bash
npm run build            # production renderer build (Vite -> dist/)
npm run build:main       # main-process bundle (esbuild -> dist-electron/main.js + preload.js)
npm run electron:build   # build + installer (electron-builder -> release/)
```

## Tests and checks

```bash
npm test                                  # vitest run — 138 tests
npx tsc -p tsconfig.json --noEmit         # renderer typecheck
npx tsc -p tsconfig.electron.json         # main-process typecheck (noEmit; bundling is npm run build:main)
npx tsc -p tsconfig.node.json --noEmit    # build-config typecheck
```

## Architecture

Two processes and the bridge between them:

```
┌─────────────────────┐   window.kora.*   ┌──────────────────────────┐
│  Renderer (React)   │ ◄──── preload ───►│  Main (Electron/Node)    │
│  src/               │    IPC channels   │  electron/               │
│  UI + agent + chat  │                   │  fs, shell, net, TTS     │
└─────────────────────┘                   └──────────────────────────┘
```

- **Renderer** (`src/`, bundled by Vite) — React 18 + TypeScript + Tailwind: UI, chat, ReAct agent,
  tool registry.
- **Main** (`electron/`, bundled by esbuild into `dist-electron/main.js` + `preload.js`) — every privileged operation:
  filesystem, shell, network, TTS, MCP, config, audit. The renderer has no direct Node access —
  only the `window.kora.*` IPC channels declared in `preload.ts`.
- **Shared security logic** (`electron/lib/`) — pure modules with no Electron imports, so both the
  main process and the tests use them (tests exercise exactly the code that runs in production).

### Message flow

`useUnifiedChat.sendMessage()` decides via `needsAgent()`:

1. **Conversation / `!` commands** → `useChat` (LLM streaming + commands from `lib/commands.ts`).
2. **Tool-backed task** → `useReActAgent.startCycle()` (the "thought → tool → observation" loop),
   whose result is appended to the same chat.

## Project structure

```
src/
  App.tsx                     — UI composition
  hooks/useUnifiedChat.ts     — chat/agent routing
  hooks/useChat.ts            — chat, streaming, ! commands, Stop
  agent/orchestrator.ts       — ReAct loop, retry policy, grounding
  agent/planner.ts            — agent state machine
  agent/memory.ts             — conversation memory (ref mirrors)
  agent/guards.ts             — iteration budget, loop guard, repetition guard
  agent/tool-registry.ts      — tool registry + MCP
  agent/intent.ts             — whether the agent is needed
  lib/commands.ts             — ! commands
  lib/path-security.ts        — path pre-checks
  components/                 — UI (Chat, Sidebar, Settings, Graph, System, Agent)
electron/
  main.ts / preload.ts        — window and the window.kora.* bridge
  ipc/*.ts                    — IPC handlers
  lib/*.ts                    — shell / regex / web security (shared with tests)
  services/api.ts             — LLM gateway, retry, SSE
  services/config.ts          — config, key encryption
  services/mcp/               — MCP client / manager / protocol
  services/audit-log.ts       — shell audit log
```

## Documentation

- [Project handoff](docs/PROJECT_HANDOFF.md) — full technical context (architecture, data flows, protocols, security model, build notes, conventions)
- [Roadmap](docs/ROADMAP.md) — planned work: cheap performance wins first, then the plan to rewrite the core in Rust (phases, migration map, risks)
- [Core RPC contract](docs/CORE_RPC.md) — the `kora-rpc/1` design: the JSON-RPC boundary between the Rust core and every shell (Phase P1)
- [Architecture](docs/ARCHITECTURE.md)
- [Fixes journal](docs/FIXES.md)
- [Security audit](docs/SECURITY_AUDIT.md)
- [Security fixes](docs/SECURITY_FIXES.md)
- [Code review](docs/CODE_REVIEW.md)

## Configuration

Stored in `~/.kora/`:

- `config.json` — settings (provider, model, keys, theme, language, Obsidian path). API keys are
  encrypted with `safeStorage` (prefix `enc:`); writes are atomic.
- `chats.json` — chat history (a corrupted file is backed up to `.corrupt-*`).
- `mcp.json` — list of MCP servers.
- `audit.log` — shell execution log.

## Security

- Electron with `contextIsolation`, `sandbox`, `nodeIntegration: false`; navigation is restricted.
- Dangerous shell command filter (including pipe-to-shell), SSRF protection for `web:fetch`,
  ReDoS protection for grep, and a system path blocklist.
- Dangerous tools and `!` commands require explicit confirmation.
- Commands found in model output are **never executed automatically** — they are shown as text.

## Stack

React 18 · TypeScript 5 · Tailwind CSS 3 · Electron 44 · Vite 5 · Vitest 4 · esbuild · msedge-tts

## License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

