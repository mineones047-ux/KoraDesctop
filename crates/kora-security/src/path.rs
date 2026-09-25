//! Path policy — the Rust port of `src/lib/path-security.ts` plus the write blocklist that
//! lives inside `electron/ipc/filesystem.ts` (`stripQuotes`, `expand`, `BLOCKED_WRITE_PATHS`,
//! `assertNotBlockedWrite`).
//!
//! Parity rules (do not "clean these up"):
//!   * [`normalize_path`] reproduces the TS implementation literally, including its quirk
//!     that the absolute-path test uses the *trimmed* input while the separator replacement
//!     uses the untrimmed one, and that `..` is resolved lexically (no filesystem access);
//!   * every error message is byte-identical to the TS one — these strings reach the UI;
//!   * the environment inputs of the write blocklist are explicit ([`PlatformEnv`]) so the
//!     Windows list can be tested on any host and vice versa.
//!
//! Deliberately NOT ported here: `resolveSafePath()` from `electron/ipc/filesystem.ts` needs
//! Node's `path.resolve` semantics (CWD- and platform-dependent) and belongs to the `fs:*`
//! channel port; only its constant [`MAX_PATH_LENGTH`] is defined here.

use std::fmt;

/// Mirror of `MAX_PATH_LENGTH` from `electron/ipc/filesystem.ts`.
pub const MAX_PATH_LENGTH: usize = 4096;

/// Roots that must never be the target of an operation (TS: `DANGEROUS_ROOTS`).
const DANGEROUS_ROOTS: [&str; 9] = ["/", "C:\\", "C:", "D:\\", "D:", "E:\\", "E:", "F:\\", "F:"];

/// Sensitive system directories (TS: `DANGEROUS_PATHS`).
const DANGEROUS_PATHS: [&str; 16] = [
    "/etc",
    "/bin",
    "/sbin",
    "/usr",
    "/boot",
    "/dev",
    "/proc",
    "/sys",
    "/var/log",
    "/windows",
    "/winnt",
    "C:\\Windows",
    "C:\\Program Files",
    "C:\\Program Files (x86)",
    "C:\\ProgramData",
    "C:\\System Volume Information",
];

/// The `process.platform === 'win32'` branch of the TS blocklist builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    Windows,
    Other,
}

impl Platform {
    /// The platform this process is running on.
    pub fn current() -> Self {
        if cfg!(windows) {
            Platform::Windows
        } else {
            Platform::Other
        }
    }
}

/// The inputs `BLOCKED_WRITE_PATHS` was built from, made explicit.
///
/// [`PlatformEnv::current`] applies the TS defaults (`%SystemRoot% || C:\Windows`,
/// `%APPDATA% || <home>\AppData\Roaming`); tests construct the struct directly so the
/// decision is deterministic on every host.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformEnv {
    pub platform: Platform,
    /// `%SystemRoot%` (`C:\Windows` when unset).
    pub sys_root: String,
    /// `os.homedir()`.
    pub home: String,
    /// `%APPDATA%` (`<home>\AppData\Roaming` when unset).
    pub app_data: String,
}

impl PlatformEnv {
    /// Read the current process environment, with the same fallbacks as the TS code.
    pub fn current() -> Self {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        let sys_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".to_string());
        let app_data = std::env::var("APPDATA")
            .unwrap_or_else(|_| format!("{home}\\AppData\\Roaming"));
        PlatformEnv {
            platform: Platform::current(),
            sys_root,
            home,
            app_data,
        }
    }
}

impl Default for PlatformEnv {
    fn default() -> Self {
        Self::current()
    }
}
use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_regex::js_regex;

/// `/^["']|["']$/g` — one leading or one trailing quote (TS `stripQuotes`, first pass).
static QUOTE_EDGE: Lazy<Regex> = Lazy::new(|| js_regex(r#"^["']|["']$"#));

/// `/["']/g` — every quote (TS `stripQuotes`, second pass).
static QUOTE_ANY: Lazy<Regex> = Lazy::new(|| js_regex(r#"["']"#));

/// Errors of the path guards. `Display` is byte-identical to the TS strings: the renderer
/// shows them to the user, so they are part of the contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathError {
    /// `'Path is empty'`
    Empty,
    /// `'Path contains null bytes'`
    NullBytes,
    /// `'Path resolves to empty'`
    ResolvesEmpty,
    /// `'Path resolves to root: <root>'`
    Root(String),
    /// `'Path accesses restricted directory: <dir>'`
    Restricted(String),
    /// `'Path is outside allowed directories'`
    OutsideAllowed,
    /// `'Path too long (<len> chars, max <max>)'` (used by the `fs:*` port)
    TooLong { len: usize, max: usize },
    /// `'Access to system directory blocked: <path>. This path is in a critical system area
    /// that cannot be modified.'`
    BlockedWrite(String),
}

impl fmt::Display for PathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PathError::Empty => write!(f, "Path is empty"),
            PathError::NullBytes => write!(f, "Path contains null bytes"),
            PathError::ResolvesEmpty => write!(f, "Path resolves to empty"),
            PathError::Root(root) => write!(f, "Path resolves to root: {root}"),
            PathError::Restricted(dir) => write!(f, "Path accesses restricted directory: {dir}"),
            PathError::OutsideAllowed => write!(f, "Path is outside allowed directories"),
            PathError::TooLong { len, max } => write!(f, "Path too long ({len} chars, max {max})"),
            PathError::BlockedWrite(path) => write!(
                f,
                "Access to system directory blocked: {path}. This path is in a critical system \
                 area that cannot be modified."
            ),
        }
    }
}

impl std::error::Error for PathError {}

