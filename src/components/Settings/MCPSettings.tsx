import { useEffect, useState, useCallback, useRef } from 'react'
import type { MCPServerStatus, MCPServerConfigInput, MCPToolWithServer } from '../../types'

interface MCPSettingsProps {
  lang: 'en' | 'ru'
}

const t = (lang: 'en' | 'ru', en: string, ru: string) => (lang === 'ru' ? ru : en)

interface DraftServer {
  id: string
  name: string
  command: string
  args: string
  cwd: string
  env: string
  description: string
  enabled: boolean
  autoStart: boolean
  requestTimeoutMs: string
}

function emptyDraft(): DraftServer {
  return {
    id: '',
    name: '',
    command: '',
    args: '',
    cwd: '',
    env: '',
    description: '',
    enabled: true,
    autoStart: true,
    requestTimeoutMs: '',
  }
}

function toDraft(s: MCPServerConfigInput): DraftServer {
  return {
    id: s.id,
    name: s.name,
    command: s.command,
    args: (s.args ?? []).join(' '),
    cwd: s.cwd ?? '',
    env: s.env ? Object.entries(s.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
    description: s.description ?? '',
    enabled: s.enabled,
    autoStart: s.autoStart !== false,
    requestTimeoutMs: s.requestTimeoutMs ? String(s.requestTimeoutMs) : '',
  }
}

function parseEnv(text: string): Record<string, string> | undefined {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const k = trimmed.slice(0, eq).trim()
    const v = trimmed.slice(eq + 1).trim()
    if (k) env[k] = v
  }
  return Object.keys(env).length ? env : undefined
}

function parseArgs(text: string): string[] | undefined {
  const parts: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) {
        quote = null
      } else {
        cur += c
      }
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === ' ' || c === '\t') {
      if (cur) {
        parts.push(cur)
        cur = ''
      }
    } else {
      cur += c
    }
  }
  if (cur) parts.push(cur)
  return parts.length ? parts : undefined
}

