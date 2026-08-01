import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { google, type youtube_v3 } from 'googleapis';
import { jwtVerify } from 'jose';
import type { AudioQuality, HostSegmentRequest, SongMetadata, YouTubeVideoMetadata } from '@radio-ai/contracts';
import {
  generateChatter,
  generateNews,
  generateTraffic,
  generateWeather,
  type DjMemoryInput,
  type GroqResult,
  type SongInfo,
} from '../../../src/app/lib/groq';
import { fetchRadioBrowserJson } from '../../../src/app/lib/radioBrowser';
import { MediaRotation } from '../../../src/app/lib/mediaRotation';
import {
  resolveAdMetadata,
  resolveAdThumbnail,
  type AdMetadata,
} from '../../../src/app/lib/segments/adMetadata';
import { loadAdLinkSources, resolveYouTubeAdMetadata } from '../../../src/app/lib/segments/adSources';

import { rankRadioStations } from '../../../src/app/lib/radioQuality';
import { fetchTopHeadlines } from '../../../src/app/lib/segments/news';
import { researchSong } from '../../../src/app/lib/segments/songResearch';
import { fetchTrafficIncidents } from '../../../src/app/lib/segments/traffic';
import { fetchJapanWeather } from '../../../src/app/lib/segments/weatherJapan';
import { buildSponsorScript, sanitizeSponsorBrand } from '../../../src/app/lib/segments/sponsor';
import { synthesize, synthesizeAnyVoice } from '../../../src/app/lib/tts';
import type { AnnouncerLanguage, RadioCountryCode, RadioStation, Track } from '../../../src/app/lib/types';
import {
  invalidateYouTubeAudio,
  resolveYouTubeAudio,
  type ResolvedYouTubeAudio,
} from '../../../src/app/lib/youtubeAudioCache';
import { findConfiguredAdFile, parseByteRange } from './adDelivery';
import {
  configuredCredentialHashes,
  credentialMatches,
  deviceCredentialFromAuthorization,
  issueMobileSession,
  normalizePublicBaseUrl,
} from './mobileAuth';

const PORT = Number(process.env.PORT ?? 8080);
const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{13,100}$/;
const STATION_ID_PATTERN = /^[a-f0-9-]{20,64}$/i;
const COUNTRY_CODES = new Set<RadioCountryCode>(['JP', 'CN', 'KR']);
const BROWSER_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS']);
const stationMediaRotation = new MediaRotation();
const RETRYABLE_UPSTREAM_STATUS = new Set([403, 410]);
const UNAVAILABLE_TITLES = new Set(['Deleted video', 'Private video']);
const mobileCredentialHashes = configuredCredentialHashes(process.env.MOBILE_DEVICE_CREDENTIAL_HASHES);

const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

interface RadioBrowserStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  country?: string;
  state?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  hls?: number;
  lastcheckok?: number;
}

type AuthorizedRequest = Request & { authScopes?: Set<string> };

function log(severity: 'INFO' | 'WARNING' | 'ERROR', event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ severity, event, timestamp: new Date().toISOString(), ...fields }));
}

