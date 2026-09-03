// src/app/lib/types.ts

import type { AudioQuality as SharedAudioQuality } from '@radio-ai/contracts';

export type AudioQuality = SharedAudioQuality;

export type TrackSource = 'youtube' | 'local';

export interface Track {
  id: string;
  source: TrackSource;
  title: string;
  artist: string;
  thumbnail: string;
  audioUrl: string;
  album?: string;
  year?: number;
  duration?: number;
  genre?: string[];
  publishedAt?: string;
  sourceNotes?: string;
  normalizationGain?: number;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  lossless?: boolean;
  fileSize?: number;
  lastModified?: number;
  relativePath?: string;
  directoryHandleId?: string;
}

export type AnnouncerLanguage = 'ja' | 'en';
export type LocalQueueMode = 'random' | 'ordered';
export type PlayOrder = 'fullShow' | 'classic';
export type DiscussionFocus = 'previous' | 'next' | 'transition';
export type JingleSlot = 'intro' | 'outro';

export interface SavedYoutubePlaylist {
  id: string;
  name: string;
  type: 'youtube';
  playlistId: string;
}

export interface SavedLocalPlaylist {
  id: string;
  name: string;
  type: 'local';
  path?: string;
  localMode?: 'browser' | 'server' | 'input';
  directoryHandleId?: string;
  /**
   * Undefined means "use every song in the folder". When present, the array is
   * both an inclusion filter and the queue order for that local playlist.
   */
  includedTrackIds?: string[];
  /**
   * Random is the default for both whole-folder and custom local queues.
   * Ordered follows includedTrackIds (or the folder scan order).
   */
  queueMode?: LocalQueueMode;
  /** Up to three selected local tracks receive a 10% extra-play chance in random mode. */
  favoriteTrackIds?: string[];
}

export interface SavedRadioPlaylist {
  id: string;
  name: string;
  type: 'radio';
}

export type SavedPlaylist =
  | SavedYoutubePlaylist
  | SavedLocalPlaylist
  | SavedRadioPlaylist;

export type RadioCountryCode = 'JP' | 'CN' | 'KR';

export interface RadioStation {
  id: string;
  name: string;
  country: string;
  countryCode: RadioCountryCode;
  state: string;
  language: string;
  tags: string[];
  codec: string;
  bitrate: number;
  sampleRate?: number;
  bitDepth?: number;
  lossless?: boolean;
  favicon: string;
  homepage: string;
  streamUrl: string;
  votes: number;
}

export interface SongItem {
  kind: 'song';
  id: string;
  track: Track;
}

export interface ChatterItem {
  kind: 'chatter';
  id: string;
  previousSong?: Track;
  nextSong: Track;
  discussionFocus?: DiscussionFocus;
}

export interface NewsItem {
  kind: 'news';
  id: string;
  focus?: string;
}

export interface WeatherItem {
  kind: 'weather';
  id: string;
}

export interface TrafficItem {
  kind: 'traffic';
  id: string;
}

export interface JingleItem {
  kind: 'jingle';
  id: string;
  slot?: JingleSlot;
}

export interface AdItem {
  kind: 'ad';
  id: string;
}

export interface SponsorItem {
  kind: 'sponsor';
  id: string;
  adItemId: string;
  brand: string;
}


export type RadioItem =
  | SongItem
  | ChatterItem
  | NewsItem
  | WeatherItem
  | TrafficItem
  | JingleItem
  | AdItem
  | SponsorItem;

export interface HostSettings {
  enabled: boolean;
  playOrder: PlayOrder;
  chatterEnabled: boolean;
  separateSongDiscussions: boolean;
  researchedChatter: boolean;
  frequency: number;
  newsEvery: number;
  newsFocus: string;
  trafficEvery: number;
  jingleEvery: number;
  adsEnabled: boolean;
  adEvery: number;
  morningPreroll: boolean;
  noonPreroll: boolean;
  announcerLanguage: AnnouncerLanguage;
  djMemoryEnabled: boolean;
  listenerInteractionEnabled: boolean;
  audioNormalization: boolean;
}

export interface PlaybackSettings {
  audioQuality: AudioQuality;
}

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  enabled: true,
  playOrder: 'fullShow',
  chatterEnabled: true,
  separateSongDiscussions: false,
  researchedChatter: true,
  frequency: 1,
  newsEvery: 0,
  newsFocus: '',
  trafficEvery: 10,
  jingleEvery: 0,
  morningPreroll: true,
  adsEnabled: false,
  adEvery: 1,
  noonPreroll: true,
  announcerLanguage: 'ja',
  djMemoryEnabled: true,
  listenerInteractionEnabled: true,
  audioNormalization: true,
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  audioQuality: 'balanced',
};
