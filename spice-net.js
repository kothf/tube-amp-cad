/* =============================================================================
   SPICE PARTS — any SPICE subcircuit or .MODEL as a part of the circuit. No DOM: used
   by the CAD (the part's build), the board, the workers and the Node tests.

   flatten(text, name) reads a library (SpiceModel.parseLib) and turns one .SUBCKT, with
   the subcircuits it calls, into the simulator's own elements on local nodes:
     R C L K · V I (their DC values) · D Q M J with their .MODEL (diode, Gummel–Poon BJT,
     level 1 to 3 MOSFET and LTspice's VDMOS as the square law, JFET) · E G F H, linear,
     VALUE = {…}, TABLE and POLY(n) · B (I = or V =) · S and W switches · X.
   What depends on voltages or currents by an expression becomes a behavioural source
   (the engine's kind B) with a closed expression tree: parameters are numbers by then,
   .FUNC bodies are inlined, nodes are the element's own.
   A lone .MODEL (a transistor or a diode from a maker's file) is wrapped as a part with
   that device's pins.

   Junction capacitances follow the voltage across them (the engine's capAt, stepped by its
   chargeAt); a transistor's transit times TF and TR store charge in the waveform and the
   small-signal analyses; a VDMOS's Cgd follows CGDMIN … CGDMAX (A). Not carried over: temperature terms
   and noise parameters. Not supported (an error): LAPLACE and FREQ sources,
   transmission lines, BSIM MOSFETs, time-dependent expressions.

   build(spec, pinNodes, alloc, id) gives the engine's elements for one part of a circuit.
   ============================================================================= */
