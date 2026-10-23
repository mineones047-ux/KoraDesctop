import { useEffect, useState } from 'react'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

interface ChatHeaderProps {
  lang: Locale
  title: string
  modelLabel?: string
  pinned?: boolean
  isPrivate?: boolean
  hasMessages: boolean
  onTogglePin: () => void
  onCreatePrivate: () => void
  onExport: () => void
}

/**
 * A slim bar above the transcript.
 *
 * It answers the three questions a chat screen should always answer without opening a
 * menu: which conversation is this, what is answering, and how do I take it with me.
 * Actions are icon buttons with accessible names and titles, not a kebab menu — there are
 * only two, and hiding them would cost more than the two buttons do.
 */
export function ChatHeader({
  lang, title, modelLabel, pinned, isPrivate, hasMessages,
  onTogglePin, onCreatePrivate, onExport,
}: ChatHeaderProps) {
  const t = useI18n(lang)
  const [exported, setExported] = useState(false)

  // Confirmation is local and short-lived; a toast would cover the answer the user is
  // about to leave for their editor.
  useEffect(() => {
    if (!exported) return
    const timer = setTimeout(() => setExported(false), 1600)
    return () => clearTimeout(timer)
  }, [exported])

  return (
    <header className="h-12 shrink-0 flex items-center gap-3 px-4 border-b border-kora-border/70 bg-kora-bg/80">
      <div className="min-w-0 flex items-center gap-2">
        <h2 className="text-[13px] font-medium text-kora-text truncate max-w-[42vw]">{title}</h2>
        {isPrivate && (
          <span
            className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-kora-warning/10 border border-kora-warning/25 text-[10px] font-medium text-kora-warning"
            title={t.chat.privateHint}
          >
            <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="3" y="6" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5 6V4.5a2 2 0 0 1 4 0V6" stroke="currentColor" strokeWidth="1.6" />
            </svg>
            {t.chat.private}
          </span>
        )}
      </div>

      {modelLabel && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-kora-border bg-kora-card/60 text-[10px] text-kora-muted font-mono truncate max-w-[220px]"
          title={modelLabel}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-kora-success" aria-hidden="true" />
          {modelLabel}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        <HeaderButton
          onClick={onTogglePin}
          label={pinned ? t.chat.unpin : t.chat.pin}
          active={pinned}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M8.5 1.5l4 4-1.7.6-2.6 2.6.2 2.3-1.2 1.2-3-3-2.4 2.4-.7-.7 2.4-2.4-3-3L2.7 4.3l2.3.2L7.6 2l.9-.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
              fill={pinned ? 'currentColor' : 'none'}
            />
          </svg>
        </HeaderButton>

        {!isPrivate && (
          <HeaderButton onClick={onCreatePrivate} label={t.chat.private}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <rect x="3" y="6" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 6V4.5a2 2 0 0 1 4 0V6" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </HeaderButton>
        )}

        <HeaderButton
          onClick={() => {
            onExport()
            setExported(true)
          }}
          label={exported ? t.chat.exported : t.chat.export}
          disabled={!hasMessages}
        >
          {exported ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M7 1.5v7M4 6l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 10.5v1A1.5 1.5 0 0 0 3.5 13h7A1.5 1.5 0 0 0 12 11.5v-1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          )}
          {exported && <span className="text-[10px] font-medium">{t.chat.exported}</span>}
        </HeaderButton>
      </div>
    </header>
  )
}

function HeaderButton({
  onClick, label, active, disabled, children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className={`h-8 px-2 inline-flex items-center gap-1.5 rounded-lg text-[11px] transition-colors duration-150 disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? 'text-kora-accent bg-kora-accent-soft/60'
          : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
      }`}
    >
      {children}
    </button>
  )
}
