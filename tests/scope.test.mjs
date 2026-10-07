/**
 * Oscilloscope auto-ranging (scope-math.js), on synthetic periodic captures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../scope-math.js", import.meta.url), "utf8"), { filename: "scope-math.js" });
const M = globalThis.ScopeMath;

/** Whole-period capture of f(t): `base` periods of fBase, sample P == sample 0. */
function capture(fn, fBase, samples = 4000, periods = 1) {
  const T = periods / fBase, dt = T / samples, a = new Float32Array(samples + 1);
  for (let i = 0; i <= samples; i++) a[i] = fn(i * dt);
  return { a, dt };
}
const sin = (f, ph = 0) => t => Math.sin(2 * Math.PI * f * t + ph);
/** How many divisions the trace occupies above/below centre after scaling. */
const extent = (a, ch) => { const st = M.stats(a); return [(st.max - ch.off) / ch.vdiv, (st.min - ch.off) / ch.vdiv]; };

test("plain 1 kHz sine: 0.5 V/div, centred, 1 kHz measured", () => {
  const { a, dt } = capture(sin(1000), 1000);
  const ch = M.channel(a, "auto", "dc");
  assert.equal(ch.vdiv, 0.5); assert.equal(ch.off, 0); assert.equal(ch.offset, 0);
  assert.ok(Math.abs(M.fundamental(a, dt) - 1000) < 1);
  assert.equal(M.timebase(a, dt).tdiv, 2e-4);
});

test("plate signal on 180 V DC (DC coupled): auto shifts the trace instead of squashing it", () => {
  const { a } = capture(t => 180 + 22 * Math.sin(2 * Math.PI * 1000 * t), 1000);
  const ch = M.channel(a, "auto", "dc");
  // the old rule (fit 0 V..peak) picked 100 V/div: a 0.44-division wiggle
  assert.equal(ch.vdiv, 10);
  assert.equal(ch.offset, 180);
  const [top, bottom] = extent(a, ch);
  assert.ok(top <= 4 && bottom >= -4 && top - bottom > 3.5, `trace spans ${bottom.toFixed(2)}..${top.toFixed(2)} div`);
});

test("supply ripple: timebase follows the probed 100 Hz, not the 1 kHz generator", () => {
  // capture spans the 100 Hz base period; the generator frequency is only a fallback
  const { a, dt } = capture(t => 381 + 0.6 * Math.abs(Math.sin(2 * Math.PI * 50 * t)), 100, 4000, 1);
  const tb = M.timebase(a, dt, 1000);
  assert.ok(Math.abs(tb.f - 100) < 0.5, `measured ${tb.f} Hz`);
  assert.equal(tb.tdiv, 2e-3);
  const ch = M.channel(a, "auto", "dc");
  assert.ok(ch.offset > 370 && ch.vdiv <= 0.1, `${ch.vdiv} V/div, offset ${ch.offset}`);
});

test("harmonic-rich and noisy waves still measure the fundamental", () => {
  let seed = 7; const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.06;
  const { a, dt } = capture(t => Math.sin(2 * Math.PI * 440 * t) + 0.45 * Math.sin(2 * Math.PI * 1320 * t + 0.7) + noise(), 440, 4000, 3);
  assert.ok(Math.abs(M.fundamental(a, dt) - 440) < 0.5, `measured ${M.fundamental(a, dt)}`);
  assert.equal(M.edges(a, "rising").length, 3);
});

test("flat DC levels: no blown-up solver noise", () => {
  const { a } = capture(t => 250 + 1e-9 * Math.sin(2 * Math.PI * 1000 * t), 1000);
  const ch = M.channel(a, "auto", "dc");
  assert.ok(M.isFlat(ch.st));
  assert.equal(ch.vdiv, 100); assert.equal(ch.off, 0);
  const z = M.channel(capture(t => 1e-12 * Math.sin(t * 1e4), 1000).a, "auto", "dc");
  assert.equal(z.vdiv, 0.001); assert.equal(M.triggerIndex(capture(() => 5, 1000).a), 0);
});

test("AC coupling removes the DC level; manual V/div repositions only when needed", () => {
  const { a } = capture(t => 180 + 22 * Math.sin(2 * Math.PI * 1000 * t), 1000);
  const ac = M.channel(a, "auto", "ac");
  assert.ok(Math.abs(ac.off - 180) < 0.01 && ac.vdiv === 10 && ac.offset === 0);
  const man = M.channel(a, 20, "dc");
  assert.equal(man.offset, 180);
  const [top, bottom] = extent(a, man);
  assert.ok(top <= 4 && bottom >= -4);
  assert.equal(M.channel(a, 100, "dc").offset, 0);   // fits at 100 V/div: absolute display kept
});

test("trigger lands on the mid-level crossing for either slope", () => {
  const { a } = capture(sin(1000, 1.0), 1000, 4000);
  const P = a.length - 1, mid = M.stats(a).mid;
  const r = M.triggerIndex(a, "rising"), f = M.triggerIndex(a, "falling");
  assert.ok(M.at(a, r - 1) < mid && M.at(a, r) >= mid, "rising edge");
  assert.ok(M.at(a, f - 1) > mid && M.at(a, f) <= mid, "falling edge");
  assert.ok(Math.abs(((f - r + P) % P) - P / 2) < 3, "half a period apart");
});
