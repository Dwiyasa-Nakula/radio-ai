// file: src/app/api/playlist/[playlistId]/route.ts
import { google, youtube_v3 } from 'googleapis';
import { NextResponse } from 'next/server';
import type { Track } from '@/app/lib/types';

const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY,
});

interface RouteContext {
  params: Promise<{ playlistId: string }>;
}

const UNAVAILABLE_TITLES = new Set(['Deleted video', 'Private video']);

export async function GET(_request: Request, context: RouteContext) {
  const { playlistId } = await context.params;

  if (!playlistId) {
    return NextResponse.json({ error: 'Playlist ID is required' }, { status: 400 });
  }

  try {
    const allItems: Track[] = [];
    let nextPageToken: string | undefined;

    do {
      const response = await youtube.playlistItems.list({
        part: ['snippet'],
        playlistId,
        maxResults: 50,
        pageToken: nextPageToken,
      });

      const items = (response.data.items ?? [])
        .map((item: youtube_v3.Schema$PlaylistItem): Track | null => {
          const snippet = item.snippet;
          const videoId = snippet?.resourceId?.videoId;
          const title = snippet?.title;
          if (!videoId || !title || UNAVAILABLE_TITLES.has(title)) {
            return null;
          }
          return {
            id: `youtube:${videoId}`,
            source: 'youtube',
            title,
            artist: snippet?.videoOwnerChannelTitle ?? 'Unknown',
            thumbnail: snippet?.thumbnails?.high?.url ?? '',
            audioUrl: `/api/audio/${videoId}`,
          };
        })
        .filter((track): track is Track => track !== null);

      allItems.push(...items);
      nextPageToken = response.data.nextPageToken ?? undefined;
    } while (nextPageToken);

    console.log(`Fetched ${allItems.length} videos from playlist ${playlistId}`);
    return NextResponse.json(allItems);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('YouTube API Error:', message);
    return NextResponse.json({ error: 'Failed to fetch playlist data' }, { status: 500 });
  }
}
