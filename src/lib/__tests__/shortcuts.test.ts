import { describe, it, expect } from 'vitest'
import { resolveShortcut, type ShortcutContext } from '../shortcuts'

const NOTHING_OPEN: ShortcutContext = { openLayers: 0 }
const MODAL_OPEN: ShortcutContext = { openLayers: 1 }

describe('resolveShortcut', () => {
  it('maps Ctrl+N and Cmd+N to a new chat', () => {
    expect(resolveShortcut({ key: 'n', ctrlKey: true }, NOTHING_OPEN)).toBe('newChat')
    expect(resolveShortcut({ key: 'N', ctrlKey: true }, NOTHING_OPEN)).toBe('newChat')
    expect(resolveShortcut({ key: 'n', metaKey: true }, NOTHING_OPEN)).toBe('newChat')
  })

  it('maps Ctrl+K and Cmd+K to focusing the chat search', () => {
    expect(resolveShortcut({ key: 'k', ctrlKey: true }, NOTHING_OPEN)).toBe('focusChatSearch')
    expect(resolveShortcut({ key: 'k', metaKey: true }, NOTHING_OPEN)).toBe('focusChatSearch')
  })

  it('ignores plain typing so the composer keeps every letter', () => {
    expect(resolveShortcut({ key: 'n' }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'k' }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'Escape' }, NOTHING_OPEN)).toBeNull()
  })

  it('does not steal Alt or Shift chords', () => {
    expect(resolveShortcut({ key: 'n', ctrlKey: true, altKey: true }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'n', ctrlKey: true, shiftKey: true }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'k', ctrlKey: true, shiftKey: true }, NOTHING_OPEN)).toBeNull()
  })

  it('closes the top layer on Escape only while something is open', () => {
    expect(resolveShortcut({ key: 'Escape' }, MODAL_OPEN)).toBe('closeTopLayer')
    expect(resolveShortcut({ key: 'Escape' }, { openLayers: 3 })).toBe('closeTopLayer')
    // Nothing open -> the component that owns Escape keeps it.
    expect(resolveShortcut({ key: 'Escape' }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'Escape', ctrlKey: true }, MODAL_OPEN)).toBe('closeTopLayer')
  })

  it('returns null for unknown chords', () => {
    expect(resolveShortcut({ key: 'p', ctrlKey: true }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'Enter', ctrlKey: true }, NOTHING_OPEN)).toBeNull()
    expect(resolveShortcut({ key: 'n', ctrlKey: true, altKey: false, shiftKey: false }, NOTHING_OPEN)).toBe('newChat')
  })
})
