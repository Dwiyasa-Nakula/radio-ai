

# mirAI melody 73.9 FM

A full-featured AI radio station web application that streams from YouTube playlists, local music libraries, or live international radio stations, hosted by an AI DJ with real-time news, nationwide weather forecasts, road traffic updates, jingle breaks, and sponsor announcements.

---

## Key Features

### 📻 Streaming & Audio Engine

- **Dual-Deck Audio Architecture**: Native HTML5 two-deck streaming player (`deckA` / `deckB`) with smooth crossfades, automatic track preloading, BGM ducking, and song outro fades.
- **YouTube Playlist Streaming**: Streams YouTube playlist audio on demand via pinned `yt-dlp`, automatic `mweb` PO-token attestation, range-request proxying, challenge circuit-breaking, and pre-fetch resolution caching.
- **Audio Quality Profiles**: High, Balanced, and Data Saver quality modes for YouTube streams and live radio broadcasts.
- **Embedded ReplayGain**: Automatic track loudness normalization for tagged local audio files applied independently across decks.

### 📁 Local Library & Private Directory Storage

- **Browser File System Access & IndexedDB**: Persistent, read-only local directory handle access with Web Worker recursive folder walking, ID3/Vorbis/MP4 metadata parsing, and cover-art caching. Each successful handle scan also retains lightweight `File` references for the current page session, so mobile playback loops do not depend on directory permission remaining granted after the tab is backgrounded.
- **Virtualized Library & Custom Queues**: Complete `@tanstack/react-virtual` list rendering for handling unlimited track lists without UI performance bottlenecks.
- **Local Directory Playlist Management**: Custom per-device song selection, track ordering, and persistent reshuffling.

### 🎙 AI Radio Host & Live Broadcasts

- **LLM Radio Scripting**: Groq-powered radio DJ prompts (`llama-3.3-70b-versatile`) generating Japanese and English station chatter.
- **Multi-Tier TTS Fallback Pipeline**: Google Gemini 3.1/2.5 Flash TTS → OpenRouter → Style-BERT-VITS2 → AnyVoiceLab.
- **DuckDuckGo Song Trivia Grounding**: Web-researched song history, album details, award context, and artist background with strict hallucination and prompt-injection guards.
- **DJ Memory & Immersion**: 10-song recent track memory and 5-announcement history for smooth DJ transitions, listener interaction prompts, and theme links.

### 📰 Scheduled Radio Segments

- **NHK News Briefings**: Real-time Japanese headline RSS fetcher with customizable focus targeting.
- **JMA Nationwide Weather**: Live 10-region Japan meteorological forecast with regional low/high temperature reports and evening precipitation guidance.
- **TomTom Orbis Traffic Updates**: Real-time Tokyo road traffic incident reporting and congestion alerts.
- **Jingles & Commercials**:
  - Independent shuffle bags for **Intro** (`public/Intro jingles/`) and **Outro** (`public/Outro Jingle/`) audio & MP4 video jingles with synchronized artwork display.
  - Folder-based MP3/MP4 sponsor ads and YouTube ad link integration (`public/ads/ads link.json`).
  - Automatic AnyVoiceLab sponsor credit generation matching the active ad.

### 🌐 International Live Radio

