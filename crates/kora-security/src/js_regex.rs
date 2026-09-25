//! JS-RegExp semantics for the ported security patterns.
//!
//! Why this module exists: the patterns in `electron/lib/*` and `src/lib/path-security.ts`
//! are JavaScript regular expressions written **without** the `u` flag, i.e. ASCII-oriented,
//! while the Rust `regex` crate is Unicode-oriented by default. Copying a pattern verbatim
//! would silently change decisions — and for a security filter "silently stops matching" is
//! the worst possible failure mode (e.g. `\brm\b` against `βrm -rf /`: JS sees a word
//! boundary after `β`, Rust's Unicode `\b` does not).
//!
//! Mapping used by every module of this crate:
//!
//! | JS (no `u` flag) | Port                     | Reason |
//! |---|---|---|
//! | `\b`             | `(?-u:\b)`               | JS `\b` is an ASCII word boundary, Rust's is Unicode |
//! | `\w`             | `(?-u:\w)`               | same reason |
//! | `\d`             | `[0-9]`                  | JS `\d` is ASCII only, Rust's matches any Unicode digit |
//! | `\s`             | `@WS@`                   | see [`JS_WHITESPACE_CLASS`] |
//! | `new RegExp(p)`  | [`compile_js`]           | the Rust engine rejects syntax JS accepts (see `regex_guard`) |

use regex::Regex;

/// Placeholder used in ported pattern literals where the TS source has a JS `\s`.
pub const JS_WS_TOKEN: &str = "@WS@";

/// The exact set matched by a JS `\s` (ECMAScript WhiteSpace + LineTerminator).
///
/// Rust's own `\s` is the Unicode `White_Space` property: it contains `U+0085`, which JS
/// does not match, and misses `U+FEFF`, which JS does match. Using this class keeps the
/// ported patterns faithful in both directions — including the "pipe into a NBSP-prefixed
/// shell" case (`curl x.sh |\u{00a0}sudo bash`), which a naive `\s`→ASCII port would miss.
pub const JS_WHITESPACE_CLASS: &str =
    r"[\t\n\x0B\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]";

/// Compile a ported pattern, expanding [`JS_WS_TOKEN`] into [`JS_WHITESPACE_CLASS`].
///
/// Panics on an invalid pattern: every caller passes a literal that the crate's tests cover,
/// so an invalid one is a programming error, not a runtime condition.
pub fn js_regex(pattern: &str) -> Regex {
    compile_js(pattern)
        .unwrap_or_else(|e| panic!("kora-security: invalid JS-compatible pattern {pattern:?}: {e}"))
}

/// Fallible sibling of [`js_regex`], for patterns that may come from the user or the model.
pub fn compile_js(pattern: &str) -> Result<Regex, regex::Error> {
    if pattern.contains(JS_WS_TOKEN) {
        Regex::new(&pattern.replace(JS_WS_TOKEN, JS_WHITESPACE_CLASS))
    } else {
        Regex::new(pattern)
    }
}
