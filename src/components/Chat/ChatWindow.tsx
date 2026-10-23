import { useEffect, useMemo, useRef } from 'react'
import type { Message } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { MessageBubble } from './MessageBubble'
import { ChatHeader } from './ChatHeader'
import { estimateMessagesTokens } from '../../lib/tokens'
import { InputBar, type PromptSuggestion } from './InputBar'

/** The transcript plus the composer; the panel the rest of the app is arranged around. */
interface ChatWindowProps {
  lang: Locale
  messages: Message[]
  onSend: (message: string) => void
  isLoading: boolean
  onSpeak?: (text: string, messageId: string) => void
  onStop?: () => void
  ttsPlayingId?: string | null
  onToggleTTS?: () => void
  isSpeaking?: boolean
  volume?: number
  isMuted?: boolean
  onToggleMute?: () => void
  onVolumeChange?: (volume: number) => void
  isListening?: boolean
  isSpeechSupported?: boolean
  onStartListening?: () => void
  onStopListening?: () => void
  speechInterim?: string
  onStopGenerate?: () => void
  /** Header state. */
  title?: string
  modelLabel?: string
  pinned?: boolean
  isPrivate?: boolean
  onTogglePin?: () => void
  onCreatePrivate?: () => void
  onExport?: () => void
  /** Empty-state suggestions (saved prompts or localized defaults). */
  suggestions?: PromptSuggestion[]
  onPickPrompt?: (text: string) => void
  /** Text pushed into the composer from the palette. */
  insertRequest?: { id: number; text: string } | null
  onEditMessage?: (messageId: string, content: string) => void
  onRegenerate?: () => void
}

/**
 * Scrolling message list with auto-scroll, wrapping the input bar.
 *
 * The auto-scroll is conditional, and that is the interesting part: the view follows the
 * newest message only while the user is already at the bottom. Scrolling unconditionally
 * would yank the view away from someone reading back through a long answer — and during
 * streaming that would happen on every token.
 */
export function ChatWindow({
  lang, messages, onSend, isLoading, onSpeak, onStop, ttsPlayingId,
  onToggleTTS, isSpeaking, volume, isMuted, onToggleMute, onVolumeChange,
  isListening, isSpeechSupported, onStartListening, onStopListening, speechInterim,
  onStopGenerate, title, modelLabel, pinned, isPrivate, onTogglePin, onCreatePrivate, onExport,
  suggestions = [], onPickPrompt, insertRequest, onEditMessage, onRegenerate,
}: ChatWindowProps) {
  const t = useI18n(lang)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100
  }

  useEffect(() => {
    if (stickToBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' })
    }
  }, [messages])

  // The transcript grows while streaming; a new message should also pull the view down
  // when the user has not scrolled away.
  const lastUserMessageId = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user')?.id,
    [messages],
  )
  const lastMessage = messages[messages.length - 1]
  const contextTokens = useMemo(
    () => estimateMessagesTokens(messages.map((message) => message.content)),
    [messages],
  )

  return (
    <div className="flex-1 flex flex-col h-full min-w-0 bg-kora-bg">
      <ChatHeader
        lang={lang}
        title={title || t.chat.untitled}
        modelLabel={modelLabel}
        pinned={pinned}
        isPrivate={isPrivate}
        hasMessages={messages.length > 0}
        onTogglePin={() => onTogglePin?.()}
        onCreatePrivate={() => onCreatePrivate?.()}
        onExport={() => onExport?.()}
      />

      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <div className="h-full min-h-[360px] flex flex-col items-center justify-center px-6 py-10 text-center animate-fade-in">
            <div className="w-14 h-14 mb-5 rounded-panel bg-kora-surface border border-kora-border flex items-center justify-center shadow-panel">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3l8 9-8 9-8-9 8-9z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" className="text-kora-accent" />
                <path d="M12 8v8M8.5 12h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="text-kora-accent/80" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-kora-text">{t.emptyChat.title}</h2>
            <p className="mt-1.5 text-sm text-kora-muted max-w-sm leading-relaxed">{t.emptyChat.subtitle}</p>

            {suggestions.length > 0 && (
              <div className="mt-7 w-full max-w-xl">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-kora-muted">
                  {t.promptLib.suggestTitle}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {suggestions.slice(0, 4).map((suggestion) => (
                    <button
                      key={suggestion.id}
                      onClick={() => onPickPrompt?.(suggestion.prompt)}
                      title={suggestion.prompt}
                      className="rounded-card border border-kora-border bg-kora-surface px-3.5 py-3 text-left hover:border-kora-accent/50 hover:bg-kora-card transition-colors duration-150"
                    >
                      <span className="block text-xs font-medium text-kora-text truncate">{suggestion.title}</span>
                      <span className="mt-0.5 block text-[11px] text-kora-muted truncate">{suggestion.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <p className="mt-5 text-[11px] text-kora-muted">{t.emptyChat.commandHint}</p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-5 space-y-5">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                lang={lang}
                onSpeak={onSpeak}
                onStop={onStop}
                isPlaying={ttsPlayingId === message.id}
                canEdit={!isLoading && message.id === lastUserMessageId}
                canRegenerate={!isLoading && message.id === lastMessage?.id && message.role === 'assistant'}
                onEdit={onEditMessage}
                onRegenerate={onRegenerate}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      <InputBar
        lang={lang}
        onSend={onSend}
        isLoading={isLoading}
        onToggleTTS={onToggleTTS}
        isSpeaking={isSpeaking}
        hasMessages={messages.length > 0}
        volume={volume}
        isMuted={isMuted}
        onToggleMute={onToggleMute}
        onVolumeChange={onVolumeChange}
        isListening={isListening}
        isSpeechSupported={isSpeechSupported}
        onStartListening={onStartListening}
        onStopListening={onStopListening}
        speechInterim={speechInterim}
        onStopGenerate={onStopGenerate}
        modelLabel={modelLabel}
        contextTokens={contextTokens}
        insertRequest={insertRequest}
      />
    </div>
  )
}
