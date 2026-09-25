/**
 * System control IPC handlers (system:*): power, volume, brightness, lock,
 * process list/kill, openApp, window enumeration.
 *
 * Implemented with per-platform shell commands (PowerShell on Windows). openApp
 * refuses a blocklist of system executables; killProcess validates the PID.
 */
import { ipcMain, shell } from 'electron'
import { exec } from 'child_process'
import os from 'os'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Blocked paths for openApp to prevent launching system utilities
const BLOCKED_OPEN_PATHS = [
  'c:\\windows\\system32\\cmd.exe',
  'c:\\windows\\system32\\windowspowershell',
  'c:\\windows\\system32\\regedit.exe',
  'c:\\windows\\system32\\msconfig.exe',
  'c:\\windows\\system32\\taskmgr.exe',
  '/bin/sh',
  '/bin/bash',
  '/usr/bin/sudo',
]

function isBlockedOpenPath(p: string): boolean {
  const lower = p.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '')
  for (const blocked of BLOCKED_OPEN_PATHS) {
    if (lower === blocked || lower.startsWith(blocked + '\\')) return true
  }
  return false
}

function isWin(): boolean {
  return process.platform === 'win32'
}

export function registerSystemHandlers() {
  ipcMain.handle('system:info', async () => {
    return {
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      cpus: os.cpus(),
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      uptime: os.uptime(),
      userInfo: os.userInfo(),
    }
  })

  ipcMain.handle('system:processes', async () => {
    try {
      if (isWin()) {
        const { stdout } = await execAsync(
          'powershell -NoProfile -c "Get-Process | Select-Object Name, Id, WorkingSet64 | ConvertTo-Json -Compress"',
          { maxBuffer: 16 * 1024 * 1024 },
        )
        const parsed = JSON.parse(stdout)
        const arr = Array.isArray(parsed) ? parsed : parsed ? [parsed] : []
        return arr
          .map((p: any) => ({
            name: String(p.Name || ''),
            pid: Number(p.Id) || 0,
            memory: `${(Number(p.WorkingSet64) || 0) / (1024 * 1024)} MB`,
          }))
          .filter((p: any) => p.pid > 0)
      } else {
        const { stdout } = await execAsync('ps aux --no-headers')
        return stdout.trim().split('\n').map((line) => {
          const parts = line.trim().split(/\s+/)
          return {
            name: parts[10] || parts[0],
            pid: parseInt(parts[1]),
            memory: `${parts[3]}%`,
          }
        })
      }
    } catch {
      return []
    }
  })

  ipcMain.handle('system:openApp', async (_event, appPath: string) => {
    try {
      if (typeof appPath !== 'string' || appPath.length === 0 || appPath.length > 4096) {
        return { success: false, error: 'Invalid path' }
      }
      if (isBlockedOpenPath(appPath)) {
        return { success: false, error: 'Access to system utilities is blocked' }
      }
      const result = await shell.openPath(appPath)
      if (result) {
        return { success: false, error: result }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:killProcess', async (_event, pid: number) => {
    try {
      if (!Number.isInteger(pid) || pid <= 0) {
        return { success: false, error: 'Invalid PID' }
      }
      if (isWin()) {
        await execAsync(`taskkill /PID ${pid} /F`)
      } else {
        await execAsync(`kill -9 ${pid}`)
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // === Power Management ===
  ipcMain.handle('system:shutdown', async () => {
    try {
      if (isWin()) await execAsync('shutdown /s /t 5 /c "Kora initiated shutdown"')
      else await execAsync('shutdown -h now')
      return { success: true, message: 'Shutting down in 5 seconds' }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:restart', async () => {
    try {
      if (isWin()) await execAsync('shutdown /r /t 5 /c "Kora initiated restart"')
      else await execAsync('shutdown -r now')
      return { success: true, message: 'Restarting in 5 seconds' }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:sleep', async () => {
    try {
      if (isWin()) {
        await execAsync('rundll32.exe powrprof.dll,SetSuspendState 0,1,0')
      } else {
        await execAsync('pmset sleepnow')
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // === Volume ===
  ipcMain.handle('system:volume', async (_event, level: number) => {
    try {
      if (typeof level !== 'number' || !isFinite(level)) {
        return { success: false, error: 'Invalid volume level' }
      }
      const clamped = Math.max(0, Math.min(100, Math.round(level)))
      if (isWin()) {
        const cmd =
          'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class Vol { [DllImport("winmm.dll")] public static extern int waveOutSetVolume(int h, uint v); }\'; ' +
          `$v = [uint32][math]::Round(65535 * ${clamped} / 100); [Vol]::waveOutSetVolume(0, ($v -shl 16) -bor $v)`
        await execAsync(`powershell -NoProfile -c "${cmd}"`)
      } else {
        await execAsync(`osascript -e "set volume output volume ${clamped}"`)
      }
      return { success: true, volume: clamped }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:volumeUp', async () => {
    try {
      if (isWin()) await execAsync('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]175)"')
      else await execAsync('osascript -e "set volume output volume (output volume of (get volume settings) + 10)"')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:volumeDown', async () => {
    try {
      if (isWin()) await execAsync('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]174)"')
      else await execAsync('osascript -e "set volume output volume (output volume of (get volume settings) - 10)"')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('system:mute', async () => {
    try {
      if (isWin()) await execAsync('powershell -c "(New-Object -ComObject WScript.Shell).SendKeys([char]173)"')
      else await execAsync('osascript -e "set volume output muted true"')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // === Brightness ===
  ipcMain.handle('system:brightness', async (_event, level: number) => {
    try {
      if (typeof level !== 'number' || !isFinite(level)) {
        return { success: false, error: 'Invalid brightness level' }
      }
      const clamped = Math.max(0, Math.min(100, Math.round(level)))
      if (isWin()) {
        await execAsync(`powershell -c "(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1,${clamped})"`)
      } else {
        await execAsync(`brightness ${clamped}`)
      }
      return { success: true, brightness: clamped }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // === Open Windows List ===
  ipcMain.handle('system:windows', async () => {
    try {
      if (isWin()) {
        const { stdout } = await execAsync(
          `powershell -c "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object Name, MainWindowTitle, Id | ConvertTo-Json"`
        )
        const parsed = JSON.parse(stdout)
        const arr = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : [])
        return arr.map((p: any) => ({
          name: p.Name || '',
          title: p.MainWindowTitle || p.Name || '',
          pid: p.Id || 0,
        })).filter((p: any) => p.title)
      } else {
        const { stdout } = await execAsync(
          'osascript -e "tell application \"System Events\" to get name of every process whose visible is true"'
        )
        return stdout.trim().split(', ').map((name: string) => ({ name, title: name, pid: 0 }))
      }
    } catch {
      return []
    }
  })

  // === Lock Screen ===
  ipcMain.handle('system:lock', async () => {
    try {
      if (isWin()) await execAsync('rundll32.exe user32.dll,LockWorkStation')
      else await execAsync('pmset displaysleepnow')
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })
}