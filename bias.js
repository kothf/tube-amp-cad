/* Bias finder: which resistor (or potentiometer) sets each tube's bias, and the value
   that gives the anode current wanted.

   detect(netlist, dc)            the bias part of every tube, from the circuit and its DC solution
   solve(netlist, targets, opts)  re-simulates with the signal off, changing the bias parts until
                                  each tube draws its target anode current
     targets: [{ tube, ia, measured }]: ia the anode current wanted (A); measured, optional, the
     anode current the real tube draws in the circuit as drawn. A measured tube first gets the
     emission (all its currents scaled, the engine's iScale) that makes the model draw what was
     measured, and the bias part is then found for that tube. (A shift along the grid axis would
     do as well, but a pentode model with its grid above zero jumps where the screen passes 0 V,
     which a cold start of a mains-fed circuit crosses.)

   Works on the engine's netlist ({ nodeCount, elements }); a part's elements carry its id
   (a pot's two halves are "id#a" and "id#b"). Needs TubeSimEngine for solve. */
(function (root) {
  "use strict";

  // a resistor on a grid's DC return (grid stopper, grid leak) carries only grid current: under
  // 1 µA, or (a grid drawing a little) under 50 µA with less than 5 V across it; the resistors of a
  // bias divider carry more, with tens of volts across them
  const leakCurrent = (i, v) => Math.abs(i) < 1e-6 || (Math.abs(i) < 50e-6 && Math.abs(v) < 5);
  const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];

  // the nearest E24 value (by ratio)
  function e24(r) {
    if (!(r > 0)) return r;
    const dec = Math.pow(10, Math.floor(Math.log10(r)));
    let best = r, bestErr = Infinity;
    for (const m of E24.concat([10])) { const v = m * dec, err = Math.abs(Math.log(v / r)); if (err < bestErr) { bestErr = err; best = v; } }
    return Number(best.toPrecision(3));
  }

  const isTube = e => e.kind === "TRIODE" || e.kind === "PENTODE";
  const gridOf = e => e.nodes[1];
  const cathodeOf = e => e.nodes[e.kind === "PENTODE" ? 3 : 2];
  // the part an element belongs to: a plain resistor, or both halves of a pot; internal resistors
  // of other parts (a generator's output resistance, a transformer's winding) cannot be changed
  function adjustable(netlist, e) {
    if (e.kind !== "R") return null;
    const id = String(e.id || "");
    if (id && id.indexOf("#") < 0) return { part: id, type: "resistor" };
    const m = /^(.*)#([ab])$/.exec(id);
    if (m && netlist.elements.some(x => x.id === m[1] + (m[2] === "a" ? "#b" : "#a"))) return { part: m[1], type: "pot" };
    return null;
  }

  // the two-terminal DC paths of the netlist, by node
  function dcGraph(netlist) {
    const adj = new Map(), add = (n, ed, other) => { if (!adj.has(n)) adj.set(n, []); adj.get(n).push({ ed, other }); };
    netlist.elements.forEach(e => {
      if (["R", "L", "V", "VSRC", "D", "VDIODE"].includes(e.kind)) { const ed = { e, a: e.nodes[0], b: e.nodes[1] }; add(ed.a, ed, ed.b); add(ed.b, ed, ed.a); }
      else if (e.kind === "XFMR") e.windings.forEach(w => { const ed = { e, a: w.a, b: w.b }; add(ed.a, ed, ed.b); add(ed.b, ed, ed.a); });
    });
    return adj;
  }

  // For every tube: { tube, kind: "cathode" | "fixed", part, type: "resistor" | "pot" }, or
  // { tube, kind: null, reason } when no single resistor sets its bias.
  //   The grid's DC return is followed through resistors that carry no current (grid stopper,
  //   grid leak) to where something feeds it. A grid returned to ground or to a positive node
  //   is cathode-biased: the bias resistor is the first part on the shortest DC path from the
  //   cathode back to the grid's return. A grid returned to a negative node is fixed-biased:
  //   the bias part is the pot that feeds that node, else its resistor to ground, else the
  //   resistor from the most negative node.
  function detect(netlist, dc) {
    const V = n => (n === 0 ? 0 : dc.nodes[n] || 0);
    const adj = dcGraph(netlist);
    const leak = ed => { if (ed.e.kind !== "R") return false; const v = V(ed.a) - V(ed.b); return leakCurrent(v / Math.max(ed.e.r, 1e-6), v); };
    const out = [];
    netlist.elements.forEach(t => {
      if (!isTube(t) || !t.id) return;
      const g = gridOf(t), k = cathodeOf(t);
      const region = new Set([g]), queue = [g];
      while (queue.length) {
        const n = queue.pop();
        if (n === 0) continue;
        (adj.get(n) || []).forEach(({ ed, other }) => { if (leak(ed) && !region.has(other)) { region.add(other); queue.push(other); } });
      }
      const feeds = [];
      region.forEach(n => { if (n !== 0) (adj.get(n) || []).forEach(({ ed, other }) => { if (!leak(ed)) feeds.push({ e: ed.e, other }); }); });
      const res = { tube: t.id };
      if (!region.has(0) && !feeds.length) { out.push(Object.assign(res, { kind: null, reason: "the grid has no DC path" })); return; }
      if (!region.has(0) && V(g) < -0.5) {
        const parts = feeds.map(f => Object.assign({ other: f.other }, adjustable(netlist, f.e))).filter(p => p.part);
        const pick = parts.find(p => p.type === "pot") || parts.find(p => p.other === 0) || parts.sort((a, b) => V(a.other) - V(b.other))[0];
        out.push(Object.assign(res, pick ? { kind: "fixed", part: pick.part, type: pick.type } : { kind: null, reason: "the negative bias supply has no resistor or pot to set it" }));
        return;
      }
      if (region.has(k)) { out.push(Object.assign(res, { kind: null, reason: Math.abs(V(g) - V(k)) < 0.05 ? "zero bias: grid and cathode return to the same point" : "the cathode is on the grid's DC return" })); return; }
      // shortest DC path from the cathode to the grid's return: its first element
      const first = new Map([[k, null]]), q = [k];
      let hit = null;
      for (let i = 0; i < q.length && hit === null; i++) {
        const n = q[i];
        for (const { ed, other } of adj.get(n) || []) {
          if (first.has(other)) continue;
          first.set(other, first.get(n) || ed.e);
          if (region.has(other)) { hit = other; break; }
          if (other !== 0) q.push(other);
        }
      }
      if (hit === null) { out.push(Object.assign(res, { kind: null, reason: "no DC path from the cathode to the grid's return" })); return; }
      const e = first.get(hit), p = adjustable(netlist, e);
      if (p) out.push(Object.assign(res, { kind: "cathode", part: p.part, type: p.type }));
      else out.push(Object.assign(res, { kind: null, reason: e.kind === "D" ? "the cathode is biased by a diode or LED" : "the cathode returns through a part that is not a resistor" }));
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Solving for the bias
  // ---------------------------------------------------------------------------
  const copyNetlist = nl => ({ nodeCount: nl.nodeCount, elements: nl.elements.map(e => Object.assign({}, e)) });
  const logit = f => Math.log(f / (1 - f)), sigmoid = u => 1 / (1 + Math.exp(-u));
  const POT_MIN = 0.002;   // pot travel used: end stops a hair inside the track

  // a knob turns one part: u = 0 is the part as drawn. A resistor scales as e^u, a pot moves
  // its wiper (the share of the track between pin 1 and the wiper) along logit(f)
  function knobFor(nl, part, type) {
    if (type === "resistor") {
      const r0 = nl.elements.find(e => e.id === part).r;
      return { part, type, r0, lo: Math.log(1 / r0), hi: Math.log(100e6 / r0), value: u => r0 * Math.exp(u),
        set: (n, u) => { n.elements.find(e => e.id === part).r = r0 * Math.exp(u); } };
    }
    const a = nl.elements.find(e => e.id === part + "#a"), b = nl.elements.find(e => e.id === part + "#b");
    const total = a.r + b.r, f0 = Math.min(1 - POT_MIN, Math.max(POT_MIN, a.r / total)), u0 = logit(f0);
    return { part, type, total, f0, lo: logit(POT_MIN) - u0, hi: logit(1 - POT_MIN) - u0, value: u => sigmoid(u0 + u),
      set: (n, u) => { const f = sigmoid(u0 + u); n.elements.find(e => e.id === part + "#a").r = Math.max(total * f, 0.1); n.elements.find(e => e.id === part + "#b").r = Math.max(total * (1 - f), 0.1); } };
  }

  // the circuit with each knob at u and each measured tube's emission
  function variant(base, knobs, u, emission) {
    const nl = copyNetlist(base);
    knobs.forEach((kn, i) => kn.set(nl, u[i]));
    emission.forEach((k, id) => { const t = nl.elements.find(e => e.id === id && isTube(e)); if (t) t.iScale = k; });
    return nl;
  }

  // Finds u for every unknown so that err(u)[i] = 0, all at once: each round is one simulation.
  // Per unknown a secant step (the first from a small probe), kept inside the bracket once the
  // error has changed sign, and at most maxStep at a time; unknowns barely affect each other.
  function rootAll(spec, u0, err, maxRounds, onRound) {
    const n = u0.length, u = u0.slice();
    let e = err(u);
    const best = u.slice(), bestE = e.slice(), prev = new Array(n).fill(null), lo = new Array(n).fill(null), hi = new Array(n).fill(null);
    const done = i => Math.abs(e[i]) <= spec[i].tol;
    for (let round = 0; round < maxRounds && !u.every((_, i) => done(i)); round++) {
      const next = u.map((ui, i) => {
        if (done(i)) return ui;
        const s = spec[i];
        if (e[i] < 0) lo[i] = ui; else hi[i] = ui;
        let un;
        const slope = prev[i] && prev[i].u !== ui ? (e[i] - prev[i].e) / (ui - prev[i].u) : null;
        if (slope && isFinite(slope)) un = ui - e[i] / slope;
        else un = ui + (s.slopeSign ? -Math.sign(e[i]) * s.slopeSign : 1) * s.probe;
        if (!isFinite(un)) un = ui + s.probe;
        un = Math.max(ui - s.maxStep, Math.min(ui + s.maxStep, un));
        // a bracket: the error is negative at lo[i] and positive at hi[i]; stay strictly inside it
        if (lo[i] !== null && hi[i] !== null) { const a = Math.min(lo[i], hi[i]), b = Math.max(lo[i], hi[i]); if (!(un > a && un < b)) un = (lo[i] + hi[i]) / 2; }
        return Math.max(s.lo, Math.min(s.hi, un));
      });
      // a simulation that fails (a far step can stop the transient converging) halves the step
      let ne = err(next);
      for (let k = 0; !ne && k < 3; k++) { next.forEach((v, i) => { next[i] = (v + u[i]) / 2; }); ne = err(next); }
      if (!ne) break;
      u.forEach((ui, i) => { prev[i] = { u: ui, e: e[i] }; });
      next.forEach((v, i) => { u[i] = v; });
      e = ne;
      e.forEach((v, i) => { if (Math.abs(v) < Math.abs(bestE[i])) { bestE[i] = v; best[i] = u[i]; } });
      if (onRound) onRound();
    }
    return { u: best, e: bestE, converged: bestE.every((v, i) => Math.abs(v) <= spec[i].tol) };
  }

  // opts: { quiet: [ids of signal sources to switch off], budgetMs (per simulation), maxRounds, onProgress(f) }
  // returns { ok, error, detected, parts: [...], emission: { tubeId: factor }, runs, elapsedMs }
  function solve(netlist, targets, opts) {
    opts = opts || {};
    const E = root.TubeSimEngine, t0 = Date.now(), maxRounds = opts.maxRounds || 10;
    const simOpts = { budgetMs: opts.budgetMs || 20000, maxPeriods: 20000 };
    const quiet = new Set(opts.quiet || []);
    const base = copyNetlist(netlist);
    base.elements.forEach(e => { if (e.kind === "VSRC" && quiet.has(e.id)) { e.amp = 0; e.offset = e.offset || 0; } });
    let runs = 0, planned = 2;
    // a run that fails throws for the circuit as drawn and the final check, and gives null in a search
    const sim = (nl, soft) => {
      const r = E.simulate(nl, simOpts);
      runs++;
      if (opts.onProgress) opts.onProgress(Math.min(0.99, runs / planned));
      if (!r.ok) { if (soft) return null; throw new Error(r.error); }
      return r;
    };
    const ia = (r, id) => { const d = r.dc.devices[id]; return d && d.main ? d.main.ia : NaN; };
    try {
      const r0 = sim(base);
      const detected = detect(base, r0.dc);
      const want = new Map(targets.filter(t => t.ia > 0).map(t => [t.tube, t]));
      // tubes sharing a bias part (a common cathode resistor, one bias pot for a pair) form a
      // group: the part is set for the group's average current
      const groups = new Map();
      detected.forEach(d => {
        if (!d.part || !want.has(d.tube)) return;
        if (!groups.has(d.part)) groups.set(d.part, { part: d.part, type: d.type, kind: d.kind, tubes: [] });
        groups.get(d.part).tubes.push(d.tube);
      });
      const list = [...groups.values()];
      const emission = new Map();
      // 1. measured tubes: the emission that makes the model draw the measured current
      const meas = targets.filter(t => t.measured > 0 && want.has(t.tube) && list.some(g => g.tubes.includes(t.tube)));
      planned = 2 + (meas.length ? maxRounds / 2 : 0) + (list.length ? maxRounds / 2 : 0);
      if (meas.length) {
        // u = ln(emission), between a fifth and five times the model's
        const spec = meas.map(t => ({ tol: 0.002 * t.measured + 1e-6, probe: 0.05, slopeSign: 1, maxStep: 0.7, lo: Math.log(0.2), hi: Math.log(5) }));
        const fit = rootAll(spec, meas.map(() => 0), u => {
          meas.forEach((t, i) => emission.set(t.tube, Math.exp(u[i])));
          const r = sim(variant(base, [], [], emission), true);
          return r && meas.map(t => ia(r, t.tube) - t.measured);
        }, maxRounds);
        meas.forEach((t, i) => emission.set(t.tube, Math.exp(fit.u[i])));
      }
      // 2. each group's part, for its average target current
      const knobs = list.map(g => knobFor(base, g.part, g.type));
      const goal = g => g.tubes.reduce((s, id) => s + want.get(id).ia, 0) / g.tubes.length;
      const mean = (r, g) => g.tubes.reduce((s, id) => s + ia(r, id), 0) / g.tubes.length;
      const spec = list.map((g, i) => ({ tol: 0.002 * goal(g) + 1e-6, slopeSign: knobs[i].type === "resistor" && g.kind === "cathode" ? -1 : 0, probe: knobs[i].type === "pot" ? 0.3 : 0.15, maxStep: knobs[i].type === "pot" ? 2 : 1, lo: knobs[i].lo, hi: knobs[i].hi }));
      const fit = list.length ? rootAll(spec, list.map(() => 0), u => {
        const r = sim(variant(base, knobs, u, emission), true);
        return r && list.map(g => mean(r, g) - goal(g));
      }, maxRounds) : { u: [], e: [], converged: true };
      // 3. the resistors rounded to E24, simulated once more for what they give
      const rounded = knobs.map((kn, i) => (kn.type === "resistor" ? Math.log(e24(kn.value(fit.u[i])) / kn.r0) : fit.u[i]));
      planned = runs + 1;
      const rv = list.length ? sim(variant(base, knobs, rounded, emission)) : null;
      const V = (r, n) => (n === 0 ? 0 : r.dc.nodes[n] || 0);
      const parts = list.map((g, i) => {
        const kn = knobs[i], p = { part: g.part, type: g.type, kind: g.kind, tubes: g.tubes, target: goal(g),
          now: g.tubes.map(id => ia(r0, id)), reached: Math.abs(fit.e[i]) <= spec[i].tol };
        if (kn.type === "resistor") {
          p.value = kn.value(fit.u[i]); p.e24 = e24(p.value); p.from = kn.r0;
          const el = rv.dc && base.elements.find(e => e.id === g.part);
          if (el) { const v = V(rv, el.nodes[0]) - V(rv, el.nodes[1]); p.power = v * v / p.e24; }
        } else { p.fraction = kn.value(fit.u[i]); p.from = kn.f0; }
        p.ia = g.tubes.map(id => ia(rv, id));
        if (!p.reached) p.note = (fit.u[i] <= kn.lo + 1e-6 || fit.u[i] >= kn.hi - 1e-6) ? (kn.type === "pot" ? "the pot's travel does not reach the target: change the divider" : "the target is out of reach for this resistor") : "did not converge";
        return p;
      });
      if (opts.onProgress) opts.onProgress(1);
      return { ok: true, detected, parts, emission: Object.fromEntries(emission), runs, elapsedMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err), runs, elapsedMs: Date.now() - t0 };
    }
  }

  root.TubeBias = { detect, solve, e24 };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
