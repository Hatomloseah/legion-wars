"use client";

import bs58 from "bs58";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@/lib/game/types";

/**
 * Wallet layer without adapter libraries: talks to injected Solana providers directly.
 * Sign-in = server nonce -> wallet signMessage -> server verifies -> session cookie + token.
 * The token is also kept in localStorage and sent as `x-swarm-session`, so auth keeps working
 * inside iframes where third-party cookies are blocked.
 */

export type WalletKind = "phantom" | "solflare" | "backpack";

interface PubKeyLike {
  toBase58(): string;
  toString(): string;
}

export interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isBackpack?: boolean;
  publicKey?: PubKeyLike | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<unknown>;
  disconnect(): Promise<void>;
  signMessage(message: Uint8Array, display?: "utf8" | "hex"): Promise<{ signature: Uint8Array } | Uint8Array>;
  signAndSendTransaction?(tx: unknown, opts?: { skipPreflight?: boolean; maxRetries?: number }): Promise<{ signature: string } | string>;
  signTransaction?(tx: unknown): Promise<unknown>;
  on?(event: string, fn: (...args: unknown[]) => void): void;
  off?(event: string, fn: (...args: unknown[]) => void): void;
  removeListener?(event: string, fn: (...args: unknown[]) => void): void;
}

export const WALLETS: { kind: WalletKind; name: string; install: string; deepLink?: (url: string) => string }[] = [
  {
    kind: "phantom",
    name: "Phantom",
    install: "https://phantom.app/download",
    deepLink: (url) => `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
  {
    kind: "solflare",
    name: "Solflare",
    install: "https://solflare.com/download",
    deepLink: (url) => `https://solflare.com/ul/v1/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
  { kind: "backpack", name: "Backpack", install: "https://backpack.app/downloads" },
];

type W = Window & {
  phantom?: { solana?: SolanaProvider };
  solana?: SolanaProvider;
  solflare?: SolanaProvider;
  backpack?: SolanaProvider & { solana?: SolanaProvider };
};

export function detectProvider(kind: WalletKind): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as W;
  if (kind === "phantom") return w.phantom?.solana?.isPhantom ? w.phantom.solana : w.solana?.isPhantom ? w.solana : null;
  if (kind === "solflare") return w.solflare?.isSolflare ? w.solflare : null;
  if (kind === "backpack") return w.backpack?.solana ?? (w.backpack?.isBackpack ? w.backpack : null);
  return null;
}

export function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

const TOKEN_KEY = "legion_session";
const KIND_KEY = "legion_wallet_kind";

function readLS(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function writeLS(k: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage blocked (private mode / iframe); cookie session still works
  }
}

/** fetch with the session token header attached (cookies are sent too). */
export function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const tok = readLS(TOKEN_KEY);
  if (tok) headers.set("x-swarm-session", tok);
  if (init.body && typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(input, { ...init, headers, credentials: "include", cache: "no-store" });
}

function pubkeyOf(p: SolanaProvider, connectResult: unknown): string | null {
  const r = connectResult as { publicKey?: PubKeyLike } | null | undefined;
  const pk = r?.publicKey ?? p.publicKey;
  return pk ? pk.toString() : null;
}

function errMsg(e: unknown, fallback: string): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : "";
  if (/reject|denied|cancel|declined/i.test(m)) return "Request cancelled in wallet";
  return m || fallback;
}

export type WalletStatus = "idle" | "connecting" | "signing";

interface WalletCtx {
  /** server session (null until loaded or when signed out) */
  session: SessionInfo | null;
  wallet: string | null;
  admin: boolean;
  /** true once the first /api/auth/me call finished */
  ready: boolean;
  status: WalletStatus;
  error: string | null;
  kind: WalletKind | null;
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  /** connect + sign in with the given wallet. Resolves to the wallet address or null. */
  signIn: (kind: WalletKind) => Promise<string | null>;
  /** instant throwaway wallet (demo mode only) */
  signInDemo: () => Promise<string | null>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Connected provider for the signed-in wallet (prompts reconnect if needed). Throws on mismatch. */
  ensureProvider: () => Promise<SolanaProvider>;
  /** Sign + send a base64 serialized VersionedTransaction (or a web3.js transaction object). Returns the signature. */
  signAndSend: (tx: string | unknown) => Promise<string>;
  clearError: () => void;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<WalletStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<WalletKind | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sessionRef = useRef<SessionInfo | null>(null);
  sessionRef.current = session;

  const refresh = useCallback(async () => {
    try {
      const res = await authFetch("/api/auth/me");
      const s = (await res.json()) as SessionInfo;
      setSession(s.wallet ? s : { ...s, wallet: null });
      if (!s.wallet) writeLS(TOKEN_KEY, null);
    } catch {
      // keep previous state on network errors
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    setKind((readLS(KIND_KEY) as WalletKind | null) ?? null);
    void refresh();
  }, [refresh]);

  const finishSignIn = useCallback(
    async (res: Response): Promise<string | null> => {
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; wallet?: string; token?: string; error?: string };
      if (!res.ok || !j.ok || !j.wallet) throw new Error(j.error || "Sign-in failed");
      if (j.token) writeLS(TOKEN_KEY, j.token);
      await refresh();
      return j.wallet;
    },
    [refresh],
  );

