const JMA_FORECAST_BASE = 'https://www.jma.go.jp/bosai/forecast/data/forecast';
const WEATHER_CACHE_TTL_MS = 20 * 60 * 1000;

export interface RegionalWeatherSnapshot {
  region: string;
  area: string;
  forecastDate: string;
  todayWeather: string;
  todayTempMax?: string;
  todayTempMin?: string;
}

export interface JapanWeatherSnapshot {
  area: string;
  forecastDate: string;
  todayWeather: string;
  tomorrowWeather?: string;
  todayTempMax?: string;
  todayTempMin?: string;
  eveningRainChance?: string;
  publishedAt?: string;
  regions: RegionalWeatherSnapshot[];
}

interface JmaArea {
  area: { name: string };
  weathers?: string[];
  temps?: string[];
  tempsMin?: string[];
  tempsMax?: string[];
  pops?: string[];
}

interface JmaTimeSeries {
  timeDefines: string[];
  areas: JmaArea[];
}

interface JmaForecastBlock {
  reportDatetime?: string;
  timeSeries?: JmaTimeSeries[];
}

export interface JmaRegionalTarget {
  officeCode: string;
  region: string;
  weatherAreaHint?: string;
  temperatureAreaHint?: string;
}

export const JMA_REGIONAL_TARGETS: JmaRegionalTarget[] = [
  { officeCode: '016000', region: '北海道', weatherAreaHint: '石狩', temperatureAreaHint: '札幌' },
  { officeCode: '040000', region: '東北', temperatureAreaHint: '仙台' },
  { officeCode: '130000', region: '関東', weatherAreaHint: '東京', temperatureAreaHint: '東京' },
  { officeCode: '150000', region: '甲信越', temperatureAreaHint: '新潟' },
  { officeCode: '170000', region: '北陸', temperatureAreaHint: '金沢' },
  { officeCode: '230000', region: '東海', temperatureAreaHint: '名古屋' },
  { officeCode: '270000', region: '近畿', temperatureAreaHint: '大阪' },
  { officeCode: '340000', region: '中国', temperatureAreaHint: '広島' },
  { officeCode: '370000', region: '四国', temperatureAreaHint: '高松' },
  { officeCode: '400000', region: '九州北部', temperatureAreaHint: '福岡' },
  { officeCode: '460100', region: '九州南部', temperatureAreaHint: '鹿児島' },
  { officeCode: '471000', region: '沖縄', temperatureAreaHint: '那覇' },
];

let cachedWeather: { expiresAt: number; value: JapanWeatherSnapshot } | undefined;

function jstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function chooseArea(areas: JmaArea[], hint?: string): JmaArea | undefined {
  return (hint ? areas.find((area) => area.area.name.includes(hint)) : undefined) ?? areas[0];
}

function temperature(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned && /^-?\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : undefined;
}

function valueForHour(
  times: string[],
  values: string[],
  dateKey: string,
  hour: '00' | '09'
): string | undefined {
  const index = times.findIndex((time) => time.startsWith(dateKey) && time.slice(11, 13) === hour);
  return index >= 0 ? temperature(values[index]) : undefined;
}

function weeklyTemperatures(
  data: JmaForecastBlock[],
  target: JmaRegionalTarget,
  dateKey: string
): { min?: string; max?: string } {
  const weeklySeries = data
    .slice(1)
    .flatMap((block) => block.timeSeries ?? [])
    .find((series) => series.areas.some((area) => area.tempsMin || area.tempsMax));
  if (!weeklySeries) return {};

  const area = chooseArea(weeklySeries.areas, target.temperatureAreaHint);
  const index = weeklySeries.timeDefines.findIndex((time) => time.startsWith(dateKey));
  if (!area || index < 0) return {};
  return {
    min: temperature(area.tempsMin?.[index]),
    max: temperature(area.tempsMax?.[index]),
  };
}

