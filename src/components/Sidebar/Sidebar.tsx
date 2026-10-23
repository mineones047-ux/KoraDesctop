import { useMemo, useState, type RefObject } from 'react'
import type { Chat } from '../../types'
import { useI18n } from '../../hooks/useI18n'
import { plural } from '../../i18n'
import type { Locale } from '../../i18n'
import { groupChats, type ChatGroupId } from '../../lib/chat-groups'

/** Everything the sidebar renders is a prop — it holds no state beyond its own UI concerns. */
interface SidebarProps {
  lang: Locale
  chats: Chat[]
  activeChatId: string | null
  view: 'chat' | 'graph'
  onSelectChat: (id: string) => void
  onCreateChat: () => void
  onDeleteChat: (id: string) => void
  onRenameChat: (id: string, title: string) => void
  onTogglePin: (id: string) => void
  onOpenSettings: () => void
  onOpenSystem: () => void
  onOpenAgent: () => void
  onOpenGraph: () => void
  onOpenChat: () => void
  /** Attached to the search field so the shortcut can focus it from the window listener. */
  searchInputRef?: RefObject<HTMLInputElement>
}

const GROUP_LABEL: Record<ChatGroupId, (t: ReturnType<typeof useI18n>) => string> = {
  pinned: (t) => t.sidebar.pinned,
  today: (t) => t.sidebar.today,
  yesterday: (t) => t.sidebar.yesterday,
  week: (t) => t.sidebar.week,
  older: (t) => t.sidebar.older,
}

/**
 * The chat list: history search, pinning, rename-in-place, delete, and panel switchers.
 *
 * History is grouped by day instead of shown as one long column, because the only thing
 * a person remembers about an old chat is roughly *when* it happened. Pinned chats are
 * lifted out of the chronology so the handful that matter stay in reach.
 */
