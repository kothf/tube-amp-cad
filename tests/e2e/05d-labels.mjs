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
  // the name field takes focus a moment after the click
  await cad.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key === "name", null, { timeout: 3000 }).catch(() => {});
  const placed = await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.filter(k => k.type === "netlabel").pop(), a = document.activeElement; return { name: c.params.name, sel: S.sel.comps.has(c.id), focus: a && a.dataset && a.dataset.key, placing: !!S.placing }; });
  check(placed.name === "NET1" && placed.sel && placed.focus === "name" && !placed.placing, "a click places it, selected, its name field in the inspector focused for typing");
  await cad.keyboard.type("IN1"); await cad.keyboard.press("Enter");
  await cad.locator("#cad").focus(); await cad.keyboard.press("l");
  const next = await cad.evaluate(() => TubeCAD.state.placing && TubeCAD.state.placing.params.name);
  check(next === "IN2", `the next label counts on from the name just typed (IN1 → ${next})`);
  await cad.keyboard.press("Escape");

  // a double-click on a wire labels it there, with the net's name
  const w = await cad.evaluate(i => { const S = TubeCAD.state, T = TubeCAD.topo(), n = T.pinNet.get(i.r3 + ":1"); const ws = S.wires.filter(x => T.wireNet.get(x.id) === n && x.x1 === x.x2 && Math.abs(x.y2 - x.y1) >= 20); const x = ws[0]; return x && { x: x.x1, y: Math.min(x.y1, x.y2) + 10, n: S.comps.filter(c => c.type === "netlabel").length }; }, ids);
  // the label tool put away (Esc) and the view settled before the double-click
  await cad.waitForFunction(() => !TubeCAD.state.placing && TubeCAD.state.tool === "select", null, { timeout: 3000 }).catch(() => {});
  await cad.waitForTimeout(200);
  const [wx, wy] = await toScreen(w.x, w.y);
  await cad.mouse.move(wx, wy);
  await cad.mouse.dblclick(wx, wy);
  await cad.waitForFunction(n0 => TubeCAD.state.comps.filter(c => c.type === "netlabel").length > n0, w.n, { timeout: 3000 }).catch(() => {});
  const dbl = await cad.evaluate(([i, n0]) => { const S = TubeCAD.state, T = TubeCAD.topo(), ls = S.comps.filter(c => c.type === "netlabel"); const c = ls[ls.length - 1]; return { n: ls.length - n0, tool: S.tool, placing: !!S.placing, name: c.params.name, same: T.pinNet.get(c.id + ":1") === T.pinNet.get(i.r3 + ":1") }; }, [ids, w.n]);
  check(dbl.n === 1 && dbl.name === "MID" && dbl.same, `a double-click on a wire puts a label on it there, named after its net (${dbl.name}; ${dbl.n} new, tool ${dbl.tool}, placing ${dbl.placing})`);

  // KiCad export writes labels as KiCad's local labels
  const kic = await cad.evaluate(async () => { const files = await TubeCAD.kicadFiles(); return Object.entries(files).filter(([k]) => /\.kicad_sch$/.test(k)).map(([, v]) => String(v)).join("\n"); });
  check(/\(label "MID"/.test(kic) && !/global_label "MID"/.test(kic), "KiCad export writes net labels as KiCad's own local labels");
}

