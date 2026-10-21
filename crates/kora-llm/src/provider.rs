//! The provider layer: Kora's provider ids → `rig` clients.
//!
//! This is the file that makes the `rig` adoption worth it. Before, every provider meant
//! hand-written URL building, headers, body assembly and SSE parsing
//! (`electron/services/api.ts` + `crates/kora-llm/src/lib.rs`). Now `rig` owns the wire
//! format for **24** providers and Kora keeps only two things it must own:
//!
//! 1. **the frozen error contract** — `[kora:<reason>]` and the eight reason values are
//!    parsed by `src/agent/guards.ts` in the renderer, so they cannot change. The mapping
//!    from a provider failure to one of those eight values lives in [`reason_for`];
//! 2. **the local-provider dialect** — LM Studio, Ollama and llama.cpp are
//!    OpenAI-compatible at a different base URL, and `custom` is OpenAI-compatible at a
//!    user-supplied one. That is a routing decision, not a protocol, so it belongs here.
//!
//! The `[kora:<reason>]` values are also what `data.koraReason` carries over
//! `kora-rpc/1` (docs/CORE_RPC.md §4), so the same mapping serves the desktop and CLI.

use rig_core::client::CompletionClient;
use rig_core::providers::openai;

/// A provider Kora knows how to reach, with the settings needed to build its client.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderSpec {
    pub id: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

impl ProviderSpec {
    /// Does this provider need a key at all? Local ones do not.
    pub fn requires_key(&self) -> bool {
        crate::provider_requires_key(&self.id)
    }
}

/// Which wire protocol a provider speaks.
///
/// Everything Kora supports today is OpenAI-compatible, but that is a *routing* fact,
/// not a guarantee for the future, so the enum exists and the local ones are named.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    /// OpenAI Chat Completions (also LM Studio, Ollama, llama.cpp, Groq, DeepSeek,
    /// Mistral, xAI, Gemini's OpenAI endpoint, and any custom base URL).
    OpenAiCompatible,
    /// Anthropic Messages API — a genuinely different body and header format.
    Anthropic,
}

/// The dialect for a provider id.
pub fn dialect_for(provider: &str) -> Dialect {
    match provider {
        "anthropic" => Dialect::Anthropic,
        _ => Dialect::OpenAiCompatible,
    }
}

/// Normalise a base URL: `rig` expects the API root, and the UI stores it without a
/// trailing `/v1` in some places and with it in others. Both must work.
pub fn normalise_base_url(raw: &str) -> String {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.ends_with("/v1") || trimmed.ends_with("/api") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/v1")
    }
}

/// Build an OpenAI-compatible `rig` client for a spec.
///
/// A missing key is not an error: LM Studio, Ollama and llama.cpp are keyless, and
/// `rig`'s builder needs *something* in the slot. The placeholder is never a real
/// credential, and a local server ignores the header anyway — for a real cloud
/// provider [`ProviderSpec::requires_key`] already reported the problem upstream.
pub fn build_client(spec: &ProviderSpec) -> Result<openai::Client, String> {
    let key = spec
        .api_key
        .clone()
        .unwrap_or_else(|| "not-needed".to_string());
    let base = normalise_base_url(&spec.base_url);
    if base.is_empty() {
        return Err(format!("provider \"{}\" has no base URL", spec.id));
    }

    // `rig` keeps the real OpenAI endpoint versioned in one place, so it is only
    // overridden when the user actually pointed Kora somewhere else.
    let builder = openai::Client::builder()
        .api_key(key)
        .base_url(base)
        .build()
        .map_err(|e| format!("could not build the client: {e}"))?;
    Ok(builder)
}

/// The completion model for a spec, or a plain error naming what is missing.
pub fn completion_model(
    spec: &ProviderSpec,
) -> Result<impl rig_core::completion::CompletionModel, String> {
    if spec.model.trim().is_empty() {
        return Err(format!("provider \"{}\" has no model selected", spec.id));
    }
    Ok(build_client(spec)?.completion_model(spec.model.clone()))
}

