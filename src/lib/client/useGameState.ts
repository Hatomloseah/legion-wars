"use client";

import { useEffect, useRef, useState } from "react";
import type { GameState } from "@/lib/game/types";

/** Polls /api/state and tracks the server clock offset. */
export function useGameState(intervalMs = 4000, enabled = true) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const t0 = Date.now();
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as GameState;
        const t1 = Date.now();
        if (!alive) return;
        const off = data.now - (t0 + t1) / 2;
        offsetRef.current = offsetRef.current === 0 ? off : offsetRef.current * 0.7 + off * 0.3;
        setOffset(offsetRef.current);
        setState(data);
        setError(null);
        // poll faster right around phase transitions
        const now = data.now;
        const nextEdge = data.round.phase === "battle" ? data.round.battleEndsAt : data.round.endsAt;
        const soon = nextEdge - now < 8000 || now - data.round.startsAt < 6000 || now - data.round.battleEndsAt < 8000;
        timer = setTimeout(load, soon ? 1500 : intervalMs);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "Network error");
        timer = setTimeout(load, 4000);
      }
    };
    load();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [intervalMs, enabled]);

  return { state, offset, error };
}

/** Server-synced clock that re-renders every `tickMs`. */
export function useServerNow(offset: number, tickMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), tickMs);
    return () => clearInterval(id);
  }, [offset, tickMs]);
  return now;
}
