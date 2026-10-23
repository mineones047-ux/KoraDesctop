import { useState, useEffect, useCallback, useRef } from 'react'
import type { ConfigData, Provider } from '../../types'
import { PROVIDERS, PROMPT_TEMPLATES, THEMES } from '../../types'
import type { Locale } from '../../i18n'
import { useI18n } from '../../hooks/useI18n'
import { MCPSettings } from './MCPSettings'
import { LocalModels } from './LocalModels'
import { resolveProviderConfig } from '../../lib/resolve-provider'

interface SettingsProps {
  lang: Locale
  config: ConfigData
  onUpdate: (key: keyof ConfigData, value: unknown) => void
  onClose: () => void
}

type Tab = 'customize' | 'provider' | 'prompt' | 'prompts' | 'voice' | 'mcp' | 'local'

/**
 * The sentence the "preview voice" button speaks, per language.
 *
 * Written in the target language on purpose: a Chinese voice reading an English sentence
 * proves nothing about how it will sound reading the user's actual content. TTS itself
 * needs no localisation — the Edge voices are picked by id elsewhere.
 */
const TTS_TEST_PHRASE: Record<string, string> = {
  en: 'Hello! This is a Kora voice test message.',
  ru: 'Привет! Это тестовое сообщение голоса Kora.',
  zh: '你好！这是 Kora 的语音试听。',
}

const STYLE_PRESETS = [
  { label: 'concise', value: 0.2 },
  { label: 'balanced', value: 0.7 },
  { label: 'detailed', value: 1.2 },
]

const TABS: { id: Tab; icon: React.ReactNode }[] = [
  {
    id: 'customize',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22a10 10 0 1 1 10-10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
  {
    id: 'provider',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
      </svg>
    ),
  },
  {
    id: 'prompt',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    ),
  },
  {
    id: 'prompts',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 17l-5.6 3 1.4-6.2L3 9.5l6.4-.7L12 3z" />
      </svg>
    ),
  },
  {
    id: 'voice',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      </svg>
    ),
  },
  {
    id: 'mcp',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
        <path d="M19 3h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z" />
        <path d="M9 15H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z" />
        <path d="M19 15h-4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z" />
      </svg>
    ),
  },
  {
    id: 'local',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v11" />
        <path d="M7 10l5 5 5-5" />
        <path d="M4 19h16" />
      </svg>
    ),
  },
]

/**
 * The settings panel: provider, model, appearance, TTS, MCP and vault paths.
 *
 * Writes through `onUpdate` on every change rather than keeping a draft and a Save button,
 * because these are preferences, not a transaction — but note that means a half-typed API
 * key is persisted immediately.
 */
