import { NextResponse } from 'next/server';
import { fetchRadioBrowserJson } from '@/app/lib/radioBrowser';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ stationId: string }>;
}

const STATION_ID_PATTERN = /^[a-f0-9-]{20,64}$/i;

export async function POST(request: Request, context: RouteContext) {
  const { stationId } = await context.params;
  if (!STATION_ID_PATTERN.test(stationId)) {
    return NextResponse.json({ error: 'Invalid station ID' }, { status: 400 });
  }

  try {
    await fetchRadioBrowserJson(`/json/url/${encodeURIComponent(stationId)}`, request.signal);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (!request.signal.aborted) {
      console.warn(
        `[radio/click ${stationId}]`,
        error instanceof Error ? error.message : error
      );
    }
    // Listening should not fail merely because analytics could not be recorded.
    return new Response(null, { status: 204 });
  }
}
