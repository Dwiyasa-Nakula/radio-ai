import assert from 'node:assert/strict';
import test from 'node:test';
import { synthesizeAnyVoice } from '../../../src/app/lib/tts';

test('English sponsor TTS uses its English nonce, voice, and language', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    nonce: process.env.ANYVOICELAB_NONCE,
    nonceEn: process.env.ANYVOICELAB_NONCE_EN,
    cookie: process.env.ANYVOICELAB_COOKIE,
    voice: process.env.ANYVOICELAB_VOICE_ID,
    voiceEn: process.env.ANYVOICELAB_VOICE_ID_EN,
    languageEn: process.env.ANYVOICELAB_LANGUAGE_EN,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      ANYVOICELAB_NONCE: originalEnvironment.nonce,
      ANYVOICELAB_NONCE_EN: originalEnvironment.nonceEn,
      ANYVOICELAB_COOKIE: originalEnvironment.cookie,
      ANYVOICELAB_VOICE_ID: originalEnvironment.voice,
      ANYVOICELAB_VOICE_ID_EN: originalEnvironment.voiceEn,
      ANYVOICELAB_LANGUAGE_EN: originalEnvironment.languageEn,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.ANYVOICELAB_NONCE = 'japanese-nonce';
  process.env.ANYVOICELAB_NONCE_EN = 'english-nonce';
  process.env.ANYVOICELAB_COOKIE = 'session=test';
  process.env.ANYVOICELAB_VOICE_ID = '656306';
  process.env.ANYVOICELAB_VOICE_ID_EN = '656224';
  process.env.ANYVOICELAB_LANGUAGE_EN = 'en';

  let submitted: FormData | undefined;
  globalThis.fetch = async (_input, init) => {
    submitted = init?.body as FormData;
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg' },
    });
  };

  await synthesizeAnyVoice('Sponsored by Sakura Coffee.', 'en');

  assert.equal(submitted?.get('action'), 'tts_voice_chunk_batch_convert');
  assert.equal(submitted?.get('tts_voice_nonce'), 'english-nonce');
  assert.equal(submitted?.get('tts_voice_id'), '656224');
  assert.equal(submitted?.get('language'), 'en');
  assert.equal(submitted?.get('voice_to_clone_file'), 'null');
  assert.equal(submitted?.get('voice_index'), '0');
  assert.equal(submitted?.get('cursor'), '0');
});
test('long English chatter is split into provider-safe chunks', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalEnvironment = {
    nonce: process.env.ANYVOICELAB_NONCE,
    nonceEn: process.env.ANYVOICELAB_NONCE_EN,
    cookie: process.env.ANYVOICELAB_COOKIE,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      ANYVOICELAB_NONCE: originalEnvironment.nonce,
      ANYVOICELAB_NONCE_EN: originalEnvironment.nonceEn,
      ANYVOICELAB_COOKIE: originalEnvironment.cookie,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.ANYVOICELAB_NONCE_EN = 'english-nonce';
  process.env.ANYVOICELAB_COOKIE = 'session=test';

  let submittedChunks: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const form = init?.body as FormData;
    submittedChunks = form.getAll('chunks[]').map(String);
    if (submittedChunks.some((chunk) => chunk.length > 300)) {
      return Response.json({
        success: false,
        data: {
          error: 'processing_failed',
          message: 'Text to convert is too long.',
        },
      });
    }
    return Response.json({
      success: true,
      data: {
        audios: submittedChunks.map(() => Buffer.from([1, 2, 3]).toString('base64')),
      },
    });
  };

  const sentence =
    'A detailed radio discussion explains the song, its arrangement, its emotional arc, and why listeners still connect with it today.';
  await synthesizeAnyVoice(Array.from({ length: 6 }, () => sentence).join(' '), 'en');

  assert.ok(submittedChunks.length > 1);
  assert.ok(submittedChunks.every((chunk) => chunk.length <= 300));
});