function qualityFrom(value: unknown): AudioQuality {
  return value === 'balanced' || value === 'dataSaver' ? value : 'high';
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function safeHttpsUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function mapStation(station: RadioBrowserStation, countryCode: RadioCountryCode): RadioStation | null {
  const id = station.stationuuid?.trim();
  const name = station.name?.trim();
  const streamUrl = safeHttpsUrl(station.url_resolved || station.url);
  const codec = station.codec?.trim().toUpperCase() ?? '';
  if (!id || !name || !streamUrl || station.hls === 1 || station.lastcheckok === 0) return null;
  if (codec && !BROWSER_CODECS.has(codec)) return null;
  return {
    id,
    name,
    country: station.country?.trim() || countryCode,
    countryCode,
    state: station.state?.trim() || '',
    language: station.language?.trim() || '',
    tags: (station.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 6),
    codec,
    bitrate: Number.isFinite(station.bitrate) ? Math.max(0, station.bitrate ?? 0) : 0,
    lossless: false,
    favicon: safeHttpsUrl(station.favicon),
    homepage: safeHttpsUrl(station.homepage),
    streamUrl,
    votes: Number.isFinite(station.votes) ? Math.max(0, station.votes ?? 0) : 0,
  };
}

function requestSignal(request: Request, response: Response): AbortSignal {
  const controller = new AbortController();
  request.once('aborted', () => controller.abort(new DOMException('Client aborted', 'AbortError')));
  response.once('close', () => {
    if (!response.writableEnded) controller.abort(new DOMException('Client disconnected', 'AbortError'));
  });
  return controller.signal;
}

function tokenFor(request: Request): string | undefined {
  const authorization = request.header('authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return typeof request.query.token === 'string' ? request.query.token : undefined;
}

function authorize(requiredScope: string) {
  return async (request: AuthorizedRequest, response: Response, next: NextFunction) => {
    const secret = process.env.BACKEND_SESSION_SECRET;
    const token = tokenFor(request);
    if (!secret || secret.length < 32 || !token) {
      response.status(401).json({ error: 'A valid backend session is required' });
      return;
    }
    try {
      const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ['HS256'],
        issuer: ['radio-ai-vercel', 'radio-ai-mobile'],
        audience: 'radio-ai-backend',
      });
      const scopes = new Set(Array.isArray(verified.payload.scope) ? verified.payload.scope.filter((scope): scope is string => typeof scope === 'string') : []);
      if (!scopes.has(requiredScope)) {
        response.status(403).json({ error: 'Backend session does not grant this operation' });
        return;
      }
      const requestOrigin = request.header('origin');
      if (requestOrigin && verified.payload.origin && verified.payload.origin !== requestOrigin) {
        response.status(403).json({ error: 'Backend session origin does not match' });
        return;
      }
      request.authScopes = scopes;
      next();
    } catch (error) {
      log('WARNING', 'auth_rejected', { path: request.path, message: error instanceof Error ? error.message : String(error) });
      response.status(401).json({ error: 'Backend session expired or is invalid' });
    }
  };
}

function sanitizeSong(value: unknown): SongInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<SongMetadata>;
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 240) : '';
  const artist = typeof input.artist === 'string' ? input.artist.trim().slice(0, 240) : '';
  if (!title || !artist) return undefined;
  return {
    title,
    artist,
    album: typeof input.album === 'string' ? input.album.trim().slice(0, 240) : undefined,
    year: typeof input.year === 'number' && Number.isInteger(input.year) && input.year >= 1000 && input.year <= 3000 ? input.year : undefined,
    genre: Array.isArray(input.genre) ? input.genre.filter((entry): entry is string => typeof entry === 'string').slice(0, 8).map((entry) => entry.slice(0, 80)) : undefined,
    publishedAt: typeof input.publishedAt === 'string' ? input.publishedAt.slice(0, 80) : undefined,
    sourceNotes: typeof input.sourceNotes === 'string' ? input.sourceNotes.slice(0, 4200) : undefined,
  };
}

function sanitizeMemory(value: unknown): DjMemoryInput | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const memory = value as DjMemoryInput;
  return {
    songs: Array.isArray(memory.songs) ? memory.songs.slice(-10).flatMap((song) => {
      const clean = sanitizeSong(song);
      return clean ? [clean] : [];
    }) : [],
    announcements: Array.isArray(memory.announcements)
      ? memory.announcements.filter((line): line is string => typeof line === 'string').slice(-5).map((line) => line.slice(0, 500))
      : [],
  };
}

