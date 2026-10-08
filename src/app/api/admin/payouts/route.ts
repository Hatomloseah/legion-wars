import { Connection } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { fail, json, readBody, requireAdmin } from "@/lib/server/http";
import { markPayouts, pendingPayouts } from "@/lib/server/views";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

const LAMPORTS = 1_000_000_000;

/** Latest blockhash so the admin's browser can build the payout transaction without our RPC key. */
export async function GET() {
  const s = await requireAdmin();
  if (s instanceof NextResponse) return s;
  const conn = new Connection(config.solanaRpcUrl, "confirmed");
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  return json({ ok: true, blockhash, lastValidBlockHeight });
}

/**
 * action "verify": check a sent payout transaction on-chain and mark the covered payouts paid.
 * action "void": cancel payouts (e.g. bad wallet).
 */
export async function POST(req: Request) {
  const s = await requireAdmin();
  if (s instanceof NextResponse) return s;
  const body = await readBody<{ action: string; ids: string[]; signature: string }>(req);
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 50) : [];
  if (!ids.length) return fail("No payouts selected");
  const now = Date.now();
  if (body.action === "void") return json({ ok: true, updated: await markPayouts(ids, "void", undefined, now) });
  if (body.action !== "verify") return fail("Unknown action");
  const sig = String(body.signature ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return fail("Invalid signature");
  const conn = new Connection(config.solanaRpcUrl, "confirmed");
  const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
  if (!tx) return json({ ok: false, pending: true, error: "Transaction not confirmed yet" }, 202);
  if (tx.meta?.err) return fail("Payout transaction failed on-chain");
  const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
  const payouts = await pendingPayouts(ids);
  // sum what each wallet is owed in this batch, then check its balance rose by at least that much
  const owed = new Map<string, number>();
  for (const p of payouts) owed.set(p.wallet, (owed.get(p.wallet) ?? 0) + Math.round(p.sol * LAMPORTS));
  const paidWallets = new Set<string>();
  for (const [wallet, lamports] of owed) {
    const i = keys.indexOf(wallet);
    if (i < 0) continue;
    const delta = (tx.meta?.postBalances[i] ?? 0) - (tx.meta?.preBalances[i] ?? 0);
    if (delta >= lamports - 1) paidWallets.add(wallet);
  }
  const ok = payouts.filter((p) => paidWallets.has(p.wallet)).map((p) => p.id);
  const updated = ok.length ? await markPayouts(ok, "paid", sig, now) : 0;
  return json({ ok: true, updated, missing: payouts.length - ok.length });
}
