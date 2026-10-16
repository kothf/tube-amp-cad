/* =============================================================================
   SPICE TUBE MODELS — import any community tube model (.SUBCKT) and evaluate it as
   written: Koren, Ayumi, Duncan, Reefman and the like. No DOM: used by the CAD, the
   curve tracer, the simulation worker and the Node tests.

   Reads: .SUBCKT … .ENDS (pins, PARAMS:), .PARAM, .FUNC, .MODEL D(…), comments (* ; $),
   continuation lines (+), unit suffixes (k, meg, m, u, n, p…). Elements: B (I= / V=),
   E and G (VALUE={…} or linear), R, D (Shockley), L (a short), V (a fixed voltage);
   C is open (the CAD's tube models have no capacitances). Expressions: + - * / ** ^,
   comparisons, && || !, ?:, V(a) and V(a,b), and the usual functions (exp ln log log10
   sqrt pow pwr pwrs abs sgn uramp u limit min max if atan tanh …).

   Evaluation: pin voltages in, current into each pin out. Nodes driven by voltage
   sources follow from their expressions in order; other internal nodes (a grid-current
   resistor and diode) are solved by Newton on Kirchhoff's current law.
   ============================================================================= */
(function (root) {
  "use strict";
  const SI = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, mil: 25.4e-6, m: 1e-3, u: 1e-6, "µ": 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  const NUM = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmuµnpf])?([a-zµΩ]*)$/i;
  /** A SPICE number with an optional unit suffix ("1.5k", "2.2meg", "10pF"), or NaN */
  function num(s) {
    const m = NUM.exec(String(s).trim()); if (!m) return NaN;
    return parseFloat(m[1]) * (m[2] ? SI[m[2].toLowerCase()] : 1);
  }

  // ---------------------------------------------------------------------------
  // Text: logical lines (continuations joined, comments removed but kept as hints)
  // ---------------------------------------------------------------------------
  function logicalLines(text) {
    const out = [];
    let pending = [];                                     // comment lines just read
    String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach((raw, no) => {
      const t = raw.trim();
      if (!t) return;
      if (t[0] === "*") { pending.push(t.slice(1).trim()); if (pending.length > 4) pending.shift(); if (out.length) out[out.length - 1].after.push(t.slice(1).trim()); return; }
      let body = t, comment = "";
      const sc = body.search(/;|\s\$\s?/);
      if (sc >= 0) { comment = body.slice(sc).replace(/^[;$\s]+/, ""); body = body.slice(0, sc).trim(); }
      if (body[0] === "+" && out.length) { const prev = out[out.length - 1]; prev.s += " " + body.slice(1).trim(); if (comment) prev.comment += " " + comment; prev.raw.push(raw); return; }
      if (!body) { if (comment && out.length) out[out.length - 1].after.push(comment); return; }
      out.push({ s: body, comment, before: pending, after: [], raw: [raw], no: no + 1 });
      pending = [];
    });
    return out;
  }
  // split on spaces, keeping {…} and (…) together; "a = b" becomes "a=b"
  function tokens(s) {
    s = s.replace(/\s*=\s*/g, "=");
    const out = []; let cur = "", depth = 0;
    for (const ch of s) {
      if (ch === "{" || ch === "(") depth++;
      if (ch === "}" || ch === ")") depth = Math.max(0, depth - 1);
      if (/\s/.test(ch) && !depth) { if (cur) out.push(cur); cur = ""; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }
  const unbrace = s => { s = String(s).trim(); return s[0] === "{" && s[s.length - 1] === "}" ? s.slice(1, -1) : s[0] === "'" && s[s.length - 1] === "'" ? s.slice(1, -1) : s; };
  function assignments(list, into, order) {
    list.forEach(tk => { const i = tk.indexOf("="); if (i > 0) { const k = tk.slice(0, i).toLowerCase(); into[k] = unbrace(tk.slice(i + 1)); if (order) order.push(k); } });
  }

  /** Read a library: { subckts: [{ name, pins, hint, ... }], params, funcs, models, warnings } */
  function parseLib(text) {
    const L = logicalLines(text), lib = { subckts: [], params: {}, funcs: {}, models: {}, globalLines: [], warnings: [] };
    let cur = null;
    const addFunc = (into, s) => {
      const m = /^\.func\s+([a-z_][\w]*)\s*\(([^)]*)\)\s*=?\s*([\s\S]+)$/i.exec(s);
      if (!m) { lib.warnings.push(`Not understood: ${s}`); return; }
      into[m[1].toLowerCase()] = { args: m[2].split(",").map(a => a.trim().toLowerCase()).filter(Boolean), body: unbrace(m[3]) };
    };
    const addModel = (into, s) => {
      const m = /^\.model\s+(\S+)\s+([a-z]+)\s*\(?([^)]*)\)?/i.exec(s);
      if (!m) return;
      const p = {}; assignments(tokens(m[3].replace(/,/g, " ")), p);
      into[m[1].toLowerCase()] = { type: m[2].toLowerCase(), p };
    };
    L.forEach(line => {
      const s = line.s, low = s.toLowerCase();
      if (/^\.subckt\b/.test(low)) {
        if (cur) lib.warnings.push(`${cur.name}: no .ENDS before the next .SUBCKT`);
        const tk = tokens(s).slice(1), name = tk.shift(), pins = [], params = {}, order = [];
        let inParams = false;
        tk.forEach(t => { if (/^params:?$/i.test(t)) inParams = true; else if (inParams || t.includes("=")) assignments([t], params, order); else pins.push(t.toLowerCase()); });
        cur = { name, pins, params, paramOrder: order, funcs: {}, models: {}, els: [], hint: [line.comment, ...line.after, ...line.before].filter(Boolean).join(" | "), raw: [...line.raw], no: line.no };
        return;
      }
      if (cur) cur.raw.push(...line.raw);
      if (/^\.ends\b/.test(low)) { if (cur) lib.subckts.push(cur); cur = null; return; }
      const target = cur || lib;
      if (/^\.param\b/.test(low)) { assignments(tokens(s).slice(1), target.params); if (!cur) lib.globalLines.push(...line.raw); }
      else if (/^\.func\b/.test(low)) { addFunc(target.funcs, s); if (!cur) lib.globalLines.push(...line.raw); }
      else if (/^\.model\b/.test(low)) { addModel(target.models, s); if (!cur) lib.globalLines.push(...line.raw); }
      else if (/^\.(inc|include|lib)\b/.test(low)) lib.warnings.push(`${s.split(/\s+/)[0]} is not followed: paste the included file too`);
      else if (/^\./.test(low)) { /* .end, .options, .temp …: nothing to do */ }
      else if (cur) cur.els.push({ s, no: line.no });
    });
    if (cur) { lib.warnings.push(`${cur.name}: no .ENDS`); lib.subckts.push(cur); }
    return lib;
  }
  /** The text needed for one subcircuit: the library's global lines and the subcircuit itself */
  function extract(text, name) {
    const lib = parseLib(text), sub = lib.subckts.find(s => s.name.toLowerCase() === String(name).toLowerCase());
    if (!sub) return "";
    return lib.globalLines.concat(sub.raw).join("\n") + (sub.raw.some(r => /^\s*\.ends\b/i.test(r)) ? "" : "\n.ENDS") + "\n";
  }

  // ---------------------------------------------------------------------------
  // Expressions: tokens, a Pratt parser, compiled to closures over the node voltages
  // ---------------------------------------------------------------------------
  const OPS = ["**", "<=", ">=", "==", "!=", "<>", "&&", "||", "+", "-", "*", "/", "^", "<", ">", "!", "?", ":", "(", ")", ","];
  function lex(src) {
    const out = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      const nm = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmuµnpf])?[a-zµΩ]*/i.exec(src.slice(i));
      if (nm && /[\d.]/.test(c)) { const v = num(nm[0]); if (isNaN(v)) throw new Error(`bad number "${nm[0]}"`); out.push({ t: "num", v, s: nm[0] }); i += nm[0].length; continue; }
      const id = /^[a-z_][\w.$]*/i.exec(src.slice(i));
      if (id) { out.push({ t: "id", s: id[0] }); i += id[0].length; continue; }
      const op = OPS.find(o => src.startsWith(o, i));
      if (op) { out.push({ t: "op", s: op }); i += op.length; continue; }
      throw new Error(`unexpected "${c}"`);
    }
    return out;
  }
  const FUNCS = {
    abs: Math.abs, sqrt: x => Math.sqrt(x), exp: x => Math.exp(Math.min(x, 700)), ln: Math.log, log: Math.log, log10: Math.log10,
    pow: (x, y) => Math.pow(x, y), pwr: (x, y) => Math.pow(Math.abs(x), y), pwrs: (x, y) => Math.sign(x) * Math.pow(Math.abs(x), y),
    sgn: Math.sign, sign: Math.sign, uramp: x => (x > 0 ? x : 0), u: x => (x > 0 ? 1 : 0), u2: x => Math.max(0, Math.min(1, x)),
    limit: (x, a, b) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), x)), min: Math.min, max: Math.max, if: (c, a, b) => (c ? a : b),
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, arctan: Math.atan, atan2: Math.atan2,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, floor: Math.floor, ceil: Math.ceil, round: Math.round, int: Math.trunc, sq: x => x * x
  };
  const CONSTS = { pi: Math.PI, temp: 27, true: 1, false: 0 };
  const BIN = { "||": [1, (a, b) => (a || b ? 1 : 0)], "&&": [2, (a, b) => (a && b ? 1 : 0)], "==": [3, (a, b) => (a === b ? 1 : 0)], "!=": [3, (a, b) => (a !== b ? 1 : 0)], "<>": [3, (a, b) => (a !== b ? 1 : 0)],
    "<": [4, (a, b) => (a < b ? 1 : 0)], ">": [4, (a, b) => (a > b ? 1 : 0)], "<=": [4, (a, b) => (a <= b ? 1 : 0)], ">=": [4, (a, b) => (a >= b ? 1 : 0)],
    "+": [5, (a, b) => a + b], "-": [5, (a, b) => a - b], "*": [6, (a, b) => a * b], "/": [6, (a, b) => a / b], "**": [8, (a, b) => Math.pow(a, b)], "^": [8, (a, b) => Math.pow(a, b)] };
  /** Parse an expression to an AST: { k: "n", v } | { k: "v", a, b } | { k: "id", s } | { k: "f", s, args } | { k: "u", op, x } | { k: "b", op, a, b } | { k: "?", c, a, b } */
  function parseExpr(src) {
    const T = lex(src); let i = 0;
    const peek = () => T[i], next = () => T[i++], want = s => { const t = next(); if (!t || t.s !== s) throw new Error(`expected "${s}"${t ? ` before "${t.s}"` : " at the end"}`); };
    function primary() {
      const t = next(); if (!t) throw new Error("the expression ends too soon");
      if (t.t === "num") return { k: "n", v: t.v };
      if (t.t === "op" && t.s === "(") { const e = expr(0); want(")"); return e; }
      if (t.t === "op" && (t.s === "-" || t.s === "+" || t.s === "!")) return { k: "u", op: t.s, x: expr(7) };
      if (t.t === "id") {
        const name = t.s.toLowerCase();
        if (peek() && peek().s === "(") {
          next();
          if (name === "v") {                              // V(node) or V(node, node): names may be numbers
            const nodes = []; let cur = "";
            for (;;) { const u = next(); if (!u) throw new Error("V( is not closed"); if (u.s === ")") { nodes.push(cur); break; } if (u.s === ",") { nodes.push(cur); cur = ""; } else cur += u.s; }
            return { k: "v", a: nodes[0].toLowerCase(), b: nodes[1] ? nodes[1].toLowerCase() : "0" };
          }
          if (name === "i") throw new Error("branch currents I(…) are not supported");
          const args = [];
          if (peek() && peek().s === ")") next(); else { for (;;) { args.push(expr(0)); const u = next(); if (!u) throw new Error(`${name}( is not closed`); if (u.s === ")") break; if (u.s !== ",") throw new Error(`expected "," or ")" in ${name}(…)`); } }
          return { k: "f", s: name, args };
        }
        return { k: "id", s: name };
      }
      throw new Error(`unexpected "${t.s}"`);
    }
    function expr(minP) {
      let left = primary();
      for (;;) {
        const t = peek(); if (!t || t.t !== "op") break;
        if (t.s === "?" && minP === 0) { next(); const a = expr(0); want(":"); const b = expr(0); left = { k: "?", c: left, a, b }; continue; }
        const op = BIN[t.s]; if (!op || op[0] < minP) break;     // left-associative, except the power (right)
        next(); left = { k: "b", op: t.s, a: left, b: expr(op[0] === 8 ? 8 : op[0] + 1) };
      }
      return left;
    }
    const e = expr(0);
    if (i < T.length) throw new Error(`unexpected "${T[i].s}"`);
    return e;
  }
  // AST -> closure (V) => number; scope resolves parameters (to constants) and .FUNC definitions
  function compileExpr(ast, scope, nodeIndex, args) {
    const C = ast => compileExpr(ast, scope, nodeIndex, args);
    switch (ast.k) {
      case "n": { const v = ast.v; return () => v; }
      case "v": { const a = nodeIndex(ast.a), b = nodeIndex(ast.b); return V => V[a] - V[b]; }
      case "id": {
        if (args && ast.s in args) { const k = args[ast.s]; return k; }
        const v = scope.param(ast.s);
        return () => v;
      }
      case "u": { const x = C(ast.x); return ast.op === "-" ? V => -x(V) : ast.op === "!" ? V => (x(V) ? 0 : 1) : x; }
      case "b": { const a = C(ast.a), b = C(ast.b), f = BIN[ast.op][1]; return V => f(a(V), b(V)); }
      case "?": { const c = C(ast.c), a = C(ast.a), b = C(ast.b); return V => (c(V) ? a(V) : b(V)); }
      case "f": {
        const user = scope.func(ast.s);
        if (user) {
          if (user.args.length !== ast.args.length) throw new Error(`${ast.s}() takes ${user.args.length} arguments`);
          const argFns = ast.args.map(C), body = scope.funcAst(ast.s);
          const bound = {}; user.args.forEach((n, j) => { bound[n] = V => argFns[j](V); });
          return compileExpr(body, scope, nodeIndex, Object.assign({}, args || {}, bound));
        }
        const f = FUNCS[ast.s]; if (!f) throw new Error(`unknown function ${ast.s}()`);
        const A = ast.args.map(C);
        if (A.length === 1) { const a = A[0]; return V => f(a(V)); }
        if (A.length === 2) { const [a, b] = A; return V => f(a(V), b(V)); }
        if (A.length === 3) { const [a, b, c] = A; return V => f(a(V), b(V), c(V)); }
        return V => f(...A.map(g => g(V)));
      }
    }
    throw new Error("bad expression");
  }
  // The same, as JavaScript source for the engine's hot loop: only numbers, V[index] and the
  // whitelisted functions above ever reach the generated code (never the model's own text)
  let fastOK = true;
  function jsOf(ast, scope, nodeIndex, args) {
    const J = a => jsOf(a, scope, nodeIndex, args);
    switch (ast.k) {
      case "n": return `(${ast.v})`;
      case "v": return `(V[${nodeIndex(ast.a) | 0}]-V[${nodeIndex(ast.b) | 0}])`;
      case "id": return args && ast.s in args ? args[ast.s] : `(${+scope.param(ast.s)})`;
      case "u": return ast.op === "-" ? `(-${J(ast.x)})` : ast.op === "!" ? `(${J(ast.x)}?0:1)` : J(ast.x);
      case "b": {
        const a = J(ast.a), b = J(ast.b), op = ast.op;
        if (op === "**" || op === "^") return `Math.pow(${a},${b})`;
        if ("+-*/".includes(op)) return `(${a}${op}${b})`;
        const js = { "<>": "!==", "==": "===", "!=": "!==" }[op] || op;
        return `((${a}${js}${b})?1:0)`;
      }
      case "?": return `(${J(ast.c)}?${J(ast.a)}:${J(ast.b)})`;
      case "f": {
        const user = scope.func(ast.s);
        if (user) {
          if (user.args.length !== ast.args.length) throw new Error(`${ast.s}() takes ${user.args.length} arguments`);
          const ids = user.args.map((_, j) => `_a${Math.random().toString(36).slice(2, 8)}${j}`), bound = Object.assign({}, args || {});
          user.args.forEach((n, j) => { bound[n] = ids[j]; });
          return `((${ids.join(",")})=>${jsOf(scope.funcAst(ast.s), scope, nodeIndex, bound)})(${ast.args.map(J).join(",")})`;
        }
        if (!FUNCS[ast.s]) throw new Error(`unknown function ${ast.s}()`);
        return `F.${ast.s}(${ast.args.map(J).join(",")})`;
      }
    }
    throw new Error("bad expression");
  }
  function compileFast(ast, scope, nodeIndex) {
    const slow = compileExpr(ast, scope, nodeIndex);       // also checks the expression
    if (!fastOK) return slow;
    try { const f = new Function("F", "V", `"use strict";return ${jsOf(ast, scope, nodeIndex)};`); return V => f(FUNCS, V); }
    catch (e) { fastOK = false; return slow; }             // a browser that forbids it (CSP): the closures
  }
  // parameters and functions visible inside a subcircuit (its own first, then the library's)
  function makeScope(lib, sub, overrides) {
    const layers = [Object.assign({}, sub.params, overrides || {}), lib.params], funcs = [sub.funcs, lib.funcs], cache = {}, busy = new Set(), asts = {};
    const scope = {
      param(name) {
        if (name in CONSTS) return CONSTS[name];
        if (name in cache) return cache[name];
        for (const layer of layers) if (name in layer) {
          if (busy.has(name)) throw new Error(`parameter ${name} refers to itself`);
          busy.add(name);
          const src = layer[name], n = num(src);
          const v = !isNaN(n) && !/^[a-z_]/i.test(src) ? n : compileExpr(parseExpr(src), scope, () => 0)([0]);
          busy.delete(name); cache[name] = v; return v;
        }
        throw new Error(`unknown parameter ${name}`);
      },
      func(name) { for (const f of funcs) if (f[name]) return f[name]; return null; },
      funcAst(name) { if (!asts[name]) asts[name] = parseExpr(scope.func(name).body); return asts[name]; },
      model(name) { return sub.models[name] || lib.models[name] || null; }
    };
    return scope;
  }

  // ---------------------------------------------------------------------------
  // A subcircuit compiled to an evaluator: pin voltages (by pin order) in, pin currents out
  // ---------------------------------------------------------------------------
  const VT = 0.025852;
  function compile(text, subName, overrides) {
    const lib = typeof text === "string" ? parseLib(text) : text;
    const sub = subName ? lib.subckts.find(s => s.name.toLowerCase() === String(subName).toLowerCase()) : lib.subckts[0];
    if (!sub) throw new Error(subName ? `no .SUBCKT ${subName}` : "no .SUBCKT in the text");
    const scope = makeScope(lib, sub, overrides), warnings = [];
    const names = ["0"].concat(sub.pins), idx = n => { n = n.toLowerCase(); if (n === "gnd") n = "0"; let k = names.indexOf(n); if (k < 0) { names.push(n); k = names.length - 1; } return k; };
    sub.pins.forEach(idx);
    const value = (src, line) => { try { const n = num(src); return !isNaN(n) ? n : compileExpr(parseExpr(unbrace(src)), scope, () => 0)([0]); } catch (e) { throw new Error(`line ${line}: ${e.message}`); } };
    // the nodes an expression reads (through .FUNC bodies too), for the order of evaluation
    const refs = (ast, out) => {
      if (!ast || typeof ast !== "object") return out;
      if (ast.k === "v") { out.add(idx(ast.a)); out.add(idx(ast.b)); }
      if (ast.k === "f" && scope.func(ast.s)) refs(scope.funcAst(ast.s), out);
      ["x", "a", "b", "c"].forEach(k => { if (ast[k] && typeof ast[k] === "object") refs(ast[k], out); });
      (ast.args || []).forEach(a => refs(a, out));
      return out;
    };
    const fn = (src, line) => { try { const ast = parseExpr(unbrace(src)), f = compileFast(ast, scope, idx); f.deps = refs(ast, new Set()); return f; } catch (e) { throw new Error(`line ${line}: ${e.message}`); } };
    const els = [];   // R { a, b, g } · D { a, b, is, n } · I { a, b, f } · VD { a, b, f } (V(a) − V(b) = f)
    let ignored = 0;
    sub.els.forEach(({ s, no }) => {
      const tk = tokens(s), kind = s[0].toUpperCase(), name = tk[0];
      const sn = s.replace(/\s*=\s*/g, "="), exprAfter = re => { const m = re.exec(sn); return m ? sn.slice(m.index + m[0].length).trim() : null; };
      if (kind === "R" || kind === "C" || kind === "L") {
        if (tk.length < 4) throw new Error(`line ${no}: ${name} needs two nodes and a value`);
        if (kind === "C") { ignored++; return; }
        const v = value(tk[3].replace(/^[rl]=/i, ""), no);
        if (kind === "L") els.push({ t: "VD", a: idx(tk[1]), b: idx(tk[2]), f: () => 0 });
        else if (v > 0) els.push({ t: "R", a: idx(tk[1]), b: idx(tk[2]), g: 1 / v });
      } else if (kind === "D") {
        const m = scope.model((tk[3] || "").toLowerCase());
        if (!m) throw new Error(`line ${no}: no .MODEL ${tk[3]}`);
        const p = m.p; els.push({ t: "D", a: idx(tk[1]), b: idx(tk[2]), is: num(p.is || "1e-14") || 1e-14, n: num(p.n || "1") || 1, rs: num(p.rs || "0") || 0 });
      } else if (kind === "B") {
        const iE = exprAfter(/\bI=/i), vE = exprAfter(/\bV=/i);
        if (iE !== null) els.push({ t: "I", a: idx(tk[1]), b: idx(tk[2]), f: fn(iE, no) });
        else if (vE !== null) els.push({ t: "VD", a: idx(tk[1]), b: idx(tk[2]), f: fn(vE, no) });
        else throw new Error(`line ${no}: ${name} needs I= or V=`);
      } else if (kind === "E" || kind === "G") {
        const vE = exprAfter(/\bVALUE=/i);
        let f;
        if (vE !== null) f = fn(vE, no);
        else if (/\b(POLY|TABLE|LAPLACE|FREQ)\b/i.test(s)) throw new Error(`line ${no}: ${name}: ${/\b(POLY|TABLE|LAPLACE|FREQ)\b/i.exec(s)[1].toUpperCase()} sources are not supported`);
        else if (tk.length >= 6) { const c = idx(tk[3]), d = idx(tk[4]), gain = value(tk[5], no); f = V => gain * (V[c] - V[d]); f.deps = new Set([c, d]); }
        else throw new Error(`line ${no}: ${name} not understood`);
        els.push({ t: kind === "E" ? "VD" : "I", a: idx(tk[1]), b: idx(tk[2]), f });
      } else if (kind === "V") {
        const v = value(tk.slice(3).filter(t => !/^dc$/i.test(t))[0] || "0", no);
        els.push({ t: "VD", a: idx(tk[1]), b: idx(tk[2]), f: () => v });
      } else if (kind === "X") throw new Error(`line ${no}: subcircuits inside subcircuits (${name}) are not supported`);
      else if (kind === "F" || kind === "H") throw new Error(`line ${no}: current-controlled sources (${name}) are not supported`);
      else throw new Error(`line ${no}: element ${name} is not supported`);
    });
    if (ignored) warnings.push(`${ignored} capacitor${ignored > 1 ? "s" : ""} ignored (the simulator's tubes have no capacitances)`);
    const nPins = sub.pins.length, N = names.length;
    // nodes driven by voltage sources: the order to compute them in
    const known = new Set([0, ...sub.pins.map((_, i) => i + 1)]), driven = [];
    const vds = els.filter(e => e.t === "VD");
    let progress = true;
    while (progress) {
      progress = false;
      vds.forEach(e => {
        if (e.done) return;
        if (known.has(e.b) && !known.has(e.a)) { e.node = e.a; e.ref = e.b; e.sign = 1; }
        else if (known.has(e.a) && !known.has(e.b)) { e.node = e.b; e.ref = e.a; e.sign = -1; }
        else if (known.has(e.a) && known.has(e.b)) throw new Error("a voltage source between two pins (or a loop of them) is not supported");
        else return;
        e.done = true; known.add(e.node); driven.push(e); progress = true;
      });
    }
    // undriven internal nodes are solved; one that nothing conducts to is left at 0 V
    const unknown = [];
    for (let k = 1; k < N; k++) if (!known.has(k) && els.some(e => e.t !== "VD" && (e.a === k || e.b === k))) unknown.push(k);
    vds.forEach(e => { if (!e.done) { e.done = true; e.node = e.a; e.ref = e.b; e.sign = 1; driven.push(e); } });
    // sources in dependency order; the ones that depend on an unknown node are redone in Newton
    const order = [], state = new Map(), byNode = new Map(driven.map(e => [e.node, e]));
    const visit = e => {
      if (state.get(e) === 2) return; if (state.get(e) === 1) throw new Error("an algebraic loop of voltage sources is not supported");
      state.set(e, 1);
      [...(e.f.deps || []), e.ref].forEach(k => { const d = byNode.get(k); if (d && d !== e) visit(d); });
      state.set(e, 2); order.push(e);
    };
    driven.forEach(visit);
    const unk = new Set(unknown), live = new Set();
    order.forEach(e => { if ([...(e.f.deps || []), e.ref].some(k => unk.has(k) || (byNode.get(k) && live.has(byNode.get(k))))) live.add(e); });
    const fixedOrder = order.filter(e => !live.has(e)), liveOrder = order.filter(e => live.has(e));
    const touching = k => els.filter(e => e.t !== "VD" && (e.a === k || e.b === k));
    const atUnknown = unknown.map(touching), atDriven = new Map(driven.map(e => [e, touching(e.node)]));
    const V = new Float64Array(N), guess = new Float64Array(unknown.length), Iout = new Float64Array(sub.pins.length);
    const diodeI = (e, v) => { const x = v / (e.n * VT); return x > 40 ? e.is * Math.exp(40) * (1 + x - 40) : e.is * (Math.exp(x) - 1); };
    const elI = e => (e.t === "R" ? (V[e.a] - V[e.b]) * e.g : e.t === "D" ? diodeI(e, V[e.a] - V[e.b]) : e.t === "I" ? e.f(V) : 0);
    // driven nodes may depend on each other in any order: a few sweeps settle them (no loops)
    const drive = () => { for (const e of liveOrder) V[e.node] = V[e.ref] + e.sign * e.f(V); };
    const kcl = out => { for (let j = 0; j < unknown.length; j++) { const k = unknown[j]; let s = 0; for (const e of atUnknown[j]) s += e.a === k ? elI(e) : -elI(e); out[j] = s; } };
    function evaluate(pinV) {
      V.fill(0);
      for (let i = 0; i < nPins; i++) V[i + 1] = pinV[i];
      unknown.forEach((k, j) => { V[k] = guess[j]; });
      for (const e of fixedOrder) V[e.node] = V[e.ref] + e.sign * e.f(V);
      drive();
      if (unknown.length === 1) {
        // one internal node (a grid-current resistor and diode): scalar Newton, nothing allocated
        const k = unknown[0], els1 = atUnknown[0];
        const r = () => { let s = 0; for (const e of els1) s += e.a === k ? elI(e) : -elI(e); return s; };
        let f = r();
        for (let it = 0; it < 100 && Math.abs(f) > 1e-14; it++) {
          const x = V[k], h = 1e-7 * Math.max(1, Math.abs(x));
          V[k] = x + h; drive(); const d = (r() - f) / h;
          if (!(d !== 0 && isFinite(d))) { V[k] = x; drive(); break; }
          const step = -f / d; let a = 1, ok = false, f2 = f;
          for (let q = 0; q < 40; q++, a /= 2) { V[k] = x + a * step; drive(); f2 = r(); if (Math.abs(f2) < Math.abs(f)) { ok = true; break; } }
          if (!ok) { V[k] = x; drive(); break; }
          f = f2;
          if (Math.abs(a * step) < 1e-12) break;
        }
        guess[0] = V[k];
      } else if (unknown.length) {
        // Newton on Kirchhoff's law at the undriven nodes, with a backtracking line search
        // (full steps, halved until the residual falls: diodes from any starting point)
        const n = unknown.length, F = new Float64Array(n), F2 = new Float64Array(n), J = Array.from({ length: n }, () => new Float64Array(n)), x0 = new Float64Array(n);
        const norm = f => { let m = 0; for (let r = 0; r < n; r++) m = Math.max(m, Math.abs(f[r])); return m; };
        const setX = (base, d, a) => { unknown.forEach((k, j) => { V[k] = base[j] + a * d[j]; }); drive(); };
        kcl(F);
        for (let it = 0; it < 100 && norm(F) > 1e-14; it++) {
          for (let c = 0; c < n; c++) { const k = unknown[c], h = 1e-7 * Math.max(1, Math.abs(V[k])); V[k] += h; drive(); kcl(F2); for (let r = 0; r < n; r++) J[r][c] = (F2[r] - F[r]) / h; V[k] -= h; }
          drive();
          const A = J.map((row, r) => [...row, -F[r]]);
          for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; [A[c], A[p]] = [A[p], A[c]]; const dd = A[c][c] || 1e-30; for (let r = 0; r < n; r++) if (r !== c) { const m = A[r][c] / dd; for (let q = c; q <= n; q++) A[r][q] -= m * A[c][q]; } }
          const d = new Float64Array(n); for (let c = 0; c < n; c++) d[c] = A[c][n] / (A[c][c] || 1e-30);
          unknown.forEach((k, j) => { x0[j] = V[k]; });
          const f0 = norm(F); let a = 1, ok = false;
          for (let h = 0; h < 40; h++, a /= 2) { setX(x0, d, a); kcl(F2); if (norm(F2) < f0) { ok = true; break; } }
          if (!ok) { setX(x0, d, 0); break; }
          F.set(F2);
          if (norm(d) * a < 1e-12) break;
        }
        unknown.forEach((k, j) => { guess[j] = V[k]; });
      }
      // current into each pin: through every element touching it; a voltage source carries what
      // leaves its driven node through the other elements
      const I = Iout; I.fill(0);
      els.forEach(e => {
        if (e.t === "VD") return;
        const i = elI(e);
        if (e.a >= 1 && e.a <= nPins) I[e.a - 1] += i;
        if (e.b >= 1 && e.b <= nPins) I[e.b - 1] -= i;
      });
      driven.forEach(e => {
        if (e.ref < 1 || e.ref > nPins) return;
        let out = 0; for (const q of atDriven.get(e)) out += q.a === e.node ? elI(q) : -elI(q);
        I[e.ref - 1] += out;                              // what leaves the driven node comes in through the reference
      });
      for (let i = 0; i < nPins; i++) if (!isFinite(I[i])) I[i] = 0;
      return I;
    }
    return { name: sub.name, pins: sub.pins.slice(), hint: sub.hint, warnings: warnings.concat(lib.warnings), evaluate };
  }

  // ---------------------------------------------------------------------------
  // As a tube: pin roles A, G (or G1), G2, K, TIE (to the cathode: suppressor, heater, beam plates)
  // ---------------------------------------------------------------------------
  const roleOf = word => {
    const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (/^(p|a|pl|plate|anode|a1|p1)$/.test(w)) return "A";
    if (/^(g2|s|sg|screen|g2grid)$/.test(w)) return "G2";
    if (/^(g|g1|grid|cg|controlgrid)$/.test(w)) return "G";
    if (/^(k|c|cath|cathode|k1)$/.test(w)) return "K";
    if (/^(g3|su|sup|suppressor|bp|beam|h|f|h1|h2|heater|fil|filament|nc|ic)$/.test(w)) return "TIE";
    return null;
  };
  /** Roles read from the subcircuit's comment or its pin names (null when they do not say) */
  function hintMap(c) {
    const fromNames = c.pins.map(roleOf);
    if (fromNames.every(Boolean) && fromNames.includes("A") && fromNames.includes("K")) return fromNames;
    const words = String(c.hint || "").split(/[\s,;:|/()]+/).map(roleOf).filter(Boolean);
    for (let i = 0; i + c.pins.length <= words.length; i++) { const w = words.slice(i, i + c.pins.length); if (w.includes("A") && w.includes("K") && w.includes("G")) return w; }
    return null;
  }
  const kindOf = map => (map.includes("G2") ? "pentode" : "triode");
  function adapter(c, roles) {
    const n = c.pins.length, pv = new Float64Array(n), sel = r => roles.map((x, i) => (x === r ? i : -1)).filter(i => i >= 0);
    const A = sel("A"), G = sel("G"), G2 = sel("G2"), sum = (I, s) => { let t = 0; for (let j = 0; j < s.length; j++) t += I[s[j]]; return t; };
    const run = (va, vg, vg2) => { for (let i = 0; i < n; i++) pv[i] = roles[i] === "A" ? va : roles[i] === "G" ? vg : roles[i] === "G2" ? vg2 : 0; return c.evaluate(pv); };
    const pentode = kindOf(roles) === "pentode";
    return {
      kind: pentode ? "pentode" : "triode",
      /** [ia, ig, ig2] */ pentode(vak, vgk, vg2k) { const I = run(vak, vgk, vg2k); return [sum(I, A), sum(I, G), sum(I, G2)]; },
      /** [ia, ig] — a pentode model is triode-connected (screen to plate) */
      triode(vak, vgk) { const I = run(vak, vgk, vak); return [sum(I, A) + (pentode ? sum(I, G2) : 0), sum(I, G)]; }
    };
  }
  // how much a mapping behaves like a tube (the guess when the comment says nothing)
  function plausibility(c, roles) {
    try {
      const t = adapter(c, roles); let s = 0;
      if (t.kind === "triode") {
        const ia = (va, vg) => t.triode(va, vg)[0], i0 = ia(200, -1);
        if (i0 > 1e-5 && i0 < 2) s++;
        if (ia(200, -0.5) > i0 && i0 > ia(200, -2)) s++;
        if (ia(250, -1) > ia(150, -1)) s++;
        if (Math.abs(t.triode(200, -2)[1]) < 0.02 * Math.max(i0, 1e-6)) s++;
        if (ia(200, -400) < 1e-6) s++;
        return s / 5;
      }
      let vg = -2; for (const g of [-2, -5, -10, -20, -40]) { const i = t.pentode(250, g, 250)[0]; vg = g; if (i < 0.3) break; }
      const [ia, ig, ig2] = t.pentode(250, vg, 250);
      if (ia > 1e-4 && ia < 2) s++;
      if (ig2 > 0 && ig2 < ia) s++;
      if (t.pentode(250, vg + 1, 250)[0] > ia) s++;
      if (t.pentode(250, vg, 300)[0] > ia) s++;
      const r = t.pentode(350, vg, 250)[0] / Math.max(ia, 1e-12); if (r > 0.95 && r < 1.5) s++;
      if (Math.abs(ig) < 0.02 * Math.max(ia, 1e-6)) s++;
      return s / 6;
    } catch (e) { return 0; }
  }
  function permutations(arr) { if (arr.length <= 1) return [arr]; const out = []; arr.forEach((x, i) => permutations(arr.slice(0, i).concat(arr.slice(i + 1))).forEach(p => out.push([x, ...p]))); return out; }
  /** The pin roles that make the subcircuit behave like a tube: the comment's, if it does; else the best assignment */
  function guessRoles(c) {
    const n = c.pins.length, hint = hintMap(c), cands = [];
    if (hint) cands.push({ roles: hint, bonus: 0.15 });
    const sets = n === 3 ? [["A", "G", "K"]] : n === 4 ? [["A", "G", "G2", "K"], ["A", "G", "K", "TIE"]] : n === 5 ? [["A", "G", "G2", "K", "TIE"], ["A", "G", "K", "TIE", "TIE"]] : [];
    const seen = new Set();
    sets.forEach(s => permutations(s).forEach(p => { const k = p.join(","); if (!seen.has(k)) { seen.add(k); cands.push({ roles: p, bonus: 0 }); } }));
    let best = null;
    cands.forEach(cd => { const sc = plausibility(c, cd.roles) + cd.bonus; if (!best || sc > best.score + 1e-9) best = { roles: cd.roles, score: sc, fromHint: cd.bonus > 0 }; });
    return best || { roles: hint || c.pins.map(() => "TIE"), score: 0, fromHint: !!hint };
  }

  // compiled models by their text, pin roles and name (the worker gets plain data each run)
  const cache = new Map();
  /** spec: { text, sub, roles } -> adapter { kind, triode(vak, vgk) -> [ia, ig], pentode(vak, vgk, vg2k) -> [ia, ig, ig2] } */
  function tube(spec) {
    const key = spec.sub + "\u0000" + spec.roles.join(",") + "\u0000" + spec.text;
    let a = cache.get(key);
    if (!a) { a = adapter(compile(spec.text, spec.sub), spec.roles); cache.set(key, a); if (cache.size > 50) cache.delete(cache.keys().next().value); }
    return a;
  }
  /** Small-signal numbers at a typical point (sweep ranges, the inspector): { mu, gm, rp, va, vg, ia } */
  function estimate(spec, vaMax) {
    const t = tube(spec), va = Math.min(250, (vaMax || 300) * 0.6);
    if (t.kind === "pentode") {
      let vg = -1; for (const g of [-1, -2, -5, -10, -20, -40, -60]) { vg = g; if (t.pentode(va, g, va)[0] < 0.4 * Math.max(t.pentode(va, 0, va)[0], 1e-9)) break; }
      const d = 0.1, g1 = (t.pentode(va, vg + d, va)[0] - t.pentode(va, vg - d, va)[0]) / (2 * d), g2 = (t.pentode(va, vg, va + 1)[0] - t.pentode(va, vg, va - 1)[0]) / 2;
      return { mu: Math.max(1, Math.min(200, g2 > 0 ? g1 / g2 : 10)), gm: g1, va, vg, ia: t.pentode(va, vg, va)[0] };
    }
    let vg = -0.5; for (const g of [-0.5, -1, -2, -4, -8, -16, -32, -64]) { vg = g; if (t.triode(va, g)[0] < 0.5 * Math.max(t.triode(va, 0)[0], 1e-9)) break; }
    const d = 0.05, gm = (t.triode(va, vg + d)[0] - t.triode(va, vg - d)[0]) / (2 * d), ga = (t.triode(va + 2, vg)[0] - t.triode(va - 2, vg)[0]) / 4;
    const rp = ga > 0 ? 1 / ga : Infinity;
    return { mu: Math.max(1, Math.min(200, isFinite(rp) ? gm * rp : 100)), gm, rp, va, vg, ia: t.triode(va, vg)[0] };
  }

  // ---------------------------------------------------------------------------
  // Imported tubes in the tube database: like an existing tube (socket, pinout, ratings),
  // with the SPICE model in place of the Koren parameters. Kept in the browser and in circuit files.
  // ---------------------------------------------------------------------------
  const STORE = "tubecad_custom_tubes_v1";
  /** { name, text, sub, roles, like, paMax, vaMax } -> a tube database entry */
  function makeTube(o) {
    const db = root.TUBE_DATABASE || [], like = db.find(t => t.commonName === o.like) || {};
    const kind = kindOf(o.roles), text = extract(o.text, o.sub) || o.text, spec = { text, sub: o.sub, roles: o.roles.slice() };
    const est = estimate(spec, o.vaMax || like.vaMax);
    const model = { spice: spec, mu: +est.mu.toFixed(2) };
    return {
      nameGost: o.name, nameWestern: o.name, commonName: o.name,
      type: `${kind === "pentode" ? "Pentode" : "Triode"} (SPICE model ${o.sub})`, category: like.category || (kind === "pentode" ? "power" : "small_signal"), origin: "SPICE import",
      socket: like.socket || "", pinCount: like.pinCount || 0, pinout: like.pinout || [], vh: like.vh || 0, ih: like.ih || 0, heaterWarning: like.heaterWarning || "",
      vaMax: +o.vaMax || like.vaMax || 300, paMax: +o.paMax || like.paMax || 1, ikMax: like.ikMax || 0, vg2Max: like.vg2Max || 0,
      limits: like.limits ? Object.assign({}, like.limits) : {}, directlyHeated: !!like.directlyHeated, caps: like.caps || null,
      koren: kind === "pentode" ? { Pentode: model } : { Triode: model },
      custom: { text, sub: o.sub, roles: o.roles.slice(), like: o.like || "", kind }
    };
  }
  const isCustom = t => !!(t && t.custom);
  function register(entry) {
    const db = root.TUBE_DATABASE; if (!db || !entry || !entry.commonName) return null;
    const at = db.findIndex(t => t.commonName === entry.commonName);
    if (at >= 0 && !isCustom(db[at])) throw new Error(`${entry.commonName} is a built-in tube: choose another name`);
    if (at >= 0) db[at] = entry; else db.push(entry);
    return entry;
  }
  function saved() { try { const a = JSON.parse(root.localStorage.getItem(STORE)); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function persist() { try { root.localStorage.setItem(STORE, JSON.stringify((root.TUBE_DATABASE || []).filter(isCustom))); } catch (e) { /* storage off: they last this session */ } }
  function add(entry) { register(entry); persist(); return entry; }
  function remove(name) { const db = root.TUBE_DATABASE || [], at = db.findIndex(t => t.commonName === name && isCustom(t)); if (at >= 0) db.splice(at, 1); persist(); }
  function loadSaved() { saved().forEach(e => { try { register(e); } catch (err) { /* a built-in of that name now exists */ } }); }
  if (root.localStorage && root.TUBE_DATABASE) loadSaved();

  root.SpiceModel = { num, parseLib, extract, parseExpr, compile, guessRoles, hintMap, plausibility, adapter, tube, estimate, makeTube, register, add, remove, isCustom, loadSaved, kindOf, STORE };
})(typeof window !== "undefined" ? window : globalThis);
