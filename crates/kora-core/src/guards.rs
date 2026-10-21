//! Fault-tolerance primitives — the Rust port of `src/agent/guards.ts`
//! (itself ported from Hermes agent, Nous Research, MIT):
//! error classification helpers, `IterationBudget`, `ToolLoopGuard`,
//! degenerate-repetition and empty-response guards, bounded tool errors.
//! Kept side-effect-free (the clock / randomness stay outside).

/// Parse the `[kora:<reason>]` marker out of an error message.
pub fn parse_llm_error_reason(message: &str) -> Option<&'static str> {
    const REASONS: [&str; 8] = [
        "rate_limit",
        "auth",
        "model_not_found",
        "context_overflow",
        "server_error",
        "network",
        "timeout",
        "unknown",
    ];
    let start = message.find("[kora:")?;
    let rest = &message[start + 6..];
    let end = rest.find(']')?;
    let reason = &rest[..end];
    REASONS.iter().find(|r| **r == reason).copied()
}

/// `isRetryableReason` parity.
pub fn is_retryable_reason(reason: &str) -> bool {
    matches!(
        reason,
        "rate_limit" | "server_error" | "network" | "timeout"
    )
}

/// `backoffDelayMs` — base curve without the jitter (tests pass rand01 via
/// [`backoff_delay_ms_jittered`]).
pub fn backoff_delay_ms(attempt: u32) -> u64 {
    let exp = attempt.saturating_sub(1).min(16);
    let base = 1000_u64.saturating_mul(1 << exp);
    base.min(15_000)
}

pub fn backoff_delay_ms_jittered(attempt: u32, rand01: f64) -> u64 {
    (backoff_delay_ms(attempt) as f64 * (0.7 + rand01 * 0.6)) as u64
}

/// `IterationBudget` — consume/refund step counter.
#[derive(Debug)]
pub struct IterationBudget {
    total: u32,
    used: u32,
}

impl IterationBudget {
    pub fn new(total: u32) -> Self {
        Self {
            total: total.max(1),
            used: 0,
        }
    }

    /// `false` when the budget is exhausted.
    pub fn consume(&mut self, n: u32) -> bool {
        if self.used + n > self.total {
            return false;
        }
        self.used += n;
        true
    }

    pub fn refund(&mut self, n: u32) {
        self.used = self.used.saturating_sub(n);
    }

    pub fn remaining(&self) -> u32 {
        self.total - self.used
    }
}

