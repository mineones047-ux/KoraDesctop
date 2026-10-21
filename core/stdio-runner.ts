/**
 * Headless kora-rpc/1 runner — the P1 deliverable of docs/ROADMAP.md §7:
 * "the agent can be started headless from a script". Reads newline-delimited
 * JSON-RPC from stdin, writes responses to stdout; stderr stays logs-only
 * (never protocol). Exit codes: 0 on clean EOF, 1 on fatal setup error.
 *
 * This is the seed of kora-cli: today it serves the fs/shell/chats method
 * table; the agent domain moves into the core in P3 (docs/ROADMAP.md §7).
 */
import readline from 'readline'
import { parseFrame, frame, type RpcResponse } from './protocol'
import { handleMessage, createDispatchState, type DispatchOptions, type DispatchState } from './dispatch'

export interface RunnerHooks {
  /** Called for every response line (tests capture this instead of stdout). */
  onMessage?: (response: RpcResponse | null) => void
  /** Logs go to stderr only (protocol must never mix with logs). */
  log?: (line: string) => void
}

export interface CoreRunner {
  /** Feed one raw input line; resolves with the response (null for notifications). */
  handleLine(line: string): Promise<RpcResponse | null>
  /** Attach to real stdio (used by the executable entrypoint). */
  attachStdio(): void
  state: DispatchState
}

/**
 * Build a runner over the dispatch table.
 *
 * `handleLine` is separated from `attachStdio` so the tests can drive the protocol
 * without real stdin/stdout — the vitest suite covers the same code the binary runs.
 */
export function createCoreRunner(options: DispatchOptions, hooks: RunnerHooks = {}): CoreRunner {
  const state = createDispatchState(options.dataDir ?? '')
  const log = hooks.log ?? ((line: string) => process.stderr.write(line + '\n'))

  /** One input line in, one response (or null) out. */
  async function handleLine(line: string): Promise<RpcResponse | null> {
    const parsed = parseFrame(line)
    if (!parsed.ok) {
      // Unparseable input: a request id is unknowable — -32700 with null id.
      const response = {
        jsonrpc: '2.0' as const,
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }
      hooks.onMessage?.(response)
      return response
    }
    const response = await handleMessage(parsed.message, state, options)
    if (response) hooks.onMessage?.(response)
    return response
  }

  /**
   * Bind the runner to real stdin/stdout.
   *
   * stdin carries protocol, stdout carries protocol, and **stderr carries logs** — mixing
   * a log line into stdout would corrupt the stream a shell is parsing.
   */
  function attachStdio(): void {
    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
    rl.on('line', (line) => {
      void handleLine(line)
        .then((response) => {
          if (response) process.stdout.write(frame(response))
        })
        .catch((err) => {
          // The dispatch loop must never die on a handler error.
          log(`[kora-rpc] handler error: ${err instanceof Error ? err.message : String(err)}`)
        })
    })
    rl.on('close', () => {
      log('[kora-rpc] stdin closed, exiting')
    })
  }

  return { handleLine, attachStdio, state }
}
