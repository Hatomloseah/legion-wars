"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PanelHeader, SwarmDot } from "@/components/hud/primitives";
import { PageShell, PageTitle } from "@/components/PageShell";
import { Badge } from "@/components/ui/badge";
import { addressColor } from "@/components/wallet/WalletButton";
import { useJson } from "@/lib/client/useJson";
import { useServerNow } from "@/lib/client/useGameState";
import { useWallet } from "@/lib/client/wallet";
import { formatSol } from "@/lib/game/drones";
import type { LeaderboardData } from "@/lib/game/types";
import { cn } from "@/lib/utils";

type Tab = "legions" | "reinforcers" | "prizes";

function countdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m` : `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
}

export default function LeaderboardPage() {
  const { data, error, offset } = useJson<LeaderboardData>("/api/leaderboard", 30000);
  const now = useServerNow(offset, 1000);
  const { wallet } = useWallet();
  const [tab, setTab] = useState<Tab>("legions");
  const byId = useMemo(() => new Map((data?.swarms ?? []).map((s) => [s.id, s])), [data]);
  const maxTerr = Math.max(1, ...(data?.swarms ?? []).map((s) => s.territory));

  return (
    <PageShell>
      <PageTitle
        code="L"
        kicker={`Season ${data?.season ?? "----"}`}
        title={
          <>
            Who holds <span className="text-lime text-glow">the map.</span>
          </>
        }
        lede="Legions ranked by territory. The leader when each hour closes takes the SOL prize, split between its creator and the wallets that reinforced it."
        right={
          <div className="panel brackets px-4 py-3">
            <div className="label">Season resets in</div>
            <div className="mt-1 font-mono text-[26px] leading-none tabular text-lime text-glow">{data ? countdown(data.seasonEndsAt - now) : "--"}</div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Sunday 00:00 UTC // map wiped</div>
          </div>
        }
      />

      {!data ? (
        <div className="grid min-h-[30vh] place-items-center">
          <span className="label blink text-lime">{error ? `Link lost: ${error}` : "Compiling standings"}</span>
        </div>
      ) : (
        <>
          <div className="rise-in grid grid-cols-2 gap-px border border-white/[0.07] bg-white/[0.07] lg:grid-cols-4">
            {[
              ["Battles this season", data.totals.battles.toLocaleString()],
              ["Drones deployed", data.totals.drones.toLocaleString()],
              ["SOL traded", formatSol(data.totals.sol)],
              ["Next hourly pool", `${(data.hourlySol + data.rollover).toFixed(2)} SOL`],
            ].map(([k, v]) => (
              <div key={k} className="bg-[#0b0e0d] px-4 py-3">
                <div className="label">{k}</div>
                <div className="mt-1 font-mono text-[24px] leading-none tabular">{v}</div>
              </div>
            ))}
          </div>
          {data.rollover > 0 && (
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Includes {data.rollover.toFixed(3)} SOL rolled over from unclaimed prizes</div>
          )}

          <div className="mt-6 flex gap-1 border-b border-white/[0.06]">
            {(
              [
                ["legions", `Legions (${data.swarms.length})`],
                ["reinforcers", `Reinforcers (${data.wallets.length})`],
                ["prizes", `Prize history (${data.prizes.length})`],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={cn(
                  "relative px-3 py-2.5 font-display text-[11px] uppercase tracking-[0.16em] transition-colors",
                  tab === k ? "text-lime" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
                {tab === k && <span className="absolute inset-x-3 -bottom-px h-px bg-lime shadow-[0_0_10px_#C6FF3D]" />}
              </button>
            ))}
          </div>

          {tab === "legions" && (
            <section className="panel brackets mt-4 overflow-hidden">
              <PanelHeader code="01" title="Legions by territory" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead>
                    <tr className="label border-b border-white/[0.06]">
                      <th className="w-12 px-3 py-2 font-normal">#</th>
                      <th className="px-3 py-2 font-normal">Legion</th>
                      <th className="w-[28%] px-3 py-2 font-normal">Territory</th>
                      <th className="px-3 py-2 text-right font-normal">Season W-L</th>
                      <th className="px-3 py-2 text-right font-normal">Win %</th>
                      <th className="px-3 py-2 text-right font-normal">Mcap SOL</th>
                      <th className="px-3 py-2 text-right font-normal">Prizes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {data.swarms.map((s, i) => {
                      const games = s.wins + s.losses;
                      return (
                        <tr key={s.id} className={cn("transition-colors hover:bg-white/[0.02]", i < 3 && "bg-white/[0.012]")}>
                          <td className={cn("px-3 py-3 font-mono tabular", i === 0 ? "text-lime" : "text-muted-foreground")}>{String(i + 1).padStart(2, "0")}</td>
                          <td className="px-3 py-3">
                            <Link href={`/legion/${s.id}`} className="group flex items-center gap-2.5">
                              <SwarmDot color={s.color} size={i < 3 ? 10 : 8} />
                              <span className="font-display text-[14px] font-semibold tracking-wide group-hover:underline">{s.name}</span>
                              <span className="font-mono text-[10px] tracking-[0.12em]" style={{ color: s.color }}>
                                ${s.ticker}
                              </span>
                              {s.flagship && <Badge variant="solid">Flagship</Badge>}
                              {s.house && !s.flagship && <Badge variant="secondary">House</Badge>}
                            </Link>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 bg-white/[0.05]">
                                <div className="h-full" style={{ width: `${(s.territory / maxTerr) * 100}%`, background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
                              </div>
                              <span className="w-8 text-right font-mono tabular">{s.territory}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono tabular">
                            {s.wins}-{s.losses}
                          </td>
                          <td className="px-3 py-3 text-right font-mono tabular text-muted-foreground">{games ? `${Math.round((s.wins / games) * 100)}%` : "--"}</td>
                          <td className="px-3 py-3 text-right font-mono tabular">{formatSol(s.mcapSol)}</td>
                          <td className="px-3 py-3 text-right font-mono tabular">
                            {s.prizesWon}
                            <span className="text-muted-foreground"> / {formatSol(s.prizeSol)}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {tab === "reinforcers" && (
            <section className="panel brackets mt-4 overflow-hidden">
              <PanelHeader code="02" title="Top reinforcers this season" right={<span className="label">by drones deployed</span>} />
              {data.wallets.length === 0 ? (
                <p className="px-3 py-5 text-sm text-muted-foreground">No reinforcements yet this season. Buy a legion's coin during a live battle to get on the board.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[13px]">
                    <thead>
                      <tr className="label border-b border-white/[0.06]">
                        <th className="w-12 px-3 py-2 font-normal">#</th>
                        <th className="px-3 py-2 font-normal">Wallet</th>
                        <th className="px-3 py-2 text-right font-normal">Drones</th>
                        <th className="px-3 py-2 text-right font-normal">Sold</th>
                        <th className="px-3 py-2 text-right font-normal">SOL</th>
                        <th className="px-3 py-2 text-right font-normal">Buys / sells</th>
                        <th className="px-3 py-2 font-normal">Backed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.wallets.map((w, i) => {
                        const me = wallet === w.wallet;
                        return (
                          <tr key={w.wallet} className={cn("hover:bg-white/[0.02]", me && "bg-lime/[0.05]")}>
                            <td className="px-3 py-2.5 font-mono tabular text-muted-foreground">{String(i + 1).padStart(2, "0")}</td>
                            <td className="px-3 py-2.5">
                              <span className="inline-flex items-center gap-2">
                                <SwarmDot color={addressColor(w.wallet)} size={8} />
                                {w.wallet.startsWith("DEMo") || w.wallet.length < 32 ? (
                                  <span className="font-mono text-foreground/80">
                                    {w.wallet.slice(0, 4)}…{w.wallet.slice(-4)}
                                  </span>
                                ) : (
                                  <a href={`https://solscan.io/account/${w.wallet}`} target="_blank" rel="noreferrer" className="font-mono text-foreground/80 hover:text-lime">
                                    {w.wallet.slice(0, 4)}…{w.wallet.slice(-4)}
                                  </a>
                                )}
                                {me && <Badge variant="solid">You</Badge>}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-right font-mono tabular text-lime">{w.drones.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular text-signal/80">{w.sold.toLocaleString()}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular">{formatSol(w.sol)}</td>
                            <td className="px-3 py-2.5 text-right font-mono tabular text-muted-foreground">
                              {w.buys} / {w.sells}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className="flex flex-wrap gap-1">
                                {w.swarms.map((id) => {
                                  const sw = byId.get(id);
                                  return sw ? (
                                    <Link key={id} href={`/legion/${id}`} title={sw.name} className="font-mono text-[10px] tracking-[0.1em] hover:underline" style={{ color: sw.color }}>
                                      {sw.ticker}
                                    </Link>
                                  ) : null;
                                })}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === "prizes" && (
            <section className="panel brackets mt-4 overflow-hidden">
              <PanelHeader code="03" title="Hourly prize history" />
              {data.prizes.length === 0 ? (
                <p className="px-3 py-5 text-sm text-muted-foreground">The first hourly prize is decided when the current hour closes.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-[13px]">
                    <thead>
                      <tr className="label border-b border-white/[0.06]">
                        <th className="px-3 py-2 font-normal">Hour closed</th>
                        <th className="px-3 py-2 font-normal">Winner</th>
                        <th className="px-3 py-2 text-right font-normal">Sectors</th>
                        <th className="px-3 py-2 text-right font-normal">Paid</th>
                        <th className="px-3 py-2 text-right font-normal">Reinforcers</th>
                        <th className="px-3 py-2 font-normal">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.prizes.map((p) => (
                        <tr key={p.hour} className="hover:bg-white/[0.02]">
                          <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">
                            {new Date(p.endsAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-3 py-2.5">
                            {p.swarmId ? (
                              <Link href={`/legion/${p.swarmId}`} className="inline-flex items-center gap-2 hover:underline">
                                <SwarmDot color={p.color} size={8} />
                                <span className="font-display text-[13px] font-semibold tracking-wide" style={{ color: p.color }}>
                                  {p.name}
                                </span>
                              </Link>
                            ) : (
                              <span className="text-muted-foreground">No holder</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono tabular">{p.territory}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular text-lime">{p.amountSol.toFixed(3)}</td>
                          <td className="px-3 py-2.5 text-right font-mono tabular">{p.reinforcers}</td>
                          <td className="px-3 py-2.5">
                            <span className="flex gap-1">
                              {p.rolledOver && <Badge variant="secondary">Rolled over</Badge>}
                              {p.demo && <Badge variant="outline">Simulated</Badge>}
                              {!p.rolledOver && !p.demo && <Badge>Awarded</Badge>}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </PageShell>
  );
}
