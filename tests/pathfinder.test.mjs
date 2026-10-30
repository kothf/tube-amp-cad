/**
 * The board's own grid router (board-pathfinder.js): negotiated congestion, rip-up and reroute.
 * It routes crossing nets within the rules, keeps high-voltage clearances, takes up only the
 * unlocked copper in the way and never locked copper (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "board-pathfinder.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, PF = globalThis.BoardPathfinder, L = globalThis.CadLib;

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
// resistors in a ring whose nets cross: A joins R1 to R3, B joins R2 to R4, C joins R5 to R6 across both
const NETLIST = {
  names: { 0: "GND", 1: "A", 2: "B", 3: "C" },
  volts: { 0: 0, 1: 5, 2: 5, 3: 5 },
  parts: [
    part("r1", "resistor", "R1", { r: 1e3 }, { 1: 1, 2: 0 }),
    part("r2", "resistor", "R2", { r: 1e3 }, { 1: 2, 2: 0 }),
    part("r3", "resistor", "R3", { r: 1e3 }, { 1: 1, 2: 0 }),
    part("r4", "resistor", "R4", { r: 1e3 }, { 1: 2, 2: 0 }),
    part("r5", "resistor", "R5", { r: 1e3 }, { 1: 3, 2: 0 }),
    part("r6", "resistor", "R6", { r: 1e3 }, { 1: 3, 2: 0 }),
    part("gnd", "ground", "", {}, { G: 0 })
  ]
};
function setup(nl0, at, w, h) {
  const board = B.newBoard(); board.outline = { w: w || 70, h: h || 50, r: 0 }; board.rules.heaters = false; board.rules.shields = false;
  const nl = B.withHeaters(nl0, board.rules); B.sync(board, nl);
  Object.values(board.parts).forEach(p => { if (at[p.ref]) { p.x = at[p.ref][0]; p.y = at[p.ref][1]; p.rot = at[p.ref][2] || 0; } });
  return { board, nl };
}
function check(board, nl) {
  const hv = B.hvNets(nl.volts, board.rules.hvVolts), m = B.model(board, nl), conn = B.connectivity(board, m.pads);
  return { m, conn, hv, clr: B.clearanceRules(board, m, hv, nl), drc: B.drc(board, m, conn, hv, [], nl).filter(d => ["clearance", "short", "dangling", "edge", "keepout"].includes(d.kind)) };
}
function apply(board, r) {
  board.tracks = board.tracks.filter((_, i) => !r.cut.tracks.has(i)).concat(r.add.tracks);
  board.vias = board.vias.filter((_, i) => !r.cut.vias.has(i)).concat(r.add.vias);
}
const AT = { R1: [8, 12], R2: [8, 38], R3: [50, 38], R4: [50, 12], R5: [32, 4], R6: [32, 46] };

test("a bare board: crossing nets all routed, none too close to another, the ends in the pads' middles", () => {
  const { board, nl } = setup(NETLIST, AT), c0 = check(board, nl);
  assert.ok(c0.conn.unrouted >= 5, `${c0.conn.unrouted} to route`);
  const r = PF.route(board, c0.m, c0.conn, { clr: c0.clr, hv: c0.hv, netlist: nl });
  assert.equal(r.open, 0); assert.equal(r.conflicts, 0);
  assert.equal(r.cut.tracks.size, 0, "nothing on the board to take up");
  apply(board, r);
  const c1 = check(board, nl);
  assert.equal(c1.conn.unrouted, 0);
  assert.deepEqual(c1.drc.map(d => d.msg), []);
  // every track ends in a pad's middle, a via or another track of its net
  const pads = c1.m.pads;
  board.tracks.forEach(t => [t.pts[0], t.pts[t.pts.length - 1]].forEach(([x, y]) => assert.ok(pads.some(p => Math.hypot(p.x - x, p.y - y) < 1e-3) || board.vias.some(v => Math.hypot(v.x - x, v.y - y) < 1e-3) || board.tracks.some(u => u !== t && u.pts.some((q, k) => k && B.segDist(u.pts[k - 1][0], u.pts[k - 1][1], q[0], q[1], x, y) < u.w / 2 + 1e-3)), `track end ${x},${y}`)));
});

test("copper in the way: only the unlocked pieces that block come up and are routed again; locked copper stays", () => {
  const { board, nl } = setup(NETLIST, AT);
  // B (R2 to R4) runs straight down the middle, blocking A and C on the top layer; one piece of it is locked
  const m0 = B.model(board, nl), pad = (ref, num) => m0.pads.find(p => p.ref === ref && p.num === num);
  const p2 = pad("R2", "1"), p4 = pad("R4", "1");
  board.tracks.push({ layer: "F.Cu", w: 0.6, pts: [[p2.x, p2.y], [p2.x + 5, p2.y]], net: "B", locked: true });
  board.tracks.push({ layer: "F.Cu", w: 0.6, pts: [[p2.x + 5, p2.y], [p2.x + 5, p4.y + 3], [p4.x, p4.y + 3], [p4.x, p4.y]], net: "B" });
  const c0 = check(board, nl);
  const r = PF.route(board, c0.m, c0.conn, { clr: c0.clr, hv: c0.hv, netlist: nl });
  assert.ok(!r.cut.tracks.has(0), "the locked track stays");
  assert.ok(r.cut.tracks.has(1), "the unlocked track in the way comes up");
  apply(board, r);
  const c1 = check(board, nl);
  assert.equal(c1.conn.unrouted, 0, `open: ${c1.conn.rats.map(x => c1.m.names[x.net]).join(", ")}`);
  assert.deepEqual(c1.drc.map(d => d.msg), []);
  assert.ok(board.tracks.some(t => t.locked && t.net === "B"));
});

test("high voltage: tracks keep the clearance the voltage between the nets asks", () => {
  const nl0 = JSON.parse(JSON.stringify(NETLIST)); nl0.volts[1] = 400; nl0.volts[3] = 300;
  const { board, nl } = setup(nl0, AT), c0 = check(board, nl);
  assert.ok(c0.clr.need(1, 2).c >= 2, `A to B needs ${c0.clr.need(1, 2).c} mm`);
  const r = PF.route(board, c0.m, c0.conn, { clr: c0.clr, hv: c0.hv, netlist: nl });
  apply(board, r);
  const c1 = check(board, nl);
  assert.equal(c1.conn.unrouted, 0);
  assert.deepEqual(c1.drc.map(d => d.msg), []);
});

test("no way through: a net walled in by locked copper is left open, nothing else breaks", () => {
  const { board, nl } = setup(NETLIST, { ...AT, R1: [16, 16] }), m0 = B.model(board, nl), p1 = m0.pads.find(p => p.ref === "R1" && p.num === "1");
  // a locked GND ring round R1's pin 1 on both layers
  const ring = (L) => ({ layer: L, w: 0.6, net: "GND", locked: true, pts: [[p1.x - 3, p1.y - 3], [p1.x + 3, p1.y - 3], [p1.x + 3, p1.y + 3], [p1.x - 3, p1.y + 3], [p1.x - 3, p1.y - 3]] });
  board.tracks.push(ring("F.Cu"), ring("B.Cu"));
  const c0 = check(board, nl), r = PF.route(board, c0.m, c0.conn, { clr: c0.clr, hv: c0.hv, netlist: nl });
  assert.ok(r.open >= 1);
  assert.equal(r.cut.tracks.size, 0);
  apply(board, r);
  const c1 = check(board, nl);
  assert.ok(c1.conn.rats.some(x => c1.m.names[x.net] === "A"), "A is still open");
  assert.deepEqual(c1.drc.filter(d => d.kind !== "dangling").map(d => d.msg), []);
});