async function buildSegmentScript(body: HostSegmentRequest, signal: AbortSignal): Promise<GroqResult> {
  const language: AnnouncerLanguage = body.language === 'en' ? 'en' : 'ja';
  if (body.kind === 'sponsor') {
    const brand = sanitizeSponsorBrand(body.brand);
    return buildSponsorScript(brand, language);
  }

  if (body.kind === 'chatter') {
    const previousSong = sanitizeSong(body.previousSong);
    const nextSong = sanitizeSong(body.nextSong);
    if (!nextSong) throw new Error('Valid nextSong metadata is required');

    const discussionFocus = body.discussionFocus === 'previous' && previousSong
      ? 'previous'
      : body.discussionFocus === 'next'
        ? 'next'
        : 'transition';
    const researchTarget = discussionFocus === 'previous' ? previousSong : nextSong;

    if (body.researchedTrivia === true && researchTarget) {
      const research = await researchSong({
        title: researchTarget.title,
        artist: researchTarget.artist,
        album: researchTarget.album,
        year: researchTarget.year,
      });
      if (research) {
        researchTarget.sourceNotes = [researchTarget.sourceNotes, research]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4200);
      }
    }

    const currentTimeJst = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
    }).format(new Date());
    return generateChatter({
      previousSong,
      nextSong,
      discussionFocus,
      currentTimeJst,
      language,
      memory: sanitizeMemory(body.memory),
      listenerInteraction: body.listenerInteraction === true,
    }, signal);
  }
  if (body.kind === 'news') {
    const headlines = await fetchTopHeadlines(10, signal);
    if (!headlines.length) throw new Error('No NHK headlines available');
    return generateNews(headlines, typeof body.focus === 'string' ? body.focus.trim().slice(0, 160) : '', body.isPreroll, language, signal);
  }
  if (body.kind === 'weather') {
    return generateWeather(await fetchJapanWeather(signal), body.isPreroll, body.isNoon === true, language, signal);
  }
  if (!process.env.TOMTOM_API_KEY) throw new OptionalSegmentUnavailable('TOMTOM_API_KEY is not configured');
  const incidents = await fetchTrafficIncidents(6, signal, language);
  return generateTraffic({ incidents }, body.isPreroll, language, signal);
}

class OptionalSegmentUnavailable extends Error {}

async function streamLocalMedia(
  request: Request,
  response: Response,
  filePath: string,
  headers: Record<string, string>
): Promise<void> {
  const info = await stat(filePath);
  const requestedRange = request.header('range');
  const range = requestedRange ? parseByteRange(requestedRange, info.size) : undefined;
  if (requestedRange && !range) {
    response.set({
      'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes */' + info.size,
      'Cache-Control': 'no-store',
    });
    response.status(416).end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  response.set({
    ...headers,
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    'Cache-Control': 'no-store',
    ...(range ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + info.size } : {}),
  });
  response.status(range ? 206 : 200);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(filePath, { start, end }).pipe(response);
}

async function streamAdFile(
  request: Request,
  response: Response,
  directory: string,
  fileName: string,
  metadata: AdMetadata
): Promise<void> {
  const filePath = join(directory, fileName);
  const contentTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
  };
  await streamLocalMedia(request, response, filePath, {
    'Content-Type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'X-Ad-File': encodeURIComponent(fileName),
    'X-Ad-Title': encodeURIComponent(metadata.title),
    ...(metadata.hasThumbnail ? { 'X-Ad-Thumbnail': encodeURIComponent(fileName) } : {}),
  });
}

function copyUpstreamHeaders(response: Response, upstream: globalThis.Response, entry: ResolvedYouTubeAudio, cacheStatus: string) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('Content-Type', upstream.headers.get('content-type') || entry.contentType);
  response.setHeader('X-Audio-Cache', cacheStatus);
  response.setHeader('X-Audio-Quality', entry.quality);
  if (entry.codec) response.setHeader('X-Audio-Codec', entry.codec);
  if (entry.bitrate) response.setHeader('X-Audio-Bitrate', String(entry.bitrate));
  if (entry.sampleRate) response.setHeader('X-Audio-Sample-Rate', String(entry.sampleRate));
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
}

