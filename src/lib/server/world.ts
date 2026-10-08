import "server-only";
import { createHash } from "node:crypto";
import { demoEvents, fakeBase58 } from "@/lib/game/demo";
import { baseDrones } from "@/lib/game/drones";
import { NEIGHBORS, nearestHex } from "@/lib/game/hexmap";
import { FLAGSHIP_ID, HOUSE_SWARMS, type HouseSwarmDef } from "@/lib/game/house";
import { makeMatchups } from "@/lib/game/matchmaking";
import { BATTLE_MS, ROUND_MS, roundInfo, seasonAt } from "@/lib/game/schedule";
import type { BattlePhase, BattleRecord, BattleSide, PublicSwarm, RoundRecord, Swarm } from "@/lib/game/types";
import { Rng, hashString } from "@/lib/sim/fixed";
import { type SimEvent, type SimSideInput, compareEvents } from "@/lib/sim/types";
import { DEMO, SERVERLESS, config } from "./config";
import { type DB, mutateWorld, readWorld } from "./store";

/** Rounds kept in the world doc. Older settled battles live in `battle:<id>` archives. */
export const KEEP_ROUNDS = 8;
/** live mode waits a few seconds after a battle ends so late webhook trades still count */
export const SETTLE_GRACE_MS = DEMO ? 0 : 6000;
export const READ_CACHE_MS = 1000;

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ------------------------------------------------------------------ seeding
export function starterTerritory(db: DB, sw: Swarm, cluster: boolean): void {
  db.owners[sw.homeHex] = sw.id;
  if (!cluster) return;
  for (const n of NEIGHBORS[sw.homeHex]) if (!db.owners[n]) db.owners[n] = sw.id;
}

function flagshipMint(): { mint: string; demo: boolean } {
  if (config.legionMint && !DEMO) return { mint: config.legionMint, demo: false };
  const rng = new Rng(hashString(`mint:${FLAGSHIP_ID}`));
  return { mint: config.legionMint || `${fakeBase58(rng, 40)}pump`, demo: true };
}

function houseSwarm(def: HouseSwarmDef, home: number, now: number): Swarm {
  const rng = new Rng(hashString(`mint:${def.id}`));
  const fm = def.flagship ? flagshipMint() : null;
  return {
    id: def.id,
    name: def.name,
    ticker: def.ticker,
    color: def.color,
    design: def.design,
    description: def.description,
    tactics: def.tactics,
    tacticsHash: sha256(def.tactics),
    config: def.config,
    configSource: "house",
    ability: def.ability,
    creator: "HOUSE",
    mint: fm ? fm.mint : `${fakeBase58(rng, 40)}pump`,
    homeHex: home,
    house: true,
    flagship: def.flagship || undefined,
    demo: fm ? fm.demo : true,
    mcapSol: def.mcapSol,
    wins: 0,
    losses: 0,
    allWins: 0,
    allLosses: 0,
    prizesWon: 0,
    prizeSol: 0,
    createdAt: now,
  };
}

function missingHouse(db: DB): HouseSwarmDef[] {
  return HOUSE_SWARMS.filter((d) => !db.swarms.some((s) => s.id === d.id));
}

function flagshipOutOfSync(db: DB): boolean {
  const f = db.swarms.find((s) => s.id === FLAGSHIP_ID);
  if (!f) return false;
  const want = flagshipMint();
  return f.mint !== want.mint || f.demo !== want.demo || !f.flagship;
}

function seedHouse(db: DB, now: number): void {
  const used = new Set<number>(db.swarms.map((s) => s.homeHex));
  for (const def of missingHouse(db)) {
    const home = nearestHex(def.home[0], def.home[1], used);
    used.add(home);
    const sw = houseSwarm(def, home, now);
    db.swarms.push(sw);
    starterTerritory(db, sw, true);
  }
  const f = db.swarms.find((s) => s.id === FLAGSHIP_ID);
  if (f) {
    const want = flagshipMint();
    f.mint = want.mint;
    f.demo = want.demo;
    f.flagship = true;
  }
}

/** Legions launched with simulated coins while the server ran in demo mode. */
function demoLaunched(db: DB): Swarm[] {
  return DEMO ? [] : db.swarms.filter((s) => !s.house && s.demo);
}

