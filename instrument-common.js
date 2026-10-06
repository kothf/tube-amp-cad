/* Shared plumbing for the oscilloscope and spectrum analyzer windows:
   receives simulation results from the Tube Amp CAD and picks a scope part. */
(function () {
  "use strict";
  const Inst = {
    result: null,
    at: 0,
    scopeId: new URLSearchParams(location.search).get("scope"),
    listeners: []
  };
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tube_cad_v2") : null;
  if (bc) {
    bc.onmessage = e => {
      if (!e.data || e.data.type !== "SIM_RESULT") return;
      Inst.result = e.data; Inst.at = Date.now();
      Inst.listeners.forEach(f => f());
    };
    bc.postMessage({ type: "REQUEST_STATE" });
  }

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
    const r = Inst.result;
    if (!r) return { cls: "idle", text: "Waiting for the Circuit CAD…" };
    if (!r.ok) return { cls: "bad", text: r.error || "Circuit not simulated" };
    if (!Inst.scopes().length) return { cls: "idle", text: "Add an Oscilloscope part to the circuit and wire its inputs" };
    return { cls: "ok", text: "Live from CAD · " + Inst.scope().label };
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
