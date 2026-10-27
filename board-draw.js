/* The Board window's drawing (millimetres, scaled by the view): the board and its outline, pours,
   tracks, pads, vias, texts, holes, keep-outs, ratsnest, rule markers, the route and measure in
   progress, the selection with its handles, the drawing sheet, the grid and axes. render() asks for
   one frame; nothing redraws on its own (no animation loop). */
(function (root) {
  "use strict";
  // app: what this part needs from board-app.js; returns what board-app.js uses of it
  root.BoardDraw = function (app) {
    const { $, B, COLORS, NOTE, S, classOf, errors, isSel, netOfTrack, partBox, routeTail, sheetPlace, snap, snapPoint, snapY, trackSelected } = app;
    let canvas = null, ctx = null, dpr = 1, queued = false;
    // the board's canvas, from init
    function attachCanvas(cv) { canvas = cv; ctx = cv.getContext("2d"); dpr = window.devicePixelRatio || 1; }
    function render() { if (queued) return; queued = true; requestAnimationFrame(draw); }
    function outlinePath(c, o) {
      const r = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2));
      c.beginPath(); c.moveTo(r, 0); c.lineTo(o.w - r, 0); c.arcTo(o.w, 0, o.w, r, r); c.lineTo(o.w, o.h - r); c.arcTo(o.w, o.h, o.w - r, o.h, r);
      c.lineTo(r, o.h); c.arcTo(0, o.h, 0, o.h - r, r); c.lineTo(0, r); c.arcTo(0, 0, r, 0, r); c.closePath();
    }
    // texts in the stroke font the Gerbers use
    function drawText(t, color) {
      const st = B.strokeText(t.text, t.x, t.y, t.size, t.rot, t.layer.startsWith("B"));
      ctx.strokeStyle = color; ctx.lineWidth = st.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
      st.lines.forEach(l => { ctx.beginPath(); l.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
    }
    // a copper layer's pours, painted apart (their clearances cut only the pour) and laid on the board
    let pourCanvas = null;
    function drawPours(layer, alpha) {
      const fs = S.fills.filter(f => f.layer === layer && !f.tear); if (!fs.length) return;
      if (!pourCanvas) pourCanvas = document.createElement("canvas");
      if (pourCanvas.width !== canvas.width || pourCanvas.height !== canvas.height) { pourCanvas.width = canvas.width; pourCanvas.height = canvas.height; }
      const pc = pourCanvas.getContext("2d"), { scale, ox, oy } = S.view;
      pc.setTransform(1, 0, 0, 1, 0, 0); pc.clearRect(0, 0, pourCanvas.width, pourCanvas.height);
      pc.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      fs.forEach(f => BoardFab.paint(pc, f.ops, COLORS[layer], "erase"));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha; ctx.drawImage(pourCanvas, 0, 0); ctx.restore();
    }
    const selColor = (kind, i, c) => (isSel(kind, i) ? "#00e5ff" : c);
    function draw() {
      queued = false;
      const W = canvas.clientWidth, H = canvas.clientHeight;
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = "#070b10"; ctx.fillRect(0, 0, W, H);
      const { scale, ox, oy } = S.view, sheet = sheetPlace();
      // the paper of the drawing sheet, then the grid over the whole screen, then the sheet's frame
      if (sheet) { ctx.fillStyle = "#0c121b"; ctx.fillRect(ox + sheet.x * scale, oy + sheet.y * scale, sheet.w * scale, sheet.h * scale); }
      drawGrid(W, H);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      const px = 1 / scale, o = S.board.outline;
      if (sheet) { ctx.save(); ctx.translate(sheet.x, sheet.y); ctx.scale(1 / sheet.MM, 1 / sheet.MM); CadLib.DRAW.frame(ctx, { params: sheet.params }); ctx.restore(); }
      if (S.axes) axisLines(W, H);
      outlinePath(ctx, o); ctx.fillStyle = "#0c1712"; ctx.fill();
      if (S.show["Edge.Cuts"]) { ctx.strokeStyle = COLORS["Edge.Cuts"]; ctx.lineWidth = Math.max(0.15, 1.2 * px); ctx.stroke(); }
      // copper: the inactive layer dimmed underneath, the active one on top
      const order = S.layer === "F.Cu" ? ["B.Cu", "F.Cu"] : ["F.Cu", "B.Cu"];
      const NH = S.netHL, hl = NH !== null ? NH : S.hover !== null && S.hover !== undefined ? S.hover : S.route ? S.route.net : null;
      order.forEach(layer => {
        if (!S.show[layer]) return;
        const base = layer === S.layer ? 0.92 : S.dim;
        if (S.show.zones) drawPours(layer, (layer === S.layer ? 0.5 : S.dim * 0.55) * (NH !== null ? 0.4 : 1));
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        // teardrops, in the track's colour
        S.fills.forEach(f => {
          if (!f.tear || f.layer !== layer || !S.board.tracks[f.ti]) return;
          const sel = trackSelected(f.ti), lit = hl !== null && f.net === hl;
          ctx.globalAlpha = NH !== null && !lit && !sel ? base * 0.25 : base; ctx.fillStyle = sel ? "#00e5ff" : COLORS[layer];
          ctx.beginPath(); f.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill();
        });
        S.board.tracks.forEach((t, i) => {
          if (t.layer !== layer) return;
          const sel = trackSelected(i), n = netOfTrack(i), lit = hl !== null && n === hl;
          ctx.globalAlpha = NH !== null && !lit && !sel ? base * 0.25 : base;
          ctx.strokeStyle = sel ? "#00e5ff" : COLORS[layer]; ctx.lineWidth = t.w;
          ctx.beginPath(); t.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
          if (lit && !sel) { ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = t.w * 0.35; ctx.stroke(); }
        });
        ctx.globalAlpha = base;
        S.board.texts.forEach((t, i) => { if (t.layer === layer) drawText(t, selColor("text", i, COLORS[layer])); });
        ctx.globalAlpha = 1;
      });
      // silkscreen: bottom first (mirrored footprints), then top. Each part's value (a screen note, not
      // silkscreen) goes inside its outline when it fits, else under it, and only where it covers no
      // reference and no other value
      const silk = new Map(), taken = [];
      const overlaps = r => taken.some(t => r.x1 < t.x2 && r.x2 > t.x1 && r.y1 < t.y2 && r.y2 > t.y1);
      if (S.model) S.model.parts.forEach(g => {
        if (!g.place) return;
        const ops = BoardFab.partSilk(g, S.board.outline); silk.set(g.key, ops);
        ops.filter(o => o.ref).forEach(o => { const xs = o.pts.map(q => q[0]), ys = o.pts.map(q => q[1]); taken.push({ x1: Math.min(...xs) - 0.3, y1: Math.min(...ys) - 0.3, x2: Math.max(...xs) + 0.3, y2: Math.max(...ys) + 0.3 }); });
      });
      ["B", "F"].forEach(side => {
        const L = side + ".SilkS"; if (!S.show[L]) return;
        S.board.texts.forEach((t, i) => { if (t.layer === L) drawText(t, selColor("text", i, COLORS[L])); });
        if (S.model) S.model.parts.forEach(g => {
          if (!g.place || (g.place.side || "F") !== side) return;
          const sel = isSel("part", g.key);
          // the silkscreen as it will be made (outline and reference in the stroke font)
          const ops = (silk.get(g.key) || BoardFab.partSilk(g, S.board.outline)).map(o => (o.t === "line" && px > 0.15 ? { ...o, w: Math.max(o.w, px) } : o));
          BoardFab.paint(ctx, ops, sel ? "#00e5ff" : COLORS[L], "erase");
          const b = partBox(g);
          if (scale > 6 && g.value) {
            const fh = Math.max(1, 9 * px); ctx.font = `${fh}px ui-monospace, monospace`;
            const tw = ctx.measureText(g.value).width, cx = (b.x1 + b.x2) / 2, inside = tw <= (b.x2 - b.x1) * 0.9 && fh <= (b.y2 - b.y1) * 0.5;
            const ty = inside ? (b.y1 + b.y2) / 2 + (g.type === "tube" ? (b.y2 - b.y1) * 0.27 : fh * 0.6) : b.y2 + 0.3, r = { x1: cx - tw / 2, x2: cx + tw / 2, y1: inside ? ty - fh / 2 : ty, y2: inside ? ty + fh / 2 : ty + fh };
            if (!overlaps(r)) { taken.push(r); ctx.fillStyle = "#8b949e"; ctx.textAlign = "center"; ctx.textBaseline = inside ? "middle" : "top"; ctx.fillText(g.value, cx, ty); }
          }
          if (!sel && S.hoverPart === g.key && S.tool === "select") { ctx.strokeStyle = "rgba(230,237,243,0.35)"; ctx.setLineDash([3 * px, 3 * px]); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.setLineDash([]); }
          if (sel) { ctx.strokeStyle = "rgba(0,229,255,0.6)"; ctx.setLineDash([4 * px, 3 * px]); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.setLineDash([]); }
        });
      });
      // pads (through-hole: on both layers; SMD: on their side's layer, when it is shown; the
      // bottom's SMD pads paler, under the rest) and vias, when any copper layer is shown
      if (S.model && (S.show["F.Cu"] || S.show["B.Cu"])) {
        const pads = S.model.pads.filter(p => !p.smd || S.show[p.layers[0]]).sort((a, b) => (b.smd && b.layers[0] === "B.Cu") - (a.smd && a.layers[0] === "B.Cu"));
        pads.forEach(p => {
          const lit = hl !== null && p.net === hl, under = p.smd && p.layers[0] === "B.Cu";
          ctx.fillStyle = p.conflict ? "#ff7b72" : lit ? "#ffe680" : NH !== null ? "#5c4a14" : under ? "#8f8a6a" : COLORS.pad;
          ctx.beginPath();
          if (p.shape === "rect") ctx.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h); else ctx.ellipse(p.x, p.y, p.w / 2, p.h / 2, 0, 0, Math.PI * 2);
          ctx.fill();
          if (!p.smd) { ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(p.x, p.y, p.drill / 2, 0, Math.PI * 2); ctx.fill(); }
          if (scale > 9) { ctx.fillStyle = "#0b0f14"; ctx.font = `${Math.min(p.w, p.h) * 0.42}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.name.length <= 3 ? p.name : p.num, p.x, p.y + p.drill * 0.9); }
        });
      }
      // the parts' own unplated holes (locating pegs): a bare hole with its copper clearance dashed
      if (S.model && S.show.Holes) (S.model.holes || []).forEach(h => {
        ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = COLORS.Holes; ctx.lineWidth = Math.max(0.12, px); ctx.stroke();
        ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2 + S.board.rules.clearance, 0, Math.PI * 2); ctx.setLineDash([2 * px, 2 * px]); ctx.stroke(); ctx.setLineDash([]);
      });
      if (S.show["F.Cu"] || S.show["B.Cu"]) S.board.vias.forEach((v, i) => {
        ctx.fillStyle = selColor("via", i, "#a9b4c2"); ctx.beginPath(); ctx.arc(v.x, v.y, (v.pad || S.board.rules.viaPad) / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(v.x, v.y, (v.drill || S.board.rules.viaDrill) / 2, 0, Math.PI * 2); ctx.fill();
      });
      // mounting holes, with their copper clearance dashed
      // a plated one: its copper ring, like a via's; a plain one: the copper clearance round it, dashed
      if (S.show.Holes) S.board.holes.forEach((h, i) => {
        if (h.plated) { ctx.fillStyle = selColor("hole", i, "#c9a95c"); ctx.beginPath(); ctx.arc(h.x, h.y, B.holeRing(h) / 2, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "#070b10"; ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = selColor("hole", i, COLORS.Holes); ctx.lineWidth = Math.max(0.12, px); ctx.stroke();
        if (!h.plated) { ctx.beginPath(); ctx.arc(h.x, h.y, h.d / 2 + S.board.rules.clearance, 0, Math.PI * 2); ctx.setLineDash([2 * px, 2 * px]); ctx.stroke(); ctx.setLineDash([]); }
      });
      if (S.show.rats && S.conn) {
        ctx.lineWidth = Math.max(0.08, 0.8 * px);
        S.conn.rats.forEach(r => { ctx.strokeStyle = NH === null ? "rgba(230,237,243,0.55)" : r.net === NH ? "rgba(255,230,128,0.95)" : "rgba(230,237,243,0.12)"; ctx.beginPath(); ctx.moveTo(r.x1, r.y1); ctx.lineTo(r.x2, r.y2); ctx.stroke(); });
      }
      // pour outlines (dashed), the selected one with its corner handles; a pour being drawn
      if (S.show.zones) S.board.zones.forEach((z, i) => {
        if (!S.show[z.layer]) return;
        const P = B.zonePoly(S.board, z), sel = S.sel && S.sel.kind === "zone" && S.sel.i === i;
        ctx.strokeStyle = sel ? "#00e5ff" : COLORS[z.layer]; ctx.lineWidth = Math.max(0.1, (sel ? 1.6 : 1) * px); ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath(); P.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        if (sel && z.pts) areaHandles(z.pts, px);
      });
      // keep-out areas: hatched, dashed orange
      if (S.show.keepouts) S.board.keepouts.forEach((k, i) => {
        if (!B.koLayers(k).some(l => S.show[l])) return;
        const P = k.pts, sel = S.sel && S.sel.kind === "keepout" && S.sel.i === i, col = sel ? "#00e5ff" : COLORS.keepouts;
        const xs = P.map(p => p[0]), ys = P.map(p => p[1]), x1 = Math.min(...xs), x2 = Math.max(...xs), y1 = Math.min(...ys), y2 = Math.max(...ys), step = Math.max(1.2, 9 * px);
        ctx.save(); ctx.beginPath(); P.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.clip();
        ctx.strokeStyle = col; ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.08, px); ctx.beginPath();
        for (let t = x1 - (y2 - y1); t < x2; t += step) { ctx.moveTo(t, y2); ctx.lineTo(t + (y2 - y1), y1); }
        ctx.stroke(); ctx.restore();
        ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.1, (sel ? 1.8 : 1.2) * px); ctx.setLineDash([6 * px, 4 * px]);
        ctx.beginPath(); P.forEach((p, n) => (n ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
        if (k.name) { ctx.fillStyle = col; ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(k.name, x1 + 3 * px, y1 + 3 * px); }
        if (sel) areaHandles(P, px);
      });
      // a padlock on locked parts and holes
      const lockMark = (x, y) => { const u = 4 * px; ctx.strokeStyle = "#9aa7b4"; ctx.fillStyle = "#9aa7b4"; ctx.lineWidth = Math.max(0.08, px); ctx.fillRect(x - u, y - u * 0.2, 2 * u, 1.5 * u); ctx.beginPath(); ctx.arc(x, y - u * 0.2, u * 0.65, Math.PI, 0); ctx.stroke(); };
      if (S.model) S.model.parts.forEach(g => { if (g.place && S.board.parts[g.key].locked) { const b = partBox(g), w = B.strokeText(g.ref, 0, 0, 1.27).width; lockMark((b.x1 + b.x2) / 2 + w / 2 + 1 + 5 * px, b.y1 - 0.4 - 0.9); } });
      if (S.show.Holes) S.board.holes.forEach(h => { if (h.locked) lockMark(h.x + h.d / 2 + 4 * px, h.y - h.d / 2); });
      // the selection box: solid when it takes what lies inside, dashed when it takes what it touches
      if (S.drag && S.drag.kind === "box" && S.drag.moved) {
        const d = S.drag, cross = d.x1 < d.x0; ctx.strokeStyle = cross ? "#7ee787" : "#58a6ff"; ctx.fillStyle = cross ? "rgba(126,231,135,0.08)" : "rgba(88,166,255,0.08)";
        ctx.lineWidth = px; ctx.setLineDash(cross ? [5 * px, 4 * px] : []); ctx.fillRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.strokeRect(d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0); ctx.setLineDash([]);
      }
      if (S.poly) {
        const pts = S.poly.concat([[snap(S.mouse[0]), snapY(S.mouse[1])]]);
        ctx.strokeStyle = S.tool === "keepout" ? COLORS.keepouts : COLORS[S.layer]; ctx.lineWidth = Math.max(0.1, 1.5 * px); ctx.setLineDash([5 * px, 4 * px]);
        ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (pts.length > 2) ctx.lineTo(pts[0][0], pts[0][1]); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = COLORS[S.layer]; S.poly.forEach(p => ctx.fillRect(p[0] - 2.5 * px, p[1] - 2.5 * px, 5 * px, 5 * px));
      }
      if (S.route) {
        const r = S.route, rt = routeTail(), tail = rt.pts, pts = r.pts.concat(tail.slice(1)), bad = rt.bad;
        const need = bad && bad.need ? bad.need : B.classRule(classOf(r.net), S.board.rules).clearance;
        ctx.lineCap = "round"; ctx.lineJoin = "round";
        // the clearance halo of the segments being placed: red when they come too close
        ctx.strokeStyle = bad ? "rgba(255,80,80,0.28)" : "rgba(0,229,255,0.13)"; ctx.lineWidth = r.w + 2 * need;
        ctx.beginPath(); tail.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
        ctx.strokeStyle = bad ? "#ff5050" : COLORS[r.layer]; ctx.globalAlpha = 0.75; ctx.lineWidth = r.w;
        ctx.beginPath(); pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); ctx.globalAlpha = 1;
        if (bad) {
          ctx.strokeStyle = "#ff5050"; ctx.lineWidth = Math.max(0.12, 1.5 * px); ctx.beginPath(); ctx.arc(bad.x, bad.y, Math.max(1, 8 * px), 0, Math.PI * 2); ctx.stroke();
          $("st-msg").textContent = `Too close to ${bad.what}${bad.net ? " (" + bad.net + ")" : ""}: ${Math.max(0, bad.g).toFixed(2)} < ${bad.need} mm — Shift+click places it anyway`;
        }
        r.segs.forEach(t => { ctx.strokeStyle = COLORS[t.layer]; ctx.lineWidth = t.w; ctx.beginPath(); t.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); });
      }
      // placement ghost for the via / hole / text tools
      if (["via", "hole", "text"].includes(S.tool) && !S.drag) {
        const x = snap(S.mouse[0]), y = snapY(S.mouse[1]), R = S.board.rules;
        ctx.globalAlpha = 0.5; ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, px);
        ctx.beginPath(); ctx.arc(x, y, S.tool === "via" ? R.viaPad / 2 : S.tool === "hole" ? 1.6 : 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
      }
      if (S.tool === "measure" && S.snapHint && !(S.measure && S.measure.b)) snapMark(S.snapHint, px);
      if (S.measure) {
        const m = S.measure, hint = S.snapHint || snapPoint(S.mouse[0], S.mouse[1]), a = m.a, b = m.b || hint.p, sb = m.b ? m.sb : hint;
        const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
        // the legs (Δx, Δy) faint, the distance dashed, the ends marked where they stuck
        ctx.strokeStyle = "rgba(0,229,255,0.35)"; ctx.lineWidth = Math.max(0.06, 0.8 * px); ctx.setLineDash([2 * px, 3 * px]);
        if (dx && dy) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.1, 1.2 * px); ctx.setLineDash([4 * px, 3 * px]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
        if (m.sa) snapMark(m.sa, px, true);
        if (m.b && sb) snapMark(sb, px, true);
        const ang = d ? Math.atan2(-dy, dx) * 180 / Math.PI : 0, txt = `${d.toFixed(2)} mm  (Δx ${dx.toFixed(2)}, Δy ${(-dy || 0).toFixed(2)}, ${ang.toFixed(1)}°)`;
        ctx.font = `${12 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
        const tw = ctx.measureText(txt).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(b[0] + 6 * px, b[1] - 18 * px, tw + 8 * px, 16 * px);
        ctx.fillStyle = "#00e5ff"; ctx.fillText(txt, b[0] + 10 * px, b[1] - 4 * px);
        S.measured = { d, dx, dy: -dy || 0, from: m.sa ? m.sa.what : "grid", to: sb ? sb.what : "grid" };
        const ends = [S.measured.from, S.measured.to].some(w => w !== "grid") ? ` · ${S.measured.from} → ${S.measured.to}` : "";
        $("st-msg").textContent = "Measure: " + txt + ends;
      }
      if (S.show.drc) S.drc.forEach(d => {
        if (d.kind === "unplaced") return;
        const r = Math.max(0.8, 6 * px);
        ctx.strokeStyle = NOTE.includes(d.kind) ? "#ffb300" : "#ff7b72"; ctx.lineWidth = Math.max(0.12, 1.5 * px);
        ctx.beginPath(); ctx.arc(d.x, d.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(d.x - r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x + r * 0.6, d.y + r * 0.6); ctx.moveTo(d.x + r * 0.6, d.y - r * 0.6); ctx.lineTo(d.x - r * 0.6, d.y + r * 0.6); ctx.stroke();
      });
      // the board's resize handle (select tool)
      if (S.tool === "select" && S.show["Edge.Cuts"]) { const t = 5 * px; ctx.fillStyle = COLORS["Edge.Cuts"]; ctx.fillRect(o.w - t, -t, 2 * t, 2 * t); }
      if (S.axes) axisMarks(W, H);
      $("z-pct").textContent = `${Math.round(S.view.scale / 3.7795 * 100)}%`;
      const c = S.conn, errs = errors();
      $("st-rats").textContent = c ? (c.unrouted ? `${c.unrouted} connection${c.unrouted > 1 ? "s" : ""} to route` : "All connections routed") : "";
      // green only when the board is finished: no violations, nothing to route; warnings in amber
      const warns = S.drc.filter(d => NOTE.includes(d.kind) && d.kind !== "unplaced").length, open = c && c.unrouted;
      $("st-drc").textContent = S.model ? (errs ? `${errs} rule violation${errs > 1 ? "s" : ""}` : "No rule violations") + (warns ? ` · ${warns} warning${warns > 1 ? "s" : ""}` : "") : "";
      $("st-drc").style.color = errs ? "var(--bad)" : warns ? "var(--warn)" : open ? "var(--muted)" : "var(--ok)";
    }
    // where the measure tool sticks: a circle on a centre, a square on a corner or end, a diamond on
    // a line; with its name next to it (not on the ends of a measurement already placed)
    function snapMark(sp, px, quiet) {
      if (sp.shape === "grid") return;
      const [x, y] = sp.p, r = 5 * px;
      ctx.strokeStyle = "#ffe680"; ctx.lineWidth = Math.max(0.08, 1.5 * px); ctx.beginPath();
      if (sp.shape === "centre") ctx.arc(x, y, r, 0, Math.PI * 2);
      else if (sp.shape === "corner") ctx.rect(x - r, y - r, 2 * r, 2 * r);
      else { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
      ctx.stroke();
      if (quiet) return;
      ctx.font = `${11 * px}px ui-monospace, monospace`; ctx.textAlign = "left"; ctx.textBaseline = "top";
      const tw = ctx.measureText(sp.what).width; ctx.fillStyle = "rgba(7,11,16,0.85)"; ctx.fillRect(x + 7 * px, y + 6 * px, tw + 6 * px, 14 * px);
      ctx.fillStyle = "#ffe680"; ctx.fillText(sp.what, x + 10 * px, y + 8 * px);
    }
    // the screen grid (in screen pixels): lines with every tenth stronger, or dots; coarser when zoomed out
    // It runs from the origin, the board's bottom-left corner (screen y Oy), rows counted upwards.
    function drawGrid(W, H) {
      if (S.gridStyle === "off") return;
      const { scale, ox } = S.view, Oy = originY(), lines = S.gridStyle === "lines", n = Math.max(1, Math.ceil((lines ? 8 : 6) / (S.grid * scale))), g = S.grid * n;
      const i1 = Math.floor(-ox / scale / g), i2 = Math.ceil((W - ox) / scale / g), j1 = Math.floor((Oy - H) / scale / g), j2 = Math.ceil(Oy / scale / g);
      if (!lines) {
        ctx.fillStyle = "#16202c";
        for (let i = i1; i <= i2; i++) for (let j = j1; j <= j2; j++) ctx.fillRect(i * g * scale + ox - 0.75, Oy - j * g * scale - 0.75, 1.5, 1.5);
        return;
      }
      ctx.lineWidth = 1;
      [false, true].forEach(major => {
        ctx.strokeStyle = major ? "#1a2533" : "#111923"; ctx.beginPath();
        for (let i = i1; i <= i2; i++) if ((i % 10 === 0) === major) { const sx = Math.round(i * g * scale + ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
        for (let j = j1; j <= j2; j++) if ((j % 10 === 0) === major) { const sy = Math.round(Oy - j * g * scale) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
        ctx.stroke();
      });
    }
    const originY = () => S.view.oy + S.board.outline.h * S.view.scale;   // the origin's screen y
    // X / Y axes through the board's origin (its bottom-left corner; y grows upwards, as in the
    // Gerbers' view from the top): the lines under the board, the arrows and the millimetre scale
    // on top. When the origin is off screen the scale sticks to the screen edge.
    const AX = { x: "#ff8a80", y: "#7ee787" };
    function axisLines(W, H) {
      const { ox } = S.view, oy = originY();
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 1; ctx.globalAlpha = 0.45;
      if (oy >= 0 && oy <= H) { ctx.strokeStyle = AX.x; ctx.beginPath(); ctx.moveTo(0, Math.round(oy) + 0.5); ctx.lineTo(W, Math.round(oy) + 0.5); ctx.stroke(); }
      if (ox >= 0 && ox <= W) { ctx.strokeStyle = AX.y; ctx.beginPath(); ctx.moveTo(Math.round(ox) + 0.5, 0); ctx.lineTo(Math.round(ox) + 0.5, H); ctx.stroke(); }
      ctx.restore();
    }
    function axisMarks(W, H) {
      const { scale, ox } = S.view, oy = originY();
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find(s => s * scale >= 60) || 1000;
      const yx = Math.max(2, Math.min(H - 18, oy)), xy = Math.max(2, Math.min(W - 40, ox));   // where the scales run
      ctx.font = "10px ui-monospace, monospace"; ctx.lineWidth = 1;
      // X scale
      ctx.strokeStyle = AX.x; ctx.fillStyle = AX.x; ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.beginPath();
      for (let v = Math.ceil(-ox / scale / step) * step; v * scale + ox <= W; v += step) {
        const sx = Math.round(v * scale + ox) + 0.5; ctx.moveTo(sx, yx); ctx.lineTo(sx, yx + 5);
        if (v && Math.abs(sx - xy) > 24 && !(yx === oy && sx > ox && sx < ox + 76)) ctx.fillText(String(v), sx, yx + 6);   // clear of the X arrow
      }
      ctx.stroke();
      // Y scale
      ctx.strokeStyle = AX.y; ctx.fillStyle = AX.y; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.beginPath();
      for (let v = Math.ceil((oy - H) / scale / step) * step; oy - v * scale >= 0; v += step) {
        const sy = Math.round(oy - v * scale) + 0.5; ctx.moveTo(xy, sy); ctx.lineTo(xy + 5, sy);
        if (v && Math.abs(sy - yx) > 14 && !(xy === ox && sy < oy && sy > oy - 76)) ctx.fillText(String(v), xy + 7, sy);   // clear of the Y arrow
      }
      ctx.stroke();
      // the origin: two arrows, X to the right and Y up
      if (ox > -40 && ox < W + 40 && oy > -40 && oy < H + 40) {
        const arrow = (dx, dy, col, label) => {
          const L = 46, ex = ox + dx * L, ey = oy + dy * L;
          ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ex + dx * 8, ey + dy * 8); ctx.lineTo(ex - dy * 4, ey + dx * 4); ctx.lineTo(ex + dy * 4, ey - dx * 4); ctx.closePath(); ctx.fill();
          ctx.font = "bold 12px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(label, ex + dx * 16 + dy * 9, ey + dy * 16 + dx * 9);
        };
        arrow(1, 0, AX.x, "X"); arrow(0, -1, AX.y, "Y");
        ctx.fillStyle = "#e6edf3"; ctx.beginPath(); ctx.arc(ox, oy, 3, 0, Math.PI * 2); ctx.fill();
        ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "right"; ctx.textBaseline = "top"; ctx.fillText("0,0", ox - 4, oy + 3);
      }
      ctx.restore();
    }

    // the selected area's handles: squares on the corners, a "+" in the middle of each edge
    function areaHandles(P, px) {
      ctx.fillStyle = "#00e5ff"; P.forEach(p => ctx.fillRect(p[0] - 3.5 * px, p[1] - 3.5 * px, 7 * px, 7 * px));
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = Math.max(0.05, 1.2 * px);
      P.forEach((p, k) => {
        const q = P[(k + 1) % P.length], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) * S.view.scale < 24) return;
        ctx.fillStyle = "rgba(10,14,20,0.85)"; ctx.beginPath(); ctx.arc(mx, my, 4.5 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx - 2.5 * px, my); ctx.lineTo(mx + 2.5 * px, my); ctx.moveTo(mx, my - 2.5 * px); ctx.lineTo(mx, my + 2.5 * px); ctx.stroke();
      });
    }
    return { attachCanvas, render };
  };
})(window);
