/* Waveform math for the Transient tab's viewer (cad-transient.js), no DOM: a trace is a net's name
   or an expression over the run's record, worked out point by point.
     V(OUT)  V(OUT,IN)  I(R3)  I(Q1.C)  OUT*2  V(A)-V(B)  I(R1)*V(R1.1)  d(V(C1.1))  integ(I(L1))
   Numbers take SPICE's suffixes (2.2k, 10u, 1meg); functions abs, sqrt, exp, ln, log10, db
   (20·log10|x|), sin, cos, tan, atan, sgn, min, max, pow, d (derivative over time), integ
   (running integral); time (or t) and pi. A bare name is a net (letters, digits, _ and .; a name
   with spaces or + goes in V()). Units follow: V·A = W, V/A = Ω, d(V) = V/s, integ(A) = C.
   fft: the amplitude spectrum of a span of a trace (resampled evenly, Hann window). */
(function (root) {
  "use strict";
  const SUFFIX = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9, t: 1e12 };
  const FN1 = { abs: Math.abs, sqrt: v => Math.sqrt(v), exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, db: v => 20 * Math.log10(Math.abs(v)), sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, sgn: Math.sign };
  const FN2 = { min: Math.min, max: Math.max, pow: Math.pow };

  // text → tree, or throws an Error saying what is wrong
  function parse(text) {
    const s = String(text || "");
    let i = 0;
    const err = msg => { throw new Error(msg); };
    const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    const peek = () => { ws(); return s[i]; };
    // V( and I( take names as written, up to the closing bracket (commas part them)
    const rawArgs = () => {
      const out = []; let depth = 0, cur = "";
      for (; i < s.length; i++) {
        const c = s[i];
        if (c === "(") depth++;
        if (c === ")") { if (!depth) { i++; out.push(cur.trim()); return out; } depth--; }
        if (c === "," && !depth) { out.push(cur.trim()); cur = ""; continue; }
        cur += c;
      }
      return err("a ( is not closed");
    };
    const number = () => {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      i += m[0].length;
      let v = parseFloat(m[0]);
      const sfx = /^(meg|[fpnuµmkgt])/i.exec(s.slice(i));
      if (sfx) { v *= SUFFIX[sfx[1].toLowerCase()]; i += sfx[1].length; }
      const unit = /^[a-zµΩ]*/i.exec(s.slice(i)); i += unit[0].length;   // 1kHz, 5V: the unit is ignored
      return { op: "num", v };
    };
    const atom = () => {
      const c = peek();
      if (c === undefined) return err("the expression ends too soon");
      if (c === "(") { i++; const e = expr(); if (peek() !== ")") err("a ( is not closed"); i++; return e; }
      if (/[\d.]/.test(c)) return number();
      const m = /^[A-Za-z_][\w.]*/.exec(s.slice(i));
      if (!m) return err(`"${c}" is not expected here`);
      i += m[0].length;
      const id = m[0], lo = id.toLowerCase();
      if (peek() === "(") {
        i++;
        if (lo === "v") { const a = rawArgs(); if (a.length < 1 || a.length > 2 || !a[0]) err("V() takes a net, or two"); return { op: "v", a: a[0], b: a[1] || null }; }
        if (lo === "i") { const a = rawArgs(); if (a.length !== 1 || !a[0]) err("I() takes a part (R3) or a part's pin (Q1.C)"); return { op: "i", name: a[0] }; }
        const args = [];
        if (peek() !== ")") { for (;;) { args.push(expr()); if (peek() === ",") { i++; continue; } break; } }
        if (peek() !== ")") err(`${id}( is not closed`);
        i++;
        if (FN1[lo] || lo === "d" || lo === "integ") { if (args.length !== 1) err(`${lo}() takes one value`); return { op: "fn", name: lo, args }; }
        if (FN2[lo]) { if (args.length !== 2) err(`${lo}() takes two values`); return { op: "fn", name: lo, args }; }
        return err(`no function called ${id}`);
      }
      if (lo === "time" || lo === "t") return { op: "time" };
      if (lo === "pi") return { op: "num", v: Math.PI };
      return { op: "v", a: id, b: null, bare: true };
    };
    const power = () => { const a = atom(); if (peek() === "^") { i++; return { op: "^", a, b: unary() }; } return a; };
    const unary = () => { const c = peek(); if (c === "-") { i++; return { op: "neg", a: unary() }; } if (c === "+") { i++; return unary(); } return power(); };
    const term = () => { let a = unary(); for (;;) { const c = peek(); if (c === "*" || c === "/") { i++; a = { op: c, a, b: unary() }; } else return a; } };
    const expr = () => { let a = term(); for (;;) { const c = peek(); if (c === "+" || c === "-") { i++; a = { op: c, a, b: term() }; } else return a; } };
    if (!s.trim()) err("empty");
    const tree = expr();
    if (peek() !== undefined) err(`"${s.slice(i).trim()}" is left over`);
    return tree;
  }

  // units: null for a plain number (fits any), "" for none
  const UMUL = { "V*V": "V²", "A*A": "A²", "V*A": "W", "A*V": "W", "A*Ω": "V", "Ω*A": "V", "W*s": "J", "A*s": "C", "V*S": "A", "S*V": "A" };
  const UDIV = { "V/A": "Ω", "A/V": "S", "W/V": "A", "W/A": "V", "V/Ω": "A", "C/s": "A", "J/s": "W" };
  function unitOp(op, a, b) {
    if (op === "+" || op === "-") return a === null ? b : b === null ? a : a === b ? a : "";
    if (op === "*") return a === null ? b : b === null ? a : UMUL[a + "*" + b] || (a && b ? a + "·" + b : a || b);
    if (op === "/") return b === null ? a : a === b ? "" : UDIV[a + "/" + b] || (a === null || a === "" ? (b ? "1/" + b : "") : b ? a + "/" + b : a);
    return "";
  }

  // tree → { y: Float64Array, unit }. ctx: { t (the times), volt(name) → array | null,
  // cur(name) → array | throws } ; throws an Error naming what it cannot find
  function evaluate(tree, ctx) {
    const n = ctx.t.length;
    const arr = v => { if (typeof v !== "number") return v; const a = new Float64Array(n); a.fill(v); return a; };
    const map1 = (x, f) => { if (typeof x === "number") return f(x); const o = new Float64Array(n); for (let k = 0; k < n; k++) o[k] = f(x[k]); return o; };
    const map2 = (x, y, f) => {
      if (typeof x === "number" && typeof y === "number") return f(x, y);
      const o = new Float64Array(n), xs = typeof x === "number", ys = typeof y === "number";
      for (let k = 0; k < n; k++) o[k] = f(xs ? x : x[k], ys ? y : y[k]);
      return o;
    };
    const volt = name => {
      if (/^(0|gnd)$/i.test(name)) return 0;
      const y = ctx.volt(name);
      if (!y) throw new Error(`no net called ${name}`);
      return y;
    };
    const go = e => {
      switch (e.op) {
        case "num": return { y: e.v, unit: null };
        case "time": return { y: ctx.t, unit: "s" };
        case "v": { const a = volt(e.a), b = e.b ? volt(e.b) : 0; return { y: e.b ? map2(a, b, (p, q) => p - q) : a, unit: "V" }; }
        case "i": return { y: ctx.cur(e.name), unit: "A" };
        case "neg": { const a = go(e.a); return { y: map1(a.y, v => -v), unit: a.unit }; }
        case "^": { const a = go(e.a), b = go(e.b); return { y: map2(a.y, b.y, Math.pow), unit: b.unit === null && typeof b.y === "number" && b.y === 2 && a.unit ? a.unit + "²" : a.unit === null ? null : "" }; }
        case "+": case "-": case "*": case "/": {
          const a = go(e.a), b = go(e.b), f = { "+": (p, q) => p + q, "-": (p, q) => p - q, "*": (p, q) => p * q, "/": (p, q) => p / q }[e.op];
          return { y: map2(a.y, b.y, f), unit: unitOp(e.op, a.unit, b.unit) };
        }
        case "fn": {
          const args = e.args.map(go), a = args[0];
          if (e.name === "d") {
            const y = arr(a.y), t = ctx.t, o = new Float64Array(n);
            for (let k = 0; k < n; k++) { const k0 = Math.max(0, k - 1), k1 = Math.min(n - 1, k + 1), dt = t[k1] - t[k0]; o[k] = dt > 0 ? (y[k1] - y[k0]) / dt : 0; }
            return { y: o, unit: a.unit ? (UDIV[a.unit + "/s"] || a.unit + "/s") : "1/s" };
          }
          if (e.name === "integ") {
            const y = arr(a.y), t = ctx.t, o = new Float64Array(n);
            for (let k = 1; k < n; k++) o[k] = o[k - 1] + (y[k] + y[k - 1]) / 2 * (t[k] - t[k - 1]);
            return { y: o, unit: a.unit ? (UMUL[a.unit + "*s"] || a.unit + "·s") : "s" };
          }
          if (FN2[e.name]) return { y: map2(a.y, args[1].y, FN2[e.name]), unit: e.name === "pow" ? "" : unitOp("+", a.unit, args[1].unit) };
          return { y: map1(a.y, FN1[e.name]), unit: e.name === "abs" ? a.unit : e.name === "sgn" ? null : e.name === "db" ? "dB" : e.name === "sqrt" && a.unit === "V²" ? "V" : "" };
        }
      }
      throw new Error("bad expression");
    };
    const r = go(tree);
    return { y: typeof r.y === "number" ? arr(r.y) : r.y, unit: r.unit === null ? "" : r.unit };
  }

  // the names a tree reads: { nets: [...], parts: [...] }
  function refs(tree) {
    const nets = [], parts = [];
    const walk = e => { if (!e) return; if (e.op === "v") { nets.push(e.a); if (e.b) nets.push(e.b); } else if (e.op === "i") parts.push(e.name); ["a", "b"].forEach(k => { if (e[k] && typeof e[k] === "object") walk(e[k]); }); (e.args || []).forEach(walk); };
    walk(tree);
    return { nets, parts };
  }

  // radix-2 FFT in place on re, im (length a power of two)
  function fftInPlace(re, im) {
    const N = re.length;
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
      if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  // the amplitude spectrum of y(t) over [t0, t1]: { f, a (peak amplitude of each bin's sine), df, N }.
  // The span is resampled evenly at a power of two of points (at least as many as the record has
  // there, 1024 to maxN) and weighted by a Hann window, so a sine reads its own amplitude
  function fft(t, y, t0, t1, maxN) {
    const n = t.length; if (n < 4 || !(t1 > t0)) return null;
    let cnt = 0; for (let k = 0; k < n; k++) if (t[k] >= t0 && t[k] <= t1) cnt++;
    let N = 1024; while (N < cnt && N < (maxN || 65536)) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N), dt = (t1 - t0) / N;
    let j = 0, wsum = 0;
    for (let k = 0; k < N; k++) {
      const x = t0 + (k + 0.5) * dt;
      while (j < n - 2 && t[j + 1] < x) j++;
      const f = Math.max(0, Math.min(1, (x - t[j]) / ((t[j + 1] - t[j]) || 1))), v = y[j] + f * (y[j + 1] - y[j]);
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (k + 0.5) / N);
      re[k] = v * w; wsum += w;
    }
    fftInPlace(re, im);
    const half = N / 2, fr = new Float64Array(half), a = new Float64Array(half), df = 1 / (t1 - t0);
    for (let k = 0; k < half; k++) { fr[k] = k * df; a[k] = (k ? 2 : 1) * Math.hypot(re[k], im[k]) / wsum; }
    return { f: fr, a, df, N };
  }
  // the strongest bin above DC (with its neighbours, as a Hann window spreads a sine over three):
  // { f, a } with the frequency refined between the bins
  function peak(sp) {
    if (!sp) return null;
    let best = 2;
    for (let k = 2; k < sp.a.length - 1; k++) if (sp.a[k] > sp.a[best]) best = k;
    const l = sp.a[best - 1], c = sp.a[best], r = sp.a[best + 1], den = l - 2 * c + r, d = den ? 0.5 * (l - r) / den : 0;
    return { f: (best + d) * sp.df, a: Math.sqrt(l * l + c * c + r * r) / Math.sqrt(1.5) };
  }

  root.WaveMath = { parse, evaluate, refs, fft, peak, unitOp };
})(typeof window !== "undefined" ? window : globalThis);
