"use client";

import { useEffect, useRef, useState } from "react";
import type { BattleDetail } from "@/lib/game/types";
import { BATTLE_TICKS, type SideStats, TICK_MS } from "@/lib/sim/engine";
import type { SimEvent } from "@/lib/sim/types";
import { LockstepController, type StageMode } from "./lockstep";

export interface HudState {
  mode: StageMode;
  tick: number;
  timeLeftMs: number;
  startsInMs: number;
  counts: [number, number];
  hp: [number, number];
  decoys: [number, number];
  stats: [SideStats, SideStats];
  abilityCd: [number, number];
  shield: [number, number];
  checksum: number;
  behind: number;
  rollbacks: number;
  done: boolean;
  paused: boolean;
  speed: number;
  eventCount: number;
  feed: SimEvent[];
}

function sample(c: LockstepController): HudState {
  const s = c.sim;
  return {
    mode: c.mode,
    tick: s.tick,
    timeLeftMs: (BATTLE_TICKS - s.tick) * TICK_MS,
    startsInMs: Math.max(0, c.battle.startsAt - c.serverNow()),
    counts: [s.s[0].count, s.s[1].count],
    hp: [s.s[0].hpSum, s.s[1].hpSum],
    decoys: [s.s[0].decoys, s.s[1].decoys],
    stats: [{ ...s.s[0].stats }, { ...s.s[1].stats }],
    abilityCd: [s.s[0].abilityCd, s.s[1].abilityCd],
    shield: [s.s[0].shield, s.s[1].shield],
    checksum: c.checksum,
    behind: c.behind,
    rollbacks: c.rollbacks,
    done: c.done(),
    paused: c.paused,
    speed: c.replaySpeed,
    eventCount: c.events.length,
    feed: c.appliedEvents(18),
  };
}

export function useBattleSession(battleId: string | null) {
  const [detail, setDetail] = useState<BattleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ctrl, setCtrl] = useState<LockstepController | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const ctrlRef = useRef<LockstepController | null>(null);

  useEffect(() => {
    if (!battleId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    ctrlRef.current = null;
    setCtrl(null);
    setDetail(null);
    setHud(null);
    setError(null);

    const poll = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch(`/api/battles/${battleId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Battle not found" : `HTTP ${res.status}`);
        const d = (await res.json()) as BattleDetail;
        const t1 = Date.now();
        if (!alive) return;
        if (!ctrlRef.current) {
          const c = new LockstepController(d, (t0 + t1) / 2);
          ctrlRef.current = c;
          setCtrl(c);
        } else {
          const c = ctrlRef.current;
          // smooth clock offset to avoid jitter
          const off = d.now - (t0 + t1) / 2;
          c.serverOffset = c.serverOffset * 0.8 + off * 0.2;
          c.merge(d.events);
        }
        setDetail(d);
        setError(null);
        const keepPolling = d.phase !== "ended" || !d.battle.result;
        if (keepPolling) timer = setTimeout(poll, d.phase === "upcoming" ? 3000 : d.phase === "live" ? 1000 : 2500);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Network error");
        timer = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [battleId]);

  useEffect(() => {
    if (!ctrl) return;
    setHud(sample(ctrl));
    const id = setInterval(() => setHud(sample(ctrl)), 125);
    return () => clearInterval(id);
  }, [ctrl]);

  return { detail, ctrl, hud, error };
}
