import { useMemo } from 'react'
import { getTranslations, type Locale } from '../i18n'
import type { T } from '../i18n/en'

export function useI18n(lang: Locale = 'en'): T {
  return useMemo(() => getTranslations(lang), [lang])
}