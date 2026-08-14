package com.miraimelody.radio.playback

import kotlin.random.Random

object SpeechBgmSource {
    const val BACKEND_MEDIA_ID = "backend:bgm"
    const val BACKEND_URI = "mirai://bgm/default"
    const val PACKAGED_MEDIA_ID = "packaged:bgm"
    const val PACKAGED_URI = "asset:///bgm.mp3"

    fun choose(localMediaIds: List<String>, random: Random = Random.Default): String =
        localMediaIds.randomOrNull(random) ?: BACKEND_MEDIA_ID

    fun fallbackFor(mediaId: String?): String? =
        PACKAGED_MEDIA_ID.takeIf { mediaId == BACKEND_MEDIA_ID }
}
