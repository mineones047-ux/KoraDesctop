import { useState, useEffect } from 'react'
import { useReActAgent } from '../../agent'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import type { ConfigData } from '../../types'
import { resolveProviderConfig } from '../../lib/resolve-provider'

interface AgentDisplayProps {
  lang: Locale
  config: ConfigData
  show: boolean
  onClose: () => void
}

export function AgentDisplay({ lang, config, show, onClose }: AgentDisplayProps) {
  const t = useI18n(lang)
  const agent = useReActAgent()

  const [input, setInput] = useState('')

  useEffect(() => {
    if (show) setInput('')
  }, [show])

  if (!show) return null

  const { state, isRunning, currentPlan, result, liveTranscript } = agent

  const handleStart = () => {
    if (!input.trim() || isRunning) return
    agent.startCycle(
      input.trim(),
      {
        ...resolveProviderConfig(config),
        temperature: config.temperature,
      }
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleStart()
    }
  }

  const confirmationUI = state.pendingConfirmation ? (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-fade-in">
      <div className="w-full max-w-md bg-kora-surface border border-kora-border rounded-2xl p-6 animate-slide-up">
        <h2 className="text-xl font-semibold text-kora-text mb-4">{t.agent.confirmationRequired}</h2>
        <p className="text-kora-text mb-2">{t.agent.acting}</p>
        {state.pendingConfirmation.params && (
          <pre className="text-xs text-kora-muted bg-kora-card rounded-xl p-3 mb-6 overflow-x-auto whitespace-pre-wrap">
            {JSON.stringify(state.pendingConfirmation.params, null, 2)}
          </pre>
        )}

        <div className="space-y-3">
          <button
            onClick={() => agent.resumeAfterConfirmation(true)}
            className="w-full px-4 py-2 bg-kora-accent text-white rounded-xl hover:bg-kora-accent-hover text-sm font-medium transition-all"
          >
            {t.agent.approved}
          </button>
          <button
            onClick={() => agent.resumeAfterConfirmation(false)}
            className="w-full px-4 py-2 bg-kora-card border border-kora-border text-kora-text hover:bg-kora-card/50 text-sm font-medium transition-all"
          >
            {t.agent.denied}
          </button>
        </div>
      </div>
    </div>
  ) : null

  const planUI = currentPlan.map((step, index) => {
    const cardCls =
      step.action === 'think'
        ? 'bg-kora-card/50'
        : step.action === 'act'
          ? 'bg-kora-accent/10'
          : 'bg-kora-card/50'
    const dotCls =
      step.action === 'think'
        ? 'bg-kora-accent'
        : step.action === 'act'
          ? 'bg-kora-success'
          : 'bg-kora-warning'
    return (
      <div key={index} className={`p-3 rounded-xl mb-2 animate-fade-in ${cardCls}`}>
        <div className="flex items-start gap-3">
          <div className={`w-2 h-2 rounded-full mt-1.5 ${dotCls}`} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-kora-muted">{step.thought}</p>
            {step.tool && (
              <p className="text-[10px] text-kora-muted/50 mt-0.5">
                {step.tool}
                {step.parameters ? `: ${JSON.stringify(step.parameters)}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>
      <div
        className="w-full max-w-3xl bg-kora-surface border border-kora-border rounded-2xl shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-kora-border">
          <h2 className="text-lg font-semibold text-kora-text">{t.agent.title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {isRunning && (
            <>
              <p className="text-xs text-kora-accent font-medium">{t.agent.running}</p>

              {liveTranscript && (
                <div className="rounded-xl border border-kora-border bg-kora-card/30 p-3 max-h-40 overflow-y-auto">
                  <p className="text-xs text-kora-muted italic whitespace-pre-wrap font-mono leading-relaxed">
                    {liveTranscript}
                    <span className="inline-block w-2 h-4 ml-1 align-middle bg-kora-accent animate-pulse" />
                  </p>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="rounded-xl border border-kora-border bg-kora-card/40 p-4">
              <p className="text-xs font-medium text-kora-muted mb-1">
                {result.success ? t.agent.result : t.agent.errorTitle}
              </p>
              <p className={`text-sm whitespace-pre-wrap ${result.success ? 'text-kora-text' : 'text-kora-error'}`}>
                {result.success ? result.answer : result.error}
              </p>
            </div>
          )}

          {/* Plan steps */}
          <div>
            <h3 className="text-sm font-medium text-kora-text mb-3">
              {isRunning || currentPlan.length > 0 ? `${t.agent.thinking} (${currentPlan.length})` : t.agent.waitingForInput}
            </h3>
            {planUI.length > 0 ? (
              <div className="space-y-1 max-h-44 overflow-y-auto">
                {planUI}
              </div>
            ) : (
              <p className="text-kora-muted text-sm">{t.agent.noToolsAvailable}</p>
            )}
          </div>

          {/* Input */}
          <div>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t.agent.inputPlaceholder}
                className="flex-1 bg-kora-card border border-kora-border rounded-xl px-3 py-2 text-sm text-kora-text focus:outline-none focus:border-kora-accent transition-colors"
                disabled={isRunning}
              />
              {isRunning ? (
                <button
                  onClick={agent.stop}
                  className="px-4 py-2 bg-kora-error text-white rounded-xl text-sm font-medium transition-all"
                >
                  {t.agent.stopAgent}
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={!input.trim()}
                  className="px-4 py-2 bg-kora-accent text-white rounded-xl text-sm font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {t.agent.startAgent}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {confirmationUI}
    </div>
  )
}