export function Settings({ lang, config, onUpdate, onClose }: SettingsProps) {
  const t = useI18n(lang)
  const [tab, setTab] = useState<Tab>('customize')
  /** Fullscreen-like mode: the settings window is enlarged on its own, without
   *  touching the main window (the overlay stays above everything). */
  const [maximized, setMaximized] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [customName, setCustomName] = useState('')
  const [newPromptTitle, setNewPromptTitle] = useState('')
  const [newPromptText, setNewPromptText] = useState('')
  const [voices, setVoices] = useState<{ name: string; label: string }[]>([])
  const [previewVoice, setPreviewVoice] = useState<string | null>(null)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  const loadModels = useCallback(async (provider: Provider, baseUrl: string, apiKey: string) => {
    let result: string[] = []
    try {
      if (provider === 'lmstudio') {
        result = await window.kora.ai.listModels('lmstudio', baseUrl)
      } else if (provider === 'ollama') {
        result = await window.kora.ai.listModels('ollama', baseUrl)
      } else if (provider === 'llamacpp') {
        result = await window.kora.ai.listModels('llamacpp', baseUrl)
      } else if (provider === 'anthropic') {
        result = await window.kora.ai.listModels('anthropic')
      } else if (provider === 'openrouter' || provider === 'openai') {
        result = await window.kora.ai.listModels(provider, provider === 'openrouter' ? 'https://openrouter.ai/api' : 'https://api.openai.com', apiKey)
      } else if (provider === 'custom' || provider === 'gemini' || provider === 'groq' || provider === 'deepseek' || provider === 'mistral' || provider === 'xai') {
        result = await window.kora.ai.listModels(provider, baseUrl, apiKey)
      }
    } catch {
      result = []
    }
    setModels(result)
    return result
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      const baseUrl = resolveProviderConfig(config).baseUrl ?? ''
      loadModels(config.provider, baseUrl, config.apiKey)
    }, 400) // debounce: typing in apiKey/baseUrl fires one request per pause
    return () => clearTimeout(timer)
  }, [config.provider, config.lmstudioUrl, config.ollamaUrl, config.llamacppUrl, config.apiBaseUrl, config.apiKey, loadModels])

  useEffect(() => {
    window.kora.tts.voices()
      .then(setVoices)
      .catch((err) => console.error('Failed to load TTS voices:', err))
    return () => {
      previewAudioRef.current?.pause()
    }
  }, [])

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    const baseUrl = resolveProviderConfig(config).baseUrl
    try {
      const result = await window.kora.ai.testConnection({
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl,
      })
      setTestResult(result)
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const playVoicePreview = async (voice: string) => {
    if (previewVoice === voice) {
      previewAudioRef.current?.pause()
      setPreviewVoice(null)
      return
    }
    previewAudioRef.current?.pause()
    setPreviewVoice(voice)
    try {
      const result = await window.kora.tts.synthesize(TTS_TEST_PHRASE[config.language] ?? TTS_TEST_PHRASE.en, voice)
      if (!result.success || !result.audio) {
        setPreviewVoice(null)
        return
      }
      const audioBlob = new Blob(
        [Uint8Array.from(atob(result.audio), (c) => c.charCodeAt(0))],
        { type: 'audio/mpeg' }
      )
      const url = URL.createObjectURL(audioBlob)
      const audio = new Audio(url)
      previewAudioRef.current = audio
      audio.onended = () => {
        setPreviewVoice(null)
        URL.revokeObjectURL(url)
      }
      audio.onerror = () => {
        setPreviewVoice(null)
        URL.revokeObjectURL(url)
      }
      await audio.play()
    } catch {
      setPreviewVoice(null)
    }
  }

  const addCustomProvider = () => {
    if (!customName.trim()) return
    const newProviders = [
      ...config.customProviders,
      { name: customName, baseUrl: '', apiKey: '', model: '' },
    ]
    onUpdate('customProviders', newProviders)
    setCustomName('')
  }

  const removeCustomProvider = (index: number) => {
    const newProviders = config.customProviders.filter((_, i) => i !== index)
    onUpdate('customProviders', newProviders)
  }

  const updateCustomProvider = (index: number, key: string, value: string) => {
    const newProviders = [...config.customProviders]
    newProviders[index] = { ...newProviders[index], [key]: value }
    onUpdate('customProviders', newProviders)
  }

  const activeProvider = PROVIDERS.find((p) => p.id === config.provider) ?? PROVIDERS[0]
  const isLocal = !!activeProvider.local
  const showUrl = config.provider === 'lmstudio' || config.provider === 'ollama' || config.provider === 'llamacpp' || config.provider === 'openai' || config.provider === 'custom'
  const currentStyle = STYLE_PRESETS.find((s) => Math.abs(s.value - config.temperature) < 0.05)?.label ?? null

  const inputCls =
    'w-full bg-kora-card border border-kora-border rounded-xl px-4 py-2.5 text-sm text-kora-text placeholder-kora-muted/60 focus:border-kora-accent focus:ring-2 focus:ring-kora-accent/20 transition-all'
  const secondaryBtnCls =
    'px-5 py-2.5 bg-kora-card border border-kora-border rounded-full text-sm font-medium text-kora-text hover:border-kora-accent hover:text-kora-text hover:bg-kora-card/80 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm'

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 animate-fade-in" onClick={onClose}>        <div
        className={`${
          maximized
            ? 'w-[97vw] h-[95vh] max-w-none mx-0'
            : 'w-full max-w-4xl mx-4 max-h-[85vh]'
        } bg-kora-surface border border-kora-border rounded-3xl shadow-2xl animate-slide-up flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-kora-border">
          <div>
            <h2 className="text-lg font-semibold text-kora-text">{t.settings.title}</h2>
            <p className="text-xs text-kora-muted mt-0.5">{activeProvider.name} · {isLocal ? t.settings.local : t.settings.cloud}</p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMaximized((m) => !m)}
              aria-label={maximized ? t.titleBar.minimize : t.titleBar.maximize}
              title={maximized ? t.titleBar.minimize : t.titleBar.maximize}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2.5" y="2.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label={t.titleBar.close}
              title={t.titleBar.close}
              className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-kora-card text-kora-muted hover:text-kora-text transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Vertical rail + content side by side */}
        <div className="flex flex-1 min-h-0">
          <nav className="w-48 shrink-0 border-r border-kora-border p-3 space-y-1 overflow-y-auto">
            {TABS.map((tabDef) => (
              <button
                key={tabDef.id}
                onClick={() => setTab(tabDef.id)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  tab === tabDef.id
                    ? 'bg-kora-accent-soft text-kora-text'
                    : 'text-kora-muted hover:text-kora-text hover:bg-kora-card'
                }`}
              >
                {tabDef.icon}
                <span className="truncate">{t.settings.tabs[tabDef.id]}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 min-w-0 p-6 overflow-y-auto">
          {/* ============ CUSTOMIZE ============ */}
          {tab === 'customize' && (
            <div className="space-y-6">
              <div>
                <label className="block text-base font-medium text-kora-text mb-2">{t.settings.language}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.languageDesc}</p>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      { id: 'en' as Locale, label: 'English', flag: '🇺🇸' },
                      { id: 'ru' as Locale, label: 'Русский', flag: '🇷🇺' },
                      { id: 'zh' as Locale, label: '简体中文', flag: '🇨🇳' },
                    ] as { id: Locale; label: string; flag: string }[]
                  ).map((l) => (
                    <button
                      key={l.id}
                      onClick={() => onUpdate('language', l.id)}
                      className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-medium transition-all min-w-[120px] ${
                        config.language === l.id
                          ? 'bg-kora-accent-soft border border-kora-accent text-kora-text'
                          : 'bg-kora-card border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-border'
                      }`}
                    >
                      <span className="text-xl">{l.flag}</span>
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-kora-border pt-5">
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.theme}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.themeDesc}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.id}
                      onClick={() => onUpdate('theme', theme.id)}
                      className={`group text-left p-4 rounded-2xl border transition-all ${
                        config.theme === theme.id
                          ? 'bg-kora-accent-soft border-kora-accent'
                          : 'bg-kora-card border-kora-border hover:border-kora-border'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <span
                          className="w-8 h-8 rounded-full border border-white/10 shadow-inner"
                          style={{ background: theme.swatch }}
                        />
                        <span className="text-sm font-medium text-kora-text">
                          {theme.id === 'red' ? t.settings.themeRed : theme.id === 'light' ? t.settings.themeLight : theme.id === 'retro' ? t.settings.themeRetro : t.settings.themeDark}
                        </span>
                        {config.theme === theme.id && (
                          <svg className="ml-auto text-kora-accent" width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                            <circle cx="8" cy="8" r="3" fill="currentColor" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-kora-muted leading-relaxed">
                        {theme.id === 'red' ? t.settings.themeRedDesc : theme.id === 'light' ? t.settings.themeLightDesc : theme.id === 'retro' ? t.settings.themeRetroDesc : t.settings.themeDarkDesc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-kora-border pt-5">
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.graphLinkColor} / {t.settings.graphNodeColor}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.graphColorDesc}</p>
                <div className="space-y-3">
                  {([
                    { key: 'graphLinkColor' as const, label: t.settings.graphLinkColor, fallback: '#3b82f6', value: config.graphLinkColor },
                    { key: 'graphNodeColor' as const, label: t.settings.graphNodeColor, fallback: '#22c55e', value: config.graphNodeColor },
                  ]).map((row) => (
                    <div key={row.key} className="flex items-center gap-3 bg-kora-card border border-kora-border rounded-2xl px-3 py-2.5">
                      <span className="text-xs font-medium text-kora-text w-28 shrink-0">{row.label}</span>
                      <input
                        type="color"
                        value={row.value || row.fallback}
                        onChange={(e) => onUpdate(row.key, e.target.value)}
                        className="w-9 h-9 rounded-xl border border-kora-border bg-transparent cursor-pointer p-1"
                      />
                      <span className="text-xs font-mono text-kora-muted">
                        {row.value || '—'}
                      </span>
                      {row.value && (
                        <button
                          onClick={() => onUpdate(row.key, '')}
                          className="ml-auto px-3 py-1.5 rounded-full text-xs bg-kora-card border border-kora-border text-kora-muted hover:text-kora-text transition-colors shrink-0"
                        >
                          {t.settings.graphColorTheme}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* ---- Behavior: approval policy + OS autostart ---- */}
              <div className="border-t border-kora-border pt-5">
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.behaviorTitle}</label>
                <div className="space-y-4 mt-3">
                  <div>
                    <p className="text-xs font-medium text-kora-text">{t.settings.approvalModeLabel}</p>
                    <p className="text-xs text-kora-muted mb-2">{t.settings.approvalModeDesc}</p>
                    <div className="flex gap-2">
                      {([
                        { id: 'ask' as const, label: t.settings.approvalAsk },
                        { id: 'readonly' as const, label: t.settings.approvalReadonly },
                        { id: 'full' as const, label: t.settings.approvalFull },
                      ]).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => onUpdate('agentApprovalMode', m.id)}
                          className={`px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                            (config.agentApprovalMode ?? 'ask') === m.id
                              ? 'bg-kora-accent-soft border-kora-accent text-kora-text'
                              : 'bg-kora-card border-kora-border text-kora-muted hover:text-kora-text'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="flex items-start justify-between gap-4 cursor-pointer">
                    <span>
                      <span className="text-xs font-medium text-kora-text">{t.settings.autoLaunchLabel}</span>
                      <span className="block text-xs text-kora-muted">{t.settings.autoLaunchDesc}</span>
                    </span>
                    <button
                      onClick={() => {
                        const next = !(config.autoLaunchApp ?? false)
                        onUpdate('autoLaunchApp', next)
                        void window.kora.app.setAutoLaunch(next)
                      }}
                      className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
                        (config.autoLaunchApp ?? false) ? 'bg-kora-accent' : 'bg-kora-border'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                          (config.autoLaunchApp ?? false) ? 'left-[22px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ============ PROMPT LIBRARY ============ */}
          {tab === 'prompts' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-medium text-kora-text">{t.promptLib.title}</h3>
                <p className="mt-1 text-xs text-kora-muted leading-relaxed">{t.promptLib.desc}</p>
              </div>

              <div className="space-y-2">
                {(config.savedPrompts ?? []).length === 0 ? (
                  <div className="rounded-card border border-dashed border-kora-border px-4 py-8 text-center">
                    <p className="text-xs text-kora-muted">{t.promptLib.empty}</p>
                  </div>
                ) : (
                  (config.savedPrompts ?? []).map((prompt) => (
                    <div key={prompt.id} className="flex items-start gap-3 rounded-card border border-kora-border bg-kora-card px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-kora-text truncate">{prompt.title}</p>
                        <p className="mt-0.5 text-xs text-kora-muted whitespace-pre-wrap line-clamp-3">{prompt.prompt}</p>
                      </div>
                      <button
                        onClick={() =>
                          onUpdate(
                            'savedPrompts',
                            (config.savedPrompts ?? []).filter((item) => item.id !== prompt.id),
                          )
                        }
                        title={t.promptLib.delete}
                        aria-label={t.promptLib.delete}
                        className="shrink-0 p-1.5 rounded-lg text-kora-muted hover:text-kora-error hover:bg-kora-bg transition-colors"
                      >
                        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                          <path d="M2 3h8M4 3V2h4v1M3 3v7h6V3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-kora-border pt-5 space-y-2">
                <label className="block text-sm font-medium text-kora-text">{t.promptLib.add}</label>
                <input
                  type="text"
                  value={newPromptTitle}
                  onChange={(e) => setNewPromptTitle(e.target.value)}
                  placeholder={t.promptLib.namePlaceholder}
                  aria-label={t.promptLib.namePlaceholder}
                  maxLength={60}
                  className={inputCls}
                />
                <textarea
                  value={newPromptText}
                  onChange={(e) => setNewPromptText(e.target.value)}
                  placeholder={t.promptLib.textPlaceholder}
                  aria-label={t.promptLib.textPlaceholder}
                  rows={4}
                  className={`${inputCls} resize-y min-h-[96px] font-normal leading-relaxed`}
                />
                <button
                  onClick={() => {
                    const title = newPromptTitle.trim()
                    const text = newPromptText.trim()
                    if (!title || !text) return
                    onUpdate('savedPrompts', [
                      { id: crypto.randomUUID(), title, prompt: text },
                      ...(config.savedPrompts ?? []),
                    ])
                    setNewPromptTitle('')
                    setNewPromptText('')
                  }}
                  disabled={!newPromptTitle.trim() || !newPromptText.trim()}
                  className="px-4 py-2.5 rounded-field text-sm font-medium bg-kora-accent text-white hover:bg-kora-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {t.promptLib.save}
                </button>
              </div>
            </div>
          )}

          {tab === 'provider' && (
            <div className="space-y-6">
              <p className="text-xs text-kora-muted leading-relaxed">{t.settings.providerDesc}</p>              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {PROVIDERS.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onUpdate('provider', p.id)
                        onUpdate('apiBaseUrl', p.baseUrl)
                        onUpdate('selectedModel', '')
                      }}
                      className={`flex items-center gap-2.5 p-3.5 rounded-2xl border text-left transition-all ${
                        config.provider === p.id
                          ? 'bg-kora-accent/10 border-kora-accent'
                          : 'bg-kora-card border-kora-border hover:border-kora-border'
                      }`}
                    >
                      <span
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: p.badgeColor }}
                      >
                        {p.badge}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-kora-text truncate">{p.name}</span>
                        <span className="block text-[11px] text-kora-muted">
                          {p.local ? t.settings.local : t.settings.cloud}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>

              <div className="border-t border-kora-border pt-5 space-y-4">
                <label className="block text-sm font-medium text-kora-text">{t.settings.providerSetup}</label>

                {(showUrl || config.provider === 'anthropic' || config.provider === 'openrouter') && (
              <div>
                <label className="block text-sm font-medium text-kora-text mb-1.5">{t.settings.baseUrl}</label>
                <input
                  type="text"
                  value={config.provider === 'lmstudio' ? config.lmstudioUrl : config.provider === 'ollama' ? config.ollamaUrl : config.provider === 'llamacpp' ? (config.llamacppUrl ?? '') : config.apiBaseUrl}
                  onChange={(e) => {
                    if (config.provider === 'lmstudio') onUpdate('lmstudioUrl', e.target.value)
                    else if (config.provider === 'ollama') onUpdate('ollamaUrl', e.target.value)
                    else if (config.provider === 'llamacpp') onUpdate('llamacppUrl', e.target.value)
                    else onUpdate('apiBaseUrl', e.target.value)
                  }}
                  className={inputCls}
                  placeholder={activeProvider.baseUrl}
                />
                <p className="text-xs text-kora-muted mt-1.5">{t.settings.urlDesc}</p>
              </div>
                )}

                {!isLocal && (
                  <div>
                    <label className="block text-sm font-medium text-kora-text mb-1.5">{t.settings.apiKey}</label>
                    <input
                      type="password"
                      value={config.apiKey}
                      onChange={(e) => onUpdate('apiKey', e.target.value)}
                      className={inputCls}
                      placeholder={activeProvider.id === 'anthropic' ? 'sk-ant-...' : activeProvider.id === 'openrouter' ? 'sk-or-...' : 'sk-...'}
                    />
                    <p className="text-xs text-kora-muted mt-1.5">{t.settings.apiKeyDesc}</p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-kora-text mb-1.5">{t.settings.model}</label>
                  <div className="flex gap-2">
                    <select
                      value={config.selectedModel || config.apiModel}
                      onChange={(e) => {
                        onUpdate('apiModel', e.target.value)
                        onUpdate('selectedModel', e.target.value)
                      }}
                      className={`${inputCls} flex-1`}
                    >
                      {models.length === 0 ? (
                        <option value="">{t.settings.noModels}</option>
                      ) : (
                        models.map((model) => (
                          <option key={model} value={model}>{model}</option>
                        ))
                      )}
                    </select>
                    <button
                      onClick={() => loadModels(config.provider, showUrl ? (config.provider === 'lmstudio' ? config.lmstudioUrl : config.provider === 'ollama' ? config.ollamaUrl : config.provider === 'llamacpp' ? (config.llamacppUrl ?? '') : config.apiBaseUrl) : activeProvider.baseUrl, config.apiKey)}
                      className={secondaryBtnCls}
                    >
                      {t.settings.refresh}
                    </button>
                  </div>
                  {config.provider === 'custom' && (
                    <input
                      type="text"
                      value={config.apiModel}
                      onChange={(e) => {
                        onUpdate('apiModel', e.target.value)
                        onUpdate('selectedModel', e.target.value)
                      }}
                      className={`${inputCls} mt-2`}
                      placeholder={t.settings.modelPlaceholder}
                    />
                  )}
                  <p className="text-xs text-kora-muted mt-1.5">{t.settings.modelDesc}</p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-kora-muted mb-1.5">{t.settings.decisionModel}</label>
                  <div className="flex gap-2">
                    <select
                      value={config.agentDecisionProvider ?? ''}
                      onChange={(e) => onUpdate('agentDecisionProvider', e.target.value)}
                      className={inputCls}
                    >
                      <option value="">{t.settings.decisionSameProvider}</option>
                      {PROVIDERS.filter((p) => p.id !== 'custom').map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={config.agentDecisionModel ?? ''}
                      onChange={(e) => onUpdate('agentDecisionModel', e.target.value)}
                      className={inputCls}
                      placeholder={t.settings.decisionModelPlaceholder}
                    />
                  </div>
                  <p className="text-[10px] text-kora-muted mt-1">{t.settings.decisionHint}</p>
                </div>

                {!isLocal && (
                  <div>
                    <button
                      onClick={testConnection}
                      disabled={testing || !config.apiKey}
                      className={`${secondaryBtnCls} w-full ${config.apiKey ? 'hover:bg-kora-accent/10' : ''}`}
                    >
                      {testing ? t.settings.testing : t.settings.testConnection}
                    </button>
                    {testResult && (
                      <p className={`mt-2 text-xs ${testResult.success ? 'text-kora-success' : 'text-kora-error'}`}>
                        {testResult.success ? t.settings.connectionSuccess : `${t.settings.connectionError} ${testResult.error}`}
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-kora-border pt-5">
                <label className="block text-base font-medium text-kora-text mb-3">{t.settings.savedProviders}</label>
                <div className="space-y-3">
                  {config.customProviders.map((cp, index) => (
                    <div key={index} className="bg-kora-card border border-kora-border rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-base font-medium text-kora-text">{cp.name}</span>
                        <button
                          onClick={() => removeCustomProvider(index)}
                          className="px-3 py-1.5 rounded-full text-xs bg-kora-error/10 text-kora-error hover:bg-kora-error/20 transition-colors"
                        >
                          {t.settings.remove}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={cp.baseUrl}
                        onChange={(e) => updateCustomProvider(index, 'baseUrl', e.target.value)}
                        className={`${inputCls} !py-2.5`}
                        placeholder={t.settings.baseUrl}
                      />
                      <input
                        type="password"
                        value={cp.apiKey}
                        onChange={(e) => updateCustomProvider(index, 'apiKey', e.target.value)}
                        className={`${inputCls} !py-2.5`}
                        placeholder={t.settings.apiKey}
                      />
                      <input
                        type="text"
                        value={cp.model}
                        onChange={(e) => updateCustomProvider(index, 'model', e.target.value)}
                        className={`${inputCls} !py-2.5`}
                        placeholder={t.settings.enterModel}
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addCustomProvider()}
                      className={`${inputCls} flex-1`}
                      placeholder={t.settings.providerName}
                    />
                    <button onClick={addCustomProvider} className={secondaryBtnCls}>
                      {t.settings.add}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============ PROMPT ============ */}
          {tab === 'prompt' && (
            <div className="space-y-6">
              <p className="text-xs text-kora-muted leading-relaxed">{t.settings.promptDesc}</p>

              <div>
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.promptTemplate}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.promptTemplateDesc}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PROMPT_TEMPLATES.map((tp) => (
                    <button
                      key={tp.id}
                      onClick={() => {
                        onUpdate('activeTemplate', tp.id)
                        onUpdate('systemPrompt', tp.prompt)
                      }}
                      className={`text-left p-3.5 rounded-2xl border transition-all text-sm ${
                        config.activeTemplate === tp.id
                          ? 'bg-kora-accent/10 border-kora-accent'
                          : 'bg-kora-card border-kora-border hover:border-kora-border'
                      }`}
                    >
                      <span className="block text-sm font-semibold text-kora-text mb-1">{tp.name}</span>
                      <span className="block text-xs text-kora-muted leading-relaxed line-clamp-2">
                        {tp.prompt.length > 110 ? tp.prompt.slice(0, 110) + '…' : tp.prompt}
                      </span>
                    </button>
                  ))}
                  {config.activeTemplate === 'custom' && (
                    <div className="p-3.5 rounded-2xl border border-kora-accent bg-kora-accent/10">
                      <span className="block text-sm font-semibold text-kora-text">{t.settings.custom}</span>
                      <span className="block text-xs text-kora-muted leading-relaxed mt-1 line-clamp-2">
                        {config.systemPrompt.length > 110 ? config.systemPrompt.slice(0, 110) + '…' : config.systemPrompt}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4">
                  <label className="block text-xs font-medium text-kora-muted mb-1.5">
                    {t.settings.promptTemplate} · {t.settings.custom}
                  </label>
                  <textarea
                    value={config.systemPrompt}
                    onChange={(e) => {
                      onUpdate('systemPrompt', e.target.value)
                      onUpdate('activeTemplate', 'custom')
                    }}
                    rows={7}
                    className={`${inputCls} resize-none font-mono text-xs leading-relaxed`}
                  />
                </div>
              </div>

              <div className="border-t border-kora-border pt-5">
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.vaultPath}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.vaultPathDesc}</p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={config.obsidianVaultPath}
                    onChange={(e) => onUpdate('obsidianVaultPath', e.target.value)}
                    className={inputCls}
                    placeholder="C:\Users\...\obsid"
                  />
                  <button
                    onClick={async () => {
                      const r = await window.kora.obsidian.pickVault()
                      if (r.success && r.path) onUpdate('obsidianVaultPath', r.path)
                    }}
                    className={secondaryBtnCls}
                  >
                    {t.settings.pickFolder}
                  </button>
                </div>
              </div>

              <div className="border-t border-kora-border pt-5">
                <label className="block text-sm font-medium text-kora-text mb-1">{t.settings.responseStyle}</label>
                <p className="text-xs text-kora-muted mb-3">{t.settings.responseStyleDesc}</p>
                <div className="flex gap-2">
                  {STYLE_PRESETS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => onUpdate('temperature', s.value)}
                      className={`flex-1 px-4 py-2.5 rounded-full text-sm font-medium transition-all ${
                        currentStyle === s.label
                          ? 'bg-kora-accent text-white shadow-sm shadow-kora-accent/20'
                          : 'bg-kora-card border border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent'
                      }`}
                    >
                      {t.settings[`style${s.label[0].toUpperCase()}${s.label.slice(1)}` as 'styleConcise' | 'styleBalanced' | 'styleDetailed']}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-medium text-kora-text">{t.settings.temperature}</label>
                  <span className="text-sm text-kora-muted font-mono bg-kora-card border border-kora-border rounded-full px-3 py-1">
                    {config.temperature.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={config.temperature}
                  onChange={(e) => onUpdate('temperature', parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-kora-card rounded-full appearance-none cursor-pointer accent-kora-accent"
                />
                <div className="flex justify-between text-[10px] text-kora-muted mt-1.5">
                  <span>{t.settings.precise}</span>
                  <span>{t.settings.balanced}</span>
                  <span>{t.settings.creative}</span>
                </div>
              </div>
            </div>
          )}

          {/* ============ VOICE ============ */}
          {tab === 'voice' && (
            <div className="space-y-4">
              <p className="text-xs text-kora-muted leading-relaxed">{t.settings.voiceDesc}</p>

              <div className="border-t border-kora-border pt-4 space-y-3">
                <label className="block text-sm font-medium text-kora-text mb-1.5">{t.settings.sttEngine}</label>
                <select
                  value={config.sttEngine ?? 'webspeech'}
                  onChange={(e) => onUpdate('sttEngine', e.target.value)}
                  className={`${inputCls} flex-1`}
                >
                  <option value="webspeech">{t.settings.sttWebSpeech}</option>
                  <option value="whisper">{t.settings.sttWhisper}</option>
                </select>
                {(config.sttEngine ?? 'webspeech') === 'whisper' && (
                  <div className="space-y-2.5">
                    <input
                      type="text"
                      value={config.whisperPath ?? ''}
                      onChange={(e) => onUpdate('whisperPath', e.target.value)}
                      className={inputCls}
                      placeholder="C:\\whisper.cpp\\build\\bin\\whisper-cli.exe"
                    />
                    <input
                      type="text"
                      value={config.whisperModel ?? ''}
                      onChange={(e) => onUpdate('whisperModel', e.target.value)}
                      className={inputCls}
                      placeholder="C:\\whisper.cpp\\models\\ggml-base.bin"
                    />
                  </div>
                )}
                <p className="text-xs text-kora-muted leading-relaxed">{t.settings.whisperHint}</p>
              </div>
              <div className="space-y-2">
                {voices.map((v) => (
                  <div
                    key={v.name}
                    className={`flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${
                      config.ttsVoice === v.name
                        ? 'bg-kora-accent/10 border-kora-accent shadow-sm shadow-kora-accent/10'
                        : 'bg-kora-card border-kora-border hover:border-kora-border'
                    }`}
                  >
                    <button
                      onClick={() => onUpdate('ttsVoice', v.name)}
                      className="flex-1 flex items-center gap-3 min-w-0 text-left"
                    >
                      <span
                        className={`w-3 h-3 rounded-full shrink-0 ${
                          config.ttsVoice === v.name ? 'bg-kora-accent' : 'bg-kora-border'
                        }`}
                      />
                      <span className={`text-sm truncate ${config.ttsVoice === v.name ? 'text-kora-text' : 'text-kora-muted'}`}>
                        {v.label}
                      </span>
                      {config.ttsVoice === v.name && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-kora-accent/20 text-kora-accent shrink-0 font-medium">
                          ✓
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => playVoicePreview(v.name)}
                      className={`w-10 h-10 flex items-center justify-center rounded-full border transition-all shrink-0 ${
                        previewVoice === v.name
                          ? 'bg-kora-error text-white border-kora-error shadow-sm'
                          : 'bg-kora-bg border-kora-border text-kora-muted hover:text-kora-text hover:border-kora-accent hover:bg-kora-card'
                      }`}
                      title={t.settings.previewVoice}
                    >
                      {previewVoice === v.name ? (
                        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 1.5l7 4.5-7 4.5v-9z" fill="currentColor" />
                        </svg>
                      )}
                    </button>
                  </div>
                ))}
                {voices.length === 0 && (
                  <p className="text-sm text-kora-muted text-center py-6">{t.settings.loadingVoices}</p>
                )}
              </div>
            </div>
          )}

          {/* ============ MCP ============ */}
          {tab === 'mcp' && (
            <MCPSettings lang={lang} />
          )}

          {/* ============ LOCAL AI ============ */}
          {tab === 'local' && (
            <LocalModels lang={lang} onUpdate={onUpdate} floating onClose={() => setTab('customize')} />
          )}
          </div>
        </div>
      </div>
    </div>
  )
}