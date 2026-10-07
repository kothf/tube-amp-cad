#!/usr/bin/env node
/**
 * Reference circuits: classic circuits with published or textbook results,
 * built in the CAD and measured through the oscilloscope and spectrum
 * analyzer windows (the same readouts a user sees), then compared.
 *
 *   node tests/reference.mjs [root]      # prints a comparison table
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.argv[2] || ".");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  // the browser asks for /favicon.ico by itself (full Chrome does; the pages declare no icon): nothing to send
  if (/\/favicon\.ico$/.test(path)) { res.writeHead(204); return res.end(); }
  // read first, then answer: a missing file gets one 404, not a 200 header followed by a crash
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);
const U = p => `http://localhost:${server.address().port}/${p}`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const errors = [];
const cad = await ctx.newPage();
cad.on("pageerror", e => errors.push(`cad: ${e.message}`));
await cad.goto(U("circuit_sandbox.html"));
await cad.waitForFunction(() => window.TubeCAD);

/**
 * Build a circuit on an empty sheet. parts: { name: [type, params] };
 * nets: [[ "R1.1", "V1.A", ... ], ...]; the net containing "GND" gets a ground symbol.
 * Wiring: every pin gets a short horizontal stub to a unique x on the half grid
 * (x = 5 mod 10, where no pin can be) and drops vertically to its net's own
 * track (y = 5 mod 10), so wires can never touch a pin of another net.
 * Every net is then verified against the CAD's own connectivity.
 */
async function build(parts, nets) {
  return cad.evaluate(async ({ parts, nets }) => {
    const C = TubeCAD, S = C.state;
    S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const comp = {};
    Object.entries(parts).forEach(([name, [type, params]], i) => {
      const c = C.makeComp(type, params || {}, 100 + i * 150, 200, 0); S.comps.push(c); comp[name] = c;
    });
    if (nets.some(n => n.includes("GND"))) { const g = C.makeComp("ground", {}, 100 + Object.keys(parts).length * 150, 200, 0); S.comps.push(g); comp.GND = g; }
    const pinOf = ref => { if (ref === "GND") return [comp.GND, "G"]; const [n, id] = ref.split("."); return [comp[n], id]; };
    const used = new Set();
    nets.forEach((net, ni) => {
      const y = 405 + ni * 20, xs = [];
      for (const ref of net) {
        const [c, id] = pinOf(ref);
        const p = C.compPins(c).find(q => q.id === id);
        if (!p) throw new Error(`no pin ${ref}`);
        const dir = p.x < c.x ? -1 : p.x > c.x ? 1 : (p.y > c.y ? 1 : -1);
        let ex = p.x + dir * 5;
        while (used.has(ex)) ex += dir * 10;
        used.add(ex); xs.push(ex);
        C.addSegment(p.x, p.y, ex, p.y); C.addSegment(ex, p.y, ex, y);
      }
      C.addSegment(Math.min(...xs), y, Math.max(...xs), y);
    });
    const seq0 = S.sim.seq;
    C.commit(); C.fitView();
    const t0 = performance.now();
    while ((S.sim.seq === seq0 || S.sim.busy) && performance.now() - t0 < 30000) await new Promise(r => setTimeout(r, 50));
    // verify the wiring: each net is one node, different nets are different nodes, nothing left open
    const T = C.topo(), id = ref => { const [c, pid] = pinOf(ref); return T.pinNet.get(`${c.id}:${pid}`); };
    const netIds = nets.map(n => n.map(id));
    const wiringOk = netIds.every(ids => ids.every(v => v !== undefined && v === ids[0])) && new Set(netIds.map(ids => ids[0])).size === nets.length;
    // anything left unconnected except a deliberately unused scope input
    const open = []; S.comps.forEach(c => C.compPins(c).forEach(p => { if (!T.pinConnected.get(`${c.id}:${p.id}`) && !(c.type === "scope" && /^CH/.test(p.id))) open.push(`${c.label}.${p.id}`); }));
    const scopes = Object.fromEntries(Object.entries(comp).filter(([, c]) => c.type === "scope").map(([n, c]) => [n, c.id]));
    return { wiringOk, open, error: S.sim.error, scopes };
  }, { parts, nets });
}

// ---- reading the instruments ---------------------------------------------------
const PREFIX = { "": 1, k: 1e3, M: 1e6, m: 1e-3, "µ": 1e-6, n: 1e-9 };
const eng = (s, unit) => { const m = s.match(new RegExp(`(-?[\\d.]+)\\s*([kMmµn]?)${unit}`)); return m ? parseFloat(m[1]) * PREFIX[m[2]] : NaN; };

