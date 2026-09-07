use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use crate::error::CryptoError;
use crate::key::FileKey;

/// Magic bytes for encrypted files
pub const MAGIC_BYTES: &[u8; 9] = b"NUMR_ENC\x01";

/// Encryptor for file content
pub struct Encryptor;

impl Encryptor {
    /// Encrypt data using XChaCha20-Poly1305
    pub fn encrypt(data: &[u8], key: &FileKey) -> Result<Vec<u8>, CryptoError> {
        let cipher = XChaCha20Poly1305::new(key.as_bytes().into());
        let nonce = XNonce::from_slice(key.nonce());

        let ciphertext = cipher.encrypt(nonce, data)
            .map_err(|e| CryptoError::EncryptionError(e.to_string()))?;

        let mut result = Vec::new();
        result.extend_from_slice(MAGIC_BYTES);
        result.extend_from_slice(key.nonce());
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    /// Decrypt data using XChaCha20-Poly1305
    pub fn decrypt(data: &[u8], key: &FileKey) -> Result<Vec<u8>, CryptoError> {
        // Check magic bytes
        if data.len() < MAGIC_BYTES.len() + 24 {
            return Err(CryptoError::InvalidCiphertext("Too short".to_string()));
        }

        if &data[..MAGIC_BYTES.len()] != MAGIC_BYTES {
            return Err(CryptoError::InvalidCiphertext("Invalid magic bytes".to_string()));
        }

        let nonce_start = MAGIC_BYTES.len();
        let nonce_end = nonce_start + 24;
        let ciphertext_start = nonce_end;

        let nonce = XNonce::from_slice(&data[nonce_start..nonce_end]);
        let ciphertext = &data[ciphertext_start..];

        let cipher = XChaCha20Poly1305::new(key.as_bytes().into());

        let plaintext = cipher.decrypt(nonce, ciphertext)
            .map_err(|e| CryptoError::DecryptionError(e.to_string()))?;

        Ok(plaintext)
    }

    /// Check if data is encrypted (starts with magic bytes)
    pub fn is_encrypted(data: &[u8]) -> bool {
        data.starts_with(MAGIC_BYTES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key::MasterKey;

    #[test]
    fn test_encrypt_decrypt() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let file_key = space.derive_file_key("test.numr");

        let data = b"Hello, World!";
        let encrypted = Encryptor::encrypt(data, &file_key).unwrap();
        assert!(Encryptor::is_encrypted(&encrypted));

        let decrypted = Encryptor::decrypt(&encrypted, &file_key).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_wrong_key_fails() {
        let master1 = MasterKey::generate();
        let master2 = MasterKey::generate();
        let space1 = master1.derive_space_key("default");
        let space2 = master2.derive_space_key("default");
        let key1 = space1.derive_file_key("test.numr");
        let key2 = space2.derive_file_key("test.numr");

        let data = b"Secret message";
        let encrypted = Encryptor::encrypt(data, &key1).unwrap();
        
        // Decryption with wrong key should fail
        assert!(Encryptor::decrypt(&encrypted, &key2).is_err());
    }
}
