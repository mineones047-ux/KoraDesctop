/**
 * kora-rpc/1 — the wire protocol between a shell (Electron today, Tauri/CLI
 * tomorrow) and the Kora core. See docs/CORE_RPC.md: this module implements the
 * contract exactly as specified there.
 *
 * Transport: newline-delimited JSON-RPC 2.0 over stdio. Pure module — no
 * Electron, no Node built-ins — so vitest and the future Rust core share the
 * same message shapes.
 *
 * Frozen contract (docs/CORE_RPC.md §4): the LLM failure reason inside
 * `data.koraReason` keeps the exact values of the current marker
 * `[kora:<reason>]` (`rate_limit`, `auth`, `model_not_found`, `context_overflow`,
 * `server_error`, `network`, `timeout`, `unknown`).
 */

// ── Protocol identity ──

/** The protocol version string, pinned in both implementations and in docs/CORE_RPC.md. */
export const PROTOCOL_VERSION = 'kora-rpc/1'

/**
 * Capability groups declared in `core.hello` (docs/CORE_RPC.md §6). A shell
 * that omits a group cannot call methods of that group (error -32003 denied).
 */
export const CORE_CAPABILITIES = [
  'fs',
  'shell',
  'system',
  'ai',
  'config',
  'chats',
  'tts',
  'web',
  'mcp',
  'agent',
  'obsidian',
] as const

export type Capability = (typeof CORE_CAPABILITIES)[number]

/** The core's own version — reported in `core.hello` so a shell can check compatibility. */
export const CORE_VERSION = '2.0.0-alpha.1'

// ── JSON-RPC 2.0 messages ──

export interface RpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  /** Positional array (ported methods) or named object (new methods). */
  params?: unknown[] | Record<string, unknown>
}

export interface RpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export interface RpcSuccess {
  jsonrpc: '2.0'
  id: number
  result: unknown
}

export interface RpcErrorObject {
  code: number
  message: string
  data?: Record<string, unknown>
}

export interface RpcFailure {
  jsonrpc: '2.0'
  id: number | null
  error: RpcErrorObject
}

export type RpcResponse = RpcSuccess | RpcFailure

// ── Error codes (docs/CORE_RPC.md §4) ──

/** The error-code table, pinned identically in `crates/kora-rpc`. */
export const ErrorCodes = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  koraError: -32001,
  notInitialized: -32002,
  denied: -32003,
  timeout: -32004,
  llmError: -32010,
} as const

/**
 * The LLM failure reasons — frozen byte-for-byte with the `[kora:<reason>]`
 * marker parsed by `src/agent/guards.ts` and produced by
 * `electron/services/api.ts`.
 */
export const KORA_REASONS = [
  'rate_limit',
  'auth',
  'model_not_found',
  'context_overflow',
  'server_error',
  'network',
  'timeout',
  'unknown',
] as const

export type KoraReason = (typeof KORA_REASONS)[number]

/** Narrowing guard: is this value one of the eight frozen reasons? */
export function isKoraReason(v: unknown): v is KoraReason {
  return typeof v === 'string' && (KORA_REASONS as readonly string[]).includes(v)
}

/** Render the legacy `[kora:<reason>]` marker into a message text. */
export function withKoraMarker(reason: KoraReason, message: string): string {
  return `[kora:${reason}] ${message}`
}

// ── Framing: newline-delimited JSON ──

/** Serialise one protocol message (one line, no pretty-printing). */
export function frame(message: RpcRequest | RpcNotification | RpcResponse | RpcNotification): string {
  return JSON.stringify(message) + '\n'
}

/** One parsed frame result. */
export type ParsedFrame =
  | { ok: true; message: Record<string, unknown> }
  | { ok: false; error: 'parse' | 'not-an-object' }

/** Parse one line of protocol input. Never throws. */
/** Parse one line of protocol input. Never throws. */
export function parseFrame(line: string): ParsedFrame {
  const trimmed = line.trim()
  if (!trimmed) return { ok: false, error: 'parse' }
  try {
    const message: unknown = JSON.parse(trimmed)
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { ok: false, error: 'not-an-object' }
    }
    return { ok: true, message: message as Record<string, unknown> }
  } catch {
    return { ok: false, error: 'parse' }
  }
}

/** Build a protocol error response. `id` is null when the request id is unknown. */
/** Build a protocol error response. `id` is null when the request id is unknown. */
export function errorResponse(
  id: number | null,
  code: number,
  message: string,
  data?: Record<string, unknown>,
): RpcFailure {
  const error: RpcErrorObject = { code, message }
  if (data) error.data = data
  return { jsonrpc: '2.0', id, error }
}
