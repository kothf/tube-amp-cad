/**
 * Logic inside the simulator (sim-digital.js, run by sim-engine.js transient): the app's own
 * primitives (ripple counter, 4017 decade counter, clock and pattern sources), the DC iteration of
 * logic and analogue, CMOS-style bridges on rails (a Schmitt-trigger RC oscillator against its
 * formula), a DAC in the frequency response, and spice-net's reading of XSPICE A lines (node --test).
 * The XSPICE primitives against ngspice: tests/digital-ngspice.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["spice-model.js", "spice-net.js", "sim-digital.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ±${tol}`);
const net = (r, name) => r.digital.find(d => d.name === name);
// the state of a recorded net at time x
const stateAt = (d, x) => { let v = d.v[0]; for (let i = 0; i < d.t.length && d.t[i] <= x; i++) v = d.v[i]; return v; };

test("a clock into a 4-bit ripple counter counts on falling edges, each bit a stage later", () => {
  const els = [
    { id: "CK", kind: "DIG", type: "clock", in: [], out: ["clk"], p: { period: 1e-6, duty: 0.5, delay: 0.25e-6 } },
    { id: "CT", kind: "DIG", type: "counter", in: ["clk", null], out: ["q0", "q1", "q2", "q3"], p: { delay: 10e-9, stage: 5e-9, edge: "fall" } },
    { id: "R", kind: "R", nodes: [1, 0], r: 1e3 }];
  const r = E.transient({ nodeCount: 2, elements: els }, { tStop: 20e-6 });
  assert.ok(r.ok, r.error);
  const q = k => net(r, "q" + k);
  // after n falling edges (at 0.75 µs + k µs) the count is n mod 16
  for (const n of [1, 2, 5, 11, 16, 19]) {
    const x = 0.75e-6 + (n - 1) * 1e-6 + 0.2e-6, c = [0, 1, 2, 3].reduce((s, k) => s + stateAt(q(k), x) * (1 << k), 0);
    assert.equal(c, n % 16, `count after ${n} edges`);
  }
  // the 8th edge carries through all four bits: q3 rises 10 + 3·5 ns after it
  const t8 = 0.75e-6 + 7e-6, rise = q(3).t.find(t => t > t8 - 1e-9);
  near(rise - t8, 25e-9, 1e-15, "q3 after the clock edge");
});

test("a 4017 decade counter walks its ten outputs and carry, and reset clears it", () => {
  const outs = Array.from({ length: 10 }, (_, k) => "q" + k).concat(["co"]);
  const els = [
    { id: "CK", kind: "DIG", type: "clock", in: [], out: ["clk"], p: { period: 1e-6, delay: 0.5e-6 } },
    { id: "RS", kind: "DIG", type: "pattern", in: [], out: ["rst"], p: { bits: "0000000000000100000000000", tbit: 1e-6 } },
    { id: "J", kind: "DIG", type: "johnson", in: ["clk", null, "rst"], out: outs, p: { delay: 20e-9 } },
    { id: "R", kind: "R", nodes: [1, 0], r: 1e3 }];
  const r = E.transient({ nodeCount: 2, elements: els }, { tStop: 20e-6 });
  assert.ok(r.ok, r.error);
  const active = x => outs.slice(0, 10).filter(k => stateAt(net(r, k), x) === 1);
  assert.deepEqual(active(0.2e-6), ["q0"]);
  assert.deepEqual(active(3.8e-6), ["q4"], "four rising edges (0.5 … 3.5 µs)");
  assert.equal(stateAt(net(r, "co"), 3.8e-6), 1); assert.equal(stateAt(net(r, "co"), 5.8e-6), 0, "carry low from count 5");
  assert.deepEqual(active(11.8e-6), ["q2"], "past 9 it wraps: 12 edges → 2");
  assert.deepEqual(active(13.8e-6), ["q0"], "reset high from 13 to 14 µs");
  assert.deepEqual(active(14.8e-6), ["q1"], "counting again after reset");
});

test("a pattern source plays its bits through a DAC; a DAC follows its rails", () => {
  const els = [
    { id: "P", kind: "DIG", type: "pattern", in: [], out: ["d"], p: { bits: "1011", tbit: 1e-6, delay: 1e-6, repeat: true } },
    { id: "DA", kind: "DAC", nodes: [1, 0], in: "d", p: { lo: 0.2, hi: 3.3, trise: 10e-9, tfall: 10e-9 } },
    { id: "R1", kind: "R", nodes: [1, 0], r: 10e3 },
    { id: "VCC", kind: "V", nodes: [2, 0], v: 12 },
    { id: "DB", kind: "DAC", nodes: [3, 0, 2], in: "d", p: { trise: 10e-9, tfall: 10e-9 } },
    { id: "R2", kind: "R", nodes: [3, 0], r: 10e3 }];
  const r = E.transient({ nodeCount: 4, elements: els }, { tStop: 10e-6 });
  assert.ok(r.ok, r.error);
  const v = (node, x) => { let k = 1; while (k < r.t.length - 1 && r.t[k] < x) k++; const f = (x - r.t[k - 1]) / (r.t[k] - r.t[k - 1]); return r.nodes[node][k - 1] + f * (r.nodes[node][k] - r.nodes[node][k - 1]); };
  const want = [0, 1, 0, 1, 1, 1, 0, 1, 1];   // idle 0, then 1011 1011…
  want.forEach((b, k) => { near(v(1, k * 1e-6 + 0.5e-6), b ? 3.3 : 0.2, 1e-6, `bit ${k} (fixed levels)`); near(v(3, k * 1e-6 + 0.5e-6), b ? 12 : 0, 1e-6, `bit ${k} (rail to rail)`); });
  near(v(1, 2e-6 + 5e-9), 0.2 + 3.1 * 0.5, 0.05, "half way up its 10 ns ramp");
});

test("DC: the logic and the analogue settle together, and the frequency response sees a DAC as its rails", () => {
  // an ADC reading a divider that a DAC feeds: 1 → 5 V → 2.5 V on the divider, above 2 V: stays 1
  const els = [
    { id: "PU", kind: "DIG", type: "pullup", in: [], out: ["en"], p: {} },
    { id: "G", kind: "DIG", type: "and", in: ["en", "fb"], out: ["y"], p: {} },
    { id: "AD", kind: "ADC", nodes: [2], out: "fb", p: { lo: 2, hi: 2 } },
    { id: "DA", kind: "DAC", nodes: [1, 0, 3], in: "y", p: {} },
    { id: "R1", kind: "R", nodes: [1, 2], r: 1e3 }, { id: "R2", kind: "R", nodes: [2, 0], r: 1e3 },
    { id: "VCC", kind: "V", nodes: [3, 0], v: 5 }];
  const c = E.buildCircuit({ nodeCount: 4, elements: els }), dc = E.dcOperatingPoint(c);
  assert.ok(dc.ok);
  // from all-zero nets the AND gives 0: its DAC 0 V, the ADC reads 0 — a stable DC state
  near(dc.x[1], 0, 1e-6, "divider at 0 V (fb 0 keeps y 0)");
  // a 1 V ripple on VCC: the DAC's output, low, follows GND: nothing reaches the divider
  const ac = E.acSweep({ nodeCount: 4, elements: els }, { fStart: 100, fStop: 100, perDecade: 1, inputs: [{ id: "VCC", mag: 1 }] });
  assert.ok(ac.ok, ac.error);
  near(Math.hypot(ac.re[2][0], ac.im[2][0]), 0, 1e-9, "ripple at the divider with the output low");
});

test("a Schmitt-trigger RC oscillator on rails runs at its formula's frequency", () => {
  // a 74HC14-style inverter: thresholds 0.31 and 0.53 of VCC, 50 Ω out, 1 ns delay; 10 kΩ, 10 nF
  const VCC = 5, lo = 0.31, hi = 0.53, R = 10e3, C = 10e-9;
  const els = [
    { id: "VCC", kind: "V", nodes: [1, 0], v: VCC },
    { id: "AD", kind: "ADC", nodes: [2, 0, 1], out: "a", p: { lo, hi, hyst: true, rise: 1e-9, fall: 1e-9 } },
    { id: "IN", kind: "DIG", type: "inverter", in: ["a"], out: ["y"], p: { rise_delay: 1e-9, fall_delay: 1e-9 } },
    { id: "DA", kind: "DAC", nodes: [3, 0, 1], in: "y", p: { trise: 5e-9, tfall: 5e-9 } },
    { id: "RO", kind: "R", nodes: [3, 4], r: 50 },
    { id: "R", kind: "R", nodes: [4, 2], r: R }, { id: "C", kind: "C", nodes: [2, 0], c: C }];
  const r = E.transient({ nodeCount: 5, elements: els }, { tStop: 2e-3, uic: true });
  assert.ok(r.ok, r.error);
  const up = r.digital.find(d => d.name === "y"), rises = [];
  for (let i = 1; i < up.t.length; i++) if (up.v[i] === 1 && up.t[i] > 0.5e-3) rises.push(up.t[i]);
  const T = (rises[rises.length - 1] - rises[0]) / (rises.length - 1), Rt = R + 50;
  const want = Rt * C * Math.log((1 - lo) / (1 - hi)) + Rt * C * Math.log(hi / lo);
  near(T, want, want * 0.005, "period");
});

test("spice-net reads XSPICE lines: vectors, NULL, ~, a model in a subcircuit, and refuses what it cannot run", () => {
  const sub = `.subckt T a y
A1 [a] [d] ad
A2 [d ~d] x g
A3 d clk NULL ~d q NULL ff
A4 [q] [y] da
V1 c 0 PULSE(0 1 0 1n 1n 1u 2u)
A5 [c] [clk] ad
.model ad adc_bridge(in_low=0.5 in_high=0.5)
.model g d_xor
.model ff d_dff(ic=1)
.model da dac_bridge(out_high=3.3)
.ends`;
  const f = SN.flatten(sub, "T"), dig = f.els.filter(e => e.kind === "DIG");
  assert.deepEqual(dig.map(e => e.type), ["xor", "dff"]);
  assert.deepEqual(dig[0].inv.in, [false, true]);
  assert.deepEqual(dig[1].in, ["d", "clk", null, "d"], "NULL for set; reset is ~d");
  assert.equal(f.els.find(e => e.kind === "DAC").p.undef, 0.5, "out_undef stays 0.5 when only out_high is given (XSPICE)");
  assert.throws(() => SN.flatten(".subckt T a\nA1 [a] [b] m\n.model m d_osc\n.ends", "T"), /d_osc is not supported/);
  assert.throws(() => SN.flatten(".subckt T a y\nA1 a y m\n.model m d_inverter\n.ends", "T"), /pin a is used as a logic node/);
  // the part runs: built twice in one circuit, the two copies keep their nets apart
  let n = 4; const els = [...SN.build({ text: sub, sub: "T" }, [1, 2], () => n++, "U1"), ...SN.build({ text: sub, sub: "T" }, [1, 3], () => n++, "U2"), { id: "V", kind: "V", nodes: [1, 0], v: 1 }, { id: "RL", kind: "R", nodes: [2, 0], r: 1e3 }];
  const r = E.transient({ nodeCount: n, elements: els }, { tStop: 5e-6 });
  assert.ok(r.ok, r.error);
  assert.ok(r.digital.some(d => d.name === "U1#q") && r.digital.some(d => d.name === "U2#q"));
});

test("from zero (uic) a flip-flop whose active-low preset and clear are tied to the supply starts at its ic, not undefined", () => {
  // the supply is 0 V before the first step: read then, PRE and CLR would both be active and Q X
  const els = [
    { id: "VCC", kind: "V", nodes: [1, 0], v: 5 },
    { id: "AP", kind: "ADC", nodes: [1, 0, 1], out: "pre", p: { lo: 0.5, hi: 0.5 } },
    { id: "AC", kind: "ADC", nodes: [1, 0, 1], out: "clr", p: { lo: 0.5, hi: 0.5 } },
    { id: "CK", kind: "DIG", type: "clock", in: [], out: ["clk"], p: { period: 2e-6, delay: 1e-6 } },
    { id: "PD", kind: "DIG", type: "pulldown", in: [], out: ["d"], p: {} },
    { id: "FF", kind: "DIG", type: "dff", in: ["d", "clk", "pre", "clr"], out: ["q", "qn"], inv: { in: [false, false, true, true], out: [false, false] }, p: { clk_delay: 10e-9, ic: 0 } },
    { id: "R", kind: "R", nodes: [1, 0], r: 1e3 }];
  const r = E.transient({ nodeCount: 2, elements: els }, { tStop: 3e-6, uic: true });
  assert.ok(r.ok, r.error);
  assert.equal(stateAt(net(r, "q"), 0.5e-6), 0, "Q at its ic before the first clock");
  assert.equal(stateAt(net(r, "qn"), 0.5e-6), 1);
});
