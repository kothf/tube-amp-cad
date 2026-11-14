#!/usr/bin/env node
/**
 * The free transient (sim-engine.js transient) against ngspice's .tran: each bench is a small
 * circuit with a time source (PULSE, SIN, EXP, SFFM, PWL) or a B source that reads time, run
 * here (spice-net.js turns the text into the engine's elements, as a SPICE part) and in ngspice,
 * and every probed node compared at 400 instants over the run, within 1 % of its swing (2 % for
 * the switching benches, whose edges move by a fraction of a step). The engine's own steps
 * (adaptive, landing on the sources' corners) are used, not ngspice's.
 *
 *   node tests/transient-ngspice.mjs     # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the binary, ONLY=rlc runs the benches whose name has that in it, KEEP=1 prints the
 * worst instant of each.
 */
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["spice-model.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "tubecad-tran-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

// name, the circuit (ground 0), the nodes compared, the run, tolerance (share of the swing), and
// for a start from zero (uic) the initial conditions { node: volts }
const BENCHES = [
  { name: "rc-pulse", probes: ["in", "out"], tStop: 5e-3, text: `
V1 in 0 PULSE(0 5 0.2m 1u 1u 0.6m 1.5m)
R1 in out 1k
C1 out 0 330n` },
  // twenty periods of a Q of 30: the phase the steps lose adds up (1.7 % at the end)
  { name: "rlc-ring", probes: ["out"], tStop: 400e-6, tol: 0.02, text: `
V1 in 0 PULSE(0 1 10u 10n 10n 150u 0)
R1 in a 10
L1 a out 1m
C1 out 0 10n
R2 out 0 100k` },
  { name: "rectifier-sin", probes: ["out", "in"], tStop: 60e-3, text: `
V1 in 0 SIN(0 20 50)
D1 in out DX
C1 out 0 100u
R1 out 0 1k
.model DX D(IS=2.5n N=1.75 RS=0.05 CJO=50p)` },
  { name: "pwl-repeat-rl", probes: ["in", "out"], tStop: 6e-3, text: `
V1 in 0 PWL(0 0 0.5m 3 1m 3 1.2m -1 2m 0) r=0
R1 in out 100
L1 out 0 20m` },
  { name: "exp-rc", probes: ["out"], tStop: 4e-3, text: `
V1 in 0 EXP(0 2 0.3m 0.2m 2m 0.4m)
R1 in out 2k
C1 out 0 100n` },
  { name: "sffm-lowpass", probes: ["in", "out"], tStop: 2e-3, text: `
V1 in 0 SFFM(0.5 1 5k 3 1k)
R1 in out 1k
C1 out 0 10n` },
  { name: "isrc-pulse", probes: ["out"], tStop: 3e-3, text: `
I1 0 out PULSE(0 1m 0.5m 10u 10u 1m 0)
R1 out 0 2k
C1 out 0 220n` },
  { name: "b-time-am", probes: ["out"], tStop: 4e-3, text: `
V1 in 0 SIN(0 1 2k)
B1 out 0 V=V(in)*(1+0.5*sin(2*pi*250*time))
R1 out 0 1k` },
  { name: "bjt-switch", probes: ["c", "b"], tStop: 40e-6, tol: 0.02, text: `
V1 in 0 PULSE(0 5 2u 20n 20n 10u 20u)
VCC vcc 0 5
RB in b 4.7k
RC vcc c 1k
Q1 c b 0 QN
.model QN NPN(IS=1e-14 BF=150 BR=3 VAF=80 CJE=20p CJC=8p TF=0.4n TR=60n RB=10)` },
  { name: "ic-uic-rc", probes: ["out"], tStop: 3e-3, uic: { out: 4 }, text: `
R1 out 0 1k
C1 out 0 470n
V1 in 0 PULSE(0 2 1m 1u 1u 5m 0)
R2 in out 3.3k` },
];

// ours: the bench as a subcircuit whose pins are its probes (the nodes 1…k), its transient
function ours(b) {
  const sub = `.subckt BENCH ${b.probes.join(" ")}\n${b.text.trim()}\n.ends\n`;
  const f = SN.flatten(sub, "BENCH");
  let n = f.nNodes;
  const els = SN.build({ text: sub, sub: "BENCH" }, b.probes.map((_, i) => i + 1), () => n++, "U");
  const ic = {}; if (b.uic) Object.entries(b.uic).forEach(([k, v]) => { ic[b.probes.indexOf(k) + 1] = v; });
  const r = E.transient({ nodeCount: n, elements: els }, { tStop: b.tStop, uic: !!b.uic, ic });
  if (!r.ok) return { error: r.error };
  const v = {}; b.probes.forEach((p, i) => { v[p] = r.nodes[i + 1]; });
  return { t: r.t, v, steps: r.steps, ms: r.elapsedMs };
}
// ngspice: .tran at a fine step, every probe printed
function theirs(b) {
  const cir = join(work, b.name + ".cir"), step = b.tStop / 20000;
  const ic = b.uic ? `.ic ${Object.entries(b.uic).map(([k, v]) => `v(${k})=${v}`).join(" ")}\n` : "";
  writeFileSync(cir, `* ${b.name}\n${b.text.trim()}\n${ic}.options reltol=1e-4\n.control\nset noaskquit\nset width=400\ntran ${step} ${b.tStop} 0 ${step}${b.uic ? " uic" : ""}\nwrdata ${join(work, b.name + ".dat")} ${b.probes.map(p => `v(${p})`).join(" ")}\n.endc\n.end\n`);
  try { execFileSync(NGSPICE, ["-b", cir], { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 300) }; }
  const rows = readFileSync(join(work, b.name + ".dat"), "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const t = rows.map(r => r[0]), v = {};
  b.probes.forEach((p, i) => { v[p] = rows.map(r => r[2 * i + 1]); });
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
  const tol = b.tol || 0.01;
  b.probes.forEach(p => {
    const ys = q.v[p], swing = Math.max(...ys) - Math.min(...ys) || 1;
    let worst = 0, wAt = 0;
    for (let k = 1; k <= 400; k++) {
      const x = b.tStop * k / 400, d = Math.abs(at(a.t, a.v[p], x) - at(q.t, ys, x)) / swing;
      if (d > worst) { worst = d; wAt = x; }
    }
    check(worst <= tol, `${b.name} v(${p}): within ${(worst * 100).toFixed(2)} % of its ${swing.toPrecision(3)} V swing (≤ ${tol * 100} %; ${a.steps} steps, ${a.ms} ms)${process.env.KEEP ? ` worst at ${wAt.toPrecision(4)} s` : ""}`);
  });
}
console.log(failed ? `${failed} FAILED` : "all transient benches match ngspice");
process.exit(failed ? 1 : 0);
