/* The CAD's bill of materials panel under the schematic (B): the simulated stress per part
   (Sim. max), the table with its part-number cells, and the TXT / CSV / XLSX / PDF exports
   (bom.js builds and writes the lists). */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadBom = function (cad) {
    const { S, baseName, bind, cmds, renderChecks, renderTolerance, commit, fmtEng, frames, netDC, otDcCurrent, pinCurrent, pinNetOf, render, resistorPower, seriesPart, setStatus, speakerPower, tubeByName, tubeData, tubeLimits, updateInspector, vRmsAcross, waveOf } = cad;
    const BOM_KEY = "tubecad_bom";
    const bomOpts = { open: false, tab: "bom", sockets: true, bench: false, height: 0 };   // open, tab: the panel under the sheet and its tab
    try { Object.assign(bomOpts, JSON.parse(localStorage.getItem(BOM_KEY)) || {}); } catch (e) {}
    const saveBomOpts = () => { try { localStorage.setItem(BOM_KEY, JSON.stringify(bomOpts)); } catch (e) {} };
    let bomStale = false, bomSelShown = "";
    // a click on the sheet shows its selection in the BOM again
    const clearBomShown = () => { bomSelShown = ""; };
    // simulated worst case of a part, for the BOM's Sim. max column: dissipation of resistors,
    // pots, transistors and zeners (against their ratings), capacitor peak voltage, LED current, a
    // diode's peak inverse voltage and current, a tube's most-used rating, a choke's and a
    // transformer's DC current, a speaker's power. v orders the parts of one BOM line.
    const DIODE_RATE = CadLib.DIODES;
    const share = (x, m) => (m > 0 ? ` · ${Math.round(x / m * 100)}%` : "");
    function partStress(c) {
      const r = S.sim.result;
      if (!r) return null;
      if (c.type === "pot") {
        const half = sfx => (S.sim.netlist.elements.find(e => e.id === c.id + sfx) || {}).r, [ra, rb] = [half("#a"), half("#b")];
        if (!(ra > 0 && rb > 0)) return null;
        const w1 = waveOf(c, "1"), ww = waveOf(c, "W"), w2 = waveOf(c, "2");
        let p;
        if (w1 && ww && w2) { p = 0; for (let i = 0; i < w1.length; i++) p += (w1[i] - ww[i]) ** 2 / ra + (ww[i] - w2[i]) ** 2 / rb; p /= w1.length; }
        else { const [a, w, b] = ["1", "W", "2"].map(q => netDC(pinNetOf(c, q))); if ([a, w, b].includes(null)) return null; p = (a - w) ** 2 / ra + (w - b) ** 2 / rb; }
        return { v: p, text: fmtEng(p, "W") };
      }
      if (c.type === "diode") {
        const wa = waveOf(c, "A"), wk = waveOf(c, "K"), tr = r.tran && r.tran.devices[c.id], iav = pinCurrent(c, "A"), m = DIODE_RATE[c.params.model];
        let piv = null, ipk = null;
        if (wa && wk) { piv = 0; for (let i = 0; i < wa.length; i++) piv = Math.max(piv, wk[i] - wa[i]); }
        if (tr) { ipk = 0; for (const x of tr.i) ipk = Math.max(ipk, x); }
        if (piv === null && iav === null) return null;
        const parts = [piv !== null ? `PIV ${fmtEng(piv, "V")}` : "", iav !== null ? `${fmtEng(Math.abs(iav), "A")} avg` : "", ipk !== null ? `${fmtEng(ipk, "A")} pk` : ""].filter(Boolean);
        return { v: piv || 0, text: parts.join(" · "), warn: !!m && ((piv || 0) > m.v || Math.abs(iav || 0) > m.i), note: m && (piv || 0) > m.v ? "over its PIV" : "over its current" };
      }
      if (c.type === "bridge") {
        const wp = waveOf(c, "+"), wm = waveOf(c, "-"), i = pinCurrent(c, "+"), m = CadLib.BRIDGES[c.params.model];
        let piv = null; if (wp && wm) { piv = 0; for (let k = 0; k < wp.length; k++) piv = Math.max(piv, wp[k] - wm[k]); }
        if (piv === null && i === null) return null;
        const parts = [piv !== null ? `PIV ${fmtEng(piv, "V")}` : "", i !== null ? `${fmtEng(Math.abs(i), "A")} avg` : ""].filter(Boolean);
        return { v: piv || 0, text: parts.join(" · "), warn: !!m && ((piv || 0) > m.v || Math.abs(i || 0) > m.i), note: m && (piv || 0) > m.v ? "over its PIV" : "over its current" };
      }
      if (c.type === "fuse" || c.type === "ntc") {
        const sp = seriesPart(c), lim = c.type === "fuse" ? +c.params.a : (CadLib.NTCS[c.params.model] || {}).imax;
        return sp ? { v: sp.i, text: `${fmtEng(sp.i, "A")} rms${share(sp.i, lim)}`, warn: sp.i > (c.type === "fuse" ? 0.75 : 1) * lim, note: c.type === "fuse" ? "over 75 % of its rating" : "over its current" } : null;
      }
      if (c.type === "gasreg") {
        const i = pinCurrent(c, "A"), m = CadLib.GASREGS[c.params.model];
        return i === null ? null : { v: i, text: `${fmtEng(i, "A")}${m ? share(i, m.imax) : ""}`, warn: !!m && (i > m.imax || i < m.imin), note: m && i < m.imin ? "under its regulating current" : "over its current" };
      }
      if (c.type === "itx") {
        const i = pinCurrent(c, "P1"), lim = +c.params.idc || 0;
        return i === null ? null : { v: Math.abs(i), text: `${fmtEng(Math.abs(i), "A")} DC${lim ? share(Math.abs(i), lim) : ""}`, warn: lim ? Math.abs(i) > lim : Math.abs(i) > 0.5e-3, note: "DC over the core's rating" };
      }
      if (c.type === "mov") {
        const v = vRmsAcross(c, "1", "2"), m = CadLib.MOVS[c.params.model];
        return v === null ? null : { v, text: `${fmtEng(v, "V")} rms${m ? share(v, m.vrms) : ""}`, warn: !!m && v > m.vrms };
      }
      if (c.type === "tube") {
        // its most-used rating: the largest share of any limit (Pa, Pg2, Ik, Vhk, PIV …)
        const rows = tubeLimits(c), d = tubeData(c), t = tubeByName(c.params.tube);
        if (d && d.kind !== "rectifier" && t && t.paMax > 0 && d.dc) { const pa = d.metrics ? d.metrics.pAvg : d.dc.vak * d.dc.ia; rows.push({ label: "Pa", value: fmtEng(pa, "W"), share: pa / t.paMax, text: "" }); }
        if (!rows.length) return null;
        const top = rows.reduce((a, b) => (b.share > a.share ? b : a));
        return { v: top.share, text: `${top.label.replace(/ \(.*\)$/, "")} ${top.value} · ${Math.round(top.share * 100)}%`, warn: top.share > 1 };
      }
      if (c.type === "inductor") {
        const v = netDC(pinNetOf(c, "1")), w = netDC(pinNetOf(c, "2")); if (v === null || w === null) return null;
        const i = Math.abs(v - w) / Math.max(c.params.dcr, 1e-3);
        return { v: i, text: `${fmtEng(i, "A")} DC` };
      }
      if (c.type === "speaker") {
        const sp = speakerPower(c); return sp ? { v: sp.p, text: fmtEng(sp.p, "W") } : null;
      }
      if (c.type === "opt_se" || c.type === "opt_cat" || c.type === "opt_pp") {
        const m = c.type === "opt_cat" ? CadLib.OUTPUT_TX[c.params.model] : null, dc = (a, b, rr) => { const va = netDC(pinNetOf(c, a)), vb = netDC(pinNetOf(c, b)); return va === null || vb === null ? null : Math.abs(va - vb) / rr; };
        const i = c.type === "opt_cat" ? (otDcCurrent(c) === null ? null : Math.abs(otDcCurrent(c))) : c.type === "opt_se" ? dc("P1", "P2", Math.max(c.params.dcrp, 1e-3)) : Math.max(dc("P1", "CT", Math.max(c.params.dcrp / 2, 1e-3)) || 0, dc("CT", "P2", Math.max(c.params.dcrp / 2, 1e-3)) || 0);
        if (i === null) return null;
        return { v: i, text: `${fmtEng(i, "A")} DC${c.type === "opt_pp" ? " per half" : ""}${m ? share(i * 1000, m.ma) : ""}`, warn: !!m && i * 1000 > m.ma };
      }
      if (c.type === "ptx" || c.type === "ptx_cat") {
        const i = pinCurrent(c, "CT"); if (i === null) return null;
        const m = c.type === "ptx_cat" ? CadLib.POWER_TX[c.params.model] : null, a = Math.abs(i);
        return { v: a, text: `HT ${fmtEng(a, "A")} DC${m ? share(a * 1000, m.ma) : ""}`, warn: !!m && a * 1000 > m.ma };
      }
      if (c.type === "resistor") {
        const p = resistorPower(c);
        return p === null ? null : { v: p, text: fmtEng(p, "W"), warn: +c.params.w > 0 && p > +c.params.w };
      }
      if (c.type === "capacitor" || c.type === "electrolytic") {
        const [a, b] = c.type === "capacitor" ? ["1", "2"] : ["+", "-"], wa = waveOf(c, a), wb = waveOf(c, b);
        const va = netDC(pinNetOf(c, a)), vb = netDC(pinNetOf(c, b));
        let v = null;
        if (wa && wb) { v = 0; for (let i = 0; i < wa.length; i++) v = Math.max(v, Math.abs(wa[i] - wb[i])); }
        else if (va !== null && vb !== null) v = Math.abs(va - vb);
        if (v === null) return null;
        const reversed = c.type === "electrolytic" && va !== null && vb !== null && va - vb < -1;
        return { v, text: fmtEng(v, "V"), warn: reversed, note: "reversed" };
      }
      if (CadLib.isTransistor(c.type) || c.type === "reg" || c.type === "tl431") {
        const d = (S.sim.result.dc.devices[c.id] || {}).main, m = (c.type === "reg" ? CadLib.REGS : c.type === "tl431" ? CadLib.SHUNTS : CadLib.semiTable(c.type))[c.params.model];
        return d && m ? { v: d.pd, text: fmtEng(d.pd, "W"), warn: d.pd > m.p } : null;
      }
      if (c.type === "zener" || c.type === "led") {
        const i = pinCurrent(c, "A"), va = netDC(pinNetOf(c, "A")), vk = netDC(pinNetOf(c, "K"));
        if (i === null || va === null || vk === null) return null;
        if (c.type === "led") { const l = CadLib.LEDS[c.params.color]; return { v: Math.abs(i), text: fmtEng(Math.abs(i), "A"), warn: !!l && i > l.i }; }
        const z = CadLib.ZENERS[c.params.model], p = Math.abs((va - vk) * i);
        return { v: p, text: fmtEng(p, "W"), warn: !!z && p > z.p };
      }
      return null;
    }
    function bomData() {
      const f = frames()[0], p = f ? f.params : {};
      // the values of the last simulation, taken when it finished: an edit since does not mix the
      // new part values with the old voltages
      return { rows: BomLib.build(S.comps, { sockets: bomOpts.sockets, bench: bomOpts.bench, board: S.board, stress: c => (S.sim.stress && S.sim.stress.get(c.id)) || null }),
        title: p.title || "", docno: p.docno || "", rev: p.rev || "", date: p.date || new Date().toISOString().slice(0, 10) };
    }
    const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
    function renderBom() {
      const host = document.getElementById("bom");
      if (!host || host.hidden || bomOpts.tab !== "bom") return;
      // don't rebuild under a part number being typed; catch up when it loses focus
      const a = document.activeElement;
      if (a && a.tagName === "INPUT" && host.contains(a) && a.closest("#bom-table")) { bomStale = true; return; }
      bomStale = false;
      const bom = bomData(), table = document.getElementById("bom-table");
      const parts = bom.rows.reduce((n, r) => n + r.qty, 0);
      document.getElementById("bom-count").textContent = bom.rows.length ? `${bom.rows.length} lines · ${parts} parts` + (!S.sim.result ? " · simulate for the Sim. max column" : S.sim.busy || S.sim.pending ? " · Sim. max: the last simulation, a new one is running" : "") : "";
      if (!bom.rows.length) { table.innerHTML = `<tbody><tr><td class="bom-empty">No parts yet. Place resistors, capacitors, tubes, transformers… and they are listed here.</td></tr></tbody>`; return; }
      const tip = { rating: "Ratings and data; a capacitor's voltage rating is the first standard one at or above 1.25 × its simulated peak voltage", sim: "Simulated worst case: dissipation (resistors, transistors, zeners), capacitor peak voltage, LED current", partno: "Your order or manufacturer number; saved with the circuit" };
      table.innerHTML = `<thead><tr>${BomLib.COLUMNS.map(c => `<th${tip[c.key] ? ` title="${tip[c.key]}"` : ""}>${c.title}</th>`).join("")}</tr></thead><tbody>` +
        bom.rows.map((r, i) => `<tr data-i="${i}"${r.ids.some(id => S.sel.comps.has(id)) ? ' class="sel"' : ""}>
          <td class="n">${r.item}</td><td class="n">${r.qty}</td><td class="mono">${esc(r.refs)}</td><td>${esc(r.desc)}</td><td class="mono">${esc(r.value)}</td>
          <td>${esc(r.rating)}</td><td class="mono${r.warn ? " warn" : ""}">${esc(r.sim)}</td>
          <td>${r.socket ? "" : `<input type="text" value="${esc(r.partno)}" spellcheck="false" aria-label="Part number for ${esc(r.refs)}">`}</td></tr>`).join("") + "</tbody>";
      // a new selection on the sheet scrolls its line into view and flashes it
      const sel = [...S.sel.comps].sort().join(), first = table.querySelector("tbody tr.sel");
      if (sel !== bomSelShown) {
        bomSelShown = sel;
        if (first) {
          const box = table.parentElement, head = table.querySelector("thead").offsetHeight, top = first.offsetTop - head;
          if (top < box.scrollTop || first.offsetTop + first.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - (box.clientHeight - head - first.offsetHeight) / 2);
          table.querySelectorAll("tbody tr.sel").forEach(tr => tr.classList.add("flash"));
        }
      }
      table.querySelectorAll("tbody tr").forEach(tr => {
        const r = bom.rows[+tr.dataset.i];
        tr.addEventListener("click", e => {
          if (e.target.tagName === "INPUT") return;
          // select the line's parts on the sheet (a socket line selects its tubes)
          const ids = r.socket ? S.comps.filter(c => c.type === "tube" && r.refList.includes(String(c.label || "").replace(/\.\d+$/, ""))).map(c => c.id) : r.ids;
          S.sel.comps = new Set(ids); S.sel.wires.clear(); updateInspector(); render();
        });
        const inp = tr.querySelector("input");
        if (inp) {
          inp.addEventListener("change", () => { const v = inp.value.trim(); S.comps.forEach(c => { if (r.ids.includes(c.id)) c.params.partno = v; }); bomStale = false; inp.blur(); commit(); });
          inp.addEventListener("keydown", e => { if (e.key === "Enter") inp.blur(); else if (e.key === "Escape") { inp.value = r.partno; inp.blur(); } });
          inp.addEventListener("blur", () => { if (bomStale) setTimeout(renderBom, 0); });
        }
      });
    }
    // The panel under the sheet has tabs: the bill of materials, the Checks (renderChecks in
    // cad-app.js) and the tolerance runs (cad-tolerance.js). showDock(tab) opens it on a tab, showDock(null) closes it. toggleBom(on, tab):
    // B and the View menu's ticks; a tab that is already showing closes the panel, another tab
    // is brought forward.
    function showDock(tab) {
      const host = document.getElementById("bom");
      bomOpts.open = !!tab; if (tab) bomOpts.tab = tab; saveBomOpts();
      host.hidden = !bomOpts.open; bomSelShown = "";
      host.querySelectorAll("[data-tab]").forEach(t => {
        const on = t.dataset.tab === bomOpts.tab;
        t.classList.toggle("active", on); t.setAttribute("aria-selected", String(on));
        document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
      });
      host.querySelectorAll(".bom-tools").forEach(el => { el.hidden = el.dataset.for !== bomOpts.tab; });
      cmds.sync(); renderBom(); renderChecks(); renderTolerance(); render();
    }
    function toggleBom(on, tab = "bom") {
      const showing = bomOpts.open && bomOpts.tab === tab;
      showDock((on === undefined ? !showing : on) ? tab : null);
    }
    function exportBom(fmt) {
      const bom = bomData(), name = baseName() + "-BOM." + fmt;
      const [data, type] = fmt === "txt" ? [BomLib.toTxt(bom), "text/plain;charset=utf-8"] : fmt === "csv" ? [BomLib.toCsv(bom), "text/csv;charset=utf-8"]
        : fmt === "xlsx" ? [BomLib.toXlsx(bom), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] : [BomLib.toPdf(bom), "application/pdf"];
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type }));
      a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved ${name} (${bom.rows.length} lines, ${bom.rows.reduce((n, r) => n + r.qty, 0)} parts)`);
      return data;
    }
    function initBom() {
      const host = document.getElementById("bom"), center = document.getElementById("center");
      const setH = h => { bomOpts.height = h; host.style.setProperty("--bom-h", h + "px"); };
      if (bomOpts.height) setH(bomOpts.height);
      ["sockets", "bench"].forEach(k => { const el = document.getElementById("bom-" + k); el.checked = bomOpts[k]; el.addEventListener("change", () => { bomOpts[k] = el.checked; saveBomOpts(); renderBom(); }); });
      host.querySelectorAll("[data-bom]").forEach(b => b.addEventListener("click", () => exportBom(b.dataset.bom)));
      cmds.bind("btn-bom", "bom"); bind("btn-bom-menu", () => toggleBom(true)); bind("btn-bom-close", () => showDock(null));
      host.querySelectorAll("[data-tab]").forEach(t => t.addEventListener("click", () => showDock(t.dataset.tab)));
      host.querySelector(".bom-grip").addEventListener("mousedown", e => {
        e.preventDefault();
        const y0 = e.clientY, h0 = host.offsetHeight, max = center.clientHeight - 120;
        const move = ev => { setH(Math.round(Math.max(120, Math.min(max, h0 + y0 - ev.clientY)))); render(); };
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); saveBomOpts(); };
        window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      });
      if (bomOpts.open) showDock(bomOpts.tab); else showDock(null);
    }
    return { bomData, bomOpts, clearBomShown, exportBom, initBom, partStress, renderBom, toggleBom };
  };
})(window);
