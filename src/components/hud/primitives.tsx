import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
        <polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="none" stroke="#C6FF3D" strokeWidth="1.5" />
        <polygon points="16,8 22.5,11.75 22.5,19.25 16,23 9.5,19.25 9.5,11.75" fill="#C6FF3D" opacity="0.14" />
        {[
          [16, 11],
          [12, 14.5],
          [20, 14.5],
          [14, 19],
          [18, 19],
          [16, 15.5],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.35" fill="#C6FF3D" />
        ))}
      </svg>
      <span className="font-display text-[19px] font-bold tracking-[0.22em] text-foreground">LEGION</span>
    </span>
  );
}

export function PanelHeader({ code, title, right, className }: { code: string; title: string; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b border-white/[0.06] px-3 py-2", className)}>
      <span className="label flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
        <span className="shrink-0 text-lime/80">{code}</span>
        <span className="shrink-0 text-white/20">//</span>
        <span className="truncate text-foreground/80">{title}</span>
      </span>
      {right && <div className="flex shrink-0 items-center">{right}</div>}
    </div>
  );
}

export function SwarmDot({ color, size = 8, className }: { color: string; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-block shrink-0", className)}
      style={{
        width: size,
        height: size,
        background: color,
        boxShadow: `0 0 10px ${color}88`,
        clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
      }}
    />
  );
}

export function Crosshair({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("h-4 w-4", className)} aria-hidden>
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M12 1v6M12 17v6M1 12h6M17 12h6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function LiveDot({ color = "#FF3B30" }: { color?: string }) {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: color }} />
      <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

/** segmented meter (HUD style) */
export function Meter({ value, color, segments = 24, className }: { value: number; color: string; segments?: number; className?: string }) {
  const on = Math.round(Math.max(0, Math.min(1, value)) * segments);
  return (
    <div className={cn("flex gap-[2px]", className)}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static segments
          key={i}
          className="h-full flex-1 transition-colors duration-300"
          style={{ background: i < on ? color : "rgba(236,255,214,0.07)", boxShadow: i < on ? `0 0 6px ${color}55` : undefined }}
        />
      ))}
    </div>
  );
}
