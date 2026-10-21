//! The fs write-guard pair — the Rust port of `electron/lib/path-guard.ts`
//! (`resolveSafePath`, `realpathDeepest`, `assertSafeWriteTarget`).
//!
//! Why it is separate from [`crate::path`]: that module is pure string logic (path
//! normalisation, the write blocklist) so it can be tested identically on any host.
//! This module touches the filesystem, because the whole point of
//! `assertSafeWriteTarget` is to resolve symlinks/junctions: a link inside an allowed
//! directory that points at System32 used to pass a purely lexical check, since only
//! the user-facing path was examined. Both the literal path AND its resolved form must
//! be outside the blocklist.
//!
//! Rules preserved from the TS source:
//!   * the expansion chain is verbatim — trim, strip one leading and one trailing
//!     quote, drop every remaining quote, trim, expand a leading `~`, then resolve;
//!   * the length cap is applied to the **resolved** path;
//!   * `realpathDeepest` walks up to the deepest existing ancestor and re-appends the
//!     not-yet-created suffix, so a file that is about to be created is still checked;
//!   * error strings reach the UI, so they are byte-identical to the TS ones.

use std::path::{Path, PathBuf};

use crate::path::{assert_not_blocked_write, expand, PathError, PlatformEnv, MAX_PATH_LENGTH};

/// `resolveSafePath(inputPath)` — normalise a user-provided path to an absolute path.
///
/// Node's `path.resolve` is CWD-relative for relative input; the Rust equivalent is
/// [`std::path::absolute`], which resolves against the process CWD the same way.
pub fn resolve_safe_path(input_path: &str, home: &str) -> Result<String, PathError> {
    let expanded = expand(input_path, home);
    // Node's `path.resolve` can only fail on a null byte or a non-UTF8 CWD; map the
    // io error onto the existing "Path contains null bytes" contract, which is the
    // only way a user can actually trigger it.
    let resolved = if expanded.is_empty() {
        std::path::absolute(".").map_err(|e| io_error_to_path_error(e, &expanded))?
    } else {
        std::path::absolute(&expanded).map_err(|e| io_error_to_path_error(e, &expanded))?
    };
    let resolved = normalise_separators(&resolved.to_string_lossy());

    let len = resolved.chars().count();
    if len > MAX_PATH_LENGTH {
        return Err(PathError::TooLong {
            len,
            max: MAX_PATH_LENGTH,
        });
    }
    Ok(resolved)
}

/// `std::io::Error` → the closest `PathError`, keeping the TS-facing wording.
fn io_error_to_path_error(e: std::io::Error, input: &str) -> PathError {
    if input.contains('\0') || e.kind() == std::io::ErrorKind::InvalidInput {
        PathError::NullBytes
    } else {
        PathError::ResolvesEmpty
    }
}

/// `path.resolve` output keeps `\` separators on Windows; the blocklist comparison
/// normalises anyway, but the length cap and the messages must not count a separator
/// difference, so the string is returned in the platform's native form.
fn normalise_separators(p: &str) -> String {
    if cfg!(windows) {
        p.to_string()
    } else {
        p.replace('\\', "/")
    }
}

/// `realpathDeepest(target)` — realpath of the deepest **existing** ancestor plus the
/// remaining, not-yet-created suffix.
pub fn realpath_deepest(target: &Path) -> PathBuf {
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = target.to_path_buf();

    loop {
        if let Ok(real) = std::fs::canonicalize(&cur) {
            let mut out = real;
            // `tail` was collected outermost-first; put it back in order.
            for segment in tail.iter().rev() {
                out.push(segment);
            }
            return out;
        }
        let parent = match cur.parent() {
            Some(p) if p != cur => p.to_path_buf(),
            _ => return target.to_path_buf(),
        };
        let name = match cur.file_name() {
            Some(n) => n.to_os_string(),
            None => return target.to_path_buf(),
        };
        tail.push(name);
        cur = parent;
    }
}

