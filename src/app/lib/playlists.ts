// src/app/lib/playlists.ts
import type { HostSettings, PlaybackSettings, SavedPlaylist } from './types';
import { DEFAULT_HOST_SETTINGS, DEFAULT_PLAYBACK_SETTINGS } from './types';
import { sanitizeLocalFavoriteTrackIds } from './localQueue';
import {
  deletePlaylistQueue,
  loadPlaylistQueue,
  savePlaylistQueue,
} from './browserStorage';

const STORAGE_KEY = 'radio-ai:playlists-v1';
const ACTIVE_KEY = 'radio-ai:active-playlist-v1';
const HOST_KEY = 'radio-ai:host-settings-v1';
const PLAYBACK_KEY = 'radio-ai:playback-settings-v1';

const SEED_YOUTUBE_PLAYLIST_ID = 'PLrGlZyus6hMJKwsv6k6R8rd2a9tlSCzLd';

const LOCAL_ID = 'local';
const INTERNATIONAL_RADIO_ID = 'international-radio';

function defaultPlaylists(): SavedPlaylist[] {
  return [
    {
      id: 'seed-youtube',
      name: 'My YouTube Playlist',
      type: 'youtube',
      playlistId: SEED_YOUTUBE_PLAYLIST_ID,
    },
    {
      id: LOCAL_ID,
      name: 'Local Files',
      type: 'local',
    },
    {
      id: INTERNATIONAL_RADIO_ID,
      name: 'International Radio',
      type: 'radio',
    },
  ];
}

export function loadPlaylists(): SavedPlaylist[] {
  if (typeof window === 'undefined') return defaultPlaylists();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = defaultPlaylists();
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      } catch {}
      return seeded;
    }
    const parsed = JSON.parse(raw) as SavedPlaylist[];
    if (!Array.isArray(parsed)) throw new Error('not an array');
    for (const playlist of parsed) {
      if (playlist.type !== 'local') continue;
      if (Array.isArray(playlist.includedTrackIds)) {
        playlist.includedTrackIds = playlist.includedTrackIds
          .filter((id): id is string => typeof id === 'string' && id.startsWith('local:'));
      }
      const favoriteTrackIds = sanitizeLocalFavoriteTrackIds(
        playlist.favoriteTrackIds,
        Array.isArray(playlist.includedTrackIds) ? new Set(playlist.includedTrackIds) : undefined
      );
      playlist.favoriteTrackIds = favoriteTrackIds.length > 0 ? favoriteTrackIds : undefined;
    }
    if (!parsed.some((p) => p.type === 'local')) {
      parsed.push({ id: LOCAL_ID, name: 'Local Files', type: 'local' });
    }
    if (!parsed.some((p) => p.type === 'radio')) {
      parsed.push({
        id: INTERNATIONAL_RADIO_ID,
        name: 'International Radio',
        type: 'radio',
      });
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    } catch {}
    return parsed;
  } catch {
    const seeded = defaultPlaylists();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    } catch {}
    return seeded;
  }
}

export function savePlaylists(playlists: SavedPlaylist[]): void {
  if (typeof window === 'undefined') return;
  try {
    const compact = playlists.map((playlist) => {
      if (playlist.type !== 'local') return playlist;
      if (Array.isArray(playlist.includedTrackIds)) {
        void savePlaylistQueue(playlist.id, playlist.includedTrackIds).catch((error) => {
          console.warn('Could not persist local queue to IndexedDB:', error);
        });
      } else {
        void deletePlaylistQueue(playlist.id).catch(() => undefined);
      }
      const favoriteTrackIds = sanitizeLocalFavoriteTrackIds(
        playlist.favoriteTrackIds,
        Array.isArray(playlist.includedTrackIds) ? new Set(playlist.includedTrackIds) : undefined
      );
      const {
        includedTrackIds: _queue,
        favoriteTrackIds: _favorites,
        ...metadata
      } = playlist;
      return favoriteTrackIds.length > 0 ? { ...metadata, favoriteTrackIds } : metadata;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(compact));
  } catch {}
}

export async function hydratePlaylistQueues(playlists: SavedPlaylist[]): Promise<SavedPlaylist[]> {
  if (typeof window === 'undefined') return playlists;

  return Promise.all(playlists.map(async (playlist) => {
    if (playlist.type !== 'local') return playlist;
    try {
      const storedQueue = await loadPlaylistQueue(playlist.id);
      if (storedQueue) {
        const favoriteTrackIds = sanitizeLocalFavoriteTrackIds(
          playlist.favoriteTrackIds,
          new Set(storedQueue)
        );
        return {
          ...playlist,
          includedTrackIds: storedQueue,
          favoriteTrackIds: favoriteTrackIds.length > 0 ? favoriteTrackIds : undefined,
        };
      }
      if (Array.isArray(playlist.includedTrackIds)) {
        await savePlaylistQueue(playlist.id, playlist.includedTrackIds);
      }
    } catch (error) {
      console.warn('Could not hydrate local queue from IndexedDB:', error);
    }
    return playlist;
  }));
}

export function loadActivePlaylistId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActivePlaylistId(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {}
}

export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z0-9_-]+$/.test(trimmed) && trimmed.length >= 13) return trimmed;
  const match = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

