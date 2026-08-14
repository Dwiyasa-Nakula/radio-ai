package com.miraimelody.radio.data

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import androidx.documentfile.provider.DocumentFile
import com.miraimelody.radio.cache.AudioFileCache
import com.miraimelody.radio.network.NativeBackendClient
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext

class SourceRepository(
    private val context: Context,
    private val database: RadioDatabase,
    private val backend: NativeBackendClient,
    private val cache: AudioFileCache,
) {
    val sources: Flow<List<SourceEntity>> = database.sources().observeAll()
    val music: Flow<List<TrackEntity>> = database.tracks().observeMusic()

    suspend fun addFolder(type: SourceType, uri: Uri) = withContext(Dispatchers.IO) {
        require(
            type in setOf(
                SourceType.MUSIC_FOLDER,
                SourceType.INTRO_JINGLE_FOLDER,
                SourceType.OUTRO_JINGLE_FOLDER,
                SourceType.AD_FOLDER,
                SourceType.BGM_FOLDER,
            )
        )
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
        val document = DocumentFile.fromTreeUri(context, uri)
            ?: error("The selected folder is unavailable")
        val source = SourceEntity(
            id = sourceId(type, uri.toString()),
            type = type,
            label = document.name ?: type.displayName(),
            value = uri.toString(),
        )
        database.sources().upsert(source)
        indexDocumentSource(source, document)
    }

    suspend fun addBgmFile(uri: Uri) = withContext(Dispatchers.IO) {
        context.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )
        val source = SourceEntity(
            id = sourceId(SourceType.BGM_FILE, uri.toString()),
            type = SourceType.BGM_FILE,
            label = displayName(uri),
            value = uri.toString(),
        )
        database.sources().upsert(source)
        database.tracks().replaceSource(
            source.id,
            listOf(extractTrack(source, uri, 0, MediaRole.BGM)),
        )
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    suspend fun addYouTubePlaylist(raw: String) = withContext(Dispatchers.IO) {
        val playlistId = raw.trim()
        require(playlistId.matches(Regex("[A-Za-z0-9_-]{13,100}"))) { "Invalid playlist ID" }
        val source = SourceEntity(
            id = "youtube-playlist:" + playlistId,
            type = SourceType.YOUTUBE_PLAYLIST,
            label = "YouTube playlist " + playlistId.take(12),
            value = playlistId,
        )
        val tracks = backend.loadYouTubePlaylist(playlistId).map { it.copy(sourceId = source.id) }
        database.sources().upsert(source)
        database.tracks().replaceSource(source.id, tracks)
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    suspend fun addRadioCountry(type: SourceType) = withContext(Dispatchers.IO) {
        val country = when (type) {
            SourceType.RADIO_JP -> "JP"
            SourceType.RADIO_CN -> "CN"
            SourceType.RADIO_KR -> "KR"
            else -> error("Not a radio source")
        }
        val source = SourceEntity(
            id = "radio:" + country,
            type = type,
            label = type.displayName(),
            value = country,
        )
        val tracks = backend.loadStations(country).map { it.copy(sourceId = source.id) }
        database.sources().upsert(source)
        database.tracks().replaceSource(source.id, tracks)
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    suspend fun addYouTubeAd(raw: String) = withContext(Dispatchers.IO) {
        val videoId = parseYouTubeVideoId(raw) ?: error("Enter a valid YouTube video link")
        val metadata = backend.validateYouTubeVideo(videoId)
        val source = SourceEntity(
            id = "youtube-ad:" + videoId,
            type = SourceType.YOUTUBE_AD,
            label = metadata.title,
            value = videoId,
        )
        val track = TrackEntity(
            mediaId = "youtube-ad:" + videoId,
            sourceId = source.id,
            role = MediaRole.AD,
            uri = "mirai://youtube/" + videoId,
            title = metadata.title,
            artist = "YouTube advertisement",
            artworkUri = metadata.thumbnailUrl,
            remote = true,
        )
        database.sources().upsert(source)
        database.tracks().replaceSource(source.id, listOf(track))
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    suspend fun refresh(source: SourceEntity) = withContext(Dispatchers.IO) {
        when (source.type) {
            SourceType.YOUTUBE_PLAYLIST -> {
                val tracks = backend.loadYouTubePlaylist(source.value).map { it.copy(sourceId = source.id) }
                database.tracks().replaceSource(source.id, tracks)
            }
            SourceType.RADIO_JP, SourceType.RADIO_CN, SourceType.RADIO_KR -> {
                val tracks = backend.loadStations(source.value).map { it.copy(sourceId = source.id) }
                database.tracks().replaceSource(source.id, tracks)
            }
            SourceType.YOUTUBE_AD -> {
                val metadata = backend.validateYouTubeVideo(source.value)
                database.sources().upsert(source.copy(label = metadata.title))
                database.tracks().replaceSource(
                    source.id,
                    listOf(
                        TrackEntity(
                            mediaId = source.id,
                            sourceId = source.id,
                            role = MediaRole.AD,
                            uri = "mirai://youtube/" + source.value,
                            title = metadata.title,
                            artist = "YouTube advertisement",
                            artworkUri = metadata.thumbnailUrl,
                            remote = true,
                        )
                    ),
                )
            }
            SourceType.BGM_FILE -> {
                val uri = Uri.parse(source.value)
                database.tracks().replaceSource(
                    source.id,
                    listOf(extractTrack(source, uri, 0, MediaRole.BGM)),
                )
            }
            else -> {
                val document = DocumentFile.fromTreeUri(context, Uri.parse(source.value))
                    ?: error("The selected folder is no longer available")
                indexDocumentSource(source, document)
            }
        }
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    suspend fun remove(source: SourceEntity) = withContext(Dispatchers.IO) {
        database.tracks().deleteForSource(source.id)
        database.sources().delete(source.id)
    }

    suspend fun toggleFavorite(track: TrackEntity): Boolean =
        withContext(Dispatchers.IO) { database.tracks().toggleFavorite(track) }

    suspend fun move(track: TrackEntity, delta: Int) = withContext(Dispatchers.IO) {
        val queue = database.tracks().getByRoleBlocking(MediaRole.MUSIC).sortedBy { it.queuePosition }
        val from = queue.indexOfFirst { it.mediaId == track.mediaId }
        if (from < 0) return@withContext
        val to = (from + delta).coerceIn(0, queue.lastIndex)
        if (from == to) return@withContext
        val other = queue[to]
        database.tracks().setPosition(track.mediaId, other.queuePosition)
        database.tracks().setPosition(other.mediaId, track.queuePosition)
    }

    suspend fun migrateLegacyPlaylist(playlistId: String) {
        if (playlistId.isBlank()) return
        if (database.sources().get("youtube-playlist:" + playlistId) != null) return
        runCatching { addYouTubePlaylist(playlistId) }
    }

    /**
     * Loads the jingles and ads packaged in the APK into the intro/outro/ad pools.
     *
     * Runs on every launch: [TrackDao.replaceSource] deletes before inserting, so re-seeding is
     * idempotent, picks up manifest edits, and repairs rows a user deleted by hand. No
     * [SourceEntity] is written—these are not folders the user can refresh or revoke, and keeping
     * them out of the sources list stops [refresh] from treating an asset path as a SAF tree.
     */
    suspend fun seedBundledMedia() = withContext(Dispatchers.IO) {
        runCatching {
            val manifest = context.assets.open(BundledMedia.MANIFEST_PATH)
                .use { it.readBytes().toString(Charsets.UTF_8) }
            val tracks = BundledMedia.tracks(BundledMedia.parse(manifest))
            tracks.groupBy(TrackEntity::sourceId).forEach { (sourceId, items) ->
                database.tracks().replaceSource(sourceId, items)
            }
        }
        Unit
    }

    private suspend fun indexDocumentSource(source: SourceEntity, root: DocumentFile) {
        val role = source.type.role()
        val media = collectMediaRecursively(
            root = root,
            children = { it.listFiles().toList() },
            isDirectory = { it.isDirectory },
            isPlayable = { it.isFile && it.name.orEmpty().isPlayableMedia() },
            sortKey = { it.name.orEmpty().lowercase(Locale.ROOT) },
        )
        val tracks = media.mapIndexedNotNull { index, file ->
            runCatching { extractTrack(source, file.uri, index, role) }.getOrNull()
        }
        database.tracks().replaceSource(source.id, tracks)
        database.sources().markRefreshed(source.id, System.currentTimeMillis())
    }

    private fun extractTrack(
        source: SourceEntity,
        uri: Uri,
        position: Int,
        role: MediaRole,
    ): TrackEntity {
        val retriever = MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            val name = displayName(uri)
            val title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)
                ?.takeIf(String::isNotBlank) ?: name.substringBeforeLast('.')
            val artist = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
                ?.takeIf(String::isNotBlank).orEmpty()
            val album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)
                ?.takeIf(String::isNotBlank).orEmpty()
            val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
                ?.toLongOrNull() ?: 0
            val mime = context.contentResolver.getType(uri).orEmpty()
            val artwork = cacheArtwork(uri, retriever, mime)
            TrackEntity(
                mediaId = "local:" + digest(uri.toString()),
                sourceId = source.id,
                role = role,
                uri = uri.toString(),
                title = title,
                artist = artist,
                album = album,
                durationMs = duration,
                artworkUri = artwork,
                mimeType = mime,
                queuePosition = position,
                technicalDetail = if (mime.contains("mp4")) "MP4 · local" else "Local media",
                remote = false,
            )
        } finally {
            retriever.release()
        }
    }

    private fun cacheArtwork(
        uri: Uri,
        retriever: MediaMetadataRetriever,
        mime: String,
    ): String {
        val key = "artwork:" + uri
        cache.get(key)?.let { return Uri.fromFile(it).toString() }
        val embedded = retriever.embeddedPicture
        val bitmap = when {
            embedded != null -> BitmapFactory.decodeByteArray(embedded, 0, embedded.size)
            mime.contains("mp4", true) || displayName(uri).endsWith(".mp4", true) ->
                retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
            else -> null
        } ?: return ""
        val output = ByteArrayOutputStream()
        output.use {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 88, output)
        }
        bitmap.recycle()
        val target = cache.put(key, "image/jpeg", output.toByteArray())
        return Uri.fromFile(target).toString()
    }

    private fun displayName(uri: Uri): String {
        context.contentResolver.query(
            uri,
            arrayOf(OpenableColumns.DISPLAY_NAME),
            null,
            null,
            null,
        )?.use { cursor ->
            if (cursor.moveToFirst()) return cursor.getString(0)
        }
        return uri.lastPathSegment ?: "Selected media"
    }

    private fun SourceType.role(): MediaRole = when (this) {
        SourceType.MUSIC_FOLDER -> MediaRole.MUSIC
        SourceType.INTRO_JINGLE_FOLDER -> MediaRole.INTRO
        SourceType.OUTRO_JINGLE_FOLDER -> MediaRole.OUTRO
        SourceType.AD_FOLDER -> MediaRole.AD
        SourceType.BGM_FILE, SourceType.BGM_FOLDER -> MediaRole.BGM
        SourceType.RADIO_JP, SourceType.RADIO_CN, SourceType.RADIO_KR -> MediaRole.RADIO
        SourceType.YOUTUBE_PLAYLIST -> MediaRole.MUSIC
        SourceType.YOUTUBE_AD -> MediaRole.AD
    }

    private fun SourceType.displayName(): String = name.lowercase()
        .split('_').joinToString(" ") { it.replaceFirstChar(Char::uppercase) }

    private fun String.isPlayableMedia(): Boolean =
        lowercase(Locale.ROOT).substringAfterLast('.', "") in
            setOf("mp3", "mp4", "m4a", "wav", "ogg", "opus", "flac", "aac")

    private fun sourceId(type: SourceType, value: String) =
        type.name.lowercase() + ":" + digest(value)

    private fun digest(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
            .take(24)

    companion object {
        fun parseYouTubeVideoId(raw: String): String? {
            val value = raw.trim()
            if (value.matches(Regex("[A-Za-z0-9_-]{11}"))) return value
            return runCatching {
                val uri = Uri.parse(value)
                when {
                    uri.host.equals("youtu.be", true) -> uri.pathSegments.firstOrNull()
                    uri.host?.contains("youtube.com", true) == true ->
                        uri.getQueryParameter("v") ?: uri.pathSegments
                            .dropWhile { it != "shorts" && it != "embed" }
                            .drop(1).firstOrNull()
                    else -> null
                }?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{11}")) }
            }.getOrNull()
        }
    }
}
