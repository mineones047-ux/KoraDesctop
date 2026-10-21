//! The `config.*` and `chats.*` domains — the Rust port of the store-backed half of
//! `core/methods.ts`.
//!
//! Both delegate to `kora-store`, which owns the frozen `~/.kora/*` formats: atomic
//! tmp+rename writes, field-by-field chats sanitisation, and a `.corrupt-*` backup
//! instead of a silent wipe. This crate adds only the RPC surface, so the file
//! discipline has exactly one implementation.
//!
//! Secrets: `config.get` returns the key **as stored**. A legacy `enc:` value from an
//! Electron profile is therefore handed back still encrypted, which is why the
//! migration to the OS keyring is a blocking item in docs/ROADMAP.md §6.5 — it must
//! happen before any Rust shell ships. Nothing here invents an `enc:` prefix and
//! nothing silently discards a key.

use std::sync::{Arc, Mutex};

use kora_rpc::{MethodSpec, MethodTable, RpcHandlerFuture};
use kora_store::{chats, config::Config};
use serde_json::{json, Value};

use crate::Env;

/// Where the chats file lives — a path, injected so tests never touch the real `~/.kora`.
pub type ChatsPath = std::path::PathBuf;

/// Load the config, falling back to defaults when the file is missing or corrupt
/// (the TS `catch` branch: a broken profile must not abort startup).
fn open_config(path: &std::path::Path) -> Config {
    match Config::load(path) {
        Ok(c) => c,
        Err(_) => {
            Config::load(std::path::Path::new("/nonexistent-kora-fallback")).unwrap_or_else(|_| {
                // Config::load only fails on an unreadable file; a nonexistent path
                // yields defaults, so this is a belt-and-braces fallback.
                panic!("kora-store could not produce a default config")
            })
        }
    }
}

