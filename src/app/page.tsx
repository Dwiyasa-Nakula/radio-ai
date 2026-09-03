// src/app/page.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Image from "next/image";
import InternationalRadio from "./components/InternationalRadio";
import MusicPlayer from "./components/MusicPlayer";
import SettingsModal from "./components/SettingsModal";
import type {
  HostSettings,
  PlaybackSettings,
  RadioItem,
  RadioStation,
  SavedLocalPlaylist,
  SavedPlaylist,
  Track,
} from "./lib/types";
import { DEFAULT_HOST_SETTINGS, DEFAULT_PLAYBACK_SETTINGS } from "./lib/types";
import {
  loadActivePlaylistId,
  loadHostSettings,
  hydratePlaylistQueues,
  loadPlaybackSettings,
  loadPlaylists,
  saveActivePlaylistId,
  saveHostSettings,
  savePlaybackSettings,
  savePlaylists,
} from "./lib/playlists";
import { loadLocalLibrary } from "./lib/localLibraryClient";
import { clearLocalDirectoryFiles, createLocalTrackObjectUrl } from "./lib/browserLocalLibrary";
import { backendFetch, backendMediaUrl } from "./lib/backendClient";
import { deleteDirectoryHandle, deletePlaylistQueue } from "./lib/browserStorage";
import { applyLocalFavoriteBoost } from "./lib/localQueue";
import { cachedAudioBlob } from "./lib/audioAssetCache";

const shuffleArray = <T,>(array: T[]): T[] => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

function buildAdBreak(settings: HostSettings, breakId: string, mandatory = false): RadioItem[] {
  if (!mandatory && !settings.adsEnabled) return [];

  const adItemId = `ad:${breakId}`;
  return [
    { kind: 'ad', id: adItemId },
    { kind: 'sponsor', id: `sponsor:${breakId}`, adItemId, brand: '' },
  ];
}

/**
 * Build the radio queue with optional chatter, traffic, jingle, and
 * morning/noon preroll items injected between songs.
 *
 * Layout rules:
 *  - Chatter is inserted every `frequency` songs when enabled.
 *  - News is inserted every `newsEvery` songs (0 = off).
 *  - Traffic is inserted every `trafficEvery` songs (0 = off).
 *  - An outro/intro jingle pair wraps every `jingleEvery` boundary (0 = off).
 *  - Morning preroll (5–11 JST): prepend [news, weather] at queue head.
 *  - Noon preroll (11–14 JST):   prepend [news] at queue head.
 *  - Ad + AnyVoice sponsor credit are inserted every `adEvery` songs when enabled.
 *
 * Each interval is independent. If multiple intervals land on the same
 * boundary, the corresponding items play back-to-back.
 */
function buildClassicRadioQueue(
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
    adEvery,
  } = settings;
  const items: RadioItem[] = [];
  const focus = newsFocus.trim() || undefined;

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
      items.push({ kind: 'news', id: `preroll-morning-news:${prerollId}`, focus });
      items.push({ kind: 'weather', id: `preroll-morning-weather:${prerollId}` });
    } else if (noonPreroll && hour >= 11 && hour < 14) {
      items.push({ kind: 'news', id: `preroll-noon-news:${prerollId}`, focus });
      items.push({ kind: 'weather', id: `preroll-noon-weather:${prerollId}` });
    }
  }

  for (let index = 0; index < tracks.length; index++) {
    if (enabled && index > 0) {
      const songsPlayed = index;
      const frequencyInSongs = Math.max(1, frequency);

      const useJinglePair = jingleEvery > 0 && songsPlayed % jingleEvery === 0;
      if (useJinglePair) {
        items.push({
          kind: 'jingle',
          id: `classic-outro:${tracks[index].id}:${songsPlayed}`,
          slot: 'outro',
        });
      }
      if (newsEvery > 0 && songsPlayed % newsEvery === 0) {
        items.push({
          kind: 'news',
          id: `news:${tracks[index].id}:${songsPlayed}`,
          focus,
        });
      }
      if (adEvery > 0 && songsPlayed % adEvery === 0) {
        items.push(...buildAdBreak(settings, `classic:${tracks[index].id}:${songsPlayed}`));
      }
      if (trafficEvery > 0 && songsPlayed % trafficEvery === 0) {
        items.push({ kind: 'traffic', id: `traffic:${tracks[index].id}:${songsPlayed}` });
      }
      if (chatterEnabled && songsPlayed % frequencyInSongs === 0) {
        items.push({
          kind: 'chatter',
          id: `chatter:${tracks[index - 1].id}->${tracks[index].id}`,
          previousSong: tracks[index - 1],
          nextSong: tracks[index],
          discussionFocus: 'transition',
        });
      }
      if (useJinglePair) {
        items.push({
          kind: 'jingle',
          id: `classic-intro:${tracks[index].id}:${songsPlayed}`,
          slot: 'intro',
        });
      }
    }
    items.push({ kind: 'song', id: `song:${index}:${tracks[index].id}`, track: tracks[index] });
  }
  return items;
}

