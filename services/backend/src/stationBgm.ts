import { join } from 'node:path';

export interface StationBgm {
  filePath: string;
  contentType: 'audio/mpeg';
}

export function stationBgm(rootDirectory = process.cwd()): StationBgm {
  return {
    filePath: join(rootDirectory, 'public', 'audio', 'bgm.mp3').replace(/\\/g, '/'),
    contentType: 'audio/mpeg',
  };
}
