/**
 * Board outlines with a shape of their own (board-outline.js) and everything that has to follow
 * them: the sketch's check, the design rules, copper pours, the Gerber files (read back here by
 * a small reader of their own), the Freerouting design, KiCad, the 3D solid and STEP, the
 * construction geometry tied to an edge, the grid router (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "mpn.js", "board-outline.js", "board-core.js", "pdf-export.js", "board-fab.js", "kicad-export.js", "kicad-import.js", "board-route.js", "board-3d.js", "board-construct.js", "board-dims.js", "board-sat.js", "board-place.js", "board-pathfinder.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab, O = globalThis.BoardOutline, K = globalThis.BoardConstruct, D3 = globalThis.Board3D;
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const NETLIST = {
  names: { 0: "GND", 1: "B+" }, volts: { 1: 300, 2: 150, 3: 1.5, 4: 0 },
  parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }), part("r1", "resistor", "R1", { r: 100e3, w: "0.5" }, { 1: 1, 2: 2 }), part("r2", "resistor", "R2", { r: 1.5e3 }, { 1: 3, 2: 0 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }), part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }), part("q1", "npn", "VT1", { model: "MPSA42" }, { C: 1, B: 2, E: 8 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 3, "-": 0 }), part("t1", "opt_se", "T1", {}, { P1: 1, P2: 2, S1: 9, S2: 0 }), part("gnd", "ground", "", {}, { G: 0 })
  ]
};
function fabBoard(outline, at) {
  const board = B.newBoard(); B.sync(board, NETLIST); board.outline = outline;
  const pos = at || { VL1: [30, 30], R1: [60, 18], R2: [30, 55], C1: [55, 55], VT1: [75, 30], G1: [15, 78], T1: [92, 55] };
  Object.values(board.parts).forEach(p => { Object.assign(p, { x: pos[p.ref][0], y: pos[p.ref][1] }); if (p.ref === "T1") p.fp = "TERM-5.08-4"; });
  board.texts.push({ x: 60, y: 84, text: "TEST", size: 2, layer: "F.SilkS", rot: 0 });
  board.zones.push({ net: "GND", layer: "B.Cu", pts: null, thermal: true, gap: 0.5, spoke: 0.8 });
  return board;
}
function analyse(board) {
  const m = B.model(board, NETLIST), hv = B.hvNets(NETLIST.volts, board.rules.hvVolts), c0 = B.connectivity(board, m.pads), fills = B.fillZones(board, m, c0, hv);
  return { m, hv, c0, fills, conn: B.connectivity(board, m.pads, fills) };
}
const Ln = (x1, y1, x2, y2) => ({ t: "L", x1, y1, x2, y2 }), Ar = (x1, y1, x2, y2, b) => ({ t: "A", x1, y1, x2, y2, b }), Ci = (cx, cy, r) => ({ t: "C", cx, cy, r });
// 120 × 90: a round notch in the top edge, a chamfered corner, a rounded corner, a round cut-out and a slot
const FANCY_ENTS = [Ln(0, 0, 50, 0), Ar(50, 0, 70, 0, -1), Ln(70, 0, 120, 0), Ln(120, 0, 120, 75), Ln(120, 75, 105, 90), Ln(105, 90, 8, 90), Ar(8, 90, 0, 82, O.Q), Ln(0, 82, 0, 0),
  Ci(100, 20, 6), Ln(40, 70, 60, 70), Ar(60, 70, 60, 76, 1), Ln(60, 76, 40, 76), Ar(40, 76, 40, 70, 1)];
const fancy = () => O.outlineOf(O.fromEntities(FANCY_ENTS));
const hexagon = () => O.outlineOf(O.normalise([O.polygonLoop(50, 50, 50, 6, 0)]));

// ---------------------------------------------------------------------------
// A small Gerber reader (RS-274X as the app writes it): contours of strokes, regions, flashes,
// each with its polarity, in the file's order, millimetres with Y up
// ---------------------------------------------------------------------------
function readGerber(text) {
  const fs = /%FSLAX(\d)(\d)Y\d\d\*%/.exec(text); assert.ok(fs, "format statement"); assert.ok(text.includes("%MOMM*%"), "millimetres");
  const sc = 10 ** +fs[2], ap = {}, ops = [];
  let cur = null, x = 0, y = 0, pol = "D", region = null, stroke = null;
  const end = () => { if (stroke) { ops.push(stroke); stroke = null; } };
  const re = /%ADD(\d+)([CRO]),([\d.]+)(?:X([\d.]+))?\*%|%LP([DC])\*%|(G36)\*|(G37)\*|(?:X(-?\d+))?(?:Y(-?\d+))?D0([123])\*|D(\d{2,})\*/g;
  for (let m; (m = re.exec(text));) {
    if (m[1]) ap[+m[1]] = { k: m[2], a: +m[3], b: +(m[4] || m[3]) };
    else if (m[5]) { end(); pol = m[5]; }
    else if (m[6]) { end(); region = []; }
    else if (m[7]) { assert.ok(region.length >= 3, "a region has an area"); near(Math.hypot(region[0][0] - region[region.length - 1][0], region[0][1] - region[region.length - 1][1]), 0, 1e-6); ops.push({ t: "region", pol, pts: region }); region = null; }
    else if (m[10]) {
      const nx = m[8] !== undefined ? +m[8] / sc : x, ny = m[9] !== undefined ? +m[9] / sc : y, op = m[10];
      if (region) region.push([nx, ny]);
      else if (op === "2") { end(); stroke = { t: "line", pol, w: ap[cur].a, pts: [[nx, ny]] }; }
      else if (op === "1") { assert.equal(ap[cur].k, "C", "strokes use round apertures"); if (!stroke) stroke = { t: "line", pol, w: ap[cur].a, pts: [[x, y]] }; stroke.pts.push([nx, ny]); }
      else { end(); ops.push({ t: "flash", pol, x: nx, y: ny, ...ap[cur] }); }
      x = nx; y = ny;
    } else if (m[11]) { end(); cur = +m[11]; assert.ok(ap[cur], `aperture D${cur} is defined`); }
  }
  end();
  return ops.filter(o => o.t !== "line" || o.pts.length > 1 || o.w > 0);
}
const segD = (x1, y1, x2, y2, px, py) => { const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l)) : 0; return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };
const pip = (x, y, P) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
// is there copper at a point: the operations in order, the last one that covers it decides
function inkAt(ops, x, y) {
  let ink = false;
  for (const o of ops) {
    let hit;
    if (o.t === "region") hit = pip(x, y, o.pts);
    else if (o.t === "flash") hit = o.k === "C" ? Math.hypot(x - o.x, y - o.y) <= o.a / 2 : o.k === "R" ? Math.abs(x - o.x) <= o.a / 2 && Math.abs(y - o.y) <= o.b / 2 : (() => { const r = Math.min(o.a, o.b) / 2, l = Math.max(o.a, o.b) / 2 - r; return (o.a >= o.b ? segD(o.x - l, o.y, o.x + l, o.y, x, y) : segD(o.x, o.y - l, o.x, o.y + l, x, y)) <= r; })();
    else { hit = false; for (let k = 0; k + 1 < o.pts.length && !hit; k++) hit = segD(o.pts[k][0], o.pts[k][1], o.pts[k + 1][0], o.pts[k + 1][1], x, y) <= o.w / 2; }
    if (hit) ink = o.pol === "D";
  }
  return ink;
}

