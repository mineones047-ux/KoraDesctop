/**
 * SSRF-guarded fetch with manual redirect handling.
 *
 * Why this exists (security review 2026-09-25): `fetch()` follows redirects by
 * itself, so a public URL answering `302 -> http://169.254.169.254/...` walked
 * straight past the host check. Every hop here is re-validated — protocol,
 * hostname, AND the addresses the hostname resolves to — before the request
 * leaves the machine. Pure module: the fetcher and the resolver are injected,
 * so the vitest suite exercises the real code with stubbed transports.
 */
import { assertFetchTarget, resolveRedirect, isBlockedIpLiteral, isIpLiteral } from './web-security'

export const MAX_REDIRECT_HOPS = 5

export interface SsrfGuardDeps {
  /** One HTTP GET-like call (must NOT follow redirects itself). */
  fetchImpl: typeof fetch
  /** Resolve a hostname to every address it currently points at. */
  lookupImpl: (hostname: string) => Promise<string[]>
}

export interface GuardedFetchResult {
  response: Response
  finalUrl: string
}

/**
 * Reject a hostname whose DNS answers point anywhere private.
 *
 * Fails **closed**: a resolution error means the request does not go out. The safe
 * default for an unresolvable name is refusal — the alternative would let an attacker
 * suppress DNS and reach the target by IP.
 */
async function assertPublicResolution(hostname: string, deps: SsrfGuardDeps): Promise<void> {
  // Literal IPs were already validated by assertFetchTarget — no DNS needed.
  if (isIpLiteral(hostname)) return
  let addrs: string[]
  try {
    addrs = await deps.lookupImpl(hostname)
  } catch {
    // Fail closed: if we cannot see the addresses, the request does not go out.
    throw new Error(`DNS resolution failed for ${hostname}`)
  }
  if (!addrs.length) throw new Error(`DNS resolution failed for ${hostname}`)
  for (const addr of addrs) {
    if (isBlockedIpLiteral(addr)) {
      throw new Error('Access to internal/private network addresses is blocked (DNS resolution)')
    }
  }
}

/**
 * Fetch a URL, re-checking every redirect hop.
 *
 * `redirect: 'manual'` is the whole point: the native redirect following would skip our
 * checks entirely, so a public URL answering `302 → 169.254.169.254` would walk straight
 * past the host validation. Each hop is re-validated against protocol, hostname **and**
 * resolved addresses, up to `MAX_REDIRECT_HOPS`.
 */
export async function guardedFetch(
  rawUrl: string,
  init: RequestInit,
  deps: SsrfGuardDeps,
): Promise<GuardedFetchResult> {
  let current = rawUrl
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const check = assertFetchTarget(current)
    if (!check.ok) throw new Error(check.error)
    await assertPublicResolution(check.url.hostname, deps)

    const response = await deps.fetchImpl(check.url.toString(), { ...init, redirect: 'manual' })

    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        await response.body?.cancel()
      } catch {
        // body may already be consumed/locked — nothing to release
      }
      const next = resolveRedirect(check.url.toString(), location)
      if (!next.ok) throw new Error(next.error)
      current = next.url.toString()
      continue
    }
    return { response, finalUrl: check.url.toString() }
  }
  throw new Error(`Too many redirects (max ${MAX_REDIRECT_HOPS})`)
}