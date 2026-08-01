"use client";

import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { LocalQueueMode, SavedLocalPlaylist, Track } from '../lib/types';
import { useLocalLibrary } from '../lib/localLibraryClient';
import { LOCAL_FAVORITE_LIMIT, sanitizeLocalFavoriteTrackIds } from '../lib/localQueue';

interface LocalPlaylistEditorProps {
  playlist: SavedLocalPlaylist;
  onSave: (playlist: SavedLocalPlaylist) => void;
}

function formatTrackDuration(seconds: number | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function trackSearchText(track: Track): string {
  return [track.title, track.artist, track.album, track.year, ...(track.genre ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const LocalPlaylistEditor: React.FC<LocalPlaylistEditorProps> = ({ playlist, onSave }) => {
  const { tracks, status, error, reload } = useLocalLibrary(playlist);
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [queueMode, setQueueMode] = useState<LocalQueueMode>(
    playlist.queueMode === 'ordered' ? 'ordered' : 'random'
  );
  const [query, setQuery] = useState('');
  const [isDirty, setIsDirty] = useState(false);

  const deferredQuery = useDeferredValue(query);
  const isInitialLoading = status === 'idle' || (status === 'loading' && tracks.length === 0);
  const isRefreshing = status === 'loading' && tracks.length > 0;
  const loadError = status === 'error' ? error : null;

  useEffect(() => {
    setQuery('');
  }, [playlist.id]);

  useEffect(() => {
    if (tracks.length === 0 && status !== 'ready') return;

    const scannedIds = tracks.map((track) => track.id);
    const scannedIdSet = new Set(scannedIds);
    const includedIds = Array.isArray(playlist.includedTrackIds)
      ? playlist.includedTrackIds.filter((id) => scannedIdSet.has(id))
      : scannedIds;

    setOrderedIds(includedIds);
    setFavoriteIds(sanitizeLocalFavoriteTrackIds(
      playlist.favoriteTrackIds,
      new Set(includedIds)
    ));
    setQueueMode(playlist.queueMode === 'ordered' ? 'ordered' : 'random');
    setIsDirty(false);
  }, [
    playlist.favoriteTrackIds,
    playlist.id,
    playlist.includedTrackIds,
    playlist.queueMode,
    status,
    tracks,
  ]);

  const selectedIds = useMemo(() => new Set(orderedIds), [orderedIds]);
  const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);
  const trackById = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const selectedTracks = useMemo(
    () =>
      orderedIds.flatMap((id) => {
        const track = trackById.get(id);
        return track ? [track] : [];
      }),
    [orderedIds, trackById]
  );
  const searchableTracks = useMemo(
    () => tracks.map((track) => ({ track, searchText: trackSearchText(track) })),
    [tracks]
  );
  const filteredTracks = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) return tracks;
    return searchableTracks
      .filter(({ searchText }) => searchText.includes(normalizedQuery))
      .map(({ track }) => track);
  }, [deferredQuery, searchableTracks, tracks]);
  const searchIsCatchingUp = query !== deferredQuery;
  const libraryScrollRef = useRef<HTMLDivElement>(null);
  const queueScrollRef = useRef<HTMLDivElement>(null);
  const libraryVirtualizer = useVirtualizer({
    count: filteredTracks.length,
    getScrollElement: () => libraryScrollRef.current,
    estimateSize: () => 61,
    overscan: 8,
  });
  const queueVirtualizer = useVirtualizer({
    count: selectedTracks.length,
    getScrollElement: () => queueScrollRef.current,
    estimateSize: () => 61,
    overscan: 8,
  });

  const markDirty = useCallback((updater: (current: string[]) => string[]) => {
    setOrderedIds((current) => updater(current));
    setIsDirty(true);
  }, []);

  const addTrack = useCallback(
    (trackId: string) => {
      markDirty((current) => current.includes(trackId) ? current : [...current, trackId]);
    },
    [markDirty]
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      setFavoriteIds((current) => current.filter((id) => id !== trackId));
      markDirty((current) => current.filter((id) => id !== trackId));
    },
    [markDirty]
  );

  const toggleFavorite = useCallback((trackId: string) => {
    setFavoriteIds((current) => {
      if (current.includes(trackId)) return current.filter((id) => id !== trackId);
      if (current.length >= LOCAL_FAVORITE_LIMIT) return current;
      return [...current, trackId];
    });
    setIsDirty(true);
  }, []);

  const clearQueue = useCallback(() => {
    setFavoriteIds([]);
    markDirty(() => []);
  }, [markDirty]);

  const moveTrack = useCallback(
    (trackId: string, direction: -1 | 1) => {
      markDirty((current) => {
        const index = current.indexOf(trackId);
        const targetIndex = index + direction;
        if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
        const next = [...current];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        return next;
      });
    },
    [markDirty]
  );

  const addFilteredTracks = useCallback(() => {
    const filteredIds = filteredTracks.map((track) => track.id);
    markDirty((current) => {
      const currentSet = new Set(current);
      const additions = filteredIds.filter((id) => !currentSet.has(id));
      return additions.length ? [...current, ...additions] : current;
    });
  }, [filteredTracks, markDirty]);

  const saveQueue = useCallback(() => {
    onSave({
      ...playlist,
      includedTrackIds: orderedIds,
      favoriteTrackIds: favoriteIds,
      queueMode,
    });
    setIsDirty(false);
  }, [favoriteIds, onSave, orderedIds, playlist, queueMode]);

  const useEntireFolder = useCallback(() => {
    const scannedIds = tracks.map((track) => track.id);
    const retainedFavoriteIds = sanitizeLocalFavoriteTrackIds(
      favoriteIds,
      new Set(scannedIds)
    );
    onSave({
      ...playlist,
      includedTrackIds: undefined,
      favoriteTrackIds: retainedFavoriteIds,
      queueMode,
    });
    setOrderedIds(scannedIds);
    setFavoriteIds(retainedFavoriteIds);
    setIsDirty(false);
  }, [favoriteIds, onSave, playlist, queueMode, tracks]);

  const rescanFolder = useCallback(() => {
    void reload(true).catch(() => undefined);
  }, [reload]);

  return (
    <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-950/15 p-4 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-cyan-100">Song queue for {playlist.name}</h4>
          <p className="text-xs text-gray-400 mt-1">
            Pick the songs included in this local playlist, then play them randomly or in the saved order.
          </p>
          <p className="text-[11px] text-cyan-200/75 mt-1">
            Local scans keep running in the background and are reused until you choose another folder or rescan manually.
          </p>
        </div>
        <div className="text-xs text-gray-300 sm:text-right shrink-0 space-y-1">
          <div>{selectedTracks.length} selected</div>
          <div>{tracks.length} scanned</div>
          <button
            type="button"
            onClick={rescanFolder}
            disabled={status === 'loading'}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/10 disabled:text-gray-500"
          >
            {status === 'loading'
              ? 'Scanning...'
              : playlist.localMode === 'browser'
                ? 'Reconnect & rescan'
                : 'Rescan folder'}
          </button>
        </div>
      </div>

      {isInitialLoading ? (
        <div className="rounded-xl border border-cyan-300/20 bg-black/15 p-3 text-sm text-gray-300">
          Scanning local folder in the background... You can switch tabs or close Settings; this scan will continue.
        </div>
      ) : loadError ? (
        <div className="space-y-2">
          <p className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{loadError}</p>
          <button
            type="button"
            onClick={rescanFolder}
            className="rounded-xl bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300"
          >
            Try scan again
          </button>
        </div>
      ) : (
        <>
          {isRefreshing && (
            <p className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-2 text-xs text-cyan-100">
              Refreshing this folder in the background. Current cached songs remain usable.
            </p>
          )}

          <fieldset className="rounded-xl border border-white/10 bg-black/15 p-3">
            <legend className="px-1 text-xs font-medium text-gray-300">Playback order</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([
                ['random', 'Random', 'Default · reshuffles every loop'],
                ['ordered', 'In order', 'Uses the queue shown below'],
              ] as const).map(([value, label, description]) => (
                <label
                  key={value}
                  className={`cursor-pointer rounded-lg border px-3 py-2 ${
                    queueMode === value
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                      : 'border-white/10 bg-white/5 text-gray-300'
                  }`}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <input
                      type="radio"
                      name={`queue-mode-${playlist.id}`}
                      value={value}
                      checked={queueMode === value}
                      onChange={() => {
                        setQueueMode(value);
                        setIsDirty(true);
                      }}
                    />
                    {label}
                  </span>
                  <span className="mt-0.5 block pl-6 text-[11px] text-gray-400">{description}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="rounded-xl border border-amber-300/20 bg-amber-400/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-amber-100">Favorite boost</span>
              <span className="text-xs tabular-nums text-amber-200">
                {favoriteIds.length}/{LOCAL_FAVORITE_LIMIT} selected
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">
              Star one to three selected songs. In Random mode, each favorite has a 10% chance of
              one extra play per complete loop. Ordered mode keeps the exact queue and ignores this boost.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, artist, album, genre..."
              className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm outline-none focus:border-cyan-300/60"
            />
            <button
              type="button"
              onClick={addFilteredTracks}
              disabled={filteredTracks.length === 0 || searchIsCatchingUp}
              className="rounded-xl bg-cyan-500/20 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-500/30 disabled:bg-gray-800 disabled:text-gray-500"
            >
              {searchIsCatchingUp ? 'Filtering...' : 'Add filtered'}
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                <span>Library</span>
                <span>{filteredTracks.length}</span>
              </div>
              <div
                ref={libraryScrollRef}
                className="h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/15"
              >
                {filteredTracks.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-500">No songs match this search.</div>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: `${libraryVirtualizer.getTotalSize()}px` }}
                  >
                  {libraryVirtualizer.getVirtualItems().map((virtualRow) => {
                    const track = filteredTracks[virtualRow.index];
                    const selected = selectedIds.has(track.id);
                    return (
                      <div
                        key={track.id}
                        className="playlist-scroll-item absolute left-0 top-0 flex w-full items-center gap-2 border-b border-white/5 p-2.5"
                        style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                      >
                        <button
                          type="button"
                          onClick={() => selected ? removeTrack(track.id) : addTrack(track.id)}
                          className={`h-8 w-8 rounded-lg text-sm font-bold shrink-0 ${
                            selected
                              ? 'bg-cyan-400 text-slate-950 hover:bg-cyan-300'
                              : 'bg-white/10 text-gray-300 hover:bg-white/20'
                          }`}
                          aria-label={selected ? `Remove ${track.title}` : `Add ${track.title}`}
                        >
                          {selected ? '✓' : '+'}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{track.title}</div>
                          <div className="truncate text-xs text-gray-400">
                            {track.artist}{track.album ? ` · ${track.album}` : ''}
                          </div>
                        </div>
                        <span className="text-[11px] tabular-nums text-gray-500 shrink-0">
                          {formatTrackDuration(track.duration)}
                        </span>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                <span>{queueMode === 'random' ? 'Selected songs' : 'Queue order'}</span>
                <div className="flex items-center gap-3">
                  <span className="text-amber-200">★ {favoriteIds.length}/{LOCAL_FAVORITE_LIMIT}</span>
                  <button
                    type="button"
                    onClick={clearQueue}
                    disabled={orderedIds.length === 0}
                    className="text-red-300 hover:text-red-200 disabled:text-gray-600"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div
                ref={queueScrollRef}
                className="h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/15"
              >
                {selectedTracks.length === 0 ? (
                  <div className="p-3 text-center text-xs text-gray-500">No songs selected yet.</div>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: `${queueVirtualizer.getTotalSize()}px` }}
                  >
                  {queueVirtualizer.getVirtualItems().map((virtualRow) => {
                    const index = virtualRow.index;
                    const track = selectedTracks[index];
                    const isFavorite = favoriteIdSet.has(track.id);
                    const favoriteLimitReached =
                      !isFavorite && favoriteIds.length >= LOCAL_FAVORITE_LIMIT;
                    return (
                    <div
                      key={track.id}
                      className="playlist-scroll-item absolute left-0 top-0 flex w-full items-center gap-2 border-b border-white/5 p-2.5"
                      style={{ height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <span className="w-6 text-right text-[11px] tabular-nums text-gray-500">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-white">{track.title}</div>
                        <div className="truncate text-xs text-gray-400">{track.artist}</div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => toggleFavorite(track.id)}
                          disabled={favoriteLimitReached}
                          aria-pressed={isFavorite}
                          aria-label={`${isFavorite ? 'Remove' : 'Add'} ${track.title} ${isFavorite ? 'from' : 'to'} favorites`}
                          title={favoriteLimitReached ? 'You can select up to three favorites' : undefined}
                          className={`rounded-md px-2 py-1 text-sm ${
                            isFavorite
                              ? 'bg-amber-400/25 text-amber-200 hover:bg-amber-400/35'
                              : 'bg-white/10 text-gray-300 hover:bg-white/20 disabled:text-gray-600 disabled:hover:bg-white/10'
                          }`}
                        >
                          {isFavorite ? '★' : '☆'}
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTrack(track.id, -1)}
                          disabled={index === 0}
                          className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:text-gray-600"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => moveTrack(track.id, 1)}
                          disabled={index === selectedTracks.length - 1}
                          className="rounded-md bg-white/10 px-2 py-1 text-xs hover:bg-white/20 disabled:text-gray-600"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTrack(track.id)}
                          className="rounded-md bg-red-500/15 px-2 py-1 text-xs text-red-200 hover:bg-red-500/25"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )})}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-white/10 pt-3">
            <p className="text-xs text-gray-400">
              Saved on this browser/device. Random mode reshuffles every complete loop; favorites average about 10% more plays.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={useEntireFolder}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-gray-100 hover:bg-white/15"
              >
                Use entire folder
              </button>
              <button
                type="button"
                onClick={saveQueue}
                disabled={!isDirty}
                className="rounded-xl bg-cyan-400 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:bg-gray-700 disabled:text-gray-400"
              >
                Save song queue
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LocalPlaylistEditor;
