// file: src/app/api/playlist/[playlistId]/route.ts
import { google } from 'googleapis';
import { NextResponse } from 'next/server';

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

interface RouteContext {
  params: Promise<{ playlistId: string }>;
}

export async function GET(
  request: Request,
  context: RouteContext
) {
  const { playlistId } = await context.params;

  if (!playlistId) {
    return NextResponse.json(
      { error: 'Playlist ID is required' },
      { status: 400 }
    );
  }

  try {
    let allItems: Array<any> = [];
    let nextPageToken: string | null = null;

    do {
      const response: any = await youtube.playlistItems.list({
        part: ['snippet'],
        playlistId,
        maxResults: 50,
        pageToken: nextPageToken || undefined,
      });

      const items =
        response.data.items?.map((item: any) => ({
          id: item.snippet?.resourceId?.videoId,
          title: item.snippet?.title,
          artist: item.snippet?.videoOwnerChannelTitle,
          thumbnail: item.snippet?.thumbnails?.high?.url,
        })) || [];

      allItems.push(...items);
      nextPageToken = response.data.nextPageToken || null;
    } while (nextPageToken);

    console.log(`Fetched ${allItems.length} videos from playlist ${playlistId}`);
    return NextResponse.json(allItems);
  } catch (error: any) {
    console.error('YouTube API Error:', error.message);
    return NextResponse.json(
      { error: 'Failed to fetch playlist data' },
      { status: 500 }
    );
  }
}

// curl http://localhost:3000/api/playlist/PLrGlZyus6hMJKwsv6k6R8rd2a9tlSCzLd