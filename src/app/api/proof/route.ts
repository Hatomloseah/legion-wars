import { json } from "@/lib/server/http";
import { getProofIndex } from "@/lib/server/views";

export const dynamic = "force-dynamic";

export async function GET() {
  return json(await getProofIndex(Date.now()));
}
