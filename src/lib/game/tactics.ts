import type { AbilityKind, BehaviorConfig, Formation, TargetPriority } from "@/lib/sim/types";

export const TACTICS_MAX = 280;
export const TACTICS_MIN = 12;

export const FORMATIONS: Formation[] = ["blob", "ring", "wedge", "line"];
export const PRIORITIES: TargetPriority[] = ["weakest", "nearest", "biggest"];
export const ABILITIES: AbilityKind[] = ["emp", "kamikaze", "shield", "decoys"];

export type NumericParam = "cohesion" | "separation" | "alignment" | "aggression" | "flank" | "focusFire" | "retreatAtHealth";

export const PARAM_INFO: Record<NumericParam, { label: string; short: string; desc: string; max: number }> = {
  cohesion: { label: "Cohesion", short: "COH", desc: "How hard drones pull toward their neighbors.", max: 100 },
  separation: { label: "Separation", short: "SEP", desc: "Personal space. High values make a loose cloud.", max: 100 },
  alignment: { label: "Alignment", short: "ALN", desc: "How much drones match their neighbors' heading.", max: 100 },
  aggression: { label: "Aggression", short: "AGR", desc: "Charge speed, fire rate and how early they engage.", max: 100 },
  flank: { label: "Flanking", short: "FLK", desc: "How wide the wings swing around the enemy.", max: 100 },
  focusFire: { label: "Focus fire", short: "FOC", desc: "Share of drones shooting the swarm-wide priority target.", max: 100 },
  retreatAtHealth: { label: "Retreat at HP", short: "RTR", desc: "Drones below this HP pull back to regenerate. 0 = never.", max: 80 },
};

export const PARAM_ORDER: NumericParam[] = ["aggression", "cohesion", "separation", "alignment", "flank", "focusFire", "retreatAtHealth"];

function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  if (!Number.isFinite(n)) return d;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function pick<T extends string>(v: unknown, opts: readonly T[], d: T): T {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return (opts as readonly string[]).includes(s) ? (s as T) : d;
}

/** Validate anything (LLM output, client input) into a legal behavior config. */
export function sanitizeConfig(raw: unknown): BehaviorConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    cohesion: clampInt(r.cohesion, 0, 100, 50),
    separation: clampInt(r.separation, 0, 100, 50),
    alignment: clampInt(r.alignment, 0, 100, 50),
    aggression: clampInt(r.aggression, 0, 100, 50),
    flank: clampInt(r.flank, 0, 100, 20),
    targetPriority: pick(r.targetPriority, PRIORITIES, "nearest"),
    formation: pick(r.formation, FORMATIONS, "blob"),
    retreatAtHealth: clampInt(r.retreatAtHealth, 0, 80, 0),
    focusFire: clampInt(r.focusFire, 0, 100, 30),
  };
}

export function sanitizeAbility(v: unknown, d: AbilityKind = "emp"): AbilityKind {
  return pick(v, ABILITIES, d);
}

export function cleanTactics(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TACTICS_MAX);
}

interface Rule {
  re: RegExp;
  apply: (c: BehaviorConfig, votes: Record<AbilityKind, number>) => void;
}

