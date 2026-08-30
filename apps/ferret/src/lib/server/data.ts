import type { RecordingNote } from '@craig/types/recording';

import { redis } from './redis';
import { getRecordingDuration, getRecordingNotes } from './util';

export async function getRecordingDurationWithCache(id: string, dataSize?: number): Promise<number | false> {
  const cacheKey = dataSize !== undefined ? `rec_duration:${id}:${dataSize}` : undefined;
  let duration: number | false | null = null;

  if (cacheKey) {
    const cached = await redis.get(cacheKey);
    if (cached !== null) duration = Number(cached);
  }

  if (duration === null) {
    duration = await getRecordingDuration(id);
    if (duration === false) return false;
    if (cacheKey) await redis.set(cacheKey, String(duration), 'EX', 24 * 60 * 60);
  }

  return duration;
}

export async function getCachedRecordingDuration(id: string, dataSize?: number): Promise<number | null> {
  const cacheKey = dataSize !== undefined ? `rec_duration:${id}:${dataSize}` : undefined;

  if (cacheKey) {
    const cached = await redis.get(cacheKey);
    if (cached !== null) return Number(cached);
  }

  return null;
}

export async function getRecordingNotesWithCache(id: string, dataSize?: number): Promise<RecordingNote[] | false> {
  const cacheKey = dataSize !== undefined ? `rec_notes:${id}:${dataSize}` : undefined;
  let notes: RecordingNote[] | false | null = null;

  if (cacheKey) {
    const cached = await redis.get(cacheKey);
    if (cached !== null) notes = JSON.parse(cached);
  }

  if (notes === null) {
    notes = await getRecordingNotes(id);
    if (notes === false) return false;
    if (cacheKey) await redis.set(cacheKey, JSON.stringify(notes), 'EX', 24 * 60 * 60);
  }

  return notes;
}
