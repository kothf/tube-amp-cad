/* About / Credits: who made Tube Amp CAD, what it is built on and whose work it uses.
   One source for the CAD's About dialog (Help → About & credits) and the manual's last section.
   Every text has its Russian twin here and is added to the dictionary (I18N_RU) when this file
   loads, so the language switch translates the dialog like the rest of the app. Names, titles
   and licences stay as written (data-i18n-skip).
   The app ships no third-party code: the solver in sim-solver.wasm is our own, compiled by
   AssemblyScript (whose small runtime is inside it). Add a line here for anything that changes that. */
(function (root) {
  "use strict";
  const REPO = "https://github.com/kothf/tube-amp-cad";

  // [name, url, English, Russian, licence or source]
  const SOFTWARE = [
    ["AssemblyScript", "https://www.assemblyscript.org",
      "Compiles the circuit solver to WebAssembly; its runtime is inside sim-solver.wasm.",
      "Компилирует решатель схем в WebAssembly; его среда выполнения входит в sim-solver.wasm.", "Apache-2.0"],
    ["Freerouting", "https://www.freerouting.app",
      "Optional autorouter for the board. It runs as its own server and is not part of the app.",
      "Необязательный автотрассировщик платы. Работает отдельным сервером и не входит в приложение.", "GPL-3.0"],
  ];
  const MODELS = [
    ["Norman Koren", "https://www.normankoren.com/Audio/Tubemodspice_article.html",
      "The triode equation, used unmodified, and the space-charge term of the pentode model.",
      "Уравнение триода, без изменений, и член пространственного заряда в модели пентода.", "Improved vacuum tube models for SPICE"],
    ["B. V. Katsnelson, A. S. Larionov", "",
      "Ratings and pinouts of the Soviet receiving tubes.",
      "Параметры и цоколёвки советских приёмно-усилительных ламп.", "Отечественные приёмно-усилительные лампы и их зарубежные аналоги, 1981"],
    ["RCA, GE, Philips, Mullard, Western Electric, GEC", "",
      "Datasheets the Western tubes' ratings and models were fitted to.",
      "Справочные листки, по которым подобраны параметры и модели зарубежных ламп.", "datasheets"],
    ["Texas Instruments, onsemi, Toshiba, Vishay, Omron, Hammond and other makers", "",
      "Datasheets and drawings behind the transistors, diodes, ICs, relays and transformers.",
      "Справочные листки и чертежи транзисторов, диодов, микросхем, реле и трансформаторов.", "datasheets"],
    ["SPICE (UC Berkeley)", "",
      "The Gummel-Poon, JFET and level-1 MOSFET device models.",
      "Модели транзисторов Гуммеля–Пуна, JFET и MOSFET первого уровня.", "device models"],
    ["A. N. Thiele, R. H. Small", "",
      "The loudspeaker and headphone model.",
      "Модель громкоговорителя и наушников.", "Thiele–Small parameters"],
    ["ngspice", "https://ngspice.sourceforge.io",
      "The reference the simulator is tested against (in the tests only, not shipped).",
      "Эталон, с которым сверяется симулятор (только в тестах, в приложение не входит).", "BSD-3-Clause"],
    ["IEC 60617, IEC 61082, ISO 5457, ГОСТ 2.710", "",
      "Symbols, drawing frames and designations.",
      "Условные обозначения, рамки чертежей и позиционные обозначения.", "standards"],
  ];
  const EXAMPLES = [
    ["Igor Gubin", "https://radionic.ru/node/631", "Three-tube 6N23P-EV + 6P14P amplifier.", "Трёхламповый усилитель 6Н23П-ЕВ + 6П14П.", "radionic.ru"],
    ["Radio 4/1957", "", "Stereo amplifier with a 5Ц4С supply.", "Стереоусилитель с выпрямителем на 5Ц4С.", "musicangel.ru"],
    ["John Broskie", "", "12AX7 with a plate resistor or a current source.", "12AX7 с анодным резистором или источником тока.", "TubeCAD, 2000"],
    ["University of Washington", "", "2N3904 common-emitter stages, with bench measurements.", "Каскады на 2N3904 с общим эмиттером и измерения на стенде.", "lab notes, 2017"],
    ["homemade-circuits.com", "", "10 W complementary MOSFET amplifier.", "Усилитель 10 Вт на комплементарных MOSFET.", "fig. 1"],
    ["555-timer-circuits.com", "", "The five NE555 circuits.", "Пять схем на NE555.", "555-timer-circuits.com"],
  ];
  const SERVICES = [
    ["Anthropic Claude, OpenAI, Google Gemini", "", "The AI assistant, with your own key.", "AI-ассистент, с вашим собственным ключом.", "optional"],
    ["DigiKey", "https://developer.digikey.com", "Part lookup in the bill of materials, with your own key.", "Поиск деталей в перечне элементов, с вашим собственным ключом.", "optional"],
    ["RADIO BOB! 70s Rock", "https://www.radiobob.de", "The live radio you can play through a circuit in Listen.", "Живое радио, которое можно пропустить через схему в «Послушать».", "optional"],
  ];

  const T = {
    "About & credits": "О программе и благодарности",
    "Tube Amp CAD: about": "Tube Amp CAD: о программе",
    "Made by": "Автор:",
    "Blog post": "Статья в блоге", "Source on GitHub": "Исходный код на GitHub", "What's new": "Что нового",
    "A schematic editor and circuit simulator for tube, transistor and hybrid amplifiers, with instruments and a PCB editor. Everything runs in your browser.":
      "Редактор схем и симулятор ламповых, транзисторных и гибридных усилителей, с приборами и редактором плат. Всё работает в браузере.",
    "Models and data": "Модели и данные", "Software": "Программы", "Example circuits": "Примеры схем", "Online services": "Онлайн-сервисы",
    "Fonts and icons": "Шрифты и значки",
    "The app uses your device's system fonts. Its icons were drawn for it; nothing is fetched from elsewhere.":
      "Приложение использует системные шрифты устройства. Значки нарисованы для него; ничего не загружается со сторонних сайтов.",
    "Licence and disclaimer": "Лицензия и отказ от гарантий",
    "Tube Amp CAD is released under the MIT licence, as is, without warranty of any kind.":
      "Tube Amp CAD распространяется по лицензии MIT «как есть», без каких-либо гарантий.",
    "A simulation is an estimate, not a safety check. Tube amplifiers run at lethal voltages and keep them in their capacitors after switch-off: check your design against the datasheets, and build and measure with care.":
      "Моделирование даёт оценку, а не проверку безопасности. В ламповых усилителях смертельно опасные напряжения, и конденсаторы хранят их после выключения: сверяйте схему со справочными данными, собирайте и измеряйте осторожно.",
    "Show all credits": "Показать все благодарности",
  };
  // the source column: names and titles stay as written, these generic words are translated
  const GENERIC = { optional: "по желанию", datasheets: "справочные листки", standards: "стандарты", "device models": "модели приборов",
    "Thiele–Small parameters": "параметры Тиля–Смолла", "lab notes, 2017": "методичка, 2017", "fig. 1": "рис. 1" };
  Object.assign(T, GENERIC);
  for (const list of [SOFTWARE, MODELS, EXAMPLES, SERVICES]) for (const [, , en, ru] of list) T[en] = ru;
  if (root.I18N_RU) for (const [en, ru] of Object.entries(T)) if (!(en in root.I18N_RU.text)) root.I18N_RU.text[en] = ru;

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const link = (url, text, skip) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener"${skip ? " data-i18n-skip" : ""}>${esc(text)}</a>` : `<span${skip ? " data-i18n-skip" : ""}>${esc(text)}</span>`;
  const table = rows => `<table class="credits"><tbody>${rows.map(([name, url, en, , src]) =>
    `<tr><td>${link(url, name, true)}</td><td>${esc(en)}</td><td class="src"${src in GENERIC ? "" : " data-i18n-skip"}>${esc(src)}</td></tr>`).join("")}</tbody></table>`;

  /** The About content. version: "3.166.0" or "dev"; ru: the Russian blog post's link. */
  function html({ version = "", ru = false, manual = false } = {}) {
    const blog = ru ? "https://aerocat.tech/ru/posts/tube-amp-cad/" : "https://aerocat.tech/posts/tube-amp-cad/";
    const h = "h4";
    return `
<div class="about-head">
  <img src="favicon.png" width="56" height="56" alt="">
  <div>
    <div class="about-name"><span data-i18n-skip>Tube Amp CAD</span> <span class="about-ver" data-i18n-skip>${version && version !== "dev" ? "v" + esc(version) : esc(version)}</span></div>
    <div><span>Made by</span> <span data-i18n-skip>Andrey Dumchin · </span>${link("https://aerocat.tech/", "aerocat.tech", true)}</div>
    <div class="about-links">${link(blog, "Blog post")} · ${link(REPO, "Source on GitHub")} · ${link(REPO + "/blob/main/CHANGELOG.md", "What's new")}</div>
  </div>
</div>
<p>A schematic editor and circuit simulator for tube, transistor and hybrid amplifiers, with instruments and a PCB editor. Everything runs in your browser.</p>
<${h}>Models and data</${h}>
${table(MODELS)}
<${h}>Software</${h}>
${table(SOFTWARE)}
<details class="about-more"${manual ? " open" : ""}>
  <summary>Show all credits</summary>
  <${h}>Example circuits</${h}>
  ${table(EXAMPLES)}
  <${h}>Online services</${h}>
  ${table(SERVICES)}
  <${h}>Fonts and icons</${h}>
  <p>The app uses your device's system fonts. Its icons were drawn for it; nothing is fetched from elsewhere.</p>
</details>
<${h}>Licence and disclaimer</${h}>
<p>Tube Amp CAD is released under the MIT licence, as is, without warranty of any kind.</p>
<p class="about-warn">A simulation is an estimate, not a safety check. Tube amplifiers run at lethal voltages and keep them in their capacitors after switch-off: check your design against the datasheets, and build and measure with care.</p>`;
  }

  root.TubeAbout = { html, SOFTWARE, MODELS, EXAMPLES, SERVICES, T };
})(typeof window !== "undefined" ? window : globalThis);
