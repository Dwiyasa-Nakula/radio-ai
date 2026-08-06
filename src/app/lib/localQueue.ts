import type { Track } from './types';

export const LOCAL_FAVORITE_LIMIT = 10;
export const LOCAL_FAVORITE_BOOST_CHANCE = 0.1;

export function sanitizeLocalFavoriteTrackIds(
  value: unknown,
  eligibleIds?: ReadonlySet<string>
): string[] {
  if (!Array.isArray(value)) return [];

  const favorites: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      !candidate.startsWith('local:') ||
      seen.has(candidate) ||
      (eligibleIds && !eligibleIds.has(candidate))
    ) {
      continue;
    }
    seen.add(candidate);
    favorites.push(candidate);
    if (favorites.length === LOCAL_FAVORITE_LIMIT) break;
  }
  return favorites;
}

export function applyLocalFavoriteBoost(
  shuffledTracks: Track[],
  favoriteTrackIds: unknown,
  random: () => number = Math.random
): Track[] {
  if (shuffledTracks.length === 0) return [];

  const trackById = new Map(shuffledTracks.map((track) => [track.id, track]));
  const favoriteIds = sanitizeLocalFavoriteTrackIds(
    favoriteTrackIds,
    new Set(trackById.keys())
  );
  if (favoriteIds.length === 0) return [...shuffledTracks];

  const boosted = [...shuffledTracks];
  for (const favoriteId of favoriteIds) {
    if (random() >= LOCAL_FAVORITE_BOOST_CHANCE) continue;
    const favorite = trackById.get(favoriteId);
    if (!favorite) continue;

    const validSlots: number[] = [];
    for (let slot = 0; slot <= boosted.length; slot += 1) {
      if (boosted[slot - 1]?.id !== favoriteId && boosted[slot]?.id !== favoriteId) {
        validSlots.push(slot);
      }
    }
    const slots = validSlots.length > 0
      ? validSlots
      : Array.from({ length: boosted.length + 1 }, (_, index) => index);
    const selectedSlot = slots[Math.floor(random() * slots.length)] ?? boosted.length;
    boosted.splice(selectedSlot, 0, favorite);
  }
  return boosted;
}