// src/app/lib/segments/traffic.ts

import type { AnnouncerLanguage } from '@/app/lib/types';

const TOMTOM_ORBIS_INCIDENTS = 'https://api.tomtom.com/maps/orbis/traffic/incidents/details';
const DEFAULT_TOKYO_BBOX = '139.5,35.5,140.0,35.8';
const DEFAULT_ATTRIBUTES = 'incidents(type,geometry(type,coordinates),properties(*))';

export interface TrafficIncident {
  road: string;
  from?: string;
  to?: string;
  delayInSeconds?: number;
  description: string;
}

interface OrbisTrafficEvent {
  description?: string;
  code?: number;
  iconCategory?: string;
}

interface OrbisTrafficProperties {
  id?: string;
  iconCategory?: string;
  magnitudeOfDelay?: string;
  startTime?: string;
  endTime?: string;
  from?: string;
  to?: string;
  lengthInMeters?: number;
  delayInSeconds?: number | null;
  roadNumbers?: string[];
  timeValidity?: string;
  probabilityOfOccurrence?: string;
  events?: OrbisTrafficEvent[];
}

interface OrbisTrafficIncident {
  type?: string;
  properties?: OrbisTrafficProperties;
}

interface OrbisTrafficResponse {
  incidents?: OrbisTrafficIncident[];
}

function clean(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function categoryLabel(category: string | undefined): string {
  switch (category) {
    case 'accident':
      return '事故';
    case 'jam':
      return '渋滞';
    case 'roadClosed':
      return '通行止め';
    case 'roadWorks':
      return '工事';
    case 'laneClosed':
      return '車線規制';
    case 'brokenDownVehicle':
      return '故障車';
    case 'dangerousConditions':
      return '危険な道路状況';
    case 'rain':
      return '雨による影響';
    case 'ice':
      return '凍結';
    case 'fog':
      return '霧';
    case 'wind':
      return '強風';
    case 'flooding':
      return '冠水';
    default:
      return '交通情報';
  }
}

function describeIncident(properties: OrbisTrafficProperties): string {
  const eventDescription = properties.events?.find((event) => clean(event.description))?.description;
  const parts = [clean(eventDescription) ?? categoryLabel(properties.iconCategory)];

  if (properties.timeValidity === 'future') {
    parts.push('今後予定されている情報');
  }
  if (properties.startTime && properties.endTime) {
    parts.push(`${properties.startTime}から${properties.endTime}まで`);
  }
  if (typeof properties.lengthInMeters === 'number' && Number.isFinite(properties.lengthInMeters)) {
    parts.push(`区間約${Math.round(properties.lengthInMeters)}メートル`);
  }

  return parts.join('、');
}

function toTrafficIncident(item: OrbisTrafficIncident): TrafficIncident | null {
  const properties = item.properties;
  if (!properties) return null;

  const roadNumbers = Array.isArray(properties.roadNumbers)
    ? properties.roadNumbers.filter((road): road is string => typeof road === 'string' && road.trim().length > 0)
    : [];
  const from = clean(properties.from);
  const to = clean(properties.to);
  const road = roadNumbers.length > 0
    ? roadNumbers.join(', ')
    : from ?? to ?? categoryLabel(properties.iconCategory);

  return {
    road,
    from,
    to,
    delayInSeconds:
      typeof properties.delayInSeconds === 'number' && Number.isFinite(properties.delayInSeconds)
        ? properties.delayInSeconds
        : undefined,
    description: describeIncident(properties),
  };
}

export async function fetchTrafficIncidents(
  limit = 6,
  signal?: AbortSignal,
  language: AnnouncerLanguage = 'ja'
): Promise<TrafficIncident[]> {
  const key = process.env.TOMTOM_API_KEY;
  if (!key) throw new Error('TOMTOM_API_KEY is not set');

  const bbox = process.env.TOMTOM_BBOX ?? DEFAULT_TOKYO_BBOX;
  const timeValidity = process.env.TOMTOM_TIME_VALIDITY ?? 'present,future';
  const acceptLanguage = language === 'en' ? 'en-US,en;q=0.9' : 'ja-JP,ja;q=0.9,en;q=0.7';

  const url = new URL(TOMTOM_ORBIS_INCIDENTS);
  url.searchParams.set('bbox', bbox);
  url.searchParams.set('timeValidity', timeValidity);
  url.searchParams.set('apiVersion', '2');

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal,
    headers: {
      Accept: 'application/json',
      'Accept-Language': acceptLanguage,
      Attributes: DEFAULT_ATTRIBUTES,
      'TomTom-Api-Key': key,
      'TomTom-Api-Version': '2',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`TomTom Orbis Traffic ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as OrbisTrafficResponse;
  return (data.incidents ?? [])
    .flatMap((item) => {
      const incident = toTrafficIncident(item);
      return incident ? [incident] : [];
    })
    .slice(0, limit);
}