- **Live Station Directory**: Powered by [Radio Browser](https://www.radio-browser.info/) for live streams across Japan, China, and South Korea.

### 🎨 Visuals & Aesthetics

- **Modern Japanese Design System**: Custom Seigaiha (青海波) wave overlays and authentic Asanoha (麻の葉) Kumiko geometric lattice SVG backgrounds.
- **Responsive Player**: Mobile-optimized layout with adaptive vinyl disc visibility (`hidden sm:block`) on screens smaller than 640px.

---

## Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org) (App Router) + [React 19](https://react.dev)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com) + Vanilla CSS Design Tokens
- **Audio & Media**: Native HTML5 `<audio>` Dual Decks + `music-metadata` + `yt-dlp` (`youtube-dl-exec`)
- **AI & LLM**: [Groq](https://groq.com) (`llama-3.3-70b-versatile`)
- **Speech Synthesis (TTS)**: Google Gemini API (Gemini 3.1/2.5 Flash TTS), OpenRouter.ai, Style-BERT-VITS2, AnyVoiceLab
- **Live Data Feeds**: NHK News RSS, JMA Japan Weather API, TomTom Orbis Traffic Incidents API, Radio Browser API
- **Virtualization & Storage**: `@tanstack/react-virtual`, File System Access API, IndexedDB
- **Backend & Cloud**: Vercel Web / Google Cloud Run container execution

---

## File Tree

```
radio-ai/
├── public/
│   ├── audio/
│   │   └── bgm.mp3                    # loop BGM track for speech announcements
│   ├── Intro jingles/                 # shuffled intro audio/MP4 files
│   ├── Outro Jingle/                  # shuffled outro audio/MP4 files
│   └── ads/                           # local .mp3/.mp4 sponsor messages & ads link.json
├── src/
│   └── app/
│       ├── api/
│       │   ├── audio/[videoId]/       # YouTube audio stream extraction & proxy
│       │   ├── playlist/[playlistId]/ # YouTube playlist items endpoint
│       │   ├── radio/                 # International live station directory & metrics
│       │   ├── host/
│       │   │   ├── segment/route.ts   # POST — LLM+TTS speech segment generation
│       │   │   ├── jingle/route.ts    # GET  — streams random intro/outro jingle
│       │   │   └── ad/route.ts        # GET  — streams random folder/YouTube ad
│       │   └── local/                 # Local filesystem scanning, stream & cover endpoints
│       ├── components/
│       │   ├── InternationalRadio.tsx # Live radio browser & search tabs
│       │   ├── LiveRadioPlayer.tsx    # Stream player for live radio stations
│       │   ├── MusicPlayer.tsx        # Persistent two-deck streaming player with crossfades
│       │   ├── LocalPlaylistEditor.tsx # Per-device local queue ordering & filtering
│       │   ├── PlayerVisuals.tsx      # Audio spectrum & artwork visuals
│       │   └── SettingsModal.tsx      # Slide-over drawer for broadcast, sources & playback
│       ├── lib/
│       │   ├── groq.ts                # Groq LLM prompt builder & resilience wrappers
│       │   ├── tts.ts                 # Multi-provider TTS synthesis pipeline
│       │   ├── segments/              # News, Japan Weather, Traffic, Sponsor & Trivia modules
│       │   └── playlists.ts           # Saved playlists & localStorage persistence
│       ├── globals.css                # Seigaiha & Asanoha SVG background styles
│       └── page.tsx                   # Main radio queue orchestrator & state manager
├── android-auto/                      # Native Media3 phone + Android Auto client
├── CHANGELOG.md                       # Release history and updates
├── .env.local                         # Environment credentials & config
├── package.json
└── README.md
```

---

## Live Deployment

- Web application: [https://radio-ai-three.vercel.app](https://radio-ai-three.vercel.app)
- Backend: `https://radio-ai-backend-dktu4p5zqq-as.a.run.app`
- Vercel deploys the repository-root Next.js application; `services/backend` deploys only to Google Cloud Run.

The web page, short-lived session exchange, production CORS, and authenticated local media
were verified end to end. YouTube playback from Cloud Run is still not dependable because
representative playlist tracks trigger YouTube's data-center egress challenge. Local music,
live radio, TTS, jingles, and ads do not depend on that YouTube extraction path. See
[DEPLOYMENT.md](DEPLOYMENT.md) for current revisions, recovery steps, and promotion gates.

---

## Prerequisites

- Node.js 20+
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (required for YouTube playlists)
- A [Google AI Studio](https://aistudio.google.com/) API key (optional, for Gemini 3.1/2.5 Flash TTS)
- An [OpenRouter.ai](https://openrouter.ai/) API key (optional, for Gemini 3.1 Flash TTS fallback)
- A [TomTom Developer](https://developer.tomtom.com/) API key (optional, for traffic incident reports)

---

## Setup & Environment

1. **Clone & Install**:

   ```bash
   git clone <repo-url>
   cd radio-ai
   npm ci --legacy-peer-deps
   ```
2. **Configure Environment Variables (`.env.local`)**:

   ```env
   YOUTUBE_API_KEY=your_youtube_data_api_v3_key_here
   LOCAL_MUSIC_DIR=D:\Music

   # Personal web access (server-side only; optional locally)
   ENABLE_WEB_ACCESS_AUTH=false
   WEB_ACCESS_USERNAME=radio
   WEB_ACCESS_PASSWORD=replace-with-a-long-unique-password

   # Production web -> Cloud Run connection
   BACKEND_URL=https://radio-ai-backend-dktu4p5zqq-as.a.run.app
   BACKEND_SESSION_SECRET=replace-with-at-least-32-random-characters

   # AI Radio Host
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=llama-3.3-70b-versatile

   # Google Gemini API TTS
   GEMINI_API_KEY=your_google_ai_studio_api_key_here
   GEMINI_VOICE_NAME=Laomedeia
   GEMINI_VOICE_CHATTER=Laomedeia
   GEMINI_VOICE_NEWS=Erinome
   GEMINI_VOICE_WEATHER=Aoede
   GEMINI_VOICE_TRAFFIC=Pulcherrima

   # OpenRouter.ai API TTS (optional fallback)
   OPENROUTER_API_KEY=your_openrouter_api_key_here

   # Self-Hosted Style-Bert-VITS2 TTS (optional local fallback)
   STYLE_BERT_VITS2_URL=http://localhost:5000
   STYLE_BERT_VITS2_LANGUAGE=JP
   STYLE_BERT_VITS2_LANGUAGE_EN=EN

   # TomTom Traffic Incidents API (optional)
   TOMTOM_API_KEY=your_tomtom_api_key_here
   TOMTOM_BBOX=139.5,35.5,140.0,35.8
   TOMTOM_TIME_VALIDITY=present,future
   ```
3. **Run Development Server**:

   ```bash
   npm run dev
   ```

   Open `http://localhost:3000` in your browser.

---

## Android Auto

A standalone native Android and Android Auto client is available in the [Android client guide](android-auto/README.md). Its Compose phone player and Media3 car library use Room/DataStore, SAF music folders, direct device enrollment with the separately deployed backend, JP/CN/KR radio, and the complete AI-hosted show. It contains no WebView and does not require the website. Local debug builds export an APK under `android-auto/app/build/outputs/apk/debug/`.

Build artifacts are intentionally excluded from Git. Build the APK locally by following the
Android guide. Production infrastructure and recovery steps are documented in
[DEPLOYMENT.md](DEPLOYMENT.md); required follow-ups and future ideas are tracked in
[ROADMAP.md](ROADMAP.md).

---

## Usage & Features Overview

### ⚙ Settings Drawer

Open the **⚙ Settings** drawer (top-right of the page) to configure:

- **Broadcast**: Announcer language (Japanese/English), playback order (Full Radio Show vs. Classic Schedule), DJ memory, news focus, weather, traffic updates, ad frequency, and ReplayGain loudness normalization.
- **Sources**: Manage saved YouTube playlists or local folders, add new sources, or switch active channels.
- **Local Queue**: Recursively discovers supported audio beneath the selected root folder; filter by tags, subfolder, or filename, reorder tracks, and star up to ten favorites for a 10% extra-play chance per loop in Random mode.
- **International Radio**: Browse live streams across Japan, China, and South Korea.

### 📢 Advertisements & Sponsor Credits

- **Local Media**: Place `.mp3` or `.mp4` ad files in `public/ads/`. MP3 metadata tags and MP4 video artwork are read automatically.
- **YouTube Ad Links**: Add YouTube watch links or short URLs to `public/ads/ads link.json`:
  ```json
  {
    "links": [
      "https://youtu.be/izRd2eR5GOU",
      "https://www.youtube.com/watch?v=XCVz2V0tXbQ"
    ]
  }
  ```
- **Sponsor Voice Credits**: Every ad break is followed by a deterministic sponsor credit announcement generated via AnyVoiceLab that announces the exact title of the played ad.

---

## Scripts & Development

```bash
npm run dev      # Start dev server (http://localhost:3000)
npm run build    # Create production build
npm start        # Launch production server
npm run lint     # Run ESLint check
```

---

## License

Private / Proprietary. All rights reserved.
