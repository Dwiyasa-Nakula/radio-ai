package com.miraimelody.radio.network

object SessionPolicy {
    const val REFRESH_WINDOW_MS = 5L * 60L * 1000L

    fun shouldRefresh(expiresAtMs: Long, nowMs: Long): Boolean =
        expiresAtMs - nowMs <= REFRESH_WINDOW_MS

    fun shouldRetryUnauthorized(status: Int, alreadyRetried: Boolean): Boolean =
        status == 401 && !alreadyRetried
}
