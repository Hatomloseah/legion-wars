import "server-only";
import { HEXES } from "@/lib/game/hexmap";
import { FLAGSHIP_ID } from "@/lib/game/house";
import { HOUR_MS, hourEndsAt, roundInfo, seasonAt, seasonEndsAt } from "@/lib/game/schedule";
import type {
  AdminData,
  BattleDetail,
  BattleProof,
  BattleRecord,
  BattleSummary,
  FeedEvent,
  GameState,
  HistoryEntry,
  LeaderboardData,
  Payout,
  PrizeRecord,
  ProofIndex,
  PublicSwarm,
  RoundRecord,
  SessionInfo,
  SwarmDetail,
} from "@/lib/game/types";
import { BATTLE_TICKS, CAP, TICK_MS } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { DEMO, config, envStatus } from "./config";
import { kvBackendName, kvGet, kvGetMany, kvUpdate } from "./kv";
import "./settle"; // registers the background settler
import type { BattleArchive } from "./settle";
import {
  HISTORY,
  type HistoryDoc,
  type HourBuysDoc,
  PAYOUTS,
  PRIZES,
  type PayoutsDoc,
  type PrizesDoc,
  type WalletsDoc,
  battleKey,
  evKey,
  hourBuysKey,
  readEvents,
  readWorld,
  walletsKey,
} from "./store";
import { surgeActivity, surgePotential } from "./surge";
import {
  READ_CACHE_MS,
  battleEvents,
  ensureWorld,
  findBattleIn,
  phaseOf,
  publicSwarms,
  ranked,
  round2,
  round6,
  territoryOf,
  toPublic,
} from "./world";

function visibleOf(b: BattleRecord, all: SimEvent[], now: number): SimEvent[] {
  const ph = phaseOf(b, now);
  if (ph === "upcoming") return [];
  if (ph === "ended") return all;
  const limit = Math.floor((now - b.startsAt) / TICK_MS);
  return all.filter((e) => e.tick <= limit);
}

async function eventsFor(battles: BattleRecord[], maxAgeMs: number): Promise<Map<string, SimEvent[]>> {
  const got = await kvGetMany<SimEvent[]>(
    battles.map((b) => evKey(b.id)),
    maxAgeMs,
  );
  const out = new Map<string, SimEvent[]>();
  for (const b of battles) out.set(b.id, battleEvents(b, got.get(evKey(b.id)) ?? []));
  return out;
}

function summarize(b: BattleRecord, evs: SimEvent[], now: number): BattleSummary {
  const sum = (s: number, k: "buy" | "sell") => evs.filter((e) => e.side === s && e.kind === k).reduce((a, e) => a + e.drones, 0);
  const sides = [0, 1].map((s) => ({
    swarmId: b.sides[s].swarmId,
    name: b.sides[s].name,
    ticker: b.sides[s].ticker,
    color: b.sides[s].color,
    baseDrones: b.sides[s].baseDrones,
    reinforcements: sum(s, "buy"),
    sold: sum(s, "sell"),
  })) as BattleSummary["sides"];
  return {
    id: b.id,
    round: b.round,
    phase: phaseOf(b, now),
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    sides,
    prizeHex: b.prizeHex,
    heat: sides[0].baseDrones + sides[1].baseDrones + sides[0].reinforcements + sides[1].reinforcements,
    result: b.result ? { winner: b.result.winner, alive: b.result.alive, capturedHex: b.result.capturedHex } : undefined,
  };
}

/** Settled battles carry their own spawn/sell totals, no event read needed. */
function summarizeSettled(b: BattleRecord, now: number): BattleSummary {
  const s = summarize(b, [], now);
  const st = b.result?.stats;
  if (st) {
    for (const i of [0, 1] as const) {
      s.sides[i].reinforcements = st[i].spawned;
      s.sides[i].sold = st[i].sold;
    }
    s.heat = s.sides[0].baseDrones + s.sides[1].baseDrones + st[0].spawned + st[1].spawned;
  }
  return s;
}

async function history(maxAgeMs = 5000): Promise<HistoryEntry[]> {
  return (await kvGet<HistoryDoc>(HISTORY, maxAgeMs))?.entries ?? [];
}

async function prizes(maxAgeMs = 5000): Promise<PrizeRecord[]> {
  return (await kvGet<PrizesDoc>(PRIZES, maxAgeMs))?.records ?? [];
}

