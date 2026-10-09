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
  // the browser asks for /favicon.ico by itself (full Chrome does; the pages declare no icon): nothing to send
  if (/\/favicon\.ico$/.test(path)) { res.writeHead(204); return res.end(); }
  // read first, then answer: a missing file gets one 404, not a 200 header followed by a crash
  let body;
  try { body = await readFile(path); } catch { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" }); res.end(body);
}).listen(0);
const U = page => `http://localhost:${server.address().port}/${page}`;

let failures = 0;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: true });
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
check(R1 && R1.rot === 1 && C1 && C1.x === 500, "parts placed from the palette with letter codes (R1, C1), rotated with R, snapped to the grid");

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

{
  // shortcuts go by the physical key, so they work in a Cyrillic layout too (R types "к", M "ь", D "в", Z "я")
  const ru = (key, code, ctrl) => cad.evaluate(([key, code, ctrl]) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code, ctrlKey: !!ctrl, bubbles: true })), [key, code, ctrl]);
  await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); }, C1.id);
  const r0 = (await state()).comps.find(c => c.id === C1.id).rot, n0 = (await state()).comps.length;
  await ru("к", "KeyR"); const r1 = (await state()).comps.find(c => c.id === C1.id).rot;
  await ru("ь", "KeyM"); const f1 = (await state()).comps.find(c => c.id === C1.id).params.flip;
  await ru("в", "KeyD"); const n1 = (await state()).comps.length;
  await ru("я", "KeyZ", true); await ru("я", "KeyZ", true); await ru("я", "KeyZ", true);
  const back = (await state()).comps.find(c => c.id === C1.id);
  check(r1 === ((r0 + 1) & 3) && f1 === "yes" && n1 === n0 + 1 && back.rot === r0 && back.params.flip !== "yes" && (await state()).comps.length === n0,
    "with a Russian keyboard layout R rotates, M mirrors, D duplicates and Ctrl+Z undoes (keys go by physical position)");
}
await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); TubeCAD.commit(); }, R1.id);
const field = cad.locator("#inspector .row", { hasText: "Resistance" }).locator("input");
await field.fill("4.7k"); await field.press("Enter");
check((await state()).comps.find(c => c.id === R1.id).params.r === 4700, 'inspector parses "4.7k" as 4700 Ω');
// signal generator: the amplitude can be typed as Vpk, Vrms or dBV and the other two follow
const GEN = await cad.evaluate(() => { const C = TubeCAD, S = C.state, g = C.makeComp("siggen", {}, 600, 300, 0); S.comps.push(g); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(g.id); C.commit(); return g.id; });
const genRow = t => cad.locator("#inspector .row", { hasText: t }).locator("input");
await genRow("dBV").fill("-20"); await genRow("dBV").press("Enter");
let gp = (await state()).comps.find(c => c.id === GEN).params;
check(Math.abs(gp.amp - 0.1 * Math.SQRT2) < 1e-9, "−20 dBV on a sine generator sets 141 mVpk");
check(/^100m/.test(await genRow("Vrms").inputValue()), "the Vrms field follows the dBV entry");
await genRow("Vrms").fill("2"); await genRow("Vrms").press("Enter");
check(await genRow("dBV").inputValue() === "6.02", "2 Vrms shows as 6.02 dBV");
await cad.locator("#inspector .row", { hasText: "Waveform" }).locator("select").selectOption("square");
check(await genRow("dBV").inputValue() === "9.03", "a square wave of the same peak reads 3 dB hotter");
await cad.evaluate(id => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.id !== id); TubeCAD.commit(); }, GEN);
// File → Open keeps the file, Save asks before it overwrites it, Save as writes a new one
await cad.evaluate(() => {
  const json = JSON.stringify({ app: "TubeAmpCAD", version: 2, comps: TubeCAD.state.comps, wires: TubeCAD.state.wires });
  window.__writes = [];
  const fake = name => ({ name, getFile: async () => new File([json], name, { type: "application/json" }),
    createWritable: async () => { let buf = ""; return { write: async t => { buf += t; }, close: async () => { window.__writes.push({ name, text: buf }); } }; } });
  window.showOpenFilePicker = async () => [fake("amp.json")];
  window.showSaveFilePicker = async o => { window.__saveAsSuggested = o.suggestedName; return fake("copy.json"); };
});
await cad.click("#btn-file"); await cad.click("#btn-open");
await cad.waitForFunction(() => /^amp\.json/.test(document.title));
await cad.keyboard.press("Control+s");
check(await cad.isVisible("#save-modal") && /Overwrite amp\.json/.test(await cad.textContent("#save-msg")), "Save on an opened file asks before overwriting it");
await cad.click("#btn-save-cancel");
check((await cad.evaluate(() => window.__writes.length)) === 0, "Cancel leaves the file alone");
await cad.click("#btn-file"); await cad.click("#btn-save"); await cad.click("#btn-save-ok");
await cad.waitForFunction(() => window.__writes.length === 1);
const wr = await cad.evaluate(() => window.__writes[0]);
check(wr.name === "amp.json" && JSON.parse(wr.text).comps.length === (await state()).comps.length, "Overwrite writes the circuit back to the opened file");
await cad.keyboard.press("Control+Shift+s");
await cad.waitForFunction(() => window.__writes.length === 2);
check((await cad.evaluate(() => [window.__saveAsSuggested, window.__writes[1].name, document.title])).join("|").startsWith("amp.json|copy.json|copy.json"), "Save as (Ctrl+Shift+S) suggests the current name, writes the new file and makes it the current one");
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
check((await state()).comps.some(c => c.params.r === 4700), "circuit survives a reload (autosave)");

// a stored circuit whose wire ends on another wire's middle (a T joint) loads with the joint
// connected, as File → Open does: a cap teed onto the line between two resistors
const saved = await cad.evaluate(() => localStorage.getItem("tubecad_circuit_v2"));
await cad.evaluate(() => localStorage.setItem("tubecad_circuit_v2", JSON.stringify({
  comps: [{ id: "ra", type: "resistor", x: 100, y: 100, rot: 0, params: { r: 1000 }, label: "R1" },
    { id: "rb", type: "resistor", x: 300, y: 100, rot: 0, params: { r: 1000 }, label: "R2" },
    { id: "ca", type: "capacitor", x: 200, y: 200, rot: 1, params: { c: 1e-6 }, label: "C1" }],
  wires: [{ id: "w1", x1: 130, y1: 100, x2: 270, y2: 100 }, { id: "w2", x1: 200, y1: 100, x2: 200, y2: 180 }] })));
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
check(await sameNet("ra:2", "ca:1") && await sameNet("rb:1", "ca:1"), "a stored circuit with a T joint loads connected (same as File → Open)");
await cad.evaluate(s => { localStorage.setItem("tubecad_circuit_v2", s); }, saved);
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);

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
// the inspector's Checks heading carries the readiness while the run is going, and drops it after
await cad.bringToFront(); await cad.mouse.click(5, 5); await cad.keyboard.press("Escape");   // deselect (no edit, so no new run)
await cad.waitForFunction(() => !TubeCAD.state.sim.busy && document.querySelector("#inspector .insp-title").textContent === "Circuit", null, { timeout: 30000 }).catch(() => {});
await cad.evaluate(() => { window.__pct = []; new MutationObserver(() => document.querySelectorAll("#inspector .sim-pct").forEach(e => window.__pct.push(e.textContent))).observe(document.getElementById("inspector"), { subtree: true, childList: true, characterData: true }); });
// a simulation reports its readiness to the tool windows while it runs
await scope.evaluate(() => { window.__st = []; const bc = new BroadcastChannel("tube_cad_v2"); bc.onmessage = e => { if (e.data && e.data.type === "SIM_STATUS") window.__st.push(e.data); }; });
await cad.evaluate(() => TubeCAD.runSim("full"));
await scope.waitForFunction(() => window.__st.some(s => !s.busy), null, { timeout: 30000 }).catch(() => {});
const sts = await scope.evaluate(() => window.__st.filter(s => s.busy && typeof s.progress === "number").map(s => [s.progress, s.text]));
check(sts.length >= 1 && sts.every(([p, t]) => p >= 0 && p <= 1 && (p === 0 || /\d+ %$/.test(t))) && sts.every(([p], i) => !i || p >= sts[i - 1][0]),
  `the tool windows get the simulation's readiness (${sts.map(([, t]) => t.replace(/^.*: /, "")).join(", ")})`);
