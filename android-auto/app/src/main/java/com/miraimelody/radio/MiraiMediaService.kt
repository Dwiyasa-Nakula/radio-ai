package com.miraimelody.radio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import com.miraimelody.radio.data.MediaRole
import com.miraimelody.radio.network.EnrollmentException
import com.miraimelody.radio.playback.MusicNormalizationProcessor
import com.miraimelody.radio.playback.NativeMediaCatalog
import com.miraimelody.radio.playback.PlaybackResolver
import com.miraimelody.radio.playback.PlaybackStatus
import com.miraimelody.radio.playback.SpeechBgmSource
import com.miraimelody.radio.playback.SpeechBgmAction
import com.miraimelody.radio.playback.speechBgmAction
import com.miraimelody.radio.playback.RadioPlaybackStatus
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.roundToInt

class MiraiMediaService : MediaLibraryService() {
    private val libraryExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private val prefetchExecutor: ExecutorService = Executors.newFixedThreadPool(2)
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var app: MiraiApplication
    private lateinit var catalog: NativeMediaCatalog
    private lateinit var resolver: PlaybackResolver
    private val normalizationProcessor = MusicNormalizationProcessor()
    private lateinit var mainPlayer: ExoPlayer
    private lateinit var bgmPlayer: ExoPlayer
    private lateinit var mediaSession: MediaLibrarySession
    private lateinit var connectivity: ConnectivityManager
    private var retryCount = 0
    private var waitingForNetwork = false
    private var previousWasSpeech = false
    private var bgmGeneration = 0

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            handler.post {
                PlaybackStatus.update(RadioPlaybackStatus("Connected", offline = false))
                if (waitingForNetwork) {
                    waitingForNetwork = false
                    retryCount = 0
                    mainPlayer.prepare()
                    mainPlayer.play()
                }
            }
        }

        override fun onLost(network: Network) {
            PlaybackStatus.update(
                RadioPlaybackStatus(
                    message = "Offline — local playback continues",
                    offline = true,
                    waitingForNetwork = waitingForNetwork,
                )
            )
        }
    }

    @OptIn(UnstableApi::class)
    override fun onCreate() {
        super.onCreate()
        app = application as MiraiApplication
        catalog = NativeMediaCatalog(app)
        resolver = PlaybackResolver(app)
        val audioAttributes = AudioAttributes.Builder()
            .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
            .setUsage(C.USAGE_MEDIA)
            .build()
        val httpFactory = DefaultHttpDataSource.Factory()
            .setUserAgent("mirAI-melody-Android/0.3.0")
            .setAllowCrossProtocolRedirects(false)
        val upstream = DefaultDataSource.Factory(this, httpFactory)
        val resolving = ResolvingDataSource.Factory(upstream, resolver::resolve)
        val mediaSourceFactory = DefaultMediaSourceFactory(this).setDataSourceFactory(resolving)
        val renderersFactory = object : DefaultRenderersFactory(this) {
            override fun buildAudioSink(
                context: Context,
                enableFloatOutput: Boolean,
                enableAudioTrackPlaybackParams: Boolean,
            ): AudioSink = DefaultAudioSink.Builder(context)
                .setAudioProcessors(arrayOf(normalizationProcessor))
                .setEnableFloatOutput(enableFloatOutput)
                .setEnableAudioOutputPlaybackParameters(enableAudioTrackPlaybackParams)
                .build()
        }
        mainPlayer = ExoPlayer.Builder(this, renderersFactory)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttributes, true)
            .setHandleAudioBecomingNoisy(true)
            .build()
        bgmPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSourceFactory)
            .setAudioAttributes(audioAttributes, false)
            .setHandleAudioBecomingNoisy(true)
            .build()
        mainPlayer.addListener(PlayerEvents())
        bgmPlayer.addListener(BgmEvents())
        mediaSession = MediaLibrarySession.Builder(this, mainPlayer, CatalogCallback()).build()
        connectivity = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        connectivity.registerDefaultNetworkCallback(networkCallback)
        PlaybackStatus.update(RadioPlaybackStatus())
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession =
        mediaSession

    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!mainPlayer.playWhenReady) stopSelf()
    }

    override fun onDestroy() {
        runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
        handler.removeCallbacksAndMessages(null)
        bgmPlayer.release()
        mainPlayer.release()
        mediaSession.release()
        libraryExecutor.shutdownNow()
        prefetchExecutor.shutdownNow()
        super.onDestroy()
    }

    private inner class BgmEvents : Player.Listener {
        override fun onPlayerError(error: PlaybackException) {
            if (!previousWasSpeech) return
            val fallbackId = SpeechBgmSource.fallbackFor(bgmPlayer.currentMediaItem?.mediaId)
                ?: return
            val fallback = catalog.item(fallbackId) ?: return
            bgmPlayer.setMediaItem(fallback)
            bgmPlayer.repeatMode = Player.REPEAT_MODE_ONE
            bgmPlayer.prepare()
            bgmPlayer.play()
        }
    }
    private inner class PlayerEvents : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            retryCount = 0
            val speech = mediaItem?.mediaMetadata?.extras
                ?.getBoolean(NativeMediaCatalog.EXTRA_SPEECH, false) == true
            when (speechBgmAction(previousWasSpeech, speech)) {
                SpeechBgmAction.START -> startSpeechBgm()
                SpeechBgmAction.STOP -> stopSpeechBgm()
                SpeechBgmAction.KEEP, SpeechBgmAction.NONE -> Unit
            }
            previousWasSpeech = speech
            val music = mediaItem?.mediaMetadata?.extras
                ?.getBoolean(NativeMediaCatalog.EXTRA_MUSIC, false) == true
            val settings = app.settings.current()
            normalizationProcessor.enabled = music && settings.audioNormalization
            normalizationProcessor.outputGain = if (speech) settings.speechGain else 1f
            if (music) prefetchNextCycle()
        }

        override fun onPlayerError(error: PlaybackException) {
            val current = mainPlayer.currentMediaItem
            val remote = current?.mediaMetadata?.extras
                ?.getBoolean(NativeMediaCatalog.EXTRA_REMOTE, false) == true
            if (!remote) {
                advanceOrPause("Local item could not be played")
                return
            }
            // Media3 wraps the resolver's throw, so the enrollment failure is several causes
            // deep. Retrying it would burn the whole budget and then report "Offline" for a
            // device that is online and simply not connected to a backend.
            if (generateSequence(error.cause) { it.cause }.any { it is EnrollmentException }) {
                advanceOrPause(PlaybackStatus.NOT_ENROLLED)
                return
            }
            if (retryCount < RETRY_DELAYS_MS.size) {
                val delay = RETRY_DELAYS_MS[retryCount++]
                PlaybackStatus.update(
                    RadioPlaybackStatus(
                        message = "Connection lost — retrying",
                        offline = true,
                    )
                )
                handler.postDelayed({
                    mainPlayer.prepare()
                    mainPlayer.play()
                }, delay)
            } else {
                advanceOrPause("Offline — waiting for a playable item")
            }
        }
    }

    private fun prefetchNextCycle() {
        val start = mainPlayer.currentMediaItemIndex + 1
        val items = buildList {
            for (index in start until mainPlayer.mediaItemCount) {
                val item = mainPlayer.getMediaItemAt(index)
                if (
                    item.mediaMetadata.extras
                        ?.getBoolean(NativeMediaCatalog.EXTRA_MUSIC, false) == true
                ) {
                    break
                }
                add(item)
            }
        }
        items.forEach { item -> prefetchExecutor.execute { resolver.prefetch(item) } }
    }

    private fun advanceOrPause(message: String) {
        retryCount = 0
        if (mainPlayer.hasNextMediaItem()) {
            mainPlayer.seekToNextMediaItem()
            mainPlayer.prepare()
            mainPlayer.play()
            PlaybackStatus.update(RadioPlaybackStatus(message, offline = true))
        } else {
            waitingForNetwork = true
            mainPlayer.pause()
            PlaybackStatus.update(
                RadioPlaybackStatus(message, offline = true, waitingForNetwork = true)
            )
        }
    }

    private fun startSpeechBgm() {
        val generation = ++bgmGeneration
        val resumeSpeech = mainPlayer.playWhenReady
        if (resumeSpeech) mainPlayer.pause()
        prefetchExecutor.execute {
            val bgmMediaId = SpeechBgmSource.choose(
                app.database.tracks().getByRoleBlocking(MediaRole.BGM).map { it.mediaId }
            )
            handler.post {
                if (generation != bgmGeneration) return@post
                val item = catalog.item(bgmMediaId)
                if (item == null) {
                    if (resumeSpeech) mainPlayer.play()
                    return@post
                }
                bgmPlayer.setMediaItem(item)
                bgmPlayer.repeatMode = Player.REPEAT_MODE_ONE
                bgmPlayer.volume = 0f
                bgmPlayer.prepare()
                bgmPlayer.play()
                val settings = app.settings.current()
                rampBgm(
                    from = 0f,
                    to = settings.bgmVolume,
                    durationMs = settings.bgmFadeInMs,
                    generation = generation,
                )
                if (resumeSpeech) handler.postDelayed(
                    { if (generation == bgmGeneration) mainPlayer.play() },
                    settings.bgmLeadInMs,
                )
            }
        }
    }

    private fun stopSpeechBgm() {
        val generation = ++bgmGeneration
        val settings = app.settings.current()
        handler.postDelayed({
            if (generation != bgmGeneration) return@postDelayed
            rampBgm(
                from = bgmPlayer.volume,
                to = 0f,
                durationMs = settings.bgmFadeOutMs,
                generation = generation,
                onEnd = { bgmPlayer.stop() },
            )
        }, settings.bgmTailMs)
    }

    private fun rampBgm(
        from: Float,
        to: Float,
        durationMs: Long,
        generation: Int,
        onEnd: () -> Unit = {},
    ) {
        val steps = 12
        val stepDelay = (durationMs / steps).coerceAtLeast(16)
        repeat(steps + 1) { step ->
            handler.postDelayed({
                if (generation != bgmGeneration) return@postDelayed
                val progress = step.toFloat() / steps
                bgmPlayer.volume = (from + (to - from) * progress).coerceIn(0f, 1f)
                if (step == steps) onEnd()
            }, step * stepDelay)
        }
    }

    private inner class CatalogCallback : MediaLibrarySession.Callback {
        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            immediate(LibraryResult.ofItem(catalog.root(), params))

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            submit(
                task = {
                    val all = catalog.children(parentId)
                    val from = (page * pageSize).coerceAtMost(all.size)
                    val to = (from + pageSize).coerceAtMost(all.size)
                    LibraryResult.ofItemList(all.subList(from, to), params)
                },
                fallback = LibraryResult.ofItemList(emptyList(), params),
            )

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            immediate(LibraryResult.ofItem(catalog.item(mediaId) ?: catalog.root(), null))

        override fun onSearch(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> = submit(
            task = {
                session.notifySearchResultChanged(browser, query, catalog.search(query).size, params)
                LibraryResult.ofVoid(params)
            },
            fallback = LibraryResult.ofVoid(params),
        )

        override fun onGetSearchResult(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            submit(
                task = { LibraryResult.ofItemList(catalog.search(query), params) },
                fallback = LibraryResult.ofItemList(emptyList(), params),
            )

        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
        ): ListenableFuture<List<MediaItem>> =
            submit({ catalog.resolveItems(mediaItems) }, emptyList())

        @OptIn(UnstableApi::class)
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: List<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = submit(
            task = {
                if (mediaItems.isEmpty()) {
                    MediaSession.MediaItemsWithStartPosition(
                        emptyList(),
                        C.INDEX_UNSET,
                        C.TIME_UNSET,
                    )
                } else {
                    val requested = if (startIndex == C.INDEX_UNSET) 0
                    else startIndex.coerceIn(mediaItems.indices)
                    val queue = catalog.queueFor(mediaItems[requested].mediaId)
                    MediaSession.MediaItemsWithStartPosition(
                        queue.items,
                        queue.startIndex,
                        if (startPositionMs == C.TIME_UNSET) C.TIME_UNSET
                        else startPositionMs.coerceAtLeast(0),
                    )
                }
            },
            fallback = MediaSession.MediaItemsWithStartPosition(
                emptyList(),
                C.INDEX_UNSET,
                C.TIME_UNSET,
            ),
        )
    }

    private fun <T> immediate(value: T): ListenableFuture<T> =
        SettableFuture.create<T>().also { it.set(value) }

    private fun <T> submit(task: Callable<T>, fallback: T): ListenableFuture<T> =
        SettableFuture.create<T>().also { future ->
            libraryExecutor.execute {
                try {
                    future.set(task.call())
                } catch (_: Exception) {
                    future.set(fallback)
                }
            }
        }

    companion object {
        private val RETRY_DELAYS_MS = longArrayOf(1_000, 2_000, 4_000)
    }
}
