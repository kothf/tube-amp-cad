// The parts library: KiCad symbols and footprints become the user's own parts, placed, simulated by a SPICE model, on the board
import { cad, check, U } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

{
  const fx = n => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url)), AMP = await readFile(fx("testamp.lib"), "utf8");
  await cad.evaluate(() => TubeCAD.library.ready.then(() => TubeCAD.library.clear()));
  const empty = await cad.evaluate(() => { const b = document.getElementById("pal-library"); return { button: !!b, group: [...document.querySelectorAll("#palette .pal-group")].some(g => /My library/.test(g.textContent)) }; });
  check(empty.button && empty.group, "the parts panel has My library with its Parts library… button");
  await cad.click("#pal-library");
  check(await cad.evaluate(() => !document.getElementById("plib-modal").hidden && /No parts yet/.test(document.getElementById("plib-body").textContent)), "Parts library… opens the dialog, empty at first");

  // a symbol library and a footprint together: the footprint is added, the symbols are offered
  await cad.setInputFiles("#plib-file", [fx("testparts.kicad_sym"), fx("DIP-8_TEST.kicad_mod")]);
  await cad.waitForSelector(".plib-olist");
  const offer = await cad.evaluate(() => [...document.querySelectorAll(".plib-olist input")].map(i => i.value));
  check(offer.join() === "TESTAMP,DUALAMP,DUALAMP-LN", `the file's symbols are offered, power symbols left out (${offer.join(", ")})`);
  await cad.fill("#plib-ofind", "dual op");
  check(await cad.evaluate(() => [...document.querySelectorAll(".plib-olist input")].map(i => i.value).join()) === "DUALAMP", "Find narrows the list by name and description");
  await cad.check('.plib-olist input[value="DUALAMP"]');
  await cad.fill("#plib-ofind", "");
  await cad.check('.plib-olist input[value="TESTAMP"]');
  await cad.click("#plib-take");
  await cad.waitForSelector(".plib-grid");
  const lib = await cad.evaluate(() => ({ parts: TubeCAD.library.get().parts.map(p => `${p.name}/${p.prefix}/${p.fp}/${p.units.length}`).join(" "), count: document.getElementById("plib-count").textContent,
    pal: [...document.querySelectorAll("#palette .pal-item")].filter(el => /TESTAMP|DUALAMP/.test(el.textContent)).length }));
  check(lib.parts === "DUALAMP/DA/DIP-8_TEST/3 TESTAMP/DA/DIP-8_TEST/1" && /2 parts, 1 footprint/.test(lib.count) && lib.pal === 2, `the ticked ones are parts now, each with the footprint that fits, and in the panel (${lib.parts})`);

  // the single op-amp: its picture, its footprint's picture, and a SPICE model on its own pins
  await cad.click('.plib-list button[data-id="testamp"]');
  check(await cad.evaluate(() => !!document.querySelector(".plib-sym img") && document.querySelectorAll(".plib-fp .pad").length === 8 && document.getElementById("plib-fp").value === "DIP-8_TEST"), "a part shows its drawing and its footprint (8 pads)");
  await cad.click("#plib-model");
  await cad.fill("#sppart-text", AMP);
  await cad.waitForFunction(() => !document.getElementById("sppart-ok").disabled, null, { timeout: 5000 }).catch(() => {});
  const dlg = await cad.evaluate(() => ({ sym: document.getElementById("sppart-sym").value, off: document.getElementById("sppart-sym").disabled, map: [...document.querySelectorAll("#sppart-pins select")].map(s => s.value).join(",") }));
  check(dlg.sym === "own" && dlg.off && dlg.map === "3,2,7,4,6", `Model…: the model's pins go on the part's own pins (${dlg.map})`);
  await cad.click("#sppart-ok");
  check(await cad.evaluate(() => /TESTAMP/.test(document.querySelector(".plib-model").textContent) && TubeCAD.library.part("testamp").spice.sub === "TESTAMP"), "the model is kept with the part in the library");

  // Place on the sheet, then an inverting ×10 stage around it
  await cad.click("#plib-place");
  const placing = await cad.evaluate(() => ({ shut: document.getElementById("plib-modal").hidden, type: TubeCAD.state.placing && TubeCAD.state.placing.type }));
  check(placing.shut && placing.type === "part", "Place on the sheet closes the dialog with the part on the pointer");
  const id = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.placing = null; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, p) => C.compPins(c).find(q => q.id === p);
    const wire = (p, q, hFirst) => C.lRoute(p.x, p.y, q.x, q.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const A = add("part", C.library.paramsOf("testamp"), 400, 300, 0), G = add("siggen", { amp: 0.5, freq: 100, rs: 0 }, 160, 400);
    const Ri = add("resistor", { r: 10e3 }, 260, 320, 0), Rf = add("resistor", { r: 100e3 }, 400, 180, 0), RL = add("resistor", { r: 10e3 }, 560, 380, 1);
    const P = add("vdc", { v: 15 }, 700, 140), N = add("vdc", { v: 15 }, 700, 520), g1 = add("ground", {}, 160, 480), g2 = add("ground", {}, 300, 220), g3 = add("ground", {}, 700, 220), g4 = add("ground", {}, 780, 500), g5 = add("ground", {}, 560, 460);
    wire(pin(G, "+"), pin(Ri, "1"), false); wire(pin(Ri, "2"), pin(A, "2")); wire(pin(G, "-"), pin(g1, "G"));
    wire(pin(A, "3"), pin(g2, "G"), true); wire(pin(Rf, "1"), pin(Ri, "2"), false); wire(pin(Rf, "2"), pin(A, "6"), false);
    wire(pin(A, "6"), pin(RL, "1")); wire(pin(RL, "2"), pin(g5, "G"));
    wire(pin(A, "7"), pin(P, "+"), false); wire(pin(P, "-"), pin(g3, "G")); wire(pin(A, "4"), pin(N, "-"), false); wire(pin(N, "+"), pin(g4, "G"));
    S.sel.comps.add(A.id); C.commit(); C.updateInspector();
    return A.id;
  });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 30000 }).catch(() => {});
  const run = await cad.evaluate(uid => {
    const C = TubeCAD, S = C.state, T = C.topo(), r = S.sim.result, w = r && r.tran && r.tran.nodes[T.pinNet.get(uid + ":6")];
    let lo = Infinity, hi = -Infinity; if (w) for (const x of w) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const c = S.comps.find(k => k.id === uid), saved = JSON.parse(C.circuitJSON()).comps.find(k => k.type === "part");
    return { err: S.sim.error, pp: hi - lo, label: c.label, issues: C.circuitIssues().join(" | "), insp: document.getElementById("inspector").textContent.replace(/\s+/g, " "),
      saved: !!(saved && saved.params.syms.length === 1 && saved.params.fp.pads.length === 8 && /\.SUBCKT TESTAMP/.test(saved.params.text)) };
  }, id);
  check(run.label === "DA1" && !run.err && Math.abs(run.pp - 10) < 0.05, `the stage around the library part runs on its model: 1 Vpp in, ${run.pp && run.pp.toFixed(3)} Vpp out (×−10), designator ${run.label}`);
  check(/from your parts library/.test(run.insp) && /Footprint DIP-8_TEST \(8 pads\)/.test(run.insp) && /Simulated by its SPICE subcircuit TESTAMP/i.test(run.insp), "the inspector says where it is from, its footprint and its model");
  check(run.saved, "the circuit file carries the part's drawing, footprint and model");
  const sp = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(/^X\S+ (\S+ ){5}TESTAMP$/m.test(sp) && /^\.SUBCKT TESTAMP inp inn vcc vee out$/m.test(sp), "SPICE export: the part as a subcircuit call with its model");

  // the board: the part's own footprint, the pads on the nets of the pins of their numbers
  const brd = await cad.evaluate(uid => {
    const nl = TubeCAD.boardNetlist(), g = BoardCore.physicalParts(nl).find(x => x.type === "part"), b = BoardCore.newBoard(); BoardCore.sync(b, nl);
    const m = BoardCore.model(b, nl), pads = m.pads.filter(p => p.part === g.key || p.ref === g.ref), T = TubeCAD.topo(), part = nl.parts.find(p => p.id === uid);
    return { fp: g.options[0], pads: pads.length, same: ["2", "3", "4", "6", "7"].every(n => (pads.find(p => String(p.num) === n) || {}).net === part.pins.find(q => q.id === n).net), free: ["1", "5", "8"].every(n => !(pads.find(p => String(p.num) === n) || {}).net), T: !!T };
  }, id);
  check(brd.fp === "LIB:DIP-8_TEST" && brd.pads === 8 && brd.same && brd.free, `on the board it has its own footprint, each pin on the pad of its number (${brd.fp}, ${brd.pads} pads)`);

  // a part of several units: the Unit list changes the drawing and the pins; it is not simulated
  const dual = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, c = C.makeComp("part", C.library.paramsOf("dualamp"), 900, 300, 0); S.comps.push(c); S.sel.comps.clear(); S.sel.comps.add(c.id); C.commit(); C.updateInspector();
    const sel = [...document.querySelectorAll("#inspector select")].find(s => [...s.options].some(o => /^B \(3 pins\)/.test(o.textContent)));
    const before = C.compPins(c).map(p => p.id).join();
    sel.value = "3"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    return { before, after: C.compPins(S.comps.find(k => k.id === c.id)).map(p => p.id).join(), model: !!document.getElementById("btn-spice-model"), id: c.id };
  });
  check(dual.before === "1,2,3" && dual.after === "8,4" && !dual.model, `a part of several units: the inspector's Unit list switches the drawing and its pins (${dual.before} → ${dual.after})`);
  await cad.evaluate(uid => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.id !== uid); TubeCAD.commit(); }, dual.id);

  // a part on the sheet follows the library when asked: the dialog and the inspector say it is behind, Update brings it up
  await cad.click("#pal-library");
  await cad.click('.plib-list button[data-id="testamp"]');
  const fresh = await cad.evaluate(() => ({ on: (document.querySelector(".plib-onsheet") || {}).textContent, old: !!document.querySelector(".plib-stale") }));
  await cad.fill("#plib-desc", "A test amplifier, changed"); await cad.press("#plib-desc", "Enter");
  const stale = await cad.evaluate(() => ({ text: (document.querySelector(".plib-stale") || {}).textContent, btn: !!document.getElementById("plib-update") }));
  check(/1 on the sheet, up to date/.test(fresh.on) && !fresh.old && /1 of this part on the sheet was placed before your changes/.test(stale.text) && stale.btn, "the library dialog says how many of a part are on the sheet, and when they are behind it");
  await cad.click("#plib-close");
  const behind = await cad.evaluate(uid => { const C = TubeCAD, S = C.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(uid); C.updateInspector(); return { note: (document.getElementById("insp-lib-old") || {}).textContent, btn: !!document.getElementById("btn-lib-update") }; }, id);
  check(/Its name in your parts library has changed since it was placed/.test(behind.note) && behind.btn, `the inspector of the placed part says its library part has changed (${behind.note})`);
  await cad.click("#btn-lib-update");
  const upd = await cad.evaluate(uid => { const c = TubeCAD.state.comps.find(k => k.id === uid); return { desc: c.params.desc, note: !!document.getElementById("insp-lib-old"), insp: document.getElementById("inspector").textContent, wires: TubeCAD.state.wires.length, model: c.params.sub }; }, id);
  check(upd.desc === "A test amplifier, changed" && !upd.note && /A test amplifier, changed/.test(upd.insp) && upd.model === "TESTAMP" && upd.wires > 0, "Update from the library: the part takes the library's version, its wires and model stay");
  await cad.click("#pal-library");
  await cad.click('.plib-list button[data-id="testamp"]');
  await cad.fill("#plib-desc", "A test amplifier"); await cad.press("#plib-desc", "Enter");
  await cad.click("#plib-update");
  const upd2 = await cad.evaluate(uid => ({ desc: TubeCAD.state.comps.find(k => k.id === uid).params.desc, on: (document.querySelector(".plib-onsheet") || {}).textContent, status: document.getElementById("status-text") ? document.getElementById("status-text").textContent : "" }), id);
  check(upd2.desc === "A test amplifier" && /1 on the sheet, up to date/.test(upd2.on), "Update it in the dialog brings every one on the sheet up to date");
  await cad.click("#plib-close");

  // New part…: the symbol editor. A box from a list of pins, a circle, a line, a text and a pin drawn; Undo; Save
  await cad.click("#pal-library");
  await cad.click("#plib-new");
  await cad.waitForSelector("#symed-svg");
  const pt = (x, y) => cad.evaluate(([x, y]) => { const s = document.getElementById("symed-svg"), q = s.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(s.getScreenCTM()); return [r.x, r.y]; }, [x, y]);
  const drawn = () => cad.evaluate(() => SymbolEditor.result()[SymbolEditor.state().u]);
  await cad.click(".symed-box summary");
  await cad.fill("#symed-list", "1 OUT\n2 IN-\n3 IN+\n4 V-\n5 NC\n6 NC\n7 NC\n8 V+");
  await cad.click("#symed-make");
  let d = await drawn();
  check(d.pins.length === 8 && d.pins.find(p => p.num === "8").x === 50 && d.pins.find(p => p.num === "1").name === "OUT" && d.g.length === 1, "New part… opens the drawing; a list of pins makes a box with them round it as on a DIP");
  await cad.click('#symed-tools [data-tool="circle"]');
  { const a = await pt(0, 0), b = await pt(15, 0); await cad.mouse.move(...a); await cad.mouse.down(); await cad.mouse.move(...b); await cad.mouse.up(); }
  await cad.click('#symed-tools [data-tool="line"]');
  for (const q of [[-20, -30], [20, -30], [20, -20]]) await cad.mouse.click(...await pt(...q));
  await cad.keyboard.press("Enter");
  await cad.click('#symed-tools [data-tool="text"]');
  await cad.mouse.click(...await pt(0, 30));
  await cad.fill("#symed-text", "AMP");
  await cad.click('#symed-tools [data-tool="pin"]');
  await cad.selectOption("#symed-side", "bottom");
  await cad.mouse.click(...await pt(0, 70));
  await cad.fill("#symed-name", "TAB");
  d = await drawn();
  const tab = d.pins.find(p => p.name === "TAB");
  check(JSON.stringify(d.g.slice(1)) === JSON.stringify([["c", 0, 0, 0, 15], ["p", 0, -20, -30, 20, -30, 20, -20], ["t", 0, 30, 10, "AMP"]]) && tab && tab.num === "9" && tab.x === 0 && tab.y === 70 && tab.a === 90, "a circle, a line of three points, a text and a pin on the bottom are drawn where clicked, the pin numbered on");
  // a pin dragged with Select moves on the grid; a number used twice stops the save and is said
  await cad.click('#symed-tools [data-tool="select"]');
  { const a = await pt(0, 62), b = await pt(21, 62); await cad.mouse.move(...a); await cad.mouse.down(); await cad.mouse.move(...b, { steps: 3 }); await cad.mouse.up(); }
  d = await drawn();
  check(d.pins.find(p => p.name === "TAB").x === 20, "Select drags a pin, on the sheet's grid");
  await cad.fill("#symed-num", "8");
  const dup = await cad.evaluate(() => ({ off: document.getElementById("symed-ok").disabled, msg: document.getElementById("symed-msg").textContent }));
  check(dup.off && /Pin number 8 is used twice/.test(dup.msg), `a pin number used twice is refused (${dup.msg})`);
  await cad.fill("#symed-num", "9");
  await cad.click("#symed-undo");
  // + Unit: a second unit with the same body and its own pins
  await cad.click("#symed-addunit");
  await cad.click('#symed-tools [data-tool="pin"]');
  await cad.mouse.click(...await pt(-50, 0));
  const u2 = await cad.evaluate(() => ({ n: SymbolEditor.state().units.length, pin: SymbolEditor.result()[1].pins.map(p => p.num).join(), ok: !document.getElementById("symed-ok").disabled }));
  check(u2.n === 2 && u2.pin === "10" && u2.ok, "+ Unit adds a unit of the package; its pins are numbered on from the other units'");
  await cad.click("#symed-ok");
  const made = await cad.evaluate(() => { const p = TubeCAD.library.get().parts.find(x => x.name === "New part"); return p && { units: p.units.map(u => u.pins.length).join(), src: p.src, pal: [...document.querySelectorAll("#palette .pal-item")].some(el => /New part/.test(el.textContent)), shown: !document.getElementById("plib-modal").hidden && document.getElementById("plib-name").value }; });
  check(made && made.units === "9,1" && made.src === "drawn here" && made.pal && made.shown === "New part", "Save the drawing: the part is in the library and in the panel");
  // Edit drawing… changes it; Duplicate makes a second part; a part placed before keeps its own copy
  await cad.click("#plib-draw");
  await cad.waitForSelector("#symed-svg");
  await cad.click("#symed-delunit");
  await cad.click("#symed-ok");
  await cad.click("#plib-copy");
  const two = await cad.evaluate(() => TubeCAD.library.get().parts.filter(x => /^New part/.test(x.name)).map(x => `${x.name}:${x.units.length}`).join());
  check(two === "New part:1,New part copy:1", `Edit drawing… and Duplicate (${two})`);
  // the footprint editor: Draw… makes pads for the part's pins; a usual package; a pad, a hole and silkscreen by hand; names; Edit… renames
  await cad.evaluate(() => { const id = TubeCAD.library.get().parts.find(x => x.name === "New part").id; document.querySelector(`.plib-list button[data-id="${id}"]`).click(); });
  await cad.click("#plib-fpnew");
  await cad.waitForSelector("#fped-svg");
  const fpt = (x, y) => cad.evaluate(([x, y]) => { const s = document.getElementById("fped-svg"), q = s.createSVGPoint(); q.x = x; q.y = y; const r = q.matrixTransform(s.getScreenCTM()); return [r.x, r.y]; }, [x, y]);
  const fp = () => cad.evaluate(() => FootprintEditor.result());
  const fmsg = () => cad.evaluate(() => ({ off: document.getElementById("fped-ok").disabled, msg: document.getElementById("fped-msg").textContent }));
  let f = await fp();
  check(f.name === "New part" && f.pads.length === 1 && f.pads[0].drill > 0 && f.pads[0].num === "10", `Draw… starts a footprint for the part's pins: here one drilled pad, numbered ${f.pads[0].num} as the pin`);
  await cad.click("#fped-pat summary");
  await cad.selectOption("#fped-pkind", "dip");
  await cad.fill("#fped-p-n", "8");
  await cad.click("#fped-make");
  f = await fp(); let fm = await fmsg();
  check(f.pads.length === 8 && f.pads[0].x === -3.81 && f.pads[0].shape === "rect" && /No pad for pin 10 /.test(fm.msg) && !fm.off, `Make a usual package: a DIP of 8, and the pin left without a pad is named (${fm.msg})`);
  await cad.click('#fped-tools [data-tool="pad"]');
  await cad.mouse.click(...await fpt(0, 0));
  f = await fp(); fm = await fmsg();
  check(f.pads.length === 9 && f.pads[8].num === "10" && f.pads[8].x === 0 && f.pads[8].drill === 0.8 && !fm.msg, "the Pad tool: the new pad takes the part's pin that had none");
  await cad.click('#fped-tools [data-tool="select"]');
  await cad.mouse.click(...await fpt(0, 0));
  await cad.fill("#fped-y", "2,54"); await cad.dispatchEvent("#fped-y", "change");
  await cad.selectOption("#fped-kind", "smd");
  await cad.fill("#fped-w", "3"); await cad.dispatchEvent("#fped-w", "change");
  f = await fp();
  check(f.pads[8].y === 2.54 && f.pads[8].smd && f.pads[8].drill === 0 && f.pads[8].w === 3 && !f.smd, "a pad's place, size and mounting are typed at the right (a comma for the decimal point works)");
  { const [x1, y1] = await fpt(0, 2.54), [x2, y2] = await fpt(0, 0); await cad.mouse.move(x1, y1); await cad.mouse.down(); await cad.mouse.move((x1 + x2) / 2, (y1 + y2) / 2); await cad.mouse.move(x2, y2); await cad.mouse.up(); }
  check((await fp()).pads[8].y === 0, "a pad is dragged on the grid");
  await cad.click('#fped-tools [data-tool="hole"]');
  await cad.mouse.click(...await fpt(0, -2.54));
  await cad.click('#fped-tools [data-tool="rect"]');
  { const [x1, y1] = await fpt(-6.35, -6.35), [x2, y2] = await fpt(6.35, 6.35); await cad.mouse.move(x1, y1); await cad.mouse.down(); await cad.mouse.move(x2 - 5, y2 - 5); await cad.mouse.move(x2, y2); await cad.mouse.up(); }
  await cad.click('#fped-tools [data-tool="circle"]');
  { const [x1, y1] = await fpt(-5.08, -5.08), [x2, y2] = await fpt(-5.08, -3.81); await cad.mouse.move(x1, y1); await cad.mouse.down(); await cad.mouse.move(x2, y2); await cad.mouse.up(); }
  const silk0 = (await cad.evaluate(() => FootprintEditor.state().f.silk.length));
  await cad.click("#fped-undo");
  f = await fp();
  check(f.holes.length === 1 && f.holes[0].d === 3.2 && silk0 - f.silk.length === 1 && f.silk.filter(g => g.x1 === -6.35 || g.x2 === -6.35).length >= 2 && f.box[0] === -6.35, `a hole, a silkscreen rectangle and a circle; Undo takes the circle back (box ${f.box.join(" ")})`);
  await cad.fill("#fped-name", "");
  const noName = await fmsg();
  await cad.fill("#fped-name", "dip-8_test");
  const taken = await fmsg();
  await cad.fill("#fped-name", "MY-DIP9");
  check(noName.off && taken.off && /Another footprint is called/.test(taken.msg) && !(await fmsg()).off, "a footprint needs a name no other has");
  await cad.click("#fped-ok");
  const stored = await cad.evaluate(() => { const L = TubeCAD.library.get(), p = L.parts.find(x => x.name === "New part"); return { fp: p.fp, pads: (L.footprints["MY-DIP9"] || { pads: [] }).pads.length, sel: document.getElementById("plib-fp").value, warn: !!document.querySelector(".plib-warn"), pic: !!document.querySelector(".plib-fp") }; });
  check(stored.fp === "MY-DIP9" && stored.pads === 9 && stored.sel === "MY-DIP9" && !stored.warn && stored.pic, "Save the footprint: it is in the library and the part has it");
  await cad.click("#plib-fpedit");
  await cad.waitForSelector("#fped-svg");
  await cad.fill("#fped-name", "MY-DIP9B");
  await cad.click("#fped-ok");
  const renamed = await cad.evaluate(() => { const L = TubeCAD.library.get(); return { fp: L.parts.find(x => x.name === "New part").fp, old: !!L.footprints["MY-DIP9"], now: !!L.footprints["MY-DIP9B"] }; });
  check(renamed.fp === "MY-DIP9B" && !renamed.old && renamed.now, "Edit… under a new name: the part follows");
  const onBoard = await cad.evaluate(() => { const L = TubeCAD.library, id = L.get().parts.find(x => x.name === "New part").id, prm = L.paramsOf(id); return { fp: prm.fp && prm.fp.name, pads: prm.fp && prm.fp.pads.length }; });
  check(onBoard.fp === "MY-DIP9B" && onBoard.pads === 9, "a part placed from the library carries the drawn footprint");
  await cad.evaluate(() => { const L = TubeCAD.library.get(); delete L.footprints["MY-DIP9B"]; });
  await cad.evaluate(() => { const L = TubeCAD.library; L.get().parts.filter(x => /^New part/.test(x.name)).map(x => x.id).forEach(id => { document.querySelector(`.plib-list button[data-id="${id}"]`).click(); document.getElementById("plib-del").click(); }); });
  check(await cad.evaluate(() => TubeCAD.library.get().parts.length) === 2, "Delete the part removes it from the library");
  await cad.click("#plib-close");

  // the library as a file; it is still there in a new page; a circuit with the part opens without the library
  await cad.click("#pal-library");
  const [dl] = await Promise.all([cad.waitForEvent("download"), cad.click("#plib-save")]);
  const file = JSON.parse(await readFile(await dl.path(), "utf8"));
  check(dl.suggestedFilename() === "my-parts.tubelib" && file.format === "tubecad-library" && file.parts.length === 2 && !!file.footprints["DIP-8_TEST"], `Save as a file: ${dl.suggestedFilename()} with ${file.parts.length} parts and their footprint`);
  await cad.click("#plib-close");
  const json = await cad.evaluate(() => TubeCAD.circuitJSON());
  const p2 = await cad.context().newPage();
  await p2.goto(U("circuit_sandbox.html")); await p2.waitForFunction(() => window.TubeCAD);
  const kept = await p2.evaluate(async () => { await TubeCAD.library.ready; return { n: TubeCAD.library.get().parts.length, model: !!(TubeCAD.library.part("testamp") || {}).spice, pal: [...document.querySelectorAll("#palette .pal-item")].filter(el => /TESTAMP|DUALAMP/.test(el.textContent)).length }; });
  check(kept.n === 2 && kept.model && kept.pal === 2, "the library is kept in the browser: a new window has the parts, with the model");
  const alone = await p2.evaluate(async json => {
    await TubeCAD.library.clear(); TubeCAD.openText(json, "lib-part.json");
    const c = TubeCAD.state.comps.find(k => k.type === "part");
    return { pins: TubeCAD.compPins(c).length, fp: BoardCore.physicalParts(TubeCAD.boardNetlist()).find(x => x.type === "part").options[0], left: TubeCAD.library.get().parts.length };
  }, json);
  check(alone.pins === 5 && alone.fp === "LIB:DIP-8_TEST" && alone.left === 0, "a circuit with a library part opens where the library does not have it: the part carries everything");
  // and the file brings the library back
  await p2.click("#pal-library");
  await p2.setInputFiles("#plib-file", await dl.path());
  await p2.waitForSelector(".plib-grid");
  check(await p2.evaluate(() => TubeCAD.library.get().parts.length === 2 && !!TubeCAD.library.part("testamp").spice), "Open a library file… adds its parts back, model and all");
  await p2.evaluate(() => TubeCAD.library.clear());
  await p2.close();
  await cad.evaluate(() => TubeCAD.library.ready.then(() => TubeCAD.library.clear()));
}
