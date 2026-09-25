//! SSRF prevention for `web:fetch` — the Rust port of `electron/lib/web-security.ts`.
//!
//! Both functions are pure predicates: the caller parses the URL and passes the pieces in.
//! `is_blocked_host` also covers the IPv6 private ranges and the explicit `172.16.0.0/12`
//! check the TS version needed because a single hostname regex cannot express a numeric
//! range.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_regex::js_regex;

/// TS: `/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc00|\[fd[0-9a-f]|\[fe80)/i`
static BLOCKED_FETCH_HOSTS: Lazy<Regex> = Lazy::new(|| {
    js_regex(
        r"^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\]|\[fc00|\[fd[0-9a-f]|\[fe80)",
    )
});

/// TS: `/^172\.(\d+)\./` — the 172.16.0.0/12 range needs an explicit numeric check.
static PRIVATE_172: Lazy<Regex> = Lazy::new(|| js_regex(r"^172\.([0-9]+)\."));

/// Is this hostname a loopback/private/link-local target (SSRF) or the wildcard address?
pub fn is_blocked_host(hostname: &str) -> bool {
    if BLOCKED_FETCH_HOSTS.is_match(hostname) {
        return true;
    }
    if let Some(caps) = PRIVATE_172.captures(hostname) {
        if let Some(octet) = caps.get(1).and_then(|m| m.as_str().parse::<u32>().ok()) {
            return (16..=31).contains(&octet);
        }
    }
    false
}

/// Only plain HTTP(S) may be fetched; everything else (`file:`, `data:`, `javascript:`, ...)
/// is refused.
pub fn is_allowed_protocol(protocol: &str) -> bool {
    protocol == "http:" || protocol == "https:"
}
