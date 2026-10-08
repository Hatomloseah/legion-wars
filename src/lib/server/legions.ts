import "server-only";
import { HEXES, hexDistance } from "@/lib/game/hexmap";
import { seasonAt } from "@/lib/game/schedule";
import type { ConfigSource, PublicSwarm, Swarm } from "@/lib/game/types";
import { Rng, hashString } from "@/lib/sim/fixed";
import type { AbilityKind, BehaviorConfig, DroneDesign } from "@/lib/sim/types";
import { config } from "./config";
import { type DB, mutateWorld } from "./store";
import { ensureWorld, homeSet, starterTerritory, territoryOf, toPublic } from "./world";

export interface NewLegion {
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  description: string;
  tactics: string;
  tacticsHash: string;
  config: BehaviorConfig;
  configSource: ConfigSource;
  ability: AbilityKind;
  creator: string;
  mint: string;
  image?: string;
  metadataUri?: string;
  launchSig?: string;
  demo: boolean;
  mcapSol: number;
}

export const RESERVED_TICKERS = ["LEGION", "SOL", "USDC", "USDT", "PUMP"];

export function legionIdFor(ticker: string, mint: string): string {
  return `${ticker.toLowerCase()}-${mint.slice(0, 4).toLowerCase()}`;
}

export function validTicker(t: string): boolean {
  return /^[A-Z0-9]{2,10}$/.test(t);
}

/** Open ground 2-4 hexes from existing territory so a newcomer gets fights quickly. Deterministic per mint. */
function pickHome(db: DB, seed: number): number {
  const homes = homeSet(db);
  const owned = new Set(Object.keys(db.owners).map(Number));
  const rng = new Rng(seed);
  const order = HEXES.map((h) => h.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const distToOwned = (id: number) => {
    let d = Number.POSITIVE_INFINITY;
    for (const o of owned) d = Math.min(d, hexDistance(id, o));
    return d;
  };
  for (const [lo, hi] of [
    [2, 4],
    [2, 99],
    [1, 99],
  ]) {
    for (const id of order) {
      if (owned.has(id) || homes.has(id)) continue;
      const d = owned.size ? distToOwned(id) : 3;
      if (d >= lo && d <= hi) return id;
    }
  }
  for (const id of order) if (!homes.has(id)) return id;
  return order[0];
}

export async function tickerTaken(ticker: string, now: number): Promise<boolean> {
  if (RESERVED_TICKERS.includes(ticker)) return true;
  const db = await ensureWorld(now, 2000);
  return db.swarms.some((s) => s.ticker === ticker);
}

export async function worldCapacity(now: number): Promise<{ count: number; max: number }> {
  const db = await ensureWorld(now, 2000);
  return { count: db.swarms.length, max: config.maxSwarms };
}

export async function registerLegion(input: NewLegion, now: number): Promise<{ ok: true; legion: PublicSwarm } | { ok: false; error: string }> {
  const season = seasonAt(now);
  await ensureWorld(now, 0);
  const id = legionIdFor(input.ticker, input.mint);
  const { db, result } = await mutateWorld<{ error: string } | true>(season, (d) => {
    if (d.swarms.some((s) => s.mint === input.mint)) return { error: "This coin is already registered" };
    if (d.swarms.some((s) => s.ticker === input.ticker) || RESERVED_TICKERS.includes(input.ticker)) return { error: `$${input.ticker} is already taken` };
    if (d.swarms.length >= config.maxSwarms) return { error: "The map is full. Try again next season." };
    const sw: Swarm = {
      id,
      name: input.name,
      ticker: input.ticker,
      color: input.color,
      design: input.design,
      description: input.description,
      tactics: input.tactics,
      tacticsHash: input.tacticsHash,
      config: input.config,
      configSource: input.configSource,
      ability: input.ability,
      creator: input.creator,
      mint: input.mint,
      image: input.image,
      metadataUri: input.metadataUri,
      launchSig: input.launchSig,
      homeHex: pickHome(d, hashString(`home:${input.mint}`)),
      house: false,
      demo: input.demo,
      mcapSol: input.mcapSol,
      wins: 0,
      losses: 0,
      allWins: 0,
      allLosses: 0,
      prizesWon: 0,
      prizeSol: 0,
      createdAt: now,
    };
    d.swarms.push(sw);
    starterTerritory(d, sw, true);
    return true;
  });
  if (result !== true) return { ok: false, error: result === false ? "Could not register legion" : result.error };
  const sw = db.swarms.find((s) => s.id === id);
  if (!sw) return { ok: false, error: "Could not register legion" };
  return { ok: true, legion: toPublic(sw, territoryOf(db)[id] ?? 0) };
}
