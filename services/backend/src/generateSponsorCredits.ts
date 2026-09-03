import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSponsorScript } from '../../../src/app/lib/segments/sponsor';
import { synthesizeAnyVoice } from '../../../src/app/lib/tts';

const brands = ['Toyota', 'Honda', 'Suzuki', 'Mazda'];
const output = join(process.cwd(), 'public', 'sponsor-credits', 'ja');
await mkdir(output, { recursive: true });
for (const brand of brands) {
  const result = await synthesizeAnyVoice(buildSponsorScript(brand, 'ja').script, 'ja');
  await writeFile(join(output, `${brand.toLocaleLowerCase('en-US')}.mp3`), result.audio);
  console.log(`wrote ${brand}`);
}