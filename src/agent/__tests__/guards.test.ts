import { describe, it, expect } from 'vitest'
import {
  parseLlmErrorReason,
  isRetryableReason,
  detectDegenerateRepetition,
  isEmptyResponse,
  IterationBudget,
  ToolLoopGuard,
} from '../guards'

describe('parseLlmErrorReason', () => {
  it('extracts a known failover reason from an error message', () => {
    expect(parseLlmErrorReason(new Error('[kora:rate_limit] too many'))).toBe('rate_limit')
    expect(parseLlmErrorReason(new Error('[kora:context_overflow] too long'))).toBe('context_overflow')
    expect(parseLlmErrorReason('[kora:timeout] slow')).toBe('timeout')
    expect(parseLlmErrorReason(new Error('[kora:network] drop'))).toBe('network')
  })

  it('returns none for unknown or missing reasons', () => {
    expect(parseLlmErrorReason(new Error('boom'))).toBe('none')
    expect(parseLlmErrorReason('[kora:whatever]')).toBe('none')
    expect(parseLlmErrorReason(null)).toBe('none')
  })
})

describe('isRetryableReason', () => {
  it('marks transient errors as retryable', () => {
    expect(isRetryableReason('rate_limit')).toBe(true)
    expect(isRetryableReason('server_error')).toBe(true)
    expect(isRetryableReason('network')).toBe(true)
    expect(isRetryableReason('timeout')).toBe(true)
  })

  it('does not retry auth/overflow/none', () => {
    expect(isRetryableReason('auth')).toBe(false)
    expect(isRetryableReason('context_overflow')).toBe(false)
    expect(isRetryableReason('model_not_found')).toBe(false)
    expect(isRetryableReason('none')).toBe(false)
  })
})

describe('detectDegenerateRepetition', () => {
  it('flags long repeated phrase loops', () => {
    const loop = 'I am a teapot. '.repeat(40)
    expect(detectDegenerateRepetition(loop)).toBe(true)
  })

  it('does not flag normal prose', () => {
    const prose =
      'Kora is a desktop AI assistant. It can manage files on your computer, run commands in a shell, and search the web for current information. When you ask it to do something, it uses specialized tools rather than guessing. This is a long enough string to exceed the repetition guard threshold without actually repeating itself, because every clause here is distinct and the vocabulary varies across the whole sentence.'
    expect(detectDegenerateRepetition(prose)).toBe(false)
  })

  it('ignores short text', () => {
    expect(detectDegenerateRepetition('short')).toBe(false)
  })
})

describe('isEmptyResponse', () => {
  it('detects empty/whitespace/non-string', () => {
    expect(isEmptyResponse('')).toBe(true)
    expect(isEmptyResponse('   ')).toBe(true)
    expect(isEmptyResponse(null)).toBe(true)
    expect(isEmptyResponse(undefined)).toBe(true)
  })

  it('accepts real content', () => {
    expect(isEmptyResponse('hello')).toBe(false)
  })
})

describe('IterationBudget', () => {
  it('tracks consumption and remaining', () => {
    const b = new IterationBudget(3)
    expect(b.remaining).toBe(3)
    expect(b.consume()).toBe(true)
    expect(b.consume()).toBe(true)
    expect(b.remaining).toBe(1)
    b.refund()
    expect(b.remaining).toBe(2)
  })

  it('rejects when budget exhausted', () => {
    const b = new IterationBudget(1)
    expect(b.consume()).toBe(true)
    expect(b.consume()).toBe(false)
  })
})

describe('ToolLoopGuard', () => {
  it('detects identical consecutive tool calls', () => {
    const g = new ToolLoopGuard()
    const res = { ok: true }
    g.record('dir', { path: '~' }, res)
    g.record('dir', { path: '~' }, res)
    expect(g.check()).toBeTruthy()
  })

  it('returns null for distinct calls', () => {
    const g = new ToolLoopGuard()
    g.record('dir', { path: '~/a' }, { ok: true })
    g.record('dir', { path: '~/b' }, { ok: true })
    expect(g.check()).toBeNull()
  })
})
