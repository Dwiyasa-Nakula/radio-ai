import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldContinueTtsFallback } from '../../../src/app/lib/tts';

test('TTS provider timeouts advance while caller aborts stop fallback', () => {
  assert.equal(shouldContinueTtsFallback(undefined, new DOMException('attempt timed out', 'TimeoutError')), true);
  assert.equal(shouldContinueTtsFallback(undefined, new DOMException('caller aborted', 'AbortError')), false);

  const controller = new AbortController();
  controller.abort();
  assert.equal(shouldContinueTtsFallback(controller.signal, new DOMException('timed out', 'TimeoutError')), false);
});
