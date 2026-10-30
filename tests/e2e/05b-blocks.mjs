// Reusable blocks: a stage made a block from the Edit menu, a second copy placed with a click,
// a value edited on one copy changing on both, the drawing of one copy updated to the other
import { cad, check, toScreen } from "./harness.mjs";

{
  await cad.bringToFront();
  await cad.evaluate(() => TubeCAD.newCircuit({ size: "A3", title: "Blocks" }));
  // a divider from a rail with a sheet connector on its middle: R1 from +B, R2 to ground
  await cad.evaluate(() => {
    const C = TubeCAD, S = C.state;
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    add("rail", { name: "+B", v: 100 }, 200, 200);
    add("resistor", { r: 10000 }, 230, 200);
    add("resistor", { r: 10000 }, 260, 230, 1);
    add("ground", {}, 260, 260);
    C.addSegment(260, 200, 320, 200);
    add("offsheet", { name: "OUT_A" }, 320, 200);
    C.commit();
    S.sel.comps.clear(); S.sel.wires.clear();
    S.comps.forEach(c => { if (c.type !== "frame") S.sel.comps.add(c.id); });
    S.wires.forEach(w => S.sel.wires.add(w.id));
    C.updateInspector();
  });
  await cad.click("#btn-edit");
  await cad.click("#btn-block-make");
  check(await cad.evaluate(() => !document.getElementById("block-modal").hidden && document.activeElement && document.activeElement.id === "block-name"), "Edit ▾ → Make block from selection… opens the Blocks dialog with the name field ready");
  await cad.fill("#block-name", "Divider");
  await cad.click("#btn-block-create");
  const made = await cad.evaluate(() => { const S = TubeCAD.state; return { n: S.blocks.length, name: S.blocks[0] && S.blocks[0].name, parts: S.blocks[0] && S.blocks[0].comps.length, wires: S.blocks[0] && S.blocks[0].wires.length, tagged: S.comps.filter(c => c.block).length, rows: document.querySelectorAll("#block-body tr[data-id]").length }; });
  check(made.n === 1 && made.name === "Divider" && made.parts === 5 && made.wires === 1 && made.tagged === 5 && made.rows === 1, `the selection becomes block “Divider” and its first copy (${made.parts} parts, ${made.wires} wire)`);

  // Place, then a click on the sheet puts the second copy down there
  await cad.click('#block-body tr[data-id] button[data-a="place"]');
  check(await cad.evaluate(() => document.getElementById("block-modal").hidden && !!TubeCAD.state.placingBlock), "Place closes the dialog and the copy follows the pointer");
  const [sx, sy] = await toScreen(560, 400);
  await cad.mouse.move(sx, sy); await cad.mouse.click(sx, sy);
  const two = await cad.evaluate(() => {
    const S = TubeCAD.state, cp = [...new Set(S.comps.filter(c => c.block).map(c => c.block.i))];
    const second = S.comps.filter(c => c.block && c.block.i === cp[1]);
    return { copies: cp.length, labels: second.filter(c => c.label).map(c => c.label).sort(), sel: S.sel.comps.size, wires: S.wires.length, status: TubeCAD.blocks.note(), ids: second.map(c => c.id) };
  });
  check(two.copies === 2 && two.labels.join() === "R3,R4" && two.sel === 5 && two.wires === 2, `a click places copy 2 with designators of its own (${two.labels.join(", ")}), selected`);
  check(/sheet connectors/.test(two.status), "the status says the new copy's sheet connectors join the first copy's until renamed");

  // each copy keeps its own connector name; a resistance changed on copy 2 changes on copy 1
  const vals = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state;
    const r3 = S.comps.find(c => c.label === "R3"), conn = S.comps.filter(c => c.type === "offsheet");
    conn[1].params.name = "OUT_B"; C.commit();
    r3.params.r = 4700; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(r3.id); C.commit(); C.updateInspector();
    const r1 = S.comps.find(c => c.label === "R1");
    return { r1: r1.params.r, names: conn.map(c => c.params.name), insp: document.getElementById("inspector").textContent };
  });
  check(vals.r1 === 4700 && vals.names.join() === "OUT_A,OUT_B", `a value changed on copy 2 (R3 = 4.7 kΩ) changes on copy 1 (R1 = ${vals.r1} Ω), the connector names stay each copy's own (${vals.names.join(", ")})`);
  check(/Divider, copy 2 of 2/.test(vals.insp) && /Select this copy/.test(vals.insp), "the inspector of a part in a copy names the block and the copy");

  // a resistor added to copy 1 across R2, then Update block from selection draws it into copy 2
  const up = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state;
    const cap = C.makeComp("resistor", { r: 1e6 }, 290, 230, 1); S.comps.push(cap);
    C.addSegment(260, 260, 290, 260); C.commit();
    const r1 = S.comps.find(c => c.label === "R1");
    S.sel.comps.clear(); S.sel.comps.add(r1.id);
    C.blocks.selectCopy(r1);
    const selected = S.sel.comps.has(cap.id);
    C.blocks.update();
    const cp = [...new Set(S.comps.filter(c => c.block).map(c => c.block.i))];
    const second = S.comps.filter(c => c.block && c.block.i === cp[1]);
    const cap2 = second.find(c => c.params.r === 1e6), T = C.topo();
    return {
      selected, parts: second.length, defParts: S.blocks[0].comps.length, cap2: cap2 && cap2.label, capGnd: cap2 && T.pinNet.get(cap2.id + ":2"),
      capTop: cap2 && T.pinNet.get(cap2.id + ":1"), r4Top: T.pinNet.get(second.find(c => c.label === "R4").id + ":1"),
      name: second.find(c => c.type === "offsheet").params.name, ids: second.map(c => c.id)
    };
  });
  check(up.selected, "Select this copy takes in a part added inside the copy");
  check(up.defParts === 6 && up.parts === 6 && up.cap2 === "R6" && up.capGnd === 0 && up.capTop === up.r4Top, `Update block from selection redraws copy 2 with the new resistor (${up.cap2}) wired as in copy 1`);
  check(up.name === "OUT_B" && two.ids.every(id => up.ids.includes(id)), "the redrawn copy keeps its connector name and its parts' ids (the board keeps their places)");

  // saved with the file, and undone in one step
  const file = await cad.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); return { blocks: (d.blocks || []).length, tagged: d.comps.filter(c => c.block).length }; });
  check(file.blocks === 1 && file.tagged === 12, `the file keeps the block and the copies' tags (${file.tagged} parts)`);
  const undone = await cad.evaluate(() => { TubeCAD.undo(); const n = TubeCAD.state.blocks[0].comps.length; TubeCAD.redo(); return [n, TubeCAD.state.blocks[0].comps.length]; });
  check(undone[0] === 5 && undone[1] === 6, "Undo takes the update back, block included; Redo brings it again");

  // Detach: copy 2's parts become ordinary parts, and edits no longer travel
  const det = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, r3 = S.comps.find(c => c.label === "R3");
    C.blocks.detach(r3);
    r3.params.r = 100; C.commit();
    return { r1: S.comps.find(c => c.label === "R1").params.r, tagged: S.comps.filter(c => c.block).length };
  });
  check(det.r1 === 4700 && det.tagged === 6, "Detach makes copy 2 ordinary parts: its values are its own");
}
