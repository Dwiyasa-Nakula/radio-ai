import type { AudioQuality, RadioStation } from './types';

const CODEC_SCORE: Record<string, number> = {
  OPUS: 5,
  'AAC+': 4,
  AAC: 3,
  OGG: 2,
  MP3: 1,
};

function dataSaverBucket(station: RadioStation): number {
  if (station.bitrate > 0 && station.bitrate <= 96) return 2;
  if (station.bitrate === 0) return 1;
  return 0;
}

export function rankRadioStations(
  stations: RadioStation[],
  quality: AudioQuality
): RadioStation[] {
  return [...stations].sort((left, right) => {
    if (quality === 'balanced') return right.votes - left.votes;
    if (quality === 'dataSaver') {
      const bucketDifference = dataSaverBucket(right) - dataSaverBucket(left);
      if (bucketDifference) return bucketDifference;
      if (left.bitrate > 0 && right.bitrate > 0 && left.bitrate !== right.bitrate) {
        return left.bitrate - right.bitrate;
      }
      return right.votes - left.votes;
    }

    const codecDifference = (CODEC_SCORE[right.codec] ?? 0) - (CODEC_SCORE[left.codec] ?? 0);
    if (codecDifference) return codecDifference;
    const bitrateDifference = right.bitrate - left.bitrate;
    return bitrateDifference || right.votes - left.votes;
  });
}
