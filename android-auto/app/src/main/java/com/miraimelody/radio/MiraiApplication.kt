package com.miraimelody.radio

import android.app.Application
import com.miraimelody.radio.cache.AudioFileCache
import com.miraimelody.radio.data.RadioDatabase
import com.miraimelody.radio.data.SettingsRepository
import com.miraimelody.radio.data.SourceRepository
import com.miraimelody.radio.network.NativeBackendClient
import com.miraimelody.radio.security.CredentialStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MiraiApplication : Application() {
    lateinit var database: RadioDatabase
        private set
    lateinit var settings: SettingsRepository
        private set
    lateinit var credentials: CredentialStore
        private set
    lateinit var backend: NativeBackendClient
        private set
    lateinit var sources: SourceRepository
        private set
    lateinit var cache: AudioFileCache
        private set

    override fun onCreate() {
        super.onCreate()
        database = RadioDatabase.get(this)
        settings = SettingsRepository(this)
        credentials = CredentialStore(this)
        backend = NativeBackendClient(settings, credentials)
        cache = AudioFileCache(this) { settings.current().cacheLimitBytes }
        sources = SourceRepository(this, database, backend, cache)
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            sources.migrateLegacyPlaylist(settings.settings.first().legacyPlaylistId)
        }
    }
}