await cad.waitForFunction(() => !TubeCAD.state.sim.busy, null, { timeout: 30000 }).catch(() => {});
const pcts = await cad.evaluate(() => [...new Set(window.__pct)]);
check(pcts.length >= 1 && pcts.every(t => /^\d+ %$/.test(t)) && !(await cad.$("#inspector .sim-pct")), `the inspector's Checks heading shows the readiness during the run (${pcts.join(", ")}) and drops it when done`);
// "1.23Vrms AC (1.8 dBV)": each channel's dBV agrees with its RMS value
const engV = s => parseFloat(s) * ({ m: 1e-3, "µ": 1e-6, k: 1e3 }[s.replace(/^[-\d.]+/, "")[0]] || 1);
const dbvPairs = [...meas.matchAll(/([-\d.]+[mµk]?)Vrms AC \(([−\d.]+) dBV\)/g)].map(x => [engV(x[1]), parseFloat(x[2].replace("−", "-"))]);
check(dbvPairs.length === 2 && dbvPairs.every(([v, d]) => Math.abs(20 * Math.log10(v) - d) < 0.1), `scope shows each channel in dBV (${dbvPairs.map(([v, d]) => v.toPrecision(3) + " Vrms = " + d + " dBV").join(", ")})`);

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
  const sfoot = await spectrum.textContent("#foot"), fm = sfoot.match(/([-\d.]+[mµk]?)Vrms \(([−\d.]+) dBV\)/);
  check(fm && Math.abs(20 * Math.log10(engV(fm[1])) - parseFloat(fm[2].replace("−", "-"))) < 0.1, `analyzer gives the fundamental in dBV (${fm && fm[0]})`);
  check(/A 1kHz \(F\): [−\d.]+ dBc · [−\d.]+ dBV/.test(await spectrum.textContent("#marks")), "analyzer markers in dBc also read dBV");
  check(Math.abs(m[1].reading.dbc - h2) < 0.06, `marker B reads H2 at ${m[1].reading.dbc.toFixed(2)} dBc, as the harmonic table (${h2} dBc)`);
}

// --- 3a2. Mouse zoom on the scope and the analyzer ---------------------------------
{
  const r = await scope.locator("#screen").boundingBox(), cx = r.x + r.width * 0.3, cy = r.y + r.height / 2;
  const before = await scope.evaluate(() => window.Scope.view().tdiv);
  const ax0 = await scope.evaluate(() => window.Scope.axes());
  const tval = t => { const m = /^(-?[\d.]+)([kmµn]?)s$/.exec(t); return m ? +m[1] * { k: 1e3, "": 1, m: 1e-3, "µ": 1e-6, n: 1e-9 }[m[2]] : NaN; };
  check(ax0 && ax0.h.length === 11 && ax0.left.length === 9 && ax0.right.length === 9 && Math.abs(tval(ax0.h[10]) - tval(ax0.h[0]) - 10 * before) < before * 0.01 && /V$/.test(ax0.left[0]),
    `scope: time axis (${ax0 && ax0.h[0]} … ${ax0 && ax0.h[10]}) and volt axes for CH1 (${ax0 && ax0.left[0]} … ${ax0 && ax0.left[8]}) and CH2 (${ax0 && ax0.right[0]} … ${ax0 && ax0.right[8]})`);
  check(ax0 && new Set(ax0.left).size === 9 && new Set(ax0.h).size === 11, "scope: neighbouring axis labels never print alike");
  await scope.mouse.move(cx, cy); await scope.mouse.wheel(0, -100);
  const after = await scope.evaluate(() => ({ tdiv: +window.Scope.state.tdiv, hpos: window.Scope.state.hpos }));
  const ax1 = await scope.evaluate(() => window.Scope.axes());
  // after zooming at the pointer the window starts between steps: labels stay at round multiples of the new time/div, inside the window
  check(ax1.hv.length >= 10 && ax1.hv.every(v => Math.abs(v / after.tdiv - Math.round(v / after.tdiv)) < 1e-6 && v >= after.hpos - after.tdiv * 0.01 && v <= after.hpos + 10.01 * after.tdiv) && ax1.h.every(t => Math.abs(tval(t) / after.tdiv - Math.round(tval(t) / after.tdiv)) < 1e-3),
    `scope: the time axis follows the zoom at round values (${ax1.h[0]} … ${ax1.h[ax1.h.length - 1]}, window from ${(after.hpos * 1e3).toFixed(4)} ms)`);
  check(after.tdiv < before && after.hpos > 0, `scope: the wheel zooms in on the time axis at the pointer (${before * 1e6} → ${after.tdiv * 1e6} µs/div, position ${(after.hpos * 1e6).toFixed(0)} µs)`);
  const v0 = await scope.evaluate(() => window.Scope.view().ch1.vdiv);
  await scope.keyboard.down("Control"); await scope.mouse.wheel(0, -100); await scope.keyboard.up("Control");
  const v1 = await scope.evaluate(() => window.Scope.view().ch1.vdiv);
  check(v1 < v0, `scope: Ctrl+wheel steps volts/div (${v0} → ${v1} V/div)`);
  const ax2 = await scope.evaluate(() => window.Scope.axes());
  check(ax2.left.join() !== ax1.left.join(), `scope: the CH1 volt axis follows volts/div (${ax1.left[0]} → ${ax2.left[0]} at the top)`);
  await scope.mouse.down({ button: "right" }); await scope.mouse.move(cx + 100, cy, { steps: 4 }); await scope.mouse.up({ button: "right" });
  const h2 = await scope.evaluate(() => window.Scope.state.hpos);
  check(h2 < after.hpos, `scope: right-drag moves the trace along the time axis (position ${(h2 * 1e6).toFixed(0)} µs)`);
  check((await scope.evaluate(() => window.Scope.markers())).length === 0, "scope: zooming and dragging place no markers");
  await scope.click("#btn-autoset");
  const reset = await scope.evaluate(() => ({ tdiv: window.Scope.state.tdiv, hpos: window.Scope.state.hpos }));
  check(reset.tdiv === "auto" && reset.hpos === 0, "scope: Autoset resets the zoom and position");
}
{
  const r = await spectrum.locator("#screen").boundingBox(), p1 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000));
  await spectrum.mouse.move(r.x + p1.x, r.y + r.height / 2);
  for (let i = 0; i < 4; i++) await spectrum.mouse.wheel(0, -100);
  const z = await spectrum.evaluate(() => window.Spectrum.state.zoom), p2 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000));
  check(z && z.fb - z.fa < 6000 && z.fa < 2000 && z.fb > 2000 && Math.abs(p2.x - p1.x) < 3, `analyzer: the wheel zooms the frequency axis around the pointer (${z && z.fa.toFixed(0)}–${z && z.fb.toFixed(0)} Hz, H2 stays under the pointer)`);
  await spectrum.keyboard.down("Control"); await spectrum.mouse.wheel(0, -300); await spectrum.keyboard.up("Control");
  const z2 = await spectrum.evaluate(() => window.Spectrum.state.zoom);
  check(z2.top - z2.bottom < 100, `analyzer: Ctrl+wheel zooms the level axis (${(z2.top - z2.bottom).toFixed(0)} dB shown)`);
  await spectrum.click("#zoom-reset");
  check(await spectrum.evaluate(() => window.Spectrum.state.zoom === null), "analyzer: Reset zoom shows the whole span");
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
check(title.includes("12AX7") && title.includes("VL1 in circuit"), `clicking VL1 in the CAD shows it on the curve tracer ("${title.trim()}")`);
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
  // the legend names everything drawn: with every option on and A, B picked
  for (const id of ["opt-bias", "opt-pa", "opt-pa70", "opt-traj"]) if (!(await tracer.isChecked("#" + id))) await tracer.check("#" + id);
  const legend = await tracer.evaluate(() => [...document.querySelectorAll("#legend span")].map(s => s.textContent));
  const want = [/^Plate curves/, /^Curve at circuit bias/, /^Operating point/, /^Pa max/, /^Over Pa max/, /^70% of Pa max/, /^Picked points A, B/, /^Line through A and B/];
  check(want.every(r => legend.some(t => r.test(t))), `the legend explains every line drawn (${legend.join(" | ")})`);
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

{
  // mouse zoom on the curves: in at the pointer, pan with right-drag, Reset zoom
  const r = await tracer.locator("#plot").boundingBox(), full = await tracer.evaluate(() => TubeTracer.view());
  const pt = await tracer.evaluate(() => TubeTracer.toScreen(250, 0.05));
  await tracer.mouse.move(r.x + pt.x, r.y + pt.y);
  for (let i = 0; i < 3; i++) await tracer.mouse.wheel(0, -100);
  const z = await tracer.evaluate(() => TubeTracer.view()), pt2 = await tracer.evaluate(() => TubeTracer.toScreen(250, 0.05));
  check(z.v1 - z.v0 < full.vaMax * 0.6 && z.i1 - z.i0 < full.iaMax * 0.6 && Math.hypot(pt2.x - pt.x, pt2.y - pt.y) < 2 && await tracer.isVisible("#btn-zoom-reset"),
    `tracer: the wheel zooms in around the pointer (Va ${z.v0.toFixed(0)}–${z.v1.toFixed(0)} V, Ia ${(z.i0 * 1e3).toFixed(0)}–${(z.i1 * 1e3).toFixed(0)} mA)`);
  await tracer.mouse.down({ button: "right" }); await tracer.mouse.move(r.x + pt.x + 80, r.y + pt.y, { steps: 4 }); await tracer.mouse.up({ button: "right" });
  const zp = await tracer.evaluate(() => TubeTracer.view());
  check(zp.v0 < z.v0 && Math.abs((zp.v1 - zp.v0) - (z.v1 - z.v0)) < 1e-6, `tracer: right-drag pans (Va ${zp.v0.toFixed(0)}–${zp.v1.toFixed(0)} V)`);
  check((await tracer.evaluate(() => TubeTracer.picks())).length === 1, "tracer: zooming and panning place no points");
  for (const [name, page] of [["tracer", tracer], ["scope", scope], ["analyzer", spectrum]]) {
    const hidden = !(await page.isVisible(".pz-pop"));
    await page.hover(".pz-chip");
    const txt = await page.textContent(".pz-pop");
    check(hidden && await page.isVisible(".pz-pop") && /Wheel/.test(txt) && /Ctrl \+ wheel/.test(txt) && /Right-drag/.test(txt), `${name}: hovering the Zoom chip lists the mouse controls`);
    await page.mouse.move(0, 0);
  }
  await tracer.click("#btn-zoom-reset");
  const back = await tracer.evaluate(() => TubeTracer.view());
  check(back.v0 === 0 && back.v1 === full.vaMax && back.i1 === full.iaMax && !(await tracer.isVisible("#btn-zoom-reset")), "tracer: Reset zoom shows the whole plot");
}

