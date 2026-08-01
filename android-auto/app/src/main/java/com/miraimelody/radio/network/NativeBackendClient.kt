package com.miraimelody.radio.network

import android.net.Uri
import com.miraimelody.radio.data.AudioQuality
import com.miraimelody.radio.data.MediaRole
import com.miraimelody.radio.data.SettingsRepository
import com.miraimelody.radio.data.TrackEntity
import com.miraimelody.radio.security.CredentialStore
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference
import org.json.JSONArray
import org.json.JSONObject

data class BackendSession(val baseUrl: String, val token: String, val expiresAt: Long)
data class ResolvedBackendStream(val url: String, val bearerToken: String)
data class YouTubeVideo(val videoId: String, val title: String, val thumbnailUrl: String)

class EnrollmentException(message: String) : IOException(message)

class NativeBackendClient(
    private val settings: SettingsRepository,
    private val credentials: CredentialStore,
) {
    private val sessionState = AtomicReference<BackendSession?>()

    suspend fun enroll(backendUrl: String, credential: String): BackendSession {
        val normalized = SettingsRepository.normalizeBackendUrl(
            backendUrl,
            com.miraimelody.radio.BuildConfig.DEBUG,
        )
        if (normalized.isEmpty()) throw EnrollmentException("Enter a valid backend URL")
        val response = request(
            method = "POST",
            endpoint = normalized + "/v1/mobile/session",
            authorization = "Device " + credential.trim(),
        )
        if (response.status == 401) throw EnrollmentException("Device credential is invalid or revoked")
        if (response.status != 200) throw EnrollmentException("Backend enrollment returned " + response.status)
        val session = parseSession(response.bodyText())
        settings.updateBackendUrl(normalized)
        credentials.save(credential.trim())
        sessionState.set(session)
        return session
    }

    fun clearSession() {
        sessionState.set(null)
    }

    fun revokeLocalCredential() {
        clearSession()
        credentials.clear()
    }

    @Synchronized
    fun session(forceRefresh: Boolean = false): BackendSession {
        val now = System.currentTimeMillis()
        val cached = sessionState.get()
        if (!forceRefresh && cached != null && !SessionPolicy.shouldRefresh(cached.expiresAt, now)) {
            return cached
        }
        val currentSettings = settings.current()
        val backendUrl = currentSettings.backendUrl
        val credential = credentials.load()
            ?: throw EnrollmentException("This device has not been enrolled")
        if (backendUrl.isEmpty()) throw EnrollmentException("Configure the radio backend")
        val response = request(
            method = "POST",
            endpoint = backendUrl + "/v1/mobile/session",
            authorization = "Device " + credential,
        )
        if (response.status == 401) {
            sessionState.set(null)
            throw EnrollmentException("Device credential is invalid or revoked")
        }
        if (response.status != 200) throw IOException("Session refresh returned " + response.status)
        return parseSession(response.bodyText()).also(sessionState::set)
    }

    fun loadYouTubePlaylist(playlistId: String): List<TrackEntity> {
        val response = authorizedGet("/v1/youtube/playlists/" + Uri.encode(playlistId))
        if (response.status != 200) throw IOException("Playlist returned " + response.status)
        val quality = settings.current().quality.detail()
        val payload = JSONArray(response.bodyText())
        return buildList {
            for (index in 0 until payload.length()) {
                val item = payload.optJSONObject(index) ?: continue
                val id = item.optString("id").removePrefix("youtube:")
                if (id.length != 11) continue
                add(
                    TrackEntity(
                        mediaId = "youtube:" + id,
                        sourceId = "youtube-playlist:" + playlistId,
                        role = MediaRole.MUSIC,
                        uri = "mirai://youtube/" + id,
                        title = item.optString("title", "Unknown title"),
                        artist = item.optString("artist", "Unknown artist"),
                        artworkUri = item.optString("thumbnail"),
                        queuePosition = index,
                        technicalDetail = quality,
                        remote = true,
                    )
                )
            }
        }
    }

    fun loadStations(country: String): List<TrackEntity> {
        val quality = settings.current().quality
        val response = authorizedGet(
            "/v1/radio/stations?country=" + Uri.encode(country) +
                "&quality=" + quality.apiValue(),
        )
        if (response.status != 200) throw IOException("Station directory returned " + response.status)
        val payload = JSONArray(response.bodyText())
        return buildList {
            for (index in 0 until payload.length()) {
                val item = payload.optJSONObject(index) ?: continue
                val id = item.optString("id")
                val stream = item.optString("streamUrl")
                if (id.isBlank() || !stream.startsWith("https://")) continue
                val codec = item.optString("codec")
                val bitrate = item.optInt("bitrate", 0)
                val detail = listOfNotNull(
                    codec.takeIf(String::isNotBlank),
                    bitrate.takeIf { it > 0 }?.let { it.toString() + " kbps" },
                ).joinToString(" · ")
                add(
                    TrackEntity(
                        mediaId = "radio:" + id,
                        sourceId = "radio:" + country,
                        role = MediaRole.RADIO,
                        uri = stream,
                        title = item.optString("name", "Live radio"),
                        artist = listOf(item.optString("state"), country)
                            .firstOrNull { it.isNotBlank() }.orEmpty(),
                        artworkUri = item.optString("favicon"),
                        queuePosition = index,
                        technicalDetail = detail,
                        remote = true,
                    )
                )
            }
        }
    }

    fun validateYouTubeVideo(videoId: String): YouTubeVideo {
        val response = authorizedGet("/v1/youtube/videos/" + Uri.encode(videoId))
        if (response.status != 200) throw IOException("YouTube validation returned " + response.status)
        val item = JSONObject(response.bodyText())
        return YouTubeVideo(
            videoId = item.getString("videoId"),
            title = item.getString("title"),
            thumbnailUrl = item.optString("thumbnailUrl"),
        )
    }

    fun authenticatedStream(path: String): ResolvedBackendStream {
        val session = session()
        return ResolvedBackendStream(session.baseUrl + path, session.token)
    }

    fun fetchHostSegment(payload: String): AudioResponse {
        fun perform(activeSession: BackendSession): HttpResponse = request(
            method = "POST",
            endpoint = activeSession.baseUrl + "/v1/host/segments",
            authorization = "Bearer " + activeSession.token,
            contentType = "application/json; charset=utf-8",
            body = payload.toByteArray(StandardCharsets.UTF_8),
            readTimeoutMs = 60_000,
        )
        var response = perform(session())
        if (response.status == 401) response = perform(session(forceRefresh = true))
        if (response.status == 204) return AudioResponse(response.status, null, ByteArray(0))
        if (response.status != 200) throw IOException("Host segment returned " + response.status)
        return AudioResponse(response.status, response.contentType, response.body)
    }

    private fun authorizedGet(path: String): HttpResponse {
        fun perform(activeSession: BackendSession) = request(
            method = "GET",
            endpoint = activeSession.baseUrl + path,
            authorization = "Bearer " + activeSession.token,
        )
        var response = perform(session())
        if (response.status == 401) response = perform(session(forceRefresh = true))
        return response
    }

    private fun parseSession(body: String): BackendSession {
        val payload = JSONObject(body)
        val baseUrl = SettingsRepository.normalizeBackendUrl(
            payload.getString("baseUrl"),
            com.miraimelody.radio.BuildConfig.DEBUG,
        )
        val token = payload.getString("token")
        val expiresAt = payload.getLong("expiresAt")
        if (baseUrl.isEmpty() || token.isBlank() || expiresAt <= System.currentTimeMillis()) {
            throw IOException("Backend returned an invalid session")
        }
        return BackendSession(baseUrl, token, expiresAt)
    }

    private fun request(
        method: String,
        endpoint: String,
        authorization: String? = null,
        contentType: String? = null,
        body: ByteArray? = null,
        readTimeoutMs: Int = 20_000,
    ): HttpResponse {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        connection.connectTimeout = 10_000
        connection.readTimeout = readTimeoutMs
        connection.requestMethod = method
        connection.setRequestProperty("Accept", "application/json, audio/*")
        connection.setRequestProperty("User-Agent", "mirAI-melody-Android/0.3.0")
        if (authorization != null) connection.setRequestProperty("Authorization", authorization)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", contentType ?: "application/json")
            connection.setFixedLengthStreamingMode(body.size)
            connection.outputStream.use { it.write(body) }
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..399) connection.inputStream else connection.errorStream
            val bytes = stream?.use { input ->
                ByteArrayOutputStream().use { output ->
                    input.copyTo(output)
                    output.toByteArray()
                }
            } ?: ByteArray(0)
            HttpResponse(status, connection.contentType, bytes)
        } finally {
            connection.disconnect()
        }
    }

    private fun AudioQuality.apiValue(): String = when (this) {
        AudioQuality.HIGH -> "high"
        AudioQuality.BALANCED -> "balanced"
        AudioQuality.DATA_SAVER -> "dataSaver"
    }

    private fun AudioQuality.detail(): String = when (this) {
        AudioQuality.HIGH -> "Best available · Opus/AAC source bitrate"
        AudioQuality.BALANCED -> "Balanced · approximately 160 kbps Opus/AAC"
        AudioQuality.DATA_SAVER -> "Data Saver · approximately 96 kbps Opus/AAC"
    }

    data class AudioResponse(val status: Int, val contentType: String?, val bytes: ByteArray)
    private data class HttpResponse(val status: Int, val contentType: String?, val body: ByteArray) {
        fun bodyText(): String = String(body, StandardCharsets.UTF_8)
    }

}
