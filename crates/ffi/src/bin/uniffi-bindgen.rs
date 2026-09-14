//! UniFFI binding generator CLI.
//!
//! UniFFI 0.25 has no standalone `uniffi-bindgen` binary crate, so the
//! supported pattern is to re-export the generator from the binding crate
//! behind the `cli` feature.
//!
//! ```text
//! cargo run -p numera-ffi --features cli --bin uniffi-bindgen -- \
//!     generate crates/ffi/src/numera.udl --language kotlin --out-dir <dir>
//! ```

fn main() {
    uniffi::uniffi_bindgen_main()
}
