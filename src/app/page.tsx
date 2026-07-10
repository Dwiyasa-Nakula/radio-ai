// src/app/page.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import InternationalRadio from "./components/InternationalRadio";
import MusicPlayer from "./components/MusicPlayer";
import SettingsModal from "./components/SettingsModal";
import type {
  HostSettings,
  RadioItem,
  RadioStation,
  SavedPlaylist,
  Track,
} from "./lib/types";
import { DEFAULT_HOST_SETTINGS } from "./lib/types";
import {
  loadActivePlaylistId,
  loadHostSettings,
  loadPlaylists,
  saveActivePlaylistId,
  saveHostSettings,
  savePlaylists,
} from "./lib/playlists";

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

/**
 * Build the radio queue with optional chatter, traffic, jingle, and
 * morning/noon preroll items injected between songs.
 *
 * Layout rules:
 *  - Chatter is inserted every `frequency` songs when enabled.
 *  - News is inserted every `newsEvery` songs (0 = off).
 *  - Traffic is inserted every `trafficEvery` songs (0 = off).
 *  - Jingle is inserted every `jingleEvery` songs (0 = off).
 *  - Morning preroll (5–11 JST): prepend [news, weather] at queue head.
 *  - Noon preroll (11–14 JST):   prepend [news] at queue head.
 *
 * Each interval is independent. If multiple intervals land on the same
 * boundary, the corresponding items play back-to-back.
 */
function buildRadioQueue(
  tracks: Track[],
  settings: HostSettings,
  includePreroll: boolean
): RadioItem[] {
  const {
    enabled,
    chatterEnabled,
    frequency,
    newsEvery,
    newsFocus,
    trafficEvery,
    jingleEvery,
    morningPreroll,
    noonPreroll,
  } = settings;
  const items: RadioItem[] = [];
  const focus = newsFocus.trim() || undefined;

  // --- preroll (news / weather at queue head) ---
  if (enabled && includePreroll) {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date())
    );
    const prerollId = Date.now();
    if (morningPreroll && hour >= 5 && hour < 11) {
      items.push({ kind: 'news', id: `preroll-news:${prerollId}`, focus });
      items.push({ kind: 'weather', id: `preroll-weather:${prerollId}` });
    } else if (noonPreroll && hour >= 11 && hour < 14) {
      items.push({ kind: 'news', id: `preroll-news:${prerollId}`, focus });
    }
  }

  // --- main song loop ---
  for (let i = 0; i < tracks.length; i++) {
    if (enabled && i > 0) {
      const songsPlayed = i;
      const freq = Math.max(1, frequency);

      if (newsEvery > 0 && songsPlayed % newsEvery === 0) {
        items.push({
          kind: 'news',
          id: `news:${tracks[i].id}:${songsPlayed}`,
          focus,
        });
      }
      if (trafficEvery > 0 && songsPlayed % trafficEvery === 0) {
        items.push({ kind: 'traffic', id: `traffic:${tracks[i].id}:${songsPlayed}` });
      }
      if (jingleEvery > 0 && songsPlayed % jingleEvery === 0) {
        items.push({ kind: 'jingle', id: `jingle:${tracks[i].id}:${songsPlayed}` });
      }
      if (chatterEnabled && songsPlayed % freq === 0) {
        items.push({
          kind: 'chatter',
          id: `chatter:${tracks[i - 1].id}->${tracks[i].id}`,
          previousSong: tracks[i - 1],
          nextSong: tracks[i],
        });
      }
    }
    items.push({ kind: 'song', id: `song:${tracks[i].id}`, track: tracks[i] });
  }
  return items;
}

function trackToSongInfo(track: Track) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
  };
}

