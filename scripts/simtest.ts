import { runBattle, BattleSim } from "../src/lib/sim/engine";
import { HOUSE_SWARMS } from "../src/lib/game/house";
import { demoEvents } from "../src/lib/game/demo";
import { baseDrones } from "../src/lib/game/drones";

const pairs = [[0,1],[2,3],[4,5],[0,4],[1,5],[3,2]];
for (const [a,b] of pairs) {
  const A = HOUSE_SWARMS[a], B = HOUSE_SWARMS[b];
  const seed = 12345 + a*7 + b*13;
  const input = { seed, sides: [
    { baseDrones: baseDrones(A.mcapSol), config: A.config, ability: A.ability },
    { baseDrones: baseDrones(B.mcapSol), config: B.config, ability: B.ability },
  ] as any };
  const evs = demoEvents(`t-${a}-${b}`, seed, 0);
  const t0 = performance.now();
  const r1 = runBattle(input, evs);
  const t1 = performance.now();
  const r2 = runBattle(input, evs);
  const buysA = evs.filter(e=>e.side===0&&e.kind==='buy').reduce((s,e)=>s+e.drones,0);
  const buysB = evs.filter(e=>e.side===1&&e.kind==='buy').reduce((s,e)=>s+e.drones,0);
  console.log(`${A.ticker} vs ${B.ticker}: ${(t1-t0).toFixed(0)}ms n=${r1.sim.n} base=${input.sides[0].baseDrones}/${input.sides[1].baseDrones} reinf=${buysA}/${buysB} alive=${r1.result.alive} lost=${r1.result.stats[0].lost}/${r1.result.stats[1].lost} kills=${r1.result.stats[0].kills}/${r1.result.stats[1].kills} abil=${r1.result.stats[0].abilityUses}/${r1.result.stats[1].abilityUses} winner=${r1.result.winner} det=${r1.sim.checksum()===r2.sim.checksum()}`);
}
// snapshot/restore determinism
{
  const A = HOUSE_SWARMS[0], B = HOUSE_SWARMS[4];
  const input = { seed: 999, sides: [
    { baseDrones: 110, config: A.config, ability: A.ability },
    { baseDrones: 110, config: B.config, ability: B.ability },
  ] as any };
  const evs = demoEvents(`snap`, 999, 0);
  const full = runBattle(input, evs).sim.checksum();
  const sim = new BattleSim(input);
  let p = 0; let snap: any = null;
  const stepTo = (t: number) => { while (sim.tick < t) { const b=[]; while (p<evs.length && evs[p].tick<=sim.tick){ if(evs[p].tick===sim.tick) b.push(evs[p]); p++; } sim.step(b);} };
  stepTo(600); snap = sim.snapshot(); stepTo(1000);
  sim.restore(snap); p = evs.findIndex(e=>e.tick>=600); if (p<0) p=evs.length;
  stepTo(1800);
  console.log("snapshot restore deterministic:", sim.checksum() === full);
}
