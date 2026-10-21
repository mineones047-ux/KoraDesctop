//! App configuration — the Rust port of the persistence half of
//! `electron/services/config.ts` (`~/.kora/config.json`).
//!
//! Contract kept from the TS implementation:
//!   * the JSON shape is frozen — fields round-trip, unknown fields survive a
//!     load/save cycle (the TS `{...DEFAULT_CONFIG, ...savedConfig}` merge
//!     keeps them too);
//!   * `set()` accepts only whitelisted keys, validates the value type,
//!     clamps `temperature` into [0, 2], validates graph colors against
//!     `#rrggbb` and trims/quotes the Obsidian vault path;
//!   * every save is atomic (tmp + rename).
//!
//! Not ported here: safeStorage encryption of API keys (Electron-only; the
//! Rust core will use the system keyring — docs/ROADMAP.md §6.5). This module
//! stores secrets as plain values in memory and never invents an `enc:` prefix.
//! Legacy `enc:` values round-trip untouched so a future keyring migration
//! can detect them by prefix.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::atomic::write_atomic;

/// The whitelisted keys with their expected JSON type name.
/// Mirrors `expectedType` in electron/services/config.ts.
const EXPECTED_TYPES: &[(&str, &str)] = &[
    ("provider", "string"),
    ("lmstudioUrl", "string"),
    ("ollamaUrl", "string"),
    ("llamacppUrl", "string"),
    ("selectedModel", "string"),
    ("apiKey", "string"),
    ("apiBaseUrl", "string"),
    ("apiModel", "string"),
    ("systemPrompt", "string"),
    ("temperature", "number"),
    ("agentDecisionModel", "string"),
    ("agentDecisionProvider", "string"),
    ("activeTemplate", "string"),
    ("ttsVoice", "string"),
    ("theme", "string"),
    ("language", "string"),
    ("obsidianVaultPath", "string"),
    ("customProviders", "object"),
    ("graphLinkColor", "string"),
    ("graphNodeColor", "string"),
    ("sttEngine", "string"),
    ("whisperPath", "string"),
    ("whisperModel", "string"),
];

pub const DEFAULT_CONFIG_JSON: &str = r#"{
  "provider": "lmstudio",
  "lmstudioUrl": "http://localhost:1234",
  "ollamaUrl": "http://localhost:11434",
  "selectedModel": "",
  "apiKey": "",
  "apiBaseUrl": "https://api.openai.com",
  "apiModel": "gpt-3.5-turbo",
  "customProviders": [],
  "systemPrompt": "You are Kora, a helpful AI assistant. Be concise and clear in your responses.",
  "temperature": 0.7,
  "activeTemplate": "default",
  "ttsVoice": "ru-RU-DmitryNeural",
  "theme": "red",
  "language": "en",
  "obsidianVaultPath": "",
  "graphLinkColor": "",
  "graphNodeColor": ""
}"#;

pub struct Config {
    path: PathBuf,
    data: Map<String, Value>,
}

impl Config {
    /// Open (or create) the config at `path`. A corrupted file falls back to
    /// defaults (same as the TS `catch` branch) without touching the file on
    /// disk — the next `save()` overwrites it.
    pub fn load(path: &Path) -> io::Result<Self> {
        let defaults: Value =
            serde_json::from_str(DEFAULT_CONFIG_JSON).expect("DEFAULT_CONFIG_JSON must parse");
        let mut data: Map<String, Value> = defaults
            .as_object()
            .expect("defaults must be an object")
            .clone();

        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(Value::Object(saved)) = serde_json::from_str::<Value>(&content) {
                // Merge saved over defaults; unknown fields survive.
                for (k, v) in saved {
                    data.insert(k, v);
                }
            }
        }

        Ok(Self {
            path: path.to_path_buf(),
            data,
        })
    }

    pub fn get(&self) -> &Map<String, Value> {
        &self.data
    }

    /// Whitelisted, type-checked set. Returns false when the key or value was
    /// rejected (the TS `set` silently ignores those).
    pub fn set(&mut self, key: &str, value: Value) -> bool {
        let expected = match EXPECTED_TYPES.iter().find(|(k, _)| *k == key) {
            Some((_, t)) => *t,
            None => return false,
        };

        let value = match expected {
            "number" => {
                let n = match value.as_f64() {
                    Some(n) if n.is_finite() => n,
                    _ => return false,
                };
                if key == "temperature" {
                    json!(n.clamp(0.0, 2.0))
                } else {
                    json!(n)
                }
            }
            "object" => {
                if !value.is_array() {
                    return false;
                }
                if key == "customProviders" {
                    let ok = value.as_array().unwrap().iter().all(|p| {
                        p.is_object()
                            && p.get("name").map(Value::is_string).unwrap_or(false)
                            && p.get("baseUrl").map(Value::is_string).unwrap_or(false)
                            && p.get("apiKey").map(Value::is_string).unwrap_or(false)
                            && p.get("model").map(Value::is_string).unwrap_or(false)
                    });
                    if !ok {
                        return false;
                    }
                }
                value
            }
            _ => {
                let s = match value.as_str() {
                    Some(s) => s,
                    None => return false,
                };
                if (key == "graphLinkColor" || key == "graphNodeColor")
                    && !s.is_empty()
                    && !is_hex_color(s)
                {
                    return false;
                }
                if key == "obsidianVaultPath" {
                    json!(strip_quotes(s))
                } else {
                    json!(s)
                }
            }
        };

        self.data.insert(key.to_string(), value);
        true
    }

    /// Persist atomically. Pretty-printed with 2-space indent (frozen shape).
    pub fn save(&self) -> io::Result<()> {
        let body = serde_json::to_string_pretty(&Value::Object(self.data.clone()))
            .map_err(io::Error::other)?;
        write_atomic(&self.path, &body)
    }
}

