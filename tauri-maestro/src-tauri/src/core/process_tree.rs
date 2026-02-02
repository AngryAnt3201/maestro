//! Process tree introspection for session child processes.
//!
//! Uses sysinfo for cross-platform process enumeration to build
//! a tree of all processes spawned by agent sessions.

use serde::Serialize;
use sysinfo::{Pid, Process, System};
use std::collections::HashMap;
use thiserror::Error;

/// Errors that can occur during process operations.
#[derive(Debug, Error)]
pub enum ProcessError {
    #[error("Process {0} not found")]
    NotFound(u32),
    #[error("Cannot kill root session process (use kill_session instead)")]
    CannotKillRoot,
    #[error("Failed to kill process {pid}: {reason}")]
    KillFailed { pid: u32, reason: String },
}

/// Information about a single process.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    /// Process ID
    pub pid: u32,
    /// Process name (executable name)
    pub name: String,
    /// Full command line (if available)
    pub command: Vec<String>,
    /// Parent process ID (if known)
    pub parent_pid: Option<u32>,
    /// CPU usage percentage
    pub cpu_usage: f32,
    /// Memory usage in bytes
    pub memory_bytes: u64,
}

/// A process tree rooted at a session's shell process.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProcessTree {
    /// Session ID this tree belongs to
    pub session_id: u32,
    /// PID of the root shell process
    pub root_pid: i32,
    /// All processes in the tree (flat list, use parent_pid to reconstruct hierarchy)
    pub processes: Vec<ProcessInfo>,
}

/// Builds a process tree for a session starting from its root PID.
///
/// Performs a DFS traversal from the root PID, collecting all descendant
/// processes. Returns None if the root process is not found.
pub fn get_process_tree(session_id: u32, root_pid: i32) -> Option<SessionProcessTree> {
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let root_sysinfo_pid = Pid::from_u32(root_pid as u32);

    // Check if root process exists
    if sys.process(root_sysinfo_pid).is_none() {
        return None;
    }

    // Build parent -> children map for efficient traversal
    let mut children_map: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent_pid) = process.parent() {
            children_map.entry(parent_pid).or_default().push(*pid);
        }
    }

    // DFS to collect all descendants
    let mut processes = Vec::new();
    let mut stack = vec![root_sysinfo_pid];

    while let Some(pid) = stack.pop() {
        if let Some(process) = sys.process(pid) {
            processes.push(process_to_info(pid, process));

            // Add children to stack
            if let Some(children) = children_map.get(&pid) {
                for child_pid in children {
                    stack.push(*child_pid);
                }
            }
        }
    }

    Some(SessionProcessTree {
        session_id,
        root_pid,
        processes,
    })
}

/// Converts a sysinfo Process to our ProcessInfo struct.
fn process_to_info(pid: Pid, process: &Process) -> ProcessInfo {
    ProcessInfo {
        pid: pid.as_u32(),
        name: process.name().to_string_lossy().to_string(),
        command: process.cmd().iter().map(|s| s.to_string_lossy().to_string()).collect(),
        parent_pid: process.parent().map(|p| p.as_u32()),
        cpu_usage: process.cpu_usage(),
        memory_bytes: process.memory(),
    }
}

/// Gets process trees for multiple sessions at once.
///
/// More efficient than calling get_process_tree multiple times since
/// it only refreshes the process list once.
pub fn get_all_process_trees(sessions: &[(u32, i32)]) -> Vec<SessionProcessTree> {
    if sessions.is_empty() {
        return Vec::new();
    }

    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    // Build parent -> children map once
    let mut children_map: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, process) in sys.processes() {
        if let Some(parent_pid) = process.parent() {
            children_map.entry(parent_pid).or_default().push(*pid);
        }
    }

    let mut trees = Vec::new();

    for &(session_id, root_pid) in sessions {
        let root_sysinfo_pid = Pid::from_u32(root_pid as u32);

        // Skip if root process doesn't exist
        if sys.process(root_sysinfo_pid).is_none() {
            continue;
        }

        // DFS to collect all descendants
        let mut processes = Vec::new();
        let mut stack = vec![root_sysinfo_pid];

        while let Some(pid) = stack.pop() {
            if let Some(process) = sys.process(pid) {
                processes.push(process_to_info(pid, process));

                if let Some(children) = children_map.get(&pid) {
                    for child_pid in children {
                        stack.push(*child_pid);
                    }
                }
            }
        }

        trees.push(SessionProcessTree {
            session_id,
            root_pid,
            processes,
        });
    }

    trees
}

/// Kills a process by PID.
///
/// Sends SIGTERM first, waits briefly, then SIGKILL if still alive.
/// Returns an error if the process doesn't exist or cannot be killed.
///
/// Safety: This will refuse to kill a process if it's a root session process
/// (should use kill_session for that).
pub async fn kill_process(pid: u32, session_root_pids: &[i32]) -> Result<(), ProcessError> {
    // Check if this is a root session process
    if session_root_pids.contains(&(pid as i32)) {
        return Err(ProcessError::CannotKillRoot);
    }

    // Verify process exists
    let mut sys = System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, false);

    let sysinfo_pid = Pid::from_u32(pid);
    if sys.process(sysinfo_pid).is_none() {
        return Err(ProcessError::NotFound(pid));
    }

    #[cfg(unix)]
    {
        use std::time::Duration;

        // Send SIGTERM first
        let term_result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        if term_result != 0 {
            let err = std::io::Error::last_os_error();
            return Err(ProcessError::KillFailed {
                pid,
                reason: err.to_string(),
            });
        }

        // Wait up to 2 seconds for graceful termination
        let exited = tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let result = unsafe { libc::kill(pid as i32, 0) };
                if result != 0 {
                    return; // Process gone
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await;

        if exited.is_err() {
            // Still alive - send SIGKILL
            let kill_result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
            if kill_result != 0 {
                let err = std::io::Error::last_os_error();
                // Only error if it's not "no such process" (already dead)
                if err.raw_os_error() != Some(libc::ESRCH) {
                    return Err(ProcessError::KillFailed {
                        pid,
                        reason: err.to_string(),
                    });
                }
            }
        }
    }

    #[cfg(windows)]
    {
        use std::process::Command;

        let result = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();

        match result {
            Ok(output) if !output.status.success() => {
                return Err(ProcessError::KillFailed {
                    pid,
                    reason: String::from_utf8_lossy(&output.stderr).to_string(),
                });
            }
            Err(e) => {
                return Err(ProcessError::KillFailed {
                    pid,
                    reason: e.to_string(),
                });
            }
            _ => {}
        }
    }

    log::info!("Killed process {pid}");
    Ok(())
}
