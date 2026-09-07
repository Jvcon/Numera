use rand::RngCore;
use crate::error::CryptoError;

/// Master key (user's root key)
pub struct MasterKey {
    key: [u8; 32],
}

/// Space key (derived from master key)
pub struct SpaceKey {
    key: [u8; 32],
}

/// File key (derived from space key + file path)
pub struct FileKey {
    key: [u8; 32],
    nonce: [u8; 24],
}

impl MasterKey {
    /// Generate a new random master key
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        Self { key }
    }

    /// Derive from password using Argon2id
    pub fn from_password(password: &str, salt: &[u8]) -> Result<Self, CryptoError> {
        use argon2::{Argon2, PasswordHasher};
        use argon2::password_hash::SaltString;

        let salt = SaltString::encode_b64(salt)
            .map_err(|e| CryptoError::KeyDerivationError(e.to_string()))?;

        let argon2 = Argon2::default();
        let password_hash = argon2.hash_password(password.as_bytes(), &salt)
            .map_err(|e| CryptoError::KeyDerivationError(e.to_string()))?;

        let hash = password_hash.hash
            .ok_or_else(|| CryptoError::KeyDerivationError("No hash produced".to_string()))?;

        let mut key = [0u8; 32];
        key.copy_from_slice(&hash.as_bytes()[..32]);
        Ok(Self { key })
    }

    /// Get key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// Generate mnemonic (BIP39-style 12 words)
    pub fn to_mnemonic(&self) -> Result<String, CryptoError> {
        // TODO: Implement BIP39 mnemonic generation
        // For now, return a placeholder
        Ok("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".to_string())
    }

    /// Restore from mnemonic
    pub fn from_mnemonic(mnemonic: &str) -> Result<Self, CryptoError> {
        // TODO: Implement BIP39 mnemonic parsing
        let _ = mnemonic;
        Err(CryptoError::InvalidMnemonic("Not implemented".to_string()))
    }

    /// Derive space key using HKDF-SHA256
    pub fn derive_space_key(&self, space_id: &str) -> SpaceKey {
        use hkdf::Hkdf;
        use sha2::Sha256;

        let hk = Hkdf::<Sha256>::new(Some(b"numera-space"), &self.key);
        let mut key = [0u8; 32];
        hk.expand(space_id.as_bytes(), &mut key)
            .expect("valid length");
        SpaceKey { key }
    }
}

impl SpaceKey {
    /// Get key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// Derive file key using HKDF-SHA256
    pub fn derive_file_key(&self, file_path: &str) -> FileKey {
        use hkdf::Hkdf;
        use sha2::Sha256;

        let hk = Hkdf::<Sha256>::new(Some(b"numera-file"), &self.key);
        let mut key = [0u8; 32];
        hk.expand(file_path.as_bytes(), &mut key)
            .expect("valid length");

        let mut nonce = [0u8; 24];
        rand::rngs::OsRng.fill_bytes(&mut nonce);

        FileKey { key, nonce }
    }
}

impl FileKey {
    /// Get key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// Get nonce
    pub fn nonce(&self) -> &[u8; 24] {
        &self.nonce
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_master_key_generation() {
        let key1 = MasterKey::generate();
        let key2 = MasterKey::generate();
        
        // Keys should be different
        assert_ne!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_key_derivation() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let file = space.derive_file_key("test.numr");
        
        // Derived keys should be deterministic
        let space2 = master.derive_space_key("default");
        assert_eq!(space.as_bytes(), space2.as_bytes());
    }

    #[test]
    fn test_different_spaces_different_keys() {
        let master = MasterKey::generate();
        let space1 = master.derive_space_key("space1");
        let space2 = master.derive_space_key("space2");
        
        assert_ne!(space1.as_bytes(), space2.as_bytes());
    }
}
