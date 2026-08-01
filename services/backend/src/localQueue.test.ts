import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLocalFavoriteBoost,
  LOCAL_FAVORITE_LIMIT,
  sanitizeLocalFavoriteTrackIds,
} from '../../../src/app/lib/localQueue';
import type { Track } from '../../../src/app/lib/types';

function track(id: string): Track {
  return {
    id: `local:${id}`,
    source: 'local',
    title: id,
    artist: 'Test Artist',
    thumbnail: '',
    audioUrl: `/audio/${id}`,
  };
}

test('local favorite IDs are unique, eligible, and capped at three', () => {
  const eligible = new Set(['local:a', 'local:b', 'local:c', 'local:d']);
  assert.deepEqual(
    sanitizeLocalFavoriteTrackIds(
      ['local:a', 'local:a', 'youtube:x', 'local:b', 'local:missing', 'local:c', 'local:d'],
      eligible
    ),
    ['local:a', 'local:b', 'local:c']
  );
  assert.equal(LOCAL_FAVORITE_LIMIT, 3);
});

test('a favorite can receive one extra non-adjacent play in a random loop', () => {
  const tracks = [track('a'), track('b'), track('c')];
  const randomValues = [0.05, 0.5];
  const boosted = applyLocalFavoriteBoost(
    tracks,
    ['local:a'],
    () => randomValues.shift() ?? 0.5
  );

  assert.equal(boosted.filter((candidate) => candidate.id === 'local:a').length, 2);
  assert.equal(boosted.length, tracks.length + 1);
  const favoriteIndexes = boosted.flatMap((candidate, index) =>
    candidate.id === 'local:a' ? [index] : []
  );
  assert.notEqual(favoriteIndexes[1] - favoriteIndexes[0], 1);
});

test('favorite playback averages about ten percent above a normal song', () => {
  const tracks = [track('favorite'), track('normal')];
  let state = 0x12345678;
  const seededRandom = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };

  let favoritePlays = 0;
  let normalPlays = 0;
  for (let cycle = 0; cycle < 20_000; cycle += 1) {
    const queue = applyLocalFavoriteBoost(tracks, ['local:favorite'], seededRandom);
    favoritePlays += queue.filter((candidate) => candidate.id === 'local:favorite').length;
    normalPlays += queue.filter((candidate) => candidate.id === 'local:normal').length;
  }

  const relativeFrequency = favoritePlays / normalPlays;
  assert.ok(relativeFrequency > 1.085 && relativeFrequency < 1.115, String(relativeFrequency));
});