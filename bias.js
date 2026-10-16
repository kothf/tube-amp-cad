/* Bias finder: which resistor (or potentiometer) sets each tube's bias, and the value
   that gives the anode current wanted.

   detect(netlist, dc)            the bias part of every tube, from the circuit and its DC solution
   solve(netlist, targets, opts)  re-simulates with the signal off, changing the bias parts until
                                  each tube draws its target anode current
     targets: [{ tube, ia | pa, measured }]: what the bias should give; measured, optional, what
     was read on the real amp with the parts as drawn. A measured tube first gets the grid shift
     (the engine's gridShift: its curves moved along the grid axis) that makes the model read the
     same, and the bias part is then found for that tube.

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

  // the circuit with each knob at u, each measured tube's grid shift, and (checking a pot against
  // weaker and stronger tubes) tubes' currents scaled
  function variant(base, knobs, u, shift, scale) {
    const nl = copyNetlist(base);
    knobs.forEach((kn, i) => kn.set(nl, u[i]));
    const tube = id => nl.elements.find(e => e.id === id && isTube(e));
    shift.forEach((v, id) => { const t = tube(id); if (t) t.gridShift = v; });
    if (scale) scale.forEach((k, id) => { const t = tube(id); if (t) t.iScale = k; });
    return nl;
  }

  // Finds u for every unknown so that err(u)[i] = 0, all at once; err runs one simulation and gives
  // null when it fails. The unknowns can pull on each other (two bias pots on one bias winding, two
  // output tubes on one B+), so it is Newton's method on all of them: the Jacobian by differences
  // (one simulation per unknown), Broyden updates after each step, and a step that does not lower
  // the error halved, then the Jacobian taken afresh. Each unknown stays in [lo, hi] and moves at
  // most maxStep at a time.
  function solveLin(A, b) {
    const n = b.length, M = A.map(r => r.slice()), x = b.slice();
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (!(Math.abs(M[p][c]) > 1e-300)) return null;
      [M[c], M[p]] = [M[p], M[c]]; [x[c], x[p]] = [x[p], x[c]];
      for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k < n; k++) M[r][k] -= f * M[c][k]; x[r] -= f * x[c]; }
    }
    for (let c = n - 1; c >= 0; c--) { let v = x[c]; for (let k = c + 1; k < n; k++) v -= M[c][k] * x[k]; x[c] = v / M[c][c]; }
    return x.every(isFinite) ? x : null;
  }
  function rootAll(spec, u0, err, maxRuns) {
    const n = u0.length, clamp = (v, i) => Math.max(spec[i].lo, Math.min(spec[i].hi, v));
    const size = e => Math.sqrt(e.reduce((s, v, i) => s + (v / spec[i].tol) ** 2, 0));
    let u = u0.slice(), e = err(u), runs = 1;
    if (!e) return { u, e: u.map(() => Infinity), converged: false };
    let best = { u: u.slice(), e: e.slice() };
    const keep = () => { if (size(e) < size(best.e)) best = { u: u.slice(), e: e.slice() }; };
    const done = () => e.every((v, i) => Math.abs(v) <= spec[i].tol);
    let J = null, fresh = false;
    const jacobian = () => {
      J = Array.from({ length: n }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) {
        let d = spec[j].probe; if (u[j] + d > spec[j].hi) d = -d;
        const up = u.slice(); up[j] = clamp(u[j] + d, j); d = up[j] - u[j];
        const ej = d ? err(up) : null; runs++;
        for (let i = 0; i < n; i++) J[i][j] = ej ? (ej[i] - e[i]) / d : (i === j ? (spec[j].slopeSign || 1) * 0.5 : 0);
      }
      fresh = true;
    };
    while (!done() && runs < maxRuns) {
      if (!J) jacobian();
      let du = solveLin(J, e.map(v => -v));
      if (!du) { J = null; if (fresh) break; continue; }
      // at most maxStep per unknown (the step scaled as a whole, keeping its direction)
      const sc = Math.min(1, ...du.map((v, i) => spec[i].maxStep / Math.max(Math.abs(v), 1e-300)));
      du = du.map(v => v * sc);
      let un = null, en = null;
      for (let k = 0; k < 4 && runs < maxRuns; k++) {
        un = u.map((v, i) => clamp(v + du[i], i));
        en = err(un); runs++;
        if (en && size(en) < size(e)) break;
        du = du.map(v => v / 2); en = null;
      }
      if (!en) { if (fresh) break; J = null; continue; }   // no better point along this direction: a fresh Jacobian, once
      // Broyden: the Jacobian corrected along the step taken
      const s = un.map((v, i) => v - u[i]), ss = s.reduce((a, v) => a + v * v, 0);
      if (ss > 0) { const y = en.map((v, i) => v - e[i]); for (let i = 0; i < n; i++) { let js = 0; for (let j = 0; j < n; j++) js += J[i][j] * s[j]; const f = (y[i] - js) / ss; for (let j = 0; j < n; j++) J[i][j] += f * s[j]; } }
      u = un; e = en; fresh = false; keep();
    }
    keep();
    return { u: best.u, e: best.e, converged: best.e.every((v, i) => Math.abs(v) <= spec[i].tol) };
  }

  // The fixed resistor in series with a bias pot, to move the target to mid-travel: on one of the
  // pot's ends (not its wiper), not a grid leak. null when the pot has none.
  function potDivider(netlist, dc, pot) {
    const a = netlist.elements.find(e => e.id === pot + "#a"), b = netlist.elements.find(e => e.id === pot + "#b");
    const ends = [a.nodes[0], b.nodes[1]].filter(n => n !== 0), V = n => (n === 0 ? 0 : dc.nodes[n] || 0);
    const cands = netlist.elements.filter(e => e.kind === "R" && e.id && e.id.indexOf("#") < 0 && e.nodes.some(n => ends.includes(n))
        && !leakCurrent((V(e.nodes[0]) - V(e.nodes[1])) / Math.max(e.r, 1e-6), V(e.nodes[0]) - V(e.nodes[1])))   // not a grid leak
      .map(e => ({ id: e.id, other: e.nodes[0] === ends.find(n => e.nodes.includes(n)) ? e.nodes[1] : e.nodes[0] }));
    // the leg to ground first (the one of this channel's divider; a resistor towards the supply may
    // be shared with other channels), else the one from the most negative node
    cands.sort((x, y) => (x.other === 0) - (y.other === 0) ? (y.other === 0) - (x.other === 0) : V(x.other) - V(y.other));
    return cands.length ? cands[0].id : null;
  }

  // targets: [{ tube, ia (A) | pa (W, anode dissipation Va·Ia), measured }], measured (optional) one of
  //   { kind: "ia", value: A }            the anode current
  //   { kind: "ik", value: A }            the cathode current (anode + screen + grid)
  //   { kind: "v", part: id, value: V }   the voltage across a resistor (a cathode sense resistor, Rk)
  //   a number: the anode current (as 3.54)
  // opts: { quiet: [ids of signal sources to switch off], budgetMs (per simulation), maxRounds, spread, onProgress(f) }
  // returns { ok, error, detected, parts: [...], shift: { tubeId: V }, runs, elapsedMs }
  function solve(netlist, targets, opts) {
    opts = opts || {};
    const E = root.TubeSimEngine, t0 = Date.now(), maxRounds = opts.maxRounds || 10, spread = opts.spread || 0.3;
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
    const V = (r, n) => (n === 0 ? 0 : r.dc.nodes[n] || 0);
    const dev = (r, id) => { const d = r.dc.devices[id]; return d && d.main ? d.main : null; };
    const ia = (r, id) => { const d = dev(r, id); return d ? d.ia : NaN; };
    const ik = (r, id) => { const d = dev(r, id); return d ? d.ia + (d.ig2 || 0) + (d.ig || 0) : NaN; };
    const pa = (r, id) => { const d = dev(r, id); return d ? d.vak * d.ia : NaN; };
    const across = (r, id) => { const e = base.elements.find(x => x.id === id); return e ? Math.abs(V(r, e.nodes[0]) - V(r, e.nodes[1])) : NaN; };
    // what a target or a measurement compares, in the simulation r
    const goalOf = t => (t.pa > 0 ? t.pa : t.ia);
    const qGoal = (r, t) => (t.pa > 0 ? pa(r, t.tube) : ia(r, t.tube));
    const measOf = t => (typeof t.measured === "number" ? { kind: "ia", value: t.measured } : t.measured);
    const qMeas = (r, t) => { const m = measOf(t); return m.kind === "ik" ? ik(r, t.tube) : m.kind === "v" ? across(r, m.part) : ia(r, t.tube); };
    try {
      const r0 = sim(base);
      const detected = detect(base, r0.dc);
      const want = new Map(targets.filter(t => goalOf(t) > 0).map(t => [t.tube, t]));
      // tubes sharing a bias part (a common cathode resistor, one bias pot for a pair) form a
      // group: the part is set for the group's average (each tube's error relative to its target)
      const groups = new Map();
      detected.forEach(d => {
        if (!d.part || !want.has(d.tube)) return;
        if (!groups.has(d.part)) groups.set(d.part, { part: d.part, type: d.type, kind: d.kind, tubes: [] });
        groups.get(d.part).tubes.push(d.tube);
      });
      const list = [...groups.values()];
      // the group's error: of the sums when its targets are all currents or all dissipations (the
      // average current), else the average of each tube's error relative to its own target
      const groupErr = (r, g) => {
        const ts = g.tubes.map(id => want.get(id));
        if (ts.every(t => !!t.pa === !!ts[0].pa)) { let q = 0, w = 0; ts.forEach(t => { q += qGoal(r, t); w += goalOf(t); }); return (q - w) / w; }
        return ts.reduce((s, t) => s + (qGoal(r, t) - goalOf(t)) / goalOf(t), 0) / ts.length;
      };
      const shift = new Map();
      // 1. measured tubes: the grid shift that makes the model read what was measured
      const meas = targets.filter(t => t.measured && (measOf(t).value > 0) && want.has(t.tube) && list.some(g => g.tubes.includes(t.tube)));
      const pots = list.filter(g => g.type === "pot");
      planned = 2 + (meas.length ? 3 + meas.length : 0) + (list.length ? 4 + list.length : 0) + (pots.length ? 8 + pots.length : 0);
      if (meas.length) {
        // u = the shift in volts, within ±20 V (more current: positive)
        const spec = meas.map(() => ({ tol: 0.002, probe: 0.1, slopeSign: 1, maxStep: 3, lo: -20, hi: 20 }));
        const fit = rootAll(spec, meas.map(() => 0), u => {
          meas.forEach((t, i) => shift.set(t.tube, u[i]));
          const r = sim(variant(base, [], [], shift), true);
          return r && meas.map(t => (qMeas(r, t) - measOf(t).value) / measOf(t).value);
        }, maxRounds + 2 * meas.length);
        meas.forEach((t, i) => shift.set(t.tube, fit.u[i]));
      }
      // 2. each group's part, for its tubes' targets
      const knobs = list.map(g => knobFor(base, g.part, g.type));
      const spec = list.map((g, i) => ({ tol: 0.002, slopeSign: knobs[i].type === "resistor" && g.kind === "cathode" ? -1 : 0, probe: knobs[i].type === "pot" ? 0.3 : 0.15, maxStep: knobs[i].type === "pot" ? 2 : 1, lo: knobs[i].lo, hi: knobs[i].hi }));
      const fit = list.length ? rootAll(spec, list.map(() => 0), u => {
        const r = sim(variant(base, knobs, u, shift), true);
        return r && list.map(g => groupErr(r, g));
      }, maxRounds + 2 * list.length) : { u: [], e: [], converged: true };
      // 3. the resistors rounded to E24, simulated once more for what they give
      const rounded = knobs.map((kn, i) => (kn.type === "resistor" ? Math.log(e24(kn.value(fit.u[i])) / kn.r0) : fit.u[i]));
      const rv = list.length ? sim(variant(base, knobs, rounded, shift)) : null;
      const state = (r, id) => { const d = dev(r, id); return { ia: ia(r, id), ik: ik(r, id), va: d ? d.vak : NaN, pa: pa(r, id) }; };
      const parts = list.map((g, i) => {
        const kn = knobs[i], p = { part: g.part, type: g.type, kind: g.kind, tubes: g.tubes,
          targets: g.tubes.map(id => { const t = want.get(id); return t.pa > 0 ? { pa: t.pa } : { ia: t.ia }; }),
          target: g.tubes.reduce((s, id) => s + (want.get(id).ia || 0), 0) / g.tubes.length,
          now: g.tubes.map(id => ia(r0, id)), reached: Math.abs(fit.e[i]) <= spec[i].tol };
        if (kn.type === "resistor") {
          p.value = kn.value(fit.u[i]); p.e24 = e24(p.value); p.from = kn.r0;
          const el = base.elements.find(e => e.id === g.part);
          if (el) { const v = V(rv, el.nodes[0]) - V(rv, el.nodes[1]); p.power = v * v / p.e24; }
        } else { p.fraction = kn.value(fit.u[i]); p.from = kn.f0; }
        p.at = g.tubes.map(id => state(rv, id));
        p.ia = p.at.map(s => s.ia);
        if (!p.reached) p.note = (fit.u[i] <= kn.lo + 1e-6 || fit.u[i] >= kn.hi - 1e-6) ? (kn.type === "pot" ? "the pot's travel does not reach the target: change the divider" : "the target is out of reach for this resistor") : "the target cannot be reached with this part (dissipation peaks part way, say): the closest is shown";
        return p;
      });
      // 4. bias pots: the anode current over the whole travel; whether that covers tubes drawing
      // ±spread of the current (a fresh set of tubes); and the divider resistor that puts the
      // target at mid-travel, where it is best placed for any tube
      if (pots.length) {
        const at = where => sim(variant(base, knobs, knobs.map((kn, i) => (list[i].type !== "pot" ? rounded[i] : where === "lo" ? kn.lo : kn.hi)), shift), true);   // every pot at one end
        const ends = { lo: at("lo"), hi: at("hi") };
        const scaled = k => new Map(pots.flatMap(g => g.tubes.map(id => [id, k])));
        const groupIa = (r, g) => g.tubes.reduce((s, id) => s + ia(r, id), 0) / g.tubes.length;
        // per pot: which end gives the most current; then that end with weak tubes, the other with strong ones
        const more = pots.map(g => (ends.lo && ends.hi && groupIa(ends.hi, g) > groupIa(ends.lo, g) ? "hi" : "lo"));
        const weakAtMost = sim(variant(base, knobs, knobs.map((kn, i) => { const j = pots.indexOf(list[i]); return j < 0 ? rounded[i] : more[j] === "hi" ? kn.hi : kn.lo; }),
          shift, scaled(1 - spread)), true);
        const strongAtLeast = sim(variant(base, knobs, knobs.map((kn, i) => { const j = pots.indexOf(list[i]); return j < 0 ? rounded[i] : more[j] === "hi" ? kn.lo : kn.hi; }),
          shift, scaled(1 + spread)), true);
        pots.forEach((g, j) => {
          const p = parts[list.indexOf(g)];
          if (ends.lo && ends.hi) p.range = [groupIa(ends.lo, g), groupIa(ends.hi, g)];
          p.spread = spread;
          p.covers = { weak: !!weakAtMost && groupErr(weakAtMost, g) >= 0, strong: !!strongAtLeast && groupErr(strongAtLeast, g) <= 0 };
          p.divider = potDivider(base, r0.dc, g.part);
        });
        // the divider resistors, with every pot at mid-track
        const dv = pots.filter(g => parts[list.indexOf(g)].divider);
        if (dv.length) {
          const mid = knobs.map((kn, i) => (list[i].type === "pot" ? Math.log(0.5 / (1 - 0.5)) - Math.log(kn.f0 / (1 - kn.f0)) : rounded[i]));
          const dk = dv.map(g => knobFor(base, parts[list.indexOf(g)].divider, "resistor"));
          const withMid = u => { const nl = variant(base, knobs, mid, shift); dk.forEach((kn, i) => kn.set(nl, u[i])); return nl; };
          const dspec = dv.map(() => ({ tol: 0.005, probe: 0.15, maxStep: 1, lo: Math.log(0.05), hi: Math.log(20) }));
          const dfit = rootAll(dspec, dv.map(() => 0), u => { const r = sim(withMid(u), true); return r && dv.map(g => groupErr(r, g)); }, 8 + 2 * dv.length);
          const dr = dfit.u.map((u, i) => Math.log(e24(dk[i].value(u)) / dk[i].r0));
          const rm = sim(withMid(dr), true);
          dv.forEach((g, i) => {
            const p = parts[list.indexOf(g)];
            p.mid = { part: p.divider, from: dk[i].r0, value: dk[i].value(dfit.u[i]), e24: e24(dk[i].value(dfit.u[i])), reached: Math.abs(dfit.e[i]) <= dspec[i].tol,
              ia: rm ? g.tubes.map(id => ia(rm, id)) : null };
          });
        }
      }
      if (opts.onProgress) opts.onProgress(1);
      return { ok: true, detected, parts, shift: Object.fromEntries(shift), runs, elapsedMs: Date.now() - t0 };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err), runs, elapsedMs: Date.now() - t0 };
    }
  }

  root.TubeBias = { detect, solve, e24, potDivider };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
