/**
 * Driving dimensions in the Board window (board-dims.js): horizontal, vertical, aligned and
 * point-to-line dimensions and the align constraints move what they hold; the least-change solver
 * leaves the rest alone, keeps a body the user moved where it was put, finds an over-constrained
 * dimension, tells which bodies are fully defined, and is quick on 100 dimensions; the board's
 * outline is driven too: its width and height, a sketched outline's edges, arcs and circles
 * (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "cad-components.js", "mpn.js", "board-outline.js", "board-core.js", "board-fab.js", "board-construct.js", "board-dims.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const D = globalThis.BoardDims, B = globalThis.BoardCore, K = globalThis.BoardConstruct;
const near = (a, b, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
function board() {
  const b = B.newBoard(); b.outline = { w: 100, h: 60, r: 0 };
  b.holes = [{ id: "h1", x: 10, y: 50, d: 3.2 }, { id: "h2", x: 40, y: 45, d: 3.2 }, { id: "h3", x: 70, y: 20, d: 3.2 }];
  b.vias = [{ id: "v1", x: 50, y: 30 }];
  b.keepouts = [{ id: "k1", pts: [[60, 10], [80, 10], [80, 25], [60, 25]] }];
  D.normalise(b); return b;
}
// solve and apply, as the Board window does
function run(b, opts) { const r = D.solve(b, null, opts); r.T.forEach(([dx, dy], k) => D.moveBody(b, k, dx, dy)); return r; }
const hole = (b, id) => b.holes.find(h => h.id === id);

test("horizontal and vertical dimensions move the second hole; values in the user frame (Y up)", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 25 });
  b.dims.items.push({ id: "d2", k: "dy", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 12 });
  const r = run(b, { prefer: new Set(["hole:h2"]) });
  assert.ok(r.ok);
  near(hole(b, "h2").x, 35); near(hole(b, "h2").y, 38);   // 12 mm above h1: y down is 50 − 12
  near(hole(b, "h1").x, 10, 0.01); near(hole(b, "h1").y, 50, 0.01);   // the first barely moves
  near(D.measure(D.makeEnv(b, null), b.dims.items[0]), 25);
});

test("from a board corner and an edge (they never move); aligned distance; point to a keep-out edge", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "board", at: "BL" }, b: { t: "hole", id: "h1" }, v: 5 });
  b.dims.items.push({ id: "d2", k: "pl", a: { t: "hole", id: "h1" }, b: { t: "edge", k: 0 }, v: 6 });
  assert.ok(run(b).ok);
  near(hole(b, "h1").x, 5); near(60 - hole(b, "h1").y, 6);
  b.dims.items.push({ id: "d3", k: "dist", a: { t: "hole", id: "h1" }, b: { t: "via", id: "v1" }, v: 20 });
  assert.ok(run(b, { prefer: new Set(["via:v1"]) }).ok);
  const v = b.vias[0]; near(Math.hypot(v.x - 5, v.y - 54), 20);
  // a keep-out slides whole to sit 3 mm right of hole 3 (its left edge, corner 4 → 1 runs up)
  b.dims.items.push({ id: "d4", k: "pl", a: { t: "hole", id: "h3" }, b: { t: "koe", id: "k1", k: 3 }, v: 0 });
  b.dims.items[3].v = D.measure(D.makeEnv(b, null), b.dims.items[3]);
  near(Math.abs(b.dims.items[3].v), 10);
  b.dims.items[3].v = Math.sign(b.dims.items[3].v) * 3;
  assert.ok(run(b, { prefer: new Set(["ko:k1"]) }).ok);
  near(b.keepouts[0].pts[0][0], 67); near(b.keepouts[0].pts[2][0], 87);
  near(hole(b, "h3").x, 70, 0.01);
});

test("align horizontally / vertically", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "hz", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h3" } });
  b.dims.items.push({ id: "d2", k: "vt", a: { t: "hole", id: "h2" }, b: { t: "via", id: "v1" } });
  assert.ok(run(b, { prefer: new Set(["hole:h3", "via:v1"]) }).ok);
  near(hole(b, "h3").y, hole(b, "h1").y); near(b.vias[0].x, hole(b, "h2").x);
});

test("a body the user moved stays put and the others follow; a locked one never moves", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 30 });
  b.dims.items.push({ id: "d2", k: "dy", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 5 });
  assert.ok(run(b).ok);
  hole(b, "h1").x += 7; hole(b, "h1").y -= 2;   // dragged
  const x1 = hole(b, "h1").x, y1 = hole(b, "h1").y;
  assert.ok(run(b, { pinned: new Set(["hole:h1"]) }).ok);
  near(hole(b, "h1").x, x1, 1e-3); near(hole(b, "h1").y, y1, 1e-3);
  near(hole(b, "h2").x - hole(b, "h1").x, 30); near(hole(b, "h1").y - hole(b, "h2").y, 5);
  // dragged against something fixed: it slides along what is free (here up and down), not back
  const c = board(); c.dims.items.push({ id: "e1", k: "dx", a: { t: "board", at: "BL" }, b: { t: "hole", id: "h1" }, v: 10 });
  assert.ok(run(c).ok); hole(c, "h1").x += 5; hole(c, "h1").y -= 7;
  assert.ok(run(c, { pinned: new Set(["hole:h1"]) }).ok);
  near(hole(c, "h1").x, 10); near(hole(c, "h1").y, 43, 1e-3);
  hole(b, "h2").locked = true; b.dims.items[0].v = 20;
  assert.ok(run(b).ok);
  near(hole(b, "h2").x - hole(b, "h1").x, 20); assert.equal(hole(b, "h2").x, 40 + 7);   // h1 went instead
});

test("over-constrained: a third dimension that contradicts fails, one that is implied is redundant", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 30 });
  b.dims.items.push({ id: "d2", k: "dx", a: { t: "hole", id: "h2" }, b: { t: "hole", id: "h3" }, v: 30 });
  assert.ok(run(b).ok);
  const d3 = { id: "d3", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h3" }, v: 50 };
  b.dims.items.push(d3);
  assert.ok(D.redundant(b, null, d3));
  const r = D.solve(b, null, {});
  assert.equal(r.ok, false); assert.ok(r.bad.length);
  d3.v = 60; assert.ok(D.solve(b, null, {}).ok);   // consistent: met, though it adds nothing
  const d4 = { id: "d4", k: "dy", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h3" }, v: 5 };
  b.dims.items.push(d4); assert.equal(D.redundant(b, null, d4), false);
});

test("freedom: fixed in X and Y once tied to the board twice; free otherwise", () => {
  const b = board();
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "board", at: "BL" }, b: { t: "hole", id: "h1" }, v: 10 });
  let f = D.freedom(b, null);
  assert.deepEqual(f.get("hole:h1"), { x: true, y: false });
  b.dims.items.push({ id: "d2", k: "dy", a: { t: "board", at: "BL" }, b: { t: "hole", id: "h1" }, v: 10 });
  b.dims.items.push({ id: "d3", k: "dist", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 31 });
  f = D.freedom(b, null);
  assert.deepEqual(f.get("hole:h1"), { x: true, y: true });
  assert.deepEqual(f.get("hole:h2"), { x: false, y: false });   // it can still swing round h1
});

test("parts and pads: a pad's dimension slides its part; construction points count as fixed", () => {
  const b = board();
  b.parts = { R1: { ref: "R1", fp: "R_Axial_10mm", x: 20, y: 20, rot: 0 } };
  const model = { pads: [{ part: "R1", num: "1", x: 15, y: 20 }, { part: "R1", num: "2", x: 25, y: 20 }], parts: [{ key: "R1", place: b.parts.R1 }] };
  b.dims.items.push({ id: "d1", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "pad", part: "R1", num: "2" }, v: 30 });
  const r = D.solve(b, model, { prefer: new Set(["part:R1"]) }); assert.ok(r.ok);
  r.T.forEach(([dx, dy], k) => D.moveBody(b, k, dx, dy));
  near(b.parts.R1.x, 35, 0.01);   // pad 2 at 40 = h1 + 30
  // a construction point (user frame): the hole 4 mm right of it
  K.normalise(b); b.construct.items.push({ id: "c1", k: "point", at: { x: 50, y: 50 } });
  const csol = K.solve(b, model);
  b.dims.items = [{ id: "d2", k: "dx", a: { t: "cp", ref: { t: "c", id: "c1", k: 0 } }, b: { t: "hole", id: "h3" }, v: 4 }];
  assert.ok(run(b, { csol }).ok); near(hole(b, "h3").x, 54);
});

test("100 dimensions solve in well under 50 ms", () => {
  const b = board(); b.holes = []; b.dims.items = [];
  for (let i = 0; i < 51; i++) b.holes.push({ id: "h" + i, x: Math.random() * 90, y: Math.random() * 50, d: 3 });
  b.dims.items.push({ id: "a", k: "dx", a: { t: "board", at: "BL" }, b: { t: "hole", id: "h0" }, v: 3 });
  for (let i = 1; i <= 50; i++) {
    b.dims.items.push({ id: "x" + i, k: "dx", a: { t: "hole", id: "h" + (i - 1) }, b: { t: "hole", id: "h" + i }, v: 1.5 });
    b.dims.items.push({ id: "y" + i, k: "dist", a: { t: "hole", id: "h" + (i - 1) }, b: { t: "hole", id: "h" + i }, v: 2 });
  }
  D.normalise(b);
  D.solve(JSON.parse(JSON.stringify(b)), null, {});   // warm the JIT: the first call in a fresh process compiles
  const t0 = performance.now(), r = run(b), ms = performance.now() - t0;
  assert.ok(r.ok, `err ${r.err}`); assert.ok(ms < 50, `${ms.toFixed(1)} ms`);
  const env = D.makeEnv(b, null); b.dims.items.forEach(d => near(D.residual(env, d, null), 0, 1e-3));
});

// ---------------------------------------------------------------------------
// The outline itself is dimensioned: the board's size, a sketched outline's edges, arcs and circles
// ---------------------------------------------------------------------------
const O = globalThis.BoardOutline;
// solve as the Board window does for a dimension whose second pick is `second`, and take the outline
function drive(b, dim, second) {
  if (!b.dims.items.includes(dim)) b.dims.items.push(dim);
  const r = D.solve(b, null, { prefer: D.movers(b, dim, second || dim.b) });
  const mo = r.ok ? D.movedOutline(b, r.T) : null;
  r.T.forEach(([dx, dy], k) => D.moveBody(b, k, dx, dy));
  return { r, mo };
}
const shaped = loops => { const b = board(), n = O.normalise(loops); b.outline = { w: n.w, h: n.h, r: 0, shape: n.shape }; return b; };

test("a rectangular board: a dimension between two edges sets its width or height; the edge picked second moves", () => {
  const b = board();
  // left edge (3) to right edge (1): the tool makes it from the left edge's corner to the right edge
  const w = { id: "w", k: "pl", a: { t: "board", at: "TL" }, b: { t: "edge", k: 1 }, v: 0 };
  near(Math.abs(D.measure(D.makeEnv(b, null), w)), 100);
  w.v = Math.sign(D.measure(D.makeEnv(b, null), w)) * 120;
  assert.equal(D.redundant(Object.assign(b, { dims: { items: [w] } }), null, w), false);
  let { r, mo } = drive(b, w);
  assert.ok(r.ok); assert.deepEqual([mo.o.w, mo.o.h, mo.dx, mo.dy], [120, 60, 0, 0]);   // the right edge went out, nothing shifts
  // the other way round: the left edge moves, and everything shifts 20 mm to stay where it is
  const b2 = board(), w2 = { id: "w", k: "pl", a: { t: "board", at: "TR" }, b: { t: "edge", k: 3 }, v: 0 };
  w2.v = Math.sign(D.measure(D.makeEnv(b2, null), w2)) * 120;
  ({ r, mo } = drive(b2, w2));
  assert.ok(r.ok); assert.deepEqual([mo.o.w, mo.o.h, mo.dx, mo.dy], [120, 60, 20, 0]);
  // the height between two corners (vertical dimension), the top one second
  const b3 = board(), h = { id: "h", k: "dy", a: { t: "board", at: "BL" }, b: { t: "board", at: "TL" }, v: 80 };
  ({ r, mo } = drive(b3, h));
  assert.ok(r.ok); assert.deepEqual([mo.o.w, mo.o.h, mo.dx, mo.dy], [100, 80, 0, 20]);
  assert.equal(mo.o.r, 0);
});

test("a part or a hole dimensioned from an edge moves, the board does not; dragging it never resizes the board", () => {
  const b = board(), d = { id: "d", k: "pl", a: { t: "hole", id: "h1" }, b: { t: "edge", k: 3 }, v: 0 };
  d.v = Math.sign(D.measure(D.makeEnv(b, null), d)) * 25;
  const { r, mo } = drive(b, d, d.b);
  assert.ok(r.ok); assert.equal(mo, null); near(hole(b, "h1").x, 25);
  assert.deepEqual([...D.movers(b, d, d.b)], ["hole:h1"]);
  // the hole pulled away by hand: the dimension cannot be met by moving the board's edge
  hole(b, "h1").x = 40;
  const r2 = D.solve(b, null, { pinned: new Set(["hole:h1"]) });
  assert.ok(![...r2.T.keys()].some(D.isOv), "the outline is not an unknown unless a dimension on it was set");
  // freedom is told against the board as it stands
  const fr = D.freedom(b, null).get("hole:h1"); assert.ok(fr.x && !fr.y);
});

test("a width dimension holds: the board reshaped by hand is pulled back (ovFree), holes dimensioned to an edge follow it", () => {
  const b = board(), w = { id: "w", k: "pl", a: { t: "board", at: "TL" }, b: { t: "edge", k: 1 }, v: 0 };
  w.v = Math.sign(D.measure(D.makeEnv(b, null), w)) * 100; b.dims.items.push(w);
  const d = { id: "d", k: "pl", a: { t: "hole", id: "h3" }, b: { t: "edge", k: 1 }, v: 0 };
  d.v = D.measure(D.makeEnv(b, null), d); b.dims.items.push(d);
  b.outline.w = 130;   // as Board setup or the corner handle would
  assert.ok(!D.solve(b, null, {}).T.size || ![...D.solve(b, null, {}).T.keys()].some(D.isOv));
  const r = D.solve(b, null, { ovFree: true }), mo = D.movedOutline(b, r.T);
  assert.ok(r.ok); assert.equal(mo.o.w, 100);
  // and a new width moves the hole with the right edge
  const b2 = board(); b2.dims.items.push(JSON.parse(JSON.stringify(w)), JSON.parse(JSON.stringify(d)));
  b2.dims.items[0].v = Math.sign(w.v) * 140;
  const r2 = D.solve(b2, null, { prefer: D.movers(b2, b2.dims.items[0], b2.dims.items[0].b) }), mo2 = D.movedOutline(b2, r2.T);
  assert.ok(r2.ok); assert.equal(mo2.o.w, 140); near(r2.T.get("hole:h3")[0], 40);
});

test("a round board and a round cut-out: the diameter drives them about their centres", () => {
  const b = board(); b.outline = O.circleOutline(110);
  const d = { id: "d", k: "dia", a: { t: "oe", k: 0 }, b: { t: "oe", k: 0 }, v: 90 };
  near(D.measure(D.makeEnv(b, null), d), 110);
  const { r, mo } = drive(b, d);
  assert.ok(r.ok); assert.deepEqual([mo.o.w, mo.o.h, mo.dx, mo.dy], [90, 90, -10, -10]);
  near(O.area(mo.o), Math.PI * 45 * 45, 1e-3);
  assert.match(D.describe(b, null, d), /board outline circle 1 diameter 90\.00 mm/);
  // a cut-out in an L-shaped board
  const L = shaped([[[0, 0], [0, 60], [100, 60], [100, 30], [50, 30], [50, 0]], O.circleLoop(20, 40, 5)]);
  const k = D.overts(L).findIndex(v => v.full), c = { id: "c", k: "dia", a: { t: "oe", k }, b: { t: "oe", k }, v: 16 };
  const res = drive(L, c);
  assert.ok(res.r.ok); assert.equal(res.mo.o.shape.length, 2);
  const ents = O.toEntities(res.mo.o).filter(e => e.t === "C");
  assert.deepEqual(ents.map(e => [e.cx, e.cy, e.r]), [[20, 40, 8]]);
  assert.deepEqual(res.mo.o.shape[0].length, 6);   // the edge is as it was
});

test("a sketched outline: edge to edge and an edge's length; every line keeps its direction, what is measured from stands still", () => {
  const loops = [[[0, 0], [0, 60], [100, 60], [100, 30], [50, 30], [50, 0]]];
  let b = shaped(loops);
  const V = D.overts(b), at = (x, y) => V.findIndex(v => Math.abs(v.x - x) < 1e-6 && Math.abs(v.y - y) < 1e-6);
  const seg = (x1, y1, x2, y2) => V.findIndex((v, i) => (Math.abs(v.x - x1) + Math.abs(v.y - y1) + Math.abs(V[v.n].x - x2) + Math.abs(V[v.n].y - y2) < 1e-6) || (Math.abs(v.x - x2) + Math.abs(v.y - y2) + Math.abs(V[v.n].x - x1) + Math.abs(V[v.n].y - y1) < 1e-6));
  // the top edge's length (its two corners, the right one second): 50 → 70; the step moves with it
  const top = seg(0, 0, 50, 0), a = at(0, 0), c = at(50, 0);
  const len = { id: "l", k: "dx", a: { t: "ov", k: a }, b: { t: "ov", k: c }, v: 70 };
  let { r, mo } = drive(b, len);
  assert.ok(r.ok, `err ${r.err}`); assert.deepEqual([mo.dx, mo.dy, mo.o.w, mo.o.h], [0, 0, 100, 60]);
  const pts = mo.o.shape[0].map(p => p.join(",")).sort();
  assert.deepEqual(pts, ["0,0", "0,60", "100,30", "100,60", "70,0", "70,30"].sort());
  assert.ok(top >= 0);
  // the step's depth: the notch's edge (y = 30) from the bottom edge (y = 60): 30 → 20, the notch's edge second
  b = shaped(loops);
  const notch = seg(100, 30, 50, 30), bottom = seg(0, 60, 100, 60), pl = { id: "p", k: "pl", a: { t: "ov", k: at(0, 60) }, b: { t: "oe", k: notch }, v: 0 };
  assert.ok(bottom >= 0);
  pl.v = Math.sign(D.measure(D.makeEnv(b, null), pl)) * 20;
  ({ r, mo } = drive(b, pl));
  assert.ok(r.ok, `err ${r.err}`);
  assert.deepEqual(mo.o.shape[0].map(p => p.join(",")).sort(), ["0,0", "0,60", "100,40", "100,60", "50,0", "50,40"].sort());
  // a slanted edge keeps its angle: a trapezium's top edge made longer slides its corner along the slope
  b = shaped([[[0, 0], [0, 40], [80, 40], [40, 0]]]);
  const W = D.overts(b), ia = W.findIndex(v => v.x === 0 && v.y === 0), ib = W.findIndex(v => v.x === 40 && v.y === 0);
  ({ r, mo } = drive(b, { id: "t", k: "dx", a: { t: "ov", k: ia }, b: { t: "ov", k: ib }, v: 60 }));
  assert.ok(r.ok, `err ${r.err}`);
  // the slope (1 : 1) is kept: the bottom-right corner went out by the same 20 mm
  assert.deepEqual(mo.o.shape[0].map(p => p.join(",")).sort(), ["0,0", "0,40", "100,40", "60,0"].sort());
});

test("an arc's radius: a filleted corner grows and stays tangent; the fillet's centre is a point to measure from", () => {
  // a 60 × 40 board, its top-right corner rounded R10 (drawn through the sketch's own geometry)
  const res = O.fromEntities([{ t: "L", x1: 0, y1: 0, x2: 50, y2: 0 }, { t: "A", x1: 50, y1: 0, x2: 60, y2: 10, b: Math.tan(Math.PI / 8) }, { t: "L", x1: 60, y1: 10, x2: 60, y2: 40 }, { t: "L", x1: 60, y1: 40, x2: 0, y2: 40 }, { t: "L", x1: 0, y1: 40, x2: 0, y2: 0 }]);
  assert.ok(!res.error, res.error);
  const b = board(); b.outline = { w: res.w, h: res.h, r: 0, shape: res.shape };
  const V = D.overts(b), k = V.findIndex(v => v.b), env = D.makeEnv(b, null), a0 = env.arc({ t: "oe", k }, null);
  near(a0.r, 10, 1e-6); near(a0.c[0], 50, 1e-6); near(a0.c[1], 10, 1e-6); assert.equal(a0.full, false);
  const d = { id: "r", k: "rad", a: { t: "oe", k }, b: { t: "oe", k }, v: 15 };
  const { r, mo } = drive(b, d);
  assert.ok(r.ok, `err ${r.err}`); assert.deepEqual([mo.o.w, mo.o.h], [60, 40]);   // the board's box is as it was
  const b2 = board(); b2.outline = mo.o;
  const a1 = D.makeEnv(b2, null).arc({ t: "oe", k: D.overts(b2).findIndex(v => v.b) }, null);
  near(a1.r, 15, 1e-3); near(a1.c[0], 45, 1e-3); near(a1.c[1], 15, 1e-3);   // tangent to the top and the right edge still
  // a hole 12 mm left of the fillet's centre
  b2.dims.items = [{ id: "c", k: "dx", a: { t: "oc", k: D.overts(b2).findIndex(v => v.b) }, b: { t: "hole", id: "h1" }, v: -12 }];
  const r3 = run(b2, { prefer: new Set(["hole:h1"]) });
  assert.ok(r3.ok); near(hole(b2, "h1").x, 33, 1e-3);
});

test("a dimension that would break the outline is refused; a sketch renumbering the edges keeps or drops its dimensions", () => {
  const b = shaped([[[0, 0], [0, 60], [100, 60], [100, 0]], O.circleLoop(80, 30, 5)]);
  const V = D.overts(b), k = V.findIndex(v => v.full);
  // the circle made bigger than the board's height
  const big = { id: "d", k: "dia", a: { t: "oe", k }, b: { t: "oe", k }, v: 70 };
  const { r, mo } = drive(b, big);
  assert.ok(r.ok); assert.ok(mo.error, "the cut-out would cross the edge");
  // renumbering: edge 1 → 2, the circle's segments gone
  b.dims.items = [{ id: "a", k: "dx", a: { t: "ov", k: 0 }, b: { t: "ov", k: 1 }, v: 60 }, { id: "b", k: "dia", a: { t: "oe", k }, b: { t: "oe", k }, v: 10 }, { id: "c", k: "dx", a: { t: "hole", id: "h1" }, b: { t: "hole", id: "h2" }, v: 30 }];
  const gone = D.remapOutline(b, { 0: 1, 1: 2 });
  assert.equal(gone, 1); assert.deepEqual(b.dims.items.map(d => [d.id, d.a.k, d.b.k]), [["a", 1, 2], ["c", undefined, undefined]]);
  assert.equal(D.remapOutline(b, null), 1); assert.deepEqual(b.dims.items.map(d => d.id), ["c"]);
});
