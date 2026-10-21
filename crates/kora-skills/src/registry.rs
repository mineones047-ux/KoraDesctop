//! Discovery and the in-memory registry.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::frontmatter::{parse_skill_file, SkillParseError};

/// Hard cap on one `SKILL.md`. Matches the parser limit; kept here too so the registry
/// can refuse before reading a huge file into memory.
pub const MAX_SKILL_BYTES: u64 = 64 * 1024;

/// The file that marks a directory as a skill.
pub const SKILL_FILE: &str = "SKILL.md";

/// A loaded skill.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Skill {
    /// The `name` from frontmatter, used as the tool id.
    pub name: String,
    pub description: String,
    pub instructions: String,
    /// The directory containing `SKILL.md`, so instructions can refer to sibling files.
    pub dir: PathBuf,
    pub version: Option<String>,
    pub tags: Vec<String>,
}

impl Skill {
    /// The tool id exposed to the model. Sanitised the same way MCP tool names are,
    /// so a skill name can never produce a malformed identifier.
    pub fn tool_id(&self) -> String {
        sanitize_id(&self.name)
    }
}

/// `[^A-Za-z0-9_-] -> _`, matching the MCP `mcp__<server>__<tool>` convention.
pub fn sanitize_id(raw: &str) -> String {
    raw.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Why a directory was not loaded. Surfaced in the UI so a broken skill is visible
/// instead of silently missing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejected {
    pub dir: PathBuf,
    pub reason: String,
}

/// Find every skill under `root`.
///
/// Symlinks are never followed: a skill directory that is a link out of the skills root
/// would otherwise turn "read a playbook" into "read the whole disk". Symlinked *files*
/// inside a real skill directory are read normally, because that is how a user shares a
/// template.
pub fn discover(root: &Path) -> (Vec<Skill>, Vec<Rejected>) {
    let mut found = Vec::new();
    let mut rejected = Vec::new();

    let Ok(entries) = std::fs::read_dir(root) else {
        return (found, rejected); // no skills directory yet is not an error
    };

    for entry in entries.flatten() {
        let dir = entry.path();
        // `symlink_metadata` does not resolve the link, which is exactly what we want
        // to test: reject the link itself rather than following it.
        let Ok(meta) = std::fs::symlink_metadata(&dir) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            rejected.push(Rejected {
                dir: dir.clone(),
                reason: "symlinked skill directory is not followed".to_string(),
            });
            continue;
        }
        if !meta.is_dir() {
            continue;
        }

        match load_dir(&dir) {
            Ok(skill) => found.push(skill),
            Err(reason) => rejected.push(Rejected { dir, reason }),
        }
    }

    found.sort_by(|a, b| a.name.cmp(&b.name));
    rejected.sort_by(|a, b| a.dir.cmp(&b.dir));
    (found, rejected)
}

fn load_dir(dir: &Path) -> Result<Skill, String> {
    let file = dir.join(SKILL_FILE);
    let meta = std::fs::metadata(&file).map_err(|_| format!("no {SKILL_FILE}"))?;
    if meta.len() > MAX_SKILL_BYTES {
        return Err(format!(
            "{SKILL_FILE} is {} bytes, the limit is {MAX_SKILL_BYTES}",
            meta.len()
        ));
    }
    let raw = std::fs::read_to_string(&file).map_err(|e| e.to_string())?;
    let parsed = parse_skill_file(&raw).map_err(|e: SkillParseError| e.to_string())?;

    Ok(Skill {
        name: parsed.frontmatter.name.unwrap_or_default(),
        description: parsed.frontmatter.description.unwrap_or_default(),
        instructions: parsed.body,
        dir: dir.to_path_buf(),
        version: parsed.frontmatter.version,
        tags: parsed.frontmatter.tags,
    })
}

/// The loaded skills, keyed by tool id, plus what was rejected and why.
#[derive(Debug, Default, Clone)]
pub struct SkillRegistry {
    skills: BTreeMap<String, Skill>,
    rejected: Vec<Rejected>,
    root: PathBuf,
}

