/**
 * Parameter sweep (cad-sweep.js): the values of a sweep and which of a part's fields it can step.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-sweep.js", import.meta.url), "utf8"), { filename: "cad-sweep.js" });
const { CadSweep: W } = globalThis;

test("values: linear or in even ratios, both ends included", () => {
  assert.deepEqual(W.values(0, 10, 6, false), [0, 2, 4, 6, 8, 10]);
  const v = W.values(50e3, 200e3, 5, true);
  assert.equal(v.length, 5); assert.ok(Math.abs(v[2] - 100e3) < 1e-6, "the middle of a log sweep is the geometric mean");
  assert.ok(Math.abs(v[1] / v[0] - v[4] / v[3]) < 1e-9);
  assert.deepEqual(W.values(-1, 1, 3, true), [-1, 0, 1], "a range through zero falls back to linear");
});

test("fieldsOf: numeric fields only, each once, and only those that apply", () => {
  const def = { fields: [
    { kind: "heading", label: "Signal" }, { key: "wave", label: "Waveform", kind: "select" },
    { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" }, { key: "amp", label: "Amplitude", unit: "Vpk", kind: "eng" },
    { key: "amp", label: "Amplitude", unit: "Vrms", kind: "level", as: "rms" }, { key: "pos", label: "Wiper", kind: "range", min: 0, max: 1 },
    { key: "rs", label: "Output impedance", unit: "Ω", kind: "eng", when: c => c.params.wave === "square" }
  ] };
  const f = W.fieldsOf(def, { params: { wave: "sine", freq: 1000, amp: 1, pos: 0.5, rs: 50 } });
  assert.deepEqual(f.map(x => x.key), ["freq", "amp", "pos"]);
  assert.equal(f[1].unit, "Vpk"); assert.ok(f[2].range);
});
