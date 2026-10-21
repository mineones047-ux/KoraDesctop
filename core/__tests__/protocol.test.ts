import { describe, it, expect } from 'vitest'
import {
  PROTOCOL_VERSION,
  CORE_CAPABILITIES,
  ErrorCodes,
  KORA_REASONS,
  isKoraReason,
  withKoraMarker,
  frame,
  parseFrame,
  errorResponse,
} from '../protocol'

describe('protocol identity', () => {
  it('pins the protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('kora-rpc/1')
  })

  it('declares every capability group from docs/CORE_RPC.md §5', () => {
    expect([...CORE_CAPABILITIES].sort()).toEqual(
      ['agent', 'ai', 'chats', 'config', 'fs', 'mcp', 'obsidian', 'shell', 'system', 'tts', 'web'].sort(),
    )
  })
})

describe('frozen LLM failure reasons (koraReason)', () => {
  it('matches the [kora:<reason>] marker values exactly', () => {
    expect([...KORA_REASONS]).toEqual([
      'rate_limit',
      'auth',
      'model_not_found',
      'context_overflow',
      'server_error',
      'network',
      'timeout',
      'unknown',
    ])
  })

  it('isKoraReason accepts only known reasons', () => {
    expect(isKoraReason('rate_limit')).toBe(true)
    expect(isKoraReason('RATE_LIMIT')).toBe(false)
    expect(isKoraReason('totally_new')).toBe(false)
    expect(isKoraReason(42)).toBe(false)
    expect(isKoraReason(null)).toBe(false)
  })

  it('renders the legacy marker byte-compatible', () => {
    expect(withKoraMarker('network', 'boom')).toBe('[kora:network] boom')
  })
})

describe('framing (newline-delimited JSON)', () => {
  it('appends exactly one newline and no pretty-printing', () => {
    const out = frame({ jsonrpc: '2.0', id: 1, result: { a: 1 } })
    expect(out).toBe('{"jsonrpc":"2.0","id":1,"result":{"a":1}}\n')
    expect(out.split('\n')).toHaveLength(2)
  })

  it('parses a valid frame', () => {
    const parsed = parseFrame('{"jsonrpc":"2.0","id":7,"method":"fs.exists","params":["/tmp"]}')
    expect(parsed).toEqual({
      ok: true,
      message: { jsonrpc: '2.0', id: 7, method: 'fs.exists', params: ['/tmp'] },
    })
  })

  it('never throws: garbage, empty lines and non-objects fail cleanly', () => {
    expect(parseFrame('not json').ok).toBe(false)
    expect(parseFrame('').ok).toBe(false)
    expect(parseFrame('   \n').ok).toBe(false)
    expect(parseFrame('[1,2,3]')).toEqual({ ok: false, error: 'not-an-object' })
    expect(parseFrame('"just a string"')).toEqual({ ok: false, error: 'not-an-object' })
  })
})

describe('error responses', () => {
  it('builds a failure with data', () => {
    const r = errorResponse(7, ErrorCodes.llmError, 'rate limited', { koraReason: 'rate_limit' })
    expect(r).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32010, message: 'rate limited', data: { koraReason: 'rate_limit' } },
    })
  })

  it('omits data when absent and allows null id', () => {
    const r = errorResponse(null, ErrorCodes.parse, 'Parse error')
    expect(r.error).not.toHaveProperty('data')
    expect(r.id).toBeNull()
  })
})
