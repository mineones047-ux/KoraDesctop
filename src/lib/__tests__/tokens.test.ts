import { describe, expect, it } from 'vitest'
import { estimateMessagesTokens, estimateTokens, formatTokenCount } from '../tokens'

describe('estimateTokens', () => {
  it('counts about four Latin characters per token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('counts one token per CJK character', () => {
    expect(estimateTokens('你好世界')).toBe(4)
    expect(estimateTokens('你好 world')).toBe(4)
  })
})

describe('estimateMessagesTokens', () => {
  it('sums every message', () => {
    expect(estimateMessagesTokens(['abcd', 'efgh'])).toBe(2)
    expect(estimateMessagesTokens([])).toBe(0)
  })
})

describe('formatTokenCount', () => {
  it('keeps small numbers exact and shortens larger ones', () => {
    expect(formatTokenCount(0)).toBe('0')
    expect(formatTokenCount(950)).toBe('950')
    expect(formatTokenCount(1234)).toBe('1.2k')
    expect(formatTokenCount(12_400)).toBe('12k')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(Number.NaN)).toBe('0')
  })
})
