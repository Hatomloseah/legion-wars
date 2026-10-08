import type { AbilityKind, BehaviorConfig, DroneDesign } from "@/lib/sim/types";

export interface HouseSwarmDef {
  id: string;
  name: string;
  ticker: string;
  color: string;
  design: DroneDesign;
  tactics: string;
  config: BehaviorConfig;
  ability: AbilityKind;
  description: string;
  /** approximate home location (lat, lon) */
  home: [number, number];
  mcapSol: number;
  /** the platform's own legion, traded as $LEGION */
  flagship?: boolean;
}

export const FLAGSHIP_ID = "first-legion";
export const FLAGSHIP_TICKER = "LEGION";

/**
 * True when a battle side has no real pump.fun market (house legion or demo launch).
 * Older battle records have no `demo` flag: house and demo-wallet creators were always simulated.
 */
export function isSimulatedSide(s: { demo?: boolean; creator: string }): boolean {
  return s.demo ?? (s.creator === "HOUSE" || s.creator.startsWith("DEMo"));
}

export const HOUSE_SWARMS: HouseSwarmDef[] = [
  {
    id: FLAGSHIP_ID,
    flagship: true,
    description: "The founding legion. Every $LEGION buy drops fresh drones into its line. Every legion on the map wants its sectors.",
    name: "The First Legion",
    ticker: FLAGSHIP_TICKER,
    color: "#C6FF3D",
    design: "shard",
    tactics: "Disciplined wedge straight down the center. Everyone focuses the biggest cluster. Shield up on contact and never retreat.",
    config: { cohesion: 70, separation: 45, alignment: 85, aggression: 72, flank: 25, targetPriority: "biggest", formation: "wedge", retreatAtHealth: 0, focusFire: 70 },
    ability: "shield",
    home: [33, 40],
    mcapSol: 420,
  },
  {
    id: "kestrel",
    description: "Raptor-class interceptors out of the Great Plains. They never fight where you expect them.",
    name: "Kestrel Wing",
    ticker: "KSTRL",
    color: "#FF7A1A",
    design: "dart",
    tactics: "Flank wide on both sides, then collapse on the weakest enemy. Never stop moving.",
    config: { cohesion: 45, separation: 55, alignment: 70, aggression: 82, flank: 90, targetPriority: "weakest", formation: "wedge", retreatAtHealth: 0, focusFire: 35 },
    ability: "kamikaze",
    home: [40, -100],
    mcapSol: 140,
  },
  {
    id: "monolith",
    description: "A slow white wall from the North Sea. Patient, armored, impossible to dislodge.",
    name: "Monolith",
    ticker: "MONO",
    color: "#E9E6DA",
    design: "orb",
    tactics: "Hold a tight ring and let them come. Pull damaged drones back to heal. Shield up when they hit.",
    config: { cohesion: 85, separation: 40, alignment: 45, aggression: 28, flank: 0, targetPriority: "nearest", formation: "ring", retreatAtHealth: 35, focusFire: 20 },
    ability: "shield",
    home: [50, 15],
    mcapSol: 260,
  },
  {
    id: "needle",
    description: "An Andean choir of shard drones that sing on one frequency and strike on one target.",
    name: "Needle Choir",
    ticker: "NDL",
    color: "#FF3DA5",
    design: "shard",
    tactics: "Form a line, everyone fires at the same target. Send the front row in to explode on contact.",
    config: { cohesion: 55, separation: 50, alignment: 60, aggression: 70, flank: 15, targetPriority: "nearest", formation: "line", retreatAtHealth: 0, focusFire: 90 },
    ability: "kamikaze",
    home: [-15, -58],
    mcapSol: 90,
  },
  {
    id: "miasma",
    description: "A Gulf of Guinea fog bank of drones and ghosts. You never know which is which.",
    name: "Miasma",
    ticker: "MIASM",
    color: "#22E5C0",
    design: "orb",
    tactics: "Swarm as a loose cloud, confuse them with decoys, hunt whatever is biggest.",
    config: { cohesion: 30, separation: 80, alignment: 25, aggression: 60, flank: 45, targetPriority: "biggest", formation: "blob", retreatAtHealth: 20, focusFire: 25 },
    ability: "decoys",
    home: [5, 22],
    mcapSol: 55,
  },
  {
    id: "halcyon",
    description: "Golden spearhead squadrons from the steppe. EMP first, questions never.",
    name: "Halcyon",
    ticker: "HALO",
    color: "#FFE14D",
    design: "delta",
    tactics: "Spearhead wedge straight down the middle. Hit the biggest cluster with EMP, then pile in.",
    config: { cohesion: 65, separation: 45, alignment: 80, aggression: 75, flank: 20, targetPriority: "biggest", formation: "wedge", retreatAtHealth: 15, focusFire: 55 },
    ability: "emp",
    home: [48, 100],
    mcapSol: 320,
  },
  {
    id: "glasswing",
    description: "Australian long-range snipers. Fragile, patient, lethal from the edge of the field.",
    name: "Glasswing",
    ticker: "GLASS",
    color: "#7CD8FF",
    design: "delta",
    tactics: "Stay patient in a long line, pick off the weakest, retreat early, EMP anything that charges.",
    config: { cohesion: 50, separation: 60, alignment: 55, aggression: 38, flank: 30, targetPriority: "weakest", formation: "line", retreatAtHealth: 45, focusFire: 60 },
    ability: "emp",
    home: [-26, 134],
    mcapSol: 110,
  },
];
