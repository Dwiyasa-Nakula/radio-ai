import assert from 'node:assert/strict';
import test from 'node:test';
import { rankRadioStations } from '../../../src/app/lib/radioQuality';
import {
  isYouTubeChallengeError,
  redactYouTubeProxyCredentials,
  shouldTryNextYouTubeClient,
  youtubeCacheKey,
  youtubeExtractorArguments,
  youtubeFormatSelector,
  youtubePlayerClients,
  resolveYouTubeAudioFallback,
} from '../../../src/app/lib/youtubeAudioCache';
import type { RadioStation } from '../../../src/app/lib/types';

function station(id: string, codec: string, bitrate: number, votes: number): RadioStation {
  return {
    id,
    name: id,
    country: 'Japan',
    countryCode: 'JP',
    state: '',
    language: '',
    tags: [],
    codec,
    bitrate,
    favicon: '',
    homepage: '',
    streamUrl: `https://example.com/${id}`,
    votes,
    lossless: false,
  };
}

test('quality modes use distinct YouTube resolution cache keys and selectors', () => {
  const keys = new Set([
    youtubeCacheKey('abcdefghijk', 'high'),
    youtubeCacheKey('abcdefghijk', 'balanced'),
    youtubeCacheKey('abcdefghijk', 'dataSaver'),
  ]);
  assert.equal(keys.size, 3);
  assert.doesNotMatch(youtubeFormatSelector('high'), /ext=m4a/);
  assert.match(youtubeFormatSelector('balanced'), /ext=m4a/);
  assert.match(youtubeFormatSelector('dataSaver'), /abr<=96/);
});

test('radio ranking follows high, balanced, and data saver priorities', () => {
  const stations = [
    station('popular', 'MP3', 320, 1000),
    station('efficient', 'AAC', 64, 10),
    station('modern', 'OPUS', 160, 100),
  ];
  assert.equal(rankRadioStations(stations, 'high')[0].id, 'modern');
  assert.equal(rankRadioStations(stations, 'balanced')[0].id, 'popular');
  assert.equal(rankRadioStations(stations, 'dataSaver')[0].id, 'efficient');
});

test('YouTube extraction uses the configured proxy and mweb PO-token provider', () => {
  const originalProvider = process.env.YOUTUBE_PO_PROVIDER_URL;
  const originalProxy = process.env.YOUTUBE_PROXY_URL;
  process.env.YOUTUBE_PO_PROVIDER_URL = 'http://127.0.0.1:4416';
  process.env.YOUTUBE_PROXY_URL = 'https://login:password@proxy.example.com:1234';
  try {
    const args = youtubeExtractorArguments();
    assert.ok(args.includes('youtube:player_client=mweb'));
    assert.deepEqual(args.slice(0, 2), ['--js-runtimes', 'node']);
    assert.ok(args.includes('youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416'));
    assert.ok(!args.some((argument) => argument.includes('player_client=android')));
    const proxyIndex = args.indexOf('--proxy');
    assert.equal(args[proxyIndex + 1], 'https://login:password@proxy.example.com:1234');

    const fallbackArgs = youtubeExtractorArguments('android_vr');
    assert.ok(fallbackArgs.includes('youtube:player_client=android_vr'));
    assert.ok(!fallbackArgs.some((argument) => argument.includes('youtubepot-bgutilhttp')));
    const fallbackProxyIndex = fallbackArgs.indexOf('--proxy');
    assert.equal(fallbackArgs[fallbackProxyIndex + 1], 'https://login:password@proxy.example.com:1234');
    assert.equal(
      redactYouTubeProxyCredentials('failed --proxy https://login:password@proxy.example.com:1234'),
      'failed --proxy [redacted proxy]'
    );
  } finally {
    if (originalProvider === undefined) delete process.env.YOUTUBE_PO_PROVIDER_URL;
    else process.env.YOUTUBE_PO_PROVIDER_URL = originalProvider;
    if (originalProxy === undefined) delete process.env.YOUTUBE_PROXY_URL;
    else process.env.YOUTUBE_PROXY_URL = originalProxy;
  }
});

test('YouTube bot and PO-token failures are classified as retryable challenges', () => {
  assert.equal(isYouTubeChallengeError(new Error("Sign in to confirm you're not a bot")), true);
  assert.equal(isYouTubeChallengeError({ stderr: 'PO Token provider is not available' }), true);
  assert.equal(isYouTubeChallengeError(new Error('Googlevideo 500')), false);
});

test('YouTube advances to the next client after extractor timeouts', () => {
  assert.equal(shouldTryNextYouTubeClient({ killed: true, signal: 'SIGTERM' }), true);
  assert.equal(shouldTryNextYouTubeClient(new Error('Command timed out after 30000ms')), true);
  assert.equal(shouldTryNextYouTubeClient(new Error('invalid video ID')), false);
});
test('YouTube prefers the client whose proxy-bound media URL remains streamable', () => {
  assert.deepEqual(youtubePlayerClients(), ['android_vr', 'mweb']);
  assert.deepEqual(youtubePlayerClients(true), ['mweb', 'android_vr']);
});
test('fallback provider responses are authenticated and expiry-validated', async () => {
  const originalUrl = process.env.YOUTUBE_FALLBACK_PROVIDER_URL;
  const originalToken = process.env.YOUTUBE_FALLBACK_PROVIDER_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.YOUTUBE_FALLBACK_PROVIDER_URL = 'https://resolver.example.com/';
  process.env.YOUTUBE_FALLBACK_PROVIDER_TOKEN = 'secret-token';
  let request: Request | undefined;
  globalThis.fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({
      url: 'https://media.example.com/audio.mp4',
      contentType: 'audio/mp4',
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const entry = await resolveYouTubeAudioFallback('abcdefghijk', 'balanced');
    assert.equal(entry.url, 'https://media.example.com/audio.mp4');
    assert.equal(request?.headers.get('authorization'), 'Bearer secret-token');
    assert.deepEqual(await request?.json(), { videoId: 'abcdefghijk', quality: 'balanced' });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.YOUTUBE_FALLBACK_PROVIDER_URL;
    else process.env.YOUTUBE_FALLBACK_PROVIDER_URL = originalUrl;
    if (originalToken === undefined) delete process.env.YOUTUBE_FALLBACK_PROVIDER_TOKEN;
    else process.env.YOUTUBE_FALLBACK_PROVIDER_TOKEN = originalToken;
  }
});

test('fallback provider throws when YOUTUBE_FALLBACK_PROVIDER_URL is unset', async () => {
  const originalUrl = process.env.YOUTUBE_FALLBACK_PROVIDER_URL;
  delete process.env.YOUTUBE_FALLBACK_PROVIDER_URL;
  try {
    await assert.rejects(
      resolveYouTubeAudioFallback('abcdefghijk', 'balanced'),
      /YouTube fallback provider is not configured/
    );
  } finally {
    if (originalUrl !== undefined) process.env.YOUTUBE_FALLBACK_PROVIDER_URL = originalUrl;
  }
});