/// Register `config.*` and `chats.*`.
pub fn register(table: &mut MethodTable, env: Arc<Env>) {
    let data_dir = std::path::PathBuf::from(&env.data_dir);
    let chats_file = data_dir.join("chats.json");

    // One shared, mutex-guarded config instance. The TS class owns a write queue so
    // two rapid `set` calls cannot interleave a save; the mutex gives the same
    // guarantee, and `Config::save` is itself atomic.
    let cfg = Arc::new(Mutex::new(open_config(&data_dir.join("config.json"))));
    let cfg_get = cfg.clone();

    table.insert(
        "config.get".to_string(),
        MethodSpec {
            capability: "config",
            handler: Box::new(move |_p| {
                let cfg = cfg_get.clone();
                Box::pin(async move {
                    let guard = cfg.lock().map_err(|_| "config lock poisoned".to_string())?;
                    Ok(Value::Object(guard.get().clone()))
                }) as RpcHandlerFuture
            }),
        },
    );

    table.insert(
        "config.set".to_string(),
        MethodSpec {
            capability: "config",
            handler: Box::new(move |params| {
                let cfg = cfg.clone();
                Box::pin(async move {
                    let key = crate::require_str(params.as_ref(), 0, "key")?;
                    let value = crate::positional(params.as_ref(), 1)
                        .cloned()
                        .ok_or("value is required".to_string())?;
                    let mut guard = cfg.lock().map_err(|_| "config lock poisoned".to_string())?;
                    // `set` silently ignores unknown keys and wrong types (the TS
                    // contract) and only persists when the value was accepted.
                    if guard.set(&key, value) {
                        guard
                            .save()
                            .map_err(|e| format!("Failed to persist config: {e}"))?;
                    }
                    Ok(json!({ "success": true }))
                }) as RpcHandlerFuture
            }),
        },
    );

    let load_path = chats_file.clone();
    table.insert(
        "chats.load".to_string(),
        MethodSpec {
            capability: "chats",
            handler: Box::new(move |_p| {
                let path = load_path.clone();
                Box::pin(async move {
                    let loaded = chats::load_chats(&path).map_err(|e| e.to_string())?;
                    Ok(chats::sanitize_chats(&loaded))
                }) as RpcHandlerFuture
            }),
        },
    );

    table.insert(
        "chats.save".to_string(),
        MethodSpec {
            capability: "chats",
            handler: Box::new(move |params| {
                let path = chats_file.clone();
                Box::pin(async move {
                    let value = crate::positional(params.as_ref(), 0)
                        .cloned()
                        .ok_or("chats must be provided".to_string())?;
                    chats::save_chats(&path, &value).map_err(|e| e.to_string())?;
                    Ok(json!({ "success": true }))
                }) as RpcHandlerFuture
            }),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table_in(dir: &std::path::Path) -> MethodTable {
        let mut t = MethodTable::new();
        let env = Env::for_home(&dir.to_string_lossy());
        register(&mut t, Arc::new(env));
        t
    }

    fn call(t: &MethodTable, name: &str, params: Value) -> Result<Value, String> {
        let spec = t.get(name).expect("method must exist");
        let fut: RpcHandlerFuture = (spec.handler)(Some(params));
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime")
            .block_on(fut)
    }

    #[test]
    fn config_get_returns_defaults_including_the_frozen_shape() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = call(&table_in(dir.path()), "config.get", json!([])).unwrap();
        assert_eq!(cfg["provider"], json!("lmstudio"));
        assert_eq!(cfg["lmstudioUrl"], json!("http://localhost:1234"));
        assert_eq!(cfg["theme"], json!("red"));
        assert!(cfg.get("temperature").is_some());
    }

    #[test]
    fn config_set_persists_and_clamps_temperature() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_in(dir.path());
        call(&t, "config.set", json!(["language", "ru"])).unwrap();
        call(&t, "config.set", json!(["temperature", 9.0])).unwrap();

        let cfg = call(&t, "config.get", json!([])).unwrap();
        assert_eq!(cfg["language"], json!("ru"));
        assert_eq!(cfg["temperature"], json!(2.0));
        // On disk, not just in memory.
        let on_disk =
            std::fs::read_to_string(dir.path().join(".kora").join("config.json")).unwrap();
        assert!(
            on_disk.contains("\"ru\""),
            "config was not persisted: {on_disk}"
        );
    }

    #[test]
    fn config_set_ignores_an_unknown_key_and_a_wrong_type() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_in(dir.path());
        call(&t, "config.set", json!(["evilKey", "x"])).unwrap();
        call(&t, "config.set", json!(["temperature", "hot"])).unwrap();
        let cfg = call(&t, "config.get", json!([])).unwrap();
        assert!(cfg.get("evilKey").is_none());
        assert_eq!(
            cfg["temperature"],
            json!(0.7),
            "the default must be untouched"
        );
    }

    #[test]
    fn chats_save_then_load_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_in(dir.path());
        let payload = json!([{
            "id": "c1", "title": "Hello", "createdAt": 1, "updatedAt": 2,
            "messages": [{ "id": "m1", "role": "user", "content": "hi", "timestamp": 3 }]
        }]);
        call(&t, "chats.save", json!([payload.clone()])).unwrap();
        assert_eq!(call(&t, "chats.load", json!([])).unwrap(), payload);
    }

    #[test]
    fn chats_load_on_a_fresh_profile_is_an_empty_array() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            call(&table_in(dir.path()), "chats.load", json!([])).unwrap(),
            json!([])
        );
    }

    #[test]
    fn a_corrupted_chats_file_is_backed_up_not_wiped() {
        let dir = tempfile::tempdir().unwrap();
        let kora = dir.path().join(".kora");
        std::fs::create_dir_all(&kora).unwrap();
        std::fs::write(kora.join("chats.json"), "{ not json at all").unwrap();

        let t = table_in(dir.path());
        assert_eq!(call(&t, "chats.load", json!([])).unwrap(), json!([]));

        let backups: Vec<_> = std::fs::read_dir(&kora)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with("chats.json.corrupt-"))
            .collect();
        assert_eq!(
            backups.len(),
            1,
            "expected one .corrupt-* backup, got {backups:?}"
        );
    }

    #[test]
    fn chats_save_sanitises_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let t = table_in(dir.path());
        // A chat without an id must not survive the round trip.
        call(&t, "chats.save", json!([[{ "title": "no id" }, "junk"]])).unwrap();
        assert_eq!(call(&t, "chats.load", json!([])).unwrap(), json!([]));
    }
}
