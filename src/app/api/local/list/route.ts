// src/app/api/local/list/route.ts
import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseFile } from 'music-metadata';
import {
  encodeAbsolutePath,
  getDefaultMusicDir,
  walkAudioFiles,
} from '@/app/lib/localMusic';
import type { Track } from '@/app/lib/types';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const queryPath = url.searchParams.get('path');
  const root = queryPath ? path.resolve(queryPath) : getDefaultMusicDir();

  if (!root) {
    return NextResponse.json(
      { error: 'No directory specified. Add a local folder in Settings, or set LOCAL_MUSIC_DIR in .env.local.' },
      { status: 503 }
    );
  }

  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: `${root} is not a directory.` }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: `Directory not found: ${root}` }, { status: 404 });
  }

  let files: string[];
  try {
    files = await walkAudioFiles(root);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: `Failed to scan ${root}: ${message}` }, { status: 500 });
  }

  const tracks: Track[] = [];
  for (const absolute of files) {
    const id = encodeAbsolutePath(absolute);
    const audioUrl = `/api/local/file/${id}`;
    const thumbnail = `/api/local/cover/${id}`;

    let title = path.basename(absolute, path.extname(absolute));
    let artist = 'Unknown Artist';
    let album: string | undefined;
    let year: number | undefined;
    let duration: number | undefined;
    let genre: string[] | undefined;

    try {
      const meta = await parseFile(absolute, { duration: true, skipCovers: true });
      if (meta.common.title) title = meta.common.title;
      if (meta.common.artist) artist = meta.common.artist;
      if (meta.common.album) album = meta.common.album;
      if (meta.common.year) year = meta.common.year;
      if (meta.common.genre && meta.common.genre.length > 0) genre = meta.common.genre;
      if (meta.format.duration) duration = meta.format.duration;
    } catch {
      // bad/corrupt tags shouldn't take down the whole list
    }

    tracks.push({
      id: `local:${id}`,
      source: 'local',
      title,
      artist,
      thumbnail,
      audioUrl,
      album,
      year,
      duration,
      genre,
    });
  }

  console.log(`[local] scanned ${tracks.length} files in ${root}`);
  return NextResponse.json(tracks);
}
