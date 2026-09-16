import fs from 'fs/promises'
import path from 'path'
import os from 'os'

const LOG_DIR = path.join(os.homedir(), '.kora')
const LOG_FILE = path.join(LOG_DIR, 'audit.log')
const MAX_LOG_SIZE = 10 * 1024 * 1024 // 10 MB

export interface AuditEvent {
  type: 'shell_execute' | 'file_write' | 'file_delete' | 'file_rename' | 'mcp_call' | 'system_control'
  action: string
  details: Record<string, unknown>
  success: boolean
  blocked?: boolean
  user?: string
}

let logInitialized = false

async function ensureLogDir(): Promise<void> {
  if (logInitialized) return
  try {
    await fs.mkdir(LOG_DIR, { recursive: true })
    logInitialized = true
  } catch (err) {
    console.error('[AUDIT] Failed to create log directory:', err)
  }
}

async function rotateLogIfNeeded(): Promise<void> {
  try {
    const stat = await fs.stat(LOG_FILE)
    if (stat.size > MAX_LOG_SIZE) {
      const rotatedFile = path.join(LOG_DIR, `audit-${Date.now()}.log`)
      await fs.rename(LOG_FILE, rotatedFile)
      console.log(`[AUDIT] Rotated log to ${rotatedFile}`)
    }
  } catch {
    // File doesn't exist yet, that's ok
  }
}

export async function logAuditEvent(event: AuditEvent): Promise<void> {
  await ensureLogDir()
  await rotateLogIfNeeded()
  
  const logLine = JSON.stringify({
    ...event,
    timestamp: new Date().toISOString(),
  }) + '\n'
  
  try {
    await fs.appendFile(LOG_FILE, logLine, 'utf-8')
  } catch (err) {
    console.error('[AUDIT] Failed to write audit log:', err)
  }
}

// Convenience functions for common events
export async function logShellExecution(command: string, success: boolean, blocked: boolean = false): Promise<void> {
  await logAuditEvent({
    type: 'shell_execute',
    action: 'execute',
    details: { command },
    success,
    blocked,
  })
}

export async function logFileOperation(operation: string, filePath: string, success: boolean): Promise<void> {
  await logAuditEvent({
    type: 'file_write',
    action: operation,
    details: { path: filePath },
    success,
  })
}

export async function logMcpCall(serverName: string, toolName: string, success: boolean): Promise<void> {
  await logAuditEvent({
    type: 'mcp_call',
    action: 'call',
    details: { server: serverName, tool: toolName },
    success,
  })
}

export async function logSystemControl(action: string, success: boolean): Promise<void> {
  await logAuditEvent({
    type: 'system_control',
    action,
    details: {},
    success,
  })
}
