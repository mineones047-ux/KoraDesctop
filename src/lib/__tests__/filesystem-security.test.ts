import { describe, it, expect } from 'vitest'
// Import the REAL production implementation (electron/ipc/filesystem.ts imports
// the same module) — a copy here would silently drift from production.
import { isUnsafeRegex, matchGlob } from '../../../electron/lib/regex-security'

describe('Filesystem Security - Regex Safety', () => {
  describe('isUnsafeRegex - ReDoS Detection', () => {
    it('rejects catastrophically backtracking patterns', () => {
      // Classic ReDoS patterns
      expect(isUnsafeRegex('(a+)+')).toBe(true)
      expect(isUnsafeRegex('(a*)*')).toBe(true)
      expect(isUnsafeRegex('(a?b)+x')).toBe(true)
      expect(isUnsafeRegex('(a+)+$')).toBe(true)
      expect(isUnsafeRegex('(\\d{2,}){3}')).toBe(true)
      expect(isUnsafeRegex('(a+b){10,}')).toBe(true)
    })

    it('allows safe quantifiers', () => {
      // These should be safe
      expect(isUnsafeRegex('a+')).toBe(false)
      expect(isUnsafeRegex('a*')).toBe(false)
      expect(isUnsafeRegex('a{2,5}')).toBe(false)
      expect(isUnsafeRegex('[a-z]+')).toBe(false)
      expect(isUnsafeRegex('\\d+')).toBe(false)
    })

    it('allows non-nested quantifiers', () => {
      expect(isUnsafeRegex('hello')).toBe(false)
      expect(isUnsafeRegex('hello world')).toBe(false)
      expect(isUnsafeRegex('test.*')).toBe(false)
      expect(isUnsafeRegex('function\\s+\\w+')).toBe(false)
    })

    it('rejects invalid regex', () => {
      // These patterns throw in JS and are rejected by the constructor check
      expect(isUnsafeRegex('[invalid')).toBe(true)
      expect(isUnsafeRegex('*')).toBe(true)
      expect(isUnsafeRegex('+')).toBe(true)
      expect(isUnsafeRegex('?')).toBe(true)
      // "a{1," does NOT throw in JS (the incomplete quantifier falls back to
      // a literal "{1,"), so it needs its own rule — rule 5 in the guard.
      expect(isUnsafeRegex('a{1,')).toBe(true)
      // Plain "a{" is a harmless literal brace and stays allowed
      expect(isUnsafeRegex('a{')).toBe(false)
    })

    it('rejects patterns that are too long', () => {
      const longPattern = 'a'.repeat(201)
      expect(isUnsafeRegex(longPattern)).toBe(true)
    })

    it('handles escaped characters correctly', () => {
      // Escaped quantifiers should be safe
      expect(isUnsafeRegex('\\+')).toBe(false)
      expect(isUnsafeRegex('\\*')).toBe(false)
      expect(isUnsafeRegex('\\?')).toBe(false)
      expect(isUnsafeRegex('a\\+b')).toBe(false)
    })

    it('handles character classes correctly', () => {
      // Quantifiers inside character classes should be ignored
      expect(isUnsafeRegex('[a+]+')).toBe(false) // The + inside [] is literal
      expect(isUnsafeRegex('[a*]+')).toBe(false)
    })

    it('handles non-capturing groups', () => {
      expect(isUnsafeRegex('(?:a+)+')).toBe(true)
      expect(isUnsafeRegex('(?:\\d+)+')).toBe(true)
    })

    it('handles lookahead and lookbehind', () => {
      expect(isUnsafeRegex('(?=a+)+')).toBe(true)
      expect(isUnsafeRegex('(?!a+)+')).toBe(true)
    })
  })

  describe('Pattern Length Limits', () => {
    it('rejects patterns over 200 chars', () => {
      const long = 'a'.repeat(201)
      expect(isUnsafeRegex(long)).toBe(true)
    })

    it('allows patterns at exactly 200 chars', () => {
      const ok = 'a'.repeat(200)
      expect(isUnsafeRegex(ok)).toBe(false)
    })
  })
})

describe('Glob Pattern Safety', () => {
  it('matches simple globs', () => {
    expect(matchGlob('test.ts', '*.ts')).toBe(true)
    expect(matchGlob('test.js', '*.ts')).toBe(false)
    expect(matchGlob('file.txt', '*.*')).toBe(true)
  })

  it('matches single character wildcards', () => {
    expect(matchGlob('file1.txt', 'file?.txt')).toBe(true)
    expect(matchGlob('file12.txt', 'file?.txt')).toBe(false)
  })

  it('handles special characters in glob', () => {
    // These should be escaped and treated literally
    expect(matchGlob('file.test', 'file.test')).toBe(true)
    expect(matchGlob('file+test', 'file+test')).toBe(true)
  })
})
