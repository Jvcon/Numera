package com.jvcon.numera.persistence

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Room entities mirroring the web IndexedDB object stores
 * (`web/src/lib/persistence.ts`): `files`, `folders`, `globals`, `meta`.
 *
 * The single `globals` / `meta` row is keyed by [GLOBALS_KEY] (`"current"`),
 * exactly like the web `GLOBALS_KEY`.
 */

/** Key for the singleton `globals` and `meta` rows. */
const val GLOBALS_KEY = "current"

/** One persisted workspace file (drafts are never stored). */
@Entity(tableName = "files")
data class FileEntity(
    @PrimaryKey val id: String,
    val path: String,
    val displayName: String,
    val pinned: Boolean,
    val folderId: String?,
    val order: Int,
    val content: String,
)

/** One persisted workspace folder. */
@Entity(tableName = "folders")
data class FolderEntity(
    @PrimaryKey val id: String,
    val name: String,
    val pinned: Boolean,
    val collapsed: Boolean,
    val order: Int,
)

/** The single globals document row. */
@Entity(tableName = "globals")
data class GlobalsEntity(
    @PrimaryKey val key: String,
    val content: String,
)

/** Schema version + last-saved timestamp sentinel. */
@Entity(tableName = "meta")
data class MetaEntity(
    @PrimaryKey val key: String,
    val schemaVersion: Int,
    val lastSavedAt: Long,
)
