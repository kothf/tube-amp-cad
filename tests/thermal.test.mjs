// Self-heating transistors (electro-thermal): the junction temperature from the part's own
// dissipation through its thermal path, a heatsink shared by several parts, the overheating
// warning, the warm-up in the power-on run, and the CAD part's fields that turn it on.
//
//   node --test tests/thermal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js", "cad-components.js", "board-core.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, L = globalThis.CadLib;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

const near = (actual, expected, tol, msg) => assert.ok(Math.abs(actual - expected) <= tol, `${msg}: got ${actual}, expected ${expected} ±${tol}`);
const M0 = { pol: 1, is: 1e-12, bf: 60, br: 1, nf: 1, vaf: 100, ikf: 5, vt: 0.025852 };
// a TO-220 transistor with its base held at vb, emitter resistor re, 10 Ω collector load on 20 V
const stage = (re, vb, therm, id = "q") => [{ id: id + "v", kind: "V", nodes: [1, 0], v: 20 }, { id: id + "b", kind: "V", nodes: [2, 0], v: vb },
  { id: id + "rc", kind: "R", nodes: [1, 3], r: 10 }, { id, kind: "BJT", nodes: [3, 2, 4], model: Object.assign({}, M0), model0: M0, therm }, { id: id + "re", kind: "R", nodes: [4, 0], r: re }];
const net = els => ({ nodeCount: 5, elements: els });

test("self-heating in free air: the junction sits at ta + (Rjc + Rca)·P, and its current rises with it", () => {
  const therm = { ta: 25, rjc: 3, rca: 20, cc: 1 };
  const cold = E.simulate(net(stage(10, 1.3))), hot = E.simulate(net(stage(10, 1.3, therm)));
  assert.ok(cold.ok && hot.ok, hot.error);
  const d = hot.dc.devices.q.main, th = hot.thermal.q;
  near(th.tj, 25 + 23 * d.pd, 0.02, "Tj from its own dissipation");
  near(th.p, d.pd, 1e-9, "the dissipation reported is the operating point's");
  assert.ok(th.tj > 30, `it warms: ${th.tj} °C`);
  // VBE falls about 2 mV/°C: more emitter current through the same 10 Ω
  assert.ok(d.ic > cold.dc.devices.q.main.ic * 1.005, `Ic ${d.ic} warm vs ${cold.dc.devices.q.main.ic} cold`);
  assert.equal(hot.warnings.length, 0, hot.warnings.join());
  assert.ok(Math.abs(hot.tj.q - th.tj) < 1e-9, "result.tj, for the frequency analyses");
});

test("a part at its own ambient with no thermal resistance runs as the Temperature field sets it", () => {
  const at40 = E.simulate(net(stage(10, 1.3, { ta: 40, rjc: 0, rca: 0, cc: 1 })));
  assert.ok(at40.ok, at40.error);
  near(at40.thermal.q.tj, 40, 1e-6, "Tj = ambient");
  const cold = E.simulate(net(stage(10, 1.3)));
  assert.ok(at40.dc.devices.q.main.vbe < cold.dc.devices.q.main.vbe - 0.02, "VBE about 2 mV/°C lower at 40 °C");
});

test("thermal runaway is held at 250 °C and flagged; past Tjmax is flagged too", () => {
  // a stiff base voltage and almost no emitter resistance: its heat raises its current without limit
  const r = E.simulate(net(stage(0.01, 0.62, { ta: 25, rjc: 3, rca: 60, cc: 1 })));
  assert.ok(r.ok, r.error);
  near(r.thermal.q.tj, 250, 1e-6, "held at 250 °C");
  assert.ok(r.warnings.some(w => /^Overheating: q passes 250 °C/.test(w)), r.warnings.join());
  // warm but stable, past a 60 °C maximum
  const w = E.simulate(net(stage(10, 1.3, { ta: 25, rjc: 3, rca: 60, cc: 1, tjmax: 60 })));
  assert.ok(w.ok && w.thermal.q.tj > 60 && w.thermal.q.tj < 250, `${w.thermal.q.tj}`);
  assert.ok(w.warnings.some(x => /^q runs at \d+ °C, past its 60 °C maximum/.test(x)), w.warnings.join());
});

