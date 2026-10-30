/**
 * Auto-tune's optimizer (cad-tune.js) without the CAD: it finds the minimum of known functions
 * within its budget, rounds to standard series and scores goals as the Tune tab does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

globalThis.window = globalThis;
runInThisContext(readFileSync(new URL("../cad-tune.js", import.meta.url), "utf8"), { filename: "cad-tune.js" });
const { CadTune } = globalThis;

// run the optimizer on f (synchronously, as the pool would in batches)
function minimise(f, x0, budget, batch) {
  const o = CadTune.Optimizer({ x0, budget, batch });
  while (!o.done) { const pts = o.ask(); if (!pts.length) break; o.tell(pts, pts.map(f)); }
  return o;
}

test("finds the minimum of a bowl in two and in five variables", () => {
  const o2 = minimise(p => (p[0] - 0.73) ** 2 + (p[1] - 0.21) ** 2, [0.5, 0.5], 200, 6);
  assert.ok(Math.abs(o2.best[0] - 0.73) < 0.01 && Math.abs(o2.best[1] - 0.21) < 0.01, JSON.stringify(o2.best));
  const t = [0.1, 0.9, 0.4, 0.66, 0.25];
  const o5 = minimise(p => p.reduce((s, v, i) => s + (i + 1) * (v - t[i]) ** 2, 0), [0.5, 0.5, 0.5, 0.5, 0.5], 600, 12);
  assert.ok(o5.best.every((v, i) => Math.abs(v - t[i]) < 0.02), JSON.stringify(o5.best));
  assert.ok(o5.evals <= 600);
});

test("stops as soon as the cost is zero, and never leaves 0…1", () => {
  const o = minimise(p => Math.max(0, 0.8 - p[0]), [0.1], 500, 4);
  assert.equal(o.cost, 0);
  assert.ok(o.evals < 60, `${o.evals} tries`);
  const edge = minimise(p => 2 - p[0] - p[1] + 1e-3, [0.5, 0.5], 100, 4);
  assert.ok(edge.best.every(v => v >= 0 && v <= 1) && edge.best[0] > 0.99 && edge.best[1] > 0.99);
});

test("the start is tried first and a failed try (Infinity) is skipped", () => {
  const o = CadTune.Optimizer({ x0: [0.3, 0.6], budget: 50, batch: 4 });
  assert.deepEqual(o.ask(), [[0.3, 0.6]]);
  o.tell([[0.3, 0.6]], [5]);
  const pts = o.ask();
  o.tell(pts, pts.map((p, i) => (i === 0 ? Infinity : 4)));
  assert.equal(o.cost, 4);
});

test("nearest: E24 and E12 values across decades", () => {
  assert.equal(CadTune.nearest(1234, "E24"), 1200);
  assert.equal(CadTune.nearest(1290, "E24"), 1300);
  assert.equal(CadTune.nearest(96, "E24"), 100);
  assert.equal(CadTune.nearest(4.4e-6, "E12"), 4.7e-6);
  assert.equal(CadTune.nearest(0.00093, "E12"), 0.001);
  assert.equal(CadTune.nearest(123, ""), 123);
});

test("cost: zero when every goal is met, penalties for misses and for parts beyond their ratings", () => {
  const goals = [{ key: "p", op: ">=", target: 10 }, { key: "thd", op: "<=", target: 1 }, { key: "ia", op: "=", target: 0.05 }];
  assert.equal(CadTune.cost(goals, { p: 12, thd: 0.8, ia: 0.0502 }), 0);
  assert.ok(Math.abs(CadTune.cost(goals, { p: 5, thd: 0.8, ia: 0.05 }) - 0.25) < 1e-12);
  assert.ok(CadTune.cost(goals, { p: 12, thd: 2, ia: 0.05 }) > 0.9);
  assert.equal(CadTune.cost(goals, { p: 12, thd: 0.5 }), 4);   // a goal not measured
  assert.ok(CadTune.cost(goals, { p: 12, thd: 0.8, ia: 0.05 }, [{ v: 15, max: 12 }]) > 0.25);
  assert.ok(CadTune.met(goals[0], 10) && !CadTune.met(goals[1], 1.2) && CadTune.met(goals[2], 0.0504));
});