  const signIn = useCallback(
    async (k: WalletKind): Promise<string | null> => {
      setError(null);
      const p = detectProvider(k);
      if (!p) {
        setError(`${WALLETS.find((w) => w.kind === k)?.name ?? "Wallet"} not found in this browser`);
        return null;
      }
      try {
        setStatus("connecting");
        const r = await p.connect();
        const wallet = pubkeyOf(p, r);
        if (!wallet) throw new Error("Wallet did not share an address");
        setStatus("signing");
        const nRes = await authFetch("/api/auth/nonce", { method: "POST", body: JSON.stringify({ wallet }) });
        const n = (await nRes.json()) as { ok?: boolean; message?: string; ticket?: string; error?: string };
        if (!nRes.ok || !n.message || !n.ticket) throw new Error(n.error || "Could not start sign-in");
        const signed = await p.signMessage(new TextEncoder().encode(n.message), "utf8");
        const sigBytes = signed instanceof Uint8Array ? signed : signed.signature;
        const vRes = await authFetch("/api/auth/verify", {
          method: "POST",
          body: JSON.stringify({ wallet, ticket: n.ticket, signature: bs58.encode(sigBytes) }),
        });
        const out = await finishSignIn(vRes);
        writeLS(KIND_KEY, k);
        setKind(k);
        setPickerOpen(false);
        return out;
      } catch (e) {
        setError(errMsg(e, "Sign-in failed"));
        return null;
      } finally {
        setStatus("idle");
      }
    },
    [finishSignIn],
  );

  const signInDemo = useCallback(async (): Promise<string | null> => {
    setError(null);
    try {
      setStatus("signing");
      const out = await finishSignIn(await authFetch("/api/auth/demo", { method: "POST" }));
      setPickerOpen(false);
      return out;
    } catch (e) {
      setError(errMsg(e, "Demo sign-in failed"));
      return null;
    } finally {
      setStatus("idle");
    }
  }, [finishSignIn]);

  const signOut = useCallback(async () => {
    await authFetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    writeLS(TOKEN_KEY, null);
    const k = (readLS(KIND_KEY) as WalletKind | null) ?? null;
    if (k) await detectProvider(k)?.disconnect().catch(() => undefined);
    setSession((s) => (s ? { ...s, wallet: null, admin: false, demoWallet: false, swarms: [] } : s));
  }, []);

  // signed-in wallet switched accounts in the extension -> sign out to avoid acting as the wrong wallet
  useEffect(() => {
    if (!kind) return;
    const p = detectProvider(kind);
    if (!p?.on) return;
    const onChange = (...args: unknown[]) => {
      const pk = args[0] as PubKeyLike | null | undefined;
      const cur = sessionRef.current?.wallet;
      if (cur && !cur.startsWith("DEMo") && pk && pk.toString() !== cur) void signOut();
    };
    p.on("accountChanged", onChange);
    return () => {
      if (p.off) p.off("accountChanged", onChange);
      else p.removeListener?.("accountChanged", onChange);
    };
  }, [kind, signOut]);

  const ensureProvider = useCallback(async (): Promise<SolanaProvider> => {
    const wallet = sessionRef.current?.wallet;
    if (!wallet) throw new Error("Connect your wallet first");
    if (wallet.startsWith("DEMo")) throw new Error("Demo wallets cannot sign transactions");
    const order: WalletKind[] = kind ? [kind, ...WALLETS.map((w) => w.kind).filter((k) => k !== kind)] : WALLETS.map((w) => w.kind);
    for (const k of order) {
      const p = detectProvider(k);
      if (!p) continue;
      let pk = p.publicKey?.toString() ?? null;
      if (!pk || !p.isConnected) {
        try {
          pk = pubkeyOf(p, await p.connect());
        } catch (e) {
          if (k === kind) throw new Error(errMsg(e, "Wallet connection failed"));
          continue;
        }
      }
      if (pk === wallet) return p;
      if (k === kind) throw new Error(`Switch your wallet to ${wallet.slice(0, 4)}…${wallet.slice(-4)} (the signed-in account)`);
    }
    throw new Error("No wallet found for the signed-in account");
  }, [kind]);

  const signAndSend = useCallback(
    async (tx: string | unknown): Promise<string> => {
      const p = await ensureProvider();
      const web3 = await import("@solana/web3.js");
      const txObj = typeof tx === "string" ? web3.VersionedTransaction.deserialize(Uint8Array.from(atob(tx), (c) => c.charCodeAt(0))) : tx;
      if (p.signAndSendTransaction) {
        const r = await p.signAndSendTransaction(txObj, { maxRetries: 3 });
        const sig = typeof r === "string" ? r : r.signature;
        if (!sig) throw new Error("Wallet did not return a signature");
        return sig;
      }
      if (!p.signTransaction) throw new Error("This wallet cannot send transactions");
      const signed = (await p.signTransaction(txObj)) as { serialize(): Uint8Array };
      const raw = signed.serialize();
      let bin = "";
      for (const b of raw) bin += String.fromCharCode(b);
      const res = await authFetch("/api/tx/send", { method: "POST", body: JSON.stringify({ tx: btoa(bin) }) });
      const j = (await res.json()) as { ok?: boolean; signature?: string; error?: string };
      if (!res.ok || !j.signature) throw new Error(j.error || "Could not send transaction");
      return j.signature;
    },
    [ensureProvider],
  );

  const value = useMemo<WalletCtx>(
    () => ({
      session,
      wallet: session?.wallet ?? null,
      admin: !!session?.admin,
      ready,
      status,
      error,
      kind,
      pickerOpen,
      setPickerOpen: (v: boolean) => {
        if (v) setError(null);
        setPickerOpen(v);
      },
      signIn,
      signInDemo,
      signOut,
      refresh,
      ensureProvider,
      signAndSend,
      clearError: () => setError(null),
    }),
    [session, ready, status, error, kind, pickerOpen, signIn, signInDemo, signOut, refresh, ensureProvider, signAndSend],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
}
