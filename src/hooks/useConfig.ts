import { useState, useEffect, useCallback } from 'react'
import type { ConfigData } from '../types'
import { PROMPT_TEMPLATES } from '../types'

const DEFAULT_CONFIG: ConfigData = {
  provider: 'lmstudio',
  lmstudioUrl: 'http://localhost:1234',
  ollamaUrl: 'http://localhost:11434',
  selectedModel: '',
  apiKey: '',
  apiBaseUrl: 'https://api.openai.com',
  apiModel: 'gpt-3.5-turbo',
  customProviders: [],
  systemPrompt: 'You are Kora, a helpful AI assistant. Be concise and clear in your responses.',
  temperature: 0.7,
  activeTemplate: 'default',
  ttsVoice: 'ru-RU-DmitryNeural',
  theme: 'red',
  language: 'en',
  obsidianVaultPath: '',
  graphLinkColor: '',
  graphNodeColor: '',
}

export function useConfig() {
  const [config, setConfig] = useState<ConfigData>(DEFAULT_CONFIG)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const saved = await window.kora.config.get()
      const merged = { ...DEFAULT_CONFIG, ...saved }
      // If a template is selected but the stored prompt is stale (out of sync with
      // the template, e.g. from an older app version), re-apply the template prompt.
      const template = PROMPT_TEMPLATES.find((t) => t.id === merged.activeTemplate)
      if (template && template.prompt !== merged.systemPrompt) {
        merged.systemPrompt = template.prompt
        window.kora.config.set('systemPrompt', template.prompt).catch((err: unknown) => {
          console.error('Failed to sync system prompt:', err)
        })
      }
      setConfig(merged)
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  const updateConfig = useCallback(
    async (key: keyof ConfigData, value: unknown) => {
      setConfig((prev) => ({ ...prev, [key]: value }))
      await window.kora.config.set(key, value)
    },
    []
  )

  return { config, updateConfig }
}