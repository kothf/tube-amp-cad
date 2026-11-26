/* The board as MöbiusCAD files (board-mcad.js, board-brep.js): part files shared by equal parts, an assembly that
   references them by path and SHA-256, the parts placed where the 3D scene draws them, a thermal study from the map. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runInThisContext } from "node:vm";
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-outline.js", "board-core.js", "board-fab.js", "board-3d.js", "board-thermal.js", "board-brep.js", "board-mcad.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, T = globalThis.BoardThermal, M = globalThis.BoardMcad, B3 = globalThis.Board3D, BR = globalThis.BoardBrep;
const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const R = (id, label, w, pins) => part(id, "resistor", label, { r: 1000, w }, pins);
function setup(date, r2) {
  const parts = [R("r1", "R1", "5", { 1: 1, 2: 2 }), Object.assign(R("r2", "R2", "5", { 1: 2, 2: 3 }), r2 ? { params: Object.assign({}, L.LIB.resistor.defaults, { r: r2, w: "5" }) } : {}), R("r3", "R3", "0.25", { 1: 3, 2: 0 }), part("c1", "capacitor", "C1", { c: 100e-6 }, { 1: 3, 2: 0 })];
  const netlist = { names: { 0: "GND" }, volts: {}, parts, heat: { r1: { p: 3 }, r2: { p: 2 }, r3: { p: 0.1 } } };
  const board = B.newBoard(); board.outline = { w: 100, h: 60, r: 3 };
  B.sync(board, netlist);
  const where = { R1: { x: 25, y: 30 }, R2: { x: 60, y: 20, rot: 1 }, R3: { x: 40, y: 50, rot: 2 }, C1: { x: 80, y: 45 } };
  Object.values(board.parts).forEach(bp => Object.assign(bp, where[bp.ref] || {}));
  board.holes = [{ x: 5, y: 5, d: 3.2 }];
  const model = B.model(board, netlist), res = T.solve(board, model, netlist);
  return { board, model, res, pk: M.pack(board, model, res, { name: "amp", title: "Test amp", version: "9.9.9", date: date || new Date(Date.UTC(2026, 10, 23, 12, 0, 0)) }) };
}
// a stored ZIP (what BoardFab.zip writes) read back: name → bytes
function unzip(u8) {
  const out = {}, dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let p = 0; dv.getUint32(p, true) === 0x04034b50;) {
    const size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true), xl = dv.getUint16(p + 28, true), name = new TextDecoder().decode(u8.subarray(p + 30, p + 30 + nl));
    out[name] = u8.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size); p += 30 + nl + xl + size;
  }
  return out;
}
const read = u8 => { const z = unzip(u8); return { manifest: JSON.parse(new TextDecoder().decode(z["manifest.json"])), doc: JSON.parse(new TextDecoder().decode(z["document.json"])) }; };

test("SHA-256 is the standard one", () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) & 255);
    assert.equal(M.sha256(b), createHash("sha256").update(b).digest("hex"), `${n} bytes`);
  }
});

test("the folder: an assembly and a part file per drawing, equal parts sharing one, every link's hash the file's", () => {
  const { pk } = setup();
  assert.deepEqual(Object.keys(pk.files).sort(), ["100µF BOX-22.5.mcadprt", "1kΩ 5W AXIAL-30.48.mcadprt", "1kΩ AXIAL-10.16.mcadprt", "Test amp board.mcadprt", "amp.mcadasm"]);
  const a = read(pk.files["amp.mcadasm"]);
  assert.deepEqual(a.manifest.format, "mobiuscad"); assert.equal(a.manifest.kind, "assembly"); assert.equal(a.manifest.schema, 1); assert.equal(a.manifest.app, "Tube Amp CAD 9.9.9");
  assert.equal(a.doc.kind, "assembly"); assert.equal(a.doc.name, "Test amp");
  assert.deepEqual(a.doc.components.map(c => c.name), ["PCB", "C1", "R1", "R2", "R3"]);
  assert.equal(a.doc.components.find(c => c.name === "R1").part, a.doc.components.find(c => c.name === "R2").part, "R1 and R2 are the same part");
  for (const c of a.doc.components) { assert.equal(c.tf.length, 12); assert.ok(c.fixed); assert.ok(a.doc.parts[c.part]); }
  for (const p of Object.values(a.doc.parts)) {
    const bytes = pk.files[p.link.path], r = read(bytes);
    assert.equal(p.file, p.link.path); assert.equal(p.link.hash, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(r.manifest.kind, "part"); assert.deepEqual(r.doc, p.doc, `${p.file}: the fallback copy is the file's document`);
    assert.ok(p.doc.features.length > 0 && p.doc.features.every((f, i) => f.type === "import" && f.id === `b${i + 1}` && /^CASCADE Topology V3/m.test(f.brep)));
    assert.deepEqual(Object.keys(p.doc.bodies), p.doc.features.map(f => f.id));
    assert.ok(Object.values(p.doc.bodies).every(b => b.material && b.material.name && b.material.density > 0 && b.material.k > 0 && b.material.cp > 0 && b.material.emis > 0 && b.material.emis <= 1));
  }
  const res = Object.values(a.doc.parts).find(p => p.name === "1kΩ 5W AXIAL-30.48").doc;
  assert.deepEqual(Object.values(res.bodies).map(b => [b.name, b.material.name]), [["Body", "Alumina, lacquered"], ["Lead 1", "Tinned copper"], ["Lead 2", "Tinned copper"], ["Lead 3", "Tinned copper"], ["Lead 4", "Tinned copper"]]);
  assert.equal(Object.values(a.doc.parts).find(p => p.name === "Test amp board").doc.material.name, "PCB (effective)");
});

test("parts drawn alike but of other values get files of their own, named by their value", () => {
  const { pk } = setup(undefined, 2200), a = read(pk.files["amp.mcadasm"]);
  const r1 = a.doc.components.find(c => c.name === "R1"), r2 = a.doc.components.find(c => c.name === "R2");
  assert.notEqual(r1.part, r2.part, "R2 (2.2k) does not share R1's (1k) file");
  assert.match(a.doc.parts[r2.part].name, /^2\.2kΩ 5W AXIAL-30\.48$/);
  assert.match(a.doc.parts[r1.part].name, /^1kΩ 5W AXIAL-30\.48$/);
});

test("every part lands where the 3D scene (and the STEP) draws it", () => {
  const { pk, board, model } = setup(), sc = B3.scene(board, model, { tubes: true }), byRef = new Map();
  sc.bodies.forEach(s => { if (!byRef.has(s.ref)) byRef.set(s.ref, []); byRef.get(s.ref).push(s); });
  let worst = 0, n = 0;
  for (const c of pk.asm.components.slice(1)) {
    const g = model.parts.find(x => x.ref === c.name), P0 = Object.assign({}, g.place, { x: 0, y: 0, rot: 0 }), loc = B3.partBodies(Object.assign({}, g, { place: P0 }), sc.t, { tubes: true }), wd = byRef.get(c.name), tf = c.tf;
    const ap = v => [0, 1, 2].map(i => tf[4 * i] * v[0] + tf[4 * i + 1] * v[1] + tf[4 * i + 2] * v[2] + tf[4 * i + 3]);
    assert.equal(loc.length, wd.length);
    loc.forEach((s, i) => {
      const rot = v => [0, 1, 2].map(k => tf[4 * k] * v[0] + tf[4 * k + 1] * v[1] + tf[4 * k + 2] * v[2]), d = (p, w) => Math.hypot(p[0] - w[0], p[1] - w[1], p[2] - w[2]);
      if (s.round) { const g = s.round, h = wd[i].round; worst = Math.max(worst, d(ap(g.o), h.o), d(rot(g.a), h.a), d(rot(g.x), h.x)); n += 3; }
      else s.verts.forEach((v, k) => { worst = Math.max(worst, d(ap(v), wd[i].verts[k])); n++; });
    });
  }
  assert.ok(n > 50 && worst < 1e-6, `${n} points, worst ${worst} mm`);
  // a quarter turn is a rotation about z
  const r2 = pk.asm.components.find(c => c.name === "R2").tf;
  assert.ok(Math.abs(r2[0]) < 1e-9 && Math.abs(Math.abs(r2[1]) - 1) < 1e-9 && r2[10] === 1);
  // the board part is the scene's board, unmoved
  assert.deepEqual(pk.asm.components[0].tf, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  assert.equal(pk.asm.parts.p_board.doc.features[0].brep, BR.write([sc.board]));
});

test("the thermal study: every part's heat and shares, the map's conditions, the board's copper cell by cell", () => {
  const { pk, res, board } = setup(), st = pk.asm.studies[0], l = st.loads[0];
  assert.equal(st.kind, "thermal"); assert.equal(st.name, "Thermal 1");
  assert.equal(st.settings.ambient, res.ambient); assert.equal(st.settings.enclosure, "closed"); assert.deepEqual(st.settings.down, [0, 0, -1]);
  assert.equal(l.type, "pkgheat"); assert.equal(l.board, "c_board"); assert.equal(l.split, true);
  const total = l.parts.reduce((s, p) => s + p.p, 0);
  assert.ok(Math.abs(total - 5.1) < 1e-6, `${total} W`);
  const r1 = l.parts.find(p => p.name === "R1"), p1 = res.parts.find(p => p.ref === "R1");
  assert.deepEqual(r1.bodies, ["Body"], "a resistor makes its heat in its body, not its leads");
  assert.deepEqual(r1.comps, ["c_R1"]); assert.equal(r1.limit, 155); assert.ok(Math.abs(r1.board - p1.toBoard) < 1e-3 && r1.board > 0.3);
  assert.ok(l.parts.every(p => p.board >= 0 && p.sink >= 0));
  // where R1's board share goes in: a disc on each of its pads, a rectangle under its lying body (board frame: y up)
  const pads = setup().model.pads.filter(p => p.part === res.parts.find(q => q.ref === "R1").key);
  assert.equal(r1.into.filter(q => q.disc).length, 2); assert.equal(r1.into.filter(q => q.rect).length, 1);
  assert.ok(Math.abs(r1.into.reduce((s, q) => s + q.w, 0) - r1.board) < 1e-3, "the regions' watts add up to the board share");
  for (const p of pads) assert.ok(r1.into.some(q => q.disc && Math.hypot(q.disc[0] - p.x, q.disc[1] + p.y) < 1e-6 && q.disc[2] > 0.5), `a disc on pad ${p.x}, ${p.y}`);
  const rc = r1.into.find(q => q.rect).rect; assert.ok(rc[0] < 25 && rc[2] > 25 && rc[1] < -30 && rc[3] > -30, `under the body at 25, −30: ${rc}`);
  assert.deepEqual(st.supports.map(s => s.type), ["conv", "rad"]); assert.ok(st.supports.every(s => s.all));
  const bd = st.comps.c_board.board, m = bd.map;
  assert.equal(bd.t, board.stackup.thickness); assert.equal(bd.layers, 2); assert.deepEqual(m.labels, ["F.Cu", "B.Cu"]);
  assert.equal(m.nu, res.nx); assert.equal(m.nv, res.ny); assert.equal(m.cell, res.step); assert.equal(Buffer.from(m.cov[0], "base64").length, m.nu * m.nv);
  assert.ok(m.holes >= 8 && Buffer.from(m.vias, "base64").some(v => v > 0));
  // the map's grid covers the board in the frame of its part: x from 0, y down to −h
  assert.equal(m.x0, 0); assert.ok(Math.abs(m.y0 + res.ny * res.step) < 1e-9); assert.deepEqual(m.at, { u: res.nx * res.step / 2, v: -res.ny * res.step / 2, swap: false });
  // a pad's copper is in the cell under it (rows from the bottom edge)
  const pad = setup().model.pads.find(p => !p.smd), cov = Buffer.from(m.cov[0], "base64"), i = Math.floor(pad.x / m.cell), j = Math.floor(pad.y / m.cell);
  assert.ok(cov[(m.nv - 1 - j) * m.nu + i] > 100, "copper under a pad");
});

test("names and ids stay the same from one export to the next; no simulation = geometry without a study", () => {
  const a = setup(new Date(Date.UTC(2026, 0, 1))).pk, b = setup(new Date(Date.UTC(2026, 5, 1))).pk;
  assert.deepEqual(Object.keys(a.files), Object.keys(b.files));
  assert.deepEqual(a.asm.components, b.asm.components); assert.equal(a.asm.id, b.asm.id);
  assert.deepEqual(Object.values(a.asm.parts).map(p => p.doc.id), Object.values(b.asm.parts).map(p => p.doc.id));
  const s = setup(), bare = M.pack(s.board, s.model, null, { name: "amp" });
  assert.equal(bare.asm.studies, undefined); assert.equal(Object.keys(bare.files).length, 5);
});
