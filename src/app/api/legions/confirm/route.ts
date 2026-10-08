import { NextResponse } from "next/server";
import { after } from "next/server";
import { fail, json, readBody, requireSession } from "@/lib/server/http";
import { syncWebhook } from "@/lib/server/helius";
import { confirmLiveLaunch } from "@/lib/server/launch";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  const body = await readBody<{ mint: string; signature: string }>(req);
  if (!body.mint || !body.signature) return fail("Missing mint or signature");
  const res = await confirmLiveLaunch(s.wallet, String(body.mint), String(body.signature), Date.now());
  if (res.ok) {
    after(async () => {
      const r = await syncWebhook();
      if (!r.ok) console.warn("[legion] webhook sync:", r.error);
    });
    return json(res);
  }
  return json(res, "pending" in res && res.pending ? 202 : 400);
}
