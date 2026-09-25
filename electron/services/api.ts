/**
 * LLM gateway: HTTP + SSE access to every supported provider.
 *
 * Errors are classified into a FailoverReason and embedded as `[kora:<reason>]`
 * in the message — that marker is a cross-process contract parsed by
 * agent/guards.ts. fetchWithRetry retries only retryable reasons with jittered
 * backoff / Retry-After; auth, unknown model and context overflow fail fast.
 * SSE parsing always flushes the tail buffer (the last chunk is never lost) and
 * releases the reader lock.
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ── Error classification & retry (ported from Hermes error_classifier) ──

type FailoverReason =
  | 'rate_limit'
  | 'auth'
  | 'model_not_found'
  | 'context_overflow'
  | 'server_error'
  | 'network'
  | 'timeout'
  | 'unknown'

const CONTEXT_OVERFLOW_PATTERNS = [
  'context_length_exceeded',
  'maximum context length',
  'context window',
  'too many tokens',
  'input length exceeds',
  'reduce the length',
]

function classifyHttpError(status: number, body: string): FailoverReason {
  if (status === 429) return 'rate_limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) {
    // OpenAI-compatible servers return 404 for unknown model paths too
    return /model/i.test(body) ? 'model_not_found' : 'unknown'
  }
  const lower = body.toLowerCase()
  if (CONTEXT_OVERFLOW_PATTERNS.some((p) => lower.includes(p))) return 'context_overflow'
  if (status >= 500) return 'server_error'
  return 'unknown'
}

function classifyNetworkError(err: unknown): FailoverReason {
  const e = err as { name?: string; message?: string; code?: string }
  if (e?.name === 'AbortError') return 'timeout'
  const msg = `${e?.message ?? ''} ${e?.code ?? ''}`.toLowerCase()
  if (
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('epipe') ||
    msg.includes('ehostunreach') ||
    msg.includes('enetunreach') ||
    msg.includes('fetch failed') ||
    msg.includes('network')
  ) {
    return 'network'
  }
  if (msg.includes('timeout') || msg.includes('etimedout')) return 'timeout'
  if (msg.includes('certificate') || msg.includes('ssl')) return 'unknown' // fail fast like Hermes ssl_cert_verification
  return 'unknown'
}

function isRetryable(reason: FailoverReason): boolean {
  return reason === 'rate_limit' || reason === 'server_error' || reason === 'network' || reason === 'timeout'
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError('unknown', 'Aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new LlmError('unknown', 'Aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

class LlmError extends Error {
  reason: FailoverReason
  constructor(reason: FailoverReason, message: string) {
    super(`[kora:${reason}] ${message}`)
    this.reason = reason
  }
}

interface FetchResult {
  response: Response
  body?: string
}

/**
 * Fetch with classification-driven retries: rate_limit / server_error /
 * network / timeout are retried with jittered backoff honoring Retry-After;
 * auth / model_not_found / context_overflow fail fast.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<FetchResult> {
  let lastError: LlmError | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (init.signal?.aborted) throw new LlmError('unknown', 'Aborted')
    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err) {
      const reason = classifyNetworkError(err)
      lastError = new LlmError(reason, `Request failed: ${(err as Error).message}`)
      if (!isRetryable(reason) || attempt === maxRetries) throw lastError
      await sleep(Math.min(15000, 1000 * Math.pow(2, attempt)) * (0.7 + Math.random() * 0.6), init.signal)
      continue
    }

    if (response.ok) return { response }

    let body = ''
    try {
      body = (await response.text()).slice(0, 2048)
    } catch {
      body = ''
    }
    const reason = classifyHttpError(response.status, body)
    lastError = new LlmError(reason, `API error: ${response.status} - ${body.slice(0, 512)}`)
    if (!isRetryable(reason) || attempt === maxRetries) throw lastError

    let delay = Math.min(20000, 1000 * Math.pow(2, attempt)) * (0.7 + Math.random() * 0.6)
    const retryAfter = response.headers.get('retry-after')
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 120) delay = Math.max(delay, seconds * 1000)
    }
    await sleep(delay, init.signal)
  }
  throw lastError ?? new LlmError('unknown', 'Request failed')
}

function getHeaders(apiKey: string, provider: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (provider === 'anthropic') {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://kora.app'
    headers['X-Title'] = 'Kora'
  }

  return headers
}

function getModel(model: string, provider: string): string {
  if (provider === 'anthropic') return model || 'claude-3-5-sonnet-20241022'
  if (provider === 'openrouter') return model || 'openai/gpt-3.5-turbo'
  return model || 'gpt-3.5-turbo'
}

/**
 * True when the server rejected the request because of the `response_format`
 * parameter (unknown parameter / unsupported json mode). Such a rejection is
 * safe to retry once without jsonMode; auth / model / context errors are
 * never treated as json-mode rejections even if the body happens to mention
 * the word (they fail fast by design).
 */
