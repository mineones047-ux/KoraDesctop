import { describe, expect, it } from 'vitest'
import { locales } from '../index'
import type { Locale } from '../index'
import { COMMANDS } from '../../types'

/** Dotted `section.key` → value map for one locale, walking nested groups like `settings.tabs`. */
function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value }
  if (value === null || typeof value !== 'object') return {}
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, child]) => Object.assign(acc, flatten(child, prefix ? `${prefix}.${key}` : key)),
    {},
  )
}

const flat = Object.fromEntries(
  Object.entries(locales).map(([lang, table]) => [lang, flatten(table)]),
) as Record<Locale, Record<string, string>>

const langs = Object.keys(locales) as Locale[]
const reference = langs[0]
const referenceKeys = Object.keys(flat[reference]).sort()

/** `{args}` / `{name}` style tokens inside a template. */
const placeholders = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort()

describe('locale tables', () => {
  it('exposes the same keys in every locale', () => {
    for (const lang of langs) {
      expect(Object.keys(flat[lang]).sort(), `key set of "${lang}"`).toEqual(referenceKeys)
    }
  })

  it('has no empty or whitespace-only string', () => {
    for (const lang of langs) {
      const empty = Object.entries(flat[lang])
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key)
      expect(empty, `empty strings in "${lang}"`).toEqual([])
    }
  })

  it('keeps the same placeholders in every locale', () => {
    for (const lang of langs) {
      for (const key of referenceKeys) {
        expect(placeholders(flat[lang][key]), `${lang}:${key}`).toEqual(placeholders(flat[reference][key]))
      }
    }
  })

  it('contains no legacy-encoding artifacts', () => {
    // The failure this guards: `ru.ts` was once written back through cp1251, which turns
    // "Новый" into "РќРѕРІС‹Р№" (a Р/С glued to a cp1251 continuation character) and drops
    // the undefined 0x98 byte of "И", leaving a C1 control character behind.
    const doubleEncoded = /[РС][‚„…†‡‰‹•–—™іїјљњќѝўџЂЃЉЊЋЏ°±№]/
    const controlChars = /[\u0080-\u009f\ufffd]/
    for (const lang of langs) {
      const bad = Object.entries(flat[lang])
        .filter(([, value]) => doubleEncoded.test(value) || controlChars.test(value))
        .map(([key]) => key)
      expect(bad, `mojibake in "${lang}"`).toEqual([])
    }
  })

  it('translates the same string in every locale (no untranslated copies)', () => {
    // Brand names and pure technical identifiers are allowed to be identical everywhere;
    // anything else identical to English across two locales is a missed translation.
    const allowedIdentical = new Set([
      'app.name', 'emptyChat.title', 'settings.lmstudioUrl', 'settings.baseUrl', 'system.cpu', 'system.pid',
      'settings.apiKey', 'inputBar.navigate', 'inputBar.select', 'inputBar.close',
      'sidebar.resultFew', 'sidebar.results', 'graph.noteOne', 'graph.noteFew', 'graph.notes',
      'mcp.toolsOne', 'mcp.toolsFew', 'mcp.tools',
    ])
    const suspicious: string[] = []
    for (const key of referenceKeys) {
      if (allowedIdentical.has(key)) continue
      const values = langs.map((lang) => flat[lang][key])
      const latinOnly = (s: string) => !/[^\x00-\x7f]/.test(s)
      // Two different locales sharing the exact English word means one of them was skipped.
      if (values[1] === values[0] && latinOnly(values[0])) suspicious.push(`ru:${key}`)
      if (values[2] === values[0] && latinOnly(values[0])) suspicious.push(`zh:${key}`)
    }
    expect(suspicious).toEqual([])
  })
})

describe('command coverage', () => {
  it('gives every !command a translated description', () => {
    for (const lang of langs) {
      const missing = COMMANDS.map((c) => c.cmd.slice(1)).filter((key) => !flat[lang][`commands.${key}`])
      expect(missing, `commands missing in "${lang}"`).toEqual([])
    }
  })

  it('covers every dangerous command with a confirmation sentence', () => {
    for (const lang of langs) {
      const missing = ['shell', 'file', 'delete', 'write', 'rename', 'mkdir', 'open', 'shutdown', 'restart'].filter(
        (key) => !flat[lang][`danger.${key}`],
      )
      expect(missing, `danger.* missing in "${lang}"`).toEqual([])
    }
  })
})
