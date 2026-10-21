//! OS-level process containment — the enforcement half of
//! [`kora_security::sandbox`].
//!
//! # Why this is a separate crate
//!
//! `kora-security` is `#![forbid(unsafe_code)]` on purpose: it is pure string and
//! filesystem logic whose tests must run identically on any host. Talking to the Win32
//! API cannot be done without `unsafe`, so it lives here instead, in one small crate
//! with one narrow job. The invariant that mattered is preserved: the *decisions*
//! (what may run, what the child environment contains) stay in `kora-security` and stay
//! testable; only the syscall lives here.
//!
//! # What it buys
//!
//! A denylist stops the commands we anticipated. A Job Object stops the *process tree*:
//!
//!   * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — when the last job handle closes (app exit,
//!     command finished, timeout), the kernel kills every descendant. This is the
//!     structural fix for the `cmd -> npx -> node` zombie problem the MCP manager
//!     currently works around with `taskkill /T /F`.
//!   * `JOB_OBJECT_LIMIT_ACTIVE_PROCESS` — a runaway `while true` fork bomb is capped.
//!   * `JOB_OBJECT_LIMIT_JOB_MEMORY` — a memory bomb is capped.
//!
//! Combined with the scrubbed environment from `kora_security::sandbox`, a command the
//! model chose cannot read the app's secrets and cannot outlive the app.

#![allow(unsafe_code)] // Win32 FFI: see the module docs for the justification.

#[cfg(windows)]
mod job;

#[cfg(windows)]
pub use job::{Job, JobLimits};

/// The limits a job applies, derived from a policy.
pub fn limits_for(policy: &kora_security::sandbox::SandboxPolicy) -> JobLimits {
    JobLimits {
        kill_on_close: true,
        max_processes: kora_security::sandbox::MAX_CHILD_PROCESSES,
        max_working_set_bytes: kora_security::sandbox::MAX_WORKING_SET_BYTES,
        // An explicit wall-clock limit is the caller's; the job does not add one.
        wall_clock_ms: policy.wall_clock_ms,
    }
}

/// Is process-tree containment actually available on this platform?
///
/// Reported rather than assumed: on a non-Windows host the shell must not claim the
/// tree is contained when it is not.
pub const fn is_containment_available() -> bool {
    cfg!(windows)
}

/// Create a containment job according to `policy`, if this platform supports one.
#[cfg(windows)]
pub fn create(policy: &kora_security::sandbox::SandboxPolicy) -> Result<Job, String> {
    if !policy.contain_process_tree {
        return Err("containment disabled by policy".to_string());
    }
    Job::new(limits_for(policy))
}

#[cfg(not(windows))]
pub fn create(_policy: &kora_security::sandbox::SandboxPolicy) -> Result<(), String> {
    Err("Process-tree containment is not implemented on this platform yet".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use kora_security::sandbox::SandboxPolicy;

    #[test]
    fn availability_is_reported_not_assumed() {
        // The test asserts the *reported* value matches the build, so a future
        // non-Windows implementation has to flip this deliberately.
        assert_eq!(is_containment_available(), cfg!(windows));
    }

    #[test]
    fn limits_come_from_the_security_policy_constants() {
        let limits = limits_for(&SandboxPolicy::default());
        assert!(limits.kill_on_close);
        assert_eq!(
            limits.max_processes,
            kora_security::sandbox::MAX_CHILD_PROCESSES
        );
        assert_eq!(
            limits.max_working_set_bytes,
            kora_security::sandbox::MAX_WORKING_SET_BYTES
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_real_job_object_can_be_created() {
        let job = Job::new(limits_for(&SandboxPolicy::default()));
        assert!(job.is_ok(), "creating a job object must succeed: {job:?}");
    }
}
