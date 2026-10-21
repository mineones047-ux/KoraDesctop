import { ipcMain } from 'electron'
import { guardedFetch } from '../lib/ssrf-guard'
import dns from 'dns/promises'

interface SearchResult {
  title: string
  url: string
  snippet: string
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const MAX_FETCH_BYTES = 5 * 1024 * 1024

/**
 * Read a response body, stopping at `MAX_FETCH_BYTES`.
 *
 * The byte count is enforced while streaming rather than from `Content-Length`, because
 * that header is attacker-controlled: it can lie, or be absent on a chunked response. On
 * overflow we return what we already have rather than erroring, so a large page still
 * yields usable text.
 */
async function readBodyWithLimit(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_FETCH_BYTES) {
      await reader.cancel()
      return Buffer.concat(chunks).toString('utf-8')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/**
 * Web access for the agent: keyword search and single-page fetch.
 *
 * `web:fetch` is the dangerous one — a URL chosen by the model is an SSRF vector into
 * whatever the machine can reach, so it goes through `guardedFetch` rather than `fetch`.
 * `web:search` only ever hits a hardcoded DuckDuckGo endpoint, so it needs no guard.
 *
 * Failures are returned as data (`{title: 'Search failed', ...}`) rather than thrown: the
 * agent can report "the web was unreachable" far better than it can report an IPC error.
 */
export function registerWebHandlers() {
  ipcMain.handle('web:search', async (_event, query: string): Promise<SearchResult[]> => {
    try {
      const encoded = encodeURIComponent(query)
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15000),
      })

      if (!response.ok) {
        return [{ title: 'Search failed', url: '', snippet: `HTTP ${response.status}: ${response.statusText}` }]
      }

      const html = await readBodyWithLimit(response)
      return parseDuckDuckGoResults(html)
    } catch (error) {
      const msg = (error as Error).message
      return [{ title: 'Search error', url: '', snippet: msg }]
    }
  })

  // Also fetch a single page to get readable content
  ipcMain.handle('web:fetch', async (_event, pageUrl: string): Promise<{ success: boolean; content?: string; error?: string }> => {
    try {
      // SSRF-guarded fetch (security review 2026-09-25): every redirect hop is
      // re-validated (protocol + host) and the hostname's DNS answers must all
      // be public addresses before the request leaves the machine.
      const lookupImpl = async (hostname: string): Promise<string[]> => {
        const addrs = await dns.lookup(hostname, { all: true })
        return addrs.map((a) => a.address)
      }
      const { response } = await guardedFetch(
        pageUrl,
        { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) },
        { fetchImpl: fetch, lookupImpl },
      )
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` }
      }
      const text = await readBodyWithLimit(response)
      // Strip HTML tags and return plain text (up to 5000 chars)
      const plain = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000)
      return { success: true, content: plain }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}

/**
 * Pull titles/URLs/snippets out of DuckDuckGo's HTML endpoint.
 *
 * Regex rather than a DOM parser: this is the `html.duckduckgo.com` lite markup, the
 * result cap is 8, and a parser dependency would outweigh the benefit. The fallback
 * branch exists because DDG changes its class names without notice — when the strict
 * pattern matches nothing we degrade to titles-only instead of returning nothing.
 */
function parseDuckDuckGoResults(html: string): SearchResult[] {
  const results: SearchResult[] = []
  let match: RegExpExecArray | null

  const blockRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi

  while ((match = blockRegex.exec(html)) !== null && results.length < 8) {
    const rawUrl = match[1]
    const title = match[2].replace(/<[^>]+>/g, '').trim()
    const snippet = match[3].replace(/<[^>]+>/g, '').trim()

    // Extract real URL from DuckDuckGo redirect
    const urlMatch = rawUrl.match(/uddg=([^&]+)/)
    const url = urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl

    if (title && url && !url.includes('duckduckgo.com')) {
      results.push({ title, url, snippet })
    }
  }

  // Fallback: try simpler parsing if regex failed
  if (results.length === 0) {
    const fallbackRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
    while ((match = fallbackRegex.exec(html)) !== null && results.length < 5) {
      const title = match[1].replace(/<[^>]+>/g, '').trim()
      if (title) {
        results.push({ title, url: '', snippet: '' })
      }
    }
  }

  return results.slice(0, 8)
}
