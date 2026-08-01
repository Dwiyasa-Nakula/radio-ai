"use client";

const DB_NAME = 'radio-ai-browser-data';
const DB_VERSION = 2;
const HANDLE_STORE = 'directory-handles';
const QUEUE_STORE = 'playlist-queues';
export const METADATA_STORE = 'local-track-metadata';

interface QueueRecord {
  playlistId: string;
  trackIds: string[];
  updatedAt: number;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function openRadioDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser'));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HANDLE_STORE)) {
        database.createObjectStore(HANDLE_STORE);
      }
      if (!database.objectStoreNames.contains(QUEUE_STORE)) {
        database.createObjectStore(QUEUE_STORE, { keyPath: 'playlistId' });
      }
      if (!database.objectStoreNames.contains(METADATA_STORE)) {
        database.createObjectStore(METADATA_STORE, { keyPath: 'cacheKey' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB'));
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const database = await openRadioDatabase();
  try {
    const transaction = database.transaction(storeName, mode);
    return await requestResult(action(transaction.objectStore(storeName)));
  } finally {
    database.close();
  }
}

export function saveDirectoryHandle(id: string, handle: FileSystemDirectoryHandle): Promise<IDBValidKey> {
  return withStore(HANDLE_STORE, 'readwrite', (store) => store.put(handle, id));
}

export function getDirectoryHandle(id: string): Promise<FileSystemDirectoryHandle | undefined> {
  return withStore(HANDLE_STORE, 'readonly', (store) => store.get(id));
}

export function deleteDirectoryHandle(id: string): Promise<undefined> {
  return withStore(HANDLE_STORE, 'readwrite', (store) => store.delete(id));
}

export async function savePlaylistQueue(playlistId: string, trackIds: string[]): Promise<void> {
  const record: QueueRecord = {
    playlistId,
    trackIds: trackIds.filter((id): id is string => typeof id === 'string' && id.startsWith('local:')),
    updatedAt: Date.now(),
  };
  await withStore(QUEUE_STORE, 'readwrite', (store) => store.put(record));
}

export async function loadPlaylistQueue(playlistId: string): Promise<string[] | undefined> {
  const record = await withStore<QueueRecord | undefined>(
    QUEUE_STORE,
    'readonly',
    (store) => store.get(playlistId)
  );
  return Array.isArray(record?.trackIds) ? record.trackIds : undefined;
}

export async function deletePlaylistQueue(playlistId: string): Promise<void> {
  await withStore(QUEUE_STORE, 'readwrite', (store) => store.delete(playlistId));
}

type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'read' }) => Promise<PermissionState>;
};

export async function ensureDirectoryReadPermission(
  handle: FileSystemDirectoryHandle,
  requestIfNeeded: boolean
): Promise<boolean> {
  const permissionHandle = handle as PermissionCapableHandle;
  if (!permissionHandle.queryPermission) return true;
  const current = await permissionHandle.queryPermission({ mode: 'read' });
  if (current === 'granted') return true;
  if (!requestIfNeeded || !permissionHandle.requestPermission) return false;
  return (await permissionHandle.requestPermission({ mode: 'read' })) === 'granted';
}

export const RADIO_DB = {
  name: DB_NAME,
  version: DB_VERSION,
  metadataStore: METADATA_STORE,
};
