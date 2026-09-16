import en from './en'
import ru from './ru'
import type { Translations } from './en'

export const locales = { en, ru } satisfies Record<string, Translations>
export type Locale = keyof typeof locales

export function getTranslations(lang: Locale): Translations {
  return locales[lang] || locales.en
}

export { en, ru }
export type { Translations as T }