export function parseJmaRegionalForecast(
  data: JmaForecastBlock[],
  target: JmaRegionalTarget,
  now = new Date()
): RegionalWeatherSnapshot & {
  tomorrowWeather?: string;
  eveningRainChance?: string;
  publishedAt?: string;
} {
  const overview = data[0];
  const series = overview?.timeSeries ?? [];
  const weatherSeries = series.find((entry) => entry.areas.some((area) => area.weathers));
  const temperatureSeries = series.find((entry) => entry.areas.some((area) => area.temps));
  const precipitationSeries = series.find((entry) => entry.areas.some((area) => area.pops));

  const weatherArea = chooseArea(weatherSeries?.areas ?? [], target.weatherAreaHint);
  const temperatureArea = chooseArea(temperatureSeries?.areas ?? [], target.temperatureAreaHint);
  const precipitationArea = chooseArea(precipitationSeries?.areas ?? [], target.weatherAreaHint);
  const temperatureTimes = temperatureSeries?.timeDefines ?? [];
  const temperatures = temperatureArea?.temps ?? [];
  const todayKey = jstDateKey(now);
  const firstTemperatureDate = temperatureTimes.find((time, index) => temperature(temperatures[index]))?.slice(0, 10);
  const hasTodayTemperature = temperatureTimes.some(
    (time, index) => time.startsWith(todayKey) && temperature(temperatures[index])
  );
  const forecastDate = hasTodayTemperature ? todayKey : firstTemperatureDate ?? todayKey;

  const weatherTimes = weatherSeries?.timeDefines ?? [];
  const weatherIndex = weatherTimes.findIndex((time) => time.startsWith(forecastDate));
  const selectedWeatherIndex = weatherIndex >= 0 ? weatherIndex : 0;
  const nextWeatherIndex = weatherTimes.findIndex(
    (time, index) => index > selectedWeatherIndex && !time.startsWith(forecastDate)
  );

  const weekly = weeklyTemperatures(data, target, forecastDate);
  const tempMin = valueForHour(temperatureTimes, temperatures, forecastDate, '00') ?? weekly.min;
  const tempMax = valueForHour(temperatureTimes, temperatures, forecastDate, '09') ?? weekly.max;

  const precipitationTimes = precipitationSeries?.timeDefines ?? [];
  const precipitation = precipitationArea?.pops ?? [];
  const eveningIndex = precipitationTimes.findIndex(
    (time) => time.startsWith(forecastDate) && Number(time.slice(11, 13)) >= 18
  );
  const afternoonIndex = precipitationTimes.findIndex(
    (time) => time.startsWith(forecastDate) && Number(time.slice(11, 13)) >= 12
  );
  const selectedPrecipitationIndex = eveningIndex >= 0 ? eveningIndex : afternoonIndex;

  return {
    region: target.region,
    area: temperatureArea?.area.name ?? weatherArea?.area.name ?? target.region,
    forecastDate,
    todayWeather: weatherArea?.weathers?.[selectedWeatherIndex] ?? '',
    tomorrowWeather: nextWeatherIndex >= 0 ? weatherArea?.weathers?.[nextWeatherIndex] : undefined,
    todayTempMin: tempMin,
    todayTempMax: tempMax,
    eveningRainChance:
      selectedPrecipitationIndex >= 0
        ? precipitation[selectedPrecipitationIndex]
        : undefined,
    publishedAt: overview?.reportDatetime,
  };
}

async function fetchRegionalForecast(
  target: JmaRegionalTarget,
  signal?: AbortSignal
): Promise<ReturnType<typeof parseJmaRegionalForecast>> {
  const response = await fetch(`${JMA_FORECAST_BASE}/${target.officeCode}.json`, {
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`JMA ${target.officeCode} ${response.status}`);
  return parseJmaRegionalForecast(await response.json() as JmaForecastBlock[], target);
}

export async function fetchJapanWeather(signal?: AbortSignal): Promise<JapanWeatherSnapshot> {
  if (signal?.aborted) throw new DOMException('Weather request aborted', 'AbortError');
  if (cachedWeather && cachedWeather.expiresAt > Date.now()) return cachedWeather.value;

  const settled = await Promise.allSettled(
    JMA_REGIONAL_TARGETS.map((target) => fetchRegionalForecast(target, signal))
  );
  if (signal?.aborted) throw new DOMException('Weather request aborted', 'AbortError');

  const regions = settled
    .filter((result): result is PromiseFulfilledResult<ReturnType<typeof parseJmaRegionalForecast>> => result.status === 'fulfilled')
    .map((result) => result.value)
    .filter((forecast) => forecast.todayWeather || forecast.todayTempMin || forecast.todayTempMax);
  if (regions.length === 0) throw new Error('No JMA regional forecasts available');

  const primary = regions.find((forecast) => forecast.region === '関東') ?? regions[0];
  const value: JapanWeatherSnapshot = {
    area: primary.area,
    forecastDate: primary.forecastDate,
    todayWeather: primary.todayWeather,
    tomorrowWeather: primary.tomorrowWeather,
    todayTempMin: primary.todayTempMin,
    todayTempMax: primary.todayTempMax,
    eveningRainChance: primary.eveningRainChance,
    publishedAt: primary.publishedAt,
    regions: regions.map(({ tomorrowWeather: _tomorrow, eveningRainChance: _rain, publishedAt: _published, ...forecast }) => forecast),
  };
  cachedWeather = { expiresAt: Date.now() + WEATHER_CACHE_TTL_MS, value };
  return value;
}

export function clearJapanWeatherCache(): void {
  cachedWeather = undefined;
}
