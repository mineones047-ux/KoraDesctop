import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

interface MessageBubbleProps {
  message: Message
  lang: Locale
  onSpeak?: (text: string, messageId: string) => void
  onStop?: () => void
  isPlaying?: boolean
}

export const MessageBubble = memo(function MessageBubble({ message, lang, onSpeak, onStop, isPlaying }: MessageBubbleProps) {
  const t = useI18n(lang)
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in group`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-kora-accent text-white'
          : 'bg-kora-card border border-kora-border text-kora-text'
      }`}>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || '')
                  const isInline = !match
                  return isInline ? (
                    <code className="bg-kora-bg/50 px-1.5 py-0.5 rounded text-kora-accent text-xs font-mono" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className={className} {...props}>{children}</code>
                  )
                },
                pre: ({ children }) => (
                  <pre className="bg-kora-bg rounded-xl p-3 overflow-x-auto mb-2 border border-kora-border">
                    {children}
                  </pre>
                ),
                ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                li: ({ children }) => <li className="mb-1">{children}</li>,
                h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-sm font-bold mb-2">{children}</h3>,
                a: ({ href, children }) => (
                  <a href={href} className="text-kora-accent hover:underline" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-kora-accent pl-3 text-kora-muted mb-2">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-2">
                    <table className="w-full text-sm">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-kora-border px-3 py-1 text-left bg-kora-bg">{children}</th>
                ),
                td: ({ children }) => (
                  <td className="border border-kora-border px-3 py-1">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {!isUser && message.content && (
          <div className="mt-2 flex justify-end">
            <button
              onClick={() => isPlaying ? onStop?.() : onSpeak?.(message.content, message.id)}
              className={`p-1.5 rounded-xl transition-all ${
                isPlaying
                  ? 'bg-kora-accent text-white animate-pulse'
                  : 'text-kora-muted hover:text-kora-text hover:bg-kora-bg/50'
              }`}
              title={isPlaying ? t.message.stop : t.message.readAloud}
            >
              {isPlaying ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M2 5.5v3h2.5l3 2.5V3L4.5 5.5H2z" fill="currentColor"/>
                  <path d="M9 5.5c.5.5.5 1.5 0 2M10.5 4c1 1 1 3 0 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})