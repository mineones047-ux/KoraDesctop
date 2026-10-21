/**
 * kora-rpc/1 dispatcher — the core side of the boundary (docs/CORE_RPC.md §3, §5, §6).
 *
 * Responsibilities:
 *   * handshake: every request before a successful `core.hello` → -32002;
 *   * routing: method → handler, missing method → -32601;
 *   * capability enforcement: a method of a group the shell did not
 *     declare gets -32003 denied — the clean separation the audit asked for;
 *   * error capture: a throwing handler becomes a JSON-RPC error, never a
 *     crash of the core loop.
 *
 * Pure module: handlers are injected, transports (stdio/loopback) live in the
 * runner. Handler errors map to `-32001 kora_error` with `data.detail`.
 */
import {
  CORE_CAPABILITIES,
  CORE_VERSION,
  PROTOCOL_VERSION,
  ErrorCodes,
  errorResponse,
  type Capability,
  type RpcRequest,
  type RpcResponse,
} from './protocol'

export type RpcHandler = (params: unknown[] | Record<string, unknown> | undefined) => Promise<unknown> | unknown

export interface MethodSpec {
  /** Capability group this method belongs to (see docs/CORE_RPC.md §5 table). */
  capability: Capability
  handler: RpcHandler
}

/** Method name → spec. Built by `createMethodTable()`. */
export type MethodTable = Map<string, MethodSpec>

export interface HelloResult {
  coreVersion: string
  protocol: string
  capabilities: readonly string[]
  dataDir: string
}

export interface DispatchState {
  /** Set once `core.hello` succeeds; every earlier request is -32002. */
  initialized: boolean
  /** Capability groups the shell declared in `core.hello`. */
  granted: Set<Capability>
  dataDir: string
}

export interface DispatchOptions {
  methods: MethodTable
  /** `~/.kora` equivalent; reported in `core.hello` result. */
  dataDir?: string
  /** Override for tests / embedders. Default: all declared capabilities. */
  coreCapabilities?: readonly Capability[]
}

export function createDispatchState(dataDir: string): DispatchState {
  return { initialized: false, granted: new Set(), dataDir }
}

/**
 * Extract the capability prefix of a method name: `"fs.readFile"` → `"fs"`,
 * `"core.hello"` → `"core"`. Names without a dot are ungrouped (`"core"`).
 */
export function methodGroup(method: string): string {
  const dot = method.indexOf('.')
  return dot === -1 ? method : method.slice(0, dot)
}

/**
 * Handle one raw (already frame-parsed) protocol message. Returns a response
 * for requests (has a numeric `id`), null for notifications and for malformed
 * messages that cannot be correlated to an id.
 */
export async function handleMessage(
  message: Record<string, unknown>,
  state: DispatchState,
  options: DispatchOptions,
): Promise<RpcResponse | null> {
  // Malformed / non-JSON-RPC messages: respond only when an id is present.
  const id = typeof message.id === 'number' ? message.id : null
  const method = typeof message.method === 'string' ? message.method : null

  // JSON-RPC notifications (no id) never get a response — including error
  // responses for stale/uninitialized state (§2: notifications carry no id).
  if (id === null && method !== null) {
    if (message.jsonrpc !== '2.0') return null
    if (method !== 'core.hello') return null // not initialized / unknown: silence
  }

  if (!method) {
    return id !== null
      ? errorResponse(id, ErrorCodes.invalidRequest, 'Invalid request: missing method')
      : null
  }
  if (message.jsonrpc !== '2.0') {
    return id !== null
      ? errorResponse(id, ErrorCodes.invalidRequest, 'Invalid request: jsonrpc must be "2.0"')
      : null
  }

  const params = message.params as unknown[] | Record<string, unknown> | undefined

  // Handshake (docs/CORE_RPC.md §3).
  if (method === 'core.hello') {
    return handleHello(id, params, state, options)
  }

  if (!state.initialized) {
    return errorResponse(id, ErrorCodes.notInitialized, 'Not initialized: send core.hello first')
  }

  const spec = options.methods.get(method)
  if (!spec) {
    return errorResponse(id, ErrorCodes.methodNotFound, `Method not found: ${method}`)
  }

  const granted = options.coreCapabilities ?? CORE_CAPABILITIES
  if (!granted.includes(spec.capability) || !state.granted.has(spec.capability)) {
    return errorResponse(id, ErrorCodes.denied, `Capability not granted: ${spec.capability}`, {
      capability: spec.capability,
    })
  }

  try {
    const result = await spec.handler(params)
    return { jsonrpc: '2.0', id: id as number, result }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return errorResponse(id, ErrorCodes.koraError, detail, { detail })
  }
}

function handleHello(
  id: number | null,
  params: unknown[] | Record<string, unknown> | undefined,
  state: DispatchState,
  options: DispatchOptions,
): RpcResponse {
  // Accept both named-object params and a single positional object.
  const p =
    Array.isArray(params) && params.length === 1 && params[0] && typeof params[0] === 'object'
      ? (params[0] as Record<string, unknown>)
      : (params as Record<string, unknown> | undefined)

  if (!p || typeof p !== 'object') {
    return errorResponse(id, ErrorCodes.invalidParams, 'core.hello requires { client, protocol }')
  }
  if (p.protocol !== PROTOCOL_VERSION) {
    return errorResponse(
      id,
      ErrorCodes.invalidRequest,
      `Protocol mismatch: client speaks ${String(p.protocol)}, core speaks ${PROTOCOL_VERSION}`,
      { expected: PROTOCOL_VERSION, received: typeof p.protocol === 'string' ? p.protocol : null },
    )
  }

  // A shell that sends no `capabilities` field gets the full default set only
  // if it declares it explicitly via the same list; otherwise nothing — the
  // contract says the shell declares what it wants. An omitted field grants
  // nothing beyond 'config'+'chats' (read-only basics every shell needs).
  const requested = Array.isArray(p.capabilities) ? (p.capabilities as unknown[]).filter((c): c is Capability => typeof c === 'string' && (CORE_CAPABILITIES as readonly string[]).includes(c)) : ['config', 'chats'] as Capability[]
  const coreHas = options.coreCapabilities ?? CORE_CAPABILITIES
  state.granted = new Set(requested.filter((c) => coreHas.includes(c)))
  state.initialized = true

  const result: HelloResult = {
    coreVersion: CORE_VERSION,
    protocol: PROTOCOL_VERSION,
    capabilities: [...state.granted],
    dataDir: state.dataDir,
  }
  return { jsonrpc: '2.0', id: id as number, result }
}
