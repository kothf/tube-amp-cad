/* The parts panel on the left of the CAD (the palette): one search box, Favorites and Recent at
   the top, then the library by group, each part a compact row with a small picture of its real
   schematic symbol, its name and its value. Pointing at a part (or moving to it with the arrow
   keys) shows it in the preview card at the bottom: the symbol drawn large, what the part is
   and how to place it. A part is placed by clicking it and then the sheet, by dragging it onto
   the sheet, or by Enter from the search box. Right-click a part (or ☆ in the preview) to add it
   to Favorites. The layout follows the part choosers of KiCad (search over a tree, recently
   used at the top, symbol preview under it) and Altium's Components panel (categories with
   icons, a details pane with the symbol, drag to place, favorites).

   Which groups are folded, Favorites, Recent, all tubes or the popular ones, and whether the
   preview is open are kept per browser in localStorage (tubecad_palette). */
(function (root) {
  "use strict";
  const KEY = "tubecad_palette", RECENT_MAX = 8, FAV_MAX = 40, DRAG_TYPE = "application/x-tubecad-part";
  const GROUP_ICON = {
    Favorites: "star", Recent: "history", Passive: "pal-passive", "Switches & relays": "pal-switch", Transformers: "pal-transformer",
    Sources: "pal-source", "Ground & connectors": "pal-ground", Semiconductors: "pal-semi", "Integrated circuits": "chip",
    "Gas-discharge tubes": "pal-neon", Instruments: "scope", Document: "netlist", Tubes: "pal-tube", Value: "pal-passive"
  };
  const HOW = "Click, then click on the sheet to place (Shift-click places several).";
  const HOW_MORE = "Or drag it onto the sheet.";

  function CadPalette(o) {
    // o: { host, thumb(type, params, w, h) → data URL or "", pick(entry, el), dropAt(entry, event) }
    const { LIB, PALETTE, fmtEng, parseEng, tubeKind } = root.CadLib;
    const L = root.CadLib, TUBES = () => root.TUBE_DATABASE || [];
    const st = { closed: { Transformers: true, Semiconductors: true, Instruments: true, Document: true, Tubes: true }, allTubes: false, fav: [], recent: [], preview: true };
    try { Object.assign(st, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) { /* a private window: defaults */ }
    if (!Array.isArray(st.fav)) st.fav = [];
    if (!Array.isArray(st.recent)) st.recent = [];
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* storage off: it stays for this visit */ } };
    const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const ico = n => (root.Icons ? root.Icons.svg(n) : "");
    const ru = () => !!(root.I18n && root.I18n.lang === "ru");

    // ---------------------------------------------------------------------------------------
    // entries: { g (group), sub, label, value, type, params, desc, tube (a tube's name), find (search text) }
    const keyOf = e => e.type + "|" + JSON.stringify(e.params || {});
    const tubeDesc = t => `${t.type}. ${t.nameWestern} · ${t.nameGost}\nVa max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A`;
    const tubeEntry = (t, g) => ({ g: g || "Tubes", label: t.commonName, value: t.type.replace(/ (Triode|Pentode|Tetrode|Rectifier)$/, ""), type: "tube", params: { tube: t.commonName }, tube: t.commonName, desc: tubeDesc(t), find: `${t.commonName} ${t.nameGost} ${t.nameWestern} ${t.type}` });
    function libEntry(g, sub, it) {
      const [type, params, label] = it, def = LIB[type], p = Object.assign({}, def.defaults, params || {});
      return { g, sub, label: label || def.name, value: def.value({ params: p }), type, params: params || null };
    }
    // the groups as the library lays them out
    function groups() {
      return PALETTE.map(g => {
        let sub = null; const items = [];
        g.items.forEach(it => { if (it.sub) { sub = it.sub; items.push({ head: sub }); } else items.push(libEntry(g.group, sub, it)); });
        return { title: g.group, items };
      });
    }
    // everything the search finds: the groups' parts (not the catalog ones: they have their own entry) and every catalog part and tube
    function searchables() {
      const out = [], X = (g, label, value, type, params, find) => out.push({ g, label, value, type, params, find });
      PALETTE.forEach(g => g.items.forEach(it => {
        if (it.sub) return;
        if (it[1] && (L.BJTS[it[1].model] || L.MOSFETS[it[1].model] || L.JFETS[it[1].model] || L.REGS[it[1].model])) return;
        const e = libEntry(g.group, null, it); e.find = `${it[2] || ""} ${LIB[it[0]].name} ${e.value} ${it[0]}`; out.push(e);
      }));
      Object.entries(L.BJTS).forEach(([k, m]) => X("Semiconductors", `${m.pol > 0 ? "NPN" : "PNP"} · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "npn" : "pnp", { model: k }, `${k} transistor bjt ${m.pol > 0 ? "npn" : "pnp"} ${m.ge ? "germanium" : "silicon"} ${m.use}`));
      Object.entries(L.MOSFETS).forEach(([k, m]) => X("Semiconductors", `${m.pol > 0 ? "N" : "P"}-MOSFET · ${k}`, `${m.v} V ${m.p} W`, m.pol > 0 ? "nmos" : "pmos", { model: k }, `${k} mosfet fet ${m.use}`));
      Object.entries(L.JFETS).forEach(([k, m]) => X("Semiconductors", `${m.pol > 0 ? "N" : "P"}-JFET · ${k}`, `${fmtEng(m.beta * m.vto * m.vto, "A", 2)} IDSS`, m.pol > 0 ? "njf" : "pjf", { model: k }, `${k} jfet fet junction ${m.use}`));
      Object.entries(L.REGS).forEach(([k, m]) => X("Integrated circuits", `Regulator · ${k}`, m.use, "reg", { model: k }, `${k} regulator voltage ${m.adj ? "adjustable" : "fixed"} ${m.pol > 0 ? "positive" : "negative"} ${m.use} lm${k} ${m.pkg}`));
      Object.entries(L.SHUNTS).forEach(([k, m]) => X("Integrated circuits", `Shunt reference · ${k}`, m.use, "tl431", { model: k }, `${k} shunt reference regulator programmable zener ${m.use}`));
      Object.entries(L.ZENERS).forEach(([k, z]) => X("Semiconductors", `Zener · ${k}`, `${z.bv} V ${z.p} W`, "zener", { model: k }, `${k} zener ${z.bv}v`));
      Object.keys(L.LEDS).forEach(k => X("Semiconductors", `LED · ${k}`, `${L.LEDS[k].vf} V`, "led", { color: k }, `led ${k}`));
      Object.entries(L.DIODES).forEach(([k, d]) => X("Semiconductors", `Diode · ${k}`, d.use, "diode", { model: k }, `${k} diode ${d.kind} ${d.use}`));
      Object.entries(L.BRIDGES).forEach(([k, b]) => X("Semiconductors", `Bridge rectifier · ${k}`, b.use, "bridge", { model: k }, `${k} bridge rectifier ${b.use}`));
      Object.entries(L.NTCS).forEach(([k, m]) => X("Passive", `Inrush limiter · ${k}`, m.use, "ntc", { model: k }, `${k} ntc thermistor inrush current limiter soft start ${m.use}`));
      Object.entries(L.MOVS).forEach(([k, m]) => X("Passive", `Varistor · ${k}`, m.use, "mov", { model: k }, `${k} mov varistor surge protection ${m.use}`));
      Object.entries(L.GASREGS).forEach(([k, m]) => X("Gas-discharge tubes", `Voltage regulator · ${k}`, m.use, "gasreg", { model: k }, `${k} ${k.replace("0", "o")} vr gas regulator glow discharge stabilizer ${m.use}`));
      L.SPEAKER_PRESETS.forEach(p => X("Passive", p.name, `${p.r} Ω, fs ${p.fs} Hz`, "speaker", { model: "ts", r: p.r, re: p.re, le: p.le, fs: p.fs, qms: p.qms, qes: p.qes }, `${p.name} ${p.id.startsWith("hp") ? "headphones headphone phones earphones" : "speaker loudspeaker driver"}`));
      Object.entries(L.CHIPAMPS).forEach(([k, m]) => X("Integrated circuits", `Power amplifier · ${k}`, m.use, "chipamp", { model: k }, `${k} power amplifier chip amp gainclone ic ${m.pkg} ${m.use}`));
      Object.entries(L.NEONS).forEach(([k, m]) => X("Gas-discharge tubes", `Neon lamp · ${k}`, m.use, "neon", { model: k }, `${k} neon lamp glow indicator pilot light ne2 ${m.use}`));
      Object.entries(L.EYES).forEach(([k, m]) => X("Gas-discharge tubes", `Magic eye · ${k}`, m.use, "eye", { model: k }, `${k} magic eye tuning indicator electron ray cat's eye level meter ${m.use}`));
      Object.entries(L.RELAYS).forEach(([k, m]) => X("Switches & relays", `Relay · ${k}`, m.use, "relay", { model: k }, `${k} relay omron ${m.poles > 1 ? "dpdt" : "spdt"} coil ${m.use} mute standby channel`));
      Object.entries(L.VACTROLS).forEach(([k, m]) => X("Switches & relays", `Vactrol · ${k}`, m.use, "vactrol", { model: k }, `${k} vactrol optocoupler opto ldr photoresistor led cds ${m.use}`));
      L.PICKUPS.forEach(p => X("Sources", `Guitar pickup · ${p.name}`, `${fmtEng(p.l, "H")} ${fmtEng(p.r, "Ω")}`, "pickup", { preset: p.id, r: p.r, l: p.l, c: p.c, amp: p.amp }, `${p.name} guitar pickup bass single coil humbucker source`));
      L.CARTRIDGES.forEach(p => X("Sources", `Phono cartridge · ${p.name}`, fmtEng(p.mv, "V"), "phono", { preset: p.id, mv: p.mv, r: p.r, l: p.l }, `${p.name} phono cartridge turntable record riaa mm mc vinyl source`));
      L.ITX_PRESETS.forEach(p => X("Transformers", p.name, "", "itx", Object.assign({ preset: p.id }, ...["ratio", "lp", "dcrp", "dcrs", "llk", "cs", "idc", "ct"].map(k => ({ [k]: p[k] }))), `${p.name} transformer interstage input step-up`));
      Object.entries(L.XTS).forEach(([k, m]) => X("Ground & connectors", `Power connector · ${k}`, m.use, "xt", { model: k }, `${k} ${m.s} amass xt power connector drone rc lipo battery esc charger ${m.g === "M" ? "male plug" : "female socket"} ${m.use}${m.spark ? " anti-spark antispark" : ""}`));
      Object.entries(L.JACKS).forEach(([k, j]) => X("Ground & connectors", `Jack · ${j.use}`, k, "jack", { kind: k }, `jack socket input output ${k} ${j.use} phone headphone`));
      Object.entries(L.OUTPUT_TX).forEach(([k, m]) => X("Transformers", `Output · ${m.name}`, `${m.w} W ${m.ma} mA`, "opt_cat", { model: k }, `${k} ${m.name} output transformer single-ended`));
      Object.entries(L.OPT_SE).forEach(([k, m]) => X("Transformers", `Output · ${m.name}`, `SE ${fmtEng(m.p.zp, "Ω")} ${m.w} W ${m.ma} mA`, "opt_se", Object.assign({ model: k }, m.p), `${k} ${m.name} output transformer single-ended ${m.maker}`));
      Object.entries(L.OPT_PP).forEach(([k, m]) => X("Transformers", `Output · ${m.name}`, `PP ${fmtEng(m.p.zaa, "Ω")} ${m.w} W`, "opt_pp", Object.assign({ model: k }, m.p), `${k} ${m.name} output transformer push-pull ultralinear ${m.maker}`));
      Object.entries(L.POWER_TX).forEach(([k, m]) => X("Transformers", `Power · ${m.name}`, m.rated, "ptx_cat", { model: k }, `${k} ${m.name} power transformer ${m.rated}`));
      TUBES().forEach(t => out.push(tubeEntry(t)));
      return out;
    }
    // a typed value becomes the part it describes: 47k → resistor, 100n / 100nF → capacitor, 47u → electrolytic, 5H → choke
    function valueHits(q) {
      const m = /^([\d.,]+\s*(?:meg|[pnuµmkKMG])?)\s*(Ω|ohm|r|f|h|v)?$/i.exec(q.trim()); if (!m) return [];
      const v = parseEng(m[1].replace(/\s+/g, "")); if (!(v > 0)) return [];
      const u = (m[2] || "").toLowerCase(), out = [], X = (label, value, type, params) => out.push({ g: "Value", label, value, type, params });
      if (u === "f" || (!u && /[pnuµ]$/i.test(m[1]))) { X("Capacitor", fmtEng(v, "F"), "capacitor", { c: v }); if (v >= 1e-6) X("Electrolytic cap", fmtEng(v, "F"), "electrolytic", { c: v }); }
      else if (u === "h") X("Inductor / choke", fmtEng(v, "H"), "inductor", { l: v });
      else if (u === "v") X("DC supply", fmtEng(v, "V"), "vdc", { v });
      else { X("Resistor", fmtEng(v, "Ω"), "resistor", { r: v }); X("Potentiometer", fmtEng(v, "Ω"), "pot", { r: v }); }
      return out;
    }
    // what a part is: a tube's data, else the part's hint (hints.js)
    function describe(e) {
      if (e.desc) return e.desc;
      if (e.tube) { const t = TUBES().find(x => x.commonName === e.tube); return t ? tubeDesc(t) : ""; }
      return (root.Hints && root.Hints.parts[e.type]) || "";
    }
    // the stored form of an entry (Favorites, Recent)
    const slim = e => ({ g: e.g, label: e.label, value: e.value || "", type: e.type, params: e.params || null, tube: e.tube });
    const valid = e => e && LIB[e.type] && (!e.tube || TUBES().some(t => t.commonName === e.tube));
    const isFav = e => st.fav.some(f => keyOf(f) === keyOf(e));
    function toggleFav(e) {
      const k = keyOf(e);
      if (isFav(e)) st.fav = st.fav.filter(f => keyOf(f) !== k); else st.fav = [slim(e)].concat(st.fav).slice(0, FAV_MAX);
      save(); render(); show(e);
    }
    function remember(e) {
      const k = keyOf(e);
      st.recent = [slim(e)].concat(st.recent.filter(r => keyOf(r) !== k)).slice(0, RECENT_MAX);
      save();
    }

    // ---------------------------------------------------------------------------------------
    // the panel: search bar, the list, the preview card
    const host = o.host;
    host.innerHTML = "";
    host.classList.add("pal-v2");
    const bar = document.createElement("div"); bar.className = "pal-bar";
    bar.innerHTML = `<label class="pal-find">${ico("search")}<input type="search" class="pal-search" id="pal-search" placeholder="Search parts, 2N3904, EL84, 47k…" aria-label="Search parts" autocomplete="off" spellcheck="false"></label>`
      + `<button type="button" class="pal-tool" id="pal-fold" title="Fold all groups" aria-label="Fold all groups">${ico("fold")}</button>`;
    const list = document.createElement("div"); list.className = "pal-list";
    const card = document.createElement("section"); card.className = "pal-preview"; card.id = "pal-preview"; card.setAttribute("aria-live", "polite");
    host.append(bar, list, card);
    const search = bar.querySelector("input");

    // one row: the symbol's picture, the name, the value
    function row(e, ctx) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pal-item" + (e.tube ? " tube" : ""); b.draggable = true;
      const src = o.thumb(e.type, e.params, 34, 22);
      const words = ctx && ctx.words;
      let name = esc(e.label);
      // the typed words marked in the name (English only: a split name could no longer be translated)
      if (words && words.length && !ru()) {
        const re = new RegExp("(" + words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "ig");
        name = esc(e.label).replace(re, "<mark>$1</mark>");
      }
      b.innerHTML = `<img class="pal-thumb" alt="" src="${src}" draggable="false"><span>${name}</span>${e.value ? `<em>${esc(e.value)}</em>` : ""}`;
      b._entry = e;
      b.addEventListener("click", () => { remember(e); o.pick(e, b); });
      b.addEventListener("contextmenu", ev => { ev.preventDefault(); toggleFav(e); });
      b.addEventListener("mouseenter", () => show(e));
      b.addEventListener("focus", () => show(e));
      b.addEventListener("dragstart", ev => {
        ev.dataTransfer.effectAllowed = "copy";
        ev.dataTransfer.setData(DRAG_TYPE, keyOf(e)); ev.dataTransfer.setData("text/plain", e.label);
        const img = b.querySelector("img"); if (img && img.complete) ev.dataTransfer.setDragImage(img, 17, 11);
        dragging = e; remember(e); o.pick(e, b, true);
      });
      b.addEventListener("dragend", ev => { if (dragging && o.dragEnd) o.dragEnd(ev.dataTransfer.dropEffect !== "none"); dragging = null; });
      return b;
    }
    let dragging = null;
    function head(title, count, foldable) {
      const h = document.createElement("button");
      h.type = "button"; h.className = "pal-group" + (foldable && st.closed[title] ? " closed" : "");
      h.innerHTML = `${ico(GROUP_ICON[title] || "chip")}<span class="pal-gt">${esc(title)}</span>${count ? `<small>${count}</small>` : ""}${foldable ? `<span class="chev" aria-hidden="true"></span>` : ""}`;
      h.dataset.group = title;
      if (foldable) h.setAttribute("aria-expanded", String(!st.closed[title])); else h.disabled = true;
      return h;
    }
    function section(title, count, foldable) {
      const h = head(title, count, foldable);
      const box = document.createElement("div"); box.className = "pal-box"; box.hidden = foldable && !!st.closed[title];
      if (foldable) h.addEventListener("click", () => { st.closed[title] = !st.closed[title]; save(); h.classList.toggle("closed"); box.hidden = !!st.closed[title]; h.setAttribute("aria-expanded", String(!box.hidden)); });
      list.append(h, box);
      return box;
    }
    const subHead = (box, text) => { const h = document.createElement("div"); h.className = "pal-sub"; h.textContent = text; box.appendChild(h); };

    function browse() {
      list.innerHTML = "";
      const fav = st.fav.filter(valid), rec = st.recent.filter(valid);
      if (fav.length) { const box = section("Favorites", fav.length, true); fav.forEach(e => box.appendChild(row(e))); }
      if (rec.length) { const box = section("Recent", 0, true); rec.forEach(e => box.appendChild(row(e))); }
      groups().forEach(g => {
        const n = g.items.filter(i => !i.head).length, box = section(g.title, n, true);
        g.items.forEach(it => { if (it.head) subHead(box, it.head); else box.appendChild(row(it)); });
      });
      // tubes: the popular ones, or all of them by kind
      const all = TUBES(), box = section("Tubes", all.length, true);
      if (st.allTubes) {
        [["triode", "Triodes"], ["pentode", "Pentodes & beam tetrodes"], ["rectifier", "Rectifiers"]].forEach(([kind, title]) => {
          subHead(box, title); all.filter(t => tubeKind(t) === kind).forEach(t => box.appendChild(row(tubeEntry(t))));
        });
      } else all.filter(t => t.isFavorite).forEach(t => box.appendChild(row(tubeEntry(t))));
      const more = document.createElement("button"); more.type = "button"; more.className = "pal-more";
      more.textContent = st.allTubes ? "Show popular tubes only" : `Show all ${all.length} tubes`;
      more.addEventListener("click", () => { st.allTubes = !st.allTubes; save(); render(); });
      box.appendChild(more);
    }
    let index = null;
    function find(q) {
      list.innerHTML = "";
      if (!index) index = searchables();
      const words = q.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = valueHits(q).concat(index.filter(e => words.every(w => e.find.toLowerCase().includes(w))));
      if (!hits.length) { list.innerHTML = `<p class="pal-none">Nothing found for “${esc(q)}”.</p>`; return; }
      let last = null, box = null;
      hits.slice(0, 80).forEach(e => {
        if (e.g !== last) { box = section(e.g, 0, false); last = e.g; }
        box.appendChild(row(e, { words }));
      });
      if (hits.length > 80) { const p = document.createElement("p"); p.className = "pal-none"; p.textContent = `First 80 of ${hits.length}: type more to narrow it down.`; list.appendChild(p); }
    }
    function render() {
      const q = search.value.trim();
      cursor = null;
      if (q) find(q); else browse();
    }

    // ---------------------------------------------------------------------------------------
    // the preview card: the symbol drawn large, the name, the value, what it is, how to place it
    let shown = null;
    function show(e) {
      shown = e || null;
      card.classList.toggle("folded", !st.preview);
      const top = `<button type="button" class="pal-ptoggle" aria-expanded="${st.preview}" title="${st.preview ? "Hide the preview" : "Show the preview"}"><span class="chev" aria-hidden="true"></span>Preview</button>`;
      if (!st.preview) { card.innerHTML = top; return; }
      if (!e) { card.innerHTML = top + `<p class="pal-pempty">Point at a part to see its symbol here.</p>`; return; }
      const fav = isFav(e), desc = describe(e).split("\n").map(l => l.trim()).filter(Boolean), r = ru();
      const lines = (r && root.Hints ? root.Hints.inLang(desc.join("\n")).split("\n") : desc);
      card.innerHTML = top
        + `<div class="pal-pbox"><img alt="" src="${o.thumb(e.type, e.params, 200, 80, true)}"></div>`
        + `<div class="pal-pname"><b>${esc(e.label)}</b>${e.value ? `<em>${esc(e.value)}</em>` : ""}<button type="button" class="pal-fav${fav ? " on" : ""}" aria-pressed="${fav}" title="${fav ? "Remove from Favorites" : "Add to Favorites (or right-click the part)"}" aria-label="Favorite">${ico("star")}</button></div>`
        + `<div class="pal-pdesc" data-i18n-skip>${lines.map(l => `<p>${esc(l)}</p>`).join("")}</div>`
        + `<p class="pal-phow"><span>${esc(HOW)}</span> <span>${esc(HOW_MORE)}</span></p>`;
      card.querySelector(".pal-fav").addEventListener("click", () => toggleFav(e));
    }
    card.addEventListener("click", ev => {
      if (!ev.target.closest(".pal-ptoggle")) return;
      st.preview = !st.preview; save(); show(shown);
    });
    list.addEventListener("mouseleave", () => { if (cursor) show(cursor._entry); });

    // ---------------------------------------------------------------------------------------
    // keyboard: ↓ / ↑ walk the parts from the search box, Enter places the one marked (or the first)
    let cursor = null;
    const items = () => [...list.querySelectorAll(".pal-item")].filter(el => el.offsetParent !== null);
    function move(d) {
      const all = items(); if (!all.length) return;
      let i = all.indexOf(cursor); i = i < 0 ? (d > 0 ? 0 : all.length - 1) : Math.max(0, Math.min(all.length - 1, i + d));
      if (cursor) cursor.classList.remove("kb");
      cursor = all[i]; cursor.classList.add("kb"); cursor.scrollIntoView({ block: "nearest" });
      show(cursor._entry);
    }
    search.addEventListener("input", render);
    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
      else if (e.key === "Enter") { const el = cursor && cursor.isConnected ? cursor : list.querySelector(".pal-item"); if (el) el.click(); }
      else if (e.key === "Escape") { search.value = ""; render(); search.blur(); }
    });
    bar.querySelector("#pal-fold").addEventListener("click", () => {
      if (search.value) { search.value = ""; }
      const titles = ["Favorites", "Recent", ...PALETTE.map(g => g.group), "Tubes"], anyOpen = titles.some(t => !st.closed[t]);
      titles.forEach(t => { st.closed[t] = anyOpen; });
      save(); render();
    });

    render(); show(null);
    return {
      rebuild() { index = null; render(); show(shown); },
      focus() { search.focus(); search.select(); },
      state: st, keyOf, entryOf: k => (index || (index = searchables())).concat(st.fav, st.recent).find(e => keyOf(e) === k),
      dragging: () => dragging, DRAG_TYPE
    };
  }
  root.CadPalette = CadPalette;
})(typeof window !== "undefined" ? window : globalThis);
