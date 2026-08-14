package com.miraimelody.radio.playback

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechBgmSourceTest {
    @Test
    fun `backend BGM is used when no local BGM is configured`() {
        assertEquals(
            SpeechBgmSource.BACKEND_MEDIA_ID,
            SpeechBgmSource.choose(emptyList(), Random(1)),
        )
    }

    @Test
    fun `backend failure falls back to packaged BGM`() {
        assertEquals(
            SpeechBgmSource.PACKAGED_MEDIA_ID,
            SpeechBgmSource.fallbackFor(SpeechBgmSource.BACKEND_MEDIA_ID),
        )
    }
    @Test
    fun `configured local BGM remains preferred`() {
        assertEquals("local:bgm", SpeechBgmSource.choose(listOf("local:bgm"), Random(1)))
    }
}
