# Vercel + Google Cloud Run deployment

## Current production backend

| Setting | Value |
| --- | --- |
| Google Cloud project | `mirai-melody-radio-rqjoki` |
| Region | `asia-southeast1` (Singapore) |
| Cloud Run service | `radio-ai-backend` |
| Artifact Registry repository | `radio-ai` |
| Runtime service account | `radio-ai-backend-runtime@mirai-melody-radio-rqjoki.iam.gserviceaccount.com` |
| Canonical backend URL | `https://radio-ai-backend-dktu4p5zqq-as.a.run.app` |

The current backend was deployed manually and is live. GitHub deployment is intentionally
manual-only until Workload Identity Federation and the repository secrets described below
are configured. Never put the Android enrollment credential, API keys, signing secret, or
service-account keys in this repository.

The production provider is fixed: the Next.js web application deploys from the repository root to Vercel, and the stateful/heavy Node.js service in `services/backend` deploys to Google Cloud Run in `asia-southeast1`.

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
9. Set GitHub Actions variable `VERCEL_ALLOWED_ORIGINS` to exact comma-separated production and preview origins. For Android-only operation use `https://localhost.invalid` until a website origin is available.

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
  --set-env-vars "ALLOWED_ORIGINS=https://localhost.invalid" `
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

Import the repository with the root directory unchanged and use Vercel's Git integration. Configure server-side variables for Production and Preview:

| Variable | Purpose |
| --- | --- |
| `BACKEND_URL` | Cloud Run service URL, without trailing slash |
| `BACKEND_SESSION_SECRET` | Same 32+ character value as Secret Manager |

Provider credentials belong only in Cloud Run after migration. `LOCAL_MUSIC_DIR` is meaningful only for local development/self-hosting and does not make a Vercel machine able to read the user's computer.

Deploy Cloud Run first, set `BACKEND_URL`, then promote the Vercel preview. Browser directory permission may require renewal after a browser restart even though the directory handle and scan metadata are stored in IndexedDB. Browsers without persistent directory handles use a clearly marked session-only directory-input fallback.

## Playback and privacy checks

- High is the default. It chooses the best browser-playable YouTube audio without preferring M4A and ranks radio by codec/bitrate.
- Balanced prefers M4A/AAC compatibility and popularity-based radio ordering.
- Data Saver targets YouTube and radio streams at or below 96 kbps, with fallbacks when none exist.
- FLAC, WAV, and every other local file stream from the original `File` or local server range route. Lossy sources are never presented as lossless and are never upsampled.
- Gemini TTS remains its native lossless 24 kHz, 16-bit mono PCM/WAV output.
- Only sanitized song metadata can be sent for researched chatter. File bytes, artwork, local paths, and directory handles remain in the browser.

## YouTube playback attestation

The backend image pins `yt-dlp` (including its matching EJS challenge scripts) and `bgutil-ytdlp-pot-provider` to `2026.3.17`
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
3. A Vercel preview obtains `/api/backend/session`, passes CORS, lists a YouTube playlist, and range-seeks audio.
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

For Vercel, promote the last known-good deployment from the dashboard or redeploy its commit. Backend and web rollbacks are independent; if a contract change requires both, roll the web back first, then Cloud Run.
