// src/app/lib/types.ts

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
}

export type SavedPlaylist =
  | { id: string; name: string; type: 'youtube'; playlistId: string }
  | { id: string; name: string; type: 'local'; path?: string }
  | { id: string; name: string; type: 'radio' };

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
}

export type RadioItem =
  | SongItem
  | ChatterItem
  | NewsItem
  | WeatherItem
  | TrafficItem
  | JingleItem;

export interface HostSettings {
  enabled: boolean;
  chatterEnabled: boolean;
  frequency: number;
  newsEvery: number;
  newsFocus: string;
  trafficEvery: number;
  jingleEvery: number;
  morningPreroll: boolean;
  noonPreroll: boolean;
}

export const DEFAULT_HOST_SETTINGS: HostSettings = {
  enabled: true,
  chatterEnabled: true,
  frequency: 1,
  newsEvery: 0,
  newsFocus: '',
  trafficEvery: 5,
  jingleEvery: 0,
  morningPreroll: true,
  noonPreroll: true,
};
