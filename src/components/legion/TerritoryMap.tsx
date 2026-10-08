import { memo } from "react";
import { HEXES, MAP_HEIGHT, MAP_WIDTH, hexPoints } from "@/lib/game/hexmap";
import type { PublicSwarm } from "@/lib/game/types";

const S = 12;

/** Static world map: the focus legion bright, other legions dim, open ground faint. */
export const TerritoryMap = memo(function TerritoryMap({
  owners,
  swarms,
  focusId,
  homeHex,
  className,
}: {
  owners: string[];
  swarms: PublicSwarm[];
  focusId: string;
  homeHex?: number;
  className?: string;
}) {
  const colorOf = new Map(swarms.map((s) => [s.id, s.color]));
  const home = homeHex !== undefined ? HEXES[homeHex] : undefined;
  return (
    <svg viewBox={`0 0 ${MAP_WIDTH * S} ${MAP_HEIGHT * S}`} className={className} role="img" aria-label="Territory map">
      {HEXES.map((h) => {
        const o = owners[h.id];
        const mine = o === focusId;
        const col = o ? colorOf.get(o) : undefined;
        return (
          <polygon
            key={h.id}
            points={hexPoints(h.cx, h.cy, S, 1.2)}
            fill={mine ? col : col ? col : "rgba(236,255,214,0.035)"}
            fillOpacity={mine ? 0.75 : col ? 0.12 : 1}
            stroke={mine ? col : "rgba(236,255,214,0.1)"}
            strokeWidth={mine ? 1.2 : 0.5}
          />
        );
      })}
      {home && (
        <g>
          <circle cx={home.cx * S} cy={home.cy * S} r={S * 1.6} fill="none" stroke="#fff" strokeOpacity={0.7} strokeWidth={1} className="ping-ring" />
          <circle cx={home.cx * S} cy={home.cy * S} r={2.6} fill="#fff" />
        </g>
      )}
    </svg>
  );
});
