/* The CAD's runs for the instrument windows, on workers of the engine's pool (sim-pool.js) beside
   the live simulation: the power-on transient for the oscilloscopes (RUN_TRANSIENT) and the
   frequency response for the Bode plotter (RUN_AC), whose sweep is cut into pieces that run on
   all the cores at once, and the loop gain of a feedback loop for its Loop gain mode (RUN_LOOP).
   Results go out on the broadcast channel as TRANSIENT_RESULT, AC_RESULT and LOOP_RESULT. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadAnalysis = function (cad) {
    const { S, VERSION, buildNetlist, pool, channel, desig, fmtEng, netAC, setStatus, showBusy, topo } = cad;
    let tJob = null;
    S.trans = null;           // { seq, running, progress, tStop, warmup, ok, error, dt, scopes: [{ id, label, ch1: {min,max,nets}, ch2 }], caps, tubes, events }
    function transientMessage() {
      const t = S.trans;
      return { type: "TRANSIENT_RESULT", version: VERSION, seq: t.seq, running: !!t.running, progress: t.progress || 0, tStop: t.tStop, warmup: !!t.warmup, ok: !!t.ok, error: t.error || null, stale: !!t.stale,
        dt: t.dt, watchDt: t.watchDt || 0, cathode: root.TubeSimEngine ? TubeSimEngine.CATHODE : null, elapsedMs: t.running && t.t0 ? Date.now() - t.t0 : t.elapsedMs,
        scenario: t.scenario || { kind: t.warmup ? "cold" : "hot" }, stopped: !!t.stopped, tReached: t.tReached || 0, preview: t.running ? t.preview || null : null, rate: S.transRate || null,
        scopes: t.scopes || [], caps: t.caps || [], tubes: t.tubes || [], events: t.events || [] };
    }
    // Stop: a run that has sent part of its record ends there, as a shorter run (its report too);
    // one that has not, ends with nothing
    function stopTransient(keep) {
      if (keep !== false && S.trans && S.trans.running && S.trans.finish && S.trans.finish()) return;
      if (tJob) { tJob.cancel(); tJob = null; }
      if (S.trans && S.trans.running) { S.trans.running = false; S.trans.error = "Stopped"; if (channel) channel.postMessage(transientMessage()); setStatus("idle", "Power-on transient stopped"); }
    }
    // the power-on run's length for "auto": with the cathodes warming, three time constants of the
    // slowest (to the next 5 s, 5 to 60 s), less the time they have already warmed (a standby
    // switch); with hot cathodes or no tubes, 1 s; a soft start at least 1 s past its relay
    function autoDuration(netlist, warmup, scen) {
      const tau = warmup ? Math.max(0, ...netlist.elements.map(e => (e.heat && e.heat.tau) || 0)) : 0, left = 3 * tau - (scen && scen.kind === "standby" ? scen.standby : 0);
      const d = left > 1 ? Math.min(60, Math.max(5, Math.ceil(left / 5) * 5)) : 1;
      return scen && scen.kind === "soft" ? Math.max(d, Math.min(60, Math.ceil(scen.relay + 1))) : d;
    }
    // the scenario as the oscilloscope sends it, its numbers in range
    function scenarioOf(sc, warmup) {
      const k = sc && /^(cold|hot|standby|soft)$/.test(sc.kind) ? sc.kind : warmup === false ? "hot" : "cold";
      const num = (v, d, lo, hi) => { v = +v; return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
      return { kind: k, standby: num(sc && sc.standby, 30, 1, 600), softR: num(sc && sc.softR, 47, 0.1, 10000), relay: num(sc && sc.relay, 2, 0.05, 30) };
    }
    // a capacitor's voltage rating: its own, or the one the BOM picks from the steady state's peak
    function capRating(c) {
      if (+c.params.v > 0) return { v: +c.params.v, set: true };
      const st = S.sim.stress && S.sim.stress.get(c.id), txt = st && root.BomLib ? root.BomLib.capRating(c.type, st.v) : "";
      const m = /^(\d+) × ([\d.]+) V/.exec(txt) || [], v = m[1] ? +m[1] * +m[2] : parseFloat(txt);
      return v > 0 ? { v, set: false, steady: st.v } : null;
    }
    function runTransient(tStop, warmup, scenario) {
      const scen = scenarioOf(scenario, warmup);
      warmup = scen.kind !== "hot";
      const T = topo();
      if (!T.hasGround) { S.trans = { running: false, ok: false, error: "Add a ground symbol to simulate", tStop: +tStop || 1, warmup }; if (channel) channel.postMessage(transientMessage()); return; }
      stopTransient(false);
      const netlist = buildNetlist(), probes = [], map = [];
      tStop = tStop === "auto" ? autoDuration(netlist, warmup, scen) : Math.min(120, Math.max(0.01, +tStop || 1));
      S.comps.filter(c => c.type === "scope").forEach(c => {
        const com = T.pinNet.get(c.id + ":COM");
        ["CH1", "CH2"].forEach(pid => {
          if (!T.pinConnected.get(c.id + ":" + pid)) return;
          const nets = [T.pinNet.get(c.id + ":" + pid), com];
          map.push({ id: c.id, label: c.label, ch: pid.toLowerCase(), k: probes.length, nets });
          probes.push(nets);
        });
      });
      // every capacitor's voltage, for its peak against its rating
      const caps = S.comps.filter(c => c.type === "capacitor" || c.type === "electrolytic").map(c => {
        const [a, b] = c.type === "capacitor" ? ["1", "2"] : ["+", "-"], na = T.pinNet.get(c.id + ":" + a), nb = T.pinNet.get(c.id + ":" + b);
        return na === undefined || nb === undefined || na === nb ? null : { c, nets: [na, nb], ground: na === 0 || nb === 0 };
      }).filter(Boolean);
      const seq = (S.trans && S.trans.seq || 0) + 1;
      S.trans = { seq, running: true, progress: 0, tStop, warmup, scenario: scen, t0: Date.now() };
      if (channel) channel.postMessage(transientMessage());
      showBusy();
      const done = result => {
        if (!S.trans || S.trans.seq !== seq) return;
        tJob = null;
        const scopes = [];
        if (result.ok) map.forEach(p => {
          let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label });
          sc[p.ch] = { min: result.min[p.k], max: result.max[p.k], nets: p.nets };
        });
        const rep = result.ok ? transientReport(result, caps, warmup, scen) : { caps: [], tubes: [], events: [] };
        Object.assign(S.trans, { running: false, ok: !!result.ok, error: result.ok ? null : result.error, dt: result.dt, watchDt: result.watchDt || 0, elapsedMs: result.elapsedMs, scopes, progress: 1,
          tStop: result.ok ? result.tStop : S.trans.tStop, stopped: !!result.stopped, finish: null, preview: null }, rep);
        // the speed of this run, for the next one's estimate on the oscilloscope's Run button
        if (result.ok && result.tStop > 0 && !result.stopped) S.transRate = { msPerS: result.elapsedMs / result.tStop, parts: netlist.elements.length, tStop: result.tStop, scenario: scen.kind };
        if (channel) channel.postMessage(transientMessage());
        const bad = rep.events.filter(n => n.level !== "info").length;
        if (S.sim.busy && result.ok) showBusy();   // the steady state still runs: its progress stays on the line
        else if (result.ok) setStatus(bad ? "warn" : "ok", `Power-on transient${result.stopped ? " (stopped)" : ""}: ${fmtEng(result.tStop, "s")} of circuit time in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps${bad ? ` · ${bad} warning${bad > 1 ? "s" : ""} (see the oscilloscope)` : ""}`);
        else setStatus("error", "Power-on transient: " + result.error);
      };
      const options = { tStop, probes, warmup, watch: caps.map(x => x.nets), watchPoints: 20000, maxPoints: 250000, budgetMs: 600000, partial: true,   // every step, for zooming in the scope
        warmOffset: scen.kind === "standby" ? scen.standby : 0, soft: scen.kind === "soft" ? { r: scen.softR, at: scen.relay } : null };
      // the record as it grows (the engine's snapshots): kept here whole, a light preview of each
      // scope channel (2000 points) sent on; Stop turns what there is into the result
      let acc = null;
      const partial = p => {
        if (!S.trans || S.trans.seq !== seq || !S.trans.running) return;
        if (!acc) acc = { min: probes.map(() => new Float32Array(p.points)), max: probes.map(() => new Float32Array(p.points)), lo: p.watch.map(() => new Float32Array(p.watchPoints)), hi: p.watch.map(() => new Float32Array(p.watchPoints)), cold: p.tubes.map(() => new Float32Array(p.watchPoints)), to: 0, wto: 0, last: null };
        p.min.forEach((a, j) => { acc.min[j].set(a, p.from); acc.max[j].set(p.max[j], p.from); });
        p.watch.forEach((w, j) => { if (w.lo) { acc.lo[j].set(w.lo, p.wfrom); acc.hi[j].set(w.hi, p.wfrom); } });
        p.tubes.forEach((u, j) => { if (u.cold) acc.cold[j].set(u.cold, p.wfrom); });
        acc.to = p.to; acc.wto = p.wto; acc.last = p;
        const K = Math.max(1, Math.ceil(p.points / 2000)), nb = Math.floor(p.to / K), dec = (mn, mx) => { const a = new Float32Array(nb), b = new Float32Array(nb); for (let i = 0; i < nb; i++) { let l = Infinity, h = -Infinity; for (let j = i * K; j < (i + 1) * K; j++) { if (mn[j] < l) l = mn[j]; if (mx[j] > h) h = mx[j]; } a[i] = l; b[i] = h; } return { min: a, max: b }; };
        const scopes = [];
        map.forEach(q => { let sc = scopes.find(x => x.id === q.id); if (!sc) scopes.push(sc = { id: q.id, label: q.label }); sc[q.ch] = Object.assign(dec(acc.min[q.k], acc.max[q.k]), { nets: q.nets }); });
        S.trans.tReached = p.t; S.trans.preview = { dt: K * p.dt, upto: nb * K * p.dt, scopes };
        if (channel) channel.postMessage(transientMessage());
      };
      S.trans.finish = () => {
        if (!acc || !acc.to || !acc.last) return false;
        if (tJob) { tJob.cancel(); tJob = null; }
        const p = acc.last, tReached = acc.to * p.dt, nw = p.watchDt ? Math.min(acc.wto, Math.floor(tReached / p.watchDt)) : 0;
        done({ ok: true, stopped: true, tStop: tReached, h: p.h, steps: p.s, points: acc.to, dt: p.dt, probes, min: acc.min.map(a => a.slice(0, acc.to)), max: acc.max.map(a => a.slice(0, acc.to)),
          watch: p.watch.map((w, j) => ({ max: w.max, maxAt: w.maxAt, min: w.min, minAt: w.minAt, lo: w.lo ? acc.lo[j].slice(0, nw) : null, hi: w.hi ? acc.hi[j].slice(0, nw) : null })), watchDt: p.watchDt,
          tubes: p.tubes.map((u, j) => Object.assign({}, u, { cold: u.cold ? acc.cold[j].slice(0, nw) : null })), relayAt: p.relayAt, warmOffset: options.warmOffset, elapsedMs: Date.now() - S.trans.t0 });
        return true;
      };
      if (!pool.ok) { setTimeout(() => done(TubeSimEngine.startup(netlist, options)), 0); return; }
      tJob = pool.run({ netlist, options, kind: "startup" }, {
        urgent: true, onResult: done, onPartial: partial,
        onProgress: f => {
          if (!S.trans || S.trans.seq !== seq) return;
          S.trans.progress = f;
          if (channel) channel.postMessage(transientMessage());
          showBusy();
        }
      });
    }
    // What the power-on run found, as a list of events in time order for the oscilloscope's report
    // strip: each capacitor's peak against its rating (a B+ that overshoots while the tubes are still
    // cold and draw nothing), each tube's current while its cathode was cold (a rectifier charging
    // empty capacitors from a half-warm cathode) or its surge, and when B+ settled.
    //   caps: [{ id, label, peak, at, rating, set, steady, nets, level, bplus }]
    //   tubes: [{ id, label, tube, tau, peak, peakAt, endPeak, worst, ratedPeak, rect, level }]
    //   events: [{ t, level: "critical" | "warning" | "info", kind: "cap" | "near" | "cold" | "surge" | "settled", id, who, text, detail, nets }]
    //   Severity: a capacitor over 1.15 × its rating or a rectifier surge over its peak rating is
    //   critical; a capacitor between 1 and 1.15 × its rating or a tube overdrawn while cold, a
    //   warning; a capacitor within 10 % of its rating and B+ settling (±1 %), information.
    const SEV = { critical: 0, warning: 1, info: 2 };
    function transientReport(result, caps, warmup, scen) {
      const events = [], out = { caps: [], tubes: [], events };
      if (result.relayAt !== null && result.relayAt !== undefined && result.relayAt <= result.tStop)
        events.push({ t: result.relayAt, level: "info", kind: "relay", who: result.soft === "ntc" ? "NTC relay" : "Soft-start relay", text: `closes across the ${result.soft === "ntc" ? "inrush limiter" : `${fmtEng(scen.softR, "Ω")} soft-start resistor`}`,
          detail: `Soft start: the mains through ${result.soft === "ntc" ? "the circuit's NTC inrush limiter (at its cold resistance)" : `a ${fmtEng(scen.softR, "Ω")} resistor`} until a relay shorts it at ${fmtEng(result.relayAt, "s")}.` });
      else if (scen && scen.kind === "soft" && !result.soft)
        events.push({ t: 0, level: "info", kind: "relay", who: "Soft start", text: "no mains source or NTC to soften: ran as a cold start", detail: "Soft start puts a resistor in series with the Mains part, or uses the circuit's NTC inrush limiters; this circuit has neither." });
      const CL = root.CadLib, ms = t => fmtEng(t, "s");
      caps.forEach((x, k) => {
        const w = result.watch && result.watch[k]; if (!w) return;
        const peak = Math.max(w.max, -w.min), at = w.max >= -w.min ? w.maxAt : w.minAt, r = capRating(x.c), lbl = desig(x.c);
        const level = !r ? "" : peak > 1.15 * r.v ? "critical" : peak > r.v ? "warning" : peak > 0.9 * r.v ? "info" : "ok";
        out.caps.push({ id: x.c.id, label: lbl, peak, at, rating: r ? r.v : 0, set: r ? r.set : false, steady: r ? r.steady || null : null, nets: x.nets, level, k, ground: x.ground, electrolytic: x.c.type === "electrolytic", lo: w.lo || null, hi: w.hi || null });
        const why = r && !r.set ? ` The ${fmtEng(r.v, "V")} rating is the one the BOM picks from its settled ${fmtEng(r.steady, "V")}; set a higher one in the inspector.` : "";
        if (level === "critical" || level === "warning")
          events.push({ t: at, level, kind: "cap", id: x.c.id, who: lbl, nets: x.nets, text: `${fmtEng(peak, "V")} peak, over its ${fmtEng(r.v, "V")} rating (${Math.round(peak / r.v * 100)} %)`,
            detail: `${lbl}: ${fmtEng(peak, "V")} at ${ms(at)} after power-on, over its ${fmtEng(r.v, "V")} rating: the tubes draw little until their cathodes are warm.${why}` });
        else if (level === "info")
          events.push({ t: at, level, kind: "near", id: x.c.id, who: lbl, nets: x.nets, text: `${fmtEng(peak, "V")} peak, close to its ${fmtEng(r.v, "V")} rating (${Math.round(peak / r.v * 100)} %)`,
            detail: `${lbl}: ${fmtEng(peak, "V")} at ${ms(at)} after power-on, within 10 % of its ${fmtEng(r.v, "V")} rating.${why}` });
      });
      // B+: the electrolytic to ground with the highest settled voltage (the first reservoir
      // capacitor), and when it settled within ±1 % of its final level
      const dtW = result.watchDt || 0;
      const settle = w => {
        if (!w || !w.lo || !dtW) return null;
        const n = w.lo.length, kb = Math.max(1, Math.round(Math.max(0.02, (n * dtW) / 500) / dtW)), nb = Math.floor(n / kb); if (nb < 4) return null;
        const mean = new Float64Array(nb);
        for (let b = 0; b < nb; b++) { let a = 0; for (let j = b * kb; j < (b + 1) * kb; j++) a += (w.lo[j] + w.hi[j]) / 2; mean[b] = a / kb; }
        const tail = Math.max(1, Math.round(nb * 0.05)); let f = 0; for (let b = nb - tail; b < nb; b++) f += mean[b]; f /= tail;
        let last = -1; for (let b = 0; b < nb; b++) if (Math.abs(mean[b] - f) > 0.01 * Math.abs(f)) last = b;
        return { final: f, t: (last + 1) * kb * dtW, settled: last < nb - tail };
      };
      const finals = out.caps.map(c => { const w = result.watch[c.k]; return c.ground && w && w.lo ? settle(w) : null; });
      let bp = -1;
      out.caps.forEach((c, i) => { const q = finals[i]; if (!q || Math.abs(q.final) < 1) return; if (bp < 0 || (c.electrolytic && !out.caps[bp].electrolytic) || (c.electrolytic === out.caps[bp].electrolytic && Math.abs(q.final) > Math.abs(finals[bp].final))) bp = i; });
      if (bp >= 0) {
        const c = out.caps[bp], q = finals[bp]; c.bplus = true; c.final = q.final;
        events.push({ t: q.t, level: "info", kind: "settled", id: c.id, who: `B+ (${c.label})`, nets: c.nets,
          text: q.settled ? `settled at ${fmtEng(Math.abs(q.final), "V")} (within ±1 %)` : `still moving at the end of the run (${fmtEng(Math.abs(q.final), "V")}): run longer`,
          detail: `B+ on ${c.label}, the first reservoir capacitor: ${q.settled ? `within ±1 % of its final ${fmtEng(Math.abs(q.final), "V")} from ${ms(q.t)} on` : "not settled to ±1 % by the end of the run"}.` });
      }
      // tubes: one line per part (a rectifier's two anodes together)
      const byId = new Map();
      (result.tubes || []).forEach(e => {
        const g = byId.get(e.id) || { peak: 0, peakAt: 0, endPeak: 0, worst: null, tau: e.tau, kind: e.kind, cold: null };
        if (e.peak > g.peak) { g.peak = e.peak; g.peakAt = e.peakAt; } g.endPeak = Math.max(g.endPeak, e.endPeak || 0); if (e.worst && (!g.worst || e.worst.i > g.worst.i)) g.worst = e.worst;
        if (e.cold) { if (!g.cold) g.cold = Float32Array.from(e.cold); else e.cold.forEach((v, i) => { if (v > g.cold[i]) g.cold[i] = v; }); }
        byId.set(e.id, g);
      });
      // the spans of the record where a tube passed more than thr with its cathode cold and overdrawn
      const gap = Math.max(0.05, (result.tStop || 0) / 200);
      const spans = (cold, thr) => { const out = []; if (!cold || !dtW) return out; let a = -1; for (let i = 0; i <= cold.length; i++) { const on = i < cold.length && cold[i] > thr; if (on && a < 0) a = i; if (!on && a >= 0) { const last = out[out.length - 1], t0 = a * dtW; if (last && t0 - last[1] <= gap) last[1] = i * dtW; else out.push([t0, i * dtW]); a = -1; } } return out; };   // gaps of a few mains cycles joined
      byId.forEach((g, id) => {
        const c = S.comps.find(x => x.id === id); if (!c || c.type !== "tube") return;
        const t = CL.tubeByName(c.params.tube), wu = CL.tubeWarmup(t, c); if (!t || !wu) return;
        const rect = g.kind === "VDIODE", lim = rect ? wu.peak : wu.rated, name = `${desig(c)} (${t.commonName})`;
        const limText = rect ? `its ${fmtEng(lim, "A")} peak rating per anode${wu.peakFromBook ? "" : " (about 3 × its rated current: no peak rating in the app's data)"}` : `its ${fmtEng(lim, "A")} rated cathode current`;
        const cold = g.worst, C = T => Math.round((T - 273) / 10) * 10, hot = C(TubeSimEngine.CATHODE.hot);
        let level = "ok", coldSpans = [];
        // overdrawn while cold: more than it passes once settled (the empty capacitors' charge on a
        // half-warm cathode), and near its rating
        if (cold && cold.i > 1.1 * g.endPeak && cold.i > (rect ? 0.7 : 1) * lim) {
          level = "warning"; coldSpans = spans(g.cold, Math.max(1.1 * g.endPeak, (rect ? 0.7 : 1) * lim));
          events.push({ t: cold.t, level, kind: "cold", id, who: name, text: `${fmtEng(cold.i, "A")} with a cold cathode (about ${C(cold.T)} °C), ${cold.ratio.toFixed(1)}× more than it could emit`,
            detail: `${name}: ${fmtEng(cold.i, "A")} at ${ms(cold.t)} while its cathode was still cold (about ${C(cold.T)} °C of ${hot} °C), the circuit asking ${cold.ratio.toFixed(1)}× more than it could emit; ${fmtEng(g.endPeak, "A")} once settled, against ${limText}. A cold, overdrawn cathode loses its coating (cathode stripping)${rect ? ": a smaller first capacitor or more resistance before it (or a slower-warming rectifier) eases it" : ""}.` });
        }
        if (rect && g.peak > lim && g.peak > 1.2 * g.endPeak && (!cold || g.peak > cold.i * 1.05)) {
          level = "critical";
          events.push({ t: g.peakAt, level, kind: "surge", id, who: name, text: `${fmtEng(g.peak, "A")} surge, over its ${fmtEng(lim, "A")} peak rating`,
            detail: `${name}: a ${fmtEng(g.peak, "A")} surge at ${ms(g.peakAt)}, over ${limText}${warmup ? "" : ": with hot cathodes (a standby switch closed onto empty capacitors)"}. More resistance per anode or a smaller first capacitor limits it.` });
        }
        out.tubes.push({ id, label: desig(c), tube: t.commonName, tau: g.tau, peak: g.peak, peakAt: g.peakAt, endPeak: g.endPeak, worst: cold, ratedPeak: rect ? lim : 0, rect, level, coldSpans });
      });
      events.sort((a, b) => a.t - b.t || SEV[a.level] - SEV[b.level]);
      out.caps.forEach(c => { delete c.k; delete c.ground; delete c.electrolytic; });
      return out;
    }

    // ---------------------------------------------------------------------------
    // Frequency response for the Bode plotter window (workers of the pool): the circuit with its signal
    // generators quiet, linearized at that operating point; the chosen generator drives it (1 V),
    // the others are shorts. Each scope channel's response against the scope's common.
    // ---------------------------------------------------------------------------
    let aJobs = [];
    const stopAC = () => { aJobs.forEach(j => j.cancel()); aJobs = []; };
    S.ac = { seq: 0, key: null, job: null, msg: null };
    const AC_RANGE = { fStart: 1, fStop: 1e6, perDecade: 40 };
    function acMessage(extra) { return Object.assign({ type: "AC_RESULT", version: VERSION }, S.ac.msg || { ok: false, error: "Not run yet" }, extra || {}); }
    function runAC(gen) {
      const T = topo(), netlist = S.sim.netlist;
      const gens = S.comps.filter(c => c.type === "siggen").map(c => ({ id: c.id, label: desig(c) }));
      const post = m => { S.ac.msg = m; if (channel) try { channel.postMessage(acMessage()); } catch (e) {} };
      if (!netlist || !S.sim.result) { S.ac.key = null; post({ ok: false, error: S.sim.error || "Circuit not simulated", gens }); return; }
      if (!gens.length) { S.ac.key = null; post({ ok: false, error: "Add a signal generator: the response is measured from it", gens }); return; }
      const g = gens.find(x => x.id === gen) || gens[0];
      const probes = [], map = [];
      S.comps.filter(c => c.type === "scope").forEach(c => {
        const com = T.pinNet.get(c.id + ":COM") || 0;
        ["CH1", "CH2"].forEach(pid => {
          if (!T.pinConnected.get(c.id + ":" + pid)) return;
          map.push({ id: c.id, label: c.label, ch: pid.toLowerCase(), k: probes.length });
          probes.push([T.pinNet.get(c.id + ":" + pid), com]);
        });
      });
      const quiet = new Set(gens.map(x => x.id));
      const nl = { nodeCount: netlist.nodeCount, elements: netlist.elements.map(e => (quiet.has(e.id) ? Object.assign({}, e, { amp: 0 }) : e)) };
      const key = JSON.stringify([nl.elements, g.id, probes]);
      if (key === S.ac.key && (S.ac.job || (S.ac.msg && S.ac.msg.ok !== undefined))) { if (!S.ac.job && channel) channel.postMessage(acMessage()); return; }
      stopAC();
      S.ac.key = key;
      const seq = ++S.ac.seq;
      S.ac.job = { seq };
      if (channel) channel.postMessage(acMessage({ running: true, progress: 0, gen: g.id, gens }));
      const options = Object.assign({ inputs: [{ id: g.id, mag: 1 }], probes, budgetMs: 60000 }, AC_RANGE);
      const t0 = Date.now(), averaged = nl.elements.some(x => x.dcValue !== undefined || x.acMains);
      const done = res => {
        if (S.ac.seq !== seq) return;
        stopAC(); S.ac.job = null;
        const scopes = [];
        if (res.ok) map.forEach(p => {
          let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label, ch1: null, ch2: null });
          sc[p.ch] = { re: Array.from(res.probes[p.k].re), im: Array.from(res.probes[p.k].im) };
        });
        post({ ok: !!res.ok, error: res.ok ? null : res.error, gen: g.id, gens, freqs: res.ok ? Array.from(res.freqs) : [], scopes, averaged: res.ok && averaged, elapsedMs: Date.now() - t0, running: false });
      };
      const progress = f => { if (S.ac.seq === seq && channel) channel.postMessage(acMessage({ running: true, progress: f, gen: g.id, gens })); };
      if (!pool.ok) {
        setTimeout(() => {
          let op = null, opIm = null;
          if (averaged) { const r = TubeSimEngine.simulate(nl, options); if (!r.ok) { done({ ok: false, error: r.error }); return; } op = r.dc.nodes; opIm = TubeSimEngine.opMagnetising(r); }
          done(TubeSimEngine.acSweep(nl, Object.assign({}, options, { op, opIm })));
        }, 0);
        return;
      }
      // the sweep in pieces, one per core (at least 20 points each), all at once; then joined in order
      const sweep = (op, opIm) => {
        const K = TubeSimEngine.acPoints(options), parts = Math.max(1, Math.min(pool.size, Math.floor(K / 20)));
        const got = new Array(parts);
        let left = parts;
        for (let i = 0; i < parts; i++) {
          const kFrom = Math.round(i * K / parts), kTo = Math.round((i + 1) * K / parts);
          aJobs.push(pool.run({ netlist: nl, options: Object.assign({}, options, { op, opIm, kFrom, kTo }), kind: "ac" }, {
            urgent: i === 0, high: true,
            onResult: r => {
              if (S.ac.seq !== seq) return;
              if (!r.ok) { done(r); return; }
              got[i] = r;
              progress((averaged ? 0.9 : 0) + (averaged ? 0.1 : 1) * (parts - --left) / parts);
              if (left) return;
              const cat = arrs => { const out = new Float64Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; arrs.forEach(a => { out.set(a, o); o += a.length; }); return out; };
              done({ ok: true, freqs: cat(got.map(x => x.freqs)), probes: probes.map((_, k) => ({ re: cat(got.map(x => x.probes[k].re)), im: cat(got.map(x => x.probes[k].im)) })) });
            }
          }));
        }
      };
      // a mains-fed circuit is linearized at its averaged steady state, found first
      if (!averaged) { sweep(null); return; }
      aJobs.push(pool.run({ netlist: nl, options, kind: "op" }, {
        urgent: true, onProgress: f => progress(0.9 * f),
        onResult: r => { if (S.ac.seq !== seq) return; aJobs = []; if (r.ok) sweep(r.op, r.opIm); else done(r); }
      }));
    }

    // ---------------------------------------------------------------------------
    // Loop gain for the Bode plotter's Loop gain mode: the loop broken at one end of a resistor or
    // capacitor (engine loopGain), linearized as the frequency response is. The places offered are
    // every two-lead part off ground; the likely feedback parts first: one from the output (a speaker,
    // an output transformer's secondary) back into the amplifier, one from an anode to a grid, one
    // from an op-amp's output to its inverting input. The loop is broken at the end that carries
    // more signal in the last simulation (the driving side); reverse turns that round.
    // ---------------------------------------------------------------------------
    function loopPlaces() {
      const T = topo(), pins = new Map();
      T.pinNet.forEach((n, k) => { if (n > 0) { if (!pins.has(n)) pins.set(n, []); pins.get(n).push(k); } });
      const comp = new Map(S.comps.map(c => [c.id, c]));
      const role = n => {
        const out = new Set();
        (pins.get(n) || []).forEach(k => {
          const i = k.lastIndexOf(":"), c = comp.get(k.slice(0, i)), p = k.slice(i + 1); if (!c) return;
          if (c.type === "speaker" || (/^opt/.test(c.type) && /^S/.test(p))) out.add("out");
          else if (c.type === "tube" && /^(A|P)\d*$/.test(p)) out.add("anode");
          else if (c.type === "tube" && /^G1?$/.test(p)) out.add("grid");
          else if (c.type === "tube" && p === "K") out.add("cathode");
          else if (c.type === "opamp" && p === "OUT") out.add("oaout");
          else if (c.type === "opamp" && p === "-") out.add("oain");
        });
        return out;
      };
      const list = [];
      S.comps.filter(c => ["resistor", "capacitor", "electrolytic"].includes(c.type)).forEach(c => {
        const n1 = T.pinNet.get(c.id + ":1"), n2 = T.pinNet.get(c.id + ":2");
        if (!(n1 > 0) || !(n2 > 0) || n1 === n2) return;
        const r1 = role(n1), r2 = role(n2);
        const score = (a, b) => (a.has("out") && (b.has("cathode") || b.has("grid") || b.size === 0) ? 3 : a.has("anode") && b.has("grid") ? 2 : a.has("oaout") && b.has("oain") ? 2 : 0);
        const s12 = score(r1, r2), s21 = score(r2, r1);
        // the driving end: more signal in the last simulation, else the end the score names
        const a1 = netAC(n1), a2 = netAC(n2), v1 = a1 ? a1.rms : 0, v2 = a2 ? a2.rms : 0;
        const first = v1 !== v2 && (v1 > 0 || v2 > 0) ? v1 > v2 : s12 >= s21;
        const what = Math.max(s12, s21) === 3 ? "global feedback" : Math.max(s12, s21) === 2 ? "local feedback" : "";
        list.push({ id: c.id, label: desig(c) + (what ? ` (${what})` : ""), score: Math.max(s12, s21), nets: first ? [n1, n2] : [n2, n1] });
      });
      return list.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    let lJobs = [];
    const stopLoop = () => { lJobs.forEach(j => j.cancel()); lJobs = []; };
    S.loop = { seq: 0, key: null, msg: null };
    function loopMessage(extra) { return Object.assign({ type: "LOOP_RESULT", version: VERSION }, S.loop.msg || { ok: false, error: "Not run yet" }, extra || {}); }
    function runLoop(at, reverse) {
      const netlist = S.sim.netlist, places = loopPlaces().map(p => ({ id: p.id, label: p.label, score: p.score, nets: p.nets }));
      const post = m => { S.loop.msg = m; if (channel) try { channel.postMessage(loopMessage()); } catch (e) {} };
      if (!netlist || !S.sim.result) { S.loop.key = null; post({ ok: false, error: S.sim.error || "Circuit not simulated", places }); return; }
      if (!places.length) { S.loop.key = null; post({ ok: false, error: "No resistor or capacitor off ground to break a feedback loop at", places }); return; }
      const p = places.find(x => x.id === at) || places[0];
      const el = netlist.elements.find(e => e.id === p.id);
      const drive = reverse ? p.nets[1] : p.nets[0], pin = el ? el.nodes.indexOf(drive) : -1;
      if (pin < 0) { S.loop.key = null; post({ ok: false, error: "That part is not in the simulated circuit", places, at: p.id }); return; }
      const quiet = new Set(S.comps.filter(c => ["siggen", "pickup", "phono"].includes(c.type)).map(c => c.id));
      const nl = { nodeCount: netlist.nodeCount, elements: netlist.elements.map(e => (quiet.has(e.id) ? Object.assign({}, e, { amp: 0 }) : e)) };
      const key = JSON.stringify([nl.elements, p.id, pin]);
      if (key === S.loop.key && S.loop.msg && (S.loop.msg.running || S.loop.msg.ok !== undefined)) { if (channel) channel.postMessage(loopMessage({ places })); return; }
      stopLoop();
      S.loop.key = key;
      const seq = ++S.loop.seq, t0 = Date.now(), averaged = nl.elements.some(x => x.dcValue !== undefined || x.acMains);
      const base = { at: p.id, reverse: !!reverse, places, label: p.label };
      post(Object.assign({ running: true, progress: 0 }, base));
      const options = Object.assign({ at: { id: p.id, pin } }, AC_RANGE);
      const done = r => {
        if (S.loop.seq !== seq) return;
        stopLoop();
        post(Object.assign({ ok: !!r.ok, error: r.ok ? null : r.error, freqs: r.ok ? Array.from(r.freqs) : [], re: r.ok ? Array.from(r.re) : [], im: r.ok ? Array.from(r.im) : [],
          averaged: r.ok && averaged, elapsedMs: Date.now() - t0, running: false }, base));
      };
      if (!pool.ok) {
        setTimeout(() => {
          let op = null, opIm = null;
          if (averaged) { const r = TubeSimEngine.simulate(nl, {}); if (!r.ok) { done({ ok: false, error: r.error }); return; } op = r.dc.nodes; opIm = TubeSimEngine.opMagnetising(r); }
          done(TubeSimEngine.loopGain(nl, Object.assign({}, options, { op, opIm })));
        }, 0);
        return;
      }
      const sweep = (op, opIm) => lJobs.push(pool.run({ netlist: nl, options: Object.assign({}, options, { op, opIm }), kind: "loop" }, { urgent: true, high: true, onResult: done }));
      if (!averaged) { sweep(null); return; }
      lJobs.push(pool.run({ netlist: nl, options: {}, kind: "op" }, {
        urgent: true, onProgress: f => { if (S.loop.seq === seq && channel) channel.postMessage(loopMessage({ running: true, progress: 0.9 * f })); },
        onResult: r => { if (S.loop.seq !== seq) return; lJobs = []; if (r.ok) sweep(r.op, r.opIm); else done(r); }
      }));
    }
    return { acMessage, loopMessage, loopPlaces, runAC, runLoop, runTransient, stopTransient, transientMessage };
  };
})(window);
