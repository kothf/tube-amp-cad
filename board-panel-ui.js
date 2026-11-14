/* Board Design: the Panel dialog (Export ▾ → Panel…). The boards on the panel (this board and
   others read from their Gerber ZIPs), the way they come apart (mouse bites or V-score), rails,
   fiducials and tooling holes, a live picture of the panel and its Gerber ZIP.
   The settings and the other boards are kept in the board document (board.panel), outside the
   undo history (a panel's boards can be big); BoardPanel (board-panelize.js) does the work. */
(function (root) {
  "use strict";
  function BoardPanelUI(ctx) {
    const { $, S, save, msg, esc, download, fabMeta, fabReady } = ctx;
    const BP = root.BoardPanel, F = root.BoardFab;
    let thisPiece = null, thisKey = null, timer = 0;
    const panel = () => (S.board.panel = BP.normalise(S.board.panel));
    // this board as a piece, made again when the board changed
    function current() {
      if (!S.model) return null;
      const key = S.history ? S.history[S.hIndex] : null;
      if (thisPiece && key === thisKey) return thisPiece;
      try { thisPiece = BP.pieceOfBoard(S.board, S.model, S.fills, fabMeta()); thisKey = key; } catch (e) { thisPiece = null; }
      return thisPiece;
    }
    const pieces = () => { const p = panel(), out = { ...p.pieces }; const t = current(); if (t) out.this = t; return out; };
    function open() {
      if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return; }
      panel(); thisKey = null;
      fill(); draw();
      $("panel-modal").hidden = false;
    }
    // the form from the settings
    function fill() {
      const p = panel();
      document.querySelectorAll("#panel-modal [data-p]").forEach(el => {
        const k = el.dataset.p;
        if (el.type === "checkbox") el.checked = !!p[k]; else el.value = p[k];
      });
      document.querySelectorAll("#panel-modal [data-bites]").forEach(el => { el.hidden = p.mode !== "bites"; });
      const all = pieces();
      $("panel-items").innerHTML = p.items.map((it, i) => {
        const pc = all[it.src], name = it.src === "this" ? "This board" : pc ? pc.name : "(missing)";
        return `<tr data-i="${i}"><td title="${esc(name)}">${esc(name)}</td><td>${pc ? `${pc.w} × ${pc.h}` : "–"}</td>
          <td><input class="cell" data-f="rows" value="${it.rows}" title="Copies down"></td><td><input class="cell" data-f="cols" value="${it.cols}" title="Copies across"></td>
          <td><select data-f="rot" title="Turned clockwise">${[0, 1, 2, 3].map(k => `<option value="${k}"${k === it.rot ? " selected" : ""}>${k * 90}°</option>`).join("")}</select></td>
          <td><button class="btn" data-del="${i}" title="Take this board off the panel">×</button></td></tr>`;
      }).join("") || `<tr><td colspan="6" class="mut">No boards: add this board or another's Gerbers.</td></tr>`;
      $("panel-add-this").hidden = p.items.some(it => it.src === "this");
    }
    // the settings from the form, saved with the board
    function read() {
      const p = panel();
      document.querySelectorAll("#panel-modal [data-p]").forEach(el => { const k = el.dataset.p; p[k] = el.type === "checkbox" ? el.checked : el.value; });
      document.querySelectorAll("#panel-items tr[data-i]").forEach(tr => {
        const it = p.items[+tr.dataset.i]; if (!it) return;
        tr.querySelectorAll("[data-f]").forEach(el => { it[el.dataset.f] = +el.value; });
      });
      S.board.panel = BP.normalise(p);
      save();
    }
    function changed() { read(); clearTimeout(timer); timer = setTimeout(() => { fill(); draw(); }, 120); }

    // the picture: top copper, silkscreen, the edge with its tabs, holes, fiducials, V-score
    function draw() {
      const cv = $("panel-canvas"), lay = BP.layout(panel(), pieces());
      const out = $("panel-out");
      const lines = [];
      if (lay.boards.length) lines.push(`<b>${lay.W} × ${lay.H} mm</b>, ${lay.boards.length} board${lay.boards.length > 1 ? "s" : ""}${lay.P.mode === "bites" ? `, ${lay.tabs.length} tabs, ${lay.bites.length} mouse-bite holes` : `, ${lay.vscore.length} V-score lines`}${lay.fids.length ? `, ${lay.fids.length} fiducials` : ""}${lay.tools.length ? `, ${lay.tools.length} tooling holes` : ""}.`);
      lay.errors.forEach(e => lines.push(`<span class="bad">${esc(e)}</span>`));
      lay.warnings.forEach(w => lines.push(`<span class="warnc">${esc(w)}</span>`));
      out.innerHTML = lines.join("<br>");
      $("panel-export").disabled = !!lay.errors.length;
      const dpr = root.devicePixelRatio || 1, cw = cv.clientWidth || 520, ch = cv.clientHeight || 360;
      cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
      const c = cv.getContext("2d");
      c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = "#0b1118"; c.fillRect(0, 0, cv.width, cv.height);
      if (!lay.boards.length) return;
      const k = Math.min((cw - 20) / lay.W, (ch - 20) / lay.H) * dpr;
      c.setTransform(k, 0, 0, k, (cv.width - lay.W * k) / 2, (cv.height - lay.H * k) / 2);
      // the panel's material
      c.fillStyle = "#1d3b2a"; c.fillRect(0, 0, lay.W, lay.H);
      lay.boards.forEach(b => {
        F.paint(c, b.pc.layers["B.Cu"] || [], "rgba(80,140,220,0.35)", "#1d3b2a");
        F.paint(c, b.pc.layers["F.Cu"] || [], "#c8763a", "#1d3b2a");
        F.paint(c, (b.pc.layers["F.SilkS"] || []).filter(op => op.pol !== "C"), "rgba(240,240,240,0.8)", "#1d3b2a");
        c.fillStyle = "#0b1118";
        (b.pc.drills.pth || []).concat(b.pc.drills.npth || []).forEach(([d, pts]) => pts.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, +d / 2, 0, Math.PI * 2); c.fill(); }));
      });
      // routed away: what lies between the boards (the gap) shows dark, so the tabs stand out
      if (lay.P.mode === "bites") {
        c.save(); c.fillStyle = "rgba(11,17,24,0.85)";
        lay.boards.forEach(b => {
          const g = lay.P.gap; c.beginPath(); c.rect(b.x - g, b.y - g, b.w + 2 * g, b.h + 2 * g);
          b.pc.loops.forEach(L => { L.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); });
          c.fill("evenodd");
        });
        c.fillStyle = "#1d3b2a";
        lay.tabs.forEach(t => { c.beginPath(); [t.p1, t.q1, t.q2, t.p2].forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.closePath(); c.fill(); });
        c.restore();
      }
      c.strokeStyle = "#e3c341"; c.lineWidth = Math.max(0.15, 1.2 / k * dpr); c.lineCap = "round";
      lay.edges.forEach(L => { c.beginPath(); L.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); c.stroke(); });
      c.fillStyle = "#0b1118";
      lay.bites.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, lay.P.biteD / 2, 0, Math.PI * 2); c.fill(); });
      lay.tools.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, lay.P.toolD / 2, 0, Math.PI * 2); c.fill(); });
      lay.fids.forEach(([x, y]) => { c.fillStyle = "#0b1118"; c.beginPath(); c.arc(x, y, lay.P.fidMask / 2, 0, Math.PI * 2); c.fill(); c.fillStyle = "#e0a060"; c.beginPath(); c.arc(x, y, lay.P.fidD / 2, 0, Math.PI * 2); c.fill(); });
      if (lay.vscore.length) { c.save(); c.strokeStyle = "#ff6b6b"; c.setLineDash([2, 1.2]); lay.vscore.forEach(L => { c.beginPath(); c.moveTo(L[0][0], L[0][1]); c.lineTo(L[1][0], L[1][1]); c.stroke(); }); c.restore(); }
      // each board's number, for the placement file's references (R1-2: R1 on board 2)
      if (lay.boards.length > 1) { c.fillStyle = "rgba(255,255,255,0.7)"; c.font = `${Math.max(3, Math.min(8, lay.boards[0].h / 8))}px system-ui, sans-serif`; c.textAlign = "left"; c.textBaseline = "top"; lay.boards.forEach((b, i) => c.fillText(String(i + 1), b.x + 1.5, b.y + 1.5)); }
    }
    function exportZip() {
      const p = panel();
      if (p.items.some(it => it.src === "this") && !fabReady("Panel Gerbers")) return;
      const meta = { ...fabMeta(), date: new Date().toISOString().slice(0, 10) }, r = BP.files(p, pieces(), meta);
      if (!r.files) { msg(r.lay.errors[0] || "Nothing on the panel"); return; }
      download(F.zip(r.files), meta.base + "-panel-gerbers.zip", "application/zip");
    }
    async function addZip(file) {
      try {
        const files = /\.zip$/i.test(file.name) ? await BP.unzip(new Uint8Array(await file.arrayBuffer())) : { [file.name]: await file.text() };
        const name = file.name.replace(/\.zip$/i, "").replace(/[-_](gerbers?|fab|manufacturing)$/i, "");
        const pc = BP.pieceFromFiles(files, name), p = panel(), id = "p" + Date.now().toString(36);
        const size = JSON.stringify(pc).length;
        p.pieces[id] = pc; p.items.push({ src: id, rows: 1, cols: 1, rot: 0 });
        S.board.panel = BP.normalise(p); save();
        msg(`${name}: ${pc.w} × ${pc.h} mm, ${pc.copper.length} layers added to the panel${pc.warnings && pc.warnings.length ? " (" + pc.warnings[0] + ")" : ""}${size > 1.5e6 ? " · it is big and makes the circuit file bigger" : ""}`);
        fill(); draw();
      } catch (e) { msg(`Could not read ${file.name}: ${e.message || e}`); }
    }
    function init() {
      $("ex-panel").onclick = () => { const l = $("ex-panel").closest(".menu-list"); if (l) l.hidden = true; open(); };
      $("panel-close").onclick = () => { $("panel-modal").hidden = true; };
      $("panel-export").onclick = exportZip;
      $("panel-add-this").onclick = () => { const p = panel(); p.items.unshift({ src: "this", rows: 1, cols: 1, rot: 0 }); S.board.panel = BP.normalise(p); save(); fill(); draw(); };
      $("panel-add-zip").onclick = () => $("panel-file").click();
      $("panel-file").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) addZip(f); };
      const m = $("panel-modal");
      m.addEventListener("change", e => { if (e.target.closest("[data-p], [data-f]")) changed(); });
      m.addEventListener("click", e => {
        const d = e.target.closest("[data-del]"); if (!d) return;
        const p = panel(), it = p.items.splice(+d.dataset.del, 1)[0];
        if (it && it.src !== "this" && !p.items.some(x => x.src === it.src)) delete p.pieces[it.src];
        S.board.panel = BP.normalise(p); save(); fill(); draw();
      });
      root.addEventListener("resize", () => { if (!m.hidden) draw(); });
    }
    return { open, init, draw, layout: () => BP.layout(panel(), pieces()), files: meta => BP.files(panel(), pieces(), meta || fabMeta()), addFiles: (files, name) => { const pc = BP.pieceFromFiles(files, name), p = panel(), id = "p" + Date.now().toString(36); p.pieces[id] = pc; p.items.push({ src: id, rows: 1, cols: 1, rot: 0 }); S.board.panel = BP.normalise(p); save(); fill(); draw(); return id; } };
  }
  root.BoardPanelUI = BoardPanelUI;
})(typeof window !== "undefined" ? window : globalThis);
