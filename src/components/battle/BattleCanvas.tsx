"use client";

import { useEffect, useRef } from "react";
import type { LockstepController } from "@/lib/client/lockstep";
import { BattleRenderer } from "@/lib/client/renderer";
import { cn } from "@/lib/utils";

interface Props {
  ctrl: LockstepController | null;
  compact?: boolean;
  className?: string;
  onRenderer?: (r: BattleRenderer | null) => void;
}

/** Owns the WebGL renderer and the frame loop: step the lockstep sim, then draw it interpolated. */
export function BattleCanvas({ ctrl, compact, className, onRenderer }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const onRendererRef = useRef(onRenderer);
  onRendererRef.current = onRenderer;

  useEffect(() => {
    const el = ref.current;
    if (!el || !ctrl) return;
    const mobile = window.matchMedia("(max-width: 768px)").matches || (navigator.hardwareConcurrency ?? 8) <= 4;
    let r: BattleRenderer;
    try {
      r = new BattleRenderer(el, { compact, mobile });
    } catch (e) {
      console.error("WebGL unavailable", e);
      return;
    }
    const b = ctrl.battle;
    r.setSides([b.sides[0].color, b.sides[1].color], [b.sides[0].design, b.sides[1].design]);
    onRendererRef.current?.(r);

    let visible = true;
    const io = new IntersectionObserver((entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    });
    io.observe(el);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ctrl.update(dt * 1000);
      if (visible) r.frame(ctrl.sim, ctrl.alpha, dt, ctrl.takeFx());
      else ctrl.takeFx();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      onRendererRef.current?.(null);
      r.dispose();
    };
  }, [ctrl, compact]);

  return <div ref={ref} className={cn("absolute inset-0", className)} />;
}
