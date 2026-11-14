/* =============================================================================
   SPICE PARTS — any SPICE subcircuit or .MODEL as a part of the circuit. No DOM: used
   by the CAD (the part's build), the board, the workers and the Node tests.

   flatten(text, name) reads a library (SpiceModel.parseLib) and turns one .SUBCKT, with
   the subcircuits it calls, into the simulator's own elements on local nodes:
     R C L K · V I (DC, and SIN PULSE EXP SFFM PWL in the transient) · D Q M J with their .MODEL (diode, Gummel–Poon BJT,
     level 1 to 3 MOSFET by its own equations with its bulk, LTspice's VDMOS as the square law, JFET) · E G F H, linear,
     VALUE = {…}, TABLE and POLY(n), LAPLACE (H(s) as a state-space network) and FREQ (a table fitted
     to H(s) by vector fitting) · B (I = or V =, Laplace=) · S and W switches · T (lossless) · X.
   What depends on voltages or currents by an expression becomes a behavioural source
   (the engine's kind B) with a closed expression tree: parameters are numbers by then,
   .FUNC bodies are inlined, nodes are the element's own.
   A lone .MODEL (a transistor or a diode from a maker's file) is wrapped as a part with
   that device's pins.

   Junction capacitances follow the voltage across them (the engine's capAt, stepped by its
   chargeAt); a transistor's transit times TF and TR store charge in the waveform and the
   small-signal analyses; a VDMOS's Cgd follows CGDMIN … CGDMAX (A). A transistor's temperature
   terms (XTI, EG, XTB, TNOM) set it at another temperature, or as it heats itself (build's spec).
   Not carried over: the other temperature terms and noise parameters. Lossless transmission lines (T) are
   the engine's TLINE. Not supported (an error): CHEBYSHEV sources, lossy lines (O, U, T with R or G), BSIM MOSFETs, PWL from a file. B sources may read time.

   build(spec, pinNodes, alloc, id) gives the engine's elements for one part of a circuit.
   ============================================================================= */
