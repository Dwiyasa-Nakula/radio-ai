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
import { localFilesystemApiEnabled } from '@/app/lib/localFilesystemGuard';

export async function GET(request: Request) {
  if (!localFilesystemApiEnabled()) {
    return NextResponse.json({ error: 'Local filesystem APIs are disabled in production' }, { status: 404 });
  }
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
    let normalizationGain: number | undefined;
    let sourceNotes: string | undefined;
    let codec = path.extname(absolute).slice(1).toUpperCase();
    let bitrate: number | undefined;
    let sampleRate: number | undefined;
    let bitDepth: number | undefined;
    let lossless = ['.flac', '.wav'].includes(path.extname(absolute).toLowerCase());
    const fileStat = await fs.stat(absolute);

    try {
      const meta = await parseFile(absolute, { duration: true, skipCovers: true });
      if (meta.common.title) title = meta.common.title;
      if (meta.common.artist) artist = meta.common.artist;
      if (meta.common.album) album = meta.common.album;
      if (meta.common.year) year = meta.common.year;
      if (meta.common.genre && meta.common.genre.length > 0) genre = meta.common.genre;
      if (meta.format.duration) duration = meta.format.duration;
      if (meta.format.codec) codec = meta.format.codec;
      if (meta.format.bitrate) bitrate = Math.round(meta.format.bitrate / 1000);
      sampleRate = meta.format.sampleRate;
      bitDepth = meta.format.bitsPerSample;
      lossless = meta.format.lossless ?? lossless;
      const replayGain = meta.common.replaygain_track_gain;
      if (replayGain && Number.isFinite(replayGain.dB)) {
        normalizationGain = Math.max(0.5, Math.min(1.5, 10 ** (replayGain.dB / 20)));
      }
      const embeddedNotes = [
        ...(meta.common.description ?? []),
        meta.common.longDescription,
        ...(meta.common.comment ?? []).map((comment) => comment.text),
        meta.common.producer?.length ? `Producer: ${meta.common.producer.join(', ')}` : undefined,
        meta.common.composer?.length ? `Composer: ${meta.common.composer.join(', ')}` : undefined,
        meta.common.engineer?.length ? `Engineer: ${meta.common.engineer.join(', ')}` : undefined,
        meta.common.label?.length ? `Label: ${meta.common.label.join(', ')}` : undefined,
      ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (embeddedNotes.length) sourceNotes = embeddedNotes.join('\n').slice(0, 1600);
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
      normalizationGain,
      sourceNotes,
      codec,
      bitrate,
      sampleRate,
      bitDepth,
      lossless,
      fileSize: fileStat.size,
      lastModified: fileStat.mtimeMs,
      relativePath: path.relative(root, absolute).split(path.sep).join('/'),
    });
  }

  console.log(`[local] scanned ${tracks.length} files in ${root}`);
  return NextResponse.json(tracks);
}
