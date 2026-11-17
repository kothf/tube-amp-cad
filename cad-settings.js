/* App settings (View ▾ → Settings…). One for now: Part animations, on or off for every part at
   once: LEDs, neons, gas regulators and mercury vapour lighting up, lamps and heaters glowing,
   hot anodes, magic eyes, nixie digits, meter needles and relays pulled in. Off, every part is
   drawn plain, as on paper; the simulation and its numbers are the same either way, and the
   ∿ Animate button still runs the current along the wires. Kept in this browser (localStorage
   tubecad_settings) and shared by its windows through the storage event; on by default. */
(function (root) {
  "use strict";
  const KEY = "tubecad_settings";
  let prefs = load();
  const listeners = [];
  function load() {
    const out = { animations: true };
    try { const s = JSON.parse(localStorage.getItem(KEY) || "{}"); if (s && typeof s.animations === "boolean") out.animations = s.animations; } catch (e) { /* no storage, or not ours */ }
    return out;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* no storage: this session only */ } }
  const fire = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  // whether the parts animate
  const animations = () => prefs.animations !== false;
  function setAnimations(on) { if (animations() === !!on) return; prefs.animations = !!on; save(); fire(); refresh(); }
  if (root.addEventListener) root.addEventListener("storage", e => { if (e.key === KEY) { prefs = load(); fire(); refresh(); } });

  // the Settings window: its switches apply at once
  let modal = null;
  function refresh() { if (modal && !modal.hidden) modal.querySelector("#set-animations").checked = animations(); }
  function build() {
    modal = document.getElementById("settings-modal");
    modal.querySelector("#set-animations").addEventListener("change", e => setAnimations(e.target.checked));
    modal.querySelector("#btn-settings-close").addEventListener("click", close);
    modal.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    modal.addEventListener("mousedown", e => { if (e.target === modal) close(); });
  }
  function openDialog() {
    if (!modal) build();
    modal.hidden = false; refresh();
    modal.querySelector("#set-animations").focus();
  }
  function close() { if (modal) modal.hidden = true; }

  root.CadSettings = { KEY, animations, setAnimations, onChange: f => listeners.push(f), openDialog, close };
})(typeof window !== "undefined" ? window : globalThis);
