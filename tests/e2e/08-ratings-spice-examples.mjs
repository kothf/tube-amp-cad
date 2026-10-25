// Tube ratings, SPICE tube models and the loudspeaker, the examples in the File menu
import { U, cad, check, ctx, missing, open } from "./harness.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tracer } from "./02-instruments.mjs";

// --- No bias finder: no marking, no target fields, no menu item (it was removed as confusing) ---
check(await cad.evaluate(() => !document.getElementById("btn-bias") && !CadLib.LIB.tube.fields.some(f => /^bias/.test(f.key)) && !("job" in TubeCAD.state.bias)), "the bias finder is gone: no Bias markers item, no bias target on tubes");
// --- Tube ratings beyond Va and Pa ----------------------------------------------------------------
{
  // an EL84 with fixed bias through a 1 MΩ grid leak (0.3 MΩ allowed) and its screen on 300 V with
  // the anode pulled down by its load; a 12AT7 cathode follower with its cathode near 150 V (90 V allowed)
  await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id), wire = (a, b, h) => C.lRoute(a.x, a.y, b.x, b.y, h !== false).forEach(q => C.addSegment(...q));
    const gnd = (p, x, y) => { const g = add("ground", {}, x ?? p.x, y ?? p.y + 40); wire(p, pin(g, "G"), false); };
    const sup = (x, y) => { const b = add("vdc", { v: 300 }, x, y); gnd(pin(b, "-")); return pin(b, "+"); };
    const V1 = add("tube", { tube: "EL84", connection: "pentode" }, 400, 300), RL = add("resistor", { r: 3000, w: 50 }, 400, 160, 1);
    const RG = add("resistor", { r: 1e6 }, 300, 380, 1), VN = add("vdc", { v: -9 }, 220, 480);
    wire(sup(560, 60), pin(RL, "1"), true); wire(pin(RL, "2"), pin(V1, "A")); wire(sup(600, 240), pin(V1, "G2"), true);
    gnd(pin(V1, "K")); wire(pin(RG, "1"), pin(V1, "G1")); wire(pin(RG, "2"), pin(VN, "+")); gnd(pin(VN, "-"));
    const V2 = add("tube", { tube: "12AT7" }, 900, 300), R1 = add("resistor", { r: 1e6 }, 820, 180, 1), R2 = add("resistor", { r: 1e6 }, 820, 420, 1), RK = add("resistor", { r: 47e3 }, 900, 440, 1);
    wire(sup(1060, 120), pin(V2, "A"), true); wire(sup(700, 60), pin(R1, "1"), true); wire(pin(R1, "2"), pin(V2, "G")); wire(pin(R2, "1"), pin(V2, "G")); gnd(pin(R2, "2"));
    wire(pin(V2, "K"), pin(RK, "1")); gnd(pin(RK, "2"));
    S.sel.comps.clear(); S.sel.wires.clear(); C.setLive(true); C.commit(); C.fitView();
  });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy && !S.sim.pending && S.comps.length > 10; }, null, { timeout: 60000 });
  await cad.waitForTimeout(500);
  const sum = await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.updateInspector(); return document.getElementById("inspector").textContent; });
  check(/VL1 has 1MΩ in its grid circuit, more than the 300kΩ allowed with fixed bias/.test(sum), `the checks flag the EL84's 1 MΩ grid leak with fixed bias (0.3 MΩ allowed)`);
  check(/VL2(\.1)? has its cathode 1\d\dV above the heater, more than the 90V allowed/.test(sum), `the checks flag the 12AT7 follower's cathode above the grounded heater`);
  const el84 = await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(k => k.params.tube === "EL84"); S.sel.comps.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); return document.getElementById("inspector").textContent; });
  const pg2 = (/Pg2 \(screen dissipation\)([\d.]+)(m?)W(?: · )?(\d+)% of 2W/.exec(el84) || []);
  check(pg2.length && /Ik \(cathode current\)/.test(el84) && /Grid circuit R \(fixed bias\)1MΩ(?: · )?333% of 300kΩ/.test(el84), `the EL84's inspector shows Pg2 (${pg2[1]}${pg2[2]} W, ${pg2[3]} % of 2 W), Ik and the grid circuit resistance against their ratings`);
  // a raised heater clears the follower
  const seq = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(k => k.params.tube === "12AT7"); S.sel.comps.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); });
  const hv = cad.locator("#inspector label.row", { hasText: "Heater DC potential" }).locator("input");
  await hv.fill("100"); await hv.press("Enter");
  await cad.waitForFunction(seq => { const S = TubeCAD.state; return S.sim.seq > seq && S.sim.result && !S.sim.busy && !S.sim.pending; }, seq, { timeout: 60000 });
  const raised = await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.updateInspector(); return document.getElementById("inspector").textContent; });
  check(!/VL2(\.1)? has its/.test(raised) && /VL1 has 1MΩ/.test(raised), "with the heater raised to 100 V the follower's Vhk is within its rating");
}

