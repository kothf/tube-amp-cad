/**
 * Controlled sources (cad-components.js vcvs / vccs, sim-engine.js elements E and G): the
 * gain at DC and in the AC sweep, a feedback loop around one, and a tube's small-signal model
 * (node --test).
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
function circuit(parts) {
  let n = 0;
  parts.forEach(p => Object.values(p.pins).forEach(v => { n = Math.max(n, v); }));
  const els = [];
  parts.forEach((p, i) => {
    const c = { id: p.id || "p" + i, type: p.type, label: "", params: Object.assign({}, L.LIB[p.type].defaults, p.params) };
    L.LIB[p.type].build(c, pin => (p.pins[pin] !== undefined ? p.pins[pin] : ++n), () => ++n, els);
  });
  return { nodeCount: n + 1, elements: els };
}
const R = (r, a, b) => ({ type: "resistor", params: { r }, pins: { 1: a, 2: b } });
const vdc = (v, a) => ({ type: "vdc", params: { v }, pins: { "+": a, "-": 0 } });

test("VCVS: the gain times the control voltage at any load, the control pins drawing nothing", () => {
  for (const [gain, load] of [[10, 1e3], [-3, 50], [1e3, 1e6]]) {
    // 0.5 V through 100 kΩ to the control pins: no current, so no drop (but the solver's 1 nS to ground)
    const r = E.simulate(circuit([vdc(0.5, 1), R(100e3, 1, 2), { id: "E1", type: "vcvs", params: { gain }, pins: { "+": 3, "-": 0, "C+": 2, "C-": 0 } }, R(load, 3, 0)]), { budgetMs: 5000 });
    assert.ok(r.ok, r.error);
    near(r.dc.nodes[2], 0.5, 1e-4, `gain ${gain}: control`);
    near(r.dc.nodes[3], r.dc.nodes[2] * gain, 1e-9, `gain ${gain} into ${load} Ω`);
    near(-r.dc.devices.E1.main.i, r.dc.nodes[3] / load, 2e-3, `gain ${gain}: output current`);
  }
});

test("VCCS: gm times the control voltage out of the + pin, the output resistance in parallel", () => {
  for (const [gm, load] of [[2e-3, 1e3], [1e-2, 100], [-5e-3, 10e3]]) {
    const r = E.simulate(circuit([vdc(1, 1), { id: "G1", type: "vccs", params: { gm, rout: 1e6 }, pins: { "+": 3, "-": 0, "C+": 1, "C-": 0 } }, R(load, 3, 0)]), { budgetMs: 5000 });
    assert.ok(r.ok, r.error);
    near(r.dc.nodes[3], gm * (load * 1e6 / (load + 1e6)), 1e-5, `gm ${gm} into ${load} Ω`);
    near(r.dc.devices.G1.main.i, gm, 1e-5, `gm ${gm}: the current`);
  }
});

test("a VCVS of gain 100k with feedback is a non-inverting amplifier of 1 + R2/R1; the AC sweep agrees with the transient", () => {
  const nl = circuit([{ id: "gen", type: "siggen", params: { amp: 0.1, freq: 1000, rs: 1e-3 }, pins: { "+": 1, "-": 0 } },
    { type: "vcvs", params: { gain: 1e5 }, pins: { "+": 3, "-": 0, "C+": 1, "C-": 2 } }, R(9e3, 3, 2), R(1e3, 2, 0)]);
  const want = 1e5 / (1 + 1e5 / 10);
  const r = E.simulate(nl, { budgetMs: 5000 });
  assert.ok(r.ok, r.error);
  const v = Array.from(r.tran.nodes[3]);
  near((Math.max(...v) - Math.min(...v)) / 0.2, want, 1e-3, "transient gain");
  const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 10, fStop: 1e6, perDecade: 10, probes: [[3, 0]] });
  assert.ok(ac.ok, ac.error);
  ac.freqs.forEach((f, k) => near(Math.hypot(ac.probes[0].re[k], ac.probes[0].im[k]), want, 1e-6, `AC gain at ${f} Hz`));
});

test("a VCCS as a 12AX7's small-signal model: gain −gm·(ra ∥ RL), flat until the Miller capacitance", () => {
  const gm = 1.6e-3, ra = 62.5e3, rl = 100e3;
  // the current gm·vg drawn from the plate (out of the + pin into ground); 100 pF at the plate
  const nl = circuit([{ id: "gen", type: "siggen", params: { amp: 0.01, freq: 1000, rs: 1e-3 }, pins: { "+": 1, "-": 0 } },
    { type: "vccs", params: { gm, rout: ra }, pins: { "+": 0, "-": 2, "C+": 1, "C-": 0 } }, { type: "vdc", params: { v: 250 }, pins: { "+": 3, "-": 0 } }, R(rl, 3, 2),
    { type: "capacitor", params: { c: 100e-12 }, pins: { 1: 2, 2: 0 } }]);
  const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 10, fStop: 1e7, perDecade: 50, probes: [[2, 0]] });
  assert.ok(ac.ok, ac.error);
  const rp = ra * rl / (ra + rl), a0 = gm * rp, fc = 1 / (2 * Math.PI * rp * 100e-12);
  near(ac.probes[0].re[0], -a0, 1e-3, "midband gain, inverted");
  const k = ac.freqs.findIndex(f => f >= fc);
  near(Math.hypot(ac.probes[0].re[k], ac.probes[0].im[k]), a0 / Math.SQRT2, 0.03, `−3 dB at ${fc.toFixed(0)} Hz`);
});
