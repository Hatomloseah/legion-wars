import { json } from "@/lib/server/http";
import { getLeaderboard } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getLeaderboard(Date.now()));
}
