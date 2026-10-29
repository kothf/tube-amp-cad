/**
 * Every transistor in the library against its datasheet (cad-components.js BJTS, MOSFETS, JFETS;
 * board-core.js PINOUT): the gain at the datasheet's test points, VBE(on) under its maximum, the
 * ratings, the MOSFETs' typical transfer curve, the JFETs' IDSS, cut-off and on-resistance, the
 * capacitances and the pin order (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, B = globalThis.BoardCore;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const pf = 1e-12;

// a BJT with its collector at vce and its base driven by a voltage: { ic, ib } at a base voltage
function bjtAt(k, vce, vb) {
  const pol = L.BJTS[k].pol, els = [{ id: "vc", kind: "V", nodes: [1, 0], v: pol * vce }, { id: "vb", kind: "V", nodes: [2, 0], v: pol * vb }];
  let n = 3;
  L.LIB[pol > 0 ? "npn" : "pnp"].build({ id: "q", params: { model: k } }, pid => ({ C: 1, B: 2, E: 0 })[pid], () => n++, els);
  return E.simulate({ nodeCount: n, elements: els }).dc.devices.q.main;
}
// the base voltage that gives ic; the static gain IC/IB there and the small-signal one dIC/dIB
function bjtPoint(k, ic, vce) {
  let lo = 0, hi = 4;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (bjtAt(k, vce, m).ic < ic) lo = m; else hi = m; }
  const q = bjtAt(k, vce, lo), q2 = bjtAt(k, vce, lo + 1e-4);
  return { vbe: lo, hfe: q.ic / q.ib, h21: (q2.ic - q.ic) / (q2.ib - q.ib) };
}
// a MOSFET or JFET with its drain at vds: the drain current at a gate voltage, and the gate voltage for id
function fetAt(k, vds, vg) {
  const m = L.MOSFETS[k] || L.JFETS[k], pol = m.pol, type = L.JFETS[k] ? (pol > 0 ? "njf" : "pjf") : (pol > 0 ? "nmos" : "pmos");
  const els = [{ id: "vd", kind: "V", nodes: [1, 0], v: pol * vds }, { id: "vg", kind: "V", nodes: [2, 0], v: pol * vg }];
  let n = 3;
  L.LIB[type].build({ id: "q", params: { model: k } }, pid => ({ D: 1, G: 2, S: 0 })[pid], () => n++, els);
  const r = E.simulate({ nodeCount: n, elements: els }), c = r.dc.currents;
  for (let j = 0; j < c.length; j += 3) if (c[j] === "vd") return Math.abs(c[j + 2]);
  return NaN;
}
function vgsFor(k, id, vds) {
  let lo = -20, hi = 20;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (fetAt(k, vds, m) < id) lo = m; else hi = m; }
  return lo;
}

// The datasheets (maker in brackets). hfe: [IC A, VCE V, min, max] (max null: none given), the static
// IC/IB, or with "h21" the small-signal gain the USSR reference books give; vbe: [IC A, VCE V, max V];
// v (VCEO), i (IC max), p (Ptot), cob (Cob, pF, the typical or the maximum), pins (pad 1 first).
const BJT_DATA = {
  "2N2222A": { hfe: [[0.15, 10, 100, 300], [0.01, 10, 75, null]], v: 40, i: 0.8, p: 0.5, pins: "EBC" },   // Central, onsemi
  "2N3904": { hfe: [[0.01, 1, 100, 300], [0.1, 1, 30, null]], v: 40, i: 0.2, p: 0.625, pins: "EBC" },  // onsemi
  "BC107": { hfe: [[0.002, 5, 110, 450]], vbe: [0.002, 5, 0.7], v: 45, i: 0.2, p: 0.3, pins: "EBC" },  // Central
  "BC547B": { hfe: [[0.002, 5, 200, 450]], vbe: [0.002, 5, 0.7], v: 45, i: 0.1, p: 0.625, pins: "CBE" },  // onsemi
  "BD139": { hfe: [[0.15, 2, 40, 250], [0.5, 2, 25, null]], vbe: [0.5, 2, 1.0], v: 80, i: 1.5, p: 12.5, pins: "ECB" },  // onsemi
  "MPSA42": { hfe: [[0.01, 10, 40, null], [0.03, 10, 40, null]], v: 300, i: 0.5, p: 0.625, pins: "EBC" },  // onsemi
  "MJE340": { hfe: [[0.05, 10, 30, 240]], v: 300, i: 0.5, p: 20, pins: "ECB" },  // onsemi
  "2N2907A": { hfe: [[0.15, 10, 100, 300], [0.5, 10, 50, null]], v: 60, i: 0.6, p: 0.4, pins: "EBC" },  // onsemi
  "2N3906": { hfe: [[0.01, 1, 100, 300], [0.05, 1, 60, null], [0.1, 1, 30, null]], v: 40, i: 0.2, p: 0.625, pins: "EBC" },  // onsemi
  "BC177": { hfe: [[0.002, 5, 120, 460]], vbe: [0.002, 5, 0.75], v: 45, i: 0.2, p: 0.3, pins: "EBC" },  // CDIL
  "BC557B": { hfe: [[0.002, 5, 180, 460]], vbe: [0.002, 5, 0.7], v: 45, i: 0.1, p: 0.625, pins: "CBE" },  // onsemi
  "BD140": { hfe: [[0.15, 2, 40, 250], [0.5, 2, 25, null]], vbe: [0.5, 2, 1.0], v: 80, i: 1.5, p: 12.5, pins: "ECB" },  // onsemi
  "MPSA92": { hfe: [[0.01, 10, 40, null], [0.03, 10, 25, null]], v: 300, i: 0.5, p: 0.625, pins: "EBC" },  // onsemi
  "MJE350": { hfe: [[0.05, 10, 30, 240]], v: 300, i: 0.5, p: 20, pins: "ECB" },  // onsemi
  "2SD669A": { hfe: [[0.15, 5, 60, 200], [0.5, 5, 30, null]], vbe: [0.15, 5, 1.5], v: 160, i: 1.5, p: 20, cob: 14, pins: "ECB" },  // Hitachi
  "2SB649A": { hfe: [[0.15, 5, 60, 200], [0.5, 5, 30, null]], vbe: [0.15, 5, 1.5], v: 160, i: 1.5, p: 20, cob: 27, pins: "ECB" },  // Hitachi
  "2SC4793": { hfe: [[0.1, 5, 100, 320]], vbe: [0.5, 5, 1.0], v: 230, i: 1, p: 20, cob: 20, pins: "BCE" },  // Toshiba
  "2SA1837": { hfe: [[0.1, 5, 100, 320]], vbe: [0.5, 5, 1.0], v: 230, i: 1, p: 20, cob: 30, pins: "BCE" },  // Toshiba
  "MJE15032": { hfe: [[0.5, 2, 70, null], [1, 2, 50, null], [2, 2, 10, null]], vbe: [1, 5, 1.0], v: 250, i: 8, p: 50, pins: "BCE" },  // onsemi
  "MJE15033": { hfe: [[0.5, 2, 70, null], [1, 2, 50, null], [2, 2, 10, null]], vbe: [1, 5, 1.0], v: 250, i: 8, p: 50, pins: "BCE" },  // onsemi
  "TIP41C": { hfe: [[0.3, 4, 30, null], [3, 4, 15, 75]], vbe: [6, 4, 2.0], v: 100, i: 6, p: 65, pins: "BCE" },  // onsemi
  "TIP42C": { hfe: [[0.3, 4, 30, null], [3, 4, 15, 75]], vbe: [6, 4, 2.0], v: 100, i: 6, p: 65, pins: "BCE" },  // onsemi
  "2SC5200": { hfe: [[1, 5, 80, 160], [7, 5, 35, null]], v: 230, i: 15, p: 150, cob: 200, pins: "BCE" },  // Toshiba
  "2SA1943": { hfe: [[1, 5, 80, 160], [7, 5, 35, null]], v: 230, i: 15, p: 150, cob: 360, pins: "BCE" },  // Toshiba
  "MJL3281A": { hfe: [[0.5, 5, 75, 150], [1, 5, 75, 150], [3, 5, 75, 150], [5, 5, 75, 150], [8, 5, 45, null]], v: 260, i: 15, p: 200, cob: 600, pins: "BCE" },  // onsemi
  "MJL1302A": { hfe: [[0.5, 5, 75, 150], [1, 5, 75, 150], [3, 5, 75, 150], [5, 5, 75, 150], [8, 5, 45, null]], v: 260, i: 15, p: 200, cob: 600, pins: "BCE" },  // onsemi
  "MJL21194": { hfe: [[8, 5, 25, 75]], vbe: [8, 5, 2.2], v: 250, i: 16, p: 200, cob: 500, pins: "BCE" },  // onsemi
  "MJL21193": { hfe: [[8, 5, 25, 75]], vbe: [8, 5, 2.2], v: 250, i: 16, p: 200, cob: 500, pins: "BCE" },  // onsemi
  "MJ15003": { hfe: [[5, 2, 25, 150]], vbe: [5, 2, 2.0], v: 140, i: 20, p: 250, cob: 1000, pins: "BEC" },  // onsemi
  "MJ15004": { hfe: [[5, 2, 25, 150]], vbe: [5, 2, 2.0], v: 140, i: 20, p: 250, cob: 1000, pins: "BEC" },  // onsemi
  "MJ15024": { hfe: [[8, 4, 15, 60]], vbe: [8, 4, 2.2], v: 250, i: 16, p: 250, cob: 500, pins: "BEC" },  // onsemi
  "MJ15025": { hfe: [[8, 4, 15, 60]], vbe: [8, 4, 2.2], v: 250, i: 16, p: 250, cob: 600, pins: "BEC" },  // onsemi
  "2N3055": { hfe: [[4, 4, 20, 70]], vbe: [4, 4, 1.5], v: 60, i: 15, p: 115, pins: "BEC" },  // onsemi
  "MJ2955": { hfe: [[4, 4, 20, 70]], vbe: [4, 4, 1.5], v: 60, i: 15, p: 115, pins: "BEC" },  // onsemi
  // germanium: the USSR reference tables (h21э small-signal), Valvo, Siemens, Telefunken, Central
  "MP39B": { h21: [[0.001, 5, 20, 60]], v: 15, i: 0.02, p: 0.15, cob: 50 },
  "MP40A": { h21: [[0.001, 5, 20, 40]], v: 30, i: 0.02, p: 0.15, cob: 50 },
  "MP41A": { h21: [[0.001, 5, 50, 100]], v: 15, i: 0.02, p: 0.15, cob: 50 },
  "MP42B": { h21: [[0.01, 1, 58, 100]], v: 15, i: 0.15, p: 0.2 },
  "MP25B": { h21: [[0.0025, 20, 30, 80]], v: 40, p: 0.2, cob: 20 },
  "MP26B": { h21: [[0.0015, 35, 30, 80]], v: 70, p: 0.2, cob: 15 },
  "MP38A": { h21: [[0.001, 5, 45, 100]], v: 15, i: 0.02, p: 0.15 },
  "GT402G": { h21: [[0.003, 1, 60, 150]], v: 40, i: 0.5, p: 0.6 },
  "GT404G": { h21: [[0.003, 1, 60, 150]], v: 40, i: 0.5, p: 0.6 },
  "P213B": { h21: [[0.2, 5, 40, null]], v: 45, i: 5, p: 10 },
  "AC127": { hfe: [[0.5, 1, 50, null]], v: 12, i: 0.5, p: 0.34 },
  "AC128": { hfe: [[0.3, 1, 63, 117], [1, 1, 56, 104]], v: 16, i: 1 },   // typical 90 at 0.3 A, 80 at 1 A, ±30 %
  "AC187": { hfe: [[0.3, 1, 100, 500]], v: 15 },
  "AC188": { hfe: [[0.3, 1, 100, 500]], v: 15 },
  "OC71": { hfe: [[0.001, 5, 30, null]], v: 20, i: 0.01, p: 0.125 },
  "NKT275": {},   // no maker's sheet survives (Newmarket; the AC125 stands in for it)
  "2N404": { v: 24, i: 0.1, p: 0.15, pins: "EBC" },
  "AD149": { hfe: [[1, 2, 30, 100], [3, 2, 20, 85]], v: 30, i: 3.5 },
  "AD161": { hfe: [[0.05, 1, 50, 350], [0.5, 1, 50, 350]], vbeR: [[0.005, 1, 0.1, 0.14], [0.05, 1, 0, 0.3], [0.5, 1, 0, 0.65], [2, 1, 0, 1.3]], v: 20, i: 3, p: 4 },
  "AD162": { hfe: [[0.05, 1, 50, 350], [0.5, 1, 50, 350]], vbeR: [[0.005, 1, 0.1, 0.14], [0.05, 1, 0, 0.3], [0.5, 1, 0, 0.65], [2, 1, 0, 1.3]], v: 20, i: 3, p: 6 }
};

test("every BJT in the library has its datasheet here", () => {
  assert.deepEqual(Object.keys(L.BJTS).sort(), Object.keys(BJT_DATA).sort());
});

for (const [k, d] of Object.entries(BJT_DATA)) {
  test(`${k}: gain, VBE, ratings, Cob and pins against the datasheet`, () => {
    const m = L.BJTS[k];
    for (const [ic, vce, lo, hi] of d.hfe || []) {
      const h = bjtPoint(k, ic, vce).hfe;
      assert.ok(h >= lo && (hi == null || h <= hi), `${k} hFE at ${ic} A, ${vce} V: ${h.toFixed(1)}, datasheet ${lo}–${hi ?? "…"}`);
    }
    for (const [ic, vce, lo, hi] of d.h21 || []) {
      const h = bjtPoint(k, ic, vce).h21;
      assert.ok(h >= lo && (hi == null || h <= hi), `${k} h21e at ${ic} A, ${vce} V: ${h.toFixed(1)}, datasheet ${lo}–${hi ?? "…"}`);
    }
    if (d.vbe) { const [ic, vce, max] = d.vbe, v = bjtPoint(k, ic, vce).vbe; assert.ok(v <= max, `${k} VBE at ${ic} A: ${v.toFixed(3)} V, datasheet max ${max} V`); }
    for (const [ic, vce, lo, hi] of d.vbeR || []) { const v = bjtPoint(k, ic, vce).vbe; assert.ok(v >= lo && v <= hi, `${k} VBE at ${ic} A: ${v.toFixed(3)} V, datasheet ${lo}–${hi} V`); }
    for (const f of ["v", "i", "p"]) if (d[f] != null) assert.equal(m[f], d[f], `${k} ${f}`);
    if (d.cob != null) assert.ok(m.cbc <= d.cob * pf * 1.001, `${k} CBC ${m.cbc / pf} pF, datasheet Cob ${d.cob} pF`);
    if (d.pins) assert.equal(B.PINOUT[k][0], d.pins, `${k} pin order`);
  });
}

test("the power parts with base and emitter resistance read 0.7 of the datasheet's VBE(on) maximum", () => {
  for (const k of ["TIP41C", "TIP42C", "MJL21194", "MJL21193", "2N3055", "MJ2955"]) {
    const [ic, vce, max] = BJT_DATA[k].vbe, v = bjtPoint(k, ic, vce).vbe;
    assert.ok(Math.abs(v - 0.7 * max) <= 0.02 * 0.7 * max, `${k} VBE ${v.toFixed(3)} V at ${ic} A, expected ${(0.7 * max).toFixed(2)} V`);
  }
});

// MOSFETs: VGS at drain currents read off the typical transfer curve (25 °C, the datasheet's VDS),
// within 0.3 V; v (VDSS), i (ID at 25 °C), p; cgs = Ciss − Crss and cgd = Crss (pF, typical); pins
const MOS_DATA = {
  "2N7000": { v: 60, i: 0.2, p: 0.4, pins: "SGD" },  // onsemi
  "BS170": { v: 60, i: 0.5, p: 0.83, pins: "DGS" },   // onsemi
  "BS250": { v: 45, i: 0.23, p: 0.83, cgs: 12, cgd: 3, pins: "DGS" },  // Vishay
  "IRF510": { curve: [[0.39, 4.5], [1, 5], [3, 6]], vds: 50, v: 100, i: 5.6, p: 43, pins: "GDS" },  // Vishay
  "IRF540": { curve: [[2.5, 4], [17, 5.2]], vds: 50, v: 100, i: 28, p: 150, pins: "GDS" },
  "IRF820": { curve: [[0.27, 4.5], [1, 5], [1.9, 5.5]], vds: 50, v: 500, i: 2.5, p: 50, cgs: 323, cgd: 37, pins: "GDS" },
  "IRF840": { curve: [[1.34, 4.5], [4.2, 5], [7.6, 5.5]], vds: 50, v: 500, i: 8, p: 125, pins: "GDS" },
  "IRF9540": { curve: [[3, 4], [11, 5.1]], vds: 50, v: 100, i: 19, p: 150, cgs: 1260, cgd: 140, pins: "GDS" },
  "IRF9610": { curve: [[0.48, 5.23], [0.96, 5.7], [1.92, 6.6]], vds: 50, v: 200, i: 1.8, p: 20, cgs: 155, cgd: 15, pins: "GDS" },
  "IRF9640": { curve: [[1, 4.18], [6.6, 5.3], [11.8, 6]], vds: 50, v: 200, i: 11, p: 125, cgs: 1120, cgd: 81, pins: "GDS" },
  "IRFP240": { curve: [[0.84, 4.5], [12, 6]], vds: 50, v: 200, i: 20, p: 150, cgs: 1170, cgd: 130, pins: "GDS" },
  "IRFP250": { curve: [[1.75, 4.5], [5.7, 5], [22, 6]], vds: 50, v: 200, i: 30, p: 190, cgs: 2550, cgd: 250, pins: "GDS" },
  "IRFP460": { curve: [[1, 4], [4.2, 4.5], [12, 5]], vds: 50, v: 500, i: 20, p: 280, cgs: 3850, cgd: 350, pins: "GDS" },
  "IRFP9240": { curve: [[1.66, 4.5], [4.5, 5], [11, 6]], vds: 50, v: 200, i: 12, p: 150, cgs: 1120, cgd: 81, pins: "GDS" },
  "DN2540": { idss: [0.15, null], v: 400, i: 0.5, p: 15, cgd: 1, pins: "GDS" },   // Supertex: IDSS ≥ 150 mA (typ 310)
  "LND150": { idss: [0.001, 0.003], v: 500, i: 0.03, p: 0.74, pins: "SGD" },     // Supertex
  // lateral pairs (Renesas, Exicon): 0.1 A at 0.55 V, 0.8 A at 1.85 V (VDS 10 V), within 0.4 V
  "2SK1058": { curve: [[0.1, 0.55], [0.8, 1.85]], vds: 10, tol: 0.4, v: 160, i: 7, p: 100, cgs: 590, cgd: 10, pins: "GSD" },
  "2SJ162": { curve: [[0.1, 0.55], [0.8, 1.85]], vds: 10, tol: 0.4, v: 160, i: 7, p: 100, cgs: 860, cgd: 40, pins: "GSD" },
  "ECX10N20": { v: 200, i: 8, p: 125, cgd: 10, pins: "GSD" },
  "ECX10P20": { v: 200, i: 8, p: 125, cgd: 10, pins: "GSD" }
};

test("every MOSFET in the library has its datasheet here", () => {
  assert.deepEqual(Object.keys(L.MOSFETS).sort(), Object.keys(MOS_DATA).sort());
});

for (const [k, d] of Object.entries(MOS_DATA)) {
  test(`${k}: transfer curve, ratings, capacitances and pins against the datasheet`, () => {
    const m = L.MOSFETS[k];
    for (const [id, vgs] of d.curve || []) {
      const v = vgsFor(k, id, d.vds);
      assert.ok(Math.abs(v - vgs) <= (d.tol || 0.3), `${k} VGS at ${id} A: ${v.toFixed(2)} V, datasheet curve ${vgs} V`);
    }
    if (d.idss) { const i = fetAt(k, 25, 0); assert.ok(i >= d.idss[0] && (d.idss[1] == null || i <= d.idss[1]), `${k} IDSS ${(i * 1e3).toFixed(1)} mA`); }
    for (const f of ["v", "i", "p"]) assert.equal(m[f], d[f], `${k} ${f}`);
    if (d.cgs != null) assert.equal(Math.round(m.cgs / pf), d.cgs, `${k} cgs`);
    if (d.cgd != null) assert.equal(Math.round(m.cgd / pf), d.cgd, `${k} cgd`);
    assert.equal(B.PINOUT[k][0], d.pins, `${k} pin order`);
  });
}

// JFETs: IDSS range (A), VGS(off) range (V, magnitude), rds(on) maximum (Ω), ratings, capacitances, pins
const JFET_DATA = {
  "J201": { idss: [0.2e-3, 1e-3], voff: [0.3, 1.5], v: 40, pins: "DSG" },  // Central, Fairchild
  "J113": { idss: [2e-3, null], voff: [0.5, 3], rds: 100, v: 35, cgs: 4, cgd: 3, pins: "DSG" },  // Vishay, onsemi
  "J310": { idss: [24e-3, 60e-3], voff: [2, 6.5], v: 25, cgs: 4.3, cgd: 1.8, pins: "DSG" },  // onsemi
  "2N5457": { idss: [1e-3, 5e-3], voff: [0.5, 6], v: 25, pins: "DSG" },  // onsemi
  "MPF102": { idss: [2e-3, 20e-3], voff: [0, 8], v: 25, p: 0.35, pins: "DSG" },  // onsemi
  "2SK170": { idss: [6e-3, 12e-3], voff: [0.2, 1.5], v: 40, pins: "DGS" },  // Toshiba, BL
  "LSK170B": { idss: [6e-3, 12e-3], voff: [0.2, 2], v: 40, pins: "DGS" },  // Linear Systems
  "2SK30A": { idss: [1.2e-3, 3e-3], voff: [0.4, 5], v: 50, pins: "SGD" },  // Toshiba, Y
  "J175": { idss: [7e-3, 70e-3], voff: [3, 6], rds: 125, v: 30, cgs: 15, pins: "DGS" },  // Vishay, onsemi
  "2N5460": { idss: [1e-3, 5e-3], voff: [0.75, 6], v: 40, cgd: 1, pins: "SDG" },  // onsemi
  "2SJ74": { idss: [6e-3, 12e-3], voff: [0.15, 2], v: 25, cgs: 73, pins: "DGS" }  // Toshiba, BL
};

test("every JFET in the library has its datasheet here", () => {
  assert.deepEqual(Object.keys(L.JFETS).sort(), Object.keys(JFET_DATA).sort());
});

for (const [k, d] of Object.entries(JFET_DATA)) {
  test(`${k}: IDSS, cut-off, on-resistance, ratings and pins against the datasheet`, () => {
    const m = L.JFETS[k], idss = fetAt(k, 15, 0), voff = Math.abs(m.vto), rds = 0.05 / fetAt(k, 0.05, 0);
    assert.ok(idss >= d.idss[0] && (d.idss[1] == null || idss <= d.idss[1]), `${k} IDSS ${(idss * 1e3).toFixed(2)} mA`);
    assert.ok(voff >= d.voff[0] && voff <= d.voff[1], `${k} VGS(off) ${voff} V`);
    if (d.rds) assert.ok(rds <= d.rds, `${k} rds(on) ${rds.toFixed(0)} Ω, datasheet max ${d.rds} Ω`);
    for (const f of ["v", "p"]) if (d[f] != null) assert.equal(m[f], d[f], `${k} ${f}`);
    if (d.cgs != null) assert.equal(+(m.cgs / pf).toFixed(2), d.cgs, `${k} cgs`);
    if (d.cgd != null) assert.equal(+(m.cgd / pf).toFixed(2), d.cgd, `${k} cgd`);
    assert.equal(B.PINOUT[k][0], d.pins, `${k} pin order`);
  });
}

test("metal cans are drawn from the top: pin 1 at the right, the tab beside it at the lower right", () => {
  for (const name of ["TO-18-EBC", "TO-1-EBC", "TO-5-EBC", "MP-EBC"]) {
    const fp = B.footprint(name), p = n => fp.pads.find(q => q.num === n || q.num === String(n));
    assert.ok(p(1).x > 0 && p(3).x < 0 && p(2).y < 0, `${name}: pad 1 right, pad 2 at the top, pad 3 left`);
    const tab = fp.silk.find(s => s.t === "line");
    assert.ok(tab.x1 > 0 && tab.y1 > 0, `${name}: the tab mark at the lower right`);
  }
});
