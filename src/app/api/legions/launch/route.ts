import { NextResponse } from "next/server";
import type { LaunchDraft } from "@/lib/game/types";
import { DEMO } from "@/lib/server/config";
import { fail, json, rateLimit, readBody, requireSession } from "@/lib/server/http";
import { launchDemo, prepareLiveLaunch, validateDraft } from "@/lib/server/launch";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function POST(req: Request) {
  const s = await requireSession();
  if (s instanceof NextResponse) return s;
  if (!(await rateLimit("launch", 6, 10 * 60_000))) return fail("Too many launch attempts. Try again in a few minutes.", 429);
  const body = await readBody<LaunchDraft>(req);
  const now = Date.now();
  const v = await validateDraft(body, now);
  if (!v.ok) return fail(v.error);
  if (DEMO) {
    const res = await launchDemo(s.wallet, v.draft, now);
    return json(res, res.ok ? 200 : 400);
  }
  if (s.demo) return fail("Connect a real Solana wallet to launch a coin", 401);
  const res = await prepareLiveLaunch(s.wallet, v.draft);
  return json(res, res.ok ? 200 : 400);
}
