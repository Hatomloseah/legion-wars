import { Rng, hashString } from "@/lib/sim/fixed";
import { HEXES, NEIGHBORS, hexDistance } from "./hexmap";

export const MAX_BATTLES = 12;

export interface Matchup {
  attacker: string;
  defender: string;
  /** hex the attacker captures on victory / hex the defender captures on victory */
  prizeHex: [number, number];
}

function territoryDistance(a: number[], b: number[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const x of a) {
    for (const y of b) {
      const d = hexDistance(x, y);
      if (d < best) best = d;
    }
  }
  return best;
}

/**
 * Hex `self` wins if it beats `other`:
 * 1) a non-home hex of `other` that borders our territory (a real border fight), else
 * 2) the unclaimed hex within reach (<=2, or <=4 across straits) closest to the enemy, else
 * 3) the enemy's non-home hex closest to us.
 */
function prizeFor(
  self: string,
  other: string,
  terr: Map<string, number[]>,
  owners: Map<number, string>,
  homes: Set<number>,
): number {
  const mine = terr.get(self) ?? [];
  const theirs = terr.get(other) ?? [];
  const mineSet = new Set(mine);

  const border = theirs
    .filter((h) => !homes.has(h) && NEIGHBORS[h].some((n) => mineSet.has(n)))
    .sort((a, b) => a - b);
  if (border.length) return border[0];

  for (const reach of [2, 4]) {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (const hex of HEXES) {
      if (owners.has(hex.id)) continue;
      let near = false;
      for (const m of mine) {
        if (hexDistance(m, hex.id) <= reach) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      let d = Number.POSITIVE_INFINITY;
      for (const t of theirs) d = Math.min(d, hexDistance(t, hex.id));
      if (d < bestD || (d === bestD && hex.id < best)) {
        bestD = d;
        best = hex.id;
      }
    }
    if (best >= 0) return best;
  }

  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of theirs) {
    if (homes.has(t)) continue;
    let d = Number.POSITIVE_INFINITY;
    for (const m of mine) d = Math.min(d, hexDistance(m, t));
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function makeMatchups(round: number, season: number, swarmIds: string[], owners: Map<number, string>, homes: Set<number>): Matchup[] {
  const terr = new Map<string, number[]>();
  for (const [hex, id] of owners) {
    if (!terr.has(id)) terr.set(id, []);
    terr.get(id)?.push(hex);
  }
  const active = swarmIds.filter((id) => (terr.get(id)?.length ?? 0) > 0).sort();
  const rng = new Rng(hashString(`mm:${season}:${round}`));
  for (let i = active.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [active[i], active[j]] = [active[j], active[i]];
  }

  const paired = new Set<string>();
  const out: Matchup[] = [];
  for (const a of active) {
    if (out.length >= MAX_BATTLES) break;
    if (paired.has(a)) continue;
    const cands = active
      .filter((b) => b !== a && !paired.has(b))
      .map((b) => ({ b, d: territoryDistance(terr.get(a) ?? [], terr.get(b) ?? []) }))
      .sort((x, y) => x.d - y.d || (x.b < y.b ? -1 : 1));
    if (!cands.length) continue;
    const pick = cands.length > 1 && rng.int(100) < 30 ? cands[1].b : cands[0].b;
    paired.add(a);
    paired.add(pick);
    out.push({
      attacker: a,
      defender: pick,
      prizeHex: [prizeFor(a, pick, terr, owners, homes), prizeFor(pick, a, terr, owners, homes)],
    });
  }
  return out;
}
