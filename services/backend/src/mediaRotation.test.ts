import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaRotation } from '../../../src/app/lib/mediaRotation';
import { adTitleFromFileName } from '../../../src/app/lib/segments/adMetadata';

test('media rotation plays every file before repeating', () => {
  const rotation = new MediaRotation();
  const files = ['one.mp3', 'two.mp4', 'three.mp3'];
  const picks = [
    rotation.pick('intro', files, () => 0.25),
    rotation.pick('intro', files, () => 0.25),
    rotation.pick('intro', files, () => 0.25),
  ];

  assert.equal(new Set(picks).size, files.length);
  assert.deepEqual(new Set(picks), new Set(files));
});

test('media rotation avoids a cycle-boundary repeat', () => {
  const rotation = new MediaRotation();
  const files = ['one.mp3', 'two.mp4'];
  const first = rotation.pick('ads', files, () => 0);
  const second = rotation.pick('ads', files, () => 0);
  const third = rotation.pick('ads', files, () => 0);

  assert.notEqual(first, second);
  assert.notEqual(second, third);
});

test('media rotations are independent per folder and reset when files change', () => {
  const rotation = new MediaRotation();
  assert.ok(rotation.pick('intro', ['intro-a.mp3'], () => 0)?.startsWith('intro'));
  assert.ok(rotation.pick('outro', ['outro-a.mp3'], () => 0)?.startsWith('outro'));
  assert.equal(rotation.pick('intro', ['new-intro.mp4'], () => 0), 'new-intro.mp4');
});

test('ad filename fallback produces a clean sponsor title', () => {
  assert.equal(adTitleFromFileName('Sakura_Coffee-summer.mp4'), 'Sakura Coffee summer');
});