async function scopeReading(scopeId) {
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`scope: ${e.message}`));
  await p.goto(U(`oscilloscope.html?scope=${scopeId}`));
  await p.waitForFunction(() => /Live from CAD/.test(document.getElementById("status").textContent), null, { timeout: 8000 });
  const text = await p.locator("#meas").innerText();
  await p.close();
  const ch = n => {
    const line = (text.match(new RegExp(`^CH${n}: (.*)$`, "m")) || [])[1] || "";
    return { vpp: eng(line, "Vpp"), vrms: eng(line, "Vrms"), dc: eng(line.replace(/Vpp|Vrms/g, ""), "V DC"), f: eng(line, "Hz") };
  };
  const r = text.match(/CH1\/CH2 at [^:]+: ([\d.]+)×.*?phase (-?\d+)°/s);
  return { ch1: ch(1), ch2: ch(2), ratio: r ? parseFloat(r[1]) : NaN, phase: r ? parseFloat(r[2]) : NaN, text };
}

async function spectrumReading(scopeId, channel = "ch1") {
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`spectrum: ${e.message}`));
  await p.goto(U(`spectrum_analyzer.html?scope=${scopeId}&ch=${channel}`));
  await p.waitForFunction(() => /\d/.test(document.getElementById("thd").textContent), null, { timeout: 8000 });
  const out = await p.evaluate(() => ({
    rows: [...document.querySelectorAll("#harm tr")].map(tr => [...tr.cells].map(td => td.textContent)),
    thd: document.getElementById("thd").textContent,
    foot: document.getElementById("foot").textContent
  }));
  await p.close();
  const h = {};
  for (const [name, f, val] of out.rows) {
    const k = name === "Fundamental" ? 1 : parseInt(name.slice(1));
    h[k] = { f: eng(f, "Hz"), dbc: k === 1 ? 0 : parseFloat(val), vrms: k === 1 ? eng(val, "Vrms") : NaN };
  }
  return { h, thd: parseFloat(out.thd.replace(/[^\d.]/g, "")), f0: h[1] && h[1].f, foot: out.foot };
}

/** Strongest non-harmonic line listed by the analyzer, dBc (−200 if none above −80 dBc). */
async function spurLevel(scopeId) {
  const p = await ctx.newPage();
  await p.goto(U(`spectrum_analyzer.html?scope=${scopeId}`));
  await p.waitForFunction(() => /\d/.test(document.getElementById("thd").textContent), null, { timeout: 8000 });
  const cells = await p.evaluate(() => [...document.querySelectorAll("#spurs tr td:last-child")].map(td => parseFloat(td.textContent)).filter(Number.isFinite));
  await p.close();
  return cells.length ? Math.max(...cells) : -200;
}

// ---- comparison table ------------------------------------------------------------
const results = [];
function compare(circuit, quantity, measured, expected, tol, source, unit = "") {
  const pass = Number.isFinite(measured) && (tol.max ? measured <= expected : tol.abs !== undefined ? Math.abs(measured - expected) <= tol.abs : Math.abs(measured / expected - 1) <= tol.rel);
  // a documented model limitation is reported as KNOWN instead of failing the run
  const ok = pass || !!tol.known, known = !pass && tol.known ? tol.known : null;
  if (tol.max) { results.push({ circuit, quantity, expected, measured, unit, dev: "", ok, known, source, tol: "limit", limit: true }); return; }
  const dev = Number.isFinite(measured) ? (tol.abs !== undefined ? `${measured - expected >= 0 ? "+" : ""}${(measured - expected).toFixed(2)}${unit}` : `${measured >= expected ? "+" : ""}${((measured / expected - 1) * 100).toFixed(1)}%`) : "n/a";
  results.push({ circuit, quantity, expected, measured, unit, dev, ok, known, source, tol: tol.abs !== undefined ? `±${tol.abs}${unit}` : `±${tol.rel * 100}%` });
}
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(3));

