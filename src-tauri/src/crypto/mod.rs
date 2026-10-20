use argon2::{Algorithm, Argon2, Params, Version};
use rand_core::{OsRng, RngCore};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use thiserror::Error;
use zeroize::Zeroize;

/// Standard SQLite 3 magic header bytes (16 bytes) for unencrypted databases.
pub const SQLITE3_HEADER_MAGIC: &[u8; 16] = b"SQLite format 3\0";

/// Argon2id parameters per Section 3.2 of `app-bible.md`:
/// - Memory cost: 64 MB (65,536 KiB)
/// - Iterations: 3
/// - Parallelism: 4 lanes
/// - Output key length: 32 bytes (256 bits)
pub const ARGON2_M_COST_KIB: u32 = 64 * 1024;
pub const ARGON2_T_COST: u32 = 3;
pub const ARGON2_P_COST: u32 = 4;
pub const KEY_LEN: usize = 32;
pub const SALT_LEN: usize = 16;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("Argon2 key derivation error: {0}")]
    KdfError(String),
    #[error("I/O error inspecting vault header: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Vault file is too small to contain a valid 16-byte salt header")]
    InvalidHeaderSize,
}

/// Holds a 256-bit derived cryptographic key and its 16-byte salt in locked memory (`mlock`),
/// automatically zeroizing its contents upon drop.
pub struct LockedVaultKey {
    key: [u8; KEY_LEN],
    salt: [u8; SALT_LEN],
    is_mlocked: bool,
}

impl LockedVaultKey {
    /// Derives a 256-bit key from a user passphrase and 16-byte salt using Argon2id
    /// (64 MB RAM, 3 iterations, 4 parallelism) and locks the key pages in OS memory.
    pub fn derive(passphrase: &str, salt: [u8; SALT_LEN]) -> Result<Self, CryptoError> {
        let params = Params::new(
            ARGON2_M_COST_KIB,
            ARGON2_T_COST,
            ARGON2_P_COST,
            Some(KEY_LEN),
        )
        .map_err(|e| CryptoError::KdfError(e.to_string()))?;

        let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

        let mut key = [0u8; KEY_LEN];
        argon2
            .hash_password_into(passphrase.as_bytes(), &salt, &mut key)
            .map_err(|e| CryptoError::KdfError(e.to_string()))?;

        let mut instance = Self {
            key,
            salt,
            is_mlocked: false,
        };
        instance.lock_memory();
        Ok(instance)
    }

    /// Generates a new cryptographically random 16-byte salt and derives the key.
    pub fn derive_with_new_salt(passphrase: &str) -> Result<Self, CryptoError> {
        let salt = generate_salt();
        Self::derive(passphrase, salt)
    }

    #[cfg(unix)]
    fn lock_memory(&mut self) {
        unsafe {
            let ptr = self.key.as_ptr() as *const libc::c_void;
            if libc::mlock(ptr, KEY_LEN) == 0 {
                self.is_mlocked = true;
            }
        }
    }

    #[cfg(not(unix))]
    fn lock_memory(&mut self) {
        self.is_mlocked = false;
    }

    #[cfg(unix)]
    fn unlock_memory(&mut self) {
        if self.is_mlocked {
            unsafe {
                let ptr = self.key.as_ptr() as *const libc::c_void;
                let _ = libc::munlock(ptr, KEY_LEN);
            }
            self.is_mlocked = false;
        }
    }

    #[cfg(not(unix))]
    fn unlock_memory(&mut self) {
        self.is_mlocked = false;
    }

    pub fn key_bytes(&self) -> &[u8; KEY_LEN] {
        &self.key
    }

    pub fn salt_bytes(&self) -> &[u8; SALT_LEN] {
        &self.salt
    }

    pub fn is_memory_locked(&self) -> bool {
        self.is_mlocked
    }

    /// Formats the SQLCipher raw key + salt pragma string (`x'<64-hex-key><32-hex-salt>'`).
    /// The caller should zeroize the returned string after executing the PRAGMA statement.
    pub fn to_sqlcipher_raw_key_spec(&self) -> String {
        format!(
            "x'{}{}'",
            hex::encode(self.key),
            hex::encode(self.salt)
        )
    }
}

impl Drop for LockedVaultKey {
    fn drop(&mut self) {
        self.key.zeroize();
        self.salt.zeroize();
        self.unlock_memory();
    }
}

/// Generates a random 16-byte salt using OS CSPRNG (`OsRng`).
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    // Ensure the random salt never accidentally equals the ASCII SQLite header magic
    if &salt == SQLITE3_HEADER_MAGIC {
        salt[0] ^= 0xFF;
    }
    salt
}

/// Inspects the first 16 bytes of a `.finfolio` vault file on disk.
/// - Returns `Ok(None)` if the file has the standard unencrypted `"SQLite format 3\0"` header.
/// - Returns `Ok(Some(salt))` if the file has a 16-byte SQLCipher salt header.
pub fn read_vault_header_salt(path: &Path) -> Result<Option<[u8; SALT_LEN]>, CryptoError> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if metadata.len() == 0 {
        return Ok(None);
    }
    if metadata.len() < SALT_LEN as u64 {
        return Err(CryptoError::InvalidHeaderSize);
    }
    let mut header = [0u8; SALT_LEN];
    file.read_exact(&mut header)?;
    if &header == SQLITE3_HEADER_MAGIC {
        Ok(None)
    } else {
        Ok(Some(header))
    }
}
