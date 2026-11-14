#!/usr/bin/env node
/**
 * SPICE parts against ngspice: the same model file is solved by the simulator
 * (spice-net.js turns it into the engine's elements) and by ngspice, and the
 * operating points and the frequency responses (gain and phase, 10 Hz to 1 MHz) are compared.
 *
 *   1  the test fixtures (tests/fixtures): device models, sources, a switch, a
 *      table, a polynomial; an op-amp macromodel as a ×11 amplifier; the devices'
 *      capacitances and transit time in small amplifiers (acdev.lib); waveforms
 *      (trandev.lib): a diode's reverse recovery, transistor, CMOS and power MOSFET switches, a class-B
 *      follower clipping, a varactor swung hard, each driven by a square or a sine and its
 *      settled period compared with ngspice's point by point (within a time step), each within 2 % of its swing
 *   2  makers' models (tests/models.json): each op-amp as a ×11 amplifier on
 *      ±supplies with 0.1 V in: its output voltage, then its gain and phase
 *      (0.1 dB and 1° up to 20 kHz, 0.3 dB and 3° up to 1 MHz). The files are not kept in this repository:
 *      they are read from the KiCad-Spice-Library project at a fixed commit,
 *      fetched into MODELS_DIR (default: a folder in the system's temporary
 *      directory). Without network access this part is skipped, and said so.
 *
 *   node tests/models.mjs            # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the ngspice binary, MODELS_DIR the library's folder, ONLY=TL072 runs
 * the models (and waveform benches) whose name has that in it, SURVEY=1 lists every model's result.
 * An entry of models.json marked "known" is a model the simulator does not solve yet:
 * it is reported, and fails the run only when it starts to pass (so the mark is removed).
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "tubecad-models-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

// a bench subcircuit (its pins the nodes to compare) solved here: { v: { node: volts } } or { error }
function ours(lib, bench, name) {
  try {
    const text = lib + "\n" + bench, f = SN.flatten(text, name);
    let n = f.nNodes;
    const els = SN.build({ text, sub: name }, f.pins.map((_, i) => i + 1), () => n++, "U");
    const res = E.simulate({ nodeCount: n, elements: els }, {});
    if (!res.ok) return { error: res.error };
    const v = {}; f.pins.forEach((p, i) => { v[p] = res.dc.nodes[i + 1]; });
    return { v, warnings: f.warnings };
  } catch (e) { return { error: e.message || String(e) }; }
}
// the same in ngspice: { v } or { error }
function theirs(lib, bench, name, nodes) {
  const cir = join(work, "t.cir");
  // (ngspice refuses a file that is not UTF-8: old libraries' comments in other code pages go as "?")
  writeFileSync(cir, `* bench\n${lib.replace(/[\u0080-\uffff]/g, "?")}\n${bench}\nX0 ${nodes.join(" ")} ${name}\n.op\n.control\nset noaskquit\nop\nprint ${nodes.map(n => `v(${n})`).join(" ")}\n.endc\n.end\n`, "latin1");
  let out; try { out = execFileSync(NGSPICE, ["-b", cir], { encoding: "latin1", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const v = {}; nodes.forEach(n => { const m = new RegExp(`v\\(${n}\\) = ([-+0-9.e]+)`, "i").exec(out); if (m) v[n] = +m[1]; });
  return Object.keys(v).length === nodes.length ? { v } : { error: (out.match(/error[^\n]*/gi) || ["no result"]).slice(0, 2).join(" | ") };
}
// both, and the worst difference (relative, with 10 mV of floor)
function compare(lib, bench, name, nodes) {
  const a = ours(lib, bench, name), b = theirs(lib, bench, name, nodes);
  let worst = 0, at = "";
  if (a.v && b.v) nodes.forEach(n => { const err = Math.abs(a.v[n] - b.v[n]) / (Math.abs(b.v[n]) + 0.01); if (!(err <= worst)) { worst = err; at = `V(${n}) ${a.v[n].toPrecision(5)} / ngspice ${b.v[n].toPrecision(5)}`; } });
  return { a, b, worst, at };
}
// --- the frequency response: the bench's "in" source driven, gain (dB) and phase (°) at its pins ---
const F0 = 10, F1 = 1e6, PER = 5;
function oursAc(lib, bench, name, pins, f1) {
  try {
    const text = lib + "\n" + bench, f = SN.flatten(text, name);
    let n = f.nNodes;
    const els = SN.build({ text, sub: name }, f.pins.map((_, i) => i + 1), () => n++, "U");
    const ac = E.acSweep({ nodeCount: n, elements: els }, { inputs: [{ id: els.find(e => /#vin$/i.test(e.id)).id }], fStart: F0, fStop: f1, perDecade: PER, probes: pins.map(p => [f.pins.indexOf(p) + 1, 0]) });
    if (!ac.ok) return { error: ac.error };
    return { f: Array.from(ac.freqs), db: ac.probes.map(p => Array.from(ac.freqs, (_, k) => 20 * Math.log10(Math.hypot(p.re[k], p.im[k])))), ph: ac.probes.map(p => Array.from(ac.freqs, (_, k) => Math.atan2(p.im[k], p.re[k]) * 180 / Math.PI)) };
  } catch (e) { return { error: e.message || String(e) }; }
}
function theirsAc(lib, bench, name, nodes, pins, f1) {
  const cir = join(work, "t.cir");
  writeFileSync(cir, `* bench\n${lib.replace(/[\u0080-\uffff]/g, "?")}\n${bench}\nX0 ${nodes.join(" ")} ${name}\n.control\nset noaskquit\nset units=degrees\nac dec ${PER} ${F0} ${f1}\n${pins.map(p => `print vdb(${p})\nprint vp(${p})`).join("\n")}\n.endc\n.end\n`, "latin1");
  let out; try { out = execFileSync(NGSPICE, ["-b", cir], { encoding: "latin1", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  // each print is a table "index frequency value" under a header naming the vector
  const cols = {}; let cur = null;
  out.split("\n").forEach(l => { const h = /^Index\s+frequency\s+(\S+)/.exec(l), r = /^\d+\s+([-+.\de]+)\s+([-+.\de]+)\s*$/.exec(l); if (h) { cur = h[1].toLowerCase(); cols[cur] = cols[cur] || []; } else if (r && cur) cols[cur].push([+r[1], +r[2]]); });
  const first = cols[`vdb(${pins[0]})`];
  if (!first || !first.length) return { error: (out.match(/error[^\n]*/gi) || ["no result"]).slice(0, 2).join(" | ") };
  return { f: first.map(r => r[0]), db: pins.map(p => (cols[`vdb(${p})`] || []).map(r => r[1])), ph: pins.map(p => (cols[`vp(${p})`] || []).map(r => r[1])) };
}
// the worst differences up to 20 kHz and over the whole sweep: { lo: [dB, °], all: [dB, °], at } or { error }, { dead } when ngspice shows no signal
function compareAc(lib, bench, name, nodes, pins, f1 = F1) {
  const a = oursAc(lib, bench, name, pins, f1), b = theirsAc(lib, bench, name, nodes, pins, f1);
  if (a.error || b.error) return { error: b.error ? "ngspice: " + b.error : a.error };
  const r = { lo: [0, 0], all: [0, 0], at: "" };
  for (let i = 0; i < pins.length; i++) for (let k = 0; k < b.f.length; k++) {
    if (!(b.db[i][k] > -100)) return { dead: true };
    const d = Math.abs(a.db[i][k] - b.db[i][k]); let p = Math.abs(a.ph[i][k] - b.ph[i][k]) % 360; if (p > 180) p = 360 - p;
    if (!(d <= r.all[0])) { r.all[0] = d; r.at = `${pins[i]} at ${b.f[k].toPrecision(3)} Hz ${a.db[i][k].toFixed(2)} dB / ngspice ${b.db[i][k].toFixed(2)} dB`; }
    if (!(p <= r.all[1])) r.all[1] = p;
    if (b.f[k] <= 20001) { if (!(d <= r.lo[0])) r.lo[0] = d; if (!(p <= r.lo[1])) r.lo[1] = p; }
  }
  return r;
}
const acGood = r => !r.error && !r.dead && r.lo[0] <= 0.1 && r.lo[1] <= 1 && r.all[0] <= 0.3 && r.all[1] <= 3;
const acLine = r => r.error || (r.dead ? "no signal at the output in ngspice" : `${r.lo[0].toFixed(2)} dB ${r.lo[1].toFixed(1)}° to 20 kHz, ${r.all[0].toFixed(2)} dB ${r.all[1].toFixed(1)}° to 1 MHz`);
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "latin1");
// an op-amp of five pins (+ − V+ V− out) as a ×11 amplifier: 0.1 V in, 10 kΩ and 1 kΩ, 10 kΩ load
const ampBench = (sub, vs) => `.subckt bench inp inn out\nVp vp 0 ${vs}\nVn vn 0 ${-vs}\nVin inp 0 DC 0.1 AC 1\nR1 out inn 10k\nR2 inn 0 1k\nRL out 0 10k\nX1 inp inn vp vn out ${sub}\n.ends`;

// --- 1: the fixtures ---
{
  const dev = fixture("devices.lib"), i = dev.search(/^\.subckt bench/m), lib = dev.slice(0, i), bench = dev.slice(i), nodes = /^\.subckt bench (.*)$/m.exec(dev)[1].trim().split(/\s+/);
  const r = compare(lib, bench, "bench", nodes);
  check(r.a.v && r.b.v && r.worst < 3e-3, `devices, sources, switch, table and polynomial: ${r.a.error || r.b.error || `${nodes.length} nodes within ${(r.worst * 100).toFixed(3)} % of ngspice (${r.at})`}`);
  const q = compare(fixture("testamp.lib"), ampBench("TESTAMP", 15), "bench", ["inp", "inn", "out"]);
  check(q.a.v && q.b.v && q.worst < 3e-3 && Math.abs(q.a.v.out - 1.1) < 0.001, `the test op-amp as a ×11 amplifier: ${q.a.error || q.b.error || `out ${q.a.v.out.toFixed(5)} V, within ${(q.worst * 100).toFixed(3)} % of ngspice`}`);
  const ac = fixture("acdev.lib"), j = ac.search(/^\.subckt bench/m), pins = /^\.subckt bench (.*)$/m.exec(ac)[1].trim().split(/\s+/);
  const w = compareAc(ac.slice(0, j), ac.slice(j), "bench", pins, pins.slice(1), 1e7);
  check(!w.error && w.all[0] <= 0.05 && w.all[1] <= 0.5, `junction capacitances, transit time and a JFET's gain, 10 Hz to 10 MHz: ${w.error || `within ${w.all[0].toFixed(3)} dB and ${w.all[1].toFixed(2)}° of ngspice (${w.at})`}`);
  const qa = compareAc(fixture("testamp.lib"), ampBench("TESTAMP", 15), "bench", ["inp", "inn", "out"], ["out"]);
  check(acGood(qa), `the test op-amp's gain and phase: ${acLine(qa)}`);
  // MOSFET levels 1 to 3: the bulk terminal, junctions, Meyer's gate capacitances
  const mo = fixture("mosdev.lib"), mj = mo.search(/^\.subckt bench/m), mpins = /^\.subckt bench (.*)$/m.exec(mo)[1].trim().split(/\s+/);
  const md = compare(mo.slice(0, mj), mo.slice(mj), "bench", mpins);
  check(md.a.v && md.b.v && md.worst < 1e-3, `MOSFET levels 1, 2 and 3 with the body effect, operating points: ${md.a.error || md.b.error || `${mpins.length} nodes within ${(md.worst * 100).toFixed(3)} % of ngspice (${md.at})`}`);
  const ma = compareAc(mo.slice(0, mj), mo.slice(mj), "bench", mpins, mpins.slice(1), 1e7);
  check(!ma.error && ma.all[0] <= 0.05 && ma.all[1] <= 0.5, `MOSFET levels 1, 2 and 3 with junction and Meyer gate capacitances, 10 Hz to 10 MHz: ${ma.error || `within ${ma.all[0].toFixed(3)} dB and ${ma.all[1].toFixed(2)}° of ngspice (${ma.at})`}`);
}

// --- 1a: temperature: makers' transistor models at −20, 75 and 125 °C (their XTI, EG, XTB from TNOM) ---
// the engine's 25 °C is SPICE's nominal 27 °C (the same kT/q), so ngspice runs at that scale's temperature
{
  const lib = `.model QN NPN(IS=6.734f XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734f IKF=66.78m XTB=1.5 BR=.7371 NC=2 ISC=0 RC=1 RB=10)
.model QP PNP(IS=1.41f XTI=3 EG=1.11 VAF=18.7 BF=180.7 NE=1.5 ISE=0 IKF=80m XTB=1.5 BR=4.977 NC=2 ISC=2f RC=2.5 RB=10 TNOM=25)
.model QG PNP(IS=2u XTI=3 EG=0.67 BF=90 VAF=30 XTB=1.2 RB=50)`;
  const bench = `.subckt bench c b e c2 b2 e2 c3 b3
V1 vcc 0 12
R1 vcc b 1Meg
Rc vcc c 2.2k
Re e 0 100
Q1 c b e QN
R2 b2 0 470k
Rc2 c2 0 3.3k
Re2 vcc e2 220
Q2 c2 b2 e2 QP
R3 b3 0 1.5Meg
Rc3 c3 0 4.7k
Q3 c3 b3 vcc QG
.ends`;
  const nodes = ["c", "b", "e", "c2", "b2", "e2", "c3", "b3"];
  for (const t of [-20, 75, 125]) {
    const text = lib + "\n" + bench, f = SN.flatten(text, "bench");
    let n = f.nNodes, a = null;
    try {
      const els = SN.build({ text, sub: "bench", temp: t }, f.pins.map((_, i) => i + 1), () => n++, "U");
      const res = E.simulate({ nodeCount: n, elements: els }, {});
      if (res.ok) { a = {}; f.pins.forEach((p, i) => { a[p] = res.dc.nodes[i + 1]; }); }
    } catch (e) { a = null; }
    const b = theirs(lib + `\n.temp ${((t + 273.15) * 300.15 / 298.15 - 273.15).toFixed(4)}`, bench, "bench", nodes).v;
    let worst = 0, at = "";
    if (a && b) nodes.forEach(k => { const err = Math.abs(a[k] - b[k]) / (Math.abs(b[k]) + 0.01); if (!(err <= worst)) { worst = err; at = `V(${k}) ${a[k].toPrecision(5)} / ngspice ${b[k].toPrecision(5)}`; } });
    check(a && b && worst < 1e-3, `transistor models at ${t} °C (XTI, EG, XTB, TNOM, ISE, ISC, germanium EG): ${a && b ? `within ${(worst * 100).toFixed(3)} % of ngspice (${at})` : "no result"}`);
  }
}

// --- 1b: waveforms (tests/fixtures/trandev.lib): each bench's "in" driven by a square or a sine, the
// simulator's settled period against ngspice's after it has run SETTLE periods, point by point ---
const SETTLE = 40;
// the drive as the engine's VSRC and as the same waveform in ngspice (the square: the CAD's export, a
// triangle clipped to 1 % edges)
const drive = d => ({ kind: "VSRC", wave: d.wave, freq: d.f, amp: d.amp, offset: d.off || 0 });
const driveSpice = d => d.wave === "square" ? `B0 in 0 V=${d.off || 0}+${d.amp}*max(-1,min(1,50*(2/pi)*asin(sin(2*pi*${d.f}*time))))` : `V0 in 0 DC ${d.off || 0} SIN(${d.off || 0} ${d.amp} ${d.f})`;
function oursTran(text, sub, d) {
  try {
    const f = SN.flatten(text, sub);
    let n = f.nNodes;
    const els = SN.build({ text, sub }, f.pins.map((_, i) => i + 1), () => n++, "U");
    els.push(Object.assign({ id: "vin", nodes: [f.pins.indexOf("in") + 1, 0] }, drive(d)));
    const r = E.simulate({ nodeCount: n, elements: els }, { budgetMs: 60000 });
    if (!r.ok) return { error: r.error };
    const T = r.tran, w = {};
    f.pins.forEach((p, i) => { w[p] = Array.from(T.nodes[i + 1]); });
    return { dt: T.dt, n: T.samples, w };
  } catch (e) { return { error: e.message || String(e) }; }
}
function theirsTran(text, sub, d, pins, dt, n) {
  // a step either side of the window, so each sample can be matched within a step
  const cir = join(work, "t.cir"), data = join(work, "t.txt"), t0 = SETTLE / d.f - dt, t1 = SETTLE / d.f + dt * n;
  writeFileSync(cir, `* bench\n${text}\n${driveSpice(d)}\nX0 ${pins.join(" ")} ${sub}\n.options method=gear\n.control\nset noaskquit\nset wr_singlescale\nset wr_vecnames\noption numdgt=9\ntran ${dt / 16} ${t1} ${t0} ${dt / 16}\nlinearize\nwrdata ${data} ${pins.map(p => `v(${p})`).join(" ")}\n.endc\n.end\n`, "latin1");
  let out = ""; try { out = execFileSync(NGSPICE, ["-b", cir], { encoding: "latin1", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  let txt = ""; try { txt = readFileSync(data, "utf8"); } catch { return { error: (out.match(/error[^\n]*/gi) || ["no result"]).slice(0, 2).join(" | ") }; }
  const lines = txt.trim().split("\n"), head = lines[0].trim().split(/\s+/), rows = lines.slice(1).map(l => l.trim().split(/\s+/).map(Number));
  const at = (p, t) => { const k = head.indexOf(`v(${p})`), x = Math.max(0, (t - t0) / (dt / 16)), i = Math.min(Math.floor(x), rows.length - 2), u = x - i; return rows[i][k] + (rows[i + 1][k] - rows[i][k]) * u; };
  return { at, t: j => SETTLE / d.f + j * dt };
}
// the largest difference at any sample, as a share of the waveform's swing in ngspice; a sample
// matches ngspice's waveform anywhere within one of the simulator's time steps of it (an edge
// a fraction of a step early or late is the time grid, not the model)
function compareTran(text, sub, d) {
  const pins = new RegExp(`^\\.subckt ${sub} (.*)$`, "mi").exec(text)[1].trim().split(/\s+/);
  const a = oursTran(text, sub, d);
  if (a.error) return { error: a.error };
  const b = theirsTran(text, sub, d, pins, a.dt, a.n);
  if (b.error) return { error: "ngspice: " + b.error };
  let worst = 0, at = "";
  pins.filter(p => p !== "in").forEach(p => {
    const A = a.w[p], B = A.map((_, j) => b.at(p, b.t(j))), sw = Math.max(...B) - Math.min(...B) || 1;
    A.forEach((v, j) => {
      let e = Infinity;
      for (let s = -16; s <= 16; s++) e = Math.min(e, Math.abs(v - b.at(p, b.t(j) + s * a.dt / 16)) / sw);
      if (!(e <= worst)) { worst = e; at = `${p} at ${(j * a.dt * d.f % 1 * 100).toFixed(0)} % of a period: ${v.toFixed(3)} V / ngspice ${B[j].toFixed(3)} V`; }
    });
  });
  return { worst, at };
}
{
  const text = fixture("trandev.lib");
  // Each within TRAN_TOL of its swing: the simulator runs a step that holds an edge again as finer
  // steps, so a diode's recovery or a switch's edge is resolved inside the time grid. tol: a looser
  // bound for a bench that cannot meet it yet; known: what the engine does not model in a waveform yet.
  const benches = [
    { sub: "recovery", d: { wave: "square", f: 1e4, amp: 5 }, what: "a diode's reverse recovery (TT)" },
    { sub: "switch", d: { wave: "square", f: 1e4, amp: 2.5, off: 2.5 }, what: "a saturating transistor switch" },
    { sub: "switchtf", d: { wave: "square", f: 1e4, amp: 2.5, off: 2.5 }, what: "the switch with transit times (TF, and TR's storage time)" },
    { sub: "cmos", d: { wave: "square", f: 1e4, amp: 5, off: 5 }, what: "a CMOS inverter into 1 nF" },
    { sub: "classb", d: { wave: "sine", f: 1e3, amp: 20 }, what: "a class-B follower clipping into 8 ohm" },
    { sub: "vdmos", d: { wave: "square", f: 1e4, amp: 5, off: 5 }, what: "a power MOSFET switch (Miller plateau, Cgd from CGDMIN to CGDMAX)" },
    { sub: "varactor", d: { wave: "sine", f: 1e4, amp: 10 }, what: "a varactor swung hard (junction charge)" },
    { sub: "mos3sw", d: { wave: "square", f: 1e4, amp: 5, off: 5 }, what: "a level 3 power MOSFET switch (Meyer gate charge, the drain junction)" },
    { sub: "cmos2", d: { wave: "square", f: 1e5, amp: 2.5, off: 2.5 }, what: "a level 2 CMOS inverter into 20 pF (Meyer gate charge)" }
  ];
  const TRAN_TOL = 0.02;
  for (const bn of benches.filter(x => !ONLY || x.sub.includes(ONLY))) {
    const tol = bn.tol || TRAN_TOL, r = compareTran(text, bn.sub, bn.d), good = !r.error && r.worst <= tol;
    const line = `waveform of ${bn.what}: ${r.error || `within ${(r.worst * 100).toFixed(2)} % of its swing${tol > TRAN_TOL ? ` (allowed ${Math.round(tol * 100)} %; aim ${Math.round(TRAN_TOL * 100)} %)` : ""} (worst ${r.at})`}`;
    if (bn.tol && good && r.worst <= TRAN_TOL) { check(false, `${line}: within ${TRAN_TOL * 100} % now, take its tol off`); continue; }
    if (bn.known) { if (good) check(false, `${line}: marked known (${bn.known}) but it agrees now, take the mark off`); else console.log(`KNOWN ${line} (${bn.known})`); continue; }
    check(good, line);
  }
}

// --- 2: makers' models ---
{
  const set = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8"));
  const dir = process.env.MODELS_DIR || join(tmpdir(), `tubecad-spice-library-${set.commit.slice(0, 12)}`);
  let have = existsSync(join(dir, "Models"));
  if (!have) {
    try {
      mkdirSync(dir, { recursive: true });
      const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "pipe"], timeout: 600000 });
      git("init", "-q"); git("fetch", "-q", "--depth", "1", set.repository, set.commit); git("checkout", "-q", "FETCH_HEAD");
      have = existsSync(join(dir, "Models"));
    } catch (e) { rmSync(dir, { recursive: true, force: true }); console.log(`SKIP makers' models: the library could not be fetched (${String(e.stderr || e.message).trim().split("\n").pop()})`); }
  }
  if (have) {
    let ok = 0, known = 0, acOk = 0, acAll = 0; const list = set.models.filter(m => !ONLY || m.sub.toLowerCase().includes(ONLY));
    for (const m of list) {
      let lib; try { lib = readFileSync(join(dir, m.file), "latin1"); } catch { check(false, `${m.sub}: ${m.file} is not in the library`); continue; }
      const r = compare(lib, ampBench(m.sub, m.supply || 15), "bench", ["inp", "inn", "out"]);
      const good = !!(r.a.v && r.b.v && r.worst < 0.02), line = `${m.sub} (${m.maker}): ${r.b.error ? "ngspice: " + r.b.error : r.a.error ? r.a.error : `out ${r.a.v.out.toFixed(4)} V, ${(r.worst * 100).toFixed(2)} % from ngspice`}`;
      if (m.known) { known++; if (good) check(false, `${line}: marked "known" (${m.known}) but it passes now, take the mark off`); else console.log(`KNOWN ${line}`); continue; }
      if (good) ok++;
      if (!good || process.env.SURVEY) check(good, line);
      if (!good) continue;
      // the same amplifier's gain and phase (a model whose pins are in another order gives no signal: not counted)
      const q = compareAc(lib, ampBench(m.sub, m.supply || 15), "bench", ["inp", "inn", "out"], ["out"]);
      if (q.dead) continue;
      acAll++; if (acGood(q)) acOk++;
      if (!acGood(q) || process.env.SURVEY) check(acGood(q), `${m.sub} (${m.maker}) gain and phase: ${acLine(q)}`);
    }
    check(acOk === acAll, `their gain and phase from 10 Hz to 1 MHz: ${acOk} of ${acAll} within 0.1 dB and 1° of ngspice up to 20 kHz, 0.3 dB and 3° up to 1 MHz`);
    check(ok === list.length - known, `makers' op-amp models as ×11 amplifiers: ${ok} of ${list.length - known} within 2 % of ngspice${known ? ` (${known} more known not to solve yet)` : ""}`);
  }
}
rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
