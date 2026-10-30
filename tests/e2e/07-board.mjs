// Board Design
import { cad, check, ctx, errors } from "./harness.mjs";
import { readFile } from "node:fs/promises";

// --- Board Design ------------------------------------------------------------------
{
  // the Schematic | Board switch at the left of the toolbar opens the board
  const [bd] = await Promise.all([ctx.waitForEvent("page"), cad.click("#btn-doc-board")]);
  bd.on("pageerror", e => errors.push(`board: ${e.message}`));
  await bd.waitForFunction(() => window.BoardApp && BoardApp.state.model, null, { timeout: 10000 });
  const sw = await bd.evaluate(() => [document.getElementById("btn-doc-board").getAttribute("aria-current"), document.getElementById("btn-cad").getAttribute("aria-current"), document.querySelector(".doc-switch").getBoundingClientRect().left < 80]);
  check(sw[0] === "page" && !sw[1] && sw[2] && await cad.getAttribute("#btn-doc-sch", "aria-current") === "page", "both windows carry the Schematic | Board switch at the left, the window you are in lit");
  // back and forth: each button finds the window already open, no third window
  const nPages = ctx.pages().length;
  for (let i = 0; i < 3; i++) { await bd.click("#btn-cad"); await cad.click("#btn-doc-board"); }
  await bd.waitForTimeout(200);
  check(ctx.pages().length === nPages && await bd.evaluate(() => !document.getElementById("win-note")), `Schematic and Board, back and forth three times, bring the open windows up instead of opening new ones (${ctx.pages().length} pages)`);
  // the instruments carry the same switch, neither button lit; their Board brings up the Board window
  {
    const [bp] = await Promise.all([ctx.waitForEvent("page"), cad.evaluate(() => { ToolWindows.open("bode.html"); })]);
    await bp.waitForSelector("#btn-board");
    const isw = await bp.evaluate(() => [...document.querySelectorAll(".doc-switch .btn")].map(b => b.id + (b.getAttribute("aria-current") ? "*" : "")).join(" "));
    const n = ctx.pages().length;
    await bp.click("#btn-board"); await bd.waitForTimeout(200);
    check(isw === "btn-cad btn-board" && ctx.pages().length === n, `the Bode plotter has the Schematic | Board switch (${isw}, neither lit); its Board finds the open Board window (${ctx.pages().length} pages)`);
    await bp.close();
  }
  // narrow: Text, Hole, Keep-out and Measure fold into More tools and the toolbar stays one row
  await bd.setViewportSize({ width: 1040, height: 900 }); await bd.waitForTimeout(100);
  const row = await bd.evaluate(() => { const h = document.querySelector("header"); return { h: h.getBoundingClientRect().height, more: !!document.getElementById("btn-tool-more").offsetParent, text: !!document.querySelector('header .tools > [data-tool="text"]').offsetParent}; });
  await bd.click("#btn-tool-more"); await bd.click('.tool-more .menu-item[data-tool="measure"]');
  const picked = await bd.evaluate(() => [BoardApp.state.tool, document.getElementById("btn-tool-more").classList.contains("active")]);
  await bd.keyboard.press("Escape");
  check(row.h < 50 && row.more && !row.text && picked[0] === "measure" && picked[1], `at 1040 px the Board toolbar is one row (${Math.round(row.h)} px) with More tools, which picks Measure and lights up (${picked})`);
  await bd.setViewportSize({ width: 1500, height: 900 });
  // a Board window left open from an older release is reloaded when Board brings it up
  check(/[?&]v=/.test(bd.url()), `the Board window's address carries the release stamp, so a browser cannot serve an old cached page (${bd.url().split("/").pop()})`);
  await bd.evaluate(() => { ToolWindows.version = "0.0.1"; window.__oldPage = true; });
  await cad.click("#btn-doc-board");
  await bd.waitForFunction(() => !window.__oldPage && window.BoardApp && BoardApp.state.model, null, { timeout: 10000 }).catch(() => {});
  const relV = await cad.evaluate(() => ToolWindows.version);
  check(await bd.evaluate(v => !window.__oldPage && ToolWindows.version === v && !!BoardApp.state.model, relV) && ctx.pages().length === nPages, "a Board window from an older release is reloaded (new toolbar) when Board brings it up, still one window");
  // cross-probing a net: wires of one net selected in the schematic light it up on the board, and a net highlighted on the board selects its wires
  const xpWire = await cad.evaluate(() => { const S = TubeCAD.state, T = TubeCAD.topo(), w = S.wires.find(w => T.wireNet.get(w.id) > 0); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.wires.add(w.id); TubeCAD.updateInspector(); return T.wireNet.get(w.id); });
  await bd.waitForFunction(n => BoardApp.state.netHL === n, xpWire, { timeout: 3000 }).catch(() => {});
  const xpA = await bd.evaluate(() => BoardApp.state.netHL);
  await cad.evaluate(() => { TubeCAD.state.sel.wires.clear(); TubeCAD.updateInspector(); }); await bd.waitForTimeout(200);
  const xpB = await bd.evaluate(() => BoardApp.state.netHL);
  const xpNet = await bd.evaluate(n => { const k = Object.keys(BoardApp.state.model.names).map(Number).find(x => x > 0 && x !== n); BoardApp.highlightNet(k); return k; }, xpWire);
  await cad.waitForFunction(() => TubeCAD.state.sel.wires.size > 0, null, { timeout: 3000 }).catch(() => {});
  const xpCw = await cad.evaluate(() => { const T = TubeCAD.topo(); return [...new Set([...TubeCAD.state.sel.wires].map(id => T.wireNet.get(id)))]; });
  await bd.evaluate(() => BoardApp.highlightNet(null)); await cad.evaluate(() => { TubeCAD.state.sel.wires.clear(); TubeCAD.updateInspector(); });
  check(xpA === xpWire && xpB === null && xpCw.length === 1 && xpCw[0] === xpNet, `nets cross-probe: a wire selected in the schematic highlights net ${xpWire} on the board (cleared with it); net ${xpNet} highlighted on the board selects its wires (${xpCw})`);
  const bh = await bd.evaluate(() => [document.querySelector("header").getBoundingClientRect().height, document.querySelector("header").scrollWidth <= innerWidth]);
  check(bh[0] < 50 && bh[1], `the Board toolbar fits one row (${Math.round(bh[0])} px high, nothing cut off)`);
  const m0 = await bd.evaluate(() => { const S = BoardApp.state; return { parts: S.model.parts.map(g => `${g.ref}:${g.fp.name}`), unplaced: S.drc.filter(d => d.kind === "unplaced").length, status: document.getElementById("status").textContent,
    anode: (S.model.pads.find(p => p.ref === "VL1" && p.num === "6") || {}).netName, cathode: (S.model.pads.find(p => p.ref === "VL1" && p.num === "8") || {}).netName,
    heater: ["4", "5", "9"].map(n => (S.model.pads.find(p => p.ref === "VL1" && p.num === n) || {}).netName).join(), supply: S.model.pads.filter(p => p.ref === "XH1").map(p => p.netName).join() }; });
  check(m0.heater === "HTR6.3_A,HTR6.3_A,HTR6.3_B" && m0.supply === "HTR6.3_A,HTR6.3_B", `the 12AX7's heater gets copper: pins 4 + 5 and 9 on the 6.3 V heater nets, fed from the heater supply XH1 (${m0.heater}; XH1 ${m0.supply})`);
  check(m0.parts.length === 10 && m0.parts.includes("XH1:TERM-5.08-2") && m0.parts.includes("VL1:SOCKET-B9A") && m0.parts.includes("VT1:TO-126-ECB") && m0.parts.includes("VD1:DIODE-10.16") && m0.parts.includes("HL1:LED-5MM") && m0.parts.includes("G1:TERM-5.08-2") && /Linked to CAD/.test(m0.status),
    `the Board window takes the schematic's parts with footprints (${m0.parts.join(", ")})`);
  check(m0.unplaced === 10 && m0.anode && m0.anode !== m0.cathode, `new parts wait below the board; the 12AX7's pins carry the schematic's nets (anode ${m0.anode}, cathode ${m0.cathode})`);
  await cad.waitForFunction(() => TubeCAD.state.board && Object.keys(TubeCAD.state.board.parts).length === 10, null, { timeout: 5000 }).catch(() => {});
  check(await cad.evaluate(() => !!TubeCAD.state.board && Object.keys(TubeCAD.state.board.parts).length === 10), "the CAD keeps the board with the circuit");
  // place everything, then put R1 straight above the anode pin (6), so the track drops onto it clear of the other pins
  await bd.click("#btn-arrange");
  await bd.evaluate(() => { const S = BoardApp.state; S.board.outline.h = 160; const k = r => S.model.parts.find(g => g.ref === r).key; Object.assign(S.board.parts[k("VL1")], { x: 70, y: 130, rot: 0 }); const p6 = BoardCore.footprint("SOCKET-B9A").pads[5]; Object.assign(S.board.parts[k("R1")], { x: 70 + p6.x - 5.08, y: 100, rot: 0 }); BoardApp.commit(); BoardApp.fit(); });
  await bd.waitForTimeout(150);
  const before = await bd.evaluate(() => ({ un: BoardApp.state.conn.unrouted, placed: BoardApp.state.drc.filter(d => d.kind === "unplaced").length }));
  // route R1 pad 2 to the anode (pin 6) with the mouse: X, click, click
  const cv = await bd.locator("#pcb").boundingBox(), sp = (ref, num) => bd.evaluate(([ref, num]) => { const p = BoardApp.state.model.pads.find(q => q.ref === ref && q.num === num); return BoardApp.toScreen(p.x, p.y); }, [ref, num]);
  const a = await sp("R1", "2"), b = await sp("VL1", "6");
  await bd.locator("#pcb").focus(); await bd.keyboard.press("x");
  await bd.mouse.click(cv.x + a[0], cv.y + a[1]); await bd.mouse.move(cv.x + b[0], cv.y + b[1], { steps: 4 }); await bd.mouse.click(cv.x + b[0], cv.y + b[1]);
  await bd.waitForTimeout(150);
  const after = await bd.evaluate(() => { const S = BoardApp.state, it = S.conn.items.find(x => x.kind === "track"); return { un: S.conn.unrouted, tracks: S.board.tracks.length, net: it && S.model.names[it.net], shorts: S.conn.shorts.length }; });
  // a 2 mm HV track into a 2 mm pad needs no teardrop; at 0.8 mm it gets one at each end
  // W while routing steps the width; the HUD by the pointer shows net, width, layer and length
  {
    const r0 = await sp("R1", "1"); await bd.click('[data-tool="route"]'); await bd.mouse.click(cv.x + r0[0], cv.y + r0[1]); await bd.mouse.move(cv.x + r0[0] + 40, cv.y + r0[1] + 5, { steps: 3 });
    const w0 = await bd.evaluate(() => BoardApp.state.route && BoardApp.state.route.w); await bd.keyboard.press("w");
    const w1 = await bd.evaluate(() => BoardApp.state.route && BoardApp.state.route.w), hud = await bd.evaluate(() => { const h = document.getElementById("hud"); return h.hidden ? "" : h.textContent; });
    check(w0 && w1 && w1 !== w0 && w1 >= await bd.evaluate(() => BoardApp.state.board.rules.minTrack) && hud.includes(`${w1} mm`) && /mm ·|mm$/.test(hud), `W changes the track width while routing (${w0} → ${w1} mm); the card at the pointer shows it ("${hud.split("W width")[0].trim()}")`);
    // a layer picked while the track is under way is the track's layer: before the first corner it just moves over, no via
    await bd.selectOption("#layer", "B.Cu");
    const ly = await bd.evaluate(() => [BoardApp.state.route && BoardApp.state.route.layer, BoardApp.state.board.vias.length]);
    await bd.selectOption("#layer", "F.Cu");
    check(ly[0] === "B.Cu" && ly[1] === 0 && await bd.evaluate(() => BoardApp.state.route.layer) === "F.Cu", `picking Bottom copper while routing puts the track being placed on the bottom (${ly[0]}, ${ly[1]} vias), so it is drawn blue, not in the top's red`);
    // the bend follows the pointer: off the corner along the axis, then out to a diagonal spot: straight
    // first; back to the corner and off at 45° to the same spot: the diagonal first; / sets it by hand
    const posture = async (dx, dy) => {
      await bd.mouse.move(cv.x + r0[0], cv.y + r0[1], { steps: 2 }); await bd.mouse.move(cv.x + r0[0] + dx, cv.y + r0[1] + dy, { steps: 4 });
      await bd.mouse.move(cv.x + r0[0] + 120, cv.y + r0[1] + 60, { steps: 6 });
      return bd.evaluate(() => BoardApp.state.route.flip);
    };
    const pAxis = await posture(25, 0), pDiag = await posture(18, 18);
    await bd.keyboard.press("/"); await bd.mouse.move(cv.x + r0[0] + 125, cv.y + r0[1] + 62, { steps: 2 });
    const pHand = await bd.evaluate(() => BoardApp.state.route.flip);
    check(pAxis === false && pDiag === true && pHand === false, `the bend follows the way the pointer leaves the corner, as in KiCad (along the axis: straight first ${pAxis === false}; at 45°: diagonal first ${pDiag === true}); / turns it by hand and keeps it (${pHand === false})`);
    await bd.keyboard.press("Escape"); await bd.keyboard.press("Escape"); await bd.keyboard.press("s");
  }
  const tears = await bd.evaluate(() => { const S = BoardApp.state, t = S.board.tracks[0], w0 = t.w; t.w = 2; BoardApp.analyse(); const n0 = S.fills.filter(f => f.tear).length; t.w = 0.8; BoardApp.analyse(); const n1 = S.fills.filter(f => f.tear).length; t.w = w0; BoardApp.analyse(); return [n0, n1]; });
  check(tears[1] >= 1 && tears[1] > tears[0], `teardrops join a narrow track to its pads (${tears[1]} at 0.8 mm, ${tears[0]} for the 2 mm track)`);
  // dragging the board's corner handle taller moves everything down: the teardrops go with their track while the mouse is held
  const tearAt = () => bd.evaluate(() => { const S = BoardApp.state, f = S.fills.find(x => x.tear); return f ? [S.board.outline.h, S.board.tracks[f.ti].pts[0][1], Math.min(...f.pts.map(p => p[1])), Math.min(...f.ops[0].pts.map(p => p[1]))] : null; });
  const hd = await bd.evaluate(() => { const S = BoardApp.state; S.board.tracks[0].w = 0.8; BoardApp.analyse(); return BoardApp.toScreen(S.board.outline.w, 0); });
  const t0 = await tearAt();
  await bd.mouse.move(cv.x + hd[0], cv.y + hd[1]); await bd.mouse.down(); await bd.mouse.move(cv.x + hd[0], cv.y + hd[1] - 40, { steps: 4 });
  const t1 = await tearAt(); await bd.mouse.up(); await bd.keyboard.press("Control+z");
  await bd.evaluate(() => { const S = BoardApp.state; S.board.tracks[0].w = 2; BoardApp.analyse(); });
  const dT = t0 && t1 && t1[1] - t0[1];
  check(t0 && t1 && t1[0] > t0[0] + 1 && Math.abs(t1[2] - t0[2] - dT) < 1e-3 && Math.abs(t1[3] - t0[3] - dT) < 1e-3, `while the board outline is dragged taller (${t0 && t0[0]} → ${t1 && t1[0]} mm) a teardrop moves with its track (${t0 && (t1[2] - t0[2]).toFixed(2)} vs ${dT && dT.toFixed(2)} mm), no copper left behind`);
  check(before.placed === 0 && after.tracks >= 1 && after.un === before.un - 1 && after.net === m0.anode && !after.shorts, `routing a track with the mouse joins R1 to the anode on ${after.net}: ${before.un} → ${after.un} connections to route${after.tracks ? "" : " — " + await bd.textContent("#st-msg")}`);
  await cad.waitForFunction(() => TubeCAD.state.board && TubeCAD.state.board.tracks.length >= 1, null, { timeout: 5000 }).catch(() => {});
  check(await cad.evaluate(() => TubeCAD.state.board.tracks.length >= 1 && JSON.parse(localStorage.getItem("tubecad_board_v1")).tracks.length >= 1), "the track is saved with the circuit (CAD and browser storage)");
  // a track from the anode to the grid is a short; undo takes it away
  await bd.evaluate(() => { const S = BoardApp.state, p6 = S.model.pads.find(p => p.ref === "VL1" && p.num === "6"), p7 = S.model.pads.find(p => p.ref === "VL1" && p.num === "7"); S.board.tracks.push({ layer: "B.Cu", w: 1, pts: [[p6.x, p6.y], [p7.x, p7.y]] }); BoardApp.commit(); });
  const shortTxt = await bd.textContent("#drc");
  await bd.keyboard.press("Control+z"); await bd.waitForTimeout(100);
  check(/Short between/.test(shortTxt) && await bd.evaluate(() => BoardApp.state.conn.shorts.length === 0 && BoardApp.state.board.tracks.length === 1), "a track joining two nets is reported as a short; Ctrl+Z removes it");
  // the board survives a reload of its window (it comes back from the CAD)
  await bd.waitForTimeout(500);
  await bd.reload(); await bd.waitForFunction(() => window.BoardApp && BoardApp.state.model, null, { timeout: 10000 });
  check(await bd.evaluate(() => BoardApp.state.board.tracks.length === 1 && BoardApp.state.drc.filter(d => d.kind === "unplaced").length === 0), "reopening the Board window brings the layout back from the CAD");
  // export: the board drawing as SVG
  await bd.click("#btn-export");
  const [dl] = await Promise.all([bd.waitForEvent("download"), bd.click("#ex-svg")]);
  const svg = (await readFile(await dl.path())).toString();
  check(/<svg[^>]+width="[\d.]+mm"/.test(svg) && /<polyline/.test(svg) && (svg.match(/<circle/g) || []).length > 20, `the board exports as an SVG drawing at 1:1 mm (${dl.suggestedFilename()})`);
  // a new part in the schematic: the board offers it
  await cad.evaluate(() => { const S = TubeCAD.state, c = TubeCAD.makeComp("resistor", { r: 1e3 }, 1200, 700, 0); c.label = "R9"; S.comps.push(c); TubeCAD.commit(); });
  await bd.waitForFunction(() => !document.getElementById("banner").hidden, null, { timeout: 5000 }).catch(() => {});
  const ban = await bd.textContent("#banner-text");
  await bd.click("#banner-sync");
  check(/1 new part \(R9\)/.test(ban) && await bd.evaluate(() => BoardApp.state.model.parts.some(g => g.ref === "R9") && document.getElementById("banner").hidden), `a part added in the schematic is offered and brought in by Update ("${ban.trim()}")`);
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.label !== "R9"); TubeCAD.commit(); });
  await bd.waitForTimeout(400); await bd.evaluate(() => BoardApp.syncNow());

  // Design rules window: the nets with their classes; B+ (300 V) is HV automatically, a class set by hand sticks
  await bd.click("#btn-board"); await bd.click("#btn-rules");
  const nets = await bd.evaluate(() => [...document.querySelectorAll("#rules-nets tr")].map(tr => [...tr.cells].map(c => c.textContent.trim())));
  const rail = nets.find(r => /^300 V$/.test(r[2]));
  check(await bd.isVisible("#rules-modal") && rail && /Auto \(HV\)/.test(rail[3]) && rail[4] === "1" && rail[5] === "2", `Design rules lists every net with its class: the 300 V rail is HV automatically (${rail && rail.join(" | ")})`);
  await bd.fill('#rules-modal [data-r="clearance"]', "0.8"); await bd.press('#rules-modal [data-r="clearance"]', "Tab");
  const anodeSel = bd.locator("#rules-nets select").filter({ has: bd.locator("option") }).nth(1);
  const netNameSet = await anodeSel.getAttribute("data-net");
  await anodeSel.selectOption("HV");
  await bd.click("#rules-apply");
  const rr = await bd.evaluate(n => ({ c: BoardApp.state.board.rules.clearance, cls: BoardApp.state.board.rules.netClass[n] }), netNameSet);
  check(!(await bd.isVisible("#rules-modal")) && rr.c === 0.8 && rr.cls === "HV", `Apply keeps the edited clearance (0.8 mm) and the class set by hand (${netNameSet} → HV)`);
  await cad.waitForFunction(n => TubeCAD.state.board.rules.clearance === 0.8 && TubeCAD.state.board.rules.netClass[n] === "HV", netNameSet, { timeout: 5000 }).catch(() => {});
  check(await cad.evaluate(() => TubeCAD.state.board.rules.clearance === 0.8), "the rules are saved with the board in the circuit");

  // Board setup: size, rounded corners, a mounting hole in each corner
  await bd.click("#btn-board"); await bd.click("#btn-setup");
  await bd.fill('#setup-modal [data-o="w"]', "120"); await bd.fill('#setup-modal [data-o="h"]', "90"); await bd.fill('#setup-modal [data-o="r"]', "4");
  await bd.click("#holes-corners"); await bd.click("#setup-apply");
  const su = await bd.evaluate(() => ({ o: BoardApp.state.board.outline, holes: BoardApp.state.board.holes.map(h => [h.x, h.y, h.d]) }));
  check(su.o.w === 120 && su.o.h === 90 && su.o.r === 4 && su.holes.length === 4 && su.holes[3][0] === 115 && su.holes[3][2] === 3.2, `Board setup: 120 × 90 mm, 4 mm corners, four M3 holes 5 mm in (${JSON.stringify(su.holes)})`);

  // tools with the mouse: via, text, hole, measure; the corner handle resizes the board
  const at = (x, y) => bd.evaluate(([x, y]) => BoardApp.toScreen(x, y), [x, y]).then(([sx, sy]) => [cv.x + sx, cv.y + sy]);
  await bd.evaluate(() => BoardApp.fit()); await bd.waitForTimeout(100);
  const cv2 = await bd.locator("#pcb").boundingBox(); Object.assign(cv, cv2);
  const count = () => bd.evaluate(() => { const b = BoardApp.state.board; return [b.vias.length, b.texts.length, b.holes.length]; });
  const n0 = await count();
  await bd.click('[data-tool="via"]'); let p = await at(60, 20); await bd.mouse.click(p[0], p[1]);
  await bd.click('[data-tool="hole"]'); p = await at(60, 45); await bd.mouse.click(p[0], p[1]);
  await bd.click('[data-tool="text"]'); p = await at(60, 70); await bd.mouse.click(p[0], p[1]);
  await bd.fill("#inspector input", "TUBE AMP"); await bd.press("#inspector input", "Enter");
  const n1 = await count(), txt = await bd.evaluate(() => BoardApp.state.board.texts.slice(-1)[0]);
  check(n1[0] === n0[0] + 1 && n1[1] === n0[1] + 1 && n1[2] === n0[2] + 1 && txt.text === "TUBE AMP" && txt.layer === "F.SilkS", `the Via, Hole and Text tools place a via, a mounting hole and a silkscreen text ("${txt.text}")`);
  // grid points (1.27 mm): 30 × 40 grid steps = 38.1 × 50.8 mm, 63.5 mm apart
  await bd.click('[data-tool="measure"]'); p = await at(12.7, 12.7); await bd.mouse.click(p[0], p[1]); p = await at(50.8, 63.5); await bd.mouse.move(p[0], p[1]); await bd.mouse.click(p[0], p[1]);
  const meas = await bd.evaluate(() => BoardApp.state.measured);
  check(meas && Math.abs(meas.d - 63.5) < 0.01 && /Measure: 63\.50 mm/.test(await bd.textContent("#st-msg")), `Measure reads the distance between two clicks, snapped to the grid (${meas && meas.d.toFixed(2)} mm for 38.1 × 50.8)`);
  // the ruler sticks: near a corner hole's centre, then near the board's corner (not on the grid)
  p = await at(5.6, 5.4); await bd.mouse.move(p[0], p[1]); await bd.mouse.click(p[0], p[1]); p = await at(119.5, 89.6); await bd.mouse.move(p[0], p[1]); await bd.mouse.click(p[0], p[1]);
  const stuck = await bd.evaluate(() => BoardApp.state.measured);
  check(stuck && Math.abs(stuck.d - Math.hypot(115, 85)) < 0.01 && stuck.from === "hole Ø3.2" && stuck.to === "board corner" && /hole Ø3\.2 → board corner/.test(await bd.textContent("#st-msg")),
    `Measure sticks to a hole's centre and the board's corner (${stuck && stuck.d.toFixed(2)} mm, ${stuck && stuck.from} → ${stuck && stuck.to}); Shift measures on the grid only`);
  // the drawing sheet round the board (smallest that fits: A4 for 120 × 90), grid and axes from the keyboard (Russian layout too)
  const sheet = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return s && { size: s.size, x: s.x, y: s.y, w: s.w, type: s.params.doctype }; });
  const ruKey = (key, code) => bd.evaluate(([key, code]) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true })), [key, code]);
  await ruKey("п", "KeyG"); const gs1 = await bd.evaluate(() => BoardApp.state.gridStyle);
  await ruKey("ф", "KeyA"); const ax1 = await bd.evaluate(() => BoardApp.state.axes);
  await ruKey("п", "KeyG"); await ruKey("п", "KeyG"); await ruKey("ф", "KeyA");
  const back = await bd.evaluate(() => [BoardApp.state.gridStyle, BoardApp.state.axes, document.querySelector("[data-gs].active").dataset.gs]);
  check(sheet && sheet.size === "A4" && sheet.x < 0 && sheet.y < 0 && sheet.w === 297 && sheet.type === "PCB layout" && gs1 === "dots" && ax1 === false && back.join() === "lines,true,lines",
    `the board lies on an ${sheet && sheet.size} sheet with frame and title block; G cycles the grid (lines → dots → off), A toggles the X / Y axes`);
  await bd.click("#btn-board"); await bd.click("#btn-setup"); await bd.selectOption("#sheet-size", "A3"); await bd.selectOption("#sheet-orient", "portrait"); await bd.click("#setup-apply");
  const sh3 = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return [s.size, s.w, s.h]; });
  await cad.waitForFunction(() => TubeCAD.state.board.sheet && TubeCAD.state.board.sheet.size === "A3", null, { timeout: 4000 }).catch(() => {});
  check(sh3.join() === "A3,297,420" && await cad.evaluate(() => TubeCAD.state.board.sheet.orient === "portrait"), `Board setup sets the sheet (A3 portrait, ${sh3[1]} × ${sh3[2]} mm), saved with the circuit`);
  await bd.evaluate(() => { BoardApp.state.board.sheet = { size: "auto", orient: "landscape" }; BoardApp.commit(); BoardApp.fit(); }); await bd.waitForTimeout(100);
  await bd.click('[data-tool="select"]');
  // the origin is the board's bottom-left corner, Y up: the status bar reads 0, 0 there and 0, 90 at the top-left corner
  const posAt = async (x, y) => { const q = await at(x, y); await bd.mouse.move(q[0], q[1]); return (await bd.textContent("#st-pos")).trim(); };
  const st0 = await posAt(0, 90), st1 = await posAt(0, 0);
  const xy = t => (t.match(/^x (-?[\d.]+) {2}y (-?[\d.]+) mm/) || []).slice(1).map(Number), tol = Math.max(0.2, await bd.evaluate(() => 1.5 / BoardApp.state.view.scale)), near = (t, x, y) => { const [a, b] = xy(t); return Math.abs(a - x) < tol && Math.abs(b - y) < tol; };
  check(near(st0, 0, 0) && near(st1, 0, 90), `the origin is the bottom-left corner, Y up ("${st0}" there, "${st1}" at the top left)`);
  // the sheet format from the toolbar; Lock sheet keeps it in place while the board grows
  await bd.click("#btn-view"); await bd.selectOption("#sheet-pick", "A3 landscape"); await bd.click("#btn-sheet-lock");
  check(await bd.isVisible("#view-menu .menu-list") && await bd.getAttribute("#btn-sheet-lock", "aria-checked") === "true", "View ▾ stays open while its ticks change; Lock sheet shows its tick");
  await bd.keyboard.press("Escape");
  const shA = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return { size: s.size, x: s.x, y: s.y, locked: s.locked }; });
  const holeA = await bd.evaluate(() => BoardApp.state.board.holes.find(h => h.x === 5 && h.y === 85));
  // the corner handle (top right) resizes the board; the origin stays where it is
  const hc = await at(120, 0), to = await at(130, -10), sOrigin = await at(0, 90);
  await bd.mouse.move(hc[0], hc[1]); await bd.mouse.down(); await bd.mouse.move(to[0], to[1], { steps: 4 }); await bd.mouse.up();
  const o2 = await bd.evaluate(() => BoardApp.state.board.outline), sOrigin2 = await at(0, o2.h);
  const shB = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return { size: s.size, x: s.x, y: s.y, locked: s.locked }; });
  const holeB = await bd.evaluate(() => BoardApp.state.board.holes.find(h => h.x === 5 && Math.abs(h.y - (BoardApp.state.board.outline.h - 5)) < 1e-6));
  check(Math.abs(o2.w - 130) < 1.3 && Math.abs(o2.h - 100) < 1.3 && Math.hypot(sOrigin2[0] - sOrigin[0], sOrigin2[1] - sOrigin[1]) < 0.5 && holeA && holeB,
    `dragging the board's top-right handle resizes it (${o2.w} × ${o2.h} mm); the origin and the bottom-left hole stay put on the screen`);
  check(shA.size === "A3" && shA.locked && shB.size === "A3" && shB.locked && shB.x === shA.x && Math.abs(shB.y - (shA.y + o2.h - 90)) < 1e-6,
    `the toolbar picks an A3 sheet; locked, it keeps its size and place relative to the origin while the board grows (y ${shA.y} → ${shB.y} in the document)`);
  await bd.click("#btn-view"); await bd.selectOption("#sheet-pick", "A1 portrait"); await bd.keyboard.press("Escape");
  const shC = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return [s.size, s.orient, s.w, s.locked, document.getElementById("btn-sheet-lock").classList.contains("active")]; });
  await cad.waitForFunction(() => TubeCAD.state.board.sheet && TubeCAD.state.board.sheet.size === "A1" && TubeCAD.state.board.sheet.locked, null, { timeout: 4000 }).catch(() => {});
  check(shC.join() === "A1,portrait,594,true,true" && await cad.evaluate(() => TubeCAD.state.board.sheet.locked === true), `a locked sheet takes a new format (${shC.slice(0, 3).join(" ")}) and stays locked; saved with the circuit`);
  await bd.click("#btn-view"); await bd.click("#btn-sheet-lock"); await bd.keyboard.press("Escape");
  check(await bd.evaluate(() => !BoardApp.state.board.sheet.locked && !BoardApp.sheetPlace().locked), "Lock sheet again unlocks it: the sheet follows the board");
  // drag the board's edge: the board moves on the sheet (the sheet stays still on the screen and gets locked)
  const on0 = await bd.evaluate(() => BoardApp.onSheet()), shS0 = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return BoardApp.toScreen(s.x, s.y); });
  const oh = await bd.evaluate(() => BoardApp.state.board.outline.h), e0 = await at(0, oh / 2), e1 = await at(25.4, oh / 2 - 12.7);
  await bd.mouse.move(e0[0], e0[1]); await bd.mouse.down(); await bd.mouse.move(e1[0], e1[1], { steps: 5 }); await bd.mouse.up();
  const on1 = await bd.evaluate(() => BoardApp.onSheet()), shS1 = await bd.evaluate(() => { const s = BoardApp.sheetPlace(); return BoardApp.toScreen(s.x, s.y); });
  check(Math.abs(on1[0] - on0[0] - 25.4) < 1e-6 && Math.abs(on1[1] - on0[1] - 12.7) < 1e-6 && Math.hypot(shS1[0] - shS0[0], shS1[1] - shS0[1]) < 0.5 && await bd.evaluate(() => BoardApp.state.board.sheet.locked),
    `dragging the board's edge moves it on the sheet (origin ${on0.join(", ")} → ${on1.join(", ")} mm from the sheet's corner); the sheet stays still and is locked`);
  await bd.evaluate(() => BoardApp.moveOnSheet(40, 30)); const on2 = await bd.evaluate(() => BoardApp.onSheet());
  await bd.evaluate(() => BoardApp.centreOnSheet()); const on3 = await bd.evaluate(() => BoardApp.onSheet());
  check(on2.join() === "40,30" && on3.join() === on0.join(), `the board inspector sets the position on the sheet (40, 30) and centres it again (${on3.join(", ")})`);
  await bd.evaluate(() => { BoardApp.state.board.sheet = { size: "auto", orient: "landscape" }; BoardApp.commit(); BoardApp.fit(); });

  // layers: "only" shows one layer alone (again: all), clicking a copper layer's name makes it active
  await bd.locator('.layer[data-l="B.Cu"] .solo').click();
  const solo = await bd.evaluate(() => Object.entries(BoardApp.state.show).filter(([, v]) => v).map(([k]) => k).join(","));
  await bd.locator('.layer[data-l="B.Cu"] .solo').click();
  const all = await bd.evaluate(() => Object.values(BoardApp.state.show).every(Boolean));
  await bd.locator('.layer[data-l="F.Cu"] .nm').click();
  check(solo === "B.Cu" && all && await bd.evaluate(() => BoardApp.state.layer === "F.Cu" && document.getElementById("layer").value === "F.Cu") && await bd.locator('.layer.active[data-l="F.Cu"]').count() === 1,
    "Layers: \"only\" shows a single layer and again all; clicking a copper layer makes it the active one");

  // cross-probing: a part picked in the board's list is selected in the schematic, and back
  await bd.locator('#parts .item', { hasText: "R2" }).first().click();
  await cad.waitForFunction(() => { const S = TubeCAD.state, c = S.comps.find(x => x.label === "R2"); return c && S.sel.comps.has(c.id) && S.sel.comps.size === 1; }, null, { timeout: 4000 }).catch(() => {});
  const xp1 = await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(x => x.label === "R2"); return S.sel.comps.has(c.id) && S.sel.comps.size === 1; });
  await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(x => x.label === "R3"); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); });
  await bd.waitForFunction(() => { const S = BoardApp.state; return S.sel && S.sel.kind === "part" && S.board.parts[S.sel.key].ref === "R3"; }, null, { timeout: 4000 }).catch(() => {});
  const xp2 = await bd.evaluate(() => { const S = BoardApp.state; return !!(S.sel && S.sel.kind === "part" && S.board.parts[S.sel.key].ref === "R3"); });
  check(xp1 && xp2, `cross-probing: R2 picked on the board is selected in the schematic (${xp1}); R3 selected in the schematic is selected on the board (${xp2})`);

  // a GND plane over the bottom layer, from the board inspector: it fills and joins every GND pad
  await bd.locator("#pcb").focus(); await bd.keyboard.press("Escape"); await bd.keyboard.press("Escape");
  const gndBefore = await bd.evaluate(() => BoardApp.state.conn.rats.filter(r => BoardApp.state.model.names[r.net] === "GND").length);
  await bd.locator("#inspector button", { hasText: "plane (bottom)" }).click();
  const gp = await bd.evaluate(() => { const S = BoardApp.state; return { zones: S.board.zones.length, net: S.board.zones[0] && S.board.zones[0].net, fills: S.fills.filter(f => !f.tear).length, ops: (S.fills.find(f => !f.tear) || { ops: [] }).ops.length, gnd: S.conn.rats.filter(r => S.model.names[r.net] === "GND" && [[r.x1, r.y1], [r.x2, r.y2]].every(([x, y]) => x > 0 && y > 0 && x < S.board.outline.w && y < S.board.outline.h)).length }; });
  check(gp.zones === 1 && gp.net === "GND" && gp.fills === 1 && gp.ops > 5 && gndBefore > 0 && gp.gnd === 0, `the GND plane button pours the bottom layer and joins every GND pad on the board (GND links to route there: ${gndBefore} → ${gp.gnd})`);
  await cad.waitForFunction(() => (TubeCAD.state.board.zones || []).length === 1, null, { timeout: 4000 }).catch(() => {});
  check(await cad.evaluate(() => (TubeCAD.state.board.zones || []).length === 1), "the pour is saved with the circuit");
  // with a whole-board pour the board's edge still moves the board on the sheet (twice); the pour is picked just inside it
  await bd.locator("#pcb").focus(); await bd.keyboard.press("Escape"); await bd.evaluate(() => BoardApp.fit()); await bd.waitForTimeout(100);
  const onP0 = await bd.evaluate(() => BoardApp.onSheet());
  for (let k = 0; k < 2; k++) {
    const hh = await bd.evaluate(() => BoardApp.state.board.outline.h), g0 = await at(0, hh / 2 + 3);
    await bd.mouse.move(g0[0] - 2, g0[1]); await bd.mouse.down(); await bd.mouse.move(g0[0] + 30, g0[1], { steps: 4 }); await bd.mouse.up();
  }
  const onP1 = await bd.evaluate(() => BoardApp.onSheet());
  const zIn = await bd.evaluate(() => { const [sx, sy] = BoardApp.toScreen(0.5, BoardApp.state.board.outline.h / 2 + 3); return [sx + 1, sy]; });
  await bd.mouse.click(cv.x + zIn[0], cv.y + zIn[1]);
  const zSel = await bd.evaluate(() => BoardApp.state.sel && BoardApp.state.sel.kind);
  check(onP1[0] > onP0[0] + 5 && zSel === "zone", `with a GND plane the board's edge still drags the board, again and again (origin x ${onP0[0]} → ${onP1[0]} mm); the plane's outline is picked just inside the edge (${zSel})`);
  // a click on the poured copper itself (nothing else under the pointer) picks the plane too; Del deletes it, Ctrl+Z brings it back
  {
    await bd.keyboard.press("Escape");
    const zc = await bd.evaluate(() => { const [sx, sy] = BoardApp.toScreen(12, BoardApp.state.board.outline.h - 2.5); return [sx, sy]; });
    await bd.mouse.click(cv.x + zc[0], cv.y + zc[1]);
    const zk = await bd.evaluate(() => BoardApp.state.sel && BoardApp.state.sel.kind);
    await bd.keyboard.press("Delete"); const z0 = await bd.evaluate(() => BoardApp.state.board.zones.length);
    await bd.keyboard.press("Control+z"); const z1 = await bd.evaluate(() => BoardApp.state.board.zones.length);
    check(zk === "zone" && z0 === 0 && z1 === 1, `a click inside the GND plane selects it (${zk}), Del deletes it (${z0} left), Ctrl+Z brings it back (${z1})`);
  }
  await bd.evaluate(() => BoardApp.centreOnSheet()); await bd.keyboard.press("Escape");

  // the pour is a shape: the + in the middle of an edge, dragged, adds a corner; a double-click on a corner takes it
  // away; "Round the parts" outlines every part on the board and the pour still shorts nothing
  {
    await bd.evaluate(() => { const S = BoardApp.state; S.sel = { kind: "zone", i: 0 }; BoardApp.commit(); BoardApp.fit(); }); await bd.waitForTimeout(150);
    const zp = await bd.evaluate(() => BoardApp.state.board.zones[0].pts.map(p => p.slice()));
    const mid = await at((zp[0][0] + zp[1][0]) / 2, (zp[0][1] + zp[1][1]) / 2 + 0.3), down = await at((zp[0][0] + zp[1][0]) / 2, (zp[0][1] + zp[1][1]) / 2 + 15);
    await bd.mouse.move(mid[0], mid[1]); await bd.mouse.down(); await bd.mouse.move(down[0], down[1], { steps: 5 }); await bd.mouse.up();
    const z1 = await bd.evaluate(() => BoardApp.state.board.zones[0].pts.map(p => p.slice()));
    const nc = await at(z1[1][0], z1[1][1]); await bd.mouse.dblclick(nc[0], nc[1]);
    const z2 = await bd.evaluate(() => BoardApp.state.board.zones[0].pts.length);
    check(zp.length === 4 && z1.length === 5 && Math.abs(z1[1][1] - zp[0][1] - 15) < 1.3 && z2 === 4, `a pour's outline takes a new corner from the + on an edge (${zp.length} → ${z1.length} corners, dragged 15 mm in) and loses it to a double-click (${z2})`);
    await bd.locator("#inspector button", { hasText: "Round the parts" }).click();
    const zr = await bd.evaluate(() => { const S = BoardApp.state, o = S.board.outline, P = BoardCore.zonePoly(S.board, S.board.zones[0]);
      const on = S.model.parts.filter(g => g.place && g.place.x > 0 && g.place.x < o.w && g.place.y > 0 && g.place.y < o.h);
      return { n: S.board.zones[0].pts.length, shorts: S.conn.shorts.length, parts: on.length, inside: on.filter(g => BoardCore.pip(g.place.x, g.place.y, P)).length }; });
    check(zr.n >= 4 && zr.parts > 0 && zr.inside === zr.parts && zr.shorts === 0, `"Round the parts" outlines the ${zr.parts} parts on the board (${zr.n} corners, ${zr.inside} inside); the pour keeps clear of the other nets (${zr.shorts} shorts)`);
    await bd.locator("#inspector button", { hasText: "Board rectangle" }).click();
    await bd.keyboard.press("Escape");
  }

  // Nets tab: click a net to highlight it, again to turn it off
  await bd.click('[data-tab="nets"]');
  const nNets = await bd.locator("#nets .net").count();
  await bd.locator("#nets .net").first().click();
  const hl1 = await bd.evaluate(() => BoardApp.state.netHL);
  await bd.locator("#nets .net").first().click();
  const hl2 = await bd.evaluate(() => BoardApp.state.netHL);
  check(nNets > 3 && hl1 !== null && hl2 === null && await bd.isVisible("#nets") && !(await bd.isVisible("#parts")), `the Nets tab lists ${nNets} nets; a click highlights one (${hl1}) and a second click turns it off`);
  await bd.click('[data-tab="parts"]');

  // routing onto a pad of another net is refused (too close); Shift+click places it anyway
  await bd.evaluate(() => BoardApp.fit()); await bd.waitForTimeout(100);
  Object.assign(cv, await bd.locator("#pcb").boundingBox());
  const pr = await bd.evaluate(() => { const S = BoardApp.state, a = S.model.pads.find(p => p.ref === "R2" && p.net !== null), c = S.model.pads.find(p => p.part !== a.part && p.net !== null && p.net !== a.net && p.netName !== "GND"); return [BoardApp.toScreen(a.x, a.y), BoardApp.toScreen(c.x, c.y)]; });
  const nT0 = await bd.evaluate(() => BoardApp.state.board.tracks.length);
  await bd.locator("#pcb").focus(); await bd.keyboard.press("x");
  await bd.mouse.click(cv.x + pr[0][0], cv.y + pr[0][1]); await bd.mouse.move(cv.x + pr[1][0], cv.y + pr[1][1], { steps: 5 }); await bd.mouse.click(cv.x + pr[1][0], cv.y + pr[1][1]);
  const refused = await bd.evaluate(() => BoardApp.state.board.tracks.length), why = await bd.textContent("#st-msg");
  await bd.keyboard.down("Shift"); await bd.mouse.click(cv.x + pr[1][0], cv.y + pr[1][1]); await bd.keyboard.up("Shift");
  const forced = await bd.evaluate(() => ({ n: BoardApp.state.board.tracks.length, short: BoardApp.state.conn.shorts.length }));
  check(refused === nT0 && /Too close to/.test(why) && forced.n > nT0 && forced.short > 0, `a segment onto another net's pad is refused ("${why.slice(0, 60)}…"); Shift+click places it (and the check reports the short)`);
  await bd.keyboard.press("Escape"); await bd.keyboard.press("Control+z"); await bd.keyboard.press("Escape");

  // drag a track segment sideways: the next segment follows, the end gets a jog; U selects the whole track
  await bd.evaluate(() => { BoardApp.state.board.tracks.push({ layer: "F.Cu", w: 1, pts: [[20, 80], [32.7, 80], [32.7, 92.7]] }); BoardApp.commit(); });
  const ti = await bd.evaluate(() => BoardApp.state.board.tracks.length - 1);
  const s0 = await bd.evaluate(() => BoardApp.toScreen(26.35, 80)), s1 = await bd.evaluate(() => BoardApp.toScreen(26.35, 82.54));
  await bd.mouse.move(cv.x + s0[0], cv.y + s0[1]); await bd.mouse.down(); await bd.mouse.move(cv.x + s1[0], cv.y + s1[1], { steps: 4 }); await bd.mouse.up();
  const dragged = await bd.evaluate(i => BoardApp.state.board.tracks[i].pts, ti);
  const okDrag = dragged.length === 4 && Math.abs(dragged[1][0] - 20) < 1e-3 && Math.abs(dragged[1][1] - 82.54) < 1e-3 && Math.abs(dragged[2][0] - 32.7) < 1e-3 && Math.abs(dragged[2][1] - 82.54) < 1e-3;
  check(okDrag, `dragging a segment moves it 2.54 mm, the corner slides along the next segment and the start gets a jog (${JSON.stringify(dragged)})`);
  await bd.evaluate(i => { const S = BoardApp.state, t = S.board.tracks[i]; S.board.tracks.push({ layer: "F.Cu", w: 1, pts: [t.pts[3], [45.4, 92.7]] }); BoardApp.commit(); }, ti);
  await bd.mouse.move(cv.x + s1[0], cv.y + s1[1]); await bd.keyboard.press("u");
  const uSel = await bd.evaluate(() => BoardApp.state.sel);
  check(uSel && uSel.kind === "multi" && uSel.tracks.length === 2, `U selects the whole connected track (${uSel && uSel.tracks && uSel.tracks.length} pieces)`);
  await bd.keyboard.press("Delete");

  // several parts at once: a box from empty space selects R2 and R3; Align top; drag one, both move; R turns both; L locks them
  await bd.evaluate(() => { const S = BoardApp.state, k = r => S.model.parts.find(g => g.ref === r).key; Object.assign(S.board.parts[k("R2")], { x: 25.4, y: 87.63, rot: 0, side: "F" }); Object.assign(S.board.parts[k("R3")], { x: 45.72, y: 90.17, rot: 0, side: "F" }); S.sel = null; BoardApp.commit(); });
  const W = (x, y) => bd.evaluate(([x, y]) => BoardApp.toScreen(x, y), [x, y]).then(([a, b]) => [cv.x + a, cv.y + b]);
  let q0 = await W(12, 82), q1 = await W(58, 95);
  await bd.mouse.move(q0[0], q0[1]); await bd.mouse.down(); await bd.mouse.move(q1[0], q1[1], { steps: 6 }); await bd.mouse.up();
  const boxSel = await bd.evaluate(() => { const s = BoardApp.state.sel; return s && s.kind === "multi" ? s.parts.map(k => BoardApp.state.board.parts[k].ref).sort().join(",") : JSON.stringify(s); });
  check(boxSel === "R2,R3", `a box dragged over empty space selects the parts inside it (${boxSel})`);
  await bd.locator('#inspector [data-al="top"]').click();
  const tops = await bd.evaluate(() => { const S = BoardApp.state; return ["R2", "R3"].map(r => { const g = S.model.parts.find(x => x.ref === r), b = BoardCore.partBox(g); return +b.y1.toFixed(3); }); });
  check(tops[0] === tops[1], `Align top lines the two parts up (${tops.join(" = ")})`);
  const pos0 = await bd.evaluate(() => ["R2", "R3"].map(r => { const p = Object.values(BoardApp.state.board.parts).find(x => x.ref === r); return [p.x, p.y]; }));
  const r2c = await W(pos0[0][0], pos0[0][1]), r2d = await W(pos0[0][0] + 5.08, pos0[0][1]);
  await bd.mouse.move(r2c[0], r2c[1] - 1); await bd.mouse.down(); await bd.mouse.move(r2d[0], r2d[1] - 1, { steps: 5 }); await bd.mouse.up();
  const pos1 = await bd.evaluate(() => ["R2", "R3"].map(r => { const p = Object.values(BoardApp.state.board.parts).find(x => x.ref === r); return [p.x, p.y]; }));
  check(pos1.every((p, i) => Math.abs(p[0] - pos0[i][0] - 5.08) < 1e-3 && Math.abs(p[1] - pos0[i][1]) < 1e-3), `dragging one selected part moves the whole selection 5.08 mm (${JSON.stringify(pos1)})`);
  await bd.keyboard.press("Space");
  const rot = await bd.evaluate(() => ["R2", "R3"].map(r => Object.values(BoardApp.state.board.parts).find(x => x.ref === r).rot));
  check(rot[0] === 1 && rot[1] === 1, "Space turns the selection 90° (each part and their places about the middle)");
  await bd.keyboard.press("l");
  const before2 = await bd.evaluate(() => JSON.stringify(Object.values(BoardApp.state.board.parts).filter(x => /^R[23]$/.test(x.ref)).map(p => [p.x, p.y])));
  await bd.keyboard.press("ArrowRight");
  const r2now = await bd.evaluate(() => { const p = Object.values(BoardApp.state.board.parts).find(x => x.ref === "R2"); return BoardApp.toScreen(p.x, p.y); });
  await bd.mouse.move(cv.x + r2now[0], cv.y + r2now[1]); await bd.mouse.down(); await bd.mouse.move(cv.x + r2now[0] + 60, cv.y + r2now[1], { steps: 5 }); await bd.mouse.up();
  const after2 = await bd.evaluate(() => JSON.stringify(Object.values(BoardApp.state.board.parts).filter(x => /^R[23]$/.test(x.ref)).map(p => [p.x, p.y])));
  const lockedNow = await bd.evaluate(() => Object.values(BoardApp.state.board.parts).filter(x => /^R[23]$/.test(x.ref)).every(p => p.locked));
  check(lockedNow && before2 === after2 && /Locked/.test(await bd.textContent("#st-msg")), "L locks the selection: arrows and dragging leave it where it is");
  await bd.evaluate(() => { const S = BoardApp.state; S.sel = { kind: "multi", parts: S.model.parts.filter(g => /^R[23]$/.test(g.ref)).map(g => g.key), tracks: [], vias: [], texts: [], holes: [] }; });
  await bd.keyboard.press("l");
  check(await bd.evaluate(() => Object.values(BoardApp.state.board.parts).filter(x => /^R[23]$/.test(x.ref)).every(p => !p.locked)), "L again unlocks");
  {
    // Space while dragging a part turns it there; letting go commits the move and the turn as one undo step
    const part = () => bd.evaluate(() => { const p = Object.values(BoardApp.state.board.parts).find(x => x.ref === "R2"); return { x: p.x, y: p.y, rot: p.rot || 0 }; });
    await bd.keyboard.press("Escape");
    const p0 = await part(), a0 = await W(p0.x, p0.y), a1 = await W(p0.x + 5.08, p0.y);
    await bd.mouse.move(a0[0], a0[1] - 1); await bd.mouse.down(); await bd.mouse.move(a1[0], a1[1] - 1, { steps: 4 }); await bd.keyboard.press("Space"); await bd.mouse.up();
    const p1 = await part(); await bd.keyboard.press("Control+z"); const p2 = await part();
    check(p1.rot === ((p0.rot + 1) & 3) && Math.abs(p1.x - p0.x - 5.08) < 1e-3 && p2.rot === p0.rot && Math.abs(p2.x - p0.x) < 1e-3, `Space while dragging a part turns it; one Ctrl+Z takes back both (rot ${p0.rot} → ${p1.rot} → ${p2.rot})`);
  }

  // star grounding from Design rules: the star point XG1 joins the board, the ground's ratsnest runs each return to it
  {
    await bd.keyboard.press("Escape");
    await bd.click("#btn-board"); await bd.click("#btn-rules"); await bd.selectOption("#rules-ground", "star"); await bd.click("#rules-apply");
    await bd.waitForTimeout(200);
    const st = await bd.evaluate(() => { const S = BoardApp.state; return { xg: S.model.parts.some(g => g.ref === "XG1" && g.fp.name === "STAR-M3"), star: S.gg && S.gg.star && S.gg.star.ref, groups: [...new Set(S.conn.rats.filter(r => r.net === 0).map(r => r.group))].sort().join(",") }; });
    check(st.xg && st.star === "XG1" && st.groups.length > 0, `Star point in Design rules adds the star terminal XG1; the ground's ratsnest runs each return to it (${st.groups})`);
    await bd.click("#btn-board"); await bd.click("#btn-rules"); await bd.selectOption("#rules-ground", "free"); await bd.click("#rules-apply");
    check(await bd.evaluate(() => !BoardApp.state.model.parts.some(g => g.ref === "XG1")), "Free ground takes XG1 off again");
  }
  // net names say what the net is
  {
    const nn = await bd.evaluate(() => Object.values(BoardApp.state.model.names));
    check(nn.some(n => /^VL1(\.\d)?-A$/.test(n)) && nn.some(n => /^VL1(\.\d)?-K$/.test(n)) && !nn.some(n => /^Net-\(/.test(n)), `nets are named for what they are (${nn.slice(0, 8).join(", ")} …)`);
  }

  // comfort: the find box, zoom keys and bar, the card at the pointer, the right-click menu, the side panels
  {
    await bd.keyboard.press("Escape"); await bd.evaluate(() => BoardApp.fit()); await bd.waitForTimeout(100);
    await bd.keyboard.press("Control+f"); const focused = await bd.evaluate(() => document.activeElement && document.activeElement.id);
    await bd.keyboard.type("VL1"); await bd.waitForTimeout(100);
    const found = await bd.evaluate(() => [...document.querySelectorAll("#parts .item span")].map(e => e.textContent));
    await bd.keyboard.press("Enter"); await bd.waitForTimeout(100);
    const picked = await bd.evaluate(() => { const S = BoardApp.state; return S.sel && S.sel.kind === "part" && S.model.parts.find(g => g.key === S.sel.key).ref; });
    check(focused === "find" && found[0] === "VL1" && found.length === 1 && picked === "VL1", `Ctrl+F finds a part (${found.join(", ")}); Enter selects it`);
    await bd.fill("#find", ""); await bd.locator("#find").press("Escape");
    // zoom keys and the zoom bar
    await bd.locator("#pcb").focus();
    const z0 = await bd.evaluate(() => BoardApp.state.view.scale); await bd.keyboard.press("Equal"); const z1 = await bd.evaluate(() => BoardApp.state.view.scale);
    await bd.click("#z-out"); const z2 = await bd.evaluate(() => BoardApp.state.view.scale);
    await bd.keyboard.press("z"); const z3 = await bd.evaluate(() => BoardApp.state.view.scale);
    check(Math.abs(z1 / z0 - 1.25) < 1e-6 && Math.abs(z2 / z1 - 0.8) < 1e-6 && z3 > z0 && /%$/.test(await bd.textContent("#z-pct")), `+ and the zoom bar zoom in and out; Z zooms to the selection (${z0.toFixed(1)} → ${z3.toFixed(1)} px/mm, ${await bd.textContent("#z-pct")})`);
    // the card at the pointer: a pad's net
    const cvz = await bd.locator("#pcb").boundingBox(), pad = await bd.evaluate(() => { const p = BoardApp.state.model.pads.find(q => q.ref === "VL1" && q.num === "6"); return [...BoardApp.toScreen(p.x, p.y), p.netName]; });
    await bd.mouse.move(cvz.x + pad[0], cvz.y + pad[1]); await bd.mouse.move(cvz.x + pad[0] + 1, cvz.y + pad[1]); await bd.waitForTimeout(600);
    const card = await bd.evaluate(() => { const h = document.getElementById("hud"); return h.hidden ? "" : h.textContent; });
    check(card.includes("VL1-6") && card.includes(pad[2]), `resting on a pad shows its net by the pointer ("${card}")`);
    // right-click the valve: Turn 90° from the menu
    const rot0 = await bd.evaluate(() => BoardApp.state.board.parts[BoardApp.state.model.parts.find(g => g.ref === "VL1").key].rot || 0);
    const body = await bd.evaluate(() => { const g = BoardApp.state.model.parts.find(x => x.ref === "VL1"); return BoardApp.toScreen(g.place.x, g.place.y + 7.5); });
    await bd.mouse.click(cvz.x + body[0], cvz.y + body[1], { button: "right" }); await bd.waitForTimeout(100);
    const menu = await bd.evaluate(() => [...document.querySelectorAll("#ctx .menu-item span")].map(e => e.textContent));
    await bd.locator("#ctx .menu-item", { hasText: "Turn 90°" }).click();
    const rot1 = await bd.evaluate(() => BoardApp.state.board.parts[BoardApp.state.model.parts.find(g => g.ref === "VL1").key].rot || 0);
    check(menu.includes("Turn 90°") && menu.includes("Lock") && rot1 === ((rot0 + 1) & 3) && await bd.evaluate(() => document.getElementById("ctx").hidden), `right-click on a part offers what fits it (${menu.join(", ")}); Turn 90° turns it`);
    await bd.keyboard.press("Control+z");
    // \ hides the side panels, again shows them
    await bd.locator("#pcb").focus(); await bd.keyboard.press("Backslash"); const bare = await bd.evaluate(() => [document.querySelector(".col.left").offsetParent === null, document.getElementById("pcb").clientWidth]);
    await bd.keyboard.press("Backslash"); const back2 = await bd.evaluate(() => [document.querySelector(".col.left").offsetParent !== null, document.getElementById("pcb").clientWidth]);
    await bd.evaluate(() => BoardApp.fit()); await bd.waitForTimeout(100);
    check(bare[0] && back2[0] && bare[1] > back2[1] + 300, `\\ hides the side panels for more board (${back2[1]} → ${bare[1]} px) and brings them back`);
  }

  // a keep-out drawn with the mouse (K, four corners, double-click); the check reports a track through it
  await bd.keyboard.press("Escape"); await bd.keyboard.press("k");
  for (const [x, y] of [[100, 60], [125, 60], [125, 80]]) { const q = await W(x, y); await bd.mouse.click(q[0], q[1]); }
  const qk = await W(100, 80); await bd.mouse.click(qk[0], qk[1]); await bd.mouse.dblclick(qk[0], qk[1]);
  const kos = await bd.evaluate(() => BoardApp.state.board.keepouts.map(k => k.pts.length));
  await bd.evaluate(() => { BoardApp.state.board.tracks.push({ layer: "B.Cu", w: 1, pts: [[95, 70], [128, 70]] }); BoardApp.commit(); });
  const koMsg = await bd.evaluate(() => BoardApp.state.drc.filter(d => d.kind === "keepout").map(d => d.msg).join("; "));
  check(kos.length === 1 && kos[0] === 4 && /runs through a keep-out area/.test(koMsg), `K draws a keep-out area (${kos.join(",")} corners); a track through it is reported (${koMsg})`);
  await bd.evaluate(() => { BoardApp.state.board.tracks.pop(); BoardApp.commit(); });

  // manufacturing outputs: the Gerber ZIP (the board is unfinished: confirm) and the print PDF
  bd.once("dialog", d => d.accept());
  await bd.click("#btn-export");
  const [zipDl] = await Promise.all([bd.waitForEvent("download"), bd.click("#ex-gerber")]);
  const zipBuf = await readFile(await zipDl.path());
  await bd.click("#btn-export");
  const [pdfDl] = await Promise.all([bd.waitForEvent("download"), bd.click("#ex-pdf")]);
  const pdfBuf = await readFile(await pdfDl.path());
  const zipNames = [...zipBuf.toString("latin1").matchAll(/[\w.-]+\.(?:gbr|drl|txt)/g)].map(m => m[0]);
  check(/gerbers\.zip$/.test(zipDl.suggestedFilename()) && zipBuf.slice(0, 2).toString() === "PK" && zipNames.some(n => /-B_Cu\.gbr$/.test(n)) && zipNames.some(n => /-PTH\.drl$/.test(n)) && /G36\*/.test(zipBuf.toString("latin1")),
    `Export → Gerber + drill files gives ${zipDl.suggestedFilename()} with the copper, mask, silkscreen, outline and drill files (the pour as a region)`);
  check(/-prints\.pdf$/.test(pdfDl.suggestedFilename()) && pdfBuf.slice(0, 4).toString() === "%PDF" && /\/Count 4/.test(pdfBuf.toString("latin1")), `Export → Print set gives a four-page PDF (${pdfDl.suggestedFilename()})`);
  // KiCad: the board with its project, rules and footprints, as a ZIP (no question: it is finished there)
  await bd.click("#btn-export");
  const [kiDl] = await Promise.all([bd.waitForEvent("download"), bd.click("#ex-kicad")]);
  const kiText = (await readFile(await kiDl.path())).toString("utf8");
  check(/-kicad\.zip$/.test(kiDl.suggestedFilename()) && /\.kicad_pcb/.test(kiText) && /\(kicad_pcb \(version 20221018\)/.test(kiText) && /\.kicad_pro/.test(kiText) && /\.kicad_dru/.test(kiText) && /TubeAmpCAD\.pretty\/SOCKET-[\w-]+\.kicad_mod/.test(kiText) && /\(footprint "TubeAmpCAD:SOCKET-/.test(kiText),
    `Export → KiCad board gives ${kiDl.suggestedFilename()}: the .kicad_pcb, its project and rules, and the footprint library`);
  // 3D: the selected part turns in the inspector; the board in 3D (3 / Esc); STEP of board and parts
  await bd.locator('#parts .item', { hasText: "VL1" }).first().click();
  await bd.waitForTimeout(300);
  const gl = await bd.evaluate(() => !!document.createElement("canvas").getContext("webgl"));
  if (gl) {
    const pv1 = await bd.evaluate(() => { const v = BoardApp.preview(); return v && document.querySelector("#inspector .preview3d") ? { key: v.key, n: v.batches.length, glass: v.batches.some(b => b.k === "glass") } : null; });
    await bd.locator("#inspector select").first().selectOption("SOCKET-OCTAL");
    await bd.waitForTimeout(300);
    const pv2 = await bd.evaluate(() => BoardApp.preview() && BoardApp.preview().key);
    check(pv1 && pv1.n > 0 && pv1.glass && /SOCKET-B9A/.test(pv1.key) && /SOCKET-OCTAL/.test(pv2), `the inspector shows the part in 3D (${pv1 && pv1.key}) and follows a footprint change (${pv2})`);
    await bd.keyboard.press("Control+z");
    await bd.click("#btn-view"); await bd.click("#btn-3d"); await bd.waitForTimeout(400);
    const v3 = await bd.evaluate(() => { const v = BoardApp.viewer(); return { shown: !document.getElementById("view3d").hidden, kinds: v ? [...new Set(v.batches.map(b => b.k))].sort().join(",") : "" }; });
    await bd.click('[data-view="bottom"]'); await bd.locator("#gl3d").focus().catch(() => {}); await bd.keyboard.press("Escape");
    check(v3.shown && v3.kinds === "bottom,glass,solid,top" && await bd.evaluate(() => document.getElementById("view3d").hidden), `3D shows the board (textured top and bottom), the parts and the valves' glass (${v3.kinds}); Esc goes back to the layout`);
  } else check(true, "this browser has no WebGL here: the 3D checks are skipped");
  await bd.click("#btn-export");
  const [stepDl] = await Promise.all([bd.waitForEvent("download"), bd.click("#ex-step")]);
  const stepTxt = (await readFile(await stepDl.path())).toString("latin1");
  const nSolids = (stepTxt.match(/MANIFOLD_SOLID_BREP\(/g) || []).length;
  check(/\.step$/.test(stepDl.suggestedFilename()) && stepTxt.startsWith("ISO-10303-21;") && /AUTOMOTIVE_DESIGN/.test(stepTxt) && nSolids > 20 && /END-ISO-10303-21;\s*$/.test(stepTxt), `Export → 3D model (STEP) gives ${stepDl.suggestedFilename()} with ${nSolids} solids (AP214)`);
  // routing that joins up: a clean board with three parts of one net, routed with the mouse
  {
    const saved = await bd.evaluate(() => JSON.stringify(BoardApp.state.board));
    const ids = await bd.evaluate(() => {
      const S = BoardApp.state, c = {}, two = r => S.model.pads.filter(p => p.ref === r).length === 2;
      S.model.pads.forEach(p => { if (p.net !== null && p.netName !== "GND") (c[p.net] = c[p.net] || []).push(p); });
      const e = Object.values(c).find(l => l.length >= 2 && l.every(p => two(p.ref)) && new Set(l.map(p => p.ref)).size === l.length);
      if (!e) return null;
      S.board.tracks = []; S.board.vias = []; S.board.zones = []; S.board.keepouts = []; S.board.holes = []; S.board.texts = [];
      S.board.outline = { w: 200, h: 150, r: 0 };
      Object.values(S.board.parts).forEach((bp, n) => { bp.x = 10 + (n % 10) * 25; bp.y = 260 + Math.floor(n / 10) * 30; bp.rot = 0; bp.side = "F"; delete bp.locked; });
      // the first part placed off the 1.27 mm grid (as tube sockets' pins are), the second clear of it
      const [p, q] = e; Object.assign(S.board.parts[p.part], { x: 40.3, y: 30.2 }); Object.assign(S.board.parts[q.part], { x: 100, y: 60 });
      BoardApp.commit(); BoardApp.fit(); return [p.ref + "-" + p.num, q.ref + "-" + q.num];
    });
    if (!ids) check(false, "the test circuit has a net on two two-pin parts");
    else {
      Object.assign(cv, await bd.locator("#pcb").boundingBox());
      const padXY = id => bd.evaluate(id => { const p = BoardApp.state.model.pads.find(q => q.ref + "-" + q.num === id); return [p.x, p.y]; }, id);
      const [A, Bq] = [await padXY(ids[0]), await padXY(ids[1])];
      const click = async (x, y) => { const q = await at(x, y); await bd.mouse.move(q[0], q[1], { steps: 3 }); await bd.mouse.click(q[0], q[1]); await bd.waitForTimeout(40); };
      const tracks = () => bd.evaluate(() => BoardApp.state.board.tracks.map(t => t.pts));
      const un0 = await bd.evaluate(() => BoardApp.state.conn.unrouted);
      await bd.locator("#pcb").focus(); await bd.keyboard.press("x");
      // corners clicked a little off the pad's axis line up with it: no jog at the off-grid pad
      await click(A[0], A[1]); await click(A[0] + 0.4, A[1] - 12); await click(Bq[0] - 0.3, A[1] - 12); await click(Bq[0], Bq[1]);
      const t1 = await tracks(), un1 = await bd.evaluate(() => BoardApp.state.conn.unrouted);
      const ortho = t1.length === 1 && t1[0].every((p, k) => !k || Math.abs(p[0] - t1[0][k - 1][0]) < 1e-6 || Math.abs(p[1] - t1[0][k - 1][1]) < 1e-6);
      check(ortho && un1 === un0 - 1 && t1[0].length === 4, `a track from an off-grid pad runs straight out of it and into the other pad, no jogs (${JSON.stringify(t1[0])})`);
      // a second track from the middle of the first (off the grid) ends on it again: both joined, nothing left dangling
      const run = t1[0][1], mid = [(t1[0][1][0] + t1[0][2][0]) / 2 + 0.3, run[1] + 0.2];
      await click(mid[0], mid[1]); await click(mid[0], run[1] - 8); await click(mid[0] + 10, run[1] - 8); await click(mid[0] + 10.2, run[1] + 0.3);
      const t2 = await tracks(), st = await bd.evaluate(() => ({ route: !!BoardApp.state.route, dangling: BoardApp.state.drc.filter(d => d.kind === "dangling").length }));
      const on = p => Math.abs(p[1] - run[1]) < 1e-6 && p[0] > t1[0][1][0] && p[0] < t1[0][2][0];
      check(t2.length === 2 && on(t2[1][0]) && on(t2[1][t2[1].length - 1]) && !st.route && st.dangling === 0, `a route starts on a track and ends on a track exactly on their centre lines, and finishes there (${JSON.stringify(t2[1])})`);
      await bd.keyboard.press("Control+z");
      // a corner clicked on copper already joined to the route's start is a corner: ending there would join nothing
      const nT = (await tracks()).length;
      await click(Bq[0], Bq[1]); await click(mid[0], run[1]);
      const stay = await bd.evaluate(() => ({ open: !!BoardApp.state.route, n: BoardApp.state.route ? BoardApp.state.route.pts.length : 0 }));
      await bd.keyboard.press("Escape"); if ((await tracks()).length > nT) await bd.keyboard.press("Control+z");
      check(stay.open && stay.n >= 2 && (await tracks()).length === nT, `a route from a routed pad crosses its own track without ending there (${JSON.stringify(stay)})`);
      // V drops a via and goes on on the other layer; Esc right after it takes the unused via back
      const v0 = await bd.evaluate(() => BoardApp.state.board.vias.length);
      await click(Bq[0], Bq[1]); await click(Bq[0] + 8, Bq[1] + 8); await bd.keyboard.press("v");
      const mid1 = await bd.evaluate(() => ({ vias: BoardApp.state.board.vias.length, layer: BoardApp.state.route && BoardApp.state.route.layer }));
      // the route goes on from its own via on the other layer
      await click(Bq[0] + 16, Bq[1] + 8);
      const goes = await bd.evaluate(() => BoardApp.state.route && BoardApp.state.route.pts.length);
      await bd.keyboard.press("Backspace");
      await bd.keyboard.press("Escape");
      const end1 = await bd.evaluate(() => ({ vias: BoardApp.state.board.vias.length, tracks: BoardApp.state.board.tracks.length }));
      if (end1.tracks > nT) await bd.keyboard.press("Control+z");
      await bd.evaluate(() => BoardApp.setLayer("F.Cu"));
      check(mid1.vias === v0 + 1 && mid1.layer === "B.Cu" && goes >= 2 && end1.vias === v0, `V places a via and switches the route to B.Cu, the route goes on from its own via; Esc right after it removes the unused via (${JSON.stringify({ mid1, goes, end1 })})`);
      // dragging the second part: the track's end follows its pad, the connection holds
      await bd.keyboard.press("Escape"); await bd.keyboard.press("s");
      const body = await bd.evaluate(id => { const g = BoardApp.state.model.parts.find(g => g.ref === id.split("-")[0]); const b = g.fp.box; const p = BoardCore.place([(b[0] + b[2]) / 2, b[3] - 0.6], g.place); return p; }, ids[1]);
      const d0 = await at(body[0], body[1]), d1 = await at(body[0] + 6.35, body[1] + 6.35);
      await bd.mouse.move(d0[0], d0[1]); await bd.mouse.down(); await bd.mouse.move(d1[0], d1[1], { steps: 4 }); await bd.mouse.up(); await bd.waitForTimeout(100);
      const B2 = await padXY(ids[1]), t3 = await tracks(), un3 = await bd.evaluate(() => BoardApp.state.conn.unrouted);
      const end = t3[0][t3[0].length - 1];
      check(Math.hypot(B2[0] - Bq[0], B2[1] - Bq[1]) > 5 && Math.hypot(end[0] - B2[0], end[1] - B2[1]) < 1e-3 && un3 === un1, `moving a part takes the ends of its tracks along (pad ${Bq} → ${B2}); still connected`);
      // straight first would cross the part's own other pad: the diagonal-first way is taken by itself
      await bd.evaluate(() => { BoardApp.state.board.tracks = []; BoardApp.commit(); });
      const other = await bd.evaluate(id => { const [ref, num] = id.split("-"); const p = BoardApp.state.model.pads.find(q => q.ref === ref && q.num !== num); return [p.x, p.y]; }, ids[0]);
      const far = [A[0] + 2 * (other[0] - A[0]) + 12, A[1] + 12];
      await bd.locator("#pcb").focus(); await bd.keyboard.press("x"); await click(A[0], A[1]); const fq = await at(far[0], far[1]); await bd.mouse.move(fq[0], fq[1], { steps: 3 });
      const auto = await bd.evaluate(() => ({ bad: BoardApp.state.routeBad, msg: document.getElementById("st-msg").textContent }));
      await bd.keyboard.press("Escape");
      check(!auto.bad, `the route bends the other way round by itself when straight-first would pass the part's own other pad (${auto.bad ? auto.bad.what : "clear"})`);
    }
    await bd.evaluate(b => { BoardApp.state.board = JSON.parse(b); BoardApp.commit(); BoardApp.fit(); }, saved);
  }
  // SMD: the inspector's checkbox puts a resistor on its chip footprint, pads on the top copper only
  {
    await bd.evaluate(() => { const S = BoardApp.state, g = S.model.parts.find(x => x.type === "resistor"); S.sel = { kind: "part", key: g.key }; BoardApp.commit(); });
    const box = bd.locator("#inspector .row", { hasText: "SMD" }).locator("input[type=checkbox]");
    await box.check();
    const on = await bd.evaluate(() => { const S = BoardApp.state, g = S.model.parts.find(x => x.key === S.sel.key), pads = S.model.pads.filter(p => p.part === g.key);
      return { fp: g.fp.name, layers: [...new Set(pads.map(p => p.layers.join("+")))].join(), files: Object.keys(BoardApp.fabFiles()).filter(n => /Paste|pos\.csv/.test(n)).length, list: [...document.querySelectorAll("#inspector select")][0].options.length && [...[...document.querySelectorAll("#inspector select")][0].options].every(o => /^CHIP-/.test(o.value)) }; });
    check(/^CHIP-\d{4}$/.test(on.fp) && on.layers === "F.Cu" && on.files >= 2 && on.list, `SMD in the inspector: ${on.fp}, pads on ${on.layers}, the footprint list holds chips only, paste layer and placement file in the Gerbers`);
    await bd.locator("#inspector .row", { hasText: "SMD" }).locator("input[type=checkbox]").uncheck();
    const off = await bd.evaluate(() => { const S = BoardApp.state; return S.model.parts.find(x => x.key === S.sel.key).fp.name; });
    check(/^AXIAL-/.test(off), `unticked, it is back on its through-hole footprint (${off})`);
  }
  await bd.close();
}
