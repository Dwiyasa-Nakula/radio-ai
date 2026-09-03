import { readFile, stat } from 'node:fs/promises';
import { basename, extname, join, parse } from 'node:path';
import { parseFile } from 'music-metadata';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const MAX_METADATA_CACHE_ENTRIES = 64;

interface EmbeddedMetadata {
  signature: string;
  title: string;
  sponsor: string;
  thumbnail?: AdThumbnail;
}

interface JsonMetadata {
  title: string;
  sponsor: string;
  thumbnailFileName?: string;
}

export interface AdMetadata {
  title: string;
  sponsor: string;
  hasThumbnail: boolean;
}

export interface AdThumbnail {
  data: Uint8Array;
  contentType: string;
}

const embeddedCache = new Map<string, EmbeddedMetadata>();

function cleanTitle(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(CONTROL_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
    : '';
}

function cleanThumbnailFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(CONTROL_CHARACTERS, '').trim().slice(0, 260);
  if (!cleaned || basename(cleaned) !== cleaned || !IMAGE_CONTENT_TYPES[extname(cleaned).toLowerCase()]) {
    return undefined;
  }
  return cleaned;
}

export function adTitleFromFileName(fileName: string): string {
  const stem = parse(fileName).name;
  return cleanTitle(stem.replace(/[_-]+/g, ' ')) || 'Sponsor';
}

async function readJsonMetadata(filePath: string): Promise<JsonMetadata> {
  const parsed = JSON.parse(await readFile(filePath, 'utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { title: '', sponsor: '' };
  }
  const metadata = parsed as Record<string, unknown>;
  return {
    title: cleanTitle(metadata.title),
    sponsor: cleanTitle(metadata.sponsor),
    thumbnailFileName: cleanThumbnailFileName(metadata.thumbnail),
  };
}

async function readEmbeddedMetadata(filePath: string): Promise<EmbeddedMetadata> {
  const fileInfo = await stat(filePath);
  const signature = `${fileInfo.size}:${fileInfo.mtimeMs}`;
  const cached = embeddedCache.get(filePath);
  if (cached?.signature === signature) return cached;

  let title = '';
  let sponsor = '';
  let thumbnail: AdThumbnail | undefined;
  try {
    const metadata = await parseFile(filePath, { duration: false });
    title = cleanTitle(metadata.common.title);
    sponsor = cleanTitle(metadata.common.artist);
    const picture = metadata.common.picture?.find(
      (candidate) => candidate.data.length > 0 && candidate.format.startsWith('image/')
    );
    if (picture) {
      thumbnail = { data: picture.data, contentType: picture.format };
    }
  } catch {}

  const value = { signature, title, sponsor, thumbnail };
  embeddedCache.delete(filePath);
  embeddedCache.set(filePath, value);
  while (embeddedCache.size > MAX_METADATA_CACHE_ENTRIES) {
    const oldest = embeddedCache.keys().next().value as string | undefined;
    if (!oldest) break;
    embeddedCache.delete(oldest);
  }
  return value;
}

function entryByName(directoryEntries: string[], requested: string | undefined): string | undefined {
  if (!requested) return undefined;
  return directoryEntries.find((entry) => entry.toLocaleLowerCase() === requested.toLocaleLowerCase());
}

async function sidecarMetadata(
  directory: string,
  mediaFileName: string,
  directoryEntries: string[]
): Promise<{ json: JsonMetadata; automaticThumbnail?: string }> {
  const stem = parse(mediaFileName).name;
  const jsonFile = entryByName(directoryEntries, `${stem}.json`);
  const automaticThumbnail = directoryEntries.find((entry) => {
    const parsed = parse(entry);
    return parsed.name.toLocaleLowerCase() === stem.toLocaleLowerCase() && Boolean(IMAGE_CONTENT_TYPES[parsed.ext.toLowerCase()]);
  });

  let json: JsonMetadata = { title: '', sponsor: '' };
  if (jsonFile) {
    try { json = await readJsonMetadata(join(directory, jsonFile)); } catch {}
  }
  return { json, automaticThumbnail };
}

/**
 * Reads an ad's embedded Title and artwork. A same-basename JSON file can
 * override them with { "title": "...", "thumbnail": "poster.jpg" }.
 * A same-basename image is a simple artwork fallback.
 */
export async function resolveAdMetadata(
  directory: string,
  mediaFileName: string,
  directoryEntries: string[]
): Promise<AdMetadata> {
  const mediaPath = join(directory, mediaFileName);
  const [embedded, sidecars] = await Promise.all([
    readEmbeddedMetadata(mediaPath),
    sidecarMetadata(directory, mediaFileName, directoryEntries),
  ]);
  const explicitThumbnail = entryByName(directoryEntries, sidecars.json.thumbnailFileName);
  return {
    title: sidecars.json.title || embedded.title || adTitleFromFileName(mediaFileName),
    sponsor: sidecars.json.sponsor || embedded.sponsor || sidecars.json.title || embedded.title || adTitleFromFileName(mediaFileName),
    hasThumbnail: Boolean(explicitThumbnail || embedded.thumbnail || sidecars.automaticThumbnail),
  };
}

export async function resolveAdThumbnail(
  directory: string,
  mediaFileName: string,
  directoryEntries: string[]
): Promise<AdThumbnail | undefined> {
  const sidecars = await sidecarMetadata(directory, mediaFileName, directoryEntries);
  const explicitThumbnail = entryByName(directoryEntries, sidecars.json.thumbnailFileName);
  const thumbnailFile = explicitThumbnail ?? sidecars.automaticThumbnail;
  if (thumbnailFile) {
    return {
      data: await readFile(join(directory, thumbnailFile)),
      contentType: IMAGE_CONTENT_TYPES[extname(thumbnailFile).toLowerCase()],
    };
  }
  return (await readEmbeddedMetadata(join(directory, mediaFileName))).thumbnail;
}

export async function resolveAdTitle(
  directory: string,
  mediaFileName: string,
  directoryEntries: string[]
): Promise<string> {
  return (await resolveAdMetadata(directory, mediaFileName, directoryEntries)).title;
}