// --- 5. A ganged changeover switch, flipped with a double-click --------------
{
  // two sections, S1.1 and S1.2, each choosing between two loads on its own 10 V supply
  const ids = await cad.evaluate(async () => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const out = [];
    for (const [i, x0] of [[1, 200], [2, 600]]) {
      const B = add("vdc", { v: 10 }, x0, 300), SW = add("switch", {}, x0 + 100, 240);
      SW.label = `S1.${i}`;
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
  check(r.every(k => k.pos === "B" && Math.abs(k.vb - 10) < 0.01 && Math.abs(k.va) < 0.01), `double-click on S1.1 flips both sections to B: ${r.map(k => `${k.va.toFixed(2)} V / ${k.vb.toFixed(2)} V`).join(", ")}`);
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
  await cad.getByRole("button", { name: /^Power 300/ }).click();
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

// --- 8. IEC 61082 sheet, letter-code designations ---------------------------
{
  await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    // placed out of reading order, with a dual triode in two sections
    add("resistor", {}, 600, 300); add("resistor", {}, 200, 400); add("resistor", {}, 200, 200);
    const a = add("tube", { tube: "12AX7" }, 500, 300), b = add("tube", { tube: "12AX7" }, 300, 300); a.label = "X.2"; b.label = "X.1";
    add("tube", { tube: "5Ts4S" }, 100, 300); add("electrolytic", {}, 400, 500); add("inductor", {}, 450, 500);
    S.view = { scale: 0.25, ox: 40, oy: 40 }; C.commit();
  });
  await cad.getByRole("button", { name: /Renumber designations/ }).click();
  const labels = await cad.evaluate(() => TubeCAD.state.comps.map(c => [c.type, c.x, c.y, c.label, TubeCAD.desig(c)]));
  const at = (x, y) => labels.find(l => l[1] === x && l[2] === y);
  // classic letter codes: R resistors, L chokes, C capacitors, VL every tube (rectifiers too)
  check(at(200, 200)[3] === "R1" && at(200, 400)[3] === "R2" && at(600, 300)[3] === "R3" && at(450, 500)[3] === "L1", `resistors numbered in reading order, the choke is L1: ${labels.filter(l => /^[RL]\d/.test(l[3])).map(l => l[3]).sort().join(" ")}`);
  check(at(100, 300)[3] === "VL1" && at(300, 300)[3] === "VL2.1" && at(500, 300)[3] === "VL2.2", `tubes are VL (rectifier VL1); dual triode sections stay one object (VL2.1, VL2.2)`);
  check(at(400, 500)[3] === "C1" && at(200, 200)[4] === "R1", `capacitor C1; designations shown as R1, no prefix`);
  // drawing frame: placed from the palette, selectable by its title block only
  await cad.getByRole("button", { name: /Drawing frame/ }).click();
  await clickAt(0, 0);
  const fr = await cad.evaluate(() => { const f = TubeCAD.state.comps.find(c => c.type === "frame"); const g = CadLib.sheetGeom(f); return { id: f.id, x: f.x, y: f.y, g }; });
  check(fr.g.cols === 11 && fr.g.rows === 8, `A2 frame with an 11 × 8 reference grid (50 mm zones)`);
  await cad.keyboard.press("Escape");
  await clickAt(200, 200);
  const sel1 = await cad.evaluate(() => [...TubeCAD.state.sel.comps].map(id => TubeCAD.state.comps.find(c => c.id === id).type));
  await clickAt(fr.x + fr.g.tb.x1 + 40, fr.y + fr.g.tb.y1 + 40);
  const sel2 = await cad.evaluate(() => [...TubeCAD.state.sel.comps].map(id => TubeCAD.state.comps.find(c => c.id === id).type));
  check(sel1.join() === "resistor" && sel2.join() === "frame", `a click inside the sheet picks the part (${sel1}); the title block picks the frame (${sel2})`);
  const title = cad.locator("#inspector .row", { hasText: /^Title/ }).locator("input");
  await title.fill("Test amplifier"); await title.press("Enter");
  check(await cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "frame").params.title) === "Test amplifier", "title block field edited in the inspector");
  check(await cad.evaluate(() => !TubeCAD.buildNetlist().elements.some(e => /frame/.test(e.id))), "the frame adds nothing to the simulation");
}

// --- 9. Oscilloscope: ▶ Simulate and the power-on transient -----------------------
{
  // 100 V switched onto 10 kΩ + 10 µF (τ = 0.1 s); the scope watches the capacitor
  const ids = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const B = add("vdc", { v: 100 }, 200, 300), R = add("resistor", { r: 10e3 }, 300, 240), Cc = add("electrolytic", { c: 10e-6 }, 400, 300, 1), SC = add("scope", {}, 620, 300), g = add("ground", {}, 200, 400);
    wire(pin(B, "+"), pin(R, "1")); wire(pin(R, "2"), { x: 400, y: 240 }); wire({ x: 400, y: 240 }, pin(Cc, "+"));
    wire(pin(SC, "CH1"), { x: 400, y: 270 }, true);
    wire(pin(B, "-"), pin(g, "G")); wire(pin(Cc, "-"), { x: 400, y: 400 }); wire({ x: 400, y: 400 }, pin(g, "G")); wire(pin(SC, "COM"), { x: 520, y: 330 }, true); wire({ x: 520, y: 330 }, { x: 520, y: 400 }); wire({ x: 520, y: 400 }, { x: 400, y: 400 });
    S.view = { scale: 1, ox: 0, oy: 0 }; C.commit();
    return { scope: SC.id };
  });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 30000 });
  const sp = await open("scope-tran", `oscilloscope.html?scope=${ids.scope}`);
  await sp.waitForFunction(() => /Live from CAD/.test(document.getElementById("status").textContent), null, { timeout: 8000 });
  // ▶ Simulate in steady state asks the CAD for a full run
  const seq0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await sp.click("#btn-sim");
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq > s0 && !TubeCAD.state.sim.busy, seq0, { timeout: 30000 });
  const st = await sp.evaluate(() => document.getElementById("status").textContent);
  check(/Simulated in/.test(st), `▶ Simulate on the oscilloscope runs the CAD's simulation until settled; the scope shows it ("${st}")`);
  // power-on: 0.5 s
  await sp.click('#analysis .btn[data-v="startup"]');
  await sp.selectOption("#t-stop", "0.5");
  await sp.click("#btn-sim");
  await sp.waitForFunction(() => Instrument.transient && !Instrument.transient.running && Instrument.transient.ok, null, { timeout: 60000 });
  const tr = await sp.evaluate(() => {
    const t = Instrument.transient, ch = Scope.startupChannels(Instrument.transientScope()).ch1, q = Scope.settleInfo(ch, t.dt);
    const at = s => ch.raw[Math.round(s / t.dt - 0.5)];
    return { at0: at(0.0005), atTau: at(0.1), final: q.final, settle: q.settle, meas: document.getElementById("meas").textContent, status: document.getElementById("status").textContent };
  });
  const exp = s => 100 * (1 - Math.exp(-s / 0.1));
  check(Math.abs(tr.atTau - exp(0.1)) < 1.5 && Math.abs(tr.final - exp(0.4875)) < 1 && tr.at0 < 2,
    `power-on RC charge: ${tr.atTau.toFixed(1)} V at τ (63.2 V), ${tr.final.toFixed(1)} V at the end (${exp(0.4875).toFixed(1)} V)`);
  check(/final/.test(tr.meas) && Math.abs(tr.settle - 0.1 * Math.log(1 / 0.02 * (1 - Math.exp(-4.875)))) < 0.04, `settling readout: ${tr.meas.trim()}`);
  // a marker on the record reads time and voltage
  const box = await sp.locator("#screen").boundingBox();
  const p = await sp.evaluate(() => Scope.screenPoint("ch1", 0.2));
  await sp.mouse.click(box.x + p.x, box.y + p.y);
  const mk = await sp.evaluate(() => Scope.markers()[0] && Scope.markers()[0].reading);
  check(mk && Math.abs(mk.t - 0.1) < 0.005 && Math.abs(mk.v - exp(mk.t)) < 1.5, `marker on the power-on record: ${mk && mk.v.toFixed(1)} V at ${mk && (mk.t * 1000).toFixed(1)} ms`);
  // zoom with the wheel, scroll with the overview strip
  const v0 = await sp.evaluate(() => Scope.startupView());
  const sb = await sp.locator("#screen").boundingBox();
  await sp.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  for (let i = 0; i < 3; i++) await sp.mouse.wheel(0, -100);
  const v1 = await sp.evaluate(() => Scope.startupView());
  const ob = await sp.locator("#overview").boundingBox();
  await sp.mouse.click(ob.x + 26 + (ob.width - 52) * 0.75, ob.y + ob.height / 2);
  const v2 = await sp.evaluate(() => Scope.startupView());
  check(v1.span < v0.span / 4 && Math.abs(v2.pos + v2.span / 2 - 0.375) < 0.02, `wheel zooms in (${(v0.span * 1000).toFixed(0)} → ${(v1.span * 1000).toFixed(0)} ms window), the overview strip scrolls (window at ${(v2.pos * 1000).toFixed(0)} ms)`);
  // editing the circuit marks the record stale
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps.find(c => c.type === "resistor").params.r = 20e3; TubeCAD.commit(); });
  await sp.waitForFunction(() => Instrument.transient && Instrument.transient.stale, null, { timeout: 5000 }).catch(() => {});
  check(await sp.evaluate(() => !!Instrument.transient.stale), "editing the circuit marks the power-on record as changed");
  await sp.close();
}

