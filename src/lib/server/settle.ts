import "server-only";
import { randomBytes } from "node:crypto";
import { demoMcapDrift } from "@/lib/game/demo";
import { HOUR_MS, ROUND_MS, seasonAt } from "@/lib/game/schedule";
import type { BattleRecord, HistoryEntry, HistorySide, Payout, PrizeRecord, RoundRecord, Swarm } from "@/lib/game/types";
import { BATTLE_TICKS, type BattleResultData, BattleSim } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { DEMO, config } from "./config";
import { kvGet, kvLease, kvPrune, kvRelease, kvSet, kvUpdate } from "./kv";
import { type Market, fetchMarkets } from "./market";
import { surgeActivity, surgeBonus } from "./surge";
import {
  type DB,
  HISTORY,
  type HistoryDoc,
  type HourBuysDoc,
  PAYOUTS,
  PRIZES,
  type PayoutsDoc,
  type PendingPrize,
  type PrizesDoc,
  type WalletsDoc,
  battleKey,
  hourBuysKey,
  mutateWorld,
  readEvents,
  readWorld,
  walletsKey,
} from "./store";
import { READ_CACHE_MS, advanceRounds, battleEvents, dueRounds, findBattleIn, homeSet, round2, round6, setKicker, simInputOf, territoryOf } from "./world";

const HISTORY_CAP = 600;
const PRIZES_CAP = 500;
const MAX_ROLLOVER_HOURS = 12;

export interface BattleArchive {
  battle: BattleRecord;
  events: SimEvent[];
}

// ------------------------------------------------------------------ results
function applyResult(db: DB, b: BattleRecord, result: BattleResultData, checksum: number, events: SimEvent[], now: number): void {
  const w = result.winner;
  const winner = db.swarms.find((s) => s.id === b.sides[w].swarmId);
  const loser = db.swarms.find((s) => s.id === b.sides[1 - w].swarmId);
  let captured = b.prizeHex[w];
  if (captured >= 0 && homeSet(db).has(captured) && db.owners[captured] !== winner?.id) captured = -1;
  if (captured >= 0 && winner) db.owners[captured] = winner.id;
  if (winner) {
    winner.wins++;
    winner.allWins++;
  }
  if (loser) {
    loser.losses++;
    loser.allLosses++;
  }
  // demo coins: market caps drift with net flows
  for (let s = 0; s < 2; s++) {
    const sw = db.swarms.find((x) => x.id === b.sides[s].swarmId);
    if (!sw || !sw.demo) continue;
    const net = events.filter((e) => e.side === s).reduce((acc, e) => acc + (e.kind === "buy" ? e.sol : -e.sol), 0);
    sw.mcapSol = demoMcapDrift(sw.mcapSol, net, b.seed + s);
  }
  b.result = {
    winner: w,
    alive: result.alive,
    hp: result.hp,
    stats: result.stats,
    capturedHex: captured,
    settledAt: now,
    eventCount: events.length,
    checksum,
  };
}

/** Mark a round settled; if it closes an hour, snapshot territory for the prize. */
function closeRound(db: DB, rec: RoundRecord, now: number): void {
  rec.settled = true;
  db.lastSettledRound = Math.max(db.lastSettledRound, rec.index);
  const endsAt = rec.index * ROUND_MS + ROUND_MS;
  if (endsAt % HOUR_MS === 0) {
    const hour = endsAt / HOUR_MS - 1;
    if (hour > db.lastPrizeHour && !db.pendingPrizes.some((p) => p.hour === hour)) {
      const wins: Record<string, number> = {};
      for (const s of db.swarms) wins[s.id] = s.wins;
      db.pendingPrizes.push({ hour, endsAt, territory: territoryOf(db), wins });
    }
  }
  advanceRounds(db, now);
}

function historyOf(b: BattleRecord, events: SimEvent[]): HistoryEntry {
  const r = b.result;
  if (!r) throw new Error("battle not settled");
  const sides = [0, 1].map((s) => {
    const mine = events.filter((e) => e.side === s);
    const side: HistorySide = {
      swarmId: b.sides[s].swarmId,
      ticker: b.sides[s].ticker,
      name: b.sides[s].name,
      color: b.sides[s].color,
      base: b.sides[s].baseDrones,
      reinforcements: mine.filter((e) => e.kind === "buy").reduce((a, e) => a + e.drones, 0),
      sold: mine.filter((e) => e.kind === "sell").reduce((a, e) => a + e.drones, 0),
      alive: r.alive[s],
      kills: r.stats[s].kills,
      tacticsHash: b.sides[s].tacticsHash,
    };
    return side;
  }) as [HistorySide, HistorySide];
  return {
    id: b.id,
    round: b.round,
    startsAt: b.startsAt,
    seed: b.seed,
    sides,
    winner: r.winner,
    capturedHex: r.capturedHex,
    checksum: r.checksum,
    eventCount: r.eventCount,
    settledAt: r.settledAt,
  };
}

