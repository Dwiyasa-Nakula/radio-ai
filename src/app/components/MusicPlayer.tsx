// src/app/components/MusicPlayer.tsx
"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';

interface MusicPlayerProps {
  videoId: string;
  thumbnailUrl: string;
}

const MusicPlayer: React.FC<MusicPlayerProps> = ({ videoId, thumbnailUrl }) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurfer = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [volume, setVolume] = useState(0.8);

  useEffect(() => {
    if (waveformRef.current) {
      // Clean up previous instance if it exists
      wavesurfer.current?.destroy();
      
      const ws = WaveSurfer.create({
        container: waveformRef.current,
        waveColor: '#4F4A85',
        progressColor: '#383351',
        url: `/api/audio/${videoId}`, // Load the audio directly
        barWidth: 2,
        barRadius: 3,
        height: 100,
      });

      wavesurfer.current = ws;

      // --- Event-driven state updates ---
      ws.on('ready', () => {
        setIsReady(true);
      });
      ws.on('play', () => {
        setIsPlaying(true);
      });
      ws.on('pause', () => {
        setIsPlaying(false);
      });
      ws.on('finish', () => {
        setIsPlaying(false); // Song finished
      });
      ws.on('error', (err) => {
        console.error('WaveSurfer error:', err);
      });

      return () => {
        ws.destroy();
      };
    }
  }, [videoId]); // Re-run effect only when videoId changes

  const handlePlayPause = useCallback(() => {
    if (wavesurfer.current) {
      wavesurfer.current.playPause();
    }
  }, []);

  const onVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    setVolume(newVolume);
    if (wavesurfer.current) {
      wavesurfer.current.setVolume(newVolume);
    }
  }, []);

  return (
    <div className="music-player bg-gray-800 text-white p-4 rounded-lg shadow-lg">
      <div className="flex items-center">
        <img src={thumbnailUrl} alt="thumbnail" className="w-24 h-24 rounded-md" />
        <div className="ml-4 flex-grow">
          <div ref={waveformRef} />
          <div className="controls mt-2 flex items-center">
            <button 
              onClick={handlePlayPause} 
              className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full disabled:bg-gray-500"
              disabled={!isReady}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={onVolumeChange}
              className="ml-4"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default MusicPlayer;