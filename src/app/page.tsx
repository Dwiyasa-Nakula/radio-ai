// src/app/page.tsx
import Image from "next/image";
import MusicPlayer from "./components/MusicPlayer";

export default function Home() {
  const videoId = 'uE6DYMHs6Zw'; // The ID of the YouTube video
  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  return (
    <div className="font-sans grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
       
        {/* Your new music player */}
        <div className="w-full max-w-2xl">
          <MusicPlayer videoId={videoId} thumbnailUrl={thumbnailUrl} />
        </div>

      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        {/* ... your footer content ... */}
      </footer>
    </div>
  );
}