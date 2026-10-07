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

// --- 3a. Markers: pick points on the scope and analyzer with the mouse -------
const canvasAt = async (page, p) => { const r = await page.locator("#screen").boundingBox(); return [r.x + p.x, r.y + p.y]; };
{
  const f = await scope.evaluate(() => window.Scope.view().f);
  const pA = await scope.evaluate(() => window.Scope.screenPoint("ch1", 0.1));
  // one period later on the same trace: 1 ms of a 2 ms screen at 200 µs/div
  const pB = await scope.evaluate(() => window.Scope.screenPoint("ch1", 0.6));
  await scope.mouse.click(...await canvasAt(scope, pA));
  await scope.mouse.click(...await canvasAt(scope, pB));
  const m = await scope.evaluate(() => window.Scope.markers());
  const st = await scope.evaluate(() => { const a = Instrument.scope().ch1; return { min: Math.min(...a), max: Math.max(...a) }; });
  check(m.length === 2 && m.every(k => k.ch === "ch1" && k.reading.v >= st.min - 1e-6 && k.reading.v <= st.max + 1e-6),
    `scope markers A, B land on the CH1 trace (${m.map(k => k.reading && k.reading.v.toFixed(3) + " V").join(", ")})`);
  const dT = m[1].reading.t - m[0].reading.t, dV = m[1].reading.v - m[0].reading.v;
  check(Math.abs(dT - 1 / f) < 0.01 / f && Math.abs(dV) < 0.02 * (st.max - st.min),
    `one period apart: ΔT ${(dT * 1e3).toFixed(3)} ms (1/ΔT ${(1 / dT).toFixed(0)} Hz), ΔV ${dV.toFixed(3)} V`);
  check(/ΔT [\d.]+ms \(1\/ΔT 1k?Hz\)|ΔT 1ms \(1\/ΔT 1kHz\)/.test(await scope.textContent("#marks")), `readout: "${(await scope.textContent("#marks")).match(/ΔT[^·]*/)[0].trim()}"`);
  // drag B a little, double-click A away, Esc clears
  const [bx, by] = await canvasAt(scope, m[1].pos);
  await scope.mouse.move(bx, by); await scope.mouse.down(); await scope.mouse.move(bx + 40, by, { steps: 4 }); await scope.mouse.up();
  const moved = await scope.evaluate(() => window.Scope.markers());
  check(moved.length === 2 && moved[1].t > m[1].t, "dragging marker B moves it along the trace");
  await scope.mouse.dblclick(...await canvasAt(scope, moved[0].pos));
  check((await scope.evaluate(() => window.Scope.markers())).length === 1, "double-click removes a marker");
  await scope.keyboard.press("Escape");
  check((await scope.evaluate(() => window.Scope.markers())).length === 0, "Esc clears the markers");
}
{
  const fund = 1000;
  const p1 = await spectrum.evaluate(() => window.Spectrum.linePoint(1000)), p2 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000));
  // click a little above each stem: the marker snaps to the line
  await spectrum.mouse.click(...await canvasAt(spectrum, { x: p1.x + 3, y: p1.y - 15 }));
  await spectrum.mouse.click(...await canvasAt(spectrum, { x: p2.x - 3, y: p2.y - 15 }));
  const m = await spectrum.evaluate(() => window.Spectrum.markers());
  const h2 = await spectrum.evaluate(() => parseFloat([...document.querySelectorAll("#harm tr")].find(r => r.cells[0].textContent === "H2").cells[2].textContent));
  check(m.length === 2 && m[0].reading.f === fund && m[0].reading.h === 1 && m[1].reading.h === 2,
    `analyzer markers snap to the fundamental and H2 (${m.map(k => k.reading.f + " Hz").join(", ")})`);
  check(Math.abs(m[1].reading.dbc - h2) < 0.06, `marker B reads H2 at ${m[1].reading.dbc.toFixed(2)} dBc, as the harmonic table (${h2} dBc)`);
}

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
// pick points: the operating point (snapped), then a free point on the plot
{
  const q = await tracer.evaluate(() => { const ct = TubeTracer.current().circuit; return { ...TubeTracer.toScreen(ct.dc.vak, ct.dc.ia), vgk: ct.dc.vgk, vak: ct.dc.vak, ia: ct.dc.ia }; });
  const r = await tracer.locator("#plot").boundingBox();
  await tracer.mouse.click(r.x + q.x + 4, r.y + q.y - 3);
  const free = await tracer.evaluate(() => TubeTracer.toScreen(250, 0));
  await tracer.mouse.click(r.x + free.x, r.y + free.y - 2);
  const p = await tracer.evaluate(() => TubeTracer.picks());
  check(p.length === 2 && p[0].q && Math.abs(p[0].vg - q.vgk) < 1e-9,
    `click near the Q point snaps to it: Va ${p[0] && p[0].va.toFixed(1)} V, Vg ${p[0] && p[0].vg.toFixed(3)} V`);
  // the model solved for Vg puts the tube back on the operating point
  const vg = await tracer.evaluate(([va, ia]) => TubeTracer.vgFor(TubeTracer.current(), va, ia), [q.vak, q.ia]);
  check(Math.abs(vg - q.vgk) < 0.02, `Vg from the model at Q: ${vg.toFixed(3)} V vs simulated ${q.vgk.toFixed(3)} V`);
  check(p[1] && Math.abs(p[1].va - 250) < 2 && p[0].mu > 80 && p[0].mu < 110 && p[0].rp > 40e3 && p[0].rp < 120e3,
    `12AX7 at Q: gm ${(p[0].gm * 1e3).toFixed(2)} mA/V, rp ${(p[0].rp / 1e3).toFixed(1)} kΩ, µ ${p[0].mu.toFixed(1)}`);
  const R = (p[1].va - p[0].va) / (p[0].ia - p[1].ia), txt = await tracer.textContent("#picks");
  check(/load line [\d.]+k?Ω/.test(txt), `A→B load line ${(R / 1e3).toFixed(1)} kΩ shown ("${(txt.match(/load line [^(]*/) || [""])[0].trim()}")`);
}
await tracer.getByRole("button", { name: /EL34/ }).first().click();
check((await tracer.textContent("#plot-title")).includes("EL34"), "the tracer's own tube library still works");
check((await tracer.evaluate(() => TubeTracer.picks())).length === 0, "switching tubes clears the picked points");
{
  // a free pick on the EL34 curves: Vg solved from the model reproduces the picked current
  const pt = await tracer.evaluate(() => TubeTracer.toScreen(250, TubeTracer.iaOf(250, -10)));
  const r = await tracer.locator("#plot").boundingBox();
  await tracer.mouse.click(r.x + pt.x, r.y + pt.y);
  const [k] = await tracer.evaluate(() => TubeTracer.picks());
  const back = await tracer.evaluate(([va, vg]) => TubeTracer.iaOf(va, vg), [k.va, k.vg]);
  check(Math.abs(k.vg + 10) < 0.5 && Math.abs(back - k.ia) < 1e-6 * Math.max(1, k.ia * 1e3),
    `EL34 point Va ${k.va.toFixed(1)} V, Ia ${(k.ia * 1e3).toFixed(2)} mA reads Vg ${k.vg.toFixed(2)} V (curve drawn at −10 V)`);
}

