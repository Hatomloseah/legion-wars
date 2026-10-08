"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HEXES, MAP_HEIGHT, MAP_WIDTH, formatCoord, hexCode, hexPoints } from "@/lib/game/hexmap";
import type { BattleSummary, PublicSwarm } from "@/lib/game/types";
import { cn } from "@/lib/utils";

const S = 12; // px per unit hex radius
const W = MAP_WIDTH * S;
const H = MAP_HEIGHT * S;

interface Props {
  owners: string[];
  swarms: PublicSwarm[];
  battles: BattleSummary[];
  lastBattles?: BattleSummary[];
  selectedBattle?: string | null;
  onSelectBattle?: (id: string) => void;
  className?: string;
}

const HexLayer = memo(function HexLayer({ owners, colorOf }: { owners: string[]; colorOf: Map<string, string> }) {
  return (
    <g>
      {HEXES.map((h) => {
        const owner = owners[h.id];
        const col = owner ? colorOf.get(owner) : undefined;
        return (
          <polygon
            key={h.id}
            data-hex={h.id}
            points={hexPoints(h.cx, h.cy, S, 1.1)}
            fill={col ? col : "rgba(236,255,214,0.035)"}
            fillOpacity={col ? 0.42 : 1}
            stroke={col ? col : "rgba(236,255,214,0.13)"}
            strokeOpacity={col ? 0.9 : 1}
            strokeWidth={col ? 1 : 0.6}
            className="transition-[fill,stroke] duration-700"
          />
        );
      })}
    </g>
  );
});

function center(id: number): [number, number] {
  const h = HEXES[id];
  return h ? [h.cx * S, h.cy * S] : [0, 0];
}

