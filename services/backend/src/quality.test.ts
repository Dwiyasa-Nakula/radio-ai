import assert from 'node:assert/strict';
import test from 'node:test';
import { rankRadioStations } from '../../../src/app/lib/radioQuality';
import { youtubeCacheKey, youtubeFormatSelector } from '../../../src/app/lib/youtubeAudioCache';
import type { RadioStation } from '../../../src/app/lib/types';

function station(id: string, codec: string, bitrate: number, votes: number): RadioStation {
  return {
    id,
    name: id,
    country: 'Japan',
    countryCode: 'JP',
    state: '',
    language: '',
    tags: [],
    codec,
    bitrate,
    favicon: '',
    homepage: '',
    streamUrl: `https://example.com/${id}`,
    votes,
    lossless: false,
  };
}

test('quality modes use distinct YouTube resolution cache keys and selectors', () => {
  const keys = new Set([
    youtubeCacheKey('abcdefghijk', 'high'),
    youtubeCacheKey('abcdefghijk', 'balanced'),
    youtubeCacheKey('abcdefghijk', 'dataSaver'),
  ]);
  assert.equal(keys.size, 3);
  assert.doesNotMatch(youtubeFormatSelector('high'), /ext=m4a/);
  assert.match(youtubeFormatSelector('balanced'), /ext=m4a/);
  assert.match(youtubeFormatSelector('dataSaver'), /abr<=96/);
});

test('radio ranking follows high, balanced, and data saver priorities', () => {
  const stations = [
    station('popular', 'MP3', 320, 1000),
    station('efficient', 'AAC', 64, 10),
    station('modern', 'OPUS', 160, 100),
  ];
  assert.equal(rankRadioStations(stations, 'high')[0].id, 'modern');
  assert.equal(rankRadioStations(stations, 'balanced')[0].id, 'popular');
  assert.equal(rankRadioStations(stations, 'dataSaver')[0].id, 'efficient');
});
