# Kora — AI Desktop Assistant

Локальный ИИ-ассистент для рабочего стола в стиле JARVIS. Приложение на **Electron**: чат с LLM
плюс **ReAct-агент**, который сам умеет работать с файлами, shell, вебом и системой.

Провайдеры — локальные (**LM Studio**, **Ollama**) или облачные (любой OpenAI-совместимый API,
**Anthropic**, **OpenRouter**, Gemini, Groq, DeepSeek, Mistral, xAI). Есть синтез и распознавание
речи, а также расширение инструментов через **MCP**-серверы.

## Возможности

- 💬 **Чат со стримингом** — ответы приходят токенами, поддержка markdown, озвучка.
- 🧠 **ReAct-агент** — цикл «мысль → инструмент → наблюдение» с бюджетом итераций, защитой от
  зацикливания, повторных вызовов и галлюцинаций.
- 🛠 **Инструменты** — файлы и папки, shell, grep, веб-поиск, буфер обмена, управление системой
  (громкость, яркость, lock/sleep/shutdown), TTS. Опасные операции требуют подтверждения.
- 🔌 **MCP** — подключение любых Model Context Protocol серверов (управление и диагностика в UI).
- 🕸 **Граф Obsidian** — визуализация хранилища заметок: теги, ссылки, физическая раскладка на canvas.
- 🔊 **Голос** — синтез (msedge-tts) и распознавание (Web Speech API), язык по локали интерфейса.
- 🎨 **Темы** — Dark / Crimson / Light / Retro; локализация **RU / EN**.

## Требования

- **Node.js 18+** и npm
- Windows / macOS / Linux
- Для локальных моделей — запущенный LM Studio (порт `1234`) или Ollama (порт `11434`)

## Установка

```bash
npm install
```

## Запуск (разработка)

```bash
npm run dev
```

Скрипт компилирует main-процесс (`tsc`), поднимает Vite dev-сервер и запускает Electron.
Альтернатива для Windows — `start.bat`.

## Сборка

```bash
npm run build            # production-сборка рендерера (Vite → dist/)
npm run electron:build   # сборка + инсталлятор (electron-builder → release/)
```

## Тесты и проверки

```bash
npm test                                  # vitest run — 100 тестов
npx tsc -p tsconfig.json --noEmit         # typecheck рендерера
npx tsc -p tsconfig.electron.json         # typecheck + сборка main-процесса
npx tsc -p tsconfig.node.json --noEmit    # typecheck конфигов сборки
```

## Архитектура

Два процесса и мост между ними:

```
┌─────────────────────┐   window.kora.*   ┌──────────────────────────┐
│  Renderer (React)   │ ◄──── preload ───►│  Main (Electron/Node)    │
│  src/               │    IPC-каналы     │  electron/               │
│  UI + агент + чат   │                   │  файлы, shell, сеть, TTS │
└─────────────────────┘                   └──────────────────────────┘
```

- **Renderer** (`src/`, собирает Vite) — React 18 + TypeScript + Tailwind: UI, чат, ReAct-агент,
  реестр инструментов.
- **Main** (`electron/`, компилирует `tsc` в `dist-electron/`) — все привилегированные операции:
  файловая система, shell, сеть, TTS, MCP, конфиг, аудит. Рендерер не имеет доступа к Node —
  только IPC-каналы `window.kora.*`, объявленные в `preload.ts`.
- **Общая логика безопасности** (`electron/lib/`) — чистые модули без electron-импортов, поэтому
  их используют и main-процесс, и тесты (тесты проверяют ровно тот код, что работает в проде).

### Путь сообщения пользователя

`useUnifiedChat.sendMessage()` решает через `needsAgent()`:

1. **Разговор / `!`-команды** → `useChat` (стриминг LLM + команды из `lib/commands.ts`).
2. **Задача с инструментами** → `useReActAgent.startCycle()` (цикл «мысль → инструмент → наблюдение»),
   результат дописывается в тот же чат.

## Структура проекта

```
src/
  App.tsx                     — композиция UI
  hooks/useUnifiedChat.ts     — развилка чат/агент
  hooks/useChat.ts            — чат, стриминг, !-команды, Stop
  agent/orchestrator.ts       — ReAct-цикл, retry-политика, grounding
  agent/planner.ts            — state-машина агента
  agent/memory.ts             — память диалога (ref-зеркала)
  agent/guards.ts             — бюджет итераций, loop-guard, повторения
  agent/tool-registry.ts      — реестр инструментов + MCP
  agent/intent.ts             — нужен ли агент
  lib/commands.ts             — !-команды
  lib/path-security.ts        — pre-check путей
  components/                 — UI (Chat, Sidebar, Settings, Graph, System, Agent)
electron/
  main.ts / preload.ts        — окно и мост window.kora.*
  ipc/*.ts                    — IPC-хендлеры
  lib/*.ts                    — shell / regex / web security (общие с тестами)
  services/api.ts             — LLM-шлюз, retry, SSE
  services/config.ts          — конфиг, шифрование ключей
  services/mcp/               — MCP-клиент / менеджер / протокол
  services/audit-log.ts       — аудит shell
```

## Конфигурация

Хранится в `~/.kora/`:

- `config.json` — настройки (провайдер, модель, ключи, тема, язык, путь Obsidian). API-ключи
  шифруются через `safeStorage` (префикс `enc:`); запись атомарная.
- `chats.json` — история чатов (битый файл бэкапится в `.corrupt-*`).
- `mcp.json` — список MCP-серверов.
- `audit.log` — журнал shell-выполнений.

## Безопасность

- Electron с `contextIsolation`, `sandbox`, `nodeIntegration: false`; навигация ограничена.
- Фильтр опасных shell-команд (включая pipe-to-shell), SSRF-защита `web:fetch`, ReDoS-защита grep,
  блоклист системных путей.
- Опасные инструменты и `!`-команды требуют явного подтверждения.
- Команды из ответов модели **не исполняются автоматически** — показываются как текст.

## Стек

React 18 · TypeScript 5 · Tailwind CSS 3 · Electron 32 · Vite 5 · Vitest 4 · msedge-tts

## Лицензия

Проект распространяется под лицензией **MIT** — подробности в файле [LICENSE](LICENSE).

