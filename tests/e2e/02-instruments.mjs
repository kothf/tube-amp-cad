// A 12AX7 stage simulated in the worker; the oscilloscope, analyzer, Bode plotter and curve tracer follow it
import { cad, check, open } from "./harness.mjs";

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
{
  // the voltmeter probe: P, point at the load resistor's top pin, read DC + AC + trace; click leaves it there
  const at = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, RL = S.comps.find(c => c.type === "resistor" && c.params.r === 470e3), V1 = S.comps.find(c => c.type === "tube");
    const sc = (p) => { const r = document.getElementById("cad").getBoundingClientRect(); return { x: r.left + p.x * S.view.scale + S.view.ox, y: r.top + p.y * S.view.scale + S.view.oy }; };
    return { out: sc(C.compPins(RL).find(p => p.id === "1")), plate: sc(C.compPins(V1).find(p => p.id === "A")) };
  });
  await cad.locator("#cad").focus(); await cad.keyboard.press("p");
  await cad.mouse.move(at.out.x, at.out.y); await cad.waitForTimeout(150);
  const hv = await cad.evaluate(() => { const el = document.getElementById("probe-hover"), S = TubeCAD.state, t = S.probe.hover, rd = t && TubeCAD.probeRead(TubeCAD.topo().pinNet.get(t.comp + ":" + t.pid));
    return { tool: S.tool, shown: !!el && !el.hidden, text: el ? el.textContent : "", scope: !!el && !el.querySelector(".probe-scope").hidden, rd: rd && { dc: rd.dc, rms: rd.rms, freq: rd.freq } }; });
  check(hv.tool === "probe" && hv.shown && /DC/.test(hv.text) && /Vrms/.test(hv.text) && hv.scope && hv.rd && Math.abs(hv.rd.dc) < 0.05 && hv.rd.rms > 5 && Math.abs(hv.rd.freq - 1000) < 20,
    `the probe on the coupled output reads DC ${hv.rd && hv.rd.dc.toFixed(3)} V, AC ${hv.rd && hv.rd.rms.toFixed(2)} Vrms at ${hv.rd && hv.rd.freq && hv.rd.freq.toFixed(0)} Hz, with a scope trace`);
  await cad.mouse.click(at.plate.x, at.plate.y); await cad.waitForTimeout(100);
  await cad.keyboard.press("v"); await cad.mouse.move(at.plate.x + 300, at.plate.y + 200); await cad.waitForTimeout(150);
  const pn = await cad.evaluate(() => { const el = document.getElementById("probe-pin"), h = document.getElementById("probe-hover"); return { shown: !!el && !el.hidden, hover: !!h && !h.hidden, text: el ? el.textContent : "", dc: TubeCAD.state.sim.result.dc.nodes[TubeCAD.topo().pinNet.get(TubeCAD.state.probe.pin.comp + ":A")] }; });
  check(pn.shown && !pn.hover && pn.dc > 100 && pn.text.includes(String(parseFloat(pn.dc.toFixed(1)))), `a click leaves the probe on the plate (DC ${pn.dc.toFixed(1)} V) after going back to Select; the pointer's card goes away`);
  await cad.keyboard.press("Escape"); await cad.waitForTimeout(100);
  check(await cad.evaluate(() => !TubeCAD.state.probe.pin && document.getElementById("probe-pin").hidden), "Esc removes the probe left on the sheet");
}
{
  // the curve tracer gets one closed cycle of the load line, not the whole capture
  const tj = await cad.evaluate(() => { const t = TubeCAD.buildSummary().tubes.find(x => x.traj); if (!t) return null; const a = t.traj.vak, n = a.length, pp = Math.max(...a) - Math.min(...a); return { n, gap: Math.abs(a[0] - a[n - 1]) / pp, pp, win: TubeCAD.state.sim.result.tran.samples * TubeCAD.state.sim.result.tran.dt }; });
  check(tj && tj.gap < 0.02 && tj.pp > 1, `the load line sent to the curve tracer is one closed signal cycle (${tj && tj.n} points, ends ${tj && (tj.gap * 100).toFixed(2)} % of the swing apart; capture ${tj && (tj.win * 1e3).toFixed(1)} ms)`);
}
check(circuit.ms < 10000, `simulation finished in ${(circuit.ms / 1000).toFixed(1)} s`);
{
  // AC is marked apart from DC: "~…Vrms" after the DC in the stickers, a cyan glow on the wires that carry signal
  await cad.waitForTimeout(150);
  const sr = await cad.evaluate(() => TubeCAD.stickerReport());
  const both = sr.ac.filter(t => /^[-\d.]+[mµk]?V ~/.test(t)), acOnly = sr.ac.filter(t => /^~/.test(t)), dcOnly = sr.list.filter(t => t.kind === "v" && !/~/.test(t.txt)).map(t => t.txt);
  check(sr.ac.every(t => /~[\d.]+[mµk]?Vrms$/.test(t)) && both.length >= 1 && acOnly.length >= 1 && dcOnly.length >= 1 && sr.signalNets >= 2,
    `voltage stickers tell AC from DC: DC + AC ${both.join(", ")}; AC only ${acOnly.join(", ")}; DC only ${dcOnly.join(", ")}; ${sr.signalNets} signal nets glow`);
  // Animate: one signal cycle slowed down; the plate swings against the grid (inverted), AC current runs in the wires
  await cad.click("#btn-anim"); await cad.waitForTimeout(600);
  const an = await cad.evaluate(id => {
    const a = TubeCAD.anim(), d = a.data, T = TubeCAD.topo(), v = TubeCAD.state.comps.find(c => c.id === id), net = p => T.pinNet.get(v.id + ":" + p);
    const g = d.nets.get(net("G")), pl = d.nets.get(net("A")); let cor = 0; g.ac.forEach((x, i) => { cor += x * pl.ac[i]; });
    return { on: a.on, phase: a.phase, frames: d.n, wires: d.wires.size, dcWires: [...d.wires.values()].filter(w => w.mode === "dc").length, inverted: cor < 0, pressed: document.getElementById("btn-anim").getAttribute("aria-pressed"), legend: TubeCAD.legend() && TubeCAD.legend().rows[0] };
  }, circuit.v1);
  await cad.waitForTimeout(300);
  const ph2 = await cad.evaluate(() => TubeCAD.anim().phase);
  await cad.click("#btn-anim");
  const off = await cad.evaluate(() => !TubeCAD.anim().on);
  await cad.waitForTimeout(150);
  check(an.on && an.pressed === "true" && an.frames >= 100 && an.wires >= 3 && an.dcWires >= 1 && an.dcWires < an.wires && an.inverted && ph2 !== an.phase && off && /^AC current/.test(an.legend),
    `Animate plays the AC: ${an.frames} frames over a cycle, current in ${an.wires} wires (${an.dcWires} mostly DC, flowing steadily), the plate swinging against the grid; the legend explains it; off again`);
  // the legend in the corner says what the glow and the colours mean; View ▾ → Legend hides it
  const lg = await cad.evaluate(() => TubeCAD.legend());
  await cad.evaluate(() => document.getElementById("btn-legend").click()); await cad.waitForTimeout(100);
  const lgOff = await cad.evaluate(() => TubeCAD.legend());
  await cad.evaluate(() => document.getElementById("btn-legend").click()); await cad.waitForTimeout(100);
  check(lg && lg.rows.length === 4 && /^signal: AC/.test(lg.rows[0]) && lg.x >= 0 && lg.y > 0 && lgOff === null && await cad.evaluate(() => !!TubeCAD.legend()),
    `the legend explains the marks (${lg && lg.rows.join(" | ")}); View ▾ → Legend hides and shows it`);
}

