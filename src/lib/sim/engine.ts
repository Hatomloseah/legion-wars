import { FX, Rng, cosFx, hash32, isqrt, sinFx } from "./fixed";
import type { AbilityKind, BehaviorConfig, SimEvent, SimInput } from "./types";

/**
 * SWARM deterministic battle simulation.
 * A battle = seed + both configs + base sizes + time-ordered event log.
 * Integer state, fixed timestep, seeded PRNG, LUT trig -> same result everywhere.
 */

export const TICK_MS = 100;
export const BATTLE_TICKS = 1800; // 3 minutes
export const CAP = 4096;

const U = FX;
export const HALF_W = 900 * U;
export const HALF_D = 550 * U;
const HOME_X = 640 * U;
const GATE_X = 990 * U;
const RETREAT_X = 820 * U;
const BOUND_X = 1150 * U;
const BOUND_Z = 660 * U;

const CELL = 48 * U;
const GX0 = -1200 * U;
const GZ0 = -720 * U;
const GCOLS = 50;
const GROWS = 30;
const GCELLS = GCOLS * GROWS;

const ATTACK_R = 72 * U;
const ATTACK_R2 = ATTACK_R * ATTACK_R;
const NEIGH_R = 46 * U;
const NEIGH_R2 = NEIGH_R * NEIGH_R;
const SEP_R = 17 * U;
const SEP_R2 = SEP_R * SEP_R;
const ACCEL = 1300;
const BASE_HP = 100;
const DMG = 4;
const KAMIKAZE_DMG = 40;
const KAMIKAZE_R = 58 * U;
const EMP_R = 150 * U;
const EMP_DMG = 8;
const DECOY_HP = 30;

export const CAUSE = { combat: 0, sell: 1, kamikaze: 2, emp: 3, expire: 4 } as const;

export interface SideStats {
  base: number;
  spawned: number;
  sold: number;
  lost: number;
  kills: number;
  peak: number;
  abilityUses: number;
}

export interface SideState {
  cfg: BehaviorConfig;
  ability: AbilityKind;
  abilityCd: number;
  shield: number;
  focus: number;
  count: number;
  hpSum: number;
  decoys: number;
  cx: number;
  cz: number;
  fx: number;
  fz: number;
  stats: SideStats;
}

export interface DeathFx {
  x: number;
  z: number;
  side: number;
  cause: number;
  decoy: boolean;
}
export interface SpawnFx {
  side: number;
  x: number;
  z: number;
  count: number;
  event: SimEvent;
}
export interface AbilityFx {
  side: number;
  kind: AbilityKind;
  x: number;
  z: number;
  r: number;
}

export interface BattleResultData {
  winner: 0 | 1;
  alive: [number, number];
  hp: [number, number];
  stats: [SideStats, SideStats];
  ticks: number;
}

const ARRAYS = [
  "x", "z", "vx", "vz", "spd", "hp", "side", "alive", "kind", "mode", "stun", "cd",
  "target", "life", "born", "shotT", "shotTick", "hitTick",
] as const;
type ArrayKey = (typeof ARRAYS)[number];

export interface SimSnapshot {
  tick: number;
  n: number;
  rng: number;
  arrays: Record<ArrayKey, Int32Array | Int16Array | Uint8Array>;
  sides: [SideState, SideState];
}

/** int32 truncation toward zero (all sim magnitudes are < 2^31). Never yields -0, keeps JITs on the int path. */
function tr(v: number): number {
  return v | 0;
}

// scratch outputs for setLen (avoid allocations in hot loops)
let OX = 0;
let OZ = 0;
function setLen(x: number, z: number, len: number): void {
  const l = isqrt(x * x + z * z);
  if (l === 0) {
    OX = 0;
    OZ = 0;
    return;
  }
  OX = tr((x * len) / l);
  OZ = tr((z * len) / l);
}

function makeSide(cfg: BehaviorConfig, ability: AbilityKind, sd: number): SideState {
  return {
    cfg: {
      cohesion: cfg.cohesion | 0,
      separation: cfg.separation | 0,
      alignment: cfg.alignment | 0,
      aggression: cfg.aggression | 0,
      flank: cfg.flank | 0,
      targetPriority: cfg.targetPriority,
      formation: cfg.formation,
      retreatAtHealth: cfg.retreatAtHealth | 0,
      focusFire: cfg.focusFire | 0,
    },
    ability,
    abilityCd: 0,
    shield: 0,
    focus: -1,
    count: 0,
    hpSum: 0,
    decoys: 0,
    cx: 0,
    cz: 0,
    fx: sd === 0 ? FX : -FX,
    fz: 0,
    stats: { base: 0, spawned: 0, sold: 0, lost: 0, kills: 0, peak: 0, abilityUses: 0 },
  };
}