// =================================================================================
// 1. Signal generator straight into the instruments (exact Fourier references)
// =================================================================================
// the generator's square wave has 1 % edges (a trapezoid): harmonic n = 4A/(nπ)·sinc(nπ·0.01)
const sinc = x => Math.sin(x) / x, trap = n => sinc(n * Math.PI * 0.01) / n;
const trapDb = n => 20 * Math.log10(trap(n) / trap(1));
const trapThd = 100 * Math.sqrt([3, 5, 7, 9].reduce((s, n) => s + (trap(n) / trap(1)) ** 2, 0));
for (const [wave, rms, harm, thd] of [
  ["sine", 1 / Math.SQRT2, {}, 0],
  ["square", Math.sqrt(1 - 4 * 0.01 / 3), { 3: trapDb(3), 5: trapDb(5), 7: trapDb(7), 9: trapDb(9) }, trapThd],   // odd harmonics ≈ 1/n
  ["triangle", 1 / Math.sqrt(3), { 3: -19.08, 5: -27.96, 7: -33.80, 9: -38.17 }, 12.05]  // odd harmonics 1/n²
]) {
  const c = await build({ G: ["siggen", { wave, freq: 1000, amp: 1 }], SC: ["scope", {}] }, [["G.+", "SC.CH1"], ["GND", "G.-", "SC.COM"]]);
  const name = `Generator, 1 kHz ${wave}, 1 Vpk`;
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC), sp = await spectrumReading(c.scopes.SC);
  compare(name, "scope Vpp", sc.ch1.vpp, 2, { rel: 0.01 }, "2 × amplitude", " V");
  compare(name, "scope Vrms", sc.ch1.vrms, rms, { rel: 0.01 }, wave === "sine" ? "A/√2" : wave === "square" ? "A·√(1−4r/3), r = 1 % edges" : "A/√3", " V");
  compare(name, "scope frequency", sc.ch1.f, 1000, { rel: 0.005 }, "generator", " Hz");
  const fundRms = wave === "sine" ? 1 / Math.SQRT2 : wave === "square" ? 4 / Math.PI * sinc(Math.PI * 0.01) / Math.SQRT2 : 8 / Math.PI ** 2 / Math.SQRT2;
  compare(name, "analyzer fundamental", sp.h[1].vrms, fundRms, { rel: 0.01 }, wave === "sine" ? "A/√2" : wave === "square" ? "4A/π·sinc(π·0.01) /√2" : "8A/π² /√2", " Vrms");
  for (const [k, d] of Object.entries(harm)) compare(name, `analyzer H${k}`, sp.h[k].dbc, d, { abs: 0.3 }, wave === "triangle" ? "Fourier series 1/n²" : "Fourier series of a 1 %-edge trapezoid", " dBc");
  if (wave !== "sine") compare(name, "analyzer H2 (even harmonics)", sp.h[2] && Number.isFinite(sp.h[2].dbc) ? sp.h[2].dbc : -120, -100, { max: true }, "none: half-wave symmetry", " dBc");
  if (wave !== "sine") compare(name, "analyzer spurious lines (half-harmonics)", await spurLevel(c.scopes.SC), -100, { max: true }, "none: the two captured periods are identical", " dBc");
  if (wave === "sine") compare(name, "analyzer THD", sp.thd, 0, { abs: 0.01 }, "pure sine", " %");
  else compare(name, "analyzer THD (H2-H10)", sp.thd, thd, { rel: 0.02 }, "Fourier series, H3-H9", " %");
}

// =================================================================================
// 2. RC low-pass at its corner frequency: -3.01 dB, -45°
// =================================================================================
{
  const c = await build({ G: ["siggen", { freq: 1000, amp: 1 }], R: ["resistor", { r: 1592 }], C: ["capacitor", { c: 100e-9 }], SC: ["scope", {}] },
    [["G.+", "R.1", "SC.CH2"], ["R.2", "C.1", "SC.CH1"], ["GND", "G.-", "C.2", "SC.COM"]]);
  const name = "RC low-pass, 1.592 kΩ + 100 nF (fc = 999.7 Hz)";
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC);
  const fc = 1 / (2 * Math.PI * 1592 * 100e-9), g = 1 / Math.sqrt(1 + (1000 / fc) ** 2);
  compare(name, "scope gain CH1/CH2", sc.ratio, g, { rel: 0.01 }, "1/√(1+(f/fc)²)", "×");
  compare(name, "scope phase", sc.phase, -Math.atan(1000 / fc) * 180 / Math.PI, { abs: 2 }, "−atan(f/fc)", "°");
}

