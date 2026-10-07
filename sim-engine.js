/* =============================================================================
   TUBE AMP CIRCUIT ENGINE
   Small SPICE-like solver used by the CAD (in a Web Worker) and by tests (Node).

   - Modified Nodal Analysis; node 0 is ground.
   - Newton-Raphson for nonlinear devices (vacuum tubes, diodes) with damped
     steps, gmin stepping and source stepping as DC fallbacks.
   - Transient: backward-Euler companions for capacitors; inductors and
     coupled windings (transformers) carry their branch current as an unknown,
     so they are exact shorts at DC.
   - Periodic steady state: repeat the slowest source period until the
     waveform at every node stops changing, then capture it.

   Netlist: { nodeCount, elements: [{ id, kind, nodes: [...], ...params }] }
   kinds: R, C, L, XFMR, V, VSRC, D, VDIODE, TRIODE, PENTODE
   ============================================================================= */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tube models: Norman Koren's published equations, unmodified, so parameter
  // sets are interchangeable with Koren-style SPICE models. The (1 + sgn(E1))
  // factor is 2 whenever E1 > 0. Same functions drive the curve tracer plot.
  // ---------------------------------------------------------------------------
  function softplus(x) {
    if (x > 60) return x;
    if (x < -60) return 0;
    return Math.log1p(Math.exp(x));
  }

  const Koren = {
    triodeIa(vak, vgk, p) {
      if (vak <= 0) return 0;
      const e1 = (vak / p.kp) * softplus(p.kp * (1 / p.mu + vgk / Math.sqrt(p.kvb + vak * vak)));
      return e1 > 0 ? (2 * Math.pow(e1, p.x)) / p.kg : 0;
    },
    // Pentode / beam tetrode. Koren's space-charge term Is sets the current
    // available; how it divides between plate and screen depends on the plate
    // voltage. tanh(Va/vk) is the knee and (1 + Va/lam) the slope above it, so
    // knee sharpness and plate resistance are independent (Koren's single
    // atan(Va/kvb) ties them together and gives far too soft a knee). Whatever
    // the plate cannot take in the knee partly goes to the screen (ks), which
    // is why real screen current rises when the plate swings low.
    pentodeIs(vgk, vg2k, p) {
      if (vg2k <= 0) return 0;
      const e1 = (vg2k / p.kp) * softplus(p.kp * (1 / p.mu + vgk / vg2k));
      return e1 > 0 ? (2 * Math.pow(e1, p.x)) / p.kg : 0;
    },
    pentodeIa(vak, vgk, vg2k, p) {
      if (vak <= 0) return 0;
      return Koren.pentodeIs(vgk, vg2k, p) * Math.tanh(vak / p.vk) * (1 + vak / p.lam);
    },
    // Screen current: Koren's (Vg1 + Vg2/mu)^x / kg2 plus the knee share
    screenI(vgk, vg2k, p, vak) {
      if (vg2k <= 0) return 0;
      const e = vgk + vg2k / p.mu;
      const base = e > 0 ? Math.pow(e, p.x) / (p.kg2 || 1500) : 0;
      if (vak === undefined || !p.ks) return base;
      return base + p.ks * Koren.pentodeIs(vgk, vg2k, p) * (1 - Math.tanh(Math.max(vak, 0) / p.vk));
    },
    // Grid conduction above 0 V (Child-Langmuir), scaled with tube size
    gridI(vgk, p) {
      return vgk > 0 ? (0.2 / p.kg) * Math.pow(vgk, 1.5) : 0;
    }
  };

  // Rectifier tubes: perveance per anode (A/V^1.5) from datasheet drops
  const RECTIFIER_PERVEANCE = {
    "5U4G": 6.4e-4,   // ~50 V @ 225 mA
    "5Ts3S": 6.4e-4,  // 5Ц3С, 5U4G class
    "5Ts4S": 1.4e-3,  // 5Ц4С / 5Z4, ~20 V @ 125 mA
    "GZ34": 3.5e-3,   // 5AR4, ~17 V @ 250 mA
    "6Ts4P": 6.8e-4   // 6Ц4П / EZ90, ~22 V @ 70 mA
  };

  // ---------------------------------------------------------------------------
  // Dense linear solve with partial pivoting (in place)
  // ---------------------------------------------------------------------------
  function solveLinear(A, b, n) {
    for (let k = 0; k < n; k++) {
      let piv = k, max = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(A[i * n + k]);
        if (v > max) { max = v; piv = i; }
      }
      if (max < 1e-300) return false;
      if (piv !== k) {
        for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t; }
        const t = b[k]; b[k] = b[piv]; b[piv] = t;
      }
      const akk = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / akk;
        if (f === 0) continue;
        A[i * n + k] = 0;
        for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
      b[i] = s / A[i * n + i];
    }
    return true;
  }

  function invertMatrix(M, n) {
    const A = M.slice(), I = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let k = 0; k < n; k++) {
      let piv = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(A[i * n + k]) > Math.abs(A[piv * n + k])) piv = i;
      for (let j = 0; j < n; j++) {
        let t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t;
        t = I[k * n + j]; I[k * n + j] = I[piv * n + j]; I[piv * n + j] = t;
      }
      const d = A[k * n + k];
      for (let j = 0; j < n; j++) { A[k * n + j] /= d; I[k * n + j] /= d; }
      for (let i = 0; i < n; i++) {
        if (i === k) continue;
        const f = A[i * n + k];
        if (!f) continue;
        for (let j = 0; j < n; j++) { A[i * n + j] -= f * A[k * n + j]; I[i * n + j] -= f * I[k * n + j]; }
      }
    }
    return I;
  }

  // ---------------------------------------------------------------------------
  // Source waveforms
  // ---------------------------------------------------------------------------
  function waveValue(el, t, scale) {
    const w = 2 * Math.PI * el.freq * t + (el.phase || 0) * Math.PI / 180;
    let s;
    // square: a clipped triangle, i.e. edges with a 1 % rise time like a real
    // generator. An ideal step makes each sample on an edge depend on float
    // rounding of sin() and gives two periods different edges (spurious lines).
    if (el.wave === "square") s = Math.max(-1, Math.min(1, 50 * (2 / Math.PI) * Math.asin(Math.sin(w))));
    else if (el.wave === "triangle") s = (2 / Math.PI) * Math.asin(Math.sin(w));
    else s = Math.sin(w);
    return scale * ((el.offset || 0) + el.amp * s);
  }

  // ---------------------------------------------------------------------------
  // Circuit build: assign unknown indices
  // ---------------------------------------------------------------------------
  function buildCircuit(netlist) {
    const nNodes = netlist.nodeCount;            // includes ground (0)
    let nUnk = nNodes - 1;
    const els = netlist.elements.map(e => Object.assign({}, e));
    els.forEach(e => {
      if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L") e.branch = nUnk++;
      else if (e.kind === "XFMR") {
        e.branches = e.windings.map(() => nUnk++);
        // Inductance matrix: L_jk = AL * Nj * Nk * (j===k ? 1 : k)
        const W = e.windings.length;
        const AL = e.lp / Math.pow(e.primaryTurns, 2);
        e.Lmat = new Array(W * W);
        for (let j = 0; j < W; j++) for (let k = 0; k < W; k++) {
          const nj = e.windings[j].turns, nk = e.windings[k].turns;
          e.Lmat[j * W + k] = AL * nj * nk * (j === k ? 1 : e.k);
        }
      }
    });
    return { nNodes, nUnk, els };
  }

  // Tiny series resistance on inductive branches (ohms): a winding shorted by a
  // wiring mistake would otherwise make the DC matrix singular.
  const R_SERIES = 1e-6;

  // v(node) from the unknown vector
  function vn(x, node) { return node === 0 ? 0 : x[node - 1]; }

  // ---------------------------------------------------------------------------
  // Assemble and Newton-solve one operating point
  // mode: { dc: true } or { h, t, prev } ; srcScale for source stepping
  // ---------------------------------------------------------------------------
  function newtonSolve(circ, x0, mode, opts) {
    const n = circ.nUnk;
    const x = x0.slice();
    const A = new Float64Array(n * n);
    const b = new Float64Array(n);
    const gmin = opts.gmin;
    const maxStep = mode.dc ? 25 : 15;
    const maxIter = mode.dc ? 300 : 60;
    const srcScale = opts.srcScale === undefined ? 1 : opts.srcScale;

    const addA = (i, j, v) => { if (i > 0 && j > 0) A[(i - 1) * n + (j - 1)] += v; };
    const addB = (i, v) => { if (i > 0) b[i - 1] += v; };
    const addAu = (r, c, v) => { A[r * n + c] += v; };   // raw unknown indices
    const stampG = (a, c, g) => { addA(a, a, g); addA(c, c, g); addA(a, c, -g); addA(c, a, -g); };
    // Nonlinear device: currents into each terminal I(V) linearized at V0
    // I(V) ~= I0 + J (V - V0)  ->  A += J,  b += J V0 - I0
    const stampNonlinear = (nodes, fn, V0) => {
      const I0 = fn(V0);
      const m = nodes.length;
      const rhs = I0.map(v => -v);
      for (let s = 0; s < m; s++) {
        const d = 1e-6 * Math.max(1, Math.abs(V0[s]));
        const Vp = V0.slice(); Vp[s] += d;
        const Ip = fn(Vp);
        for (let t = 0; t < m; t++) {
          const J = (Ip[t] - I0[t]) / d;
          if (J === 0) continue;
          addA(nodes[t], nodes[s], J);
          rhs[t] += J * V0[s];
        }
      }
      for (let t = 0; t < m; t++) addB(nodes[t], rhs[t]);
    };

    for (let iter = 0; iter < maxIter; iter++) {
      A.fill(0); b.fill(0);
      for (let i = 1; i < circ.nNodes; i++) addA(i, i, gmin);

      for (const e of circ.els) {
        const nd = e.nodes;
        switch (e.kind) {
          case "R": stampG(nd[0], nd[1], 1 / Math.max(e.r, 1e-6)); break;
          case "C":
            if (!mode.dc) {
              const g = e.c / mode.h;
              const vprev = vn(mode.prev, nd[0]) - vn(mode.prev, nd[1]);
              stampG(nd[0], nd[1], g);
              addB(nd[0], g * vprev); addB(nd[1], -g * vprev);
            }
            break;
          case "L": {
            // branch current i flows a -> b through the inductor
            const br = e.branch;
            if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
            if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
            addAu(br, br, -R_SERIES);   // keeps a shorted inductor solvable
            if (!mode.dc) { addAu(br, br, -e.l / mode.h); b[br] += -(e.l / mode.h) * mode.prev[br]; }
            break;
          }
          case "XFMR": {
            const W = e.windings.length;
            for (let j = 0; j < W; j++) {
              const w = e.windings[j], br = e.branches[j];
              if (w.a > 0) { addAu(w.a - 1, br, 1); addAu(br, w.a - 1, 1); }
              if (w.b > 0) { addAu(w.b - 1, br, -1); addAu(br, w.b - 1, -1); }
              addAu(br, br, -R_SERIES);
              if (!mode.dc) {
                let hist = 0;
                for (let k = 0; k < W; k++) {
                  const m = e.Lmat[j * W + k] / mode.h;
                  addAu(br, e.branches[k], -m);
                  hist += m * mode.prev[e.branches[k]];
                }
                b[br] += -hist;
              }
            }
            break;
          }
          case "V": case "VSRC": {
            const br = e.branch;
            if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
            if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
            let val;
            if (e.kind === "V") val = e.v * srcScale;
            else if (mode.dc) val = (e.dcValue !== undefined ? e.dcValue : (e.offset || 0)) * srcScale;
            else val = waveValue(e, mode.t, srcScale);
            b[br] += val;
            break;
          }
          case "D": {
            const Is = e.is || 2.5e-9, nVt = (e.n || 1.75) * 0.025852;
            const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * Is));
            let vd = vn(x, nd[0]) - vn(x, nd[1]);
            // pnjlim-style limiting against the previous iterate
            if (e._vlast !== undefined && vd > vcrit && Math.abs(vd - e._vlast) > 2 * nVt) {
              if (e._vlast > 0) { const arg = 1 + (vd - e._vlast) / nVt; vd = arg > 0 ? e._vlast + nVt * Math.log(arg) : vcrit; }
              else vd = nVt * Math.log(vd / nVt);
            }
            e._vlast = vd;
            const ex = Math.exp(Math.min(vd / nVt, 80));
            const id = Is * (ex - 1), gd = Is * ex / nVt + 1e-12;
            stampG(nd[0], nd[1], gd);
            const ieq = id - gd * vd;
            addB(nd[0], -ieq); addB(nd[1], ieq);
            break;
          }
          case "VDIODE": {
            const P = e.perveance;
            const V0 = [vn(x, nd[0]), vn(x, nd[1])];
            stampNonlinear(nd, V => { const v = V[0] - V[1]; const i = v > 0 ? P * Math.pow(v, 1.5) : 0; return [i, -i]; }, V0);
            break;
          }
          case "TRIODE": {
            const p = e.model;
            const V0 = nd.map(k => vn(x, k));   // A, G, K
            stampNonlinear(nd, V => {
              const vak = V[0] - V[2], vgk = V[1] - V[2];
              const ia = Koren.triodeIa(vak, vgk, p), ig = Koren.gridI(vgk, p);
              return [ia, ig, -(ia + ig)];
            }, V0);
            break;
          }
          case "PENTODE": {
            const p = e.model;
            const V0 = nd.map(k => vn(x, k));   // A, G1, G2, K
            stampNonlinear(nd, V => {
              const vak = V[0] - V[3], vgk = V[1] - V[3], vg2k = V[2] - V[3];
              const ia = Koren.pentodeIa(vak, vgk, vg2k, p);
              const ig2 = Koren.screenI(vgk, vg2k, p, vak), ig = Koren.gridI(vgk, p);
              return [ia, ig, ig2, -(ia + ig + ig2)];
            }, V0);
            break;
          }
        }
      }

      const sol = Array.from(b);
      if (!solveLinear(A, sol, n)) return { ok: false, x, error: "singular matrix" };

      // Damped update on node voltages
      let maxDv = 0;
      for (let i = 0; i < circ.nNodes - 1; i++) maxDv = Math.max(maxDv, Math.abs(sol[i] - x[i]));
      const scale = maxDv > maxStep ? maxStep / maxDv : 1;
      let conv = scale === 1;
      for (let i = 0; i < n; i++) {
        const nx = x[i] + (sol[i] - x[i]) * scale;
        if (i < circ.nNodes - 1 && Math.abs(nx - x[i]) > 1e-6 + 1e-6 * Math.abs(nx)) conv = false;
        x[i] = nx;
      }
      if (!isFinite(maxDv)) return { ok: false, x, error: "numerical overflow" };
      if (conv && iter > 0) return { ok: true, x, iter };
    }
    return { ok: false, x, error: "no convergence" };
  }

  function dcOperatingPoint(circ) {
    const zero = new Array(circ.nUnk).fill(0);
    circ.els.forEach(e => { delete e._vlast; });
    let r = newtonSolve(circ, zero, { dc: true }, { gmin: 1e-9 });
    if (r.ok) return r;
    // gmin stepping
    let x = zero;
    for (const g of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9]) {
      r = newtonSolve(circ, x, { dc: true }, { gmin: g });
      if (!r.ok) break;
      x = r.x;
    }
    if (r.ok) return r;
    // source stepping
    x = zero;
    for (let s = 1; s <= 20; s++) {
      r = newtonSolve(circ, x, { dc: true }, { gmin: 1e-9, srcScale: s / 20 });
      if (!r.ok) return r;
      x = r.x;
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Device readouts at a solution (used for the tube viewer and inspector)
  // ---------------------------------------------------------------------------
  function deviceState(e, x) {
    const v = e.nodes.map(k => vn(x, k));
    if (e.kind === "TRIODE") {
      const vak = v[0] - v[2], vgk = v[1] - v[2];
      return { vak, vgk, ia: Koren.triodeIa(vak, vgk, e.model), ig: Koren.gridI(vgk, e.model) };
    }
    if (e.kind === "PENTODE") {
      const vak = v[0] - v[3], vgk = v[1] - v[3], vg2k = v[2] - v[3];
      return { vak, vgk, vg2k, ia: Koren.pentodeIa(vak, vgk, vg2k, e.model), ig2: Koren.screenI(vgk, vg2k, e.model, vak), ig: Koren.gridI(vgk, e.model) };
    }
    if (e.kind === "VDIODE") { const vd = v[0] - v[1]; return { vd, i: vd > 0 ? e.perveance * Math.pow(vd, 1.5) : 0 }; }
    if (e.kind === "D") { const vd = v[0] - v[1]; return { vd, i: (e.is || 2.5e-9) * (Math.exp(Math.min(vd / ((e.n || 1.75) * 0.025852), 80)) - 1) }; }
    if (e.kind === "R") { const vd = v[0] - v[1]; return { vd, i: vd / e.r }; }
    if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L") return { i: x[e.branch], vd: v[0] - v[1] };
    if (e.kind === "C") return { vd: v[0] - v[1] };
    return {};
  }

  // ---------------------------------------------------------------------------
  // Minimal polynomial extrapolation over period-to-period states x0..x(k+1):
  // estimates the fixed point of the period map when slow modes decay
  // geometrically (including oscillatory pairs).
  // ---------------------------------------------------------------------------
  function mpeExtrapolate(states) {
    const k = states.length - 2, n = states[0].length;
    if (k < 1) return null;
    const u = [];
    for (let j = 0; j <= k; j++) { const d = new Float64Array(n); for (let i = 0; i < n; i++) d[i] = states[j + 1][i] - states[j][i]; u.push(d); }
    // scale rows so volts and amps weigh comparably
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j <= k; j++) m = Math.max(m, Math.abs(u[j][i])); w[i] = m > 0 ? 1 / m : 0; }
    // least squares: sum_j c_j u_j = -u_k  (j < k)
    const M = new Array(k * k).fill(0), rhs = new Array(k).fill(0);
    for (let a = 0; a < k; a++) {
      for (let b2 = 0; b2 < k; b2++) { let s = 0; for (let i = 0; i < n; i++) s += u[a][i] * w[i] * u[b2][i] * w[i]; M[a * k + b2] = s; }
      let s = 0; for (let i = 0; i < n; i++) s += u[a][i] * w[i] * u[k][i] * w[i]; rhs[a] = -s;
    }
    for (let a = 0; a < k; a++) M[a * k + a] *= 1 + 1e-10;
    if (!solveLinear(M, rhs, k)) return null;
    const c = rhs.concat([1]);
    const sum = c.reduce((s, v) => s + v, 0);
    if (!isFinite(sum) || Math.abs(sum) < 1e-12) return null;
    const out = new Array(n).fill(0);
    for (let j = 0; j <= k; j++) { const g = c[j] / sum; for (let i = 0; i < n; i++) out[i] += g * states[j][i]; }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Full analysis: DC operating point + periodic steady-state transient
  // ---------------------------------------------------------------------------
  function simulate(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const budgetMs = opts.budgetMs || 2500;
    const circ = buildCircuit(netlist);
    const nodeCount = circ.nNodes;
    const result = { ok: false, nodeCount, warnings: [] };
    if (nodeCount < 2) { result.error = "Circuit is empty"; return result; }

    const dc = dcOperatingPoint(circ);
    if (!dc.ok) {
      result.error = dc.error === "singular matrix"
        ? "Circuit cannot be solved: check for voltage sources wired in parallel or shorted, or a supply with no return path"
        : "DC operating point did not converge (" + dc.error + ")";
      return result;
    }
    result.dc = { nodes: [0].concat(dc.x.slice(0, nodeCount - 1)), devices: {} };
    circ.els.forEach(e => { if (e.id) result.dc.devices[e.id] = Object.assign(result.dc.devices[e.id] || {}, { [e.kind === "VDIODE" ? e.part || "d" : "main"]: deviceState(e, dc.x) }); });

    // Time base from sources
    const freqs = circ.els.filter(e => e.kind === "VSRC" && e.freq > 0 && e.amp !== 0).map(e => e.freq);
    const fMin = freqs.length ? Math.min.apply(null, freqs) : 0;
    const fMax = freqs.length ? Math.max.apply(null, freqs) : 0;
    const window = opts.window || (fMin ? Math.max(1 / fMin, 2 / fMax, 0.002) : 0.005);
    const period = fMin ? 1 / fMin : window;
    // whole number of base periods so harmonic analysis of the capture is exact
    const capture = fMin ? period * Math.max(1, Math.ceil(window / period - 1e-9)) : window;
    let h = fMax ? Math.min(1 / (fMax * 160), capture / 600) : capture / 400;
    h = Math.max(h, capture / 8000);
    const stepsPerPeriod = Math.max(1, Math.round(period / h));
    h = period / stepsPerPeriod;
    const captureSteps = Math.round(capture / h);

    let x = dc.x.slice(), t = 0;
    const step = (xprev, tNext, hh) => {
      let r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev }, { gmin: 1e-12 });
      if (r.ok) return r.x;
      // retry with sub-steps
      let xs = xprev;
      for (let k = 1; k <= 8; k++) {
        r = newtonSolve(circ, xs, { h: hh / 8, t: tNext - hh + hh * k / 8, prev: xs }, { gmin: 1e-12 });
        if (!r.ok) return null;
        xs = r.x;
      }
      return xs;
    };

    const runPeriod = (hh, nSteps) => {
      for (let s = 0; s < nSteps; s++) {
        t += hh;
        const nx = step(x, t, hh);
        if (!nx) return false;
        x = nx;
      }
      return true;
    };
    // per-node relative change (1 V floor): a node sitting near 0 V, such as an
    // output after a coupling cap, must settle to millivolts, a 400 V rail to ~0.1 V
    const periodChange = (a, b) => {
      let m = 0;
      for (let i = 0; i < nodeCount - 1; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / (Math.abs(a[i]) + 1));
      return m;
    };

    // Settle to periodic steady state. Coarse steps (the slow supply/coupling
    // dynamics need no audio resolution), and every few periods a vector
    // extrapolation (MPE, Skelboe's method) jumps over slow decays such as the
    // LC ringing of a choke-input supply.
    let settled = !freqs.length, periods = 0, extrapolations = 0;
    const maxPeriods = opts.maxPeriods || 400;
    if (freqs.length) {
      const coarseSteps = Math.max(1, Math.min(stepsPerPeriod, Math.round(period / Math.min(period / 200, 1 / (20 * fMax)))));
      const hc = period / coarseSteps;
      let hist = [x.slice()], lastChange = Infinity;
      while (periods < maxPeriods) {
        const start = x.slice();
        if (!runPeriod(hc, coarseSteps)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
        periods++;
        const change = periodChange(x, start);
        // distance to steady state estimated from the decay rate per period
        // (a slow coupling-cap RC can change little per period yet be far off)
        const lambda = isFinite(lastChange) && lastChange > 0 ? Math.min(change / lastChange, 0.9999) : 1;
        const remaining = lambda < 1 ? change * lambda / (1 - lambda) : Infinity;
        if (periods >= 3 && change < 1e-4 && remaining < 1e-4) { settled = true; break; }
        hist.push(x.slice());
        if (hist.length >= 7 && !opts.noExtrapolate) {
          const xe = mpeExtrapolate(hist);
          // accept the jump only if it lands somewhere sane
          if (xe && xe.every(isFinite) && periodChange(xe, x) < 0.5) { x = xe; extrapolations++; }
          hist = [x.slice()];
        }
        lastChange = change;
        if (Date.now() - t0 > budgetMs * 0.75) break;
      }
      // re-settle the fast (audio) dynamics at full resolution
      for (let k = 0; k < 2; k++) {
        const start = x.slice();
        if (!runPeriod(h, stepsPerPeriod)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
        if (periodChange(x, start) < 1e-4) break;
      }
      if (!settled) result.warnings.push("Not fully settled after " + periods + " cycles (large time constants); waveforms may still drift.");
      result.extrapolations = extrapolations;
    }

    // Capture
    const nCap = captureSteps + 1;
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) nodes.push(new Float32Array(nCap));
    const devIdx = circ.els.filter(e => e.kind === "TRIODE" || e.kind === "PENTODE" || e.kind === "VDIODE" || e.kind === "D");
    const devTrace = {};
    devIdx.forEach(e => { devTrace[e.id + (e.part ? "#" + e.part : "")] = { i: new Float32Array(nCap), ig2: e.kind === "PENTODE" ? new Float32Array(nCap) : null }; });
    const record = (k) => {
      for (let i = 1; i < nodeCount; i++) nodes[i][k] = x[i - 1];
      devIdx.forEach(e => {
        const s = deviceState(e, x), tr = devTrace[e.id + (e.part ? "#" + e.part : "")];
        tr.i[k] = s.ia !== undefined ? s.ia : s.i;
        if (tr.ig2) tr.ig2[k] = s.ig2;
      });
    };
    record(0);
    for (let s = 1; s < nCap; s++) {
      t += h;
      const nx = step(x, t, h);
      if (!nx) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
      x = nx;
      record(s);
    }
    result.tran = { dt: h, samples: nCap, nodes, devices: devTrace, periods, settled, fBase: fMin };
    result.ok = true;
    result.elapsedMs = Date.now() - t0;
    return result;
  }

  // Behavioural-source expressions for SPICE export: the exact equations above
  const g = v => Number(v.toPrecision(6));
  const Spice = {
    triode: m => ({
      plate: `pwr(max(V(A,K)/${g(m.kp)}*ln(1+exp(${g(m.kp)}*(1/${g(m.mu)}+V(G,K)/sqrt(${g(m.kvb)}+V(A,K)*V(A,K))))),0),${g(m.x)})*${g(2 / m.kg)}`,
      grid: `if(V(G,K)>0,${g(0.2 / m.kg)}*pwr(V(G,K),1.5),0)`
    }),
    pentode: m => {
      const is = `pwr(max(V(G2,K)/${g(m.kp)}*ln(1+exp(${g(m.kp)}*(1/${g(m.mu)}+V(G1,K)/max(V(G2,K),1e-3)))),0),${g(m.x)})*${g(2 / m.kg)}`;
      const va = "max(V(A,K),0)";
      return {
        plate: `${is}*tanh(${va}/${g(m.vk)})*(1+${va}/${g(m.lam)})`,
        screen: `pwr(max(V(G1,K)+V(G2,K)/${g(m.mu)},0),${g(m.x)})/${g(m.kg2 || 1500)}+${g(m.ks || 0)}*${is}*(1-tanh(${va}/${g(m.vk)}))`,
        grid: `if(V(G1,K)>0,${g(0.2 / m.kg)}*pwr(V(G1,K),1.5),0)`
      };
    }
  };

  const Engine = { Koren, Spice, RECTIFIER_PERVEANCE, simulate, buildCircuit, dcOperatingPoint, solveLinear, invertMatrix };
  root.TubeSimEngine = Engine;
})(globalThis);
