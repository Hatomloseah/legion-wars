import "server-only";
import { DEMO, config } from "./config";
import { kvGet, kvSet } from "./kv";
import { type ChainTrade, allRealMints, ingestTrades, liveMints } from "./trades";

/** Subset of a Helius enhanced transaction that we rely on. */
export interface EnhancedTx {
  signature?: string;
  timestamp?: number;
  feePayer?: string;
  transactionError?: unknown;
  tokenTransfers?: { fromUserAccount?: string; toUserAccount?: string; mint?: string; tokenAmount?: number }[];
  accountData?: { account?: string; nativeBalanceChange?: number }[];
  events?: { swap?: { nativeInput?: { account?: string; amount?: string | number } | null; nativeOutput?: { account?: string; amount?: string | number } | null } };
}

const LAMPORTS = 1_000_000_000;

/** Extract buys/sells of tracked mints. The trader is the fee payer; SOL comes from their balance change. */
export function parseTrades(tx: EnhancedTx, mints: Set<string>): ChainTrade[] {
  if (!tx.signature || tx.transactionError || !tx.feePayer) return [];
  const trader = tx.feePayer;
  const out: ChainTrade[] = [];
  const touched = new Set((tx.tokenTransfers ?? []).map((t) => t.mint).filter((m): m is string => !!m && mints.has(m)));
  for (const mint of touched) {
    let tokenDelta = 0;
    for (const t of tx.tokenTransfers ?? []) {
      if (t.mint !== mint) continue;
      const amt = Number(t.tokenAmount ?? 0);
      if (t.toUserAccount === trader) tokenDelta += amt;
      if (t.fromUserAccount === trader) tokenDelta -= amt;
    }
    if (tokenDelta === 0) continue;
    const kind: "buy" | "sell" = tokenDelta > 0 ? "buy" : "sell";
    let lamports = 0;
    const swap = tx.events?.swap;
    if (kind === "buy" && swap?.nativeInput?.amount) lamports = Number(swap.nativeInput.amount);
    else if (kind === "sell" && swap?.nativeOutput?.amount) lamports = Number(swap.nativeOutput.amount);
    if (!lamports) {
      const change = tx.accountData?.find((a) => a.account === trader)?.nativeBalanceChange ?? 0;
      lamports = Math.abs(change);
    }
    const sol = lamports / LAMPORTS;
    if (!Number.isFinite(sol) || sol <= 0) continue;
    out.push({
      signature: touched.size > 1 ? `${tx.signature}:${mint.slice(0, 6)}` : tx.signature,
      mint,
      wallet: trader,
      kind,
      sol,
      blockTime: (tx.timestamp ?? Math.floor(Date.now() / 1000)) * 1000,
    });
  }
  return out;
}

export function webhookAuthorized(header: string | null): boolean {
  if (!config.heliusWebhookSecret) return !DEMO; // no secret configured: accept (not recommended)
  return header === config.heliusWebhookSecret || header === `Bearer ${config.heliusWebhookSecret}`;
}

export async function handleWebhook(body: unknown): Promise<number> {
  if (DEMO) return 0;
  const txs = Array.isArray(body) ? (body as EnhancedTx[]) : [];
  if (!txs.length) return 0;
  const now = Date.now();
  const mints = new Set(await allRealMints(now));
  const trades = txs.flatMap((t) => parseTrades(t, mints));
  return ingestTrades(trades, now, "webhook");
}

/** Polling fallback: fetch recent swaps for every real coin in a live battle. */
export async function pollLiveBattles(): Promise<number> {
  if (DEMO || !config.heliusApiKey) return 0;
  const now = Date.now();
  const live = await liveMints(now);
  if (!live.length) return 0;
  const mints = new Set(live.map((l) => l.mint));
  let total = 0;
  await Promise.all(
    live.map(async (l) => {
      const since = Math.floor(l.startsAt / 1000) - 2;
      const url = `${config.heliusApiBase}/v0/addresses/${l.mint}/transactions?api-key=${config.heliusApiKey}&commitment=confirmed&limit=100&gte-time=${since}`;
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 7000);
        const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
        clearTimeout(t);
        if (!res.ok) return;
        const txs = (await res.json()) as EnhancedTx[];
        const trades = (Array.isArray(txs) ? txs : []).flatMap((tx) => parseTrades(tx, mints)).filter((tr) => tr.mint === l.mint);
        total += await ingestTrades(trades, Date.now(), "poll");
      } catch {
        // best effort
      }
    }),
  );
  return total;
}

interface HeliusWebhook {
  webhookID: string;
  webhookURL: string;
  accountAddresses?: string[];
}

export function webhookUrl(): string {
  return config.siteUrl ? `${config.siteUrl}/api/webhooks/helius` : "";
}

/** Create or update our Helius webhook so it watches every registered coin. */
export async function syncWebhook(): Promise<{ ok: boolean; id?: string; addresses?: number; error?: string }> {
  if (!config.heliusApiKey) return { ok: false, error: "HELIUS_API_KEY not set" };
  const url = webhookUrl();
  if (!url) return { ok: false, error: "SITE_URL not set (needed for the webhook callback)" };
  const mints = await allRealMints(Date.now());
  if (!mints.length) return { ok: false, error: "No real coins registered yet" };
  const base = `${config.heliusApiBase}/v0/webhooks`;
  const key = `api-key=${config.heliusApiKey}`;
  const body = {
    webhookURL: url,
    transactionTypes: ["ANY"],
    accountAddresses: mints,
    webhookType: "enhanced",
    ...(config.heliusWebhookSecret ? { authHeader: config.heliusWebhookSecret } : {}),
  };
  try {
    const listRes = await fetch(`${base}?${key}`, { cache: "no-store" });
    const list = listRes.ok ? ((await listRes.json()) as HeliusWebhook[]) : [];
    const existing = list.find((w) => w.webhookURL === url);
    const res = existing
      ? await fetch(`${base}/${existing.webhookID}?${key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      : await fetch(`${base}?${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false, error: `Helius ${res.status}: ${(await res.text()).slice(0, 160)}` };
    const j = (await res.json()) as HeliusWebhook;
    await kvSet("helius:webhook", { id: j.webhookID, at: Date.now(), addresses: mints.length, sig: watchSig(url, mints) });
    return { ok: true, id: j.webhookID, addresses: mints.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Helius request failed" };
  }
}

function watchSig(url: string, mints: string[]): string {
  return `${url}|${[...mints].sort().join(",")}`;
}

/**
 * Cron safety net: re-sync the webhook whenever the set of real coins changed without a launch
 * (for example when LEGION_MINT is set) or a post-launch sync failed. Retries at most every 10 min.
 */
export async function ensureWebhookFresh(): Promise<boolean> {
  if (DEMO || !config.heliusApiKey) return false;
  const url = webhookUrl();
  if (!url) return false;
  const mints = await allRealMints(Date.now());
  if (!mints.length) return false;
  const st = await kvGet<{ sig?: string }>("helius:webhook", 30_000);
  if (st?.sig === watchSig(url, mints)) return false;
  const last = await kvGet<{ at: number }>("helius:webhook:try", 30_000);
  if (last && Date.now() - last.at < 10 * 60_000) return false;
  await kvSet("helius:webhook:try", { at: Date.now() });
  const r = await syncWebhook();
  if (!r.ok) console.warn("[legion] webhook resync:", r.error);
  return r.ok;
}

export async function webhookStatus(): Promise<{ id: string; at: number; addresses: number } | null> {
  return kvGet("helius:webhook", 10_000);
}
