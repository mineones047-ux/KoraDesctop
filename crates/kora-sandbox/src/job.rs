//! The Windows half: a Job Object that contains a command's whole process tree.
//!
//! # What is guaranteed, and what is not
//!
//! Assigning a child to a job makes **every descendant** a member of it, and
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` makes the kernel terminate all of them when the
//! last handle closes. That is the structural fix for the `cmd -> npx -> node` zombie
//! problem the MCP manager currently works around with `taskkill /T /F`.
//!
//! The honest caveat: the child is spawned first and assigned immediately afterwards, so
//! there is a sub-millisecond window in which it could spawn a grandchild before the
//! assignment lands. Eliminating it needs `CreateProcess` with
//! `PROC_THREAD_ATTRIBUTE_JOB_LIST`, which `std::process` does not expose. Two things
//! make the residual window far less useful: Windows 8+ nests jobs, so a grandchild
//! spawned in that window is still absorbed if the parent is already in one, and the
//! denylist in `kora-security` runs *before* any of this.

use std::fmt;
use std::os::windows::process::CommandExt;
use std::process::{Child, Command};

use kora_security::sandbox::SandboxPolicy;

/// Hide the console window a child would otherwise flash.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const PROCESS_TERMINATE: u32 = 0x0001;
const PROCESS_SET_QUOTA: u32 = 0x0100;

/// Limits applied to a command's process tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JobLimits {
    /// Kill the whole tree when the last handle to the job closes.
    pub kill_on_close: bool,
    /// Maximum concurrently running processes in the tree.
    pub max_processes: u32,
    /// Maximum working set for the tree, in bytes.
    pub max_working_set_bytes: u64,
    /// Optional wall-clock limit in milliseconds, recorded for the caller to enforce.
    pub wall_clock_ms: Option<u64>,
}

impl Default for JobLimits {
    fn default() -> Self {
        Self {
            kill_on_close: true,
            max_processes: kora_security::sandbox::MAX_CHILD_PROCESSES,
            max_working_set_bytes: kora_security::sandbox::MAX_WORKING_SET_BYTES,
            wall_clock_ms: None,
        }
    }
}

/// A handle to a Windows Job Object. Dropping it closes the handle, which — with
/// `kill_on_close` — terminates the contained tree.
pub struct Job {
    handle: windows::Win32::Foundation::HANDLE,
    limits: JobLimits,
}

// SAFETY: `HANDLE` is a plain owned kernel handle. Moving a `Job` between threads is
// sound because the handle is only ever used through `&self`/`&mut self` on a single
// task at a time, and `Drop` closing it from another thread is exactly the documented
// behaviour of `CloseHandle`. No interior mutability, no aliasing of the raw pointer
// beyond the handle value itself.
unsafe impl Send for Job {}
unsafe impl Sync for Job {}

impl fmt::Debug for Job {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The raw handle is not meaningful in a log and must not be printed.
        f.debug_struct("Job")
            .field("limits", &self.limits)
            .finish_non_exhaustive()
    }
}

impl Job {
    /// Create a job and apply `limits`. Every failure is reported as `Err`; nothing here
    /// panics, because this runs on the path that executes a user's command.
    pub fn new(limits: JobLimits) -> Result<Self, String> {
        use windows::Win32::System::JobObjects::{
            CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_JOB_MEMORY, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        };

        let handle = unsafe { CreateJobObjectW(None, windows::core::PCWSTR::null()) }
            .map_err(|e| format!("CreateJobObject failed: {e}"))?;

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            | JOB_OBJECT_LIMIT_ACTIVE_PROCESS
            | JOB_OBJECT_LIMIT_JOB_MEMORY;
        info.BasicLimitInformation.ActiveProcessLimit = limits.max_processes;
        // `JOB_OBJECT_LIMIT_JOB_MEMORY` is the *aggregate* limit for the whole job, so
        // it reads `JobMemoryLimit`; `ProcessMemoryLimit` belongs to the per-process
        // flag `JOB_OBJECT_LIMIT_PROCESS_MEMORY` and is rejected together with it.
        // Mixing them up fails the call with ERROR_INVALID_PARAMETER (0x80070057).
        info.JobMemoryLimit = limits.max_working_set_bytes as usize;

        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if let Err(e) = configured {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
            return Err(format!("SetInformationJobObject failed: {e}"));
        }

        Ok(Self { handle, limits })
    }

    /// Put an already-spawned process into the job, by pid.
    ///
    /// Taking a pid rather than a `std::process::Child` is deliberate: the async
    /// runtime yields a `tokio::process::Child`, and an open handle by pid is all the
    /// Win32 API needs anyway.
    pub fn assign_pid(&self, pid: u32) -> Result<(), String> {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::JobObjects::AssignProcessToJobObject;
        use windows::Win32::System::Threading::{OpenProcess, PROCESS_ACCESS_RIGHTS};

        let access = PROCESS_ACCESS_RIGHTS(PROCESS_SET_QUOTA | PROCESS_TERMINATE);
        let process = unsafe { OpenProcess(access, false, pid) }
            .map_err(|e| format!("OpenProcess failed: {e}"))?;
        let result = unsafe { AssignProcessToJobObject(self.handle, process) };
        unsafe {
            let _ = CloseHandle(process);
        }
        result.map_err(|e| format!("AssignProcessToJobObject failed: {e}"))
    }

    /// Spawn a contained child with a scrubbed environment and no console window.
    ///
    /// The environment is replaced, not extended: everything outside the allowlist in
    /// `kora_security::sandbox` is dropped, so an API key the app holds cannot be read
    /// by a command the model chose.
    pub fn spawn_contained(
        &self,
        command: &mut Command,
        policy: &SandboxPolicy,
    ) -> std::io::Result<Child> {
        command
            .env_clear()
            .envs(kora_security::sandbox::child_env_os(policy))
            .creation_flags(CREATE_NO_WINDOW);
        let child = command.spawn()?;
        self.assign_pid(child.id()).map_err(std::io::Error::other)?;
        Ok(child)
    }

    /// The limits this job was created with.
    pub fn limits(&self) -> JobLimits {
        self.limits
    }

    /// Terminate the tree now.
    pub fn terminate(&self) -> Result<(), String> {
        unsafe { windows::Win32::System::JobObjects::TerminateJobObject(self.handle, 1) }
            .map_err(|e| format!("TerminateJobObject failed: {e}"))
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::Foundation::CloseHandle(self.handle);
        }
    }
}