// =================================================================================
// 3. 12AX7 common-cathode stage at the RCA characteristic point (250 V, −2 V, 1.2 mA)
//    gain from textbook formulas with RCA's µ = 100, rp = 62.5 kΩ
// =================================================================================
for (const bypass of [true, false]) {
  const parts = {
    B: ["vdc", { v: 370 }], Ra: ["resistor", { r: 100e3 }], V1: ["tube", { tube: "12AX7" }], Rk: ["resistor", { r: 1600 }],
    Rg: ["resistor", { r: 1e6 }], Cin: ["capacitor", { c: 1e-6 }], G: ["siggen", { freq: 1000, amp: 0.05 }],
    SC: ["scope", {}], SK: ["scope", {}]
  };
  const nets = [["B.+", "Ra.1"], ["Ra.2", "V1.A", "SC.CH1"], ["V1.K", "Rk.1", "SK.CH1"], ["V1.G", "Rg.1", "Cin.2"],
    ["G.+", "Cin.1", "SC.CH2"], ["GND", "B.-", "Rk.2", "Rg.2", "G.-", "SC.COM", "SK.COM"]];
  if (bypass) { parts.Ck = ["electrolytic", { c: 470e-6 }]; nets[2].push("Ck.+"); nets[5].push("Ck.-"); }
  const c = await build(parts, nets);
  const name = `12AX7 common cathode, 370 V / 100 kΩ / 1.6 kΩ ${bypass ? "bypassed" : "unbypassed"}`;
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC), sk = await scopeReading(c.scopes.SK), sp = await spectrumReading(c.scopes.SC);
  if (bypass) {
    compare(name, "plate DC (scope)", sc.ch1.dc, 250, { rel: 0.03 }, "RCA 12AX7A: Va 250 V at Ia 1.2 mA", " V");
    compare(name, "cathode DC (scope)", sk.ch1.dc, 1.92, { rel: 0.08 }, "Ia·Rk = 1.2 mA × 1.6 kΩ (bias −2 V)", " V");
  }
  const gain = bypass ? 100 * 100e3 / (100e3 + 62.5e3) : 100 * 100e3 / (100e3 + 62.5e3 + 101 * 1600);
  compare(name, "gain CH1/CH2 (scope)", sc.ratio, gain, { rel: 0.08 }, bypass ? "µ·Ra/(Ra+rp)" : "µ·Ra/(Ra+rp+(µ+1)Rk)", "×");
  compare(name, "phase (scope)", Math.abs(sc.phase), 180, { abs: 3 }, "inverting stage", "°");
  compare(name, "THD at 50 mVpk in (analyzer)", sp.thd, 1, { max: true }, "small-signal stage: under 1 %", " %");
}

// =================================================================================
// 4. 12AU7 cathode follower at the RCA point (250 V, −8.5 V, 10.5 mA): µ 17, rp 7.7 kΩ
// =================================================================================
{
  const c = await build({
    B: ["vdc", { v: 258.5 }], V1: ["tube", { tube: "12AU7" }], Rk: ["resistor", { r: 810 }], Rg: ["resistor", { r: 1e6 }],
    Cin: ["capacitor", { c: 1e-6 }], G: ["siggen", { freq: 1000, amp: 1 }], SC: ["scope", {}]
  }, [["B.+", "V1.A"], ["V1.K", "Rk.1", "SC.CH1"], ["V1.G", "Rg.1", "Cin.2"], ["G.+", "Cin.1", "SC.CH2"], ["GND", "B.-", "Rk.2", "Rg.2", "G.-", "SC.COM"]]);
  const name = "12AU7 cathode follower, 258.5 V, Rk 810 Ω";
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC);
  compare(name, "cathode DC (scope)", sc.ch1.dc, 8.5, { rel: 0.08 }, "RCA 12AU7A: 10.5 mA × 810 Ω", " V");
  compare(name, "gain (scope)", sc.ratio, 17 * 810 / (7700 + 18 * 810), { rel: 0.05 }, "µRk/(rp+(µ+1)Rk)", "×");
  compare(name, "phase (scope)", sc.phase, 0, { abs: 3 }, "non-inverting", "°");
}

