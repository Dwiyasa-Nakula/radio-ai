import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_METADATA_CACHE_ENTRIES = 64;

export interface YouTubeAdSource {
  videoId: string;
  watchUrl: string;
}

export interface YouTubeAdMetadata {
  title: string;
  thumbnailUrl: string;
}

interface CachedMetadata extends YouTubeAdMetadata {
  expiresAt: number;
}

const metadataCache = new Map<string, CachedMetadata>();

function youtubeVideoId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLocaleLowerCase();
    let videoId = '';
    if (host === 'youtu.be') {
      videoId = url.pathname.split('/').filter(Boolean)[0] ?? '';
    } else if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (url.pathname === '/watch') videoId = url.searchParams.get('v') ?? '';
      else if (url.pathname.startsWith('/shorts/') || url.pathname.startsWith('/embed/')) {
        videoId = url.pathname.split('/').filter(Boolean)[1] ?? '';
      }
    }
    return VIDEO_ID_PATTERN.test(videoId) ? videoId : undefined;
  } catch {
    return undefined;
  }
}

export function parseAdLinkConfig(value: unknown): YouTubeAdSource[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const links = (value as Record<string, unknown>).links;
  if (!Array.isArray(links)) return [];
  const seen = new Set<string>();
  return links.flatMap((link) => {
    const videoId = youtubeVideoId(link);
    if (!videoId || seen.has(videoId)) return [];
    seen.add(videoId);
    return [{
      videoId,
      watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
    }];
  });
}

export async function loadAdLinkSources(
  directory: string,
  directoryEntries: string[]
): Promise<YouTubeAdSource[]> {
  const configName = directoryEntries.find(
    (entry) => entry.toLocaleLowerCase() === 'ads link.json'
  );
  if (!configName) return [];
  try {
    const value = JSON.parse(await readFile(join(directory, configName), 'utf8')) as unknown;
    return parseAdLinkConfig(value);
  } catch {
    return [];
  }
}

function cleanTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
    : '';
}

function youtubeThumbnail(value: unknown, videoId: string): string {
  if (typeof value === 'string') {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && (url.hostname === 'i.ytimg.com' || url.hostname.endsWith('.ytimg.com'))) {
        return url.toString();
      }
    } catch {}
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function pruneMetadataCache(): void {
  const now = Date.now();
  for (const [key, value] of metadataCache) {
    if (value.expiresAt <= now) metadataCache.delete(key);
  }
  while (metadataCache.size > MAX_METADATA_CACHE_ENTRIES) {
    const oldest = metadataCache.keys().next().value as string | undefined;
    if (!oldest) break;
    metadataCache.delete(oldest);
  }
}

export async function resolveYouTubeAdMetadata(
  source: YouTubeAdSource,
  signal?: AbortSignal
): Promise<YouTubeAdMetadata> {
  const cached = metadataCache.get(source.videoId);
  if (cached && cached.expiresAt > Date.now()) {
    metadataCache.delete(source.videoId);
    metadataCache.set(source.videoId, cached);
    return { title: cached.title, thumbnailUrl: cached.thumbnailUrl };
  }

  const url = new URL('https://www.youtube.com/oembed');
  url.searchParams.set('url', source.watchUrl);
  url.searchParams.set('format', 'json');
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`YouTube ad metadata failed: ${response.status}`);
  const payload = await response.json() as Record<string, unknown>;
  const title = cleanTitle(payload.title);
  if (!title) throw new Error('YouTube ad metadata did not contain a title');
  const metadata = {
    title,
    thumbnailUrl: youtubeThumbnail(payload.thumbnail_url, source.videoId),
    expiresAt: Date.now() + METADATA_TTL_MS,
  };
  metadataCache.delete(source.videoId);
  metadataCache.set(source.videoId, metadata);
  pruneMetadataCache();
  return { title: metadata.title, thumbnailUrl: metadata.thumbnailUrl };
}