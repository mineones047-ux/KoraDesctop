import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { copyToClipboard } from '../../lib/clipboard'
import { nodeText } from '../../lib/markdown-text'

/** One message, rendered as markdown, with copy and speak controls. */
interface MessageBubbleProps {
  message: Message
  lang: Locale
  onSpeak?: (text: string, messageId: string) => void
  onStop?: () => void
  isPlaying?: boolean
}

/** How long the "copied" confirmation stays on screen. */
const COPIED_FEEDBACK_MS = 1600

/**
 * One chat bubble.
 *
 * Memoised on purpose: this is the component that would otherwise re-render on every
 * streamed token. It only re-renders when its own `message` object changes, so the
 * streaming message updates and the other hundred bubbles in the list stay put.
 *
 * The two controls are deliberately local state rather than app state: copy feedback
 * belongs to one bubble, and hoisting it would re-render the whole list every time
 * anyone copied anything.
 */
export const MessageBubble = memo(function MessageBubble({ message, lang, onSpeak, onStop, isPlaying }: MessageBubbleProps) {
  const t = useI18n(lang)
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState<'message' | 'code' | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the timer on unmount: a bubble removed mid-feedback would otherwise set state
  // on an unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  /** Show the confirmation, replacing any earlier one. */
  const flash = (what: 'message' | 'code') => {
    setCopied(what)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS)
  }

  const copyMessage = async () => {
    if (await copyToClipboard(message.content)) flash('message')
  }

  /**
   * Copy the code block's source.
   *
   * The rendered DOM is scraped rather than the raw markdown: a fenced block is wrapped
   * in `<pre><code>`, so `nodeText` walks to the source text the user actually sees. The
   * per-block id is derived from the code text, so two identical blocks collide — which is
   * harmless, because copying either one copies the same string.
   */
  const copyCode = (code: string) => async () => {
    if (await copyToClipboard(code)) flash('code')
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in group`}>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 ${
        isUser
          ? 'bg-kora-accent-soft text-kora-text'
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
                pre: ({ children }) => {
                  // The <pre> wrapper owns the copy button; the source text is pulled
                  // back out of its <code> child so what lands on the clipboard is the
                  // code, not the surrounding chrome.
                  const source = nodeText(children)
                  return (
                    <div className="relative group/code mb-2">
                      <pre className="bg-kora-bg rounded-xl p-3 overflow-x-auto border border-kora-border">
                        {children}
                      </pre>
                      <button
                        onClick={copyCode(source)}
                        title={copied === 'code' ? t.message.codeCopied : t.message.copyCode}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-kora-card/80 text-kora-muted opacity-0 group-hover/code:opacity-100 focus:opacity-100 transition-opacity hover:text-kora-text"
                      >
                        {copied === 'code' ? <CheckIcon /> : <ClipboardIcon />}
                      </button>
                    </div>
                  )
                },
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

        {message.content && (
          <div className="mt-2 flex justify-end gap-1">
            <button
              onClick={copyMessage}
              title={copied === 'message' ? t.message.copied : t.message.copy}
              className="p-1.5 rounded-xl text-kora-muted transition-all hover:text-kora-text hover:bg-kora-bg/50"
            >
              {copied === 'message' ? <CheckIcon /> : <ClipboardIcon />}
            </button>
            {!isUser && (
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
            )}
          </div>
        )}
      </div>
    </div>
  )
})

/** The clipboard glyph, shown on both copy buttons. */
function ClipboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <rect x="4" y="4.5" width="7.5" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M5.5 4.5V3.5A1 1 0 0 1 6.5 2.5h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  )
}

/**
 * The confirmation tick.
 *
 * Transient and unlabelled on purpose: the button keeps its `title`, so a screen reader
 * announces the intent, and the visible change is a shape swap rather than a toast that
 * would cover the code the user is reading.
 */
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}