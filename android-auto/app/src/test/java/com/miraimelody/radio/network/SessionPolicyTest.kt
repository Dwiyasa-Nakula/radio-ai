package com.miraimelody.radio.network

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionPolicyTest {
    @Test
    fun refreshesFiveMinutesBeforeExpiration() {
        val now = 10_000_000L
        assertFalse(SessionPolicy.shouldRefresh(now + 300_001L, now))
        assertTrue(SessionPolicy.shouldRefresh(now + 300_000L, now))
        assertTrue(SessionPolicy.shouldRefresh(now - 1L, now))
    }

    @Test
    fun retriesAnExpiredTokenOnlyOnce() {
        assertTrue(SessionPolicy.shouldRetryUnauthorized(401, alreadyRetried = false))
        assertFalse(SessionPolicy.shouldRetryUnauthorized(401, alreadyRetried = true))
        assertFalse(SessionPolicy.shouldRetryUnauthorized(403, alreadyRetried = false))
    }
}
