import assert from 'node:assert/strict';
import test from 'node:test';
import { localTrackSearchText } from '../../../src/app/lib/localTrackSearch';
import type { Track } from '../../../src/app/lib/types';

test('local playlist search includes nested root-relative MP3 paths', () => {
  const nested: Track = {
    id: 'local:nested',
    source: 'local',
    title: 'Unknown title',
    artist: 'Unknown artist',
    thumbnail: '',
    audioUrl: '',
    relativePath: 'Artists/Album/Hidden Track.mp3',
  };

  assert.match(localTrackSearchText(nested), /artists\/album\/hidden track\.mp3/);
});