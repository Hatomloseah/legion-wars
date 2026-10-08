import type { DroneDesign } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

export const DESIGNS: { id: DroneDesign; name: string; blurb: string }[] = [
  { id: "dart", name: "Dart", blurb: "Slim interceptor. Reads fast." },
  { id: "orb", name: "Orb", blurb: "Ringed sphere. Heavy presence." },
  { id: "delta", name: "Delta", blurb: "Wide wing. Classic strike craft." },
  { id: "shard", name: "Shard", blurb: "Crystal blade. Sharp silhouette." },
];

/** 2D silhouettes of the 3D drone designs, drawn in the legion color. */
export function DroneGlyph({ design, color, className, glow = true }: { design: DroneDesign; color: string; className?: string; glow?: boolean }) {
  const stroke = { stroke: color, strokeWidth: 1.6, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 100 100" className={cn("h-16 w-16", className)} style={glow ? { filter: `drop-shadow(0 0 10px ${color}66)` } : undefined} aria-hidden>
      {design === "dart" && (
        <g>
          <polygon points="50,6 60,62 50,54 40,62" fill={color} fillOpacity={0.9} {...stroke} />
          <polygon points="40,62 30,82 44,70" fill={color} fillOpacity={0.45} {...stroke} />
          <polygon points="60,62 70,82 56,70" fill={color} fillOpacity={0.45} {...stroke} />
          <line x1="50" y1="54" x2="50" y2="90" stroke={color} strokeOpacity={0.5} strokeWidth="1.2" strokeDasharray="2 3" />
        </g>
      )}
      {design === "orb" && (
        <g>
          <ellipse cx="50" cy="52" rx="40" ry="11" fill="none" stroke={color} strokeOpacity={0.55} strokeWidth="1.6" transform="rotate(-14 50 52)" />
          <circle cx="50" cy="50" r="22" fill={color} fillOpacity={0.88} {...stroke} />
          <circle cx="43" cy="43" r="7" fill="#07090A" fillOpacity={0.35} />
          <path d="M14 58 A40 11 -14 0 0 86 46" fill="none" stroke={color} strokeWidth="1.8" transform="rotate(0 50 50)" />
        </g>
      )}
      {design === "delta" && (
        <g>
          <polygon points="50,14 92,80 50,66 8,80" fill={color} fillOpacity={0.88} {...stroke} />
          <polygon points="50,28 62,62 50,58 38,62" fill="#07090A" fillOpacity={0.3} />
          <line x1="50" y1="14" x2="50" y2="66" stroke="#07090A" strokeOpacity={0.35} strokeWidth="1.4" />
        </g>
      )}
      {design === "shard" && (
        <g>
          <polygon points="50,4 70,46 50,96 30,46" fill={color} fillOpacity={0.88} {...stroke} />
          <polygon points="50,4 70,46 50,52" fill="#07090A" fillOpacity={0.28} />
          <polygon points="30,46 50,52 50,96" fill="#07090A" fillOpacity={0.18} />
          <polygon points="18,40 26,46 18,52" fill={color} fillOpacity={0.5} />
          <polygon points="82,40 74,46 82,52" fill={color} fillOpacity={0.5} />
        </g>
      )}
    </svg>
  );
}
