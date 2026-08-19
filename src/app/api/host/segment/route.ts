// src/app/api/host/segment/route.ts
import { NextResponse } from 'next/server';
import {
  generateChatter,
  generateNews,
  generateTraffic,
  generateWeather,
  type SongInfo,
  type DjMemoryInput,
  type GroqResult,
} from '@/app/lib/groq';
import type { AnnouncerLanguage } from '@/app/lib/types';
import { synthesize, synthesizeAnyVoice, type TtsResult } from '@/app/lib/tts';
import { fetchTopHeadlines } from '@/app/lib/segments/news';
import { fetchJapanWeather } from '@/app/lib/segments/weatherJapan';
import { fetchTrafficIncidents } from '@/app/lib/segments/traffic';
import { buildSponsorScript, sanitizeSponsorBrand } from '@/app/lib/segments/sponsor';
import { researchSong } from '@/app/lib/segments/songResearch';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';
import { segmentCachePolicy, TimedPromiseCache } from '@/app/lib/segmentAudioCache';

interface ChatterBody {
  kind: 'chatter';
  previousSong?: SongInfo;
  nextSong: SongInfo;
  discussionFocus?: 'previous' | 'next' | 'transition';
  isPreroll?: boolean;
  language?: AnnouncerLanguage;
  memory?: DjMemoryInput;
  researchedTrivia?: boolean;
  listenerInteraction?: boolean;
}

interface NewsBody {
  kind: 'news';
  focus?: string;
  isPreroll?: boolean;
  language?: AnnouncerLanguage;
}

interface SimpleKindBody {
  kind: 'weather' | 'traffic';
  isPreroll?: boolean;
  isNoon?: boolean;
  language?: AnnouncerLanguage;
}

interface SponsorBody {
  kind: 'sponsor';
  brand: string;
  language?: AnnouncerLanguage;
}

type SegmentBody = ChatterBody | NewsBody | SimpleKindBody | SponsorBody;

interface GeneratedSegment {
  result: GroqResult;
  tts: TtsResult;
}

const segmentCache = new TimedPromiseCache<GeneratedSegment>();

function sanitizeSongInfo(value: SongInfo | undefined): SongInfo | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 240) : '';
  const artist = typeof value.artist === 'string' ? value.artist.trim().slice(0, 240) : '';
  if (!title || !artist) return undefined;
  return {
    title,
    artist,
    album: typeof value.album === 'string' ? value.album.trim().slice(0, 240) : undefined,
    year:
      typeof value.year === 'number' && Number.isInteger(value.year) && value.year >= 1000 && value.year <= 3000
        ? value.year
        : undefined,
    genre: Array.isArray(value.genre)
      ? value.genre.filter((entry): entry is string => typeof entry === 'string').slice(0, 8).map((entry) => entry.slice(0, 80))
      : undefined,
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt.slice(0, 80) : undefined,
    sourceNotes: typeof value.sourceNotes === 'string' ? value.sourceNotes.slice(0, 4200) : undefined,
  };
}

async function buildScript(body: SegmentBody, signal: AbortSignal): Promise<GroqResult> {
  switch (body.kind) {
    case 'sponsor': {
      const brand = sanitizeSponsorBrand(body.brand);
      return buildSponsorScript(brand, body.language === 'en' ? 'en' : 'ja');
    }

    case 'chatter': {
      if (!body.nextSong?.title || !body.nextSong?.artist) {
        throw new Error('nextSong.title and nextSong.artist are required for chatter');
      }

      const discussionFocus = body.discussionFocus ?? 'transition';
      const researchTargets = discussionFocus === 'previous'
        ? body.previousSong ? [body.previousSong] : []
        : discussionFocus === 'next'
          ? [body.nextSong]
          : [body.previousSong, body.nextSong].filter((song): song is SongInfo => Boolean(song));
      if (body.researchedTrivia === true) {
        await Promise.all(researchTargets.map(async (researchTarget) => {
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
        }));
      }
      const currentTimeJst = new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date());

      return generateChatter(
        {
          previousSong: body.previousSong,
          discussionFocus: body.discussionFocus,
          nextSong: body.nextSong,
          currentTimeJst,
          language: body.language,
          memory: body.memory,
          listenerInteraction: body.listenerInteraction,
        },
        signal
      );
    }

    case 'news': {
      const headlines = await fetchTopHeadlines(10, signal);
      if (headlines.length === 0) throw new Error('No NHK headlines available');
      return generateNews(headlines, body.focus, body.isPreroll, body.language, signal);
    }

    case 'weather': {
      const weather = await fetchJapanWeather(signal);
      return generateWeather(
        weather,
        body.isPreroll,
        body.isNoon === true,
        body.language,
        signal
      );
    }

    case 'traffic': {
      const incidents = await fetchTrafficIncidents(6, signal, body.language);
      return generateTraffic({ incidents }, body.isPreroll, body.language, signal);
    }
  }
}

