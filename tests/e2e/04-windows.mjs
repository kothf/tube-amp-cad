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
