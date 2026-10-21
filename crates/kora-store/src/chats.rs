//! Chats persistence — the Rust port of `electron/ipc/chats.ts`.
//!
//! Frozen format (`~/.kora/chats.json`, pretty-printed JSON array): the field
//! set of chat and message objects is sanitised field by field exactly like
//! `sanitizeChats()` — unknown fields drop, wrong-typed fields get defaults,
//! chats without an `id` drop. A corrupted file is renamed to
//! `chats.json.corrupt-<millis>` instead of being silently wiped.

use std::fs;
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::atomic::write_atomic;

/// Milliseconds since the Unix epoch (matches `Date.now()` in the TS code).
fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn as_string(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or("").to_string()
}

fn as_number_or(v: Option<&Value>, default: u128) -> u128 {
    v.and_then(Value::as_u64)
        .map(|n| n as u128)
        .unwrap_or(default)
}

/// Sanitise the chats structure field by field, mirroring `sanitizeChats()`.
/// Returns the sanitised array value (still a `Value` so unknown-shape input
/// round-trips through the same code path as the TS implementation).
pub fn sanitize_chats(value: &Value) -> Value {
    let arr = match value.as_array() {
        Some(a) => a,
        None => return json!([]),
    };

    let chats: Vec<Value> = arr
        .iter()
        .filter(|c| c.is_object())
        .map(|c| {
            let now = now_millis();
            let messages: Vec<Value> = c
                .get("messages")
                .and_then(Value::as_array)
                .map(|ms| {
                    ms.iter()
                        .filter(|m| m.is_object())
                        .map(|m| {
                            json!({
                                "id": as_string(m.get("id")),
                                "role": m.get("role").and_then(Value::as_str).unwrap_or("user"),
                                "content": as_string(m.get("content")),
                                "timestamp": as_number_or(m.get("timestamp"), now),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();

            json!({
                "id": as_string(c.get("id")),
                "title": as_string(c.get("title")),
                "createdAt": as_number_or(c.get("createdAt"), now),
                "updatedAt": as_number_or(c.get("updatedAt"), now),
                "messages": messages,
            })
        })
        .filter(|c| !c["id"].as_str().unwrap_or("").is_empty())
        .collect();

    Value::Array(chats)
}

/// Load + sanitise chats from `path`. Missing file → empty array (first run).
/// Corrupted JSON → back the file up to `<path>.corrupt-<millis>` and return
/// an empty array (the TS contract: never silently wipe the history).
pub fn load_chats(path: &Path) -> io::Result<Value> {
    let content = match fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(json!([])),
        Err(e) => return Err(e),
    };
    match serde_json::from_str::<Value>(&content) {
        Ok(parsed) => Ok(parsed),
        Err(_) => {
            let backup = path.with_extension(format!("json.corrupt-{}", now_millis()));
            let _ = fs::rename(path, backup);
            Ok(json!([]))
        }
    }
    .map(|raw| sanitize_chats(&raw))
}

/// Sanitise and persist chats atomically (tmp + rename).
pub fn save_chats(path: &Path, chats: &Value) -> io::Result<()> {
    let safe = sanitize_chats(chats);
    // Pretty-print with 2-space indent, same as JSON.stringify(x, null, 2).
    let body = serde_json::to_string_pretty(&safe).map_err(io::Error::other)?;
    write_atomic(path, &body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sanitize_drops_chats_without_id_and_wrong_shapes() {
        let input = json!([
            { "id": "keep", "title": "t" },
            { "title": "no id" },
            "just a string",
            42
        ]);
        let out = sanitize_chats(&input);
        let arr = out.as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["id"], "keep");
    }

    #[test]
    fn sanitize_applies_ts_field_defaults() {
        let input = json!([{
            "id": "c1",
            "title": 123,
            "createdAt": "bad",
            "messages": [ { "role": "assistant" }, "junk" ]
        }]);
        let out = sanitize_chats(&input);
        let c = &out[0];
        assert_eq!(c["title"], "");
        assert_eq!(c["messages"].as_array().unwrap().len(), 1);
        let m = &c["messages"][0];
        assert_eq!(m["id"], "");
        assert_eq!(m["role"], "assistant");
        assert_eq!(m["content"], "");
        // timestamp defaulted to now
        assert!(m["timestamp"].as_u64().unwrap() > 1_700_000_000_000);
    }

    #[test]
    fn sanitize_keeps_valid_messages_untouched() {
        let input = json!([{
            "id": "c1",
            "title": "t",
            "createdAt": 111,
            "updatedAt": 222,
            "messages": [{ "id": "m1", "role": "user", "content": "hi", "timestamp": 333 }]
        }]);
        let out = sanitize_chats(&input);
        assert_eq!(out[0]["createdAt"], 111);
        assert_eq!(out[0]["messages"][0]["content"], "hi");
        assert_eq!(out[0]["messages"][0]["timestamp"], 333);
    }

    #[test]
    fn sanitize_non_array_returns_empty() {
        assert_eq!(sanitize_chats(&json!({"nope": 1})), json!([]));
        assert_eq!(sanitize_chats(&json!("str")), json!([]));
    }

    #[test]
    fn roundtrip_save_load_preserves_fields() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chats.json");
        let chats = json!([{
            "id": "c1",
            "title": "Test",
            "createdAt": 1,
            "updatedAt": 2,
            "messages": [{ "id": "m1", "role": "user", "content": "hello", "timestamp": 3 }]
        }]);
        save_chats(&path, &chats).unwrap();
        let loaded = load_chats(&path).unwrap();
        assert_eq!(loaded, chats);
    }

    #[test]
    fn corrupted_file_is_backed_up_not_wiped() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("chats.json");
        std::fs::write(&path, "{ definitely not json").unwrap();

        let loaded = load_chats(&path).unwrap();
        assert_eq!(loaded, json!([]));

        let entries: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert!(
            entries.iter().any(|n| n.starts_with("chats.json.corrupt-")),
            "no corrupt backup found in {entries:?}"
        );
    }

    #[test]
    fn missing_file_is_first_run_empty() {
        let dir = tempfile::tempdir().unwrap();
        let loaded = load_chats(&dir.path().join("chats.json")).unwrap();
        assert_eq!(loaded, json!([]));
    }
}
