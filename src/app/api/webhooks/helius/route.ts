import { NextResponse } from "next/server";
import { handleWebhook, webhookAuthorized } from "@/lib/server/helius";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!webhookAuthorized(req.headers.get("authorization"))) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await req.json().catch(() => null);
  const added = await handleWebhook(body).catch((e) => {
    console.error("[legion] webhook failed", e);
    return 0;
  });
  return NextResponse.json({ ok: true, added });
}
