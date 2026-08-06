package com.miraimelody.radio.ui

import android.app.Application
import android.content.ComponentName
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.miraimelody.radio.MiraiApplication
import com.miraimelody.radio.MiraiMediaService
import com.miraimelody.radio.data.AnnouncerLanguage
import com.miraimelody.radio.data.AudioQuality
import com.miraimelody.radio.data.BroadcastMode
import com.miraimelody.radio.data.QueueMode
import com.miraimelody.radio.data.RadioSettings
import com.miraimelody.radio.data.SourceEntity
import com.miraimelody.radio.data.SourceType
import com.miraimelody.radio.data.TrackEntity
import com.miraimelody.radio.playback.PlaybackStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class NowPlayingState(
    val title: String = "Nothing playing",
    val artist: String = "Choose a track from Local Queue",
    val artworkUri: String = "",
    val detail: String = "",
    val playing: Boolean = false,
    val canNext: Boolean = false,
    val canPrevious: Boolean = false,
)

class RadioViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as MiraiApplication
    val settings: StateFlow<RadioSettings> = app.settings.settings.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        app.settings.current(),
    )
    val sources: StateFlow<List<SourceEntity>> = app.sources.sources.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList(),
    )
    val music: StateFlow<List<TrackEntity>> = app.sources.music.stateIn(
        viewModelScope,
        SharingStarted.WhileSubscribed(5_000),
        emptyList(),
    )
    val playbackStatus = PlaybackStatus.state

    private val mutableNowPlaying = MutableStateFlow(NowPlayingState())
    val nowPlaying: StateFlow<NowPlayingState> = mutableNowPlaying.asStateFlow()
    private val mutableMessage = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = mutableMessage.asStateFlow()
    private val mutableEnrolled = MutableStateFlow(app.credentials.hasCredential())
    val enrolled: StateFlow<Boolean> = mutableEnrolled.asStateFlow()
    private val mutableCacheBytes = MutableStateFlow(app.cache.usageBytes())
    val cacheBytes: StateFlow<Long> = mutableCacheBytes.asStateFlow()

    private val controllerFuture: ListenableFuture<MediaController>
    private var controller: MediaController? = null
    private val playerListener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            updateNowPlaying(player)
        }
    }

    init {
        val token = SessionToken(application, ComponentName(application, MiraiMediaService::class.java))
        controllerFuture = MediaController.Builder(application, token).buildAsync()
        controllerFuture.addListener(
            {
                runCatching { controllerFuture.get() }.onSuccess {
                    controller = it
                    it.addListener(playerListener)
                    updateNowPlaying(it)
                }.onFailure { error ->
                    mutableMessage.value = error.message ?: "Playback service is unavailable"
                }
            },
            application.mainExecutor,
        )
    }

    fun play(track: TrackEntity) {
        val player = controller ?: return message("Playback is still connecting")
        player.setMediaItem(MediaItem.Builder().setMediaId(track.mediaId).build())
        player.prepare()
        player.play()
    }

    fun playPause() {
        controller?.let { if (it.isPlaying) it.pause() else it.play() }
    }

    fun next() {
        controller?.seekToNextMediaItem()
    }

    fun previous() {
        controller?.seekToPreviousMediaItem()
    }

    fun addFolder(type: SourceType, uri: Uri) = task("Source added") {
        app.sources.addFolder(type, uri)
    }

    fun addBgmFile(uri: Uri) = task("BGM file added") {
        app.sources.addBgmFile(uri)
    }

    fun addYouTubePlaylist(value: String) = task("YouTube playlist added") {
        app.sources.addYouTubePlaylist(value)
    }

    fun addYouTubeAd(value: String) = task("YouTube advertisement added") {
        app.sources.addYouTubeAd(value)
    }

    fun addRadio(type: SourceType) = task("Live radio source added") {
        app.sources.addRadioCountry(type)
    }

    fun refresh(source: SourceEntity) = task("Source refreshed") {
        app.sources.refresh(source)
    }

    fun remove(source: SourceEntity) = task("Source removed") {
        app.sources.remove(source)
    }

    fun toggleFavorite(track: TrackEntity) = task(null) {
        val enabled = app.sources.toggleFavorite(track)
        if (!enabled && track.favoriteRank == 0) {
            withContext(Dispatchers.Main) {
                mutableMessage.value = "Only ten favorites can be active"
            }
        }
    }

    fun move(track: TrackEntity, delta: Int) = task(null) {
        app.sources.move(track, delta)
    }

    fun enroll(backendUrl: String, credential: String) = task("Device enrolled") {
        require(credential.trim().length >= 16) { "Enter the device enrollment credential" }
        app.backend.enroll(backendUrl, credential)
        app.sources.migrateLegacyPlaylist(app.settings.current().legacyPlaylistId)
        mutableEnrolled.value = true
    }

    fun revokeLocalCredential() {
        app.backend.revokeLocalCredential()
        mutableEnrolled.value = false
        message("Enrollment removed from this phone")
    }

    fun clearCache() {
        app.cache.clear()
        mutableCacheBytes.value = app.cache.usageBytes()
        message("Generated audio and artwork cache cleared")
    }

    fun updateBroadcastMode(value: BroadcastMode) = task(null) {
        app.settings.updateBroadcastMode(value)
    }

    fun updateQueueMode(value: QueueMode) = task(null) {
        app.settings.updateQueueMode(value)
    }

    fun updateQuality(value: AudioQuality) = task(null) {
        app.settings.updateQuality(value)
    }

    fun updateLanguage(value: AnnouncerLanguage) = task(null) {
        app.settings.updateLanguage(value)
    }

    fun updateBgmVolume(value: Float) = task(null) {
        app.settings.updateBgmVolume(value)
    }

    fun updateClassicIntervals(values: List<Int>) = task("Classic schedule saved") {
        require(values.size == 8)
        app.settings.updateClassicIntervals(
            intro = values[0],
            outro = values[1],
            discussion = values[2],
            weather = values[3],
            traffic = values[4],
            news = values[5],
            ad = values[6],
            sponsor = values[7],
        )
    }

    fun dismissMessage() {
        mutableMessage.value = null
    }

    private fun updateNowPlaying(player: Player) {
        val metadata = player.currentMediaItem?.mediaMetadata
        mutableNowPlaying.value = NowPlayingState(
            title = metadata?.title?.toString() ?: "Nothing playing",
            artist = metadata?.artist?.toString() ?: "Choose a track from Local Queue",
            artworkUri = metadata?.artworkUri?.toString().orEmpty(),
            detail = metadata?.description?.toString().orEmpty(),
            playing = player.isPlaying,
            canNext = player.hasNextMediaItem(),
            canPrevious = player.hasPreviousMediaItem(),
        )
    }

    private fun task(success: String?, block: suspend () -> Unit) {
        viewModelScope.launch(Dispatchers.IO) {
            runCatching { block() }
                .onSuccess {
                    if (success != null) withContext(Dispatchers.Main) { mutableMessage.value = success }
                }
                .onFailure { error ->
                    withContext(Dispatchers.Main) {
                        mutableMessage.value = error.message ?: "Operation failed"
                    }
                }
        }
    }

    private fun message(value: String) {
        mutableMessage.value = value
    }

    override fun onCleared() {
        controller?.removeListener(playerListener)
        MediaController.releaseFuture(controllerFuture)
        super.onCleared()
    }
}
