import { describe, it, expect } from 'vitest'
// Import the REAL production resolver used by useUnifiedChat — a copy here
// would silently drift from production behaviour.
import { resolveDecisionLlmOptions, resolveProviderConfig } from '../resolve-provider'
import type { ConfigData } from '../../types'

function cfg(overrides: Partial<ConfigData> = {}): ConfigData {
  return {
    provider: 'lmstudio',
    lmstudioUrl: 'http://localhost:1234',
    ollamaUrl: 'http://localhost:11434',
    selectedModel: 'big-instruct',
    apiKey: 'sk-test-123',
    apiBaseUrl: 'https://api.openai.com',
    apiModel: 'gpt-4o',
    customProviders: [],
    systemPrompt: 'sys',
    temperature: 0.7,
    activeTemplate: 'default',
    ttsVoice: 'x',
    theme: 'dark',
    language: 'en',
    obsidianVaultPath: '',
    graphLinkColor: '',
    graphNodeColor: '',
    ...overrides,
  }
}

describe('two-tier routing — resolveDecisionLlmOptions (ROADMAP Phase 0)', () => {
  it('is off by default: no decision model → null (single tier, old behaviour)', () => {
    expect(resolveDecisionLlmOptions(cfg())).toBeNull()
  })

  it('is off when the decision model is whitespace', () => {
    expect(resolveDecisionLlmOptions(cfg({ agentDecisionModel: '   ' }))).toBeNull()
  })

  it('same provider: keeps the main endpoint/key and swaps in the small model', () => {
    const out = resolveDecisionLlmOptions(cfg({ agentDecisionModel: 'small-fast' }))
    expect(out).toEqual({
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234',
      apiKey: '',
      model: 'small-fast',
    })
  })

  it('decision tier on ollama while main is lmstudio: uses the ollama URL, no key', () => {
    const out = resolveDecisionLlmOptions(
      cfg({ agentDecisionModel: 'phi3', agentDecisionProvider: 'ollama' }),
    )
    expect(out).toEqual({
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      apiKey: '',
      model: 'phi3',
    })
  })

  it('catalog provider override ignores the main provider apiBaseUrl', () => {
    const out = resolveDecisionLlmOptions(
      cfg({
        provider: 'lmstudio',
        agentDecisionModel: 'gpt-4o-mini',
        agentDecisionProvider: 'openai',
        apiKey: 'sk-x',
        apiBaseUrl: 'https://someone-elses.example.com',
      }),
    )
    expect(out?.baseUrl).toBe('https://api.openai.com')
    expect(out?.model).toBe('gpt-4o-mini')
  })

  it('cloud decision provider without an API key → null (never fire doomed calls)', () => {
    expect(
      resolveDecisionLlmOptions(
        cfg({ agentDecisionModel: 'gpt-4o-mini', agentDecisionProvider: 'openai', apiKey: '' }),
      ),
    ).toBeNull()
  })

  it('custom decision provider while main is different → null (shared apiBaseUrl)', () => {
    expect(
      resolveDecisionLlmOptions(
        cfg({ agentDecisionModel: 'x', agentDecisionProvider: 'custom' }),
      ),
    ).toBeNull()
  })
})

describe('llama.cpp provider — llama-server is OpenAI-compatible, no key', () => {
  it('resolves the configured llama-server URL without an API key', () => {
    const out = resolveProviderConfig({ ...cfg({ provider: 'llamacpp', llamacppUrl: 'http://127.0.0.1:9090' }) })
    expect(out).toEqual({ provider: 'llamacpp', baseUrl: 'http://127.0.0.1:9090', model: 'big-instruct', apiKey: '' })
  })

  it('falls back to the default llama-server port when unset', () => {
    const out = resolveProviderConfig({ ...cfg({ provider: 'llamacpp', llamacppUrl: undefined }) })
    expect(out.baseUrl).toBe('http://localhost:8080')
    expect(out.apiKey).toBe('')
  })

  it('works as a decision tier without an API key (never null)', () => {
    const out = resolveDecisionLlmOptions(
      cfg({ agentDecisionModel: 'qwen3-4b', agentDecisionProvider: 'llamacpp' }),
    )
    expect(out?.provider).toBe('llamacpp')
    expect(out?.baseUrl).toBe('http://localhost:8080')
    expect(out?.model).toBe('qwen3-4b')
  })
})
