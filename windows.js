/* One window per tool: the Circuit CAD, the curve tracer, the oscilloscope and
   the spectrum analyzer. A button brings an open window to the front (and, for
   an instrument, switches it to the requested scope part) instead of opening
   another one. Each page names its own window, so a window is found whether a
   button or a reload opened it. */
(function (root) {
  "use strict";
  const NAMES = { "circuit_sandbox.html": "tube_cad", "index.html": "tube_curve_tracer", "oscilloscope.html": "tube_scope", "spectrum_analyzer.html": "tube_spectrum" };
  const page = location.pathname.split("/").pop() || "index.html";
  if (NAMES[page]) window.name = NAMES[page];
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;

  /** Open a tool page, or focus it if it is already open. params: e.g. { scope: id } */
  function open(file, params) {
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
  root.ToolWindows = { open, NAMES };
})(window);
