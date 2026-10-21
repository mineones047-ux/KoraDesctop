// Shell command safety filters.
// Pure module (no electron imports) so both the IPC layer and the vitest
// suite import the SAME implementation — tests must never copy this logic.

// Pipe-to-shell patterns checked BEFORE normalization (normalization removes |)
// Covers: | bash, | sudo bash, | /bin/bash, | exec bash, | sh -c "...", etc.
const PIPE_TO_SHELL_PATTERNS = [
  // Direct pipe to shell (with optional sudo/exec/env/prefix)
  /\|\s*(?:sudo\s+|exec\s+|env\s+|nohup\s+)?(?:\/(?:bin|usr\/bin|usr\/local\/bin)\/)?(sh|bash|powershell|pwsh|zsh|csh|ksh|dash|fish)\b/i,
  // Command substitution patterns: `cmd` or $(cmd)
  /`[^`]*\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^`]*`/,
  /\$\([^)]*\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod)\b[^)]*\)/,
  // eval/exec with remote content
  /\beval\s+["']?\s*\$?\(?[^)]*\b(curl|wget)\b/i,
  /\b(curl|wget)\b[^|]*\|\s*(?:sudo\s+|exec\s+)?(?:\/(?:bin|usr\/bin|usr\/local\/bin)\/)?\w*sh\b/i,
]

// DANGEROUS COMMAND PATTERNS - block these to prevent system damage
const DANGEROUS_PATTERNS = [
  // Destructive commands
  /\b(format|del|rd|rd\s+\/s)\b/i,
  /\b(rm\s+(-[a-z]*f|(-[a-z]*r[a-z]*f|[a-z]*rf)))\b/i,
  /\brmdir\s+\/s/i,

  // Network/remote execution (pipe-to-shell covered by PIPE_TO_SHELL_PATTERNS)
  /Invoke-WebRequest/i,
  /Invoke-RestMethod/i,
  /Start-BitsTransfer/i,
  /certutil.*-urlfetch/i,

  // PowerShell dangerous cmdlets
  /\b(Stop-Process|Stop-Service|Stop-NetAdapter)\b/i,
  /\bRemove-Item\b/i,
  /\bNew-NetFirewallRule\b/i,
  /\bSet-ExecutionPolicy\b/i,
  /\b(regsvr32\s+\/s|regsvr32\s+\/u\s+\/s)\b/i,

  // Registry manipulation
  /reg\s+(add|delete|export|import)/i,

  // System shutdown/reboot (let agent handle these separately)
  /\b(shutdown|poweroff|reboot|halt)\b/i,

  // Disk operations
  /\b(diskpart|mkfs|fdisk)\b/i,

  // Process kill via taskkill (equivalent destructive power to Stop-Process)
  /\b(taskkill)(?:\s|\/|$)/i,

  // Network configuration changes
  /\b(netsh\s+interface)\b/i,
  /\b(ipconfig\s+\/renew|ipconfig\s+\/release)\b/i,
  /\b(new-netipaddress|remove-netipaddress)\b/i,

  // Remote execution / download helpers (security review 2026-09-25).
  // Aliases matter: `iex (irm http://…)` and `powershell -enc <blob>` slipped
  // through the full-name rules above.
  /\b(invoke-expression|iex)\b/i,
  /\b(iwr|irm)\s+/i,
  /\b(net\.webclient|downloadstring|downloadfile)\b/i,
  /\bbitsadmin\b/i,
  /\bmshta(\.exe)?\b/i,
  /\b(wscript|cscript)(\.exe)?\b/i,
  /\brundll32(\.exe)?\b/i,
  /\bregsvr32(\.exe)?\b/i,
  /\bpowershell(?:\.exe)?\b[^|]*\s-(?:e|en|enc|enco|encod|encodedcommand)(?=\s|$)/i,
]

// SAFE COMMAND PATTERNS - allow these without confirmation
const SAFE_PATTERNS = [
  /^(dir|ls|echo|cat|type|head|tail|grep|find|which|where|pwd|cd|date|time|whoami|hostname|uname|systeminfo|tasklist|ps)\b/i,
]

/**
 * Is this command in the denylist?
 *
 * Two-stage by necessity. Pipe-to-shell is checked on the *raw* text because the
 * normalization below deletes `|`, which would erase the very pattern we are looking for.
 * Only after that do we normalize and run the destructive-op patterns, so that separators
 * and escapes cannot hide a verb (`& del /s`, `d^el`, `r`m`).
 *
 * This is a denylist, not a sandbox: it stops known-dangerous shapes, and says nothing
 * about whether an allowed command is *wise*. The Tauri build adds process containment
 * behind it, which is a stronger layer than anything regex can provide.
 */
export function isDangerousCommand(command: string): boolean {
  // Pre-normalization check: pipe-to-shell patterns get broken by
  // the normalization step that replaces | with space
  for (const pattern of PIPE_TO_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return true
    }
  }

  // Normalize so dangerous ops buried after chaining operators, leading
  // operators, or newlines are still matched (e.g. `& del /s ...` or
  // "echo hi\nrm -rf proj"). Replacing separators with a space keeps the
  // word-boundary regexes effective without matching across token joins.
  // Carets and backticks are DELETED (not replaced): cmd `d^el` and
  // PowerShell `` r`m `` both mean `rm` to the shell, so the detector must
  // see the same token (security review 2026-09-25).
  const normalizedCmd = command
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/&{1,2}\s*/g, ' ')
    .replace(/\|{1,2}\s*/g, ' ')
    .replace(/;\s*/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[\^`]/g, '')

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalizedCmd)) {
      return true
    }
  }

  return false
}

/**
 * Is this command read-only enough to skip the confirmation prompt?
 *
 * Separate from `isDangerousCommand` on purpose: that answers "must I block this", this
 * answers "can I just run it", and a command can be neither dangerous nor in this list.
 */
export function isSafeCommand(command: string): boolean {
  const normalizedCmd = command.trim()

  // Check against safe patterns
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(normalizedCmd)) {
      return true
    }
  }

  return false
}
