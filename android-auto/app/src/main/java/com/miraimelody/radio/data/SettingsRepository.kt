package com.miraimelody.radio.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.miraimelody.radio.BuildConfig
import java.net.URI
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

private val Context.radioDataStore by preferencesDataStore(name = "native-radio-settings")

enum class BroadcastMode { FULL_SHOW, CLASSIC, MUSIC_ONLY }
enum class QueueMode { RANDOM, ORDERED }
enum class AudioQuality { HIGH, BALANCED, DATA_SAVER }
enum class AnnouncerLanguage { JAPANESE, ENGLISH }

data class RadioSettings(
    val backendUrl: String = "",
    val broadcastMode: BroadcastMode = BroadcastMode.FULL_SHOW,
    val queueMode: QueueMode = QueueMode.RANDOM,
    val quality: AudioQuality = AudioQuality.HIGH,
    val language: AnnouncerLanguage = AnnouncerLanguage.JAPANESE,
    val introInterval: Int = 1,
    val outroInterval: Int = 1,
    val discussionInterval: Int = 1,
    val weatherInterval: Int = 3,
    val trafficInterval: Int = 3,
    val newsInterval: Int = 3,
    val adInterval: Int = 2,
    val sponsorInterval: Int = 2,
    val bgmVolume: Float = 0.10f,
    val bgmFadeInMs: Long = 1_200,
    val bgmLeadInMs: Long = 600,
    val bgmTailMs: Long = 800,
    val bgmFadeOutMs: Long = 1_200,
    val cacheLimitBytes: Long = 250L * 1024L * 1024L,
    val legacyPlaylistId: String = "",
)

class SettingsRepository(private val context: Context) {
    private object Keys {
        val backendUrl = stringPreferencesKey("backend-url")
        val broadcastMode = stringPreferencesKey("car-playback-mode")
        val queueMode = stringPreferencesKey("queue-mode")
        val quality = stringPreferencesKey("quality")
        val language = stringPreferencesKey("announcer-language")
        val introInterval = intPreferencesKey("classic-intro-interval")
        val outroInterval = intPreferencesKey("classic-outro-interval")
        val discussionInterval = intPreferencesKey("classic-discussion-interval")
        val weatherInterval = intPreferencesKey("classic-weather-interval")
        val trafficInterval = intPreferencesKey("classic-traffic-interval")
        val newsInterval = intPreferencesKey("classic-news-interval")
        val adInterval = intPreferencesKey("classic-ad-interval")
        val sponsorInterval = intPreferencesKey("classic-sponsor-interval")
        val bgmVolume = floatPreferencesKey("bgm-volume")
        val bgmFadeInMs = longPreferencesKey("bgm-fade-in")
        val bgmLeadInMs = longPreferencesKey("bgm-lead-in")
        val bgmTailMs = longPreferencesKey("bgm-tail")
        val bgmFadeOutMs = longPreferencesKey("bgm-fade-out")
        val cacheLimit = longPreferencesKey("cache-limit")
        val playlistId = stringPreferencesKey("playlist-id")
        val migrated = booleanPreferencesKey("native-migration-v1")
    }

    val settings: Flow<RadioSettings> = context.radioDataStore.data.map(::decode)

    init {
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { migrateLegacyPreferences() }
    }

    fun current(): RadioSettings = runBlocking(Dispatchers.IO) { settings.first() }

    suspend fun updateBackendUrl(value: String) {
        context.radioDataStore.edit { it[Keys.backendUrl] = normalizeBackendUrl(value, BuildConfig.DEBUG) }
    }

    suspend fun updateBroadcastMode(value: BroadcastMode) = set(Keys.broadcastMode, value.name)
    suspend fun updateQueueMode(value: QueueMode) = set(Keys.queueMode, value.name)
    suspend fun updateQuality(value: AudioQuality) = set(Keys.quality, value.name)
    suspend fun updateLanguage(value: AnnouncerLanguage) = set(Keys.language, value.name)
    suspend fun updateBgmVolume(value: Float) {
        context.radioDataStore.edit { it[Keys.bgmVolume] = value.coerceIn(0f, 0.5f) }
    }

    suspend fun updateClassicIntervals(
        intro: Int,
        outro: Int,
        discussion: Int,
        weather: Int,
        traffic: Int,
        news: Int,
        ad: Int,
        sponsor: Int,
    ) {
        context.radioDataStore.edit {
            it[Keys.introInterval] = interval(intro)
            it[Keys.outroInterval] = interval(outro)
            it[Keys.discussionInterval] = interval(discussion)
            it[Keys.weatherInterval] = interval(weather)
            it[Keys.trafficInterval] = interval(traffic)
            it[Keys.newsInterval] = interval(news)
            it[Keys.adInterval] = interval(ad)
            it[Keys.sponsorInterval] = interval(sponsor)
        }
    }

