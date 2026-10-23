import { memo, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Message } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { copyToClipboard } from '../../lib/clipboard'
import { nodeText } from '../../lib/markdown-text'

/** One message, rendered as markdown, with copy, speak, edit and regenerate controls. */
interface MessageBubbleProps {
  message: Message
  lang: Locale
  onSpeak?: (text: string, messageId: string) => void
  onStop?: () => void
  isPlaying?: boolean
  /** Only the last user message can be edited (editing an earlier one rewrites history). */
  canEdit?: boolean
  /** Only the last assistant message can be regenerated, and never while streaming. */
  canRegenerate?: boolean
  onEdit?: (messageId: string, content: string) => void
  onRegenerate?: () => void
}

/** How long the "copied" confirmation stays on screen. */
const COPIED_FEEDBACK_MS = 1600

/**
 * One chat message.
 *
 * The two roles are intentionally not symmetrical: the user's text is a compact bubble on
 * the right, the assistant's answer is a full-width document on the left. Bubbling a long
 * answer narrows every line for no reason, and the asymmetry makes the transcript easy to
 * skim without avatars or labels.
 *
 * Memoised on purpose: this is the component that would otherwise re-render on every
 * streamed token. It only re-renders when its own `message` object changes, so the
 * streaming message updates and the other hundred bubbles in the list stay put.
 */
export const MessageBubble = memo(function MessageBubble({
  message, lang, onSpeak, onStop, isPlaying, canEdit, canRegenerate, onEdit, onRegenerate,
}: MessageBubbleProps) {
  const t = useI18n(lang)
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState<'message' | 'code' | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the timer on unmount: a bubble removed mid-feedback would otherwise set state
  // on an unmounted component.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // A regenerated or edited message replaces `content`; the draft must not resurrect the
  // text the user already committed.
  useEffect(() => {
    if (!editing) setDraft(message.content)
  }, [message.content, editing])

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
   * in `<pre><code>`, so `nodeText` walks to the source text the user actually sees.
   */
  const copyCode = (code: string) => async () => {
    if (await copyToClipboard(code)) flash('code')
  }

  const commitEdit = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    setEditing(false)
    if (trimmed !== message.content) onEdit?.(message.id, trimmed)
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in group`}>
      <div className={isUser ? 'max-w-[min(85%,44rem)]' : 'w-full max-w-[52rem]'}>
        {isUser ? (
          editing ? (
            <div className="rounded-card bg-kora-accent-soft/70 border border-kora-accent/40 p-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    commitEdit()
                  }
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setEditing(false)
                  }
                }}
                rows={3}
                aria-label={t.message.edit}
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 text-kora-text"
              />
              <div className="flex justify-end gap-1.5 pt-1">
                <button
                  onClick={() => setEditing(false)}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-kora-muted hover:text-kora-text hover:bg-kora-bg/40 transition-colors"
                >
                  {t.message.cancel}
                </button>
                <button
                  onClick={commitEdit}
                  disabled={!draft.trim()}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-kora-accent text-white hover:bg-kora-accent-hover disabled:opacity-40 transition-colors"
                >
                  {t.message.save}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-card rounded-tr-md bg-kora-accent-soft/70 border border-kora-accent/20 px-4 py-3">
              <p className="text-sm leading-6 whitespace-pre-wrap break-words">{message.content}</p>
            </div>
          )
        ) : (
          <div className="markdown text-sm text-kora-text">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p>{children}</p>,
                code: ({ className, children, ...props }) => {
                  const match = /language-(\w+)/.exec(className || '')
                  const isInline = !match
                  return isInline ? (
                    <code className="bg-kora-card border border-kora-border/60 px-1.5 py-0.5 rounded-md text-[0.85em] font-mono text-kora-text" {...props}>
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
                    <div className="relative group/code my-1">
                      <pre className="bg-kora-bg/80 rounded-field p-3 overflow-x-auto border border-kora-border">
                        {children}
                      </pre>
                      <button
                        onClick={copyCode(source)}
                        title={copied === 'code' ? t.message.codeCopied : t.message.copyCode}
                        aria-label={copied === 'code' ? t.message.codeCopied : t.message.copyCode}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-kora-card/90 border border-kora-border text-kora-muted hover:text-kora-text transition-colors row-actions"
                      >
                        {copied === 'code' ? <CheckIcon /> : <ClipboardIcon />}
                      </button>
                    </div>
                  )
                },
                ul: ({ children }) => <ul className="list-disc">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal">{children}</ol>,
                li: ({ children }) => <li>{children}</li>,
                h1: ({ children }) => <h1 className="font-semibold">{children}</h1>,
                h2: ({ children }) => <h2 className="font-semibold">{children}</h2>,
                h3: ({ children }) => <h3 className="font-semibold">{children}</h3>,
                a: ({ href, children }) => (
                  <a href={href} className="text-kora-accent underline underline-offset-2 hover:text-kora-accent-hover" target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-2 border-kora-accent/60 pl-3 text-kora-muted">{children}</blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">{children}</table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-kora-border px-3 py-1 text-left bg-kora-card font-medium">{children}</th>
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

        {message.content && !editing && (
          <div className={`mt-1 flex items-center gap-0.5 row-actions ${isUser ? 'justify-end' : 'justify-start'}`}>
            <BubbleButton onClick={copyMessage} label={copied === 'message' ? t.message.copied : t.message.copy}>
              {copied === 'message' ? <CheckIcon /> : <ClipboardIcon />}
            </BubbleButton>

            {!isUser && (
              <BubbleButton
                onClick={() => isPlaying ? onStop?.() : onSpeak?.(message.content, message.id)}
                label={isPlaying ? t.message.stop : t.message.readAloud}
                active={isPlaying}
              >
                {isPlaying ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2 5.5v3h2.5l3 2.5V3L4.5 5.5H2z" fill="currentColor" />
                    <path d="M9 5.5c.5.5.5 1.5 0 2M10.5 4c1 1 1 3 0 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                )}
              </BubbleButton>
            )}

            {isUser && canEdit && onEdit && (
              <BubbleButton onClick={() => setEditing(true)} label={t.message.edit}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M9.5 2.5l2 2L5 11H3V9l6.5-6.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </BubbleButton>
            )}

            {!isUser && canRegenerate && onRegenerate && (
              <BubbleButton onClick={onRegenerate} label={t.message.regenerate}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M12 7a5 5 0 1 1-1.6-3.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M12 1.8v3.4H8.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </BubbleButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
})

/** Small text-only control under a message. Motion is a color swap, not a moving icon. */
function BubbleButton({
  onClick, label, active, children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`p-1.5 rounded-lg transition-colors duration-150 ${
        active
          ? 'text-kora-accent bg-kora-accent-soft/60'
          : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
      }`}
    >
      {children}
    </button>
  )
}

/** The clipboard glyph, shown on both copy buttons. */
function ClipboardIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4" y="4.5" width="7.5" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5.5 4.5V3.5A1 1 0 0 1 6.5 2.5h2a1 1 0 0 1 1 1v1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
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
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7.5l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
