package com.jvcon.numera.persistence

import androidx.room.testing.MigrationTestHelper
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Ignore
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Migration harness scaffold (S3).
 *
 * Validates the exported schema v1 once the first Gradle build writes
 * `schemas/com.jvcon.numera.persistence.AppDatabase/1.json`. Until that JSON is
 * committed the `identityHash` cannot match the generated `AppDatabase_Impl`,
 * so the class is [Ignore]d. Remove the annotation after the schema is exported.
 */
@RunWith(AndroidJUnit4::class)
@Ignore(
    "Enable after the first Gradle build exports " +
        "schemas/com.jvcon.numera.persistence.AppDatabase/1.json (identityHash must " +
        "match the generated AppDatabase_Impl); then remove @Ignore",
)
class MigrationTest {

    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AppDatabase::class.java,
    )

    @Test
    fun migrate1() {
        helper.createDatabase(TEST_DB, 1).close()
        helper.runMigrationsAndValidate(TEST_DB, 1, true)
    }

    private companion object {
        const val TEST_DB = "migration-test"
    }
}
