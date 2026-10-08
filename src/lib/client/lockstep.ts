import { BATTLE_TICKS, type AbilityFx, BattleSim, type DeathFx, type SimSnapshot, type SpawnFx, TICK_MS } from "@/lib/sim/engine";
import { type SimEvent, type SimInput, compareEvents } from "@/lib/sim/types";
import type { BattleDetail, BattleRecord } from "@/lib/game/types";

/** Live clients run this far behind the server clock so trades usually arrive before their tick. */
export const LIVE_DELAY_MS = 2500;
const SNAPSHOT_EVERY = 50;

export type StageMode = "preview" | "live" | "replay";

export interface FxBatch {
  deaths: DeathFx[];
  spawns: SpawnFx[];
  abilities: AbilityFx[];
}

type Listener = {
  spawn: (s: SpawnFx) => void;
  sell: (e: SimEvent) => void;
  ability: (a: AbilityFx) => void;
  reset: () => void;
};

export function simInputFor(b: BattleRecord): SimInput {
  return {
    seed: b.seed,
    sides: [
      { baseDrones: b.sides[0].baseDrones, config: b.sides[0].config, ability: b.sides[0].ability },
      { baseDrones: b.sides[1].baseDrones, config: b.sides[1].config, ability: b.sides[1].ability },
    ],
  };
}

/**
 * Deterministic lockstep driver: seed + configs + time-ordered event log -> identical battle on every client.
 * Late events trigger a rollback to the nearest snapshot and a silent re-simulation.
 */
export class LockstepController {
  readonly battle: BattleRecord;
  sim: BattleSim;
  events: SimEvent[] = [];
  private ids = new Set<string>();
  private ptr = 0;
  private snapshots: SimSnapshot[] = [];
  private announced = new Set<string>();
  private listeners: { [K in keyof Listener]: Set<Listener[K]> } = {
    spawn: new Set(),
    sell: new Set(),
    ability: new Set(),
    reset: new Set(),
  };
  fx: FxBatch = { deaths: [], spawns: [], abilities: [] };

  mode: StageMode;
  serverOffset = 0;
  replayMs = 0;
  replaySpeed = 1;
  paused = false;
  alpha = 1;
  /** ticks the sim is behind its target (catch-up indicator) */
  behind = 0;
  rollbacks = 0;
  checksum = 0;

  constructor(detail: BattleDetail, clientNow: number) {
    this.battle = detail.battle;
    this.sim = new BattleSim(simInputFor(detail.battle));
    this.serverOffset = detail.now - clientNow;
    this.mode = detail.phase === "upcoming" ? "preview" : detail.phase === "live" ? "live" : "replay";
    this.merge(detail.events);
    this.checksum = this.sim.checksum();
  }

  on<K extends keyof Listener>(k: K, fn: Listener[K]): () => void {
    this.listeners[k].add(fn);
    return () => this.listeners[k].delete(fn);
  }

  serverNow(): number {
    return Date.now() + this.serverOffset;
  }

  /** Merge newly polled events; roll back if any landed in the simulated past. */
  merge(incoming: SimEvent[]): number {
    let minTick = Number.POSITIVE_INFINITY;
    let added = 0;
    for (const e of incoming) {
      if (this.ids.has(e.id)) continue;
      this.ids.add(e.id);
      this.events.push(e);
      added++;
      if (e.tick < this.sim.tick) minTick = Math.min(minTick, e.tick);
    }
    if (!added) return 0;
    this.events.sort(compareEvents);
    if (minTick !== Number.POSITIVE_INFINITY) this.rewindTo(minTick, true);
    this.ptr = this.firstIndexAtOrAfter(this.sim.tick);
    return added;
  }

  private firstIndexAtOrAfter(tick: number): number {
    let i = 0;
    while (i < this.events.length && this.events[i].tick < tick) i++;
    return i;
  }

