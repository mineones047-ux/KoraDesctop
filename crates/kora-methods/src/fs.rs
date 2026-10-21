//! The `fs.*` domain — the Rust port of the fs half of `core/methods.ts` /
//! `electron/ipc/filesystem.ts`.
//!
//! Every path goes through [`kora_security::guard::resolve_safe_path`] (quote stripping,
//! `~` expansion, absolute resolution, length cap) and every write additionally through
//! [`kora_security::guard::assert_safe_write_target`], which re-checks the blocklist on
//! the symlink-resolved form. This runs **inside the core** on every call: the caller
//! is untrusted, so the checks are not optional and never skippable from the wire.
//!
//! Writes are atomic (tmp file with a random suffix + rename) via `kora-store`.

use std::sync::Arc;

use kora_rpc::{MethodSpec, MethodTable, RpcHandlerFuture};
use kora_security::regex_guard::match_glob;
use serde_json::{json, Value};

use crate::{positional, require_str, Env};

type E = Arc<Env>;

/// Read a file, truncating at `max_bytes` (default 5 MB) with the TS truncation notice.
/// Synchronous on purpose — it is called from inside an async handler, and a blocking
/// file read here is bounded by the same size caps the TS code had.
fn read_file(p: &str, max_bytes: Option<u64>) -> std::io::Result<String> {
    let meta = std::fs::metadata(p)?;
    let limit = max_bytes.filter(|n| *n > 0).unwrap_or(5 * 1024 * 1024);
    if meta.len() > limit {
        let content = read_limited(p, limit as usize)?;
        return Ok(format!(
            "{content}\n\n[TRUNCATED: file is {} bytes, read first {limit}]",
            meta.len()
        ));
    }
    std::fs::read_to_string(p)
}

