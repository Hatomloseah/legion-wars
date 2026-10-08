import type { RoundInfo } from "./types";

/** Battle times are derived from the wall clock — no scheduler state needed. */
export const ROUND_MS = 10 * 60 * 1000;
export const BATTLE_MS = 3 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** 1970-01-04T00:00:00Z was a Sunday. Seasons reset every Sunday 00:00 UTC. */
const SUNDAY_EPOCH = 3 * 24 * HOUR_MS;

export function roundIndexAt(t: number): number {
  return Math.floor(t / ROUND_MS);
}

export function roundInfo(t: number): RoundInfo {
  const index = roundIndexAt(t);
  const startsAt = index * ROUND_MS;
  const battleEndsAt = startsAt + BATTLE_MS;
  return {
    index,
    startsAt,
    battleEndsAt,
    endsAt: startsAt + ROUND_MS,
    phase: t < battleEndsAt ? "battle" : "break",
  };
}

export function seasonAt(t: number): number {
  return Math.floor((t - SUNDAY_EPOCH) / WEEK_MS);
}

export function seasonEndsAt(t: number): number {
  return (seasonAt(t) + 1) * WEEK_MS + SUNDAY_EPOCH;
}

export function hourEndsAt(t: number): number {
  return (Math.floor(t / HOUR_MS) + 1) * HOUR_MS;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
