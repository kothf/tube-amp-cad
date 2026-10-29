/**
 * Placement repair for routing (board-place.js): which parts may move, and the annealing that
 * nudges them to untangle the ratsnest while keeping the board's rules (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-sat.js", "board-place.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, P = globalThis.BoardPlace, L = globalThis.CadLib;

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
// four resistors on two nets that cross: R1 (top left) to R3 (bottom right), R2 (bottom left) to R4 (top right)
const NETLIST = {
  names: { 0: "GND", 1: "A", 2: "B" },
  volts: { 1: 10, 2: 10 },
  parts: [
    part("r1", "resistor", "R1", { r: 1e3 }, { 1: 1, 2: 0 }),
    part("r2", "resistor", "R2", { r: 1e3 }, { 1: 2, 2: 0 }),
    part("r3", "resistor", "R3", { r: 1e3 }, { 1: 1, 2: 0 }),
    part("r4", "resistor", "R4", { r: 1e3 }, { 1: 2, 2: 0 }),
    part("v1", "tube", "VL1", { tube: "12AX7" }, { A: 1, G: 2, K: 0 }),
    part("gnd", "ground", "", {}, { G: 0 })
  ]
};
function setup() {
  const board = B.newBoard(); board.outline = { w: 100, h: 60, r: 0 }; board.rules.heaters = false; board.rules.shields = false;
  const nl = B.withHeaters(NETLIST, board.rules); B.sync(board, nl);
  const at = { R1: [10, 10], R2: [10, 40], R3: [50, 40], R4: [50, 10], VL1: [85, 30] };
  Object.values(board.parts).forEach(p => { if (at[p.ref]) { p.x = at[p.ref][0]; p.y = at[p.ref][1]; } });
  return { board, nl };
}
const crossings = conn => {
  const s = conn.rats.filter(r => r.net !== 0), x = (a, b) => {
    const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    const A = [a.x1, a.y1], A2 = [a.x2, a.y2], C = [b.x1, b.y1], C2 = [b.x2, b.y2];
    return o(A, A2, C) * o(A, A2, C2) < 0 && o(C, C2, A) * o(C, C2, A2) < 0;
  };
  let n = 0; s.forEach((a, i) => s.slice(i + 1).forEach(b => { if (a.net !== b.net && x(a, b)) n++; })); return n;
};

test("the random source is seeded: the same seed gives the same numbers", () => {
  const a = P.rng(7), b = P.rng(7), c = P.rng(8);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  assert.ok(sa.every(v => v >= 0 && v < 1));
});

test("movable: unlocked small parts near an open connection; never a valve, a locked part or a far one", () => {
  const { board, nl } = setup(), m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  const ref = k => board.parts[k].ref;
  const all = P.movable(board, m, conn.rats, { radius: 100 }).map(ref).sort();
  assert.deepEqual(all, ["R1", "R2", "R3", "R4"]);
  board.parts[Object.keys(board.parts).find(k => board.parts[k].ref === "R4")].locked = true;
  const m2 = B.model(board, nl);
  assert.ok(!P.movable(board, m2, conn.rats, { radius: 100 }).map(ref).includes("R4"), "a locked part stays");
  // only the parts within reach of the one line from R1 to R3 (R1-1 at 10,10; R3-1 at 50,40)
  const line = conn.rats.filter(r => m.names[r.net] === "A");
  const near = P.movable(board, m, line, { radius: 2 }).map(ref).sort();
  assert.ok(near.includes("R1") && near.includes("R3"), `the line's own parts move (${near})`);
});

test("nudge untangles crossing nets, keeps every rule, and leaves locked parts and valves where they were", () => {
  const { board, nl } = setup(), m = B.model(board, nl), conn = B.connectivity(board, m.pads), clr = B.clearanceRules(board, m, new Set(), nl);
  assert.deepEqual(B.drc(board, m, conn, new Set(), [], nl).filter(d => ["courtyard", "edge", "clearance", "keepout"].includes(d.kind)).map(d => d.msg), [], "the board starts clean");
  const before = crossings(conn), vl = { ...Object.values(board.parts).find(p => p.ref === "VL1") };
  const keys = P.movable(board, m, conn.rats, { radius: 100 });
  const r = P.nudge(board, m, keys, { clr, netlist: nl, conn, seed: 3 });
  const m2 = B.model(board, nl), c2 = B.connectivity(board, m2.pads);
  assert.ok(before > 0 && crossings(c2) < before, `crossings ${before} -> ${crossings(c2)}`);
  assert.ok(r.cost1 < r.cost0 && r.moved.length > 0 && r.taken > 0 && r.tried >= r.taken, `cost ${r.cost0.toFixed(1)} -> ${r.cost1.toFixed(1)}, ${r.moved.length} moved`);
  const bad = B.drc(board, m2, c2, new Set(), [], nl).filter(d => ["courtyard", "edge", "clearance", "keepout"].includes(d.kind));
  assert.deepEqual(bad.map(d => d.msg), []);
  const vl2 = Object.values(board.parts).find(p => p.ref === "VL1");
  assert.equal(vl2.x, vl.x); assert.equal(vl2.y, vl.y);
  // every move is on the 1.27 mm grid
  r.moved.forEach(mv => { assert.ok(Math.abs(mv.to.x / 1.27 - Math.round(mv.to.x / 1.27)) < 1e-6 || Math.abs((mv.to.x - mv.from.x) / 1.27 - Math.round((mv.to.x - mv.from.x) / 1.27)) < 1e-6, `${mv.ref} x on the grid`); });
});

test("nudge is repeatable, keeps parts within reach, and stays clear of a keep-out and mounting holes", () => {
  const run = () => {
    const { board, nl } = setup();
    board.keepouts = [{ name: "jack", pts: [[25, 0], [35, 0], [35, 60], [25, 60]], layers: ["F.Cu", "B.Cu"], parts: true }];
    board.holes = [{ x: 30, y: 30, d: 3.2 }];
    const m = B.model(board, nl), conn = B.connectivity(board, m.pads);
    const r = P.nudge(board, m, P.movable(board, m, conn.rats, { radius: 100 }), { clr: B.clearanceRules(board, m, new Set(), nl), netlist: nl, conn, seed: 5, reach: 10 });
    return { board, nl, r };
  };
  const a = run(), b = run();
  assert.deepEqual(a.r.moved, b.r.moved);
  a.r.moved.forEach(mv => assert.ok(Math.hypot(mv.to.x - mv.from.x, mv.to.y - mv.from.y) <= 10 + 1e-6, `${mv.ref} within 10 mm`));
  const m = B.model(a.board, a.nl), c = B.connectivity(a.board, m.pads);
  const bad = B.drc(a.board, m, c, new Set(), [], a.nl).filter(d => ["courtyard", "keepout"].includes(d.kind));
  assert.deepEqual(bad.map(d => d.msg), []);
});

test("nudge keeps a high-voltage pad its clearance from other nets' pads", () => {
  const { board, nl } = setup(), nl2 = { ...nl, volts: { 1: 400, 2: 0 } }, hv = B.hvNets(nl2.volts, board.rules.hvVolts);
  const m = B.model(board, nl2), conn = B.connectivity(board, m.pads), clr = B.clearanceRules(board, m, hv, nl2);
  P.nudge(board, m, P.movable(board, m, conn.rats, { radius: 100 }), { clr, hv, netlist: nl2, conn, seed: 9 });
  const m2 = B.model(board, nl2), c2 = B.connectivity(board, m2.pads);
  const bad = B.drc(board, m2, c2, hv, [], nl2).filter(d => d.kind === "clearance");
  assert.deepEqual(bad.map(d => d.msg), []);
});

test("describe says what moved, in words", () => {
  assert.equal(P.describe([{ ref: "R7", from: { x: 0, y: 0, rot: 0 }, to: { x: 2.54, y: 0, rot: 0 } }, { ref: "C3", from: { x: 1, y: 1, rot: 0 }, to: { x: 1, y: 1, rot: 3 } }]), "R7 2.5 mm, C3 turned 90°");
});

// a small transistor whose base runs to a resistor across the board
const NL2 = {
  names: { 0: "GND", 1: "C", 2: "BASE" },
  volts: { 1: 9, 2: 0.7 },
  parts: [
    part("q1", "npn", "VT1", { model: "2N3904" }, { C: 1, B: 2, E: 0 }),
    part("r1", "resistor", "R1", { r: 1e3 }, { 1: 2, 2: 0 }),
    part("r2", "resistor", "R2", { r: 1e3 }, { 1: 1, 2: 0 }),
    part("gnd", "ground", "", {}, { G: 0 })
  ]
};
function setup2() {
  const board = B.newBoard(); board.outline = { w: 60, h: 40, r: 0 }; board.rules.heaters = false; board.rules.shields = false;
  B.sync(board, NL2);
  const at = { VT1: [20, 20], R1: [40, 20], R2: [15, 32] };
  Object.values(board.parts).forEach(p => { if (at[p.ref]) { p.x = at[p.ref][0]; p.y = at[p.ref][1]; } });
  return board;
}
const analyse2 = board => { const m = B.model(board, NL2), conn = B.connectivity(board, m.pads), clr = B.clearanceRules(board, m, new Set(), NL2); return { m, conn, clr }; };
const baseRats = (m, conn) => conn.rats.filter(r => m.names[r.net] === "BASE");
// a ring of tracks of no net round VT1, on both layers
const ring = (board, x1, y1, x2, y2) => ["F.Cu", "B.Cu"].forEach(layer => board.tracks.push({ layer, w: 0.6, pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]] }));

test("escape: a pin with room gets out; a ring of copper round its part shuts it in, and the walls name the tracks", () => {
  const board = setup2();
  let { m, conn, clr } = analyse2(board);
  const free = P.escape(board, m, conn, baseRats(m, conn), { clr });
  assert.ok(free.length >= 1 && free.every(e => e.ok), JSON.stringify(free.map(e => [e.ref, e.flow])));
  assert.ok(P.passage(board, m, conn, baseRats(m, conn), { clr }).every(p => p.ok), "a way through to R1");
  ring(board, 15, 15, 25, 25); ({ m, conn, clr } = analyse2(board));
  const shut = P.escape(board, m, conn, baseRats(m, conn), { clr, margin: 8 }), vt = shut.find(e => e.ref === "VT1");
  assert.ok(vt && !vt.ok && vt.flow === 0 && vt.pins.some(p => !p.out), JSON.stringify(vt));
  assert.ok(vt.walls.length && vt.walls[0].kind === "track", `walls: ${vt.walls.map(w => w.what)}`);
  const pass = P.passage(board, m, conn, baseRats(m, conn), { clr });
  assert.ok(pass.length && !pass[0].ok && pass[0].walls.some(w => w.kind === "track"), JSON.stringify(pass));
  assert.match(P.describeEscape(shut), /^VT1 pin \d+ \(shut in by a track on [FB]\.Cu/);
});

test("escape: counts every pin of a part at once (a gap one track wide lets one pin out, not two)", () => {
  const board = setup2();
  // both VT1's base and collector have open connections; the ring on F.Cu has one opening, on B.Cu none
  ring(board, 15, 15, 25, 25);
  board.tracks = board.tracks.map(t => (t.layer === "F.Cu" ? { ...t, pts: [[21.45, 15], [25, 15], [25, 25], [15, 25], [15, 15], [18.55, 15]] } : t));
  const { m, conn, clr } = analyse2(board);
  const rats = conn.rats.filter(r => ["BASE", "C"].includes(m.names[r.net]));
  const vt = P.escape(board, m, conn, rats, { clr, margin: 8 }).find(e => e.ref === "VT1");
  assert.ok(vt && vt.pins.length === 2 && vt.flow === 1 && !vt.ok, JSON.stringify(vt && { flow: vt.flow, pins: vt.pins }));
});

test("bridge: a grid path joins an open connection with a track that keeps every rule", () => {
  const board = setup2(), { m, conn, clr } = analyse2(board), rats = baseRats(m, conn);
  const b = P.bridge(board, m, conn, rats, { clr });
  assert.ok(b && b.track.pts.length >= 2 && b.track.net === "BASE" && b.track.w === board.rules.track, JSON.stringify(b));
  board.tracks.push(b.track);
  const m2 = B.model(board, NL2), c2 = B.connectivity(board, m2.pads);
  assert.equal(c2.rats.filter(r => m2.names[r.net] === "BASE").length, 0, "the base is joined to R1");
  const bad = B.drc(board, m2, c2, new Set(), [], NL2).filter(d => ["clearance", "edge", "short", "width"].includes(d.kind));
  assert.deepEqual(bad.map(d => d.msg), []);
});

const RULES = ["courtyard", "edge", "clearance", "keepout"];
test("spread: a pile of parts goes over the board legally, on the grid; valves stay", () => {
  const { board, nl } = setup();
  board.keepouts = [{ name: "jack", pts: [[60, 0], [70, 0], [70, 25], [60, 25]], layers: ["F.Cu", "B.Cu"], parts: true }];
  board.holes = [{ x: 5, y: 55, d: 3.2 }];
  Object.values(board.parts).forEach(p => { if (/^R/.test(p.ref)) { p.x = 30 + Number(p.ref[1]); p.y = 30; } });
  const vl = { ...Object.values(board.parts).find(p => p.ref === "VL1") };
  const m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  assert.ok(B.drc(board, m, conn, new Set(), [], nl).some(d => d.kind === "courtyard"), "the pile starts overlapping");
  const keys = P.movable(board, m, [], { also: new Set(m.parts.map(g => g.key)) });
  const r = P.spread(board, m, keys, { clr: B.clearanceRules(board, m, new Set(), nl), netlist: nl, conn });
  assert.equal(r.failed, null);
  assert.ok(r.moved.length >= 3 && r.over < 0.1, `${r.moved.length} moved, overflow ${r.over.toFixed(2)} after ${r.iters} steps`);
  const m2 = B.model(board, nl), c2 = B.connectivity(board, m2.pads);
  assert.deepEqual(B.drc(board, m2, c2, new Set(), [], nl).filter(d => RULES.includes(d.kind)).map(d => d.msg), []);
  const v2 = Object.values(board.parts).find(p => p.ref === "VL1");
  assert.equal(v2.x, vl.x); assert.equal(v2.y, vl.y);
  r.moved.forEach(mv => { assert.ok(Math.abs(mv.to.x / 1.27 - Math.round(mv.to.x / 1.27)) < 1e-6 && Math.abs(mv.to.y / 1.27 - Math.round(mv.to.y / 1.27)) < 1e-6, `${mv.ref} on the grid`); });
});

test("spread: shortens the wiring of a spread-out board, and an inflated part gets more room round it", () => {
  const run = infl => {
    const { board, nl } = setup(), m = B.model(board, nl), conn = B.connectivity(board, m.pads);
    const keys = P.movable(board, m, [], { also: new Set(m.parts.map(g => g.key)) }), r1 = m.parts.find(g => g.ref === "R1").key;
    const r = P.spread(board, m, keys, { clr: B.clearanceRules(board, m, new Set(), nl), netlist: nl, conn, inflate: infl ? new Map([[r1, 2.5]]) : null });
    const m2 = B.model(board, nl), box = k => B.partBox(m2.parts.find(g => g.key === k));
    const a = box(r1), gap = Math.min(...m2.parts.filter(g => g.key !== r1 && g.fp && g.place).map(g => { const b = box(g.key); return Math.max(b.x1 - a.x2, a.x1 - b.x2, b.y1 - a.y2, a.y1 - b.y2); }));
    return { r, gap };
  };
  const plain = run(false), fat = run(true);
  assert.ok(plain.r.wire1 < plain.r.wire0, `wire ${plain.r.wire0.toFixed(0)} -> ${plain.r.wire1.toFixed(0)}`);
  assert.ok(fat.gap > plain.gap, `R1's room ${plain.gap.toFixed(2)} -> ${fat.gap.toFixed(2)} mm`);
});

// exact: lay the window's result on the board as the finisher does
const lay = (board, r) => {
  board.tracks = board.tracks.filter((_, i) => !r.cut.tracks.has(i)).concat(r.add.tracks);
  board.vias = board.vias.filter((_, i) => !r.cut.vias.has(i)).concat(r.add.vias);
  const m = B.model(board, NL2), conn = B.connectivity(board, m.pads);
  return { m, conn, bad: B.drc(board, m, conn, new Set(), [], NL2).filter(d => ["clearance", "edge", "short", "width"].includes(d.kind)).map(d => d.msg) };
};
// another net's track across the way on both layers, from the board's top edge to its bottom
const wall = board => ["F.Cu", "B.Cu"].forEach(layer => board.tracks.push({ layer, w: 0.6, net: "C", pts: [[30, 2], [30, 38]] }));

test("exact: joins an open connection through a wall of another net, and that net stays joined", () => {
  const board = setup2(); wall(board);
  const { m, conn, clr } = analyse2(board), rats = baseRats(m, conn);
  assert.ok(!P.passage(board, m, conn, rats, { clr })[0].ok, "the wall shuts the way on both layers");
  const r = P.exact(board, m, conn, rats, { clr, i: 0, margin: 8 });
  assert.ok(r && r.sat, JSON.stringify(r));
  assert.ok(r.cut.tracks.size >= 1 && r.add.tracks.some(t => t.net === "BASE"), "the wall came up and the base went through");
  const after = lay(board, r);
  assert.equal(after.conn.rats.filter(q => after.m.names[q.net] === "BASE").length, 0, "the base is joined to R1");
  // the wall's top and bottom halves are still one piece, on each layer
  const cl = (x, y, layer) => after.conn.items.find(it => it.kind === "track" && board.tracks[it.ti].layer === layer && board.tracks[it.ti].pts.some(p => p[0] === x && p[1] === y)).cluster;
  ["F.Cu", "B.Cu"].forEach(layer => assert.equal(cl(30, 2, layer), cl(30, 38, layer), `the wall on ${layer} in one piece`));
  assert.deepEqual(after.bad, []);
});

test("exact: proves there is no way when the copper in the way is locked", () => {
  const board = setup2(); ring(board, 15, 15, 25, 25); board.tracks.forEach(t => { t.locked = true; });
  const { m, conn, clr } = analyse2(board), r = P.exact(board, m, conn, baseRats(m, conn), { clr, i: 0, margin: 8 });
  assert.ok(r && r.sat === false && !r.unknown, JSON.stringify(r && { sat: r.sat, why: r.why, unknown: r.unknown }));
  assert.equal(r.why, "no path");
});

test("the SAT solver: finds a model that meets every clause, and proves three pigeons can't share two holes", () => {
  const S = globalThis.BoardSat.solver(), v = [0, 1, 2, 3].map(() => S.newVar());
  [[v[0], v[1]], [-v[0], v[2]], [-v[1], -v[2]], [-v[2], v[3]], [-v[3], -v[1]]].forEach(c => S.add(c));
  assert.equal(S.solve(), true);
  assert.ok([[v[0], v[1]], [-v[0], v[2]], [-v[1], -v[2]], [-v[2], v[3]], [-v[3], -v[1]]].every(c => c.some(l => S.value(Math.abs(l)) === l > 0)));
  const H = globalThis.BoardSat.solver(), p = [0, 1, 2].map(() => [H.newVar(), H.newVar()]);
  p.forEach(([a, b]) => H.add([a, b]));
  for (let h = 0; h < 2; h++) for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) H.add([-p[i][h], -p[j][h]]);
  assert.equal(H.solve(), false);
});

test("access: a part parked in the only way out of a ring moves aside, after which the pin's track gets through", () => {
  const board = setup2();
  // a locked ring round VT1 on both layers with one opening on the left, and R2's pad in that opening
  ["F.Cu", "B.Cu"].forEach(layer => board.tracks.push({ layer, w: 0.6, locked: true, pts: [[13, 18], [13, 13], [27, 13], [27, 27], [13, 27], [13, 22]] }));
  const r2 = Object.values(board.parts).find(p => p.ref === "R2"); r2.x = 9.92; r2.y = 20; r2.rot = 0;
  let { m, conn, clr } = analyse2(board);
  const shut = P.escape(board, m, conn, baseRats(m, conn), { clr }).find(e => e.ref === "VT1");
  assert.ok(shut && !shut.ok && shut.walls.some(w => w.kind === "part" && w.what === "R2"), JSON.stringify(shut && shut.walls.map(w => w.what)));
  const moves = P.access(board, m, conn, baseRats(m, conn), { clr, netlist: NL2, conn });
  assert.equal(moves.length, 1); assert.equal(moves[0].ref, "R2"); assert.equal(moves[0].frees, "VT1 pin 2");
  assert.ok(Math.hypot(moves[0].to.x - moves[0].from.x, moves[0].to.y - moves[0].from.y) <= 5.08 + 1e-6, "a small move");
  Object.assign(r2, moves[0].to); ({ m, conn, clr } = analyse2(board));
  const b = P.bridge(board, m, conn, baseRats(m, conn), { clr, margin: 10 });
  assert.ok(b, "now a track reaches R1");
  board.tracks.push(b.track);
  const m2 = B.model(board, NL2), c2 = B.connectivity(board, m2.pads);
  assert.equal(c2.rats.filter(r => m2.names[r.net] === "BASE").length, 0);
  assert.deepEqual(B.drc(board, m2, c2, new Set(), [], NL2).filter(d => ["clearance", "short", "courtyard", "edge"].includes(d.kind)).map(d => d.msg), []);
});

test("smooth: a staircase track is pulled into straight and 45° runs, stays joined and keeps clear of another net", () => {
  const { board, nl } = setup();
  let m = B.model(board, nl);
  const pa = m.pads.filter(p => m.names[p.net] === "A").sort((a, b) => a.x - b.x), [s, e] = pa;
  // a staircase from R1's pin to R3's: 1 mm steps across, then down
  const pts = [[s.x, s.y]]; let x = s.x, y = s.y;
  while (x < e.x - 1e-6 || y < e.y - 1e-6) { if (x < e.x - 1e-6) { x = Math.min(e.x, x + 1); pts.push([x, y]); } if (y < e.y - 1e-6) { y = Math.min(e.y, y + 1); pts.push([x, y]); } }
  board.tracks.push({ layer: "B.Cu", w: 0.6, net: "A", pts });
  // a locked track of net B across the straight way
  board.tracks.push({ layer: "B.Cu", w: 0.6, net: "B", locked: true, pts: [[30, 18], [30, 32]] });
  m = B.model(board, nl);
  let conn = B.connectivity(board, m.pads);
  const open0 = conn.rats.filter(x => m.names[x.net] === "A").length;
  const clr = B.clearanceRules(board, m, new Set(), nl), bad0 = B.drc(board, m, conn, new Set(), [], nl).filter(d => ["clearance", "short", "edge"].includes(d.kind)).length;
  const len = P => P.reduce((t, p, k) => t + (k ? Math.hypot(p[0] - P[k - 1][0], p[1] - P[k - 1][1]) : 0), 0);
  const r = P.smooth(board, m, conn, null, { clr });
  assert.equal(r.length, 1); assert.equal(r[0].ti, 0);
  const q = r[0].pts;
  assert.ok(q.length < 10 && len(q) < len(pts) - 5, `${pts.length} points, ${len(pts).toFixed(1)} mm -> ${q.length}, ${len(q).toFixed(1)} mm`);
  q.slice(1).forEach((p, k) => { const dx = Math.abs(p[0] - q[k][0]), dy = Math.abs(p[1] - q[k][1]); assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6, `segment ${k} is straight or 45°`); });
  assert.deepEqual(q[0], [s.x, s.y]); assert.deepEqual(q[q.length - 1], [e.x, e.y]);
  board.tracks[0].pts = q;
  m = B.model(board, nl); conn = B.connectivity(board, m.pads);
  assert.equal(conn.rats.filter(x => m.names[x.net] === "A").length, open0, "still joined");
  assert.equal(B.drc(board, m, conn, new Set(), [], nl).filter(d => ["clearance", "short", "edge"].includes(d.kind)).length, bad0, "no new rule message");
  // a second pass finds nothing more to do
  assert.equal(P.smooth(board, m, conn, null, { clr }).length, 0);
});

test("design: lays the board out from scratch within its rules, turning parts; locked parts, holes and keep-outs hold", () => {
  const { board, nl } = setup();
  board.holes = [{ x: 30, y: 30, d: 3.2 }];
  board.keepouts = [{ name: "jack", pts: [[70, 0], [100, 0], [100, 15], [70, 15]], layers: ["F.Cu", "B.Cu"], parts: true }];
  const r4 = Object.values(board.parts).find(p => p.ref === "R4"); r4.locked = true;
  const lockedAt = { x: r4.x, y: r4.y };
  const m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  const keys = Object.keys(board.parts).filter(k => !board.parts[k].locked && m.parts.find(g => g.key === k && g.fp));
  const before = JSON.stringify(board);
  const r = P.design(board, m, conn, [], { keys, netlist: nl, hv: new Set(), seed: 2 });
  assert.equal(JSON.stringify(board), before, "the board given is not changed");
  assert.ok(r.places && Object.keys(r.places).length === keys.length, JSON.stringify(r));
  assert.ok(Number.isFinite(r.score) && r.shut === 0, `score ${r.score}, shut ${r.shut}, cross ${r.cross}`);
  Object.entries(r.places).forEach(([k, p]) => Object.assign(board.parts[k], p));
  assert.deepEqual({ x: r4.x, y: r4.y }, lockedAt);
  const m2 = B.model(board, nl), c2 = B.connectivity(board, m2.pads);
  assert.deepEqual(B.drc(board, m2, c2, new Set(), [], nl).filter(d => ["courtyard", "edge", "keepout", "clearance", "unplaced"].includes(d.kind)).map(d => d.msg), []);
  // the same seed gives the same layout
  assert.deepEqual(P.design(JSON.parse(before), m, conn, [], { keys, netlist: nl, hv: new Set(), seed: 2 }).places, r.places);
});

test("advise: names rules stricter than needed and a part against the edge, and is quiet when nothing is open", () => {
  const { board, nl } = setup();
  Object.assign(board.rules, { track: 1, power: 1.25, clearance: 0.6 });
  board.outline = { w: 40, h: 30, r: 0 };
  const m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  const tips = P.advise(board, m, conn, conn.rats, { clr: B.clearanceRules(board, m, new Set(), nl), hv: new Set(), netlist: nl });
  assert.ok(tips.some(t => /^signal tracks 1 mm: 0.6 mm/.test(t)) && tips.some(t => /^power tracks 1.25 mm/.test(t)) && tips.some(t => /^clearance 0.6 mm/.test(t)) && tips.some(t => /VL1.* against the board edge/.test(t)), tips.join(" | "));
  assert.deepEqual(P.advise(board, m, conn, [], {}), []);
});

test("stitch: a ground pad its pour cannot reach gets a short track and a via down into the pour", () => {
  const { board, nl } = setup();
  board.zones = [{ net: "GND", layer: "B.Cu", pts: [[0, 0], [100, 0], [100, 60], [0, 60]] }];
  let m = B.model(board, nl);
  const pad = m.pads.find(p => p.ref === "R1" && m.names[p.net] === "GND");
  // a ring of net B round R1's ground pad on the bottom layer only: the pour cannot get in
  const x = pad.x, y = pad.y;
  board.tracks.push({ layer: "B.Cu", w: 0.6, net: "B", locked: true, pts: [[x - 3, y - 3], [x + 3, y - 3], [x + 3, y + 3], [x - 3, y + 3], [x - 3, y - 3]] });
  const look = () => {
    m = B.model(board, nl);
    const c0 = B.connectivity(board, m.pads), fills = B.fillZones(board, m, c0, new Set(), nl, []);
    return { conn: B.connectivity(board, m.pads, fills), fills };
  };
  let { conn, fills } = look();
  const open = () => conn.rats.filter(r => m.names[r.net] === "GND" && [[r.x1, r.y1], [r.x2, r.y2]].some(([a, b]) => Math.hypot(a - x, b - y) < 1e-3));
  assert.ok(open().length > 0, "the pad starts cut off");
  const clr = B.clearanceRules(board, m, new Set(), nl);
  const tries = P.stitch(board, m, conn, open(), { clr });
  assert.ok(tries.length > 0, "places to try");
  let took = null;
  for (const t of tries) {
    board.tracks.push(t.track); board.vias.push(t.via); ({ conn, fills } = look());
    if (!open().length) { took = t; break; }
    board.tracks.pop(); board.vias.pop(); ({ conn, fills } = look());
  }
  assert.ok(took, "one of them joins the pad to the pour");
  assert.equal(took.track.layer, "F.Cu");
  assert.ok(Math.hypot(took.via.x - x, took.via.y - y) > 3, "the via sits outside the ring");
  assert.deepEqual(B.drc(board, m, conn, new Set(), fills, nl).filter(d => ["clearance", "short", "edge"].includes(d.kind)).map(d => d.msg), []);
});
