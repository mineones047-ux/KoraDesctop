// SSRF prevention for web:fetch.
// Pure module (no electron imports) so both the IPC layer and the vitest
// suite import the SAME implementation — tests must never copy this logic.

const BLOCKED_FETCH_HOSTS = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc00|\[fd[0-9a-f]|\[fe80)/i

export function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_FETCH_HOSTS.test(hostname)) return true
  // 172.16.0.0/12 range needs an explicit check
  const m = hostname.match(/^172\.(\d+)\./)
  if (m) {
    const second = parseInt(m[1], 10)
    return second >= 16 && second <= 31
  }
  return false
}

export function isAllowedProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:'
}
