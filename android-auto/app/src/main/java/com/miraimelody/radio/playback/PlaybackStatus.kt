package com.miraimelody.radio.playback

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class RadioPlaybackStatus(
    val message: String = "Ready",
    val offline: Boolean = false,
    val waitingForNetwork: Boolean = false,
)

object PlaybackStatus {
    /**
     * Shown when a backend call fails because the device is not enrolled. Distinct from the
     * network messages: no amount of retrying or waiting for connectivity fixes it, so the
     * status has to point at Settings instead of implying a flaky connection.
     */
    const val NOT_ENROLLED = "Not enrolled — open Settings to connect the backend"

    private val mutable = MutableStateFlow(RadioPlaybackStatus())
    val state: StateFlow<RadioPlaybackStatus> = mutable

    fun update(status: RadioPlaybackStatus) {
        mutable.value = status
    }
}
