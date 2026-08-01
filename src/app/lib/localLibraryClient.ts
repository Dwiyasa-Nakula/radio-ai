"use client";

import { useCallback, useEffect, useState } from 'react';
import type { SavedLocalPlaylist, Track } from './types';
import { scanBrowserPlaylist } from './browserLocalLibrary';

export type LocalLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface LocalLibrarySnapshot {
  status: LocalLibraryStatus;
  tracks: Track[];
  error: string | null;
}

interface LocalLibraryRecord extends LocalLibrarySnapshot {
  promise?: Promise<Track[]>;
}

type LocalLibrarySource = SavedLocalPlaylist | string | undefined;
const DEFAULT_LIBRARY_KEY = '__default_local_library__';
const EMPTY_TRACKS: Track[] = [];
const libraryCache = new Map<string, LocalLibraryRecord>();
const listeners = new Map<string, Set<() => void>>();

function normalizeSource(source: LocalLibrarySource): SavedLocalPlaylist {
  if (typeof source === 'object' && source) return source;
  const path = typeof source === 'string' ? source.trim() || undefined : undefined;
  return { id: path ? `server:${path}` : 'local', name: 'Local Files', type: 'local', path, localMode: 'server' };
}

export function localLibraryCacheKey(source: LocalLibrarySource): string {
  const playlist = normalizeSource(source);
  if (playlist.localMode === 'browser' || playlist.localMode === 'input') {
    return `${playlist.localMode}:${playlist.directoryHandleId ?? playlist.id}`;
  }
  return playlist.path?.trim() || DEFAULT_LIBRARY_KEY;
}

function localLibraryUrl(path?: string): string {
  const normalized = path?.trim();
  return normalized ? `/api/local/list?path=${encodeURIComponent(normalized)}` : '/api/local/list';
}

function emitLocalLibraryChange(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function getLocalLibrarySnapshot(source: LocalLibrarySource): LocalLibrarySnapshot {
  const record = libraryCache.get(localLibraryCacheKey(source));
  return {
    status: record?.status ?? 'idle',
    tracks: record?.tracks ?? EMPTY_TRACKS,
    error: record?.error ?? null,
  };
}

export function subscribeLocalLibrary(source: LocalLibrarySource, listener: () => void): () => void {
  const key = localLibraryCacheKey(source);
  const activeListeners = listeners.get(key) ?? new Set<() => void>();
  activeListeners.add(listener);
  listeners.set(key, activeListeners);
  return () => {
    activeListeners.delete(listener);
    if (activeListeners.size === 0) listeners.delete(key);
  };
}

export function preloadLocalLibrary(
  source: LocalLibrarySource,
  options: { force?: boolean; requestPermission?: boolean } = {}
): Promise<Track[]> {
  const playlist = normalizeSource(source);
  const key = localLibraryCacheKey(playlist);
  const existing = libraryCache.get(key);
  if (existing && !options.force) {
    if (existing.status === 'ready') return Promise.resolve(existing.tracks);
    if (existing.status === 'loading' && existing.promise) return existing.promise;
    if (existing.status === 'error') return Promise.reject(new Error(existing.error ?? 'Could not load local songs'));
  }

  const record: LocalLibraryRecord = {
    status: 'loading',
    tracks: existing?.tracks ?? EMPTY_TRACKS,
    error: null,
  };
  libraryCache.set(key, record);
  emitLocalLibraryChange(key);

  const promise = (
    playlist.localMode === 'browser' || playlist.localMode === 'input'
      ? scanBrowserPlaylist(playlist, options)
      : fetch(localLibraryUrl(playlist.path)).then(async (response) => {
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error ?? `Local scan failed: ${response.status}`);
          }
          return response.json() as Promise<Track[]>;
        })
  )
    .then((tracks) => {
      if (!Array.isArray(tracks)) throw new Error('Local scan returned invalid data');
      Object.assign(record, { status: 'ready' as const, tracks, error: null, promise: undefined });
      emitLocalLibraryChange(key);
      return tracks;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : 'Could not load local songs';
      Object.assign(record, { status: 'error' as const, error: message, promise: undefined });
      emitLocalLibraryChange(key);
      throw error instanceof Error ? error : new Error(message);
    });

  record.promise = promise;
  return promise;
}

export function loadLocalLibrary(source: LocalLibrarySource): Promise<Track[]> {
  return preloadLocalLibrary(source);
}

export function refreshLocalLibrary(source: LocalLibrarySource, requestPermission = false): Promise<Track[]> {
  return preloadLocalLibrary(source, { force: true, requestPermission });
}

export function primeLocalLibrary(source: LocalLibrarySource, tracks: Track[]): void {
  const key = localLibraryCacheKey(source);
  libraryCache.set(key, { status: 'ready', tracks, error: null });
  emitLocalLibraryChange(key);
}

export function useLocalLibrary(source: LocalLibrarySource) {
  const key = localLibraryCacheKey(source);
  const [snapshot, setSnapshot] = useState<LocalLibrarySnapshot>(() => getLocalLibrarySnapshot(source));

  useEffect(() => {
    setSnapshot(getLocalLibrarySnapshot(source));
    const unsubscribe = subscribeLocalLibrary(source, () => setSnapshot(getLocalLibrarySnapshot(source)));
    void preloadLocalLibrary(source).catch(() => undefined);
    return unsubscribe;
  }, [key, source]);

  const reload = useCallback(
    (requestPermission = false) => refreshLocalLibrary(source, requestPermission),
    [key, source]
  );

  return { ...snapshot, reload };
}
