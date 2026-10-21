//! `SKILL.md` parsing: a deliberately tiny YAML frontmatter reader.
//!
//! Only the keys Kora actually uses are supported — `name`, `description`, `version`,
//! `tags` — and a `key: value` line is all that is accepted. Pulling in a full YAML
//! parser would be a large dependency for three fields, and would also mean parsing
//! arbitrary user-supplied YAML with a recursive-descent parser, which is exactly the
//! kind of surface this crate avoids.
//!
//! Everything after the closing `---` is the instruction body, verbatim. It is *not*
//! interpreted here: it goes into the system prompt, and the tool path re-validates
//! whatever the model then does with it.

use std::fmt;

/// A skill file larger than this is refused. The body is model-consumed, so an
/// unbounded file is a prompt-budget problem before it is anything else.
pub const MAX_BODY_BYTES: usize = 64 * 1024;

/// The parsed frontmatter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub tags: Vec<String>,
}

/// Why a `SKILL.md` was rejected. The messages are user-facing — they land in the
/// diagnostics panel, so they say what to fix.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillParseError {
    Empty,
    TooLarge(usize),
    MissingFrontmatter,
    UnterminatedFrontmatter,
    MissingName,
    MissingDescription,
    MalformedLine(String),
}

impl fmt::Display for SkillParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SkillParseError::Empty => write!(f, "SKILL.md is empty"),
            SkillParseError::TooLarge(n) => {
                write!(f, "SKILL.md is {n} bytes, the limit is {MAX_BODY_BYTES}")
            }
            SkillParseError::MissingFrontmatter => {
                write!(f, "SKILL.md must start with a `---` frontmatter block")
            }
            SkillParseError::UnterminatedFrontmatter => {
                write!(f, "the `---` frontmatter block is never closed")
            }
            SkillParseError::MissingName => write!(f, "frontmatter is missing `name`"),
            SkillParseError::MissingDescription => {
                write!(f, "frontmatter is missing `description`")
            }
            SkillParseError::MalformedLine(line) => {
                write!(f, "frontmatter line is not `key: value`: {line}")
            }
        }
    }
}

/// The result of a successful parse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedSkill {
    pub frontmatter: Frontmatter,
    /// The instruction body, with surrounding blank lines trimmed.
    pub body: String,
}

/// Parse a `SKILL.md` document.
pub fn parse_skill_file(input: &str) -> Result<ParsedSkill, SkillParseError> {
    if input.trim().is_empty() {
        return Err(SkillParseError::Empty);
    }
    if input.len() > MAX_BODY_BYTES {
        return Err(SkillParseError::TooLarge(input.len()));
    }

    // The block must open on the very first line, so a stray BOM or blank line is a
    // clear error rather than a silent fallback.
    let mut lines = input.lines();
    match lines.next() {
        Some(first) if first.trim() == "---" => {}
        _ => return Err(SkillParseError::MissingFrontmatter),
    }

    let mut meta = Frontmatter::default();
    let mut body_started = false;
    let mut body: Vec<&str> = Vec::new();

    for line in lines {
        if !body_started && line.trim() == "---" {
            body_started = true;
            continue;
        }
        if body_started {
            body.push(line);
            continue;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            return Err(SkillParseError::MalformedLine(trimmed.to_string()));
        };
        let value = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_string();
        match key.trim().to_ascii_lowercase().as_str() {
            "name" => meta.name = Some(value),
            "description" => meta.description = Some(value),
            "version" => meta.version = Some(value),
            "tags" => {
                meta.tags = value
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .split(',')
                    .map(|t| t.trim().trim_matches('"').to_string())
                    .filter(|t| !t.is_empty())
                    .collect()
            }
            // Unknown keys are ignored on purpose: a skill written for a newer Kora
            // should still load here instead of failing to appear at all.
            _ => {}
        }
    }

    if !body_started {
        return Err(SkillParseError::UnterminatedFrontmatter);
    }
    if meta.name.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err(SkillParseError::MissingName);
    }
    if meta
        .description
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        return Err(SkillParseError::MissingDescription);
    }

    Ok(ParsedSkill {
        frontmatter: meta,
        body: body.join("\n").trim().to_string(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "\
---
name: release-notes
description: Draft release notes from the git log
version: 1.2
tags: [git, writing]
---
Run `git log` and summarise the changes.
Write one line per user-visible change.
";

    #[test]
    fn parses_a_complete_skill() {
        let s = parse_skill_file(GOOD).unwrap();
        assert_eq!(s.frontmatter.name.as_deref(), Some("release-notes"));
        assert_eq!(
            s.frontmatter.description.as_deref(),
            Some("Draft release notes from the git log")
        );
        assert_eq!(s.frontmatter.version.as_deref(), Some("1.2"));
        assert_eq!(s.frontmatter.tags, vec!["git", "writing"]);
        assert!(s.body.contains("git log"));
        assert!(s.body.contains("user-visible"));
    }

    #[test]
    fn quotes_and_comments_are_tolerated() {
        let s = parse_skill_file(
            "---\n# a comment\nname: \"quoted name\"\ndescription: 'single'\n---\nbody\n",
        )
        .unwrap();
        assert_eq!(s.frontmatter.name.as_deref(), Some("quoted name"));
        assert_eq!(s.frontmatter.description.as_deref(), Some("single"));
    }

    #[test]
    fn unknown_keys_are_ignored_so_newer_skills_still_load() {
        let s = parse_skill_file("---\nname: x\ndescription: y\nfuture_key: whatever\n---\nbody\n")
            .unwrap();
        assert_eq!(s.frontmatter.name.as_deref(), Some("x"));
    }

    #[test]
    fn an_empty_file_is_rejected() {
        assert_eq!(parse_skill_file("   \n  "), Err(SkillParseError::Empty));
    }

    #[test]
    fn a_file_without_frontmatter_is_rejected() {
        assert_eq!(
            parse_skill_file("# just markdown\n"),
            Err(SkillParseError::MissingFrontmatter)
        );
    }

    #[test]
    fn an_unterminated_block_is_rejected() {
        // Valid frontmatter lines, but the closing `---` never arrives.
        assert_eq!(
            parse_skill_file("---\nname: x\ndescription: y\nextra: z\n"),
            Err(SkillParseError::UnterminatedFrontmatter)
        );
    }

    #[test]
    fn a_missing_name_or_description_is_rejected() {
        assert_eq!(
            parse_skill_file("---\ndescription: y\n---\nbody\n"),
            Err(SkillParseError::MissingName)
        );
        assert_eq!(
            parse_skill_file("---\nname: x\n---\nbody\n"),
            Err(SkillParseError::MissingDescription)
        );
    }

    #[test]
    fn a_malformed_frontmatter_line_is_reported_verbatim() {
        let err = parse_skill_file("---\nname: x\njust-a-line\n---\nbody\n").unwrap_err();
        assert_eq!(
            err,
            SkillParseError::MalformedLine("just-a-line".to_string())
        );
    }

    #[test]
    fn an_oversized_file_is_refused_before_it_is_parsed() {
        let huge = format!(
            "---\nname: x\ndescription: y\n---\n{}",
            "a".repeat(MAX_BODY_BYTES)
        );
        assert!(matches!(
            parse_skill_file(&huge),
            Err(SkillParseError::TooLarge(_))
        ));
    }

    #[test]
    fn error_messages_tell_the_user_what_to_fix() {
        let msg = SkillParseError::MissingDescription.to_string();
        assert!(msg.contains("description"), "unhelpful message: {msg}");
    }
}