/** Archive + ledgers for a freshly settled battle. Every write is idempotent per battle id. */
async function recordSettled(season: number, b: BattleRecord, events: SimEvent[]): Promise<void> {
  const entry = historyOf(b, events);
  await kvSet<BattleArchive>(battleKey(b.id), { battle: b, events });
  await kvUpdate<HistoryDoc>(
    HISTORY,
    () => ({ entries: [] }),
    (doc) => {
      if (doc.entries.some((e) => e.id === b.id)) return false;
      doc.entries.unshift(entry);
      doc.entries.sort((x, y) => y.startsAt - x.startsAt || (x.id < y.id ? 1 : -1));
      if (doc.entries.length > HISTORY_CAP) doc.entries.length = HISTORY_CAP;
    },
  );
  if (!events.length) return;
  await kvUpdate<WalletsDoc>(
    walletsKey(season),
    () => ({ battles: [], stats: {} }),
    (doc) => {
      if (doc.battles.includes(b.id)) return false;
      doc.battles.push(b.id);
      if (doc.battles.length > 800) doc.battles.splice(0, doc.battles.length - 800);
      for (const e of events) {
        doc.stats[e.wallet] ??= { wallet: e.wallet, drones: 0, sold: 0, sol: 0, buys: 0, sells: 0, swarms: [], lastTs: 0 };
        const st = doc.stats[e.wallet];
        const sid = b.sides[e.side].swarmId;
        if (e.kind === "buy") {
          st.drones += e.drones;
          st.buys++;
        } else {
          st.sold += e.drones;
          st.sells++;
        }
        st.sol = round2(st.sol + e.sol);
        if (!st.swarms.includes(sid)) st.swarms.push(sid);
        st.lastTs = Math.max(st.lastTs, e.ts);
      }
    },
  );
  const hour = Math.floor(b.startsAt / HOUR_MS);
  await kvUpdate<HourBuysDoc>(
    hourBuysKey(hour),
    () => ({ battles: [], buys: {} }),
    (doc) => {
      if (doc.battles.includes(b.id)) return false;
      doc.battles.push(b.id);
      for (const e of events) {
        if (e.kind !== "buy") continue;
        const sid = b.sides[e.side].swarmId;
        doc.buys[sid] ??= {};
        doc.buys[sid][e.wallet] = (doc.buys[sid][e.wallet] ?? 0) + e.drones;
      }
    },
  );
}

const yieldNow = () => new Promise<void>((r) => setImmediate(r));
const SLICE_TICKS = 120;

async function runSim(input: ReturnType<typeof simInputOf>, events: SimEvent[]): Promise<{ result: BattleResultData; checksum: number }> {
  const sim = new BattleSim(input);
  let p = 0;
  const batch: SimEvent[] = [];
  while (sim.tick < BATTLE_TICKS) {
    const until = Math.min(BATTLE_TICKS, sim.tick + SLICE_TICKS);
    while (sim.tick < until) {
      batch.length = 0;
      while (p < events.length && events[p].tick <= sim.tick) {
        if (events[p].tick === sim.tick) batch.push(events[p]);
        p++;
      }
      sim.step(batch);
    }
    await yieldNow();
  }
  return { result: sim.result(), checksum: sim.checksum() };
}

/**
 * Settle everything that is due within a time budget. One settler at a time across instances
 * (kv lease). Call again while `more` is true.
 */
