import assert from 'node:assert/strict';
import test from 'node:test';
import { findConfiguredAdFile, parseByteRange } from './adDelivery';

test('specific ad files must exactly match a configured media file', () => {
  const files = ['Sakura Coffee.mp3', 'Tokyo-Mobile.MP4'];

  assert.equal(findConfiguredAdFile(files, 'sakura coffee.MP3'), 'Sakura Coffee.mp3');
  assert.equal(findConfiguredAdFile(files, '../Sakura Coffee.mp3'), undefined);
  assert.equal(findConfiguredAdFile(files, 'Tokyo-Mobile'), undefined);
  assert.equal(findConfiguredAdFile(files, ''), undefined);
  assert.equal(findConfiguredAdFile(files, ['Sakura Coffee.mp3']), undefined);
});

test('local MP4 and audio streams accept one bounded byte range', () => {
  assert.deepEqual(parseByteRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(parseByteRange('bytes=900-', 1000), { start: 900, end: 999 });
  assert.deepEqual(parseByteRange('bytes=900-1200', 1000), { start: 900, end: 999 });
  assert.equal(parseByteRange('bytes=-100', 1000), undefined);
  assert.equal(parseByteRange('bytes=1000-', 1000), undefined);
  assert.equal(parseByteRange('bytes=200-100', 1000), undefined);
  assert.equal(parseByteRange('bytes=0-1,4-5', 1000), undefined);
});
