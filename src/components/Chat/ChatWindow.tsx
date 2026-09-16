import { useEffect, useRef } from 'react'
import type { Message } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { MessageBubble } from './MessageBubble'
import { InputBar } from './InputBar'

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
}

export function ChatWindow({
  lang, messages, onSend, isLoading, onSpeak, onStop, ttsPlayingId,
  onToggleTTS, isSpeaking, volume, isMuted, onToggleMute, onVolumeChange,
  isListening, isSpeechSupported, onStartListening, onStopListening, speechInterim,
  onStopGenerate,
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

  return (
    <div className="flex-1 flex flex-col h-full bg-kora-bg">
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center animate-fade-in">
            <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-kora-surface border border-kora-border flex items-center justify-center">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
                <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1.5" className="text-kora-accent" />
                <path d="M14 20l4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-kora-accent" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-kora-text mb-2">{t.emptyChat.title}</h2>
            <p className="text-sm text-kora-muted">{t.emptyChat.subtitle}</p>
            <p className="text-xs text-kora-muted mt-2">{t.emptyChat.commandHint}</p>
          </div>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              lang={lang}
              onSpeak={onSpeak}
              onStop={onStop}
              isPlaying={ttsPlayingId === message.id}
            />
          ))}
          <div ref={messagesEndRef} />
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
      />
    </div>
  )
}