/* The CAD's runs for the instrument windows, each in its own worker so the live simulation goes on:
   the power-on transient for the oscilloscopes (RUN_TRANSIENT) and the frequency response for
   the Bode plotter (RUN_AC). Results go out on the broadcast channel as TRANSIENT_RESULT and
   AC_RESULT. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadAnalysis = function (cad) {
    const { S, LIB, VERSION, buildNetlist, channel, desig, fmtEng, key, setStatus, showBusy, topo } = cad;
    let tWorker = null;
    S.trans = null;           // { seq, running, progress, tStop, ok, error, dt, scopes: [{ id, label, ch1: {min,max}, ch2 }] }
    function transientMessage() {
      const t = S.trans;
      return { type: "TRANSIENT_RESULT", version: VERSION, seq: t.seq, running: !!t.running, progress: t.progress || 0, tStop: t.tStop, ok: !!t.ok, error: t.error || null, stale: !!t.stale,
        dt: t.dt, elapsedMs: t.elapsedMs, scopes: t.scopes || [] };
    }
    function stopTransient() {
      if (tWorker) { tWorker.terminate(); tWorker = null; }
      if (S.trans && S.trans.running) { S.trans.running = false; S.trans.error = "Stopped"; if (channel) channel.postMessage(transientMessage()); setStatus("idle", "Power-on transient stopped"); }
    }
    function runTransient(tStop) {
      tStop = Math.min(5, Math.max(0.01, +tStop || 1));
      const T = topo();
      if (!T.hasGround) { S.trans = { running: false, ok: false, error: "Add a ground symbol to simulate", tStop }; if (channel) channel.postMessage(transientMessage()); return; }
      stopTransient();
      const netlist = buildNetlist(), probes = [], map = [];
      S.comps.filter(c => c.type === "scope").forEach(c => {
        const com = T.pinNet.get(c.id + ":COM");
        ["CH1", "CH2"].forEach(pid => {
          if (!T.pinConnected.get(c.id + ":" + pid)) return;
          map.push({ id: c.id, label: c.label, ch: pid.toLowerCase(), k: probes.length });
          probes.push([T.pinNet.get(c.id + ":" + pid), com]);
        });
      });
      const seq = (S.trans && S.trans.seq || 0) + 1;
      S.trans = { seq, running: true, progress: 0, tStop };
      if (channel) channel.postMessage(transientMessage());
      showBusy();
      try { tWorker = new Worker("sim-worker.js" + VERSION); } catch (e) { tWorker = null; }
      const done = result => {
        if (!S.trans || S.trans.seq !== seq) return;
        tWorker = null;
        const scopes = [];
        if (result.ok) map.forEach(p => {
          let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label });
          sc[p.ch] = { min: result.min[p.k], max: result.max[p.k] };
        });
        Object.assign(S.trans, { running: false, ok: !!result.ok, error: result.ok ? null : result.error, dt: result.dt, elapsedMs: result.elapsedMs, scopes, progress: 1 });
        if (channel) channel.postMessage(transientMessage());
        if (S.sim.busy && result.ok) showBusy();   // the steady state still runs: its progress stays on the line
        else if (result.ok) setStatus("ok", `Power-on transient: ${fmtEng(tStop, "s")} of circuit time in ${(result.elapsedMs / 1000).toFixed(1)} s · ${result.steps} steps`);
        else setStatus("error", "Power-on transient: " + result.error);
      };
      const options = { tStop, probes, maxPoints: 250000, budgetMs: 600000 };   // every step, for zooming in the scope
      if (!tWorker) { setTimeout(() => done(TubeSimEngine.startup(netlist, options)), 0); return; }
      tWorker.onmessage = e => {
        const d = e.data;
        if (d.progress !== undefined && !d.result) {
          if (!S.trans || S.trans.seq !== seq) return;
          S.trans.progress = d.progress;
          if (channel) channel.postMessage(transientMessage());
          showBusy();
        } else done(d.result);
      };
      tWorker.postMessage({ seq, netlist, options, kind: "startup" });
    }

    // ---------------------------------------------------------------------------
    // Frequency response for the Bode plotter window (own worker): the circuit with its signal
    // generators quiet, linearized at that operating point; the chosen generator drives it (1 V),
    // the others are shorts. Each scope channel's response against the scope's common.
    // ---------------------------------------------------------------------------
    let aWorker = null;
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
      if (aWorker) { aWorker.terminate(); aWorker = null; }
      S.ac.key = key;
      const seq = ++S.ac.seq;
      S.ac.job = { seq };
      if (channel) channel.postMessage(acMessage({ running: true, progress: 0, gen: g.id, gens }));
      const options = Object.assign({ inputs: [{ id: g.id, mag: 1 }], probes, budgetMs: 60000 }, AC_RANGE);
      const done = res => {
        if (S.ac.seq !== seq) return;
        aWorker = null; S.ac.job = null;
        const scopes = [];
        if (res.ok) map.forEach(p => {
          let sc = scopes.find(x => x.id === p.id); if (!sc) scopes.push(sc = { id: p.id, label: p.label, ch1: null, ch2: null });
          sc[p.ch] = { re: Array.from(res.probes[p.k].re), im: Array.from(res.probes[p.k].im) };
        });
        post({ ok: !!res.ok, error: res.ok ? null : res.error, gen: g.id, gens, freqs: res.ok ? Array.from(res.freqs) : [], scopes, averaged: !!res.averaged, elapsedMs: res.elapsedMs, running: false });
      };
      try { aWorker = new Worker("sim-worker.js" + VERSION); } catch (e) { aWorker = null; }
      if (!aWorker) { setTimeout(() => done(TubeSimEngine.acSweep(nl, options)), 0); return; }
      aWorker.onmessage = e => {
        const d = e.data;
        if (d.seq !== seq) return;
        if (d.result) done(d.result);
        else if (channel) channel.postMessage(acMessage({ running: true, progress: d.progress, gen: g.id, gens }));
      };
      aWorker.postMessage({ seq, netlist: nl, options, kind: "ac" });
    }
    return { acMessage, runAC, runTransient, stopTransient, transientMessage };
  };
})(window);
