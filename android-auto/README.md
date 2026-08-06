# mirAI melody Android + Android Auto

Version 0.3.0 is a standalone native Android application. It contains no WebView,
website URL, browser storage, cookies, or Next.js session dependency.

## Native features

- Jetpack Compose phone UI: Now Playing, Sources, Local Queue, Broadcast Settings,
  and Connection/Cache.
- Media3 MediaLibraryService as the single playback owner for phone, lock screen,
  notification, and Android Auto.
- Storage Access Framework folders with permissions retained across restarts.
- Native MP3/MP4 metadata extraction. Embedded artwork and MP4 video frames are
  cached for the phone and Android Auto.
- Room source/queue persistence, DataStore settings, and an AES-GCM enrollment
  credential protected by Android Keystore.
- Full Show, independently scheduled Classic mode, and Music Only.
- Unlimited-depth SAF root-folder discovery without a 2,000-file cap.
- Ordered/random queues, up to ten favorites, and approximately 10% extra
  favorite rotation.
- Japanese/English announcers and High/Balanced/Data Saver codec/bitrate choices.
- Secondary local BGM player with 10% default volume, fade-in, speech lead-in,
  tail, and fade-out.

Full Show order:

Intro → Music → Outro → Previous Discussion → Weather/Temperature → Traffic →
News → Ad → Sponsor TTS → Next Discussion

## Backend enrollment

Deploy services/backend separately. Configure:

    BACKEND_SESSION_SECRET=<at least 32 characters>
    BACKEND_PUBLIC_URL=https://your-backend.example.com
    MOBILE_DEVICE_CREDENTIAL_HASHES=<sha256-of-device-credential>

The backend stores only configured SHA-256 hashes. The phone sends
Authorization: Device <enrollment-secret> to POST /v1/mobile/session, stores
the credential encrypted locally, and refreshes the one-hour scoped token five
minutes before expiry. AI, TTS, YouTube, weather, traffic, and news credentials
remain on the backend.

The optional build-time backend default is:

    .\gradlew.bat :app:assembleDebug -PMIRAI_BACKEND_URL=https://your-backend.example.com

The user can always enroll or change the backend in the native Connection screen.

## Build and verify

Requirements: JDK 17, Android SDK Platform 36, and Build Tools 36.

Set `JAVA_HOME` to a JDK 17+ installation and set `ANDROID_HOME`/`ANDROID_SDK_ROOT`
to the Android SDK. As an alternative, create an ignored `local.properties` file:

    sdk.dir=C:\\Users\\you\\AppData\\Local\\Android\\Sdk

    .\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
    .\gradlew.bat :app:assembleRelease

The debug APK is app/build/outputs/apk/debug/app-debug.apk. Configure a private
release signing key outside the repository for personal distribution.

## Offline acceptance

Select a music folder through Sources, start a local track, then enable airplane
mode. Local music, MP3/MP4 jingles and ads, artwork, and BGM continue without a
website or backend. Generated host segments use the recent 250 MB LRU cache when
fresh enough, otherwise a short local transition advances the queue. YouTube and
live radio are retried with bounded backoff and are never downloaded.

For Android Auto, enable developer mode/Unknown sources for a sideloaded build
and verify browsing and playback with the Desktop Head Unit.
