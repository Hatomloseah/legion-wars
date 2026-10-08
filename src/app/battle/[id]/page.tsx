"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import { type Banner, BattleHud } from "@/components/battle/BattleHud";
import { Button } from "@/components/ui/button";
import { useBattleSession } from "@/lib/client/useBattleSession";
import { useGameState } from "@/lib/client/useGameState";

const BattleCanvas = dynamic(() => import("@/components/battle/BattleCanvas").then((m) => m.BattleCanvas), { ssr: false });

export default function BattlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { state } = useGameState(6000);
  const battleId = id === "live" ? null : id;
  const { detail, ctrl, hud, error } = useBattleSession(battleId);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);
  const shakeRef = useRef<HTMLDivElement>(null);

  // /battle/live -> resolve to the featured battle
  useEffect(() => {
    if (id === "live" && state?.featuredId) router.replace(`/battle/${state.featuredId}`);
  }, [id, state?.featuredId, router]);

  // signature moment: big buys shake the screen and slide in the banner
  useEffect(() => {
    if (!ctrl) return;
    return ctrl.on("spawn", (s) => {
      if (s.count < 25) return;
      setBanner({ key: `${s.event.id}-${ctrl.sim.tick}`, side: s.side as 0 | 1, drones: s.count, wallet: s.event.wallet, sol: s.event.sol });
      const el = shakeRef.current;
      if (el) {
        el.classList.remove("shake");
        void el.offsetWidth;
        el.classList.add("shake");
      }
    });
  }, [ctrl]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 2900);
    return () => clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!tradeMsg) return;
    const t = setTimeout(() => setTradeMsg(null), 4000);
    return () => clearTimeout(t);
  }, [tradeMsg]);

  const demoTrade = useCallback(
    async (side: 0 | 1, sol: number, kind: "buy" | "sell") => {
      if (!battleId) return;
      try {
        const res = await fetch("/api/demo/trade", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ battleId, side, sol, kind }),
        });
        const j = await res.json();
        if (j.ok) {
          ctrl?.merge([j.event]);
          setTradeMsg(`${kind === "buy" ? "Bought" : "Sold"} ${sol} SOL // ${kind === "buy" ? "+" : "-"}${j.event.drones} drones landing in ~2s`);
        } else setTradeMsg(j.error ?? "Trade rejected");
      } catch {
        setTradeMsg("Network error");
      }
    },
    [battleId, ctrl],
  );

  const clientWinner = hud?.done && ctrl ? ctrl.sim.result().winner : null;
  const official = detail?.battle.result?.winner;
  const verified = official === undefined || clientWinner === null ? "pending" : official === clientWinner ? "match" : "mismatch";
  const roundBattles = state ? (detail && state.nextBattles.some((b) => b.id === detail.battle.id) ? state.nextBattles : state.battles) : [];

  return (
    <main className="relative h-[100dvh] w-full overflow-hidden bg-carbon">
      <div ref={shakeRef} className="absolute inset-0">
        <BattleCanvas ctrl={ctrl} />
      </div>
      {/* HUD atmosphere */}
      <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(7,9,10,0.85))]" />
      <div className="pointer-events-none absolute inset-0 z-10 scanlines" />
      <div className="pointer-events-none absolute inset-3 z-10 brackets sm:inset-4" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-10 w-10 -translate-x-1/2 -translate-y-1/2 opacity-30">
        <div className="absolute left-1/2 top-0 h-full w-px bg-lime" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-lime" />
      </div>

      {detail && hud && ctrl ? (
        <BattleHud
          detail={detail}
          hud={hud}
          ctrl={ctrl}
          battles={roundBattles}
          banner={banner}
          onDemoTrade={demoTrade}
          tradeMsg={tradeMsg}
          verified={verified}
          clientWinner={clientWinner}
        />
      ) : (
        <div className="absolute inset-0 z-20 grid place-items-center">
          <div className="text-center">
            <div className="label blink text-lime">{error ? error : "Acquiring battle signal"}</div>
            {error && (
              <Button asChild size="sm" variant="outline" className="mt-4">
                <Link href="/">Back to theater</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
