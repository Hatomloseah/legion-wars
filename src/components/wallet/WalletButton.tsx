"use client";

import { Check, ChevronDown, Copy, Crown, ExternalLink, LogOut, Plus, Smartphone, Swords } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SwarmDot } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WALLETS, type WalletKind, detectProvider, isMobile, useWallet } from "@/lib/client/wallet";
import { cn } from "@/lib/utils";

/** Official wallet icons (from each wallet's own brand assets / adapter package). */
const ICON: Record<WalletKind, string> = {
  phantom: "/wallets/phantom.svg",
  solflare: "/wallets/solflare.svg",
  backpack: "/wallets/backpack.png",
};

function WalletIcon({ kind, name, dim, className }: { kind: WalletKind; name: string; dim?: boolean; className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: tiny static brand icon
    <img
      src={ICON[kind]}
      alt={`${name} logo`}
      width={32}
      height={32}
      className={cn("h-8 w-8 shrink-0 rounded-[7px]", dim && "opacity-60 grayscale-[30%]", className)}
    />
  );
}

export function short(a: string, n = 4): string {
  return a.length > n * 2 + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

/** Deterministic HUD avatar color for an address. */
export function addressColor(a: string): string {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a.charCodeAt(i), 16777619);
  return `hsl(${(h >>> 0) % 360} 85% 62%)`;
}

export function WalletPicker() {
  const { pickerOpen, setPickerOpen, signIn, signInDemo, status, error, session } = useWallet();
  const [detected, setDetected] = useState<Record<WalletKind, boolean>>({ phantom: false, solflare: false, backpack: false });
  const [mobile, setMobile] = useState(false);
  const [busy, setBusy] = useState<WalletKind | "demo" | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    // wallets inject asynchronously; re-check briefly after opening
    const check = () => setDetected({ phantom: !!detectProvider("phantom"), solflare: !!detectProvider("solflare"), backpack: !!detectProvider("backpack") });
    check();
    setMobile(isMobile());
    const t = setTimeout(check, 600);
    return () => clearTimeout(t);
  }, [pickerOpen]);

  const any = detected.phantom || detected.solflare || detected.backpack;
  const go = async (k: WalletKind | "demo") => {
    setBusy(k);
    if (k === "demo") await signInDemo();
    else await signIn(k);
    setBusy(null);
  };

  return (
    <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="label text-lime/80">Command link</div>
          <DialogTitle>Connect a Solana wallet</DialogTitle>
          <DialogDescription>
            You will sign a short message to prove you own the wallet. It is free and does not send a transaction.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {WALLETS.map((w) => {
            const has = detected[w.kind];
            const loading = busy === w.kind;
            if (!has) {
              const href = mobile && w.deepLink ? w.deepLink(window.location.href) : w.install;
              return (
                <a
                  key={w.kind}
                  href={href}
                  target={mobile ? undefined : "_blank"}
                  rel="noreferrer"
                  className="group flex items-center gap-3 border border-white/[0.07] bg-white/[0.015] px-3 py-2.5 transition-colors hover:border-white/20"
                >
                  <WalletIcon kind={w.kind} name={w.name} dim />
                  <span className="flex-1">
                    <span className="block font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-foreground/70">{w.name}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {mobile && w.deepLink ? "Open this page in the app" : "Not installed"}
                    </span>
                  </span>
                  {mobile && w.deepLink ? <Smartphone className="h-4 w-4 text-muted-foreground" /> : <ExternalLink className="h-4 w-4 text-muted-foreground" />}
                </a>
              );
            }
            return (
              <button
                key={w.kind}
                type="button"
                disabled={status !== "idle"}
                onClick={() => go(w.kind)}
                className={cn(
                  "group flex items-center gap-3 border px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] disabled:cursor-wait",
                  loading ? "border-lime/60 bg-lime/[0.06]" : "border-white/10 bg-white/[0.02] hover:border-lime/50 hover:bg-lime/[0.04] hover:shadow-[0_0_20px_rgba(198,255,61,0.08)]",
                )}
              >
                <WalletIcon kind={w.kind} name={w.name} />
                <span className="flex-1">
                  <span className="block font-display text-[13px] font-semibold uppercase tracking-[0.12em]">{w.name}</span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-lime/80">
                    {loading ? (status === "connecting" ? "Approve in wallet..." : "Sign the message...") : "Detected"}
                  </span>
                </span>
                {loading ? <span className="h-2 w-2 bg-lime blink" /> : <span className="font-display text-[10px] uppercase tracking-[0.16em] text-muted-foreground group-hover:text-lime">Connect</span>}
              </button>
            );
          })}
        </div>

        {!any && (
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            {mobile
              ? "On mobile, open LEGION inside your wallet's built-in browser, then connect."
              : "No wallet extension found. Install Phantom, then reload this page."}
          </p>
        )}

        {session?.demo && (
          <div className="border-t border-white/[0.06] pt-3">
            <Button variant="outline" size="sm" className="w-full" disabled={status !== "idle"} onClick={() => go("demo")}>
              {busy === "demo" ? "Issuing demo wallet..." : "Use a throwaway demo wallet"}
            </Button>
          </div>
        )}

        {error && <div className="border border-signal/40 bg-signal/[0.07] px-3 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-signal">{error}</div>}
      </DialogContent>
    </Dialog>
  );
}

