/* AI ▾ → Tube from a datasheet: a PDF goes to the model, which reads the ratings, the pinout and
   points along the plate curves (ai-datasheet.js); the Koren model is fitted to the points
   (koren-fit.js) and shown against them for review, and Add to library makes it a custom tube.
   Needs the user's AI key (cad-ai.js). */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadDatasheet(cad) {
    const { S, buildPalette, setStatus } = cad;
    const D = S.datasheet = { busy: false, found: [] };
    const $ = id => document.getElementById(id), esc = s => root.AiCircuit.esc(s);
    const MAX_MB = 30;
    let ai = null;

    function base64(file) {
      return new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, "")); r.onerror = () => bad(new Error("could not read " + file.name)); r.readAsDataURL(file); });
    }
    async function importPdf(file, name) {
      if (!file || D.busy || !ai) return;
      if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { ai.show(); ai.add({ kind: "error", text: `${file.name} is not a PDF.` }); return; }
      if (file.size > MAX_MB * 1048576) { ai.show(); ai.add({ kind: "error", text: `${file.name} is ${(file.size / 1048576).toFixed(1)} MB: the providers take PDFs up to about ${MAX_MB} MB. Save the pages with the ratings, the pinout and the plate curves as a smaller PDF.` }); return; }
      ai.show();
      D.busy = true;
      ai.add({ kind: "user", text: `Tube from a datasheet: ${file.name}`, prompt: "Read this datasheet." });
      try {
        const data = await base64(file);
        const names = (root.TUBE_DATABASE || []).filter(t => !t.custom && t.category !== "rectifier").map(t => t.commonName).join(", ");
        const text = await ai.call({ system: root.AiDatasheet.SYSTEM + "\n\nCommon tubes for \"similar\": " + names, maxTokens: 16000,
          messages: [{ role: "user", text: `Read this tube datasheet (${file.name}).${name ? ` The tube is the ${name}.` : ""}`, files: [{ name: file.name, mime: "application/pdf", data }] }] }, "Datasheet import");
        const j = root.AiClient.extractJson(text);
        if (name) j.name = name;
        const r = root.AiDatasheet.read(j);
        const builtIn = (root.TUBE_DATABASE || []).some(t => !t.custom && t.commonName.toLowerCase() === r.tube.commonName.toLowerCase());
        if (builtIn) { const n = r.tube.commonName + "-DS"; r.problems.push(`${r.tube.commonName} is a built-in tube: this one is named ${n}`); r.tube.commonName = r.tube.nameGost = r.tube.nameWestern = n; }
        const fit = root.AiDatasheet.model(r);
        r.file = file.name;
        D.found.push(r);
        r.fit = fit;
        r.entry = ai.add({ kind: "card", html: card(r, fit, D.found.length - 1) });
        setStatus("ok", `Datasheet import: ${r.tube.commonName}${fit ? `, model fitted to ${r.points.length} points (R² ${fit.r2.toFixed(3)})` : ""}. Review it in the AI tab.`);
      } catch (e) { ai.fail(e); }
      finally { D.busy = false; ai.render(); }
    }

    // the review: what was read, how well the model fits, the curves against the points
    function card(r, fit, k) {
      const t = r.tube, fmt = (v, u) => (v ? `${+(+v).toPrecision(4)} ${u}` : "—");
      const row = (a, b) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`;
      const pins = t.pinout.map(p => `${p.pin} ${esc(p.sym)}`).join(" · ");
      const params = Object.entries(t.koren.Pentode || t.koren.Triode).map(([a, b]) => `${a} ${b}`).join(", ");
      const q = fit ? (fit.r2 >= 0.98 ? "good" : fit.r2 >= 0.93 ? "fair" : "poor") : "";
      return `<h4>${esc(t.commonName)} · ${esc(r.kind)} · from ${esc(r.file || "a datasheet")}</h4>`
        + `<table class="ai-fixes ds-table">${row("Type", esc(t.type))}${row("Socket", esc(t.socket || "—") + (t.pinCount ? `, ${t.pinCount} pins` : ""))}${row("Pinout", pins || "—")}`
        + row("Heater", `${fmt(t.vh, "V")} / ${fmt(t.ih, "A")}`) + row("Ratings", `Va ${fmt(t.vaMax, "V")} · Pa ${fmt(t.paMax, "W")} · Ik ${fmt(t.ikMax, "mA")}` + (r.kind === "pentode" ? ` · Vg2 ${fmt(t.vg2Max, "V")} · Pg2 ${fmt(t.limits.pg2, "W")}` : ""))
        + row("Model", fit ? `Koren fitted to ${r.points.length} points${r.kind === "pentode" ? ` at Vg2 ${r.vg2} V` : ""}: R² ${fit.r2.toFixed(4)}, RMSE ${fit.rmse.toFixed(2)} mA (${q})` : `the ${esc(t.custom.like)}'s (too few curve points)`)
        + row("Parameters", `<span class="mono">${esc(params)}</span>`) + `</table>`
        + (fit ? chart(r) : "")
        + (r.problems.length ? `<p class="warn">${r.problems.map(esc).join("<br>")}</p>` : "")
        + (t.custom.notes ? `<p class="muted">${esc(t.custom.notes)}</p>` : "")
        + `<p class="muted">Check the pinout and ratings against the datasheet before you build with it: they were read by the AI.</p>`
        + `<div class="ai-row"><button class="btn primary" data-act="ds-add" data-arg="${k}"${r.added ? " disabled" : ""}>${r.added ? `✓ ${esc(t.commonName)} is in the library` : `Add ${esc(t.commonName)} to the library`}</button></div>`;
    }
    function chart(r) {
      const K = root.TubeSimEngine.Koren, m = r.tube.koren.Pentode || r.tube.koren.Triode;
      const W = 360, H = 200, vaMax = Math.max(...r.points.map(p => p.va)) * 1.05, iaMax = Math.max(...r.points.map(p => p.iaMa)) * 1.1 || 1;
      const X = v => 34 + v / vaMax * (W - 44), Y = i => H - 22 - i / iaMax * (H - 32);
      const vgs = [...new Set(r.points.map(p => p.vg))].sort((a, b) => b - a);
      const cols = ["var(--accent)", "var(--amber)", "#c792ea", "#3fb950", "#ff7b72", "#79c0ff", "#d2a8ff", "#ffa657"];
      let h = `<svg class="pw-chart ds-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Plate curves: the datasheet's points and the fitted model">`;
      vgs.forEach((vg, i) => {
        const c = cols[i % cols.length], pts = [];
        for (let k = 0; k <= 40; k++) { const va = vaMax * k / 40, ia = (r.kind === "pentode" ? K.pentodeIa(va, vg, r.vg2, m) : K.triodeIa(va, vg, m)) * 1000; pts.push(`${X(va).toFixed(1)},${Y(Math.min(ia, iaMax)).toFixed(1)}`); }
        h += `<polyline points="${pts.join(" ")}" style="stroke:${c}"/>`;
        r.points.filter(p => p.vg === vg).forEach(p => { h += `<circle cx="${X(p.va).toFixed(1)}" cy="${Y(p.iaMa).toFixed(1)}" r="2.6" style="fill:${c}"/>`; });
        const last = r.points.filter(p => p.vg === vg).sort((a, b) => b.va - a.va)[0];
        if (last) h += `<text class="ax" x="${Math.min(X(last.va) + 3, W - 30).toFixed(1)}" y="${(Y(last.iaMa) - 3).toFixed(1)}">${vg} V</text>`;
      });
      h += `<text class="ax" x="${W / 2}" y="${H - 4}" text-anchor="middle">Va → ${Math.round(vaMax)} V (dots: datasheet, lines: model)</text><text class="ax" x="4" y="12">${+iaMax.toPrecision(3)} mA</text></svg>`;
      return h;
    }
    function addToLibrary(k) {
      const r = D.found[+k]; if (!r || r.added) return;
      try {
        root.SpiceModel.add(r.tube);
        buildPalette();
        r.added = true; r.entry.html = card(r, r.fit, +k);
        ai.add({ kind: "note", text: `**${r.tube.commonName}** is in the tube library: pick it in a tube's inspector, or open it in the curve tracer. It is kept in this browser and saved inside the circuit files that use it; the tube inspector's **Import SPICE model…** lists it with a Remove button.` });
        setStatus("ok", `${r.tube.commonName} added to the tube library`);
      } catch (e) { ai.add({ kind: "error", text: e.message }); }
    }

    function open() {
      const m = $("sheet-modal"); if (!m) return;
      m.hidden = false; $("sheet-file").value = ""; $("sheet-name").value = "";
      setTimeout(() => $("sheet-file").focus(), 0);
    }
    function go() {
      const f = $("sheet-file").files[0]; if (!f) { $("sheet-file").focus(); return; }
      $("sheet-modal").hidden = true;
      importPdf(f, $("sheet-name").value.trim());
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-datasheet", open); bind("btn-sheet-go", go); bind("btn-sheet-cancel", () => { $("sheet-modal").hidden = true; });
      const m = $("sheet-modal"); if (m) m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; });
      ai.cardAction("ds-add", addToLibrary);
    }
    return { init, open, importPdf, addToLibrary };
  }
  root.CadDatasheet = CadDatasheet;
})(window);
