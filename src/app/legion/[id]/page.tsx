"use client";

import { ExternalLink, Swords } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { CopyText } from "@/components/hud/CopyText";
import { DoctrineBars } from "@/components/hud/DoctrineBars";
import { DroneGlyph } from "@/components/hud/DroneGlyph";
import { LiveDot, PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { TerritoryMap } from "@/components/legion/TerritoryMap";
import { PageShell } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useJson } from "@/lib/client/useJson";
import { useServerNow } from "@/lib/client/useGameState";
import { formatSol } from "@/lib/game/drones";
import { hexCode } from "@/lib/game/hexmap";
import { fmtClock } from "@/lib/game/schedule";
import type { BattleSummary, PublicSwarm, SwarmDetail } from "@/lib/game/types";
import { ABILITY_INFO } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

const SOURCE: Record<string, string> = { llm: "AI tactics", heuristic: "Keyword tactics", house: "House doctrine" };

function when(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function BattleCard({ b, sw, now, label }: { b: BattleSummary; sw: PublicSwarm; now: number; label: string }) {
  const me = b.sides.findIndex((s) => s.swarmId === sw.id);
  const foe = b.sides[1 - me];
  const live = b.phase === "live";
  return (
    <Link href={`/battle/${b.id}`} className="group block border border-white/[0.07] bg-white/[0.015] p-3 transition-colors hover:border-lime/40">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className={cn("inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]", live ? "text-signal" : "text-muted-foreground")}>
          {live && <LiveDot />}
          {live ? `Live ${fmtClock(b.endsAt - now)}` : b.result ? (b.result.winner === me ? "Won" : "Lost") : b.phase === "upcoming" ? `In ${fmtClock(b.startsAt - now)}` : "Settling"}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground">vs</span>
        <SwarmDot color={foe.color} />
        <span className="font-display text-[15px] font-bold uppercase tracking-[0.08em]" style={{ color: foe.color }}>
          {foe.name}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        <span>
          {b.sides[me].baseDrones} vs {foe.baseDrones} base // +{b.sides[me].reinforcements} reinf
        </span>
        <span className="inline-flex items-center gap-1 text-foreground/70 group-hover:text-lime">
          <Swords className="h-3 w-3" /> Watch
        </span>
      </div>
    </Link>
  );
}

export default function LegionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, notFound, offset } = useJson<SwarmDetail>(`/api/legions/${encodeURIComponent(id)}`, 20000);
  const now = useServerNow(offset, 1000);

  if (!data) {
    return (
      <PageShell>
        <div className="grid min-h-[50vh] place-items-center text-center">
          {notFound ? (
            <div>
              <div className="label text-signal">Legion not found</div>
              <p className="mt-3 text-muted-foreground">No legion goes by "{decodeURIComponent(id)}".</p>
              <Button asChild variant="outline" className="mt-5">
                <Link href="/leaderboard">See all legions</Link>
              </Button>
            </div>
          ) : (
            <span className="label blink text-lime">{error ? `Link lost: ${error}` : "Acquiring legion dossier"}</span>
          )}
        </div>
      </PageShell>
    );
  }

  const s = data.swarm;
  const real = !s.demo;
  const garrison = s.house && s.demo;
  const winRate = s.wins + s.losses > 0 ? Math.round((s.wins / (s.wins + s.losses)) * 100) : null;
  const byId = new Map(data.swarms.map((x) => [x.id, x]));

  return (
    <PageShell>
      {/* hero */}
      <section className="relative -mx-3 overflow-hidden border-b border-white/[0.06] px-3 py-8 sm:-mx-5 sm:px-5 sm:py-10">
        <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 15% 0%, ${s.color}26, transparent 60%)` }} />
        <div className="rise-in relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-5">
            <div className="grid h-24 w-24 shrink-0 place-items-center border border-white/10 bg-carbon/70 sm:h-28 sm:w-28" style={{ boxShadow: `0 0 50px ${s.color}33` }}>
              {s.image ? <img src={s.image} alt="" className="h-full w-full object-cover" /> : <DroneGlyph design={s.design} color={s.color} className="h-20 w-20" />}
            </div>
            <div className="min-w-0">
              <div className="label flex flex-wrap items-center gap-2">
                <span className="text-lime">Rank #{data.rank}</span>
                <span className="text-white/20">//</span>
                <span style={{ color: s.color }}>${s.ticker}</span>
              </div>
              <h1 className="mt-2 font-display text-[32px] font-black uppercase leading-[0.95] tracking-[0.03em] sm:text-[48px]" style={{ textShadow: `0 0 30px ${s.color}44` }}>
                {s.name}
              </h1>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.flagship && <Badge variant="solid">Flagship // $LEGION</Badge>}
                {garrison && <Badge variant="secondary">House garrison</Badge>}
                <Badge variant="outline">{SOURCE[s.configSource] ?? s.configSource}</Badge>
                {s.demo && !s.house && <Badge variant="secondary">Simulated coin</Badge>}
              </div>
              {s.description && <p className="mt-3 max-w-[620px] text-[15px] leading-relaxed text-muted-foreground">{s.description}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            {real ? (
              <>
                <a
                  href={`https://pump.fun/coin/${s.mint}`}
                  target="_blank"
                  rel="noreferrer"
                  className="chamfer-sm inline-flex h-12 items-center gap-2 px-6 font-display text-[13px] font-bold uppercase tracking-[0.14em] text-carbon transition-shadow hover:shadow-[0_0_28px_currentColor]"
                  style={{ background: s.color }}
                >
                  Buy ${s.ticker} on pump.fun <ExternalLink className="h-4 w-4" />
                </a>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Every buy during a battle drops drones into the fight</span>
              </>
            ) : (
              <div className="max-w-[300px] border border-white/10 bg-white/[0.02] px-4 py-3 text-[13px] text-muted-foreground">
                {garrison ? "House garrison. AI-run, no tradable coin. It fights on base drones only." : "Simulated coin. No real pump.fun market."}
              </div>
            )}
          </div>
        </div>

        {/* stat strip */}
        <div className="rise-in relative mt-7 grid grid-cols-2 gap-px border border-white/[0.07] bg-white/[0.07] sm:grid-cols-3 lg:grid-cols-6" style={{ animationDelay: "80ms" }}>
          {[
            ["Territory", `${s.territory}`, "sectors"],
            ["Season", `${s.wins}-${s.losses}`, winRate !== null ? `${winRate}% win` : "no battles"],
            ["All-time", `${s.allWins}-${s.allLosses}`, "W-L"],
            ["Market cap", formatSol(s.mcapSol), "SOL"],
            ["Base drones", `${s.baseDrones}`, "at battle start"],
            ["Prizes", `${s.prizesWon}`, `${formatSol(s.prizeSol)} SOL won`],
          ].map(([k, v, sub]) => (
            <div key={k} className="bg-[#0b0e0d] px-4 py-3">
              <div className="label">{k}</div>
              <div className="mt-1 font-mono text-[24px] leading-none tabular">{v}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-12">
        {/* territory */}
        <section className="panel brackets rise-in overflow-hidden lg:col-span-7" style={{ animationDelay: "120ms" }}>
          <PanelHeader code="T" title="Territory" right={<span className="label">{data.hexes.length} sectors</span>} />
          <div className="p-3">
            <TerritoryMap owners={data.owners} swarms={data.swarms} focusId={s.id} homeHex={s.homeHex} className="h-auto w-full" />
            <div className="mt-3 flex flex-wrap gap-1">
              {data.hexes
                .slice()
                .sort((a, b) => a - b)
                .map((h) => (
                  <span
                    key={h}
                    className={cn("border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em]", h === s.homeHex ? "border-white/60 text-foreground" : "border-white/10 text-muted-foreground")}
                  >
                    {hexCode(h)}
                    {h === s.homeHex && " HQ"}
                  </span>
                ))}
            </div>
          </div>
        </section>

        {/* battles + identity */}
        <div className="grid content-start gap-5 lg:col-span-5">
          <section className="panel brackets rise-in" style={{ animationDelay: "160ms" }}>
            <PanelHeader code="B" title="Battles" />
            <div className="grid gap-2 p-3">
              {data.current && <BattleCard b={data.current} sw={s} now={now} label="This round" />}
              {data.next && <BattleCard b={data.next} sw={s} now={now} label="Next round" />}
              {!data.current && !data.next && <p className="px-1 py-2 text-sm text-muted-foreground">No battle scheduled right now. Matchups are drawn every 10 minutes.</p>}
            </div>
          </section>
          <section className="panel brackets rise-in" style={{ animationDelay: "200ms" }}>
            <PanelHeader code="I" title="Identity" />
            <dl className="grid gap-px bg-white/[0.05] text-[12px]">
              {[
                [
                  "Creator",
                  s.creator === "HOUSE" ? (
                    <span key="c" className="font-mono text-foreground/80">House</span>
                  ) : (
                    <a key="c" href={`https://solscan.io/account/${s.creator}`} target="_blank" rel="noreferrer" className="font-mono text-foreground/80 hover:text-lime">
                      {s.creator.slice(0, 4)}…{s.creator.slice(-4)}
                    </a>
                  ),
                ],
                ["Mint", <CopyText key="m" value={s.mint} display={`${s.mint.slice(0, 6)}…${s.mint.slice(-6)}`} />],
                ["Home sector", <span key="h" className="font-mono">{hexCode(s.homeHex)}</span>],
                ["Launched", <span key="l" className="font-mono">{new Date(s.createdAt).toLocaleDateString()}</span>],
                ...(real
                  ? [
                      [
                        "Explorer",
                        <a key="e" href={`https://solscan.io/token/${s.mint}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-lime">
                          Solscan <ExternalLink className="h-3 w-3" />
                        </a>,
                      ],
                    ]
                  : []),
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-3 bg-[#0b0e0d] px-3 py-2">
                  <dt className="label">{k}</dt>
                  <dd className="min-w-0 truncate text-right">{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        {/* doctrine */}
        <section className="panel brackets rise-in lg:col-span-12" style={{ animationDelay: "240ms" }}>
          <PanelHeader code="D" title="Doctrine" right={<span className="label">{SOURCE[s.configSource] ?? s.configSource}</span>} />
          <div className="grid gap-6 p-4 md:grid-cols-[1fr_1.2fr]">
            <div>
              <blockquote className="border-l-2 pl-4 text-[16px] leading-relaxed text-foreground/90" style={{ borderColor: s.color }}>
                {s.tactics || "No tactics on record."}
              </blockquote>
              <div className="mt-3 flex items-center gap-2">
                <span className="label">Tactics hash</span>
                <CopyText value={s.tacticsHash} display={`${s.tacticsHash.slice(0, 16)}…`} />
              </div>
              <div className="mt-4 border border-white/[0.07] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-lime">{ABILITY_INFO[s.ability].name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{ABILITY_INFO[s.ability].cooldownS}s cooldown</span>
                </div>
                <p className="mt-1 text-[13px] text-muted-foreground">{ABILITY_INFO[s.ability].desc}</p>
              </div>
            </div>
            <DoctrineBars config={s.config} color={s.color} />
          </div>
        </section>

        {/* history */}
        <section className="panel brackets rise-in overflow-hidden lg:col-span-8" style={{ animationDelay: "280ms" }}>
          <PanelHeader code="H" title="Battle history" right={<span className="label">{data.history.length} recent</span>} />
          {data.history.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No settled battles yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[12px]">
                <thead>
                  <tr className="label border-b border-white/[0.06]">
                    <th className="px-3 py-2 font-normal">When</th>
                    <th className="px-3 py-2 font-normal">Opponent</th>
                    <th className="px-3 py-2 font-normal">Result</th>
                    <th className="px-3 py-2 text-right font-normal">Alive</th>
                    <th className="px-3 py-2 text-right font-normal">Reinf</th>
                    <th className="px-3 py-2 font-normal">Sector</th>
                    <th className="px-3 py-2 text-right font-normal" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {data.history.map((h) => {
                    const me = h.sides[0].swarmId === s.id ? 0 : 1;
                    const foe = h.sides[1 - me];
                    const won = h.winner === me;
                    const foeLive = byId.get(foe.swarmId);
                    return (
                      <tr key={h.id} className="hover:bg-white/[0.015]">
                        <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">{when(h.startsAt)}</td>
                        <td className="px-3 py-2">
                          {foeLive ? (
                            <Link href={`/legion/${foe.swarmId}`} className="inline-flex items-center gap-1.5 hover:underline">
                              <SwarmDot color={foe.color} size={7} />
                              <span className="font-display text-[12px] uppercase tracking-[0.08em]" style={{ color: foe.color }}>
                                {foe.ticker}
                              </span>
                            </Link>
                          ) : (
                            <span className="font-display text-[12px] uppercase tracking-[0.08em] text-muted-foreground">{foe.ticker}</span>
                          )}
                        </td>
                        <td className={cn("px-3 py-2 font-display text-[12px] font-bold uppercase tracking-[0.14em]", won ? "text-lime" : "text-signal")}>{won ? "Win" : "Loss"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular">
                          {h.sides[me].alive}
                          <span className="text-white/30"> / {foe.alive}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular">+{h.sides[me].reinforcements}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{won && h.capturedHex >= 0 ? hexCode(h.capturedHex) : "--"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right font-display text-[10px] uppercase tracking-[0.14em]">
                          <Link href={`/battle/${h.id}`} className="text-muted-foreground hover:text-lime">
                            Replay
                          </Link>
                          <span className="px-1.5 text-white/20">/</span>
                          <Link href={`/proof/${h.id}`} className="text-muted-foreground hover:text-lime">
                            Proof
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* prizes */}
        <section className="panel brackets rise-in lg:col-span-4" style={{ animationDelay: "320ms" }}>
          <PanelHeader code="P" title="Hourly prizes won" />
          {data.prizes.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No prizes yet. Hold the most sectors when an hour closes to take one.</p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {data.prizes.map((p) => (
                <li key={p.hour} className="flex items-center justify-between px-3 py-2.5">
                  <span className="font-mono text-[11px] text-muted-foreground">{when(p.endsAt)}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{p.territory} hex</span>
                  <span className="font-mono text-[13px] tabular text-lime">{p.amountSol.toFixed(3)} SOL</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