// ---------------------------------------------------------------------------
test("a rectangle is still a rectangle: the same distances, polygon and files as before shapes existed", () => {
  const o = { w: 100, h: 60, r: 5 };
  assert.equal(O.isShape(o), false);
  for (const [x, y] of [[50, 30], [1, 1], [-3, 30], [99, 59], [50, 0.2], [103, 64]]) near(O.dist(o, x, y), B.edgeDist(x, y, o), 1e-9);
  near(O.area(o), 100 * 60 - (4 - Math.PI) * 25, 0.05);
  assert.deepEqual(O.outlineOf(O.fromEntities(O.toEntities(o))), o, "through the sketch and back: the same rectangle, no shape kept");
  assert.deepEqual(O.outlineOf(O.fromEntities(O.toEntities({ w: 80, h: 40, r: 0 }))), { w: 80, h: 40, r: 0 });
  assert.equal(B.normaliseBoard({ ...B.newBoard(), outline: { w: 50, h: 40, r: 0, shape: "nonsense" } }).outline.shape, undefined, "a broken shape is dropped");
});

test("shapes: a round board, a regular polygon, arcs and cut-outs: inside, distance, area, box", () => {
  const c = O.circleOutline(60);
  assert.ok(O.isShape(c)); assert.deepEqual([c.w, c.h], [60, 60]);
  near(B.edgeDist(30, 30, c), 30); near(B.edgeDist(30, 5, c), 5); near(B.edgeDist(1, 1, c), 30 - Math.hypot(29, 29)); assert.ok(B.edgeDist(1, 1, c) < 0, "the box's corner is off a round board");
  near(O.area(c), Math.PI * 900, 0.5); near(O.perimeter(c), Math.PI * 60, 1e-6);
  assert.equal(O.describe(c), "round Ø60 mm");
  const h = hexagon();
  near(h.w, 100, 1e-3); near(h.h, 100 * Math.sin(Math.PI / 3), 1e-3); near(O.area(h), 6 * 0.25 * Math.sqrt(3) * 2500, 0.01);
  assert.ok(B.edgeDist(2, 2, h) < 0 && B.edgeDist(50, 43, h) > 40);
  const f = fancy();
  assert.equal(f.shape.length, 3, "the edge and two cut-outs"); assert.deepEqual([f.w, f.h], [120, 90]);
  near(B.edgeDist(60, 5, f), -5); near(B.edgeDist(60, 15, f), 5);          // in the notch (R10 about 60, 0), and below it
  near(B.edgeDist(100, 20, f), -6); near(B.edgeDist(100, 30, f), 4);        // in the round cut-out, beside it
  near(B.edgeDist(50, 73, f), -3); near(B.edgeDist(50, 66, f), 4);          // in the slot, above it
  assert.ok(B.edgeDist(118, 88, f) < 0, "past the chamfer"); near(B.edgeDist(112.5, 82.5, f), 0, 1e-9);
  near(B.edgeDist(1, 89, f), -(Math.hypot(7, 7) - 8), 1e-9);               // outside the rounded corner
  near(O.area(f), 120 * 90 - Math.PI * 50 - 112.5 - (64 - Math.PI * 16) - Math.PI * 36 - (20 * 6 + Math.PI * 9), 0.05);
  assert.equal(O.describe(f), "custom shape 120 × 90 mm, 2 cut-outs");
  // the edge runs with the board on its left, the cut-outs the other way
  assert.ok(O.loopArea(f.shape[0]) > 0 && O.loopArea(f.shape[1]) < 0 && O.loopArea(f.shape[2]) < 0);
  // an arc through three points, and its bulge back
  near(O.bulge3([50, 0], [70, 0], [60, 10]), -1); near(O.bulge3([0, 0], [10, 0], [5, 0]), 0);
  const a = O.arcOf(8, 90, 0, 82, O.Q); near(a.cx, 8); near(a.cy, 82); near(a.r, 8);
});

