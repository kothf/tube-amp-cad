// Interface language: the RU button (or View ▾ → Русский) swaps the menus, buttons, tooltips and
// the inspector into Russian, every open window follows, and English comes back exactly as it was
import { U, browser, check, errors } from "./harness.mjs";

{
  const lc = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await lc.newPage(); p.on("pageerror", e => errors.push(`language: ${e.message}`));
  await p.goto(U("circuit_sandbox.html")); await p.waitForFunction(() => window.TubeCAD && window.I18n);
  await p.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => x.file.startsWith("04-"))));
  await p.waitForFunction(() => { const s = TubeCAD.state.sim; return !s.busy && !s.pending && s.result; }, null, { timeout: 60000 });
  const select = () => p.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(c => c.type === "tube"); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); });
  await select();
  const shot = () => p.evaluate(() => ({ header: document.querySelector("header").innerText, insp: document.getElementById("inspector").innerText, undo: document.getElementById("btn-undo").title, lang: document.documentElement.lang }));
  const en = await shot();
  // a second window of the same browser follows the choice
  const p2 = await lc.newPage(); p2.on("pageerror", e => errors.push(`language 2: ${e.message}`));
  await p2.goto(U("circuit_sandbox.html")); await p2.waitForFunction(() => window.TubeCAD && window.I18n);

  await select();   // (the second window's load resets the selection here)
  await p.click("#btn-lang"); await p.waitForTimeout(200);
  const ru = await shot();
  check(ru.lang === "ru" && /Файл ▾/.test(ru.header) && /Расчёт/.test(ru.header) && ru.undo === "Отменить (Ctrl+Z)",
    `the RU button: the toolbar and its tooltips in Russian ("${ru.header.replace(/\s+/g, " ").slice(0, 60)}…", "${ru.undo}")`);
  check(/Тип лампы/.test(ru.insp) && /Обозначение/.test(ru.insp), "the inspector of a tube in Russian too (Обозначение, Тип лампы)");
  // what the scripts write later is translated as it appears
  await p.evaluate(() => { const S = TubeCAD.state; S.sel.comps.clear(); TubeCAD.updateInspector(); }); await select(); await p.waitForTimeout(100);
  check(/Тип лампы/.test(await p.evaluate(() => document.getElementById("inspector").innerText)), "an inspector drawn again after the switch is Russian as well");
  await p2.waitForFunction(() => document.documentElement.lang === "ru", null, { timeout: 5000 }).catch(() => {});
  check(await p2.evaluate(() => document.documentElement.lang === "ru" && /Файл ▾/.test(document.querySelector("header").innerText)), "another open window follows the language");
  check(await p.evaluate(() => document.querySelector('[data-lang="ru"]').getAttribute("aria-checked") === "true" && localStorage.getItem("tubecad_lang") === "ru"), "View ▾ shows Русский ticked, and the choice is kept in this browser");

  // a reload keeps it; View ▾ → English switches back, the texts exactly as before
  await p.reload(); await p.waitForFunction(() => window.TubeCAD && window.I18n);
  check(await p.evaluate(() => /Файл ▾/.test(document.querySelector("header").innerText) && document.getElementById("btn-lang").textContent === "EN"), "a reload opens in Russian; the toolbar button offers EN");
  await p.click("#btn-view"); await p.click('[data-lang="en"]'); await p.keyboard.press("Escape"); await p.waitForTimeout(200); await select();
  const back = await shot();
  check(back.lang === "en" && back.header === en.header && back.insp.split("\n")[0] === en.insp.split("\n")[0] && back.undo === en.undo,
    `View ▾ → English switches back, the toolbar exactly as it was ("${back.header.replace(/\s+/g, " ").slice(0, 40)}…")`);
  // the toolbar still fits one row in Russian at 1500 px
  await p.click("#btn-lang"); await p.waitForTimeout(100);
  const rows = [];
  for (const w of [1920, 1500, 1280]) { await p.setViewportSize({ width: w, height: 900 }); await p.waitForTimeout(100); rows.push(await p.evaluate(() => document.querySelector("header").offsetHeight)); }
  check(rows.every(h => h < 50), `in Russian the toolbar fits one row at 1920, 1500 and 1280 px (${rows.join(", ")} px high)`);
  await lc.close();
}

