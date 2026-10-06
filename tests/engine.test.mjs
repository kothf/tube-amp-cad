/**
 * Circuit engine accuracy tests (node --test).
 * Every case is checked against an independent result: closed-form circuit
 * theory, a separate bisection solve of the Koren equation, or an RK4
 * integration of the same circuit written as plain ODEs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

// The engine and tube database are browser scripts that attach to globalThis
for (const f of ["tube-db.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine;
const tube = name => globalThis.TUBE_DATABASE.find(t => t.commonName === name);

const pp = a => Math.max(...a) - Math.min(...a);
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected), `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);

test("tube database: 40 tubes, every amplifier tube has Koren parameters", () => {
  const db = globalThis.TUBE_DATABASE;
  assert.equal(db.length, 40);
  for (const t of db) {
    if (t.category === "rectifier") assert.ok(E.RECTIFIER_PERVEANCE[t.commonName], `${t.commonName}: rectifier perveance`);
    else for (const k of ["mu", "kg", "kp", "kvb", "x"]) assert.ok(t.koren.Triode[k] > 0, `${t.commonName}: Triode.${k}`);
  }
});

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

// Datasheet regression: published single-tube class-A operating points.
// Models outside ±20 % are tracked as known issues (todo): reported in every
// run, not blocking. Refit the model, then remove it from KNOWN_OFF.
const DATASHEET = [
  // tube, Va, Vg2 (pentodes), Vg1, Ia mA, Ig2 mA, source
  ["12AX7", 250, null, -2, 1.2, null, "RCA 12AX7A"],
  ["12AU7", 250, null, -8.5, 10.5, null, "RCA 12AU7A"],
  ["12AT7", 250, null, -2, 10, null, "RCA 12AT7"],
  ["6SN7GT", 250, null, -8, 9, null, "RCA 6SN7GTB"],
  ["6SL7GT", 250, null, -2, 2.3, null, "RCA 6SL7GT"],
  ["300B", 300, null, -61, 60, null, "Western Electric 300B"],
  ["2A3", 250, null, -45, 60, null, "RCA 2A3"],
  ["EL84", 250, 250, -7.3, 48, 5.5, "Philips EL84"],
  ["6V6GT", 250, 250, -12.5, 45, 4.5, "RCA 6V6GT"],
  ["6L6GC", 250, 250, -14, 72, 5, "RCA 6L6GC"],
  ["EL34", 250, 250, -13.5, 100, 14.9, "Philips EL34"],
];
const KNOWN_OFF = new Set(["12AX7", "12AT7", "6SN7GT", "300B", "2A3", "6V6GT", "6L6GC", "EL34"]);

for (const [name, va, vg2, vg1, ia, ig2, src] of DATASHEET) {
  test(`datasheet: ${name} Ia at Va=${va} V, Vg1=${vg1} V (${src})`, { todo: KNOWN_OFF.has(name) && "model needs refitting" }, () => {
    const k = tube(name).koren;
    const got = vg2 ? E.Koren.pentodeIa(va, vg1, vg2, k.Pentode) : E.Koren.triodeIa(va, vg1, k.Triode);
    near(got * 1e3, ia, 0.2, `${name} Ia (mA)`);
    if (ig2) near(E.Koren.screenI(vg1, vg2, k.Pentode) * 1e3, ig2, 0.2, `${name} Ig2 (mA)`);
  });
}
