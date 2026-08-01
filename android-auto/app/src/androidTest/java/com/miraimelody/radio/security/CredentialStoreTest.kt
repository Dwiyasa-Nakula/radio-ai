package com.miraimelody.radio.security

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialStoreTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val store = CredentialStore(context)

    @After
    fun cleanUp() {
        store.clear()
    }

    @Test
    fun credentialRoundTripsThroughAndroidKeystoreEncryption() {
        val credential = "device-enrollment-secret-for-test"
        store.save(credential)
        assertTrue(store.hasCredential())
        assertEquals(credential, store.load())
        val preferences = context.getSharedPreferences(
            "native-enrollment-credential",
            android.content.Context.MODE_PRIVATE,
        )
        assertNotEquals(credential, preferences.getString("ciphertext", null))
        store.clear()
        assertFalse(store.hasCredential())
    }
}
