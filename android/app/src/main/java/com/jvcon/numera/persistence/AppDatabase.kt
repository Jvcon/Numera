package com.jvcon.numera.persistence

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * Room database backing workspace persistence (issue #9).
 *
 * One database per workspace, with the same four logical stores as the web
 * IndexedDB layer (`files`, `folders`, `globals`, `meta`). Schema v1; exported
 * JSON lives in `app/schemas/` for migration tests.
 */
@Database(
    entities = [FileEntity::class, FolderEntity::class, GlobalsEntity::class, MetaEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun fileDao(): FileDao
    abstract fun folderDao(): FolderDao
    abstract fun globalsDao(): GlobalsDao
    abstract fun metaDao(): MetaDao
}
