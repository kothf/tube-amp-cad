/**
 * SMD versions of the board's parts: the surface-mount footprints, their pads on one copper
 * layer, and what follows from that in the checks, the Gerbers, the drill file, the 3D model,
 * the Freerouting design and the bill of materials (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "pdf-export.js", "board-fab.js", "board-route.js", "board-3d.js", "bom.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab, BR = globalThis.BoardRoute, D3 = globalThis.Board3D;

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
// a cathode follower's small parts: R1 and C1 from B+ to the gate, a BJT, an op-amp and a diode
const NETLIST = {
  names: { 0: "GND", 1: "B+" },
  volts: { 1: 24, 2: 12, 3: 11.3, 4: 0 },
  parts: [
    part("r1", "resistor", "R1", { r: 10e3, w: "0.25" }, { 1: 1, 2: 2 }),
    part("r2", "resistor", "R2", { r: 1e3, w: "0.25" }, { 1: 3, 2: 0 }),
    part("c1", "capacitor", "C1", { c: 100e-9 }, { 1: 2, 2: 0 }),
    part("q1", "npn", "VT1", { model: "BD139" }, { C: 1, B: 2, E: 3 }),
    part("d1", "diode", "VD1", { model: "1N4148" }, { A: 3, K: 1 }),
    part("e1", "electrolytic", "C2", { c: 47e-6 }, { "+": 1, "-": 0 })
  ]
};
const placed = smd => {
  const board = B.newBoard(); B.sync(board, NETLIST); board.outline = { w: 60, h: 40, r: 0 };
  const at = { R1: [10, 10], R2: [10, 25], C1: [25, 10], VT1: [40, 20], VD1: [25, 30], C2: [50, 32] };
  const { parts } = B.sync(board, NETLIST);
  Object.values(board.parts).forEach(p => { Object.assign(p, { x: at[p.ref][0], y: at[p.ref][1] }); const g = parts.find(q => q.ref === p.ref); if (smd && g.smdFp) p.fp = g.smdFp; });
  return board;
};
const analyse = board => { const m = B.model(board, NETLIST), conn = B.connectivity(board, m.pads); return { m, conn, drc: B.drc(board, m, conn, B.hvNets(NETLIST.volts, board.rules.hvVolts), [], NETLIST) }; };

test("SMD versions: chips, diodes, V-chip electrolytics, SOT-23 / SOT-223 / D²PAK, SOIC; valves and big power parts stay through-hole", () => {
  const smdOf = (type, params, pins) => B.physicalParts({ parts: [part("x", type, "X1", params, pins)] })[0];
  assert.equal(smdOf("resistor", { w: "0.25" }, { 1: 1, 2: 2 }).smdFp, "CHIP-1206");
  assert.equal(smdOf("resistor", { w: "0.125" }, { 1: 1, 2: 2 }).smdFp, "CHIP-0805");
  assert.equal(smdOf("resistor", { w: "1" }, { 1: 1, 2: 2 }).smdFp, "CHIP-2512");
  assert.equal(smdOf("resistor", { w: "5" }, { 1: 1, 2: 2 }).smdFp, null, "a 5 W resistor has no SMD version");
  assert.equal(smdOf("capacitor", { c: 100e-12 }, { 1: 1, 2: 2 }).smdFp, "CHIP-0805");
  assert.equal(smdOf("electrolytic", { c: 47e-6 }, { "+": 1, "-": 2 }).smdFp, "CP-SMD-D8");
  assert.equal(smdOf("electrolytic", { c: 4700e-6 }, { "+": 1, "-": 2 }).smdFp, null, "a reservoir can stays through-hole");
  assert.equal(smdOf("diode", { model: "1N4148" }, { A: 1, K: 2 }).smdFp, "SOD-123");
  assert.equal(smdOf("diode", { model: "1N4007" }, { A: 1, K: 2 }).smdFp, "SMA");
  assert.equal(smdOf("npn", { model: "2N3904" }, { C: 1, B: 2, E: 3 }).smdFp, "SOT-23-BEC");
  assert.equal(smdOf("nmos", { model: "2N7000" }, { D: 1, G: 2, S: 3 }).smdFp, "SOT-23-GSD");
  assert.equal(smdOf("npn", { model: "BD139" }, { C: 1, B: 2, E: 3 }).smdFp, "SOT-223-BCE");
  assert.equal(smdOf("nmos", { model: "IRF540" }, { D: 1, G: 2, S: 3 }).smdFp, "D2PAK-GDS");
  assert.equal(smdOf("npn", { model: "2SC5200" }, { C: 1, B: 2, E: 3 }).smdFp, null, "TO-264 stays");
  assert.equal(smdOf("timer555", {}, Object.fromEntries(L.LIB.timer555.pins({ params: L.LIB.timer555.defaults }).map(p => [p.id, 1]))).smdFp, "SOIC-8");
  assert.equal(smdOf("tube", { tube: "12AX7" }, { A: 1, G: 2, K: 3 }).smdFp, null);
  // every SMD footprint: pads on one layer, no drill, inside the courtyard
  const names = new Set();
  for (const [type, def] of Object.entries(L.LIB)) {
    if (["frame", "note", "ground", "offsheet", "scope"].includes(type)) continue;
    const variants = type === "npn" || type === "pnp" ? Object.keys(L.BJTS).filter(k => (L.BJTS[k].pol > 0) === (type === "npn")).map(model => ({ model }))
      : type === "nmos" || type === "pmos" ? Object.keys(L.MOSFETS).filter(k => (L.MOSFETS[k].pol > 0) === (type === "nmos")).map(model => ({ model }))
      : type === "opamp" ? Object.keys(L.OPAMPS).map(model => ({ model })) : type === "zener" ? Object.keys(L.ZENERS).map(model => ({ model })) : type === "diode" ? ["1N4007", "1N4148"].map(model => ({ model }))
      : type === "electrolytic" ? [1e-6, 10e-6, 100e-6, 470e-6, 1000e-6].map(c => ({ c })) : [{}];
    for (const params of variants) {
      const g = B.physicalParts({ parts: [part("x", type, "X1", params, Object.fromEntries(def.pins({ params: Object.assign({}, def.defaults, params) }).map(p => [p.id, 1])))] })[0];
      B.smdOptions(g).forEach(n => names.add(n));
      if (g.smdFp) assert.ok(g.options.includes(g.smdFp) && B.isSmd(g.smdFp) && !B.isSmd(g.defaultFp), `${type} ${JSON.stringify(params)}: the through-hole default first, the SMD one among the options`);
    }
  }
  assert.ok(names.size >= 30, `${names.size} SMD footprints`);
  for (const n of names) {
    const f = B.footprint(n);
    assert.ok(f && f.smd && f.pads.every(p => p.smd && p.drill === 0 && p.shape === "rect"), n);
    assert.ok(f.pads.every(p => p.x - p.w / 2 >= f.box[0] && p.x + p.w / 2 <= f.box[2] && p.y - p.h / 2 >= f.box[1] && p.y + p.h / 2 <= f.box[3]), `${n}: pads inside the courtyard`);
    for (const side of ["F", "B"]) {
      const bodies = D3.partBodies({ ref: "X1", type: /^LED/.test(n) ? "led" : "capacitor", fp: f, place: { x: 20, y: 20, rot: 1, side } }, 1.6, {});
      assert.ok(bodies.length > 0, n);
      // standing on the board's surface on its side: above the top (z ≥ 1.6) or below the bottom (z ≤ 0)
      bodies.forEach(b => assert.ok(b.verts.every(v => (side === "F" ? v[2] >= 1.6 - 1e-9 : v[2] <= 1e-9)), `${n} ${side}: ${b.name} on the surface`));
      // closed solids: every edge used once each way
      bodies.forEach(b => { const uses = new Map(); b.faces.forEach(fc => fc.loops.forEach(l => l.forEach((a, i) => { const k = `${a}>${l[(i + 1) % l.length]}`; uses.set(k, (uses.get(k) || 0) + 1); })));
        for (const [k, c] of uses) { const [a, z] = k.split(">"); assert.ok(c === 1 && uses.get(`${z}>${a}`) === 1, `${n} ${side}: ${b.name} edge ${k}`); } });
    }
  }
  // a tab carries the middle pin's electrode: an SOT-223's collector is pin 2 and the tab (pad 4)
  const g = B.physicalParts({ parts: [part("q", "npn", "VT1", { model: "BD139" }, { C: 5, B: 6, E: 7 })] })[0], f = B.footprint("SOT-223-BCE");
  const map = B.padMap(g, f);
  assert.deepEqual(["1", "2", "3", "4"].map(k => (map.get(k) || []).map(c => c.pin).join()), ["B", "C", "E", "C"]);
});

test("an SMD part's pads are on its side's copper only: connectivity, the drill and ring checks, a side change", () => {
  const board = placed(true), { m, conn, drc } = analyse(board);
  const r1 = m.pads.filter(p => p.ref === "R1");
  assert.ok(r1.every(p => p.smd && p.layers.length === 1 && p.layers[0] === "F.Cu"), "R1 on the top");
  assert.ok(!drc.some(d => d.kind === "drill" || d.kind === "annular"), drc.filter(d => d.kind === "drill" || d.kind === "annular").map(d => d.msg).join("; "));
  // a track on the bottom under R1's pad does not reach it; on the top it does
  const p1 = r1.find(p => p.num === "1"), before = conn.unrouted;
  board.tracks.push({ layer: "B.Cu", w: 0.5, pts: [[p1.x, p1.y], [p1.x, p1.y - 6]] });
  const c2 = B.connectivity(board, B.model(board, NETLIST).pads), it = c2.items.find(x => x.kind === "track");
  assert.notEqual(it.cluster, c2.items.find(x => x.kind === "pad" && x.pad.ref === "R1" && x.pad.num === "1").cluster, "the bottom track misses the top pad");
  board.tracks[0].layer = "F.Cu";
  const c3 = B.connectivity(board, B.model(board, NETLIST).pads), it3 = c3.items.find(x => x.kind === "track");
  assert.equal(it3.cluster, c3.items.find(x => x.kind === "pad" && x.pad.ref === "R1" && x.pad.num === "1").cluster, "the top track reaches it");
  assert.equal(c3.unrouted, before);
  // on the bottom side, the pads move to the bottom copper
  Object.values(board.parts).find(p => p.ref === "R1").side = "B";
  assert.ok(B.model(board, NETLIST).pads.filter(p => p.ref === "R1").every(p => p.layers[0] === "B.Cu"));
  // a through-hole part keeps both layers
  const tht = B.model(placed(false), NETLIST).pads;
  assert.ok(tht.every(p => !p.smd && p.layers.length === 2));
});

test("sync keeps a part SMD when its footprint stops fitting (another model, another rating)", () => {
  const board = placed(true), bp = ref => Object.values(board.parts).find(p => p.ref === ref);
  assert.equal(bp("R1").fp, "CHIP-1206"); assert.equal(bp("VD1").fp, "SOD-123");
  const nl = JSON.parse(JSON.stringify(NETLIST)); nl.parts[0].params.w = "1"; nl.parts[4].params.model = "1N4007";
  B.sync(board, nl);
  assert.equal(bp("R1").fp, "CHIP-1206", "1206 is still among a 1 W resistor's SMD options: kept");
  assert.equal(bp("VD1").fp, "SMA", "a rectifier: its SMD default");
  nl.parts[0].params.w = "5"; B.sync(board, nl);
  assert.equal(bp("R1").fp, "AXIAL-30.48", "a 5 W resistor has no SMD version: through-hole");
});

test("Gerbers: SMD pads on their side's copper, mask and paste; no drill; a placement file", () => {
  const board = placed(true);
  Object.values(board.parts).find(p => p.ref === "C1").side = "B";
  const { m } = analyse(board);
  const ops = l => F.layerOps(board, m, [], l), flashes = (l, x, y) => ops(l).filter(o => o.t === "flash" && o.pol === "D" && Math.abs(o.x - x) < 1e-6 && Math.abs(o.y - y) < 1e-6);
  const r1 = m.pads.find(p => p.ref === "R1" && p.num === "1"), c1 = m.pads.find(p => p.ref === "C1" && p.num === "1");
  assert.equal(flashes("F.Cu", r1.x, r1.y).length, 1); assert.equal(flashes("B.Cu", r1.x, r1.y).length, 0);
  assert.equal(flashes("B.Cu", c1.x, c1.y).length, 1); assert.equal(flashes("F.Cu", c1.x, c1.y).length, 0);
  assert.equal(flashes("F.Mask", r1.x, r1.y).length, 1); assert.equal(flashes("B.Mask", r1.x, r1.y).length, 0);
  assert.equal(flashes("F.Paste", r1.x, r1.y).length, 1); assert.equal(flashes("B.Paste", c1.x, c1.y).length, 1); assert.equal(flashes("F.Paste", c1.x, c1.y).length, 0);
  assert.equal(F.drills(board, m).pth.length, 0, "no component holes");
  const files = F.fabFiles(board, m, [], { base: "t", title: "T", version: "9" });
  assert.ok(files["t-F_Paste.gbr"] && files["t-B_Paste.gbr"] && /TF.FileFunction,Paste,Top/.test(files["t-F_Paste.gbr"]));
  assert.ok(/AperFunction,SMDPad,CuDef/.test(files["t-F_Cu.gbr"]));
  const pos = files["t-pos.csv"].trim().split("\n");
  assert.equal(pos[0], "Ref,Val,Package,PosX,PosY,Rot,Side");
  assert.equal(pos.length, 1 + 6);
  const c1row = pos.find(l => l.startsWith('"C1"')).split(",");
  assert.equal(c1row[2], '"CHIP-1206"'); assert.equal(c1row[6], "bottom"); assert.equal(+c1row[3], 25); assert.equal(+c1row[4], 40 - 10);
  assert.ok(/Surface-mount parts: 6/.test(files["t-README.txt"]));
  // a through-hole board makes neither
  const tb = placed(false), tf = F.fabFiles(tb, B.model(tb, NETLIST), [], { base: "t" });
  assert.ok(!tf["t-F_Paste.gbr"] && !tf["t-pos.csv"]);
});

test("placement: a part's centre is its land pattern's, not its pads' mean; a DPAK tab gets windowpane paste", () => {
  const board = placed(true), vt = Object.values(board.parts).find(p => p.ref === "VT1");
  ["SOT-223-BCE", "DPAK-BCE"].forEach(fp => [0, 1].forEach(rot => {
    Object.assign(vt, { fp, rot }); const { m } = analyse(board), pads = m.pads.filter(p => p.ref === "VT1");
    const ext = (k, d) => (Math.min(...pads.map(p => p[k] - p[d] / 2)) + Math.max(...pads.map(p => p[k] + p[d] / 2))) / 2;
    const row = F.placement(board, m).split("\n").find(l => l.startsWith('"VT1"')).split(",");
    assert.ok(Math.abs(+row[3] - ext("x", "w")) < 1e-3 && Math.abs(+row[4] - (40 - ext("y", "h"))) < 1e-3, `${fp} rot ${rot}: ${row}`);
    // paste: the pins whole; a DPAK's tab in 2 × 2 panes inside it covering 70 %, an SOT-223's whole
    const tab = pads.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b)), on = o => Math.abs(o.x - tab.x) < tab.w / 2 && Math.abs(o.y - tab.y) < tab.h / 2;
    const panes = F.layerOps(board, m, [], "F.Paste").filter(o => o.t === "flash" && on(o)), area = panes.reduce((s, o) => s + o.w * o.h, 0);
    if (fp.startsWith("DPAK")) {
      assert.equal(panes.length, 4); assert.ok(Math.abs(area / (tab.w * tab.h) - 0.7) < 0.01, `${area}`);
      panes.forEach(o => assert.ok(Math.abs(o.x - tab.x) + o.w / 2 <= tab.w / 2 + 1e-9 && Math.abs(o.y - tab.y) + o.h / 2 <= tab.h / 2 + 1e-9));
    } else { assert.equal(panes.length, 1); assert.equal(panes[0].w * panes[0].h, tab.w * tab.h); }
  }));
});

test("3D: the board has no holes for SMD pads", () => {
  const board = placed(true), { m } = analyse(board), sc = D3.scene(board, m, {});
  assert.equal(sc.board.faces.filter(f => f.loops.length > 1).length, 0, "no holes at all");
  assert.ok(sc.bodies.length >= 6);
});

test("Freerouting: an SMD pad's padstack is on its own layer, and its escape stub too", () => {
  const board = placed(true), { m, conn } = analyse(board), clr = B.clearanceRules(board, m, new Set(), NETLIST);
  const d = BR.toDsn(board, m, conn, clr, { title: "t" }), s = BR.parse(d.text);
  const stacks = s.find(x => x[0] === "library").filter(x => Array.isArray(x) && x[0] === "padstack");
  const smd = stacks.filter(x => /_F$/.test(x[1]));
  assert.ok(smd.length > 0, stacks.map(x => x[1]).join(" "));
  smd.forEach(ps => { const shapes = ps.filter(y => Array.isArray(y) && y[0] === "shape"); assert.equal(shapes.length, 1); assert.equal(shapes[0][1][1], "F.Cu"); });
  d.stubs.forEach(st => assert.equal(st.layer, "F.Cu", `stub from ${st.pad}`));
});

test("BOM: a part made SMD on the board says so with its package; its line splits from the through-hole ones", () => {
  const board = placed(false), r1 = Object.values(board.parts).find(p => p.ref === "R1");
  r1.fp = "CHIP-0805";
  const comps = NETLIST.parts.map(p => ({ id: p.id, type: p.type, label: p.label, params: { ...p.params, r: 1e3 } }));
  const rows = globalThis.BomLib.build(comps, { board });
  const res = rows.filter(r => /^Resistor/.test(r.desc));
  assert.deepEqual(res.map(r => [r.desc, r.refs]).sort(), [["Resistor, SMD 0805", "R1"], ["Resistor", "R2"]]);
  assert.equal(globalThis.BomLib.smdPackage("SOT-223-BCE"), "SOT-223"); assert.equal(globalThis.BomLib.smdPackage("CP-SMD-D6.3"), "Ø6.3 mm"); assert.equal(globalThis.BomLib.smdPackage("AXIAL-10.16"), "");
  // every SMD footprint has a package name for the bill
  for (const t of ["resistor", "capacitor", "electrolytic", "diode", "led", "pot", "timer555", "npn", "nmos"]) {
    const def = L.LIB[t], g = B.physicalParts({ parts: [part("x", t, "X1", t === "npn" ? { model: "BD139" } : {}, Object.fromEntries(def.pins({ params: def.defaults }).map(p => [p.id, 1])))] })[0];
    B.smdOptions(g).forEach(n => assert.ok(globalThis.BomLib.smdPackage(n), n));
  }
});
