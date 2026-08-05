"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PauseIcon,
  PlayIcon,
  SPECTRUM_BARS,
  VolumeIcon,
  useAudioSpectrum,
} from './PlayerVisuals';

interface MusicPlayerProps {
  itemId: string;
  audioUrl: string;
  videoUrl?: string;
  nextItemId?: string;
  nextAudioUrl?: string;
  thumbnailUrl: string;
  onFinished: () => void;
  isSegment?: boolean;
  isJingle?: boolean;
  isChatter?: boolean;
  nextIsSegment?: boolean;
  nextIsJingle?: boolean;
  normalizationGain?: number;
  nextNormalizationGain?: number;
  autoSkipOnError?: boolean;
  playbackErrorMessage?: string;
}

type DeckName = 'a' | 'b';
type PlaybackKind = 'song' | 'announcer' | 'jingle';
type TransitionPhase =
  | 'playing'
  | 'song-outro'
  | 'bgm-lead-in'
  | 'announcing'
  | 'bgm-tail'
  | 'bgm-fade-out'
  | 'silence'
  | 'song-fade-in'
  | 'paused';

const SONG_OUTRO_MS = 5_000;
const BGM_LEAD_IN_MS = 3_000;
const BGM_FADE_IN_MS = 1_200;
const BGM_TAIL_MS = 3_000;
const BGM_FADE_OUT_MS = 1_500;
const BETWEEN_BREAK_AND_SONG_MS = 1_500;
const SONG_FADE_IN_MS = 2_500;
const ANNOUNCER_FADE_IN_MS = 300;
const ANNOUNCER_GAP_MS = 3_000;

interface DeckMedia {
  itemId: string | null;
  url: string | null;
}

function otherDeck(deck: DeckName): DeckName {
  return deck === 'a' ? 'b' : 'a';
}

type FadingAudioElement = HTMLAudioElement & {
  _fadeInterval?: ReturnType<typeof setInterval> | null;
};

function cancelDeckFade(audio: HTMLAudioElement) {
  const fadingAudio = audio as FadingAudioElement;
  if (fadingAudio._fadeInterval !== undefined && fadingAudio._fadeInterval !== null) {
    clearInterval(fadingAudio._fadeInterval);
    fadingAudio._fadeInterval = null;
  }
}

function isDeckFading(audio: HTMLAudioElement) {
  const fadingAudio = audio as FadingAudioElement;
  return fadingAudio._fadeInterval !== undefined && fadingAudio._fadeInterval !== null;
}

function smoothstep(progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  return clamped * clamped * (3 - 2 * clamped);
}

function setDeckNormalization(audio: HTMLAudioElement, gain: number) {
  audio.dataset.normalizationGain = Math.max(0.5, Math.min(1.5, gain)).toString();
}

function deckTargetVolume(audio: HTMLAudioElement, userVolume: number) {
  const gain = Number(audio.dataset.normalizationGain ?? '1');
  return Math.max(0, Math.min(1, userVolume * (Number.isFinite(gain) ? gain : 1)));
}

function log(msg: string, ...args: unknown[]) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  console.log(`[${timeStr}] ${msg}`, ...args);
}

