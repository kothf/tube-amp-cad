/**
 * SPICE parts (spice-net.js, the engine's behavioural source, cad-components.js LIB.spice): a
 * maker's .SUBCKT or .MODEL turned into the simulator's own elements. The numbers the device
 * bench is held to are ngspice 42's for the same file (tests/models.mjs compares them live
 * where ngspice is installed).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib, SN = globalThis.SpiceNet, B = globalThis.BoardCore;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const AMP = fixture("testamp.lib"), DEV = fixture("devices.lib");
const near = (actual, expected, relTol, msg) => assert.ok(Math.abs(actual - expected) <= relTol * Math.abs(expected) + 1e-9, `${msg}: got ${actual}, expected ${expected} ±${relTol * 100}%`);

// a subcircuit run on its own: its pins on nodes 1 … n, the DC voltage of every named node
function runSub(text, sub) {
  const f = SN.flatten(text, sub);
  let n = f.nNodes;
  const map = {}; let q = f.nNodes; for (let k = 1; k < f.nNodes; k++) map[k] = k <= f.pins.length ? k : q++;
  const els = SN.build({ text, sub }, f.pins.map((_, i) => i + 1), () => n++, "U");
  const res = E.simulate({ nodeCount: n, elements: els }, {});
  assert.ok(res.ok, `${sub} solves${res.ok ? "" : ": " + res.error}`);
  const v = {}; Object.entries(f.nodeNames).forEach(([name, k]) => { v[name] = k === 0 ? 0 : res.dc.nodes[map[k]]; });
  return { v, f, res };
}
// a circuit from CAD parts: [{ type, params, pins: { pin: node } }]
function circuit(parts) {
  let n = 0;
  parts.forEach(p => Object.values(p.pins).forEach(v => { n = Math.max(n, v); }));
  const els = [];
  parts.forEach((p, i) => {
    const c = { id: p.id || "p" + i, type: p.type, label: p.label || "", params: Object.assign({}, L.LIB[p.type].defaults, p.params) };
    L.LIB[p.type].build(c, pin => (p.pins[pin] !== undefined ? p.pins[pin] : ++n), () => ++n, els);
  });
  return { nodeCount: n + 1, elements: els };
}
const R = (r, a, b) => ({ type: "resistor", params: { r }, pins: { 1: a, 2: b } });
const SUPPLY = [{ type: "vdc", params: { v: 15 }, pins: { "+": 1, "-": 0 } }, { type: "vdc", params: { v: 15 }, pins: { "+": 0, "-": 2 } }];
const gen = (p, node) => ({ id: "gen", type: "siggen", params: Object.assign({ rs: 1e-3 }, p), pins: { "+": node, "-": 0 } });
const spiceAmp = pins => ({ id: "U", type: "spice", params: { name: "TESTAMP", text: AMP, sub: "TESTAMP", sym: "opamp", pinNames: ["inp", "inn", "vcc", "vee", "out"], map: ["+", "-", "V+", "V-", "OUT"] }, pins: Object.assign({ "V+": 1, "V-": 2 }, pins) });
const swing = (r, node) => { const w = r.tran.nodes[node]; let lo = Infinity, hi = -Infinity; for (const x of w) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return [lo, hi]; };

test("the engine's behavioural source: a current and a voltage from an expression of node voltages and a branch current", () => {
  // 10 V on 1 kΩ + 1 kΩ: node 2 at 5 V; B1 drives 1 mA·V(2)² into 100 Ω (2.5 V); B2 is twice that as a voltage; B3 mirrors V1's current
  const els = [{ id: "V1", kind: "V", nodes: [1, 0], v: 10 }, { id: "R1", kind: "R", nodes: [1, 2], r: 1e3 }, { id: "R2", kind: "R", nodes: [2, 0], r: 1e3 },
    { id: "B1", kind: "B", out: "i", nodes: [0, 3, 2], ast: { k: "b", op: "*", a: { k: "n", v: 1e-3 }, b: { k: "b", op: "*", a: { k: "v", a: 2, b: 0 }, b: { k: "v", a: 2, b: 0 } } }, ctl: [] },
    { id: "R3", kind: "R", nodes: [3, 0], r: 100 },
    { id: "B2", kind: "B", out: "v", nodes: [4, 0, 3], ast: { k: "b", op: "*", a: { k: "n", v: 2 }, b: { k: "v", a: 2, b: 1 } }, ctl: [] }, { id: "R4", kind: "R", nodes: [4, 0], r: 1e3 },
    { id: "B3", kind: "B", out: "i", nodes: [0, 5], ast: { k: "b", op: "*", a: { k: "n", v: -1 }, b: { k: "i", n: 0 } }, ctl: ["V1"] }, { id: "R5", kind: "R", nodes: [5, 0], r: 1e3 }];
  const res = E.simulate({ nodeCount: 6, elements: els }, {});
  assert.ok(res.ok, res.error);
  near(res.dc.nodes[2], 5, 1e-6, "divider"); near(res.dc.nodes[3], 2.5, 1e-6, "1 mA·V² into 100 Ω"); near(res.dc.nodes[4], 5, 1e-6, "twice that, as a voltage");
  near(res.dc.nodes[5], 5, 1e-6, "the supply's 5 mA mirrored into 1 kΩ");
});

test("a library's parts are listed, and one is cut out with what it needs", () => {
  const parts = SN.list(DEV);
  assert.deepEqual(parts.filter(p => p.kind === "subckt").map(p => [p.name, p.pins.length]), [["halver", 2], ["bench", 15]]);
  assert.deepEqual(parts.filter(p => p.kind !== "subckt").map(p => `${p.name}:${p.kind}`).sort(), ["dtest:d", "jtest:njf", "mtest:nmos", "mtestp:pmos", "qtest:npn", "qtestp:pnp"]);
  const cut = SN.extract(DEV, "halver");
  assert.ok(/\.subckt halver/i.test(cut) && /\.param half/i.test(cut) && !/bench|QTEST/i.test(cut), "the subcircuit and the parameter it uses, nothing else");
  near(runSub(cut + "\n.subckt t a b\nV1 a 0 3\nX1 a b halver\n.ends", "t").v.b, 1.5, 1e-6, "the cut-out part runs");
  const one = SN.extract(DEV, "DTEST");
  assert.ok(/^\.model DTEST/im.test(one) && !/QTEST|subckt/i.test(one), "a lone model: its line");
  assert.deepEqual(SN.flatten(one, "DTEST").pins, ["a", "k"]);
});

test("devices, sources, a switch, a table and a polynomial agree with ngspice (DC, within 0.3 %)", () => {
  const NG = { c: 5.907477, b: 1.987827, e: 1.306174, d1: 0.5987344, z: 100.1902, jd: 10.50032, md: 5.249465, mg: 4.307692, pc: 2.957193, pd: 11.95787, sw: 11.88119, tbl: 5.615385, po: 22.81201, bs: 2.004428, hv: 2.153846 };
  const { v, f } = runSub(DEV, "bench");
  for (const k in NG) near(v[k], NG[k], 3e-3, `V(${k})`);
});

test("junction capacitances follow their voltage, a transit time and a JFET's gain agree with ngspice (AC, 1 kHz to 10 MHz)", () => {
  // ngspice 42, ac dec 1 1k 10Meg on tests/fixtures/acdev.lib: dB and degrees at each pin
  const NG = {
    dv: [[-6.02079, -6.03488, -7.25411, -21.3157, -41.1867], [-0.282764, -3.27547, -29.8164, -80.0957, -88.9347]],
    qc: [[42.52684, 42.52683, 40.77505, 25.43521, 5.514292], [-176.310, 176.3456, 144.6355, 97.81077, 88.73296]],
    pc: [[40.91805, 40.87913, 37.27462, 19.68573, -0.292762], [-176.960, 173.8043, 131.0032, 94.67026, 87.49137]],
    jn: [[29.75327, 29.73681, 28.34116, 13.79493, -6.12045], [179.7866, 176.4609, 148.1461, 98.56670, 84.96493]] };
  const text = fixture("acdev.lib"), f = SN.flatten(text, "bench");
  let n = f.nNodes;
  const els = SN.build({ text, sub: "bench" }, f.pins.map((_, i) => i + 1), () => n++, "U");
  const pins = Object.keys(NG), ac = E.acSweep({ nodeCount: n, elements: els }, { inputs: [{ id: els.find(e => /#vin$/i.test(e.id)).id }], fStart: 1e3, fStop: 1e7, perDecade: 1, probes: pins.map(p => [f.pins.indexOf(p) + 1, 0]) });
  assert.ok(ac.ok, "the sweep runs");
  pins.forEach((p, i) => NG[p][0].forEach((db, k) => {
    const re = ac.probes[i].re[k], im = ac.probes[i].im[k]; let d = Math.abs(Math.atan2(im, re) * 180 / Math.PI - NG[p][1][k]) % 360; if (d > 180) d = 360 - d;
    assert.ok(Math.abs(20 * Math.log10(Math.hypot(re, im)) - db) < 0.02, `${p} at ${ac.freqs[k]} Hz: ${(20 * Math.log10(Math.hypot(re, im))).toFixed(3)} dB, ngspice ${db}`);
    assert.ok(d < 0.2, `${p} at ${ac.freqs[k]} Hz: phase ${d.toFixed(2)}° from ngspice`);
  }));
  // the diode's 100 pF at zero bias is 18 pF with 30 V across it
  const cj = els.find(e => /#cj$/i.test(e.id) || /#cj$/i.test(e.name || ""));
  assert.ok(cj && cj.junc && cj.c === 100e-12, "the capacitor keeps its zero-bias value and its law");
  assert.ok(!f.warnings.some(w => /transit time|zero-bias/.test(w)), "nothing is simplified away");
});

test("MOSFET levels 1, 2 and 3 by their own equations, with the bulk, its junctions and Meyer's gate capacitances, agree with ngspice", () => {
  // ngspice 42 on tests/fixtures/mosdev.lib: the operating point, then ac dec 1 1k 10Meg (dB and degrees at each pin)
  const DC = { ls: 0.692988, cs: 5.341496, l1: 2.146461, p3: 6.467345 };
  const NG = {
    ls: [[-2.16277, -2.16315, -2.20086, -4.90645, -21.6627], [-0.0224196, -0.534860, -5.36412, -43.2105, -84.1746]],
    cs: [[25.76580, 25.76569, 25.75452, 24.76121, 11.44818], [-179.998, 179.7104, 177.0757, 152.9298, 100.6738]],
    l1: [[25.39429, 25.39429, 25.39400, 25.36522, 23.16252], [-179.964, 179.9560, 179.5190, 175.1960, 139.4693]],
    p3: [[14.10788, 14.10788, 14.10788, 14.10786, 14.10591], [-179.968, -179.998, 179.9858, 179.8551, 178.5512]] };
  const text = fixture("mosdev.lib"), { v, f } = runSub(text, "bench");
  for (const k in DC) near(v[k], DC[k], 2e-4, `V(${k})`);
  assert.ok(!f.warnings.some(w => /level/i.test(w)), "no level is run as another");
  let n = f.nNodes;
  const els = SN.build({ text, sub: "bench" }, f.pins.map((_, i) => i + 1), () => n++, "U");
  const m4 = els.filter(e => e.kind === "MOS4");
  assert.deepEqual(m4.map(e => e.model.level).sort(), [1, 2, 2, 2, 3, 3], "each MOSFET by its own level, with its bulk");
  const pins = Object.keys(NG), ac = E.acSweep({ nodeCount: n, elements: els }, { inputs: [{ id: els.find(e => /#vin$/i.test(e.id)).id }], fStart: 1e3, fStop: 1e7, perDecade: 1, probes: pins.map(p => [f.pins.indexOf(p) + 1, 0]) });
  assert.ok(ac.ok, "the sweep runs");
  pins.forEach((p, i) => NG[p][0].forEach((db, k) => {
    const re = ac.probes[i].re[k], im = ac.probes[i].im[k]; let d = Math.abs(Math.atan2(im, re) * 180 / Math.PI - NG[p][1][k]) % 360; if (d > 180) d = 360 - d;
    assert.ok(Math.abs(20 * Math.log10(Math.hypot(re, im)) - db) < 0.05, `${p} at ${ac.freqs[k]} Hz: ${(20 * Math.log10(Math.hypot(re, im))).toFixed(3)} dB, ngspice ${db}`);
    assert.ok(d < 0.3, `${p} at ${ac.freqs[k]} Hz: phase ${d.toFixed(2)}° from ngspice`);
  }));
  // the drain and source swap when the drain goes below the source; the bulk below the source raises the threshold
  const m = m4.find(e => e.model.level === 3 && e.model.pol > 0).model;
  const I = V => E.Semi.mosx(V, m)[0];
  near(I([0, 8, 2, 0]), -I([2, 8, 0, 0]), 1e-12, "reversed, the same current the other way");
  const m1 = m4.find(e => e.model.level === 1).model, I1 = V => E.Semi.mosx(V, m1)[0];
  assert.ok(I1([10, 4, 0, -5]) < 0.5 * I1([10, 4, 0, 0]), "the body effect (GAMMA): less current with the bulk 5 V below the source");
  assert.throws(() => SN.flatten(".model MB NMOS(LEVEL=8)\n.subckt f d g s\nM1 d g s s MB\n.ends", "f"), /level 8/i);
});

test("LAPLACE sources: PSpice's and LTspice's spellings, the response a ratio of polynomials in s gives, exactly", () => {
  const text = `.param fc=1k
.subckt f in lp hp bp g4
E1 lp 0 LAPLACE {V(in)} = {1/(1+1.41421356*s/(2*pi*fc)+(s/(2*pi*fc))**2)}
E2 hp 0 in 0 Laplace=s/(s+628.318531)
B3 bp 0 V=0.5*V(in)+0.1 Laplace=(s/1e4)/(1+s/1e4+(s/1e4)^2)
G4 0 g4 LAPLACE {V(in)} = {1m*(1+s/1e3)/(1+s/1e5)}
R4 g4 0 1k
.ends`;
  const H = [
    s => 1 / (1 + 1.41421356 * s / (2 * Math.PI * 1e3) + (s / (2 * Math.PI * 1e3)) ** 2),
    s => s / (s + 628.318531),
    s => 0.5 * (s / 1e4) / (1 + s / 1e4 + (s / 1e4) ** 2),
    s => 1 * (1 + s / 1e3) / (1 + s / 1e5)];
  const f = SN.flatten(text, "f"); let n = f.nNodes;
  const els = SN.build({ text, sub: "f" }, [1, 2, 3, 4, 5], () => n++, "U");
  els.push({ id: "vin", kind: "V", nodes: [1, 0], v: 0.5 });
  const ac = E.acSweep({ nodeCount: n, elements: els }, { inputs: [{ id: "vin" }], fStart: 10, fStop: 1e5, perDecade: 2, probes: [[2, 0], [3, 0], [4, 0], [5, 0]] });
  assert.ok(ac.ok, "the sweep runs");
  // complex arithmetic on [re, im]: each H at jω
  const C = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; } };
  const Hc = [
    w => C.div([1, 0], C.add(C.add([1, 0], [0, 1.41421356 * w / (2 * Math.PI * 1e3)]), [-((w / (2 * Math.PI * 1e3)) ** 2), 0])),
    w => C.div([0, w], [628.318531, w]),
    w => C.div([0, 0.5 * w / 1e4], [1 - (w / 1e4) ** 2, w / 1e4]),
    w => C.div([1, w / 1e3], [1, w / 1e5])];
  ac.freqs.forEach((fq, k) => Hc.forEach((h, i) => {
    const want = h(2 * Math.PI * fq), got = [ac.probes[i].re[k], ac.probes[i].im[k]];
    assert.ok(Math.hypot(got[0] - want[0], got[1] - want[1]) <= 1e-6 * Math.hypot(...want) + 1e-12, `output ${i + 1} at ${fq} Hz: ${got} against ${want}`);
  }));
  // the operating point is H(0) times the input (the band-pass's offset blocked)
  const r = E.simulate({ nodeCount: n, elements: els });
  assert.ok(r.ok, r.error);
  [[2, H[0](0) * 0.5], [3, 0], [4, 0], [5, 0.5]].forEach(([k, v]) => assert.ok(Math.abs(r.dc.nodes[k] - v) < 1e-6, `node ${k}: ${r.dc.nodes[k]} V, H(0) gives ${v} V`));
});

test("a FREQ table is fitted by a ratio of polynomials: a third-order Butterworth's table gives its response back", () => {
  const text = fixture("lapdev.lib"), f = SN.flatten(text, "filters");
  assert.ok(f.warnings.some(w => /E5: its FREQ table is run as a fitted transfer function of order \d+ \(within 0\.01 dB and 0\.1°/.test(w)), f.warnings.join("; "));
  let n = f.nNodes;
  const els = SN.build({ text, sub: "filters" }, [1, 2, 3, 4, 5, 6], () => n++, "U");
  els.push({ id: "vin", kind: "V", nodes: [1, 0], v: 0 });
  const ac = E.acSweep({ nodeCount: n, elements: els }, { inputs: [{ id: "vin" }], fStart: 10, fStop: 1e5, perDecade: 5, probes: [[6, 0]] });
  ac.freqs.forEach((fq, k) => {
    const p = fq / 5000, re = 1 - 2 * p * p, im = 2 * p - p * p * p, d = re * re + im * im, want = [re / d, -im / d], got = [ac.probes[0].re[k], ac.probes[0].im[k]];
    assert.ok(Math.abs(20 * Math.log10(Math.hypot(...got) / Math.hypot(...want))) < 0.01, `${fq} Hz: ${20 * Math.log10(Math.hypot(...got))} dB`);
  });
  assert.throws(() => SN.flatten(".subckt f a b\nE1 b 0 FREQ {V(a)} = (10, 0, 0) (100, -1, -10) (1k, -3, -45) DELAY=1u\n.ends", "f"), /DELAY/);
});

test("a lossless transmission line: its three spellings, and a matched line delays the wave by TD", () => {
  const line = spec => { const text = `.subckt f a b\n${spec}\n.ends`; let n = 3; return SN.build({ text, sub: "f" }, [1, 2], () => n++, "U").find(e => e.kind === "TLINE"); };
  const t1 = line("T1 a 0 b 0 Z0=50 TD=25u"), t2 = line("T1 a 0 b 0 Z0=75 F=10k NL=0.5"), t3 = line("T1 a 0 b 0 L=250n C=100p LEN=2"), t4 = line("T1 a 0 b 0 Z0=600 F=1Meg");
  assert.equal(t1.z0, 50); near(t1.td, 25e-6, 1e-12, "TD");
  assert.equal(t2.z0, 75); near(t2.td, 50e-6, 1e-12, "TD from F and NL");
  near(t3.z0, 50, 1e-12, "Z0 from L and C"); near(t3.td, 2 * 5e-9, 1e-12, "TD from L, C and LEN");
  near(t4.td, 0.25e-6, 1e-12, "a quarter wave when NL is left out");
  // 10 kHz through 50 Ω, a 50 Ω line of a quarter period and 50 Ω: half the source, 25 µs late
  const els = [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1e4, amp: 1 }, { id: "R1", kind: "R", nodes: [1, 2], r: 50 },
    { id: "T", kind: "TLINE", nodes: [2, 0, 3, 0], z0: 50, td: 25e-6 }, { id: "R2", kind: "R", nodes: [3, 0], r: 50 }];
  const r = E.simulate({ nodeCount: 4, elements: els });
  assert.ok(r.ok, r.error);
  const T = r.tran, lag = Math.round(25e-6 / T.dt);
  let worst = 0;
  for (let j = lag; j < T.samples; j++) worst = Math.max(worst, Math.abs(T.nodes[3][j] - 0.5 * T.nodes[1][j - lag]), Math.abs(T.nodes[2][j] - 0.5 * T.nodes[1][j]));
  assert.ok(worst < 0.005, `the delayed wave is off by ${worst} V`);
  // in AC: the same, e^(−jωTD) at 10 kHz is −j
  const ac = E.acSweep({ nodeCount: 4, elements: els }, { inputs: [{ id: "G" }], fStart: 1e4, fStop: 1e4, perDecade: 1, probes: [[3, 0]] });
  assert.ok(Math.abs(ac.probes[0].re[0]) < 1e-9 && Math.abs(ac.probes[0].im[0] + 0.5) < 1e-9, `${ac.probes[0].re[0]} ${ac.probes[0].im[0]}`);
});

test("a junction's capacitance in the waveform: the corner of 100 kΩ and a diode follows the bias", () => {
  // 100 pF at zero bias: C = 100 pF · (1 + V / 0.7)^−0.45; a sine at that corner comes out at 0.707
  const text = ".model DV D(IS=1e-14 CJO=100p VJ=0.7 M=0.45)\n.subckt dio a k\nD1 a k DV\n.ends";
  const gain = bias => {
    const c = 100e-12 * Math.pow(1 + bias / 0.7, -0.45), freq = 1 / (2 * Math.PI * 100e3 * c);
    let n = 3;
    const els = [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq, amp: 0.2, offset: bias }, { id: "R", kind: "R", nodes: [1, 2], r: 100e3 }];
    SN.build({ text, sub: "dio" }, [0, 2], () => n++, "D").forEach(e => els.push(e));
    const r = E.simulate({ nodeCount: n, elements: els });
    assert.ok(r.ok, r.error);
    const [lo, hi] = swing(r, 2);
    return (hi - lo) / 0.4;
  };
  near(gain(5), Math.SQRT1_2, 0.03, "5 V in reverse");
  near(gain(30), Math.SQRT1_2, 0.03, "30 V in reverse");
});

test("what cannot be simulated is refused with the reason", () => {
  assert.throws(() => SN.flatten(".subckt f a b\nE1 b 0 LAPLACE {V(a)} = {exp(-s*1u)/(1+s)}\n.ends", "f"), /ratio of polynomials/i);
  assert.throws(() => SN.flatten(".subckt f a b\nE1 b 0 LAPLACE {V(a)} = {1+s}\n.ends", "f"), /differentiator/i);
  assert.throws(() => SN.flatten(".subckt f a b\nT1 a 0 b 0 Z0=50 TD=1n R=1 L=1u C=1p LEN=1\n.ends", "f"), /lossy line/i);
  assert.throws(() => SN.flatten(".subckt f a b\nO1 a 0 b 0 LOSSY\n.model LOSSY LTRA(R=1 L=1u C=1p LEN=1)\n.ends", "f"), /lossy transmission line/i);
  assert.throws(() => SN.flatten(".subckt f a b\nT1 a 0 b 0 Z0=50\n.ends", "f"), /needs Z0= and TD=/i);
  assert.throws(() => SN.flatten(".subckt f a b\nX1 a b nothere\n.ends", "f"), /nothere/i);
  assert.throws(() => SN.flatten(AMP, "other"), /no \.SUBCKT or \.MODEL/i);
});

test("a SPICE part with an op-amp's model, in the op-amp's symbol: gain, the rails, the model's own pole", () => {
  // ×11 non-inverting: 0.5 V peak gives 5.5 V peak
  let r = E.simulate(circuit([...SUPPLY, gen({ amp: 0.5, freq: 100 }, 3), R(10e3, 5, 4), R(1e3, 4, 0), R(10e3, 5, 0), spiceAmp({ "+": 3, "-": 4, OUT: 5 })]), { budgetMs: 20000 });
  assert.ok(r.ok, r.error);
  let [lo, hi] = swing(r, 5);
  near(hi, 5.5, 5e-3, "×11, positive peak"); near(lo, -5.5, 5e-3, "×11, negative peak");
  // 3 V peak: the model's clamps a volt and a half inside ±15 V
  r = E.simulate(circuit([...SUPPLY, gen({ amp: 3, freq: 1000 }, 3), R(10e3, 5, 4), R(1e3, 4, 0), R(10e3, 5, 0), spiceAmp({ "+": 3, "-": 4, OUT: 5 })]), { budgetMs: 20000 });
  [lo, hi] = swing(r, 5);
  assert.ok(hi > 13 && hi < 14.5 && lo < -13 && lo > -14.5, `clips inside the rails (${lo.toFixed(2)} … ${hi.toFixed(2)} V)`);
  // open loop: 100 dB at DC, one pole at 1 Hz, so ×100 at 1 kHz (a follower's bandwidth 100 kHz)
  const nl = circuit([...SUPPLY, gen({ amp: 1e-3, freq: 1000 }, 3), R(10e3, 5, 0), spiceAmp({ "+": 3, "-": 5, OUT: 5 })]);
  const ac = E.acSweep(nl, { inputs: [{ id: "gen" }], fStart: 1e3, fStop: 1e7, perDecade: 50, probes: [[5, 0]] });
  const g = Array.from(ac.freqs, (f, k) => Math.hypot(ac.probes[0].re[k], ac.probes[0].im[k])), k3 = g.findIndex(x => x < Math.SQRT1_2);
  near(ac.freqs[k3], 100e3, 0.08, "follower −3 dB at the model's gain-bandwidth");
});

test("a SPICE part's pins: ground, left open, and a model that fails leaves the part out", () => {
  const p = { name: "h", text: DEV, sub: "halver", sym: "box", pinNames: ["in", "out"], map: ["1", "2"] };
  let r = E.simulate(circuit([{ type: "vdc", params: { v: 8 }, pins: { "+": 1, "-": 0 } }, { id: "U", type: "spice", params: p, pins: { 1: 1, 2: 2 } }]), {});
  near(r.dc.nodes[2], 4, 1e-6, "half of 8 V");
  // the input to ground: 0 V out; left open: a gigohm keeps it from floating
  r = E.simulate(circuit([{ type: "vdc", params: { v: 8 }, pins: { "+": 1, "-": 0 } }, R(1e3, 1, 0), { id: "U", type: "spice", params: { ...p, map: ["0", "2"] }, pins: { 2: 2 } }]), {});
  assert.ok(r.ok && Math.abs(r.dc.nodes[2]) < 1e-9, "input grounded");
  r = E.simulate(circuit([{ type: "vdc", params: { v: 8 }, pins: { "+": 1, "-": 0 } }, R(1e3, 1, 0), { id: "U", type: "spice", params: { ...p, map: ["", "2"] }, pins: { 2: 2 } }]), {});
  assert.ok(r.ok, "an open pin does not float");
  const els = [];
  const bad = { id: "U", type: "spice", label: "DA1", params: { ...p, text: ".subckt halver in out\nA1 in out filt\n.ends" } };
  assert.match(L.spiceElements(bad, () => 1, () => 2, els), /A1/);
  assert.equal(els.length, 0, "nothing of it in the netlist");
  assert.match(L.LIB.spice.info(bad), /cannot be simulated/);
  assert.match(L.LIB.spice.info({ params: L.LIB.spice.defaults }), /No model yet/);
});

test("a SPICE part takes the pins and the letter of its symbol", () => {
  const c = sym => ({ params: { ...L.LIB.spice.defaults, sym, pinNames: ["a", "b", "c", "d", "e"], map: [] } });
  assert.deepEqual(L.LIB.spice.pins(c("opamp")).map(p => p.id).sort(), ["+", "-", "OUT", "V+", "V-"]);
  assert.deepEqual(L.LIB.spice.pins(c("nmos")).map(p => p.id).sort(), ["D", "G", "S"]);
  assert.deepEqual(L.LIB.spice.pins(c("box")).map(p => [p.id, p.name]), [["1", "a"], ["2", "b"], ["3", "c"], ["4", "d"], ["5", "e"]]);
  assert.deepEqual(["opamp", "npn", "diode", "box"].map(s => L.LIB.spice.prefixFor(c(s))), ["DA", "VT", "VD", "DA"]);
});

test("on the board: an op-amp's DIP-8, a transistor's cases by pin letters, a box in a DIP in the model's pin order", () => {
  const part = (sym, pinNames, map, nets) => ({ parts: [{ id: "u", type: "spice", label: "DA1", params: { ...L.LIB.spice.defaults, sym, pinNames, map }, pins: Object.entries(nets).map(([id, net]) => ({ id, net })) }] });
  const pads = (g, name) => { const out = {}; B.padMap(g, B.footprint(name, g.members[0].pins.map(p => p.id))).forEach((list, num) => list.forEach(x => { out[x.pin] = num; })); return out; };
  let [g] = B.physicalParts(part("opamp", ["inp", "inn", "vcc", "vee", "out"], ["+", "-", "V+", "V-", "OUT"], { "+": 1, "-": 2, "V+": 3, "V-": 4, OUT: 5 }));
  assert.equal(g.options[0], "DIP-8"); assert.ok(g.options.includes("SOIC-8"));
  assert.deepEqual(pads(g, "DIP-8"), { "+": "3", "-": "2", "V+": "7", "V-": "4", OUT: "6" });
  [g] = B.physicalParts(part("npn", ["c", "b", "e"], ["C", "B", "E"], { C: 1, B: 2, E: 3 }));
  assert.equal(g.options[0], "TO-92-EBC");
  assert.deepEqual(pads(g, "TO-92-EBC"), { E: "1", B: "2", C: "3" }); assert.deepEqual(pads(g, "TO-220-ECB"), { E: "1", C: "2", B: "3" });
  [g] = B.physicalParts(part("nmos", ["d", "g", "s"], ["D", "G", "S"], { D: 1, G: 2, S: 3 }));
  assert.equal(g.options[0], "TO-220-GDS"); assert.deepEqual(pads(g, "TO-220-GDS"), { G: "1", D: "2", S: "3" });
  [g] = B.physicalParts(part("diode", ["a", "k"], ["A", "K"], { A: 1, K: 2 }));
  assert.deepEqual(pads(g, g.options[0]), { K: "1", A: "2" });
  [g] = B.physicalParts(part("box", ["in", "gnd", "en", "fb", "out", "nc"], ["1", "2", "3", "4", "5", "6"], { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 }));
  assert.equal(g.options[0], "DIP-8"); assert.deepEqual(pads(g, "DIP-8"), { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6" });
  for (const o of g.options) assert.ok(B.footprint(o, g.members[0].pins.map(p => p.id)), o);
});

test("a source's value may be written DC=… (as some makers' files do)", () => {
  const text = ".subckt b out\nI1 0 out DC=2m\nR1 out 0 1k\n.ends", f = SN.flatten(text, "b");
  let n = f.nNodes;
  const els = SN.build({ text, sub: "b" }, f.pins.map((_, i) => i + 1), () => n++, "U");
  const r = E.simulate({ nodeCount: n, elements: els }, {});
  assert.ok(r.ok && Math.abs(r.dc.nodes[1] - 2) < 1e-6, `2 mA into 1 k: ${r.ok ? r.dc.nodes[1] : r.error}`);
});