const RULES: Rule[] = [
  { re: /\b(flank|wide|wings?|surround|pincer|encircle|envelop|sides?)\b/, apply: (c) => (c.flank = Math.max(c.flank, 78)) },
  { re: /\b(tight|together|cluster|ball|clump|huddle|close ranks|stick together|phalanx)\b/, apply: (c) => ((c.cohesion += 28), (c.separation -= 15)) },
  { re: /\b(loose|spread|scatter|cloud|disperse|swarm out|fog)\b/, apply: (c) => ((c.separation += 28), (c.cohesion -= 20)) },
  { re: /\b(aggressive|charge|rush|attack|relentless|all.?in|berserk|blitz|storm|never stop|press)\b/, apply: (c) => (c.aggression += 28) },
  { re: /\b(patient|defend|defensive|hold|wait|turtle|bait|let them come|counter|careful|cautious)\b/, apply: (c) => (c.aggression -= 26) },
  { re: /\b(weakest|weak|finish|pick off|wounded|damaged|low hp|stragglers?)\b/, apply: (c) => (c.targetPriority = "weakest") },
  { re: /\b(biggest|largest|cluster|densest|main body|blob|crowd|thickest)\b/, apply: (c) => (c.targetPriority = "biggest") },
  { re: /\b(nearest|closest|whatever is near|in front)\b/, apply: (c) => (c.targetPriority = "nearest") },
  { re: /\b(ring|circle|orbit|halo|donut|perimeter)\b/, apply: (c) => (c.formation = "ring") },
  { re: /\b(wedge|spear|arrow|spearhead|v.?shape|chevron|tip|drill|lance)\b/, apply: (c) => (c.formation = "wedge") },
  { re: /\b(line|wall|row|rank|shield wall|firing line|column)\b/, apply: (c) => (c.formation = "line") },
  { re: /\b(retreat|heal|pull back|fall back|regenerate|repair|preserve|survive)\b/, apply: (c) => (c.retreatAtHealth = Math.max(c.retreatAtHealth, 38)) },
  { re: /\b(never retreat|no retreat|fight to the death|to the last|no mercy|suicid)/, apply: (c) => (c.retreatAtHealth = 0) },
  { re: /\b(focus|same target|concentrate|together fire|all fire|one target|gang up|dogpile)\b/, apply: (c) => (c.focusFire = Math.max(c.focusFire, 82)) },
  { re: /\b(each picks?|independent|free fire|own target|chaos|random)\b/, apply: (c) => (c.focusFire = Math.min(c.focusFire, 15)) },
  { re: /\b(formation|discipline|disciplined|aligned|synchron|march|in step)\b/, apply: (c) => (c.alignment += 25) },
  { re: /\b(emp|stun|pulse|disable|short.?circuit|fry|electr)/, apply: (_c, v) => (v.emp += 3) },
  { re: /\b(kamikaze|explode|detonate|suicide|ram|blow up|self.?destruct|sacrifice)/, apply: (_c, v) => (v.kamikaze += 3) },
  { re: /\b(shield|armor|armour|protect|tank|absorb|fortress|bunker)/, apply: (_c, v) => (v.shield += 3) },
  { re: /\b(decoy|confuse|trick|hologram|ghost|fake|bait|illusion|mirage|feint)/, apply: (_c, v) => (v.decoys += 3) },
];

/**
 * Deterministic fallback compiler (used when no LLM key is configured or the LLM fails).
 * Keyword scoring over a neutral baseline, always producing a legal config.
 */
export function heuristicCompile(text: string): { config: BehaviorConfig; ability: AbilityKind; summary: string } {
  const t = ` ${text.toLowerCase()} `;
  const c: BehaviorConfig = {
    cohesion: 50,
    separation: 50,
    alignment: 50,
    aggression: 55,
    flank: 15,
    targetPriority: "nearest",
    formation: "blob",
    retreatAtHealth: 0,
    focusFire: 35,
  };
  const votes: Record<AbilityKind, number> = { emp: 0, kamikaze: 0, shield: 0, decoys: 0 };
  for (const r of RULES) if (r.re.test(t)) r.apply(c, votes);
  if (c.aggression > 70) votes.kamikaze += 1;
  if (c.aggression < 40) votes.shield += 1;
  if (c.separation > 70) votes.decoys += 1;
  if (c.targetPriority === "biggest") votes.emp += 1;
  if (c.formation === "line" || c.formation === "wedge") c.alignment += 10;
  let ability: AbilityKind = "emp";
  let best = -1;
  for (const k of ABILITIES) {
    if (votes[k] > best) {
      best = votes[k];
      ability = k;
    }
  }
  const config = sanitizeConfig(c);
  const tone = config.aggression >= 70 ? "Aggressive" : config.aggression <= 38 ? "Defensive" : "Balanced";
  const summary = `${tone} ${config.formation} legion that targets the ${config.targetPriority} enemy${config.flank >= 60 ? " from wide flanks" : ""}${
    config.retreatAtHealth > 0 ? `, pulling drones back under ${config.retreatAtHealth} HP` : ""
  }.`;
  return { config, ability, summary };
}

/** Example prompts for the create flow. */
export const TACTIC_EXAMPLES = [
  "Hit them from both flanks at once, focus everything on the weakest drone, never retreat.",
  "Turtle in a tight ring, pull damaged drones back to heal, shield up when they charge.",
  "Loose cloud, confuse them with decoys, hunt whatever cluster is biggest.",
  "Spearhead wedge straight down the middle and detonate the front row on contact.",
];
