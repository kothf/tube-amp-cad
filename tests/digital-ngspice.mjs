#!/usr/bin/env node
/**
 * Logic and mixed-signal (sim-digital.js inside sim-engine.js transient) against ngspice's XSPICE:
 * each bench is a small circuit of XSPICE code models (gates, flip-flops, latches, a divider, a
 * look-up table, tristate and open-collector outputs, adc_bridge and dac_bridge) with analogue
 * parts around them, run here (spice-net.js reads the A lines, as a SPICE part) and in ngspice.
 * Every probed analogue node is compared at 400 instants over the run, within 1 % of its swing
 * of ngspice's waveform anywhere within 1 ns of the instant (an edge here lands on the threshold
 * crossing; ngspice sees it at its next time point, up to its 1 ns maximum step later).
 *
 *   node tests/digital-ngspice.mjs     # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the binary, ONLY=dff runs the benches whose name has that in it, KEEP=1 prints the
 * worst instant of each.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-digital.js", "sim-engine.js", "cad-components.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet, L = globalThis.CadLib;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "tubecad-dig-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

const DAC5 = ".model dac5 dac_bridge(out_low=0 out_high=5 t_rise=20n t_fall=20n)";
const ADC = ".model adc adc_bridge(in_low=2.5 in_high=2.5 rise_delay=5n fall_delay=5n)";
const BENCHES = [
  { name: "inverter-rc", probes: ["out", "o2"], tStop: 30e-6, text: `
V1 in 0 PULSE(0 5 1u 1u 1u 4u 10u)
A1 [in] [d] adc
A2 d y inv1
.model inv1 d_inverter(rise_delay=10n fall_delay=20n)
A3 [y] [out] dac5
R1 out o2 1k
C1 o2 0 1n
${ADC}
${DAC5}` },
  // two clocks into every two-input gate, each gate's output through its own DAC
  { name: "gates", probes: ["vand", "vnand", "vor", "vnor", "vxor", "vxnor"], tStop: 20e-6, text: `
V1 a 0 PULSE(0 5 0 100n 100n 2u 4u)
V2 b 0 PULSE(0 5 0.5u 100n 100n 3u 6u)
A1 [a b] [da db] adc
A2 [da db] y1 g_and
A3 [da db] y2 g_nand
A4 [da db] y3 g_or
A5 [da db] y4 g_nor
A6 [da db] y5 g_xor
A7 [da db] y6 g_xnor
A8 [y1 y2 y3 y4 y5 y6] [vand vnand vor vnor vxor vxnor] dac5
.model g_and d_and(rise_delay=12n fall_delay=7n)
.model g_nand d_nand(rise_delay=12n fall_delay=7n)
.model g_or d_or(rise_delay=12n fall_delay=7n)
.model g_nor d_nor(rise_delay=12n fall_delay=7n)
.model g_xor d_xor(rise_delay=12n fall_delay=7n)
.model g_xnor d_xnor(rise_delay=12n fall_delay=7n)
${ADC}
${DAC5}` },
  // a 3-bit ripple counter of D flip-flops (Nout to data), its bits weighted by an R-2R ladder
  { name: "dff-counter-r2r", probes: ["ladder", "q0"], tStop: 40e-6, text: `
V1 clk 0 PULSE(0 5 1u 50n 50n 1u 2u)
A1 [clk] [dclk] adc
A2 n0 dclk NULL NULL d0 n0 ff
A3 n1 n0 NULL NULL d1 n1 ff
A4 n2 n1 NULL NULL d2 n2 ff
A5 [d0 d1 d2] [q0 q1 q2] dac5
R0 q0 a0 20k
R1 q1 a1 20k
R2 q2 a2 20k
Rt a0 0 20k
Ra a0 a1 10k
Rb a1 a2 10k
Rl a2 ladder 1
Cl ladder 0 10p
.model ff d_dff(clk_delay=15n rise_delay=5n fall_delay=8n ic=0)
${ADC}
${DAC5}` },
  // JK and T flip-flops toggling, an SR flip-flop set and reset, with set/reset pins driven
  { name: "jk-t-sr", probes: ["vjk", "vt", "vsr", "vjkn"], tStop: 30e-6, text: `
V1 clk 0 PULSE(0 5 0.5u 20n 20n 1u 2u)
V2 j 0 PULSE(0 5 3u 20n 20n 8u 16u)
V3 k 0 PULSE(0 5 7u 20n 20n 8u 16u)
V4 rst 0 PULSE(0 5 20u 20n 20n 2u 100u)
A1 [clk j k rst] [dc dj dk dr] adc
A2 dj dk dc NULL dr qjk nqjk jk
A3 dj dc NULL dr qt nqt tf
A4 dj dk dc NULL NULL qsr nqsr sr
A5 [qjk qt qsr nqjk] [vjk vt vsr vjkn] dac5
.model jk d_jkff(clk_delay=10n set_delay=12n reset_delay=14n rise_delay=3n fall_delay=4n ic=0)
.model tf d_tff(clk_delay=10n reset_delay=14n ic=1)
.model sr d_srff(clk_delay=10n ic=0)
${ADC}
${DAC5}` },
  // latches: a D latch passing data while enabled, an SR latch
  { name: "latches", probes: ["vd", "vs"], tStop: 20e-6, text: `
V1 en 0 PULSE(0 5 2u 20n 20n 3u 7u)
V2 dat 0 PULSE(0 5 1u 20n 20n 1.3u 2.9u)
V3 s 0 PULSE(0 5 4u 20n 20n 1u 9u)
V4 r 0 PULSE(0 5 8u 20n 20n 1u 9u)
A1 [en dat s r] [den ddat ds dr] adc
A2 ddat den NULL NULL qd nqd dl
A3 ds dr den NULL NULL qs nqs srl
A4 [qd qs] [vd vs] dac5
.model dl d_dlatch(data_delay=11n enable_delay=13n ic=0)
.model srl d_srlatch(sr_delay=9n enable_delay=13n ic=0)
${ADC}
${DAC5}` },
  // a divide-by-5 (high for 2 inputs) and a look-up table (a 2-input majority-ish function)
  { name: "fdiv-lut", probes: ["vdiv", "vlut"], tStop: 30e-6, text: `
V1 clk 0 PULSE(0 5 0.5u 20n 20n 1u 2u)
V2 a 0 PULSE(0 5 3u 20n 20n 5u 9u)
A1 [clk a] [dc da] adc
A2 dc ddiv div
A3 [dc da] dlut lut
A4 [ddiv dlut] [vdiv vlut] dac5
.model div d_fdiv(div_factor=5 high_cycles=2 i_count=0 rise_delay=7n fall_delay=9n)
.model lut d_lut(table_values="0110" rise_delay=6n fall_delay=8n)
${ADC}
${DAC5}` },
  // two tristate drivers on one net taking turns, and an open collector with a pull-up
  { name: "tristate-opencollector", probes: ["vbus", "voc"], tStop: 20e-6, text: `
V1 en 0 PULSE(0 5 2u 20n 20n 5u 10u)
V2 a 0 PULSE(0 5 1u 20n 20n 1u 3u)
A1 [en a] [den da] adc
A2 den nen inv
A3 da den bus ts
A4 da nen bus ts
A5 da oc oc1
A6 oc pu
A7 [bus oc] [vbus voc] dac5
.model inv d_inverter(rise_delay=4n fall_delay=4n)
.model ts d_tristate(delay=6n)
.model oc1 d_open_c(open_delay=8n fall_delay=5n)
.model pu d_pullup
${ADC}
${DAC5}` },
  // a relaxation oscillator through the bridges: an inverter charges a capacitor through R, its
  // input reads the capacitor (the crossing times set the period); started from zero (it has no DC
  // state). Its drive's edges are compared by time: ngspice sees each crossing up to a step late,
  // so its edges lag more at every one; at a 0.05 ns step its 53rd is 1 ns late (at 1 ns, 63 ns;
  // the engine lands on each crossing, and gives ngspice's limit)
  { name: "rc-oscillator", probes: ["cap"], edges: "drv", tStop: 60e-6, uic: true, step: 0.05e-9, text: `
A1 [cap] [dcap] adch
A2 dcap y inv
A3 [y] [drv] dac5
R1 drv cap 10k
C1 cap 0 1n
.model adch adc_bridge(in_low=2.5 in_high=2.5 rise_delay=200n fall_delay=200n)
.model inv d_inverter(rise_delay=300n fall_delay=300n)
${DAC5}` }
];

function ours(b) {
  const pins = b.probes.concat(b.edges || []), sub = `.subckt BENCH ${pins.join(" ")}\n${b.text.trim()}\n.ends\n`;
  const f = SN.flatten(sub, "BENCH");
  let n = f.nNodes;
  const els = SN.build({ text: sub, sub: "BENCH" }, pins.map((_, i) => i + 1), () => n++, "U");
  const r = E.transient({ nodeCount: n, elements: els }, { tStop: b.tStop, uic: !!b.uic });
  if (!r.ok) return { error: r.error };
  const v = {}; pins.forEach((p, i) => { v[p] = r.nodes[i + 1]; });
  return { t: r.t, v, steps: r.steps, ms: r.elapsedMs };
}
function theirs(b) {
  const cir = join(work, b.name + ".cir"), step = b.step || 1e-9;
  writeFileSync(cir, `* ${b.name}\n${b.text.trim()}\n.control\nset noaskquit\nset width=400\ntran ${step} ${b.tStop} 0 ${step}${b.uic ? " uic" : ""}\nwrdata ${join(work, b.name + ".dat")} ${b.probes.concat(b.edges || []).map(p => `v(${p})`).join(" ")}\n.endc\n.end\n`);
  try { execFileSync(NGSPICE, ["-b", cir], { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 300) }; }
  const rows = readFileSync(join(work, b.name + ".dat"), "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const t = rows.map(r => r[0]), v = {};
  b.probes.concat(b.edges || []).forEach((p, i) => { v[p] = rows.map(r => r[2 * i + 1]); });
  return { t, v };
}
const at = (t, y, x) => {
  let lo = 0, hi = t.length - 1;
  if (x <= t[0]) return y[0]; if (x >= t[hi]) return y[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m; else hi = m; }
  return y[lo] + (y[hi] - y[lo]) * (x - t[lo]) / (t[hi] - t[lo]);
};

for (const b of BENCHES) {
  if (ONLY && !b.name.includes(ONLY)) continue;
  const a = ours(b), q = theirs(b);
  if (a.error || q.error) { check(false, `${b.name}: ${a.error ? "ours: " + a.error : "ngspice: " + q.error}`); continue; }
  const tol = b.tol || 0.01, SLACK = 1e-9;
  if (b.edges) {
    const cross = (t, y) => { const out = []; for (let i = 1; i < t.length; i++) if ((y[i - 1] - 2.5) * (y[i] - 2.5) < 0) out.push(t[i - 1] + (2.5 - y[i - 1]) * (t[i] - t[i - 1]) / (y[i] - y[i - 1])); return out; };
    // (the start from zero is not an edge: here the output's node is 0 V before the first step)
    const ea = cross(a.t, a.v[b.edges]).filter(x => x > 1e-9), eq = cross(q.t, q.v[b.edges]).filter(x => x > 1e-9), al = b.step || 1e-9;
    let worst = 0; ea.forEach((x, k) => { if (k < eq.length) worst = Math.max(worst, Math.abs(x - eq[k]) / ((k + 1) * 2 * al)); });
    check(ea.length === eq.length && worst <= 1, `${b.name} v(${b.edges}): ${ea.length} edges here, ${eq.length} in ngspice, each within ${(worst * 100).toFixed(0)} % of its allowance (two of its ${(b.step || 1e-9) * 1e9} ns steps per edge so far); last at ${ea.length ? (ea[ea.length - 1] * 1e6).toFixed(4) : "-"} µs here, ${eq.length ? (eq[eq.length - 1] * 1e6).toFixed(4) : "-"} µs in ngspice`);
  }
  b.probes.forEach(p => {
    const ys = q.v[p], swing = ys.reduce((m, y) => Math.max(m, y), -Infinity) - ys.reduce((m, y) => Math.min(m, y), Infinity) || 1;
    let worst = 0, wAt = 0;
    for (let k = 1; k <= 400; k++) {
      // the instants sit between edges: 400 of them, nudged off the sources' round times
      const x = b.tStop * (k - 0.37) / 400, y = at(a.t, a.v[p], x), w = [at(q.t, ys, x - SLACK), at(q.t, ys, x), at(q.t, ys, x + SLACK)];
      const d = Math.max(0, Math.min(...w) - y, y - Math.max(...w)) / swing;
      if (d > worst) { worst = d; wAt = x; }
    }
    check(worst <= tol, `${b.name} v(${p}): within ${(worst * 100).toFixed(2)} % of its ${swing.toPrecision(3)} V swing (≤ ${tol * 100} % within 1 ns; ${a.steps} steps, ${a.ms} ms)${process.env.KEEP ? ` worst at ${wAt.toPrecision(4)} s` : ""}`);
  });
}
// the CAD's logic ICs (cad-components.js LOGIC_ICS) as the app builds them, against the XSPICE
// subcircuit the SPICE export writes for each (CadLib.logicSpice): every input a pulse train of its
// own period (set/reset pulsed once, active-low ones held inactive), every output's crossings of
// half the supply the same in number and within a tenth of the IC's delay
if (!ONLY || "cad-logic".includes(ONLY)) for (const [model, m] of Object.entries(L.LOGIC_ICS)) {
  const F = L.LOGIC_FAMS[m.fam], vcc = m.fam === "cd" ? 10 : 5, { ins, outs } = L.logicPinIds(m), T = m.fam === "cd" ? 4e-6 : 1e-6, tStop = 40 * T;
  const nIn = k => 2 + k, nOut = k => 2 + ins.length + k, net = [`* ${model}`, ...L.logicSpice(model, "LG"), `V1 1 0 ${vcc}`], els = [{ id: "V1", kind: "V", nodes: [1, 0], v: vcc }];
  ins.forEach((id, k) => {
    const per = [1, 2.7, 3.9][Math.min(k, 2)] * T;
    const w = /^(PRE|CLR)$/.test(id) || id === "CE" ? null : /^(S|R|MR|RST)$/.test(id) ? [0, vcc, 23.3 * T, F.tt, F.tt, 1.1 * T, 1e3] : [0, vcc, 0.3 * T + k * 0.17 * T, F.tt, F.tt, per / 2 - F.tt, per];
    const dc = id === "CE" ? 0 : vcc;
    if (!w) { net.push(`VI${k} ${nIn(k)} 0 ${dc}`); els.push({ id: "VI" + k, kind: "V", nodes: [nIn(k), 0], v: dc }); return; }
    net.push(`VI${k} ${nIn(k)} 0 PULSE(${w.join(" ")})`);
    els.push({ id: "VI" + k, kind: "V", nodes: [nIn(k), 0], v: 0, tw: { type: "pulse", v1: w[0], v2: w[1], td: w[2], tr: w[3], tf: w[4], pw: w[5], per: w[6] } });
  });
  outs.forEach((o, k) => { net.push(`RL${k} ${nOut(k)} 0 100k`); els.push({ id: "RL" + k, kind: "R", nodes: [nOut(k), 0], r: 1e5 }); });
  const file = join(work, `cad-${model}.cir`), out = join(work, `cad-${model}.txt`);
  net.push(`XU ${ins.map((_, k) => nIn(k)).join(" ")} ${outs.map((_, k) => nOut(k)).join(" ")} 1 0 LG`, `.tran ${T / 2000} ${tStop}`, ".control", "run", `wrdata ${out} ${outs.map((_, k) => `v(${nOut(k)})`).join(" ")}`, ".endc", ".end");
  writeFileSync(file, net.join("\n"));
  let n = 2 + ins.length + outs.length;
  const pins = { VCC: 1, GND: 0 }; ins.forEach((id, k) => { pins[id] = nIn(k); }); outs.forEach((id, k) => { pins[id] = nOut(k); });
  L.LIB.logic.build({ id: "U", type: "logic", label: "DD1", params: { model } }, p => pins[p], () => n++, els);
  try { execFileSync(NGSPICE, ["-b", file], { stdio: "ignore" }); } catch { check(false, `cad-logic ${model}: ngspice failed (${file})`); continue; }
  const rows = readFileSync(out, "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number)), r = E.transient({ nodeCount: n, elements: els }, { tStop, maxStep: T / 200 });
  if (!r.ok) { check(false, `cad-logic ${model}: ${r.error}`); continue; }
  const th = vcc / 2, cross = (t, y) => { const a = []; for (let i = 1; i < t.length; i++) if ((y[i - 1] - th) * (y[i] - th) < 0) a.push(t[i - 1] + (th - y[i - 1]) / (y[i] - y[i - 1]) * (t[i] - t[i - 1])); return a; };
  let worst = 0, same = true, count = 0;
  outs.forEach((o, k) => {
    const a = cross(r.t, r.nodes[nOut(k)]), b = cross(rows.map(x => x[0]), rows.map(x => x[2 * k + 1]));
    if (a.length !== b.length) { same = false; console.log(`  ${model} ${o}: ${a.length} edges here, ${b.length} in ngspice`); }
    a.forEach((x, i) => { if (i < b.length) worst = Math.max(worst, Math.abs(x - b[i])); }); count += a.length;
  });
  check(same && count > 0 && worst <= 0.1 * m.tpd, `cad-logic ${model}: ${count} output edges as in ngspice, within ${(worst * 1e9).toFixed(2)} ns (≤ ${(0.1 * m.tpd * 1e9).toFixed(1)} ns)`);
}
console.log(failed ? `${failed} FAILED` : "all logic benches match ngspice");
process.exit(failed ? 1 : 0);
