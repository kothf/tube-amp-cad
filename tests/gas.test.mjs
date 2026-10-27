/**
 * Gas voltage regulators (sim-engine.js GLOW, cad-components.js gasreg) and interstage / input
 * transformers (itx): the regulator's voltage over its current range, striking and going out
 * (a relaxation oscillator's period), a transformer's ratio, centre tap and leakage resonance,
 * and their board footprints (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-3d.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, B = globalThis.BoardCore, D3 = globalThis.Board3D;
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
const reg = (model, a) => ({ id: "V", type: "gasreg", params: { model }, pins: { A: a, K: 0 } });

test("gas regulators: lit from a supply above the striking voltage, the maintaining voltage plus the regulation over the current range", () => {
  for (const [model, m] of Object.entries(L.GASREGS)) {
    for (const i of [m.imin, (m.imin + m.imax) / 2, m.imax]) {
      // the series resistor for current i from a 300 V supply
      const rs = (300 - m.vm - m.r * i) / i, r = E.simulate(circuit([vdc(300, 1), R(rs, 1, 2), reg(model, 2)]), { budgetMs: 10000 });
      assert.ok(r.ok, `${model}: ${r.error}`);
      assert.equal(r.dc.devices.V.main.q, 1, `${model} lit`);
      near(r.dc.nodes[2], m.vm + m.r * i, 2e-3, `${model} at ${i * 1000} mA`);
      near(r.dc.devices.V.main.i, i, 0.02, `${model}: its current`);
    }
  }
});

test("gas regulators: dark below the striking voltage; out below the extinction current", () => {
  for (const [model, m] of Object.entries(L.GASREGS)) {
    let r = E.simulate(circuit([vdc(m.vs - 5, 1), R(10e3, 1, 2), reg(model, 2)]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    assert.equal(r.dc.devices.V.main.q, 0, `${model} at ${m.vs - 5} V`);
    near(r.dc.nodes[2], m.vs - 5, 1e-4, `${model}: dark, nothing through it`);
    // from 300 V the current would be under iext: struck it goes straight out
    r = E.simulate(circuit([vdc(300, 1), R((300 - m.vm) / (0.5 * m.iext), 1, 2), reg(model, 2)]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    assert.equal(r.dc.devices.V.main.q, 0, `${model} at half its extinction current`);
  }
});

test("a glow-tube relaxation oscillator: 0.1 µF across an 0A2 fed from 300 V through 1 MΩ, period RC·ln((E − Vm)/(E − Vs))", () => {
  const m = L.GASREGS["0A2"], r = E.simulate(circuit([vdc(300, 1), R(1e6, 1, 2), reg("0A2", 2), { type: "capacitor", params: { c: 0.1e-6 }, pins: { 1: 2, 2: 0 } }]), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  // it charges from where it went out (vm + r·iext) up to the striking voltage; the discharge is quick
  const T = 1e6 * 0.1e-6 * Math.log((300 - m.vm - m.r * m.iext) / (300 - m.vs));
  near(1 / r.tran.fBase, T, 0.03, "period");
  const v = Array.from(r.tran.nodes[2]);
  near(Math.max(...v), m.vs, 0.01, "the top of the sawtooth");
  assert.ok(Math.min(...v) < m.vm + 2, `the bottom of the sawtooth: ${Math.min(...v)} V`);
});

test("interstage / input transformers: the turns ratio mid-band, a centre tap's halves in antiphase, the leakage resonance", () => {
  for (const p of L.ITX_PRESETS) {
    const params = Object.assign({}, ...["ratio", "lp", "dcrp", "dcrs", "llk", "cs", "idc", "ct"].map(k => ({ [k]: p[k] }))), ct = p.ct === "yes";
    const nl = circuit([{ id: "gen", type: "siggen", params: { amp: 0.1, freq: 1000, rs: 1e-3 }, pins: { "+": 1, "-": 0 } },
      { type: "itx", params, pins: Object.assign({ P1: 1, P2: 0, S1: 2, S2: 3 }, ct ? { SC: 0 } : {}) }, ...(ct ? [] : [R(1e9, 3, 0)]), R(10e6, 2, 0), ...(ct ? [R(10e6, 3, 0)] : [])]);
    const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 10, fStop: 1e6, perDecade: 200, probes: [[2, 3], [2, 0], [3, 0]] });
    assert.ok(ac.ok, ac.error);
    const mag = (j, k) => Math.hypot(ac.probes[j].re[k], ac.probes[j].im[k]), k1 = ac.freqs.findIndex(f => f >= 1000);
    near(mag(0, k1), p.ratio, 0.02, `${p.id}: ratio at 1 kHz`);
    if (ct) {
      near(mag(1, k1), p.ratio / 2, 0.02, `${p.id}: S1 to the tap`);
      near(ac.probes[1].re[k1] / ac.probes[2].re[k1], -1, 0.02, `${p.id}: the halves in antiphase`);
    }
    // the peak where the leakage inductance meets the secondary's capacitance (seen at the primary);
    // a centre-tapped secondary's halves each leak to the primary, which moves it some 15 %
    const fr = 1 / (2 * Math.PI * Math.sqrt(p.llk * p.cs * p.ratio * p.ratio));
    let kp = 0; ac.freqs.forEach((f, k) => { if (mag(0, k) > mag(0, kp)) kp = k; });
    if (fr < 5e5) near(ac.freqs[kp], fr, ct ? 0.2 : 0.1, `${p.id}: leakage resonance`);
  }
});

test("board: gas regulators in their sockets (anode pin 5, cathode pin 2), transformers on EI cores, all pins on pads, with a 3D body", () => {
  const part = (type, params) => {
    const p = Object.assign({}, L.LIB[type].defaults, params), pins = L.LIB[type].pins({ params: p });
    return { id: "x", type, label: "X1", params: p, pins: pins.map((q, i) => ({ id: q.id, net: i + 1 })) };
  };
  const cases = [...Object.keys(L.GASREGS).map(model => ["gasreg", { model }]), ["itx", { ct: "no" }], ["itx", { ct: "yes" }]];
  for (const [type, params] of cases) {
    const g = B.physicalParts({ parts: [part(type, params)] })[0], what = `${type} ${JSON.stringify(params)}`;
    for (const name of g.options) {
      const f = B.footprint(name, g.members[0].pins.map(p => p.id));
      assert.ok(f, `${what}: ${name}`);
      const map = B.padMap(g, f), got = new Set([...map.values()].flat().map(x => x.pin));
      g.members[0].pins.forEach(p => assert.ok(got.has(p.id), `${what} on ${name}: pin ${p.id} has a pad`));
      if (/^SOCKET/.test(name)) assert.deepEqual([...map.keys()].sort(), ["2", "5"], `${what}: pins 2 and 5`);
      const bodies = D3.partBodies({ ...g, fp: f, place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {});
      assert.ok(bodies.length && bodies.every(s => s.verts.every(v => v.every(Number.isFinite))), `${what} on ${name}: 3D body`);
    }
  }
  assert.equal(B.physicalParts({ parts: [part("gasreg", { model: "0D3" })] })[0].options[0], "SOCKET-OCTAL");
});
