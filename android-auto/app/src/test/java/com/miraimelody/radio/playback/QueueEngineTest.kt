package com.miraimelody.radio.playback

import com.miraimelody.radio.data.BroadcastMode
import com.miraimelody.radio.data.QueueMode
import com.miraimelody.radio.data.RadioSettings
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class QueueEngineTest {
    private val tracks = listOf("Song A", "Song B")
    private val intros = listOf("Intro 1", "Intro 2")
    private val outros = listOf("Outro 1", "Outro 2")
    private val ads = listOf("Acme")

    @Test
    fun fullShowPreservesCompleteBroadcastOrder() {
        val result = ShowQueueBuilder<String>(title = { it }).build(
            tracks,
            RadioSettings(broadcastMode = BroadcastMode.FULL_SHOW),
            intros,
            outros,
            ads,
        )
        assertEquals(
            listOf(
                SegmentType.INTRO,
                SegmentType.MUSIC,
                SegmentType.OUTRO,
                SegmentType.PREVIOUS_DISCUSSION,
                SegmentType.WEATHER,
                SegmentType.TRAFFIC,
                SegmentType.NEWS,
                SegmentType.AD,
                SegmentType.SPONSOR,
                SegmentType.NEXT_DISCUSSION,
            ),
            result.take(10).map { it.type },
        )
        assertEquals("Acme", result.first { it.type == SegmentType.SPONSOR }.sponsorBrand)
    }

    @Test
    fun classicIntervalsAreIndependent() {
        val result = ShowQueueBuilder<String>().build(
            List(6) { "Song " + it },
            RadioSettings(
                broadcastMode = BroadcastMode.CLASSIC,
                introInterval = 2,
                outroInterval = 3,
                discussionInterval = 2,
                weatherInterval = 4,
                trafficInterval = 5,
                newsInterval = 6,
                adInterval = 3,
                sponsorInterval = 3,
            ),
            intros,
            outros,
            ads,
        )
        assertEquals(3, result.count { it.type == SegmentType.INTRO })
        assertEquals(2, result.count { it.type == SegmentType.OUTRO })
        assertEquals(3, result.count { it.type == SegmentType.PREVIOUS_DISCUSSION })
        assertEquals(1, result.count { it.type == SegmentType.WEATHER })
        assertEquals(1, result.count { it.type == SegmentType.TRAFFIC })
        assertEquals(1, result.count { it.type == SegmentType.NEWS })
        assertEquals(2, result.count { it.type == SegmentType.AD })
    }

    @Test
    fun musicOnlyContainsNoBroadcastSegments() {
        val result = ShowQueueBuilder<String>().build(
            tracks,
            RadioSettings(broadcastMode = BroadcastMode.MUSIC_ONLY),
            intros,
            outros,
            ads,
        )
        assertEquals(tracks, result.map { it.track })
        assertTrue(result.all { it.type == SegmentType.MUSIC })
    }

    @Test
    fun orderedAndRandomQueuesAndFavoriteWeightingAreDeterministic() {
        val input = (1..20).toList()
        val ordered = QueuePlanner.plan(input, QueueMode.ORDERED, { if (it <= 3) it else 0 }, Random(7))
        assertEquals(22, ordered.size)
        assertEquals(input, ordered.filterIndexed { index, _ -> index != 10 && index != 21 })
        val random = QueuePlanner.plan(input, QueueMode.RANDOM, { 0 }, Random(7))
        assertNotEquals(input, random)
        assertEquals(input.toSet(), random.toSet())
    }

    @Test
    fun tenthFavoriteParticipatesInWeighting() {
        val input = (1..10).toList()
        val planned = QueuePlanner.plan(input, QueueMode.ORDERED, { if (it == 10) 10 else 0 }, Random(7))
        assertEquals(11, planned.size)
        assertEquals(2, planned.count { it == 10 })
    }

    @Test
    fun shuffleBagsExhaustTheirOwnItemsBeforeRepeating() {
        val introBag = ShuffleBag<String>(Random(1))
        val outroBag = ShuffleBag<String>(Random(2))
        val introRound = List(2) { introBag.next(intros)!! }
        val outroRound = List(2) { outroBag.next(outros)!! }
        assertEquals(intros.toSet(), introRound.toSet())
        assertEquals(outros.toSet(), outroRound.toSet())
        assertNotEquals(introRound.last(), introBag.next(intros))
        assertNotEquals(outroRound.last(), outroBag.next(outros))
    }
}
