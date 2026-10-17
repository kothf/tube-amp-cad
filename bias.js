/* Bias detection: which resistor (or potentiometer) sets each tube's bias, cathode or fixed,
   and the resistance in its grid circuit (for the grid-resistor limit in the checks).

   detect(netlist, dc)   the bias part of every tube, from the circuit and its DC solution

   Works on the engine's netlist ({ nodeCount, elements }); a part's elements carry its id
   (a pot's two halves are "id#a" and "id#b"). */
(function (root) {
  "use strict";

  // a resistor on a grid's DC return (grid stopper, grid leak) carries only grid current: under
  // 1 µA, or (a grid drawing a little) under 50 µA with less than 5 V across it; the resistors of a
  // bias divider carry more, with tens of volts across them
  const leakCurrent = (i, v) => Math.abs(i) < 1e-6 || (Math.abs(i) < 50e-6 && Math.abs(v) < 5);

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

  // the grid circuit's DC resistance: through the resistors of the grid's return (grid stopper,
  // grid leak, a volume pot) to where it is fed or grounded, the lowest series sum
  function gridResistance(adj, leak, g, region) {
    const fed = n => n === 0 || (adj.get(n) || []).some(({ ed }) => !leak(ed));
    const dist = new Map([[g, 0]]), done = new Set();
    for (;;) {
      let n = null;
      dist.forEach((d, m) => { if (!done.has(m) && (n === null || d < dist.get(n))) n = m; });
      if (n === null) return Infinity;
      if (fed(n)) return dist.get(n);
      done.add(n);
      (adj.get(n) || []).forEach(({ ed, other }) => {
        if (!leak(ed) || !region.has(other)) return;
        const d = dist.get(n) + ed.e.r;
        if (!dist.has(other) || d < dist.get(other)) dist.set(other, d);
      });
    }
  }

  // For every tube: { tube, kind: "cathode" | "fixed", part, type: "resistor" | "pot", rg }, or
  // { tube, kind: null, reason, rg } when no single resistor sets its bias. rg: the grid circuit
  // resistance (Ω; Infinity when the grid has no DC path); fixed: true for a fixed-biased grid with
  // no part to set it.
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
      const res = { tube: t.id, rg: gridResistance(adj, leak, g, region) };
      if (!region.has(0) && !feeds.length) { out.push(Object.assign(res, { kind: null, reason: "the grid has no DC path" })); return; }
      if (!region.has(0) && V(g) < -0.5) {
        const parts = feeds.map(f => Object.assign({ other: f.other }, adjustable(netlist, f.e))).filter(p => p.part);
        const pick = parts.find(p => p.type === "pot") || parts.find(p => p.other === 0) || parts.sort((a, b) => V(a.other) - V(b.other))[0];
        out.push(Object.assign(res, pick ? { kind: "fixed", part: pick.part, type: pick.type } : { kind: null, fixed: true, reason: "the negative bias supply has no resistor or pot to set it" }));
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
  root.TubeBias = { detect };
})(typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : globalThis);
