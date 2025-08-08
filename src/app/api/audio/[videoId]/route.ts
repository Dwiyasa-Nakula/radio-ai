// file: src/app/api/audio/[videoId]/route.ts
import { NextResponse } from 'next/server';
import ytdl from 'ytdl-core';

export async function GET(
  request: Request,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  if (!ytdl.validateID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID' }, { status: 400 });
  }

  try {
    const audioStream = ytdl(url, {
      filter: 'audioonly',
      quality: 'highestaudio',
    });

    // Create a new ReadableStream from the Node.js stream
    const readableStream = new ReadableStream({
      start(controller) {
        audioStream.on('data', (chunk) => {
          controller.enqueue(chunk);
        });
        audioStream.on('end', () => {
          controller.close();
        });
        audioStream.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
      },
    });

  } catch (error: any) {
    console.error('ytdl-core Error:', error.message);
    return NextResponse.json({ error: 'Failed to get audio stream' }, { status: 500 });
  }
}