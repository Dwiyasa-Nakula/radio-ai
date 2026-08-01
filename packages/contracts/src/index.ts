export type AudioQuality = 'high' | 'balanced' | 'dataSaver';

export type AnnouncerLanguage = 'ja' | 'en';

export interface SongMetadata {
  title: string;
  artist: string;
  album?: string;
  year?: number;
  genre?: string[];
  publishedAt?: string;
  sourceNotes?: string;
}

export interface DjMemory {
  songs: SongMetadata[];
  announcements: string[];
}

export interface ChatterSegmentRequest {
  kind: 'chatter';
  previousSong?: SongMetadata;
  nextSong: SongMetadata;
  discussionFocus?: 'previous' | 'next' | 'transition';
  isPreroll?: boolean;
  language?: AnnouncerLanguage;
  memory?: DjMemory;
  listenerInteraction?: boolean;
  researchedTrivia?: boolean;
}

export interface NewsSegmentRequest {
  kind: 'news';
  focus?: string;
  isPreroll?: boolean;
  language?: AnnouncerLanguage;
}

export interface SimpleSegmentRequest {
  kind: 'weather' | 'traffic';
  isPreroll?: boolean;
  isNoon?: boolean;
  language?: AnnouncerLanguage;
}

export interface SponsorSegmentRequest {
  kind: 'sponsor';
  brand: string;
  language?: AnnouncerLanguage;
}


export type HostSegmentRequest =
  | ChatterSegmentRequest
  | NewsSegmentRequest
  | SimpleSegmentRequest
  | SponsorSegmentRequest;

export interface BackendSessionResponse {
  baseUrl: string;
  token: string;
  expiresAt: number;
}

export interface YouTubeVideoMetadata {
  videoId: string;
  title: string;
  thumbnailUrl: string;
}

export interface AudioTechnicalMetadata {
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  lossless?: boolean;
}
