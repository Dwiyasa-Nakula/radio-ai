"use client";

import type { SavedLocalPlaylist, Track } from './types';
import {
  ensureDirectoryReadPermission,
  getDirectoryHandle,
  saveDirectoryHandle,
} from './browserStorage';

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' }) => Promise<FileSystemDirectoryHandle>;
}

interface WorkerFile {
  relativePath: string;
  file: File;
}

interface WorkerResult {
  type: 'complete' | 'error' | 'progress';
  requestId: string;
  tracks?: Track[];
  files?: WorkerFile[];
  error?: string;
}

interface WorkerScanResult {
  tracks: Track[];
  files: WorkerFile[];
}

const sessionFiles = new Map<string, Map<string, File>>();
const resolvedFiles = new Map<string, Map<string, File>>();

export function clearLocalDirectoryFiles(directoryId: string): void {
  sessionFiles.delete(directoryId);
  resolvedFiles.delete(directoryId);
}

export function supportsPersistentDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as DirectoryPickerWindow).showDirectoryPicker === 'function';
}

export async function pickAndStoreDirectory(directoryId: string): Promise<FileSystemDirectoryHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker) throw new Error('Persistent folder access is not supported by this browser');
  const handle = await picker({ id: 'radio-ai-music', mode: 'read' });
  if (!(await ensureDirectoryReadPermission(handle, true))) {
    throw new Error('Read permission was not granted for this folder');
  }
  await saveDirectoryHandle(directoryId, handle);
  return handle;
}

function runWorker(payload: Record<string, unknown>): Promise<WorkerScanResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/localMetadata.worker.ts', import.meta.url), {
      type: 'module',
      name: 'radio-ai-local-metadata',
    });
    const requestId = crypto.randomUUID();
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Local folder scan timed out'));
    }, 10 * 60 * 1000);

    worker.onmessage = (event: MessageEvent<WorkerResult>) => {
      if (event.data.requestId !== requestId) return;
      if (event.data.type === 'progress') return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.type === 'complete' && event.data.tracks) {
        resolve({ tracks: event.data.tracks, files: event.data.files ?? [] });
      }
      else reject(new Error(event.data.error ?? 'Local folder scan failed'));
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'Local metadata worker failed'));
    };
    worker.postMessage({ ...payload, requestId });
  });
}

export async function scanBrowserPlaylist(
  playlist: SavedLocalPlaylist,
  options: { requestPermission?: boolean } = {}
): Promise<Track[]> {
  const directoryId = playlist.directoryHandleId ?? playlist.id;
  if (playlist.localMode === 'input') {
    const files = sessionFiles.get(directoryId);
    if (!files) {
      throw new Error('This session-only folder must be selected again after a refresh.');
    }
    const result = await runWorker({
      type: 'scan-files',
      directoryId,
      files: Array.from(files, ([relativePath, file]) => ({ relativePath, file })),
    });
    return result.tracks;
  }

  const handle = await getDirectoryHandle(directoryId);
  if (!handle) throw new Error('Saved folder handle is unavailable. Reconnect the folder in Settings.');
  const allowed = await ensureDirectoryReadPermission(handle, options.requestPermission === true);
  if (!allowed) throw new Error('Folder permission expired. Use ?Reconnect & rescan? in Settings.');
  const result = await runWorker({ type: 'scan-handle', directoryId, handle });
  resolvedFiles.set(
    directoryId,
    new Map(result.files.map(({ relativePath, file }) => [relativePath, file]))
  );
  return result.tracks;
}

export async function registerSessionDirectoryFiles(
  directoryId: string,
  files: FileList | File[]
): Promise<Track[]> {
  const byPath = new Map<string, File>();
  for (const file of Array.from(files)) {
    const relativePath = file.webkitRelativePath || file.name;
    byPath.set(relativePath, file);
  }
  sessionFiles.set(directoryId, byPath);
  const result = await runWorker({
    type: 'scan-files',
    directoryId,
    files: Array.from(byPath, ([relativePath, file]) => ({ relativePath, file })),
  });
  return result.tracks;
}

async function resolveFileFromHandle(
  handle: FileSystemDirectoryHandle,
  relativePath: string
): Promise<File> {
  const parts = relativePath.split('/').filter(Boolean);
  const filename = parts.pop();
  if (!filename) throw new Error('Invalid local track path');
  let current = handle;
  for (const part of parts) current = await current.getDirectoryHandle(part);
  return (await current.getFileHandle(filename)).getFile();
}

export async function createLocalTrackObjectUrl(track: Track): Promise<string> {
  const directoryId = track.directoryHandleId;
  const relativePath = track.relativePath;
  if (!directoryId || !relativePath) return track.audioUrl;

  const sessionFile = sessionFiles.get(directoryId)?.get(relativePath);
  if (sessionFile) return URL.createObjectURL(sessionFile);

  const cachedFile = resolvedFiles.get(directoryId)?.get(relativePath);
  if (cachedFile) return URL.createObjectURL(cachedFile);

  const handle = await getDirectoryHandle(directoryId);
  if (!handle) throw new Error('The local folder must be reconnected before playback.');
  if (!(await ensureDirectoryReadPermission(handle, false))) {
    throw new Error('Folder permission expired. Reconnect it in Settings.');
  }
  const file = await resolveFileFromHandle(handle, relativePath);
  const files = resolvedFiles.get(directoryId) ?? new Map<string, File>();
  files.set(relativePath, file);
  resolvedFiles.set(directoryId, files);
  return URL.createObjectURL(file);
}
