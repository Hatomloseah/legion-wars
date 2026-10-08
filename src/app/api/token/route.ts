import { json } from "@/lib/server/http";
import { tokenInfo } from "@/lib/server/market";
import { flagshipPublic } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const f = await flagshipPublic(Date.now());
  return json(await tokenInfo(f?.mcapSol ?? null));
}
