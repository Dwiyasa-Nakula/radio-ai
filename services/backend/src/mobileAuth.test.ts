import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jwtVerify } from 'jose';
import {
  MOBILE_REFRESH_WINDOW_SECONDS,
  MOBILE_SCOPES,
  MOBILE_SESSION_SECONDS,
  configuredCredentialHashes,
  credentialMatches,
  deviceCredentialFromAuthorization,
  issueMobileSession,
  sha256Credential,
} from './mobileAuth';

const credential = 'device-enrollment-secret-123456';
const signingSecret = 'backend-signing-secret-at-least-thirty-two-characters';

test('accepts a configured SHA-256 device credential without storing plaintext', () => {
  const hash = sha256Credential(credential);
  assert.deepEqual(configuredCredentialHashes('invalid,' + hash.toUpperCase()), [hash]);
  assert.equal(credentialMatches(credential, [hash]), true);
  assert.equal(credentialMatches('revoked-secret-value', [hash]), false);
});

test('parses only the Device authorization scheme', () => {
  assert.equal(deviceCredentialFromAuthorization('Device ' + credential), credential);
  assert.equal(deviceCredentialFromAuthorization('Bearer ' + credential), undefined);
  assert.equal(deviceCredentialFromAuthorization('Device short'), undefined);
});

test('issues a one-hour scoped mobile session', async () => {
  const now = 1_800_000_000;
  const session = await issueMobileSession(signingSecret, 'https://radio.example.test/', now);
  assert.equal(session.baseUrl, 'https://radio.example.test');
  assert.equal(session.expiresAt, (now + MOBILE_SESSION_SECONDS) * 1000);
  assert.equal(MOBILE_REFRESH_WINDOW_SECONDS, 300);
  const verified = await jwtVerify(session.token, new TextEncoder().encode(signingSecret), {
    algorithms: ['HS256'],
    issuer: 'radio-ai-mobile',
    audience: 'radio-ai-backend',
    currentDate: new Date(now * 1000),
  });
  assert.deepEqual(verified.payload.scope, [...MOBILE_SCOPES]);
});
