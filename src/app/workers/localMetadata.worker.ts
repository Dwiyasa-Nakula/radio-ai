/// <reference lib="webworker" />

import { parseBlob } from 'music-metadata';
import type { Track } from '../lib/types';

const DB_NAME = 'radio-ai-browser-data';
const DB_VERSION = 2;
const METADATA_STORE = 'local-track-metadata';
const AUDIO_EXTENSIONS = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'webm']);
const LOSSLESS_EXTENSIONS = new Set(['flac', 'wav']);

interface FileCandidate {
  file: File;
  relativePath: string;
}

interface MetadataRecord {
  cacheKey: string;
  directoryId: string;
  relativePath: string;
  fileSize: number;
  lastModified: number;
  track: Track;
}

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

type ScanMessage =
  | { type: 'scan-handle'; requestId: string; directoryId: string; handle: FileSystemDirectoryHandle }
  | { type: 'scan-files'; requestId: string; directoryId: string; files: FileCandidate[] };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('directory-handles')) {
        database.createObjectStore('directory-handles');
      }
      if (!database.objectStoreNames.contains('playlist-queues')) {
        database.createObjectStore('playlist-queues', { keyPath: 'playlistId' });
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open metadata cache'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Metadata cache request failed'));
  });
}

async function getCached(cacheKey: string): Promise<MetadataRecord | undefined> {
  const database = await openDatabase();
  try {
    return await requestResult(
      database.transaction(METADATA_STORE, 'readonly').objectStore(METADATA_STORE).get(cacheKey)
    );
  } finally {
    database.close();
  }
}

async function putCached(record: MetadataRecord): Promise<void> {
  const database = await openDatabase();
  try {
    await requestResult(
      database.transaction(METADATA_STORE, 'readwrite').objectStore(METADATA_STORE).put(record)
    );
  } finally {
    database.close();
  }
}

function extensionFor(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

function titleFromFilename(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.[^.]+$/, '');
}

function trackId(directoryId: string, relativePath: string): string {
  return `local:browser:${directoryId}:${encodeURIComponent(relativePath)}`;
}

async function parseCandidate(candidate: FileCandidate, directoryId: string): Promise<Track> {
  const { file, relativePath } = candidate;
  const cacheKey = `${directoryId}\u0000${relativePath}`;
  const cached = await getCached(cacheKey);
  if (
    cached &&
    cached.fileSize === file.size &&
    cached.lastModified === file.lastModified
  ) {
    return cached.track;
  }

  const ext = extensionFor(relativePath);
  let track: Track;
  try {
    const metadata = await parseBlob(file, { duration: true, skipCovers: true });
    const format = metadata.format;
    const codec = format.codec || ext.toUpperCase();
    track = {
      id: trackId(directoryId, relativePath),
      source: 'local',
      title: metadata.common.title?.trim() || titleFromFilename(relativePath),
      artist: metadata.common.artist?.trim() || 'Unknown artist',
      album: metadata.common.album?.trim() || undefined,
      year: metadata.common.year,
      genre: metadata.common.genre?.filter(Boolean).slice(0, 8),
      duration: format.duration,
      thumbnail: '',
      audioUrl: '',
      codec,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
      sampleRate: format.sampleRate,
      bitDepth: format.bitsPerSample,
      lossless: format.lossless ?? LOSSLESS_EXTENSIONS.has(ext),
      fileSize: file.size,
      lastModified: file.lastModified,
      relativePath,
      directoryHandleId: directoryId,
    };
  } catch {
    track = {
      id: trackId(directoryId, relativePath),
      source: 'local',
      title: titleFromFilename(relativePath),
      artist: 'Unknown artist',
      thumbnail: '',
      audioUrl: '',
      codec: ext.toUpperCase(),
      lossless: LOSSLESS_EXTENSIONS.has(ext),
      fileSize: file.size,
      lastModified: file.lastModified,
      relativePath,
      directoryHandleId: directoryId,
      sourceNotes: 'Audio tags could not be read; filename metadata is shown.',
    };
  }

  await putCached({
    cacheKey,
    directoryId,
    relativePath,
    fileSize: file.size,
    lastModified: file.lastModified,
    track,
  });
  return track;
}

async function collectHandleFiles(
  directory: FileSystemDirectoryHandle,
  prefix = ''
): Promise<FileCandidate[]> {
  const files: FileCandidate[] = [];
  for await (const [name, handle] of (directory as IterableDirectoryHandle).entries()) {
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      files.push(...await collectHandleFiles(handle as FileSystemDirectoryHandle, relativePath));
    } else if (AUDIO_EXTENSIONS.has(extensionFor(name))) {
      files.push({
        file: await (handle as FileSystemFileHandle).getFile(),
        relativePath,
      });
    }
  }
  return files;
}

async function mapWithConcurrency<T, R>(
  input: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const output = new Array<R>(input.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, input.length) }, async () => {
    while (cursor < input.length) {
      const index = cursor++;
      output[index] = await mapper(input[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

self.onmessage = async (event: MessageEvent<ScanMessage>) => {
  const message = event.data;
  try {
    const candidates = message.type === 'scan-handle'
      ? await collectHandleFiles(message.handle)
      : message.files.filter(({ relativePath }) => AUDIO_EXTENSIONS.has(extensionFor(relativePath)));

    let completed = 0;
    const tracks = await mapWithConcurrency(candidates, 4, async (candidate) => {
      const track = await parseCandidate(candidate, message.directoryId);
      completed += 1;
      if (completed === candidates.length || completed % 25 === 0) {
        self.postMessage({ type: 'progress', requestId: message.requestId, completed, total: candidates.length });
      }
      return track;
    });
    tracks.sort((left, right) => left.relativePath!.localeCompare(right.relativePath!, undefined, { numeric: true }));
    self.postMessage({ type: 'complete', requestId: message.requestId, tracks });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : 'Browser folder scan failed',
    });
  }
};

export {};
