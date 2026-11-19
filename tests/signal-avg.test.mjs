/**
 * What parts see with a signal on, and the transient's pin currents (sim-engine.js): a signal-driven
 * run keeps its operating point as result.dc and its averages over the cycle as result.sig (a
 * rectifier's average current, a neon striking on the peaks, a class-B transistor's dissipation);
 * the free transient's pin currents add up to zero at every node (capacitors by the step's own
 * rule, a diode's stored charge), and a saturated op-amp's DC currents are its solution's (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

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
const R = (id, r, a, b) => ({ id, type: "resistor", params: { r }, pins: { 1: a, 2: b } });
const gen = (amp, freq, a) => ({ id: "G1", type: "siggen", params: { wave: "sine", amp, freq, rs: 0.01 }, pins: { "+": a, "-": 0 } });
// a part's current into net `node` over the transient's samples, from its elements' pin currents
const pinI = (r, part, node) => { const y = new Float64Array(r.points); r.pinI.ids.forEach(([id, n], k) => { const s = String(id); if ((s === part || s.startsWith(part + "#")) && n === node) r.pinI.vals[k].forEach((v, i) => { y[i] += v; }); }); return y; };
const kclErr = (r, parts, node) => { const ys = parts.map(p => pinI(r, p, node)); let e = 0, m = 0; for (let i = 1; i < r.points; i++) { let s = 0; ys.forEach(y => { s += y[i]; m = Math.max(m, Math.abs(y[i])); }); e = Math.max(e, Math.abs(s)); } return e / m; };

test("signal-driven run: the operating point stays, the averages over the cycle come as result.sig", () => {
  // a half-wave rectifier on a 10 V peak sine into 1 kΩ: no current at rest, about (10 − 0.7)/π mA on average
  const r = E.simulate(circuit([gen(10, 1000, 1), { id: "D1", type: "diode", params: { model: "1N4148" in L.DIODES ? "1N4148" : "1N4007" }, pins: { A: 1, K: 2 } }, R("R1", 1000, 2, 0)]), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  assert.ok(!r.dcAveraged && r.sig, "a signal-driven run keeps its operating point and gives the averages apart");
  const at = (cur, id, node) => { let s = 0; for (let k = 0; k < cur.length; k += 3) if (String(cur[k]).split("#")[0] === id && cur[k + 1] === node) s += cur[k + 2]; return s; };
  const i0 = at(r.dc.currents, "R1", 2), is = at(r.sig.currents, "R1", 2);
  assert.ok(Math.abs(i0) < 1e-6, `no current at the operating point (${i0})`);
  assert.ok(is > 2.6e-3 && is < 3.1e-3, `the average with the signal: about 2.9 mA (${is})`);
  assert.ok(r.sig.devices.D1.main.pd > 1e-3, `the diode's average power with the signal (${r.sig.devices.D1.main.pd} W)`);
});

test("a neon driven by a signal strikes on the peaks: its share of the time lit", () => {
  const m = L.NEONS["NE-2"], amp = m.vs + 40;
  const r = E.simulate(circuit([gen(amp, 50, 1), R("R1", 100e3, 1, 2), { id: "N1", type: "neon", params: { model: "NE-2" }, pins: { A: 2, K: 0 } }]), { budgetMs: 30000 });
  assert.ok(r.ok, r.error);
  const q0 = r.dc.devices.N1.main.q + r.dc.devices["N1#rev"].main.q, q = r.sig.devices.N1.main.q + r.sig.devices["N1#rev"].main.q;
  assert.equal(q0, 0, "dark at rest");
  assert.ok(q > 0.2 && q < 0.95, `lit part of each cycle, either way round (${q})`);
});

test("free transient: a capacitor's current is the one the step used, so the node's currents add up", () => {
  const n = { nodeCount: 3, elements: [{ id: "V1", kind: "V", nodes: [1, 0], v: 0, tw: { type: "sin", vo: 0, va: 1, freq: 1000, td: 0, theta: 0, phase: 0 } }, { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C1", kind: "C", nodes: [2, 0], c: 1e-7 }] };
  const r = E.transient(n, { tStop: 3e-3, currents: true });
  assert.ok(r.ok);
  const e = kclErr(r, ["R1", "C1"], 2);
  assert.ok(e < 1e-5, `I(R1) + I(C1) at their node: ${e} of the largest (was about 3 %)`);
});

test("free transient: a switching transistor's and a recovering diode's pin currents add up at their nodes", () => {
  const sw = circuit([{ id: "V1", type: "siggen", params: { wave: "pulse", vlo: 0, vhi: 5, td: 1e-6, tr: 1e-9, tf: 1e-9, pw: 2e-6, per: 0, rs: 0.01 }, pins: { "+": 1, "-": 0 } },
    R("RB", 1000, 1, 3), { id: "Q1", type: "npn", params: { model: "2N3904" }, pins: { C: 2, B: 3, E: 0 } }, { id: "VC", type: "vdc", params: { v: 10 }, pins: { "+": 4, "-": 0 } }, R("RC", 1000, 4, 2)]);
  const r = E.transient(sw, { tStop: 6e-6, currents: true, maxStep: 2e-9 });
  assert.ok(r.ok, r.error);
  assert.ok(kclErr(r, ["Q1", "RC"], 2) < 1e-5, "collector node");
  assert.ok(kclErr(r, ["Q1", "RB"], 3) < 1e-5, "base node");
  // a 1N4007 (TT 4.3 µs) switched from forward to reverse: it conducts backwards a while, at both its pins
  const d = circuit([{ id: "V1", type: "siggen", params: { wave: "pulse", vlo: 5, vhi: -5, td: 10e-6, tr: 1e-8, tf: 1e-8, pw: 1, per: 0, rs: 0.01 }, pins: { "+": 1, "-": 0 } },
    { id: "D1", type: "diode", params: { model: "1N4007" }, pins: { A: 1, K: 2 } }, R("R1", 100, 2, 0)]);
  const q = E.transient(d, { tStop: 20e-6, currents: true, maxStep: 5e-8 });
  assert.ok(q.ok, q.error);
  assert.ok(kclErr(q, ["D1", "R1"], 2) < 1e-4, "cathode node");
  const ia = pinI(q, "D1", 1); let lo = 0; for (let i = 0; i < q.points; i++) lo = Math.min(lo, ia[i]);
  assert.ok(lo < -0.02, `reverse recovery shows in I(D1.A) (${lo} A)`);
});

test("a saturated op-amp's DC currents are its operating point's: its pins add up to zero", () => {
  for (const model of ["LM4562", "NE5532", "TL071"]) {
    const r = E.simulate(circuit([{ id: "V1", type: "vdc", params: { v: 1 }, pins: { "+": 1, "-": 0 } }, { id: "U1", type: "opamp", params: { model }, pins: { "+": 1, "-": 5, OUT: 2, "V+": 3, "V-": 4 } }, R("RM", 1000, 5, 0),
      { id: "VP", type: "vdc", params: { v: 12 }, pins: { "+": 3, "-": 0 } }, { id: "VN", type: "vdc", params: { v: -12 }, pins: { "+": 4, "-": 0 } }, R("RL", 2000, 2, 0)]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    let s = 0, m = 0; const cur = r.dc.currents;
    for (let k = 0; k < cur.length; k += 3) if (String(cur[k]).split("#")[0] === "U1" && [1, 5, 2, 3, 4].includes(cur[k + 1])) { s += cur[k + 2]; m = Math.max(m, Math.abs(cur[k + 2])); }
    const leak = cur.reduce((a, v, k) => (k % 3 === 0 && String(v).startsWith("U1#l") && cur[k + 1] === 0 ? a + cur[k + 2] : a), 0);
    assert.ok(Math.abs(s + leak) < 1e-3 * m, `${model}: its pins' currents add up (${s} vs ${m})`);
    const d = r.dc.devices.U1.main;
    assert.ok(d.pd > 0.03 && d.pd < 0.3, `${model}: a sane dissipation saturated (${d.pd} W)`);
  }
});

test("free transient: a valve rectifier on mains, switched on at the sine's peak, runs from the start (example 07 stopped at 50 ns)", () => {
  // mains → 373BX → 5Ц4С full-wave → 180 Ω per anode → 6.8 µF, choke 2.5 H, 220 µF: as example 07's supply
  const net = circuit([
    { id: "XS1", type: "mains", params: { vrms: 230, freq: "50", rs: 0.5 }, pins: { L: 1, N: 2 } },
    { id: "T1", type: "ptx_cat", params: { model: "373BX", tap: "230", bias: "no" }, pins: { P1: 1, P2: 2, HT1: 3, CT: 0, HT2: 4 } },
    R("R1", 180, 3, 5), R("R2", 180, 4, 6),
    { id: "VL1", type: "tube", params: { tube: "5Ts4S" }, pins: { A1: 5, A2: 6, K: 7 } },
    { id: "C1", type: "capacitor", params: { c: 6.8e-6 }, pins: { 1: 7, 2: 0 } },
    { id: "L1", type: "inductor", params: { l: 2.5, dcr: 133 }, pins: { 1: 7, 2: 8 } },
    { id: "C2", type: "capacitor", params: { c: 220e-6 }, pins: { 1: 8, 2: 0 } }, R("R3", 10e3, 8, 0)]);
  assert.ok(net.elements.filter(e => e.kind === "C" && /^VL1#cak/.test(e.id)).length === 2, "each rectifier anode has its capacitance to the cathode");
  const r = E.transient(net, { tStop: 20e-3 });
  assert.ok(r.ok, r.error);
  const v7 = r.nodes[7], at = t => v7[r.t.findIndex(x => x >= t - 1e-12)];
  // switched on at the peak, the first capacitor charges through 180 Ω + the winding at once (ngspice with uic: 164 V at 1 ms)
  assert.ok(at(1e-3) > 100 && at(2e-3) > 200, `the reservoir charges from the first half-cycle (${at(1e-3).toFixed(0)} V at 1 ms, ${at(2e-3).toFixed(0)} V at 2 ms)`);
});