// --- 5. A ganged changeover switch, flipped with a double-click --------------
{
  // two sections, SA1.1 and SA1.2, each choosing between two loads on its own 10 V supply
  const ids = await cad.evaluate(async () => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const out = [];
    for (const [i, x0] of [[1, 200], [2, 600]]) {
      const B = add("vdc", { v: 10 }, x0, 300), SW = add("switch", {}, x0 + 100, 240);
      SW.label = `SA1.${i}`;
      const Ra = add("resistor", { r: 1000 }, x0 + 200, 260, 1), Rb = add("resistor", { r: 2000 }, x0 + 260, 300, 1);
      const g = add("ground", {}, x0, 380);
      wire(pin(B, "+"), pin(SW, "C"), false); wire(pin(SW, "A"), pin(Ra, "1"), true); wire(pin(SW, "B"), pin(Rb, "1"), true);
      wire(pin(B, "-"), pin(g, "G")); wire(pin(Ra, "2"), { x: x0 + 200, y: 380 }); wire(pin(Rb, "2"), { x: x0 + 260, y: 380 }); wire({ x: x0, y: 380 }, { x: x0 + 260, y: 380 });
      out.push({ sw: SW.id, a: Ra.id, b: Rb.id });
    }
    S.view = { scale: 1, ox: 0, oy: 0 }; C.commit();
    return out;
  });
  const settle = () => cad.evaluate(async () => { const S = TubeCAD.state, s0 = S.sim.seq, t0 = performance.now(); while ((S.sim.seq === s0 || S.sim.busy) && performance.now() - t0 < 10000) await new Promise(r => setTimeout(r, 50)); });
  const read = () => cad.evaluate(ids => {
    const S = TubeCAD.state, T = TubeCAD.topo(), v = (id, p) => S.sim.result.dc.nodes[T.pinNet.get(`${id}:${p}`)];
    return ids.map(k => ({ pos: S.comps.find(c => c.id === k.sw).params.pos, va: v(k.a, "1"), vb: v(k.b, "1") }));
  }, ids);
  await settle();
  let r = await read();
  check(r.every(k => k.pos === "A" && Math.abs(k.va - 10) < 0.01 && Math.abs(k.vb) < 0.01), `switch at A feeds load A: ${r.map(k => `${k.va.toFixed(2)} V / ${k.vb.toFixed(2)} V`).join(", ")}`);
  const sw = await cad.evaluate(id => TubeCAD.state.comps.find(c => c.id === id), ids[0].sw);
  const [px, py] = await toScreen(sw.x, sw.y);
  await cad.mouse.dblclick(px, py);
  await settle();
  r = await read();
  check(r.every(k => k.pos === "B" && Math.abs(k.vb - 10) < 0.01 && Math.abs(k.va) < 0.01), `double-click on SA1.1 flips both sections to B: ${r.map(k => `${k.va.toFixed(2)} V / ${k.vb.toFixed(2)} V`).join(", ")}`);
  await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(id); TubeCAD.commit(); }, ids[1].sw);
  await cad.locator("#inspector .row", { hasText: "Position" }).locator("select").selectOption("A");
  await settle();
  r = await read();
  check(r.every(k => k.pos === "A"), "the inspector's Position flips the whole gang back to A");
  check(/^R\S* .* 0\.01$/m.test(await cad.evaluate(() => TubeCAD.spiceNetlist())), "SPICE export includes the closed contact");
}

