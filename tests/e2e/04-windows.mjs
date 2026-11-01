// The power-on transient, instrument windows without a CAD, one window per tool
import { U, browser, cad, check, ctx, open } from "./harness.mjs";

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
  // the result reaches the scope window by BroadcastChannel a moment later
  await sp.waitForFunction(() => /Simulated in/.test(document.getElementById("status").textContent), null, { timeout: 5000 }).catch(() => {});
  const st = await sp.evaluate(() => document.getElementById("status").textContent);
  check(/Simulated in/.test(st), `▶ Simulate on the oscilloscope runs the CAD's simulation until settled; the scope shows it ("${st}")`);
  // power-on: 0.5 s
  await sp.click('#analysis .btn[data-v="startup"]');
  await sp.selectOption("#t-stop", "0.5");
  // with a steady-state run going at the same time, the CAD's status line carries both and does not flip between them
  await cad.evaluate(() => { window.__st = []; const el = document.getElementById("status-sim"); const tick = () => { window.__st.push(el.textContent); if (window.__st.length < 2000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); TubeCAD.runSim("full"); });
  await sp.click("#btn-sim");
  await sp.waitForFunction(() => Instrument.transient && !Instrument.transient.running && Instrument.transient.ok, null, { timeout: 60000 });
  const flips = await cad.evaluate(() => { const k = window.__st.map(t => (/settled/.test(t) ? "S" : "") + (/Power-on transient,/.test(t) ? "T" : "")).filter(Boolean); let n = 0; for (let i = 1; i < k.length; i++) if (k[i] !== k[i - 1]) n++; return { n, seq: [...new Set(k)].join(" ") }; });
  check(flips.n <= 3, `running the steady state and the power-on transient at once: one status line for both, no flipping (${flips.n} changes: ${flips.seq})`);
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
// --- 9b. Power-on with the cathodes warming up: B+ overshoots on the cold tube, against the capacitor's rating ---
{
  // 300 V → 10 kΩ → C1 (300 V rating) → 20 kΩ → a 12AX7 to ground: cold, the tube draws nothing and C1 reaches 300 V
  const ids = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const gnd = p => { const g = add("ground", {}, p.x, p.y + 40); wire(p, pin(g, "G"), false); };
    const B = add("vdc", { v: 300 }, 200, 300), R1 = add("resistor", { r: 10e3 }, 300, 240), C1 = add("electrolytic", { c: 10e-6, v: "300" }, 400, 300, 1);
    const R2 = add("resistor", { r: 20e3 }, 500, 240), V = add("tube", { tube: "12AX7" }, 600, 340), SC = add("scope", {}, 800, 300);
    wire(pin(B, "+"), pin(R1, "1")); gnd(pin(B, "-")); wire(pin(R1, "2"), { x: 400, y: 240 }); wire({ x: 400, y: 240 }, pin(C1, "+"), false); gnd(pin(C1, "-"));
    wire(pin(R1, "2"), pin(R2, "1")); wire(pin(R2, "2"), pin(V, "A")); gnd(pin(V, "G")); gnd(pin(V, "K"));
    wire(pin(SC, "CH1"), { x: 720, y: 200 }, false); wire({ x: 720, y: 200 }, { x: 400, y: 200 }); wire({ x: 400, y: 200 }, { x: 400, y: 240 }, false); gnd(pin(SC, "COM"));
    S.view = { scale: 1, ox: 0, oy: 0 }; C.commit();
    return { scope: SC.id };
  });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 30000 });
  const sp = await open("scope-warm", `oscilloscope.html?scope=${ids.scope}`);
  await sp.waitForFunction(() => /Live from CAD/.test(document.getElementById("status").textContent), null, { timeout: 8000 });
  await sp.click('#analysis .btn[data-v="startup"]');
  const ui = await sp.evaluate(() => ({ dur: document.getElementById("t-stop").value, scen: document.getElementById("scenario").value, shown: !document.getElementById("pwr-bar").hidden, sb: document.getElementById("sb-row").hidden }));
  check(ui.dur === "auto" && ui.scen === "cold" && ui.shown && ui.sb, `power-on: Duration Auto and Scenario Cold start by default (${JSON.stringify(ui)})`);
  await sp.click("#btn-sim");
  await sp.waitForFunction(() => Instrument.transient && !Instrument.transient.running && Instrument.transient.ok && Instrument.transient.warmup, null, { timeout: 120000 });
  const w = await sp.evaluate(() => {
    const t = Instrument.transient, ch = Scope.startupChannels(Instrument.transientScope()).ch1, q = Scope.settleInfo(ch, t.dt), at = s => ch.raw[Math.round(s / t.dt - 0.5)];
    return { tStop: t.tStop, early: at(1), final: q.final, limits: ch.limits, notes: document.getElementById("pwr-events").textContent, verdict: document.getElementById("pwr-verdict").textContent, shownReport: !document.getElementById("pwr-report").hidden, events: t.events, tdiv: document.getElementById("tdiv").value, opt: document.getElementById("tdiv").options[0].textContent };
  });
  check(w.tStop >= 15 && w.tStop <= 25, `Auto runs three of the 12AX7's warm-up time constants (${w.tStop} s)`);
  check(w.early > 295 && w.final < w.early - 5, `B+ on C1 overshoots while the cathode is cold (${w.early.toFixed(1)} V at 1 s, ${w.final.toFixed(1)} V settled)`);
  check(w.limits.length === 1 && w.limits[0].v === 300 && /C1/.test(w.notes) && /300\s?V rating/.test(w.notes), `C1's 300 V rating drawn on the channel, and the note: ${w.notes.slice(0, 140)}`);
  check(/whole record/.test(w.opt), `a warm-up record opens whole (${w.opt})`);
  check(w.shownReport && w.events.some(e => e.kind === "settled" && /B\+ \(C1\)/.test(e.who)) && w.events.every((e, i, a) => !i || a[i - 1].t <= e.t), `the report strip lists the events in time order, B+ settling among them (${w.verdict}: ${w.events.map(e => e.level + " " + e.who + " " + e.text).join("; ")})`);
  // time presets, log time, an event's click zooms there with marker A on it
  const nav = await sp.evaluate(() => {
    const out = {};
    Scope.preset("inrush"); out.inrush = Scope.startupView();
    Scope.preset("settled"); out.settled = Scope.startupView();
    Scope.preset("warmup"); out.warmup = Scope.startupView();
    document.getElementById("logt").click(); Scope.preset("whole"); out.log = Scope.axes().h; out.logMap = Scope.timeMap().log;
    document.getElementById("logt").click();
    const k = Instrument.transient.events.findIndex(e => e.kind === "settled");
    document.querySelectorAll("#pwr-events .ev")[k].click();
    out.ev = Instrument.transient.events[k].t; out.focus = Scope.startupView(); out.mk = Scope.markers().map(m => m.t);
    out.active = document.querySelectorAll("#pwr-events .ev.active").length;
    return out;
  });
  check(nav.inrush.pos === 0 && Math.abs(nav.inrush.span - 0.2) < 1e-9 && Math.abs(nav.settled.pos + nav.settled.span - w.tStop) < 1e-6 && nav.settled.span <= 0.2 + 1e-9, `Inrush shows 0–200 ms, Settled the last 200 ms (${JSON.stringify([nav.inrush, nav.settled])})`);
  check(nav.warmup.pos === 0 && nav.warmup.span >= 3 * 4.5 && nav.warmup.span <= w.tStop, `Warm-up shows three time constants of the 12AX7 (${JSON.stringify(nav.warmup)})`);
  check(nav.logMap && nav.log.includes("10ms") && nav.log.includes("1s"), `Log time labels the axis from milliseconds to seconds (${nav.log.join(" ")})`);
  check(nav.focus.pos <= nav.ev && nav.focus.pos + nav.focus.span >= nav.ev && nav.focus.span < w.tStop && nav.mk.length === 1 && Math.abs(nav.mk[0] - nav.ev) < 1e-9 && nav.active === 1, `clicking an event zooms to it and puts marker A on it (${JSON.stringify(nav)})`);
  // warm-up lane for the 12AX7; Show plots C1 from the run's own record, picked again it goes
  const ph2 = await sp.evaluate(() => {
    Scope.preset("whole");
    const lanes = Scope.lanes(), sel = document.getElementById("pwr-show"), c1 = Instrument.transient.caps.find(c => c.label === "C1");
    sel.value = c1.id; sel.dispatchEvent(new Event("change"));
    const on = Scope.channels(), ch = Scope.startupChannels(Instrument.transientScope()), x = ch["x:" + c1.id], p = ch.ch1;
    const at = s => [x.raw[Math.round(s / Instrument.transient.dt)], p.raw[Math.round(s / Instrument.transient.dt)]];
    sel.value = c1.id; sel.dispatchEvent(new Event("change"));
    return { lanes, on, off: Scope.channels(), at: [at(1), at(10)] };
  });
  check(ph2.lanes.length === 1 && ph2.lanes[0].tube === "12AX7" && ph2.lanes[0].warmAt > 10 && ph2.lanes[0].warmAt < 40, `a warm-up lane for the 12AX7 (${JSON.stringify(ph2.lanes)})`);
  check(ph2.on.length === 2 && /^C1( \(B\+\))?$/.test(ph2.on[1].label) && ph2.off.length === 1 && ph2.at.every(([a, b]) => Math.abs(a - b) < 0.02 * Math.abs(b) + 0.5), `Show plots C1 from the run's record, on the probe's trace (${JSON.stringify(ph2.at)}), and takes it off again`);
  // standby switch: the heaters 30 s before B+, the cathode warm by then: B+ barely overshoots
  await sp.selectOption("#scenario", "standby");
  const sbShown = await sp.evaluate(() => !document.getElementById("sb-row").hidden);
  await sp.click("#btn-run");
  await sp.waitForFunction(() => Instrument.transient && !Instrument.transient.running && Instrument.transient.ok && Instrument.transient.scenario.kind === "standby", null, { timeout: 120000 });
  const sb = await sp.evaluate(() => { const t = Instrument.transient, ch = Scope.startupChannels(Instrument.transientScope()).ch1; return { tStop: t.tStop, peak: Scope.settleInfo(ch, t.dt).peak, lanes: Scope.lanes() }; });
  check(sbShown && sb.tStop <= 5 && sb.peak < w.early - 20 && sb.lanes[0].pct >= 90, `standby switch after 30 s: a short run (${sb.tStop} s), B+ peak ${sb.peak.toFixed(1)} V against ${w.early.toFixed(1)} V cold, the cathode warm (${sb.lanes[0] && sb.lanes[0].pct} %)`);
  // hot cathodes: no overshoot, no note about C1
  await sp.selectOption("#scenario", "hot"); await sp.selectOption("#t-stop", "0.5");
  await sp.click("#btn-sim");
  await sp.waitForFunction(() => Instrument.transient && !Instrument.transient.running && Instrument.transient.ok && !Instrument.transient.warmup, null, { timeout: 60000 });
  const h = await sp.evaluate(() => ({ notes: [...document.querySelectorAll("#pwr-events .ev")].filter(e => !e.classList.contains("info")).map(e => e.textContent).join(" "), tStop: Instrument.transient.tStop }));
  check(h.tStop === 0.5 && !/C1/.test(h.notes), `hot cathodes: ${h.notes}`);
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
  await cad.click("#btn-windows"); await cad.click("#btn-open-scope");
  await cad.waitForTimeout(800);
  await cad.click("#btn-windows"); await cad.click("#btn-open-scope");
  await cad.waitForTimeout(800);
  check(opened.length === 1, `Windows ▸ Oscilloscope twice opens one window (${opened.length})`);
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
