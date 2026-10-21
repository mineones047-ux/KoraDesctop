//! Process sandbox — the layer *above* the shell denylist.
//!
//! Why this exists: [`crate::shell::is_dangerous_command`] is a **denylist**. It stops
//! the commands we thought of. It does not stop `powershell -enc <base64>`, a renamed
//! binary, an alias, or anything the model invents tomorrow. Open Interpreter runs
//! commands "inside native sandboxing on macOS, Linux, and Windows" for exactly this
//! reason. A denylist plus an OS-level boundary is defence in depth; a denylist alone is
//! a single point of failure.
//!
//! What the sandbox enforces:
//!   * **Windows** — every child is assigned to a Job Object with
//!     `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, so the whole tree dies when the app exits
//!     (no `cmd -> npx -> node` zombies, the problem FIXES.md already documented), plus
//!     an active-process cap and a working-set cap;
//!   * **all platforms** — the child gets a **scrubbed environment**: only a small
//!     allowlist (PATH, SystemRoot/TEMP/HOME, locale) survives, so secrets the parent
//!     process holds are not handed to a command the model chose.
//!
//! What it deliberately does NOT do: pretend to be a security boundary on its own.
//! `shell.execute` still runs the denylist first and the confirmation flow is
//! unchanged. The sandbox makes a bypassed denylist *much* less useful; it does not
//! make an allowed command safe.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// Variables the child always gets. Everything else is dropped unless the caller opts
/// in, so the model cannot read the parent's secrets just by running `set`.
const ENV_ALLOWLIST: [&str; 10] = [
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "SystemRoot",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LANG",
];

/// Hard cap on concurrent child processes per command tree (Windows job limit).
pub const MAX_CHILD_PROCESSES: u32 = 64;

/// Soft cap on the working set of a child process tree (Windows job limit).
pub const MAX_WORKING_SET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// How a command may touch the machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SandboxPolicy {
    /// Working directory the child starts in. `None` keeps the parent's CWD.
    pub cwd: Option<PathBuf>,
    /// Environment variables to forward *in addition* to the allowlist.
    pub extra_env: BTreeMap<String, String>,
    /// Apply the process-tree kill/limit job (Windows). A no-op elsewhere.
    pub contain_process_tree: bool,
    /// Kill the tree after this many milliseconds. `None` = no wall-clock limit here
    /// (the caller applies its own timeout).
    pub wall_clock_ms: Option<u64>,
}

impl Default for SandboxPolicy {
    fn default() -> Self {
        Self {
            cwd: None,
            extra_env: BTreeMap::new(),
            contain_process_tree: true,
            wall_clock_ms: None,
        }
    }
}

impl SandboxPolicy {
    /// Forward one extra variable on top of the allowlist.
    pub fn with_env(mut self, key: &str, value: &str) -> Self {
        self.extra_env.insert(key.to_string(), value.to_string());
        self
    }

    /// Run the child in `dir`.
    pub fn in_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.cwd = Some(dir.into());
        self
    }
}

/// Build the environment for a child process: the allowlist plus the explicit extras.
///
/// The parent's variables are read, never mutated — this returns a map the caller
/// hands to the spawn, so building the environment has no side effects and is
/// therefore trivially testable.
pub fn child_env(policy: &SandboxPolicy) -> BTreeMap<String, String> {
    let mut out: BTreeMap<String, String> = BTreeMap::new();

    for name in ENV_ALLOWLIST {
        // Windows env vars are case-insensitive; check both spellings.
        for candidate in [name.to_string(), name.to_ascii_lowercase()] {
            if let Ok(v) = std::env::var(&candidate) {
                out.insert(candidate, v);
                break;
            }
        }
    }

    for (k, v) in &policy.extra_env {
        out.insert(k.clone(), v.clone());
    }
    out
}

/// The same set as [`child_env`], as `OsString` pairs ready for `Command::envs`.
pub fn child_env_os(policy: &SandboxPolicy) -> Vec<(OsString, OsString)> {
    child_env(policy)
        .into_iter()
        .map(|(k, v)| (OsString::from(k), OsString::from(v)))
        .collect()
}

/// Does this variable name look like a secret? Used by the audit log and the tests
/// that assert the scrubber keeps them out of the child environment.
pub fn is_secret(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.contains("KEY")
        || upper.contains("TOKEN")
        || upper.contains("SECRET")
        || upper.contains("PASSWORD")
        || upper.contains("CREDENTIAL")
}

/// Resolve the directory a child should run in, falling back to `home`.
///
/// A relative `cwd` is ignored on purpose: letting a model-chosen relative path become
/// the process CWD is how relative-path tricks begin.
pub fn effective_cwd(policy: &SandboxPolicy, home: &Path) -> PathBuf {
    match &policy.cwd {
        Some(dir) if dir.is_absolute() => dir.clone(),
        _ => home.to_path_buf(),
    }
}
