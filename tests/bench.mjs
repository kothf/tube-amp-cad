#!/usr/bin/env node
/**
 * The engine's speed on every example. Each example is opened in the CAD and its netlist
 * taken; then, in Node on one core, the engine runs what the CAD runs on it:
 *
 *   live      the quick run behind every edit (2.5 s budget)
 *   full      "Simulate until settled"
 *   ac        the Bode sweep, 1 Hz to 1 MHz at 40 points a decade, from the signal generator
 *   power-on  one second from switch-on with hot cathodes
 *
 * For each it prints the time and the work counted by the engine (result.stats): Newton
 * solves at DC and in the transient, their iterations, and the device-model evaluations
 * the Jacobians took. Times depend on the machine; the counts do not, so the counts are
 * what the run checks: tests/bench-baseline.json holds them, and a full or power-on run
 * that takes more than 20 % more Newton iterations than its baseline fails the run (a
 * change that slows the engine down is seen even where CI's machines vary). Fewer is
 * fine: BENCH_UPDATE=1 writes the new counts as the baseline.
 *
 *   node tests/bench.mjs [root]
 *
 * ONLY=07 runs the examples whose file name has that in it, CHROMIUM_PATH a browser
 * binary, BENCH_JSON=file writes the whole report as JSON.
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.argv[2] || ".");
const BASELINE = new URL("./bench-baseline.json", import.meta.url);
const SLACK = 1.2;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm" };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);

// the netlists, from the CAD
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("dialog", d => d.accept());
await page.goto(`http://localhost:${server.address().port}/circuit_sandbox.html`);
await page.waitForFunction(() => window.TubeCAD);
const list = await page.evaluate(() => TubeCAD.EXAMPLES.map(e => ({ file: e.file, title: e.title })));
const examples = [];
for (const ex of list.filter(e => !process.env.ONLY || e.file.includes(process.env.ONLY))) {
  const got = await page.evaluate(async file => {
    const C = TubeCAD, S = C.state;
    await C.openExample(C.EXAMPLES.find(e => e.file === file));
    const g = S.comps.find(c => c.type === "siggen");
    return { netlist: C.buildNetlist(), gen: g ? g.id : null, freq: g && g.params.freq > 0 ? +g.params.freq : 0, runOptions: C.runOptions };
  }, ex.file);
  examples.push(Object.assign({}, ex, got));
}
await browser.close();
server.close();

// the engine, in Node
for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(join(root, f), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine;
E.loadWasm(readFileSync(join(root, "sim-solver.wasm")));

const timed = fn => { const t0 = performance.now(); const r = fn(); return { ms: performance.now() - t0, r }; };
const report = [];
for (const ex of examples) {
  const { netlist, runOptions } = ex, frame = ex.freq ? { frameSpan: 1 / ex.freq } : {};
  const row = { file: ex.file, title: ex.title, runs: {} };
  const keep = (name, { ms, r }) => {
    row.runs[name] = { ok: !!r.ok, ms: Math.round(ms), error: r.ok ? undefined : r.error, settled: r.tran ? !!r.tran.settled : undefined, stats: r.stats ? Object.assign({}, r.stats) : undefined };
  };
  keep("live", timed(() => E.simulate(netlist, Object.assign({}, runOptions.live, frame))));
  keep("full", timed(() => E.simulate(netlist, Object.assign({}, runOptions.full, frame))));
  if (ex.gen) keep("ac", timed(() => E.acSweep(netlist, { inputs: [{ id: ex.gen, mag: 1 }], fStart: 1, fStop: 1e6, perDecade: 40, budgetMs: 60000 })));
  keep("power-on", timed(() => E.startup(netlist, { tStop: 1, budgetMs: 120000 })));
  report.push(row);
}

// ---- report ------------------------------------------------------------------------
let baseline = {};
try { baseline = JSON.parse(await readFile(BASELINE, "utf8")); } catch { /* none yet */ }
const CHECKED = ["full", "power-on"];
const pad = (s, n) => String(s).padEnd(n), lpad = (s, n) => String(s).padStart(n);
let failed = 0;
const total = {};
console.log(`${pad("example", 40)} ${["live", "full", "ac", "power-on"].map(k => lpad(k + " ms", 12)).join(" ")}   Newton its (full / power-on)`);
for (const row of report) {
  const R = row.runs, base = baseline[row.file] || {};
  const cells = ["live", "full", "ac", "power-on"].map(k => lpad(R[k] ? (R[k].ok ? R[k].ms : "fail") : "-", 12));
  const its = CHECKED.map(k => (R[k] && R[k].stats ? R[k].stats.newton : "-"));
  console.log(`${pad(row.file.replace(/\.json$/, "").slice(0, 40), 40)} ${cells.join(" ")}   ${its.join(" / ")}`);
  Object.keys(R).forEach(k => { if (R[k].ok) total[k] = (total[k] || 0) + R[k].ms; });
  for (const k of CHECKED) {
    const r = R[k], b = base[k];
    if (!r || !r.ok) { if (b) { console.log(`  FAIL ${k}: ${r ? r.error : "not run"}`); failed++; } continue; }
    if (b && r.stats.newton > b.newton * SLACK) { console.log(`  FAIL ${k}: ${r.stats.newton} Newton iterations, baseline ${b.newton} (more than ${Math.round((SLACK - 1) * 100)} % up)`); failed++; }
    else if (b && r.stats.newton < b.newton / SLACK) console.log(`  note ${k}: ${r.stats.newton} Newton iterations, baseline ${b.newton}: faster, BENCH_UPDATE=1 keeps it`);
  }
}
console.log(`${pad("total", 40)} ${["live", "full", "ac", "power-on"].map(k => lpad(Math.round(total[k] || 0), 12)).join(" ")}`);
if (process.env.BENCH_JSON) await writeFile(process.env.BENCH_JSON, JSON.stringify(report, null, 1));
if (process.env.BENCH_UPDATE) {
  const next = Object.assign({}, baseline);
  report.forEach(row => { next[row.file] = {}; CHECKED.forEach(k => { const r = row.runs[k]; if (r && r.ok) next[row.file][k] = { newton: r.stats.newton, steps: r.stats.steps, evals: r.stats.evals }; }); });
  await writeFile(BASELINE, JSON.stringify(next, null, 1) + "\n");
  console.log(`\nbaseline written: ${report.length} examples`);
}
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${report.length} examples within ${Math.round((SLACK - 1) * 100)} % of their baseline work`);
process.exit(failed ? 1 : 0);