function warn(msg: string, ...args: unknown[]) {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now.getMilliseconds().toString().padStart(3, '0')}`;
  console.warn(`[${timeStr}] ${msg}`, ...args);
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
  videoUrl,
  nextItemId,
  nextAudioUrl,
  thumbnailUrl,
  onFinished,
  isSegment = false,
  isJingle = false,
  isChatter = false,
  nextIsSegment = false,
  nextIsJingle = false,
  normalizationGain = 1,
  nextNormalizationGain = 1,
  autoSkipOnError = false,
  playbackErrorMessage = 'Playback error',
}) => {
  const deckARef = useRef<HTMLAudioElement>(null);
  const deckBRef = useRef<HTMLAudioElement>(null);
  const visualVideoRef = useRef<HTMLVideoElement>(null);
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
  const transitionedMediaIdRef = useRef<string | null>(null);
  const activeKindRef = useRef<PlaybackKind>(
    isJingle ? 'jingle' : isSegment ? 'announcer' : 'song'
  );
  const playbackKindsRef = useRef<{ current: PlaybackKind; next: PlaybackKind | null }>({
    current: activeKindRef.current,
    next: nextIsJingle ? 'jingle' : nextIsSegment ? 'announcer' : nextItemId ? 'song' : null,
  });
  const transitionTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const transitionGenerationRef = useRef(0);
  const songOutroItemRef = useRef<string | null>(null);
  const lastPropItemIdRef = useRef(itemId);
  const playbackErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('playing');

  useEffect(() => () => {
    if (playbackErrorTimerRef.current) clearTimeout(playbackErrorTimerRef.current);
  }, []);
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('radio-ai:volume');
      if (saved !== null) {
        const val = parseFloat(saved);
        if (!isNaN(val)) return val;
      }
    }
    return 0.75;
  });
  const lastAudibleVolumeRef = useRef(volume > 0 ? volume : 0.75);

  const setVolume = useCallback((val: number) => {
    const nextVolume = Math.max(0, Math.min(1, val));
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
    setVolumeState(nextVolume);
    if (typeof window !== 'undefined') {
      localStorage.setItem('radio-ai:volume', nextVolume.toString());
    }
  }, []);

  const handleToggleMute = useCallback(() => {
    setVolume(volume > 0 ? 0 : lastAudibleVolumeRef.current);
  }, [setVolume, volume]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const video = visualVideoRef.current;
    if (!video || !videoUrl) return;

    if (Math.abs(video.currentTime - currentTime) > 0.75) {
      try {
        video.currentTime = currentTime;
      } catch {}
    }

    if (isPlaying) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [currentTime, isPlaying, videoUrl]);

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
      preload: 'auto' | 'metadata',
      gain: number
    ) => {
      const audio = elementFor(deck);
      if (!audio) return;
      setDeckNormalization(audio, gain);

      // A previous render may have scheduled this deck to be unloaded after a
      // fade. Cancel that callback before reusing the element for new media.
      cancelDeckFade(audio);

      const media = deckMediaRef.current[deck];
      if (media.itemId === nextId && media.url === nextUrl) {
        audio.preload = preload;
        return;
      }
      if (media.itemId) {
        log(`[MusicPlayer] Overwriting/aborting load on deck ${deck} for itemId: ${media.itemId} -> nextId: ${nextId}`);
      } else {
        log(`[MusicPlayer] Queued/preloading standby deck ${deck} for itemId: ${nextId}`);
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
    const currentKind: PlaybackKind = isJingle
      ? 'jingle'
      : isSegment
        ? 'announcer'
        : 'song';
    const nextKind: PlaybackKind | null = nextItemId
      ? nextIsJingle
        ? 'jingle'
        : nextIsSegment
          ? 'announcer'
          : 'song'
      : null;

    playbackKindsRef.current = { current: currentKind, next: nextKind };
    if (
      transitionedMediaIdRef.current === null ||
      transitionedMediaIdRef.current === itemId
    ) {
      activeKindRef.current = currentKind;
    }
  }, [isJingle, isSegment, itemId, nextIsJingle, nextIsSegment, nextItemId]);

  const fadeDeck = useCallback((audio: HTMLAudioElement | null, toVolume: number, durationMs: number, onComplete?: () => void) => {
    if (!audio) {
      onComplete?.();
      return;
    }

    cancelDeckFade(audio);

    const startVolume = audio.volume;
    const volumeDelta = toVolume - startVolume;
    if (Math.abs(volumeDelta) < 0.01) {
      audio.volume = toVolume;
      onComplete?.();
      return;
    }

    const stepTimeMs = 30;
    const steps = durationMs / stepTimeMs;
    let currentStep = 0;

    const fadingAudio = audio as FadingAudioElement;
    fadingAudio._fadeInterval = setInterval(() => {
      currentStep++;
      const easedProgress = smoothstep(currentStep / steps);
      const nextVolume = Math.max(0, Math.min(1, startVolume + volumeDelta * easedProgress));
      audio.volume = nextVolume;

      if (currentStep >= steps) {
        audio.volume = toVolume;
        cancelDeckFade(audio);
        onComplete?.();
      }
    }, stepTimeMs);
  }, []);

  const cancelTransitionTimeline = useCallback(() => {
    transitionGenerationRef.current += 1;
    for (const timer of transitionTimersRef.current) {
      clearTimeout(timer);
    }
    transitionTimersRef.current.clear();
  }, []);

  const scheduleTransition = useCallback(
    (generation: number, delayMs: number, callback: () => void) => {
      const timer = setTimeout(() => {
        transitionTimersRef.current.delete(timer);
        if (transitionGenerationRef.current !== generation) return;
        callback();
      }, delayMs);
      transitionTimersRef.current.add(timer);
    },
    []
  );

  const handleInteraction = useCallback(() => {
    const audio = elementFor(activeDeckRef.current);
    if (!audio) return;
    log(`[MusicPlayer] User interacted. Resuming active deck: ${activeDeckRef.current}`);
    audio.play()
      .then(() => {
        setNeedsInteraction(false);
        document.removeEventListener('click', handleInteraction);
        document.removeEventListener('keydown', handleInteraction);
      })
      .catch((err) => {
        warn('[MusicPlayer] Interaction play failed:', err);
      });
  }, [elementFor]);

  const handlePlayFailure = useCallback((err: unknown) => {
    const errorName = err && typeof err === 'object' && 'name' in err ? err.name : undefined;
    if (errorName === 'NotAllowedError') {
      warn('[MusicPlayer] Autoplay blocked. Waiting for user interaction.');
      setNeedsInteraction(true);
      document.addEventListener('click', handleInteraction);
      document.addEventListener('keydown', handleInteraction);
    }
  }, [handleInteraction]);

  useEffect(() => {
    desiredRef.current = { itemId, nextItemId };

    if (lastPropItemIdRef.current !== itemId) {
      const isTimedPromotion = transitionedMediaIdRef.current === itemId;
      if (!isTimedPromotion) {
        cancelTransitionTimeline();
        songOutroItemRef.current = null;
        setTransitionPhase('playing');
      }
      lastPropItemIdRef.current = itemId;
    }

    if (transitionedMediaIdRef.current === itemId) {
      log(`[MusicPlayer] Props aligned with naturally transitioned itemId: ${itemId}. Clearing transitioned ref.`);
      transitionedMediaIdRef.current = null;
    } else if (transitionedMediaIdRef.current !== null) {
      log(`[MusicPlayer] Waiting for props to catch up. Currently playing: ${transitionedMediaIdRef.current}, prop itemId: ${itemId}. Skipping transition logic.`);
      return;
    } else {
      const currentDeck = activeDeckRef.current;
      const standbyDeck = otherDeck(currentDeck);
      const currentMedia = deckMediaRef.current[currentDeck];
      const standbyMedia = deckMediaRef.current[standbyDeck];

      if (currentMedia.itemId !== itemId || currentMedia.url !== audioUrl) {
        if (standbyMedia.itemId === itemId && standbyMedia.url === audioUrl) {
          const oldAudio = elementFor(currentDeck);
          if (oldAudio && !oldAudio.paused) {
            fadeDeck(oldAudio, 0, 1000, () => {
              oldAudio.pause();
            });
          }
          activeDeckRef.current = standbyDeck;
          syncActiveState(standbyDeck);
          const promotedAudio = elementFor(standbyDeck);
          if (promotedAudio) {
            if (promotedAudio.error || !promotedAudio.src) {
              warn(`[MusicPlayer] Promoted deck ${standbyDeck} has error or no src. Reloading it.`);
              if (standbyMedia.url) {
                promotedAudio.src = standbyMedia.url;
              }
              promotedAudio.load();
            }
            if (promotedAudio.paused) {
              promotedAudio.volume = 0;
              log(`[MusicPlayer] Calling play() on promoted deck: ${standbyDeck}`);
              promotedAudio.play()
                .then(() => log(`[MusicPlayer] play() succeeded on promoted deck: ${standbyDeck}`))
                .catch((err) => {
                  warn(`[MusicPlayer] play() failed on promoted deck ${standbyDeck}:`, err);
                  handlePlayFailure(err);
                });
              fadeDeck(
                promotedAudio,
                deckTargetVolume(promotedAudio, volume),
                activeKindRef.current === 'song' ? SONG_FADE_IN_MS : ANNOUNCER_FADE_IN_MS
              );
            }
          }
        } else {
          const oldAudio = elementFor(currentDeck);
          if (oldAudio && !oldAudio.paused) {
            fadeDeck(oldAudio, 0, 1000, () => {
              oldAudio.pause();
              oldAudio.removeAttribute('src');
              oldAudio.load();
            });
          }
          configureDeck(currentDeck, itemId, audioUrl, 'auto', normalizationGain);
          activeDeckRef.current = currentDeck;
          setIsReady(false);
          setIsPlaying(false);
          setHasError(false);
          setCurrentTime(0);
          setDuration(0);
          const currentAudio = elementFor(currentDeck);
          if (currentAudio) {
            if (currentAudio.error) {
              warn(`[MusicPlayer] Active deck ${currentDeck} has error:`, currentAudio.error);
              currentAudio.load();
            }
            currentAudio.volume = 0;
            log(`[MusicPlayer] Calling play() on active deck: ${currentDeck}`);
            currentAudio.play()
              .then(() => log(`[MusicPlayer] play() succeeded on active deck: ${currentDeck}`))
              .catch((err) => {
                warn(`[MusicPlayer] play() failed on active deck ${currentDeck}:`, err);
                handlePlayFailure(err);
              });
            fadeDeck(
              currentAudio,
              deckTargetVolume(currentAudio, volume),
              activeKindRef.current === 'song' ? SONG_FADE_IN_MS : ANNOUNCER_FADE_IN_MS
            );
          }
        }
      }
    }

    const resolvedActiveDeck = activeDeckRef.current;
    const resolvedStandbyDeck = otherDeck(resolvedActiveDeck);
    if (nextItemId && nextAudioUrl) {
      configureDeck(
        resolvedStandbyDeck,
        nextItemId,
        nextAudioUrl,
        'auto',
        nextNormalizationGain
      );
    } else {
      const standbyAudio = elementFor(resolvedStandbyDeck);
      if (standbyAudio) {
        const media = deckMediaRef.current[resolvedStandbyDeck];
        if (media.itemId) {
          log(`[MusicPlayer] Aborting/unloading standby deck ${resolvedStandbyDeck} for itemId: ${media.itemId}`);
        }
        fadeDeck(standbyAudio, 0, 1000, () => {
          standbyAudio.pause();
          standbyAudio.removeAttribute('src');
          standbyAudio.load();
        });
      }
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
    fadeDeck,
    volume,
    handlePlayFailure,
    cancelTransitionTimeline,
    normalizationGain,
    nextNormalizationGain,
  ]);

  const bgmTargetVolume = 0.15 * volume;

  const fadeBgm = useCallback((toVolume: number, durationMs: number) => {
    const audio = bgmRef.current;
    if (!audio) return;

    if (fadeIntervalRef.current) {
      clearInterval(fadeIntervalRef.current);
      fadeIntervalRef.current = null;
    }

    if (toVolume > 0 && audio.paused) {
      audio.volume = 0;
      audio.play().catch((err) => warn('BGM play failed:', err));
    }

    const startVolume = audio.volume;
    const volumeDelta = toVolume - startVolume;
    const stepTimeMs = 50;
    const steps = durationMs / stepTimeMs;
    let currentStep = 0;

    fadeIntervalRef.current = setInterval(() => {
      currentStep++;
      const easedProgress = smoothstep(currentStep / steps);
      const nextVolume = Math.max(0, Math.min(1, startVolume + volumeDelta * easedProgress));
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

    // The transition timeline owns BGM during its lead-in and tail. Normal
    // playback state only controls BGM while an announcer is actively speaking.
    if (
      transitionPhase === 'bgm-lead-in' ||
      transitionPhase === 'announcing' ||
      transitionPhase === 'bgm-tail' ||
      transitionPhase === 'bgm-fade-out'
    ) {
      return;
    }

    const wantsBgm = activeKindRef.current === 'announcer' && isPlaying;
    if (wantsBgm) {
      if (!audio.paused && !fadeIntervalRef.current) {
        audio.volume = bgmTargetVolume;
      } else {
        fadeBgm(bgmTargetVolume, 1000);
      }
    } else {
      fadeBgm(0, 1000);
    }
  }, [isPlaying, bgmTargetVolume, fadeBgm, transitionPhase]);

  // Only synchronize on an actual user volume change. Including activeDeck in
  // this effect made deck promotion jump immediately to full volume and
  // overrode the intended fade-in.
  useEffect(() => {
    const currentDeck = activeDeckRef.current;
    const activeAudio = elementFor(currentDeck);
    const standbyAudio = elementFor(otherDeck(currentDeck));
    if (activeAudio && !isDeckFading(activeAudio)) {
      activeAudio.volume = deckTargetVolume(activeAudio, volume);
    }
    if (standbyAudio && !isDeckFading(standbyAudio)) {
      standbyAudio.volume = deckTargetVolume(standbyAudio, volume);
    }
  }, [volume, elementFor]);

  useEffect(() => {
    return () => {
      cancelTransitionTimeline();
      if (fadeIntervalRef.current) {
        clearInterval(fadeIntervalRef.current);
      }
      const bgmAudio = bgmRef.current;
      if (bgmAudio) {
        bgmAudio.pause();
      }
      for (const audio of [deckARef.current, deckBRef.current]) {
        if (!audio) continue;
        cancelDeckFade(audio);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, [cancelTransitionTimeline, handleInteraction]);

  const handleEnded = useCallback(
    (endedDeck: DeckName) => {
      log(`[MusicPlayer] handleEnded. endedDeck: ${endedDeck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== endedDeck) return;
      setIsPlaying(false);

      cancelTransitionTimeline();
      const generation = transitionGenerationRef.current;
      const currentKind = activeKindRef.current;
      const nextKind = playbackKindsRef.current.next;
      const promotionWaitStartedAt = Date.now();

      const promoteNext = (fadeInMs: number) => {
        if (transitionGenerationRef.current !== generation) return;

        const standbyDeck = otherDeck(endedDeck);
        const standbyMedia = deckMediaRef.current[standbyDeck];
        const desiredNextId = desiredRef.current.nextItemId;
        const standbyAudio = elementFor(standbyDeck);

        log(`[MusicPlayer] Promoting after ${currentKind} -> ${nextKind}. standbyDeck: ${standbyDeck}, standbyMediaId: ${standbyMedia.itemId}, desiredNextId: ${desiredNextId}`);

        if (
          !desiredNextId ||
          standbyMedia.itemId !== desiredNextId ||
          !standbyAudio
        ) {
          warn(`[MusicPlayer] Timed standby deck not aligned. standbyMediaId: ${standbyMedia.itemId}, desiredNextId: ${desiredNextId}`);
          if (desiredNextId && Date.now() - promotionWaitStartedAt < 15_000) {
            // Keep the BGM bed alive while a generated announcer item finishes
            // preparing, then promote it as soon as the standby deck aligns.
            scheduleTransition(generation, 250, () => promoteNext(fadeInMs));
            return;
          }
          setTransitionPhase(nextKind === 'announcer' ? 'announcing' : 'playing');
          onFinishedRef.current();
          return;
        }

        activeDeckRef.current = standbyDeck;
        activeKindRef.current = nextKind ?? 'song';
        syncActiveState(standbyDeck);
        transitionedMediaIdRef.current = standbyMedia.itemId;
        songOutroItemRef.current = null;

        if (standbyAudio.error || !standbyAudio.src) {
          warn(`[MusicPlayer] Timed standby deck ${standbyDeck} has error or no src. Reloading it.`);
          if (standbyMedia.url) standbyAudio.src = standbyMedia.url;
          standbyAudio.load();
        }

        standbyAudio.volume = 0;
        setTransitionPhase(
          nextKind === 'announcer'
            ? 'announcing'
            : nextKind === 'song'
              ? 'song-fade-in'
              : 'playing'
        );
        log(`[MusicPlayer] Calling play() on timed standby deck: ${standbyDeck}`);
        standbyAudio.play()
          .then(() => log(`[MusicPlayer] play() succeeded on timed standby deck: ${standbyDeck}`))
          .catch((err) => {
            warn(`[MusicPlayer] play() failed on timed standby deck ${standbyDeck}:`, err);
            handlePlayFailure(err);
          });
        fadeDeck(standbyAudio, deckTargetVolume(standbyAudio, volume), fadeInMs);
        onFinishedRef.current();
      };

      if (currentKind === 'song' && nextKind === 'announcer') {
        log('[MusicPlayer] Timeline: song ended; starting BGM lead-in.');
        setTransitionPhase('bgm-lead-in');
        fadeBgm(bgmTargetVolume, BGM_FADE_IN_MS);
        scheduleTransition(generation, BGM_LEAD_IN_MS, () => {
          promoteNext(ANNOUNCER_FADE_IN_MS);
        });
        return;
      }

      if (currentKind === 'announcer' && nextKind === 'announcer') {
        log('[MusicPlayer] Timeline: holding BGM for three seconds between announcers.');
        setTransitionPhase('bgm-tail');
        fadeBgm(bgmTargetVolume, ANNOUNCER_FADE_IN_MS);
        scheduleTransition(generation, ANNOUNCER_GAP_MS, () => {
          promoteNext(ANNOUNCER_FADE_IN_MS);
        });
        return;
      }

      if (currentKind === 'announcer' && nextKind !== 'announcer') {
        log('[MusicPlayer] Timeline: announcer ended; holding BGM for three seconds.');
        setTransitionPhase('bgm-tail');
        fadeBgm(bgmTargetVolume, ANNOUNCER_FADE_IN_MS);
        scheduleTransition(generation, BGM_TAIL_MS, () => {
          log('[MusicPlayer] Timeline: fading BGM out.');
          setTransitionPhase('bgm-fade-out');
          fadeBgm(0, BGM_FADE_OUT_MS);
        });
        scheduleTransition(generation, BGM_TAIL_MS + BGM_FADE_OUT_MS, () => {
          log('[MusicPlayer] Timeline: beginning natural silence before music.');
          setTransitionPhase('silence');
        });
        scheduleTransition(
          generation,
          BGM_TAIL_MS + BGM_FADE_OUT_MS + BETWEEN_BREAK_AND_SONG_MS,
          () => promoteNext(nextKind === 'song' ? SONG_FADE_IN_MS : 700)
        );
        return;
      }

      if (currentKind === 'jingle' && nextKind === 'announcer') {
        setTransitionPhase('bgm-lead-in');
        fadeBgm(bgmTargetVolume, BGM_FADE_IN_MS);
        scheduleTransition(generation, BGM_LEAD_IN_MS, () => {
          promoteNext(ANNOUNCER_FADE_IN_MS);
        });
        return;
      }

      promoteNext(nextKind === 'song' ? SONG_FADE_IN_MS : 700);
    },
    [
      bgmTargetVolume,
      cancelTransitionTimeline,
      elementFor,
      fadeBgm,
      fadeDeck,
      handlePlayFailure,
      scheduleTransition,
      syncActiveState,
      volume,
    ]
  );

  const handlePlayPause = useCallback(() => {
    const audio = elementFor(activeDeckRef.current);
    if (!audio) return;
    if (audio.paused) {
      audio.play()
        .then(() => {
          setNeedsInteraction(false);
          document.removeEventListener('click', handleInteraction);
          document.removeEventListener('keydown', handleInteraction);
        })
        .catch((err) => {
          setHasError(true);
          handlePlayFailure(err);
        });
    } else {
      audio.pause();
    }
  }, [elementFor, handleInteraction, handlePlayFailure]);

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

  const updateSongOutro = useCallback(
    (deck: DeckName, audio: HTMLAudioElement) => {
      if (activeDeckRef.current !== deck || activeKindRef.current !== 'song') return;

      const mediaId = deckMediaRef.current[deck].itemId;
      const remaining = audio.duration - audio.currentTime;
      const shouldFadeForAnnouncer = playbackKindsRef.current.next === 'announcer';

      if (
        shouldFadeForAnnouncer &&
        mediaId &&
        Number.isFinite(remaining) &&
        remaining > 0 &&
        remaining <= SONG_OUTRO_MS / 1000
      ) {
        if (songOutroItemRef.current === mediaId) return;
        songOutroItemRef.current = mediaId;
        setTransitionPhase('song-outro');
        log(`[MusicPlayer] Timeline: fading song over its final ${remaining.toFixed(2)} seconds.`);
        fadeDeck(audio, 0, Math.max(250, remaining * 1000));
        return;
      }

      if (
        songOutroItemRef.current === mediaId &&
        (!shouldFadeForAnnouncer || remaining > SONG_OUTRO_MS / 1000)
      ) {
        cancelDeckFade(audio);
        songOutroItemRef.current = null;
        audio.volume = deckTargetVolume(audio, volume);
        setTransitionPhase('playing');
      }
    },
    [fadeDeck, volume]
  );

  const deckEvents = (deck: DeckName) => ({
    onCanPlay: () => {
      log(`[MusicPlayer] deckEvents onCanPlay. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      setIsReady(true);
      setHasError(false);
      const audio = elementFor(deck);
      if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onPlaying: () => {
      log(`[MusicPlayer] deckEvents onPlaying. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      const media = deckMediaRef.current[deck];
      log(`[MusicPlayer] Playback started for itemId: ${media.itemId}`);
      setIsPlaying(true);
      setIsReady(true);
      setHasError(false);
      setTransitionPhase(activeKindRef.current === 'announcer' ? 'announcing' : 'playing');
      const audio = elementFor(deck);
      if (audio) updateSongOutro(deck, audio);
    },
    onWaiting: () => {
      log(`[MusicPlayer] deckEvents onWaiting. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      setIsReady(false);
    },
    onStalled: () => {
      log(`[MusicPlayer] deckEvents onStalled. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      setIsReady(false);
    },
    onLoadStart: () => {
      log(`[MusicPlayer] deckEvents onLoadStart. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      setIsReady(false);
    },
    onPause: () => {
      if (activeDeckRef.current !== deck) return;
      setIsPlaying(false);
      const audio = elementFor(deck);
      if (audio && !audio.ended && songOutroItemRef.current === deckMediaRef.current[deck].itemId) {
        cancelDeckFade(audio);
        songOutroItemRef.current = null;
        audio.volume = deckTargetVolume(audio, volume);
      }
      if (audio && !audio.ended) setTransitionPhase('paused');
    },
    onTimeUpdate: () => {
      if (activeDeckRef.current !== deck) return;
      const audio = elementFor(deck);
      if (!audio) return;
      setCurrentTime(audio.currentTime);
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
      updateSongOutro(deck, audio);
    },
    onDurationChange: () => {
      if (activeDeckRef.current !== deck) return;
      const audio = elementFor(deck);
      if (audio && Number.isFinite(audio.duration)) setDuration(audio.duration);
    },
    onEnded: () => {
      log(`[MusicPlayer] deckEvents onEnded. deck: ${deck}`);
      handleEnded(deck);
    },
    onError: () => {
      warn(`[MusicPlayer] deckEvents onError. deck: ${deck}, activeDeckRef: ${activeDeckRef.current}`);
      if (activeDeckRef.current !== deck) return;
      setIsPlaying(false);
      setIsReady(false);
      setHasError(true);
      if (autoSkipOnError && !playbackErrorTimerRef.current) {
        playbackErrorTimerRef.current = setTimeout(() => {
          playbackErrorTimerRef.current = null;
          onFinishedRef.current();
        }, 1_500);
      }
    },
  });

  const isTimedBreak =
    transitionPhase === 'bgm-lead-in' ||
    transitionPhase === 'bgm-tail' ||
    transitionPhase === 'bgm-fade-out' ||
    transitionPhase === 'silence';
  const isOnAir = isPlaying && !isTimedBreak;
  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  const volumePercent = Math.round(volume * 100);
  const spectrumRef = useAudioSpectrum({
    activeDeck,
    elementFor,
    playing: isOnAir,
  });
  const playerStatus = isOnAir
    ? 'ON AIR'
    : hasError
      ? 'Playback error'
      : isTimedBreak
        ? 'Station break'
        : isReady
          ? 'Ready'
          : 'Buffering';

  return (
    <div className="music-player-stage w-full">
      <div
        aria-hidden="true"
        className={`player-vinyl hidden sm:block ${isOnAir ? 'is-spinning' : ''}`}
      >
        <div className="player-vinyl__grooves" />
        <div className="player-vinyl__label player-vinyl__label--empty">
          {thumbnailUrl ? (
            <img
              key={thumbnailUrl}
              src={thumbnailUrl}
              alt=""
              onError={(event) => {
                event.currentTarget.hidden = true;
              }}
            />
          ) : null}
        </div>
        <div className="player-vinyl__spindle" />
      </div>

      <section className="music-player text-white p-4 rounded-2xl shadow-lg w-full" aria-label="Audio player">
        <audio ref={deckARef} {...deckEvents('a')} />
        <audio ref={deckBRef} {...deckEvents('b')} />
        <audio ref={bgmRef} src="/audio/bgm.mp3" loop />

        <div aria-hidden="true" className="music-player__seigaiha" />
        <div aria-hidden="true" className="music-player__asanoha" />

        <div className="music-player__body flex flex-col sm:flex-row items-center gap-4">
          <div className="player-artwork player-artwork--empty w-24 h-24 rounded-xl grid place-items-center text-3xl mx-auto sm:mx-0 shrink-0">
            <span aria-hidden="true">♪</span>
            {videoUrl ? (
              <video
                key={videoUrl}
                ref={visualVideoRef}
                src={videoUrl}
                poster={thumbnailUrl || undefined}
                muted
                playsInline
                preload="auto"
                aria-hidden="true"
              />
            ) : thumbnailUrl ? (
              <img
                key={thumbnailUrl}
                src={thumbnailUrl}
                alt=""
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
              />
            ) : null}
          </div>

          <div className="player-console w-full min-w-0 flex-grow">
            <div className="player-status-row">
              <div
                className={`on-air-badge ${isOnAir ? 'is-live' : ''}`}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" className="on-air-badge__light" />
                <span>{playerStatus}</span>
              </div>
            </div>

            <div className="player-timeline">
              <div className="player-timeline__header">
                <span className="player-timeline__time">{formatTime(currentTime)}</span>
                <div
                  ref={spectrumRef}
                  aria-hidden="true"
                  className={`audio-spectrum ${isOnAir ? 'is-active' : ''}`}
                  data-mode="idle"
                >
                  {SPECTRUM_BARS.map((bar) => (
                    <span
                      key={bar}
                      style={
                        {
                          '--spectrum-delay': `${-(bar % 9) * 90}ms`,
                          '--spectrum-level': '0.12',
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </div>
                <span className="player-timeline__time player-timeline__time--end">
                  {formatTime(duration)}
                </span>
              </div>

              <input
                aria-label="Seek"
                aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                type="range"
                min="0"
                max={duration || 0}
                step="0.1"
                value={Math.min(currentTime, duration || 0)}
                onChange={handleSeek}
                disabled={!duration}
                className="modern-range progress-range w-full"
                style={{ '--progress': `${progressPercent}%` } as React.CSSProperties}
              />
            </div>

            <div className="player-controls">
              <button
                type="button"
                onClick={handlePlayPause}
                className="player-play-button"
                disabled={isTimedBreak || (!isPlaying && !isReady && !hasError)}
                aria-label={
                  isTimedBreak
                    ? 'Station break in progress'
                    : isPlaying
                      ? 'Pause'
                      : 'Play'
                }
              >
                {isOnAir ? (
                  <PauseIcon className="h-5 w-5" />
                ) : (
                  <PlayIcon className="h-5 w-5 translate-x-px" />
                )}
              </button>

              {hasError && (
                <button
                  type="button"
                  onClick={() => onFinishedRef.current()}
                  className="player-skip-button"
                >
                  Skip
                </button>
              )}

              <div className="player-volume">
                <button
                  type="button"
                  className="player-volume__mute"
                  onClick={handleToggleMute}
                  aria-label={volume > 0 ? 'Mute' : 'Unmute'}
                >
                  <VolumeIcon muted={volume === 0} className="h-5 w-5" />
                </button>
                <label className="sr-only" htmlFor={`volume-${itemId}`}>
                  Volume
                </label>
                <input
                  id={`volume-${itemId}`}
                  aria-label="Volume"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={volume}
                  onChange={(event) => setVolume(Number(event.target.value))}
                  className="modern-range volume-range"
                  style={{ '--progress': `${volumePercent}%` } as React.CSSProperties}
                />
                <span className="player-volume__value">{volumePercent}</span>
              </div>
            </div>

            {needsInteraction && (
              <div className="player-notice">
                <VolumeIcon muted={false} className="h-4 w-4 shrink-0" />
                <span>Autoplay blocked. Click anywhere on the page to start listening.</span>
              </div>
            )}
            {hasError && <p className="player-error">{playbackErrorMessage}</p>}
            <span className="sr-only">Active audio deck: {activeDeck}</span>
          </div>
        </div>
      </section>
    </div>
  );
};
export default MusicPlayer;