// --- 10. An instrument window tells when the CAD does not answer -----------------
{
  // a separate browser context: no CAD tab at all
  const c2 = await browser.newContext();
  const lone = await c2.newPage();
  await lone.goto(U("oscilloscope.html"));
  await lone.click("#btn-sim");
  await lone.waitForFunction(() => /No Circuit CAD is open/.test(document.getElementById("status").textContent), null, { timeout: 5000 }).catch(() => {});
  check(/No Circuit CAD is open/.test(await lone.textContent("#status")), `without a CAD, ▶ Simulate says so ("${(await lone.textContent("#status")).trim()}")`);
  // a CAD of another version (e.g. a tab opened before an update) is reported
  const fake = await c2.newPage();
  await fake.goto(U("markers.js"));   // any same-origin page to post from
  await fake.evaluate(() => new BroadcastChannel("tube_cad_v2").postMessage({ type: "SIM_RESULT", version: "?v=0.0.1", ok: false, error: "x", scopes: [] }));
  await lone.waitForFunction(() => /another version/.test(document.getElementById("status").textContent), null, { timeout: 5000 }).catch(() => {});
  check(/another version/.test(await lone.textContent("#status")), "a CAD tab of another version is reported");
  await c2.close();
}

// --- 11. One window per tool: buttons bring the open window to the front ----------
{
  const opened = [];
  const onPage = p => opened.push(p);
  ctx.on("page", onPage);
  const two = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
    const a = C.makeComp("scope", {}, 300, 300, 0), b = C.makeComp("scope", {}, 300, 500, 0); S.comps.push(a, b); C.commit(); return [a.id, b.id];
  });
  await cad.getByRole("button", { name: /Oscilloscope ↗/ }).click();
  await cad.waitForTimeout(800);
  await cad.getByRole("button", { name: /Oscilloscope ↗/ }).click();
  await cad.waitForTimeout(800);
  check(opened.length === 1, `the toolbar's Oscilloscope button twice opens one window (${opened.length})`);
  const win = opened[0];
  await win.waitForFunction(() => window.Instrument, null, { timeout: 8000 }).catch(() => {});
  // double-clicking the second scope part on the sheet switches the open window to it
  const sc2 = await cad.evaluate(id => { const S = TubeCAD.state, c = S.comps.find(k => k.id === id), r = document.getElementById("cad").getBoundingClientRect(); return [r.left + c.x * S.view.scale + S.view.ox, r.top + c.y * S.view.scale + S.view.oy]; }, two[1]);
  await cad.mouse.dblclick(sc2[0], sc2[1]);
  await win.waitForFunction(id => Instrument.scopeId === id, two[1], { timeout: 5000 }).catch(() => {});
  check(opened.length === 1 && await win.evaluate(id => Instrument.scopeId === id && new URL(location.href).searchParams.get("scope") === id, two[1]), "double-clicking another scope part switches the open oscilloscope instead of opening a new one");
  ctx.off("page", onPage);
  await win.close();
}

// --- 12. File menu: New with a drawing frame, Save as PDF --------------------------
{
  await cad.locator("#btn-file").click();
  check(await cad.locator(".menu-list").isVisible(), "File menu opens");
  await cad.getByRole("menuitem", { name: /New/ }).click();
  await cad.locator('#new-size .btn[data-v="A4"]').click();
  await cad.locator('#new-orient .btn[data-v="portrait"]').click();
  await cad.locator("#new-title").fill("Test stage");
  await cad.locator("#btn-new-create").click();
  const f = await cad.evaluate(() => { const S = TubeCAD.state, fr = S.comps.find(c => c.type === "frame"); return fr && { n: S.comps.length, w: S.wires.length, p: fr.params, g: CadLib.sheetGeom(fr) }; });
  check(f && f.n === 1 && f.w === 0 && f.p.size === "A4" && f.p.orient === "portrait" && f.p.title === "Test stage" && f.g.W === 210 * 4 && f.g.H === 297 * 4 && f.g.tb.x2 - f.g.tb.x1 === 180 * 4,
    `New… creates an empty sheet with an A4 portrait frame (${f && f.g.W / 4} × ${f && f.g.H / 4} mm, title block ${f && (f.g.tb.x2 - f.g.tb.x1) / 4} mm wide)`);
  await cad.evaluate(() => { const S = TubeCAD.state, C = TubeCAD; const r = C.makeComp("resistor", { r: 4700 }, 400, 400, 0); S.comps.push(r); C.commit(); });
  const pdf = await cad.evaluate(() => { const b = TubeCAD.exportPDF(false); let s = ""; for (const c of b) s += String.fromCharCode(c); return s; });
  const xref = +pdf.match(/startxref\n(\d+)/)[1];
  const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  check(pdf.startsWith("%PDF-1.4") && /\/MediaBox \[0 0 595.276 841.89\]/.test(pdf) && pdf.slice(xref, xref + 4) === "xref" && offs.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)),
    `Save as PDF: a valid A4 portrait PDF (${pdf.length} bytes, ${offs.length} objects, cross-reference table checks out)`);
  check(/\(R1\) Tj/.test(pdf) && /\(Test stage\) Tj/.test(pdf) && /\/BaseFont \/Courier/.test(pdf) && !/rgb|#/.test(pdf.slice(0, xref).replace(/\/Title \([^)]*\)/, "")),
    "the PDF holds the drawing as vector paths and text (designation R1, title block), black on white");
}

