// src/app/lib/localMusic.ts
import path from 'node:path';
import { promises as fs } from 'node:fs';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.webm']);

export function getDefaultMusicDir(): string | null {
  const dir = process.env.LOCAL_MUSIC_DIR;
  if (!dir) return null;
  return path.resolve(dir);
}

export function isAudioFile(filePath: string): boolean {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export async function walkAudioFiles(dir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && isAudioFile(entry.name)) {
        out.push(full);
      }
    }
  }

  await walk(dir);
  return out;
}

export function encodeAbsolutePath(absolute: string): string {
  return Buffer.from(absolute).toString('base64url');
}

export function decodeAbsolutePath(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}
