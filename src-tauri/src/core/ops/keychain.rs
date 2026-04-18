//! Wrapper over the `keyring` crate for Ops secrets.
//!
//! Service name: "com.claude-maestro.ops". Key names are opaque secret IDs.

use keyring::Entry;
use thiserror::Error;

const SERVICE: &str = "com.claude-maestro.ops";

#[derive(Debug, Error)]
pub enum KeychainError {
    #[error("keychain unavailable: {0}")]
    Unavailable(String),
    #[error("secret not found: {0}")]
    NotFound(String),
    #[error("keyring error: {0}")]
    Other(String),
}

pub type KeychainResult<T> = Result<T, KeychainError>;

fn entry(id: &str) -> KeychainResult<Entry> {
    Entry::new(SERVICE, id).map_err(|e| KeychainError::Unavailable(e.to_string()))
}

pub fn put(id: &str, value: &str) -> KeychainResult<()> {
    let e = entry(id)?;
    e.set_password(value).map_err(|e| KeychainError::Other(e.to_string()))
}

pub fn get(id: &str) -> KeychainResult<String> {
    let e = entry(id)?;
    match e.get_password() {
        Ok(v) => Ok(v),
        Err(keyring::Error::NoEntry) => Err(KeychainError::NotFound(id.to_string())),
        Err(e) => Err(KeychainError::Other(e.to_string())),
    }
}

pub fn delete(id: &str) -> KeychainResult<()> {
    let e = entry(id)?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Err(KeychainError::NotFound(id.to_string())),
        Err(e) => Err(KeychainError::Other(e.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn enabled() -> bool {
        std::env::var("MAESTRO_KEYCHAIN_TEST").ok().as_deref() == Some("1")
    }

    #[test]
    fn put_get_delete_round_trip() {
        if !enabled() {
            eprintln!("skipping keychain round-trip; set MAESTRO_KEYCHAIN_TEST=1 to enable");
            return;
        }
        let id = format!("test-{}", uuid::Uuid::new_v4());
        put(&id, "hunter2").unwrap();
        assert_eq!(get(&id).unwrap(), "hunter2");
        delete(&id).unwrap();
        assert!(matches!(get(&id), Err(KeychainError::NotFound(_))));
    }
}
