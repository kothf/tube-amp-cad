/* Shared plumbing for the oscilloscope and spectrum analyzer windows:
   receives simulation results from the Tube Amp CAD and picks a scope part. */
(function () {
  "use strict";
  const Inst = {
    result: null,
    at: 0,
    scopeId: new URLSearchParams(location.search).get("scope"),
    listeners: [],
    // this window's version, from its own script URL (?v=x.y.z), to compare with the CAD's
    version: (() => { const sc = document.currentScript; const q = sc && sc.src.split("?")[1]; return q ? "?" + q : ""; })(),
    cad: null,        // last status line of the CAD { kind, text, busy }
    problem: null     // why the CAD does not respond, shown instead of the normal status
  };
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;
  if (bc) {
    bc.onmessage = e => {
      if (!e.data) return;
      const d = e.data;
      if (d.version !== undefined) Inst.problem = d.version === Inst.version ? null
        : `The Circuit CAD tab runs another version (${(d.version || "?").replace("?v=", "")}, this window ${(Inst.version || "?").replace("?v=", "")}): reload both tabs.`;
      if (d.type === "SIM_RESULT") { Inst.result = d; Inst.at = Date.now(); }
      else if (d.type === "TRANSIENT_RESULT") Inst.transient = d;   // power-on transient from the CAD
      else if (d.type === "SIM_STATUS") Inst.cad = Object.assign({ at: Date.now() }, d);
      else if (d.type === "ACK") { if (pending[d.id]) { clearTimeout(pending[d.id]); delete pending[d.id]; } }
      else return;
      Inst.listeners.forEach(f => f());
    };
    bc.postMessage({ type: "REQUEST_STATE" });
  }

  Inst.transient = null;
  /** Ask the CAD: { type: "RUN_SIM" } | { type: "RUN_TRANSIENT", tStop } | { type: "STOP_TRANSIENT" } */
  // A request the CAD must acknowledge within 2 s; a CAD tab opened before an
  // update ignores requests it does not know, and the window says so.
  const pending = {};
  let reqId = 0;
  Inst.send = msg => {
    if (!bc) return;
    const id = ++reqId;
    pending[id] = setTimeout(() => {
      delete pending[id];
      Inst.problem = Inst.result ? "The Circuit CAD did not answer: it is probably an older version still open. Reload the CAD tab (Ctrl+Shift+R) and try again."
        : "No Circuit CAD is open: open it, load the circuit, then try again.";
      Inst.listeners.forEach(f => f());
    }, 2000);
    bc.postMessage(Object.assign({ id }, msg));
  };
  Inst.transientScope = () => { const t = Inst.transient; if (!t || !t.scopes) return null; const id = (Inst.scope() || {}).id || Inst.scopeId; return t.scopes.find(x => x.id === id) || t.scopes[0] || null; };
  Inst.onUpdate = f => Inst.listeners.push(f);
  Inst.scopes = () => (Inst.result && Inst.result.ok && Inst.result.scopes) || [];
  Inst.scope = () => { const s = Inst.scopes(); return s.find(x => x.id === Inst.scopeId) || s[0] || null; };
  Inst.selectScope = id => {
    Inst.scopeId = id;
    const u = new URL(location.href); u.searchParams.set("scope", id); history.replaceState(null, "", u);
    Inst.listeners.forEach(f => f());
  };
  // Fill a <select> with the scope parts of the circuit
  Inst.bindScopeSelect = sel => {
    const fill = () => {
      const list = Inst.scopes(), cur = Inst.scope();
      sel.innerHTML = list.length ? list.map(s => `<option value="${s.id}">${s.label}</option>`).join("") : `<option>no scope in circuit</option>`;
      sel.disabled = !list.length;
      if (cur) sel.value = cur.id;
    };
    sel.addEventListener("change", () => Inst.selectScope(sel.value));
    Inst.onUpdate(fill); fill();
  };
  Inst.status = () => {
    if (Inst.problem) return { cls: "bad", text: Inst.problem };
    if (Inst.cad && Inst.cad.busy) return { cls: "idle", text: "CAD: " + Inst.cad.text };
    const r = Inst.result;
    if (!r) return { cls: "idle", text: "Waiting for the Circuit CAD…" };
    if (!r.ok) return { cls: "bad", text: r.error || "Circuit not simulated" };
    if (!Inst.scopes().length) return { cls: "idle", text: "Add an Oscilloscope part to the circuit and wire its inputs" };
    const c = Inst.cad, recent = c && !c.busy && c.kind !== "idle" && Date.now() - (c.at || 0) < 15000;
    return { cls: "ok", text: "Live from CAD · " + Inst.scope().label + (recent ? " · " + c.text : "") };
  };

  // Engineering format, e.g. 0.0021 -> "2.1m"
  Inst.fmt = (v, unit, digits) => {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    if (Math.abs(v) < 1e-9) v = 0;
    const a = Math.abs(v);
    for (const [f, p] of [[1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"]]) {
      if (a >= f * 0.9995 || f === 1e-9) {
        const n = v / f, d = digits !== undefined ? digits : (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
        return parseFloat(n.toFixed(d)) + p + (unit || "");
      }
    }
    return String(v);
  };
  Inst.niceStep = v => {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-12))));
    for (const m of [1, 2, 5, 10]) if (m * p >= v * 0.9999) return m * p;
    return 10 * p;
  };
  // Amplitude/phase of one frequency over a whole-period capture
  Inst.dft = (arr, f, dt) => {
    const N = arr.length - 1;
    let re = 0, im = 0;
    for (let i = 0; i < N; i++) { const ph = 2 * Math.PI * f * i * dt; re += arr[i] * Math.cos(ph); im -= arr[i] * Math.sin(ph); }
    return { amp: 2 * Math.hypot(re, im) / N, phase: Math.atan2(im, re) };
  };
  window.Instrument = Inst;
})();
