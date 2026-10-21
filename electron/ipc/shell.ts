import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logShellExecution } from '../services/audit-log'
import { isDangerousCommand } from '../lib/shell-security'

const execAsync = promisify(exec)

/**
 * Run a shell command on the user's behalf — the agent's `shell` tool.
 *
 * Order matters: the denylist runs *before* the command reaches `exec`, and every
 * outcome (blocked, failed, ok) is written to the audit log, because this is the one
 * handler where a bug has consequences outside the app.
 *
 * The blocking return is deliberately *not* an exception: the agent needs to see a
 * refusal as a tool result it can explain, not an opaque IPC error.
 */
export function registerShellHandlers() {
  ipcMain.handle('shell:execute', async (_event, command: string, options?: { bypassDangerCheck?: boolean }) => {
    const normalizedCmd = command.trim()
    
    // Log all shell executions for audit
    console.log(`[SHELL] Executing: ${normalizedCmd}`)
    
    // Check for dangerous commands unless explicitly bypassed
    if (!options?.bypassDangerCheck && isDangerousCommand(normalizedCmd)) {
      await logShellExecution(normalizedCmd, false, true)
      return {
        stdout: '',
        stderr: `Command blocked for safety: ${normalizedCmd}. This command is potentially dangerous.`,
        success: false,
        blocked: true,
        requiresConfirmation: true,
      }
    }
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 10,
      })
      await logShellExecution(normalizedCmd, true, false)
      return {
        stdout: stdout || '',
        stderr: stderr || '',
        success: true,
        blocked: false,
      }
    } catch (error) {
      await logShellExecution(normalizedCmd, false, false)
      return {
        stdout: (error as any).stdout || '',
        stderr: (error as Error).message,
        success: false,
        blocked: false,
      }
    }
  })
}