# Vercel + Google Cloud Run deployment

## Current web deployment

| Setting | Value |
| --- | --- |
| Vercel project | `dwiyasanakulas-projects/radio-ai` |
| Production URL | `https://radio-ai-three.vercel.app` |
| GitHub repository | `Dwiyasa-Nakula/radio-ai` |
| Production branch | `main` |
| Framework / root | Next.js / repository root (`.`) |
| Install / build | `npm ci --legacy-peer-deps` / `npm run build` |
| Output directory | Next.js default |
| Vercel Node.js | `24.x` |

The production deployment was verified end to end: the page returned `200`,
`/api/backend/session` issued a scoped token, and an authenticated local media request to
Cloud Run returned `200` with `Access-Control-Allow-Origin` set to the production Vercel
origin. The Vercel project deploys only the root Next.js application. The Express workspace
at `services/backend` is not a Vercel service.

## Current production backend

| Setting | Value |
| --- | --- |
| Google Cloud project | `mirai-melody-radio-rqjoki` |
| Region | `asia-southeast1` (Singapore) |
| Cloud Run service | `radio-ai-backend` |
| Artifact Registry repository | `radio-ai` |
| Runtime service account | `radio-ai-backend-runtime@mirai-melody-radio-rqjoki.iam.gserviceaccount.com` |
| Canonical backend URL | `https://radio-ai-backend-dktu4p5zqq-as.a.run.app` |
| Production revision | `radio-ai-backend-00007-vol` |
| Allowed browser origin | `https://radio-ai-three.vercel.app` |

The current production revision is a CORS-only clone of the previous production image
(`radio-ai-backend-00003-kvf`); only `ALLOWED_ORIGINS` changed. The latest diagnostic image is
revision `radio-ai-backend-00010-los`, tagged `pot-canary`, and remains at 0% traffic because
representative playlist playback still hits YouTube's Cloud Run egress challenge. GitHub
backend deployment remains manual-only until Workload Identity Federation is configured.
Never put Android enrollment credentials, API keys, signing secrets, or service-account keys
in this repository.

The production deployment split is fixed: the Next.js web application deploys from the repository root to Vercel, and the stateful/heavy Node.js service in `services/backend` deploys to Google Cloud Run in `asia-southeast1`.

## Architecture

```text
Browser -> Vercel Next.js UI -> /api/backend/session (10-minute JWT)
        -> Cloud Run /v1 APIs (JWT) -> providers / yt-dlp / audio ranges
        -> browser directory handle -> local files (never uploaded)
Android -> Cloud Run /v1/mobile/session (Device credential; one-hour JWT)
        -> Cloud Run /v1 APIs + phone SAF folders (no website)
```

The browser calls Cloud Run directly after obtaining a scoped session from Vercel. YouTube audio therefore does not cross a Vercel Function payload boundary. Cloud Run is publicly reachable at the IAM layer, but every `/v1` route validates the application JWT; `/health` and `/readyz` are the only public data-free routes. The old Next.js host, playlist, audio, and radio handlers return 404 in production unless a self-hosted operator explicitly sets `ENABLE_LOCAL_BACKEND_API=true`.

PC filesystem routes under `/api/local/*` remain available only for local development or self-hosting. They are not part of the Cloud Run service and return 404 in production unless a self-hosted operator explicitly sets `ENABLE_LOCAL_FILESYSTEM_API=true`. In production, local music uses the File System Access API and IndexedDB entirely inside the browser.

## Cloud Run service

The OCI image is built from `services/backend/Dockerfile`. It listens on `0.0.0.0:$PORT` and exposes:

