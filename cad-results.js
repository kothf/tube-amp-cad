/* What the CAD reads from the last simulation result (S.sim.result): node voltages (DC, AC, waves),
   pin and wire currents, power in resistors and speakers, waveform statistics and harmonics, and
   each tube's operating data and its ratings. Used by the stickers, the inspector, the checks, the
   instruments' broadcast, the board netlist, the probe, the animation and the tolerance runs. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadResults = function (cad) {
    const { S, buildNetlist, compPins, decimate, fmtEng, key, topo, tubeByName, tubeKind } = cad;
    // Node voltage helpers on the last result
    function netDC(net) { const r = S.sim.result; return r && net !== undefined && r.dc.nodes[net] !== undefined ? r.dc.nodes[net] : null; }
    // AC on a net over the captured cycles: rms of the wave about its mean (null below 1 mV).
    // signal: the AC is a real part of the node (≥ 1 % of its DC), not just a rail's ripple
    let acCache = null;
    // three significant figures: 20.1, 353m, 1.25
    const acDigits = v => { const m = v / Math.pow(1000, Math.floor(Math.log10(v) / 3)); return m >= 99.95 ? 0 : m >= 9.995 ? 1 : 2; };
    function netAC(net) {
      const r = S.sim.result; if (!r || !r.tran || !(net > 0)) return null;
      if (!acCache || acCache.r !== r) acCache = { r, m: new Map() };
      if (acCache.m.has(net)) return acCache.m.get(net);
      const st = stats(netWave(net)), dc = netDC(net);
      const ac = st && st.rmsAC >= 1e-3 ? { rms: st.rmsAC, pp: st.pp, signal: st.rmsAC >= 0.01 * Math.abs(dc || 0) } : null;
      acCache.m.set(net, ac); return ac;
    }
    function netWave(net) { const r = S.sim.result; return r && r.tran && net !== undefined && net > 0 ? r.tran.nodes[net] : null; }
    function pinNetOf(c, pid) { const T = S.sim.topo || topo(); return T.pinNet.get(c.id + ":" + pid); }
    // DC current flowing from the net into each part's pin ("compId:pinId" -> A), summed
    // from the solver elements' terminal currents (averaged over the window when the DC
    // readouts are). A part with two pins on one net leaves them out: the split is unknown.
    function pinCurrents() {
      const r = S.sim.result;
      if (!r || !r.dc.currents) return null;
      if (S.sim.pinI && S.sim.pinI.result === r) return S.sim.pinI.map;
      const map = pinMap(r.dc.currents);
      S.sim.pinI = { result: r, map };
      return map;
    }
    // pin currents from a flat [id, node, i, ...] list (the averages, or one animation frame)
    function pinMap(cur) {
      const T = S.sim.topo || topo(), byComp = new Map();
      for (let k = 0; k < cur.length; k += 3) {
        const id = String(cur[k]), h = id.indexOf("#"), cid = h < 0 ? id : id.slice(0, h);
        let m = byComp.get(cid); if (!m) byComp.set(cid, m = new Map());
        m.set(cur[k + 1], (m.get(cur[k + 1]) || 0) + cur[k + 2]);
      }
      const map = new Map();
      S.comps.forEach(c => {
        const m = byComp.get(c.id); if (!m) return;
        const pins = compPins(c), nets = pins.map(p => T.pinNet.get(c.id + ":" + p.id));
        pins.forEach((p, i) => { if (nets[i] !== undefined && nets.indexOf(nets[i]) === i && nets.lastIndexOf(nets[i]) === i) map.set(c.id + ":" + p.id, m.get(nets[i]) || 0); });
      });
      return map;
    }
    function pinCurrent(c, pid) { const m = pinCurrents(), v = m && m.get(c.id + ":" + pid); return v === undefined ? null : v; }
    // DC current in each wire segment (wire id -> A, positive from (x1,y1) to (x2,y2)).
    // In the wiring of a net, a loose end whose pins draw a known current passes it on to
    // the next point, and so on inwards; segments stay unknown only in loops or between
    // points with an unknown current (ground symbols, sheet connectors), at most one of which
    // a tree can absorb.
    function wireCurrents(given) {
      const pins = given || pinCurrents(); if (!pins) return null;
      const draw = new Map(), hasPin = new Set();   // point -> current drawn from the wiring there (consumed below)
      const free = new Set();
      S.comps.forEach(c => compPins(c).forEach(p => {
        const k = key(p.x, p.y), v = pins.get(c.id + ":" + p.id);
        hasPin.add(k);
        if (v === undefined) free.add(k); else draw.set(k, (draw.get(k) || 0) + v);
      }));
      const adj = new Map();
      const link = (k, w, other) => { if (!adj.has(k)) adj.set(k, []); adj.get(k).push({ w, other }); };
      S.wires.forEach(w => { const a = key(w.x1, w.y1), b = key(w.x2, w.y2); link(a, w, b); link(b, w, a); });
      const deg = new Map(), out = new Map();
      adj.forEach((l, k) => deg.set(k, l.length));
      const queue = [...adj.keys()].filter(k => deg.get(k) === 1);
      while (queue.length) {
        const k = queue.pop();
        if (deg.get(k) !== 1 || free.has(k)) continue;
        const e = adj.get(k).find(e => !out.has(e.w.id)); if (!e) continue;
        const i = draw.get(k) || 0;                   // flows along the segment towards k
        out.set(e.w.id, key(e.w.x2, e.w.y2) === k ? i : -i);
        deg.set(k, 0);
        draw.set(e.other, (draw.get(e.other) || 0) + i);
        deg.set(e.other, deg.get(e.other) - 1);
        if (deg.get(e.other) === 1) queue.push(e.other);
      }
      // what the pins draw at each point, for the stickers
      const pinDraw = new Map();
      S.comps.forEach(c => compPins(c).forEach(p => { const v = pins.get(c.id + ":" + p.id), k = key(p.x, p.y); pinDraw.set(k, v === undefined ? NaN : (pinDraw.get(k) || 0) + v); }));
      return { currents: out, adj, pinDraw };
    }

    // DC current in a catalog output transformer's primary (from the drop across its DCR)
    function otDcCurrent(c) {
      const m = CadLib.OUTPUT_TX[c.params.model], va = netDC(pinNetOf(c, "P1")), vb = netDC(pinNetOf(c, "P2"));
      return !m || va === null || vb === null ? null : (va - vb) / m.rp;
    }
    // average power in a resistor: from the steady-state waveform when there is one, else DC
    function resistorPower(c) {
      const wa = waveOf(c, "1"), wb = waveOf(c, "2");
      if (wa && wb) { let s = 0; for (let i = 0; i < wa.length; i++) { const v = wa[i] - wb[i]; s += v * v; } return s / wa.length / c.params.r; }
      const va = netDC(pinNetOf(c, "1")), vb = netDC(pinNetOf(c, "2"));
      return va === null || vb === null ? null : (va - vb) * (va - vb) / c.params.r;
    }
    function waveOf(c, pid) {
      const n = pinNetOf(c, pid), r = S.sim.result;
      if (!r || !r.tran) return null;
      if (n === 0) return new Float32Array(r.tran.samples);
      return r.tran.nodes[n] || null;
    }
    // a speaker's voltage and current over the captured cycle: the current through Re for the
    // Thiele–Small model (its inner node), V/R for the resistor
    function speakerWave(c) {
      const a = waveOf(c, "+"), b = waveOf(c, "-"), r = S.sim.result;
      if (!a || !b) return null;
      const n = a.length, v = new Float32Array(n), i = new Float32Array(n);
      let inner = null;
      if (c.params.model === "ts") { const e = buildNetlist().elements.find(x => x.id === c.id + "#re"); inner = e && r.tran.nodes[e.nodes[1]]; }
      const re = c.params.model === "ts" ? CadLib.speakerTS(c.params).re : Math.max(c.params.r, 0.1);
      for (let k = 0; k < n; k++) { v[k] = a[k] - b[k]; i[k] = inner ? (a[k] - inner[k]) / re : v[k] / re; }
      return { v, i };
    }
    function speakerPower(c) {
      const w = speakerWave(c); if (!w) return null;
      let p = 0, vv = 0; for (let k = 0; k < w.v.length; k++) { p += w.v[k] * w.i[k]; vv += w.v[k] * w.v[k]; }
      return { p: p / w.v.length, vrms: Math.sqrt(vv / w.v.length) };
    }
    function stats(a) {
      if (!a || !a.length) return null;
      let mn = Infinity, mx = -Infinity, s = 0;
      for (const v of a) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; }
      const mean = s / a.length;
      let q = 0; for (const v of a) q += (v - mean) * (v - mean);
      return { min: mn, max: mx, pp: mx - mn, mean, rmsAC: Math.sqrt(q / a.length) };
    }
    // Harmonic amplitudes by DFT over the (whole-period) capture
    function harmonics(a, f0, dt, count) {
      const N = a.length - 1, out = [];
      for (let k = 1; k <= count; k++) {
        let re = 0, im = 0;
        for (let i = 0; i < N; i++) { const ph = 2 * Math.PI * k * f0 * i * dt; re += a[i] * Math.cos(ph); im += a[i] * Math.sin(ph); }
        out.push(2 * Math.hypot(re, im) / N);
      }
      return out;
    }
    function signalFreq() {
      const g = S.comps.find(c => c.type === "siggen");
      return g ? g.params.freq : (S.sim.result && S.sim.result.tran ? S.sim.result.tran.fBase : 0);
    }

    // the load line for the curve tracer: the last whole cycle of the signal. The capture holds
    // many cycles (a whole number of mains periods), and with a rectified supply the ripple moves
    // each one a little; drawn together they smear into a band
    function oneCycle(t) {
      const f = signalFreq(), n = t.vak.length, per = f && t.dt ? Math.round(1 / (f * t.dt)) : 0;
      const cut = a => (a && per > 4 && per < n ? a.subarray(n - per - 1) : a);
      return { vak: decimate(cut(t.vak), 600), vgk: decimate(cut(t.vgk), 600), vg2k: decimate(cut(t.vg2k), 600), ia: decimate(cut(t.ia), 600) };
    }
    // Tube operating data (DC + trajectory) for inspector and the curve tracer
    function tubeData(c) {
      const r = S.sim.result;
      if (!r) return null;
      const t = tubeByName(c.params.tube), kind = tubeKind(t);
      const dev = r.dc.devices[c.id];
      if (!dev) return null;
      if (kind === "rectifier") return { kind, a1: dev.a1, a2: dev.a2 };
      const conn = c.params.connection === "pentode" && t.koren.Pentode ? "pentode" : "triode";
      const d = { kind: conn, tube: t.commonName, label: c.label, id: c.id, dc: dev.main, paMax: t.paMax, vaMax: t.vaMax, model: conn === "pentode" ? t.koren.Pentode : t.koren.Triode || t.koren.Pentode };
      if (r.tran) {
        const A = waveOf(c, "A"), K = waveOf(c, "K"), G = waveOf(c, conn === "pentode" ? "G1" : "G"), G2 = conn === "pentode" ? waveOf(c, "G2") : null;
        const I = r.tran.devices[c.id] ? r.tran.devices[c.id].i : null;
        if (A && K && G && I) {
          const n = A.length, vak = new Float32Array(n), vgk = new Float32Array(n), vg2k = G2 ? new Float32Array(n) : null;
          let pSum = 0;
          for (let i = 0; i < n; i++) { vak[i] = A[i] - K[i]; vgk[i] = G[i] - K[i]; if (vg2k) vg2k[i] = G2[i] - K[i]; pSum += vak[i] * I[i]; }
          const sa = stats(vak), sg = stats(vgk);
          const f = signalFreq();
          let thd = null;
          if (f && sa.pp > 1e-3) { const h = harmonics(vak, f, r.tran.dt, 8); thd = 100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-12); }
          d.traj = { vak, vgk, vg2k, ia: I, dt: r.tran.dt };
          d.metrics = { vakPP: sa.pp, vgkPP: sg.pp, gain: sg.pp > 1e-6 ? sa.pp / sg.pp : null, pAvg: pSum / n, thd };
        }
      }
      return d;
    }

    // A tube's ratings beyond Va and Pa (tube-db.js t.limits): screen voltage and dissipation,
    // cathode current, heater-to-cathode voltage, grid circuit resistance, a rectifier's peak
    // inverse voltage and rectified current. Each: { label, value (text), share of the rating, text
    // for the checks }. Averages over the signal cycle where there is one; Vhk and the peak inverse
    // voltage at their worst instant. The heater is at its DC potential (the tube's Heater DC
    // potential, 0 V: grounded or a grounded centre tap).
    function tubeLimits(c) {
      const r = S.sim.result, t = tubeByName(c.params.tube);
      if (!r || !t || !t.limits || !r.dc.devices[c.id]) return [];
      const L = t.limits, out = [], mean = a => { let s = 0; const n = Math.max(a.length - 1, 1); for (let i = 0; i < n; i++) s += a[i]; return s / n; };
      // say(value, rating): the sentence for the checks
      const add = (label, v, lim, unit, say) => {
        if (!(lim > 0) || v === null || !isFinite(v)) return;
        const f = x => fmtEng(x, unit);
        out.push({ key: label.split(" ")[0], label, value: f(v), lim: f(lim), share: v / lim, text: `${c.label} ${say(f(v), f(lim))}.` });
      };
      const kWave = waveOf(c, "K"), vk = netDC(pinNetOf(c, "K")), vh = +c.params.heaterV || 0;
      // heater to cathode: the worse of the two directions, each against its own rating
      const vhk = () => {
        if (t.directlyHeated || vk === null) return;
        const s = kWave ? stats(kWave) : { min: vk, max: vk }, up = s.max - vh, down = vh - s.min;
        const neg = L.vhkNeg || L.vhk, pos = L.vhk;
        const a = up > 0 && neg ? up / neg : 0, b = down > 0 && pos ? down / pos : 0;
        if (a >= b && a > 0) add("Vhk (cathode above heater)", up, neg, "V", (v, m) => `has its cathode ${v} above the heater, more than the ${m} allowed`);
        else if (b > 0) add("Vhk (heater above cathode)", down, pos, "V", (v, m) => `has its heater ${v} above the cathode, more than the ${m} allowed`);
      };
      if (tubeKind(t) === "rectifier") {
        const dev = r.dc.devices[c.id], tr = r.tran && r.tran.devices;
        const ia = (x, part) => (tr && tr[c.id + "#" + part] ? mean(tr[c.id + "#" + part].i) : x ? x.i : 0);
        add("Rectified current", ia(dev.a1, "a1") + ia(dev.a2, "a2"), t.ikMax / 1000, "A", (v, m) => `delivers ${v} on average, more than its ${m} rating`);
        // each anode's peak, while the reservoir capacitor charges, against the book's peak anode current (settled cycles, not the switch-on surge)
        const ipk = t.book && t.book.limits && t.book.limits.i_peak_ma;
        if (tr && ipk) {
          const pk = Math.max(...["a1", "a2"].map(p => { const w = tr[c.id + "#" + p]; let m = 0; if (w) for (const x of w.i) m = Math.max(m, x); return m; }));
          add("Peak anode current", pk, ipk / 1000, "A", (v, m) => `pulls ${v} peak through an anode while the reservoir capacitor charges, more than its ${m} rating`);
        }
        if (kWave) {
          let piv = 0;
          ["A1", "A2"].forEach(p => { const w = pinNetOf(c, p) !== undefined && waveOf(c, p); if (w) for (let i = 0; i < w.length; i++) piv = Math.max(piv, kWave[i] - w[i]); });
          add("Peak inverse voltage", piv, L.piv, "V", (v, m) => `sees ${v} peak inverse voltage, more than its ${m} rating`);
        }
        vhk();
        return out;
      }
      const d = tubeData(c); if (!d || !d.dc) return [];
      const tr = r.tran && r.tran.devices[c.id], dc = d.dc;
      if (d.kind === "pentode") {
        add("Vg2k (screen)", dc.vg2k, L.vg2, "V", (v, m) => `has its screen at ${v}, more than its ${m} rating`);
        const G2 = waveOf(c, "G2");
        let pg2 = dc.vg2k * dc.ig2;
        if (tr && tr.ig2 && G2 && kWave) { let s = 0; const n = Math.max(tr.ig2.length - 1, 1); for (let i = 0; i < n; i++) s += (G2[i] - kWave[i]) * tr.ig2[i]; pg2 = s / n; }
        add("Pg2 (screen dissipation)", pg2, L.pg2, "W", (v, m) => `screen dissipates ${v} (average), more than its ${m} Pg2 max`);
      }
      const ik = (tr ? mean(tr.i) + (tr.ig2 ? mean(tr.ig2) : 0) : dc.ia + (dc.ig2 || 0)) + (dc.ig || 0);
      add("Ik (cathode current)", ik, t.ikMax / 1000, "A", (v, m) => `draws ${v} cathode current, more than its ${m} rating`);
      vhk();
      const b = S.bias.tubes.get(c.id), fixed = b && (b.kind === "fixed" || b.fixed), rgLim = fixed ? L.rgFixed || L.rg : L.rg;
      if (b && isFinite(b.rg) && b.rg > 0) add(`Grid circuit R (${fixed ? "fixed" : "cathode"} bias)`, b.rg, rgLim, "Ω", (v, m) => `has ${v} in its grid circuit, more than the ${m} allowed with ${fixed ? "fixed" : "cathode"} bias (the tube can run away as it warms)`);
      return out;
    }
    return { acDigits, netAC, netDC, netWave, oneCycle, otDcCurrent, pinCurrent, pinCurrents, pinMap, pinNetOf, resistorPower, signalFreq, speakerPower, stats, tubeData, tubeLimits, waveOf, wireCurrents };
  };
})(window);