  private rewindTo(tick: number, isRollback: boolean): void {
    let snap: SimSnapshot | null = null;
    for (const s of this.snapshots) if (s.tick <= tick && (!snap || s.tick > snap.tick)) snap = s;
    if (snap) this.sim.restore(snap);
    else this.sim = new BattleSim(simInputFor(this.battle));
    this.snapshots = this.snapshots.filter((s) => s.tick <= this.sim.tick);
    this.ptr = this.firstIndexAtOrAfter(this.sim.tick);
    if (isRollback) this.rollbacks++;
    for (const fn of this.listeners.reset) fn();
  }

  private stepOnce(silent: boolean): void {
    const sim = this.sim;
    if (sim.tick % SNAPSHOT_EVERY === 0 && !this.snapshots.some((s) => s.tick === sim.tick)) {
      this.snapshots.push(sim.snapshot());
    }
    const batch: SimEvent[] = [];
    while (this.ptr < this.events.length && this.events[this.ptr].tick <= sim.tick) {
      if (this.events[this.ptr].tick === sim.tick) batch.push(this.events[this.ptr]);
      this.ptr++;
    }
    sim.step(batch);
    if (sim.tick % 10 === 0) this.checksum = sim.checksum();

    for (const e of batch) {
      if (this.announced.has(e.id)) continue;
      this.announced.add(e.id);
      if (silent) continue;
      if (e.kind === "sell") for (const fn of this.listeners.sell) fn(e);
    }
    if (silent) return;
    for (const d of sim.deaths) this.fx.deaths.push(d);
    for (const s of sim.spawns) {
      this.fx.spawns.push(s);
      for (const fn of this.listeners.spawn) fn(s);
    }
    for (const a of sim.fx) {
      this.fx.abilities.push(a);
      for (const fn of this.listeners.ability) fn(a);
    }
  }

  /** Battle time (ms since start) the sim should be showing right now. */
  targetMs(): number {
    if (this.mode === "preview") return 0;
    if (this.mode === "replay") return this.replayMs;
    return this.serverNow() - this.battle.startsAt - LIVE_DELAY_MS;
  }

  isLiveWindow(): boolean {
    return this.serverNow() < this.battle.endsAt;
  }

  update(dtMs: number): void {
    if (this.mode === "replay" && !this.paused) {
      this.replayMs = Math.min(BATTLE_TICKS * TICK_MS, this.replayMs + dtMs * this.replaySpeed);
    }
    if (this.mode === "preview") {
      if (this.serverNow() >= this.battle.startsAt) this.mode = "live";
      else {
        this.alpha = 1;
        return;
      }
    }
    const rt = Math.max(0, Math.min(BATTLE_TICKS, this.targetMs() / TICK_MS));
    const want = Math.min(BATTLE_TICKS, Math.floor(rt) + 1);
    if (want < this.sim.tick - 1 && this.mode === "replay") this.rewindTo(Math.max(0, want - 1), false);

    const t0 = performance.now();
    while (this.sim.tick < want) {
      const remaining = want - this.sim.tick;
      this.stepOnce(remaining > 4);
      if (performance.now() - t0 > (remaining > 4 ? 26 : 10)) break;
    }
    this.behind = want - this.sim.tick;
    this.alpha = this.sim.tick === want ? Math.max(0, Math.min(1, rt - (want - 1))) : 1;
    if (this.sim.tick >= BATTLE_TICKS) this.alpha = 1;
  }

  takeFx(): FxBatch {
    const out = this.fx;
    this.fx = { deaths: [], spawns: [], abilities: [] };
    return out;
  }

  startReplay(fromMs = 0): void {
    this.mode = "replay";
    this.paused = false;
    this.replayMs = fromMs;
    this.rewindTo(Math.floor(fromMs / TICK_MS), false);
    this.announced.clear();
    // mark everything before the seek point as already shown
    for (const e of this.events) if (e.tick < this.sim.tick) this.announced.add(e.id);
  }

  seek(ms: number): void {
    this.startReplay(Math.max(0, Math.min(BATTLE_TICKS * TICK_MS, ms)));
  }

  appliedEvents(limit = 16): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = this.events.length - 1; i >= 0 && out.length < limit; i--) {
      if (this.events[i].tick < this.sim.tick) out.push(this.events[i]);
    }
    return out;
  }

  done(): boolean {
    return this.sim.tick >= BATTLE_TICKS;
  }
}
