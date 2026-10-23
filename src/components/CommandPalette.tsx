import { useEffect, useMemo, useRef, useState } from 'react'
import type { Locale } from '../i18n'
import { useI18n } from '../hooks/useI18n'

export type PaletteGroup = 'actions' | 'chats' | 'prompts'

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  /** Secondary line: the chat's first message, the prompt text, a shortcut... */
  hint?: string
  /** Extra words that should match a search without being shown. */
  keywords?: string
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  lang: Locale
  items: PaletteItem[]
  onClose: () => void
}

const GROUP_ORDER: PaletteGroup[] = ['actions', 'chats', 'prompts']

/**
 * A single keyboard-first entry point for everything the app can do.
 *
 * The palette deliberately has no modes or nested pages: it filters one flat item list,
 * grouped only for scanning. That keeps the implementation small and makes every action
 * reachable with the same three keys (Ctrl/Cmd+K → type → Enter).
 */
export function CommandPalette({ open, lang, items, onClose }: CommandPaletteProps) {
  const t = useI18n(lang)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? items.filter((item) =>
          `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`
            .toLowerCase()
            .includes(needle)
        )
      : items
    return GROUP_ORDER.flatMap((group) => filtered.filter((item) => item.group === group))
  }, [items, query])

  // Reset on each open, and focus the field after the dialog has mounted.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  // Keep the highlighted row visible when arrowing through a long list.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  if (!open) return null

  const runItem = (item: PaletteItem | undefined) => {
    if (!item) return
    onClose()
    // Let the dialog unmount before the action opens another layer (settings, a chat),
    // otherwise two overlays fight over focus on the same frame.
    setTimeout(() => item.run(), 0)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => (visible.length ? (index + 1) % visible.length : 0))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => (visible.length ? (index - 1 + visible.length) % visible.length : 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      runItem(visible[activeIndex])
    }
  }

  const groupLabel: Record<PaletteGroup, string> = {
    actions: t.palette.actions,
    chats: t.palette.chats,
    prompts: t.palette.prompts,
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex justify-center bg-black/45 backdrop-blur-[2px] p-4 pt-[10vh] animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.palette.title}
        className="w-full max-w-[620px] max-h-[70vh] flex flex-col self-start rounded-panel border border-kora-border bg-kora-surface shadow-panel overflow-hidden"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 px-4 h-13 py-3 border-b border-kora-border">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-kora-muted shrink-0" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.8 10.8L14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.palette.placeholder}
            aria-label={t.palette.placeholder}
            aria-controls="kora-palette-list"
            aria-activedescendant={visible[activeIndex] ? `palette-${visible[activeIndex].id}` : undefined}
            className="flex-1 bg-transparent text-sm text-kora-text placeholder-kora-muted focus:outline-none"
          />
          <kbd className="shrink-0 px-1.5 py-0.5 rounded-md border border-kora-border bg-kora-card text-[10px] text-kora-muted">
            Esc
          </kbd>
        </div>

        <div ref={listRef} id="kora-palette-list" role="listbox" className="overflow-y-auto p-2">
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-kora-muted">{t.palette.empty}</p>
          ) : (
            visible.map((item, index) => {
              const firstOfGroup = index === 0 || visible[index - 1].group !== item.group
              return (
                <div key={`${item.group}-${item.id}`}>
                  {firstOfGroup && (
                    <p className="px-2 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-kora-muted">
                      {groupLabel[item.group]}
                    </p>
                  )}
                  <button
                    data-index={index}
                    id={`palette-${item.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => runItem(item)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-field text-left transition-colors duration-100 ${
                      index === activeIndex ? 'bg-kora-card text-kora-text' : 'text-kora-muted'
                    }`}
                  >
                    <span className={`shrink-0 ${index === activeIndex ? 'text-kora-accent' : 'text-kora-muted'}`}>
                      <GroupIcon group={item.group} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-kora-text truncate">{item.label}</span>
                      {item.hint && (
                        <span className="block text-[11px] text-kora-muted truncate">{item.hint}</span>
                      )}
                    </span>
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-3 px-4 py-2 border-t border-kora-border text-[10px] text-kora-muted">
          <span>↑↓</span>
          <span className="tabular-nums">{t.palette.title}</span>
          <span className="ml-auto">Ctrl+K</span>
        </div>
      </div>
    </div>
  )
}

function GroupIcon({ group }: { group: PaletteGroup }) {
  if (group === 'chats') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 1.5C4.2 1.5 2 3.4 2 5.8c0 1.2.6 2.3 1.6 3v2.2l2.1-1.2c.4.1.9.1 1.3.1 2.8 0 5-1.9 5-4.1S9.8 1.5 7 1.5z" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    )
  }
  if (group === 'prompts') {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M7 1.5l1.4 3.6L12 6.5 8.4 7.9 7 11.5 5.6 7.9 2 6.5l3.6-1.4L7 1.5z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 7h6M8 3.5L11.5 7 8 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