function cloneSide(s: SideState, sd: number): SideState {
  const o = makeSide(s.cfg, s.ability, sd);
  o.abilityCd = s.abilityCd;
  o.shield = s.shield;
  o.focus = s.focus;
  o.count = s.count;
  o.hpSum = s.hpSum;
  o.decoys = s.decoys;
  o.cx = s.cx;
  o.cz = s.cz;
  o.fx = s.fx;
  o.fz = s.fz;
  o.stats.base = s.stats.base;
  o.stats.spawned = s.stats.spawned;
  o.stats.sold = s.stats.sold;
  o.stats.lost = s.stats.lost;
  o.stats.kills = s.stats.kills;
  o.stats.peak = s.stats.peak;
  o.stats.abilityUses = s.stats.abilityUses;
  return o;
}

export class BattleSim {
  readonly seed: number;
  tick = 0;
  n = 0;

  x = new Int32Array(CAP);
  z = new Int32Array(CAP);
  vx = new Int32Array(CAP);
  vz = new Int32Array(CAP);
  px = new Int32Array(CAP);
  pz = new Int32Array(CAP);
  spd = new Int32Array(CAP);
  hp = new Int16Array(CAP);
  side = new Uint8Array(CAP);
  alive = new Uint8Array(CAP);
  /** 0 = drone, 1 = decoy */
  kind = new Uint8Array(CAP);
  /** 0 = normal, 1 = retreat, 2 = kamikaze */
  mode = new Uint8Array(CAP);
  stun = new Uint8Array(CAP);
  cd = new Uint8Array(CAP);
  target = new Int32Array(CAP);
  life = new Int16Array(CAP);
  born = new Int32Array(CAP);
  shotT = new Int32Array(CAP);
  shotTick = new Int32Array(CAP);
  hitTick = new Int32Array(CAP);

  rng: Rng;
  s: [SideState, SideState];

  // per-step logs for rendering (not part of state)
  deaths: DeathFx[] = [];
  spawns: SpawnFx[] = [];
  fx: AbilityFx[] = [];

  // derived per tick
  private pend = new Int32Array(CAP);
  private pendCause = new Uint8Array(CAP);
  private nvx = new Int32Array(CAP);
  private nvz = new Int32Array(CAP);
  private cellCount = new Int32Array(GCELLS);
  private cellStart = new Int32Array(GCELLS + 1);
  private cellCursor = new Int32Array(GCELLS);
  private cellItems = new Int32Array(CAP);
  private cellOf = new Int32Array(CAP);
  private sideCell: [Int32Array, Int32Array] = [new Int32Array(GCELLS), new Int32Array(GCELLS)];
  private aliveList = new Int32Array(CAP);
  private aliveN = 0;

  constructor(input: SimInput) {
    this.seed = input.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.target.fill(-1);
    this.shotT.fill(-1);
    this.shotTick.fill(-1000);
    this.hitTick.fill(-1000);
    this.s = [makeSide(input.sides[0].config, input.sides[0].ability, 0), makeSide(input.sides[1].config, input.sides[1].ability, 1)];

    for (let sd = 0; sd < 2; sd++) {
      const S = this.s[sd];
      S.abilityCd = 150 + this.rng.int(70);
      const base = Math.max(0, Math.min(1000, tr(input.sides[sd].baseDrones)));
      S.stats.base = base;
      const hx = sd === 0 ? -HOME_X : HOME_X;
      const spread = 80 * U + isqrt(base) * 9 * U;
      for (let k = 0; k < base; k++) {
        const i = this.spawn(sd, hx + this.rng.range(-spread, spread) / 2, this.rng.range(-spread, spread), 0, 0);
        if (i >= 0) this.born[i] = -1000;
      }
    }
    this.aggregate();
  }

  private spawn(sd: number, x: number, z: number, vx: number, vz: number, kind = 0): number {
    if (this.n >= CAP) return -1;
    const i = this.n++;
    this.x[i] = x;
    this.z[i] = z;
    this.px[i] = x;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vz[i] = vz;
    this.side[i] = sd;
    this.alive[i] = 1;
    this.kind[i] = kind;
    this.mode[i] = 0;
    this.stun[i] = 0;
    this.cd[i] = (hash32(i, this.seed) % 8) as number;
    this.target[i] = -1;
    this.born[i] = this.tick;
    this.hp[i] = kind === 1 ? DECOY_HP : BASE_HP;
    this.life[i] = kind === 1 ? 90 : 0;
    this.spd[i] = kind === 1 ? 5 * U : 6 * U + (hash32(i, this.seed ^ 0x55) % (2 * U));
    return i;
  }

  // ---------------------------------------------------------------- events
  private reinforce(ev: SimEvent): void {
    const sd = ev.side;
    const dir = sd === 0 ? 1 : -1;
    const gx = -dir * GATE_X;
    const gz = this.rng.range(-400 * U, 400 * U);
    let made = 0;
    for (let k = 0; k < ev.drones; k++) {
      const ox = this.rng.range(0, 160 * U);
      const oz = this.rng.range(-85 * U, 85 * U);
      const i = this.spawn(sd, gx - dir * ox, gz + oz, dir * 7 * U, 0);
      if (i < 0) break;
      made++;
    }
    this.s[sd].stats.spawned += made;
    this.spawns.push({ side: sd, x: gx / U, z: gz / U, count: made, event: ev });
  }