// --- 13. Several sheets, joined by sheet connectors -------------------------------
{
  // the A4 portrait sheet from section 12 holds R1; add a second sheet from the File menu
  await cad.locator("#btn-file").click();
  await cad.getByRole("menuitem", { name: /Add sheet/ }).click();
  check(await cad.locator("#new-modal .insp-title").textContent() === "Add sheet", "File → Add sheet… opens the format dialog for a further sheet");
  await cad.locator('#new-size .btn[data-v="A4"]').click();
  await cad.locator('#new-orient .btn[data-v="landscape"]').click();
  await cad.locator("#new-title").fill("Output stage");
  await cad.locator("#btn-new-create").click();
  const sh = await cad.evaluate(() => TubeCAD.frames().map(f => ({ x: f.x, y: f.y, sheet: f.params.sheet, title: f.params.title, size: f.params.size, orient: f.params.orient, w: CadLib.sheetGeom(f).W })));
  check(sh.every(f => f.x % 10 === 0 && f.y % 10 === 0), `sheets lie on the drawing grid (x ${sh.map(f => f.x).join(", ")})`);
  check(sh.length === 2 && sh[0].sheet === "1/2" && sh[1].sheet === "2/2" && sh[1].x >= sh[0].x + sh[0].w && sh[1].y === sh[0].y && sh[1].title === "Output stage" && sh[1].orient === "landscape",
    `the new sheet sits right of sheet 1 and both are numbered (${sh.map(s => s.sheet).join(", ")})`);
  const nav = await cad.evaluate(() => { const n = document.getElementById("sheet-nav"); return { hidden: n.hidden, opts: [...n.options].map(o => o.textContent) }; });
  check(!nav.hidden && nav.opts.length === 3 && /^Sheet 2 · Output stage/.test(nav.opts[2]), `the Sheet selector lists both sheets (${nav.opts.join(" | ")})`);
  // Fit fits the sheet you are on: the one holding the selection, else the one clicked last,
  // else the one filling most of the view; pressed again on a fitted sheet it shows all sheets
  const view = () => cad.evaluate(() => ({ ...TubeCAD.state.view }));
  const same = (a, b) => Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.ox - b.ox) < 0.5 && Math.abs(a.oy - b.oy) < 0.5;
  const ids = await cad.evaluate(() => TubeCAD.frames().map(f => f.id));
  const forget = () => cad.evaluate(() => { const S = TubeCAD.state; S.lastClick = null; S.sel.comps.clear(); S.sel.wires.clear(); });
  await cad.locator("#sheet-nav").selectOption(ids[0]); const v1 = await view();
  await cad.locator("#sheet-nav").selectOption(ids[1]); const v2 = await view();
  await cad.locator("#sheet-nav").selectOption(""); const vAll = await view();
  // looking at sheet 2 (panned a little off), nothing chosen in the list or clicked
  await cad.locator("#sheet-nav").selectOption(ids[1]); await forget();
  await cad.evaluate(() => { const v = TubeCAD.state.view; v.ox += 60; v.scale *= 1.1; document.getElementById("sheet-nav").value = ""; });
  await cad.locator("#btn-zoom-fit").click();
  const looked = await view();
  await cad.keyboard.press("f");
  const again = await view();
  // all sheets in view: a click on sheet 2, then F
  await forget();
  const p1 = await cad.evaluate(id => { const f = TubeCAD.state.comps.find(c => c.id === id), v = TubeCAD.state.view, r = document.getElementById("cad").getBoundingClientRect();
    return { x: r.left + (f.x + 40) * v.scale + v.ox, y: r.top + (f.y + 40) * v.scale + v.oy }; }, ids[1]);
  await cad.mouse.click(p1.x, p1.y); await cad.keyboard.press("Escape");
  await cad.keyboard.press("f");
  const clicked = await view();
  // a part selected on sheet 1 wins over the click on sheet 2
  const onSheet1 = await cad.evaluate(id => { const S = TubeCAD.state;
    const part = S.comps.find(c => c.type !== "frame" && (TubeCAD.zoneOf(c.x, c.y) || {}).frame?.id === id); if (part) S.sel.comps.add(part.id); return !!part; }, ids[0]);
  await cad.keyboard.press("f");
  const selected = await view();
  await forget();
  check(onSheet1 && same(looked, v2) && same(again, vAll) && same(clicked, v2) && same(selected, v1) && !same(v1, v2) && !same(v2, vAll),
    "Fit (button or F) fits the sheet in view, the clicked one, or the one with the selection; again on a fitted sheet shows all sheets");
  // a 300 V supply on sheet 1 feeds a 1 kΩ load on sheet 2 through two "+B" connectors
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, [f1, f2] = C.frames();
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, rot) => { const c = C.makeComp(t, p, x, y, rot || 0); S.comps.push(c); return c; };
    const v = add("vdc", { v: 300 }, f1.x + 300, f1.y + 300), g1 = add("ground", {}, f1.x + 300, f1.y + 330);
    const k1 = add("offsheet", { name: "+B" }, f1.x + 400, f1.y + 270, 0);
    const k2 = add("offsheet", { name: "+b " }, f2.x + 200, f2.y + 270, 2), load = add("resistor", { r: 1000 }, f2.x + 300, f2.y + 300, 1), g2 = add("ground", {}, f2.x + 300, f2.y + 330);
    S.wires.push({ id: "wa", x1: f1.x + 300, y1: f1.y + 270, x2: f1.x + 400, y2: f1.y + 270 }, { id: "wb", x1: f2.x + 200, y1: f2.y + 270, x2: f2.x + 300, y2: f2.y + 270 });
    C.commit();
    const T = C.topo();
    return { same: T.pinNet.get(v.id + ":+") === T.pinNet.get(load.id + ":1"), net: T.pinNet.get(load.id + ":1"), refs1: C.connRefs(k1), refs2: C.connRefs(k2), zone: C.zoneOf(k2.x, k2.y).text };
  });
  check(r.same && r.net > 0, "connectors with the same name (case and spaces ignored) join their wires into one net across sheets");
  check(r.refs1.length === 1 && r.refs1[0] === r.zone && /^2\/[A-H]\d$/.test(r.zone) && /^1\/[A-H]\d$/.test(r.refs2[0] || ""), `each connector shows where its partner is (sheet 1 → ${r.refs1}, sheet 2 → ${r.refs2})`);
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const vLoad = await cad.evaluate(() => { const S = TubeCAD.state, T = TubeCAD.topo(), l = S.comps.find(c => c.type === "resistor"); return S.sim.result.dc.nodes[T.pinNet.get(l.id + ":1")]; });
  check(Math.abs(vLoad - 300) < 1, `the simulation sees the joined net: the load on sheet 2 gets ${vLoad && vLoad.toFixed(1)} V from the supply on sheet 1`);
  const pdf = await cad.evaluate(() => { const b = TubeCAD.exportPDF(false); let s = ""; for (const c of b) s += String.fromCharCode(c); return s; });
  const xref = +pdf.match(/startxref\n(\d+)/)[1];
  const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  const pages = pdf.match(/\/Type \/Page\b/g) || [];
  check(pages.length === 2 && /\/Count 2/.test(pdf) && /\/MediaBox \[0 0 595.276 841.89\]/.test(pdf) && /\/MediaBox \[0 0 841.89 595.276\]/.test(pdf) && offs.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)),
    `Save as PDF writes one page per sheet (${pages.length} pages: A4 portrait and A4 landscape, cross-reference table checks out)`);
  // each page holds only its own sheet: the load's designation is on page 2 only
  const streams = [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => m[1]);
  check(streams.length === 2 && !/\(R1\) Tj/.test(streams[0]) && /\(R1\) Tj/.test(streams[1]) && /\(\+B\) Tj/.test(streams[0]) && /\(\+b \) Tj/.test(streams[1]), "each PDF page holds only the parts on its own sheet");
}

// --- 14. Resistor power rating ----------------------------------------------------
{
  // the 1 kΩ load of section 13 across 300 V dissipates 90 W; rate it 10 W
  const v = await cad.evaluate(() => { const l = TubeCAD.state.comps.find(c => c.type === "resistor"); l.params.w = "10"; TubeCAD.state.sel.comps.clear(); TubeCAD.commit(); return CadLib.LIB.resistor.value(l); });
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  await cad.waitForFunction(() => /dissipates/.test(document.getElementById("inspector").textContent), null, { timeout: 10000 }).catch(() => {});
  const r = await cad.evaluate(() => { const l = TubeCAD.state.comps.find(c => c.type === "resistor"); return { p: TubeCAD.resistorPower(l), text: document.getElementById("inspector").textContent, small: CadLib.LIB.resistor.value({ params: { r: 470e3, w: "0.25" } }) }; });
  check(v === "1kΩ 10W" && r.small === "470kΩ", `the value text carries ratings from 1 W up ("${v}"; a 0.25 W part reads "${r.small}" and shows it by the mark in its body)`);
  check(Math.abs(r.p - 90) < 1 && /R1 dissipates 90(\.0+)? ?W, more than its 10 W rating/.test(r.text), `the circuit checks flag a resistor beyond its rating (${r.p.toFixed(1)} W in a 10 W part)`);
}

// --- 15. Catalog output transformer (Hammond 125SE) ------------------------------
{
  // 300 V through the 125ESE primary (103 Ω) into 3 kΩ: 97 mA DC, over its 80 mA rating
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, f = C.frames()[0];
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, rot) => { const c = C.makeComp(t, p, x, y, rot || 0); S.comps.push(c); return c; };
    const v = add("vdc", { v: 300 }, f.x + 300, f.y + 300), g = add("ground", {}, f.x + 300, f.y + 330);
    const t = add("opt_cat", { model: "125ESE", tap: "GRN" }, f.x + 500, f.y + 300), rl = add("resistor", { r: 3000 }, f.x + 400, f.y + 400, 1);
    const sp = add("speaker", { r: 4 }, f.x + 600, f.y + 300), g2 = add("ground", {}, f.x + 400, f.y + 430), g3 = add("ground", {}, f.x + 600, f.y + 330);
    const P = (c, id) => C.compPins(c).find(p => p.id === id);
    const w = (a, b) => S.wires.push({ id: "w" + S.wires.length, x1: a.x, y1: a.y, x2: b.x, y2: a.y }, { id: "w" + S.wires.length + "b", x1: b.x, y1: a.y, x2: b.x, y2: b.y });
    w(P(v, "+"), P(t, "P1")); w(P(t, "P2"), P(rl, "1")); w(P(t, "S1"), P(sp, "+")); w(P(t, "S2"), P(sp, "-"));
    C.commit();
    return { value: CadLib.LIB.opt_cat.value(t), info: CadLib.LIB.opt_cat.info(t) };
  });
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  await cad.waitForFunction(() => /125ESE\) carries/.test(document.getElementById("inspector").textContent), null, { timeout: 10000 }).catch(() => {});
  const txt = await cad.evaluate(() => document.getElementById("inspector").textContent);
  check(r.value === "125ESE GRN" && /103 Ω/.test(r.info) && /5 kΩ with 4 Ω/.test(r.info), `the Hammond 125SE list gives the model's data ("${r.value}": ${r.info.slice(0, 60)}…)`);
  check(/T1 \(Hammond 125ESE\) carries 9\d mA DC, more than its 80 mA rating/.test(txt), `the checks flag DC current beyond the output transformer's rating (${(txt.match(/carries \d+ mA/) || ["?"])[0]})`);
}