- `GET /health` (`/healthz` remains available outside Cloud Run's reserved edge path)
- `GET /readyz`
- `POST /v1/mobile/session`
- `POST /v1/host/segments`
- GET|HEAD /v1/host/bgm (authenticated speech background track with byte ranges)
- `GET /v1/host/jingles/random`
- `GET /v1/host/ads/random`
- `GET /v1/youtube/playlists/:playlistId`
- `GET /v1/youtube/videos/:videoId`
- `GET|HEAD /v1/youtube/audio/:videoId?quality=high|balanced|dataSaver`
- `GET /v1/radio/stations?country=JP|CN|KR&quality=...`
- `POST /v1/radio/click/:stationId`

The deployment settings are intentionally bounded:

| Setting | Value |
| --- | --- |
| Region | `asia-southeast1` |
| Execution environment | second generation |
| CPU / memory | `1 CPU / 1 GiB` |
| Concurrency | `4` |
| Request timeout | `300s` |
| Minimum / maximum instances | `0 / 2` |

All YouTube-resolution and DuckDuckGo research caches are disposable in-memory LRUs. Web research times out after three seconds and falls back to existing tags/source notes. Search excerpts are treated as untrusted input, limited to relevant HTTPS results, and never allowed to stop playback.

## Initial Google Cloud setup

1. Select a billing-enabled project and enable Cloud Run, Artifact Registry, Secret Manager, IAM Credentials, Security Token Service, Resource Manager, and Service Usage APIs.
2. Create a Docker Artifact Registry repository named `radio-ai` in `asia-southeast1`.
3. Create these Secret Manager secrets as applicable:
   `BACKEND_SESSION_SECRET`, `MOBILE_DEVICE_CREDENTIAL_HASHES`, `YOUTUBE_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, and `TOMTOM_API_KEY`.
4. Generate at least 32 random bytes for `BACKEND_SESSION_SECRET`. Store the identical value in Vercel and Secret Manager. Never expose it as a `NEXT_PUBLIC_*` variable.
   Generate one personal Android enrollment credential and store only its lowercase SHA-256 hash in the comma-separated `MOBILE_DEVICE_CREDENTIAL_HASHES` secret. Set `BACKEND_PUBLIC_URL` to the canonical Cloud Run/custom-domain URL.
5. Create a runtime service account with Secret Manager accessor on only the backend secrets.
6. For GitHub deployment, create a separate deployer service account with Cloud Run admin, Artifact Registry writer, and Service Usage Consumer. Grant it Service Account User on the runtime identity; do not use it as the runtime identity.
7. Configure a GitHub Workload Identity Federation provider restricted to `Dwiyasa-Nakula/radio-ai` and `refs/heads/main`.
8. Add these GitHub Actions secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT`, and `GCP_RUNTIME_SERVICE_ACCOUNT`.
9. Set GitHub Actions variable `VERCEL_ALLOWED_ORIGINS` to `https://radio-ai-three.vercel.app`. Add preview origins only when they are deliberately enabled; never use `*`.

`.github/workflows/deploy-backend.yml` tests, builds, pushes a commit-SHA image, and deploys that immutable image. It currently runs only through **Actions > Deploy backend to Cloud Run > Run workflow**. After the WIF bindings and repository values have been verified, a `push` trigger for `main` may be added deliberately. No long-lived Google service-account key is stored in GitHub.

## Manual backend deployment

Use this path for recovery or until GitHub WIF is enabled. It assumes Google Cloud SDK,
Docker Desktop, and an account authorized for the project.

```powershell
$projectId = 'mirai-melody-radio-rqjoki'
$region = 'asia-southeast1'
$service = 'radio-ai-backend'
$tag = git rev-parse HEAD
$image = "$region-docker.pkg.dev/$projectId/radio-ai/$service`:$tag"

gcloud auth login
gcloud config set project $projectId
gcloud auth configure-docker "$region-docker.pkg.dev" --quiet
docker build --file services/backend/Dockerfile --tag $image .

# Docker Desktop alternative: build the same image remotely with Cloud Build.
gcloud builds submit --config services/backend/cloudbuild.yaml --substitutions "_IMAGE=$image" .
docker push $image

gcloud run deploy $service `
  --image $image `
  --region $region `
  --execution-environment gen2 `
  --cpu 1 --memory 1Gi --concurrency 4 --timeout 300 `
  --min-instances 0 --max-instances 2 --port 8080 `
  --service-account "radio-ai-backend-runtime@$projectId.iam.gserviceaccount.com" `
  --allow-unauthenticated `
  --set-env-vars "ALLOWED_ORIGINS=https://radio-ai-three.vercel.app" `
  --set-secrets "BACKEND_SESSION_SECRET=BACKEND_SESSION_SECRET:latest,MOBILE_DEVICE_CREDENTIAL_HASHES=MOBILE_DEVICE_CREDENTIAL_HASHES:latest,YOUTUBE_API_KEY=YOUTUBE_API_KEY:latest,GROQ_API_KEY=GROQ_API_KEY:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,TOMTOM_API_KEY=TOMTOM_API_KEY:latest"
```

Replace `ALLOWED_ORIGINS` with exact comma-separated HTTPS origins when the website is
deployed. Do not use `*` with the credentialed browser session flow.

Verify the deployed URL returned by `gcloud run services describe`:

```powershell
$backendUrl = 'https://radio-ai-backend-dktu4p5zqq-as.a.run.app'
Invoke-RestMethod "$backendUrl/health"
Invoke-RestMethod "$backendUrl/readyz"
```

An invalid or missing credential must return `401`. A valid `POST /v1/mobile/session`
must return the canonical `baseUrl`, a scoped token, and an `expiresAt` value approximately
one hour in the future. Never print the token in CI logs.

## Android enrollment and credential rotation

Enter the canonical backend URL and the one-time raw enrollment credential in the native
app's Connection/Cache screen. The raw value is encrypted with Android Keystore; Google
Secret Manager stores only its lowercase SHA-256 hash.

To rotate or revoke a device, generate a new random credential, update the comma-separated
hash list in `MOBILE_DEVICE_CREDENTIAL_HASHES`, deploy a new Cloud Run revision that reads
the latest secret version, and enroll the phone with the new raw value. Remove the old hash
after confirming the replacement device works.

## Vercel setup

The repository is already linked to the `radio-ai` Vercel project and to GitHub. For a new
account or disaster recovery, import `Dwiyasa-Nakula/radio-ai` and use these exact settings:

| Setting | Value |
| --- | --- |
| Framework preset | Next.js |
| Root directory | Repository root (`.`); do not select `services/backend` |
| Install command | `npm ci --legacy-peer-deps` |
| Build command | `npm run build` |
| Output directory | Next.js default (leave blank) |

`vercel.json` pins the frontend-only framework and commands so Vercel's workspace detector
does not turn `services/backend` into a second Vercel service.

Configure these server-side variables for **Production**:

| Variable | Value / purpose |
| --- | --- |
| `BACKEND_URL` | `https://radio-ai-backend-dktu4p5zqq-as.a.run.app` (no trailing slash) |
| `BACKEND_SESSION_SECRET` | Sensitive; exactly the same 32+ character value as Google Secret Manager |
| `ENABLE_WEB_ACCESS_AUTH` | Set to `true` to enable the optional personal HTTP Basic gate; defaults to disabled |
| `WEB_ACCESS_USERNAME` | Personal HTTP Basic username; defaults to `radio` |
| `WEB_ACCESS_PASSWORD` | Sensitive; long unique password used when the gate is enabled |

Do not use a `NEXT_PUBLIC_` prefix. Provider credentials belong only in Cloud Run.
`ENABLE_WEB_ACCESS_AUTH=true` enables HTTP Basic authentication for the entire personal web app,
including `/api/backend/session`; without a backend session, callers cannot invoke TTS. Use a
long unique password over the production HTTPS URL. The browser remembers it for the browsing
session. Removing the variable disables this gate, which is convenient for local development
but is not recommended for the public Vercel deployment. This access password is independent
from `BACKEND_SESSION_SECRET` and must never reuse it.
`LOCAL_MUSIC_DIR` is meaningful only for local development/self-hosting and does not let a
Vercel Function read a user's computer. Environment-variable changes require a new Vercel
deployment.

After deployment, set Cloud Run `ALLOWED_ORIGINS` to the exact stable production domain:

```powershell
gcloud run deploy radio-ai-backend `
  --project mirai-melody-radio-rqjoki `
  --region asia-southeast1 `
  --image YOUR_VERIFIED_IMAGE `
  --update-env-vars "ALLOWED_ORIGINS=https://radio-ai-three.vercel.app" `
  --no-traffic --tag web-origin-canary
```

Test the tagged revision's preflight and an authenticated `/v1` request before shifting
traffic. Preview deployments require explicit preview origins; they are not currently
allowed. A successful browser-folder scan retains the worker-collected `File` objects in memory,
so playback and later loops in that page session do not re-query directory permission. A reload or
browser restart still clears that in-memory cache and may require permission renewal even though the
directory handle and scan metadata are stored in IndexedDB.

## Playback and privacy checks

- High is the default. It chooses the best browser-playable YouTube audio without preferring M4A and ranks radio by codec/bitrate.
- Balanced prefers M4A/AAC compatibility and popularity-based radio ordering.
- Data Saver targets YouTube and radio streams at or below 96 kbps, with fallbacks when none exist.
- FLAC, WAV, and every other local file stream from the original `File` or local server range route. Lossy sources are never presented as lossless and are never upsampled.
- Gemini TTS remains its native lossless 24 kHz, 16-bit mono PCM/WAV output.
- Only sanitized song metadata can be sent for researched chatter. File bytes, artwork, local paths, and directory handles remain in the browser.

## YouTube playback attestation

The current source and unpromoted candidate image pin `yt-dlp` (including its matching EJS challenge scripts) and `bgutil-ytdlp-pot-provider` to `2026.07.04`
and `1.3.1`. The container starts the provider on loopback port `4416`, waits for
`GET /ping`, and only then starts the API. `GET /readyz` reports
`youtubeProvider` as `ready`, `unavailable`, or `disabled`.

The extractor enables the container's Node 22 JavaScript runtime, uses the `mweb` client, and obtains a new video-bound PO token from
the local provider. If Cloud Run egress is challenged, it makes one cookie-free
`android_vr` fallback attempt. Provider stdout is suppressed because it includes
ephemeral token material. It does not use a YouTube account or cookies. After three
consecutive bot challenges, extraction pauses for five minutes and returns:

```json
{
  "error": "YouTube is temporarily unavailable",
  "code": "YOUTUBE_CHALLENGE",
  "retryable": true
}
```

Set `YOUTUBE_STREAMING_ENABLED=false` to launch without YouTube while retaining
local music, live radio, and host segments. A PO token reduces bot challenges but
cannot guarantee that YouTube will accept Cloud Run egress. Do not commit cookies
or add account credentials as an automatic fallback.

### Verified Cloud Run limitation (2026-08-06)

Revision `radio-ai-backend-00009-por` (commit `06ddd57`, Cloud Build `a5669c18-312f-4725-9a23-13fa082d05e3`) passed health/readiness and returned a valid
`206 audio/mp4` range for the control video `dQw4w9WgXcQ`. Multiple representative tracks
from the seeded playlist still returned structured `YOUTUBE_CHALLENGE` responses with both
`mweb` and `android_vr`. Updating from `2026.03.17` to current stable `2026.07.04` did not change this result. The earlier image resolved those tracks from a Cloud Build worker,
which isolates the remaining failure to Cloud Run egress reputation. Do not promote this
candidate as a complete YouTube fix. A clean self-hosted/VPS network or a carefully evaluated
outbound proxy is still required for dependable YouTube playback.

A separate 0%-traffic diagnostic revision, `radio-ai-backend-00010-los` (commit
`1950c82`, Cloud Build `812d85c4-ab1a-4cfd-a427-913ba40952b5`), replaced the forced clients
with yt-dlp's current default client selection. The same control returned `206 audio/mp4`, while
seeded-playlist video `wPnhaGWBnys` still returned `YOUTUBE_CHALLENGE`. No PO-token/provider
errors appeared in the revision logs. The default-client source experiment was therefore
reverted; changing clients is not a fix for the challenged Cloud Run egress IP.

Do not use anonymous public proxy lists in production. Their operators can observe traffic,
their addresses are commonly abused or blocked, and availability is not dependable. If a proxy
is evaluated, use a reputable authenticated provider, store its URL in Secret Manager, restrict
it to the YouTube extractor, and validate it first on a 0%-traffic revision.

A shared datacenter proxy is unlikely to improve on Cloud Run's data-center reputation. If Evomi
is evaluated, prefer an authenticated residential product and begin with one sticky session for
one canary instance. Each uncached video/quality currently makes one `mweb` extraction attempt
and at most one `android_vr` fallback; successful direct URLs remain cached until shortly before
upstream expiry. Monitor bandwidth and request counts in the provider dashboard before scaling.

To verify the image before promotion, confirm the provider and audio range path:

```bash
curl --fail http://127.0.0.1:8080/readyz
curl --fail --range 0-65535 \
  -H "Authorization: Bearer $BACKEND_TEST_TOKEN" \
  "http://127.0.0.1:8080/v1/youtube/audio/dQw4w9WgXcQ?quality=balanced" \
  --output /dev/null
```

## Private-link web deployment

An unlisted Vercel URL is a convenience boundary, not authentication. Anyone who
obtains the URL can request a short-lived backend session and consume configured
provider quotas. Keep Cloud Run at the documented maximum instance count, enable
billing alerts, and add real login enforcement before sharing the application
publicly.

Deploy Vercel from the repository root with only `BACKEND_URL` and
`BACKEND_SESSION_SECRET`. After the stable Vercel URL exists, set that exact HTTPS
origin in Cloud Run `ALLOWED_ORIGINS`; preview origins must be added explicitly.

## Release smoke tests

Run before promotion:

```bash
npm ci --legacy-peer-deps
npm test --workspace @radio-ai/backend
npm run typecheck
npm run typecheck:backend
npm run build
npm run build:backend
npm run lint
npm run test:e2e
```

Then verify:

1. `/health` and `/readyz` return 200.
2. An unauthenticated `/v1` request returns 401.
3. The production Vercel origin obtains /api/backend/session, passes CORS, and plays a
   local backend media asset. Test representative YouTube ranges separately; a structured
   YOUTUBE_CHALLENGE is a failed promotion gate, not a passing result.
4. Android obtains `/v1/mobile/session` with `Authorization: Device ...`; invalid and revoked credentials return 401, and the returned JWT expires in one hour.
5. All quality modes return distinct YouTube cache headers and expected radio ordering.
6. DuckDuckGo success, timeout/rate-limit, malformed, irrelevant, and injection-like snippets all leave playback usable.
7. A nested 1,000+ track browser folder can be searched and queued; duplicate filenames in different subfolders remain distinct; a changed file is reparsed.
8. A custom queue over 5,000 entries survives reload from IndexedDB.
9. FLAC/WAV response bytes hash identically to the source file.

## Rollback

Cloud Run images are tagged with the immutable Git commit SHA. To roll back, list revisions, then send all traffic to the last known-good revision:

```bash
gcloud run revisions list --service radio-ai-backend --region asia-southeast1
gcloud run services update-traffic radio-ai-backend --region asia-southeast1 --to-revisions REVISION_NAME=100
```

Current reference points:

- Web/CORS production: `radio-ai-backend-00007-vol`.
- Previous backend image without the Vercel origin: `radio-ai-backend-00003-kvf`.
- Latest diagnostic revision: `radio-ai-backend-00010-los` (`pot-canary`, 0%); its
  default-client source experiment was reverted after failing the representative-track probe.

For Vercel, promote the last known-good deployment from the dashboard or redeploy its commit. Backend and web rollbacks are independent; if a contract change requires both, roll the web back first, then Cloud Run. Rolling back to `00003-kvf` also removes the production Vercel origin and will break browser CORS.
### Speech BGM canary (2026-08-14)

The Android speech-BGM fallback is packaged in immutable image
`asia-southeast1-docker.pkg.dev/mirai-melody-radio-rqjoki/radio-ai/radio-ai-backend:bgm-4a316a4a2d24`
(Cloud Build `5b85934b-a512-469c-b74d-bd9b371ebe69`) and deployed as zero-traffic revision
`radio-ai-backend-00019-fah`, tagged `bgm-canary`.

Canary evidence:

- `/health`: `200`; `/readyz`: `200` with the YouTube provider ready.
- Unauthenticated `/v1/host/bgm`: `401`.
- Authenticated `bytes=0-1023` BGM request: `206 audio/mpeg`, 1,024 bytes, total size 8,945,229 bytes.
- YouTube control `dQw4w9WgXcQ`: `206 audio/webm`, 65,536-byte range.
- Fresh default-quality probes for recently successful production IDs `AXnqkVTFUqY` and `QK8BUygFR1U`: `503 YOUTUBE_CHALLENGE`, including a retry after the five-minute circuit cooldown.

The BGM image was therefore **not promoted**. Production remains 100% on
`radio-ai-backend-00017-xas`; `radio-ai-backend-00019-fah` remains at 0% for diagnosis.
Do not shift traffic until representative playlist audio returns `206` on a fresh revision.

### Bundled station-media canary (2026-08-15)

Rewritten application HEAD `c90ec48afb38a9cdf823818f11d7c6efe50cb489` built successfully as
Cloud Build `8fa60e8d-8d81-44d0-b722-25f08a7446d9` and deployed as zero-traffic revision
`radio-ai-backend-00020-vam`. Its BGM and YouTube control range passed, but intro,
outro, and ad endpoints returned `404` because the backend image contained only the
tracked placeholder files under `public`; the real station media was packaged only in
the Android assets.

Commit `83a0baa410edea0cd1cef3a82a96e4e5d6ee3d68` seeds the backend image from the
same committed Android manifest and media files. Cloud Build
`6eac3f14-579e-4dab-b53a-e44d8ea30c15` produced the immutable image, deployed as
zero-traffic revision `radio-ai-backend-00021-goq`, tagged `media-83a0baa`.

Fixed-canary evidence:

- `/health`: `200`; `/readyz`: `200` with the YouTube provider ready.
- Unauthenticated `/v1/host/bgm`: `401`.
- Authenticated 65,536-byte ranges: BGM `206 audio/mpeg`, intro jingle `206 video/mp4`,
  outro jingle `206 video/mp4`, and ad `206 audio/mpeg`.
- Ad description: `200` with a packaged local-file selection.
- YouTube metadata control: `200`.
- YouTube audio control `dQw4w9WgXcQ` and representative IDs `AXnqkVTFUqY` and
  `QK8BUygFR1U`: `503 YOUTUBE_CHALLENGE`.

The fixed media image was therefore **not promoted**. Production remains 100% on
`radio-ai-backend-00017-xas`; revisions `00020-vam` and `00021-goq` remain at 0%.
Promote only after fresh representative YouTube audio ranges return `206`.
