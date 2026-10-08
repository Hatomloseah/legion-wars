/** SWARM drone economy. Computed outside the sim (server-side) and stored as integers. */

export const WALLET_CAP_PER_BATTLE = 150;

/** Base swarm size at battle start = 50 + 25 * log10(mcap in SOL + 1) */
export function baseDrones(mcapSol: number): number {
  return Math.round(50 + 25 * Math.log10(Math.max(0, mcapSol) + 1));
}

/** Reinforcements: round(20 * sqrt(SOL bought)) */
export function dronesForBuy(sol: number): number {
  return Math.round(20 * Math.sqrt(Math.max(0, sol)));
}

/** Sells destroy round(20 * sqrt(SOL sold)) drones */
export function dronesForSell(sol: number): number {
  return Math.round(20 * Math.sqrt(Math.max(0, sol)));
}

export function shortAddr(a: string): string {
  if (!a) return "";
  if (a.length <= 9) return a;
  return `${a.slice(0, 3)}…${a.slice(-3)}`;
}

export function formatSol(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2);
}
