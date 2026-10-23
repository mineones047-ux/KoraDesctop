/**
 * Keyboard shortcuts — pure decision logic, so the vitest suite exercises
 * exactly what the window listener in `App.tsx` runs (the same convention as
 * `path-security.ts` and `electron/lib/*`: no DOM, no React, no copies).
 *
 * Design rules:
 * - `primary` is Ctrl on Windows/Linux and Cmd on macOS; both are accepted.
 * - Chords never fire with Alt held (Alt+key is a menu/system chord on Windows).
 *   Shift is ignored for ordinary chords so Shift+Ctrl+K stays free — it is bound
 *   separately to the sidebar filter, the one intentional shift-chord.
 * - Escape is claimed only when a layer is open, so components that own their
 *   own Escape behaviour (the input command dropdown, chat rename) keep working
 *   when nothing is stacked on top.
 */

/** The shortcut chords Kora binds. Add a variant here rather than a new key, to keep the
 *  surface small enough to remember and to avoid colliding with platform chords. */
export type ShortcutAction = 'newChat' | 'commandPalette' | 'focusChatSearch' | 'closeTopLayer'

/** The subset of `KeyboardEvent` the resolver needs (keeps it testable). */
export interface ShortcutEventLike {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** What the resolver needs to know beyond the event itself. */
export interface ShortcutContext {
  /** Number of stacked layers (modals/overlays); 0 means nothing is open. */
  openLayers: number
}

/**
 * Map a key event to an action, or `null` for "not ours".
 *
 * Returning `null` rather than a sentinel matters: the window listener in `App.tsx` must
 * tell "this keystroke is not handled" apart from "this closes the top layer" — and the
 * latter must not fire when nothing is stacked, or Escape would swallow the input
 * component's own Escape handling.
 */
export function resolveShortcut(
  event: ShortcutEventLike,
  context: ShortcutContext,
): ShortcutAction | null {
  const primary = Boolean(event.ctrlKey || event.metaKey)
  const key = event.key.toLowerCase()

  if (primary && !event.altKey && !event.shiftKey) {
    if (key === 'n') return 'newChat'
    // Ctrl/Cmd+K is the palette (search + actions + prompts). Shift+Ctrl/Cmd+K keeps
    // jumping straight to the sidebar filter for people used to the old chord.
    if (key === 'k') return 'commandPalette'
  }

  if (primary && event.shiftKey && !event.altKey && key === 'k') return 'focusChatSearch'

  if (event.key === 'Escape' && context.openLayers > 0) return 'closeTopLayer'

  return null
}
