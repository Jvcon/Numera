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
///
/// The AEAD nonce is intentionally NOT part of the file key: a fresh random
/// nonce is generated for every encryption so that encrypting the same file
/// content twice yields different ciphertexts (see [`crate::Encryptor::encrypt`]).
pub struct FileKey {
    key: [u8; 32],
}

/// Fill `buf` with cryptographically secure random bytes.
///
/// Backed by `getrandom` (via `rand`'s `SysRng`), which uses the OS RNG on
/// native targets and `crypto.getRandomValues` on `wasm32-unknown-unknown`
/// (the `wasm_js` feature is enabled workspace-wide).
pub(crate) fn fill_random_bytes(buf: &mut [u8]) -> Result<(), CryptoError> {
    use rand::TryRng;

    rand::rngs::SysRng
        .try_fill_bytes(buf)
        .map_err(|e| CryptoError::RngError(e.to_string()))
}

impl MasterKey {
    /// Generate a new random master key
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        fill_random_bytes(&mut key)
            .expect("system RNG failed while generating master key");
        Self { key }
    }

    /// Rebuild a master key from its raw 32 bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        let key = <[u8; 32]>::try_from(bytes).map_err(|_| {
            CryptoError::InvalidKey(format!("master key must be 32 bytes, got {}", bytes.len()))
        })?;
        Ok(Self { key })
    }

    /// Derive from password using Argon2id
    pub fn from_password(password: &str, salt: &[u8]) -> Result<Self, CryptoError> {
        use argon2::Argon2;

        let argon2 = Argon2::default();
        let mut key = [0u8; 32];
        argon2
            .hash_password_into(password.as_bytes(), salt, &mut key)
            .map_err(|e| CryptoError::KeyDerivationError(e.to_string()))?;
        Ok(Self { key })
    }

    /// Get key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// Generate a fresh BIP39 mnemonic (12 words / 128-bit entropy)
    ///
    /// The master key is NOT recoverable from this mnemonic alone: a mnemonic
    /// encodes 128 bits of entropy while [`MasterKey`] holds 256. Deriving a
    /// key from a mnemonic runs it through BIP39 seed derivation (see
    /// [`MasterKey::from_mnemonic`]). Treat this as a backup/derivation
    /// phrase rather than an exact key backup.
    pub fn generate_mnemonic() -> Result<String, CryptoError> {
        let mut entropy = [0u8; 16]; // 128 bits => 12 words
        fill_random_bytes(&mut entropy)?;

        let mnemonic = bip39::Mnemonic::from_entropy(&entropy)
            .map_err(|e| CryptoError::InvalidMnemonic(e.to_string()))?;
        Ok(mnemonic.to_string())
    }

    /// Restore a master key from a BIP39 mnemonic
    ///
    /// The 64-byte BIP39 seed is derived via PBKDF2-SHA512 (empty passphrase);
    /// the master key is its first 32 bytes.
    pub fn from_mnemonic(mnemonic: &str) -> Result<Self, CryptoError> {
        let mnemonic = bip39::Mnemonic::parse(mnemonic)
            .map_err(|e| CryptoError::InvalidMnemonic(e.to_string()))?;
        let seed = mnemonic.to_seed("");
        let mut key = [0u8; 32];
        key.copy_from_slice(&seed[..32]);
        Ok(Self { key })
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

    /// Rebuild a space key from its raw 32 bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        let key = <[u8; 32]>::try_from(bytes).map_err(|_| {
            CryptoError::InvalidKey(format!("space key must be 32 bytes, got {}", bytes.len()))
        })?;
        Ok(Self { key })
    }

    /// Derive file key using HKDF-SHA256
    ///
    /// Deterministic: the same space key + file path always yields the same
    /// file key. Per-encryption freshness comes from the random AEAD nonce
    /// generated inside [`crate::Encryptor::encrypt`].
    pub fn derive_file_key(&self, file_path: &str) -> FileKey {
        use hkdf::Hkdf;
        use sha2::Sha256;

        let hk = Hkdf::<Sha256>::new(Some(b"numera-file"), &self.key);
        let mut key = [0u8; 32];
        hk.expand(file_path.as_bytes(), &mut key)
            .expect("valid length");
        FileKey { key }
    }
}

impl FileKey {
    /// Get key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }

    /// Rebuild a file key from its raw 32 bytes
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CryptoError> {
        let key = <[u8; 32]>::try_from(bytes).map_err(|_| {
            CryptoError::InvalidKey(format!("file key must be 32 bytes, got {}", bytes.len()))
        })?;
        Ok(Self { key })
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
    fn test_master_key_from_bytes() {
        let master = MasterKey::generate();
        let restored = MasterKey::from_bytes(master.as_bytes()).unwrap();
        assert_eq!(restored.as_bytes(), master.as_bytes());

        // Wrong length is rejected
        assert!(MasterKey::from_bytes(&[0u8; 16]).is_err());
        assert!(SpaceKey::from_bytes(&[0u8; 31]).is_err());
        assert!(FileKey::from_bytes(&[0u8; 33]).is_err());
    }

    #[test]
    fn test_key_derivation() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");
        let _file = space.derive_file_key("test.numr");

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

    #[test]
    fn test_derive_file_key_is_deterministic() {
        let master = MasterKey::generate();
        let space = master.derive_space_key("default");

        let file1 = space.derive_file_key("test.numr");
        let file2 = space.derive_file_key("test.numr");

        // Same path => same 32-byte key, no random nonce involved
        assert_eq!(file1.as_bytes(), file2.as_bytes());

        // Different path => different key
        let file_other = space.derive_file_key("other.numr");
        assert_ne!(file1.as_bytes(), file_other.as_bytes());
    }

    #[test]
    fn test_mnemonic_round_trip() {
        let mnemonic = MasterKey::generate_mnemonic().unwrap();

        // 12 words / 128-bit entropy
        assert_eq!(mnemonic.split_whitespace().count(), 12);

        // Parsing the same mnemonic twice yields the same 32-byte key
        let key1 = MasterKey::from_mnemonic(&mnemonic).unwrap();
        let key2 = MasterKey::from_mnemonic(&mnemonic).unwrap();
        assert_eq!(key1.as_bytes(), key2.as_bytes());
    }

    #[test]
    fn test_mnemonics_are_unique() {
        let m1 = MasterKey::generate_mnemonic().unwrap();
        let m2 = MasterKey::generate_mnemonic().unwrap();
        assert_ne!(m1, m2);
    }

    #[test]
    fn test_invalid_mnemonic_rejected() {
        // Garbage
        assert!(MasterKey::from_mnemonic("not a valid mnemonic phrase").is_err());
        assert!(MasterKey::from_mnemonic("").is_err());

        // Real words but wrong checksum
        assert!(MasterKey::from_mnemonic(
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon"
        ).is_err());
    }

    #[test]
    fn test_from_password() {
        let salt = b"0123456789abcdef"; // >= 8 bytes required by Argon2
        let key1 = MasterKey::from_password("correct horse battery staple", salt).unwrap();
        let key2 = MasterKey::from_password("correct horse battery staple", salt).unwrap();
        let key3 = MasterKey::from_password("wrong password", salt).unwrap();

        assert_eq!(key1.as_bytes(), key2.as_bytes());
        assert_ne!(key1.as_bytes(), key3.as_bytes());
    }
}
