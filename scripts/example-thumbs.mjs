#!/usr/bin/env node
/**
 * Draw the start screen's picture of every example: its first sheet, simulated, as the CAD
 * shows it (examples/thumbs/<example>.webp). Run it again after changing an example.
 *
 *   node scripts/example-thumbs.mjs           every example
 *   node scripts/example-thumbs.mjs 06 13     only these
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(new URL("..", import.meta.url).pathname);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".wasm": "application/wasm" };
const server = createServer((req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = readFileSync(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on("dialog", d => d.accept());
await page.goto(`http://localhost:${server.address().port}/circuit_sandbox.html`);
await page.waitForFunction(() => window.TubeCAD);
mkdirSync(join(root, "examples", "thumbs"), { recursive: true });
for (const file of await page.evaluate(() => TubeCAD.EXAMPLES.map(x => x.file))) {
  if (only.length && !only.some(o => file.startsWith(o))) continue;
  await page.evaluate(f => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => x.file === f)), file);
  await page.waitForFunction(() => { const s = TubeCAD.state.sim; return !s.busy && !s.pending && s.result && s.topo === TubeCAD.topo(); }, null, { timeout: 120000 });
  const url = await page.evaluate(() => TubeCAD.thumbnail(480));
  const out = join(root, "examples", "thumbs", file.replace(/\.json$/, ".webp"));
  writeFileSync(out, Buffer.from(url.split(",")[1], "base64"));
  console.log(`${file}: ${(readFileSync(out).length / 1024).toFixed(1)} KB${/webp/.test(url) ? "" : " (PNG: this browser has no WebP encoder)"}`);
}
await browser.close();
server.close();
