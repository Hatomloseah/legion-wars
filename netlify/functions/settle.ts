/**
 * Netlify scheduled function: every minute, advance rounds, poll on-chain trades and settle
 * battles + hourly prizes by calling the app's own cron endpoint. Runs on published deploys only.
 */
export default async () => {
  const base = (process.env.URL || process.env.DEPLOY_PRIME_URL || "").replace(/\/$/, "");
  if (!base) {
    console.error("[legion-cron] no site URL in environment");
    return new Response(JSON.stringify({ ok: false, error: "no site url" }), { status: 500 });
  }
  const key = process.env.CRON_SECRET || "";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/cron/settle?budget=15000`, {
      method: "POST",
      headers: key ? { authorization: `Bearer ${key}` } : {},
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as { settled?: string[]; prizes?: number[]; polled?: number; more?: boolean };
    console.log(
      `[legion-cron] ${res.status} in ${Date.now() - t0}ms settled=${body.settled?.length ?? 0} prizes=${body.prizes?.length ?? 0} polled=${body.polled ?? 0} more=${!!body.more}`,
    );
    return new Response(JSON.stringify({ ok: res.ok, status: res.status }), { status: res.ok ? 200 : 502 });
  } catch (e) {
    console.error("[legion-cron] failed", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  } finally {
    clearTimeout(timer);
  }
};

export const config = { schedule: "* * * * *" };
