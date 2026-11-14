#!/usr/bin/env node
/**
 * BSIM3v3 and BSIM4 MOSFETs (bsim3.js, bsim4.js: ngspice's model code ported, used through a SPICE
 * part's .MODEL line at LEVEL 8/49 or 14/54) against ngspice itself, on circuits:
 *   - the devices' own curves: drain, gate and bulk currents over a grid of bias (0.01 %),
 *   - operating points of small analog circuits (0.1 % + 1 mV),
 *   - DC sweeps (inverter transfer curves, 0.5 % of the swing),
 *   - frequency responses (0.1 dB, 1°),
 *   - transients (inverter chains, a ring oscillator: 2 % of the swing, the period 1 %).
 * The model cards are our own (tests/fixtures/bsim.lib).
 *
 *   node tests/bsim-ngspice.mjs     # needs ngspice on the PATH (apt install ngspice)
 * NGSPICE sets the binary, ONLY=inv runs the benches whose name has that in it.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["spice-model.js", "bsim3.js", "bsim4.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const LIB = readFileSync(new URL("./fixtures/bsim.lib", import.meta.url), "utf8");
const work = mkdtempSync(join(tmpdir(), "tubecad-bsim-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };
const want = name => !ONLY || name.toLowerCase().includes(ONLY);
const ng = (name, body) => {
  const cir = join(work, name + ".cir");
  writeFileSync(cir, `* ${name}\n${body}\n.end\n`);
  try { return execFileSync(NGSPICE, ["-b", cir], { encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return "ERROR " + String(e.stderr || e.message).slice(0, 300); }
};
const readDat = f => readFileSync(f, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
// a bench as a subcircuit whose pins are its probes: the engine's netlist
function netlist(text, probes, spec = {}) {
  const sub = `.subckt BENCH ${probes.join(" ")}\n${text.trim()}\n${LIB}\n.ends\n`;
  const f = SN.flatten(sub, "BENCH");
  let n = f.nNodes;
  const els = SN.build(Object.assign({ text: sub, sub: "BENCH" }, spec), probes.map((_, i) => i + 1), () => n++, "U");
  return { nodeCount: n, elements: els };
}
const at = (t, y, x) => {
  let lo = 0, hi = t.length - 1;
  if (x <= t[0]) return y[0]; if (x >= t[hi]) return y[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  return y[lo] + (y[hi] - y[lo]) * (x - t[lo]) / (t[hi] - t[lo]);
};

// --- 1. the devices' own currents over a bias grid (the model alone, no circuit) ---
const card = name => {
  const m = new RegExp(`^\\.model\\s+${name}\\s+(nmos|pmos)\\s+([\\s\\S]*?)(?=^\\.model|^\\*|$(?![\\s\\S]))`, "im").exec(LIB);
  const P = { type: m[1].toLowerCase() === "pmos" ? -1 : 1 };
  m[2].replace(/\n\+/g, " ").trim().split(/\s+/).forEach(t => { const [k, v] = t.split("="); if (k === "version") P.version = v; else P[k.toLowerCase()] = parseFloat(v); });
  return P;
};
for (const [mdl, ver, L] of [["n3", 3, 0.18], ["p3", 3, 0.18], ["n3", 3, 2], ["n4", 4, 0.045], ["p4", 4, 0.045], ["n4", 4, 1]]) {
  const name = `curves-${mdl}-L${L}u`;
  if (!want(name)) continue;
  const P = card(mdl), pol = P.type, B = ver === 3 ? globalThis.Bsim3 : globalThis.Bsim4, vmax = ver === 3 ? 1.8 : 1.1;
  const inst = { l: L * 1e-6, w: 2e-6, ad: 1e-12, as: 1e-12, pd: 4e-6, ps: 4e-6, nrd: 0, nrs: 0 }, dev = B.setup(P, inst, 27);
  const VG = [0.25, 0.5, 0.75, 1].map(f => f * vmax), VB = [0, -0.4];
  let body = `${LIB}\nvd d 0 0\nvg g 0 0\nvb b 0 0\nm1 d g 0 b ${mdl} l=${L}u w=2u ad=1p as=1p pd=4u ps=4u nrd=0 nrs=0\n.options gmin=1e-12 abstol=1e-15 reltol=1e-6\n.control\nset noaskquit\n`;
  VB.forEach((vb, j) => VG.forEach((vg, i) => { body += `alter vg dc=${pol * vg}\nalter vb dc=${pol * vb}\ndc vd ${-0.3 * pol} ${vmax * pol} ${0.1 * pol}\nwrdata ${join(work, `${name}-${i}-${j}.dat`)} i(vd) i(vg) i(vb)\n`; }));
  const out = ng(name, body + ".endc");
  if (out.startsWith("ERROR")) { check(false, `${name}: ngspice: ${out}`); continue; }
  let worst = 0, wg = 0, wb = 0, where = "";
  VB.forEach((vb, j) => VG.forEach((vg, i) => readDat(join(work, `${name}-${i}-${j}.dat`)).forEach(r => {
    const vd = r[0], o = ver === 3 ? B.eval(dev, pol * vd, vg, vb) : B.eval(dev, [pol * vd, vg, vb, 0, 0, 0, 0]);
    const id = pol * (ver === 3 ? o.id : o.i[0]), ig = pol * (ver === 3 ? o.ig : o.i[1]), ib = pol * (ver === 3 ? o.ib : o.i[3] + o.i[4] + o.i[5]);
    const e = Math.abs(id + r[1]) / (Math.abs(r[1]) + 1e-12);
    if (e > worst) { worst = e; where = `Vgs ${pol * vg} Vbs ${pol * vb} Vds ${vd.toFixed(2)}: ${id.toExponential(5)} / ngspice ${(-r[1]).toExponential(5)}`; }
    wg = Math.max(wg, Math.abs(ig + r[3]) / (Math.abs(r[3]) + 1e-15)); wb = Math.max(wb, Math.abs(ib + r[5]) / (Math.abs(r[5]) + 1e-15));
  })));
  check(worst < 1e-4 && wg < 1e-3 && wb < 1e-3, `${name}: drain current within ${(worst * 100).toFixed(4)} %, gate ${(wg * 100).toFixed(3)} %, bulk ${(wb * 100).toFixed(3)} %${worst >= 1e-4 ? " worst " + where : ""}`);
}

// --- 2. operating points and frequency responses ---
const AMPS = [
  // a 5-transistor OTA as a follower-less open-loop gain stage, biased by a current mirror (BSIM3)
  { name: "ota-bsim3", probes: ["out", "tail", "m", "bias"], ac: "out", text: `
VDD vdd 0 1.8
VIN inp 0 DC 0.9 AC 1
VREF inn 0 0.9
IB vdd bias 20u
M5 bias bias 0 0 n3 l=1u w=4u ad=4p as=4p pd=10u ps=10u
M6 tail bias 0 0 n3 l=1u w=8u ad=8p as=8p pd=18u ps=18u
M1 m inp tail 0 n3 l=0.5u w=4u ad=4p as=4p pd=10u ps=10u
M2 out inn tail 0 n3 l=0.5u w=4u ad=4p as=4p pd=10u ps=10u
M3 m m vdd vdd p3 l=0.5u w=8u ad=8p as=8p pd=18u ps=18u
M4 out m vdd vdd p3 l=0.5u w=8u ad=8p as=8p pd=18u ps=18u
CL out 0 1p` },
  // a common-source stage with a resistor load and source degeneration (BSIM4)
  { name: "cs-bsim4", probes: ["out", "s", "g"], ac: "out", text: `
VDD vdd 0 1.1
VIN in 0 DC 0 AC 1
CIN in g 1u
RB1 vdd g 200k
RB2 g 0 200k
M1 out g s 0 n4 l=0.1u w=5u ad=1p as=1p pd=6u ps=6u
RD vdd out 5k
RS s 0 200
CS s 0 10p
CL out 0 50f` },
  // the same with RDSMOD=1, RBODYMOD=1 and RGATEMOD=1 (the internal nodes and resistors)
  { name: "cs-bsim4-rnet", probes: ["out", "s", "g"], ac: "out", text: `
VDD vdd 0 1.1
VIN in 0 DC 0 AC 1
CIN in g 1u
RB1 vdd g 200k
RB2 g 0 200k
M1 out g s 0 n4r l=0.1u w=5u ad=1p as=1p pd=6u ps=6u nrd=2 nrs=2
RD vdd out 5k
RS s 0 200
CS s 0 10p
CL out 0 50f` },
];
for (const b of AMPS) {
  if (!want(b.name)) continue;
  const nl = netlist(b.text, b.probes), r = E.simulate(nl, {});
  if (!r.ok) { check(false, `${b.name}: ours: ${r.error}`); continue; }
  const out = ng(b.name + "-op", `${b.text}\n${LIB}\n.control\nset noaskquit\nop\nprint ${b.probes.map(p => `v(${p})`).join(" ")}\nac dec 5 100 10g\nwrdata ${join(work, b.name + "-ac.dat")} vdb(${b.ac}) vp(${b.ac})\n.endc`);
  let worst = 0, where = "";
  b.probes.forEach((p, i) => {
    const m = new RegExp(`v\\(${p}\\) = ([-+0-9.e]+)`, "i").exec(out), ours = r.dc.nodes[i + 1];
    if (!m) { worst = Infinity; where = `no v(${p}) from ngspice`; return; }
    const e = Math.abs(ours - +m[1]) / (Math.abs(+m[1]) * 1e-3 + 1e-3);
    if (e > worst) { worst = e; where = `v(${p}) ${ours.toFixed(5)} / ngspice ${(+m[1]).toFixed(5)}`; }
  });
  check(worst <= 1, `${b.name}: operating point ${where} (within 0.1 % + 1 mV: ${worst <= 1 ? "yes" : "no"})`);
  const rows = readDat(join(work, b.name + "-ac.dat")), vin = nl.elements.find(e => /#vin$/i.test(e.id));
  const ac = E.acSweep(nl, { inputs: [{ id: vin.id }], fStart: 100, fStop: 1e10, perDecade: 5, probes: [[b.probes.indexOf(b.ac) + 1, 0]] });
  if (!ac.ok) { check(false, `${b.name}: ours AC: ${ac.error}`); continue; }
  let dw = 0, pw = 0, fAt = 0;
  rows.forEach(rw => {
    const f = rw[0], k = Array.from(ac.freqs).findIndex(x => Math.abs(x / f - 1) < 1e-6);
    if (k < 0) return;
    const p = ac.probes[0], db = 20 * Math.log10(Math.hypot(p.re[k], p.im[k])), ph = Math.atan2(p.im[k], p.re[k]) * 180 / Math.PI;
    const d = Math.abs(db - rw[1]); let e = Math.abs(ph - rw[3] * 180 / Math.PI) % 360; if (e > 180) e = 360 - e;
    if (rw[1] < -60) return;
    if (d > dw) { dw = d; fAt = f; } pw = Math.max(pw, e);
  });
  check(dw <= 0.1 && pw <= 1, `${b.name}: frequency response to 10 GHz within ${dw.toFixed(3)} dB (worst at ${fAt.toPrecision(3)} Hz), ${pw.toFixed(2)}°`);
}

// --- 3. DC sweeps: inverter transfer curves ---
const INV = (n, p, vdd) => `
VDD vdd 0 ${vdd}
VIN in 0 {X}
M1 out in vdd vdd ${p} l=0.1u w=2u ad=0.5p as=0.5p pd=3u ps=3u
M2 out in 0 0 ${n} l=0.1u w=1u ad=0.25p as=0.25p pd=2u ps=2u`;
for (const [name, n, p, vdd] of [["dc-inverter-bsim3", "n3", "p3", 1.8], ["dc-inverter-bsim4", "n4", "p4", 1.1]]) {
  if (!want(name)) continue;
  const xs = []; for (let k = 0; k <= 60; k++) xs.push(+(vdd * k / 60).toPrecision(10));
  const r = E.dcSweep(xs.map(x => netlist(INV(n, p, vdd).replace("{X}", x), ["out", "in"])), { x: xs });
  if (!r.ok || r.failed.length) { check(false, `${name}: ours: ${r.error || "no point at " + r.failed}`); continue; }
  const out = ng(name, `${INV(n, p, vdd).replace("{X}", "0")}\n${LIB}\n.control\nset noaskquit\ndc vin 0 ${vdd} ${vdd / 60}\nwrdata ${join(work, name + ".dat")} v(out)\n.endc`);
  if (out.startsWith("ERROR")) { check(false, `${name}: ngspice: ${out}`); continue; }
  const rows = readDat(join(work, name + ".dat"));
  let w = 0; xs.forEach((x, k) => { w = Math.max(w, Math.abs(r.nodes[1][k] - at(rows.map(q => q[0]), rows.map(q => q[1]), x)) / vdd); });
  check(w <= 0.005, `${name}: transfer curve within ${(w * 100).toFixed(3)} % of the supply (61 points, ${r.elapsedMs} ms)`);
}

// --- 4. transients ---
const chain = (n, p, vdd, t) => `
VDD vdd 0 ${vdd}
V1 in 0 PULSE(0 ${vdd} ${t} ${t / 20} ${t / 20} ${2 * t} ${4 * t})
M1 a in vdd vdd ${p} l=0.18u w=2u ad=1p as=1p pd=4u ps=4u
M2 a in 0 0 ${n} l=0.18u w=1u ad=0.5p as=0.5p pd=3u ps=3u
M3 out a vdd vdd ${p} l=0.18u w=2u ad=1p as=1p pd=4u ps=4u
M4 out a 0 0 ${n} l=0.18u w=1u ad=0.5p as=0.5p pd=3u ps=3u
C1 out 0 20f`;
const ring = (n, p, vdd) => `
VDD vdd 0 ${vdd}
${[0, 1, 2, 3, 4].map(k => { const i = `n${k}`, o = `n${(k + 1) % 5}`; return `MP${k} ${o} ${i} vdd vdd ${p} l=0.18u w=2u ad=1p as=1p pd=4u ps=4u\nMN${k} ${o} ${i} 0 0 ${n} l=0.18u w=1u ad=0.5p as=0.5p pd=3u ps=3u\nC${k} ${o} 0 10f`; }).join("\n")}`;
const TRAN = [
  { name: "tran-chain-bsim3", text: chain("n3", "p3", 1.8, 1e-9), probes: ["in", "a", "out"], tStop: 8e-9 },
  { name: "tran-chain-bsim4", text: chain("n4", "p4", 1.1, 1e-9), probes: ["in", "a", "out"], tStop: 8e-9 },
  { name: "tran-chain-bsim4-rnet", text: chain("n4r", "p4", 1.1, 1e-9), probes: ["in", "a", "out"], tStop: 8e-9 },
  // a ring oscillator, started by an initial condition: its period
  { name: "tran-ring-bsim3", text: ring("n3", "p3", 1.8), probes: ["n0", "n1"], tStop: 6e-9, ic: { n0: 0 }, period: "n0" },
];
for (const b of TRAN) {
  if (!want(b.name)) continue;
  const nl = netlist(b.text, b.probes), ic = {};
  if (b.ic) Object.entries(b.ic).forEach(([k, v]) => { ic[b.probes.indexOf(k) + 1] = v; });
  const t0 = Date.now(), r = E.transient(nl, { tStop: b.tStop, ic: b.ic ? ic : undefined });
  if (!r.ok) { check(false, `${b.name}: ours: ${r.error}`); continue; }
  const step = b.tStop / 10000, icl = b.ic ? `.ic ${Object.entries(b.ic).map(([k, v]) => `v(${k})=${v}`).join(" ")}\n` : "";
  const out = ng(b.name, `${b.text}\n${LIB}\n${icl}.options reltol=1e-4\n.control\nset noaskquit\ntran ${step} ${b.tStop} 0 ${step}\nwrdata ${join(work, b.name + ".dat")} ${b.probes.map(p => `v(${p})`).join(" ")}\n.endc`);
  if (out.startsWith("ERROR")) { check(false, `${b.name}: ngspice: ${out}`); continue; }
  const rows = readDat(join(work, b.name + ".dat")), tq = rows.map(q => q[0]);
  if (b.period) {
    // the oscillation's period from its rising crossings of half the supply, past the first nanosecond
    const i = b.probes.indexOf(b.period), per = (t, y) => { const c = []; for (let k = 1; k < t.length; k++) if (t[k] > 1e-9 && y[k - 1] < 0.9 && y[k] >= 0.9) c.push(t[k - 1] + (0.9 - y[k - 1]) * (t[k] - t[k - 1]) / (y[k] - y[k - 1])); return (c[c.length - 1] - c[0]) / (c.length - 1); };
    const pa = per(Array.from(r.t), Array.from(r.nodes[i + 1])), pq = per(tq, rows.map(q => q[2 * i + 1]));
    check(Math.abs(pa / pq - 1) <= 0.01, `${b.name}: period ${(pa * 1e12).toFixed(1)} ps / ngspice ${(pq * 1e12).toFixed(1)} ps (${r.steps} steps, ${Date.now() - t0} ms)`);
    continue;
  }
  b.probes.forEach((p, i) => {
    const yq = rows.map(q => q[2 * i + 1]), swing = Math.max(...yq) - Math.min(...yq) || 1;
    let w = 0; for (let k = 1; k <= 400; k++) { const x = b.tStop * k / 400; w = Math.max(w, Math.abs(at(r.t, r.nodes[i + 1], x) - at(tq, yq, x)) / swing); }
    check(w <= 0.02, `${b.name} v(${p}): within ${(w * 100).toFixed(2)} % of its swing (${r.steps} steps, ${Date.now() - t0} ms)`);
  });
}
console.log(failed ? `${failed} FAILED` : "all BSIM benches match ngspice");
process.exit(failed ? 1 : 0);