function abortedResponse() {
  return new Response(null, {
    status: 499,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export async function POST(request: Request) {
  if (!legacyBackendApiEnabled()) {
    return NextResponse.json({ error: 'Use the Cloud Run backend in production' }, { status: 404 });
  }
  let body: SegmentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('kind' in body)) {
    return NextResponse.json({ error: 'Missing kind' }, { status: 400 });
  }

  if (!['chatter', 'news', 'weather', 'traffic', 'sponsor'].includes(body.kind)) {
    return NextResponse.json({ error: 'Unsupported segment kind' }, { status: 400 });
  }
  if (body.language !== undefined && body.language !== 'ja' && body.language !== 'en') {
    return NextResponse.json({ error: 'Unsupported announcer language' }, { status: 400 });
  }
  body.language = body.language === 'en' ? 'en' : 'ja';

  if (body.kind === 'sponsor') {
    const brand = sanitizeSponsorBrand(body.brand);
    if (!brand) {
      return NextResponse.json({ error: 'A sponsor brand is required' }, { status: 400 });
    }
    body.brand = brand;
  }

  if (body.kind === 'chatter') {
    body.nextSong = sanitizeSongInfo(body.nextSong) as SongInfo;
    body.previousSong = sanitizeSongInfo(body.previousSong);
    body.discussionFocus =
      body.discussionFocus === 'previous' || body.discussionFocus === 'next'
        ? body.discussionFocus
        : 'transition';
    if (!body.nextSong) {
      return NextResponse.json({ error: 'Valid nextSong metadata is required' }, { status: 400 });
    }
    body.listenerInteraction = body.listenerInteraction === true;
    if (body.memory && typeof body.memory === 'object') {
      body.memory = {
        songs: Array.isArray(body.memory.songs)
          ? body.memory.songs.slice(-10).map((song) => ({
              title: typeof song.title === 'string' ? song.title.slice(0, 240) : '',
              artist: typeof song.artist === 'string' ? song.artist.slice(0, 240) : '',
              album: typeof song.album === 'string' ? song.album.slice(0, 240) : undefined,
              year: typeof song.year === 'number' ? song.year : undefined,
              genre: Array.isArray(song.genre)
                ? song.genre.filter((value): value is string => typeof value === 'string').slice(0, 8)
                : undefined,
            })).filter((song) => song.title && song.artist)
          : [],
        announcements: Array.isArray(body.memory.announcements)
          ? body.memory.announcements
              .filter((value): value is string => typeof value === 'string')
              .slice(-5)
              .map((value) => value.slice(0, 500))
          : [],
      };
    } else {
      body.memory = undefined;
    }
  }
  if (body.kind === 'news' && body.focus !== undefined) {
    if (typeof body.focus !== 'string') {
      return NextResponse.json({ error: 'News focus must be a string' }, { status: 400 });
    }
    body.focus = body.focus.trim().slice(0, 160);
  }

  // Traffic is intentionally optional. A 204 tells the player to skip this
  // queue item without treating the missing TomTom key as a playback failure.
  if (body.kind === 'traffic' && !process.env.TOMTOM_API_KEY) {
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        'X-Segment-Skipped': 'TOMTOM_API_KEY is not set',
      },
    });
  }

  const policy = segmentCachePolicy(body);
  const generate = async (): Promise<GeneratedSegment> => {
    const generationSignal = policy ? AbortSignal.timeout(120_000) : request.signal;
    const result = await buildScript(body, generationSignal);
    const tts = body.kind === 'sponsor'
      ? await synthesizeAnyVoice(result.script, body.language, generationSignal)
      : await synthesize(result.script, body.kind, generationSignal, body.language);
    return { result, tts };
  };

  try {
    request.signal.throwIfAborted();
    const cached = policy
      ? await segmentCache.getOrCreate(policy.key, policy.ttlMs, generate)
      : { value: await generate(), status: 'BYPASS' as const };
    if (request.signal.aborted) return abortedResponse();
    const { result, tts } = cached.value;

    console.log(
      `[host/segment ${body.kind}] ${cached.status.toLowerCase()} ${result.script.length}-char script via ${result.model}, ${tts.audio.byteLength} bytes via ${tts.provider}`
    );

    return new Response(new Uint8Array(tts.audio), {
      headers: {
        'Content-Type': tts.contentType,
        'Content-Length': tts.audio.byteLength.toString(),
        'Cache-Control': 'no-store',
        'X-Script': encodeURIComponent(result.script),
        'X-Tts-Provider': tts.provider,
        'X-Llm-Model': result.model,
        'X-Segment-Kind': body.kind,
        'X-Segment-Cache': cached.status,
      },
    });
  } catch (err) {
    if (request.signal.aborted || isAbortError(err)) return abortedResponse();
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[host/segment ${body.kind}] generation failed:`, message);
    return NextResponse.json({ error: `Segment generation error: ${message}` }, { status: 502 });
  }
}
