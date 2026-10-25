// A ganged switch, a kenotron supply, a catalog power transformer, IEC sheets and designations
import { cad, check, clickAt, toScreen } from "./harness.mjs";

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
  if (await cad.getByRole("button", { name: /^Power 300/ }).count() === 0) await cad.locator(".pal-group", { hasText: "Transformers" }).click();
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
  if (await cad.getByRole("button", { name: /Drawing frame/ }).count() === 0) await cad.locator(".pal-group", { hasText: "Document" }).click();
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
