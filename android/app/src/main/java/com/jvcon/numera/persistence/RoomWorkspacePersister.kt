package com.jvcon.numera.persistence

import androidx.room.withTransaction
import com.jvcon.numera.workspace.PersistedFile
import com.jvcon.numera.workspace.PersistedFolder
import com.jvcon.numera.workspace.WorkspacePersister
import com.jvcon.numera.workspace.WorkspaceSnapshot

/**
 * Room-backed [WorkspacePersister].
 *
 * Mirrors `web/src/lib/persistence.ts`:
 * - [load] returns null when the `meta` sentinel is absent (first run).
 * - [save] atomically clears + reinserts the full snapshot and refreshes the
 *   `meta` sentinel (`schemaVersion = 1`, `lastSavedAt = now`).
 */
class RoomWorkspacePersister(private val db: AppDatabase) : WorkspacePersister {

    override suspend fun load(): WorkspaceSnapshot? {
        // First-run sentinel: no meta row means the workspace was never saved.
        if (db.metaDao().get() == null) return null

        val files = db.fileDao().getAll().map {
            PersistedFile(
                id = it.id,
                path = it.path,
                displayName = it.displayName,
                pinned = it.pinned,
                folderId = it.folderId,
                order = it.order,
                content = it.content,
            )
        }
        val folders = db.folderDao().getAll().map {
            PersistedFolder(
                id = it.id,
                name = it.name,
                pinned = it.pinned,
                collapsed = it.collapsed,
                order = it.order,
            )
        }
        val globalsContent = db.globalsDao().get()?.content ?: ""
        return WorkspaceSnapshot(files = files, folders = folders, globalsContent = globalsContent)
    }

    override suspend fun save(snapshot: WorkspaceSnapshot) {
        db.withTransaction {
            db.fileDao().clear()
            db.fileDao().upsertAll(
                snapshot.files.map {
                    FileEntity(
                        id = it.id,
                        path = it.path,
                        displayName = it.displayName,
                        pinned = it.pinned,
                        folderId = it.folderId,
                        order = it.order,
                        content = it.content,
                    )
                },
            )

            db.folderDao().clear()
            db.folderDao().upsertAll(
                snapshot.folders.map {
                    FolderEntity(
                        id = it.id,
                        name = it.name,
                        pinned = it.pinned,
                        collapsed = it.collapsed,
                        order = it.order,
                    )
                },
            )

            db.globalsDao().upsert(GlobalsEntity(key = GLOBALS_KEY, content = snapshot.globalsContent))
            db.metaDao().upsert(
                MetaEntity(
                    key = GLOBALS_KEY,
                    schemaVersion = 1,
                    lastSavedAt = System.currentTimeMillis(),
                ),
            )
        }
    }
}
