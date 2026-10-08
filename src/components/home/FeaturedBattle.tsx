"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveDot, PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import { useBattleSession } from "@/lib/client/useBattleSession";
import { formatSol, shortAddr } from "@/lib/game/drones";
import { fmtClock } from "@/lib/game/schedule";
import type { BattleSummary } from "@/lib/game/types";
import { cn } from "@/lib/utils";
import { BattleRow } from "./panels";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas").then((m) => m.BattleCanvas), { ssr: false });

interface Toast {
  key: string;
  side: 0 | 1;
  drones: number;
  wallet: string;
  sol: number;
}

export function FeaturedBattle({
  battleId,
  battles,
  onSelect,
  now,
}: {
  battleId: string | null;
  battles: BattleSummary[];
  onSelect: (id: string) => void;
  now: number;
}) {
  const { detail, ctrl, hud } = useBattleSession(battleId);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!ctrl) return;
    return ctrl.on("spawn", (s) => {
      if (s.count >= 20) setToast({ key: `${s.event.id}-${ctrl.sim.tick}`, side: s.side as 0 | 1, drones: s.count, wallet: s.event.wallet, sol: s.event.sol });
    });
  }, [ctrl]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const b = detail?.battle;
  const live = hud?.mode === "live" && !hud.done;
  const total = hud ? hud.hp[0] + hud.hp[1] : 0;
  const share = hud && total > 0 ? hud.hp[0] / total : 0.5;

  return (
    <div className="panel brackets flex h-full flex-col overflow-hidden">
      <PanelHeader
        code="B"
        title="Featured battle"
        right={
          hud && (
            <span className={cn("label flex items-center gap-1.5", live ? "text-signal" : hud.mode === "preview" ? "text-foreground/80" : "text-lime")}>
              {live && <LiveDot />}
              {live ? "Live" : hud.mode === "preview" ? "Staging" : "Replay"}
            </span>
          )
        }
      />
      <div className="relative aspect-[16/11] w-full overflow-hidden bg-carbon">
        <BattleCanvas ctrl={ctrl} compact />
        {!ctrl && (
          <div className="absolute inset-0 grid place-items-center">
            <span className="label blink text-lime/80">Acquiring signal</span>
          </div>
        )}
        {b && hud && (
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-carbon/90 to-transparent p-3">
              <div>
                <div className="flex items-center gap-1.5">
                  <SwarmDot color={b.sides[0].color} size={7} />
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">{b.sides[0].ticker}</span>
                </div>
                <div className="font-mono text-[26px] leading-none tabular" style={{ color: b.sides[0].color }}>
                  {hud.counts[0]}
                </div>
              </div>
              <div className="text-center">
                <div className="font-mono text-[18px] leading-none text-foreground tabular">
                  {hud.mode === "preview" ? fmtClock(hud.startsInMs) : fmtClock(hud.timeLeftMs)}
                </div>
                <div className="label mt-1">{hud.mode === "preview" ? "to launch" : "remaining"}</div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="font-display text-[11px] font-bold uppercase tracking-[0.12em]">{b.sides[1].ticker}</span>
                  <SwarmDot color={b.sides[1].color} size={7} />
                </div>
                <div className="font-mono text-[26px] leading-none tabular" style={{ color: b.sides[1].color }}>
                  {hud.counts[1]}
                </div>
              </div>
            </div>
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-carbon/95 to-transparent p-3">
              <div className="mb-2.5 flex h-1 overflow-hidden bg-white/10">
                <div className="h-full transition-[width] duration-300" style={{ width: `${share * 100}%`, background: b.sides[0].color }} />
                <div className="h-full flex-1" style={{ background: b.sides[1].color }} />
              </div>
              <Button asChild size="sm" className="w-full">
                <Link href={`/battle/${b.id}`}>Enter battle</Link>
              </Button>
            </div>
            {toast && (
              <div key={toast.key} className="banner-in pointer-events-none absolute left-3 right-3 top-[42%] bg-lime px-3 py-1.5 text-carbon">
                <div className="skew-x-[12deg] font-display text-[13px] font-black uppercase tracking-[0.14em]">Reinforcements inbound</div>
                <div className="skew-x-[12deg] font-mono text-[10px] uppercase">
                  +{toast.drones} {b.sides[toast.side].ticker} // {shortAddr(toast.wallet)} {formatSol(toast.sol)} SOL
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="flex-1 divide-y divide-white/[0.05] border-t border-white/[0.06]">
        {battles.map((x) => (
          <BattleRow key={x.id} b={x} active={x.id === battleId} onSelect={() => onSelect(x.id)} now={now} />
        ))}
        {battles.length === 0 && <div className="px-3 py-3 font-mono text-[11px] text-muted-foreground">No battles scheduled.</div>}
      </div>
    </div>
  );
}
