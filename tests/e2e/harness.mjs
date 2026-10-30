/* The end-to-end tests' shared setup (tests/e2e.mjs runs the parts in tests/e2e/ in order):
   a static server for the tree under test, the browser, the CAD page and helpers on it. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium, webkit } from "playwright";

const root = resolve(process.argv[2] || ".");
// workers refuse to load unless .js is served as JavaScript
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
export const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  // the browser may still ask for /favicon.ico by itself (full Chrome does; the pages declare favicon.png): nothing to send
  if (/\/favicon\.ico$/.test(path)) { res.writeHead(204); return res.end(); }
  // read first, then answer: a missing file gets one 404, not a 200 header followed by a crash
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);
export const U = page => `http://localhost:${server.address().port}/${page}`;

let failed = 0;
export const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failed++; };

// BROWSER=webkit runs the suite in the Safari engine
export const browser = process.env.BROWSER === "webkit" ? await webkit.launch() : await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
// the start screen stays shut in every context, unless asked for with { startScreen: true }
// (tests/e2e/05-sheets-files.mjs checks it in a context of its own)
const newContext = browser.newContext.bind(browser);
browser.newContext = async ({ startScreen, ...opts } = {}) => {
  const c = await newContext(opts);
  if (!startScreen) await c.addInitScript(() => { try { localStorage.setItem("tubecad_start", "0"); } catch (e) { /* no storage */ } });
  return c;
};
export const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
export const errors = [], missing = [];
export const open = async (name, page) => {
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  // the Board window asks for Freerouting on this computer every few seconds: no answer there (or one a CORS check refuses) is not an error of the page
  // nor is the link store's 404 (the test server has none; 11-share plays one where it needs it), nor the revisions' 401 before signing in
  p.on("console", m => { if (m.type() === "error" && !/^http:\/\/127\.0\.0\.1:\d+\/v1\/|\/api\/(share|rev)(\/|$)|streams\.radiobob\.de\//.test((m.location() || {}).url || "") && !/127\.0\.0\.1:\d+\/v1\/|Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push(`${name}: ${m.text()}`); });
  p.on("response", r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await p.goto(U(page));
  return p;
};

export const cad = await open("cad", "circuit_sandbox.html");
await cad.waitForFunction(() => window.TubeCAD);
{ const ver = await cad.textContent("#app-version"), pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;
  check(ver === "dev" || ver === "v" + pkg, `the version under the name (${ver}) is "dev" in the source, v${pkg} in the package`); }
await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.view = { scale: 1, ox: 0, oy: 0 }; TubeCAD.commit(); });
export const box = await cad.locator("#cad").boundingBox();
export const toScreen = (x, y) => cad.evaluate(([x, y]) => { const v = TubeCAD.state.view; return [x * v.scale + v.ox, y * v.scale + v.oy]; }, [x, y]).then(([sx, sy]) => [box.x + sx, box.y + sy]);
export const clickAt = async (x, y) => { const [px, py] = await toScreen(x, y); await cad.mouse.click(px, py); };
export const state = () => cad.evaluate(() => { const S = TubeCAD.state; return { comps: S.comps.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot, label: c.label, params: c.params })), wires: S.wires.length }; });
export const sameNet = (a, b) => cad.evaluate(([a, b]) => { const T = TubeCAD.topo(); return T.pinNet.get(a) === T.pinNet.get(b); }, [a, b]);
export const pin = (id, p) => cad.evaluate(([id, p]) => TubeCAD.compPins(TubeCAD.state.comps.find(c => c.id === id)).find(q => q.id === p), [id, p]);


// how many checks failed so far
export const failures = () => failed;