/**
 * Full show cycle: intro, music, outro, weather, traffic, news, mandatory
 * folder ad + sponsor credit, combined previous/next discussion, repeat.
 * Split discussion mode preserves the legacy two-call layout.
 */
function buildFullShowQueue(tracks: Track[], settings: HostSettings): RadioItem[] {
  if (!settings.enabled) {
    return tracks.map((track, index) => ({ kind: 'song', id: `song:${index}:${track.id}`, track }));
  }

  const items: RadioItem[] = [];
  const focus = settings.newsFocus.trim() || undefined;

  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index];
    const nextTrack = tracks[(index + 1) % tracks.length];
    const cycleId = `${index}:${track.id}`;

    items.push({ kind: 'jingle', id: `intro:${cycleId}`, slot: 'intro' });
    items.push({ kind: 'song', id: `song:${cycleId}`, track });
    items.push({ kind: 'jingle', id: `outro:${cycleId}`, slot: 'outro' });

    if (settings.chatterEnabled && settings.separateSongDiscussions) {
      items.push({
        kind: 'chatter',
        id: `previous-discussion:${cycleId}`,
        previousSong: track,
        nextSong: nextTrack,
        discussionFocus: 'previous',
      });
    }

    items.push({ kind: 'weather', id: `weather:${cycleId}` });
    items.push({ kind: 'traffic', id: `traffic:${cycleId}` });
    items.push({ kind: 'news', id: `news:${cycleId}`, focus });
    items.push(...buildAdBreak(settings, cycleId, true));

    if (settings.chatterEnabled) {
      items.push({
        kind: 'chatter',
        id: `${settings.separateSongDiscussions ? 'next' : 'combined'}-discussion:${cycleId}`,
        previousSong: track,
        nextSong: nextTrack,
        discussionFocus: settings.separateSongDiscussions ? 'next' : 'transition',
      });
    }
  }

  return items;
}

function buildRadioQueue(
  tracks: Track[],
  settings: HostSettings,
  includePreroll: boolean
): RadioItem[] {
  return settings.playOrder === 'fullShow'
    ? buildFullShowQueue(tracks, settings)
    : buildClassicRadioQueue(tracks, settings, includePreroll);
}

function trackToSongInfo(track: Track) {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    year: track.year,
    genre: track.genre,
    publishedAt: track.publishedAt,
    sourceNotes: track.sourceNotes,
  };
}

function hasExplicitLocalQueue(
  playlist: SavedPlaylist | null
): playlist is SavedLocalPlaylist & { includedTrackIds: string[] } {
  return playlist?.type === 'local' && Array.isArray(playlist.includedTrackIds);
}

function prepareTracksForPlayback(tracks: Track[], playlist: SavedPlaylist): Track[] {
  if (playlist.type !== 'local') return shuffleArray(tracks);

  let selectedTracks = [...tracks];
  if (hasExplicitLocalQueue(playlist)) {
    const orderById = new Map(
      playlist.includedTrackIds.map((trackId, index) => [trackId, index])
    );
    selectedTracks = selectedTracks
      .filter((track) => orderById.has(track.id))
      .sort((left, right) => (orderById.get(left.id) ?? 0) - (orderById.get(right.id) ?? 0));
  }

  if (playlist.queueMode === 'ordered') return selectedTracks;
  return applyLocalFavoriteBoost(shuffleArray(selectedTracks), playlist.favoriteTrackIds);
}

