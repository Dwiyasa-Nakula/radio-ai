import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';
import { MediaRotation } from '@/app/lib/mediaRotation';
import { resolveAdMetadata, resolveAdThumbnail } from '@/app/lib/segments/adMetadata';
import {
  loadAdLinkSources,
  resolveYouTubeAdMetadata,
} from '@/app/lib/segments/adSources';

const adRotation = new MediaRotation();

const AD_MEDIA_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
};

export async function GET(request: Request) {
  if (!legacyBackendApiEnabled()) {
    return NextResponse.json({ error: 'Use the Cloud Run backend in production' }, { status: 404 });
  }

  const adDirectory = path.resolve(process.cwd(), 'public', 'ads');
  let entries;
  try {
    entries = await fs.readdir(adDirectory, { withFileTypes: true });
  } catch {
    return NextResponse.json({ error: 'No ads available in public/ads/.' }, { status: 404 });
  }

  const entryNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
  const files = entries
    .filter((entry) => entry.isFile() && AD_MEDIA_TYPES[path.extname(entry.name).toLowerCase()])
    .map((entry) => entry.name);

  const thumbnailFor = new URL(request.url).searchParams.get('thumbnail');
  if (thumbnailFor) {
    const mediaFile = files.find((file) => file.toLocaleLowerCase() === thumbnailFor.toLocaleLowerCase());
    if (!mediaFile || path.basename(thumbnailFor) !== thumbnailFor) {
      return NextResponse.json({ error: 'Ad thumbnail not found' }, { status: 404 });
    }
    const thumbnail = await resolveAdThumbnail(adDirectory, mediaFile, entryNames);
    if (!thumbnail) {
      return NextResponse.json({ error: 'Ad thumbnail not found' }, { status: 404 });
    }
    return new Response(Buffer.from(thumbnail.data), {
      headers: {
        'Content-Type': thumbnail.contentType,
        'Content-Length': String(thumbnail.data.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  }

  const links = await loadAdLinkSources(adDirectory, entryNames);
  const sourceKeys = [
    ...files.map((file) => `file:${file}`),
    ...links.map((link) => `youtube:${link.videoId}`),
  ];
  if (sourceKeys.length === 0) {
    return NextResponse.json(
      { error: 'No MP3, MP4, or YouTube ad links are configured in public/ads/.' },
      { status: 404 }
    );
  }

  const sourceKey = adRotation.pick('ads', sourceKeys) as string;
  if (sourceKey.startsWith('youtube:')) {
    const videoId = sourceKey.slice('youtube:'.length);
    const source = links.find((link) => link.videoId === videoId);
    if (!source) {
      return NextResponse.json({ error: 'Selected YouTube ad is unavailable' }, { status: 404 });
    }
    try {
      const metadata = await resolveYouTubeAdMetadata(source, request.signal);
      return new Response(null, {
        status: 204,
        headers: {
          'Cache-Control': 'no-store',
          'X-Ad-Title': encodeURIComponent(metadata.title),
          'X-Ad-YouTube-Id': source.videoId,
          'X-Ad-Thumbnail-Url': encodeURIComponent(metadata.thumbnailUrl),
        },
      });
    } catch (error) {
      console.error('[host/ad youtube]', error instanceof Error ? error.message : String(error));
      return NextResponse.json({ error: 'Failed to resolve the YouTube ad' }, { status: 502 });
    }
  }

  const fileName = sourceKey.slice('file:'.length);
  const metadata = await resolveAdMetadata(adDirectory, fileName, entryNames);
  const fullPath = path.join(adDirectory, fileName);
  const fileInfo = await fs.stat(fullPath);
  const stream = createReadStream(fullPath);

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      'Content-Type': AD_MEDIA_TYPES[path.extname(fullPath).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': fileInfo.size.toString(),
      'Cache-Control': 'no-store',
      'X-Ad-File': encodeURIComponent(fileName),
      'X-Ad-Title': encodeURIComponent(metadata.title),
      ...(metadata.hasThumbnail ? { 'X-Ad-Thumbnail': encodeURIComponent(fileName) } : {}),
    },
  });
}