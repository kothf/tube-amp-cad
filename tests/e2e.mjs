#!/usr/bin/env node
/**
 * End-to-end test of the CAD, curve tracer and instruments in headless Chromium.
 *
 *   node tests/e2e.mjs                    # tests the source tree
 *   node tests/e2e.mjs dist/tube-amp-cad  # tests the packaged build
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { chromium } from "playwright";

const root = resolve(process.argv[2] || ".");
// workers refuse to load unless .js is served as JavaScript
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/\/$/, "/index.html"));
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
  try { res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const U = page => `http://localhost:${server.address().port}/${page}`;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
const errors = [], missing = [];
const open = async (name, page) => {
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  p.on("console", m => { if (m.type() === "error") errors.push(`${name}: ${m.text()}`); });
  p.on("response", r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });
  await p.goto(U(page));
  return p;
};

// --- 1. Editing with the real mouse and keyboard -----------------------------
const cad = await open("cad", "circuit_sandbox.html");
await cad.waitForFunction(() => window.TubeCAD);
await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.view = { scale: 1, ox: 0, oy: 0 }; TubeCAD.commit(); });
const box = await cad.locator("#cad").boundingBox();
const toScreen = (x, y) => cad.evaluate(([x, y]) => { const v = TubeCAD.state.view; return [x * v.scale + v.ox, y * v.scale + v.oy]; }, [x, y]).then(([sx, sy]) => [box.x + sx, box.y + sy]);
const clickAt = async (x, y) => { const [px, py] = await toScreen(x, y); await cad.mouse.click(px, py); };
const state = () => cad.evaluate(() => { const S = TubeCAD.state; return { comps: S.comps.map(c => ({ id: c.id, type: c.type, x: c.x, y: c.y, rot: c.rot, label: c.label, params: c.params })), wires: S.wires.length }; });
const sameNet = (a, b) => cad.evaluate(([a, b]) => { const T = TubeCAD.topo(); return T.pinNet.get(a) === T.pinNet.get(b); }, [a, b]);
const pin = (id, p) => cad.evaluate(([id, p]) => TubeCAD.compPins(TubeCAD.state.comps.find(c => c.id === id)).find(q => q.id === p), [id, p]);

await cad.getByRole("button", { name: /^Resistor/ }).click();
const [mx, my] = await toScreen(300, 200);
await cad.mouse.move(mx, my); await cad.keyboard.press("r"); await cad.mouse.click(mx, my);
await cad.getByRole("button", { name: /^Capacitor/ }).click();
await clickAt(500, 300);
let s = await state();
const R1 = s.comps.find(c => c.label === "R1"), C1 = s.comps.find(c => c.label === "C1");
check(R1 && R1.rot === 1 && C1 && C1.x === 500, "parts placed from the palette, rotated with R, snapped to the grid");

const a = await pin(R1.id, "2"), b = await pin(C1.id, "1");
await clickAt(a.x, a.y); await clickAt(a.x, b.y); await clickAt(b.x, b.y);
check(await sameNet(`${R1.id}:2`, `${C1.id}:1`), "wire drawn pin → corner → pin connects R1 to C1");

const [cx, cy] = await toScreen(500, 300), [dx, dy] = await toScreen(540, 340);
await cad.mouse.move(cx, cy); await cad.mouse.down(); await cad.mouse.move(dx, dy, { steps: 5 }); await cad.mouse.up();
check(await sameNet(`${R1.id}:2`, `${C1.id}:1`), "wire follows a dragged part and stays connected");

await cad.keyboard.press("Control+a"); await cad.keyboard.press("Delete");
check((await state()).comps.length === 0, "Ctrl+A, Delete clears the sheet");
await cad.keyboard.press("Control+z");
check((await state()).comps.length === 2, "Ctrl+Z restores it");

await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); TubeCAD.commit(); }, R1.id);
const field = cad.locator("#inspector .row", { hasText: "Resistance" }).locator("input");
await field.fill("4.7k"); await field.press("Enter");
check((await state()).comps.find(c => c.id === R1.id).params.r === 4700, 'inspector parses "4.7k" as 4700 Ω');
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
check((await state()).comps.some(c => c.params.r === 4700), "circuit survives a reload (autosave)");

// --- 2. A 12AX7 stage with generator and scope, simulated in the worker ------
const circuit = await cad.evaluate(async () => {
  const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
  const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
  const pin = (c, id) => C.compPins(c).find(p => p.id === id);
  const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
  const gnd = (p, x, y) => { const g = add("ground", {}, x ?? p.x, y ?? p.y + 40); wire(p, pin(g, "G"), false); };
  const V1 = add("tube", { tube: "12AX7" }, 400, 300), Ra = add("resistor", { r: 100e3 }, 400, 160, 1), B = add("vdc", { v: 250 }, 560, 120);
  const Rk = add("resistor", { r: 1500 }, 400, 420, 1), Ck = add("electrolytic", { c: 47e-6 }, 470, 420, 1);
  const Rg = add("resistor", { r: 1e6 }, 300, 380, 1), Cin = add("capacitor", { c: 0.1e-6 }, 250, 300);
  const G = add("siggen", { amp: 0.5, freq: 1000 }, 180, 360);
  const Co = add("capacitor", { c: 0.1e-6 }, 500, 220), RL = add("resistor", { r: 470e3 }, 580, 290, 1);
  const SC = add("scope", {}, 820, 560);
  wire(pin(B, "+"), pin(Ra, "1"), true); gnd(pin(B, "-")); wire(pin(Ra, "2"), pin(V1, "A"));
  wire(pin(V1, "K"), pin(Rk, "1")); wire(pin(Rk, "1"), pin(Ck, "+"), true); gnd(pin(Rk, "2")); gnd(pin(Ck, "-"));
  wire(pin(Cin, "2"), pin(V1, "G")); wire(pin(Rg, "1"), { x: 300, y: 300 }); gnd(pin(Rg, "2"));
  wire(pin(G, "+"), pin(Cin, "1"), false); gnd(pin(G, "-"));
  wire(pin(V1, "A"), pin(Co, "1"), false); wire(pin(Co, "2"), pin(RL, "1")); gnd(pin(RL, "2"));
  wire(pin(SC, "CH1"), { x: 640, y: 530 }, true); wire({ x: 640, y: 530 }, { x: 640, y: 260 }); wire({ x: 640, y: 260 }, pin(RL, "1"), true);
  wire(pin(SC, "CH2"), { x: 700, y: 550 }, true); wire({ x: 700, y: 550 }, { x: 700, y: 620 }); wire({ x: 700, y: 620 }, { x: 150, y: 620 });
  wire({ x: 150, y: 620 }, { x: 150, y: 330 }); wire({ x: 150, y: 330 }, pin(G, "+"), true);
  wire(pin(SC, "COM"), { x: 720, y: 590 }, true); const g7 = add("ground", {}, 720, 600); wire({ x: 720, y: 590 }, pin(g7, "G"));
  const seq0 = S.sim.seq;
  S.sel.comps.clear(); C.commit(); C.fitView();
  // wait for a run that started after this edit (commit debounces the solver)
  const t0 = performance.now();
  while ((S.sim.seq === seq0 || S.sim.busy) && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
  const T = C.topo(), open = [];
  S.comps.forEach(c => C.compPins(c).forEach(p => { if (!T.pinConnected.get(`${c.id}:${p.id}`)) open.push(`${c.label}.${p.id}`); }));
  const d = C.tubeData(V1);
  return { error: S.sim.error, open, ms: performance.now() - t0, v1: V1.id, scope: SC.id, vak: d && d.dc.vak, ia: d && d.dc.ia, gain: d && d.metrics.gain, thd: d && d.metrics.thd };
});
check(!circuit.error && circuit.open.length === 0, `12AX7 stage simulates with every pin connected${circuit.error ? ` (${circuit.error})` : ""}${circuit.open.length ? ` (open: ${circuit.open})` : ""}`);
if (circuit.error || !circuit.ia) { console.log(`\nsimulation failed: ${circuit.error}`); process.exit(1); }
check(circuit.ia > 0.4e-3 && circuit.ia < 1.5e-3 && circuit.vak > 100 && circuit.vak < 200, `operating point Ia ${(circuit.ia * 1e3).toFixed(2)} mA, Vak ${circuit.vak.toFixed(1)} V`);
check(circuit.gain > 40 && circuit.gain < 70, `stage gain ${circuit.gain.toFixed(1)}× (12AX7, 100k plate load)`);
check(circuit.ms < 10000, `simulation finished in ${(circuit.ms / 1000).toFixed(1)} s`);

// --- 3. Instruments receive the live result ---------------------------------
const scope = await open("scope", `oscilloscope.html?scope=${circuit.scope}`);
await scope.waitForFunction(() => document.getElementById("status").textContent.includes("Live from CAD"), null, { timeout: 5000 }).catch(() => {});
const meas = await scope.textContent("#meas");
check((await scope.textContent("#status")).includes("Live from CAD"), "oscilloscope receives live data from the CAD");
const ratio = parseFloat((meas.match(/CH1\/CH2 at [^:]+: ([\d.]+)×/) || [])[1]);
check(Math.abs(ratio - circuit.gain) / circuit.gain < 0.05, `scope CH1/CH2 ${ratio}× matches the CAD stage gain (±5 %)`);
check(/phase -?1[78]\d°/.test(meas), "common-cathode output is inverted (~180°)");

const spectrum = await open("spectrum", `spectrum_analyzer.html?scope=${circuit.scope}`);
await spectrum.waitForFunction(() => /\d/.test(document.getElementById("thd").textContent), null, { timeout: 5000 }).catch(() => {});
const thd = parseFloat((await spectrum.textContent("#thd")).replace(/[^\d.]/g, ""));
check(Math.abs(thd - circuit.thd) / circuit.thd < 0.1, `spectrum THD ${thd} % matches the CAD's ${circuit.thd.toFixed(3)} % (±10 %)`);

// --- 3b. Auto-ranging a DC-coupled plate: the trace must use the screen ------
const probe = await cad.evaluate(async v1 => {
  const C = TubeCAD, S = C.state;
  const pin = (c, id) => C.compPins(c).find(p => p.id === id);
  const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
  const Co = S.comps.find(c => c.type === "capacitor" && c.label === "C3") || S.comps.filter(c => c.type === "capacitor").pop();
  const SC2 = C.makeComp("scope", {}, 820, 160, 0); S.comps.push(SC2);
  // CH1 taps the plate wire just left of the coupling capacitor; COM to ground
  const p1 = pin(SC2, "CH1"), coA = pin(Co, "1"), tap = { x: coA.x - 10, y: coA.y };
  wire(p1, { x: tap.x, y: p1.y }, true); wire({ x: tap.x, y: p1.y }, tap, false);
  const com = pin(SC2, "COM"), g = C.makeComp("ground", {}, com.x, com.y + 40, 0); S.comps.push(g); wire(com, pin(g, "G"), false);
  const seq0 = S.sim.seq; C.commit();
  const t0 = performance.now();
  while ((S.sim.seq === seq0 || S.sim.busy) && performance.now() - t0 < 15000) await new Promise(r => setTimeout(r, 50));
  const T = C.topo();
  return { id: SC2.id, err: S.sim.error, onPlate: T.pinNet.get(`${SC2.id}:CH1`) === T.pinNet.get(`${v1}:A`) };
}, circuit.v1);
check(!probe.err && probe.onPlate, "second scope probes the 12AX7 plate directly (DC coupled)");
const scope2 = await open("scope2", `oscilloscope.html?scope=${probe.id}`);
await scope2.waitForFunction(() => window.Scope && window.Scope.view(), null, { timeout: 5000 }).catch(() => {});
const pv = await scope2.evaluate(() => window.Scope.view());
const top = (pv.ch1.max - pv.ch1.off) / pv.ch1.vdiv, bottom = (pv.ch1.min - pv.ch1.off) / pv.ch1.vdiv;
check(pv.ch1.offset > 100 && top <= 4 && bottom >= -4 && top - bottom > 3,
  `auto shows the plate swing on ${(top - bottom).toFixed(1)} divisions at ${pv.ch1.vdiv} V/div with a ${pv.ch1.offset} V offset (was a flat line at 100 V/div)`);
check(Math.abs(pv.f - 1000) < 5 && pv.tdiv === 2e-4, `timebase locks to the measured ${pv.f.toFixed(0)} Hz (${pv.tdiv * 1e6} µs/div)`);
await scope2.close();

// --- 4. Curve tracer follows the tube selected in the CAD -------------------
const tracer = await open("tracer", "index.html");
await tracer.waitForFunction(() => document.getElementById("plot-title").textContent.length > 0);
const [tx, ty] = await cad.evaluate(id => { const S = TubeCAD.state, c = S.comps.find(k => k.id === id), r = document.getElementById("cad").getBoundingClientRect(); return [r.left + (c.x + 10) * S.view.scale + S.view.ox, r.top + (c.y + 10) * S.view.scale + S.view.oy]; }, circuit.v1);
await cad.mouse.click(tx, ty);
await tracer.waitForFunction(() => document.getElementById("plot-title").textContent.includes("in circuit"), null, { timeout: 5000 }).catch(() => {});
const title = await tracer.textContent("#plot-title");
check(title.includes("12AX7") && title.includes("V1 in circuit"), `clicking V1 in the CAD shows it on the curve tracer ("${title.trim()}")`);
await tracer.getByRole("button", { name: /EL34/ }).first().click();
check((await tracer.textContent("#plot-title")).includes("EL34"), "the tracer's own tube library still works");

check(missing.length === 0, `every asset loads${missing.length ? `: ${missing.slice(0, 3).join(", ")}` : ""}`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
