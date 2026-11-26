/* AI ▾ → Transistor or diode from a datasheet…: a datasheet (PDF or a picture of its pages) goes to
   the model, which reads the part's kind, pins, ratings and points along its typical curves
   (semi-fit.js SYSTEM); a SPICE .MODEL is fitted to them without the AI (SemiFit.fit) and shown
   against the points for review; Place on the sheet makes it a SPICE part, its model inside the
   circuit. Needs the user's AI key (cad-ai.js). */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadSemiFit(cad) {
    const { S, place, setStatus } = cad;
    const D = S.semifit = { busy: false, found: [] };
    const $ = id => document.getElementById(id), esc = s => root.AiCircuit.esc(s);
    const MAX_MB = 30, SF = () => root.SemiFit;
    let ai = null;

    async function importFile(file, name) {
      if (!file || D.busy || !ai) return;
      if (file.size > MAX_MB * 1048576) { ai.show(); ai.add({ kind: "error", text: `${file.name} is ${(file.size / 1048576).toFixed(1)} MB: the providers take files up to about ${MAX_MB} MB. Save the pages with the ratings and the typical curves on their own.` }); return; }
      ai.show();
      D.busy = true;
      ai.add({ kind: "user", text: `Transistor or diode from a datasheet: ${file.name}`, prompt: "Read this datasheet." });
      try {
        const f = await root.CadPicture.readFile(file, 2400);
        const text = await ai.call({ system: SF().SYSTEM, maxTokens: 16000,
          messages: [{ role: "user", text: `Read this datasheet (${file.name}).${name ? ` The part is the ${name}.` : ""}`, files: [{ name: file.name, mime: f.mime, data: f.data }] }] }, "Datasheet import");
        const j = root.AiClient.extractJson(text);
        if (name) j.name = name;
        const r = SF().read(j);
        r.file = file.name;
        r.fit = SF().fit(r);
        D.found.push(r);
        r.entry = ai.add({ kind: "card", html: card(r, D.found.length - 1) });
        setStatus("ok", `Datasheet import: ${r.name} (${SF().KINDS[r.kind]}), model fitted (${r.fit.quality}). Review it in the AI tab.`);
      } catch (e) { ai.fail(e); }
      finally { D.busy = false; ai.render(); }
    }

    const fmt = v => (root.CadLib && root.CadLib.fmtEng ? root.CadLib.fmtEng(v) : String(+(+v).toPrecision(3)));
    function card(r, k) {
      const F = r.fit, row = (a, b) => `<tr><td>${esc(a)}</td><td>${b}</td></tr>`, ra = r.ratings;
      const vName = r.kind === "diode" ? "VRRM" : r.kind === "zener" ? "" : /mos|jf/.test(r.kind) ? "VDS" : "VCEO";
      const rate = [vName && ra.vmax && `${vName} ${fmt(ra.vmax)}V`, ra.imax && `${/mos|jf/.test(r.kind) ? "ID" : r.kind === "diode" || r.kind === "zener" ? "IF" : "IC"} ${fmt(ra.imax)}A`, ra.ptot && `Ptot ${fmt(ra.ptot)}W`, ra.tjmax && `Tj ${Math.round(ra.tjmax)} °C`].filter(Boolean).join(" · ");
      const pins = r.pins ? r.pins.split("").join(" ") + " (pin 1 first)" : "—";
      const errs = F.err.map(e => `${esc(e.what)} ±${+e.v.toPrecision(2)} ${esc(e.unit)}`).join(", ");
      return `<h4>${esc(r.name)} · ${esc(SF().KINDS[r.kind])} · from ${esc(r.file || "a datasheet")}</h4>`
        + (r.notes ? `<p class="muted">${esc(r.notes)}</p>` : "")
        + `<table class="ai-fixes ds-table">${row("Package", esc(r.package || "—") + (r.maker ? ` · ${esc(r.maker)}` : ""))}${row("Pins", esc(pins))}${row("Ratings", esc(rate || "—"))}`
        + row("Model", `SPICE ${esc(F.type)} fitted to the datasheet's typical values: ${esc(errs)} (<b class="sf-q sf-${F.quality}">${F.quality}</b>)`) + `</table>`
        + `<div class="sf-charts">${F.curves.map(chart).join("")}</div>`
        + (r.uncertain.length ? `<p class="warn"><b>The AI was unsure of:</b></p><ul class="sf-unsure">${r.uncertain.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : "")
        + (r.problems.length ? `<p class="warn">${r.problems.map(esc).join("<br>")}</p>` : "")
        + (F.notes.length ? `<p class="muted">${F.notes.map(esc).join(" ")}</p>` : "")
        + `<details class="sf-model"><summary>The model</summary><pre class="mono">${esc(F.text)}</pre></details>`
        + `<p class="muted">Check the pins and ratings against the datasheet before you build with it: they were read by the AI. The model is fitted to typical values; your part will differ by its spread.</p>`
        + `<div class="ai-row"><button class="btn primary" data-act="sf-place" data-arg="${k}">Place ${esc(r.name)} on the sheet</button><button class="btn" data-act="sf-copy" data-arg="${k}">Copy the model</button></div>`;
    }
    // a curve of the model against the datasheet's points; log axes where the datasheet draws them
    function chart(c) {
      const W = 300, H = 180, L = 44, B = 24, T = 18, floor = c.logy ? Math.min(...c.pts.map(p => p[1])) / 10 : -Infinity;
      const line = c.line.filter(p => p[1] >= floor), all = line.concat(c.pts);
      const tx = v => (c.logx ? Math.log10(v) : v), ty = v => (c.logy ? Math.log10(v) : v);
      const xs = all.map(p => tx(p[0])).filter(isFinite), ys = all.map(p => ty(p[1])).filter(isFinite);
      let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = c.logy ? Math.min(...ys) : Math.min(0, ...ys), y1 = Math.max(...ys);
      if (!(x1 > x0)) x1 = x0 + 1; if (!(y1 > y0)) y1 = y0 + 1;
      const X = v => L + (tx(v) - x0) / (x1 - x0) * (W - L - 8), Y = v => H - B - (ty(v) - y0) / (y1 - y0) * (H - B - T);
      const unit = t => (/\((V|A)\)/.exec(t) || [])[1] || "", lab = (v, t) => fmt(v) + unit(t);
      const inside = p => isFinite(X(p[0])) && isFinite(Y(p[1]));
      let h = `<svg class="pw-chart sf-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(c.title)}: the datasheet's points and the fitted model">`;
      h += `<text class="ax" x="${L}" y="12">${esc(c.title)}</text>`;
      h += `<polyline class="thd" points="${line.filter(inside).map(p => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`;
      c.pts.filter(inside).forEach(p => { h += `<circle class="sf-pt" cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3"/>`; });
      const v = k => (c.logy ? Math.pow(10, k) : k), u = k => (c.logx ? Math.pow(10, k) : k);
      h += `<line class="g1" x1="${L}" y1="${T}" x2="${L}" y2="${H - B}"/><line class="g1" x1="${L}" y1="${H - B}" x2="${W - 8}" y2="${H - B}"/>`;
      h += `<text class="ax" x="${L - 3}" y="${T + 8}" text-anchor="end">${esc(lab(v(y1), c.y))}</text><text class="ax" x="${L - 3}" y="${H - B}" text-anchor="end">${esc(lab(v(y0), c.y))}</text>`;
      h += `<text class="ax" x="${L}" y="${H - 8}">${esc(lab(u(x0), c.x))}</text><text class="ax" x="${W - 8}" y="${H - 8}" text-anchor="end">${esc(lab(u(x1), c.x))}</text>`;
      h += `<text class="ax" x="${(W + L) / 2}" y="${H - 8}" text-anchor="middle">${esc(c.x.replace(/ \(.*\)$/, ""))}${c.logx ? " (log)" : ""}</text></svg>`;
      return h;
    }
    // the SPICE part's params, with the board's footprint when the app has the package with these pins
    function params(r) {
      const p = SF().partParams(r, r.fit), B = root.BoardCore, N = root.PartNo;
      const fp = r.package && r.pins ? `${r.package}-${r.pins}` : r.package;
      if (N && fp && B && B.footprint && B.footprint(fp)) p.part = { no: N.norm(r.name), maker: r.maker || "", text: r.package, fp, source: "Datasheet" };
      return p;
    }
    function placeIt(k) {
      const r = D.found[+k]; if (!r) return;
      place("spice", params(r));
      setStatus("ok", `${r.name}: click where it goes.`);
    }
    function copy(k) {
      const r = D.found[+k]; if (!r) return;
      const done = () => setStatus("ok", `${r.name}'s model copied`);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(r.fit.text).then(done, () => setStatus("warn", "The browser did not let the model be copied: open The model and select it."));
    }

    function open() {
      const m = $("semi-modal"); if (!m) return;
      m.hidden = false; $("semi-file").value = ""; $("semi-name").value = "";
      setTimeout(() => $("semi-file").focus(), 0);
    }
    function go() {
      const f = $("semi-file").files[0]; if (!f) { $("semi-file").focus(); return; }
      $("semi-modal").hidden = true;
      importFile(f, $("semi-name").value.trim());
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-semi", open); bind("btn-semi-go", go); bind("btn-semi-cancel", () => { $("semi-modal").hidden = true; });
      const m = $("semi-modal"); if (m) m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; });
      ai.cardAction("sf-place", placeIt);
      ai.cardAction("sf-copy", copy);
    }
    return { init, open, importFile, params };
  }
  root.CadSemiFit = CadSemiFit;
})(window);
