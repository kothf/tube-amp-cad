// Tolerance runs, toolbar, hints and the manual, the board as a tab
import { U, browser, cad, check, ctx, errors } from "./harness.mjs";

// --- Tolerance runs (Monte Carlo) ---------------------------------------------------------
{
  cad.once("dialog", d => d.accept());
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^03-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 });
  await cad.evaluate(() => TubeCAD.toggleBom(true, "tolerance"));
  for (const [id, v] of [["#tol-runs", "6"], ["#tol-seed", "42"]]) { await cad.fill(id, v); await cad.press(id, "Tab"); }
  const runTol = async () => {
    const seq = await cad.evaluate(() => TubeCAD.state.tol.seq);
    await cad.click("#btn-tol-run");
    await cad.waitForFunction(seq => TubeCAD.state.tol.seq !== seq && !TubeCAD.state.tol.job && TubeCAD.state.tol.rows, seq, { timeout: 120000 });
    return cad.evaluate(() => TubeCAD.state.tol.rows);
  };
  const rows = await runTol(), row = l => rows.find(r => r.label === l) || {};
  const ia = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.label === "VL1"); return TubeCAD.tubeData(c).dc.ia; });
  check(["VL1 Ia", "VL1 Pa", "VT1 Ic", "P1 CH1 AC"].every(l => row(l).n === 6), `the Tolerance tab measures tubes, transistors and scope channels over 6 runs (${rows.length} quantities)`);
  check(Math.abs(row("VL1 Ia").nominal / ia - 1) < 1e-3, `the nominal is the circuit as drawn (VL1 Ia ${(row("VL1 Ia").nominal * 1e3).toFixed(3)} mA, simulated ${(ia * 1e3).toFixed(3)} mA)`);
  check(rows.every(r => r.min <= r.mean && r.mean <= r.maxV) && row("VL1 Ia").sd > 0 && row("VL2 Va").maxV > row("VL2 Va").min, `each quantity spreads around its mean (VL2 Va ${row("VL2 Va").min.toFixed(1)}…${row("VL2 Va").maxV.toFixed(1)} V)`);
  const again = await runTol();
  check(JSON.stringify(again) === JSON.stringify(rows), "the same seed repeats the same runs");
  const table = await cad.locator("#tol-table tbody tr").count();
  check(table === rows.length, `the table shows one line per quantity (${table})`);
  await cad.evaluate(() => { const r = TubeCAD.state.comps.find(c => c.label === "R2"); r.params.r = 120e3; TubeCAD.commit(); });
  check(await cad.locator("#tol-pane .tol-note").count() === 1, "an edit marks the shown spread as the old circuit's");
  await cad.evaluate(() => TubeCAD.toggleBom(false));
}