export function isJsonModeRejected(err: unknown): boolean {
  const msg = (err as Error)?.message ?? ''
  if (/\[kora:(auth|model_not_found|context_overflow)\]/.test(msg)) return false
  return /response_format|json_object|json mode|json format/i.test(msg)
}

export function buildBody(
  messages: ChatMessage[],
  model: string,
  provider: string,
  stream: boolean,
  temperature?: number,
  jsonMode = false,
): object {
  if (provider === 'anthropic') {
    // Anthropic has no `response_format` parameter — for it, JSON output is
    // enforced by the prompt alone (the corrective-retry path still applies).
    const systemMsg = messages.find((m) => m.role === 'system')
    const chatMsgs = messages.filter((m) => m.role !== 'system')
    // Anthropic requires max_tokens. Its API does not support an unlimited response,
    // so request its documented maximum and let the provider enforce the real model limit.
    return {
      model,
      max_tokens: 64000,
      system: systemMsg?.content || '',
      messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
      stream,
    }
  }

  // OpenAI-compatible providers apply their own model limit when max_tokens is omitted.
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: temperature ?? 0.7,
    stream,
  }
  // ROADMAP Phase 0 "structured output": server-side JSON constraint for agent
  // decision calls — removes whole corrective-retry LLM passes. Providers that
  // do not know the parameter are retried once without it (isJsonModeRejected).
  if (jsonMode) body.response_format = { type: 'json_object' }
  return body
}

function getEndpoint(baseUrl: string, provider: string): string {
  if (provider === 'anthropic') return `${baseUrl}/v1/messages`
  return `${baseUrl}/v1/chat/completions`
}

function getModelsEndpoint(baseUrl: string, provider: string): string {
  if (provider === 'anthropic') return ''
  return `${baseUrl}/v1/models`
}

async function* streamReader(reader: ReadableStreamDefaultReader<Uint8Array>, provider: string) {
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data: ')) continue
        const data = trimmed.slice(6)
        if (data === '[DONE]') return

        try {
          const parsed = JSON.parse(data)
          if (provider === 'anthropic') {
            if (parsed.type === 'content_block_delta') {
              yield parsed.delta?.text || ''
            } else if (parsed.type === 'error') {
              throw new LlmError('server_error', `Anthropic stream error: ${parsed.error?.message ?? 'unknown'}`)
            }
          } else {
            yield parsed.choices?.[0]?.delta?.content || ''
          }
        } catch (err) {
          // Rethrow LlmError (stream error events); skip malformed JSON chunks
          if (err instanceof LlmError) throw err
        }
      }
    }

    // Flush the trailing buffer: some servers end the stream without a final newline
    buffer += decoder.decode()
    const tail = buffer.trim()
    if (tail.startsWith('data: ') && tail.slice(6) !== '[DONE]') {
      try {
        const parsed = JSON.parse(tail.slice(6))
        const text = provider === 'anthropic'
          ? (parsed.type === 'content_block_delta' ? parsed.delta?.text || '' : '')
          : parsed.choices?.[0]?.delta?.content || ''
        if (text) yield text
      } catch {
        // ignore malformed tail
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // already released
    }
  }
}

