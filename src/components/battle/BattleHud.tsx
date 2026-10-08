"use client";

import { ArrowLeft, Check, ExternalLink, Pause, Play, RotateCcw, ShieldAlert, Zap } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LiveDot, Meter, SwarmDot } from "@/components/hud/primitives";
import { Button } from "@/components/ui/button";
import type { LockstepController } from "@/lib/client/lockstep";
import type { HudState } from "@/lib/client/useBattleSession";
import { formatSol, shortAddr } from "@/lib/game/drones";
import { isSimulatedSide } from "@/lib/game/house";
import { hexCode } from "@/lib/game/hexmap";
import { fmtClock } from "@/lib/game/schedule";
import type { BattleDetail, BattleSide, BattleSummary } from "@/lib/game/types";
import { BATTLE_TICKS, TICK_MS } from "@/lib/sim/engine";
import { ABILITY_INFO, type SimEvent } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

export interface Banner {
  key: string;
  side: 0 | 1;
  drones: number;
  wallet: string;
  sol: number;
}

const ABILITY_MAX_CD: Record<string, number> = { emp: 320, kamikaze: 260, shield: 300, decoys: 280 };

function SideCard({ side, idx, hud, align }: { side: BattleSide; idx: 0 | 1; hud: HudState; align: "left" | "right" }) {
  const count = hud.counts[idx];
  const integrity = count > 0 ? hud.hp[idx] / (count * 100) : 0;
  const st = hud.stats[idx];
  const cd = hud.abilityCd[idx];
  const maxCd = ABILITY_MAX_CD[side.ability] ?? 300;
  const ready = cd <= 0;
  const right = align === "right";
  return (
    <div className={cn("pointer-events-auto relative min-w-0 border border-white/[0.08] bg-carbon/75 backdrop-blur-md", right ? "text-right" : "")}>
      <div className="absolute inset-y-0 w-[3px]" style={{ background: side.color, boxShadow: `0 0 14px ${side.color}`, [right ? "right" : "left"]: 0 }} />
      <div className={cn("px-3 py-2.5 sm:px-4", right ? "pr-4 sm:pr-5" : "pl-4 sm:pl-5")}>
        <div className={cn("flex items-center gap-2", right && "flex-row-reverse")}>
          <SwarmDot color={side.color} />
          <span className="truncate font-display text-[13px] font-bold uppercase tracking-[0.12em] sm:text-[15px]">{side.name}</span>
          <span className="hidden font-mono text-[10px] tracking-[0.14em] sm:inline" style={{ color: side.color }}>
            ${side.ticker}
          </span>
          <span className="label hidden md:inline">{idx === 0 ? "ATK" : "DEF"}</span>
        </div>
        <div className={cn("mt-1 flex items-end gap-2", right && "flex-row-reverse")}>
          <span className="font-mono text-[34px] leading-none tabular sm:text-[46px]" style={{ color: side.color, textShadow: `0 0 22px ${side.color}66` }}>
            {count}
          </span>
          <span className="label mb-1">drones</span>
          {hud.decoys[idx] > 0 && <span className="label mb-1 text-foreground/70">+{hud.decoys[idx]} decoy</span>}
        </div>
        <Meter value={integrity} color={integrity > 0.45 ? side.color : "#FF3B30"} segments={20} className={cn("mt-2 h-1.5", right && "flex-row-reverse")} />
        <div className={cn("mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground", right && "justify-end")}>
          <span>
            <span className="text-lime">+{st.spawned}</span> reinf
          </span>
          <span>
            <span className="text-signal">-{st.lost}</span> lost
          </span>
          <span className="hidden sm:inline">
            <span className="text-foreground">{st.kills}</span> kills
          </span>
        </div>
        <div className={cn("mt-2 hidden items-center gap-2 sm:flex", right && "flex-row-reverse")}>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 border px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
              hud.shield[idx] > 0 ? "border-white/60 bg-white/10 text-white" : ready ? "border-lime/60 text-lime" : "border-white/10 text-muted-foreground",
            )}
          >
            {side.ability === "shield" ? <ShieldAlert className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
            {ABILITY_INFO[side.ability].name}
          </span>
          <div className="h-1 w-16 bg-white/[0.07]">
            <div className="h-full bg-lime/80" style={{ width: `${(1 - Math.max(0, cd) / maxCd) * 100}%` }} />
          </div>
          <span className="font-mono text-[10px] text-muted-foreground tabular">{ready ? "READY" : `${Math.ceil(cd / 10)}s`}</span>
        </div>
      </div>
    </div>
  );
}

