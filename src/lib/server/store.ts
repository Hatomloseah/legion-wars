import "server-only";
import type { HistoryEntry, Payout, PrizeRecord, RoundRecord, Swarm, WalletStat } from "@/lib/game/types";
import type { SimEvent } from "@/lib/sim/types";
import { kvGet, kvUpdate } from "./kv";

/**
 * World document: legions, territory, the last few rounds and prize bookkeeping.
 * Trade events live in per-battle keys (`ev:<battleId>`) so webhook writes never contend
 * with world updates. Every mutation is a compare-and-swap, safe across serverless instances.
 */
export interface PendingPrize {
  hour: number;
  endsAt: number;
  /** territory per legion at the moment the hour's last round settled */
  territory: Record<string, number>;
  wins: Record<string, number>;
}

export interface DB {
  version: 2;
  season: number;
  swarms: Swarm[];
  /** hex index -> owner swarm id */
  owners: Record<string, string>;
  /** round index -> round (recent rounds only, settled battles are archived) */
  rounds: Record<string, RoundRecord>;
  lastSettledRound: number;
  /** last hour index whose prize has been decided */
  lastPrizeHour: number;
  pendingPrizes: PendingPrize[];
  /** SOL carried into the next hourly prize */
  rollover: number;
  /** last market cap refresh (ms) */
  marketAt: number;
  updatedAt: number;
}

const WORLD = "world";

function emptyDB(season: number): DB {
  return {
    version: 2,
    season,
    swarms: [],
    owners: {},
    rounds: {},
    lastSettledRound: -1,
    lastPrizeHour: -1,
    pendingPrizes: [],
    rollover: 0,
    marketAt: 0,
    updatedAt: 0,
  };
}

/** Fill fields added after a legion was stored, so older records keep working. */
function normalizeSwarm(s: Partial<Swarm> & Pick<Swarm, "id">): Swarm {
  return {
    description: "",
    configSource: s.house ? "house" : "heuristic",
    allWins: s.wins ?? 0,
    allLosses: s.losses ?? 0,
    prizesWon: 0,
    prizeSol: 0,
    ...s,
  } as Swarm;
}

/** In-place upgrade of any stored shape to v2 (idempotent). */
function normalize(raw: unknown, season: number): DB {
  if (!raw || typeof raw !== "object") return emptyDB(season);
  const db = raw as DB & { events?: unknown };
  if (db.version !== 2) {
    const base = emptyDB(db.season ?? season);
    for (const k of Object.keys(base) as (keyof DB)[]) {
      if ((db as unknown as Record<string, unknown>)[k] === undefined) (db as unknown as Record<string, unknown>)[k] = base[k];
    }
    db.events = undefined;
    db.version = 2;
  }
  db.swarms = (db.swarms ?? []).map(normalizeSwarm);
  db.pendingPrizes ??= [];
  return db;
}

/** Read the world (possibly from this instance's cache, up to `maxAgeMs` old). Treat as read-only. */
export async function readWorld(season: number, maxAgeMs = 0): Promise<DB> {
  return normalize(await kvGet<DB>(WORLD, maxAgeMs), season);
}

/**
 * Atomic world mutation. `fn` gets a private copy; return `false` to skip writing.
 * Re-runs `fn` on concurrent modification, so it must be a pure function of the doc.
 */
export async function mutateWorld<T>(season: number, fn: (db: DB) => T | false): Promise<{ db: DB; result: T | false }> {
  let result: T | false = false;
  const out = await kvUpdate<DB>(
    WORLD,
    () => emptyDB(season),
    (doc) => {
      normalize(doc, season);
      result = fn(doc);
      if (result === false) return false;
      doc.updatedAt = Date.now();
    },
    12,
  );
  return { db: normalize(out, season), result };
}

// ------------------------------------------------------------------ battle events
export const evKey = (battleId: string) => `ev:${battleId}`;

export async function readEvents(battleId: string, maxAgeMs = 0): Promise<SimEvent[]> {
  return (await kvGet<SimEvent[]>(evKey(battleId), maxAgeMs)) ?? [];
}

/** Append events (deduped by id). `accept` can veto an event given the current list (wallet caps etc). */
export async function appendEvents(battleId: string, incoming: SimEvent[], accept?: (e: SimEvent, list: SimEvent[]) => SimEvent | null): Promise<SimEvent[]> {
  const added: SimEvent[] = [];
  await kvUpdate<SimEvent[]>(
    evKey(battleId),
    () => [],
    (list) => {
      added.length = 0;
      const ids = new Set(list.map((e) => e.id));
      for (const e of incoming) {
        if (ids.has(e.id)) continue;
        const ok = accept ? accept(e, list) : e;
        if (!ok) continue;
        list.push(ok);
        ids.add(ok.id);
        added.push(ok);
      }
      if (!added.length) return false;
    },
  );
  return added;
}

// ------------------------------------------------------------------ archives + ledgers
export const battleKey = (id: string) => `battle:${id}`;
export const HISTORY = "hist";
export const PRIZES = "prizes";
export const PAYOUTS = "payouts";
export const walletsKey = (season: number) => `wallets:${season}`;
export const hourBuysKey = (hour: number) => `hourbuys:${hour}`;

export interface HistoryDoc {
  entries: HistoryEntry[];
}
export interface PrizesDoc {
  records: PrizeRecord[];
}
export interface PayoutsDoc {
  payouts: Payout[];
}
export interface WalletsDoc {
  battles: string[];
  stats: Record<string, WalletStat>;
}
export interface HourBuysDoc {
  battles: string[];
  /** swarmId -> wallet -> drones bought */
  buys: Record<string, Record<string, number>>;
}
