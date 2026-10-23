/**
 * Sidebar grouping — pure, so the vitest suite covers exactly what the sidebar renders.
 *
 * Pinned chats always come first in their own group. The rest are bucketed by the day
 * they were last touched, which is the cheapest way to make a long history scannable:
 * "today / yesterday / this week / older" matches how people remember conversations.
 */

export type ChatGroupId = 'pinned' | 'today' | 'yesterday' | 'week' | 'older'

export interface ChatGroup<T> {
  id: ChatGroupId
  chats: T[]
}

/** The minimum a chat needs for grouping (keeps the helper usable from tests). */
export interface GroupableChat {
  pinned?: boolean
  updatedAt: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Midnight of the day `timestamp` falls on, in local time. */
function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Which bucket a chat belongs to.
 *
 * `now` is injectable so tests do not depend on the wall clock. The boundaries are
 * calendar-day based, not "24h ago", because a chat from 23:50 yesterday reads as
 * "yesterday" to a person even when only ten minutes have passed.
 */
export function groupChatId(chat: GroupableChat, now = Date.now()): Exclude<ChatGroupId, 'pinned'> {
  if (chat.pinned) return 'today' // unreachable when callers separate pinned first
  const today = startOfDay(now)
  const day = startOfDay(chat.updatedAt)
  if (day >= today) return 'today'
  if (day >= today - DAY_MS) return 'yesterday'
  if (day >= today - 7 * DAY_MS) return 'week'
  return 'older'
}

/**
 * Group chats for the sidebar: pinned first, then newest-first buckets.
 *
 * Empty groups are dropped so the sidebar never renders a heading with nothing under it.
 * Chats with an invalid timestamp are treated as "older" rather than thrown away —
 * losing a conversation because its date is corrupt would be worse than misplacing it.
 */
export function groupChats<T extends GroupableChat>(chats: T[], now = Date.now()): ChatGroup<T>[] {
  const pinned: T[] = []
  const buckets: Record<Exclude<ChatGroupId, 'pinned'>, T[]> = {
    today: [],
    yesterday: [],
    week: [],
    older: [],
  }

  for (const chat of chats) {
    if (chat.pinned) {
      pinned.push(chat)
      continue
    }
    const timestamp = Number.isFinite(chat.updatedAt) ? chat.updatedAt : 0
    buckets[groupChatId({ ...chat, updatedAt: timestamp }, now)].push(chat)
  }

  const byNewest = (a: T, b: T) => (b.updatedAt || 0) - (a.updatedAt || 0)
  pinned.sort(byNewest)

  const groups: ChatGroup<T>[] = []
  if (pinned.length > 0) groups.push({ id: 'pinned', chats: pinned })
  for (const id of ['today', 'yesterday', 'week', 'older'] as const) {
    if (buckets[id].length > 0) {
      buckets[id].sort(byNewest)
      groups.push({ id, chats: buckets[id] })
    }
  }
  return groups
}
