import { NextResponse } from 'next/server';
import {
  invalidateYouTubeAudio,
  resolveYouTubeAudio,
  type ResolvedYouTubeAudio,
} from '@/app/lib/youtubeAudioCache';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ videoId: string }>;
}

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const RETRYABLE_UPSTREAM_STATUS = new Set([403, 410]);

function resolutionHeaders(
  entry: ResolvedYouTubeAudio,
  cacheStatus: string
): HeadersInit {
  return {
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'Content-Type': entry.contentType,
    'X-Audio-Cache': cacheStatus,
    'X-Audio-Expires': new Date(entry.expiresAt).toISOString(),
  };
}

function upstreamHeaders(entry: ResolvedYouTubeAudio, request: Request): Headers {
  const headers = new Headers(entry.requestHeaders);
  const range = request.headers.get('range');
  if (range) headers.set('Range', range);
  headers.set('Accept-Encoding', 'identity');
  return headers;
}

function responseHeaders(
  upstream: Response,
  entry: ResolvedYouTubeAudio,
  cacheStatus: string
): Headers {
  const headers = new Headers(resolutionHeaders(entry, cacheStatus));
  for (const name of [
    'content-length',
    'content-range',
    'content-type',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function proxyResolvedAudio(
  request: Request,
  videoId: string,
  forceRefresh = false
): Promise<Response> {
  const { entry, cacheStatus } = await resolveYouTubeAudio(videoId, forceRefresh);
  const upstream = await fetch(entry.url, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: upstreamHeaders(entry, request),
    redirect: 'follow',
    signal: request.signal,
    cache: 'no-store',
  });

  if (!forceRefresh && RETRYABLE_UPSTREAM_STATUS.has(upstream.status)) {
    upstream.body?.cancel().catch(() => undefined);
    invalidateYouTubeAudio(videoId);
    return proxyResolvedAudio(request, videoId, true);
  }

  if (!upstream.ok && upstream.status !== 206) {
    const body = await upstream.text().catch(() => '');
    throw new Error(
      `Googlevideo ${upstream.status}: ${body.slice(0, 160)}`
    );
  }

  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream, entry, cacheStatus),
  });
}

async function handle(request: Request, context: RouteContext) {
  const { videoId } = await context.params;
  if (!VIDEO_ID_PATTERN.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  try {
    return await proxyResolvedAudio(request, videoId);
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[audio ${videoId}]`, message);
    return NextResponse.json(
      { error: 'Failed to resolve or stream YouTube audio' },
      { status: 502 }
    );
  }
}

export async function GET(request: Request, context: RouteContext) {
  return handle(request, context);
}

export async function HEAD(request: Request, context: RouteContext) {
  return handle(request, context);
}
