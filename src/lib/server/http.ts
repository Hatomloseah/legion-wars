import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { type Session, getSession } from "./auth";

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(error: string, status = 400): NextResponse {
  return json({ ok: false, error }, status);
}

const buckets = new Map<string, { n: number; reset: number }>();

/** Tiny per-instance fixed-window limiter (best effort on serverless). */
export async function rateLimit(name: string, limit: number, windowMs: number): Promise<boolean> {
  const h = await headers();
  const ip = (h.get("x-nf-client-connection-ip") || h.get("x-forwarded-for") || h.get("x-real-ip") || "local").split(",")[0].trim();
  const key = `${name}:${ip}`;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return true;
  }
  b.n++;
  return b.n <= limit;
}

export async function requireSession(): Promise<Session | NextResponse> {
  const s = await getSession();
  return s ?? fail("Connect your wallet first", 401);
}

export async function requireAdmin(): Promise<Session | NextResponse> {
  const s = await getSession();
  if (!s) return fail("Connect your wallet first", 401);
  if (!s.admin) return fail("Admin only", 403);
  return s;
}

export async function readBody<T>(req: Request): Promise<Partial<T>> {
  return ((await req.json().catch(() => null)) ?? {}) as Partial<T>;
}
