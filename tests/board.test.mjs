/**
 * Board Design core (board-core.js): footprints, the schematic-to-board mapping,
 * synchronisation, connectivity, ratsnest and design-rule checks (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "pdf-export.js", "board-fab.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab;

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
      for (const name of g.options) { const f = B.footprint(name, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].slice(0, +(/(?:WIRE|TERM-[\d.]+)-(\d+)$/.exec(name) || [])[1] || 0)); assert.ok(f && f.pads.length > 0, `${type} ${JSON.stringify(params)}: ${name}`); }
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
  const t1 = m.parts.find(g => g.ref === "T1");
  assert.equal(t1.fp.name, "XFMR-EI66-SE", "the output transformer gets a board-mount EI footprint");
  assert.ok(t1.options.includes("WIRE-4") && t1.options.includes("TERM-5.08-4"), "or wire pads / a screw terminal to a chassis-mounted one");
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
  Object.values(board.parts).forEach(p => { if (p.fp.startsWith("XFMR")) p.fp = "WIRE-4"; });   // the transformer wired from the chassis
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

test("every part has a through-hole footprint, and every footprint it offers takes all its pins", () => {
  const L = globalThis.CadLib.LIB;
  for (const [type, def] of Object.entries(L)) {
    if (["note", "frame", "ground", "offsheet", "scope"].includes(type)) continue;
    const params = { ...(def.defaults || {}) }, pins = (typeof def.pins === "function" ? def.pins({ params }) : def.pins);
    for (const sections of type === "switch" ? [1, 2] : [1]) {
      const nl = { parts: Array.from({ length: sections }, (_, k) => ({ id: "c" + k, type, label: sections > 1 ? `X1.${k + 1}` : "X1", params, pins: pins.map((p, i) => ({ id: p.id, net: k * 10 + i + 1 })) })) };
      const [g] = B.physicalParts(nl);
      if (type !== "tube") assert.ok(!/^WIRE-/.test(g.options[0]), `${type}: a real footprint by default, not wire pads (${g.options[0]})`);
      for (const o of g.options) {
        const f = B.footprint(o, g.members.flatMap(m => m.pins.map(p => (sections > 1 ? m.label.split(".").pop() + "." : "") + p.id)));
        assert.ok(f, `${type}: ${o}`);
        assert.equal(new Set(f.pads.map(p => p.num)).size, f.pads.length, `${o}: pad numbers unique`);
        if (type === "tube") continue;
        const got = new Set([...B.padMap(g, f).values()].flat().map(x => x.comp + ":" + x.pin));
        g.members.forEach(m => m.pins.forEach(p => assert.ok(got.has(m.id + ":" + p.id), `${type} ×${sections} on ${o}: pin ${p.id} has a pad`)));
      }
    }
  }
  const dpdt = B.footprint("TOGGLE-DPDT");
  assert.deepEqual(dpdt.pads.map(p => p.name), ["1.A", "1.C", "1.B", "2.A", "2.C", "2.B"]);
  assert.deepEqual(B.footprint("XFMR-EI76-PP").pads.map(p => p.name), ["P1", "U1", "CT", "U2", "P2", "S1", "S2"]);
});

// a placed board for the pour and fabrication tests: GND pour on the bottom, holes, a text
function fabBoard() {
  const board = B.newBoard(); B.sync(board, NETLIST); board.outline = { w: 120, h: 90, r: 4 };
  const at = { VL1: [30, 30], R1: [60, 15], R2: [30, 55], C1: [55, 55], VT1: [75, 30], G1: [15, 78], T1: [95, 60] };
  Object.values(board.parts).forEach(p => { Object.assign(p, { x: at[p.ref][0], y: at[p.ref][1] }); if (p.ref === "T1") p.fp = "TERM-5.08-4"; });
  board.holes = B.cornerHoles(board.outline, 3.2, 5);
  board.texts.push({ x: 60, y: 84, text: "TEST", size: 2, layer: "F.SilkS", rot: 0 });
  board.zones.push({ net: "GND", layer: "B.Cu", pts: null, thermal: true, gap: 0.5, spoke: 0.8 });
  return board;
}
function analyse(board) {
  const m = B.model(board, NETLIST), hv = B.hvNets(NETLIST.volts, board.rules.hvVolts), c0 = B.connectivity(board, m.pads), fills = B.fillZones(board, m, c0, hv);
  return { m, hv, c0, fills, conn: B.connectivity(board, m.pads, fills) };
}

test("stroke font: centred text, rotation and mirror", () => {
  const t = B.strokeText("R1", 10, 20, 1.2, 0, false), xs = t.lines.flat().map(p => p[0]), ys = t.lines.flat().map(p => p[1]);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 10) < 0.15 && Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 20) < 0.05, "centred");
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 1.2) < 1e-6, "cap height = size");
  const m = B.strokeText("R1", 0, 0, 1.2, 0, true), r = B.strokeText("R1", 0, 0, 1.2, 1, false), n = B.strokeText("R1", 0, 0, 1.2, 0, false);
  assert.deepEqual(m.lines[0][0], [-n.lines[0][0][0] || 0, n.lines[0][0][1]], "mirror flips x");
  assert.ok(Math.max(...r.lines.flat().map(p => Math.abs(p[0]))) < 0.61, "rotated: the text runs up the y axis");
  assert.ok(B.strokeText("1kΩ µF", 0, 0, 2).lines.length >= 8, "Ω and µ have glyphs");
});

test("copper pour: joins its net's pads by thermal spokes, keeps every other net's clearance, removes islands", () => {
  const board = fabBoard(), { m, c0, fills, conn } = analyse(board), f = fills[0];
  assert.equal(fills.length, 1);
  assert.ok(c0.rats.some(r => m.names[r.net] === "GND"), "before the pour GND is unrouted");
  assert.ok(!conn.rats.some(r => m.names[r.net] === "GND"), "the pour connects every GND pad");
  assert.ok(conn.unrouted < c0.unrouted);
  // rasterise the pour and measure its distance to other nets' pads: never under their clearance
  const nx = Math.ceil(board.outline.w / B.RES), ny = Math.ceil(board.outline.h / B.RES), g = B.rasterise(f.ops, nx, ny), hv = B.hvNets(NETLIST.volts, 60);
  let worst = Infinity;
  m.pads.filter(p => p.netName !== "GND").forEach(p => {
    const need = B.classRule(B.netClassOf(p.net, m.names, hv, board.rules), board.rules).clearance, r = Math.max(p.w, p.h) / 2 + need + 1;
    for (let j = Math.max(0, Math.floor((p.y - r) / B.RES)); j <= Math.min(ny - 1, (p.y + r) / B.RES); j++) for (let i = Math.max(0, Math.floor((p.x - r) / B.RES)); i <= Math.min(nx - 1, (p.x + r) / B.RES); i++) {
      if (!g[j * nx + i]) continue;
      const x = (i + 0.5) * B.RES, y = (j + 0.5) * B.RES, d = (p.shape === "rect" ? Math.max(Math.abs(x - p.x) - p.w / 2, Math.abs(y - p.y) - p.h / 2) : Math.hypot(x - p.x, y - p.y) - p.w / 2) - need;
      worst = Math.min(worst, d);
    }
  });
  assert.ok(worst > -B.RES, `pour copper within a cell of the clearance at worst (${worst.toFixed(3)} mm)`);
  // a closed loop of track with no net encloses pour that reaches nothing: an island, removed
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[80, 70], [110, 70], [110, 85], [80, 85], [80, 70]] });
  const a2 = analyse(board), f2 = a2.fills[0], g2 = B.rasterise(f2.ops, nx, ny);
  assert.ok(f2.islands >= 1, "the inside of the loop is an island");
  assert.equal(g2[Math.floor(77.5 / B.RES) * nx + Math.floor(95 / B.RES)], 0, "and it is removed");
  // a via with the GND net stored, in the pour, joins it (a stitching via); with another net it is cleared
  board.tracks.pop(); board.vias.push({ x: 100, y: 20, drill: 0.8, pad: 1.8, net: "GND" });
  const a3 = analyse(board), vi = a3.conn.items.findIndex(it => it.kind === "via"), gp = a3.conn.items.findIndex(it => it.kind === "pad" && it.pad.netName === "GND");
  assert.equal(a3.conn.items[vi].cluster, a3.conn.items[gp].cluster, "the stitching via is part of the GND copper");
  // two pours of different nets overlapping on one layer
  board.zones.push({ net: "B+", layer: "B.Cu", pts: [[10, 10], [40, 10], [40, 40], [10, 40]] });
  assert.ok(B.drc(board, a3.m, a3.conn, a3.hv).some(d => /pours of GND and B\+ overlap/.test(d.msg)));
});

test("Gerber files: X2 header, apertures before use, balanced regions, y up; Excellon holes; ZIP; PDF", () => {
  const board = fabBoard(), { m, fills } = analyse(board), files = F.fabFiles(board, m, fills, { base: "t", title: "Test", version: "9.9.9" });
  const names = Object.keys(files);
  ["F_Cu", "B_Cu", "F_Mask", "B_Mask", "F_Silkscreen", "B_Silkscreen", "Edge_Cuts"].forEach(l => assert.ok(names.includes(`t-${l}.gbr`), l));
  assert.ok(names.includes("t-PTH.drl") && names.includes("t-NPTH.drl") && names.includes("t-README.txt"));
  for (const [n, txt] of Object.entries(files)) {
    if (!n.endsWith(".gbr")) continue;
    const lines = txt.trim().split("\n"), defined = new Set();
    assert.ok(lines.includes("%FSLAX46Y46*%") && lines.includes("%MOMM*%") && lines.some(l => l.startsWith("%TF.FileFunction,")), n);
    assert.equal(lines[lines.length - 1], "M02*", n);
    assert.equal(lines.filter(l => l === "G36*").length, lines.filter(l => l === "G37*").length, n);
    lines.forEach(l => { let k; if ((k = /^%ADD(\d+)/.exec(l))) defined.add(k[1]); if ((k = /^D(\d+)\*$/.exec(l))) assert.ok(defined.has(k[1]), `${n}: D${k[1]} defined before use`); });
    lines.forEach(l => assert.ok(/^(G04 .*|%.*%|G0[1-4]\*|G3[67]\*|G75\*|D\d+\*|X-?\d+Y-?\d+D0[123]\*|M02\*)$/.test(l), `${n}: ${l}`));
  }
  assert.ok(/%TF.FilePolarity,Negative\*%/.test(files["t-F_Mask.gbr"]), "mask files are negative");
  assert.ok(/%LPC\*%/.test(files["t-B_Cu.gbr"]) && /G36\*/.test(files["t-B_Cu.gbr"]), "the pour: a region and clearances");
  // a pad flash at board (x, y) lands at X = x, Y = h − y (y up), in nanometres
  const p = m.pads.find(q => q.ref === "R1" && q.num === "1");
  assert.ok(files["t-F_Cu.gbr"].includes(`X${Math.round(p.x * 1e6)}Y${Math.round((board.outline.h - p.y) * 1e6)}D03*`));
  const pth = files["t-PTH.drl"], npth = files["t-NPTH.drl"];
  assert.equal(pth.split("\n").filter(l => /^X/.test(l)).length, m.pads.length + board.vias.length);
  assert.equal(npth.split("\n").filter(l => /^X/.test(l)).length, 4);
  assert.ok(/^M48\n/.test(pth) && /METRIC/.test(pth) && /T1C3\.200/.test(npth) && /M30\n$/.test(pth));
  // the ZIP: every entry's CRC matches its data
  const z = F.zip(files), dv = new DataView(z.buffer);
  let off = 0, count = 0;
  while (dv.getUint32(off, true) === 0x04034b50) {
    const crc = dv.getUint32(off + 14, true), size = dv.getUint32(off + 18, true), nl = dv.getUint16(off + 26, true), el = dv.getUint16(off + 28, true);
    const data = z.subarray(off + 30 + nl + el, off + 30 + nl + el + size);
    assert.equal(F.crc32(data), crc); off += 30 + nl + el + size; count++;
  }
  assert.equal(count, names.length);
  const pdf = F.pdfPages(board, m, fills, "print", { title: "Test" }), text = Buffer.from(pdf).toString("latin1");
  assert.ok(text.startsWith("%PDF") && /\/Count 4/.test(text) && /\/MediaBox \[0 0 841\.89 595\.276\]/.test(text), "four A4 landscape pages");
  assert.ok(/\/Count 2/.test(Buffer.from(F.pdfPages(board, m, fills, "toner", {})).toString("latin1")), "toner transfer: two pages");
});

