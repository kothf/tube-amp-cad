/* =============================================================================
   A SPICE part's model — the dialog (CAD window). Paste or open a maker's model file,
   pick the subcircuit or .MODEL in it, name it, choose the symbol it is drawn with
   and say which of the model's pins is which pin of that symbol. The part then runs
   the model as written (spice-net.js).
   Depends on: spice-model.js, spice-net.js, cad-components.js (CadLib.SPICE_SYMS)
   ============================================================================= */
(function (root) {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  let st = null, timer = 0, onDone = null;

  function build() {
    const m = document.createElement("div"); m.className = "modal"; m.id = "sppart-modal"; m.hidden = true;
    m.innerHTML = `<div class="modal-box spimp">
      <div class="insp-title">SPICE part: its model</div>
      <p class="insp-help">Paste a SPICE model from a maker's site (an op-amp, a regulator, a power MOSFET: <code>.SUBCKT … .ENDS</code>, or a transistor's or a diode's <code>.MODEL</code>), or open the file. The part is simulated as the model is written.</p>
      <div class="spimp-grid">
        <div class="spimp-left">
          <textarea id="sppart-text" spellcheck="false" placeholder=".SUBCKT TL072 1 2 3 4 5&#10;* non-inverting input, inverting input, V+, V-, output&#10;…&#10;.ENDS"></textarea>
          <div class="spimp-row"><button class="btn" id="sppart-open">Open a model file…</button><input type="file" id="sppart-file" accept=".inc,.lib,.sub,.cir,.mod,.spi,.txt,.subckt,.model,.fam,.ckt,.sp" hidden><span class="insp-help" id="sppart-count"></span></div>
          <div id="sppart-msg"></div>
        </div>
        <div class="spimp-right">
          <div class="spimp-form">
            <span title="A file may hold many parts: the one this part is">Part in the file</span><div><input id="sppart-find" type="search" placeholder="Find…" hidden><select id="sppart-sub"></select></div>
            <span>Name</span><input id="sppart-name" type="text">
            <span title="How the part is drawn on the sheet">Symbol</span><select id="sppart-sym"></select>
            <span title="Each pin of the model, in the model's order, and the pin of the symbol it is">Pins</span><div id="sppart-pins"></div>
          </div>
          <div class="insp-help" id="sppart-est"></div>
        </div>
      </div>
      <div class="modal-actions"><button class="btn" id="sppart-cancel">Cancel</button><button class="btn active" id="sppart-ok" disabled>Use this model</button></div>
    </div>`;
    document.body.appendChild(m);
    $("sppart-text").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => parse(), 250); });
    $("sppart-open").onclick = () => $("sppart-file").click();
    $("sppart-file").onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { $("sppart-text").value = r.result; parse(); }; r.readAsText(f); e.target.value = ""; };
    $("sppart-sub").onchange = () => pick($("sppart-sub").value);
    $("sppart-find").addEventListener("input", fillSubs);
    $("sppart-sym").onchange = () => { fillPins(null); validate(); };
    $("sppart-name").addEventListener("input", validate);
    $("sppart-cancel").onclick = close;
    $("sppart-ok").onclick = done;
    m.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  }
  const say = (kind, html) => { $("sppart-msg").innerHTML = html ? `<p class="insp-help ${kind}">${html}</p>` : ""; };
  const syms = () => root.CadLib.SPICE_SYMS;

  function parse(keep) {
    const text = $("sppart-text").value;
    st = { text, lib: null, items: [], f: null, keep: keep || null };
    $("sppart-sub").innerHTML = ""; $("sppart-pins").innerHTML = ""; $("sppart-count").textContent = ""; $("sppart-est").textContent = "";
    if (!text.trim()) { say("", ""); validate(); return; }
    try { st.lib = root.SpiceModel.parseLib(text); st.items = root.SpiceNet.list(st.lib); } catch (e) { say("warn", "⚠ " + esc(e.message)); validate(); return; }
    // the subcircuits no other one calls come first: the parts themselves, before their building blocks
    const called = new Set(); st.lib.subckts.forEach(s => s.els.forEach(e => { if (/^x/i.test(e.s)) root.SpiceModel.tokens(e.s).forEach(t => called.add(t.toLowerCase())); }));
    st.items.forEach(it => { it.inner = it.kind === "subckt" && called.has(it.name.toLowerCase()); });
    st.items.sort((a, b) => a.inner - b.inner);
    const n = st.items.length;
    $("sppart-count").textContent = n ? `${n} part${n > 1 ? "s" : ""} in the text` : "";
    $("sppart-find").hidden = n < 12; $("sppart-find").value = "";
    if (!n) { say("warn", "⚠ No <code>.SUBCKT</code> and no transistor or diode <code>.MODEL</code> in the text."); validate(); return; }
    fillSubs();
  }
  function fillSubs() {
    const q = $("sppart-find").value.trim().toLowerCase(), sel = $("sppart-sub"), was = st.keep ? st.keep.sub : sel.value;
    const list = st.items.filter(it => !q || it.name.toLowerCase().includes(q)).slice(0, 400);
    sel.innerHTML = list.map(it => `<option value="${esc(it.name)}">${esc(it.name)} (${it.kind === "subckt" ? `${it.pins.length} pins${it.inner ? ", inside another" : ""}` : esc(it.hint)})</option>`).join("");
    if (!list.length) { st.f = null; $("sppart-pins").innerHTML = ""; validate(); return; }
    const at = list.find(it => it.name.toLowerCase() === String(was || "").toLowerCase()) || list[0];
    sel.value = at.name; pick(at.name);
  }
  // the symbol a model most likely wants: a lone device its own, five pins an op-amp, else a box
  function guessSym(f) {
    const k = root.CadLib.SPICE_KIND_SYM[f.kind]; if (k) return k;
    return f.pins.length === 5 ? "opamp" : "box";
  }
  function pick(name) {
    st.f = null; $("sppart-pins").innerHTML = ""; $("sppart-est").textContent = "";
    const keep = st.keep && String(st.keep.sub).toLowerCase() === name.toLowerCase() ? st.keep : null;
    try { st.f = root.SpiceNet.flatten(st.lib, name); } catch (e) { say("warn", `⚠ ${esc(name)} cannot be simulated: ${esc(e.message)}`); validate(); return; }
    const f = st.f, S = syms(), fits = Object.keys(S).filter(k => S[k].pins.length <= f.pins.length);
    $("sppart-sym").innerHTML = `<option value="box">Box with the model's pins</option>` + fits.map(k => `<option value="${k}">${esc(S[k].name)}</option>`).join("");
    $("sppart-sym").value = keep && (keep.sym === "box" || fits.includes(keep.sym)) ? keep.sym : fits.includes(guessSym(f)) ? guessSym(f) : "box";
    $("sppart-name").value = keep && keep.name ? keep.name : f.name.toUpperCase() === f.name ? f.name : f.name;
    fillPins(keep);
    const notes = f.warnings.map(w => `• ${esc(w)}`);
    if (f.hint) notes.unshift(`The model's note: ${esc(f.hint.slice(0, 160))}`);
    say("", notes.join("<br>"));
    $("sppart-est").textContent = `${f.kind === "subckt" ? "Subcircuit" : "Model"} ${f.name}: ${f.els.length} element${f.els.length === 1 ? "" : "s"} on ${f.nNodes - 1} nodes.`
      + (f.pins.length === 5 && $("sppart-sym").value === "opamp" ? " Five pins: taken as an op-amp in the usual order (non-inverting input, inverting input, V+, V−, output); check it against the model's note." : "");
    validate();
  }
  // one row per pin of the model: its name (a box: the name drawn, which can be changed) and the symbol's pin it is
  function fillPins(keep) {
    const f = st.f, host = $("sppart-pins"); host.innerHTML = ""; if (!f) return;
    const sym = $("sppart-sym").value, sy = syms()[sym], lib = root.CadLib.LIB;
    const symPins = sy ? lib[sy.type].pins({ params: {} }).filter(p => sy.pins.includes(p.id)) : [];
    f.pins.forEach((p, i) => {
      const row = document.createElement("label"); row.className = "spimp-pin";
      row.innerHTML = `<code title="Pin ${i + 1} of the model">${esc(p)}</code>`;
      if (!sy) {
        const inp = document.createElement("input"); inp.type = "text"; inp.maxLength = 9; inp.value = keep && keep.sym === "box" && keep.pinNames && keep.pinNames[i] ? keep.pinNames[i] : p.toUpperCase();
        inp.title = "The name drawn in the box"; row.appendChild(inp);
      } else {
        const sel = document.createElement("select");
        sel.innerHTML = symPins.map(q => `<option value="${esc(q.id)}">${esc(q.id)}${q.name ? " · " + esc(q.name) : ""}</option>`).join("") + `<option value="0">Ground</option><option value="">Not connected</option>`;
        const def = keep && keep.sym === sym && keep.map && keep.map[i] !== undefined ? keep.map[i] : i < sy.pins.length ? sy.pins[i] : "";
        sel.value = def; sel.onchange = validate; row.appendChild(sel);
      }
      host.appendChild(row);
    });
  }
  function result() {
    const f = st.f, sym = $("sppart-sym").value, sy = syms()[sym], rows = [...document.querySelectorAll("#sppart-pins .spimp-pin")];
    const text = root.SpiceNet.extract(st.text, f.name) || st.text;
    if (!sy) return { name: $("sppart-name").value.trim(), text, sub: f.name, sym: "box", pinNames: rows.map((r, i) => r.querySelector("input").value.trim() || String(i + 1)), map: f.pins.map((_, i) => String(i + 1)) };
    return { name: $("sppart-name").value.trim(), text, sub: f.name, sym, pinNames: f.pins.slice(), map: rows.map(r => r.querySelector("select").value) };
  }
  function validate() {
    let why = "";
    if (!st || !st.f) why = "Paste a model first";
    else if (!$("sppart-name").value.trim()) why = "Give it a name";
    else {
      const sy = syms()[$("sppart-sym").value];
      if (sy) {
        const map = [...document.querySelectorAll("#sppart-pins select")].map(s => s.value), miss = sy.pins.filter(id => !map.includes(id)), twice = sy.pins.filter(id => map.filter(m => m === id).length > 1);
        if (miss.length) why = `No pin of the model is the symbol's ${miss.join(", ")}`;
        else if (twice.length) why = `Two pins of the model are the symbol's ${twice.join(", ")}`;
      }
    }
    $("sppart-ok").disabled = !!why; $("sppart-ok").title = why || "Put the model in the part (it is saved with the circuit)";
    return !why;
  }
  function done() { if (!validate()) return; const r = result(), cb = onDone; close(); if (cb) cb(r); }
  function close() { $("sppart-modal").hidden = true; onDone = null; }
  /** Open for a part's params (its model, if it has one, is shown); cb(params to set) on "Use this model" */
  function open(params, cb) {
    if (!$("sppart-modal")) build();
    onDone = cb;
    $("sppart-text").value = (params && params.text) || "";
    $("sppart-modal").hidden = false;
    parse(params && params.text ? { sub: params.sub, name: params.name, sym: params.sym, map: params.map, pinNames: params.pinNames } : null);
    $("sppart-text").focus();
  }
  root.SpicePart = { open };
})(window);
