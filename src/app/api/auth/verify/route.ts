import { isAdmin } from "@/lib/server/config";
import { sessionCookie, verifySignIn } from "@/lib/server/auth";
import { fail, json, rateLimit, readBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit("verify", 20, 60_000))) return fail("Too many requests", 429);
  const body = await readBody<{ wallet: string; ticket: string; signature: string }>(req);
  const wallet = String(body.wallet ?? "");
  const v = verifySignIn(wallet, String(body.ticket ?? ""), String(body.signature ?? ""));
  if (!v.ok) return fail(v.error, 401);
  const c = sessionCookie(wallet, false);
  const res = json({ ok: true, wallet, admin: isAdmin(wallet), token: c.value });
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
