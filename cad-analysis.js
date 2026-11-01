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
    S.trans = null;           // { seq, running, progress, tStop, warmup, ok, error, dt, scopes: [{ id, label, ch1: {min,max,nets}, ch2 }], caps, tubes, notes }
    function transientMessage() {
      const t = S.trans;
      return { type: "TRANSIENT_RESULT", version: VERSION, seq: t.seq, running: !!t.running, progress: t.progress || 0, tStop: t.tStop, warmup: !!t.warmup, ok: !!t.ok, error: t.error || null, stale: !!t.stale,
        dt: t.dt, elapsedMs: t.elapsedMs, scopes: t.scopes || [], caps: t.caps || [], tubes: t.tubes || [], notes: t.notes || [] };
    }
    function stopTransient() {
      if (tJob) { tJob.cancel(); tJob = null; }
      if (S.trans && S.trans.running) { S.trans.running = false; S.trans.error = "Stopped"; if (channel) channel.postMessage(transientMessage()); setStatus("idle", "Power-on transient stopped"); }
    }
    // the power-on run's length for "auto": with the cathodes warming, three time constants of the
    // slowest (to the next 5 s, 5 to 60 s); with hot cathodes or no tubes, 1 s
    function autoDuration(netlist, warmup) {
      const tau = warmup ? Math.max(0, ...netlist.elements.map(e => (e.heat && e.heat.tau) || 0)) : 0;
      return tau > 0 ? Math.min(60, Math.max(5, Math.ceil(3 * tau / 5) * 5)) : 1;
    }
    // a capacitor's voltage rating: its own, or the one the BOM picks from the steady state's peak
    function capRating(c) {
      if (+c.params.v > 0) return { v: +c.params.v, set: true };
      const st = S.sim.stress && S.sim.stress.get(c.id), txt = st && root.BomLib ? root.BomLib.capRating(c.type, st.v) : "";
      const m = /^(\d+) × ([\d.]+) V/.exec(txt) || [], v = m[1] ? +m[1] * +m[2] : parseFloat(txt);
      return v > 0 ? { v, set: false, steady: st.v } : null;
    }
    function runTransient(tStop, warmup) {
      warmup = warmup !== false;
      const T = topo();
      if (!T.hasGround) { S.trans = { running: false, ok: false, error: "Add a ground symbol to simulate", tStop: +tStop || 1, warmup }; if (channel) channel.postMessage(transientMessage()); return; }
      stopTransient();
      const netlist = buildNetlist(), probes = [], map = [];
      tStop = tStop === "auto" ? autoDuration(netlist, warmup) : Math.min(120, Math.max(0.01, +tStop || 1));
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
        return na === undefined || nb === undefined || na === nb ? null : { c, nets: [na, nb] };
      }).filter(Boolean);
      const seq = (S.trans && S.trans.seq || 0) + 1;
      S.trans = { seq, running: true, progress: 0, tStop, warmup };
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
        const rep = result.ok ? transientReport(result, caps, warmup) : { caps: [], tubes: [], notes: [] };
        Object.assign(S.trans, { running: false, ok: !!result.ok, error: result.ok ? null : result.error, dt: result.dt, elapsedMs: result.elapsedMs, scopes, progress: 1 }, rep);
        if (channel) channel.postMessage(transientMessage());
        const bad = rep.notes.filter(n => n.level !== "ok").length;
        if (S.sim.busy && result.ok) showBusy();   // the steady state still runs: its progress stays on the line
        else if (result.ok) setStatus(bad ? "warn" : "ok", `Power-on transient: ${fmtEng(tStop, "s")} of circuit time in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps${bad ? ` · ${bad} warning${bad > 1 ? "s" : ""} (see the oscilloscope)` : ""}`);
        else setStatus("error", "Power-on transient: " + result.error);
      };
      const options = { tStop, probes, warmup, watch: caps.map(x => x.nets), maxPoints: 250000, budgetMs: 600000 };   // every step, for zooming in the scope
      if (!pool.ok) { setTimeout(() => done(TubeSimEngine.startup(netlist, options)), 0); return; }
      tJob = pool.run({ netlist, options, kind: "startup" }, {
        urgent: true, onResult: done,
        onProgress: f => {
          if (!S.trans || S.trans.seq !== seq) return;
          S.trans.progress = f;
          if (channel) channel.postMessage(transientMessage());
          showBusy();
        }
      });
    }
    // What the power-on run found: each capacitor's peak against its rating (a B+ that overshoots
    // while the tubes are still cold and draw nothing), and each tube's current while its cathode
    // was cold (a rectifier charging empty capacitors from a half-warm cathode) or its surge.
    //   caps: [{ id, label, peak, at, rating, set, steady, nets, level }]; tubes: [{ id, label, tube, tau, peak, peakAt, endPeak, worst, ratedPeak, level }]
    //   notes: [{ level: "bad" | "warn" | "ok", text }]
    function transientReport(result, caps, warmup) {
      const notes = [], out = { caps: [], tubes: [], notes };
      const CL = root.CadLib, ms = t => fmtEng(t, "s");
      caps.forEach((x, k) => {
        const w = result.watch && result.watch[k]; if (!w) return;
        const peak = Math.max(w.max, -w.min), at = w.max >= -w.min ? w.maxAt : w.minAt, r = capRating(x.c);
        const level = !r ? "" : peak > r.v ? "bad" : peak > 0.9 * r.v ? "warn" : "ok";
        out.caps.push({ id: x.c.id, label: desig(x.c), peak, at, rating: r ? r.v : 0, set: r ? r.set : false, steady: r ? r.steady || null : null, nets: x.nets, level });
        if (level === "bad" || level === "warn")
          notes.push({ level, text: `${desig(x.c)}: ${fmtEng(peak, "V")} at ${ms(at)} after power-on, ${level === "bad" ? "over" : "over 90 % of"} its ${fmtEng(r.v, "V")} rating${r.set ? "" : ` (the one the BOM picks from its settled ${fmtEng(r.steady, "V")}; set a higher one in the inspector)`}: the tubes draw little until their cathodes are warm` });
      });
      // tubes: one line per part (a rectifier's two anodes together)
      const byId = new Map();
      (result.tubes || []).forEach(e => { const g = byId.get(e.id) || { peak: 0, peakAt: 0, endPeak: 0, worst: null, tau: e.tau, kind: e.kind }; if (e.peak > g.peak) { g.peak = e.peak; g.peakAt = e.peakAt; } g.endPeak = Math.max(g.endPeak, e.endPeak || 0); if (e.worst && (!g.worst || e.worst.i > g.worst.i)) g.worst = e.worst; byId.set(e.id, g); });
      byId.forEach((g, id) => {
        const c = S.comps.find(x => x.id === id); if (!c || c.type !== "tube") return;
        const t = CL.tubeByName(c.params.tube), wu = CL.tubeWarmup(t, c); if (!t || !wu) return;
        const rect = g.kind === "VDIODE", lim = rect ? wu.peak : wu.rated, name = `${desig(c)} (${t.commonName})`;
        const limText = rect ? `its ${fmtEng(lim, "A")} peak rating per anode${wu.peakFromBook ? "" : " (about 3 × its rated current: no peak rating in the app's data)"}` : `its ${fmtEng(lim, "A")} rated cathode current`;
        const cold = g.worst, C = T => Math.round((T - 273) / 10) * 10, hot = C(TubeSimEngine.CATHODE.hot);
        let level = "ok";
        // overdrawn while cold: more than it passes once settled (the empty capacitors' charge on a
        // half-warm cathode), and near its rating
        if (cold && cold.i > 1.1 * g.endPeak && cold.i > (rect ? 0.7 : 1) * lim) {
          level = cold.i > lim ? "bad" : "warn";
          notes.push({ level, text: `${name}: ${fmtEng(cold.i, "A")} at ${ms(cold.t)} while its cathode was still cold (about ${C(cold.T)} °C of ${hot} °C), the circuit asking ${cold.ratio.toFixed(1)}× more than it could emit; ${fmtEng(g.endPeak, "A")} once settled, against ${limText}. A cold, overdrawn cathode loses its coating (cathode stripping)${rect ? ": a smaller first capacitor or more resistance before it (or a slower-warming rectifier) eases it" : ""}.` });
        }
        if (rect && g.peak > lim && g.peak > 1.2 * g.endPeak && (!cold || g.peak > cold.i * 1.05)) {
          level = "bad";
          notes.push({ level, text: `${name}: a ${fmtEng(g.peak, "A")} surge at ${ms(g.peakAt)}, over ${limText}${warmup ? "" : ": with hot cathodes (a standby switch closed onto empty capacitors)"}. More resistance per anode or a smaller first capacitor limits it.` });
        }
        out.tubes.push({ id, label: desig(c), tube: t.commonName, tau: g.tau, peak: g.peak, peakAt: g.peakAt, endPeak: g.endPeak, worst: cold, ratedPeak: rect ? lim : 0, rect, level });
      });
      if (!notes.length) notes.push({ level: "ok", text: warmup && byId.size ? "No capacitor over its rating, no tube overdrawn while cold." : "No capacitor over its rating." });
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
