import { describe, expect, it } from 'vitest'
import { groupChatId, groupChats, type GroupableChat } from '../chat-groups'

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime()
const at = (daysAgo: number, hour = 12) =>
  new Date(2026, 9, 23 - daysAgo, hour, 0, 0).getTime()

const chat = (id: string, updatedAt: number, pinned = false): GroupableChat & { id: string } => ({
  id,
  updatedAt,
  pinned,
})

describe('groupChatId', () => {
  it('buckets by calendar day, not by elapsed hours', () => {
    expect(groupChatId({ updatedAt: at(0, 1) }, NOW)).toBe('today')
    expect(groupChatId({ updatedAt: at(1, 23) }, NOW)).toBe('yesterday')
    expect(groupChatId({ updatedAt: at(3) }, NOW)).toBe('week')
    expect(groupChatId({ updatedAt: at(10) }, NOW)).toBe('older')
  })
})

describe('groupChats', () => {
  it('returns empty groups only when there is nothing to show', () => {
    expect(groupChats([], NOW)).toEqual([])
  })

  it('puts pinned chats first regardless of age', () => {
    const groups = groupChats(
      [chat('old', at(20)), chat('pinned', at(30), true), chat('new', at(0))],
      NOW,
    )
    expect(groups[0].id).toBe('pinned')
    expect(groups[0].chats.map((c) => c.id)).toEqual(['pinned'])
    expect(groups.map((g) => g.id)).toEqual(['pinned', 'today', 'older'])
  })

  it('orders chats newest-first inside each group', () => {
    const groups = groupChats([chat('a', at(0, 9)), chat('b', at(0, 14)), chat('c', at(0, 11))], NOW)
    expect(groups[0].chats.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('drops empty buckets instead of rendering a heading with no rows', () => {
    const groups = groupChats([chat('a', at(0)), chat('b', at(9))], NOW)
    expect(groups.map((g) => g.id)).toEqual(['today', 'older'])
  })

  it('keeps a chat with a broken timestamp instead of losing it', () => {
    const groups = groupChats([chat('broken', Number.NaN)], NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].id).toBe('older')
    expect(groups[0].chats[0].id).toBe('broken')
  })
})
