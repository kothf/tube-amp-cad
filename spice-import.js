/* =============================================================================
   Import a SPICE tube model — the dialog (CAD window). Paste or open a model, pick the
   subcircuit, check the pin roles (guessed from its comment or from how it behaves),
   name it, say which existing tube it is like (socket, pinout, ratings), and see its
   curves before adding it to the tube list.
   Depends on: spice-model.js, tube-db.js
   ============================================================================= */
(function (root) {
  "use strict";
  const SM = root.SpiceModel, $ = id => document.getElementById(id);
  const ROLES = [["A", "Plate (A)"], ["G", "Grid (G1)"], ["G2", "Screen (G2)"], ["K", "Cathode (K)"], ["TIE", "Tied to the cathode"]];
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let st = null, timer = 0, onAdd = null;

  function build() {
    const m = document.createElement("div"); m.className = "modal"; m.id = "spimp-modal"; m.hidden = true;
    m.innerHTML = `<div class="modal-box spimp">
      <div class="insp-title">Import a SPICE tube model</div>
      <p class="insp-help">Paste a tube model (<code>.SUBCKT … .ENDS</code>) from Koren, Ayumi, Duncan, Reefman or a maker's library, or open the file. It runs as written, behavioural sources and all; the curves show what it does.</p>
      <div class="spimp-grid">
        <div class="spimp-left">
          <textarea id="spimp-text" spellcheck="false" placeholder=".SUBCKT 12AX7 1 2 3 ; P G K&#10;+ PARAMS: MU=100 EX=1.4 KG1=1060 KP=600 KVB=300 RGI=2000&#10;E1 7 0 VALUE={V(1,3)/KP*LOG(1+EXP(KP*(1/MU+V(2,3)/SQRT(KVB+V(1,3)*V(1,3)))))}&#10;…&#10;.ENDS"></textarea>
          <div class="spimp-row"><button class="btn" id="spimp-open">Open a model file…</button><input type="file" id="spimp-file" accept=".inc,.lib,.sub,.cir,.mod,.spi,.txt,.subckt,.model" hidden><span class="insp-help" id="spimp-count"></span></div>
          <div id="spimp-msg"></div>
        </div>
        <div class="spimp-right">
          <div class="spimp-form">
            <span>Subcircuit</span><select id="spimp-sub"></select>
            <span>Pins</span><div id="spimp-pins"></div>
            <span>Name</span><input id="spimp-name" type="text">
            <span title="Socket, pinout, heater and ratings come from this tube">Like</span><select id="spimp-like"></select>
            <span>Pa max (W)</span><input id="spimp-pa" type="text">
            <span>Va max (V)</span><input id="spimp-va" type="text">
          </div>
          <canvas id="spimp-plot" width="460" height="280"></canvas>
          <div class="insp-help" id="spimp-est"></div>
        </div>
      </div>
      <div id="spimp-list"></div>
      <div class="modal-actions"><button class="btn" id="spimp-cancel">Cancel</button><button class="btn active" id="spimp-add" disabled>Add tube</button></div>
    </div>`;
    document.body.appendChild(m);
    $("spimp-text").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(parse, 250); });
    $("spimp-open").onclick = () => $("spimp-file").click();
    $("spimp-file").onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $("spimp-text").value = r.result; parse(); }; r.readAsText(f); e.target.value = ""; };
    $("spimp-sub").onchange = () => pick($("spimp-sub").value);
    ["spimp-name", "spimp-pa", "spimp-va"].forEach(id => $(id).addEventListener("input", () => { validate(); preview(); }));
    $("spimp-like").onchange = () => { const t = likeTube(); if (t) { $("spimp-pa").value = t.paMax; $("spimp-va").value = t.vaMax; } validate(); preview(); };
    $("spimp-cancel").onclick = close;
    $("spimp-add").onclick = add;
    m.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }
  const say = (kind, html) => { $("spimp-msg").innerHTML = html ? `<p class="insp-help ${kind}">${html}</p>` : ""; };
  const likeTube = () => (root.TUBE_DATABASE || []).find(t => t.commonName === $("spimp-like").value);
  const roles = () => [...document.querySelectorAll("#spimp-pins select")].map(s => s.value);

  function parse() {
    const text = $("spimp-text").value;
    st = { text, lib: null, c: null };
    $("spimp-sub").innerHTML = ""; $("spimp-pins").innerHTML = ""; $("spimp-count").textContent = "";
    if (!text.trim()) { say("", ""); validate(); preview(); return; }
    try { st.lib = SM.parseLib(text); } catch (e) { say("warn", "⚠ " + esc(e.message)); validate(); return; }
    const subs = st.lib.subckts;
    $("spimp-count").textContent = subs.length ? `${subs.length} subcircuit${subs.length > 1 ? "s" : ""} found` : "";
    if (!subs.length) { say("warn", "⚠ No <code>.SUBCKT</code> in the text."); validate(); preview(); return; }
    subs.forEach(s => { const o = document.createElement("option"); o.value = s.name; o.textContent = `${s.name} (${s.pins.length} pins)`; $("spimp-sub").appendChild(o); });
    pick(subs[0].name);
  }
  function pick(name) {
    st.c = null; $("spimp-pins").innerHTML = "";
    try { st.c = SM.compile(st.lib, name); } catch (e) { say("warn", `⚠ ${esc(name)}: ${esc(e.message)}`); validate(); preview(); return; }
    const g = SM.guessRoles(st.c);
    st.c.pins.forEach((p, i) => {
      const row = document.createElement("label"); row.className = "spimp-pin";
      row.innerHTML = `<code>${esc(p)}</code>`;
      const sel = document.createElement("select"); ROLES.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = g.roles[i]; sel.onchange = () => { likeDefaults(false); validate(); preview(); };
      row.appendChild(sel); $("spimp-pins").appendChild(row);
    });
    const db = root.TUBE_DATABASE || [], builtIn = n => db.some(t => t.commonName.toLowerCase() === n.toLowerCase() && !SM.isCustom(t));
    $("spimp-name").value = builtIn(name) ? `${name} (SPICE)` : name;
    likeDefaults(true, name);
    const notes = st.c.warnings.map(w => `• ${esc(w)}`);
    notes.unshift(g.fromHint ? `Pin roles from the model's comment (${esc(st.c.hint.slice(0, 60))}).` : g.score >= 0.99 ? "Pin roles worked out from how the model behaves: check them." : "⚠ The pin roles are a guess: set them, the curves will tell.");
    say(g.score >= 0.99 || g.fromHint ? "" : "warn", notes.join("<br>"));
    validate(); preview();
  }
  // the "like" list: tubes of the same kind; preselect the one named in the model, if any
  function likeDefaults(first, subName) {
    const kind = SM.kindOf(roles()), db = (root.TUBE_DATABASE || []).filter(t => !SM.isCustom(t) && t.category !== "rectifier" && (kind === "pentode") === !!t.koren.Pentode);
    const keep = $("spimp-like").value;
    $("spimp-like").innerHTML = db.map(t => `<option value="${esc(t.commonName)}">${esc(t.commonName)} — ${esc(t.type)}</option>`).join("");
    const norm = s => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const named = subName && db.find(t => norm(subName).includes(norm(t.commonName)) && norm(t.commonName).length >= 3);
    $("spimp-like").value = !first && db.some(t => t.commonName === keep) ? keep : named ? named.commonName : kind === "pentode" ? "EL34" : "12AX7";
    const t = likeTube(); if (t && (first || !keep)) { $("spimp-pa").value = t.paMax; $("spimp-va").value = t.vaMax; }
  }
  function spec() { return st && st.c ? { text: SM.extract(st.text, st.c.name) || st.text, sub: st.c.name, roles: roles() } : null; }
  function validate() {
    const r = st && st.c ? roles() : [], name = $("spimp-name").value.trim(), db = root.TUBE_DATABASE || [];
    let why = "";
    if (!st || !st.c) why = "Paste a model first";
    else if (!r.includes("A") || !r.includes("G") || !r.includes("K")) why = "A plate, a grid and a cathode pin are needed";
    else if (r.filter(x => x === "A").length > 1 || r.filter(x => x === "G").length > 1) why = "One plate and one grid pin";
    else if (!name) why = "Give it a name";
    else if (db.some(t => t.commonName === name && !SM.isCustom(t))) why = `${name} is a built-in tube: choose another name`;
    else if (!(parseFloat($("spimp-pa").value) > 0) || !(parseFloat($("spimp-va").value) > 0)) why = "Pa max and Va max are needed";
    $("spimp-add").disabled = !!why; $("spimp-add").title = why || "Add it to the tube list (kept in this browser and in circuits that use it)";
    return !why;
  }
  // the model's plate curves (and screen current dashed), Pa max dashed
  function preview() {
    const cv = $("spimp-plot"), x = cv.getContext("2d"), W = cv.width, H = cv.height, L = 46, B = 26, T = 10, R = 10;
    x.fillStyle = "#0b0f14"; x.fillRect(0, 0, W, H);
    const sp = spec(); $("spimp-est").textContent = "";
    if (!sp || !roles().includes("A") || !roles().includes("K")) { x.fillStyle = "#6e7781"; x.font = "12px sans-serif"; x.fillText("The curves appear here", L + 10, H / 2); return; }
    let t, est;
    try { t = SM.tube(sp); est = SM.estimate(sp, parseFloat($("spimp-va").value)); } catch (e) { say("warn", "⚠ " + esc(e.message)); return; }
    const vaMax = parseFloat($("spimp-va").value) || 400, pa = parseFloat($("spimp-pa").value) || 0, pent = t.kind === "pentode", vg2 = Math.min(250, vaMax * 0.6);
    const nice = v => { const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; };
    const step = nice(Math.max(0.1, Math.abs(est.vg) / 2)), grids = Array.from({ length: 7 }, (_, i) => -i * step);
    const curve = vg => Array.from({ length: 61 }, (_, i) => { const va = vaMax * i / 60, I = pent ? t.pentode(va, vg, vg2) : t.triode(va, vg); return [va, I[0], pent ? I[2] : 0]; });
    const cs = grids.map(curve);
    let ymax = 0; cs.forEach(c => c.forEach(([va, ia]) => { if (!pa || va * ia <= 2.5 * pa || va < vaMax * 0.15) ymax = Math.max(ymax, ia); }));
    ymax = nice(Math.max(ymax, 1e-4) * 1.05);
    const X = va => L + (W - L - R) * va / vaMax, Y = ia => H - B - (H - B - T) * Math.min(ia, ymax * 1.05) / ymax;
    x.strokeStyle = "#1b2430"; x.lineWidth = 1; x.font = "10px ui-monospace, monospace"; x.fillStyle = "#6e7781";
    for (let i = 0; i <= 5; i++) { const va = vaMax * i / 5; x.beginPath(); x.moveTo(X(va), T); x.lineTo(X(va), H - B); x.stroke(); x.fillText(va.toFixed(0), X(va) - 8, H - B + 13); }
    for (let i = 0; i <= 4; i++) { const ia = ymax * i / 4; x.beginPath(); x.moveTo(L, Y(ia)); x.lineTo(W - R, Y(ia)); x.stroke(); x.fillText((ia * 1000).toFixed(ia * 1000 < 10 ? 1 : 0), 4, Y(ia) + 3); }
    x.fillText("Va (V)", W - R - 40, H - 3); x.save(); x.translate(10, T + 40); x.fillText("mA", 0, 0); x.restore();
    if (pa) { x.strokeStyle = "#ff7b72"; x.setLineDash([4, 3]); x.beginPath(); for (let i = 1; i <= 80; i++) { const va = vaMax * (0.05 + 0.95 * i / 80); const p = [X(va), Y(pa / va)]; i === 1 ? x.moveTo(...p) : x.lineTo(...p); } x.stroke(); x.setLineDash([]); }
    cs.forEach((c, k) => {
      x.strokeStyle = `hsl(${190 + k * 18}, 70%, 60%)`; x.lineWidth = 1.5; x.beginPath(); c.forEach(([va, ia], i) => (i ? x.lineTo(X(va), Y(ia)) : x.moveTo(X(va), Y(ia)))); x.stroke();
      if (pent) { x.setLineDash([2, 3]); x.lineWidth = 1; x.beginPath(); c.forEach(([va, , i2], i) => (i ? x.lineTo(X(va), Y(i2)) : x.moveTo(X(va), Y(i2)))); x.stroke(); x.setLineDash([]); }
      const lab = c.find(([va, ia]) => ia >= ymax * 0.95) || c[c.length - 1]; x.fillStyle = x.strokeStyle; x.fillText(`${grids[k]}`, Math.min(X(lab[0]) + 2, W - R - 24), Math.max(Y(lab[1]) - 2, T + 9));
    });
    $("spimp-est").textContent = `${pent ? `Pentode, Vg2 ${vg2.toFixed(0)} V (screen current dotted)` : "Triode"} · curves every ${step} V of grid · at Va ${est.va.toFixed(0)} V, Vg ${est.vg} V: Ia ${(est.ia * 1000).toFixed(2)} mA, gm ${(est.gm * 1000).toFixed(2)} mA/V${est.rp && isFinite(est.rp) ? `, rp ${(est.rp / 1000).toFixed(1)} kΩ` : ""}, µ ${est.mu.toFixed(1)}`;
  }
  function list() {
    const mine = (root.TUBE_DATABASE || []).filter(SM.isCustom);
    $("spimp-list").innerHTML = mine.length ? `<div class="insp-sub">Imported tubes</div>` + mine.map(t => `<div class="spimp-item"><b>${esc(t.commonName)}</b><span class="insp-help">${esc(t.custom.sub)} · ${esc(t.custom.kind)} · like ${esc(t.custom.like || "—")}</span><button class="btn" data-rm="${esc(t.commonName)}">Remove</button></div>`).join("") : "";
    $("spimp-list").querySelectorAll("[data-rm]").forEach(b => { b.onclick = () => { if (onAdd && onAdd.inUse && onAdd.inUse(b.dataset.rm) && !confirm(`${b.dataset.rm} is used in this circuit. Remove it from the list anyway? (The circuit keeps its own copy.)`)) return; SM.remove(b.dataset.rm); list(); if (onAdd && onAdd.changed) onAdd.changed(); }; });
  }
  function add() {
    if (!validate()) return;
    const sp = spec();
    try {
      const entry = SM.makeTube({ name: $("spimp-name").value.trim(), text: sp.text, sub: sp.sub, roles: sp.roles, like: $("spimp-like").value, paMax: parseFloat($("spimp-pa").value), vaMax: parseFloat($("spimp-va").value) });
      SM.add(entry); close(); if (onAdd) onAdd(entry);
    } catch (e) { say("warn", "⚠ " + esc(e.message)); }
  }
  function close() { $("spimp-modal").hidden = true; }
  /** Open the dialog; done(entry) runs when a tube is added (done.inUse(name), done.changed() optional) */
  function open(done) {
    if (!$("spimp-modal")) build();
    onAdd = done || null; $("spimp-modal").hidden = false; list();
    if (!st) parse(); else preview();
    $("spimp-text").focus();
  }
  root.SpiceImport = { open, close, _state: () => st };
})(typeof window !== "undefined" ? window : globalThis);
