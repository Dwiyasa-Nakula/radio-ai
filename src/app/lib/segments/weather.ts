// src/app/lib/segments/weather.ts

const TOKYO_FORECAST = 'https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json';

export interface WeatherSnapshot {
  area: string;
  todayWeather: string;
  tomorrowWeather?: string;
  todayTempMax?: string;
  todayTempMin?: string;
  publishedAt?: string;
}

interface JmaTimeSeries {
  timeDefines: string[];
  areas: Array<{
    area: { name: string };
    weathers?: string[];
    temps?: string[];
    tempsMin?: string[];
    tempsMax?: string[];
  }>;
}

interface JmaForecastBlock {
  reportDatetime?: string;
  timeSeries?: JmaTimeSeries[];
}

function tokyoDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nextTokyoDateKey(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return tokyoDateKey(tomorrow);
}

export async function fetchTokyoWeather(signal?: AbortSignal): Promise<WeatherSnapshot> {
  const res = await fetch(TOKYO_FORECAST, { cache: 'no-store', signal });
  if (!res.ok) throw new Error(`JMA ${res.status}`);
  const data = (await res.json()) as JmaForecastBlock[];

  const overview = data?.[0];
  const weatherSeries = overview?.timeSeries?.find((s) => s.areas?.[0]?.weathers);
  const weatherArea = weatherSeries?.areas?.find((a) => a.area.name.includes('東京')) ?? weatherSeries?.areas?.[0];
  const weathers = weatherArea?.weathers ?? [];

  const todayKey = tokyoDateKey(new Date());
  const tomorrowKey = nextTokyoDateKey();
  const weatherDates = weatherSeries?.timeDefines ?? [];
  const todayWeatherIndex = weatherDates.findIndex((value) => value.startsWith(todayKey));
  const tomorrowWeatherIndex = weatherDates.findIndex((value) => value.startsWith(tomorrowKey));

  const tempSeries = overview?.timeSeries?.find((series) =>
    series.areas?.some((area) => Array.isArray(area.temps))
  );
  const tempArea =
    tempSeries?.areas?.find((area) => area.area.name.includes('東京')) ??
    tempSeries?.areas?.[0];
  const tempTimes = tempSeries?.timeDefines ?? [];
  const temps = tempArea?.temps ?? [];

  const todayTempMin = tempTimes.reduce<string | undefined>((result, time, index) => {
    return time.startsWith(todayKey) && time.slice(11, 13) === '00'
      ? temps[index]
      : result;
  }, undefined);
  const todayTempMax = tempTimes.reduce<string | undefined>((result, time, index) => {
    return time.startsWith(todayKey) && time.slice(11, 13) === '09'
      ? temps[index]
      : result;
  }, undefined);

  return {
    area: weatherArea?.area.name ?? 'Tokyo',
    todayWeather: weathers[todayWeatherIndex >= 0 ? todayWeatherIndex : 0] ?? '',
    tomorrowWeather:
      tomorrowWeatherIndex >= 0
        ? weathers[tomorrowWeatherIndex]
        : weathers[todayWeatherIndex >= 0 ? todayWeatherIndex + 1 : 1],
    todayTempMax,
    todayTempMin,
    publishedAt: overview?.reportDatetime,
  };
}
