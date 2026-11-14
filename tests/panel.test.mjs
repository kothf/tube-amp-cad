/**
 * Panels (board-panelize.js): boards on a panel with rails, tabs and mouse bites or V-score,
 * fiducials, tooling holes; Gerbers read back (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-outline.js", "board-core.js", "pdf-export.js", "board-fab.js", "board-panelize.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab, BP = globalThis.BoardPanel;

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const NETLIST = {
  names: { 0: "GND", 1: "B+" }, volts: { 1: 300, 2: 150, 3: 1.5, 4: 0 },
  parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }),
    part("r1", "resistor", "R1", { r: 100e3, w: "0.5" }, { 1: 1, 2: 2 }),
    part("r2", "resistor", "R2", { r: 1.5e3 }, { 1: 3, 2: 0 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }),
    part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
    part("q1", "npn", "VT1", { model: "MPSA42" }, { C: 1, B: 2, E: 8 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 3, "-": 0 }),
    part("t1", "opt_se", "T1", {}, { P1: 1, P2: 2, S1: 9, S2: 0 }),
    part("gnd", "ground", "", {}, { G: 0 })
  ]
};
function fabBoard(w = 120, h = 90) {
  const board = B.newBoard(); B.sync(board, NETLIST); board.outline = { w, h, r: 4 };
  const at = { VL1: [30, 30], R1: [60, 15], R2: [30, 55], C1: [55, 55], VT1: [75, 30], G1: [15, 78], T1: [95, 60] };
  Object.values(board.parts).forEach(p => { Object.assign(p, { x: at[p.ref][0] * w / 120, y: at[p.ref][1] * h / 90 }); if (p.ref === "T1") p.fp = "TERM-5.08-4"; });
  board.holes = B.cornerHoles(board.outline, 3.2, 5);
  board.zones.push({ net: "GND", layer: "B.Cu", pts: null, thermal: true, gap: 0.5, spoke: 0.8 });
  return board;
}
function piece(w, h) {
  const board = fabBoard(w, h), m = B.model(board, NETLIST), hv = B.hvNets(NETLIST.volts, board.rules.hvVolts), c0 = B.connectivity(board, m.pads), fills = B.fillZones(board, m, c0, hv);
  return { board, m, fills, pc: BP.pieceOfBoard(board, m, fills, { title: "Test" }) };
}

test("the board as a piece: its corner at 0, 0 and its size, every layer of its Gerbers", () => {
  const { pc } = piece();
  assert.equal(pc.w, 120); assert.equal(pc.h, 90);
  assert.deepEqual(pc.copper, ["F.Cu", "B.Cu"]);
  for (const l of ["F.Cu", "B.Cu", "F.Mask", "B.Mask", "F.SilkS"]) assert.ok(pc.layers[l].length, l);
  assert.equal(pc.loops.length, 1);
  assert.ok(pc.drills.pth.length && pc.drills.npth.length, "pads' and mounting holes");
});

test("2 × 2 with rails top and bottom and mouse bites: size, tabs on every board, bites, fiducials, tooling holes", () => {
  const { pc } = piece();
  const lay = BP.layout({ items: [{ src: "this", rows: 2, cols: 2 }] }, { this: pc });
  assert.deepEqual(lay.errors, []);
  assert.equal(lay.W, 242); assert.equal(lay.H, 5 + 2 + 90 + 2 + 90 + 2 + 5);
  assert.equal(lay.boards.length, 4);
  lay.boards.forEach((b, i) => assert.ok(lay.tabs.some(t => t.a === i || t.b === i), `board ${i + 1} is held`));
  // tabs: between the two columns (2), the two rows (4: 120 mm sides, 2 tabs each... of which one row pair) and to the rails
  assert.ok(lay.tabs.filter(t => t.b === "rail").length >= 4, "the outer boards reach the rails");
  assert.ok(lay.tabs.some(t => t.b !== "rail"), "board to board");
  // no two tabs between the same boards at the same place
  lay.tabs.forEach((t, i) => lay.tabs.slice(i + 1).forEach(u => assert.ok(!(t.a === u.a && t.b === u.b && Math.hypot(t.cx - u.cx, t.cy - u.cy) < 1), "duplicate tab")));
  // a tab's sides cross the 2 mm gap
  lay.tabs.forEach(t => assert.ok(Math.abs(Math.hypot(t.q1[0] - t.p1[0], t.q1[1] - t.p1[1]) - 2) < 0.01, "tab spans the gap"));
  assert.ok(lay.bites.length >= lay.tabs.length * 2 * 2, "a row of holes at both ends of each tab");
  assert.equal(lay.fids.length, 3); assert.equal(lay.tools.length, 4);
  lay.tools.forEach(([x, y]) => assert.ok(y === 2.5 || y === lay.H - 2.5));
});

test("panel files: every layer, the edge with the tabs' gaps, drills with bites and tooling holes; read back as a piece", () => {
  const { pc } = piece();
  const { files, lay } = BP.files({ items: [{ src: "this", rows: 1, cols: 3 }] }, { this: pc }, { base: "t", title: "Test", version: "9.9.9", date: "2026-11-14" });
  assert.ok(files, JSON.stringify(lay.errors));
  for (const s of ["F_Cu", "B_Cu", "F_Mask", "B_Mask", "F_Silkscreen", "Edge_Cuts"]) assert.ok(files[`t-panel-${s}.gbr`], s);
  assert.match(files["t-panel-F_Cu.gbr"], /FiducialPad,Panel/);
  assert.match(files["t-panel-NPTH.drl"], /MechanicalDrill,Breakout/);
  assert.match(files["t-panel-NPTH.drl"], /MechanicalDrill,Tooling/);
  assert.match(files["t-panel-README.txt"], /3 boards/);
  // the panel's own files make a piece again, of the panel's size
  const back = BP.pieceFromFiles(files, "panel");
  assert.ok(Math.abs(back.w - lay.W) < 0.05 && Math.abs(back.h - lay.H) < 0.05, `${back.w} × ${back.h} vs ${lay.W} × ${lay.H}`);
  const holes = t => t.reduce((s, [, p]) => s + p.length, 0);
  assert.equal(holes(back.drills.npth), holes(pc.drills.npth) * 3 + lay.bites.length + lay.tools.length);
  assert.equal(holes(back.drills.pth), holes(pc.drills.pth) * 3);
  // the edge is open where tabs cross: no single closed loop per board any more
  assert.ok(BP.chain(BP.parseGerber(files["t-panel-Edge_Cuts.gbr"]).ops.map(o => o.pts)).length > 3);
});

test("a board's own Gerber ZIP read back: the same size, layers and holes", async () => {
  const { board, m, fills, pc } = piece();
  const zip = F.zip(F.fabFiles(board, m, fills, { base: "t", title: "Test", version: "9.9.9" }));
  const files = await BP.unzip(zip), back = BP.pieceFromFiles(files, "t");
  assert.equal(back.w, pc.w); assert.equal(back.h, pc.h);
  assert.deepEqual(back.copper, ["F.Cu", "B.Cu"]);
  assert.equal(back.layers["F.Cu"].filter(o => o.t === "flash").length, pc.layers["F.Cu"].filter(o => o.t === "flash").length);
  const holes = t => t.reduce((s, [, p]) => s + p.length, 0);
  assert.equal(holes(back.drills.pth), holes(pc.drills.pth));
  assert.equal(holes(back.drills.npth), holes(pc.drills.npth));
  // pads land where they were
  const a = pc.layers["F.Cu"].filter(o => o.t === "flash").map(o => [o.x, o.y]).sort(), b = back.layers["F.Cu"].filter(o => o.t === "flash").map(o => [o.x, o.y]).sort();
  a.forEach((p, i) => assert.ok(Math.abs(p[0] - b[i][0]) < 1e-3 && Math.abs(p[1] - b[i][1]) < 1e-3));
});

test("Gerber arcs (KiCad's rounded corners) and RoundRect pads are read", () => {
  const g = ["%FSLAX46Y46*%", "%MOMM*%", "%AMRoundRect*0 Rectangle with rounded corners*21,1,$2,$3,0,0,0*%", "%ADD10C,0.100000*%", "%ADD11RoundRect,0.25X-0.5X-0.75X0.5X-0.75X0.5X0.75X-0.5X0.75X0*%", "G01*", "D10*",
    "X0Y0D02*", "X10000000Y0D01*", "G75*", "G03*", "X12000000Y2000000I0J2000000D01*", "G01*", "D11*", "X5000000Y-5000000D03*", "M02*"].join("\n");
  const r = BP.parseGerber(g), line = r.ops.find(o => o.t === "line"), pad = r.ops.find(o => o.t === "flash");
  assert.ok(line.pts.length > 3, "the arc is drawn in steps");
  const end = line.pts[line.pts.length - 1]; assert.deepEqual(end, [12, -2]);
  // the arc's midpoint is 2 mm from (10, -2)
  line.pts.slice(2).forEach(p => assert.ok(Math.abs(Math.hypot(p[0] - 10, p[1] + 2) - 2) < 1e-3));
  assert.equal(pad.w, 1.5); assert.equal(pad.h, 2); assert.equal(pad.y, 5);
});

test("V-score: lines edge to edge between the boards and at the rails; boards of other sizes in the way are refused", () => {
  const { pc } = piece();
  const lay = BP.layout({ mode: "vscore", items: [{ src: "this", rows: 2, cols: 2 }] }, { this: pc });
  assert.deepEqual(lay.errors, []);
  assert.equal(lay.W, 240); assert.equal(lay.H, 190);
  assert.equal(lay.vscore.length, 4, "one x line (120) and three y lines (the rails at 5 and 185, between the rows at 95)");
  const small = piece(60, 40).pc;
  const bad = BP.layout({ mode: "vscore", items: [{ src: "this", rows: 1, cols: 1 }, { src: "s", rows: 1, cols: 1 }] }, { this: pc, s: small });
  assert.ok(bad.errors.some(e => /V-score/.test(e)));
  // with mouse bites the same mix works
  const ok = BP.layout({ items: [{ src: "this", rows: 1, cols: 1 }, { src: "s", rows: 2, cols: 1 }] }, { this: pc, s: small });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.boards.length, 3);
});

test("a quarter turn swaps the board's width and height and turns its parts in the placement file", () => {
  const { pc } = piece();
  const lay = BP.layout({ rails: "none", items: [{ src: "this", rows: 1, cols: 2, rot: 1 }] }, { this: pc });
  assert.equal(lay.boards[0].w, 90); assert.equal(lay.boards[0].h, 120);
  assert.equal(lay.W, 182); assert.equal(lay.H, 120);
  assert.ok(lay.warnings.some(w => /No rails/.test(w)));
  assert.ok(lay.tabs.length >= 2, "the two boards hold each other");
});

test("different layer stacks cannot share a panel; a missing board is reported", () => {
  const { pc } = piece(), four = { ...pc, copper: ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"], name: "Four" };
  const lay = BP.layout({ items: [{ src: "this", rows: 1, cols: 1 }, { src: "f", rows: 1, cols: 1 }, { src: "gone", rows: 1, cols: 1 }] }, { this: pc, f: four });
  assert.ok(lay.errors.some(e => /layer stack/.test(e)));
  assert.ok(lay.warnings.some(w => /missing/.test(w)));
});

test("cutting a closed contour keeps the long way round", () => {
  const c = { pts: [[0, 0], [10, 0], [10, 10], [0, 10]], closed: true };
  c.S = BP.lengths(c);
  const out = BP.cutContour(c, [[4, 6]]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0][0], [6, 0]); assert.deepEqual(out[0][out[0].length - 1], [4, 0]);
});

test("round boards: tabs where the edges come closest, every board held", () => {
  const board = B.newBoard(); B.sync(board, { names: {}, volts: {}, parts: [] });
  board.outline = globalThis.BoardOutline.circleOutline(60);
  const m = B.model(board, { names: {}, volts: {}, parts: [] }), pc = BP.pieceOfBoard(board, m, [], { title: "Round" });
  assert.ok(Math.abs(pc.w - 60) < 0.01 && Math.abs(pc.h - 60) < 0.01);
  const lay = BP.layout({ items: [{ src: "this", rows: 2, cols: 2 }] }, { this: pc });
  assert.deepEqual(lay.errors, []);
  lay.boards.forEach((b, i) => assert.ok(lay.tabs.filter(t => t.a === i || t.b === i).length >= 2, `board ${i + 1}`));
  // a tab spans the circle-to-rail distance, a little over the gap
  lay.tabs.filter(t => t.b === "rail").forEach(t => { const d = Math.hypot(t.q1[0] - t.p1[0], t.q1[1] - t.p1[1]); assert.ok(d > 2 && d < 2.3, d); });
  const vs = BP.layout({ mode: "vscore", items: [{ src: "this", rows: 1, cols: 2 }] }, { this: pc });
  assert.ok(vs.warnings.some(w => /not a plain rectangle/.test(w)));
});

test("slots in a drill file: KiCad's routed oval holes and G85 come through the panel as slots", () => {
  const drl = ["M48", "; #@! TF.FileFunction,Plated,1,2,PTH", "FMAT,2", "METRIC", "T1C1.000", "T2C1.200", "%", "G90", "G05",
    "T1", "X10.0Y-20.0",
    "T2", "G00X30.0Y-20.0", "M15", "G01X33.0Y-20.0", "M16", "G05",
    "X40.0Y-20.0G85X40.0Y-24.0", "M30"].join("\n");
  const d = BP.parseExcellon(drl);
  assert.deepEqual(d.errors, []);
  assert.deepEqual(d.tools, [["1.000", [[10, 20]]], ["1.200", [[30, 20, 33, 20], [40, 20, 40, 24]]]]);
  // turned a quarter and written again: the slots are G85 lines with both ends moved
  const pc = { name: "s", layers: { "F.Cu": [], "B.Cu": [] }, loops: [[[0, 0], [50, 0], [50, 30], [0, 30]]], drills: { pth: d.tools.map(([dia, pts]) => [dia, pts, "ComponentDrill"]), npth: [] }, pos: [], copper: ["F.Cu", "B.Cu"] };
  const out = F.excellon(pc.drills.pth, true, { outline: { w: 50, h: 30 } }, {});
  assert.match(out, /X30\.000Y10\.000G85X33\.000Y10\.000/);
  const back = BP.parseExcellon(out);
  assert.equal(back.tools[1][1].length, 2);
  assert.equal(back.tools[1][1][0].length, 4);
});