async function streamYoutubeAudio(request: Request, response: Response, videoId: string, quality: AudioQuality, forceRefresh = false): Promise<void> {
  const { entry, cacheStatus } = await resolveYouTubeAudio(videoId, quality, forceRefresh);
  const headers = new Headers(entry.requestHeaders);
  if (request.header('range')) headers.set('Range', request.header('range')!);
  headers.set('Accept-Encoding', 'identity');
  const upstream = await fetch(entry.url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
    cache: 'no-store',
    signal: requestSignal(request, response),
  });
  if (!forceRefresh && RETRYABLE_UPSTREAM_STATUS.has(upstream.status)) {
    await upstream.body?.cancel().catch(() => undefined);
    invalidateYouTubeAudio(videoId, quality);
    return streamYoutubeAudio(request, response, videoId, quality, true);
  }
  if (!upstream.ok && upstream.status !== 206) throw new Error(`Googlevideo ${upstream.status}`);
  response.status(upstream.status);
  copyUpstreamHeaders(response, upstream, entry, cacheStatus);
  if (request.method === 'HEAD' || !upstream.body) {
    response.end();
    return;
  }
  Readable.fromWeb(upstream.body as never).pipe(response);
}

const app = express();
app.set('trust proxy', 1);
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
app.disable('x-powered-by');
app.use(cors({
  origin(origin, callback) {
    if (!origin || configuredOrigins.includes(origin) || (process.env.NODE_ENV !== 'production' && configuredOrigins.length === 0)) callback(null, true);
    else callback(new Error('Origin is not allowed'));
  },
  exposedHeaders: ['X-Script', 'X-Tts-Provider', 'X-Llm-Model', 'X-Segment-Kind', 'X-Audio-Quality', 'X-Audio-Codec', 'X-Audio-Bitrate', 'X-Audio-Sample-Rate', 'X-Ad-File', 'X-Ad-Title', 'X-Ad-Thumbnail', 'X-Ad-YouTube-Id', 'X-Ad-Thumbnail-Url'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Range'],
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
}));
app.use(express.json({ limit: '64kb' }));
app.use((request, response, next) => {
  const startedAt = Date.now();
  response.on('finish', () => log('INFO', 'http_request', {
    method: request.method,
    path: request.path,
    status: response.statusCode,
    latencyMs: Date.now() - startedAt,
  }));
  next();
});

const healthHandler = (_request: Request, response: Response) => response.status(200).json({ ok: true });
app.get('/health', healthHandler);
app.get('/healthz', healthHandler);
app.get('/readyz', (_request, response) => {
  const ready = Boolean(
    process.env.BACKEND_SESSION_SECRET &&
    process.env.BACKEND_SESSION_SECRET.length >= 32 &&
    mobileCredentialHashes.length > 0 &&
    (process.env.NODE_ENV !== 'production' || configuredOrigins.length > 0)
  );
  response.status(ready ? 200 : 503).json({ ready });
});

app.post('/v1/mobile/session', async (request, response) => {
  const credential = deviceCredentialFromAuthorization(request.header('authorization'));
  if (!credentialMatches(credential, mobileCredentialHashes)) {
    response.setHeader('Cache-Control', 'no-store');
    response.status(401).json({ error: 'Device credential is invalid or revoked' });
    return;
  }
  const signingSecret = process.env.BACKEND_SESSION_SECRET ?? '';
  const configuredBaseUrl = normalizePublicBaseUrl(process.env.BACKEND_PUBLIC_URL ?? '');
  const requestBaseUrl = normalizePublicBaseUrl(request.protocol + '://' + request.get('host'));
  try {
    const session = await issueMobileSession(signingSecret, configuredBaseUrl || requestBaseUrl);
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json(session);
  } catch (error) {
    log('ERROR', 'mobile_session_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    response.status(503).json({ error: 'Mobile enrollment is not configured' });
  }
});

app.post('/v1/host/segments', authorize('host:generate'), async (request, response) => {
  const body = request.body as HostSegmentRequest;
  if (!body || !['chatter', 'news', 'weather', 'traffic', 'sponsor'].includes(body.kind)) {
    response.status(400).json({ error: 'Unsupported segment kind' });
    return;
  }
  const signal = requestSignal(request, response);
  if (body.kind === 'sponsor') {
    const brand = sanitizeSponsorBrand(body.brand);
    if (!brand) {
      response.status(400).json({ error: 'A sponsor brand is required' });
      return;
    }
    body.brand = brand;
  }

  try {
    const result = await buildSegmentScript(body, signal);
    const tts = body.kind === 'sponsor'
      ? await synthesizeAnyVoice(result.script, body.language === 'en' ? 'en' : 'ja', signal)
      : await synthesize(result.script, body.kind, signal, body.language === 'en' ? 'en' : 'ja');
    response.set({
      'Content-Type': tts.contentType,
      'Content-Length': String(tts.audio.byteLength),
      'Cache-Control': 'no-store',
      'X-Script': encodeURIComponent(result.script),
      'X-Tts-Provider': tts.provider,
      'X-Llm-Model': result.model,
      'X-Segment-Kind': body.kind,
    });
    response.status(200).send(Buffer.from(tts.audio));
  } catch (error) {
    if (error instanceof OptionalSegmentUnavailable) {
      response.status(204).end();
      return;
    }
    if (signal.aborted) {
      if (!response.headersSent) response.status(499).end();
      return;
    }
    log('ERROR', 'host_segment_failed', { kind: body.kind, message: error instanceof Error ? error.message : String(error) });
    response.status(502).json({ error: 'Host segment generation failed' });
  }
});

app.get('/v1/youtube/playlists/:playlistId', authorize('youtube:read'), async (request, response) => {
  const playlistId = routeParam(request.params.playlistId);
  if (!PLAYLIST_ID_PATTERN.test(playlistId)) {
    response.status(400).json({ error: 'Invalid playlist ID' });
    return;
  }
  try {
    const tracks: Track[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await youtube.playlistItems.list({ part: ['snippet'], playlistId, maxResults: 50, pageToken: nextPageToken });
      tracks.push(...(page.data.items ?? []).flatMap((item: youtube_v3.Schema$PlaylistItem) => {
        const snippet = item.snippet;
        const videoId = snippet?.resourceId?.videoId;
        const title = snippet?.title;
        if (!videoId || !title || UNAVAILABLE_TITLES.has(title)) return [];
        return [{
          id: `youtube:${videoId}`,
          source: 'youtube' as const,
          title,
          artist: snippet?.videoOwnerChannelTitle ?? 'Unknown',
          thumbnail: snippet?.thumbnails?.high?.url ?? '',
          audioUrl: `/v1/youtube/audio/${videoId}`,
          publishedAt: snippet?.publishedAt ?? undefined,
          sourceNotes: snippet?.description?.trim().slice(0, 1600) || undefined,
          lossless: false,
        }];
      }));
      nextPageToken = page.data.nextPageToken ?? undefined;
    } while (nextPageToken);
    response.setHeader('Cache-Control', 'no-store');
    response.json(tracks);
  } catch (error) {
    log('ERROR', 'youtube_playlist_failed', { playlistId, message: error instanceof Error ? error.message : String(error) });
    response.status(502).json({ error: 'Failed to fetch playlist data' });
  }
});

app.get('/v1/youtube/videos/:videoId', authorize('youtube:read'), async (request, response) => {
  const videoId = routeParam(request.params.videoId);
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    response.status(400).json({ error: 'Invalid video ID' });
    return;
  }
  try {
    const result = await youtube.videos.list({ part: ['snippet'], id: [videoId], maxResults: 1 });
    const snippet = result.data.items?.[0]?.snippet;
    if (!snippet?.title || UNAVAILABLE_TITLES.has(snippet.title)) {
      response.status(404).json({ error: 'YouTube video is unavailable' });
      return;
    }
    const metadata: YouTubeVideoMetadata = {
      videoId,
      title: snippet.title,
      thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.default?.url ?? '',
    };
    response.setHeader('Cache-Control', 'public, max-age=3600');
    response.status(200).json(metadata);
  } catch (error) {
    log('ERROR', 'youtube_video_failed', {
      videoId,
      message: error instanceof Error ? error.message : String(error),
    });
    response.status(502).json({ error: 'Failed to validate YouTube video' });
  }
});

app.all('/v1/youtube/audio/:videoId', authorize('youtube:stream'), async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.status(405).end();
    return;
  }
  const videoId = routeParam(request.params.videoId);
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    response.status(400).json({ error: 'Invalid video ID' });
    return;
  }
  try {
    await streamYoutubeAudio(request, response, videoId, qualityFrom(request.query.quality));
  } catch (error) {
    if (request.aborted) return;
    log('ERROR', 'youtube_audio_failed', { videoId, message: error instanceof Error ? error.message : String(error) });
    if (!response.headersSent) response.status(502).json({ error: 'Failed to resolve or stream YouTube audio' });
  }
});

