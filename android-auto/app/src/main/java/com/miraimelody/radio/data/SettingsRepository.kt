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
    val hostEnabled: Boolean = true,
    val chatterEnabled: Boolean = true,
    val separateSongDiscussions: Boolean = false,
    val researchedChatter: Boolean = true,
    val newsFocus: String = "",
    val adsEnabled: Boolean = false,
    val morningPreroll: Boolean = true,
    val noonPreroll: Boolean = true,
    val djMemoryEnabled: Boolean = true,
    val listenerInteractionEnabled: Boolean = true,
    val audioNormalization: Boolean = true,
    val broadcastMode: BroadcastMode = BroadcastMode.FULL_SHOW,
    val queueMode: QueueMode = QueueMode.RANDOM,
    val quality: AudioQuality = AudioQuality.HIGH,
    val language: AnnouncerLanguage = AnnouncerLanguage.JAPANESE,
    val frequency: Int = 1,
    val newsEvery: Int = 0,
    val trafficEvery: Int = 10,
    val jingleEvery: Int = 2,
    val adEvery: Int = 1,
    val bgmVolume: Float = 0.10f,
    val speechGain: Float = 1.4f,
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
        val hostEnabled = booleanPreferencesKey("host-enabled")
        val chatterEnabled = booleanPreferencesKey("chatter-enabled")
        val separateSongDiscussions = booleanPreferencesKey("separate-song-discussions")
        val researchedChatter = booleanPreferencesKey("researched-chatter")
        val newsFocus = stringPreferencesKey("news-focus")
        val adsEnabled = booleanPreferencesKey("ads-enabled")
        val morningPreroll = booleanPreferencesKey("morning-preroll")
        val noonPreroll = booleanPreferencesKey("noon-preroll")
        val djMemoryEnabled = booleanPreferencesKey("dj-memory-enabled")
        val listenerInteractionEnabled = booleanPreferencesKey("listener-interaction-enabled")
        val audioNormalization = booleanPreferencesKey("audio-normalization")
        val broadcastMode = stringPreferencesKey("car-playback-mode")
        val queueMode = stringPreferencesKey("queue-mode")
        val quality = stringPreferencesKey("quality")
        val language = stringPreferencesKey("announcer-language")
        val frequency = intPreferencesKey("host-frequency")
        val newsEvery = intPreferencesKey("news-every")
        val trafficEvery = intPreferencesKey("traffic-every")
        val jingleEvery = intPreferencesKey("jingle-every")
        val adEvery = intPreferencesKey("ad-every")
        val bgmVolume = floatPreferencesKey("bgm-volume")
        val speechGain = floatPreferencesKey("speech-gain")
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

    suspend fun updateHostEnabled(value: Boolean) = set(Keys.hostEnabled, value)
    suspend fun updateChatterEnabled(value: Boolean) = set(Keys.chatterEnabled, value)
    suspend fun updateSeparateSongDiscussions(value: Boolean) =
        set(Keys.separateSongDiscussions, value)
    suspend fun updateResearchedChatter(value: Boolean) = set(Keys.researchedChatter, value)
    suspend fun updateNewsFocus(value: String) = set(Keys.newsFocus, value.trim().take(160))
    suspend fun updateAdsEnabled(value: Boolean) = set(Keys.adsEnabled, value)
    suspend fun updateMorningPreroll(value: Boolean) = set(Keys.morningPreroll, value)
    suspend fun updateNoonPreroll(value: Boolean) = set(Keys.noonPreroll, value)
    suspend fun updateDjMemoryEnabled(value: Boolean) = set(Keys.djMemoryEnabled, value)
    suspend fun updateListenerInteractionEnabled(value: Boolean) =
        set(Keys.listenerInteractionEnabled, value)
    suspend fun updateAudioNormalization(value: Boolean) = set(Keys.audioNormalization, value)

    suspend fun updateBroadcastMode(value: BroadcastMode) = set(Keys.broadcastMode, value.name)
    suspend fun updateQueueMode(value: QueueMode) = set(Keys.queueMode, value.name)
    suspend fun updateQuality(value: AudioQuality) = set(Keys.quality, value.name)
    suspend fun updateLanguage(value: AnnouncerLanguage) = set(Keys.language, value.name)
    suspend fun updateBgmVolume(value: Float) {
        context.radioDataStore.edit { it[Keys.bgmVolume] = value.coerceIn(0f, 0.5f) }
    }

    suspend fun updateSpeechGain(value: Float) {
        context.radioDataStore.edit { it[Keys.speechGain] = value.coerceIn(1f, 2f) }
    }

    suspend fun updateClassicIntervals(
        frequency: Int,
        newsEvery: Int,
        trafficEvery: Int,
        jingleEvery: Int,
        adEvery: Int,
    ) {
        context.radioDataStore.edit {
            it[Keys.frequency] = frequency.coerceIn(1, 5)
            it[Keys.newsEvery] = interval(newsEvery)
            it[Keys.trafficEvery] = interval(trafficEvery)
            it[Keys.jingleEvery] = interval(jingleEvery)
            it[Keys.adEvery] = adEvery.coerceIn(1, 20)
        }
    }

    private suspend fun set(key: Preferences.Key<String>, value: String) {
        context.radioDataStore.edit { it[key] = value }
    }
    private suspend fun set(key: Preferences.Key<Boolean>, value: Boolean) {
        context.radioDataStore.edit { it[key] = value }
    }

    private fun decode(values: Preferences): RadioSettings = RadioSettings(
        backendUrl = normalizeBackendUrl(
            values[Keys.backendUrl] ?: BuildConfig.DEFAULT_BACKEND_URL,
            BuildConfig.DEBUG,
        ),
        hostEnabled = values[Keys.hostEnabled] ?: true,
        chatterEnabled = values[Keys.chatterEnabled] ?: true,
        separateSongDiscussions = values[Keys.separateSongDiscussions] ?: false,
        researchedChatter = values[Keys.researchedChatter] ?: true,
        newsFocus = (values[Keys.newsFocus] ?: "").trim().take(160),
        adsEnabled = values[Keys.adsEnabled] ?: false,
        morningPreroll = values[Keys.morningPreroll] ?: true,
        noonPreroll = values[Keys.noonPreroll] ?: true,
        djMemoryEnabled = values[Keys.djMemoryEnabled] ?: true,
        listenerInteractionEnabled = values[Keys.listenerInteractionEnabled] ?: true,
        audioNormalization = values[Keys.audioNormalization] ?: true,
        broadcastMode = enumValue(values[Keys.broadcastMode], BroadcastMode.FULL_SHOW),
        queueMode = enumValue(values[Keys.queueMode], QueueMode.RANDOM),
        quality = enumValue(values[Keys.quality], AudioQuality.HIGH),
        language = enumValue(values[Keys.language], AnnouncerLanguage.JAPANESE),
        frequency = (values[Keys.frequency] ?: 1).coerceIn(1, 5),
        newsEvery = interval(values[Keys.newsEvery] ?: 0),
        trafficEvery = interval(values[Keys.trafficEvery] ?: 10),
        jingleEvery = interval(values[Keys.jingleEvery] ?: 2),
        adEvery = (values[Keys.adEvery] ?: 1).coerceIn(1, 20),
        bgmVolume = (values[Keys.bgmVolume] ?: 0.10f).coerceIn(0f, 0.5f),
        speechGain = (values[Keys.speechGain] ?: 1.4f).coerceIn(1f, 2f),
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
        private fun interval(value: Int) = value.coerceIn(0, 99)

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