// --- Locked sheet frames; export of each sheet as PDF or PNG -------------------
{
  const fr = () => cad.evaluate(() => TubeCAD.frames().map(f => ({ id: f.id, x: f.x, y: f.y, locked: TubeCAD.isLocked(f), size: f.params.size, orient: f.params.orient })));
  const before = await fr();
  check(before.length === 2 && before.every(f => f.locked), "sheet frames are locked by default");
  // drag the first frame by its title block with the real mouse, then press Delete
  await cad.evaluate(() => TubeCAD.fitView()); await cad.waitForTimeout(100);
  const cb = await cad.locator("#cad").boundingBox();
  const grab = await cad.evaluate(() => { const f = TubeCAD.frames()[0], g = CadLib.sheetGeom(f), v = TubeCAD.state.view, x = f.x + g.tb.x1 + 40, y = f.y + g.tb.y2 - 20; return [x * v.scale + v.ox, y * v.scale + v.oy]; });
  await cad.mouse.move(cb.x + grab[0], cb.y + grab[1]); await cad.mouse.down(); await cad.mouse.move(cb.x + grab[0] + 120, cb.y + grab[1] + 60, { steps: 6 }); await cad.mouse.up();
  const sel = await cad.evaluate(() => [...TubeCAD.state.sel.comps]);
  await cad.keyboard.press("Delete");
  const after = await fr();
  check(sel.includes(before[0].id) && after.length === 2 && after[0].x === before[0].x && after[0].y === before[0].y && /frame is locked/.test(await cad.textContent("#status-sim")),
    "a locked frame can be selected (for its title block) but neither dragged nor deleted, and the status says why");
  await cad.locator("#inspector .row", { hasText: "Position" }).locator("select").selectOption("no");
  await cad.mouse.move(cb.x + grab[0], cb.y + grab[1]); await cad.mouse.down(); await cad.mouse.move(cb.x + grab[0] + 120, cb.y + grab[1] + 60, { steps: 6 }); await cad.mouse.up();
  const moved = (await fr())[0];
  check(!moved.locked && (moved.x !== before[0].x || moved.y !== before[0].y), "an unlocked frame moves");
  await cad.keyboard.press("Control+z"); await cad.keyboard.press("Control+z");
  check((await fr())[0].locked && (await fr())[0].x === before[0].x, "undo restores the frame and its lock");

  const grabAll = async (n, fn) => { const got = []; const on = d => got.push(d); cad.on("download", on); await fn(); for (let k = 0; k < 50 && got.length < n; k++) await cad.waitForTimeout(100); cad.off("download", on); return got; };
  // each sheet as its own PDF
  await cad.evaluate(() => TubeCAD.fitSheet(TubeCAD.frames()[1]));
  await cad.evaluate(() => TubeCAD.openExportDialog("pdf"));
  check(/Sheet 2/.test(await cad.textContent("#exp-current-name")), "the export dialog offers the sheet in view as \"This sheet\"");
  await cad.click('#export-modal [data-k="which"][data-v="each"]');
  let dls = await grabAll(2, () => cad.click("#btn-exp-ok"));
  const pdfs = await Promise.all(dls.map(async d => ({ name: d.suggestedFilename(), text: (await readFile(await d.path())).toString("latin1") })));
  const mb = t => (t.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g) || []).length;
  check(pdfs.length === 2 && pdfs.map(p => p.name).sort().join() === ["Test-amplifier-sheet1.pdf", "Test-amplifier-sheet2.pdf"].sort().join() || (pdfs.length === 2 && pdfs.every(p => /-sheet[12]\.pdf$/.test(p.name))),
    `"Each sheet, own file" saves one PDF per sheet (${pdfs.map(p => p.name).join(", ")})`);
  check(pdfs.every(p => mb(p.text) === 1), "each of those PDFs has exactly one page");
  // this sheet as PNG, 150 dpi, black on white
  await cad.evaluate(() => TubeCAD.openExportDialog("png"));
  await cad.click('#export-modal [data-k="which"][data-v="current"]'); await cad.click('#export-modal [data-k="dpi"][data-v="150"]'); await cad.click('#export-modal [data-k="colours"][data-v="print"]');
  check(await cad.isDisabled('#export-modal [data-k="which"][data-v="all"]'), "PNG has no \"all in one\" option (one image per sheet)");
  dls = await grabAll(1, () => cad.click("#btn-exp-ok"));
  const png = dls.length ? await readFile(await dls[0].path()) : Buffer.alloc(0);
  const pw = png.length > 24 ? png.readUInt32BE(16) : 0, ph = png.length > 24 ? png.readUInt32BE(20) : 0;
  const f2 = before[1], mm = { A4: [297, 210], A3: [420, 297] }[f2.size], [wmm, hmm] = f2.orient === "portrait" ? [mm[1], mm[0]] : mm;
  check(png.subarray(1, 4).toString() === "PNG" && Math.abs(pw - wmm / 25.4 * 150) < 2 && Math.abs(ph - hmm / 25.4 * 150) < 2 && /-sheet2\.png$/.test(dls[0].suggestedFilename()),
    `PNG of the sheet in view at 150 dpi: ${pw} × ${ph} px for ${f2.size} ${f2.orient} (${dls[0] && dls[0].suggestedFilename()})`);
  const ink = await cad.evaluate(() => { const f = TubeCAD.frames()[1], { canvas: cv } = TubeCAD.renderPNG(f, 100, "print"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let white = 0, black = 0, colour = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (Math.max(Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])) > 8) colour++; else if (v > 235) white++; else if (v < 60) black++; } return { white, black, colour }; });
  check(ink.white > 10 * ink.black && ink.black > 1000 && ink.colour === 0, `print colours: white paper, black ink, no colour (${ink.white} white, ${ink.black} black, ${ink.colour} coloured pixels)`);
  // the same sheet's PDF and PNG carry the same text (the grid labels and title block included)
  const texts = await cad.evaluate(() => { const f = TubeCAD.frames()[1], seen = [], { canvas: cv } = TubeCAD.renderPNG(f, 50, "print");
    const bytes = TubeCAD.exportPDF(false, [f]); let p = ""; for (const b of bytes) p += String.fromCharCode(b);
    return { pdfCols: /\(1\) Tj/.test(p) && /\(A\) Tj/.test(p), w: cv.width }; });
  check(texts.pdfCols, "the sheet's PDF has its reference-grid labels");
}

// --- Resizable side panels in every window --------------------------------------
{
  const drag = async (page, sel, dx) => {
    const h = page.locator(sel), b = await h.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 200); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 5 }); await page.mouse.up();
  };
  const width = (page, sel) => page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().width, sel);
  const handles = page => page.evaluate(() => document.querySelectorAll(".panel-split").length);
  // CAD: inspector (right) and palette (left)
  const i0 = await width(cad, "#inspector"), p0 = await width(cad, "#palette"), c0 = await cad.evaluate(() => document.getElementById("cad").clientWidth);
  await drag(cad, ".panel-split >> nth=1", -120);
  await drag(cad, ".panel-split >> nth=0", 60);
  const i1 = await width(cad, "#inspector"), p1 = await width(cad, "#palette"), c1 = await cad.evaluate(() => document.getElementById("cad").clientWidth);
  check(await handles(cad) === 2 && Math.abs(i1 - i0 - 120) < 3 && Math.abs(p1 - p0 - 60) < 3 && Math.abs((c0 - c1) - 180) < 4,
    `CAD: dragging the panel edges resizes the inspector (${Math.round(i0)} → ${Math.round(i1)} px) and the palette (${Math.round(p0)} → ${Math.round(p1)} px); the schematic gives way`);
  await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
  check(Math.abs(await width(cad, "#inspector") - i1) < 3, "CAD: the panel widths are kept after a reload");
  await cad.locator(".panel-split >> nth=1").dblclick();
  check(Math.abs(await width(cad, "#inspector") - 280) < 3, "CAD: double-clicking an edge resets the panel");
  await drag(cad, ".panel-split >> nth=1", -2000);
  check(await cad.evaluate(() => document.getElementById("cad").clientWidth) >= 355, "CAD: a panel can't be dragged so wide that the schematic disappears");
  await cad.locator(".panel-split >> nth=1").dblclick(); await cad.locator(".panel-split >> nth=0").dblclick();
  // tracer, scope and analyzer
  for (const [page, name, sel, nth, dx] of [[tracer, "curve tracer", ".col.right", 1, -100], [scope, "oscilloscope", "main > :nth-child(2)", 0, -100], [spectrum, "spectrum analyzer", "main > :nth-child(2)", 0, -100]]) {
    const w0 = await width(page, sel);
    await drag(page, `.panel-split >> nth=${nth}`, dx);
    const w1 = await width(page, sel);
    check(Math.abs(w1 - w0 + dx) < 3, `${name}: the side panel resizes by dragging its edge (${Math.round(w0)} → ${Math.round(w1)} px)`);
    await page.locator(`.panel-split >> nth=${nth}`).dblclick();
  }
}

