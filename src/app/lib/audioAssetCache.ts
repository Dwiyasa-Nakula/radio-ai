const CACHE_NAME = 'radio-audio-v1';
const inflight = new Map<string, Promise<{ blob: Blob; headers: Headers }>>();

function cacheRequest(key: string): Request {
  return new Request(`${location.origin}/__radio_audio_cache__/${encodeURIComponent(key)}`);
}

export async function cachedAudioBlob(
  key: string,
  ttlMs: number,
  loader: () => Promise<Response>
): Promise<{ blob: Blob; headers: Headers }> {
  const active = inflight.get(key);
  if (active) return active;
  const promise = (async () => {
    const cacheStorage = typeof caches === 'undefined' ? undefined : caches;
    const request = cacheStorage ? cacheRequest(key) : undefined;
    if (cacheStorage && request) {
      const cached = await cacheStorage.open(CACHE_NAME).then((cache) => cache.match(request));
      const expiresAt = Number(cached?.headers.get('x-radio-expires') ?? 0);
      if (cached && expiresAt > Date.now()) {
        return { blob: await cached.blob(), headers: cached.headers };
      }
    }
    const response = await loader();
    if (!response.ok) throw new Error(`Audio fetch failed: ${response.status}`);
    const blob = await response.blob();
    const headers = new Headers(response.headers);
    headers.set('x-radio-expires', String(Date.now() + ttlMs));
    if (cacheStorage && request) {
      const cache = await cacheStorage.open(CACHE_NAME);
      await cache.put(request, new Response(blob.slice(0, blob.size, blob.type), { status: 200, headers }));
    }
    return { blob, headers };
  })().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}