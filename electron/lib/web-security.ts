// SSRF prevention for web:fetch.
// Pure module (no electron imports) so both the IPC layer and the vitest
// suite import the SAME implementation — tests must never copy this logic.
//
// Three layers of defence:
// 1. string-level host checks (fast path, also catches `host:port` oddities),
// 2. parsed IPv4/IPv6 range checks (incl. IPv4-mapped IPv6 like [::ffff:127.0.0.1]),
// 3. DNS pre-resolution (ssrf-guard.ts) — every address the hostname resolves
//    to must be public. The classic DNS-rebinding TOCTOU window between the
//    check and the request remains a documented residual risk.

// Legacy prefix list (kept byte-compatible with the original filter; the
// regexes are deliberately unanchored at the end).
const BLOCKED_FETCH_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc00|\[fd[0-9a-f]|\[fe80)/i

/**
 * Blocked IPv4 ranges: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT — router panels and
 * cloud-internal ranges), 127/8, 169.254/16 (link-local, cloud metadata),
 * 172.16/12, 192.168/16, 255.255.255.255, 224/4+ (multicast/reserved).
 */
export function isBlockedIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  const c = Number(m[3])
  const d = Number(m[4])
  if (a > 255 || b > 255 || c > 255 || d > 255) return false
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 255 && b === 255 && c === 255 && d === 255) return true
  if (a >= 224) return true
  return false
}

/** Convert two hex hextets (e.g. 7f00:1) to a dotted quad (127.0.0.1). */
function hextetsToIpv4(hi: string, lo: string): string {
  const h = parseInt(hi, 16)
  const l = parseInt(lo, 16)
  return [(h >> 8) & 255, h & 255, (l >> 8) & 255, l & 255].join('.')
}

/**
 * Blocked IPv6 forms (input WITHOUT brackets): unspecified `::`, loopback,
 * ULA fc00::/7, link-local fe80::/10, IPv4-mapped `::ffff:a.b.c.d` /
 * `::ffff:xxxx:xxxx`, and NAT64 `64:ff9b::/96` (embeds a public-or-not IPv4 —
 * checked through the same IPv4 rules).
 */
export function isBlockedIpv6(ip: string): boolean {
  const h = ip.split('%')[0].toLowerCase() // strip zone id
  if (h === '::' || h === '::1') return true
  if (/^f[cd]/.test(h)) return true // fc00::/7 ULA
  if (/^fe[89ab]/.test(h)) return true // fe80::/10 link-local
  // IPv4-mapped / translated
  const mappedDot = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h)
  if (mappedDot) return isBlockedIpv4(mappedDot[1])
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h)
  if (mappedHex) return isBlockedIpv4(hextetsToIpv4(mappedHex[1], mappedHex[2]))
  const nat64 = /^64:ff9b::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h)
  if (nat64) return isBlockedIpv4(hextetsToIpv4(nat64[1], nat64[2]))
  return false
}

/** True for a literal IP address (v4 dotted quad or v6 with/without brackets). */
export function isIpLiteral(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '')
  if (isBlockedIpv4(bare) || /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return true
  return bare.includes(':')
}

/**
 * Main host check used by web:fetch. Accepts whatever `new URL().hostname`
 * produces (bracketed IPv6, trailing dot) and preserves the legacy
 * string-prefix behaviour, including `localhost:3000`.
 */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.trim().replace(/\.$/, '') // `localhost.` == localhost
  if (!host) return true
  if (BLOCKED_FETCH_HOSTS.test(host)) return true
  const bare = host.replace(/^\[|\]$/g, '')
  if (bare.includes(':')) return isBlockedIpv6(bare)
  return isBlockedIpv4(bare)
}

/** Check for addresses returned by DNS resolution (brackets optional). */
export function isBlockedIpLiteral(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, '')
  if (!bare) return true
  if (bare.includes(':')) return isBlockedIpv6(bare)
  return isBlockedIpv4(bare)
}

export function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}

export type FetchTargetCheck = { ok: true; url: URL } | { ok: false; error: string }

/** Validate a user-supplied fetch target: parseable, http(s), public host. */
export function assertFetchTarget(raw: string): FetchTargetCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'Invalid URL' }
  }
  if (!isAllowedProtocol(url.protocol)) {
    return { ok: false, error: `Blocked protocol: ${url.protocol}` }
  }
  if (isBlockedHost(url.hostname)) {
    return { ok: false, error: 'Access to internal/private network addresses is blocked' }
  }
  return { ok: true, url }
}

/** Resolve a redirect Location against the current URL and re-validate it. */
export function resolveRedirect(base: string, location: string): FetchTargetCheck {
  let resolved: URL
  try {
    resolved = new URL(location, base)
  } catch {
    return { ok: false, error: 'Invalid redirect location' }
  }
  return assertFetchTarget(resolved.toString())
}
