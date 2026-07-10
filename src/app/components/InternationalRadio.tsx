"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import LiveRadioPlayer from './LiveRadioPlayer';
import type { RadioCountryCode, RadioStation } from '../lib/types';

interface InternationalRadioProps {
  onStationChange: (station: RadioStation | null) => void;
}

const COUNTRIES: Array<{ code: RadioCountryCode; label: string; flag: string }> = [
  { code: 'JP', label: 'Japan', flag: '🇯🇵' },
  { code: 'CN', label: 'China', flag: '🇨🇳' },
  { code: 'KR', label: 'South Korea', flag: '🇰🇷' },
];

function stationDetails(station: RadioStation): string {
  return [
    station.state,
    station.language,
    station.codec && station.bitrate
      ? `${station.codec} ${station.bitrate} kbps`
      : station.codec,
  ]
    .filter(Boolean)
    .join(' · ');
}

const InternationalRadio: React.FC<InternationalRadioProps> = ({
  onStationChange,
}) => {
  const [country, setCountry] = useState<RadioCountryCode>('JP');
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [selectedStation, setSelectedStation] = useState<RadioStation | null>(null);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const stationCache = useRef<Map<RadioCountryCode, RadioStation[]>>(new Map());

  useEffect(() => {
    const cached = stationCache.current.get(country);
    if (cached) {
      setStations(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setStations([]);

    fetch(`/api/radio/stations?country=${country}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? `Station directory failed: ${response.status}`);
        }
        return response.json() as Promise<RadioStation[]>;
      })
      .then((data) => {
        stationCache.current.set(country, data);
        setStations(data);
      })
      .catch((fetchError) => {
        if (fetchError instanceof Error && fetchError.name === 'AbortError') return;
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : 'Could not load radio stations.'
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [country, retryNonce]);

  useEffect(() => {
    return () => onStationChange(null);
  }, [onStationChange]);

  const visibleStations = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return stations;
    return stations.filter((station) =>
      [
        station.name,
        station.state,
        station.language,
        station.tags.join(' '),
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    );
  }, [query, stations]);

  const chooseCountry = (nextCountry: RadioCountryCode) => {
    if (nextCountry === country) return;
    setCountry(nextCountry);
    setQuery('');
    setSelectedStation(null);
    onStationChange(null);
  };

  const chooseStation = (station: RadioStation) => {
    setSelectedStation(station);
    onStationChange(station);
    fetch(`/api/radio/click/${encodeURIComponent(station.id)}`, {
      method: 'POST',
      keepalive: true,
    }).catch(() => {
      // Play-count reporting must never block listening.
    });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <section className="radio-glass rounded-2xl p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">International Radio</h2>
            <p className="text-xs text-gray-400">
              Live stations from Japan, China, and South Korea.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {COUNTRIES.map((item) => (
              <button
                type="button"
                key={item.code}
                onClick={() => chooseCountry(item.code)}
                className={`rounded-full px-3 py-2 text-sm transition ${
                  country === item.code
                    ? 'bg-blue-500 text-white'
                    : 'bg-white/8 text-gray-200 hover:bg-white/15'
                }`}
              >
                <span aria-hidden="true">{item.flag}</span> {item.label}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-4 block">
          <span className="sr-only">Search stations</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by station, region, language, or genre"
            className="w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm outline-none placeholder:text-gray-500 focus:border-blue-400"
          />
        </label>
      </section>

      {selectedStation && <LiveRadioPlayer station={selectedStation} />}

      <section className="radio-glass overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-sm text-gray-300">
            {isLoading
              ? 'Loading stations…'
              : `${visibleStations.length} stations`}
          </p>
          <p className="text-xs text-gray-500">Select a station to listen live</p>
        </div>

        {error ? (
          <div className="p-6 text-center">
            <p className="text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => {
                stationCache.current.delete(country);
                setRetryNonce((current) => current + 1);
              }}
              className="mt-3 rounded-full bg-blue-500 px-4 py-2 text-sm font-semibold"
            >
              Retry
            </button>
          </div>
        ) : !isLoading && visibleStations.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">
            No matching HTTPS stations were found.
          </p>
        ) : (
          <ul className="max-h-[52vh] divide-y divide-white/8 overflow-y-auto">
            {visibleStations.map((station) => {
              const active = selectedStation?.id === station.id;
              return (
                <li key={station.id}>
                  <button
                    type="button"
                    onClick={() => chooseStation(station)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
                      active ? 'bg-blue-500/18' : 'hover:bg-white/6'
                    }`}
                  >
                    {station.favicon ? (
                      <img
                        src={station.favicon}
                        alt=""
                        loading="lazy"
                        className="h-12 w-12 shrink-0 rounded-lg bg-white/90 object-contain p-1"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-white/8 text-xl"
                      >
                        📻
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{station.name}</span>
                      <span className="block truncate text-xs text-gray-400">
                        {stationDetails(station) || station.country}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm text-blue-300">
                      {active ? 'Playing' : 'Listen'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="text-center text-xs text-gray-500">
        Station directory provided by Radio Browser. Availability is controlled by each broadcaster.
      </p>
    </div>
  );
};

export default InternationalRadio;
