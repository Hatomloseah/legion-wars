"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { DESIGNS, DroneGlyph } from "@/components/hud/DroneGlyph";
import { PageShell, PageTitle } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useGameState, useServerNow } from "@/lib/client/useGameState";
import { WALLET_CAP_PER_BATTLE, baseDrones, dronesForBuy } from "@/lib/game/drones";
import { HEXES } from "@/lib/game/hexmap";
import { PARAM_INFO, PARAM_ORDER } from "@/lib/game/tactics";
import { ABILITY_INFO, type AbilityKind } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

const SECTIONS = [
  ["loop", "The 10-minute loop"],
  ["drones", "Drones = trades"],
  ["prize", "Territory + prize"],
  ["raise", "Raise a legion"],
  ["fair", "Fair by construction"],
  ["faq", "FAQ"],
  ["risk", "Risk"],
] as const;

function Section({ id, n, title, children }: { id: string; n: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="panel brackets scroll-mt-24 p-5 sm:p-6">
      <div className="label flex items-center gap-2">
        <span className="text-lime">{n}</span>
        <span className="text-white/20">//</span>
        <span>{title}</span>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.06]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-3 py-3 text-left" aria-expanded={open}>
        <span className="font-display text-[13px] font-semibold uppercase tracking-[0.1em]">{q}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180 text-lime")} />
      </button>
      {open && <div className="pb-4 text-[14px] leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

export default function HowItWorksPage() {
  const { state, offset } = useGameState(15000);
  const now = useServerNow(offset, 1000);
  const [sol, setSol] = useState(1);
  const [mcap, setMcap] = useState(100);
  const hourly = state?.prize.hourlySol ?? 1;
  const pool = state?.prize.poolSol ?? hourly;
  const surgeMax = state?.prize.surge?.maxSol ?? 0;
  const surgeNow = state?.prize.surge?.potentialSol ?? 0;

  return (
    <PageShell state={state} now={now}>
      <PageTitle
        code="H"
        kicker="Field manual"
        title={
          <>
            How <span className="text-lime text-glow">LEGION</span> works.
          </>
        }
        lede="Every legion is a pump.fun coin with an army attached. Buying the coin during a battle sends drones into the fight in real time. Selling blows them up. Win battles, take sectors, hold the most map when the hour closes, collect SOL."
      />

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ol className="sticky top-[84px] grid gap-0.5 border-l border-white/[0.07]">
            {SECTIONS.map(([id, label], i) => (
              <li key={id}>
                <a href={`#${id}`} className="block py-1.5 pl-4 font-display text-[11px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-lime">
                  <span className="mr-2 font-mono text-white/30">{String(i + 1).padStart(2, "0")}</span>
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="grid gap-5">
          <Section id="loop" n="01" title="The 10-minute loop">
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              The clock never stops. Every 10 minutes a new round starts and every legion with territory is paired against a neighbor. Each battle is fought over a border
              sector: the winner captures it.
            </p>
            <div className="mt-5">
              <div className="flex h-10 overflow-hidden border border-white/10 font-mono text-[11px] uppercase tracking-[0.12em]">
                <div className="flex w-[30%] items-center justify-center bg-signal/80 text-white">3:00 battle</div>
                <div className="flex flex-1 items-center justify-center bg-lime/15 text-lime">7:00 results + next matchups</div>
              </div>
              <div className="mt-1.5 flex justify-between font-mono text-[10px] text-muted-foreground">
                <span>:00</span>
                <span>:03</span>
                <span>:10</span>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                ["Live battle", "Thousands of drones fight in 3D. Buys drop reinforcements onto the field within seconds."],
                ["Settlement", "The server re-runs the battle with the same engine, awards the sector and updates the map."],
                ["Matchups", "New pairings appear on the world map so holders can rally before the next fight."],
              ].map(([t, d]) => (
                <div key={t} className="border border-white/[0.07] p-3">
                  <div className="font-display text-[12px] font-bold uppercase tracking-[0.14em]">{t}</div>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{d}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section id="drones" n="02" title="Drones = trades">
            <div className="grid gap-5 md:grid-cols-2">
              <div className="grid gap-3 text-[14px] leading-relaxed text-muted-foreground">
                <p>
                  <span className="text-foreground">Base army.</span> At the start of each battle a legion fields{" "}
                  <span className="font-mono text-lime">50 + 25 x log10(mcap + 1)</span> drones, where mcap is its market cap in SOL. Bigger coins start bigger, but not
                  overwhelmingly.
                </p>
                <p>
                  <span className="text-foreground">Reinforcements.</span> Every buy during a live battle adds <span className="font-mono text-lime">round(20 x sqrt(SOL))</span>{" "}
                  drones, dropped through a gate on that legion's edge of the field. Square root means many buyers beat one whale.
                </p>
                <p>
                  <span className="text-foreground">Sells.</span> Every sell destroys the same number of that legion's weakest drones.
                </p>
                <p>
                  <span className="text-foreground">Cap.</span> One wallet can add at most <span className="font-mono text-foreground">{WALLET_CAP_PER_BATTLE}</span> drones per
                  battle. Trades between battles only move market cap, which grows next round's base army.
                </p>
              </div>
              <div className="border border-lime/20 bg-lime/[0.03] p-4">
                <div className="label text-lime/80">Calculator</div>
                <label className="mt-3 block">
                  <span className="label">Buy size (SOL)</span>
                  <div className="mt-1.5 flex items-center gap-3">
                    <input type="range" min={0.05} max={20} step={0.05} value={sol} onChange={(e) => setSol(Number(e.target.value))} className="flex-1 accent-[#C6FF3D]" />
                    <Input type="number" min={0} step={0.1} value={sol} onChange={(e) => setSol(Math.max(0, Number(e.target.value) || 0))} className="h-9 w-24 font-mono" />
                  </div>
                </label>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-[40px] leading-none text-lime text-glow tabular">+{Math.min(WALLET_CAP_PER_BATTLE, dronesForBuy(sol))}</span>
                  <span className="label">drones</span>
                  {dronesForBuy(sol) > WALLET_CAP_PER_BATTLE && <span className="font-mono text-[10px] uppercase text-[#FFB020]">capped</span>}
                </div>
                <label className="mt-5 block">
                  <span className="label">Legion market cap (SOL)</span>
                  <Input type="number" min={0} value={mcap} onChange={(e) => setMcap(Math.max(0, Number(e.target.value) || 0))} className="mt-1.5 h-9 font-mono" />
                </label>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="font-mono text-[28px] leading-none tabular">{baseDrones(mcap)}</span>
                  <span className="label">base drones at battle start</span>
                </div>
              </div>
            </div>
          </Section>

          <Section id="prize" n="03" title="Territory + hourly prize">
            <div className="grid gap-5 md:grid-cols-[1fr_auto]">
              <div className="grid gap-3 text-[14px] leading-relaxed text-muted-foreground">
                <p>
                  The world map has <span className="font-mono text-foreground">{HEXES.length}</span> sectors. Each legion starts with a home sector and its neighbors. Win a
                  battle and you take the contested border sector. Home sectors can never be captured.
                </p>
                <p>
                  When each hour closes, the legion holding the most sectors wins the hourly prize. A share goes to the legion's creator and the rest is split between the
                  wallets that reinforced it during that hour, in proportion to the drones they bought. If nobody qualifies, the prize rolls over to the next hour.
                </p>
                {surgeMax > 0 && (
                  <p>
                    <span className="text-lime">Surge bonus.</span> Busy hours pay more. Every legion launched and every wallet that reinforces during the hour pushes up a
                    bonus on top of the prize, worth up to <span className="font-mono text-foreground">+{surgeMax.toFixed(2)} SOL</span>. How much of it lands is rolled at
                    random when the hour closes. It costs players nothing.
                  </p>
                )}
                <p>
                  Seasons reset every <span className="text-foreground">Sunday 00:00 UTC</span>: the map is wiped and every legion restarts from home.
                </p>
              </div>
              <div className="panel min-w-[220px] p-4">
                <div className="label">Hourly prize</div>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-mono text-[40px] leading-none tabular">{hourly.toFixed(2)}</span>
                  <span className="font-display text-sm tracking-[0.2em] text-lime">SOL</span>
                </div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Next pool {pool.toFixed(2)} SOL</div>
                {surgeMax > 0 && (
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-lime">Surge now up to +{surgeNow.toFixed(2)} SOL</div>
                )}
              </div>
            </div>
          </Section>

          <Section id="raise" n="04" title="Raise a legion">
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              Pick a name, ticker, color, drone design and image, then describe how your drones should fight in plain English. An AI compiles your words into a validated
              doctrine. Your coin launches on pump.fun from your own wallet, and your legion joins the next round.
            </p>
            <div className="mt-4 grid grid-cols-4 gap-2">
              {DESIGNS.map((d) => (
                <div key={d.id} className="flex flex-col items-center gap-1 border border-white/[0.07] py-3">
                  <DroneGlyph design={d.id} color="#C6FF3D" className="h-10 w-10" glow={false} />
                  <span className="font-display text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{d.name}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {PARAM_ORDER.map((k) => (
                <div key={k} className="flex gap-3 border-b border-white/[0.05] py-1.5">
                  <span className="w-9 shrink-0 font-mono text-[11px] text-lime">{PARAM_INFO[k].short}</span>
                  <span className="text-[13px] text-muted-foreground">
                    <span className="text-foreground">{PARAM_INFO[k].label}.</span> {PARAM_INFO[k].desc}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {(Object.keys(ABILITY_INFO) as AbilityKind[]).map((a) => (
                <div key={a} className="border border-white/[0.07] p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-[12px] font-bold uppercase tracking-[0.14em] text-lime">{ABILITY_INFO[a].name}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{ABILITY_INFO[a].cooldownS}s cooldown</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted-foreground">{ABILITY_INFO[a].desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-5 text-[14px] leading-relaxed text-muted-foreground">
              <span className="text-foreground">House legions</span> are the founding garrisons. They are AI-run and have no tradable coin, so they fight on base drones only.
              The exception is The First Legion, whose coin is <span className="font-mono text-lime">$LEGION</span>.
            </p>
            <Button asChild className="mt-4">
              <Link href="/create">Raise a legion</Link>
            </Button>
          </Section>

          <Section id="fair" n="05" title="Fair by construction">
            <div className="grid gap-3 text-[14px] leading-relaxed text-muted-foreground">
              <p>
                Battles run in deterministic lockstep: integer fixed-point math, a seeded random generator, lookup-table trigonometry and a fixed 10 ticks per second. Every
                viewer's browser runs the exact same battle from the same inputs.
              </p>
              <p>
                The server settles results with the same engine, and publishes every battle's seed, doctrines, base drones, trade log and final state checksum. Anyone can
                re-run a battle and check the result.
              </p>
            </div>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/proof">Verify a battle</Link>
            </Button>
          </Section>

          <Section id="faq" n="06" title="FAQ">
            <Faq q="Do I need a wallet to watch?">No. Battles, the map, replays and proofs are open to everyone. You only need a wallet to raise a legion.</Faq>
            <Faq q="Which wallets work?">
              Phantom, Solflare and Backpack. On mobile, open LEGION inside your wallet app's built-in browser and connect from there.
            </Faq>
            <Faq q="How do I reinforce a legion?">
              Buy its coin on pump.fun while its battle is live. Drones land within a few seconds. The live view runs about 2.5 seconds behind real time so late trades can
              still be placed correctly.
            </Faq>
            <Faq q="What happens when I sell?">The legion loses round(20 x sqrt(SOL)) of its weakest drones on the spot. Selling mid-battle can cost your legion the fight.</Faq>
            <Faq q="Who pays the prize?">
              The LEGION team, never the players. There is no entry fee or launch fee. Prizes, including surge bonuses, are calculated automatically when each hour closes and paid out on-chain by the team, so every payment can be checked on Solscan.
            </Faq>
            <Faq q="Can I lose money?">Yes. Coins can go to zero. Battles do not protect the price of any coin. See the risk notice below.</Faq>
          </Section>

          <section id="risk" className="scroll-mt-24 border border-signal/30 bg-signal/[0.04] p-5 sm:p-6">
            <div className="label text-signal">07 // Risk notice</div>
            <p className="mt-3 text-[14px] leading-relaxed text-foreground/85">
              Memecoins are extremely volatile and can lose all of their value. Nothing on LEGION is financial advice. Battles, territory and prizes are a game layered on top
              of independent pump.fun coins and do not guarantee any return. Only use money you can afford to lose. Game rules, prizes and parameters may change between
              seasons.
            </p>
          </section>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button asChild size="lg">
              <Link href="/battle/live">Enter live battle</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/create">Raise a legion</Link>
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
