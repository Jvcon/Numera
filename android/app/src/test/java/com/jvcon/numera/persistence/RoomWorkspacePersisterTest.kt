package com.jvcon.numera.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.jvcon.numera.workspace.PersistedFile
import com.jvcon.numera.workspace.PersistedFolder
import com.jvcon.numera.workspace.WorkspaceSnapshot
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/**
 * Robolectric (S3) tests for [RoomWorkspacePersister] against an in-memory Room
 * database — no emulator required.
 */
@RunWith(RobolectricTestRunner::class)
class RoomWorkspacePersisterTest {

    private lateinit var db: AppDatabase
    private lateinit var persister: RoomWorkspacePersister

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).build()
        persister = RoomWorkspacePersister(db)
    }

    @After
    fun tearDown() {
        db.close()
    }

    @Test
    fun roundTrip() = runBlocking {
        val snapshot = WorkspaceSnapshot(
            files = listOf(
                PersistedFile(
                    id = "a",
                    path = "a.numr",
                    displayName = "A",
                    pinned = true,
                    folderId = null,
                    order = 0,
                    content = "a = 1\n",
                ),
                PersistedFile(
                    id = "b",
                    path = "work/b.numr",
                    displayName = "B",
                    pinned = false,
                    folderId = "f1",
                    order = 1,
                    content = "b = 2\n",
                ),
            ),
            folders = listOf(
                PersistedFolder(id = "f1", name = "work", pinned = false, collapsed = true, order = 1),
            ),
            globalsContent = "g = 1\n",
        )

        persister.save(snapshot)

        assertEquals(snapshot, persister.load())
    }

    @Test
    fun firstRunReturnsNull() = runBlocking {
        assertNull(persister.load())
    }

    @Test
    fun saveOverwritesPreviousSnapshot() = runBlocking {
        val snapshotA = WorkspaceSnapshot(
            files = listOf(
                PersistedFile(
                    id = "a",
                    path = "a.numr",
                    displayName = "A",
                    pinned = false,
                    folderId = null,
                    order = 0,
                    content = "a = 1\n",
                ),
            ),
            folders = emptyList(),
            globalsContent = "globals A\n",
        )
        val snapshotB = WorkspaceSnapshot(
            files = listOf(
                PersistedFile(
                    id = "b",
                    path = "b.numr",
                    displayName = "B",
                    pinned = true,
                    folderId = null,
                    order = 0,
                    content = "b = 2\n",
                ),
            ),
            folders = listOf(
                PersistedFolder(id = "f2", name = "two", pinned = true, collapsed = false, order = 0),
            ),
            globalsContent = "globals B\n",
        )

        persister.save(snapshotA)
        persister.save(snapshotB)

        assertEquals(snapshotB, persister.load())
    }
}
