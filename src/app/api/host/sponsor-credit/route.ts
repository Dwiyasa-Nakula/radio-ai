import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextResponse } from 'next/server';
import { buildSponsorScript, sanitizeSponsorBrand } from '@/app/lib/segments/sponsor';
import { synthesizeAnyVoice } from '@/app/lib/tts';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';

const cache = new Map<string, Uint8Array>();
const packaged = new Map([
  ['toyota', 'toyota'],
  ['honda', 'honda'],
  ['suzuki', 'suzuki'],
  ['mazda', 'mazda'],
]);

function keyFor(brand: string): string {
  const normalized = brand.toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return normalized;
}

export async function GET(request: Request) {
  if (!legacyBackendApiEnabled()) return NextResponse.json({ error: 'Use the Cloud Run backend in production' }, { status: 404 });
  const brand = sanitizeSponsorBrand(new URL(request.url).searchParams.get('brand') ?? '');
  if (!brand) return NextResponse.json({ error: 'A sponsor brand is required' }, { status: 400 });
  const cacheKey = keyFor(brand);
  const cached = cache.get(cacheKey);
  if (cached) return new Response(cached as unknown as BodyInit, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Sponsor-Credit-Source': 'memory' } });
  try {
    const packagedKey = Array.from(packaged.entries()).find(([name]) => cacheKey.includes(name))?.[1];
    let audio: Uint8Array;
    let source = 'generated';
    if (packagedKey) {
      try {
        audio = await readFile(join(process.cwd(), 'public', 'sponsor-credits', 'ja', `${packagedKey}.mp3`));
        source = 'packaged';
      } catch {
        const tts = await synthesizeAnyVoice(buildSponsorScript(brand, 'ja').script, 'ja', request.signal);
        audio = tts.audio;
      }
    } else {
      const tts = await synthesizeAnyVoice(buildSponsorScript(brand, 'ja').script, 'ja', request.signal);
      audio = tts.audio;
    }
    cache.set(cacheKey, audio);
    return new Response(audio as unknown as BodyInit, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(audio.byteLength), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Sponsor-Credit-Source': source } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Sponsor credit failed' }, { status: 502 });
  }
}