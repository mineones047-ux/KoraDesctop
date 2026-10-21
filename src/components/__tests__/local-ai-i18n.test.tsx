import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { LocalModels } from '../Settings/LocalModels'
import { locales } from '../../i18n'
import type { Locale } from '../../i18n'

/**
 * The Local AI tab talks to `window.kora.localAI` only inside effects and
 * handlers, so it must render (and localise) cleanly with none of that present.
 */
describe('LocalModels i18n', () => {
  it('renders the tab in every locale without throwing', () => {
    const expectedTitle: Record<Locale, string> = {
      en: 'Local models',
      ru: 'Локальные модели',
      zh: '本地模型',
    }
    const expectedEngine: Record<Locale, string> = {
      en: 'llama.cpp engine',
      ru: 'Движок llama.cpp',
      zh: 'llama.cpp 引擎',
    }
    for (const lang of Object.keys(locales) as Locale[]) {
      const html = renderToStaticMarkup(
        createElement(LocalModels, { lang, onUpdate: () => {} }),
      )
      expect(html, `render in "${lang}"`).toContain(expectedTitle[lang])
      expect(html, `engine block in "${lang}"`).toContain(expectedEngine[lang])
      // The empty-downloads hint must be localised too, not an EN leftover.
      expect(html).toContain(locales[lang].localAI.noModels)
      expect(html).toContain(locales[lang].localAI.engineInstall)
    }
  })
})