function genId(): string {
  return `srv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function MCPSettings({ lang }: MCPSettingsProps) {
  const [servers, setServers] = useState<MCPServerStatus[]>([])
  const [editing, setEditing] = useState<DraftServer | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [tools, setTools] = useState<MCPToolWithServer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.kora.mcp.list()
      setServers(list)
    } catch (err: any) {
      setError(err?.message ?? 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  const toolsRequestSeq = useRef(0)

  useEffect(() => {
    refresh()
    const off = window.kora.mcp.onChanged(() => refresh())
    return () => {
      off()
    }
  }, [refresh])

  const loadTools = useCallback(async (serverId: string) => {
    toolsRequestSeq.current += 1
    const seq = toolsRequestSeq.current
    setTools([])
    try {
      const r = await window.kora.mcp.listTools(serverId)
      // Stale guard: user may have switched to another server while we waited
      if (seq === toolsRequestSeq.current) setTools(r.tools)
    } catch (err: any) {
      if (seq === toolsRequestSeq.current) setError(err?.message ?? 'failed to list tools')
    }
  }, [])

  const save = async (draft: DraftServer) => {
    const args = parseArgs(draft.args)
    const env = parseEnv(draft.env)
    const requestTimeoutMs = draft.requestTimeoutMs ? Number(draft.requestTimeoutMs) : undefined
    if (!draft.name.trim() || !draft.command.trim()) {
      setError(t(lang, 'Name and command are required', 'Имя и команда обязательны'))
      return
    }
    const payload: MCPServerConfigInput = {
      id: draft.id || genId(),
      name: draft.name.trim(),
      command: draft.command.trim(),
      args,
      env,
      cwd: draft.cwd.trim() || undefined,
      description: draft.description.trim() || undefined,
      enabled: draft.enabled,
      autoStart: draft.autoStart,
      requestTimeoutMs: Number.isFinite(requestTimeoutMs) ? requestTimeoutMs : undefined,
    }
    setError(null)
    const r = await window.kora.mcp.upsert(payload)
    if (!r.success) setError(r.error ?? 'save failed')
    setEditing(null)
    refresh()
  }

  const start = async (id: string) => {
    setError(null)
    const r = await window.kora.mcp.start(id)
    if (!r.success) setError(r.error ?? 'start failed')
    refresh()
  }
  const stop = async (id: string) => {
    setError(null)
    const r = await window.kora.mcp.stop(id)
    if (!r.success) setError(r.error ?? 'stop failed')
    refresh()
  }
  const restart = async (id: string) => {
    setError(null)
    const r = await window.kora.mcp.restart(id)
    if (!r.success) setError(r.error ?? 'restart failed')
    refresh()
  }
  const remove = async (id: string) => {
    setError(null)
    const r = await window.kora.mcp.remove(id)
    if (!r.success) setError(r.error ?? 'remove failed')
    refresh()
  }
  const toggleEnabled = async (id: string, enabled: boolean) => {
    setError(null)
    const r = await window.kora.mcp.setEnabled(id, enabled)
    if (!r.success) setError(r.error ?? 'toggle failed')
    refresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <label className="block text-sm font-medium text-kora-text mb-1">
            {t(lang, 'MCP Servers', 'MCP-серверы')}
          </label>
          <p className="text-xs text-kora-muted leading-relaxed max-w-[80%]">
            {t(
              lang,
              'Servers expose tools to the agent via stdio (JSON-RPC). Example: npx -y @modelcontextprotocol/server-filesystem <path>',
              'Серверы дают агенту инструменты через stdio (JSON-RPC). Пример: npx -y @modelcontextprotocol/server-filesystem <путь>',
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={refresh}
            disabled={loading}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-medium transition-all border ${
              loading
                ? 'bg-kora-card border-kora-border text-kora-muted opacity-60'
                : 'bg-kora-card border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent'
            }`}
          >
            <IconRefresh className={loading ? 'animate-spin' : ''} />
            {t(lang, 'Refresh', 'Обновить')}
          </button>
          <button
            onClick={() => setEditing(emptyDraft())}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold bg-kora-accent text-white hover:bg-kora-accent-hover shadow-lg shadow-kora-accent/25 transition-all"
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            {t(lang, 'Add', 'Добавить')}
          </button>
        </div>
      </div>

      {error && (
        <div className="px-3.5 py-2.5 rounded-xl text-xs bg-kora-error/10 border border-kora-error/30 text-kora-error">
          {error}
        </div>
      )}

      <div className="space-y-2.5">
        {servers.length === 0 && !loading && (
          <div className="text-xs text-kora-muted italic px-3 py-4 bg-kora-card border border-kora-border rounded-2xl text-center">
            {t(lang, 'No MCP servers configured', 'MCP-серверы не настроены')}
          </div>
        )}

        {servers.map((s) => (
          <div key={s.id} className="bg-kora-card border border-kora-border rounded-2xl overflow-hidden transition-colors hover:border-kora-border/80">
            <div className="flex items-center gap-3 p-3.5">
              <div className="flex flex-col items-center gap-1 shrink-0">
                <span
                  className={`w-3 h-3 rounded-full shadow-lg ${
                    s.running ? 'bg-kora-success shadow-kora-success/40' : s.error ? 'bg-kora-error shadow-kora-error/40' : 'bg-kora-muted/50'
                  }`}
                />
                <span className={`text-[9px] font-semibold uppercase tracking-wider ${
                  s.running ? 'text-kora-success' : s.error ? 'text-kora-error' : 'text-kora-muted'
                }`}>
                  {s.running ? t(lang, 'ON', 'ВКЛ') : s.error ? t(lang, 'ERR', 'ОШ') : t(lang, 'OFF', 'ВЫКЛ')}
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="text-sm font-semibold text-kora-text truncate">{s.name}</div>
                  {s.serverInfo && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-kora-bg border border-kora-border text-kora-muted shrink-0 font-mono">
                      v{s.serverInfo.version}
                    </span>
                  )}
                </div>
                <div className="text-xs text-kora-muted truncate mt-0.5">
                  {s.running
                    ? `${s.toolCount} ${t(lang, 'tools', 'тулов')}`
                    : s.error || t(lang, 'Stopped', 'Остановлен')}
                </div>
              </div>

              <button
                onClick={() => toggleEnabled(s.id, !s.enabled)}
                title={t(lang, 'Enabled', 'Включён')}
                className={`w-10 h-5 rounded-full relative transition-colors shrink-0 ${
                  s.enabled ? 'bg-kora-accent' : 'bg-kora-border'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    s.enabled ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>

              <div className="flex items-center gap-1.5 shrink-0">
                {s.running ? (
                  <>
                    <IconButton title={t(lang, 'Stop', 'Стоп')} onClick={() => stop(s.id)} className="text-kora-error hover:bg-kora-error/10 hover:text-kora-error">
                      <IconStop />
                    </IconButton>
                    <IconButton title={t(lang, 'Restart', 'Рестарт')} onClick={() => restart(s.id)}>
                      <IconRestart />
                    </IconButton>
                  </>
                ) : (
                  <IconButton
                    title={t(lang, 'Start', 'Старт')}
                    onClick={() => start(s.id)}
                    className="bg-kora-accent text-white border-kora-accent hover:bg-kora-accent-hover shadow-lg shadow-kora-accent/30"
                  >
                    <IconPlay />
                  </IconButton>
                )}
                <IconButton
                  title={t(lang, 'Edit', 'Редактировать')}
                  onClick={async () => {
                    const cfg = await window.kora.mcp.getConfig(s.id)
                    if (cfg) {
                      setEditing(toDraft(cfg))
                    } else {
                      setEditing(
                        toDraft({
                          id: s.id,
                          name: s.name,
                          command: '',
                          args: undefined,
                          env: undefined,
                          cwd: undefined,
                          enabled: s.enabled,
                          autoStart: true,
                        }),
                      )
                    }
                    setExpanded(null)
                  }}
                >
                  <IconEdit />
                </IconButton>
                <IconButton
                  title={t(lang, 'Remove', 'Удалить')}
                  onClick={() => {
                    if (confirm(t(lang, `Remove "${s.name}"?`, `Удалить "${s.name}"?`))) remove(s.id)
                  }}
                  className="text-kora-error/70 hover:bg-kora-error/10 hover:text-kora-error"
                >
                  <IconTrash />
                </IconButton>
              </div>
            </div>
            {s.running && (
              <div className="px-4 pb-3">
                <button
                  onClick={() => {
                    if (expanded === s.id) {
                      setExpanded(null)
                      setTools([])
                    } else {
                      setExpanded(s.id)
                      loadTools(s.id)
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-full border transition-all ${
                    expanded === s.id
                      ? 'bg-kora-accent/10 border-kora-accent text-kora-accent'
                      : 'bg-kora-bg border-kora-border text-kora-muted hover:text-kora-text'
                  }`}
                >
                  <svg
                    width="9"
                    height="9"
                    viewBox="0 0 12 12"
                    fill="none"
                    className={`transition-transform ${expanded === s.id ? 'rotate-180' : ''}`}
                  >
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {expanded === s.id
                    ? t(lang, 'Hide tools', 'Скрыть тулы')
                    : t(lang, 'Show tools', 'Показать тулы')}
                </button>
                {expanded === s.id && (
                  <div className="mt-2.5 max-h-40 overflow-y-auto space-y-1">
                    {tools.length === 0 && (
                      <div className="text-xs text-kora-muted italic">—</div>
                    )}
                    {tools.map((tool) => (
                      <div key={tool.fullName} className="text-xs bg-kora-bg/50 rounded-xl p-2">
                        <div className="font-mono text-kora-text break-all">{tool.fullName}</div>
                        {tool.description && <div className="text-kora-muted mt-0.5">{tool.description}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div
            className="w-full max-w-md bg-kora-surface border border-kora-border rounded-3xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-kora-border">
              <h3 className="text-sm font-semibold text-kora-text">
                {editing.id
                  ? t(lang, 'Edit MCP server', 'Редактировать MCP-сервер')
                  : t(lang, 'Add MCP server', 'Добавить MCP-сервер')}
              </h3>
              <button
                onClick={() => setEditing(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted transition-colors"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-3 max-h-[60vh] overflow-y-auto">
              <Field
                label={t(lang, 'Display name', 'Отображаемое имя')}
                value={editing.name}
                onChange={(v) => setEditing({ ...editing, name: v })}
                placeholder="filesystem"
              />
              <Field
                label={t(lang, 'Command', 'Команда')}
                value={editing.command}
                onChange={(v) => setEditing({ ...editing, command: v })}
                placeholder="npx"
              />
              <Field
                label={t(lang, 'Args (space-separated, quote if needed)', 'Аргументы (через пробел, в кавычках если надо)')}
                value={editing.args}
                onChange={(v) => setEditing({ ...editing, args: v })}
                placeholder="-y @modelcontextprotocol/server-filesystem C:\\path"
              />
              <Field
                label={t(lang, 'Working dir (optional)', 'Рабочая папка (опц.)')}
                value={editing.cwd}
                onChange={(v) => setEditing({ ...editing, cwd: v })}
              />
              <div>
                <label className="block text-xs font-medium text-kora-text mb-1">
                  {t(lang, 'Environment (KEY=value, one per line)', 'Переменные среды (KEY=значение, по одной)')}
                </label>
                <textarea
                  value={editing.env}
                  onChange={(e) => setEditing({ ...editing, env: e.target.value })}
                  rows={3}
                  className="w-full bg-kora-card border border-kora-border rounded-xl px-3 py-2 text-xs text-kora-text font-mono focus:outline-none focus:border-kora-accent"
                  placeholder="API_KEY=sk-..."
                />
              </div>
              <Field
                label={t(lang, 'Description (optional)', 'Описание (опц.)')}
                value={editing.description}
                onChange={(v) => setEditing({ ...editing, description: v })}
              />
              <Field
                label={t(lang, 'Request timeout, ms (optional)', 'Таймаут запроса, мс (опц.)')}
                value={editing.requestTimeoutMs}
                onChange={(v) => setEditing({ ...editing, requestTimeoutMs: v })}
                placeholder="30000"
              />
              <div className="flex items-center gap-4 text-xs text-kora-text">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
                    className="accent-kora-accent"
                  />
                  {t(lang, 'Enabled', 'Включён')}
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editing.autoStart}
                    onChange={(e) => setEditing({ ...editing, autoStart: e.target.checked })}
                    className="accent-kora-accent"
                  />
                  {t(lang, 'Auto-start on app launch', 'Авто-старт при запуске')}
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 p-4 border-t border-kora-border">
              <button
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-full text-xs text-kora-muted hover:text-kora-text hover:bg-kora-card transition-colors"
              >
                {t(lang, 'Cancel', 'Отмена')}
              </button>
              <button
                onClick={() => save(editing)}
                className="px-4 py-2 rounded-full text-xs bg-kora-accent text-white font-medium hover:opacity-90 transition-opacity"
              >
                {t(lang, 'Save', 'Сохранить')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-kora-text mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-kora-card border border-kora-border rounded-xl px-3 py-2 text-xs text-kora-text font-mono focus:outline-none focus:border-kora-accent"
      />
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children,
  className = '',
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-full bg-kora-bg border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent transition-all active:scale-90 ${className}`}
    >
      {children}
    </button>
  )
}

function IconPlay() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
      <path d="M3 1.5l7 4.5-7 4.5v-9z" fill="currentColor" />
    </svg>
  )
}

function IconStop() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  )
}

function IconRestart() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M9.5 4.5A4.5 4.5 0 1 0 10 7" />
      <path d="M9.5 1.5v3h-3" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 3h9M4 3V1.5h4V3M2.5 3l.8 7.5h5.4L9.5 3" />
    </svg>
  )
}

function IconRefresh({ className = '' }: { className?: string }) {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className={className}>
      <path d="M9.5 4.5A4.5 4.5 0 1 0 10 7" />
      <path d="M9.5 1.5v3h-3" />
    </svg>
  )
}