test("a track entering a tube pin may pass the socket's other pins as closely as the pin itself does, not closer", () => {
  const board = fabBoard(), { m } = analyse(board), hv = B.hvNets(NETLIST.volts, 60);
  const p6 = m.pads.find(p => p.ref === "VL1" && p.num === "6"), cx = board.parts[Object.keys(board.parts).find(k => board.parts[k].ref === "VL1")].x, cy = 30;
  const ux = (p6.x - cx) / Math.hypot(p6.x - cx, p6.y - cy), uy = (p6.y - cy) / Math.hypot(p6.x - cx, p6.y - cy);
  // radially out of pin 6 (the anode, 150 V: HV, 2 mm clearance), 2 mm wide
  board.tracks.push({ layer: "F.Cu", w: 2, pts: [[p6.x, p6.y], [+(p6.x + ux * 8).toFixed(3), +(p6.y + uy * 8).toFixed(3)]] });
  let a = analyse(board), bad = B.drc(board, a.m, a.conn, hv).filter(d => d.kind === "clearance" && d.between.some(x => /^track/.test(x)));
  assert.equal(bad.length, 0, bad.map(d => d.msg + " " + d.between).join("; "));
  // the same track pushed 0.8 mm sideways no longer enters pin 6: the full HV clearance applies to pins 5 and 7
  board.tracks[board.tracks.length - 1].pts = board.tracks[board.tracks.length - 1].pts.map(([x, y]) => [x - uy * 0.8, y + ux * 0.8]);
  a = analyse(board); bad = B.drc(board, a.m, a.conn, hv).filter(d => d.kind === "clearance" && d.between.some(x => /^track/.test(x)));
  assert.ok(bad.length > 0);
});
