/**
 * Tolerance runs (cad-tolerance.js): the seeded spread of part values, which elements it varies,
 * and the summary of the runs; and the engine's iScale, which carries a tube's spread.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-tolerance.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { CadTolerance: T, TubeSimEngine: E, TUBE_DATABASE } = globalThis;

test("a seed repeats its values; another seed gives others", () => {
  const a = T.rng(7), b = T.rng(7), c = T.rng(8);
  const xa = Array.from({ length: 5 }, a), xb = Array.from({ length: 5 }, b), xc = Array.from({ length: 5 }, c);
  assert.deepEqual(xa, xb);
  assert.notDeepEqual(xa, xc);
  assert.ok(xa.every(x => x >= 0 && x < 1));
});

test("factors stay within the tolerance, with the tolerance as about 2σ", () => {
  const rand = T.rng(1), f = Array.from({ length: 20000 }, () => T.factor(rand, 0.1));
  assert.ok(f.every(x => x >= 0.9 && x <= 1.1), "never beyond ±10 %");
  const mean = f.reduce((s, x) => s + x, 0) / f.length, sd = Math.sqrt(f.reduce((s, x) => s + (x - mean) ** 2, 0) / f.length);
  assert.ok(Math.abs(mean - 1) < 0.002, `mean ${mean}`);
  assert.ok(Math.abs(sd - 0.05) < 0.003, `σ ${sd} (a normal cut off at 2σ: a little under 0.05)`);
  assert.equal(T.factor(rand, 0), 1);
});

test("vary: resistors, pots (both halves alike), capacitors and tubes; a part's internal elements stay", () => {
  const types = { R1: "resistor", RV1: "pot", C1: "capacitor", C2: "electrolytic", VL1: "tube", BA1: "speaker", VT1: "npn" };
  const net = { nodeCount: 6, elements: [
    { id: "R1", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "RV1#a", kind: "R", nodes: [2, 3], r: 300 }, { id: "RV1#b", kind: "R", nodes: [3, 0], r: 700 },
    { id: "C1", kind: "C", nodes: [1, 0], c: 1e-7 }, { id: "C2", kind: "C", nodes: [2, 0], c: 1e-4 },
    { id: "VL1", kind: "TRIODE", nodes: [1, 2, 0], model: {} }, { id: "VL1#cgk", kind: "C", nodes: [2, 0], c: 1.6e-12 },
    { id: "BA1#re", kind: "R", nodes: [4, 0], r: 6 }, { id: "VT1#cbe", kind: "C", nodes: [5, 0], c: 8e-12 }
  ] };
  const { netlist, factors } = T.vary(net, id => types[id], { r: 0.05, c: 0.2, tube: 0.2 }, T.rng(3));
  const el = id => netlist.elements.find(e => e.id === id);
  assert.deepEqual(Object.keys(factors).sort(), ["C1", "C2", "R1", "RV1", "VL1"]);
  assert.ok(Math.abs(el("R1").r / 1000 - 1) <= 0.05 && el("R1").r !== 1000);
  assert.ok(Math.abs(el("RV1#a").r / 300 - el("RV1#b").r / 700) < 1e-12, "the pot's halves keep its wiper position");
  assert.ok(Math.abs(el("C2").c / 1e-4 - 1) <= 0.2);
  assert.ok(Math.abs(el("VL1").iScale - 1) <= 0.2 && el("VL1").iScale !== 1);
  assert.equal(el("VL1#cgk").c, 1.6e-12); assert.equal(el("BA1#re").r, 6); assert.equal(el("VT1#cbe").c, 8e-12);
  assert.equal(net.elements[0].r, 1000, "the drawn netlist is left as it was");
});

test("summarize: nominal from the first run, spread and over-rating counts from the others, failed runs left out", () => {
  const q = (v, max) => [{ key: "pa", label: "VL1 Pa", unit: "W", v, max }];
  const s = T.summarize([q(1, 1.1), q(0.9, 1.1), q(1.2, 1.1), null, q(1.0, 1.1)]);
  assert.equal(s.length, 1);
  const r = s[0];
  assert.equal(r.nominal, 1); assert.equal(r.n, 3); assert.equal(r.min, 0.9); assert.equal(r.maxV, 1.2); assert.equal(r.over, 1);
  assert.ok(Math.abs(r.mean - 31 / 30) < 1e-12);
  assert.ok(Math.abs(r.sd - Math.sqrt(((0.9 - 31 / 30) ** 2 + (1.2 - 31 / 30) ** 2 + (1 - 31 / 30) ** 2) / 2)) < 1e-12);
});

test("a tube's iScale scales its plate current at the same voltages", () => {
  const t = TUBE_DATABASE.find(x => x.commonName === "12AX7") || TUBE_DATABASE.find(x => /12AX7/.test(x.commonName));
  // fixed bias, no plate resistor: the plate current alone feels the spread
  const net = s => ({ nodeCount: 3, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 250 }, { id: "G", kind: "V", nodes: [2, 0], v: -2 },
    Object.assign({ id: "VL1", kind: "TRIODE", nodes: [1, 2, 0], model: t.koren.Triode }, s ? { iScale: s } : {}) ] });
  const ia = s => E.simulate(net(s)).dc.devices.VL1.main.ia;
  assert.ok(Math.abs(ia(1.2) / ia() - 1.2) < 1e-6);
});

test("a warm start (opts.warm) settles where a cold start does; a state of another size is ignored", () => {
  // a valve rectifier into a reservoir capacitor and load: settles over many mains cycles
  const net = (rl, c) => ({ nodeCount: 3, elements: [
    { id: "S1", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 50, amp: 500 * Math.SQRT2, offset: 0 },
    { id: "D1", kind: "VDIODE", nodes: [1, 2], perveance: E.RECTIFIER_PERVEANCE["5Ts4S"] },
    { id: "C", kind: "C", nodes: [2, 0], c }, { id: "R", kind: "R", nodes: [2, 0], r: rl }] });
  const run = { budgetMs: 20000, maxPeriods: 20000 };
  const nominal = E.simulate(net(4700, 40e-6), run);
  assert.ok(nominal.ok && nominal.warm && nominal.warm.length > 0, "a settled run gives its state");
  const varied = net(4700 * 1.3, 40e-6 * 0.8);
  const cold = E.simulate(varied, run), warm = E.simulate(varied, Object.assign({ warm: nominal.warm }, run));
  assert.ok(cold.ok && warm.ok);
  // the average over the captured window, what a meter reads
  const avg = r => { const v = r.tran.nodes[2]; let s = 0; for (let i = 0; i < v.length - 1; i++) s += v[i]; return s / (v.length - 1); };
  const vc = avg(cold), vw = avg(warm);
  assert.ok(Math.abs(vw / vc - 1) < 2e-3, `warm ${vw.toFixed(2)} V, cold ${vc.toFixed(2)} V`);
  assert.ok(Math.abs(vc / avg(nominal) - 1) > 5e-3, "the varied circuit settles elsewhere than the nominal");
  const odd = E.simulate(varied, Object.assign({ warm: new Float64Array(1) }, run));
  assert.ok(odd.ok && Math.abs(avg(odd) / vc - 1) < 1e-9, "a state of another size: a cold start");
});
