// Net labels: the same name on one sheet is one net, on another sheet it is not; the L tool, a
// double-click on a wire, the next free name, the checks, the name on the board and in KiCad
import { cad, check, toScreen } from "./harness.mjs";

{
  await cad.bringToFront();
  // two A4 sheets; on sheet 1 a divider whose middle is carried by two MID labels, on sheet 2 a
  // resistor to ground from a third MID label, which must stay a net of its own
  const ids = await cad.evaluate(() => {
    window.confirm = () => true;
    const S = TubeCAD.state, C = TubeCAD;
    S.comps.length = 0; S.wires.length = 0; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (t, p, x, y, r) => { const c = C.makeComp(t, p, x, y, r || 0); S.comps.push(c); return c; };
    const f1 = add("frame", { size: "A4", orient: "landscape", locked: "no" }, 0, 0), f2 = add("frame", { size: "A4", orient: "landscape", locked: "no" }, 1400, 0);
    const pinOf = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b) => C.lRoute(a.x, a.y, b.x, b.y, true).forEach(s => C.addSegment(s[0], s[1], s[2], s[3]));
    const vcc = add("rail", { name: "VCC", v: 10 }, 200, 200, 0);
    const r1 = add("resistor", { r: 1000 }, 300, 260, 1), r2 = add("resistor", { r: 1000 }, 600, 260, 1);
    const g1 = add("ground", {}, 600, 360, 0);
    wire(pinOf(vcc, "1"), pinOf(r1, "1"));
    const l1 = add("netlabel", { name: "MID" }, pinOf(r1, "2").x, pinOf(r1, "2").y + 40, 0);
    wire(pinOf(r1, "2"), { x: l1.x, y: l1.y });
    const l2 = add("netlabel", { name: "mid" }, pinOf(r2, "1").x, pinOf(r2, "1").y - 40, 0);
    wire({ x: l2.x, y: l2.y }, pinOf(r2, "1"));
    wire(pinOf(r2, "2"), pinOf(g1, "G"));
    const r3 = add("resistor", { r: 2200 }, 1700, 260, 1), g2 = add("ground", {}, 1700, 360, 0);
    const l3 = add("netlabel", { name: "MID" }, pinOf(r3, "1").x, pinOf(r3, "1").y - 40, 0);
    wire({ x: l3.x, y: l3.y }, pinOf(r3, "1")); wire(pinOf(r3, "2"), pinOf(g2, "G"));
    C.commit(); C.fitView();
    return { r1: r1.id, r2: r2.id, r3: r3.id, l1: l1.id, f2: f2.id, f1: f1.id };
  });
  const nets = await cad.evaluate(i => { const T = TubeCAD.topo(); return { a: T.pinNet.get(i.r1 + ":2"), b: T.pinNet.get(i.r2 + ":1"), c: T.pinNet.get(i.r3 + ":1") }; }, ids);
  check(nets.a === nets.b && nets.a !== undefined, "two net labels of one name (MID, mid) on the same sheet are one net, as if wired");
  check(nets.c !== nets.a, "a label of that name on another sheet is a net of its own (a label reaches only its own sheet)");

  // the name goes to the board's netlist, the status bar over a wire, the checks
  const board = await cad.evaluate(i => { const n = TubeCAD.boardNetlist(), T = TubeCAD.topo(); return { mid: n.names[T.pinNet.get(i.r1 + ":2")], other: n.names[T.pinNet.get(i.r3 + ":1")], kinds: n.parts.map(p => p.type) }; }, ids);
  check(board.mid === "MID" && board.other === "MID" && !board.kinds.includes("netlabel"), `the board's nets take the label's name (${board.mid}) and the label is not a part on the board`);
  const issues0 = await cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
  check(!/Net labels/.test(issues0), "no label warnings while every label is fine (one label alone just names its net)");
  // a pair of sheet connectors named MID on sheet 2: the MID labels on sheet 1 do not reach them
  await cad.evaluate(i => {
    const S = TubeCAD.state, f2 = S.comps.find(c => c.id === i.f2);
    [0, 1].forEach(k => S.comps.push(TubeCAD.makeComp("offsheet", { name: "MID" }, f2.x + 600 + k * 100, 300, 0)));
    S.comps.push(TubeCAD.makeComp("netlabel", { name: "OTHER" }, S.comps.find(c => c.id === i.l1).x, S.comps.find(c => c.id === i.l1).y, 0));
    TubeCAD.commit();
  }, ids);
  const issues = await cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
  check(/named like a sheet connector or power rail but not joined to it: MID/.test(issues), "Checks: a label named like a sheet connector it does not reach");
  check(/two names on one net: (MID = OTHER|OTHER = MID)/i.test(issues), "Checks: one net with two label names");
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps = S.comps.filter(c => !(c.type === "offsheet" || (c.type === "netlabel" && c.params.name === "OTHER"))); TubeCAD.state.comps = S.comps; TubeCAD.commit(); });

  // L: a label on the pointer with the next free name; a click places it and the inspector waits for its name
  await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.state.sel.wires.clear(); });
  await cad.locator("#cad").focus();
  await cad.keyboard.press("l");
  const placing = await cad.evaluate(() => TubeCAD.state.placing && { type: TubeCAD.state.placing.type, name: TubeCAD.state.placing.params.name, btn: document.getElementById("btn-tool-label").classList.contains("active") });
  check(placing && placing.type === "netlabel" && placing.name === "NET1" && placing.btn, `L puts a net label on the pointer with the first free name (${placing && placing.name}), the Label button lit`);
  const spot = await cad.evaluate(i => { const f = TubeCAD.state.comps.find(c => c.id === i.f1); return { x: f.x + 800, y: f.y + 500 }; }, ids);
  const [sx, sy] = await toScreen(spot.x, spot.y);
  await cad.mouse.click(sx, sy);
  const placed = await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.filter(k => k.type === "netlabel").pop(), a = document.activeElement; return { name: c.params.name, sel: S.sel.comps.has(c.id), focus: a && a.dataset && a.dataset.key, placing: !!S.placing }; });
  check(placed.name === "NET1" && placed.sel && placed.focus === "name" && !placed.placing, "a click places it, selected, its name field in the inspector focused for typing");
  await cad.keyboard.type("IN1"); await cad.keyboard.press("Enter");
  await cad.locator("#cad").focus(); await cad.keyboard.press("l");
  const next = await cad.evaluate(() => TubeCAD.state.placing && TubeCAD.state.placing.params.name);
  check(next === "IN2", `the next label counts on from the name just typed (IN1 → ${next})`);
  await cad.keyboard.press("Escape");

  // a double-click on a wire labels it there, with the net's name
  const w = await cad.evaluate(i => { const S = TubeCAD.state, T = TubeCAD.topo(), n = T.pinNet.get(i.r3 + ":1"); const ws = S.wires.filter(x => T.wireNet.get(x.id) === n && x.x1 === x.x2 && Math.abs(x.y2 - x.y1) >= 20); const x = ws[0]; return x && { x: x.x1, y: Math.min(x.y1, x.y2) + 10, n: S.comps.filter(c => c.type === "netlabel").length }; }, ids);
  const [wx, wy] = await toScreen(w.x, w.y);
  await cad.mouse.dblclick(wx, wy);
  const dbl = await cad.evaluate(([i, n0]) => { const S = TubeCAD.state, T = TubeCAD.topo(), ls = S.comps.filter(c => c.type === "netlabel"); const c = ls[ls.length - 1]; return { n: ls.length - n0, name: c.params.name, same: T.pinNet.get(c.id + ":1") === T.pinNet.get(i.r3 + ":1") }; }, [ids, w.n]);
  check(dbl.n === 1 && dbl.name === "MID" && dbl.same, `a double-click on a wire puts a label on it there, named after its net (${dbl.name})`);

  // KiCad export writes labels as KiCad's local labels
  const kic = await cad.evaluate(async () => { const files = await TubeCAD.kicadFiles(); return Object.entries(files).filter(([k]) => /\.kicad_sch$/.test(k)).map(([, v]) => String(v)).join("\n"); });
  check(/\(label "MID"/.test(kic) && !/global_label "MID"/.test(kic), "KiCad export writes net labels as KiCad's own local labels");
}
