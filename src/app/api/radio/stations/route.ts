import { NextResponse } from 'next/server';
import { fetchRadioBrowserJson } from '@/app/lib/radioBrowser';
import type { RadioCountryCode, RadioStation } from '@/app/lib/types';
import type { AudioQuality } from '@/app/lib/types';
import { rankRadioStations } from '@/app/lib/radioQuality';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';

export const runtime = 'nodejs';

const COUNTRY_CODES = new Set<RadioCountryCode>(['JP', 'CN', 'KR']);
const BROWSER_CODECS = new Set(['MP3', 'AAC', 'AAC+', 'OGG', 'OPUS']);

interface RadioBrowserStation {
  stationuuid?: string;
  name?: string;
  url?: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  tags?: string;
  codec?: string;
  bitrate?: number;
  votes?: number;
  hls?: number;
  lastcheckok?: number;
}

function safeHttpsUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function mapStation(
  station: RadioBrowserStation,
  countryCode: RadioCountryCode
): RadioStation | null {
  const id = station.stationuuid?.trim();
  const name = station.name?.trim();
  const streamUrl = safeHttpsUrl(station.url_resolved || station.url);
  const codec = station.codec?.trim().toUpperCase() ?? '';

  if (!id || !name || !streamUrl || station.hls === 1 || station.lastcheckok === 0) {
    return null;
  }
  if (codec && !BROWSER_CODECS.has(codec)) return null;

  return {
    id,
    name,
    country: station.country?.trim() || countryCode,
    countryCode,
    state: station.state?.trim() || '',
    language: station.language?.trim() || '',
    tags: (station.tags ?? '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 6),
    codec,
    bitrate: Number.isFinite(station.bitrate) ? Math.max(0, station.bitrate ?? 0) : 0,
    favicon: safeHttpsUrl(station.favicon),
    homepage: safeHttpsUrl(station.homepage),
    streamUrl,
    votes: Number.isFinite(station.votes) ? Math.max(0, station.votes ?? 0) : 0,
  };
}

export async function GET(request: Request) {
  if (!legacyBackendApiEnabled()) {
    return NextResponse.json({ error: 'Use the Cloud Run backend in production' }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const rawCountry = searchParams.get('country')?.toUpperCase() as RadioCountryCode | undefined;
  const country = rawCountry && COUNTRY_CODES.has(rawCountry) ? rawCountry : null;
  const rawQuality = searchParams.get('quality');
  const quality: AudioQuality = rawQuality === 'balanced' || rawQuality === 'dataSaver'
    ? rawQuality
    : 'high';

  if (!country) {
    return NextResponse.json(
      { error: 'country must be JP, CN, or KR' },
      { status: 400 }
    );
  }

  try {
    const params = new URLSearchParams({
      hidebroken: 'true',
      order: 'clickcount',
      reverse: 'true',
      limit: '500',
    });
    const rawStations = await fetchRadioBrowserJson<RadioBrowserStation[]>(
      `/json/stations/bycountrycodeexact/${country}?${params.toString()}`,
      request.signal
    );

    const stations: RadioStation[] = [];
    const seen = new Set<string>();
    const seenStreams = new Set<string>();
    for (const rawStation of rawStations) {
      const station = mapStation(rawStation, country);
      if (
        !station ||
        seen.has(station.id) ||
        seenStreams.has(station.streamUrl)
      ) {
        continue;
      }
      seen.add(station.id);
      seenStreams.add(station.streamUrl);
      stations.push(station);
    }

    return NextResponse.json(rankRadioStations(stations, quality).slice(0, 80), {
      headers: {
        'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600',
        'X-Audio-Quality': quality,
      },
    });
  } catch (error) {
    if (request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    const message = error instanceof Error ? error.message : 'Station directory failed';
    console.error(`[radio/stations ${country}]`, message);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
