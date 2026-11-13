/* =============================================================================
   The footprint editor: the pads of a library part on the board (part-lib.js), in millimetres.
   Pads (drilled or surface, round or rectangular), mounting holes, silkscreen lines and circles on
   a grid you choose; the usual packages made from a few numbers (rows, pitch, pad); a table of
   the pads. It edits a copy and hands it back on Save.
   A footprint: { name, title, pads: [{ num, x, y, shape: circle | rect, w, h, drill, smd, back }],
     silk: [{ t: "line", x1, y1, x2, y2 } | { t: "circle", x, y, r }], holes: [{ x, y, d }], box }
   Depends on: part-lib.js
   ============================================================================= */
(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = t => String(t === undefined || t === null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const clone = o => JSON.parse(JSON.stringify(o));
  const num = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
  const r3 = v => Math.round(v * 1000) / 1000;
  const TOOLS = [["select", "Select", "Click a pad, a hole or a line to select it, drag to move it; drag the empty board to move the view; Delete removes"], ["pad", "Pad", "Click where the pad goes; its size and hole are set at the right, its number counts up"], ["hole", "Hole", "A mounting hole with no copper: click where it goes"],
    ["line", "Line", "Silkscreen: click point after point; double-click or Enter ends the line, Esc drops it"], ["rect", "Rectangle", "Silkscreen: drag from one corner to the other"], ["circle", "Circle", "Silkscreen: drag from the centre outwards"]];
  const GRIDS = [2.54, 1.27, 0.635, 0.5, 0.25, 0.1];
  const KINDS = [["tht", "Through-hole"], ["smd", "Surface, top"], ["back", "Surface, bottom"]];
  let st = null, onDone = null;

  function build() {
    const m = document.createElement("div"); m.className = "modal"; m.id = "fped-modal"; m.hidden = true;
    m.innerHTML = `<div class="modal-box symed fped">
      <div class="insp-title" id="fped-title">Footprint</div>
      <div class="symed-bar" id="fped-tools" role="toolbar" aria-label="Footprint tools"></div>
      <div class="symed-grid">
        <div class="symed-stage"><svg id="fped-svg" tabindex="0" role="img" aria-label="The footprint, seen from the top of the board"></svg><div class="insp-help" id="fped-pos"></div></div>
        <div class="symed-side">
          <label class="symed-f"><span>Name</span><input type="text" id="fped-name" maxlength="80"></label>
          <label class="symed-f"><span>Description</span><input type="text" id="fped-desc" maxlength="120"></label>
          <div id="fped-props"></div>
          <div class="insp-sub">Pads</div>
          <div id="fped-pads"></div>
          <details class="symed-box" id="fped-pat"><summary>Make a usual package</summary>
            <p class="insp-help">Rows of pads from a few numbers, in millimetres, centred, pad 1 at the top left and counted anticlockwise. This replaces the footprint.</p>
            <div id="fped-patform"></div>
            <button class="btn" id="fped-make">Make the pads</button></details>
        </div>
      </div>
      <div id="fped-msg" class="insp-help"></div>
      <div class="modal-actions"><button class="btn" id="fped-cancel">Cancel</button><button class="btn active" id="fped-ok">Save the footprint</button></div>
    </div>`;
    document.body.appendChild(m);
    $("fped-tools").innerHTML = TOOLS.map(([k, n, t]) => `<button type="button" class="btn" data-tool="${k}" title="${esc(t)}">${n}</button>`).join("")
      + `<span class="symed-sep"></span><button type="button" class="btn" id="fped-undo" title="Take back the last change (Ctrl+Z)">Undo</button><button type="button" class="btn" id="fped-del" title="Remove what is selected (Delete)">Delete</button>`
      + `<span class="symed-sep"></span><label class="fped-grid" title="What the pointer snaps to. Typed numbers are kept as typed.">Grid <select id="fped-gridsel">${GRIDS.map(g => `<option value="${g}">${g} mm</option>`).join("")}</select></label>`
      + `<button type="button" class="btn" id="fped-fit" title="Show the whole footprint">Fit</button><button type="button" class="btn" id="fped-centre" title="Move everything so that the middle of the pads is the footprint's centre (the cross): the part turns about it">Centre on the pads</button>`;
    $("fped-tools").querySelectorAll("[data-tool]").forEach(b => { b.onclick = () => setTool(b.dataset.tool); });
    $("fped-undo").onclick = undo; $("fped-del").onclick = removeSel;
    $("fped-cancel").onclick = close; $("fped-ok").onclick = done;
    $("fped-gridsel").onchange = () => { st.grid = +$("fped-gridsel").value; render(); };
    $("fped-fit").onclick = () => { st.view = null; render(); };
    $("fped-centre").onclick = centre;
    $("fped-name").oninput = () => { st.f.name = $("fped-name").value; check(); };
    $("fped-desc").oninput = () => { st.f.title = $("fped-desc").value; };
    $("fped-make").onclick = () => { snapshot(); const f = root.PartLib.fpPattern(st.pat.kind, st.pat, st.f.name); f.title = st.f.title; st.f = f; st.sel = null; st.view = null; adopt(); render(); };
    const svg = $("fped-svg");
    svg.addEventListener("pointerdown", down); svg.addEventListener("pointermove", move); svg.addEventListener("pointerup", up); svg.addEventListener("dblclick", () => endLine());
    svg.addEventListener("wheel", wheel, { passive: false });
    svg.addEventListener("keydown", e => {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeSel(); }
      else if (e.key === "Escape") { e.stopPropagation(); if (st.draft) { st.draft = null; render(); } else setTool("select"); }
      else if (e.key === "Enter") endLine();
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      else if (st.sel && /^Arrow/.test(e.key)) { e.preventDefault(); snapshot(); shift(st.sel, e.key === "ArrowLeft" ? -st.grid : e.key === "ArrowRight" ? st.grid : 0, e.key === "ArrowUp" ? -st.grid : e.key === "ArrowDown" ? st.grid : 0); render(); }
    });
  }
  // new pads are made like the footprint's own, on a grid that suits them
  function adopt() {
    const first = st.f.pads[0], tht = st.f.pads.find(p => p.drill);
    if (first) Object.assign(st.def, { kind: first.smd ? (first.back ? "back" : "smd") : "tht", shape: first.shape === "rect" && first.smd ? "rect" : "circle", w: first.w, h: first.h });
    if (tht) st.def.drill = tht.drill;
    st.grid = first && first.smd ? 0.5 : 1.27;
  }
  const list = k => (k === "pad" ? st.f.pads : k === "hole" ? st.f.holes : st.f.silk);
  function snapshot() { st.undo.push(JSON.stringify(st.f)); if (st.undo.length > 60) st.undo.shift(); }
  function undo() { const s = st.undo.pop(); if (!s) return; st.f = JSON.parse(s); st.sel = null; st.draft = null; render(); }
  function setTool(t) { st.tool = t; st.draft = null; if (t !== "select") st.sel = null; render(); }
  function removeSel() { if (!st.sel) return; snapshot(); list(st.sel.k).splice(st.sel.i, 1); st.sel = null; render(); }
  function shift(sel, dx, dy) {
    const o = list(sel.k)[sel.i]; if (!o) return;
    if (sel.k === "silk" && o.t === "line") { o.x1 = r3(o.x1 + dx); o.y1 = r3(o.y1 + dy); o.x2 = r3(o.x2 + dx); o.y2 = r3(o.y2 + dy); } else { o.x = r3(o.x + dx); o.y = r3(o.y + dy); }
  }
  function centre() {
    const p = st.f.pads; if (!p.length) return;
    const xs = p.map(q => q.x), ys = p.map(q => q.y), dx = -r3((Math.min(...xs) + Math.max(...xs)) / 2), dy = -r3((Math.min(...ys) + Math.max(...ys)) / 2);
    if (!dx && !dy) return;
    snapshot();
    ["pad", "hole", "silk"].forEach(k => list(k).forEach((o, i) => shift({ k, i }, dx, dy)));
    st.view = null; render();
  }
  // the pointer in millimetres: raw, and on the grid
  function raw(e) { const svg = $("fped-svg"), pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [q.x, q.y]; }
  function at(e) { const [x, y] = raw(e), g = st.grid; return [r3(Math.round(x / g) * g), r3(Math.round(y / g) * g)]; }
  function nextNum() {
    const ns = st.f.pads.map(p => String(p.num)), n = ns.map(v => +v).filter(v => v > 0 && Number.isInteger(v));
    // the part's own pin numbers first (those with no pad yet), then counting up
    const want = (st.pins || []).find(v => !ns.includes(String(v)));
    return want !== undefined ? String(want) : String((n.length ? Math.max(...n) : 0) + 1);
  }
  function down(e) {
    if (e.button !== 0 && e.button !== 1) return;
    $("fped-svg").focus();
    const tool = st.tool, hit = e.button === 0 && e.target.closest("[data-k]");
    if (tool === "select" || e.button === 1) {
      st.sel = hit ? { k: hit.dataset.k, i: +hit.dataset.i } : e.button === 1 ? st.sel : null;
      if (hit) { const [x, y] = at(e); st.drag = { x, y, moved: false }; }
      else { const [x, y] = raw(e); st.pan = { x, y }; }
      $("fped-svg").setPointerCapture(e.pointerId);
      render(); return;
    }
    const [x, y] = at(e), d = st.def;
    if (tool === "line") { if (!st.draft) st.draft = { k: "line", pts: [x, y, x, y] }; else st.draft.pts.push(x, y); }
    else if (tool === "rect" || tool === "circle") { st.draft = { k: tool, x, y, x2: x, y2: y }; $("fped-svg").setPointerCapture(e.pointerId); }
    else if (tool === "pad") {
      snapshot();
      const p = { num: nextNum(), x, y, shape: d.shape, w: d.w, h: d.h, drill: d.kind === "tht" ? d.drill : 0 };
      if (d.kind !== "tht") { p.smd = true; if (d.kind === "back") p.back = true; }
      st.f.pads.push(p);
    } else if (tool === "hole") { snapshot(); st.f.holes.push({ x, y, d: d.hole }); }
    render();
  }
  function move(e) {
    const [mx, my] = at(e);
    $("fped-pos").textContent = `x ${mx}  y ${my} mm`;
    if (st.pan) { const [x, y] = raw(e); st.view[0] -= x - st.pan.x; st.view[1] -= y - st.pan.y; st.zoomed = true; render(true); return; }
    if (st.drag && st.sel) {
      const dx = r3(mx - st.drag.x), dy = r3(my - st.drag.y);
      if (!dx && !dy) return;
      if (!st.drag.moved) { snapshot(); st.drag.moved = true; }
      shift(st.sel, dx, dy); st.drag.x = mx; st.drag.y = my; render(true); return;
    }
    if (!st.draft) return;
    if (st.draft.k === "line") { const p = st.draft.pts; p[p.length - 2] = mx; p[p.length - 1] = my; } else { st.draft.x2 = mx; st.draft.y2 = my; }
    render(true);
  }
  function up() {
    if (st.pan) { st.pan = null; return; }
    if (st.drag) { const moved = st.drag.moved; st.drag = null; if (moved) render(); return; }
    const d = st.draft; if (!d || d.k === "line") return;
    st.draft = null;
    if (d.k === "rect" && d.x !== d.x2 && d.y !== d.y2) { snapshot(); st.f.silk.push({ t: "line", x1: d.x, y1: d.y, x2: d.x2, y2: d.y }, { t: "line", x1: d.x2, y1: d.y, x2: d.x2, y2: d.y2 }, { t: "line", x1: d.x2, y1: d.y2, x2: d.x, y2: d.y2 }, { t: "line", x1: d.x, y1: d.y2, x2: d.x, y2: d.y }); }
    else if (d.k === "circle") { const r = r3(Math.hypot(d.x2 - d.x, d.y2 - d.y)); if (r > 0) { snapshot(); st.f.silk.push({ t: "circle", x: d.x, y: d.y, r }); } }
    render();
  }
  function endLine() {
    const d = st.draft; if (!d || d.k !== "line") return;
    st.draft = null;
    const p = d.pts.slice(); while (p.length >= 4 && p[p.length - 1] === p[p.length - 3] && p[p.length - 2] === p[p.length - 4]) p.splice(-2);
    if (p.length >= 4) { snapshot(); for (let i = 0; i + 3 < p.length; i += 2) st.f.silk.push({ t: "line", x1: p[i], y1: p[i + 1], x2: p[i + 2], y2: p[i + 3] }); }
    render();
  }
  function wheel(e) {
    e.preventDefault();
    const [x, y] = raw(e), v = st.view, k = e.deltaY > 0 ? 1.2 : 1 / 1.2, w = Math.min(400, Math.max(2, v[2] * k)), s = w / v[2];
    st.view = [x - (x - v[0]) * s, y - (y - v[1]) * s, w, v[3] * s]; st.zoomed = true; render(true);
  }

  // ---- drawing ----
  function shapes(f, selected) {
    const on = (k, i) => (selected && selected.k === k && selected.i === i ? " on" : "");
    let out = "";
    (f.silk || []).forEach((g, i) => {
      out += g.t === "line" ? `<g data-k="silk" data-i="${i}" class="silk${on("silk", i)}"><line x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/><line class="grab" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/></g>`
        : `<g data-k="silk" data-i="${i}" class="silk${on("silk", i)}"><circle cx="${g.x}" cy="${g.y}" r="${g.r}"/><circle class="grab" cx="${g.x}" cy="${g.y}" r="${g.r}"/></g>`;
    });
    (f.pads || []).forEach((p, i) => {
      const cls = `${p.smd ? (p.back ? "back" : "smd") : "tht"}`, fs = Math.max(0.25, Math.min(p.w, p.h) * 0.55 / Math.max(1, String(p.num).length * 0.62));
      out += `<g data-k="pad" data-i="${i}" class="pad ${cls}${on("pad", i)}">` + (p.shape === "rect" ? `<rect x="${p.x - p.w / 2}" y="${p.y - p.h / 2}" width="${p.w}" height="${p.h}"/>` : `<ellipse cx="${p.x}" cy="${p.y}" rx="${p.w / 2}" ry="${p.h / 2}"/>`)
        + (p.drill ? `<circle class="drill" cx="${p.x}" cy="${p.y}" r="${p.drill / 2}"/>` : "") + `<text x="${p.x}" y="${p.y}" font-size="${r3(fs)}" text-anchor="middle" dominant-baseline="central">${esc(p.num)}</text></g>`;
    });
    (f.holes || []).forEach((h, i) => { out += `<g data-k="hole" data-i="${i}" class="hole${on("hole", i)}"><circle cx="${h.x}" cy="${h.y}" r="${h.d / 2}"/><path d="M${h.x - h.d / 4} ${h.y}H${h.x + h.d / 4}M${h.x} ${h.y - h.d / 4}V${h.y + h.d / 4}"/></g>`; });
    return out;
  }
  function extent(f) {
    let x1 = -2, y1 = -2, x2 = 2, y2 = 2;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    f.pads.forEach(p => { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); });
    f.silk.forEach(g => { if (g.t === "line") { add(g.x1, g.y1); add(g.x2, g.y2); } else { add(g.x - g.r, g.y - g.r); add(g.x + g.r, g.y + g.r); } });
    f.holes.forEach(h => { add(h.x - h.d / 2, h.y - h.d / 2); add(h.x + h.d / 2, h.y + h.d / 2); });
    return [x1, y1, x2, y2];
  }
  function render(light) {
    const f = st.f;
    if (!st.view || (!light && !st.zoomed)) { const b = extent(f), w = (b[2] - b[0]) * 1.25 + 3, h = (b[3] - b[1]) * 1.25 + 3, s = Math.max(w, h * 1.3); st.view = [(b[0] + b[2]) / 2 - s / 2, (b[1] + b[3]) / 2 - s / 2.6, s, s / 1.3]; st.zoomed = false; }
    const v = st.view, d = st.draft, g = st.grid, px = v[2] / 600;         // about one screen pixel, in mm
    let draft = "";
    if (d && d.k === "line") { const pts = []; for (let k = 0; k + 1 < d.pts.length; k += 2) pts.push(d.pts[k] + "," + d.pts[k + 1]); draft = `<polyline class="draft" points="${pts.join(" ")}"/>`; }
    else if (d && d.k === "rect") draft = `<rect class="draft" x="${Math.min(d.x, d.x2)}" y="${Math.min(d.y, d.y2)}" width="${Math.abs(d.x2 - d.x)}" height="${Math.abs(d.y2 - d.y)}"/>`;
    else if (d && d.k === "circle") draft = `<circle class="draft" cx="${d.x}" cy="${d.y}" r="${Math.hypot(d.x2 - d.x, d.y2 - d.y)}"/>`;
    const svg = $("fped-svg");
    svg.setAttribute("viewBox", v.map(r3).join(" "));
    svg.style.setProperty("--px", px);
    // the grid's dots, left out where they would run together
    const dots = g / px >= 7 ? `<defs><pattern id="fped-dots" x="${-g / 2}" y="${-g / 2}" width="${g}" height="${g}" patternUnits="userSpaceOnUse"><circle cx="${g / 2}" cy="${g / 2}" r="${px * 0.9}" class="dot"/></pattern></defs><rect x="${v[0]}" y="${v[1]}" width="${v[2]}" height="${v[3]}" fill="url(#fped-dots)"/>` : "";
    svg.innerHTML = dots + `<path class="axis" d="M${v[0]} 0H${v[0] + v[2]}M0 ${v[1]}V${v[1] + v[3]}"/>` + shapes(f, st.sel) + draft;
    svg.dataset.tool = st.tool;
    if (light) return;
    $("fped-tools").querySelectorAll("[data-tool]").forEach(x => { x.classList.toggle("active", x.dataset.tool === st.tool); x.setAttribute("aria-pressed", x.dataset.tool === st.tool); });
    $("fped-undo").disabled = !st.undo.length; $("fped-del").disabled = !st.sel; $("fped-gridsel").value = String(st.grid);
    if (document.activeElement !== $("fped-name")) $("fped-name").value = f.name || "";
    if (document.activeElement !== $("fped-desc")) $("fped-desc").value = f.title || "";
    props(); padTable(); patForm(); check();
  }
  function field(label, html, tip) { return `<label class="symed-f"${tip ? ` title="${esc(tip)}"` : ""}><span>${label}</span>${html}</label>`; }
  const mm = (id, v) => `<input type="text" inputmode="decimal" id="${id}" value="${r3(v)}">`;
  const kindOf = p => (p.smd ? (p.back ? "back" : "smd") : "tht");
  function padFields(p, kind) {
    return field("Mounting", `<select id="fped-kind">${KINDS.map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select>`) + field("Shape", `<select id="fped-shape"><option value="circle">Round</option><option value="rect">Rectangular</option></select>`)
      + field("Width", mm("fped-w", p.w), "Across, in millimetres") + field("Height", mm("fped-h", p.h), "Up and down, in millimetres") + (kind === "tht" ? field("Hole", mm("fped-drill", p.drill), "The drilled hole's diameter: the lead plus about 0.2 mm") : "");
  }
  function props() {
    const host = $("fped-props"), sel = st.sel, d = st.def;
    const bind = (id, fn) => { const el = $(id); if (!el) return; el.onchange = () => { snapshot(); fn(el.value); render(); }; };
    if (!sel) {
      if (st.tool === "hole") { host.innerHTML = `<div class="insp-sub">New holes</div>` + field("Diameter", mm("fped-hd", d.hole)); $("fped-hd").onchange = () => { d.hole = Math.max(0.2, num($("fped-hd").value)); render(); }; return; }
      if (st.tool !== "pad") { host.innerHTML = `<p class="insp-help">Millimetres, seen from the top of the board; x grows to the right, y downwards. The cross is the footprint's centre: the part turns about it. The wheel zooms.</p>`; return; }
      host.innerHTML = `<div class="insp-sub">New pads</div>` + padFields(d, d.kind);
      $("fped-kind").value = d.kind; $("fped-shape").value = d.shape;
      const set = (id, fn) => { const el = $(id); if (el) el.onchange = () => { fn(el.value); render(); }; };
      set("fped-kind", v => { d.kind = v; if (v !== "tht" && d.shape === "circle") d.shape = "rect"; }); set("fped-shape", v => { d.shape = v; });
      set("fped-w", v => { d.w = Math.max(0.1, num(v)); }); set("fped-h", v => { d.h = Math.max(0.1, num(v)); }); set("fped-drill", v => { d.drill = Math.max(0.1, num(v)); });
      return;
    }
    const o = list(sel.k)[sel.i];
    if (sel.k === "pad") {
      const kind = kindOf(o);
      host.innerHTML = `<div class="insp-sub">Pad</div>` + field("Number", `<input type="text" id="fped-num" value="${esc(o.num)}" maxlength="6">`, "The pin of this number goes to this pad. The same number on several pads joins them.") + field("X", mm("fped-x", o.x)) + field("Y", mm("fped-y", o.y)) + padFields(o, kind);
      $("fped-kind").value = kind; $("fped-shape").value = o.shape === "rect" ? "rect" : "circle";
      bind("fped-num", v => { o.num = v.trim(); }); bind("fped-x", v => { o.x = num(v); }); bind("fped-y", v => { o.y = num(v); });
      bind("fped-kind", v => { if (v === "tht") { delete o.smd; delete o.back; o.drill = o.drill || st.def.drill; } else { o.smd = true; o.drill = 0; if (v === "back") o.back = true; else delete o.back; } });
      bind("fped-shape", v => { o.shape = v; }); bind("fped-w", v => { o.w = Math.max(0.1, num(v)); }); bind("fped-h", v => { o.h = Math.max(0.1, num(v)); }); bind("fped-drill", v => { o.drill = Math.max(0.1, num(v)); });
      // the next pads are made like the one last looked at
      Object.assign(st.def, { kind, shape: o.shape === "rect" ? "rect" : "circle", w: o.w, h: o.h }, o.drill ? { drill: o.drill } : {});
    } else if (sel.k === "hole") {
      host.innerHTML = `<div class="insp-sub">Mounting hole</div>` + field("X", mm("fped-x", o.x)) + field("Y", mm("fped-y", o.y)) + field("Diameter", mm("fped-hd", o.d));
      bind("fped-x", v => { o.x = num(v); }); bind("fped-y", v => { o.y = num(v); }); bind("fped-hd", v => { o.d = Math.max(0.2, num(v)); });
    } else if (o.t === "circle") {
      host.innerHTML = `<div class="insp-sub">Silkscreen circle</div>` + field("X", mm("fped-x", o.x)) + field("Y", mm("fped-y", o.y)) + field("Radius", mm("fped-r", o.r));
      bind("fped-x", v => { o.x = num(v); }); bind("fped-y", v => { o.y = num(v); }); bind("fped-r", v => { o.r = Math.max(0.05, num(v)); });
    } else {
      host.innerHTML = `<div class="insp-sub">Silkscreen line</div>` + field("From X", mm("fped-x1", o.x1)) + field("From Y", mm("fped-y1", o.y1)) + field("To X", mm("fped-x2", o.x2)) + field("To Y", mm("fped-y2", o.y2));
      ["x1", "y1", "x2", "y2"].forEach(k => bind("fped-" + k, v => { o[k] = num(v); }));
    }
  }
  function padTable() {
    const f = st.f, host = $("fped-pads");
    if (document.activeElement && host.contains(document.activeElement)) return;      // being typed in
    host.innerHTML = f.pads.length ? `<table class="symed-table fped-table"><thead><tr><th>No.</th><th>X</th><th>Y</th><th></th></tr></thead><tbody>${f.pads.map((p, i) => `<tr data-i="${i}" class="${st.sel && st.sel.k === "pad" && st.sel.i === i ? "on" : ""}"><td><input type="text" data-f="num" value="${esc(p.num)}" maxlength="6" aria-label="Pad number"></td><td><input type="text" inputmode="decimal" data-f="x" value="${r3(p.x)}" aria-label="X, mm"></td><td><input type="text" inputmode="decimal" data-f="y" value="${r3(p.y)}" aria-label="Y, mm"></td><td><button type="button" class="btn" title="Remove the pad" aria-label="Remove the pad">×</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="insp-help">No pads yet: take the Pad tool and click where each goes, or make a usual package below.</p>`;
    host.querySelectorAll("tr[data-i]").forEach(tr => {
      const i = +tr.dataset.i;
      tr.querySelectorAll("input").forEach(inp => {
        inp.onfocus = () => { st.sel = { k: "pad", i }; st.tool = "select"; render(true); props(); snapshot(); };
        inp.oninput = () => { const k = inp.dataset.f; f.pads[i][k] = k === "num" ? inp.value.trim() : num(inp.value); render(true); check(); };
        inp.onblur = () => { setTimeout(() => { if (st && !host.contains(document.activeElement)) render(); }, 0); };
      });
      tr.querySelector("button").onclick = () => { snapshot(); f.pads.splice(i, 1); st.sel = null; render(); };
    });
  }
  const PAT_FIELDS = [["n", "Pads", "How many pads in all"], ["pitch", "Pitch", "From one pad to the next in a row, mm"], ["row", "Between rows", "From the centres of one row to the centres of the opposite one, mm"], ["w", "Pad along the row", "mm"], ["h", "Pad across", "mm"], ["drill", "Hole", "The drilled hole's diameter, mm (0: surface pads)"]];
  function patForm() {
    const host = $("fped-patform"), P = root.PartLib.PATTERNS, pat = st.pat;
    if (document.activeElement && host.contains(document.activeElement)) return;
    const use = k => !(k === "row" && (pat.kind === "sip" || pat.kind === "two")) && !(k === "drill" && (pat.kind === "soic" || pat.kind === "quad")) && !(k === "n" && pat.kind === "two");
    host.innerHTML = field("Package", `<select id="fped-pkind">${Object.keys(P).map(k => `<option value="${k}">${esc(P[k].name)}</option>`).join("")}</select>`) + PAT_FIELDS.filter(([k]) => use(k)).map(([k, n, t]) => field(n, `<input type="text" inputmode="decimal" id="fped-p-${k}" value="${esc(pat[k])}">`, t)).join("");
    $("fped-pkind").value = pat.kind;
    $("fped-pkind").onchange = () => { const k = $("fped-pkind").value, n = pat.kind !== "two" && k !== "two" ? pat.n : P[k].n; st.pat = Object.assign({ kind: k }, P[k], { n: k === "quad" ? Math.max(4, Math.round(n / 4) * 4) : n }); delete st.pat.name; patForm(); };
    PAT_FIELDS.forEach(([k]) => { const el = $("fped-p-" + k); if (el) el.oninput = () => { pat[k] = el.value; }; });
  }
  // what stops the footprint from being saved, and what is only worth knowing
  function problems() {
    const f = clone(st.f), out = root.PartLib.fpTidy(f).filter(w => !/no copper/.test(w)), name = f.name.toLowerCase();
    if (name && (st.taken || []).some(n => String(n).toLowerCase() === name)) out.push(`Another footprint is called ${f.name}`);
    return out;
  }
  function notes() {
    const f = clone(st.f), out = root.PartLib.fpTidy(f).filter(w => /no copper/.test(w)), have = new Set(f.pads.map(p => p.num));
    const miss = (st.pins || []).map(String).filter(n => !have.has(n));
    if (miss.length && f.pads.length) out.push(`No pad for pin ${miss.slice(0, 12).join(", ")}${miss.length > 12 ? "…" : ""} of the part`);
    return out;
  }
  function check() { const why = problems(), all = why.concat(notes()); $("fped-msg").textContent = all.length ? "⚠ " + all.join(". ") + "." : ""; $("fped-ok").disabled = !!why.length; $("fped-ok").title = why.join(". "); return !why.length; }
  function result() { const f = clone(st.f); root.PartLib.fpTidy(f); return f; }
  function done() { if (!check()) return; const r = result(), cb = onDone; close(); if (cb) cb(r); }
  function close() { $("fped-modal").hidden = true; st = null; onDone = null; }
  /** Edit a footprint (a copy); cb(footprint) on Save.
      o: { pins: the part's pin numbers (pads are numbered after them, a missing one is named),
           taken: names other footprints have, used: how many parts use this one } */
  function open(fp, cb, o) {
    if (!$("fped-modal")) build();
    const P = root.PartLib, f = clone(fp && Array.isArray(fp.pads) ? fp : P.fpPattern("dip", {}, "New footprint"));
    f.silk = f.silk || []; f.holes = f.holes || []; f.title = String(f.title || "").replace(/ \(from KiCad\)$/, "");
    const first = f.pads[0], pk = f.pads.length === 2 ? "two" : first && first.smd ? "soic" : "dip";
    st = { f, tool: "select", sel: null, draft: null, drag: null, pan: null, undo: [], view: null, zoomed: false, grid: 1.27, pins: (o && o.pins) || [], taken: (o && o.taken) || [],
      def: { kind: "tht", shape: "circle", w: 1.6, h: 1.6, drill: 0.8, hole: 3.2 },
      pat: Object.assign({ kind: pk }, P.PATTERNS[pk], pk === "two" ? {} : { n: Math.max(pk === "dip" ? 4 : 2, f.pads.length + (f.pads.length % 2)) }) };
    adopt();
    delete st.pat.name;
    onDone = cb;
    $("fped-title").textContent = `Footprint${o && o.used > 1 ? `: ${o.used} parts use it` : ""}`;
    $("fped-pos").textContent = ""; $("fped-pat").open = false;
    document.body.appendChild($("fped-modal")); $("fped-modal").hidden = false;
    render(); $("fped-svg").focus();
  }
  root.FootprintEditor = { open, close, state: () => st, result: () => (st ? result() : null), shapes };
})(typeof window !== "undefined" ? window : globalThis);