// --- 6. A slow kenotron supply: settles fully, DC readouts are real averages --
{
  const ids = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    // 350-0-350 V, 5Ц4С, 10 µF - 0.6 H - 220 µF into 3 kΩ: an LC that rings at ~14 Hz
    const TX = add("ptx", { vrms: 350, freq: "50", rw: 60 }, 200, 300), V = add("tube", { tube: "5Ts4S" }, 360, 300, 3);
    const C1 = add("capacitor", { c: 10e-6 }, 460, 340, 1), L = add("inductor", { l: 0.6, dcr: 26 }, 520, 300), C2 = add("electrolytic", { c: 220e-6 }, 580, 340, 1);
    const RL = add("resistor", { r: 3000 }, 640, 340, 1), g = add("ground", {}, 220, 420);
    wire(pin(TX, "HT1"), { x: 290, y: 260 }, true); wire({ x: 290, y: 260 }, { x: 290, y: 280 }); wire({ x: 290, y: 280 }, pin(V, "A2"), true);
    wire(pin(TX, "HT2"), { x: 290, y: 340 }, true); wire({ x: 290, y: 340 }, { x: 290, y: 320 }); wire({ x: 290, y: 320 }, pin(V, "A1"), true);
    wire(pin(TX, "CT"), { x: 250, y: 300 }, true); wire({ x: 250, y: 300 }, { x: 250, y: 400 }); wire({ x: 250, y: 400 }, { x: 640, y: 400 }); wire({ x: 220, y: 400 }, { x: 250, y: 400 }); wire({ x: 220, y: 400 }, pin(g, "G"));
    wire(pin(V, "K"), pin(L, "1"), true); wire(pin(C1, "1"), { x: 460, y: 300 }); wire(pin(L, "2"), { x: 640, y: 300 }, true); wire(pin(C2, "+"), { x: 580, y: 300 }); wire(pin(RL, "1"), { x: 640, y: 300 });
    [pin(C1, "2"), pin(C2, "-"), pin(RL, "2")].forEach(p => wire(p, { x: p.x, y: 400 }));
    // a live run gets almost no time, so it must hand over to a background full run
    C.runOptions.live.budgetMs = 1;
    window.__statuses = [];
    new MutationObserver(() => window.__statuses.push(document.getElementById("status-sim").textContent)).observe(document.getElementById("status-sim"), { childList: true, characterData: true, subtree: true });
    S.view = { scale: 1, ox: 0, oy: 0 }; C.commit();
    return { out: RL.id };
  });
  // the live run runs out of time on this supply and continues in the background until settled
  const done = () => cad.waitForFunction(() => { const S = TubeCAD.state; return !S.sim.busy && S.sim.result; }, null, { timeout: 120000 });
  await cad.waitForTimeout(300); await done();
  const r = await cad.evaluate(id => {
    const S = TubeCAD.state, T = TubeCAD.topo(), r = S.sim.result, n = T.pinNet.get(`${id}:1`), w = r.tran.nodes[n];
    let m = 0; for (let i = 0; i < w.length - 1; i++) m += w[i]; m /= w.length - 1;
    const res = { settled: r.tran.settled, warn: S.sim.warnings, averaged: r.dcAveraged, dc: r.dc.nodes[n], mean: m, estimate: r.dcEstimate.nodes[n], status: document.getElementById("status-sim").textContent, handover: window.__statuses.some(t => /settling fully/.test(t)) };
    TubeCAD.runOptions.live.budgetMs = 2500;
    return res;
  }, ids.out);
  check(r.handover && r.settled && !r.warn.some(w => /settled/.test(w)), `an unsettled live run continues in the background until settled ("${r.status}")`);
  check(r.averaged && Math.abs(r.dc - r.mean) < 0.01, `DC readout ${r.dc.toFixed(1)} V is the average of the settled waveform (${r.mean.toFixed(1)} V), not the estimate ${r.estimate.toFixed(1)} V`);
  // manual mode: edits wait for the Simulate button
  await cad.getByRole("button", { name: "Live" }).click();
  await cad.evaluate(id => { const S = TubeCAD.state; S.comps.find(c => c.id === id).params.r = 2500; TubeCAD.commit(); }, ids.out);
  await cad.waitForTimeout(400);
  const idle = await cad.evaluate(() => ({ busy: TubeCAD.state.sim.busy, result: !!TubeCAD.state.sim.result, status: document.getElementById("status-sim").textContent }));
  check(!idle.busy && !idle.result && /press Simulate/.test(idle.status), `with Live off an edit waits for Simulate ("${idle.status}")`);
  await cad.getByRole("button", { name: /Simulate/ }).click();
  await done();
  const after = await cad.evaluate(() => ({ settled: TubeCAD.state.sim.result.tran.settled, status: document.getElementById("status-sim").textContent }));
  check(after.settled, `▶ Simulate runs until settled ("${after.status}")`);
  await cad.getByRole("button", { name: "Live" }).click();
  check(await cad.evaluate(() => TubeCAD.state.sim.live), "Live switches back on");
}

