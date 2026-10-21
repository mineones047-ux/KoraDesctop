//! Audit log — the Rust port of `electron/services/audit-log.ts`
//! (`~/.kora/audit.log`, JSON lines, 10 MB rotation).
//!
//! Contract kept from the TS implementation:
//!   * one JSON object per line, ISO-8601 `timestamp` field appended last;
//!   * rotation renames `audit.log` to `audit-<millis>.log` once it exceeds
//!     10 MB;
//!   * writing must never throw into the caller — failures surface as the
//!     `Err` of the io result only where the caller opted in; [`AuditLog::append`]
//!     itself returns `io::Result` so the core decides (the TS code only
//!     logged to console; the Rust core has stderr).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

pub const MAX_LOG_SIZE: u64 = 10 * 1024 * 1024;

pub struct AuditLog {
    path: PathBuf,
}

impl AuditLog {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append one event as a JSON line. Rotates first when the file grew past
    /// [`MAX_LOG_SIZE`]. Creates the parent dir on demand.
    pub fn append(&self, event: &Value) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.rotate_if_needed()?;

        let mut line = event.clone();
        if let Some(obj) = line.as_object_mut() {
            obj.insert("timestamp".into(), json!(iso8601_now()));
        }
        let mut out = serde_json::to_string(&line).map_err(io::Error::other)?;
        out.push('\n');

        use std::io::Write;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        f.write_all(out.as_bytes())
    }

    fn rotate_if_needed(&self) -> io::Result<()> {
        let size = match fs::metadata(&self.path) {
            Ok(m) => m.len(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        if size > MAX_LOG_SIZE {
            let rotated = self
                .path
                .with_file_name(format!("audit-{}.log", now_millis()));
            fs::rename(&self.path, rotated)?;
        }
        Ok(())
    }
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// ISO-8601 UTC timestamp with milliseconds — the shape
/// `new Date().toISOString()` produces ("2026-09-25T12:34:56.789Z").
pub fn iso8601_now() -> String {
    // Minimal civil-from-days conversion (Howard Hinnant's algorithm) — no
    // chrono dependency for one timestamp.
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = dur.as_secs() as i64;
    let millis = dur.subsec_millis();

    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (h, m, s) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{d:02}T{h:02}:{m:02}:{s:02}.{millis:03}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appends_json_lines_with_timestamp() {
        let dir = tempfile::tempdir().unwrap();
        let log = AuditLog::new(dir.path().join("audit.log"));

        log.append(&json!({ "type": "shell_execute", "action": "execute", "details": { "command": "dir" }, "success": true })).unwrap();
        log.append(&json!({ "type": "shell_execute", "action": "execute", "details": { "command": "ls" }, "success": false, "blocked": true })).unwrap();

        let content = fs::read_to_string(log.path()).unwrap();
        let lines: Vec<&str> = content.trim().lines().collect();
        assert_eq!(lines.len(), 2);
        for line in lines {
            let v: Value = serde_json::from_str(line).unwrap();
            assert!(v["timestamp"].as_str().unwrap().ends_with('Z'));
            assert_eq!(v["type"], "shell_execute");
        }
    }

    #[test]
    fn rotates_oversized_log() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.log");
        // Pretend an old log is over the limit.
        fs::write(&path, "x".repeat(MAX_LOG_SIZE as usize + 1)).unwrap();

        let log = AuditLog::new(path.clone());
        log.append(&json!({ "type": "system_control" })).unwrap();

        assert!(
            fs::metadata(&path).unwrap().len() < 1000,
            "current log must be fresh"
        );
        let entries: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("audit-") && n.ends_with(".log"))
            .collect();
        assert_eq!(entries.len(), 1, "rotated file missing: {entries:?}");
    }

    #[test]
    fn small_log_is_not_rotated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audit.log");
        let log = AuditLog::new(path.clone());
        log.append(&json!({"a":1})).unwrap();
        log.append(&json!({"a":2})).unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"a\":1") && content.contains("\"a\":2"));
    }

    #[test]
    fn iso8601_shape_matches_js() {
        let ts = iso8601_now();
        // 2026-09-25T18:50:20.123Z
        assert_eq!(ts.len(), 24);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[10..11], "T");
        assert!(ts.ends_with('Z'));
    }
}
