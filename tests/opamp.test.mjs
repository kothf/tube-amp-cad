/**
 * Op-amps (sim-engine.js Semi.opamp, built by cad-components.js): the datasheet's gain,
 * gain-bandwidth, slew rate, output swing and current limit, measured in the textbook
 * circuits, and the DC operating point of the circuits where a high-gain loop is hard to
 * solve (single supply, comparator, Schmitt trigger) (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected), `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);
const max = a => a.reduce((m, v) => Math.max(m, v), -Infinity), min = a => a.reduce((m, v) => Math.min(m, v), Infinity);

// a circuit from CAD parts: [{ type, params, pins: { pin: node } }]; pins not listed get a node of their own
function circuit(parts) {
  let n = 0;
  parts.forEach(p => Object.values(p.pins).forEach(v => { n = Math.max(n, v); }));
  const els = [];
  parts.forEach((p, i) => {
    const c = { id: p.id || "p" + i, type: p.type, label: p.label || "", params: Object.assign({}, L.LIB[p.type].defaults, p.params) };
    L.LIB[p.type].build(c, pin => (p.pins[pin] !== undefined ? p.pins[pin] : ++n), () => ++n, els);
  });
  return { nodeCount: n + 1, elements: els };
}
// ±15 V on nodes 1 and 2
const SUPPLY = [{ type: "vdc", params: { v: 15 }, pins: { "+": 1, "-": 0 } }, { type: "vdc", params: { v: 15 }, pins: { "+": 0, "-": 2 } }];
const gen = (p, node) => ({ id: "gen", type: "siggen", params: Object.assign({ rs: 1e-3 }, p), pins: { "+": node, "-": 0 } });
const R = (r, a, b) => ({ type: "resistor", params: { r }, pins: { 1: a, 2: b } });
// an LM301A gets its 30 pF between pins 1 and 8
const amp = (model, pins) => {
  const parts = [{ id: "U", type: "opamp", params: { model }, pins: Object.assign({ "V+": 1, "V-": 2 }, pins, L.OPAMPS[model].cc === 0 ? { 1: 90, 8: 91 } : {}) }];
  if (L.OPAMPS[model].cc === 0) parts.push({ type: "capacitor", params: { c: 30e-12 }, pins: { 1: 90, 2: 91 } });
  return parts;
};
const follower = (model, g, load) => circuit([...SUPPLY, gen(g, 3), R(load || 10e3, 5, 0), ...amp(model, { "+": 3, "-": 5, OUT: 5 })]);
const MODELS = Object.keys(L.OPAMPS);

test("op-amps: inverting amplifier, gain −10 to 0.1 %, DC offset from the input bias current", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model], nl = circuit([...SUPPLY, gen({ amp: 0.1, freq: 1000 }, 3), R(10e3, 3, 4), R(100e3, 4, 5), R(10e3, 5, 0), ...amp(model, { "+": 0, "-": 4, OUT: 5 })]);
    const r = E.simulate(nl, { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    const v = r.tran.nodes[5];
    near((max(v) - min(v)) / 0.2, 10 / (1 + 11 / m.a0), 1e-3, `${model} gain`);
    // the inverting input's bias current flows through the 100 kΩ feedback resistor
    near(r.dc.nodes[5], m.ib * 100e3, 0.05, `${model} DC offset`);
  }
});

test("op-amps: the follower's −3 dB at the gain-bandwidth, ×101 at GBW / 101", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model];
    const f3 = nl => { const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 100, fStop: 1e8, perDecade: 100, probes: [[5, 0]] }), g = Array.from(ac.freqs, (f, k) => Math.hypot(ac.probes[0].re[k], ac.probes[0].im[k]));
      assert.ok(ac.ok, ac.error); return [ac.freqs[g.findIndex(a => a < g[0] / Math.SQRT2)], max(g) / g[0]]; };
    const [fu, peak] = f3(follower(model, { amp: 0.1, freq: 1000 }));
    // a single-pole response: the follower's corner is the GBW (the second pole adds a little)
    near(fu, m.gbw, 0.2, `${model} follower bandwidth`);
    assert.ok(peak < 1.05, `${model} follower: no peaking (${peak.toFixed(3)})`);
    const [f101] = f3(circuit([...SUPPLY, gen({ amp: 0.01, freq: 1000 }, 3), R(100e3, 5, 4), R(1e3, 4, 0), ...amp(model, { "+": 3, "-": 4, OUT: 5 })]));
    near(f101, m.gbw / 101, 0.05, `${model} ×101 bandwidth`);
  }
});

test("op-amps: slew rate of a follower on a 10 Vpp square (20 Vpp above 15 V/µs, so an edge spans a few samples)", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model], r = E.simulate(follower(model, { amp: m.sr > 15e6 ? 10 : 5, freq: m.sr > 5e6 ? 50e3 : 10e3, wave: "square" }), { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    const v = r.tran.nodes[5];
    let sr = 0;
    for (let i = 1; i < v.length; i++) sr = Math.max(sr, Math.abs(v[i] - v[i - 1]) / r.tran.dt);
    // the generator's own edges (1 % of the period) and the time step take a little off the TL07x's 13 V/µs
    // (an LM301A's own 1 pF of stray capacitance adds to its 30 pF)
    near(sr, m.sr, m.sr > 5e6 ? 0.1 : 0.06, `${model} slew rate`);
  }
});

test("op-amps: output swing within dhi / dlo of the rails into 10 kΩ, the short-circuit current into 10 Ω", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model];
    let r = E.simulate(circuit([...SUPPLY, gen({ amp: 3, freq: 1000 }, 3), R(10e3, 3, 4), R(100e3, 4, 5), R(10e3, 5, 0), ...amp(model, { "+": 0, "-": 4, OUT: 5 })]), { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    // the clipped output: the limit less the drop across ro into the load (the 100 kΩ feedback in parallel)
    const rl = 1 / (1 / 10e3 + 1 / 100e3), v = r.tran.nodes[5];
    near(max(v), (15 - m.dhi) * rl / (rl + m.ro), 0.01, `${model} positive swing`);
    near(-min(v), (15 - m.dlo) * rl / (rl + m.ro), 0.01, `${model} negative swing`);
    r = E.simulate(follower(model, { amp: 10, freq: 1000 }, 10), { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    near(max(r.tran.nodes[5]) / 10, m.isc, 0.02, `${model} source current`);
    near(-min(r.tran.nodes[5]) / 10, m.isk, 0.02, `${model} sink current`);
  }
});

test("op-amps: the DC operating point of single-supply followers, comparators and a Schmitt trigger", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model];
    for (const vs of [5, 12, 30]) for (const vin of [0, 1, vs / 2, vs - 0.5]) {
      const nl = circuit([{ type: "vdc", params: { v: vs }, pins: { "+": 1, "-": 0 } }, { type: "vdc", params: { v: vin }, pins: { "+": 3, "-": 0 } }, R(10e3, 5, 0), ...amp(model, { "+": 3, "-": 5, OUT: 5, "V-": 0 })]);
      const dc = E.dcOperatingPoint(E.buildCircuit(nl));
      assert.ok(dc.ok, `${model} on ${vs} V, ${vin} V in: ${dc.error}`);
      // the output follows the input, between its limits (the top one less the drop across ro into 10 kΩ)
      const want = vin > vs - m.dhi ? (vs - m.dhi) * 10e3 / (10e3 + m.ro) : Math.max(vin, m.dlo), got = dc.x[4];
      assert.ok(Math.abs(got - want) < 0.12, `${model} on ${vs} V follows ${vin} V: ${got.toFixed(3)} V, expected about ${want} V`);
    }
    // comparator against 0.5 V, and a Schmitt trigger (10 % positive feedback) on a 3 V sine
    let r = E.simulate(circuit([...SUPPLY, gen({ amp: 1, freq: 1000 }, 3), R(29e3, 1, 4), R(1e3, 4, 0), R(10e3, 5, 0), ...amp(model, { "+": 3, "-": 4, OUT: 5 })]), { budgetMs: 20000 });
    assert.ok(r.ok && max(r.tran.nodes[5]) > 12 && min(r.tran.nodes[5]) < -12, `${model} comparator: ${r.error || "output " + min(r.tran.nodes[5]) + " … " + max(r.tran.nodes[5])}`);
    r = E.simulate(circuit([...SUPPLY, gen({ amp: 3, freq: 1000 }, 3), R(10e3, 4, 0), R(100e3, 5, 4), ...amp(model, { "+": 4, "-": 3, OUT: 5 })]), { budgetMs: 20000 });
    assert.ok(r.ok && max(r.tran.nodes[5]) > 12 && min(r.tran.nodes[5]) < -12, `${model} Schmitt trigger: ${r.error || "output " + min(r.tran.nodes[5]) + " … " + max(r.tran.nodes[5])}`);
  }
  // an uncompensated LM301A (pins 1 and 8 open) as a Schmitt trigger switches cleanly too
  const r = E.simulate(circuit([...SUPPLY, gen({ amp: 3, freq: 1000 }, 3), R(10e3, 4, 0), R(100e3, 5, 4), { type: "opamp", params: { model: "LM301A" }, pins: { "+": 4, "-": 3, OUT: 5, "V+": 1, "V-": 2 } }]), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
});

test("op-amps: the supply current, from V+ to V−, and nothing without a supply", () => {
  for (const model of MODELS) {
    const m = L.OPAMPS[model], r = E.simulate(follower(model, { amp: 0, freq: 1000 }), { budgetMs: 20000 });
    assert.ok(r.ok, r.error);
    near(r.dc.devices.U.main.iq, m.iq, 0.02, `${model} quiescent current`);
    const off = E.simulate(circuit([gen({ amp: 1, freq: 1000 }, 3), R(10e3, 5, 0), ...amp(model, { "+": 3, "-": 5, OUT: 5 })]), { budgetMs: 20000 });
    // only what reaches the output through the input resistance (a bipolar part's few hundred kΩ)
    assert.ok(off.ok && Math.abs(max(off.tran.nodes[5])) < 0.01 + 10e3 / (10e3 + m.rin), `${model} unpowered: ${off.error || max(off.tran.nodes[5])}`);
  }
});
