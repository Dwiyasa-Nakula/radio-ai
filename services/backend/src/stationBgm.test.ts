import assert from 'node:assert/strict';
import test from 'node:test';
import { stationBgm } from './stationBgm';

test('station BGM points at the packaged MP3 asset', () => {
  assert.deepEqual(stationBgm('/app'), {
    filePath: '/app/public/audio/bgm.mp3',
    contentType: 'audio/mpeg',
  });
});