// --- 3. Instruments receive the live result ---------------------------------
export const scope = await open("scope", `oscilloscope.html?scope=${circuit.scope}`);
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

export const spectrum = await open("spectrum", `spectrum_analyzer.html?scope=${circuit.scope}`);
await spectrum.waitForFunction(() => /\d/.test(document.getElementById("thd").textContent), null, { timeout: 5000 }).catch(() => {});
const thd = parseFloat((await spectrum.textContent("#thd")).replace(/[^\d.]/g, ""));
check(Math.abs(thd - circuit.thd) / circuit.thd < 0.1, `spectrum THD ${thd} % matches the CAD's ${circuit.thd.toFixed(3)} % (±10 %)`);
{
  // Auto span marks all ten: the ones under the screen's floor get a stub with "H7↓"
  const hs = await spectrum.evaluate(() => window.Spectrum.harmonics());
  check(hs && hs.length === 10 && hs[0] === "F" && hs.every((t, i) => !i || t.replace("↓", "") === "H" + (i + 1)) && hs.some(t => t.endsWith("↓")), `analyzer Auto span labels all 10 harmonics, the ones under the floor too (${hs && hs.join(" ")})`);
}
{
  await spectrum.selectOption("#fx", "log");
  const lg = await spectrum.evaluate(() => { const S = window.Spectrum, x = f => S.linePoint(f).x; return { v: S.view(), d1: x(2000) - x(1000), d2: x(4000) - x(2000), d3: x(8000) - x(4000) }; });
  check(lg.v.log && lg.v.fa > 0 && Math.abs(lg.d1 - lg.d2) < 1.5 && Math.abs(lg.d2 - lg.d3) < 1.5 && lg.d1 > 20, `analyzer: logarithmic frequency axis, each octave equally wide (${lg.d1.toFixed(1)}, ${lg.d2.toFixed(1)}, ${lg.d3.toFixed(1)} px)`);
  const r = await spectrum.locator("#screen").boundingBox(), p1 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000));
  await spectrum.mouse.move(r.x + p1.x, r.y + r.height / 2); await spectrum.mouse.wheel(0, -100); await spectrum.waitForTimeout(100);
  const p2 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000)), v2 = await spectrum.evaluate(() => window.Spectrum.view());
  check(v2.fb / v2.fa < lg.v.fb / lg.v.fa && Math.abs(p2.x - p1.x) < 3, "analyzer: zooming a log axis keeps the frequency under the pointer");
  await spectrum.evaluate(() => { window.Spectrum.state.zoom = null; }); await spectrum.selectOption("#fx", "lin");
}

