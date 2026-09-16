import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logShellExecution } from '../services/audit-log'
import { isDangerousCommand } from '../lib/shell-security'

const execAsync = promisify(exec)

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