test("the sketch's check: loose ends, branches, crossings, shapes outside the edge, a cut-out in a cut-out", () => {
  const box = [Ln(0, 0, 50, 0), Ln(50, 0, 50, 40), Ln(50, 40, 0, 40), Ln(0, 40, 0, 0)];
  const ok = O.fromEntities(box); assert.ok(!ok.error); assert.deepEqual(O.outlineOf(ok), { w: 50, h: 40, r: 0 });
  const open = O.fromEntities(box.slice(0, 3)); assert.match(open.error, /not closed: 2 loose ends/); assert.equal(open.at.length, 2);
  assert.match(O.fromEntities(box.concat([Ln(0, 0, 25, 20), Ln(25, 20, 50, 0)])).error, /More than two lines meet/);
  assert.match(O.fromEntities([Ln(0, 0, 50, 40), Ln(50, 40, 50, 0), Ln(50, 0, 0, 40), Ln(0, 40, 0, 0)]).error, /crosses itself/);
  assert.match(O.fromEntities(box.concat([Ci(45, 20, 10)])).error, /crosses itself/);
  assert.match(O.fromEntities(box.concat([Ci(80, 20, 5)])).error, /outside the board's edge/);
  assert.match(O.fromEntities(box.concat([Ci(25, 20, 10), Ci(25, 20, 4)])).error, /inside another cut-out/);
  assert.match(O.fromEntities([]).error, /empty/);
  assert.match(O.fromEntities([Ln(0, 0, 1, 0), Ln(1, 0, 1, 1), Ln(1, 1, 0, 0)]).error, /too small/);
  // drawn away from the origin and the wrong way round: moved to 0, 0 and turned; ends 0.005 mm apart still join
  const far = O.fromEntities([Ln(110, 20, 10, 20), Ln(10, 20.005, 10, 70), Ln(10, 70, 110, 70), Ln(110, 70, 110, 20), Ci(30, 40, 5)]);
  assert.ok(!far.error, far.error); assert.deepEqual([far.w, far.h, far.dx, far.dy], [100, 50, -10, -20]);
  assert.deepEqual(far.shape[1], [[15, 20, -1], [25, 20, -1]], "the circle moved with it, turned the cut-out's way");
  assert.deepEqual(far.ents.map(l => l.length), [4, 2]); assert.deepEqual(far.ents[1], [4, 4]);
});

test("design rules follow the shape: a part in a cut-out, a track through the notch, a hole at the round edge", () => {
  const board = fabBoard(fancy()), { m, hv, conn, fills } = analyse(board);
  assert.deepEqual(B.drc(board, m, conn, hv, fills, NETLIST).filter(d => ["edge", "unplaced", "holeedge"].includes(d.kind)), [], "as placed: all on the board");
  Object.assign(board.parts[Object.keys(board.parts).find(k => board.parts[k].ref === "R2")], { x: 38, y: 73 });   // one end onto the slot
  board.tracks.push({ layer: "F.Cu", w: 0.6, pts: [[40, 6], [80, 6]] });                    // across the notch
  board.holes.push({ x: 100, y: 28.5, d: 3.2 });                                             // 0.9 mm from the round cut-out
  const a2 = analyse(board), drc = B.drc(board, a2.m, a2.conn, a2.hv, a2.fills, NETLIST);
  assert.ok(drc.some(d => d.kind === "edge" && /R2/.test(d.msg)), "R2 over the slot");
  assert.ok(drc.some(d => d.kind === "edge" && /track .* runs outside the board outline/.test(d.msg)), "the track through the notch");
  assert.ok(drc.some(d => d.kind === "holeedge"), "the hole too near the cut-out");
  // a part wholly inside the round cut-out is not "on the board"; one whose box is bigger than a small round board still is
  const round = fabBoard(O.circleOutline(30), { VL1: [15, 15], R1: [200, 18], R2: [200, 55], C1: [200, 75], VT1: [200, 30], G1: [200, 90], T1: [200, 110] }), ar = analyse(round);
  const d2 = B.drc(round, ar.m, ar.conn, ar.hv, ar.fills, NETLIST);
  assert.ok(!d2.some(d => d.kind === "unplaced" && /VL1/.test(d.msg)), "the valve in the middle of the round board is placed");
  assert.ok(d2.filter(d => d.kind === "unplaced").length >= 5);
});

test("Gerber Edge_Cuts: one closed contour per loop, every point on the true edge, the box as the board's size", () => {
  for (const [name, o, loops] of [["fancy", fancy(), 3], ["round", O.circleOutline(110), 1], ["hexagon", hexagon(), 1]]) {
    const board = fabBoard(o), { m, fills } = analyse(board), files = F.fabFiles(board, m, fills, { base: "t", title: name, version: "9.9.9" });
    const ops = readGerber(files["t-Edge_Cuts.gbr"]);
    assert.match(files["t-Edge_Cuts.gbr"], /%TF\.FileFunction,Profile,NP\*%/);
    assert.equal(ops.length, loops, `${name}: ${loops} contour(s)`);
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    ops.forEach((c, i) => {
      assert.equal(c.t, "line"); assert.equal(c.pol, "D"); near(c.w, 0.1);
      near(Math.hypot(c.pts[0][0] - c.pts[c.pts.length - 1][0], c.pts[0][1] - c.pts[c.pts.length - 1][1]), 0, 1e-6);   // closed
      c.pts.forEach(([x, y]) => { near(O.dist(o, x, o.h - y), 0, 2e-4); if (!i) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); } });
      // no chord strays more than 5 µm from the true curve
      for (let k = 0; k + 1 < c.pts.length; k++) near(O.dist(o, (c.pts[k][0] + c.pts[k + 1][0]) / 2, o.h - (c.pts[k][1] + c.pts[k + 1][1]) / 2), 0, 0.0052);
    });
    near(x1, 0, 1e-3); near(y1, 0, 1e-3); near(x2, o.w, 1e-3); near(y2, o.h, 1e-3);
    // the contour's own area is the shape's (the round one: π r²)
    const A = P => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    near(ops.reduce((s, c, i) => s + (i ? -1 : 1) * A(c.pts.slice(0, -1)), 0), O.area(o), O.perimeter(o) * 0.005);   // each chord at most 5 µm inside its arc
    assert.match(files["t-README.txt"], name === "round" ? /Board: round Ø110 mm/ : name === "fancy" ? /custom shape 120 × 90 mm, 2 cut-outs \(the Edge_Cuts file has the edge and the cut-outs to rout\)/ : /custom shape 100 × 86\.6 mm \(the Edge_Cuts file has the edge\)/);
  }
  // a round board's contour: every point 55 mm from the middle
  const rb = fabBoard(O.circleOutline(110)), ra = analyse(rb), rc = readGerber(F.fabFiles(rb, ra.m, ra.fills, { base: "t" })["t-Edge_Cuts.gbr"])[0];
  rc.pts.forEach(([x, y]) => near(Math.hypot(x - 55, y - 55), 55, 2e-4)); assert.ok(rc.pts.length > 200, "fine steps");
});