(function (root) {
  "use strict";
  const SM = root.SpiceModel;
  const VT = 0.025852;
  // The engine rounds a FET's turn-on over 50 mV for its own parts; a maker's model sets the
  // gain of an input pair by a few tens of millivolts of overdrive, so here the corner is sharp.
  const FET_S = 0.002;
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
        if (ast.s === "time") throw new Error("time-dependent expressions are not supported");
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
          const v = first && !/^(ac|sin|pulse|pwl|exp|sffm|rser=|cpar=)/i.test(first) ? val(first, no) : 0;
          if (rest.some(t => /^(sin|pulse|pwl|exp|sffm)/i.test(t))) warn.add("A signal source inside the model is taken at its DC value");
          push(kind === "V" ? { name: prefix + nm, kind: "V", n: [node(tk[1]), node(tk[2])], v } : { name: prefix + nm, kind: "I", n: [node(tk[1]), node(tk[2])], i: v });
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
          mos(prefix + nm, node(tk[1]), node(tk[2]), node(tk[3]), model(tk[mi], no), params(tk.slice(mi + 1)), no);
        } else if (kind === "J") {
          need(5);
          const m = model(tk[4], no), area = areaOf(tk[5], no);
          if (m.type !== "njf" && m.type !== "pjf") throw new Error(`${at(no)}${tk[4]} is not a JFET model`);
          jfet(prefix + nm, node(tk[1]), node(tk[2]), node(tk[3]), m, area, no);
        } else if (kind === "E" || kind === "G" || kind === "F" || kind === "H") {
          need(4);
          const a = node(tk[1]), b = node(tk[2]), out = kind === "E" || kind === "H" ? "v" : "i", byI = kind === "F" || kind === "H";
          const lap = /\b(LAPLACE|FREQ|CHEBYSHEV)\b/i.exec(s);
          if (lap) throw new Error(`${at(no)}${tk[0]}: ${lap[1].toUpperCase()} sources are not supported`);
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
          if (/\blaplace\s*=/i.test(sn)) throw new Error(`${at(no)}${tk[0]}: LAPLACE sources are not supported`);
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
        } else if (kind === "T" || kind === "O" || kind === "U") throw new Error(`${at(no)}transmission lines (${tk[0]}) are not supported`);
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
        const el = { name: nm, kind: "BJT", n: [c2, b2, e2], model: mdl }, tf = mp(m, "tf", 0, no);
        if (tf > 0) el.tf = tf;
        const tr = mp(m, "tr", 0, no); if (tr > 0) el.tr = tr;
        if (rb > 0 || re > 0 || rc > 0) el.ext = [c, b, e];
        push(el);
        const cje = mp(m, "cje", 0, no) * area, cjc = mp(m, "cjc", 0, no) * area;
        const je = junc(m, "vje|pe", "mje|me", no, 0.75, 0.33), jc = junc(m, "vjc|pc", "mjc|mc", no, 0.75, 0.33);
        if (pol > 0) { cap(nm + "#cje", b2, e2, cje, je); cap(nm + "#cjc", b2, c2, cjc, jc); } else { cap(nm + "#cje", e2, b2, cje, je); cap(nm + "#cjc", c2, b2, cjc, jc); }
      }
      function mos(nm, d, g, s, m, ip, no) {
        const vd = m.type === "vdmos";
        if (m.type !== "nmos" && m.type !== "pmos" && !vd) throw new Error(`${at(no)}${nm}: not a MOSFET model`);
        const pol = vd ? (m.p.pchan ? -1 : 1) : m.type === "nmos" ? 1 : -1, level = vd ? 1 : mp(m, "level", 1, no);
        if (level > 3) throw new Error(`${at(no)}${nm}: MOSFET model level ${level} (BSIM) is not supported`);
        if (level > 1) warn.add(`MOSFET level ${level} models run as the square law (level 1): mobility and short-channel terms are left out`);
        const mult = ip.m !== undefined ? val(ip.m, no) : 1, w = ip.w !== undefined ? val(ip.w, no) : mp(m, "w", 1e-4, no), l = ip.l !== undefined ? val(ip.l, no) : mp(m, "l", 1e-4, no);
        const ld = vd ? 0 : mp(m, "ld", 0, no), leff = Math.max(l - 2 * ld, 1e-9);
        let kp = mp(m, "kp", NaN, no);
        if (isNaN(kp)) { const uo = mp(m, "uo", 600, no), tox = mp(m, "tox", 1e-7, no); kp = uo * 1e-4 * 3.9 * 8.854e-12 / tox; }
        const beta = vd ? kp * mult : kp * (w / leff) * mult, vto = mp(m, "vto|vt0", 0, no);
        const d2 = series(nm + "#rd", d, mp(m, "rd", 0, no) / mult), s2 = series(nm + "#rs", s, mp(m, "rs", 0, no) / mult), g2 = series(nm + "#rg", g, mp(m, "rg", 0, no));
        push({ name: nm, kind: "MOS", n: [d2, g2, s2], model: { pol, vto, kp: beta, lambda: mp(m, "lambda", 0, no), s: FET_S } });
        if (vd) {
          // the body diode and the capacitances of LTspice's VDMOS
          const is = mp(m, "is", 1e-14, no), bd = series(nm + "#rb", pol > 0 ? s2 : d2, mp(m, "rb", 0, no));
          push({ name: nm + "#body", kind: "D", n: pol > 0 ? [bd, d2] : [bd, s2], is, n_: mp(m, "n", 1, no), tt: mp(m, "tt", 0, no) || undefined });
          // Cgd follows VDMOS's law in vgd (CGDMIN … CGDMAX, A), the drain-source C the body diode's junction law
          cap(nm + "#cgs", g2, s2, mp(m, "cgs", 0, no));
          const cmin = mp(m, "cgdmin", 0, no), cmax = m.p.cgdmax !== undefined ? mp(m, "cgdmax", 0, no) : undefined;
          if (cmax !== undefined && cmax > 0 && g2 !== d2) push({ name: nm + "#cgd", kind: "C", n: pol > 0 ? [g2, d2] : [d2, g2], c: cmin, vdm: { min: cmin, max: cmax, a: mp(m, "a", 1, no) } });
          else cap(nm + "#cgd", g2, d2, cmin);
          cap(nm + "#cds", pol > 0 ? s2 : d2, pol > 0 ? d2 : s2, mp(m, "cjo", 0, no), junc(m, "vj", "m", no, 1, 0.5));
        } else {
          cap(nm + "#cgs", g2, s2, mp(m, "cgso", 0, no) * w * mult); cap(nm + "#cgd", g2, d2, mp(m, "cgdo", 0, no) * w * mult); cap(nm + "#cbd", d2, s2, mp(m, "cbd", 0, no) * mult);
        }
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

  root.SpiceNet = { extract, list, flatten, flat, build, close, evalClosed, polyAst, DEVICE_PINS, DEVICE_NAME };
})(typeof window !== "undefined" ? window : globalThis);
