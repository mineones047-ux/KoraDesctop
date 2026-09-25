import { describe, it, expect } from 'vitest'
import { estimateTokens, entryTokens, fitToTokenBudget } from '../token-budget'

const entry = (role: string, content: string) => ({ role, content })

describe('token budget — estimateTokens / entryTokens', () => {
  it('is zero for empty text and grows linearly with length', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('a'.repeat(400))).toBe(101) // 400/4 + 1
  })

  it('adds message framing overhead per entry', () => {
    const e = entry('user', 'x'.repeat(40))
    expect(entryTokens(e)).toBe(estimateTokens(e.content) + 4)
  })
})

describe('token budget — fitToTokenBudget (ROADMAP Phase 0)', () => {
  const history = [
    entry('user', 'first question about files'),
    entry('assistant', 'dir listing: a.txt b.txt'),
    entry('user', 'now read a.txt'),
    entry('assistant', 'file contents: hello world'),
    entry('user', 'thanks, and the other one?'),
    entry('assistant', 'file contents: goodbye'),
  ]

  it('keeps everything when it fits the budget', () => {
    const fit = fitToTokenBudget(history, 10_000)
    expect(fit.kept).toHaveLength(6)
    expect(fit.droppedCount).toBe(0)
    expect(fit.droppedText).toBe('')
  })

  it('drops the OLDEST entries first when over budget', () => {
    const fit = fitToTokenBudget(history, 40, 2)
    expect(fit.droppedCount).toBeGreaterThan(0)
    // The newest entries survive, the oldest are gone
    expect(fit.kept[fit.kept.length - 1]).toBe(history[history.length - 1])
    expect(fit.kept[0]).not.toBe(history[0])
    expect(fit.droppedText).toContain('first question about files')
  })

  it('always keeps at least the recent tail, even with a tiny budget', () => {
    const fit = fitToTokenBudget(history, 1, 4)
    expect(fit.kept).toHaveLength(4)
    expect(fit.kept[0]).toBe(history[2])
    expect(fit.droppedCount).toBe(2)
  })

  it('handles short histories without dropping anything', () => {
    const fit = fitToTokenBudget(history.slice(0, 3), 10, 4)
    expect(fit.kept).toHaveLength(3)
    expect(fit.droppedCount).toBe(0)
  })

  it('droppedText labels entries with their roles for the summariser', () => {
    const fit = fitToTokenBudget(history, 50, 2)
    if (fit.droppedCount > 0) {
      expect(fit.droppedText).toMatch(/^(user|assistant): /)
    }
  })
})