/// Read at most `limit` bytes and decode as UTF-8 (lossy, like Node's `toString`).
fn read_limited(path: &str, limit: usize) -> std::io::Result<String> {
    use std::io::Read;
    let mut buf = vec![0u8; limit];
    let mut f = std::fs::File::open(path)?;
    let read = f.read(&mut buf)?;
    buf.truncate(read);
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Register every `fs.*` method.
pub fn register(table: &mut MethodTable, env: E) {
    macro_rules! fs_method {
        ($name:expr, $f:expr) => {{
            let captured = env.clone();
            table.insert(
                $name.to_string(),
                MethodSpec {
                    capability: "fs",
                    handler: Box::new(move |params| {
                        let env = captured.clone();
                        let f = $f;
                        Box::pin(async move { f(params, env).await }) as RpcHandlerFuture
                    }),
                },
            );
        }};
    }

    fs_method!("fs.readDir", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let resolved = resolve(&path, &env)?;
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&resolved).to_rpc()? {
            let entry = entry.to_rpc()?;
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            out.push(json!({
                "name": entry.file_name().to_string_lossy(),
                "isDirectory": is_dir,
                "path": std::path::Path::new(&resolved).join(entry.file_name()).to_string_lossy(),
            }));
        }
        Ok(Value::Array(out))
    });

    fs_method!("fs.readFile", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let max_bytes = positional(p.as_ref(), 1).and_then(Value::as_u64);
        let resolved = resolve(&path, &env)?;
        let content = read_file(&resolved, max_bytes).to_rpc()?;
        Ok(Value::String(content))
    });

    fs_method!("fs.writeFile", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let content = require_str(p.as_ref(), 1, "content")?;
        let resolved = write_target(&path, &env)?;
        if let Some(parent) = std::path::Path::new(&resolved).parent() {
            std::fs::create_dir_all(parent).to_rpc()?;
        }
        kora_store::atomic::write_atomic(std::path::Path::new(&resolved), &content).to_rpc()?;
        Ok(json!({ "success": true }))
    });

    fs_method!("fs.mkdir", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let resolved = write_target(&path, &env)?;
        std::fs::create_dir_all(&resolved).to_rpc()?;
        Ok(json!({ "success": true }))
    });

    fs_method!("fs.stat", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let resolved = resolve(&path, &env)?;
        let meta = std::fs::metadata(&resolved).to_rpc()?;
        Ok(json!({
            "size": meta.len(),
            "isDirectory": meta.is_dir(),
            "isFile": meta.is_file(),
            "created": iso8601(&meta),
            "modified": iso8601(&meta),
        }))
    });

    fs_method!("fs.exists", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        // A resolution failure is still "does not exist" for the caller — the TS
        // handler wraps the whole body in try/catch and returns { exists: false }.
        let exists = match resolve(&path, &env) {
            Ok(resolved) => std::path::Path::new(&resolved).exists(),
            Err(_) => false,
        };
        Ok(json!({ "exists": exists }))
    });

    let env_for_home = env.clone();
    table.insert(
        "fs.homeDir".to_string(),
        MethodSpec {
            capability: "fs",
            handler: Box::new(move |_p| {
                let home = env_for_home.home.clone();
                Box::pin(async move { Ok(Value::String(home)) }) as RpcHandlerFuture
            }),
        },
    );

    fs_method!("fs.deleteFile", |p: Option<Value>, env: E| async move {
        let path = require_str(p.as_ref(), 0, "path")?;
        let resolved = write_target(&path, &env)?;
        let target = std::path::Path::new(&resolved);
        // The TS handler removes a directory recursively and a file with unlink.
        if target.is_dir() {
            std::fs::remove_dir_all(target).to_rpc()?;
        } else {
            std::fs::remove_file(target).to_rpc()?;
        }
        Ok(json!({ "success": true }))
    });

    fs_method!("fs.rename", |p: Option<Value>, env: E| async move {
        let old_path = require_str(p.as_ref(), 0, "oldPath")?;
        let new_path = require_str(p.as_ref(), 1, "newPath")?;
        let resolved_old = write_target(&old_path, &env)?;
        // Moving modifies the SOURCE location too — both sides are checked.
        let resolved_new = write_target(&new_path, &env)?;
        if let Some(parent) = std::path::Path::new(&resolved_new).parent() {
            std::fs::create_dir_all(parent).to_rpc()?;
        }
        std::fs::rename(&resolved_old, &resolved_new).to_rpc()?;
        Ok(json!({ "success": true }))
    });

    fs_method!("fs.copy", |p: Option<Value>, env: E| async move {
        let old_path = require_str(p.as_ref(), 0, "oldPath")?;
        let new_path = require_str(p.as_ref(), 1, "newPath")?;
        let resolved_old = resolve(&old_path, &env)?;
        let resolved_new = write_target(&new_path, &env)?;
        let meta = std::fs::metadata(&resolved_old).to_rpc()?;
        if let Some(parent) = std::path::Path::new(&resolved_new).parent() {
            std::fs::create_dir_all(parent).to_rpc()?;
        }
        if meta.is_dir() {
            copy_dir(
                std::path::Path::new(&resolved_old),
                std::path::Path::new(&resolved_new),
            )
            .to_rpc()?;
        } else {
            std::fs::copy(&resolved_old, &resolved_new).to_rpc()?;
        }
        Ok(json!({ "success": true }))
    });

    fs_method!("fs.grep", |p: Option<Value>, env: E| async move {
        use kora_security::regex_guard::is_unsafe_regex;
        // The core method takes one options object; the IPC handler takes
        // (dir, pattern, options). Both shapes are accepted.
        let o = object_of(p.as_ref());
        let pattern = o
            .get("pattern")
            .and_then(Value::as_str)
            .ok_or("pattern must be a string")?
            .to_string();
        if pattern.is_empty() || pattern.encode_utf16().count() > 200 {
            return Err("pattern must be a non-empty string up to 200 chars".into());
        }
        let dir = o
            .get("dir")
            .and_then(Value::as_str)
            .unwrap_or(".")
            .to_string();
        let max_results = o.get("maxResults").and_then(Value::as_u64).unwrap_or(100) as usize;
        let include = o.get("include").and_then(Value::as_str);
        let ci = o
            .get("caseInsensitive")
            .and_then(Value::as_bool)
            .unwrap_or(true);

        // ReDoS guard: a user-supplied pattern is compiled inside the core process.
        if is_unsafe_regex(&pattern) {
            return Err("Pattern rejected: nested or ambiguous quantifiers are not allowed".into());
        }
        let mut builder = regex::RegexBuilder::new(&pattern);
        builder.case_insensitive(ci);
        let re = builder
            .build()
            .map_err(|_| "Pattern rejected: invalid regular expression".to_string())?;

        let resolved = resolve(&dir, &env)?;
        let mut results = Vec::new();
        grep_walk(
            std::path::Path::new(&resolved),
            0,
            &re,
            include,
            max_results,
            &mut results,
        );
        let count = results.len();
        Ok(json!({ "count": count, "results": results }))
    });

    fs_method!("fs.findFiles", |p: Option<Value>, env: E| async move {
        use kora_security::regex_guard::is_unsafe_regex;
        let o = object_of(p.as_ref());
        let pattern = o
            .get("pattern")
            .and_then(Value::as_str)
            .ok_or("pattern must be a string")?
            .to_string();
        let search_dir = o
            .get("searchDir")
            .and_then(Value::as_str)
            .unwrap_or("~")
            .to_string();
        let max_results = o.get("maxResults").and_then(Value::as_u64).unwrap_or(100) as usize;
        let max_depth = o.get("maxDepth").and_then(Value::as_u64).unwrap_or(10) as u32;

        // Literal-substring guard: the needle is never compiled as a user regex.
        let needle: String = pattern
            .chars()
            .filter(|c| !matches!(c, '\\' | '/' | '"' | '<' | '>' | '|' | '*' | '?'))
            .take(200)
            .collect();
        if needle.is_empty() || is_unsafe_regex(&needle) {
            return Ok(json!({ "success": false, "error": "Invalid pattern", "results": [] }));
        }
        let needle = needle.to_lowercase();

        let resolved = resolve(&search_dir, &env)?;
        let mut results = Vec::new();
        find_walk(
            std::path::Path::new(&resolved),
            0,
            max_depth,
            max_results,
            &needle,
            &mut results,
        );
        let count = results.len();
        Ok(json!({ "success": true, "count": count, "results": results }))
    });
}

