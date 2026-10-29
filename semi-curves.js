/* =============================================================================
   TRANSISTOR CURVES — the characteristic curves of a BJT, MOSFET or JFET from the
   simulator's own models (no DOM; the curve tracer draws them, Node tests load it).
   The part is built as the CAD builds it (cad-components.js LIB[type].build): the
   Gummel-Poon BJT at its temperature with its base and emitter resistances, the
   square-law MOSFET and JFET channel, so the curves are what the simulation computes.
   Everything here is in the part's own polarity frame: a PNP's −VCE, −IC, −IB and a
   P-channel FET's −VDS, −ID, −VGS are positive numbers, as an NPN's or N-channel's are.
   Depends on: sim-engine.js (TubeSimEngine.Semi), cad-components.js (CadLib)
   ============================================================================= */
(function (root) {
  "use strict";
  const Semi = () => root.TubeSimEngine.Semi;
  const L = () => root.CadLib;
  const TYPES = ["npn", "pnp", "nmos", "pmos", "njf", "pjf"];

  /** A part ready to trace: its catalog entry, the engine's model and resistances. */
  function device(type, name, temp) {
    const lib = L(), tab = lib.semiTable(type), spec = tab[name];
    if (!spec || !lib.LIB[type]) return null;
    const out = [];
    let n = 3;
    const params = { model: name };
    if (temp !== undefined && temp !== null && isFinite(temp)) params.temp = +temp;
    lib.LIB[type].build({ id: "q", params }, pin => ({ C: 1, D: 1, B: 2, G: 2, E: 0, S: 0 })[pin], () => n++, out);
    const main = out.find(e => e.id === "q"), r = id => (out.find(e => e.id === "q#" + id) || {}).r || 0;
    const bip = main.kind === "BJT", m = main.model, jfet = !!m.jf;
    const dev = { type, name, spec, m, bip, jfet, pol: m.pol, rb: r("rb"), re: r("re"), temp: bip ? m.t : null, ge: !!spec.ge };
    if (!bip) dev.vth = m.pol * m.vto;          // the gate voltage at which the channel closes, in the part's frame
    if (jfet) dev.idss = m.kp / 2 * m.vto * m.vto;
    return dev;
  }

  // ---------------------------------------------------------------------------
  // BJT: collector at vce, a current ib forced into the base, emitter grounded.
  // Unknowns: the inner junction voltage vbe' and the inner emitter's rise ve' across RE.
  // ---------------------------------------------------------------------------
  function bjtInner(dev, vce, vbe, ve) {
    const p = dev.pol, I = Semi().bjt([p * vce, p * (ve + vbe), p * ve], dev.m);
    return [p * I[0], p * I[1]];
  }
  /** { ic, ib, vbe (at the pins), x (inner vbe'), y (ve') } with ib forced into the base at vce. */
  function bjt(dev, vce, ib, guess) {
    const m = dev.m, re = dev.re, vt = (m.nf || 1) * (m.vt || 0.025852);
    let x = guess ? guess.x : vt * Math.log(Math.max(ib, 1e-15) * m.bf / m.is + 1), y = guess ? guess.y : re * ib * (m.bf + 1);
    const res = (X, Y) => { const [ic, b] = bjtInner(dev, vce, X, Y); return [b - ib, Y - re * (ic + b), ic, b]; };
    const tol = 1e-13 + 1e-9 * Math.abs(ib);
    let ok = false;
    for (let it = 0; it < 80; it++) {
      const F = res(x, y);
      if (Math.abs(F[0]) <= tol && Math.abs(F[1]) <= 1e-9 + 1e-9 * Math.abs(y)) { ok = true; break; }
      const h = 1e-6, Fx = res(x + h, y), a = (Fx[0] - F[0]) / h, c = (Fx[1] - F[1]) / h;
      if (re > 0) {
        const Fy = res(x, y + h), b = (Fy[0] - F[0]) / h, d = (Fy[1] - F[1]) / h, det = a * d - b * c;
        if (!(Math.abs(det) > 1e-30)) break;
        let dx = -(F[0] * d - b * F[1]) / det, dy = -(a * F[1] - c * F[0]) / det;
        const k = Math.min(1, 0.05 / Math.max(Math.abs(dx), 1e-30));
        dx *= k; dy *= k;
        x += dx; y += dy;
      } else {
        if (!(a > 0)) break;
        x += Math.max(-0.05, Math.min(0.05, -F[0] / a));
      }
    }
    if (!ok) [x, y] = bjtBisect(dev, vce, ib);
    const [ic, b] = bjtInner(dev, vce, x, y);
    return { ic, ib: b, vbe: x + y + dev.rb * b, x, y };
  }
  // the slow, sure way: vbe' by bisection for a given ve' (the base current rises with it), and ve'
  // by bisection on its own equation (ve' − RE·IE rises with ve')
  function bjtBisect(dev, vce, ib) {
    const xFor = y => { let lo = -1.5, hi = 3; for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (bjtInner(dev, vce, mid, y)[1] < ib) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    if (!(dev.re > 0)) return [xFor(0), 0];
    const g = y => { const x = xFor(y), [ic, b] = bjtInner(dev, vce, x, y); return y - dev.re * (ic + b); };
    let lo = 0, hi = 1e-3;
    for (let i = 0; i < 40 && g(hi) < 0; i++) hi *= 2;
    for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (g(mid) < 0) lo = mid; else hi = mid; }
    const y = (lo + hi) / 2;
    return [xFor(y), y];
  }
  /** The base current that gives ic at vce (negative below a germanium part's ICEO). */
  function ibFor(dev, vce, ic) {
    const at = ib => bjt(dev, vce, ib).ic;
    if (ic <= at(0)) {
      let lo = -Math.max(1e-9, 4 * (dev.m.icbo || 0)), hi = 0;
      if (at(lo) > ic) return null;
      for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (at(mid) < ic) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    }
    let lo = -14, hi = Math.log10(Math.max(dev.spec.i, 1e-3)) + 1;
    if (at(Math.pow(10, hi)) < ic) return null;
    for (let i = 0; i < 70; i++) { const mid = (lo + hi) / 2; if (at(Math.pow(10, mid)) < ic) lo = mid; else hi = mid; }
    return Math.pow(10, (lo + hi) / 2);
  }

  // ---------------------------------------------------------------------------
  // FET: drain at vds, gate at vgs, source grounded (the channel; a JFET's gate junctions
  // only conduct with the gate forward-biased, which the curves stay out of)
  // ---------------------------------------------------------------------------
  function fet(dev, vds, vgs) {
    const p = dev.pol;
    return p * Semi().mos([p * vds, p * vgs, 0], dev.m)[0];
  }
  /** The gate voltage that gives id at vds (null when the part cannot reach it). */
  function vgsFor(dev, vds, id) {
    let lo = dev.vth - 2, hi = dev.jfet ? 0.6 : dev.vth + 40;
    if (fet(dev, vds, hi) < id) return null;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (fet(dev, vds, mid) < id) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  // ---------------------------------------------------------------------------
  // Ranges and steps, as a curve tracer's operator would set them for the part
  // ---------------------------------------------------------------------------
  function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-15))));
    for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v * (1 - 1e-9)) return k * p;
    return 10 * p;
  }
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-15))));
    for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v * (1 - 1e-9)) return k * p;
    return 10 * p;
  }
  // the next nice step below v, and a step for span that gives between 0.6·n and n curves
  function niceBelow(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-15))));
    for (const k of [5, 2.5, 2, 1]) if (k * p < v * (1 - 1e-9)) return k * p;
    return 0.5 * p;
  }
  function stepFor(span, n) {
    let st = niceStep(span / n);
    for (let i = 0; i < 6 && span / st < 0.6 * n && span / niceBelow(st) <= n + 1e-9; i++) st = niceBelow(st);
    return st;
  }
  /** The voltage axis and the current the top curve should reach: the part's ratings, widened to
   *  or, in a circuit, round its operating point q ({ v, i } and the load line's maxima vMax, iMax). */
  function autoRange(dev, q) {
    const s = dev.spec;
    // in a circuit: round the operating point and its load line, as the part works there
    if (q && q.i > 0 && q.v > 0) return { vMax: niceCeil(Math.max(q.v * 1.6, (q.vMax || 0) * 1.1)), iTop: Math.max(q.i * 1.8, (q.iMax || 0) * 1.2) };
    const vMax = dev.jfet ? Math.min(s.v, 20) : Math.min(s.v, Math.max(10, 4 * s.p / s.i, s.v / 4));
    return { vMax: niceCeil(vMax), iTop: dev.jfet ? dev.idss : Math.min(s.i, s.p / (0.3 * vMax)) };
  }
  /** The family's control values: base currents (from 0) or gate voltages (down from the top
   *  one, above the cut-off); step: given or chosen so about n curves reach iTop at mid-axis. */
  function steps(dev, vMax, iTop, n, step) {
    n = Math.max(1, Math.min(24, Math.round(n || 8)));
    if (dev.bip) {
      const top = ibFor(dev, vMax / 2, iTop) || dev.spec.i / 10;
      const st = step > 0 ? step : stepFor(top, n), out = [];
      for (let k = 0; k <= n && (step > 0 || k * st <= top * 1.0001); k++) out.push(k * st);
      return { step: st, values: out };
    }
    const top = dev.jfet ? 0 : vgsFor(dev, vMax / 2, iTop);
    const span = (top === null ? dev.vth + 10 : top) - dev.vth;
    const st = step > 0 ? step : stepFor(span, n), out = [];
    const first = dev.jfet ? 0 : Math.floor((dev.vth + span) / st + 1e-9) * st;
    for (let k = 0; k < (step > 0 ? n : 40) && out.length < n; k++) {
      const v = first - k * st;
      if (v <= dev.vth + 1e-9) break;
      out.push(+v.toFixed(9));
    }
    return { step: st, values: out };
  }
  /** Voltages to sample an output curve at between v0 and v1: even steps, closer near 0 where a
   *  BJT saturates and a FET's channel is resistive. */
  function samples(v0, v1, n) {
    n = n || 240;
    const out = [];
    for (let k = 0; k <= n; k++) out.push(v0 + (v1 - v0) * k / n);
    const knee = Math.min(v1, Math.max(v0, 0) + (v1 - v0) * 0.06);
    for (let k = 1; k < 40; k++) { const v = Math.max(v0, 0) + (knee - Math.max(v0, 0)) * k / 40; if (v > v0 && v < v1) out.push(v); }
    return out.sort((a, b) => a - b);
  }
  /** One output curve: [[v, i], ...] at the control value c (IB or VGS). */
  function outputCurve(dev, c, vs) {
    if (!dev.bip) return vs.map(v => [v, fet(dev, Math.max(v, 0), c)]);
    let g = null;
    return vs.map(v => { const r = bjt(dev, Math.max(v, 0), c, g); g = r; return [v, r.ic]; });
  }
  /** The transfer curve at the output voltage v: BJT [[vbe, ic, ib]] over base currents, FET [[vgs, id]]. */
  function transferCurve(dev, v, iTop, n) {
    n = n || 160;
    if (dev.bip) {
      const top = ibFor(dev, v, iTop * 1.2) || dev.spec.i / 10, out = [];
      let g = null;
      for (let k = 0; k <= n; k++) {
        const ib = top * Math.pow(10, -5 + 5 * k / n), r = bjt(dev, v, ib, g);
        g = r; out.push([r.vbe, r.ic, ib]);
      }
      return out;
    }
    const top = dev.jfet ? 0 : vgsFor(dev, v, iTop * 1.2), hi = top === null ? dev.vth + 10 : top, lo = dev.vth - 0.15 * (hi - dev.vth), out = [];
    for (let k = 0; k <= n; k++) { const vg = lo + (hi - lo) * k / n; out.push([vg, fet(dev, v, vg)]); }
    return out;
  }
  /** The gain against the current, at the output voltage v, on a logarithmic sweep up to iMax:
   *  BJT [[ic, hFE = IC/IB, h21 = dIC/dIB]], FET [[id, gm]]. */
  function gainCurve(dev, v, iMax, n) {
    n = n || 160;
    const out = [];
    if (dev.bip) {
      // a germanium part's leakage (its IC at IB = 0) swamps IC / IB at low current: from 5 times it up
      const top = ibFor(dev, v, iMax) || dev.spec.i / 10, floor = Math.max(0, 5 * bjt(dev, v, 0).ic);
      let g = null;
      for (let k = 0; k <= n; k++) {
        const ib = top * Math.pow(10, -6 + 6 * k / n), r = bjt(dev, v, ib, g), r2 = bjt(dev, v, ib * 1.001, r);
        g = r;
        if (r.ic > floor) out.push([r.ic, r.ic / ib, (r2.ic - r.ic) / (ib * 0.001)]);
      }
      return out;
    }
    const top = dev.jfet ? 0 : vgsFor(dev, v, iMax), hi = top === null ? dev.vth + 10 : top;
    for (let k = 0; k <= n; k++) {
      const id = iMax * Math.pow(10, -4 + 4 * k / n), vg = dev.jfet && id >= fet(dev, v, 0) ? null : vgsFor(dev, v, id);
      if (vg === null || vg > hi + 1e-9) continue;
      const h = 1e-4;
      out.push([id, (fet(dev, v, vg + h) - fet(dev, v, vg - h)) / (2 * h)]);
    }
    return out;
  }
  /** Small-signal values at a point of the output curves: v and the control value c.
   *  BJT { hfe, h21, gm, ro, vbe }; FET { gm, rds, mu }. */
  function smallSignal(dev, v, c) {
    const hv = Math.max(0.01, Math.abs(v) * 0.002);
    if (dev.bip) {
      const r = bjt(dev, v, c), up = bjt(dev, v, c * 1.001 + 1e-12, r), dn = bjt(dev, Math.max(0, v - hv), c, r), vu = bjt(dev, v + hv, c, r);
      const go = (vu.ic - dn.ic) / (v + hv - Math.max(0, v - hv));
      return { ic: r.ic, vbe: r.vbe, hfe: c > 0 ? r.ic / c : null, h21: (up.ic - r.ic) / (up.ib - r.ib), gm: (up.ic - r.ic) / (up.vbe - r.vbe), ro: go > 1e-15 ? 1 / go : Infinity };
    }
    const h = 1e-4, gm = (fet(dev, v, c + h) - fet(dev, v, c - h)) / (2 * h);
    const gd = (fet(dev, v + hv, c) - fet(dev, Math.max(0, v - hv), c)) / (v + hv - Math.max(0, v - hv)), rds = gd > 1e-15 ? 1 / gd : Infinity;
    return { id: fet(dev, v, c), gm, rds, mu: gm * rds };
  }

  root.SemiCurves = { TYPES, device, bjt, ibFor, fet, vgsFor, autoRange, steps, samples, outputCurve, transferCurve, gainCurve, smallSignal, niceCeil, niceStep };
})(globalThis);
