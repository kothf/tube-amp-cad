/* App settings (View ▾ → Settings…), kept in this browser and shared by its windows (a change in
   one reaches the others through the storage event):
   - Animations: Part animations on or off for every part at once (LEDs, neons and gas tubes
     lighting up, lamps and heaters glowing, hot anodes, magic eyes, nixies, meter needles, relays;
     off, every part is drawn plain and the simulation is unchanged), and how long ∿ Animate takes
     to play one slowed-down cycle.
   - Simulation: how long a Live run may take before it stops.
   - New circuits: the title block's Created by and Legal owner, the sheet's format and
     orientation, and the mains (230 V 50 Hz, 120 V 60 Hz …) new mains and transformer parts get.
   - Start-up and view: the language, the start screen, Live, windows as tabs, the legend; these
     are the same switches the menus have, gathered here.
   - Board: the units the measure tool shows (mm or mil).
   - AI: Design knowledge in AI prompts (ai-skill.js, the circuit-design skill) on or off.
   - Keys: the AI key and the DigiKey key, each opened in its own dialog.
   localStorage tubecad_settings holds this module's own values; the start-up switches keep the
   keys they always had (tubecad_lang, tubecad_start, tubecad_live, tubecad_tabs, tubecad_legend,
   tubecad_munits), so nothing set before is lost. */
