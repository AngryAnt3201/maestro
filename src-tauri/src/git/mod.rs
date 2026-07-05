pub mod error;
pub mod ops;
pub mod runner;

pub use error::GitError;
pub use ops::{BranchInfo, CommitInfo, FileChange, GitUserConfig, RemoteInfo, WorktreeInfo};
pub use runner::Git;
