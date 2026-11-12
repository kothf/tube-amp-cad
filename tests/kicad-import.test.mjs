/**
 * KiCad import (kicad-import.js): the S-expression reader, a symbol's turn and mirror, which of
 * the app's parts a KiCad symbol becomes, and a small project (tests/fixtures/kicad: a schematic,
 * its board and the project file, checked in KiCad 7.0.11) as the circuit and the board it gives
 * (node --test). The same reader was compared with KiCad's own netlist on KiCad's demo projects:
 * tests/kicad-oracle.mjs, which needs kicad-cli and so is not part of npm test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nets, compPins } from "./kicad-oracle.mjs";

const K = globalThis.KicadImport, B = globalThis.BoardCore, L = globalThis.CadLib;
const fx = n => readFileSync(new URL(`./fixtures/kicad/${n}`, import.meta.url), "utf8");
const FILES = { "amp.kicad_sch": fx("amp.kicad_sch"), "amp.kicad_pcb": fx("amp.kicad_pcb"), "amp.kicad_pro": fx("amp.kicad_pro") };

test("the reader: lists, quoted strings with escapes, numbers as written", () => {
  const t = K.parse('(a (b "x \\"y\\" (z)" 1.5) (c)\n  (d e))');
  assert.equal(t[0], "a");
  assert.equal(String(t[1][1]), 'x "y" (z)');
  assert.equal(+t[1][2], 1.5);
  assert.deepEqual(t[2], ["c"]);
  assert.deepEqual(t[3].map(String), ["d", "e"]);
  assert.throws(() => K.parse("(a (b)"));
});

test("a symbol's turn and mirror: where a pin drawn at (1, 2) lands, as KiCad places it", () => {
  const at = (a, m) => { const [p, q, r, s] = K.matrix(a, m); return [p * 1 + q * 2, r * 1 + s * 2]; };
  assert.deepEqual(at(0, ""), [1, -2]);            // the library's Y points up, the sheet's down
  assert.deepEqual(at(90, ""), [-2, -1]);
  assert.deepEqual(at(180, ""), [-1, 2]);
  assert.deepEqual(at(270, ""), [2, 1]);
  assert.deepEqual(at(0, "x"), [1, 2]);
  assert.deepEqual(at(0, "y"), [-1, -2]);
});

test("values as KiCad writes them", () => {
  const near = (a, b) => assert.ok(Math.abs(a - b) <= Math.abs(b) * 1e-9, `${a} ≈ ${b}`);
  near(K.engValue("4k7"), 4700); near(K.engValue("100k"), 100e3); near(K.engValue("2R2"), 2.2); near(K.engValue("1M"), 1e6);
  near(K.engValue("100n"), 100e-9); near(K.engValue("10uF"), 10e-6); near(K.engValue("47µ"), 47e-6); near(K.engValue("680nF"), 680e-9);
  assert.equal(K.engValue("POWER"), null);
});

test("KiCad symbols become the app's parts: valves by any of their names, passives, semiconductors by their pins", () => {
  const P = (...l) => l.map(([num, name, type]) => ({ num, name, type: type || "passive", x: 0, y: 0 }));
  const r = K.mapPart({ libId: "Device:R", value: "47k", ref: "R1", pins: P(["1", "~"], ["2", "~"]), count: 1 });
  assert.equal(r.type, "resistor"); assert.equal(r.params.r, 47e3); assert.deepEqual(r.pinOf, { 1: "1", 2: "2" });
  const c = K.mapPart({ libId: "Device:C_Polarized", value: "22u", ref: "C1", pins: P(["1", "+"], ["2", "-"]), count: 1 });
  assert.equal(c.type, "electrolytic"); assert.ok(Math.abs(c.params.c - 22e-6) < 1e-12); assert.deepEqual(c.pinOf, { 1: "+", 2: "-" });
  const q = K.mapPart({ libId: "Transistor_BJT:BC547", value: "BC547", ref: "Q1", pins: P(["1", "C"], ["2", "B"], ["3", "E"]), count: 1 });
  assert.equal(q.type, "npn"); assert.deepEqual(q.pinOf, { 1: "C", 2: "B", 3: "E" });
  const d = K.mapPart({ libId: "Device:D_Zener", value: "BZX55C12", ref: "D1", pins: P(["1", "K"], ["2", "A"]), count: 1 });
  assert.equal(d.type, "zener"); assert.deepEqual(d.pinOf, { 1: "K", 2: "A" });
  // a valve under its European, American or Soviet name; its section by the pins KiCad numbers
  assert.equal(K.findTube("ECC83").commonName, K.findTube("12AX7").commonName);
  assert.ok(K.findTube("6Н2П") || K.findTube("6N2P"));
  const v = K.mapPart({ libId: "Valve:ECC83", value: "ECC83", ref: "V1", pins: P(["6", "A"], ["7", "G"], ["8", "K"]), count: 3 });
  assert.equal(v.type, "tube"); assert.equal(K.findTube(v.params.tube).commonName, K.findTube("12AX7").commonName);
  assert.deepEqual(Object.keys(v.pinOf).sort(), ["6", "7", "8"]);
  assert.deepEqual([v.pinOf[6], v.pinOf[7], v.pinOf[8]], ["A", "G", "K"]);
  // a part the app has no like of stays as KiCad draws it; a breaker is not a diode for its name
  assert.equal(K.mapPart({ libId: "mylib:XYZ", value: "XYZ", ref: "U1", pins: P(["1", "IN", "input"], ["2", "OUT", "output"]), count: 1 }), null);
  assert.equal(K.mapPart({ libId: "electric:D_10A", value: "D_10A", ref: "Q5", pins: P(["1", "~"], ["2", "~"]), count: 1 }), null);
});

test("a KiCad project opens as the circuit: parts, nets and names as KiCad has them", () => {
  const { design, name, report } = K.importProject(FILES);
  assert.equal(name, "amp");
  assert.equal(design.app, "TubeAmpCAD");
  assert.deepEqual([report.sheets, report.parts, report.own, report.kept], [1, 3, 2, 1]);
  const by = l => design.comps.find(c => c.label === l), types = t => design.comps.filter(c => c.type === t);
  assert.equal(by("R1").type, "resistor"); assert.equal(by("R1").params.r, 100e3);
  assert.equal(by("R2").params.r, 4700);
  assert.equal(by("U1").type, "kicad"); assert.equal(by("U1").params.value, "XYZ"); assert.equal(by("U1").params.footprint, "mylib:XYZ_SMD");
  assert.deepEqual(by("U1").params.sym.pins.map(p => [p.num, p.name]), [["1", "IN"], ["2", "OUT"]]);
  assert.equal(types("ground").length, 1);
  assert.deepEqual(types("offsheet").map(c => c.params.name).sort(), ["OUT", "OUT", "SPK"]);
  assert.ok(types("note").some(c => c.params.text === "Gain stage"));
  const frame = types("frame")[0]; assert.equal(frame.params.title, "Fixture amplifier"); assert.equal(frame.params.rev, "B"); assert.equal(frame.params.owner, "Bench");
  // everything on the app's 10-unit grid, wires straight, inside the frame
  design.comps.filter(c => c.type !== "frame").forEach(c => { assert.equal(c.x % 10, 0, c.label + " x"); assert.equal(c.y % 10, 0, c.label + " y"); });
  design.wires.forEach(w => assert.ok(w.x1 === w.x2 || w.y1 === w.y2, "a straight wire"));
  // the nets: R1.1–R2.1, R1.2 on ground, R2.2–U1.1 through the two OUT labels, U1.2 alone on SPK
  const N = nets(design), n = (l, p) => N.get(by(l).id + ":" + p), gnd = N.get(types("ground")[0].id + ":" + compPins(types("ground")[0])[0].id);
  const u = Object.fromEntries(by("U1").params.sym.pins.map(p => [p.num, p.id]));
  assert.equal(n("R1", "1"), n("R2", "1"));
  assert.equal(n("R1", "2"), gnd);
  assert.equal(n("R2", "2"), n("U1", u[1]));
  assert.equal(new Set([n("R1", "1"), n("R1", "2"), n("R2", "2"), n("U1", u[2])]).size, 4);
  // the part KiCad drew is a part of the library here: pins where its drawing has them, a bill-of-materials line
  const d = L.LIB.kicad, full = Object.assign({}, by("U1"), { params: Object.assign({}, d.defaults, by("U1").params) });
  assert.equal(d.pins(full).length, 2);
  assert.equal(typeof d.build, "function");
});

test("its board comes with it: outline, footprints in place on their nets, tracks, the via, the pour, the hole", () => {
  const { design, report } = K.importProject(FILES), board = B.normaliseBoard(design.board);
  assert.deepEqual([board.outline.w, board.outline.h], [40, 30]);
  assert.deepEqual([report.board.parts, report.board.vias, report.board.zones, report.board.holes], [3, 1, 1, 1]);
  // the netlist the CAD would send the board: every pin on the net the sheet gives it
  const N = nets(design), ids = new Map(); let k = 1;
  const net = key => { if (!ids.has(key)) ids.set(key, k++); return ids.get(key); };
  const g = design.comps.find(c => c.type === "ground"); ids.set(N.get(g.id + ":" + compPins(g)[0].id), 0);
  const nl = { names: { 0: "GND" }, volts: {}, parts: design.comps.filter(c => !["frame", "note", "ground", "offsheet", "rail"].includes(c.type)).map(c => ({ id: c.id, type: c.type, label: c.label, params: Object.assign({}, L.LIB[c.type].defaults, c.params), pins: compPins(c).map(p => ({ id: p.id, net: net(N.get(c.id + ":" + p.id)) })) })) };
  const m = B.model(board, nl), pad = (ref, num) => m.pads.find(p => p.ref === ref && String(p.num) === String(num));
  assert.equal(m.parts.filter(p => p.place).length, 3);
  const near = (p, x, y) => assert.ok(Math.hypot(p.x - x, p.y - y) < 0.01, `${p.ref}:${p.num} at ${p.x}, ${p.y}, not ${x}, ${y}`);
  // KiCad's millimetres from the outline's corner; R2 stands turned a quarter (its pad 2 up the board)
  near(pad("R1", 1), 10, 10); near(pad("R1", 2), 20.16, 10);
  near(pad("R2", 1), 30, 25); near(pad("R2", 2), 30, 14.84);
  near(pad("U1", 1), 23, 7); near(pad("U1", 2), 27, 7);
  assert.equal(pad("R1", 1).net, pad("R2", 1).net);
  assert.equal(pad("R1", 2).net, 0);
  assert.equal(pad("R2", 2).net, pad("U1", 1).net);
  assert.notEqual(pad("U1", 2).net, pad("U1", 1).net);
  // the resistor's footprint as KiCad has it (its own pads are on another pitch), the unknown part's too
  const fp = board.footprints[board.parts[Object.keys(board.parts).find(key => board.parts[key].ref === "U1")].fp];
  assert.ok(fp && fp.custom && fp.smd && fp.pads.length === 2);
  assert.ok(B.isCustom(board.parts[Object.keys(board.parts).find(key => board.parts[key].ref === "R1")].fp));
  // two segments end to end are one run; the bottom ones meet at the via and stay two
  assert.equal(board.tracks.length, 3);
  assert.deepEqual(board.tracks.find(t => t.layer === "F.Cu").pts, [[10, 10], [10, 25], [30, 25]]);
  assert.ok(board.tracks.filter(t => t.layer === "B.Cu").every(t => t.w === 0.3));
  assert.deepEqual([board.vias[0].x, board.vias[0].y], [23, 14.84]);
  assert.equal(board.zones[0].layer, "B.Cu");
  assert.deepEqual([board.holes[0].x, board.holes[0].y, board.holes[0].d], [4, 26, 3.2]);
  // rules the layout passes (the project's own where they are tighter)
  assert.ok(board.rules.clearance <= 0.25 + 1e-9 && board.rules.minTrack <= 0.3 + 1e-9);
  // the file saves and opens again with its footprints
  const again = B.normaliseBoard(JSON.parse(JSON.stringify(design.board))), m2 = B.model(again, nl);
  assert.equal(m2.pads.length, m.pads.length);
});

test("a schematic alone, and a board alone", () => {
  const s = K.importProject({ "amp.kicad_sch": FILES["amp.kicad_sch"] });
  assert.equal(s.design.board, undefined); assert.equal(s.report.board, null); assert.equal(s.report.parts, 3);
  const b = K.importProject({ "amp.kicad_pcb": FILES["amp.kicad_pcb"] });
  assert.equal(b.report.board.parts, 3);
  // a box for each footprint, its pads on connectors named for the board's nets
  assert.deepEqual(b.design.comps.filter(c => c.type === "kicad").map(c => c.label).sort(), ["R1", "R2", "U1"]);
  assert.ok(b.design.comps.filter(c => c.type === "offsheet").some(c => /OUT$/.test(c.params.name)));
  assert.ok(b.report.notes.some(t => /without a schematic/.test(t)));
  assert.throws(() => K.importProject({ "amp.kicad_pro": FILES["amp.kicad_pro"] }), /no KiCad schematic/);
});
