/**
 * Diodes, bridge rectifiers and zeners (cad-components.js DIODES, BRIDGES, ZENERS; the engine's
 * D element with its stored charge): forward voltage against the datasheet, reverse recovery in
 * the datasheet's trr test, a bridge's full-wave output, each zener's voltage at its test current,
 * the SPICE model line and the board footprints (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, B = globalThis.BoardCore;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected), `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);
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

// the datasheets' maximum forward voltage (V) at a forward current (A)
const VF_MAX = {
  "1N4001": [1, 1.1], "1N4004": [1, 1.1], "1N4007": [1, 1.1], "1N5404": [3, 1], "1N5408": [3, 1],
  UF4007: [1, 1.7], UF5408: [3, 1.7], MUR160: [1, 1.25], MUR460: [4, 1.28], HER108: [1, 1.7], FR107: [1, 1.3],
  "1N4148": [0.01, 1], BAT85: [0.1, 0.8], "1N5817": [1, 0.45], "1N5819": [1, 0.6], "1N5822": [3, 0.525], SB1100: [1, 0.85],
  C3D02060A: [2, 1.7], C3D04060A: [4, 1.8], C4D02120A: [2, 1.8]
};

test("diodes: forward voltage at the rated current under the datasheet maximum, and above the kind's knee", () => {
  assert.deepEqual(Object.keys(L.DIODES).sort(), Object.keys(VF_MAX).sort());
  for (const [model, d] of Object.entries(L.DIODES)) {
    const [i, vmax] = VF_MAX[model];
    // a current source into the diode: the anode voltage is its forward drop
    const r = E.simulate(circuit([{ type: "isrc", params: { i }, pins: { "+": 1, "-": 0 } }, { id: "D", type: "diode", params: { model }, pins: { A: 1, K: 0 } }]), { budgetMs: 10000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    const vf = r.dc.nodes[1];
    assert.ok(vf <= vmax, `${model}: ${vf.toFixed(3)} V at ${i} A, datasheet max ${vmax} V`);
    const knee = { schottky: 0.25, sic: 0.9 }[d.kind] || 0.6;
    assert.ok(vf > knee, `${model}: ${vf.toFixed(3)} V at ${i} A, below a ${d.kind} diode's ${knee} V`);
  }
});

// the datasheet's trr test: 0.5 A forward, then 1 A reverse (a square of +6 / −10 V through 10 Ω, its
// edges 1 % of the period), trr from the current's zero crossing to its return to −0.25 A
function trr(model) {
  const d = L.DIODES[model], T = 25 * d.tt;
  const nl = circuit([{ id: "G", type: "siggen", params: { wave: "square", amp: 8, offset: -2, freq: 1 / T, rs: 10 }, pins: { "+": 1, "-": 0 } }, { id: "D", type: "diode", params: { model }, pins: { A: 1, K: 0 } }]);
  const r = E.startup(nl, { tStop: 1.5 * T, probes: [[1, 0]], maxPoints: 100000, budgetMs: 60000 });
  assert.ok(r.ok, r.error);
  // the generator's current from its output voltage: (v_open − v) / rs
  const t = k => k * r.dt, vg = k => -2 + 8 * Math.max(-1, Math.min(1, 50 * (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * t(k) / T))));
  const i = Array.from(r.min[0], (v, k) => (vg(k) - (v + r.max[0][k]) / 2) / 10);
  let kz = -1; for (let k = Math.floor(i.length / 4); k < i.length; k++) if (i[k - 1] > 0 && i[k] <= 0) { kz = k; break; }
  let kmin = kz; for (let k = kz; k < i.length; k++) { if (i[k] < i[kmin]) kmin = k; if (i[k] > i[kmin] + 0.6) break; }
  let k2 = -1; for (let k = kmin; k < i.length; k++) if (i[k] > -0.25) { k2 = k; break; }
  return { trr: (k2 - kz) * r.dt, peak: i[kmin] };
}

test("diodes: reverse recovery in the trr test (stored charge tt·I), none from Schottky and SiC diodes", () => {
  for (const model of ["FR107", "1N4007"]) {
    const d = L.DIODES[model], m = trr(model);
    // the charge-control model: the reverse current holds at −1 A while tt·ln(1 + IF/IR) of charge drains
    assert.ok(m.peak < -0.9, `${model}: reverse current ${m.peak.toFixed(2)} A`);
    near(m.trr, d.trr || 0.45 * d.tt, 0.2, `${model} trr`);
  }
  for (const [model, d] of Object.entries(L.DIODES)) {
    if (d.kind === "schottky" || d.kind === "sic") assert.equal(d.tt, 0, `${model} stores no charge`);
    else assert.ok(d.tt > 0, `${model} has a recovery`);
    if (d.trr) near(d.tt, d.kind === "signal" ? d.trr / Math.LN2 : d.trr / 0.45, 0.01, `${model} tt from trr`);
  }
});

test("bridges: full-wave output from a floating 50 Hz source, the peak less two diode drops", () => {
  for (const [model, b] of Object.entries(L.BRIDGES)) {
    const vpk = 30, rl = 30 / (0.5 * b.i);
    const r = E.simulate(circuit([
      { id: "G", type: "siggen", params: { amp: vpk, freq: 50, rs: 0.01 }, pins: { "+": 1, "-": 2 } },
      { id: "BR", type: "bridge", params: { model }, pins: { AC1: 1, AC2: 2, "+": 3, "-": 0 } },
      { type: "electrolytic", params: { c: 1e-3 * b.i, esr: 0 }, pins: { "+": 3, "-": 0 } },
      { type: "resistor", params: { r: rl }, pins: { 1: 3, 2: 0 } }]), { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    const v = r.tran.nodes[3], top = Math.max(...v), iout = top / rl, vf = 2 * (b.n * 0.025852 * Math.log(iout * 4 / b.is) + iout * 4 * b.rs);
    // the reservoir charges to the peak less two drops (at the charging pulse's current, a few times the load's)
    assert.ok(top < vpk - 1.2 && top > vpk - vf - 1, `${model}: ${top.toFixed(2)} V from a ${vpk} V peak`);
    // both halves of the cycle: 100 Hz ripple, two dips per 20 ms
    let dips = 0; for (let k = 1; k < v.length - 1; k++) if (v[k] < v[k - 1] && v[k] <= v[k + 1] && v[k] < top - 0.3 * (top - Math.min(...v))) dips++;
    assert.ok(dips >= 2 * Math.round(v.length * r.tran.dt * 50) - 1, `${model}: ${dips} ripple dips`);
  }
});

test("zeners: each type's voltage at its test current, its dynamic resistance around it", () => {
  for (const [model, z] of Object.entries(L.ZENERS)) {
    const at = i => {
      const r = E.simulate(circuit([{ type: "isrc", params: { i }, pins: { "+": 1, "-": 0 } }, { type: "zener", params: { model }, pins: { K: 1, A: 0 } }]), { budgetMs: 10000 });
      assert.ok(r.ok, `${model}: ${r.error}`); return r.dc.nodes[1];
    };
    near(at(z.izt), z.bv, 0.005, `${model} at ${z.izt * 1000} mA`);
    near((at(z.izt * 1.1) - at(z.izt * 0.9)) / (0.2 * z.izt), z.zzt, 0.1, `${model} dynamic resistance`);
  }
});

test("SPICE: a diode's model carries its stored charge and junction capacitance", () => {
  const nl = circuit([{ id: "D", type: "diode", params: { model: "UF4007" }, pins: { A: 1, K: 0 } }]);
  const d = nl.elements.find(e => e.kind === "D");
  assert.equal(d.tt, L.DIODES.UF4007.tt);
  assert.equal(d.cj, L.DIODES.UF4007.cj);
  assert.ok(nl.elements.find(e => e.id === "D#cj").internal, "the junction capacitance goes out inside the model");
  assert.ok(!circuit([{ id: "D", type: "diode", params: { model: "1N5819" }, pins: { A: 1, K: 0 } }]).elements.find(e => e.kind === "D").tt, "a Schottky has no TT");
});

test("board: diodes and bridges in their packages, every pin on a pad, pad 1 the cathode or the maker's first pin", () => {
  const part = (type, params, pins) => ({ id: "x", type, label: "X1", params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([id, net]) => ({ id, net })) });
  const want = { "DO-35": "DIODE-7.62", "DO-41": "DIODE-10.16", "DO-201AD": "DO-201AD", "TO-220-2": "TO-220-KA" };
  for (const [model, d] of Object.entries(L.DIODES)) {
    const g = B.physicalParts({ parts: [part("diode", { model }, { A: 1, K: 2 })] })[0];
    assert.equal(g.defaultFp, want[d.pkg], model);
    for (const name of g.options) {
      const map = B.padMap(g, B.footprint(name, ["A", "K"]));
      assert.equal(map.size, 2, `${model} ${name}`);
      if (!/^WIRE/.test(name)) assert.equal(map.get("1")[0].pin, "K", `${model} ${name}: pad 1 is the cathode`);
    }
  }
  const bw = { "DIP-4": "BRIDGE-DIP4", "SIL-4": "BRIDGE-SIL4", KBPC: "WIRE-4" };
  for (const [model, b] of Object.entries(L.BRIDGES)) {
    const g = B.physicalParts({ parts: [part("bridge", { model }, { AC1: 1, AC2: 2, "+": 3, "-": 4 })] })[0];
    assert.equal(g.defaultFp, bw[b.pkg], model);
    const map = B.padMap(g, B.footprint(g.defaultFp, ["AC1", "+", "AC2", "-"]));
    assert.equal(map.size, 4, model);
    if (b.pkg !== "KBPC") b.order.forEach((pin, k) => assert.equal(map.get(String(k + 1))[0].pin, pin, `${model} pad ${k + 1}`));
  }
  // the TO-220-2's leads are 5.08 mm apart, where a three-lead package has pins 1 and 3
  const to = B.footprint("TO-220-KA");
  near(to.pads[1].x - to.pads[0].x, 5.08, 1e-9, "TO-220-2 lead spacing");
});
