/* Point markers on a canvas graph, shared by the oscilloscope, the spectrum
   analyzer and the curve tracer. Up to two markers, A and B, like the cursors
   of a bench instrument:
     click / tap        place a marker (the third one moves the nearer of A, B)
     drag a marker      move it
     double-click one   remove it;  Esc removes both
   The page supplies the graph logic; markers are kept in the page's own data
   coordinates, so they follow the trace when the simulation updates.
     MarkerPicker(canvas, {
       snap(x, y)  -> marker | null   pick the point under the pointer (CSS px)
       pos(marker) -> {x, y} | null   where a marker is drawn now
       hover(marker | null)           pointer moved over the graph (or left it)
       change(markers)                markers were added, moved or removed
     })  -> { list, clear(), set(list), reset() } */
(function (root) {
  "use strict";
  const HIT = 12;            // px: grab radius of a marker

  function MarkerPicker(canvas, h) {
    let list = [], drag = -1;
    const xy = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const near = (x, y) => {
      let best = -1, bd = HIT;
      list.forEach((m, i) => { const p = h.pos(m); if (!p) return; const d = Math.hypot(p.x - x, p.y - y); if (d <= bd) { bd = d; best = i; } });
      return best;
    };
    const changed = () => h.change(list.slice());
    canvas.style.touchAction = "none";
    canvas.style.cursor = "crosshair";

    canvas.addEventListener("pointerdown", e => {
      if (e.button !== 0 || e.shiftKey) return;     // Shift+drag pans (PlotZoom)
      const [x, y] = xy(e);
      const i = near(x, y);
      if (i >= 0) { drag = i; canvas.setPointerCapture(e.pointerId); return; }
      const m = h.snap(x, y); if (!m) return;
      if (list.length < 2) list.push(m);
      else {
        // both placed: move the nearer one
        const d = list.map(k => { const p = h.pos(k); return p ? Math.hypot(p.x - x, p.y - y) : Infinity; });
        list[d[0] <= d[1] ? 0 : 1] = m;
      }
      drag = list.indexOf(m);
      canvas.setPointerCapture(e.pointerId);
      changed();
    });
    canvas.addEventListener("pointermove", e => {
      const [x, y] = xy(e);
      if (drag >= 0) { const m = h.snap(x, y); if (m) { list[drag] = m; changed(); } return; }
      canvas.style.cursor = near(x, y) >= 0 ? "grab" : "crosshair";
      if (e.pointerType === "mouse") h.hover(h.snap(x, y));
    });
    const end = () => { drag = -1; };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", e => { if (drag < 0 && e.pointerType === "mouse") h.hover(null); });
    canvas.addEventListener("dblclick", e => {
      const [x, y] = xy(e), i = near(x, y);
      if (i >= 0) { list.splice(i, 1); changed(); }
    });
    window.addEventListener("keydown", e => {
      if (e.key === "Escape" && list.length && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { list = []; changed(); }
    });
    return {
      get list() { return list.slice(); },
      clear() { if (list.length) { list = []; changed(); } },
      set(l) { list = l.slice(0, 2); changed(); },
      reset() { list = []; drag = -1; }          // without a change() call, e.g. while redrawing
    };
  }

  /** Draw a marker: a ring with its letter, in the given colour. */
  MarkerPicker.draw = (ctx, x, y, letter, color) => {
    ctx.save();
    ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.fillStyle = "rgba(3,8,13,0.85)";
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.font = "bold 11px ui-monospace, Menlo, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.fillText(letter, x + 8, y - 7);
    ctx.restore();
  };
  MarkerPicker.LETTERS = ["A", "B"];

  /** Readout box beside a vertical cursor at x (flips left near the right edge). */
  MarkerPicker.label = (ctx, x, y, left, right, parts) => {
    ctx.save();
    ctx.font = "11px ui-monospace, Menlo, monospace"; ctx.textBaseline = "top"; ctx.textAlign = "left";
    const w = Math.max(...parts.map(p => ctx.measureText(p[0]).width)) + 10, h = parts.length * 14 + 6;
    const bx = x + 8 + w > right ? Math.max(left, x - 8 - w) : x + 8;
    ctx.fillStyle = "rgba(3,8,13,0.85)"; ctx.fillRect(bx, y, w, h);
    ctx.strokeStyle = "rgba(230,237,243,0.18)"; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, y + 0.5, w - 1, h - 1);
    parts.forEach(([t, c], i) => { ctx.fillStyle = c; ctx.fillText(t, bx + 5, y + 4 + i * 14); });
    ctx.restore();
  };

  /** Mouse zoom and pan on a canvas graph, shared by the three instruments:
       wheel                    zoom in / out at the pointer
       Ctrl+wheel               zoom the vertical axis only
       Shift+wheel              scroll sideways
       right-drag, Shift+drag   pan
     PlotZoom(canvas, {
       inside(x, y)      -> bool    pointer over the graph area (CSS px)
       zoom(x, y, k, vertical)      scale the view by k around (x, y): k < 1 zooms in
       pan(dx, dy)                  move the view with the pointer by (dx, dy) px
       scroll(dir)                  Shift+wheel: one step left (-1) or right (+1); pan is used if absent
     }) */
  function PlotZoom(canvas, h) {
    const xy = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener("wheel", e => {
      const [x, y] = xy(e);
      if (!h.inside(x, y)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        const d = e.shiftKey && !dx ? dy : dx; if (!d) return;
        if (h.scroll) h.scroll(Math.sign(d)); else h.pan(-Math.sign(d) * canvas.clientWidth / 10, 0);
        return;
      }
      if (!dy) return;
      // one mouse-wheel notch (100 px) is about ×1.25; a touchpad's small steps zoom smoothly
      h.zoom(x, y, Math.exp(Math.max(-300, Math.min(300, dy)) * 0.0022), e.ctrlKey || e.metaKey);
    }, { passive: false });
    let last = null;
    canvas.addEventListener("pointerdown", e => {
      if (!(e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey))) return;
      const [x, y] = xy(e); if (!h.inside(x, y)) return;
      e.preventDefault(); last = [x, y]; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", e => {
      if (!last) return;
      const [x, y] = xy(e), dx = x - last[0], dy = y - last[1]; last = [x, y];
      if (dx || dy) h.pan(dx, dy);
    });
    const end = () => { if (last) { last = null; canvas.style.cursor = "crosshair"; } };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("contextmenu", e => { const [x, y] = xy(e); if (h.inside(x, y)) e.preventDefault(); });
  }

  root.MarkerPicker = MarkerPicker;
  root.PlotZoom = PlotZoom;
})(typeof window !== "undefined" ? window : globalThis);
