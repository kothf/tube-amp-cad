/**
 * BSIM3v3 and BSIM4 MOSFETs (bsim3.js, bsim4.js, generated from ngspice's model code by
 * scripts/bsim/port.py) without ngspice: currents at a few biases as ngspice gives them (the full
 * comparison is tests/bsim-ngspice.mjs), charge conservation, and a SPICE part at LEVEL 49 / 54
 * built into the engine's BSIM element and solved.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["spice-model.js", "bsim3.js", "bsim4.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { Bsim3, Bsim4, SpiceNet: SN, TubeSimEngine: E } = globalThis;
const LIB = readFileSync(new URL("./fixtures/bsim.lib", import.meta.url), "utf8");
const card = name => {
  const m = new RegExp(`^\\.model\\s+${name}\\s+(nmos|pmos)\\s+([\\s\\S]*?)(?=^\\.model|^\\*|$(?![\\s\\S]))`, "im").exec(LIB);
  const P = { type: m[1] === "pmos" ? -1 : 1 };
  m[2].replace(/\n\+/g, " ").trim().split(/\s+/).forEach(t => { const [k, v] = t.split("="); if (k === "version") P.version = v; else P[k] = parseFloat(v); });
  return P;
};
const near = (a, b, rel, msg) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg}: ${a} vs ${b}`);

test("BSIM3: drain currents as ngspice gives them", () => {
  const d = Bsim3.setup(card("n3"), { l: 0.18e-6, w: 2e-6 }, 27);
  near(Bsim3.eval(d, 1.8, 1.2, 0).id, 5.98486419703e-4, 1e-6, "saturation");
  near(Bsim3.eval(d, 0.1, 0.9, -0.5).id, 8.638300992e-5, 1e-6, "triode, body bias");
  near(Bsim3.eval(d, -0.5, 1, 0).id, -8.501082103e-4, 1e-6, "reversed");
});
test("BSIM4: drain and gate-tunnelling currents as ngspice gives them", () => {
  const d = Bsim4.setup(card("n4"), { l: 0.045e-6, w: 1e-6 }, 27);
  const a = Bsim4.eval(d, [1, 0.8, 0, 0, 0, 0, 0]), b = Bsim4.eval(d, [0.05, 0.6, -0.3, 0, 0, 0, 0]), c = Bsim4.eval(d, [-0.4, 1, 0, 0, 0, 0, 0]);
  near(a.i[0], 1.32738847646e-3, 1e-6, "saturation"); near(a.i[1], 2.43274464656e-7, 1e-6, "gate current");
  near(b.i[0], 8.092906102e-5, 1e-6, "triode, body bias"); near(c.i[0], -1.631052908e-3, 1e-6, "reversed");
});
test("BSIM: currents and charges sum to zero over the terminals", () => {
  const d3 = Bsim3.setup(card("p3"), { l: 0.5e-6, w: 4e-6, ad: 4e-12, as: 4e-12, pd: 10e-6, ps: 10e-6 }, 60);
  const d4 = Bsim4.setup(card("n4r"), { l: 0.1e-6, w: 5e-6, nrd: 2, nrs: 2 }, 27);
  for (const v of [[-1.2, -0.9, 0.2], [0.3, -1.5, 0], [-0.05, 0.2, 0.4]]) {
    const o = Bsim3.eval(d3, ...v), I = o.id + o.ig + o.is + o.ib, Q = o.qd + o.qg + o.qs + o.qb;
    assert.ok(Math.abs(I) < 1e-18 + 1e-12 * Math.abs(o.id), `BSIM3 current sum ${I}`); assert.ok(Math.abs(Q) < 1e-28, `BSIM3 charge sum ${Q}`);
    assert.ok(Math.abs(o.qg) > 0, "gate charge");
  }
  for (const v of [[0.8, 1, 0, 0.01, 0, 0.82, -0.01], [-0.3, 0.7, -0.2, -0.25, -0.18, -0.32, 0.02]]) {
    const o = Bsim4.eval(d4, v), I = o.i.reduce((a, b) => a + b), Q = o.q.reduce((a, b) => a + b);
    assert.ok(Math.abs(I) < 1e-15, `BSIM4 current sum ${I}`); assert.ok(Math.abs(Q) < 1e-28, `BSIM4 charge sum ${Q}`);
  }
});
test("BSIM: a SPICE part at LEVEL 54 becomes a BSIM element with its resistors, and solves as ngspice does", () => {
  const sub = `.subckt CS out\nVDD vdd 0 1.1\nRB1 vdd g 200k\nRB2 g 0 200k\nM1 out g s 0 n4r l=0.1u w=5u ad=1p as=1p pd=6u ps=6u nrd=2 nrs=2\nRD vdd out 5k\nRS s 0 200\n${LIB}\n.ends\n`;
  const f = SN.flatten(sub, "CS");
  let n = f.nNodes;
  const els = SN.build({ text: sub, sub: "CS" }, [1], () => n++, "U");
  const m = els.find(e => e.kind === "BSIM");
  assert.equal(m.model.ver, 4);
  assert.equal(m.nodes.length, 8, "inner drain/source, gate, body network");
  assert.ok(els.filter(e => e.kind === "R" && /m1#r\d/i.test(e.id)).length === 6, "gate electrode + 5 body resistors");
  const r = E.simulate({ nodeCount: n, elements: els }, {});
  assert.ok(r.ok, r.error);
  near(r.dc.nodes[1], 0.45212, 2e-4, "v(out) (ngspice 0.45212)");
});
test("BSIM: what is not supported is refused with the reason", () => {
  const sub = `.subckt X d\nM1 d d 0 0 nn l=1u w=1u\n.model nn nmos level=54 rgatemod=2\n.ends\n`;
  assert.throws(() => SN.flatten(sub, "X"), /RGATEMOD=2/);
  const sub3 = `.subckt X d\nM1 d d 0 0 nn l=1u w=1u\n.model nn nmos level=7\n.ends\n`;
  assert.throws(() => SN.flatten(sub3, "X"), /level 7 is not supported/);
});
