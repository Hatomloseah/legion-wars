import { NextResponse } from "next/server";
import { config } from "@/lib/server/config";
import { ensureWebhookFresh, pollLiveBattles } from "@/lib/server/helius";
import { settleDue } from "@/lib/server/settle";
import { ensureWorld } from "@/lib/server/world";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

function authorized(req: Request): boolean {
  if (!config.cronSecret) return true;
  const url = new URL(req.url);
  return req.headers.get("authorization") === `Bearer ${config.cronSecret}` || url.searchParams.get("key") === config.cronSecret;
}

/** Called every minute by the scheduled function: advances rounds, polls trades, settles battles + prizes. */
async function run(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const t0 = Date.now();
  await ensureWorld(Date.now(), 0);
  const polled = await pollLiveBattles().catch(() => 0);
  const budget = Math.min(20_000, Number(new URL(req.url).searchParams.get("budget")) || 15_000);
  const res = await settleDue(budget);
  await ensureWorld(Date.now(), 0);
  const webhookSynced = await ensureWebhookFresh().catch(() => false);
  return NextResponse.json({ ok: true, ms: Date.now() - t0, polled, webhookSynced, ...res }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
