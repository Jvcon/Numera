package com.jvcon.numera.workspace

/**
 * Persistence seam for the workspace.
 *
 * [WorkspaceViewModel] depends on this interface only, never on Room, so the
 * state layer stays a plain JVM class and the S1 tests can drive it with an
 * in-memory fake. The production implementation is
 * `com.jvcon.numera.persistence.RoomWorkspacePersister`.
 *
 * Semantics mirror `web/src/lib/persistence.ts`: [load] returns null when the
 * workspace has never been written (first run), and [save] writes the full
 * snapshot atomically (clear + reinsert).
 */
interface WorkspacePersister {
    /** Read the persisted workspace, or null on first run. */
    suspend fun load(): WorkspaceSnapshot?

    /** Atomically write the full workspace snapshot. */
    suspend fun save(snapshot: WorkspaceSnapshot)
}
