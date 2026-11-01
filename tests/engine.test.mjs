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
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));   // the linear solver as WebAssembly, as the worker loads it
const tube = name => globalThis.TUBE_DATABASE.find(t => t.commonName === name);

const pp = a => Math.max(...a) - Math.min(...a);
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
const near = (actual, expected, relTol, msg) =>
  assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected), `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);

test("tube database: 111 tubes, every amplifier tube has Koren parameters", () => {
  const db = globalThis.TUBE_DATABASE;
  assert.equal(db.length, 111);
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
  // the Western classics
  assert.deepEqual(pins("6AQ5A", "VL1", "pentode"), { A: "5", G: "1,7", G1: "1,7", G2: "6", K: "2", H: "3,4" });   // 7BZ: g1 on pins 1 and 7
  assert.deepEqual(pins("ECL82-P", "VL1.2", "pentode"), pins("6F3P-P", "VL1.2", "pentode"));
  assert.equal(pins("ECL82-T", "VL1.1").A, "9");
  assert.deepEqual([pins("12BH7A", "VL1.1"), pins("12BH7A", "VL1.2")].map(p => [p.A, p.G, p.K]), [["6", "7", "8"], ["1", "2", "3"]]);
  assert.deepEqual([pins("6AS7G", "VL1.1"), pins("6AS7G", "VL1.2")].map(p => [p.A, p.G, p.K, p.H]), [["5", "4", "6", "7,8"], ["2", "1", "3", "7,8"]]);
  assert.deepEqual(pins("KT66", "VL1", "pentode"), pins("6L6GC", "VL1", "pentode"));
  assert.deepEqual(pins("211", "VL1"), pins("845", "VL1"));
  assert.deepEqual(pins("5Y3GT", "VL1"), pins("5U4G", "VL1"));
  for (const [t, k] of [["EZ81", "3"], ["6X4", "7"]]) assert.equal(pins(t, "VL1").K, k, t);
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

test("current source: Ohm's law on its load, and a 12AX7 plate held at its current", () => {
  // 2 mA from ground into 1 node through 10 kΩ: 20 V; the source reports its current and voltage
  const r = E.simulate({ nodeCount: 2, elements: [
    { id: "I1", kind: "I", nodes: [0, 1], i: 2e-3 },
    { id: "R1", kind: "R", nodes: [1, 0], r: 10e3 }] });
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[1], 20, 1e-4, "I·R across the load (gmin aside)");
  near(r.dc.devices.I1.main.i, 2e-3, 1e-12, "source current");
  // as a plate load: B+ 300 V → source → anode, cathode grounded, grid at -1.5 V: Ia is the set 1 mA
  const t = E.simulate({ nodeCount: 4, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 300 },
    { id: "I1", kind: "I", nodes: [1, 2], i: 1e-3 },
    { id: "Vg", kind: "V", nodes: [3, 0], v: -1.5 },
    { id: "V1", kind: "TRIODE", nodes: [2, 3, 0], model: tube("12AX7").koren.Triode }] });
  assert.ok(t.ok, t.error);
  near(t.dc.devices.V1.main.ia, 1e-3, 1e-3, "anode current = the source's current");
  assert.ok(t.dc.nodes[2] > 50 && t.dc.nodes[2] < 300, `anode between 50 V and B+: ${t.dc.nodes[2]}`);
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

test("simulate reports its readiness: rising from DC to 100 %", () => {
  // a half-wave rectifier charging a reservoir cap from 0 V through 1 kΩ: ~100 cycles to settle
  const seen = [];
  const r = E.simulate({ nodeCount: 4, elements: [
    { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 50, amp: 10 },
    { id: "R1", kind: "R", nodes: [1, 3], r: 1000 },
    { id: "D", kind: "D", nodes: [3, 2], is: 1e-12, n: 1.5 },
    { id: "C", kind: "C", nodes: [2, 0], c: 100e-6 },
    { id: "R", kind: "R", nodes: [2, 0], r: 10e3 }] }, { budgetMs: 20000, maxPeriods: 20000, noExtrapolate: true, progressMs: 0, onProgress: f => seen.push(f) });
  assert.ok(r.ok, r.error);
  assert.ok(seen.length >= 3, `progress reported ${seen.length} times`);
  assert.ok(seen.every((f, i) => f > 0 && f <= 1 && (i === 0 || f > seen[i - 1])), "progress only rises, within 0…1: " + seen.map(f => f.toFixed(2)).join(" "));
  assert.equal(seen[seen.length - 1], 1, "ends at 100 %");
  assert.ok(seen.some(f => f > 0.1 && f < 0.88), "reports along the settling: " + seen.map(f => f.toFixed(2)).join(" "));
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

test("5Y3GT, EZ81, 6X4: capacitor-input supply at the rated current matches RK4, drop in the datasheet order", () => {
  const drop = {};
  for (const [name, ma] of [["5Y3GT", 125], ["EZ81", 150], ["6X4", 70], ["GZ34", 150]]) {
    const vpk = 300 * Math.SQRT2, P = E.RECTIFIER_PERVEANCE[name], C1 = 47e-6, RL = 360 / (ma / 1000);
    const r = E.simulate({ nodeCount: 5, elements: [
      { id: "HT1", kind: "VSRC", nodes: [1, 3], wave: "sine", freq: 50, amp: vpk, dcValue: 0 },
      { id: "HT2", kind: "VSRC", nodes: [3, 2], wave: "sine", freq: 50, amp: vpk, dcValue: 0 },
      { id: "Rct", kind: "R", nodes: [3, 0], r: 0.01 },
      { id: "U", part: "a1", kind: "VDIODE", nodes: [1, 4], perveance: P }, { id: "U", part: "a2", kind: "VDIODE", nodes: [2, 4], perveance: P },
      { id: "C1", kind: "C", nodes: [4, 0], c: C1 }, { id: "RL", kind: "R", nodes: [4, 0], r: RL }] }, { budgetMs: 4000 });
    assert.ok(r.ok && r.tran.settled, `${name}: ${r.error || "not settled"}`);
    const f = (t, v) => { const vd = Math.abs(vpk * Math.sin(2 * Math.PI * 50 * t)) - v; return ((vd > 0 ? P * vd ** 1.5 : 0) - v / RL) / C1; };
    const h = 1e-5;
    let v = 0, sum = 0, n = 0;
    for (let t = 0; t < 1.5; t += h) {
      const k1 = f(t, v), k2 = f(t + h / 2, v + h / 2 * k1), k3 = f(t + h / 2, v + h / 2 * k2), k4 = f(t + h, v + h * k3);
      v += h / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      if (t > 1.5 - 0.02) { sum += v; n++; }
    }
    const bplus = avg(r.tran.nodes[4]);
    near(bplus, sum / n, 0.003, `${name} B+ vs RK4 reference`);
    drop[name] = vpk - bplus;
  }
  // the 5Y3 drops the most, the GZ34 the least; the EZ81 sits between (at more current than the 6X4)
  assert.ok(drop["5Y3GT"] > drop.EZ81 && drop.EZ81 > drop.GZ34, JSON.stringify(drop));
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

test("cathode warm-up: Richardson emission of an oxide cathode, from nothing cold to all of it hot", () => {
  const C = E.CATHODE, f = t => E.cathodeWarm(t, 5).frac;
  assert.ok(f(0) < 1e-10, `cold: ${f(0)}`);
  assert.ok(Math.abs(f(200) - 1) < 1e-9, "hot after many time constants");
  for (let t = 0; t < 30; t += 0.5) assert.ok(f(t + 0.5) > f(t), `rises at ${t} s`);
  // at 90 % of the working temperature: (0.9)² e^(−b/T + b/Tk)
  const T = 0.9 * C.hot, tAt = -5 * Math.log(1 - (T - C.room) / (C.hot - C.room));
  near(f(tAt), 0.81 * Math.exp(C.b * (1 / C.hot - 1 / T)), 1e-9, "emission share at 0.9 Tk");
});

test("cathode warm-up time constants: from the heater's power and the kind of cathode, or the part's own", () => {
  if (!globalThis.CadLib) runInThisContext(readFileSync(new URL("../cad-components.js", import.meta.url), "utf8"), { filename: "cad-components.js" });
  const L = globalThis.CadLib, w = n => L.tubeWarmup(L.tubeByName(n));
  // directly heated 0.8 + 0.25·Ih (1–2 s); standard indirectly heated 4 + 1.2·√Ph (5–8 s);
  // heavy (power or rectifier, Ph ≥ 5 W) 5 + 0.5·Ph (8–12 s); slow-start 5 + 0.5·Ph (10–15 s)
  const want = { "5U4G": [1.6, "directly"], "2A3": [1.4, "directly"], "300B": [1.1, "directly"], "12AX7": [5.6, "^indirectly"], "6V6GT": [6, "^indirectly"], "EL84": [6.6, "^indirectly"],
    "6L6GC": [8, "heavy"], "EL34": [9.7, "heavy"], "KT88": [10, "heavy"], "6S33S-V": [12, "heavy"], "GZ34": [10, "slow"], "5Ts4S": [10, "heavy"] };
  for (const [n, [tau, cls]] of Object.entries(want)) { const x = w(n); assert.ok(Math.abs(x.tau - tau) < 0.05 && new RegExp(cls).test(x.cls), `${n}: τ ${x.tau} s (${x.cls}), expected ${tau} s (${cls})`); }
  // the inspector's own value wins; 0 keeps the automatic one
  const t = L.tubeByName("EL34");
  assert.equal(L.tubeWarmup(t, { params: { warmTau: 14 } }).tau, 14);
  assert.equal(L.tubeWarmup(t, { params: { warmTau: 0 } }).tau, 9.7);
});

// a triode (12AX7 model) on a 250 V supply through 100 kΩ, cathode at ground
const warmTriode = (tau, extra) => ({ nodeCount: 4, elements: [
  { id: "b", kind: "V", nodes: [1, 0], v: 250 }, { id: "rs", kind: "R", nodes: [1, 3], r: 1e3 }, { id: "cs", kind: "C", nodes: [3, 0], c: 10e-6 },
  { id: "ra", kind: "R", nodes: [3, 2], r: 100e3 },
  { id: "V1", kind: "TRIODE", nodes: [2, 0, 0], model: tube("12AX7").koren.Triode, heat: { tau, emit: 12 * 0.008 } }, ...(extra || [])] });

test("power-on with warm-up: the tube conducts only as its cathode heats, never more than it emits, then as hot", () => {
  const tau = 2, nl = warmTriode(tau), hot = E.simulate(nl, { budgetMs: 30000 });
  assert.ok(hot.ok, hot.error);
  const iHot = (250 - hot.dc.nodes[2]) / 101e3;
  const r = E.startup(nl, { tStop: 6 * tau, warmup: true, probes: [[3, 2]], maxPoints: 1200, watch: [[3, 0]] });
  assert.ok(r.ok, r.error);
  const iAt = t => { const k = Math.min(r.max[0].length - 1, Math.round(t / r.dt - 0.5)); return (r.min[0][k] + r.max[0][k]) / 2 / 100e3; };
  assert.ok(iAt(0.3 * tau) < 0.01 * iHot, `cold: ${iAt(0.3 * tau)} A (hot ${iHot} A)`);
  near(iAt(5.9 * tau), iHot, 0.005, "warm: the hot tube's current");
  for (let t = 0.2 * tau; t < 3 * tau; t += 0.1 * tau) assert.ok(iAt(t) <= 12 * 0.008 * E.cathodeWarm(t, tau).frac * 1.02 + 1e-6, `emission caps the current at ${t.toFixed(1)} s`);
  // B+ overshoots to the unloaded 250 V while the tube is cold, then sags to the loaded value
  const w = r.watch[0], vEnd = hot.dc.nodes[3];
  assert.ok(w.max > 249 && vEnd < 249 && w.maxAt < 2 * tau, `B+ peak ${w.max} V at ${w.maxAt} s, settled ${vEnd} V`);
  // hot from the start (no warmup): the tube conducts at once, no overshoot beyond the settled B+
  const h = E.startup(nl, { tStop: 0.5, probes: [[3, 0]], maxPoints: 100, watch: [[3, 0]] });
  assert.ok(h.ok && h.watch[0].max < vEnd + 0.5, `hot cathode: B+ peak ${h.watch[0].max} V`);
  assert.equal(h.tubes[0].worst, null, "no cold-cathode report with hot cathodes");
  assert.ok(r.tubes[0].tau === tau && r.tubes[0].peak > 0.99 * iHot, "the tube's record: its time constant and peak current");
});

test("power-on: watched nets keep a coarser min/max record (watchPoints) that matches the probe", () => {
  const tau = 2, nl = warmTriode(tau);
  const r = E.startup(nl, { tStop: 4 * tau, warmup: true, probes: [[3, 0]], maxPoints: 2000, watch: [[3, 0], [1, 0]], watchPoints: 200 });
  assert.ok(r.ok, r.error);
  const w = r.watch[0];
  assert.equal(w.lo.length, 200); assert.equal(w.hi.length, 200); near(r.watchDt, 4 * tau / 200, 1e-9, "watchDt");
  // bucket k of the watched record spans probe buckets 10k … 10k + 9
  for (const k of [0, 20, 100, 199]) {
    let lo = Infinity, hi = -Infinity; for (let j = 10 * k; j < 10 * k + 10; j++) { lo = Math.min(lo, r.min[0][j]); hi = Math.max(hi, r.max[0][j]); }
    near(w.lo[k], lo, 1e-3, `low of bucket ${k}`); near(w.hi[k], hi, 1e-3, `high of bucket ${k}`);
  }
  assert.ok(Math.max(...w.hi) <= w.max + 1e-6 && r.watch[1].hi.slice(1).every(v => Math.abs(v - 250) < 1e-6), "the supply's record is flat at 250 V (after t = 0, where every node starts at 0)");
  // without watchPoints: peaks only
  const p = E.startup(nl, { tStop: 1, warmup: true, watch: [[3, 0]] });
  assert.equal(p.watch[0].lo, null); assert.equal(p.watchDt, 0);
});

test("power-on with warm-up: a rectifier charging a big empty capacitor from a cold cathode is reported", () => {
  // 5U4G, full wave from 2 × 350 Vrms, 470 µF first capacitor through 5 Ω per anode
  const P = E.RECTIFIER_PERVEANCE["5U4G"], pk = 350 * Math.SQRT2, heat = { tau: 1.5, emit: 12 * 0.225 };
  const nl = c1 => ({ nodeCount: 6, elements: [
    { id: "m1", kind: "VSRC", nodes: [1, 0], freq: 50, amp: pk, dc: 0 }, { id: "m2", kind: "VSRC", nodes: [2, 0], freq: 50, amp: -pk, dc: 0 },
    { id: "r1", kind: "R", nodes: [1, 4], r: 5 }, { id: "r2", kind: "R", nodes: [2, 5], r: 5 },
    { id: "V1", part: "a1", kind: "VDIODE", nodes: [4, 3], perveance: P, heat }, { id: "V1", part: "a2", kind: "VDIODE", nodes: [5, 3], perveance: P, heat },
    { id: "C1", kind: "C", nodes: [3, 0], c: c1 }, { id: "RL", kind: "R", nodes: [3, 0], r: 4e3 }] });
  const big = E.startup(nl(470e-6), { tStop: 6, warmup: true, probes: [[3, 0]], maxPoints: 100 }), small = E.startup(nl(10e-6), { tStop: 6, warmup: true, probes: [[3, 0]], maxPoints: 100 });
  const hot = E.startup(nl(470e-6), { tStop: 0.2, probes: [[3, 0]], maxPoints: 100 });
  assert.ok(big.ok && small.ok && hot.ok, big.error || small.error || hot.error);
  const w = x => Math.max(...x.tubes.map(e => (e.worst ? e.worst.i : 0)));
  assert.ok(big.tubes.length === 2 && w(big) > 1.5 * w(small), `cold-cathode current: ${w(big)} A with 470 µF, ${w(small)} A with 10 µF`);
  assert.ok(big.tubes.every(e => !e.worst || (e.worst.T < 0.9 * E.CATHODE.hot && e.worst.ratio >= 1.5)), "reported only while cold and overdrawn");
  // hot cathodes onto the empty 470 µF: a surge several times what the warming cathode lets through
  const pkHot = Math.max(...hot.tubes.map(e => e.peak)), pkCold = Math.max(...big.tubes.map(e => e.peak));
  assert.ok(pkHot > 3 * pkCold, `surge ${pkHot} A hot, ${pkCold} A warming up`);
});

// --- Semiconductors -----------------------------------------------------------
const bisect = (f, lo, hi) => { for (let k = 0; k < 200; k++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; } return (lo + hi) / 2; };

test("BJT: 2N3904 common emitter matches a nested bisection of the Gummel-Poon equations", () => {
  const m = { pol: 1, is: 6.734e-15, bf: 416.4, br: 0.7371, nf: 1, vaf: 74.03, ikf: 0.06678 }, Vcc = 12, Rb = 1e6, Rc = 2200, VT = 0.025852;
  // the collector voltage for a given base voltage, then the base voltage that the base resistor feeds
  const vcFor = vb => bisect(vc => Vcc - vc - Rc * E.Semi.bjt([vc, vb, 0], m)[0], -1, Vcc + 1);
  const vb = bisect(v => (Vcc - v) / Rb - E.Semi.bjt([vcFor(v), v, 0], m)[1], 0.3, 0.9), vc = vcFor(vb);
  const r = E.simulate({ nodeCount: 4, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: Vcc }, { id: "rb", kind: "R", nodes: [1, 2], r: Rb },
    { id: "rc", kind: "R", nodes: [1, 3], r: Rc }, { id: "q", kind: "BJT", nodes: [3, 2, 0], model: m }] });
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[2], vb, 1e-4, "Vbe"); near(r.dc.nodes[3], vc, 1e-3, "Vce");
  const q = r.dc.devices.q.main;
  near(q.ic, (Vcc - vc) / Rc, 1e-3, "Ic");
  // forward active: Ic ≈ Is·e^(Vbe/Vt)·(1 + Vcb/VAF), reduced by the high-injection knee 2/(1 + √(1 + 4·If/IKF))
  const If = m.is * Math.exp(vb / VT);
  near(q.ic, If * (1 + (vc - vb) / m.vaf) * 2 / (1 + Math.sqrt(1 + 4 * If / m.ikf)), 0.01, "Ic from the exponential law");
});

test("PNP current source on a 300 V rail sets (Vref − Vbe)/Re", () => {
  const m = { pol: -1, is: 1e-13, bf: 100, br: 4, nf: 1, vaf: 200, ikf: 0.3 };
  // base held 5 V below the rail by a divider, 1 kΩ emitter resistor to the rail, 47 kΩ load
  const r = E.simulate({ nodeCount: 5, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: 300 }, { id: "re", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "ra", kind: "R", nodes: [1, 3], r: 1000 }, { id: "rb", kind: "R", nodes: [3, 0], r: 59000 }, { id: "q", kind: "BJT", nodes: [4, 3, 2], model: m },
    { id: "rl", kind: "R", nodes: [4, 0], r: 47000 }] });
  assert.ok(r.ok, r.error);
  const q = r.dc.devices.q.main, ie = (300 - r.dc.nodes[2]) / 1000;
  assert.ok(q.vbe > 0.55 && q.vbe < 0.75, `Veb ${q.vbe}`);
  near(ie, (300 - r.dc.nodes[3] - q.vbe) / 1000, 1e-6, "emitter current = (Vref − Veb)/Re");
  near(q.ic, ie * m.bf / (m.bf + 1), 0.05, "Ic = α·Ie");
});

test("power BJTs with base and emitter resistance: VBE at the pins on the datasheet's typical curve, read at the pins", () => {
  runInThisContext(readFileSync(new URL("../cad-components.js", import.meta.url), "utf8"), { filename: "cad-components.js" });
  const L = globalThis.CadLib;
  // the part as the CAD builds it, collector held at VCE, base by a source; bisect VB for the test current
  // [type, IC, VCE, the typical VBE(on) read off the datasheet's curve at 25 °C]
  for (const [k, ic, vce, typ] of [["2N3055", 4, 4, 0.96], ["MJ2955", 4, 4, 1.17], ["TIP41C", 6, 4, 1.38], ["TIP42C", 6, 4, 1.38], ["MJL21194", 8, 5, 1.3], ["MJL21193", 8, 5, 1.35]]) {
    const pol = L.BJTS[k].pol, run = vb => {
      let n = 3; const els = [{ id: "vc", kind: "V", nodes: [1, 0], v: pol * vce }, { id: "vb", kind: "V", nodes: [2, 0], v: pol * vb }];
      L.LIB[pol > 0 ? "npn" : "pnp"].build({ id: "q", params: { model: k } }, pid => ({ C: 1, B: 2, E: 0 })[pid], () => n++, els);
      return E.simulate({ nodeCount: n, elements: els });
    };
    let lo = 0.3, hi = 3;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, d = run(m).dc.devices.q.main; if (d.ic < ic) lo = m; else hi = m; }
    const r = run(lo), q = r.dc.devices.q.main;
    near(q.vbe, lo, 1e-9, `${k}: VBE read at the pins`);
    assert.ok(Math.abs(lo - typ) <= 0.05, `${k}: VBE ${lo.toFixed(3)} V at ${ic} A (datasheet typical ${typ} V)`);
    near(q.vce, vce, 1e-9, `${k}: VCE read at the pins`);
    near(q.pd, vce * q.ic + lo * q.ib, 1e-6, `${k}: the dissipation takes in RB and RE`);
    const ie = r.dc.currents, sum = (id, node) => { let s = 0; for (let j = 0; j < ie.length; j += 3) if (String(ie[j]).startsWith(id) && ie[j + 1] === node) s += ie[j + 2]; return s; };
    near(sum("q", 0), -pol * (q.ic + q.ib), 1e-6, `${k}: the emitter pin carries Ic + Ib`);
  }
  // a small-signal part has none: its junctions are the pins
  const els = []; L.LIB.npn.build({ id: "q", params: { model: "2N3904" } }, pid => ({ C: 1, B: 2, E: 0 })[pid], () => { throw new Error("no inner node"); }, els);
  assert.deepEqual(els.map(e => e.id), ["q", "q#cbe", "q#cbc"]);
});

test("MOSFET: source follower with source resistor solves the square law", () => {
  const m = { pol: 1, vto: 3.8, kp: 0.9, lambda: 0 }, Vg = 100, Rs = 10e3;
  const r = E.simulate({ nodeCount: 4, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: 300 }, { id: "vg", kind: "V", nodes: [2, 0], v: Vg },
    { id: "m", kind: "MOS", nodes: [1, 2, 3], model: m }, { id: "rs", kind: "R", nodes: [3, 0], r: Rs }] });
  assert.ok(r.ok, r.error);
  // Id = Kp/2·(Vg − Id·Rs − Vto)²  ->  quadratic in Id
  const a = m.kp / 2 * Rs * Rs, b = -(m.kp * Rs * (Vg - m.vto) + 1), c = m.kp / 2 * (Vg - m.vto) ** 2;
  const id = (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  near(r.dc.devices.m.main.id, id, 1e-4, "Id");
  near(r.dc.nodes[3], id * Rs, 1e-4, "source voltage");
});

test("MOSFET: depletion part conducts at Vgs = 0, P-channel mirrors N-channel", () => {
  const dep = { pol: 1, vto: -2, kp: 0.15, lambda: 0 };
  const r = E.simulate({ nodeCount: 3, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: 100 }, { id: "rd", kind: "R", nodes: [1, 2], r: 1e5 },
    { id: "m", kind: "MOS", nodes: [2, 0, 0], model: dep }] });
  assert.ok(r.ok && r.dc.devices.m.main.id > 0.99e-3, "Vgs = 0 conducts (load-limited to ~1 mA)");
  const n = E.Semi.mos([50, 6, 0], { pol: 1, vto: 3, kp: 1, lambda: 0.01 }), p = E.Semi.mos([-50, -6, 0], { pol: -1, vto: -3, kp: 1, lambda: 0.01 });
  near(-p[0], n[0], 1e-12, "mirrored drain current");
});

test("terminal currents obey KCL at every node, also averaged over a rectifier's window", () => {
  const kcl = (cur, nodeCount) => { const s = new Array(nodeCount).fill(0); for (let k = 0; k < cur.length; k += 3) s[cur[k + 1]] += cur[k + 2]; return s; };
  // tube stage with a BJT follower
  const t = tube("12AX7"), bjt = { pol: 1, is: 1e-13, bf: 100, br: 4, nf: 1, vaf: 200, ikf: 0.3 };
  let r = E.simulate({ nodeCount: 5, elements: [{ id: "b", kind: "V", nodes: [1, 0], v: 300 }, { id: "ra", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "v", kind: "TRIODE", nodes: [2, 0, 3], model: t.koren.Triode }, { id: "rk", kind: "R", nodes: [3, 0], r: 1500 },
    { id: "q", kind: "BJT", nodes: [1, 2, 4], model: bjt }, { id: "re", kind: "R", nodes: [4, 0], r: 47e3 }] });
  assert.ok(r.ok, r.error);
  kcl(r.dc.currents, 5).slice(1).forEach((s, i) => assert.ok(Math.abs(s) < 1e-6, `node ${i + 1}: ${s} A`));
  // half-wave rectifier: the diode's average current equals the load's (the capacitor's averages to zero)
  r = E.simulate({ nodeCount: 3, elements: [{ id: "s", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 50, amp: 100, dcValue: 95 },
    { id: "d", kind: "D", nodes: [1, 2], is: 7e-9, n: 1.8 }, { id: "c", kind: "C", nodes: [2, 0], c: 100e-6 }, { id: "r", kind: "R", nodes: [2, 0], r: 10e3 }] }, { budgetMs: 20000 });
  assert.ok(r.ok && r.dcAveraged, r.error);
  const at = (id, node) => { for (let k = 0; k < r.dc.currents.length; k += 3) if (r.dc.currents[k] === id && r.dc.currents[k + 1] === node) return r.dc.currents[k + 2]; };
  near(at("d", 1), at("r", 2), 0.01, "average diode current = load current");
  near(at("r", 2), r.dc.nodes[2] / 10e3, 1e-6, "load current = average voltage / R");
});

test("loudspeaker (Thiele–Small): the simulated current matches the impedance formula; the resistor model stays a resistor", () => {
  if (!globalThis.CadLib) runInThisContext(readFileSync(new URL("../cad-components.js", import.meta.url), "utf8"), { filename: "cad-components.js" });
  const L = globalThis.CadLib, p = { ...L.SPEAKER_PRESETS[0], model: "ts" }, m = L.speakerTS(p);
  // closed form at resonance: Re + Res (+ the voice coil's jωLe)
  const w0 = 2 * Math.PI * p.fs, zfs = L.speakerZ(p, p.fs);
  near(zfs[0], Math.hypot(p.re + m.res, w0 * p.le), 1e-9, "|Z(fs)|");
  near(1 / Math.sqrt(m.lces * m.ces), w0, 1e-9, "motional resonance at fs");
  assert.ok(m.res > 40 && m.res < 60, `a guitar speaker peaks at a few tens of ohms (${(p.re + m.res).toFixed(0)} Ω)`);
  for (const f of [30, 80, 400, 6000]) {
    const els = [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: f, amp: 1 }];
    let n = 2; L.LIB.speaker.build({ id: "S", params: p }, pid => (pid === "+" ? 1 : 0), () => n++, els);
    const r = E.simulate({ nodeCount: n, elements: els }), inner = els.find(e => e.id === "S#re").nodes[1];
    assert.ok(r.ok, r.error);
    const i = Array.from(r.tran.nodes[1], (v, k) => (v - r.tran.nodes[inner][k]) / p.re);
    near(1 / (pp(i) / 2), L.speakerZ(p, f)[0], 0.02, `|Z| at ${f} Hz from the simulated current`);
  }
  const els = []; L.LIB.speaker.build({ id: "S", params: { ...p, model: "res" } }, pid => (pid === "+" ? 1 : 0), () => 99, els);
  assert.deepEqual(els.map(e => [e.kind, e.r]), [["R", 8]]);
  assert.deepEqual(L.speakerZ({ ...p, model: "res" }, 1000), [8, 0]);
});

test("sparse solver: the dense solver's answers; its WebAssembly kernel gives its JavaScript's bit for bit", () => {
  assert.equal(E.solver(), "wasm", "Node runs the WebAssembly kernel");
  let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5;
  const sys = (n, t) => {   // sparse, MNA-like: a strong diagonal (now and then none, as a voltage source's row), a few couplings, many decades
    const A = new Float64Array(n * n), b = new Float64Array(n);
    for (let i = 0; i < n; i++) { if ((i + t) % 7) A[i * n + i] = (1 + Math.abs(rnd())) * 10 ** Math.round(rnd() * 8); b[i] = rnd() * 100; for (let k = 0; k < 3; k++) A[i * n + ((i * 7 + k * 13 + t) % n)] += rnd() * 10 ** Math.round(rnd() * 6); }
    return [A, b];
  };
  for (const n of [1, 2, 3, 7, 16, 33, 66, 150, 300]) {
    for (let t = 0; t < 3; t++) {
      const [A, b] = sys(n, t), xd = b.slice();
      if (!E.solveLinear(A.slice(), xd, n)) continue;
      const solveWith = wasm => { E.useWasm(wasm); const M = new E.SparseMatrix(n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (A[i * n + j] !== 0) M.add(i, j, A[i * n + j]); const x = b.slice(); assert.ok(M.solve(x)); return x; };
      const xj = solveWith(false), xw = solveWith(true);
      assert.deepEqual(Array.from(xw), Array.from(xj), `n = ${n}: WebAssembly and JavaScript bit for bit`);
      // the residual of the sparse answer: as small as the dense one's
      let rs = 0, rd = 0, bn = 0;
      for (let i = 0; i < n; i++) { let a = 0, c = 0; for (let j = 0; j < n; j++) { a += A[i * n + j] * xj[j]; c += A[i * n + j] * xd[j]; } rs = Math.max(rs, Math.abs(a - b[i])); rd = Math.max(rd, Math.abs(c - b[i])); bn = Math.max(bn, Math.abs(b[i])); }
      assert.ok(rs <= 1e-9 * bn + 10 * rd, `n = ${n}: residual ${rs.toExponential(2)} (dense ${rd.toExponential(2)})`);
    }
  }
  // a singular matrix is reported; the pattern may grow between solves (a new position stamped)
  const S = new E.SparseMatrix(2); S.add(0, 0, 1); S.add(0, 1, 2); S.add(1, 0, 2); S.add(1, 1, 4);
  assert.equal(S.solve(new Float64Array([1, 2])), false);
  const G = new E.SparseMatrix(3); G.add(0, 0, 2); G.add(1, 1, 4); G.add(2, 2, 1);
  let x = new Float64Array([2, 4, 1]); assert.ok(G.solve(x)); assert.deepEqual(Array.from(x), [1, 1, 1]);
  G.clear(); G.add(0, 0, 2); G.add(1, 1, 4); G.add(2, 2, 1); G.add(0, 2, 1);
  x = new Float64Array([3, 4, 1]); assert.ok(G.solve(x)); assert.deepEqual(Array.from(x), [1, 1, 1]);
  assert.equal(E.useWasm(true), true); assert.equal(E.solver(), "wasm");
});

test("steady state by shooting: an RC far slower than the signal settles in a few periods, to the analytic answer", () => {
  // 1 kHz, 10 V peak through 1 kΩ into 100 µF with 100 kΩ across it: τ = (1 kΩ ∥ 100 kΩ) · 100 µF ≈ 0.1 s, a hundred periods
  const net = { nodeCount: 3, elements: [
    { id: "g", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 10, offset: 0, phase: 0 },
    { id: "r1", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "c", kind: "C", nodes: [2, 0], c: 100e-6 },
    { id: "r2", kind: "R", nodes: [2, 0], r: 100e3 }] };
  const r = E.simulate(net, { budgetMs: 60000 });
  assert.ok(r.ok && r.tran.settled && r.shooting && r.shooting.converged, JSON.stringify(r.shooting));
  assert.ok(r.tran.periods < 30, `${r.tran.periods} periods`);
  // linear: the capacitor's average is 0 V, its swing 10 V / |1 + jωRC| (ωRC = 628)
  const v = r.tran.nodes[2]; let mn = Infinity, mx = -Infinity, avg = 0; for (const a of v) { mn = Math.min(mn, a); mx = Math.max(mx, a); avg += a / v.length; }
  const pp = 2 * 10 / Math.hypot(1, 2 * Math.PI * 1000 * 1000 * 100e-6);
  // the average carries the backward-Euler start's small bias (about 1 mV here, on a 1 V scale), as the plain settling does
  assert.ok(Math.abs(avg) < 2e-3 && Math.abs((mx - mn) / pp - 1) < 1e-3, `average ${avg.toExponential(2)} V, swing ${(mx - mn).toFixed(6)} V (expected ${pp.toFixed(6)})`);
});

// --- AC analysis (acSweep) ---------------------------------------------------------------------
test("AC analysis: an RC low-pass is −3.01 dB and −45° at its corner, and the second-order LC shows its Q", () => {
  const rc = E.acSweep({ nodeCount: 3, elements: [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "R", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C", kind: "C", nodes: [2, 0], c: 1 / (2 * Math.PI * 1000 * 1000) }] },
    { inputs: [{ id: "G" }], fStart: 100, fStop: 10000, perDecade: 10, probes: [[2, 0]] });
  const k = 10, H = Math.hypot(rc.probes[0].re[k], rc.probes[0].im[k]);
  near(rc.freqs[k], 1000, 1e-9, "the sweep lands on 1 kHz");
  near(20 * Math.log10(H), -3.0103, 1e-4, "gain at the corner (dB)");
  near(Math.atan2(rc.probes[0].im[k], rc.probes[0].re[k]) * 180 / Math.PI, -45, 1e-6, "phase at the corner");
  // series R–L–C, output across C: at f0 the gain is Q = sqrt(L/C)/R
  const L = 10e-3, C = 1e-6, R = 10, f0 = 1 / (2 * Math.PI * Math.sqrt(L * C));
  const lc = E.acSweep({ nodeCount: 4, elements: [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "R", kind: "R", nodes: [1, 2], r: R }, { id: "L", kind: "L", nodes: [2, 3], l: L }, { id: "C", kind: "C", nodes: [3, 0], c: C }] },
    { inputs: [{ id: "G" }], fStart: f0, fStop: f0 * 10, perDecade: 10 });
  near(Math.hypot(lc.re[3][0], lc.im[3][0]), Math.sqrt(L / C) / R, 1e-4, "LC peak = Q");
});

test("AC analysis: a 12AX7 stage's gain matches the transient, and the Miller capacitance sets its top corner", () => {
  const AX7 = tube("12AX7").koren.Triode, caps = tube("12AX7").caps.triode;
  const net = rs => ({ nodeCount: 6, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 250 }, { id: "RA", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "G", kind: "VSRC", nodes: [5, 0], wave: "sine", freq: 1000, amp: 0.01 }, { id: "RS", kind: "R", nodes: [5, 3], r: rs },
    { id: "RK", kind: "R", nodes: [4, 0], r: 1500 }, { id: "CK", kind: "C", nodes: [4, 0], c: 1e-3 }, { id: "RG", kind: "R", nodes: [3, 0], r: 1e9 },
    { id: "V1", kind: "TRIODE", nodes: [2, 3, 4], model: AX7 },
    { id: "CGK", kind: "C", nodes: [3, 4], c: caps.cgk }, { id: "CGA", kind: "C", nodes: [3, 2], c: caps.cga }, { id: "CAK", kind: "C", nodes: [2, 4], c: caps.cak }] });
  const ac = E.acSweep(net(100e3), { inputs: [{ id: "G" }], fStart: 1000, fStop: 1e6, perDecade: 200 });
  const g = ac.freqs.map((f, k) => Math.hypot(ac.re[2][k], ac.im[2][k])), A = g[0];
  const tr = E.simulate(net(100e3), {});
  near(A, pp(tr.tran.nodes[2]) / 0.02, 0.01, "small-signal gain at 1 kHz vs the transient's");
  // single pole of the source resistance and the input capacitance Cgk + (1 + A)·Cga
  const f3 = ac.freqs[g.findIndex(v => v < A / Math.SQRT2)], fMiller = 1 / (2 * Math.PI * 100e3 * (caps.cgk + (1 + A) * caps.cga));
  near(f3, fMiller, 0.12, "−3 dB corner vs the Miller estimate");
});

test("tube database: every amplifier tube has interelectrode capacitances, from its datasheet or its analog's where known", () => {
  for (const t of globalThis.TUBE_DATABASE) {
    if (t.category === "rectifier") continue;
    const c = t.caps.triode;
    assert.ok(c && c.cgk > 0 && c.cga > 0 && c.cak > 0, `${t.commonName}: triode capacitances`);
    if (t.koren.Pentode) assert.ok(t.caps.pentode.cin > 0 && t.caps.pentode.cout > 0, `${t.commonName}: pentode capacitances`);
  }
  assert.equal(tube("12AX7").caps.source, "RCA 12AX7A");
  assert.match(tube("6P14P").caps.source, /as EL84/);
  near(tube("EL84").caps.pentode.cin, 10.8e-12, 1e-9, "EL84 input capacitance");
});

test("animation frames: every element's terminal currents over one signal period; a capacitor's from C·dV/dt", () => {
  // 1 kHz sine through 1 kΩ into 1 µF: in series, the capacitor carries the resistor's current at every instant
  const r = E.simulate({ nodeCount: 3, elements: [{ id: "g", kind: "VSRC", nodes: [1, 0], wave: "sine", amp: 1, freq: 1000 },
    { id: "r", kind: "R", nodes: [1, 2], r: 1000 }, { id: "c", kind: "C", nodes: [2, 0], c: 1e-6 }] }, { frameSpan: 1e-3 });
  assert.ok(r.ok, r.error);
  const F = r.tran.frames, at = (id, node) => { for (let k = 0; k < F.layout.length; k += 3) if (F.layout[k] === id && F.layout[k + 1] === node) return k / 3; return -1; };
  assert.ok(F.cur.length >= 100 && F.cur.length <= 120, `${F.cur.length} frames`);
  const span = (F.at[F.at.length - 1] - F.at[0]) * r.tran.dt;
  assert.ok(span > 0.95e-3 && span <= 1e-3, `frames over one period (${(span * 1e3).toFixed(3)} ms)`);
  const ir = at("r", 2), ic = at("c", 2), peak = Math.max(...F.cur.map(v => Math.abs(v[ir])));
  // |Z| = √(1k² + (1/2π·1k·1µ)²) = 1.0126 kΩ: 0.9876 mA peak
  near(peak, 1 / Math.hypot(1000, 1 / (2 * Math.PI * 1000 * 1e-6)), 0.02, "peak current");
  F.cur.forEach((v, j) => assert.ok(Math.abs(v[ic] + v[ir]) < 0.04 * peak, `frame ${j}: into C ${v[ic]}, out of R ${-v[ir]}`));
});

// NE555: the CAD's build (cad-components.js timer555): the element on GND, TRIG, OUT, RESET, CV, THR, DIS,
// VCC and the divider's lower tap, with the divider, supply current and reset pull-up as resistors
function ne555(nodes, lo, id) {
  const [g, , , rst, cv, , , vcc] = nodes;
  return [{ id, kind: "TIMER555", nodes: [...nodes, lo] },
    { id: id + "#d1", kind: "R", nodes: [vcc, cv], r: 5e3 }, { id: id + "#d2", kind: "R", nodes: [cv, lo], r: 5e3 }, { id: id + "#d3", kind: "R", nodes: [lo, g], r: 5e3 },
    { id: id + "#iq", kind: "R", nodes: [vcc, g], r: 1.7e3 }, { id: id + "#rst", kind: "R", nodes: [vcc, rst], r: 33e3 }];
}
// nodes: 1 VCC, 2 DIS, 3 THR/TRIG, 4 OUT, 5 CV, 6 lower tap, 7 RESET
const astable555 = (r1, r2, c, vcc, extra) => ({ nodeCount: 8, elements: [
  { id: "V1", kind: "V", nodes: [1, 0], v: vcc }, { id: "R1", kind: "R", nodes: [1, 2], r: r1 }, { id: "R2", kind: "R", nodes: [2, 3], r: r2 },
  { id: "C1", kind: "C", nodes: [3, 0], c }, { id: "RL", kind: "R", nodes: [4, 0], r: 10e3 }, ...ne555([0, 3, 4, 7, 5, 3, 2, 1], 6, "U1"), ...(extra || [])] });
// rising and falling crossings of level in a sampled wave, interpolated
function crossings(w, dt, level) {
  const up = [], dn = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const at = (i + (level - w[i]) / (w[i + 1] - w[i])) * dt;
    if (w[i] < level && w[i + 1] >= level) up.push(at); else if (w[i] >= level && w[i + 1] < level) dn.push(at);
  }
  return { up, dn };
}

test("NE555 astable: high and low times are the exact RC charge between ⅓ and ⅔ VCC, whatever the step", () => {
  const R1 = 10e3, R2 = 100e3, C = 1e-6, VCC = 9;
  const run = tStop => {
    const r = E.startup(astable555(R1, R2, C, VCC), { tStop, probes: [[4, 0], [3, 0]], maxPoints: 1e6 });
    assert.ok(r.ok, r.error);
    const { up, dn } = crossings(Array.from(r.max[0]), r.dt, VCC / 2), n = up.length;
    const d = dn.find(x => x > up[n - 2]);
    return { high: d - up[n - 2], low: up[n - 1] - d, cmin: Math.min(...Array.from(r.min[1]).slice(r.points / 2)), cmax: Math.max(...Array.from(r.max[1]).slice(r.points / 2)) };
  };
  const a = run(1), b = run(3);   // steps of 50 µs and 150 µs
  // charging through R1 + R2 towards VCC; discharging through R2 into DIS, which sinks R1's 0.9 mA too (12 Ω: 11 mV)
  const vs = VCC / R1 * 12;
  near(a.high, (R1 + R2) * C * Math.log((VCC - VCC / 3) / (VCC - 2 * VCC / 3)), 0.002, "high time");
  near(a.low, R2 * C * Math.log((2 * VCC / 3 - vs) / (VCC / 3 - vs)), 0.003, "low time");
  near(a.cmin, 3, 0.002, "capacitor valley (⅓ VCC)"); near(a.cmax, 6, 0.002, "capacitor peak (⅔ VCC)");
  near(b.high + b.low, a.high + a.low, 0.0005, "period with a three times longer step");
});

test("NE555 free-running with no source: the steady-state run finds its period, however slow, and captures whole cycles", () => {
  const R1 = 10e3, R2 = 100e3, VCC = 9, vs = VCC / R1 * 12;
  for (const C of [1e-9, 1e-6, 10e-6]) {   // about 69 kHz, 6.9 Hz, 0.69 Hz
    const T = (R1 + R2) * C * Math.log(2) + R2 * C * Math.log((2 * VCC / 3 - vs) / (VCC / 3 - vs));
    const r = E.simulate(astable555(R1, R2, C, VCC), { budgetMs: 2500 });
    assert.ok(r.ok, r.error);
    near(1 / r.tran.fBase, T, 0.01, `period with C = ${C}`);
    const span = r.tran.samples * r.tran.dt, { up } = crossings(Array.from(r.tran.nodes[4]), r.tran.dt, VCC / 2);
    assert.ok(span >= 3 * T * 0.99 && up.length >= 3, `${span} s captured, ${up.length} rising edges`);
    near((up[up.length - 1] - up[0]) / (up.length - 1), T, 0.01, `cycle in the capture with C = ${C}`);
    // the DC values are the averages over the cycle: OUT high a little over half the time
    assert.ok(r.dcAveraged && r.dc.nodes[4] > 0.4 * VCC && r.dc.nodes[4] < 0.75 * VCC, `OUT averages ${r.dc.nodes[4]} V`);
    assert.equal(r.tran.frames.cur.length, 120, "animation frames over one cycle");
  }
});

test("NE555 one-shot triggered by a pulse train: 1.1·R·C pulses, the latch carried through the steady state", () => {
  // nodes: 1 VCC, 2 THR/DIS (timing), 3 TRIG, 4 OUT, 5 CV, 6 tap, 7 RESET, 8 generator, 9 behind its 50 Ω
  const R = 47e3, C = 100e-9;
  const nl = { nodeCount: 10, elements: [
    { id: "V1", kind: "V", nodes: [1, 0], v: 9 }, { id: "R1", kind: "R", nodes: [1, 2], r: R }, { id: "C1", kind: "C", nodes: [2, 0], c: C },
    { id: "R5", kind: "R", nodes: [1, 3], r: 10e3 }, { id: "C4", kind: "C", nodes: [9, 3], c: 100e-9 }, { id: "RL", kind: "R", nodes: [4, 0], r: 8.1e3 },
    { id: "G2", kind: "VSRC", nodes: [8, 0], wave: "square", freq: 50, amp: 4.5, offset: 4.5, phase: 0 }, { id: "G2#rs", kind: "R", nodes: [9, 8], r: 50 },
    ...ne555([0, 3, 4, 7, 5, 2, 2, 1], 6, "U1")] };
  const r = E.simulate(nl, { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  assert.ok(r.tran.settled, "settled");
  const w = Array.from(r.tran.nodes[4]), { up, dn } = crossings(w, r.tran.dt, 3.8);
  assert.equal(up.length, Math.round(r.tran.samples * r.tran.dt * 50), "one pulse a period");
  // the captured samples (33 µs apart) place each edge within a step
  up.forEach(u => near(dn.find(x => x > u) - u, R * C * Math.log(3), 0.015, "pulse width in the steady state"));
  // the power-on run, 5 µs steps, finds it exactly
  const p = E.startup(nl, { tStop: 0.1, probes: [[4, 0]], maxPoints: 1e6 }), e = crossings(Array.from(p.max[0]), p.dt, 3.8);
  assert.ok(p.ok, p.error);
  e.up.slice(1, -1).forEach(u => near(e.dn.find(x => x > u) - u, R * C * Math.log(3), 0.002, "pulse width (R·C·ln 3)"));
  // at rest the output is low and the discharge holds C1 empty
  const dc = E.simulate(Object.assign({}, nl, { elements: nl.elements.filter(e => e.kind !== "VSRC").concat([{ id: "G2", kind: "V", nodes: [8, 0], v: 9 }]) }), {});
  assert.ok(dc.ok && dc.dc.devices.U1.main.q === 0 && dc.dc.nodes[2] < 0.05, "a one-shot at rest is reset, its capacitor empty");
});

test("NE555 output stages against the TI data: 13.3 V sourcing 100 mA from 15 V, 0.4 V sinking 50 mA; reset stops it", () => {
  // TRIG at 0 V sets it (output high, 133 Ω load); TRIG and THR at VCC reset it (300 Ω to VCC)
  const stage = (trig, load) => ({ nodeCount: 8, elements: [{ id: "V1", kind: "V", nodes: [1, 0], v: 15 }, { id: "T", kind: "R", nodes: [trig, 3], r: 1 },
    load, ...ne555([0, 3, 4, 7, 5, 3, 2, 1], 6, "U1")] });
  const hi = E.simulate(stage(0, { id: "RL", kind: "R", nodes: [4, 0], r: 133 }), {}), lo = E.simulate(stage(1, { id: "RL", kind: "R", nodes: [4, 1], r: 300 }), {});
  assert.ok(hi.ok && lo.ok);
  near(hi.dc.nodes[4], 13.3, 0.01, "VOH at 100 mA");
  near(lo.dc.nodes[4], 0.4, 0.15, "VOL at 50 mA");
  // RESET tied low: an astable stays reset (output low)
  const held = E.startup(astable555(1e3, 10e3, 100e-9, 9, [{ id: "RS", kind: "R", nodes: [7, 0], r: 10 }]), { tStop: 0.01, probes: [[4, 0]], maxPoints: 1e5 });
  assert.ok(held.ok && Math.max(...Array.from(held.max[0])) < 0.05, "held in reset");
  // the frequency response linearizes the stage at its state
  const ac = E.acSweep(astable555(1e3, 10e3, 100e-9, 9), { fStart: 10, fStop: 1e4, probes: [[4, 0]] });
  assert.ok(ac.ok, ac.error);
});

// --- output transformers: leakage and a saturating core ----------------------------------------
test("transformer leakage: the treble rolls off as the closed form of the leakage in series with source and load", () => {
  const Z = 5000, n = Math.sqrt(Z / 8), Lm = 20, Llk = 0.05;
  const ac = E.acSweep({ nodeCount: 4, elements: [
    { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "RS", kind: "R", nodes: [1, 2], r: Z },
    { id: "T", kind: "XFMR", nodes: [], lp: Lm, k: 1, primaryTurns: 1, windings: [{ a: 2, b: 0, turns: 1, leak: Llk }, { a: 3, b: 0, turns: 1 / n }] },
    { id: "RL", kind: "R", nodes: [3, 0], r: 8 }] }, { inputs: [{ id: "G" }], fStart: 10, fStop: 100e3, perDecade: 10 });
  // referred to the primary: Lm across the load Z, the leakage in series ahead of them
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  ac.freqs.forEach((f, k) => {
    const w = 2 * Math.PI * f, zm = cdiv([0, w * Lm * Z], [Z, w * Lm]), h = cdiv(zm, [Z + zm[0], w * Llk + zm[1]]);
    near(Math.hypot(ac.re[3][k], ac.im[3][k]) * n, Math.hypot(h[0], h[1]), 1e-6, `|H| at ${f.toFixed(0)} Hz`);
  });
});

test("transformer core: a sine driven past the knee draws the magnetising current of the flux curve", () => {
  const sat = { ls: 0.5, p: 4, air: 0.01 }, Lm = 10, f = 50, w = 2 * Math.PI * f;
  const e = { lp: Lm, sat }, flux = i => E.coreFlux(e, i)[0];
  for (const lpk of [0.3, 0.6, 0.75]) {
    const r = E.simulate({ nodeCount: 4, elements: [
      // starting at the voltage's peak, so the flux swings evenly about zero from the first cycle
      { id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: f, amp: lpk * w, phase: 90 }, { id: "RI", kind: "R", nodes: [1, 2], r: 0.01 },
      { id: "T", kind: "XFMR", nodes: [], lp: Lm, k: 1, primaryTurns: 1, sat, windings: [{ a: 2, b: 0, turns: 1, leak: 1e-6 }, { a: 3, b: 0, turns: 0.1 }] },
      { id: "RL", kind: "R", nodes: [3, 0], r: 1e6 }] }, { budgetMs: 4000 });
    assert.ok(r.ok, r.error);
    // the current's peak from the drop on RI; the flux curve inverted by bisection
    const ipk = pp(r.tran.nodes[1].map((v, k) => v - r.tran.nodes[2][k])) / 2 / 0.01;
    let lo = 0, hi = 100; for (let k = 0; k < 100; k++) { const m = (lo + hi) / 2; if (flux(m) < lpk) lo = m; else hi = m; }
    near(ipk, lo, 0.03, `peak magnetising current at ${lpk} V·s`);
    near(Math.max(...r.tran.devices.T.i), lpk / sat.ls, 0.03, "the flux trace, as a share of the knee");
  }
});

test("transformer core: DC in a single-ended primary lowers the small-signal inductance the bass sees", () => {
  const Z = 2500, n = Math.sqrt(Z / 8), Lm = 20, Llk = 0.02, sat = { ls: 4, p: 4, air: 0.01 }, idc = 0.12;
  const net = { nodeCount: 6, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 300 }, { id: "I", kind: "I", nodes: [2, 0], i: idc },
    { id: "T", kind: "XFMR", nodes: [], lp: Lm, k: 1, primaryTurns: 1, sat, windings: [{ a: 1, b: 2, turns: 1, leak: Llk }, { a: 3, b: 0, turns: 1 / n }] },
    { id: "RL", kind: "R", nodes: [3, 0], r: 8 },
    { id: "G", kind: "VSRC", nodes: [4, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "RS", kind: "R", nodes: [4, 5], r: Z }, { id: "CB", kind: "C", nodes: [5, 2], c: 1 }] };
  const ac = E.acSweep(net, { inputs: [{ id: "G" }], fStart: 10, fStop: 1000, perDecade: 10 });
  const ld = E.coreFlux({ lp: Lm, sat }, -idc)[1];
  assert.ok(ld < 0.9 * Lm, `the slope at ${idc * 1000} mA (${ld.toFixed(1)} H) is below the ${Lm} H at zero`);
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  ac.freqs.forEach((f, k) => {
    const w = 2 * Math.PI * f, zm = cdiv([0, w * ld * Z], [Z, w * ld]), zp = [zm[0], zm[1] + w * Llk], cb = [0, -1 / w];
    const zs = [Z + cb[0], cb[1]], v2 = cdiv(zp, [zs[0] + zp[0], zs[1] + zp[1]]), h = cdiv([v2[0] * zm[0] - v2[1] * zm[1], v2[0] * zm[1] + v2[1] * zm[0]], zp);
    near(Math.hypot(ac.re[3][k], ac.im[3][k]) * n, Math.hypot(h[0], h[1]), 1e-4, `|H| at ${f.toFixed(0)} Hz`);
  });
});