test("a shared heatsink: both parts see Ts = ta + Rsa·ΣP, each Tj = Ts + (Rjc + 0.5)·P", () => {
  const sink = rjc => ({ ta: 25, rjc, rca: 60, cc: 1, sink: "hs1", rsa: 2, cs: 100 });
  const a = stage(10, 1.3, sink(2), "a"), b = stage(20, 1.6, sink(1), "b").map(e => Object.assign({}, e, { nodes: e.nodes.map(n => (n ? n + 4 : 0)) }));
  const r = E.simulate({ nodeCount: 9, elements: a.concat(b) });
  assert.ok(r.ok, r.error);
  const pa = r.dc.devices.a.main.pd, pb = r.dc.devices.b.main.pd, ts = 25 + 2 * (pa + pb);
  near(r.thermal.a.ts, ts, 0.02, "heatsink temperature"); near(r.thermal.b.ts, ts, 0.02, "the same heatsink");
  near(r.thermal.a.tj, ts + 2.5 * pa, 0.02, "a's junction"); near(r.thermal.b.tj, ts + 1.5 * pb, 0.02, "b's junction");
  // the cooler part warms from the other's heat: hotter than it would be on a heatsink of its own
  const alone = E.simulate(net(stage(20, 1.6, sink(1), "b")));
  assert.ok(r.thermal.b.tj > alone.thermal.b.tj + 2, `${r.thermal.b.tj} with a, ${alone.thermal.b.tj} alone`);
});

test("power-on: the case warms with its time constant Rca·Cc, from the ambient", () => {
  const therm = { ta: 25, rjc: 3, rca: 20, cc: 0.05 };   // τ = 1 s
  const steady = E.simulate(net(stage(10, 1.3, therm))).thermal.q.tj;
  const s1 = E.startup(net(stage(10, 1.3, therm)), { tStop: 1 }), s5 = E.startup(net(stage(10, 1.3, therm)), { tStop: 5 });
  assert.ok(s1.ok && s5.ok, s1.error || s5.error);
  const f1 = (s1.thermal.q.tj - 25) / (steady - 25), f5 = (s5.thermal.q.tj - 25) / (steady - 25);
  // the junction's own share (Rjc·P) comes at once, the case's 1 − e^(−t/τ) of the rest
  assert.ok(f1 > 0.6 && f1 < 0.8, `after one τ: ${f1}`);
  assert.ok(f5 > 0.98 && f5 < 1.01, `after five τ: ${f5}`);
  near(s5.thermal.q.tjMax, s5.thermal.q.tj, 0.1, "it only warms");
});

test("AC analysis of a self-heated stage is linearized at its own temperature", () => {
  const els = stage(10, 1.3, { ta: 25, rjc: 3, rca: 20, cc: 1 }).map(e => (e.id === "qb" ? { id: "qb", kind: "VSRC", nodes: [2, 0], wave: "sine", freq: 1000, amp: 0, dcValue: 1.3, v: 1.3 } : e));
  const nl = net(els), o = { inputs: [{ id: "qb" }], fStart: 1000, fStop: 1000, perDecade: 1, probes: [[3, 0]] };
  const r = E.simulate(nl);
  assert.ok(r.ok, r.error);
  const gain = ac => Math.hypot(ac.probes[0].re[0], ac.probes[0].im[0]);
  const own = gain(E.acSweep(nl, o)), given = gain(E.acSweep(nl, Object.assign({ tj: r.tj }, o)));
  const cold = gain(E.acSweep(net(els.map(e => (e.therm ? Object.assign({}, e, { therm: undefined, model0: undefined }) : e))), o));
  near(own, given, 1e-3 * given, "its own temperatures = the run's");
  assert.ok(Math.abs(own - cold) > 1e-3 * cold, `warm ${own} vs cold ${cold}`);
});

