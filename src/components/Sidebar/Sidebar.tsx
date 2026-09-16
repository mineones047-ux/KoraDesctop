import { useState, useMemo } from 'react'
import type { Chat } from '../../types'
import { useI18n } from '../../hooks/useI18n'
import type { Locale } from '../../i18n'

interface SidebarProps {
  lang: Locale
  chats: Chat[]
  activeChatId: string | null
  view: 'chat' | 'graph'
  onSelectChat: (id: string) => void
  onCreateChat: () => void
  onDeleteChat: (id: string) => void
  onRenameChat: (id: string, title: string) => void
  onOpenSettings: () => void
  onOpenSystem: () => void
  onOpenAgent: () => void
  onOpenGraph: () => void
  onOpenChat: () => void
}

export function Sidebar({
  lang, chats, activeChatId, view, onSelectChat, onCreateChat, onDeleteChat, onRenameChat, onOpenSettings, onOpenSystem, onOpenAgent, onOpenGraph, onOpenChat,
}: SidebarProps) {
  const t = useI18n(lang)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState('')

  const filteredChats = useMemo(() => {
    if (!searchQuery.trim()) return chats
    const query = searchQuery.toLowerCase()
    return chats.filter((chat) => {
      // Search by title
      if (chat.title.toLowerCase().includes(query)) return true
      // Search by message content
      return chat.messages.some((m) =>
        m.content.toLowerCase().includes(query)
      )
    })
  }, [chats, searchQuery])

  const startRename = (id: string, title: string) => {
    setEditingId(id)
    setDraftTitle(title)
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
    <div className="w-64 bg-kora-surface border-r border-kora-border flex flex-col h-full">
      <div className="p-3 border-b border-kora-border space-y-2">
        <button
          onClick={onCreateChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-kora-card hover:bg-kora-accent/10 border border-kora-border hover:border-kora-accent rounded-xl text-sm font-medium text-kora-text transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          {t.sidebar.newChat}
        </button>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-kora-muted"
            width="14" height="14" viewBox="0 0 14 14" fill="none"
          >
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M9.5 9.5l3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.sidebar.search}
            className="w-full bg-kora-card border border-kora-border rounded-xl pl-8 pr-3 py-2 text-xs text-kora-text placeholder-kora-muted focus:outline-none focus:border-kora-accent transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-kora-muted hover:text-kora-text transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredChats.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-kora-muted">
              {searchQuery ? t.sidebar.noResults : t.sidebar.noChats}
            </p>
          </div>
        ) : (
          <>
            {searchQuery && (
              <p className="px-3 pb-1 text-[10px] text-kora-muted font-medium">
                {filteredChats.length} {filteredChats.length === 1 ? t.sidebar.result : t.sidebar.results}
              </p>
            )}
            {filteredChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => onSelectChat(chat.id)}
                onMouseEnter={() => setHoveredId(chat.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all ${
                  chat.id === activeChatId
                    ? 'bg-kora-accent/10 border border-kora-accent/30'
                    : 'hover:bg-kora-card border border-transparent'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="text-kora-muted shrink-0">
                  <path
                    d="M7 1C4 1 1 3.5 1 6.5c0 1.5.8 2.8 2 3.5v2.5l2.5-1.5c.5.1 1 .2 1.5.2 3 0 6-2.5 6-5.5S10 1 7 1z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
                {editingId === chat.id ? (
                  <input
                    autoFocus
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') cancelRename()
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-kora-card border border-kora-accent rounded-lg px-2 py-1 text-sm text-kora-text focus:outline-none"
                  />
                ) : (
                  <span className="text-sm text-kora-text truncate flex-1">{chat.title}</span>
                )}
                {hoveredId === chat.id && editingId !== chat.id && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectChat(chat.id)
                        startRename(chat.id, chat.title)
                      }}
                      title={t.sidebar.renameChat}
                      className="p-1 rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-accent transition-colors"
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteChat(chat.id)
                      }}
                      title={t.sidebar.deleteChat}
                      className="p-1 rounded-full hover:bg-kora-error/20 text-kora-muted hover:text-kora-error transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path d="M2 3h8M4 3V2h4v1M3 3v7h6V3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
                      </svg>
                    </button>
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <div className="p-3 border-t border-kora-border space-y-1">
        <button
          onClick={onOpenAgent}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-kora-muted hover:text-kora-text hover:bg-kora-card transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="5" width="10" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 5V3a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="5.5" cy="8.5" r="0.5" fill="currentColor" />
            <circle cx="8.5" cy="8.5" r="0.5" fill="currentColor" />
          </svg>
          {t.sidebar.agent}
        </button>
        <button
          onClick={() => (view === 'graph' ? onOpenChat() : onOpenGraph())}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all ${
            view === 'graph'
              ? 'text-kora-text bg-kora-accent/10 border border-kora-accent/30'
              : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
          }`}
        >
          {view === 'graph' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="4" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="12" cy="3.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="8" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.2" />
              <circle cx="3.5" cy="12.5" r="1.6" stroke="currentColor" strokeWidth="1.2" />
              <path d="M5 5l2.5 3.5M12 5l-2.5 3.5M8 8l-3 3M8 8l3.5 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            </svg>
          )}
          {view === 'graph' ? t.sidebar.chatView : t.sidebar.graph}
        </button>
        <button
          onClick={onOpenSystem}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-kora-muted hover:text-kora-text hover:bg-kora-card transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 8h6M8 5v6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {t.sidebar.systemMonitor}
        </button>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-kora-muted hover:text-kora-text hover:bg-kora-card transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
            <path
              d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          {t.sidebar.settings}
        </button>
      </div>
    </div>
  )
}