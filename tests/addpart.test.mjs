/**
 * Add part… (spice-find.js, cad-addpart.js, part-lib.js opampPackage, mpn.js): a model found by a
 * part number, what it is drawn as, the usual case and pin order of a number, a dual op-amp as a
 * library part that is simulated, and the chosen package reaching the board.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "kicad-import.js", "part-lib.js", "mpn.js", "board-core.js", "spice-find.js", "cad-addpart.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, P = globalThis.PartLib, B = globalThis.BoardCore, F = globalThis.SpiceFind, A = globalThis.CadAddPart;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const AMP = fixture("testamp.lib"), DEV = fixture("devices.lib");
const IX = F.read({ commit: "abc", files: ["Models/Maker/Some Maker/amps.lib", "Models/Transistor/bjt.lib"], names: "TL072\t0\tX5\nTL071\t0\tX5\nLM35\t0\tX3\nLM358\t0\tX5\nBC547\t1\tN\nBC547B\t1\tN\nBC547C\t1\tN\n1N4148\t1\tD\n" });

test("a part number finds its model: the name itself, the name without its ordering letters, then the names it begins", () => {
  const names = (pn, n) => F.candidates(IX, pn, n).map(c => `${c.name}:${c.why}`);
  assert.deepEqual(names("tl072cp"), ["TL072:base"]);
  assert.deepEqual(names("BC547B"), ["BC547B:exact", "BC547:base"]);
  assert.deepEqual(names("BC547"), ["BC547:exact", "BC547B:starts", "BC547C:starts"]);
  assert.deepEqual(names("LM358N"), ["LM358:base"], "an LM358N is no LM35: only letters are left out");
  assert.deepEqual(names("TL07"), ["TL071:starts", "TL072:starts"]);
  assert.deepEqual(names("XYZ999"), []); assert.deepEqual(names("TL"), []);
  assert.equal(names("BC547", 2).length, 2);
  const c = F.candidates(IX, "TL072")[0];
  assert.equal(c.kind, "X"); assert.equal(c.pins, 5);
  assert.equal(F.urlOf(IX, c), "https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/abc/Models/Maker/Some%20Maker/amps.lib");
});

test("the model's own text is cut out of its file, and says what the part is drawn as", () => {
  const amp = F.cut(AMP, "testamp");
  assert.equal(amp.sub, "TESTAMP"); assert.equal(amp.pins.length, 5); assert.equal(F.symFor(amp), "opamp");
  const q = F.cut(DEV, "QTEST"), d = F.cut(DEV, "DTEST"), m = F.cut(DEV, "MTESTP"), j = F.cut(DEV, "JTEST");
  assert.deepEqual([F.symFor(q), F.symFor(d), F.symFor(m), F.symFor(j)], ["npn", "diode", "pmos", "njf"]);
  assert.ok(!/DTEST/.test(q.text), "only the part's own lines are kept");
  assert.equal(F.symFor({ kind: "subckt", pins: ["1", "2", "3"] }), "box");
  assert.throws(() => F.cut(DEV, "NOSUCH"), /no model called NOSUCH/);
});

test("the index that ships with the app reads, and knows the everyday parts", () => {
  const ix = F.read(JSON.parse(readFileSync(new URL("../spice-index.json", import.meta.url), "utf8")));
  assert.ok(ix.names.size > 40000, `${ix.names.size} names`); assert.match(ix.commit, /^[0-9a-f]{40}$/);
  const first = pn => F.candidates(ix, pn)[0] || {};
  assert.deepEqual([first("TL072CP").name, first("TL072CP").kind, first("TL072CP").pins], ["TL072", "X", 5]);
  assert.equal(first("2N3904").kind, "N"); assert.equal(first("1N4148").kind, "D"); assert.equal(first("IRF540N").name, "IRF540N");
  assert.equal(first("LM358N").name.slice(0, 5), "LM358");
  for (const v of ix.names.values()) { assert.ok(v.file, v.name); break; }
});

test("the usual case, pin order and number of amplifiers of a part number", () => {
  assert.deepEqual(["2N3904", "BC547B", "2SC1815", "BD139", "TIP41C", "MJL3281A", "MMBT3904"].map(n => A.usualCase(n, "bjt")), ["TO-92", "TO-92", "TO-92", "TO-126", "TO-220", "TO-264", "SOT-23"]);
  assert.deepEqual(["IRF540N", "IRFP240", "2N7000", "BS170", "BSS138"].map(n => A.usualCase(n, "mos")), ["TO-220", "TO-247", "TO-92", "TO-92", "SOT-23"]);
  assert.deepEqual(["1N4148", "1N4007", "1N5408", "UF4007"].map(n => A.usualCase(n, "diode")), ["DIODE-7.62", "DIODE-10.16", "DO-201AD", "DIODE-10.16"]);
  assert.equal(A.usualOrder("2N3904", "bjt", "TO-92"), "EBC"); assert.equal(A.usualOrder("BC547B", "bjt", "TO-92"), "CBE"); assert.equal(A.usualOrder("2SC1815", "bjt", "TO-92"), "ECB");
  assert.equal(A.usualOrder("BD139", "bjt", "TO-126"), "ECB"); assert.equal(A.usualOrder("TIP41C", "bjt", "TO-220"), "BCE"); assert.equal(A.usualOrder("MMBT3904", "bjt", "SOT-23"), "BEC");
  assert.equal(A.usualOrder("IRF540N", "mos", "TO-220"), "GDS"); assert.equal(A.usualOrder("2N7000", "mos", "TO-92"), "SGD"); assert.equal(A.usualOrder("BS170", "mos", "TO-92"), "DGS");
  // every case and order offered is a footprint the board has
  for (const fam of ["bjt", "mos"]) for (const n of ["2N3904", "BC547", "BD139", "TIP41C", "IRF540", "2N7000", "BS170"]) { const k = A.usualCase(n, fam); if (k !== "SOT-23") assert.ok(B.footprint(`${k}-${A.usualOrder(n, fam, k)}`), `${n} ${fam} ${k}`); }
  assert.deepEqual(["TL071", "TL072CP", "TL074", "NE5532P", "LM358N", "LM324N", "NE5534", "OPA2134PA", "LM741"].map(A.usualAmps), [1, 2, 4, 2, 2, 4, 1, 2, 1]);
});

test("a dual and a quad op-amp as library parts: a unit per amplifier and one for the supply, the usual pins, a footprint, and both amplifiers simulated", () => {
  const { part, fp } = P.opampPackage("TESTDUAL", 2, "dip", { text: AMP, sub: "TESTAMP" });
  assert.deepEqual(part.units.map(u => u.pins.map(p => p.num).join(",")), ["3,2,1", "5,6,7", "8,4"]);
  assert.equal(fp.name, "DIP-8"); assert.equal(fp.pads.length, 8); assert.equal(part.fp, "DIP-8"); assert.equal(part.prefix, "DA");
  assert.deepEqual(P.unitMaps(part).maps, { 1: ["3", "2", "8", "4", "1"], 2: ["5", "6", "8", "4", "7"] });
  const quad = P.opampPackage("TESTQUAD", 4, "soic", { text: AMP, sub: "TESTAMP" });
  assert.deepEqual(quad.part.units.map(u => u.pins.map(p => p.num).join(",")), ["3,2,1", "5,6,7", "10,9,8", "12,13,14", "4,11"]);
  assert.equal(quad.fp.name, "SOIC-14"); assert.equal(quad.fp.smd, true); assert.equal(Object.keys(P.unitMaps(quad.part).maps).length, 4);
  // A a ×11 amplifier, B a follower of it
  const lib = P.empty(); P.add(lib, [part], { [fp.name]: fp });
  const mk = (unit, id) => ({ id, type: "part", label: "DA1." + unit, rot: 0, x: 0, y: 0, params: P.params(lib, lib.parts[0], unit) });
  const a = mk(1, "a"), b = mk(2, "b"), c = mk(3, "c"), all = [a, b, c];
  const nets = { a: { 3: 1, 2: 2, 1: 5 }, b: { 5: 5, 6: 6, 7: 6 }, c: { 8: 3, 4: 4 } }; let n = 7;
  const els = [{ id: "vp", kind: "V", nodes: [3, 0], v: 15 }, { id: "vn", kind: "V", nodes: [4, 0], v: -15 }, { id: "vi", kind: "V", nodes: [1, 0], v: 0.1 },
    { id: "r1", kind: "R", nodes: [5, 2], r: 10e3 }, { id: "r2", kind: "R", nodes: [2, 0], r: 1e3 }, { id: "rl", kind: "R", nodes: [6, 0], r: 10e3 }];
  const net = k => pin => { for (const u of [k, ...all.filter(x => x !== k)]) { const v = nets[u.id][pin]; if (v !== undefined) return v; } return undefined; };
  all.forEach(u => L.LIB.part.build(u, net(u), () => n++, els, { first: u === a }));
  const res = E.simulate({ nodeCount: n, elements: els }, {});
  assert.ok(res.ok, res.error);
  assert.ok(Math.abs(res.dc.nodes[5] - 1.1) < 0.005, `A out ${res.dc.nodes[5]}`); assert.ok(Math.abs(res.dc.nodes[6] - 1.1) < 0.005, `B out ${res.dc.nodes[6]}`);
});

test("the package chosen with the part reaches the board, with no table of part numbers behind it", () => {
  const prm = { name: "QTEST", text: F.cut(DEV, "QTEST").text, sub: "QTEST", sym: "npn", pinNames: ["C", "B", "E"], map: ["c", "b", "e"], partno: "BC547B", part: { no: globalThis.PartNo.norm("BC547B"), maker: "", text: "TO-92", fp: "TO-92-CBE", source: "Add part" } };
  const c = { id: "q", type: "spice", label: "VT1", params: prm };
  const g = B.physicalParts({ parts: [{ id: "q", type: "spice", label: "VT1", params: prm, pins: L.LIB.spice.pins(c).map(p => ({ id: p.id, net: "n" + p.id })) }] })[0];
  assert.equal(g.mpnFp, "TO-92-CBE"); assert.equal(g.defaultFp, "TO-92-CBE");
  const r = globalThis.PartNo.resolve(prm, "spice"); assert.equal(r.source, "Add part"); assert.deepEqual(r.warn || [], []);
  // another number typed over it later: the saved package no longer belongs to it
  assert.notEqual((B.physicalParts({ parts: [{ id: "q", type: "spice", label: "VT1", params: { ...prm, partno: "2N3904" }, pins: L.LIB.spice.pins(c).map(p => ({ id: p.id, net: "n" + p.id })) }] })[0]).mpnFp, "TO-92-CBE");
});

test("a number the app has a part of its own for: that part is offered, whatever its ordering letters", () => {
  const b = n => { const r = A.builtin(n); return r ? `${r.key} ${r.type}` : null; };
  assert.deepEqual(["TL072CP", "2N3904BU", "2N2222", "LM317T", "LM317LZ", "LM7805CT", "L7812CV", "NE555P", "OPA2134PA", "LM386N-1", "1N4733A", "IRF540N", "BD139-16"].map(b),
    ["TL072 opamp", "2N3904 npn", "2N2222A npn", "LM317 reg", "LM317L reg", "7805 reg", "7812 reg", "NE555 timer555", "OPA2134 opamp", "LM386 chipamp", "1N4733A zener", "IRF540 nmos", "BD139 npn"]);
  // another part altogether, or another gain group, is not it
  assert.deepEqual(["BC547C", "IRF5305", "TL0722", "LM35", "2N39", "XYZ1", ""].map(b), [null, null, null, null, null, null, null]);
  assert.equal(A.builtin("2N3904").what, L.LIB.npn.name);
});

test("a transistor or a diode written as a small subcircuit is drawn as what it is, its pins by name or in the makers' order", () => {
  const sub = (pins, body) => ({ kind: "subckt", pins: pins.split(" "), text: `.SUBCKT X ${pins}\n${body}\n.ENDS` });
  assert.equal(F.symFor(sub("1 2 3", "M1 9 7 8 8 MM\nRG 2 7 4\nD1 3 1 MD\n.MODEL MM NMOS LEVEL=1 VTO=3\n.MODEL MD D IS=1e-12")), "nmos");
  assert.equal(F.symFor(sub("1 2 3", "M1 9 7 8 8 MM\n.MODEL MM PMOS LEVEL=1 VTO=-3")), "pmos");
  assert.equal(F.symFor(sub("1 2 3", "Q1 1 2 4 QA\nQ2 1 4 3 QA 4\nR1 2 4 8k\n.MODEL QA NPN BF=100")), "npn");
  assert.equal(F.symFor(sub("1 2 3", "Q1 1 2 3 QA\n.MODEL QA PNP BF=100")), "pnp");
  assert.equal(F.symFor(sub("1 2", "D1 1 2 DF\nDZ 3 1 DR\nVZ 2 3 3.7\n.MODEL DF D IS=1e-12\n.MODEL DR D IS=1e-14")), "diode");
  assert.equal(F.symFor(sub("1 2 3", "X1 1 2 3 OTHER")), "box", "another subcircuit inside: not a lone device");
  assert.equal(F.symFor(sub("1 2 3", "Q1 1 2 3 QA\nM1 1 2 3 3 MM\n.MODEL QA NPN\n.MODEL MM NMOS")), "box");
  assert.equal(F.symFor({ kind: "vdmos", pins: ["D", "G", "S"], text: ".model P1 VDMOS(pchan Vto=-3 Kp=5)" }), "pmos", "a P-channel power MOSFET");
  assert.equal(F.symFor({ kind: "vdmos", pins: ["D", "G", "S"], text: ".model N1 VDMOS(Vto=3 Kp=5)" }), "nmos");
  assert.deepEqual(F.mapFor({ pins: ["1", "2", "3"] }, ["C", "B", "E"]), ["C", "B", "E"]);
  assert.deepEqual(F.mapFor({ pins: ["e", "b", "c"] }, ["C", "B", "E"]), ["E", "B", "C"]);
  assert.deepEqual(F.mapFor({ pins: ["drain", "gate", "source"] }, ["D", "G", "S"]), ["D", "G", "S"]);
  assert.deepEqual(F.mapFor({ pins: ["K", "A"] }, ["A", "K"]), ["K", "A"]);
});

test("LTspice's lateral PNP (LPNP) is read as a PNP, so a model that uses it is simulated", () => {
  const text = ".SUBCKT LAT c b e\nQ1 c b e 0 PN\n.model PN LPNP(BF=25 Rb=250)\n.ENDS";
  const flat = globalThis.SpiceNet.flat(text, "LAT");
  assert.ok(flat, "flattened without an error");
  assert.deepEqual(["2N2222A", "BC108B", "2N2907A"].map(n => A.usualCase(n, "bjt")), ["TO-18", "TO-18", "TO-18"]);
});

// ---- regulators, references, comparators, optocouplers, zeners (spice-find.js recognise) ----
const ODD = fixture("oddparts.lib");
const is = (name, pn) => { const m = F.cut(ODD, name), r = F.recognise(m, pn || name); return Object.assign(r, { m }); };
// the part's own pins wired into a circuit: node(symbol pin) → node number, els the rest; the DC node voltages
const wired = (r, nodes, els) => {
  const c = { id: "x", type: "spice", label: "DA1", params: { name: r.m.sub, text: r.m.text, sub: r.m.sub, sym: r.sym, pinNames: r.m.pins.slice(), map: r.map } }, all = els.slice();
  let n = 1 + Math.max(...Object.values(nodes), ...els.flatMap(e => e.nodes));
  L.LIB.spice.build(c, pin => nodes[pin] || 0, () => n++, all);
  const dc = E.dcOperatingPoint(E.buildCircuit({ nodeCount: n, elements: all })); assert.ok(dc.ok, "the circuit solves");
  return [0, ...dc.x];
};
const Vs = (id, a, v) => ({ id, kind: "V", nodes: [a, 0], v }), Rs = (id, a, b, r) => ({ id, kind: "R", nodes: [a, b], r });

test("a part number's family: regulators, references, comparators, optocouplers and zeners are told from the rest", () => {
  const fam = pn => F.family(pn, {});
  assert.deepEqual(["LM7805CT", "UA78L05", "L7812CV", "LM7912", "LM317T", "LM337", "LD1117V33", "AMS1117-3.3", "LT1086", "LM2940T-5.0"].map(fam), Array(10).fill("reg"));
  assert.deepEqual(["TL431ACLP", "TLV431", "LM336Z", "LM4040"].map(fam), Array(4).fill("shunt"));
  assert.deepEqual(["LM393N", "LM339", "LM311P", "LM2903", "MAX907"].map(fam), Array(5).fill("comp"));
  assert.deepEqual(["PC817", "4N25", "CNY17-3", "TLP521", "H11A1", "6N137"].map(fam), Array(6).fill("opto"));
  assert.deepEqual(["BZX55C5V1", "1N4733A", "1N5231B", "MMSZ5231"].map(fam), Array(4).fill("zener"));
  // numbers that only look alike are none of them
  assert.deepEqual(["IRF340", "IRF7807", "MC34063", "NE5532", "TL072", "LM358", "LM324", "LM741", "2N3904", "1N4148", "1N4007", "BC337"].map(fam), Array(12).fill(""));
  // the maker's note says it when the number does not
  assert.equal(F.family("XYZ1", { hint: "5 V low-dropout voltage regulator" }), "reg"); assert.equal(F.family("XYZ1", { hint: "dual comparator" }), "comp");
});

test("a regulator with nameless pins is found by trying it in a test circuit, and then regulates on the sheet", () => {
  const r = is("TST7805");
  assert.equal(r.sym, "reg"); assert.equal(r.how, "probe"); assert.deepEqual(r.map, ["I", "G", "O"]); assert.equal(r.adj, false); assert.equal(r.sure, true);
  const v = wired(r, { I: 1, O: 2 }, [Vs("v", 1, 12), Rs("l", 2, 0, 500)]);
  assert.ok(Math.abs(v[2] - 5) < 0.2, `5 V out of 12 V (${v[2].toFixed(2)} V)`);
  // every other way round fails the test
  const others = [["I", "O", "G"], ["G", "I", "O"], ["G", "O", "I"], ["O", "I", "G"], ["O", "G", "I"]];
  assert.deepEqual(others.map(map => F.behaves(r.m, "reg", map)), Array(5).fill(null));
});

test("pins that are named, or told in the note above the model, are taken from there and checked in the test circuit", () => {
  const ldo = is("TSTLDO", "XLDO1");
  assert.equal(ldo.sym, "reg"); assert.equal(ldo.how, "names"); assert.deepEqual(ldo.map, ["O", "G", "I"]);
  const adj = is("TST317");
  assert.equal(adj.how, "names"); assert.deepEqual(adj.map, ["G", "O", "I"], "ADJ OUT IN, as its note says"); assert.equal(adj.adj, true, "1.25 V with its third pin grounded: an adjustable one");
  // with R1 = 240 Ω and R2 = 720 Ω it gives 1.25 V × 4
  const v = wired(adj, { I: 1, O: 2, G: 3 }, [Vs("v", 1, 12), Rs("a", 2, 3, 240), Rs("b", 3, 0, 720)]);
  assert.ok(Math.abs(v[2] - 5) < 0.1, `${v[2].toFixed(2)} V`);
  // a note that is wrong does not pass the test circuit: the pins are found the long way
  const lie = F.cut(ODD, "TST317"); lie.hint = "IN ADJ OUT";
  const r = F.recognise(lie, "TST317"); assert.equal(r.how, "probe"); assert.deepEqual(r.map, ["G", "O", "I"]);
});

test("a shunt reference: reference, anode and cathode found; it holds 2.5 V", () => {
  const r = is("TST431");
  assert.equal(r.sym, "shunt"); assert.equal(r.how, "probe"); assert.deepEqual(r.map, ["R", "A", "K"]);
  const v = wired(r, { K: 2, R: 2 }, [Vs("v", 1, 12), Rs("r", 1, 2, 1000)]);
  assert.ok(Math.abs(v[2] - 2.5) < 0.05, `${v[2].toFixed(3)} V`);
  assert.deepEqual(L.LIB.spice.pins({ params: { sym: "shunt" } }).map(p => p.id).sort(), ["A", "K", "R"]);
});

test("an optocoupler: the LED and the transistor found, and no current path between the two sides", () => {
  const r = is("OPTOTEST");
  assert.equal(r.sym, "opto"); assert.equal(r.how, "probe"); assert.deepEqual(r.map, ["A", "K", "E", "C"]);
  const at = led => wired(r, { A: 2, C: 4 }, [Vs("v", 1, led), Rs("r", 1, 2, 330), Vs("s", 3, 5), Rs("l", 3, 4, 1000)])[4];
  assert.ok(at(0) > 4.9 && at(5) < 1, `the collector falls from ${at(0).toFixed(2)} to ${at(5).toFixed(2)} V with the LED lit`);
  assert.deepEqual(L.LIB.spice.pinNumbers({ params: { sym: "opto" } }), { A: "1", K: "2", E: "3", C: "4" });
  assert.equal(L.LIB.spice.pins({ params: { sym: "optob" } }).length, 5);
});

test("a comparator: the usual order when the model works that way, else the order that does; duals and quads", () => {
  const usual = is("TST393"), own = is("TST339");
  assert.equal(usual.sym, "comp"); assert.equal(usual.how, "usual"); assert.deepEqual(usual.map, ["+", "-", "V+", "V-", "OUT"]);
  assert.equal(own.how, "probe"); assert.deepEqual(own.map, ["OUT", "V-", "+", "-", "V+"]);
  for (const r of [usual, own]) {
    const out = vin => wired(r, { "+": 1, "-": 2, "V+": 3, "V-": 0, OUT: 4 }, [Vs("a", 1, vin), Vs("b", 2, 2.5), Vs("p", 3, 5), Rs("l", 3, 4, 10000)])[4];
    assert.ok(out(3) > 4.5 && out(2) < 0.5, "high with + above −, low below");
  }
  assert.deepEqual(["LM393N", "LM2903", "LM339", "LM2901", "LM311"].map(n => A.usualAmps(n, true)), [2, 2, 4, 4, 1]);
  // a quad comparator is pinned as the LM339, a dual as a dual op-amp; the model's own order is kept
  const quad = P.opampPackage("TST339", 4, "dip", { text: own.m.text, sub: own.m.sub, order: own.map }, true).part, dual = P.opampPackage("TST393", 2, "dip", { text: usual.m.text, sub: usual.m.sub }, true).part;
  assert.equal(quad.desc, "Quad comparator"); assert.deepEqual(quad.units.map(u => u.pins.map(p => p.num).join()), ["5,4,2", "7,6,1", "9,8,14", "11,10,13", "3,12"]);
  assert.deepEqual(quad.spice.map, ["2", "12", "5", "4", "3"]); assert.deepEqual(dual.spice.map, ["3", "2", "8", "4", "1"]);
  assert.ok(P.unitMaps(quad), "every comparator of the package gets the model");
});

test("a zener is drawn as one; what is none of these stays a box; a circuit of transistors is no Darlington", () => {
  assert.equal(is("BZXTEST").sym, "zener"); assert.equal(is("BZXTEST", "D1").sym, "diode");
  assert.equal(is("TSTNET").sym, "box");
  const many = { kind: "subckt", pins: ["1", "2", "3"], text: ".SUBCKT X 1 2 3\nQ1 1 4 3 QA\nQ2 4 2 3 QA\nQ3 1 2 4 QA\nR1 1 4 1k\n.MODEL QA NPN BF=100\n.ENDS" };
  assert.equal(F.symFor(many), "box");
});

test("the new drawings reach the board: cases and pin orders that exist, pads by the pins' letters", () => {
  const fp = (sym, pins) => B.physicalParts({ parts: [{ id: "x", type: "spice", label: "DA1", params: { sym, pinNames: pins, map: [] }, pins: L.LIB.spice.pins({ params: { sym } }).map(p => ({ id: p.id, net: "n" + p.id })) }] })[0];
  const reg = fp("reg", ["1", "2", "3"]);
  assert.ok(reg.options.includes("TO-220-IGO") && reg.options.includes("TO-92-OGI") && reg.options.includes("TO-220-GOI"));
  reg.options.forEach(n => assert.ok(B.footprint(n), n));
  assert.deepEqual(B.footprint("TO-220-IGO").pads.map(p => p.name), ["I", "G", "O"]);
  assert.equal(fp("opto", ["1", "2", "3", "4"]).options[0], "DIP-4"); assert.equal(B.footprint("DIP-4").pads.length, 4);
  assert.equal(fp("optob", ["1", "2", "3", "4", "5"]).options[0], "DIP-6"); assert.equal(B.footprint("DIP-6").pads.length, 6);
  assert.equal(fp("shunt", ["1", "2", "3"]).options[0], "TO-92-RAK"); assert.equal(fp("comp", ["1", "2", "3", "4", "5"]).options[0], "DIP-8");
  assert.equal(fp("zener", ["1", "2"]).options[0], fp("diode", ["1", "2"]).options[0]);
  assert.equal(A.usualCase("LM7805CT", "reg"), "TO-220"); assert.equal(A.usualCase("78L05", "reg"), "TO-92"); assert.equal(A.usualCase("LD1117V33", "reg"), "SOT-223");
  assert.deepEqual([["LM7805", "TO-220"], ["78L05", "TO-92"], ["LM7912", "TO-220"], ["LM317T", "TO-220"], ["LM337T", "TO-220"]].map(([n, k]) => A.usualOrder(n, "reg", k)), ["IGO", "OGI", "GIO", "GOI", "GIO"]);
});
