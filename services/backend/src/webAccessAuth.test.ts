import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptsWebAccess } from '../../../src/app/lib/webAccessAuth';

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

test('web access accepts only the configured Basic credentials', () => {
  assert.equal(acceptsWebAccess(basic('radio', 'correct horse battery staple'), 'radio', 'correct horse battery staple'), true);
  assert.equal(acceptsWebAccess(basic('radio', 'wrong'), 'radio', 'correct horse battery staple'), false);
  assert.equal(acceptsWebAccess(basic('someone', 'correct horse battery staple'), 'radio', 'correct horse battery staple'), false);
  assert.equal(acceptsWebAccess(null, 'radio', 'correct horse battery staple'), false);
  assert.equal(acceptsWebAccess('Bearer token', 'radio', 'correct horse battery staple'), false);
  assert.equal(acceptsWebAccess('Basic !!!', 'radio', 'correct horse battery staple'), false);
});