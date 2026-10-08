import { NextResponse } from "next/server";
import { webhookStatus } from "@/lib/server/helius";
import { json, requireAdmin } from "@/lib/server/http";
import { getAdminData } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await requireAdmin();
  if (s instanceof NextResponse) return s;
  const [data, webhook] = await Promise.all([getAdminData(s.wallet, Date.now()), webhookStatus()]);
  return json({ ...data, webhook });
}
