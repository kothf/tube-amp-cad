#!/usr/bin/env node
/**
 * The DC sweep (sim-engine.js dcSweep, the Transient tab's DC sweep mode) against ngspice's .dc:
 * each bench is a small circuit with one value swept (a source's voltage or current, or the
 * temperature), run here (spice-net.js builds a netlist for every value, as the CAD does for a
 * part's value) and in ngspice, and every probed node compared at every point, within 0.5 % of its
 * swing plus 1 mV.
 *
 *   node tests/dcsweep-ngspice.mjs     # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the binary, ONLY=bjt runs the benches whose name has that in it.
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
const work = mkdtempSync(join(tmpdir(), "tubecad-dc-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

// name, the circuit (ground 0) with {X} where the swept source's value goes (temp: the
// temperature in °C, SPICE's scale), the source swept (its name, or "temp"), from, to, step, probes
const BENCHES = [
  { name: "diode-r", src: "V1", from: -1, to: 3, step: 0.05, probes: ["a"], text: `
V1 in 0 {X}
R1 in a 100
D1 a 0 DX
.model DX D(IS=2.5n N=1.75 RS=0.5)` },
  { name: "zener-reverse", src: "V1", from: -10, to: 2, step: 0.1, probes: ["k"], text: `
V1 a 0 {X}
R1 a k 1k
D1 0 k DZ
.model DZ D(IS=1e-14 N=1 BV=5.1 IBV=1m RS=2)` },
  { name: "bjt-output", src: "VC", from: 0, to: 10, step: 0.1, probes: ["c", "b"], text: `
VC vc 0 {X}
RC vc c 100
IB 0 b 20u
Q1 c b 0 QN
.model QN NPN(IS=1e-14 BF=150 BR=3 VAF=80 IKF=0.3)` },
  { name: "bjt-temp", src: "temp", from: -20, to: 120, step: 5, probes: ["c", "b"], text: `
VCC vcc 0 12
RB vcc b 470k
RC vcc c 2.2k
Q1 c b 0 QN
.model QN NPN(IS=1e-14 BF=150 VAF=80 XTI=3 EG=1.11 XTB=1.5)` },
  { name: "mos-transfer", src: "VG", from: 0, to: 5, step: 0.05, probes: ["d"], text: `
VDD vdd 0 10
VG g 0 {X}
RD vdd d 1k
M1 d g 0 0 NM L=2u W=20u
.model NM NMOS(LEVEL=1 VTO=1.2 KP=50u LAMBDA=0.02)` },
  { name: "isrc-diode", src: "I1", from: 0, to: 0.02, step: 0.0005, probes: ["a"], text: `
I1 0 a {X}
D1 a 0 DX
R1 a 0 220
.model DX D(IS=1e-12 N=1.9 RS=0.2)` },
];

const sweepValues = b => { const out = []; for (let k = 0; ; k++) { const v = b.from + k * b.step; if (v > b.to + b.step * 1e-6) break; out.push(+v.toPrecision(12)); } return out; };
// ours: a netlist for every value (the bench as a subcircuit whose pins are its probes)
function ours(b) {
  const xs = sweepValues(b), temp = b.src === "temp";
  const netlists = xs.map(x => {
    const text = b.text.trim().replace("{X}", temp ? "0" : String(x));
    const sub = `.subckt BENCH ${b.probes.join(" ")}\n${text}\n.ends\n`;
    const f = SN.flatten(sub, "BENCH");
    let n = f.nNodes;
    // the engine's 25 °C is SPICE's 27 °C (its thermal voltage is SPICE's at 27 °C)
    const els = SN.build(Object.assign({ text: sub, sub: "BENCH" }, temp ? { temp: x - 2 } : {}), b.probes.map((_, i) => i + 1), () => n++, "U");
    return { nodeCount: n, elements: els };
  });
  const r = E.dcSweep(netlists, { x: xs });
  if (!r.ok) return { error: r.error };
  if (r.failed.length) return { error: `no operating point at ${r.failed.map(k => xs[k]).join(", ")}` };
  const v = {}; b.probes.forEach((p, i) => { v[p] = r.nodes[i + 1]; });
  return { x: xs, v, ms: r.elapsedMs };
}
function theirs(b) {
  const cir = join(work, b.name + ".cir"), temp = b.src === "temp";
  const text = b.text.trim().replace("{X}", temp ? "0" : "0");
  writeFileSync(cir, `* ${b.name}\n${text}\n.options reltol=1e-5\n.control\nset noaskquit\nset width=400\ndc ${b.src} ${b.from} ${b.to} ${b.step}\nwrdata ${join(work, b.name + ".dat")} ${b.probes.map(p => `v(${p})`).join(" ")}\n.endc\n.end\n`);
  try { execFileSync(NGSPICE, ["-b", cir], { encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { return { error: String(e.stderr || e.message).slice(0, 300) }; }
  const rows = readFileSync(join(work, b.name + ".dat"), "utf8").trim().split("\n").map(l => l.trim().split(/\s+/).map(Number));
  const v = {};
  b.probes.forEach((p, i) => { v[p] = rows.map(r => r[2 * i + 1]); });
  return { x: rows.map(r => r[0]), v };
}

for (const b of BENCHES) {
  if (ONLY && !b.name.includes(ONLY)) continue;
  const a = ours(b), q = theirs(b);
  if (a.error || q.error) { check(false, `${b.name}: ${a.error ? "ours: " + a.error : "ngspice: " + q.error}`); continue; }
  if (a.x.length !== q.x.length) { check(false, `${b.name}: ${a.x.length} points here, ${q.x.length} in ngspice`); continue; }
  b.probes.forEach(p => {
    const ys = q.v[p], swing = Math.max(...ys) - Math.min(...ys);
    let worst = 0, wAt = 0;
    ys.forEach((y, k) => { const d = Math.abs(a.v[p][k] - y) / (0.005 * swing + 1e-3); if (d > worst) { worst = d; wAt = q.x[k]; } });
    check(worst <= 1, `${b.name} v(${p}) over ${b.src} ${b.from}…${b.to}: worst ${(worst * 100).toFixed(0)} % of the tolerance (0.5 % of its ${swing.toPrecision(3)} V swing + 1 mV) at ${wAt} (${a.x.length} points, ${a.ms} ms)`);
  });
}
console.log(failed ? `${failed} FAILED` : "all DC sweep benches match ngspice");
process.exit(failed ? 1 : 0);
