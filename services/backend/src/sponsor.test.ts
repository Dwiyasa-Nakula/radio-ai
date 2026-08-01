import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adTitleFromFileName, resolveAdMetadata, resolveAdTitle } from '../../../src/app/lib/segments/adMetadata';
import {
  buildSponsorScript,
  sanitizeSponsorBrand,
} from '../../../src/app/lib/segments/sponsor';

test('ad titles prefer matching sidecars and fall back to the filename', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'radio-ai-ad-test-'));
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await writeFile(join(directory, 'sakura-spot.mp3'), '');
  await writeFile(join(directory, 'sakura-spot.txt'), '\n  Ignored TXT title  \n');
  const withoutJson = await resolveAdTitle(directory, 'sakura-spot.mp3', ['sakura-spot.mp3', 'sakura-spot.txt']);
  assert.equal(withoutJson, 'sakura spot');

  await writeFile(join(directory, 'north-star.mp4'), '');
  await writeFile(join(directory, 'north-star.png'), 'poster');
  await writeFile(join(directory, 'north-star.json'), JSON.stringify({
    title: 'North Star Foods',
    thumbnail: 'north-star.png',
  }));
  const northEntries = ['north-star.mp4', 'north-star.png', 'north-star.json'];
  const fromJson = await resolveAdMetadata(directory, 'north-star.mp4', northEntries);
  assert.deepEqual(fromJson, { title: 'North Star Foods', hasThumbnail: true });

  await writeFile(join(directory, 'legacy-sponsor.mp4'), '');
  await writeFile(join(directory, 'legacy-sponsor.json'), JSON.stringify({ brand: 'Ignored alias' }));
  const fromLegacyAlias = await resolveAdTitle(
    directory,
    'legacy-sponsor.mp4',
    ['legacy-sponsor.mp4', 'legacy-sponsor.json']
  );
  assert.equal(fromLegacyAlias, 'legacy sponsor');


  assert.equal(adTitleFromFileName('Evening_Tea-Sponsor.mp4'), 'Evening Tea Sponsor');
});

test('sponsor copy is deterministic, bounded, and language-aware', () => {
  const brand = sanitizeSponsorBrand('  Sakura\n   Coffee  ');
  assert.equal(brand, 'Sakura Coffee');

  const english = buildSponsorScript(brand, 'en');
  assert.equal(english.model, 'fixed-sponsor-copy');
  assert.match(english.script, /Sakura Coffee/);
  assert.match(english.script, /sponsor/i);

  const japanese = buildSponsorScript(brand, 'ja');
  assert.equal(japanese.model, 'fixed-sponsor-copy');
  assert.match(japanese.script, /Sakura Coffee/);
  assert.match(japanese.script, /スポンサー/);

  assert.equal(sanitizeSponsorBrand('x'.repeat(120)).length, 80);
  assert.throws(() => buildSponsorScript('', 'en'), /brand is required/);
});
