// Add part…: a part by its maker's part number: the model is found and downloaded, the package chosen, the part placed
import { cad, check, clickAt, state } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

{
  const fx = n => fileURLToPath(new URL(`../fixtures/${n}`, import.meta.url));
  // the list of models and the models' files come from the tests' own fixtures, not from the network
  const index = { source: "test", commit: "0".repeat(40), files: ["Models/Maker/Test/testamp.lib", "Models/Transistor/devices.lib"], names: "TESTAMP\t0\tX5\nQTEST\t1\tN\nQTESTP\t1\tP\nDTEST\t1\tD\nGONE\t1\tN\n" };
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
