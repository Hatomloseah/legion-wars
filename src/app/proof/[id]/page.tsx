"use client";

import { Check, Download, Play, X } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { CopyText, hex8 } from "@/components/hud/CopyText";
import { DoctrineBars } from "@/components/hud/DoctrineBars";
import { PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { PageShell, PageTitle } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { simInputFor } from "@/lib/client/lockstep";
import { useJson } from "@/lib/client/useJson";
import { hexCode } from "@/lib/game/hexmap";
import { fmtClock } from "@/lib/game/schedule";
import { cleanTactics } from "@/lib/game/tactics";
import type { BattleProof } from "@/lib/game/types";
import { BATTLE_TICKS, BattleSim, TICK_MS } from "@/lib/sim/engine";
import { ABILITY_INFO, compareEvents } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

interface Verdict {
  ms: number;
  winner: number;
  alive: [number, number];
  checksum: number;
  hashes: (boolean | null)[];
  hashNote: string | null;
}

async function sha256Hex(s: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export default function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, notFound } = useJson<BattleProof>(`/api/proof/${encodeURIComponent(id)}`);
  const [progress, setProgress] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const verify = async () => {
    if (!data) return;
    setVerdict(null);
    setProgress(0);
    const t0 = performance.now();
    const events = data.events.filter((e) => e.tick >= 0 && e.tick < BATTLE_TICKS).sort(compareEvents);
    const sim = new BattleSim(simInputFor(data.battle));
    let p = 0;
    const batch: typeof events = [];
    while (sim.tick < BATTLE_TICKS) {
      const until = Math.min(BATTLE_TICKS, sim.tick + 60);
      while (sim.tick < until) {
        batch.length = 0;
        while (p < events.length && events[p].tick <= sim.tick) {
          if (events[p].tick === sim.tick) batch.push(events[p]);
          p++;
        }
        sim.step(batch);
      }
      setProgress(sim.tick / BATTLE_TICKS);
      await new Promise((r) => setTimeout(r, 0));
    }
    const res = sim.result();
    const hashes: (boolean | null)[] = [];
    let hashNote: string | null = null;
    for (let i = 0; i < 2; i++) {
      const want = data.battle.sides[i].tacticsHash;
      if (!want || !data.tactics[i]) {
        hashes.push(null);
        continue;
      }
      const got = await sha256Hex(cleanTactics(data.tactics[i]));
      if (got === null) {
        hashNote = "Tactics hash check needs a secure (https) context";
        hashes.push(null);
      } else hashes.push(got === want);
    }
    setVerdict({ ms: performance.now() - t0, winner: res.winner, alive: res.alive, checksum: sim.checksum(), hashes, hashNote });
    setProgress(null);
  };

  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `legion-battle-${data.battle.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!data) {
    return (
      <PageShell>
        <div className="grid min-h-[50vh] place-items-center text-center">
          {notFound ? (
            <div>
              <div className="label text-signal">No proof yet</div>
              <p className="mt-3 text-muted-foreground">Battle {id} is not settled yet or does not exist.</p>
              <Button asChild variant="outline" className="mt-5">
                <Link href="/proof">All battles</Link>
              </Button>
            </div>
          ) : (
            <span className="label blink text-lime">{error ? `Link lost: ${error}` : "Loading battle inputs"}</span>
          )}
        </div>
      </PageShell>
    );
  }

  const b = data.battle;
  const r = b.result;
  const ok = verdict && r ? verdict.winner === r.winner && verdict.alive[0] === r.alive[0] && verdict.alive[1] === r.alive[1] && verdict.checksum === r.checksum : null;

  return (
    <PageShell>
      <PageTitle
        code="V"
        kicker={`Battle ${b.id}`}
        title={
          <>
            <span style={{ color: b.sides[0].color }}>{b.sides[0].ticker}</span> <span className="text-white/30">vs</span>{" "}
            <span style={{ color: b.sides[1].color }}>{b.sides[1].ticker}</span>
          </>
        }
        lede={`Fought ${new Date(b.startsAt).toLocaleString()}. Everything needed to reproduce this battle is on this page.`}
        right={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={download}>
              <Download /> Inputs JSON
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/battle/${b.id}`}>
                <Play /> Replay
              </Link>
            </Button>
          </div>
        }
      />

      {/* verify */}
      <section className={cn("panel brackets rise-in overflow-hidden", ok === true && "brackets-lime border-lime/30", ok === false && "border-signal/40")}>
        <PanelHeader code="01" title="Verify in your browser" />
        <div className="grid gap-5 p-4 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Your browser rebuilds the battle from the published seed, doctrines, base drones and {data.events.length} trades, runs all {BATTLE_TICKS} ticks with the same
              engine the server uses, then compares the outcome and the final state checksum.
            </p>
            <Button className="mt-4" size="lg" onClick={verify} disabled={progress !== null}>
              {progress !== null ? `Simulating ${Math.round(progress * 100)}%` : verdict ? "Run again" : "Verify battle"}
            </Button>
            {progress !== null && (
              <div className="mt-3 h-1.5 bg-white/[0.06]">
                <div className="h-full bg-lime transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>
          <div>
            {verdict && r ? (
              <div>
                <div className={cn("flex items-center gap-3 font-display text-[30px] font-black uppercase tracking-[0.1em]", ok ? "text-lime text-glow" : "text-signal text-glow-red")}>
                  {ok ? <Check className="h-8 w-8" /> : <X className="h-8 w-8" />}
                  {ok ? "Match" : "Mismatch"}
                </div>
                <div className="mt-3 grid gap-px border border-white/[0.07] bg-white/[0.07] font-mono text-[12px]">
                  <div className="grid grid-cols-[1fr_1fr_1fr] bg-[#0b0e0d] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <span>Field</span>
                    <span>Server</span>
                    <span>Your browser</span>
                  </div>
                  {[
                    ["Winner", b.sides[r.winner].ticker, b.sides[verdict.winner].ticker, r.winner === verdict.winner],
                    ["Survivors", `${r.alive[0]} / ${r.alive[1]}`, `${verdict.alive[0]} / ${verdict.alive[1]}`, r.alive[0] === verdict.alive[0] && r.alive[1] === verdict.alive[1]],
                    ["Checksum", hex8(r.checksum), hex8(verdict.checksum), r.checksum === verdict.checksum],
                    ...verdict.hashes.map((h, i) => [`${b.sides[i].ticker} tactics hash`, "published", h === null ? "skipped" : h ? "matches text" : "differs", h !== false] as const),
                  ].map(([k, a, c, good]) => (
                    <div key={String(k)} className="grid grid-cols-[1fr_1fr_1fr] items-center bg-[#0b0e0d] px-3 py-2">
                      <span className="text-muted-foreground">{k}</span>
                      <span>{a}</span>
                      <span className={good ? "text-lime" : "text-signal"}>{c}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Re-simulated in {Math.round(verdict.ms)}ms{verdict.hashNote ? ` // ${verdict.hashNote}` : ""}
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-[140px] place-items-center border border-dashed border-white/10 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Official checksum {r ? hex8(r.checksum) : "pending"}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* inputs */}
      <section className="panel brackets mt-5 rise-in" style={{ animationDelay: "80ms" }}>
        <PanelHeader code="02" title="Battle inputs" />
        <dl className="grid gap-px bg-white/[0.05] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Seed", <CopyText key="s" value={String(b.seed)} display={`${hex8(b.seed)} (${b.seed})`} />],
            ["Round", <span key="r" className="font-mono">{b.round}</span>],
            ["Prize sectors", <span key="p" className="font-mono">{hexCode(b.prizeHex[0])} / {hexCode(b.prizeHex[1])}</span>],
            ["Trades", <span key="t" className="font-mono">{data.events.length}</span>],
          ].map(([k, v]) => (
            <div key={String(k)} className="bg-[#0b0e0d] px-4 py-3">
              <dt className="label">{k}</dt>
              <dd className="mt-1 text-[13px]">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="grid gap-px bg-white/[0.05] md:grid-cols-2">
          {b.sides.map((s, i) => (
            <div key={s.swarmId} className="bg-[#0b0e0d] p-4">
              <div className="flex items-center gap-2">
                <SwarmDot color={s.color} />
                <span className="font-display text-[15px] font-bold uppercase tracking-[0.1em]" style={{ color: s.color }}>
                  {s.name}
                </span>
                <span className="label ml-auto">{i === 0 ? "Attacker" : "Defender"}</span>
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Base {s.baseDrones} drones // {ABILITY_INFO[s.ability].name}
              </div>
              {data.tactics[i] && <blockquote className="mt-3 border-l-2 pl-3 text-[13px] leading-relaxed text-foreground/85" style={{ borderColor: s.color }}>{data.tactics[i]}</blockquote>}
              {s.tacticsHash && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="label">Hash</span>
                  <CopyText value={s.tacticsHash} display={`${s.tacticsHash.slice(0, 20)}…`} />
                </div>
              )}
              <DoctrineBars config={s.config} ability={s.ability} color={s.color} compact className="mt-4" />
            </div>
          ))}
        </div>
      </section>

      {/* result + events */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1.6fr]">
        <section className="panel brackets rise-in" style={{ animationDelay: "120ms" }}>
          <PanelHeader code="03" title="Official result" />
          {r ? (
            <dl className="grid gap-px bg-white/[0.05] text-[13px]">
              {[
                ["Winner", <span key="w" style={{ color: b.sides[r.winner].color }}>{b.sides[r.winner].name}</span>],
                ["Survivors", `${r.alive[0]} vs ${r.alive[1]}`],
                ["Integrity", `${r.hp[0]} vs ${r.hp[1]} HP`],
                ["Captured", r.capturedHex >= 0 ? hexCode(r.capturedHex) : "None (held)"],
                ["Checksum", hex8(r.checksum)],
                ["Settled", new Date(r.settledAt).toLocaleString()],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex items-center justify-between gap-3 bg-[#0b0e0d] px-3 py-2">
                  <dt className="label">{k}</dt>
                  <dd className="text-right font-mono">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">Not settled yet.</p>
          )}
        </section>
        <section className="panel brackets rise-in overflow-hidden" style={{ animationDelay: "160ms" }}>
          <PanelHeader code="04" title="Trade log" right={<span className="label">{data.events.length} events</span>} />
          {data.events.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No trades landed during this battle. It was decided by base drones and doctrine alone.</p>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[520px] text-left font-mono text-[11px]">
                <thead className="sticky top-0 bg-[#0b0e0d]">
                  <tr className="label border-b border-white/[0.06]">
                    <th className="px-3 py-2 font-normal">Time</th>
                    <th className="px-3 py-2 font-normal">Tick</th>
                    <th className="px-3 py-2 font-normal">Side</th>
                    <th className="px-3 py-2 text-right font-normal">Drones</th>
                    <th className="px-3 py-2 text-right font-normal">SOL</th>
                    <th className="px-3 py-2 font-normal">Wallet</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {[...data.events].sort(compareEvents).map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-1.5 text-muted-foreground">{fmtClock(e.tick * TICK_MS)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground tabular">{e.tick}</td>
                      <td className="px-3 py-1.5" style={{ color: b.sides[e.side].color }}>
                        {b.sides[e.side].ticker}
                      </td>
                      <td className={cn("px-3 py-1.5 text-right tabular", e.kind === "buy" ? "text-lime" : "text-signal")}>
                        {e.kind === "buy" ? "+" : "-"}
                        {e.drones}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular">{e.sol}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {e.wallet.slice(0, 4)}…{e.wallet.slice(-4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
