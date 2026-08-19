import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NEWS_SEGMENT_TTL_MS,
  TimedPromiseCache,
  WEATHER_SEGMENT_TTL_MS,
  segmentCachePolicy,
} from '../../../src/app/lib/segmentAudioCache';

test('news and weather use requested server TTLs while traffic bypasses cache', () => {
  assert.equal(segmentCachePolicy({ kind: 'news', language: 'en', focus: 'Japan' })?.ttlMs, NEWS_SEGMENT_TTL_MS);
  assert.equal(segmentCachePolicy({ kind: 'weather', language: 'ja' })?.ttlMs, WEATHER_SEGMENT_TTL_MS);
  assert.equal(segmentCachePolicy({ kind: 'traffic', language: 'ja' }), undefined);
});

test('segment cache coalesces generation and expires by absolute TTL', async () => {
  let now = 1_000;
  let generations = 0;
  const cache = new TimedPromiseCache<string>(() => now);
  const load = async () => `audio-${++generations}`;

  const [first, coalesced] = await Promise.all([
    cache.getOrCreate('news:en', 100, load),
    cache.getOrCreate('news:en', 100, load),
  ]);
  assert.equal(first.value, 'audio-1');
  assert.equal(coalesced.value, 'audio-1');
  assert.equal(generations, 1);

  now = 1_099;
  assert.equal((await cache.getOrCreate('news:en', 100, load)).value, 'audio-1');
  now = 1_100;
  assert.equal((await cache.getOrCreate('news:en', 100, load)).value, 'audio-2');
});
