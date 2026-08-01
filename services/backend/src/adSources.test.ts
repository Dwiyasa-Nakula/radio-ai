import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAdLinkConfig, resolveYouTubeAdMetadata } from '../../../src/app/lib/segments/adSources';

test('ads link JSON accepts only unique HTTPS YouTube video links', () => {
  const sources = parseAdLinkConfig({
    links: [
      'https://www.youtube.com/watch?v=g-h9nFpx49o',
      'https://youtu.be/g-h9nFpx49o',
      'https://youtube.com/shorts/abcdefghijk',
      'http://youtube.com/watch?v=lllllllllll',
      'https://example.com/watch?v=mmmmmmmmmmm',
    ],
  });

  assert.deepEqual(sources, [
    { videoId: 'g-h9nFpx49o', watchUrl: 'https://www.youtube.com/watch?v=g-h9nFpx49o' },
    { videoId: 'abcdefghijk', watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk' },
  ]);
});
test('YouTube ad metadata provides the sponsor title and thumbnail', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({
      title: 'Sakura Coffee Summer Spot',
      thumbnail_url: 'https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg',
    });
  };

  const metadata = await resolveYouTubeAdMetadata({
    videoId: 'zzzzzzzzzzz',
    watchUrl: 'https://www.youtube.com/watch?v=zzzzzzzzzzz',
  });

  assert.match(requestedUrl, /^https:\/\/www\.youtube\.com\/oembed\?/);
  assert.deepEqual(metadata, {
    title: 'Sakura Coffee Summer Spot',
    thumbnailUrl: 'https://i.ytimg.com/vi/zzzzzzzzzzz/hqdefault.jpg',
  });
});