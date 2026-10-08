import { randomDemoWallet, sessionCookie } from "@/lib/server/auth";
import { DEMO } from "@/lib/server/config";
import { fail, json, rateLimit } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** DEMO MODE: instant throwaway wallet so anyone can try launching without Phantom. */
export async function POST() {
  if (!DEMO) return fail("Demo wallets are only available in demo mode", 403);
  if (!(await rateLimit("demo-auth", 10, 60_000))) return fail("Too many requests", 429);
  const wallet = randomDemoWallet();
  const c = sessionCookie(wallet, true);
  const res = json({ ok: true, wallet, admin: false, token: c.value });
  res.cookies.set(c.name, c.value, c.options);
  return res;
}
