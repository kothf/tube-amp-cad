/**
 * Board Design core (board-core.js): footprints, the schematic-to-board mapping,
 * synchronisation, connectivity, ratsnest and design-rule checks (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib;

// a small amplifier as the CAD sends it: a 12AX7 (two sections) with plate and cathode
// resistors, an MPSA42 follower, an output transformer off the board, a supply
const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const NETLIST = {
  names: { 0: "GND", 1: "B+" },
  volts: { 1: 300, 2: 150, 3: 1.5, 4: 0 },
  parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }),
    part("r1", "resistor", "R1", { r: 100e3, w: "0.5" }, { 1: 1, 2: 2 }),
    part("r2", "resistor", "R2", { r: 1.5e3 }, { 1: 3, 2: 0 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }),
    part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
    part("q1", "npn", "VT1", { model: "MPSA42" }, { C: 1, B: 2, E: 8 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 3, "-": 0 }),
    part("t1", "opt_se", "T1", {}, { P1: 1, P2: 2, S1: 9, S2: 0 }),
    part("gnd", "ground", "", {}, { G: 0 })
  ]
};

test("every footprint option of every part and every tube resolves to pads", () => {
  for (const type of Object.keys(L.LIB)) {
    if (["frame", "note", "ground", "offsheet", "scope"].includes(type)) continue;
    const variants = type === "tube" ? globalThis.TUBE_DATABASE.map(t => ({ tube: t.commonName })) : type === "npn" || type === "pnp" ? Object.keys(L.BJTS).filter(k => (L.BJTS[k].pol > 0) === (type === "npn")).map(model => ({ model }))
      : type === "nmos" || type === "pmos" ? Object.keys(L.MOSFETS).filter(k => (L.MOSFETS[k].pol > 0) === (type === "nmos")).map(model => ({ model })) : type === "zener" ? Object.keys(L.ZENERS).map(model => ({ model })) : [{}];
    for (const params of variants) {
      const g = B.physicalParts({ parts: [part("x", type, "X1", params, Object.fromEntries(L.LIB[type].pins({ params: Object.assign({}, L.LIB[type].defaults, params) }).map(p => [p.id, 1])))] })[0];
      for (const name of g.options) { const f = B.footprint(name, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].slice(0, +(/WIRE-(\d+)/.exec(name) || [])[1] || 0)); assert.ok(f && f.pads.length > 0, `${type} ${JSON.stringify(params)}: ${name}`); }
    }
  }
});

test("Noval socket: 9 pins on an 11.89 mm circle, 36° apart, the gap at the bottom between pins 9 and 1", () => {
  const f = B.footprint("SOCKET-B9A");
  assert.equal(f.pads.length, 9);
  f.pads.forEach(p => assert.ok(Math.abs(Math.hypot(p.x, p.y) - 11.89 / 2) < 1e-3, `pin ${p.num} radius`));
  const ang = p => Math.atan2(p.y, p.x) * 180 / Math.PI;
  for (let k = 0; k + 1 < 9; k++) { let d = ang(f.pads[k]) - ang(f.pads[k + 1]); d = ((d % 360) + 360) % 360; assert.ok(Math.abs(d - 36) < 0.02, `pins ${k + 1}→${k + 2} step ${d}`); }
  const p1 = f.pads[0], p9 = f.pads[8];
  assert.ok(Math.abs(p1.x + p9.x) < 1e-3 && p1.y > 0 && Math.abs(p1.y - p9.y) < 1e-3, "pins 1 and 9 sit symmetric about the gap (straight down)");
  assert.ok(p1.x > 0, "seen from the component side, pin 1 is right of the gap (the pins run counter-clockwise)");
  assert.equal(B.footprint("SOCKET-OCTAL").pads.length, 8);
});

test("the two sections of a 12AX7 share one Noval socket, each on its own pins; the heater pins carry no net", () => {
  const parts = B.physicalParts(NETLIST), vl = parts.find(g => g.ref === "VL1");
  assert.equal(parts.filter(g => g.type === "tube").length, 1);
  assert.equal(vl.defaultFp, "SOCKET-B9A");
  const board = B.newBoard(); B.sync(board, NETLIST);
  const m = B.model(board, NETLIST), pad = n => m.pads.find(p => p.ref === "VL1" && p.num === String(n));
  // 12AX7: section 1 = pins 6 (A), 7 (G), 8 (K); section 2 = pins 1 (A), 2 (G), 3 (K)
  assert.deepEqual([6, 7, 8].map(n => pad(n).net), [2, 4, 3]);
  assert.deepEqual([1, 2, 3].map(n => pad(n).net), [5, 6, 7]);
  assert.deepEqual([4, 5, 9].map(n => pad(n).net), [null, null, null]);
});

test("transistor pads follow the part's pin order (MPSA42: E-B-C from pad 1)", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  const m = B.model(board, NETLIST), q = m.pads.filter(p => p.ref === "VT1");
  assert.equal(m.parts.find(g => g.ref === "VT1").fp.name, "TO-92-EBC");
  assert.deepEqual(q.map(p => [p.num, p.name, p.net]), [["1", "E", 8], ["2", "B", 2], ["3", "C", 1]]);
  assert.equal(m.parts.find(g => g.ref === "R1").fp.name, "AXIAL-12.7", "a 0.5 W resistor gets 12.7 mm lead spacing");
  assert.equal(m.parts.find(g => g.ref === "T1").fp.name, "WIRE-4", "the output transformer is wired from the chassis");
  assert.deepEqual(m.pads.filter(p => p.ref === "T1").map(p => p.name), ["P1", "P2", "S1", "S2"]);
  assert.equal(m.names[1], "B+"); assert.equal(m.names[0], "GND");
});

test("update from the schematic: new parts wait below the board, placed parts keep their spot, deleted parts leave", () => {
  const board = B.newBoard(), r = B.sync(board, NETLIST);
  assert.equal(r.added.length, 7);
  Object.values(board.parts).forEach(p => assert.ok(p.y > board.outline.h, `${p.ref} waits below the board`));
  board.parts.r1.x = 20; board.parts.r1.y = 30;
  const smaller = { ...NETLIST, parts: NETLIST.parts.filter(p => p.id !== "c1") };
  const r2 = B.sync(board, smaller);
  assert.deepEqual(r2.removed, ["C1"]); assert.equal(r2.added.length, 0);
  assert.deepEqual([board.parts.r1.x, board.parts.r1.y], [20, 30]);
  const m = B.model(board, smaller), c = B.connectivity(board, m.pads), d = B.drc(board, m, c, new Set());
  assert.equal(d.filter(x => x.kind === "unplaced").length, 5, "five parts still to place");
});

test("ratsnest, routing, shorts and clearance", () => {
  // two resistors on the board: R1 pad 2 and the tube's anode share net 2
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.assign(board.parts.r1, { x: 30, y: 30, rot: 0 });
  Object.assign(board.parts["v1a+v1b"], { x: 80, y: 40, rot: 0 });
  let m = B.model(board, NETLIST), c = B.connectivity(board, m.pads);
  const r1b = m.pads.find(p => p.ref === "R1" && p.num === "2"), a1 = m.pads.find(p => p.ref === "VL1" && p.num === "6");
  assert.ok(c.rats.some(r => r.net === 2), "a ratsnest line for the anode net");
  const before = c.unrouted;
  // route R1-2 to the anode (pin 6)
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[r1b.x, r1b.y], [a1.x, r1b.y], [a1.x, a1.y]] });
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads);
  assert.equal(c.unrouted, before - 1, "one connection fewer to route");
  const it = c.items.find(x => x.kind === "track"); assert.equal(it.net, 2, "the track takes the net of its pads");
  // a track from the anode to the grid (pin 7, another net) is a short
  const g1 = m.pads.find(p => p.ref === "VL1" && p.num === "7");
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[a1.x, a1.y], [g1.x, g1.y]] });
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads);
  assert.ok(c.shorts.length === 1 && B.drc(board, m, c, new Set()).some(d => d.kind === "short"), "the short is reported");
  board.tracks.pop();
  // a track passing 0.3 mm from a pad of another net breaks the 0.6 mm clearance; on an HV net 2 mm applies
  const r1a = m.pads.find(p => p.ref === "R1" && p.num === "1");
  const y = r1a.y + r1a.h / 2 + 0.3 + 0.5;
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[r1a.x - 10, y], [r1a.x + 10, y]] });
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads);
  const low = B.drc(board, m, c, new Set()).filter(d => d.kind === "clearance");
  assert.ok(low.length >= 1 && /0\.30 mm < 0\.6 mm/.test(low[0].msg), low.map(d => d.msg).join("; "));
  board.tracks.pop();
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[r1a.x - 10, r1a.y + r1a.h / 2 + 1.2 + 0.5], [r1a.x + 10, r1a.y + r1a.h / 2 + 1.2 + 0.5]] });
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads);
  assert.equal(B.drc(board, m, c, new Set()).filter(d => d.kind === "clearance").length, 0, "1.2 mm is enough for a low-voltage net");
  const hv = B.drc(board, m, c, B.hvNets(NETLIST.volts, 60)).filter(d => d.kind === "clearance");
  assert.ok(hv.length >= 1 && /high voltage/.test(hv[0].msg), "but not next to B+ (300 V): the HV clearance applies");
});

test("rotation and the bottom side move pads as the footprint turns and mirrors", () => {
  const p = { x: 10, y: 20, rot: 1, side: "F" };
  assert.deepEqual(B.place([5, 0], p), [10, 15], "90°: a pad right of the origin goes up (counter-clockwise on screen)");
  assert.deepEqual(B.place([5, 0], { ...p, rot: 0, side: "B" }), [5, 20], "bottom side: mirrored left-right");
});

test("design rules: edge clearance (rounded corners too), holes, rings, drills, minimum and class widths", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.values(board.parts).forEach((p, i) => Object.assign(p, { x: 20 + (i % 4) * 30, y: 20 + Math.floor(i / 4) * 30 }));
  board.outline = { w: 160, h: 100, r: 10 };
  // the rounded corner: the board's corner point is outside, its centre is inside
  assert.ok(B.edgeDist(0.5, 0.5, board.outline) < 0 && B.edgeDist(10, 10, board.outline) > 0);
  let m = B.model(board, NETLIST), c = B.connectivity(board, m.pads), d = B.drc(board, m, c, new Set());
  assert.ok(!d.some(x => ["edge", "drill", "annular", "width"].includes(x.kind)), d.map(x => x.msg).join("; "));
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[60, 0.8], [90, 0.8]] });          // 0.3 mm from the top edge
  board.tracks.push({ layer: "B.Cu", w: 0.3, pts: [[60, 90], [90, 90]] });          // below the 0.4 mm minimum
  board.vias.push({ x: 140, y: 80, drill: 0.4, pad: 0.9 });                         // drill and ring too small
  board.holes.push({ x: 75, y: 89.5, d: 3.2 });                                     // touches the thin track
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads); d = B.drc(board, m, c, new Set());
  const kinds = d.map(x => x.kind);
  assert.ok(kinds.includes("edge") && /0\.30 mm from the board edge/.test(d.find(x => x.kind === "edge").msg), "edge clearance");
  assert.ok(kinds.includes("width") && kinds.includes("drill") && kinds.includes("annular"), kinds.join(","));
  assert.ok(d.some(x => x.kind === "clearance" && /mounting hole/.test(x.msg)), "copper too close to a mounting hole");
  // turning a check off drops it
  board.rules.checks.edge = false;
  assert.ok(!B.drc(board, m, c, new Set()).some(x => x.kind === "edge"));
});

test("net classes: automatic by voltage and name, or set by hand; the HV class asks wider tracks and clearance", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  const m = B.model(board, NETLIST), hv = B.hvNets(NETLIST.volts, board.rules.hvVolts);
  assert.equal(B.netClassOf(1, m.names, hv, board.rules), "HV", "B+ at 300 V");
  assert.equal(B.netClassOf(0, m.names, hv, board.rules), "Power", "GND");
  assert.equal(B.netClassOf(3, m.names, hv, board.rules), "Signal", "the cathode at 1.5 V");
  board.rules.netClass[m.names[3]] = "Power";
  assert.equal(B.netClassOf(3, m.names, hv, board.rules), "Power", "a class set by hand wins");
  const rows = B.netTable(board, m, hv, NETLIST.volts), bp = rows.find(r => r.name === "B+");
  assert.deepEqual([bp.cls, bp.track, bp.clearance, bp.volts], ["HV", 2, 2, 300]);
  assert.ok(rows.find(r => r.name === m.names[3]).manual);
  // a 1 mm track on B+ is narrower than its class asks
  Object.values(board.parts).forEach((p, i) => Object.assign(p, { x: 20 + (i % 4) * 30, y: 20 + Math.floor(i / 4) * 30 }));
  const m2 = B.model(board, NETLIST), r1 = m2.pads.find(p => p.ref === "R1" && p.num === "1");
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[r1.x, r1.y], [r1.x, r1.y - 8]] });
  const m3 = B.model(board, NETLIST), c = B.connectivity(board, m3.pads);
  assert.ok(B.drc(board, m3, c, hv).some(x => x.kind === "class" && /B\+ \(HV\) is 1 mm; the class asks 2 mm/.test(x.msg)));
});

test("board setup: corner mounting holes sit inset from each corner; an older board file gains the new fields", () => {
  const holes = B.cornerHoles({ w: 100, h: 60 }, 3.2, 5);
  assert.deepEqual(holes.map(h => [h.x, h.y]), [[5, 5], [95, 5], [5, 55], [95, 55]]);
  const old = B.normaliseBoard({ outline: { w: 80, h: 50 }, rules: { clearance: 0.8 }, parts: {}, tracks: [] });
  assert.deepEqual([old.outline.r, old.rules.clearance, old.rules.hvVolts, old.holes.length, old.texts.length, old.rules.checks.edge, old.stackup.thickness], [0, 0.8, 60, 0, 0, true, 1.6]);
});
