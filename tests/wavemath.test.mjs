/**
 * The Transient tab's waveform viewer: trace expressions and their units, the FFT (wave-math.js),
 * and the parts' currents the engine records for it (sim-engine.js transient, opts.currents) (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["sim-engine.js", "wave-math.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, W = globalThis.WaveMath;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ±${tol}`);

const N = 2001, t = Float64Array.from({ length: N }, (_, k) => k * 1e-5);
const OUT = t.map(x => 3 * Math.sin(2 * Math.PI * 500 * x)), IN = t.map(() => 1), IR = t.map(() => 2e-3);
const ctx = { t, volt: n => ({ OUT, IN, "P1 CH1": IN })[n.toUpperCase()] || null, cur: n => { if (n.toUpperCase() === "R1") return IR; throw new Error(`no part called ${n}`); } };
const ev = s => W.evaluate(W.parse(s), ctx);

test("expressions: nets, differences, currents, numbers with suffixes, functions", () => {
  assert.equal(ev("OUT").unit, "V");
  near(ev("V(OUT,IN)").y[50], OUT[50] - 1, 1e-12, "V(a,b)");
  near(ev("V(P1 CH1)").y[3], 1, 0, "a name with a space inside V()");
  near(ev("2.2k*I(R1)").y[0], 4.4, 1e-12, "2.2k");
  near(ev("1meg*I(r1)").y[0], 2000, 1e-9, "meg (and a lower-case part name)");
  near(ev("-OUT^2").y[50], -(OUT[50] ** 2), 1e-12, "unary minus before power");
  near(ev("(OUT+1)*2").y[50], (OUT[50] + 1) * 2, 1e-12, "brackets");
  near(ev("max(OUT, 0)").y[150], 0, 0, "max (OUT is negative there)");
  near(ev("db(IN*10)").y[0], 20, 1e-12, "db");
  near(ev("V(OUT,0)").y[50], OUT[50], 0, "V(a, ground)");
  near(ev("time*1k").y[100], 1, 1e-12, "time");
});

test("units follow the arithmetic", () => {
  assert.equal(ev("V(OUT)*I(R1)").unit, "W");
  assert.equal(ev("V(IN)/I(R1)").unit, "Ω");
  assert.equal(ev("I(R1)*I(R1)").unit, "A²");
  assert.equal(ev("d(OUT)").unit, "V/s");
  assert.equal(ev("integ(I(R1))").unit, "C");
  assert.equal(ev("integ(V(OUT)*I(R1))").unit, "J");
  assert.equal(ev("OUT+1").unit, "V");
  assert.equal(ev("OUT/IN").unit, "");
  assert.equal(ev("db(OUT)").unit, "dB");
});

test("d() and integ() over time", () => {
  const d = ev("d(OUT)").y, k = 300, exact = 3 * 2 * Math.PI * 500 * Math.cos(2 * Math.PI * 500 * t[k]);
  near(d[k], exact, Math.abs(exact) * 0.01 + 50, "the derivative of a sine");
  const q = ev("integ(I(R1))").y;
  near(q[N - 1], 2e-3 * t[N - 1], 1e-12, "the integral of a constant");
});

test("mistakes are named", () => {
  assert.throws(() => W.parse("OUT+"), /ends too soon/);
  assert.throws(() => W.parse("foo(OUT)"), /no function called foo/);
  assert.throws(() => W.parse("(OUT"), /not closed/);
  assert.throws(() => W.parse("OUT OUT"), /left over/);
  assert.throws(() => ev("NOPE*2"), /no net called NOPE/);
  assert.throws(() => ev("I(Q7)"), /no part called Q7/);
  assert.deepEqual(W.refs(W.parse("V(A,B)+I(R2)*C")), { nets: ["A", "B", "C"], parts: ["R2"] });
});

test("the FFT reads a sine's frequency and amplitude, and a square's harmonics", () => {
  const sp = W.fft(t, OUT, 0, 0.02);
  const pk = W.peak(sp);
  near(pk.f, 500, 2, "the peak's frequency");
  near(pk.a, 3, 0.03, "the peak's amplitude");
  const sq = t.map(x => (Math.sin(2 * Math.PI * 500 * x) >= 0 ? 1 : -1)), s2 = W.fft(t, sq, 0, 0.02);
  const bin = f => s2.a[Math.round(f / s2.df)];
  near(bin(500), 4 / Math.PI, 0.05, "a square's fundamental, 4/π");
  near(bin(1500), 4 / Math.PI / 3, 0.03, "its third harmonic, a third of it");
  assert.ok(bin(1000) < 0.02, "no even harmonics");
});

test("the run records every part's current (opts.currents): a capacitor charging through a resistor", () => {
  // 5 V step through 1 kΩ into 1 µF: i = 5 mA·e^(−t/RC) in both, into R's first pin and C's
  const r = E.transient({ nodeCount: 3, elements: [
    { id: "V1", kind: "VSRC", nodes: [1, 0], v: 0, tw: { type: "pulse", v1: 0, v2: 5, td: 0, tr: 1e-9, tf: 1e-9, pw: 1, per: 0 } },
    { id: "R1", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "C1", kind: "C", nodes: [2, 0], c: 1e-6 }
  ] }, { tStop: 5e-3, uic: true, currents: true });
  assert.ok(r.ok, r.error);
  const curOf = (id, node) => { const k = r.pinI.ids.findIndex(([i, n]) => i === id && n === node); assert.ok(k >= 0, `${id} at node ${node} recorded`); return r.pinI.vals[k]; };
  const iR = curOf("R1", 1), iC = curOf("C1", 2), iRb = curOf("R1", 2);
  for (const x of [0.5e-3, 1e-3, 2e-3, 4e-3]) {
    const k = r.t.findIndex(v => v >= x), exact = 5e-3 * Math.exp(-r.t[k] / 1e-3);
    near(iR[k], exact, 5e-3 * 0.01, `I(R1) at ${x * 1e3} ms`);
    near(iC[k], exact, 5e-3 * 0.03, `I(C1) at ${x * 1e3} ms (from its charge over the step)`);
    near(iRb[k], -iR[k], 1e-12, "the same current leaves by the other pin");
  }
  const plain = E.transient({ nodeCount: 3, elements: [{ id: "V1", kind: "V", nodes: [1, 0], v: 1 }, { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C1", kind: "C", nodes: [2, 0], c: 1e-6 }] }, { tStop: 1e-3 });
  assert.equal(plain.pinI, null, "without opts.currents nothing extra is kept");
});

test("measurements (SPICE's .meas) over a span", () => {
  const x = Float64Array.from({ length: 20001 }, (_, k) => k * 1e-6);
  const sq = x.map(v => ((v * 1000) % 1 < 0.3 ? 5 : 0));
  const m = (k, y, p, x0 = 0, x1 = 0.02) => W.measure(k, x, y, x0, x1, p);
  near(m("freq", sq), 1000, 0.01, "frequency of a 1 kHz square");
  near(m("period", sq), 1e-3, 1e-8, "its period");
  near(m("duty", sq), 30, 0.1, "its duty cycle");
  near(m("avg", sq), 1.5, 0.01, "its average");
  near(m("rms", sq), Math.sqrt(0.3 * 25), 0.01, "its RMS");
  near(m("pp", sq), 5, 0, "peak to peak");
  near(m("at", sq, { at: 0.0002 }), 5, 0, "value at a time");
  near(m("when", sq, { level: 2.5 }, 0.0005), 0.001, 2e-6, "first crossing after the span's start");
  const rc = x.map(v => 1 - Math.exp(-v / 1e-3));
  near(m("rise", rc), 1e-3 * Math.log(9), 2e-6, "an RC's rise time is RC·ln 9");
  near(m("slope", rc, { at: 1e-3 }), Math.exp(-1) / 1e-3, 1, "its slope at RC");
  near(m("integ", rc.map(() => 2), {}, 0, 0.01), 0.02, 1e-12, "the integral of a constant");
  const ring = x.map(v => 1 - Math.exp(-v / 2e-3) * Math.cos(2 * Math.PI * 1000 * v));
  near(m("overshoot", ring), 100 * Math.exp(-0.5e-3 / 2e-3) * 1, 3, "a ring's overshoot");
  const st = m("settle", ring);
  assert.ok(st > 5e-3 && st < 8.5e-3, `a ring settles into 2 % when its envelope is below it (${st})`);
  assert.ok(Number.isNaN(m("freq", rc)), "no period in a single rise: NaN (shown as —)");
});

test("a DC sweep follows a diode's curve from point to point, with every part's current", () => {
  const xs = []; for (let v = -1; v <= 3.0001; v += 0.1) xs.push(+v.toFixed(3));
  const nl = xs.map(v => ({ nodeCount: 3, elements: [{ id: "V1", kind: "V", nodes: [1, 0], v }, { id: "R1", kind: "R", nodes: [1, 2], r: 100 }, { id: "D1", kind: "D", nodes: [2, 0], is: 1e-14, n: 1 }] }));
  const r = E.dcSweep(nl, { x: xs, currents: true });
  assert.ok(r.ok, r.error); assert.deepEqual(r.failed, []);
  assert.equal(r.t.length, xs.length);
  near(r.nodes[2][0], -1, 1e-6, "reverse: the diode blocks");
  const k = xs.indexOf(3), vd = r.nodes[2][k], id = (3 - vd) / 100;
  near(id, 1e-14 * (Math.exp(vd / 0.025852) - 1), id * 0.01, "forward: the diode's own law at 3 V");
  const j = r.pinI.ids.findIndex(([e, n]) => e === "D1" && n === 2);
  near(r.pinI.vals[j][k], id, id * 1e-3, "the diode's current is recorded");
  near(r.currents.V1[k], -id, id * 1e-3, "and the source's branch current");
});
