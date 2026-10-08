import "server-only";
import { randomBytes } from "node:crypto";
import { WALLET_CAP_PER_BATTLE, dronesForBuy, dronesForSell } from "@/lib/game/drones";
import { BATTLE_MS, roundInfo } from "@/lib/game/schedule";
import type { BattleRecord } from "@/lib/game/types";
import { BATTLE_TICKS, TICK_MS } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { DEMO } from "./config";
import { type DB, appendEvents } from "./store";
import { SETTLE_GRACE_MS, ensureWorld, findBattleIn, phaseOf, round2 } from "./world";

function currentBattleOf(db: DB, swarmId: string, at: number): { b: BattleRecord; side: 0 | 1 } | null {
  const rec = db.rounds[roundInfo(at).index];
  for (const b of rec?.battles ?? []) {
    const side = b.sides.findIndex((s) => s.swarmId === swarmId);
    if (side >= 0 && !b.result && at >= b.startsAt && at < b.endsAt) return { b, side: side as 0 | 1 };
  }
  return null;
}

/** Enforce the per-wallet reinforcement cap for one battle side. */
function capAccept(e: SimEvent, list: SimEvent[]): SimEvent | null {
  if (e.kind === "sell") return e;
  const used = list.filter((x) => x.wallet === e.wallet && x.kind === "buy" && x.side === e.side).reduce((a, x) => a + x.drones, 0);
  const drones = Math.min(e.drones, WALLET_CAP_PER_BATTLE - used);
  return drones > 0 ? { ...e, drones } : null;
}

/** DEMO MODE: inject a simulated trade into a live battle. */
export async function addDemoTrade(
  id: string,
  side: 0 | 1,
  kind: "buy" | "sell",
  sol: number,
  wallet: string,
  now: number,
): Promise<{ ok: true; event: SimEvent } | { ok: false; error: string }> {
  if (!DEMO) return { ok: false, error: "Demo trades are disabled in live mode" };
  const db = await ensureWorld(now);
  const b = findBattleIn(db, id);
  if (!b) return { ok: false, error: "Battle not found" };
  if (phaseOf(b, now) !== "live") return { ok: false, error: "Battle is not live" };
  const tick = Math.floor((now - b.startsAt) / TICK_MS) + 1;
  if (tick >= BATTLE_TICKS) return { ok: false, error: "Battle is ending" };
  const amount = Math.max(0.01, Math.min(100, sol));
  const event: SimEvent = {
    id: `demo${now.toString(36)}${randomBytes(5).toString("hex")}`,
    tick,
    side,
    kind,
    drones: kind === "buy" ? dronesForBuy(amount) : dronesForSell(amount),
    sol: round2(amount),
    wallet,
    ts: now,
  };
  const added = await appendEvents(id, [event], capAccept);
  if (!added.length) return { ok: false, error: `Wallet hit the ${WALLET_CAP_PER_BATTLE}-drone cap for this battle` };
  return { ok: true, event: added[0] };
}

export interface ChainTrade {
  signature: string;
  mint: string;
  wallet: string;
  kind: "buy" | "sell";
  sol: number;
  /** block time (ms) */
  blockTime: number;
}

/**
 * LIVE MODE: turn on-chain trades into drones. Webhook trades land on the tick after arrival;
 * polled trades use their block time. Trades outside a live battle only move the market cap.
 */
export async function ingestTrades(trades: ChainTrade[], now: number, source: "webhook" | "poll"): Promise<number> {
  if (!trades.length) return 0;
  const db = await ensureWorld(now, 2000);
  const byMint = new Map(db.swarms.filter((s) => !s.demo).map((s) => [s.mint, s]));
  const perBattle = new Map<string, SimEvent[]>();
  for (const t of trades) {
    const sw = byMint.get(t.mint);
    if (!sw) continue;
    const at = source === "webhook" ? now : t.blockTime;
    if (source === "poll" && at < now - BATTLE_MS - SETTLE_GRACE_MS) continue;
    const cb = currentBattleOf(db, sw.id, at);
    if (!cb) continue;
    const { b, side } = cb;
    const tick = Math.max(1, Math.floor((at - b.startsAt) / TICK_MS) + (source === "webhook" ? 1 : 0));
    if (tick >= BATTLE_TICKS) continue;
    const sol = round2(Math.max(0, t.sol));
    if (sol < 0.005) continue;
    const drones = t.kind === "buy" ? dronesForBuy(sol) : dronesForSell(sol);
    if (drones <= 0) continue;
    const list = perBattle.get(b.id) ?? [];
    list.push({ id: t.signature, tick, side, kind: t.kind, drones, sol, wallet: t.wallet, ts: t.blockTime || now });
    perBattle.set(b.id, list);
  }
  let n = 0;
  for (const [battleId, events] of perBattle) n += (await appendEvents(battleId, events, capAccept)).length;
  return n;
}

/** Real coins currently fighting (for the polling fallback). */
export async function liveMints(now: number): Promise<{ mint: string; battleId: string; startsAt: number }[]> {
  const db = await ensureWorld(now, 2000);
  const rec = db.rounds[roundInfo(now).index];
  const out: { mint: string; battleId: string; startsAt: number }[] = [];
  for (const b of rec?.battles ?? []) {
    if (b.result || now < b.startsAt || now > b.endsAt + SETTLE_GRACE_MS) continue;
    for (const s of b.sides) {
      const sw = db.swarms.find((x) => x.id === s.swarmId);
      if (sw && !sw.demo) out.push({ mint: sw.mint, battleId: b.id, startsAt: b.startsAt });
    }
  }
  return out;
}

export async function allRealMints(now: number): Promise<string[]> {
  const db = await ensureWorld(now, 2000);
  return db.swarms.filter((s) => !s.demo && s.mint).map((s) => s.mint);
}
