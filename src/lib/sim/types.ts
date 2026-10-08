export type TargetPriority = "weakest" | "nearest" | "biggest";
export type Formation = "blob" | "ring" | "wedge" | "line";
export type AbilityKind = "emp" | "kamikaze" | "shield" | "decoys";
export type DroneDesign = "dart" | "orb" | "delta" | "shard";

/** Validated behavior config compiled from plain-English tactics. All numbers are integers 0-100. */
export interface BehaviorConfig {
  cohesion: number;
  separation: number;
  alignment: number;
  aggression: number;
  flank: number;
  targetPriority: TargetPriority;
  formation: Formation;
  /** percent HP below which a drone disengages to regenerate (0 = never, max 80) */
  retreatAtHealth: number;
  focusFire: number;
}

export interface SimSideInput {
  baseDrones: number;
  config: BehaviorConfig;
  ability: AbilityKind;
}

export interface SimInput {
  seed: number;
  sides: [SimSideInput, SimSideInput];
}

/** A trade that affects the battle. `tick` is authoritative and assigned by the server. */
export interface SimEvent {
  id: string;
  tick: number;
  side: 0 | 1;
  kind: "buy" | "sell";
  drones: number;
  /** display only */
  sol: number;
  /** display only */
  wallet: string;
  /** display only (ms) */
  ts: number;
}

export const ABILITY_INFO: Record<AbilityKind, { name: string; short: string; cooldownS: number; desc: string }> = {
  emp: { name: "EMP Pulse", short: "EMP", cooldownS: 32, desc: "Stuns and scorches every enemy drone in a 150m radius." },
  kamikaze: { name: "Kamikaze Rush", short: "KMKZ", cooldownS: 26, desc: "The frontline overclocks and detonates on contact." },
  shield: { name: "Shield Wall", short: "SHLD", cooldownS: 30, desc: "Halves all incoming damage for 7 seconds." },
  decoys: { name: "Decoys", short: "DCOY", cooldownS: 28, desc: "Deploys 16 holo-drones that soak enemy fire." },
};

export function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.tick !== b.tick) return a.tick - b.tick;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
