import { DoctrineBars } from "@/components/hud/DoctrineBars";
import { DroneGlyph } from "@/components/hud/DroneGlyph";
import { SwarmDot } from "@/components/hud/primitives";
import { baseDrones, dronesForBuy } from "@/lib/game/drones";
import { ABILITY_INFO, type AbilityKind, type BehaviorConfig, type DroneDesign } from "@/lib/sim/types";

export function LegionPreview({
  name,
  ticker,
  description,
  color,
  design,
  image,
  config,
  ability,
  summary,
  devBuySol,
}: {
  name: string;
  ticker: string;
  description: string;
  color: string;
  design: DroneDesign;
  image: string | null;
  config: BehaviorConfig | null;
  ability: AbilityKind | null;
  summary: string | null;
  devBuySol: number;
}) {
  return (
    <div className="panel brackets overflow-hidden">
      <div className="label flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
        <span className="flex items-center gap-2">
          <span className="text-lime/80">P</span>
          <span className="text-white/20">//</span>
          <span className="text-foreground/80">Legion preview</span>
        </span>
        <span className="text-white/30">Unlaunched</span>
      </div>
      <div className="relative px-4 pb-4 pt-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40" style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}2e, transparent 70%)` }} />
        <div className="relative flex items-start gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center border border-white/10 bg-carbon/60">
            {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <DroneGlyph design={design} color={color} className="h-14 w-14" />}
          </div>
          <div className="min-w-0 pt-1">
            <div className="flex items-center gap-2">
              <SwarmDot color={color} />
              <span className="font-mono text-[11px] tracking-[0.14em]" style={{ color }}>
                ${ticker || "TICKER"}
              </span>
            </div>
            <div className="mt-1 truncate font-display text-[22px] font-black uppercase leading-none tracking-[0.04em]" style={{ textShadow: `0 0 22px ${color}55` }}>
              {name || "Unnamed legion"}
            </div>
            <p className="mt-2 line-clamp-3 text-[13px] leading-snug text-muted-foreground">{description || "Your legion's one-line legend goes here."}</p>
          </div>
        </div>

        <div className="relative mt-4 flex items-center justify-center border border-white/[0.06] bg-carbon/50 py-3">
          <div className="hud-grid-fine absolute inset-0 opacity-60" />
          {[0, 1, 2, 3, 4].map((i) => (
            <DroneGlyph
              key={i}
              design={design}
              color={color}
              glow={i === 2}
              className={i === 2 ? "relative h-14 w-14" : "relative h-8 w-8 opacity-60"}
            />
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-px border border-white/[0.06] bg-white/[0.06] text-center">
          {[
            ["Base", baseDrones(28 + devBuySol)],
            ["Per 1 SOL", `+${dronesForBuy(1)}`],
            ["Home", "On launch"],
          ].map(([k, v]) => (
            <div key={String(k)} className="bg-[#0b0e0d] px-2 py-2">
              <div className="label text-[9px]">{k}</div>
              <div className="mt-1 font-mono text-[14px] tabular">{v}</div>
            </div>
          ))}
        </div>

        <div className="mt-4">
          <div className="label mb-2">Doctrine</div>
          {config ? (
            <>
              {summary && <p className="mb-3 border-l-2 pl-2.5 text-[13px] leading-snug text-foreground/85" style={{ borderColor: color }}>{summary}</p>}
              <DoctrineBars config={config} ability={ability ?? undefined} color={color} compact />
            </>
          ) : (
            <div className="border border-dashed border-white/10 px-3 py-4 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Compile your tactics to see the doctrine
              {ability && <div className="mt-1 text-lime">{ABILITY_INFO[ability].name}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
