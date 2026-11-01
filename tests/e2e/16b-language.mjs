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
  await lc.addInitScript(() => { if (!localStorage.getItem("tubecad_lang")) localStorage.setItem("tubecad_lang", "ru"); });
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
  // the manual: help.html opens its Russian translation, with the parts reference in Russian too;
  // its EN button switches the manual (and the interface) back to English
  const [man] = await Promise.all([lc.waitForEvent("page"), p.click("#btn-windows").then(() => p.click("#btn-open-manual"))]);
  man.on("pageerror", e => errors.push(`language manual: ${e.message}`));
  await man.waitForURL(/help-ru\.html/, { timeout: 15000 }).catch(() => {}); await man.waitForLoadState("load"); await man.waitForTimeout(500);
  const mr = await man.evaluate(() => ({ url: location.pathname, h1: document.querySelector("h1").textContent, parts: document.querySelectorAll(".part").length, res: (document.querySelector("#part-resistor") || {}).innerText || "", toc: document.querySelectorAll("#toc-list li").length, name: window.name }));
  check(/help-ru\.html$/.test(mr.url) && /Руководство/.test(mr.h1) && mr.parts >= 28 && /Сопротивление/.test(mr.res) && /Постоянный резистор/.test(mr.res) && mr.toc > 40 && mr.name === "tube_help",
    `in Russian the manual opens in Russian (${mr.url}, ${mr.parts} parts, the resistor's fields and hint in Russian, ${mr.toc} contents entries)`);
  await Promise.all([man.waitForURL(/help\.html/), man.click("#lang-switch")]); await man.waitForTimeout(300);
  const me = await man.evaluate(() => ({ url: location.pathname, h1: document.querySelector("h1").textContent, lang: localStorage.getItem("tubecad_lang") }));
  check(/\/help\.html$/.test(me.url) && /Manual/.test(me.h1) && me.lang === "en", `the manual's EN button opens the English manual and switches the interface to English (${JSON.stringify(me)})`);
  await man.close();
  await lc.close();
}

// Help → About & credits: who made it, what it is built on, licence and disclaimer, in both
// languages (every text in the dialog is translated); the manual ends with the same section
{
  const lc = await browser.newContext({ viewport: { width: 1500, height: 900 } });
  const p = await lc.newPage(); p.on("pageerror", e => errors.push(`about: ${e.message}`));
  await p.goto(U("circuit_sandbox.html")); await p.waitForFunction(() => window.TubeCAD && window.I18n && window.TubeAbout);
  const openAbout = async () => { await p.click("#btn-help"); await p.click("#btn-help-about"); await p.waitForTimeout(150); };
  await openAbout();
  const en = await p.evaluate(() => {
    const m = document.getElementById("about-modal"), img = m.querySelector(".about-head img");
    return { shown: !m.hidden, help: !document.getElementById("help-modal").hidden, text: m.innerText, logo: img.complete && img.naturalWidth > 0,
      links: [...m.querySelectorAll("a")].map(a => a.href), focus: document.activeElement.id };
  });
  check(en.shown && !en.help && en.logo && en.focus === "btn-about-close" && /Andrey Dumchin/.test(en.text) && /Norman Koren/.test(en.text) && /Katsnelson/.test(en.text)
    && /AssemblyScript/.test(en.text) && /MIT licence/.test(en.text) && /lethal voltages/.test(en.text)
    && en.links.includes("https://aerocat.tech/posts/tube-amp-cad/") && en.links.includes("https://github.com/kothf/tube-amp-cad"),
    "Help → About & credits: logo, author, links, models and data, software, MIT licence and the safety note");
  await p.keyboard.press("Escape");
  check(await p.evaluate(() => document.getElementById("about-modal").hidden), "Esc closes About");
  await p.click("#btn-lang"); await p.waitForTimeout(150);
  await openAbout();
  await p.click("#about-modal .about-more summary");
  const ru = await p.evaluate(() => {
    const m = document.getElementById("about-modal"), left = [];
    const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (/[A-Za-z]{3}/.test(n.data) && !/[А-Яа-яЁё]/.test(n.data) && !n.parentElement.closest("[data-i18n-skip]")) left.push(n.data.trim());
    return { left, text: m.textContent, blog: [...m.querySelectorAll("a")].some(a => a.href === "https://aerocat.tech/ru/posts/tube-amp-cad/") };
  });
  check(ru.left.length === 0 && /Модели и данные/.test(ru.text) && /смертельно опасные/.test(ru.text) && ru.blog,
    `About in Russian: every text translated, the Russian blog post linked (${JSON.stringify({ blog: ru.blog, m: /Модели и данные/.test(ru.text), w: /смертельно опасные/.test(ru.text) })})${ru.left.length ? ` (left: ${ru.left.slice(0, 4).join(" | ")})` : ""}`);
  await p.click("#btn-about-close");
  const h = await lc.newPage(); h.on("pageerror", e => errors.push(`manual about: ${e.message}`));
  // the interface is in Russian now, so help.html opens the Russian manual
  await h.goto(U("help.html")); await h.waitForURL(/help-ru\.html/).catch(() => {}); await h.waitForSelector("#about-body .about-head");
  const man = await h.evaluate(() => ({ text: document.getElementById("about-body").innerText, toc: [...document.querySelectorAll("#toc-list a")].map(a => a.textContent) }));
  check(/Norman Koren/.test(man.text) && /Igor Gubin/.test(man.text) && /RADIO BOB/.test(man.text) && /Модели и данные/i.test(man.text) && /смертельно опасные/.test(man.text) && man.toc.includes("19. О программе и благодарности"),
    "the manual ends with About and credits, with every credit shown and listed in the contents (in Russian, as the interface is)");
  await lc.close();
}
