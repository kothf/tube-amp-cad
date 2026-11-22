/**
 * A drawn or imported footprint's own 3D body (board-3d.js fp.body3d, cad-fpedit.js): the shapes, the
 * suggested body, a KiCad footprint's fabrication outline, and what follows from the body: the 3D
 * solids, STEP's true cylinders, the enclosure height check and the thermal map (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "kicad-import.js", "part-lib.js", "board-outline.js", "board-core.js", "board-3d.js", "board-thermal.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const L = globalThis.CadLib, P = globalThis.PartLib, K = globalThis.KicadImport, B = globalThis.BoardCore, D = globalThis.Board3D, T = globalThis.BoardThermal;

const two = (pitch, name) => P.fpPattern("two", { pitch }, name || "MY-RES");
const top = (sol, t = 1.6) => Math.max(...sol.flatMap(s => s.verts.map(v => v[2] - t)));
const at = fp => ({ ref: "X1", type: "part", fp: { ...fp, name: "LIB:" + fp.name, custom: true }, place: { x: 20, y: 20, rot: 0, side: "F" } });

test("the suggested body: a DIP's pads the DIP package, an SOIC's the SOIC, two drilled pads a lying cylinder, the rest a block", () => {
  assert.deepEqual(D.defaultBody(P.fpPattern("dip", { n: 14 }, "x")), { shape: "pkg", pkg: "DIP-14", x: 0, y: 0, z: 0, rot: 0 });
  assert.equal(D.defaultBody(P.fpPattern("soic", { n: 8 }, "x")).pkg, "SOIC-8");
  const r = D.defaultBody(two(15.24));
  assert.equal(r.shape, "cylx"); assert.ok(r.l > 8 && r.l < 15.24 - 2, `between the pads (${r.l} mm)`);
  const q = D.defaultBody(P.fpPattern("quad", { n: 32 }, "x"));
  assert.equal(q.shape, "box"); assert.equal(q.h, 1, "surface pads: a low block");
  assert.equal(D.defaultBody(two(10.16), "cylz").shape, "cylz", "a shape asked for is sized from the outline");
});

test("each shape: its solids stand on the board at the height asked, leads go into the drilled pads", () => {
  const fp = two(10.16);
  const cases = [[{ shape: "box", l: 6, w: 3, h: 4 }, 4], [{ shape: "cylz", d: 8, h: 12, z: 1 }, 13], [{ shape: "cylx", l: 6, d: 2.5, z: 0.4 }, 2.9], [{ shape: "outline", h: 2 }, 2], [{ shape: "pkg", pkg: "TO-220-GDS" }, 18]];
  for (const [b, h] of cases) {
    const g = at({ ...fp, body3d: b }), sol = D.partBodies(g, 1.6, {});
    assert.ok(Math.abs(top(sol) - h) < 0.01, `${b.shape} ${b.pkg || ""}: ${top(sol)} mm tall, want ${h}`);
    assert.equal(D.bodyHeight(g.fp), h);
    assert.ok(sol.filter(s => s.color === D.COLORS.lead).length >= 2, `${b.shape}: a lead into each pad`);
  }
  const none = D.partBodies(at({ ...fp, body3d: { shape: "none" } }), 1.6, {});
  assert.ok(none.every(s => s.color === D.COLORS.lead), "no body: only the leads");
});

test("a built-in package on its own pads keeps its leads; turned and moved, it follows; a colour picked is used", () => {
  const dip = B.footprint("DIP-8"), mine = { ...dip, name: "MY-DIP", silk: dip.silk, body3d: { shape: "pkg", pkg: "DIP-8" } };
  const own = D.partBodies(at(mine), 1.6, {}), builtIn = D.partBodies({ ref: "X1", type: "part", fp: dip, place: { x: 20, y: 20, rot: 0, side: "F" } }, 1.6, {});
  assert.equal(own.length, builtIn.length);
  assert.deepEqual(own.map(s => s.verts.length), builtIn.map(s => s.verts.length));
  const g = at({ ...two(10.16), body3d: { shape: "box", l: 8, w: 2, h: 3, rot: 90, x: 1, color: "red" } });
  const body = D.partBodies(g, 1.6, {}).find(s => s.color !== D.COLORS.lead), xs = body.verts.map(v => v[0]), ys = body.verts.map(v => v[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2) < 1e-6 && Math.abs(Math.max(...ys) - Math.min(...ys) - 8) < 1e-6, "turned a quarter: 2 mm across, 8 mm along y");
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 21) < 1e-6, "moved 1 mm to the right");
  assert.deepEqual(body.color, D.BODY_COLORS.red[1]);
});

test("the extruded outline: the silkscreen's closed outline raised", () => {
  const fp = P.fpPattern("sip", { n: 4 }, "ROW"), loop = D.outlineLoop(fp);
  assert.equal(loop.length, 4, "the rectangle round the row");
  const sol = D.partBodies(at({ ...fp, body3d: { shape: "outline", h: 6 } }), 1.6, {}).find(s => s.color !== D.COLORS.lead);
  assert.equal(sol.faces.length, 6);
});

test("bodies are tidied: unknown shapes dropped, sizes kept positive, an unknown package replaced", () => {
  assert.equal(D.bodyTidy({ shape: "sphere" }), null);
  assert.equal(D.bodyTidy({ shape: "box", l: -3, w: "2", h: 0 }).l, 0.1);
  assert.equal(D.bodyTidy({ shape: "pkg", pkg: "NOPE" }).pkg, "TO-220-GDS");
  assert.equal(D.bodyTidy({ shape: "box", rot: -90 }).rot, 270);
  for (const [, name] of D.BODY_PACKAGES) assert.ok(B.footprint(name), `${name} is a built-in footprint`);
});

test("a KiCad footprint: its fabrication outline is kept and gives its body; a round one a can", () => {
  const mod = `(footprint "CAP_TEST" (layer "F.Cu")
    (fp_circle (center 0 0) (end 4 0) (layer "F.Fab") (width 0.1))
    (fp_line (start -5 -5) (end 5 -5) (layer "F.SilkS") (width 0.12))
    (pad "1" thru_hole rect (at -1.75 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask"))
    (pad "2" thru_hole circle (at 1.75 0) (size 1.6 1.6) (drill 0.8) (layers "*.Cu" "*.Mask")))`;
  const f = K.readFootprint(mod, "CAP_TEST");
  assert.deepEqual(f.fab, [-4, -4, 4, 4]); assert.equal(f.fabRound, true);
  const b = D.defaultBody(f);
  assert.equal(b.shape, "cylz"); assert.equal(b.d, 8);
  // on the board with no body set: the can, not the grey block, and it has a height for the checks
  B.registerFootprints({ footprints: { "KICAD:CAP_TEST": f } });
  const fp = B.footprint("KICAD:CAP_TEST");
  assert.equal(fp.zHeight, 12.8);
  const sol = D.partBodies({ ref: "C1", type: "part", fp, place: { x: 10, y: 10, rot: 0, side: "F" } }, 1.6, {});
  assert.ok(sol.some(s => s.round), "a true cylinder");
});

test("on a board: the 3D scene, STEP with a cylinder, the enclosure height check and the thermal map use the body", () => {
  const lib = P.empty(), f = two(10.16, "TALL-CAN");
  f.body3d = { shape: "cylz", d: 10, h: 20 };
  const part = P.blank("CAN", "C"); part.units[0].pins.forEach((p, i) => { p.num = String(i + 1); }); part.fp = f.name;
  P.add(lib, [part], { [f.name]: f });
  const lp = lib.parts[0], c = { id: "a", type: "part", label: "C1", params: P.params(lib, lp, 1) };
  const netlist = { names: { 1: "IN" }, parts: [{ id: "a", type: "part", label: "C1", params: c.params, pins: L.LIB.part.pins(c).map((q, i) => ({ id: q.id, net: i ? 0 : 1 })) }] };
  const board = B.newBoard(); board.outline = { w: 40, h: 30, r: 0 }; B.sync(board, netlist);
  Object.values(board.parts).forEach(p => Object.assign(p, { x: 20, y: 15 }));
  const m = B.model(board, netlist), g = m.parts[0];
  assert.equal(g.fp.name, "LIB:TALL-CAN"); assert.equal(g.fp.zHeight, 20);
  const sc = D.scene(board, m, {}), body = sc.bodies.find(s => s.round && s.color !== D.COLORS.lead);
  assert.ok(body && Math.abs(Math.max(...body.verts.map(v => v[2])) - 21.6) < 1e-6, "the can in the scene, 20 mm over the board's top");
  assert.match(D.step(sc, { date: "2026-01-01T00:00:00" }), /CYLINDRICAL_SURFACE/);
  board.rules.maxHeight = 15;
  const conn = B.connectivity(board, m.pads), drc = B.drc(board, m, conn, new Set(), [], netlist);
  assert.ok(drc.some(d => d.kind === "height" && /C1 is 20 mm tall/.test(d.msg)), "taller than the enclosure: reported");
  if (T) {
    netlist.heat = { a: 1 };
    const r = T.solve(board, m, netlist, {});
    const p = r.ok && r.parts.find(x => x.ref === "C1");
    assert.ok(p, `the part is in the thermal map (${r.why || ""})`); assert.ok(p.box.z1 - p.box.z0 > 19, "the thermal map takes the body's height");
  }
});
