// src/app/api/host/segment/route.ts
import { NextResponse } from 'next/server';
import {
  generateChatter,
  generateNews,
  generateTraffic,
  generateWeather,
  type SongInfo,
} from '@/app/lib/groq';
import { synthesize } from '@/app/lib/tts';
import { fetchTopHeadlines } from '@/app/lib/segments/news';
import { fetchTokyoWeather } from '@/app/lib/segments/weather';
import { fetchTrafficIncidents } from '@/app/lib/segments/traffic';

interface ChatterBody {
  kind: 'chatter';
  previousSong?: SongInfo;
  nextSong: SongInfo;
}

interface NewsBody {
  kind: 'news';
  focus?: string;
}

interface SimpleKindBody {
  kind: 'weather' | 'traffic';
}

type SegmentBody = ChatterBody | NewsBody | SimpleKindBody;

async function buildScript(body: SegmentBody, signal: AbortSignal): Promise<string> {
  switch (body.kind) {
    case 'chatter':
      if (!body.nextSong?.title || !body.nextSong?.artist) {
        throw new Error('nextSong.title and nextSong.artist are required for chatter');
      }
      return generateChatter(
        { previousSong: body.previousSong, nextSong: body.nextSong },
        signal
      );

    case 'news': {
      const headlines = await fetchTopHeadlines(10, signal);
      if (headlines.length === 0) throw new Error('No NHK headlines available');
      return generateNews(headlines, body.focus, signal);
    }

    case 'weather': {
      const weather = await fetchTokyoWeather(signal);
      return generateWeather(weather, signal);
    }

    case 'traffic': {
      const incidents = await fetchTrafficIncidents(6, signal);
      return generateTraffic({ incidents }, signal);
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
  let body: SegmentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('kind' in body)) {
    return NextResponse.json({ error: 'Missing kind' }, { status: 400 });
  }

  if (!['chatter', 'news', 'weather', 'traffic'].includes(body.kind)) {
    return NextResponse.json({ error: 'Unsupported segment kind' }, { status: 400 });
  }
  if (body.kind === 'news' && body.focus !== undefined) {
    if (typeof body.focus !== 'string') {
      return NextResponse.json({ error: 'News focus must be a string' }, { status: 400 });
    }
    body.focus = body.focus.trim().slice(0, 160);
  }

  // Traffic is intentionally optional. A 204 tells the player to skip this
  // queue item without treating the missing ODPT key as a playback failure.
  if (body.kind === 'traffic' && !process.env.TOMTOM_API_KEY) {
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        'X-Segment-Skipped': 'TOMTOM_API_KEY is not set',
      },
    });
  }

  let script: string;
  try {
    request.signal.throwIfAborted();
    script = await buildScript(body, request.signal);
  } catch (err) {
    if (request.signal.aborted || isAbortError(err)) return abortedResponse();
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[host/segment ${body.kind}] script failed:`, message);
    return NextResponse.json({ error: `Script error: ${message}` }, { status: 502 });
  }

  let tts;
  try {
    request.signal.throwIfAborted();
    tts = await synthesize(script, body.kind, request.signal);
  } catch (err) {
    if (request.signal.aborted || isAbortError(err)) return abortedResponse();
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[host/segment ${body.kind}] TTS failed:`, message);
    return NextResponse.json({ error: `TTS error: ${message}`, script }, { status: 502 });
  }

  console.log(
    `[host/segment ${body.kind}] generated ${script.length}-char script, ${tts.audio.byteLength} bytes via ${tts.provider}`
  );

  return new Response(new Uint8Array(tts.audio), {
    headers: {
      'Content-Type': tts.contentType,
      'Content-Length': tts.audio.byteLength.toString(),
      'Cache-Control': 'no-store',
      'X-Script': encodeURIComponent(script),
      'X-Tts-Provider': tts.provider,
      'X-Segment-Kind': body.kind,
    },
  });
}
