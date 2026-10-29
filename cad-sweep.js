/* Parameter sweep, the Sweep tab under the schematic: one value of one part (a resistor, a
   capacitor, a pot's wiper, a supply's voltage, a generator's frequency…) stepped from one value
   to another, the circuit simulated at each step, and everything the CAD measures shown against
   it: each tube's Ia, Va and Pa, each transistor's current and dissipation, each speaker's power
   and THD, each scope channel's AC and THD. A row of the table picks what the chart plots, and a
   scope channel's row also overlays its waveform at every step. The steps are independent runs on
   the engine's pool, as the tolerance runs are. */
(function (root) {
  "use strict";
  // the values of a sweep: steps values from a to b, evenly spaced, or evenly in ratio (log)
  function values(a, b, steps, log) {
    const n = Math.max(2, Math.round(steps) || 2), out = [];
    const useLog = log && a > 0 && b > 0;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      out.push(useLog ? Math.exp(Math.log(a) + t * (Math.log(b) - Math.log(a))) : a + t * (b - a));
    }
    return out;
  }
  // the numeric fields of a part that a sweep can step: [{ key, label, unit, min, max }]
  function fieldsOf(def, c) {
    if (!def || !def.fields) return [];
    const seen = new Set();
    return def.fields.filter(f => f.key && (f.kind === "eng" || f.kind === "number" || f.kind === "range") && typeof (+c.params[f.key]) === "number" && isFinite(+c.params[f.key]) && (!f.when || f.when(c)))
      .filter(f => (seen.has(f.key) ? false : (seen.add(f.key), true)))
      .map(f => ({ key: f.key, label: f.label, unit: f.unit || "", min: f.min, max: f.max, range: f.kind === "range" }));
  }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadSweep(cad) {
    const { S, buildNetlist, cmds, commit, desig, esc, fmtEng, harmonics, measurements, parseEng, pool, scopeChannels, setStatus, signalFreq, speakerWave, topo, withResult } = cad;
    const LIB = CadLib.LIB;
    const KEY = "tubecad_sweep";
    const opts = { part: "", field: "", from: "", to: "", steps: 9, log: true, plot: "" };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    // job: the sweep under way; steps: [{ v, rows: [{ key, label, unit, v, max }], waves: { key: Float32Array } }]
    // in value order (pending: running, failed: did not settle); keys: the quantities, in the first step's order
    const W = S.sweep = { seq: 0, job: null, steps: null, keys: null, part: null, field: null, nominal: null, stale: false, error: null, hover: -1, opts };
    let jobs = [];
    const RUN = { budgetMs: 120000, maxPeriods: 20000 };
    const warmOf = r => (r && r.ok && r.warm && r.shooting && !r.shooting.converged ? r.warm : null);

    // the parts a sweep can step, with their fields
    function parts() {
      return S.comps.filter(c => c.type !== "frame" && LIB[c.type]).map(c => ({ c, fields: fieldsOf(LIB[c.type], c) })).filter(p => p.fields.length)
        .sort((a, b) => String(desig(a.c)).localeCompare(String(desig(b.c)), undefined, { numeric: true }));
    }
    function current() {
      const ps = parts(), p = ps.find(x => x.c.id === opts.part) || ps[0];
      if (!p) return null;
      const f = p.fields.find(x => x.key === opts.field) || p.fields[0];
      return { c: p.c, f, fields: p.fields };
    }
    // a sensible range for a value: half to twice it (a pot's wiper: end to end; a value of 0: 0 to 1)
    function defaults(c, f) {
      const v = +c.params[f.key];
      if (f.range) return [f.min !== undefined ? f.min : 0, f.max !== undefined ? f.max : 1, false];
      if (v > 0) return [v / 2, v * 2, true];
      if (v < 0) return [v * 2, v / 2, false];
      return [0, 1, false];
    }
    // a typed value: engineering notation (100k, 2.2u, 330); a wiper's position in % or as 0…1
    const num = (s, f) => { if (!f.range) return parseEng(s); const v = parseFloat(String(s).replace(",", ".")); return /%/.test(s) || v > 1 ? v / 100 : v; };
    const fmtV = (v, f) => (f.range ? Math.round(v * 100) + " %" : fmtEng(v, f.unit));

    // what each step measures: the CAD's measurements, with THD at each speaker and scope channel,
    // and one cycle of each scope channel's wave for the overlay
    function measure() {
      const rows = measurements(), waves = {}, r = S.sim.result, f0 = signalFreq();
      const thd = w => {
        if (!w || !(f0 > 0) || !r.tran) return null;
        const h = harmonics(w, f0, r.tran.dt, Math.max(2, Math.min(10, Math.floor(0.5 / (r.tran.dt * f0)) - 1)));
        return h[0] > 1e-6 ? 100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / h[0] : null;
      };
      const extra = [];
      S.comps.forEach(c => {
        const name = desig(c) || c.id;
        if (c.type === "speaker") { const sw = speakerWave(c), t = sw && thd(sw.v); if (t !== null && t !== undefined) extra.push({ after: c.id + ":p", row: { key: c.id + ":thd", label: `${name} THD`, unit: "%", v: t } }); }
        else if (c.type === "scope") {
          const ch = scopeChannels(c); if (!ch) return;
          ["ch1", "ch2"].forEach(k => {
            const w = ch[k]; if (!w) return;
            const t = thd(w); if (t !== null && t !== undefined) extra.push({ after: c.id + ":" + k, row: { key: c.id + ":" + k + ":thd", label: `${name} ${k.toUpperCase()} THD`, unit: "%", v: t } });
            // one cycle of the signal (or the whole capture), 240 points
            const n = f0 > 0 ? Math.min(w.length, Math.max(2, Math.round(1 / (f0 * ch.dt)) + 1)) : w.length, out = new Float32Array(240);
            let m = 0; for (let i = 0; i < n; i++) m += w[i]; m /= n;   // AC coupled, as the scope's AC readout
            for (let i = 0; i < 240; i++) out[i] = w[Math.min(n - 1, Math.round(i / 239 * (n - 1)))] - m;
            waves[c.id + ":" + k] = { w: out, t: (n - 1) * ch.dt };
          });
        }
      });
      extra.forEach(({ after, row }) => { const i = rows.findIndex(x => x.key === after); rows.splice(i < 0 ? rows.length : i + 1, 0, row); });
      return { rows, waves };
    }

    function stop() {
      jobs.forEach(j => j.cancel()); jobs = [];
      if (W.job) { W.job = null; W.seq++; setStatus("idle", "Sweep stopped"); render(); cmds.sync(); }
    }
    function run() {
      stop();
      const T = topo(), cur = current();
      W.error = !S.comps.length ? "Empty sheet" : !T.hasGround ? "Add a ground symbol to simulate" : !cur ? "No part with a value to sweep" : null;
      if (W.error) { W.steps = null; render(); return; }
      const { c, f } = cur, [d0, d1, dl] = defaults(c, f);
      let a = opts.from === "" ? d0 : num(opts.from, f), b = opts.to === "" ? d1 : num(opts.to, f);
      if (!isFinite(a) || !isFinite(b) || a === b) { W.error = "From and To must be two different values"; W.steps = null; render(); return; }
      if (f.range) { a = Math.max(f.min || 0, Math.min(f.max === undefined ? 1 : f.max, a)); b = Math.max(f.min || 0, Math.min(f.max === undefined ? 1 : f.max, b)); }
      W.log = opts.log === undefined ? dl : opts.log;
      const vs = values(a, b, opts.steps, W.log), keep = c.params[f.key];
      // each step's netlist: the part's value set, the netlist built, the value put back (nothing sees it)
      const nets = vs.map(v => { c.params[f.key] = v; try { return buildNetlist(); } finally { c.params[f.key] = keep; } });
      const base = buildNetlist();
      const seq = ++W.seq, job = W.job = { seq, done: 0, total: vs.length, failed: 0 };
      W.steps = vs.map(v => ({ v, pending: true })); W.part = { id: c.id, name: desig(c) || c.id, type: c.type }; W.field = f; W.nominal = +keep; W.stale = false; W.hover = -1; W.keys = null;
      const partial = new Map();
      const progress = () => {
        let p = job.done; partial.forEach(x => { p += x; });
        setStatus("busy", `Sweep of ${W.part.name} ${f.label.toLowerCase()}: ${job.done} of ${job.total} · ${Math.floor(p / job.total * 100)} %`, p / job.total);
      };
      const finish = () => {
        jobs = []; W.job = null;
        const ok = W.steps.filter(s => s.rows).length;
        W.error = ok ? null : "No step settled: run ▶ Simulate first to see what the circuit does";
        setStatus(W.error ? "warn" : "ok", W.error || `Sweep: ${ok} steps of ${W.part.name} ${f.label.toLowerCase()}` + (job.failed ? ` · ${job.failed} did not settle` : ""));
        render(); cmds.sync();
      };
      const take = (k, result) => {
        if (W.seq !== seq) return;
        const st = W.steps[k]; delete st.pending;
        const m = result && result.ok ? withResult(result, nets[k], T, measure) : null;
        if (m) { st.rows = m.rows; st.waves = m.waves; if (!W.keys) W.keys = m.rows.map(r => ({ key: r.key, label: r.label, unit: r.unit, max: r.max })); else m.rows.forEach(r => { if (!W.keys.some(q => q.key === r.key)) W.keys.push({ key: r.key, label: r.label, unit: r.unit, max: r.max }); }); }
        else { st.failed = true; job.failed++; }
        partial.delete(k); job.done++;
        if (job.done === job.total) { finish(); return; }
        progress(); render();
      };
      render(); cmds.sync(); progress();
      const last = !S.sim.busy && S.sim.result && S.sim.netlist && JSON.stringify(S.sim.netlist) === JSON.stringify(base) ? warmOf(S.sim.result) : null;
      const options = last ? Object.assign({ warm: last }, RUN) : RUN;
      if (!pool.ok) {
        const next = k => setTimeout(() => { if (W.seq !== seq) return; take(k, TubeSimEngine.simulate(nets[k], options)); if (k + 1 < nets.length) next(k + 1); }, 0);
        next(0); return;
      }
      jobs = nets.map((n, k) => pool.run({ netlist: n, options }, {
        onResult: r => take(k, r),
        onProgress: x => { if (W.job && W.seq === seq) { partial.set(k, x); progress(); } }
      }));
    }
    // set the part to a step's value (one undo step)
    function useStep(k) {
      const st = W.steps && W.steps[k], c = W.part && S.comps.find(x => x.id === W.part.id);
      if (!st || !c) return;
      c.params[W.field.key] = W.field.range ? Math.round(st.v * 1000) / 1000 : +st.v.toPrecision(3);
      commit();
      setStatus("ok", `${W.part.name} ${W.field.label.toLowerCase()} set to ${fmtV(c.params[W.field.key], W.field)}`);
    }
    function changed() { if (W.steps && !W.stale) { W.stale = true; render(); } }

    // ---- drawing ----
    const valueOf = (st, key) => { const r = st.rows && st.rows.find(x => x.key === key); return r ? r.v : NaN; };
    const plotKey = () => (W.keys && (W.keys.find(k => k.key === opts.plot) || W.keys[0])) || null;
    const ramp = t => { // amber (first step) to cyan (last)
      const a = [255, 213, 79], b = [0, 229, 255];
      return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * t)).join(",")})`;
    };
    function chart(key) {
      const Wd = 460, H = 220, L = 54, R = 12, Tp = 12, B = 30, f = W.field;
      const pts = W.steps.map((s, k) => ({ k, x: s.v, y: valueOf(s, key.key) })).filter(p => isFinite(p.y));
      let s = `<svg class="pw-chart" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="${esc(key.label)} against ${esc(f.label)}">`;
      const xs = W.steps.map(st => st.v), logX = W.log && xs.every(v => v > 0);
      const tx = v => (logX ? Math.log10(v) : v), x0 = tx(Math.min(...xs)), x1 = tx(Math.max(...xs));
      const X = v => L + (tx(v) - x0) / ((x1 - x0) || 1) * (Wd - L - R);
      let y0 = pts.length ? Math.min(...pts.map(p => p.y)) : 0, y1 = pts.length ? Math.max(...pts.map(p => p.y)) : 1;
      if (key.max > 0 && key.max < y1 * 1.5) y1 = Math.max(y1, key.max);
      if (y1 - y0 < 1e-12 * Math.max(1, Math.abs(y1))) { y0 -= Math.abs(y0) * 0.05 || 1; y1 += Math.abs(y1) * 0.05 || 1; }
      const pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
      const Y = v => Tp + (y1 - v) / (y1 - y0) * (H - Tp - B);
      for (let i = 0; i <= 4; i++) { const v = y0 + (y1 - y0) * i / 4, y = Y(v); s += `<line class="g1" x1="${L}" x2="${Wd - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 5}" y="${y + 4}" text-anchor="end">${q(v, key.unit)}</text>`; }
      const ticks = values(Math.min(...xs), Math.max(...xs), 5, logX);
      ticks.forEach((v, i) => { const x = X(v); s += `<line class="g2" x1="${x}" x2="${x}" y1="${Tp}" y2="${H - B}"/><text class="ax" x="${x}" y="${H - B + 14}" text-anchor="${i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}">${esc(fmtV(v, f))}</text>`; });
      s += `<text class="ax" x="${(L + Wd - R) / 2}" y="${H - 3}" text-anchor="middle">${esc(W.part.name)} ${esc(f.label.toLowerCase())}</text>`;
      if (key.max > 0 && key.max <= y1 && key.max >= y0) s += `<line class="ref" x1="${L}" x2="${Wd - R}" y1="${Y(key.max)}" y2="${Y(key.max)}"/><text class="ax warn" x="${Wd - R - 2}" y="${Y(key.max) - 3}" text-anchor="end">rating</text>`;
      if (W.nominal >= Math.min(...xs) && W.nominal <= Math.max(...xs) && (!logX || W.nominal > 0)) s += `<line class="now" x1="${X(W.nominal)}" x2="${X(W.nominal)}" y1="${Tp}" y2="${H - B}"/>`;
      if (pts.length > 1) s += `<polyline class="thd" points="${pts.map(p => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(" ")}"/>`;
      pts.forEach(p => { s += `<circle class="pt${p.k === W.hover ? " on" : ""}" data-i="${p.k}" cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.k === W.hover ? 5 : 3.2}" style="fill:${ramp(p.k / Math.max(1, W.steps.length - 1))}"><title>${esc(fmtV(p.x, f))}: ${esc(key.label)} ${q(p.y, key.unit)}</title></circle>`; });
      return s + "</svg>";
    }
    // a scope channel's wave at every step, one cycle, overlaid
    function overlay(key) {
      const k = key.key.replace(/:thd$/, ""), ws = W.steps.map((s, i) => ({ i, d: s.waves && s.waves[k] })).filter(x => x.d);
      if (!ws.length) return "";
      const Wd = 460, H = 150, L = 54, R = 12, Tp = 8, B = 22;
      let y0 = Infinity, y1 = -Infinity; ws.forEach(({ d }) => d.w.forEach(v => { if (v < y0) y0 = v; if (v > y1) y1 = v; }));
      if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
      const Y = v => Tp + (y1 - v) / (y1 - y0) * (H - Tp - B), X = i => L + i / 239 * (Wd - L - R);
      let s = `<svg class="pw-chart sw-waves" viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Waveforms at each step">`;
      [y0, (y0 + y1) / 2, y1].forEach(v => { s += `<line class="g1" x1="${L}" x2="${Wd - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ax" x="${L - 5}" y="${Y(v) + 4}" text-anchor="end">${esc(fmtEng(v, "V"))}</text>`; });
      s += `<text class="ax" x="${L + 4}" y="${Tp + 10}">AC</text>`;
      s += `<text class="ax" x="${(L + Wd - R) / 2}" y="${H - 6}" text-anchor="middle">one cycle (${esc(fmtEng(ws[0].d.t, "s"))}) at each step: amber the first, cyan the last</text>`;
      ws.forEach(({ i, d }) => { s += `<polyline class="sw-w${i === W.hover ? " on" : ""}" style="stroke:${ramp(i / Math.max(1, W.steps.length - 1))}" points="${Array.from(d.w, (v, j) => `${X(j).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>`; });
      return s + "</svg>";
    }
    // a small line of a quantity over the steps
    function spark(key) {
      const ys = W.steps.map(s => valueOf(s, key)), ok = ys.filter(isFinite);
      if (ok.length < 2) return "";
      const lo = Math.min(...ok), hi = Math.max(...ok), Wd = 80, H = 16;
      const pts = ys.map((y, i) => (isFinite(y) ? `${(i / (ys.length - 1) * Wd).toFixed(1)},${(hi > lo ? H - 2 - (y - lo) / (hi - lo) * (H - 4) : H / 2).toFixed(1)}` : null)).filter(Boolean).join(" ");
      return `<svg class="sw-spark" viewBox="0 0 ${Wd} ${H}" width="${Wd}" height="${H}"><polyline points="${pts}"/></svg>`;
    }
    const pct = v => (v < 0.001 ? "<0.001" : v < 0.1 ? v.toPrecision(2) : v.toFixed(v < 1 ? 3 : 2)) + " %";
    const q = (v, u) => (isFinite(v) ? esc(u === "%" ? pct(v) : fmtEng(v, u)) : "—");
    function render() {
      syncTools();
      const host = document.getElementById("sw-pane");
      if (!host || host.hidden) return;
      if (W.error && !W.job) { host.innerHTML = `<div class="bom-empty">${esc(W.error)}</div>`; return; }
      if (!W.steps) {
        host.innerHTML = `<div class="bom-empty">Pick a part and one of its values, the range and the steps, and press ▶ Run: the circuit is simulated at every step, and the table shows how each tube, transistor, speaker and scope channel follows. Click a line to plot it.</div>`;
        return;
      }
      const f = W.field, key = plotKey(), first = W.steps[0], lastS = W.steps[W.steps.length - 1];
      const note = (W.stale ? `<div class="bom-empty tol-note">The circuit changed since this sweep: press ▶ Run again.</div>` : "")
        + (!W.job && W.steps.some(s => s.failed) ? `<div class="bom-empty tol-note">${W.steps.filter(s => s.failed).length} steps did not settle and are left out.</div>` : "");
      const steps = `<div class="sw-steps">${W.steps.map((s, k) => `<button class="sw-step${k === W.hover ? " on" : ""}${s.pending ? " pend" : s.failed ? " bad" : ""}" data-i="${k}" style="border-color:${ramp(k / Math.max(1, W.steps.length - 1))}" title="${s.pending ? "simulating…" : s.failed ? "did not settle" : "Click: set the part to this value (Ctrl+Z undoes it)"}">${esc(fmtV(s.v, f))}</button>`).join("")}</div>`;
      const left = key ? `<div class="pw-left"><div class="sw-title">${esc(key.label)} <span class="muted">against ${esc(W.part.name)} ${esc(f.label.toLowerCase())}</span></div>${chart(key)}${/ CH[12] (AC|THD)$/.test(key.label) ? overlay(key) : ""}</div>` : `<div class="pw-left"><div class="bom-empty">${W.job ? "Simulating…" : ""}</div></div>`;
      const rows = (W.keys || []).map(k => {
        const at = s => valueOf(s, k.key), vals = W.steps.map(at).filter(isFinite), over = k.max > 0 ? W.steps.filter(s => at(s) > k.max).length : 0;
        return `<tr data-key="${esc(k.key)}" class="${key && k.key === key.key ? "sel" : ""}"><td>${esc(k.label)}</td><td>${spark(k.key)}</td><td class="n mono">${q(at(first), k.unit)}</td><td class="n mono">${q(at(lastS), k.unit)}</td>`
          + `<td class="n mono">${vals.length ? q(Math.min(...vals), k.unit) + " … " + q(Math.max(...vals), k.unit) : "—"}</td><td class="n${over ? " warn" : ""}">${k.max > 0 ? `${over} of ${W.steps.length}` : ""}</td></tr>`;
      }).join("");
      host.innerHTML = note + `<div class="pw-wrap">${left}<div class="pw-right">${steps}<table id="sw-table"><thead><tr><th>Quantity</th><th title="Over the steps, first to last">Trend</th><th>At ${esc(fmtV(first.v, f))}</th><th>At ${esc(fmtV(lastS.v, f))}</th><th>Range</th><th title="Steps that took the part beyond its rating">Over rating</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
    function syncTools() {
      const ps = parts(), cur = current();
      const sp = document.getElementById("sw-part"), sf = document.getElementById("sw-field");
      if (sp && document.activeElement !== sp) {
        const html = ps.length ? ps.map(p => `<option value="${esc(p.c.id)}">${esc(desig(p.c) || p.c.id)} · ${esc(LIB[p.c.type].name)}</option>`).join("") : `<option value="">No parts</option>`;
        if (sp.innerHTML !== html) sp.innerHTML = html;
        sp.value = cur ? cur.c.id : "";
      }
      if (sf && document.activeElement !== sf) {
        const html = cur ? cur.fields.map(f => `<option value="${esc(f.key)}">${esc(f.label)}${f.unit ? ` (${esc(f.unit)})` : ""}</option>`).join("") : "";
        if (sf.innerHTML !== html) sf.innerHTML = html;
        sf.value = cur ? cur.f.key : "";
      }
      const now = document.getElementById("sw-now");
      if (now) now.textContent = cur ? `now ${fmtV(+cur.c.params[cur.f.key], cur.f)}` : "";
      if (cur) {
        const [a, b, l] = defaults(cur.c, cur.f);
        const fr = document.getElementById("sw-from"), to = document.getElementById("sw-to");
        if (fr && document.activeElement !== fr) { fr.value = opts.from; fr.placeholder = fmtV(a, cur.f); }
        if (to && document.activeElement !== to) { to.value = opts.to; to.placeholder = fmtV(b, cur.f); }
        const lg = document.getElementById("sw-log"); if (lg && document.activeElement !== lg) lg.value = (opts.log === undefined ? l : opts.log) ? "log" : "lin";
      }
      const st = document.getElementById("sw-steps"); if (st && document.activeElement !== st) st.value = opts.steps;
      const btn = document.getElementById("btn-sw-run");
      if (btn) btn.textContent = W.job ? `■ Stop · ${W.job.done} / ${W.job.total}` : "▶ Run";
    }
    function hover(k) {
      if (W.hover === k) return;
      W.hover = k;
      const host = document.getElementById("sw-pane"); if (!host) return;
      host.querySelectorAll(".sw-step").forEach(b => b.classList.toggle("on", +b.dataset.i === k));
      host.querySelectorAll(".pw-chart circle.pt").forEach(c => { const on = +c.dataset.i === k; c.classList.toggle("on", on); c.setAttribute("r", on ? 5 : 3.2); });
      host.querySelectorAll(".sw-waves polyline").forEach((p, i) => p.classList.toggle("on", i === k));
    }
    function init() {
      const sp = document.getElementById("sw-part"), sf = document.getElementById("sw-field");
      // another part or value: its own range (the boxes go back to their defaults)
      if (sp) sp.addEventListener("change", () => { opts.part = sp.value; opts.field = ""; opts.from = opts.to = ""; opts.log = undefined; save(); syncTools(); });
      if (sf) sf.addEventListener("change", () => { opts.field = sf.value; opts.from = opts.to = ""; opts.log = undefined; save(); syncTools(); });
      ["from", "to"].forEach(k => {
        const el = document.getElementById("sw-" + k); if (!el) return;
        el.addEventListener("change", () => { const cur = current(); const v = el.value.trim(); if (v === "" || (cur && isFinite(num(v, cur.f)))) { opts[k] = v; save(); } syncTools(); });
      });
      const st = document.getElementById("sw-steps");
      if (st) st.addEventListener("change", () => { const v = Math.round(+st.value); if (v >= 2 && v <= 60) { opts.steps = v; save(); } st.value = opts.steps; });
      const lg = document.getElementById("sw-log");
      if (lg) lg.addEventListener("change", () => { opts.log = lg.value === "log"; save(); });
      const btn = document.getElementById("btn-sw-run");
      if (btn) btn.addEventListener("click", () => (W.job ? stop() : run()));
      const host = document.getElementById("sw-pane");
      if (host) {
        host.addEventListener("click", e => {
          const b = e.target.closest(".sw-step"); if (b) { useStep(+b.dataset.i); return; }
          const tr = e.target.closest("#sw-table tbody tr"); if (tr) { opts.plot = tr.dataset.key; save(); render(); }
        });
        host.addEventListener("mouseover", e => { const t = e.target.closest("[data-i]"); hover(t ? +t.dataset.i : -1); });
        host.addEventListener("mouseleave", () => hover(-1));
      }
      render();
    }
    return { changed, init, render, run, stop, useStep, parts };
  }
  CadSweep.values = values; CadSweep.fieldsOf = fieldsOf;
  root.CadSweep = CadSweep;
})(typeof window !== "undefined" ? window : globalThis);
