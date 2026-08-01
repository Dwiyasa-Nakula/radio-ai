import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';
import { MediaRotation } from '@/app/lib/mediaRotation';

const AUDIO_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.opus': 'audio/ogg',
};

const JINGLE_FOLDERS = {
  intro: 'Intro jingles',
  outro: 'Outro Jingle',
} as const;

const jingleRotation = new MediaRotation();

type JingleSlot = keyof typeof JINGLE_FOLDERS;

function jingleSlotFrom(request: Request): JingleSlot {
  const requested = new URL(request.url).searchParams.get('slot');
  return requested === 'outro' ? 'outro' : 'intro';
}

export async function GET(request: Request) {
  if (!legacyBackendApiEnabled()) {
    return NextResponse.json({ error: 'Use the Cloud Run backend in production' }, { status: 404 });
  }

  const slot = jingleSlotFrom(request);
  const jingleDirectory = path.resolve(process.cwd(), 'public', JINGLE_FOLDERS[slot]);
  let entries;
  try {
    entries = await fs.readdir(jingleDirectory, { withFileTypes: true });
  } catch {
    return NextResponse.json(
      { error: `No ${slot} jingles available in public/${JINGLE_FOLDERS[slot]}/.` },
      { status: 404 }
    );
  }

  const files = entries
    .filter((entry) => entry.isFile() && AUDIO_EXT[path.extname(entry.name).toLowerCase()])
    .map((entry) => entry.name);

  if (files.length === 0) {
    return NextResponse.json(
      { error: `No supported audio files in public/${JINGLE_FOLDERS[slot]}/.` },
      { status: 404 }
    );
  }

  const pick = jingleRotation.pick(slot, files) as string;
  const fullPath = path.join(jingleDirectory, pick);
  const fileInfo = await fs.stat(fullPath);
  const stream = createReadStream(fullPath);

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': AUDIO_EXT[path.extname(fullPath).toLowerCase()] ?? 'audio/mpeg',
      'Content-Length': fileInfo.size.toString(),
      'Cache-Control': 'no-store',
      'X-Jingle-File': encodeURIComponent(pick),
      'X-Jingle-Slot': slot,
    },
  });
}
