// Hierarchical sheets: a stage of example 03 made a sheet (nets kept), stepped into and out of,
// a second instance with designators of its own, values and new parts going to every instance,
// a sheet inside a sheet, the file, KiCad sheets and the simulation; a sheet from the palette
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  await cad.evaluate(() => { window.confirm = () => true; return TubeCAD.openExample(TubeCAD.EXAMPLES.find(e => e.file.startsWith("03"))); });
  await cad.waitForTimeout(800);
  // every real part's pin, grouped by the net it is on (sheet symbols, ports, labels left out)
  const NETS = () => {
    const S = TubeCAD.state, T = TubeCAD.topo(), m = new Map();
    S.comps.forEach(c => { if (["hport", "sheetsym", "offsheet", "frame", "note", "ground", "rail"].includes(c.type) || !c.label) return; TubeCAD.compPins(c).forEach(p => { const k = T.pinNet.get(c.id + ":" + p.id); if (k === undefined) return; if (!m.has(k)) m.set(k, []); m.get(k).push(c.label + "." + p.id); }); });
    const gnd = new Set(S.comps.filter(c => c.type === "ground").map(c => T.pinNet.get(c.id + ":G")));
    return [...m.entries()].map(([k, v]) => (gnd.has(k) ? "G:" : "") + v.sort().join(",")).sort().join(" | ");
  };
  await cad.evaluate(f => { window.__nets = new Function("return (" + f + ")")(); }, NETS.toString());
  const made = await cad.evaluate(() => {
    const S = TubeCAD.state, before = window.__nets();
    const parts = S.comps.filter(c => !["frame", "note"].includes(c.type));
    const xs = parts.map(c => c.x).sort((a, b) => a - b), mid = xs[Math.floor(xs.length / 2)];
    S.sel.comps.clear(); S.sel.wires.clear();
    parts.filter(c => (c.x < mid || c.label === "VL2") && !["ground", "rail", "vdc"].includes(c.type)).forEach(c => S.sel.comps.add(c.id));
    const def = TubeCAD.hier.makeFromSelection("Stage");
    const sym = S.comps.find(c => c.type === "sheetsym");
    return { ok: !!def, same: before === window.__nets(), pins: sym ? sym.params.pins.length : 0, frames: TubeCAD.frames().length, ports: S.comps.filter(c => c.type === "hport").length, status: document.getElementById("status-sim").textContent };
  });
  check(made.ok && made.same, `Make sheet: the stage moves to a sheet of its own and every net stays as it was (${made.ports} ports, ${made.pins} pins on the symbol)`);
  check(made.frames === 2 && made.pins === made.ports && made.pins >= 3 && made.pins <= 6, "one sheet more, one symbol pin per port, ground tied by ground symbols instead of ports");

  // double-click steps in, Alt+Backspace steps out with the symbol selected
  const pos = await cad.evaluate(() => { const s = TubeCAD.state.comps.find(c => c.type === "sheetsym"); TubeCAD.fitSheet(TubeCAD.frames()[0]); const v = TubeCAD.state.view, b = document.getElementById("cad").getBoundingClientRect(); return [b.left + (s.x + s.params.w / 2) * v.scale + v.ox, b.top + (s.y + s.params.h / 2) * v.scale + v.oy]; });
  await cad.mouse.dblclick(pos[0], pos[1]);
  await cad.waitForTimeout(200);
  const inside = await cad.evaluate(() => { const f = TubeCAD.frames()[TubeCAD.viewedSheet()]; return { sheetOf: !!(f && f.sheetOf), status: document.getElementById("status-sim").textContent }; });
  check(inside.sheetOf, "a double-click on the symbol shows its sheet");
  await cad.keyboard.press("Alt+Backspace");
  await cad.waitForTimeout(200);
  const back = await cad.evaluate(() => { const S = TubeCAD.state, f = TubeCAD.frames()[TubeCAD.viewedSheet()]; const s = S.comps.find(c => c.type === "sheetsym"); return { top: !!f && !f.sheetOf, sel: S.sel.comps.has(s.id) }; });
  check(back.top && back.sel, "Alt+Backspace goes back up with the symbol selected");

  // a second instance: own designators, values and new parts shared
  const two = await cad.evaluate(() => {
    const S = TubeCAD.state, H = TubeCAD.hier, def = S.blocks.find(b => b.sheet);
    H.dropSymbol(def, 1400, 900);
    const syms = S.comps.filter(c => c.type === "sheetsym");
    const labels = i => S.comps.filter(c => c.block && c.block.i === i && c.label && c.type !== "ground").map(c => c.label);
    const l1 = labels(syms[0].params.inst), l2 = labels(syms[1].params.inst);
    const r2 = S.comps.find(c => c.block && c.block.i === syms[1].params.inst && c.type === "resistor");
    r2.params.r = 12345; S.sel.comps.clear(); S.sel.comps.add(r2.id); TubeCAD.commit();
    const v1 = S.comps.find(c => c.block && c.block.i === syms[0].params.inst && c.block.m === r2.block.m).params.r;
    const f1 = H.frameOf(syms[0].params.inst), nc = TubeCAD.makeComp("capacitor", {}, f1.x + 200, f1.y + 200, 0);
    S.comps.push(nc); S.sel.comps.clear(); S.sel.comps.add(nc.id); TubeCAD.commit();
    const caps = syms.map(s => S.comps.filter(c => c.block && c.block.i === s.params.inst && c.type === "capacitor").length);
    return { frames: TubeCAD.frames().length, n1: l1.length, n2: l2.length, shared: l1.filter(l => l2.includes(l)), v1, caps, title: syms[1].params.title };
  });
  check(two.frames === 3 && two.n1 === two.n2 && !two.shared.length && two.title === "B", `a second instance gets a sheet and designators of its own (${two.n2} parts, named “B”)`);
  check(two.v1 === 12345 && two.caps[0] === two.caps[1] && two.caps[0] >= 1, "a value edited on one instance's sheet and a part added on the other's reach both");

  // delete the second symbol: its sheet and parts go; Undo brings them back
  const del = await cad.evaluate(() => {
    const S = TubeCAD.state, s = S.comps.filter(c => c.type === "sheetsym")[1], n = S.comps.length;
    S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(s.id); TubeCAD.deleteSelection();
    const after = { frames: TubeCAD.frames().length, gone: n - S.comps.length };
    TubeCAD.undo();
    return { after, frames: TubeCAD.frames().length, syms: S.comps.filter(c => c.type === "sheetsym").length };
  });
  check(del.after.frames === 2 && del.after.gone > 10 && del.frames === 3 && del.syms === 2, `deleting a sheet symbol takes its sheet away (${del.after.gone} parts); Undo restores it`);

  // a sheet inside the first instance's sheet, made from a box round the first triode
  const nest = await cad.evaluate(() => {
    const S = TubeCAD.state, H = TubeCAD.hier, inst = S.comps.find(c => c.type === "sheetsym").params.inst, before = window.__nets();
    const five = S.comps.filter(c => c.block && c.block.i === inst && ["R1", "R2", "R3", "C1", "VL1"].includes(c.label));
    const X1 = Math.min(...five.map(c => c.x)) - 40, X2 = Math.max(...five.map(c => c.x)) + 40, Y1 = Math.min(...five.map(c => c.y)) - 60, Y2 = Math.max(...five.map(c => c.y)) + 60;
    S.sel.comps.clear(); S.sel.wires.clear();
    S.comps.filter(c => c.type !== "frame" && c.x > X1 && c.x < X2 && c.y > Y1 && c.y < Y2).forEach(c => S.sel.comps.add(c.id));
    const def = H.makeFromSelection("Triode");
    const labels = S.comps.filter(c => c.label && !["hport", "sheetsym", "ground"].includes(c.type)).map(c => c.label);
    const inner = S.comps.filter(c => c.type === "resistor" && c.block && def && c.block.d === def.id);
    return { ok: !!def, depth: TubeCAD.frames().map(f => H.depth(f)).sort().join(""), dup: labels.filter((l, i) => labels.indexOf(l) !== i), inner: inner.length, same: before.split(" | ").length === window.__nets().split(" | ").length };
  });
  check(nest.ok && nest.depth === "01122" && !nest.dup.length && nest.inner === 6, `a sheet made inside a sheet appears in every instance (sheets at depths ${nest.depth}, no designator twice)`);

  // the file keeps it all; KiCad gets a sheet per page; the circuit simulates
  const file = await cad.evaluate(async () => {
    const before = window.__nets(), js = TubeCAD.circuitJSON();
    await TubeCAD.openText(js, "hier.json");
    const f = await TubeCAD.kicadFiles();
    return { same: before === window.__nets(), frames: TubeCAD.frames().length, kicad: Object.keys(f.files || f).filter(n => /\.kicad_sch$/.test(n)).length };
  });
  check(file.same && file.frames === 5, "saved and opened again: sheets, instances and nets as they were");
  check(file.kicad === 6, `KiCad export writes a schematic for every sheet (${file.kicad})`);
  await cad.waitForTimeout(2500);
  check(await cad.evaluate(() => !TubeCAD.state.sim.error && !!TubeCAD.state.sim.result), "the hierarchical circuit simulates");

  // a sheet from the palette: empty sheet, a port placed on it gives the symbol a pin
  const pal = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state;
    C.newCircuit({ size: "A3", title: "Hier" });
    const sym = C.makeComp("sheetsym", {}, 200, 200, 0); S.comps.push(sym); S.sel.comps.clear(); S.sel.comps.add(sym.id); C.commit();
    const f = C.hier.frameOf(sym.params.inst);
    const port = C.makeComp("hport", { name: "IN", dir: "in" }, f.x + 300, f.y + 300, 0); S.comps.push(port); C.commit();
    const s2 = S.comps.find(c => c.type === "sheetsym");
    return { def: !!S.blocks.find(b => b.id === s2.params.def && b.sheet), frame: !!f, pins: (s2.params.pins || []).map(p => p.n).join() };
  });
  check(pal.def && pal.frame && pal.pins === "IN", "a sheet from the palette gets a sheet of its own; a port on it adds pin IN to the symbol");
}
