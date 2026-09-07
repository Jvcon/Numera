//! Numera Crypto - End-to-end encryption
//!
//! This crate provides E2E encryption with:
//! - XChaCha20-Poly1305 for file content
//! - HKDF-SHA256 for key derivation
//! - Argon2id for password-based key derivation

pub mod error;
pub mod key;
pub mod encrypt;

// Re-export main types
pub use error::CryptoError;
pub use key::{MasterKey, SpaceKey, FileKey};
pub use encrypt::Encryptor;
