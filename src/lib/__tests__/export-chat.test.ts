import { describe, expect, it } from 'vitest'
import { buildChatMarkdown, exportFileName, formatExportDate } from '../export-chat'
import type { Chat } from '../../types'

const chat: Chat = {
  id: 'chat-1',
  title: 'Regex help',
  createdAt: new Date(2026, 9, 20, 10, 30).getTime(),
  updatedAt: new Date(2026, 9, 20, 10, 45).getTime(),
  messages: [
    { id: 'm1', role: 'user', content: 'How do I match an email?', timestamp: new Date(2026, 9, 20, 10, 31).getTime() },
    { id: 'm2', role: 'assistant', content: '```ts\n/[^@]+@[^@]+/\n```', timestamp: new Date(2026, 9, 20, 10, 32).getTime() },
  ],
}

describe('buildChatMarkdown', () => {
  it('writes a heading, localized role labels and the message bodies verbatim', () => {
    const markdown = buildChatMarkdown(chat, { assistantName: 'Kora', userLabel: 'You', now: chat.updatedAt })
    expect(markdown.startsWith('# Regex help')).toBe(true)
    expect(markdown).toContain('## You · 2026-10-20 10:31')
    expect(markdown).toContain('## Kora · 2026-10-20 10:32')
    expect(markdown).toContain('```ts\n/[^@]+@[^@]+/\n```')
    expect(markdown).toContain('_Exported from Kora')
  })

  it('marks empty messages instead of writing an empty section', () => {
    const markdown = buildChatMarkdown(
      { ...chat, messages: [{ id: 'm1', role: 'assistant', content: '   ', timestamp: 0 }] },
      {},
    )
    expect(markdown).toContain('_(empty)_')
  })

  it('falls back to a generic title', () => {
    expect(buildChatMarkdown({ ...chat, title: '' }, {}).startsWith('# Chat')).toBe(true)
  })
})

describe('exportFileName', () => {
  it('slugifies the title and appends .md', () => {
    expect(exportFileName('Regex: help / please?')).toBe('regex-help-please.md')
    expect(exportFileName('   ')).toBe('chat.md')
    expect(exportFileName('../../etc/passwd')).toBe('etcpasswd.md')
  })
})

describe('formatExportDate', () => {
  it('uses a stable local timestamp and tolerates invalid dates', () => {
    expect(formatExportDate(new Date(2026, 0, 5, 9, 4).getTime())).toBe('2026-01-05 09:04')
    expect(formatExportDate(Number.NaN)).toBe('')
  })
})
