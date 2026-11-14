/**
 * The free transient (sim-engine.js transient, the Transient tab): the sources' waveforms and
 * corners, the adaptive step against exact answers, initial conditions, SPICE's source lines and
 * time in B sources, the signal generator's new waveforms, and the tab's pure helpers (node --test).
 * The same circuits against ngspice: tests/transient-ngspice.mjs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "cad-transient.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet, L = globalThis.CadLib, CT = globalThis.CadTransient;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ±${tol}`);
const at = (r, node, x) => CT.valueAt(r.t, r.nodes[node], x);

test("PULSE, SIN, EXP, SFFM and PWL give SPICE's values", () => {
  const p = { type: "pulse", v1: -1, v2: 3, td: 1, tr: 0.5, tf: 1, pw: 2, per: 6 };
  near(E.srcAt(p, 0.5), -1, 1e-12, "before the delay");
  near(E.srcAt(p, 1.25), 1, 1e-12, "half way up");
  near(E.srcAt(p, 3), 3, 1e-12, "on the top");
  near(E.srcAt(p, 4), 1, 1e-12, "half way down");
  near(E.srcAt(p, 5), -1, 1e-12, "low again");
  near(E.srcAt(p, 7.25), 1, 1e-12, "the next period");
  near(E.srcAt({ type: "pulse", v1: 0, v2: 5, td: 1, tr: 0, tf: 0, pw: 1, per: 0 }, 1.5), 5, 0, "a step (no rise time)");
  near(E.srcAt({ type: "sin", vo: 1, va: 2, freq: 10, td: 0.1, theta: 0, phase: 90 }, 0.05), 3, 1e-12, "SIN before its delay: its phase");
  near(E.srcAt({ type: "sin", vo: 0, va: 1, freq: 1, td: 0, theta: 1, phase: 0 }, 0.25), Math.exp(-0.25), 1e-12, "SIN damped");
  const x = { type: "exp", v1: 0, v2: 2, td1: 1, tau1: 1, td2: 3, tau2: 2 };
  near(E.srcAt(x, 2), 2 * (1 - Math.exp(-1)), 1e-12, "EXP rising");
  near(E.srcAt(x, 4), 2 * (1 - Math.exp(-3)) - 2 * (1 - Math.exp(-0.5)), 1e-12, "EXP falling");
  near(E.srcAt({ type: "sffm", vo: 0, va: 1, fc: 1, mdi: 2, fs: 0.25 }, 0.3), Math.sin(2 * Math.PI * 0.3 + 2 * Math.sin(2 * Math.PI * 0.075)), 1e-12, "SFFM");
  const w = { type: "pwl", pts: [0, 0, 1, 2, 2, 2, 3, 0], r: -1 };
  near(E.srcAt(w, 0.5), 1, 1e-12, "PWL between points"); near(E.srcAt(w, 9), 0, 0, "PWL holds its last value");
  near(E.srcAt(Object.assign({}, w, { r: 1 }), 3.5), 2, 1e-12, "PWL repeating from r=1 (3.5 → 1.5)");
});

test("the corners a run lands on", () => {
  const p = { type: "pulse", v1: 0, v2: 1, td: 1, tr: 0.1, tf: 0.2, pw: 0.5, per: 2 };
  const seq = []; let t = 0; for (let k = 0; k < 8; k++) { t = E.srcBreak(p, t); seq.push(+t.toFixed(9)); }
  assert.deepEqual(seq, [1, 1.1, 1.6, 1.8, 3, 3.1, 3.6, 3.8]);
  assert.equal(E.srcBreak({ type: "pulse", v1: 0, v2: 1, td: 1, tr: 0, tf: 0, pw: 1, per: 0 }, 2.5), Infinity, "a single pulse has no corners after it");
  assert.equal(E.srcBreak({ type: "pwl", pts: [0, 0, 1, 1, 3, 0], r: 0 }, 3.5), 4, "a repeating PWL's corners go on");
  assert.equal(E.srcBreak({ type: "exp", v1: 0, v2: 1, td1: 1, tau1: 1, td2: 2, tau2: 1 }, 1), 2);
});

const rc = { nodeCount: 3, elements: [
  { id: "V1", kind: "V", nodes: [1, 0], v: 0, tw: { type: "pulse", v1: 0, v2: 1, td: 1e-3, tr: 1e-6, tf: 1e-6, pw: 3e-3, per: 0 } },
  { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C1", kind: "C", nodes: [2, 0], c: 1e-6 }] };

test("an RC step response follows 1 − e^(−t/RC), with steps landing on the edges", () => {
  const r = E.transient(rc, { tStop: 8e-3 });
  assert.ok(r.ok, r.error);
  [1e-3, 1.001e-3, 4.001e-3, 4.002e-3].forEach(c => assert.ok(r.t.some(x => Math.abs(x - c) < 1e-12), `a step lands on ${c}`));
  for (const x of [1.5e-3, 2e-3, 3e-3, 3.9e-3]) near(at(r, 2, x), 1 - Math.exp(-(x - 1.0005e-3) / 1e-3), 2e-3, `v(C) at ${x}`);
  const v4 = 1 - Math.exp(-3e-3 / 1e-3);
  for (const x of [5e-3, 7e-3]) near(at(r, 2, x), v4 * Math.exp(-(x - 4.0015e-3) / 1e-3), 2e-3, `v(C) falling at ${x}`);
  assert.ok(r.steps < 700, `about a step per 1/500 of the run where nothing happens (${r.steps})`);
  const coarse = E.transient(rc, { tStop: 8e-3, maxStep: 1e-3 });
  assert.ok(coarse.steps < 150 && Math.abs(CT.valueAt(coarse.t, coarse.nodes[2], 3e-3) - (1 - Math.exp(-1.9995))) < 3e-3, `a longer maximum step: fewer steps, the same answer (${coarse.steps})`);
  assert.ok(r.currents.V1 && Math.abs(CT.valueAt(r.t, r.currents.V1, 1.0011e-3) + 1e-3) < 5e-5, "the source's current is kept (−1 mA into the empty capacitor)");
});

test("an LC tank keeps its amplitude (trapezoidal capacitors and inductors)", () => {
  const n = { nodeCount: 2, elements: [{ id: "L1", kind: "L", nodes: [1, 0], l: 1e-3 }, { id: "C1", kind: "C", nodes: [1, 0], c: 1e-9 }] };
  const r = E.transient(n, { tStop: 300e-6, uic: true, ic: { 1: 1 } });
  assert.ok(r.ok, r.error);
  let pk = 0, zc = [];
  for (let i = 1; i < r.points; i++) {
    if (r.t[i] > 250e-6) pk = Math.max(pk, r.nodes[1][i]);
    if (r.nodes[1][i - 1] < 0 && r.nodes[1][i] >= 0) zc.push(r.t[i - 1] + (r.t[i] - r.t[i - 1]) * -r.nodes[1][i - 1] / (r.nodes[1][i] - r.nodes[1][i - 1]));
  }
  near(pk, 1, 0.01, "the peak after 47 periods");
  near((zc[zc.length - 1] - zc[0]) / (zc.length - 1), 2 * Math.PI * Math.sqrt(1e-12), 2 * Math.PI * Math.sqrt(1e-12) * 0.006, "the period");
});

test("initial conditions: from zero (UIC) or held at the operating point; saving from a time", () => {
  const n = { nodeCount: 3, elements: [{ id: "V1", kind: "V", nodes: [1, 0], v: 5 }, { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C1", kind: "C", nodes: [2, 0], c: 1e-6 }] };
  const op = E.transient(n, { tStop: 2e-3 });
  near(op.nodes[2][0], 5, 1e-6, "from the operating point the capacitor starts charged");
  const z = E.transient(n, { tStop: 2e-3, uic: true });
  near(z.nodes[2][0], 0, 1e-9, "from zero it starts empty");
  near(at(z, 2, 1e-3), 5 * (1 - Math.exp(-1)), 0.01, "and charges with RC");
  const ic = E.transient(n, { tStop: 2e-3, uic: true, ic: { 2: 2 } });
  near(at(ic, 2, 1e-3), 5 - 3 * Math.exp(-1), 0.01, "from 2 V");
  const held = E.transient(n, { tStop: 2e-3, ic: { 2: 1 } });
  near(held.nodes[2][0], 1, 1e-3, ".ic holds the node at the operating point");
  near(at(held, 2, 1e-3), 5 - 4 * Math.exp(-1), 0.01, "then lets it go");
  const late = E.transient(n, { tStop: 2e-3, tStart: 1e-3, uic: true });
  near(late.t[0], 1e-3, 1e-12, "saving from 1 ms: the first point is there");
  const thin = E.transient(rc, { tStop: 8e-3, maxStep: 1e-6, maxValues: 6000 });
  assert.ok(thin.ok && thin.points <= 3000 && thin.steps > 7000, `a long record is thinned (${thin.steps} steps, ${thin.points} kept)`);
  assert.equal(thin.t[thin.points - 1], 8e-3, "the last point is kept");
  assert.equal(E.transient(rc, { tStop: 0 }).ok, false, "no stop time: an error");
});

test("SPICE source lines: PULSE, SIN, EXP, SFFM, PWL (r=, td=), with and without brackets; time in B", () => {
  const sub = `.subckt T a b c d e f g
V1 a 0 PULSE(0 5 1u 10n 10n 2u 5u)
V2 b 0 DC 1 SIN 1 2 1k
I1 0 c EXP(0 1m 0 1u 5u 1u)
R1 c 0 1k
V3 d 0 SFFM(0 1 1meg 2 10k)
V4 e 0 PWL(0 0 1u 1 2u 0) r=0 td=1u
V5 f 0 3
B1 g 0 V=V(f)*time*1e3
.ends`;
  const f = SN.flatten(sub, "T"), byName = Object.fromEntries(f.els.map(e => [e.name, e]));
  assert.deepEqual(Object.values(byName.v1.tw).map(v => (typeof v === "number" ? +v.toPrecision(9) : v)), ["pulse", 0, 5, 1e-6, 1e-8, 1e-8, 2e-6, 5e-6]);
  assert.equal(byName.v1.v, 0, "no DC value: the waveform at 0");
  assert.equal(byName.v2.v, 1, "DC 1 stays the operating point's value");
  assert.equal(byName.v2.tw.type, "sin"); assert.equal(byName.v2.tw.freq, 1000);
  assert.equal(byName.i1.tw.type, "exp"); assert.equal(byName.v3.tw.type, "sffm");
  assert.deepEqual(byName.v4.tw.pts, [1e-6, 0, 2e-6, 1, 3e-6, 0]); assert.equal(byName.v4.tw.r, 1e-6);
  assert.ok(!byName.v5.tw, "a DC source has no waveform");
  let n = f.nNodes;
  const els = SN.build({ text: sub, sub: "T" }, [1, 2, 3, 4, 5, 6, 7], () => n++, "U");
  const r = E.transient({ nodeCount: n, elements: els }, { tStop: 10e-6 });
  assert.ok(r.ok, r.error);
  near(at(r, 1, 2e-6), 5, 1e-9, "the pulse is up at 2 µs");
  near(at(r, 7, 4e-6), 3 * 4e-6 * 1e3, 1e-6, "B reads time");
  near(at(r, 3, 3e-6), 1 - Math.exp(-3), 0.002, "1 mA of EXP into 1 kΩ");
  assert.throws(() => SN.flatten(".subckt Q a\nV1 a 0 PWL file=x.txt\n.ends", "Q"), /file/);
});

test("the signal generator's pulse, PWL, exponential and FM", () => {
  const G = L.LIB.siggen, mk = p => ({ id: "G1", type: "siggen", label: "G1", params: Object.assign({}, G.defaults, p) });
  const build = c => { const out = []; let k = 3; G.build(c, pid => (pid === "+" ? 1 : 0), () => k++, out); return out; };
  const pu = build(mk({ wave: "pulse", vlo: -2, vhi: 3, td: 1e-3, per: 4e-3 }))[0];
  assert.equal(pu.tw.type, "pulse"); assert.equal(pu.freq, 250, "a repeating pulse sets the steady state's frequency");
  assert.equal(pu.dcValue, -2, "the operating point: the pulse's initial level");
  assert.equal(G.freqOf(mk({ wave: "pulse", per: 0 })), 0, "a single pulse: no frequency");
  assert.deepEqual(L.pwlPoints("0 0, 1m 5; 2m 0"), [0, 0, 1e-3, 5, 2e-3, 0]);
  assert.equal(L.pwlPoints("0 0, 1m"), null, "an odd count is refused");
  assert.equal(L.pwlPoints("1m 0, 0 5"), null, "a time going back is refused");
  const pw = build(mk({ wave: "pwl", pwl: "0 0, 1m 5, 2m 0", pwlrep: "yes" }))[0];
  assert.equal(pw.tw.r, 0); near(pw.freq, 500, 1e-9, "a repeating PWL's frequency");
  assert.equal(build(mk({ wave: "exp" }))[0].tw.type, "exp");
  const fm = build(mk({ wave: "fm", freq: 1000, amp: 2, mdi: 3, fm: 50 }))[0];
  assert.deepEqual([fm.tw.type, fm.tw.fc, fm.tw.va, fm.tw.mdi, fm.tw.fs, fm.freq], ["sffm", 1000, 2, 3, 50, 1000]);
  assert.ok(!build(mk({ wave: "sine" }))[0].tw, "a sine stays the generator it was");
});

test("the Transient tab's helpers: initial conditions, statistics, reading a trace", () => {
  const pe = L.parseEng;
  assert.deepEqual(CT.parseIc("OUT=2.5, b+ = 300 R3.2=-1m", pe), [{ name: "OUT", v: 2.5 }, { name: "b+", v: 300 }, { name: "R3.2", v: -1e-3 }]);
  assert.deepEqual(CT.parseIc("V(out)=5V", pe), [{ name: "out", v: 5 }]);
  assert.ok(CT.parseIc("OUT", pe).error);
  const t = new Float64Array([0, 1, 2, 3, 4]), y = new Float32Array([0, 2, 0, -2, 0]);
  const st = CT.traceStats(t, y);
  assert.deepEqual([st.min, st.max, st.pp, st.avg, st.end], [-2, 2, 4, 0, 0]);
  near(st.rms, Math.sqrt(4 / 3), 1e-6, "the RMS of a triangle");
  near(CT.valueAt(t, y, 2.5), -1, 1e-9, "between points");
});
