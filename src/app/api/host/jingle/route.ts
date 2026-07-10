// src/app/api/host/jingle/route.ts
import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

const AUDIO_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.opus': 'audio/ogg',
};

const JINGLE_DIR = path.resolve(process.cwd(), 'public', 'jingles');

export async function GET() {
  let entries;
  try {
    entries = await fs.readdir(JINGLE_DIR, { withFileTypes: true });
  } catch {
    return NextResponse.json(
      { error: 'No jingles available. Drop audio files into public/jingles/ to enable.' },
      { status: 404 }
    );
  }

  const files = entries
    .filter((e) => e.isFile() && AUDIO_EXT[path.extname(e.name).toLowerCase()])
    .map((e) => e.name);

  if (files.length === 0) {
    return NextResponse.json(
      { error: 'No supported audio files in public/jingles/.' },
      { status: 404 }
    );
  }

  const pick = files[Math.floor(Math.random() * files.length)];
  const full = path.join(JINGLE_DIR, pick);
  const stat = await fs.stat(full);
  const stream = createReadStream(full);

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': AUDIO_EXT[path.extname(full).toLowerCase()] ?? 'audio/mpeg',
      'Content-Length': stat.size.toString(),
      'Cache-Control': 'no-store',
      'X-Jingle-File': encodeURIComponent(pick),
    },
  });
}