// --- toolbar, hover hints and the manual ---------------------------------------
{
  await cad.bringToFront();
  const hh = await cad.evaluate(() => document.querySelector("header").offsetHeight);
  check(hh < 50, `the toolbar fits on one row at 1500 px (${hh} px high)`);
  await cad.click("#btn-view");
  const viewOpen = await cad.locator("#view-menu .menu-list").isVisible();
  await cad.click("#btn-volts");
  const stillOpen = await cad.locator("#view-menu .menu-list").isVisible();
  const off = await cad.evaluate(() => !TubeCAD.state.showVolts && document.getElementById("btn-volts").getAttribute("aria-checked") === "false");
  await cad.click("#btn-volts"); await cad.keyboard.press("Escape");
  check(viewOpen && stillOpen && off && await cad.evaluate(() => TubeCAD.state.showVolts), "View ▾ ticks Voltages off and on, staying open and reporting aria-checked");
  await cad.click("#btn-windows"); await cad.click("#btn-file");
  check(await cad.evaluate(() => document.querySelector("#win-menu .menu-list").hidden && !document.querySelector("#file-menu .menu-list").hidden), "opening one toolbar menu closes the other");
  await cad.keyboard.press("Escape");
  // hover hints: an inspector field and a readout
  cad.once("dialog", d => d.accept());
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /gubin/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.sim.result && !TubeCAD.state.sim.busy && TubeCAD.state.comps.some(c => c.type === "tube"), null, { timeout: 60000 });
  await cad.evaluate(() => { const S = TubeCAD.state, t = S.comps.filter(c => c.type === "tube").pop(); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(t.id); TubeCAD.updateInspector(); });
  await cad.waitForTimeout(300);
  const lbl = cad.locator("#inspector .row > span.has-hint").first();
  await lbl.hover(); await cad.waitForTimeout(450);
  const tip = await cad.evaluate(() => { const t = document.getElementById("hint-tip"); return t && t.classList.contains("on") ? t.textContent : ""; });
  check(tip.length > 30, `hovering an inspector label shows its hint ("${tip.slice(0, 60)}…")`);
  const unhinted = await cad.evaluate(() => [...document.querySelectorAll("#inspector .kv > span:first-child, #inspector .row > span:first-child")].filter(e => !e.classList.contains("has-hint")).map(e => e.textContent));
  check(unhinted.length === 0, `every label in a tube's inspector has a hint${unhinted.length ? ` (missing: ${unhinted.join(", ")})` : ""}`);
  const palHint = await cad.evaluate(() => document.querySelector(".pal-item").dataset.hint || "");
  check(/Click, then click on the sheet/.test(palHint) && palHint.length > 60, "palette parts carry a hint of what they are");
  // the manual
  const [man] = await Promise.all([ctx.waitForEvent("page"), cad.click("#btn-windows").then(() => cad.click("#btn-open-manual"))]);
  await man.waitForLoadState(); await man.waitForTimeout(500);
  const m = await man.evaluate(() => ({ parts: document.querySelectorAll(".part").length, tubes: document.querySelectorAll("#tube-table tr").length - 1, gloss: document.querySelectorAll("#glossary tr").length, toc: document.querySelectorAll("#toc-list li").length, name: window.name }));
  check(m.parts >= 28 && m.tubes >= 99 && m.gloss > 100 && m.toc > 40 && m.name === "tube_help", `Windows ▸ Manual opens the manual: ${m.parts} parts, ${m.tubes} tubes, ${m.gloss} glossary rows, ${m.toc} contents entries`);
  await man.fill("#q", "Miller"); await man.waitForTimeout(400);
  const found = await man.evaluate(() => document.querySelectorAll("main mark").length);
  check(found > 2, `searching the manual marks the matches (${found})`);
  await man.close();
}
// --- the board as a tab of the CAD window ---------------------------------------------------
{
  await cad.bringToFront();
  const n0 = ctx.pages().length;
  await cad.click("#btn-windows"); await cad.click("#btn-board-tab"); await cad.keyboard.press("Escape");
  await cad.click("#btn-doc-board");
  await cad.waitForFunction(() => { const f = document.getElementById("board-tab"); return f && f.contentWindow.BoardApp && f.contentWindow.BoardApp.state.model; }, null, { timeout: 10000 }).catch(() => {});
  const t1 = await cad.evaluate(() => { const f = document.getElementById("board-tab"), r = f.getBoundingClientRect(); return { shown: !f.hidden && r.width === innerWidth && r.height === innerHeight, parts: f.contentWindow.BoardApp.state.model.parts.length, name: f.contentWindow.name }; });
  await cad.frameLocator("#board-tab").locator("#btn-cad").click(); await cad.waitForTimeout(150);
  const t2 = await cad.evaluate(() => document.getElementById("board-tab").hidden);
  await cad.keyboard.press("Alt+B"); await cad.waitForTimeout(150);
  const t3 = await cad.evaluate(() => !document.getElementById("board-tab").hidden);
  await cad.frameLocator("#board-tab").locator("#pcb").focus(); await cad.keyboard.press("Alt+S"); await cad.waitForTimeout(150);
  const t4 = await cad.evaluate(() => document.getElementById("board-tab").hidden);
  // the switch keeps working: the buttons flip back and forth, not only once
  const flips = [];
  for (let i = 0; i < 4; i++) {
    await cad.click("#btn-doc-board"); await cad.waitForTimeout(100);
    flips.push(await cad.evaluate(() => !document.getElementById("board-tab").hidden));
    await cad.frameLocator("#board-tab").locator("#btn-cad").click(); await cad.waitForTimeout(100);
    flips.push(await cad.evaluate(() => document.getElementById("board-tab").hidden));
  }
  check(flips.every(Boolean), `the Schematic | Board switch flips the board in this window again and again (${flips.map(f => f ? "ok" : "stuck").join(" ")})`);
  check(t1.shown && t1.parts > 0 && !t1.name && t2 && t3 && t4 && ctx.pages().length === n0,
    `Windows ▾ → Board in this window: Board shows the layout over the whole window (${t1.parts} parts), Schematic or Alt+S hides it, Alt+B shows it again, no new window`);
  await cad.click("#btn-windows"); await cad.click("#btn-board-tab"); await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => !document.getElementById("board-tab")), "unticked, the board frame goes and the board has its own window again");
}
// --- Safari: a page may raise only a window it opened ---------------------------------------
{
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const sc = await browser.newContext({ viewport: { width: 1500, height: 900 }, userAgent: SAFARI });
  const sp = await sc.newPage(); sp.on("pageerror", e => errors.push(`safari cad: ${e.message}`));
  await sp.goto(U("circuit_sandbox.html")); await sp.waitForFunction(() => window.TubeCAD);
  const flips = [];
  for (let i = 0; i < 3; i++) {
    await sp.click("#btn-doc-board");
    await sp.waitForFunction(() => { const f = document.getElementById("board-tab"); return f && !f.hidden && f.contentWindow.BoardApp; }, null, { timeout: 10000 }).catch(() => {});
    flips.push(await sp.evaluate(() => { const f = document.getElementById("board-tab"); return !!f && !f.hidden; }));
    await sp.frameLocator("#board-tab").locator("#btn-cad").click(); await sp.waitForTimeout(100);
    flips.push(await sp.evaluate(() => document.getElementById("board-tab").hidden));
  }
  check(flips.every(Boolean) && sc.pages().length === 1, `in Safari the board opens in the CAD window by default and the switch flips every time (${flips.map(f => f ? "ok" : "stuck").join(" ")})`);
  // ticked off: the Board window cannot bring the CAD's tab up, and says so instead of doing nothing
  await sp.click("#btn-windows"); await sp.click("#btn-board-tab"); await sp.keyboard.press("Escape");
  const [sb] = await Promise.all([sc.waitForEvent("page"), sp.click("#btn-doc-board")]);
  sb.on("pageerror", e => errors.push(`safari board: ${e.message}`));
  await sb.waitForFunction(() => window.BoardApp && BoardApp.state.model, null, { timeout: 10000 }).catch(() => {});
  await sb.click("#btn-cad");
  await sb.waitForSelector("#win-note:not([hidden])", { timeout: 2000 }).catch(() => {});
  const note = await sb.evaluate(() => { const n = document.getElementById("win-note"); return n && !n.hidden ? n.textContent : ""; });
  check(/Safari/.test(note) && /Board in this window/.test(note) && sc.pages().length === 2, `in Safari with the board in its own window, Schematic there explains why the CAD did not come up ("${note.slice(0, 60)}…")`);
  await sc.close();
}
