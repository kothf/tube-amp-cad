/**
 * Bias detection tests (node --test): which part sets each tube's bias and its grid circuit
 * resistance (bias.js detect), and the engine's gridShift / iScale tube adjustments.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "bias.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, B = globalThis.TubeBias;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const model = (name, kind) => globalThis.TUBE_DATABASE.find(t => t.commonName === name).koren[kind];
const AX7 = model("12AX7", "Triode"), EL84 = model("EL84", "Pentode");
const ia = (net, id) => { const r = E.simulate(net, { budgetMs: 20000 }); assert.ok(r.ok, r.error); return r.dc.devices[id].main.ia; };
const withR = (net, values) => ({ nodeCount: net.nodeCount, elements: net.elements.map(e => (values[e.id] !== undefined ? Object.assign({}, e, { r: values[e.id] }) : e)) });
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b} ±${rel * 100} %`);
const detected = net => { const r = E.simulate(net, {}); assert.ok(r.ok, r.error); return Object.fromEntries(B.detect(net, r.dc).map(d => [d.tube, d])); };

// 12AX7 common cathode: 1 B+, 2 anode, 3 grid, 4 cathode
const stage = () => ({ nodeCount: 5, elements: [
  { id: "VB", kind: "V", nodes: [1, 0], v: 250 }, { id: "RA", kind: "R", nodes: [1, 2], r: 100e3 },
  { id: "RG", kind: "R", nodes: [3, 0], r: 1e6 }, { id: "RK", kind: "R", nodes: [4, 0], r: 1500 },
  { id: "V1", kind: "TRIODE", nodes: [2, 3, 4], model: AX7 }] });
// EL84 with fixed bias from -50 V: 1 B+ (screen too), 2 anode, 3 grid, 5 -50 V, 6 bias line, 7 grid stopper
const fixed = () => ({ nodeCount: 8, elements: [
  { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RL", kind: "R", nodes: [1, 2], r: 5000 },
  { id: "VN", kind: "V", nodes: [0, 5], v: 50 }, { id: "RS", kind: "R", nodes: [5, 6], r: 22e3 }, { id: "RLOW", kind: "R", nodes: [6, 0], r: 22e3 },
  { id: "RGL", kind: "R", nodes: [7, 6], r: 220e3 }, { id: "RST", kind: "R", nodes: [3, 7], r: 1e3 },
  { id: "V2", kind: "PENTODE", nodes: [2, 3, 1, 0], model: EL84 }] });

test("bias: the grid circuit resistance runs through the grid's return to where it is fed", () => {
  // grid stopper and leak in series; a 1 MΩ volume pot (as two halves, wiper on the grid) to ground
  const st = stage(); st.nodeCount = 6; st.elements.find(e => e.id === "V1").nodes = [2, 5, 4];
  st.elements.push({ id: "RST", kind: "R", nodes: [5, 3], r: 10e3 });
  assert.equal(detected(st).V1.rg, 1.01e6);
  const vol = stage(); vol.nodeCount = 6; vol.elements = vol.elements.filter(e => e.id !== "RG");
  vol.elements.push({ id: "P#a", kind: "R", nodes: [5, 3], r: 300e3 }, { id: "P#b", kind: "R", nodes: [3, 0], r: 700e3 });
  assert.equal(detected(vol).V1.rg, 700e3, "the shorter way, to ground");
  // a grid fed by a winding (interstage, choke): no resistance
  const lw = stage(); lw.elements = lw.elements.filter(e => e.id !== "RG"); lw.elements.push({ id: "LG", kind: "L", nodes: [3, 0], l: 20, r: 0 });
  assert.equal(detected(lw).V1.rg, 0);
});

test("bias: a tube's gridShift moves its plate and screen currents along the grid axis, not its grid conduction; iScale scales them all", () => {
  const at = (vg, extra) => E.simulate({ nodeCount: 4, elements: [{ id: "a", kind: "V", nodes: [1, 0], v: 250 }, { id: "g", kind: "V", nodes: [2, 0], v: vg }, { id: "s", kind: "V", nodes: [3, 0], v: 250 },
    Object.assign({ id: "T", kind: "PENTODE", nodes: [1, 2, 3, 0], model: EL84 }, extra)] }, {}).dc.devices.T.main;
  const shifted = at(-8, { gridShift: 0.5 }), plain = at(-7.5);
  near(shifted.ia, plain.ia, 1e-9, "plate at -8 V shifted +0.5 V = plate at -7.5 V"); near(shifted.ig2, plain.ig2, 1e-9, "screen likewise");
  assert.equal(at(-0.2, { gridShift: 0.5 }).ig, 0, "no grid current below 0 V, whatever the shift");
});

test("bias: a tube's iScale scales all its currents (the pot check's weaker and stronger tubes)", () => {
  // electrodes held by sources: the currents are the model's, times the factor
  const net = k => ({ nodeCount: 4, elements: [{ id: "a", kind: "V", nodes: [1, 0], v: 250 }, { id: "g", kind: "V", nodes: [0, 2], v: 8 }, { id: "s", kind: "V", nodes: [3, 0], v: 250 },
    { id: "T", kind: "PENTODE", nodes: [1, 2, 3, 0], model: EL84, iScale: k }] });
  const r1 = E.simulate(net(undefined), {}).dc.devices.T.main, r2 = E.simulate(net(0.8), {}).dc.devices.T.main;
  near(r2.ia, 0.8 * r1.ia, 1e-9, "anode"); near(r2.ig2, 0.8 * r1.ig2, 1e-9, "screen");
  assert.ok(r1.ia > 0.03 && r1.ia < 0.06, `EL84 at 250 V, -8 V: ${r1.ia} A`);
});

test("bias: the part that sets each tube's bias is found", () => {
  assert.deepEqual(detected(stage()).V1, { tube: "V1", kind: "cathode", part: "RK", type: "resistor", rg: 1e6 });
  // a cathode resistor in two parts with the feedback between them: the part next to the cathode
  const split = stage(); split.nodeCount = 6; split.elements = split.elements.filter(e => e.id !== "RK");
  split.elements.push({ id: "RK1", kind: "R", nodes: [4, 5], r: 750 }, { id: "RK2", kind: "R", nodes: [5, 0], r: 750 });
  assert.equal(detected(split).V1.part, "RK1");
  // cathodyne: the grid leak returns to the junction of the bias resistor and the cathode load
  const cdyne = { nodeCount: 6, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RA", kind: "R", nodes: [1, 2], r: 47e3 }, { id: "RB", kind: "R", nodes: [4, 5], r: 1500 },
    { id: "RKL", kind: "R", nodes: [5, 0], r: 47e3 }, { id: "RG", kind: "R", nodes: [3, 5], r: 1e6 }, { id: "V1", kind: "TRIODE", nodes: [2, 3, 4], model: AX7 }] };
  assert.equal(detected(cdyne).V1.part, "RB");
  // a push-pull pair with one cathode resistor: the same part for both
  const pair = { nodeCount: 7, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RA1", kind: "R", nodes: [1, 2], r: 2000 }, { id: "RA2", kind: "R", nodes: [1, 5], r: 2000 },
    { id: "RG1", kind: "R", nodes: [3, 0], r: 470e3 }, { id: "RG2", kind: "R", nodes: [6, 0], r: 470e3 }, { id: "RK", kind: "R", nodes: [4, 0], r: 130 },
    { id: "A", kind: "PENTODE", nodes: [2, 3, 1, 4], model: EL84 }, { id: "B", kind: "PENTODE", nodes: [5, 6, 1, 4], model: EL84 }] };
  const dp = detected(pair); assert.equal(dp.A.part, "RK"); assert.equal(dp.B.part, "RK");
  // fixed bias: the divider's resistor to ground, not the grid leak or the grid stopper
  assert.deepEqual(detected(fixed()).V2, { tube: "V2", kind: "fixed", part: "RLOW", type: "resistor", rg: 221e3 });
  // fixed bias set with a pot (wiper on the bias line): the pot
  const pot = fixed(); pot.nodeCount = 9; pot.elements = pot.elements.filter(e => e.id !== "RLOW" && e.id !== "RS");
  pot.elements.push({ id: "RS", kind: "R", nodes: [5, 8], r: 15e3 }, { id: "P#a", kind: "R", nodes: [8, 6], r: 10e3 }, { id: "P#b", kind: "R", nodes: [6, 0], r: 23e3 });
  assert.deepEqual(detected(pot).V2, { tube: "V2", kind: "fixed", part: "P", type: "pot", rg: 221e3 });
  // no resistor to set: an LED in the cathode, and a grounded cathode with the grid to ground
  const led = stage(); led.elements = led.elements.filter(e => e.id !== "RK"); led.elements.push({ id: "LED", kind: "D", nodes: [4, 0], is: 1e-18, n: 2 });
  assert.equal(detected(led).V1.kind, null); assert.match(detected(led).V1.reason, /diode/);
  const zero = stage(); zero.elements = zero.elements.filter(e => e.id !== "RK"); zero.elements.find(e => e.id === "V1").nodes = [2, 3, 0];
  assert.match(detected(zero).V1.reason, /zero bias/);
});