export async function getState(now: number): Promise<GameState> {
  const db = await ensureWorld(now);
  const info = roundInfo(now);
  const cur = db.rounds[info.index];
  const prev = db.rounds[info.index - 1];
  const next = db.rounds[info.index + 1];
  const curBattles = cur?.battles ?? [];
  const evMap = await eventsFor(curBattles, READ_CACHE_MS);
  const battles = curBattles.map((b) => summarize(b, visibleOf(b, evMap.get(b.id) ?? [], now), now));
  const lastBattles = (prev?.battles ?? []).map((b) => (b.result ? summarizeSettled(b, now) : summarize(b, [], now)));
  const nextBattles = (next?.battles ?? []).map((b) => summarize(b, [], now));

  // featured: biggest live battle; during the break, the biggest finished one (replay)
  let featuredId: string | null = null;
  const pool = info.phase === "battle" ? battles : battles.filter((b) => b.result);
  const fallback = pool.length ? pool : lastBattles.filter((b) => b.result);
  if (fallback.length) featuredId = [...fallback].sort((a, b) => b.heat - a.heat)[0].id;

  const feed: FeedEvent[] = [];
  for (const b of curBattles) {
    for (const e of visibleOf(b, evMap.get(b.id) ?? [], now)) {
      feed.push({ ...e, battleId: b.id, swarmId: b.sides[e.side].swarmId, ticker: b.sides[e.side].ticker, color: b.sides[e.side].color });
    }
  }
  feed.sort((a, b) => b.ts - a.ts);

  const swarms = publicSwarms(db);
  const leader = ranked(swarms)[0];
  const curHour = Math.floor(now / HOUR_MS);
  const [prizeDoc, buysDoc] = await Promise.all([kvGet<PrizesDoc>(PRIZES, 5000), kvGet<HourBuysDoc>(hourBuysKey(curHour), 5000)]);
  const last = prizeDoc?.records[0] ?? null;
  const activity = surgeActivity(db.swarms, curHour, buysDoc);

  return {
    now,
    demo: DEMO,
    season: db.season,
    seasonEndsAt: seasonEndsAt(now),
    round: info,
    swarms,
    owners: HEXES.map((h) => db.owners[h.id] ?? ""),
    battles,
    lastBattles,
    nextBattles,
    featuredId,
    flagshipId: db.swarms.some((s) => s.id === FLAGSHIP_ID) ? FLAGSHIP_ID : null,
    feed: feed.slice(0, 40),
    prize: {
      hourlySol: config.hourlyPrizeSol,
      poolSol: round6(config.hourlyPrizeSol + db.rollover),
      leaderId: leader?.id ?? null,
      hourEndsAt: hourEndsAt(now),
      rollover: db.rollover,
      last,
      surge: { ...activity, potentialSol: surgePotential(activity), maxSol: config.prizeSurgeMaxSol },
    },
  };
}

export async function getArchive(id: string): Promise<BattleArchive | null> {
  return kvGet<BattleArchive>(battleKey(id), 60_000);
}

export async function getBattle(id: string, now: number): Promise<BattleDetail | null> {
  if (!/^\d+-\d+$/.test(id)) return null;
  const db = await ensureWorld(now);
  const b = findBattleIn(db, id);
  if (b) {
    const evs = battleEvents(b, await readEvents(id, 700));
    return { now, demo: DEMO, phase: phaseOf(b, now), battle: b, events: visibleOf(b, evs, now) };
  }
  const arc = await getArchive(id);
  if (!arc) return null;
  return { now, demo: DEMO, phase: "ended", battle: arc.battle, events: arc.events };
}

export async function getSwarmDetail(id: string, now: number): Promise<SwarmDetail | null> {
  const db = await ensureWorld(now);
  const swarms = publicSwarms(db);
  const sw = swarms.find((s) => s.id === id || s.ticker.toLowerCase() === id.toLowerCase());
  if (!sw) return null;
  const rank = ranked(swarms).findIndex((s) => s.id === sw.id) + 1;
  const hexes = Object.entries(db.owners)
    .filter(([, v]) => v === sw.id)
    .map(([k]) => Number(k));
  const info = roundInfo(now);
  const find = (rec?: RoundRecord) => rec?.battles.find((b) => b.sides.some((s) => s.swarmId === sw.id)) ?? null;
  const curB = find(db.rounds[info.index]);
  const nextB = find(db.rounds[info.index + 1]);
  let current: BattleSummary | null = null;
  if (curB) {
    const evs = (await eventsFor([curB], READ_CACHE_MS)).get(curB.id) ?? [];
    current = curB.result ? summarizeSettled(curB, now) : summarize(curB, visibleOf(curB, evs, now), now);
  }
  const [hist, prz] = await Promise.all([history(), prizes()]);
  return {
    now,
    demo: DEMO,
    swarm: sw,
    rank,
    hexes,
    owners: HEXES.map((h) => db.owners[h.id] ?? ""),
    swarms,
    history: hist.filter((h) => h.sides.some((s) => s.swarmId === sw.id)).slice(0, 40),
    prizes: prz.filter((p) => p.swarmId === sw.id).slice(0, 30),
    current,
    next: nextB ? summarize(nextB, [], now) : null,
  };
}

