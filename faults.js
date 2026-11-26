/* The fault finder's simulation side (no DOM, Node-testable): the faults a built amplifier
   commonly has, each as a change to the circuit's netlist, and how well each one's simulated
   voltages match what the user measured on the bench.
   - A resistor open, or drifted to twice its value (carbon composition and film resistors that
     ran hot drift up).
   - A capacitor shorted, or leaky (a coupling capacitor's leak pulls the next grid positive; an
     electrolytic's leak loads the supply); an electrolytic dried out (a fiftieth of its value).
   - A tube weak (half its emission) or dead (no emission: a worn cathode or an open heater); a
     rectifier tube worn (a third of its emission).
   - A transistor or diode open or shorted; a choke or inductor open.
   A measured voltage is what a DC voltmeter reads at idle: the average over the cycle with the
   signal generators silent. */
(function (root) {
  "use strict";
  const OPEN = 1e9, SHORT = 0.5;
  const TRANSISTOR = /^(npn|pnp|nmos|pmos|njf|pjf)$/;

  // parts: [{ id, ref, type, kind?, pins: { pinId: net } }] (kind: a tube's "triode" | "pentode" | "rectifier");
  // isTransistor(type) tells transistor types (CadLib.isTransistor in the CAD)
  // → [{ key, id, ref, type, fault, text, apply(netlist) → netlist }]
  function candidates(parts, isTransistor) {
    const out = [], isTr = isTransistor || (t => TRANSISTOR.test(t));
    const add = (p, fault, text, fn) => out.push({ key: p.id + ":" + fault, id: p.id, ref: p.ref, type: p.type, fault, text, apply: fn });
    const ownEl = (e, id) => e.id === id || String(e.id || "").startsWith(id + "#");
    // every element of the part, or only its main one (id === part), changed
    const mapEls = (id, own, fn) => net => ({ nodeCount: net.nodeCount, elements: net.elements.map(e => ((own ? e.id === id : ownEl(e, id)) ? fn(e) : e)) });
    const shunt = (a, b, r, id) => net => ({ nodeCount: net.nodeCount, elements: net.elements.concat([{ id: id + "#fault", kind: "R", nodes: [a, b], r }]) });
    const asOpen = e => ({ id: e.id, kind: "R", nodes: [e.nodes[0], e.nodes[e.nodes.length > 2 ? 2 : 1]], r: OPEN });
    const two = p => { const v = Object.values(p.pins); return v.length >= 2 && v[0] !== undefined && v[1] !== undefined && v[0] !== v[1] ? v : null; };
    parts.forEach(p => {
      const t = p.type, nets = two(p);
      if (t === "resistor") {
        add(p, "open", "open circuit", mapEls(p.id, true, e => (e.kind === "R" ? Object.assign({}, e, { r: OPEN }) : e)));
        add(p, "high", "drifted high (×2)", mapEls(p.id, true, e => (e.kind === "R" ? Object.assign({}, e, { r: e.r * 2 }) : e)));
      } else if (t === "capacitor" || t === "electrolytic") {
        if (!nets) return;
        const ecap = t === "electrolytic";
        add(p, "short", "shorted", shunt(nets[0], nets[1], SHORT, p.id));
        add(p, "leaky", ecap ? "leaky (10 kΩ)" : "leaky (1 MΩ)", shunt(nets[0], nets[1], ecap ? 1e4 : 1e6, p.id));
        if (ecap) add(p, "dry", "dried out (2 % of its value)", mapEls(p.id, true, e => (e.kind === "C" ? Object.assign({}, e, { c: e.c * 0.02 }) : e)));
      } else if (t === "inductor") {
        add(p, "open", "open winding", mapEls(p.id, false, e => (e.kind === "R" || e.kind === "L" ? asOpen(e) : e)));
      } else if (t === "tube") {
        if (p.kind === "rectifier") add(p, "worn", "worn (a third of its emission)", mapEls(p.id, false, e => (e.kind === "VDIODE" || e.kind === "RECT" ? Object.assign({}, e, e.perveance ? { perveance: e.perveance / 3 } : { iScale: (e.iScale || 1) / 3 }) : e)));
        else {
          add(p, "weak", "weak (half its emission)", mapEls(p.id, true, e => Object.assign({}, e, { iScale: (e.iScale || 1) * 0.5 })));
          add(p, "dead", "no emission (worn cathode or open heater)", mapEls(p.id, true, e => Object.assign({}, e, { iScale: (e.iScale || 1) * 0.005 })));
        }
      } else if (isTr(t)) {
        const c = p.pins.C !== undefined ? p.pins.C : p.pins.D, e = p.pins.E !== undefined ? p.pins.E : p.pins.S;
        if (c === undefined || e === undefined || c === e) return;
        const fet = p.pins.D !== undefined;
        add(p, "short", fet ? "shorted drain–source" : "shorted collector–emitter", shunt(c, e, SHORT, p.id));
        add(p, "open", "open (no current)", mapEls(p.id, true, el => asOpen(el)));
      } else if (t === "diode" || t === "zener" || t === "led") {
        if (!nets) return;
        add(p, "short", "shorted", shunt(nets[0], nets[1], SHORT, p.id));
        add(p, "open", "open circuit", mapEls(p.id, false, e => (e.kind === "D" ? asOpen(e) : e)));
      }
    });
    return out;
  }

  // What a DC voltmeter reads on each net of a simulation's result: the average over the
  // captured cycle where there is one, else the operating point.
  function meter(result, net) {
    if (!result || !(net > 0)) return net === 0 ? 0 : NaN;
    const w = result.tran && result.tran.nodes ? result.tran.nodes[net] : null;
    if (w && w.length > 1) { let s = 0; for (let k = 0; k < w.length - 1; k++) s += w[k]; return s / (w.length - 1); }
    const v = result.dc && result.dc.nodes ? result.dc.nodes[net] : undefined;
    return v === undefined ? NaN : v;
  }
  // how far a reading may be from a simulated value and still match: 5 % of it plus 0.2 V
  // (parts within tolerance, the meter, the mains on the day)
  const slack = v => 0.2 + 0.05 * Math.abs(v);
  // readings: [{ net, v }]; values: net → simulated volts. The rms of the misses in slacks
  // (0: exact; under 1: a match within tolerance)
  function score(readings, values) {
    let s = 0, n = 0;
    readings.forEach(r => { const v = values[r.net]; if (!isFinite(v)) { s += 100; n++; return; } const e = (v - r.v) / slack(r.v); s += e * e; n++; });
    return n ? Math.sqrt(s / n) : Infinity;
  }
  // the largest single miss, in slacks: one reading far off rules a candidate out however well the rest match
  function worst(readings, values) {
    let w = 0;
    readings.forEach(r => { const v = values[r.net]; w = Math.max(w, isFinite(v) ? Math.abs(v - r.v) / slack(r.v) : 100); });
    return w;
  }
  // nominal: net → volts of the circuit as drawn; runs: [{ cand, values }] of the faults that
  // simulated. → { nominal: score, nominalWorst, ranked: [{ cand, values, score, worst }] best first }
  function rank(readings, nominal, runs) {
    const ranked = runs.filter(r => r && r.values).map(r => Object.assign({}, r, { score: score(readings, r.values), worst: worst(readings, r.values) })).sort((a, b) => a.score - b.score || a.worst - b.worst);
    return { nominal: score(readings, nominal), nominalWorst: worst(readings, nominal), ranked };
  }
  // The test point to measure next: the one (not yet measured) where the leading faults
  // disagree most, in slacks. points: [{ net, label }]; top: ranked runs (best first).
  // → { point, values: [volts per top run] } | null
  function next(points, readings, top) {
    const done = new Set(readings.map(r => r.net));
    let best = null;
    points.forEach(pt => {
      if (done.has(pt.net)) return;
      const vs = top.map(r => r.values[pt.net]);
      if (vs.some(v => !isFinite(v))) return;
      const lo = Math.min(...vs), hi = Math.max(...vs), spread = (hi - lo) / slack((hi + lo) / 2);
      if (spread > 1 && (!best || spread > best.spread)) best = { point: pt, values: vs, spread };
    });
    return best;
  }
  root.Faults = { candidates, meter, slack, score, worst, rank, next, OPEN, SHORT };
})(typeof window !== "undefined" ? window : globalThis);