export async function settleDue(budgetMs = 8000): Promise<{ settled: string[]; prizes: number[]; more: boolean; skipped?: boolean }> {
  const t0 = Date.now();
  const owner = randomBytes(6).toString("hex");
  if (!(await kvLease("settler", budgetMs + 30_000, owner))) return { settled: [], prizes: [], more: true, skipped: true };
  const settled: string[] = [];
  let prizes: number[] = [];
  let more = false;
  try {
    await refreshMarketsIfStale(Date.now()).catch((e) => console.warn("[legion] market refresh failed", e));
    for (let guard = 0; guard < 80; guard++) {
      const now = Date.now();
      const season = seasonAt(now);
      const db = await readWorld(season, 0);
      const due = dueRounds(db, now);
      if (!due.length) break;
      const rec = due[0];
      const b = rec.battles.find((x) => !x.result);
      if (!b) {
        await mutateWorld(season, (d) => {
          const r = d.rounds[rec.index];
          if (!r || r.settled || r.battles.some((x) => !x.result)) return false;
          closeRound(d, r, now);
          return true;
        });
        continue;
      }
      if (Date.now() - t0 > budgetMs) {
        more = true;
        break;
      }
      const stored = await readEvents(b.id, 0);
      const events = battleEvents(b, stored).filter((e) => e.tick >= 0 && e.tick < BATTLE_TICKS);
      const s0 = performance.now();
      const { result, checksum } = await runSim(simInputOf(b), events);
      const { result: applied } = await mutateWorld<BattleRecord>(season, (d) => {
        const x = findBattleIn(d, b.id);
        if (!x || x.result) return false;
        applyResult(d, x, result, checksum, events, Date.now());
        const r = d.rounds[x.round];
        if (r?.battles.every((y) => y.result)) closeRound(d, r, Date.now());
        return structuredClone(x);
      });
      if (applied) {
        await recordSettled(season, applied, events).catch((e) => console.error("[legion] record failed", e));
        settled.push(b.id);
        console.log(`[legion] settled ${b.id} in ${(performance.now() - s0).toFixed(0)}ms -> side ${result.winner} (${result.alive.join(" vs ")})`);
      }
    }
    prizes = await processPrizes();
  } finally {
    await kvRelease("settler", owner);
  }
  return { settled, prizes, more };
}

// in-process background settler for long-lived servers (dev / VPS)
const gs = globalThis as unknown as { __legionSettler?: Promise<void> };

export function kickSettler(): Promise<void> {
  if (!gs.__legionSettler) {
    gs.__legionSettler = (async () => {
      for (let i = 0; i < 20; i++) {
        const r = await settleDue(20_000);
        if (!r.more || r.skipped) break;
      }
    })()
      .catch((e) => console.error("[legion] settler failed", e))
      .finally(() => {
        gs.__legionSettler = undefined;
      });
  }
  return gs.__legionSettler;
}
setKicker(kickSettler);

// ------------------------------------------------------------------ markets (live coins)
async function refreshMarketsIfStale(now: number): Promise<void> {
  if (DEMO) return;
  const season = seasonAt(now);
  const db = await readWorld(season, READ_CACHE_MS);
  if (now - db.marketAt < 60_000) return;
  const mints = db.swarms.filter((s) => !s.demo && s.mint).map((s) => s.mint);
  const caps = mints.length ? await fetchMarkets(mints).catch(() => new Map<string, Market>()) : new Map<string, Market>();
  await mutateWorld(season, (d) => {
    for (const s of d.swarms) {
      const c = caps.get(s.mint);
      if (!s.demo && c && Number.isFinite(c.mcapSol) && c.mcapSol > 0) s.mcapSol = Math.round(c.mcapSol * 10) / 10;
    }
    d.marketAt = now;
    return true;
  });
}

// ------------------------------------------------------------------ prizes
function decideLeader(p: PendingPrize, swarms: Swarm[]): Swarm | null {
  let best: Swarm | null = null;
  for (const s of swarms) {
    const t = p.territory[s.id] ?? 0;
    if (t <= 0) continue;
    if (!best) {
      best = s;
      continue;
    }
    const bt = p.territory[best.id] ?? 0;
    const sw = p.wins[s.id] ?? 0;
    const bw = p.wins[best.id] ?? 0;
    if (t > bt || (t === bt && (sw > bw || (sw === bw && s.mcapSol > best.mcapSol)))) best = s;
  }
  return best;
}

export function isRealWallet(w: string): boolean {
  return w.length >= 32 && w.length <= 44 && w !== "HOUSE" && !w.startsWith("DEMo");
}

