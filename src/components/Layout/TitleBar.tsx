import { useEffect, useState } from 'react'

export function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(window.kora.window.isMaximized())

  useEffect(() => {
    const unsubscribe = window.kora.window.onMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  return (
    <div className="h-10 bg-kora-surface border-b border-kora-border flex items-center justify-between px-3 select-none drag">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-kora-accent" />
        <span className="text-sm font-medium text-kora-text font-pixel">Kora</span>
      </div>

      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={() => window.kora.window.minimize()}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={() => {
            window.kora.window.maximize()
            setIsMaximized(!isMaximized)
          }}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            {isMaximized ? (
              <path
                d="M3 2.5h5.5V8H8.5V3.5H3V2.5zM2 4.5V9.5H7.5V8.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <rect
                x="2"
                y="2"
                width="8"
                height="8"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            )}
          </svg>
        </button>
        <button
          onClick={() => window.kora.window.close()}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-kora-error/20 text-kora-muted hover:text-kora-error transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}