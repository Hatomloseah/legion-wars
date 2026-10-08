import { Meter } from "@/components/hud/primitives";
import { PARAM_INFO, PARAM_ORDER } from "@/lib/game/tactics";
import { ABILITY_INFO, type AbilityKind, type BehaviorConfig } from "@/lib/sim/types";
import { cn } from "@/lib/utils";

/** Compiled behavior config as HUD bars. */
export function DoctrineBars({
  config,
  ability,
  color = "#C6FF3D",
  compact,
  className,
}: {
  config: BehaviorConfig;
  ability?: AbilityKind;
  color?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3", className)}>
      <div className={cn("grid gap-x-5", compact ? "gap-y-1.5" : "gap-y-2.5 sm:grid-cols-2")}>
        {PARAM_ORDER.map((k) => {
          const info = PARAM_INFO[k];
          const v = config[k];
          return (
            <div key={k} title={info.desc} className="grid grid-cols-[34px_1fr_28px] items-center gap-2">
              <span className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground">{info.short}</span>
              <Meter value={v / info.max} color={color} segments={compact ? 16 : 20} className={compact ? "h-1" : "h-1.5"} />
              <span className="text-right font-mono text-[11px] text-foreground/85 tabular">{v}</span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Chip k="TGT" v={config.targetPriority} />
        <Chip k="FRM" v={config.formation} />
        {ability && <Chip k="ABL" v={ABILITY_INFO[ability].name} accent />}
      </div>
    </div>
  );
}

function Chip({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
        accent ? "border-lime/50 text-lime" : "border-white/10 text-foreground/80",
      )}
    >
      <span className="text-muted-foreground">{k}</span>
      {v}
    </span>
  );
}