// =================================================================================
// 5. Single-ended output stages at published class-A operating conditions
// =================================================================================
async function powerStage({ name, tube, pentode, zp, bias, rk, drive, quiet, full, published, source, b = 250, vg2 }) {
  const parts = {
    B: ["vdc", { v: b }], T: ["opt_se", { zp, zs: 8, lp: 30, dcrp: 0.001, dcrs: 0.001 }], V1: ["tube", { tube }],
    SPK: ["speaker", { r: 8 }], G: ["siggen", { freq: 1000, amp: drive, offset: bias || 0 }],
    Rs: ["resistor", { r: rk || 1 }], SC: ["scope", {}], SI: ["scope", {}]
  };
  const grid = pentode ? "V1.G1" : "V1.G";
  const nets = [["B.+", "T.P1"], ["T.P2", "V1.A"], ["T.S1", "SPK.+", "SC.CH1"], ["V1.K", "Rs.1", "SI.CH1"],
    ["GND", "B.-", "T.S2", "SPK.-", "Rs.2", "G.-", "SC.COM", "SI.COM"]];
  if (pentode && vg2) { parts.B2 = ["vdc", { v: vg2 }]; nets.push(["B2.+", "V1.G2"]); nets[4].push("B2.-"); }
  else if (pentode) nets[0].push("V1.G2");
  if (rk) {   // cathode bias: bypassed cathode resistor, grid leak and coupling cap
    Object.assign(parts, { Ck: ["electrolytic", { c: 1000e-6 }], Rg: ["resistor", { r: 470e3 }], Cin: ["capacitor", { c: 1e-6 }] });
    nets[3].push("Ck.+"); nets[4].push("Ck.-", "Rg.2"); nets.push([grid, "Rg.1", "Cin.2"], ["G.+", "Cin.1", "SC.CH2"]);
  } else nets.push([grid, "G.+", "SC.CH2"]);   // fixed bias straight from the generator's DC offset
  const c = await build(parts, nets);
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC), si = await scopeReading(c.scopes.SI), sp = await spectrumReading(c.scopes.SC);
  const pout = sc.ch1.vrms ** 2 / 8;
  compare(name, `output power at ${(drive / Math.SQRT2).toFixed(1)} Vrms drive (scope, 8 Ω)`, pout, published.pout, { rel: 0.1 }, source, " W");
  compare(name, "THD at that power (analyzer)", sp.thd, published.thd, { rel: 0.4 }, source, " %");
  if (full) compare(name, "cathode current at full drive (scope on Rk)", si.ch1.dc / (rk || 1) * 1000, full, { rel: 0.1 }, source, " mA");
  // quiescent current: from the cathode resistor's DC voltage with no signal
  const q = await build({ ...parts, G: ["siggen", { freq: 1000, amp: 1e-3, offset: bias || 0 }] }, nets);
  const sq = await scopeReading(q.scopes.SI);
  compare(name, "quiescent cathode current (scope on Rk)", sq.ch1.dc / (rk || 1) * 1000, quiet, { rel: 0.1 }, source, " mA");
}

await powerStage({ name: "EL84 single-ended, 250 V (+7 V cathode), Rk 135 Ω, 5.2 kΩ", tube: "EL84", pentode: true, b: 257, zp: 5200, rk: 135, drive: 4.3 * Math.SQRT2,
  quiet: 48 + 5.5, full: 49.5 + 10.8, published: { pout: 5.7, thd: 10 },
  source: "Philips EL84: 5.7 W at 10 % with Vi 4.3 Vrms; Ia + Ig2 = 48 + 5.5 mA at rest, 49.5 + 10.8 mA at full drive" });
await powerStage({ name: "6V6GT single-ended, 250 V, −12.5 V, 5 kΩ", tube: "6V6GT", pentode: true, zp: 5000, bias: -12.5, drive: 12.5,
  quiet: 45 + 4.5, full: 47 + 7.0, published: { pout: 4.5, thd: 8 }, source: "RCA 6V6GT: 4.5 W at 8 % THD, 12.5 V peak drive; Ia + Ig2 = 45 + 4.5 mA at rest, 47 + 7.0 mA at full drive" });
await powerStage({ name: "6V6GT single-ended, 315 V, screen 225 V, −13 V, 8.5 kΩ", tube: "6V6GT", pentode: true, b: 315, vg2: 225, zp: 8500, bias: -13, drive: 13,
  quiet: 34 + 2.2, full: 35 + 6.0, published: { pout: 5.5, thd: 12 }, source: "RCA 6V6GT: 5.5 W at 12 % THD, 13 V peak drive; Ia + Ig2 = 34 + 2.2 mA at rest, 35 + 6.0 mA at full drive" });
await powerStage({ name: "6L6GC single-ended, 250 V, −14 V, 2.5 kΩ", tube: "6L6GC", pentode: true, zp: 2500, bias: -14, drive: 14,
  quiet: 72 + 5, published: { pout: 6.5, thd: 10 }, source: "RCA 6L6GC: 6.5 W at 10 % THD, 14 V peak drive; Ia + Ig2 = 72 + 5 mA at rest" });
