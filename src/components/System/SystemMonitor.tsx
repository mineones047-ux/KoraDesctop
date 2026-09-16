import { useState } from 'react'
import type { SystemInfo, ProcessInfo } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

interface SystemMonitorProps {
  lang: Locale
  info: SystemInfo | null
  processes: ProcessInfo[]
  onClose: () => void
}

export function SystemMonitor({ lang, info, processes, onClose }: SystemMonitorProps) {
  const t = useI18n(lang)
  const [activeTab, setActiveTab] = useState<'overview' | 'processes'>('overview')

  if (!info) return null

  const usedMemory = info.totalMemory - info.freeMemory
  const memoryPercent = Math.round((usedMemory / info.totalMemory) * 100)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-kora-surface border border-kora-border rounded-2xl shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-kora-border">
          <h2 className="text-lg font-semibold text-kora-text">{t.system.title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-kora-border">
          {(['overview', 'processes'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'text-kora-accent border-b-2 border-kora-accent'
                  : 'text-kora-muted hover:text-kora-text'
              }`}
            >
              {tab === 'overview' ? t.system.overview : t.system.processes}
            </button>
          ))}
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                  <p className="text-xs text-kora-muted mb-1">{t.system.hostname}</p>
                  <p className="text-sm font-medium text-kora-text">{info.hostname}</p>
                </div>
                <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                  <p className="text-xs text-kora-muted mb-1">{t.system.platform}</p>
                  <p className="text-sm font-medium text-kora-text">
                    {info.platform} {info.arch}
                  </p>
                </div>
                <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                  <p className="text-xs text-kora-muted mb-1">{t.system.cpu}</p>
                  <p className="text-sm font-medium text-kora-text">{info.cpus[0]?.model || t.system.unknown}</p>
                  <p className="text-xs text-kora-muted mt-1">{info.cpus.length} {t.system.cores} @ {info.cpus[0]?.speed || 0} MHz</p>
                </div>
                <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                  <p className="text-xs text-kora-muted mb-1">{t.system.user}</p>
                  <p className="text-sm font-medium text-kora-text">{info.userInfo.username}</p>
                </div>
              </div>

              <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                <div className="flex justify-between items-center mb-2">
                  <p className="text-xs text-kora-muted">{t.system.memory}</p>
                  <p className="text-xs text-kora-text">{memoryPercent}%</p>
                </div>
                <div className="w-full h-2 bg-kora-bg rounded-full overflow-hidden">
                  <div
                    className="h-full bg-kora-accent rounded-full transition-all"
                    style={{ width: `${memoryPercent}%` }}
                  />
                </div>
                <p className="text-xs text-kora-muted mt-1">
                  {formatBytes(usedMemory)} / {formatBytes(info.totalMemory)}
                </p>
              </div>

              <div className="bg-kora-card border border-kora-border rounded-xl p-4">
                <p className="text-xs text-kora-muted mb-1">{t.system.uptime}</p>
                <p className="text-sm font-medium text-kora-text">{formatUptime(info.uptime)}</p>
              </div>
            </div>
          )}

          {activeTab === 'processes' && (
            <div className="space-y-1">
              <div className="flex items-center gap-3 px-3 py-2 text-xs text-kora-muted border-b border-kora-border">
                <span className="flex-1">{t.system.name}</span>
                <span className="w-20 text-right">{t.system.pid}</span>
                <span className="w-20 text-right">{t.system.mem}</span>
                <span className="w-16 text-right">{t.system.action}</span>
              </div>
              <div className="space-y-0.5">
                {processes.slice(0, 50).map((proc) => (
                  <div
                    key={proc.pid}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-kora-card text-sm transition-colors"
                  >
                    <span className="flex-1 text-kora-text truncate">{proc.name}</span>
                    <span className="w-20 text-right text-kora-muted font-mono text-xs">{proc.pid}</span>
                    <span className="w-20 text-right text-kora-muted text-xs">{proc.memory}</span>
                    <button
                      onClick={async () => {
                        if (confirm(`${t.system.kill} ${proc.name} (PID ${proc.pid})?`)) {
                          await window.kora.system.killProcess(proc.pid)
                        }
                      }}
                      className="w-16 text-right text-xs text-kora-error hover:text-red-400 transition-colors"
                    >
                      {t.system.kill}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
  const secs = Math.max(0, Math.floor(seconds))
  const days = Math.floor(secs / 86400)
  const hours = Math.floor((secs % 86400) / 3600)
  const minutes = Math.floor((secs % 3600) / 60)
  const parts = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (parts.length === 0) parts.push(`${secs}s`)
  return parts.join(' ')
}