//! Agent decision protocol — the Rust port of `parseAgentResponse` in
//! `src/agent/orchestrator.ts`. The model answers with a **single JSON
//! object** (possibly fenced, possibly with surrounding prose):
//! `{"thought":"...","action":"call_tool","tool":"...","parameters":{...}}` or
//! `{"thought":"...","action":"finish","answer":"..."}`.

use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct AgentDecision {
    pub thought: String,
    pub action: DecisionAction,
    pub tool: Option<String>,
    pub parameters: Option<Value>,
    pub answer: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionAction {
    CallTool,
    Finish,
}

impl AgentDecision {
    pub fn to_json(&self) -> Value {
        json!({
            "thought": self.thought,
            "action": match self.action {
                DecisionAction::CallTool => "call_tool",
                DecisionAction::Finish => "finish",
            },
            "tool": self.tool,
            "parameters": self.parameters,
            "answer": self.answer,
        })
    }
}

/// Extract the first `{...}` candidate: a fenced ```json block wins when
/// present, otherwise the outermost braces of the text.
fn candidate_slice(text: &str) -> Option<&str> {
    let trimmed = text.trim();
    if let Some(fence_start) = trimmed.find("```") {
        let after = &trimmed[fence_start + 3..];
        let after = after.strip_prefix("json").unwrap_or(after);
        let after = after.strip_prefix(['\r', '\n']).unwrap_or(after);
        if let Some(end) = after.find("```") {
            return Some(after[..end].trim());
        }
    }
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    if end <= start {
        return None;
    }
    Some(&trimmed[start..=end])
}

/// Parse one model response into a decision. `None` = not a valid decision
/// (the caller applies the corrective-retry policy).
pub fn parse_agent_response(text: &str) -> Option<AgentDecision> {
    let candidate = candidate_slice(text)?;
    let parsed: Value = serde_json::from_str(candidate).ok()?;
    let action = match parsed["action"].as_str() {
        Some("finish") => DecisionAction::Finish,
        Some("call_tool") => DecisionAction::CallTool,
        _ => return None,
    };
    Some(AgentDecision {
        thought: parsed["thought"].as_str().unwrap_or("").to_string(),
        action,
        tool: parsed["tool"].as_str().map(str::to_string),
        parameters: parsed.get("parameters").filter(|p| p.is_object()).cloned(),
        answer: parsed["answer"].as_str().map(str::to_string),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_plain_call_tool() {
        let d = parse_agent_response(
            r#"{"thought":"look","action":"call_tool","tool":"dir","parameters":{"path":"~"}}"#,
        )
        .unwrap();
        assert_eq!(d.action, DecisionAction::CallTool);
        assert_eq!(d.tool.as_deref(), Some("dir"));
        assert_eq!(d.parameters.as_ref().unwrap()["path"], "~");
        assert_eq!(d.thought, "look");
    }

    #[test]
    fn parses_fenced_finish() {
        let d = parse_agent_response(
            "```json\n{\"thought\":\"done\",\"action\":\"finish\",\"answer\":\"Here you go\"}\n```",
        )
        .unwrap();
        assert_eq!(d.action, DecisionAction::Finish);
        assert_eq!(d.answer.as_deref(), Some("Here you go"));
    }

    #[test]
    fn parses_with_surrounding_prose() {
        let d = parse_agent_response(
            "Sure! {\"thought\":\"t\",\"action\":\"finish\",\"answer\":\"a\"} — hope that helps",
        )
        .unwrap();
        assert_eq!(d.action, DecisionAction::Finish);
    }

    #[test]
    fn unknown_action_is_rejected() {
        assert!(parse_agent_response(r#"{"action":"explode"}"#).is_none());
        assert!(parse_agent_response("no json at all").is_none());
        assert!(parse_agent_response("{ broken").is_none());
        assert!(parse_agent_response("").is_none());
    }

    #[test]
    fn non_object_parameters_dropped() {
        let d = parse_agent_response(
            r#"{"thought":"","action":"call_tool","tool":"dir","parameters":"oops"}"#,
        )
        .unwrap();
        assert!(d.parameters.is_none());
    }

    #[test]
    fn to_json_roundtrip() {
        let d = AgentDecision {
            thought: "t".into(),
            action: DecisionAction::CallTool,
            tool: Some("dir".into()),
            parameters: Some(json!({"path": "~"})),
            answer: None,
        };
        let v = d.to_json();
        assert_eq!(v["action"], "call_tool");
        assert_eq!(v["tool"], "dir");
    }
}
