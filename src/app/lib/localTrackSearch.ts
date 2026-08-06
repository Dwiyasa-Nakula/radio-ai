import type { Track } from './types';

export function localTrackSearchText(track: Track): string {
  return [
    track.title,
    track.artist,
    track.album,
    track.year,
    track.relativePath,
    ...(track.genre ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}