fn is_hex_color(s: &str) -> bool {
    let body = s.strip_prefix('#').unwrap_or(s);
    body.len() == 6 && body.chars().all(|c| c.is_ascii_hexdigit())
}

/// One leading or one trailing quote, then ALL quotes removed — mirrors
/// `.replace(/^["']|["']$/g, '').replace(/["']/g, '')` in the TS code.
fn strip_quotes(s: &str) -> String {
    let mut t = s;
    if let Some(rest) = t.strip_prefix(['"', '\'']) {
        t = rest;
    }
    if let Some(rest) = t.strip_suffix(['"', '\'']) {
        t = rest;
    }
    t.replace(['"', '\''], "").trim().to_string()
}

/// Parse a legacy plaintext/`enc:` API key: returns the prefix tag.
/// Used by tests to pin the contract that `enc:` values survive round-trips.
pub fn key_prefix(stored: &str) -> Option<&str> {
    stored.split(':').next().filter(|p| *p == "enc")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_config() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        (dir, path)
    }

    #[test]
    fn load_missing_file_gives_defaults() {
        let (_d, path) = tmp_config();
        let cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.get()["provider"], "lmstudio");
        assert_eq!(cfg.get()["temperature"], 0.7);
    }

    #[test]
    fn corrupted_file_falls_back_to_defaults() {
        let (_d, path) = tmp_config();
        fs::write(&path, "{{{").unwrap();
        let cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.get()["provider"], "lmstudio");
    }

    #[test]
    fn unknown_fields_survive_load_save_roundtrip() {
        let (_d, path) = tmp_config();
        fs::write(&path, r#"{"provider":"ollama","brandNewField":42}"#).unwrap();
        let cfg = Config::load(&path).unwrap();
        assert_eq!(cfg.get()["brandNewField"], 42);
        cfg.save().unwrap();
        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["brandNewField"], 42);
    }

    #[test]
    fn set_rejects_unknown_keys_and_wrong_types() {
        let (_d, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        assert!(!cfg.set("nope", json!(1)));
        assert!(!cfg.set("temperature", json!("hot")));
        assert!(!cfg.set("provider", json!(123)));
        assert!(!cfg.set("customProviders", json!({"not":"array"})));
        assert!(!cfg.set("customProviders", json!([{"name":1}])));
    }

    #[test]
    fn set_clamps_temperature() {
        let (_d, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        assert!(cfg.set("temperature", json!(5.0)));
        assert_eq!(cfg.get()["temperature"], 2.0);
        assert!(cfg.set("temperature", json!(-3.0)));
        assert_eq!(cfg.get()["temperature"], 0.0);
    }

    #[test]
    fn set_validates_graph_colors() {
        let (_d, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        assert!(cfg.set("graphLinkColor", json!("#a1B2c3")));
        assert_eq!(cfg.get()["graphLinkColor"], "#a1B2c3");
        assert!(!cfg.set("graphLinkColor", json!("red")));
        assert!(!cfg.set("graphLinkColor", json!("#12345")));
        assert!(cfg.set("graphLinkColor", json!(""))); // empty always allowed
    }

    #[test]
    fn set_strips_quotes_from_obsidian_path() {
        let (_d, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        assert!(cfg.set("obsidianVaultPath", json!("  \"C:\\Vault\"  ")));
        assert_eq!(cfg.get()["obsidianVaultPath"], "C:\\Vault");
    }

    #[test]
    fn save_is_atomic_and_pretty() {
        let (dir, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        cfg.set("provider", json!("openai"));
        cfg.save().unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains('\n'), "must be pretty-printed");
        let leftovers: Vec<_> = fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .filter(|n| n.contains(".kora-"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn enc_prefixed_keys_round_trip_untouched() {
        let (_d, path) = tmp_config();
        let enc = "enc:QmFzZTY0RGF0YQ==";
        fs::write(&path, format!(r#"{{"apiKey":"{enc}"}}"#)).unwrap();
        let mut cfg = Config::load(&path).unwrap();
        assert_eq!(
            key_prefix(cfg.get()["apiKey"].as_str().unwrap()),
            Some("enc")
        );
        // A set of the key keeps the value verbatim (no re-encryption invention).
        cfg.set("apiKey", json!(enc));
        assert_eq!(cfg.get()["apiKey"], enc);
        cfg.save().unwrap();
        let raw: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(raw["apiKey"], enc);
    }

    #[test]
    fn full_save_load_cycle() {
        let (_d, path) = tmp_config();
        let mut cfg = Config::load(&path).unwrap();
        cfg.set("provider", json!("ollama"));
        cfg.set("selectedModel", json!("llama3"));
        cfg.set("temperature", json!(1.5));
        cfg.save().unwrap();

        let cfg2 = Config::load(&path).unwrap();
        assert_eq!(cfg2.get()["provider"], "ollama");
        assert_eq!(cfg2.get()["selectedModel"], "llama3");
        assert_eq!(cfg2.get()["temperature"], 1.5);
    }
}
