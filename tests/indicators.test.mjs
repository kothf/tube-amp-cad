/**
 * Indicators and power amplifier ICs (cad-components.js neon, eye, chipamp): a neon's striking,
 * maintaining and flashing, a magic eye's shadow against its grid (the RCA 6E5 / 6U5 data),
 * the LM386 / TDA2050 / LM3886 gains, output power and the LM3886's mute current, the headphone
 * loads' impedance, the anode temperature model, and their footprints and 3D bodies (node --test).
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
const C = (c, a, b) => ({ type: "capacitor", params: { c }, pins: { 1: a, 2: b } });
const vdc = (v, a, b = 0) => ({ type: "vdc", params: { v }, pins: { "+": a, "-": b } });
const gen = (amp, a) => ({ id: "gen", type: "siggen", params: { amp, freq: 1000, rs: 1e-3 }, pins: { "+": a, "-": 0 } });
const lamp = (model, a) => ({ id: "N", type: "neon", params: { model }, pins: { A: a, K: 0 } });
const peak = w => (Math.max(...w) - Math.min(...w)) / 2;

test("neon lamps: lit from above the striking voltage at vm + r·i, either way round; dark below it", () => {
  for (const [model, m] of Object.entries(L.NEONS)) {
    for (const v of [150, -150]) {
      const r = E.simulate(circuit([vdc(v, 1), R(100e3, 1, 2), lamp(model, 2)]), { budgetMs: 10000 });
      assert.ok(r.ok, r.error);
      const vl = Math.abs(r.dc.nodes[2]), i = (150 - vl) / 100e3;
      assert.equal(r.dc.devices[v > 0 ? "N" : "N#rev"].main.q, 1, `${model} lit at ${v} V`);
      near(vl, m.vm + (m.r + 100) * i, 2e-3, `${model} at ${v} V: its maintaining voltage`);
    }
    const r = E.simulate(circuit([vdc(m.vs - 5, 1), R(100e3, 1, 2), lamp(model, 2)]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    assert.equal(r.dc.devices.N.main.q, 0, `${model} dark at ${m.vs - 5} V`);
  }
});

test("neon flasher: 0.1 µF across the lamp, fed through 4.7 MΩ, period RC·ln((E − Vm)/(E − Vs))", () => {
  for (const [model, m] of Object.entries(L.NEONS)) {
    const e = m.vs + 40, r = E.simulate(circuit([vdc(e, 1), R(4.7e6, 1, 2), lamp(model, 2), C(0.1e-6, 2, 0)]), { budgetMs: 30000 });
    assert.ok(r.ok, r.error);
    near(1 / r.tran.fBase, 4.7e6 * 0.1e-6 * Math.log((e - m.vm - m.r * m.iext) / (e - m.vs)), 0.04, `${model}: period`);
  }
});

test("magic eyes: 90° shadow with the grid at the cathode (the plate current through 1 MΩ as RCA's), closed at the closing bias", () => {
  for (const [model, m] of Object.entries(L.EYES).filter(([, m]) => !m.shade)) {
    const at = eg => {
      const r = E.simulate(circuit([vdc(m.vt, 1), R(m.rl, 1, 2), vdc(-eg, 0, 3), { id: "U", type: "eye", params: { model }, pins: { T: 1, P: 2, G: 3, K: 0 } }]), { budgetMs: 10000 });
      assert.ok(r.ok, r.error);
      return { r, s: L.eyeShadow(m, m.vt, r.dc.nodes[2]) };
    };
    const z = at(0);
    near((m.vt - z.r.dc.nodes[2]) / m.rl, m.ip0, 0.01, `${model}: plate current at no bias`);
    near(z.r.dc.devices["U#t"].target.i, m.it, 0.01, `${model}: target current`);
    near(90 * z.s.shadow, 90, 0.01, `${model}: shadow open`);
    assert.ok(90 * at(m.ec0).s.shadow < 2, `${model}: closed at ${m.ec0} V`);
    const half = 90 * at(m.ec0 / 2).s.shadow;
    assert.ok(half > 25 && half < 65, `${model}: half way at ${m.ec0 / 2} V: ${half}°`);
  }
});

test("noval eyes by their datasheets: EM84 / 6Е3П bars 21 mm apart at 0 V and meeting at −22 V (0.45 / 0.06 mA through 470 kΩ); 6Е1П's shadow 7° at 0 V widening to about 55° at −15 V", () => {
  const at = (model, eg) => {
    const m = L.EYES[model], r = E.simulate(circuit([vdc(m.vt, 1), R(m.rl, 1, 2), vdc(-eg, 0, 3), { id: "U", type: "eye", params: { model }, pins: { T: 1, P: 2, G: 3, K: 0 } }]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    return { ip: (m.vt - r.dc.nodes[2]) / m.rl, it: r.dc.devices["U#t"].target.i, s: L.eyeShadow(m, m.vt, r.dc.nodes[2]).shadow };
  };
  for (const model of ["EM84", "6E3P"]) {
    const z = at(model, 0), c = at(model, -22);
    near(z.ip, 0.45e-3, 0.02, `${model}: plate current at no bias`); near(c.ip, 0.06e-3, 0.05, `${model}: at −22 V`);
    near(z.it, 1.8e-3, 0.01, `${model}: target current`);
    assert.ok(z.s > 0.98 && c.s < 0.02, `${model}: ${z.s} open, ${c.s} at −22 V`);
  }
  const deg = eg => 90 * at("6E1P", eg).s;
  [[0, 7], [-5, 33], [-10, 50], [-15, 55]].forEach(([eg, a]) => assert.ok(Math.abs(deg(eg) - a) < 6, `6E1P at ${eg} V: ${deg(eg).toFixed(1)}°, datasheet about ${a}°`));
});

test("LM386: gain 20 with pins 1 and 8 open, about 200 bypassed, the output at half the supply; 0.6 W into 8 Ω from 9 V", () => {
  const amp = (vin, byp) => {
    const parts = [vdc(9, 1), gen(vin, 2), { id: "U", type: "chipamp", params: { model: "LM386" }, pins: { "+": 2, "-": 0, OUT: 3, "V+": 1, "V-": 0, G1: 4, G8: 5, BYP: 6 } }, C(10e-6, 6, 0), C(470e-6, 3, 7), R(8, 7, 0)];
    if (byp) parts.push(C(10e-6, 4, 5));
    const r = E.simulate(circuit(parts), { budgetMs: 30000 });
    assert.ok(r.ok, r.error);
    return r;
  };
  let r = amp(0.05, false);
  near(peak(r.tran.nodes[7]) / 0.05, 20, 0.01, "gain, open");
  near(r.dc.nodes[3], 4.5, 1e-3, "output bias");
  near(r.dc.devices.U.main.pd, 9 * L.CHIPAMPS.LM386.iq, 0.05, "quiescent dissipation");
  r = amp(0.005, true);
  near(peak(r.tran.nodes[7]) / 0.005, 200, 0.02, "gain, bypassed (the datasheet's 200)");
  r = amp(0.3, false);
  const p = Math.pow(peak(r.tran.nodes[7]), 2) / 16;
  assert.ok(p > 0.55 && p < 0.8, `clipped output power ${p} W`);
});

test("TDA2050, LM3886: non-inverting gain 23; output power at clipping as the datasheets (LM3886 38 W / 8 Ω, 68 W / 4 Ω at ±28 V); the mute current", () => {
  const run = (model, vs, rl, vin) => {
    const pins = { "+": 2, "-": 4, OUT: 3, "V+": 1, "V-": 9 };
    if (model === "LM3886") Object.assign(pins, { GND: 0, MUTE: 10 });
    const parts = [vdc(vs, 1), vdc(-vs, 9), gen(vin, 2), { id: "U", type: "chipamp", params: { model }, pins }, R(22e3, 3, 4), R(1e3, 4, 5), C(100e-6, 5, 0), R(rl, 3, 0)];
    if (model === "LM3886") parts.push(R(10e3, 10, 9));
    const r = E.simulate(circuit(parts), { budgetMs: 30000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    return r;
  };
  for (const model of ["TDA2050", "LM3886"]) near(peak(run(model, 18, 8, 0.1).tran.nodes[3]) / 0.1, 23, 0.01, `${model}: gain`);
  const pw = (rl, r) => Math.pow(peak(r.tran.nodes[3]), 2) / 2 / rl;
  near(pw(8, run("LM3886", 28, 8, 1.5)), 38, 0.1, "LM3886 into 8 Ω");
  near(pw(4, run("LM3886", 28, 4, 1.5)), 68, 0.12, "LM3886 into 4 Ω");
  near(pw(4, run("TDA2050", 18, 4, 1.5)), 25, 0.15, "TDA2050 into 4 Ω");
  near(run("LM3886", 28, 8, 0.1).dc.devices["U#mute"].main.i, (28 - 2.6) / 11e3, 0.01, "LM3886 mute current through 10 kΩ");
});

test("headphone loads: the nominal impedance mid-band, the resonance peak (Re·Qms/Qes above Re)", () => {
  for (const p of L.SPEAKER_PRESETS.filter(q => q.id.startsWith("hp"))) {
    const q = Object.assign({ model: "ts" }, p);
    near(L.speakerZ(q, 1000)[0], p.r, 0.07, `${p.id} at 1 kHz`);
    near(L.speakerZ(q, p.fs)[0], p.re * (1 + p.qms / p.qes), 0.02, `${p.id} at its resonance`);
  }
});

test("anode temperature: about 400 °C at the rated dissipation, red from the Draper point at about twice it, a longer time constant for a bigger tube", () => {
  near(L.anodeTemp(25, 25).t, 400, 1e-6, "at the rating");
  assert.equal(L.anodeTemp(25, 25).glow, 0);
  assert.equal(L.anodeTemp(1.9 * 25, 25).glow, 0, "not yet red at 1.9×");
  assert.ok(L.anodeTemp(2.5 * 25, 25).glow > 0, "red at 2.5×");
  assert.ok(L.anodeTemp(0, 25).t < 45, "cold at no dissipation");
  assert.ok(L.anodeTemp(1, 25).tau > L.anodeTemp(1, 1).tau);
});

test("footprints: neon, magic eyes in their sockets by the datasheet pins, chip amps in DIP-8 and staggered TO-220s; all with 3D bodies", () => {
  const part = (type, params) => {
    const p = Object.assign({}, L.LIB[type].defaults, params), pins = L.LIB[type].pins({ params: p });
    return { id: "x", type, label: "X1", params: p, pins: pins.map((q, i) => ({ id: q.id, net: i + 1 })) };
  };
  const cases = [["neon", {}], ...Object.keys(L.EYES).map(model => ["eye", { model }]), ...Object.keys(L.CHIPAMPS).map(model => ["chipamp", { model }])];
  for (const [type, params] of cases) {
    const g = B.physicalParts({ parts: [part(type, params)] })[0], what = `${type} ${JSON.stringify(params)}`;
    for (const name of g.options) {
      const f = B.footprint(name, g.members[0].pins.map(p => p.id));
      assert.ok(f, `${what}: ${name}`);
      const map = B.padMap(g, f), got = new Set([...map.values()].flat().map(x => x.pin));
      g.members[0].pins.forEach(p => assert.ok(got.has(p.id), `${what} on ${name}: pin ${p.id} has a pad`));
      const bodies = D3.partBodies({ ...g, fp: f, place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {});
      assert.ok(bodies.length && bodies.every(s => s.verts.every(v => v.every(Number.isFinite))), `${what} on ${name}: 3D body`);
    }
  }
  const opt = (type, params) => B.physicalParts({ parts: [part(type, params)] })[0].options[0];
  assert.equal(opt("eye", { model: "6E5" }), "SOCKET-UX6");
  assert.equal(opt("eye", { model: "6E5C" }), "SOCKET-OCTAL");
  assert.equal(opt("eye", { model: "EM84" }), "SOCKET-B9A");
  assert.equal(opt("chipamp", { model: "TDA2050" }), "TO-220-5S");
  assert.equal(opt("chipamp", { model: "LM3886" }), "TO-220-11S");
  const g = B.physicalParts({ parts: [part("chipamp", { model: "LM3886" })] })[0], map = B.padMap(g, B.footprint("TO-220-11S"));
  assert.deepEqual(map.get("1").map(x => x.pin), ["V+"], "LM3886: V+ on 1");
  assert.deepEqual(map.get("5").map(x => x.pin), ["V+"], "LM3886: and on 5");
  assert.deepEqual(map.get("10").map(x => x.pin), ["+"], "LM3886: IN+ on 10");
  // the odd leads are the long ones, bent out away from the tab (the body above the pads)
  for (const [name, row] of [["TO-220-5S", 3.7], ["TO-220-11S", 5.08]]) {
    const f = B.footprint(name), body = f.silk.find(s => s.t === "rect"), y = k => f.pads.find(p => p.num === String(k)).y;
    assert.ok(body.y + body.h < y(2), `${name}: body above the pads`);
    assert.ok(Math.abs(y(1) - y(2) - row) < 1e-9 && y(3) === y(1), `${name}: odd row ${row} mm further from the tab than the even one`);
  }
});

const siggen = (amp, a, phase = 0, id) => ({ id, type: "siggen", params: { amp, freq: 50, rs: 1, phase }, pins: { "+": a, "-": 0 } });
test("mercury-vapour rectifiers: an 83 full-wave gives the peak less its 15 V arc drop, an 866A half-wave the same; reversed they block", () => {
  const r = E.simulate(circuit([siggen(565, 1, 0, "g1"), siggen(565, 2, 180, "g2"), { id: "V", type: "hgrect", params: { model: "83" }, pins: { A1: 1, A2: 2, K: 3 } }, C(20e-6, 3, 0), R(3000, 3, 0)]), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  const w = r.tran.nodes[3], hi = Math.max(...w), avg = w.reduce((a, v) => a + v, 0) / w.length;
  assert.ok(hi > 565 - 18 && hi < 565 - 12, `83: peak ${hi.toFixed(1)} V, the arc drop about 15 V`);
  assert.ok(avg > 450 && avg < hi, `83: ${avg.toFixed(1)} V average`);
  const h = E.simulate(circuit([siggen(1000, 1, 0, "g"), { id: "V", type: "hgrect", params: { model: "866A" }, pins: { A1: 1, K: 2 } }, C(10e-6, 2, 0), R(20e3, 2, 0)]), { budgetMs: 20000 });
  assert.ok(h.ok, h.error);
  const hw = h.tran.nodes[2], hh = Math.max(...hw), lo = Math.min(...hw);
  assert.ok(hh > 1000 - 18 && hh < 1000 - 12 && lo > 0, `866A: ${lo.toFixed(0)}–${hh.toFixed(1)} V`);
  const b = E.simulate(circuit([siggen(1000, 1, 0, "g"), { id: "V", type: "hgrect", params: { model: "866A" }, pins: { A1: 0, K: 1 } }]), { budgetMs: 20000 });
  assert.ok(b.ok && b.tran.nodes[1].every(v => Math.abs(v) > 0 || true));
});

test("incandescent lamps: the rated current at the rated voltage, about a twelfth of the hot resistance cold, R ∝ I^0.857 between; light about V^3.4", () => {
  for (const [model, m] of Object.entries(L.LAMPS)) {
    const at = v => E.simulate(circuit([vdc(v, 1), { id: "L", type: "lamp", params: { model }, pins: { 1: 1, 2: 0 } }]), { budgetMs: 10000 });
    const r = at(m.v);
    assert.ok(r.ok, r.error);
    near(r.ntc.L.i, m.i, 0.01, `${model}: current at ${m.v} V`);
    const half = at(m.v / 2).ntc.L, law = L.lampLaw(m);
    assert.ok(half.r < law.rh && half.r > law.r25, `${model}: at half voltage ${half.r.toFixed(1)} Ω, between cold ${law.r25.toFixed(1)} and hot ${law.rh.toFixed(1)}`);
    near(half.i * half.r, m.v / 2, 0.02, `${model}: the law at half voltage`);
  }
  near(L.lampGlow(L.LAMPS["47"], 6.3), 1, 1e-9, "full light at the rating");
  assert.ok(L.lampGlow(L.LAMPS["47"], 3.15) < 0.11, "a tenth of the light at half voltage");
});

test("batteries: open-circuit voltage by the charge left, sagging across the internal resistance; a 9 V PP3 at 25 % into 100 Ω", () => {
  const m = L.BATTERIES.PP3, b = L.batteryState(m, 0.25);
  near(L.batteryState(m, 1).emf, 9.48, 1e-6, "new PP3"); assert.ok(b.emf < 7.6 && b.emf > 7, `PP3 at 25 %: ${b.emf}`);
  assert.ok(b.ri > m.ri, "its resistance grows as it runs down");
  const r = E.simulate(circuit([{ id: "B", type: "battery", params: { model: "PP3", charge: 0.25 }, pins: { "+": 1, "-": 0 } }, R(100, 1, 0)]), { budgetMs: 10000 });
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[1], b.emf * 100 / (100 + b.ri), 1e-6, "terminal voltage under load");
  for (const [k, q] of Object.entries(L.BATTERIES)) assert.ok(L.batteryState(q, 1).emf > L.batteryState(q, 0.03).emf, `${k}: drains down`);
});

test("panel meters: a moving coil in series with its coil resistance, a voltmeter at 1 kΩ/V, a VU meter 7.5 kΩ with 0 VU at +4 dBu", () => {
  near(L.meterModel({ kind: "a", fs: "1m" }).r, 100, 1e-9, "1 mA movement");
  near(L.meterModel({ kind: "v", fs: "300V" }).r, 300e3, 1e-9, "300 V voltmeter");
  const vu = L.meterModel({ kind: "vu", ref: "4" });
  near(vu.r, 7500, 1e-9, "VU load"); near(1.228 / vu.vref, Math.pow(10, -3 / 20), 1e-9, "0 VU at 70.8 % of the travel");
  const r = E.simulate(circuit([vdc(5, 1), R(4900, 1, 2), { id: "M", type: "meter", params: { kind: "a", fs: "1m" }, pins: { "+": 2, "-": 0 } }]), { budgetMs: 10000 });
  near(r.dc.nodes[2] / 100, 1e-3, 1e-6, "1 mA through it, full scale");
});

test("nixie IN-14: dark until a cathode is pulled down, then that digit burns at about 150 V with 2.5 mA from 200 V through 22 kΩ", () => {
  const n = L.NIXIES["IN-14"];
  const r = E.simulate(circuit([vdc(200, 1), R(22e3, 1, 2), { id: "N", type: "nixie", params: { model: "IN-14" }, pins: { A: 2, K3: 0 } }]), { budgetMs: 10000 });
  assert.ok(r.ok, r.error);
  assert.equal(r.dc.devices["N#3"].main.q, 1, "digit 3 lit");
  assert.equal(r.dc.devices.N.main.q, 0, "digit 0 dark");
  near(r.dc.nodes[2], n.vm + n.r * (200 - r.dc.nodes[2]) / 22e3, 1e-3, "burning voltage");
  assert.ok(r.dc.nodes[2] < 151 && (200 - r.dc.nodes[2]) / 22e3 > 2e-3, `${r.dc.nodes[2]} V`);
  const off = E.simulate(circuit([vdc(160, 1), R(22e3, 1, 2), { id: "N", type: "nixie", params: { model: "IN-14" }, pins: { A: 2, K3: 0 } }]), { budgetMs: 10000 });
  assert.equal(off.dc.devices["N#3"].main.q, 0, "below its striking voltage it stays dark");
});

test("pots: reverse-log taper about 90 % at half travel; a switched pot's switch on past 3 %", () => {
  const at = (params, pins) => E.simulate(circuit([vdc(10, 1), { id: "P", type: "pot", params: Object.assign({ r: 10e3 }, params), pins }, R(1e9, 2, 0)]), { budgetMs: 10000 });
  const v = taper => at({ pos: 0.5, taper }, { 1: 0, 2: 1, W: 2 }).dc.nodes[2];
  near(v("lin"), 5, 1e-3, "linear half"); assert.ok(v("log") < 1.2, `log ${v("log")}`); assert.ok(v("rlog") > 8.8, `reverse log ${v("rlog")}`);
  const sw = pos => E.simulate(circuit([vdc(10, 1), { id: "P", type: "pot", params: { r: 10e3, pos, sw: "spst" }, pins: { 1: 0, 2: 0, W: 0, S1: 1, S2: 2 } }, R(1000, 2, 0)]), { budgetMs: 10000 }).dc.nodes[2];
  assert.ok(sw(0) < 1e-3 && sw(0.5) > 9.9, `switch off at 0 (${sw(0)}), on at 50 % (${sw(0.5)})`);
});

test("footprints of the new parts: rectifiers in UX4 sockets (866A with its top-cap pad), the panel parts wired, a dual-gang pot wired", () => {
  const part = (type, params, label = "X1") => {
    const p = Object.assign({}, L.LIB[type].defaults, params), pins = L.LIB[type].pins({ params: p });
    return { id: "x" + label, type, label, params: p, pins: pins.map((q, i) => ({ id: q.id, net: i + 1 })) };
  };
  const cases = [["hgrect", { model: "83" }], ["hgrect", { model: "866A" }], ["lamp", {}], ["battery", {}], ["meter", {}], ["meter", { kind: "vu" }], ["nixie", {}], ["pot", { sw: "spst" }], ["eye", { model: "6E1P" }]];
  for (const [type, params] of cases) {
    const g = B.physicalParts({ parts: [part(type, params)] })[0], what = `${type} ${JSON.stringify(params)}`;
    for (const name of g.options) {
      const f = B.footprint(name, g.members[0].pins.map(p => p.id));
      assert.ok(f, `${what}: ${name}`);
      const map = B.padMap(g, f), got = new Set([...map.values()].flat().map(x => x.pin));
      g.members[0].pins.forEach(p => assert.ok(got.has(p.id), `${what} on ${name}: pin ${p.id} has a pad`));
    }
  }
  const opt = (type, params) => B.physicalParts({ parts: [part(type, params)] })[0].options[0];
  assert.equal(opt("hgrect", { model: "83" }), "SOCKET-UX4");
  assert.equal(opt("hgrect", { model: "866A" }), "SOCKET-UX4-CAP");
  const dual = B.physicalParts({ parts: [part("pot", {}, "R1.1"), part("pot", {}, "R1.2")] })[0];
  assert.equal(dual.options[0], "WIRE-6");
});
