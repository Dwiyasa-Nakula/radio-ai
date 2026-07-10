// src/app/api/local/cover/[id]/route.ts
import { NextResponse } from 'next/server';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { decodeAbsolutePath, isAudioFile } from '@/app/lib/localMusic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
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

  try {
    const meta = await parseFile(absolute);
    const cover = meta.common.picture?.[0];
    if (!cover) {
      return new Response(null, { status: 404 });
    }
    return new Response(new Uint8Array(cover.data), {
      headers: {
        'Content-Type': cover.format ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
