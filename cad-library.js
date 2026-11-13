/* =============================================================================
   The user's parts library — the CAD's side (part-lib.js is the data).
   The library lives in this browser (IndexedDB) and travels as a file; the parts panel lists it
   as "My library", and a part placed from it carries its drawing, footprint and model with it.
   The dialog (the panel's Parts library… button): add symbols from KiCad's .kicad_sym files and
   footprints from .kicad_mod files, give a part its designator letter, footprint and SPICE
   model, save the library as a file or open one.
   Depends on: part-lib.js, kicad-import.js, spice-part.js (the Model… dialog), cad-symedit.js (the drawing)
   ============================================================================= */
(function (root) {
  "use strict";
  const DB = "tubecad-library", STORE = "lib", KEY = "main";
  const esc = t => String(t === undefined || t === null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

  function CadLibrary(o) {
    // o: { thumb(type, params, w, h, big), setStatus(kind, text), changed() (the panel is drawn again), place(params) }
    const P = root.PartLib;
    let lib = P.empty(), dbp = null, sel = null, offer = null, find = "";
    const $ = id => document.getElementById(id);

    // ---- storage: one record, the whole library ----
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        if (!root.indexedDB) { rej(new Error("no IndexedDB")); return; }
        const r = root.indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const d = await db();
      return new Promise((res, rej) => { const t = d.transaction(STORE, mode), r = fn(t.objectStore(STORE)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    }
    let kept = true;
    async function save() {
      try { await tx("readwrite", st => st.put(JSON.parse(P.toFile(lib)), KEY)); kept = true; }
      catch (e) { if (kept) o.setStatus("warn", "This browser would not store the parts library: it stays until the page is closed. Save it as a file."); kept = false; }
    }
    const ready = (async () => { try { const d = await tx("readonly", st => st.get(KEY)); if (d) lib = P.check(d); } catch (e) { /* no storage, or nothing kept yet */ } o.changed(); })();
    function changed() { o.changed(); return save(); }

    // ---- what the parts panel shows ----
    const paramsOf = (part, unit) => P.params(lib, part, unit || 1);
    function entries() {
      return lib.parts.map(p => {
        let cache = null;
        return { g: "My library", label: p.name, value: p.fp ? "" : "no footprint", type: "part", lib: p.id, desc: [p.desc, p.fp ? `Footprint ${p.fp}` : "No footprint yet", p.spice ? `SPICE model ${p.spice.sub}` : "", p.units.length > 1 ? `${p.units.length} units in the package` : ""].filter(Boolean).join("\n"),
          find: `${p.name} ${p.desc} ${p.keywords} library`, get params() { return cache || (cache = paramsOf(p)); } };
      });
    }

    // ---- adding ----
    /** files: [{ name, text }] of .kicad_sym, .kicad_mod, or a library file of this app. Symbol libraries are
        offered for picking (returned as { offer }), footprints and library files are added at once. */
    function read(files) {
      const fps = {}, syms = [], notes = []; let whole = null;
      files.forEach(f => {
        try {
          if (/\.kicad_mod$/i.test(f.name)) { const d = P.footprint(f.text, f.name); fps[d.name] = d; }
          else if (/\.kicad_sym$/i.test(f.name)) P.symbols(f.text, f.name).forEach(s => syms.push(s));
          else { const l = P.fromFile(f.text); whole = whole || P.empty(); P.add(whole, l.parts, l.footprints); }
        } catch (e) { notes.push(`${f.name}: ${e.message}`); }
      });
      return { fps, syms, whole, notes };
    }
    function addFiles(files, pickAll) {
      const r = read(files), n = { parts: 0, footprints: 0 };
      if (r.whole) { const a = P.add(lib, r.whole.parts, r.whole.footprints); n.parts += a.parts; n.footprints += a.footprints; }
      if (Object.keys(r.fps).length) n.footprints += P.add(lib, [], r.fps).footprints;
      if (r.syms.length && (pickAll || r.syms.length === 1)) { n.parts += P.add(lib, r.syms.map(s => s.read()), {}).parts; r.syms.length = 0; }
      offer = r.syms.length ? { syms: r.syms, ticked: new Set(), find: "" } : null;
      const said = [n.parts ? `${n.parts} part${n.parts === 1 ? "" : "s"}` : "", n.footprints ? `${n.footprints} footprint${n.footprints === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
      if (said) { o.setStatus("ok", `Parts library: ${said} added.`); changed(); }
      if (r.notes.length) o.setStatus("warn", `Parts library: ${r.notes.join("; ")}`);
      return Object.assign(n, { offered: r.syms.length, notes: r.notes });
    }
    function takeOffered(names) {
      if (!offer) return 0;
      const take = offer.syms.filter(s => names.has(s.name)), a = P.add(lib, take.map(s => s.read()), {});
      offer = null;
      if (take.length) { sel = (lib.parts.find(p => p.name === take[0].name) || {}).id || sel; o.setStatus("ok", `Parts library: ${a.parts} part${a.parts === 1 ? "" : "s"} added.`); changed(); }
      return a.parts;
    }

    // ---- the dialog ----
    function build() {
      const m = document.createElement("div"); m.className = "modal"; m.id = "plib-modal"; m.hidden = true;
      m.innerHTML = `<div class="modal-box plib">
        <div class="insp-title">Parts library</div>
        <p class="insp-help">Your own parts, kept in this browser: each is a drawing with pins, a footprint and, if you give it one, a SPICE model. Add symbols from KiCad's symbol libraries (<code>.kicad_sym</code>) and footprints from its footprint files (<code>.kicad_mod</code>; select all the files of a <code>.pretty</code> folder at once). A part placed on the sheet takes a copy of everything, so the circuit opens anywhere.</p>
        <div class="plib-bar">
          <button class="btn active" id="plib-add" title="KiCad symbol libraries (.kicad_sym) and footprints (.kicad_mod), several at once">Add from KiCad files…</button>
          <button class="btn" id="plib-new" title="A part you draw yourself: a box with its pins to start with, then lines, circles, text and pins">New part…</button>
          <button class="btn" id="plib-open" title="Add the parts of a library file saved here or by somebody else">Open a library file…</button>
          <button class="btn" id="plib-save" title="All the parts and footprints as one file, to keep or to pass on">Save as a file</button>
          <input type="file" id="plib-file" multiple accept=".kicad_sym,.kicad_mod,.json,.tubelib" hidden>
          <span class="insp-help" id="plib-count"></span>
        </div>
        <div id="plib-body"></div>
        <div class="modal-actions"><button class="btn" id="plib-close">Close</button></div>
      </div>`;
      document.body.appendChild(m);
      $("plib-close").onclick = close;
      m.addEventListener("mousedown", e => { if (e.target === m) close(); });
      $("plib-add").onclick = () => { $("plib-file").accept = ".kicad_sym,.kicad_mod"; $("plib-file").click(); };
      $("plib-open").onclick = () => { $("plib-file").accept = ".json,.tubelib"; $("plib-file").click(); };
      $("plib-file").onchange = async e => {
        const files = []; for (const f of e.target.files) files.push({ name: f.name, text: await f.text() });
        e.target.value = "";
        addFiles(files); render();
      };
      $("plib-new").onclick = () => {
        offer = null;
        let name = "New part"; for (let k = 2; lib.parts.some(x => x.name.toLowerCase() === name.toLowerCase()); k++) name = `New part ${k}`;
        P.add(lib, [P.blank(name)], {}); sel = lib.parts.find(x => x.name === name).id; changed(); render(); draw(sel);
      };
      $("plib-save").onclick = () => {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([P.toFile(lib, "My parts")], { type: "application/json" })); a.download = "my-parts.tubelib";
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      };
    }
    // the symbol editor on a part's drawing (cad-symedit.js)
    function draw(id) {
      const p = lib.parts.find(x => x.id === id); if (!p) return;
      root.SymbolEditor.open(p.name, p.units, units => { p.units = units; if (units.length > 1) delete p.spice; else if (p.spice) { const ids = new Set(units[0].pins.map(q => q.id)); p.spice.map = (p.spice.map || []).map(m => (m === "0" || ids.has(m) ? m : "")); } if (p.fp && P.unmatched(p, lib.footprints[p.fp]).length && P.best(p, lib.footprints)) p.fp = P.best(p, lib.footprints); changed(); render(); });
    }
    function close() { const m = $("plib-modal"); if (m) m.hidden = true; offer = null; }
    function open(id) {
      if (!$("plib-modal")) build();
      if (id) sel = id;
      $("plib-modal").hidden = false; render();
    }
    // a footprint as a small picture: pads, silkscreen, holes
    function fpSvg(f) {
      const [x1, y1, x2, y2] = f.box, w = Math.max(x2 - x1, 1), h = Math.max(y2 - y1, 1), s = Math.max(w, h) / 80;
      const pads = f.pads.map(p => (p.shape === "rect" ? `<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}" class="${p.smd ? "smd" : "pad"}"/>` : `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.w / 2}" ry="${p.h / 2}" class="${p.smd ? "smd" : "pad"}"/>`) + (p.drill ? `<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" class="drill"/>` : "")).join("");
      const silk = (f.silk || []).map(g => (g.t === "line" ? `<line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>` : `<circle cx="${g.x}" cy="${g.y}" r="${g.r}"/>`)).join("");
      const holes = (f.holes || []).map(q => `<circle cx="${q.x}" cy="${q.y}" r="${q.d / 2}" class="drill"/>`).join("");
      return `<svg class="plib-fp" viewBox="${x1 - s * 4} ${y1 - s * 4} ${w + s * 8} ${h + s * 8}" role="img" aria-label="Footprint ${esc(f.name)}"><g class="silk" stroke-width="${s}">${silk}</g>${pads}${holes}</svg>`;
    }
    function renderOffer() {
      const q = offer.find.toLowerCase().split(/\s+/).filter(Boolean), shown = offer.syms.filter(s => q.every(w => `${s.name} ${s.desc} ${s.keywords}`.toLowerCase().includes(w)));
      $("plib-body").innerHTML = `<div class="plib-offer">
        <div class="plib-bar"><b>${offer.syms.length} symbols in the file: tick the ones to add</b><input type="search" id="plib-ofind" placeholder="Find…" value="${esc(offer.find)}">
          <button class="btn active" id="plib-take">Add the ticked (${offer.ticked.size})</button><button class="btn" id="plib-all" title="Every symbol of the file">Add all ${offer.syms.length}</button><button class="btn" id="plib-skip">Cancel</button></div>
        <div class="plib-olist">${shown.slice(0, 400).map(s => `<label><input type="checkbox" value="${esc(s.name)}" ${offer.ticked.has(s.name) ? "checked" : ""}><b>${esc(s.name)}</b><span>${esc(s.desc || "")}</span></label>`).join("") || `<p class="muted">Nothing found.</p>`}
        ${shown.length > 400 ? `<p class="muted">First 400 of ${shown.length}: type in Find to narrow it down.</p>` : ""}</div></div>`;
      const f = $("plib-ofind");
      f.oninput = () => { offer.find = f.value; const at = f.selectionStart; renderOffer(); const g = $("plib-ofind"); g.focus(); g.setSelectionRange(at, at); };
      $("plib-body").querySelectorAll(".plib-olist input").forEach(c => { c.onchange = () => { if (c.checked) offer.ticked.add(c.value); else offer.ticked.delete(c.value); $("plib-take").textContent = `Add the ticked (${offer.ticked.size})`; }; });
      $("plib-take").onclick = () => { takeOffered(offer.ticked); render(); };
      $("plib-all").onclick = () => { takeOffered(new Set(offer.syms.map(s => s.name))); render(); };
      $("plib-skip").onclick = () => { offer = null; render(); };
    }
    function render() {
      if (!$("plib-modal") || $("plib-modal").hidden) return;
      const nf = Object.keys(lib.footprints).length;
      $("plib-count").textContent = `${lib.parts.length} part${lib.parts.length === 1 ? "" : "s"}, ${nf} footprint${nf === 1 ? "" : "s"}`;
      $("plib-save").disabled = !lib.parts.length && !nf;
      if (offer) { renderOffer(); return; }
      if (!lib.parts.length) {
        $("plib-body").innerHTML = `<p class="plib-empty">No parts yet. Press <b>Add from KiCad files…</b> and choose a symbol library, for instance <code>Amplifier_Operational.kicad_sym</code> from KiCad's own libraries, and the footprints the parts need. Or press <b>New part…</b> and draw one.${nf ? ` ${nf} footprint${nf === 1 ? " is" : "s are"} waiting for their parts.` : ""}</p>`;
        return;
      }
      if (!lib.parts.some(p => p.id === sel)) sel = lib.parts[0].id;
      const q = find.toLowerCase().split(/\s+/).filter(Boolean), list = lib.parts.filter(p => q.every(w => `${p.name} ${p.desc} ${p.keywords}`.toLowerCase().includes(w)));
      const p = lib.parts.find(x => x.id === sel), fits = P.fits(p, lib.footprints), others = Object.keys(lib.footprints).filter(k => !fits.includes(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const fp = p.fp && lib.footprints[p.fp], miss = P.unmatched(p, fp), pins = p.units.reduce((n, u) => n + u.pins.length, 0), unused = P.unused(lib);
      $("plib-body").innerHTML = `<div class="plib-grid">
        <div class="plib-left"><input type="search" id="plib-find" placeholder="Find a part…" value="${esc(find)}">
          <div class="plib-list" role="listbox" aria-label="Parts">${list.map(x => `<button type="button" role="option" aria-selected="${x.id === sel}" class="${x.id === sel ? "on" : ""}" data-id="${esc(x.id)}"><b>${esc(x.name)}</b><span>${esc(x.fp || "no footprint")}</span></button>`).join("") || `<p class="muted">Nothing found.</p>`}</div>
          ${unused.length ? `<button class="btn" id="plib-clean" title="Footprints no part uses: ${esc(unused.slice(0, 12).join(", "))}${unused.length > 12 ? "…" : ""}">Remove ${unused.length} unused footprint${unused.length === 1 ? "" : "s"}</button>` : ""}</div>
        <div class="plib-right">
          <div class="plib-pics"><div class="plib-sym">${p.units.map((u, i) => `<img alt="Unit ${i + 1}" src="${o.thumb("part", paramsOf(p, i + 1), 150, 110, true)}">`).join("")}</div>${fp ? fpSvg(fp) : `<div class="plib-nofp">No footprint</div>`}</div>
          <div class="plib-form">
            <span>Name</span><input type="text" id="plib-name" value="${esc(p.name)}">
            <span title="The letters of its designator on the sheet: DA1, VT3, X2">Designator</span><input type="text" id="plib-prefix" maxlength="4" value="${esc(p.prefix)}">
            <span>Description</span><input type="text" id="plib-desc" value="${esc(p.desc)}">
            <span title="The pads on the board. A pin goes to the pad of its number.">Footprint</span><select id="plib-fp"><option value="">None: a row of pads on the board</option>${fits.length ? `<optgroup label="Fit this part">${fits.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}${others.length ? `<optgroup label="Other footprints">${others.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}</optgroup>` : ""}</select>
            <span title="How the part is simulated">SPICE model</span><div class="plib-model">${p.units.length > 1 ? `<span class="muted">A part of several units is not simulated yet.</span>` : `<span>${p.spice ? esc(p.spice.sub) : "none: left out of the simulation"}</span><button class="btn" id="plib-model">Model…</button>${p.spice ? `<button class="btn" id="plib-nomodel">Remove</button>` : ""}`}</div>
          </div>
          <p class="insp-help">${pins} pin${pins === 1 ? "" : "s"}${p.units.length > 1 ? ` in ${p.units.length} units` : ""}${p.src ? ` · from ${esc(p.src)}` : ""}${p.fpHint ? ` · KiCad names the footprint ${esc(p.fpHint)}` : p.filters ? ` · KiCad's footprints for it: ${esc(p.filters)}` : ""}</p>
          ${miss.length ? `<p class="plib-warn">⚠ The footprint has no pad ${miss.length === 1 ? "number" : "numbers"} ${esc(miss.slice(0, 12).join(", "))}${miss.length > 12 ? "…" : ""}: ${miss.length === 1 ? "that pin stays" : "those pins stay"} unconnected on the board.</p>` : ""}
          <div class="plib-bar"><button class="btn active" id="plib-place" title="Close and place it on the sheet">Place on the sheet</button><button class="btn" id="plib-draw" title="Change the drawing and the pins: lines, rectangles, circles, text, pins, units">Edit drawing…</button><button class="btn" id="plib-copy" title="A second part with the same drawing, footprint and model, to change">Duplicate</button><button class="btn" id="plib-del">Delete the part</button></div>
        </div></div>`;
      $("plib-fp").value = p.fp || "";
      const f = $("plib-find");
      f.oninput = () => { find = f.value; const at = f.selectionStart; render(); const g = $("plib-find"); g.focus(); g.setSelectionRange(at, at); };
      $("plib-body").querySelectorAll(".plib-list button").forEach(b => { b.onclick = () => { sel = b.dataset.id; render(); }; });
      const set = (id, fn) => { $(id).onchange = () => { fn($(id).value.trim()); changed(); render(); }; };
      set("plib-name", v => { if (v && !lib.parts.some(x => x !== p && x.name.toLowerCase() === v.toLowerCase())) p.name = v; });
      set("plib-prefix", v => { p.prefix = v.replace(/[^A-Za-zА-Яа-я]/g, "").toUpperCase() || "U"; });
      set("plib-desc", v => { p.desc = v; });
      set("plib-fp", v => { p.fp = v; });
      if ($("plib-clean")) $("plib-clean").onclick = () => { unused.forEach(k => delete lib.footprints[k]); changed(); render(); };
      if ($("plib-model")) $("plib-model").onclick = () => root.SpicePart.open(p.spice ? { text: p.spice.text, sub: p.spice.sub, name: p.spice.sub, sym: "own", map: p.spice.map } : null,
        r => { p.spice = { text: r.text, sub: r.sub, map: r.map }; changed(); render(); }, { pins: p.units[0].pins.map(q => ({ id: q.id, name: q.name })) });
      if ($("plib-nomodel")) $("plib-nomodel").onclick = () => { delete p.spice; changed(); render(); };
      $("plib-draw").onclick = () => draw(p.id);
      $("plib-copy").onclick = () => {
        const q = JSON.parse(JSON.stringify(p)); q.id = ""; q.src = `a copy of ${p.name}`;
        let name = `${p.name} copy`; for (let k = 2; lib.parts.some(x => x.name.toLowerCase() === name.toLowerCase()); k++) name = `${p.name} copy ${k}`;
        q.name = name; P.add(lib, [q], {}); sel = lib.parts.find(x => x.name === name).id; changed(); render();
      };
      $("plib-del").onclick = () => { P.remove(lib, p.id); sel = null; changed(); render(); };
      $("plib-place").onclick = () => { close(); o.place(paramsOf(p)); };
    }

    return {
      ready, open, close, entries, addFiles, draw, takeOffered: names => takeOffered(new Set(names)),
      get: () => lib, part: id => lib.parts.find(p => p.id === id) || null, paramsOf: (id, unit) => { const p = lib.parts.find(x => x.id === id); return p ? paramsOf(p, unit) : null; },
      offered: () => (offer ? offer.syms.map(s => s.name) : []),
      clear() { lib = P.empty(); sel = null; return changed(); }
    };
  }
  root.CadLibrary = CadLibrary;
})(typeof window !== "undefined" ? window : globalThis);