    private suspend fun set(key: Preferences.Key<String>, value: String) {
        context.radioDataStore.edit { it[key] = value }
    }

    private fun decode(values: Preferences): RadioSettings = RadioSettings(
        backendUrl = normalizeBackendUrl(
            values[Keys.backendUrl] ?: BuildConfig.DEFAULT_BACKEND_URL,
            BuildConfig.DEBUG,
        ),
        broadcastMode = enumValue(values[Keys.broadcastMode], BroadcastMode.FULL_SHOW),
        queueMode = enumValue(values[Keys.queueMode], QueueMode.RANDOM),
        quality = enumValue(values[Keys.quality], AudioQuality.HIGH),
        language = enumValue(values[Keys.language], AnnouncerLanguage.JAPANESE),
        introInterval = interval(values[Keys.introInterval] ?: 1),
        outroInterval = interval(values[Keys.outroInterval] ?: 1),
        discussionInterval = interval(values[Keys.discussionInterval] ?: 1),
        weatherInterval = interval(values[Keys.weatherInterval] ?: 3),
        trafficInterval = interval(values[Keys.trafficInterval] ?: 3),
        newsInterval = interval(values[Keys.newsInterval] ?: 3),
        adInterval = interval(values[Keys.adInterval] ?: 2),
        sponsorInterval = interval(values[Keys.sponsorInterval] ?: 2),
        bgmVolume = (values[Keys.bgmVolume] ?: 0.10f).coerceIn(0f, 0.5f),
        bgmFadeInMs = values[Keys.bgmFadeInMs] ?: 1_200,
        bgmLeadInMs = values[Keys.bgmLeadInMs] ?: 600,
        bgmTailMs = values[Keys.bgmTailMs] ?: 800,
        bgmFadeOutMs = values[Keys.bgmFadeOutMs] ?: 1_200,
        cacheLimitBytes = values[Keys.cacheLimit] ?: 250L * 1024L * 1024L,
        legacyPlaylistId = values[Keys.playlistId] ?: "",
    )

    private suspend fun migrateLegacyPreferences() {
        val legacy = context.getSharedPreferences("mirai-auto-settings", Context.MODE_PRIVATE)
        context.radioDataStore.edit { values ->
            if (values[Keys.migrated] == true) return@edit
            if (!values.contains(Keys.quality)) {
                values[Keys.quality] = when (legacy.getString("quality", "high")) {
                    "balanced" -> AudioQuality.BALANCED.name
                    "dataSaver" -> AudioQuality.DATA_SAVER.name
                    else -> AudioQuality.HIGH.name
                }
            }
            if (!values.contains(Keys.broadcastMode)) {
                values[Keys.broadcastMode] =
                    if (legacy.getString("car-playback-mode", "fullShow") == "musicOnly") {
                        BroadcastMode.MUSIC_ONLY.name
                    } else {
                        BroadcastMode.FULL_SHOW.name
                    }
            }
            if (!values.contains(Keys.language)) {
                values[Keys.language] =
                    if (legacy.getString("announcer-language", "ja") == "en") {
                        AnnouncerLanguage.ENGLISH.name
                    } else {
                        AnnouncerLanguage.JAPANESE.name
                    }
            }
            val playlist = legacy.getString("playlist-id", BuildConfig.DEFAULT_PLAYLIST_ID)
                ?.trim().orEmpty()
            if (playlist.matches(Regex("[A-Za-z0-9_-]{13,100}"))) {
                values[Keys.playlistId] = playlist
            }
            values[Keys.migrated] = true
        }
    }

    companion object {
        private fun interval(value: Int) = value.coerceIn(1, 99)

        private inline fun <reified T : Enum<T>> enumValue(raw: String?, default: T): T =
            enumValues<T>().firstOrNull { it.name == raw } ?: default

        fun normalizeBackendUrl(raw: String?, allowHttp: Boolean): String {
            val candidate = raw?.trim().orEmpty()
            if (candidate.isEmpty()) return ""
            return try {
                val uri = URI(candidate)
                val acceptedScheme = uri.scheme.equals("https", true) ||
                    (allowHttp && uri.scheme.equals("http", true))
                if (!acceptedScheme || uri.host.isNullOrBlank() || uri.userInfo != null ||
                    uri.query != null || uri.fragment != null
                ) {
                    ""
                } else {
                    uri.normalize().toString().trimEnd('/')
                }
            } catch (_: Exception) {
                ""
            }
        }
    }
}
