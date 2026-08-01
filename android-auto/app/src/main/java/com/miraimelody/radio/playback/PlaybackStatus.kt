package com.miraimelody.radio.playback

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class RadioPlaybackStatus(
    val message: String = "Ready",
    val offline: Boolean = false,
    val waitingForNetwork: Boolean = false,
)

object PlaybackStatus {
    private val mutable = MutableStateFlow(RadioPlaybackStatus())
    val state: StateFlow<RadioPlaybackStatus> = mutable

    fun update(status: RadioPlaybackStatus) {
        mutable.value = status
    }
}
