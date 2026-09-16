import { describe, it, expect } from 'vitest'
import { normalizeForSpeech, splitForSpeech, speechWordsForVoice } from '../tts-speech'

describe('speechWordsForVoice', () => {
  it('picks Russian words for ru/uk voices', () => {
    expect(speechWordsForVoice('ru-RU-DmitryNeural').link).toBe('ссылка')
    expect(speechWordsForVoice('uk-UA-...').code).toBe('фрагмент кода')
  })
  it('picks English words otherwise', () => {
    expect(speechWordsForVoice('en-US-...').link).toBe('link')
  })
})

describe('normalizeForSpeech', () => {
  const EN = speechWordsForVoice('en-US-x')

  it('strips markdown links, code, images, URLs', () => {
    const out = normalizeForSpeech('See [docs](https://x.com) and `code` and ![img](a.png) at https://x.y', EN)
    expect(out).not.toContain('[docs]')
    expect(out).not.toContain('](')
    expect(out).not.toContain('https://')
    expect(out).not.toContain('![')
  })

  it('truncates very long text with an ellipsis', () => {
    const long = 'a. '.repeat(5000)
    const out = normalizeForSpeech(long, EN, 500)
    expect(out.length).toBeLessThanOrEqual(520)
  })
})

describe('splitForSpeech', () => {
  it('returns a single chunk for short text', () => {
    expect(splitForSpeech('hello world')).toEqual(['hello world'])
  })

  it('splits long text into multiple chunks', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} here.`).join(' ')
    const parts = splitForSpeech(text, 200)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join(' ').replace(/\s+/g, ' ').trim()).toBe(text)
  })

  it('returns empty array for empty/whitespace input', () => {
    expect(splitForSpeech('')).toEqual([])
    expect(splitForSpeech('   ')).toEqual([])
  })
})
