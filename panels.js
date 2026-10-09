/* Resizable side panels. Panels.columns(grid, opts) puts a drag handle on the edge of
   each side column of a CSS grid (palette, inspector, instrument controls): drag to
   resize, double-click to reset. Widths are kept per page in localStorage. Below
   opts.minViewport (the pages' narrow layouts stack the panels) the handles hide and
   the page's own CSS applies again. After a change the page gets a window "resize"
   event, which every page already redraws on.
     opts: { key, minViewport, cols: [{ index, side: "left" | "right", def, min, max }],
             template: widths -> grid-template-columns, minCenter } */
(function (root) {
  "use strict";
  const STORE = "tubecad_panels_";
  function columns(grid, opts) {
    if (!grid) return null;
    let widths = opts.cols.map(c => c.def);
    try { const s = JSON.parse(localStorage.getItem(STORE + opts.key)); if (Array.isArray(s) && s.length === widths.length) widths = s.map((v, i) => +v || opts.cols[i].def); } catch (e) {}
    if (getComputedStyle(grid).position === "static") grid.style.position = "relative";
    const handles = opts.cols.map((c, i) => {
      const h = document.createElement("div");
      h.className = "panel-split"; h.title = "Drag to resize · double-click to reset";
      h.setAttribute("role", "separator"); h.setAttribute("aria-orientation", "vertical");
      h.style.cssText = "position:absolute;top:0;bottom:0;width:8px;margin-left:-4px;cursor:col-resize;z-index:15;touch-action:none";
      h.addEventListener("mouseenter", () => { h.style.background = "rgba(0,229,255,0.25)"; });
      h.addEventListener("mouseleave", () => { if (!h.dragging) h.style.background = ""; });
      h.addEventListener("dblclick", () => { widths[i] = c.def; apply(true); });
      h.addEventListener("pointerdown", e => {
        e.preventDefault(); h.setPointerCapture(e.pointerId); h.dragging = true;
        const x0 = e.clientX, w0 = widths[i];
        const move = ev => { const dx = ev.clientX - x0; widths[i] = clamp(i, c.side === "left" ? w0 + dx : w0 - dx); apply(false); };
        const up = () => { h.dragging = false; h.style.background = ""; h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); save(); };
        h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
      });
      grid.appendChild(h);
      return h;
    });
    // never so wide that the middle (schematic, screen) gets narrower than minCenter
    function clamp(i, w) {
      const c = opts.cols[i], others = widths.reduce((s, v, j) => s + (j === i ? 0 : v), 0);
      const room = grid.clientWidth - others - (opts.minCenter || 300);
      return Math.round(Math.max(c.min, Math.min(c.max, room, w)));
    }
    const narrow = () => window.innerWidth < (opts.minViewport || 0);
    function place() {
      const kids = [...grid.children].filter(k => !k.classList.contains("panel-split")), g = grid.getBoundingClientRect();
      handles.forEach((h, i) => {
        const c = opts.cols[i], k = kids[c.index];
        if (narrow() || !k || k.offsetParent === null) { h.style.display = "none"; return; }
        const r = k.getBoundingClientRect(), x = c.side === "left" ? r.right : r.left;
        // in a grid with gaps the handle sits in the middle of the gap
        const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
        h.style.display = ""; h.style.left = (x - g.left + (c.side === "left" ? gap / 2 : -gap / 2)) + "px";
      });
    }
    function apply(store) {
      if (narrow()) grid.style.gridTemplateColumns = "";
      else grid.style.gridTemplateColumns = opts.template(widths);
      place();
      window.dispatchEvent(new Event("resize"));
      if (store) save();
    }
    function save() { try { localStorage.setItem(STORE + opts.key, JSON.stringify(widths)); } catch (e) {} }
    let busy = false;
    window.addEventListener("resize", () => { if (busy) return; busy = true; try { if (narrow()) grid.style.gridTemplateColumns = ""; else { widths = widths.map((w, i) => clamp(i, w)); grid.style.gridTemplateColumns = opts.template(widths); } place(); } finally { busy = false; } });
    apply(false);
    return { widths: () => widths.slice(), set: (i, w) => { widths[i] = clamp(i, w); apply(true); }, handles };
  }
  root.Panels = { columns };
})(typeof window !== "undefined" ? window : globalThis);