await powerStage({ name: "2A3 single-ended, 250 V, −45 V, 2.5 kΩ", tube: "2A3", zp: 2500, bias: -45, drive: 45,
  quiet: 60, published: { pout: 3.5, thd: 5 }, source: "RCA 2A3: 3.5 W at 5 % THD, 45 V peak drive; Ia 60 mA" });

// =================================================================================
// 6. Full-wave capacitor-input power supply: ripple and DC from textbook formulas
// =================================================================================
{
  const c = await build({
    TX: ["ptx", { vrms: 300, freq: "50", rw: 1 }], D1: ["diode", { model: "1N4007" }], D2: ["diode", { model: "1N4007" }],
    C1: ["electrolytic", { c: 100e-6 }], RL: ["resistor", { r: 3000 }], SC: ["scope", {}]
  }, [["TX.HT1", "D1.A"], ["TX.HT2", "D2.A"], ["D1.K", "D2.K", "C1.+", "RL.1", "SC.CH1"], ["GND", "TX.CT", "C1.-", "RL.2", "SC.COM"]]);
  const name = "Full-wave rectifier, 300-0-300 Vrms, 1N4007, 100 µF, 3 kΩ";
  compare(name, "wiring", c.wiringOk && !c.open.length && !c.error ? 1 : 0, 1, { abs: 0 }, "netlist check");
  const sc = await scopeReading(c.scopes.SC), sp = await spectrumReading(c.scopes.SC);
  const vpk = 300 * Math.SQRT2 - 0.9, idc = sc.ch1.dc / 3000, ripple = idc / (2 * 50 * 100e-6);
  compare(name, "ripple frequency (scope)", sc.ch1.f, 100, { rel: 0.01 }, "full-wave: 2 × 50 Hz", " Hz");
  compare(name, "ripple Vpp (scope)", sc.ch1.vpp, ripple, { rel: 0.15 }, "Idc / (2·f·C), sawtooth approximation", " V");
  compare(name, "DC output (scope)", sc.ch1.dc, vpk - ripple / 2, { rel: 0.015 }, "Vpk − Vdiode − ripple/2", " V");
  const tag = await cad.evaluate(() => { const S = TubeCAD.state, T = TubeCAD.topo(), R = S.comps.find(c => c.type === "resistor" && c.params.r === 3000); return S.sim.result.dc.nodes[T.pinNet.get(`${R.id}:1`)]; });
  compare(name, "DC readout on the schematic", tag, sc.ch1.dc, { rel: 0.003 }, "scope DC average (a meter)", " V");
  compare(name, "analyzer fundamental", sp.f0, 100, { rel: 0.01 }, "ripple at 100 Hz", " Hz");
}

// ---- report ------------------------------------------------------------------------
let last = "";
for (const r of results) {
  if (r.circuit !== last) { console.log(`\n${r.circuit}`); last = r.circuit; }
  if (r.quantity === "wiring") { console.log(`  ${r.ok ? "PASS" : "FAIL"} circuit wired and simulated`); continue; }
  const status = r.known ? "KNOWN" : r.ok ? "PASS" : "FAIL";
  if (r.limit) { console.log(`  ${status} ${r.quantity}: measured ${fmt(r.measured)}${r.unit}, limit ≤ ${fmt(r.expected)}${r.unit} — ${r.source}`); continue; }
  console.log(`  ${status} ${r.quantity}: measured ${fmt(r.measured)}${r.unit}, expected ${fmt(r.expected)}${r.unit} (${r.dev}, tolerance ${r.tol}) — ${r.source}`);
  if (r.known) console.log(`        known limitation: ${r.known}`);
}
const failed = results.filter(r => !r.ok).length, knownN = results.filter(r => r.known).length;
if (errors.length) console.log(`\npage errors: ${errors.slice(0, 3).join(" | ")}`);
console.log(failed || errors.length ? `\n${failed} of ${results.length} comparisons failed` : `\nAll ${results.length - knownN} comparisons passed${knownN ? `; ${knownN} known model limitation(s) reported` : ""}`);
if (process.env.REPORT_JSON) (await import("node:fs")).writeFileSync(process.env.REPORT_JSON, JSON.stringify(results, null, 1));
await browser.close();
server.close();
process.exit(failed || errors.length ? 1 : 0);
