//! kora-cli — the headless Kora front (docs/ROADMAP.md §7: "headless use of
//! the same core: stream `agent.*` notifications to stdout").
//!
//! Subcommands:
//!   * `serve` — a kora-rpc/1 server over stdio: handshake, capability
//!     enforcement, fs/shell/chats methods; the seed of the P4 Tauri shell's
//!     core process (one binary serves every shell);
//!   * `ask <query>` — one agent cycle from the terminal (P3 exit criterion:
//!     "kora-cli passes a full agent cycle with no UI at all").

use std::io::{BufRead, Write};
use std::sync::Arc;

use kora_core::tools::ToolRegistry;
use kora_methods::{create_method_table, Env};
use kora_rpc::{
    create_dispatch_state, frame, handle_message, parse_frame, DispatchOptions, DispatchState,
    ParsedFrame, RpcResponse,
};
use serde_json::{json, Value};

async fn serve() -> i32 {
    // The real method table from `kora-methods` — the same fs/shell/config/chats
    // surface `core/methods.ts` exposes, with every security check running inside
    // the core. `KORA_DATA_DIR` redirects `~/.kora` for tests and sandboxes.
    let env = Arc::new(Env::current());
    let data_dir = env.data_dir.clone();
    let options = Arc::new(create_method_table(env));

    // An async mutex: the guard is deliberately held across the `await` inside
    // `handle_line_with`, which a `std::sync::Mutex` must never do.
    let state = Arc::new(tokio::sync::Mutex::new(create_dispatch_state(&data_dir)));

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout().lock();
    eprintln!("[kora-rpc] core listening on stdio (protocol kora-rpc/1, dataDir {data_dir})");

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let response = {
            let mut st = state.lock().await;
            handle_line_with(&line, &mut st, &options).await
        };
        if let Some(response) = response {
            let _ = writeln!(stdout, "{}", frame(&response).trim_end());
            let _ = stdout.flush();
        }
    }
    eprintln!("[kora-rpc] stdin closed, exiting");
    0
}

/// One line → response (shared by serve and the tests).
async fn handle_line_with(
    line: &str,
    state: &mut DispatchState,
    options: &DispatchOptions,
) -> Option<RpcResponse> {
    match parse_frame(line) {
        ParsedFrame::Ok(message) => handle_message(message, state, options).await,
        ParsedFrame::Malformed => Some(RpcResponse::parse_error()),
    }
}

/// One agent cycle from the terminal.
async fn ask(query: String) -> i32 {
    let registry = ToolRegistry::new();
    // A CLI without configured providers answers through the loop's failure
    // path honestly: the exit criterion (docs/ROADMAP.md §7 P3) is that the
    // loop runs end-to-end without any UI — providers come from `~/.kora`.
    struct NoProvider;
    #[async_trait::async_trait]
    impl kora_core::LlmGateway for NoProvider {
        async fn complete(
            &self,
            _messages: &[kora_core::MemoryEntry],
            _json_mode: bool,
        ) -> Result<String, String> {
            Err("[kora:auth] no provider configured in kora-cli yet".into())
        }
    }

    let mut history = Vec::new();
    let outcome = kora_core::run_cycle(1, &query, &mut history, &registry, &NoProvider, |event| {
        println!(
            "{}",
            serde_json::to_string(&event_json(event)).unwrap_or_default()
        );
    })
    .await;

    match (outcome.success, outcome.answer) {
        (true, Some(answer)) => {
            println!("{answer}");
            0
        }
        (true, None) => 0,
        (false, _) => {
            eprintln!("[kora-cli] error: {}", outcome.error.unwrap_or_default());
            1
        }
    }
}

/// Serialise a loop event for the CLI's stdout stream.
///
/// Field names are camelCase to match the notification payloads the Electron and Tauri
/// shells already consume — the CLI is a third *presentation* of one event shape, not a
/// new contract.
fn event_json(event: kora_core::AgentEvent) -> Value {
    match event {
        kora_core::AgentEvent::Thought { cycle_id, text } => {
            json!({ "type": "agent.thought", "cycleId": cycle_id, "text": text })
        }
        kora_core::AgentEvent::ToolRequest {
            cycle_id,
            tool,
            params,
        } => {
            json!({ "type": "agent.toolRequest", "cycleId": cycle_id, "tool": tool, "params": params })
        }
        kora_core::AgentEvent::ToolResult {
            cycle_id,
            tool,
            ok,
            summary,
        } => {
            json!({ "type": "agent.toolResult", "cycleId": cycle_id, "tool": tool, "ok": ok, "summary": summary })
        }
        kora_core::AgentEvent::Finished {
            cycle_id,
            success,
            answer,
            error,
        } => {
            json!({ "type": "agent.finished", "cycleId": cycle_id, "success": success, "answer": answer, "error": error })
        }
    }
}

