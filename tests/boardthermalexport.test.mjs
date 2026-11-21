/* The thermal map as files (board-thermal-export.js): the mesh (.vtu), the heat sources (CSV), the manifest. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-outline.js", "board-core.js", "board-fab.js", "board-3d.js", "board-thermal.js", "board-thermal-export.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, T = globalThis.BoardThermal, X = globalThis.BoardThermalExport, B3 = globalThis.Board3D;
const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const R = (id, label, w, pins) => part(id, "resistor", label, { r: 1000, w }, pins);
function setup() {
  const parts = [R("r1", "R1", "5", { 1: 1, 2: 2 }), R("r2", "R2", "2", { 1: 2, 2: 3 }), R("r3", "R3", "0.25", { 1: 3, 2: 0 })];
  const netlist = { names: { 0: "GND" }, volts: {}, parts, heat: { r1: { p: 3 }, r2: { p: 0.8 } } };
  const board = B.newBoard(); board.outline = { w: 80, h: 60, r: 0 };
  B.sync(board, netlist);
  const where = { R1: { x: 25, y: 30 }, R2: { x: 55, y: 30 }, R3: { x: 40, y: 12 } };
  Object.values(board.parts).forEach(bp => Object.assign(bp, where[bp.ref] || {}));
  const model = B.model(board, netlist), res = T.solve(board, model, netlist);
  return { board, model, res, pk: X.pack(board, model, res, { name: "amp", title: "Test amp", version: "9.9.9", date: new Date(Date.UTC(2026, 10, 21, 20, 0, 0)), picture: true, step: true }) };
}
// a reader as another program would write it: the arrays of the one Piece, by name
function readVtu(text) {
  const piece = /<Piece NumberOfPoints="(\d+)" NumberOfCells="(\d+)">/.exec(text), arrays = {};
  for (const m of text.matchAll(/<DataArray type="(\w+)" Name="(\w+)"([^>]*)format="ascii">([^<]*)<\/DataArray>/g)) arrays[m[2]] = { type: m[1], comps: +(/NumberOfComponents="(\d+)"/.exec(m[3]) || [0, 1])[1], v: m[4].trim().split(/\s+/).map(Number) };
  return { nP: +piece[1], nC: +piece[2], arrays };
}

test("the package: four texts named after the design, a manifest another program can rely on", () => {
  const { pk, res } = setup(), m = pk.manifest;
  assert.deepEqual(Object.keys(pk.files).sort(), ["README-thermal.txt", "amp-heat-sources.csv", "amp-thermal.json", "amp-thermal.vtu"]);
  assert.equal(m.format, "tubecad-thermal"); assert.equal(m.version, 1);
  assert.equal(m.app, "Tube Amp CAD 9.9.9"); assert.equal(m.created, "2026-11-21T20:00:00Z"); assert.equal(m.design, "Test amp");
  assert.deepEqual(m.files, { manifest: "amp-thermal.json", mesh: "amp-thermal.vtu", sources: "amp-heat-sources.csv", readme: "README-thermal.txt", picture: "amp-thermal.png", step: "amp.step" });
  assert.deepEqual(m.units, { length: "mm", temperature: "C", power: "W", flux: "W/m2" });
  assert.equal(m.settings.ambient_C, 40); assert.equal(m.settings.enclosure, "closed"); assert.equal(m.settings.orientation, "horizontal-up"); assert.equal(m.settings.operating_point, "simulated");
  assert.equal(m.settings.grid_mm, res.step); assert.equal(m.accuracy_C, 15);
  assert.deepEqual(JSON.parse(pk.files["amp-thermal.json"]), m);
  assert.ok(Math.abs(m.total_W - 3.8) < 1e-6);
  assert.match(pk.files["README-thermal.txt"], /amp-thermal\.vtu[\s\S]*amp-heat-sources\.csv[\s\S]*amp-thermal\.json[\s\S]*amp\.step/);
});

test("the mesh is a valid unstructured grid: every cell's points exist, quads on the board, triangles on the parts", () => {
  const { pk, res, board } = setup(), v = readVtu(pk.files["amp-thermal.vtu"]), a = v.arrays;
  assert.match(pk.files["amp-thermal.vtu"], /^<\?xml version="1\.0"\?>\n<!--[^\n]*-->\n<VTKFile type="UnstructuredGrid" version="1\.0" byte_order="LittleEndian" header_type="UInt64">/);
  assert.equal(a.Points.comps, 3); assert.equal(a.Points.v.length, 3 * v.nP); assert.equal(a.Temperature_C.v.length, v.nP);
  for (const k of ["offsets", "types", "PartId", "Face", "Power_W", "HeatFlux_W_m2"]) assert.equal(a[k].v.length, v.nC, k);
  assert.equal(pk.manifest.mesh.points, v.nP); assert.equal(pk.manifest.mesh.cells, v.nC);
  assert.equal(a.offsets.v[v.nC - 1], a.connectivity.v.length);
  assert.ok(a.connectivity.v.every(i => Number.isInteger(i) && i >= 0 && i < v.nP));
  let prev = 0; const count = { 0: 0, 1: 0, 2: 0, 3: 0 };
  a.offsets.v.forEach((o, c) => { const n = o - prev; prev = o; const f = a.Face.v[c]; count[f]++; assert.equal(a.types.v[c], f ? 9 : 5); assert.equal(n, f ? 4 : 3); assert.equal(a.PartId.v[c] === 0, f !== 0); });
  // the board: a cell per square of the grid on each face, the edge round it; everything inside the board's box
  assert.equal(count[1], res.nx * res.ny); assert.equal(count[2], count[1]); assert.equal(count[3], 2 * (res.nx + res.ny)); assert.ok(count[0] > 30);
  const t = board.stackup.thickness;
  for (let c = 0, p = 0; c < v.nC; p = a.offsets.v[c++]) if (a.Face.v[c]) for (let k = p; k < a.offsets.v[c]; k++) { const i = a.connectivity.v[k], [x, y, z] = a.Points.v.slice(3 * i, 3 * i + 3); assert.ok(x >= 0 && x <= 80 && y <= 0 && y >= -60 && (z === 0 || z === t), `board point ${x}, ${y}, ${z}`); if (a.Face.v[c] === 1) assert.equal(z, t); if (a.Face.v[c] === 2) assert.equal(z, 0); }
  // the temperatures are the solver's: the same range, the hottest point the hottest part
  const lo = Math.min(...a.Temperature_C.v), hi = Math.max(...a.Temperature_C.v), r1 = res.parts.find(p => p.ref === "R1");
  assert.ok(Math.abs(hi - r1.t) < 0.01 && lo >= res.ambient - 0.01, `${lo}..${hi}`);
  assert.deepEqual(pk.manifest.range_C, [+lo.toFixed(1), +hi.toFixed(1)]);
  assert.equal(a.Ambient_C.v[0], 40); assert.equal(a.GridStep_mm.v[0], res.step);
  // the board gives off what the solver says: flux × area over both faces = the heat that went into the board
  const area = res.step * res.step * 1e-6; let out = 0; a.HeatFlux_W_m2.v.forEach((f, c) => { if (a.Face.v[c] === 1 || a.Face.v[c] === 2) out += f * area; });
  const into = res.parts.reduce((s, p) => s + p.toBoard, 0);
  assert.ok(Math.abs(out - into) < 0.02 * into, `the faces give off ${out} W of ${into} W`);
  // a part's cells carry its id and its whole power
  const row = pk.rows.find(r => r.designator === "R1"); let cells = 0;
  a.PartId.v.forEach((id, c) => { if (id === row.part_id) { cells++; assert.ok(Math.abs(a.Power_W.v[c] - 3) < 1e-6); } });
  assert.ok(cells >= 12);
});

test("the heat sources: one row per part, the hottest first, shares adding up, names that are the STEP's solids", () => {
  const { pk, board, model } = setup(), lines = pk.files["amp-heat-sources.csv"].trim().split("\r\n"), head = lines[0].split(",");
  assert.deepEqual(head, X.COLUMNS); assert.equal(head.slice(0, 4).join(","), "part_id,designator,step_bodies,part");
  const rows = lines.slice(1).map(l => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
  assert.deepEqual(rows.map(r => r.designator), ["R1", "R2", "R3"]); assert.deepEqual(rows.map(r => +r.part_id), [1, 2, 3]);
  const step = B3.step(B3.scene(board, model, { tubes: true }), { title: "t" });
  rows.forEach(r => {
    assert.ok(Math.abs(+r.p_board_W + +r.p_air_W + +r.p_sink_W - +r.p_total_W) < 0.01 * Math.max(0.5, +r.p_total_W), `${r.designator} shares`);
    r.step_bodies.split(";").forEach(n => assert.ok(step.includes(`MANIFOLD_SOLID_BREP('${n}',`), `${n} is a solid of the STEP`));
    assert.ok(+r.volume_mm3 > 10 && +r.dx_mm > 5 && +r.z_mm > 1.6, `${r.designator} box`);
    assert.equal(r.source, "simulated"); assert.equal(r.t_limit_C, "155");
    assert.ok(Math.abs(+r.margin_C - (155 - +r.t_body_C)) < 0.11);
  });
  assert.equal(rows[0].mount, "lying"); assert.ok(+rows[0].t_body_C > +rows[1].t_body_C && +rows[1].t_body_C > +rows[2].t_body_C && +rows[2].t_body_C >= 40);
  assert.equal(+rows[2].p_total_W, 0);
  // the manifest repeats them, with the box as min x, y, z, max x, y, z in the STEP's frame (y turned over)
  const m = pk.manifest.parts[0]; assert.equal(m.designator, "R1"); assert.deepEqual(m.step_bodies, rows[0].step_bodies.split(";"));
  assert.ok(m.bbox_mm[0] < 25 && m.bbox_mm[3] > 25 && m.bbox_mm[1] < -30 && m.bbox_mm[4] > -30 && m.bbox_mm[2] <= 1.6 && m.bbox_mm[5] > 3);
  assert.ok(Math.abs((m.bbox_mm[0] + m.bbox_mm[3]) / 2 - +rows[0].x_mm) < 0.01);
});

test("a board with a shape of its own: no cells in a cut-out, walls round it", () => {
  const s = setup(), OL = globalThis.BoardOutline;
  if (!OL || !OL.isShape) return;
  const res = s.res, hole = { ...res, top: res.top.slice(), bottom: res.bottom.slice() };
  const c = 5 * res.nx + 5; hole.top[c] = NaN; hole.bottom[c] = NaN;
  const sc = B3.scene(s.board, s.model, {}), rows = X.rows(hole, sc, { point: "sim" }), m = X.mesh(s.board, hole, sc, rows);
  const n = f => m.face.filter(v => v === f).length;
  assert.equal(n(1), res.nx * res.ny - 1); assert.equal(n(2), n(1)); assert.equal(n(3), 2 * (res.nx + res.ny) + 4);
});
