/**
 * Relays (sim-engine.js RELAY, cad-components.js relay), vactrols (LDR, vactrol), on–off and rotary
 * switches, and the instrument sources: a guitar pickup and a phono cartridge playing a record cut
 * with the RIAA curve. Timing against ngspice (a voltage-controlled switch on the coil's resistance:
 * 6.00 ms to pull in, 9.97 ms to drop out across a freewheel diode), the RIAA cut against the IEC
 * curve, and their board footprints (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-3d.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, B = globalThis.BoardCore;
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
// a relay's coil on node 1; its COM on a 5 V supply (2), NC (3) and NO (4) loaded by 1 kΩ each
const relayRig = (model, coil, extra) => [{ id: "K", type: "relay", params: { model, v: coil }, pins: { A1: 1, A2: 0, 11: 2, 12: 3, 14: 4 } }, vdc(5, 2), R(1e3, 3, 0), R(1e3, 4, 0)].concat(extra || []);

test("relays: pulled in from the must-operate voltage up, at rest below it; the contacts follow", () => {
  for (const [model, m] of Object.entries(L.RELAYS)) for (const coil of ["5", "12", "24"]) {
    const v = +coil;
    for (const [vc, want] of [[v, 1], [0.8 * v, 1], [0.7 * v, 0], [0.2 * v, 0]]) {
      const r = E.simulate(circuit(relayRig(model, coil, [vdc(vc, 1)])), { budgetMs: 5000 });
      assert.ok(r.ok, `${model} ${coil} V: ${r.error}`);
      assert.equal(r.dc.devices.K.main.q, want, `${model} ${coil} V coil at ${vc} V`);
      near(r.dc.nodes[want ? 4 : 3], 5 * 1e3 / (1e3 + m.ron), 1e-6, `${model}: the closed contact`);
      assert.ok(r.dc.nodes[want ? 3 : 4] < 1e-5, `${model}: the open contact`);
    }
    // the coil's resistance: its rated power at its rated voltage
    const r = E.simulate(circuit(relayRig(model, coil, [vdc(v, 1)])), { budgetMs: 5000 });
    near(-r.dc.devices[`p${4}`].main.i * v, m.pw, 1e-5, `${model} ${coil} V: coil power`);
  }
});

test("relays: the coil's inductance delays pull-in to 60 % of the operate time; a freewheel diode slows the release (as ngspice)", () => {
  const gen = { id: "G", type: "siggen", params: { wave: "square", freq: 10, amp: 6, offset: 6, rs: 0.001 }, pins: { "+": 1, "-": 0 } };
  const diode = { type: "diode", params: {}, pins: { A: 0, K: 1 } };
  const r = E.simulate(circuit(relayRig("G5LE-1", "12", [gen, diode])), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  const g = r.tran.nodes[1], no = r.tran.nodes[4], dt = r.tran.dt;
  let rise = -1, close = -1, fall = -1, open = -1;
  for (let i = 1; i < g.length; i++) {
    if (rise < 0 && g[i - 1] < 6 && g[i] >= 6) rise = i;
    if (rise >= 0 && close < 0 && no[i] > 2.5) close = i;
    if (close >= 0 && fall < 0 && g[i - 1] > 6 && g[i] <= 6) fall = i;
    if (fall >= 0 && open < 0 && no[i] < 2.5) open = i;
  }
  assert.ok(rise >= 0 && close > rise && fall > close && open > fall, "it pulls in and drops out");
  // ngspice, the coil's R and L with a voltage-controlled switch (VT 5.1 V, VH 3.9 V) on its resistance
  assert.ok(Math.abs((close - rise) * dt - 6.0e-3) <= dt, `pull-in ${(close - rise) * dt * 1e3} ms (ngspice 6.00 ms)`);
  assert.ok(Math.abs((open - fall) * dt - 9.97e-3) <= dt, `drop-out ${(open - fall) * dt * 1e3} ms (ngspice 9.97 ms)`);
});

test("vactrols: the cell's resistance at 1 mA and 10 mA in the LED, dark without; it brightens in ton and dims to 100 kΩ in toff", () => {
  for (const [model, m] of Object.entries(L.VACTROLS)) {
    for (const [i, want] of [[1e-3, m.r1], [10e-3, m.r10]]) {
      // the LED from a 10 V supply through a resistor for about i; the cell's resistance read at the current found
      const r = E.simulate(circuit([vdc(10, 1), R((10 - 1.85) / i, 1, 2), { id: "U", type: "vactrol", params: { model }, pins: { A: 2, K: 0, 1: 3, 2: 0 } }, vdc(1, 4), R(1e3, 4, 3)]), { budgetMs: 5000 });
      assert.ok(r.ok, `${model}: ${r.error}`);
      const d = r.dc.devices.U.main, at = want * Math.pow(d.light / i, -Math.log10(m.r1 / m.r10));
      near(d.r, at, 0.01, `${model} at ${i * 1000} mA`);
      near(d.light, i, 0.05, `${model}: the LED's current`);
    }
    const dark = E.simulate(circuit([{ id: "U", type: "vactrol", params: { model }, pins: { A: 0, K: 0, 1: 3, 2: 0 } }, vdc(1, 4), R(1e3, 4, 3)]), { budgetMs: 5000 });
    near(dark.dc.devices.U.main.r, m.rdark, 1e-6, `${model}: dark`);
    // a 2 Hz square into the LED (10 mA on); the cell in a divider with 10 Ω from 1 V
    const gen = { id: "G", type: "siggen", params: { wave: "square", freq: 2, amp: 5, offset: 5, rs: 0.001 }, pins: { "+": 1, "-": 0 } };
    const r = E.simulate(circuit([gen, R((10 - 1.85) / 0.01, 1, 2), { id: "U", type: "vactrol", params: { model }, pins: { A: 2, K: 0, 1: 3, 2: 0 } }, vdc(1, 4), R(10, 4, 3)]), { budgetMs: 20000 });
    assert.ok(r.ok, `${model}: ${r.error}`);
    const v = r.tran.nodes[3], g = r.tran.nodes[1], dt = r.tran.dt, Rc = v.map(x => 10 * x / (1 - x));
    let rise = -1, fall = -1; for (let k = 1; k < g.length; k++) { if (rise < 0 && g[k - 1] < 5 && g[k] >= 5) rise = k; if (rise >= 0 && fall < 0 && g[k - 1] > 5 && g[k] <= 5) fall = k; }
    let t63 = -1; for (let k = rise; k < fall; k++) if (Rc[fall - 1] / Rc[k] >= 0.63) { t63 = (k - rise) * dt; break; }
    let t100 = -1; for (let k = fall; k < Rc.length; k++) if (Rc[k] >= 1e5) { t100 = (k - fall) * dt; break; }
    assert.ok(t63 >= 0 && t63 <= m.ton + dt, `${model}: brightens in ${t63 * 1e3} ms (${m.ton * 1e3} ms)`);
    assert.ok(Math.abs(t100 - m.toff) <= dt, `${model}: dims to 100 kΩ in ${t100 * 1e3} ms (${m.toff * 1e3} ms)`);
  }
});

test("switches: a toggle and the push buttons make and break as set; a rotary selector joins its common to one way only", () => {
  for (const [kind, pos, shut] of [["toggle", "on", true], ["toggle", "off", false], ["no", "on", true], ["no", "off", false], ["nc", "on", false], ["nc", "off", true]]) {
    const r = E.simulate(circuit([vdc(10, 1), { type: "spst", params: { kind, pos }, pins: { 1: 1, 2: 2 } }, R(1e3, 2, 0)]), { budgetMs: 5000 });
    assert.ok(shut ? r.dc.nodes[2] > 9.99 : r.dc.nodes[2] < 1e-5, `${kind} ${pos}`);
  }
  for (const ways of [2, 6, 12]) for (const pos of [1, ways]) {
    const pins = { C: 1 }, parts = [vdc(10, 1)];
    for (let k = 1; k <= ways; k++) { pins[k] = k + 1; parts.push(R(1e3, k + 1, 0)); }
    parts.push({ type: "rotary", params: { ways: String(ways), pos: String(pos) }, pins });
    const r = E.simulate(circuit(parts), { budgetMs: 5000 });
    for (let k = 1; k <= ways; k++) assert.ok(k === pos ? r.dc.nodes[k + 1] > 9.99 : r.dc.nodes[k + 1] < 1e-5, `${ways} ways at ${pos}: way ${k}`);
  }
});

test("phono cartridge: a record's RIAA cut (IEC 60098, 0 dB at 1 kHz, −19.3 dB at 20 Hz) in the AC sweep and in the transient", () => {
  near(20 * Math.log10(L.riaaRec(20)), -19.27, 0.002, "RIAA at 20 Hz");
  near(20 * Math.log10(L.riaaRec(100)), -13.09, 0.002, "RIAA at 100 Hz");
  const nl = circuit([{ id: "P", type: "phono", params: { cable: "0", r: 1e-3, l: 1e-9 }, pins: { "+": 1, "-": 0 } }, R(1e9, 1, 0)]);
  const a = E.acSweep(nl, { inputs: [{ id: "P" }], fStart: 10, fStop: 100e3, perDecade: 10 });
  a.freqs.forEach((f, k) => near(Math.hypot(a.re[1][k], a.im[1][k]), L.riaaRec(f), 1e-6, `cut at ${f} Hz`));
  for (const f of [100, 1000, 10000]) {
    const r = E.simulate(circuit([{ id: "P", type: "phono", params: { cable: "0", freq: f }, pins: { "+": 1, "-": 0 } }, R(47e3, 1, 0)]), { budgetMs: 10000 });
    const w = r.tran.nodes[1], m = w.reduce((s, v) => s + v, 0) / w.length, rms = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / w.length);
    // the cartridge's own 1 kΩ and 0.5 H against the 47 kΩ load
    const w0 = 2 * Math.PI * f, load = 47e3 / Math.hypot(47e3 + 1e3, w0 * 0.5);
    near(rms, 5e-3 * L.riaaRec(f) * load, 0.01, `5 mV cartridge at ${f} Hz into 47 kΩ`);
  }
  // flat: the level as set at any frequency
  const flat = E.acSweep(circuit([{ id: "P", type: "phono", params: { cable: "0", record: "flat", r: 1e-3, l: 1e-9 }, pins: { "+": 1, "-": 0 } }, R(1e9, 1, 0)]), { inputs: [{ id: "P" }], fStart: 20, fStop: 20e3, perDecade: 5 });
  flat.freqs.forEach((f, k) => near(Math.hypot(flat.re[1][k], flat.im[1][k]), 1, 1e-6, `flat at ${f} Hz`));
});

test("guitar pickup: its resonance with the cable into a 1 MΩ input, at 1/(2π√(L·C))", () => {
  for (const p of L.PICKUPS) {
    const nl = circuit([{ id: "G", type: "pickup", params: { r: p.r, l: p.l, c: p.c, amp: p.amp, cable: "300e-12" }, pins: { "+": 1, "-": 0 } }, R(1e6, 1, 0)]);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(p.l * (p.c + 300e-12))), a = E.acSweep(nl, { inputs: [{ id: "G" }], fStart: f0 / 2, fStop: f0 * 2, perDecade: 400 });
    let best = 0; a.freqs.forEach((f, k) => { if (Math.hypot(a.re[1][k], a.im[1][k]) > Math.hypot(a.re[1][best], a.im[1][best])) best = k; });
    near(a.freqs[best], f0, 0.03, `${p.name}: peak`);
    assert.ok(Math.hypot(a.re[1][best], a.im[1][best]) > 1.5, `${p.name}: a resonant peak`);
  }
});

test("footprints: the relays' pads by their datasheet numbers, the vactrol's and the push button's", () => {
  const g5le = B.footprint("RELAY-G5LE-1"), g5v = B.footprint("RELAY-G5V-2"), vtl = B.footprint("VTL5C"), sw = B.footprint("SW-PUSH-6MM");
  const by = f => Object.fromEntries(f.pads.map(p => [p.num, p.name]));
  assert.deepEqual(by(g5le), { 1: "11", 2: "A1", 3: "14", 4: "12", 5: "A2" });
  assert.deepEqual(by(g5v), { 1: "A1", 4: "11", 6: "12", 8: "14", 9: "24", 11: "22", 13: "21", 16: "A2" });
  assert.deepEqual(by(vtl), { 1: "K", 2: "A", 3: "1", 4: "2" });
  assert.deepEqual(sw.pads.map(p => p.name), ["1", "1", "2", "2"]);
  const parts = B.physicalParts({ parts: [{ id: "k", type: "relay", label: "K1", params: { model: "G5V-2", v: "12" }, pins: L.LIB.relay.pins({ params: { model: "G5V-2" } }).map((p, i) => ({ id: p.id, net: i + 1 })) },
    { id: "g", type: "pickup", label: "BM1", params: L.LIB.pickup.defaults, pins: [{ id: "+", net: 1 }, { id: "-", net: 0 }] }] });
  assert.equal(parts.length, 1, "the pickup stands for the guitar: no part on the board");
  assert.equal(parts[0].options[0], "RELAY-G5V-2");
});