/// `assertSafeWriteTarget(resolvedPath)` — the full write check: the literal path and
/// its symlink-resolved form must both be outside the blocklist.
pub fn assert_safe_write_target(resolved_path: &str, env: &PlatformEnv) -> Result<(), PathError> {
    let blocked = crate::path::blocked_write_paths(env);
    assert_not_blocked_write(resolved_path, &blocked)?;

    let real = realpath_deepest(Path::new(resolved_path));
    let real = normalise_separators(&real.to_string_lossy());
    if !real.eq_ignore_ascii_case(resolved_path) {
        assert_not_blocked_write(&real, &blocked)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::path::Platform;

    fn win_env() -> PlatformEnv {
        PlatformEnv {
            platform: Platform::Windows,
            sys_root: "C:\\Windows".into(),
            home: "C:\\Users\\t".into(),
            app_data: "C:\\Users\\t\\AppData\\Roaming".into(),
        }
    }

    #[test]
    fn strips_quotes_and_expands_home() {
        assert_eq!(
            resolve_safe_path("\"C:/Users/t/x.txt\"", "C:\\Users\\t").unwrap(),
            "C:\\Users\\t\\x.txt"
        );
        assert_eq!(
            resolve_safe_path("  'C:/Users/t/y.txt'  ", "C:\\Users\\t").unwrap(),
            "C:\\Users\\t\\y.txt"
        );
        assert_eq!(
            resolve_safe_path("~/notes.md", "C:\\Users\\t").unwrap(),
            "C:\\Users\\t\\notes.md"
        );
    }

    #[test]
    fn relative_path_resolves_to_an_absolute_path() {
        let out = resolve_safe_path(".", "C:\\Users\\t").unwrap();
        assert!(
            Path::new(&out).is_absolute(),
            "expected an absolute path, got {out}"
        );
    }

    #[test]
    fn overlong_path_is_rejected() {
        let long = format!("C:/{}", "a".repeat(MAX_PATH_LENGTH));
        let err = resolve_safe_path(&long, "C:\\Users\\t").unwrap_err();
        assert!(matches!(
            err,
            PathError::TooLong { max, .. } if max == MAX_PATH_LENGTH
        ));
    }

    #[test]
    fn blocked_roots_are_refused() {
        assert!(assert_safe_write_target("C:\\Program Files\\x.txt", &win_env()).is_err());
        assert!(assert_safe_write_target("C:/Program Files (x86)/y.dll", &win_env()).is_err());
        assert!(
            assert_safe_write_target("C:\\Windows\\System32\\drivers\\etc\\hosts", &win_env())
                .is_err()
        );
    }

    #[test]
    fn ordinary_user_paths_are_allowed() {
        assert!(assert_safe_write_target("C:\\Users\\t\\Documents\\note.md", &win_env()).is_ok());
    }

    #[test]
    fn realpath_deepest_keeps_the_missing_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let real_dir = std::fs::canonicalize(dir.path()).unwrap();
        let missing = real_dir.join("not-created-yet.txt");
        assert_eq!(realpath_deepest(&missing), missing);
    }

    #[test]
    fn realpath_deepest_resolves_existing_paths() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("f.txt");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            realpath_deepest(&file),
            std::fs::canonicalize(&file).unwrap()
        );
    }

    #[cfg(windows)]
    #[test]
    fn symlink_into_a_blocked_area_is_refused() {
        // The exact attack the TS guard was written for: a link in an allowed
        // directory pointing at a protected one.
        let protected = std::path::Path::new("C:\\Windows\\System32\\config");
        if !protected.exists() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("innocent.txt");
        if std::os::windows::fs::symlink_dir(protected, &link).is_err() || !link.exists() {
            return; // no symlink privilege on this machine — nothing to assert
        }
        let resolved = resolve_safe_path(&link.to_string_lossy(), "C:\\Users\\t").unwrap();
        assert!(
            assert_safe_write_target(&resolved, &win_env()).is_err(),
            "a symlink into System32 must be refused even though the link path is fine"
        );
    }
}
