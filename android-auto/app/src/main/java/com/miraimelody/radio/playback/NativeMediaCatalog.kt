package com.miraimelody.radio.playback

import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import com.miraimelody.radio.MiraiApplication
import com.miraimelody.radio.data.AnnouncerLanguage
import com.miraimelody.radio.data.MediaRole
import com.miraimelody.radio.data.QueueMode
import com.miraimelody.radio.data.RadioSettings
import com.miraimelody.radio.data.SourceType
import com.miraimelody.radio.data.TrackEntity
import java.nio.charset.StandardCharsets
import java.util.Base64
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

class NativeMediaCatalog(private val app: MiraiApplication) {
    data class QueueResult(val items: List<MediaItem>, val startIndex: Int)

    private val knownItems = mutableMapOf<String, MediaItem>()
    private val builder = ShowQueueBuilder<TrackEntity>(title = TrackEntity::title)
    private val recentSongs = ArrayDeque<TrackEntity>()

    fun root(): MediaItem = browsable(ROOT, "mirAI melody", "Standalone native radio")

    fun children(parentId: String): List<MediaItem> {
        val result = when (parentId) {
            ROOT -> listOf(
                browsable(MUSIC, "Music queue", "Local folders and YouTube playlists"),
                browsable(RADIO, "Live radio", "Japan, China, and South Korea"),
                browsable(FAVORITES, "Favorites", "Up to ten weighted favorites"),
            )
            MUSIC -> app.database.tracks().getByRoleBlocking(MediaRole.MUSIC).map(::playable)
            RADIO -> app.database.tracks().getByRoleBlocking(MediaRole.RADIO).map(::playable)
            FAVORITES -> app.database.tracks().getByRoleBlocking(MediaRole.MUSIC)
                .filter { it.favoriteRank > 0 }.sortedBy { it.favoriteRank }.map(::playable)
            else -> {
                val sourceId = parentId.removePrefix("source:")
                app.database.tracks().getForSourceBlocking(sourceId).map(::playable)
            }
        }
        cache(result)
        return result
    }

    fun item(mediaId: String): MediaItem? {
        if (mediaId == ROOT) return root()
        if (mediaId == SpeechBgmSource.BACKEND_MEDIA_ID) return backendBgm()
        if (mediaId == SpeechBgmSource.PACKAGED_MEDIA_ID) return packagedBgm()
        return knownItems[mediaId] ?: app.database.tracks().getBlocking(mediaId)?.let(::playable)
    }

    fun search(raw: String): List<MediaItem> {
        val query = raw.trim().lowercase(Locale.ROOT)
        if (query.isEmpty()) return emptyList()
        return MediaRole.entries.flatMap { app.database.tracks().getByRoleBlocking(it) }
            .distinctBy(TrackEntity::mediaId)
            .filter {
                (it.title + " " + it.artist + " " + it.album)
                    .lowercase(Locale.ROOT).contains(query)
            }
            .take(80)
            .map(::playable)
            .also(::cache)
    }

    fun resolveItems(requested: List<MediaItem>): List<MediaItem> =
        requested.mapNotNull { item(it.mediaId) }

    fun queueFor(mediaId: String): QueueResult {
        val selected = app.database.tracks().getBlocking(mediaId)
            ?: return QueueResult(emptyList(), 0)
        if (selected.role == MediaRole.RADIO) {
            return QueueResult(listOf(playable(selected)), 0)
        }
        val settings = app.settings.current()
        val music = app.database.tracks().getByRoleBlocking(MediaRole.MUSIC)
        if (music.isEmpty()) return QueueResult(emptyList(), 0)
        val ordered = music.sortedBy { it.queuePosition }
        val start = ordered.indexOfFirst { it.mediaId == mediaId }.coerceAtLeast(0)
        val rotated = ordered.drop(start) + ordered.take(start)
        val planned = QueuePlanner.plan(
            rotated,
            settings.queueMode,
            TrackEntity::favoriteRank,
        ).take(100)
        val schedule = builder.build(
            planned,
            settings,
            app.database.tracks().getByRoleBlocking(MediaRole.INTRO),
            app.database.tracks().getByRoleBlocking(MediaRole.OUTRO),
            app.database.tracks().getByRoleBlocking(MediaRole.AD),
        )
        return QueueResult(schedule.mapIndexed { index, entry -> scheduled(entry, settings, index) }, 0)
            .also { cache(it.items) }
    }