// --- 7. Catalog power transformer fed from an AC mains part: Hammond drawings --
{
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear(); S.view = { scale: 1, ox: 0, oy: 0 }; TubeCAD.commit(); });
  await cad.getByRole("button", { name: /^Power transformer \(catalog\)/ }).click();
  await clickAt(300, 300);
  const placed = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "ptx_cat"));
  const models = await cad.evaluate(() => Object.keys(CadLib.POWER_TX));
  check(placed && placed.params.model === "373BX" && models.length >= 20 && models.includes("370HX"), `catalog transformer placed; ${models.length} Hammond models to choose from`);
  // mains -> primary; RMS of HT1-CT, B-CT, HT2-CT with a load on HT1
  const measure = (params, load, vrms) => cad.evaluate(async ([id, params, load, vrms]) => {
    const C = TubeCAD, S = C.state, T0 = S.comps.find(c => c.id === id);
    Object.assign(T0.params, params);
    S.comps = [T0]; S.wires = [];
    const pin = (c, p) => C.compPins(c).find(q => q.id === p);
    const add = (type, prm, x, y, rot) => { const c = C.makeComp(type, prm, x, y, rot || 0); S.comps.push(c); return c; };
    const AC = add("mains", { vrms }, 200, 300);
    C.lRoute(pin(AC, "L").x, pin(AC, "L").y, pin(T0, "P1").x, pin(T0, "P1").y, true).forEach(s => C.addSegment(...s));
    C.lRoute(pin(AC, "N").x, pin(AC, "N").y, pin(T0, "P2").x, pin(T0, "P2").y, true).forEach(s => C.addSegment(...s));
    // T0 at (300, 300): HT1 (340, 260), B (340, 280), CT (340, 300), HT2 (340, 340)
    const g = add("ground", {}, 400, 420), R1 = add("resistor", { r: load }, 440, 280, 1), R2 = add("resistor", { r: 1e7 }, 460, 380, 1);
    const ct = pin(T0, "CT"), h1 = pin(T0, "HT1"), h2 = pin(T0, "HT2");
    C.addSegment(ct.x, ct.y, 400, ct.y); C.addSegment(400, ct.y, 400, 420);
    [[h1.x, h1.y, 360, h1.y], [360, h1.y, 360, 240], [360, 240, 440, 240], [440, 240, 440, 250], [440, 310, 440, 320], [440, 320, 400, 320]].forEach(w => C.addSegment(...w));
    C.addSegment(h2.x, h2.y, 460, h2.y); C.addSegment(460, h2.y, 460, 350); C.addSegment(460, 410, 460, 420); C.addSegment(400, 420, 460, 420);
    const B = pin(T0, "B");
    if (B) { const Rb = add("resistor", { r: 1e7 }, 520, 300, 1); C.addSegment(B.x, B.y, 520, B.y); C.addSegment(520, B.y, 520, 270); C.addSegment(520, 330, 520, 420); C.addSegment(460, 420, 520, 420); }
    const s0 = S.sim.seq; C.commit(); const t0 = performance.now();
    while ((S.sim.seq === s0 || S.sim.busy) && performance.now() - t0 < 30000) await new Promise(r => setTimeout(r, 50));
    if (!S.sim.result) return { error: S.sim.error };
    const T = C.topo(), tr = S.sim.result.tran, v = (c, p) => tr.nodes[T.pinNet.get(`${c.id}:${p}`)];
    const rms = (a, b) => { let q = 0; const n = a.length - 1; for (let i = 0; i < n; i++) q += (a[i] - b[i]) ** 2; return Math.sqrt(q / n); };
    const vc = v(T0, "CT");
    return { error: S.sim.error, ht1: rms(v(T0, "HT1"), vc), ht2: rms(v(T0, "HT2"), vc), bias: B ? rms(v(T0, "B"), vc) : null };
  }, [placed.id, params, load, vrms]);
  let m = await measure({ model: "373BX", tap: "230", bias: "yes" }, 1e7, 230);
  check(!m.error && Math.abs(m.ht1 / 370.3 - 1) < 0.005 && Math.abs(m.ht2 / 370.3 - 1) < 0.005 && Math.abs(m.bias / 52.19 - 1) < 0.005,
    `373BX, 230 V mains on the 230 V tap, no load: ${m.ht1 && m.ht1.toFixed(1)} / ${m.ht2 && m.ht2.toFixed(1)} Vrms per half, bias ${m.bias && m.bias.toFixed(2)} V (drawing: 370.3 V, 52.19 V)${m.error ? " " + m.error : ""}`);
  m = await measure({ model: "373BX", tap: "240", bias: "no" }, 1e7, 230);
  check(Math.abs(m.ht1 / (370.3 * 230 / 240) - 1) < 0.005, `230 V mains on the 240 V tap: ${m.ht1.toFixed(1)} V per half (370.3 × 230/240 = ${(370.3 * 230 / 240).toFixed(1)} V)`);
  m = await measure({ model: "370HX", tap: "120", bias: "no" }, 1e7, 120);
  check(Math.abs(m.ht1 / 290.9 - 1) < 0.005, `370HX, 120 V on the 120 V tap (primaries in parallel): ${m.ht1.toFixed(1)} V per half (drawing: 290.9 V)`);
  // a resistive load drops the voltage through the winding and the reflected primary resistance
  m = await measure({ model: "373BX", tap: "230", bias: "no" }, 2000, 230);
  const r = await cad.evaluate(() => { const h = CadLib.powerTx("373BX", 230); return h.rHalf + (h.rPri + 0.5) * Math.pow(h.nlv / h.tap, 2); });
  const expect = 370.3 * 2000 / (2000 + r);
  check(Math.abs(m.ht1 / expect - 1) < 0.01, `2 kΩ on one half: ${m.ht1.toFixed(1)} V, expected ${expect.toFixed(1)} V from 44.55 Ω winding + reflected primary (${r.toFixed(1)} Ω)`);
}

check(missing.length === 0, `every asset loads${missing.length ? `: ${missing.slice(0, 3).join(", ")}` : ""}`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
