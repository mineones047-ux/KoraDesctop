import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { formatTokenCount } from '../../lib/tokens'

/** A suggested or saved prompt rendered as a card in the empty chat. */
export interface PromptSuggestion {
  id: string
  title: string
  prompt: string
}

/** The composer: text input, `!` command autocomplete, TTS, microphone and context meta. */
interface InputBarProps {
  lang: Locale
  onSend: (message: string) => void
  isLoading: boolean
  onToggleTTS?: () => void
  isSpeaking?: boolean
  hasMessages?: boolean
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
  /** Model that will answer, shown in the composer meta row. */
  modelLabel?: string
  /** Rough token count for the current transcript (estimated upstream). */
  contextTokens?: number
  /** Text pushed in from the palette or a suggestion card; consumed once. */
  insertRequest?: { id: number; text: string } | null
}

/**
 * The message composer.
 *
 * Memoised for the same reason as `MessageBubble` — it sits directly above the streaming
 * message, so an unstable identity here would re-render the whole input on every token and
 * can drop focus mid-typing.
 *
 * The outer container owns the border and focus ring instead of the textarea: the input,
 * the controls and the meta row read as one control, so the focus state has to wrap all
 * of them.
 */
export const InputBar = memo(function InputBar({
  lang, onSend, isLoading, onToggleTTS, isSpeaking, hasMessages,
  volume = 1, isMuted = false, onToggleMute, onVolumeChange,
  isListening = false, isSpeechSupported = false, onStartListening, onStopListening, speechInterim = '',
  onStopGenerate, modelLabel, contextTokens = 0, insertRequest,
}: InputBarProps) {
  const t = useI18n(lang)
  const [value, setValue] = useState('')
  const prevListeningRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Сохраняем фокус в поле после подстановки текста из палитры / карточки промпта.
  useEffect(() => {
    if (!insertRequest) return
    setValue(insertRequest.text)
    const el = textareaRef.current
    if (el) {
      el.focus()
      // Cursor at the end, after the prefilled prompt.
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length
      })
    }
  }, [insertRequest])

  // Когда запись заканчивается, очищаем textarea
  useEffect(() => {
    if (prevListeningRef.current && !isListening) {
      setValue('')
    }
    prevListeningRef.current = isListening
  }, [isListening])

  // Сбрасываем высоту textarea после очистки значения
  useEffect(() => {
    if (!value && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value])

  // Пока идёт запись, показываем распознанный текст в textarea
  useEffect(() => {
    if (isListening && speechInterim) {
      setValue(speechInterim)
    }
  }, [isListening, speechInterim])

  const [showCommands, setShowCommands] = useState(false)
  const [cmdIndex, setCmdIndex] = useState(0)
  const cmdRef = useRef<HTMLDivElement>(null)

  // Every entry of COMMANDS needs a row here: the render falls back to `cmd.desc`
  // (a hardcoded English string in types/index.ts), so a missing key silently puts an
  // English label in an otherwise translated menu.
  const cmdDescs = useMemo(() => ({
    '!shell': t.commands.shell,
    '!file': t.commands.file,
    '!open': t.commands.open,
    '!dir': t.commands.dir,
    '!write': t.commands.write,
    '!rename': t.commands.rename,
    '!delete': t.commands.delete,
    '!mkdir': t.commands.mkdir,
    '!stat': t.commands.stat,
    '!exists': t.commands.exists,
    '!calc': t.commands.calc,
    '!random': t.commands.random,
    '!uuid': t.commands.uuid,
    '!time': t.commands.time,
    '!shutdown': t.commands.shutdown,
    '!restart': t.commands.restart,
    '!sleep': t.commands.sleep,
    '!lock': t.commands.lock,
    '!volume': t.commands.volume,
    '!mute': t.commands.mute,
    '!brightness': t.commands.brightness,
    '!windows': t.commands.windows,
    '!find': t.commands.find,
    '!clipboard': t.commands.clipboard,
    '!search': t.commands.search,
    '!confirm': t.commands.confirm,
    '!deny': t.commands.deny,
    '!help': t.commands.help,
  }), [t])

  const filteredCommands = useMemo(() => {
    if (!value.startsWith('!')) return []
    const query = value.toLowerCase()
    return COMMANDS.filter((c) => c.cmd.startsWith(query))
  }, [value])

  useEffect(() => {
    if (filteredCommands.length > 0 && value.startsWith('!')) {
      setShowCommands(true)
      setCmdIndex(0)
    } else {
      setShowCommands(false)
    }
  }, [filteredCommands.length, value])

  useEffect(() => {
    if (!showCommands) return
    const handler = (e: MouseEvent) => {
      if (cmdRef.current && !cmdRef.current.contains(e.target as Node)) {
        setShowCommands(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showCommands])

  const selectCommand = (cmd: string) => {
    setValue(cmd + ' ')
    setShowCommands(false)
    textareaRef.current?.focus()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setValue('')
    setShowCommands(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIndex((prev) => (prev + 1) % filteredCommands.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && filteredCommands.length > 0)) {
        e.preventDefault()
        selectCommand(filteredCommands[cmdIndex].cmd)
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        setShowCommands(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  const getVolumeIcon = (size: number = 16) => {
    if (isMuted || volume === 0) {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor" />
          <path d="M12 5.5l-2 2M10 5.5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    }
    if (volume < 0.5) {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor" />
          <path d="M10 6c.5.5.5 1.5 0 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )
    }
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor" />
        <path d="M10 5.5c.7.7.7 2 0 2.5M11.5 4c1.1 1.1 1.1 3 0 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 bg-kora-bg">
      <div className="mx-auto max-w-3xl">
        <form
          onSubmit={handleSubmit}
          className="relative rounded-card border border-kora-border bg-kora-surface shadow-[0_1px_0_rgb(255_255_255_/_0.02)] focus-within:border-kora-accent/70 focus-within:ring-2 focus-within:ring-kora-accent/15 transition-[border-color,box-shadow] duration-150"
        >
          {showCommands && filteredCommands.length > 0 && (
            <div
              ref={cmdRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-kora-surface border border-kora-border rounded-card shadow-panel overflow-hidden animate-fade-in z-50"
              role="listbox"
              aria-label={t.inputBar.commands}
            >
              <div className="px-3 py-2 border-b border-kora-border">
                <span className="text-[10px] uppercase tracking-wider font-medium text-kora-muted">{t.inputBar.commands}</span>
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.cmd}
                    type="button"
                    role="option"
                    aria-selected={i === cmdIndex}
                    onClick={() => selectCommand(cmd.cmd)}
                    onMouseEnter={() => setCmdIndex(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors duration-150 ${
                      i === cmdIndex ? 'bg-kora-card' : ''
                    }`}
                  >
                    <span className="text-xs font-mono text-kora-accent font-semibold min-w-[72px]">
                      {cmd.cmd}
                    </span>
                    <span className="text-xs text-kora-muted flex-1">
                      {cmdDescs[cmd.cmd as keyof typeof cmdDescs] || cmd.desc}
                    </span>
                    {cmd.args && (
                      <span className="text-[10px] text-kora-muted/60 font-mono">{cmd.args}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="px-3 py-1.5 border-t border-kora-border flex gap-3">
                <span className="text-[10px] text-kora-muted/60">{t.inputBar.navigate}</span>
                <span className="text-[10px] text-kora-muted/60">{t.inputBar.select}</span>
                <span className="text-[10px] text-kora-muted/60">{t.inputBar.close}</span>
              </div>
            </div>
          )}

          <div className="flex items-end gap-2 p-2">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.chat.placeholder}
              aria-label={t.chat.placeholder}
              rows={1}
              className="flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-6 text-kora-text placeholder-kora-muted focus:outline-none"
              style={{ minHeight: '44px', maxHeight: '200px' }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement
                target.style.height = 'auto'
                target.style.height = Math.min(target.scrollHeight, 200) + 'px'
              }}
            />

            <div className="shrink-0 flex items-center gap-1.5 pb-1">
              {isSpeechSupported && (
                <ToolButton
                  onClick={() => isListening ? onStopListening?.() : onStartListening?.()}
                  label={isListening ? t.inputBar.stopRecording : t.inputBar.startRecording}
                  tone={isListening ? 'danger' : 'neutral'}
                  pressed={isListening}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="10" y="2" width="4" height="14" rx="2" fill="currentColor" />
                    <path d="M17 11a5 5 0 0 1-10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </ToolButton>
              )}

              {hasMessages && (
                <div className="relative">
                  <ToolButton
                    onClick={onToggleTTS}
                    label={isSpeaking ? t.inputBar.stopSpeaking : t.inputBar.readLast}
                    tone={isSpeaking ? 'danger' : 'neutral'}
                    pressed={Boolean(isSpeaking)}
                  >
                    {isSpeaking ? (
                      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />
                      </svg>
                    ) : (
                      <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                        <path d="M3 7v4h2.5l3 2.5V4.5L5.5 7H3z" fill="currentColor" />
                        <path d="M11.5 7c.7.7.7 2 0 2.5M13 5.5c1.3 1.3 1.3 4 0 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                      </svg>
                    )}
                  </ToolButton>
                  {/* Volume lives in a popover opened by the small caret, not a right-click:
                      a right-click affordance has no discoverable label. */}
                  <VolumePopover
                    t={t}
                    volume={volume}
                    isMuted={isMuted}
                    onToggleMute={onToggleMute}
                    onVolumeChange={onVolumeChange}
                    icon={getVolumeIcon(12)}
                  />
                </div>
              )}

              {isLoading && onStopGenerate ? (
                <button
                  type="button"
                  onClick={onStopGenerate}
                  className="w-10 h-10 flex items-center justify-center rounded-field bg-kora-error/15 border border-kora-error/30 text-kora-error hover:bg-kora-error/25 transition-colors duration-150"
                  title={t.inputBar.stopGenerating}
                  aria-label={t.inputBar.stopGenerating}
                >
                  <svg width="15" height="15" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                    <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!value.trim() || isLoading}
                  className="w-10 h-10 flex items-center justify-center rounded-field bg-kora-accent hover:bg-kora-accent-hover disabled:opacity-30 disabled:cursor-not-allowed text-white transition-[background-color,opacity] duration-150"
                  title={t.chat.send}
                  aria-label={t.chat.send}
                >
                  {isLoading ? (
                    <svg className="animate-spin" width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="40 60" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                      <path d="M17 10L3 3l7 17 1-7 7-1-17-7z" fill="currentColor" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 px-4 pb-2 -mt-0.5 text-[10px] text-kora-muted select-none">
            <span className="font-mono truncate max-w-[45%]" title={modelLabel}>
              {modelLabel || '—'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums shrink-0">
              {t.inputBar.tokens.replace('{count}', formatTokenCount(contextTokens))}
            </span>
            <span className="ml-auto hidden md:inline truncate">{t.inputBar.shortcuts}</span>
          </div>
        </form>
      </div>
    </div>
  )
})

function ToolButton({
  onClick, label, tone, pressed, children,
}: {
  onClick?: () => void
  label: string
  tone: 'neutral' | 'danger'
  pressed?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={`w-10 h-10 flex items-center justify-center rounded-field border transition-colors duration-150 ${
        tone === 'danger'
          ? 'bg-kora-error/15 border-kora-error/30 text-kora-error'
          : 'bg-transparent border-transparent text-kora-muted hover:text-kora-text hover:bg-kora-card'
      }`}
    >
      {children}
    </button>
  )
}

function VolumePopover({
  t, volume, isMuted, onToggleMute, onVolumeChange, icon,
}: {
  t: ReturnType<typeof useI18n>
  volume: number
  isMuted?: boolean
  onToggleMute?: () => void
  onVolumeChange?: (volume: number) => void
  icon: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="absolute -bottom-1 -right-1" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t.inputBar.volume}
        aria-label={t.inputBar.volume}
        aria-expanded={open}
        className="w-4 h-4 flex items-center justify-center rounded-full border border-kora-border bg-kora-surface text-kora-muted hover:text-kora-text"
      >
        {icon}
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 bg-kora-surface border border-kora-border rounded-card p-3 shadow-panel animate-fade-in w-52 z-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-kora-muted">{t.inputBar.volume}</span>
            <span className="text-xs text-kora-text font-mono font-semibold tabular-nums">
              {isMuted ? '0%' : Math.round(volume * 100) + '%'}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={isMuted ? 0 : volume}
            aria-label={t.inputBar.volume}
            onChange={(e) => {
              const val = parseFloat(e.target.value)
              onVolumeChange?.(val)
              if (isMuted && val > 0) onToggleMute?.()
            }}
            className="w-full h-1.5 bg-kora-card rounded-full appearance-none cursor-pointer accent-kora-accent"
          />
          <button
            type="button"
            onClick={onToggleMute}
            className={`mt-3 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs transition-colors ${
              isMuted ? 'bg-kora-error/15 text-kora-error' : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
            }`}
          >
            <span className="font-mono tabular-nums">{isMuted ? '0' : Math.round(volume * 100)}</span>
            {t.inputBar.volume}
          </button>
        </div>
      )}
    </div>
  )
}
