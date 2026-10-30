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
  check(await p.evaluate(() => document.querySelector("header").offsetHeight) < 50, "in Russian the toolbar fits one row at 1500 px");
  await lc.close();
}
