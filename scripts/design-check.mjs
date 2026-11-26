#!/usr/bin/env node
/**
 * Check a design netlist in the real CAD: draws it as the AI features do (AiDesign.check +
 * layout), simulates it in headless Chromium and prints the Checks (ratings, wiring, ERC) and the
 * circuit with its operating points as the AI sees it. The circuit-design skill's last step.
 *
 *   node scripts/design-check.mjs design.json              # a design netlist ({ title, rails, parts })
 *   node scripts/design-check.mjs design.json --save out.json   # also the project file, to open in the app
 *   node scripts/design-check.mjs examples/13-2a3-single-ended-1627sea.json   # a project file works too
 *
 * Exit code 1 when the design has problems the CAD cannot draw or the Checks list anything.
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const args = process.argv.slice(2), file = args.find(a => !a.startsWith("--")), saveAt = args.includes("--save") ? args[args.indexOf("--save") + 1] : null;
if (!file) { console.error("usage: node scripts/design-check.mjs design.json [--save project.json]"); process.exit(2); }
const input = JSON.parse(await readFile(resolve(file), "utf8"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(path); res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
let code = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("tubecad_start", "0"); localStorage.setItem("tubecad_tabs", "0"); } catch (e) { /* no storage */ } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${server.address().port}/circuit_sandbox.html`);
  await page.waitForFunction(() => window.TubeCAD);
  const r = await page.evaluate(async design => {
    const T = window.TubeCAD, S = T.state;
    let problems = [];
    if (Array.isArray(design.comps)) T.openText(JSON.stringify(design), "design.json");
    else {
      const checked = AiDesign.check(design); problems = checked.problems;
      const out = AiDesign.layout(checked, { title: design.title || "Design" });
      const comps = [{ type: "frame", x: 0, y: 0, rot: 0, label: "", params: { size: out.frame.size, orient: out.frame.orient, title: out.frame.title } }]
        .concat(out.comps.map(o => ({ type: o.type, x: o.x, y: o.y, rot: o.rot, label: o.label || "", params: o.params })));
      T.openText(JSON.stringify({ app: "tube-amp-cad", comps: comps.map((c, i) => Object.assign({ id: "d" + i }, c)), wires: out.wires }), "design.json");
    }
    T.runSim("live");
    const t0 = Date.now();
    while ((S.sim.busy || S.sim.pending || !S.sim.result) && !S.sim.error && Date.now() - t0 < 60000) await new Promise(res => setTimeout(res, 200));
    await new Promise(res => setTimeout(res, 300));
    return { problems, issues: T.circuitIssues(), described: T.ai.describe(true), project: T.circuitJSON ? T.circuitJSON() : null };
  }, input);
  if (r.problems.length) { console.log("The CAD could not use the design as it is:"); r.problems.forEach(p => console.log("  - " + p)); }
  console.log("\n" + r.described);
  console.log(r.issues.length ? `\nChecks (${r.issues.length}):\n` + r.issues.map(i => "  - " + i).join("\n") : "\nChecks: no problems.");
  if (saveAt && r.project) { await writeFile(resolve(saveAt), typeof r.project === "string" ? r.project : JSON.stringify(r.project, null, 1)); console.log(`\nSaved ${saveAt}`); }
  code = r.problems.length || r.issues.length ? 1 : 0;
} finally { await browser.close(); server.close(); }
process.exit(code);
