/**
 * Placement repair for routing (board-place.js): which parts may move, and the annealing that
 * nudges them to untangle the ratsnest while keeping the board's rules (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-place.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
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