/// Normalise the accepted parameter shapes into one lookup object.
fn object_of(params: Option<&Value>) -> std::collections::BTreeMap<String, Value> {
    match params {
        Some(Value::Object(o)) => o.clone().into_iter().collect(),
        Some(Value::Array(a)) => {
            // (dir, pattern, options) — the IPC handler shape.
            let mut map = std::collections::BTreeMap::new();
            if let Some(dir) = a.first().and_then(Value::as_str) {
                map.insert("dir".into(), Value::String(dir.into()));
            }
            if let Some(pattern) = a.get(1).and_then(Value::as_str) {
                map.insert("pattern".into(), Value::String(pattern.into()));
            }
            if let Some(Value::Object(opts)) = a.get(2) {
                for (k, v) in opts {
                    map.insert(k.clone(), v.clone());
                }
            }
            map
        }
        _ => Default::default(),
    }
}

/// `fs:grep` walker: depth 20, skips `node_modules` / `.git` / dotfiles and symlinks
/// (junction/symlink loops), 2 MB per-file read cap, 500 chars per matched line.
fn grep_walk(
    dir: &std::path::Path,
    depth: u32,
    re: &regex::Regex,
    include: Option<&str>,
    max_results: usize,
    out: &mut Vec<Value>,
) {
    if out.len() >= max_results || depth > 20 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_results {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "node_modules" || name == ".git" || name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_symlink() {
            continue; // junction/symlink loops
        }
        let full = entry.path();
        if ft.is_dir() {
            grep_walk(&full, depth + 1, re, include, max_results, out);
        } else if ft.is_file() {
            if let Some(glob) = include {
                if !match_glob(&name, glob) {
                    continue;
                }
            }
            let Ok(content) = read_limited(&full.to_string_lossy(), 2 * 1024 * 1024) else {
                continue;
            };
            for (i, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    let text: String = line.chars().take(500).collect();
                    out.push(
                        json!({ "file": full.to_string_lossy(), "line": i + 1, "text": text }),
                    );
                    if out.len() >= max_results {
                        return;
                    }
                }
            }
        }
    }
}

