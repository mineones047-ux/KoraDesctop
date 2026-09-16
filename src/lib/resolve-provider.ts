import type { ConfigData } from '../types'

export type ResolvedProviderConfig = {
  provider: string
  model?: string
  apiKey?: string
  baseUrl?: string
}

type ConfigInput = Pick<
  ConfigData,
  'provider' | 'lmstudioUrl' | 'ollamaUrl' | 'selectedModel' | 'apiKey' | 'apiBaseUrl' | 'apiModel'
>

const OPENROUTER_DEFAULT = 'https://openrouter.ai/api'

/**
 * Resolve the user's configured chat provider into an LLM request config.
 * Explicit baseUrl/model parameters (e.g. from the agent) win over stored config.
 */
export function resolveProviderConfig(
  cfg: ConfigInput,
  baseUrlOverride?: string,
  modelOverride?: string,
): ResolvedProviderConfig {
  const { provider } = cfg
  const model = modelOverride || cfg.selectedModel || cfg.apiModel || undefined

  if (provider === 'lmstudio') {
    return { provider, baseUrl: baseUrlOverride || cfg.lmstudioUrl, model, apiKey: '' }
  }
  if (provider === 'ollama') {
    return { provider, baseUrl: baseUrlOverride || cfg.ollamaUrl, model, apiKey: '' }
  }
  if (provider === 'openrouter') {
    return {
      provider,
      baseUrl: baseUrlOverride || cfg.apiBaseUrl || OPENROUTER_DEFAULT,
      apiKey: cfg.apiKey,
      model,
    }
  }

  return {
    provider,
    baseUrl: baseUrlOverride || cfg.apiBaseUrl,
    apiKey: cfg.apiKey,
    model,
  }
}
