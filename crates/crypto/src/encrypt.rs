use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use crate::error::CryptoError;
use crate::key::{fill_random_bytes, FileKey};

/// Magic bytes for encrypted files
pub const MAGIC_BYTES: &[u8; 9] = b"NUMR_ENC\x01";

/// Encryptor for file content
pub struct Encryptor;

impl Encryptor {
    /// Encrypt data using XChaCha20-Poly1305
    ///
    /// A fresh random 24-byte nonce is generated for every call, so the same
    /// plaintext + key never yields the same ciphertext. Output layout:
    /// `MAGIC (9 bytes) || nonce (24 bytes) || ciphertext (+ 16-byte tag)`.
    pub fn encrypt(data: &[u8], key: &FileKey) -> Result<Vec<u8>, CryptoError> {
        // Fresh random nonce per call (never reuse a nonce under the same key).
        let mut nonce_bytes = [0u8; 24];
        fill_random_bytes(&mut nonce_bytes)?;

        let mut result = Vec::with_capacity(MAGIC_BYTES.len() + nonce_bytes.len() + data.len() + 16);
        result.extend_from_slice(MAGIC_BYTES);
        result.extend_from_slice(&nonce_bytes);

        let nonce = XNonce::from(nonce_bytes);
        let cipher = XChaCha20Poly1305::new(key.as_bytes().into());

        let ciphertext = cipher
            .encrypt(&nonce, data)
            .map_err(|e| CryptoError::EncryptionError(e.to_string()))?;
        result.extend_from_slice(&ciphertext);
        Ok(result)
    }

    /// Decrypt data using XChaCha20-Poly1305
    ///
    /// The nonce is read from the ciphertext (bytes 9..33), so decryption only
    /// needs the 32-byte file key.
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

        let nonce = XNonce::try_from(&data[nonce_start..nonce_end])
            .map_err(|e| CryptoError::InvalidCiphertext(e.to_string()))?;
        let ciphertext = &data[ciphertext_start..];

        let cipher = XChaCha20Poly1305::new(key.as_bytes().into());

        let plaintext = cipher
            .decrypt(&nonce, ciphertext)
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
    fn test_layout_is_magic_plus_nonce_plus_ciphertext() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let file_key = space.derive_file_key("test.numr");

        let data = b"Hello, World!";
        let encrypted = Encryptor::encrypt(data, &file_key).unwrap();

        // 9 magic bytes + 24 nonce bytes + ciphertext (with tag)
        assert_eq!(&encrypted[..MAGIC_BYTES.len()], MAGIC_BYTES);
        assert!(encrypted.len() == MAGIC_BYTES.len() + 24 + data.len() + 16);
    }

    #[test]
    fn test_same_plaintext_produces_different_ciphertexts() {
        // Fresh nonce per call => same plaintext + key must not repeat output
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let file_key = space.derive_file_key("test.numr");

        let data = b"Hello, World!";
        let enc1 = Encryptor::encrypt(data, &file_key).unwrap();
        let enc2 = Encryptor::encrypt(data, &file_key).unwrap();
        assert_ne!(enc1, enc2);

        // But both still decrypt
        assert_eq!(Encryptor::decrypt(&enc1, &file_key).unwrap(), data);
        assert_eq!(Encryptor::decrypt(&enc2, &file_key).unwrap(), data);
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

    #[test]
    fn test_decrypt_rejects_garbage() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let file_key = space.derive_file_key("test.numr");

        assert!(Encryptor::decrypt(b"too short", &file_key).is_err());

        // Wrong magic
        let mut junk = vec![0u8; MAGIC_BYTES.len() + 24];
        junk[..MAGIC_BYTES.len()].copy_from_slice(b"NUMR_OTHR");
        assert!(Encryptor::decrypt(&junk, &file_key).is_err());
    }
}
