package com.miraimelody.radio.playback

import com.miraimelody.radio.data.BroadcastMode
import com.miraimelody.radio.data.LOCAL_FAVORITE_LIMIT
import com.miraimelody.radio.data.QueueMode
import com.miraimelody.radio.data.RadioSettings
import kotlin.random.Random

enum class SegmentType {
    INTRO,
    MUSIC,
    OUTRO,
    PREVIOUS_DISCUSSION,
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
) {
    fun build(
        tracks: List<T>,
        settings: RadioSettings,
        intros: List<T>,
        outros: List<T>,
        ads: List<T>,
    ): List<ScheduledEntry<T>> = when (settings.broadcastMode) {
        BroadcastMode.FULL_SHOW -> fullShow(tracks, intros, outros, ads)
        BroadcastMode.CLASSIC -> classic(tracks, settings, intros, outros, ads)
        BroadcastMode.MUSIC_ONLY -> tracks.map { ScheduledEntry(SegmentType.MUSIC, track = it) }
    }

    private fun fullShow(
        tracks: List<T>,
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
            add(ScheduledEntry(SegmentType.PREVIOUS_DISCUSSION, current, next))
            add(ScheduledEntry(SegmentType.WEATHER, current, next))
            add(ScheduledEntry(SegmentType.TRAFFIC, current, next))
            add(ScheduledEntry(SegmentType.NEWS, current, next))
            val ad = adBag.next(ads)
            if (ad != null) add(
                ScheduledEntry(
                    type = SegmentType.AD,
                    track = current,
                    nextTrack = next,
                    media = ad,
                    sponsorBrand = title(ad),
                )
            )
            add(
                ScheduledEntry(
                    type = SegmentType.SPONSOR,
                    track = current,
                    nextTrack = next,
                    sponsorBrand = ad?.let(title).orEmpty(),
                )
            )
            add(ScheduledEntry(SegmentType.NEXT_DISCUSSION, current, next))
        }
    }

    private fun classic(
        tracks: List<T>,
        settings: RadioSettings,
        intros: List<T>,
        outros: List<T>,
        ads: List<T>,
    ): List<ScheduledEntry<T>> = buildList {
        tracks.forEachIndexed { index, current ->
            val number = index + 1
            val next = tracks[(index + 1) % tracks.size]
            add(ScheduledEntry(SegmentType.MUSIC, current, next))
            if (number due settings.outroInterval) {
                outroBag.next(outros)?.let {
                    add(ScheduledEntry(SegmentType.OUTRO, current, next, it))
                }
            }
            if (number due settings.discussionInterval) {
                add(ScheduledEntry(SegmentType.PREVIOUS_DISCUSSION, current, next))
            }
            if (number due settings.weatherInterval) {
                add(ScheduledEntry(SegmentType.WEATHER, current, next))
            }
            if (number due settings.trafficInterval) {
                add(ScheduledEntry(SegmentType.TRAFFIC, current, next))
            }
            if (number due settings.newsInterval) {
                add(ScheduledEntry(SegmentType.NEWS, current, next))
            }
            var selectedAd: T? = null
            if (number due settings.adInterval) {
                selectedAd = adBag.next(ads)
                selectedAd?.let {
                    add(
                        ScheduledEntry(
                            SegmentType.AD,
                            current,
                            next,
                            it,
                            title(it),
                        )
                    )
                }
            }
            if (number due settings.sponsorInterval) {
                add(
                    ScheduledEntry(
                        SegmentType.SPONSOR,
                        current,
                        next,
                        sponsorBrand = selectedAd?.let(title).orEmpty(),
                    )
                )
            }
            if (number due settings.introInterval) {
                introBag.next(intros)?.let {
                    add(ScheduledEntry(SegmentType.INTRO, current, next, it))
                }
            }
        }
    }

    private infix fun Int.due(interval: Int): Boolean = this % interval.coerceAtLeast(1) == 0
}