// Buses: drawn with the Bus tool, named, a signal taken from it with its wire and label, the
// checks for a wire leaving a bus without a member's name, a bus port carrying members to a sheet
{
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps.length = 0; S.wires.length = 0; S.sel.comps.clear(); S.sel.wires.clear(); TubeCAD.commit(); TubeCAD.state.view.scale = 1; TubeCAD.state.view.ox = 100; TubeCAD.state.view.oy = 100; });
  await cad.locator("#cad").focus();
  await cad.keyboard.press("Shift+B");
  const tool = await cad.evaluate(() => ({ t: TubeCAD.state.tool, btn: document.getElementById("btn-tool-bus").classList.contains("active") }));
  check(tool.t === "bus" && tool.btn, "Shift+B picks the Bus tool, its button lit");
  const [ax, ay] = await toScreen(200, 200), [bx, by] = await toScreen(500, 200), [cx2, cy2] = await toScreen(500, 300);
  await cad.mouse.click(ax, ay); await cad.mouse.click(bx, by); await cad.mouse.dblclick(cx2, cy2);
  await cad.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.key === "name", null, { timeout: 3000 }).catch(() => {});
  const bus = await cad.evaluate(() => { const S = TubeCAD.state, b = S.comps.find(c => c.type === "bus"), a = document.activeElement; return b && { segs: b.params.segs, x: b.x, y: b.y, sel: S.sel.comps.has(b.id), focus: a && a.dataset && a.dataset.key, tool: S.tool, pins: TubeCAD.compPins(b).length }; });
  check(bus && bus.segs.length === 2 && bus.x === 200 && bus.y === 200 && bus.pins === 0, `the bus is drawn like a wire, corner by corner, and joins nothing itself (${bus && JSON.stringify(bus.segs)})`);
  check(bus && bus.sel && bus.focus === "name" && bus.tool === "select", "a double-click ends it, selected, its name field ready for typing");
  await cad.keyboard.press("Control+A"); await cad.keyboard.type("D[0..3]"); await cad.keyboard.press("Enter");
  const nm = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "bus").params.name);
  check(nm === "D[0..3]", "its name is typed in the inspector");

  // right-click → Take a signal: D2
  const [px, py] = await toScreen(350, 200);
  await cad.mouse.click(px, py, { button: "right" });
  await cad.waitForTimeout(100);
  const menu = await cad.evaluate(() => [...document.querySelectorAll(".ctx-menu button, .context-menu button, [role=menu] button")].map(b => b.textContent.trim()).filter(t => /Take a signal/.test(t)));
  check(menu.length === 4 && menu.some(t => /D2/.test(t)), `right-clicking the bus offers each member (${menu.join(", ")})`);
  await cad.locator("button", { hasText: "Take a signal: D2" }).first().click();
  const [qx, qy] = await toScreen(350, 260);
  await cad.mouse.move(qx, qy); await cad.mouse.click(qx, qy);
  const took = await cad.evaluate(() => { const S = TubeCAD.state, l = S.comps.find(c => c.type === "netlabel"), T = TubeCAD.topo(); const w = S.wires.find(x => (x.x1 === 350 && x.y1 === 200) || (x.x2 === 350 && x.y2 === 200)); return { l: l && { name: l.params.name, x: l.x, y: l.y }, wire: !!w, same: !!(w && l && T.wireNet.get(w.id) === T.pinNet.get(l.id + ":1")) }; });
  check(took.l && took.l.name === "D2" && took.l.x === 350 && took.l.y === 260 && took.wire && took.same, "Take a signal: a wire from the bus to where you click, with the member's label at its end");
  let issues = await cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
  check(!/leaving a bus/.test(issues) && !/not members/.test(issues), "no bus warnings while every wire leaving it carries a member's name");
  await cad.evaluate(() => { const C = TubeCAD; C.lRoute(450, 200, 450, 260, false).forEach(s => C.addSegment(s[0], s[1], s[2], s[3])); C.state.comps.push(C.makeComp("netlabel", { name: "CLK" }, 300, 260, 0)); C.lRoute(300, 200, 300, 260, false).forEach(s => C.addSegment(s[0], s[1], s[2], s[3])); C.commit(); });
  issues = await cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
  check(/Wires leaving a bus with no net label: 1/.test(issues) && /not members of the bus: CLK/.test(issues), "Checks: a wire leaving a bus with no name, and a label that is not one of the bus's members");
  const kic = await cad.evaluate(async () => { const files = await TubeCAD.kicadFiles(); return Object.entries(files).filter(([k]) => /\.kicad_sch$/.test(k)).map(([, v]) => String(v)).join("\n"); });
  check(/\(bus \(pts/.test(kic) && /\(label "D\[0\.\.3\]"/.test(kic), "KiCad export writes the bus and its name as KiCad's own bus and label");
}

// a sheet port named like a bus carries every member: label BA inside the sheet is BA outside
{
  await cad.evaluate(() => { window.confirm = () => true; return TubeCAD.openExample(TubeCAD.EXAMPLES.find(e => e.file.startsWith("03"))); });
  await cad.waitForTimeout(800);
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state;
    const parts = S.comps.filter(c => !["frame", "note"].includes(c.type));
    const xs = parts.map(c => c.x).sort((a, b) => a - b), mid = xs[Math.floor(xs.length / 2)];
    S.sel.comps.clear(); S.sel.wires.clear();
    parts.filter(c => (c.x < mid || c.label === "VL2") && !["ground", "rail", "vdc"].includes(c.type)).forEach(c => S.sel.comps.add(c.id));
    if (!TubeCAD.hier.makeFromSelection("Stage")) return "make";
    const sym = S.comps.find(c => c.type === "sheetsym"), port = S.comps.find(c => c.type === "hport");
    const q = sym.params.pins.find(p => p.n === port.params.name); if (!q) return JSON.stringify([port.params, sym.params.pins]);
    const fr = TubeCAD.frames();
    const inSheet = fr.find(f => f.sheetOf), top = fr.find(f => !f.sheetOf);
    const lab = (f, name, dy) => { const c = TubeCAD.makeComp("netlabel", { name }, f.x + 40, f.y + 40 + dy, 0); S.comps.push(c); return c; };
    const a1 = lab(inSheet, "BA", 0), b1 = lab(inSheet, "BB", 20), a2 = lab(top, "BA", 0), b2 = lab(top, "BB", 20);
    const net = c => TubeCAD.topo().pinNet.get(c.id + ":1");
    TubeCAD.commit && TubeCAD.commit();
    const before = net(a1) === net(a2);
    port.params.name = "{BA BB}"; q.n = "{BA BB}";
    TubeCAD.commit && TubeCAD.commit();
    return { before, a: net(a1) === net(a2), b: net(b1) === net(b2), apart: net(a1) !== net(b1) };
  });
  check(r && !r.before && r.a && r.b && r.apart, `a sheet port and symbol pin named {BA BB} join each member's labels across the sheets, and only those (${JSON.stringify(r)})`);
}

