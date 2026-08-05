import assert from 'node:assert/strict';
import test from 'node:test';
import { YouTubeCircuitBreaker, YouTubeCircuitOpenError } from './youtubeAvailability';

test('YouTube circuit opens after repeated challenges and resets after cooldown', () => {
  let now = 1_000;
  const circuit = new YouTubeCircuitBreaker(3, 5_000, () => now);

  circuit.recordChallenge();
  circuit.recordChallenge();
  assert.equal(circuit.state().available, true);

  circuit.recordChallenge();
  assert.deepEqual(circuit.state(), {
    available: false,
    failures: 3,
    retryAfterSeconds: 5,
  });
  assert.throws(() => circuit.assertAvailable(), YouTubeCircuitOpenError);

  now += 5_001;
  assert.deepEqual(circuit.state(), {
    available: true,
    failures: 0,
    retryAfterSeconds: 0,
  });
});

test('a successful extraction resets challenge failures', () => {
  const circuit = new YouTubeCircuitBreaker(2);
  circuit.recordChallenge();
  circuit.recordSuccess();
  circuit.recordChallenge();
  assert.equal(circuit.state().available, true);
});