// --- Bill of materials -------------------------------------------------------
{
  await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, f = C.frames()[0];
    f.params.title = "BOM test"; f.params.docno = "TA-001";
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, label) => { const c = C.makeComp(t, p, f.x + x, f.y + y, 0); if (label) c.label = label; S.comps.push(c); return c; };
    ["R1", "R2", "R3", "R4"].forEach((l, i) => add("resistor", { r: 100e3 }, 200 + 80 * i, 200, l));
    add("resistor", { r: 1500, w: "0.5" }, 200, 300, "R5"); add("resistor", { r: 1500, w: "0.5" }, 280, 300, "R7");
    add("capacitor", { c: 22e-9 }, 200, 400, "C1"); add("electrolytic", { c: 100e-6 }, 280, 400, "C2");
    add("tube", { tube: "12AX7" }, 500, 300, "VL1.1"); add("tube", { tube: "12AX7" }, 650, 300, "VL1.2"); add("tube", { tube: "EL84", connection: "pentode" }, 800, 300, "VL2");
    add("opt_cat", { model: "125ESE", tap: "GRN" }, 950, 300, "T1"); add("ground", {}, 200, 500); add("vdc", { v: 300 }, 300, 500, "G1");
    C.commit();
  });
  const bom = await cad.evaluate(() => TubeCAD.bomData());
  const line = v => bom.rows.find(r => r.value === v);
  check(line("100kΩ") && line("100kΩ").qty === 4 && line("100kΩ").refs === "R1-R4", `equal parts share one line with a designator range (${line("100kΩ") && line("100kΩ").refs})`);
  check(line("1.5kΩ") && line("1.5kΩ").refs === "R5, R7" && line("1.5kΩ").rating === "0.5 W", "the power rating goes in the Rating column");
  check(line("12AX7") && line("12AX7").qty === 1 && line("12AX7").refs === "VL1", "both sections of a dual triode (VL1.1, VL1.2) count as one tube");
  check(!bom.rows.some(r => /DC supply|Ground/.test(r.desc)), "sources and ground are left out by default");
  const sock = bom.rows.filter(r => r.desc === "Tube socket");
  check(sock.length === 1 && sock[0].value === "Noval B9A" && sock[0].qty === 2, `tube sockets are counted per base (${sock.map(r => r.qty + " × " + r.value).join(", ")})`);
  check(bom.rows.map(r => r.item).join() === bom.rows.map((_, i) => i + 1).join() && bom.rows[0].refs.startsWith("C"), "lines are numbered in designator order");

  await cad.keyboard.press("Escape"); await cad.locator("#cad").focus(); await cad.keyboard.press("b");
  check(await cad.isVisible("#bom") && (await cad.locator("#bom-table tbody tr").count()) === bom.rows.length, "B opens the BOM panel under the schematic with every line");
  const inp = cad.locator("#bom-table tr", { hasText: "R1-R4" }).locator("input");
  await inp.fill("Vishay MRS25 100K"); await inp.press("Enter");
  const pn = await cad.evaluate(() => TubeCAD.state.comps.filter(c => c.params.partno === "Vishay MRS25 100K").map(c => c.label).sort().join());
  check(pn === "R1,R2,R3,R4", `a part number typed in the BOM is stored on each part of the line (${pn})`);
  await cad.locator("#bom-table tr", { hasText: "125ESE" }).locator("td").first().click();
  check(await cad.evaluate(() => [...TubeCAD.state.sel.comps].map(id => TubeCAD.state.comps.find(c => c.id === id).label).join()) === "T1", "clicking a BOM line selects its parts on the sheet");
  {
    // a part clicked on the sheet brings its line into view in a short, scrolled-away list
    await cad.evaluate(() => { document.getElementById("bom").style.setProperty("--bom-h", "150px"); TubeCAD.fitView(); });
    await cad.waitForTimeout(100);
    await cad.evaluate(() => { document.querySelector("#bom .bom-scroll").scrollTop = 0; });
    const t1 = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(c => c.label === "T1"); return { x: c.x, y: c.y + 10 }; });
    const [px, py] = await toScreen(t1.x, t1.y);
    // the toolbar may have wrapped since the start, so measure the canvas again
    const cb = await cad.locator("#cad").boundingBox();
    const [sx, sy] = await cad.evaluate(([x, y]) => { const v = TubeCAD.state.view; return [x * v.scale + v.ox, y * v.scale + v.oy]; }, [t1.x, t1.y]);
    await cad.mouse.click(cb.x + sx, cb.y + sy);
    const vis = await cad.evaluate(() => {
      const box = document.querySelector("#bom .bom-scroll"), tr = document.querySelector("#bom-table tbody tr.sel"), b = box.getBoundingClientRect(), r = tr && tr.getBoundingClientRect();
      return { text: tr ? tr.textContent : "", scrolled: box.scrollTop > 0, inView: !!r && r.top >= b.top + document.querySelector("#bom-table thead").offsetHeight - 1 && r.bottom <= b.bottom + 1 };
    });
    check(/125ESE/.test(vis.text) && vis.scrolled && vis.inView, `selecting T1 on the sheet scrolls the BOM to its highlighted line`);
    await cad.evaluate(() => document.getElementById("bom").style.removeProperty("--bom-h"));
  }
  await cad.check("#bom-bench");
  check(await cad.locator("#bom-table tr", { hasText: "DC supply" }).count() === 1, "Sources & instruments adds the bench supply");
  await cad.uncheck("#bom-bench");

  const files = {};
  for (const fmt of ["txt", "csv", "xlsx", "pdf"]) {
    const [dl] = await Promise.all([cad.waitForEvent("download"), cad.click(`#bom [data-bom="${fmt}"]`)]);
    const path = await dl.path(); files[fmt] = { name: dl.suggestedFilename(), data: await readFile(path) };
  }
  const txt = files.txt.data.toString("utf8"), csv = files.csv.data.toString("utf8");
  check(files.txt.name === "TA-001-BOM.txt" && /BILL OF MATERIALS/.test(txt) && /R1-R4\s+Resistor\s+100kΩ/.test(txt) && /Vishay MRS25 100K/.test(txt), "TXT export: aligned table with the part numbers");
  check(csv.startsWith("﻿Item,Qty,Designators") && csv.includes('"R5, R7"') && csv.split("\r\n").filter(Boolean).length === bom.rows.length + 1, "CSV export: header, one row per line, quoted lists, UTF-8 mark");
  const x = files.xlsx.data, entries = [];
  for (let o = 0; o + 30 < x.length && x.readUInt32LE(o) === 0x04034b50;) {
    const n = x.readUInt16LE(o + 26), size = x.readUInt32LE(o + 18), name = x.toString("utf8", o + 30, o + 30 + n), body = x.subarray(o + 30 + n, o + 30 + n + size);
    entries.push({ name, crcOk: (await cad.evaluate(a => BomLib.crc32(new Uint8Array(a)), [...body])) === x.readUInt32LE(o + 14), body: body.toString("utf8") });
    o += 30 + n + size;
  }
  const sheet = (entries.find(e => e.name === "xl/worksheets/sheet1.xml") || {}).body || "";
  check(files.xlsx.name.endsWith(".xlsx") && entries.length === 7 && entries.every(e => e.crcOk) && sheet.includes("R1-R4") && sheet.includes("<autoFilter"), `XLSX export: a valid zip of ${entries.length} parts with the table`);
  const pdfs = files.pdf.data.toString("latin1");
  check(pdfs.startsWith("%PDF-1.4") && /\(BILL OF MATERIALS\) Tj/.test(pdfs) && /\(R1-R4\) Tj/.test(pdfs) && /page 1 of 1/.test(pdfs), "PDF export: a page with the title and the table");
  await cad.keyboard.press("b");
  check(!(await cad.isVisible("#bom")), "B closes the panel again");
}

