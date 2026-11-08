/* Window tabs at the bottom of the CAD (like the document tabs of a mechanical CAD): the
   schematic, the board, the instruments and the manual, each a tab of this one browser tab
   instead of a window of its own. A tool page shown in a tab is the same page as its window,
   in a frame over the CAD (above the tab strip); it talks to the CAD over the same
   BroadcastChannel as a window would. View ▾ → Windows as tabs, ticked by default, turns them
   on and off (off: every tool has a window of its own again, for a second monitor). */
(function (root) {
  "use strict";
  const CAD = "circuit_sandbox.html";
  // the tabs, in strip order: label, icon, tooltip
  const TOOLS = [
    { file: CAD, label: "Schematic", ico: "schematic", tip: "Schematic: the circuit you are editing (Alt+S)" },
    { file: "board.html", label: "Board", ico: "board", tip: "Board: the PCB layout of this circuit (Alt+B)" },
    { file: "oscilloscope.html", label: "Oscilloscope", ico: "scope", tip: "Oscilloscope: the waveforms at a scope part's channels" },
    { file: "spectrum_analyzer.html", label: "Spectrum analyzer", ico: "spectrum", tip: "Spectrum analyzer: the FFT of a scope part's channels" },
    { file: "bode.html", label: "Bode plotter", ico: "bode", tip: "Bode plotter: gain and phase against frequency" },
    { file: "index.html", label: "Curve tracer", ico: "tracer", tip: "Curve tracer: plate curves with this circuit's operating point" },
    { file: "help.html", label: "Manual", ico: "book", tip: "Manual: every feature, part, value and coefficient explained" }
  ];
  const byFile = f => TOOLS.find(t => t.file === f);
  const OPEN_KEY = "tubecad_tabs_open";   // the open tabs and the shown one, for a reload (sessionStorage)
  const frameId = f => f === "board.html" ? "board-tab" : "tab-" + f.replace(/\.html$/, "");
  const frameOf = f => document.getElementById(frameId(f));
  // the Schematic and Board tabs are always there; the others while open
  let open = [CAD, "board.html"], active = CAD;
  let strip = null, addMenu = null;
  const popped = new Map();   // a tab's page moved to a window of its own: its window, while open

  function save() { try { sessionStorage.setItem(OPEN_KEY, JSON.stringify({ open, active })); } catch (e) {} }
  function restore() {
    try {
      const v = JSON.parse(sessionStorage.getItem(OPEN_KEY) || "null");
      if (v && Array.isArray(v.open)) { open = [CAD, "board.html", ...v.open.filter(f => byFile(f) && f !== CAD && f !== "board.html")]; return byFile(v.active) ? v.active : CAD; }
    } catch (e) {}
    return CAD;
  }

  function render() {
    if (!strip) return;
    strip.hidden = !ToolWindows.tabsOn();
    document.body.classList.toggle("win-tabs-on", !strip.hidden);
    strip.querySelectorAll(".wt-tab").forEach(b => b.remove());
    const add = strip.querySelector(".wt-add");
    open.forEach(f => {
      const t = byFile(f), on = f === active, fixed = f === CAD || f === "board.html";
      const b = document.createElement("div");
      const away = popped.has(f) && !popped.get(f).closed;
      b.className = "wt-tab" + (on ? " on" : "") + (away ? " away" : ""); b.dataset.file = f; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1; b.title = t.tip + (away ? " · now in a window of its own: click brings it up" : "");
      b.innerHTML = Icons.svg(t.ico) + `<span class="wt-lbl"></span>`;
      b.querySelector(".wt-lbl").textContent = t.label;
      const pop = document.createElement("button"); pop.type = "button"; pop.className = "wt-btn wt-pop"; pop.textContent = "⧉"; pop.title = "Open in a window of its own (for a second monitor)";
      pop.addEventListener("click", e => { e.stopPropagation(); popOut(f); });
      if (f !== CAD && !away) b.appendChild(pop);
      if (!fixed) {
        const x = document.createElement("button"); x.type = "button"; x.className = "wt-btn wt-x"; x.textContent = "×"; x.title = "Close this tab";
        x.addEventListener("click", e => { e.stopPropagation(); close(f); });
        b.appendChild(x);
      }
      b.addEventListener("click", () => show(f));
      // the middle button closes a tab, as in a browser
      b.addEventListener("auxclick", e => { if (e.button === 1 && !fixed) { e.preventDefault(); close(f); } });
      b.addEventListener("keydown", e => {
        const i = open.indexOf(f);
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const n = open[(i + (e.key === "ArrowRight" ? 1 : open.length - 1)) % open.length]; show(n); const nb = strip.querySelector(`.wt-tab[data-file="${n}"]`); if (nb) nb.focus(); }
        else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(f); }
        else if (e.key === "Delete" && !fixed) { e.preventDefault(); close(f); }
      });
      strip.insertBefore(b, add);
    });
    const left = TOOLS.filter(t => !open.includes(t.file));
    add.hidden = !left.length;
  }

  function frameFor(f, params) {
    let fr = frameOf(f);
    if (fr) return { fr, fresh: false };
    const q = new URLSearchParams(params || {}); if (ToolWindows.version) q.set("v", ToolWindows.version);
    fr = document.createElement("iframe"); fr.id = frameId(f); fr.className = "tab-frame"; fr.title = byFile(f).label;
    fr.src = f + (String(q) ? "?" + q : "");
    fr.hidden = true;
    fr.addEventListener("load", () => { if (!fr.hidden) try { fr.contentWindow.focus(); } catch (e) {} });
    document.body.appendChild(fr);
    return { fr, fresh: true };
  }

  /** Show a tool's tab (opening it the first time). params: e.g. { scope: id } */
  function show(f, params) {
    if (!byFile(f)) return false;
    // moved to a window of its own and still open there: that window comes up, no second copy
    const w = popped.get(f);
    if (w && !w.closed) { ToolWindows.openWindow(f, params); return true; }
    popped.delete(f);
    if (!open.includes(f)) open.push(f);
    active = f;
    let fr = null;
    if (f !== CAD) {
      const r = frameFor(f, params); fr = r.fr;
      if (!r.fresh && params && params.scope && ToolWindows.channel) ToolWindows.channel.postMessage({ type: "SELECT_SCOPE", id: params.scope, target: ToolWindows.NAMES[f] });
    }
    document.querySelectorAll("iframe.tab-frame").forEach(x => { x.hidden = x !== fr; });
    document.body.classList.toggle("tab-frame-on", !!fr);
    closeAdd();
    render(); save();
    if (fr) { try { fr.contentWindow.focus(); } catch (e) {} }
    else { window.focus(); const c = document.getElementById("cad"); if (c) c.focus(); }
    return true;
  }
  function close(f) {
    if (f === CAD || f === "board.html") return;
    const fr = frameOf(f); if (fr) fr.remove();
    popped.delete(f);
    const i = open.indexOf(f); if (i < 0) return;
    open.splice(i, 1);
    if (active === f) show(open[Math.max(0, i - 1)]); else { render(); save(); }
  }
  /** The tab's page in a window of its own instead (a second monitor). The tab stays, dimmed:
      clicking it brings that window up; once the window is closed it shows in the tab again. */
  function popOut(f) {
    const fr = frameOf(f); if (fr) fr.remove();
    if (active === f) show(CAD); else { render(); save(); }
    const w = ToolWindows.openWindow(f);
    if (w) popped.set(f, w);
    render();
  }
  /** Ticked off: the tabs go, the one shown (a tool) comes up in a window of its own */
  function setEnabled(on) {
    ToolWindows.setTabsOn(on);
    if (!on) {
      const was = active;
      document.querySelectorAll("iframe.tab-frame").forEach(x => x.remove());
      document.body.classList.remove("tab-frame-on");
      open = [CAD, "board.html"]; active = CAD; save();
      if (was !== CAD) ToolWindows.openWindow(was);
    }
    render();
  }

  function closeAdd() { if (addMenu) addMenu.hidden = true; }
  function build() {
    strip = document.createElement("nav");
    strip.id = "win-tabs"; strip.setAttribute("role", "tablist"); strip.setAttribute("aria-label", "Windows");
    const add = document.createElement("button");
    add.type = "button"; add.className = "wt-add"; add.textContent = "+"; add.title = "Open an instrument or the manual in a tab";
    add.setAttribute("aria-haspopup", "menu");
    addMenu = document.createElement("div"); addMenu.className = "wt-menu"; addMenu.setAttribute("role", "menu"); addMenu.hidden = true;
    add.addEventListener("click", e => {
      e.stopPropagation();
      if (!addMenu.hidden) { closeAdd(); return; }
      addMenu.innerHTML = "";
      TOOLS.filter(t => !open.includes(t.file)).forEach(t => {
        const it = document.createElement("button"); it.type = "button"; it.className = "wt-mi"; it.setAttribute("role", "menuitem"); it.dataset.file = t.file; it.title = t.tip;
        it.innerHTML = Icons.svg(t.ico) + "<span></span>"; it.querySelector("span").textContent = t.label;
        it.addEventListener("click", () => { closeAdd(); ToolWindows.open(t.file, t.file !== "index.html" && t.file !== "help.html" ? scopeParam() : null); });
        addMenu.appendChild(it);
      });
      addMenu.hidden = false;
      const r = add.getBoundingClientRect();
      addMenu.style.left = Math.max(4, Math.min(r.left, innerWidth - addMenu.offsetWidth - 4)) + "px";
    });
    document.addEventListener("click", e => { if (addMenu && !addMenu.hidden && !addMenu.contains(e.target)) closeAdd(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeAdd(); });
    strip.appendChild(add);
    document.body.appendChild(strip);
    document.body.appendChild(addMenu);
  }
  // an instrument opened from the + menu shows the circuit's first scope part, as Analyze ▾ does
  function scopeParam() {
    const S = root.TubeCAD && root.TubeCAD.state, sc = S && S.comps.find(c => c.type === "scope");
    return sc ? { scope: sc.id } : null;
  }

  build();
  const first = restore();
  render();
  // a page asked for in the URL (a tool window's switch opened this window: ?tab=board.html),
  // else the tab shown before a reload. The URL loses it, so a reload stays where it is.
  const q = new URLSearchParams(location.search);
  let want = q.get("tab") || (q.get("board") === "1" ? "board.html" : null);
  if (want) { q.delete("tab"); q.delete("board"); try { history.replaceState(null, "", location.pathname + (String(q) ? "?" + q : "") + location.hash); } catch (e) {} }
  if (!want && first !== CAD) want = first;
  if (want && ToolWindows.tabsOn()) {
    const params = {}; if (q.get("scope")) params.scope = q.get("scope");
    const go = () => show(want, params);
    if (document.readyState === "complete") setTimeout(go); else window.addEventListener("load", go, { once: true });
  } else if (want === "board.html") {
    // tabs off: a tool window's Board button asked for the board, which has a window of its own
    window.addEventListener("load", () => ToolWindows.openWindow("board.html"), { once: true });
  }
  // a tool window (not a tab) asks this CAD to show a tab: its Board button, say
  if (ToolWindows.channel) ToolWindows.channel.addEventListener("message", e => {
    const d = e.data; if (!d || !ToolWindows.tabsOn()) return;
    if (d.type === "SHOW_TAB" && byFile(d.page)) show(d.page, d.params);
    else if (d.type === "SHOW_BOARD") show("board.html");
  });

  ToolWindows.tabs = { show, close, popOut, setEnabled, enabled: () => ToolWindows.tabsOn(), handles: f => !!byFile(f), active: () => active, open: () => open.slice(), TOOLS };
})(window);
