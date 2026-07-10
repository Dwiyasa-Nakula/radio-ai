// src/app/lib/playlists.ts
import type { HostSettings, SavedPlaylist } from './types';
import { DEFAULT_HOST_SETTINGS } from './types';

const STORAGE_KEY = 'radio-ai:playlists-v1';
const ACTIVE_KEY = 'radio-ai:active-playlist-v1';
const HOST_KEY = 'radio-ai:host-settings-v1';

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as SavedPlaylist[];
    if (!Array.isArray(parsed)) throw new Error('not an array');
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    const seeded = defaultPlaylists();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
}

export function savePlaylists(playlists: SavedPlaylist[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
}

export function loadActivePlaylistId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActivePlaylistId(id: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACTIVE_KEY, id);
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
      chatterEnabled:
        typeof parsed.chatterEnabled === 'boolean'
          ? parsed.chatterEnabled
          : DEFAULT_HOST_SETTINGS.chatterEnabled,
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
      morningPreroll:
        typeof parsed.morningPreroll === 'boolean' ? parsed.morningPreroll : DEFAULT_HOST_SETTINGS.morningPreroll,
      noonPreroll:
        typeof parsed.noonPreroll === 'boolean' ? parsed.noonPreroll : DEFAULT_HOST_SETTINGS.noonPreroll,
    };
  } catch {
    return DEFAULT_HOST_SETTINGS;
  }
}

export function saveHostSettings(settings: HostSettings): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(HOST_KEY, JSON.stringify(settings));
}