app.get('/v1/radio/stations', authorize('radio:read'), async (request, response) => {
  const country = typeof request.query.country === 'string' ? request.query.country.toUpperCase() as RadioCountryCode : undefined;
  if (!country || !COUNTRY_CODES.has(country)) {
    response.status(400).json({ error: 'country must be JP, CN, or KR' });
    return;
  }
  const signal = requestSignal(request, response);
  try {
    const params = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: '500' });
    const raw = await fetchRadioBrowserJson<RadioBrowserStation[]>(`/json/stations/bycountrycodeexact/${country}?${params}`, signal);
    const stations: RadioStation[] = [];
    const ids = new Set<string>();
    const streams = new Set<string>();
    for (const candidate of raw) {
      const station = mapStation(candidate, country);
      if (!station || ids.has(station.id) || streams.has(station.streamUrl)) continue;
      ids.add(station.id);
      streams.add(station.streamUrl);
      stations.push(station);
    }
    const quality = qualityFrom(request.query.quality);
    response.set({ 'Cache-Control': 'public, max-age=300', 'X-Audio-Quality': quality });
    response.json(rankRadioStations(stations, quality).slice(0, 80));
  } catch (error) {
    if (signal.aborted) return;
    response.status(502).json({ error: error instanceof Error ? error.message : 'Station directory failed' });
  }
});

