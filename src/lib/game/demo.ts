import { Rng, hashString } from "@/lib/sim/fixed";
import { BATTLE_TICKS, TICK_MS } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { WALLET_CAP_PER_BATTLE, dronesForBuy, dronesForSell } from "./drones";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function fakeBase58(rng: Rng, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += B58[rng.int(B58.length)];
  return s;
}

const cache = new Map<string, SimEvent[]>();

/**
 * DEMO MODE trade generator. Fully deterministic from the battle seed, so every
 * server instance and every client sees the same fake buys/sells without shared state.
 * The API only reveals events whose tick has already passed.
 */
export function demoEvents(battleId: string, seed: number, startsAt: number): SimEvent[] {
  const hit = cache.get(battleId);
  if (hit) return hit;
  const rng = new Rng(seed ^ hashString(`demo:${battleId}`));
  const out: SimEvent[] = [];

  for (let side = 0 as 0 | 1; side < 2; side = (side + 1) as 0 | 1) {
    const momentum = 0.55 + rng.float() * 1.2;
    const wallets: string[] = [];
    const nWallets = 10 + rng.int(12);
    for (let w = 0; w < nWallets; w++) wallets.push(fakeBase58(rng, 44));
    const used = new Map<string, number>();

    const surgeStart = 300 + rng.int(1200);
    const nBuys = Math.round((12 + rng.int(18)) * momentum);
    const nSells = 3 + rng.int(8);

    const pickTick = (surgeBias: number) => {
      if (rng.float() < surgeBias) return Math.min(BATTLE_TICKS - 15, surgeStart + rng.int(220));
      return 25 + rng.int(BATTLE_TICKS - 45);
    };

    for (let k = 0; k < nBuys; k++) {
      const u = rng.float();
      let sol = 0.04 + 4.2 * u * u * u;
      if (rng.float() < 0.07) sol = 6 + rng.float() * 24; // whale
      sol = Math.round(sol * 100) / 100;
      const wallet = wallets[rng.int(wallets.length)];
      const prev = used.get(wallet) ?? 0;
      const drones = Math.min(dronesForBuy(sol), WALLET_CAP_PER_BATTLE - prev);
      const tick = pickTick(0.32);
      if (drones <= 0) continue;
      used.set(wallet, prev + drones);
      out.push({
        id: fakeBase58(rng, 64),
        tick,
        side,
        kind: "buy",
        drones,
        sol,
        wallet,
        ts: startsAt + tick * TICK_MS + rng.int(TICK_MS),
      });
    }
    for (let k = 0; k < nSells; k++) {
      const u = rng.float();
      const sol = Math.round((0.08 + 2.6 * u * u) * 100) / 100;
      const tick = pickTick(0.1);
      out.push({
        id: fakeBase58(rng, 64),
        tick,
        side,
        kind: "sell",
        drones: dronesForSell(sol),
        sol,
        wallet: wallets[rng.int(wallets.length)],
        ts: startsAt + tick * TICK_MS + rng.int(TICK_MS),
      });
    }
  }
  out.sort((a, b) => a.tick - b.tick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (cache.size > 400) cache.clear();
  cache.set(battleId, out);
  return out;
}

/** Simulated market cap drift between rounds (demo coins). */
export function demoMcapDrift(mcap: number, netSol: number, seed: number): number {
  const rng = new Rng(seed);
  const noise = 0.9 + rng.float() * 0.22;
  const next = mcap * noise + netSol * 0.85;
  // mean-revert toward a playable band
  const clamped = Math.max(18, Math.min(2400, next * 0.97 + 120 * 0.03));
  return Math.round(clamped * 10) / 10;
}
