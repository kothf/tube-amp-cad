/* Interface language: English (the source) or Russian. The pages are written in English; in
   Russian every text and tooltip found in the dictionary (i18n-ru.js) is swapped in place, and
   whatever the scripts write later (menus, the inspector, the status line) is swapped as it
   appears, by a MutationObserver. Texts with numbers in them go by patterns. Whatever is not
   in the dictionary stays English; the drawing on the canvas is never translated.
   The choice is kept in this browser (localStorage) and every open window follows it. */
(function (root) {
  "use strict";
  const KEY = "tubecad_lang", ATTRS = ["title", "placeholder", "aria-label"];
  const get = () => { try { return localStorage.getItem(KEY) === "ru" ? "ru" : "en"; } catch (e) { return "en"; } };
  let lang = get(), observer = null, busy = false;
  const origText = new WeakMap(), origAttr = new WeakMap();

  // the Russian of one English text: the dictionary, else the patterns, else null
  function ru(text) {
    const D = root.I18N_RU; if (!D) return null;
    const key = text.replace(/\s+/g, " ").trim(); if (!key) return null;
    if (Object.prototype.hasOwnProperty.call(D.text, key)) return D.text[key];
    for (const [re, to] of D.patterns) { const m = key.match(re); if (m) return typeof to === "function" ? to(...m) : key.replace(re, to); }
    // a text made of pieces ("R1 · Resistor", "EL84 — Power Output Pentode"): each piece on its own
    for (const sep of [" · ", " — ", ": "]) {
      if (!key.includes(sep)) continue;
      let any = false;
      const out = key.split(sep).map(p => { const t = ru(p); if (t !== null) { any = true; return t; } return p; });
      if (any) return out.join(sep);
    }
    return null;
  }
  // the English of a Russian text the dictionary gave (exact entries only)
  let EN = null;
  function en(text) {
    const D = root.I18N_RU; if (!D) return null;
    if (!EN) { EN = new Map(); for (const [k, v] of Object.entries(D.text)) if (!EN.has(v)) EN.set(v, k); }
    return EN.get(String(text).replace(/\s+/g, " ").trim()) || null;
  }
  // a text with the spaces round it kept
  const keepSpace = (orig, t) => orig.match(/^\s*/)[0] + t + orig.match(/\s*$/)[0];

  function doText(n) {
    const p = n.parentNode; if (!p || /^(SCRIPT|STYLE|TEXTAREA|CODE|KBD)$/.test(p.nodeName) || p.closest && p.closest("[data-i18n-skip]")) return;
    const cur = n.nodeValue, had = origText.get(n);
    // the script changed it since: that is the new English
    const en = had && (cur === had.ru) ? had.en : cur;
    if (lang === "en") { if (had && cur === had.ru) n.nodeValue = had.en; origText.delete(n); return; }
    const t = ru(en); if (t === null) { origText.delete(n); return; }
    const out = keepSpace(en, t); origText.set(n, { en, ru: out }); if (cur !== out) n.nodeValue = out;
  }
  function doAttrs(el) {
    let saved = origAttr.get(el);
    for (const a of ATTRS) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a), had = saved && saved[a], en = had && cur === had.ru ? had.en : cur;
      if (lang === "en") { if (had && cur === had.ru) el.setAttribute(a, had.en); if (saved) delete saved[a]; continue; }
      const t = ru(en); if (t === null) { if (saved) delete saved[a]; continue; }
      if (!saved) origAttr.set(el, saved = {});
      saved[a] = { en, ru: t }; if (cur !== t) el.setAttribute(a, t);
    }
  }
  function walk(node) {
    if (node.nodeType === 3) { doText(node); return; }
    if (node.nodeType !== 1) return;
    doAttrs(node);
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeType === 3) doText(n); else doAttrs(n);
  }
  function apply() {
    busy = true;
    try { walk(document.body); if (document.title) { const t = lang === "ru" ? ru(document.title) : null; if (t) document.title = t; } }
    finally { busy = false; }
    document.documentElement.lang = lang;
    document.querySelectorAll("[data-lang]").forEach(b => { const on = b.dataset.lang === lang; b.setAttribute(b.getAttribute("role") === "menuitemradio" ? "aria-checked" : "aria-pressed", String(on)); b.classList.toggle("active", on); });
    // the one-button switch names the language it switches to
    document.querySelectorAll("[data-lang-toggle]").forEach(b => { b.textContent = lang === "ru" ? "EN" : "RU"; b.title = lang === "ru" ? "Interface in English" : "Интерфейс на русском"; });
  }
  function watch() {
    if (observer || !root.MutationObserver) return;
    observer = new MutationObserver(list => {
      if (busy || lang === "en") return;
      busy = true;
      try {
        for (const m of list) {
          if (m.type === "childList") m.addedNodes.forEach(walk);
          else if (m.type === "characterData") doText(m.target);
          else if (m.type === "attributes") doAttrs(m.target);
        }
      } finally { busy = false; }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function set(l) {
    lang = l === "ru" ? "ru" : "en";
    try { localStorage.setItem(KEY, lang); } catch (e) { /* private mode: this page only */ }
    apply();
  }
  // another window changed the language
  root.addEventListener("storage", e => { if (e.key === KEY && get() !== lang) { lang = get(); apply(); } });
  function start() {
    // the switch: any element with data-lang="en" / "ru", or data-lang-toggle (one button, flips)
    document.addEventListener("click", e => {
      const b = e.target.closest && e.target.closest("[data-lang], [data-lang-toggle]");
      if (b) set(b.hasAttribute("data-lang-toggle") ? (lang === "ru" ? "en" : "ru") : b.dataset.lang);
    });
    watch(); apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  root.I18n = { get lang() { return lang; }, set, ru, en, apply };
})(window);
