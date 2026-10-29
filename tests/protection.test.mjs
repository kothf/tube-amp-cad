/**
 * Protection parts and connectors (cad-components.js FUSE, NTCS, MOVS, JACKS and the connector
 * parts): an inrush limiter at its self-heated resistance (sim-engine.js simulate), a varistor's
 * curve against its datasheet points, a fuse's cold resistance, the switched jack, and the board
 * footprints with their 3D bodies (node --test).
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

test("inrush limiters: at the maker's currents the self-heated resistance is the datasheet's (100 % and 50 % of Imax)", () => {
  for (const [model, m] of Object.entries(L.NTCS)) {
    for (const [share, want] of [[1, m.r100], [0.5, m.r50]]) {
      // a current source through the part: R settles where R = k·I^−n
      const r = E.simulate(circuit([{ type: "isrc", params: { i: share * m.imax }, pins: { "+": 1, "-": 0 } }, { id: "N", type: "ntc", params: { model }, pins: { 1: 1, 2: 0 } }]), { budgetMs: 10000 });
      assert.ok(r.ok, `${model}: ${r.error}`);
      near(r.ntc.N.r, want, 0.02, `${model} at ${share * 100} % of ${m.imax} A`);
      near(r.dc.nodes[1], share * m.imax * r.ntc.N.r, 0.02, `${model}: the drop at that resistance`);
    }
  }
});

test("inrush limiters: a capacitor-input supply settles with the part hot, a light load leaves it near cold", () => {
  const m = L.NTCS["SL22 10005"], law = L.ntcLaw(m);
  for (const rl of [100, 3000]) {
    const r = E.simulate(circuit([{ id: "G", type: "siggen", params: { amp: 325, freq: 50, rs: 0.5 }, pins: { "+": 1, "-": 2 } },
      { id: "N", type: "ntc", params: { model: "SL22 10005" }, pins: { 1: 1, 2: 3 } },
      { type: "bridge", params: { model: "KBU8K" }, pins: { AC1: 3, AC2: 2, "+": 4, "-": 0 } },
      { type: "electrolytic", params: { c: 100e-6 }, pins: { "+": 4, "-": 0 } },
      { type: "resistor", params: { r: rl }, pins: { 1: 4, 2: 0 } }]), { budgetMs: 20000 });
    assert.ok(r.ok, r.error);
    const { r: R, i } = r.ntc.N;
    // the fixed point: the resistance it ran at is the law's for its rms current
    near(R, Math.min(law.r25, law.k * Math.pow(i, -law.n)), 0.02, `${rl} Ω load`);
    if (rl === 100) assert.ok(R < 0.05 * m.r25, `hot: ${R} Ω`); else assert.ok(R > 0.5 * m.r25, `nearly cold: ${R} Ω`);
  }
  // the power-on transient starts it cold: the element goes out at its 25 °C value
  const nl = circuit([{ id: "N", type: "ntc", params: { model: "SL22 10005" }, pins: { 1: 1, 2: 0 } }]);
  assert.equal(nl.elements[0].r, m.r25);
});

test("varistors: 1 mA at the varistor voltage, the clamp voltage at the surge current, both ways; microamps at the mains peak", () => {
  for (const [model, m] of Object.entries(L.MOVS)) {
    const at = i => {
      const r = E.simulate(circuit([{ type: "isrc", params: { i }, pins: { "+": 1, "-": 0 } }, { type: "mov", params: { model }, pins: { 1: 1, 2: 0 } }]), { budgetMs: 10000 });
      assert.ok(r.ok, `${model}: ${r.error}`); return r.dc.nodes[1];
    };
    near(at(1e-3), m.v1ma, 0.01, `${model} at 1 mA`);
    near(at(-1e-3), -m.v1ma, 0.01, `${model} at −1 mA`);
    near(at(m.ic), m.vc, 0.01, `${model} at ${m.ic} A`);
    // the continuous rating's peak, through 1 kΩ: the leakage
    const vp = m.vrms * Math.SQRT2, r = E.simulate(circuit([{ type: "vdc", params: { v: vp }, pins: { "+": 1, "-": 0 } }, { type: "resistor", params: { r: 1000 }, pins: { 1: 1, 2: 2 } }, { type: "mov", params: { model }, pins: { 1: 2, 2: 0 } }]), { budgetMs: 10000 });
    assert.ok(r.ok, r.error);
    const leak = (vp - r.dc.nodes[2]) / 1000;
    assert.ok(leak > 0 && leak < 50e-6, `${model}: ${leak * 1e6} µA at ${vp.toFixed(0)} V`);
  }
});

test("fuses: a cold resistance falling with the rating, through the datasheet points", () => {
  // Littelfuse 218 nominal cold resistances
  for (const [a, r] of [[0.1, 8.95], [0.5, 0.37], [0.8, 0.073], [1, 0.055], [6.3, 0.0075], [10, 0.0045]]) near(L.fuseCold(a), r, 1e-9, a + " A");
  L.FUSE_RATINGS.slice(1).forEach((a, k) => assert.ok(L.fuseCold(a) < L.fuseCold(L.FUSE_RATINGS[k]), `${a} A`));
  const r = E.simulate(circuit([{ type: "vdc", params: { v: 10 }, pins: { "+": 1, "-": 0 } }, { type: "fuse", params: { a: 1 }, pins: { 1: 1, 2: 2 } }, { type: "resistor", params: { r: 10 }, pins: { 1: 2, 2: 0 } }]), { budgetMs: 5000 });
  near(r.dc.nodes[2], 10 * 10 / (10 + 0.055), 1e-4, "the drop across a 1 A fuse");
});

test("jacks: the switched jack shorts its tip to SW until a plug goes in; connectors add nothing to the circuit", () => {
  for (const [plug, closed] of [["out", true], ["in", false]]) {
    const r = E.simulate(circuit([{ type: "vdc", params: { v: 1 }, pins: { "+": 1, "-": 0 } }, { type: "resistor", params: { r: 1000 }, pins: { 1: 1, 2: 2 } },
      { type: "jack", params: { kind: "TS-SW", plug }, pins: { "+": 2, "-": 0, SW: 0 } }]), { budgetMs: 5000 });
    assert.ok(r.ok, r.error);
    assert.ok(closed ? r.dc.nodes[2] < 1e-4 : r.dc.nodes[2] > 0.999, `plug ${plug}: tip at ${r.dc.nodes[2]} V`);
  }
  for (const type of ["iec", "terminal", "header", "faston"]) assert.equal(circuit([{ type, pins: {} }]).elements.length, 0, type);
  for (const kind of Object.keys(L.JACKS)) if (kind !== "TS-SW") assert.equal(circuit([{ type: "jack", params: { kind }, pins: {} }]).elements.length, 0, kind);
});

test("board: every connector and protection part on every footprint it offers, all pins on pads, with a 3D body", () => {
  const part = (type, params) => {
    const p = Object.assign({}, L.LIB[type].defaults, params), pins = L.LIB[type].pins({ params: p });
    return { id: "x", type, label: "X1", params: p, pins: pins.map((q, i) => ({ id: q.id, net: i + 1 })) };
  };
  const cases = [...Object.keys(L.JACKS).map(kind => ["jack", { kind }]), ["iec", {}], ...[2, 3, 4, 5, 6, 8].flatMap(ways => [["terminal", { ways, pitch: "5.08" }], ["terminal", { ways, pitch: "7.5" }]]),
    ...[2, 3, 4, 5, 6, 8, 10].map(ways => ["header", { ways }]), ["faston", { size: "6.3" }], ["faston", { size: "4.8" }], ...["5x20", "6.3x32", "TR5"].map(size => ["fuse", { size }]),
    ...Object.keys(L.NTCS).map(model => ["ntc", { model }]), ...Object.keys(L.MOVS).map(model => ["mov", { model }]), ...Object.keys(L.BRIDGES).map(model => ["bridge", { model }])];
  for (const [type, params] of cases) {
    const g = B.physicalParts({ parts: [part(type, params)] })[0], what = `${type} ${JSON.stringify(params)}`;
    for (const name of g.options) {
      const f = B.footprint(name, g.members[0].pins.map(p => p.id));
      assert.ok(f, `${what}: ${name}`);
      const got = new Set([...B.padMap(g, f).values()].flat().map(x => x.pin));
      g.members[0].pins.forEach(p => assert.ok(got.has(p.id), `${what} on ${name}: pin ${p.id} has a pad`));
      const bodies = D3.partBodies({ ...g, fp: f, place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {});
      assert.ok(bodies.length && bodies.every(s => s.verts.every(v => v.every(Number.isFinite))), `${what} on ${name}: 3D body`);
    }
  }
  // the makers' patterns: Neutrik tip to sleeve 12.7 mm, to its switch 16.23 mm; GBU / KBU 5.08 mm; the WOB a 5.08 mm square
  const pos = (n, nm) => B.footprint(n).pads.find(p => p.name === nm);
  near(pos("JACK-NMJ4HCD2", "-").x - pos("JACK-NMJ4HCD2", "+").x, 12.7, 1e-9, "NMJ4 tip–sleeve");
  near(pos("JACK-NMJ6HCD2", "SW").y - pos("JACK-NMJ6HCD2", "+").y, 16.23, 1e-9, "NMJ6 tip–switch");
  near(pos("BRIDGE-GBU", "-").x - pos("BRIDGE-GBU", "+").x, 15.24, 1e-9, "GBU + to −");
  near(Math.hypot(pos("BRIDGE-WOB", "-").x - pos("BRIDGE-WOB", "+").x, pos("BRIDGE-WOB", "-").y - pos("BRIDGE-WOB", "+").y), 5.08 * Math.SQRT2, 1e-9, "WOB + and − on the diagonal");
  near(pos("FUSE-5X20", "2").x - B.footprint("FUSE-5X20").pads[0].x, 15.6, 1e-9, "5 × 20 clips");
  // a fuse's two clips: each pin on both of its clip's pads
  const fz = B.physicalParts({ parts: [part("fuse", {})] })[0];
  assert.deepEqual([...B.padMap(fz, B.footprint("FUSE-5X20")).keys()].sort(), ["1", "2", "3", "4"]);
});

test("SPICE: a varistor's junctions go out as diodes with their emission coefficient", () => {
  const d = circuit([{ id: "M", type: "mov", params: { model: "S14K275" }, pins: { 1: 1, 2: 0 } }]).elements.filter(e => e.kind === "D");
  assert.equal(d.length, 2);
  const m = L.movModel(L.MOVS.S14K275);
  assert.ok(d.every(e => e.n === m.n && e.is === m.is && !e.tt));
});