  private sell(ev: SimEvent): void {
    const sd = ev.side;
    const list: number[] = [];
    for (let i = 0; i < this.n; i++) {
      if (this.alive[i] && this.side[i] === sd && this.kind[i] === 0) list.push(i);
    }
    list.sort((a, b) => this.hp[a] - this.hp[b] || a - b);
    const k = Math.min(ev.drones, list.length);
    for (let j = 0; j < k; j++) this.kill(list[j], CAUSE.sell);
    this.s[sd].stats.sold += k;
  }

  // ---------------------------------------------------------------- core
  step(events: SimEvent[]): void {
    this.deaths.length = 0;
    this.spawns.length = 0;
    this.fx.length = 0;

    this.px.set(this.x.subarray(0, this.n));
    this.pz.set(this.z.subarray(0, this.n));

    for (const ev of events) {
      if (ev.drones <= 0) continue;
      if (ev.kind === "buy") this.reinforce(ev);
      else this.sell(ev);
    }

    this.buildGrid();
    this.aggregate();
    for (let sd = 0; sd < 2; sd++) {
      if (this.tick % 10 === 0 || !this.validTarget(this.s[sd].focus, 1 - sd)) this.refreshFocus(sd);
    }
    this.abilities();

    const list = this.aliveList;
    for (let k = 0; k < this.aliveN; k++) {
      const i = list[k];
      if (this.alive[i]) this.think(i);
    }

    // resolve damage simultaneously (no index-order advantage)
    for (let k = 0; k < this.aliveN; k++) {
      const i = list[k];
      const d = this.pend[i];
      if (d === 0) continue;
      this.pend[i] = 0;
      if (!this.alive[i]) continue;
      this.hp[i] -= d;
      if (this.hp[i] <= 0) this.kill(i, this.pendCause[i]);
    }

    // integrate + timers
    for (let k = 0; k < this.aliveN; k++) {
      const i = list[k];
      if (!this.alive[i]) continue;
      let vx = this.nvx[i];
      let vz = this.nvz[i];
      let x = this.x[i] + vx;
      let z = this.z[i] + vz;
      if (x < -BOUND_X) {
        x = -BOUND_X;
        vx = 0;
      } else if (x > BOUND_X) {
        x = BOUND_X;
        vx = 0;
      }
      if (z < -BOUND_Z) {
        z = -BOUND_Z;
        vz = -vz >> 1;
      } else if (z > BOUND_Z) {
        z = BOUND_Z;
        vz = -vz >> 1;
      }
      this.x[i] = x;
      this.z[i] = z;
      this.vx[i] = vx;
      this.vz[i] = vz;
      if (this.stun[i] > 0) this.stun[i]--;
      if (this.kind[i] === 1) {
        this.life[i]--;
        if (this.life[i] <= 0) this.kill(i, CAUSE.expire);
      }
    }
    for (let sd = 0; sd < 2; sd++) {
      const S = this.s[sd];
      if (S.shield > 0) S.shield--;
      if (S.abilityCd > 0) S.abilityCd--;
    }

    this.tick++;
    this.aggregate();
  }

  private validTarget(t: number, enemy: number): boolean {
    return t >= 0 && this.alive[t] === 1 && this.side[t] === enemy;
  }

  private cellIndex(x: number, z: number): number {
    let cx = tr((x - GX0) / CELL);
    let cz = tr((z - GZ0) / CELL);
    if (cx < 0) cx = 0;
    else if (cx >= GCOLS) cx = GCOLS - 1;
    if (cz < 0) cz = 0;
    else if (cz >= GROWS) cz = GROWS - 1;
    return cz * GCOLS + cx;
  }