app.post('/v1/radio/click/:stationId', authorize('radio:read'), async (request, response) => {
  const stationId = routeParam(request.params.stationId);
  if (!STATION_ID_PATTERN.test(stationId)) {
    response.status(400).json({ error: 'Invalid station ID' });
    return;
  }
  try {
    await fetchRadioBrowserJson(`/json/url/${encodeURIComponent(stationId)}`, requestSignal(request, response));
  } catch {}
  response.status(204).end();
});

app.get('/v1/host/jingles/random', authorize('host:generate'), async (request, response) => {
  const requestedSlot = request.query.slot;
  const slot = requestedSlot === 'outro' ? 'outro' : 'intro';
  const folder = slot === 'intro' ? 'Intro jingles' : 'Outro Jingle';

  try {
    const directory = join(process.cwd(), 'public', folder);
    const files = (await readdir(directory)).filter((name) => /\.(mp3|mp4|wav|m4a|ogg|opus)$/i.test(name));
    if (!files.length) {
      response.status(404).json({ error: `No ${slot} jingles configured` });
      return;
    }

    const fileName = stationMediaRotation.pick(`jingle:${slot}`, files) as string;
    const filePath = join(directory, fileName);
    const contentTypes: Record<string, string> = {
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.ogg': 'audio/ogg',
      '.mp4': 'video/mp4',
      '.opus': 'audio/ogg',
      '.wav': 'audio/wav',
    };
    await streamLocalMedia(request, response, filePath, {
      'Content-Type': contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'X-Jingle-Slot': slot,
    });
  } catch {
    response.status(404).json({ error: `No ${slot} jingles configured` });
  }
});