fn hash_value(v: &serde_json::Value) -> String {
    // Deterministic string of the JSON with object keys in insertion order —
    // the TS version sorts keys; Value::Object keeps insertion order too, and
    // decisions are produced by the same model pipeline, so this is stable.
    let s = serde_json::to_string(v).unwrap_or_default();
    let mut h: u32 = 0;
    for b in s.bytes() {
        h = h.wrapping_mul(31).wrapping_add(b as u32);
    }
    h.to_string()
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct LoopRecord {
    call_key: String,
    result_key: String,
}

/// `ToolLoopGuard` — detects repeated identical tool calls and same-tool
/// streaks. Returns a synthetic observation message instead of hard-stopping.
#[derive(Debug, Default)]
pub struct ToolLoopGuard {
    records: Vec<LoopRecord>,
    notified: std::collections::HashSet<String>,
    max_records: usize,
}

impl ToolLoopGuard {
    pub fn new() -> Self {
        Self {
            max_records: 24,
            ..Default::default()
        }
    }

    pub fn record(
        &mut self,
        tool: &str,
        parameters: &serde_json::Value,
        result: &serde_json::Value,
    ) {
        self.records.push(LoopRecord {
            call_key: format!("{tool}|{}", hash_value(parameters)),
            result_key: hash_value(result),
        });
        if self.records.len() > self.max_records {
            self.records.remove(0);
        }
    }

    /// A warning message to inject into the conversation, or `None`.
    pub fn check(&mut self) -> Option<String> {
        let n = self.records.len();
        if n < 2 {
            return None;
        }
        let last = self.records[n - 1].clone();

        // exact identical consecutive calls with identical results
        let mut identical_streak = 1;
        for r in self.records[..n - 1].iter().rev() {
            if r.call_key == last.call_key && r.result_key == last.result_key {
                identical_streak += 1;
            } else {
                break;
            }
        }
        if identical_streak >= 2 {
            let shown = identical_streak.min(5).to_string();
            let stamp = format!("exact:{}:{shown}", last.call_key);
            if self.notified.insert(stamp) {
                if identical_streak >= 5 {
                    return Some(format!(
                        "TOOL LOOP DETECTED: you called the same tool with the same arguments {identical_streak} times \
                         with identical results. Stop calling this tool. Either finish with your best answer via \
                         {{\"action\":\"finish\"}} or try a fundamentally different approach."
                    ));
                }
                return Some(format!(
                    "You already made this exact tool call {identical_streak} times and got the same result. \
                     Do NOT repeat it: change the arguments, try another tool, or finish with the information you have."
                ));
            }
        }

        // same tool streak regardless of arguments
        let tool_name = &last.call_key[..last.call_key.find('|').unwrap_or(0)];
        let mut tool_streak = 1;
        for r in self.records[..n - 1].iter().rev() {
            if r.call_key.starts_with(&format!("{tool_name}|")) {
                tool_streak += 1;
            } else {
                break;
            }
        }
        if tool_streak >= 4 {
            let shown = tool_streak.min(6).to_string();
            let stamp = format!("tool:{tool_name}:{shown}");
            if self.notified.insert(stamp) {
                return Some(format!(
                    "WARNING: this is your {tool_streak}th consecutive call of \"{tool_name}\". \
                     Consider whether you are making progress; combine what you have and finish, or switch strategy."
                ));
            }
        }

        None
    }

    pub fn reset(&mut self) {
        self.records.clear();
        self.notified.clear();
    }
}

/// `detectDegenerateRepetition` — a short phrase repeated over and over.
pub fn detect_degenerate_repetition(text: &str) -> bool {
    let normalized: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let normalized = normalized.trim();
    if normalized.chars().count() < 120 {
        return false;
    }

    // char-index-safe windows (TS slices by UTF-16 units; ASCII content makes
    // them equivalent — the guard is a heuristic, not a parser).
    let chars: Vec<char> = normalized.chars().collect();
    for w in [80usize, 50, 30] {
        if chars.len() <= w {
            continue;
        }
        let tail: String = chars[chars.len() - w..].iter().collect();
        let mut count = 0usize;
        let mut idx = 0usize;
        let hay: String = normalized.to_string();
        while let Some(pos) = hay[idx..].find(&tail) {
            count += 1;
            idx += pos + (w / 2);
            if idx >= hay.len() {
                break;
            }
        }
        if count >= 3 || (count >= 2 && (count * w) as f64 / chars.len() as f64 >= 0.5) {
            return true;
        }
    }
    false
}

/// `isEmptyResponse`.
pub fn is_empty_response(text: &str) -> bool {
    text.trim().is_empty()
}

/// `boundToolError` — caps tool error text so a single failure cannot flood
/// the model context.
pub fn bound_tool_error(err: &str, max: usize) -> String {
    if err.chars().count() > max {
        let cut: String = err.chars().take(max).collect();
        let total = err.chars().count();
        format!("{cut}… [truncated {} chars]", total - max)
    } else {
        err.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_frozen_marker() {
        assert_eq!(
            parse_llm_error_reason("[kora:rate_limit] slow down"),
            Some("rate_limit")
        );
        assert_eq!(parse_llm_error_reason("[kora:auth] bad key"), Some("auth"));
        assert_eq!(parse_llm_error_reason("no marker"), None);
        assert_eq!(parse_llm_error_reason("[kora:bogus] x"), None);
    }

    #[test]
    fn retryable_parity() {
        for r in ["rate_limit", "server_error", "network", "timeout"] {
            assert!(is_retryable_reason(r));
        }
        for r in ["auth", "model_not_found", "context_overflow", "unknown"] {
            assert!(!is_retryable_reason(r));
        }
    }

    #[test]
    fn budget_consume_refund() {
        let mut b = IterationBudget::new(3);
        assert!(b.consume(2));
        assert!(b.consume(1));
        assert!(!b.consume(1));
        assert_eq!(b.remaining(), 0);
        b.refund(1);
        assert_eq!(b.remaining(), 1);
        assert!(b.consume(1));
    }

    #[test]
    fn budget_minimum_is_one() {
        let mut b = IterationBudget::new(0);
        assert!(b.consume(1));
        assert!(!b.consume(1));
    }

    #[test]
    fn loop_guard_warns_on_identical_repeat() {
        let mut g = ToolLoopGuard::new();
        let params = json!({"path": "~"});
        let result = json!({"files": ["a"]});
        g.record("dir", &params, &result);
        assert!(g.check().is_none());
        g.record("dir", &params, &result);
        let msg = g.check().unwrap();
        assert!(
            msg.contains("You already made this exact tool call 2 times"),
            "{msg}"
        );
        // notified once per stamp
        assert!(g.check().is_none());
    }

    #[test]
    fn loop_guard_escapes_after_five() {
        let mut g = ToolLoopGuard::new();
        let params = json!({"path": "~"});
        let result = json!({"files": ["a"]});
        for _ in 0..5 {
            g.record("dir", &params, &result);
        }
        let msg = g.check().unwrap();
        assert!(msg.contains("TOOL LOOP DETECTED"), "{msg}");
        assert!(msg.contains("5 times"));
    }

    #[test]
    fn loop_guard_warns_on_tool_streak() {
        let mut g = ToolLoopGuard::new();
        for i in 0..4 {
            g.record("grep", &json!({"n": i}), &json!({"r": i}));
        }
        let msg = g.check().unwrap();
        assert!(msg.contains("4th consecutive call of \"grep\""), "{msg}");
    }

    #[test]
    fn different_tool_breaks_streak() {
        let mut g = ToolLoopGuard::new();
        for i in 0..3 {
            g.record("grep", &json!({"n": i}), &json!({"r": i}));
        }
        g.record("dir", &json!({}), &json!({}));
        assert!(g.check().is_none());
    }

    #[test]
    fn reset_clears_history_and_notifications() {
        let mut g = ToolLoopGuard::new();
        let params = json!({});
        g.record("dir", &params, &params);
        g.record("dir", &params, &params);
        assert!(g.check().is_some());
        g.reset();
        g.record("dir", &params, &params);
        g.record("dir", &params, &params);
        assert!(
            g.check().is_some(),
            "after reset the stamp must notify again"
        );
    }

    #[test]
    fn degenerate_repetition_detected() {
        let phrase = "I am stuck in a loop and repeat myself. ";
        let text = phrase.repeat(6); // > 120 chars, tail repeats >= 3
        assert!(detect_degenerate_repetition(&text));
        assert!(!detect_degenerate_repetition(
            "short but varied text that does not repeat"
        ));
        assert!(!detect_degenerate_repetition(""));
    }

    #[test]
    fn empty_response_parity() {
        assert!(is_empty_response(""));
        assert!(is_empty_response("   \n\t"));
        assert!(!is_empty_response("x"));
    }

    #[test]
    fn bounded_tool_error() {
        assert_eq!(bound_tool_error("boom", 10), "boom");
        let long = "x".repeat(3000);
        let bounded = bound_tool_error(&long, 2048);
        assert!(bounded.contains("… [truncated 952 chars]"));
        assert!(bounded.len() < 2200);
    }

    #[test]
    fn backoff_is_capped() {
        assert_eq!(backoff_delay_ms(1), 1000);
        assert_eq!(backoff_delay_ms(2), 2000);
        assert!(backoff_delay_ms(10) <= 15_000);
        assert!(backoff_delay_ms_jittered(1, 0.5) >= 700);
    }
}