/** Live mode: drop demo-launched legions, their sectors, and any not-yet-started battles they were in. */
function purgeDemoLaunched(db: DB, now: number): boolean {
  const gone = new Set(demoLaunched(db).map((s) => s.id));
  if (!gone.size) return false;
  db.swarms = db.swarms.filter((s) => !gone.has(s.id));
  for (const [hex, owner] of Object.entries(db.owners)) if (gone.has(owner)) delete db.owners[hex];
  for (const rec of Object.values(db.rounds)) {
    if (rec.index * ROUND_MS <= now) continue;
    rec.battles = rec.battles.filter((b) => !b.sides.some((s) => gone.has(s.swarmId)));
  }
  return true;
}

function resetSeason(db: DB, season: number): void {
  db.season = season;
  db.owners = {};
  db.rounds = {};
  db.lastSettledRound = -1;
  for (const sw of db.swarms) {
    sw.wins = 0;
    sw.losses = 0;
  }
  const ordered = [...db.swarms].sort((a, b) => Number(b.house) - Number(a.house) || a.createdAt - b.createdAt);
  for (const sw of ordered) starterTerritory(db, sw, true);
}

// ------------------------------------------------------------------ rounds
function sideOf(sw: Swarm): BattleSide {
  return {
    swarmId: sw.id,
    name: sw.name,
    ticker: sw.ticker,
    color: sw.color,
    design: sw.design,
    config: sw.config,
    ability: sw.ability,
    baseDrones: baseDrones(sw.mcapSol),
    mcapSol: sw.mcapSol,
    creator: sw.creator,
    mint: sw.mint,
    tacticsHash: sw.tacticsHash,
    demo: sw.demo,
  };
}

export function homeSet(db: DB): Set<number> {
  return new Set(db.swarms.map((s) => s.homeHex));
}

function createRound(db: DB, r: number): RoundRecord {
  const byId = new Map(db.swarms.map((s) => [s.id, s]));
  const owners = new Map<number, string>();
  for (const [k, v] of Object.entries(db.owners)) owners.set(Number(k), v);
  const matchups = makeMatchups(
    r,
    db.season,
    db.swarms.map((s) => s.id),
    owners,
    homeSet(db),
  );
  const startsAt = r * ROUND_MS;
  const battles: BattleRecord[] = matchups.map((m, idx) => {
    const a = byId.get(m.attacker) as Swarm;
    const d = byId.get(m.defender) as Swarm;
    return {
      id: `${r}-${idx}`,
      round: r,
      idx,
      seed: hashString(`${db.season}:${r}:${idx}:${a.id}:${d.id}`),
      startsAt,
      endsAt: startsAt + BATTLE_MS,
      sides: [sideOf(a), sideOf(d)],
      prizeHex: m.prizeHex,
      demoFeed: DEMO || undefined,
    };
  });
  const rec: RoundRecord = { index: r, battles, settled: false };
  db.rounds[r] = rec;
  return rec;
}

function wouldAdvance(db: DB, now: number): boolean {
  const info = roundInfo(now);
  const cur = info.index;
  if (db.swarms.length < 2) return false;
  if (Object.keys(db.rounds).length === 0) return true;
  if (!db.rounds[cur]) {
    const prev = db.rounds[cur - 1];
    if (!prev || prev.settled) return true;
  }
  return info.phase === "break" && !!db.rounds[cur]?.settled && !db.rounds[cur + 1];
}

/** Create rounds whose prerequisites are met. Round r is only built once r-1 is settled (or never existed). */
export function advanceRounds(db: DB, now: number): boolean {
  if (!wouldAdvance(db, now)) return false;
  const info = roundInfo(now);
  const cur = info.index;
  if (Object.keys(db.rounds).length === 0) {
    // prologue round so a replay exists from minute one
    createRound(db, cur - 1);
    createRound(db, cur);
    return true;
  }
  if (!db.rounds[cur]) {
    const prev = db.rounds[cur - 1];
    if (!prev || prev.settled) createRound(db, cur);
  }
  if (info.phase === "break" && db.rounds[cur]?.settled && !db.rounds[cur + 1]) createRound(db, cur + 1);
  for (const k of Object.keys(db.rounds)) {
    if (Number(k) < cur - KEEP_ROUNDS && db.rounds[k].settled) delete db.rounds[k];
  }
  return true;
}

export function dueRounds(db: DB, now: number): RoundRecord[] {
  return Object.values(db.rounds)
    .filter((r) => !r.settled && r.index * ROUND_MS + BATTLE_MS + SETTLE_GRACE_MS <= now)
    .sort((a, b) => a.index - b.index);
}

