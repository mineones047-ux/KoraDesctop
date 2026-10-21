//! Atomic file persistence primitives — the `~/.kora` write discipline
//! (docs/ROADMAP.md §6.5, PROJECT_HANDOFF invariant: "main → disk only through
//! validated atomic writes").
//!
//! Every write goes tmp + rename; the tmp name carries a random suffix so two
//! concurrent writers can never collide on a predictable filename
//! (electron/services/config.ts convention).

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use rand::RngCore;

/// Write `data` to `target` atomically: write a sibling tmp file with a random
/// suffix, then rename over the target. Creates parent directories. On any
/// failure the tmp file is removed best-effort, leaving any previous target
/// intact.
pub fn write_atomic(target: &Path, data: &str) -> io::Result<()> {
    let dir = target.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "target has no parent directory",
        )
    })?;
    fs::create_dir_all(dir)?;

    let mut suffix = [0u8; 6];
    rand::thread_rng().fill_bytes(&mut suffix);
    let tmp: PathBuf = target.parent().unwrap_or(Path::new(".")).join(format!(
        "{}.kora-{}",
        file_name_or_default(target),
        hex_encode(&suffix)
    ));

    let write = (|| -> io::Result<()> {
        fs::write(&tmp, data)?;
        fs::rename(&tmp, target)
    })();

    if write.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    write
}

fn file_name_or_default(p: &Path) -> String {
    p.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "file".into())
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_atomic_creates_file_and_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("nested").join("file.json");
        write_atomic(&target, "{\"a\":1}").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "{\"a\":1}");
    }

    #[test]
    fn write_atomic_overwrites_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("f.txt");
        write_atomic(&target, "v1").unwrap();
        write_atomic(&target, "v2").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "v2");
    }

    #[test]
    fn no_tmp_files_left_behind() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("f.txt");
        write_atomic(&target, "data").unwrap();
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".kora-"))
            .collect();
        assert!(leftovers.is_empty(), "leftover tmp files: {leftovers:?}");
    }
}
