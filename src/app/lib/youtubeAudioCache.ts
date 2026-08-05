import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import youtubeDl from 'youtube-dl-exec';
import type { AudioQuality } from './types';

const execFileAsync = promisify(execFile);
const bundledYoutubeDlBinary = (youtubeDl as typeof youtubeDl & { constants: { YOUTUBE_DL_PATH: string } }).constants.YOUTUBE_DL_PATH;
const youtubeDlBinary = process.env.YT_DLP_PATH?.trim() || bundledYoutubeDlBinary;

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
  quality: AudioQuality;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  lossless: false;
}

export const YOUTUBE_CHALLENGE_CODE = 'YOUTUBE_CHALLENGE';

export class YouTubeChallengeError extends Error {
  readonly code = YOUTUBE_CHALLENGE_CODE;
  readonly retryable = true;

  constructor(message = 'YouTube requires fresh playback attestation') {
    super(message);
    this.name = 'YouTubeChallengeError';
  }
}

export function isYouTubeChallengeError(error: unknown): boolean {
  if (error instanceof YouTubeChallengeError) return true;
  const candidate = error as { message?: unknown; stderr?: unknown };
  const message = [candidate?.message, candidate?.stderr]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return /confirm you(?:'|’)?re not a bot|sign in to confirm|po token|provider is not available/i.test(message);
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
  abr?: unknown;
  asr?: unknown;
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
  for (const [cacheKey, entry] of state.entries) {
    if (entry.expiresAt <= now) state.entries.delete(cacheKey);
  }

  while (state.entries.size > MAX_CACHE_ENTRIES) {
    const oldestKey = state.entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    state.entries.delete(oldestKey);
  }
}

export function youtubeFormatSelector(quality: AudioQuality): string {
  switch (quality) {
    case 'high':
      return 'bestaudio[protocol=https][vcodec=none]/bestaudio[protocol=https]/best[protocol=https]';
    case 'dataSaver':
      return 'bestaudio[abr<=96][protocol=https][vcodec=none]/bestaudio[abr<=128][protocol=https][vcodec=none]/bestaudio[protocol=https][vcodec=none]/best[protocol=https]';
    case 'balanced':
      return 'bestaudio[ext=m4a][protocol=https][vcodec=none]/bestaudio[protocol=https][vcodec=none]/best[ext=mp4][protocol=https]/best[protocol=https]';
  }
}

export function youtubeCacheKey(videoId: string, quality: AudioQuality): string {
  return `${videoId}:${quality}`;
}

type YouTubePlayerClient = 'mweb' | 'android_vr';

export function youtubeExtractorArguments(playerClient: YouTubePlayerClient = 'mweb'): string[] {
  const providerUrl = process.env.YOUTUBE_PO_PROVIDER_URL?.trim();
  return [
    '--js-runtimes',
    'node',
    '--extractor-args',
    'youtube:player_client=' + playerClient,
    ...(providerUrl && playerClient === 'mweb'
      ? ['--extractor-args', 'youtubepot-bgutilhttp:base_url=' + providerUrl]
      : []),
  ];
}

async function resolveFresh(videoId: string, quality: AudioQuality): Promise<ResolvedYouTubeAudio> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let stdout: string | undefined;
  let extractionError: unknown;
  const clients: YouTubePlayerClient[] = ['mweb', 'android_vr'];

  for (const playerClient of clients) {
    try {
      ({ stdout } = await execFileAsync(
        youtubeDlBinary,
        [
          watchUrl,
          '--dump-single-json',
          '--no-playlist',
          '--no-warnings',
          '--quiet',
          '--format',
          youtubeFormatSelector(quality),
          ...youtubeExtractorArguments(playerClient),
        ],
        {
          encoding: 'utf8',
          timeout: 30_000,
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024,
        }
      ));
      extractionError = undefined;
      break;
    } catch (error) {
      extractionError = error;
      if (!isYouTubeChallengeError(error)) break;
    }
  }

  if (!stdout) {
    if (isYouTubeChallengeError(extractionError)) throw new YouTubeChallengeError();
    throw extractionError;
  }
  const payload = JSON.parse(stdout) as YoutubeDlPayload;

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
    quality,
    codec: typeof payload.acodec === 'string' ? payload.acodec : undefined,
    bitrate: finitePositive(payload.abr),
    sampleRate: finitePositive(payload.asr),
    lossless: false,
  };

  const key = youtubeCacheKey(videoId, quality);
  state.entries.delete(key);
  state.entries.set(key, entry);
  pruneCache();
  return entry;
}

export async function resolveYouTubeAudio(
  videoId: string,
  quality: AudioQuality = 'high',
  forceRefresh = false
): Promise<{ entry: ResolvedYouTubeAudio; cacheStatus: 'HIT' | 'MISS' | 'COALESCED' }> {
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    throw new Error('Invalid video ID');
  }

  const key = youtubeCacheKey(videoId, quality);
  const cached = state.entries.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    // Refresh insertion order for simple LRU eviction.
    state.entries.delete(key);
    state.entries.set(key, cached);
    return { entry: cached, cacheStatus: 'HIT' };
  }

  if (forceRefresh) state.entries.delete(key);

  const active = state.inflight.get(key);
  if (active) {
    return {
      entry: await active,
      cacheStatus: 'COALESCED',
    };
  }

  const promise = resolveFresh(videoId, quality).finally(() => {
    if (state.inflight.get(key) === promise) {
      state.inflight.delete(key);
    }
  });
  state.inflight.set(key, promise);

  return {
    entry: await promise,
    cacheStatus: 'MISS',
  };
}

export function invalidateYouTubeAudio(videoId: string, quality?: AudioQuality): void {
  if (quality) {
    state.entries.delete(youtubeCacheKey(videoId, quality));
    return;
  }
  for (const key of state.entries.keys()) {
    if (key.startsWith(`${videoId}:`)) state.entries.delete(key);
  }
}
