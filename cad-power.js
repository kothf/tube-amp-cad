/* Power sweep, the Power tab under the schematic: the circuit simulated at a row of input levels,
   from well below the generator's level to well above it, and at each one the output (a speaker's
   power, or a scope channel's AC) and its distortion: THD and the 2nd and 3rd harmonics. The chart
   plots THD against the output, and the tab reads off the output at 1 %, 5 % and 10 % THD, the
   figures an amplifier is rated by. Every generator (signal generator, guitar pickup, phono
   cartridge) is scaled together; the mains is not. The levels are independent runs, so they go to
   the engine's pool all at once, as the tolerance runs do. */
(function (root) {
  "use strict";
  // the sweep's levels in dB from the generator's level: steps values from lo to hi, evenly spaced
  function levels(lo, hi, steps) {
    const n = Math.max(2, Math.round(steps) || 2), out = [];
    for (let k = 0; k < n; k++) out.push(lo + (hi - lo) * k / (n - 1));
    return out;
  }
  // the netlist with every signal source's amplitude times g (the mains, acMains, stays as it is)
  function scale(netlist, g) {
    const elements = netlist.elements.map(e => (e.kind === "VSRC" && !e.acMains ? Object.assign({}, e, { amp: e.amp * g }) : e));
    return { nodeCount: netlist.nodeCount, elements };
  }
  // THD in % and each harmonic against the fundamental, from harmonic amplitudes (h[0] the fundamental)
  function distortion(h) {
    const f = Math.max(h[0], 1e-15);
    const thd = 100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / f;
    return { thd, rel: h.slice(1).map(v => v / f) };
  }
  // the output where THD first reaches pct, rising with the level: interpolated between the two
  // levels either side of it on log scales (THD and power both run about as powers of the level);
  // null where the sweep never gets there, or starts above it
  function crossing(points, pct) {
    const p = points.filter(q => q && q.out > 0 && q.thd > 0);
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1], b = p[k];
      if (a.thd < pct && b.thd >= pct) {
        const t = (Math.log(pct) - Math.log(a.thd)) / (Math.log(b.thd) - Math.log(a.thd));
        return { out: Math.exp(Math.log(a.out) + t * (Math.log(b.out) - Math.log(a.out))), db: a.db + t * (b.db - a.db) };
      }
    }
    return null;
  }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadPower(cad) {
    const { S, buildNetlist, cmds, commit, desig, esc, fmtEng, harmonics, pool, scopeChannels, setStatus, signalFreq, speakerWave, topo, withResult } = cad;
    const KEY = "tubecad_power";
    const opts = { lo: -24, hi: 12, steps: 19, out: "" };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    // job: the sweep under way; points: [{ db, g, out, vrms, thd, rel }] by level (pending: still
    // running, failed: did not settle); unit: "W" (a speaker) or "Vrms" (a scope channel); hover: the point under the pointer
    S.power = { seq: 0, job: null, points: null, unit: "W", label: "", vin: 0, stale: false, error: null, hover: -1, opts };
    let jobs = [];
    const RUN = { budgetMs: 120000, maxPeriods: 20000 }, MARKS = [1, 5, 10];
    const warmOf = r => (r && r.ok && r.warm && r.shooting && !r.shooting.converged ? r.warm : null);
    const SOURCES = { siggen: "amp", pickup: "amp", phono: "mv" };
    const sources = () => S.comps.filter(c => SOURCES[c.type]);

    // what can be the output: each speaker (its power) and each scope channel (its AC)
    function outputs() {
      const out = [];
      S.comps.forEach(c => {
        const name = desig(c) || c.id;
        if (c.type === "speaker") out.push({ id: c.id, label: `${name} speaker`, unit: "W" });
        else if (c.type === "scope") ["CH1", "CH2"].forEach(ch => out.push({ id: c.id + ":" + ch, label: `${name} ${ch}`, unit: "Vrms" }));
      });
      return out;
    }
    const pick = () => { const o = outputs(); return o.find(x => x.id === opts.out) || o[0] || null; };
    // the RMS of the first generator at gain g: the sweep's input column
    function vinOf(g) {
      const c = sources()[0]; if (!c) return 0;
      if (c.type === "phono") return (+c.params.mv || 0) * g;
      const crest = { sine: Math.SQRT2, square: 1, triangle: Math.sqrt(3) }[c.params.wave] || Math.SQRT2;
      return (+c.params.amp || 0) * g / crest;
    }
    // one level's output and distortion, read off its result
    function measure(o) {
      const f0 = signalFreq(), r = S.sim.result;
      if (!r || !r.tran || !(f0 > 0)) return null;
      let w;
      if (o.unit === "W") {
        const c = S.comps.find(x => x.id === o.id), sw = c && speakerWave(c); if (!sw) return null;
        let p = 0; for (let k = 0; k < sw.v.length; k++) p += sw.v[k] * sw.i[k];
        w = sw.v; o.p = p / sw.v.length;
      } else {
        const [id, ch] = o.id.split(":"), c = S.comps.find(x => x.id === id), chs = c && scopeChannels(c);
        w = chs && chs[ch.toLowerCase()]; if (!w) return null;
      }
      let m = 0; for (let k = 0; k < w.length; k++) m += w[k]; m /= w.length;
      let q = 0; for (let k = 0; k < w.length; k++) q += (w[k] - m) * (w[k] - m);
      const vrms = Math.sqrt(q / w.length), d = distortion(harmonics(w, f0, r.tran.dt, Math.max(2, Math.min(10, Math.floor(0.5 / (r.tran.dt * f0)) - 1))));
      return { out: o.unit === "W" ? o.p : vrms, vrms, thd: d.thd, rel: d.rel };
    }

    function stop() {
      jobs.forEach(j => j.cancel()); jobs = [];
      if (S.power.job) { S.power.job = null; S.power.seq++; setStatus("idle", "Power sweep stopped"); render(); cmds.sync(); }
    }
    // Where a THD mark (1, 5 or 10 %) falls between two levels far apart in distortion (an output
    // stage clips within a dB or two), the levels between them: refine(points) → [db]
    function refine(points) {
      const p = points.filter(q => q.out > 0 && q.thd > 0), add = [];
      MARKS.forEach(pct => {
        for (let k = 1; k < p.length; k++) {
          const a = p[k - 1], b = p[k];
          if (a.thd < pct && b.thd >= pct) {
            if (b.thd / a.thd > 1.6 && b.db - a.db > 0.15) for (let j = 1; j <= 3; j++) add.push(a.db + (b.db - a.db) * j / 4);
            break;
          }
        }
      });
      return [...new Set(add.map(v => Math.round(v * 1000) / 1000))].filter(v => !points.some(q => Math.abs(q.db - v) < 1e-3));
    }
    function run() {
      stop();
      const P = S.power, T = topo(), o = pick();
      P.error = !S.comps.length ? "Empty sheet" : !T.hasGround ? "Add a ground symbol to simulate"
        : !sources().length ? "The sweep drives the circuit's signal generator (or guitar pickup, or phono cartridge): place one at the input."
        : !o ? "Nothing to measure: place a speaker as the load, or an oscilloscope on the output." : null;
      if (P.error) { P.points = null; render(); return; }
      const base = buildNetlist();
      const seq = ++P.seq, job = P.job = { seq, done: 0, total: 0, failed: 0, round: 0, out: o };
      P.points = []; P.unit = o.unit; P.label = o.label; P.vin = vinOf(1); P.stale = false; P.hover = -1;
      const partial = new Map();
      const progress = () => {
        let f = job.done; partial.forEach(v => { f += v; });
        setStatus("busy", `Power sweep${job.round ? " (closer around the THD marks)" : ""}: ${job.done} of ${job.total} levels · ${Math.floor(f / job.total * 100)} %`, f / job.total);
      };
      const finish = () => {
        jobs = []; P.job = null;
        const ok = P.points.filter(q => q.out !== undefined).length;
        P.error = ok ? null : "No level settled: run ▶ Simulate first to see what the circuit does";
        const c1 = crossing(P.points, 1);
        setStatus(P.error ? "warn" : "ok", P.error || `Power sweep: ${ok} levels` + (c1 ? ` · ${fmtEng(c1.out, P.unit)} at 1 % THD` : "") + (job.failed ? ` · ${job.failed} did not settle` : ""));
        render(); cmds.sync();
      };
      // the last simulation of this very circuit, at the generator's own level, starts every level warm
      const last = !S.sim.busy && S.sim.result && S.sim.netlist && JSON.stringify(S.sim.netlist) === JSON.stringify(base) ? warmOf(S.sim.result) : null;
      const options = last ? Object.assign({ warm: last }, RUN) : RUN;
      // one round: these levels, all at once; then up to two rounds closer around the marks
      const round = dbs => {
        const items = dbs.map(db => ({ db, g: Math.pow(10, db / 20), pending: true }));
        P.points = P.points.concat(items).sort((a, b) => a.db - b.db);
        job.total += items.length;
        let left = items.length;
        const take = (it, net, result) => {
          if (P.seq !== seq) return;
          const m = result && result.ok ? withResult(result, net, T, () => measure(Object.assign({}, o))) : null;
          delete it.pending;
          if (m) Object.assign(it, m); else { it.failed = true; job.failed++; }
          partial.delete(it); job.done++;
          if (--left === 0) {
            const more = job.round < 2 ? refine(P.points) : [];
            if (more.length) { job.round++; round(more); } else { finish(); return; }
          }
          progress(); render();
        };
        render(); cmds.sync(); progress();
        items.forEach(it => {
          const net = scale(base, it.g);
          if (!pool.ok) { setTimeout(() => { if (P.seq === seq) take(it, net, TubeSimEngine.simulate(net, options)); }, 0); return; }
          jobs.push(pool.run({ netlist: net, options }, {
            onResult: r => take(it, net, r),
            onProgress: f => { if (P.job && P.seq === seq) { partial.set(it, f); progress(); } }
          }));
        });
      };
      round(levels(+opts.lo, +opts.hi, opts.steps));
    }
    // set every generator to a level of the sweep (one undo step)
    function useLevel(k) {
      const pt = S.power.points && S.power.points[k]; if (!pt || pt.out === undefined) return;
      sources().forEach(c => { const key = SOURCES[c.type]; c.params[key] = +(+c.params[key] * pt.g).toPrecision(4); });
      commit();
      setStatus("ok", `Generator set to ${fmtEng(vinOf(1), "Vrms")} (${pt.db >= 0 ? "+" : ""}${pt.db.toFixed(1)} dB)`);
    }
    function changed() { if (S.power.points && !S.power.stale) { S.power.stale = true; render(); } }

    // the chart: THD and the 2nd and 3rd harmonics (%) against the output, both on log scales
    function chart(P) {
      const pts = P.points.map((p, k) => p.out > 0 && p.thd > 0 ? Object.assign({ k }, p) : null).filter(Boolean);
      const W = 460, H = 240, L = 46, R = 12, Tp = 10, B = 30;
      if (pts.length < 1) return `<svg class="pw-chart" viewBox="0 0 ${W} ${H}"></svg>`;
      const lg = Math.log10, dec = v => Math.floor(lg(v)), all = [];
      pts.forEach(p => { all.push(p.thd); if (p.rel[0] > 0) all.push(100 * p.rel[0]); if (p.rel[1] > 0) all.push(100 * p.rel[1]); });
      const x0 = dec(Math.min(...pts.map(p => p.out))), x1 = Math.max(x0 + 1, Math.ceil(lg(Math.max(...pts.map(p => p.out)))));
      const y0 = Math.max(-4, Math.min(-1, dec(Math.min(...pts.map(p => p.thd))))), y1 = 2;
      const X = v => L + (lg(v) - x0) / (x1 - x0) * (W - L - R), Y = v => Tp + (y1 - Math.max(y0, Math.min(y1, lg(v)))) / (y1 - y0) * (H - Tp - B);
      let s = `<svg class="pw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="THD against output">`;
      for (let d = x0; d <= x1; d++) {
        for (let m = 1; m < 10 && d + lg(m) <= x1; m++) { const x = X(m * Math.pow(10, d)); s += `<line class="${m === 1 ? "g1" : "g2"}" x1="${x}" x2="${x}" y1="${Tp}" y2="${H - B}"/>`; }
        s += `<text class="ax" x="${X(Math.pow(10, d))}" y="${H - B + 14}" text-anchor="middle">${esc(fmtEng(Math.pow(10, d), P.unit === "W" ? "W" : "V"))}</text>`;
      }
      for (let d = y0; d <= y1; d++) {
        const y = Y(Math.pow(10, d));
        s += `<line class="g1" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 5}" y="${y + (d === y0 ? 0 : 4)}" text-anchor="end">${Math.pow(10, d) >= 1 ? Math.pow(10, d) : Math.pow(10, d).toFixed(-d)} %</text>`;
      }
      [1, 10].forEach(v => { const y = Y(v); s += `<line class="ref" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`; });
      s += `<text class="ax" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">${esc(P.label)} ${P.unit === "W" ? "output power" : "output (rms)"}</text>`;
      const line = (f, cls) => { const q = pts.filter(p => f(p) > 0); return q.length > 1 ? `<polyline class="${cls}" points="${q.map(p => `${X(p.out).toFixed(1)},${Y(f(p)).toFixed(1)}`).join(" ")}"/>` : ""; };
      s += line(p => 100 * p.rel[1], "h3") + line(p => 100 * p.rel[0], "h2") + line(p => p.thd, "thd");
      // the generator's own level (0 dB): where the circuit runs now
      const now = pts.find(p => Math.abs(p.db) < 1e-9);
      if (now) s += `<line class="now" x1="${X(now.out)}" x2="${X(now.out)}" y1="${Tp}" y2="${H - B}"/>`;
      pts.forEach(p => { s += `<circle class="pt${p.k === P.hover ? " on" : ""}" data-i="${p.k}" cx="${X(p.out).toFixed(1)}" cy="${Y(p.thd).toFixed(1)}" r="${p.k === P.hover ? 5 : 3.2}"><title>${esc(`${dbText(p.db)}: ${fmtEng(p.out, P.unit)}, THD ${pctText(p.thd)} %`)}</title></circle>`; });
      MARKS.forEach(v => { const c = crossing(P.points, v); if (c) s += `<circle class="cross" cx="${X(c.out).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="4"/>`; });
      return s + "</svg>";
    }
    const dbText = db => `${db >= 0 ? "+" : ""}${db.toFixed(Math.abs(db * 10 - Math.round(db * 10)) > 1e-6 ? 2 : 1)} dB`;
    const pctText = v => (v < 0.001 ? "<0.001" : v < 0.1 ? v.toPrecision(2) : v.toFixed(v < 1 ? 3 : 2));
    const dbc = r => (r > 0 ? (20 * Math.log10(r)).toFixed(1) : "—");
    function render() {
      const host = document.getElementById("pw-pane"), btn = document.getElementById("btn-pw-run");
      if (btn) btn.textContent = S.power.job ? `■ Stop · ${S.power.job.done} / ${S.power.job.total}` : "▶ Run";
      const sel = document.getElementById("pw-out");
      if (sel && document.activeElement !== sel) {
        const o = outputs(), cur = pick();
        const html = o.length ? o.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("") : `<option value="">No speaker or scope</option>`;
        if (sel.innerHTML !== html) sel.innerHTML = html;
        sel.value = cur ? cur.id : "";
      }
      if (!host || host.hidden) return;
      const P = S.power;
      if (P.error && !P.job) { host.innerHTML = `<div class="bom-empty">${esc(P.error)}</div>`; return; }
      if (!P.points) {
        host.innerHTML = `<div class="bom-empty">Press ▶ Run: the circuit is simulated at ${Math.round(opts.steps)} input levels from ${opts.lo} dB to ${opts.hi >= 0 ? "+" : ""}${opts.hi} dB of the generator's level, and the chart shows the distortion against the output power, with the power at 1 %, 5 % and 10 % THD.</div>`;
        return;
      }
      const u = P.unit, cards = MARKS.map(v => {
        const c = P.job ? null : crossing(P.points, v);
        return `<div class="pw-card${v === 1 ? " main" : ""}" title="${v} % THD${c ? ` at ${c.db >= 0 ? "+" : ""}${c.db.toFixed(1)} dB of the generator's level` : ""}"><span>at ${v} % THD</span><b>${P.job ? "…" : c ? esc(fmtEng(c.out, u)) : "not reached"}</b></div>`;
      }).join("");
      const first = P.points.find(p => p.out > 0);
      const gain = first && P.vin > 0 ? `<div class="pw-card" title="The output against the generator at the lowest level: the small-signal gain"><span>gain</span><b>${(20 * Math.log10(first.vrms / (P.vin * first.g))).toFixed(1)} dB</b></div>` : "";
      const note = (P.stale ? `<div class="bom-empty tol-note">The circuit changed since this sweep: press ▶ Run again.</div>` : "")
        + (!P.job && P.points.some(p => p.failed) ? `<div class="bom-empty tol-note">${P.points.filter(p => p.failed).length} levels did not settle and are left out.</div>` : "");
      const rows = P.points.map((p, k) => {
        const lvl = `<td class="n mono">${dbText(p.db)}</td>`;
        if (p.pending) return `<tr class="pend">${lvl}<td colspan="6" class="muted">simulating…</td></tr>`;
        if (p.failed) return `<tr>${lvl}<td colspan="6" class="muted">did not settle</td></tr>`;
        return `<tr data-i="${k}" class="${k === P.hover ? "on" : ""}${Math.abs(p.db) < 1e-9 ? " now" : ""}">${lvl}<td class="n mono">${esc(fmtEng(P.vin * p.g, "Vrms"))}</td>`
          + `<td class="n mono">${esc(fmtEng(p.out, u))}</td><td class="n mono${p.thd >= 10 ? " warn" : ""}">${pctText(p.thd)} %</td><td class="n mono">${dbc(p.rel[0])}</td><td class="n mono">${dbc(p.rel[1])}</td>`
          + `<td><button class="btn pw-use" data-i="${k}" title="Set the generator to this level (undo with Ctrl+Z)">Use</button></td></tr>`;
      }).join("");
      host.innerHTML = note + `<div class="pw-wrap"><div class="pw-left"><div class="pw-cards">${cards}${gain}</div>${chart(P)}`
        + `<div class="pw-key"><span class="k thd"></span>THD <span class="k h2"></span>2nd <span class="k h3"></span>3rd <span class="k now"></span>generator's level now</div></div>`
        + `<div class="pw-right"><table id="pw-table"><thead><tr><th title="Every generator's level against what it is set to now">Level</th><th title="The first generator's output (rms)">Input</th><th>${u === "W" ? "Power" : "Output"}</th><th title="Total harmonic distortion, 2nd to 10th harmonic">THD</th><th title="2nd harmonic against the fundamental">H2 dBc</th><th title="3rd harmonic against the fundamental">H3 dBc</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
    }
    function hover(k) {
      if (S.power.hover === k) return;
      S.power.hover = k;
      const host = document.getElementById("pw-pane"); if (!host) return;
      host.querySelectorAll("#pw-table tbody tr").forEach(tr => tr.classList.toggle("on", +tr.dataset.i === k && tr.dataset.i !== undefined));
      host.querySelectorAll(".pw-chart circle.pt").forEach(c => { const on = +c.dataset.i === k; c.classList.toggle("on", on); c.setAttribute("r", on ? 5 : 3.2); });
    }
    function init() {
      [["lo", -80, 40], ["hi", -60, 60], ["steps", 2, 60]].forEach(([k, lo, hi]) => {
        const el = document.getElementById("pw-" + k); if (!el) return;
        el.value = opts[k];
        el.addEventListener("change", () => { const v = Math.round(+el.value * 10) / 10; if (isFinite(v) && v >= lo && v <= hi) { opts[k] = k === "steps" ? Math.round(v) : v; if (opts.lo >= opts.hi) opts[k === "lo" ? "hi" : "lo"] = k === "lo" ? v + 6 : v - 6; save(); } ["lo", "hi", "steps"].forEach(j => { const e = document.getElementById("pw-" + j); if (e) e.value = opts[j]; }); render(); });
      });
      const sel = document.getElementById("pw-out");
      if (sel) sel.addEventListener("change", () => { opts.out = sel.value; save(); });
      const btn = document.getElementById("btn-pw-run");
      if (btn) btn.addEventListener("click", () => (S.power.job ? stop() : run()));
      const host = document.getElementById("pw-pane");
      if (host) {
        host.addEventListener("click", e => { const b = e.target.closest(".pw-use"); if (b) useLevel(+b.dataset.i); });
        host.addEventListener("mouseover", e => { const t = e.target.closest("[data-i]"); hover(t ? +t.dataset.i : -1); });
        host.addEventListener("mouseleave", () => hover(-1));
      }
      render();
    }
    return { changed, init, render, run, stop, useLevel, outputs };
  }
  CadPower.levels = levels; CadPower.scale = scale; CadPower.distortion = distortion; CadPower.crossing = crossing;
  root.CadPower = CadPower;
})(typeof window !== "undefined" ? window : globalThis);
