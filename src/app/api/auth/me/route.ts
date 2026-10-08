import type { SessionInfo } from "@/lib/game/types";
import { getSession } from "@/lib/server/auth";
import { DEMO } from "@/lib/server/config";
import { json } from "@/lib/server/http";
import { getSessionSwarms } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  const info: SessionInfo = {
    wallet: s?.wallet ?? null,
    demoWallet: !!s?.demo,
    admin: !!s?.admin,
    demo: DEMO,
    swarms: s ? await getSessionSwarms(s.wallet, Date.now()) : [],
  };
  return json(info);
}
