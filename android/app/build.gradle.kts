import org.gradle.api.tasks.Exec
import java.io.File

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.jvcon.numera"
    compileSdk = 35
    ndkVersion = "25.2.9519653"

    defaultConfig {
        applicationId = "com.jvcon.numera"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"

        // Only the ABIs cross-compiled by the `buildFfiAndroid` task (issue #7).
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        // Robolectric (S3 local-JVM Room tests) needs Android resources and the
        // JDK --add-opens flags below.
        unitTests.isIncludeAndroidResources = true
        unitTests.all {
            it.jvmArgs(
                "--add-opens=java.base/java.lang=ALL-UNNAMED",
                "--add-opens=java.base/java.util=ALL-UNNAMED",
                "--add-opens=java.base/java.io=ALL-UNNAMED",
                "--add-opens=java.base/java.net=ALL-UNNAMED",
                "--add-opens=java.base/java.security=ALL-UNNAMED",
                "--add-opens=java.base/java.text=ALL-UNNAMED",
                "--add-opens=java.base/jdk.internal.access=ALL-UNNAMED",
                "--add-opens=java.desktop/java.awt.font=ALL-UNNAMED",
                "--add-opens=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED",
            )
        }
    }

    sourceSets {
        // Exported Room schemas (schemas/*.json) are visible to local JVM
        // (Robolectric) migration tests as test assets.
        getByName("test").assets.srcDir("$projectDir/schemas")
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)

    // Room persistence (issue #9). room-ktx is empty since 2.7.0 — suspend /
    // Flow / withTransaction ship in room-runtime.
    implementation(libs.androidx.room.runtime)
    ksp(libs.androidx.room.compiler)

    // UniFFI's generated Kotlin bindings call into the engine through JNA. On
    // Android the `@aar` artifact is required: it bundles the native
    // libraries, whereas the plain jar does not.
    implementation("net.java.dev.jna:jna:${libs.versions.jna.get()}@aar")

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)

    debugImplementation(libs.androidx.ui.tooling)

    testImplementation(libs.junit)
    testImplementation(kotlin("test"))
    testImplementation(libs.kotlinx.coroutines.test)

    // S3 local-JVM (Robolectric) persistence tests — no emulator needed.
    testImplementation(libs.androidx.room.testing)
    testImplementation(libs.androidx.test.core)
    testImplementation(libs.androidx.test.ext.junit)
    testImplementation(libs.robolectric)
}

// Export Room schemas so migration tests can validate them (issue #9).
ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

// ---------------------------------------------------------------------------
// UniFFI engine wiring (issue #7)
//
// The `com.nordsec.uniffi` Gradle plugin named in the ticket is not published
// to Maven Central or the Gradle Plugin Portal, so the build drives
// `cargo ndk` + `uniffi-bindgen` directly instead. See android/README.md for
// the required local toolchain (cargo-ndk, Android NDK, Rust Android targets).
// ---------------------------------------------------------------------------
val repoRoot: File = rootProject.projectDir.parentFile
val cratesDir: File = repoRoot.resolve("crates")
val ffiCrateDir: File = repoRoot.resolve("crates/ffi")
val cargoToml: File = repoRoot.resolve("Cargo.toml")
val cargoLock: File = repoRoot.resolve("Cargo.lock")
val generatedKotlinRoot: File = file("src/main/java")
val generatedKotlinFile: File = generatedKotlinRoot.resolve("uniffi/numera/numera.kt")
val jniLibsDir: File = file("src/main/jniLibs")
val hostLibrary: File = repoRoot.resolve("target/debug/libnumera_ffi.so")

/** Builds the host cdylib whose embedded metadata uniffi-bindgen reads. */
val buildFfiHost by tasks.registering(Exec::class) {
    group = "uniffi"
    description = "Builds the host cdylib that uniffi-bindgen reads metadata from."
    workingDir = repoRoot
    commandLine("cargo", "build", "-p", "numera-ffi")
    inputs.dir(cratesDir)
    inputs.files(cargoToml, cargoLock)
    outputs.file(hostLibrary)
}

/** Generates `uniffi/numera/numera.kt` into `src/main/java`. */
val generateUniffiBindings by tasks.registering(Exec::class) {
    group = "uniffi"
    description = "Generates the Kotlin bindings from the built cdylib."
    dependsOn(buildFfiHost)
    workingDir = repoRoot
    commandLine(
        "cargo", "run", "--quiet", "-p", "numera-ffi",
        "--features", "cli", "--bin", "uniffi-bindgen", "--",
        "generate", "--library", hostLibrary.absolutePath,
        "--language", "kotlin",
        "--out-dir", generatedKotlinRoot.absolutePath,
    )
    inputs.dir(cratesDir)
    inputs.files(cargoToml, cargoLock)
    inputs.file(hostLibrary)
    outputs.file(generatedKotlinFile)
}

/** Cross-compiles `libnumera_ffi.so` for the two supported ABIs. */
val buildFfiAndroid by tasks.registering(Exec::class) {
    group = "uniffi"
    description = "Cross-compiles libnumera_ffi.so for arm64-v8a and x86_64."
    workingDir = repoRoot
    commandLine(
        "cargo", "ndk",
        "-t", "arm64-v8a",
        "-t", "x86_64",
        "-o", jniLibsDir.absolutePath,
        "build", "-p", "numera-ffi", "--release",
    )
    inputs.dir(cratesDir)
    inputs.files(cargoToml, cargoLock)
    outputs.dir(jniLibsDir)
}

// AGP consumes the generated Kotlin sources and jniLibs during the variant
// build, so both must exist before compilation / packaging runs.
tasks.matching { it.name == "preBuild" }
    .configureEach { dependsOn(generateUniffiBindings, buildFfiAndroid) }
tasks.matching { it.name.startsWith("compile") && it.name.endsWith("Kotlin") }
    .configureEach { dependsOn(generateUniffiBindings) }
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("JniLibFolders") }
    .configureEach { dependsOn(buildFfiAndroid) }
