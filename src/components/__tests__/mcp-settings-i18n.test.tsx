import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MCPSettings } from '../Settings/MCPSettings'

/**
 * The MCP panel used to carry its own EN/RU helper, so a Chinese UI showed English here.
 * Rendering it (effects never run server-side, so no `window.kora` is touched) proves the
 * strings come from the locale table rather than from a hardcoded pair.
 */
function render(lang: 'en' | 'ru' | 'zh'): string {
  return renderToStaticMarkup(<MCPSettings lang={lang} />)
}

describe('MCP settings panel locale rendering', () => {
  it('renders English', () => {
    const html = render('en')
    expect(html).toContain('MCP Servers')
    expect(html).toContain('Refresh')
    expect(html).toContain('No MCP servers configured')
  })

  it('renders Russian', () => {
    const html = render('ru')
    expect(html).toContain('MCP-серверы')
    expect(html).toContain('Обновить')
    expect(html).toContain('MCP-серверы не настроены')
    expect(html).not.toContain('Refresh')
  })

  it('renders Chinese instead of falling back to English', () => {
    const html = render('zh')
    expect(html).toContain('MCP 服务')
    expect(html).toContain('刷新')
    expect(html).toContain('还没有配置 MCP 服务')
    expect(html).not.toContain('Refresh')
    expect(html).not.toContain('MCP Servers')
  })
})
