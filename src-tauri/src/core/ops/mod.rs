//! Ops panel: jobs, dispatches, tools, and drivers.
//!
//! See docs/superpowers/specs/2026-04-18-ops-panel-design.md for design.

pub mod dispatch_log;
pub mod drivers;
pub mod keychain;
pub mod model;
pub mod scheduler;
pub mod store;

pub use drivers::Driver;
pub use model::{Dispatch, Job, Tool};
