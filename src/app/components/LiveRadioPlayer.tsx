"use client";

import React, { useEffect, useRef, useState } from 'react';
import type { RadioStation } from '../lib/types';

interface LiveRadioPlayerProps {
  station: RadioStation;
}

const LiveRadioPlayer: React.FC<LiveRadioPlayerProps> = ({ station }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [volume, setVolume] = useState(0.35);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setIsPlaying(false);
    setIsBuffering(true);
    setHasError(false);
    audio.volume = volume;
    audio.load();
    audio.play().catch(() => {
      setIsBuffering(false);
    });
    // Volume is applied separately so changing it does not reconnect the stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station.id, station.streamUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      setIsBuffering(true);
      audio.play().catch(() => {
        setIsBuffering(false);
        setHasError(true);
      });
    } else {
      audio.pause();
    }
  };

  return (
    <div className="music-player text-white p-4 rounded-2xl shadow-lg w-full">
      <audio
        ref={audioRef}
        src={station.streamUrl}
        preload="none"
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
          setHasError(false);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onError={() => {
          setIsPlaying(false);
          setIsBuffering(false);
          setHasError(true);
        }}
      />

      <div className="flex items-center gap-4">
        {station.favicon ? (
          <img
            src={station.favicon}
            alt=""
            className="w-24 h-24 rounded-xl bg-white/90 object-contain p-2 shadow-lg"
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-24 h-24 rounded-xl bg-white/8 border border-white/10 grid place-items-center text-3xl"
          >
            📻
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-red-300">
            <span className="inline-block h-2 w-2 rounded-full bg-red-400 animate-pulse" />
            Live
          </div>
          <h2 className="mt-1 truncate text-xl font-semibold">{station.name}</h2>
          <p className="truncate text-sm text-gray-300">
            {[station.state, station.country].filter(Boolean).join(', ')}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={togglePlayback}
              className="bg-green-500 hover:bg-green-400 text-white font-bold py-2 px-5 rounded-full"
            >
              {isPlaying ? 'Pause' : isBuffering ? 'Connecting…' : 'Play'}
            </button>
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-300">
              Volume
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => {
                  const nextVolume = Number(event.target.value);
                  setVolume(nextVolume);
                  if (audioRef.current) audioRef.current.volume = nextVolume;
                }}
              />
            </label>
          </div>
          {hasError && (
            <p className="mt-2 text-sm text-red-300">
              This station did not respond. Try another station.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LiveRadioPlayer;
