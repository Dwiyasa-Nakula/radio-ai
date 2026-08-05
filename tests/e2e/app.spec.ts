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
