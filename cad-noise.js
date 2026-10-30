/* Noise and hum, the Noise tab under the schematic: what an amplifier puts out with no signal.
   Noise: every resistor, tube and transistor of the circuit linearized at its idle point, carried
   to the output (engine noiseSweep): the output noise and the input noise it amounts to, flat and
   A-weighted over 20 Hz – 20 kHz, the signal-to-noise ratio, and the parts it comes from. Hum: the
   ripple of a mains-fed supply that reaches the output, from the steady state with the generators
   quiet (every harmonic of the mains), and an estimate of the hum AC heaters couple in: through each
   indirectly heated cathode's leakage and capacitance to its heater, or in series with a directly
   heated filament. The runs go to the engine's pool. */
(function (root) {
  "use strict";
  // A-weighting (IEC 61672) as a gain: 1 at 1 kHz
  function aWeight(f) {
    const f2 = f * f, ra = 12194 * 12194 * f2 * f2 / ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
    return ra * Math.pow(10, 2.0 / 20);
  }
  // ∫ psd·w(f)² df from lo to hi over a log-spaced sweep (trapezoids in ln f, the ends interpolated)
  function bandPower(f, psd, lo, hi, w) {
    const g = k => psd[k] * (w ? w(f[k]) * w(f[k]) : 1) * f[k];   // the integrand against ln f
    let s = 0;
    for (let k = 1; k < f.length; k++) {
      const a = Math.max(lo, f[k - 1]), b = Math.min(hi, f[k]);
      if (!(b > a)) continue;
      const L = Math.log(f[k] / f[k - 1]), at = x => g(k - 1) + (g(k) - g(k - 1)) * Math.log(x / f[k - 1]) / L;
      s += (at(a) + at(b)) / 2 * Math.log(b / a);
    }
    return s;
  }
  // the coupling an AC heater gives (typical figures): an indirectly heated cathode sees its heater
  // through 5 pF and 100 MΩ of leakage; the heater's average potential against the cathode is half its
  // voltage with one side grounded, about 5 % of that with a centre tap or humdinger (the balance a
  // real winding and heater reach); a directly heated filament carries that in series with its cathode
  const HEATER = { chk: 5e-12, rhk: 100e6, balance: 0.05 };
  function heaterDrive(mode, vh) { return mode === "dc" ? 0 : (mode === "ct" ? HEATER.balance : 1) * vh / 2; }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadNoise(cad) {
    const { S, buildNetlist, cmds, desig, esc, fmtEng, harmonics, pool, scopeChannels, setStatus, speakerWave, topo, tubeByName, withResult } = cad;
    const KEY = "tubecad_noise";
    const opts = { out: "", heaters: "ground", flicker: 1000, mains: 50 };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    S.noise = { seq: 0, job: null, res: null, error: null, stale: false, opts };
    let jobs = [];
    const SOURCES = ["siggen", "pickup", "phono"];
    const RANGE = { fStart: 10, fStop: 100e3, perDecade: 20 };

    function outputs() {
      const out = [];
      S.comps.forEach(c => {
        const name = desig(c) || c.id;
        if (c.type === "speaker") out.push({ id: c.id, label: `${name} speaker`, speaker: c });
        else if (c.type === "scope") ["CH1", "CH2"].forEach(ch => out.push({ id: c.id + ":" + ch, label: `${name} ${ch}` }));
      });
      return out;
    }
    const pick = () => { const o = outputs(); return o.find(x => x.id === opts.out) || o[0] || null; };
    // the output's two nodes, and its waveform in the result in place
    function outNodes(o, T) {
      if (o.speaker) return [T.pinNet.get(o.id + ":+") || 0, T.pinNet.get(o.id + ":-") || 0];
      const [id, ch] = o.id.split(":");
      return T.pinConnected.get(id + ":" + ch) ? [T.pinNet.get(id + ":" + ch) || 0, T.pinNet.get(id + ":COM") || 0] : null;
    }
    function outWave(o) {
      if (o.speaker) { const sw = speakerWave(o.speaker); return sw && sw.v; }
      const [id, ch] = o.id.split(":"), c = S.comps.find(x => x.id === id), chs = c && scopeChannels(c);
      return chs && chs[ch.toLowerCase()];
    }
    const acRms = w => { if (!w || !w.length) return 0; let m = 0; for (let k = 0; k < w.length; k++) m += w[k]; m /= w.length; let q = 0; for (let k = 0; k < w.length; k++) q += (w[k] - m) * (w[k] - m); return Math.sqrt(q / w.length); };

    function stop() {
      jobs.forEach(j => j.cancel()); jobs = [];
      if (S.noise.job) { S.noise.job = null; S.noise.seq++; setStatus("idle", "Noise run stopped"); render(); cmds.sync(); }
    }
    // the mains source as the sheet names it, e.g. "G1 (230 V 50 Hz mains)"
    function mainsName(el) {
      const c = S.comps.find(c => c.id === el.id);
      const v = c && +c.params.vrms ? fmtEng(+c.params.vrms, "V") + " " : "";
      return (c ? desig(c) + " " : "") + `(${v}${fmtEng(el.freq, "Hz")} mains)`;
    }
    function run() {
      stop();
      const N = S.noise, T = topo(), o = pick();
      const nodes = o && outNodes(o, T);
      N.error = !S.comps.length ? "Empty sheet" : !T.hasGround ? "Add a ground symbol to simulate"
        : !o ? "Nothing to measure: place a speaker as the load, or an oscilloscope on the output."
        : !nodes || nodes[0] === nodes[1] ? "That scope channel is not connected" : null;
      if (N.error) { N.res = null; render(); return; }
      const base = buildNetlist(), quiet = new Set(S.comps.filter(c => SOURCES.includes(c.type)).map(c => c.id));
      const nl = { nodeCount: base.nodeCount, elements: base.elements.map(e => (quiet.has(e.id) ? Object.assign({}, e, { amp: 0, mv: 0 }) : e)) };
      const gen = S.comps.find(c => SOURCES.includes(c.type));
      const mainsEl = nl.elements.find(e => e.acMains), fm = mainsEl ? mainsEl.freq : +opts.mains || 50;
      // the output now, with the generators as set: the reference for the signal-to-noise ratio
      const sigNow = S.sim.result && S.sim.result.tran ? acRms(outWave(o)) : 0;
      const seq = ++N.seq, job = N.job = { seq, left: 0 };
      const res = N.res = { label: o.label, speaker: o.speaker ? +o.speaker.params.r || 8 : 0, fm, mains: !!mainsEl, heaters: opts.heaters, flicker: +opts.flicker || 0, sigNow, gen: gen ? desig(gen) : null, mainsName: mainsEl ? mainsName(mainsEl) : "" };
      N.stale = false;
      const fail = msg => { if (N.seq !== seq) return; jobs.forEach(j => j.cancel()); jobs = []; N.job = null; N.error = msg; N.res = null; setStatus("warn", "Noise: " + msg); render(); cmds.sync(); };
      const part = () => { if (N.seq !== seq) return; if (--job.left > 0) { render(); return; } jobs = []; N.job = null; finish(res); render(); cmds.sync(); };
      const go = (payload, cb) => {
        job.left++;
        if (!pool.ok) { setTimeout(() => { if (N.seq !== seq) return; const k = payload.kind; const r = k === "noise" ? TubeSimEngine.noiseSweep(payload.netlist, payload.options) : k === "ac" ? TubeSimEngine.acSweep(payload.netlist, payload.options) : TubeSimEngine.simulate(payload.netlist, payload.options); cb(r); }, 0); return; }
        jobs.push(pool.run(payload, { urgent: true, high: true, onResult: r => { if (N.seq === seq) cb(r); } }));
      };
      // noise and heater hum about the operating point (op: a mains-fed circuit's averaged steady state)
      const linear = (op, opIm) => {
        go({ netlist: nl, kind: "noise", options: Object.assign({ out: nodes, input: gen ? gen.id : null, flicker: res.flicker, op, opIm }, RANGE) }, r => {
          if (!r.ok) { fail(r.error); return; }
          res.noise = r; part();
        });
        const H = heaterNetlist(nl, op, opts.heaters);
        if (!H) { res.heater = { rms: 0, tubes: 0 }; return; }
        go({ netlist: H.netlist, kind: "ac", options: { inputs: H.inputs, probes: [nodes], fStart: fm, fStop: fm * 1.001, perDecade: 1, op: H.op, opIm } }, r => {
          if (!r.ok) { fail(r.error); return; }
          res.heater = { rms: Math.hypot(r.probes[0].re[0], r.probes[0].im[0]), tubes: H.tubes, dht: H.dht }; part();
        });
      };
      setStatus("busy", "Noise and hum…");
      render(); cmds.sync();
      if (!mainsEl) { res.ripple = null; linear(null, null); return; }
      // the steady state with the generators quiet: the hum the supply leaves at the output, and the operating point
      go({ netlist: nl, options: { budgetMs: 120000 } }, r => {
        if (!r.ok) { fail(r.error); return; }
        const w = withResult(r, nl, T, () => outWave(o));
        const h = w && r.tran ? harmonics(w, fm, r.tran.dt, 8) : [];
        res.ripple = { h: h.map((a, i) => ({ f: fm * (i + 1), rms: a / Math.SQRT2 })) };
        linear(r.dc.nodes, TubeSimEngine.opMagnetising(r));
        part();
      });
    }
    // The netlist with the heaters' coupling: a 1 V source drives each indirectly heated cathode through
    // its leakage and capacitance (scaled by its heater's drive), and a directly heated filament gets a
    // source of its own in series with its cathode. null: nothing to add (DC heaters, no tubes).
    function heaterNetlist(nl, op, mode) {
      if (mode === "dc") return null;
      let next = nl.nodeCount;
      const h = next++, elements = nl.elements.slice(), inputs = [{ id: "#heater", mag: 1 }], extraOp = [0];
      let tubes = 0, dht = 0;
      elements.push({ id: "#heater", kind: "V", nodes: [h, 0], v: 0 });
      S.comps.filter(c => c.type === "tube").forEach(c => {
        const t = tubeByName(c.params.tube);
        if (!t) return;
        elements.forEach((e, i) => {
          if (e.id !== c.id || (e.kind !== "TRIODE" && e.kind !== "PENTODE")) return;
          const ki = e.nodes.length - 1, k = e.nodes[ki];
          if (t.directlyHeated) {
            const kk = next++;
            elements[i] = Object.assign({}, e, { nodes: e.nodes.map((n, j) => (j === ki ? kk : n)) });
            elements.push({ id: "#fil-" + c.id, kind: "V", nodes: [kk, k], v: 0 });
            inputs.push({ id: "#fil-" + c.id, mag: heaterDrive(mode, +t.vh || 2.5) });
            extraOp.push(op ? op[k] || 0 : 0); dht++;
          } else {
            // a 12.6 V heater is taken as wired for 6.3 V (its centre tap), the usual way
            const d = heaterDrive(mode, +t.vh >= 12 ? +t.vh / 2 : +t.vh || 6.3);
            if (!(d > 0) || !(k > 0)) return;
            elements.push({ id: "#hk-c-" + c.id, kind: "C", nodes: [h, k], c: HEATER.chk * d }, { id: "#hk-r-" + c.id, kind: "R", nodes: [h, k], r: HEATER.rhk / d });
            tubes++;
          }
        });
      });
      if (!tubes && !dht) return null;
      return { netlist: { nodeCount: next, elements }, inputs, op: op ? Array.from(op).concat(extraOp) : null, tubes, dht };
    }
    // the figures from the runs: noise over the band, the input noise, the hum, the ratios
    function finish(res) {
      const nz = res.noise, f = nz.freqs;
      const speakerIds = new Set(S.comps.filter(c => c.type === "speaker").map(c => c.id));
      const baseId = id => String(id).split("#")[0];
      // the load's own resistance is not the amplifier's noise
      const srcs = nz.sources.filter(s => !speakerIds.has(baseId(s.id)));
      const total = new Float64Array(f.length); srcs.forEach(s => { for (let k = 0; k < f.length; k++) total[k] += s.psd[k]; });
      const gain = new Float64Array(f.length); for (let k = 0; k < f.length; k++) gain[k] = Math.hypot(nz.gain.re[k], nz.gain.im[k]);
      const k1 = f.reduce((b, x, k) => (Math.abs(Math.log(x / 1000)) < Math.abs(Math.log(f[b] / 1000)) ? k : b), 0);
      res.f = Array.from(f); res.total = Array.from(total); res.gain = Array.from(gain);
      res.outFlat = Math.sqrt(bandPower(f, total, 20, 20000));
      res.outA = Math.sqrt(bandPower(f, total, 20, 20000, aWeight));
      res.g1k = gain[k1];
      res.einA = res.g1k > 0 ? res.outA / res.g1k : null;
      res.ein1k = res.g1k > 0 ? Math.sqrt(total[k1]) / res.g1k : null;
      // where it comes from: each part's share of the A-weighted output noise
      const by = new Map();
      srcs.forEach(s => { const id = baseId(s.id), p = bandPower(f, s.psd, 20, 20000, aWeight); by.set(id, (by.get(id) || 0) + p); });
      const sum = [...by.values()].reduce((a, b) => a + b, 0) || 1;
      res.parts = [...by.entries()].map(([id, p]) => {
        const c = S.comps.find(x => x.id === id);
        return { id, label: c ? (desig(c) || id) + (SOURCES.includes(c.type) ? " (source resistance)" : "") : id, kind: c ? c.type : "", v: Math.sqrt(p), share: p / sum };
      }).sort((a, b) => b.share - a.share);
      // hum
      if (res.ripple) {
        res.ripple.rms = Math.sqrt(res.ripple.h.reduce((s, x) => s + x.rms * x.rms, 0));
        res.ripple.a = Math.sqrt(res.ripple.h.reduce((s, x) => s + Math.pow(x.rms * aWeight(x.f), 2), 0));
      }
      if (res.heater) res.heater.a = res.heater.rms * aWeight(res.fm);
      const humA = Math.hypot(res.ripple ? res.ripple.a : 0, res.heater ? res.heater.a : 0);
      res.allA = Math.hypot(res.outA, humA);
      res.v1W = res.speaker ? Math.sqrt(res.speaker) : 0;
      setStatus("ok", `Noise: ${fmtEng(res.outA, "V")} A-weighted at ${res.label}` + (res.v1W ? ` · S/N ${(20 * Math.log10(res.v1W / res.allA)).toFixed(1)} dB(A) re 1 W` : ""));
    }
    function changed() { if (S.noise.res && !S.noise.stale) { S.noise.stale = true; render(); } }

    // the chart: output noise density, and the same carried back to the input, against frequency
    function chart(res) {
      const W = 460, H = 220, L = 54, R = 12, Tp = 10, B = 30, f = res.f;
      const out = res.total.map(Math.sqrt), inp = res.total.map((v, k) => (res.gain[k] > 1e-12 ? Math.sqrt(v) / res.gain[k] : 0));
      const all = out.concat(inp).filter(v => v > 0), lg = Math.log10;
      if (!all.length) return "";
      const y1 = Math.ceil(lg(Math.max(...all))), y0 = Math.max(y1 - 6, Math.floor(lg(Math.min(...all))));
      const X = v => L + (lg(v) - 1) / 4 * (W - L - R), Y = v => Tp + (y1 - Math.max(y0, Math.min(y1, lg(v)))) / (y1 - y0) * (H - Tp - B);
      let s = `<svg class="pw-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Noise density against frequency">`;
      for (let d = 1; d <= 5; d++) {
        for (let m = 1; m < 10 && d + lg(m) <= 5; m++) { const x = X(m * Math.pow(10, d)); s += `<line class="${m === 1 ? "g1" : "g2"}" x1="${x}" x2="${x}" y1="${Tp}" y2="${H - B}"/>`; }
        s += `<text class="ax" x="${X(Math.pow(10, d))}" y="${H - B + 14}" text-anchor="middle">${esc(fmtEng(Math.pow(10, d), "Hz"))}</text>`;
      }
      for (let d = y0; d <= y1; d++) { const y = Y(Math.pow(10, d)); s += `<line class="g1" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 5}" y="${y + (d === y0 ? 0 : 4)}" text-anchor="end">${esc(fmtEng(Math.pow(10, d), "V"))}</text>`; }
      [20, 20000].forEach(v => { const x = X(v); s += `<line class="ref" x1="${x}" x2="${x}" y1="${Tp}" y2="${H - B}"/>`; });
      s += `<text class="ax" x="${(L + W - R) / 2}" y="${H - 3}" text-anchor="middle">noise density, per √Hz</text>`;
      const line = (a, cls) => `<polyline class="${cls}" points="${f.map((x, k) => (a[k] > 0 ? `${X(x).toFixed(1)},${Y(a[k]).toFixed(1)}` : "")).filter(Boolean).join(" ")}"/>`;
      return s + line(inp, "h2") + line(out, "thd") + "</svg>";
    }
    const db = (a, b) => (a > 0 && b > 0 ? `${(20 * Math.log10(a / b)).toFixed(1)} dB` : "—");
    const nv = v => (v === null || !isFinite(v) ? "—" : esc(fmtEng(v, "V")));
    function render() {
      const host = document.getElementById("nz-pane"), btn = document.getElementById("btn-nz-run");
      if (btn) btn.textContent = S.noise.job ? "■ Stop" : "▶ Run";
      const sel = document.getElementById("nz-out");
      if (sel && document.activeElement !== sel) {
        const o = outputs(), cur = pick();
        const html = o.length ? o.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("") : `<option value="">No speaker or scope</option>`;
        if (sel.innerHTML !== html) sel.innerHTML = html;
        sel.value = cur ? cur.id : "";
      }
      if (!host || host.hidden) return;
      const N = S.noise, res = N.res;
      if (N.error && !N.job) { host.innerHTML = `<div class="bom-empty">${esc(N.error)}</div>`; return; }
      if (!res) {
        host.innerHTML = `<div class="bom-empty">Press ▶ Run: with the generators quiet, the noise of every resistor, tube and transistor is carried to the output (flat and A-weighted, 20 Hz – 20 kHz, with the parts it comes from), the supply's ripple that reaches the output is measured, and the hum AC heaters would add is estimated.</div>`;
        return;
      }
      if (N.job || !res.parts) { host.innerHTML = `<div class="bom-empty">Working out the noise and hum…</div>`; return; }
      const ref = res.v1W || res.sigNow, refName = res.v1W ? "re 1 W" : "re the output now";
      const card = (label, value, title, main) => `<div class="pw-card${main ? " main" : ""}" title="${esc(title)}"><span>${label}</span><b>${value}</b></div>`;
      const cards = card("S/N (A)", ref ? db(ref, res.allA) : "—", `Signal-to-noise ${refName}${res.v1W ? ` (${fmtEng(res.v1W, "Vrms")} into the speaker's ${res.speaker} Ω)` : ""}, A-weighted, noise and hum together`, true)
        + card("noise (A)", nv(res.outA), "Output noise, A-weighted, 20 Hz – 20 kHz")
        + card("noise flat", nv(res.outFlat), "Output noise, unweighted, 20 Hz – 20 kHz")
        + card("input noise (A)", nv(res.einA), `The output noise (A) over the gain at 1 kHz${res.gen ? ` from ${res.gen}` : ""}: what a noiseless amplifier would need at its input`)
        + (res.ein1k !== null ? card("at 1 kHz", nv(res.ein1k) + "/√Hz", "Input noise density at 1 kHz") : "")
        + card("hum (A)", nv(Math.hypot(res.ripple ? res.ripple.a : 0, res.heater ? res.heater.a : 0)), "Ripple and heater hum at the output, A-weighted");
      const ratio = v => (ref && v > 0 ? `<td class="n mono">${db(v, ref)}</td>` : `<td class="n mono">—</td>`);
      // the mains is hum, not noise: its ripple is listed by harmonic under Hum, named after the mains source
      const mn = esc(res.mainsName || "the mains");
      const hum = (res.ripple ? `<tr class="nz-from"><td colspan="3" title="The supply's ripple that reaches the output, read at every harmonic of the mains">From ${mn}, through the supply:</td></tr>`
        + res.ripple.h.filter(x => x.rms > 1e-9).map(x => `<tr><td>Ripple ${esc(fmtEng(x.f, "Hz"))}</td><td class="n mono">${nv(x.rms)}</td>${ratio(x.rms)}</tr>`).join("")
        + `<tr class="sum"><td>Ripple, all (A)</td><td class="n mono">${nv(res.ripple.a)}</td>${ratio(res.ripple.a)}</tr>`
        : `<tr><td colspan="3" class="muted">No mains in the circuit: its supplies are ideal DC, so no ripple</td></tr>`)
        + (res.heater && (res.heater.tubes || res.heater.dht) ? `<tr><td title="${esc(`${res.heater.tubes} indirectly heated, ${res.heater.dht || 0} directly heated; typical coupling: 5 pF and 100 MΩ heater to cathode`)}">AC heaters ${esc(fmtEng(res.fm, "Hz"))}</td><td class="n mono">${nv(res.heater.rms)}</td>${ratio(res.heater.rms)}</tr><tr class="sum"><td>AC heaters (A)</td><td class="n mono">${nv(res.heater.a)}</td>${ratio(res.heater.a)}</tr>`
          : `<tr><td colspan="3" class="muted">${res.heaters === "dc" ? "DC heaters: no heater hum" : "No tubes: no heater hum"}</td></tr>`);
      const parts = res.parts.filter(p => p.share >= 0.001).slice(0, 14).map(p => `<tr><td>${esc(p.label)}</td><td class="n mono">${nv(p.v)}</td><td class="n mono">${(100 * p.share).toFixed(p.share < 0.1 ? 1 : 0)} %</td></tr>`).join("")
        // the mains makes hum, not random noise: a pointer to it, with its total, so it is not missed
        + (res.ripple ? `<tr class="nz-mains" title="The mains adds hum at 50/100 Hz… rather than random noise: its ripple, harmonic by harmonic, is in the Hum table below"><td>${esc(res.mainsName)}: hum, see below</td><td class="n mono">${nv(res.ripple.a)}</td><td class="n mono">—</td></tr>` : "");
      const note = N.stale ? `<div class="bom-empty tol-note">The circuit changed since this run: press ▶ Run again.</div>` : "";
      host.innerHTML = note + `<div class="pw-wrap"><div class="pw-left"><div class="pw-cards">${cards}</div>${chart(res)}`
        + `<div class="pw-key"><span class="k"></span>at ${esc(res.label)} <span class="k h2"></span>at the input (÷ the gain)${res.flicker ? ` · tubes' 1/f corner ${esc(fmtEng(res.flicker, "Hz"))}` : ""}</div></div>`
        + `<div class="pw-right"><table class="nz-table"><thead><tr><th>Noise from</th><th title="At the output, A-weighted">Output (A)</th><th>Share</th></tr></thead><tbody>${parts}</tbody></table>`
        + `<table class="nz-table"><thead><tr><th>Hum</th><th>Output</th><th>${esc(refName)}</th></tr></thead><tbody>${hum}</tbody></table></div></div>`;
    }
    function init() {
      const sel = document.getElementById("nz-out");
      if (sel) sel.addEventListener("change", () => { opts.out = sel.value; save(); });
      const ht = document.getElementById("nz-heaters");
      if (ht) { ht.value = opts.heaters; ht.addEventListener("change", () => { opts.heaters = ht.value; save(); }); }
      const fl = document.getElementById("nz-flicker");
      if (fl) { fl.value = opts.flicker; fl.addEventListener("change", () => { const v = +fl.value; if (isFinite(v) && v >= 0 && v <= 1e5) { opts.flicker = v; save(); } fl.value = opts.flicker; }); }
      const mn = document.getElementById("nz-mains");
      if (mn) { mn.value = String(opts.mains); mn.addEventListener("change", () => { opts.mains = +mn.value; save(); }); }
      const btn = document.getElementById("btn-nz-run");
      if (btn) btn.addEventListener("click", () => (S.noise.job ? stop() : run()));
      render();
    }
    return { changed, init, render, run, stop, outputs };
  }
  CadNoise.aWeight = aWeight; CadNoise.bandPower = bandPower; CadNoise.heaterDrive = heaterDrive; CadNoise.HEATER = HEATER;
  root.CadNoise = CadNoise;
})(typeof window !== "undefined" ? window : globalThis);
