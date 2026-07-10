# MirAI Melody FM

A web radio that streams from YouTube playlists, a local music library, or live international stations, with AI-hosted chatter and scheduled news, weather, traffic, and jingle breaks.

## Status

- [X] Fetch YouTube playlists via the Data API v3
- [X] Stream YouTube audio on demand via `yt-dlp`
- [X] Local music library scanning + ID3/Vorbis/MP4 metadata + cover art
- [X] Manage and switch between multiple sources from a settings panel (saved in `localStorage`)
- [X] Two-deck streaming player + autoplay + auto-advance + reshuffle on loop
- [X] Preload the next track while the current one plays
- [X] AI radio host between songs (Groq LLM + Gemini 3.1/2.5 Flash TTS / Style-Bert-VITS2 / AnyVoiceLab TTS)
- [X] Time-based segments (news / weather / traffic / jingles)
- [X] Acrylic blurred thumbnail background with a solid-color fallback
- [X] Clearer AI voice controls with independent news frequency and news focus
- [X] Cancel obsolete audio/TTS work when several songs are skipped rapidly
- [X] International live radio station list for Japan, China, and South Korea
- [X] Cache resolved yt-dlp stream URLs and proxy byte ranges for gapless handoff
- [X] Add background music for the TTS segments (with smooth volume fade-in/fade-out)
- [X] Gradient background with traditional Japanese Seigaiha wave motif overlay
- [ ] Package as a sideloaded Android Auto app

## Tech stack

