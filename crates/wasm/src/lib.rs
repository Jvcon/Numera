//! Numera WASM - WebAssembly bindings
//!
//! This crate exposes the calculation engine to web browsers. The
//! primary entry point is [`WasmEngine`], which mirrors the editor's
//! mental model: globals are pushed in, a document is fed line by line,
//! and per-line outcomes are returned as plain JSON for the JS layer
//! to render.

use numera_crypto::{Encryptor, FileKey, MasterKey, SpaceKey};
use numera_engine::{Engine as CoreEngine, LineOutcome};
use numera_sync::WebDavClient as RustWebDavClient;
use wasm_bindgen::prelude::*;

/// Initialize the WASM module. Wired up by `#[wasm_bindgen(start)]`.
#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages.
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// One engine instance per workspace. The JS layer is expected to keep
/// a single `WasmEngine` alive for the duration of a session.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: CoreEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            engine: CoreEngine::new(),
        }
    }

    /// Store the globals content (`globals.numr`). Subsequent
    /// [`evaluate_document`] calls re-inject globals before evaluating.
    #[wasm_bindgen(js_name = setGlobals)]
    pub fn set_globals(&mut self, content: &str) {
        self.engine.set_globals(content);
    }

    /// Evaluate every line of `document` and return one
    /// `{display, error, isEmpty, isError}` entry per input line, in
    /// order. Globals are pre-injected.
    #[wasm_bindgen(js_name = evaluateDocument)]
    pub fn evaluate_document(&mut self, document: &str) -> Result<JsValue, JsError> {
        let outcomes: Vec<LineOutcome> = self.engine.evaluate_document(document);
        serde_wasm_bindgen::to_value(&outcomes).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Single-line evaluation. Globals are NOT re-injected — call
    /// [`set_globals`] first or use [`evaluate_document`] for a fresh
    /// evaluation pass.
    #[wasm_bindgen]
    pub fn eval(&mut self, line: &str) -> Result<String, JsError> {
        self.engine
            .eval(line)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// UTF-16 offset where the executable expression ends (trailing
    /// comments are excluded). The result gutter uses this to anchor
    /// its visual marker next to the last symbol of the expression,
    /// even when the line wraps across visual rows.
    #[wasm_bindgen(js_name = expressionPrefixUtf16Len)]
    pub fn expression_prefix_utf16_len(&self, line: &str) -> usize {
        numera_engine::expression_prefix::expression_prefix_utf16_len(line)
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// Crypto bindings
//
// Keys are exchanged as raw bytes (`Vec<u8>` becomes a `Uint8Array` in JS),
// mnemonics as strings. All fallible operations surface `CryptoError` as a
// `JsError`.
// ---------------------------------------------------------------------------

fn to_js_error<E: ToString>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// Generate a fresh random 32-byte master key.
#[wasm_bindgen(js_name = generateMasterKey)]
pub fn generate_master_key() -> Vec<u8> {
    MasterKey::generate().as_bytes().to_vec()
}

/// Generate a fresh BIP39 mnemonic (12 words / 128-bit entropy).
#[wasm_bindgen(js_name = generateMnemonic)]
pub fn generate_mnemonic() -> String {
    MasterKey::generate_mnemonic().expect("system RNG failed while generating mnemonic")
}

/// Derive the 32-byte master key from a BIP39 mnemonic.
#[wasm_bindgen(js_name = masterKeyFromMnemonic)]
pub fn master_key_from_mnemonic(mnemonic: &str) -> Result<Vec<u8>, JsError> {
    MasterKey::from_mnemonic(mnemonic)
        .map(|k| k.as_bytes().to_vec())
        .map_err(to_js_error)
}

/// Derive a 32-byte space key from a master key + space id (HKDF-SHA256).
#[wasm_bindgen(js_name = deriveSpaceKey)]
pub fn derive_space_key(master_key: &[u8], space_id: &str) -> Result<Vec<u8>, JsError> {
    MasterKey::from_bytes(master_key)
        .map(|m| m.derive_space_key(space_id).as_bytes().to_vec())
        .map_err(to_js_error)
}

/// Derive a 32-byte file key from a space key + file path (deterministic).
#[wasm_bindgen(js_name = deriveFileKey)]
pub fn derive_file_key(space_key: &[u8], file_path: &str) -> Result<Vec<u8>, JsError> {
    SpaceKey::from_bytes(space_key)
        .map(|s| s.derive_file_key(file_path).as_bytes().to_vec())
        .map_err(to_js_error)
}

/// Derive the file key for `file_path` and encrypt `plaintext`.
///
/// Returns `MAGIC (9) || random nonce (24) || ciphertext (+ tag)`.
#[wasm_bindgen(js_name = encryptFile)]
pub fn encrypt_file(
    space_key: &[u8],
    file_path: &str,
    plaintext: &[u8],
) -> Result<Vec<u8>, JsError> {
    let file_key = derive_file_key_bytes(space_key, file_path)?;
    Encryptor::encrypt(plaintext, &file_key).map_err(to_js_error)
}

/// Decrypt data previously encrypted with [`encrypt_file`] for `file_path`.
#[wasm_bindgen(js_name = decryptFile)]
pub fn decrypt_file(
    space_key: &[u8],
    file_path: &str,
    ciphertext: &[u8],
) -> Result<Vec<u8>, JsError> {
    let file_key = derive_file_key_bytes(space_key, file_path)?;
    Encryptor::decrypt(ciphertext, &file_key).map_err(to_js_error)
}

/// Check whether `data` starts with the encrypted-file magic bytes.
#[wasm_bindgen(js_name = isEncrypted)]
pub fn is_encrypted(data: &[u8]) -> bool {
    Encryptor::is_encrypted(data)
}

/// Shared helper: derive the 32-byte `FileKey` for a space key + file path.
fn derive_file_key_bytes(space_key: &[u8], file_path: &str) -> Result<FileKey, JsError> {
    SpaceKey::from_bytes(space_key)
        .map(|s| s.derive_file_key(file_path))
        .map_err(to_js_error)
}

// ---------------------------------------------------------------------------
// WebDAV sync bindings
//
// Thin wrappers around `numera_sync::WebDavClient`. Errors are surfaced as
// `JsError`; `list_files` results are serialized to a JS array of
// `{ href, etag, contentLength, isCollection }` objects.
// ---------------------------------------------------------------------------

/// WebDAV sync client. One instance per remote; the JS layer is expected to
/// keep it alive for the duration of a session.
#[wasm_bindgen]
pub struct WasmDavClient {
    inner: RustWebDavClient,
}

#[wasm_bindgen]
impl WasmDavClient {
    #[wasm_bindgen(constructor)]
    pub fn new(base_url: &str, username: Option<String>, password: Option<String>) -> WasmDavClient {
        let client = RustWebDavClient::new(base_url);
        let client = match (username, password) {
            (Some(username), Some(password)) => client.with_auth(&username, &password),
            _ => client,
        };
        WasmDavClient { inner: client }
    }

    /// Check whether the WebDAV endpoint is reachable and authenticated.
    #[wasm_bindgen(js_name = checkConnection)]
    pub async fn check_connection(&self) -> Result<bool, JsError> {
        self.inner
            .check_connection()
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// List the direct children of the collection at `path` as a JS array of
    /// `{ href, etag, contentLength, isCollection }` objects.
    #[wasm_bindgen(js_name = listFiles)]
    pub async fn list_files(&self, path: &str) -> Result<JsValue, JsError> {
        let entries = self
            .inner
            .list_files(path)
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        serde_wasm_bindgen::to_value(&entries).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Download the file at `path` and return its raw bytes.
    #[wasm_bindgen(js_name = getFile)]
    pub async fn get_file(&self, path: &str) -> Result<Vec<u8>, JsError> {
        let result = self
            .inner
            .get_file(path)
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(result.content)
    }

    /// Upload `content` to `path`. When `if_match` is provided, the server
    /// only overwrites the resource if its current ETag matches.
    #[wasm_bindgen(js_name = putFile)]
    pub async fn put_file(
        &self,
        path: &str,
        content: &[u8],
        if_match: Option<String>,
    ) -> Result<(), JsError> {
        self.inner
            .put_file(path, content, if_match.as_deref())
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Delete the resource at `path`.
    #[wasm_bindgen(js_name = deleteFile)]
    pub async fn delete_file(&self, path: &str) -> Result<(), JsError> {
        self.inner
            .delete_file(path)
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Create a collection (directory) at `path`.
    #[wasm_bindgen(js_name = createDirectory)]
    pub async fn create_directory(&self, path: &str) -> Result<(), JsError> {
        self.inner
            .create_directory(path)
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }
}