/** Fetch generated or prerecorded segment audio. Songs stream directly. */
async function fetchItemBlob(item: Exclude<RadioItem, { kind: 'song' }>, signal: AbortSignal): Promise<{ blob: Blob; ttsProvider?: string }> {
  // --- jingle (GET) ---
  if (item.kind === 'jingle') {
    const res = await fetch('/api/host/jingle', { signal });
    if (res.status === 404) {
      throw new OptionalSegmentUnavailable('No jingle files are configured');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Jingle fetch failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const blob = await res.blob();
    return { blob };
  }

  // --- chatter / news / weather / traffic (POST) ---
  let payload: Record<string, unknown>;
  switch (item.kind) {
    case 'chatter':
      payload = {
        kind: 'chatter',
        previousSong: item.previousSong ? trackToSongInfo(item.previousSong) : undefined,
        nextSong: trackToSongInfo(item.nextSong),
      };
      break;
    case 'news':
      payload = { kind: 'news', focus: item.focus };
      break;
    case 'weather':
      payload = { kind: 'weather' };
      break;
    case 'traffic':
      payload = { kind: 'traffic' };
      break;
  }

  const res = await fetch('/api/host/segment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (res.status === 204) {
    throw new OptionalSegmentUnavailable(`${item.kind} is not configured`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Segment (${item.kind}) fetch failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const blob = await res.blob();
  const ttsProvider = res.headers.get('x-tts-provider') || undefined;
  return { blob, ttsProvider };
}

class OptionalSegmentUnavailable extends Error {}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

interface InflightAudio {
  controller: AbortController;
  promise: Promise<PreparedAudio>;
}

interface PreparedAudio {
  itemId: string;
  url: string;
  revocable: boolean;
  ttsProvider?: string;
}

/** Human-readable label for non-song items. */
function segmentLabel(item: RadioItem): string {
  switch (item.kind) {
    case 'chatter': return 'ラジオホスト';
    case 'news':    return 'ニュース';
    case 'weather': return '天気予報';
    case 'traffic': return '交通情報';
    case 'jingle':  return 'ジングル';
    default:        return '';
  }
}

function loadingLabel(item: RadioItem): string {
  switch (item.kind) {
    case 'chatter': return 'ラジオホスト セグメント生成中...';
    case 'news':    return 'ニュースを取得中...';
    case 'weather': return '天気予報を取得中...';
    case 'traffic': return '交通情報を取得中...';
    case 'jingle':  return 'ジングル読み込み中...';
    default:        return 'トラック読み込み中...';
  }
}

export default function Home() {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hostSettings, setHostSettings] = useState<HostSettings>(DEFAULT_HOST_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [tracks, setTracks] = useState<Track[]>([]);
  const [includePreroll, setIncludePreroll] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAudio, setCurrentAudio] = useState<PreparedAudio | null>(null);
  const [nextAudio, setNextAudio] = useState<PreparedAudio | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trackError, setTrackError] = useState<string | null>(null);
  const [liveStation, setLiveStation] = useState<RadioStation | null>(null);

  const cacheRef = useRef<Map<string, PreparedAudio>>(new Map());
  const inflightRef = useRef<Map<string, InflightAudio>>(new Map());

  useEffect(() => {
    const loaded = loadPlaylists();
    setPlaylists(loaded);
    setActiveId(loadActivePlaylistId() ?? loaded[0]?.id ?? null);
    setHostSettings(loadHostSettings());
  }, []);

  const activePlaylist = playlists.find((p) => p.id === activeId) ?? null;
  const isInternationalRadio = activePlaylist?.type === 'radio';

  useEffect(() => {
    if (!activePlaylist) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    setTracks([]);
    setIncludePreroll(true);
    setCurrentIndex(0);
    setCurrentAudio(null);
    setNextAudio(null);
    setLiveStation(null);

    if (activePlaylist.type === 'radio') {
      setIsLoading(false);
      return;
    }

    const url =
      activePlaylist.type === 'youtube'
        ? `/api/playlist/${activePlaylist.playlistId}`
        : activePlaylist.path
          ? `/api/local/list?path=${encodeURIComponent(activePlaylist.path)}`
          : '/api/local/list';

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `Fetch failed: ${res.status}`);
        }
        return res.json();
      })
      .then((data: Track[]) => {
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          setError(
            activePlaylist.type === 'local'
              ? 'No audio files found in that folder.'
              : 'Playlist is empty.'
          );
        } else {
          setTracks(shuffleArray(data));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('Could not load tracks:', err);
        setError(err instanceof Error ? err.message : 'Could not load tracks.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePlaylist]);

  const radioQueue = useMemo(
    () => buildRadioQueue(tracks, hostSettings, includePreroll),
    [tracks, hostSettings, includePreroll]
  );

  const currentItem = radioQueue[currentIndex];
  const nextItem = radioQueue[currentIndex + 1];
  const preparedCurrentAudio =
    currentItem &&
    (currentAudio?.itemId === currentItem.id
      ? currentAudio
      : nextAudio?.itemId === currentItem.id
        ? nextAudio
        : null);
  const preparedNextAudio =
    nextItem &&
    (nextAudio?.itemId === nextItem.id
      ? nextAudio
      : currentAudio?.itemId === nextItem.id
        ? currentAudio
        : null);

  const handleNext = useCallback(() => {
    setCurrentIndex((previousIndex) =>
      Math.min(previousIndex + 1, radioQueue.length)
    );
  }, [radioQueue.length]);

  useEffect(() => {
    if (radioQueue.length > 0 && currentIndex >= radioQueue.length) {
      setIncludePreroll(false);
      setTracks((currentTracks) => shuffleArray(currentTracks));
      setCurrentIndex(0);
    }
  }, [currentIndex, radioQueue.length]);

  useEffect(() => {
    const keep = new Set<string>();
    if (currentItem) keep.add(currentItem.id);
    if (nextItem) keep.add(nextItem.id);

    for (const [id, request] of Array.from(inflightRef.current.entries())) {
      if (!keep.has(id)) {
        request.controller.abort();
        inflightRef.current.delete(id);
      }
    }
    for (const [id, resource] of Array.from(cacheRef.current.entries())) {
      if (!keep.has(id)) {
        if (resource.revocable) URL.revokeObjectURL(resource.url);
        cacheRef.current.delete(id);
      }
    }

    if (!currentItem) {
      setCurrentAudio(null);
      setNextAudio(null);
      setTrackError(null);
      return;
    }

    let cancelled = false;

    const ensure = (item: RadioItem): Promise<PreparedAudio> => {
      const cached = cacheRef.current.get(item.id);
      if (cached) return Promise.resolve(cached);

      const inflight = inflightRef.current.get(item.id);
      if (inflight) return inflight.promise;

      const controller = new AbortController();
      const promise = (
        item.kind === 'song'
          ? Promise.resolve<PreparedAudio>({
              itemId: item.id,
              url: item.track.audioUrl,
              revocable: false,
            })
          : fetchItemBlob(item, controller.signal).then(({ blob, ttsProvider }) => ({
              itemId: item.id,
              url: URL.createObjectURL(blob),
              revocable: true,
              ttsProvider,
            }))
      )
        .then((resource) => {
          if (controller.signal.aborted) {
            if (resource.revocable) URL.revokeObjectURL(resource.url);
            throw new DOMException('Audio request aborted', 'AbortError');
          }
          cacheRef.current.set(item.id, resource);
          return resource;
        })
        .finally(() => {
          const active = inflightRef.current.get(item.id);
          if (active?.promise === promise) {
            inflightRef.current.delete(item.id);
          }
        });

      inflightRef.current.set(item.id, { controller, promise });
      return promise;
    };

    setCurrentAudio(cacheRef.current.get(currentItem.id) ?? null);
    setNextAudio(
      nextItem ? cacheRef.current.get(nextItem.id) ?? null : null
    );
    setTrackError(null);

    ensure(currentItem)
      .then((resource) => {
        if (!cancelled) setCurrentAudio(resource);
      })
      .catch((err) => {
        if (cancelled || isAbortError(err)) return;
        if (err instanceof OptionalSegmentUnavailable) {
          console.info(`Skipping optional ${currentItem.kind} item:`, err.message);
          handleNext();
          return;
        }
        console.error('Failed to load item', currentItem.id, err);
        setTrackError(
          currentItem.kind === 'song'
            ? 'Failed to load audio'
            : `${segmentLabel(currentItem)} の生成に失敗しました`
        );
      });

    if (nextItem) {
      ensure(nextItem)
        .then((resource) => {
          if (!cancelled) setNextAudio(resource);
        })
        .catch((err) => {
          if (!isAbortError(err)) {
            console.warn('Preload failed for', nextItem.id, err);
          }
        });
    } else {
      setNextAudio(null);
    }

    return () => {
      cancelled = true;
    };
  }, [currentItem, nextItem, handleNext]);

  useEffect(() => {
    const inflight = inflightRef.current;
    const cache = cacheRef.current;

    return () => {
      for (const request of inflight.values()) {
        request.controller.abort();
      }
      inflight.clear();
      for (const resource of cache.values()) {
        if (resource.revocable) URL.revokeObjectURL(resource.url);
      }
      cache.clear();
    };
  }, []);

  const handleSkipSegment = useCallback(() => {
    if (currentItem?.kind !== 'song') handleNext();
  }, [currentItem, handleNext]);

  const handleActivate = useCallback((id: string) => {
    setActiveId(id);
    saveActivePlaylistId(id);
    setSettingsOpen(false);
  }, []);

  const handleAddPlaylist = useCallback((entry: SavedPlaylist) => {
    setPlaylists((prev) => {
      const next = [...prev, entry];
      savePlaylists(next);
      return next;
    });
  }, []);

  const handleRemovePlaylist = useCallback(
    (id: string) => {
      setPlaylists((prev) => {
        const next = prev.filter((p) => p.id !== id);
        savePlaylists(next);
        if (activeId === id) {
          const fallback = next[0]?.id ?? null;
          setActiveId(fallback);
          if (fallback) saveActivePlaylistId(fallback);
        }
        return next;
      });
    },
    [activeId]
  );

  const handleHostSettingsChange = useCallback((settings: HostSettings) => {
    setHostSettings(settings);
    saveHostSettings(settings);
    setIncludePreroll(true);
    setCurrentIndex(0);
  }, []);

  // Resolve display track: for songs it's the track itself; for chatter
  // it's the nextSong; for other segments use the next song in the queue.
  const displayTrack: Track | null = (() => {
    if (!currentItem) return null;
    if (currentItem.kind === 'song') return currentItem.track;
    if (currentItem.kind === 'chatter') return currentItem.nextSong;
    // For news/weather/traffic/jingle, find the next song item in the queue
    for (let i = currentIndex + 1; i < radioQueue.length; i++) {
      const it = radioQueue[i];
      if (it.kind === 'song') return it.track;
    }
    return null;
  })();

  const displayInfo = (() => {
    if (!currentItem) return null;
    if (currentItem.kind === 'song') {
      return {
        title: currentItem.track.title,
        artist: currentItem.track.artist,
        album: currentItem.track.album,
      };
    }

    const label = segmentLabel(currentItem);
    let artist = 'AI Host';
    let album = 'Live Broadcast';

    if (currentItem.kind === 'news') {
      artist = 'NHK News Web';
      album = 'Live News Feed';
    } else if (currentItem.kind === 'weather') {
      artist = '気象庁 (JMA)';
      album = 'Tokyo Weather';
    } else if (currentItem.kind === 'traffic') {
      artist = 'TomTom Traffic';
      album = 'Tokyo Traffic Alert';
    } else if (currentItem.kind === 'jingle') {
      artist = 'Radio AI Station';
      album = 'Station Break';
    }

    return {
      title: label,
      artist,
      album,
    };
  })();

  const isSegment = currentItem && currentItem.kind !== 'song';
  const backdropThumbnail = isInternationalRadio
    ? liveStation?.favicon?.trim() || ''
    : displayTrack?.thumbnail?.trim() || '';

  return (
    <div className="radio-page font-sans grid grid-rows-[auto_1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-8 sm:p-12">
      {backdropThumbnail ? (
        <div
          aria-hidden="true"
          className="radio-backdrop-image"
          style={{ backgroundImage: `url("${backdropThumbnail}")` }}
        />
      ) : (
        <div aria-hidden="true" className="radio-backdrop-solid" />
      )}
      <div aria-hidden="true" className="radio-backdrop-overlay" />

      <header className="radio-glass relative z-10 text-center w-full max-w-2xl flex items-center justify-between rounded-2xl px-5 py-4">
        <div className="w-10" />
        <h1 className="text-4xl font-bold">MirAI Melody FM</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-10 h-10 rounded-full hover:bg-gray-700 text-2xl"
          aria-label="Settings"
        >
          ⚙
        </button>
      </header>
      <main className="relative z-10 flex flex-col gap-6 w-full max-w-2xl items-center">
        {activePlaylist && (
          <p className="radio-glass rounded-full px-4 py-2 text-sm text-gray-300">
            Now playing from: <span className="font-medium text-white">{activePlaylist.name}</span>
            {hostSettings.enabled && !isInternationalRadio && (
              <span className="ml-2 text-purple-300">· AI voice on</span>
            )}
          </p>
        )}
        {isLoading && <p>Loading source...</p>}
        {error && !isLoading && <p className="text-red-400 text-center">{error}</p>}

        {isInternationalRadio ? (
          <InternationalRadio onStationChange={setLiveStation} />
        ) : currentItem ? (
          <>
            {isSegment && (
              <div className="radio-glass border border-purple-400/30 rounded-lg px-4 py-2 text-sm text-purple-100 flex flex-wrap items-center gap-2">
                <span className="font-semibold text-purple-200">{segmentLabel(currentItem)}</span>
                {preparedCurrentAudio?.ttsProvider && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300">
                    Voice: {preparedCurrentAudio.ttsProvider}
                  </span>
                )}
                {displayTrack && (
                  <span> — up next: <span className="text-white">{displayTrack.title}</span></span>
                )}
              </div>
            )}
            {preparedCurrentAudio ? (
              <MusicPlayer
                itemId={currentItem.id}
                audioUrl={preparedCurrentAudio.url}
                nextItemId={nextItem?.id}
                nextAudioUrl={preparedNextAudio?.url}
                thumbnailUrl={displayTrack?.thumbnail ?? ''}
                onFinished={handleNext}
                isSegment={!!isSegment}
              />
            ) : (
              <div className="radio-glass text-white p-4 rounded-lg shadow-lg w-full text-center">
                {trackError ?? loadingLabel(currentItem)}
              </div>
            )}
            {displayInfo && (
              <div className="radio-glass rounded-2xl px-6 py-4 text-center">
                <h2 className="text-xl font-semibold">{displayInfo.title}</h2>
                <p className="text-md text-gray-300">{displayInfo.artist}</p>
                {displayInfo.album && (
                  <p className="text-sm text-gray-400">{displayInfo.album}</p>
                )}
              </div>
            )}
            <div className="mt-2 flex gap-2 justify-center">
              {isSegment && (
                <button
                  onClick={handleSkipSegment}
                  className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-full"
                >
                  Skip
                </button>
              )}
              <button
                onClick={handleNext}
                className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-full"
              >
                Next
              </button>
            </div>
          </>
        ) : null}
      </main>
      <footer />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        playlists={playlists}
        activeId={activeId}
        onActivate={handleActivate}
        onAdd={handleAddPlaylist}
        onRemove={handleRemovePlaylist}
        hostSettings={hostSettings}
        onHostSettingsChange={handleHostSettingsChange}
      />
    </div>
  );
}
