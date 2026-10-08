import { fail, json } from "@/lib/server/http";
import { getSwarmDetail } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getSwarmDetail(decodeURIComponent(id), Date.now());
  if (!detail) return fail("Legion not found", 404);
  return json(detail);
}
