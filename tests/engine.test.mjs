/**
 * Circuit engine accuracy tests (node --test).
 * Every case is checked against an independent result: closed-form circuit
 * theory, a separate bisection solve of the Koren equation, an RK4
 * integration of the same circuit written as plain ODEs, or published
 * datasheet operating points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { datasheetFor } from "./datasheets.mjs";

// The engine and tube database are browser scripts that attach to globalThis
for (const f of ["tube-db.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine;
const tube = name => globalThis.TUBE_DATABASE.find(t => t.commonName === name);

const pp = a => Math.max(...a) - Math.min(...a);
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected), `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);

test("tube database: 99 tubes, every amplifier tube has Koren parameters", () => {
  const db = globalThis.TUBE_DATABASE;
  assert.equal(db.length, 99);
  for (const t of db) {
    if (t.category === "rectifier") assert.ok(E.RECTIFIER_PERVEANCE[t.commonName], `${t.commonName}: rectifier perveance`);
    else for (const k of ["mu", "kg", "kp", "kvb", "x"]) assert.ok(t.koren.Triode[k] > 0, `${t.commonName}: Triode.${k}`);
  }
});

test("tube database: every handbook tube has its book pinout with heater, anode and cathode", () => {
  for (const t of globalThis.TUBE_DATABASE.filter(t => t.book)) {
    const pins = t.pinout.map(p => p.pin), name = `${t.book.name} (p. ${t.book.page})`;
    assert.equal(new Set(pins).size, pins.length, `${name}: a pin listed twice`);
    assert.ok(pins.every(p => Number.isInteger(p) && p >= 1 && p <= t.pinCount), `${name}: pin outside 1…${t.pinCount}`);
    assert.ok(t.pinout.filter(p => p.isHeater).length >= 2, `${name}: heater pins`);
    assert.ok(t.pinout.some(p => p.isPlate) || /top cap/.test(t.socket), `${name}: anode pin`);
    assert.ok(t.pinout.some(p => p.isCathode) || t.pinout.some(p => p.role === "Filament") || /cathode is joined/.test(t.heaterWarning), `${name}: cathode pin`);
  }
});

test("schematic tube symbols: pin numbers of the section, from the handbook pinout", () => {
  runInThisContext(readFileSync(new URL("../cad-components.js", import.meta.url), "utf8"), { filename: "cad-components.js" });
  const pins = (t, label, connection) => globalThis.CadLib.LIB.tube.pinNumbers({ params: { tube: t, connection }, label });
  assert.deepEqual([pins("6N23P-EV", "VL2.1"), pins("6N23P-EV", "VL2.2")].map(p => [p.A, p.G, p.K, p.H]), [["6", "7", "8", "4,5"], ["1", "2", "3", "4,5"]]);
  assert.deepEqual(pins("6F3P-P", "VL1.2", "pentode"), { A: "6", G: "3", G1: "3", G2: "7", K: "2", H: "4,5" });   // K&L p. 355
  assert.equal(pins("6F3P-T", "VL1.1").A, "9");
  assert.deepEqual(pins("5Ts4S", "VL1"), { A1: "6", A2: "4", K: "8", H: "2,8" });                                    // filament is the cathode
  assert.equal(pins("6P36S").A, "cap");
  assert.equal(pins("6R5P", "VL1.2", "pentode").G1, "6");
});

// Katsnelson & Larionov 1981 rectifier test circuits: Ua rms per anode, load, reservoir C,
// guaranteed minimum rectified current (5Ц9С: the load printed as 22 kΩ is 2.2 kΩ)
for (const [name, ua, rn, c, anodes, minMa, page] of [["5Ts3S", 500, 2000, 4e-6, 2, 230, 72], ["5Ts4S", 500, 4700, 4e-6, 2, 122, 73],
  ["5Ts8S", 500, 1000, 4e-6, 2, 400, 74], ["5Ts9S", 500, 2200, 4e-6, 2, 190, 75], ["6Ts4P", 350, 5200, 8e-6, 2, 75, 75],
  ["6Ts5S", 400, 5700, 8e-6, 2, 70, 76], ["6Ts13P", 650, 5000, 4e-6, 1, 120, 77]]) {
  test(`${name} in the K&L 1981 test circuit (p. ${page}) delivers at least ${minMa} mA`, () => {
    const P = E.RECTIFIER_PERVEANCE[name];
    const els = [{ id: "S1", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 50, amp: ua * Math.SQRT2, offset: 0 },
      { id: "D1", kind: "VDIODE", nodes: [1, 3], perveance: P }, { id: "C", kind: "C", nodes: [3, 0], c }, { id: "R", kind: "R", nodes: [3, 0], r: rn }];
    if (anodes === 2) els.push({ id: "S2", kind: "VSRC", nodes: [2, 0], wave: "sine", freq: 50, amp: ua * Math.SQRT2, offset: 0, phase: 180 }, { id: "D2", kind: "VDIODE", nodes: [2, 3], perveance: P });
    const r = E.simulate({ nodeCount: 4, elements: els }, { budgetMs: 20000 });
    assert.ok(r.ok, r.error);
    const v = r.tran.nodes[3]; let sum = 0; for (let i = 0; i < v.length - 1; i++) sum += v[i];
    const ma = sum / (v.length - 1) / rn * 1000;
    assert.ok(ma >= minMa * 0.99 && ma < minMa * 1.15, `${name}: ${ma.toFixed(1)} mA (book minimum ${minMa} mA)`);
  });
}

test("resistor divider: exact DC solution", () => {
  const r = E.simulate({ nodeCount: 3, elements: [
    { id: "V1", kind: "V", nodes: [1, 0], v: 10 },
    { id: "R1", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "R2", kind: "R", nodes: [2, 0], r: 3000 }] });
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[2], 7.5, 1e-5, "divider output");
});

test("RC low-pass at 1 kHz matches |H| = 1/sqrt(1+(f/fc)^2)", () => {
  const r = E.simulate({ nodeCount: 3, elements: [
    { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 },
    { id: "R", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "C", kind: "C", nodes: [2, 0], c: 1e-6 }] });
  assert.ok(r.ok, r.error);
  const fc = 1 / (2 * Math.PI * 1000 * 1e-6);
  near(pp(r.tran.nodes[2]) / 2, 1 / Math.sqrt(1 + (1000 / fc) ** 2), 0.02, "RC gain");
});

test("R-L divider at 1 kHz matches |H| = 1/sqrt(1+(wL/R)^2)", () => {
  const L = 0.2;
  const r = E.simulate({ nodeCount: 3, elements: [
    { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 },
    { id: "L", kind: "L", nodes: [1, 2], l: L },
    { id: "R", kind: "R", nodes: [2, 0], r: 1000 }] });
  assert.ok(r.ok, r.error);
  near(pp(r.tran.nodes[2]) / 2, 1 / Math.sqrt(1 + ((2 * Math.PI * 1000 * L) / 1000) ** 2), 0.02, "RL gain");
});

test("grid conduction clamps a positively driven grid near the cathode", () => {
  const r = E.simulate({ nodeCount: 5, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 250 }, { id: "Ra", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "Vg", kind: "V", nodes: [3, 0], v: 5 }, { id: "Rg", kind: "R", nodes: [3, 4], r: 100e3 },
    { id: "V1", kind: "TRIODE", nodes: [2, 4, 0], model: tube("12AX7").koren.Triode }] });
  assert.ok(r.ok, r.error);
  const vg = r.dc.nodes[4];
  assert.ok(vg > 0 && vg < 2, `grid at ${vg.toFixed(2)} V (5 V through 100k)`);
});

test("12AX7 common-cathode stage: DC point and gain", () => {
  const p = tube("12AX7").koren.Triode;
  // independent DC solve: Ia = f(B+ - Ia(Ra+Rk), -Ia*Rk) by bisection
  let lo = 0, hi = 0.0025;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2, vk = m * 1500; E.Koren.triodeIa(250 - m * 100e3 - vk, -vk, p) > m ? (lo = m) : (hi = m); }
  const vaRef = 250 - ((lo + hi) / 2) * 100e3;
  const r = E.simulate({ nodeCount: 7, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 250 }, { id: "Ra", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "V1", kind: "TRIODE", nodes: [2, 3, 4], model: p }, { id: "Rk", kind: "R", nodes: [4, 0], r: 1500 },
    { id: "Ck", kind: "C", nodes: [4, 0], c: 47e-6 }, { id: "Rg", kind: "R", nodes: [3, 0], r: 1e6 },
    { id: "Cin", kind: "C", nodes: [5, 3], c: 0.1e-6 }, { id: "Gen", kind: "VSRC", nodes: [5, 0], wave: "sine", freq: 1000, amp: 0.05 },
    { id: "Co", kind: "C", nodes: [2, 6], c: 0.1e-6 }, { id: "RL", kind: "R", nodes: [6, 0], r: 470e3 }] });
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[2], vaRef, 0.002, "plate voltage vs bisection");
  // small-signal gain mu*RL/(rp+RL) from numerical gm and rp at the operating point
  const vq = r.dc.nodes[2] - r.dc.nodes[4], vgq = -r.dc.nodes[4], d = 1e-3;
  const gm = (E.Koren.triodeIa(vq, vgq + d, p) - E.Koren.triodeIa(vq, vgq - d, p)) / (2 * d);
  const rp = (2 * d * 1000) / (E.Koren.triodeIa(vq + d * 1000, vgq, p) - E.Koren.triodeIa(vq - d * 1000, vgq, p));
  const RL = 1 / (1 / 100e3 + 1 / 470e3);
  near(pp(r.tran.nodes[6]) / pp(r.tran.nodes[5]), (gm * rp * RL) / (rp + RL), 0.05, "stage gain vs small-signal");
});

test("output transformer 5k:8 gives the turns ratio under load", () => {
  const n = Math.sqrt(5000 / 8);
  const r = E.simulate({ nodeCount: 4, elements: [
    { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 10 }, { id: "Rs", kind: "R", nodes: [1, 2], r: 0.001 },
    { id: "T", kind: "XFMR", nodes: [], lp: 20, k: 0.9995, primaryTurns: 1, windings: [{ a: 2, b: 0, turns: 1 }, { a: 3, b: 0, turns: 1 / n }] },
    { id: "RL", kind: "R", nodes: [3, 0], r: 8 }] });
  assert.ok(r.ok, r.error);
  near(pp(r.tran.nodes[3]) / 2, 10 / n, 0.03, "secondary amplitude");
});

test("5U4G full-wave supply settles to a plausible B+", () => {
  const vpk = 350 * Math.SQRT2, P = E.RECTIFIER_PERVEANCE["5U4G"];
  const r = E.simulate({ nodeCount: 5, elements: [
    { id: "HT1", kind: "VSRC", nodes: [1, 3], wave: "sine", freq: 50, amp: vpk, dcValue: 0.95 * vpk },
    { id: "HT2", kind: "VSRC", nodes: [3, 2], wave: "sine", freq: 50, amp: vpk, dcValue: -0.95 * vpk },
    { id: "Rct", kind: "R", nodes: [3, 0], r: 0.01 },
    { id: "U", part: "a1", kind: "VDIODE", nodes: [1, 4], perveance: P }, { id: "U", part: "a2", kind: "VDIODE", nodes: [2, 4], perveance: P },
    { id: "C1", kind: "C", nodes: [4, 0], c: 47e-6 }, { id: "RL", kind: "R", nodes: [4, 0], r: 2500 }] }, { budgetMs: 4000 });
  assert.ok(r.ok, r.error);
  assert.ok(r.tran.settled, "reaches steady state");
  const bplus = avg(r.tran.nodes[4]);
  // peak (495 V) minus the 5U4G drop (~50 V at ~160 mA) minus half the ripple
  assert.ok(bplus > 380 && bplus < 470, `B+ ${bplus.toFixed(1)} V`);
});

test("choke-input supply from cold: steady state matches an independent RK4 integration", () => {
  const vpk = 300 * Math.SQRT2, P = E.RECTIFIER_PERVEANCE.GZ34, C1 = 47e-6, Rl = 100, L = 5, C2 = 100e-6, RL = 4000;
  const r = E.simulate({ nodeCount: 8, elements: [
    { id: "HT1", kind: "VSRC", nodes: [1, 3], wave: "sine", freq: 50, amp: vpk, dcValue: 0 },
    { id: "HT2", kind: "VSRC", nodes: [3, 2], wave: "sine", freq: 50, amp: vpk, dcValue: 0 },
    { id: "Rct", kind: "R", nodes: [3, 0], r: 0.01 },
    { id: "U", part: "a1", kind: "VDIODE", nodes: [1, 4], perveance: P }, { id: "U", part: "a2", kind: "VDIODE", nodes: [2, 4], perveance: P },
    { id: "C1", kind: "C", nodes: [4, 0], c: C1 }, { id: "Rl", kind: "R", nodes: [4, 5], r: Rl }, { id: "L", kind: "L", nodes: [5, 6], l: L },
    { id: "C2", kind: "C", nodes: [6, 0], c: C2 }, { id: "RL", kind: "R", nodes: [6, 0], r: RL },
    // a 1 kHz probe signal elsewhere forces the multi-rate settling path
    { id: "G", kind: "VSRC", nodes: [7, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "Rg", kind: "R", nodes: [7, 0], r: 1000 }] }, { budgetMs: 4000 });
  assert.ok(r.ok, r.error);
  assert.ok(r.tran.settled, "reaches steady state");
  // reference: the same supply as three ODEs, RK4 at 10 us for 3 s (settled by ~2 s)
  const f = (t, [v1, il, v2]) => {
    const vd = Math.abs(vpk * Math.sin(2 * Math.PI * 50 * t)) - v1, id = vd > 0 ? P * vd ** 1.5 : 0;
    return [(id - il) / C1, (v1 - Rl * il - v2) / L, (il - v2 / RL) / C2];
  };
  const h = 1e-5, T = 3;
  let y = [0, 0, 0], sum = 0, n = 0;
  for (let t = 0; t < T; t += h) {
    const k1 = f(t, y), k2 = f(t + h / 2, y.map((v, i) => v + (h / 2) * k1[i]));
    const k3 = f(t + h / 2, y.map((v, i) => v + (h / 2) * k2[i])), k4 = f(t + h, y.map((v, i) => v + h * k3[i]));
    y = y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    if (t > T - 0.02) { sum += y[2]; n++; }
  }
  near(avg(r.tran.nodes[6]), sum / n, 0.002, "B+ vs RK4 reference");
});

test("EL84 single-ended output stage: bias, currents and output power", () => {
  const p = tube("EL84").koren.Pentode, n = Math.sqrt(5000 / 8);
  const r = E.simulate({ nodeCount: 8, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 300 },
    { id: "T", kind: "XFMR", nodes: [], lp: 20, k: 0.999, primaryTurns: 1, windings: [{ a: 1, b: 2, turns: 1 }, { a: 6, b: 0, turns: 1 / n }] },
    { id: "V1", kind: "PENTODE", nodes: [2, 3, 4, 5], model: p }, { id: "Rg2", kind: "R", nodes: [1, 4], r: 1000 },
    { id: "Rk", kind: "R", nodes: [5, 0], r: 270 }, { id: "Ck", kind: "C", nodes: [5, 0], c: 100e-6 },
    { id: "Rg", kind: "R", nodes: [3, 0], r: 470e3 }, { id: "Gen", kind: "VSRC", nodes: [7, 0], wave: "sine", freq: 1000, amp: 5 },
    { id: "Cin", kind: "C", nodes: [7, 3], c: 0.1e-6 }, { id: "Spk", kind: "R", nodes: [6, 0], r: 8 }] }, { budgetMs: 4000 });
  assert.ok(r.ok, r.error);
  const dc = r.dc.devices.V1.main;
  assert.ok(dc.ia > 0.03 && dc.ia < 0.06, `Ia ${(dc.ia * 1e3).toFixed(1)} mA`);
  assert.ok(dc.vgk < -5 && dc.vgk > -15, `cathode bias ${dc.vgk.toFixed(2)} V`);
  const pout = avg(Array.from(r.tran.nodes[6], v => (v * v) / 8));
  assert.ok(pout > 1 && pout < 6, `Pout ${pout.toFixed(2)} W`);
});

test("shorted inductor or winding does not crash the solver", () => {
  const r = E.simulate({ nodeCount: 3, elements: [
    { id: "V", kind: "V", nodes: [1, 0], v: 10 }, { id: "R", kind: "R", nodes: [1, 2], r: 100 },
    { id: "L", kind: "L", nodes: [2, 2], l: 1 }, { id: "R2", kind: "R", nodes: [2, 0], r: 100 }] });
  assert.ok(r.ok, r.error);
});

// Datasheet regression: every amplifier tube against its published operating
// points (tests/datasheets.mjs, also the input of scripts/fit-tubes.mjs).
// Tolerances: Ia ±10 %, gm ±15 %, Ig2 ±20 %, rp ±15 %.
const mA = (kind, p, pt, vg) => 1e3 * (kind === "pentode" ? E.Koren.pentodeIa(pt.va, vg, pt.vg2, p) : E.Koren.triodeIa(pt.va, vg, p));
function biasFor(kind, p, pt) {
  let lo = -pt.va, hi = 0;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; mA(kind, p, pt, m) < pt.ia ? (lo = m) : (hi = m); }
  return (lo + hi) / 2;
}

test("every amplifier tube has datasheet reference data", () => {
  const missing = globalThis.TUBE_DATABASE.filter(t => t.category !== "rectifier" && !datasheetFor(t.commonName)).map(t => t.commonName);
  assert.deepEqual(missing, []);
});

for (const t of globalThis.TUBE_DATABASE.filter(t => t.category !== "rectifier")) {
  const ds = datasheetFor(t.commonName);
  if (!ds) continue;
  const p = ds.kind === "pentode" ? t.koren.Pentode : t.koren.Triode;
  for (const pt of ds.points) {
    const where = `Va=${pt.va} V${pt.vg2 ? `, Vg2=${pt.vg2} V` : ""}${pt.vg === null ? "" : `, Vg1=${pt.vg} V`}`;
    test(`datasheet: ${t.commonName} at ${where} (${ds.source})`, () => {
      const vg = pt.vg === null ? biasFor(ds.kind, p, pt) : pt.vg;
      if (pt.vg === null) assert.ok(vg < 0 && vg > -pt.va / 2, `${t.commonName}: bias for ${pt.ia} mA is ${vg.toFixed(2)} V`);
      else near(mA(ds.kind, p, pt, vg), pt.ia, 0.1, `${t.commonName} Ia (mA)`);
      if (pt.gm) near((mA(ds.kind, p, pt, vg + 0.02) - mA(ds.kind, p, pt, vg - 0.02)) / 0.04, pt.gm, 0.15, `${t.commonName} gm (mA/V)`);
      if (pt.rp) {
        const h = Math.max(0.5, pt.va * 0.002);
        const rp = (2 * h) / (mA(ds.kind, p, { ...pt, va: pt.va + h }, vg) - mA(ds.kind, p, { ...pt, va: pt.va - h }, vg));
        near(rp, pt.rp, (pt.tol && pt.tol.rp) || 0.15, `${t.commonName} rp (kΩ)`);
      }
      if (pt.ig2) near(1e3 * E.Koren.screenI(vg, pt.vg2, p, pt.va), pt.ig2, 0.2, `${t.commonName} Ig2 (mA)`);
    });
  }
  if (t.koren.Pentode) {
    test(`${t.commonName}: triode-connected model matches the pentode strapped as a triode`, () => {
      const P = t.koren.Pentode, T = t.koren.Triode, va = Math.min(250, t.vg2Max);
      for (const frac of [0.25, 0.5, 1]) {
        // grid bias giving `frac` of the zero-bias strapped current
        const full = E.Koren.pentodeIa(va, 0, va, P) + E.Koren.screenI(0, va, P, va);
        let lo = -va, hi = 0;
        for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; E.Koren.pentodeIa(va, m, va, P) + E.Koren.screenI(m, va, P, va) < frac * full ? (lo = m) : (hi = m); }
        const vg = (lo + hi) / 2;
        near(E.Koren.triodeIa(va, vg, T), E.Koren.pentodeIa(va, vg, va, P) + E.Koren.screenI(vg, va, P, va), 0.1, `${t.commonName} strapped current at Vg1=${vg.toFixed(1)} V`);
      }
    });
  }
}

// Circuit level: the datasheets' own cathode-biased test conditions, solved by
// the full simulator. Checks bias, current and the resulting dissipation.
for (const [name, rk, ia, ig2, src] of [["EL84", 135, 48, 5.5, "Philips EL84"], ["6V6GT", 250, 45, 4.5, "RCA 6V6GT"]]) {
  test(`${name} self-biased with Rk = ${rk} Ω settles at the datasheet current (${src})`, () => {
    const r = E.simulate({ nodeCount: 4, elements: [
      { id: "B", kind: "V", nodes: [1, 0], v: 250 },
      { id: "V1", kind: "PENTODE", nodes: [1, 2, 1, 3], model: tube(name).koren.Pentode },
      { id: "Rg", kind: "R", nodes: [2, 0], r: 470e3 }, { id: "Rk", kind: "R", nodes: [3, 0], r: rk }] });
    assert.ok(r.ok, r.error);
    const vk = r.dc.nodes[3], ik = (vk / rk) * 1e3;
    near(ik, ia + ig2, 0.1, `${name} cathode current (mA)`);
    near((250 - vk) * (ik - ig2) / 1e3, (250 * ia) / 1e3, 0.12, `${name} plate dissipation (W)`);
  });
}

// Large signal: the published single-ended class-A results at full drive
// (output power, THD and average currents) simulated in the datasheet's own
// circuit. Tolerances: power ±10 %, THD ±30 %, currents ±12 %.
const { seStage } = await import("../scripts/fit-tubes.mjs");
for (const ds of (await import("./datasheets.mjs")).DATASHEETS.filter(d => d.largeSignal)) {
  for (const ls of ds.largeSignal) {
    test(`full drive: ${ds.tube} single-ended, ${ls.b} V into ${ls.rl} Ω (${ds.source})`, () => {
      const m = seStage(tube(ds.tube).koren.Pentode, ls);
      assert.ok(m, "simulates");
      near(m.pout, ls.pout, 0.1, `${ds.tube} output power (W)`);
      near(m.thd, ls.thd, 0.3, `${ds.tube} THD (%)`);
      if (ls.ia) near(m.ia, ls.ia, 0.12, `${ds.tube} average plate current at full drive (mA)`);
      if (ls.ig2) near(m.ig2, ls.ig2, 0.12, `${ds.tube} average screen current at full drive (mA)`);
    });
  }
}

test("pentode screen current rises as the plate swings into the knee (current conservation)", () => {
  const P = tube("EL84").koren.Pentode;
  const ig2 = va => E.Koren.screenI(0, 250, P, va), ia = va => E.Koren.pentodeIa(va, 0, 250, P);
  assert.ok(ig2(20) > 3 * ig2(250), `Ig2 at 20 V ${(ig2(20) * 1e3).toFixed(1)} mA vs ${(ig2(250) * 1e3).toFixed(1)} mA at 250 V`);
  // cathode current stays within ±35 % of its high-voltage value through the knee
  const ik = va => ia(va) + ig2(va);
  for (const va of [15, 30, 60, 120]) near(ik(va), ik(250), 0.35, `Ik at Va=${va} V`);
});

test("transformer-fed kenotron supply converges for any node order (round-off floor)", () => {
  // mains 230 V -> 230:370-0-370 transformer -> 5Ц4С -> 10 µF - 0.6 H - 220 µF -> 2.9 kΩ.
  // Hundreds of volts on some nodes put Newton's last updates at the round-off
  // level; whether they met a fixed 1 µV test used to depend on node numbering.
  const base = [
    { id: "ac", kind: "VSRC", nodes: [1, 2], wave: "sine", freq: 50, amp: 230 * Math.SQRT2, phase: 90, acMains: true },
    { id: "earth", kind: "R", nodes: [2, 0], r: 1 },
    { id: "rp", kind: "R", nodes: [1, 3], r: 7.4 },
    { id: "r1", kind: "R", nodes: [4, 5], r: 44.6 }, { id: "r2", kind: "R", nodes: [6, 7], r: 44.6 },
    { id: "tx", kind: "XFMR", nodes: [], lp: 7.8, k: 0.999, primaryTurns: 230, windings: [{ a: 3, b: 2, turns: 230 }, { a: 5, b: 0, turns: 370.3 }, { a: 0, b: 7, turns: 370.3 }] },
    { id: "v", part: "a1", kind: "VDIODE", nodes: [4, 8], perveance: E.RECTIFIER_PERVEANCE["5Ts4S"] },
    { id: "v", part: "a2", kind: "VDIODE", nodes: [6, 8], perveance: E.RECTIFIER_PERVEANCE["5Ts4S"] },
    { id: "c1", kind: "C", nodes: [8, 0], c: 10e-6 }, { id: "l", kind: "L", nodes: [8, 9], l: 0.6 }, { id: "rl", kind: "R", nodes: [9, 10], r: 26 },
    { id: "c2", kind: "C", nodes: [10, 0], c: 220e-6 }, { id: "load", kind: "R", nodes: [10, 0], r: 2900 }
  ];
  const results = [];
  for (let seed = 1; seed <= 6; seed++) {
    // a reproducible shuffle of node numbers 1..10 and of the element order
    let s = seed * 9301 + 49297;
    const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    const perm = [0, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].sort(() => rnd() - 0.5)];
    const els = base.map(e => Object.assign({}, e, { nodes: e.nodes.map(n => perm[n]), windings: e.windings && e.windings.map(w => ({ a: perm[w.a], b: perm[w.b], turns: w.turns })) })).sort(() => rnd() - 0.5);
    const r = E.simulate({ nodeCount: 11, elements: els }, { budgetMs: 60000, maxPeriods: 4000 });
    assert.ok(r.ok, `node order ${seed}: ${r.error}`);
    results.push(r.dc.nodes[perm[10]]);
  }
  const spread = Math.max(...results) - Math.min(...results);
  assert.ok(results[0] > 300 && results[0] < 450 && spread < 0.2, `DC output ${results.map(v => v.toFixed(2)).join(", ")} V`);
});

test("power-on transient: RC charge from cold follows 1 - e^(-t/RC), probes are differential", () => {
  // 100 V -> 10 kΩ -> node 2 -> 10 µF -> node 3 -> 1 Ω -> ground; probe [2, 3] reads the capacitor alone
  const nl = { nodeCount: 4, elements: [
    { id: "b", kind: "V", nodes: [1, 0], v: 100 }, { id: "r", kind: "R", nodes: [1, 2], r: 10e3 },
    { id: "c", kind: "C", nodes: [2, 3], c: 10e-6 }, { id: "rs", kind: "R", nodes: [3, 0], r: 1 }] };
  const r = E.startup(nl, { tStop: 0.5, probes: [[2, 3], 2], maxPoints: 500 });
  assert.ok(r.ok, r.error);
  const tau = 10001 * 10e-6;
  for (const t of [0.05, 0.1, 0.2, 0.4]) {
    const i = Math.round(t / r.dt - 0.5), v = (r.min[0][i] + r.max[0][i]) / 2;
    near(v, 100 * (1 - Math.exp(-t / tau)), 0.01, `Vc at ${t} s`);
  }
  assert.ok(r.min[0][0] < 1, "starts empty");
  // the single-node probe also sees the 1 Ω resistor's drop (current x 1 Ω), a few mV more early on
  assert.ok(r.max[1][0] > r.max[0][0], "a probe against ground differs from the differential one");
});
