import { NextResponse, after } from "next/server";
import { SERVERLESS } from "@/lib/server/config";
import { settleDue } from "@/lib/server/settle";
import { getState } from "@/lib/server/views";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function GET() {
  const state = await getState(Date.now());
  // serverless fallback when the scheduled job is late: settle after responding
  const unsettled = [...state.lastBattles, ...(state.round.phase === "break" ? state.battles : [])].some((b) => !b.result);
  if (SERVERLESS && unsettled) {
    after(() => settleDue(8000).then(() => undefined));
  }
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