export class APIClient {
  static async chat(
    messages: ChatMessage[],
    apiKey: string,
    baseUrl: string,
    model: string,
    provider: string,
    temperature?: number,
    jsonMode?: boolean,
  ): Promise<string> {
    if (!apiKey && provider !== 'lmstudio' && provider !== 'ollama' && provider !== 'llamacpp') throw new Error('API key is required')

    const endpoint = getEndpoint(baseUrl, provider)
    const finalModel = getModel(model, provider)

    const doFetch = (useJson: boolean) =>
      fetchWithRetry(endpoint, {
        method: 'POST',
        headers: getHeaders(apiKey, provider),
        body: JSON.stringify(buildBody(messages, finalModel, provider, false, temperature, useJson)),
      })

    let response: FetchResult
    try {
      response = await doFetch(jsonMode === true)
    } catch (err) {
      if (!jsonMode || !isJsonModeRejected(err)) throw err
      response = await doFetch(false)
    }
    if (response.body === undefined) {
      // unreachable: fetchWithRetry returns only on ok
      throw new LlmError('unknown', 'No response')
    }

    const data: any = await response.response.json()

    if (provider === 'anthropic') {
      const text = data.content?.[0]?.text
      if (typeof text !== 'string') {
        throw new LlmError('server_error', `Unexpected API response shape: ${JSON.stringify(data).slice(0, 300)}`)
      }
      return text
    }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      throw new LlmError('server_error', `Unexpected API response shape: ${JSON.stringify(data).slice(0, 300)}`)
    }
    return content
  }

  static async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    apiKey: string,
    baseUrl: string,
    model: string,
    provider: string,
    temperature?: number,
    signal?: AbortSignal,
    jsonMode?: boolean,
  ): Promise<void> {
    if (!apiKey && provider !== 'lmstudio' && provider !== 'ollama' && provider !== 'llamacpp') throw new Error('API key is required')

    const endpoint = getEndpoint(baseUrl, provider)
    const finalModel = getModel(model, provider)

    const doFetch = (useJson: boolean) =>
      fetchWithRetry(endpoint, {
        method: 'POST',
        headers: getHeaders(apiKey, provider),
        body: JSON.stringify(buildBody(messages, finalModel, provider, true, temperature, useJson)),
        signal,
      })

    let response: FetchResult
    try {
      response = await doFetch(jsonMode === true)
    } catch (err) {
      if (!jsonMode || !isJsonModeRejected(err)) throw err
      response = await doFetch(false)
    }

    const reader = response.response.body?.getReader()
    if (!reader) throw new Error('No response body')

    try {
      for await (const chunk of streamReader(reader, provider)) {
        if (chunk) onChunk(chunk)
      }
    } catch (err) {
      // User-initiated abort is a normal way to end a stream
      if (signal?.aborted || (err as Error)?.name === 'AbortError') return
      throw err
    }
  }

  static async listModels(
    baseUrl: string,
    apiKey: string,
    provider: string
  ): Promise<string[]> {
    if (provider === 'anthropic') {
      return ['claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']
    }

    const endpoint = getModelsEndpoint(baseUrl, provider)
    if (!endpoint) return []

    try {
      const response = await fetch(endpoint, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) return []
      const data: any = await response.json()
      return data.data?.map((m: any) => m.id) || []
    } catch {
      return []
    }
  }

  static async testConnection(
    apiKey: string,
    baseUrl: string,
    provider: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!apiKey && provider !== 'lmstudio' && provider !== 'ollama' && provider !== 'llamacpp') {
      return { success: false, error: 'No API key provided' }
    }

    if (provider === 'anthropic') {
      try {
        const response = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: getHeaders(apiKey, provider),
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'hi' }],
          }),
          signal: AbortSignal.timeout(10000),
        })
        return response.ok
          ? { success: true }
          : { success: false, error: `HTTP ${response.status}` }
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }

    try {
      const response = await fetch(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      })
      if (response.ok) return { success: true }
      return { success: false, error: `HTTP ${response.status}` }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }
}