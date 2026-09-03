"use client";

import type { BackendSessionResponse } from '@radio-ai/contracts';

let cachedSession: BackendSessionResponse | null = null;
let inflightSession: Promise<BackendSessionResponse> | null = null;
let localBackendMode = false;

class LocalBackendMode extends Error {}

async function loadSession(): Promise<BackendSessionResponse> {
  if (localBackendMode) throw new LocalBackendMode();
  if (cachedSession && cachedSession.expiresAt > Date.now() + 30_000) return cachedSession;
  if (inflightSession) return inflightSession;
  inflightSession = fetch('/api/backend/session', { cache: 'no-store' })
    .then(async (response) => {
      if (response.status === 204) {
        localBackendMode = true;
        throw new LocalBackendMode();
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Backend session failed: ${response.status}`);
      }
      return response.json() as Promise<BackendSessionResponse>;
    })
    .then((session) => {
      cachedSession = session;
      return session;
    })
    .finally(() => {
      inflightSession = null;
    });
  return inflightSession;
}

function mergeHeaders(initial: HeadersInit | undefined, token: string): Headers {
  const headers = new Headers(initial);
  headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export async function backendFetch(
  path: string,
  init: RequestInit = {},
  fallbackPath?: string
): Promise<Response> {
  try {
    const session = await loadSession();
    return await fetch(`${session.baseUrl}${path}`, {
      ...init,
      headers: mergeHeaders(init.headers, session.token),
      cache: init.cache ?? 'no-store',
    });
  } catch (error) {
    if (!fallbackPath) throw error;
    return fetch(fallbackPath, init);
  }
}

export async function backendMediaUrl(path: string, fallbackPath: string): Promise<string> {
  try {
    const session = await loadSession();
    const url = new URL(`${session.baseUrl}${path}`);
    url.searchParams.set('token', session.token);
    return url.toString();
  } catch {
    return fallbackPath;
  }
}

export function clearBackendSession(): void {
  cachedSession = null;
}
  localBackendMode = false;
