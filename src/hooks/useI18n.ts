import { useMemo } from 'react'
import { getTranslations, type Locale } from '../i18n'
import type { T } from '../i18n/en'

/**
 * Translation table for the active language.
 *
 * Returns a flat key→string object, so components call `t('settings.title')` with no
 * import of the locale. Memoised because it is recomputed on every render otherwise and
 * returning a fresh object would break every `useMemo`/`useEffect` that depends on it.
 */
export function useI18n(lang: Locale = 'en'): T {
  return useMemo(() => getTranslations(lang), [lang])
}