export function loadHostSettings(): HostSettings {
  if (typeof window === 'undefined') return DEFAULT_HOST_SETTINGS;
  try {
    const raw = localStorage.getItem(HOST_KEY);
    if (!raw) return DEFAULT_HOST_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<HostSettings>;
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_HOST_SETTINGS.enabled,
      playOrder:
        parsed.playOrder === 'classic' || parsed.playOrder === 'fullShow'
          ? parsed.playOrder
          : DEFAULT_HOST_SETTINGS.playOrder,
      chatterEnabled:
        typeof parsed.chatterEnabled === 'boolean'
          ? parsed.chatterEnabled
          : DEFAULT_HOST_SETTINGS.chatterEnabled,
      researchedChatter:
        typeof parsed.researchedChatter === 'boolean'
          ? parsed.researchedChatter
          : DEFAULT_HOST_SETTINGS.researchedChatter,
      frequency:
        typeof parsed.frequency === 'number' && parsed.frequency >= 1 && parsed.frequency <= 5
          ? Math.round(parsed.frequency)
          : DEFAULT_HOST_SETTINGS.frequency,
      newsEvery:
        typeof parsed.newsEvery === 'number' && parsed.newsEvery >= 0 && parsed.newsEvery <= 20
          ? Math.round(parsed.newsEvery)
          : DEFAULT_HOST_SETTINGS.newsEvery,
      newsFocus:
        typeof parsed.newsFocus === 'string'
          ? parsed.newsFocus.trim().slice(0, 160)
          : DEFAULT_HOST_SETTINGS.newsFocus,
      trafficEvery:
        typeof parsed.trafficEvery === 'number' && parsed.trafficEvery >= 0 && parsed.trafficEvery <= 20
          ? Math.round(parsed.trafficEvery)
          : DEFAULT_HOST_SETTINGS.trafficEvery,
      jingleEvery:
        typeof parsed.jingleEvery === 'number' && parsed.jingleEvery >= 0 && parsed.jingleEvery <= 20
          ? Math.round(parsed.jingleEvery)
          : DEFAULT_HOST_SETTINGS.jingleEvery,
      adsEnabled:
        typeof parsed.adsEnabled === 'boolean'
          ? parsed.adsEnabled
          : DEFAULT_HOST_SETTINGS.adsEnabled,
      adEvery:
        typeof parsed.adEvery === 'number' && parsed.adEvery >= 1 && parsed.adEvery <= 20
          ? Math.round(parsed.adEvery)
          : DEFAULT_HOST_SETTINGS.adEvery,
      morningPreroll:
        typeof parsed.morningPreroll === 'boolean' ? parsed.morningPreroll : DEFAULT_HOST_SETTINGS.morningPreroll,
      noonPreroll:
        typeof parsed.noonPreroll === 'boolean' ? parsed.noonPreroll : DEFAULT_HOST_SETTINGS.noonPreroll,
      announcerLanguage:
        parsed.announcerLanguage === 'en' || parsed.announcerLanguage === 'ja'
          ? parsed.announcerLanguage
          : DEFAULT_HOST_SETTINGS.announcerLanguage,
      djMemoryEnabled:
        typeof parsed.djMemoryEnabled === 'boolean'
          ? parsed.djMemoryEnabled
          : DEFAULT_HOST_SETTINGS.djMemoryEnabled,
      listenerInteractionEnabled:
        typeof parsed.listenerInteractionEnabled === 'boolean'
          ? parsed.listenerInteractionEnabled
          : DEFAULT_HOST_SETTINGS.listenerInteractionEnabled,
      audioNormalization:
        typeof parsed.audioNormalization === 'boolean'
          ? parsed.audioNormalization
          : DEFAULT_HOST_SETTINGS.audioNormalization,
    };
  } catch {
    return DEFAULT_HOST_SETTINGS;
  }
}

export function saveHostSettings(settings: HostSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(HOST_KEY, JSON.stringify(settings));
  } catch {}
}

export function loadPlaybackSettings(): PlaybackSettings {
  if (typeof window === 'undefined') return DEFAULT_PLAYBACK_SETTINGS;
  try {
    const parsed = JSON.parse(localStorage.getItem(PLAYBACK_KEY) ?? '{}') as Partial<PlaybackSettings>;
    return {
      audioQuality:
        parsed.audioQuality === 'balanced' || parsed.audioQuality === 'dataSaver'
          ? parsed.audioQuality
          : 'high',
    };
  } catch {
    return DEFAULT_PLAYBACK_SETTINGS;
  }
}

export function savePlaybackSettings(settings: PlaybackSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PLAYBACK_KEY, JSON.stringify(settings));
  } catch {}
}
