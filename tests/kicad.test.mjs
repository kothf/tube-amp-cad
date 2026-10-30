/**
 * KiCad export (kicad-export.js): the board as a .kicad_pcb (footprints, pads and their nets,
 * tracks, vias, pours, keep-outs, the outline), the project's net classes, the custom rules,
 * the schematic writer and the canvas recorder the CAD draws its symbols into (node --test).
 * The files themselves were checked against KiCad 7.0.11 (kicad-cli, pcbnew): they load, the
 * schematic's netlist matches the board's pads on every example, and KiCad's DRC agrees.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "pdf-export.js", "board-fab.js", "kicad-export.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, K = globalThis.KicadExport;

// S-expressions: a small reader, enough to walk the files
function parse(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function item() {
    ws();
    if (text[i] === "(") { i++; const list = []; for (;;) { ws(); if (text[i] === ")") { i++; return list; } if (i >= text.length) throw new Error("unbalanced"); list.push(item()); } }
    if (text[i] === '"') { let s = ""; i++; while (text[i] !== '"') { if (text[i] === "\\") i++; s += text[i++]; } i++; return { str: s }; }
    const m = /^[^\s()"]+/.exec(text.slice(i)); i += m[0].length; return m[0];
  }
  const top = item(); ws();
  assert.equal(i, text.length, "nothing after the top-level list");
  return top;
}
const val = x => (x && typeof x === "object" && "str" in x ? x.str : x);
const kids = (list, head) => list.filter(x => Array.isArray(x) && x[0] === head);
const kid = (list, head) => kids(list, head)[0];

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const NETLIST = {
  names: { 0: "GND", 1: "B+" },
  volts: { 1: 300, 2: 150, 3: 1.5, 4: 0 },
  parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }),
    part("r1", "resistor", "R1", { r: 100e3, w: "0.5" }, { 1: 1, 2: 2 }),
    part("r2", "resistor", "R2", { r: 1.5e3 }, { 1: 3, 2: 0 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }),
    part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
    part("q1", "npn", "VT1", { model: "MPSA42" }, { C: 1, B: 2, E: 8 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 3, "-": 0 })
  ]
};
function layout() {
  const board = B.newBoard(); B.sync(board, NETLIST);
  board.outline = { w: 120, h: 80, r: 3 };
  Object.assign(board.parts.r1, { x: 30, y: 20, rot: 0 });
  Object.assign(board.parts.r2, { x: 30, y: 50, rot: 1, side: "B" });      // turned and on the bottom
  Object.assign(board.parts["v1a+v1b"], { x: 75, y: 40, rot: 2 });
  Object.assign(board.parts.q1, { x: 50, y: 65, rot: 3 });
  Object.assign(board.parts.c1, { x: 100, y: 20, rot: 0, side: "B" });
  Object.assign(board.parts.g1, { x: 100, y: 65, rot: 0 });
  const nl = B.withHeaters(NETLIST, board.rules);
  let m = B.model(board, nl);
  const a = m.pads.find(p => p.ref === "R1" && p.num === "2");
  board.tracks.push({ layer: "F.Cu", w: 0.6, pts: [[a.x, a.y], [a.x + 6, a.y], [a.x + 6, a.y + 4]] });
  board.vias.push({ x: 60, y: 30, drill: 0.8, pad: 1.8 });
  board.holes.push({ x: 5, y: 5, d: 3.2 }, { x: 115, y: 5, d: 3.2, plated: true, net: "GND" });
  board.texts.push({ x: 60, y: 75, text: "TUBE AMP", size: 2, layer: "B.SilkS", rot: 0 });
  board.zones.push({ net: "GND", layer: "B.Cu", pts: null });
  board.keepouts.push({ name: "under T1", pts: [[5, 60], [20, 60], [20, 75], [5, 75]], layers: ["F.Cu", "B.Cu"] });
  m = B.model(board, nl);
  return { board, nl, m, conn: B.connectivity(board, m.pads) };
}
// KiCad's placement: rotate a footprint's own point by the footprint's angle (counter-clockwise
// on a y-down board) and move it to the footprint's position
const kicadPlace = (at, x, y) => { const a = (+at[3] || 0) * Math.PI / 180, c = Math.round(Math.cos(a)), s = Math.round(Math.sin(a)); return [+at[1] + x * c + y * s, +at[2] - x * s + y * c]; };

test("the board: every pad where the board has it, with its net; bottom-side parts mirrored", () => {
  const { board, m, conn } = layout(), text = K.pcb(board, m, conn, { title: "Test amp", version: "9.9.9" }), pcb = parse(text);
  assert.equal(pcb[0], "kicad_pcb"); assert.equal(kid(pcb, "version")[1], "20221018");
  const nets = new Map(kids(pcb, "net").map(n => [n[1], val(n[2])]));
  assert.equal(nets.get("0"), "", "net 0 is no net");
  const fps = kids(pcb, "footprint"), ref = f => val(kids(f, "fp_text").find(t => t[1] === "reference")[2]);
  assert.equal(fps.length, m.parts.filter(g => g.place).length + board.holes.length, "a footprint for each placed part and each mounting hole");
  let checked = 0;
  m.pads.forEach(p => {
    const f = fps.find(x => ref(x) === p.ref); assert.ok(f, "footprint " + p.ref);
    const at = kid(f, "at"), pad = kids(f, "pad").find(q => val(q[1]) === p.num), [x, y] = kicadPlace(at, +kid(pad, "at")[1], +kid(pad, "at")[2]);
    assert.ok(Math.abs(x - p.x) < 1e-3 && Math.abs(y - p.y) < 1e-3, `${p.ref}-${p.num} at ${x.toFixed(3)}, ${y.toFixed(3)} (board: ${p.x}, ${p.y})`);
    const n = kid(pad, "net");
    assert.equal(n ? val(n[2]) : "", p.netName || "", `${p.ref}-${p.num} net`);
    if (n) assert.equal(nets.get(n[1]), p.netName, "the net's number names it");
    assert.equal(kid(f, "layer")[1].str, board.parts[p.part].side === "B" ? "B.Cu" : "F.Cu");
    checked++;
  });
  assert.ok(checked >= 15, checked + " pads");
  // the bottom part's silkscreen and courtyard are on the bottom layers; its texts mirrored
  const r2 = fps.find(f => ref(f) === "R2");
  assert.ok(kids(r2, "fp_rect").every(r => /^B\./.test(val(kid(r, "layer")[1]))), "R2's drawings on the bottom");
  assert.ok(kids(r2, "fp_text").every(t => JSON.stringify(t).includes("mirror")), "R2's texts mirrored");
  // every footprint names its symbol (the schematic part's id) for KiCad's Update PCB
  assert.equal(val(kid(fps.find(f => ref(f) === "VL1"), "path")[1]), "/" + K.symbolUuid("v1a"));
  // tracks take their pads' net, the via its own, the plated hole GND; the pour and the keep-out
  const seg = kids(pcb, "segment"); assert.equal(seg.length, 2);
  assert.ok(seg.every(s => nets.get(kid(s, "net")[1]) === m.pads.find(p => p.ref === "R1" && p.num === "2").netName), "the track's net");
  assert.equal(kids(pcb, "via").length, 1);
  const zones = kids(pcb, "zone"), pour = zones.find(z => !kid(z, "keepout")), ko = zones.find(z => kid(z, "keepout"));
  assert.equal(val(kid(pour, "net_name")[1]), "GND"); assert.ok(kid(pour, "polygon"));
  assert.equal(kid(kid(ko, "keepout"), "tracks")[1], "not_allowed"); assert.equal(kid(kid(ko, "keepout"), "footprints")[1], "allowed");
  const h2 = fps.find(f => ref(f) === "H2"); assert.equal(val(kid(kid(h2, "pad"), "net")[2]), "GND", "the plated mounting hole on GND");
  // the outline: four lines and four corner arcs on Edge.Cuts
  assert.equal(kids(pcb, "gr_line").length, 4); assert.equal(kids(pcb, "gr_arc").length, 4);
  assert.ok(kids(pcb, "gr_text").some(t => val(t[1]) === "TUBE AMP" && JSON.stringify(t).includes("mirror")), "bottom text mirrored");
  // the same input gives the same file (stable uuids)
  assert.equal(K.pcb(board, m, conn, { title: "Test amp", version: "9.9.9" }), text);
});

test("the footprint library, project, net classes and custom rules", () => {
  const { board, nl, m } = layout(), hv = B.hvNets(nl.volts, board.rules.hvVolts);
  const lib = K.footprintLib(m, board), names = Object.keys(lib);
  assert.ok(names.includes("TubeAmpCAD.pretty/SOCKET-B9A.kicad_mod") && names.some(n => /MountingHole_3\.2mm_Pad/.test(n)), names.join(", "));
  names.forEach(n => { const f = parse(lib[n]); assert.equal(f[0], "footprint"); });
  assert.match(K.FP_TABLE, /\$\{KIPRJMOD\}\/TubeAmpCAD\.pretty/);
  const pro = JSON.parse(K.project("amp", board, m, hv));
  assert.deepEqual(pro.net_settings.classes.map(c => c.name), ["Default", "Power", "HV"]);
  assert.equal(pro.net_settings.classes.find(c => c.name === "HV").clearance, board.rules.hvClearance);
  const pat = new Map(pro.net_settings.netclass_patterns.map(p => [p.pattern, p.netclass]));
  assert.equal(pat.get("B+"), "HV"); assert.equal(pat.get("GND"), "Power");
  // B+ at 300 V against GND needs IPC-2221's 1.25 mm, the HV class's 2 mm already covers it: no rule;
  // with the HV class at 0.5 mm the voltage rule appears
  board.rules.hvClearance = 0.5;
  const dru = K.rules(board, m, hv, nl);
  assert.match(dru, /^\(version 1\)/);
  assert.match(dru, /\(rule "IPC-2221 GND to B\+, 300 V"\s+\(constraint clearance \(min 1\.25mm\)\)/);
  // the TO-92's pins are closer than the low-voltage clearance: a rule inside its courtyard
  assert.match(dru, /\(rule "VT1 pin spacing, [^"]*"\s+\(constraint clearance \(min 0\.2\d*mm\)\)\s+\(condition "A\.insideCourtyard\('VT1'\)/);
  assert.match(dru, /\(rule "VT1 rings on a 1\.27 mm pitch"/);
});

test("the schematic: library symbols drawn y up, units, instances, sheets", () => {
  const sym = { name: "VL1", ref: "VL", value: "12AX7", footprint: "TubeAmpCAD:SOCKET-B9A", inBom: true, onBoard: true, units: [
    { shapes: [{ t: "poly", pts: [[0, 0], [2.54, 5.08]], fill: false }, { t: "circle", x: 0, y: -2.54, r: 1, fill: true }], texts: [{ x: 1, y: 2, text: "A", size: 1, angle: 90, h: "left", v: "bottom" }], pins: [{ x: 0, y: -10.16, num: "1", name: "A" }] },
    { shapes: [], texts: [], pins: [{ x: 0, y: 10.16, num: "6", name: "A" }] }] };
  const pwr = { name: "PWR_GND_g", power: true, ref: "#PWR", value: "GND", units: [{ shapes: [], texts: [], pins: [{ x: 0, y: 0, num: "1", name: "GND", type: "power_in", hidden: true }] }] };
  const sheet = (file, i) => ({ file, name: "S" + i, uuid: K.uuid("s" + i), paper: { size: "A4", w: 297, h: 210 }, title: { title: "Amp" }, wires: [[10, 10, 20, 10]], junctions: [[20, 10]], labels: [{ x: 20, y: 10, text: "B+", global: true }], notes: [{ x: 5, y: 5, text: "note" }],
    symbols: [{ lib: "VL1", unit: i, x: 50.8, y: 50.8, uuid: K.uuid("u" + i), ref: "VL1", value: "12AX7", inBom: true, onBoard: true, pins: [i === 1 ? "1" : "6"] }, { lib: "PWR_GND_g", unit: 1, x: 25.4, y: 25.4, uuid: K.uuid("p" + i), ref: "#PWR00" + i, value: "GND", pins: ["1"] }] });
  // one sheet: a flat schematic
  let files = K.schematic({ name: "amp", symbols: [sym, pwr], sheets: [sheet("amp.kicad_sch", 1)] });
  assert.deepEqual(Object.keys(files), ["amp.kicad_sch"]);
  let s = parse(files["amp.kicad_sch"]);
  assert.equal(kid(s, "version")[1], "20230121");
  const libs = kid(s, "lib_symbols"), vl = kids(libs, "symbol").find(x => val(x[1]) === "TubeAmpCAD:VL1");
  const units = kids(vl, "symbol").map(u => val(u[1]));
  assert.deepEqual(units, ["VL1_1_1", "VL1_2_1"], "a unit per section");
  const u1 = kids(vl, "symbol")[0], pl = kid(u1, "polyline"), pin = kid(u1, "pin");
  assert.deepEqual(kid(pl, "pts").slice(1).map(p => [+p[1], +p[2]]), [[0, 0], [2.54, -5.08]], "library symbols are drawn y up");
  assert.deepEqual(kid(pin, "at").slice(1).map(Number), [0, 10.16, 0]);
  assert.equal(val(kid(pin, "number")[1]), "1");
  assert.equal(kid(u1, "text")[2][3], "900", "a symbol text's angle in tenths of a degree");
  assert.ok(kids(libs, "symbol").find(x => val(x[1]) === "TubeAmpCAD:PWR_GND_g").some(x => Array.isArray(x) && x[0] === "power"));
  const placed = kids(s, "symbol");
  assert.equal(placed.length, 2);
  const inst = kid(kid(placed[0], "instances"), "project"), path = kid(inst, "path");
  assert.equal(val(path[1]), "/" + K.uuid("root:amp")); assert.equal(val(kid(path, "reference")[1]), "VL1");
  assert.ok(kid(s, "sheet_instances") && kids(s, "global_label").length === 1 && kids(s, "junction").length === 1);
  // two sheets: a root with a sheet symbol each, the parts' paths through their sheet
  files = K.schematic({ name: "amp", symbols: [sym, pwr], sheets: [sheet("amp-1.kicad_sch", 1), sheet("amp-2.kicad_sch", 2)] });
  assert.deepEqual(Object.keys(files), ["amp.kicad_sch", "amp-1.kicad_sch", "amp-2.kicad_sch"]);
  s = parse(files["amp.kicad_sch"]);
  assert.equal(kids(s, "sheet").length, 2);
  assert.ok(kids(s, "sheet").every(sh => kids(sh, "property").some(p => val(p[1]) === "Sheetfile")));
  const s2 = parse(files["amp-2.kicad_sch"]), p2 = kid(kid(kid(kids(s2, "symbol")[0], "instances"), "project"), "path");
  assert.equal(val(p2[1]), "/" + K.uuid("root:amp") + "/" + K.uuid("s2")); assert.equal(kid(p2, "unit")[1], "2");
  assert.ok(!kid(s2, "sheet_instances"), "only the root lists the sheets");
  // the library file holds the same symbols without the library's name
  const kl = parse(K.symbolLib([sym, pwr]));
  assert.deepEqual(kids(kl, "symbol").map(x => val(x[1])), ["VL1", "PWR_GND_g"]);
});

test("ShapeCanvas records what a symbol draws, in the coordinates it starts with", () => {
  const c = new K.ShapeCanvas([0.254, 0, 0, 0.254, 0, 0]);
  c.strokeStyle = "#c9d1d9"; c.fillStyle = "#0a0e14";
  c.translate(100, 0); c.rotate(Math.PI / 2);
  c.beginPath(); c.moveTo(0, 0); c.lineTo(10, 0); c.stroke();
  c.fillRect(0, 0, 10, 10);                                   // the dark background: left out
  c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.stroke();  // a whole circle
  c.beginPath(); c.arc(0, 0, 10, 0, Math.PI / 2); c.stroke();  // an arc: a polyline
  c.fillStyle = "#c9d1d9"; c.font = "bold 10px monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("Ω", 0, 0);
  assert.equal(c.shapes.length, 3);
  const [line, circle, arc] = c.shapes;
  assert.deepEqual(line.pts.map(p => p.map(v => +v.toFixed(4))), [[25.4, 0], [25.4, 2.54]], "turned 90°: x becomes y");
  assert.equal(circle.t, "circle"); assert.ok(Math.abs(circle.r - 2.54) < 1e-9 && Math.abs(circle.x - 25.4) < 1e-9);
  assert.equal(arc.t, "poly"); assert.ok(arc.pts.length > 3);
  const t = c.texts[0];
  assert.equal(t.text, "Ω"); assert.equal(t.angle, 270, "text turned with the drawing"); assert.equal(t.h, "center"); assert.equal(t.v, "center"); assert.ok(t.bold);
});

test("stable uuids and names KiCad accepts", () => {
  const u = K.uuid("sym:r1");
  assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(K.uuid("sym:r1"), u); assert.notEqual(K.uuid("sym:r2"), u);
  assert.equal(K.libName("VL1:A/B c"), "VL1_A_B_c");
  assert.equal(K.fpName({ name: "AXIAL-10.16", body: { l: 6.3, d: 2.5 } }), "AXIAL-10.16_d2.5_l6.3", "a part drawn to its own size is a footprint of its own");
  assert.deepEqual(K.paperFor(250, 150), { size: "A4", w: 297, h: 210 });
  assert.deepEqual(K.paperFor(300, 150), { size: "A3", w: 420, h: 297 });
  assert.equal(K.paperFor(2000, 100).size, "User");
});
