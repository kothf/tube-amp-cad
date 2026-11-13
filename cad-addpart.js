/* =============================================================================
   Add part…: a part by its maker's part number. Type the number, choose the package, place it.
   The model is found by spice-find.js in the public KiCad-Spice-Library and downloaded; the
   drawing follows from what the model is (an op-amp, a transistor, a diode, else a box with the
   model's pins); the package goes to the board with the part (params.part, as a looked-up part
   number does). A dual or quad op-amp becomes a part of your library with a unit per amplifier
   (part-lib.js opampPackage) and all its units are placed together.
   Depends on: spice-find.js, spice-net.js, cad-components.js, board-core.js, mpn.js, part-lib.js
   ============================================================================= */
(function (root) {
  "use strict";
  const esc = t => String(t === undefined || t === null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  // transistor cases and the orders of their pins, pad 1 first (seen from the marking, left to right)
  const CASES = {
    bjt: { cases: ["TO-92", "TO-126", "TO-220", "TO-247", "TO-3P", "TO-264", "TO-18", "SOT-23"], orders: ["EBC", "ECB", "BCE", "CBE", "BEC"], smd: "BEC", words: { E: "emitter", B: "base", C: "collector" } },
    mos: { cases: ["TO-220", "TO-247", "TO-3P", "TO-264", "TO-92", "TO-126", "SOT-23"], orders: ["GDS", "SGD", "DGS", "GSD"], smd: "GSD", words: { G: "gate", D: "drain", S: "source" } },
    jfet: { cases: ["TO-92", "TO-18", "SOT-23"], orders: ["DSG", "DGS", "SGD", "GSD"], smd: "DSG", words: { G: "gate", D: "drain", S: "source" } }
  };
  const FAMILY = { npn: "bjt", pnp: "bjt", nmos: "mos", pmos: "mos", njf: "jfet", pjf: "jfet" };
  /** The usual order of a transistor's pins in a case, from its number's family (to be checked against the datasheet) */
  function usualOrder(pn, family, pkg) {
    const n = String(pn || "").toUpperCase();
    if (pkg === "SOT-23") return CASES[family].smd;
    if (family === "bjt") {
      if (/^TO-(220|247|3P|264)/.test(pkg)) return "BCE";
      if (pkg === "TO-126") return "ECB";
      if (pkg === "TO-92") return /^(BC|BF)\d/.test(n) ? "CBE" : /^(2S[ABCD]|KS[ACP]|KT[A-Z]?\d|S[89]0|C\d{3,4}|A\d{3,4})/.test(n) ? "ECB" : "EBC";
      return "EBC";
    }
    if (family === "mos") return pkg === "TO-92" ? (/^BS\d/.test(n) ? "DGS" : "SGD") : "GDS";
    return "DSG";
  }
  /** The case a number's family usually comes in (the first offer; the user picks another if theirs differs) */
  function usualCase(pn, family) {
    const n = String(pn || "").toUpperCase();
    if (family === "diode") return /^(1N4148|1N914|1N4448|BA[STVWX]?\d|1N34|1N60|BZX|1N7\d\d|1N52\d\d)/.test(n) ? "DIODE-7.62" : /^(1N54\d\d|1N582\d|MUR4|UF54|FR30|SB[35]\d\d|MBR3|BY[25]\d\d)/.test(n) ? "DO-201AD" : "DIODE-10.16";
    if (/^(MMB|BC8[0-6]\d|BSS|2N7002|AO3|SI23|IRLML|FMM|BF8)/.test(n)) return "SOT-23";
    if (family === "bjt") {
      if (/^(MJL|2SC5200|2SA1943|2SC3281|2SA1302|2SC2922|2SA1216)/.test(n)) return "TO-264";
      if (/^(MJW|TIP3[56]|TIP14[0-7]|TIP29\d\d|2SC5242|2SA1962|NJW|BU[X]?\d|FJA)/.test(n)) return "TO-247";
      if (/^(BD1[3-8]\d|BD2[23]\d|BD43\d|BD67\d|BD68\d|MJE3[45]0|MJE1[78]\d|MJE2[04]\d|2SC2690|2SA1220|2SB649|2SD669|2SC3503|2SA1381|KSC3503|KSA1381|KSE3[45]0)/.test(n)) return "TO-126";
      if (/^(TIP|BD[2-9]\d\d|MJE|MJF|D4[45]H|2SC4793|2SA1837|BU\d|BDX|BDW|2N6[0-9]\d\d|2SC5171|2SA1930)/.test(n)) return "TO-220";
      return "TO-92";
    }
    if (family === "mos") {
      if (/^(2N700[01]|BS\d\d\d|VN\d|VP\d|ZV[NP]|LND|TN\d|TP\d|DN\d|LP0)/.test(n)) return "TO-92";
      if (/^(IRFP|IRGP|IXF[HKX]|IXT[HKQ]|FQA|FDA|STW|SPW|IPW|APT|2SK10[5-9]\d|2SJ16\d|2SK1530|2SJ201|FCH|STY)/.test(n)) return "TO-247";
      return "TO-220";
    }
    return "TO-92";
  }
  const DIODE_NAMES = { "DIODE-7.62": "DO-35, small glass (7.62 mm between holes)", "DIODE-10.16": "DO-41 (10.16 mm between holes)", "DIODE-12.7": "DO-41 or DO-15 (12.7 mm between holes)", "DIODE-15.24": "DO-15 (15.24 mm between holes)", "DIODE-20.32": "Large axial (20.32 mm between holes)", "DO-201AD": "DO-201AD, 3 A axial", "TO-220-KA": "TO-220, two leads", "MINIMELF": "MiniMELF" };
  /** How many amplifiers an op-amp's number usually means (the 072 of a TL072 a dual, the 074 a quad) */
  function usualAmps(pn) {
    const n = String(pn || "").toUpperCase();
    if (/(0[678]4|LM324|LM2902|LM348|4134|LM837|MC3340[34]|TLC27[47]4|OPA4\d|AD8[46]4|LMV?324|TS9[12]4)/.test(n)) return 4;
    if (/(0[678]2|553[23]|LM358|LM2904|LM833|1458|4558|4560|4580|2068|2114|4562|LME497[12]0|OPA2\d|AD8[26]2|AD712|LF353|LF412|TLC27[27]2|MC33078|LM4562|RC4559|OP2[27]5|LT1057|TS9[12]2)/.test(n)) return 2;
    return 1;
  }

  function CadAddPart(o) {
    // o: { thumb(type, params, w, h, big), place(type, params, more), library (CadLibrary), setStatus(kind, text), pasteModel(), index (url of spice-index.json) }
    const F = root.SpiceFind, SN = root.SpiceNet, $ = id => document.getElementById(id);
    let st = null;

    function build() {
      const m = document.createElement("div"); m.className = "modal"; m.id = "addpart-modal"; m.hidden = true;
      m.innerHTML = `<div class="modal-box addpart">
        <div class="insp-title">Add a part</div>
        <p class="insp-help">Type the maker's part number. Its SPICE model is looked up in the public KiCad SPICE library and downloaded, so the part is simulated as its maker describes it.</p>
        <form class="addpart-row" id="addpart-form"><input type="text" id="addpart-pn" placeholder="TL072CP, 2N3904, IRF540, 1N4148…" autocomplete="off" spellcheck="false" maxlength="40" aria-label="Part number"><button class="btn active" id="addpart-find" type="submit">Find</button></form>
        <div id="addpart-msg" class="insp-help" role="status"></div>
        <div id="addpart-body"></div>
        <div class="modal-actions"><button class="btn" id="addpart-paste" title="For a part the library does not have: paste or open the maker's SPICE model yourself">I have the model file…</button><span class="addpart-gap"></span><button class="btn" id="addpart-cancel">Cancel</button><button class="btn active" id="addpart-ok" disabled>Place on the sheet</button></div>
      </div>`;
      document.body.appendChild(m);
      m.addEventListener("mousedown", e => { if (e.target === m) close(); });
      m.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
      $("addpart-cancel").onclick = close;
      $("addpart-form").onsubmit = e => { e.preventDefault(); find(); };
      $("addpart-ok").onclick = done;
      $("addpart-paste").onclick = () => { close(); o.pasteModel(); };
    }
    const say = (kind, text) => { const el = $("addpart-msg"); el.className = "insp-help" + (kind ? " " + kind : ""); el.textContent = text || ""; };
    function close() { const m = $("addpart-modal"); if (m) m.hidden = true; st = null; }
    function open(pn) {
      if (!$("addpart-modal")) build();
      st = { pn: "", list: [], model: null, busy: 0 };
      $("addpart-pn").value = pn || ""; $("addpart-body").innerHTML = ""; $("addpart-ok").disabled = true; say("", "");
      document.body.appendChild($("addpart-modal")); $("addpart-modal").hidden = false;
      $("addpart-pn").focus();
      if (pn) return find();
      return Promise.resolve();
    }
    async function find() {
      const pn = $("addpart-pn").value.trim(), mine = ++st.busy;
      st.pn = pn; st.list = []; st.model = null; $("addpart-body").innerHTML = ""; $("addpart-ok").disabled = true;
      if (pn.length < 3) { say("warn", "Type at least three characters of the part number."); return; }
      say("", "Looking it up…");
      let ix;
      try { ix = await F.load(o.index); } catch (e) { if (st && mine === st.busy) say("warn", `⚠ The list of models could not be read (${e.message}). Check the connection and try again.`); return; }
      if (!st || mine !== st.busy) return;
      st.ix = ix; st.list = F.candidates(ix, pn, 12);
      if (!st.list.length) { say("warn", `No model of ${pn} in the library. If you have the maker's model file, press “I have the model file…”; the part number may also be spelled differently there (try it without its last letters).`); return; }
      await take(0);
    }
    // download candidate k and show what it is
    async function take(k) {
      const c = st.list[k], mine = ++st.busy; st.k = k; st.model = null; $("addpart-ok").disabled = true;
      say("", `Downloading the model of ${c.name}…`);
      let m;
      try { m = await F.get(st.ix, c); SN.flat(m.text, m.sub); }
      catch (e) { if (st && mine === st.busy) { say("warn", `⚠ ${c.name}: ${e.message}.${st.list.length > 1 ? " Another of the list may work." : ""}`); render(); } return; }
      if (!st || mine !== st.busy) return;
      st.model = m; st.sym = F.symFor(m); st.amps = st.sym === "opamp" ? usualAmps(st.pn) : 1; st.pkg = null; st.order = null;
      say("", ""); render();
    }
    // the footprints the board has for a SPICE part of this drawing (through-hole first, then surface)
    function boardOptions(sym, pins) {
      const B = root.BoardCore, def = root.CadLib.LIB.spice, c = { params: { sym, pinNames: pins, map: [] } };
      const g = B.physicalParts({ parts: [{ id: "x", type: "spice", label: "X1", params: c.params, pins: def.pins(c).map(p => ({ id: p.id, net: "n" + p.id })) }] })[0];
      return g ? g.options.filter(n => B.footprint(n)) : [];
    }
    function packages() {
      const m = st.model, sym = st.sym, fam = FAMILY[sym], B = root.BoardCore;
      if (fam) return CASES[fam].cases.filter(k => CASES[fam].orders.some(ord => B.footprint(`${k}-${ord}`))).map(k => ({ id: k, name: k + (k === "SOT-23" ? " (surface-mount)" : "") }));
      if (sym === "opamp") return (st.amps >= 4 ? [["DIP-14", "DIP-14"], ["SOIC-14", "SOIC-14 (surface-mount)"]] : [["DIP-8", "DIP-8"], ["SOIC-8", "SOIC-8 (surface-mount)"]]).map(([id, name]) => ({ id, name }));
      return boardOptions(sym, m.pins).map(n => ({ id: n, name: /^WIRE-/.test(n) ? `Wire pads (${n.slice(5)})` : (DIODE_NAMES[n] || n) + (B.isSmd && B.isSmd(n) ? " (surface-mount)" : "") }));
    }
    function orders() {
      const fam = FAMILY[st.sym], B = root.BoardCore; if (!fam) return [];
      if (st.pkg === "SOT-23") return [CASES[fam].smd];
      return CASES[fam].orders.filter(ord => B.footprint(`${st.pkg}-${ord}`));
    }
    function fpName() { return FAMILY[st.sym] ? `${st.pkg}-${st.order}` : st.pkg; }
    // what goes on the sheet: a SPICE part's params
    function spiceParams() {
      const m = st.model, S = root.CadLib.SPICE_SYMS[st.sym], N = root.PartNo, name = st.list[st.k].name;
      const p = { name, text: m.text, sub: m.sub, sym: st.sym, pinNames: S ? m.pins.slice() : m.pins.map(x => String(x).toUpperCase()), map: S ? m.pins.map((_, i) => (i < S.pins.length ? S.pins[i] : "")) : m.pins.map((_, i) => String(i + 1)) };
      p.partno = st.pn;
      if (N && st.pkg) p.part = { no: N.norm(st.pn), maker: "", text: FAMILY[st.sym] ? st.pkg : (DIODE_NAMES[st.pkg] || st.pkg).replace(/^WIRE-(\d+)$/, "wire pads").replace(/ \(.*$/, "").replace(/,.*$/, ""), fp: fpName(), source: "Add part" };
      return p;
    }
    function render() {
      const host = $("addpart-body"), c = st.list[st.k], m = st.model;
      const pick = st.list.length > 1 ? `<label class="addpart-f"><span>Model</span><select id="addpart-cand">${st.list.map((x, i) => `<option value="${i}">${esc(x.name)} · ${esc(F.KINDS[x.kind] || "model")}${x.kind === "X" && x.pins ? `, ${x.pins} pins` : ""}</option>`).join("")}</select></label>` : "";
      if (!m) { host.innerHTML = pick; if (pick) { $("addpart-cand").value = String(st.k); $("addpart-cand").onchange = () => take(+$("addpart-cand").value); } return; }
      const packs = packages();
      if (!st.pkg || !packs.some(p => p.id === st.pkg)) { const u = usualCase(st.pn, FAMILY[st.sym] || st.sym); st.pkg = packs.some(p => p.id === u) ? u : packs.length ? packs[0].id : null; }
      const fam = FAMILY[st.sym], ords = orders();
      if (fam && !ords.includes(st.order)) st.order = ords.includes(usualOrder(st.pn, fam, st.pkg)) ? usualOrder(st.pn, fam, st.pkg) : ords[0];
      const S = root.CadLib.SPICE_SYMS[st.sym], what = S ? S.name : `A box with the model's ${m.pins.length} pins`;
      const src = c.file.split("/").slice(1, 3).join(" / ").replace(/^Manufacturer \/ /, "");
      const words = fam ? st.order.split("").map(l => CASES[fam].words[l]).join(", ") : "";
      host.innerHTML = `<div class="addpart-found"><img id="addpart-pic" alt="" src="${o.thumb("spice", spiceParams(), 150, 110, true)}">
          <div><b>${esc(c.name)}</b><span>${esc(what)}</span>${c.why !== "exact" ? `<span>the nearest to ${esc(st.pn)}</span>` : ""}<span class="muted">${esc(src)}</span></div></div>
        ${pick}
        ${st.sym === "opamp" ? `<label class="addpart-f" title="How many amplifiers the package holds: a TL071 one, a TL072 two, a TL074 four"><span>Amplifiers in the package</span><select id="addpart-amps"><option value="1">One</option><option value="2">Two (dual)</option><option value="4">Four (quad)</option></select></label>` : ""}
        ${packs.length ? `<label class="addpart-f"><span>Package</span><select id="addpart-pkg">${packs.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label>` : ""}
        ${fam && ords.length > 1 ? `<label class="addpart-f" title="Hold the part with its marking facing you and its legs down: the pins from left to right. The usual order for this kind of number is offered; the datasheet has the last word."><span>Pins, left to right</span><select id="addpart-order">${ords.map(x => `<option value="${x}">${x.split("").join(" ")}</option>`).join("")}</select></label><p class="insp-help addpart-check">${esc(words)}: check this against the datasheet, makers differ.</p>` : ""}
        ${st.sym === "box" ? `<p class="insp-help">The pads take the model's pins in the model's order, pad 1 first: check them against the datasheet's pinout.</p>` : ""}
        ${st.sym === "opamp" && st.amps > 1 ? `<p class="insp-help">It goes into your parts library and its ${st.amps} amplifiers and supply pins are placed together (DA1.1 … DA1.${st.amps + 1}).</p>` : ""}`;
      if (pick) { $("addpart-cand").value = String(st.k); $("addpart-cand").onchange = () => take(+$("addpart-cand").value); }
      if ($("addpart-amps")) { $("addpart-amps").value = String(st.amps); $("addpart-amps").onchange = () => { st.amps = +$("addpart-amps").value; st.pkg = null; render(); }; }
      if ($("addpart-pkg")) { $("addpart-pkg").value = st.pkg; $("addpart-pkg").onchange = () => { st.pkg = $("addpart-pkg").value; st.order = null; render(); }; }
      if ($("addpart-order")) { $("addpart-order").value = st.order; $("addpart-order").onchange = () => { st.order = $("addpart-order").value; render(); }; }
      $("addpart-ok").disabled = false;
    }
    function done() {
      if (!st || !st.model) return;
      const m = st.model, name = st.list[st.k].name, pn = st.pn;
      if (st.sym === "opamp" && st.amps > 1) {
        // a dual or quad: a library part of several units, all of them placed at once
        const made = root.PartLib.opampPackage(name, st.amps, /^SOIC/.test(st.pkg) ? "soic" : "dip", { text: m.text, sub: m.sub });
        const id = o.library.addPart(made.part, made.fp), units = st.amps + 1, prm = u => Object.assign(o.library.paramsOf(id, u), { partno: pn });
        const more = []; for (let u = 2; u <= units; u++) more.push({ params: prm(u), dx: u === units ? 200 : 0, dy: u === units ? 0 : (u - 1) * 120 });
        close(); o.place("part", prm(1), more);
        o.setStatus("ok", `${name}: click where its amplifiers go; it is in My library now.`);
        return;
      }
      const p = spiceParams();
      close(); o.place("spice", p);
      o.setStatus("ok", `${name}${p.part ? ` in ${p.part.text}` : ""}: click where it goes.`);
    }
    return { open, close, find, state: () => st, params: () => (st && st.model ? spiceParams() : null) };
  }
  root.CadAddPart = CadAddPart;
  root.CadAddPart.usualOrder = usualOrder; root.CadAddPart.usualAmps = usualAmps; root.CadAddPart.usualCase = usualCase;
})(typeof window !== "undefined" ? window : globalThis);
