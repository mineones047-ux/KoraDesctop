import { PROVIDERS } from '../types'
import type { ConfigData, Provider } from '../types'

export type ResolvedProviderConfig = {
  provider: string
  model?: string
  apiKey?: string
  baseUrl?: string
}

type ConfigInput = Pick<
  ConfigData,
  | 'provider'
  | 'lmstudioUrl'
  | 'ollamaUrl'
  | 'llamacppUrl'
  | 'selectedModel'
  | 'apiKey'
  | 'apiBaseUrl'
  | 'apiModel'
>

const OPENROUTER_DEFAULT = 'https://openrouter.ai/api'
const LLAMACPP_DEFAULT = 'http://localhost:8080'

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
  // llama.cpp's `llama-server` speaks the OpenAI-compatible API (port 8080 by
  // default) — a first-class local provider, no key required.
  if (provider === 'llamacpp') {
    return { provider, baseUrl: baseUrlOverride || cfg.llamacppUrl || LLAMACPP_DEFAULT, model, apiKey: '' }
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

/**
 * Two-tier agent routing (ROADMAP Phase 0): resolve the *decision* tier —
 * the small/cheap model that answers "which tool next?" during agent runs,
 * while the main model writes the final answer.
 *
 * Returns null (feature off / unsafe config) when:
 *  - `agentDecisionModel` is empty (single-tier, today's default behaviour);
 *  - the decision provider is `custom` while the main provider is not
 *    (the shared apiBaseUrl field belongs to the main provider);
 *  - a cloud decision provider is chosen but no API key is configured.
 */
export function resolveDecisionLlmOptions(cfg: ConfigData): ResolvedProviderConfig | null {
  const model = (cfg.agentDecisionModel ?? '').trim()
  if (!model) return null
  const provider = (((cfg.agentDecisionProvider ?? '') as string).trim() || cfg.provider) as Provider
  if (provider === 'custom' && cfg.provider !== 'custom') return null

  const base = resolveProviderConfig({ ...cfg, provider })
  // Switching to a different catalog provider: the shared apiBaseUrl field
  // still belongs to the main provider — take the catalog URL instead.
  if (provider !== cfg.provider && provider !== 'lmstudio' && provider !== 'ollama' && provider !== 'llamacpp') {
    const catalog = PROVIDERS.find((p) => p.id === provider)
    if (catalog?.baseUrl) base.baseUrl = catalog.baseUrl
  }
  if (provider !== 'lmstudio' && provider !== 'ollama' && provider !== 'llamacpp' && !base.apiKey) return null
  return { ...base, model }
}