(function (root) {
  "use strict";
  const SM = root.SpiceModel;
  const VT = 0.025852;
  // The engine rounds a FET's turn-on over 50 mV for its own parts; a maker's model sets the
  // gain of an input pair by a few tens of millivolts of overdrive, so here the corner is sharp.
  const FET_S = 0.002;
  // A level 1, 2 or 3 MOSFET's constants for the engine's mos1Id/mos2Id/mos3Id (Semi.mosx), worked out
  // as ngspice's mos1temp.c, mos2temp.c and mos3temp.c do at the nominal temperature (27 °C): KP from
  // UO and TOX, PHI, GAMMA and VTO from NSUB where those are not given, the depletion width's
  // coefficient, the short- and narrow-channel factors. vbi is signed for the engine (N-channel sense).
  const EPSSIL = 11.7 * 8.854214871e-12, Q_E = 1.6021766208e-19, KOQ = 1.38064852e-23 / 1.6021766208e-19;
  function mosSetup(m, level, pol, w, l, mult, no, mp) {
    const vt = KOQ * 300.15, eg = 1.16 - 7.02e-4 * 300.15 * 300.15 / (300.15 + 1108);
    const toxGiven = m.p.tox !== undefined, tox = mp(m, "tox", 1e-7, no);
    const cox = level === 1 && !(toxGiven && tox > 0) ? 0 : 3.9 * 8.854214871e-12 / tox;
    const uo = mp(m, "uo|u0", 600, no);
    let kp = mp(m, "kp", NaN, no);
    if (isNaN(kp)) kp = cox > 0 ? uo * 1e-4 * cox : 2e-5;
    let phi = mp(m, "phi", 0.6, no), gamma = mp(m, "gamma", NaN, no), vto = mp(m, "vto|vt0", NaN, no), xd = 0, nsub = mp(m, "nsub", 0, no);
    // (level 3 takes the intrinsic density at TNOM, levels 1 and 2 the 300 K value)
    const ni = level === 3 ? 1.45e16 * Math.pow(300.15 / 300, 1.5) * Math.exp(0.5 * eg * (1 / 300 - 1 / 300.15) / KOQ) : 1.45e16;
    if (nsub > 0 && cox > 0) {
      if (nsub * 1e6 > ni) {
        if (m.p.phi === undefined) phi = Math.max(0.1, 2 * vt * Math.log(nsub * 1e6 / ni));
        const fermis = pol * 0.5 * phi, tpg = mp(m, "tpg", 1, no);
        const wkfng = tpg !== 0 ? 3.25 + 0.5 * eg - pol * tpg * 0.5 * eg : 3.2, wkfngs = wkfng - (3.25 + 0.5 * eg + fermis);
        if (isNaN(gamma)) gamma = Math.sqrt(2 * EPSSIL * Q_E * nsub * 1e6) / cox;
        if (isNaN(vto)) vto = wkfngs - mp(m, "nss", 0, no) * 1e4 * Q_E / cox + pol * (gamma * Math.sqrt(phi) + phi);
        xd = Math.sqrt(2 * EPSSIL / (Q_E * nsub * 1e6));
      } else nsub = 0;
    } else nsub = 0;
    if (isNaN(gamma)) gamma = 0;
    if (isNaN(vto)) vto = 0;
    const ld = mp(m, "ld", 0, no);
    const leff = Math.max(level === 3 ? l - 2 * ld + mp(m, "xl", 0, no) : l - 2 * ld, 1e-9), weff = Math.max(level === 3 ? w - 2 * mp(m, "wd", 0, no) + mp(m, "xw", 0, no) : w, 1e-9);
    const P = { level, beta: kp * mult * weff / leff, leff, weff, phi, gamma, vbi: pol * vto - gamma * Math.sqrt(phi), lambda: mp(m, "lambda", 0, no), vt,
      cox, cmey: cox * leff * weff * mult, xd, nsub, ld, us: uo, xj: mp(m, "xj", 0, no), nfs: mp(m, "nfs", 0, no), vmax: mp(m, "vmax", 0, no) };
    if (level === 1) P.s = FET_S;
    else if (level === 2) {
      Object.assign(P, { factor: 0.25 * Math.PI * mp(m, "delta", 0, no) * EPSSIL / (cox * weff), ucrit: mp(m, "ucrit", 1e4, no), uexp: mp(m, "uexp", 0, no),
        neff: mp(m, "neff", 1, no), pb: mp(m, "pb", 0.8, no) });
    } else if (level === 3) {
      Object.assign(P, { eta: mp(m, "eta", 0, no), theta: mp(m, "theta", 0, no), kappa: mp(m, "kappa", 0.2, no), alpha: xd * xd,
        narrow: mp(m, "delta", 0, no) * 0.5 * Math.PI * EPSSIL / cox });
    }
    return P;
  }
  const DEVICE_PINS = { d: ["A", "K"], npn: ["C", "B", "E"], pnp: ["C", "B", "E"], nmos: ["D", "G", "S"], pmos: ["D", "G", "S"], vdmos: ["D", "G", "S"], njf: ["D", "G", "S"], pjf: ["D", "G", "S"] };
  const DEVICE_LINE = { d: "D1 A K", npn: "Q1 C B E", pnp: "Q1 C B E", nmos: "M1 D G S S", pmos: "M1 D G S S", vdmos: "M1 D G S", njf: "J1 D G S", pjf: "J1 D G S" };
  const DEVICE_NAME = { d: "diode", npn: "NPN transistor", pnp: "PNP transistor", nmos: "N-channel MOSFET", pmos: "P-channel MOSFET", vdmos: "power MOSFET", njf: "N-channel JFET", pjf: "P-channel JFET" };

  /** What a library offers as parts: its subcircuits, and its device models outside them */
  function list(text) {
    const lib = typeof text === "string" ? SM.parseLib(text) : text, out = [];
    lib.subckts.forEach(s => out.push({ name: s.name, kind: "subckt", pins: s.pins.slice(), hint: s.hint || "" }));
    Object.keys(lib.models).forEach(k => { const m = lib.models[k]; if (DEVICE_PINS[m.type]) out.push({ name: k, kind: m.type, pins: DEVICE_PINS[m.type].slice(), hint: DEVICE_NAME[m.type] }); });
    return out;
  }

  // constant folding of a closed tree
  const isN = t => t.k === "n";
  function evalClosed(t) {
    switch (t.k) {
      case "n": return t.v;
      case "u": { const x = evalClosed(t.x); return t.op === "-" ? -x : t.op === "!" ? (x ? 0 : 1) : x; }
      case "b": { const a = evalClosed(t.a), b = evalClosed(t.b); switch (t.op) { case "+": return a + b; case "-": return a - b; case "*": return a * b; case "/": return a / b; case "**": case "^": return Math.pow(a, b);
        case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0; case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0; case "==": return a === b ? 1 : 0; case "!=": case "<>": return a !== b ? 1 : 0; case "&&": return a && b ? 1 : 0; case "||": return a || b ? 1 : 0; } throw new Error(`operator ${t.op}`); }
      case "?": return evalClosed(t.c) ? evalClosed(t.a) : evalClosed(t.b);
      case "f": return SM.FUNCS[t.s](...t.args.map(evalClosed));
    }
    throw new Error("a value here cannot depend on voltages or currents");
  }
  // --- LAPLACE: a transfer function in s as a ratio of polynomials (coefficients from s^0 up) ---
  const S_VAR = { k: "s" };
  // a {…} or '…' group from position i (spaces before it skipped), or a bare expression up to a space
  // outside brackets: { text, end }
  function group(str, i) {
    while (i < str.length && /\s/.test(str[i])) i++;
    const open = str[i], close = { "{": "}", "'": "'" }[open];
    let depth = 0, j = i;
    if (close) {
      for (; j < str.length; j++) {
        if (str[j] === close && (open === "'" ? j > i : --depth === 0)) return { text: str.slice(i + 1, j), end: j + 1 };
        if (str[j] === open && open !== "'") depth++;
      }
      throw new Error(`${open} is not closed`);
    }
    for (; j < str.length; j++) { if (str[j] === "(" || str[j] === "{") depth++; else if (str[j] === ")" || str[j] === "}") depth--; else if (/\s/.test(str[j]) && depth <= 0) break; }
    return { text: str.slice(i, j), end: j };
  }
  const pAdd = (a, b) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] || 0) + (b[i] || 0));
  const pMul = (a, b) => { const r = new Array(a.length + b.length - 1).fill(0); a.forEach((x, i) => b.forEach((y, j) => { r[i + j] += x * y; })); return r; };
  const pTrim = a => { let n = a.length; while (n > 1 && a[n - 1] === 0) n--; return a.slice(0, n); };
  function rational(t) {
    switch (t.k) {
      case "n": return [[t.v], [1]];
      case "s": return [[0, 1], [1]];
      case "u": { const [n, d] = rational(t.x); return t.op === "-" ? [n.map(v => -v), d] : [n, d]; }
      case "b": {
        if (t.op === "^" || t.op === "**") {
          if (!isN(t.b) || !Number.isInteger(t.b.v) || Math.abs(t.b.v) > 12) throw new Error("LAPLACE: s may be raised only to a whole power");
          const [n, d] = rational(t.a); let rn = [1], rd = [1];
          for (let i = 0; i < Math.abs(t.b.v); i++) { rn = pMul(rn, n); rd = pMul(rd, d); }
          return t.b.v < 0 ? [rd, rn] : [rn, rd];
        }
        const [an, ad] = rational(t.a), [bn, bd] = rational(t.b);
        if (t.op === "+") return [pAdd(pMul(an, bd), pMul(bn, ad)), pMul(ad, bd)];
        if (t.op === "-") return [pAdd(pMul(an, bd), pMul(bn, ad).map(v => -v)), pMul(ad, bd)];
        if (t.op === "*") return [pMul(an, bn), pMul(ad, bd)];
        if (t.op === "/") return [pMul(an, bd), pMul(ad, bn)];
      }
    }
    throw new Error("LAPLACE: only a ratio of polynomials in s can be simulated (no delays or roots of s)");
  }
  // H(s) = N/D as controllable-canonical state space on the scale w0 (s = w0·p), so the states keep
  // sensible sizes however far the poles lie: { w0, a: D monic in p (a0 … a(n−1)), c: output weights of
  // the states, d: the direct share of the input }
  function laplaceState(num, den, ws = 1) {
    num = pTrim(num); den = pTrim(den);
    const n = den.length - 1, an = den[n];
    if (!an) throw new Error("LAPLACE: the denominator is zero");
    if (num.length - 1 > n) throw new Error("LAPLACE: the numerator's degree is above the denominator's (an ideal differentiator)");
    let w0 = 0;
    for (let k = 0; k < n; k++) if (den[k]) w0 = Math.max(w0, Math.pow(Math.abs(den[k] / an), 1 / (n - k)));
    if (!(w0 > 0) || !isFinite(w0)) w0 = 1;
    const a = den.slice(0, n).map((v, k) => v * Math.pow(w0, k - n) / an), b = Array.from({ length: n + 1 }, (_, k) => (num[k] || 0) * Math.pow(w0, k - n) / an);
    return { w0: w0 * ws, a, c: a.map((ak, k) => b[k] - ak * b[n]), d: b[n] };
  }
  // --- FREQ: a table of the response (Hz, complex values) fitted by a ratio of polynomials, Gustavsen's
  // vector fitting (deterministic: starting poles spread over the table's decades, ten relocations per
  // order), the order raised in pairs until the fit is within 0.05 dB and 0.5° or 16 is reached.
  // Returns { num, den, ws, order, dB, deg }: polynomials in p = s/ws ---
  const cx = { add: (a, b) => [a[0] + b[0], a[1] + b[1]], sub: (a, b) => [a[0] - b[0], a[1] - b[1]], mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
    div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; } };
  // least squares by Householder QR: A (rows × cols, row arrays), y → x
  function lsq(A, y) {
    const m = A.length, n = A[0].length, R = A.map(r => r.slice()), b = y.slice();
    // column scaling keeps the basis functions comparable
    const sc = Array.from({ length: n }, (_, j) => Math.sqrt(R.reduce((t, r) => t + r[j] * r[j], 0)) || 1);
    R.forEach(r => { for (let j = 0; j < n; j++) r[j] /= sc[j]; });
    for (let k = 0; k < n; k++) {
      let nr = 0; for (let i = k; i < m; i++) nr += R[i][k] * R[i][k];
      nr = Math.sqrt(nr); if (!nr) continue;
      const al = R[k][k] > 0 ? -nr : nr, v = new Float64Array(m); v[k] = R[k][k] - al; for (let i = k + 1; i < m; i++) v[i] = R[i][k];
      const vv = v.reduce((t, x) => t + x * x, 0); if (!vv) continue;
      for (let j = k; j < n; j++) { let d = 0; for (let i = k; i < m; i++) d += v[i] * R[i][j]; d *= 2 / vv; for (let i = k; i < m; i++) R[i][j] -= d * v[i]; }
      let d = 0; for (let i = k; i < m; i++) d += v[i] * b[i]; d *= 2 / vv; for (let i = k; i < m; i++) b[i] -= d * v[i];
    }
    const x = new Array(n).fill(0);
    for (let k = n - 1; k >= 0; k--) { let t = b[k]; for (let j = k + 1; j < n; j++) t -= R[k][j] * x[j]; x[k] = Math.abs(R[k][k]) > 1e-300 ? t / R[k][k] : 0; }
    return x.map((v, j) => v / sc[j]);
  }
  // the roots of a real polynomial (coefficients from p^0 up), Aberth's iteration from points on a circle
  function roots(c) {
    c = pTrim(c); const n = c.length - 1; if (n < 1) return [];
    const lead = c[n], a = c.map(v => v / lead), ev = z => { let p = [1, 0], d = [0, 0]; for (let k = n - 1; k >= 0; k--) { d = cx.add(cx.mul(d, z), p); p = cx.add(cx.mul(p, z), [a[k], 0]); } return [p, d]; };
    const R = 1 + Math.max(...a.slice(0, n).map(Math.abs));
    let z = Array.from({ length: n }, (_, k) => [0.5 * R * Math.cos(2 * Math.PI * k / n + 0.4), 0.5 * R * Math.sin(2 * Math.PI * k / n + 0.4)]);
    for (let it = 0; it < 500; it++) {
      let move = 0;
      z = z.map((zk, k) => {
        const [p, d] = ev(zk), ratio = cx.div(p, d);
        let sum = [0, 0]; z.forEach((zj, j) => { if (j !== k) sum = cx.add(sum, cx.div([1, 0], cx.sub(zk, zj))); });
        const w = cx.div(ratio, cx.sub([1, 0], cx.mul(ratio, sum))), nz = cx.sub(zk, w);
        move = Math.max(move, Math.hypot(w[0], w[1]) / (1 + Math.hypot(nz[0], nz[1])));
        return nz;
      });
      if (move < 1e-14) break;
    }
    return z;
  }
  // a set of poles (complex pairs kept together, each pair once with im > 0, real poles im 0) as the real basis of partial fractions at p
  function basis(poles, p) {
    const out = [];
    poles.forEach(a => {
      if (a[1] === 0) out.push(cx.div([1, 0], cx.sub(p, a)));
      else { const u = cx.div([1, 0], cx.sub(p, a)), v = cx.div([1, 0], cx.sub(p, [a[0], -a[1]])); out.push(cx.add(u, v), cx.mul([0, 1], cx.sub(u, v))); }
    });
    return out;
  }
  function polyOfPoles(poles) { let d = [1]; poles.forEach(a => { d = a[1] === 0 ? pMul(d, [-a[0], 1]) : pMul(d, [a[0] * a[0] + a[1] * a[1], -2 * a[0], 1]); }); return d; }
  function vectorFit(freqs, H) {
    const ws = 2 * Math.PI * Math.sqrt(freqs[0] * freqs[freqs.length - 1]), P = freqs.map(f => [0, 2 * Math.PI * f / ws]);
    const lo = Math.log10(2 * Math.PI * freqs[0] / ws), hi = Math.log10(2 * Math.PI * freqs[freqs.length - 1] / ws);
    const evalFit = (poles, r, d, p) => { const B = basis(poles, p); let v = [d, 0]; B.forEach((b, i) => { v = cx.add(v, [b[0] * r[i], b[1] * r[i]]); }); return v; };
    const err = (poles, r, d) => {
      let dB = 0, deg = 0;
      P.forEach((p, k) => {
        const v = evalFit(poles, r, d, p), m1 = Math.hypot(v[0], v[1]), m2 = Math.hypot(H[k][0], H[k][1]);
        dB = Math.max(dB, Math.abs(20 * Math.log10((m1 + 1e-300) / (m2 + 1e-300))));
        let ph = Math.abs(Math.atan2(v[1], v[0]) - Math.atan2(H[k][1], H[k][0])) * 180 / Math.PI % 360; if (ph > 180) ph = 360 - ph;
        if (m2 > 1e-6 * Math.max(...H.map(h => Math.hypot(h[0], h[1])))) deg = Math.max(deg, ph);
      });
      return [dB, deg];
    };
    // residues and d for fixed poles
    const residues = poles => {
      const A = [], y = [];
      P.forEach((p, k) => { const B = basis(poles, p); A.push([...B.map(b => b[0]), 1]); y.push(H[k][0]); A.push([...B.map(b => b[1]), 0]); y.push(H[k][1]); });
      const x = lsq(A, y); return { r: x.slice(0, -1), d: x[x.length - 1] };
    };
    let best = null;
    for (let N = 2; N <= 16; N += 2) {
      let poles = Array.from({ length: N / 2 }, (_, i) => { const b = Math.pow(10, N === 2 ? (lo + hi) / 2 : lo + (hi - lo) * i / (N / 2 - 1)); return [-b / 100, b]; });
      for (let it = 0; it < 10; it++) {
        // σ(p)·H ≈ Σ c·φ + d, σ = 1 + Σ c̃·φ: linear in c, d, c̃
        const A = [], y = [];
        P.forEach((p, k) => {
          const B = basis(poles, p), h = H[k], fB = B.map(b => cx.mul(h, b));
          A.push([...B.map(b => b[0]), 1, ...fB.map(b => -b[0])]); y.push(h[0]);
          A.push([...B.map(b => b[1]), 0, ...fB.map(b => -b[1])]); y.push(h[1]);
        });
        const x = lsq(A, y), nb = basis(poles, [0, 0]).length, ct = x.slice(nb + 1);
        // σ's zeros: the new poles. σ = (D + Σ c̃·numerators)/D over the old poles' polynomial D
        let num = polyOfPoles(poles), i = 0;
        poles.forEach((a, j) => {
          const rest = polyOfPoles(poles.filter((_, q) => q !== j));
          if (a[1] === 0) { num = pAdd(num, rest.map(v => v * ct[i])); i++; }
          else {
            // c1·(1/(p−a) + 1/(p−a*)) + c2·j(1/(p−a) − 1/(p−a*)) = (c1·(2p − 2α) − c2·2β)/((p−α)² + β²)
            num = pAdd(num, pMul(rest, [-2 * a[0] * ct[i] - 2 * a[1] * ct[i + 1], 2 * ct[i]])); i += 2;
          }
        });
        const z = roots(num).map(r => [-Math.abs(r[0]) || -1e-6, r[1]]);
        // keep one of each pair (im > 0) and the real ones
        const np = []; z.filter(r => Math.abs(r[1]) <= 1e-9 * (1 + Math.abs(r[0]))).forEach(r => np.push([r[0], 0]));
        z.filter(r => r[1] > 1e-9 * (1 + Math.abs(r[0]))).forEach(r => np.push(r));
        if (np.reduce((t, r) => t + (r[1] === 0 ? 1 : 2), 0) !== N) break;   // an odd split: keep the poles as they were
        poles = np;
      }
      const { r, d } = residues(poles), [dB, deg] = err(poles, r, d);
      if (!best || dB + deg / 10 < best.dB + best.deg / 10) best = { poles, r, d, dB, deg, N };
      if (dB <= 0.05 && deg <= 0.5) break;
    }
    // N/D: D the poles' polynomial, N = d·D + the residues over the rest
    const { poles, r, d } = best, den = polyOfPoles(poles);
    let num = den.map(v => v * d), i = 0;
    poles.forEach((a, j) => {
      const rest = polyOfPoles(poles.filter((_, q) => q !== j));
      if (a[1] === 0) { num = pAdd(num, rest.map(v => v * r[i])); i++; }
      else { num = pAdd(num, pMul(rest, [-2 * a[0] * r[i] - 2 * a[1] * r[i + 1], 2 * r[i]])); i += 2; }
    });
    return { num, den, ws, order: best.N, dB: best.dB, deg: best.deg };
  }
  const fold = t => {
    if (t.k === "u" && isN(t.x)) return { k: "n", v: evalClosed(t) };
    if (t.k === "b" && isN(t.a) && isN(t.b)) return { k: "n", v: evalClosed(t) };
    if (t.k === "f" && t.args.every(isN)) return { k: "n", v: evalClosed(t) };
    if (t.k === "?" && isN(t.c)) return t.c.v ? t.a : t.b;
    return t;
  };
  /** A parsed expression closed over a scope: ctx.v(a, b) and ctx.i(name) place its voltages and currents (absent: a constant) */
  function close(ast, scope, ctx, bound) {
    const C = t => close(t, scope, ctx, bound);
    switch (ast.k) {
      case "n": return ast;
      case "id":
        if (bound && ast.s in bound) return bound[ast.s];
        if (ast.s === "time") { if (!ctx) throw new Error("a value here cannot depend on time"); return { k: "t" }; }
        return { k: "n", v: scope.param(ast.s) };
      case "v": if (!ctx) throw new Error("a value here cannot depend on voltages"); return ctx.v(ast.a, ast.b);
      case "i": if (!ctx) throw new Error("a value here cannot depend on currents"); return ctx.i(ast.s);
      case "u": return fold({ k: "u", op: ast.op, x: C(ast.x) });
      case "b": return fold({ k: "b", op: ast.op, a: C(ast.a), b: C(ast.b) });
      case "?": return fold({ k: "?", c: C(ast.c), a: C(ast.a), b: C(ast.b) });
      case "f": {
        const user = scope.func(ast.s);
        if (user) {
          if (user.args.length !== ast.args.length) throw new Error(`${ast.s}() takes ${user.args.length} arguments`);
          const b2 = Object.assign({}, bound || {}); user.args.forEach((n, j) => { b2[n] = C(ast.args[j]); });
          return close(scope.funcAst(ast.s), scope, ctx, b2);
        }
        if (ast.s === "table") {                          // table(x, x1, y1, x2, y2, …)
          if (ast.args.length < 5 || ast.args.length % 2 === 0) throw new Error("table() needs a value and pairs of points");
          return { k: "tbl", x: C(ast.args[0]), pts: ast.args.slice(1).map(a => evalClosed(C(a))) };
        }
        if (/^(ddt|sdt|idt|delay|absdelay|laplace)$/.test(ast.s)) throw new Error(`${ast.s}() is not supported`);
        if (!SM.FUNCS[ast.s]) throw new Error(`unknown function ${ast.s}()`);
        return fold({ k: "f", s: ast.s, args: ast.args.map(C) });
      }
    }
    throw new Error("bad expression");
  }

  // POLY(n): the terms in SPICE's order (a constant, each input, then the products by degree)
  function polyAst(inputs, coefs) {
    const n = inputs.length, mul = (a, b) => ({ k: "b", op: "*", a, b }), terms = [];
    let cur = [[]];                                                   // index lists of one degree, non-decreasing
    let sum = null, k = 0;
    const add = t => { sum = sum ? { k: "b", op: "+", a: sum, b: t } : t; };
    while (k < coefs.length) {
      for (const idx of cur) {
        if (k >= coefs.length) break;
        const c = coefs[k++]; if (c === 0) continue;
        let t = { k: "n", v: c }; idx.forEach(i => { t = mul(t, inputs[i]); });
        add(t); terms.push(idx);
      }
      const next = []; cur.forEach(idx => { for (let i = idx.length ? idx[idx.length - 1] : 0; i < n; i++) next.push(idx.concat(i)); });
      cur = next;
      if (cur.length && cur[0].length > 8) break;
    }
    return sum || { k: "n", v: 0 };
  }

  /**
   * One part of a library on local nodes: { name, pins, kind, nNodes, els, warnings }.
   * Node 0 is ground, 1 … pins.length the pins, the rest inside. An element:
   * { name, kind, n: [nodes], … } as the engine takes it (nodes instead of n, an id from the name).
   */
  function flatten(text, name, overrides) {
    const lib = typeof text === "string" ? SM.parseLib(text) : text;
    const want = String(name || "").toLowerCase();
    let top = want ? lib.subckts.find(s => s.name.toLowerCase() === want) : lib.subckts[0];
    let kind = "subckt";
    if (!top) {
      // a device model on its own: a part with that device's pins
      const mk = want && lib.models[want] ? want : !want ? Object.keys(lib.models).find(k => DEVICE_PINS[lib.models[k].type]) : null, m = mk && lib.models[mk];
      if (!m || !DEVICE_PINS[m.type]) throw new Error(want ? `no .SUBCKT or .MODEL ${name}` : "no .SUBCKT or device .MODEL in the text");
      kind = m.type;
      top = { name: mk, pins: DEVICE_PINS[m.type].map(p => p.toLowerCase()), params: {}, paramOrder: [], funcs: {}, models: {}, els: [{ s: `${DEVICE_LINE[m.type]} ${mk}`, no: 0 }], hint: "" };
    }
    const els = [], warn = new Set(), couplings = [];
    let topMap = null;
    let nNodes = 1 + top.pins.length;
    const used = new Set();
    const uniq = nm => { let k = nm, i = 2; while (used.has(k)) k = nm + "_" + i++; used.add(k); return k; };
    const push = e => { e.name = uniq(e.name); els.push(e); return e; };

    function expand(sub, pinNodes, scope, prefix, depth) {
      if (depth > 12) throw new Error(`subcircuits nested too deep (${sub.name})`);
      const map = new Map(); sub.pins.forEach((p, i) => map.set(p, pinNodes[i]));
      const node = raw => {
        const nm = String(raw).toLowerCase().replace(/^\(|[),]+$/g, "");
        if (map.has(nm)) return map.get(nm);
        if (nm === "0" || nm === "gnd") return 0;
        const k = nNodes++; map.set(nm, k); return k;
      };
      if (!depth) topMap = map;
      const at = no => (no ? `line ${no}: ` : "");
      const val = (src, no) => {
        try {
          const s = SM.unbrace(String(src).trim()), n = SM.num(s);
          if (!isNaN(n) && !/^[a-z_]/i.test(s)) return n;
          return evalClosed(close(SM.parseExpr(s), scope, null));
        } catch (e) { throw new Error(`${at(no)}${e.message}`); }
      };
      // SIN, PULSE, EXP, SFFM and PWL of a V or I line (with or without the brackets; PWL's r= and
      // td=): the engine's time waveform, or null (a DC source, or a kind it does not have: a warning)
      const srcWave = (text, no) => {
        const m = /(?:^|\s)(sin|pulse|pwl|exp|sffm)(\s*\(([^)]*)\)|((?:\s+[^\s=()]+)*))/i.exec(text);
        if (!m) { if (/(?:^|\s)(am|trnoise|trrandom)\b/i.test(text)) warn.add("An AM or noise source inside the model is taken at its DC value"); return null; }
        const type = m[1].toLowerCase(), raw = (m[3] !== undefined ? m[3] : m[4] || "").trim();
        if (/^file\b/i.test(raw) || /file=/i.test(raw)) throw new Error(`${at(no)}PWL from a file is not supported: list the points`);
        const a = raw ? raw.split(/[\s,]+/).filter(Boolean).map(t => val(t, no)) : [], g = (i, d) => (a[i] !== undefined ? a[i] : d);
        const kw = {}; text.slice(m.index + m[0].length).replace(/\s*=\s*/g, "=").split(/\s+/).forEach(t => { const i = t.indexOf("="); if (i > 0) kw[t.slice(0, i).toLowerCase()] = val(t.slice(i + 1), no); });
        switch (type) {
          case "sin": return { type, vo: g(0, 0), va: g(1, 0), freq: g(2, 0), td: g(3, 0), theta: g(4, 0), phase: g(5, 0) };
          case "pulse": return { type, v1: g(0, 0), v2: g(1, 0), td: g(2, 0), tr: g(3, 0), tf: g(4, 0), pw: g(5, 0), per: g(6, 0) };
          case "exp": { const td1 = g(2, 0); return { type, v1: g(0, 0), v2: g(1, 0), td1, tau1: g(3, 0), td2: g(4, undefined), tau2: g(5, 0) }; }
          case "sffm": return { type, vo: g(0, 0), va: g(1, 0), fc: g(2, 0), mdi: g(3, 0), fs: g(4, 0) };
          case "pwl": {
            if (a.length < 2 || a.length % 2) throw new Error(`${at(no)}PWL needs pairs of time and value`);
            const td = kw.td || 0, pts = a.map((v, i) => (i % 2 ? v : v + td));
            for (let i = 2; i < pts.length; i += 2) if (!(pts[i] >= pts[i - 2])) throw new Error(`${at(no)}PWL times must not go back`);
            return { type, pts, r: kw.r !== undefined ? kw.r + td : -1 };
          }
        }
        return null;
      };
      const model = (nm, no) => { const m = scope.model(String(nm || "").toLowerCase()); if (!m) throw new Error(`${at(no)}no .MODEL ${nm}`); return m; };
      // a model's parameter (the first of the names it has), or the default
      const mp = (m, names, def, no) => { for (const k of names.split("|")) if (m.p[k] !== undefined) return val(m.p[k], no); return def; };
      // a behavioural source's expression, closed on that element's own nodes
      const behave = (el, src, no) => {
        const ctx = {
          v: (a, b) => { const ia = slot(el, node(a)), ib = slot(el, node(b)); return { k: "v", a: ia, b: ib }; },
          i: nm => { const id = prefix + nm; let k = el.ctl.indexOf(id); if (k < 0) { el.ctl.push(id); k = el.ctl.length - 1; } return { k: "i", n: k }; }
        };
        try { el.ast = typeof src === "function" ? src(ctx) : close(SM.parseExpr(SM.unbrace(src)), scope, ctx); } catch (e) { throw new Error(`${at(no)}${e.message}`); }
        return el;
      };
      const slot = (el, k) => { let i = el.n.indexOf(k, 2); if (i < 0) { el.n.push(k); i = el.n.length - 1; } return i; };
      const bsrc = (nm, a, b, out) => ({ name: prefix + nm, kind: "B", n: [a, b], out, ctl: [] });
      // a LAPLACE source: its input (an expression, or a function of ctx) on a node of its own, the
      // transfer function's states on capacitors of 1/w0 driven by linear transconductances, and
      // the output (a voltage between a and b, or a current from a to b) a weighted sum of them
      const laplace = (nm, a, b, out, input, htext, no) => {
        let st;
        try { st = typeof htext === "object" ? laplaceState(htext.num, htext.den, htext.ws) : laplaceState(...rational(close(SM.parseExpr(SM.unbrace(htext)), scope, null, { s: S_VAR }))); } catch (e) { throw new Error(`${at(no)}${nm}: ${e.message}`); }
        const u = nNodes++, n = st.a.length, x = Array.from({ length: n }, () => nNodes++);
        push(behave({ name: prefix + nm + "#in", kind: "B", n: [u, 0], out: "v", ctl: [] }, typeof input === "function" ? input : SM.unbrace(input), no));
        x.forEach((k, i) => {
          push({ name: prefix + nm + "#c" + i, kind: "C", n: [k, 0], c: 1 / st.w0 }, { name: prefix + nm + "#g" + i, kind: "R", n: [k, 0], r: 1e12 });
          if (i < n - 1) push({ name: prefix + nm + "#x" + i, kind: "G", n: [0, k, x[i + 1], 0], gm: 1 });
        });
        if (n) {
          const last = x[n - 1];
          push({ name: prefix + nm + "#u", kind: "G", n: [0, last, u, 0], gm: 1 });
          st.a.forEach((ak, i) => { if (ak) push({ name: prefix + nm + "#a" + i, kind: "G", n: [0, last, x[i], 0], gm: -ak }); });
        }
        const N = v => ({ k: "n", v }), B = (op, p, q) => ({ k: "b", op, a: p, b: q });
        const el = bsrc(nm, a, b, out);
        const V = k => ({ k: "v", a: slot(el, k), b: slot(el, 0) });
        let e = B("*", N(st.d), V(u));
        st.c.forEach((ci, i) => { if (ci) e = B("+", e, B("*", N(ci), V(x[i]))); });
        el.ast = e;
        push(el);
      };
      const areaOf = (t, no) => (t && !t.includes("=") && !/^(on|off)$/i.test(t) ? val(t, no) : 1);
      const params = tk => { const p = {}; tk.forEach(t => { const i = t.indexOf("="); if (i > 0) p[t.slice(0, i).toLowerCase()] = SM.unbrace(t.slice(i + 1)); }); return p; };

      sub.els.forEach(({ s, no }) => {
        const tk = SM.tokens(s), kind = s[0].toUpperCase(), nm = tk[0].toLowerCase();
        // an expression that runs to the end of the line, less the instance parameters after it (Rpar=1 tripdt=…)
        const cut = e => e.replace(/\s+[a-z_]\w*=(?!=)[\s\S]*$/i, "");
        const sn = s.replace(/\s*=\s*/g, "="), after = re => { const m = re.exec(sn); return m ? sn.slice(m.index + m[0].length).trim() : null; };
        const need = n => { if (tk.length < n) throw new Error(`${at(no)}${tk[0]} is not complete`); };
        if (kind === "R" || kind === "C" || kind === "L") {
          need(4);
          if (/\b[qQ]=|\bflux=/i.test(sn)) throw new Error(`${at(no)}${tk[0]}: a charge or flux expression is not supported`);
          let src = tk[3].replace(/^[rcl]=/i, ""), k = 1;
          const m0 = scope.model(src.toLowerCase());
          if (m0 && tk[4]) { src = tk[4]; k = mp(m0, kind === "R" ? "r" : kind === "C" ? "c" : "l", 1, no); }   // PSpice: a model, then the value
          const ip = params(tk.slice(4)), pv = key => (ip[key] !== undefined ? val(ip[key], no) : 0);
          let a = node(tk[1]);
          const v = val(src, no) * k, b = node(tk[2]);
          if (a === b) return;
          if (kind !== "R") {
            // LTspice: a resistance in parallel, and one in series
            if (pv("rpar") > 0) push({ name: prefix + nm + "#rpar", kind: "R", n: [a, b], r: pv("rpar") });
            if (pv("rser") > 0) a = series(prefix + nm + "#rser", a, pv("rser"));
          }
          if (kind === "R") {
            if (v < 0) push({ name: prefix + nm, kind: "G", n: [a, b, a, b], gm: 1 / v });       // a negative resistance
            else push({ name: prefix + nm, kind: "R", n: [a, b], r: Math.max(v, 1e-6) });
          } else if (kind === "C") { if (v > 0) push({ name: prefix + nm, kind: "C", n: [a, b], c: v }); }
          else push({ name: prefix + nm, kind: "L", n: [a, b], l: Math.max(v, 1e-15) });
        } else if (kind === "K") {
          need(4);
          couplings.push({ ls: tk.slice(1, -1).map(t => prefix + t.toLowerCase()), k: val(tk[tk.length - 1], no), no });
        } else if (kind === "V" || kind === "I") {
          need(3);
          const rest = tk.slice(3).filter(t => !/^dc$/i.test(t)).map(t => t.replace(/^dc=/i, "")), first = rest[0];   // (DC=62.66U as well as DC 62.66U)
          const dcGiven = first && !/^(ac|sin|pulse|pwl|exp|sffm|am|trnoise|trrandom|rser=|cpar=)/i.test(first);
          // a time waveform (the transient's; the operating point takes the DC value, else its value at 0)
          const tw = srcWave(tk.slice(3).join(" "), no);
          const v = dcGiven ? val(first, no) : tw && root.TubeSimEngine ? root.TubeSimEngine.srcAt(tw, 0) : 0;
          const el = kind === "V" ? { name: prefix + nm, kind: "V", n: [node(tk[1]), node(tk[2])], v } : { name: prefix + nm, kind: "I", n: [node(tk[1]), node(tk[2])], i: v };
          if (tw) { el.tw = tw; warn.add("A signal source inside the model plays its waveform in the Transient tab; the other analyses take its DC value"); }
          push(el);
        } else if (kind === "D") {
          need(4);
          const m = model(tk[3], no), area = areaOf(tk[4], no);
          if (m.type !== "d") throw new Error(`${at(no)}${tk[3]} is not a diode model`);
          diode(prefix + nm, node(tk[1]), node(tk[2]), m, area, no);
        } else if (kind === "Q") {
          need(5);
          const mi = [4, 5].find(i => tk[i] && scope.model(tk[i].toLowerCase())); if (!mi) throw new Error(`${at(no)}no .MODEL for ${tk[0]}`);
          const m = model(tk[mi], no), area = areaOf(tk[mi + 1], no);
          if (m.type !== "npn" && m.type !== "pnp") throw new Error(`${at(no)}${tk[mi]} is not a transistor model`);
          bjt(prefix + nm, node(tk[1]), node(tk[2]), node(tk[3]), m, area, no);
        } else if (kind === "M") {
          need(5);
          const mi = [4, 5].find(i => tk[i] && scope.model(tk[i].toLowerCase())); if (!mi) throw new Error(`${at(no)}no .MODEL for ${tk[0]}`);
          mos(prefix + nm, node(tk[1]), node(tk[2]), node(tk[3]), model(tk[mi], no), params(tk.slice(mi + 1)), no, mi === 5 ? node(tk[4]) : null);
        } else if (kind === "J") {
          need(5);
          const m = model(tk[4], no), area = areaOf(tk[5], no);
          if (m.type !== "njf" && m.type !== "pjf") throw new Error(`${at(no)}${tk[4]} is not a JFET model`);
          jfet(prefix + nm, node(tk[1]), node(tk[2]), node(tk[3]), m, area, no);
        } else if (kind === "E" || kind === "G" || kind === "F" || kind === "H") {
          need(4);
          const a = node(tk[1]), b = node(tk[2]), out = kind === "E" || kind === "H" ? "v" : "i", byI = kind === "F" || kind === "H";
          const lap = /\bCHEBYSHEV\b/i.exec(s);
          if (lap) throw new Error(`${at(no)}${tk[0]}: CHEBYSHEV sources are not supported`);
          const fq = /\bfreq\s*(?=[{'])/i.exec(sn);
          if (fq && !byI) {
            // PSpice: E a b FREQ {in} = [MAG|DB] [DEG|RAD] [R_I] (f, a, b) … [DELAY=t]: the table fitted by a ratio
            // of polynomials (vectorFit), then run as a LAPLACE source
            const g1 = group(sn, fq.index + fq[0].length), rest = sn.slice(g1.end).replace(/^\s*=?\s*/, "");
            const dl = /\bdelay=(\S+)/i.exec(rest);
            if (dl && val(dl[1], no) !== 0) throw new Error(`${at(no)}${tk[0]}: a FREQ table's DELAY is not supported`);
            const words = (rest.match(/^[^(]*/) || [""])[0].toLowerCase(), ri = /\br_i\b/.test(words), mag = /\bmag\b/.test(words), rad = /\brad\b/.test(words);
            const nums = (rest.replace(/\bdelay=\S+/i, "").slice(words.length).match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:meg|[tgkmunpf])?/gi) || []).map(SM.num);
            if (nums.length < 6 || nums.length % 3) throw new Error(`${at(no)}${tk[0]}: the FREQ table's points are not understood`);
            const fs = [], H = [];
            for (let i = 0; i < nums.length; i += 3) {
              const f = nums[i], x = nums[i + 1], y = nums[i + 2];
              if (!(f > 0)) continue;   // a point at 0 Hz: the fit's own value there stands
              if (fs.length && !(f > fs[fs.length - 1])) throw new Error(`${at(no)}${tk[0]}: the FREQ table's frequencies must run upwards`);
              const m = ri ? null : mag ? x : Math.pow(10, x / 20), ph = ri ? 0 : rad ? y : y * Math.PI / 180;
              fs.push(f); H.push(ri ? [x, y] : [m * Math.cos(ph), m * Math.sin(ph)]);
            }
            if (fs.length < 3) throw new Error(`${at(no)}${tk[0]}: a FREQ table needs at least three points above 0 Hz`);
            const fit = vectorFit(fs, H);
            warn.add(`${tk[0]}: its FREQ table is run as a fitted transfer function of order ${fit.order} (within ${fit.dB < 0.01 ? "0.01" : fit.dB.toFixed(2)} dB and ${fit.deg < 0.1 ? "0.1" : fit.deg.toFixed(1)}° of the table)`);
            laplace(nm, a, b, out, g1.text, { num: fit.num, den: fit.den, ws: fit.ws }, no);
            return;
          }
          if (/\blaplace\b/i.test(sn) && !byI) {
            // PSpice: E a b LAPLACE {in} = {H(s)}; LTspice: E a b c d Laplace=H(s)
            const ps = /\blaplace\s*(?=[{'])/i.exec(sn);
            if (ps) { const g1 = group(sn, ps.index + ps[0].length), eq = sn.slice(g1.end).replace(/^\s*=?\s*/, ""); laplace(nm, a, b, out, g1.text, group(eq, 0).text, no); }
            else { need(5); laplace(nm, a, b, out, ctx => ctx.v(tk[3], tk[4]), group(sn, /\blaplace=/i.exec(sn).index + 8).text, no); }
            return;
          }
          const vE = after(/\b(?:VALUE|VOL|CUR)\s*=?\s*(?=[{'(\w-])/i), tb = /\bTABLE\s*=?\s*(\{[^}]*\}|'[^']*')?\s*=?\s*([\s\S]*)$/i.exec(sn), pm = /\bPOLY\s*\(\s*(\d+)\s*\)/i.exec(s);
          if (tb) {
            // TABLE {expr} = (x, y) (x, y) …; LTspice: E a b c d table = (x, y, …)
            const pts = (tb[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:meg|[tgkmunpf])?/gi) || []).map(SM.num);
            if (pts.length < 4 || pts.length % 2) throw new Error(`${at(no)}${tk[0]}: the table's points are not understood`);
            for (let i = 2; i < pts.length; i += 2) if (!(pts[i] > pts[i - 2])) throw new Error(`${at(no)}${tk[0]}: the table's points must run upwards`);
            const el = bsrc(nm, a, b, out);
            if (tb[1]) behave(el, ctx => ({ k: "tbl", x: close(SM.parseExpr(SM.unbrace(tb[1])), scope, ctx), pts }), no);
            else { need(5); behave(el, ctx => ({ k: "tbl", x: ctx.v(tk[3], tk[4]), pts }), no); }
            push(el);
          } else if (pm) {
            const n = +pm[1], list = sn.slice(pm.index + pm[0].length).replace(/[(),]/g, " ").trim().split(/\s+/).filter(Boolean), el = bsrc(nm, a, b, out);
            const nIn = byI ? n : 2 * n; if (list.length < nIn + 1) throw new Error(`${at(no)}${tk[0]}: POLY(${n}) is not complete`);
            const coefs = list.slice(nIn).filter(t => !t.includes("=")).map(t => val(t, no));
            behave(el, ctx => polyAst(Array.from({ length: n }, (_, i) => (byI ? ctx.i(list[i].toLowerCase()) : ctx.v(list[2 * i], list[2 * i + 1]))), coefs), no);
            push(el);
          } else if (vE !== null) push(behave(bsrc(nm, a, b, out), cut(vE), no));
          else if (byI) {
            need(5);
            const gain = val(tk[4], no), src = tk[3].toLowerCase();
            push(behave(bsrc(nm, a, b, out), ctx => ({ k: "b", op: "*", a: { k: "n", v: gain }, b: ctx.i(src) }), no));
          } else {
            // linear: E a b c d gain, or with the control nodes in brackets
            const list = sn.replace(/[(),]/g, " ").trim().split(/\s+/);
            if (list.length < 6) {
              if (tk[3] && /^[{']/.test(tk[3])) { push(behave(bsrc(nm, a, b, out), tk.slice(3).join(" "), no)); return; }
              throw new Error(`${at(no)}${tk[0]} is not understood`);
            }
            const c = node(list[3]), d = node(list[4]), gain = val(list[5], no);
            push(kind === "E" ? { name: prefix + nm, kind: "E", n: [a, b, c, d], gain } : { name: prefix + nm, kind: "G", n: [a, b, c, d], gm: gain });
          }
        } else if (kind === "B") {
          need(4);
          const iE = after(/\bI\s*=/i), vE = after(/\bV\s*=/i), a = node(tk[1]), b = node(tk[2]);
          const lp = /\blaplace=/i.exec(sn);
          if (lp) {
            // LTspice: B a b V=expr Laplace=H(s) (or I=): the expression filtered by H
            const ex = iE !== null && (vE === null || sn.search(/\bI\s*=/i) < sn.search(/\bV\s*=/i)) ? iE : vE;
            if (ex === null) throw new Error(`${at(no)}${tk[0]} needs I= or V=`);
            laplace(nm, a, b, ex === iE ? "i" : "v", group(ex, 0).text, group(sn, lp.index + lp[0].length).text, no);
            return;
          }
          if (iE !== null && (vE === null || sn.search(/\bI\s*=/i) < sn.search(/\bV\s*=/i))) push(behave(bsrc(nm, a, b, "i"), cut(iE), no));
          else if (vE !== null) push(behave(bsrc(nm, a, b, "v"), cut(vE), no));
          else throw new Error(`${at(no)}${tk[0]} needs I= or V=`);
        } else if (kind === "S" || kind === "W") {
          // a switch: its conductance runs smoothly (on a logarithmic scale) from off to on across its thresholds
          const sw = sn.replace(/[(),]/g, " ").trim().split(/\s+/);
          if (sw.length < (kind === "S" ? 6 : 5)) throw new Error(`${at(no)}${tk[0]} is not complete`);
          const a = node(sw[1]), b = node(sw[2]), m = model(sw[kind === "S" ? 5 : 4], no), W = kind === "W";
          const ron = mp(m, "ron", 1, no), roff = mp(m, "roff", 1e6, no);
          let on = mp(m, W ? "ion" : "von", NaN, no), off = mp(m, W ? "ioff" : "voff", NaN, no);
          if (isNaN(on) || isNaN(off)) { const t = mp(m, W ? "it" : "vt", 0, no), h = Math.max(Math.abs(mp(m, W ? "ih" : "vh", 0, no)), W ? 1e-6 : 1e-3); on = t + h; off = t - h; }
          if (on === off) on = off + (W ? 1e-6 : 1e-3);
          const el = bsrc(nm, a, b, "i");
          behave(el, ctx => {
            const c = W ? ctx.i(sw[3].toLowerCase()) : ctx.v(sw[3], sw[4]), N = v => ({ k: "n", v }), B = (op, x, y) => ({ k: "b", op, a: x, b: y }), F = (f, ...args) => ({ k: "f", s: f, args });
            const u = F("limit", B("/", B("-", c, N(off)), N(on - off)), N(0), N(1)), sm = B("*", B("*", u, u), B("-", N(3), B("*", N(2), u)));   // smoothstep
            const lg = B("+", N(Math.log(1 / roff)), B("*", N(Math.log(roff / ron)), sm));
            return B("*", ctx.v(sw[1], sw[2]), F("exp", lg));
          }, no);
          push(el);
        } else if (kind === "X") {
          const eq = tk.findIndex(t => t.includes("=") || /^params:?$/i.test(t)), head = eq < 0 ? tk : tk.slice(0, eq), sname = head[head.length - 1];
          const child = lib.subckts.find(c => c.name.toLowerCase() === String(sname).toLowerCase());
          if (!child) throw new Error(`${at(no)}no .SUBCKT ${sname} (${tk[0]}): paste the file that has it too`);
          const nodes = head.slice(1, -1).map(node);
          if (nodes.length !== child.pins.length) throw new Error(`${at(no)}${tk[0]}: ${sname} has ${child.pins.length} pins, ${nodes.length} given`);
          const over = {}, raw = eq < 0 ? {} : params(tk.slice(eq));
          Object.keys(raw).forEach(k => { over[k] = String(val(raw[k], no)); });
          expand(child, nodes, SM.makeScope(lib, child, over), prefix + nm + ".", depth + 1);
        } else if (kind === "T") {
          // a lossless transmission line: T a1 b1 a2 b2 Z0= TD= (or F= [NL=], NL defaulting to a quarter
          // wave); PSpice's own form by its per-length L and C and LEN (R and G zero) too
          if (tk.length < 5) throw new Error(`${at(no)}${tk[0]} is not complete`);
          const p = params(tk.slice(5)), pv = (k, d) => (p[k] !== undefined ? val(p[k], no) : d);
          if (pv("r", 0) || pv("g", 0)) throw new Error(`${at(no)}${tk[0]}: a lossy line (R or G) is not supported, only the lossless one`);
          let z0 = pv("z0", NaN), td = pv("td", NaN);
          if (isNaN(z0) && p.zo !== undefined) z0 = pv("zo", NaN);
          if (isNaN(z0) && p.l !== undefined && p.c !== undefined) { const L = pv("l", 0), C = pv("c", 0), len = pv("len", 1); z0 = Math.sqrt(L / C); td = len * Math.sqrt(L * C); }
          if (isNaN(td) && p.f !== undefined) td = pv("nl", 0.25) / pv("f", 0);
          if (!(z0 > 0) || !(td > 0) || !isFinite(td)) throw new Error(`${at(no)}${tk[0]} needs Z0= and TD= (or F=)`);
          push({ name: prefix + nm, kind: "TLINE", n: [node(tk[1]), node(tk[2]), node(tk[3]), node(tk[4])], z0, td });
        } else if (kind === "O" || kind === "U") throw new Error(`${at(no)}lossy transmission lines (${tk[0]}) are not supported`);
        else if (kind === "A") throw new Error(`${at(no)}LTspice's special devices (${tk[0]}) are not supported`);
        else throw new Error(`${at(no)}element ${tk[0]} is not supported`);
      });

      // --- devices ---------------------------------------------------------------
      function series(nm, a, r) { if (!(r > 0)) return a; const k = nNodes++; push({ name: nm, kind: "R", n: [a, k], r }); return k; }
      // a capacitor; a junction's (p side first) with its law: c is the zero-bias value, the engine
      // takes it at the voltage across it (junc: { vj, m, fc })
      function cap(nm, a, b, c, junc) { if (c > 0 && a !== b) push(junc ? { name: nm, kind: "C", n: [a, b], c, junc } : { name: nm, kind: "C", n: [a, b], c }); }
      function junc(m, vj, mj, no, dvj, dm) { return { vj: mp(m, vj, dvj, no), m: mp(m, mj, dm, no), fc: mp(m, "fc", 0.5, no) }; }
      function diode(nm, a, k, m, area, no) {
        const is = mp(m, "is|js", 1e-14, no) * area, n = mp(m, "n", 1, no), rs = mp(m, "rs", 0, no) / area, bv = mp(m, "bv|vb|vrb", 0, no);
        const a2 = series(nm + "#rs", a, rs);
        push({ name: nm, kind: "D", n: [a2, k], is, n_: n, tt: mp(m, "tt", 0, no) || undefined });
        cap(nm + "#cj", a2, k, mp(m, "cjo|cj0|cj", 0, no) * area, junc(m, "vj|pb", "m|mj", no, 1, 0.5));
        if (bv > 0 && isFinite(bv)) {
          // reverse breakdown: a junction in series with a source, conducting IBV at BV
          const ibv = mp(m, "ibv", 1e-3, no) * area, mid = nNodes++, isb = 1e-14, nbv = mp(m, "nbv", 1, no);
          push({ name: nm + "#bd", kind: "D", n: [k, mid], is: isb, n_: nbv });
          push({ name: nm + "#bv", kind: "V", n: [mid, a2], v: bv - nbv * VT * Math.log(Math.max(ibv, 1e-12) / isb + 1) });
        }
      }
      function bjt(nm, c, b, e, m, area, no) {
        const pol = m.type === "npn" ? 1 : -1, inf = v => (v > 0 && isFinite(v) ? v : undefined);
        const mdl = { pol, is: mp(m, "is", 1e-16, no) * area, bf: mp(m, "bf", 100, no), br: mp(m, "br", 1, no), nf: mp(m, "nf", 1, no), nr: mp(m, "nr", 1, no),
          vaf: inf(mp(m, "vaf|va", 0, no)) || 1e9, var: inf(mp(m, "var|vb", 0, no)), ikf: (inf(mp(m, "ikf|ik|jbf", 0, no)) || 0) * area || undefined,
          ise: mp(m, "ise|c2", 0, no) * area || undefined, ne: mp(m, "ne", 1.5, no), isc: mp(m, "isc|c4", 0, no) * area || undefined, nc: mp(m, "nc", 2, no) };
        Object.keys(mdl).forEach(k => { if (mdl[k] === undefined) delete mdl[k]; });
        const rb = mp(m, "rb", 0, no) / area, re = mp(m, "re", 0, no) / area, rc = mp(m, "rc", 0, no) / area;
        const c2 = series(nm + "#rc", c, rc), b2 = series(nm + "#rb", b, rb), e2 = series(nm + "#re", e, re);
        // the temperature terms, for a part run at another temperature or heating itself (build's
        // spec.temp, spec.therm): TNOM on the engine's scale (its 25 °C is SPICE's nominal 27 °C)
        const tnom = mp(m, "tnom", 27, no), tdata = { xti: mp(m, "xti", 3, no), eg: mp(m, "eg", 1.11, no), xtb: mp(m, "xtb", 0, no), tnom: +((tnom + 273.15) * 298.15 / 300.15 - 273.15).toFixed(4) };
        const el = { name: nm, kind: "BJT", n: [c2, b2, e2], model: mdl, tdata }, tf = mp(m, "tf", 0, no);
        if (tf > 0) el.tf = tf;
        const tr = mp(m, "tr", 0, no); if (tr > 0) el.tr = tr;
        if (rb > 0 || re > 0 || rc > 0) el.ext = [c, b, e];
        push(el);
        const cje = mp(m, "cje", 0, no) * area, cjc = mp(m, "cjc", 0, no) * area;
        const je = junc(m, "vje|pe", "mje|me", no, 0.75, 0.33), jc = junc(m, "vjc|pc", "mjc|mc", no, 0.75, 0.33);
        if (pol > 0) { cap(nm + "#cje", b2, e2, cje, je); cap(nm + "#cjc", b2, c2, cjc, jc); } else { cap(nm + "#cje", e2, b2, cje, je); cap(nm + "#cjc", c2, b2, cjc, jc); }
      }
      function mos(nm, d, g, s, m, ip, no, b) {
        const vd = m.type === "vdmos";
        if (m.type !== "nmos" && m.type !== "pmos" && !vd) throw new Error(`${at(no)}${nm}: not a MOSFET model`);
        const pol = vd ? (m.p.pchan ? -1 : 1) : m.type === "nmos" ? 1 : -1, level = vd ? 1 : mp(m, "level", 1, no);
        if (level > 3) throw new Error(`${at(no)}${nm}: MOSFET model level ${level} (BSIM) is not supported`);
        const ipv = (k, def) => (ip[k] !== undefined ? val(ip[k], no) : def);
        const mult = ipv("m", 1), w = ipv("w", mp(m, "w", 1e-4, no)), l = ipv("l", mp(m, "l", 1e-4, no));
        const d2 = series(nm + "#rd", d, mp(m, "rd", 0, no) / mult), s2 = series(nm + "#rs", s, mp(m, "rs", 0, no) / mult), g2 = series(nm + "#rg", g, mp(m, "rg", 0, no));
        if (vd) {
          const kp = mp(m, "kp", 2e-5, no) * mult, vto = mp(m, "vto|vt0", 0, no);
          push({ name: nm, kind: "MOS", n: [d2, g2, s2], model: { pol, vto, kp, lambda: mp(m, "lambda", 0, no), s: FET_S } });
          // the body diode and the capacitances of LTspice's VDMOS
          const is = mp(m, "is", 1e-14, no), bd = series(nm + "#rb", pol > 0 ? s2 : d2, mp(m, "rb", 0, no));
          push({ name: nm + "#body", kind: "D", n: pol > 0 ? [bd, d2] : [bd, s2], is, n_: mp(m, "n", 1, no), tt: mp(m, "tt", 0, no) || undefined });
          // Cgd follows VDMOS's law in vgd (CGDMIN … CGDMAX, A), the drain-source C the body diode's junction law
          cap(nm + "#cgs", g2, s2, mp(m, "cgs", 0, no));
          const cmin = mp(m, "cgdmin", 0, no), cmax = m.p.cgdmax !== undefined ? mp(m, "cgdmax", 0, no) : undefined;
          if (cmax !== undefined && cmax > 0 && g2 !== d2) push({ name: nm + "#cgd", kind: "C", n: pol > 0 ? [g2, d2] : [d2, g2], c: cmin, vdm: { min: cmin, max: cmax, a: mp(m, "a", 1, no) } });
          else cap(nm + "#cgd", g2, d2, cmin);
          cap(nm + "#cds", pol > 0 ? s2 : d2, pol > 0 ? d2 : s2, mp(m, "cjo", 0, no), junc(m, "vj", "m", no, 1, 0.5));
          return;
        }
        // SPICE's MOSFET levels 1 to 3 (ngspice's mos1/2/3temp.c setup at the nominal temperature):
        // the channel by its level's equations with the bulk as a fourth terminal (the source when
        // the line names none), the bulk junctions as diodes, Meyer's gate capacitances from TOX
        const bulk = b === null || b === undefined ? s : b, P = mosSetup(m, level, pol, w, l, mult, no, mp);
        push({ name: nm, kind: "MOS4", n: [d2, g2, s2, bulk], model: { pol, level, p: P } });
        const ad = ipv("ad", 0), as = ipv("as", 0), pd = ipv("pd", 0), ps = ipv("ps", 0), js = mp(m, "js", 0, no);
        const isj = mp(m, "is", 1e-14, no) * mult, isd = js > 0 && ad > 0 && as > 0 ? js * ad * mult : isj, iss = js > 0 && ad > 0 && as > 0 ? js * as * mult : isj;
        // the bulk junctions' capacitances: the bottom (CBD, CBS or CJ by the area) and the sidewall (CJSW by
        // the perimeter), each by its own grading (MJ, MJSW)
        const jb = junc(m, "pb", "mj", no, 0.8, 0.5), jsw = { vj: jb.vj, m: mp(m, "mjsw", level === 1 ? 0.5 : 0.33, no), fc: jb.fc }, cj = mp(m, "cj", 0, no), cjsw = mp(m, "cjsw", 0, no);
        const cbd = (m.p.cbd !== undefined ? mp(m, "cbd", 0, no) : cj * ad) * mult, cbs = (m.p.cbs !== undefined ? mp(m, "cbs", 0, no) : cj * as) * mult;
        const junction = (k, o, is, c, csw) => {
          if (o === bulk) return;
          const [a, c2] = pol > 0 ? [bulk, o] : [o, bulk];
          // (with SPICE's gmin across it: a bulk on a node of its own, as switches in makers' models
          // tie theirs through 1 TΩ, is then held where SPICE holds it)
          push({ name: nm + "#b" + k, kind: "D", n: [a, c2], is, n_: 1 }, { name: nm + "#b" + k + "g", kind: "R", n: [a, c2], r: 1e12 });
          cap(nm + "#cb" + k, a, c2, c, jb); cap(nm + "#cb" + k + "sw", a, c2, csw, jsw);
        };
        junction("d", d2, isd, cbd, cjsw * pd * mult); junction("s", s2, iss, cbs, cjsw * ps * mult);
        cap(nm + "#cgs", g2, s2, mp(m, "cgso", 0, no) * P.weff * mult); cap(nm + "#cgd", g2, d2, mp(m, "cgdo", 0, no) * P.weff * mult);
        cap(nm + "#cgb", g2, bulk, mp(m, "cgbo", 0, no) * P.leff * mult);
      }
      function jfet(nm, d, g, s, m, area, no) {
        const pol = m.type === "njf" ? 1 : -1, beta = mp(m, "beta", 1e-4, no) * area, is = mp(m, "is", 1e-14, no) * area;
        const d2 = series(nm + "#rd", d, mp(m, "rd", 0, no) / area), s2 = series(nm + "#rs", s, mp(m, "rs", 0, no) / area);
        // SPICE's JFET: VTO is negative for both polarities; the engine's FET takes the N-channel's sign times pol
        const vto = -Math.abs(mp(m, "vto", -2, no)) * pol;
        push({ name: nm, kind: "MOS", n: [d2, g, s2], model: { pol, vto, kp: 2 * beta, lambda: mp(m, "lambda", 0, no), s: FET_S, jf: { beta, is } } });
        push({ name: nm + "#gs", kind: "D", n: pol > 0 ? [g, s2] : [s2, g], is, n_: mp(m, "n", 1, no) }, { name: nm + "#gd", kind: "D", n: pol > 0 ? [g, d2] : [d2, g], is, n_: mp(m, "n", 1, no) });
        const jg = junc(m, "pb", "m", no, 1, 0.5), cgs = mp(m, "cgs", 0, no) * area, cgd = mp(m, "cgd", 0, no) * area;
        if (pol > 0) { cap(nm + "#cgs", g, s2, cgs, jg); cap(nm + "#cgd", g, d2, cgd, jg); } else { cap(nm + "#cgs", s2, g, cgs, jg); cap(nm + "#cgd", d2, g, cgd, jg); }
      }
    }
    expand(top, top.pins.map((_, i) => i + 1), SM.makeScope(lib, top, overrides), "", 0);

    // coupled inductors: each group of windings on one core becomes a transformer
    if (couplings.length) {
      const byName = new Map(els.filter(e => e.kind === "L").map(e => [e.name, e])), groups = [];
      couplings.forEach(c => {
        c.ls.forEach(n => { if (!byName.has(n)) throw new Error(`line ${c.no}: no inductor ${n} to couple`); });
        let g = groups.find(q => c.ls.some(n => q.ls.has(n)));
        if (!g) { g = { ls: new Set(), k: c.k }; groups.push(g); }
        if (Math.abs(g.k - c.k) > 1e-9) warn.add("Coupled inductors with different coupling factors on one core use the first");
        c.ls.forEach(n => g.ls.add(n));
      });
      groups.forEach(g => {
        const L = [...g.ls].map(n => byName.get(n)), l0 = L[0].l;
        L.forEach(e => els.splice(els.indexOf(e), 1));
        els.push({ name: L[0].name + "#k", kind: "XFMR", n: [], lp: l0, primaryTurns: 1000, k: Math.min(Math.abs(g.k), 0.99999), windings: L.map(e => ({ a: e.n[0], b: e.n[1], turns: 1000 * Math.sqrt(e.l / l0) })) });
      });
    }
    // every current read must be a source's or an inductor's
    const names = new Map(els.map(e => [e.name, e]));
    els.forEach(e => (e.ctl || []).forEach(id => { const c = names.get(id); if (!c || !(c.kind === "V" || c.kind === "L" || c.kind === "E" || (c.kind === "B" && c.out === "v"))) throw new Error(`${e.name}: I(${id}) needs a voltage source ${id} in the model`); }));
    return { name: top.name, kind, pins: top.pins.slice(), hint: top.hint || "", nNodes, els, nodeNames: Object.fromEntries(topMap), warnings: [...warn].concat(lib.warnings.filter(w => /is not followed/.test(w))) };
  }

  // flattened parts by their text (a circuit builds its netlist after every edit)
  const cache = new Map();
  function flat(text, name) {
    const key = String(name || "") + "\u0000" + text;
    let f = cache.get(key);
    if (!f) { f = flatten(text, name); cache.set(key, f); if (cache.size > 40) cache.delete(cache.keys().next().value); }
    return f;
  }
  /**
   * The engine's elements of one part: spec { text, sub }, pinNodes the circuit's nodes of its
   * pins in the model's order (null: a pin left open gets a node of its own), alloc() a new node.
   */
  //   spec.temp: the temperature (°C, the engine's scale) its transistors run at, by their XTI, EG,
  //   XTB from TNOM; spec.therm: a lone transistor model heats itself (the engine's therm)
  function build(spec, pinNodes, alloc, id, out) {
    const f = flat(spec.text, spec.sub), map = new Array(f.nNodes);
    map[0] = 0;
    for (let k = 1; k < f.nNodes; k++) map[k] = k <= f.pins.length && pinNodes[k - 1] !== undefined && pinNodes[k - 1] !== null ? pinNodes[k - 1] : alloc();
    const eid = n => id + "#" + n;
    out = out || [];
    f.els.forEach(e => {
      const o = { id: eid(e.name), kind: e.kind, nodes: e.n.map(k => map[k]), internal: true };
      for (const k in e) if (k !== "name" && k !== "kind" && k !== "n" && k !== "n_") o[k] = e[k];
      if (e.n_ !== undefined) o.n = e.n_;
      delete o.tdata;
      if (e.kind === "BJT" && (spec.therm || (spec.temp !== undefined && spec.temp !== null && isFinite(spec.temp)))) {
        o.model0 = Object.assign({}, e.model, e.tdata);
        if (spec.therm && f.kind !== "subckt") o.therm = Object.assign({}, spec.therm); else o.temp = +spec.temp;
      }
      if (e.kind === "XFMR") { o.windings = e.windings.map(w => ({ a: map[w.a], b: map[w.b], turns: w.turns })); o.nodes = []; }
      if (e.ext) o.ext = e.ext.map(k => map[k]);
      if (e.ctl) o.ctl = e.ctl.map(eid);
      if (o.tt === undefined) delete o.tt;
      out.push(o);
    });
    return out;
  }

  /**
   * The text one part needs, out of a library that may hold thousands: its subcircuit, the
   * subcircuits that one calls, and of the library's own lines its parameters, functions and
   * the models those subcircuits name. A lone model: that .MODEL line.
   */
  function extract(text, name) {
    const lib = SM.parseLib(text), want = String(name || "").toLowerCase();
    // the library's own statements, continuation lines joined
    const stmts = []; lib.globalLines.forEach(l => { if (/^\s*\+/.test(l) && stmts.length) stmts[stmts.length - 1] += "\n" + l; else stmts.push(l); });
    const modelName = st => { const m = /^\s*\.model\s+(\S+)/i.exec(st); return m ? m[1].toLowerCase() : null; };
    const top = lib.subckts.find(x => x.name.toLowerCase() === want);
    if (!top) {
      const keep = stmts.filter(st => { const m = modelName(st); return m === null || m === want; });
      return keep.some(st => modelName(st) === want) ? keep.join("\n") + "\n" : "";
    }
    const need = [], words = new Set();
    const take = sub => {
      if (need.includes(sub)) return; need.push(sub);
      sub.els.forEach(({ s: line }) => {
        const tk = SM.tokens(line); tk.forEach(t => words.add(t.toLowerCase()));
        if (/^x/i.test(line)) { const eq = tk.findIndex(t => t.includes("=") || /^params:?$/i.test(t)), nm = (eq < 0 ? tk : tk.slice(0, eq)).pop(), c = lib.subckts.find(x => x.name.toLowerCase() === String(nm).toLowerCase()); if (c) take(c); }
      });
    };
    take(top);
    const globals = stmts.filter(st => { const m = modelName(st); return m === null || words.has(m); });
    return globals.concat(...need.reverse().map(sub => sub.raw.concat(sub.raw.some(r => /^\s*\.ends\b/i.test(r)) ? [] : [".ENDS"]))).join("\n") + "\n";
  }

  root.SpiceNet = { extract, list, flatten, flat, build, close, evalClosed, polyAst, vectorFit, DEVICE_PINS, DEVICE_NAME };
})(typeof window !== "undefined" ? window : globalThis);
