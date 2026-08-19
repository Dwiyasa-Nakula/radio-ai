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
    fun `disabled host produces music only`() {
        val result = ShowQueueBuilder<String>().build(
            tracks = listOf("song"),
            settings = RadioSettings(hostEnabled = false),
            intros = listOf("intro"),
            outros = listOf("outro"),
            ads = listOf("ad"),
        )

        assertEquals(listOf(SegmentType.MUSIC), result.map { it.type })
    }

    @Test
    fun `classic zero intervals disable optional segments`() {
        val result = ShowQueueBuilder<String>().build(
            tracks = listOf("song", "next"),
            settings = RadioSettings(
                broadcastMode = BroadcastMode.CLASSIC,
                chatterEnabled = false,
                newsEvery = 0,
                trafficEvery = 0,
                jingleEvery = 0,
                adsEnabled = false,
                morningPreroll = false,
                noonPreroll = false,
            ),
            intros = listOf("intro"),
            outros = listOf("outro"),
            ads = listOf("ad"),
        )

        assertEquals(
            listOf(SegmentType.MUSIC, SegmentType.MUSIC),
            result.map { it.type },
        )
    }

    @Test
    fun fullShowPreservesCompleteBroadcastOrder() {
        val result = ShowQueueBuilder<String>(title = { it }).build(
            tracks,
            RadioSettings(broadcastMode = BroadcastMode.FULL_SHOW, adsEnabled = true),
            intros,
            outros,
            ads,
        )
        assertEquals(
            listOf(
                SegmentType.INTRO,
                SegmentType.MUSIC,
                SegmentType.OUTRO,
                SegmentType.WEATHER,
                SegmentType.TRAFFIC,
                SegmentType.NEWS,
                SegmentType.AD,
                SegmentType.SPONSOR,
                SegmentType.COMBINED_DISCUSSION,
            ),
            result.take(9).map { it.type },
        )
        assertEquals("Acme", result.first { it.type == SegmentType.SPONSOR }.sponsorBrand)
    }

    @Test
    fun fullShowOmitsAdsWhenTheyAreDisabled() {
        val result = ShowQueueBuilder<String>(title = { it }).build(
            tracks,
            RadioSettings(broadcastMode = BroadcastMode.FULL_SHOW, adsEnabled = false),
            intros,
            outros,
            ads,
        )
        assertEquals(
            listOf(
                SegmentType.INTRO,
                SegmentType.MUSIC,
                SegmentType.OUTRO,
                SegmentType.WEATHER,
                SegmentType.TRAFFIC,
                SegmentType.NEWS,
                SegmentType.COMBINED_DISCUSSION,
            ),
            result.take(7).map { it.type },
        )
        assertTrue(result.none { it.type == SegmentType.AD || it.type == SegmentType.SPONSOR })
    }

    @Test
    fun fullShowCanKeepSongDiscussionsSeparate() {
        val result = ShowQueueBuilder<String>(title = { it }).build(
            tracks,
            RadioSettings(
                broadcastMode = BroadcastMode.FULL_SHOW,
                adsEnabled = false,
                separateSongDiscussions = true,
            ),
            intros,
            outros,
            ads,
        )

        assertEquals(
            listOf(SegmentType.PREVIOUS_DISCUSSION, SegmentType.NEXT_DISCUSSION),
            result.take(8).map { it.type }.filter {
                it == SegmentType.PREVIOUS_DISCUSSION || it == SegmentType.NEXT_DISCUSSION
            },
        )
        assertTrue(result.none { it.type == SegmentType.COMBINED_DISCUSSION })
    }

    @Test
    fun classicBreakMatchesWebOrderBeforeTheNextSong() {
        val result = ShowQueueBuilder<String>(title = { it }).build(
            List(3) { "Song " + it },
            RadioSettings(
                broadcastMode = BroadcastMode.CLASSIC,
                adsEnabled = true,
                morningPreroll = false,
                noonPreroll = false,
                frequency = 2,
                newsEvery = 2,
                trafficEvery = 2,
                jingleEvery = 2,
                adEvery = 2,
            ),
            intros,
            outros,
            ads,
        )
        assertEquals(
            listOf(
                SegmentType.MUSIC,
                SegmentType.MUSIC,
                SegmentType.OUTRO,
                SegmentType.NEWS,
                SegmentType.AD,
                SegmentType.SPONSOR,
                SegmentType.TRAFFIC,
                SegmentType.COMBINED_DISCUSSION,
                SegmentType.INTRO,
                SegmentType.MUSIC,
            ),
            result.map { it.type },
        )
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
