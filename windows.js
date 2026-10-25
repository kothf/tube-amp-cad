/* One window per tool: the Circuit CAD, the curve tracer, the oscilloscope, the
   spectrum analyzer, the Bode plotter and the Board Design. A button brings an open window to the front (and, for
   an instrument, switches it to the requested scope part) instead of opening
   another one. Each page names its own window, so a window is found whether a
   button or a reload opened it. */
(function (root) {
  "use strict";
  const NAMES = { "circuit_sandbox.html": "tube_cad", "index.html": "tube_curve_tracer", "oscilloscope.html": "tube_scope", "spectrum_analyzer.html": "tube_spectrum", "bode.html": "tube_bode", "board.html": "tube_board", "help.html": "tube_help" };
  const page = location.pathname.split("/").pop() || "index.html";
  // a page framed in another (the Board as a tab of the CAD) keeps no window name: the CAD's
  // own window is the one a button looks for
  const framed = window.parent !== window;
  if (NAMES[page] && !framed) window.name = NAMES[page];
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;

  /** Open a tool page, or focus it if it is already open. params: e.g. { scope: id } */
  function open(file, params) {
    // framed: the page that holds this one may be the one asked for (the Board's Schematic button)
    if (framed) { try { if (window.parent.location.pathname.split("/").pop() === file) { window.parent.postMessage({ type: "SHOW_PAGE", page: file }, location.origin); return window.parent; } } catch (e) {} }
    const name = NAMES[file], url = new URL(file + (params ? "?" + new URLSearchParams(params) : ""), location.href).href;
    let w = null;
    try { w = window.open("", name); } catch (e) { w = null; }
    if (!w) return window.open(url, name);             // the browser refused a named lookup
    let fresh = true;
    try { fresh = !w.location.href || w.location.href === "about:blank"; } catch (e) { fresh = false; }
    if (fresh) w.location.href = url;
    else if (params && params.scope && bc) bc.postMessage({ type: "SELECT_SCOPE", id: params.scope, target: name });
    try { w.focus(); } catch (e) {}
    return w;
  }
  // Alt+S: the schematic, Alt+B: the board, from any window (the CAD binds Alt+B in its own command table)
  document.addEventListener("keydown", e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const to = e.code === "KeyS" ? "circuit_sandbox.html" : e.code === "KeyB" ? "board.html" : null;
    if (!to || to === page || (page === "circuit_sandbox.html" && to === "board.html")) return;
    e.preventDefault(); open(to);
  });
  root.ToolWindows = { open, NAMES };
})(window);
