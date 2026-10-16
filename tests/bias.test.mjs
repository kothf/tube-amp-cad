/**
 * Bias finder tests (node --test): which part sets each tube's bias (bias.js detect), and
 * the value that gives the target anode current (solve), each checked with a separate
 * simulation of the circuit with that value put in.
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

test("bias: E24 rounding by ratio", () => {
  assert.deepEqual([697, 505, 1104, 4750, 9.6, 96e3, 1.04].map(B.e24), [680, 510, 1100, 4700, 10, 100e3, 1]);
});

test("bias: a tube's iScale scales all its currents (a tube with more or less emission than the model)", () => {
  // electrodes held by sources: the currents are the model's, times the factor
  const net = k => ({ nodeCount: 4, elements: [{ id: "a", kind: "V", nodes: [1, 0], v: 250 }, { id: "g", kind: "V", nodes: [0, 2], v: 8 }, { id: "s", kind: "V", nodes: [3, 0], v: 250 },
    { id: "T", kind: "PENTODE", nodes: [1, 2, 3, 0], model: EL84, iScale: k }] });
  const r1 = E.simulate(net(undefined), {}).dc.devices.T.main, r2 = E.simulate(net(0.8), {}).dc.devices.T.main;
  near(r2.ia, 0.8 * r1.ia, 1e-9, "anode"); near(r2.ig2, 0.8 * r1.ig2, 1e-9, "screen");
  assert.ok(r1.ia > 0.03 && r1.ia < 0.06, `EL84 at 250 V, -8 V: ${r1.ia} A`);
});

test("bias: the part that sets each tube's bias is found", () => {
  assert.deepEqual(detected(stage()).V1, { tube: "V1", kind: "cathode", part: "RK", type: "resistor" });
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
  assert.deepEqual(detected(fixed()).V2, { tube: "V2", kind: "fixed", part: "RLOW", type: "resistor" });
  // fixed bias set with a pot (wiper on the bias line): the pot
  const pot = fixed(); pot.nodeCount = 9; pot.elements = pot.elements.filter(e => e.id !== "RLOW" && e.id !== "RS");
  pot.elements.push({ id: "RS", kind: "R", nodes: [5, 8], r: 15e3 }, { id: "P#a", kind: "R", nodes: [8, 6], r: 10e3 }, { id: "P#b", kind: "R", nodes: [6, 0], r: 23e3 });
  assert.deepEqual(detected(pot).V2, { tube: "V2", kind: "fixed", part: "P", type: "pot" });
  // no resistor to set: an LED in the cathode, and a grounded cathode with the grid to ground
  const led = stage(); led.elements = led.elements.filter(e => e.id !== "RK"); led.elements.push({ id: "LED", kind: "D", nodes: [4, 0], is: 1e-18, n: 2 });
  assert.equal(detected(led).V1.kind, null); assert.match(detected(led).V1.reason, /diode/);
  const zero = stage(); zero.elements = zero.elements.filter(e => e.id !== "RK"); zero.elements.find(e => e.id === "V1").nodes = [2, 3, 0];
  assert.match(detected(zero).V1.reason, /zero bias/);
});

test("bias: cathode resistor for a target current, checked by simulating it", () => {
  const net = stage(), s = B.solve(net, [{ tube: "V1", ia: 1.2e-3 }]);
  assert.ok(s.ok, s.error);
  const p = s.parts[0];
  assert.equal(p.part, "RK"); assert.ok(p.reached);
  near(ia(withR(net, { RK: p.value }), "V1"), 1.2e-3, 0.003, "Ia with the exact value");
  assert.equal(p.e24, B.e24(p.value));
  near(p.ia[0], ia(withR(net, { RK: p.e24 }), "V1"), 1e-6, "Ia reported for the E24 value");
  // the power in it, from the same simulation
  near(p.power, (p.ia[0] * p.e24) ** 2 / p.e24, 0.01, "power");
});

test("bias: a measured tube: the emission fitted to the measurement, the resistor for that tube", () => {
  const net = stage(), now = ia(net, "V1"), measured = 0.9 * now;
  const s = B.solve(net, [{ tube: "V1", ia: 1.2e-3, measured }]);
  assert.ok(s.ok, s.error);
  const k = s.emission.V1;
  assert.ok(k > 0.5 && k < 1, `emission ${k}`);
  const scaled = n => ({ nodeCount: n.nodeCount, elements: n.elements.map(e => (e.id === "V1" ? Object.assign({}, e, { iScale: k }) : e)) });
  near(ia(scaled(net), "V1"), measured, 0.003, "the fitted tube draws what was measured");
  const p = s.parts[0];
  near(ia(scaled(withR(net, { RK: p.value })), "V1"), 1.2e-3, 0.003, "and the target with the resistor found");
  // a weaker tube needs less cathode resistance for the same current
  const plain = B.solve(net, [{ tube: "V1", ia: 1.2e-3 }]).parts[0];
  assert.ok(p.value < plain.value, `${p.value} < ${plain.value}`);
});

test("bias: fixed bias, by the divider's resistor or by the pot's wiper", () => {
  const net = fixed(), s = B.solve(net, [{ tube: "V2", ia: 40e-3 }]);
  assert.ok(s.ok && s.parts[0].reached, s.error);
  near(ia(withR(net, { RLOW: s.parts[0].value }), "V2"), 40e-3, 0.003, "Ia with the divider resistor found");
  const pot = fixed(); pot.nodeCount = 9; pot.elements = pot.elements.filter(e => e.id !== "RLOW" && e.id !== "RS");
  pot.elements.push({ id: "RS", kind: "R", nodes: [5, 8], r: 15e3 }, { id: "P#a", kind: "R", nodes: [8, 6], r: 10e3 }, { id: "P#b", kind: "R", nodes: [6, 0], r: 23e3 });
  const sp = B.solve(pot, [{ tube: "V2", ia: 40e-3 }]), q = sp.parts[0];
  assert.ok(sp.ok && q.reached && q.type === "pot" && q.fraction > 0 && q.fraction < 1, JSON.stringify(q));
  near(ia(withR(pot, { "P#a": 33e3 * q.fraction, "P#b": 33e3 * (1 - q.fraction) }), "V2"), 40e-3, 0.003, "Ia with the wiper found");
  // beyond the pot's travel: reported, not stretched
  const far = B.solve(pot, [{ tube: "V2", ia: 0.4 }]).parts[0];
  assert.ok(!far.reached && /travel/.test(far.note), JSON.stringify(far));
});

test("bias: two tubes on one cathode resistor are set for their average; the signal is switched off", () => {
  const pair = { nodeCount: 9, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RA1", kind: "R", nodes: [1, 2], r: 2000 }, { id: "RA2", kind: "R", nodes: [1, 5], r: 2000 },
    { id: "RG1", kind: "R", nodes: [3, 0], r: 470e3 }, { id: "RG2", kind: "R", nodes: [6, 0], r: 470e3 }, { id: "RK", kind: "R", nodes: [4, 0], r: 130 },
    { id: "A", kind: "PENTODE", nodes: [2, 3, 1, 4], model: EL84 }, { id: "B", kind: "PENTODE", nodes: [5, 6, 1, 4], model: EL84 },
    // a strong 1 kHz drive on A's grid: it would move the average current
    { id: "SIG", kind: "VSRC", nodes: [7, 0], wave: "sine", freq: 1000, amp: 12, offset: 0, phase: 0 }, { id: "CC", kind: "C", nodes: [7, 3], c: 1e-6 }] };
  const s = B.solve(pair, [{ tube: "A", ia: 30e-3 }, { tube: "B", ia: 34e-3 }], { quiet: ["SIG"] }), p = s.parts[0];
  assert.ok(s.ok && p.reached, s.error);
  assert.deepEqual(p.tubes, ["A", "B"]); near(p.target, 32e-3, 1e-9, "the pair's average target");
  const idle = withR(pair, { RK: p.value }); idle.elements.find(e => e.id === "SIG").amp = 0;
  near((ia(idle, "A") + ia(idle, "B")) / 2, 32e-3, 0.003, "average Ia with the signal off");
});