export function hasPendingSettlement(db: DB, now: number): boolean {
  return dueRounds(db, now).length > 0 || db.pendingPrizes.length > 0;
}

function needsEnsure(db: DB, now: number, season: number): boolean {
  return (
    db.swarms.length === 0 ||
    db.season !== season ||
    missingHouse(db).length > 0 ||
    flagshipOutOfSync(db) ||
    demoLaunched(db).length > 0 ||
    wouldAdvance(db, now)
  );
}

type Kick = () => Promise<void>;
let kicker: Kick | null = null;
/** settle.ts registers the background settler here (avoids an import cycle). */
export function setKicker(k: Kick): void {
  kicker = k;
}

/**
 * Lazy, idempotent world progression. Safe on serverless: everything is derived from the clock +
 * stored state. Never runs the battle sim; settlement happens in settle.ts.
 */
export async function ensureWorld(now: number, maxAgeMs = READ_CACHE_MS): Promise<DB> {
  const season = seasonAt(now);
  let db = await readWorld(season, maxAgeMs);
  if (needsEnsure(db, now, season)) {
    db = (
      await mutateWorld(season, (d) => {
        let dirty = false;
        if (d.swarms.length === 0) d.season = season;
        if (missingHouse(d).length || flagshipOutOfSync(d)) {
          seedHouse(d, now);
          dirty = true;
        }
        if (purgeDemoLaunched(d, now)) dirty = true;
        if (d.season !== season) {
          resetSeason(d, season);
          dirty = true;
        }
        if (advanceRounds(d, now)) dirty = true;
        return dirty ? true : false;
      })
    ).db;
  }
  if (!SERVERLESS && kicker && hasPendingSettlement(db, now)) void kicker();
  return db;
}

// ------------------------------------------------------------------ battle helpers
export function battleEvents(b: BattleRecord, stored: SimEvent[]): SimEvent[] {
  const gen = b.demoFeed || DEMO ? demoEvents(b.id, b.seed, b.startsAt) : [];
  const all = stored.length ? [...gen, ...stored] : gen.slice();
  all.sort(compareEvents);
  return all;
}

export function simInputOf(b: BattleRecord) {
  return {
    seed: b.seed,
    sides: [
      { baseDrones: b.sides[0].baseDrones, config: b.sides[0].config, ability: b.sides[0].ability },
      { baseDrones: b.sides[1].baseDrones, config: b.sides[1].config, ability: b.sides[1].ability },
    ] as [SimSideInput, SimSideInput],
  };
}

export function findBattleIn(db: DB, id: string): BattleRecord | null {
  const [r] = id.split("-");
  return db.rounds[r]?.battles.find((b) => b.id === id) ?? null;
}

export function phaseOf(b: BattleRecord, now: number): BattlePhase {
  if (now < b.startsAt) return "upcoming";
  if (now < b.endsAt) return "live";
  return "ended";
}

export function territoryOf(db: DB): Record<string, number> {
  const t: Record<string, number> = {};
  for (const id of Object.values(db.owners)) t[id] = (t[id] ?? 0) + 1;
  return t;
}

export function toPublic(s: Swarm, territory: number): PublicSwarm {
  return {
    id: s.id,
    name: s.name,
    ticker: s.ticker,
    color: s.color,
    design: s.design,
    description: s.description,
    ability: s.ability,
    config: s.config,
    configSource: s.configSource,
    tactics: s.tactics,
    tacticsHash: s.tacticsHash,
    homeHex: s.homeHex,
    territory,
    wins: s.wins,
    losses: s.losses,
    allWins: s.allWins,
    allLosses: s.allLosses,
    prizesWon: s.prizesWon,
    prizeSol: s.prizeSol,
    mcapSol: s.mcapSol,
    baseDrones: baseDrones(s.mcapSol),
    house: s.house,
    flagship: s.flagship,
    demo: s.demo,
    creator: s.creator,
    mint: s.mint,
    image: s.image,
    createdAt: s.createdAt,
  };
}

export function publicSwarms(db: DB): PublicSwarm[] {
  const terr = territoryOf(db);
  return db.swarms.map((s) => toPublic(s, terr[s.id] ?? 0));
}

export function ranked(swarms: PublicSwarm[]): PublicSwarm[] {
  return [...swarms].sort((a, b) => b.territory - a.territory || b.wins - a.wins || b.mcapSol - a.mcapSol);
}
