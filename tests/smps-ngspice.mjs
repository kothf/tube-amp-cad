#!/usr/bin/env node
/**
 * Switching converters, the free transient (sim-engine.js transient) against ngspice's .tran: a
 * buck, a boost, a flyback (coupled inductors) and a class-D stage, each switched by a SPICE
 * switch (S with VT, VH: ngspice reads PSpice's VON/VOFF as nothing and switches at 0 V, where
 * this program takes them as PSpice does, a smooth change between them) from a PULSE or from a
 * comparator, started from zero. For each output:
 *   - the waveform through the start-up, at 400 instants, within 2 % of its swing (the soft start,
 *     the overshoot and the settling are the same);
 *   - over the last periods, the average (the converter's output voltage) within 1 %, and the
 *     ripple (peak to peak) within 10 % of ngspice's (or 2 mV);
 * and for the switching node, its average over the last periods within 1 % of the input.
 *
 *   node tests/smps-ngspice.mjs     # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the binary, ONLY=buck runs the benches whose name has that in it, KEEP=1 prints the
 * worst instant of each.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["spice-model.js", "spice-net.js", "sim-engine.js", "wave-math.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet, WM = globalThis.WaveMath;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "tubecad-smps-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

// name, circuit, smooth outputs (waveform + average + ripple), switching nodes (average only),
// the run, the switching period (the last `periods` of them are averaged), the input voltage
const BENCHES = [
  { name: "buck-12v-5v", out: ["out"], sw: ["sw"], tStop: 3e-3, period: 10e-6, periods: 20, vin: 12, text: `
VIN in 0 12
VG g 0 PULSE(0 5 0 20n 20n 4.2u 10u)
S1 in sw g 0 SWM
D1 0 sw DS
L1 sw out 100u
C1 out 0 100u
RL out 0 10
.model SWM SW(RON=0.05 ROFF=1meg VT=2.5 VH=0)
.model DS D(IS=1e-6 N=1.2 RS=0.02 CJO=200p)` },
  { name: "boost-5v-12v", out: ["out"], sw: ["sw"], tStop: 4e-3, period: 10e-6, periods: 20, vin: 5, text: `
VIN in 0 5
VG g 0 PULSE(0 5 0 20n 20n 5.8u 10u)
L1 in sw 47u
S1 sw 0 g 0 SWM
D1 sw out DS
C1 out 0 47u
RL out 0 100
.model SWM SW(RON=0.05 ROFF=1meg VT=2.5 VH=0)
.model DS D(IS=1e-6 N=1.2 RS=0.02 CJO=200p)` },
  // (an RC across the output diode, as a real flyback has: without it the secondary's leakage rings
  // with the diode's capacitance at 30 MHz through every on-time, and the steps follow the ring)
  { name: "flyback-24v-5v", out: ["out"], sw: [], tStop: 3e-3, period: 10e-6, periods: 20, vin: 24, text: `
VIN in 0 24
VG g 0 PULSE(0 5 0 20n 20n 3.5u 10u)
LP in d 200u
LS 0 s 12.5u
K1 LP LS 0.995
S1 d 0 g 0 SWM
RSN d c 100
CSN c 0 1n
D1 s out DS
RS2 s x 47
CS2 x out 1n
C1 out 0 220u
RL out 0 5
.model SWM SW(RON=0.1 ROFF=1meg VT=2.5 VH=0)
.model DS D(IS=1e-6 N=1.2 RS=0.02 CJO=200p)` },
  // class D: a 1 kHz sine against a 250 kHz triangle drives a half bridge of two switches
  // (one turned on by the sign of the difference, the other by its opposite, each with its body
  // diode), into an LC filter
  { name: "class-d-1khz", out: ["out"], sw: [], tStop: 3e-3, period: 1e-3, periods: 2, vin: 0, text: `
VP vp 0 20
VN vn 0 -20
VS sig 0 SIN(0 0.6 1k)
VT tri 0 PWL(0 -1 2u 1 4u -1) r=0
S1 vp sw sig tri SWM
S2 sw vn tri sig SWM
D1 sw vp DB
D2 vn sw DB
L1 sw out 47u
C1 out 0 1u
RL out 0 8
.model SWM SW(RON=0.1 ROFF=1meg VT=0 VH=0)
.model DB D(IS=1e-9 N=1.5 RS=0.05 CJO=100p)` },
];

function ours(b) {
  const probes = b.out.concat(b.sw);
  const sub = `.subckt BENCH ${probes.join(" ")}\n${b.text.trim()}\n.ends\n`;
  const f = SN.flatten(sub, "BENCH");
  let n = f.nNodes;
  const els = SN.build({ text: sub, sub: "BENCH" }, probes.map((_, i) => i + 1), () => n++, "U");
  const r = E.transient({ nodeCount: n, elements: els }, { tStop: b.tStop, maxStep: b.period / 20, uic: true, budgetMs: 600000 });
  if (!r.ok) return { error: r.error };
  const v = {}; probes.forEach((p, i) => { v[p] = r.nodes[i + 1]; });
  return { t: r.t, v, steps: r.steps, ms: r.elapsedMs };
}
function theirs(b) {
  const probes = b.out.concat(b.sw), cir = join(work, b.name + ".cir"), step = b.period / 200;
  writeFileSync(cir, `* ${b.name}\n${b.text.trim()}\n.options reltol=1e-4\n.control\nset noaskquit\nset width=400\ntran ${step} ${b.tStop} 0 ${step} uic\nwrdata ${join(work, b.name + ".dat")} ${probes.map(p => `v(${p})`).join(" ")}\n.endc\n.end\n`);
  try { execFileSync(NGSPICE, ["-b", cir], { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 300) }; }
  const rows = readFileSync(join(work, b.name + ".dat"), "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const t = Float64Array.from(rows.map(r => r[0])), v = {};
  probes.forEach((p, i) => { v[p] = Float64Array.from(rows.map(r => r[2 * i + 1])); });
  return { t, v };
}

for (const b of BENCHES) {
  if (ONLY && !b.name.includes(ONLY)) continue;
  const a = ours(b), q = theirs(b);
  if (a.error || q.error) { check(false, `${b.name}: ${a.error ? "ours: " + a.error : "ngspice: " + q.error}`); continue; }
  const x1 = b.tStop, x0 = x1 - b.periods * b.period;
  b.out.forEach(p => {
    const ys = q.v[p], swing = WM.measure("pp", q.t, ys, 0, b.tStop) || 1;
    let worst = 0, wAt = 0;
    for (let k = 1; k <= 400; k++) {
      const x = b.tStop * k / 400, d = Math.abs(WM.measure("at", a.t, a.v[p], 0, b.tStop, { at: x }) - WM.measure("at", q.t, ys, 0, b.tStop, { at: x })) / swing;
      if (d > worst) { worst = d; wAt = x; }
    }
    check(worst <= 0.02, `${b.name} v(${p}) from zero: within ${(worst * 100).toFixed(2)} % of its ${swing.toPrecision(3)} V swing (≤ 2 %; ${a.steps} steps, ${a.ms} ms)${process.env.KEEP ? ` worst at ${wAt.toPrecision(4)} s` : ""}`);
    const avA = WM.measure("avg", a.t, a.v[p], x0, x1), avQ = WM.measure("avg", q.t, ys, x0, x1);
    const ppA = WM.measure("pp", a.t, a.v[p], x0, x1), ppQ = WM.measure("pp", q.t, ys, x0, x1);
    check(Math.abs(avA - avQ) <= 0.01 * Math.max(Math.abs(avQ), 0.1 * swing), `${b.name} v(${p}) ${b.vin ? "average" : "mean"} over the last ${b.periods} periods: ${avA.toPrecision(4)} V here, ${avQ.toPrecision(4)} V in ngspice`);
    if (b.vin) check(Math.abs(ppA - ppQ) <= Math.max(0.1 * ppQ, 2e-3), `${b.name} v(${p}) ripple: ${(ppA * 1e3).toPrecision(3)} mV here, ${(ppQ * 1e3).toPrecision(3)} mV in ngspice`);
    else check(Math.abs(ppA - ppQ) <= 0.02 * ppQ, `${b.name} v(${p}) amplitude: ${ppA.toPrecision(4)} V p-p here, ${ppQ.toPrecision(4)} V in ngspice`);
  });
  b.sw.forEach(p => {
    const avA = WM.measure("avg", a.t, a.v[p], x0, x1), avQ = WM.measure("avg", q.t, q.v[p], x0, x1);
    check(Math.abs(avA - avQ) <= 0.01 * b.vin, `${b.name} v(${p}) (switching) average over the last ${b.periods} periods: ${avA.toPrecision(4)} V here, ${avQ.toPrecision(4)} V in ngspice`);
  });
}
console.log(failed ? `${failed} FAILED` : "all switching converters match ngspice");
process.exit(failed ? 1 : 0);
