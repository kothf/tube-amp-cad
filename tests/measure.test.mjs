/**
 * Smart measure in the Board window (board-measure.js): one thing's size, two things'
 * relation (pitch, copper edge to edge against the rule, square to a line, parallel
 * tracks, angles) and the units (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["board-measure.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const M = globalThis.BoardMeasure;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const row = (r, label) => { const x = r.rows.find(q => q[0] === label); assert.ok(x, `no row "${label}" in ${r.rows.map(q => q[0])}`); return x[2]; };
const env = { outline: { w: 100, h: 60 }, rules: { clearance: 0.4, edgeClearance: 0.5, viaPad: 1.2, viaDrill: 0.6 }, need: () => ({ c: 0.4, v: 0, ipc: false }), toChassis: () => ({ c: 0.4 }), netName: n => "N" + n };
const pad = (x, y, w, h, extra) => ({ kind: "pad", p: [x, y], what: "pad", net: (extra && extra.net) ?? 1, pad: { x, y, w, h, shape: "circle", drill: 0.8, ref: "R1", num: 1, ...(extra || {}) } });
const via = (x, y, net) => ({ kind: "via", p: [x, y], what: "via", net, via: { x, y, drill: 0.6, pad: 1.2 } });
const track = (seg, w, net) => ({ kind: "track", p: [seg[0], seg[1]], what: "on a track", net, seg, track: { w, layer: "F.Cu", pts: [[seg[0], seg[1]], [seg[2], seg[3]]] } });

test("one pad: its size, drill and annular ring", () => {
  const r = M.single(pad(10, 10, 1.8, 1.8), env);
  assert.equal(r.vtype, "size"); assert.deepEqual(r.value, [1.8, 1.8]);
  near(row(r, "Annular ring"), 0.5);
});

test("two pads 2.54 mm apart: pitch, copper edge to edge, drill wall to wall, outer span and the modes", () => {
  const A = pad(10, 10, 1.8, 1.8, { net: 1 }), B = pad(12.54, 10, 1.8, 1.8, { net: 2 });
  let r = M.pair(A, B, env, "centre");
  near(r.value, 2.54); assert.equal(r.title, "Pitch (centre to centre)");
  near(row(r, "Copper edge to edge"), 0.74); near(row(r, "Drill wall to wall"), 1.74); near(row(r, "Outer span"), 4.34);
  assert.equal(r.ok, true);
  r = M.pair(A, B, env, "min"); near(r.value, 0.74); near(r.lines[0][0], 10.9); near(r.lines[0][2], 11.64);
  r = M.pair(A, B, env, "max"); near(r.value, 4.34);
});

test("copper closer than the rule is flagged; same net needs none", () => {
  const r = M.pair(pad(10, 10, 1.8, 1.8, { net: 1 }), via(11.7, 10, 2), env, "min");
  near(r.value, 0.2); assert.equal(r.ok, false);
  assert.match(M.fmt(row(r, "Clearance rule"), "check", "mm"), /0\.2 mm too close/);
  const s = M.pair(pad(10, 10, 1.8, 1.8, { net: 1 }), via(11.7, 10, 1), env, "min");
  assert.equal(row(s, "Clearance rule"), "same net: none needed");
});

test("a via against a track: centre square to the line, the foot, and the copper gap", () => {
  const r = M.pair(via(5, 3, 1), track([0, 0, 10, 0], 0.5, 2), env, "centre");
  near(r.value, 3); assert.equal(r.title, "Centre to the track"); near(row(r, "Copper edge to edge"), 3 - 0.6 - 0.25);
  const past = M.pair(via(15, 3, 1), track([0, 0, 10, 0], 0.5, 2), env);
  near(past.value, 3); assert.equal(row(past, "Foot"), "on the line past its end"); near(row(past, "Shortest distance"), Math.hypot(5, 3));
});

test("a pad to the board edge is checked against the edge clearance", () => {
  const edge = { kind: "edge", p: [0, 5], what: "board edge", seg: [0, 60, 0, 0] };
  const r = M.pair(pad(1.2, 10, 1.8, 1.8), edge, env, "min");
  near(r.value, 0.3); assert.equal(r.ok, false);
});

test("parallel tracks: centre line gap and edge to edge; crossing tracks: the angle", () => {
  const a = track([0, 0, 10, 0], 0.5, 1), b = track([2, 1.5, 12, 1.5], 1, 2);
  let r = M.pair(a, b, env); assert.equal(r.title, "Parallel tracks"); near(r.value, 1.5); near(row(r, "Copper edge to edge"), 0.75); near(row(r, "Offset along them"), 2);
  r = M.pair(a, b, env, "min"); near(r.value, 0.75);
  r = M.pair(track([0, 0, 10, 0], 0.5, 1), track([20, 0, 30, -10], 0.5, 2), env);
  assert.equal(r.vtype, "ang"); near(r.value, 45); assert.equal(row(r, "Crossing"), "on the extension");
});

test("units: mm, mil and inch; positions count y up from the board's bottom", () => {
  assert.equal(M.fmt(2.54, "len", "mm"), "2.54 mm");
  assert.equal(M.fmt(2.54, "len", "mil"), "100 mil");
  assert.equal(M.fmt(2.54, "len", "in"), "0.1 in");
  assert.equal(M.fmt([10, 50], "pos", "mm", 60), "X 10 mm, Y 10 mm");
  assert.equal(M.fmt([1.8, 1.1], "size", "mm"), "1.8 × 1.1 mm");
});