test("Gerber copper: the pour is cut to the shape and its cut-outs, the edge clearance kept everywhere; pads stay", () => {
  for (const [name, o] of [["fancy", fancy()], ["round", O.circleOutline(110)]]) {
    const board = fabBoard(o), { m, fills } = analyse(board), files = F.fabFiles(board, m, fills, { base: "t", title: name, version: "9.9.9" });
    const ops = readGerber(files["t-B_Cu.gbr"]), e = board.rules.edgeClearance;
    assert.ok(ops.some(q => q.t === "region" && q.pol === "D"), "the pour is there");
    let inside = 0, copper = 0, tooNear = 0, off = 0;
    for (let x = -1.9; x < o.w + 2; x += 0.7) for (let y = -1.9; y < o.h + 2; y += 0.7) {
      const d = O.dist(o, x, o.h - y), ink = inkAt(ops, x, y);
      if (d < 0 && ink) off++;                       // copper off the board or in a cut-out
      else if (d < e - 0.03 && ink) tooNear++;       // copper nearer the edge than the rule
      if (d > e + 0.3) { inside++; if (ink) copper++; }
    }
    assert.equal(off, 0, `${name}: no copper outside the edge or in a cut-out`);
    assert.equal(tooNear, 0, `${name}: nothing nearer than ${e} mm to an edge`);
    assert.ok(copper / inside > 0.8, `${name}: the pour fills the board (${(100 * copper / inside).toFixed(0)} %)`);
    // right at the clearance the copper begins: 0.2 mm further in there is copper all along the edge
    let along = 0, have = 0;
    O.segs(o).forEach(sg => { const n = Math.max(2, Math.round(O.segLen(sg) / 2)); for (let k = 1; k < n; k++) { const p = sg.t === "A" ? O.arcPt(sg, k / n) : [sg.x1 + (sg.x2 - sg.x1) * k / n, sg.y1 + (sg.y2 - sg.y1) * k / n]; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) { const x = p[0] + dx * (e + 0.35), y = p[1] + dy * (e + 0.35), d = O.dist(o, x, y); if (d > e + 0.2 && d < e + 0.4 && !m.pads.some(pd => Math.hypot(pd.x - x, pd.y - y) < 4)) { along++; if (inkAt(ops, x, o.h - y)) have++; } } } });
    assert.ok(along > 50 && have / along > 0.97, `${name}: copper up to the clearance line (${have}/${along})`);
    // every pad is on both copper layers at its place
    const top = readGerber(files["t-F_Cu.gbr"]);
    m.pads.filter(p => !p.smd).forEach(p => { assert.ok(top.some(q => q.t === "flash" && Math.hypot(q.x - p.x, q.y - (o.h - p.y)) < 1e-4), `pad ${p.ref}-${p.num} on top`); assert.ok(ops.some(q => q.t === "flash" && q.pol === "D" && Math.hypot(q.x - p.x, q.y - (o.h - p.y)) < 1e-4), `pad ${p.ref}-${p.num} on the bottom`); });
    // the fill the editor reports: one piece, joined to the GND pads
    assert.equal(fills[0].pieces, 1); assert.equal(fills[0].unknownNet, false);
  }
});

