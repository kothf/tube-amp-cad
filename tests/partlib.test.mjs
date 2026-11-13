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