  private buildGrid(): void {
    const cc = this.cellCount;
    cc.fill(0);
    this.sideCell[0].fill(0);
    this.sideCell[1].fill(0);
    let an = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      this.aliveList[an++] = i;
      const c = this.cellIndex(this.x[i], this.z[i]);
      this.cellOf[i] = c;
      cc[c]++;
      this.sideCell[this.side[i]][c]++;
    }
    this.aliveN = an;
    const st = this.cellStart;
    st[0] = 0;
    for (let c = 0; c < GCELLS; c++) st[c + 1] = st[c] + cc[c];
    this.cellCursor.set(st.subarray(0, GCELLS));
    for (let k = 0; k < an; k++) {
      const i = this.aliveList[k];
      const c = this.cellOf[i];
      this.cellItems[this.cellCursor[c]++] = i;
    }
  }

  aggregate(): void {
    const sums = [0, 0, 0, 0];
    const cnt = [0, 0];
    const hps = [0, 0];
    const dec = [0, 0];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const sd = this.side[i];
      if (this.kind[i] === 1) {
        dec[sd]++;
        continue;
      }
      cnt[sd]++;
      hps[sd] += this.hp[i];
      sums[sd * 2] += this.x[i];
      sums[sd * 2 + 1] += this.z[i];
    }
    for (let sd = 0; sd < 2; sd++) {
      const S = this.s[sd];
      S.count = cnt[sd];
      S.hpSum = hps[sd];
      S.decoys = dec[sd];
      if (cnt[sd] > 0) {
        S.cx = tr(sums[sd * 2] / cnt[sd]);
        S.cz = tr(sums[sd * 2 + 1] / cnt[sd]);
      } else {
        S.cx = sd === 0 ? -HOME_X : HOME_X;
        S.cz = 0;
      }
      if (cnt[sd] > S.stats.peak) S.stats.peak = cnt[sd];
    }
    for (let sd = 0; sd < 2; sd++) {
      const S = this.s[sd];
      const E = this.s[1 - sd];
      setLen(E.cx - S.cx, E.cz - S.cz, U);
      if (OX === 0 && OZ === 0) {
        S.fx = sd === 0 ? U : -U;
        S.fz = 0;
      } else {
        S.fx = OX;
        S.fz = OZ;
      }
    }
  }

  private refreshFocus(sd: number): void {
    const S = this.s[sd];
    const e = 1 - sd;
    const pr = S.cfg.targetPriority;
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    if (pr === "biggest") {
      let bc = -1;
      let bestCount = 0;
      const sc = this.sideCell[e];
      for (let c = 0; c < GCELLS; c++) {
        if (sc[c] > bestCount) {
          bestCount = sc[c];
          bc = c;
        }
      }
      if (bc >= 0) {
        for (let k = this.cellStart[bc]; k < this.cellStart[bc + 1]; k++) {
          const j = this.cellItems[k];
          if (this.alive[j] && this.side[j] === e) {
            best = j;
            break;
          }
        }
      }
    } else {
      for (let k = 0; k < this.aliveN; k++) {
        const j = this.aliveList[k];
        if (!this.alive[j] || this.side[j] !== e) continue;
        const dx = this.x[j] - S.cx;
        const dz = this.z[j] - S.cz;
        const d2 = dx * dx + dz * dz;
        const score = pr === "weakest" ? this.hp[j] * 8796093022208 + d2 : d2;
        if (score < bestScore) {
          bestScore = score;
          best = j;
        }
      }
    }
    S.focus = best;
  }

  private pickTarget(i: number, sd: number): number {
    const S = this.s[sd];
    const e = 1 - sd;
    const cfg = S.cfg;
    const focusOk = this.validTarget(S.focus, e);
    if (focusOk && hash32(i, (this.tick >> 3) + this.seed) % 100 < cfg.focusFire) return S.focus;

    const c = this.cellOf[i];
    const ccx = c % GCOLS;
    const ccz = (c / GCOLS) | 0;
    const xi = this.x[i];
    const zi = this.z[i];
    const pr = cfg.targetPriority;
    const sc = this.sideCell[e];
    let best = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestCell = -1;
    let bestCellCount = 0;
    let scanned = 0;
    for (let dz = -3; dz <= 3; dz++) {
      const rz = ccz + dz;
      if (rz < 0 || rz >= GROWS) continue;
      for (let dx = -3; dx <= 3; dx++) {
        const rx = ccx + dx;
        if (rx < 0 || rx >= GCOLS) continue;
        const cell = rz * GCOLS + rx;
        const cnt = sc[cell];
        if (cnt === 0) continue;
        if (pr === "biggest") {
          if (cnt > bestCellCount) {
            bestCellCount = cnt;
            bestCell = cell;
          }
          continue;
        }
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
          const j = this.cellItems[k];
          if (!this.alive[j] || this.side[j] !== e) continue;
          const ddx = this.x[j] - xi;
          const ddz = this.z[j] - zi;
          let d2 = ddx * ddx + ddz * ddz;
          if (this.kind[j] === 1) d2 = tr(d2 / 4);
          const score = pr === "weakest" ? this.hp[j] * 1099511627776 + d2 : d2;
          if (score < bestScore) {
            bestScore = score;
            best = j;
          }
          if (++scanned > 32) break;
        }
        if (scanned > 32) break;
      }
      if (scanned > 32) break;
    }
    if (pr === "biggest" && bestCell >= 0) {
      for (let k = this.cellStart[bestCell]; k < this.cellStart[bestCell + 1]; k++) {
        const j = this.cellItems[k];
        if (!this.alive[j] || this.side[j] !== e) continue;
        const ddx = this.x[j] - xi;
        const ddz = this.z[j] - zi;
        const d2 = ddx * ddx + ddz * ddz;
        if (d2 < bestScore) {
          bestScore = d2;
          best = j;
        }
      }
    }
    if (best >= 0) return best;
    return focusOk ? S.focus : -1;
  }

  private think(i: number): void {
    const sd = this.side[i];
    const e = 1 - sd;
    const S = this.s[sd];
    const E = this.s[e];
    const cfg = S.cfg;
    const xi = this.x[i];
    const zi = this.z[i];
    const vxi = this.vx[i];
    const vzi = this.vz[i];
    let max = this.spd[i];
    const h = hash32(i, this.seed);

    if (this.cd[i] > 0) this.cd[i]--;

    if (this.stun[i] > 0) {
      this.nvx[i] = tr((vxi * 7) / 8);
      this.nvz[i] = tr((vzi * 7) / 8);
      return;
    }

    // ----- neighbors
    let ncnt = 0;
    let sx = 0;
    let sz = 0;
    let svx = 0;
    let svz = 0;
    let pushX = 0;
    let pushZ = 0;
    const c = this.cellOf[i];
    const ccx = c % GCOLS;
    const ccz = (c / GCOLS) | 0;
    const X = this.x;
    const Z = this.z;
    const AL = this.alive;
    const SD = this.side;
    const CS = this.cellStart;
    const CI = this.cellItems;
    let checks = 0;
    let visits = 0;
    for (let dz = -1; dz <= 1 && checks < 24; dz++) {
      const rz = ccz + dz;
      if (rz < 0 || rz >= GROWS) continue;
      for (let dx = -1; dx <= 1 && checks < 24; dx++) {
        const rx = ccx + dx;
        if (rx < 0 || rx >= GCOLS) continue;
        const cell = rz * GCOLS + rx;
        const end = CS[cell + 1];
        for (let k = CS[cell]; k < end; k++) {
          const j = CI[k];
          if (++visits > 40) break;
          if (j === i || AL[j] === 0) continue;
          // coarse reject in integer space before squaring
          const ddx = X[j] - xi;
          if (ddx > NEIGH_R || ddx < -NEIGH_R) continue;
          const ddz = Z[j] - zi;
          if (ddz > NEIGH_R || ddz < -NEIGH_R) continue;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= NEIGH_R2) continue;
          checks++;
          if (SD[j] === sd) {
            if (ncnt < 20) {
              ncnt++;
              sx += X[j];
              sz += Z[j];
              svx += this.vx[j];
              svz += this.vz[j];
            }
            if (d2 < SEP_R2) {
              const d = isqrt(d2) || 1;
              const w = SEP_R - d;
              pushX -= tr((ddx * w) / d);
              pushZ -= tr((ddz * w) / d);
            }
          } else if (d2 < SEP_R2 >> 1) {
            const d = isqrt(d2) || 1;
            const w = SEP_R - d;
            pushX -= tr((ddx * w) / (d * 2));
            pushZ -= tr((ddz * w) / (d * 2));
          }
          if (checks >= 24) break;
        }
      }
    }

    // ----- decoys: drift toward the enemy, soak fire
    if (this.kind[i] === 1) {
      setLen(E.cx - xi, E.cz - zi, max);
      let dvx = OX;
      let dvz = OZ;
      if (pushX !== 0 || pushZ !== 0) {
        setLen(pushX, pushZ, max);
        dvx += OX;
        dvz += OZ;
      }
      this.steer(i, dvx, dvz, max, ACCEL);
      return;
    }

    // ----- targeting
    let t = this.target[i];
    if (!this.validTarget(t, e) || ((this.tick + i) & 7) === 0) t = this.pickTarget(i, sd);
    this.target[i] = t;

    // ----- mode transitions
    let mode = this.mode[i];
    if (mode === 0 && cfg.retreatAtHealth > 0 && this.hp[i] < cfg.retreatAtHealth) mode = 1;
    else if (mode === 1 && this.hp[i] >= 90) mode = 0;
    this.mode[i] = mode;

    let dvx = 0;
    let dvz = 0;
    let td2 = Number.POSITIVE_INFINITY;
    let tdx = 0;
    let tdz = 0;
    if (t >= 0) {
      tdx = this.x[t] - xi;
      tdz = this.z[t] - zi;
      td2 = tdx * tdx + tdz * tdz;
    }
    const engaged = td2 < ATTACK_R2 * 4;

    if (mode === 2) {
      // kamikaze: overclocked dash, detonate on contact
      max = max * 2;
      if (t >= 0) {
        if (td2 < 24 * U * 24 * U) {
          this.explode(i);
          return;
        }
        setLen(tdx, tdz, max);
        dvx = OX * 100;
        dvz = OZ * 100;
      } else {
        setLen(E.cx - xi, E.cz - zi, max);
        dvx = OX * 100;
        dvz = OZ * 100;
      }
      if (pushX !== 0 || pushZ !== 0) {
        setLen(pushX, pushZ, max);
        dvx += OX * 30;
        dvz += OZ * 30;
      }
      this.steer(i, tr(dvx / 100), tr(dvz / 100), max, ACCEL * 2);
      return;
    }

    if (mode === 1) {
      // retreat to own edge and regenerate
      const hx = sd === 0 ? -RETREAT_X : RETREAT_X;
      setLen(hx - xi, -zi >> 2, max);
      dvx += OX * 100;
      dvz += OZ * 100;
      const ex = E.cx - xi;
      const ez = E.cz - zi;
      if (ex * ex + ez * ez > 320 * U * 320 * U && this.tick % 3 === 0 && this.hp[i] < BASE_HP) this.hp[i]++;
    } else if (t >= 0) {
      const dist = isqrt(td2);
      if (dist > tr((ATTACK_R * 85) / 100)) {
        let gx = this.x[t];
        let gz = this.z[t];
        let speedPct = 55 + tr((cfg.aggression * 45) / 100);
        if (cfg.flank > 0) {
          const ex = E.cx - xi;
          const ez = E.cz - zi;
          const dE = isqrt(ex * ex + ez * ez);
          let fade = dE - 160 * U;
          if (fade < 0) fade = 0;
          else if (fade > 520 * U) fade = 520 * U;
          const wing = h & 1 ? 1 : -1;
          const off = tr((cfg.flank * 4 * fade) / 520) * wing; // flank 100 => up to 400u
          gx += tr((-S.fz * off) / U);
          gz += tr((S.fx * off) / U);
        }
        if (cfg.aggression < 45 && this.tick < (100 - cfg.aggression) * 5) {
          const cdx = E.cx - S.cx;
          const cdz = E.cz - S.cz;
          const holdR = (720 - cfg.aggression * 6) * U;
          if (cdx * cdx + cdz * cdz > holdR * holdR && dist > 220 * U) {
            gx = S.cx + tr((S.fx * 50 * U) / U);
            gz = S.cz + tr((S.fz * 50 * U) / U);
            speedPct = 40;
          }
        }
        setLen(gx - xi, gz - zi, tr((max * speedPct) / 100));
        dvx += OX * 100;
        dvz += OZ * 100;
      } else {
        // dogfight orbit
        const dir = h & 2 ? 1 : -1;
        setLen(-tdz * dir, tdx * dir, tr((max * 3) / 4));
        dvx += OX * 100;
        dvz += OZ * 100;
        const want = tr((ATTACK_R * (72 - tr(cfg.aggression / 3))) / 100);
        const err = dist - want;
        setLen(tdx, tdz, Math.max(-max, Math.min(max, tr(err / 6))));
        dvx += OX * 100;
        dvz += OZ * 100;
      }
    } else {
      // no enemies: hold the center line
      const hx = sd === 0 ? 180 * U : -180 * U;
      setLen(hx - xi, -zi, max >> 1);
      dvx += OX * 100;
      dvz += OZ * 100;
    }

    // ----- boids
    if (ncnt > 0) {
      setLen(tr(sx / ncnt) - xi, tr(sz / ncnt) - zi, max);
      const wc = tr((cfg.cohesion * 6) / 10);
      dvx += OX * wc;
      dvz += OZ * wc;
      const wa = cfg.alignment >> 1;
      dvx += tr(svx / ncnt) * wa;
      dvz += tr(svz / ncnt) * wa;
    }
    if (pushX !== 0 || pushZ !== 0) {
      setLen(pushX, pushZ, max);
      const ws = tr((cfg.separation * 12) / 10) + 25;
      dvx += OX * ws;
      dvz += OZ * ws;
    }

    // ----- formation
    if (mode === 0 && !engaged && cfg.formation !== "blob" && S.count > 3) {
      const n = S.count;
      const k = h % n;
      let ox = 0;
      let oz = 0;
      if (cfg.formation === "ring") {
        const a = h & 1023;
        const r = (36 + isqrt(n) * 9) * U;
        ox = tr((cosFx(a) * r) / U);
        oz = tr((sinFx(a) * r) / U);
      } else if (cfg.formation === "wedge") {
        const row = isqrt(k);
        const col = k - row * row - row;
        const rows = isqrt(n);
        const back = (rows * 13 - row * 26) * U;
        const lat = col * 20 * U;
        ox = tr((S.fx * back - S.fz * lat) / U);
        oz = tr((S.fz * back + S.fx * lat) / U);
      } else {
        const col = (k >> 1) - (n >> 2);
        const row = k & 1;
        const lat = col * 15 * U;
        const back = -row * 22 * U;
        ox = tr((S.fx * back - S.fz * lat) / U);
        oz = tr((S.fz * back + S.fx * lat) / U);
      }
      const gx = S.cx + ox - xi;
      const gz = S.cz + oz - zi;
      const gd = isqrt(gx * gx + gz * gz);
      setLen(gx, gz, Math.min(gd, max));
      const wf = tr(((100 - cfg.aggression) * 5) / 10) + 25;
      dvx += OX * wf;
      dvz += OZ * wf;
    }

    // ----- arena walls (fresh reinforcements may enter from outside)
    if (this.tick - this.born[i] > 25) {
      if (xi < -HALF_W + 30 * U) dvx += max * 160;
      else if (xi > HALF_W - 30 * U) dvx -= max * 160;
    }
    if (zi < -HALF_D + 30 * U) dvz += max * 160;
    else if (zi > HALF_D - 30 * U) dvz -= max * 160;

    this.steer(i, tr(dvx / 100), tr(dvz / 100), max, ACCEL);

    // ----- fire
    if (mode === 0 && t >= 0 && this.cd[i] === 0 && td2 <= ATTACK_R2) {
      this.hit(i, t, DMG, CAUSE.combat);
      this.cd[i] = 9 + (hash32(i, this.tick) & 3) - tr(cfg.aggression / 34);
    }
  }

  private steer(i: number, dvx: number, dvz: number, max: number, accel: number): void {
    let ddx = dvx - this.vx[i];
    let ddz = dvz - this.vz[i];
    const dl2 = ddx * ddx + ddz * ddz;
    if (dl2 > accel * accel) {
      setLen(ddx, ddz, accel);
      ddx = OX;
      ddz = OZ;
    }
    let nvx = this.vx[i] + ddx;
    let nvz = this.vz[i] + ddz;
    const l2 = nvx * nvx + nvz * nvz;
    if (l2 > max * max) {
      setLen(nvx, nvz, max);
      nvx = OX;
      nvz = OZ;
    }
    this.nvx[i] = nvx;
    this.nvz[i] = nvz;
  }

  private hit(from: number, t: number, dmg: number, cause: number): void {
    // shield wall or fresh reinforcements (3s entry shield) halve incoming damage
    const shielded = this.s[this.side[t]].shield > 0 || this.tick - this.born[t] < 30;
    const d = shielded ? Math.max(1, dmg >> 1) : dmg;
    this.pend[t] += d;
    if (cause !== CAUSE.combat || this.pendCause[t] === CAUSE.combat) this.pendCause[t] = cause;
    if (from >= 0) {
      this.shotT[from] = t;
      this.shotTick[from] = this.tick;
    }
    this.hitTick[t] = this.tick;
  }

  private kill(j: number, cause: number): void {
    if (!this.alive[j]) return;
    this.alive[j] = 0;
    const sd = this.side[j];
    if (this.kind[j] === 0) {
      this.s[sd].stats.lost++;
      if (cause !== CAUSE.sell && cause !== CAUSE.expire) this.s[1 - sd].stats.kills++;
    }
    this.deaths.push({ x: this.x[j] / U, z: this.z[j] / U, side: sd, cause, decoy: this.kind[j] === 1 });
  }

  private forEachEnemyInRadius(cx: number, cz: number, r: number, enemy: number, fn: (j: number) => void): void {
    const r2 = r * r;
    const cr = tr(r / CELL) + 1;
    const c = this.cellIndex(cx, cz);
    const ccx = c % GCOLS;
    const ccz = (c / GCOLS) | 0;
    for (let dz = -cr; dz <= cr; dz++) {
      const rz = ccz + dz;
      if (rz < 0 || rz >= GROWS) continue;
      for (let dx = -cr; dx <= cr; dx++) {
        const rx = ccx + dx;
        if (rx < 0 || rx >= GCOLS) continue;
        const cell = rz * GCOLS + rx;
        if (this.sideCell[enemy][cell] === 0) continue;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
          const j = this.cellItems[k];
          if (!this.alive[j] || this.side[j] !== enemy) continue;
          const ddx = this.x[j] - cx;
          const ddz = this.z[j] - cz;
          if (ddx * ddx + ddz * ddz <= r2) fn(j);
        }
      }
    }
  }

  private explode(i: number): void {
    const sd = this.side[i];
    const cx = this.x[i];
    const cz = this.z[i];
    this.forEachEnemyInRadius(cx, cz, KAMIKAZE_R, 1 - sd, (j) => this.hit(-1, j, KAMIKAZE_DMG, CAUSE.kamikaze));
    this.fx.push({ side: sd, kind: "kamikaze", x: cx / U, z: cz / U, r: KAMIKAZE_R / U });
    this.kill(i, CAUSE.kamikaze);
    this.nvx[i] = 0;
    this.nvz[i] = 0;
  }

  private abilities(): void {
    for (let sd = 0; sd < 2; sd++) {
      const S = this.s[sd];
      const E = this.s[1 - sd];
      if (S.abilityCd > 0 || S.count < 4 || E.count + E.decoys < 3) continue;
      const cdx = E.cx - S.cx;
      const cdz = E.cz - S.cz;
      if (cdx * cdx + cdz * cdz > 540 * U * 540 * U) continue;
      S.stats.abilityUses++;
      const e = 1 - sd;
      if (S.ability === "emp") {
        // detonate on the enemy drone closest to our centroid
        let best = -1;
        let bd = Number.POSITIVE_INFINITY;
        for (let k = 0; k < this.aliveN; k++) {
          const j = this.aliveList[k];
          if (!this.alive[j] || this.side[j] !== e) continue;
          const dx = this.x[j] - S.cx;
          const dz = this.z[j] - S.cz;
          const d2 = dx * dx + dz * dz;
          if (d2 < bd) {
            bd = d2;
            best = j;
          }
        }
        if (best >= 0) {
          const ex = this.x[best];
          const ez = this.z[best];
          this.forEachEnemyInRadius(ex, ez, EMP_R, e, (j) => {
            this.stun[j] = 30;
            this.hit(-1, j, EMP_DMG, CAUSE.emp);
          });
          this.fx.push({ side: sd, kind: "emp", x: ex / U, z: ez / U, r: EMP_R / U });
        }
        S.abilityCd = 320;
      } else if (S.ability === "kamikaze") {
        const cand: number[] = [];
        for (let k = 0; k < this.aliveN; k++) {
          const j = this.aliveList[k];
          if (this.alive[j] && this.side[j] === sd && this.kind[j] === 0 && this.mode[j] === 0) cand.push(j);
        }
        const dist = (j: number) => {
          const dx = this.x[j] - E.cx;
          const dz = this.z[j] - E.cz;
          return dx * dx + dz * dz;
        };
        cand.sort((a, b) => dist(a) - dist(b) || a - b);
        const k = Math.min(cand.length, Math.max(6, tr(S.count / 8)));
        for (let q = 0; q < k; q++) this.mode[cand[q]] = 2;
        this.fx.push({ side: sd, kind: "kamikaze", x: S.cx / U, z: S.cz / U, r: 0 });
        S.abilityCd = 260;
      } else if (S.ability === "shield") {
        S.shield = 70;
        this.fx.push({ side: sd, kind: "shield", x: S.cx / U, z: S.cz / U, r: 70 });
        S.abilityCd = 300;
      } else {
        const bx = S.cx + tr((S.fx * 90 * U) / U);
        const bz = S.cz + tr((S.fz * 90 * U) / U);
        for (let q = 0; q < 16; q++) {
          this.spawn(sd, bx + this.rng.range(-70 * U, 70 * U), bz + this.rng.range(-110 * U, 110 * U), S.fx * 4, S.fz * 4, 1);
        }
        this.fx.push({ side: sd, kind: "decoys", x: bx / U, z: bz / U, r: 110 });
        S.abilityCd = 280;
      }
    }
  }

  // ---------------------------------------------------------------- results
  result(): BattleResultData {
    const a = this.s[0];
    const b = this.s[1];
    let winner: 0 | 1;
    if (a.count !== b.count) winner = a.count > b.count ? 0 : 1;
    else if (a.hpSum !== b.hpSum) winner = a.hpSum > b.hpSum ? 0 : 1;
    else winner = 1; // defender holds ties
    return {
      winner,
      alive: [a.count, b.count],
      hp: [a.hpSum, b.hpSum],
      stats: [{ ...a.stats }, { ...b.stats }],
      ticks: this.tick,
    };
  }

  /** Deterministic state fingerprint (for verifying lockstep). */
  checksum(): number {
    let h = 0x811c9dc5 ^ this.tick;
    for (let i = 0; i < this.n; i++) {
      h = Math.imul(h ^ this.x[i], 0x01000193);
      h = Math.imul(h ^ this.z[i], 0x01000193);
      h = Math.imul(h ^ (this.hp[i] * 2 + this.alive[i]), 0x01000193);
    }
    return h >>> 0;
  }

  snapshot(): SimSnapshot {
    const arrays = {} as SimSnapshot["arrays"];
    for (const k of ARRAYS) arrays[k] = (this[k] as Int32Array).slice(0, this.n);
    return { tick: this.tick, n: this.n, rng: this.rng.s, arrays, sides: [cloneSide(this.s[0], 0), cloneSide(this.s[1], 1)] };
  }

  restore(snap: SimSnapshot): void {
    this.tick = snap.tick;
    this.n = snap.n;
    this.rng.s = snap.rng;
    for (const k of ARRAYS) {
      const dst = this[k] as Int32Array;
      dst.set(snap.arrays[k] as Int32Array);
    }
    // clear stale slots beyond n
    this.alive.fill(0, this.n);
    this.px.set(this.x.subarray(0, this.n));
    this.pz.set(this.z.subarray(0, this.n));
    this.s = [cloneSide(snap.sides[0], 0), cloneSide(snap.sides[1], 1)];
    this.deaths.length = 0;
    this.spawns.length = 0;
    this.fx.length = 0;
  }
}

/** Run a full battle headlessly (server settlement + replays). */
export function runBattle(input: SimInput, events: SimEvent[], ticks = BATTLE_TICKS): { sim: BattleSim; result: BattleResultData } {
  const sim = new BattleSim(input);
  let p = 0;
  const batch: SimEvent[] = [];
  while (sim.tick < ticks) {
    batch.length = 0;
    while (p < events.length && events[p].tick <= sim.tick) {
      if (events[p].tick === sim.tick) batch.push(events[p]);
      p++;
    }
    sim.step(batch);
  }
  return { sim, result: sim.result() };
}