test("Gerber silkscreen and drills: silk stays 0.1 mm inside the shape, the drill files do not change with it", () => {
  const o = fancy(), board = fabBoard(o);
  board.texts.push({ x: 60, y: 6, text: "ACROSS THE NOTCH", size: 3, layer: "F.SilkS", rot: 0 }, { x: 50, y: 73, text: "OVER THE SLOT", size: 2.5, layer: "F.SilkS", rot: 0 }, { x: 117, y: 86, text: "CORNER", size: 2, layer: "F.SilkS", rot: 0 });
  const { m, fills } = analyse(board), files = F.fabFiles(board, m, fills, { base: "t", title: "t", version: "9.9.9" });
  const silk = readGerber(files["t-F_Silkscreen.gbr"]).filter(q => q.t === "line" && q.pol === "D");
  assert.ok(silk.length > 50);
  let worst = Infinity; silk.forEach(q => q.pts.forEach(([x, y]) => { worst = Math.min(worst, O.dist(o, x, o.h - y)); }));
  assert.ok(worst >= 0.1 - 2e-3, `silk no nearer than 0.1 mm to an edge (${worst.toFixed(4)})`);
  // the texts were really cut: on a rectangle of the same size they have more ink
  const rect = fabBoard({ w: 120, h: 90, r: 0 }); rect.texts = board.texts.map(t => ({ ...t }));
  const ar = analyse(rect), rs = readGerber(F.fabFiles(rect, ar.m, ar.fills, { base: "t" })["t-F_Silkscreen.gbr"]).filter(q => q.t === "line" && q.pol === "D");
  const len = S => S.reduce((s, q) => s + q.pts.reduce((a, p, i) => a + (i ? Math.hypot(p[0] - q.pts[i - 1][0], p[1] - q.pts[i - 1][1]) : 0), 0), 0);
  assert.ok(len(silk) < len(rs) - 20, `${len(silk).toFixed(0)} mm of silk on the shaped board, ${len(rs).toFixed(0)} mm on the rectangle`);
  assert.equal(files["t-PTH.drl"], F.fabFiles(rect, ar.m, ar.fills, { base: "t", title: "t", version: "9.9.9" })["t-PTH.drl"], "the same drills");
  // the mask and the paste do not depend on the shape either
  assert.equal(files["t-F_Mask.gbr"], F.fabFiles(rect, ar.m, ar.fills, { base: "t", title: "t", version: "9.9.9" })["t-F_Mask.gbr"]);
});

