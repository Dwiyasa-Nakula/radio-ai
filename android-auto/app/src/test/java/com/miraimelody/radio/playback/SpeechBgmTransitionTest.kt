package com.miraimelody.radio.playback

import org.junit.Assert.assertEquals
import org.junit.Test

class SpeechBgmTransitionTest {
    @Test
    fun `BGM starts once stays through speech and stops at media`() {
        assertEquals(SpeechBgmAction.START, speechBgmAction(false, true))
        assertEquals(SpeechBgmAction.KEEP, speechBgmAction(true, true))
        assertEquals(SpeechBgmAction.STOP, speechBgmAction(true, false))
        assertEquals(SpeechBgmAction.NONE, speechBgmAction(false, false))
    }
}