export async function getLeaderboard(now: number): Promise<LeaderboardData> {
  const db = await ensureWorld(now);
  const [hist, prz, wallets] = await Promise.all([history(), prizes(), kvGet<WalletsDoc>(walletsKey(db.season), 5000)]);
  const stats = Object.values(wallets?.stats ?? {});
  const seasonStart = seasonEndsAt(now) - 7 * 24 * HOUR_MS;
  const seasonHist = hist.filter((h) => h.startsAt >= seasonStart);
  return {
    now,
    demo: DEMO,
    season: db.season,
    seasonEndsAt: seasonEndsAt(now),
    swarms: ranked(publicSwarms(db)),
    wallets: stats.sort((a, b) => b.drones - a.drones || b.sol - a.sol).slice(0, 50),
    prizes: prz.slice(0, 48),
    rollover: db.rollover,
    hourlySol: config.hourlyPrizeSol,
    totals: {
      battles: seasonHist.length,
      drones: seasonHist.reduce((a, h) => a + h.sides[0].reinforcements + h.sides[1].reinforcements, 0),
      sol: round2(stats.reduce((a, w) => a + w.sol, 0)),
    },
  };
}

export async function getProofIndex(now: number): Promise<ProofIndex> {
  return {
    now,
    demo: DEMO,
    engine: { tickMs: TICK_MS, ticks: BATTLE_TICKS, cap: CAP, fixedPoint: "Q10 (1/1024)", prng: "mulberry32", trig: "1024-entry integer LUT" },
    battles: (await history()).slice(0, 120),
  };
}

export async function getProof(id: string, now: number): Promise<BattleProof | null> {
  if (!/^\d+-\d+$/.test(id)) return null;
  const arc = await getArchive(id);
  let battle: BattleRecord | null = arc?.battle ?? null;
  let events: SimEvent[] = arc?.events ?? [];
  const db = await ensureWorld(now);
  if (!battle) {
    const b = findBattleIn(db, id);
    if (!b?.result) return null;
    battle = b;
    events = battleEvents(b, await readEvents(id, 0)).filter((e) => e.tick >= 0 && e.tick < BATTLE_TICKS);
  }
  const tactics = battle.sides.map((s) => db.swarms.find((x) => x.id === s.swarmId)?.tactics ?? "") as [string, string];
  return { battle, events, tactics };
}

export async function getSessionSwarms(wallet: string, now: number): Promise<SessionInfo["swarms"]> {
  const db = await ensureWorld(now);
  return db.swarms.filter((s) => s.creator === wallet).map((s) => ({ id: s.id, name: s.name, ticker: s.ticker, color: s.color }));
}

export async function flagshipPublic(now: number): Promise<PublicSwarm | null> {
  const db = await ensureWorld(now);
  const f = db.swarms.find((s) => s.id === FLAGSHIP_ID);
  return f ? toPublic(f, territoryOf(db)[f.id] ?? 0) : null;
}

// ------------------------------------------------------------------ admin
export async function getAdminData(wallet: string, now: number): Promise<AdminData> {
  const db = await readWorld(seasonAt(now), READ_CACHE_MS);
  const [payDoc, prz] = await Promise.all([kvGet<PayoutsDoc>(PAYOUTS, 0), prizes(0)]);
  const payouts = payDoc?.payouts ?? [];
  const pending = payouts.filter((p) => p.status === "pending");
  const env = envStatus();
  return {
    now,
    demo: DEMO,
    wallet,
    treasury: config.treasuryWallet,
    status: {
      demo: env.demo,
      serverless: env.serverless,
      storage: kvBackendName(),
      keys: env.keys,
      tacticsModel: env.tacticsModel,
      launchFeeSol: env.launchFeeSol,
      hourlySol: env.hourlyPrizeSol,
      prizeCreatorShare: env.prizeCreatorShare,
      legionMint: env.legionMint,
    },
    payouts: payouts.slice(0, 400),
    totals: {
      pendingSol: round6(pending.reduce((a, p) => a + p.sol, 0)),
      paidSol: round6(payouts.filter((p) => p.status === "paid").reduce((a, p) => a + p.sol, 0)),
      pendingCount: pending.length,
    },
    prizes: prz.slice(0, 48),
    rollover: db.rollover,
  };
}

export async function pendingPayouts(ids: string[]): Promise<Payout[]> {
  const doc = await kvGet<PayoutsDoc>(PAYOUTS, 0);
  const want = new Set(ids);
  return (doc?.payouts ?? []).filter((p) => want.has(p.id) && p.status === "pending");
}

export async function markPayouts(ids: string[], status: "paid" | "void", txSig: string | undefined, now: number): Promise<number> {
  let n = 0;
  const want = new Set(ids);
  await kvUpdate<PayoutsDoc>(
    PAYOUTS,
    () => ({ payouts: [] }),
    (doc) => {
      n = 0;
      for (const p of doc.payouts) {
        if (!want.has(p.id) || p.status !== "pending") continue;
        p.status = status;
        if (txSig) p.txSig = txSig;
        p.paidAt = now;
        n++;
      }
      if (!n) return false;
    },
  );
  return n;
}
