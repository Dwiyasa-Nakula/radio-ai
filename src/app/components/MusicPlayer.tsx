"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface MusicPlayerProps {
  itemId: string;
  audioUrl: string;
  nextItemId?: string;
  nextAudioUrl?: string;
  thumbnailUrl: string;
  onFinished: () => void;
  isSegment?: boolean;
}

type DeckName = 'a' | 'b';

interface DeckMedia {
  itemId: string | null;
  url: string | null;
}

function otherDeck(deck: DeckName): DeckName {
  return deck === 'a' ? 'b' : 'a';
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

const MusicPlayer: React.FC<MusicPlayerProps> = ({
  itemId,
  audioUrl,
  nextItemId,
  nextAudioUrl,
  thumbnailUrl,
  onFinished,
  isSegment = false,
}) => {
  const deckARef = useRef<HTMLAudioElement>(null);
  const deckBRef = useRef<HTMLAudioElement>(null);
  const activeDeckRef = useRef<DeckName>('a');
  const deckMediaRef = useRef<Record<DeckName, DeckMedia>>({
    a: { itemId: null, url: null },
    b: { itemId: null, url: null },
  });
  const desiredRef = useRef({
    itemId,
    nextItemId,
  });
  const onFinishedRef = useRef(onFinished);
  const [activeDeck, setActiveDeck] = useState<DeckName>('a');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [volume, setVolume] = useState(0.2);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const bgmRef = useRef<HTMLAudioElement>(null);
  const fadeIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const elementFor = useCallback((deck: DeckName) => {
    return deck === 'a' ? deckARef.current : deckBRef.current;
  }, []);

  const configureDeck = useCallback(
    (
      deck: DeckName,
      nextId: string,
      nextUrl: string,
      preload: 'auto' | 'metadata'
    ) => {
      const audio = elementFor(deck);
      if (!audio) return;
      const media = deckMediaRef.current[deck];
      if (media.itemId === nextId && media.url === nextUrl) {
        audio.preload = preload;
        return;
      }

      audio.pause();
      audio.preload = preload;
      audio.src = nextUrl;
      deckMediaRef.current[deck] = { itemId: nextId, url: nextUrl };
      audio.load();
    },
    [elementFor]
  );

  const syncActiveState = useCallback(
    (deck: DeckName) => {
      const audio = elementFor(deck);
      if (!audio) return;
      setActiveDeck(deck);
      setIsPlaying(!audio.paused);
      setIsReady(audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA);
      setHasError(false);
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    },
    [elementFor]
  );

  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);

  useEffect(() => {
    desiredRef.current = { itemId, nextItemId };

    const currentDeck = activeDeckRef.current;
    const standbyDeck = otherDeck(currentDeck);
    const currentMedia = deckMediaRef.current[currentDeck];
    const standbyMedia = deckMediaRef.current[standbyDeck];

    if (currentMedia.itemId !== itemId || currentMedia.url !== audioUrl) {
      if (standbyMedia.itemId === itemId && standbyMedia.url === audioUrl) {
        elementFor(currentDeck)?.pause();
        activeDeckRef.current = standbyDeck;
        syncActiveState(standbyDeck);
        const promotedAudio = elementFor(standbyDeck);
        if (promotedAudio?.paused) {
          promotedAudio.play().catch(() => {
            setIsReady(promotedAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
          });
        }
      } else {
        configureDeck(currentDeck, itemId, audioUrl, 'auto');
        activeDeckRef.current = currentDeck;
        setIsReady(false);
        setIsPlaying(false);
        setHasError(false);
        setCurrentTime(0);
        setDuration(0);
        const currentAudio = elementFor(currentDeck);
        currentAudio?.play().catch(() => {
          if (currentAudio) {
            setIsReady(currentAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
          }
        });
      }
    }

    const resolvedActiveDeck = activeDeckRef.current;
    const resolvedStandbyDeck = otherDeck(resolvedActiveDeck);
    if (nextItemId && nextAudioUrl) {
      configureDeck(
        resolvedStandbyDeck,
        nextItemId,
        nextAudioUrl,
        'auto'
      );
    } else {
      const standbyAudio = elementFor(resolvedStandbyDeck);
      standbyAudio?.pause();
      standbyAudio?.removeAttribute('src');
      standbyAudio?.load();
      deckMediaRef.current[resolvedStandbyDeck] = {
        itemId: null,
        url: null,
      };
    }
  }, [
    audioUrl,
    configureDeck,
    elementFor,
    itemId,
    nextAudioUrl,
    nextItemId,
    syncActiveState,
  ]);

  const bgmTargetVolume = 0.12 * volume;

  const fadeBgm = useCallback((toVolume: number, durationMs: number) => {
    const audio = bgmRef.current;
    if (!audio) return;

    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    if (toVolume > 0 && audio.paused) {
      audio.volume = 0;
      audio.play().catch((err) => console.warn('BGM play failed:', err));
    }

    const startVolume = audio.volume;
    const volumeDelta = toVolume - startVolume;
    const stepTimeMs = 50;
    const steps = durationMs / stepTimeMs;
    const volumeStep = volumeDelta / steps;
    let currentStep = 0;

    fadeIntervalRef.current = setInterval(() => {
      currentStep++;
      const nextVolume = Math.max(0, Math.min(1, startVolume + volumeStep * currentStep));
      audio.volume = nextVolume;

      if (currentStep >= steps) {
        audio.volume = toVolume;
        if (toVolume === 0) {
          audio.pause();
        }
        if (fadeIntervalRef.current) {
          clearInterval(fadeIntervalRef.current);
          fadeIntervalRef.current = null;
        }
      }
    }, stepTimeMs);
  }, []);

  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;

    if (isSegment && isPlaying) {
      if (!audio.paused && !fadeIntervalRef.current) {
        audio.volume = bgmTargetVolume;
      } else {
        fadeBgm(bgmTargetVolume, 1000);
      }
    } else {
      fadeBgm(0, 1000);
    }
  }, [isSegment, isPlaying, bgmTargetVolume, fadeBgm]);

  useEffect(() => {
    for (const audio of [deckARef.current, deckBRef.current]) {
      if (audio) audio.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    return () => {
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
      const bgmAudio = bgmRef.current;
      if (bgmAudio) {
        bgmAudio.pause();
      }
      for (const audio of [deckARef.current, deckBRef.current]) {
        if (!audio) continue;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, []);

  const handleEnded = useCallback(
    (endedDeck: DeckName) => {
      if (activeDeckRef.current !== endedDeck) return;

      const standbyDeck = otherDeck(endedDeck);
      const standbyMedia = deckMediaRef.current[standbyDeck];
      const desiredNextId = desiredRef.current.nextItemId;
      const standbyAudio = elementFor(standbyDeck);

      if (
        desiredNextId &&
        standbyMedia.itemId === desiredNextId &&
        standbyAudio
      ) {
        activeDeckRef.current = standbyDeck;
        syncActiveState(standbyDeck);
        standbyAudio.play().catch(() => {
          setIsReady(standbyAudio.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA);
        });
      }

      onFinishedRef.current();
    },
    [elementFor, syncActiveState]
  );

  const handlePlayPause = useCallback(() => {
    const audio = elementFor(activeDeckRef.current);
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => setHasError(true));
    } else {
      audio.pause();
    }
  }, [elementFor]);

  const handleSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const audio = elementFor(activeDeckRef.current);
      if (!audio || !Number.isFinite(audio.duration)) return;
      const nextTime = Number(event.target.value);
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
    },
    [elementFor]
  );

  const deckEvents = (deck: DeckName) => ({
    onCanPlay: () => {
      if (activeDeckRef.current !== deck) return;
      setIsReady(true);
      setHasError(false);
      const audio = elementFor(deck);
      if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onPlaying: () => {
      if (activeDeckRef.current !== deck) return;
      setIsPlaying(true);
      setIsReady(true);
      setHasError(false);
    },
    onPause: () => {
      if (activeDeckRef.current === deck) setIsPlaying(false);
    },
    onTimeUpdate: () => {
      if (activeDeckRef.current !== deck) return;
      const audio = elementFor(deck);
      if (!audio) return;
      setCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onDurationChange: () => {
      if (activeDeckRef.current !== deck) return;
      const audio = elementFor(deck);
      if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onEnded: () => handleEnded(deck),
    onError: () => {
      if (activeDeckRef.current !== deck) return;
      setIsPlaying(false);
      setIsReady(false);
      setHasError(true);
    },
  });

  return (
    <div className="music-player text-white p-4 rounded-2xl shadow-lg w-full">
      <audio ref={deckARef} {...deckEvents('a')} />
      <audio ref={deckBRef} {...deckEvents('b')} />
      <audio ref={bgmRef} src="/audio/bgm.mp3" loop />

      <div className="flex items-center">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="w-24 h-24 rounded-xl object-cover shadow-lg"
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-24 h-24 rounded-xl bg-white/8 border border-white/10 grid place-items-center text-3xl"
          >
            ♪
          </div>
        )}
        <div className="ml-4 min-w-0 flex-grow">
          <div className="flex items-center gap-3">
            <span className="w-10 text-right text-xs tabular-nums text-gray-400">
              {formatTime(currentTime)}
            </span>
            <input
              aria-label="Seek"
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              onChange={handleSeek}
              disabled={!duration}
              className="min-w-0 flex-1"
            />
            <span className="w-10 text-xs tabular-nums text-gray-400">
              {formatTime(duration)}
            </span>
          </div>

          <div className="controls mt-3 flex items-center gap-3">
            <button
              onClick={handlePlayPause}
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full disabled:bg-gray-500"
              disabled={!isReady && !hasError}
            >
              {isPlaying ? 'Pause' : isReady ? 'Play' : 'Buffering...'}
            </button>
            {hasError && (
              <button
                onClick={() => onFinishedRef.current()}
                className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-2 px-4 rounded-full"
              >
                Skip
              </button>
            )}
            <label className="ml-auto flex items-center gap-2 text-xs text-gray-300">
              Volume
              <input
                aria-label="Volume"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </label>
          </div>
          {hasError && <p className="text-red-400 text-sm mt-2">Playback error</p>}
          <span className="sr-only">Active audio deck: {activeDeck}</span>
        </div>
      </div>
    </div>
  );
};

export default MusicPlayer;
