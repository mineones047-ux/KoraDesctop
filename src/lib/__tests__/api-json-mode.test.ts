import { describe, it, expect } from 'vitest'
// Import the REAL production gateway (the same module the main process runs)
// — a copy here would silently drift from production behaviour.
import { buildBody, isJsonModeRejected } from '../../../electron/services/api'

const MSGS = [
  { role: 'system' as const, content: 'You answer with a JSON object.' },
  { role: 'user' as const, content: 'hi' },
]

describe('structured output — buildBody jsonMode (ROADMAP Phase 0)', () => {
  it('adds response_format json_object for OpenAI-compatible providers', () => {
    const body = buildBody(MSGS, 'gpt-4o-mini', 'openai', false, 0.2, true) as Record<string, unknown>
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('omits response_format when jsonMode is off', () => {
    const body = buildBody(MSGS, 'gpt-4o-mini', 'openai', false, 0.2) as Record<string, unknown>
    expect('response_format' in body).toBe(false)
  })

  it('omits response_format for the local providers by default', () => {
    const body = buildBody(MSGS, 'qwen2.5-7b', 'lmstudio', true, undefined) as Record<string, unknown>
    expect('response_format' in body).toBe(false)
    const withJson = buildBody(MSGS, 'qwen2.5-7b', 'lmstudio', true, undefined, true) as Record<string, unknown>
    expect(withJson.response_format).toEqual({ type: 'json_object' })
    expect(withJson.stream).toBe(true)
  })

  it('never sends response_format to anthropic (no such parameter)', () => {
    const body = buildBody(MSGS, 'claude-3-5-sonnet-20241022', 'anthropic', false, 0.2, true) as Record<string, unknown>
    expect('response_format' in body).toBe(false)
    expect(body.system).toBe(MSGS[0].content)
  })
})

describe('structured output — isJsonModeRejected fallback guard', () => {
  it('matches a response_format rejection from an unknown server', () => {
    expect(
      isJsonModeRejected(new Error("[kora:unknown] API error: 400 - Unknown parameter: 'response_format'.")),
    ).toBe(true)
  })

  it('matches json-mode wording from local servers', () => {
    expect(isJsonModeRejected(new Error('[kora:unknown] json mode is not supported by this model'))).toBe(true)
  })

  it('never retries auth / model / context errors even if they mention the word', () => {
    expect(isJsonModeRejected(new Error('[kora:auth] API error: 401 - response_format invalid key'))).toBe(false)
    expect(
      isJsonModeRejected(new Error('[kora:model_not_found] API error: 404 - no model response_format-x')),
    ).toBe(false)
    expect(
      isJsonModeRejected(new Error('[kora:context_overflow] too many tokens; reduce response_format docs')),
    ).toBe(false)
  })

  it('ignores unrelated errors', () => {
    expect(isJsonModeRejected(new Error('[kora:network] Request failed: fetch failed'))).toBe(false)
    expect(isJsonModeRejected(undefined)).toBe(false)
  })
})