impl SkillRegistry {
    /// Build from a directory. Never fails: an unreadable root yields an empty
    /// registry, because "no skills installed" is a normal state, not an error.
    pub fn load(root: impl Into<PathBuf>) -> Self {
        let root = root.into();
        let (skills, rejected) = discover(&root);
        let mut map: BTreeMap<String, Skill> = BTreeMap::new();
        let mut dupes = Vec::new();
        for skill in skills {
            let id = skill.tool_id();
            if id.is_empty() {
                dupes.push(Rejected {
                    dir: skill.dir.clone(),
                    reason: "the sanitised name is empty".to_string(),
                });
                continue;
            }
            // A name collision must not silently drop one of the two: the loser is
            // reported so the user can rename it.
            if let Some(existing) = map.get(&id) {
                dupes.push(Rejected {
                    dir: skill.dir.clone(),
                    reason: format!(
                        "duplicate skill id \"{id}\" (already used by {})",
                        existing.dir.display()
                    ),
                });
                continue;
            }
            map.insert(id, skill);
        }
        let mut all_rejected = rejected;
        all_rejected.extend(dupes);
        Self {
            skills: map,
            rejected: all_rejected,
            root,
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn get(&self, id: &str) -> Option<&Skill> {
        self.skills.get(id)
    }

    pub fn list(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }

    pub fn rejected(&self) -> &[Rejected] {
        &self.rejected
    }

    pub fn len(&self) -> usize {
        self.skills.len()
    }

    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// The block appended to the system prompt.
    ///
    /// Only the catalogue goes in the prompt — name and description, so the model can
    /// decide whether to load one. The full instructions are fetched on invocation, or
    /// the prompt budget is spent on playbooks nobody used this turn.
    pub fn prompt_block(&self) -> String {
        if self.is_empty() {
            return String::new();
        }
        let mut out = String::from("## Skills\n\nThese playbooks are installed locally. Use `skill_show` with the id to read one before following it.\n\n");
        for skill in self.skills.values() {
            out.push_str(&format!("- {}: {}\n", skill.tool_id(), skill.description));
        }
        out
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write_skill(root: &Path, dir: &str, name: &str, description: &str) {
        let d = root.join(dir);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join(SKILL_FILE),
            format!("---\nname: {name}\ndescription: {description}\n---\nDo the thing.\n"),
        )
        .unwrap();
    }

    #[test]
    fn a_missing_root_yields_an_empty_registry_not_an_error() {
        let r = SkillRegistry::load("/definitely/not/here");
        assert!(r.is_empty());
        assert!(r.rejected().is_empty());
    }

    #[test]
    fn discovers_and_sorts_skills() {
        let tmp = tempfile::tempdir().unwrap();
        write_skill(tmp.path(), "b-dir", "zeta", "Second");
        write_skill(tmp.path(), "a-dir", "alpha", "First");

        let r = SkillRegistry::load(tmp.path());
        assert_eq!(r.len(), 2);
        let names: Vec<_> = r.list().iter().map(|s| s.name.clone()).collect();
        assert_eq!(
            names,
            vec!["alpha", "zeta"],
            "skills must be sorted for a stable prompt"
        );
    }

    #[test]
    fn a_directory_without_skill_md_is_reported_not_ignored() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("empty")).unwrap();

        let r = SkillRegistry::load(tmp.path());
        assert!(r.is_empty());
        assert_eq!(r.rejected().len(), 1);
        assert!(r.rejected()[0].reason.contains(SKILL_FILE));
    }

    #[test]
    fn a_broken_skill_does_not_hide_the_working_ones() {
        let tmp = tempfile::tempdir().unwrap();
        write_skill(tmp.path(), "good", "alpha", "Fine");
        fs::create_dir_all(tmp.path().join("bad")).unwrap();
        fs::write(
            tmp.path().join("bad").join(SKILL_FILE),
            "no frontmatter here",
        )
        .unwrap();

        let r = SkillRegistry::load(tmp.path());
        assert_eq!(r.len(), 1, "one good skill must still load");
        assert_eq!(r.rejected().len(), 1);
        assert!(r.get("alpha").is_some());
    }

    #[test]
    fn a_duplicate_id_is_reported_and_only_one_tool_is_exposed() {
        let tmp = tempfile::tempdir().unwrap();
        write_skill(tmp.path(), "one", "same name", "First");
        write_skill(tmp.path(), "two", "same name", "Second");

        let r = SkillRegistry::load(tmp.path());
        // Directory order is not guaranteed, so which of the two survives is not
        // asserted — what matters is that exactly one tool exists and the other is
        // reported rather than dropped silently.
        assert_eq!(r.len(), 1, "a collision must not produce two tools");
        assert_eq!(r.rejected().len(), 1);
        assert!(r.rejected()[0].reason.contains("duplicate"));
        // The lookup key is the *sanitised* id, not the raw frontmatter name.
        let winner = r
            .get("same_name")
            .expect("the surviving skill is keyed by its tool id");
        assert!(winner.description == "First" || winner.description == "Second");
    }

    #[test]
    fn tool_ids_are_sanitised() {
        assert_eq!(sanitize_id("release notes"), "release_notes");
        assert_eq!(sanitize_id("a/b:c"), "a_b_c");
        assert_eq!(sanitize_id("keep-1_2"), "keep-1_2");
    }

    #[test]
    fn the_prompt_block_lists_only_the_catalogue() {
        let tmp = tempfile::tempdir().unwrap();
        write_skill(tmp.path(), "d", "alpha", "Does the thing");
        let r = SkillRegistry::load(tmp.path());

        let block = r.prompt_block();
        assert!(block.contains("alpha"));
        assert!(block.contains("Does the thing"));
        // The instructions themselves are fetched on demand, not pasted into the prompt.
        assert!(
            !block.contains("Do the thing"),
            "instructions must not be inlined"
        );
    }

    #[test]
    fn an_empty_registry_produces_no_prompt_block() {
        assert_eq!(SkillRegistry::load("/nope").prompt_block(), "");
    }

    #[cfg(windows)]
    #[test]
    fn a_symlinked_skill_directory_is_refused() {
        // The escape this prevents: a link inside the skills root pointing at, say,
        // C:\Windows, turning a playbook into a file reader.
        let tmp = tempfile::tempdir().unwrap();
        let secret = tmp.path().join("outside");
        fs::create_dir_all(&secret).unwrap();
        fs::write(
            secret.join(SKILL_FILE),
            "---\nname: sneaky\ndescription: should not load\n---\nleak\n",
        )
        .unwrap();

        let link = tmp.path().join("link");
        if std::os::windows::fs::symlink_dir(&secret, &link).is_err() {
            return; // no symlink privilege — nothing to assert
        }

        let r = SkillRegistry::load(tmp.path());
        assert!(r.is_empty(), "a symlinked skill must not be loaded");
        assert!(r.rejected()[0].reason.contains("symlink"));
    }

    #[test]
    fn a_oversized_skill_file_is_refused() {
        let tmp = tempfile::tempdir().unwrap();
        let d = tmp.path().join("huge");
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join(SKILL_FILE),
            format!(
                "---\nname: huge\ndescription: big\n---\n{}",
                "a".repeat(MAX_SKILL_BYTES as usize + 10)
            ),
        )
        .unwrap();

        let r = SkillRegistry::load(tmp.path());
        assert!(r.is_empty());
        assert!(r.rejected()[0].reason.contains("limit"));
    }
}
