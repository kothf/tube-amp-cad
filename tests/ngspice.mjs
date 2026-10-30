#!/usr/bin/env node
/**
 * Every example against ngspice: each example is opened in the CAD and simulated
 * ("Simulate until settled"), its SPICE export is run through ngspice, and the
 * node voltages are compared, so a change to a model, to the engine or to the
 * export that moves a result shows up here.
 *
 *   DC    the operating point (ngspice .op) against the CAD's DC readout; a
 *         circuit fed from the mains or an oscillator has no operating point,
 *         and then both sides are averaged over the CAD's capture window
 *   AC    the signal (rms about the mean) at every node over that same window,
 *         ngspice's taken once its transient has settled
 *
 *   node tests/ngspice.mjs [root]        # needs ngspice on the PATH (apt install ngspice)
 *
 * Set CHROMIUM_PATH to use a specific browser binary, NGSPICE to the ngspice
 * binary, KEEP=dir to keep the netlists and ngspice's output, ONLY=07 to run the examples
 * whose file name has that in it.
 */
import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.argv[2] || ".");
const NGSPICE = process.env.NGSPICE || "ngspice";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);

// ngspice in batch mode; its output as text (it exits non-zero on a netlist it cannot run)
const ngspice = file => new Promise(done => execFile(NGSPICE, ["-b", file], { maxBuffer: 1 << 28, timeout: 600000 },
  (err, stdout, stderr) => done({ err, out: stdout + stderr })));
{
  const v = await ngspice("-v");
  if (v.err && !/ngspice/i.test(v.out)) { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("dialog", d => d.accept());          // "Open the example? It replaces the circuit"
await page.goto(`http://localhost:${server.address().port}/circuit_sandbox.html`);
await page.waitForFunction(() => window.TubeCAD);

const work = process.env.KEEP ? resolve(process.env.KEEP) : await mkdtemp(join(tmpdir(), "ngspice-"));
await mkdir(work, { recursive: true });

// Tolerances. The export carries the CAD's own models (Koren tubes as B sources,
// Gummel-Poon, level-1 MOSFETs), so the two should agree closely; what remains is
// integration error and the ways the two step through a transient.
const TOL = {
  dc: { rel: 0.003, abs: 0.002 },            // 0.3 % + 2 mV
  avg: { rel: 0.01, swing: 0.001, abs: 0.01 }, // averaged over a window: 1 % + 0.1 % of the node's rms swing + 10 mV
  ac: { rel: 0.03, abs: 0.002 }              // signal rms: 3 % + 2 mV
};
const limit = x => x.tol.rel * Math.abs(x.ng) + (x.tol.swing || 0) * (x.swing || 0) + x.tol.abs;
const within = x => Math.abs(x.app - x.ng) <= limit(x);
// a window's mean and its rms about the straight line through it: a supply still creeping up
// by a few millivolts (the CAD's averaged runs stop once the mean holds) is not signal. The
// first sample is the last one's period earlier, so it is left out.
function stats(w) {
  const n = w.length - 1, c = (n - 1) / 2;
  let m = 0, sxy = 0, sxx = 0;
  for (let i = 1; i <= n; i++) m += w[i];
  m /= n;
  for (let i = 1; i <= n; i++) { sxy += (i - 1 - c) * (w[i] - m); sxx += (i - 1 - c) ** 2; }
  const k = sxx ? sxy / sxx : 0;
  let s = 0; for (let i = 1; i <= n; i++) s += (w[i] - m - k * (i - 1 - c)) ** 2;
  return { mean: m, rms: Math.sqrt(s / n) };
}

const results = [];
const examples = await page.evaluate(() => TubeCAD.EXAMPLES.map(e => ({ file: e.file, title: e.title })));
for (const ex of examples.filter(e => !process.env.ONLY || e.file.includes(process.env.ONLY))) {
  const app = await page.evaluate(async file => {
    const C = TubeCAD, S = C.state;
    await C.openExample(C.EXAMPLES.find(e => e.file === file));
    const t0 = performance.now();
    while (S.sim.busy && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 50));
    C.runSim("full");
    while (S.sim.busy && performance.now() - t0 < 300000) await new Promise(r => setTimeout(r, 50));
    const r = S.sim.result;
    if (!r || !r.tran) return { error: S.sim.error || "no result" };
    // the capture window: a whole number of periods at every node
    const tr = r.tran, waves = {};
    tr.nodes.forEach((w, n) => { if (w && w.length && n) waves[n] = Array.from(w); });
    return { spice: C.spiceNetlist(), dc: r.dc.nodes, averaged: !!r.dcAveraged, waves, window: tr.dt * (tr.samples - 1), dt: tr.dt };
  }, ex.file);
  const name = ex.file.replace(/\.json$/, "");
  if (app.error) { results.push({ ex, error: `CAD: ${app.error}` }); continue; }
  if (/^X\S+ .* NE555$/m.test(app.spice)) { results.push({ ex, skipped: "the export has no NE555 model (it asks for the maker's macro model)" }); continue; }

  // the operating point
  const body = app.spice.replace(/^\.tran .*$/m, "").replace(/^\.end\s*$/m, "");
  const nodes = [...new Set([...app.spice.matchAll(/\bN(\d+)\b/g)].map(m => +m[1]))].sort((a, b) => a - b);
  const rows = [];
  if (!app.averaged) {
    const op = join(work, `${name}.op.cir`);
    await writeFile(op, `${body}\n.control\nop\nprint ${nodes.map(n => `v(n${n})`).join(" ")}\n.endc\n.end\n`);
    const r = await ngspice(op);
    const v = {}; for (const m of r.out.matchAll(/^\s*v\(n(\d+)\)\s*=\s*([-+0-9.eE]+)/gm)) v[m[1]] = +m[2];
    if (!Object.keys(v).length) { results.push({ ex, error: `ngspice .op: ${(r.out.match(/^.*error.*$/im) || [r.out.slice(0, 300)])[0]}` }); continue; }
    for (const n of nodes) if (v[n] !== undefined) rows.push({ what: "DC", node: n, app: app.dc[n], ng: v[n], tol: TOL.dc });
  }

  // the transient: long enough to settle (the CAD's own run settles by shooting), then the
  // CAD's window. ngspice starts from its operating point; on a mains supply from nothing (uic):
  // its operating point would take the mains at t = 0, its peak, as DC through the primary
  const settle = app.averaged ? 8 : 1, step = app.dt, stop = settle + app.window;
  const tran = join(work, `${name}.tran.cir`), data = join(work, `${name}.tran.txt`);
  await writeFile(tran, `${body}\n.options interp\n.control\nset wr_singlescale\nset wr_vecnames\noption numdgt=9\ntran ${step} ${stop} ${settle} ${step}${app.averaged ? " uic" : ""}\nlinearize\nwrdata ${data} ${nodes.map(n => `v(n${n})`).join(" ")}\n.endc\n.end\n`);
  const r = await ngspice(tran);
  let txt = "";
  try { txt = await readFile(data, "utf8"); } catch { /* reported below */ }
  const lines = txt.trim().split("\n");
  if (lines.length < 3) { results.push({ ex, error: `ngspice tran: ${(r.out.match(/^.*error.*$/im) || [r.out.slice(-300)])[0]}` }); continue; }
  const head = lines[0].trim().split(/\s+/).slice(1).map(h => +h.match(/n(\d+)/)[1]);
  const cols = head.map(() => []);
  for (const l of lines.slice(1)) { const f = l.trim().split(/\s+/); head.forEach((_, k) => cols[k].push(+f[k + 1])); }
  head.forEach((n, k) => {
    if (!app.waves[n]) return;
    const a = stats(app.waves[n]), g = stats(cols[k]);
    if (app.averaged) rows.push({ what: "DC avg", node: n, app: a.mean, ng: g.mean, swing: g.rms, tol: TOL.avg });
    rows.push({ what: "AC rms", node: n, app: a.rms, ng: g.rms, tol: TOL.ac });
  });
  results.push({ ex, rows });
}

// ---- report ------------------------------------------------------------------------
const fmt = v => (Math.abs(v) >= 100 ? v.toFixed(2) : Math.abs(v) >= 1 ? v.toFixed(4) : v.toPrecision(4));
let failed = 0, compared = 0;
for (const r of results) {
  console.log(`\n${r.ex.title} (${r.ex.file})`);
  if (r.skipped) { console.log(`  SKIP ${r.skipped}`); continue; }
  if (r.error) { console.log(`  FAIL ${r.error}`); failed++; continue; }
  const bad = r.rows.filter(x => !within(x));
  compared += r.rows.length; failed += bad.length;
  const worst = kind => {
    const rs = r.rows.filter(x => x.what === kind); if (!rs.length) return;
    const w = rs.reduce((a, x) => (Math.abs(x.app - x.ng) / limit(x) > Math.abs(a.app - a.ng) / limit(a) ? x : a));
    console.log(`  ${rs.every(within) ? "PASS" : "FAIL"} ${kind}: ${rs.length} nodes, closest to its limit N${w.node}: CAD ${fmt(w.app)} V, ngspice ${fmt(w.ng)} V`);
  };
  ["DC", "DC avg", "AC rms"].forEach(worst);
  (process.env.VERBOSE ? r.rows : bad).forEach(x => console.log(`    ${x.what} N${x.node}: CAD ${fmt(x.app)} V, ngspice ${fmt(x.ng)} V (limit ±${fmt(limit(x))} V)`));
}
if (errors.length) console.log(`\npage errors: ${errors.slice(0, 3).join(" | ")}`);
const skipped = results.filter(r => r.skipped).length;
console.log(failed || errors.length ? `\n${failed} comparison(s) failed` : `\nAll ${compared} comparisons passed (${results.length - skipped} examples${skipped ? `, ${skipped} skipped` : ""})`);
await browser.close();
server.close();
if (!process.env.KEEP) await rm(work, { recursive: true, force: true });
process.exit(failed || errors.length ? 1 : 0);
