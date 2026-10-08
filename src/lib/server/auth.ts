import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import bs58 from "bs58";
import { cookies, headers } from "next/headers";
import nacl from "tweetnacl";
import { DEMO, SERVERLESS, config, isAdmin, sessionKey } from "./config";

const SESSION_COOKIE = "swarm_session";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const NONCE_TTL = 10 * 60 * 1000;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b64u(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function mac(data: string): string {
  return createHmac("sha256", sessionKey.key).update(data).digest("base64url");
}

/** Compact HMAC-signed token: base64url(json).mac */
export function signToken(payload: Record<string, unknown>, ttlMs: number): string {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + ttlMs }));
  return `${body}.${mac(body)}`;
}

export function readToken<T extends Record<string, unknown>>(token: string | undefined | null): T | null {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function isValidWallet(w: unknown): w is string {
  if (typeof w !== "string" || w.length < 32 || w.length > 44) return false;
  try {
    return bs58.decode(w).length === 32;
  } catch {
    return false;
  }
}

const SIGN_IN_STATEMENT = "Sign in to command your legion. This request will not trigger a blockchain transaction or cost any fees.";

/** Everything needed to rebuild the exact sign-in message; carried in an HMAC-signed ticket. */
interface SignInFields {
  /** wallet */
  w: string;
  /** alphanumeric nonce */
  n: string;
  /** domain (host[:port]) */
  d: string;
  /** uri */
  u: string;
  /** issued at (ISO) */
  i: string;
  /** expires at (ISO) */
  x: string;
}

/**
 * Domain shown in the wallet prompt. It must be the site the user is actually on, otherwise
 * Phantom flags the request. Only hosts that route to this deployment reach this code, so a
 * phishing site cannot obtain a message carrying its own domain.
 */
export function signInOrigin(req: Request): { domain: string; uri: string } {
  const h = req.headers;
  let urlHost = "";
  try {
    urlHost = new URL(req.url).host;
  } catch {
    // ignore
  }
  const raw = SERVERLESS ? h.get("host") || urlHost : h.get("x-forwarded-host") || h.get("host") || urlHost;
  let domain = (raw ?? "").split(",")[0].trim().toLowerCase();
  if (!/^[a-z0-9.-]+(:\d{1,5})?$/.test(domain)) {
    try {
      domain = new URL(config.siteUrl).host;
    } catch {
      domain = "localhost";
    }
  }
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(domain);
  return { domain, uri: `${local ? "http" : "https"}://${domain}` };
}

/** Sign In With Solana (SIWS) message, in the exact format Phantom, Solflare and Backpack parse. */
function signInMessage(f: SignInFields): string {
  return [
    `${f.d} wants you to sign in with your Solana account:`,
    f.w,
    "",
    SIGN_IN_STATEMENT,
    "",
    `URI: ${f.u}`,
    "Version: 1",
    "Chain ID: mainnet",
    `Nonce: ${f.n}`,
    `Issued At: ${f.i}`,
    `Expiration Time: ${f.x}`,
  ].join("\n");
}

export function issueNonce(wallet: string, origin: { domain: string; uri: string }): { message: string; ticket: string } {
  const now = Date.now();
  let n = "";
  for (const b of randomBytes(16)) n += B58[b % B58.length];
  const fields: SignInFields = { w: wallet, n, d: origin.domain, u: origin.uri, i: new Date(now).toISOString(), x: new Date(now + NONCE_TTL).toISOString() };
  return { message: signInMessage(fields), ticket: signToken({ ...fields }, NONCE_TTL) };
}

/** Verify a wallet `signMessage` result against the message rebuilt from our signed ticket. */
export function verifySignIn(wallet: string, ticket: string, signatureB58: string): { ok: true } | { ok: false; error: string } {
  if (!isValidWallet(wallet)) return { ok: false, error: "Invalid wallet" };
  const t = readToken<SignInFields & Record<string, unknown>>(ticket);
  if (!t || t.w !== wallet || !t.n || !t.d) return { ok: false, error: "Sign-in request expired. Try again." };
  const message = signInMessage(t);
  try {
    const ok = nacl.sign.detached.verify(new TextEncoder().encode(message), bs58.decode(signatureB58), bs58.decode(wallet));
    return ok ? { ok: true } : { ok: false, error: "Signature does not match wallet" };
  } catch {
    return { ok: false, error: "Malformed signature" };
  }
}

export function randomDemoWallet(): string {
  let w = "DEMo";
  const bytes = randomBytes(40);
  for (let i = 0; i < 40; i++) w += B58[bytes[i] % B58.length];
  return w;
}

export interface Session {
  wallet: string;
  demo: boolean;
  admin: boolean;
}

/**
 * Session from the httpOnly cookie, or from the `x-swarm-session` header. The header path keeps
 * sign-in working inside third-party iframes (previews, embeds) where cookies are blocked.
 */
export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const hdr = await headers();
  const tok =
    readToken<{ w: string; d?: number }>(jar.get(SESSION_COOKIE)?.value) ?? readToken<{ w: string; d?: number }>(hdr.get("x-swarm-session"));
  if (!tok?.w) return null;
  const demo = tok.d === 1;
  // demo sessions are only honored while the server runs in demo mode
  if (demo && !DEMO) return null;
  return { wallet: tok.w, demo, admin: !demo && isAdmin(tok.w) };
}

export function sessionCookie(wallet: string, demo: boolean) {
  return {
    name: SESSION_COOKIE,
    value: signToken({ w: wallet, d: demo ? 1 : 0 }, SESSION_TTL),
    options: { httpOnly: true, sameSite: "none" as const, secure: true, partitioned: true, path: "/", maxAge: SESSION_TTL / 1000 },
  };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