/// TS `normalizePath` — separators to `\`, `.` dropped, `..` resolved lexically, the leading
/// separator preserved for absolute paths. Deliberately literal, quirks included: the
/// absolute test uses the trimmed input, the separator replacement the untrimmed one.
pub fn normalize_path(p: &str) -> String {
    let is_absolute = p.trim().starts_with(['\\', '/']);
    let normalized = p.replace('/', "\\");

    let mut resolved: Vec<&str> = Vec::new();
    for part in normalized.split('\\').filter(|part| !part.is_empty()) {
        if part == ".." {
            resolved.pop();
        } else if part != "." {
            resolved.push(part);
        }
    }

    let joined = resolved.join("\\");
    if is_absolute {
        format!("\\{joined}")
    } else {
        joined
    }
}

/// TS `isDangerousPath` — `Some(_)` means "refuse"; the payload keeps the TS wording.
pub fn is_dangerous_path(normalized: &str) -> Option<PathError> {
    let lower = normalized.to_lowercase();

    for root in DANGEROUS_ROOTS {
        let normalized_root = root.to_lowercase().replace('/', "\\");
        if lower == normalized_root || lower == format!("{normalized_root}\\") {
            return Some(PathError::Root(root.to_string()));
        }
    }

    for dangerous in DANGEROUS_PATHS {
        let d = dangerous.to_lowercase().replace('/', "\\");
        if lower == d || lower.starts_with(&format!("{d}\\")) {
            return Some(PathError::Restricted(dangerous.to_string()));
        }
    }

    None
}
/// TS `validatePath` — `Ok(())` = safe, `Err(_)` = dangerous. Use before write, delete,
/// rename and mkdir.
pub fn validate_path(file_path: &str) -> Result<(), PathError> {
    if file_path.trim().is_empty() {
        return Err(PathError::Empty);
    }
    if file_path.contains('\0') {
        return Err(PathError::NullBytes);
    }

    let normalized = normalize_path(file_path);
    if normalized.is_empty() {
        return Err(PathError::ResolvesEmpty);
    }

    match is_dangerous_path(&normalized) {
        Some(err) => Err(err),
        None => Ok(()),
    }
}

/// TS `validatePathRead` — with `None` (the TS `!allowedDirs` branch) everything passes;
/// with a list the path must be one of the directories or live inside one. An empty slice
/// behaves like the TS empty array: nothing is allowed.
pub fn validate_path_read(
    file_path: &str,
    allowed_dirs: Option<&[String]>,
) -> Result<(), PathError> {
    if file_path.trim().is_empty() {
        return Err(PathError::Empty);
    }
    if file_path.contains('\0') {
        return Err(PathError::NullBytes);
    }

    let Some(allowed_dirs) = allowed_dirs else {
        return Ok(());
    };

    let normalized = normalize_path(file_path);
    let lower = normalized.to_lowercase();

    for dir in allowed_dirs {
        let allowed = normalize_path(dir).to_lowercase();
        if lower == allowed || lower.starts_with(&format!("{allowed}\\")) {
            return Ok(());
        }
    }

    Err(PathError::OutsideAllowed)
}

/// TS `stripQuotes` — trim, drop one leading and one trailing quote, then drop every quote.
pub fn strip_quotes(p: &str) -> String {
    let without_edges = QUOTE_EDGE.replace_all(p.trim(), "");
    let without_quotes = QUOTE_ANY.replace_all(&without_edges, "");
    without_quotes.trim().to_string()
}

/// TS `expand` — a leading `~` becomes the home directory (after [`strip_quotes`]).
pub fn expand(p: &str, home: &str) -> String {
    let stripped = strip_quotes(p);
    match stripped.strip_prefix('~') {
        Some(rest) => format!("{home}{rest}"),
        None => stripped,
    }
}

/// TS `BLOCKED_WRITE_PATHS` — sensitive system directories that must never be written to or
/// deleted. `env` supplies the platform and the environment-derived parts.
pub fn blocked_write_paths(env: &PlatformEnv) -> Vec<String> {
    match env.platform {
        Platform::Windows => vec![
            join_win(&[&env.sys_root, "System32"]),
            join_win(&[&env.sys_root, "SysWOW64"]),
            join_win(&[&env.sys_root, "Boot"]),
            "C:\\".to_string(),
            "C:\\Program Files".to_string(),
            "C:\\Program Files (x86)".to_string(),
            "C:\\ProgramData".to_string(),
            join_win(&[
                &env.app_data,
                "Microsoft",
                "Windows",
                "Start Menu",
                "Programs",
                "Startup",
            ]),
            join_win(&[&env.home, ".ssh"]),
            join_win(&[&env.home, ".gnupg"]),
        ],
        Platform::Other => [
            "/etc", "/boot", "/sys", "/proc", "/dev", "/sbin", "/usr/sbin", "/usr/bin",
        ]
        .into_iter()
        .map(str::to_string)
        .collect(),
    }
}

/// TS `assertNotBlockedWrite` — `Ok(())` when the resolved path is outside the blocklist.
pub fn assert_not_blocked_write(
    resolved_path: &str,
    blocked: &[String],
) -> Result<(), PathError> {
    let normalized = resolved_path.to_lowercase().replace('\\', "/");

    for entry in blocked {
        let blocked_normalized = entry.to_lowercase().replace('\\', "/");
        if normalized == blocked_normalized
            || normalized.starts_with(&format!("{blocked_normalized}/"))
        {
            return Err(PathError::BlockedWrite(resolved_path.to_string()));
        }
    }

    Ok(())
}

/// `path.win32.join` — as much of it as the blocklist needs: `\` separators, no trailing
/// separator (the comparison normalises separators anyway).
fn join_win(parts: &[&str]) -> String {
    parts
        .iter()
        .map(|part| part.trim_end_matches(['\\', '/']))
        .collect::<Vec<_>>()
        .join("\\")
}


