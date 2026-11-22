/**
 * For the board maker (board-maker.js): each maker's file names and columns, rotations turned to
 * the maker's zero, the IPC-D-356 netlist read back against the board, and the check against the
 * maker's limits (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "mpn.js", "board-core.js", "pdf-export.js", "board-fab.js", "board-maker.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, F = globalThis.BoardFab, M = globalThis.BoardMaker;

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const NETLIST = {
  names: { 0: "GND", 1: "B+", 2: "A_VERY_LONG_NET_NAME_HERE" },
  parts: [
    part("r1", "resistor", "R1", { r: 10e3, w: "0.125", lcsc: "C17414" }, { 1: 1, 2: 2 }),
    part("r2", "resistor", "R2", { r: 10e3, w: "0.125", lcsc: "C17414" }, { 1: 2, 2: 0 }),
    part("c1", "capacitor", "C1", { c: 100e-9 }, { 1: 2, 2: 0 }),
    part("q1", "npn", "VT1", { model: "BD139", partno: "BD139" }, { C: 1, B: 2, E: 3 }),
    part("u1", "opamp", "DA1", { model: "TL072" }, { "+": 2, "-": 3, out: 3, "V+": 1, "V-": 0 }),
    part("e1", "electrolytic", "C2", { c: 470e-6, v: 63 }, { "+": 1, "-": 0 })
  ]
};
function board(rots) {
  const b = B.newBoard(); b.outline = { w: 60, h: 40, r: 0 };
  const { parts } = B.sync(b, NETLIST);
  const at = { R1: [10, 10], R2: [10, 22], C1: [22, 10], VT1: [40, 12], DA1: [24, 28], C2: [48, 30] };
  Object.values(b.parts).forEach(p => { const g = parts.find(q => q.ref === p.ref); if (g.smdFp && p.ref !== "C2") p.fp = g.smdFp; Object.assign(p, { x: at[p.ref][0], y: at[p.ref][1], rot: (rots || {})[p.ref] || 0 }); });
  b.vias.push({ x: 30, y: 20, drill: 0.4, pad: 0.8, net: "B+" });
  b.holes = [{ x: 4, y: 4, d: 3.2 }];
  return b;
}
const meta = { base: "amp", title: "Test amp", version: "9.9.9" };

test("JLCPCB: Protel Gerber names, its BOM with LCSC Part #, its CPL with its rotations; through-hole left to hand", () => {
  const b = board({ VT1: 1, DA1: 0 }), m = B.model(b, NETLIST);
  const files = M.makerFiles(b, m, { maker: "jlcpcb", asm: "smd", meta });
  for (const n of ["amp.GTL", "amp.GBL", "amp.GTS", "amp.GBS", "amp.GTO", "amp.GKO", "amp.GTP", "amp-PTH.drl", "amp-BOM-JLCPCB.csv", "amp-CPL-JLCPCB.csv", "amp.ipc", "amp-README.txt"]) assert.ok(files[n], `${n} in ${Object.keys(files)}`);
  const bom = files["amp-BOM-JLCPCB.csv"].trim().split("\r\n");
  assert.equal(bom[0], "Comment,Designator,Footprint,LCSC Part #");
  assert.ok(bom.includes('10k,"R1,R2",0805,C17414'), bom.join(" | "));
  assert.ok(!bom.some(l => /C2/.test(l.split(",")[1] || "")), "the through-hole electrolytic is not assembled");
  const cpl = files["amp-CPL-JLCPCB.csv"].trim().split("\r\n"), row = r => cpl.find(l => l.startsWith(r + ",")).split(",");
  assert.equal(cpl[0], "Designator,Val,Package,Mid X,Mid Y,Rotation,Layer");
  // SOT-223 turned a quarter on the board: a quarter to KiCad's zero, then JLCPCB's half turn
  assert.equal(row("VT1")[2], "SOT-223"); assert.equal(+row("VT1")[5], (90 + 90 + 180) % 360);
  assert.equal(+row("DA1")[5], 270, "SOIC: JLCPCB's zero is a quarter from KiCad's");
  assert.equal(+row("R1")[5], 0); assert.equal(row("R1")[6], "Top");
  assert.match(files["amp-README.txt"], /Prepared for JLCPCB/);
});

test("rotations: the generic file is at KiCad's zero; a bottom part mirrored; a part's own turn added", () => {
  const b = board({ VT1: 0 }), m = B.model(b, NETLIST), g = m.parts.find(x => x.ref === "VT1");
  assert.equal(M.rotationFor(g, "generic"), 90, "the app's SOT-223 has its pins below: KiCad's at the left");
  assert.equal(M.rotationFor(g, "pcbway"), 90);
  const pos = F.fabFiles(b, m, [], meta)["amp-pos.csv"].split("\n").find(l => l.startsWith('"VT1"')).split(",");
  assert.equal(+pos[5], 90, "the plain Gerber ZIP's placement file too");
  b.parts[g.key].side = "B";
  assert.equal(M.rotationFor(B.model(b, NETLIST).parts.find(x => x.ref === "VT1"), "generic"), 270);
  b.parts[g.key].side = "F"; b.parts[g.key].rotFix = 180;
  assert.equal(M.rotationFor(g, "jlcpcb", b.parts[g.key]), (90 + 180 + 180) % 360);
  assert.equal(M.kicadName("CHIP-0805"), "R_0805"); assert.equal(M.packageName("SOT-23-BEC"), "SOT-23"); assert.equal(M.packageName("D2PAK-IOG"), "TO-263");
});

test("PCBWay: its BOM columns with maker and part number; SMD and through-hole assembly lists every part", () => {
  const b = board(), m = B.model(b, NETLIST);
  const files = M.makerFiles(b, m, { maker: "pcbway", asm: "all", meta });
  assert.ok(files["amp-F_Cu.gbr"] && files["amp-centroid-PCBWay.csv"]);
  const bom = files["amp-BOM-PCBWay.csv"].trim().split("\r\n");
  assert.equal(bom[0], "Item #,Designator,Qty,Manufacturer,Mfg Part #,Description / Value,Package/Footprint,Type,Your Instructions / Notes");
  assert.ok(bom.some(l => /^\d+,C2,1,/.test(l) && /,THT,/.test(l)), "the electrolytic, through-hole");
  assert.ok(bom.some(l => /,BD139,/.test(l) && /,SMD,/.test(l)));
  const cpl = files["amp-centroid-PCBWay.csv"].trim().split("\r\n");
  assert.equal(cpl[0], "Designator,Mid X,Mid Y,Layer,Rotation"); assert.equal(cpl.length, 1 + 6);
  assert.ok(!M.makerFiles(b, m, { maker: "pcbway", asm: "none", meta, files: ["bom", "cpl", "gerber"] })["amp-BOM-PCBWay.csv"], "no assembly: no BOM");
});

test("IPC-D-356: a record for every pad and via, 80 columns, nets and places read back as on the board", () => {
  const b = board({ DA1: 1 }), m = B.model(b, NETLIST), text = M.ipc356(b, m, meta);
  const lines = text.trim().split("\r\n");
  assert.ok(lines.every(l => l.length <= 80), "fixed 80-column records");
  assert.equal(lines[lines.length - 1], "999");
  assert.ok(lines.includes("P  UNITS CUST 0"));
  const recs = M.readIpc356(text), pads = m.pads;
  assert.equal(recs.filter(r => r.ref !== "VIA").length, pads.length);
  pads.forEach(p => {
    const r = recs.find(x => x.ref === p.ref && x.pin === p.num);
    assert.ok(r, `${p.ref}.${p.num}`);
    assert.equal(r.net, p.netName || "N/C", `${p.ref}.${p.num} net`);
    assert.ok(Math.abs(r.x - p.x) < 0.003 && Math.abs(r.y - (b.outline.h - p.y)) < 0.003, `${p.ref}.${p.num} at ${r.x},${r.y}`);
    assert.equal(r.kind, p.smd ? "327" : "317"); if (!p.smd) assert.ok(Math.abs(r.drill - p.drill) < 0.003);
    assert.equal(r.access, p.smd ? 1 : 0);
  });
  assert.ok(recs.some(r => r.net === "A_VERY_LONG_NET_NAME_HERE"), "a long net name through its NNAME alias");
  const via = recs.find(r => r.ref === "VIA");
  assert.ok(via && via.mid && via.net === "B+" && via.mask === 3, "the via: mid-net, covered");
});

test("the check: limits per maker and layer count; thin tracks, small drills, crowded holes, a small board, rules below the maker's", () => {
  assert.equal(M.limitsOf("jlcpcb", 2).track, 0.1); assert.equal(M.limitsOf("jlcpcb", 4).track, 0.09); assert.equal(M.limitsOf("generic", 2), null);
  const b = board(), m = B.model(b, NETLIST);
  assert.deepEqual(M.check(b, m, "jlcpcb", []).items.filter(i => i.bad), [], "the plain board is within JLCPCB's limits");
  b.tracks.push({ layer: "F.Cu", w: 0.08, pts: [[5, 35], [20, 35]], net: "GND" });
  b.vias.push({ x: 50, y: 10, drill: 0.1, pad: 0.6 }, { x: 50.3, y: 10, drill: 0.3, pad: 0.6 });
  const r = M.check(b, m, "jlcpcb", [{ kind: "clearance", msg: "R1 too close to C1", x: 15, y: 10 }]), msgs = r.items.map(i => i.msg);
  assert.ok(r.items.some(i => i.bad && /Track 0\.08 mm/.test(i.msg) && Math.abs(i.x - 12.5) < 1e-9 && i.y === 35), msgs.join(" | "));
  assert.ok(msgs.some(t => /Via drill 0\.1 mm/.test(t)));
  assert.ok(msgs.some(t => /Holes .* apart/.test(t)));
  assert.ok(msgs.some(t => /^Board check: R1 too close/.test(t)));
  b.outline = { w: 2, h: 40, r: 0 };
  assert.ok(M.check(b, m, "jlcpcb", []).items.some(i => i.bad && /at least 3 × 3/.test(i.msg)));
  const rules = { ...B.defaultRules(), clearance: 0.08, minTrack: 0.3, minDrill: 0.1 };
  assert.ok(M.check({ ...board(), rules }, m, "jlcpcb", []).items.some(i => !i.bad && /gaps of 0\.08 mm/.test(i.msg)));
  const done = M.useLimits(rules, "jlcpcb", 2);
  assert.ok(done.includes("clearance") && done.includes("minDrill") && !done.includes("minTrack"), done.join());
  assert.equal(rules.clearance, 0.1); assert.equal(rules.minTrack, 0.3, "a rule above the limit stays");
});
