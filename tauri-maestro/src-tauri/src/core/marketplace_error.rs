//! Error types for marketplace operations.

use std::fmt;

/// Errors that can occur during marketplace operations.
#[derive(Debug)]
pub enum MarketplaceError {
    /// Failed to fetch marketplace catalog.
    FetchError(String),
    /// Failed to parse marketplace catalog.
    ParseError(String),
    /// Failed to clone repository.
    CloneError(String),
    /// Plugin not found.
    PluginNotFound(String),
    /// Marketplace source not found.
    SourceNotFound(String),
    /// Plugin already installed.
    AlreadyInstalled(String),
    /// Plugin not installed.
    NotInstalled(String),
    /// Invalid path or directory.
    InvalidPath(String),
    /// IO error.
    IoError(std::io::Error),
    /// Serialization/deserialization error.
    SerdeError(serde_json::Error),
    /// Network error.
    NetworkError(String),
    /// Store error.
    StoreError(String),
}

impl fmt::Display for MarketplaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FetchError(msg) => write!(f, "Failed to fetch marketplace: {msg}"),
            Self::ParseError(msg) => write!(f, "Failed to parse marketplace catalog: {msg}"),
            Self::CloneError(msg) => write!(f, "Failed to clone repository: {msg}"),
            Self::PluginNotFound(id) => write!(f, "Plugin not found: {id}"),
            Self::SourceNotFound(id) => write!(f, "Marketplace source not found: {id}"),
            Self::AlreadyInstalled(id) => write!(f, "Plugin already installed: {id}"),
            Self::NotInstalled(id) => write!(f, "Plugin not installed: {id}"),
            Self::InvalidPath(path) => write!(f, "Invalid path: {path}"),
            Self::IoError(e) => write!(f, "IO error: {e}"),
            Self::SerdeError(e) => write!(f, "Serialization error: {e}"),
            Self::NetworkError(msg) => write!(f, "Network error: {msg}"),
            Self::StoreError(msg) => write!(f, "Store error: {msg}"),
        }
    }
}

impl std::error::Error for MarketplaceError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::IoError(e) => Some(e),
            Self::SerdeError(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for MarketplaceError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e)
    }
}

impl From<serde_json::Error> for MarketplaceError {
    fn from(e: serde_json::Error) -> Self {
        Self::SerdeError(e)
    }
}

impl From<MarketplaceError> for String {
    fn from(e: MarketplaceError) -> Self {
        e.to_string()
    }
}

/// Result type for marketplace operations.
pub type MarketplaceResult<T> = Result<T, MarketplaceError>;
