/**
 * JFETs, voltage regulators and the TL431 (sim-engine.js Semi.mos / Semi.reg / Semi.shunt, built
 * by cad-components.js): each type against the law it follows, its formula and its datasheet's
 * limits; their board footprints put every pin on a pad (node --test).
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
const max = a => a.reduce((m, v) => Math.max(m, v), -Infinity), min = a => a.reduce((m, v) => Math.min(m, v), Infinity);

// a circuit from CAD parts: [{ type, params, pins: { pin: node } }]
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
const R = (r, a, b) => ({ type: "resistor", params: { r }, pins: { 1: a, 2: b } });
const V = (v, a) => ({ type: "vdc", params: { v }, pins: { "+": a, "-": 0 } });
const C = (c, a, b) => ({ type: "capacitor", params: { c }, pins: { 1: a, 2: b } });
const run = (parts, msg) => { const r = E.simulate(circuit(parts), { budgetMs: 20000 }); assert.ok(r.ok, `${msg}: ${r.error}`); return r; };
const jfet = (model, pins) => ({ id: "J", type: L.JFETS[model].pol > 0 ? "njf" : "pjf", params: { model }, pins });

test("JFETs: IDSS at Vgs = 0 and the self-bias point follow the square law, Id = β·(Vgs − Vp)² (β·(2·Vov·Vds − Vds²) below saturation)", () => {
  for (const [model, m] of Object.entries(L.JFETS)) {
    const p = m.pol, idss = m.beta * m.vto * m.vto;
    // 10 V across, gate on the source: IDSS (with λ) through a 1 Ω sense resistor
    let r = run([V(10 * p, 1), R(1, 1, 2), jfet(model, { D: 2, G: 0, S: 0 })], model);
    near(Math.abs(r.dc.nodes[1] - r.dc.nodes[2]), idss * (1 + m.lambda * 10), 2e-3, `${model} IDSS`);
    // self-bias with 220 Ω in the source: Vs = Id·Rs, and Id on the square law at Vgs = −Vs
    r = run([V(24 * p, 1), R(2.2e3, 1, 2), jfet(model, { D: 2, G: 3, S: 4 }), R(1e6, 3, 0), R(220, 4, 0)], model);
    const vs = Math.abs(r.dc.nodes[4]), id = vs / 220, vds = Math.abs(r.dc.nodes[2]) - vs, vov = Math.abs(m.vto) - vs;
    near(id, m.beta * (vds < vov ? 2 * vov * vds - vds * vds : vov * vov) * (1 + m.lambda * vds), 2e-3, `${model} self-bias Id`);
  }
});

test("JFETs: the gate conducts once forward-biased; a common-source stage's gain is gm·Rd", () => {
  for (const model of ["J201", "2SK170", "2N5460"]) {
    const m = L.JFETS[model], p = m.pol;
    // 5 V through 10 kΩ into the gate: it clamps at a junction's drop
    const r = run([V(10 * p, 1), R(1e3, 1, 2), jfet(model, { D: 2, G: 3, S: 0 }), V(5 * p, 5), R(10e3, 5, 3)], model);
    const vg = Math.abs(r.dc.nodes[3]);
    assert.ok(vg > 0.45 && vg < 0.65, `${model} gate clamps at ${vg} V`);
  }
  for (const model of ["2SK170", "2N5457", "2SJ74"]) {
    const m = L.JFETS[model], p = m.pol;
    const parts = [V(24 * p, 1), R(2.2e3, 1, 2), jfet(model, { D: 2, G: 3, S: 4 }), R(1e6, 3, 0), R(100, 4, 0), C(1e-3, 4, 0),
      { id: "gen", type: "siggen", params: { rs: 50, amp: 1e-3, freq: 1000 }, pins: { "+": 5, "-": 0 } }, C(10e-6, 5, 3)];
    const nl = circuit(parts), r = E.simulate(nl, { budgetMs: 20000 }), id = Math.abs(r.dc.nodes[4]) / 100, vds = Math.abs(r.dc.nodes[2] - r.dc.nodes[4]);
    // gm = 2·√(β·Id·(1 + λ·Vds)); the output conductance λ·Id in parallel with Rd
    const gm = 2 * Math.sqrt(m.beta * id * (1 + m.lambda * vds)), gds = m.lambda * id / (1 + m.lambda * vds);
    const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 1000, fStop: 1000, perDecade: 1, probes: [[2, 0]] });
    near(Math.hypot(ac.probes[0].re[0], ac.probes[0].im[0]), gm / (1 / 2.2e3 + gds), 0.01, `${model} gain`);
  }
});

test("regulators: the LM317 family's Vout = 1.25 V·(1 + R2/R1) + Iadj·R2, the 78xx / 79xx their own voltage", () => {
  for (const [model, m] of Object.entries(L.REGS)) {
    const p = m.pol, vin = p * (m.adj ? 15 : m.vref + 5), load = m.pkg === "TO-92" ? 500 : 50;
    const parts = [V(vin, 1), { id: "U", type: "reg", params: { model }, pins: m.adj ? { I: 1, O: 2, A: 3 } : { I: 1, O: 2, G: 0 } }, R(load, 2, 0)];
    if (m.adj) parts.push(R(240, 2, 3), R(720, 3, 0));
    const r = run(parts, model), vo = Math.abs(r.dc.nodes[2]), io = vo / load;
    const want = m.adj ? m.vref * 4 + m.iadj * 720 : m.vref;
    // within the load regulation (Io / g) and the line regulation
    assert.ok(Math.abs(vo - want) < io / m.g * (m.adj ? 4 : 1) + 4 * m.line * 12 + 1e-3, `${model}: ${vo} V, expected ${want} V`);
    // the chip's heat: its output current (the bias current included) across IN − OUT, and the ADJ
    // current or the ground current (with the internal divider's) from the input
    const d = r.dc.devices.U.main, vi = Math.abs(vin);
    near(d.pd, (vi - vo) * d.iout + (m.adj ? (vi - Math.abs(r.dc.nodes[3])) * m.iadj : vi * (m.iq + vo / (m.vref / 1e-3))), 0.01, `${model} dissipation`);
  }
});

test("regulators: the current limit into a short, the dropout and the ripple rejection", () => {
  // short circuit: 0.1 Ω on the output carries the limit
  for (const model of ["LM317", "7805", "7912", "78L05"]) {
    const m = L.REGS[model], p = m.pol;
    const parts = [V(p * 15, 1), { id: "U", type: "reg", params: { model }, pins: m.adj ? { I: 1, O: 2, A: 3 } : { I: 1, O: 2, G: 0 } }, R(0.1, 2, 0)];
    if (m.adj) parts.push(R(240, 2, 3), R(720, 3, 0));
    const r = run(parts, model);
    near(Math.abs(r.dc.nodes[2]) / 0.1, m.ilim, 0.02, `${model} short-circuit current`);
  }
  // 7812 at 1 A from 13 V: it drops out about 2 V below its input
  let r = run([V(13, 1), { id: "U", type: "reg", params: { model: "7812" }, pins: { I: 1, O: 2, G: 0 } }, R(12, 2, 0)], "7812 dropout");
  const drop = 13 - r.dc.nodes[2];
  assert.ok(drop > 1.6 && drop < 2.3, `7812 dropout at 1 A: ${drop} V`);
  // LM317 at 5 V out from 14 V with 4 Vpp of 100 Hz ripple: about 66 dB of rejection, 78 dB with 10 µF on ADJ
  for (const [cadj, lo, hi] of [[0, 60, 72], [10e-6, 72, 84]]) {
    const parts = [{ id: "gen", type: "siggen", params: { rs: 0.1, amp: 2, freq: 100, offset: 14 }, pins: { "+": 1, "-": 0 } },
      { id: "U", type: "reg", params: { model: "LM317" }, pins: { I: 1, O: 2, A: 3 } }, R(240, 2, 3), R(720, 3, 0), R(50, 2, 0), C(10e-6, 2, 0)];
    if (cadj) parts.push(C(cadj, 3, 0));
    r = run(parts, "LM317 ripple");
    const v = r.tran.nodes[2], db = 20 * Math.log10(4 / (max(v) - min(v)));
    assert.ok(db > lo && db < hi, `LM317 ripple rejection ${cadj ? "with" : "without"} the ADJ capacitor: ${db.toFixed(1)} dB`);
  }
  // below the minimum load an LM317's output rises: no divider current at all, 10 MΩ of load
  r = run([V(20, 1), { id: "U", type: "reg", params: { model: "LM317" }, pins: { I: 1, O: 2, A: 0 } }, R(10e6, 2, 0)], "LM317 no load");
  assert.ok(r.dc.nodes[2] > 5, `LM317 with no load: ${r.dc.nodes[2]} V`);
});

test("TL431: 2.495 V with REF on the cathode; Vka = 2.495 V·(1 + R1/R2) + Iref·R1", () => {
  const m = L.SHUNTS.TL431;
  let r = run([V(12, 1), R(470, 1, 2), { id: "U", type: "tl431", params: {}, pins: { K: 2, A: 0, R: 2 } }], "TL431 zener");
  const ik = (12 - r.dc.nodes[2]) / 470;
  near(r.dc.nodes[2], m.vref + ik / m.gm, 1e-3, "TL431 as a 2.5 V zener");
  for (const [r1, r2] of [[30e3, 10e3], [10e3, 10e3], [100e3, 33e3]]) {
    r = run([V(30, 1), R(1e3, 1, 2), { id: "U", type: "tl431", params: {}, pins: { K: 2, A: 0, R: 3 } }, R(r1, 2, 3), R(r2, 3, 0)], "TL431");
    // REF sits above 2.495 V by the cathode current over gm
    const vr = m.vref + r.dc.devices.U.main.ik / m.gm;
    near(r.dc.nodes[2], vr * (1 + r1 / r2) + vr / m.rref * r1, 1e-3, `TL431 R1 ${r1} R2 ${r2}`);
  }
});

test("SPICE export: the regulator and TL431 subcircuits carry each term", () => {
  const reg = E.Spice.reg(L.regModel(L.REGS.LM317), "REG_LM317").join("\n"), shunt = E.Spice.shunt(L.SHUNTS.TL431, "SHUNT_TL431").join("\n");
  assert.match(reg, /^\.subckt REG_LM317 IN OUT REF/);
  assert.match(reg, /BP IN OUT I=V\(IP\)\+0\.0035\*V\(ON\)/);
  assert.match(reg, /BA IN REF I=(5e-05|0\.00005)\*V\(ON\)/);
  assert.doesNotMatch(E.Spice.reg(L.regModel(L.REGS.LM337), "R").join("\n"), /--|\*-/);
  assert.match(E.Spice.reg(L.regModel(L.REGS["7905"]), "R").join("\n"), /BP IN OUT I=-\(V\(IP\)\)/);
  assert.match(shunt, /^\.subckt SHUNT_TL431 K A REF/);
  assert.match(shunt, /RREF REF A 1250000/);
});

test("board: every JFET, regulator and TL431 pin lands on a pad of each footprint", () => {
  const part = (type, params, pins) => ({ id: "x", type, label: "X1", params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([id, net]) => ({ id, net })) });
  const cases = [...Object.entries(L.JFETS).map(([k, m]) => [m.pol > 0 ? "njf" : "pjf", k, { D: 1, G: 2, S: 3 }]),
    ...Object.entries(L.REGS).map(([k, m]) => ["reg", k, m.adj ? { I: 1, O: 2, A: 3 } : { I: 1, O: 2, G: 3 }]), ["tl431", "TL431", { K: 1, A: 2, R: 3 }]];
  for (const [type, model, pins] of cases) {
    const g = B.physicalParts({ parts: [part(type, { model }, pins)] })[0];
    assert.ok(g.smdFp, `${model} has an SMD version`);
    for (const name of g.options) {
      const map = B.padMap(g, B.footprint(name, ["a", "b", "c"])), on = new Set([...map.values()].flat().map(q => q.pin));
      Object.keys(pins).forEach(pin => assert.ok(on.has(pin), `${model} ${name}: pin ${pin} has no pad`));
    }
  }
  // the maker's pin order: an LM317's pad 1 is ADJ, a 7805's IN, a 7905's GND, a TL431's REF
  const pad1 = (type, model, pins) => { const g = B.physicalParts({ parts: [part(type, { model }, pins)] })[0]; return B.padMap(g, B.footprint(g.defaultFp)).get("1")[0].pin; };
  assert.equal(pad1("reg", "LM317", { I: 1, O: 2, A: 3 }), "A");
  assert.equal(pad1("reg", "7805", { I: 1, O: 2, G: 3 }), "I");
  assert.equal(pad1("reg", "7905", { I: 1, O: 2, G: 3 }), "G");
  assert.equal(pad1("tl431", "TL431", { K: 1, A: 2, R: 3 }), "R");
  assert.equal(pad1("njf", "J201", { D: 1, G: 2, S: 3 }), "D");
});
