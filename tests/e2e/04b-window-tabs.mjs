// Window tabs at the bottom of the CAD (cad-tabs.js): the board, the instruments and the manual
// as tabs of one browser tab, on by default
import { U, browser, check, errors } from "./harness.mjs";

{
  const tc = await browser.newContext({ viewport: { width: 1400, height: 860 }, tabs: true });
  const p = await tc.newPage();
  p.on("pageerror", e => errors.push(`tabs cad: ${e.message}`));
  await p.goto(U("circuit_sandbox.html")); await p.waitForFunction(() => window.TubeCAD && ToolWindows.tabs);
  const tabs = () => p.evaluate(() => [...document.querySelectorAll("#win-tabs .wt-tab")].map(t => t.dataset.file + (t.classList.contains("on") ? "*" : "") + (t.classList.contains("away") ? "~" : "")));
  const shown = () => p.evaluate(() => { const f = [...document.querySelectorAll("iframe.tab-frame")].find(x => !x.hidden); return f ? f.id : "schematic"; });

  const t0 = await tabs();
  const s0 = await p.evaluate(() => { const r = document.getElementById("win-tabs").getBoundingClientRect(); return { vis: !document.getElementById("win-tabs").hidden, bottom: Math.round(r.bottom), h: Math.round(r.height), checked: document.getElementById("btn-board-tab").getAttribute("aria-checked") }; });
  check(s0.vis && s0.bottom === 860 && s0.h === 30 && t0.join() === "circuit_sandbox.html*,board.html" && s0.checked === "true",
    `by default the CAD has the tab strip at the bottom with Schematic (shown) and Board, and View ▾ → Windows as tabs is ticked (${t0.join()} ${JSON.stringify(s0)})`);

  // two scope parts, so an instrument tab can be switched between them
  const two = await p.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
    const a = C.makeComp("scope", {}, 300, 300, 0), b = C.makeComp("scope", {}, 300, 500, 0); S.comps.push(a, b); S.view = { scale: 1, ox: 0, oy: 0 }; C.commit(); return [a.id, b.id];
  });
  const n0 = tc.pages().length;

  // the Board tab: the board in a frame above the strip, no new window
  await p.click('#win-tabs .wt-tab[data-file="board.html"]');
  await p.waitForFunction(() => { const f = document.getElementById("board-tab"); return f && !f.hidden && f.contentWindow.BoardApp && f.contentWindow.BoardApp.state.model; }, null, { timeout: 10000 }).catch(() => {});
  check(await shown() === "board-tab" && (await tabs()).includes("board.html*") && tc.pages().length === n0, "the Board tab shows the board in this window");
  await p.frameLocator("#board-tab").locator("#pcb").focus(); await p.keyboard.press("Alt+S"); await p.waitForTimeout(150);
  check(await shown() === "schematic" && (await tabs())[0] === "circuit_sandbox.html*", "Alt+S in the board's tab goes back to the Schematic tab");

  // an instrument from Analyze ▾ opens as a tab; asking again brings the same tab
  await p.click("#btn-analyze"); await p.click("#btn-open-scope");
  await p.waitForFunction(() => { const f = document.getElementById("tab-oscilloscope"); return f && !f.hidden && f.contentWindow.Instrument; }, null, { timeout: 10000 }).catch(() => {});
  await p.click('#win-tabs .wt-tab[data-file="circuit_sandbox.html"]');
  await p.click("#btn-analyze"); await p.click("#btn-open-scope"); await p.waitForTimeout(300);
  const t1 = await tabs();
  check(t1.join() === "circuit_sandbox.html,board.html,oscilloscope.html*" && await p.evaluate(() => document.querySelectorAll("#tab-oscilloscope").length === 1) && tc.pages().length === n0,
    `Analyze ▾ → Oscilloscope twice opens one Oscilloscope tab, no window (${t1.join()})`);
  // double-clicking the other scope part on the sheet switches the tab to it and shows it
  await p.click('#win-tabs .wt-tab[data-file="circuit_sandbox.html"]');
  const sc2 = await p.evaluate(id => { const S = TubeCAD.state, c = S.comps.find(k => k.id === id), r = document.getElementById("cad").getBoundingClientRect(); return [r.left + c.x * S.view.scale + S.view.ox, r.top + c.y * S.view.scale + S.view.oy]; }, two[1]);
  await p.mouse.dblclick(sc2[0], sc2[1]);
  await p.waitForFunction(id => { const f = document.getElementById("tab-oscilloscope"); return f && !f.hidden && f.contentWindow.Instrument.scopeId === id; }, two[1], { timeout: 5000 }).catch(() => {});
  check(await p.evaluate(id => { const f = document.getElementById("tab-oscilloscope"); return !f.hidden && f.contentWindow.Instrument.scopeId === id; }, two[1]), "double-clicking another scope part shows the Oscilloscope tab switched to it");

  // the instrument's own Schematic | Board switch works in its tab
  await p.frameLocator("#tab-oscilloscope").locator("#btn-board").click(); await p.waitForTimeout(150);
  const a1 = await shown();
  await p.frameLocator("#board-tab").locator("#btn-cad").click(); await p.waitForTimeout(150);
  const a2 = await shown();
  check(a1 === "board-tab" && a2 === "schematic", `in a tab, the tool's Schematic | Board switch flips the tabs (${a1}, ${a2})`);

  // + opens the others; × closes a tab
  await p.click("#win-tabs .wt-add");
  const offered = await p.evaluate(() => [...document.querySelectorAll(".wt-menu .wt-mi")].map(b => b.dataset.file));
  await p.click('.wt-menu .wt-mi[data-file="bode.html"]');
  await p.waitForFunction(() => { const f = document.getElementById("tab-bode"); return f && !f.hidden && f.contentWindow.Instrument; }, null, { timeout: 10000 }).catch(() => {});
  await p.hover('#win-tabs .wt-tab[data-file="oscilloscope.html"]'); await p.click('#win-tabs .wt-tab[data-file="oscilloscope.html"] .wt-x');
  const t2 = await tabs();
  check(offered.join() === "spectrum_analyzer.html,bode.html,index.html,help.html" && t2.join() === "circuit_sandbox.html,board.html,bode.html*" && await p.evaluate(() => !document.getElementById("tab-oscilloscope")),
    `+ offers the tools not open (${offered.join()}), Bode plotter opens in a tab, × closes the Oscilloscope tab (${t2.join()})`);

  // ⧉ moves a tab's page to a window of its own: the tab stays, dimmed, and brings that window up
  const [bw] = await Promise.all([tc.waitForEvent("page"), p.click('#win-tabs .wt-tab[data-file="bode.html"] .wt-pop')]);
  bw.on("pageerror", e => errors.push(`tabs bode window: ${e.message}`));
  await bw.waitForLoadState();
  const t3 = await tabs();
  check(/bode\.html/.test(bw.url()) && t3.includes("bode.html~") && await p.evaluate(() => !document.getElementById("tab-bode")) && await shown() === "schematic",
    `⧉ opens the Bode plotter in a window of its own and leaves its tab dimmed (${t3.join()})`);
  await p.click('#win-tabs .wt-tab[data-file="bode.html"]'); await p.waitForTimeout(200);
  check(tc.pages().length === n0 + 1 && await p.evaluate(() => !document.getElementById("tab-bode")), "clicking the dimmed tab brings the window up, no second copy");
  await bw.close(); await p.waitForTimeout(100);
  await p.click('#win-tabs .wt-tab[data-file="bode.html"]');
  await p.waitForFunction(() => { const f = document.getElementById("tab-bode"); return f && !f.hidden; }, null, { timeout: 10000 }).catch(() => {});
  check(await shown() === "tab-bode", "once that window is closed, the tab shows the page in this window again");

  // the manual from Help ▾ is a tab too
  await p.click('#win-tabs .wt-tab[data-file="circuit_sandbox.html"]');
  await p.click("#btn-help"); await p.click("#btn-open-manual");
  await p.waitForFunction(() => { const f = document.getElementById("tab-help"); return f && !f.hidden && f.contentDocument && f.contentDocument.querySelector("main"); }, null, { timeout: 10000 }).catch(() => {});
  check(await shown() === "tab-help" && tc.pages().length === n0, "Help ▾ → Manual opens the manual in a tab");

  // a reload keeps the tabs and the one shown
  await p.reload(); await p.waitForFunction(() => window.TubeCAD && ToolWindows.tabs);
  await p.waitForFunction(() => { const f = document.getElementById("tab-help"); return f && !f.hidden; }, null, { timeout: 10000 }).catch(() => {});
  const t4 = await tabs();
  check(t4.join() === "circuit_sandbox.html,board.html,bode.html,help.html*", `a reload keeps the open tabs and shows the same one (${t4.join()})`);

  // a narrow window: the strip stays one row of 30 px
  await p.setViewportSize({ width: 560, height: 760 }); await p.waitForTimeout(150);
  const narrow = await p.evaluate(() => Math.round(document.getElementById("win-tabs").getBoundingClientRect().height));
  check(narrow === 30, `at 560 px the tab strip is still one row (${narrow} px)`);
  await p.setViewportSize({ width: 1400, height: 860 });

  // unticked: the tabs go; a tool opens a window of its own again
  await p.click('#win-tabs .wt-tab[data-file="circuit_sandbox.html"]');
  await p.click("#btn-view"); await p.click("#btn-board-tab"); await p.keyboard.press("Escape");
  const off = await p.evaluate(() => document.getElementById("win-tabs").hidden && !document.querySelector("iframe.tab-frame") && localStorage.getItem("tubecad_tabs") === "0");
  const [sw] = await Promise.all([tc.waitForEvent("page"), p.click("#btn-analyze").then(() => p.click("#btn-open-spectrum"))]);
  check(off && /spectrum_analyzer\.html/.test(sw.url()), "View ▾ → Windows as tabs unticked: the strip and the frames go, the spectrum analyzer opens in a window of its own");
  await tc.close();
}
