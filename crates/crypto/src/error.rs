use thiserror::Error;

/// Crypto error types
#[derive(Error, Debug)]
pub enum CryptoError {
    #[error("Encryption error: {0}")]
    EncryptionError(String),

    #[error("Decryption error: {0}")]
    DecryptionError(String),

    #[error("Key derivation error: {0}")]
    KeyDerivationError(String),

    #[error("Random number generation failed: {0}")]
    RngError(String),

    #[error("Invalid key: {0}")]
    InvalidKey(String),

    #[error("Invalid nonce: {0}")]
    InvalidNonce(String),

    #[error("Invalid ciphertext: {0}")]
    InvalidCiphertext(String),

    #[error("Authentication failed")]
    AuthenticationFailed,

    #[error("Invalid mnemonic: {0}")]
    InvalidMnemonic(String),
}
