// Add part…: a part by its maker's part number: the model is found and downloaded, the package chosen, the part placed
import { cad, check, clickAt, state } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

{
  const fx = n => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));
  // the list of models and the models' files come from the tests' own fixtures, not from the network
  const index = { source: "test", commit: "0".repeat(40), files: ["Models/Maker/Test/testamp.lib", "Models/Transistor/devices.lib", "Models/Maker/Test/oddparts.lib"],
    names: "TESTAMP\t0\tX5\nQTEST\t1\tN\nQTESTP\t1\tP\nDTEST\t1\tD\nGONE\t1\tN\nTST7805\t2\tX3\nTST317\t2\tX3\nOPTOTEST\t2\tX4\nTST393\t2\tX5\nBZXTEST\t2\tD\nTSTNET\t2\tX3\n" };
  let asked = [];
  await cad.route(/spice-index\.json/, r => r.fulfill({ contentType: "application/json", body: JSON.stringify(index) }));
  await cad.route(/raw\.githubusercontent\.com/, async r => { const name = decodeURIComponent(r.request().url().split("/").pop()); asked.push(name); r.fulfill({ contentType: "text/plain", body: await readFile(fx(name)) }); });
  await cad.evaluate(() => { SpiceFind.reset(); TubeCAD.newCircuit(); return TubeCAD.library.ready.then(() => TubeCAD.library.clear()); });
  const pending = () => cad.waitForFunction(() => { const s = TubeCAD.addPart.state(); return s && (s.model || /⚠|No model/.test(document.getElementById("addpart-msg").textContent)); });

  check(await cad.evaluate(() => !!document.getElementById("pal-add")), "the parts panel has + Add part… in My library");
  await cad.click("#pal-add");
  check(await cad.evaluate(() => !document.getElementById("addpart-modal").hidden && document.activeElement.id === "addpart-pn" && document.getElementById("addpart-ok").disabled), "it opens a dialog that asks for the part number");

  // a transistor: found, drawn as an NPN, the usual case and pin order offered
  await cad.fill("#addpart-pn", "qtest"); await cad.press("#addpart-pn", "Enter"); await pending();
  const q = await cad.evaluate(() => { const s = TubeCAD.addPart.state(); return { sym: s.sym, pkg: document.getElementById("addpart-pkg").value, order: document.getElementById("addpart-order").value, pic: document.getElementById("addpart-pic").src.length > 100, cand: [...document.getElementById("addpart-cand").options].map(o => o.value).length, text: document.getElementById("addpart-body").textContent }; });
  check(q.sym === "npn" && q.pkg === "TO-92" && q.order === "EBC" && q.pic && /NPN/i.test(q.text) && asked.join() === "devices.lib", `the model is downloaded and the part shown: an NPN in ${q.pkg}, pins ${q.order}`);
  check(q.cand === 2, "the other models the number may mean are listed");
  await cad.selectOption("#addpart-pkg", "TO-220");
  check(await cad.evaluate(() => document.getElementById("addpart-order").value) === "BCE", "another case brings its own usual pin order");
  await cad.selectOption("#addpart-pkg", "TO-92"); await cad.selectOption("#addpart-order", "CBE");
  await cad.click("#addpart-ok");
  await clickAt(300, 200); await cad.keyboard.press("Escape");
  let s = await state(); const t = s.comps.find(c => c.type === "spice");
  check(!!t && t.params.partno === "qtest" && t.params.part.fp === "TO-92-CBE" && t.params.sub.toUpperCase() === "QTEST" && t.params.part.text === "TO-92" && /QTEST/.test(t.params.text) && !/DTEST/.test(t.params.text), "Place on the sheet puts it there with its model, part number and package");
  const g = await cad.evaluate(() => BoardCore.physicalParts(TubeCAD.boardNetlist()).find(x => x.type === "spice").defaultFp);
  check(g === "TO-92-CBE", `the board takes the chosen package (${g})`);

  // an op-amp with its ordering letters; as a dual it becomes a part of the library, all units placed together
  await cad.evaluate(() => TubeCAD.addPart.open("TESTAMP-CP")); await pending();
  const a = await cad.evaluate(() => ({ sym: TubeCAD.addPart.state().sym, amps: document.getElementById("addpart-amps").value, pkg: document.getElementById("addpart-pkg").value, near: /the nearest to TESTAMP-CP/.test(document.getElementById("addpart-body").textContent) }));
  check(a.sym === "opamp" && a.amps === "1" && a.pkg === "DIP-8" && a.near, "TESTAMP-CP finds TESTAMP, an op-amp in a DIP-8");
  await cad.selectOption("#addpart-amps", "2"); await cad.selectOption("#addpart-pkg", "SOIC-8");
  await cad.click("#addpart-ok");
  await clickAt(500, 200); await cad.keyboard.press("Escape");
  s = await state(); const units = s.comps.filter(c => c.type === "part").map(c => c.label).sort();
  const lib = await cad.evaluate(() => { const p = TubeCAD.library.get().parts[0]; return { n: TubeCAD.library.get().parts.length, name: p && p.name, fp: p && p.fp, model: !!(p && p.spice), pal: [...document.querySelectorAll("#palette .pal-item")].some(el => /TESTAMP/.test(el.textContent)) }; });
  check(units.length === 3 && /\.1$/.test(units[0]) && /\.3$/.test(units[2]) && units.every(u => u.split(".")[0] === units[0].split(".")[0]), `a dual: both amplifiers and the supply unit are placed together (${units.join(", ")})`);
  check(lib.n === 1 && lib.name === "TESTAMP" && lib.fp === "SOIC-8" && lib.model && lib.pal, "and the part is in My library with its footprint and model");
  const pk = await cad.evaluate(() => { const g = BoardCore.physicalParts(TubeCAD.boardNetlist()).find(x => x.type === "part"); return { fp: g.defaultFp, members: g.members.length }; });
  check(pk.fp === "LIB:SOIC-8" && pk.members === 3, `one package on the board for its units (${pk.fp})`);

  // a number the app has a part of its own for: that part is offered first
  await cad.evaluate(() => TubeCAD.addPart.open("2N3904BU")); await pending();
  const own = await cad.evaluate(() => ({ own: !!TubeCAD.addPart.state().model.own, note: !!document.getElementById("addpart-own"), text: document.getElementById("addpart-body").textContent, pkg: !!document.getElementById("addpart-pkg") }));
  check(own.own && own.note && /2N3904/.test(own.text) && /Built into the app/.test(own.text) && !own.pkg, "2N3904BU: the app's own 2N3904 is offered, built in");
  await cad.click("#addpart-ok");
  await clickAt(700, 200); await cad.keyboard.press("Escape");
  s = await state(); const bi = s.comps.find(c => c.type === "npn");
  check(!!bi && bi.params.model === "2N3904" && bi.params.partno === "2N3904BU", "and placed as the built-in transistor, with the number typed");

  // a regulator whose model numbers its pins: drawn as a regulator, its pins found in a test circuit, its usual case and pin order offered
  await cad.evaluate(() => TubeCAD.addPart.open("TST7805")); await pending();
  const rg = await cad.evaluate(() => { const st = TubeCAD.addPart.state(), g = id => document.getElementById(id); return { sym: st.sym, how: st.how, map: st.map.join(""), pkg: g("addpart-pkg").value, order: g("addpart-order").value, text: g("addpart-body").textContent, open: g("addpart-pins").open, rows: document.querySelectorAll(".addpart-pin select").length }; });
  check(rg.sym === "reg" && rg.how === "probe" && rg.map === "IGO" && /Voltage regulator/.test(rg.text) && /test circuit/.test(rg.text), `TST7805 is drawn as a regulator, its pins found in a test circuit (${rg.map})`);
  check(rg.pkg === "TO-220" && rg.order === "IGO" && !rg.open && rg.rows === 3, `in a ${rg.pkg}, pins ${rg.order}; the model's pins can be looked at`);
  // the pins can be set by hand: one given twice is refused until put right
  await cad.evaluate(() => { document.getElementById("addpart-pins").open = true; });
  await cad.locator(".addpart-pin select").nth(0).selectOption("O");
  check(await cad.evaluate(() => document.getElementById("addpart-ok").disabled && !!document.getElementById("addpart-pinbad") && document.getElementById("addpart-pins").open), "a pin given to two pins of the model is said, and the part is not placed");
  await cad.locator(".addpart-pin select").nth(0).selectOption("I");
  check(await cad.evaluate(() => !document.getElementById("addpart-ok").disabled && !document.getElementById("addpart-pinbad")), "put right, it can be placed");
  await cad.click("#addpart-ok");
  await clickAt(300, 420); await cad.keyboard.press("Escape");
  s = await state(); const reg = s.comps.find(c => c.type === "spice" && c.params.sym === "reg");
  check(!!reg && reg.params.map.join("") === "IGO" && reg.params.part.fp === "TO-220-IGO" && /^DA/.test(reg.label), `placed as ${reg && reg.label} with its package`);
  const rsim = await cad.evaluate(c => {
    // 12 V in, 500 Ω on the output: about 5 V out
    const els = [{ id: "v", kind: "V", nodes: [1, 0], v: 12 }, { id: "l", kind: "R", nodes: [2, 0], r: 500 }]; let n = 3;
    CadLib.LIB.spice.build(c, pin => ({ I: 1, O: 2 }[pin] || 0), () => n++, els);
    const dc = TubeSimEngine.dcOperatingPoint(TubeSimEngine.buildCircuit({ nodeCount: n, elements: els })); return dc.ok ? dc.x[1] : NaN;
  }, reg);
  check(Math.abs(rsim - 5) < 0.2, `and it regulates: ${rsim.toFixed(2)} V from 12 V`);
  // an adjustable one says ADJ; an optocoupler, a comparator (a dual by its number) and a zener take their drawings
  await cad.evaluate(() => TubeCAD.addPart.open("TST317")); await pending();
  check(await cad.evaluate(() => { const st = TubeCAD.addPart.state(); return st.sym === "reg" && st.adj && st.how === "names" && TubeCAD.addPart.params().adj === true && document.getElementById("addpart-order").value === "GOI"; }), "TST317: an adjustable regulator, its pins read from the model's note (ADJ OUT IN)");
  await cad.evaluate(() => TubeCAD.addPart.open("OPTOTEST")); await pending();
  const op = await cad.evaluate(() => ({ sym: TubeCAD.addPart.state().sym, map: TubeCAD.addPart.state().map.join(""), pkg: document.getElementById("addpart-pkg").value }));
  check(op.sym === "opto" && op.map === "AKEC" && op.pkg === "DIP-4", `OPTOTEST: an optocoupler in a ${op.pkg}, LED and transistor found (${op.map})`);
  await cad.click("#addpart-ok"); await clickAt(450, 420); await cad.keyboard.press("Escape");
  s = await state(); const opt = s.comps.find(c => c.type === "spice" && c.params.sym === "opto");
  check(!!opt && /^U/.test(opt.label) && opt.params.part.fp === "DIP-4", `placed as ${opt && opt.label}`);
  await cad.evaluate(() => TubeCAD.addPart.open("TST393")); await pending();
  const cm = await cad.evaluate(() => ({ sym: TubeCAD.addPart.state().sym, amps: document.getElementById("addpart-amps").value, text: document.getElementById("addpart-body").textContent }));
  check(cm.sym === "comp" && cm.amps === "2" && /open collector/.test(cm.text) && /Comparators in the package/.test(cm.text), "TST393: a comparator, a dual by its number, with the word on its open collector");
  await cad.click("#addpart-ok"); await clickAt(600, 420); await cad.keyboard.press("Escape");
  const cl = await cad.evaluate(() => { const p = TubeCAD.library.get().parts.find(x => x.name === "TST393"); return p && { desc: p.desc, units: p.units.length, model: !!p.spice }; });
  check(!!cl && cl.desc === "Dual comparator" && cl.units === 3 && cl.model, "the dual goes to My library as a dual comparator with its model");
  await cad.evaluate(() => TubeCAD.addPart.open("BZXTEST")); await pending();
  check(await cad.evaluate(() => TubeCAD.addPart.state().sym === "zener" && /Zener/.test(document.getElementById("addpart-body").textContent)), "BZXTEST: a zener diode");
  await cad.evaluate(() => TubeCAD.addPart.open("TSTNET")); await pending();
  check(await cad.evaluate(() => TubeCAD.addPart.state().sym === "box" && !document.getElementById("addpart-pins")), "what is none of these stays a box with the model's pins");
  await cad.click("#addpart-cancel");

  // not in the library: said plainly, with the way on
  await cad.evaluate(() => TubeCAD.addPart.open("ZZZ99999")); await pending();
  check(await cad.evaluate(() => /No model of ZZZ99999/.test(document.getElementById("addpart-msg").textContent) && document.getElementById("addpart-ok").disabled && !!document.getElementById("addpart-paste")), "a number the library does not have: said so, with “I have the model file…”");
  await cad.click("#addpart-paste");
  check(await cad.evaluate(() => document.getElementById("addpart-modal").hidden && !document.getElementById("sppart-modal").hidden), "which opens the SPICE model dialog");
  await cad.click("#sppart-cancel");
  // a model the list names but its file has not
  await cad.evaluate(() => TubeCAD.addPart.open("GONE")); await pending();
  check(await cad.evaluate(() => /⚠ GONE/.test(document.getElementById("addpart-msg").textContent) && document.getElementById("addpart-ok").disabled), "a model that cannot be read is said, nothing is placed");
  await cad.click("#addpart-cancel");

  // searching the panel for a number it does not know offers to add it
  await cad.fill("#pal-search", "QTEST-1");
  await cad.waitForSelector("#pal-add-found");
  await cad.click("#pal-add-found"); await pending();
  const f = await cad.evaluate(() => ({ pn: document.getElementById("addpart-pn").value, sym: TubeCAD.addPart.state().sym }));
  check(f.pn === "QTEST-1" && f.sym === "npn", "the search's “Add … by its part number” opens it with the number");
  await cad.fill("#addpart-pn", "DTEST"); await cad.click("#addpart-find"); await pending();
  const d = await cad.evaluate(() => ({ sym: TubeCAD.addPart.state().sym, pkg: document.getElementById("addpart-pkg").selectedOptions[0].textContent }));
  check(d.sym === "diode" && /DO-41/.test(d.pkg), `a diode is offered in its usual case (${d.pkg})`);
  await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => document.getElementById("addpart-modal").hidden), "Esc closes the dialog");
  await cad.fill("#pal-search", "");
  await cad.unroute(/spice-index\.json/); await cad.unroute(/raw\.githubusercontent\.com/);
  await cad.evaluate(() => { SpiceFind.reset(); TubeCAD.newCircuit(); return TubeCAD.library.clear(); });
}
