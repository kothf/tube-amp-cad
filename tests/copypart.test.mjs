/**
 * Copy to My library (part-lib.js fromBuiltIn / builtInModel): every built-in transistor, MOSFET, JFET
 * and diode becomes a library part with a SPICE model, and the copy simulates as the built-in part does:
 * the same DC operating point and AC response in a test circuit, also hot and self-heating (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "kicad-import.js", "part-lib.js", "board-core.js", "board-3d.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, P = globalThis.PartLib, B = globalThis.BoardCore, D = globalThis.Board3D;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

// the part placed from a library holding only its copy
function copied(type, model) {
  const lib = P.empty(), c = P.fromBuiltIn(type, model, null, lib);
  P.add(lib, [c.part], c.fp ? { [c.fp.name]: c.fp } : {});
  return { lib, params: P.params(lib, lib.parts[0], 1), made: c };
}
const close = (a, b, rel, abs) => Math.abs(a - b) <= abs + rel * Math.abs(b);

const ALL = [];
for (const [k, m] of Object.entries(L.BJTS)) ALL.push([m.pol > 0 ? "npn" : "pnp", k]);
for (const [k, m] of Object.entries(L.MOSFETS)) ALL.push([m.pol > 0 ? "nmos" : "pmos", k]);
for (const [k, m] of Object.entries(L.JFETS)) ALL.push([m.pol > 0 ? "njf" : "pjf", k]);
for (const k of Object.keys(L.DIODES)) ALL.push(["diode", k]);


// a test circuit round the part, its build given (the built-in's or the library part's)
function circuit(role, model, build) {
  const pol = /^(pnp|pmos|pjf)$/.test(role) ? -1 : 1, s = v => pol * v;
  let n = 6, els, pins, out;
  if (role === "diode") {
    els = [{ id: "g", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 0.1, offset: 5 }, { id: "r", kind: "R", nodes: [1, 2], r: 4.7e3 }];
    pins = { A: 2, K: 0 }; out = 2;
  } else if (role === "npn" || role === "pnp") {
    const m = L.BJTS[model], big = m.i >= 1;
    els = [{ id: "vcc", kind: "V", nodes: [1, 0], v: s(m.v >= 20 ? 12 : 6) }, { id: "r1", kind: "R", nodes: [1, 2], r: big ? 1e3 : 47e3 }, { id: "r2", kind: "R", nodes: [2, 0], r: big ? 220 : 10e3 },
      { id: "rc", kind: "R", nodes: [1, 3], r: big ? 100 : 4.7e3 }, { id: "re", kind: "R", nodes: [4, 0], r: big ? 22 : 1e3 }, { id: "g", kind: "VSRC", nodes: [5, 0], wave: "sine", freq: 1000, amp: 0.01 }, { id: "ci", kind: "C", nodes: [5, 2], c: 10e-6 }];
    pins = { C: 3, B: 2, E: 4 }; out = 3;
  } else {
    const m = L.MOSFETS[model] || L.JFETS[model], jf = !!L.JFETS[model];
    // the gate well past threshold (a MOSFET) or at 0 V (a JFET at about IDSS): the copy's law is the plain
    // SPICE one, the app's rounds the knee within about 0.1 V of the threshold
    els = [{ id: "vdd", kind: "V", nodes: [1, 0], v: s(20) }, { id: "rd", kind: "R", nodes: [1, 3], r: jf ? 470 : 100 }, { id: "rs", kind: "R", nodes: [4, 0], r: jf ? 100 : 10 },
      { id: "vg", kind: "V", nodes: [5, 0], v: jf ? 0 : m.vto + pol * 1.5 }, { id: "g", kind: "VSRC", nodes: [2, 5], wave: "sine", freq: 1000, amp: 0.01 }];
    pins = { D: 3, G: 2, S: 4 }; out = 3;
  }
  build(pid => pins[pid], () => n++, els);
  const net = { nodeCount: n, elements: els }, r = E.simulate(net, {});
  if (!r.ok) return { error: r.error };
  const ac = E.acSweep(net, { inputs: [{ id: "g" }], fStart: 100, fStop: 1e7, perDecade: 2 });
  return { dc: [1, 2, 3, 4].map(k => r.dc.nodes[k] || 0), gain: ac.freqs.map((f, k) => Math.hypot(ac.re[out][k], ac.im[out][k])) };
}
function compare(role, model, extra) {
  const { params } = copied(role, model);
  const own = circuit(role, model, (net, alloc, out) => L.LIB[role].build({ id: "q", type: role, params: Object.assign({}, L.LIB[role].defaults, { model }, extra || {}) }, net, alloc, out));
  // the copy's pins are named by their pads: each on the net of the built-in pin in its place
  const roles = L.LIB[role].pins({ params: { model } }).map(p => p.id), ids = params.syms[0].pins.map(p => p.id), roleOf = id => roles[ids.indexOf(id)];
  const cp = circuit(role, model, (net, alloc, out) => L.LIB.part.build({ id: "q", type: "part", params: Object.assign({}, params, extra || {}) }, id => net(roleOf(id)), alloc, out));
  return { own, cp };
}

test("every built-in transistor, MOSFET, JFET and diode can be copied: a library part with a model, footprint and body", () => {
  assert.ok(ALL.length > 100, `${ALL.length} parts`);
  for (const [type, model] of ALL) {
    const { made, params } = copied(type, model);
    assert.ok(made.part.spice.text.includes(".MODEL"), model);
    const own = L.LIB[type].pins({ params: { model } });
    assert.deepEqual(made.part.units[0].pins.map(p => [p.x, p.y]), own.map(p => [p.x, p.y]), `${model}: the built-in's pins, where they were`);
    assert.equal(made.part.spice.map.join(), made.part.units[0].pins.map(p => p.id).join(), `${model}: the model's pins on the drawing's (${made.part.spice.map})`);
    assert.ok(params.syms.length === 1 && params.text && params.sub, model);
    if (made.fp) {
      // each pin on the pad the built-in footprint gives it, and the package's own 3D body
      const pads = new Set(made.fp.pads.map(p => p.num));
      assert.ok(made.part.units[0].pins.every(p => pads.has(p.num)), `${model}: every pin has its pad (${made.part.units[0].pins.map(p => p.id + p.num).join(" ")})`);
      assert.equal(made.fp.body3d.shape, "pkg"); assert.ok(D.bodyTidy(made.fp.body3d).pkg === made.fp.body3d.pkg, `${model}: ${made.fp.body3d.pkg} kept as the body`);
    }
  }
});

test("each copy simulates as the built-in part: DC within 0.1 mV (0.01 %), AC within 0.01 dB from 100 Hz to 10 MHz", () => {
  const bad = [];
  for (const [type, model] of ALL) {
    const { own, cp } = compare(type, model);
    if (own.error || cp.error) { bad.push(`${model}: ${own.error || cp.error}`); continue; }
    own.dc.forEach((v, k) => { if (!close(cp.dc[k], v, 1e-4, 1e-4)) bad.push(`${model} DC node ${k + 1}: ${cp.dc[k]} vs ${v}`); });
    own.gain.forEach((g, k) => { if (g > 1e-6 && Math.abs(20 * Math.log10(cp.gain[k] / g)) > 0.01) bad.push(`${model} AC #${k}: ${(20 * Math.log10(cp.gain[k] / g)).toFixed(4)} dB`); });
  }
  assert.deepEqual(bad, []);
});

test("hot and self-heating: a copied transistor follows its Temperature and Cooling as the built-in does, germanium too", () => {
  const bad = [];
  for (const [type, model] of ALL.filter(([t]) => t === "npn" || t === "pnp")) {
    for (const extra of [{ temp: 60 }, { thermal: "air" }]) {
      const { own, cp } = compare(type, model, extra);
      if (own.error || cp.error) { bad.push(`${model} ${JSON.stringify(extra)}: ${own.error || cp.error}`); continue; }
      own.dc.forEach((v, k) => { if (!close(cp.dc[k], v, 1e-3, 1e-3)) bad.push(`${model} ${JSON.stringify(extra)} node ${k + 1}: ${cp.dc[k]} vs ${v}`); });
    }
  }
  assert.deepEqual(bad, []);
});

test("the copy's model reads back in a SPICE part, and Checks see its ratings", () => {
  const m = P.builtInModel("pnp", "MP39B");
  assert.match(m.text, /\.MODEL MP39B PNP\(.*EG=0\.67.*ICBO=5e-6\)/);
  const c = copied("npn", "2N3904");
  assert.equal(c.params.rating, "40 V, 0.2 A, 0.625 W, TO-92");
  assert.equal(c.params.tpkg, "TO-92"); assert.equal(c.params.ptot, 0.625);
  assert.equal(c.made.fp.name, "TO-92-EBC");
  assert.equal(P.fromBuiltIn("resistor", "x"), null);
});
