package com.miraimelody.radio.playback

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import com.miraimelody.radio.MiraiApplication
import com.miraimelody.radio.data.AudioQuality
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.Base64

class PlaybackResolver(private val app: MiraiApplication) {
    @OptIn(UnstableApi::class)
    fun resolve(dataSpec: DataSpec): DataSpec {
        val uri = dataSpec.uri
        if (uri.scheme != "mirai") return dataSpec
        return when (uri.host) {
            "youtube" -> resolveYouTube(dataSpec, uri)
            "segment" -> dataSpec.withUri(Uri.fromFile(resolveSegment(uri)))
            else -> dataSpec.withUri(Uri.fromFile(app.cache.transitionFile()))
        }
    }

    fun prefetch(item: MediaItem) {
        val uri = item.localConfiguration?.uri ?: return
        if (uri.scheme == "mirai" && uri.host == "segment") runCatching { resolveSegment(uri) }
    }

    @OptIn(UnstableApi::class)
    private fun resolveYouTube(dataSpec: DataSpec, uri: Uri): DataSpec {
        val videoId = uri.pathSegments.firstOrNull()
            ?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{11}")) }
            ?: throw IOException("Invalid YouTube video")
        val quality = when (app.settings.current().quality) {
            AudioQuality.HIGH -> "high"
            AudioQuality.BALANCED -> "balanced"
            AudioQuality.DATA_SAVER -> "dataSaver"
        }
        val stream = app.backend.authenticatedStream(
            "/v1/youtube/audio/" + videoId + "?quality=" + quality,
        )
        val authenticated = Uri.parse(stream.url).buildUpon()
            .appendQueryParameter("token", stream.bearerToken)
            .build()
        return dataSpec.withUri(authenticated)
    }

    private fun resolveSegment(uri: Uri): File {
        val encoded = uri.pathSegments.firstOrNull()
            ?: return app.cache.transitionFile()
        val kind = uri.getQueryParameter("kind")?.take(24).orEmpty()
        val key = uri.getQueryParameter("key")?.take(240)
            ?: kind + ":" + encoded.take(64)
        app.cache.get(key)?.let { return it }
        val payload = try {
            String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8)
        } catch (_: IllegalArgumentException) {
            return app.cache.transitionFile()
        }
        return try {
            val response = app.backend.fetchHostSegment(payload)
            if (response.status == 204 || response.bytes.isEmpty()) {
                app.cache.transitionFile()
            } else {
                app.cache.put(key, response.contentType, response.bytes)
            }
        } catch (_: Exception) {
            stale(kind) ?: app.cache.transitionFile()
        }
    }

    private fun stale(kind: String): File? = when (kind) {
        "weather" -> app.cache.latest(kind, 6L * 60L * 60L * 1000L)
        "traffic" -> app.cache.latest(kind, 2L * 60L * 60L * 1000L)
        "news" -> app.cache.latest(kind, 2L * 60L * 60L * 1000L)
        else -> null
    }
}
