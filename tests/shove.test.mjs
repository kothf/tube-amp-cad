/* Push and shove for interactive routing (board-shove.js). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
for (const f of ["board-shove.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const S = globalThis.BoardShove;

const segs = pts => pts.slice(1).map((p, k) => [pts[k][0], pts[k][1], p[0], p[1]]);
function dist(a, b) {
  const d = (ax, ay, bx, by, px, py) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };
  return Math.min(d(a[0], a[1], a[2], a[3], b[0], b[1]), d(a[0], a[1], a[2], a[3], b[2], b[3]), d(b[0], b[1], b[2], b[3], a[0], a[1]), d(b[0], b[1], b[2], b[3], a[2], a[3]));
}
// every pair of different-net copper keeps the clearance afterwards
function clearOk(tracks, res, newSegs, r, c) {
  const all = tracks.map((t, i) => ({ net: t.net, r: t.w / 2, s: segs(res.moved.has(i) ? res.moved.get(i) : t.pts) })).concat([{ net: "NEW", r, s: newSegs }]);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (all[i].net === all[j].net) continue;
    for (const a of all[i].s) for (const b of all[j].s) if (dist(a, b) - all[i].r - all[j].r < c - 1e-6) return false;
  }
  return true;
}
const T = (pts, net, extra) => Object.assign({ layer: "F.Cu", w: 0.5, pts, net }, extra);
const run = (tracks, s, extra) => S.shove(Object.assign({ tracks, layer: "F.Cu", net: "NEW", segs: s, r: 0.25, need: () => 0.3 }, extra));

test("a track beside the new one steps aside by just the clearance it lacks, with 45° jogs, and keeps its ends", () => {
  const tracks = [T([[0, 2], [20, 2]], "B")], s = [[5, 1.5, 12, 1.5]];
  const res = run(tracks, s);
  assert.ok(res.moved, res.fail);
  const p = res.moved.get(0);
  assert.deepEqual(p[0], [0, 2]); assert.deepEqual(p[p.length - 1], [20, 2]);
  const y = Math.max(...p.map(q => q[1]));
  assert.ok(Math.abs(y - 2.302) < 1e-3, `offset ${y}`);
  for (const sg of segs(p)) { const dx = Math.abs(sg[2] - sg[0]), dy = Math.abs(sg[3] - sg[1]); assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-3, "45° jogs"); }
  assert.ok(clearOk(tracks, res, s, 0.25, 0.3));
});

test("pushed tracks push the next ones in turn (a chain), and a bump that would run past a bend moves the bend", () => {
  const tracks = [T([[0, 10], [0, 2], [20, 2], [20, 10]], "B"), T([[2, 3], [18, 3]], "C")], s = [[5, 1.5, 12, 1.5]];
  const res = run(tracks, s);
  assert.ok(res.moved, res.fail);
  assert.equal(res.moved.size, 2);
  assert.ok(clearOk(tracks, res, s, 0.25, 0.3));
  const r2 = run([tracks[0]], [[-3, 1.5, 6, 1.5]]);
  assert.ok(r2.moved, r2.fail);
  assert.deepEqual(r2.moved.get(0)[1], [0, 2.302], "the corner moved up, the leg stays vertical");
  assert.ok(clearOk([tracks[0]], r2, [[-3, 1.5, 6, 1.5]], 0.25, 0.3));
});

test("nothing moves when a push would cross a track, move a locked one or a track's end, or hit something fixed", () => {
  const B = T([[0, 2], [20, 2]], "B");
  assert.match(run([B], [[5, 0, 5, 6]]).fail, /crosses/);
  assert.match(run([Object.assign({}, B, { locked: true })], [[5, 1.5, 12, 1.5]]).fail, /locked/);
  assert.match(run([B], [[-1, 1.5, 3, 1.5]]).fail, /end/);
  const res = run([B], [[5, 1.5, 12, 1.5]], { fixed: s => (Math.max(s[1], s[3]) > 2.2 ? { x: 8, y: 2.6, what: "R1-1" } : null) });
  assert.match(res.fail, /R1-1/);
  // squeezed: the second track can't go anywhere, it would have to cross a third net's track
  const res2 = run([B, T([[0, 3], [20, 3]], "C"), T([[10, 2.5], [10, 9]], "D")], [[5, 1.5, 14, 1.5]]);
  assert.ok(res2.fail, "blocked chain fails");
});

test("same net and other layers are left alone; the answer is the same every time", () => {
  const tracks = [T([[0, 2], [20, 2]], "NEW"), T([[0, 2], [20, 2]], "B", { layer: "B.Cu" })];
  const res = run(tracks, [[5, 1.5, 12, 1.5]]);
  assert.equal(res.moved.size, 0);
  const t2 = [T([[0, 10], [0, 2], [20, 2], [20, 10]], "B"), T([[2, 3], [18, 3]], "C")];
  const a = run(t2, [[5, 1.5, 12, 1.5]]), b = run(t2, [[5, 1.5, 12, 1.5]]);
  assert.deepEqual([...a.moved], [...b.moved]);
});

test("a 45° track is pushed square to itself", () => {
  const tracks = [T([[0, 0], [20, 20]], "B")], s = [[5, 5.6, 12, 12.6]];
  const res = run(tracks, s);
  assert.ok(res.moved, res.fail);
  assert.ok(clearOk(tracks, res, s, 0.25, 0.3));
});