// --- Transistors, zener, LED; current stickers ------------------------------------
{
  for (const name of ["NPN transistor", "PNP transistor", "NPN, high voltage", "N-MOSFET, depletion", "P-MOSFET", "Zener diode", "LED"])
    check(await cad.getByRole("button", { name: new RegExp("^" + name.replace(/[()]/g, "\\$&")) }).count() > 0, `palette offers "${name}" under Semiconductors`);
  // 12AX7 with red-LED cathode bias, MJE340 follower on its anode, 1N4742A shunt regulator from B+
  await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD; S.comps = []; S.wires = [];
    const add = (t, p, x, y, rot, label) => { const c = C.makeComp(t, p, x, y, rot || 0); if (label) c.label = label; S.comps.push(c); return c; };
    const poly = (...pts) => { for (let i = 0; i + 3 < pts.length; i += 2) S.wires.push({ id: "s" + S.wires.length, x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] }); };
    add("vdc", { v: 300 }, 200, 300, 0, "G1"); add("ground", {}, 200, 330);
    add("resistor", { r: 47000 }, 400, 200, 1, "R1"); add("tube", { tube: "12AX7" }, 400, 320, 0, "VL1");
    add("led", { color: "red" }, 400, 400, 1, "HL1"); add("ground", {}, 400, 420);
    add("resistor", { r: 1e6 }, 300, 360, 1, "R2"); add("ground", {}, 300, 390);
    add("npn", { model: "MJE340" }, 550, 300, 0, "VT1"); add("resistor", { r: 33000, w: "2" }, 560, 380, 1, "R3"); add("ground", {}, 560, 410);
    add("zener", { model: "1N4742A" }, 700, 380, 3, "VD1"); add("resistor", { r: 15000, w: "10" }, 700, 200, 1, "R4"); add("ground", {}, 700, 400);
    poly(200, 270, 200, 150, 400, 150, 400, 170); poly(400, 230, 400, 270); poly(400, 370, 400, 380);
    poly(350, 320, 300, 320, 300, 330); poly(400, 250, 520, 250, 520, 300);
    poly(560, 270, 560, 150, 400, 150); poly(560, 330, 560, 350);
    poly(560, 150, 700, 150, 700, 170); poly(700, 230, 700, 360);
    C.commit(); C.runSim("full");
  });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, g = l => S.comps.find(c => c.label === l), dev = l => (S.sim.result.dc.devices[g(l).id] || {}).main, v = n => S.sim.result.dc.nodes[n];
    const net = (l, p) => C.topo().pinNet.get(g(l).id + ":" + p), wc = C.wireCurrents().currents, pins = C.pinCurrents();
    const seg = (x1, y1, x2, y2) => { const w = S.wires.find(w => (w.x1 === x1 && w.y1 === y1 && w.x2 === x2 && w.y2 === y2) || (w.x1 === x2 && w.y1 === y2 && w.x2 === x1 && w.y2 === y1)); return w ? (w.x1 === x1 && w.y1 === y1 ? 1 : -1) * wc.get(w.id) : null; };
    return { err: S.sim.error, vz: v(net("VD1", "K")), vled: v(net("HL1", "A")), q: dev("VT1"), ia: dev("VL1").ia, supply: -dev("G1").i,
      rail: seg(200, 150, 400, 150), r1: seg(400, 230, 400, 250), base: seg(400, 250, 520, 250), anode: seg(400, 250, 400, 270), emitter: seg(560, 330, 560, 350),
      zener: seg(700, 230, 700, 360), pinR4: pins.get(g("R4").id + ":1"), checks: document.getElementById("inspector").textContent };
  });
  check(!r.err && Math.abs(r.vz - 12) < 0.3, `the 1N4742A holds ${r.vz.toFixed(2)} V (12 V zener at ~19 mA)`);
  // red LED: 1.8 V at 10 mA, 2·Vt per e-fold below (plus 5 Ω), so ~1.70 V at the 12AX7's 1.4 mA
  const vled = 2 * 0.025852 * Math.log(r.ia / (0.01 / Math.exp(1.8 / (2 * 0.025852)))) + 5 * r.ia;
  check(Math.abs(r.vled - vled) < 0.005, `the red LED biases the 12AX7 cathode at ${r.vled.toFixed(3)} V (expected ${vled.toFixed(3)} V at ${(r.ia * 1e3).toFixed(2)} mA)`);
  check(r.q && r.q.vbe > 0.55 && r.q.vbe < 0.75 && r.q.ic > 5e-3 && r.q.ic < 9e-3 && r.q.pd > 0.3 && r.q.pd < 0.7, `MJE340 follower: Vbe ${r.q.vbe.toFixed(3)} V, Ic ${(r.q.ic * 1e3).toFixed(2)} mA, ${r.q.pd.toFixed(2)} W`);
  check(Math.abs(Math.abs(r.rail) - Math.abs(r.supply)) < 1e-6, `the B+ rail wire carries the supply current (${(r.rail * 1e3).toFixed(2)} mA)`);
  check(Math.abs(r.r1 - (r.base + r.anode)) < 1e-8 && Math.abs(r.anode - r.ia) < 1e-6 && Math.abs(r.base - r.q.ib) < 1e-6, `R1's current splits at the junction into the anode (${(r.anode * 1e3).toFixed(3)} mA) and the base (${(r.base * 1e6).toFixed(1)} µA)`);
  check(Math.abs(r.emitter - (r.q.ic + r.q.ib)) < 1e-6, `the emitter wire carries Ic + Ib (${(r.emitter * 1e3).toFixed(3)} mA)`);
  check(Math.abs(r.zener - r.pinR4) < 1e-6 && r.zener > 0.018, `the zener branch carries R4's current down (${(r.zener * 1e3).toFixed(2)} mA)`);
  await cad.evaluate(() => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(S.comps.find(c => c.label === "VT1").id); TubeCAD.commit(); });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const insp = await cad.textContent("#inspector");
  check(/NPN transistor/.test(insp) && /hFE \(Ic\/Ib\)\d+/.test(insp) && /Dissipation.*of 20 W/.test(insp), "the inspector shows Vce, Vbe, Ic, Ib, hFE and dissipation against the rating");
  const spice = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(/^QVT|^Q\S+ N\d+ N\d+ N\d+ QN_MJE340$/m.test(spice) && /\.model QN_MJE340 NPN\(IS=/.test(spice), "SPICE export writes the transistor as a Q element with its .model");
  const bom = await cad.evaluate(() => TubeCAD.bomData().rows.map(r => [r.refs, r.desc, r.value, r.rating, r.sim].join("|")));
  check(bom.some(l => l.startsWith("VT1|Transistor, NPN|MJE340|300 V, 0.5 A, 20 W, TO-126|")) && bom.some(l => /^VD1\|Zener diode\|1N4742A\|12 V, 1 W\|/.test(l)) && bom.some(l => /^HL1\|LED, red\|/.test(l)), `the BOM lists the transistor, zener and LED with their ratings`);
  // stickers keep clear of every text and of each other
  await cad.evaluate(() => TubeCAD.fitView()); await cad.waitForTimeout(150);
  const sr = await cad.evaluate(() => TubeCAD.stickerReport());
  check(sr.volts >= 6 && sr.amps >= 8 && !sr.onText.length && !sr.onOther.length, `voltage and current stickers cover no text and no other sticker (${sr.volts} voltages, ${sr.amps} currents${sr.hidden.length ? `, ${sr.hidden.length} left out for want of room` : ""})`);
  // a designation sitting right where a sticker would go moves the sticker, not onto the text
  const moved = await cad.evaluate(async () => {
    const S = TubeCAD.state, C = TubeCAD, rail = S.wires.find(w => w.y1 === 150 && w.y2 === 150 && Math.min(w.x1, w.x2) === 200);
    const before = TubeCAD.stickerReport().list.find(t => t.kind === "v" && t.txt === "300V");
    const n = C.makeComp("note", { text: "NOTE OVER THE RAIL STICKER", size: "12" }, Math.round(before.x1 / 10) * 10 - 20, Math.round(before.y2 / 10) * 10, 0); S.comps.push(n); C.commit();
    await new Promise(r => setTimeout(r, 150));
    const rep = TubeCAD.stickerReport(), after = rep.list.find(t => t.kind === "v" && t.txt === "300V");
    S.comps = S.comps.filter(c => c !== n); C.commit();
    return { before, after, onText: rep.onText, rail: !!rail };
  });
  check(moved.after && (moved.after.x1 !== moved.before.x1 || moved.after.y1 !== moved.before.y1) && !moved.onText.length, `a text placed over a sticker pushes the sticker to a free spot (300V moved from ${Math.round(moved.before.x1)},${Math.round(moved.before.y1)} to ${moved.after && Math.round(moved.after.x1)},${moved.after && Math.round(moved.after.y1)})`);
  // Mirror (M): the transistor takes its base from the other side
  const mir = await cad.evaluate(() => { const S = TubeCAD.state, q = S.comps.find(c => c.label === "VT1"), pin = id => TubeCAD.compPins(q).find(p => p.id === id); const b0 = pin("B").x - q.x; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(q.id); TubeCAD.mirrorSelection(); const r = { b0, b1: pin("B").x - q.x, c1: pin("C").y - q.y, flip: q.params.flip }; TubeCAD.undo(); return r; });
  check(mir.b0 === -30 && mir.b1 === 30 && mir.c1 === -30 && mir.flip === "yes", "Mirror (M) flips a transistor left to right: the base moves to the other side, the collector stays on top");
  // Mirror works for every part that rotates, new ones included, and not for the scope, frame or notes
  const mall = await cad.evaluate(() => {
    const C = TubeCAD, L = CadLib.LIB, bad = [], skip = [];
    for (const type of Object.keys(L)) {
      const c = C.makeComp(type, {}, 5000, 5000, 0);
      if (L[type].noRotate) { c.params.flip = "yes"; if (C.compPins(c).some((p, i) => p.x !== C.compPins(Object.assign({}, c, { params: { ...c.params, flip: "no" } }))[i].x)) bad.push(type + " (should not mirror)"); skip.push(type); continue; }
      const a = C.compPins(c); c.params.flip = "yes"; const b = C.compPins(c);
      if (a.some((p, i) => b[i].x - 5000 !== -(p.x - 5000) || b[i].y !== p.y)) bad.push(type);
    }
    return { bad, skip };
  });
  check(!mall.bad.length && mall.skip.sort().join() === "frame,note,scope", `Mirror flips the pins of every rotatable part left to right (${mall.bad.length ? "wrong: " + mall.bad.join(", ") : "all " + (await cad.evaluate(() => Object.keys(CadLib.LIB).length)) + " types checked"}; scope, frame, note stay put)`);
  const mins = await cad.evaluate(async () => {
    const S = TubeCAD.state, cap = S.comps.find(c => c.type === "zener"); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(cap.id); TubeCAD.commit();
    await new Promise(r => setTimeout(r, 50));
    const row = [...document.querySelectorAll("#inspector .row")].find(r => /Mirror/.test(r.textContent)), btn = [...document.querySelectorAll("#inspector button")].find(b => /Mirror/.test(b.textContent));
    return { row: !!row, btn: !!btn && !btn.disabled };
  });
  check(mins.row && mins.btn, "the inspector of any part (here a zener) has the Mirror field and button");
  // stickers: drawn when Currents is on (the canvas changes when it is turned off)
  const shot = () => cad.locator("#cad").screenshot();
  const on = await shot(); await cad.click("#btn-amps"); const off = await shot(); await cad.click("#btn-amps");
  check(!on.equals(off) && await cad.evaluate(() => TubeCAD.state.showAmps), "Currents toggles the current stickers on the wires");
  // hovering a wire reports its current too
  const cb = await cad.locator("#cad").boundingBox();
  const [hx, hy] = await cad.evaluate(() => { const v = TubeCAD.state.view; return [300 * v.scale + v.ox, 150 * v.scale + v.oy]; });
  await cad.mouse.move(cb.x + hx, cb.y + hy);
  const hov = await cad.textContent("#status-hover");
  check(/I →\d/.test(hov) && /mA DC/.test(hov), `hovering the rail shows its current ("${hov.trim()}")`);
}

check(missing.length === 0, `every asset loads${missing.length ? `: ${missing.slice(0, 3).join(", ")}` : ""}`);
check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
