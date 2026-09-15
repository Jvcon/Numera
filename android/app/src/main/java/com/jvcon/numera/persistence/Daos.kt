package com.jvcon.numera.persistence

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

/**
 * Data access objects for the workspace stores.
 *
 * All operations are `suspend` so callers never block the main thread. The
 * `upsert` naming reflects `INSERT OR REPLACE` semantics, mirroring the web
 * IndexedDB `put` calls.
 */

@Dao
interface FileDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(files: List<FileEntity>)

    @Query("SELECT * FROM files")
    suspend fun getAll(): List<FileEntity>

    @Query("DELETE FROM files")
    suspend fun clear()
}

@Dao
interface FolderDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(folders: List<FolderEntity>)

    @Query("SELECT * FROM folders")
    suspend fun getAll(): List<FolderEntity>

    @Query("DELETE FROM folders")
    suspend fun clear()
}

@Dao
interface GlobalsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(globals: GlobalsEntity)

    @Query("SELECT * FROM globals WHERE `key` = 'current'")
    suspend fun get(): GlobalsEntity?
}

@Dao
interface MetaDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(meta: MetaEntity)

    @Query("SELECT * FROM meta WHERE `key` = 'current'")
    suspend fun get(): MetaEntity?
}
