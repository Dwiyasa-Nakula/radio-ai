// src/app/lib/segments/traffic.ts

export interface TrafficIncident {
  road: string;
  from?: string;
  to?: string;
  delayInSeconds?: number;
  description: string;
}

interface TomTomPoi {
  r?: string; // road name/number
  f?: string; // from
  t?: string; // to
  d?: string; // description
  dl?: number; // delay in seconds
  ic?: number; // icon category
}

interface TomTomResponse {
  tm?: {
    poi?: TomTomPoi[];
  };
}

export async function fetchTrafficIncidents(
  limit = 6,
  signal?: AbortSignal
): Promise<TrafficIncident[]> {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) throw new Error('TOMTOM_API_KEY is not set');

  const bbox = process.env.TOMTOM_BBOX ?? '139.5,35.5,140.0,35.8';
  // Use TomTom Traffic Incident Details V4
  const url = `https://api.tomtom.com/traffic/services/4/incidentDetails/s3/${bbox}/10/-1/json?key=${key}&language=ja-JP`;

  const res = await fetch(url, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`TomTom Traffic ${res.status}`);
  const data = (await res.json()) as TomTomResponse;

  const out: TrafficIncident[] = [];
  const pois = data?.tm?.poi || [];

  for (const item of pois) {
    const description = item.d || '交通渋滞';
    const road = item.r || item.f || '主要道路';

    out.push({
      road,
      from: item.f,
      to: item.t,
      delayInSeconds: item.dl,
      description,
    });

    if (out.length >= limit) break;
  }
  return out;
}