test("Gerber with a pour of its own outline on a shaped board: clipped all the same", () => {
  const o = fancy(), board = fabBoard(o);
  board.zones = [{ net: "GND", layer: "F.Cu", pts: [[-10, 45], [130, 45], [130, 100], [-10, 100]], thermal: true, gap: 0.5, spoke: 0.8 }];
  const { m, fills } = analyse(board), ops = readGerber(F.fabFiles(board, m, fills, { base: "t" })["t-F_Cu.gbr"]), e = board.rules.edgeClearance;
  let bad = 0, in1 = 0, cu1 = 0, cu2 = 0;
  for (let x = -1.5; x < 122; x += 0.9) for (let y = -1.5; y < 92; y += 0.9) {
    const d = O.dist(o, x, y), ink = inkAt(ops, x, o.h - y);
    if (d < e - 0.03 && ink) bad++;
    if (d > e + 0.3 && y > 46.5) { in1++; if (ink) cu1++; }
    if (y < 43.5 && ink && !m.pads.some(p => Math.hypot(p.x - x, p.y - y) < 3)) cu2++;
  }
  assert.equal(bad, 0); assert.ok(cu1 / in1 > 0.75, `${cu1}/${in1}`); assert.equal(cu2, 0, "nothing above the pour's own edge");
});

