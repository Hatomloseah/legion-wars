import { NextResponse } from "next/server";
import { syncWebhook } from "@/lib/server/helius";
import { json, requireAdmin } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST() {
  const s = await requireAdmin();
  if (s instanceof NextResponse) return s;
  return json(await syncWebhook());
}
