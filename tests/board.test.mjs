/**
 * Board Design core (board-core.js): footprints, the schematic-to-board mapping,
 * synchronisation, connectivity, ratsnest and design-rule checks (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "pdf-export.js", "board-fab.js", "board-route.js", "board-3d.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab, BR = globalThis.BoardRoute;

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
      for (const name of g.options) {
        const f = B.footprint(name, ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].slice(0, +(/(?:WIRE|TERM-[\d.]+)-(\d+)$/.exec(name) || [])[1] || 0));
        assert.ok(f && f.pads.length > 0, `${type} ${JSON.stringify(params)}: ${name}`);
        // no two pads of a footprint touch (a TO-92's round 1.4 mm pads on its 1.27 mm pitch did): a round pad as a circle, others as their box
        const box = (p, x, y) => Math.hypot(Math.max(0, Math.abs(x - p.x) - p.w / 2), Math.max(0, Math.abs(y - p.y) - p.h / 2));
        const isRound = p => p.shape !== "rect" && p.w === p.h;
        f.pads.forEach((a, i) => f.pads.slice(i + 1).forEach(b => {
          const g = isRound(a) && isRound(b) ? Math.hypot(a.x - b.x, a.y - b.y) - (a.w + b.w) / 2 : isRound(a) ? box(b, a.x, a.y) - a.w / 2 : isRound(b) ? box(a, b.x, b.y) - b.w / 2
            : Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.h + b.h) / 2);
          assert.ok(g > 0.2, `${name}: pads ${a.num} and ${b.num} are ${g.toFixed(2)} mm apart`);
        }));
      }
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
  assert.equal(t1.fp.name, "WIRE-4", "the output transformer sits on the chassis: wire pads by default");
  assert.ok(t1.options.includes("XFMR-EI66-SE") && t1.options.includes("TERM-5.08-4"), "or a board-mount EI footprint / a screw terminal");
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

test("tracks into neighbouring TO-92 pins: only their parts outside the pads keep the clearance", () => {
  // the MPSA42's pads 1 (E) and 2 (B) are 1.27 mm apart; 1 mm tracks ending in them are 0.27 mm apart there
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.assign(board.parts.q1, { x: 40, y: 40, rot: 0 });
  const clear = () => { const m = B.model(board, NETLIST), c = B.connectivity(board, m.pads); return B.drc(board, m, c, new Set()).filter(d => d.kind === "clearance"); };
  const m = B.model(board, NETLIST), e = m.pads.find(p => p.ref === "VT1" && p.num === "1"), b = m.pads.find(p => p.ref === "VT1" && p.num === "2");
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[e.x, e.y], [e.x, e.y - 8]] }, { layer: "F.Cu", w: 1, pts: [[b.x, b.y], [b.x, b.y + 8]] });
  assert.deepEqual(clear().map(d => d.msg), [], "one leaves upwards, the other downwards: no clearance error");
  board.tracks[1].pts = [[b.x, b.y], [b.x, b.y - 8]];
  assert.ok(clear().some(d => /0\.27 mm < 0\.6 mm/.test(d.msg)), "both run upwards side by side: an error");
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
      // transformers and filter chokes go on the chassis: wire pads by default
      const chassis = /^(opt_|ptx)/.test(type) || (type === "inductor" && (+params.l || 0) >= 0.05);
      if (type !== "tube") assert.equal(/^WIRE-/.test(g.options[0]), chassis, `${type}: ${chassis ? "wire pads" : "a real footprint"} by default (${g.options[0]})`);
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

test("op-amps: a dual's and a quad's amplifiers share one DIP; pins from the maker's pinout", () => {
  const amp = (id, model, label, nets) => part(id, "opamp", label, { model }, nets);
  const pins = (g, f) => { const out = {}; B.padMap(g, f).forEach((list, num) => list.forEach(x => { out[x.comp + ":" + x.pin] = (out[x.comp + ":" + x.pin] ? out[x.comp + ":" + x.pin] + "," : "") + num; })); return out; };
  const nl = { parts: [amp("a", "TL074", "DA1.1", { "+": 3, "-": 4, OUT: 4, "V+": 1, "V-": 2 }), amp("b", "TL074", "DA1.3", { "+": 5, "-": 6, OUT: 6, "V+": 1, "V-": 2 }),
    amp("c", "TL072", "DA2.2", { "+": 7, "-": 8, OUT: 8, "V+": 1, "V-": 2 }), amp("d", "LM301A", "DA3", { "+": 0, "-": 9, OUT: 10, "V+": 1, "V-": 2, 1: 11, 8: 12 })] };
  const parts = B.physicalParts(nl), by = Object.fromEntries(parts.map(g => [g.ref, g]));
  assert.deepEqual(parts.map(g => [g.ref, g.members.length, g.defaultFp]), [["DA1", 2, "DIP-14"], ["DA2", 1, "DIP-8"], ["DA3", 1, "DIP-8"]]);
  // TL074: amplifier 1 on pins 3, 2, 1; amplifier 3 on 10, 9, 8; V+ on 4 and V− on 11 for both
  const q = pins(by.DA1, B.footprint("DIP-14"));
  assert.deepEqual([q["a:+"], q["a:-"], q["a:OUT"], q["b:+"], q["b:-"], q["b:OUT"], q["a:V+"], q["b:V+"], q["a:V-"]], ["3", "2", "1", "10", "9", "8", "4", "4", "11"]);
  // TL072, amplifier 2: 5, 6, 7, V+ 8, V− 4; the LM301A: 3, 2, 6, V+ 7, V− 4 and its compensation on 1 and 8
  const d = pins(by.DA2, B.footprint("DIP-8")), l = pins(by.DA3, B.footprint("DIP-8"));
  assert.deepEqual([d["c:+"], d["c:-"], d["c:OUT"], d["c:V+"], d["c:V-"]], ["5", "6", "7", "8", "4"]);
  assert.deepEqual([l["d:+"], l["d:-"], l["d:OUT"], l["d:V+"], l["d:V-"], l["d:1"], l["d:8"]], ["3", "2", "6", "7", "4", "1", "8"]);
  // DIP-14 from the component side: pin 1 top left, 7 bottom left, 8 bottom right, 14 top right
  const f = B.footprint("DIP-14"), at = n => f.pads.find(p => p.num === String(n));
  assert.ok(at(1).x < 0 && at(7).x < 0 && at(8).x > 0 && at(14).x > 0 && at(1).y < at(7).y && at(14).y < at(8).y && Math.abs(at(1).y - at(14).y) < 1e-9 && at(1).shape === "rect");
  assert.ok(Math.abs(at(8).x - at(7).x - 7.62) < 1e-9 && Math.abs(at(2).y - at(1).y - 2.54) < 1e-9, "7.62 mm rows, 2.54 mm pitch");
  // on the board, the shared supply pads take their nets from every amplifier
  const board = B.newBoard(); B.sync(board, nl);
  const M = B.model(board, nl), pad = (ref, num) => M.pads.find(p => p.ref === ref && p.num === num);
  assert.ok(pad("DA1", "4").net === 1 && !pad("DA1", "4").conflict && pad("DA1", "11").net === 2 && pad("DA1", "5").net === null);
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
  // at the end every cut grows by 0.075 mm (no crumbs narrower than that survive) and the outline comes in by as much; the spokes go on top
  const last = f.ops.slice(-20), trimEdge = f.ops.filter(o => o.pol === "C" && o.t === "line" && o.w === 0.15).length;
  assert.ok(trimEdge >= 4 && last.some(o => o.pol === "D" && o.t === "line" && o.w === 0.8), `outline trimmed (${trimEdge} edges) and spokes drawn last`);
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

test("under a valve socket's body a track may pass its pins at their own spacing (a design rule); off, the HV clearance holds", () => {
  const board = fabBoard(), hv = B.hvNets(NETLIST.volts, 60), cx = 30, cy = 30;
  let { m } = analyse(board);
  const p6 = m.pads.find(p => p.ref === "VL1" && p.num === "6"), d = Math.hypot(p6.x - cx, p6.y - cy), ux = (p6.x - cx) / d, uy = (p6.y - cy) / d;
  // a short track (no net: floating copper) across the radius 1.5 mm out from the anode pin (150 V: HV, 2 mm), still under the 22 mm body
  const r = d + p6.w / 2 + 1.5 + 0.25, px = cx + ux * r, py = cy + uy * r;
  board.tracks.push({ layer: "F.Cu", w: 0.5, pts: [[+(px - uy).toFixed(3), +(py + ux).toFixed(3)], [+(px + uy).toFixed(3), +(py - ux).toFixed(3)]] });
  const near = () => { const a = analyse(board); return B.drc(board, a.m, a.conn, hv).filter(x => x.kind === "clearance" && x.between.includes("VL1-6")); };
  assert.equal(near().length, 0, "1.5 mm under the body: the pins are 1.27 mm apart");
  board.rules.socketBody = false;
  assert.ok(near().some(x => /1\.50 mm < 2 mm/.test(x.msg)), "the rule off: 2 mm");
  board.rules.socketBody = true;
  // pins' spacing, not less: 1 mm is too close even under the body
  board.tracks[board.tracks.length - 1].pts = board.tracks[board.tracks.length - 1].pts.map(([x, y]) => [x - ux * 0.5, y - uy * 0.5]);
  assert.ok(near().some(x => /1\.00 mm < 1\.25 mm/.test(x.msg)), near().map(x => x.msg).join("; "));
});

test("Freerouting: the board as a Specctra DSN design (nets, widths, clearances by voltage, socket pins) and its routes back from a session", () => {
  const board = fabBoard(), { m, hv, conn } = analyse(board), clr = B.clearanceRules(board, m, hv, NETLIST);
  const d = BR.toDsn(board, m, conn, clr, { hv, title: "test" }), s = BR.parse(d.text);
  assert.equal(s[0], "pcb");
  const kids = k => s.filter(x => Array.isArray(x) && x[0] === k), net = kids("network")[0];
  const nets = net.filter(x => x[0] === "net").map(x => x[1]);
  assert.ok(nets.includes("B+") && !net.find(x => x[0] === "net" && x[1] === "GND" && x.some(y => Array.isArray(y) && y[0] === "pins")), "B+ is routed; GND has a pour and is left to it: " + nets.join(" "));
  assert.deepEqual(d.skipped, ["GND"]);
  // a second pass for the pour's pads it does not reach: only GND, only those pads
  const gp = m.pads.filter(p => p.netName === "GND" && p.part in board.parts).slice(0, 2), only = new Map([["GND", new Set(gp.map(p => `${+p.x.toFixed(4)},${+p.y.toFixed(4)}`))]]);
  const n2 = BR.parse(BR.toDsn(board, m, conn, clr, { hv, only }).text).find(x => x[0] === "network").filter(x => x[0] === "net" && x.some(y => Array.isArray(y) && y[0] === "pins"));
  assert.equal(n2.length, 1); assert.equal(n2[0][1], "GND"); assert.equal(n2[0].find(y => Array.isArray(y) && y[0] === "pins").length - 1, 2, "just the two pads the pour missed");
  // B+ (300 V, HV) to the grid (0 V): what the check asks (the HV class's 2 mm; IPC-2221B B2 1.25 mm at 300 V), plus a 0.05 mm margin
  const rule = s.find(x => x[0] === "structure").find(x => Array.isArray(x) && x[0] === "rule"), cl = (a, b) => { const r = rule.find(x => Array.isArray(x) && x[0] === "clearance" && x[2] && (x[2][1] === `${a}_${b}` || x[2][1] === `${b}_${a}`)); return r && +r[1]; };
  const tB = net.filter(x => x[0] === "class").find(x => x[2] === "B+").find(x => Array.isArray(x) && x[0] === "clearance_class")[1];
  const gKey = m.pads.find(p => p.ref === "VL1" && p.num === "7").net, gNet = Object.keys(d.nets).find(k => d.nets[k] === gKey), tG = net.filter(x => x[0] === "class").find(x => x[2] === gNet).find(x => Array.isArray(x) && x[0] === "clearance_class")[1];
  assert.equal(cl(tB, tG), Math.round((clr.need(1, gKey).c + 0.05) * 1000), `B+ to ${gNet}: ${cl(tB, tG)} µm`); assert.equal(cl(tB, tG), 2050);
  assert.ok(net.filter(x => x[0] === "class").find(x => x[2] === "B+").find(x => Array.isArray(x) && x[0] === "rule")[1][1] === "2000", "B+ is HV: 2 mm tracks");
  // the socket's pins have classes of their own, capped at their spacing
  const place = s.find(x => x[0] === "placement").find(x => x[2] && x[2][1] === "VL1")[2], pins = place.filter(x => Array.isArray(x) && x[0] === "pin");
  assert.equal(pins.length, 9); assert.ok(pins.every(p => /^p\d+\.\d+$/.test(p[2][1])), pins.map(p => p[2][1]).join(" "));
  const p6 = pins.find(p => p[1] === "6")[2][1];
  assert.ok(Math.abs(cl(tB, p6) - 1253.7) < 0.1, `B+ tracks may pass the anode pin at the pins' 1.27 mm spacing, less 0.02: ${cl(tB, p6)} µm`);
  // a session back: a wire and a via on B+, in µm × 10 with y up; a copy of a board track is left out
  const bp = m.pads.find(p => p.ref === "R1" && p.num === "1");
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[10, 10], [20, 10]] });
  const ses = `(session test (routes (resolution um 10) (network_out (net "B+" (wire (path B.Cu 20000 ${bp.x * 1e4} ${-bp.y * 1e4} ${bp.x * 1e4} ${-(bp.y + 10) * 1e4})) (via "V1800" ${bp.x * 1e4} ${-(bp.y + 10) * 1e4}))
    (net "B+" (wire (path F.Cu 10000 100000 -100000 200000 -100000))))))`;
  const got = BR.fromSes(ses, board, d, m.names);
  assert.equal(got.tracks.length, 1); assert.deepEqual(got.tracks[0], { layer: "B.Cu", w: 2, pts: [[bp.x, bp.y], [bp.x, bp.y + 10]], net: "B+" });
  assert.equal(got.vias.length, 1); assert.ok(Math.abs(got.vias[0].x - bp.x) < 1e-6 && Math.abs(got.vias[0].y - bp.y - 10) < 1e-6 && got.vias[0].net === "B+");
  assert.throws(() => BR.fromSes("(pcb x)", board, d, m.names), /Not a Specctra session/);
  // addresses as typed
  assert.equal(BR.address("192.168.1.20"), "http://192.168.1.20:37864"); assert.equal(BR.address("nuc:4000"), "http://nuc:4000"); assert.equal(BR.address(""), BR.DEFAULT_URL);
});

test("track width for a DC current (IPC-2221, outer layer) and the current of each net from the simulation", () => {
  const R = B.defaultRules();
  // 1 A at a 10 °C rise on 35 µm copper needs about 0.30 mm (the IPC-2221 chart)
  assert.ok(Math.abs(B.currentWidth(1, R, { copper: 35 }) - 0.30) < 0.02, String(B.currentWidth(1, R, { copper: 35 })));
  assert.ok(B.currentWidth(1, R, { copper: 70 }) < B.currentWidth(1, R, { copper: 35 }) / 1.9, "twice the copper, half the width");
  assert.ok(B.currentWidth(1, { ...R, tempRise: 20 }, { copper: 35 }) < B.currentWidth(1, R, { copper: 35 }), "more warming allowed, narrower");
  assert.equal(B.currentWidth(0, R, { copper: 35 }), 0);
  const nl = JSON.parse(JSON.stringify(NETLIST));
  nl.parts.find(p => p.id === "g1").pins.forEach(q => { q.i = q.id === "+" ? -3 : 3; });   // 3 A out of the supply (an exaggerated load)
  nl.parts.find(p => p.id === "r1").pins.forEach(q => { q.i = q.id === "1" ? 0.0012 : -0.0012; });
  const amps = B.netCurrents(nl);
  assert.equal(amps[1], 3); assert.equal(amps[2], 0.0012);
  // a 1 mm track on B+ (3 A needs ≈ 1.3 mm) is reported; the check names the current
  const board = B.newBoard(); B.sync(board, nl);
  Object.values(board.parts).forEach((p, i) => Object.assign(p, { x: 20 + (i % 4) * 30, y: 20 + Math.floor(i / 4) * 30 }));
  const m = B.model(board, nl), r1 = m.pads.find(p => p.ref === "R1" && p.num === "1");
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[r1.x, r1.y], [r1.x, r1.y - 8]] });
  const m2 = B.model(board, nl), c = B.connectivity(board, m2.pads), d = B.drc(board, m2, c, new Set(), [], nl).filter(x => x.kind === "current");
  assert.equal(d.length, 1); assert.ok(/carries 3\.00 A: 1 mm < 1\.\d+ mm for a 10 °C rise/.test(d[0].msg), d[0].msg);
});

test("rule checks: overlapping parts, keep-out areas (and pours keep out of them), silkscreen over pads, unconnected track ends", () => {
  const board = fabBoard();
  let { m, conn, fills } = analyse(board);
  const kinds = () => B.drc(board, m, conn, new Set(), fills, NETLIST);
  assert.ok(!kinds().some(d => ["courtyard", "keepout", "dangling"].includes(d.kind)), kinds().filter(d => ["courtyard", "keepout", "dangling", "silk"].includes(d.kind)).map(d => d.msg).join("; "));
  // R2 moved onto C1: courtyards overlap, and R2's reference lies over C1's pads
  const k = ref => Object.keys(board.parts).find(x => board.parts[x].ref === ref);
  Object.assign(board.parts[k("R2")], { x: 55, y: 57 });
  ({ m, conn, fills } = analyse(board));
  assert.ok(kinds().some(d => d.kind === "courtyard" && /R2 and C1|C1 and R2/.test(d.msg)));
  Object.assign(board.parts[k("R2")], { x: 30, y: 55 });
  // a keep-out on the bottom copper: no pour inside, a track through it, a via in it, a part in it when parts are forbidden
  board.keepouts.push({ name: "mains", pts: [[80, 55], [110, 55], [110, 85], [80, 85]], layers: ["B.Cu"], tracks: true, vias: true, pour: true, parts: true });
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[70, 75], [100, 75]] });
  board.vias.push({ x: 95, y: 70, drill: 0.8, pad: 1.8 });
  ({ m, conn, fills } = analyse(board));
  const nx = Math.ceil(board.outline.w / B.RES), g = B.rasterise(fills[0].ops, nx, Math.ceil(board.outline.h / B.RES));
  assert.equal(g[Math.floor(82 / B.RES) * nx + Math.floor(105 / B.RES)], 0, "the GND pour leaves the keep-out empty");
  const ko = kinds().filter(d => d.kind === "keepout").map(d => d.msg);
  assert.ok(ko.some(t => /track on B.Cu runs through keep-out "mains"/.test(t)) && ko.some(t => /via in keep-out "mains"/.test(t)) && ko.some(t => /T1 is in keep-out "mains"/.test(t)), ko.join("; "));
  // the track's left end touches nothing: unconnected
  assert.ok(kinds().some(d => d.kind === "dangling" && Math.abs(d.x - 70) < 1e-6));
  // a top silkscreen text over a pad is a warning
  board.texts.push({ x: 60, y: 15, text: "OVER R1", size: 2, layer: "F.SilkS", rot: 0 });
  ({ m, conn, fills } = analyse(board));
  assert.ok(kinds().some(d => d.kind === "silk" && /text "OVER R1"/.test(d.msg)), kinds().filter(d => d.kind === "silk").map(d => d.msg).join("; "));
});

test("no footprint has silkscreen over its own pads", () => {
  const seen = new Set(), bad = [];
  for (const [type, def] of Object.entries(L.LIB)) {
    if (["note", "frame", "ground", "offsheet", "scope"].includes(type)) continue;
    const params = { ...(def.defaults || {}) }, pins = typeof def.pins === "function" ? def.pins({ params }) : def.pins;
    const variants = type === "tube" ? globalThis.TUBE_DATABASE.map(t => ({ tube: t.commonName })) : [{}];
    for (const v of variants) for (const sec of type === "switch" ? [1, 2] : [1]) {
      const nl = { parts: Array.from({ length: sec }, (_, k) => ({ id: "c" + k, type, label: sec > 1 ? `X1.${k + 1}` : "X1", params: { ...params, ...v }, pins: pins.map(p => ({ id: p.id, net: 1 })) })) };
      const [g] = B.physicalParts(nl);
      for (const o of g.options) {
        if (seen.has(o)) continue; seen.add(o);
        const f = B.footprint(o, g.members.flatMap(m => m.pins.map(p => (sec > 1 ? m.label.split(".").pop() + "." : "") + p.id)));
        const G = { ...g, fp: f, place: { x: 0, y: 0, rot: 0, side: "F" } };
        const over = B.partSilk(G, true).some(op => op.pts.some((p, k) => k && f.pads.some(pd => {
          const r = Math.min(pd.w, pd.h) / 2, l = Math.max(pd.w, pd.h) / 2 - r, s = pd.w >= pd.h ? [pd.x - l, pd.y, pd.x + l, pd.y] : [pd.x, pd.y - l, pd.x, pd.y + l];
          return B.segSeg([op.pts[k - 1][0], op.pts[k - 1][1], p[0], p[1]], s) < (pd.shape === "rect" ? r * 1.15 : r) + op.w / 2;
        })));
        if (over) bad.push(o);
      }
    }
  }
  assert.ok(seen.size > 100, `${seen.size} footprints checked`);
  assert.deepEqual(bad, []);
});

// a solid is closed and outward: every edge used once each way, positive volume (divergence theorem)
function solidVolume(sol) {
  let vol = 0; const V = sol.verts;
  sol.faces.forEach(f => f.loops.forEach(l => { for (let i = 1; i + 1 < l.length; i++) { const [a, b, c] = [V[l[0]], V[l[i]], V[l[i + 1]]]; vol += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } }));
  return vol;
}
function solidCheck(sol) {
  const uses = new Map();
  sol.faces.forEach(f => f.loops.forEach(l => l.forEach((a, i) => { const b = l[(i + 1) % l.length], k = `${a}>${b}`; uses.set(k, (uses.get(k) || 0) + 1); })));
  for (const [k, n] of uses) { const [a, b] = k.split(">"); if (n !== 1 || uses.get(`${b}>${a}`) !== 1) return `edge ${k} used ${n}× / back ${uses.get(`${b}>${a}`) || 0}×`; }
  const vol = solidVolume(sol);
  return vol > 0 ? null : `volume ${vol}`;
}

test("3D: every footprint's body and the drilled board are closed, outward solids; the board's volume is right", () => {
  const D3 = globalThis.Board3D, seen = new Set();
  for (const [type, def] of Object.entries(L.LIB)) {
    if (["note", "frame", "ground", "offsheet", "scope"].includes(type)) continue;
    const params = { ...(def.defaults || {}) }, pins = typeof def.pins === "function" ? def.pins({ params }) : def.pins;
    for (const sec of type === "switch" ? [1, 2] : [1]) {
      const nl = { parts: Array.from({ length: sec }, (_, k) => ({ id: "c" + k, type, label: sec > 1 ? `X1.${k + 1}` : "X1", params, pins: pins.map(p => ({ id: p.id, net: 1 })) })) };
      const [g] = B.physicalParts(nl);
      for (const o of g.options.concat(type === "tube" ? ["SOCKET-B9A", "SOCKET-B7G", "SOCKET-B9D", "SOCKET-OCTAL", "SOCKET-UX4"] : [])) {
        if (seen.has(o)) continue; seen.add(o);
        const fp = B.footprint(o, g.members.flatMap(m => m.pins.map(p => (sec > 1 ? m.label.split(".").pop() + "." : "") + p.id)));
        for (const side of ["F", "B"]) for (const rot of [0, 1]) {
          const bodies = D3.partBodies({ ...g, fp, place: { x: 50, y: 40, rot, side } }, 1.6, { tubes: true });
          assert.ok(bodies.length > 0, o);
          bodies.forEach(b => { const err = solidCheck(b); assert.equal(err, null, `${o} ${side} rot ${rot}: ${b.name}: ${err}`); });
        }
      }
    }
  }
  assert.ok(seen.size > 100);
  const board = fabBoard(), { m } = analyse(board), sc = D3.scene(board, m, {});
  assert.equal(solidCheck(sc.board), null);
  const o = board.outline, holes = m.pads.reduce((a, p) => a + Math.PI * (p.drill / 2) ** 2, 0) + board.holes.reduce((a, h) => a + Math.PI * (h.d / 2) ** 2, 0);
  const expect = (o.w * o.h - (4 - Math.PI) * o.r * o.r - holes) * 1.6, vol = solidVolume(sc.board);
  assert.ok(Math.abs(vol - expect) / expect < 0.003, `board volume ${vol.toFixed(1)} vs ${expect.toFixed(1)} mm³`);
  assert.equal(sc.board.faces.filter(f => f.loops.length > 1).length, 2, "top and bottom faces carry the holes");
  assert.ok(sc.bodies.some(b => b.alpha < 1), "valves in glass");
});

test("STEP: AP214 header, one solid per body, every reference defined, colours", () => {
  const D3 = globalThis.Board3D, board = fabBoard(), { m } = analyse(board), sc = D3.scene(board, m, {});
  const txt = D3.step(sc, { title: "Test 'board'", version: "9.9.9", file: "t.step", date: "2026-10-09T12:00:00" });
  assert.ok(txt.startsWith("ISO-10303-21;\nHEADER;") && txt.trimEnd().endsWith("END-ISO-10303-21;"));
  assert.ok(/FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN \{ 1 0 10303 214 1 1 1 1 \}'\)\);/.test(txt));
  assert.ok(txt.includes("PRODUCT('Test ''board''','Test ''board''','',"), "quotes doubled");
  assert.equal((txt.match(/MANIFOLD_SOLID_BREP\(/g) || []).length, sc.bodies.length + 1);
  assert.equal((txt.match(/STYLED_ITEM\(/g) || []).length, sc.bodies.length + 1);
  assert.ok(/SURFACE_STYLE_TRANSPARENT\(/.test(txt), "glass is transparent");
  const defined = new Set([...txt.matchAll(/^#(\d+)=/gm)].map(x => x[1]));
  for (const x of txt.matchAll(/#(\d+)(?!\d|=)/g)) assert.ok(defined.has(x[1]), `#${x[1]} is defined`);
  assert.ok(!/NaN|Infinity/.test(txt), "no broken numbers");
});

test("part values: picofarad capacitors keep their value (a 100 pF capacitor read 0F)", () => {
  assert.equal(L.fmtEng(100e-12, "F"), "100pF");
  assert.equal(L.fmtEng(4.7e-12, "F"), "4.7pF");
  assert.equal(L.fmtEng(4e-16, "V"), "0V", "solver round-off still reads as zero");
  const g = B.physicalParts({ parts: [part("c9", "capacitor", "C9", { c: 220e-12 }, { 1: 1, 2: 0 })] })[0];
  assert.equal(g.value, "220pF");
});

test("a via that joins nothing, or copper on one layer only, is reported", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.assign(board.parts.r1, { x: 30, y: 30, rot: 0 });
  const dang = () => { const m = B.model(board, NETLIST), c = B.connectivity(board, m.pads); return B.drc(board, m, c, new Set()).filter(d => d.kind === "dangling").map(d => d.msg); };
  board.vias.push({ x: 60, y: 60, drill: 0.8, pad: 1.8 });
  assert.deepEqual(dang(), ["A via is not connected"]);
  const p = B.model(board, NETLIST).pads.find(q => q.ref === "R1" && q.num === "2");
  board.tracks.push({ layer: "F.Cu", w: 1, pts: [[p.x, p.y], [60, p.y], [60, 60]] });
  assert.deepEqual(dang(), ["A via joins copper on F.Cu only"]);
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[60, 60], [70, 60], [70, 40]] });
  assert.deepEqual(dang(), ["A track end on B.Cu is not connected"], "joined on both layers: only the new track's loose end is left");
});

test("power transistors: hFE inside the datasheet's range at its test point (VCE = 5 V); laterals' VGS at 3 A", () => {
  const E = globalThis.TubeSimEngine;
  const hfe = (m, ic) => { let lo = 0, hi = 2; for (let k = 0; k < 80; k++) { const v = (lo + hi) / 2, I = E.Semi.bjt([5 * m.pol, v * m.pol, 0], m); if (I[0] * m.pol < ic) lo = v; else hi = v; } const v = (lo + hi) / 2, I = E.Semi.bjt([5 * m.pol, v * m.pol, 0], m); return I[0] / I[1]; };
  const points = [["2SD669A", 0.15, 60, 320], ["2SB649A", 0.15, 60, 320], ["2SC4793", 0.1, 100, 320], ["2SA1837", 0.1, 100, 320], ["MJE15032", 0.5, 50, 250], ["MJE15033", 0.5, 50, 250],
    ["TIP41C", 3, 15, 75], ["TIP42C", 3, 15, 75], ["2SC5200", 1, 80, 160], ["2SA1943", 1, 80, 160], ["MJL3281A", 1, 75, 150], ["MJL1302A", 1, 75, 150], ["MJL21194", 8, 25, 75], ["MJL21193", 8, 25, 75],
    ["MJ15003", 5, 25, 150], ["MJ15004", 5, 25, 150], ["MJ15024", 8, 15, 60], ["MJ15025", 8, 15, 60], ["2N3055", 4, 20, 70], ["MJ2955", 4, 20, 70]];
  for (const [k, ic, lo, hi] of points) { const h = hfe(L.BJTS[k], ic); assert.ok(h >= lo && h <= hi, `${k}: hFE ${h.toFixed(0)} at ${ic} A, datasheet ${lo}–${hi}`); }
  for (const k of ["2SK1058", "2SJ162", "ECX10N20", "ECX10P20"]) {   // laterals: about 3 A at 4–5 V gate-source
    const m = L.MOSFETS[k]; let lo = 0, hi = 10;
    for (let n = 0; n < 80; n++) { const v = (lo + hi) / 2, I = E.Semi.mos([10 * m.pol, v * m.pol, 0], m); if (I[0] * m.pol < 3) lo = v; else hi = v; }
    assert.ok(lo > 3.5 && lo < 5.5, `${k}: VGS ${lo.toFixed(2)} V for 3 A`);
  }
  // a TO-3 can goes on wires (the chassis heatsink); the TO-264 and TO-3P parts on their own footprints, base or gate first
  const fpOf = (type, model) => B.physicalParts({ parts: [part("q", type, "VT1", { model }, { C: 1, B: 2, E: 3, D: 1, G: 2, S: 3 })] })[0].defaultFp;
  assert.equal(fpOf("npn", "2N3055"), "WIRE-3"); assert.equal(fpOf("npn", "2SC5200"), "TO-264-BCE"); assert.equal(fpOf("pnp", "MJL1302A"), "TO-264-BCE");
  assert.equal(fpOf("nmos", "2SK1058"), "TO-3P-GSD"); assert.equal(fpOf("nmos", "IRFP240"), "TO-247-GDS");
});

test("heaters: valves get heater nets fed from a heater supply; shields go to GND; 12.6 V on request", () => {
  const nl = { names: { 0: "GND" }, volts: { 1: 300 }, parts: [
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }), part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
    part("v2", "tube", "VL2", { tube: "6P14P", connection: "pentode" }, { A: 8, G1: 9, G2: 1, K: 10 }),
    part("v3", "tube", "VL3", { tube: "6N23P-EV" }, { A: 11, G: 12, K: 13 }),
    part("v4", "tube", "VL4", { tube: "GZ34" }, { A1: 14, A2: 15, K: 1 }),
    part("v5", "tube", "VL5", { tube: "300B" }, { A: 16, G: 17, K: 18 })] };
  const w = B.withHeaters(nl, B.defaultRules()), board = B.newBoard(); B.sync(board, w);
  const m = B.model(board, w), pin = (ref, n) => (m.pads.find(p => p.ref === ref && p.num === n) || {}).netName;
  assert.deepEqual(["4", "5", "9"].map(n => pin("VL1", n)), ["HTR6.3_A", "HTR6.3_A", "HTR6.3_B"], "12AX7 at 6.3 V: 4 + 5 against 9");
  assert.deepEqual(["4", "5"].map(n => pin("VL2", n)), ["HTR6.3_A", "HTR6.3_B"]);
  assert.equal(pin("VL3", "9"), "GND", "the 6N23P's internal shield goes to GND");
  const xh = w.parts.filter(p => p.type === "heater");
  assert.equal(xh.length, 2, "one supply for the 6.3 V valves, one winding for the GZ34 (its heater is joined to its cathode)");
  assert.ok(Math.abs(xh[0].params.i - (0.3 + 0.76 + 0.31)) < 0.02, `the 6.3 V supply carries the sum of the heater currents (${xh[0].params.i} A)`);
  assert.equal(xh[1].pins[1].net, 1, "the GZ34's heater winding returns through its cathode (B+)");
  assert.equal(w.volts[xh[1].pins[0].net], 300, "so its heater net sits at B+ and gets the HV clearance");
  assert.ok(!w.parts.find(p => p.id === "v5").pins.some(q => /^H/.test(q.id)), "a directly heated valve (300B) is left alone: its filament is the cathode");
  // the heater current sizes the supply's tracks
  assert.ok(B.currentWidth(B.netCurrents(w)[xh[0].pins[0].net], B.defaultRules(), { copper: 35 }) > 0.3);
  // 12.6 V: pin 4 to pin 5, pin 9 free, half the current
  const w2 = B.withHeaters(nl, { ...B.defaultRules(), heater126: true }), b2 = B.newBoard(); B.sync(b2, w2);
  const m2 = B.model(b2, w2), p2 = n => (m2.pads.find(p => p.ref === "VL1" && p.num === n) || {}).netName;
  assert.deepEqual([p2("4"), p2("5"), p2("9")], ["HTR12.6_A", "HTR12.6_B", ""]);
  // off: the netlist as it came
  assert.equal(B.withHeaters(nl, { ...B.defaultRules(), heaters: false, shields: false }), nl);
});

test("clearance by voltage: IPC-2221B, with the signal swing and the full-drive swing of an output transformer", () => {
  assert.equal(B.ipcClearance(12, "B2"), 0.1); assert.equal(B.ipcClearance(120, "B2"), 0.6); assert.equal(B.ipcClearance(300, "B2"), 1.25);
  assert.equal(B.ipcClearance(375, "B2"), 2.5); assert.equal(B.ipcClearance(700, "B2"), 3.5); assert.equal(B.ipcClearance(400, "B4"), 0.8); assert.equal(B.ipcClearance(400, "off"), 0);
  const nl = { names: { 0: "GND" }, volts: { 1: 375, 2: 370, 3: 10 }, ranges: { 3: [-20, 40] }, parts: [part("t1", "opt_se", "T1", {}, { P1: 1, P2: 2, S1: 4, S2: 0 })] };
  const board = B.newBoard(), m = { names: { 0: "GND", 1: "B+", 2: "A", 3: "G" }, pads: [] }, cr = B.clearanceRules(board, m, B.hvNets(nl.volts, 60), nl);
  assert.equal(cr.need(1, 0).c, 2.5, "B+ (375 V) to GND: 2.5 mm, more than the 2 mm HV class");
  assert.equal(cr.need(1, 2).c, 2.5, "B+ next to the anode: 5 V apart at idle, but at full drive the anode swings 0…740 V, 375 V from B+");
  assert.ok(Math.abs(cr.need(2, 0).c - (2.5 + 240 * 0.005)) < 1e-9 && cr.need(2, 0).why === "inductive", "the anode end of the primary counts at twice its DC level");
  assert.equal(cr.need(3, 0).c, 0.6, "a signal net swinging −20…40 V");
  board.rules.ipc = "off"; assert.equal(B.clearanceRules(board, m, new Set(), nl).need(1, 0).c, 0.6, "off: the classes only (B+ not HV without the HV set)");
});

test("valve layout checks: grid stopper, grid beside anode, hot parts near electrolytics, socket support", () => {
  const nl = { names: { 0: "GND", 1: "B+" }, volts: { 1: 300, 2: 150, 3: 1.5, 5: 0, 6: 280, 7: 0, 8: 250 }, parts: [
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }), part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
    part("rs", "resistor", "R1", { r: 1e3 }, { 1: 4, 2: 9 }),
    part("rp", "resistor", "R2", { r: 1e3, w: "5" }, { 1: 1, 2: 8 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 1, "-": 0 })] };
  nl.parts.find(p => p.id === "rp").pins.forEach(q => { q.i = 0.05; });     // 50 V × 50 mA = 2.5 W
  const board = B.newBoard(); B.sync(board, nl);
  Object.assign(board.parts["v1a+v1b"], { x: 80, y: 50, rot: 0 }); Object.assign(board.parts.rs, { x: 20, y: 20, rot: 0 });
  Object.assign(board.parts.rp, { x: 120, y: 30, rot: 0 }); Object.assign(board.parts.c1, { x: 120, y: 38, rot: 0 });
  let m = B.model(board, nl), c = B.connectivity(board, m.pads), d = B.drc(board, m, c, new Set(), [], nl);
  const kinds = k => d.filter(x => x.kind === k).map(x => x.msg);
  assert.ok(/R1 is the grid stopper of VL1 \(pin 7\)/.test(kinds("stopper")[0]), kinds("stopper").join("; "));
  assert.ok(/C1 \(electrolytic\).*R2 dissipates 2\.5 W/.test(kinds("heat")[0]), kinds("heat").join("; "));
  assert.ok(/VL1: no mounting hole within 40 mm/.test(kinds("support")[0]));
  // the stopper at the socket, a hole by the socket, the capacitor away: those go
  const g = m.pads.find(p => p.ref === "VL1" && p.num === "7");
  Object.assign(board.parts.rs, { x: g.x - 14, y: g.y, rot: 1 });
  const pr = B.model(board, nl).pads.find(p => p.ref === "R1" && p.num === "1"); board.parts.rs.y += g.y - pr.y; board.parts.rs.x += g.x - 9 - pr.x; board.holes.push({ x: 80, y: 80, d: 3.2 }); Object.assign(board.parts.c1, { x: 150, y: 80 });
  m = B.model(board, nl); c = B.connectivity(board, m.pads); d = B.drc(board, m, c, new Set(), [], nl);
  assert.deepEqual(["stopper", "heat", "support"].map(k => d.filter(x => x.kind === k).length), [0, 0, 0], d.map(x => x.msg).join("; "));
  // a grid track running 20 mm beside an anode track 1 mm apart is reported; 4 mm apart it is not (the valve on wire pads: A1 G1 K1 A2 G2 K2)
  Object.assign(board.parts["v1a+v1b"], { fp: "WIRE-6", x: 60, y: 20, rot: 0 });
  m = B.model(board, nl);
  const pa = m.pads.find(p => p.ref === "VL1" && p.num === "1"), pg = m.pads.find(p => p.ref === "VL1" && p.num === "2");
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[pg.x, pg.y], [pg.x, pg.y + 25]] }, { layer: "B.Cu", w: 1, pts: [[pa.x, pa.y], [pa.x, pa.y + 3], [pg.x - 2, pa.y + 3], [pg.x - 2, pa.y + 25]] });
  m = B.model(board, nl); c = B.connectivity(board, m.pads); d = B.drc(board, m, c, new Set(), [], nl);
  assert.ok(d.some(x => x.kind === "coupling" && /grid of VL1 \(pin 2\)\) runs 22 mm alongside .*anode of VL1/.test(x.msg)) && !d.some(x => x.kind === "short"), d.map(x => x.msg).join("; "));
  board.tracks[1].pts = [[pa.x, pa.y], [pa.x, pa.y + 25]];
  m = B.model(board, nl); c = B.connectivity(board, m.pads); d = B.drc(board, m, c, new Set(), [], nl);
  assert.ok(!d.some(x => x.kind === "coupling"), "4 mm apart (5.08 between centres): fine");
});

test("net names say what a net is: rails, valve electrodes, outputs; old names in a board move over", () => {
  const nl = { names: { 0: "GND" }, volts: { 1: 300, 2: 180, 3: 1.5, 4: 0, 5: 12, 6: 0, 7: 2 }, parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 1, "-": 0 }),
    part("r1", "resistor", "R1", { r: 100e3 }, { 1: 1, 2: 2 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }),
    part("g2", "vdc", "G2", { v: 12 }, { "+": 5, "-": 0 }),
    part("t1", "opt_se", "T1", {}, { P1: 1, P2: 2, S1: 6, S2: 0 }),
    part("r7", "resistor", "R7", {}, { 1: 7, 2: 0 }), part("c7", "capacitor", "C7", {}, { 1: 7, 2: 3 })] };
  const board = B.newBoard(); B.sync(board, nl);
  const m = B.model(board, nl), nm = n => m.names[n];
  assert.deepEqual([nm(1), nm(2), nm(3), nm(4), nm(5), nm(6), nm(7)], ["B+", "VL1.1-A", "VL1.1-K", "VL1.1-G", "+12V", "OUT", "C7_R7"]);
  // a board saved with the old names: its net class and pour follow
  board.rules.netClass = { "Net-(R1-2)": "HV" }; board.zones.push({ net: "Net-(C7-1)", layer: "B.Cu", pts: null });
  assert.equal(B.migrateNetNames(board, m), 2);
  assert.deepEqual([board.rules.netClass["VL1.1-A"], board.zones[0].net], ["HV", "C7_R7"]);
  assert.equal(B.migrateNetNames(board, m), 0, "once only");
});

test("star grounding: returns by role, each runs to the star point; copper joining two elsewhere is reported", () => {
  const nl = { names: { 0: "GND" }, volts: { 1: 300, 2: 150, 3: 1.5 }, parts: [
    part("g1", "vdc", "G1", { v: 300 }, { "+": 1, "-": 0 }),
    part("c1", "electrolytic", "C1", { c: 47e-6 }, { "+": 1, "-": 0 }),
    part("r1", "resistor", "R1", { r: 100e3 }, { 1: 1, 2: 2 }),
    part("v1a", "tube", "VL1.1", { tube: "12AX7" }, { A: 2, G: 4, K: 3 }),
    part("rk", "resistor", "R2", { r: 1500 }, { 1: 3, 2: 0 }),
    part("rg", "resistor", "R3", { r: 1e6 }, { 1: 4, 2: 0 }),
    part("in", "siggen", "G2", {}, { "+": 4, "-": 0 })] };
  const R = { ...B.defaultRules(), ground: "star", heaters: false };
  const w = B.withHeaters(nl, R), board = B.newBoard(); board.rules = R; B.sync(board, w);
  let m = B.model(board, w), gg = B.groundGroups(board, m, w);
  const grp = ref => gg.byPart.get(m.parts.find(g => g.ref === ref).key).group;
  assert.equal(gg.star.ref, "XG1");
  assert.deepEqual(["G1", "C1", "R2", "R3", "G2"].map(grp), ["Supply", "Supply", "VL1", "VL1", "Input"]);
  // the ratsnest: each return to the star on its own (Supply 2 pads + star: 2 links; VL1: 2; Input: 1)
  const star = { pad: gg.star, groupOf: gg.groupOf };
  let c = B.connectivity(board, m.pads, null, star);
  assert.deepEqual(c.rats.filter(r => r.net === 0).map(r => r.group).sort(), ["Input", "Supply", "Supply", "VL1", "VL1"]);
  // the supply's reservoir joined straight to the cathode resistor: reported
  Object.assign(board.parts.c1, { x: 20, y: 20 }); Object.assign(board.parts.rk, { x: 60, y: 60 }); Object.assign(board.parts["star:gnd"], { x: 100, y: 20 });
  m = B.model(board, w); gg = B.groundGroups(board, m, w);
  const cm = m.pads.find(p => p.ref === "C1" && p.net === 0), rk = m.pads.find(p => p.ref === "R2" && p.net === 0), sp = gg.star;
  board.tracks.push({ layer: "B.Cu", w: 1, pts: [[cm.x, cm.y], [cm.x, 40], [rk.x, 40], [rk.x, rk.y]] });
  m = B.model(board, w); c = B.connectivity(board, m.pads, null, { pad: B.groundGroups(board, m, w).star, groupOf: B.groundGroups(board, m, w).groupOf });
  let d = B.drc(board, m, c, new Set(), [], w).filter(x => x.kind === "star");
  assert.ok(d.length === 1 && /Supply and VL1 share copper away from the star point XG1/.test(d[0].msg), d.map(x => x.msg).join("; "));
  // each to the star instead: fine
  board.tracks = [{ layer: "B.Cu", w: 1, pts: [[cm.x, cm.y], [sp.x, sp.y]] }, { layer: "F.Cu", w: 1, pts: [[rk.x, rk.y], [sp.x, sp.y]] }];
  m = B.model(board, w); c = B.connectivity(board, m.pads); d = B.drc(board, m, c, new Set(), [], w).filter(x => x.kind === "star" || x.kind === "short");
  assert.deepEqual(d, []);
  // a part's ground field moves it to another return
  board.parts.rk.ground = "Supply"; assert.equal(B.groundGroups(board, B.model(board, w), w).byPart.get("rk").group, "Supply");
});

test("teardrops where tracks meet round pads, none where one would break the clearance", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.assign(board.parts.r1, { x: 30, y: 30, rot: 0 }); Object.assign(board.parts.c1, { x: 30, y: 60, rot: 0 });
  let m = B.model(board, NETLIST);
  const a = m.pads.find(p => p.ref === "R1" && p.num === "2");
  board.tracks.push({ layer: "B.Cu", w: 0.8, pts: [[a.x, a.y], [a.x + 20, a.y]] });
  let c = B.connectivity(board, m.pads), t = B.teardrops(board, c, null);
  assert.equal(t.length, 1, "one at the pad (the open end has none)");
  assert.ok(t[0].pts.every(p => p[0] >= a.x - 1e-6 && p[0] <= a.x + 2 * a.w + 1e-6) && Math.max(...t[0].pts.map(p => Math.abs(p[1] - a.y))) <= a.w / 2 + 1e-6, "it stays within the pad's width and about a pad's length");
  // another net's pad right beside the joint: no teardrop there
  board.tracks[0].pts = [[a.x, a.y], [a.x, a.y + 20]];
  // the via keeps 0.6 mm from the track itself and from the pad, but a teardrop would come closer
  board.vias.push({ x: a.x + 0.4 + 0.6 + 0.9 + 0.05, y: a.y + 1.6, drill: 0.8, pad: 1.8, net: "GND" });
  m = B.model(board, NETLIST); c = B.connectivity(board, m.pads); t = B.teardrops(board, c, null);
  assert.equal(B.drc(board, m, c, new Set()).filter(x => x.kind === "clearance").length, 0, "the layout itself keeps its clearances");
  assert.equal(t.length, 0, "it would come within the clearance of the via");
});

test("Place all: parts go where they sit in the schematic, big ones first, clear of each other", () => {
  const P = (id, type, label, params, pins, x, y) => Object.assign(part(id, type, label, params, pins), { x, y });
  const nl = { names: { 0: "GND" }, volts: {}, parts: [
    P("in", "siggen", "G1", {}, { "+": 1, "-": 0 }, 0, 100), P("v", "tube", "VL1", { tube: "6P14P" }, { A: 2, G1: 1, G2: 3, K: 0 }, 200, 100),
    P("r", "resistor", "R1", {}, { 1: 1, 2: 0 }, 100, 100), P("o", "speaker", "BA1", {}, { 1: 2, 2: 0 }, 400, 100)] };
  const board = B.newBoard(); B.sync(board, nl);
  const m = B.model(board, nl), left = B.arrange(board, m, m.parts.map(g => g.key), nl), x = r => board.parts[m.parts.find(g => g.ref === r).key].x;
  assert.equal(left, 0);
  assert.ok(x("G1") < x("R1") && x("R1") < x("VL1") && x("VL1") < x("BA1"), `left to right as in the schematic (${["G1", "R1", "VL1", "BA1"].map(x).join(", ")})`);
  const m2 = B.model(board, nl), boxes = m2.parts.map(B.partBox);
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach(b => assert.ok(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1, "no two courtyards overlap")));
});

test("germanium transistors: 10 USSR and 10 Western, hFE inside the datasheet's range, VBE of germanium, each simulates and has a footprint", () => {
  const E = globalThis.TubeSimEngine;
  // [type, IC of the hFE test (VCE = 5 V), hFE min, max]: the datasheets' ranges (USSR: h21э)
  const GE = [["MP39B", 1e-3, 20, 60], ["MP40A", 1e-3, 20, 80], ["MP41A", 1e-3, 50, 120], ["MP42B", 10e-3, 45, 100], ["MP25B", 10e-3, 30, 80], ["MP26B", 10e-3, 30, 80],
    ["MP38A", 1e-3, 45, 100], ["GT402G", 0.1, 60, 150], ["GT404G", 0.1, 60, 150], ["P213B", 1, 40, 150],
    ["AC127", 0.3, 50, 200], ["AC128", 0.3, 60, 175], ["AC187", 0.3, 100, 500], ["AC188", 0.3, 100, 500], ["OC71", 3e-3, 30, 75], ["NKT275", 1e-3, 70, 150],
    ["2N404", 12e-3, 30, 120], ["AD149", 1, 30, 100], ["AD161", 0.5, 80, 320], ["AD162", 0.5, 80, 320]];
  assert.equal(GE.filter(([k]) => /^(MP|GT|P2)/.test(k)).length, 10, "10 USSR types");
  const at = (m, ic) => { let lo = 0, hi = 1.5; for (let k = 0; k < 80; k++) { const v = (lo + hi) / 2, I = E.Semi.bjt([5 * m.pol, v * m.pol, 0], m); if (I[0] * m.pol < ic) lo = v; else hi = v; } const v = (lo + hi) / 2, I = E.Semi.bjt([5 * m.pol, v * m.pol, 0], m), J = E.Semi.bjt([5 * m.pol, (v + 1e-4) * m.pol, 0], m); return { vbe: v, hfe: (J[0] - I[0]) / (J[1] - I[1]) }; };
  // hFE as the datasheet's h21э: the small-signal ratio ΔIC/ΔIB, which the leakage does not change
  for (const [k, ic, lo, hi] of GE) {
    const m = L.BJTS[k]; assert.ok(m, `${k} is in the library`);
    const { vbe, hfe } = at(m, ic);
    assert.ok(hfe >= lo && hfe <= hi, `${k}: hFE ${hfe.toFixed(0)} at ${ic} A, datasheet ${lo}–${hi}`);
    // germanium: about 0.2 V at 1 mA (silicon 0.6–0.7 V); the power parts under 0.45 V at their test current
    const v1 = at(m, 1e-3).vbe; assert.ok(v1 > 0.1 && v1 < 0.3, `${k}: VBE ${v1.toFixed(3)} V at 1 mA`);
    assert.ok(vbe < 0.45, `${k}: VBE ${vbe.toFixed(3)} V at ${ic} A`);
    // a common-emitter stage from the CAD's own part: 9 V (−9 V for PNP), base fed through Rb for IC ≈ icq, Rc for half the supply.
    // Germanium's leakage flows on top, (hFE + 1)·ICBO: the base current is what is left, and IC well above the leakage
    const pol = m.pol, icq = Math.max(Math.min(ic / 10, 1e-3), 4 * (m.bf + 1) * (m.icbo || 0)), rc = 4.5 / icq, rb = 9 / ((icq - (m.bf + 1) * (m.icbo || 0)) / m.bf), els = [];
    const c = { id: "q", type: pol > 0 ? "npn" : "pnp", params: { model: k } }, nets = { C: 3, B: 2, E: 0 };
    L.LIB[c.type].build(c, p => nets[p], null, els);
    const r = E.simulate({ nodeCount: 4, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: 9 * pol }, { id: "rb", kind: "R", nodes: [1, 2], r: rb }, { id: "rc", kind: "R", nodes: [1, 3], r: rc }, ...els] });
    assert.ok(r.ok, `${k}: ${r.error}`);
    const q = r.dc.devices.q.main, vce = r.dc.nodes[3] * pol;
    assert.ok(q.vbe > 0.08 && q.vbe < 0.3 && vce > 1 && vce < 8.5, `${k}: CE stage VBE ${q.vbe.toFixed(3)} V, VCE ${vce.toFixed(2)} V`);
    // a board footprint (wired for the chassis-mounted power cans) and its parts list line
    const g = B.physicalParts({ parts: [part("x", c.type, "VT1", { model: k }, { C: 1, B: 2, E: 3 })] })[0];
    const f = B.footprint(g.options[0]);
    assert.ok(f && f.pads.length === 3, `${k}: footprint ${g.options[0]}`);
    assert.equal(/^WIRE/.test(g.options[0]), m.pkg === "TO-3" || m.pkg === "SOT-9", `${k}: ${m.pkg} → ${g.options[0]}`);
  }
});

test("transistor temperature: VBE falls about 2 mV/°C, hFE rises, germanium leakage doubles every 10 °C and runs a fixed-bias stage into saturation", () => {
  const E = globalThis.TubeSimEngine;
  const vbeAt = (m, ic) => { let lo = 0, hi = 1.5; for (let k = 0; k < 80; k++) { const v = (lo + hi) / 2; if (E.Semi.bjt([5 * m.pol, v * m.pol, 0], m)[0] * m.pol < ic) lo = v; else hi = v; } return (lo + hi) / 2; };
  for (const k of ["AC128", "MP39B", "2N3904", "BC547B"]) {
    const m25 = L.bjtAt(L.BJTS[k], 25), m55 = L.bjtAt(L.BJTS[k], 55);
    const tc = (vbeAt(m55, 1e-3) - vbeAt(m25, 1e-3)) / 30 * 1e3;
    assert.ok(tc < -1.5 && tc > -2.6, `${k}: VBE ${tc.toFixed(2)} mV/°C at 1 mA`);
    assert.ok(m55.bf > m25.bf * 1.1 && m55.bf < m25.bf * 1.3, `${k}: BF ${m25.bf.toFixed(0)} → ${m55.bf.toFixed(0)}`);
    // at 25 °C the model is the table's own: nothing changes for circuits that never set a temperature
    assert.equal(m25.is, L.BJTS[k].is); assert.equal(m25.bf, L.BJTS[k].bf);
    if (L.BJTS[k].ge) assert.ok(Math.abs(m55.icbo / m25.icbo - 8) < 1e-9, `${k}: ICBO ×8 from 25 to 55 °C`); else assert.equal(m25.icbo, 0);
  }
  // reverse-biased CB junction alone (emitter open): the collector draws ICBO, flowing out of the base
  const ac = L.bjtAt(L.BJTS.AC128, 25), I = E.Semi.bjt([-9, 0, 0], ac);
  // (the junction's own saturation current, IS·(1 + 1/BR), adds a little: under a µA)
  const own = ac.is * (1 + 1 / ac.br);
  assert.ok(-I[0] > ac.icbo && -I[0] < ac.icbo + 2 * own && I[1] > ac.icbo, `ICBO ${(-I[0] * 1e6).toFixed(2)} µA: leakage ${ac.icbo * 1e6} µA + junction ${(own * 1e6).toFixed(2)} µA`);
  // an AC128 on fixed base bias (Fuzz Face-like: 470 kΩ from the collector side of −9 V): IC grows with temperature, at 60 °C it saturates
  const stage = t => {
    const c = { id: "q", type: "pnp", params: { model: "AC128", temp: t } }, els = [];
    L.LIB.pnp.build(c, p => ({ C: 3, B: 2, E: 0 })[p], null, els);
    const r = E.simulate({ nodeCount: 4, elements: [{ id: "v", kind: "V", nodes: [1, 0], v: -9 }, { id: "rb", kind: "R", nodes: [1, 2], r: 1.5e6 }, { id: "rc", kind: "R", nodes: [1, 3], r: 4700 }, ...els] });
    assert.ok(r.ok, r.error); return { ic: r.dc.devices.q.main.ic, vce: -r.dc.nodes[3] };
  };
  const s0 = stage(0), s25 = stage(25), s45 = stage(45), s60 = stage(60);
  assert.ok(s0.ic < s25.ic && s25.ic < s45.ic && s45.ic <= s60.ic * 1.0001, `IC ${[s0, s25, s45, s60].map(x => (x.ic * 1e3).toFixed(2)).join(" → ")} mA from 0 to 60 °C`);
  assert.ok(s25.vce > 2 && s60.vce < 0.3, `VCE ${s25.vce.toFixed(2)} V at 25 °C, ${s60.vce.toFixed(2)} V at 60 °C (saturated)`);
});

test("a mounting hole under a part, or so near that its screw head and standoff (Ø 7 mm for M3) would touch it, is reported", () => {
  const board = B.newBoard(); B.sync(board, NETLIST);
  Object.assign(board.parts.r1, { x: 30, y: 30, rot: 0 });
  const msgs = () => B.drc(board, B.model(board, NETLIST), B.connectivity(board, B.model(board, NETLIST).pads), new Set()).filter(d => /Mounting hole/.test(d.msg)).map(d => d.msg);
  const b = B.partBox(B.model(board, NETLIST).parts.find(g => g.ref === "R1"));
  board.holes = [{ x: (b.x1 + b.x2) / 2, y: b.y2 + 1, d: 3.2 }];          // 1 mm below the body: the washer overlaps
  assert.equal(msgs().length, 1); assert.match(msgs()[0], /under R1.*Ø 7 mm/);
  board.holes = [{ x: (b.x1 + b.x2) / 2, y: b.y2 + 4, d: 3.2 }];          // 4 mm away: clear
  assert.deepEqual(msgs(), []);
});

test("plated mounting holes: a copper ring on both layers, joined by a pour of its net, drilled with the plated holes; checked when left unjoined", () => {
  const board = fabBoard();
  Object.assign(board.holes[0], { plated: true, net: "GND" });          // a grounded chassis screw, in the bottom GND pour
  Object.assign(board.holes[1], { plated: true });                      // a plated hole with no net
  const { m, fills, conn } = analyse(board), hv = B.hvNets(NETLIST.volts, 60);
  const it = conn.items.find(x => x.kind === "hole" && x.hi === 0), gnd = conn.items.find(x => x.kind === "pad" && x.pad.netName === "GND");
  assert.ok(it && Math.abs(it.r - 3) < 1e-9, "a Ø 6 mm ring round the M3 hole");
  assert.equal(it.cluster, gnd.cluster, "the GND pour joins the grounded hole");
  assert.equal(conn.items.find(x => x.kind === "hole" && x.hi === 1).net, null, "the other hole has no net");
  let d = B.drc(board, m, conn, hv, fills, NETLIST);
  assert.ok(!d.some(x => /Plated hole/.test(x.msg)), d.filter(x => /Plated hole/.test(x.msg)).map(x => x.msg).join("; "));
  // without the pour the grounded hole is reported; a ring too thin for its hole too
  const b2 = fabBoard(); b2.zones = []; Object.assign(b2.holes[0], { plated: true, net: "GND" }); Object.assign(b2.holes[2], { plated: true, pad: 3.4 });
  const a2 = analyse(b2); d = B.drc(b2, a2.m, a2.conn, hv, a2.fills, NETLIST);
  assert.ok(d.some(x => /Plated hole for GND is not connected/.test(x.msg)) && d.some(x => /Plated hole: annular ring 0\.10 mm/.test(x.msg)), d.map(x => x.msg).join("; "));
  // the files: the ring on both copper layers and bare in both masks, the hole in the plated drill file
  const files = F.fabFiles(board, m, fills, { base: "t", title: "Test", version: "9.9.9" }), h = board.holes[0];
  const at = `X${Math.round(h.x * 1e6)}Y${Math.round((board.outline.h - h.y) * 1e6)}D03*`;
  for (const l of ["F_Cu", "B_Cu", "F_Mask", "B_Mask"]) assert.ok(files[`t-${l}.gbr`].includes(at), `${l}: the ring at the hole`);
  assert.ok(/%TA\.AperFunction,WasherPad\*%\n%ADD\d+C,6\.000000\*%/.test(files["t-F_Cu.gbr"]), "the ring is a washer pad");
  assert.ok(/; #@! TA\.AperFunction,Plated,PTH,MechanicalDrill\nT\d+C3\.200/.test(files["t-PTH.drl"]) && files["t-PTH.drl"].includes(`X${h.x.toFixed(3)}Y${(board.outline.h - h.y).toFixed(3)}`));
  assert.equal(files["t-NPTH.drl"].split("\n").filter(l => /^X/.test(l)).length, 2, "the two plain holes stay in the NPTH file");
  assert.match(files["t-README.txt"], /2 of them plated mounting holes/);
});

test("Gerber X2 details: pad, via and track apertures told apart; silkscreen inside the board and off the pads; ASCII only", () => {
  const board = fabBoard();
  board.vias.push({ x: 100, y: 20, drill: 0.8, pad: 1.8 });
  board.texts.push({ x: 60, y: 89.5, text: "EDGE", size: 2, layer: "F.SilkS", rot: 0 });       // over the bottom edge
  const { m, fills } = analyse(board), files = F.fabFiles(board, m, fills, { base: "t", title: "Усилитель 2 × 4.5 W, 5Ц4С", version: "9.9.9" });
  const cu = files["t-F_Cu.gbr"];
  assert.ok(/%TF\.Part,Single\*%/.test(cu) && /%TF\.SameCoordinates,Original\*%/.test(cu));
  for (const fn of ["ComponentPad", "ViaPad", "Conductor"]) assert.ok((cu + files["t-B_Cu.gbr"]).includes(`%TA.AperFunction,${fn}*%`), fn);
  assert.ok(/%TA\.AperFunction,Profile\*%/.test(files["t-Edge_Cuts.gbr"]));
  for (const [n, t] of Object.entries(files)) if (!n.endsWith(".txt")) assert.ok(/^[\x0a\x20-\x7e]*$/.test(t), `${n} is plain ASCII`);   // eslint-disable-line no-control-regex
  assert.match(cu, /^G04 Tube Amp CAD board: Usilitel 2 x 4\.5 W, 5Ts4S - F\.Cu\*/);
  // the silkscreen: every line inside the outline (0.1 mm in), and clear flashes over the pads after it
  const ops = F.layerOps(board, m, fills, "F.SilkS"), P = B.outlinePoly(board.outline, 0.1);
  ops.filter(o => o.t === "line").forEach(o => o.pts.forEach(([x, y]) => assert.ok(B.pip(x, y, P) || B.edgeDist(x, y, board.outline) >= 0.099, `silk at ${x}, ${y} inside`)));
  assert.ok(ops.filter(o => o.pol === "C" && o.t === "flash").length >= m.pads.length, "every pad cut out of the silkscreen");
  const edgeText = ops.filter(o => o.t === "line" && o.pts.some(([, y]) => y > 88));
  assert.ok(edgeText.every(o => o.pts.every(([, y]) => y <= board.outline.h - 0.099)), "text over the edge is cut at the outline");
  // a reference over the top edge goes under its part instead
  const b2 = fabBoard(), k = Object.keys(b2.parts).find(q => b2.parts[q].ref === "R1"); b2.parts[k].y = 4;
  const m2 = B.model(b2, NETLIST), g = m2.parts.find(q => q.ref === "R1"), refs = B.partSilk(g, false, b2.outline).filter(o => o.ref), box = B.partBox(g);
  assert.ok(refs.length && refs.every(o => o.pts.every(([, y]) => y > box.y2)), "R1's reference below it at the top edge");
});

