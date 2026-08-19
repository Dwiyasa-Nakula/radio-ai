export const NEWS_SEGMENT_TTL_MS = 60 * 60 * 1000;
export const WEATHER_SEGMENT_TTL_MS = 3 * 60 * 60 * 1000;

interface SegmentCacheRequest {
  kind: string;
  language?: string;
  focus?: string;
  isPreroll?: boolean;
  isNoon?: boolean;
}

export interface SegmentCachePolicy {
  key: string;
  ttlMs: number;
}

export function segmentCachePolicy(body: SegmentCacheRequest): SegmentCachePolicy | undefined {
  const language = body.language === 'en' ? 'en' : 'ja';
  if (body.kind === 'news') {
    return {
      key: JSON.stringify({
        kind: 'news',
        language,
        focus: typeof body.focus === 'string' ? body.focus.trim().slice(0, 160) : '',
        isPreroll: body.isPreroll === true,
      }),
      ttlMs: NEWS_SEGMENT_TTL_MS,
    };
  }
  if (body.kind === 'weather') {
    return {
      key: JSON.stringify({
        kind: 'weather',
        language,
        isPreroll: body.isPreroll === true,
        isNoon: body.isNoon === true,
      }),
      ttlMs: WEATHER_SEGMENT_TTL_MS,
    };
  }
  return undefined;
}

type CacheStatus = 'HIT' | 'MISS' | 'COALESCED';

export class TimedPromiseCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();
  private readonly inflight = new Map<string, Promise<T>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 32
  ) {}

  async getOrCreate(
    key: string,
    ttlMs: number,
    load: () => Promise<T>
  ): Promise<{ value: T; status: CacheStatus }> {
    this.prune();
    const cached = this.entries.get(key);
    if (cached && cached.expiresAt > this.now()) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return { value: cached.value, status: 'HIT' };
    }

    const active = this.inflight.get(key);
    if (active) return { value: await active, status: 'COALESCED' };

    const promise = load()
      .then((value) => {
        this.entries.delete(key);
        this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
        this.prune();
        return value;
      })
      .finally(() => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return { value: await promise, status: 'MISS' };
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}
