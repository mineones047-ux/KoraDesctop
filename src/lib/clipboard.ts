/**
 * Copy text to the system clipboard.
 *
 * Order matters: the Electron bridge (`window.kora.clipboard.write`, declared in
 * `types/index.ts`) writes through the main process and works in the sandboxed
 * renderer; the Web API is the fallback so the UI also behaves in a plain
 * browser preview (`vite preview`). Failure is reported instead of thrown —
 * a copy button must never break the message list.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof text !== 'string' || text.length === 0) return false

  try {
    const bridge = typeof window !== 'undefined' ? window.kora?.clipboard : undefined
    if (bridge?.write) {
      const result = await bridge.write(text)
      if (result?.success) return true
    }
  } catch {
    // Fall through to the Web API.
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Give up silently: the user can still select the text manually.
  }

  return false
}