// the Board window, the instruments and the hover hints follow the language too
{
  const lc = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  await lc.addInitScript(() => localStorage.setItem("tubecad_lang", "ru"));
  const p = await lc.newPage(); p.on("pageerror", e => errors.push(`language: ${e.message}`)); p.on("dialog", d => d.accept());
  await p.goto(U("circuit_sandbox.html")); await p.waitForFunction(() => window.TubeCAD && window.I18n);
  await p.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => x.file.startsWith("04-"))));
  await p.waitForFunction(() => { const s = TubeCAD.state.sim; return !s.busy && !s.pending && s.result; }, null, { timeout: 60000 });
  const tip = () => p.evaluate(() => { const t = document.getElementById("hint-tip"); return t && t.classList.contains("on") ? t.innerText : ""; });
  await p.hover(".pal-item"); await p.waitForTimeout(700);
  const palTip = await tip();
  check(/[А-Яа-я]{4}/.test(palTip) && /Щёлкните, затем щёлкните на листе/.test(palTip), `a palette part's hover hint in Russian ("${palTip.replace(/\s+/g, " ").slice(0, 50)}…")`);
  await p.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(c => c.type === "tube"); S.sel.comps.clear(); S.sel.comps.add(c.id); TubeCAD.updateInspector(); });
  await p.waitForTimeout(300);
  const lbl = p.locator("#inspector .has-hint", { hasText: "Тип лампы" }).first();
  await p.mouse.move(0, 0); await p.waitForTimeout(200); await lbl.hover(); await p.waitForTimeout(700);
  const lblTip = await tip();
  check(/С ним приходят предельные режимы/.test(lblTip), `an inspector label (Тип лампы) finds its hint and shows it in Russian ("${lblTip.replace(/\s+/g, " ").slice(0, 50)}…")`);

  const open = async (url, ready) => {
    const [w] = await Promise.all([lc.waitForEvent("page"), p.evaluate(u => { window.open(u, "_blank"); }, url)]);
    w.on("pageerror", e => errors.push(`language ${url}: ${e.message}`)); w.on("dialog", d => d.accept());
    await w.waitForLoadState("load"); await w.waitForFunction(ready, null, { timeout: 15000 }).catch(() => {}); await w.waitForTimeout(500);
    return w;
  };
  const b = await open("board.html", () => /Разводка ▾/.test(document.querySelector("header").innerText));
  const bt = await b.evaluate(() => ({ head: document.querySelector("header").innerText, h: document.querySelector("header").offsetHeight, side: document.querySelector("main").innerText, btn: document.getElementById("btn-lang").textContent }));
  check(/Разводка ▾/.test(bt.head) && /Плата ▾/.test(bt.head) && /Экспорт ▾/.test(bt.head) && /Детали/.test(bt.side) && bt.btn === "EN", "the Board window opens in Russian (Разводка ▾, Плата ▾, Экспорт ▾, Детали)");
  check(bt.h < 50, `in Russian the Board toolbar fits one row at 1500 px (${bt.h} px high)`);
  await b.close();
  for (const [url, re, what] of [["oscilloscope.html", /Вольт\/дел/, "Вольт/дел"], ["spectrum_analyzer.html", /Гармоники|Основная/, "Основная"], ["bode.html", /Отображение/i, "Отображение"], ["index.html", /Характериограф/, "Характериограф"]]) {
    const w = await open(url, () => true);
    const t = await w.evaluate(() => ({ text: document.body.innerText, h: document.querySelector("header").offsetHeight }));
    check(re.test(t.text) && t.h < 50, `${url} opens in Russian (${what}) with its toolbar on one row (${t.h} px)`);
    await w.close();
  }
  await lc.close();
}
