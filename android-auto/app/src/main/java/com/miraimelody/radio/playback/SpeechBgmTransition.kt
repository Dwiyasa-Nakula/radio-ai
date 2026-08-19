package com.miraimelody.radio.playback

enum class SpeechBgmAction { START, KEEP, STOP, NONE }

fun speechBgmAction(wasSpeech: Boolean, isSpeech: Boolean): SpeechBgmAction = when {
    isSpeech && !wasSpeech -> SpeechBgmAction.START
    isSpeech -> SpeechBgmAction.KEEP
    wasSpeech -> SpeechBgmAction.STOP
    else -> SpeechBgmAction.NONE
}