check(missing.length === 0, `every asset loads${missing.length ? `: ${missing.slice(0, 3).join(", ")}` : ""}`);
// --- SPICE tube models (import dialog) and the loudspeaker model ----------------------------
{
  const KOREN = (await readFile(new URL("../spice.test.mjs", import.meta.url), "utf8")).match(/const KOREN_12AX7 = `([\s\S]*?)`;/)[1];
  await cad.bringToFront();
  // the 12AX7 stage again, then its tube swapped for Koren's own published model, pasted into the dialog
  const v1 = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id), wire = (a, b, h) => C.lRoute(a.x, a.y, b.x, b.y, h !== false).forEach(q => C.addSegment(...q));
    const gnd = (p, x, y) => { const g = add("ground", {}, x ?? p.x, y ?? p.y + 40); wire(p, pin(g, "G"), false); };
    const V1 = add("tube", { tube: "12AX7" }, 400, 300), Ra = add("resistor", { r: 100e3 }, 400, 160, 1), B = add("vdc", { v: 250 }, 560, 120);
    const Rk = add("resistor", { r: 1500 }, 400, 420, 1), Ck = add("electrolytic", { c: 47e-6 }, 470, 420, 1), Rg = add("resistor", { r: 1e6 }, 300, 380, 1), Cin = add("capacitor", { c: 0.1e-6 }, 250, 300);
    const G = add("siggen", { amp: 0.5, freq: 1000 }, 180, 360), Co = add("capacitor", { c: 0.1e-6 }, 500, 220), RL = add("resistor", { r: 470e3 }, 580, 290, 1);
    wire(pin(B, "+"), pin(Ra, "1"), true); gnd(pin(B, "-")); wire(pin(Ra, "2"), pin(V1, "A"));
    wire(pin(V1, "K"), pin(Rk, "1")); wire(pin(Rk, "1"), pin(Ck, "+"), true); gnd(pin(Rk, "2")); gnd(pin(Ck, "-"));
    wire(pin(Cin, "2"), pin(V1, "G")); wire(pin(Rg, "1"), { x: 300, y: 300 }); gnd(pin(Rg, "2"));
    wire(pin(G, "+"), pin(Cin, "1"), false); gnd(pin(G, "-")); wire(pin(V1, "A"), pin(Co, "1"), false); wire(pin(Co, "2"), pin(RL, "1")); gnd(pin(RL, "2"));
    S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(V1.id); C.commit(); C.updateInspector();
    return V1.id;
  });
  await cad.click("#btn-import-spice");
  await cad.fill("#spimp-text", KOREN);
  await cad.waitForFunction(() => !document.getElementById("spimp-add").disabled, null, { timeout: 5000 }).catch(() => {});
  const dlg = await cad.evaluate(() => ({ roles: [...document.querySelectorAll("#spimp-pins select")].map(s => s.value), name: document.getElementById("spimp-name").value, like: document.getElementById("spimp-like").value, est: document.getElementById("spimp-est").textContent }));
  const mu = +((/µ ([\d.]+)/.exec(dlg.est) || [])[1]);
  check(dlg.roles.join(",") === "A,G,K" && dlg.name === "12AX7 (SPICE)" && dlg.like === "12AX7" && mu > 85 && mu < 105, `Import SPICE model: Koren's 12AX7 file is read, its pins P G K from the comment, like the 12AX7, curves drawn (µ ${mu})`);
  const seq0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.click("#spimp-add");
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, seq0, { timeout: 20000 }).catch(() => {});
  const run = await cad.evaluate(id => { const c = TubeCAD.state.comps.find(k => k.id === id), d = TubeCAD.tubeData(c); return { tube: c.params.tube, err: TubeCAD.state.sim.error, vak: d && d.dc.vak, gain: d && d.metrics && d.metrics.gain }; }, v1);
  check(run.tube === "12AX7 (SPICE)" && !run.err && run.vak > 120 && run.vak < 220 && run.gain > 40 && run.gain < 90, `the stage simulates with the imported model (Va ${run.vak && run.vak.toFixed(1)} V, gain ${run.gain && run.gain.toFixed(1)}×)`);
  const file = await cad.evaluate(() => JSON.parse(TubeCAD.circuitJSON())), net = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(file.tubes && file.tubes.length === 1 && /\.SUBCKT 12AX7 1 2 3/.test(file.tubes[0].custom.text) && file.tubes[0].socket === "Noval B9A", "the circuit file carries the imported model (and its socket), so it opens on any computer");
  check(/\* imported model 12AX7/.test(net) && /^X\S+ \S+ \S+ \S+ 12AX7$/m.test(net) && /G1 1 3 VALUE=/.test(net), "the SPICE netlist export includes the imported subcircuit as written, wired by its pin roles");
  check(await cad.evaluate(() => /Imported SPICE model 12AX7/.test(document.getElementById("inspector").textContent)), "the tube's inspector says it runs an imported model");
  await cad.reload(); await cad.waitForFunction(() => window.TubeCAD && TubeCAD.state.comps.length > 5);
  check(await cad.evaluate(() => TubeCAD.state.comps.some(c => c.params.tube === "12AX7 (SPICE)") && TUBE_DATABASE.some(t => t.commonName === "12AX7 (SPICE)" && t.custom)), "after a reload the imported tube is still in the list (kept in the browser)");

  // the curve tracer, open since earlier, learns the imported tube from the CAD and shows its model
  if (!tracer.isClosed()) {
    await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(k => k.params.tube === "12AX7 (SPICE)"); S.sel.comps.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); TubeCAD.runSim("full"); });
    await tracer.waitForFunction(() => /Imported SPICE model/.test(document.getElementById("hud").textContent), null, { timeout: 15000 }).catch(() => {});
    check(await tracer.evaluate(() => /Imported SPICE model/.test(document.getElementById("hud").textContent) && /12AX7 \(SPICE\)/.test(document.getElementById("plot-title").textContent)), "the curve tracer shows the imported tube and its model");
  }
  // the loudspeaker: a speaker placed now is a typical 8 Ω guitar driver, with its impedance curve
  const spk = await cad.evaluate(() => { const C = TubeCAD, S = C.state, c = C.makeComp("speaker", {}, 900, 300, 0); S.comps.push(c); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id); C.commit(); C.updateInspector(); return c.id; });
  const sp1 = await cad.evaluate(() => ({ plot: !!document.querySelector("#inspector #spk-plot"), note: (document.querySelector("#inspector .spk-plot p") || {}).textContent || "", driver: [...document.querySelectorAll("#inspector .row")].find(r => /Driver/.test(r.textContent)).querySelector("select").value }));
  check(sp1.plot && sp1.driver === "g12-8" && /56 Ω at 81 Hz/.test(sp1.note), `a new speaker is a Thiele–Small driver with its impedance curve (${sp1.note.slice(0, 60)}…)`);
  await cad.locator("#inspector .row", { hasText: "Model" }).locator("select").selectOption("res");
  const sp2 = await cad.evaluate(id => ({ plot: !!document.querySelector("#inspector #spk-plot"), kinds: (() => { const n = TubeCAD.buildNetlist().elements.filter(e => e.id.startsWith(id)); return n.map(e => e.kind).join(""); })() }), spk);
  check(!sp2.plot && sp2.kinds === "R", "set to Resistor it is an ideal 8 Ω load again (as in circuits saved before)");
}
// --- Examples in the File menu ------------------------------------------------------------
{
  await cad.bringToFront();
  const before = await cad.evaluate(() => TubeCAD.state.comps.length);
  await cad.click("#btn-file");
  const items = await cad.locator("#examples-list .menu-item").allTextContents();
  check(items.length === 12 && items.some(t => /Gubin three-tube amplifier/.test(t)) && items.some(t => /Gubin stereo amplifier with 5Ц4С supply/.test(t)) && items.some(t => /12AX7: plate resistor vs current source/.test(t)), `File → Examples lists the ${items.length} circuits drawn from published sources`);
  cad.once("dialog", d => d.accept());
  const seq0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.locator("#examples-list .menu-item", { hasText: "12AX7: plate resistor" }).click();
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, seq0, { timeout: 30000 }).catch(() => {});
  const ex = await cad.evaluate(() => { const S = TubeCAD.state, f = S.comps.find(c => c.type === "frame"); return { docno: f && f.params.docno, n: S.comps.length, err: S.sim.error, title: document.title, tag: document.getElementById("cur-file").textContent, tagTip: document.getElementById("cur-file").title, status: document.getElementById("status") ? document.getElementById("status").textContent : "" }; });
  check(ex.docno === "VAL-03" && ex.n === 38 && !ex.err && !/03-12ax7/.test(ex.title), `the example opens (VAL-03, ${ex.n} parts), simulates, and stays untitled so Save asks for a new name`);
  check(/^12AX7/.test(ex.tag) && !/•/.test(ex.tag) && /^12AX7/.test(ex.title) && /^VAL-03 · 12AX7/.test(ex.tagTip), `the toolbar names the example by its title block (${ex.tag}), not "Untitled", and does not mark it as changed`);
  await cad.keyboard.press("Control+z");
  check(await cad.evaluate(n => TubeCAD.state.comps.length === n, before), "Ctrl+Z brings back the circuit that was on the sheet");
  // every example opens and simulates without an error
  const res = [];
  for (const e of await cad.evaluate(() => TubeCAD.EXAMPLES.map(x => x.file))) {
    const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
    cad.once("dialog", d => d.accept());
    await cad.evaluate(f => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => x.file === f)), e);
    await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 }).catch(() => {});
    res.push(await cad.evaluate(f => ({ f, ok: !!TubeCAD.state.sim.result && TubeCAD.state.sim.result.ok && !TubeCAD.state.sim.error, parts: TubeCAD.state.comps.length }), e));
  }
  check(res.length === 12 && res.every(r => r.ok && r.parts > 15), `all twelve examples open and simulate: ${res.map(r => `${r.f.slice(0, 2)} ${r.ok ? "ok" : "FAILED"}`).join(", ")}`);
  check(await cad.evaluate(() => TubeCAD.state.sim.result && TubeCAD.state.sim.result.solver === "wasm"), "the simulation worker solves with WebAssembly");
  {
    // the flashing-LED example has no signal generator: Animate plays its power-on transient in real time and the LED blinks
    const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
    cad.once("dialog", d => d.accept());
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /flashing-led/.test(x.file))));
    await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 }).catch(() => {});
    await cad.click("#btn-anim");
    await cad.waitForFunction(() => { const p = TubeCAD.anim().power; return p && p.ok; }, null, { timeout: 60000 }).catch(() => {});
    const blink = await cad.evaluate(async () => {
      const led = TubeCAD.state.comps.find(c => c.type === "led"), seen = [];
      for (let k = 0; k < 30; k++) { seen.push(TubeCAD.ledLevel(led)); await new Promise(r => setTimeout(r, 100)); }
      const p = TubeCAD.anim().power;
      return { on: Math.max(...seen), off: Math.min(...seen), t: p && p.t };
    });
    await cad.click("#btn-anim");
    check(blink.on > 0.5 && blink.off === 0 && blink.t > 0, `flashing-LED example: Animate plays the power-on transient and the LED blinks (brightness ${blink.off} to ${blink.on && blink.on.toFixed(2)} over 3 s)`);
  }
  {
    // the Gubin supply: a 5Ц4С at 115 mA is within its 125 mA (2 × 62 mA per anode), and its peak anode current is checked against 375 mA
    const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
    cad.once("dialog", d => d.accept());
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^07-/.test(x.file))));
    await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 }).catch(() => {});
    const t = await cad.evaluate(() => { const S = TubeCAD.state, v = S.comps.find(c => c.label === "VL1"); S.sel.comps.clear(); S.sel.comps.add(v.id); TubeCAD.updateInspector(); return document.getElementById("inspector").innerText; });
    const rect = (t.match(/Rectified current\s+([\d.]+mA)\s+(\d+)% of 125mA/) || []), pk = (t.match(/Peak anode current\s+([\d.]+mA)\s+(\d+)% of 375mA/) || []);
    const circuitChecks = await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.updateInspector(); const t = document.getElementById("inspector").innerText; return t.slice(t.indexOf("CHECKS"), t.indexOf("Renumber")); });
    check(/No problems found/i.test(circuitChecks) && pk[2] <= 100, `Gubin example: no warnings in the circuit's checks (the 5Ц4С's peak anode current ${pk[1]} is within 375 mA)${/No problems/i.test(circuitChecks) ? "" : ": " + circuitChecks.replace(/\s+/g, " ")}`);
    await cad.evaluate(() => { const S = TubeCAD.state, v = S.comps.find(c => c.label === "VL1"); S.sel.comps.clear(); S.sel.comps.add(v.id); TubeCAD.updateInspector(); });
    // Animate picks DC or AC by the node's voltage over the whole capture: the 50 Hz mains is AC, even though it barely moves in one 1 kHz signal cycle
    const mainsModes = await cad.evaluate(() => {
      const S = TubeCAD.state, d = TubeCAD.anim().data, m = S.comps.find(c => c.type === "mains"); if (!d || !m) return null;
      const pins = new Set(TubeCAD.compPins(m).map(p => p.x + "," + p.y));
      return S.wires.filter(w => pins.has(w.x1 + "," + w.y1) || pins.has(w.x2 + "," + w.y2)).map(w => d.wires.get(w.id) && d.wires.get(w.id).mode);
    });
    check(mainsModes && mainsModes.length && mainsModes.every(x => x === "ac"), `Animate: the mains wires carry AC dots (${mainsModes && mainsModes.join(", ")})`);
    check(rect[2] > 75 && rect[2] < 100 && pk[1], `Gubin example: the 5Ц4С delivers ${rect[1]} (${rect[2]} % of 125 mA, not of the per-anode 62 mA); peak anode current ${pk[1]} (${pk[2]} % of 375 mA)`);
    // the BOM's Sim. max: worked out when the simulation finishes, with the BOM closed; every kind of part has one
    const bomRows = await cad.evaluate(() => { const S = TubeCAD.state; return { open: !document.getElementById("bom").hidden, rows: TubeCAD.bomData().rows.map(r => [r.refs, r.sim]) }; });
    // a capacitor's voltage rating: the first standard one at or above 1.25 × its simulated peak
    const capRows = await cad.evaluate(() => TubeCAD.bomData().rows.filter(r => /^Capacitor/.test(r.desc)).map(r => ({ refs: r.refs, rating: r.rating, sim: r.sim })));
    const vOf = t => { const m = /^([\d.]+)(m|k)?V/.exec(t) || []; return m[1] * (m[2] === "k" ? 1000 : m[2] === "m" ? 1e-3 : 1); };
    check(capRows.length && capRows.every(r => /^\d+(\.\d+)? V$/.test(r.rating) && parseFloat(r.rating) >= 1.25 * vOf(r.sim) - 1e-6),
      `BOM rating column: every capacitor has a standard voltage rating at or above 1.25 × its peak: ${capRows.map(r => r.refs + " " + r.sim + " → " + r.rating).join("; ")}`);
    const std = await cad.evaluate(() => [["electrolytic", 300], ["electrolytic", 10], ["capacitor", 30], ["capacitor", 400], ["electrolytic", 500], ["capacitor", 2600]].map(([t, v]) => BomLib.capRating(t, v)).join("|"));
    check(std === "400 V|16 V|50 V|630 V|2 × 450 V in series|2 × 3000 V in series", `standard capacitor voltages: ${std}`);
    const simOf = ref => (bomRows.rows.find(([refs]) => refs.split(/[,-]/).map(x => x.trim()).includes(ref)) || [])[1] || "";
    check(!bomRows.open && /W$/.test(simOf("BA1")) && /A DC$/.test(simOf("L1")) && /^HT .*A DC · \d+%$/.test(simOf("T1")) && /A DC$/.test(simOf("T2")) && /%$/.test(simOf("VL1")) && /%$/.test(simOf("VL3")) && /W$/.test(simOf("R1")) && /V$/.test(simOf("C1")),
      `BOM Sim. max for every kind of part, with the BOM closed: BA1 ${simOf("BA1")}, L1 ${simOf("L1")}, T1 ${simOf("T1")}, T2 ${simOf("T2")}, VL1 ${simOf("VL1")}, VL3 ${simOf("VL3")}`);
    // an edit waits for its simulation: the column keeps the last run's values (not the new part value with the old voltages)
    const kept = await cad.evaluate(async () => { const S = TubeCAD.state, r3 = S.comps.find(c => c.label === "R3"), get = () => TubeCAD.bomData().rows.find(r => r.refs === "R3").sim, before = get(); r3.params.r = 470; TubeCAD.commit(); const right = get(); const s0 = S.sim.seq;
      while (!(S.sim.seq > s0 && !S.sim.busy && !S.sim.pending && S.sim.result)) await new Promise(r => setTimeout(r, 50)); const after = get(); r3.params.r = 330; TubeCAD.commit(); const s1 = S.sim.seq;
      while (!(S.sim.seq > s1 && !S.sim.busy && !S.sim.pending && S.sim.result)) await new Promise(r => setTimeout(r, 50)); return { before, right, after }; });
    check(kept.right === kept.before && kept.after !== kept.before, `after an edit the BOM keeps the last run's Sim. max (R3 ${kept.right}) until the new run gives ${kept.after}`);
    await cad.waitForFunction(() => { const S = TubeCAD.state; return !S.sim.busy && !S.sim.pending && S.sim.result; }, null, { timeout: 60000 });
    // its board: every part placed, everything routed, no rule violations
    const bw = await open("board-07", "board.html");
    await bw.waitForFunction(() => window.BoardApp && BoardApp.state.model && BoardApp.state.board.tracks.length > 50, null, { timeout: 15000 }).catch(() => {});
    await bw.waitForTimeout(500);
    const bs = await bw.evaluate(() => { const S = BoardApp.state; return { parts: S.model.parts.length, placed: Object.keys(S.board.parts).length, tracks: S.board.tracks.length, vias: S.board.vias.length, un: S.conn.unrouted, drc: S.drc.map(d => d.kind + ": " + d.msg) }; });
    check(bs.parts === 41 && bs.un === 0 && !bs.drc.length, `Gubin example's board: ${bs.parts} parts, ${bs.tracks} tracks, ${bs.vias} vias, ${bs.un} to route, ${bs.drc.length ? bs.drc.join("; ") : "no rule violations"}`);
    // Print (Ctrl+P): the ticked pages, presets for the print set and toner transfer, 1:1 on A4/A3
    await bw.evaluate(() => { window.__printed = []; PdfExport.print = (b, o) => { let t = ""; for (const x of b) t += String.fromCharCode(x); window.__printed.push({ pages: (t.match(/\/Type \/Page\b/g) || []).length, name: o.name }); return "dialog"; }; });
    await bw.evaluate(() => document.activeElement && document.activeElement.blur());
    await bw.keyboard.press("Control+p");
    await bw.click('[data-pset="toner"]');
    const bpd = await bw.evaluate(() => ({ open: !document.getElementById("print-modal").hidden, sum: document.getElementById("print-summary").textContent, ticked: [...document.querySelectorAll("#print-pages [data-pg]:checked")].map(x => x.dataset.pg).join() }));
    await bw.click("#print-ok");
    await bw.keyboard.press("Control+p"); await bw.click('[data-pset="print"]'); await bw.uncheck('#print-pages [data-pg="drill"]'); await bw.check('#print-pages [data-pg="toner-F"]'); await bw.click("#print-ok");
    const bpr = await bw.evaluate(() => ({ printed: window.__printed, sel: BoardApp.printSel().join(), msg: document.getElementById("st-msg").textContent }));
    check(bpd.open && bpd.ticked === "toner-F,toner-B" && /2 pages, A[34] .*scale 1:1/.test(bpd.sum) && bpr.printed.length === 2 && bpr.printed[0].pages === 2 && bpr.printed[1].pages === 4 && bpr.sel === "assembly,F.Cu,B.Cu,toner-F" && /Actual size/.test(bpr.msg),
      `board Print: toner transfer ${bpr.printed[0] && bpr.printed[0].pages} pages ("${bpd.sum}"), a picked set of ${bpr.printed[1] && bpr.printed[1].pages} (${bpr.sel})`);
    // Auto-route: grey while no Freerouting answers; with one (here a stand-in on its address that sends back the
    // tracks of a net taken off the board) the routes come back in one step, which Ctrl+Z takes back
    const grey = await bw.evaluate(() => document.getElementById("btn-autoroute").classList.contains("off"));
    // pressed with no Freerouting: the dialog says why, and the window keeps its width (a long status message once widened it)
    await bw.click("#btn-autoroute"); await bw.waitForSelector("#router-modal:not([hidden])", { timeout: 8000 }).catch(() => {});
    const nf = await bw.evaluate(() => ({ w: document.body.scrollWidth, iw: innerWidth, open: !document.getElementById("router-modal").hidden, why: document.getElementById("router-state").textContent }));
    await bw.click("#router-cancel");
    check(nf.open && nf.w <= nf.iw && /No answer/.test(nf.why), `Auto-route with no Freerouting opens its dialog with the reason ("${nf.why.slice(0, 40)}…"); the window stays ${nf.w} px wide`);
    // one that answers without allowing this page (no cors_origins) is told apart from none
    // (a real server: a routed request does not go through the browser's CORS check)
    const bare = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ status: "OK" })); }).listen(0, "127.0.0.1");
    await new Promise(r => bare.once("listening", r));
    const pr = await bw.evaluate(u => BoardRoute.probe(u, 3000), `http://127.0.0.1:${bare.address().port}`);
    bare.close();
    check(!pr.ok && pr.why === "cors", `Freerouting started without this page in cors_origins is reported as such (${pr.why})`);
    const off = await bw.evaluate(() => { const S = BoardApp.state, n = S.board.tracks.find(t => t.net && t.net !== "GND").net, gone = S.board.tracks.filter(t => t.net === n);
      S.board.tracks = S.board.tracks.filter(t => t.net !== n); BoardApp.commit(); return { n, gone, un: S.conn.unrouted }; });
    const um = v => Math.round(v * 1e4), sesNet = off.n.replace(/[^A-Za-z0-9.+]/g, "");
    const ses = `(session b (routes (resolution um 10) (network_out (net "${sesNet}" ${off.gone.map(t => `(wire (path ${t.layer} ${um(t.w)} ${t.pts.map(([x, y]) => `${um(x)} ${um(-y)}`).join(" ")}))`).join(" ")}))))`;
    let posted = null;
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
    await ctx.route("http://127.0.0.1:37864/**", async (route, req) => {
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (/system\/status/.test(req.url())) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ status: "OK" }) });
      posted = { body: JSON.parse(req.postData()), host: req.headers()["freerouting-environment-host"] };
      return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ status: "COMPLETED", unrouted_connections: 0, clearance_violations: 0, duration_seconds: 0.1, outputs: { SES: ses } }) });
    });
    await bw.click("#btn-autoroute");
    await bw.waitForFunction(() => /routed|failed|not running/.test(document.getElementById("st-msg").textContent), null, { timeout: 15000 }).catch(() => {});
    const ar = await bw.evaluate(() => ({ msg: document.getElementById("st-msg").textContent, un: BoardApp.state.conn.unrouted, drc: BoardApp.state.drc.map(d => d.msg), tracks: BoardApp.state.board.tracks.length }));
    check(grey && off.un > 0 && posted && /^\(pcb /.test(posted.body.file_content) && posted.body.file_content.includes(`(net "${sesNet}" (pins`) && /^TubeAmpCAD\//.test(posted.host) && ar.un === 0 && !ar.drc.length && /routed/.test(ar.msg),
      `Auto-route: grey with no Freerouting; with one it sends the board as DSN and adds the ${off.gone.length} tracks of ${off.n} it sends back ("${ar.msg}", ${ar.un} to route, ${ar.drc.length ? ar.drc.join("; ") : "no rule violations"})`);
    await bw.keyboard.press("Control+z"); await bw.waitForTimeout(200);
    check(await bw.evaluate(u => BoardApp.state.conn.unrouted === u, off.un), "Ctrl+Z takes the whole auto-route back");
    await bw.keyboard.press("Control+y"); await bw.waitForTimeout(200);
    // deleting one track of a route takes the rest of it that would hang loose too (no stubs left), one step for Ctrl+Z
    const dr0 = await bw.evaluate(() => { const b = BoardApp.state.board, on = (p, v) => Math.hypot(p[0] - v.x, p[1] - v.y) < 1e-3;
      BoardApp.state.sel = { kind: "track", i: b.tracks.findIndex(t => b.vias.some(v => on(t.pts[0], v) || on(t.pts[t.pts.length - 1], v))) }; return { t: b.tracks.length, v: b.vias.length }; });
    await bw.locator("#pcb").focus().catch(() => {}); await bw.keyboard.press("Delete"); await bw.waitForTimeout(200);
    const dr1 = await bw.evaluate(() => ({ t: BoardApp.state.board.tracks.length, v: BoardApp.state.board.vias.length, loose: BoardApp.state.drc.filter(d => d.kind === "dangling").length, msg: document.getElementById("st-msg").textContent }));
    await bw.keyboard.press("Control+z"); await bw.waitForTimeout(200);
    const dr2 = await bw.evaluate(() => BoardApp.state.board.tracks.length);
    check(dr1.t < dr0.t - 1 && dr1.loose === 0 && dr2 === dr0.t, `deleting a track leaves no loose stubs of its route (${dr0.t - dr1.t} tracks and ${dr0.v - dr1.v} vias gone: "${dr1.msg}"); Ctrl+Z brings them back`);
    // a part moved after routing: Auto-route first clears the copper left where it was (loose ends, shorts, clearances)
    const ms0 = await bw.evaluate(() => { const S = BoardApp.state, k = S.model.parts.find(g => g.ref === "R1").key; S.board.parts[k].x += 8; S.board.parts[k].y += 4; BoardApp.commit(); return { t: S.board.tracks.length, bad: S.drc.filter(d => ["dangling", "short", "clearance"].includes(d.kind)).length }; });
    const ms1 = await bw.evaluate(() => { const S = BoardApp.state, n = BoardApp.clearStale(); BoardApp.commit(); return { n, bad: S.drc.filter(d => ["dangling", "short", "clearance"].includes(d.kind)).map(d => d.msg), un: S.conn.unrouted }; });
    await bw.keyboard.press("Control+z"); await bw.keyboard.press("Control+z"); await bw.waitForTimeout(200);
    check(ms0.bad > 0 && ms1.n > 0 && !ms1.bad.length && ms1.un > 0 && await bw.evaluate(t => BoardApp.state.board.tracks.length === t, ms0.t),
      `after R1 moves, ${ms0.bad} loose ends/clearance messages; before routing, ${ms1.n} pieces of old copper go and none is left (${ms1.un} connections to route)`);
    // Unroute: every track and via goes (a locked one stays), one step back with Ctrl+Z
    const ur0 = await bw.evaluate(() => { const b = BoardApp.state.board; b.tracks[0].locked = true; BoardApp.commit(); return { t: b.tracks.length, v: b.vias.length, un: BoardApp.state.conn.unrouted }; });
    await bw.click("#btn-unroute"); await bw.waitForTimeout(200);
    const ur1 = await bw.evaluate(() => { const b = BoardApp.state.board; return { t: b.tracks.length, v: b.vias.length, un: BoardApp.state.conn.unrouted, msg: document.getElementById("st-msg").textContent }; });
    await bw.keyboard.press("Control+z"); await bw.waitForTimeout(200);
    const ur2 = await bw.evaluate(() => { const b = BoardApp.state.board; b.tracks[0].locked = false; BoardApp.commit(); return { t: b.tracks.length, v: b.vias.length }; });
    check(ur0.t > 1 && ur1.t === 1 && ur1.v === 0 && ur1.un > ur0.un && /locked kept/.test(ur1.msg) && ur2.t === ur0.t && ur2.v === ur0.v,
      `Unroute removes ${ur0.t - 1} tracks and ${ur0.v} vias, keeps the locked one ("${ur1.msg}"); Ctrl+Z brings them back`);
    // Board ▾ → Freerouting…: an address typed as an IP gets the default port; both start commands name this page's address
    await bw.click("#btn-board"); await bw.click("#btn-router");
    const cmds = await bw.evaluate(() => [document.getElementById("router-cmd-java").textContent, document.getElementById("router-cmd-docker").textContent]);
    await bw.fill("#router-addr", "192.168.1.20"); await bw.click("#router-save");
    const addr = await bw.evaluate(() => [BoardApp.router.url, document.getElementById("router-modal").hidden]);
    check(addr[0] === "http://192.168.1.20:37864" && addr[1] && cmds.every(c => c.includes(`cors_origins=${new URL(U("")).origin}`)) && /docker run .*0\.0\.0\.0:37864/.test(cmds[1]),
      `the Freerouting dialog keeps another computer's address (${addr[0]}) and shows the Java and Docker commands for this page`);
    await bw.evaluate(() => { localStorage.removeItem("tubecad_router_url"); BoardApp.router.url = BoardRoute.DEFAULT_URL; });
    await ctx.unroute("http://127.0.0.1:37864/**");
    // a mounting hole made plated in the inspector, on GND: a ring the bottom pour joins, still no violations
    const [hx, hy] = await bw.evaluate(() => { const h = BoardApp.state.board.holes[3]; BoardApp.fit(); return BoardApp.toScreen(h.x, h.y); });
    const pcb = await bw.locator("#pcb").boundingBox();
    await bw.mouse.click(pcb.x + hx, pcb.y + hy);
    const sel = bw.locator("#inspector select").filter({ has: bw.locator("option[value=yes]") }).filter({ hasText: "Plated" });
    await sel.selectOption("yes");
    await bw.locator("#inspector select").filter({ hasText: "None (the screw only)" }).selectOption("GND");
    await bw.waitForTimeout(300);
    const ph = await bw.evaluate(() => { const S = BoardApp.state, h = S.board.holes[3], it = S.conn.items.find(x => x.kind === "hole" && x.hi === 3); return { h, net: it && S.model.names[it.net], drc: S.drc.map(d => d.msg), insp: document.getElementById("inspector").innerText }; });
    check(ph.h.plated && ph.h.net === "GND" && ph.net === "GND" && !ph.drc.length && /Ring Ø/.test(ph.insp), `the hole inspector makes a mounting hole plated on GND: a Ø ${ph.h.pad || 6} mm ring the GND pour joins (${ph.net}), ${ph.drc.length ? ph.drc.join("; ") : "no rule violations"}`);
    await bw.close();
    await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.updateInspector(); });
  }
}