// File ▾ → Open LTspice schematic…: the .asc as a circuit, the list of what came over, and it simulates
{
  const { readFileSync } = await import("node:fs");
  const asc = readFileSync(new URL("../fixtures/ltspice/follower.asc", import.meta.url), "latin1");
  const menu = await cad.evaluate(() => { const b = document.getElementById("btn-ltspice-open"); return b && b.textContent; });
  check(/Open LTspice schematic/.test(menu || ""), "File ▾ has Open LTspice schematic…");
  const r = await cad.evaluate(async text => {
    window.confirm = () => true;
    const res = await TubeCAD.openLtspice([new File([text], "follower.asc")]);
    const m = document.getElementById("kicad-modal"), S = TubeCAD.state;
    const out = { ok: !!res, title: m && document.getElementById("kicad-title").textContent, shown: m && !m.hidden, q: (S.comps.find(c => c.label === "Q1") || {}).type, labels: S.comps.filter(c => c.type === "netlabel").length, kept: (S.comps.find(c => c.label === "U1") || {}).type };
    if (m) m.hidden = true;
    return out;
  }, asc);
  check(r.ok && r.title === "LTspice schematic opened" && r.shown && r.q === "spice" && r.kept === "kicad" && r.labels >= 5, `the schematic opens as a circuit with the list of what came over (${JSON.stringify(r)})`);
  await cad.waitForFunction(() => { const s = TubeCAD.state.sim; return s && s.result && !s.busy; }, null, { timeout: 15000 }).catch(() => {});
  const v = await cad.evaluate(() => { const res = TubeCAD.state.sim.result; return !!res && res.ok !== false; });
  check(v, "and it simulates");
}
