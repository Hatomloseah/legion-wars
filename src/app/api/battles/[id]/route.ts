import { NextResponse } from "next/server";
import { getBattle } from "@/lib/server/views";

export const dynamic = "force-dynamic";

/** Battle inputs (seed + configs + base sizes) and the event log visible so far. Clients poll this every second. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getBattle(id, Date.now());
  if (!detail) return NextResponse.json({ error: "Battle not found" }, { status: 404 });
  return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
}
