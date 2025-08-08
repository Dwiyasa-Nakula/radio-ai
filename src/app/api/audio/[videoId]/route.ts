// src/app/api/audio/[videoId]/route.ts
import { NextResponse } from 'next/server';
import ytdl from '@distube/ytdl-core';

export async function GET(
  request: Request,
  { params }: { params: { videoId: string } }
) {
  // The 'await' is necessary for the new Next.js App Router
  const { videoId } = await params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  if (!ytdl.validateID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  try {
    const stream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
    });

    const readableStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        stream.on('end', () => {
          controller.close();
        });
        stream.on('error', (err) => {
          console.error('ytdl stream error:', err);
          controller.error(err);
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'audio/webm', // Using a more common audio format
        'Cache-Control': 'no-store',
      },
    });

  } catch (error: any) {
    console.error('Failed to get audio stream:', error);
    return NextResponse.json({ error: 'Failed to get audio stream' }, { status: 500 });
  }
}