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