    private fun scheduled(
        entry: ScheduledEntry<TrackEntity>,
        settings: RadioSettings,
        index: Int,
    ): MediaItem = when (entry.type) {
        SegmentType.MUSIC -> playable(requireNotNull(entry.track)).also {
            rememberSong(requireNotNull(entry.track))
        }
        SegmentType.INTRO, SegmentType.OUTRO, SegmentType.AD ->
            playable(requireNotNull(entry.media))
        SegmentType.PREVIOUS_DISCUSSION,
        SegmentType.WEATHER,
        SegmentType.TRAFFIC,
        SegmentType.NEWS,
        SegmentType.SPONSOR,
        SegmentType.NEXT_DISCUSSION -> hostSegment(entry, settings, index)
    }

    private fun hostSegment(
        entry: ScheduledEntry<TrackEntity>,
        settings: RadioSettings,
        index: Int,
    ): MediaItem {
        val current = entry.track
        val next = entry.nextTrack
        val language = if (settings.language == AnnouncerLanguage.ENGLISH) "en" else "ja"
        val kind = when (entry.type) {
            SegmentType.PREVIOUS_DISCUSSION, SegmentType.NEXT_DISCUSSION -> "chatter"
            SegmentType.WEATHER -> "weather"
            SegmentType.TRAFFIC -> "traffic"
            SegmentType.NEWS -> "news"
            SegmentType.SPONSOR -> "sponsor"
            else -> error("Not a host segment")
        }
        val payload = JSONObject().put("kind", kind).put("language", language)
        when (entry.type) {
            SegmentType.PREVIOUS_DISCUSSION, SegmentType.NEXT_DISCUSSION -> {
                payload.put(
                    "previousSong",
                    JSONObject()
                        .put("title", current?.title ?: "Unknown title")
                        .put("artist", current?.artist ?: "Unknown artist")
                        .put("album", current?.album ?: ""),
                )
                payload.put(
                    "nextSong",
                    JSONObject()
                        .put("title", next?.title ?: "Unknown title")
                        .put("artist", next?.artist ?: "Unknown artist")
                        .put("album", next?.album ?: ""),
                )
                payload.put(
                    "discussionFocus",
                    if (entry.type == SegmentType.PREVIOUS_DISCUSSION) "previous" else "next",
                )
                payload.put("listenerInteraction", settings.listenerInteractionEnabled)
                payload.put("researchedTrivia", settings.researchedChatter)
                if (settings.djMemoryEnabled && recentSongs.isNotEmpty()) {
                    payload.put(
                        "memory",
                        JSONObject()
                            .put(
                                "songs",
                                JSONArray(recentSongs.map { song ->
                                    JSONObject()
                                        .put("title", song.title)
                                        .put("artist", song.artist)
                                        .put("album", song.album)
                                }),
                            )
                            .put("announcements", JSONArray()),
                    )
                }
            }
            SegmentType.SPONSOR ->
                payload.put("brand", entry.sponsorBrand.ifBlank { "mirAI melody" })
            SegmentType.NEWS -> payload.put("focus", settings.newsFocus)
            SegmentType.WEATHER -> payload.put("isNoon", entry.isNoon)
            else -> Unit
        }
        if (entry.isPreroll) payload.put("isPreroll", true)
        val encoded = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(payload.toString().toByteArray(StandardCharsets.UTF_8))
        val currentId = current?.mediaId ?: "station"
        val cacheKey = kind + ":" + currentId + ":" + index + ":" + language + ":" +
            payload.toString().hashCode().toUInt().toString(16)
        val uri = Uri.Builder()
            .scheme("mirai")
            .authority("segment")
            .appendPath(encoded)
            .appendQueryParameter("key", cacheKey)
            .appendQueryParameter("kind", kind)
            .build()
        val title = when (entry.type) {
            SegmentType.PREVIOUS_DISCUSSION -> "Previous Song Discussion"
            SegmentType.WEATHER -> "Weather & Temperature"
            SegmentType.TRAFFIC -> "Traffic"
            SegmentType.NEWS -> "News"
            SegmentType.SPONSOR -> "Sponsor: " + entry.sponsorBrand
            SegmentType.NEXT_DISCUSSION -> "Next Song Discussion"
        }
        return MediaItem.Builder()
            .setMediaId("show:" + cacheKey)
            .setUri(uri)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setArtist(if (language == "ja") "Japanese announcer" else "English announcer")
                    .setIsPlayable(true)
                    .setIsBrowsable(false)
                    .setExtras(
                        Bundle().apply {
                            putBoolean(EXTRA_SPEECH, true)
                            putBoolean(EXTRA_REMOTE, true)
                            putString(EXTRA_SEGMENT, kind)
                        }
                    )
                    .build()
            )
            .build()
    }

    private fun rememberSong(track: TrackEntity) {
        recentSongs.removeAll { it.mediaId == track.mediaId }
        recentSongs.addLast(track)
        while (recentSongs.size > 10) recentSongs.removeFirst()
    }

    private fun playable(track: TrackEntity): MediaItem {
        val metadata = MediaMetadata.Builder()
            .setTitle(track.title)
            .setArtist(track.artist)
            .setAlbumTitle(track.album)
            .setDurationMs(track.durationMs.takeIf { it > 0 })
            .setDescription(track.technicalDetail)
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setExtras(
                Bundle().apply {
                    putBoolean(EXTRA_REMOTE, track.remote)
                    putBoolean(EXTRA_MUSIC, track.role == MediaRole.MUSIC)
                    putString(EXTRA_SOURCE_ID, track.sourceId)
                }
            )
        if (track.artworkUri.isNotBlank()) metadata.setArtworkUri(Uri.parse(track.artworkUri))
        return MediaItem.Builder()
            .setMediaId(track.mediaId)
            .setUri(Uri.parse(track.uri))
            .setMimeType(track.mimeType.ifBlank { null })
            .setMediaMetadata(metadata.build())
            .build()
    }

    private fun backendBgm(): MediaItem = MediaItem.Builder()
        .setMediaId(SpeechBgmSource.BACKEND_MEDIA_ID)
        .setUri(Uri.parse(SpeechBgmSource.BACKEND_URI))
        .setMimeType("audio/mpeg")
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle("mirAI melody speech BGM")
                .setArtist("mirAI melody")
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setExtras(Bundle().apply { putBoolean(EXTRA_REMOTE, true) })
                .build()
        )
        .build()

    private fun packagedBgm(): MediaItem = MediaItem.Builder()
        .setMediaId(SpeechBgmSource.PACKAGED_MEDIA_ID)
        .setUri(Uri.parse(SpeechBgmSource.PACKAGED_URI))
        .setMimeType("audio/mpeg")
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle("mirAI melody packaged speech BGM")
                .setArtist("mirAI melody")
                .setIsBrowsable(false)
                .setIsPlayable(true)
                .setExtras(Bundle().apply { putBoolean(EXTRA_REMOTE, false) })
                .build()
        )
        .build()
    private fun browsable(id: String, title: String, description: String): MediaItem =
        MediaItem.Builder()
            .setMediaId(id)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setDescription(description)
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .build()
            )
            .build()

    private fun cache(items: List<MediaItem>) {
        items.forEach { knownItems[it.mediaId] = it }
    }

    companion object {
        const val ROOT = "root"
        const val MUSIC = "folder:music"
        const val RADIO = "folder:radio"
        const val FAVORITES = "folder:favorites"
        const val EXTRA_SPEECH = "mirai.speech"
        const val EXTRA_REMOTE = "mirai.remote"
        const val EXTRA_MUSIC = "mirai.music"
        const val EXTRA_SOURCE_ID = "mirai.source"
        const val EXTRA_SEGMENT = "mirai.segment"
    }
}
