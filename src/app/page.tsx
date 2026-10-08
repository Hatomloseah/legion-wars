"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FeaturedBattle } from "@/components/home/FeaturedBattle";
import { MatchupsPanel, PrizePanel, ReinforcementTicker, RoundPanel, TelemetryPanel, TopSwarms } from "@/components/home/panels";
import { PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { WorldMap } from "@/components/map/WorldMap";
import { SiteFooter } from "@/components/PageShell";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { useGameState, useServerNow } from "@/lib/client/useGameState";
import { HEXES } from "@/lib/game/hexmap";

export default function Home() {
  const { state, offset, error } = useGameState();
  const now = useServerNow(offset, 500);
  const [selected, setSelected] = useState<string | null>(null);

  const live = state?.round.phase === "battle";
  const mapBattles = useMemo(() => (state ? (live ? state.battles : state.nextBattles) : []), [state, live]);
  const captured = useMemo(() => (state ? (live ? state.lastBattles : state.battles) : []), [state, live]);
  const listBattles = useMemo(() => (state ? (live ? state.battles : [...state.battles, ...state.nextBattles]) : []), [state, live]);
  const known = listBattles.some((b) => b.id === selected) || mapBattles.some((b) => b.id === selected);
  const featured = (known ? selected : null) ?? state?.featuredId ?? null;
  const claimed = state ? state.owners.filter(Boolean).length : 0;

  return (
    <div className="relative min-h-screen bg-carbon">
      <div className="pointer-events-none fixed inset-0 hud-grid opacity-50" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_top,rgba(198,255,61,0.07),transparent_60%)]" />
      <SiteHeader state={state} now={now} />

      <main className="relative mx-auto max-w-[1600px] px-3 sm:px-5">
        {/* hero */}
        <section className="grid gap-4 py-6 lg:grid-cols-12 lg:py-8">
          <div className="rise-in lg:col-span-6">
            <div className="label flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-lime">Solana</span>
              <span className="text-white/20">//</span>
              <span>Drone legion warfare</span>
              <span className="text-white/20">//</span>
              <span>Season {state?.season ?? "----"}</span>
            </div>
            <h1 className="mt-3 font-display text-[34px] font-black uppercase leading-[0.95] tracking-[0.02em] sm:text-[48px] xl:text-[60px]">
              Every coin is a <span className="text-lime text-glow">legion.</span>
              <br />
              Every buy is a <span className="relative inline-block text-lime text-glow">reinforcement.</span>
            </h1>
            <p className="mt-4 max-w-[560px] text-[15px] leading-relaxed text-muted-foreground">
              Each legion is its own pump.fun coin. Every 10 minutes legions clash over border sectors in a live 3-minute battle. Buying launches drones into the
              fight in real time. Selling blows them up. The legion holding the most territory when the hour closes takes the SOL prize.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button asChild size="lg">
                <Link href="/battle/live">{live ? "Enter live battle" : "Watch last battle"}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/create">Raise a legion</Link>
              </Button>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <span>
                <span className="text-foreground tabular">{state?.swarms.length ?? "--"}</span> legions
              </span>
              <span>
                <span className="text-foreground tabular">
                  {claimed}/{HEXES.length}
                </span>{" "}
                sectors held
              </span>
              <span>
                <span className="text-foreground tabular">{state?.battles.length ?? "--"}</span> battles this round
              </span>
              <span>
                <span className="text-lime">20 x sqrt(SOL)</span> drones per buy
              </span>
            </div>
          </div>
          <div className="rise-in lg:col-span-3" style={{ animationDelay: "80ms" }}>
            {state ? <RoundPanel state={state} now={now} /> : <div className="panel h-[188px] animate-pulse" />}
          </div>
          <div className="rise-in lg:col-span-3" style={{ animationDelay: "160ms" }}>
            {state ? <PrizePanel state={state} now={now} /> : <div className="panel h-[188px] animate-pulse" />}
          </div>
        </section>

        {/* theater */}
        <section className="grid gap-4 lg:grid-cols-12">
          <div className="panel brackets rise-in overflow-hidden lg:col-span-8" style={{ animationDelay: "220ms" }}>
            <PanelHeader
              code="W"
              title="World theater"
              right={
                <div className="hidden items-center gap-3 sm:flex">
                  {state?.swarms.map((s) => (
                    <span key={s.id} className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em]" style={{ color: s.color }}>
                      <SwarmDot color={s.color} size={6} />
                      {s.ticker}
                    </span>
                  ))}
                </div>
              }
            />
            {state ? (
              <WorldMap
                owners={state.owners}
                swarms={state.swarms}
                battles={mapBattles}
                lastBattles={captured}
                selectedBattle={featured}
                onSelectBattle={setSelected}
                className="h-[300px] sm:h-[440px] lg:h-[560px]"
              />
            ) : (
              <div className="grid h-[300px] place-items-center sm:h-[440px] lg:h-[560px]">
                <span className="label blink text-lime/80">{error ? `Link lost: ${error}` : "Acquiring theater"}</span>
              </div>
            )}
          </div>
          <div className="rise-in lg:col-span-4" style={{ animationDelay: "280ms" }}>
            <FeaturedBattle battleId={featured} battles={listBattles} onSelect={setSelected} now={now} />
          </div>
        </section>
      </main>

      <div className="relative mt-6">{state && <ReinforcementTicker feed={state.feed} />}</div>

      <main className="relative mx-auto max-w-[1600px] px-3 pb-10 pt-6 sm:px-5">
        {state && (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <TopSwarms swarms={state.swarms} />
            <MatchupsPanel state={state} now={now} />
            <TelemetryPanel state={state} />
          </section>
        )}
        <section className="mt-6 grid gap-px overflow-hidden border border-white/[0.06] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["01", "Raise a legion", "Name, color, drone design and tactics in plain English. It launches as its own pump.fun coin."],
            ["02", "AI compiles tactics", "An LLM turns your words into a validated behavior config: cohesion, flanking, focus fire, formation."],
            ["03", "Trade = fight", "Every buy streams 20 x sqrt(SOL) drones into the live battle. Every sell detonates drones. Capped at 150 per wallet."],
            ["04", "Hold the map", "Winners capture sectors. Most territory each hour wins the SOL prize. The map resets every Sunday."],
          ].map(([n, t, d]) => (
            <div key={n} className="bg-carbon p-4">
              <div className="font-mono text-[11px] text-lime">{n}</div>
              <div className="mt-2 font-display text-[15px] font-bold uppercase tracking-[0.08em]">{t}</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </section>
      </main>

      <SiteFooter />
      <div className="grain" />
    </div>
  );
}