test("an NE555 goes on a DIP-8: pin n on pad n, pin 1 square at the top left, the rows 7.62 mm apart", () => {
  const nets = { 1: 0, 2: 3, 3: 4, 4: 1, 5: 5, 6: 3, 7: 2, 8: 1 };
  const NL = { names: { 0: "GND" }, parts: [part("u1", "timer555", "DA1", {}, nets)] };
  const g = B.physicalParts(NL)[0];
  assert.equal(g.defaultFp, "DIP-8");
  const f = B.footprint("DIP-8");
  assert.equal(f.pads[0].shape, "rect");
  assert.deepEqual(f.pads.map(p => [p.x, +p.y.toFixed(2)]), [[-3.81, -3.81], [-3.81, -1.27], [-3.81, 1.27], [-3.81, 3.81], [3.81, 3.81], [3.81, 1.27], [3.81, -1.27], [3.81, -3.81]]);
  const board = B.newBoard(); B.sync(board, NL);
  const m = B.model(board, NL);
  for (const [pin, net] of Object.entries(nets)) assert.equal(m.pads.find(p => p.ref === "DA1" && p.num === pin).net, net, `pin ${pin}`);
  // in 3D: the moulded body and a lead for every pin
  const g3 = m.parts.find(q => q.ref === "DA1"), bodies = globalThis.Board3D.partBodies(g3, 1.6, {});
  assert.equal(bodies.length, 1 + 8);
});
