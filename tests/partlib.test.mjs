/**
 * The user's parts library (part-lib.js, kicad-import.js readSymbols / readFootprint, cad-components.js
 * LIB.part, board-core.js): KiCad symbols and footprints as library parts, a part on the sheet and
 * on the board, its SPICE model, the library file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "kicad-import.js", "part-lib.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, P = globalThis.PartLib, K = globalThis.KicadImport, B = globalThis.BoardCore;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const SYM = fixture("testparts.kicad_sym"), FP = fixture("DIP-8_TEST.kicad_mod"), AMP = fixture("testamp.lib");
const library = () => { const lib = P.empty(), fp = P.footprint(FP, "DIP-8_TEST.kicad_mod"); P.add(lib, P.symbols(SYM, "testparts.kicad_sym").map(s => s.read()), { [fp.name]: fp }); return lib; };

test("a KiCad symbol library: its parts, their units and pins; a derived symbol takes its parent's drawing; power symbols are left", () => {
  const list = P.symbols(SYM, "lib/testparts.kicad_sym");
  assert.deepEqual(list.map(s => s.name), ["TESTAMP", "DUALAMP", "DUALAMP-LN"]);
  const amp = list[0].read(), dual = list[1].read(), ln = list[2].read();
  assert.equal(amp.prefix, "DA"); assert.equal(amp.units.length, 1); assert.equal(amp.src, "KiCad: testparts");
  assert.equal(amp.datasheet, "https://example.com/TESTAMP.pdf");
  // 2.54 mm is 20 on the sheet; KiCad's y runs up
  const pin = (u, num) => u.pins.find(p => p.num === num);
  assert.deepEqual([pin(amp.units[0], "3").x, pin(amp.units[0], "3").y, pin(amp.units[0], "3").name], [-60, -20, "+"]);
  assert.deepEqual([pin(amp.units[0], "7").x, pin(amp.units[0], "7").y], [-20, -60]);
  assert.equal(pin(amp.units[0], "6").name, "", "an unnamed pin (~) has no name");
  assert.deepEqual(dual.units.map(u => u.pins.map(p => p.num).join(",")), ["1,2,3", "5,6,7", "8,4"]);
  assert.deepEqual(ln.units.map(u => u.pins.length), [3, 3, 2]); assert.equal(ln.desc, "The low-noise version"); assert.equal(ln.fpHint, "Test:DIP-8_TEST");
  assert.throws(() => P.symbols(FP), /not a KiCad symbol library/);
});

test("a KiCad footprint file: pads, drills, silkscreen and the courtyard as its box", () => {
  const f = P.footprint(FP, "x/DIP-8_TEST.kicad_mod");
  assert.equal(f.name, "DIP-8_TEST"); assert.equal(f.pads.length, 8); assert.ok(!f.smd);
  assert.deepEqual(f.pads.map(p => p.num).join(""), "12345678");
  assert.deepEqual([f.pads[0].shape, f.pads[0].drill, f.pads[4].x, f.pads[4].y], ["rect", 0.8, 7.62, 7.62]);
  assert.deepEqual(f.box, [-1.1, -1.55, 8.7, 9.15]); assert.equal(f.silk.length, 2);
  assert.throws(() => P.footprint(SYM), /not a KiCad footprint/);
});

test("a part takes the footprint its symbol names or its filters allow; the others that have its pads are offered", () => {
  const lib = library(), by = n => lib.parts.find(p => p.name === n);
  assert.equal(by("TESTAMP").fp, "DIP-8_TEST", "named by the symbol");
  assert.equal(by("DUALAMP").fp, "DIP-8_TEST", "allowed by its filter DIP*TEST*");
  assert.deepEqual(P.fits(by("DUALAMP"), lib.footprints), ["DIP-8_TEST"]);
  assert.deepEqual(P.unmatched(by("DUALAMP"), lib.footprints["DIP-8_TEST"]), []);
  // a footprint of three pads does not fit, and says which pins it lacks
  const small = { name: "SIP-3", pads: [1, 2, 3].map(n => ({ num: String(n), name: String(n), x: n * 2.54, y: 0, shape: "circle", w: 1.6, h: 1.6, drill: 0.8 })), silk: [], holes: [], box: [0, -1, 9, 1] };
  P.add(lib, [], { "SIP-3": small });
  assert.ok(!P.fits(by("TESTAMP"), lib.footprints).includes("SIP-3"));
  assert.deepEqual(P.unmatched(by("TESTAMP"), small), ["7", "4", "6"]);
  assert.deepEqual(P.unused(lib), ["SIP-3"]);
  // the same part again replaces it and keeps what was set on it
  by("TESTAMP").spice = { text: AMP, sub: "TESTAMP", map: ["3", "2", "7", "4", "6"] };
  const again = P.symbols(SYM)[0].read(); P.add(lib, [again], {});
  assert.equal(lib.parts.filter(p => p.name === "TESTAMP").length, 1); assert.equal(by("TESTAMP").spice.sub, "TESTAMP"); assert.equal(by("TESTAMP").id, "testamp");
});

test("the library as a file and back; other files are refused", () => {
  const lib = library(), back = P.fromFile(P.toFile(lib, "mine"));
  assert.deepEqual(back, lib);
  assert.throws(() => P.fromFile("{}"), /not a parts library/); assert.throws(() => P.fromFile("(kicad_pcb)"), /not a parts library/);
  assert.throws(() => P.fromFile(JSON.stringify({ format: P.FORMAT, version: 99, parts: [] })), /newer version/);
});

const comp = (lib, name, unit, id, label) => ({ id, type: "part", label, rot: 0, x: 0, y: 0, params: P.params(lib, lib.parts.find(p => p.name === name), unit) });
test("a library part on the sheet: its unit's pins and box, its designator's letters, its pads' numbers", () => {
  const lib = library(), def = L.LIB.part, c = comp(lib, "DUALAMP", 2, "a", "DA1.2");
  assert.deepEqual(def.pins(c).map(p => p.id), ["5", "6", "7"]);
  assert.deepEqual(def.pinNumbers(c), { 5: "5", 6: "6", 7: "7" });
  assert.equal(def.prefixFor(c), "DA"); assert.equal(def.value(c), "DUALAMP");
  const b = def.bbox(c); assert.ok(b[0] <= -60 && b[2] >= 60);
  c.params.unit = "3"; assert.deepEqual(def.pins(c).map(p => p.id), ["8", "4"], "the inspector's Unit list gives a string");
  assert.match(def.info(c), /left out of the simulation/);
  // a part of the palette's defaults (no drawing) still has a box
  assert.deepEqual(def.bbox({ params: def.defaults }), [-20, -20, 20, 20]);
});

test("on the board: the units of one package share its own footprint, every pin on the pad of its number", () => {
  const lib = library();
  const part = (c, nets) => ({ id: c.id, type: "part", label: c.label, params: c.params, pins: L.LIB.part.pins(c).map(q => ({ id: q.id, net: nets[q.id] || `${c.id}${q.id}` })) });
  const netlist = { parts: [part(comp(lib, "DUALAMP", 1, "a", "DA1.1"), { 1: "OUT", 2: "OUT" }), part(comp(lib, "DUALAMP", 2, "b", "DA1.2"), {}), part(comp(lib, "DUALAMP", 3, "c", "DA1.3"), { 8: "VP", 4: "VN" })] };
  const groups = B.physicalParts(netlist);
  assert.equal(groups.length, 1); assert.equal(groups[0].ref, "DA1"); assert.deepEqual(groups[0].options, ["LIB:DIP-8_TEST", "WIRE-8"]);
  const board = B.newBoard(); B.sync(board, netlist);
  const m = B.model(board, netlist), nets = Object.fromEntries(m.pads.map(p => [p.num, p.net]));
  assert.equal(m.pads.length, 8);
  assert.equal(nets[1], nets[2]); assert.notEqual(nets[1], nets[3]); assert.notEqual(nets[8], nets[4]);
  assert.ok(m.pads.every(p => p.net), "every pad has its net");
  // without a footprint of its own: a DIP its pins fit
  const bare = comp(lib, "TESTAMP", 1, "d", "DA2"); bare.params.fp = null;
  assert.deepEqual(B.physicalParts({ parts: [part(bare, {})] })[0].options, ["DIP-8", "WIRE-5"]);
});

test("a library part with a SPICE model is simulated by it: a ×11 amplifier", () => {
  const lib = library(); lib.parts.find(p => p.name === "TESTAMP").spice = { text: AMP, sub: "TESTAMP", map: ["3", "2", "7", "4", "6"] };
  const c = comp(lib, "TESTAMP", 1, "u", "DA1"), nodes = { 3: 1, 2: 2, 7: 3, 4: 4, 6: 5 }; let n = 6;
  const els = [{ id: "vp", kind: "V", nodes: [3, 0], v: 15 }, { id: "vn", kind: "V", nodes: [4, 0], v: -15 }, { id: "vi", kind: "V", nodes: [1, 0], v: 0.1 },
    { id: "r1", kind: "R", nodes: [5, 2], r: 10e3 }, { id: "r2", kind: "R", nodes: [2, 0], r: 1e3 }];
  L.LIB.part.build(c, pin => nodes[pin], () => n++, els);
  assert.ok(els.length > 5, "the model's elements are there");
  const res = E.simulate({ nodeCount: n, elements: els }, {});
  assert.ok(res.ok, res.error);
  assert.ok(Math.abs(res.dc.nodes[5] - 1.1) < 0.005, `out ${res.dc.nodes[5]}`);
  assert.match(L.LIB.part.info(c), /Simulated by its SPICE subcircuit TESTAMP/i);
  // without a model it adds nothing
  const bare = comp(library(), "TESTAMP", 1, "v", "DA2"), none = []; L.LIB.part.build(bare, () => 1, () => 2, none); assert.equal(none.length, 0);
});

test("a box from a list of pins: round the box as on a DIP, or on the sides asked for; pins on the sheet's grid", () => {
  const list = P.pinList("1 OUT\n2 IN-\n3 IN+\n4 V-\n5 NC\n6 NC\n7 NC\n8 V+"), s = P.boxSymbol(list);
  assert.deepEqual(list[1], { num: "2", name: "IN-", side: undefined });
  const at = n => { const p = s.pins.find(q => q.num === n); return [p.x, p.y, p.a]; };
  assert.deepEqual(at("1"), [-50, -30, 0]); assert.deepEqual(at("4"), [-50, 30, 0]);
  assert.deepEqual(at("5"), [50, 30, 180], "pin 5 opposite pin 4"); assert.deepEqual(at("8"), [50, -30, 180], "pin 8 opposite pin 1");
  assert.ok(s.pins.every(p => p.x % 10 === 0 && p.y % 10 === 0 && p.id === p.num));
  assert.deepEqual(s.box, [-52, -52, 52, 52]);
  const t = P.boxSymbol(P.pinList("1 IN left\n2 GND bottom\n3 OUT right\n4 VCC top"));
  assert.deepEqual(t.pins.map(p => [p.num, p.x, p.y, p.a]), [["1", -50, 0, 0], ["3", 50, 0, 180], ["4", 0, -50, 270], ["2", 0, 50, 90]]);
  // every pin's inner end is on the body's edge
  const body = t.g[0], x1 = body[2], y1 = body[3], x2 = body[4], y2 = body[7];
  t.pins.forEach(p => { const [ex, ey] = P.pinEnd(p); assert.ok(ex === x1 || ex === x2 || ey === y1 || ey === y2, `pin ${p.num} ends at ${ex},${ey}`); });
});

test("a drawing put in order: ids from the numbers, a repeated number said, the box measured again", () => {
  const s = { g: [["c", 0, 0, 0, 30], ["t", 0, 50, 10, "X"]], pins: [{ num: " 1 ", x: -52, y: 3, a: 0, l: 20 }, { num: "1", x: 50, y: 0, a: 45, l: 20 }, { name: "K", x: 0, y: 60, a: 90, l: 10 }] };
  assert.deepEqual(P.tidy(s), ["Pin number 1 is used twice"]);
  assert.deepEqual(s.pins.map(p => [p.id, p.x, p.y, p.a]), [["1", -50, 0, 0], ["1#2", 50, 0, 0], ["K", 0, 60, 90]]);
  assert.deepEqual(s.box, [-52, -32, 72, 62]);
  assert.deepEqual(P.tidy({ g: [], pins: [] }), ["The drawing has no pins"]);
  // a part drawn here is a library part like any other
  const lib = P.empty(); P.add(lib, [P.blank("Mine", "DA", P.boxSymbol(P.pinList("1 A\n2 B")))], {});
  const c = { id: "m", type: "part", label: "DA1", params: P.params(lib, lib.parts[0], 1) };
  assert.deepEqual(L.LIB.part.pins(c).map(p => [p.id, p.name]), [["1", "A"], ["2", "B"]]);
  assert.equal(lib.parts[0].src, "drawn here");
});

test("the usual packages as footprints: centred, pad 1 top left, counted anticlockwise; surface pads make it SMD", () => {
  const dip = P.fpPattern("dip", { n: 8 }, "D8");
  assert.deepEqual(dip.pads.map(p => [p.num, p.x, p.y]), [["1", -3.81, -3.81], ["2", -3.81, -1.27], ["3", -3.81, 1.27], ["4", -3.81, 3.81], ["5", 3.81, 3.81], ["6", 3.81, 1.27], ["7", 3.81, -1.27], ["8", 3.81, -3.81]]);
  assert.equal(dip.pads[0].shape, "rect"); assert.equal(dip.pads[1].shape, "circle"); assert.equal(dip.pads[0].drill, 0.8); assert.ok(!dip.smd);
  assert.deepEqual(dip.box.map((v, i) => v + dip.box[(i + 2) % 4]), [0, 0, 0, 0], "centred");
  const so = P.fpPattern("soic", { n: 14, pitch: "1,27", row: 5.4 }, "SO14");
  assert.equal(so.pads.length, 14); assert.ok(so.smd && so.pads.every(p => p.smd && !p.drill && p.shape === "rect" && p.w > p.h));
  assert.deepEqual([so.pads[0].x, so.pads[0].y, so.pads[7].x, so.pads[7].y], [-2.7, -3.81, 2.7, 3.81]);
  const q = P.fpPattern("quad", { n: 30 }, "Q");
  assert.equal(q.pads.length, 32, "a multiple of four"); assert.deepEqual([q.pads[0].x, q.pads[8].y, q.pads[16].x, q.pads[24].y], [-4.2, 4.2, 4.2, -4.2]);
  assert.equal(P.fpPattern("sip", { n: 5 }, "S").pads.map(p => p.x).join(), "-5.08,-2.54,0,2.54,5.08");
  assert.equal(P.fpPattern("two", { pitch: 7.5, drill: 0 }, "T").smd, true);
});

test("a footprint put in order: numbers rounded, its box measured, what is wrong said; a new name is followed by its parts", () => {
  const f = { name: " MINE ", pads: [{ num: 1, x: 0.00049, y: 0, shape: "rect", w: 2, h: 1, drill: 0, back: true }, { num: "2", x: 5, y: 0, w: 1, h: 1, drill: 0.9 }], silk: [{ t: "line", x1: 1, y1: 1, x2: 1, y2: 1 }, { t: "circle", x: 0, y: -3, r: 0.5 }], holes: [{ x: 0, y: 4, d: 3 }] };
  const why = P.fpTidy(f);
  assert.equal(f.name, "MINE"); assert.equal(f.title, "MINE");
  assert.deepEqual(f.pads[0], { num: "1", name: "1", x: 0, y: 0, shape: "rect", w: 2, h: 1, drill: 0, smd: true, back: true });
  assert.equal(f.silk.length, 1, "a line of no length is dropped"); assert.ok(!f.smd, "one drilled pad: not SMD");
  assert.deepEqual(f.box, [-1.75, -3.5, 5.75, 5.75]);
  assert.equal(why.length, 1); assert.match(why[0], /pad 2 leaves no copper/);
  assert.deepEqual(P.fpTidy({ name: "", pads: [] }), ["The footprint has no name", "The footprint has no pads"]);
  const lib = library(), amp = lib.parts.find(p => p.name === "TESTAMP");
  amp.fp = "DIP-8_TEST";
  const g = structuredClone(lib.footprints["DIP-8_TEST"]); g.name = "DIP-8_MINE"; P.fpStore(lib, g, "DIP-8_TEST");
  assert.equal(amp.fp, "DIP-8_MINE"); assert.ok(!lib.footprints["DIP-8_TEST"] && lib.footprints["DIP-8_MINE"]);
});

test("a footprint made for a part's pins goes to the board: every pin on the pad of its number", () => {
  const lib = library(), amp = lib.parts.find(p => p.name === "TESTAMP");
  const f = P.fpFor(amp, "AMP-FP");
  assert.deepEqual(P.unmatched(amp, f), []);
  P.fpStore(lib, f, ""); amp.fp = f.name;
  const c = comp(lib, "TESTAMP", 1, "a", "DA1"), netlist = { parts: [{ id: c.id, type: "part", label: c.label, params: c.params, pins: L.LIB.part.pins(c).map(q => ({ id: q.id, net: `N${q.id}` })) }] };
  assert.equal(B.physicalParts(netlist)[0].options[0], "LIB:AMP-FP");
  const board = B.newBoard(); B.sync(board, netlist);
  const m = B.model(board, netlist);
  assert.equal(m.pads.length, f.pads.length); assert.ok(m.pads.every(p => p.net === `N${p.num}`));
});
