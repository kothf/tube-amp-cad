/**
 * Manufacturer part numbers (mpn.js): what a number typed in the BOM says about the real part,
 * and what follows on the board: the footprint it names, the silkscreen and holes to its body,
 * the 3D model's size, a size set by hand over it, and the BOM's Package column (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "mpn-data.js", "mpn.js", "board-core.js", "board-3d.js", "pdf-export.js", "bom.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const P = globalThis.PartNo, B = globalThis.BoardCore, L = globalThis.CadLib, D3 = globalThis.Board3D, BOM = globalThis.BomLib;
const look = (pn, type, params) => P.lookup(pn, type, params || {});

test("leaded resistors: the series' body, leads and the spacing that fits it", () => {
  const r = look("MFR-25FBF52-10K", "resistor", { w: "0.25" });
  assert.equal(r.fp, "AXIAL-10.16");
  assert.deepEqual(r.body, { kind: "axial", l: 6.3, d: 2.4, lead: 0.55 });
  assert.deepEqual(r.warn, []);
  // a ½ W in the schematic, a ¼ W part on the bill
  assert.match(look("MFR-25FBF52-10K", "resistor", { w: "0.5" }).warn[0], /rated 1\/4 W/);
  assert.equal(look("MBA02040C1002FRP00", "resistor").fp, "AXIAL-7.62");
  assert.equal(look("MBE04140C1002FC100", "resistor").fp, "AXIAL-15.24");
  assert.equal(look("PR03000201002JAC00", "resistor").fp, "AXIAL-20.32");
  assert.equal(look("CMF5510K000FHEB", "resistor").body.l, 6.5);
  assert.equal(look("MF0207FTE52-10K", "resistor").maker, "DIN 0207");
});

test("chip sizes from the makers' codes", () => {
  const chips = { "RC0805FR-0710KL": "0805", "ERJ-6ENF1002V": "0805", "ERJ-3EKF1002V": "0603", "ERJ-8ENF1002V": "1206", "CRCW120610K0FKEA": "1206", "RK73H2BTTD1002F": "1206", RMCF2512JT10R0: "2512" };
  Object.entries(chips).forEach(([pn, c]) => assert.equal(look(pn, "resistor").fp, "CHIP-" + c, pn));
  const caps = { GRM188R71H104KA93D: "0603", GRM31CR71H475KA12L: "1206", CL21B104KBCNNNC: "0805", "C3216X7R2A105K160AA": "1206", C0805C104K5RACTU: "0805", "08055C104KAT2A": "0805", CL43B106KBHNNNE: "1812" };
  Object.entries(caps).forEach(([pn, c]) => assert.equal(look(pn, "capacitor").fp, "CHIP-" + c, pn));
  // no 0402 land on this board's library: said, nothing changed
  const tiny = look("GRM155R71H104KE14D", "capacitor");
  assert.equal(tiny.fp, null); assert.match(tiny.text, /0402/);
});

test("film capacitors: the spacing their series name gives", () => {
  assert.equal(look("B32529C1104J", "capacitor").fp, "BOX-5");
  assert.equal(look("B32521C3104K", "capacitor").fp, "BOX-10");
  assert.equal(look("B32522C1105K", "capacitor").fp, "BOX-15");
  assert.equal(look("R82EC3100AA50J", "capacitor").fp, "BOX-5");
  assert.equal(look("MKS2C041001A00JSSD", "capacitor").fp, "BOX-5");
});

test("electrolytics: the case from the makers' dimension tables", () => {
  // Nichicon UKW datasheet: 50 V 100 µF is Ø8 × 11.5
  const u = look("UKW1H101MPD", "electrolytic", { c: 100e-6, v: 50 });
  assert.equal(u.fp, "RADIAL-D8-P3.5");
  assert.deepEqual([u.body.d, u.body.h], [8, 11.5]);
  assert.deepEqual(u.warn, []);
  // taping and size codes after the listed number; a value that disagrees is flagged
  const t = look("UKW1H101MPD1TD", "electrolytic", { c: 47e-6, v: 63 });
  assert.equal(t.fp, "RADIAL-D8-P3.5");
  assert.equal(t.warn.length, 2);
  // the longest listed number wins (…MPD9 is another case than …MPD)
  assert.equal(look("UCY2C820MPD9", "electrolytic").body.h, 25);
  assert.equal(look("UCY2C820MPD", "electrolytic").body.h, 30.5);
  // typed short: several cases, no size until it says which
  const short = look("UCY2C820", "electrolytic");
  assert.equal(short.known, false); assert.match(short.text, /several cases/);
  // Panasonic: the S / L suffix is another case
  assert.deepEqual([look("EEU-FC0J152", "electrolytic").body.d, look("EEU-FC0J152S", "electrolytic").body.d], [10, 12.5]);
  // snap-ins: the size letters of the Nichicon number
  const s = look("LGL2G221MELZ30", "electrolytic", { v: 400 });
  assert.equal(s.fp, "SNAPIN-D22"); assert.equal(s.body.h, 30);
  assert.equal(look("LGL2G221MELA25", "electrolytic").fp, "SNAPIN-D25");
  // a size written in the number (Rubycon), any maker
  const rb = look("50ZLH100MEFC8X11.5", "electrolytic");
  assert.equal(rb.fp, "RADIAL-D8-P3.5"); assert.equal(rb.body.h, 11.5);
  // screw-terminal cans stay on the chassis
  assert.equal(look("LNR2G102MSE", "electrolytic").known, false);
});

test("semiconductors and ICs: the package their order code names", () => {
  const cases = [["MMBT3904LT1G", "npn", "SOT-23"], ["2N7002", "nmos", "SOT-23"], ["IRF540NSTRLPBF", "nmos", "D2PAK"], ["1N4148W-7-F", "diode", "SOD-123"], ["LL4148", "diode", "MINIMELF"], ["US1M", "diode", "SMA"],
    ["LM317T", "reg", "TO-220"], ["LM317LZ", "reg", "TO-92"], ["LM317MDT", "reg", "DPAK"], ["L7805CD2T-TR", "reg", "D2PAK"], ["LM317EMP", "reg", "SOT-223"], ["TL431AIDBZR", "tl431", "SOT-23"], ["TL431ACLP", "tl431", "TO-92"]];
  cases.forEach(([pn, type, pkg]) => assert.equal(look(pn, type).pkg, pkg, pn));
  assert.equal(look("NE5532P", "opamp", { model: "NE5532" }).pkg, "DIP-8");
  assert.equal(look("NE5532DR", "opamp", { model: "NE5532" }).pkg, "SOIC-8");
  assert.equal(look("TL074CN", "opamp", { model: "TL074" }).pkg, "DIP-14");
  assert.equal(look("OPA2134UA", "opamp", { model: "OPA2134" }).pkg, "SOIC-8");
  assert.equal(look("NE555P", "timer555").pkg, "DIP-8");
  assert.equal(look("LM386M-1", "chipamp", { model: "LM386" }).pkg, "SOIC-8");
  assert.equal(look("BC547B", "npn").known, false);
  assert.equal(P.footprintFor(look("MMBT3904", "npn"), ["TO-92-EBC", "SOT-23-BEC", "SOT-89-BCE"]), "SOT-23-BEC");
  assert.equal(look("", "resistor"), null);
});

const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const netlist = pn => ({
  names: { 0: "GND" },
  parts: [
    part("r1", "resistor", "R1", { r: 10e3, w: "0.25", partno: pn.r1 || "" }, { 1: 1, 2: 0 }),
    part("c1", "electrolytic", "C1", { c: 100e-6, partno: pn.c1 || "" }, { "+": 1, "-": 0 }),
    part("c2", "capacitor", "C2", { c: 100e-9, partno: pn.c2 || "" }, { 1: 1, 2: 0 }),
    part("a1", "opamp", "DA1.1", { model: "NE5532", partno: pn.a1 || "" }, { "+": 1, "-": 2, out: 2, "V+": 3, "V-": 0 })
  ]
});

test("the board takes the footprint a part number names, once per new number", () => {
  const board = B.newBoard();
  B.sync(board, netlist({ r1: "PR02000201002JA100", c1: "UKW1H101MPD", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" }));
  const fp = ref => Object.values(board.parts).find(p => p.ref === ref).fp;
  assert.equal(fp("R1"), "AXIAL-15.24");
  assert.equal(fp("C1"), "RADIAL-D8-P3.5");
  assert.equal(fp("C2"), "CHIP-0805");
  assert.equal(fp("DA1"), "SOIC-8");
  // picked by hand afterwards: stays while the number stays
  const r1 = Object.values(board.parts).find(p => p.ref === "R1");
  r1.fp = "AXIAL-20.32";
  assert.deepEqual(B.applyPartNumbers(board, netlist({ r1: "PR02000201002JA100", c1: "UKW1H101MPD", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" })), []);
  assert.equal(r1.fp, "AXIAL-20.32");
  // a new number moves it again
  const done = B.applyPartNumbers(board, netlist({ r1: "MFR-25FBF52-10K", c1: "UKW1H101MPD", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" }));
  assert.deepEqual(done.map(d => d.ref), ["R1"]);
  assert.equal(r1.fp, "AXIAL-10.16");
  // the SMD checkbox's two sides: the chip, and back to the through-hole default
  const g = B.physicalParts(netlist({ c2: "GRM21BR71H104KA01L" })).find(x => x.ref === "C2");
  assert.equal(g.smdFp, "CHIP-0805"); assert.ok(!B.isSmd(g.defaultFp));
});

test("silkscreen, holes and 3D follow the real body; a size set by hand goes over it", () => {
  const nl = netlist({ c1: "UKW1H101MPD", r1: "PR02000201002JA100" }), board = B.newBoard();
  B.sync(board, nl); board.outline = { w: 80, h: 50, r: 0 };
  let x = 15; Object.values(board.parts).forEach(p => { p.x = x; p.y = 25; x += 20; });
  const M = B.model(board, nl), c1 = M.parts.find(g => g.ref === "C1"), r1 = M.parts.find(g => g.ref === "R1");
  assert.equal(c1.fp.silk[0].r, 4);
  assert.deepEqual(c1.fp.body, { d: 8, h: 11.5, lead: 0.6 });
  const can = D3.partBodies(c1, 1.6, {})[0], zs = can.verts.map(v => v[2]);
  assert.ok(Math.abs(Math.max(...zs) - (1.6 + 11.5 - 0.4)) < 1e-6, "can height from the part number");
  const rect = r1.fp.silk.find(s => s.t === "rect");
  assert.deepEqual([rect.w, rect.h], [10, 3.9]);
  // the drill takes a thicker lead (0.78 mm needs 1.1; the 15.24 pitch has 1.2 already)
  assert.equal(r1.fp.pads[0].drill, 1.2);
  assert.equal(B.footprint("AXIAL-7.62", null, { lead: 1 }).pads[0].drill, 1.3);
  // set by hand: a taller can
  board.parts[c1.key].body = { h: 20 };
  const c1b = B.model(board, nl).parts.find(g => g.ref === "C1");
  assert.deepEqual(c1b.fp.body, { d: 8, h: 20, lead: 0.6 });
  assert.deepEqual(D3.standardBody("RADIAL-D8-P3.5"), { kind: "can", d: 8, h: 12 });
  // no number, no size: the footprints as before
  assert.equal(B.footprint("AXIAL-10.16").body, undefined);
  assert.deepEqual(B.footprint("AXIAL-10.16").silk, B.footprint("AXIAL-10.16", null, null).silk);
});

test("the BOM's Package column says what the number is, and where it disagrees", () => {
  const comps = netlist({ c1: "UKW1H101MPD", r1: "MFR-25FBF52-10K" }).parts.map(p => ({ ...p, params: { ...p.params, ...(p.id === "c1" ? { c: 47e-6 } : {}) } }));
  const rows = BOM.build(comps, {});
  const c1 = rows.find(r => r.refs === "C1"), r1 = rows.find(r => r.refs === "R1"), c2 = rows.find(r => r.refs === "C2");
  assert.match(c1.pkg, /Nichicon UKW · radial Ø8 × 11\.5 mm.*100 µF part, the schematic has 47 µF/);
  assert.match(r1.pkg, /^Yageo MFR-25 · axial Ø2\.4 × 6\.3 mm/);
  assert.equal(c2.pkg, "");
  assert.ok(BOM.toCsv({ rows, title: "", docno: "", rev: "", date: "" }).split("\r\n")[0].endsWith(",Package"));
});

test("the part a number names is saved with the circuit and read back over the tables", () => {
  const c = { type: "electrolytic", params: { c: 100e-6, partno: "UKW1H101MPD" } };
  assert.equal(P.keep(c), true);
  assert.deepEqual(c.params.part, { no: "UKW1H101MPD", maker: "Nichicon UKW", text: "radial Ø8 × 11.5 mm, 3.5 mm spacing, 50 V 100 µF", fp: "RADIAL-D8-P3.5", body: { kind: "radial", d: 8, h: 11.5, lead: 0.6 } });
  assert.equal(P.keep(c), false, "nothing to do while the number stays");
  // through a file: the saved record wins over the tables (here a record from another table)
  const saved = JSON.parse(JSON.stringify(c));
  saved.params.part.body.h = 12; saved.params.c = 47e-6;
  const r = P.resolve(saved.params, "electrolytic");
  assert.equal(r.saved, true); assert.equal(r.body.h, 12);
  assert.match(r.warn[0], /47 µF/, "the disagreements are worked out afresh");
  // the board reads it too
  const g = B.physicalParts({ names: {}, parts: [{ id: "c1", type: "electrolytic", label: "C1", params: { ...L.LIB.electrolytic.defaults, ...saved.params }, pins: [{ id: "+", net: 1 }, { id: "-", net: 0 }] }] })[0];
  assert.equal(g.body.h, 12); assert.equal(g.mpnFp, "RADIAL-D8-P3.5");
  // a new number replaces the record; an unknown or empty one removes it
  c.params.partno = "EEU-FC1H101"; assert.equal(P.keep(c), true); assert.equal(c.params.part.maker, "Panasonic FC");
  c.params.partno = "XYZ123"; assert.equal(P.keep(c), true); assert.equal(c.params.part, undefined);
  c.params.partno = ""; assert.equal(P.keep(c), false);
});
