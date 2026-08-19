package com.miraimelody.radio.playback

import com.miraimelody.radio.data.BroadcastMode
import com.miraimelody.radio.data.LOCAL_FAVORITE_LIMIT
import com.miraimelody.radio.data.QueueMode
import com.miraimelody.radio.data.RadioSettings
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.random.Random

enum class SegmentType {
    INTRO,
    MUSIC,
    OUTRO,
    PREVIOUS_DISCUSSION,
    COMBINED_DISCUSSION,
    WEATHER,
    TRAFFIC,
    NEWS,
    AD,
    SPONSOR,
    NEXT_DISCUSSION,
}

data class ScheduledEntry<T>(
    val type: SegmentType,
    val track: T? = null,
    val nextTrack: T? = null,
    val media: T? = null,
    val sponsorBrand: String = "",
    val isPreroll: Boolean = false,
    val isNoon: Boolean = false,
)

class ShuffleBag<T>(
    private val random: Random = Random.Default,
) {
    private var remaining = mutableListOf<T>()
    private var previous: T? = null

    fun next(values: List<T>): T? {
        if (values.isEmpty()) return null
        val valid = values.distinct()
        remaining.retainAll(valid.toSet())
        if (remaining.isEmpty()) {
            remaining = valid.shuffled(random).toMutableList()
            if (remaining.size > 1 && remaining.first() == previous) {
                val swap = remaining[0]
                remaining[0] = remaining[1]
                remaining[1] = swap
            }
        }
        return remaining.removeAt(0).also { previous = it }
    }
}

object QueuePlanner {
    fun <T> plan(
        items: List<T>,
        mode: QueueMode,
        favoriteRank: (T) -> Int,
        random: Random = Random.Default,
    ): List<T> {
        if (items.isEmpty()) return emptyList()
        val base = when (mode) {
            QueueMode.ORDERED -> items
            QueueMode.RANDOM -> items.shuffled(random)
        }
        val favorites = items.filter { favoriteRank(it) in 1..LOCAL_FAVORITE_LIMIT }
            .sortedBy(favoriteRank)
        if (favorites.isEmpty()) return base
        val extraCount = when {
            base.size >= 10 -> base.size / 10
            base.size >= 5 -> 1
            else -> 0
        }
        if (extraCount == 0) return base
        val result = base.toMutableList()
        repeat(extraCount) { index ->
            val favorite = favorites[index % favorites.size]
            val insertion = ((index + 1) * 10 + index).coerceAtMost(result.size)
            result.add(insertion, favorite)
        }
        return result
    }
}

