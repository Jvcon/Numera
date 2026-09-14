# Numera Android

Requires JDK 17 and the Android SDK (compileSdk 35, minSdk 26).

Build everything with `./gradlew build`, or just the debug APK with
`./gradlew :app:assembleDebug`.

## Engine FFI (issue #7)

The Rust engine in `crates/engine` is exposed to Kotlin through a UniFFI
binding in `crates/ffi` (UniFFI 0.25.3). The editor talks to it through the
`EnginePort` interface (`com.jvcon.numera.engine`); `UniFfiEngine` is the
production implementation backed by the generated `uniffi.numera.NumeraEngine`.

The generated Kotlin class exposes these methods (camelCase):

| Kotlin method | Rust method | Notes |
| --- | --- | --- |
| `NumeraEngine()` | `NumeraEngine::new` | constructor |
| `setGlobals(content: String)` | `set_globals` | globals.numr content |
| `setDocuments(docsJson: String)` | `set_documents` | alias → content JSON object |
| `evaluateDocument(document: String): String` | `evaluate_document` | JSON array of `LineOutcome` |
| `eval(line: String): String` | `eval` | display string; errors become `""` |
| `applyRates(ratesJson: String): UInt` | `apply_rates` | accepted rate count |
| `expressionPrefixUtf16Len(line: String): UInt` | `expression_prefix_utf16_len` | result-gutter anchor |

### Why no `com.nordsec.uniffi` Gradle plugin?

The ticket suggested the `com.nordsec.uniffi` Gradle plugin (Maven
`com.nordsec:uniffi-bindgen`). That plugin is **not published**: there are no
`com.nordsec` artifacts on Maven Central and no such plugin on the Gradle
Plugin Portal. The build therefore uses the documented fallback: Gradle `Exec`
tasks that drive `cargo ndk` and `uniffi-bindgen` directly.

### Gradle tasks

| Task | What it does |
| --- | --- |
| `:app:buildFfiHost` | `cargo build -p numera-ffi` (host cdylib; source of UniFFI metadata) |
| `:app:generateUniffiBindings` | `cargo run -p numera-ffi --features cli --bin uniffi-bindgen -- generate --library … --language kotlin` → `app/src/main/java/uniffi/numera/numera.kt` |
| `:app:buildFfiAndroid` | `cargo ndk -t arm64-v8a -t x86_64 -o app/src/main/jniLibs build -p numera-ffi --release` |

`preBuild` depends on both generated artifacts, and the variant
compile/merge tasks depend on them explicitly, so `./gradlew :app:assembleDebug`
produces everything from a clean checkout.

The generated Kotlin and the `.so` files are **not committed** — they are
listed in `.gitignore` and regenerated on every build.

`crates/ffi/uniffi.toml` sets `cdylib_name = "numera_ffi"` so the generated
Kotlin loads `libnumera_ffi.so`, which is exactly what cargo produces.

### Local prerequisites

The Rust toolchain plus:

```bash
rustup target add aarch64-linux-android x86_64-linux-android
cargo install cargo-ndk
# Android NDK 25.2.9519653 via sdkmanager, and either:
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/25.2.9519653"
```

The host `cargo` and `cargo ndk` binaries must be on `PATH` when Gradle runs.

### Golden JSON test

`app/src/test/java/com/jvcon/numera/engine/LineOutcomeTest.kt` pins the
camelCase `LineOutcome` JSON contract (number / date / empty / error, plus a
`null` `rawValue`). It is a plain JVM unit test and needs no device or native
library:

```bash
./gradlew :app:testDebugUnitTest
```