- [Next.js 15](https://nextjs.org) (App Router) + [React 19](https://react.dev)
- [Tailwind CSS v4](https://tailwindcss.com)
- Native dual `<audio>` decks for streaming playback and next-track preloading
- [`youtube-dl-exec`](https://github.com/microlinkhq/youtube-dl-exec) wrapping a bundled `yt-dlp` binary to extract YouTube audio streams
- [`googleapis`](https://github.com/googleapis/google-api-nodejs-client) for the YouTube Data API v3
- [`music-metadata`](https://github.com/Borewit/music-metadata) for tag/cover-art extraction from local files
- [Groq](https://groq.com) for fast LLM inference (default: `llama-3.3-70b-versatile`)
- [Google Gemini API](https://aistudio.google.com/) (Gemini 3.1 Flash / 2.5 Flash TTS), [Style-Bert-VITS2](https://github.com/litagin02/Style-Bert-VITS2) (self-hosted), and [AnyVoiceLab](https://anyvoicelab.com) for Japanese TTS
- [NHK World RSS](https://www3.nhk.or.jp/nhkworld/en/news/feeds/) for news headlines
- [JMA](https://www.jma.go.jp/bosai/) for Tokyo weather forecasts
- [ODPT](https://developer.odpt.org) for Tokyo train delay data
- [Radio Browser](https://www.radio-browser.info/) for the international station directory
- [`fast-xml-parser`](https://github.com/NaturalIntelligence/fast-xml-parser) for RSS parsing
- TypeScript, Jest (configured, no tests yet)

## File tree

```
radio-ai/
├── public/
│   └── jingles/                       # drop .mp3/.m4a/.ogg/.wav files here for jingle slots
├── src/
│   └── app/
│       ├── api/
│       │   ├── audio/[videoId]/
│       │   │   └── route.ts           # streams YouTube audio for one video
│       │   ├── playlist/[playlistId]/
│       │   │   └── route.ts           # fetches YouTube playlist items as Track[]
│       │   ├── radio/
│       │   │   ├── stations/route.ts  # lists playable JP/CN/KR live stations
│       │   │   └── click/[stationId]/ # reports station plays to Radio Browser
│       │   ├── host/
│       │   │   ├── segment/route.ts   # POST — generates LLM+TTS for chatter/news/weather/traffic
│       │   │   └── jingle/route.ts    # GET  — streams a random file from public/jingles/
│       │   └── local/
│       │       ├── list/route.ts      # scans LOCAL_MUSIC_DIR, returns Track[] with metadata
│       │       ├── file/[id]/route.ts # streams a local file (with Range support)
│       │       └── cover/[id]/route.ts # serves embedded cover art
│       ├── components/
│       │   ├── InternationalRadio.tsx # country tabs, search, station list
│       │   ├── LiveRadioPlayer.tsx    # native player for endless live streams
│       │   ├── MusicPlayer.tsx        # persistent two-deck streaming player
│       │   └── SettingsModal.tsx      # source switcher + saved playlists + AI host toggle
│       ├── lib/
│       │   ├── groq.ts                # Groq wrapper — chatter, news, weather, traffic prompts
│       │   ├── localMusic.ts          # filesystem walker + path safety
│       │   ├── playlists.ts           # localStorage persistence + URL parsing
│       │   ├── tts.ts                 # TTS provider chain (SBV2 → AnyVoiceLab fallback)
│       │   ├── types.ts               # Track / RadioItem / HostSettings types
│       │   └── segments/
│       │       ├── news.ts            # NHK World RSS headline fetcher
│       │       ├── weather.ts         # JMA Tokyo forecast fetcher
│       │       └── traffic.ts         # TomTom Traffic incidents fetcher
│       ├── globals.css
│       ├── layout.tsx
│       └── page.tsx                   # queue builder, segment scheduling, current-track state
├── .env.local                         # YOUTUBE_API_KEY, LOCAL_MUSIC_DIR, TOMTOM_API_KEY, …
├── jest.config.ts
├── next.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Prerequisites

- Node.js 20+
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key (only needed for YouTube playlists)
- A [Google AI Studio](https://aistudio.google.com/) API key (optional, for Gemini 3.1/2.5 Flash TTS)

## Setup

1. Clone and install:

   ```bash
   git clone <repo-url>
   cd radio-ai
   npm install
   ```
2. Create `.env.local` in the project root:

   ```env
   YOUTUBE_API_KEY=your_youtube_data_api_v3_key_here
   LOCAL_MUSIC_DIR=D:\Music

   # AI radio host (optional — only needed if you enable the host in Settings)
   GROQ_API_KEY=your_groq_api_key_here
   GROQ_MODEL=llama-3.3-70b-versatile

   # Google Gemini API TTS (optional, falls back to Style-Bert-VITS2 / AnyVoiceLab if not set)
   GEMINI_API_KEY=your_google_ai_studio_api_key_here
   GEMINI_VOICE_NAME=Kore

   # TTS — prefer Style-Bert-VITS2 if running locally; otherwise falls back to AnyVoiceLab
   STYLE_BERT_VITS2_URL=http://localhost:5000
   STYLE_BERT_VITS2_LANGUAGE=JP
   STYLE_BERT_VITS2_SPEAKER_ID=0
   STYLE_BERT_VITS2_MODEL_ID=0

   # AnyVoiceLab fallback (rotates every ~24h — re-export from devtools when TTS starts 401-ing)
   ANYVOICELAB_NONCE=
   ANYVOICELAB_COOKIE=
   ANYVOICELAB_VOICE_ID=656306
   ANYVOICELAB_LANGUAGE=ja

   # TomTom Traffic incidents API (optional — only used if traffic updates are enabled in Settings)
   # Register at https://developer.tomtom.com to get a free API key.
   TOMTOM_API_KEY=
   TOMTOM_BBOX=139.5,35.5,140.0,35.8
   ```

   Only `YOUTUBE_API_KEY` is strictly required (and only if you use YouTube playlists). All AI-host vars are optional — the host stays disabled until you toggle it on in Settings. `TOMTOM_API_KEY` is only needed if you enable traffic updates.
3. Run the app and open the **⚙ Settings** dialog (top-right of the page) to:

   - Switch between **Local Files** and your saved YouTube playlists.
   - Open **International Radio** to browse live stations from Japan, China, and South Korea.
   - Add a new YouTube playlist by pasting either a full URL (`https://youtube.com/playlist?list=PL...`) or just the `PL...` ID, plus a friendly name.
   - Remove playlists you don't want anymore.

   Selections are persisted in `localStorage`, so your active source survives reloads. A default YouTube playlist is seeded the first time the app runs; remove or replace it freely.

## AI radio host

When enabled in Settings, chatter is inserted between every N songs:

1. The client POSTs the previous + next track metadata to `/api/host/segment`.
2. The server calls Groq with the radio-host system prompt (cozy late-night Japanese FM tone, 80–180 words, ends by announcing the next song's title and artist).
3. The script is sent to TTS — Gemini 3.1/2.5 Flash TTS first if GEMINI_API_KEY is configured, then Style-Bert-VITS2, and finally AnyVoiceLab.
4. The audio bytes come back to the client, get cached as a blob URL, and play through the same two-deck player as a regular song. The script is returned in the `X-Script` response header for debugging.

Frequency is configurable in Settings (every 1–5 songs). Chatter can be disabled independently while keeping news, weather, or traffic active. Each chatter segment shows a "🎙 Radio host — up next: ..." banner above the waveform with a "Skip" button.

### News, weather & traffic segments

| Segment    | Data source                                                                         | Auth             | How it triggers                                          |
| ---------- | ----------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------- |
| 📰 News    | [NHK World RSS](https://www3.nhk.or.jp/nhkworld/en/news/feeds/index.rss)             | None             | Morning preroll (5–11 AM), noon preroll (11 AM – 2 PM) |
| 🌤 Weather | [JMA Tokyo forecast](https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json) | None             | Morning preroll (5–11 AM)                               |
| 🚆 Traffic | [TomTom Traffic Incidents](https://developer.tomtom.com/traffic-api)                 | `TOMTOM_API_KEY` | Every N tracks (default 5; 0 = off)                      |

All three fetch live data, generate a Japanese script via Groq, and synthesize speech through the same TTS pipeline as chatter. Traffic is skipped silently if `TOMTOM_API_KEY` isn't set.

News can also run every 1–10 songs independently of the scheduled briefings. An optional **News focus** field tells the host to prioritize relevant items (for example, “Japan technology” or “Southeast Asia”) from the latest NHK World headline set. It remains constrained to the fetched headlines and does not invent matching stories.

Preroll is evaluated in Japan Standard Time when the app starts, the source changes, or host settings change. During morning hours, news + weather are prepended. During noon hours, just news. It is not repeated when the queue reshuffles, and time-boundary crossings are not detected mid-session.

### Jingles

Drop `.mp3`, `.m4a`, `.ogg`, `.wav`, or `.opus` files into `public/jingles/`. The jingle route picks one at random. Enable in Settings with the "Jingle every N tracks" slider (0 = off). No LLM or TTS involved — the audio file plays directly. If the folder has no supported files, the slot is skipped automatically.

## International live radio

Select **International Radio** in Settings to open a list-based station browser—there is no map UI. Country tabs are available for Japan, China, and South Korea.

The list can be searched by station name, region, language, or genre. Results come from the community-maintained [Radio Browser](https://www.radio-browser.info/) directory and are sorted by recent listener activity. The app discovers an available API mirror through Radio Browser's DNS service, filters out broken, HLS, non-HTTPS, and unsupported-codec entries, and reports station selections back to the directory.

Live stations use the browser's native audio element because a continuous broadcast never finishes downloading. Station availability and programming remain controlled by each broadcaster; if one stream is offline, select another station.

### About AnyVoiceLab

The fallback uses AnyVoiceLab's WordPress admin-ajax endpoint, which means `ANYVOICELAB_NONCE` and `ANYVOICELAB_COOKIE` are session credentials that rotate roughly every 24 hours. To export them: open `https://anyvoicelab.com/free-text-to-speech-converter/` in a browser, open DevTools → Network, generate any voice once, then copy the `tts_voice_nonce` value from the request payload and the full `Cookie` header into `.env.local`. Restart the dev server. When TTS starts 502-ing with auth errors, repeat. The proper fix is hosting Style-Bert-VITS2 yourself — once `STYLE_BERT_VITS2_URL` is set, AnyVoiceLab is only used if SBV2 errors out.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm start        # serve the production build
npm run lint     # eslint
```

## How it works

1. On load, `page.tsx` reads the saved playlist list and active source from `localStorage`. It then fetches `/api/playlist/[playlistId]` for YouTube sources, or `/api/local/list` for the local library. Both endpoints return a unified `Track[]` shape (`{ id, source, title, artist, thumbnail, audioUrl, ... }`).
2. The list is shuffled and stored as `trackQueue`. `currentIndex` tracks the active track.
3. `MusicPlayer` stays mounted and owns two native audio decks. The active deck plays the current item while the standby deck preloads the next item. At the active deck's `ended` event, playback starts on the standby deck before React advances the queue.
4. For YouTube, `/api/audio/[videoId]` asks `yt-dlp` for the direct Googlevideo media URL and required headers. The server caches the result until five minutes before the upstream `expire` timestamp and coalesces concurrent resolution requests for the same video.
5. The audio route proxies `Range` and `HEAD` requests, retries once with a fresh resolution after upstream 403/410 responses, and exposes `X-Audio-Cache` plus `X-Audio-Expires` response headers for diagnostics. Local files already provide Range support. Generated host segments and jingles remain short client-side blobs.
6. On `finish` (or the Next button), `currentIndex` advances. At the end of the queue the array is reshuffled and playback continues from the top.

## Roadmap notes

- **Sample-accurate transitions** — the two-deck player removes yt-dlp/decode startup pauses and starts the preloaded deck directly from `ended`. Exact sample-boundary continuity still depends on browser media scheduling and codec encoder padding.
- **Mid-session time boundary crossing** — currently preroll fires on queue build. Detecting that 7 AM arrived mid-session and injecting news/weather on the fly is a future pass.
- **xROAD highway data** — the xROAD API provides national road traffic counts (~2600 observation points). Not used yet because radio listeners care more about train delays, but can be swapped in if highway data is wanted.
- **Spotify** — official Web Playback SDK; would replace `yt-dlp` for users with a Spotify Premium account. Worth pairing with the Android Auto port since Spotify has first-class AA support.
- **Android Auto** — final form is a sideloaded native (Kotlin) app using the Car App Library, with this Next.js project acting as the backend (or a model for the on-device service). Personal use only — YouTube extraction is not Play-Store-shippable.
