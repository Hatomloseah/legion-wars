import { cookies } from "next/headers";
import { getSession, randomDemoWallet } from "@/lib/server/auth";
import { fail, json, rateLimit, readBody } from "@/lib/server/http";
import { addDemoTrade } from "@/lib/server/trades";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit("demo-trade", 40, 60_000))) return fail("Slow down", 429);
  const body = await readBody<{ battleId: string; side: number; kind: string; sol: number }>(req);
  if (!body.battleId || (body.side !== 0 && body.side !== 1) || typeof body.sol !== "number") return fail("Invalid trade");
  const session = await getSession();
  const jar = await cookies();
  let wallet = session?.wallet ?? jar.get("legion_demo_wallet")?.value ?? "";
  if (!session && !/^DEMo[1-9A-HJ-NP-Za-km-z]{40}$/.test(wallet)) wallet = randomDemoWallet();
  const res = await addDemoTrade(String(body.battleId), body.side as 0 | 1, body.kind === "sell" ? "sell" : "buy", body.sol, wallet, Date.now());
  const out = json(res, res.ok ? 200 : 400);
  if (!session) out.cookies.set("legion_demo_wallet", wallet, { httpOnly: true, sameSite: "none", secure: true, partitioned: true, path: "/", maxAge: 60 * 60 * 24 * 7 });
  return out;
}
