// src/app/page.tsx
"use client";

import React, { useState, useEffect, useCallback } from "react";
import MusicPlayer from "./components/MusicPlayer";

interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail: string;
}

const shuffleArray = (array: Song[]) => {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
};

export default function Home() {
  const playlistId = 'PLrGlZyus6hMJKwsv6k6R8rd2a9tlSCzLd';

  const [songQueue, setSongQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentAudioUrl, setCurrentAudioUrl] = useState<string | null>(null);
  const [preloaded, setPreloaded] = useState<{ id: string | null; url: string | null }>({ id: null, url: null });
  const [isLoading, setIsLoading] = useState(true);

  // Effect for preloading the *next* song
  // Preload the next song's audio and manage current audio URL
  useEffect(() => {
    let isCancelled = false;

    // Clean up previous blob URLs
    if (currentAudioUrl && currentAudioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentAudioUrl);
      setCurrentAudioUrl(null);
    }
    if (preloaded.url && preloaded.url.startsWith('blob:')) {
      URL.revokeObjectURL(preloaded.url);
      setPreloaded({ id: null, url: null });
    }

    if (songQueue.length === 0) return;

    const currentSong = songQueue[currentIndex];
    const nextIndex = currentIndex + 1;
    const nextSong = songQueue[nextIndex];

    // Fetch current song audio
    fetch(`/api/audio/${currentSong.id}`)
      .then(res => res.blob())
      .then(blob => {
        if (!isCancelled) {
          setCurrentAudioUrl(URL.createObjectURL(blob));
        }
      });

    // Preload next song audio
    if (nextSong) {
      fetch(`/api/audio/${nextSong.id}`)
        .then(res => res.blob())
        .then(blob => {
          if (!isCancelled) {
            setPreloaded({ id: nextSong.id, url: URL.createObjectURL(blob) });
          }
        });
    }

    return () => {
      isCancelled = true;
    };
  }, [currentIndex, songQueue]);

  // Effect for the initial playlist fetch
  useEffect(() => {
    fetch(`/api/playlist/${playlistId}`)
      .then(res => res.json())
      .then((data: Song[]) => {
        if (data.length > 0) {
          const shuffled = shuffleArray(data);
          setSongQueue(shuffled);
          setCurrentIndex(0);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error("Could not load playlist:", err);
        setIsLoading(false);
      });
  }, [playlistId]);

  const handleNextSong = useCallback(() => {
    const nextIndex = currentIndex + 1;

    if (nextIndex < songQueue.length) {
      setCurrentIndex(nextIndex);
    } else {
      // Loop and reshuffle only when looping
      const shuffled = shuffleArray(songQueue);
      setSongQueue(shuffled);
      setCurrentIndex(0);
    }
  }, [currentIndex, songQueue]);

  const currentSong = songQueue[currentIndex];
  // Use the preloaded URL if it matches the next song's ID, otherwise fallback to API URL
  const audioUrl =
    preloaded.id === currentSong?.id && preloaded.url
      ? preloaded.url
      : currentAudioUrl || (currentSong ? `/api/audio/${currentSong.id}` : undefined);

  return (
    <div className="font-sans grid grid-rows-[auto_1fr_auto] items-center justify-items-center min-h-screen p-8 pb-20 gap-8 sm:p-12">
      <header className="text-center">
        <h1 className="text-4xl font-bold">Radio AI</h1>
      </header>
      <main className="flex flex-col gap-8 w-full max-w-2xl items-center">
        {isLoading && <p>Loading playlist...</p>}
        
        {currentSong ? (
          <>
            <MusicPlayer
              key={currentSong.id}
              audioUrl={audioUrl || ''}
              thumbnailUrl={currentSong.thumbnail}
              onFinished={handleNextSong}
            />
            <div className="text-center">
              <h2 className="text-xl font-semibold">{currentSong.title}</h2>
              <p className="text-md text-gray-300">{currentSong.artist}</p>
              <button
                onClick={handleNextSong}
                className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-full"
              >
                Next Song
              </button>
            </div>
          </>
        ) : (
          !isLoading && <p>Playlist is empty or could not be loaded.</p>
        )}
      </main>
      <footer />
    </div>
  );
}