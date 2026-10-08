import { TACTICS_MAX, TACTICS_MIN, cleanTactics } from "@/lib/game/tactics";
import { fail, json, rateLimit, readBody } from "@/lib/server/http";
import { compileTactics } from "@/lib/server/tactics";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

export async function POST(req: Request) {
  if (!(await rateLimit("compile", 12, 60_000))) return fail("Slow down a little. Try again in a minute.", 429);
  const body = await readBody<{ tactics: string }>(req);
  const text = cleanTactics(String(body.tactics ?? ""));
  if (text.length < TACTICS_MIN) return fail(`Write at least ${TACTICS_MIN} characters of tactics`);
  if (text.length > TACTICS_MAX) return fail(`Keep tactics under ${TACTICS_MAX} characters`);
  const res = await compileTactics(text);
  return json({ ok: true, ...res });
}
