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
