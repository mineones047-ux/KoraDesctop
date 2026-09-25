/**
 * Renderer-side configuration.
 *
 * Only the limits actually consumed by the renderer live here. The Electron
 * main process defines its own constants (it compiles from electron/ and cannot
 * import from src/), so unused values duplicated here would just become a
 * second, misleading source of truth.
 */

export const CONFIG = {
  // Agent limits
  agent: {
    MAX_STEPS: 15,
    // Token budget for the history the agent sends per decision call
    // (ROADMAP Phase 0 "token budget + summarisation for memory").
    HISTORY_TOKEN_BUDGET: 8000,
    // Oldest entries beyond the budget are summarised once per cycle into a
    // compact note; a summarisation failure must never block the cycle.
    SUMMARIZE_INPUT_CAP: 8000,
  },

  // Stream limits
  stream: {
    TIMEOUT_MS: 120000,
    // Token updates arrive far faster than the screen can use them. Coalesce
    // state updates so the renderer paints at most once per interval instead of
    // re-rendering (and re-parsing markdown) on every single token.
    RENDER_INTERVAL_MS: 60,
  },

  // Chat
  chat: {
    SAVE_DEBOUNCE_MS: 300,
    MAX_TITLE_LENGTH: 50,
  },
} as const