/// Entry point: dispatch on the subcommand and hand the exit code to the shell.
#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let code = match args.get(1).map(String::as_str) {
        Some("serve") => serve().await,
        Some("ask") => match args.get(2) {
            Some(query) => ask(query.clone()).await,
            None => {
                eprintln!("usage: kora-cli ask <query>");
                2
            }
        },
        _ => {
            eprintln!("kora-cli — headless Kora core\n\nusage:\n  kora-cli serve        kora-rpc/1 server over stdio\n  kora-cli ask <query>  one agent cycle");
            2
        }
    };
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;
    use kora_rpc::ErrorCodes;

    /// A table bound to a throwaway home, so the tests never touch the real `~/.kora`.
    async fn roundtrip(lines: &[&str]) -> Vec<RpcResponse> {
        roundtrip_in(&std::env::temp_dir().to_string_lossy(), lines).await
    }

    async fn roundtrip_in(home: &str, lines: &[&str]) -> Vec<RpcResponse> {
        let options = create_method_table(Arc::new(Env::for_home(home)));
        let mut state = create_dispatch_state(&options_data_dir(home));
        let mut out = Vec::new();
        for line in lines {
            if let Some(r) = handle_line_with(line, &mut state, &options).await {
                out.push(r);
            }
        }
        out
    }

    fn options_data_dir(home: &str) -> String {
        Env::for_home(home).data_dir
    }

    fn hello(caps: &[&str]) -> String {
        serde_json::json!({
            "jsonrpc": "2.0", "id": 0, "method": "core.hello",
            "params": { "client": "test", "protocol": kora_rpc::PROTOCOL_VERSION, "capabilities": caps }
        })
        .to_string()
    }

    #[tokio::test]
    async fn serve_handshake_and_fs_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let file = tmp.path().join("probe.txt");
        std::fs::write(&file, "kora").unwrap();

        let responses = roundtrip(&[
            &hello(&["fs"]),
            &format!(
                "{}",
                serde_json::json!({"jsonrpc":"2.0","id":1,"method":"fs.exists","params":[file.to_str().unwrap()]})
            ),
        ])
        .await;

        assert_eq!(responses.len(), 2);
        match &responses[0] {
            RpcResponse::Success(s) => assert_eq!(s.result["protocol"], "kora-rpc/1"),
            _ => panic!("handshake must succeed"),
        }
        match &responses[1] {
            RpcResponse::Success(s) => assert_eq!(s.result["exists"], true),
            _ => panic!("fs.exists must succeed"),
        }
    }

    #[tokio::test]
    async fn serve_blocks_dangerous_shell_from_wire() {
        let responses = roundtrip(&[
            &hello(&["shell"]),
            &format!(
                "{}",
                serde_json::json!({"jsonrpc":"2.0","id":1,"method":"shell.execute","params":["format C:"]})
            ),
        ])
        .await;

        match &responses[1] {
            RpcResponse::Success(s) => {
                assert_eq!(s.result["blocked"], true);
                assert_eq!(s.result["success"], false);
            }
            _ => panic!("expected a result, not an error"),
        }
    }

    #[tokio::test]
    async fn serve_denies_undeclared_capability() {
        let responses = roundtrip(&[
            &hello(&["fs"]),
            &format!(
                "{}",
                serde_json::json!({"jsonrpc":"2.0","id":1,"method":"shell.execute","params":["dir"]})
            ),
        ])
        .await;

        match &responses[1] {
            RpcResponse::Failure(f) => assert_eq!(f.error.code, ErrorCodes::DENIED),
            _ => panic!("expected denied"),
        }
    }

    #[tokio::test]
    async fn malformed_line_gets_parse_error() {
        let responses = roundtrip(&["{{garbage"]).await;
        match &responses[0] {
            RpcResponse::Failure(f) => {
                assert_eq!(f.error.code, ErrorCodes::PARSE);
                assert_eq!(f.id, None);
            }
            _ => panic!("expected parse error"),
        }
    }

    #[tokio::test]
    async fn notification_line_produces_nothing() {
        let out = roundtrip(&[r#"{"jsonrpc":"2.0","method":"x"}"#]).await;
        assert!(out.is_empty());
    }
}
