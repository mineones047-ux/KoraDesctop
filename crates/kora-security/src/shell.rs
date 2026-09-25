//! Shell command safety filters — the Rust port of `electron/lib/shell-security.ts`.
//!
//! Invariants that must survive the port (`docs/PROJECT_HANDOFF.md` §5):
//!   * the pipe-to-shell check runs on the **raw** command, *before* normalisation
//!     (normalisation replaces `|` with a space and would destroy the evidence);
//!   * both functions are pure and never panic — this is the last line of defence before
//!     `shell:execute` runs anything;
//!   * JS regex semantics are reproduced explicitly (`(?-u:\b)`, `@WS@`); a Unicode-mode
//!     `\b` here would silently stop matching commands preceded by a non-ASCII character.
//!     See [`crate::js_regex`].
//!
//! Patterns are 1:1 with the TS source; the only textual changes are the semantics fixes
//! above (`\b` → `(?-u:\b)`, `\w` → `(?-u:\w)`, `\s` → `@WS@`).

use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_regex::js_regex;

/// Pipe-to-shell patterns, checked BEFORE normalisation.
/// Covers `| bash`, `| sudo bash`, `| /bin/bash`, `| exec bash`, `| sh -c "..."`, etc.
static PIPE_TO_SHELL_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Direct pipe to a shell, with an optional sudo/exec/env/nohup prefix and an
        // optional absolute path. TS: `/\|\s*(?:sudo\s+...)?(?:\/(?:bin|...)\/)?(sh|bash|...)\b/i`
        js_regex(r"(?i)\|@WS@*(?:sudo@WS@+|exec@WS@+|env@WS@+|nohup@WS@+)?(?:/(?:bin|usr/bin|usr/local/bin)/)?(sh|bash|powershell|pwsh|zsh|csh|ksh|dash|fish)(?-u:\b)"),
        // Command substitution with backticks (case-sensitive in TS).
        js_regex(r"`[^`]*(?-u:\b)(curl|wget|Invoke-WebRequest|Invoke-RestMethod)(?-u:\b)[^`]*`"),
        // Command substitution with `$( )` (case-sensitive in TS).
        js_regex(r"\$\([^)]*(?-u:\b)(curl|wget|Invoke-WebRequest|Invoke-RestMethod)(?-u:\b)[^)]*\)"),
        // eval/exec with remote content.
        js_regex(r#"(?i)(?-u:\b)eval@WS@+["']?@WS@*\$?\(?[^)]*(?-u:\b)(curl|wget)(?-u:\b)"#),
        // `curl ... | sh` without the pipe being the first thing.
        js_regex(r"(?i)(?-u:\b)(curl|wget)(?-u:\b)[^|]*\|@WS@*(?:sudo@WS@+|exec@WS@+)?(?:/(?:bin|usr/bin|usr/local/bin)/)?(?-u:\w)*sh(?-u:\b)"),
    ]
});
/// `DANGEROUS_PATTERNS` — matched against the **normalised** command, so an operation buried
/// behind `&&`, `||`, `;`, a newline or a leading `&` is still caught.
static DANGEROUS_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![
        // Destructive commands.
        js_regex(r"(?i)(?-u:\b)(format|del|rd|rd@WS@+/s)(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)(rm@WS@+(-[a-z]*f|(-[a-z]*r[a-z]*f|[a-z]*rf)))(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)rmdir@WS@+/s"),
        // Network / remote execution (pipe-to-shell is covered above).
        js_regex(r"(?i)Invoke-WebRequest"),
        js_regex(r"(?i)Invoke-RestMethod"),
        js_regex(r"(?i)Start-BitsTransfer"),
        js_regex(r"(?i)certutil.*-urlfetch"),
        // PowerShell dangerous cmdlets.
        js_regex(r"(?i)(?-u:\b)(Stop-Process|Stop-Service|Stop-NetAdapter)(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)Remove-Item(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)New-NetFirewallRule(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)Set-ExecutionPolicy(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)(regsvr32@WS@+/s|regsvr32@WS@+/u@WS@+/s)(?-u:\b)"),
        // Registry manipulation.
        js_regex(r"(?i)reg@WS@+(add|delete|export|import)"),
        // System shutdown/reboot (the agent handles these separately).
        js_regex(r"(?i)(?-u:\b)(shutdown|poweroff|reboot|halt)(?-u:\b)"),
        // Disk operations.
        js_regex(r"(?i)(?-u:\b)(diskpart|mkfs|fdisk)(?-u:\b)"),
        // Process kill via taskkill (same destructive power as Stop-Process).
        js_regex(r"(?i)(?-u:\b)(taskkill)(?:@WS@|/|$)"),
        // Network configuration changes.
        js_regex(r"(?i)(?-u:\b)(netsh@WS@+interface)(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)(ipconfig@WS@+/renew|ipconfig@WS@+/release)(?-u:\b)"),
        js_regex(r"(?i)(?-u:\b)(new-netipaddress|remove-netipaddress)(?-u:\b)"),
    ]
});

/// `SAFE_PATTERNS` — read-only commands that need no confirmation.
static SAFE_PATTERNS: Lazy<Vec<Regex>> = Lazy::new(|| {
    vec![js_regex(
        r"(?i)^(dir|ls|echo|cat|type|head|tail|grep|find|which|where|pwd|cd|date|time|whoami|hostname|uname|systeminfo|tasklist|ps)(?-u:\b)",
    )]
});

/// `[\r\n]+` — line breaks become spaces (so a dangerous command on the next line is caught).
static NORMALIZE_NEWLINES: Lazy<Regex> = Lazy::new(|| js_regex(r"[\r\n]+"));

/// `&{1,2}\s*` — `&` / `&&` become a space.
static NORMALIZE_AMPERSANDS: Lazy<Regex> = Lazy::new(|| js_regex(r"&{1,2}@WS@*"));

/// `\|{1,2}\s*` — `|` / `||` become a space.
static NORMALIZE_PIPES: Lazy<Regex> = Lazy::new(|| js_regex(r"\|{1,2}@WS@*"));

/// `;\s*` — `;` becomes a space.
static NORMALIZE_SEMICOLONS: Lazy<Regex> = Lazy::new(|| js_regex(r";@WS@*"));

/// TS normalisation chain. Chained dangerous operators become spaces so that the
/// word-boundary patterns keep working without matching across token joins.
pub fn normalize_command(command: &str) -> String {
    let s = NORMALIZE_NEWLINES.replace_all(command.trim(), " ");
    let s = NORMALIZE_AMPERSANDS.replace_all(&s, " ");
    let s = NORMALIZE_PIPES.replace_all(&s, " ");
    NORMALIZE_SEMICOLONS.replace_all(&s, " ").into_owned()
}

/// Does this command need an explicit user confirmation before it may run?
///
/// The pipe-to-shell pass deliberately runs first, on the raw string: normalisation replaces
/// `|` with a space and would destroy the evidence (`curl x | bash`).
pub fn is_dangerous_command(command: &str) -> bool {
    if PIPE_TO_SHELL_PATTERNS.iter().any(|p| p.is_match(command)) {
        return true;
    }

    let normalized = normalize_command(command);
    DANGEROUS_PATTERNS.iter().any(|p| p.is_match(&normalized))
}

/// Is this a read-only command that can run without confirmation?
pub fn is_safe_command(command: &str) -> bool {
    let trimmed = command.trim();
    SAFE_PATTERNS.iter().any(|p| p.is_match(trimmed))
}

