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
  // Safari brings a window to the front only for the page that opened it: the Board window or an
  // instrument cannot raise the CAD's tab. The CAD then keeps the board in its own window (a tab of
  // it) by default, and a button that could not switch says so.
  const ua = navigator.userAgent || "";
  const cantRaise = /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|Edg\/|Android/.test(ua);
  const TITLES = { "circuit_sandbox.html": "The Circuit CAD", "index.html": "The curve tracer", "oscilloscope.html": "The oscilloscope", "spectrum_analyzer.html": "The spectrum analyzer", "bode.html": "The Bode plotter", "board.html": "The Board Design", "help.html": "The help" };
  const mine = new WeakSet();   // the windows this page opened: the ones Safari lets it bring up
  function notRaised(file) {
    let n = document.getElementById("win-note");
    if (!n) {
      n = document.createElement("div"); n.id = "win-note"; n.setAttribute("role", "status");
      n.style.cssText = "position:fixed;left:50%;top:56px;transform:translateX(-50%);z-index:100;max-width:min(560px,calc(100vw - 32px));padding:10px 14px;border-radius:8px;background:#222;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);cursor:pointer";
      n.addEventListener("click", () => { n.hidden = true; });
      document.body.appendChild(n);
    }
    n.textContent = `${TITLES[file] || "That window"} is open in another tab, but Safari does not let a page bring another tab to the front: switch to it yourself.` +
      (file === "circuit_sandbox.html" && page === "board.html" ? " Or tick Windows ▾ → Board in this window in the Circuit CAD: the Schematic | Board switch then flips in one window." : "");
    n.hidden = false; clearTimeout(notRaised.t); notRaised.t = setTimeout(() => { n.hidden = true; }, 9000);
  }
  // the release this page belongs to (its ?v= stamp). A tool window left open from an older
  // release (an old Board toolbar, say) is reloaded when a button brings it up, and the URL a
  // window opens carries the stamp too, so a browser cannot answer it from an old cached page.
  const version = (() => { const sc = document.currentScript; return (sc && new URL(sc.src, location.href).searchParams.get("v")) || ""; })();
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;

  /** Open a tool page, or focus it if it is already open. params: e.g. { scope: id } */
  function open(file, params) {
    // framed: the page that holds this one may be the one asked for (the Board's Schematic button)
    if (framed) { try { if (window.parent.location.pathname.split("/").pop() === file) { window.parent.postMessage({ type: "SHOW_PAGE", page: file }, location.origin); return window.parent; } } catch (e) {} }
    const q = new URLSearchParams(params || {}); if (version) q.set("v", version);
    const name = NAMES[file], url = new URL(file + (String(q) ? "?" + q : ""), location.href).href;
    let w = null;
    try { w = window.open("", name); } catch (e) { w = null; }
    if (!w) { w = window.open(url, name); if (w) mine.add(w); return w; }   // the browser refused a named lookup
    let fresh = true;
    try { fresh = !w.location.href || w.location.href === "about:blank"; } catch (e) { fresh = false; }
    let stale = false;
    try { stale = !fresh && !!w.ToolWindows && w.ToolWindows.version !== version; } catch (e) {}
    if (fresh || stale) { w.location.href = url; mine.add(w); }
    else if (params && params.scope && bc) bc.postMessage({ type: "SELECT_SCOPE", id: params.scope, target: name });
    try { w.focus(); } catch (e) {}
    // a window this page did not open (the one that opened it, say) stays behind in Safari
    if (cantRaise && !mine.has(w)) setTimeout(() => { if (document.hasFocus()) notRaised(file); }, 300);
    return w;
  }
  // Alt+S: the schematic, Alt+B: the board, from any window (the CAD binds Alt+B in its own command table)
  document.addEventListener("keydown", e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const to = e.code === "KeyS" ? "circuit_sandbox.html" : e.code === "KeyB" ? "board.html" : null;
    if (!to || to === page || (page === "circuit_sandbox.html" && to === "board.html")) return;
    e.preventDefault(); open(to);
  });
  root.ToolWindows = { open, NAMES, cantRaise, version };
})(window);
