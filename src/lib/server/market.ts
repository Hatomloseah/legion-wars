import "server-only";
import { FLAGSHIP_ID, FLAGSHIP_TICKER } from "@/lib/game/house";
import type { TokenInfo } from "@/lib/game/types";
import { config } from "./config";

/** pump.fun coins have a fixed 1B supply, so market cap in SOL = price in SOL * 1e9. */
const PUMP_SUPPLY = 1_000_000_000;

export interface Market {
  priceSol: number;
  priceUsd: number | null;
  mcapSol: number;
  mcapUsd: number | null;
  change24h: number | null;
  url: string | null;
}

interface DsPair {
  baseToken?: { address?: string };
  priceNative?: string;
  priceUsd?: string;
  marketCap?: number;
  fdv?: number;
  liquidity?: { usd?: number };
  priceChange?: { h24?: number };
  url?: string;
}

const cache = new Map<string, { at: number; m: Market | null }>();
const TTL = 20_000;

async function getJson(url: string, ms = 6000): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fromDexScreener(mints: string[]): Promise<Map<string, Market>> {
  const out = new Map<string, Market>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const data = (await getJson(`https://api.dexscreener.com/tokens/v1/solana/${chunk.join(",")}`)) as DsPair[] | null;
    if (!Array.isArray(data)) continue;
    const best = new Map<string, DsPair>();
    for (const p of data) {
      const a = p.baseToken?.address;
      if (!a || !chunk.includes(a)) continue;
      const prev = best.get(a);
      if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(a, p);
    }
    for (const [a, p] of best) {
      const priceSol = Number(p.priceNative);
      if (!Number.isFinite(priceSol) || priceSol <= 0) continue;
      const priceUsd = p.priceUsd ? Number(p.priceUsd) : null;
      out.set(a, {
        priceSol,
        priceUsd: priceUsd && Number.isFinite(priceUsd) ? priceUsd : null,
        mcapSol: priceSol * PUMP_SUPPLY,
        mcapUsd: p.marketCap ?? p.fdv ?? null,
        change24h: typeof p.priceChange?.h24 === "number" ? p.priceChange.h24 : null,
        url: p.url ?? null,
      });
    }
  }
  return out;
}

/** Fallback for brand-new coins DexScreener has not indexed yet (unofficial pump.fun endpoint). */
async function fromPumpFun(mint: string): Promise<Market | null> {
  const j = (await getJson(`https://frontend-api-v3.pump.fun/coins/${mint}`, 5000)) as { market_cap?: number; usd_market_cap?: number } | null;
  if (!j || typeof j.market_cap !== "number" || j.market_cap <= 0) return null;
  return {
    priceSol: j.market_cap / PUMP_SUPPLY,
    priceUsd: typeof j.usd_market_cap === "number" ? j.usd_market_cap / PUMP_SUPPLY : null,
    mcapSol: j.market_cap,
    mcapUsd: j.usd_market_cap ?? null,
    change24h: null,
    url: `https://pump.fun/coin/${mint}`,
  };
}

export async function fetchMarkets(mints: string[]): Promise<Map<string, Market>> {
  const now = Date.now();
  const out = new Map<string, Market>();
  const need: string[] = [];
  for (const m of new Set(mints)) {
    const c = cache.get(m);
    if (c && now - c.at < TTL) {
      if (c.m) out.set(m, c.m);
    } else need.push(m);
  }
  if (need.length) {
    const ds = await fromDexScreener(need);
    const missing = need.filter((m) => !ds.has(m)).slice(0, 8);
    const pf = await Promise.all(missing.map((m) => fromPumpFun(m)));
    missing.forEach((m, i) => {
      const v = pf[i];
      if (v) ds.set(m, v);
    });
    for (const m of need) {
      const v = ds.get(m) ?? null;
      cache.set(m, { at: now, m: v });
      if (v) out.set(m, v);
    }
  }
  return out;
}

/** $LEGION price card. Falls back to the flagship's simulated market cap in demo mode. */
export async function tokenInfo(flagshipMcapSol: number | null): Promise<TokenInfo> {
  const base: TokenInfo = {
    symbol: FLAGSHIP_TICKER,
    name: "The First Legion",
    mint: config.legionMint || null,
    live: false,
    priceSol: flagshipMcapSol ? flagshipMcapSol / PUMP_SUPPLY : null,
    priceUsd: null,
    mcapSol: flagshipMcapSol,
    mcapUsd: null,
    change24h: null,
    url: config.legionMint ? `https://pump.fun/coin/${config.legionMint}` : null,
    flagshipId: FLAGSHIP_ID,
  };
  if (!config.legionMint) return base;
  const m = (await fetchMarkets([config.legionMint])).get(config.legionMint);
  if (!m) return base;
  return { ...base, live: true, priceSol: m.priceSol, priceUsd: m.priceUsd, mcapSol: m.mcapSol, mcapUsd: m.mcapUsd, change24h: m.change24h };
}
