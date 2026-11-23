/**
 * LTspice import (ltspice-import.js): the reader, LTspice's values, a symbol's turn and mirror, the
 * sources, and a small schematic of our own (tests/fixtures/ltspice/follower.asc: a divider into an
 * emitter follower whose transistor model is written in the schematic, a capacitor turned, a diode
 * mirrored, a current source, an LTspice IC with no symbol file) as a circuit that keeps every net and
 * simulates (node --test). The same import was run on 193 schematics from public repositories:
 * tests/ltspice-field.mjs, every one with the nets of the .asc.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nets } from "./kicad-oracle.mjs";
import { check } from "./ltspice-field.mjs";

const LT = globalThis.LtspiceImport, L = globalThis.CadLib, E = globalThis.TubeSimEngine;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const ASC = readFileSync(new URL("./fixtures/ltspice/follower.asc", import.meta.url));

test("LTspice's values: 4k7, 100n, 2.2Meg, M is milli, units after the number", () => {
  assert.equal(LT.ltValue("4k7"), 4700);
  assert.ok(Math.abs(LT.ltValue("100n") - 1e-7) < 1e-20);
  assert.equal(LT.ltValue("2.2Meg"), 2.2e6);
  assert.equal(LT.ltValue("1M"), 1e-3);
  assert.ok(Math.abs(LT.ltValue("10µF") - 1e-5) < 1e-18);
  assert.equal(LT.ltValue("1e3"), 1000);
  assert.equal(LT.ltValue("{R}"), null);
});

test("the file: UTF-16 with its mark, UTF-8, or Windows-1252 (µ as one byte)", () => {
  const t = "Version 4\nSYMBOL res 0 0 R0\nSYMATTR Value 10µ\n";
  const u16 = new Uint8Array(2 + t.length * 2); u16[0] = 0xff; u16[1] = 0xfe; for (let i = 0; i < t.length; i++) { u16[2 + i * 2] = t.charCodeAt(i) & 255; u16[3 + i * 2] = t.charCodeAt(i) >> 8; }
  assert.equal(LT.decode(u16), t);
  assert.equal(LT.decode(new TextEncoder().encode(t)), t);
  assert.equal(LT.decode(Uint8Array.from([...t].map(ch => ch.charCodeAt(0)))), t);
  assert.throws(() => LT.readAsc("(kicad_sch)"), /not an LTspice schematic/);
});

test("sources: DC, SINE, PULSE, PWL, AC; a current source; an LTspice behavioural one is not", () => {
  assert.deepEqual(LT.sourceOf("12", ""), { type: "vdc", params: { v: 12, rs: 0 } });
  assert.deepEqual(LT.sourceOf("SINE(0 1 1k)", "Rser=50"), { type: "siggen", params: { wave: "sine", offset: 0, amp: 1, freq: 1000, rs: 50 } });
  const p = LT.sourceOf("PULSE(0 5 1u 10n 10n 0.5m 1m)", "").params;
  assert.equal(p.wave, "pulse"); assert.equal(p.vhi, 5); assert.equal(p.per, 1e-3);
  assert.equal(LT.sourceOf("PWL(0 0 1m 1 2m 0)", "").params.pwl, "0 0, 0.001 1, 0.002 0");
  assert.equal(LT.sourceOf("AC 1", "").ac, true);
  assert.deepEqual(LT.sourceOf("1m", "", true), { type: "isrc", params: { i: 1e-3 } });
  assert.equal(LT.sourceOf("V=V(a)*2", ""), null);
});

test("a symbol turned and mirrored as LTspice places it: the pins land on the wires", () => {
  const A = LT.readAsc(LT.decode(ASC)), c1 = A.symbols.find(s => s.attrs.InstName === "C1"), d1 = A.symbols.find(s => s.attrs.InstName === "D1");
  assert.equal(c1.rot, 1); assert.equal(d1.rot, 1); assert.equal(d1.mirror, true);
  const { nets: N } = LT.ascNets(LT.decode(ASC));
  const netOf = k => N.find(g => g.includes(k));
  assert.ok(netOf("C1.B").includes("Q1.E"), "C1 (R90) joins the emitter");
  assert.ok(netOf("D1.+").includes("C1.A"), "D1 (M90) joins OUT");
});

test("the schematic as a circuit: the app's parts, the same nets, the model written in it", () => {
  const { design, report } = LT.importAsc({ "follower.asc": LT.decode(ASC) });
  const by = l => design.comps.find(c => c.label === l);
  assert.equal(by("R3").type, "resistor"); assert.equal(by("R3").params.r, 4700);
  assert.equal(by("C1").type, "capacitor");
  assert.equal(by("D1").type, "diode"); assert.equal(by("D1").params.model, "1N4148");
  assert.equal(by("V1").type, "vdc"); assert.equal(by("V1").params.v, 10);
  assert.equal(by("I1").type, "isrc");
  assert.equal(by("Q1").type, "spice"); assert.equal(by("Q1").params.sym, "npn");
  assert.equal(by("U1").type, "kicad"); assert.equal(by("U1").params.sym.pins.length, 3);
  assert.equal(report.parts, 10); assert.equal(report.kept, 1); assert.equal(report.models, 1);
  assert.ok(design.comps.some(c => c.type === "netlabel" && c.params.name === "MID"));
  assert.ok(design.comps.some(c => c.type === "note" && /\.model QX/.test(c.params.text)));
  assert.ok(report.notes.some(n => /U1 \(lt1001\).*3 wire ends/.test(n)));
  assert.deepEqual(check(LT.decode(ASC)).bad, []);
});

test("it simulates: the divider, the emitter follower on the schematic's model, the current source's sign", () => {
  const { design } = LT.importAsc({ "follower.asc": LT.decode(ASC) }), N = nets(design);
  const ground = new Set(design.comps.filter(c => c.type === "ground").map(c => N.get(c.id + ":G") ?? N.get(c.id + ":" + L.LIB.ground.pins({ params: {} })[0].id)));
  const ids = new Map(); let n = 0;
  const node = k => (ground.has(k) ? 0 : (ids.has(k) ? ids.get(k) : (ids.set(k, ++n), n)));
  const els = [];
  design.comps.forEach(c => {
    const d = L.LIB[c.type]; if (!d.build || ["frame", "note", "ground", "netlabel", "kicad"].includes(c.type)) return;
    const full = Object.assign({}, c, { params: Object.assign({}, d.defaults, c.params) });
    d.build(full, pin => node(N.get(c.id + ":" + pin)), () => ++n, els);
  });
  const r = E.simulate({ nodeCount: n + 1, elements: els }, { budgetMs: 5000 });
  assert.ok(r.ok, r.error);
  const v = name => { const l = design.comps.find(c => c.type === "netlabel" && c.params.name === name); return r.dc.nodes[node(N.get(l.id + ":1"))]; };
  // 10 V halved, less the base current; the emitter a diode drop below; 1 mA out of IT through 1 kΩ
  assert.ok(v("MID") > 4.8 && v("MID") < 5, `MID ${v("MID")}`);
  const ve = r.dc.nodes[node(N.get(design.comps.find(c => c.label === "R3").id + ":1"))];
  assert.ok(v("MID") - ve > 0.55 && v("MID") - ve < 0.75, `VBE ${v("MID") - ve}`);
  assert.ok(Math.abs(v("IT") + 1) < 0.01, `IT ${v("IT")}`);
});

test(".param and .step: {expressions} in values worked out; a part with no model is LTspice's default one", () => {
  const t = "Version 4\nSHEET 1 880 680\nSYMBOL res 0 0 R0\nSYMATTR InstName R1\nSYMATTR Value {Rb*2}\nSYMBOL res 96 0 R0\nSYMATTR InstName R2\nSYMATTR Value {X}\nSYMBOL npn 200 0 R0\nSYMATTR InstName Q1\n" +
    "TEXT 0 200 Left 2 !.param Rb=2k2 Ra={Rb/2}\\n.step param X list 10 20 30\n";
  const { design, report } = LT.importAsc({ "p.asc": t }), by = l => design.comps.find(c => c.label === l);
  assert.equal(by("R1").params.r, 4400);
  assert.equal(by("R2").params.r, 10);
  assert.equal(by("Q1").type, "spice"); assert.match(by("Q1").params.text, /\.model NPN NPN/);
  assert.ok(report.notes.some(n => /steps X/.test(n)) && report.notes.some(n => /Q1: no model named/.test(n)));
});