(function (root) {
  "use strict";
  const KEY = "tubecad_settings";
  const DEFAULTS = { animations: true, aiKnowledge: true, animS: 3, liveS: 2.5, author: "", owner: "", size: "A3", orient: "landscape", mains: "230/50" };
  const MAINS = [["230/50", "230 V 50 Hz (Europe, Israel, Asia)"], ["220/50", "220 V 50 Hz (Russia, CIS, China)"], ["240/50", "240 V 50 Hz (UK, Australia)"], ["120/60", "120 V 60 Hz (North America)"], ["100/50", "100 V 50 Hz (East Japan)"], ["100/60", "100 V 60 Hz (West Japan)"]];
  const ANIM_S = [1, 2, 3, 5, 10], LIVE_S = [1, 2.5, 5, 10], SIZES = ["A4", "A3", "A2", "A1"];
  let prefs = load();
  const listeners = [];
  function load() {
    const out = Object.assign({}, DEFAULTS);
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (s && typeof s === "object") Object.keys(DEFAULTS).forEach(k => { if (typeof s[k] === typeof DEFAULTS[k]) out[k] = s[k]; });
    } catch (e) { /* no storage, or not ours */ }
    if (!ANIM_S.includes(out.animS)) out.animS = DEFAULTS.animS;
    if (!LIVE_S.includes(out.liveS)) out.liveS = DEFAULTS.liveS;
    if (!SIZES.includes(out.size)) out.size = DEFAULTS.size;
    if (out.orient !== "portrait") out.orient = "landscape";
    if (!MAINS.some(m => m[0] === out.mains)) out.mains = DEFAULTS.mains;
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* no storage: this session only */ } }
  const fire = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const get = k => prefs[k];
  function set(k, v) {
    if (!(k in DEFAULTS) || prefs[k] === v) return;
    if (typeof v !== typeof DEFAULTS[k]) return;
    prefs[k] = v; save(); fire(); refresh();
  }
  // whether the parts animate
  const animations = () => prefs.animations !== false;
  const setAnimations = on => set("animations", !!on);
  // the mains new parts get: { v, f }
  const mains = () => { const [v, f] = prefs.mains.split("/").map(Number); return { v, f }; };
  // the values a new part of this type starts with, over its library defaults (a part placed, never one loaded)
  function partDefaults(type) {
    const m = mains();
    if (type === "mains") return { vrms: m.v, freq: String(m.f) };
    if (type === "ptx") return { freq: m.f };
    if (type === "ptx_cat") {
      // the primary tap nearest the mains (a Hammond 300 has 100/110/120 and 200/220/230/240)
      const lib = root.CadLib, tx = lib && lib.POWER_TX && lib.POWER_TX["373BX"];
      if (!tx || !tx.taps) return {};
      const t = tx.taps.reduce((a, b) => (Math.abs(b - m.v) < Math.abs(a - m.v) ? b : a));
      return { tap: String(t) };
    }
    if (type === "frame") { const o = {}; if (prefs.author) o.creator = prefs.author; if (prefs.owner) o.owner = prefs.owner; return o; }
    return {};
  }
  if (root.addEventListener) root.addEventListener("storage", e => { if (e.key === KEY) { prefs = load(); fire(); refresh(); } });

  // ---------------------------------------------------------------------------------------------
  // The Settings window. host (from cad-app.js, init) reaches the switches that live elsewhere:
  // { lang(), setLang(l), startOn(), setStart(on), live(), setLive(on), tabs(), setTabs(on),
  //   legend(), setLegend(on), units(), setUnits(u), aiKey() (text or ""), editAi(), dkKey(), editDk() }
  let modal = null, host = {};
  const $ = id => modal.querySelector("#" + id);
  function refresh() {
    if (!modal || modal.hidden) return;
    $("set-animations").checked = animations();
    $("set-ai-knowledge").checked = prefs.aiKnowledge !== false;
    $("set-anim-s").value = String(prefs.animS);
    $("set-live-s").value = String(prefs.liveS);
    if (document.activeElement !== $("set-author")) $("set-author").value = prefs.author;
    if (document.activeElement !== $("set-owner")) $("set-owner").value = prefs.owner;
    $("set-size").value = prefs.size; $("set-orient").value = prefs.orient;
    $("set-mains").value = prefs.mains;
    const h = (f, d) => { try { return host[f] ? host[f]() : d; } catch (e) { return d; } };
    $("set-lang").value = h("lang", "en");
    $("set-start").checked = !!h("startOn", true);
    $("set-live").checked = !!h("live", true);
    $("set-tabs").checked = !!h("tabs", true);
    $("set-legend").checked = !!h("legend", true);
    $("set-units").value = h("units", "mm");
    const ai = h("aiKey", ""), dk = h("dkKey", false);
    $("set-ai-state").textContent = ai || "No key";
    $("set-dk-state").textContent = dk ? "Key saved" : "No key";
  }
  function build() {
    modal = document.getElementById("settings-modal");
    const opts = (sel, list) => { $(sel).innerHTML = list.map(([v, t]) => `<option value="${v}">${t}</option>`).join(""); };
    opts("set-anim-s", ANIM_S.map(s => [s, `${s} s per cycle`]));
    opts("set-live-s", LIVE_S.map(s => [s, `${s} s`]));
    opts("set-size", SIZES.map(s => [s, s]));
    opts("set-mains", MAINS);
    const on = (id, ev, f) => $(id).addEventListener(ev, f);
    on("set-animations", "change", e => setAnimations(e.target.checked));
    on("set-ai-knowledge", "change", e => set("aiKnowledge", !!e.target.checked));
    on("set-anim-s", "change", e => set("animS", +e.target.value));
    on("set-live-s", "change", e => set("liveS", +e.target.value));
    on("set-author", "input", e => set("author", e.target.value.trim()));
    on("set-owner", "input", e => set("owner", e.target.value.trim()));
    on("set-size", "change", e => set("size", e.target.value));
    on("set-orient", "change", e => set("orient", e.target.value));
    on("set-mains", "change", e => set("mains", e.target.value));
    const call = (f, ...a) => { if (host[f]) host[f](...a); refresh(); };
    on("set-lang", "change", e => call("setLang", e.target.value));
    on("set-start", "change", e => call("setStart", e.target.checked));
    on("set-live", "change", e => call("setLive", e.target.checked));
    on("set-tabs", "change", e => call("setTabs", e.target.checked));
    on("set-legend", "change", e => call("setLegend", e.target.checked));
    on("set-units", "change", e => call("setUnits", e.target.value));
    // a key's own dialog opens in place of this one
    on("btn-set-ai", "click", () => { close(); call("editAi"); });
    on("btn-set-dk", "click", () => { close(); call("editDk"); });
    on("btn-settings-close", "click", close);
    modal.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    modal.addEventListener("mousedown", e => { if (e.target === modal) close(); });
  }
  function openDialog() {
    if (!modal) build();
    modal.hidden = false; refresh();
    $("set-animations").focus();
  }
  function close() { if (modal) modal.hidden = true; }
  function init(h) { host = h || {}; }

  root.CadSettings = { KEY, DEFAULTS, MAINS, get, set, animations, setAnimations, mains, partDefaults, animSeconds: () => prefs.animS, liveMs: () => prefs.liveS * 1000, onChange: f => listeners.push(f), init, openDialog, close, refresh };
})(typeof window !== "undefined" ? window : globalThis);
