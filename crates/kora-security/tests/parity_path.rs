//! Parity tests for [`kora_security::path`] — one test per `it()` of
//! `src/lib/__tests__/path-security.test.ts`, one assertion per `expect()`.
//!
//! Where the TS suite used `toBeTruthy()` to mean "refused" this asserts `is_err()`, and where
//! it compared an exact string this compares `to_string()` — that is stricter, and the exact
//! texts are part of the contract (they reach the UI).

use kora_security::path::{validate_path, validate_path_read};

// describe('validatePath')

#[test]
fn rejects_empty_paths() {
    assert_eq!(validate_path("").unwrap_err().to_string(), "Path is empty");
    assert_eq!(
        validate_path("   ").unwrap_err().to_string(),
        "Path is empty"
    );
}

#[test]
fn rejects_null_bytes() {
    assert!(validate_path("C:\\Users\\test\0.txt").is_err());
}

#[test]
fn rejects_root_paths() {
    assert!(validate_path("C:\\").is_err());
    assert!(validate_path("C:").is_err());
    assert!(validate_path("/").is_err());
}

#[test]
fn rejects_windows_system_directories() {
    assert!(validate_path("C:\\Windows").is_err());
    assert!(validate_path("C:\\Windows\\System32").is_err());
    assert!(validate_path("C:\\Program Files").is_err());
    assert!(validate_path("C:\\ProgramData").is_err());
}

#[test]
fn rejects_linux_system_directories() {
    // FIXED in TS: normalizePath preserves the leading slash for absolute paths.
    assert!(validate_path("/etc").is_err());
    assert!(validate_path("/etc/passwd").is_err());
    assert!(validate_path("/boot").is_err());
    assert!(validate_path("/proc").is_err());
    assert!(validate_path("/sys").is_err());
    assert!(validate_path("/dev").is_err());
}

#[test]
fn allows_user_directories() {
    assert!(validate_path("C:\\Users\\test\\Documents").is_ok());
    assert!(validate_path("~/projects").is_ok());
    assert!(validate_path("/home/user/projects").is_ok());
}

#[test]
fn handles_path_traversal_attempts() {
    // `..` components are resolved lexically, without touching the filesystem.
    let result = validate_path("C:\\Users\\test\\..\\..\\Windows");
    assert!(result.is_err());
    // Extra strictness over the TS suite (which only checks "truthy"): the exact wording.
    assert_eq!(
        result.unwrap_err().to_string(),
        "Path accesses restricted directory: C:\\Windows"
    );
}

// describe('validatePathRead')

#[test]
fn allows_paths_within_allowed_directories() {
    let allowed = vec!["C:\\Users\\test\\projects".to_string()];
    assert!(validate_path_read("C:\\Users\\test\\projects\\file.txt", Some(&allowed)).is_ok());
    assert!(
        validate_path_read("C:\\Users\\test\\projects\\subdir\\file.txt", Some(&allowed)).is_ok()
    );
}

#[test]
fn rejects_paths_outside_allowed_directories() {
    let allowed = vec!["C:\\Users\\test\\projects".to_string()];
    assert!(validate_path_read("C:\\Users\\test\\Desktop\\file.txt", Some(&allowed)).is_err());
    assert!(validate_path_read("C:\\Windows\\file.txt", Some(&allowed)).is_err());
}

#[test]
fn rejects_empty_paths_in_read_validation() {
    let allowed = vec!["C:\\Users".to_string()];
    assert_eq!(
        validate_path_read("", Some(&allowed)).unwrap_err().to_string(),
        "Path is empty"
    );
}

#[test]
fn rejects_null_bytes_in_read_validation() {
    let allowed = vec!["C:\\Users".to_string()];
    assert!(validate_path_read("C:\\Users\0.txt", Some(&allowed)).is_err());
}