class ShowQueueBuilder<T>(
    private val introBag: ShuffleBag<T> = ShuffleBag(),
    private val outroBag: ShuffleBag<T> = ShuffleBag(),
    private val adBag: ShuffleBag<T> = ShuffleBag(),
    private val title: (T) -> String = { it.toString() },
    private val currentJstHour: () -> Int = {
        ZonedDateTime.now(ZoneId.of("Asia/Tokyo")).hour
    },
) {
    fun build(
        tracks: List<T>,
        settings: RadioSettings,
        intros: List<T>,
        outros: List<T>,
        ads: List<T>,
    ): List<ScheduledEntry<T>> {
        if (!settings.hostEnabled || settings.broadcastMode == BroadcastMode.MUSIC_ONLY) {
            return tracks.map { ScheduledEntry(SegmentType.MUSIC, track = it) }
        }
        return when (settings.broadcastMode) {
            BroadcastMode.FULL_SHOW -> fullShow(tracks, settings, intros, outros, ads)
            BroadcastMode.CLASSIC -> classic(tracks, settings, intros, outros, ads)
            BroadcastMode.MUSIC_ONLY -> error("Handled above")
        }
    }

    private fun fullShow(
        tracks: List<T>,
        settings: RadioSettings,
        intros: List<T>,
        outros: List<T>,
        ads: List<T>,
    ): List<ScheduledEntry<T>> = buildList {
        tracks.forEachIndexed { index, current ->
            val next = tracks[(index + 1) % tracks.size]
            introBag.next(intros)?.let {
                add(ScheduledEntry(SegmentType.INTRO, track = current, nextTrack = next, media = it))
            }
            add(ScheduledEntry(SegmentType.MUSIC, track = current, nextTrack = next))
            outroBag.next(outros)?.let {
                add(ScheduledEntry(SegmentType.OUTRO, track = current, nextTrack = next, media = it))
            }
            if (settings.chatterEnabled && settings.separateSongDiscussions) {
                add(ScheduledEntry(SegmentType.PREVIOUS_DISCUSSION, current, next))
            }
            add(ScheduledEntry(SegmentType.WEATHER, current, next))
            add(ScheduledEntry(SegmentType.TRAFFIC, current, next))
            add(ScheduledEntry(SegmentType.NEWS, current, next))
            if (settings.adsEnabled) {
                adBag.next(ads)?.let { ad ->
                    add(ScheduledEntry(SegmentType.AD, current, next, ad, title(ad)))
                    add(ScheduledEntry(SegmentType.SPONSOR, current, next, sponsorBrand = title(ad)))
                }
            }
            if (settings.chatterEnabled) {
                add(
                    ScheduledEntry(
                        if (settings.separateSongDiscussions) {
                            SegmentType.NEXT_DISCUSSION
                        } else {
                            SegmentType.COMBINED_DISCUSSION
                        },
                        current,
                        next,
                    )
                )
            }
        }
    }

    private fun classic(
        tracks: List<T>,
        settings: RadioSettings,
        intros: List<T>,
        outros: List<T>,
        ads: List<T>,
    ): List<ScheduledEntry<T>> = buildList {
        val first = tracks.firstOrNull()
        val hour = currentJstHour()
        val morning = settings.morningPreroll && hour in 5..10
        val noon = settings.noonPreroll && hour in 11..13
        if (first != null && (morning || noon)) {
            add(ScheduledEntry(SegmentType.NEWS, nextTrack = first, isPreroll = true, isNoon = noon))
            add(ScheduledEntry(SegmentType.WEATHER, nextTrack = first, isPreroll = true, isNoon = noon))
        }
        tracks.forEachIndexed { index, current ->
            val next = tracks.getOrElse(index + 1) { tracks.first() }
            if (index > 0) {
                val songsPlayed = index
                val useJinglePair = songsPlayed due settings.jingleEvery
                if (useJinglePair) {
                    outroBag.next(outros)?.let {
                        add(ScheduledEntry(SegmentType.OUTRO, tracks[index - 1], current, it))
                    }
                }
                if (songsPlayed due settings.newsEvery) {
                    add(ScheduledEntry(SegmentType.NEWS, tracks[index - 1], current))
                }
                if (settings.adsEnabled && songsPlayed due settings.adEvery) {
                    adBag.next(ads)?.let { ad ->
                        add(ScheduledEntry(SegmentType.AD, tracks[index - 1], current, ad, title(ad)))
                        add(
                            ScheduledEntry(
                                SegmentType.SPONSOR,
                                tracks[index - 1],
                                current,
                                sponsorBrand = title(ad),
                            )
                        )
                    }
                }
                if (songsPlayed due settings.trafficEvery) {
                    add(ScheduledEntry(SegmentType.TRAFFIC, tracks[index - 1], current))
                }
                if (settings.chatterEnabled && songsPlayed due settings.frequency) {
                    add(ScheduledEntry(SegmentType.COMBINED_DISCUSSION, tracks[index - 1], current))
                }
                if (useJinglePair) {
                    introBag.next(intros)?.let {
                        add(ScheduledEntry(SegmentType.INTRO, tracks[index - 1], current, it))
                    }
                }
            }
            add(ScheduledEntry(SegmentType.MUSIC, current, next))
        }
    }

    private infix fun Int.due(interval: Int): Boolean = interval > 0 && this % interval == 0
}
