"use client";

import Link from "next/link";
import { hex8 } from "@/components/hud/CopyText";
import { PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { PageShell, PageTitle } from "@/components/PageShell";
import { useJson } from "@/lib/client/useJson";
import { hexCode } from "@/lib/game/hexmap";
import type { ProofIndex } from "@/lib/game/types";

export default function ProofIndexPage() {
  const { data, error } = useJson<ProofIndex>("/api/proof", 60000);
  const e = data?.engine;

  return (
    <PageShell>
      <PageTitle
        code="V"
        kicker="Verifiable battles"
        title={
          <>
            Don't trust. <span className="text-lime text-glow">Re-run it.</span>
          </>
        }
        lede="Every battle is a pure function of its seed, both legions' compiled doctrines, their base drone counts and the time-ordered trade log. Same inputs, same battle, on every machine. Pick any battle below and verify it in your own browser."
      />

      <div className="rise-in grid gap-px border border-white/[0.07] bg-white/[0.07] sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Timestep", e ? `${e.tickMs}ms` : "--", e ? `${e.ticks} ticks per battle` : ""],
          ["Math", e?.fixedPoint ?? "--", "integer fixed-point, no floats"],
          ["Randomness", e?.prng ?? "--", "seeded per battle"],
          ["Trig", e?.trig ?? "--", "identical on every CPU"],
          ["Capacity", e ? `${e.cap}` : "--", "drones per battle"],
        ].map(([k, v, sub]) => (
          <div key={k} className="bg-[#0b0e0d] px-4 py-3">
            <div className="label">{k}</div>
            <div className="mt-1 font-mono text-[17px] leading-tight">{v}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["01", "Inputs are published", "Seed, doctrines, base drones and every trade (tick, side, drones) are public the moment a battle settles."],
          ["02", "The engine is deterministic", "Fixed-point integers, a seeded PRNG and lookup-table trig mean no hardware or browser can drift."],
          ["03", "Checksums must match", "The server publishes a fingerprint of the final state. Your browser re-simulates all 1800 ticks and compares."],
        ].map(([n, t, d]) => (
          <div key={n} className="panel p-4">
            <div className="font-mono text-[11px] text-lime">{n}</div>
            <div className="mt-2 font-display text-[14px] font-bold uppercase tracking-[0.1em]">{t}</div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{d}</p>
          </div>
        ))}
      </div>

      <section className="panel brackets mt-6 overflow-hidden">
        <PanelHeader code="S" title="Settled battles" right={<span className="label">{data?.battles.length ?? 0} on record</span>} />
        {!data ? (
          <div className="px-3 py-6 text-center">
            <span className="label blink text-lime">{error ? `Link lost: ${error}` : "Loading ledger"}</span>
          </div>
        ) : data.battles.length === 0 ? (
          <p className="px-3 py-5 text-sm text-muted-foreground">No battles settled yet. The first ones land 3 minutes after a round starts.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[12px]">
              <thead>
                <tr className="label border-b border-white/[0.06]">
                  <th className="px-3 py-2 font-normal">Battle</th>
                  <th className="px-3 py-2 font-normal">When</th>
                  <th className="px-3 py-2 font-normal">Sides</th>
                  <th className="px-3 py-2 font-normal">Winner</th>
                  <th className="px-3 py-2 font-normal">Seed</th>
                  <th className="px-3 py-2 text-right font-normal">Trades</th>
                  <th className="px-3 py-2 font-normal">Checksum</th>
                  <th className="px-3 py-2 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.battles.map((b) => {
                  const w = b.sides[b.winner];
                  return (
                    <tr key={b.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{b.id}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">
                        {new Date(b.startsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono tracking-[0.08em]" style={{ color: b.sides[0].color }}>
                          {b.sides[0].ticker}
                        </span>
                        <span className="px-1.5 text-white/30">vs</span>
                        <span className="font-mono tracking-[0.08em]" style={{ color: b.sides[1].color }}>
                          {b.sides[1].ticker}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1.5">
                          <SwarmDot color={w.color} size={7} />
                          <span className="font-mono tracking-[0.08em]">{w.ticker}</span>
                          {b.capturedHex >= 0 && <span className="font-mono text-[10px] text-muted-foreground">took {hexCode(b.capturedHex)}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{hex8(b.seed)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular">{b.eventCount}</td>
                      <td className="px-3 py-2.5 font-mono text-lime/80">{hex8(b.checksum)}</td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/proof/${b.id}`} className="font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-lime">
                          Verify
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
    </PageShell>
  );
}
