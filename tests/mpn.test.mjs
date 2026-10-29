/**
 * Manufacturer part numbers (mpn.js): what a number typed in the BOM says about the real part,
 * and what follows on the board: the footprint it names, the silkscreen and holes to its body,
 * the 3D model's size, a size set by hand over it, and the BOM's Package column (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "mpn.js", "mpn-online.js", "board-core.js", "board-3d.js", "pdf-export.js", "bom.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const P = globalThis.PartNo, PS = globalThis.PartSearch, B = globalThis.BoardCore, L = globalThis.CadLib, D3 = globalThis.Board3D, BOM = globalThis.BomLib;
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

test("electrolytics: only a size written in the number; the rest is looked up", () => {
  const rb = look("50ZLH100MEFC8X11.5", "electrolytic");
  assert.equal(rb.fp, "RADIAL-D8-P3.5"); assert.equal(rb.body.h, 11.5);
  const u = look("UKW1H101MPD", "electrolytic");
  assert.equal(u.known, false); assert.match(u.text, /Look up/);
});

// what DigiKey's product details say, in its own words
const dk = {
  ukw: { pkg: "Radial, Can", size: '0.315" Dia (8.00mm)', height: '0.492" (12.50mm)', lead: '0.138" (3.50mm)', mount: "Through Hole", voltage: "50 V", capacitance: "100 µF", maker: "Nichicon", series: "UKW", source: "DigiKey" },
  snap: { pkg: "Radial, Can - Snap-In", size: '0.866" Dia (22.00mm)', height: '1.181" (30.00mm)', lead: '0.394" (10.00mm)', mount: "Through Hole", voltage: "400 V", maker: "Nichicon", series: "LGL" },
  mfr: { pkg: "Axial", size: '0.091" Dia x 0.248" L (2.30mm x 6.30mm)', power: "0.25W, 1/4W", maker: "YAGEO", series: "MFR" },
  chip: { pkg: "0805 (2012 Metric)", maker: "Murata Electronics", series: "GRM" },
  box: { pkg: "Radial", size: '0.283" L x 0.157" W (7.20mm x 4.00mm)', height: '0.256" (6.50mm)', lead: '0.197" (5.00mm)', voltage: "63V" },
  disc: { pkg: "Radial, Disc", size: '0.217" Dia (5.50mm)', lead: '0.197" (5.00mm)' },
  dip: { pkg: '8-DIP (0.300", 7.62mm)', device: "8-PDIP" }, soic: { pkg: '8-SOIC (0.154", 3.90mm Width)', device: "8-SOIC" }, to220: { pkg: "TO-220-3", device: "TO-220AB" }
};

test("what a parts database says becomes the footprint and the body", () => {
  const u = P.fromSpecs(dk.ukw, "electrolytic", { c: 100e-6, v: 50 });
  assert.equal(u.fp, "RADIAL-D8-P3.5"); assert.deepEqual([u.body.d, u.body.h], [8, 12.5]);
  assert.equal(u.maker, "Nichicon UKW"); assert.deepEqual(u.warn, []);
  const w = P.fromSpecs(dk.ukw, "electrolytic", { c: 47e-6, v: 63 }).warn;
  assert.equal(w.length, 2); assert.match(w.join(), /47 µF/); assert.match(w.join(), /63 V/);
  const s = P.fromSpecs(dk.snap, "electrolytic", { v: 400 });
  assert.equal(s.fp, "SNAPIN-D22"); assert.equal(s.body.h, 30);
  const r = P.fromSpecs(dk.mfr, "resistor", { w: "0.5" });
  assert.equal(r.fp, "AXIAL-10.16"); assert.deepEqual([r.body.d, r.body.l], [2.3, 6.3]); assert.match(r.warn[0], /1\/4 W/);
  assert.equal(P.fromSpecs(dk.chip, "capacitor").fp, "CHIP-0805");
  const b = P.fromSpecs(dk.box, "capacitor");
  assert.equal(b.fp, "BOX-5"); assert.deepEqual([b.body.l, b.body.w, b.body.h], [7.2, 4, 6.5]);
  assert.equal(P.fromSpecs(dk.disc, "capacitor").fp, "DISC-5.08");
  assert.equal(P.fromSpecs(dk.dip, "opamp").pkg, "DIP-8");
  assert.equal(P.fromSpecs(dk.soic, "opamp").pkg, "SOIC-8");
  assert.equal(P.fromSpecs(dk.to220, "nmos").pkg, "TO-220");
  assert.equal(P.fromSpecs({ pkg: "Radial, Can" }, "electrolytic").known, false);
});

// a stand-in for DigiKey's API: the token, then the product details (404 for an unknown number)
function fakeDigiKey(products) {
  const calls = [];
  const f = async (url, opts) => {
    calls.push([url, opts]);
    const ok = (j, status) => ({ ok: !status, status: status || 200, json: async () => j });
    if (url.endsWith("/v1/oauth2/token")) return /client_id=id/.test(opts.body) && /client_secret=secret/.test(opts.body) ? ok({ access_token: "tok", expires_in: 599 }) : ok({}, 401);
    assert.equal(opts.headers.Authorization, "Bearer tok"); assert.equal(opts.headers["X-DIGIKEY-Client-Id"], "id");
    const m = /search\/([^/]+)\/productdetails$/.exec(url);
    if (m) { const p = products[decodeURIComponent(m[1])]; return p ? ok({ Product: p }) : ok(null, 404); }
    if (url.endsWith("/search/keyword")) return ok({ ExactMatches: [], Products: Object.values(products).filter(p => p.ManufacturerProductNumber.startsWith(JSON.parse(opts.body).Keywords)) });
    return ok(null, 404);
  };
  f.calls = calls; return f;
}
const params = sp => Object.entries({ "Package / Case": sp.pkg, "Size / Dimension": sp.size, "Height - Seated (Max)": sp.height, "Lead Spacing": sp.lead, "Mounting Type": sp.mount, "Voltage - Rated": sp.voltage, Capacitance: sp.capacitance }).filter(([, v]) => v).map(([ParameterText, ValueText]) => ({ ParameterText, ValueText }));

test("Look up asks DigiKey with the user's key and saves what it says with the part", async () => {
  globalThis.localStorage = (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); } }; })();
  const f = fakeDigiKey({ UKW1H101MPD: { ManufacturerProductNumber: "UKW1H101MPD", Manufacturer: { Name: "Nichicon" }, Series: { Name: "UKW" }, ProductUrl: "https://www.digikey.com/x", Parameters: params(dk.ukw) } });
  const c = { type: "electrolytic", params: { c: 100e-6, v: 25, partno: "UKW1H101MPD" } };
  assert.equal(PS.ready(), false);
  await assert.rejects(PS.lookUp(c, f), /DigiKey key/);
  PS.setConfig("id", "wrong");
  await assert.rejects(PS.lookUp(c, f), /refused the key/);
  PS.setConfig(" id ", "secret");
  const r = await PS.lookUp(c, f);
  assert.equal(r.fp, "RADIAL-D8-P3.5");
  assert.equal(c.params.part.source, "DigiKey"); assert.equal(c.params.part.url, "https://www.digikey.com/x");
  assert.deepEqual(c.params.part.body, { kind: "radial", d: 8, h: 12.5, lead: c.params.part.body.lead });
  assert.ok(!JSON.stringify(c.params.part).includes("secret"), "the key never goes in the file");
  // the token is reused
  const tokens = () => f.calls.filter(([u]) => u.endsWith("/token")).length, before = tokens();
  await PS.lookUp(c, f); assert.equal(tokens(), before);
  // a number DigiKey doesn't know
  await assert.rejects(PS.lookUp({ type: "electrolytic", params: { partno: "NOPE1" } }, f), /doesn't list NOPE1/);
  // through the file: keep() leaves it alone, resolve() reads it, the warnings worked out afresh
  const saved = JSON.parse(JSON.stringify(c));
  assert.equal(P.keep(saved), false);
  saved.params.c = 47e-6;
  const res = P.resolve(saved.params, "electrolytic");
  assert.equal(res.saved, true); assert.equal(res.source, "DigiKey"); assert.equal(res.body.h, 12.5);
  assert.match(res.warn.join(), /47 µF/);
  // the board reads it too
  const g = B.physicalParts({ names: {}, parts: [{ id: "c1", type: "electrolytic", label: "C1", params: { ...L.LIB.electrolytic.defaults, ...saved.params }, pins: [{ id: "+", net: 1 }, { id: "-", net: 0 }] }] })[0];
  assert.equal(g.body.h, 12.5); assert.equal(g.mpnFp, "RADIAL-D8-P3.5");
  // a new number drops the record
  saved.params.partno = "XYZ123"; assert.equal(P.keep(saved), true); assert.equal(saved.params.part, undefined);
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
  B.sync(board, netlist({ r1: "PR02000201002JA100", c1: "50ZLH100MEFC8X11.5", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" }));
  const fp = ref => Object.values(board.parts).find(p => p.ref === ref).fp;
  assert.equal(fp("R1"), "AXIAL-15.24");
  assert.equal(fp("C1"), "RADIAL-D8-P3.5");
  assert.equal(fp("C2"), "CHIP-0805");
  assert.equal(fp("DA1"), "SOIC-8");
  // picked by hand afterwards: stays while the number stays
  const r1 = Object.values(board.parts).find(p => p.ref === "R1");
  r1.fp = "AXIAL-20.32";
  assert.deepEqual(B.applyPartNumbers(board, netlist({ r1: "PR02000201002JA100", c1: "50ZLH100MEFC8X11.5", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" })), []);
  assert.equal(r1.fp, "AXIAL-20.32");
  // a new number moves it again
  const done = B.applyPartNumbers(board, netlist({ r1: "MFR-25FBF52-10K", c1: "50ZLH100MEFC8X11.5", c2: "GRM21BR71H104KA01L", a1: "NE5532DR" }));
  assert.deepEqual(done.map(d => d.ref), ["R1"]);
  assert.equal(r1.fp, "AXIAL-10.16");
  // the SMD checkbox's two sides: the chip, and back to the through-hole default
  const g = B.physicalParts(netlist({ c2: "GRM21BR71H104KA01L" })).find(x => x.ref === "C2");
  assert.equal(g.smdFp, "CHIP-0805"); assert.ok(!B.isSmd(g.defaultFp));
});

test("silkscreen, holes and 3D follow the real body; a size set by hand goes over it", () => {
  const nl = netlist({ c1: "50ZLH100MEFC8X11.5", r1: "PR02000201002JA100" }), board = B.newBoard();
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
  // C1 looked up in DigiKey earlier (its record saved with the part)
  const rec = P.record("UKW1H101MPD", P.fromSpecs(dk.ukw, "electrolytic", {}), { source: "DigiKey", specs: dk.ukw });
  const comps = netlist({ c1: "UKW1H101MPD", r1: "MFR-25FBF52-10K" }).parts.map(p => ({ ...p, params: { ...p.params, ...(p.id === "c1" ? { c: 47e-6, part: rec } : {}) } }));
  const rows = BOM.build(comps, {});
  const c1 = rows.find(r => r.refs === "C1"), r1 = rows.find(r => r.refs === "R1"), c2 = rows.find(r => r.refs === "C2");
  assert.match(c1.pkg, /Nichicon UKW · radial Ø8 × 12\.5 mm.*100 µF part, the schematic has 47 µF/);
  assert.match(r1.pkg, /^Yageo MFR-25 · axial Ø2\.4 × 6\.3 mm/);
  assert.equal(c2.pkg, "");
  assert.ok(BOM.toCsv({ rows, title: "", docno: "", rev: "", date: "" }).split("\r\n")[0].endsWith(",Package"));
});

test("an offline match is saved with the part too", () => {
  const c = { type: "resistor", params: { partno: "MFR-25FBF52-10K" } };
  assert.equal(P.keep(c), true);
  assert.equal(c.params.part.fp, "AXIAL-10.16"); assert.equal(c.params.part.maker, "Yageo MFR-25");
  assert.equal(P.keep(c), false, "nothing to do while the number stays");
  c.params.partno = ""; assert.equal(P.keep(c), true); assert.equal(c.params.part, undefined);
});
