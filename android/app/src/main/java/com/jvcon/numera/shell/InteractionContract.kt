package com.jvcon.numera.shell

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Platform-neutral navigation model (Android side).
 *
 * A thin, pure projection over `contracts/interaction.json` — the machine
 * readable form of `docs/interaction-model.md`. Web has a mirror of this module
 * (`web/src/lib/navigation-model.ts`); the conformance test feeds this one the
 * same fixture, so the two cannot drift.
 *
 * Pure JVM: no Android types, so it is exercised by a plain local unit test.
 */

/** An editing target: `file` (a list member) or a non-list `globals` / `draft`. */
@Serializable
data class EditingTargetSpec(
    val id: String,
    val title: String,
    val inFileList: Boolean,
    val exit: String? = null,
)

@Serializable
data class SurfaceSpec(
    val id: String,
    val kind: String,
    val status: String,
    val label: String? = null,
    val entry: List<String> = emptyList(),
    val exit: String,
)

@Serializable
data class TopBarSpec(
    val invariant: String,
    val leading: Map<String, String>,
    val trailing: Map<String, List<String>>,
    val exitIcon: String,
)

@Serializable
data class InteractionContract(
    val version: Int,
    val sourceOfTruth: String,
    val editingTargets: List<EditingTargetSpec>,
    val surfaces: List<SurfaceSpec>,
    val topBar: TopBarSpec,
    val backPrecedence: List<String>,
    val bindings: Map<String, Map<String, List<String>>> = emptyMap(),
    val forbiddenSynonyms: Map<String, List<String>> = emptyMap(),
) {
    fun editingTarget(id: String): EditingTargetSpec? =
        editingTargets.firstOrNull { it.id == id }

    /** Whether an editing target appears as a row in the file list. */
    fun isInFileList(id: String): Boolean = editingTarget(id)?.inFileList == true

    /**
     * The affordances resolved into the top-bar leading slot for a size class.
     * The exclusivity invariant guarantees at most one.
     */
    fun leadingAffordances(sizeClass: AppWindowSizeClass): List<String> {
        val value = topBar.leading[sizeClass.name.lowercase()] ?: "none"
        return if (value == "none") emptyList() else listOf(value)
    }

    /** The trailing actions for an editing target, in order. */
    fun trailingActions(id: String): List<String> = topBar.trailing[id].orEmpty()

    /**
     * Resolve a back gesture against the contract's fixed precedence
     * (`dismiss-overlay → close-drawer → exit-editing-target → root-exit`).
     */
    fun resolveBack(
        overlayOpen: Boolean,
        drawerOpen: Boolean,
        editingTargetId: String,
    ): String {
        for (action in backPrecedence) {
            val applies = when (action) {
                "dismiss-overlay" -> overlayOpen
                "close-drawer" -> drawerOpen
                "exit-editing-target" -> !isInFileList(editingTargetId)
                "root-exit" -> true
                else -> false
            }
            if (applies) return action
        }
        return "root-exit"
    }

    companion object {
        fun parse(text: String): InteractionContract =
            Json { ignoreUnknownKeys = true }
                .decodeFromString(InteractionContract.serializer(), text)
    }
}
