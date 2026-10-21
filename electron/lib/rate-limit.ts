/**
 * Sliding-window request limiter for the LLM gateway (security review
 * 2026-09-25 — closes "Rate limiting on LLM calls" from SECURITY_FIXES.md and
 * PROJECT_HANDOFF §13). A prompt-injected or looping agent can burn paid API
 * credits at full speed; the limiter caps the *start rate* so a runaway cycle
 * degrades into retryable `rate_limit` errors that the existing backoff in
 * fetchWithRetry already understands.
 *
 * Pure module: the clock is injectable so tests drive time deterministically.
 */
export class RateLimiter {
  private stamps: number[] = []

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Try to consume one slot; false = the caller must back off. */
  tryAcquire(): boolean {
    const t = this.now()
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs)
    if (this.stamps.length >= this.max) return false
    this.stamps.push(t)
    return true
  }

  /** Slots left in the current window (diagnostics). */
  get remaining(): number {
    const t = this.now()
    this.stamps = this.stamps.filter((s) => t - s < this.windowMs)
    return Math.max(0, this.max - this.stamps.length)
  }
}