import { isValidWallet, issueNonce, signInOrigin } from "@/lib/server/auth";
import { fail, json, rateLimit, readBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit("nonce", 20, 60_000))) return fail("Too many requests", 429);
  const { wallet } = await readBody<{ wallet: string }>(req);
  if (!isValidWallet(wallet)) return fail("Invalid wallet address");
  return json({ ok: true, ...issueNonce(wallet, signInOrigin(req)) });
}
