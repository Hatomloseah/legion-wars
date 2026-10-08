"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { XHeaderButton } from "@/components/SocialLinks";
import { WalletButton } from "@/components/wallet/WalletButton";
import { Logo, LiveDot } from "@/components/hud/primitives";
import type { GameState } from "@/lib/game/types";
import { fmtClock } from "@/lib/game/schedule";
import { cn } from "@/lib/utils";

const NAV: { href: string; label: string; soon?: boolean }[] = [
  { href: "/", label: "Map" },
  { href: "/battle/live", label: "Battles" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/create", label: "Create" },
  { href: "/proof", label: "Proof" },
  { href: "/how-it-works", label: "How it works" },
];

export function SiteHeader({ state, now }: { state: GameState | null; now: number }) {
  const path = usePathname();
  const r = state?.round;
  const live = r?.phase === "battle";
  const remaining = r ? (live ? r.battleEndsAt - now : r.endsAt - now) : 0;

  return (
    <TooltipProvider delayDuration={120}>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-carbon/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-3 sm:px-5">
          <Link href="/" className="shrink-0">
            <Logo />
          </Link>
          {state?.demo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Badge variant="solid" className="cursor-help">
                    Demo
                  </Badge>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[260px]">
                Simulated coins and a fake trade generator. Real pump.fun launches + Helius trades switch on when keys are set.
              </TooltipContent>
            </Tooltip>
          )}

          <nav className="ml-2 hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href.replace("/live", ""));
              if (n.soon)
                return (
                  <Tooltip key={n.href}>
                    <TooltipTrigger asChild>
                      <span className="cursor-not-allowed px-3 py-2 font-display text-[11px] uppercase tracking-[0.16em] text-white/25">
                        {n.label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Next build step</TooltipContent>
                  </Tooltip>
                );
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn(
                    "relative whitespace-nowrap px-2.5 py-2 font-display text-[11px] uppercase tracking-[0.16em] transition-colors xl:px-3",
                    active ? "text-lime" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {n.label}
                  {active && <span className="absolute inset-x-3 -bottom-[11px] h-px bg-lime shadow-[0_0_10px_#C6FF3D]" />}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <XHeaderButton />
            {r && (
              <Link
                href="/battle/live"
                className={cn(
                  "group flex shrink-0 items-center gap-2.5 whitespace-nowrap border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors",
                  live ? "border-signal/50 bg-signal/[0.08] text-signal hover:bg-signal/15" : "border-white/10 text-muted-foreground hover:border-lime/40",
                )}
              >
                {live ? <LiveDot /> : <span className="h-2 w-2 bg-lime/70" />}
                <span className="hidden whitespace-nowrap sm:inline lg:hidden xl:inline">{live ? "Battle live" : "Next round"}</span>
                <span className="tabular text-foreground">{fmtClock(remaining)}</span>
              </Link>
            )}
            <WalletButton />
          </div>
        </div>
        {/* mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-t border-white/[0.05] px-3 py-1.5 lg:hidden">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href.replace("/live", ""));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn("shrink-0 px-2.5 py-1 font-display text-[11px] uppercase tracking-[0.16em]", active ? "text-lime" : "text-muted-foreground")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </TooltipProvider>
  );
}
