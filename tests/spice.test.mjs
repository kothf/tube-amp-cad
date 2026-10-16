/**
 * SPICE tube model import (spice-model.js): reading libraries, expressions, the
 * subcircuit solver, pin roles, and the engine running an imported model (node --test).
 * The reference is Norman Koren's published 12AX7 subcircuit, which must give the same
 * currents as the engine's own Koren equations with the same parameters.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const S = globalThis.SpiceModel, E = globalThis.TubeSimEngine;

// Koren's 12AX7, as published (www.normankoren.com), comments and all
const KOREN_12AX7 = `*
* Norman Koren's 12AX7 model
.SUBCKT 12AX7 1 2 3 ; P G K
+ PARAMS: MU=100 EX=1.4 KG1=1060 KP=600 KVB=300 RGI=2000
+ CCG=2.3P CGP=2.4P CCP=.9P ; ADDED 3-18-00
E1 7 0 VALUE={V(1,3)/KP*LOG(1+EXP(KP*(1/MU+V(2,3)/SQRT(KVB+V(1,3)*V(1,3)))))}
RE1 7 0 1G
G1 1 3 VALUE={(PWR(V(7),EX)+PWRS(V(7),EX))/KG1}
RCP 1 3 1G ; TO AVOID FLOATING NODES IN MU-FOLLOWER
C1 2 3 {CCG} ; CATHODE-GRID
C2 2 1 {CGP} ; GRID-PLATE
C3 1 3 {CCP} ; CATHODE-PLATE
D3 5 3 DX ; FOR GRID CURRENT
R1 2 5 {RGI} ; FOR GRID CURRENT
.MODEL DX D(IS=1N RS=1 CJO=10PF TT=1N)
.ENDS
`;
const KP = { mu: 100, kg: 1060, kp: 600, kvb: 300, x: 1.4 };

test("numbers with SPICE suffixes; expressions with precedence, functions, comparisons and ?:", () => {
  assert.equal(S.num("4.7k"), 4700); assert.equal(S.num("2.2meg"), 2.2e6); assert.equal(S.num("10pF"), 10e-12); assert.equal(S.num("3m"), 3e-3); assert.equal(S.num("1G"), 1e9); assert.ok(isNaN(S.num("k1")));
  const ev = (src, params) => S.compile(`.subckt T a b params: ${params || "q=1"}\nB1 a b I={${src}}\n.ends`).evaluate([0, 0])[0];
  assert.equal(ev("2+3*4**2"), 50); assert.equal(ev("-2^2"), -4); assert.equal(ev("(1<2)&&(3>=3)"), 1); assert.equal(ev("1>2 ? 5 : 7"), 7);
  assert.equal(ev("if(q>0, uramp(-3)+limit(9,0,4), 0)"), 4); assert.equal(ev("pwrs(-8, 1/3)"), -2); assert.ok(Math.abs(ev("atan(1)*4") - Math.PI) < 1e-12);
  assert.equal(ev("a*b+c", "a=2 b={a*3} c=1k"), 1012);
  assert.throws(() => ev("foo(1)"), /unknown function foo/); assert.throws(() => ev("1+"), /ends too soon/); assert.throws(() => ev("x", "x={x+1}"), /refers to itself/);
});

test("Koren's published 12AX7 subcircuit gives the engine's Koren currents (the same equations, written twice)", () => {
  const lib = S.parseLib(KOREN_12AX7);
  assert.equal(lib.subckts.length, 1); assert.deepEqual(lib.subckts[0].pins, ["1", "2", "3"]);
  const c = S.compile(KOREN_12AX7, "12AX7");
  assert.ok(c.warnings.some(w => /3 capacitors ignored/.test(w)));
  const g = S.guessRoles(c);
  assert.deepEqual(g.roles, ["A", "G", "K"]); assert.ok(g.fromHint, "from the '; P G K' comment");
  const t = S.tube({ text: KOREN_12AX7, sub: "12AX7", roles: g.roles });
  for (const va of [50, 150, 250, 350]) for (const vg of [-4, -2, -1, -0.3]) {
    const [ia] = t.triode(va, vg), ref = E.Koren.triodeIa(va, vg, KP) + va / 1e9;      // + RCP, 1 GΩ across the tube
    assert.ok(Math.abs(ia - ref) <= 1e-9 + 1e-6 * ref, `Va ${va} Vg ${vg}: ${ia} vs ${ref}`);
  }
  // grid current through RGI and the diode: none when negative, about (Vg − 0.6 V) / 2 kΩ when positive
  assert.ok(Math.abs(t.triode(200, -2)[1]) < 2e-9);
  const ig = t.triode(200, 3)[1]; assert.ok(ig > 1e-3 && ig < 1.6e-3, `ig at +3 V: ${ig}`);
  // and Kirchhoff: the diode's current comes back out of the cathode pin
  const I = c.evaluate([200, 3, 0]); assert.ok(Math.abs(I[0] + I[1] + I[2] + (200 / 1e9 * 0)) < 1e-9 + 200 / 1e9 * 2, `KCL ${I}`);
});

test("pin roles: the comment's order, or the assignment that behaves like a tube when there is none", () => {
  // a Koren-form pentode with its pins in an unusual order, said only in the comment
  const PENT = `.SUBCKT P6 7 3 9 1 ; G2 K A G1
+ PARAMS: MU=11 EX=1.35 KG1=600 KG2=1500 KP=45 KVB=20
E1 50 0 VALUE={V(7,3)/KP*LOG(1+EXP(KP*(1/MU+V(1,3)/V(7,3))))}
G1 9 3 VALUE={(PWR(V(50),EX)+PWRS(V(50),EX))/KG1*ATAN(V(9,3)/KVB)}
G2 7 3 VALUE={EXP(EX*(LOG((V(7,3)/MU)+V(1,3))))/KG2}
.ENDS`;
  const c = S.compile(PENT);
  assert.deepEqual(S.guessRoles(c).roles, ["G2", "K", "A", "G"]);
  // the same model with the comment taken away: the guess still finds plate, grids and cathode
  const bare = S.compile(PENT.replace(/;.*$/m, ""));
  assert.equal(S.hintMap(bare), null);
  assert.deepEqual(S.guessRoles(bare).roles, ["G2", "K", "A", "G"]);
  const t = S.tube({ text: PENT, sub: "P6", roles: ["G2", "K", "A", "G"] });
  const [ia, ig, ig2] = t.pentode(250, -10, 250);
  const e1 = 250 / 45 * Math.log(1 + Math.exp(45 * (1 / 11 - 10 / 250)));
  assert.ok(Math.abs(ia - 2 * Math.pow(e1, 1.35) / 600 * Math.atan(250 / 20)) < 1e-9 && ig === 0 && Math.abs(ig2 - Math.exp(1.35 * Math.log(250 / 11 - 10)) / 1500) < 1e-12);
  // triode-connected: screen tied to the plate, both currents together
  const [it] = t.triode(200, -10), [pa, , ps] = t.pentode(200, -10, 200);
  assert.ok(Math.abs(it - pa - ps) < 1e-12);
  assert.equal(S.kindOf(["G2", "K", "A", "G"]), "pentode");
});

test("Ayumi-style models: .FUNC, .PARAM, B sources, continuation lines, $ comments, if()", () => {
  const AY = `.param kk=2
.func fkoren(v, g) {v/kp*ln(1+exp(kp*(1/mu+g/v)))}
.SUBCKT TT a g k params: mu=20 kp=100 x=1.5
+ kg=1000
Bp a k I={ if(V(a,k)>0, pwr(fkoren(V(a,k),V(g,k)),x)*kk/kg, 0) } $ plate
Rg g k 1meg
.ENDS TT`;
  const c = S.compile(AY), ia = (va, vg) => S.adapter(c, ["A", "G", "K"]).triode(va, vg)[0];
  const ref = (va, vg) => Math.pow(va / 100 * Math.log(1 + Math.exp(100 * (1 / 20 + vg / va))), 1.5) * 2 / 1000;
  assert.ok(Math.abs(ia(200, -3) - ref(200, -3)) < 1e-12 && ia(-5, 0) === 0);
  assert.ok(Math.abs(S.adapter(c, ["A", "G", "K"]).triode(200, -3)[1] + 3e-6) < 1e-12, "1 MΩ grid leak: −3 µA at −3 V");
  // only what the chosen subcircuit needs is kept
  const two = AY + "\n.SUBCKT OTHER 1 2 3\nR1 1 3 1k\n.ENDS";
  const x = S.extract(two, "TT");
  assert.ok(/\.func fkoren/.test(x) && /\.SUBCKT TT/.test(x) && !/OTHER/.test(x));
  assert.throws(() => S.compile(".subckt Q 1 2 3\nX1 1 2 3 FOO\n.ends"), /subcircuits inside subcircuits/);
  assert.throws(() => S.compile(".subckt Q 1 2 3\nE1 1 3 POLY(1) 2 3 0 1\n.ends"), /POLY sources are not supported/);
});

test("the engine runs an imported model: a 12AX7 stage matches the built-in Koren model", () => {
  const spec = { text: KOREN_12AX7, sub: "12AX7", roles: ["A", "G", "K"] };
  const run = model => E.simulate({ nodeCount: 7, elements: [
    { id: "B", kind: "V", nodes: [1, 0], v: 250 }, { id: "Ra", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "V1", kind: "TRIODE", nodes: [2, 3, 4], model }, { id: "Rk", kind: "R", nodes: [4, 0], r: 1500 },
    { id: "Ck", kind: "C", nodes: [4, 0], c: 47e-6 }, { id: "Rg", kind: "R", nodes: [3, 0], r: 1e6 },
    { id: "Cin", kind: "C", nodes: [5, 3], c: 0.1e-6 }, { id: "Gen", kind: "VSRC", nodes: [5, 0], wave: "sine", freq: 1000, amp: 0.05 },
    { id: "Co", kind: "C", nodes: [2, 6], c: 0.1e-6 }, { id: "RL", kind: "R", nodes: [6, 0], r: 470e3 }] });
  const a = run(KP), b = run({ spice: spec, mu: 100 });
  assert.ok(a.ok && b.ok, b.error);
  assert.ok(Math.abs(a.dc.nodes[2] - b.dc.nodes[2]) < 0.05, `plate ${a.dc.nodes[2]} vs ${b.dc.nodes[2]}`);
  const pp = x => Math.max(...x) - Math.min(...x);
  assert.ok(Math.abs(pp(a.tran.nodes[6]) / pp(b.tran.nodes[6]) - 1) < 0.003, "the same gain");
  const est = S.estimate(spec, 300);
  assert.ok(est.mu > 85 && est.mu < 105, `µ about 100: ${est.mu}`);
});

test("an imported tube joins the database like an existing one, and is refused a built-in's name", () => {
  const entry = S.makeTube({ name: "12AX7-Koren", text: KOREN_12AX7, sub: "12AX7", roles: ["A", "G", "K"], like: "12AX7", paMax: 1.2, vaMax: 330 });
  assert.equal(entry.socket, "Noval B9A"); assert.equal(entry.pinout.length, 9); assert.equal(entry.paMax, 1.2);
  assert.ok(entry.koren.Triode.spice && entry.koren.Triode.mu > 80 && !entry.koren.Pentode);
  S.register(entry);
  assert.ok(globalThis.TUBE_DATABASE.some(t => t.commonName === "12AX7-Koren"));
  assert.throws(() => S.register({ ...entry, commonName: "EL34" }), /built-in tube/);
  JSON.parse(JSON.stringify(entry));                          // plain data: it goes into files and to the worker
});

test("SPICE export of a built-in pentode: the same currents as the engine, the screen's fade-in below 2 V included", () => {
  const m = globalThis.TUBE_DATABASE.find(t => t.commonName === "EL84").koren.Pentode, x = E.Spice.pentode(m);
  const t = S.tube({ text: `.subckt EX A G1 G2 K\nBp A K I={${x.plate}}\nBs G2 K I={${x.screen}}\nBg G1 K I={${x.grid}}\n.ends`, sub: "EX", roles: ["A", "G", "G2", "K"] });
  for (const [va, vg, vs] of [[250, -8, 250], [100, -2, 200], [50, 0.5, 1], [50, 0.5, 0.2], [50, 1, 1.999], [50, 1, 2.001], [20, -1, 0]]) {
    const a = t.pentode(va, vg, vs), b = E.Tube.pentode(va, vg, vs, m);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) <= 1e-9 + 1e-6 * Math.abs(b[k]), `Va ${va}, Vg ${vg}, Vg2 ${vs}: [${a}] vs [${b}]`);
  }
});
