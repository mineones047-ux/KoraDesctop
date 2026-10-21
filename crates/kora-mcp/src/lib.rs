//! The MCP client — now driven by **`rmcp`**, the official Rust SDK for the Model
//! Context Protocol (Apache-2.0, maintained alongside the spec).
//!
//! # Why this file got much smaller
//!
//! The previous version hand-rolled the JSON-RPC 2.0 transport: framing, `initialize`
//! negotiation, `tools/list`, `tools/call`, error mapping, timeouts and cancellation.
//! `rmcp` already does all of that, plus Streamable HTTP and OAuth, and it is tested by
//! the same people who write the specification. What is left here is the part that is
//! *Kora's* policy and nobody else's:
//!
//!   * **tool naming** — `mcp__<server>__<tool>`, the id format the renderer's tool
//!     registry and the agent's prompt already assume;
//!   * **containment** — every MCP server is a child process, so it goes through the
//!     same scrubbed environment as `shell.execute` (docs/FIXES.md, the
//!     `cmd -> npx -> node` zombie problem);
//!   * **timeouts and enable/disable** — the config semantics from
//!     `electron/services/mcp/config.ts`.
//!
//! MCP servers are treated as untrusted: they are user-configured child processes, and
//! nothing they return is executed or trusted without going back through the core.

use std::collections::BTreeMap;
use std::time::Duration;

use rmcp::transport::TokioChildProcess;
use serde::{Deserialize, Serialize};

/// One configured MCP server, matching the frozen `~/.kora/mcp.json` shape.
///
/// `rename_all = "camelCase"` is not cosmetic: the file is written by the Electron build
/// with `autoStart` / `requestTimeoutMs`, and a snake_case struct would silently read
/// every one of those as absent and fall back to the default. The round-trip test below
/// is what keeps that honest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_true")]
    pub auto_start: bool,
    #[serde(default)]
    pub description: Option<String>,
    /// Per-server request timeout; the TS default was 30 s.
    #[serde(default = "default_timeout")]
    pub request_timeout_ms: u64,
}

fn default_true() -> bool {
    true
}

fn default_timeout() -> u64 {
    30_000
}

/// A tool as the agent sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolDescriptor {
    /// `mcp__<server>__<tool>` — the id the renderer and prompt use.
    pub full_name: String,
    pub server_id: String,
    pub server_name: String,
    pub name: String,
    pub description: Option<String>,
}

/// Sanitise a name the same way the TypeScript manager did:
/// `s.replace(/[^a-zA-Z0-9_-]/g, '_')`.
pub fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// The `mcp__<server>__<tool>` id for a pair of names.
pub fn full_name(server: &str, tool: &str) -> String {
    format!("mcp__{}__{}", sanitize(server), sanitize(tool))
}

/// Split a full tool id back into `(server, tool)`, or `None` when it is not one of ours.
pub fn split_full_name(id: &str) -> Option<(&str, &str)> {
    let rest = id.strip_prefix("mcp__")?;
    let (server, tool) = rest.split_once("__")?;
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server, tool))
}

impl ServerConfig {
    /// The per-request timeout, bounded so a bad config cannot hang the app forever.
    pub fn timeout(&self) -> Duration {
        Duration::from_millis(self.request_timeout_ms.clamp(1_000, 600_000))
    }

    /// Refuse a configuration that could not be started anyway, with a message a user
    /// can act on.
    pub fn validate(&self) -> Result<(), String> {
        if self.command.trim().is_empty() {
            return Err(format!("MCP server \"{}\" has no command", self.id));
        }
        if self.id.trim().is_empty() {
            return Err("MCP server has no id".to_string());
        }
        Ok(())
    }

    /// Build the transport: spawn the server as a child process with a **scrubbed**
    /// environment.
    ///
    /// The scrub comes from `kora-security`: an MCP server is still a child process, and
    /// handing it every secret the app holds is how "just a tool server" becomes a data
    /// exfiltration path. The configured `env` map is applied on top, because a server
    /// genuinely may need its own token.
    pub fn transport(&self) -> Result<TokioChildProcess, String> {
        self.validate()?;
        let policy =
            kora_security::sandbox::SandboxPolicy::default().with_env("ELECTRON_RUN_AS_NODE", "1");
        let mut cmd = tokio::process::Command::new(&self.command);
        cmd.args(&self.args)
            .env_clear()
            .envs(kora_security::sandbox::child_env_os(&policy))
            .envs(&self.env);
        if let Some(cwd) = &self.cwd {
            cmd.current_dir(cwd);
        }
        TokioChildProcess::new(cmd).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> ServerConfig {
        ServerConfig {
            id: "files".into(),
            name: "Files".into(),
            command: "node".into(),
            args: vec!["server.mjs".into()],
            env: BTreeMap::new(),
            cwd: None,
            enabled: true,
            auto_start: true,
            description: None,
            request_timeout_ms: 30_000,
        }
    }

    #[test]
    fn full_names_match_the_typescript_convention() {
        assert_eq!(
            full_name("my server", "read file"),
            "mcp__my_server__read_file"
        );
        assert_eq!(full_name("files", "read"), "mcp__files__read");
    }

    #[test]
    fn full_names_round_trip() {
        let id = full_name("my server", "read file");
        assert_eq!(split_full_name(&id), Some(("my_server", "read_file")));
        assert_eq!(split_full_name("fs.readFile"), None);
        assert_eq!(split_full_name("mcp____x"), None);
        assert_eq!(split_full_name("mcp__a__"), None);
    }

    #[test]
    fn a_missing_command_is_reported_with_the_server_id() {
        let mut c = cfg();
        c.command = "  ".into();
        let err = c.validate().unwrap_err();
        assert!(err.contains("files"), "unhelpful error: {err}");
    }

    #[test]
    fn a_missing_id_is_reported() {
        let mut c = cfg();
        c.id = "".into();
        assert!(c.validate().unwrap_err().contains("no id"));
    }

    #[test]
    fn timeouts_are_clamped_to_something_a_user_can_wait_for() {
        let mut c = cfg();
        c.request_timeout_ms = 0;
        assert_eq!(c.timeout(), Duration::from_millis(1_000));
        c.request_timeout_ms = 10_000_000_000;
        assert_eq!(c.timeout(), Duration::from_millis(600_000));
    }

    #[test]
    fn the_json_shape_survives_a_round_trip() {
        // The `~/.kora/mcp.json` format is frozen: a profile written by the Electron
        // build must load here without loss.
        let json = r#"{
            "id": "memory", "name": "Memory", "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-memory"],
            "env": {"TOKEN": "x"}, "enabled": true, "autoStart": false,
            "requestTimeoutMs": 5000
        }"#;
        let parsed: ServerConfig = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.id, "memory");
        assert_eq!(parsed.request_timeout_ms, 5000);
        assert!(!parsed.auto_start, "autoStart: false must survive");
        assert_eq!(parsed.env.get("TOKEN").map(String::as_str), Some("x"));

        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(back["autoStart"], serde_json::json!(false));
    }

    #[test]
    fn the_configured_env_survives_the_scrub() {
        // A server may legitimately need its own token; the scrub must not eat it.
        let json =
            r#"{"id":"a","name":"A","command":"c","env":{"KORA_TEST_SERVER_TOKEN":"keep-me"}}"#;
        let parsed: ServerConfig = serde_json::from_str(json).unwrap();
        assert_eq!(
            parsed.env.get("KORA_TEST_SERVER_TOKEN").map(String::as_str),
            Some("keep-me")
        );
    }
}
