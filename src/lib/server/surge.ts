import "server-only";
import { createHash } from "node:crypto";
import { HOUR_MS } from "@/lib/game/schedule";
import type { Swarm } from "@/lib/game/types";
import { DEMO, config, sessionKey } from "./config";
import type { HourBuysDoc } from "./store";

/**
 * Surge bonus: busy hours pay more. Every legion launched and every wallet that reinforces
 * during the hour raises the surge potential (capped). When the hour closes a secret roll
 * decides how much of that potential is actually added to the prize. No fees involved.
 */
const MIN_ROLL = 0.3;

export interface SurgeActivity {
  launches: number;
  buyers: number;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function countsAsWallet(w: string): boolean {
  if (DEMO) return true;
  return w.length >= 32 && w.length <= 44 && w !== "HOUSE" && !w.startsWith("DEMo");
}

export function surgeActivity(swarms: Swarm[], hour: number, buys: HourBuysDoc | null): SurgeActivity {
  const start = hour * HOUR_MS;
  const end = start + HOUR_MS;
  const launches = swarms.filter((s) => !s.house && (DEMO || !s.demo) && s.createdAt >= start && s.createdAt < end).length;
  const wallets = new Set<string>();
  for (const per of Object.values(buys?.buys ?? {})) {
    for (const w of Object.keys(per)) if (countsAsWallet(w)) wallets.add(w);
  }
  return { launches, buyers: wallets.size };
}

/** Most the surge can add this hour, given the activity so far. */
export function surgePotential(a: SurgeActivity): number {
  if (config.prizeSurgeMaxSol <= 0) return 0;
  const raw = a.launches * config.prizeSurgePerLaunchSol + a.buyers * config.prizeSurgePerBuyerSol;
  return round6(Math.max(0, Math.min(config.prizeSurgeMaxSol, raw)));
}

/** Secret but deterministic roll in [MIN_ROLL, 1] per hour, so repeated settler runs agree. */
export function surgeRoll(hour: number): number {
  const h = createHash("sha256").update(`legion-surge:${hour}:${sessionKey.key}`).digest();
  return MIN_ROLL + (1 - MIN_ROLL) * (h.readUInt32BE(0) / 0x100000000);
}

export function surgeBonus(a: SurgeActivity, hour: number): number {
  return round6(surgePotential(a) * surgeRoll(hour));
}
