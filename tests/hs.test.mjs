/* High-speed helpers (board-hs.js): impedance from the stack-up, pairs, lengths, meanders. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-hs.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, H = globalThis.BoardHs;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} ± ${tol}`);

test("microstrip and stripline impedance agree with the textbook figures", () => {
  // Hammerstad-Jensen reference points (t = 0): w/h = 1 -> 60/√εeff·ln 8.25: 70 Ω on er 4.5 (εeff 3.24), 126.6 Ω in air
  near(H.microstrip(1, 1, 0, 4.5).z0, 70.4, 0.5, "w/h 1, FR4");
  near(H.microstrip(1.9, 1, 0, 4.4).z0, 50, 1.5, "50 Ω at w/h 1.9 on er 4.4");
  near(H.microstrip(1, 1, 0, 1).z0, 126, 2, "w/h 1, air");
  // 2-layer 1.6 mm FR4, 35 µm: 50 Ω is about 2.9-3.0 mm
  const b = B.newBoard();
  near(H.widthFor(b, "F.Cu", 50), 2.95, 0.15, "50 Ω on a 1.6 mm two-layer board");
  // symmetric stripline, b = 2h + t = 0.5 mm, w 0.15, t 0.035, er 4.4: IPC-2141 gives about 47 Ω
  near(H.stripline(0.15, 0.2325, 0.2325, 0.035, 4.4).z0, 60 / Math.sqrt(4.4) * Math.log(1.9 * 0.5 / (0.12 + 0.035)), 1e-9, "IPC-2141 symmetric");
  // a wider track has a lower impedance; a coupled pair less than twice its single-ended figure
  const r = H.impedance(b, "F.Cu", 1, 0.2);
  assert.ok(H.impedance(b, "F.Cu", 2).z0 < r.z0 && r.zdiff < 2 * r.z0 && r.zdiff > r.z0);
  assert.equal(r.kind, "microstrip");
});

test("4- and 6-layer stack-ups: outer layers are microstrip over the next layer, inner ones stripline; the stack-up's own dielectrics count", () => {
  const b = B.newBoard(); Object.assign(b.stackup, { layers: 4, inner: [{ type: "plane", net: "GND" }, { type: "signal" }], diel: [0.2104, 1.065, 0.2104], er: 4.4 });
  const g = H.layerGeom(b, "F.Cu"), s = H.layerGeom(b, "In2.Cu");
  assert.equal(g.kind, "microstrip"); near(g.h, 0.2104, 1e-9, "prepreg"); assert.equal(s.kind, "stripline"); near(s.h1, 1.065, 1e-9, "core"); near(s.h2, 0.2104, 1e-9, "prepreg");
  near(H.widthFor(b, "F.Cu", 50), 0.36, 0.04, "50 Ω over 0.21 mm prepreg");
  const w = 0.2, gap = H.gapFor(b, "F.Cu", w, 100);
  assert.ok(gap > 0.05 && gap < 1, `100 Ω pair gap ${gap}`); near(H.impedance(b, "F.Cu", w, gap).zdiff, 100, 0.01, "solved gap");
  // without its own list the thickness is shared out evenly
  delete b.stackup.diel; const D = H.dielectrics(b);
  assert.equal(D.length, 3); near(D[0], (1.6 - 0.07 - 0.07) / 3, 1e-9, "even split");
  assert.equal(H.widthFor(b, "F.Cu", 500), null, "out of reach");
});

test("pairs and length groups: routed lengths, skew and length checks", () => {
  const conn = { items: [
    { kind: "track", net: 1, s: [0, 0, 10, 0] }, { kind: "track", net: 1, s: [10, 0, 10, 5] },
    { kind: "track", net: 2, s: [0, 1, 12, 1] },
    { kind: "track", net: 3, s: [0, 9, 30, 9] }
  ] };
  const L = H.netLengths(conn); assert.equal(L.get(1), 15); assert.equal(L.get(2), 12);
  const b = B.newBoard(); b.rules.pairs = [{ p: "D+", n: "D-", width: 0.2, gap: 0.2, skew: 1 }]; b.rules.lengths = [{ name: "bus", nets: ["D+", "D-", "CLK"], tol: 2 }];
  const model = { names: { 1: "D+", 2: "D-", 3: "CLK" } };
  const out = H.drc(b, model, conn);
  assert.ok(out.some(d => d.kind === "skew" && /3\.00 mm apart/.test(d.msg) && /lengthen D-/.test(d.msg)), JSON.stringify(out));
  assert.equal(out.filter(d => d.kind === "length").length, 2, "both shorter than CLK by more than 2 mm");
  b.rules.lengths[0].target = 15; b.rules.lengths[0].tol = 0.5;
  assert.deepEqual(H.drc(b, model, conn).filter(d => d.kind === "length").map(d => d.msg.split(" ")[0]).sort(), ["CLK", "D-"]);
  assert.deepEqual(H.guessPairs(["USB_D+", "USB_D-", "CLK_P", "CLK_N", "GND"]), [["USB_D+", "USB_D-"], ["CLK_P", "CLK_N"]]);
});

test("a meander adds exactly the length asked for, within the segment; a partner path keeps its distance", () => {
  const m = H.meander([[0, 0], [40, 0]], 0, 7.5, { s: 1, amax: 3 });
  assert.ok(m.pts, m.fail); near(H.pathLength(m.pts) - 40, 7.5, 1e-3, "added length");
  assert.ok(m.pts.every(p => p[0] >= 0 && p[0] <= 40 && p[1] >= 0 && p[1] <= 3 + 1e-9), "inside the segment's span and amplitude");
  assert.match(H.meander([[0, 0], [3, 0]], 0, 2, { s: 1 }).fail, /too short/);
  assert.match(H.meander([[0, 0], [10, 0]], 0, 50, { s: 1, amax: 2 }).fail, /not enough room/);
  const o = H.offsetPath([[0, 0], [10, 0], [15, 5], [15, 20]], 0.5);
  const seg = (p, k) => [p[k], p[k + 1]];
  for (let k = 0; k < 3; k++) {   // each offset segment is parallel to its own, 0.5 mm away
    const [a, b2] = seg([[0, 0], [10, 0], [15, 5], [15, 20]], k), [c, d] = seg(o, k);
    const dx = b2[0] - a[0], dy = b2[1] - a[1], l = Math.hypot(dx, dy), dist = Math.abs((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / l;
    near(dist, 0.5, 1e-3, `offset of segment ${k}`); near((d[0] - c[0]) * dy - (d[1] - c[1]) * dx, 0, 1e-3, "parallel");
  }
});
