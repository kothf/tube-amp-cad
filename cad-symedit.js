/* =============================================================================
   The symbol editor: the drawing of a library part (part-lib.js), unit by unit.
   Lines, rectangles, circles, text and pins on a 10-unit grid (the sheet's own; pins
   on it, so wires meet them), a table of the unit's pins, a box made from a list of
   pins. It edits a copy and hands it back on Save.
   A drawing: { g: [["p", fill, x, y, …] | ["c", fill, x, y, r] | ["t", x, y, size, text]],
     pins: [{ id, num, name, x, y, a, l }], box, pn, pm } (kicad-import.js symData)
   Depends on: part-lib.js
   ============================================================================= */
(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = t => String(t === undefined || t === null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const clone = o => JSON.parse(JSON.stringify(o));
  const TOOLS = [["select", "Select", "Click a shape or a pin to select it, drag to move it; Delete removes it"], ["line", "Line", "Click point after point; double-click or Enter ends the line, Esc drops it"], ["rect", "Rectangle", "Drag from one corner to the other"],
    ["circle", "Circle", "Drag from the centre outwards"], ["text", "Text", "Click where the text goes, then type it at the right"], ["pin", "Pin", "Click where the wire will meet the pin; its side is chosen at the right"]];
  let st = null, onDone = null;

  function build() {
    const m = document.createElement("div"); m.className = "modal"; m.id = "symed-modal"; m.hidden = true;
    m.innerHTML = `<div class="modal-box symed">
      <div class="insp-title" id="symed-title">Drawing</div>
      <div class="symed-bar" id="symed-tools" role="toolbar" aria-label="Drawing tools"></div>
      <div class="symed-grid">
        <div class="symed-stage"><svg id="symed-svg" tabindex="0" role="img" aria-label="The part's drawing"></svg><div class="symed-units" id="symed-units"></div></div>
        <div class="symed-side">
          <div id="symed-props"></div>
          <div class="insp-sub">Pins of this unit</div>
          <div id="symed-pins"></div>
          <details class="symed-box"><summary>Make a box from a list of pins</summary>
            <p class="insp-help">One pin per line: its number, its name and, if you like, its side (left, right, top, bottom). Without sides the pins go round the box as on a DIP. This replaces the unit's drawing.</p>
            <textarea id="symed-list" spellcheck="false" placeholder="1 IN+&#10;2 IN-&#10;3 GND&#10;4 OUT"></textarea>
            <button class="btn" id="symed-make">Make the box</button></details>
        </div>
      </div>
      <div id="symed-msg" class="insp-help"></div>
      <div class="modal-actions"><button class="btn" id="symed-cancel">Cancel</button><button class="btn active" id="symed-ok">Save the drawing</button></div>
    </div>`;
    document.body.appendChild(m);
    $("symed-tools").innerHTML = TOOLS.map(([k, n, t]) => `<button type="button" class="btn" data-tool="${k}" title="${esc(t)}">${n}</button>`).join("")
      + `<span class="symed-sep"></span><button type="button" class="btn" id="symed-undo" title="Take back the last change (Ctrl+Z)">Undo</button><button type="button" class="btn" id="symed-del" title="Remove what is selected (Delete)">Delete</button>`;
    $("symed-tools").querySelectorAll("[data-tool]").forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
    $("symed-undo").onclick = undo; $("symed-del").onclick = removeSel;
    $("symed-cancel").onclick = close; $("symed-ok").onclick = done;
    $("symed-make").onclick = () => { const list = root.PartLib.pinList($("symed-list").value); if (!list.length) return; snapshot(); st.units[st.u] = root.PartLib.boxSymbol(list); st.sel = null; render(); };
    const svg = $("symed-svg");
    svg.addEventListener("pointerdown", down); svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("dblclick", () => endLine());
    svg.addEventListener("keydown", e => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); }
      else if (e.key === "Escape") { e.stopPropagation(); if (st.draft) { st.draft = null; render(); } else setTool("select"); }
      else if (e.key === "Enter") endLine();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    });
  }
  const sym = () => st.units[st.u];
  function snapshot() { st.undo.push(JSON.stringify({ units: st.units, u: st.u })); if (st.undo.length > 60) st.undo.shift(); }
  function undo() { const s = st.undo.pop(); if (!s) return; const d = JSON.parse(s); st.units = d.units; st.u = Math.min(d.u, d.units.length - 1); st.sel = null; st.draft = null; render(); }
  function setTool(t) { st.tool = t; st.draft = null; if (t !== "select") st.sel = null; render(); }
  function removeSel() {
    if (!st.sel) return; snapshot();
    if (st.sel.k === "pin") sym().pins.splice(st.sel.i, 1); else sym().g.splice(st.sel.i, 1);
    st.sel = null; render();
  }
  // the pointer on the drawing's own grid (pins on 10, the drawing on 5)
  function at(e, grid) {
    const svg = $("symed-svg"), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse()), g = grid || 5;
    return [Math.round(q.x / g) * g, Math.round(q.y / g) * g];
  }
  function down(e) {
    if (e.button !== 0) return;
    $("symed-svg").focus();
    const tool = st.tool, hit = e.target.closest("[data-k]");
    if (tool === "select") {
      st.sel = hit ? { k: hit.dataset.k, i: +hit.dataset.i } : null;
      if (st.sel) { const [x, y] = at(e, st.sel.k === "pin" ? 10 : 5); st.drag = { x, y, moved: false }; $("symed-svg").setPointerCapture(e.pointerId); }
      render(); return;
    }
    const [x, y] = at(e, tool === "pin" ? 10 : 5);
    if (tool === "line") { if (!st.draft) st.draft = { k: "line", pts: [x, y, x, y] }; else st.draft.pts.push(x, y); }
    else if (tool === "rect" || tool === "circle") { st.draft = { k: tool, x, y, x2: x, y2: y }; $("symed-svg").setPointerCapture(e.pointerId); }
    else if (tool === "text") { snapshot(); sym().g.push(["t", x, y, 10, "Text"]); st.sel = { k: "g", i: sym().g.length - 1 }; st.tool = "select"; }
    else if (tool === "pin") {
      snapshot();
      const nums = st.units.flatMap(u => u.pins.map(p => +p.num)).filter(n => n > 0), side = st.pinSide || "left";
      sym().pins.push({ id: "", num: String((nums.length ? Math.max(...nums) : 0) + 1), name: "", x, y, a: root.PartLib.SIDE_ANGLE[side], l: 20 });
      st.sel = { k: "pin", i: sym().pins.length - 1 };
    }
    render();
  }
  function move(e) {
    if (st.drag && st.sel) {
      const pin = st.sel.k === "pin", [x, y] = at(e, pin ? 10 : 5), dx = x - st.drag.x, dy = y - st.drag.y;
      if (!dx && !dy) return;
      if (!st.drag.moved) { snapshot(); st.drag.moved = true; }
      if (pin) { const p = sym().pins[st.sel.i]; p.x += dx; p.y += dy; }
      else { const s = sym().g[st.sel.i]; if (s[0] === "p") for (let i = 2; i + 1 < s.length; i += 2) { s[i] += dx; s[i + 1] += dy; } else if (s[0] === "c") { s[2] += dx; s[3] += dy; } else { s[1] += dx; s[2] += dy; } }
      st.drag.x = x; st.drag.y = y; render(true); return;
    }
    if (!st.draft) return;
    const [x, y] = at(e, 5);
    if (st.draft.k === "line") { const p = st.draft.pts; p[p.length - 2] = x; p[p.length - 1] = y; } else { st.draft.x2 = x; st.draft.y2 = y; }
    render(true);
  }
  function up() {
    if (st.drag) { const moved = st.drag.moved; st.drag = null; if (moved) render(); return; }
    const d = st.draft; if (!d || d.k === "line") return;
    st.draft = null;
    if (d.k === "rect" && d.x !== d.x2 && d.y !== d.y2) { snapshot(); sym().g.push(["p", 2, d.x, d.y, d.x2, d.y, d.x2, d.y2, d.x, d.y2, d.x, d.y]); }
    else if (d.k === "circle") { const r = Math.round(Math.hypot(d.x2 - d.x, d.y2 - d.y)); if (r > 0) { snapshot(); sym().g.push(["c", 0, d.x, d.y, r]); } }
    st.sel = null; render();
  }
  function endLine() {
    const d = st.draft; if (!d || d.k !== "line") return;
    st.draft = null;
    // the point under the pointer is the last one clicked (a double click adds it twice)
    const p = d.pts.slice(); while (p.length >= 4 && p[p.length - 1] === p[p.length - 3] && p[p.length - 2] === p[p.length - 4]) p.splice(-2);
    if (p.length >= 4) { snapshot(); sym().g.push(["p", 0, ...p]); }
    render();
  }

  // ---- drawing ----
  function shapes(s, selected) {
    const P = root.PartLib, on = (k, i) => (selected && selected.k === k && selected.i === i ? " on" : "");
    const fill = f => (f === 1 ? "solid" : f === 2 ? "back" : "none");
    let out = "";
    (s.g || []).forEach((g, i) => {
      if (g[0] === "p") { const pts = []; for (let k = 2; k + 1 < g.length; k += 2) pts.push(g[k] + "," + g[k + 1]); out += `<polyline data-k="g" data-i="${i}" class="shape ${fill(g[1])}${on("g", i)}" points="${pts.join(" ")}"/>`; }
      else if (g[0] === "c") out += `<circle data-k="g" data-i="${i}" class="shape ${fill(g[1])}${on("g", i)}" cx="${g[2]}" cy="${g[3]}" r="${g[4]}"/>`;
      else if (g[0] === "t") out += `<text data-k="g" data-i="${i}" class="label${on("g", i)}" x="${g[1]}" y="${g[2]}" font-size="${Math.max(6, Math.min(14, g[3]))}" text-anchor="middle" dominant-baseline="middle">${esc(g[4])}</text>`;
    });
    (s.pins || []).forEach((p, i) => {
      const [ex, ey] = P.pinEnd(p), dx = Math.sign(ex - p.x), dy = Math.sign(ey - p.y), mx = (p.x + ex) / 2, my = (p.y + ey) / 2;
      out += `<g data-k="pin" data-i="${i}" class="pin${on("pin", i)}"><line x1="${p.x}" y1="${p.y}" x2="${ex}" y2="${ey}"/><circle class="end" cx="${p.x}" cy="${p.y}" r="2.5"/><rect class="grab" x="${Math.min(p.x, ex) - 4}" y="${Math.min(p.y, ey) - 4}" width="${Math.abs(ex - p.x) + 8}" height="${Math.abs(ey - p.y) + 8}"/>`
        + `<text class="num" x="${mx + (dy ? 5 : 0)}" y="${my - (dx ? 4 : 0)}" text-anchor="${dy ? "start" : "middle"}" font-size="7">${esc(p.num)}</text>`
        + (p.name ? `<text class="name" x="${ex + dx * 3}" y="${ey + dy * 3}" text-anchor="${dx > 0 ? "start" : dx < 0 ? "end" : "middle"}" dominant-baseline="${dy > 0 ? "hanging" : dy < 0 ? "auto" : "middle"}" font-size="8">${esc(p.name)}</text>` : "") + `</g>`;
    });
    return out;
  }
  function render(light) {
    const P = root.PartLib, s = sym(), b = P.bounds(s), pad = 30;
    // the view grows with the drawing but never jumps while something is dragged
    if (!light || !st.view) { const w = Math.max(b[2] - b[0], 160) + pad * 2, h = Math.max(b[3] - b[1], 120) + pad * 2, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2; st.view = [Math.floor((cx - w / 2) / 10) * 10, Math.floor((cy - h / 2) / 10) * 10, Math.ceil(w / 10) * 10, Math.ceil(h / 10) * 10]; }
    const v = st.view, d = st.draft;
    let draft = "";
    if (d && d.k === "line") { const pts = []; for (let k = 0; k + 1 < d.pts.length; k += 2) pts.push(d.pts[k] + "," + d.pts[k + 1]); draft = `<polyline class="shape draft" points="${pts.join(" ")}"/>`; }
    else if (d && d.k === "rect") draft = `<rect class="shape draft" x="${Math.min(d.x, d.x2)}" y="${Math.min(d.y, d.y2)}" width="${Math.abs(d.x2 - d.x)}" height="${Math.abs(d.y2 - d.y)}"/>`;
    else if (d && d.k === "circle") draft = `<circle class="shape draft" cx="${d.x}" cy="${d.y}" r="${Math.hypot(d.x2 - d.x, d.y2 - d.y)}"/>`;
    const svg = $("symed-svg");
    svg.setAttribute("viewBox", v.join(" "));
    svg.innerHTML = `<defs><pattern id="symed-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.6" class="dot"/><circle cx="10" cy="0" r="0.6" class="dot"/><circle cx="0" cy="10" r="0.6" class="dot"/><circle cx="10" cy="10" r="0.6" class="dot"/></pattern></defs>`
      + `<rect x="${v[0]}" y="${v[1]}" width="${v[2]}" height="${v[3]}" fill="url(#symed-dots)"/><path class="axis" d="M${v[0]} 0H${v[0] + v[2]}M0 ${v[1]}V${v[1] + v[3]}"/>` + shapes(s, st.sel) + draft;
    svg.dataset.tool = st.tool;
    if (light) return;
    $("symed-tools").querySelectorAll("[data-tool]").forEach(x => { x.classList.toggle("active", x.dataset.tool === st.tool); x.setAttribute("aria-pressed", x.dataset.tool === st.tool); });
    $("symed-undo").disabled = !st.undo.length; $("symed-del").disabled = !st.sel;
    // units
    $("symed-units").innerHTML = st.units.map((u, i) => `<button type="button" class="btn${i === st.u ? " active" : ""}" data-u="${i}" title="Unit ${String.fromCharCode(65 + i)} of the package">${String.fromCharCode(65 + i)}</button>`).join("")
      + `<button type="button" class="btn" id="symed-addunit" title="Another unit of the same package (the second amplifier of a dual op-amp, the supply pins)">+ Unit</button>` + (st.units.length > 1 ? `<button type="button" class="btn" id="symed-delunit" title="Remove this unit and its pins">Remove unit</button>` : "");
    $("symed-units").querySelectorAll("[data-u]").forEach(x => { x.onclick = () => { st.u = +x.dataset.u; st.sel = null; st.draft = null; st.view = null; render(); }; });
    $("symed-addunit").onclick = () => { snapshot(); st.units.push({ g: clone(s.g), pins: [], box: [-20, -20, 20, 20], pn: s.pn, pm: s.pm }); st.u = st.units.length - 1; st.sel = null; st.view = null; render(); };
    if ($("symed-delunit")) $("symed-delunit").onclick = () => { snapshot(); st.units.splice(st.u, 1); st.u = Math.max(0, st.u - 1); st.sel = null; st.view = null; render(); };
    props(); pinTable(); check();
  }
  const SIDES = [["left", "Left"], ["right", "Right"], ["top", "Top"], ["bottom", "Bottom"]];
  function field(label, html) { return `<label class="symed-f"><span>${label}</span>${html}</label>`; }
  function props() {
    const P = root.PartLib, s = sym(), host = $("symed-props"), sel = st.sel;
    const bind = (id, fn, live) => { const el = $(id); if (!el) return; el[live ? "oninput" : "onchange"] = () => { if (!live || !st.typing) { snapshot(); st.typing = live; } fn(el.value); if (live) { render(true); pinTable(); check(); } else render(); }; if (live) el.onblur = () => { st.typing = false; }; };
    if (st.tool === "pin" && !sel) {
      host.innerHTML = `<div class="insp-sub">New pins</div>` + field("Side of the body", `<select id="symed-side">${SIDES.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>`);
      $("symed-side").value = st.pinSide || "left"; $("symed-side").onchange = () => { st.pinSide = $("symed-side").value; };
      return;
    }
    if (!sel) { host.innerHTML = `<div class="insp-sub">Drawing</div>` + field("Pin names", `<select id="symed-pn"><option value="1">Shown</option><option value="0">Hidden</option></select>`) + field("Pin numbers", `<select id="symed-pm"><option value="1">Shown</option><option value="0">Hidden</option></select>`)
      + `<p class="insp-help">Pins sit on the sheet's grid (10), the drawing on half of it. The cross marks the part's centre: it turns and is placed about it.</p>`;
      $("symed-pn").value = s.pn > 0 ? "1" : "0"; $("symed-pm").value = s.pm ? "1" : "0";
      $("symed-pn").onchange = () => { snapshot(); st.units.forEach(u => { if ($("symed-pn").value === "1") u.pn = 3; else delete u.pn; }); render(); };
      $("symed-pm").onchange = () => { snapshot(); st.units.forEach(u => { if ($("symed-pm").value === "1") u.pm = 1; else delete u.pm; }); render(); };
      return; }
    if (sel.k === "pin") {
      const p = s.pins[sel.i];
      host.innerHTML = `<div class="insp-sub">Pin</div>` + field("Number", `<input type="text" id="symed-num" value="${esc(p.num)}" maxlength="6">`) + field("Name", `<input type="text" id="symed-name" value="${esc(p.name)}" maxlength="16">`)
        + field("Side of the body", `<select id="symed-pside">${SIDES.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>`) + field("Length", `<select id="symed-len">${[0, 10, 20, 30].map(l => `<option value="${l}">${l}</option>`).join("")}</select>`);
      $("symed-pside").value = P.ANGLE_SIDE[p.a] || "left"; $("symed-len").value = String([0, 10, 20, 30].includes(p.l) ? p.l : 20);
      bind("symed-num", v => { p.num = v.trim(); }, true); bind("symed-name", v => { p.name = v.trim(); }, true);
      bind("symed-pside", v => { p.a = P.SIDE_ANGLE[v]; }); bind("symed-len", v => { p.l = +v; });
      return;
    }
    const g = s.g[sel.i];
    if (g[0] === "t") {
      host.innerHTML = `<div class="insp-sub">Text</div>` + field("Text", `<input type="text" id="symed-text" value="${esc(g[4])}" maxlength="40">`) + field("Size", `<select id="symed-size">${[7, 8, 10, 12, 14].map(l => `<option value="${l}">${l}</option>`).join("")}</select>`);
      $("symed-size").value = String([7, 8, 10, 12, 14].includes(g[3]) ? g[3] : 10);
      bind("symed-text", v => { g[4] = v || " "; }, true); bind("symed-size", v => { g[3] = +v; });
      const t = $("symed-text"); if (g[4] === "Text") { t.focus(); t.select(); }
    } else {
      host.innerHTML = `<div class="insp-sub">${g[0] === "c" ? "Circle" : "Line"}</div>` + field("Fill", `<select id="symed-fill"><option value="0">None</option><option value="2">Body colour</option><option value="1">Solid</option></select>`);
      $("symed-fill").value = String(g[1] || 0); bind("symed-fill", v => { g[1] = +v; });
    }
  }
  function pinTable() {
    const s = sym(), host = $("symed-pins");
    if (document.activeElement && host.contains(document.activeElement)) return;      // being typed in
    host.innerHTML = s.pins.length ? `<table class="symed-table"><thead><tr><th>No.</th><th>Name</th><th></th></tr></thead><tbody>${s.pins.map((p, i) => `<tr data-i="${i}" class="${st.sel && st.sel.k === "pin" && st.sel.i === i ? "on" : ""}"><td><input type="text" data-f="num" value="${esc(p.num)}" maxlength="6" aria-label="Pin number"></td><td><input type="text" data-f="name" value="${esc(p.name)}" maxlength="16" aria-label="Pin name"></td><td><button type="button" class="btn" title="Remove the pin" aria-label="Remove the pin">×</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="insp-help">No pins yet: take the Pin tool and click where each wire will meet the part, or make a box from a list below.</p>`;
    host.querySelectorAll("tr[data-i]").forEach(tr => {
      const i = +tr.dataset.i;
      tr.querySelectorAll("input").forEach(inp => {
        inp.onfocus = () => { st.sel = { k: "pin", i }; st.tool = "select"; render(true); snapshot(); };
        inp.oninput = () => { s.pins[i][inp.dataset.f] = inp.value.trim(); render(true); check(); };
        inp.onblur = () => { setTimeout(() => { if (st && !host.contains(document.activeElement)) render(); }, 0); };
      });
      tr.querySelector("button").onclick = () => { snapshot(); s.pins.splice(i, 1); st.sel = null; render(); };
    });
  }
  // what stops the drawing from being saved: no pins anywhere, a pin number twice in the package
  function problems() {
    const out = [], seen = new Map(), twice = new Set();
    st.units.forEach((u, k) => { if (!u.pins.length) out.push(st.units.length > 1 ? `Unit ${String.fromCharCode(65 + k)} has no pins` : "The drawing has no pins"); u.pins.forEach(p => { const n = String(p.num || "").trim(); if (!n) return; if (seen.has(n)) twice.add(n); seen.set(n, k); }); });
    if (twice.size) out.push(`Pin number ${[...twice].join(", ")} is used twice`);
    return out;
  }
  function check() { const why = problems(); $("symed-msg").textContent = why.length ? "⚠ " + why.join(". ") + "." : ""; $("symed-ok").disabled = !!why.length; $("symed-ok").title = why.join(". "); return !why.length; }
  function result() { const units = clone(st.units); units.forEach(u => root.PartLib.tidy(u)); return units; }
  function done() { if (!check()) return; const r = result(), cb = onDone; close(); if (cb) cb(r); }
  function close() { $("symed-modal").hidden = true; st = null; onDone = null; }
  /** Edit a part's units (a copy); cb(units) on Save */
  function open(name, units, cb) {
    if (!$("symed-modal")) build();
    st = { units: clone(units && units.length ? units : [root.PartLib.boxSymbol([{ num: "1" }, { num: "2" }])]), u: 0, tool: "select", sel: null, draft: null, drag: null, undo: [], view: null, pinSide: "left", typing: false };
    onDone = cb;
    $("symed-title").textContent = `Drawing of ${name || "the part"}`;
    $("symed-list").value = "";
    document.body.appendChild($("symed-modal")); $("symed-modal").hidden = false;
    render(); $("symed-svg").focus();
  }
  root.SymbolEditor = { open, close, state: () => st, result: () => (st ? result() : null), shapes };
})(typeof window !== "undefined" ? window : globalThis);
