import { SESSION_COOKIE_NAME } from "@/lib/server/auth";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE_NAME, "", { httpOnly: true, sameSite: "none", secure: true, partitioned: true, path: "/", maxAge: 0 });
  return res;
}
