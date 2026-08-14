import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/playlist/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
});

test('launches, exposes local backend mode, and persists playback quality', async ({ page, request }) => {
  const session = await request.get('/api/backend/session');
  expect(session.status()).toBe(204);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'mirAI melody 73.9 FM' })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Playback/ }).click();
  await page.locator('input[name="audio-quality"][value="dataSaver"]').check();
  await page.getByRole('button', { name: 'Apply playback settings' }).click();

  await page.reload();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Playback/ }).click();
  await expect(page.locator('input[name="audio-quality"][value="dataSaver"]')).toBeChecked();
});

test('opens every settings section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  for (const section of ['Broadcast', 'Playback', 'Sources', 'Local Queue']) {
    await page.getByRole('button', { name: new RegExp('^' + section) }).click();
  }

  await expect(page.getByRole('heading', { name: 'Local song queue' })).toBeVisible();
});

test('plays a scanned browser folder after its directory permission drops', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('radio-ai:host-settings-v1', JSON.stringify({ enabled: false }));
    type FakeRequest<T> = {
      result: T;
      error: null;
      onsuccess: ((event: Event) => void) | null;
      onerror: ((event: Event) => void) | null;
      onupgradeneeded?: ((event: Event) => void) | null;
    };

    const request = <T,>(result: T): FakeRequest<T> => {
      const pending: FakeRequest<T> = {
        result,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => pending.onsuccess?.(new Event('success')));
      return pending;
    };

    const stores = new Map<string, Map<IDBValidKey, unknown>>();
    const database = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => ({}),
      transaction: (storeName: string) => ({
        objectStore: () => {
          const store = stores.get(storeName) ?? new Map<IDBValidKey, unknown>();
          stores.set(storeName, store);
          return {
            get: (key: IDBValidKey) => request(store.get(key)),
            put: (value: unknown, key?: IDBValidKey) => {
              const resolvedKey = key ?? (value as { playlistId?: IDBValidKey }).playlistId!;
              store.set(resolvedKey, value);
              return request(resolvedKey);
            },
            delete: (key: IDBValidKey) => {
              store.delete(key);
              return request(undefined);
            },
          };
        },
      }),
      close: () => {},
    };
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open: () => request(database) },
    });

    let permission: PermissionState = 'granted';
    const handle = {
      kind: 'directory' as const,
      name: 'Phone Music',
      queryPermission: async () => permission,
      requestPermission: async () => 'granted' as PermissionState,
    } as unknown as FileSystemDirectoryHandle;
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => handle,
    });

    const wav = new Uint8Array(44 + 16_000);
    const view = new DataView(wav.buffer);
    const write = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) wav[offset + index] = value.charCodeAt(index);
    };
    write(0, 'RIFF');
    view.setUint32(4, wav.length - 8, true);
    write(8, 'WAVEfmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 8_000, true);
    view.setUint32(28, 16_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, 16_000, true);
    const file = new File([wav], 'loop.wav', { type: 'audio/wav' });
    const createObjectUrl = URL.createObjectURL.bind(URL);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob: Blob) => {
        if (blob === file) document.documentElement.dataset.localWorkerFileUrl = 'created';
        return createObjectUrl(blob);
      },
    });

    class LocalMetadataWorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(payload: { requestId: string; directoryId: string }) {
        const relativePath = 'loop.wav';
        const track = {
          id: `local:browser:${payload.directoryId}:${encodeURIComponent(relativePath)}`,
          source: 'local' as const,
          title: 'Permission-safe loop',
          artist: 'Test artist',
          thumbnail: '',
          audioUrl: '',
          codec: 'WAV',
          relativePath,
          directoryHandleId: payload.directoryId,
        };
        permission = 'prompt';
        queueMicrotask(() => this.onmessage?.({
          data: {
            type: 'complete',
            requestId: payload.requestId,
            tracks: [track],
            files: [{ relativePath, file }],
          },
        } as MessageEvent));
      }

      terminate() {}
    }
    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: LocalMetadataWorkerStub,
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Sources/ }).click();
  await page.getByRole('button', { name: 'Local folder' }).click();
  await page.getByPlaceholder('Name').fill('Phone Music');
  await page.getByRole('button', { name: 'Choose browser folder' }).click();

  const source = page.getByText('Phone Music', { exact: true });
  await expect(source).toBeVisible();
  await source.click();
  await expect(page.getByText(/Now playing from:/)).toContainText('Phone Music');
  await expect.poll(() => page.locator('html').getAttribute('data-local-worker-file-url'), {
    timeout: 10_000,
  }).toBe('created');
  await expect(page.getByText('Failed to load audio')).toHaveCount(0);
});
