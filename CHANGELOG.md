
# Changelog

All notable changes to **mirAI melody 73.9 FM** will be documented in this file.

## [0.3.0] - 2026-08-02

### Added & Enhanced

- **Standalone Native Android + Android Auto**: Replaced the WebView client with a Compose, Media3, Room, DataStore, SAF, and Android Keystore application that can play local music without the website.
- **Direct Mobile Enrollment**: Added hashed device credentials, one-hour scoped sessions, automatic refresh, and native YouTube ad metadata validation.
- **Independent Cloud Backend**: Added the containerized Node.js backend, shared contracts, Secret Manager integration, health/readiness checks, and a verified Cloud Run deployment in Singapore.
- **Offline-First Playback**: Added a 250 MB generated-audio cache, local transition fallback, bounded network retry, and automatic playback recovery.

- **YouTube Ad Link Support**: Added support for YouTube ad links in `public/ads/ads link.json` alongside local MP3/MP4 files in a shared no-repeat rotation.
- **Intricate Japanese Aesthetics**: Added authentic, high-density Japanese Asanoha (麻の葉) Kumiko lattice background SVG pattern and Seigaiha (青海波) wave overlays to the player canvas.
- **Responsive Player Layout**: Optimized player components for mobile and small screens (`< 640px`), including auto-hiding the vinyl disc when space is limited.
- **Ad & Sponsor Queue Alignment**: Synchronized prebuffering logic between ad rotation and TTS sponsor credit generation to ensure the sponsor voice always announces the exact playing ad.

### Features

- **YouTube Playlist Streaming**: Stream YouTube playlists on demand via `yt-dlp` stream extraction and proxies with range request support.
- **Local Music Library & Drive Browsing**: Scan local directories, read ID3/Vorbis/MP4 metadata and cover art, and support remote filesystem browsing.
- **IndexedDB Folder Handle Persistence**: Store private, read-only directory handles in IndexedDB with multi-file Web Worker scanning and metadata caching.
- **Virtualized Library & Queue**: Render unlimited track lists without UI caps using `@tanstack/react-virtual`.
- **AI Radio Host Pipeline**:
  - LLM speech generation powered by Groq (`llama-3.3-70b-versatile`).
  - Dual Japanese / English announcer options with a 10-song DJ memory.
  - Multi-tier TTS pipeline: Google Gemini 3.1/2.5 Flash TTS → OpenRouter → Style-BERT-VITS2 → AnyVoiceLab.
  - Background music (BGM) ducking with smooth crossfades.
- **Grounded Song Trivia**: DuckDuckGo search integration with prompt-injection guards and hallucination controls to research song awards, release dates, and studio trivia.
- **Scheduled Radio Segments**:
  - 📰 **NHK News RSS**: Live headline briefings with focus targeting.
  - 🌤 **JMA Weather**: Nationwide Japan regional forecasts with temperature reports.
  - 🚗 **TomTom Orbis Traffic**: Real-time Tokyo road traffic incident updates.
  - 🎵 **Jingles**: Separate shuffle bags for Intro (`public/Intro jingles/`) and Outro (`public/Outro Jingle/`) audio/video MP4 files.
  - 📢 **Sponsored Ads**: Folder MP3/MP4 ad rotation + YouTube ad links with deterministic sponsor credits.
- **Dual-Deck Audio Engine**:
  - Seamless two-deck streaming player with pre-loading and volume crossfades.
  - Audio quality selection: High, Balanced, and Data Saver modes.
  - Embedded ReplayGain normalization for local tagged tracks.
- **International Live Radio**: List-based directory powered by Radio Browser for live stations across Japan, China, and South Korea.
- **Cloud Run & Vercel Architecture**: Backend session protection, scoped API endpoints, and byte-range media streaming.
