/**
 * Loop gain and noise (sim-engine.js loopGain, noiseSweep; cad-noise.js): Middlebrook's double
 * injection against a loop worked out by hand, thermal and tube noise against their formulas,
 * A-weighting and the band integral.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import "../spice-model.js";
import "../sim-engine.js";

runInThisContext(readFileSync(new URL("../cad-noise.js", import.meta.url), "utf8"), { filename: "cad-noise.js" });
const E = globalThis.TubeSimEngine, N = globalThis.CadNoise;
const kT = 1.380649e-23 * 300;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-300), `${msg}: ${a} vs ${b}`);

// An inverting amplifier of gain A (a VCVS) with output resistance Ro, fed back through Rs into
// Rin ‖ C, the node it senses: T = A·Zin / (Zin + Rs + Ro)
const A = 10, Ro = 100, Rs = 1000, Rin = 1000, C = 1e-6;
const loop = { nodeCount: 4, elements: [
  { id: "E1", kind: "E", nodes: [3, 0, 0, 2], gain: A },
  { id: "Ro", kind: "R", nodes: [3, 1], r: Ro },
  { id: "Rs", kind: "R", nodes: [1, 2], r: Rs },
  { id: "Rin", kind: "R", nodes: [2, 0], r: Rin },
  { id: "C1", kind: "C", nodes: [2, 0], c: C }
] };
const expected = f => {
  const w = 2 * Math.PI * f, yr = 1 / Rin, yi = w * C, m = yr * yr + yi * yi, zr = yr / m, zi = -yi / m;
  const dr = zr + Rs + Ro, di = zi, dm = dr * dr + di * di;
  return [A * (zr * dr + zi * di) / dm, A * (zi * dr - zr * di) / dm];
};

test("loopGain: the return ratio of a loop worked out by hand, at every frequency", () => {
  const r = E.loopGain(loop, { at: { id: "Rs", pin: 0 }, fStart: 1, fStop: 1e5, perDecade: 4 });
  assert.ok(r.ok);
  for (let k = 0; k < r.freqs.length; k++) {
    const [er, ei] = expected(r.freqs[k]), mag = Math.hypot(er, ei);
    close(Math.hypot(r.re[k], r.im[k]), mag, 1e-6, `|T| at ${r.freqs[k]} Hz`);
    assert.ok(Math.abs(Math.atan2(r.im[k], r.re[k]) - Math.atan2(ei, er)) < 1e-6, `phase at ${r.freqs[k]} Hz`);
  }
});

test("loopGain: broken elsewhere along the loop (at the amplifier's output) it reads the same", () => {
  const r = E.loopGain(loop, { at: { id: "Ro", pin: 0 }, fStart: 10, fStop: 1e4, perDecade: 2 });
  const s = E.loopGain(loop, { at: { id: "Rs", pin: 0 }, fStart: 10, fStop: 1e4, perDecade: 2 });
  for (let k = 0; k < r.freqs.length; k++) close(Math.hypot(r.re[k], r.im[k]), Math.hypot(s.re[k], s.im[k]), 1e-6, `|T| at ${r.freqs[k]} Hz`);
});

test("loopGain: a missing part or pin is an error, not a crash", () => {
  assert.equal(E.loopGain(loop, { at: { id: "R99", pin: 0 } }).ok, false);
  assert.equal(E.loopGain(loop, { at: { id: "Rs", pin: 2 } }).ok, false);
});

test("noiseSweep: a resistor is 4kTR, two in parallel 4kT·(R1‖R2), and the gain from a source", () => {
  const one = E.noiseSweep({ nodeCount: 2, elements: [{ id: "R1", kind: "R", nodes: [1, 0], r: 1000 }] }, { out: [1, 0], fStart: 100, fStop: 1e4, perDecade: 1 });
  one.total.forEach(v => close(v, 4 * kT * 1000, 1e-6, "4kTR"));
  // a 1 V source behind 1k into 3k: the gain is 0.75, the noise that of 750 Ω
  const div = E.noiseSweep({ nodeCount: 3, elements: [
    { id: "G1", kind: "VSRC", nodes: [2, 0], wave: "sine", freq: 1000, amp: 1 },
    { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "R2", kind: "R", nodes: [1, 0], r: 3000 }
  ] }, { out: [1, 0], input: "G1", fStart: 1000, fStop: 2000, perDecade: 1 });
  close(div.total[0], 4 * kT * 750, 1e-6, "4kT(R1‖R2)");
  close(Math.hypot(div.gain.re[0], div.gain.im[0]), 0.75, 1e-9, "gain");
  close(div.sources.find(s => s.id === "R1").psd[0] / div.total[0], 0.75, 1e-6, "R1's share (3k/(1k+3k))");
});

test("noiseSweep: a triode's noise is 4kT·(2.5/gm) at its grid, rising as 1/f below the corner", () => {
  // grounded cathode, anode through 100k to 250 V, the grid at −1.5 V: the noise at the anode over the gain²
  const el = [
    { id: "B1", kind: "V", nodes: [1, 0], v: 250 }, { id: "Ra", kind: "R", nodes: [1, 2], r: 100e3 },
    { id: "VL1", kind: "TRIODE", nodes: [2, 3, 0], model: { mu: 100, kg: 1060, kp: 600, kvb: 300, x: 1.4 } },
    { id: "Bg", kind: "V", nodes: [3, 0], v: -1.5 }
  ];
  const r = E.noiseSweep({ nodeCount: 4, elements: el }, { out: [2, 0], fStart: 1000, fStop: 1e4, perDecade: 1, flicker: 1000 });
  const tube = r.sources.find(s => s.id === "VL1");
  // gm and the gain at the operating point, by differences of the engine's own currents
  const dc = E.dcOperatingPoint(E.buildCircuit({ nodeCount: 4, elements: el }));
  const va = dc.x[1], ia = v => E.Tube.triode(va, v, el[2].model)[0], gm = (ia(-1.5 + 1e-4) - ia(-1.5 - 1e-4)) / 2e-4;
  const rp = 1e-4 / (E.Tube.triode(va + 5e-5, -1.5, el[2].model)[0] - E.Tube.triode(va - 5e-5, -1.5, el[2].model)[0]);
  const g = gm * (rp * 100e3 / (rp + 100e3));
  close(tube.psd[1] / (g * g), 4 * kT * 2.5 / gm * 1.1, 0.01, "input-referred at 10 kHz, 1/f a tenth of it");
  close(tube.psd[0] / tube.psd[1], 2 / 1.1, 0.01, "at the corner: twice the white noise");
});

test("A-weighting: 0 dB at 1 kHz, −19.1 dB at 100 Hz, −30.2 dB at 50 Hz; the band integral of white noise", () => {
  close(N.aWeight(1000), 1, 2e-3, "1 kHz");
  close(20 * Math.log10(N.aWeight(100)), -19.1, 5e-3, "100 Hz");
  close(20 * Math.log10(N.aWeight(50)), -30.2, 5e-3, "50 Hz");
  const f = [], p = [];
  for (let k = 0; k <= 80; k++) { f.push(10 * Math.pow(10, k / 20)); p.push(1); }
  close(N.bandPower(f, p, 20, 20000), 19980, 2e-3, "∫ 1 df over 20 Hz – 20 kHz");
  // A-weighted white noise over 20 Hz – 20 kHz is about 2 dB below flat
  const aw = 10 * Math.log10(N.bandPower(f, p, 20, 20000, N.aWeight) / 19980);
  assert.ok(aw > -2.5 && aw < -1.8, `A-weighted against flat: ${aw} dB`);
});

test("heaterDrive: half the heater voltage with one side grounded, 5 % of that centre-tapped, none on DC", () => {
  assert.equal(N.heaterDrive("ground", 6.3), 3.15);
  close(N.heaterDrive("ct", 6.3), 0.1575, 1e-12, "centre-tapped");
  assert.equal(N.heaterDrive("dc", 6.3), 0);
});
