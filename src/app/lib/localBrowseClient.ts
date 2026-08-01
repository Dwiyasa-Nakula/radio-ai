"use client";

export interface LocalDirectoryEntry {
  name: string;
  path: string;
}

export interface LocalDirectoryListing {
  path: string;
  parent: string | null;
  subdirs: LocalDirectoryEntry[];
}

interface LocalDirectoryRecord {
  data?: LocalDirectoryListing;
  error?: string;
  promise?: Promise<LocalDirectoryListing>;
}

const DRIVES_KEY = '__local_drives__';
const browseCache = new Map<string, LocalDirectoryRecord>();

function normalizeBrowsePath(path?: string | null): string | null {
  const trimmed = path?.trim();
  return trimmed ? trimmed : null;
}

function browseCacheKey(path?: string | null): string {
  return normalizeBrowsePath(path) ?? DRIVES_KEY;
}

function browseUrl(path?: string | null): string {
  const normalized = normalizeBrowsePath(path);
  return normalized ? `/api/local/browse?path=${encodeURIComponent(normalized)}` : '/api/local/browse';
}

export function loadLocalDirectory(
  path?: string | null,
  options: { force?: boolean } = {}
): Promise<LocalDirectoryListing> {
  const key = browseCacheKey(path);
  const existing = browseCache.get(key);

  if (existing && !options.force) {
    if (existing.data) return Promise.resolve(existing.data);
    if (existing.promise) return existing.promise;
    if (existing.error) return Promise.reject(new Error(existing.error));
  }

  const record: LocalDirectoryRecord = {};
  browseCache.set(key, record);

  const promise = fetch(browseUrl(path))
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Explorer failed: ${res.status}`);
      }
      return res.json();
    })
    .then((data: LocalDirectoryListing) => {
      if (!data || !Array.isArray(data.subdirs)) {
        throw new Error('Explorer returned invalid data');
      }
      record.data = {
        path: data.path ?? '',
        parent: data.parent ?? null,
        subdirs: data.subdirs,
      };
      record.error = undefined;
      record.promise = undefined;
      return record.data;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'Failed to list folders';
      record.error = message;
      record.promise = undefined;
      throw err instanceof Error ? err : new Error(message);
    });

  record.promise = promise;
  return promise;
}