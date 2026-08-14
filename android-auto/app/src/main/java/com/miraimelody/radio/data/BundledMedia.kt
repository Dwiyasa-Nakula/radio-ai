package com.miraimelody.radio.data

import org.json.JSONObject

/**
 * Jingles and advertisements shipped inside the APK.
 *
 * These play with no folder picking, no enrollment, and no network, so a fresh
 * install always has intro/outro jingles and ads available offline. Users can
 * still add their own folders; those are indexed as separate sources and the
 * bundled entries simply join the same [MediaRole] pools.
 */
data class BundledItem(
    val file: String,
    val title: String,
    val artist: String,
    val roles: List<MediaRole>,
) {
    /** Assets are addressed with Media3's `asset:///` scheme. */
    val uri: String get() = ASSET_URI_PREFIX + file

    val mimeType: String
        get() = when (file.substringAfterLast('.', "").lowercase()) {
            "mp3" -> "audio/mpeg"
            "m4a" -> "audio/mp4"
            "mp4" -> "video/mp4"
            "wav" -> "audio/wav"
            "ogg", "opus" -> "audio/ogg"
            else -> ""
        }

    companion object {
        const val ASSET_URI_PREFIX = "asset:///bundled/media/"
    }
}

object BundledMedia {
    const val MANIFEST_PATH = "bundled/manifest.json"

    /** Stable source ids so re-seeding replaces rather than duplicates. */
    const val INTRO_SOURCE_ID = "bundled:intro"
    const val OUTRO_SOURCE_ID = "bundled:outro"
    const val AD_SOURCE_ID = "bundled:ad"

    fun sourceIdFor(role: MediaRole): String? = when (role) {
        MediaRole.INTRO -> INTRO_SOURCE_ID
        MediaRole.OUTRO -> OUTRO_SOURCE_ID
        MediaRole.AD -> AD_SOURCE_ID
        else -> null
    }

    /**
     * Parses the packaged manifest. Unknown roles and malformed entries are skipped
     * rather than thrown, so a bad edit degrades to fewer jingles instead of a crash
     * on startup.
     */
    fun parse(json: String): List<BundledItem> {
        val payload = JSONObject(json)
        val items = payload.optJSONArray("items") ?: return emptyList()
        return buildList {
            for (index in 0 until items.length()) {
                val entry = items.optJSONObject(index) ?: continue
                val file = entry.optString("file").trim()
                if (file.isEmpty() || file.contains('/') || file.contains('\\')) continue
                val roles = entry.optJSONArray("roles") ?: continue
                val parsedRoles = buildList {
                    for (roleIndex in 0 until roles.length()) {
                        val raw = roles.optString(roleIndex)
                        val role = MediaRole.entries.firstOrNull { it.name == raw } ?: continue
                        if (sourceIdFor(role) != null && role !in this) add(role)
                    }
                }
                if (parsedRoles.isEmpty()) continue
                add(
                    BundledItem(
                        file = file,
                        title = entry.optString("title").trim()
                            .ifEmpty { file.substringBeforeLast('.') },
                        artist = entry.optString("artist").trim(),
                        roles = parsedRoles,
                    )
                )
            }
        }
    }

    /**
     * Expands the manifest into one [TrackEntity] per (item, role) pair. A file used
     * as both intro and outro is stored once on disk but appears in both pools, so
     * media ids are namespaced by role to stay unique.
     */
    fun tracks(items: List<BundledItem>): List<TrackEntity> =
        MediaRole.entries.flatMap { role ->
            val sourceId = sourceIdFor(role) ?: return@flatMap emptyList()
            items.filter { role in it.roles }.mapIndexed { position, item ->
                TrackEntity(
                    mediaId = "bundled:" + role.name.lowercase() + ":" +
                        item.file.substringBeforeLast('.'),
                    sourceId = sourceId,
                    role = role,
                    uri = item.uri,
                    title = item.title,
                    artist = item.artist,
                    mimeType = item.mimeType,
                    queuePosition = position,
                    technicalDetail = "Bundled · offline",
                    remote = false,
                )
            }
        }
}
