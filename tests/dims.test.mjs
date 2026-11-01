/**
 * Driving dimensions in the Board window (board-dims.js): horizontal, vertical, aligned and
 * point-to-line dimensions and the align constraints move what they hold; the least-change solver
 * leaves the rest alone, keeps a body the user moved where it was put, finds an over-constrained
 * dimension, tells which bodies are fully defined, and is quick on 100 dimensions (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "cad-components.js", "mpn.js", "board-core.js", "board-fab.js", "board-construct.js", "board-dims.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
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
