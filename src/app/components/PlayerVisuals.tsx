"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";

type SpectrumDeck = "a" | "b";

type CapturableAudioElement = HTMLAudioElement & {
  captureStream?: () => MediaStream;
  mozCaptureStream?: () => MediaStream;
};

interface DeckAnalysis {
  analyser: AnalyserNode;
  context: AudioContext;
  stream: MediaStream;
}

interface UseAudioSpectrumOptions {
  activeDeck: SpectrumDeck;
  elementFor: (deck: SpectrumDeck) => HTMLAudioElement | null;
  playing: boolean;
}

const SPECTRUM_BAR_COUNT = 48;
const SPECTRUM_FRAME_MS = 1000 / 30;

export const SPECTRUM_BARS = Array.from(
  { length: SPECTRUM_BAR_COUNT },
  (_, index) => index
);

export function useAudioSpectrum({
  activeDeck,
  elementFor,
  playing,
}: UseAudioSpectrumOptions): RefObject<HTMLDivElement | null> {
  const spectrumRef = useRef<HTMLDivElement>(null);
  const analysesRef = useRef<Record<SpectrumDeck, DeckAnalysis | null>>({
    a: null,
    b: null,
  });
  const unsupportedRef = useRef<Record<SpectrumDeck, boolean>>({
    a: false,
    b: false,
  });

  const ensureAnalysis = useCallback(
    (deck: SpectrumDeck): DeckAnalysis | null => {
      const existing = analysesRef.current[deck];
      if (existing) return existing;
      if (unsupportedRef.current[deck] || typeof window === "undefined") return null;

      const audio = elementFor(deck) as CapturableAudioElement | null;
      const capture = audio?.captureStream ?? audio?.mozCaptureStream;
      if (!audio || !capture || typeof window.AudioContext === "undefined") {
        unsupportedRef.current[deck] = true;
        return null;
      }

      try {
        const stream = capture.call(audio);
        const context = new window.AudioContext({ latencyHint: "playback" });
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.78;
        source.connect(analyser);
        void context.resume().catch(() => undefined);

        const analysis = { analyser, context, stream };
        analysesRef.current[deck] = analysis;
        return analysis;
      } catch {
        unsupportedRef.current[deck] = true;
        return null;
      }
    },
    [elementFor]
  );

  useEffect(() => {
    const spectrum = spectrumRef.current;
    if (!spectrum) return;

    let animationFrame = 0;
    let lastFrameAt = 0;
    const analysis = playing ? ensureAnalysis(activeDeck) : null;
    const frequencyData = analysis
      ? new Uint8Array(analysis.analyser.frequencyBinCount)
      : null;

    const setRestingBars = () => {
      for (const bar of Array.from(spectrum.children)) {
        (bar as HTMLElement).style.setProperty("--spectrum-level", "0.12");
      }
    };

    const stop = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };

    const draw = (now: number) => {
      animationFrame = requestAnimationFrame(draw);
      if (now - lastFrameAt < SPECTRUM_FRAME_MS || document.hidden) return;
      lastFrameAt = now;

      if (!analysis || !frequencyData) return;
      analysis.analyser.getByteFrequencyData(frequencyData);
      const bars = spectrum.children;
      const usableBins = Math.max(1, Math.floor(frequencyData.length * 0.72));

      for (let index = 0; index < bars.length; index += 1) {
        const bin = Math.min(
          usableBins - 1,
          Math.floor((index / Math.max(1, bars.length - 1)) * usableBins)
        );
        const rawLevel = frequencyData[bin] / 255;
        const level = Math.max(0.1, Math.min(1, Math.pow(rawLevel, 0.82) * 1.18));
        (bars[index] as HTMLElement).style.setProperty(
          "--spectrum-level",
          level.toFixed(3)
        );
      }
    };

    const syncVisibility = () => {
      stop();
      if (playing && !document.hidden && analysis) {
        spectrum.dataset.mode = "reactive";
        void analysis.context.resume().catch(() => undefined);
        animationFrame = requestAnimationFrame(draw);
      } else if (playing && !document.hidden) {
        spectrum.dataset.mode = "fallback";
      } else {
        spectrum.dataset.mode = "idle";
        setRestingBars();
      }
    };

    document.addEventListener("visibilitychange", syncVisibility);
    syncVisibility();

    return () => {
      stop();
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, [activeDeck, ensureAnalysis, playing]);

  useEffect(() => {
    return () => {
      for (const deck of ["a", "b"] as const) {
        const analysis = analysesRef.current[deck];
        analysesRef.current[deck] = null;
        if (!analysis) continue;
        for (const track of analysis.stream.getTracks()) track.stop();
        void analysis.context.close().catch(() => undefined);
      }
    };
  }, []);

  return spectrumRef;
}

interface IconProps {
  className?: string;
}

export function PlayIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.25 4.95a1.1 1.1 0 0 1 1.68-.93l10.02 6.31a1.97 1.97 0 0 1 0 3.34L8.93 19.98a1.1 1.1 0 0 1-1.68-.93V4.95Z" />
    </svg>
  );
}

export function PauseIcon({ className = "" }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.25 5.5A1.5 1.5 0 0 1 8.75 4h.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-13Zm6 0a1.5 1.5 0 0 1 1.5-1.5h.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5h-.5a1.5 1.5 0 0 1-1.5-1.5v-13Z" />
    </svg>
  );
}

interface VolumeIconProps extends IconProps {
  muted: boolean;
}

export function VolumeIcon({
  className = "",
  muted,
}: VolumeIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5.5 6.7 9H3.5v6h3.2l4.3 3.5v-13Z" />
      {muted ? (
        <>
          <path d="m16 9 5 5" />
          <path d="m21 9-5 5" />
        </>
      ) : (
        <>
          <path d="M15.5 9a4.2 4.2 0 0 1 0 6" />
          <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
        </>
      )}
    </svg>
  );
}