test("CAD: Cooling sets the thermal path from the package and Ptot, and a heatsink's Rth", () => {
  const build = params => {
    const c = { id: "VT1", type: "npn", params: Object.assign({ model: "TIP41C", temp: 30 }, params) }, els = [];
    L.LIB.npn.build(c, p => ({ C: 1, B: 2, E: 3 })[p], (() => { let n = 10; return () => n++; })(), els);
    return els.find(e => e.kind === "BJT");
  };
  assert.equal(build({}).therm, undefined, "Fixed temperature: no self-heating");
  const air = build({ thermal: "air" });
  near(air.therm.rjc, 125 / 65, 1e-9, "TIP41C: Rth j-c = (150 − 25)/65 W");
  near(air.therm.rjc + air.therm.rca, 62.5, 1e-9, "TO-220 in free air: 62.5 °C/W");
  assert.equal(air.therm.ta, 30, "the Temperature field is the ambient");
  assert.equal(air.therm.sink, "");
  near(air.model0.bf, 115, 1e-9, "model0: the part at 25 °C");
  const hs = build({ thermal: "hs2", hsr: 0.8 });
  assert.equal(hs.therm.sink, "hs2"); near(hs.therm.rsa, 0.8, 0, "heatsink Rth");
  // a small part: its Ptot is in free air, the whole path
  const s = (() => { const c = { id: "VT2", type: "npn", params: { model: "2N3904", thermal: "air" } }, els = []; L.LIB.npn.build(c, p => ({ C: 1, B: 2, E: 3 })[p], () => 9, els); return els[0]; })();
  near(s.therm.rjc + s.therm.rca, 125 / 0.625, 1e-9, "2N3904: 200 °C/W junction to air");
});

test("CAD: a SPICE part's transistor runs at its Temperature, and a lone one heats itself", () => {
  const text = ".model QX NPN(IS=1e-12 BF=60 VAF=100 IKF=5 XTI=3 EG=1.11 XTB=1.5)";
  const run = params => {
    const c = { id: "VT9", type: "spice", params: Object.assign({ text, sub: "", sym: "npn", map: ["C", "B", "E"] }, params) };
    const els = [{ id: "v", kind: "V", nodes: [1, 0], v: 20 }, { id: "vb", kind: "V", nodes: [2, 0], v: 1.3 }, { id: "rc", kind: "R", nodes: [1, 3], r: 10 }, { id: "re", kind: "R", nodes: [4, 0], r: 10 }];
    let n = 5;
    L.LIB.spice.build(c, p => ({ C: 3, B: 2, E: 4 })[p], () => n++, els);
    return { r: E.simulate({ nodeCount: n, elements: els }), q: els.find(e => e.kind === "BJT") };
  };
  const at25 = run({}), at75 = run({ temp: 75 }), hot = run({ thermal: "air", tpkg: "TO-220", ptot: 40 });
  assert.equal(at25.q.model0, undefined, "at 25 °C the model goes as written");
  assert.equal(at75.q.temp, 75);
  assert.ok(at75.r.dc.devices[at75.q.id].main.vbe < at25.r.dc.devices[at25.q.id].main.vbe - 0.08, "VBE about 2 mV/°C lower at 75 °C");
  const th = hot.r.thermal[hot.q.id], d = hot.r.dc.devices[hot.q.id].main;
  near(th.tj, 25 + (125 / 40 + (62.5 - 125 / 40)) * d.pd, 0.05, "TO-220, 40 W: 62.5 °C/W to the air");
  // a SPICE part's fields: Temperature for any model with transistors, Cooling for a lone one
  const fields = L.LIB.spice.fields, f = k => fields.find(x => x.key === k);
  const lone = { params: { text, sub: "" } }, sub = { params: { text: ".subckt D c b e\nQ1 c b x QX\nQ2 c x e QX\n" + text + "\n.ends", sub: "D" } }, none = { params: { text: ".subckt R a b\nR1 a b 1k\n.ends", sub: "R" } };
  assert.ok(f("temp").when(lone) && f("temp").when(sub) && !f("temp").when(none));
  assert.ok(f("thermal").when(lone) && !f("thermal").when(sub));
});
