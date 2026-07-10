import { resolveSrv } from 'node:dns/promises';

const SERVICE_RECORD = '_api._tcp.radio-browser.info';
const FALLBACK_SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];
const SERVER_CACHE_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

let serverCache: { expiresAt: number; servers: string[] } | null = null;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

async function discoverServers(): Promise<string[]> {
  if (serverCache && serverCache.expiresAt > Date.now()) {
    return shuffle(serverCache.servers);
  }

  let discovered: string[] = [];
  try {
    const records = await resolveSrv(SERVICE_RECORD);
    discovered = records
      .filter((record) => record.name)
      .sort((a, b) => a.priority - b.priority)
      .map((record) => {
        const host = record.name.replace(/\.$/, '');
        return record.port === 443
          ? `https://${host}`
          : `https://${host}:${record.port}`;
      });
  } catch {
    // A fallback keeps the directory usable when SRV lookup is unavailable.
  }

  const servers = Array.from(new Set([...discovered, ...FALLBACK_SERVERS]));
  serverCache = {
    expiresAt: Date.now() + SERVER_CACHE_MS,
    servers,
  };
  return shuffle(servers);
}

async function fetchWithTimeout(
  url: string,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromParent, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'MirAI Melody FM/0.1.0',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromParent);
  }
}

export async function fetchRadioBrowserJson<T>(
  path: string,
  signal?: AbortSignal
): Promise<T> {
  const servers = await discoverServers();
  let lastError: unknown;

  for (const server of servers) {
    if (signal?.aborted) signal.throwIfAborted();

    try {
      const response = await fetchWithTimeout(`${server}${path}`, signal);
      if (!response.ok) {
        throw new Error(`Radio Browser ${response.status}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('No Radio Browser server was reachable');
}
