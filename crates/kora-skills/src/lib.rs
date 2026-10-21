//! Skills — local, file-based playbooks for the agent.
//!
//! The pattern (Open Interpreter's `.agents/skills`, Jan's extensions) is that
//! capabilities live as **plain files** the user can read, edit and version, not as
//! compiled-in features. That matters for an agent: the user can inspect exactly what
//! the model is told, and add behaviour without waiting for a release.
//!
//! A skill is a directory containing `SKILL.md`:
//!
//! ```text
//! ~/.kora/skills/release-notes/
//!   SKILL.md          <- YAML frontmatter (name, description) + instructions
//!   template.md       <- any extra files the instructions refer to
//! ```
//!
//! Security rules, because this is model-consumed text sitting on disk:
//!   * discovery never follows a symlink out of the skills root — a skill directory
//!     that points at `C:\` must not turn into a file reader;
//!   * sizes are capped, so a giant file cannot blow the prompt budget;
//!   * a skill is only *offered* to the model. Invoking one still goes through the
//!     ordinary tool path, so the denylist and the confirmation flow are unchanged.
//!     A skill can never widen what the agent is allowed to do.

pub mod frontmatter;
pub mod registry;

pub use frontmatter::{parse_skill_file, Frontmatter, SkillParseError};
pub use registry::{discover, Skill, SkillRegistry, MAX_SKILL_BYTES};

/// The default location: `~/.kora/skills`, next to the other user-owned data.
///
/// Deliberately not `.agents/skills`: Kora keeps every user-owned artefact under
/// `~/.kora` (docs/PROJECT_HANDOFF §7), and this preserves that single rule.
pub fn default_root() -> std::path::PathBuf {
    kora_methods_home().join("skills")
}

fn kora_methods_home() -> std::path::PathBuf {
    for key in ["USERPROFILE", "HOME"] {
        if let Ok(v) = std::env::var(key) {
            if !v.trim().is_empty() {
                return std::path::PathBuf::from(v);
            }
        }
    }
    std::path::PathBuf::from(".")
}