function FeedItem({ e, sides }: { e: SimEvent; sides: [BattleSide, BattleSide] }) {
  const side = sides[e.side];
  const buy = e.kind === "buy";
  return (
    <li className="feed-in flex items-baseline gap-2 border-b border-white/[0.04] px-3 py-1.5 font-mono text-[11px] leading-tight">
      <span className="w-[42px] shrink-0 text-white/30 tabular">{fmtClock(e.tick * TICK_MS)}</span>
      <span className={cn("shrink-0 tabular", buy ? "text-lime" : "text-signal")}>
        {buy ? "+" : "-"}
        {e.drones}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">
        <span style={{ color: side.color }}>{side.ticker}</span> {shortAddr(e.wallet)} {buy ? "bought" : "sold"} {formatSol(e.sol)} SOL
      </span>
    </li>
  );
}

export function ReinforceBanner({ banner, side }: { banner: Banner; side: BattleSide }) {
  return (
    <div key={banner.key} className="pointer-events-none absolute left-0 right-0 top-[34%] z-30 flex justify-center overflow-hidden">
      <div className="banner-in relative max-w-[92vw] bg-lime px-6 py-3 text-carbon shadow-[0_0_60px_rgba(198,255,61,0.55)] sm:px-10">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(-45deg,#07090A_0_8px,transparent_8px_16px)] opacity-80" />
        <div className="absolute inset-x-0 bottom-0 h-1.5 bg-[repeating-linear-gradient(-45deg,#07090A_0_8px,transparent_8px_16px)] opacity-80" />
        <div className="skew-x-[12deg]">
          <div className="font-display text-[22px] font-black uppercase leading-none tracking-[0.16em] sm:text-[34px]">Reinforcements inbound</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 font-mono text-[12px] uppercase tracking-[0.1em] sm:text-[13px]">
            <span className="font-bold">+{banner.drones} drones</span>
            <span className="opacity-50">//</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5" style={{ background: side.color, outline: "1px solid #07090A" }} />
              {side.name}
            </span>
            <span className="opacity-50">//</span>
            <span>
              {shortAddr(banner.wallet)} bought {formatSol(banner.sol)} SOL
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface HudProps {
  detail: BattleDetail;
  hud: HudState;
  ctrl: LockstepController;
  battles: BattleSummary[];
  banner: Banner | null;
  onDemoTrade?: (side: 0 | 1, sol: number, kind: "buy" | "sell") => void;
  tradeMsg?: string | null;
  verified: "match" | "mismatch" | "pending";
  clientWinner: 0 | 1 | null;
}

export function BattleHud({ detail, hud, ctrl, battles, banner, onDemoTrade, tradeMsg, verified, clientWinner }: HudProps) {
  const b = detail.battle;
  const [showFeed, setShowFeed] = useState(true);
  const total = hud.hp[0] + hud.hp[1];
  const share = total > 0 ? hud.hp[0] / total : 0.5;
  const live = hud.mode === "live" && !hud.done;
  const preview = hud.mode === "preview";
  const canTrade = detail.demo && detail.phase === "live" && !hud.done;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col">
      {/* top bar */}
      <div className="flex items-center gap-2 px-3 pt-3 sm:px-5">
        <Link href="/" className="pointer-events-auto inline-flex items-center gap-1.5 border border-white/10 bg-carbon/70 px-2.5 py-1.5 font-display text-[11px] uppercase tracking-[0.16em] text-muted-foreground backdrop-blur hover:border-lime/50 hover:text-lime">
          <ArrowLeft className="h-3.5 w-3.5" /> Theater
        </Link>
        <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground md:inline">
          BTL {b.id} <span className="text-white/25">//</span> SEED {b.seed.toString(16).toUpperCase().padStart(8, "0")}{" "}
          <span className="text-white/25">//</span> PRIZE {hexCode(b.prizeHex[0])}/{hexCode(b.prizeHex[1])}
        </span>
        <div className="pointer-events-auto ml-auto flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
              live ? "border-signal/60 bg-signal/10 text-signal" : preview ? "border-white/20 text-foreground" : "border-lime/60 bg-lime/10 text-lime",
            )}
          >
            {live && <LiveDot />}
            {live ? "Live" : preview ? "Staging" : hud.mode === "replay" ? `Replay ${hud.speed}x` : "Final"}
          </span>
          {battles.length > 1 && (
            <div className="hidden items-center gap-1 sm:flex">
              {battles.map((x) => (
                <Link
                  key={x.id}
                  href={`/battle/${x.id}`}
                  className={cn(
                    "border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] backdrop-blur transition-colors",
                    x.id === b.id ? "border-lime/70 bg-lime/10 text-lime" : "border-white/10 bg-carbon/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {x.sides[0].ticker}/{x.sides[1].ticker}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* sides + timer */}
      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-3 sm:gap-4 sm:px-5">
        <SideCard side={b.sides[0]} idx={0} hud={hud} align="left" />
        <div className="flex flex-col items-center pt-1">
          <span className="label">{preview ? "Starts in" : "Time"}</span>
          <span className={cn("font-mono text-[28px] leading-none tabular sm:text-[44px]", live ? "text-foreground" : "text-lime")}>
            {preview ? fmtClock(hud.startsInMs) : fmtClock(hud.timeLeftMs)}
          </span>
          <div className="mt-2 hidden h-1 w-40 bg-white/[0.07] sm:block">
            <div className="h-full bg-lime" style={{ width: `${(hud.tick / BATTLE_TICKS) * 100}%` }} />
          </div>
          <span className="mt-2 font-display text-[11px] font-bold tracking-[0.3em] text-white/30">VS</span>
        </div>
        <SideCard side={b.sides[1]} idx={1} hud={hud} align="right" />
      </div>

      {/* tug of war */}
      <div className="mx-3 mt-2 sm:mx-5">
        <div className="relative flex h-1.5 overflow-hidden bg-white/[0.05]">
          <div className="h-full transition-[width] duration-300" style={{ width: `${share * 100}%`, background: b.sides[0].color }} />
          <div className="h-full flex-1 transition-[width] duration-300" style={{ background: b.sides[1].color }} />
          <div className="absolute inset-y-0 left-1/2 w-px bg-carbon" />
        </div>
      </div>

      <div className="flex-1" />

      {/* bottom area */}
      <div className="grid grid-cols-1 items-end gap-3 px-3 pb-3 sm:px-5 sm:pb-5 lg:grid-cols-[1fr_auto_1fr]">
        {/* reinforce actions */}
        <div className="pointer-events-auto order-2 grid grid-cols-2 gap-2 lg:order-1 lg:max-w-[460px]">
          {([0, 1] as const).map((s) => {
            const side = b.sides[s];
            const fake = detail.demo || isSimulatedSide(side);
            const house = !detail.demo && side.creator === "HOUSE";
            return (
              <div key={s} className="border border-white/[0.08] bg-carbon/75 p-2.5 backdrop-blur-md">
                <div className="label mb-2 flex items-center gap-1.5">
                  <SwarmDot color={side.color} size={7} /> Reinforce {side.ticker}
                </div>
                {fake ? (
                  <div
                    title={house ? "House legions are AI garrisons with no coin. They fight on base drones only." : "Simulated coin. No real pump.fun market."}
                    className="chamfer-sm flex h-9 cursor-not-allowed items-center justify-center gap-1.5 bg-white/[0.06] font-display text-[11px] font-bold uppercase tracking-[0.12em] text-white/40"
                  >
                    {house ? "House garrison // not tradable" : "Simulated coin"}
                  </div>
                ) : (
                  <a
                    href={`https://pump.fun/coin/${side.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    className="chamfer-sm flex h-9 items-center justify-center gap-1.5 font-display text-[11px] font-bold uppercase tracking-[0.12em] text-carbon transition-shadow hover:shadow-[0_0_20px_currentColor]"
                    style={{ background: side.color }}
                  >
                    Buy on pump.fun <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {detail.demo && (
                  <div className="mt-2">
                    <div className="label mb-1 text-[9px]">Demo: simulate a trade</div>
                    <div className="grid grid-cols-4 gap-1">
                      {[0.5, 2, 8].map((sol) => (
                        <button
                          key={sol}
                          type="button"
                          disabled={!canTrade}
                          onClick={() => onDemoTrade?.(s, sol, "buy")}
                          className="border border-lime/30 bg-lime/[0.06] py-1.5 font-mono text-[10px] text-lime transition-colors hover:bg-lime/20 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          +{sol}
                        </button>
                      ))}
                      <button
                        type="button"
                        disabled={!canTrade}
                        onClick={() => onDemoTrade?.(s, 1, "sell")}
                        className="border border-signal/30 bg-signal/[0.06] py-1.5 font-mono text-[10px] text-signal transition-colors hover:bg-signal/20 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        SELL
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {tradeMsg && <div className="col-span-2 font-mono text-[10px] uppercase tracking-[0.12em] text-lime">{tradeMsg}</div>}
          {!canTrade && detail.demo && (
            <div className="col-span-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {detail.phase === "live" ? "Battle closing" : detail.phase === "upcoming" ? "Trades open when the battle starts" : "Battle over. Trades now count toward the next round."}
            </div>
          )}
        </div>

        {/* replay controls / lockstep */}
        <div className="pointer-events-auto order-1 flex flex-col items-center gap-2 lg:order-2">
          {(hud.mode === "replay" || hud.done) && (
            <div className="flex items-center gap-1 border border-white/[0.08] bg-carbon/80 p-1 backdrop-blur-md">
              <button
                type="button"
                aria-label="Restart replay"
                onClick={() => ctrl.startReplay(0)}
                className="grid h-8 w-8 place-items-center text-muted-foreground hover:text-lime"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={hud.paused ? "Play" : "Pause"}
                onClick={() => {
                  if (ctrl.mode !== "replay") ctrl.startReplay(0);
                  else ctrl.paused = !ctrl.paused;
                }}
                className="grid h-8 w-8 place-items-center bg-lime text-carbon"
              >
                {hud.paused || hud.mode !== "replay" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              {[1, 2, 4, 8].map((sp) => (
                <button
                  key={sp}
                  type="button"
                  onClick={() => {
                    if (ctrl.mode !== "replay") ctrl.startReplay(0);
                    ctrl.replaySpeed = sp;
                  }}
                  className={cn(
                    "h-8 px-2 font-mono text-[11px]",
                    hud.mode === "replay" && hud.speed === sp ? "text-lime" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {sp}x
                </button>
              ))}
              <input
                type="range"
                min={0}
                max={BATTLE_TICKS}
                value={hud.tick}
                onChange={(e) => ctrl.seek(Number(e.target.value) * TICK_MS)}
                className="mx-2 w-28 accent-[#C6FF3D] sm:w-44"
                aria-label="Seek replay"
              />
            </div>
          )}
          <div className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground sm:block">
            Lockstep <span className="text-lime">{hud.checksum.toString(16).toUpperCase().padStart(8, "0")}</span>{" "}
            <span className="text-white/25">//</span> T{String(hud.tick).padStart(4, "0")} <span className="text-white/25">//</span> {hud.eventCount} trades{" "}
            <span className="text-white/25">//</span> {hud.behind > 4 ? <span className="text-signal">syncing {hud.behind}</span> : "in sync"}
            {hud.rollbacks > 0 && <> <span className="text-white/25">//</span> {hud.rollbacks} rollback</>}
          </div>
        </div>

        {/* feed */}
        <div className="pointer-events-auto order-3 hidden justify-self-end lg:block lg:w-[360px]">
          <div className="border border-white/[0.08] bg-carbon/75 backdrop-blur-md">
            <button
              type="button"
              onClick={() => setShowFeed((v) => !v)}
              className="flex w-full items-center justify-between border-b border-white/[0.06] px-3 py-2"
            >
              <span className="label flex items-center gap-2">
                <span className="text-lime/80">F</span>
                <span className="text-white/20">//</span>
                <span className="text-foreground/80">Live reinforcement feed</span>
              </span>
              <span className="label">{showFeed ? "Hide" : "Show"}</span>
            </button>
            {showFeed && (
              <ul className="max-h-[260px] overflow-hidden">
                {hud.feed.length === 0 && <li className="px-3 py-3 font-mono text-[11px] text-muted-foreground">No trades yet. First buyer gets the glory.</li>}
                {hud.feed.map((e) => (
                  <FeedItem key={e.id} e={e} sides={b.sides} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {banner && <ReinforceBanner banner={banner} side={b.sides[banner.side]} />}

      {/* end card */}
      {hud.done && hud.mode !== "replay" && clientWinner !== null && (
        <div className="pointer-events-auto absolute left-1/2 top-[38%] z-30 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 border border-lime/40 bg-carbon/90 p-5 text-center shadow-[0_0_60px_rgba(198,255,61,0.18)] backdrop-blur-md brackets brackets-lime">
          <div className="label text-lime/80">Battle concluded</div>
          <div className="mt-2 font-display text-[30px] font-black uppercase leading-none tracking-[0.1em]" style={{ color: b.sides[clientWinner].color }}>
            {b.sides[clientWinner].name}
          </div>
          <div className="mt-1 font-display text-sm uppercase tracking-[0.3em] text-foreground/70">holds the field</div>
          <div className="mt-4 flex justify-center gap-6 font-mono text-sm tabular">
            <span style={{ color: b.sides[0].color }}>{hud.counts[0]}</span>
            <span className="text-white/30">vs</span>
            <span style={{ color: b.sides[1].color }}>{hud.counts[1]}</span>
          </div>
          <div className="mt-4 inline-flex items-center gap-1.5 border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.14em]">
            {verified === "match" ? (
              <span className="inline-flex items-center gap-1.5 text-lime">
                <Check className="h-3 w-3" /> Matches official server sim
              </span>
            ) : verified === "mismatch" ? (
              <span className="text-signal">Late trades changed the official result</span>
            ) : (
              <span className="text-muted-foreground">Awaiting official settlement</span>
            )}
          </div>
          <div className="mt-5 flex justify-center gap-2">
            <Button size="sm" onClick={() => ctrl.startReplay(0)}>
              <RotateCcw /> Replay
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/">Back to theater</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
