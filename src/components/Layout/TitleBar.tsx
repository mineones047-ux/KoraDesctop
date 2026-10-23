import { useEffect, useState } from 'react'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

/**
 * Custom window chrome: app identity on the left, minimise/maximise/close on the right.
 *
 * The `drag` / `no-drag` class pair is what makes this work in a frameless window — the
 * bar is draggable, the buttons opt out. Maximised state comes from the shell and is
 * tracked via a subscription, because double-clicking the bar or dragging to an edge can
 * maximise the window without this component's click handler running.
 */
export function TitleBar({ lang }: { lang: Locale }) {
  const t = useI18n(lang)
  const [isMaximized, setIsMaximized] = useState(window.kora.window.isMaximized())

  useEffect(() => {
    const unsubscribe = window.kora.window.onMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  return (
    <div className="h-10 bg-kora-surface border-b border-kora-border flex items-center justify-between px-3 select-none drag">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full bg-kora-accent" aria-hidden="true" />
        <span className="text-sm font-medium text-kora-text font-pixel">Kora</span>
      </div>

      <div className="flex items-center gap-1 no-drag">
        <WindowButton onClick={() => window.kora.window.minimize()} label={t.titleBar.minimize}>
          <path d="M3 6h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </WindowButton>

        <WindowButton
          onClick={() => {
            window.kora.window.maximize()
            setIsMaximized(!isMaximized)
          }}
          label={isMaximized ? t.titleBar.minimize : t.titleBar.maximize}
        >
          {isMaximized ? (
            <path d="M3 2.5h5.5V8H8.5V3.5H3V2.5zM2 4.5V9.5H7.5V8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <rect x="2.5" y="2.5" width="7" height="7" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
          )}
        </WindowButton>

        <WindowButton onClick={() => window.kora.window.close()} label={t.titleBar.close} danger>
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </WindowButton>
      </div>
    </div>
  )
}

function WindowButton({
  onClick, label, danger, children,
}: {
  onClick: () => void
  label: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors duration-150 ${
        danger
          ? 'text-kora-muted hover:bg-kora-error/20 hover:text-kora-error'
          : 'text-kora-muted hover:bg-kora-card hover:text-kora-text'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        {children}
      </svg>
    </button>
  )
}