export function WalletButton({ className }: { className?: string }) {
  const { wallet, admin, session, ready, kind, setPickerOpen, signOut } = useWallet();
  const [copied, setCopied] = useState(false);

  if (!ready) return <span className={cn("hidden h-8 w-[132px] animate-pulse border border-white/10 sm:inline-block", className)} />;

  if (!wallet)
    return (
      <Button size="sm" variant="outline" className={className} onClick={() => setPickerOpen(true)}>
        Connect wallet
      </Button>
    );

  const color = addressColor(wallet);
  const mine = session?.swarms ?? [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex h-8 items-center gap-2 border border-white/10 bg-white/[0.02] px-2.5 font-mono text-[11px] uppercase tracking-[0.1em] outline-none transition-colors hover:border-lime/50 data-[state=open]:border-lime/60",
            className,
          )}
        >
          {kind && !session?.demoWallet ? (
            <WalletIcon kind={kind} name={WALLETS.find((w) => w.kind === kind)?.name ?? "Wallet"} className="h-4 w-4 rounded-[3px]" />
          ) : (
            <SwarmDot color={color} size={9} />
          )}
          <span className="tabular">{short(wallet)}</span>
          {admin && <Crown className="h-3 w-3 text-lime" />}
          <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{session?.demoWallet ? "Demo wallet" : admin ? "Signed in // admin" : "Signed in"}</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            void navigator.clipboard?.writeText(wallet).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            });
          }}
          className="font-mono normal-case tracking-[0.04em]"
        >
          <SwarmDot color={color} size={8} />
          <span className="truncate">{short(wallet, 8)}</span>
          {copied ? <Check className="ml-auto text-lime" /> : <Copy className="ml-auto" />}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {mine.length > 0 && (
          <>
            <DropdownMenuLabel>Your legions</DropdownMenuLabel>
            {mine.map((s) => (
              <DropdownMenuItem key={s.id} asChild>
                <Link href={`/legion/${s.id}`}>
                  <SwarmDot color={s.color} size={8} />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto font-mono text-[10px]" style={{ color: s.color }}>
                    ${s.ticker}
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem asChild>
          <Link href="/create">
            <Plus /> Raise a legion
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/battle/live">
            <Swords /> Live battle
          </Link>
        </DropdownMenuItem>
        {admin && (
          <DropdownMenuItem asChild>
            <Link href="/admin" className="text-lime">
              <Crown /> Admin console
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} className="text-signal/90 focus:bg-signal/10 focus:text-signal">
          <LogOut /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
