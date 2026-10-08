/**
 * Deterministic math primitives for the lockstep battle sim.
 *
 * Rules:
 *  - All sim state is integer-valued (stored in typed arrays or as integer doubles).
 *  - Only IEEE-exact operations are used (+, -, *, /, Math.trunc, Math.imul, bit ops).
 *  - No Math.sin / Math.cos / Math.random / Math.atan2 inside the sim.
 *  - Trig comes from an integer lookup table built with Bhaskara's rational
 *    approximation (pure integer arithmetic, identical on every engine).
 */

/** Fixed-point scale: 1 world unit = 1024 sim units. */
export const FX = 1024;

/** Full circle in angle units. */
export const ANG = 1024;
const HALF = ANG / 2;
// 5 * HALF^2 / 4 — Bhaskara I denominator constant for a half-turn of HALF units
const BHASKARA_K = (5 * HALF * HALF) / 4;

/** sin table, scaled by FX. Built with integer-only math. */
export const SIN_LUT: Int32Array = (() => {
  const t = new Int32Array(ANG);
  for (let a = 0; a < ANG; a++) {
    const u = a % HALF;
    const p = u * (HALF - u);
    const v = Math.trunc((4 * p * FX) / (BHASKARA_K - p));
    t[a] = a < HALF ? v : -v;
  }
  return t;
})();

export function sinFx(a: number): number {
  return SIN_LUT[a & (ANG - 1)];
}

export function cosFx(a: number): number {
  return SIN_LUT[(a + ANG / 4) & (ANG - 1)];
}

/**
 * Exact integer square root (floor). Math.sqrt is only used as a seed and the
 * result is corrected with integer comparisons, so the output is exact everywhere.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/** 32-bit integer hash of two ints. */
export function hash32(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/** FNV-1a string hash -> uint32. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seeded PRNG (mulberry32). Integer-only, deterministic across engines. */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }
  /** integer in [0, n) */
  int(n: number): number {
    return this.next() % n;
  }
  /** integer in [lo, hi] */
  range(lo: number, hi: number): number {
    return lo + (this.next() % (hi - lo + 1));
  }
  /** float in [0,1) — NOT for use inside the sim, only for generators */
  float(): number {
    return this.next() / 4294967296;
  }
}
