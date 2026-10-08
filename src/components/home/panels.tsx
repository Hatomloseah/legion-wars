"use client";

import Link from "next/link";
import { useMemo } from "react";
import { LiveDot, Meter, PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { shortAddr, formatSol } from "@/lib/game/drones";
import { HEXES, hexCode } from "@/lib/game/hexmap";
import { BATTLE_MS, ROUND_MS, fmtClock } from "@/lib/game/schedule";
import type { BattleSummary, FeedEvent, GameState, PublicSwarm } from "@/lib/game/types";
import { ABILITY_INFO } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ round clock
export function RoundPanel({ state, now }: { state: GameState; now: number }) {
  const r = state.round;
  const live = r.phase === "battle";
  const remaining = live ? r.battleEndsAt - now : r.endsAt - now;
  const elapsed = Math.max(0, Math.min(ROUND_MS, now - r.startsAt));
  const battlePct = Math.min(1, elapsed / BATTLE_MS);
  const breakPct = Math.max(0, Math.min(1, (elapsed - BATTLE_MS) / (ROUND_MS - BATTLE_MS)));

  return (
    <div className="panel brackets">
      <PanelHeader
        code="R"
        title={`Round ${String(r.index).slice(-4)}`}
        right={
          <span className={cn("label flex items-center gap-2 whitespace-nowrap", live ? "text-signal" : "text-lime")}>
            {live ? <LiveDot /> : <span className="h-1.5 w-1.5 bg-lime blink" />}
            {live ? "Live" : "Break"}
          </span>
        }
      />
      <div className="px-4 pb-4 pt-3">
        <div className="label">{live ? "Battle ends in" : "Next battle in"}</div>
        <div className={cn("mt-1 font-mono text-[52px] leading-none tabular tracking-tight sm:text-[60px]", live ? "text-signal text-glow-red" : "text-lime text-glow")}>
          {fmtClock(remaining)}
        </div>
        <div className="mt-4 flex h-2 gap-1">
          <div className="relative w-[30%] overflow-hidden bg-white/[0.06]">
            <div className="absolute inset-y-0 left-0 bg-signal transition-[width] duration-500" style={{ width: `${battlePct * 100}%` }} />
          </div>
          <div className="relative flex-1 overflow-hidden bg-white/[0.06]">
            <div className="absolute inset-y-0 left-0 bg-lime/70 transition-[width] duration-500" style={{ width: `${breakPct * 100}%` }} />
          </div>
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>3:00 battle</span>
          <span>7:00 results + matchups</span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ prize
export function PrizePanel({ state, now }: { state: GameState; now: number }) {
  const leader = state.swarms.find((s) => s.id === state.prize.leaderId);
  const surge = state.prize.surge;
  const surgeOn = !!surge && surge.maxSol > 0;
  const surging = surgeOn && surge.potentialSol > 0;
  return (
    <div className="panel brackets overflow-hidden">
      <PanelHeader code="P" title="Hourly prize" right={<span className="label tabular text-foreground/70">{fmtClock(state.prize.hourEndsAt - now)}</span>} />
      <div className="relative px-4 pb-4 pt-3">
        <div className="pointer-events-none absolute -right-6 -top-4 h-28 w-28 hazard opacity-40" />
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[40px] leading-none text-foreground tabular">{state.prize.hourlySol.toFixed(2)}</span>
          <span className="font-display text-sm tracking-[0.2em] text-lime">SOL</span>
          {surging && (
            <span className="whitespace-nowrap font-mono text-lg leading-none text-lime text-glow tabular">
              +{surge.potentialSol.toFixed(2)}
              <span className="ml-1 font-display text-[10px] uppercase tracking-[0.16em]">max surge</span>
            </span>
          )}
        </div>
        <div className="mt-1 text-[13px] text-muted-foreground">Most territory when the hour closes takes it.</div>
        {surgeOn && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("label flex shrink-0 items-center gap-2 whitespace-nowrap tracking-[0.12em]", surging && "text-lime")}>
                <span className={cn("h-1.5 w-1.5", surging ? "bg-lime blink" : "bg-white/20")} />
                Surge bonus
              </span>
              <span className="min-w-0 truncate font-mono text-xs text-foreground/80 tabular">
                <span className={surging ? "text-lime" : undefined}>+{surge.potentialSol.toFixed(2)}</span>
                <span className="text-muted-foreground"> / {surge.maxSol.toFixed(2)}</span>
              </span>
            </div>
            <Meter value={surge.potentialSol / surge.maxSol} color="#C6FF3D" segments={20} className="mt-2 h-1.5" />
            <div className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {surge.launches} {surge.launches === 1 ? "launch" : "launches"} / {surge.buyers} {surge.buyers === 1 ? "reinforcer" : "reinforcers"} this hour. Rolled at close.
            </div>
          </div>
        )}
        {leader && (
          <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3">
            <span className="label shrink-0 tracking-[0.12em]">Lead</span>
            <SwarmDot color={leader.color} />
            <span className="min-w-0 truncate font-display text-sm font-semibold tracking-wide" style={{ color: leader.color }}>
              {leader.name}
            </span>
            <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-xs text-foreground/80 tabular">{leader.territory} hex</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ ticker
function feedLine(e: FeedEvent) {
  const buy = e.kind === "buy";
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap px-5 font-mono text-[12px] uppercase tracking-[0.08em]">
      <span className={buy ? "text-lime" : "text-signal"}>{buy ? `+${e.drones}` : `-${e.drones}`} drones</span>
      <SwarmDot color={e.color} size={7} />
      <span style={{ color: e.color }}>{e.ticker}</span>
      <span className="text-white/35 normal-case">
        ({shortAddr(e.wallet)} {buy ? "bought" : "sold"} {formatSol(e.sol)} SOL)
      </span>
      <span className="pl-3 text-white/15">///</span>
    </span>
  );
}

export function ReinforcementTicker({ feed }: { feed: FeedEvent[] }) {
  const items = feed.slice(0, 24);
  return (
    <div className="relative flex h-10 items-center overflow-hidden border-y border-white/[0.06] bg-[#090c0b]">
      <div className="z-10 flex h-full shrink-0 items-center gap-2 bg-lime px-3 font-display text-[11px] font-bold uppercase tracking-[0.18em] text-carbon">
        <span className="h-1.5 w-1.5 bg-carbon blink" />
        Reinforcements
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-[150px] z-10 w-12 bg-gradient-to-r from-[#090c0b] to-transparent" />
      {items.length ? (
        <div className="marquee flex shrink-0">
          {items.map((e) => (
            <span key={`a-${e.battleId}-${e.id}`}>{feedLine(e)}</span>
          ))}
          {items.map((e) => (
            <span key={`b-${e.battleId}-${e.id}`}>{feedLine(e)}</span>
          ))}
        </div>
      ) : (
        <span className="px-5 font-mono text-[12px] uppercase tracking-[0.1em] text-muted-foreground">Waiting for the first buy of the round...</span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ top swarms
export function TopSwarms({ swarms }: { swarms: PublicSwarm[] }) {
  const sorted = useMemo(() => [...swarms].sort((a, b) => b.territory - a.territory || b.wins - a.wins), [swarms]);
  const max = Math.max(1, ...sorted.map((s) => s.territory));
  return (
    <div className="panel brackets">
      <PanelHeader code="T" title="Top legions by territory" right={<span className="label">{HEXES.length} sectors</span>} />
      <ol className="divide-y divide-white/[0.05]">
        {sorted.map((s, i) => (
          <li key={s.id} className="group grid grid-cols-[22px_1fr_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.02]">
            <span className="font-mono text-[11px] text-muted-foreground tabular">{String(i + 1).padStart(2, "0")}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <SwarmDot color={s.color} />
                <Link href={`/legion/${s.id}`} className="truncate font-display text-[13px] font-semibold tracking-wide hover:text-lime">
                  {s.name}
                </Link>
                <span className="font-mono text-[10px] tracking-[0.12em]" style={{ color: s.color }}>
                  ${s.ticker}
                </span>
              </div>
              <div className="mt-1.5 h-1 bg-white/[0.05]">
                <div className="h-full transition-[width] duration-700" style={{ width: `${(s.territory / max) * 100}%`, background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[15px] leading-none tabular">{s.territory}</div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground tabular">
                {s.wins}W-{s.losses}L
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ battle list
export function BattleRow({ b, active, onSelect, now }: { b: BattleSummary; active?: boolean; onSelect?: () => void; now: number }) {
  const [A, B] = b.sides;
  const live = b.phase === "live";
  const winner = b.result?.winner;
  return (
    <div
      className={cn(
        "group relative flex items-center gap-2 border-l-2 px-3 py-2.5 transition-colors",
        active ? "border-l-lime bg-lime/[0.05]" : "border-l-transparent hover:bg-white/[0.025]",
      )}
    >
      <button type="button" onClick={onSelect} className="absolute inset-0" aria-label={`Select battle ${A.ticker} vs ${B.ticker}`} />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cn("truncate font-mono text-[12px] tracking-[0.06em]", winner === 1 && "opacity-40")} style={{ color: A.color }}>
          {A.ticker}
        </span>
        <span className="font-display text-[10px] text-white/30">VS</span>
        <span className={cn("truncate font-mono text-[12px] tracking-[0.06em]", winner === 0 && "opacity-40")} style={{ color: B.color }}>
          {B.ticker}
        </span>
      </div>
      <span className="font-mono text-[10px] text-muted-foreground tabular">
        +{A.reinforcements + B.reinforcements}
      </span>
      <span className="w-[64px] text-right font-mono text-[10px] uppercase tracking-[0.12em]">
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-signal">
            <LiveDot /> {fmtClock(b.endsAt - now)}
          </span>
        ) : b.result ? (
          <span className="text-lime">{b.sides[b.result.winner].ticker}</span>
        ) : b.phase === "upcoming" ? (
          <span className="text-muted-foreground">{fmtClock(b.startsAt - now)}</span>
        ) : (
          <span className="text-muted-foreground">settling</span>
        )}
      </span>
      <Link
        href={`/battle/${b.id}`}
        className="relative z-10 font-display text-[10px] uppercase tracking-[0.14em] text-white/40 transition-colors hover:text-lime"
      >
        Open
      </Link>
    </div>
  );
}

export function MatchupsPanel({ state, now }: { state: GameState; now: number }) {
  const live = state.round.phase === "battle";
  const results = live ? state.lastBattles : state.battles;
  const upcoming = live ? [] : state.nextBattles;
  return (
    <div className="panel brackets">
      <PanelHeader code="M" title={live ? "Last round" : "Results + next matchups"} />
      <div className="divide-y divide-white/[0.05]">
        {results.map((b) => {
          const w = b.result ? b.sides[b.result.winner] : null;
          const l = b.result ? b.sides[1 - b.result.winner] : null;
          return (
            <Link key={b.id} href={`/battle/${b.id}`} className="flex items-center gap-2 px-3 py-2.5 text-[13px] transition-colors hover:bg-white/[0.025]">
              {w && l ? (
                <>
                  <SwarmDot color={w.color} />
                  <span className="font-display font-semibold tracking-wide" style={{ color: w.color }}>
                    {w.ticker}
                  </span>
                  <span className="text-muted-foreground">beat</span>
                  <span className="font-display tracking-wide text-foreground/60">{l.ticker}</span>
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-lime">
                    {b.result && b.result.capturedHex >= 0 ? `took ${hexCode(b.result.capturedHex)}` : "held"}
                  </span>
                </>
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                  {b.sides[0].ticker} vs {b.sides[1].ticker} <span className="blink">settling...</span>
                </span>
              )}
            </Link>
          );
        })}
        {upcoming.length > 0 && <div className="label bg-white/[0.02] px-3 py-1.5 text-lime/80">Next up</div>}
        {upcoming.map((b) => (
          <BattleRow key={b.id} b={b} now={now} />
        ))}
        {results.length === 0 && upcoming.length === 0 && <div className="px-3 py-4 text-sm text-muted-foreground">No results yet.</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ telemetry
export function TelemetryPanel({ state }: { state: GameState }) {
  const lines = useMemo(() => {
    const out: string[] = [];
    for (const s of state.swarms) {
      const c = s.config;
      out.push(`${s.ticker.padEnd(6)} COH ${String(c.cohesion).padStart(3)} SEP ${String(c.separation).padStart(3)} AGR ${String(c.aggression).padStart(3)} FLK ${String(c.flank).padStart(3)}`);
      out.push(`${s.ticker.padEnd(6)} TGT ${c.targetPriority.toUpperCase().padEnd(8)} FRM ${c.formation.toUpperCase().padEnd(6)} ABL ${ABILITY_INFO[s.ability].short}`);
    }
    for (const b of [...state.battles, ...state.lastBattles]) {
      out.push(`BTL ${b.id} ${b.sides[0].ticker}/${b.sides[1].ticker} BASE ${b.sides[0].baseDrones}/${b.sides[1].baseDrones} +${b.sides[0].reinforcements}/${b.sides[1].reinforcements}`);
    }
    out.push(`LOCKSTEP 10HZ // FIXED-POINT Q10 // LUT-TRIG 1024 // PRNG MULBERRY32`);
    out.push(`SEASON ${state.season} // ROUND ${state.round.index} // ${state.demo ? "DEMO FEED" : "HELIUS FEED"}`);
    return out;
  }, [state]);
  return (
    <div className="panel brackets overflow-hidden">
      <PanelHeader code="X" title="Telemetry" right={<span className="label text-lime/70">RX</span>} />
      <div className="relative h-[244px] overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-[#0b0e0d] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-[#0b0e0d] to-transparent" />
        <div className="telemetry-scroll px-3 py-2 font-mono text-[10.5px] leading-[18px] text-muted-foreground">
          {[...lines, ...lines].map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: duplicated scrolling list
            <div key={i} className="whitespace-pre">
              <span className="text-lime/50">{String(i % lines.length).padStart(3, "0")}</span> {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
