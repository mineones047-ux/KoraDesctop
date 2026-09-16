import { useState, useCallback, useEffect, useRef, useMemo, memo } from 'react'
import { COMMANDS } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'

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
}

export const InputBar = memo(function InputBar({
  lang, onSend, isLoading, onToggleTTS, isSpeaking, hasMessages,
  volume = 1, isMuted = false, onToggleMute, onVolumeChange,
  isListening = false, isSpeechSupported = false, onStartListening, onStopListening, speechInterim = '',
  onStopGenerate,
}: InputBarProps) {
  const t = useI18n(lang)
  const [value, setValue] = useState('')
  const prevListeningRef = useRef(false)

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

  const [showVolume, setShowVolume] = useState(false)
  const [showCommands, setShowCommands] = useState(false)
  const [cmdIndex, setCmdIndex] = useState(0)
  const volumeRef = useRef<HTMLDivElement>(null)
  const cmdRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  useEffect(() => {
    if (!showVolume) return
    const handler = (e: MouseEvent) => {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setShowVolume(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showVolume])

  const selectCommand = useCallback((cmd: string) => {
    setValue(cmd + ' ')
    setShowCommands(false)
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      const trimmed = value.trim()
      if (!trimmed || isLoading) return
      onSend(trimmed)
      setValue('')
      setShowCommands(false)
    },
    [value, isLoading, onSend]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
          setShowCommands(false)
          return
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit(e)
      }
    },
    [showCommands, filteredCommands, cmdIndex, selectCommand, handleSubmit]
  )

  const getVolumeIcon = (size: number = 16) => {
    if (isMuted || volume === 0) {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor"/>
          <path d="M12 5.5l-2 2M10 5.5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )
    }
    if (volume < 0.5) {
      return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
          <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor"/>
          <path d="M10 6c.5.5.5 1.5 0 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      )
    }
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M2 6v4h2.5l3 2.5V3.5L4.5 6H2z" fill="currentColor"/>
        <path d="M10 5.5c.7.7.7 2 0 2.5M11.5 4c1.1 1.1 1.1 3 0 4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      </svg>
    )
  }

  return (
    <div className="p-4 border-t border-kora-border bg-kora-surface">
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <div className="flex-1 relative">
          {/* Command Palette */}
          {showCommands && filteredCommands.length > 0 && (
            <div
              ref={cmdRef}
              className="absolute bottom-full left-0 right-0 mb-2 bg-kora-surface border border-kora-border rounded-xl shadow-xl overflow-hidden animate-fade-in z-50"
            >
              <div className="px-3 py-2 border-b border-kora-border">
                <span className="text-xs text-kora-muted">{t.inputBar.commands}</span>
              </div>
              <div className="max-h-[240px] overflow-y-auto">
                {filteredCommands.map((cmd, i) => (
                  <button
                    key={cmd.cmd}
                    type="button"
                    onClick={() => selectCommand(cmd.cmd)}
                    onMouseEnter={() => setCmdIndex(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      i === cmdIndex
                        ? 'bg-kora-card'
                        : 'hover:bg-kora-card/50'
                    }`}
                  >
                    <span className="text-sm font-mono text-kora-accent font-semibold min-w-[70px]">
                      {cmd.cmd}
                    </span>
                    <span className="text-xs text-kora-muted flex-1">
                      {cmdDescs[cmd.cmd as keyof typeof cmdDescs] || cmd.desc}
                    </span>
                    {cmd.args && (
                      <span className="text-xs text-kora-muted/60 font-mono">{cmd.args}</span>
                    )}
                  </button>
                ))}
              </div>
              <div className="px-3 py-1.5 border-t border-kora-border flex gap-3">
                <span className="text-[10px] text-kora-muted/50">{t.inputBar.navigate}</span>
                <span className="text-[10px] text-kora-muted/50">{t.inputBar.select}</span>
                <span className="text-[10px] text-kora-muted/50">{t.inputBar.close}</span>
              </div>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.chat.placeholder}
            rows={1}
            className="w-full resize-none bg-kora-card border border-kora-border rounded-xl px-4 py-3 text-sm text-kora-text placeholder-kora-muted focus:outline-none focus:border-kora-accent transition-colors"
            style={{ minHeight: '48px', maxHeight: '200px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 200) + 'px'
            }}
          />
        </div>

        {/* Microphone Button */}
        {isSpeechSupported && (
          <button
            type="button"
            onClick={() => isListening ? onStopListening?.() : onStartListening?.()}
            className={`shrink-0 w-12 h-12 flex items-center justify-center rounded-xl transition-all ${
              isListening
                ? 'bg-kora-error/20 text-kora-error border border-kora-error/30 animate-pulse shadow-lg shadow-kora-error/20'
                : 'bg-kora-card border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent'
            }`}
            title={isListening ? t.inputBar.stopRecording : t.inputBar.startRecording}
          >
            {isListening ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="animate-pulse">
                <rect x="10" y="2" width="4" height="14" rx="2" fill="currentColor"/>
                <path d="M17 11a5 5 0 0 1-10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <rect x="10" y="2" width="4" height="14" rx="2" fill="currentColor"/>
                <path d="M17 11a5 5 0 0 1-10 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M12 17v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            )}
          </button>
        )}

        {/* Unified TTS + Volume Button */}
        {hasMessages && (
          <div className="relative" ref={volumeRef}>
            {/* Main button — click to speak/stop, right-click for volume */}
            <button
              type="button"
              onClick={onToggleTTS}
              onContextMenu={(e) => {
                e.preventDefault()
                setShowVolume(!showVolume)
              }}
              className={`shrink-0 w-12 h-12 flex items-center justify-center rounded-xl transition-all relative ${
                isSpeaking
                  ? 'bg-kora-error/20 text-kora-error border border-kora-error/30 animate-pulse'
                  : isMuted
                    ? 'bg-kora-error/10 text-kora-error border border-kora-error/20'
                    : 'bg-kora-card border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent'
              }`}
              title={isSpeaking ? t.inputBar.stopSpeaking : t.inputBar.readLast}
            >
              {isSpeaking ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 7v4h2.5l3 2.5V4.5L5.5 7H3z" fill="currentColor"/>
                  <path d="M11.5 7c.7.7.7 2 0 2.5M13 5.5c1.3 1.3 1.3 4 0 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              )}
              {/* Volume indicator dot */}
              {!isSpeaking && (
                <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${
                  isMuted ? 'bg-kora-error' : volume > 0.5 ? 'bg-kora-success' : volume > 0 ? 'bg-kora-warning' : 'bg-kora-muted'
                }`} />
              )}
            </button>

            {/* Volume popup — on right-click or click indicator */}
            {showVolume && (
              <div className="absolute bottom-full right-0 mb-2 bg-kora-surface border border-kora-border rounded-xl p-3 shadow-xl animate-fade-in w-52 z-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-kora-muted">{t.inputBar.volume}</span>
                  <span className="text-xs text-kora-text font-mono font-bold">
                    {isMuted ? '0%' : Math.round(volume * 100) + '%'}
                  </span>
                </div>

                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value)
                    onVolumeChange?.(val)
                    if (isMuted && val > 0) onToggleMute?.()
                  }}
                  className="w-full h-1.5 bg-kora-card rounded-full appearance-none cursor-pointer accent-kora-accent"
                />

                <div className="flex justify-between items-center mt-2">
                  <div className="flex gap-1">
                    {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          onVolumeChange?.(v)
                          if (isMuted && v > 0) onToggleMute?.()
                        }}
                        className={`w-1.5 h-1.5 rounded-full transition-all ${
                          (isMuted ? 0 : volume) >= v ? 'bg-kora-accent' : 'bg-kora-border'
                        }`}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={onToggleMute}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs transition-all ${
                      isMuted
                        ? 'bg-kora-error/20 text-kora-error'
                        : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
                    }`}
                  >
                    {getVolumeIcon(12)}
                    <span className="font-mono">{isMuted ? '0' : Math.round(volume * 100)}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Send / Stop Button */}
        {isLoading && onStopGenerate ? (
          <button
            type="button"
            onClick={onStopGenerate}
            className="shrink-0 w-12 h-12 flex items-center justify-center bg-kora-error/20 hover:bg-kora-error/30 border border-kora-error/40 rounded-xl text-kora-error transition-all animate-pulse"
            title={t.inputBar.stopGenerating}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor"/>
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || isLoading}
            className="shrink-0 w-12 h-12 flex items-center justify-center bg-kora-accent hover:bg-kora-accent-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-xl text-white transition-all"
          >
            {isLoading ? (
              <svg className="animate-spin" width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeDasharray="40 60" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M17 10L3 3l7 17 1-7 7-1-17-7z" fill="currentColor" />
              </svg>
            )}
          </button>
        )}
      </form>
    </div>
  )
})