/**
 * The curve tracer's transistor curves (semi-curves.js) against the simulator: every BJT, MOSFET and
 * JFET in the library, built as the CAD builds it and solved by the engine, gives the current the
 * tracer draws; the steps, ranges and inverse look-ups behave (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "semi-curves.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, SC = globalThis.SemiCurves;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

const bjtType = k => (L.BJTS[k].pol > 0 ? "npn" : "pnp");
const fetType = k => (L.JFETS[k] ? (L.JFETS[k].pol > 0 ? "njf" : "pjf") : L.MOSFETS[k].pol > 0 ? "nmos" : "pmos");
// the engine's answer: the part at vce with ib forced into its base (or at vds with vgs on its gate)
function simBjt(k, vce, ib, temp) {
  const pol = L.BJTS[k].pol, els = [{ id: "vc", kind: "V", nodes: [1, 0], v: pol * vce }, { id: "ib", kind: "I", nodes: [0, 2], i: pol * ib }];
  let n = 3;
  L.LIB[bjtType(k)].build({ id: "q", params: { model: k, temp } }, pid => ({ C: 1, B: 2, E: 0 })[pid], () => n++, els);
  const r = E.simulate({ nodeCount: n, elements: els });
  return { ...r.dc.devices.q.main, vb: r.dc.nodes[2] };
}
function simFet(k, vds, vgs) {
  const pol = (L.MOSFETS[k] || L.JFETS[k]).pol, els = [{ id: "vd", kind: "V", nodes: [1, 0], v: pol * vds }, { id: "vg", kind: "V", nodes: [2, 0], v: pol * vgs }];
  let n = 3;
  L.LIB[fetType(k)].build({ id: "q", params: { model: k } }, pid => ({ D: 1, G: 2, S: 0 })[pid], () => n++, els);
  const c = E.simulate({ nodeCount: n, elements: els }).dc.currents;
  for (let j = 0; j < c.length; j += 3) if (c[j] === "vd") return Math.abs(c[j + 2]);
  return NaN;
}

test("every BJT's curves are the simulator's: IC and VBE at the pins, at 25 and 70 °C", () => {
  for (const k of Object.keys(L.BJTS)) for (const temp of [25, 70]) {
    const dev = SC.device(bjtType(k), k, temp), rg = SC.autoRange(dev), st = SC.steps(dev, rg.vMax, rg.iTop, 6);
    const ib = st.values[Math.ceil(st.values.length / 2)];
    for (const vce of [0.2, rg.vMax / 2]) {
      const a = SC.bjt(dev, vce, ib), b = simBjt(k, vce, ib, temp);
      assert.ok(Math.abs(a.ic - b.ic) <= 1e-4 * Math.abs(b.ic), `${k} ${temp} °C at VCE ${vce} V, IB ${ib} A: tracer ${a.ic} A, simulator ${b.ic} A`);
      assert.ok(Math.abs(a.vbe - b.vbe) < 1e-4, `${k}: VBE ${a.vbe} V vs ${b.vbe} V`);
    }
  }
});

test("every MOSFET's and JFET's curves are the simulator's", () => {
  for (const k of Object.keys({ ...L.MOSFETS, ...L.JFETS })) {
    const dev = SC.device(fetType(k), k), rg = SC.autoRange(dev), st = SC.steps(dev, rg.vMax, rg.iTop, 6);
    for (const vgs of [st.values[0], st.values[st.values.length - 1]]) for (const vds of [0.3, rg.vMax / 2]) {
      const a = SC.fet(dev, vds, vgs), b = simFet(k, vds, vgs);
      // a JFET's gate junctions leak a few pA into the drain, which the channel's current leaves out
      assert.ok(Math.abs(a - b) <= 1e-3 * b + 1e-10, `${k} at VDS ${vds} V, VGS ${vgs} V: tracer ${a} A, simulator ${b} A`);
    }
  }
});

test("the families: base currents from 0, gate voltages above cut-off, rising curve by curve", () => {
  for (const k of Object.keys(L.BJTS).concat(Object.keys(L.MOSFETS), Object.keys(L.JFETS))) {
    const type = L.BJTS[k] ? bjtType(k) : fetType(k), dev = SC.device(type, k), rg = SC.autoRange(dev), st = SC.steps(dev, rg.vMax, rg.iTop, 8);
    assert.ok(st.values.length >= 3 && st.values.length <= 9, `${k}: ${st.values.length} curves`);
    if (dev.bip) assert.equal(st.values[0], 0, `${k}: the first curve is IB = 0`);
    else assert.ok(st.values.every(v => v > dev.vth), `${k}: every curve above the cut-off ${dev.vth} V`);
    const at = c => (dev.bip ? SC.bjt(dev, rg.vMax / 2, c).ic : SC.fet(dev, rg.vMax / 2, c));
    const sorted = st.values.slice().sort((a, b) => a - b).map(at);
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] > sorted[i - 1], `${k}: each curve above the one before`);
    assert.ok(rg.vMax <= dev.spec.v * 1.5 + 1e-9, `${k}: the voltage axis ${rg.vMax} V within its rating ${dev.spec.v} V`);
  }
});

test("inverse look-ups: the base current or gate voltage that puts the part at a point", () => {
  const q = SC.device("npn", "2N3904"), ib = SC.ibFor(q, 5, 1e-3);
  assert.ok(Math.abs(SC.bjt(q, 5, ib).ic - 1e-3) < 1e-8, `2N3904 IB for 1 mA: ${ib}`);
  const m = SC.device("nmos", "IRF540"), vg = SC.vgsFor(m, 10, 1);
  assert.ok(Math.abs(SC.fet(m, 10, vg) - 1) < 1e-6 && vg > 3.25 && vg < 4, `IRF540 VGS for 1 A: ${vg}`);
  const j = SC.device("pjf", "J175");
  assert.ok(j.pol === -1 && j.vth === -4 && Math.abs(SC.fet(j, 10, 0) - j.idss * (1 + 10 * j.m.lambda)) < 1e-9, "J175: P-channel in its own frame, IDSS at VGS 0");
  assert.equal(SC.vgsFor(j, 10, 1), null, "a JFET cannot reach 1 A");
});

test("germanium: the IB = 0 curve is the leakage ICEO, and it grows with temperature", () => {
  const cold = SC.device("pnp", "AC128", 25), hot = SC.device("pnp", "AC128", 45), r = SC.smallSignal(cold, 5, 50e-6);
  const iceo = SC.bjt(cold, 5, 0).ic, icbo = L.BJTS.AC128.icbo;
  assert.ok(iceo > 0.5 * (r.h21 + 1) * icbo && iceo < 2 * (r.h21 + 1) * icbo, `ICEO ${iceo} A vs (h21e + 1)·ICBO ${(r.h21 + 1) * icbo} A`);
  assert.ok(SC.bjt(hot, 5, 0).ic > 3 * iceo, "leakage at 45 °C several times that at 25 °C");
  assert.ok(SC.ibFor(cold, 5, iceo / 2) < 0, "below ICEO the base must draw current out");
});

test("transfer and gain curves: VBE where the datasheets have it, hFE and gm against current", () => {
  const q = SC.device("npn", "2N3904"), tc = SC.transferCurve(q, 5, 0.1);
  const at1mA = tc.find(p => p[1] >= 1e-3);
  assert.ok(at1mA[0] > 0.6 && at1mA[0] < 0.72, `2N3904 VBE at 1 mA ${at1mA[0]} V`);
  for (let i = 1; i < tc.length; i++) assert.ok(tc[i][0] > tc[i - 1][0] && tc[i][1] > tc[i - 1][1], "rising in both");
  const g = SC.gainCurve(q, 5, 0.2), h10 = g.find(p => p[0] >= 10e-3);
  assert.ok(h10[1] > 200 && h10[1] < 350 && g[g.length - 1][1] < h10[1] / 1.5, `2N3904 hFE ${h10[1]} at 10 mA, falling at high current`);
  const m = SC.device("nmos", "IRF540"), gm = SC.gainCurve(m, 10, 10), p = gm.find(r => r[0] >= 1);
  assert.ok(Math.abs(p[1] - Math.sqrt(2 * 9 * p[0] * (1 + 10 * 0.005))) < 0.02 * p[1], `IRF540 gm ${p[1]} S at ${p[0]} A, the square law's √(2·KP·ID)`);
});
