import youtubeDl from 'youtube-dl-exec';

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;
const EXPIRY_SAFETY_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;

export interface ResolvedYouTubeAudio {
  videoId: string;
  url: string;
  contentType: string;
  contentLength?: number;
  duration?: number;
  requestHeaders: Record<string, string>;
  resolvedAt: number;
  expiresAt: number;
}

interface YoutubeDlPayload {
  url?: unknown;
  ext?: unknown;
  acodec?: unknown;
  vcodec?: unknown;
  filesize?: unknown;
  filesize_approx?: unknown;
  duration?: unknown;
  http_headers?: unknown;
}

interface CacheState {
  entries: Map<string, ResolvedYouTubeAudio>;
  inflight: Map<string, Promise<ResolvedYouTubeAudio>>;
}

declare global {
  // eslint-disable-next-line no-var
  var __radioAiYoutubeAudioCache: CacheState | undefined;
}

const state: CacheState =
  globalThis.__radioAiYoutubeAudioCache ??
  {
    entries: new Map(),
    inflight: new Map(),
  };

globalThis.__radioAiYoutubeAudioCache = state;

function contentTypeFor(payload: YoutubeDlPayload): string {
  const ext = typeof payload.ext === 'string' ? payload.ext.toLowerCase() : '';
  const hasVideo =
    typeof payload.vcodec === 'string' &&
    payload.vcodec !== 'none';

  if (ext === 'webm') return hasVideo ? 'video/webm' : 'audio/webm';
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
  return hasVideo ? 'video/mp4' : 'audio/mp4';
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function parseExpiry(url: URL, now: number): number {
  const rawExpiry = Number(url.searchParams.get('expire'));
  const upstreamExpiry =
    Number.isFinite(rawExpiry) && rawExpiry > 0
      ? rawExpiry * 1000 - EXPIRY_SAFETY_MS
      : now + FALLBACK_TTL_MS;

  return Math.max(now + 60_000, upstreamExpiry);
}

function sanitizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const allowed = ['User-Agent', 'Accept', 'Accept-Language', 'Referer', 'Origin'];
  const output: Record<string, string> = {};

  for (const name of allowed) {
    const headerValue = input[name];
    if (typeof headerValue === 'string' && headerValue.trim()) {
      output[name] = headerValue;
    }
  }
  return output;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [videoId, entry] of state.entries) {
    if (entry.expiresAt <= now) state.entries.delete(videoId);
  }

  while (state.entries.size > MAX_CACHE_ENTRIES) {
    const oldestKey = state.entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    state.entries.delete(oldestKey);
  }
}

async function resolveFresh(videoId: string): Promise<ResolvedYouTubeAudio> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const flags = {
    dumpSingleJson: true,
    noPlaylist: true,
    noWarnings: true,
    quiet: true,
    format: 'bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]/best[ext=mp4][protocol=https]/best[protocol=https]',
    extractorArgs: 'youtube:player_client=android',
  } as Parameters<typeof youtubeDl.exec>[1];
  const rawPayload = await youtubeDl(
    watchUrl,
    flags,
    { timeout: 30_000 }
  );
  const payload = rawPayload as YoutubeDlPayload;

  if (typeof payload.url !== 'string' || !payload.url.trim()) {
    throw new Error('yt-dlp returned no direct media URL');
  }

  const directUrl = new URL(payload.url);
  if (directUrl.protocol !== 'https:') {
    throw new Error(`yt-dlp returned unsupported protocol: ${directUrl.protocol}`);
  }

  const now = Date.now();
  const entry: ResolvedYouTubeAudio = {
    videoId,
    url: directUrl.toString(),
    contentType: contentTypeFor(payload),
    contentLength:
      finitePositive(payload.filesize) ??
      finitePositive(payload.filesize_approx),
    duration: finitePositive(payload.duration),
    requestHeaders: sanitizeHeaders(payload.http_headers),
    resolvedAt: now,
    expiresAt: parseExpiry(directUrl, now),
  };

  state.entries.delete(videoId);
  state.entries.set(videoId, entry);
  pruneCache();
  return entry;
}

export async function resolveYouTubeAudio(
  videoId: string,
  forceRefresh = false
): Promise<{ entry: ResolvedYouTubeAudio; cacheStatus: 'HIT' | 'MISS' | 'COALESCED' }> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('Invalid video ID');
  }

  const cached = state.entries.get(videoId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    // Refresh insertion order for simple LRU eviction.
    state.entries.delete(videoId);
    state.entries.set(videoId, cached);
    return { entry: cached, cacheStatus: 'HIT' };
  }

  if (forceRefresh) state.entries.delete(videoId);

  const active = state.inflight.get(videoId);
  if (active) {
    return {
      entry: await active,
      cacheStatus: 'COALESCED',
    };
  }

  const promise = resolveFresh(videoId).finally(() => {
    if (state.inflight.get(videoId) === promise) {
      state.inflight.delete(videoId);
    }
  });
  state.inflight.set(videoId, promise);

  return {
    entry: await promise,
    cacheStatus: 'MISS',
  };
}

export function invalidateYouTubeAudio(videoId: string): void {
  state.entries.delete(videoId);
}