async function processPrizes(): Promise<number[]> {
  const done: number[] = [];
  for (let guard = 0; guard < 6; guard++) {
    const now = Date.now();
    const season = seasonAt(now);
    const db = await readWorld(season, 0);
    const p = [...db.pendingPrizes].sort((a, b) => a.hour - b.hour)[0];
    if (!p) break;
    const leader = decideLeader(p, db.swarms);
    const buysDoc = await kvGet<HourBuysDoc>(hourBuysKey(p.hour), 0);
    const activity = surgeActivity(db.swarms, p.hour, buysDoc);
    // the surge bonus only exists when someone can win it, and it never rolls over
    const bonus = leader ? surgeBonus(activity, p.hour) : 0;
    const pool = round6(config.hourlyPrizeSol + db.rollover + bonus);
    const demoPrize = DEMO || !!leader?.demo;
    const payouts: Payout[] = [];
    let unpaid = pool;
    let reinforcers = 0;
    if (leader && pool > 0) {
      const creatorShare = round6(pool * config.prizeCreatorShare);
      const reinforcerShare = round6(pool - creatorShare);
      if (isRealWallet(leader.creator) || (DEMO && leader.creator.startsWith("DEMo"))) {
        payouts.push({
          id: `${p.hour}:${leader.id}:creator:${leader.creator}`,
          hour: p.hour,
          swarmId: leader.id,
          ticker: leader.ticker,
          wallet: leader.creator,
          role: "creator",
          drones: 0,
          sol: creatorShare,
          status: demoPrize ? "demo" : "pending",
          createdAt: now,
        });
        unpaid -= creatorShare;
      }
      const buys = buysDoc?.buys[leader.id] ?? {};
      const total = Object.values(buys).reduce((a, n) => a + n, 0);
      if (total > 0) {
        for (const [wallet, drones] of Object.entries(buys)) {
          const sol = Math.floor(((reinforcerShare * drones) / total) * 1e6) / 1e6;
          if (sol < 0.0005) continue;
          if (!demoPrize && !isRealWallet(wallet)) continue;
          payouts.push({
            id: `${p.hour}:${leader.id}:reinforcer:${wallet}`,
            hour: p.hour,
            swarmId: leader.id,
            ticker: leader.ticker,
            wallet,
            role: "reinforcer",
            drones,
            sol,
            status: demoPrize ? "demo" : "pending",
            createdAt: now,
          });
          unpaid -= sol;
          reinforcers++;
        }
      }
    }
    const paid = round6(pool - unpaid);
    const newRollover = Math.min(round6(Math.max(0, unpaid - bonus)), config.hourlyPrizeSol * MAX_ROLLOVER_HOURS);
    const record: PrizeRecord = {
      hour: p.hour,
      endsAt: p.endsAt,
      swarmId: leader?.id ?? null,
      ticker: leader?.ticker ?? "",
      name: leader?.name ?? "No holder",
      color: leader?.color ?? "#888888",
      territory: leader ? (p.territory[leader.id] ?? 0) : 0,
      amountSol: paid,
      rolledOver: paid <= 0,
      payouts: payouts.length,
      reinforcers,
      demo: demoPrize,
      bonusSol: paid > 0 ? bonus : 0,
      launches: activity.launches,
      buyers: activity.buyers,
    };
    await kvUpdate<PrizesDoc>(
      PRIZES,
      () => ({ records: [] }),
      (doc) => {
        if (doc.records.some((r) => r.hour === p.hour)) return false;
        doc.records.unshift(record);
        doc.records.sort((a, b) => b.hour - a.hour);
        if (doc.records.length > PRIZES_CAP) doc.records.length = PRIZES_CAP;
      },
    );
    if (payouts.length) {
      await kvUpdate<PayoutsDoc>(
        PAYOUTS,
        () => ({ payouts: [] }),
        (doc) => {
          const ids = new Set(doc.payouts.map((x) => x.id));
          const fresh = payouts.filter((x) => !ids.has(x.id));
          if (!fresh.length) return false;
          doc.payouts.unshift(...fresh);
          const pending = doc.payouts.filter((x) => x.status === "pending");
          const rest = doc.payouts.filter((x) => x.status !== "pending").slice(0, 3000);
          doc.payouts = [...pending, ...rest].sort((a, b) => b.createdAt - a.createdAt);
        },
      );
    }
    await mutateWorld(season, (d) => {
      const idx = d.pendingPrizes.findIndex((x) => x.hour === p.hour);
      if (idx < 0) return false;
      d.pendingPrizes.splice(idx, 1);
      d.lastPrizeHour = Math.max(d.lastPrizeHour, p.hour);
      d.rollover = newRollover;
      const w = leader ? d.swarms.find((s) => s.id === leader.id) : null;
      if (w && paid > 0) {
        w.prizesWon++;
        w.prizeSol = round6(w.prizeSol + paid);
      }
      return true;
    });
    done.push(p.hour);
    console.log(`[legion] prize hour ${p.hour}: ${leader?.ticker ?? "none"} paid ${paid} SOL (surge ${bonus}: ${activity.launches} launches, ${activity.buyers} buyers), rollover ${newRollover}`);
    const cutoff = now - 3 * 24 * HOUR_MS;
    await Promise.all([kvPrune("ev:", cutoff), kvPrune("hourbuys:", cutoff), kvPrune("battle:", now - 10 * 24 * HOUR_MS), kvPrune("launch:", now - HOUR_MS)]).catch(() => {});
  }
  return done;
}
