import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import { randomUUID } from 'crypto'
import {
  MCPRequest,
  MCPResponse,
  MCPNotification,
  MCPInitializeResult,
  MCPListToolsResult,
  MCPCallToolResult,
  MCP_PROTOCOL_VERSION,
} from './protocol'

export interface MCPClientOptions {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  requestTimeoutMs?: number
  startupTimeoutMs?: number
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

type NotificationHandler = (method: string, params: unknown) => void

/**
 * Single MCP server connection. Owns the child process and the JSON-RPC
 * message pump. One instance per server. The manager is responsible for
 * lifecycle (start/stop) and concurrency.
 */
export class MCPClient {
  public readonly name: string
  private readonly opts: Required<Omit<MCPClientOptions, 'env' | 'cwd'>> &
    Pick<MCPClientOptions, 'env' | 'cwd'>
  private process: ChildProcessWithoutNullStreams | null = null
  private buffer = ''
  private nextId = 1
  private pending = new Map<number | string, Pending>()
  private initialized = false
  private serverInfo: MCPInitializeResult | null = null
  private notificationHandlers: NotificationHandler[] = []
  private stderrTail: string[] = []
  private exitListeners: Array<(code: number | null) => void> = []

  constructor(opts: MCPClientOptions) {
    this.name = opts.name
    this.opts = {
      name: opts.name,
      command: opts.command,
      args: opts.args ?? [],
      env: opts.env,
      cwd: opts.cwd,
      requestTimeoutMs: opts.requestTimeoutMs ?? 30_000,
      startupTimeoutMs: opts.startupTimeoutMs ?? 20_000,
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.initialized
  }

  getServerInfo(): MCPInitializeResult | null {
    return this.serverInfo
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.push(handler)
    return () => {
      this.notificationHandlers = this.notificationHandlers.filter((h) => h !== handler)
    }
  }

  onExit(handler: (code: number | null) => void): () => void {
    this.exitListeners.push(handler)
    return () => {
      this.exitListeners = this.exitListeners.filter((h) => h !== handler)
    }
  }

  async start(): Promise<MCPInitializeResult> {
    if (this.process) {
      throw new Error(`MCP server "${this.name}" is already running`)
    }

    const child = spawn(this.opts.command, this.opts.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.opts.env },
      cwd: this.opts.cwd,
      windowsHide: true,
      shell: false,
    })

    this.process = child
    this.buffer = ''
    this.stderrTail = []
    this.pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new Error('MCP client restarted'))
    })
    this.pending.clear()

    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')

    child.stdout.on('data', (chunk: string) => this.handleData(chunk))
    child.stderr.on('data', (chunk: string) => {
      const lines = chunk.split(/\r?\n/).filter(Boolean)
      this.stderrTail.push(...lines)
      if (this.stderrTail.length > 50) {
        this.stderrTail.splice(0, this.stderrTail.length - 50)
      }
    })

    child.on('error', (err) => {
      this.failAllPending(err)
    })

    child.on('exit', (code) => {
      this.initialized = false
      this.process = null
      this.failAllPending(new Error(`MCP server "${this.name}" exited (code=${code})`))
      this.exitListeners.forEach((h) => {
        try {
          h(code)
        } catch (err) {
          console.error('[MCP] exit listener error:', err)
        }
      })
    })

    try {
      this.serverInfo = await this.initialize()
      await this.notifyInitialized()
      this.initialized = true
      return this.serverInfo
    } catch (err) {
      await this.stop()
      throw err
    }
  }

  async stop(): Promise<void> {
    const child = this.process
    this.process = null
    this.initialized = false
    this.serverInfo = null
    this.failAllPending(new Error('MCP client stopped'))

    if (!child) return

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.killTree(child)
        resolve()
      }, 2_000)

      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })

      try {
        child.kill('SIGTERM')
      } catch {
        clearTimeout(timer)
        resolve()
      }
    })
  }

  /**
   * On Windows, SIGTERM/SIGKILL only terminate the direct child (e.g. cmd.exe)
   * and leave grandchildren (npx -> node) alive as orphans. taskkill /T /F kills
   * the whole process tree.
   */
  private killTree(child: ChildProcessWithoutNullStreams): void {
    try {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } else {
        child.kill('SIGKILL')
      }
    } catch {
      // best effort
    }
  }

  async listTools(): Promise<MCPListToolsResult> {
    if (!this.initialized) throw new Error(`MCP "${this.name}" not initialized`)
    const result = await this.request<MCPListToolsResult>('tools/list', {})
    return result
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallToolResult> {
    if (!this.initialized) throw new Error(`MCP "${this.name}" not initialized`)
    if (!name || typeof name !== 'string') throw new Error('Tool name must be a non-empty string')
    const result = await this.request<MCPCallToolResult>('tools/call', {
      name,
      arguments: args ?? {},
    })
    return result
  }

  private async initialize(): Promise<MCPInitializeResult> {
    const initPromise = this.request<MCPInitializeResult>('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'kora', version: '1.0.0' },
    })

    let timeoutHandle: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`MCP "${this.name}" initialize timeout (${this.opts.startupTimeoutMs}ms)`)),
        this.opts.startupTimeoutMs,
      )
    })

    try {
      return await Promise.race([initPromise, timeoutPromise])
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  private async notifyInitialized(): Promise<void> {
    await this.notify('notifications/initialized', {})
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.process) throw new Error(`MCP "${this.name}" process not running`)

    const id = this.nextId++
    const req: MCPRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP "${this.name}" ${method} timeout (${this.opts.requestTimeoutMs}ms)`))
      }, this.opts.requestTimeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })

      try {
        this.process!.stdin.write(JSON.stringify(req) + '\n', 'utf-8')
      } catch (err) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(err as Error)
      }
    })
  }

  private async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (!this.process) return
    const note: MCPNotification = { jsonrpc: '2.0', method, params }
    this.process.stdin.write(JSON.stringify(note) + '\n', 'utf-8')
  }

  private handleData(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 4 * 1024 * 1024) {
      console.error(`[MCP ${this.name}] output buffer exceeded 4MB, dropping data`)
      this.buffer = ''
    }
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (!line) continue
      this.handleLine(line)
    }
  }

  private handleLine(line: string): void {
    let msg: MCPResponse
    try {
      msg = JSON.parse(line)
    } catch (err) {
      console.error(`[MCP ${this.name}] invalid JSON:`, line.slice(0, 200))
      return
    }

    if (msg.id === null || msg.id === undefined) {
      if (msg.method) {
        this.notificationHandlers.forEach((h) => {
          try {
            h(msg.method!, msg.params)
          } catch (err) {
            console.error('[MCP] notification handler error:', err)
          }
        })
      }
      return
    }

    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    clearTimeout(pending.timer)

    if (msg.error) {
      pending.reject(new Error(`MCP ${this.name}: ${msg.error.message} (code=${msg.error.code})`))
    } else {
      pending.resolve(msg.result)
    }
  }

  private failAllPending(err: Error): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(err)
    })
    this.pending.clear()
  }

  getDiagnostics() {
    return {
      name: this.name,
      running: this.isRunning(),
      serverInfo: this.serverInfo,
      stderrTail: this.stderrTail.slice(-10),
    }
  }

  static generateServerId(): string {
    return `srv_${randomUUID().slice(0, 8)}`
  }
}