app.get('/v1/host/ads/random', authorize('host:generate'), async (request, response) => {
  try {
    const directory = join(process.cwd(), 'public', 'ads');
    const entries = await readdir(directory);
    const files = entries.filter((name) => /\.(mp3|mp4)$/i.test(name));
    const thumbnailFor = typeof request.query.thumbnail === 'string' ? request.query.thumbnail : '';
    if (thumbnailFor) {
      const mediaFile = findConfiguredAdFile(files, thumbnailFor);
      const thumbnail = mediaFile
        ? await resolveAdThumbnail(directory, mediaFile, entries)
        : undefined;
      if (!thumbnail) {
        response.status(404).json({ error: 'Ad thumbnail not found' });
        return;
      }
      response.set({
        'Content-Type': thumbnail.contentType,
        'Content-Length': String(thumbnail.data.byteLength),
        'Cache-Control': 'no-store',
      });
      response.status(200).send(Buffer.from(thumbnail.data));
      return;
    }

    if (typeof request.query.file === 'string') {
      const fileName = findConfiguredAdFile(files, request.query.file);
      if (!fileName) {
        response.status(404).json({ error: 'Requested ad file is not configured' });
        return;
      }
      const metadata = await resolveAdMetadata(directory, fileName, entries);
      await streamAdFile(request, response, directory, fileName, metadata);
      return;
    }

    const links = await loadAdLinkSources(directory, entries);
    const sourceKeys = [
      ...files.map((file) => 'file:' + file),
      ...links.map((link) => 'youtube:' + link.videoId),
    ];
    if (!sourceKeys.length) {
      response.status(404).json({ error: 'No MP3, MP4, or YouTube ad links are configured' });
      return;
    }

    const describe = request.query.describe === '1';
    const sourceKey = stationMediaRotation.pick('ads', sourceKeys) as string;
    if (sourceKey.startsWith('youtube:')) {
      const videoId = sourceKey.slice('youtube:'.length);
      const source = links.find((link) => link.videoId === videoId);
      if (!source) {
        response.status(404).json({ error: 'Selected YouTube ad is unavailable' });
        return;
      }
      const metadata = await resolveYouTubeAdMetadata(source, requestSignal(request, response));
      if (describe) {
        response.set({ 'Cache-Control': 'no-store' });
        response.status(200).json({
          type: 'youtube',
          videoId: source.videoId,
          title: metadata.title,
          thumbnailUrl: metadata.thumbnailUrl,
        });
        return;
      }
      response.set({
        'Cache-Control': 'no-store',
        'X-Ad-Title': encodeURIComponent(metadata.title),
        'X-Ad-YouTube-Id': source.videoId,
        'X-Ad-Thumbnail-Url': encodeURIComponent(metadata.thumbnailUrl),
      });
      response.status(204).end();
      return;
    }

    const fileName = sourceKey.slice('file:'.length);
    const metadata = await resolveAdMetadata(directory, fileName, entries);
    if (describe) {
      response.set({ 'Cache-Control': 'no-store' });
      response.status(200).json({
        type: 'file',
        fileName,
        title: metadata.title,
        hasThumbnail: metadata.hasThumbnail,
      });
      return;
    }
    await streamAdFile(request, response, directory, fileName, metadata);
  } catch (error) {
    log('ERROR', 'host_ad_failed', { message: error instanceof Error ? error.message : String(error) });
    if (!response.headersSent) response.status(502).json({ error: 'Failed to resolve the selected ad' });
  }
});
app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : String(error);
  const corsRejected = message === 'Origin is not allowed';
  log(corsRejected ? 'WARNING' : 'ERROR', corsRejected ? 'cors_rejected' : 'unhandled_request_error', { message });
  if (!response.headersSent) {
    response.status(corsRejected ? 403 : 500).json({ error: corsRejected ? message : 'Internal backend error' });
  }
});

app.listen(PORT, '0.0.0.0', () => log('INFO', 'backend_started', { port: PORT }));
