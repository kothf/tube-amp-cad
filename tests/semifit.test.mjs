/**
 * A transistor's or diode's model fitted to its datasheet (semi-fit.js, AI ▾ → Transistor or diode
 * from a datasheet): datasheet points made from known models are fitted back closely, and the fitted
 * .MODEL, simulated by the engine as a SPICE part, gives the currents the card's curves show.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "spice-model.js", "spice-net.js", "semi-fit.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { SemiFit: SF, TubeSimEngine: E, SpiceNet: N } = globalThis;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

// the fitted part in a circuit: sources on its pins (pin order of the model), the current out of the first source
function simulate(text, name, sources) {
  const els = sources.map((s, i) => ({ id: "s" + i, kind: s.i !== undefined ? "I" : "V", nodes: s.i !== undefined ? [0, i + 1] : [i + 1, 0], ...(s.i !== undefined ? { i: s.i } : { v: s.v }) }));
  let n = sources.length + 1;
  N.build({ text, sub: name }, sources.map((_, i) => i + 1), () => n++, "q", els);
  const r = E.simulate({ nodeCount: n, elements: els });
  assert.ok(r.ok, "the circuit solves");
  const c = r.dc.currents; for (let j = 0; j < c.length; j += 3) if (c[j] === "s0") return { i: -c[j + 2], v: r.dc.nodes };
  return null;
}

const ics = [1e-4, 3e-4, 1e-3, 3e-3, 1e-2, 3e-2, 1e-1, 2e-1];
const known = { is: 6.734e-15, bf: 416.4, ikf: 66.78e-3, ise: 6.734e-15, ne: 1.259, nf: 1, vaf: 74.03 };
const bjtSheet = { kind: "npn", name: "2N3904", package: "TO-92", pins: "EBC", ratings: { vmax: 40, imax: 0.2, ptot: 0.625, tjmax: 150 },
  bjt: { hfe: ics.map(ic => ({ ic, vce: 1, hfe: SF.bjtAt(known, 10, 0, ic, 1).hfe })), vbe: ics.map(ic => ({ ic, vbe: SF.bjtAt(known, 10, 0, ic, 5).vbe })),
    output: [{ vce: 2, ib: 1e-5, ic: 4.1e-3 }, { vce: 10, ib: 1e-5, ic: 4.5e-3 }], cob: 4e-12, cob_v: 5, cib: 8e-12, cib_v: 0.5, ft: 300e6, ft_ic: 10e-3, vcesat: [{ ic: 0.05, ib: 0.005, v: 0.2 }] } };

test("a BJT's hFE and VBE curves are fitted back; the simulated part gives them", () => {
  const r = SF.read(bjtSheet), f = SF.fit(r);
  assert.equal(f.quality, "good");
  assert.ok(f.err.find(e => e.what === "hFE").v < 3 && f.err.find(e => e.what === "VBE").v < 5, JSON.stringify(f.err));
  assert.ok(Math.abs(f.P.VAF - 80) < 0.5, `VAF from the output curves: ${f.P.VAF}`);
  assert.ok(f.P.CJC > 0 && f.P.CJE > 0 && f.P.TF > 0 && f.P.RC > 0);
  // the engine, at 1 mA and VCE 1 V: the base current the fit predicts gives that collector current
  const p = SF.bjtAt({ is: f.P.IS, bf: f.P.BF, ikf: f.P.IKF, ise: f.P.ISE, ne: f.P.NE, nf: 1, vaf: f.P.VAF }, 0, f.P.RE || 0, 1e-3, 1);
  const s = simulate(f.text, "2N3904", [{ v: 1 }, { i: p.ib }, { v: 0 }]);
  assert.ok(Math.abs(s.i / 1e-3 - 1) < 0.02, `simulated IC ${s.i} A`);
  assert.ok(Math.abs(s.v[2] - p.vbe) < 0.003, `simulated VBE ${s.v[2]} V against ${p.vbe} V`);
  const pp = SF.partParams(r, f);
  assert.deepEqual([pp.sym, pp.map.join(""), pp.ptot, pp.tjmax], ["npn", "CBE", 0.625, 150]);
});

test("a diode's forward curve and a zener's knee", () => {
  const pts = [[1e-5, 0], [1e-4, 0], [1e-3, 0], [1e-2, 0], [0.1, 0], [0.3, 0]].map(([i]) => ({ if: i, vf: 1.8 * 0.025852 * Math.log(i / 2e-9 + 1) + i * 0.5 }));
  const f = SF.fit(SF.read({ kind: "diode", name: "1N4148", ratings: { vmax: 100 }, diode: { forward: pts, cj: 2e-12, trr: 4e-9 } }));
  assert.ok(Math.abs(f.P.N - 1.8) < 0.05 && Math.abs(f.P.RS - 0.5) < 0.05 && f.quality === "good", f.text);
  const s = simulate(f.text, "1N4148", [{ v: pts[3].vf }, { v: 0 }]);
  assert.ok(Math.abs(s.i / 1e-2 - 1) < 0.03, `simulated IF ${s.i} A at ${pts[3].vf} V`);
  const z = SF.fit(SF.read({ kind: "zener", name: "BZX79C12", diode: { forward: [{ vf: 0.9, if: 0.01 }], vz: 12, iz: 5e-3, zz: 10 } }));
  assert.ok(z.P.BV === 12 && z.P.NBV > 1, z.text);
  // 5 mA pulled backwards through it: 12 V across it
  const sz = simulate(z.text, "BZX79C12", [{ i: -5e-3 }, { v: 0 }]);
  assert.ok(Math.abs(-sz.v[1] - 12) < 0.05, `VZ ${-sz.v[1]} V`);
});

test("a power MOSFET's transfer curve with its threshold, RDS(on) by RD; a P-channel's too", () => {
  const sheet = { kind: "nmos", name: "IRF540N", package: "TO-220", pins: "GDS", ratings: { vmax: 100, imax: 33, ptot: 130, tjmax: 175, rthjc: 1.15 },
    fet: { transfer: [{ vgs: 4.5, id: 1, vds: 25 }, { vgs: 5, id: 4, vds: 25 }, { vgs: 5.5, id: 10, vds: 25 }, { vgs: 6, id: 20, vds: 25 }, { vgs: 7, id: 45, vds: 25 }, { vgs: 8, id: 75, vds: 25 }],
      vth: 3, vth_id: 250e-6, rdson: 0.044, rdson_vgs: 10, rdson_id: 16, ciss: 1960e-12, coss: 250e-12, crss: 40e-12, cap_vds: 25, vsd: 1.2, vsd_is: 16 } };
  const r = SF.read(sheet), f = SF.fit(r);
  assert.equal(f.quality, "good", f.text);
  assert.ok(f.P.CGS > 1e-9 && f.P.CGDMIN === 4e-11 && f.P.CJO > 0 && f.P.KSUBTHRES > 0);
  const s = simulate(f.text, "IRF540N", [{ v: 0.044 * 16 }, { v: 10 }, { v: 0 }]);
  assert.ok(Math.abs(s.i / 16 - 1) < 0.02, `simulated ID at RDS(on)'s conditions ${s.i} A`);
  const s2 = simulate(f.text, "IRF540N", [{ v: 25 }, { v: 6 }, { v: 0 }]);
  assert.ok(Math.abs(Math.log(s2.i / 20)) < 0.15, `ID at VGS 6 V ${s2.i} A`);
  const p = SF.fit(SF.read({ kind: "pmos", name: "IRF9540", fet: { transfer: [{ vgs: 5, id: 2, vds: 25 }, { vgs: 6, id: 8, vds: 25 }, { vgs: 7, id: 16, vds: 25 }], vth: 3, rdson: 0.2, rdson_vgs: 10, rdson_id: 11 } }));
  assert.ok(/PCHAN/.test(p.text) && p.P.VTO < 0);
  const s3 = simulate(p.text, "IRF9540", [{ v: -25 }, { v: -6 }, { v: 0 }]);
  assert.ok(Math.abs(Math.log(-s3.i / 8)) < 0.1, `P-channel ID ${s3.i} A`);
});

test("a JFET from IDSS, VGS(off) and its transfer curve", () => {
  const f = SF.fit(SF.read({ kind: "njf", name: "2N5457", fet: { idss: 3e-3, vgsoff: 1.8, ciss: 4.5e-12, crss: 1.5e-12, transfer: [{ vgs: 0.5, id: 1.6e-3, vds: 15 }, { vgs: 1, id: 0.6e-3, vds: 15 }] } }));
  assert.ok(f.P.VTO < -1.6 && f.P.VTO > -2 && f.P.CGD > 0, f.text);
  const s = simulate(f.text, "2N5457", [{ v: 15 }, { v: 0 }, { v: 0 }]);
  assert.ok(Math.abs(s.i / 3e-3 - 1) < 0.1, `IDSS simulated ${s.i} A`);
});

test("values given only as limits: the usual typical part, said in the notes", () => {
  const j = SF.fit(SF.read({ kind: "njf", name: "J201", fet: { idss_min: 0.2e-3, idss_max: 1e-3, vgsoff_min: 0.3, vgsoff_max: 1.5 } }));
  assert.ok(Math.abs(-j.P.VTO - Math.sqrt(0.45)) < 0.01 && j.notes.some(n => /IDSS is the middle/.test(n)), j.text);
  const m = SF.fit(SF.read({ kind: "nmos", name: "IRF540N", fet: { transfer: [{ vgs: 5, id: 4, vds: 25 }, { vgs: 6, id: 20, vds: 25 }, { vgs: 7, id: 45, vds: 25 }], vth_min: 2, vth_max: 4, vth_id: 250e-6, rdson_max: 0.044, rdson_vgs: 10, rdson_id: 16 } }));
  assert.ok(m.err.find(e => e.what === "RDS(on)").v < 1 && m.notes.some(n => /0\.8 of its 0\.044/.test(n)), m.text + m.notes);
});

test("the reading: kinds, P parts as magnitudes, pins checked, nothing to fit refused", () => {
  assert.throws(() => SF.read({ kind: "triode" }), /Tube from a datasheet/);
  assert.throws(() => SF.read({ kind: "npn", bjt: { hfe: [] } }), /no hFE/);
  const r = SF.read({ kind: "pnp", name: "BC 557/B", pins: "CBX", bjt: { hfe: [{ ic: -2e-3, vce: -5, hfe: 290 }, { ic: "10m", hfe: 250 }] } });
  assert.equal(r.name, "BC_557_B");
  assert.deepEqual(r.bjt.hfe, [{ ic: 2e-3, vce: 5, hfe: 290 }, { ic: 0.01, vce: undefined, hfe: 250 }]);
  assert.ok(!r.pins && /CBX/.test(r.problems.join()));
});
