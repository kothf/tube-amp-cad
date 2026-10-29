/**
 * Power sweep (cad-power.js): the levels, which sources it scales, THD from harmonic amplitudes,
 * and where the THD marks fall between two levels.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-power.js", import.meta.url), "utf8"), { filename: "cad-power.js" });
const { CadPower: P } = globalThis;

test("levels: evenly spaced in dB, both ends included", () => {
  assert.deepEqual(P.levels(-24, 12, 19).filter((v, k) => k % 6 === 0), [-24, -12, 0, 12]);
  assert.equal(P.levels(-24, 12, 19).length, 19);
  assert.deepEqual(P.levels(0, 6, 1), [0, 6], "at least two levels");
});

test("scale: every signal source, not the mains nor DC supplies", () => {
  const net = { nodeCount: 3, elements: [
    { id: "G1", kind: "VSRC", nodes: [1, 0], amp: 0.5, freq: 1000, offset: 0.1 },
    { id: "G2", kind: "VSRC", nodes: [2, 0], amp: 325, freq: 50, acMains: true },
    { id: "GB1", kind: "V", nodes: [3, 0], v: 300 }
  ] };
  const s = P.scale(net, 2), el = id => s.elements.find(e => e.id === id);
  assert.equal(el("G1").amp, 1); assert.equal(el("G1").offset, 0.1, "the DC offset stays");
  assert.equal(el("G2").amp, 325); assert.equal(el("GB1").v, 300);
  assert.equal(net.elements[0].amp, 0.5, "the circuit's own netlist is not changed");
});

test("distortion: THD as the harmonics' rms against the fundamental", () => {
  const d = P.distortion([1, 0.03, 0.04]);
  assert.ok(Math.abs(d.thd - 5) < 1e-9);
  assert.deepEqual(d.rel, [0.03, 0.04]);
});

test("crossing: interpolated on log scales between the levels either side; null when never reached", () => {
  const pts = [{ db: 0, out: 1, thd: 0.1 }, { db: 6, out: 4, thd: 10 }];
  const c = P.crossing(pts, 1);
  assert.ok(Math.abs(c.out - 2) < 1e-9, `half way in log THD is half way in log power: ${c.out}`);
  assert.ok(Math.abs(c.db - 3) < 1e-9);
  assert.equal(P.crossing(pts, 20), null);
  assert.equal(P.crossing([{ db: 0, out: 1, thd: 2 }, { db: 6, out: 4, thd: 10 }], 1), null, "starting above the mark");
  assert.ok(Math.abs(P.crossing([{ db: 0, out: 1, thd: 0.1 }, { db: 3, pending: true }, { db: 6, out: 4, thd: 10 }], 1).db - 3) < 1e-9, "levels without a result are skipped");
});