/// Map a provider failure onto the frozen eight reasons.
///
/// The mapping is deliberately conservative: anything unrecognised becomes
/// [`ErrorReason::Unknown`], never a reason the renderer would retry. Retrying an
/// unclassified failure is how a request loop starts.
pub fn reason_for(status: Option<u16>, message: &str) -> crate::ErrorReason {
    match status {
        Some(code) => crate::classify_http_error(code, message),
        None => crate::classify_network_error(message),
    }
}

/// Does this provider speak the Anthropic dialect? Kept as a method so call sites do not
/// re-derive it.
pub fn is_anthropic(provider: &str) -> bool {
    dialect_for(provider) == Dialect::Anthropic
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_providers_need_no_key() {
        for p in ["lmstudio", "ollama", "llamacpp"] {
            assert!(
                !crate::provider_requires_key(p),
                "{p} must not require a key"
            );
        }
        for p in ["openai", "anthropic", "groq", "custom"] {
            assert!(crate::provider_requires_key(p), "{p} must require a key");
        }
    }

    #[test]
    fn base_urls_are_normalised_to_a_versioned_root() {
        assert_eq!(
            normalise_base_url("http://localhost:1234"),
            "http://localhost:1234/v1"
        );
        assert_eq!(
            normalise_base_url("http://localhost:1234/"),
            "http://localhost:1234/v1"
        );
        // Already versioned: left alone, not doubled.
        assert_eq!(
            normalise_base_url("http://localhost:11434/v1"),
            "http://localhost:11434/v1"
        );
        assert_eq!(normalise_base_url("   "), "");
    }

    #[test]
    fn anthropic_is_the_only_non_openai_dialect() {
        assert_eq!(dialect_for("anthropic"), Dialect::Anthropic);
        for p in ["openai", "ollama", "lmstudio", "groq", "custom"] {
            assert_eq!(dialect_for(p), Dialect::OpenAiCompatible, "{p}");
        }
    }

    #[test]
    fn a_keyless_local_client_can_be_built() {
        let spec = ProviderSpec {
            id: "ollama".into(),
            base_url: "http://localhost:11434".into(),
            api_key: None,
            model: "llama3".into(),
        };
        assert!(build_client(&spec).is_ok());
        assert!(completion_model(&spec).is_ok());
    }

    #[test]
    fn a_missing_base_url_is_reported_rather_than_guessed() {
        let spec = ProviderSpec {
            id: "custom".into(),
            base_url: "".into(),
            api_key: Some("k".into()),
            model: "m".into(),
        };
        match build_client(&spec) {
            Err(e) => assert!(e.contains("no base URL"), "got: {e}"),
            Ok(_) => panic!("a spec with no base URL must be refused, not built"),
        }
    }

    #[test]
    fn a_missing_model_is_reported() {
        let spec = ProviderSpec {
            id: "ollama".into(),
            base_url: "http://localhost:11434".into(),
            api_key: None,
            model: "  ".into(),
        };
        match completion_model(&spec) {
            Err(e) => assert!(e.contains("no model"), "got: {e}"),
            Ok(_) => panic!("a spec with no model must be refused, not built"),
        }
    }

    #[test]
    fn an_unclassifiable_failure_never_becomes_retryable() {
        // The safety property: an unknown failure must not be labelled retryable, or a
        // permanent error turns into a request loop.
        let reason = reason_for(Some(418), "a completely novel problem");
        assert!(!reason.is_retryable(), "{reason:?} must not be retryable");
        assert_eq!(reason, crate::ErrorReason::Unknown);
    }

    #[test]
    fn status_codes_still_map_to_the_frozen_reasons() {
        assert_eq!(
            reason_for(Some(429), "slow down"),
            crate::ErrorReason::RateLimit
        );
        assert_eq!(reason_for(Some(401), "bad key"), crate::ErrorReason::Auth);
        assert_eq!(
            reason_for(Some(503), "down"),
            crate::ErrorReason::ServerError
        );
    }
}
