/**
 * Construction geometry in the Board window (board-construct.js): crossings of lines and
 * circles, offsets of the board's edges and outline, circles round holes, arrays, reference
 * points, holes tied to them that follow the outline, detaching, snapping, and that nothing of
 * it reaches the manufacturing files (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "cad-components.js", "mpn.js", "board-core.js", "board-fab.js", "board-construct.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const K = globalThis.BoardConstruct, B = globalThis.BoardCore, F = globalThis.BoardFab;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const nearP = (p, q, tol = 1e-6) => { assert.ok(p, `no point (want ${q})`); near(p[0], q[0], tol); near(p[1], q[1], tol); };
const board = (w = 100, h = 60, r = 0) => { const b = B.newBoard(); b.outline = { w, h, r }; K.normalise(b); return b; };

test("crossings: line × line, line × circle (two, along the line), circle × circle, segments and arcs limit them", () => {
  const L = (x1, y1, x2, y2, ext) => ({ t: "L", x1, y1, x2, y2, ext: ext || "line" }), C = (cx, cy, r, a0, a1) => ({ t: "C", cx, cy, r, a0, a1 });
  nearP(K.intersect(L(0, 0, 1, 1), L(0, 4, 1, 3))[0], [2, 2]);
  assert.equal(K.intersect(L(0, 0, 1, 1, "seg"), L(0, 4, 1, 3)).length, 0);
  assert.equal(K.intersect(L(0, 0, 1, 0), L(0, 1, 1, 1)).length, 0);   // parallel
  const lc = K.intersect(L(-10, 0, 10, 0), { t: "C", cx: 0, cy: 0, r: 5 });
  nearP(lc[0], [-5, 0]); nearP(lc[1], [5, 0]);
  assert.equal(K.intersect(L(-10, 0, 10, 0), C(0, 0, 5, 90, 180)).length, 1);
  const cc = K.intersect({ t: "C", cx: 0, cy: 0, r: 5 }, { t: "C", cx: 8, cy: 0, r: 5 });
  assert.equal(cc.length, 2); nearP(cc[0], [4, -3]); nearP(cc[1], [4, 3]);
  // a tangent touch counts once
  assert.equal(K.intersect(L(-10, 5, 10, 5), { t: "C", cx: 0, cy: 0, r: 5 }).length, 1);
});

test("offsets of the board's edges go into the board; the whole outline insets with smaller corners", () => {
  const b = board(100, 60, 4);
  const bottom = K.add(b, { k: "offset", of: { id: "@outline", k: 0 }, d: 5 });
  const right = K.add(b, { k: "offset", of: { id: "@outline", k: 1 }, d: 7 });
  const ring = K.add(b, { k: "offset", of: { id: "@outline" }, d: 3 });
  const s = K.solve(b, null);
  const cb = s.items[bottom.id].curves[0], cr = s.items[right.id].curves[0];
  near(cb.y1, 5); near(cb.y2, 5); assert.equal(cb.ext, "line");
  near(cr.x1, 93); near(cr.x2, 93);
  const cs = s.items[ring.id].curves;
  near(cs[0].y1, 3); near(cs[1].x1, 97); near(cs[4].r, 1);   // corner radius 4 − 3
  nearP(K.intersect(cb, cr)[0], [93, 5]);
  // inset past the corner radius: square corners
  const sq = K.add(b, { k: "offset", of: { id: "@outline" }, d: 6 });
  assert.equal(K.solve(b, null).items[sq.id].curves[4], null);
});

test("a hole on the crossing of two edge offsets follows the board when it is resized", () => {
  const b = board(100, 60);
  const ob = K.add(b, { k: "offset", of: { id: "@outline", k: 0 }, d: 5 }), or = K.add(b, { k: "offset", of: { id: "@outline", k: 1 }, d: 5 }), ot = K.add(b, { k: "offset", of: { id: "@outline", k: 2 }, d: 5 });
  b.holes.push({ x: 0, y: 0, d: 3.2, id: "h1", at: { ref: { t: "x", a: { id: or.id, k: 0 }, b: { id: ob.id, k: 0 }, i: 0 } } });
  b.holes.push({ x: 0, y: 0, d: 3.2, id: "h2", at: { ref: { t: "x", a: { id: or.id, k: 0 }, b: { id: ot.id, k: 0 }, i: 0 } } });
  const last = new WeakMap();
  K.applyHoles(K.solve(b, null), last);
  // the document keeps y down from the top: Y 5 is y 55 on a 60 mm board
  near(b.holes[0].x, 95); near(b.holes[0].y, 55); near(b.holes[1].x, 95); near(b.holes[1].y, 5);
  // wider and taller (the app moves everything down by the change in height, as setHeight does)
  b.outline.w = 140; b.outline.h = 80; b.holes.forEach(h => { h.y += 20; });
  K.applyHoles(K.solve(b, null), last);
  near(b.holes[0].x, 135); near(b.holes[0].y, 75); near(b.holes[1].x, 135); near(b.holes[1].y, 5);
});

test("a hole moved by hand keeps its tie with the new offset; detach makes it plain", () => {
  const b = board(100, 60);
  b.holes.push({ x: 0, y: 0, d: 3, id: "h1", at: { ref: { t: "board", at: "TR" }, dx: -6, dy: -6 } });
  const last = new WeakMap();
  K.applyHoles(K.solve(b, null), last);
  near(b.holes[0].x, 94); near(b.holes[0].y, 6);
  b.holes[0].x = 90;   // dragged 4 mm left
  K.applyHoles(K.solve(b, null), last);
  near(b.holes[0].at.dx, -10); near(b.holes[0].at.dy, -6);
  b.outline.w = 120; K.applyHoles(K.solve(b, null), last);
  near(b.holes[0].x, 110);
});

test("circles round a hole (from its rim), points on them, polar arrays of points and crossings with rays", () => {
  const b = board(100, 60);
  b.holes.push({ x: 50, y: 30, d: 4, id: "h1" });
  const c = K.add(b, { k: "circle", c: { ref: { t: "hole", id: "h1" } }, r: 8, rim: true });
  const p = K.add(b, { k: "point", at: { ref: { t: "on", g: { id: c.id, k: 0 }, a: 90 } } });
  const pol = K.add(b, { k: "polar", c: { ref: { t: "ctr", id: c.id } }, of: p.id, n: 4, by: "span", span: 360 });
  let s = K.solve(b, null);
  near(s.items[c.id].curves[0].r, 10);
  nearP(s.items[p.id].pts[0], [50, 40]);
  const pts = K.pointsOf(s, pol).map(e => e.p);
  assert.equal(pts.length, 4); nearP(pts[0], [50, 40]); nearP(pts[1], [40, 30]); nearP(pts[2], [50, 20]); nearP(pts[3], [60, 30]);
  // the hole moves: everything round it follows
  b.holes[0].x = 20; s = K.solve(b, null);
  nearP(K.pointsOf(s, pol)[3].p, [30, 30]);
  // rays from the centre cross the circle
  const rays = K.add(b, { k: "polar", c: { ref: { t: "hole", id: "h1" } }, n: 3, by: "step", step: 120, a0: 30 });
  s = K.solve(b, null);
  const x = K.intersect(s.items[rays.id].curves[0], s.items[c.id].curves[0]);
  assert.equal(x.length, 1); nearP(x[0], [20 + 10 * Math.cos(Math.PI / 6), 30 + 10 * Math.sin(Math.PI / 6)]);
});

test("linear arrays: square to a line by step or over a span; along an angle for points", () => {
  const b = board(100, 60);
  const l = K.add(b, { k: "line", a: { ref: { t: "origin" }, dx: 10 }, ang: 90 });
  const a = K.add(b, { k: "array", of: l.id, n: 5, by: "span", span: -40 });
  const s = K.solve(b, null), cs = s.items[a.id].curves;
  assert.equal(cs.length, 4); near(cs[0].x1, 20); near(cs[3].x1, 50);   // the left of an upward line is −X: a negative span runs right
  const pt = K.add(b, { k: "point", at: { x: 5, y: 5 } });
  const pa = K.add(b, { k: "array", of: pt.id, n: 3, by: "step", step: 10, ang: 0 });
  const s2 = K.solve(b, null);
  assert.deepEqual(K.pointsOf(s2, pa).map(e => e.p.map(v => +v.toFixed(3))), [[5, 5], [15, 5], [25, 5]]);
});

test("lines at an angle to a board edge, lines through two references, rays and segments", () => {
  const b = board(100, 60);
  const l = K.add(b, { k: "line", a: { ref: { t: "board", at: "BL" } }, ang: 30, rel: { id: "@outline", k: 1 } });   // 30° to the right edge (which runs up): 120°
  const s = K.solve(b, null), c = s.items[l.id].curves[0];
  near(Math.atan2(c.y2 - c.y1, c.x2 - c.x1) * 180 / Math.PI, 120);
  const seg = K.add(b, { k: "line", a: { ref: { t: "board", at: "BL" } }, b: { ref: { t: "board", at: "TR" } }, ext: "seg" });
  const m = K.add(b, { k: "point", at: { ref: { t: "mid", g: { id: seg.id, k: 0 } } } });
  nearP(K.solve(b, null).items[m.id].pts[0], [50, 30]);
});

test("a loop of references is reported, not followed forever; a reference that is gone is reported", () => {
  const b = board();
  b.construct.items.push({ id: "c1", k: "point", at: { ref: { t: "c", id: "c2" } } }, { id: "c2", k: "point", at: { ref: { t: "c", id: "c1" } } });
  b.construct.items.push({ id: "c3", k: "circle", c: { ref: { t: "hole", id: "nope" } }, r: 3 });
  const s = K.solve(b, null);
  assert.ok(s.items.c1.err || s.items.c2.err);
  assert.equal(s.items.c3.err, "its reference is gone");
});

test("detach turns an item into fixed coordinates where it is", () => {
  const b = board(100, 60);
  const o = K.add(b, { k: "offset", of: { id: "@outline", k: 0 }, d: 5 });
  const p = K.add(b, { k: "point", at: { ref: { t: "board", at: "TR" }, dx: -3, dy: -3 } });
  let s = K.solve(b, null);
  assert.ok(K.detach(s, o)); assert.ok(K.detach(s, p));
  assert.equal(o.k, "fixed"); assert.deepEqual(p.at, { x: 97, y: 57 });
  b.outline.w = 150; s = K.solve(b, null);
  nearP(s.items[p.id].pts[0], [97, 57]); near(s.items[o.id].curves[0].y1, 5);
});

test("snaps: a construction point, then the crossing with a board edge, then on a line; tangent points from a start", () => {
  const b = board(100, 60);
  const l = K.add(b, { k: "line", a: { x: 30, y: -10 }, b: { x: 30, y: 10 } });
  K.add(b, { k: "point", at: { x: 60, y: 30 } });
  let s = K.solve(b, null);
  assert.equal(K.snaps(s, 60.3, 30.2, 1)[0].ref.t, "c");
  const x = K.snaps(s, 30.4, 0.3, 1)[0];
  assert.equal(x.ref.t, "x"); nearP(x.p, [30, 0]);
  const on = K.snaps(s, 30.4, 20, 1)[0];
  assert.equal(on.ref.t, "on"); nearP(on.p, [30, 20]);
  const c = K.add(b, { k: "circle", c: { x: 50, y: 30 }, r: 5 });
  s = K.solve(b, null);
  const t = K.snaps(s, 45.5, 31.5, 1.5, null, { p: [50, 45], P: { x: 50, y: 45 } }).find(q => q.ref.t === "tan");
  assert.ok(t, "a tangent point"); near(Math.hypot(t.p[0] - 50, t.p[1] - 30), 5, 1e-3);
  assert.equal(K.hitItem(s, 30.2, 25, 1), l.id);
  assert.equal(K.hitItem(s, 55.1, 30, 1), c.id);
});

test("nothing of it reaches the Gerbers and drill files; the hole-to-edge check flags a hole too near the edge", () => {
  const b = board(80, 50);
  b.holes.push({ x: 2, y: 25, d: 3.2 }, { x: 40, y: 25, d: 3.2 });
  const model = { parts: [], pads: [], holes: [], names: {} }, conn = B.connectivity(b, [], null);
  const before = F.fabFiles(b, model, [], { version: "t" });
  K.add(b, { k: "offset", of: { id: "@outline" }, d: 4 });
  K.add(b, { k: "point", at: { x: 10, y: 10 } });
  const after = F.fabFiles(b, model, [], { version: "t" });
  assert.deepEqual(after, before);
  const drc = B.drc(b, model, conn, new Set(), [], null);
  const e = drc.filter(d => d.kind === "holeedge");
  assert.equal(e.length, 1); assert.match(e[0].msg, /from the board edge/);
});
