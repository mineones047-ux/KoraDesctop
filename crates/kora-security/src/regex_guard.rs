//! ReDoS guard and glob matching for the `fs:grep` tool — the Rust port of
//! `electron/lib/regex-security.ts`.
//!
//! The TS guard protects a backtracking engine (JS RegExp). After the port the same guard
//! protects the Rust `regex` engine, which is linear-time by construction, so the
//! catastrophic-backtracking heuristics are kept **bug-for-bug** rather than because they are
//! still necessary: they are also the project's "this pattern is a user error" filter, and
//! changing them would change what `fs:grep` accepts.
//!
//! Two rules differ from the TS text on purpose (both covered by `tests/js_semantics.rs`):
//!   * rule 5 uses `(?![^{}]*\})` — a lookahead the Rust engine does not have — so it is a
//!     hand-written scanner with the same acceptance;
//!   * "does it even compile" asks **our** engine (`regex::Regex::new`) instead of
//!     `new RegExp`, so a pattern the Rust engine cannot run (lookaround, backreferences,
//!     Annex-B literals such as `a{`) is rejected up front instead of being handed to an
//!     engine that would fail later. Every such case rejects *more*, never less.

use once_cell::sync::Lazy;
use regex::Regex;

use crate::js_regex::js_regex;

/// TS: `if (pattern.length > 200) return true` — in UTF-16 code units, as JS counts them.
const MAX_PATTERN_LENGTH: usize = 200;

/// `/\\\./g` — escapes are neutralised so their symbols do not count as syntax.
static ESCAPED_CHAR: Lazy<Regex> = Lazy::new(|| js_regex(r"\\."));

/// `/\[[^\]]*\]/g` — character classes are neutralised to a space.
static CHARACTER_CLASS: Lazy<Regex> = Lazy::new(|| js_regex(r"\[[^\]]*\]"));

/// Rule 1: a group (capturing, non-capturing, lookaround) followed by a quantifier.
static GROUP_WITH_QUANTIFIER: Lazy<Regex> =
    Lazy::new(|| js_regex(r"\((?:\?:|\?=|\?!|\?<=|\?<!)?([^()\n]*)\)[+*{]"));

/// Rule 1: `/[?*+]/` inside the group body.
static INNER_QUANTIFIER: Lazy<Regex> = Lazy::new(|| js_regex(r"[?*+]"));

/// Rule 1: `/\{\d+,\}/` inside the group body.
static INNER_RANGE: Lazy<Regex> = Lazy::new(|| js_regex(r"\{[0-9]+,\}"));

/// Rule 2: the token stream — `/(?:[?*+}](\d+(?:,\d*)?)?)|(?:[a-zA-Z0-9\u0000 ])/g`.
static TOKENS: Lazy<Regex> =
    Lazy::new(|| js_regex(r"(?:[?*+}](?:[0-9]+(?:,[0-9]*)?)?)|(?:[a-zA-Z0-9\x00 ])"));

/// Rule 2: is a token itself quantified? — `/[?*+]$|\{\d+,\}?$/`.
static QUANTIFIED_TOKEN: Lazy<Regex> = Lazy::new(|| js_regex(r"[?*+]$|\{[0-9]+,\}?$"));

/// Rule 3: an alternation inside a quantified group — `/\((?:[^()]*\|[^()]*)\)[+*{]/`.
static ALT_GROUP_WITH_QUANTIFIER: Lazy<Regex> =
    Lazy::new(|| js_regex(r"\((?:[^()]*\|[^()]*)\)[+*{]"));

/// Rule 3: `/^\\[wWdDsS]$/` — one escaped class shorthand, e.g. `\w`.
static ESCAPED_CLASS_SHORTHAND: Lazy<Regex> = Lazy::new(|| js_regex(r"^\\[wWdDsS]$"));

/// Rule 4: ``/\u0000./g`` — a neutralised escape plus the character it replaced.
static NEUTRALISED_ESCAPE: Lazy<Regex> = Lazy::new(|| js_regex(r"\x00."));

/// Rule 4: two quantifiers on the same atom — `/(.)[+*{][+*{]/`.
static DOUBLE_QUANTIFIER: Lazy<Regex> = Lazy::new(|| js_regex(r"(.)[+*{][+*{]"));

/// Glob metacharacters escaped before `*`/`?` are translated.
static GLOB_SPECIAL: Lazy<Regex> = Lazy::new(|| js_regex(r"[.+^${}()|\[\]\\]"));

/// `*` → `.*`
static GLOB_STAR: Lazy<Regex> = Lazy::new(|| js_regex(r"\*"));

/// `?` → `.`
static GLOB_QUESTION: Lazy<Regex> = Lazy::new(|| js_regex(r"\?"));

