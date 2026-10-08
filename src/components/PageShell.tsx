"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { XTextLink } from "@/components/SocialLinks";
import { useGameState, useServerNow } from "@/lib/client/useGameState";
import type { GameState } from "@/lib/game/types";
import { cn } from "@/lib/utils";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-3 py-5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:px-5">
        <span>LEGION // Every coin is a legion. Every buy is a reinforcement.</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/how-it-works" className="hover:text-lime">
            How it works
          </Link>
          <Link href="/proof" className="hover:text-lime">
            Proof
          </Link>
          <Link href="/leaderboard" className="hover:text-lime">
            Leaderboard
          </Link>
          <Link href="/create" className="hover:text-lime">
            Raise a legion
          </Link>
          <XTextLink />
        </nav>
        <span>Deterministic lockstep // same inputs, same battle, everywhere</span>
      </div>
    </footer>
  );
}

/**
 * Standard page frame: sticky header (with round clock + wallet), HUD atmosphere, footer, grain.
 * Pass `state`/`now` if the page already polls /api/state; otherwise the shell polls on its own.
 */
export function PageShell({
  children,
  state: stateProp,
  now: nowProp,
  className,
  wide,
}: {
  children: ReactNode;
  state?: GameState | null;
  now?: number;
  className?: string;
  /** full 1600px width (default 1280px) */
  wide?: boolean;
}) {
  const own = stateProp === undefined;
  const { state: ownState, offset } = useGameState(8000, own);
  const ownNow = useServerNow(offset, 1000);
  const state = own ? ownState : stateProp;
  const now = nowProp ?? ownNow;
  return (
    <div className="relative flex min-h-screen flex-col bg-carbon">
      <div className="pointer-events-none fixed inset-0 hud-grid opacity-50" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[420px] bg-[radial-gradient(ellipse_at_top,rgba(198,255,61,0.06),transparent_60%)]" />
      <SiteHeader state={state ?? null} now={now} />
      <main className={cn("relative mx-auto w-full flex-1 px-3 pb-12 sm:px-5", wide ? "max-w-[1600px]" : "max-w-[1280px]", className)}>{children}</main>
      <SiteFooter />
      <div className="grain" />
    </div>
  );
}

/** Page title block: code // kicker line, big display title, optional lede + right slot. */
export function PageTitle({ code, kicker, title, lede, right }: { code: string; kicker: string; title: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <section className="rise-in flex flex-col gap-4 py-7 sm:py-9 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-[760px]">
        <div className="label flex items-center gap-2">
          <span className="text-lime">{code}</span>
          <span className="text-white/20">//</span>
          <span>{kicker}</span>
        </div>
        <h1 className="mt-3 font-display text-[30px] font-black uppercase leading-[0.95] tracking-[0.02em] sm:text-[44px]">{title}</h1>
        {lede && <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-muted-foreground">{lede}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </section>
  );
}