// --- 3b. Bode plotter: the small-signal response at the scope's channels -------------------------
const bode = await open("bode", `bode.html?scope=${circuit.scope}`);
await bode.waitForFunction(() => { const t = window.Bode && Bode.traces(); return t && t.list.length === 2; }, null, { timeout: 30000 }).catch(() => {});
{
  const b = await bode.evaluate(() => {
    const T = Bode.traces();
    if (!T) return { n: 0, resp: "", foot: "no response: " + document.getElementById("status").textContent };   // a failed check, not a crash of the whole run
    const f = T.f, k = f.findIndex(x => x >= 999.99), ch1 = T.list.find(t => t.key === "ch1"), ch2 = T.list.find(t => t.key === "ch2");
    return { n: f.length, f0: f[0], f1: f[f.length - 1], g1: ch1 && ch1.db[k], p1: ch1 && ch1.ph[k], g2: ch2 && ch2.db[k], resp: document.getElementById("resp").textContent, foot: document.getElementById("foot").textContent, status: document.getElementById("status").textContent };
  });
  check(b.n > 200 && b.f0 <= 1 && b.f1 >= 1e6, `Bode: the CAD sweeps 1 Hz – 1 MHz (${b.n} frequencies) for the scope's channels (${b.foot})`);
  check(b.g1 !== undefined && Math.abs(Math.pow(10, b.g1 / 20) - ratio) / ratio < 0.05 && Math.abs(b.g2) < 0.2, `Bode: CH1 ${b.g1 && b.g1.toFixed(2)} dB at 1 kHz (${b.g1 && Math.pow(10, b.g1 / 20).toFixed(1)}×) agrees with the scope's ${ratio}×; CH2, the generator, ${b.g2 && b.g2.toFixed(2)} dB`);
  check(Math.abs(Math.abs(b.p1) - 180) < 5, `Bode: the common-cathode stage inverts (${b.p1 && b.p1.toFixed(1)}° at 1 kHz)`);
  const lo = /−3 dB low([\d.]+)(m?)Hz/.exec(b.resp), hi = /−3 dB high(above )?([\d.]+)(k|M)Hz/.exec(b.resp);
  check(lo && +lo[1] < 50 && hi && (hi[3] === "M" || +hi[2] > 20), `Bode: −3 dB at ${lo && lo[0].slice(9)} (cathode bypass and coupling capacitors) and ${hi && hi[0].slice(10)} from the generator's 50 Ω`);
  // the Miller effect: a 100 kΩ source makes the 12AX7's input capacitance (Cgk + (1 + A)·Cga ≈ 100 pF) a pole near 16 kHz
  const seq = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => { const g = TubeCAD.state.comps.find(c => c.type === "siggen"); g.params.rs = 100e3; TubeCAD.commit(); });
  await cad.waitForFunction(s => TubeCAD.state.sim.seq > s && !TubeCAD.state.sim.busy && !TubeCAD.state.sim.pending, seq, { timeout: 30000 });
  await bode.waitForFunction(() => { const t = /−3 dB high([\d.]+)kHz/.exec(document.getElementById("resp").textContent); return t && +t[1] < 40; }, null, { timeout: 30000 }).catch(() => {});
  const hi2 = /−3 dB high([\d.]+)(k?)Hz/.exec(await bode.textContent("#resp"));
  check(hi2 && hi2[2] === "k" && +hi2[1] > 8 && +hi2[1] < 30, `Bode: from a 100 kΩ source the Miller capacitance sets the top at ${hi2 && hi2[1]} kHz (1/(2π·100k·(Cgk + (1 + A)·Cga)) ≈ 16 kHz)`);
  await cad.evaluate(() => { const g = TubeCAD.state.comps.find(c => c.type === "siggen"); g.params.rs = 50; TubeCAD.commit(); });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy && !TubeCAD.state.sim.pending, null, { timeout: 30000 });
  // the instrument windows get that run a moment later (a background tab redraws late): wait until both show it
  const last = await cad.evaluate(() => TubeCAD.state.sim.seq);
  for (const w of [scope, spectrum]) await w.waitForFunction(s => window.Instrument && Instrument.result && Instrument.result.seq === s, last, { timeout: 10000 }).catch(() => {});
  check(await spectrum.evaluate(s => Instrument.result.seq === s, last) && await scope.evaluate(s => Instrument.result.seq === s, last), `the scope and the analyzer show the CAD's latest run (#${last})`);
}

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
  await scope.evaluate(() => { window.__ev = []; const c = document.getElementById("screen"); ["pointerdown", "pointerup", "dblclick", "pointermove"].forEach(t => c.addEventListener(t, e => window.__ev.push(t + " " + e.offsetX.toFixed(0) + "," + e.offsetY.toFixed(0) + " m=" + window.Scope.markers().length), true)); });
  const pre = await scope.evaluate(() => window.Scope.markers().map(k => [k.pos.x, k.pos.y]));
  await scope.mouse.dblclick(...await canvasAt(scope, moved[0].pos));
  const after = await scope.evaluate(() => window.Scope.markers());
  check(after.length === 1, "double-click removes a marker" + (after.length === 1 ? "" : ` (DEBUG pre ${JSON.stringify(pre)} target ${JSON.stringify(moved[0].pos)} after ${JSON.stringify(after.map(k => k.pos))} ev ${JSON.stringify(await scope.evaluate(() => window.__ev))})`));
  await scope.keyboard.press("Escape");
  check((await scope.evaluate(() => window.Scope.markers())).length === 0, "Esc clears the markers");
}
{
  const fund = 1000;
  const p1 = await spectrum.evaluate(() => window.Spectrum.linePoint(1000)), p2 = await spectrum.evaluate(() => window.Spectrum.linePoint(2000));
  // click a little above each stem: the marker snaps to the line
  await spectrum.mouse.click(...await canvasAt(spectrum, { x: p1.x + 3, y: p1.y - 15 }));
  await spectrum.mouse.click(...await canvasAt(spectrum, { x: p2.x - 3, y: p2.y - 15 }));
  // the markers and the harmonic table from one and the same drawing
  const [m, h2] = await spectrum.evaluate(() => { window.Spectrum.draw(); return [window.Spectrum.markers(), parseFloat([...document.querySelectorAll("#harm tr")].find(r => r.cells[0].textContent === "H2").cells[2].textContent)]; });
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
const sc2ui = await scope2.evaluate(() => ({ ch1: document.getElementById("card-ch1").classList.contains("off"), ch2: document.getElementById("card-ch2").classList.contains("off"), nc: getComputedStyle(document.querySelector("#card-ch2 .nc")).display, ov: document.getElementById("overview").getBoundingClientRect().height }));
check(!sc2ui.ch1 && sc2ui.ch2 && sc2ui.nc !== "none", "scope: an unconnected channel's settings are greyed and marked \"not connected\"");
check(sc2ui.ov === 0, "scope: no empty strip under the screen in steady state (the power-on overview takes no room when hidden)");
await scope2.close();

// --- 4. Curve tracer follows the tube selected in the CAD -------------------
export const tracer = await open("tracer", "index.html");
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

{
  // transistors: the library lists them grouped as the CAD's palette does; the curves are the simulator's
  await tracer.click("#lib-tabs button[data-lib=semis]");
  const heads = await tracer.locator("#tube-list .list-sub").allTextContents();
  check(["NPN, silicon", "NPN, germanium", "PNP, silicon", "PNP, germanium", "N-channel MOSFET", "P-channel MOSFET", "N-channel JFET", "P-channel JFET"].every(h => heads.some(t => t.toLowerCase() === h.toLowerCase())),
    `tracer: the transistor library is grouped by kind (${heads.join(", ")})`);
  await tracer.fill("#tube-search", "AC128");
  await tracer.locator("#tube-list .list-item", { hasText: "AC128" }).first().click();
  const t = await tracer.textContent("#plot-title"), pl = await tracer.evaluate(() => { const p = TubeTracer.plot(); return { n: p.curves.length, step: p.st.step, vals: p.st.values, top: p.y1 }; });
  check(/^AC128 · PNP germanium/.test(t) && pl.n >= 4 && pl.vals[0] === 0, `tracer: AC128 shows its collector curves (${pl.n} curves, −IB step ${(pl.step * 1e6).toFixed(0)} µA, "${t}")`);
  // the IB = 0 curve of a germanium part is its leakage, ICEO = (hFE + 1)·ICBO
  const iceo = await tracer.evaluate(() => TubeTracer.iaOf(5, 0));
  check(iceo > 50e-6 && iceo < 2e-3, `tracer: AC128's IB = 0 curve carries its leakage, ICEO ${(iceo * 1e6).toFixed(0)} µA at −VCE 5 V`);
  // a point picked on a curve reads back that curve's base current
  const ib = pl.vals[2], pt = await tracer.evaluate(ib => TubeTracer.toScreen(5, TubeTracer.iaOf(5, ib)), ib);
  const r = await tracer.locator("#plot").boundingBox();
  await tracer.mouse.click(r.x + pt.x, r.y + pt.y);
  const [k] = await tracer.evaluate(() => TubeTracer.picks());
  check(k && Math.abs(k.c - ib) < 0.03 * ib && k.ss && k.ss.hfe > 30 && k.ss.hfe < 300, `tracer: a point on the −IB ${(ib * 1e6).toFixed(0)} µA curve reads −IB ${k && (k.c * 1e6).toFixed(1)} µA, hFE ${k && k.ss && k.ss.hfe.toFixed(0)}`);
  // a warmer germanium part leaks more
  await tracer.fill("#tr-temp", "45"); await tracer.press("#tr-temp", "Enter");
  const hot = await tracer.evaluate(() => TubeTracer.iaOf(5, 0));
  check(hot > 3 * iceo && /45 °C/.test(await tracer.textContent("#plot-title")), `tracer: at 45 °C AC128's leakage is ${(hot / iceo).toFixed(1)}× that at 25 °C`);
  await tracer.fill("#tr-temp", "25"); await tracer.press("#tr-temp", "Enter");
  // the transfer and gain plots
  await tracer.click("#semi-modes button[data-m=transfer]");
  const tf = await tracer.evaluate(() => { const p = TubeTracer.plot(); return { mode: p.mode, x0: p.x0, x1: p.x1, n: p.curve.length, hot: !!p.hot, legend: document.getElementById("legend").textContent }; });
  check(tf.mode === "transfer" && tf.x1 < 0.5 && tf.hot && /Transfer curve/.test(tf.legend) && (await tracer.textContent("#semi-modes button.active")) === "IC–VBE",
    `tracer: AC128's transfer curve runs to −VBE ${tf.x1.toFixed(2)} V (germanium), with a warmer one beside it`);
  await tracer.click("#semi-modes button[data-m=gain]");
  const gn = await tracer.evaluate(() => { const p = TubeTracer.plot(); return { mode: p.mode, max: Math.max(...p.curve.map(q => q[1])) }; });
  check(gn.mode === "gain" && gn.max > 60 && gn.max < 200, `tracer: AC128's hFE against IC peaks at ${gn.max.toFixed(0)}`);
  // FETs: ID–VDS per VGS; a P-channel JFET's curves run down from VGS = 0 to its pinch-off
  await tracer.click("#semi-modes button[data-m=output]");
  await tracer.fill("#tube-search", "J175");
  await tracer.locator("#tube-list .list-item", { hasText: "J175" }).first().click();
  const jf = await tracer.evaluate(() => { const p = TubeTracer.plot(); return { vals: p.st.values, idss: TubeTracer.iaOf(10, 0), btn: document.querySelector("#semi-modes button.active").textContent }; });
  check(jf.vals[0] === 0 && jf.vals.every(v => v <= 0 && v > -4) && jf.idss > 15e-3 && jf.idss < 40e-3 && jf.btn === "ID–VDS", `tracer: J175 drain curves from VGS 0 (IDSS ${(jf.idss * 1e3).toFixed(1)} mA) in ${jf.vals.length} steps to its 4 V pinch-off`);
  check(/^\.model JP_J175 PJF/m.test(await tracer.evaluate(() => { document.getElementById("btn-model").click(); return document.getElementById("model-text").value; })), "tracer: the transistor model button gives its SPICE .model");
  await tracer.click("#btn-modal-close");
  const csv = await tracer.evaluate(() => TubeTracer.csv());
  check(/^"−VDS \(V\)","−ID \(A\) at −VGS = 0 V"/.test(csv) && csv.split("\n").length > 200, "tracer: CSV saves the curves shown");
  // back to the tubes
  await tracer.fill("#tube-search", "");
  await tracer.click("#lib-tabs button[data-lib=tubes]");
  await tracer.getByRole("button", { name: /EL34/ }).first().click();
  check((await tracer.textContent("#plot-title")).includes("EL34") && !(await tracer.isVisible("#semi-modes")), "tracer: back on a tube, the transistor plot switch goes away");
}