/// `fs:findFiles` walker: literal substring match, depth-capped, same skip rules.
fn find_walk(
    dir: &std::path::Path,
    depth: u32,
    max_depth: u32,
    max_results: usize,
    needle: &str,
    out: &mut Vec<String>,
) {
    if out.len() >= max_results || depth > max_depth {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_results {
            return;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "node_modules" || name == ".git" || name.starts_with('.') {
            continue;
        }
        let Ok(ft) = entry.file_type() else { continue };
        let full = entry.path();
        if name.to_lowercase().contains(needle) {
            out.push(full.to_string_lossy().into_owned());
        }
        if ft.is_dir() && !ft.is_symlink() {
            find_walk(&full, depth + 1, max_depth, max_results, needle, out);
        }
    }
}

/// Best-effort ISO-8601 timestamp. Windows creation time is not exposed by
/// `std::fs::Metadata` without extra API calls, so both fields carry mtime; the shape
/// the renderer expects is preserved.
fn iso8601(meta: &std::fs::Metadata) -> String {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| format_iso(d.as_secs(), d.subsec_nanos()))
        .unwrap_or_default()
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ` from a Unix timestamp (civil-time conversion, no chrono).
fn format_iso(secs: u64, nanos: u32) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60,
        nanos / 1_000_000
    )
}

/// Howard Hinnant's `civil_from_days` algorithm.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// The fs handlers talk to the filesystem, so their natural error type is
/// `std::io::Error` — but the RPC contract carries `String`. This extension makes `?`
/// do that conversion automatically instead of sprinkling `map_err` at every call.
trait IoResultExt<T> {
    fn to_rpc(self) -> Result<T, String>;
}

impl<T> IoResultExt<T> for std::io::Result<T> {
    fn to_rpc(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

/// `resolveSafePath` with the TS error mapped onto a `String` for the RPC error channel.
fn resolve(path: &str, env: &Env) -> Result<String, String> {
    kora_security::guard::resolve_safe_path(path, &env.home).map_err(|e| e.to_string())
}

/// `resolveSafePath` + `assertSafeWriteTarget` — the mandatory pair for any mutation.
fn write_target(path: &str, env: &Env) -> Result<String, String> {
    let resolved = resolve(path, env)?;
    kora_security::guard::assert_safe_write_target(&resolved, &env.platform)
        .map_err(|e| e.to_string())?;
    Ok(resolved)
}

/// Recursive directory copy (the TS `fs.cp` with `recursive: true`).
fn copy_dir(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn table_for(home: &str) -> MethodTable {
        let mut t = MethodTable::new();
        register(&mut t, Arc::new(Env::for_home(home)));
        t
    }

    /// Run one handler to completion. A current-thread tokio runtime is used rather
    /// than a hand-rolled `block_on`: the shell handlers in this crate really spawn
    /// processes, so a real reactor has to exist, and using the same executor
    /// everywhere keeps the harness simple.
    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(fut)
    }

    fn call(t: &MethodTable, name: &str, params: Value) -> Result<Value, String> {
        let spec = t.get(name).expect("method must exist");
        let fut: RpcHandlerFuture = (spec.handler)(Some(params));
        block_on(fut)
    }

    #[test]
    fn read_and_write_roundtrip_in_a_real_temp_dir() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let file = dir.path().join("note.txt");

        let w = call(
            &t,
            "fs.writeFile",
            json!([file.to_string_lossy(), "hello kora"]),
        );
        assert_eq!(w.unwrap()["success"], json!(true));
        assert_eq!(
            call(&t, "fs.readFile", json!([file.to_string_lossy()]))
                .unwrap()
                .as_str(),
            Some("hello kora")
        );
    }

    #[test]
    fn exists_reports_both_directions() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let present = dir.path().join("there.txt");
        std::fs::write(&present, "x").unwrap();

        assert_eq!(
            call(&t, "fs.exists", json!([present.to_string_lossy()])).unwrap()["exists"],
            json!(true)
        );
        assert_eq!(
            call(
                &t,
                "fs.exists",
                json!([dir.path().join("nope.txt").to_string_lossy()])
            )
            .unwrap()["exists"],
            json!(false)
        );
    }

    #[test]
    fn read_dir_lists_entries_with_their_type() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        std::fs::create_dir(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("f.txt"), "x").unwrap();

        let out = call(&t, "fs.readDir", json!([dir.path().to_string_lossy()])).unwrap();
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert!(arr
            .iter()
            .any(|e| e["name"] == "sub" && e["isDirectory"] == json!(true)));
        assert!(arr
            .iter()
            .any(|e| e["name"] == "f.txt" && e["isDirectory"] == json!(false)));
    }

    #[test]
    fn readfile_truncates_and_appends_the_ts_notice() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let file = dir.path().join("big.txt");
        std::fs::write(&file, "x".repeat(5000)).unwrap();

        let out = call(&t, "fs.readFile", json!([file.to_string_lossy(), 100])).unwrap();
        let s = out.as_str().unwrap();
        assert!(s.contains("[TRUNCATED: file is 5000 bytes, read first 100]"));
    }

    #[test]
    fn grep_finds_matches_with_line_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        std::fs::write(dir.path().join("a.txt"), "nothing here\nneedle inside\n").unwrap();

        let out = call(
            &t,
            "fs.grep",
            json!({ "dir": dir.path().to_string_lossy(), "pattern": "needle" }),
        )
        .unwrap();
        assert_eq!(out["count"], json!(1));
        assert_eq!(out["results"][0]["line"], json!(2));
        assert_eq!(out["results"][0]["text"], json!("needle inside"));
    }

    #[test]
    fn grep_refuses_a_redos_pattern() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let err = call(
            &t,
            "fs.grep",
            json!({ "dir": dir.path().to_string_lossy(), "pattern": "(a+)+$" }),
        )
        .unwrap_err();
        assert!(err.contains("Pattern rejected"), "got: {err}");
    }

    #[test]
    fn findfiles_matches_literally_and_skips_dotfiles() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        std::fs::write(dir.path().join("report.md"), "x").unwrap();
        std::fs::write(dir.path().join(".hidden"), "x").unwrap();
        std::fs::create_dir(dir.path().join("node_modules")).unwrap();

        let out = call(
            &t,
            "fs.findFiles",
            json!({ "pattern": "report", "searchDir": dir.path().to_string_lossy() }),
        )
        .unwrap();
        assert_eq!(out["count"], json!(1));
        assert!(out["results"][0].as_str().unwrap().ends_with("report.md"));
    }

    #[test]
    fn findfiles_rejects_a_pattern_that_is_all_glob_characters() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let out = call(
            &t,
            "fs.findFiles",
            json!({ "pattern": "***", "searchDir": dir.path().to_string_lossy() }),
        )
        .unwrap();
        assert_eq!(out["success"], json!(false));
        assert_eq!(out["error"], json!("Invalid pattern"));
    }

    #[test]
    fn mkdir_delete_rename_and_copy_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let nested = dir.path().join("a").join("b");

        call(&t, "fs.mkdir", json!([nested.to_string_lossy()])).unwrap();
        assert!(nested.exists());

        let src = nested.join("f.txt");
        std::fs::write(&src, "data").unwrap();
        let moved = dir.path().join("a").join("g.txt");
        call(
            &t,
            "fs.rename",
            json!([src.to_string_lossy(), moved.to_string_lossy()]),
        )
        .unwrap();
        assert!(moved.exists() && !src.exists());

        let copy = dir.path().join("a").join("h.txt");
        call(
            &t,
            "fs.copy",
            json!([moved.to_string_lossy(), copy.to_string_lossy()]),
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&copy).unwrap(), "data");

        call(&t, "fs.deleteFile", json!([copy.to_string_lossy()])).unwrap();
        assert!(!copy.exists());
    }

    #[test]
    fn stat_returns_the_shape_the_renderer_expects() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_for(&dir.path().to_string_lossy());
        let file = dir.path().join("s.txt");
        std::fs::write(&file, "12345").unwrap();

        let out = call(&t, "fs.stat", json!([file.to_string_lossy()])).unwrap();
        assert_eq!(out["size"], json!(5));
        assert_eq!(out["isFile"], json!(true));
        assert_eq!(out["isDirectory"], json!(false));
        assert!(out["modified"].as_str().unwrap().ends_with('Z'));
    }

    #[test]
    fn every_fs_method_the_shim_calls_is_registered() {
        let t = table_for("/tmp/kora-home-x");
        for name in [
            "fs.readDir",
            "fs.readFile",
            "fs.writeFile",
            "fs.mkdir",
            "fs.stat",
            "fs.exists",
            "fs.deleteFile",
            "fs.rename",
            "fs.copy",
            "fs.grep",
            "fs.findFiles",
            "fs.homeDir",
        ] {
            assert!(t.contains_key(name), "missing method {name}");
        }
    }

    #[test]
    fn iso8601_renders_a_known_instant() {
        // Cross-checked against `new Date(...).toISOString()` in Node — the same
        // output the TS `mtime.toISOString()` produced.
        assert_eq!(format_iso(1_704_067_200, 0), "2024-01-01T00:00:00.000Z");
        // 2000-02-29 — a leap day, to catch an off-by-one in the day math.
        assert_eq!(
            format_iso(951_825_296, 789_000_000),
            "2000-02-29T11:54:56.789Z"
        );
    }
}