export function Sidebar({
  lang, chats, activeChatId, view, onSelectChat, onCreateChat, onDeleteChat, onRenameChat,
  onTogglePin, onOpenSettings, onOpenSystem, onOpenAgent, onOpenGraph, onOpenChat, searchInputRef,
}: SidebarProps) {
  const t = useI18n(lang)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const filteredChats = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return chats
    return chats.filter((chat) =>
      chat.title.toLowerCase().includes(query) ||
      chat.messages.some((m) => m.content.toLowerCase().includes(query))
    )
  }, [chats, searchQuery])

  // While searching, chronology is noise: one flat, relevance-preserving list is clearer.
  const groups = useMemo(() => {
    if (searchQuery.trim()) return [{ id: 'today' as ChatGroupId, chats: filteredChats }]
    return groupChats(filteredChats)
  }, [filteredChats, searchQuery])

  const startRename = (chat: Chat) => {
    setEditingId(chat.id)
    setDraftTitle(chat.title)
  }

  const commitRename = () => {
    if (editingId) onRenameChat(editingId, draftTitle)
    setEditingId(null)
    setDraftTitle('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setDraftTitle('')
  }

  return (
    <aside className="w-[268px] shrink-0 bg-kora-surface border-r border-kora-border flex flex-col h-full">
      <div className="p-3 space-y-2">
        <button
          onClick={onCreateChat}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-field bg-kora-accent text-white text-sm font-semibold hover:bg-kora-accent-hover transition-colors duration-150"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {t.sidebar.newChat}
        </button>

        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-kora-muted"
            width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"
          >
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && searchQuery) {
                e.stopPropagation()
                setSearchQuery('')
              }
            }}
            placeholder={t.sidebar.search}
            aria-label={t.sidebar.search}
            className="w-full h-9 bg-kora-card border border-kora-border rounded-field pl-9 pr-8 text-xs text-kora-text placeholder-kora-muted focus:border-kora-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              title={t.palette.close}
              aria-label={t.palette.close}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-kora-muted hover:text-kora-text transition-colors"
            >
              <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label={t.sidebar.search}>
        {filteredChats.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <div className="mx-auto mb-3 w-9 h-9 rounded-full border border-kora-border flex items-center justify-center text-kora-muted">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 1.5C4.7 1.5 2 3.8 2 6.6c0 1.3.7 2.5 1.8 3.3v2.6l2.4-1.4c.6.1 1.2.2 1.8.2 3.3 0 6-2.3 6-5.1S11.3 1.5 8 1.5z" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            </div>
            <p className="text-xs text-kora-muted">
              {searchQuery ? t.sidebar.noResults : t.sidebar.noChats}
            </p>
          </div>
        ) : (
          <>
            {searchQuery ? (
              <p className="px-2 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-kora-muted">
                {filteredChats.length}{' '}
                {plural(lang, filteredChats.length, {
                  one: t.sidebar.result,
                  few: t.sidebar.resultFew,
                  many: t.sidebar.results,
                })}
              </p>
            ) : null}

            {groups.map((group) => (
              <section key={group.id} className="mt-1">
                <h3 className="px-2 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-kora-muted">
                  {GROUP_LABEL[group.id](t)}
                </h3>
                <div className="space-y-0.5">
                  {group.chats.map((chat) => {
                    const isActive = chat.id === activeChatId
                    return (
                      <div key={chat.id} className="group relative">
                        <button
                          onClick={() => onSelectChat(chat.id)}
                          onDoubleClick={() => startRename(chat)}
                          aria-current={isActive ? 'page' : undefined}
                          className={`w-full flex items-center gap-2 h-9 pl-2.5 pr-14 rounded-field text-left transition-colors duration-150 ${
                            isActive
                              ? 'bg-kora-accent-soft/70 text-kora-text'
                              : 'text-kora-muted hover:text-kora-text hover:bg-kora-card/70'
                          }`}
                        >
                          {chat.pinned ? (
                            <PinIcon filled />
                          ) : chat.ephemeral ? (
                            <LockIcon />
                          ) : (
                            <ChatIcon />
                          )}
                          {editingId === chat.id ? (
                            <input
                              autoFocus
                              value={draftTitle}
                              onChange={(e) => setDraftTitle(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') {
                                  e.stopPropagation()
                                  cancelRename()
                                }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="flex-1 min-w-0 h-7 bg-kora-bg border border-kora-accent rounded-md px-2 text-xs text-kora-text"
                            />
                          ) : (
                            <span className="flex-1 min-w-0 truncate text-[13px] leading-5">{chat.title}</span>
                          )}
                        </button>

                        {editingId !== chat.id && (
                          <div className="row-actions absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-lg bg-kora-surface/95 pl-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onTogglePin(chat.id)
                              }}
                              title={chat.pinned ? t.sidebar.unpin : t.sidebar.pin}
                              aria-label={chat.pinned ? t.sidebar.unpin : t.sidebar.pin}
                              className={`p-1.5 rounded-md transition-colors ${
                                chat.pinned ? 'text-kora-accent' : 'text-kora-muted hover:text-kora-text'
                              }`}
                            >
                              <PinIcon filled={Boolean(chat.pinned)} />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onSelectChat(chat.id)
                                startRename(chat)
                              }}
                              title={t.sidebar.renameChat}
                              aria-label={t.sidebar.renameChat}
                              className="p-1.5 rounded-md text-kora-muted hover:text-kora-text transition-colors"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                onDeleteChat(chat.id)
                              }}
                              title={t.sidebar.deleteChat}
                              aria-label={t.sidebar.deleteChat}
                              className="p-1.5 rounded-md text-kora-muted hover:text-kora-error transition-colors"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                <path d="M2 3h8M4 3V2h4v1M3 3v7h6V3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </>
        )}
      </nav>

      <div className="p-2 border-t border-kora-border space-y-0.5">
        <NavButton onClick={onOpenAgent} icon={<AgentIcon />} label={t.sidebar.agent} />
        <NavButton
          onClick={() => (view === 'graph' ? onOpenChat() : onOpenGraph())}
          icon={view === 'graph' ? <BackIcon /> : <GraphIcon />}
          label={view === 'graph' ? t.sidebar.chatView : t.sidebar.graph}
          active={view === 'graph'}
        />
        <NavButton onClick={onOpenSystem} icon={<MonitorIcon />} label={t.sidebar.systemMonitor} />
        <NavButton onClick={onOpenSettings} icon={<GearIcon />} label={t.sidebar.settings} />
      </div>
    </aside>
  )
}

function NavButton({ onClick, icon, label, active }: { onClick: () => void; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 h-9 px-2.5 rounded-field text-[13px] transition-colors duration-150 ${
        active
          ? 'text-kora-text bg-kora-card'
          : 'text-kora-muted hover:text-kora-text hover:bg-kora-card/70'
      }`}
    >
      <span className={active ? 'text-kora-accent' : ''}>{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  )
}

function ChatIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 text-kora-muted" aria-hidden="true">
      <path d="M7 1.5C4.2 1.5 2 3.4 2 5.8c0 1.2.6 2.3 1.6 3v2.2l2.1-1.2c.4.1.9.1 1.3.1 2.8 0 5-1.9 5-4.1S9.8 1.5 7 1.5z" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function PinIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0" aria-hidden="true">
      <path
        d="M8.5 1.5l4 4-1.7.6-2.6 2.6.2 2.3-1.2 1.2-3-3-2.4 2.4-.7-.7 2.4-2.4-3-3L2.7 4.3l2.3.2L7.6 2l.9-.5z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" className="shrink-0 text-kora-muted" aria-hidden="true">
      <rect x="3" y="6" width="8" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 6V4.5a2 2 0 0 1 4 0V6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

function AgentIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="5" width="12" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5V2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="6" cy="9" r="0.7" fill="currentColor" />
      <circle cx="10" cy="9" r="0.7" fill="currentColor" />
    </svg>
  )
}

function GraphIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 5l2.5 3.5M11.5 5L9 8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.8" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 14h5M8 11.5V14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.4v1.8M8 12.8v1.8M1.4 8h1.8M12.8 8h1.8M3.3 3.3l1.3 1.3M11.4 11.4l1.3 1.3M3.3 12.7l1.3-1.3M11.4 4.6l1.3-1.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
