/* The help page (help.html, and its Russian translation help-ru.html): fills the parts reference,
   glossary and tube table from Hints, CadLib.LIB and TUBE_DATABASE, so the manual cannot drift from
   the app. On the Russian page the generated parts take their Russian from i18n-ru.js (names,
   labels) and i18n-hints-ru.js (the hint texts), as the app's own Russian interface does. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  // ---- language: the page's own (help.html English, help-ru.html Russian) ------------------
  const RU = document.documentElement.lang === "ru";
  const D = (RU && window.I18N_RU && window.I18N_RU.text) || {};
  const P = (RU && window.I18N_RU && window.I18N_RU.patterns) || [];
  // the Russian of an English text as i18n.js finds it: the dictionary, the patterns, then piece by piece
  const ru = t => {
    const key = String(t).replace(/\s+/g, " ").trim(); if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(D, key)) return D[key];
    for (const [re, to] of P) { const m = key.match(re); if (m) return typeof to === "function" ? to(...m) : key.replace(re, to); }
    for (const sep of [" · ", " — ", ": "]) {
      if (!key.includes(sep)) continue;
      let any = false;
      const out = key.split(sep).map(x => { const y = ru(x); if (y !== null) { any = true; return y; } return x; });
      if (any) return out.join(sep);
    }
    return null;
  };
  const tr = t => (RU && t ? ru(t) ?? t : t);
  // a readout's label: as shown, or as the Board's rules show it with a unit ("Via drill" ← "Via drill (mm)")
  let DK = null;
  const glossLabel = k => {
    if (!RU) return k;
    const t = ru(k); if (t !== null) return t;
    if (!DK) DK = Object.keys(D);
    const w = DK.find(x => x.startsWith(k + " (") && !x.slice(k.length + 2).includes("("));
    return w ? D[w].replace(/\s*\([^()]*\)$/, "") : k;
  };
  // an inspector label with its unit, as the Russian inspector shows it ("Resistance (Ω)" → "Сопротивление (Ом)")
  const labelHTML = (label, unit) => {
    const both = RU && unit ? ru(`${label} (${unit})`) : null;
    if (both) return esc(both);
    return esc(tr(label)) + (unit ? ` <span class="opts">${esc(unit)}</span>` : "");
  };
  const L10N = { "Choices:": "Варианты:", "Field": "Поле", "Meaning": "Значение", "Label": "Надпись", "Sort": "Сортировать",
    "The parts list could not be built here": "Список деталей здесь построить не удалось", "version ": "версия ", "development build": "сборка для разработки",
    "Nothing found": "Ничего не найдено", "triode": "триод", "pentode": "пентод", "rectifier": "кенотрон", "datasheet": "даташит",
    "Passive": "Пассивные", "Switches & relays": "Переключатели и реле", "Transformers": "Трансформаторы", "Sources": "Источники", "Ground & connectors": "Земля и разъёмы",
    "Tubes": "Лампы", "Semiconductors": "Полупроводники", "Integrated circuits": "Микросхемы", "Gas-discharge tubes": "Газоразрядные приборы", "Instruments": "Приборы", "Document": "Документ",
    "Tube operating point": "Рабочая точка лампы", "With signal": "С сигналом", "Circuit summary": "Сводка схемы", "Other parts": "Другие детали", "Ratings (curve tracer)": "Предельные значения (характериограф)",
    "Koren model coefficients": "Коэффициенты модели Корена", "Oscilloscope": "Осциллограф", "Spectrum analyzer": "Анализатор спектра", "Bode plotter": "АЧХ и ФЧХ", "Board rules": "Правила платы",
    "Tube": "Лампа", "Type": "Тип", "Kind": "Вид", "Socket": "Цоколь", "Heater": "Накал", "Capacitances pF": "Ёмкости пФ", "Source": "Источник" };
  const T = t => (RU && L10N[t]) || tr(t);
  // a hint in the page's language: Russian by the same keys as hints.js, line by line otherwise
  let HRU = null;
  const hint = t => {
    if (!RU || !t || !window.I18N_HINTS_RU) return t;
    if (!HRU) {
      HRU = new Map(); const H = window.Hints, R = window.I18N_HINTS_RU;
      for (const cat of ["parts", "fields", "labels"]) for (const [k, en] of Object.entries(H[cat] || {})) if (R[cat] && R[cat][k]) HRU.set(en, R[cat][k]);
      for (const [en, ru] of Object.entries(R.text || {})) HRU.set(en, ru);
    }
    return HRU.get(t) || String(t).split("\n").map(l => HRU.get(l) || tr(l)).join("\n");
  };
  const hintHTML = t => t ? t.split("\n").map(l => /^= /.test(l) ? `<code>${esc(l.slice(2))}</code>` : /^- /.test(l) ? `<p>• ${esc(l.slice(2))}</p>` : `<p>${esc(l)}</p>`).join("") : "";

  // ---- parts reference, from the part library and the hints ----------------
  try {
    const L = window.CadLib, H = window.Hints, host = $("parts-ref");
    const order = [["Passive", ["resistor", "pot", "capacitor", "electrolytic", "inductor", "speaker", "fuse", "ntc", "mov"]],
      ["Switches & relays", ["switch", "spst", "rotary", "relay", "vactrol"]],
      ["Transformers", ["opt_se", "opt_cat", "opt_pp", "ptx", "ptx_cat", "itx"]],
      ["Sources", ["vdc", "rail", "isrc", "siggen", "mains", "pickup", "phono", "vcvs", "vccs"]], ["Ground & connectors", ["ground", "offsheet", "jack", "iec", "terminal", "header", "faston"]],
      ["Tubes", ["tube"]], ["Semiconductors", ["diode", "bridge", "zener", "led", "npn", "pnp", "nmos", "pmos", "njf", "pjf"]],
      ["Integrated circuits", ["opamp", "chipamp", "timer555", "reg", "tl431"]], ["Gas-discharge tubes", ["gasreg", "neon", "eye"]], ["Instruments", ["scope"]], ["Document", ["frame", "note"]]];
    let h = "";
    order.forEach(([g, types]) => {
      h += `<h4>${esc(T(g))}</h4>`;
      types.forEach(t => {
        const d = L.LIB[t]; if (!d) return;
        const seen = new Set();
        const rows = (d.fields || []).filter(f => { if (f.kind === "heading") return false; if (seen.has(f.key)) return f.key !== "amp"; seen.add(f.key); return true; }).map(f => {
          const opts = Array.isArray(f.options) ? f.options.map(o => Array.isArray(o) ? o[1] : (o && (o.label || o.v)) || o).filter(x => typeof x === "string") : [];
          const unit = f.key === "amp" && t === "siggen" ? "Vpk · Vrms · dBV" : f.unit;
          const text = hint(H.field(t, f.key) || H.label(f.label) || "");
          return `<tr><td>${labelHTML(f.label, unit)}</td><td class="wrap hint-text">${hintHTML(text)}${opts.length ? `<span class="opts">${T("Choices:")} ${opts.map(o => esc(tr(o))).join(" · ")}</span>` : ""}</td></tr>`;
        }).join("");
        h += `<div class="part" id="part-${t}"><h3>${esc(tr(d.name))}<span class="tag">${t}</span></h3><p>${esc(hint(H.parts[t] || ""))}</p>${rows ? `<table><tr><th>${T("Field")}</th><th>${T("Meaning")}</th></tr>${rows}</table>` : ""}</div>`;
      });
    });
    host.innerHTML = h;
  } catch (e) { $("parts-ref").innerHTML = `<p class="warn">${T("The parts list could not be built here")} (${esc(e.message)}).</p>`; }

  // ---- glossary of readouts -------------------------------------------------
  try {
    const groups = [
      ["Tube operating point", ["Va (anode–cathode)", "Vg1k (bias)", "Vg2k (screen)", "Ia (anode current)", "Ig2 (screen current)", "Pa (dissipation)", "Pg2 (screen dissipation)", "Ik (cathode current)", "Vhk (cathode above heater)", "Vhk (heater above cathode)", "Grid circuit R (cathode bias)", "Grid circuit R (fixed bias)", "Rectified current", "Peak inverse voltage"]],
      ["With signal", ["Plate swing", "Grid swing", "Plate/grid gain", "THD at plate", "Average Pa"]],
      ["Circuit summary", ["Parts · wires · nets", "From DC supplies", "Output (speakers)", "Tubes (anode + screen)", "Transistors", "Op-amps", "Resistors"]],
      ["Other parts", ["Voltage", "Current (DC)", "Current supplied", "DC drop", "DC voltage across", "Dissipation", "Power (avg)", "Wiper DC", "Primary DC current", "Voltage (A–K)", "Current (A→K)", "hFE (Ic/Ib)", "Ib"]],
      ["Ratings (curve tracer)", ["Va max", "Pa max", "Pg2 max", "Vg2 max", "Ik max", "Vhk max", "Rg max", "Heater", "Pins"]],
      ["Koren model coefficients", ["µ", "µ (g1–g2)", "kg1", "kp", "kvb", "x", "kg2", "knee vk", "slope λ", "screen share ks", "gm", "rp"]],
      ["Oscilloscope", ["Analysis", "Duration", "Volts/div", "Coupling", "Time/div", "Trigger source", "Slope", "Scope part"]],
      ["Spectrum analyzer", ["Span", "Units", "Frequency axis", "Scale", "Input", "Harmonic", "Other components"]],
      ["Bode plotter", ["Traces", "Gain", "Range", "Phase", "Generator", "Response"]],
      ["Board rules", ["Signal and power", "High voltage", "HV above", "To the board edge", "Signal width", "Power / HV width", "Minimum width", "Via drill", "Via pad", "Minimum drill", "Minimum annular ring", "Opening around pads", "Copper", "Board thickness", "Class"]],
    ];
    const H = window.Hints;
    $("glossary").innerHTML = groups.map(([g, keys]) => `<h3>${esc(T(g))}</h3><table><tr><th>${T("Label")}</th><th>${T("Meaning")}</th></tr>${keys.filter(k => H.labels[k]).map(k => `<tr><td>${esc(glossLabel(k))}</td><td class="wrap hint-text">${hintHTML(hint(H.labels[k]))}</td></tr>`).join("")}</table>`).join("");
  } catch (e) {}

  // ---- tube table -------------------------------------------------------------
  try {
    const DB = window.TUBE_DATABASE || [], kindOf = t => T(/rectifier/i.test(t.type) ? "rectifier" : t.koren && (t.koren.Pentode || t.koren.pentode) ? "pentode" : "triode");
    const pf = v => v == null ? "" : (v * 1e12 < 10 ? (v * 1e12).toFixed(1) : Math.round(v * 1e12));
    const caps = t => { const c = t.caps; if (!c) return ""; const s = c.pentode ? [c.pentode.cin, c.pentode.cga, c.pentode.cout] : c.triode ? [c.triode.cgk, c.triode.cga, c.triode.cak] : null; return s ? (c.estimated ? "≈ " : "") + s.map(pf).join(" / ") : ""; };
    const lim = (t, k) => t.limits && t.limits[k] != null ? t.limits[k] : "";
    const rows = DB.map(t => ({ t, cells: [t.commonName, t.nameGost || "", tr(t.type || ""), kindOf(t), t.socket || "", t.vaMax || "", t.paMax || "", t.vg2Max || lim(t, "vg2") || "", lim(t, "pg2"), t.ikMax || "", [lim(t, "vhk"), lim(t, "vhkNeg")].filter(x => x !== "").join(" / "), t.vh && t.ih ? `${t.vh} V ${t.ih} A` : "", caps(t), (t.book && t.book.source) || (t.limits && t.limits.source) || T("datasheet")] }));
    const head = (RU ? ["Tube", "ГОСТ", "Type", "Kind", "Socket", "Va max В", "Pa max Вт", "Vg2 max В", "Pg2 max Вт", "Ik max мА", "Vhk max В", "Heater", "Capacitances pF", "Source"]
      : ["Tube", "ГОСТ", "Type", "Kind", "Socket", "Va max V", "Pa max W", "Vg2 max V", "Pg2 max W", "Ik max mA", "Vhk max V", "Heater", "Capacitances pF", "Source"]).map(T);
    let sortCol = 0, asc = true;
    const draw = () => {
      const q = ($("tube-q").value || "").trim().toLowerCase();
      const list = rows.filter(r => !q || r.cells.join(" ").toLowerCase().includes(q)).sort((a, b) => { const x = a.cells[sortCol], y = b.cells[sortCol]; const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return asc ? c : -c; });
      $("tube-table").innerHTML = `<tr>${head.map((h, i) => `<th data-c="${i}" style="cursor:pointer" title="${T("Sort")}">${h}${i === sortCol ? (asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>` + list.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
    };
    $("tube-table").addEventListener("click", e => { const th = e.target.closest("th"); if (!th) return; const c = +th.dataset.c; asc = c === sortCol ? !asc : true; sortCol = c; draw(); });
    $("tube-q").addEventListener("input", draw);
    draw();
  } catch (e) {}

  // ---- version --------------------------------------------------------------
  const m = /[?&]v=([^&]+)/.exec([...document.scripts].map(s => s.src).find(s => /hints\.js/.test(s)) || "");
  $("ver").textContent = m && m[1] !== "dev" ? T("version ") + m[1] : T("development build");
  if (window.TubeAbout) {
    const ab = $("about-body"); ab.innerHTML = TubeAbout.html({ version: m ? m[1] : "dev", manual: true, ru: RU });
    // on the Russian page: its texts through the dictionary (about.js adds its own Russian there); names stay
    if (RU) {
      const w = document.createTreeWalker(ab, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest("[data-i18n-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
      nodes.forEach(n => { const t = n.nodeValue.trim(); const r = t && ru(t); if (r) n.nodeValue = n.nodeValue.replace(t, r); });
    }
  }

  // ---- table of contents, scroll spy -----------------------------------------
  const heads = [...document.querySelectorAll("main h2, main h3")].filter(h => h.closest(".part") === null);
  heads.forEach((h, i) => { if (!h.id) h.id = "s-" + i; });
  $("toc-list").innerHTML = heads.map(h => `<li class="${h.tagName.toLowerCase()}"><a href="#${h.id}">${esc(h.textContent)}</a></li>`).join("");
  const links = [...$("toc-list").querySelectorAll("a")];
  const spy = () => { let cur = heads[0]; for (const h of heads) { if (h.getBoundingClientRect().top < 120) cur = h; else break; } links.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + cur.id)); };
  addEventListener("scroll", spy, { passive: true }); spy();
  $("toc-toggle").addEventListener("click", () => $("toc").classList.toggle("open"));

  // ---- search: hides the blocks that do not match, marks the words ----------
  const blocks = [...document.querySelectorAll("main > p, main > ul, main > ol, main > table, main > pre, main > div, main h4, .part, #glossary tr, #parts-ref h4")];
  const unmark = () => document.querySelectorAll("main mark").forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  const markIn = (el, re) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest("script, style, mark, #tube-table") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(n => { if (!re.test(n.textContent)) return; re.lastIndex = 0; const span = document.createElement("span"); span.innerHTML = esc(n.textContent).replace(re, m => `<mark>${m}</mark>`); n.replaceWith(...span.childNodes); });
  };
  let tmr = 0;
  $("q").addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(search, 150); });
  function search() {
    const q = $("q").value.trim(); unmark(); document.body.normalize();
    document.querySelectorAll(".hidden-by-search").forEach(e => e.classList.remove("hidden-by-search"));
    if (q.length < 2) { $("q-count").textContent = ""; document.querySelectorAll("#toc-list li").forEach(li => li.classList.remove("hide")); return; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    let n = 0;
    blocks.forEach(b => { const t = b.textContent.toLowerCase(); const hit = words.every(w => t.includes(w)); if (!hit && !b.contains(document.getElementById("tube-q"))) b.classList.add("hidden-by-search"); else if (hit) { n++; markIn(b, re); } });
    // headings stay visible only where something under them matched
    heads.forEach(h => { let el = h.nextElementSibling, any = false; while (el && !/^H[23]$/.test(el.tagName)) { if (!el.classList.contains("hidden-by-search") && el.querySelector && (el.tagName === "MARK" || el.querySelector("mark"))) any = true; el = el.nextElementSibling; } h.classList.toggle("hidden-by-search", !any && !words.every(w => h.textContent.toLowerCase().includes(w))); });
    // a glossary table keeps its header row only when a row under it matched
    document.querySelectorAll("#glossary table").forEach(t => { const hit = t.querySelector("mark"); t.classList.toggle("hidden-by-search", !hit); });
    document.querySelectorAll("#toc-list li").forEach((li, i) => li.classList.toggle("hide", heads[i].classList.contains("hidden-by-search")));
    $("q-count").textContent = n ? (RU ? `Найдено: ${n}` : `${n} match${n === 1 ? "" : "es"}`) : T("Nothing found");
    const first = document.querySelector("main mark"); if (first) first.scrollIntoView({ block: "center" });
  }
  addEventListener("keydown", e => { if (e.key === "/" && document.activeElement !== $("q") && document.activeElement !== $("tube-q")) { e.preventDefault(); $("q").focus(); } if (e.key === "Escape" && document.activeElement === $("q")) { $("q").value = ""; search(); } });
  // ---- language: the button at the top flips the interface's language and opens this manual in it;
  // the other windows' RU / EN buttons bring the manual along (storage event) -------------------
  const other = () => (RU ? "help.html" : "help-ru.html") + location.search + location.hash;
  const sw = $("lang-switch");
  if (sw) sw.addEventListener("click", () => { try { localStorage.setItem("tubecad_lang", RU ? "en" : "ru"); } catch (e) { /* private mode: this page only */ } location.replace(other()); });
  addEventListener("storage", e => { if (e.key === "tubecad_lang" && (e.newValue === "ru") !== RU && (e.newValue === "ru" || e.newValue === "en")) location.replace(other()); });
  // open at ?q=… or #section
  const qp = new URLSearchParams(location.search).get("q"); if (qp) { $("q").value = qp; search(); }
})();
