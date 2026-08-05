import assert from 'node:assert/strict';
import test from 'node:test';
import { rankRadioStations } from '../../../src/app/lib/radioQuality';
import {
  isYouTubeChallengeError,
  youtubeCacheKey,
  youtubeExtractorArguments,
  youtubeFormatSelector,
} from '../../../src/app/lib/youtubeAudioCache';
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

test('YouTube extraction uses current default clients and the configured PO-token provider', () => {
  const original = process.env.YOUTUBE_PO_PROVIDER_URL;
  process.env.YOUTUBE_PO_PROVIDER_URL = 'http://127.0.0.1:4416';
  try {
    const args = youtubeExtractorArguments();
    assert.deepEqual(args.slice(0, 2), ['--js-runtimes', 'node']);
    assert.ok(args.includes('youtube:player_client=default'));
    assert.ok(args.includes('youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416'));
    assert.ok(!args.some((argument) => argument.includes('player_client=mweb')));
    assert.ok(!args.some((argument) => argument.includes('player_client=android')));
  } finally {
    if (original === undefined) delete process.env.YOUTUBE_PO_PROVIDER_URL;
    else process.env.YOUTUBE_PO_PROVIDER_URL = original;
  }
});

test('YouTube bot and PO-token failures are classified as retryable challenges', () => {
  assert.equal(isYouTubeChallengeError(new Error("Sign in to confirm you're not a bot")), true);
  assert.equal(isYouTubeChallengeError({ stderr: 'PO Token provider is not available' }), true);
  assert.equal(isYouTubeChallengeError(new Error('Googlevideo 500')), false);
});