function prepareTracksForNextCycle(
  tracks: Track[],
  playlist: SavedPlaylist | null
): Track[] {
  if (playlist?.type !== 'local') return shuffleArray(tracks);
  if (playlist.queueMode === 'ordered') return tracks;

  const uniqueTracks = Array.from(new Map(tracks.map((track) => [track.id, track])).values());
  return prepareTracksForPlayback(uniqueTracks, playlist);
}

interface DjMemoryState {
  songs: ReturnType<typeof trackToSongInfo>[];
  announcements: string[];
}

interface SegmentRequestContext {
  language: HostSettings['announcerLanguage'];
  memory?: DjMemoryState;
  listenerInteraction: boolean;
  researchedTrivia: boolean;
  audioQuality: PlaybackSettings['audioQuality'];
}

/** Fetch generated or prerecorded segment audio. Songs stream directly. */
async function fetchItemBlob(
  item: Exclude<RadioItem, { kind: 'song' }>,
  signal: AbortSignal,
  context: SegmentRequestContext
): Promise<{ blob?: Blob; directUrl?: string; ttsProvider?: string; llmModel?: string; script?: string; adTitle?: string; sponsorBrand?: string; sponsorSource?: string; thumbnailUrl?: string }> {
  // --- jingle (GET) ---
  if (item.kind === 'jingle') {
    const slot = item.slot ?? 'intro';
    const query = `?slot=${slot}`;
    const res = await backendFetch(`/v1/host/jingles/random${query}`, { signal }, `/api/host/jingle${query}`);
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

  // --- folder ad (GET) ---
  if (item.kind === 'ad') {
    const res = await backendFetch('/v1/host/ads/random', { signal }, '/api/host/ad');
    if (res.status === 404) {
      throw new OptionalSegmentUnavailable('No ad file is configured in public/ads');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ad fetch failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const encodedTitle = res.headers.get('x-ad-title');
    const encodedThumbnail = res.headers.get('x-ad-thumbnail');
    const encodedSponsor = res.headers.get('x-ad-sponsor');
    const encodedThumbnailUrl = res.headers.get('x-ad-thumbnail-url');
    const youtubeId = res.headers.get('x-ad-youtube-id');
    let adTitle: string | undefined;
    let sponsorBrand: string | undefined;
    if (encodedSponsor) {
      try { sponsorBrand = decodeURIComponent(encodedSponsor); } catch { sponsorBrand = encodedSponsor; }
    }
    if (encodedTitle) {
      try {
        adTitle = decodeURIComponent(encodedTitle);
      } catch {
        adTitle = encodedTitle;
      }
    }
    let thumbnailUrl: string | undefined;
    if (encodedThumbnail) {
      let mediaFileName = encodedThumbnail;
      try {
        mediaFileName = decodeURIComponent(encodedThumbnail);
      } catch {}
      const query = `?thumbnail=${encodeURIComponent(mediaFileName)}`;
      thumbnailUrl = await backendMediaUrl(
        `/v1/host/ads/random${query}`,
        `/api/host/ad${query}`
      );
    } else if (encodedThumbnailUrl) {
      try {
        const candidate = new URL(decodeURIComponent(encodedThumbnailUrl));
        if (
          candidate.protocol === 'https:' &&
          (candidate.hostname === 'i.ytimg.com' || candidate.hostname.endsWith('.ytimg.com'))
        ) {
          thumbnailUrl = candidate.toString();
        }
      } catch {}
    }
    let directUrl: string | undefined;
    if (youtubeId && /^[A-Za-z0-9_-]{11}$/.test(youtubeId)) {
      const quality = context.audioQuality;
      directUrl = await backendMediaUrl(
        `/v1/youtube/audio/${encodeURIComponent(youtubeId)}?quality=${quality}`,
        `/api/audio/${encodeURIComponent(youtubeId)}?quality=${quality}`
      );
    }
    return {
      blob: directUrl ? undefined : await res.blob(),
      directUrl,
      adTitle,
      sponsorBrand,
      thumbnailUrl,
    };
  }

  // Sponsor credits use stable Japanese recordings and a persistent backend cache.
  if (item.kind === 'sponsor') {
    const brand = item.brand?.trim();
    if (!brand) throw new OptionalSegmentUnavailable('The sponsor message has no sponsor title');
    const response = await cachedAudioBlob(`sponsor:ja:${brand.toLocaleLowerCase('en-US')}`, 365 * 24 * 60 * 60 * 1000, () =>
      backendFetch(`/v1/host/sponsor-credit?brand=${encodeURIComponent(brand)}`, { signal }, `/api/host/sponsor-credit?brand=${encodeURIComponent(brand)}`)
    );
    return { blob: response.blob, sponsorBrand: brand, sponsorSource: response.headers.get('x-sponsor-credit-source') || undefined };
  }

  // --- chatter / news / weather / traffic (POST) ---
  const isPreroll = item.id.startsWith('preroll-');
  let payload: Record<string, unknown>;
  switch (item.kind) {
    case 'chatter':
      payload = {
        kind: 'chatter',
        previousSong: item.previousSong ? trackToSongInfo(item.previousSong) : undefined,
        nextSong: trackToSongInfo(item.nextSong),
        discussionFocus: item.discussionFocus ?? 'transition',
        isPreroll,
        language: context.language,
        memory: context.memory,
        listenerInteraction: context.listenerInteraction,
        researchedTrivia: context.researchedTrivia,
      };
      break;
    case 'news':
      payload = { kind: 'news', focus: item.focus, isPreroll, language: context.language };
      break;
    case 'weather':
      payload = {
        kind: 'weather',
        isPreroll,
        isNoon: item.id.startsWith('preroll-noon-'),
        language: context.language,
      };
      break;
    case 'traffic':
      payload = { kind: 'traffic', isPreroll, language: context.language };
      break;
  }

  const loadSegment = () => backendFetch('/v1/host/segments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  }, '/api/host/segment');
  const cacheTtl = item.kind === 'news' ? 60 * 60 * 1000 : item.kind === 'weather' ? 3 * 60 * 60 * 1000 : 0;
  let blob: Blob;
  let headers: Headers;
  if (cacheTtl) {
    const cached = await cachedAudioBlob(`segment:${item.kind}:${context.language}:${item.id}`, cacheTtl, loadSegment);
    blob = cached.blob;
    headers = cached.headers;
  } else {
    const res = await loadSegment();
    if (res.status === 204) throw new OptionalSegmentUnavailable(`${item.kind} is not configured`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Segment (${item.kind}) fetch failed: ${res.status} ${body.slice(0, 200)}`);
    }
    blob = await res.blob();
    headers = res.headers;
  }
  const ttsProvider = headers.get('x-tts-provider') || undefined;
  const llmModel = headers.get('x-llm-model') || undefined;
  const encodedScript = headers.get('x-script');
  let script: string | undefined;
  if (encodedScript) {
    try {
      script = decodeURIComponent(encodedScript);
    } catch {
      script = undefined;
    }
  }
  return { blob, ttsProvider, llmModel, script };
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
  llmModel?: string;
  script?: string;
  thumbnailUrl?: string;
  visualUrl?: string;
  adTitle?: string;
  sponsorBrand?: string;
  sponsorSource?: string;
}

/** Human-readable label for non-song items. */
function segmentLabel(item: RadioItem): string {
  switch (item.kind) {
    case 'chatter':
      if (item.discussionFocus === 'previous') return '前の曲を振り返る';
      if (item.discussionFocus === 'next') return '次の曲を紹介';
      return 'ラジオホスト';
    case 'news':    return 'ニュース';
    case 'weather': return '天気予報';
    case 'traffic': return '交通情報';
    case 'ad':      return '広告';
    case 'sponsor': return 'スポンサー提供';
    case 'jingle':
      if (item.slot === 'intro') return 'イントロジングル';
      if (item.slot === 'outro') return 'アウトロジングル';
      return 'ジングル';
    default:        return '';
  }
}

function loadingLabel(item: RadioItem): string {
  switch (item.kind) {
    case 'chatter': return 'ラジオホスト セグメント生成中...';
    case 'news':    return 'ニュースを取得中...';
    case 'weather': return '天気予報を取得中...';
    case 'traffic': return '交通情報を取得中...';
    case 'ad':      return '広告を読み込み中...';
    case 'sponsor': return 'スポンサー提供を生成中...';
    case 'jingle':  return 'ジングル読み込み中...';
    default:        return 'トラック読み込み中...';
  }
}

export default function Home() {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hostSettings, setHostSettings] = useState<HostSettings>(DEFAULT_HOST_SETTINGS);
  const [playbackSettings, setPlaybackSettings] = useState<PlaybackSettings>(DEFAULT_PLAYBACK_SETTINGS);
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
  const djMemoryRef = useRef<DjMemoryState>({ songs: [], announcements: [] });
  const adTitlesRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const loaded = loadPlaylists();
    const savedActiveId = loadActivePlaylistId();
    void hydratePlaylistQueues(loaded).then((hydrated) => {
      setPlaylists(hydrated);
      setActiveId(savedActiveId ?? hydrated[0]?.id ?? null);
      savePlaylists(hydrated);
    });
    setHostSettings(loadHostSettings());
    setPlaybackSettings(loadPlaybackSettings());
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
    djMemoryRef.current = { songs: [], announcements: [] };
    adTitlesRef.current.clear();

    if (activePlaylist.type === 'radio') {
      setIsLoading(false);
      return;
    }

    const trackLoad =
      activePlaylist.type === 'youtube'
        ? backendFetch(
            `/v1/youtube/playlists/${encodeURIComponent(activePlaylist.playlistId)}`,
            {},
            `/api/playlist/${encodeURIComponent(activePlaylist.playlistId)}`
          )
          .then(async (res) => {
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error ?? `Fetch failed: ${res.status}`);
            }
            return res.json();
          })
        : loadLocalLibrary(activePlaylist);

    trackLoad
      .then((data: Track[]) => {
        if (cancelled) return;
        if (!Array.isArray(data) || data.length === 0) {
          setError(
            activePlaylist.type === 'local'
              ? 'No audio files found in that folder.'
              : 'Playlist is empty.'
          );
          return;
        }

        const preparedTracks = prepareTracksForPlayback(data, activePlaylist);
        if (preparedTracks.length === 0) {
          setError(
            activePlaylist.type === 'local' && Array.isArray(activePlaylist.includedTrackIds)
              ? 'No songs from this saved local queue were found in the folder.'
              : 'Playlist is empty.'
          );
          return;
        }

        setTracks(preparedTracks);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Could not load tracks:', err instanceof Error ? err.message : String(err));
        setError(err instanceof Error ? err.message : 'Could not load tracks.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activePlaylist, playbackSettings.audioQuality]);

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
    if (currentItem?.kind === 'song') {
      djMemoryRef.current.songs = [
        ...djMemoryRef.current.songs,
        trackToSongInfo(currentItem.track),
      ].slice(-10);
    } else if (
      currentItem &&
      currentItem.kind !== 'jingle' &&
      currentItem.kind !== 'ad' &&
      preparedCurrentAudio?.script
    ) {
      djMemoryRef.current.announcements = [
        ...djMemoryRef.current.announcements,
        preparedCurrentAudio.script,
      ].slice(-5);
    }
    setCurrentIndex((previousIndex) =>
      Math.min(previousIndex + 1, radioQueue.length)
    );
  }, [
    radioQueue,
    currentItem, preparedCurrentAudio?.script, radioQueue.length]);

  useEffect(() => {
    if (radioQueue.length > 0 && currentIndex >= radioQueue.length) {
      setIncludePreroll(false);
      setTracks((currentTracks) => prepareTracksForNextCycle(currentTracks, activePlaylist));
      setCurrentIndex(0);
    }
  }, [activePlaylist, currentIndex, radioQueue.length]);

  useEffect(() => {
    const keep = new Set<string>();
    if (currentItem) keep.add(currentItem.id);
    if (nextItem) keep.add(nextItem.id);
    for (const id of Array.from(keep)) {
      const item = radioQueue.find((candidate) => candidate.id === id);
      if (item && item.kind === 'sponsor' && item.adItemId) {
        keep.add(item.adItemId);
      }
    }

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
      const promise = (async (): Promise<PreparedAudio> => {
        if (item.kind === 'song') {
          if (item.track.source === 'local' && item.track.directoryHandleId) {
            return {
              itemId: item.id,
              url: await createLocalTrackObjectUrl(item.track),
              revocable: true,
            };
          }
          if (item.track.source === 'youtube') {
            const videoId = item.track.id.replace(/^youtube:/, '');
            const quality = playbackSettings.audioQuality;
            return {
              itemId: item.id,
              url: await backendMediaUrl(
                `/v1/youtube/audio/${encodeURIComponent(videoId)}?quality=${quality}`,
                `/api/audio/${encodeURIComponent(videoId)}?quality=${quality}`
              ),
              revocable: false,
            };
          }
          return { itemId: item.id, url: item.track.audioUrl, revocable: false };
        }


        let requestItem: Exclude<RadioItem, { kind: 'song' }> = item;
        let resolvedSponsorTitle: string | undefined;

        if (item.kind === 'ad') {
          adTitlesRef.current.delete(item.id);
        }

        if (item.kind === 'sponsor') {
          let title = adTitlesRef.current.get(item.adItemId);
          if (!title) {
            const adItem = radioQueue.find((candidate) => candidate.id === item.adItemId);
            if (!adItem || adItem.kind !== 'ad') {
              throw new OptionalSegmentUnavailable('The sponsor message has no matching ad');
            }
            const preparedAd = await ensure(adItem);
            title = preparedAd.sponsorBrand ?? preparedAd.adTitle;
          }
          if (!title) {
            throw new OptionalSegmentUnavailable('The chosen ad has no sponsor title');
          }
          resolvedSponsorTitle = title;
          requestItem = { ...item, brand: title };
        }

        const { blob, directUrl, ttsProvider, llmModel, script, adTitle, sponsorBrand, sponsorSource, thumbnailUrl } = await fetchItemBlob(
          requestItem,
          controller.signal,
          {
            language: hostSettings.announcerLanguage,
            memory: hostSettings.djMemoryEnabled
              ? {
                  songs: [...djMemoryRef.current.songs],
                  announcements: [...djMemoryRef.current.announcements],
                }
              : undefined,
            listenerInteraction: hostSettings.listenerInteractionEnabled,
            researchedTrivia: hostSettings.researchedChatter,
            audioQuality: playbackSettings.audioQuality,
          }
        );
        const preparedAdTitle = resolvedSponsorTitle ?? adTitle;
        if (item.kind === 'ad' && preparedAdTitle) {
          adTitlesRef.current.set(item.id, preparedAdTitle);
        }
        if (!blob && !directUrl) throw new Error('Prepared segment did not provide audio');
        const url = directUrl ?? URL.createObjectURL(blob!);
        return {
          itemId: item.id,
          url,
          revocable: Boolean(blob),
          thumbnailUrl,
          visualUrl: blob?.type.startsWith('video/') ? url : undefined,
          ttsProvider,
          llmModel,
          adTitle: preparedAdTitle,
          sponsorBrand,
          sponsorSource,
          script,
        };
      })()
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
        console.warn('Failed to load item', currentItem.id, err instanceof Error ? err.message : String(err));
        if (currentItem.kind !== 'song') {
          // If a speech segment fails to generate (e.g. TTS API 429), automatically skip it to keep the music playing
          console.warn(`[Preloader] Speech segment ${currentItem.kind} failed. Skipping to keep the player active.`);
          handleNext();
        } else {
          setTrackError('Failed to load audio');
        }
      });

    const preloadTimeoutIds: NodeJS.Timeout[] = [];
    if (nextItem) {
      if (nextItem.kind === 'song') {
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
        // Debounce speech segment preloading to avoid rate limits (429) during skipping
        const preloadTimeoutId = setTimeout(() => {
          ensure(nextItem)
            .then((resource) => {
              if (!cancelled) setNextAudio(resource);
            })
            .catch((err) => {
              if (!isAbortError(err)) {
                console.warn('Preload failed for', nextItem.id, err);
              }
            });
        }, 2500);
        preloadTimeoutIds.push(preloadTimeoutId);
      }
    } else {
      setNextAudio(null);
    }


    return () => {
      cancelled = true;
      for (const timeoutId of preloadTimeoutIds) clearTimeout(timeoutId);
    };
  }, [
    radioQueue,
    currentItem,
    nextItem,
    handleNext,
    hostSettings.announcerLanguage,
    hostSettings.djMemoryEnabled,
    hostSettings.listenerInteractionEnabled,
    hostSettings.researchedChatter,
    playbackSettings.audioQuality,
  ]);

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
  }, [
    radioQueue,
    currentItem, handleNext]);

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

  const handleUpdatePlaylist = useCallback((entry: SavedPlaylist) => {
    setPlaylists((prev) => {
      const next = prev.map((playlist) => playlist.id === entry.id ? entry : playlist);
      savePlaylists(next);
      return next;
    });
  }, []);

  const handleRemovePlaylist = useCallback(
    (id: string) => {
      setPlaylists((prev) => {
        const removed = prev.find((playlist) => playlist.id === id);
        void deletePlaylistQueue(id).catch(() => undefined);
        if (removed?.type === 'local' && removed.directoryHandleId) {
          clearLocalDirectoryFiles(removed.directoryHandleId);
          void deleteDirectoryHandle(removed.directoryHandleId).catch(() => undefined);
        }
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
    for (const request of inflightRef.current.values()) request.controller.abort();
    inflightRef.current.clear();
    for (const resource of cacheRef.current.values()) {
      if (resource.revocable) URL.revokeObjectURL(resource.url);
    }
    cacheRef.current.clear();
    djMemoryRef.current = { songs: [], announcements: [] };
    adTitlesRef.current.clear();
    setCurrentAudio(null);
    setNextAudio(null);
    setTracks((currentTracks) => prepareTracksForNextCycle(currentTracks, activePlaylist));
    setHostSettings(settings);
    saveHostSettings(settings);
    setIncludePreroll(true);
    setCurrentIndex(0);
  }, [activePlaylist]);

  const handlePlaybackSettingsChange = useCallback((settings: PlaybackSettings) => {
    for (const request of inflightRef.current.values()) request.controller.abort();
    inflightRef.current.clear();
    for (const resource of cacheRef.current.values()) {
      if (resource.revocable) URL.revokeObjectURL(resource.url);
    }
    cacheRef.current.clear();
    setCurrentAudio(null);
    setNextAudio(null);
    setPlaybackSettings(settings);
    savePlaybackSettings(settings);
  }, []);

  // Resolve display track: for songs it's the track itself; for chatter
  // it's the nextSong; for other segments use the next song in the queue.
  const displayTrack: Track | null = (() => {
    if (!currentItem) return null;
    if (currentItem.kind === 'song') return currentItem.track;
    if (currentItem.kind === 'chatter') {
      if (currentItem.discussionFocus === 'previous') return currentItem.previousSong ?? currentItem.nextSong;
      return currentItem.nextSong;
    }
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
        year: currentItem.track.year,
        genre: currentItem.track.genre,
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
      album = 'Japan Nationwide Forecast';
    } else if (currentItem.kind === 'traffic') {
      artist = 'TomTom Traffic';
      album = 'Tokyo Traffic Alert';
    } else if (currentItem.kind === 'ad') {
      artist = preparedCurrentAudio?.adTitle ?? 'Sponsor message';
      album = 'Folder sponsor message';
    } else if (currentItem.kind === 'sponsor') {
      artist = 'AnyVoiceLab';
      const sponsorTitle = preparedCurrentAudio?.adTitle ?? currentItem.brand;
      album = sponsorTitle ? `Sponsored by ${sponsorTitle}` : 'Sponsor credit';
    } else if (currentItem.kind === 'jingle') {
      artist = 'Radio AI Station';
      album = 'Station Break';
    }

    return {
      title: label,
      artist,
      album,
      year: undefined,
      genre: undefined,
    };
  })();

  const isSegment = currentItem && currentItem.kind !== 'song';
  const backdropThumbnail = isInternationalRadio
    ? liveStation?.favicon?.trim() || ''
    : preparedCurrentAudio?.thumbnailUrl?.trim() || displayTrack?.thumbnail?.trim() || '';

  return (
    <div className="radio-page font-sans grid grid-rows-[auto_1fr_auto] items-center justify-items-center min-h-screen p-4 sm:p-12 pb-20 gap-6 sm:gap-8">
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

      <header className="radio-glass relative z-10 text-center w-full max-w-2xl flex items-center justify-between rounded-2xl px-4 py-3 sm:px-5 sm:py-4 gap-2">
        <Image
          src="/Logo/Logo_No_backgound.png"
          alt="mirAI melody logo"
          width={48}
          height={48}
          priority
          className="absolute left-3 sm:left-4 h-8 w-8 sm:h-10 sm:w-10 object-contain"
        />
        <h1 className="text-2xl sm:text-4xl font-bold tracking-tight">mirAI melody 73.9 FM</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-gray-700 text-xl sm:text-2xl flex items-center justify-center shrink-0"
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
          <InternationalRadio
            quality={playbackSettings.audioQuality}
            onStationChange={setLiveStation}
          />
        ) : currentItem ? (
          <>
            {isSegment && (
              <div className="radio-glass border border-purple-400/30 rounded-lg px-4 py-2 text-sm text-purple-100 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-center sm:text-left w-full">
                <span className="font-semibold text-purple-200">{segmentLabel(currentItem)}</span>
                {preparedCurrentAudio?.llmModel && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 shrink-0">
                    LLM: {preparedCurrentAudio.llmModel}
                  </span>
                )}
                {preparedCurrentAudio?.ttsProvider && (
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 border border-purple-500/30 text-purple-300 shrink-0">
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
                videoUrl={preparedCurrentAudio.visualUrl}
                audioUrl={preparedCurrentAudio.url}
                nextItemId={nextItem?.id}
                nextAudioUrl={preparedNextAudio?.url}
                thumbnailUrl={preparedCurrentAudio.thumbnailUrl ?? displayTrack?.thumbnail ?? ''}
                onFinished={handleNext}
                isSegment={!!isSegment}
                isJingle={currentItem.kind === 'jingle' || currentItem.kind === 'ad'}
                isChatter={currentItem.kind === 'chatter'}
                nextIsSegment={!!nextItem && nextItem.kind !== 'song'}
                nextIsJingle={nextItem?.kind === 'jingle' || nextItem?.kind === 'ad'}
                normalizationGain={
                  hostSettings.audioNormalization && currentItem.kind === 'song'
                    ? currentItem.track.normalizationGain ?? 1
                    : 1
                }
                nextNormalizationGain={
                  hostSettings.audioNormalization && nextItem?.kind === 'song'
                    ? nextItem.track.normalizationGain ?? 1
                    : 1
                }
                autoSkipOnError={
                  currentItem.kind === 'song' && currentItem.track.source === 'youtube'
                }
                playbackErrorMessage={
                  currentItem.kind === 'song' && currentItem.track.source === 'youtube'
                    ? 'YouTube temporarily unavailable — skipping this song'
                    : 'Playback error'
                }
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
                {(displayInfo.year || displayInfo.genre?.length) && (
                  <p className={'text-xs text-gray-400 my-1 flex flex-wrap justify-center gap-x-2 gap-y-1'}>
                    {displayInfo.year && <span>{displayInfo.year}</span>}
                    {displayInfo.genre?.map((genre) => (
                      <span key={genre} className={'rounded-full border border-white/10 bg-white/5 px-2 py-0.5'}>
                        {genre}
                      </span>
                    ))}
                  </p>
                )}
                {currentItem.kind === 'song' &&
                  hostSettings.audioNormalization &&
                  currentItem.track.normalizationGain && (
                    <p className={'text-[11px] text-emerald-300/70 mt-1'}>
                      ReplayGain {currentItem.track.normalizationGain.toFixed(2)}x
                    </p>
                  )}
                {displayInfo.album && (
                  <p className="text-sm text-gray-400">{displayInfo.album}</p>
                )}
                {currentItem.kind === 'song' && (
                  <p className="mt-1 text-[11px] text-gray-400">
                    {[
                      currentItem.track.codec,
                      currentItem.track.bitrate ? `${currentItem.track.bitrate} kbps` : undefined,
                      currentItem.track.sampleRate ? `${Math.round(currentItem.track.sampleRate / 100) / 10} kHz` : undefined,
                      currentItem.track.bitDepth ? `${currentItem.track.bitDepth}-bit` : undefined,
                      currentItem.track.lossless === true ? 'lossless source' : currentItem.track.lossless === false ? 'lossy source' : undefined,
                    ].filter(Boolean).join(' / ') || `${playbackSettings.audioQuality} quality mode`}
                  </p>
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
        onUpdate={handleUpdatePlaylist}
        onRemove={handleRemovePlaylist}
        hostSettings={hostSettings}
        onHostSettingsChange={handleHostSettingsChange}
        playbackSettings={playbackSettings}
        onPlaybackSettingsChange={handlePlaybackSettingsChange}
      />
    </div>
  );
}