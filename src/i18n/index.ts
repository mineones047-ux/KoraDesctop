/**
 * Locale registry and lookup.
 *
 * `en` is the type source of truth: `satisfies Record<string, Translations>` makes the
 * compiler reject a `ru` object that is missing a key or has a mistyped one, which is the
 * only thing that keeps two hand-maintained translation files in sync.
 */
import en from './en'
import ru from './ru'
import zh from './zh'
import type { Translations } from './en'

export const locales = { en, ru, zh } satisfies Record<string, Translations>
export type Locale = keyof typeof locales

/**
 * Strings for a language, falling back to English for an unknown one.
 *
 * The fallback is why `Locale` is not validated at runtime: a stale `localStorage` value
 * from a removed language must render a usable UI rather than blank the app.
 */
export function getTranslations(lang: Locale): Translations {
  return locales[lang] || locales.en
}

/** The three count forms a noun can take across the supported locales. */
export type CountForm = 'one' | 'few' | 'many'

/**
 * Which count form a number takes in `lang`.
 *
 * Russian declines by the last digit *and* the last two (1 результат, 2 результата,
 * 5 результатов, 11 результатов), English only distinguishes exactly one, and Chinese
 * uses a classifier with no inflection, so every count takes the same form.
 */
export function countForm(lang: Locale, n: number): CountForm {
  if (lang === 'ru') {
    const tens = n % 10
    const hundreds = n % 100
    if (tens === 1 && hundreds !== 11) return 'one'
    if (tens >= 2 && tens <= 4 && (hundreds < 12 || hundreds > 14)) return 'few'
    return 'many'
  }
  if (lang === 'zh') return 'many'
  return n === 1 ? 'one' : 'many'
}

/** `"3 " + plural(lang, 3, { one, few, many })` — picks the form for the locale. */
export function plural(lang: Locale, n: number, forms: Record<CountForm, string>): string {
  return forms[countForm(lang, n)]
}

export { en, ru, zh }
export type { Translations as T }