test("Freerouting design and KiCad: the shape as the boundary, cut-outs closed to tracks; arcs as arcs", () => {
  const o = fancy(), board = fabBoard(o), { m, conn, hv } = analyse(board);
  const dsn = globalThis.BoardRoute.toDsn(board, m, conn, B.clearanceRules(board, m, hv, NETLIST), { hv, title: "t" }).text;
  const bnd = /\(boundary \(path pcb 0 ([^)]*)\)/.exec(dsn); assert.ok(bnd);
  assert.ok(bnd[1].trim().split(/\s+/).length / 2 > 40, "the boundary follows the arcs");
  assert.equal((dsn.match(/\(keepout "cutout" \(polygon F\.Cu/g) || []).length, 2); assert.equal((dsn.match(/\(keepout "cutout" \(polygon B\.Cu/g) || []).length, 2);
  const pcb = globalThis.KicadExport.pcb(board, m, conn, { title: "t", version: "9.9.9" });
  const lines = (pcb.match(/\(gr_line [^\n]*"Edge\.Cuts"/g) || []).length, arcs = (pcb.match(/\(gr_arc [^\n]*"Edge\.Cuts"/g) || []).length;
  assert.equal(lines, 6 + 2, "six straight edges and the slot's two sides"); assert.equal(arcs, 2 + 2 + 2, "the notch, the corner, the circle's halves, the slot's ends");
  assert.match(pcb, /\(gr_arc \(start 50 0\) \(mid 60 10\) \(end 70 0\)/);
  // and back: KiCad's edge read as the same shape
  const back = B.normaliseBoard(globalThis.KicadImport.importProject({ "t.kicad_pcb": pcb }).design.board).outline;
  assert.ok(O.isShape(back)); assert.equal(back.shape.length, 3); assert.deepEqual([back.w, back.h], [120, 90]);
  near(O.area(back), O.area(o), 0.01);
  for (const [x, y] of [[60, 5], [60, 15], [100, 20], [50, 73], [118, 88], [10, 10]]) near(O.dist(back, x, y), O.dist(o, x, y), 1e-3);
  // a round board comes back round
  const rb = fabBoard(O.circleOutline(110)), ra = analyse(rb), rpcb = globalThis.KicadExport.pcb(rb, ra.m, ra.conn, { title: "t", version: "9.9.9" });
  assert.equal(O.describe(B.normaliseBoard(globalThis.KicadImport.importProject({ "t.kicad_pcb": rpcb }).design.board).outline), "round Ø110 mm");
});

test("3D and STEP: the solid has the shape (its area × thickness), arcs as cylinders, cut-outs as openings", () => {
  for (const [name, o, cyl] of [["fancy", fancy(), 6], ["round", O.circleOutline(110), 2], ["hexagon", hexagon(), 0]]) {
    const board = fabBoard(o), { m } = analyse(board), keep = new Set(m.parts.filter(g => g.place).map(g => g.key)), s = D3.boardSolid(board, m, keep);
    // the mesh: the top face's loops are the edge, the drilled holes and the cut-outs
    const top = s.faces.find(f => f.n[2] === 1), drilled = m.pads.filter(p => !p.smd && O.dist(o, p.x, p.y) > p.drill / 2 + 0.01).length;   // (the hexagon cuts two parts' pads off: they are not drilled in the solid)
    assert.equal(top.loops.length, 1 + drilled + (o.shape.length - 1), `${name}: loops of the top face`);
    const A = loop => Math.abs(loop.reduce((a, i, k) => { const p = s.verts[i], q = s.verts[loop[(k + 1) % loop.length]]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    near(A(top.loops[0]), Math.abs(O.loopArea(o.shape[0])), 2);
    // STEP: lines → planes, arcs → cylinders, each hole a cylinder, two flat ends
    const txt = D3.step({ board: s, bodies: [] }, { title: name, version: "9.9.9", file: "t.step", date: "2026-11-12T12:00:00" });
    const n = re => (txt.match(re) || []).length, segs = O.segs(o).length;
    assert.equal(n(/CYLINDRICAL_SURFACE/g), cyl + drilled, `${name}: cylinders`);
    assert.equal(n(/ADVANCED_FACE/g), segs + drilled + 2, `${name}: faces`);
    assert.equal(n(/CLOSED_SHELL/g), 1);
    // every edge of the solid is used twice, once each way (a closed, oriented shell)
    const use = new Map(); for (const mm of txt.matchAll(/ORIENTED_EDGE\('',\*,\*,(#\d+),\.([TF])\.\)/g)) { const u = use.get(mm[1]) || []; u.push(mm[2]); use.set(mm[1], u); }
    assert.ok([...use.values()].every(u => u.length === 2 && u[0] !== u[1]), `${name}: each edge once in each direction`);
  }
  // a hole that breaks through the edge of a shaped board is left out of the solid (it could not be one)
  const o = O.circleOutline(60), board = fabBoard(o, { VL1: [30, 30], R1: [200, 18], R2: [200, 55], C1: [200, 75], VT1: [200, 30], G1: [200, 90], T1: [200, 110] });
  board.holes.push({ x: 30, y: 1, d: 3.2 }, { x: 30, y: 50, d: 3.2 });
  const { m } = analyse(board), s = D3.boardSolid(board, m, new Set(m.parts.filter(g => g.ref === "VL1").map(g => g.key)));
  assert.equal(s.round.holes.filter(h => Math.abs(h.r - 1.6) < 1e-9).length, 1);
});

test("construction geometry on a shaped board: its edges and arcs as curves, offsets inwards, ties renumbered", () => {
  const o = fancy(), board = B.newBoard(); board.outline = o; K.normalise(board);
  const curves = K.outlineCurves(o);
  assert.equal(curves.length, O.segs(o).length);
  assert.equal(curves.filter(c => c.t === "C").length, 6);
  // the notch: an arc the board is outside of; the rounded corner: inside
  const notch = curves.find(c => c.t === "C" && Math.abs(c.cx - 60) < 1e-6 && Math.abs(c.cy - 90) < 1e-6), corner = curves.find(c => c.t === "C" && Math.abs(c.cx - 8) < 1e-6 && Math.abs(c.cy - 8) < 1e-6);
  assert.ok(notch && notch.cv && corner && !corner.cv);
  assert.ok(K.onArc(notch, 270) && !K.onArc(notch, 90), "the notch's arc dips into the board (user frame: Y up)");
  assert.ok(K.onArc(corner, 225) && !K.onArc(corner, 45));
  // an offset of the whole contour runs 2 mm inside every edge
  board.construct.items.push({ id: "c1", k: "offset", of: { id: "@outline" }, d: 2 });
  const sol = K.solve(board, null);
  sol.items.c1.curves.filter(Boolean).forEach(c => { const p = c.t === "L" ? [(c.x1 + c.x2) / 2, (c.y1 + c.y2) / 2] : [c.cx + c.r * Math.cos((c.a0 + ((c.a1 - c.a0 + 360) % 360) / 2) * Math.PI / 180), c.cy + c.r * Math.sin((c.a0 + ((c.a1 - c.a0 + 360) % 360) / 2) * Math.PI / 180)]; near(O.dist(o, p[0], o.h - p[1]), 2, 1e-6); });
  assert.equal(K.curveName(sol, { id: "@outline", k: 0 }), "board edge 1"); assert.match(K.curveName(sol, { id: "@outline", k: 1 }), /^board arc 2$/);
  // one edge's offset, and a hole tied to a fixed point: the box grows 10 mm to the left and 5 mm down, both stay on the board where they were
  board.construct.items.push({ id: "c2", k: "offset", of: { id: "@outline", k: 3 }, d: 4 }, { id: "c3", k: "point", at: { x: 20, y: 30 } });
  board.holes.push({ x: 20, y: 60, d: 3.2, at: { x: 20, y: 30 } });
  const h0 = board.holes[0];
  K.shift(board, 10, 5, { 3: 7 });
  assert.equal(board.construct.items.find(i => i.id === "c2").of.k, 7); assert.equal(board.construct.items.find(i => i.id === "c1").of.k, undefined);
  assert.deepEqual(board.construct.items.find(i => i.id === "c3").at, { x: 30, y: 35 }); assert.deepEqual(board.holes[0].at, { x: 30, y: 35 }); assert.notEqual(board.holes[0], h0);
  K.shift(board, 0, 0, {}); assert.equal(board.construct.items.find(i => i.id === "c2").of.k, -1, "an edge that is gone: the tie is lost, not moved to another edge");
  // nothing of it reaches the manufacturing files
  const fb = fabBoard(fancy()), a = analyse(fb), plain = JSON.stringify(F.fabFiles(fb, a.m, a.fills, { base: "t" }));
  K.normalise(fb); fb.construct.items.push({ id: "c1", k: "offset", of: { id: "@outline" }, d: 2 });
  assert.equal(JSON.stringify(F.fabFiles(fb, a.m, a.fills, { base: "t" })), plain);
});

test("the grid router keeps to the shape: round a slot between two pads, never nearer the edge than the rule", () => {
  const PF = globalThis.BoardPathfinder;
  const nl0 = { names: { 0: "GND", 1: "A" }, volts: { 0: 0, 1: 5 }, parts: [part("r1", "resistor", "R1", { r: 1e3 }, { 1: 1, 2: 0 }), part("r2", "resistor", "R2", { r: 1e3 }, { 1: 1, 2: 0 }), part("gnd", "ground", "", {}, { G: 0 })] };
  const board = B.newBoard(); board.rules.heaters = false; board.rules.shields = false;
  // 60 × 40 with a slot down the middle (x 29..31, y 6..34) and a bite out of the bottom edge
  board.outline = O.outlineOf(O.fromEntities([Ln(0, 0, 60, 0), Ln(60, 0, 60, 40), Ln(60, 40, 36, 40), Ar(36, 40, 24, 40, 1), Ln(24, 40, 0, 40), Ln(0, 40, 0, 0), Ln(29, 6, 31, 6), Ln(31, 6, 31, 28), Ln(31, 28, 29, 28), Ln(29, 28, 29, 6)]));
  assert.equal(board.outline.shape.length, 2);
  const nl = B.withHeaters(nl0, board.rules); B.sync(board, nl);
  const at = { R1: [12, 20], R2: [48, 20] }; Object.values(board.parts).forEach(p => { p.x = at[p.ref][0]; p.y = at[p.ref][1]; });
  const hv = B.hvNets(nl.volts, board.rules.hvVolts), m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  assert.ok(conn.unrouted >= 2);
  const r = PF.route(board, m, conn, { clr: B.clearanceRules(board, m, hv, nl), hv, netlist: nl });
  assert.equal(r.open, 0, "both nets routed");
  board.tracks = board.tracks.concat(r.add.tracks); board.vias = board.vias.concat(r.add.vias);
  const c1 = B.connectivity(board, B.model(board, nl).pads); assert.equal(c1.unrouted, 0);
  let worst = Infinity;
  board.tracks.forEach(t => { for (let k = 0; k + 1 < t.pts.length; k++) for (let s = 0; s <= 20; s++) { const x = t.pts[k][0] + (t.pts[k + 1][0] - t.pts[k][0]) * s / 20, y = t.pts[k][1] + (t.pts[k + 1][1] - t.pts[k][1]) * s / 20; worst = Math.min(worst, O.dist(board.outline, x, y) - t.w / 2); } });
  assert.ok(worst >= board.rules.edgeClearance - 1e-6, `tracks ${worst.toFixed(3)} mm from the nearest edge (rule ${board.rules.edgeClearance})`);
  assert.deepEqual(B.drc(board, B.model(board, nl), c1, hv, [], nl).filter(d => d.kind === "edge"), []);
});
