// src/app/api/local/file/[id]/route.ts
import { NextResponse } from 'next/server';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { decodeAbsolutePath, isAudioFile } from '@/app/lib/localMusic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;

  let absolute: string;
  try {
    absolute = path.resolve(decodeAbsolutePath(id));
  } catch {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  if (!isAudioFile(absolute)) {
    return NextResponse.json({ error: 'Not an audio file' }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!stat.isFile()) return NextResponse.json({ error: 'Not a file' }, { status: 400 });

  const size = stat.size;
  const contentType = MIME[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');

  if (range) {
    const match = range.match(/bytes=(\d+)-(\d*)/);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
      const chunkSize = end - start + 1;
      const stream = createReadStream(absolute, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
        },
      });
    }
  }

  const stream = createReadStream(absolute);
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Length': size.toString(),
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