/// Detects patterns whose quantifiers can backtrack catastrophically (rules 1–4) or that are
/// syntactically broken (rule 5). Returns `true` = "refuse this pattern".
pub fn is_unsafe_regex(pattern: &str) -> bool {
    // JS `pattern.length` counts UTF-16 code units — keep that unit, not bytes and not chars.
    if pattern.encode_utf16().count() > MAX_PATTERN_LENGTH {
        return true;
    }
    // TS: `new RegExp(pattern)` throws on bad syntax. Here the question is "can the engine
    // that will actually run this pattern compile it?".
    if Regex::new(pattern).is_err() {
        return true;
    }
    let s = neutralise(pattern);
    has_nested_quantifier(&s)
        || has_adjacent_tokens(&s)
        || has_overlapping_alternation(&s)
        || has_double_quantifier(&s)
        || has_incomplete_quantifier(&s)
}
/// TS: `pattern.replace(/\\\./g, '\u0000').replace(/\[[^\]]*\]/g, ' ')`.
fn neutralise(pattern: &str) -> String {
    let escaped = ESCAPED_CHAR.replace_all(pattern, "\u{0}");
    CHARACTER_CLASS.replace_all(&escaped, " ").into_owned()
}

/// Rule 1: a quantified group whose body itself contains a quantifier (`(a+)+`,
/// `(a?b)+x`, `(\d{2,}){3}`).
fn has_nested_quantifier(s: &str) -> bool {
    GROUP_WITH_QUANTIFIER.captures_iter(s).any(|caps| {
        let body = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        INNER_QUANTIFIER.is_match(body) || INNER_RANGE.is_match(body)
    })
}

/// Rule 2: two adjacent quantified tokens (as the TS token scanner sees them).
fn has_adjacent_tokens(s: &str) -> bool {
    let tokens: Vec<&str> = TOKENS.find_iter(s).map(|m| m.as_str()).collect();
    tokens
        .windows(2)
        .any(|pair| QUANTIFIED_TOKEN.is_match(pair[0]) && QUANTIFIED_TOKEN.is_match(pair[1]))
}

/// Rule 3: a quantified alternation with duplicate or trivially overlapping branches
/// (`(a|a)+`, `(\w|\d)+`).
fn has_overlapping_alternation(s: &str) -> bool {
    for caps in ALT_GROUP_WITH_QUANTIFIER.captures_iter(s) {
        let body = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        let branches: Vec<&str> = body.split('|').map(str::trim).collect();

        let mut seen: Vec<&str> = Vec::new();
        for branch in &branches {
            if seen.contains(branch) {
                return true;
            }
            seen.push(branch);
        }

        if branches.len() >= 2
            && branches
                .iter()
                .all(|b| b.encode_utf16().count() == 1 || ESCAPED_CLASS_SHORTHAND.is_match(b))
        {
            return true;
        }
    }
    false
}

/// Rule 4: two quantifiers on the same atom (`a+*`, `a*+`, `a{2,}+`).
fn has_double_quantifier(s: &str) -> bool {
    let stripped = NEUTRALISED_ESCAPE.replace_all(s, "");
    DOUBLE_QUANTIFIER.is_match(&stripped)
}

/// Rule 5: an unterminated quantifier — `{digits`, `{digits,` — that never gets a closing
/// brace before the next brace or the end of the pattern.
///
/// TS: `/\{\d+(?:,\d*)?(?![^{}]*\})/` — the negative lookahead has no Rust equivalent, so
/// this is the same acceptance expressed as a scanner: the lookahead *fails* exactly when the
/// first brace after the digits is `{` or when there is no brace at all.
fn has_incomplete_quantifier(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    let mut i = 0;

    while i < n {
        if chars[i] != '{' {
            i += 1;
            continue;
        }

        // `\d+` — at least one ASCII digit (JS `\d`; neutralised escapes are `NUL` by now).
        let mut j = i + 1;
        let digits_start = j;
        while j < n && chars[j].is_ascii_digit() {
            j += 1;
        }
        if j == digits_start {
            i += 1;
            continue;
        }

        // `(?:,\d*)?` — greedy: the comma is consumed even when no digit follows it.
        if j < n && chars[j] == ',' {
            j += 1;
            while j < n && chars[j].is_ascii_digit() {
                j += 1;
            }
        }

        // `(?![^{}]*\})` — scan for the first brace; only `}` satisfies the lookahead.
        let mut k = j;
        let mut closed = false;
        while k < n {
            if chars[k] == '}' {
                closed = true;
                break;
            }
            if chars[k] == '{' {
                break;
            }
            k += 1;
        }
        if !closed {
            return true;
        }

        i = j;
    }

    false
}

/// Simple glob matcher for the `include` filter of `fs:grep` (TS: `matchGlob`).
///
/// Escapes regex metacharacters, then translates `*` and `?`, and anchors the result.
pub fn match_glob(name: &str, glob: &str) -> bool {
    let escaped = GLOB_SPECIAL.replace_all(glob, "\\$0");
    let with_stars = GLOB_STAR.replace_all(&escaped, ".*");
    let translated = GLOB_QUESTION.replace_all(&with_stars, ".");

    match Regex::new(&format!("^{translated}$")) {
        Ok(re) => re.is_match(name),
        // Unreachable in practice: everything metacharacter-ish is escaped above, so the
        // generated pattern is always valid. Refusing is the safe answer if it ever isn't.
        Err(_) => false,
    }
}

