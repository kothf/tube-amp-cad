/**
 * The fault finder's simulation side (faults.js): the faults made for each kind of part, what a
 * voltmeter reads from a result, the match of readings, and the next test point; and a real
 * circuit simulated with its faults, the right one ranked first.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "faults.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { Faults: F, TubeSimEngine: E } = globalThis;

test("each kind of part gets its common faults", () => {
  const parts = [
    { id: "a", ref: "R1", type: "resistor", pins: { 1: 1, 2: 2 } },
    { id: "b", ref: "C1", type: "capacitor", pins: { 1: 2, 2: 3 } },
    { id: "c", ref: "C2", type: "electrolytic", pins: { "+": 1, "-": 0 } },
    { id: "d", ref: "VL1", type: "tube", kind: "triode", pins: { P: 1, G: 3, K: 4 } },
    { id: "e", ref: "VL2", type: "tube", kind: "rectifier", pins: { A1: 5, A2: 6, K: 1 } },
    { id: "f", ref: "VT1", type: "npn", pins: { C: 1, B: 2, E: 0 } },
    { id: "g", ref: "VD1", type: "diode", pins: { A: 5, K: 1 } },
    { id: "h", ref: "L1", type: "inductor", pins: { 1: 1, 2: 7 } },
    { id: "i", ref: "G1", type: "siggen", pins: { "+": 3, "-": 0 } }
  ];
  const keys = F.candidates(parts).map(c => `${c.ref} ${c.fault}`);
  assert.deepEqual(keys, ["R1 open", "R1 high", "C1 short", "C1 leaky", "C2 short", "C2 leaky", "C2 dry", "VL1 weak", "VL1 dead", "VL2 worn", "VT1 short", "VT1 open", "VD1 short", "VD1 open", "L1 open"]);
});

test("a fault changes only its own part's elements", () => {
  const base = { nodeCount: 4, elements: [
    { id: "a", kind: "R", nodes: [1, 2], r: 1000 }, { id: "b", kind: "C", nodes: [2, 3], c: 1e-7 },
    { id: "d", kind: "TRIODE", nodes: [1, 3, 0], model: {} }, { id: "d#cgk", kind: "C", nodes: [3, 0], c: 2e-12 },
    { id: "f", kind: "BJT", nodes: [1, 2, 0], model: {} }, { id: "f#cbe", kind: "C", nodes: [2, 0], c: 1e-11 }
  ] };
  const cs = F.candidates([{ id: "a", ref: "R1", type: "resistor", pins: { 1: 1, 2: 2 } }, { id: "b", ref: "C1", type: "capacitor", pins: { 1: 2, 2: 3 } },
    { id: "d", ref: "VL1", type: "tube", kind: "triode", pins: { P: 1, G: 3, K: 0 } }, { id: "f", ref: "VT1", type: "npn", pins: { C: 1, B: 2, E: 0 } }]);
  const by = k => cs.find(c => `${c.ref} ${c.fault}` === k).apply(base).elements;
  assert.equal(by("R1 open").find(e => e.id === "a").r, F.OPEN);
  assert.equal(by("R1 high").find(e => e.id === "a").r, 2000);
  const sh = by("C1 short").find(e => e.id === "b#fault");
  assert.deepEqual([sh.nodes, sh.r], [[2, 3], F.SHORT]);
  const weak = by("VL1 weak");
  assert.equal(weak.find(e => e.id === "d").iScale, 0.5);
  assert.equal(weak.find(e => e.id === "d#cgk").c, 2e-12, "the tube's capacitance stays");
  const open = by("VT1 open").find(e => e.id === "f");
  assert.deepEqual([open.kind, open.nodes, open.r], ["R", [1, 0], F.OPEN]);
  assert.equal(base.elements[0].r, 1000, "the base netlist is not touched");
});

test("a voltmeter reads the cycle's average, else the operating point", () => {
  assert.equal(F.meter({ dc: { nodes: [0, 5] } }, 1), 5);
  assert.equal(F.meter({ dc: { nodes: [0, 5] }, tran: { nodes: [null, [1, 3, 99]] } }, 1), 2, "the last sample is the first of the next cycle");
  assert.equal(F.meter({ dc: { nodes: [0, 5] } }, 0), 0);
});

test("matching: the rms and the largest miss, in 5 % + 0.2 V; the next point splits the leaders", () => {
  const rs = [{ net: 1, v: 250 }, { net: 2, v: 1.5 }];
  assert.equal(F.score(rs, { 1: 250, 2: 1.5 }), 0);
  assert.ok(F.score(rs, { 1: 260, 2: 1.5 }) < 1, "4 % off a 250 V reading is within it");
  assert.ok(F.worst(rs, { 1: 250, 2: 3 }) > 5, "1.5 V off a cathode is far");
  const r = F.rank(rs, { 1: 300, 2: 2.5 }, [{ cand: { key: "x" }, values: { 1: 250, 2: 1.5 } }, { cand: { key: "y" }, values: { 1: 200, 2: 0 } }]);
  assert.deepEqual(r.ranked.map(x => x.cand.key), ["x", "y"]);
  assert.ok(r.nominalWorst > 1);
  const n = F.next([{ net: 1 }, { net: 3 }, { net: 4 }], rs, [{ values: { 3: 100, 4: 10 } }, { values: { 3: 101, 4: 200 } }]);
  assert.equal(n.point.net, 4);
});

test("a divider with a resistor gone open: the fault ranks first and the circuit as drawn misses", () => {
  // 300 V through R1 100 k and R2 50 k to ground, a 10 µF across R2
  const base = { nodeCount: 3, elements: [
    { id: "G", kind: "V", nodes: [1, 0], v: 300 }, { id: "a", kind: "R", nodes: [1, 2], r: 1e5 },
    { id: "b", kind: "R", nodes: [2, 0], r: 5e4 }, { id: "c", kind: "C", nodes: [2, 0], c: 1e-5 }
  ] };
  const parts = [{ id: "a", ref: "R1", type: "resistor", pins: { 1: 1, 2: 2 } }, { id: "b", ref: "R2", type: "resistor", pins: { 1: 2, 2: 0 } }, { id: "c", ref: "C1", type: "electrolytic", pins: { "+": 2, "-": 0 } }];
  const values = net => { const r = E.simulate(net, { budgetMs: 5000 }); assert.ok(r.ok); return { 1: F.meter(r, 1), 2: F.meter(r, 2) }; };
  const nominal = values(base);
  assert.ok(Math.abs(nominal[2] - 100) < 0.5, `${nominal[2]}`);
  const runs = F.candidates(parts).map(cand => ({ cand, values: values(cand.apply(base)) }));
  const rs = [{ net: 2, v: 299.5 }];                // the bench: B+ on the junction, R2 open
  const r = F.rank(rs, nominal, runs);
  assert.equal(`${r.ranked[0].cand.ref} ${r.ranked[0].cand.fault}`, "R2 open");
  assert.ok(r.ranked[0].worst <= 1 && r.nominalWorst > 10);
  const leaky = F.rank([{ net: 2, v: 16.6 }], nominal, runs).ranked[0];   // 10 kΩ leak beside R2: 300·(50k‖10k)/(100k + 8.3k)
  assert.equal(`${leaky.cand.ref} ${leaky.cand.fault}`, "C1 leaky");
});
