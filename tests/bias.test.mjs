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

test("bias: E24 rounding by ratio", () => {
  assert.deepEqual([697, 505, 1104, 4750, 9.6, 96e3, 1.04].map(B.e24), [680, 510, 1100, 4700, 10, 100e3, 1]);
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

test("bias: a measured tube: the grid shift fitted to the measurement, the resistor for that tube", () => {
  const net = stage(), now = ia(net, "V1"), measured = 0.9 * now;
  const s = B.solve(net, [{ tube: "V1", ia: 1.2e-3, measured }]);
  assert.ok(s.ok, s.error);
  const k = s.shift.V1;
  assert.ok(k < 0 && k > -2, `grid shift ${k} V (draws less than the model: as if the grid were more negative)`);
  const scaled = n => ({ nodeCount: n.nodeCount, elements: n.elements.map(e => (e.id === "V1" ? Object.assign({}, e, { gridShift: k }) : e)) });
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

test("bias: a target as anode dissipation (Va·Ia, Va moving with the bias)", () => {
  // EL84 cathode-biased into a 5 kΩ load
  const net = { nodeCount: 5, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RL", kind: "R", nodes: [1, 2], r: 2000 },
    { id: "RG", kind: "R", nodes: [3, 0], r: 470e3 }, { id: "RK", kind: "R", nodes: [4, 0], r: 270 },
    { id: "V", kind: "PENTODE", nodes: [2, 3, 1, 4], model: EL84 }] };
  const s = B.solve(net, [{ tube: "V", pa: 0.7 * 12 }]), p = s.parts[0];
  assert.ok(s.ok && p.reached, s.error);
  const r = E.simulate(withR(net, { RK: p.value }), {}).dc.devices.V.main;
  near(r.vak * r.ia, 8.4, 0.003, "Pa with the value found");
  near(p.at[0].pa, p.at[0].va * p.at[0].ia, 1e-9, "the reported Pa is Va·Ia at the E24 value");
  assert.ok(p.at[0].ik > p.at[0].ia, "the cathode current includes the screen's");
});

test("bias: measured as cathode current, or as the voltage across a 1 Ω sense resistor", () => {
  // fixed bias with a 1 Ω resistor in the cathode
  const net = fixed(); net.nodeCount = 9; net.elements.find(e => e.id === "V2").nodes = [2, 3, 1, 8]; net.elements.push({ id: "RSENSE", kind: "R", nodes: [8, 0], r: 1 });
  const ik0 = (() => { const d = E.simulate(withR(net, { RLOW: 6000 }), {}).dc.devices.V2.main; return d.ia + d.ig2 + d.ig; })();
  for (const measured of [{ kind: "ik", value: 0.9 * ik0 }, { kind: "v", part: "RSENSE", value: 0.9 * ik0 * 1 }]) {
    const n = withR(net, { RLOW: 6000 }), s = B.solve(n, [{ tube: "V2", ia: 30e-3, measured }]);
    assert.ok(s.ok && s.parts[0].reached, s.error);
    const k = s.shift.V2, scaled = { nodeCount: n.nodeCount, elements: n.elements.map(e => (e.id === "V2" ? Object.assign({}, e, { gridShift: k }) : e)) };
    const d = E.simulate(scaled, {}).dc.devices.V2.main;
    near(d.ia + d.ig2 + d.ig, 0.9 * ik0, 0.003, `${measured.kind}: the fitted tube's cathode current is what was measured`);
  }
});

test("bias: two bias pots on one bias supply pull on each other; both are found", () => {
  // two EL84s, each with its own pot from one -50 V supply that has 2 kΩ of its own resistance
  const net = { nodeCount: 12, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "VN", kind: "V", nodes: [0, 10], v: 50 }, { id: "RSUP", kind: "R", nodes: [10, 11], r: 2000 },
    { id: "RL1", kind: "R", nodes: [1, 2], r: 5000 }, { id: "RL2", kind: "R", nodes: [1, 4], r: 5000 },
    { id: "P1#a", kind: "R", nodes: [11, 6], r: 5e3 }, { id: "P1#b", kind: "R", nodes: [6, 6], r: 5e3 }, { id: "R1", kind: "R", nodes: [6, 0], r: 2200 },
    { id: "P2#a", kind: "R", nodes: [11, 7], r: 5e3 }, { id: "P2#b", kind: "R", nodes: [7, 7], r: 5e3 }, { id: "R2", kind: "R", nodes: [7, 0], r: 2200 },
    { id: "RG1", kind: "R", nodes: [3, 6], r: 220e3 }, { id: "RG2", kind: "R", nodes: [5, 7], r: 220e3 },
    { id: "A", kind: "PENTODE", nodes: [2, 3, 1, 0], model: EL84 }, { id: "B", kind: "PENTODE", nodes: [4, 5, 1, 0], model: EL84 }] };
  const s = B.solve(net, [{ tube: "A", ia: 30e-3 }, { tube: "B", ia: 45e-3 }]);
  assert.ok(s.ok && s.parts.every(p => p.reached), s.error || JSON.stringify(s.parts.map(p => p.note)));
  const set = {}; s.parts.forEach(p => { set[p.part + "#a"] = 10e3 * p.fraction; set[p.part + "#b"] = 10e3 * (1 - p.fraction); });
  const n = withR(net, set);
  near(ia(n, "A"), 30e-3, 0.005, "A"); near(ia(n, "B"), 45e-3, 0.005, "B");
  // each pot: its range, the ±30 % check, and the divider resistor for mid-travel
  for (const p of s.parts) {
    assert.ok(p.range && Math.min(...p.range) < p.ia[0] && Math.max(...p.range) > p.ia[0], `range ${p.range}`);
    assert.equal(typeof p.covers.weak, "boolean");
    assert.equal(p.mid.part, p.part === "P1" ? "R1" : "R2");
  }
  // both pots at mid-track with both dividers found (they move together, as they pull on each other)
  const p1 = s.parts.find(q => q.part === "P1"), p2 = s.parts.find(q => q.part === "P2");
  const mid = withR(net, { "P1#a": 5e3, "P1#b": 5e3, "P2#a": 5e3, "P2#b": 5e3, R1: p1.mid.value, R2: p2.mid.value });
  near(ia(mid, "A"), 30e-3, 0.006, "A with the pots at mid-track and the dividers found"); near(ia(mid, "B"), 45e-3, 0.006, "B likewise");
});

test("bias: the divider found for a bias pot is not the grid leak on the same line", () => {
  // rheostat from -50 V to the bias line, 15 kΩ to ground, 150 kΩ grid leak to the line
  const net = { nodeCount: 8, elements: [
    { id: "VB", kind: "V", nodes: [1, 0], v: 300 }, { id: "RL", kind: "R", nodes: [1, 2], r: 5000 }, { id: "VN", kind: "V", nodes: [0, 5], v: 50 },
    { id: "P#a", kind: "R", nodes: [6, 5], r: 20e3 }, { id: "P#b", kind: "R", nodes: [5, 5], r: 13e3 }, { id: "R17", kind: "R", nodes: [6, 0], r: 15e3 },
    { id: "R16", kind: "R", nodes: [3, 6], r: 150e3 }, { id: "V", kind: "PENTODE", nodes: [2, 3, 1, 0], model: EL84 }] };
  const r = E.simulate(net, {});
  assert.equal(B.detect(net, r.dc)[0].part, "P");
  assert.equal(B.potDivider(net, r.dc, "P"), "R17");
});
