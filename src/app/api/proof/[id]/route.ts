import { fail, json } from "@/lib/server/http";
import { getProof } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const proof = await getProof(id, Date.now());
  if (!proof) return fail("Battle not settled yet or not found", 404);
  return json(proof);
}