export function WorldMap({ owners, swarms, battles, lastBattles = [], selectedBattle, onSelectBattle, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<{ id: number; px: number; py: number } | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const colorOf = useMemo(() => new Map(swarms.map((s) => [s.id, s.color])), [swarms]);
  const byId = useMemo(() => new Map(swarms.map((s) => [s.id, s])), [swarms]);

  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const clampView = useCallback((v: { k: number; x: number; y: number }) => {
    const k = Math.max(1, Math.min(7, v.k));
    const minX = W - W * k;
    const minY = H - H * k;
    return { k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
  }, []);

  const zoomAt = useCallback(
    (sx: number, sy: number, factor: number) => {
      setView((v) => {
        const k = Math.max(1, Math.min(7, v.k * factor));
        const f = k / v.k;
        return clampView({ k, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f });
      });
    },
    [clampView],
  );

  const engaged = useRef(false);
  const [engagedUi, setEngagedUi] = useState(false);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (!engaged.current && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toSvg, zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    engaged.current = true;
    setEngagedUi(true);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      drag.current = null;
    } else {
      drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
      const target = pinch.current.k * (d / pinch.current.d);
      zoomAt(mid.x, mid.y, target / view.k);
      return;
    }
    const dr = drag.current;
    if (dr) {
      const svg = svgRef.current;
      const scale = svg ? W / svg.getBoundingClientRect().width : 1;
      const dx = (e.clientX - dr.x) * scale;
      const dy = (e.clientY - dr.y) * scale;
      if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
      if (dr.moved) setView((v) => clampView({ ...v, x: dr.vx + dx, y: dr.vy + dy }));
    }
    const target = e.target as Element;
    const id = target.getAttribute?.("data-hex");
    const rect = wrapRef.current?.getBoundingClientRect();
    if (id && rect) setHover({ id: Number(id), px: e.clientX - rect.left, py: e.clientY - rect.top });
    else if (!dr?.moved) setHover(null);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  const hovered = hover ? HEXES[hover.id] : null;
  const hoverOwner = hover ? byId.get(owners[hover.id]) : undefined;

  const lat = [60, 30, 0, -30];
  const latY = (la: number) => ((80 - la) / 136) * (H - 2 * S) + S;
  const lon = [-120, -60, 0, 60, 120];
  const lonX = (lo: number) => ((lo + 180) / 360) * (W - S) + S * 0.5;

  return (
    <div
      ref={wrapRef}
      className={cn("relative select-none overflow-hidden bg-[#060807]", className)}
      onPointerLeave={() => {
        setHover(null);
        engaged.current = false;
        setEngagedUi(false);
      }}
    >
      {/* radar rings + sweep */}
      <div className="pointer-events-none absolute inset-0 hud-grid opacity-60" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[140%] -translate-x-1/2 -translate-y-1/2">
        <div
          className="radar-sweep absolute inset-0 rounded-full"
          style={{ background: "conic-gradient(from 0deg, rgba(198,255,61,0) 0deg, rgba(198,255,61,0) 300deg, rgba(198,255,61,0.10) 350deg, rgba(198,255,61,0.32) 360deg)" }}
        />
        {[0.25, 0.45, 0.65].map((r) => (
          <div
            key={r}
            className="absolute rounded-full border border-lime/[0.07]"
            style={{ inset: `${(1 - r) * 50}%` }}
          />
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="relative block h-full w-full touch-none"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ cursor: drag.current?.moved ? "grabbing" : "crosshair" }}
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {/* graticule */}
          <g stroke="rgba(236,255,214,0.06)" strokeWidth={0.6 / view.k} strokeDasharray={`${3 / view.k} ${5 / view.k}`}>
            {lat.map((la) => (
              <line key={la} x1={0} x2={W} y1={latY(la)} y2={latY(la)} />
            ))}
            {lon.map((lo) => (
              <line key={lo} y1={0} y2={H} x1={lonX(lo)} x2={lonX(lo)} />
            ))}
          </g>
          <g fill="rgba(236,255,214,0.28)" fontFamily="var(--font-fragment)" fontSize={7 / Math.sqrt(view.k)}>
            {lat.map((la) => (
              <text key={la} x={4} y={latY(la) - 3}>
                {Math.abs(la)}
                {la >= 0 ? "N" : "S"}
              </text>
            ))}
            {lon.map((lo) => (
              <text key={lo} x={lonX(lo) + 3} y={H - 4}>
                {Math.abs(lo)}
                {lo >= 0 ? "E" : "W"}
              </text>
            ))}
          </g>

          <HexLayer owners={owners} colorOf={colorOf} />

          {/* captured last round */}
          {lastBattles.map((b) => {
            const cap = b.result?.capturedHex ?? -1;
            if (cap < 0) return null;
            const h = HEXES[cap];
            if (!h) return null;
            return (
              <polygon
                key={`cap-${b.id}`}
                points={hexPoints(h.cx, h.cy, S, 0.5)}
                fill="none"
                stroke="#C6FF3D"
                strokeWidth={1.2}
                strokeDasharray="3 2"
                className="pointer-events-none"
              />
            );
          })}

          {/* home bases */}
          {swarms.map((s) => {
            const [x, y] = center(s.homeHex);
            return (
              <g key={s.id} className="pointer-events-none" filter="url(#glow)">
                <polygon points={hexPoints(HEXES[s.homeHex].cx, HEXES[s.homeHex].cy, S, 4.2)} fill="none" stroke={s.color} strokeWidth={1.4} />
                <circle cx={x} cy={y} r={1.8} fill={s.color} />
              </g>
            );
          })}

          {/* battle vectors */}
          {battles.map((b) => {
            const live = b.phase === "live";
            const sel = selectedBattle === b.id;
            const [a, d] = b.prizeHex;
            if (a < 0 || d < 0) return null;
            const [ax, ay] = center(a);
            const [dx, dy] = center(d);
            const stroke = live ? "#FF3B30" : "#C6FF3D";
            return (
              <g
                key={b.id}
                className="cursor-pointer"
                onClick={() => {
                  if (!drag.current?.moved) onSelectBattle?.(b.id);
                }}
              >
                {a !== d && (
                  <line
                    x1={ax}
                    y1={ay}
                    x2={dx}
                    y2={dy}
                    stroke={stroke}
                    strokeWidth={sel ? 1.6 : 1}
                    strokeDasharray="4 3"
                    className="dash-flow"
                    opacity={sel ? 1 : 0.75}
                  />
                )}
                {[a, d].map((hx, i) => {
                  const [x, y] = center(hx);
                  const col = b.sides[i].color;
                  return (
                    <g key={`${b.id}-${hx}-${i}`}>
                      <circle cx={x} cy={y} r={5} fill="none" stroke={stroke} strokeWidth={1} className="ping-ring" />
                      <circle cx={x} cy={y} r={4.2} fill="#07090A" fillOpacity={0.6} stroke={col} strokeWidth={1.1} />
                      <path d={`M${x - 7} ${y}h4M${x + 3} ${y}h4M${x} ${y - 7}v4M${x} ${y + 3}v4`} stroke={stroke} strokeWidth={0.9} />
                    </g>
                  );
                })}
                <circle cx={(ax + dx) / 2} cy={(ay + dy) / 2} r={12} fill="transparent" />
              </g>
            );
          })}

          {/* labels */}
          {swarms.map((s) => {
            const [x, y] = center(s.homeHex);
            const fs = 8 / Math.sqrt(view.k);
            return (
              <g key={`lbl-${s.id}`} className="pointer-events-none">
                <rect x={x + 6} y={y - 15} width={s.ticker.length * fs * 0.68 + 8} height={fs + 5} fill="#07090A" fillOpacity={0.85} stroke={s.color} strokeOpacity={0.5} strokeWidth={0.6} />
                <text x={x + 10} y={y - 15 + fs + 1.5} fill={s.color} fontSize={fs} fontFamily="var(--font-fragment)" letterSpacing={0.6}>
                  {s.ticker}
                </text>
              </g>
            );
          })}

          {hovered && (
            <polygon
              points={hexPoints(hovered.cx, hovered.cy, S, 0.2)}
              fill="rgba(198,255,61,0.12)"
              stroke="#C6FF3D"
              strokeWidth={1.4}
              className="pointer-events-none"
            />
          )}
        </g>
      </svg>

      {/* HUD corners */}
      <div className="pointer-events-none absolute inset-2 brackets" />
      <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-3">
        <span className="label text-lime/80">THEATER</span>
        <span className="label">{HEXES.length} SECTORS</span>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-4 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {hovered ? (
          <span>
            <span className="text-lime">{hexCode(hovered.id)}</span> <span className="text-white/30">//</span> {formatCoord(hovered.lat, hovered.lon)}{" "}
            <span className="text-white/30">//</span> {hovered.region}
          </span>
        ) : (
          <span>
            {engagedUi ? "Scroll to zoom" : "Click map, then scroll to zoom"} <span className="text-white/30">//</span> drag to pan
          </span>
        )}
      </div>
      <div className="absolute bottom-2.5 right-3 flex items-center gap-1">
        <button
          type="button"
          aria-label="Zoom in"
          onClick={() => zoomAt(W / 2, H / 2, 1.4)}
          className="grid h-7 w-7 place-items-center border border-white/10 bg-carbon/80 text-muted-foreground hover:border-lime/50 hover:text-lime"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          onClick={() => zoomAt(W / 2, H / 2, 1 / 1.4)}
          className="grid h-7 w-7 place-items-center border border-white/10 bg-carbon/80 text-muted-foreground hover:border-lime/50 hover:text-lime"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Reset view"
          onClick={() => setView({ k: 1, x: 0, y: 0 })}
          className="grid h-7 w-7 place-items-center border border-white/10 bg-carbon/80 text-muted-foreground hover:border-lime/50 hover:text-lime"
        >
          <Scan className="h-3.5 w-3.5" />
        </button>
      </div>

      {hover && hovered && (
        <div
          className="pointer-events-none absolute z-10 min-w-[170px] border border-lime/40 bg-carbon/95 px-2.5 py-2 font-mono text-[10px] uppercase tracking-[0.12em] shadow-[0_0_24px_rgba(198,255,61,0.12)]"
          style={{
            left: Math.min(hover.px + 14, (wrapRef.current?.clientWidth ?? 400) - 190),
            top: Math.max(8, hover.py - 64),
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-lime">SECTOR {hexCode(hovered.id)}</span>
            <span className="text-white/40">#{hovered.id}</span>
          </div>
          <div className="mt-1 text-foreground/80">{formatCoord(hovered.lat, hovered.lon)}</div>
          <div className="mt-1.5 flex items-center gap-1.5 border-t border-white/10 pt-1.5">
            {hoverOwner ? (
              <>
                <span className="h-2 w-2" style={{ background: hoverOwner.color }} />
                <span style={{ color: hoverOwner.color }}>{hoverOwner.ticker}</span>
                <span className="truncate text-white/50 normal-case tracking-normal">{hoverOwner.name}</span>
                {hoverOwner.homeHex === hovered.id && <span className="ml-auto text-white/40">HQ</span>}
              </>
            ) : (
              <span className="text-white/40">Unclaimed</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
