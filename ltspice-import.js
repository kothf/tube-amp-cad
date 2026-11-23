/* LTspice import: an LTspice schematic (.asc) as a circuit of the app's parts.
   Resistors, capacitors, inductors, diodes, transistors, DC and signal sources become the app's own
   parts (simulated); the parts it has no part for (LTspice's own ICs, controlled sources, switches)
   are kept as drawn boxes with their pins: wired, on the board, not simulated. A model in the
   schematic's own .model / .subckt text, or in a model file opened with it, is used as written (a
   SPICE part). The symbols' pins come from LTspice's standard symbols (positions only), from .asy
   files opened with the schematic, or, for a symbol neither has, from the wires that end by it.
   Used by cad-kicad.js (File ▾ → Open LTspice schematic…). */
(function (root) {
  "use strict";

  // LTspice's standard symbols: where their pins are (LTspice units, y down, from the origin) and
  // the SPICE order. [name, x, y]
  const SYMS = {
    res: [["A", 16, 16], ["B", 16, 96]], res2: [["A", 16, 0], ["B", 16, 64]],
    cap: [["A", 16, 0], ["B", 16, 64]], polcap: [["A", 16, 0], ["B", 16, 64]],
    ind: [["A", 16, 16], ["B", 16, 96]], ind2: [["A", 16, 16], ["B", 16, 96]],
    diode: [["+", 16, 0], ["-", 16, 64]], schottky: [["+", 16, 0], ["-", 16, 64]], zener: [["+", 16, 0], ["-", 16, 64]],
    led: [["+", 16, 0], ["-", 16, 64]], varactor: [["+", 16, 0], ["-", 16, 64]], tvsdiode: [["+", 16, 0], ["-", 16, 64]],
    npn: [["C", 64, 0], ["B", 0, 48], ["E", 64, 96]], pnp: [["C", 64, 0], ["B", 0, 48], ["E", 64, 96]],
    npn2: [["C", 64, 0], ["B", 0, 48], ["E", 64, 96]], pnp2: [["C", 64, 0], ["B", 0, 48], ["E", 64, 96]],
    nmos: [["D", 48, 0], ["G", 0, 80], ["S", 48, 96]], pmos: [["D", 48, 0], ["G", 0, 80], ["S", 48, 96]],
    nmos4: [["D", 48, 0], ["G", 0, 80], ["S", 48, 96], ["B", 48, 48]], pmos4: [["D", 48, 0], ["G", 0, 80], ["S", 48, 96], ["B", 48, 48]],
    njf: [["D", 48, 0], ["G", 0, 64], ["S", 48, 96]], pjf: [["D", 48, 0], ["G", 0, 64], ["S", 48, 96]],
    voltage: [["+", 0, 16], ["-", 0, 96]], current: [["+", 0, 0], ["-", 0, 80]],
    bv: [["+", 0, 16], ["-", 0, 96]], bi: [["+", 0, 0], ["-", 0, 80]], bi2: [["+", 0, 0], ["-", 0, 80]],
    e: [["+", 0, 16], ["-", 0, 96], ["P", -48, 32], ["N", -48, 80]], e2: [["+", 0, 16], ["-", 0, 96], ["P", -48, 32], ["N", -48, 80]],
    g: [["+", 0, 96], ["-", 0, 16], ["NC+", -48, 32], ["NC-", -48, 80]], g2: [["+", 0, 96], ["-", 0, 16], ["NC+", -48, 32], ["NC-", -48, 80]],
    f: [["+", 0, 0], ["-", 0, 80]], h: [["+", 0, 16], ["-", 0, 96]],
    sw: [["A", 0, 16], ["B", 0, 96], ["NC+", -48, 80], ["NC-", -48, 32]], csw: [["+", 0, 0], ["-", 0, 80]],
    tline: [["I1", -48, -16], ["R1", -48, 16], ["I2", 48, -16], ["R2", 48, 16]],
    ferritebead: [["A", 0, -32], ["B", 0, 32]], ferritebead2: [["A", 0, -32], ["B", 0, 32]],
    "opamps\\opamp": [["In-", -32, 48], ["In+", -32, 80], ["OUT", 32, 64]],
    "opamps\\opamp2": [["In+", -32, 80], ["In-", -32, 48], ["V+", 0, 32], ["V-", 0, 96], ["OUT", 32, 64]],
    "opamps\\universalopamp2": [["In+", -32, 16], ["In-", -32, -16], ["V+", 0, -32], ["V-", 0, 32], ["OUT", 32, 0]],
    "opamps\\universalopamp": [["In+", -32, 16], ["In-", -32, -16], ["V+", 0, -32], ["V-", 0, 32], ["OUT", 32, 0]],
  };
  // LTspice's five-pin op-amp symbol, which its op-amp models (LT1001, AD8610 …) use
  const OPAMP5 = SYMS["opamps\\opamp2"];
  const U = 10 / 16;           // LTspice's grid of 16 is the app's grid of 10
  const sc = v => Math.round(v * U);

  /** The file's text: LTspice writes UTF-16 (newer versions), UTF-8 or Windows-1252 */
  function decode(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8.subarray(2));
    if (u8.length > 3 && u8[1] === 0 && u8[3] === 0) return new TextDecoder("utf-16le").decode(u8);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8).replace(/^\uFEFF/, ""); } catch (e) { return new TextDecoder("windows-1252").decode(u8); }
  }

  /** An .asc file: { sheet, wires: [[x1, y1, x2, y2]], flags: [{ x, y, name }], ios: [{ x, y, dir }],
      symbols: [{ name, x, y, rot, mirror, attrs: {}, windows }], texts: [{ x, y, text, directive }], drawn } */
  function readAsc(text) {
    const out = { version: null, sheet: null, wires: [], flags: [], ios: [], symbols: [], texts: [], drawn: 0, buses: 0 };
    if (!/^\s*Version\s+\d/i.test(String(text).replace(/^\uFEFF/, ""))) throw new Error("not an LTspice schematic (no Version line)");
    let sym = null;
    String(text).split(/\r?\n/).forEach(raw => {
      const line = raw.replace(/\s+$/, ""), w = line.trim().split(/\s+/), k = (w[0] || "").toUpperCase();
      if (k === "VERSION") out.version = w[1];
      else if (k === "SHEET") out.sheet = [+w[2], +w[3]];
      else if (k === "WIRE") out.wires.push([+w[1], +w[2], +w[3], +w[4]]);
      else if (k === "FLAG") out.flags.push({ x: +w[1], y: +w[2], name: line.trim().split(/\s+/).slice(3).join(" ") });
      else if (k === "IOPIN") out.ios.push({ x: +w[1], y: +w[2], dir: w[3] || "" });
      else if (k === "SYMBOL") {
        const r = w[w.length - 1], m = /^([RM])(\d+)$/i.exec(r) || ["", "R", "0"];
        sym = { name: w.slice(1, w.length - 3).join(" "), x: +w[w.length - 3], y: +w[w.length - 2], rot: (+m[2] / 90) & 3, mirror: m[1].toUpperCase() === "M", attrs: {} };
        out.symbols.push(sym);
      } else if (k === "SYMATTR" && sym) {
        const m = /^\s*SYMATTR\s+(\S+)\s?(.*)$/i.exec(line);
        if (m) sym.attrs[m[1]] = m[2];
      } else if (k === "TEXT") {
        // TEXT x y align size !directive / ;comment; a line break is written as \n
        const m = /^\s*TEXT\s+(-?\d+)\s+(-?\d+)\s+\S+\s+\S+\s?(.*)$/i.exec(line);
        if (m) { const t = m[3], d = t[0] === "!"; out.texts.push({ x: +m[1], y: +m[2], text: (t[0] === "!" || t[0] === ";" ? t.slice(1) : t).replace(/\\n/g, "\n"), directive: d }); }
      } else if (/^(LINE|RECTANGLE|CIRCLE|ARC)$/.test(k)) out.drawn++;
      else if (k === "BUSTAP") out.buses++;
      else if (k === "WINDOW") { /* where a symbol's texts sit: the app places its own */ }
    });
    return out;
  }

  /** An .asy file (an LTspice symbol): { pins: [{ name, x, y, order }], prefix, value, model, g } */
  function readAsy(text) {
    const out = { pins: [], prefix: "", value: "", model: "", lines: [], kind: "" };
    let pin = null;
    String(text).split(/\r?\n/).forEach(raw => {
      const line = raw.trim(), w = line.split(/\s+/), k = (w[0] || "").toUpperCase();
      if (k === "SYMBOLTYPE") out.kind = w[1] || "";
      else if (k === "PIN") { pin = { name: "", x: +w[1], y: +w[2], order: out.pins.length + 1 }; out.pins.push(pin); }
      else if (k === "PINATTR" && pin) {
        const m = /^PINATTR\s+(\S+)\s?(.*)$/i.exec(line);
        if (m && /^PinName$/i.test(m[1])) pin.name = m[2]; else if (m && /^SpiceOrder$/i.test(m[1])) pin.order = +m[2] || pin.order;
      } else if (k === "SYMATTR") {
        const m = /^SYMATTR\s+(\S+)\s?(.*)$/i.exec(line);
        if (m && /^Prefix$/i.test(m[1])) out.prefix = m[2]; else if (m && /^Value$/i.test(m[1])) out.value = m[2]; else if (m && /^SpiceModel$/i.test(m[1])) out.model = m[2];
      } else if (k === "LINE" && w.length >= 6) out.lines.push(["l", +w[2], +w[3], +w[4], +w[5]]);
      else if (k === "RECTANGLE" && w.length >= 6) out.lines.push(["r", +w[2], +w[3], +w[4], +w[5]]);
      else if (k === "CIRCLE" && w.length >= 6) out.lines.push(["c", +w[2], +w[3], +w[4], +w[5]]);
    });
    out.pins.sort((a, b) => a.order - b.order);
    return out;
  }

  /** A value as LTspice reads it: 4k7, 10µ, 2.2Meg (M is milli, as in SPICE), 1e-6; null when not a number */
  function ltValue(text) {
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[fpnuµμmkgt])?(\d+)?/i.exec(String(text || ""));
    if (!m) return null;
    const mul = { f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, meg: 1e6, g: 1e9, t: 1e12, mil: 25.4e-6 }[(m[2] || "").toLowerCase()] || 1;
    let v = parseFloat(m[1]);
    if (m[3] && m[2] && !/e/i.test(m[1]) && /^\d+$/.test(m[1])) v = parseFloat(m[1] + "." + m[3]);       // 4k7: 4.7k
    v *= mul;
    return Number.isFinite(v) ? v : null;
  }
  // the numbers in SINE(0 1 1k), PULSE(...), as values
  const args = t => { const m = /\(([^)]*)\)/.exec(t); return m ? m[1].trim().split(/[\s,]+/).filter(Boolean).map(ltValue) : []; };
  const named = (t, key) => { const m = new RegExp("\\b" + key + "\\s*=\\s*(\\S+)", "i").exec(t || ""); return m ? ltValue(m[1]) : null; };

  /** A source's value as the app's source: { type, params } or null (kept as drawn) */
  function sourceOf(value, line, current) {
    const v = String(value || "").trim(), all = v + " " + (line || ""), rs = named(all, "Rser") || 0;
    const up = v.toUpperCase();
    if (current) {
      const n = /^(DC\s+)?[+-]?[\d.]/i.test(v) ? ltValue(v.replace(/^DC\s+/i, "")) : null;
      return n !== null && !/\(/.test(v) ? { type: "isrc", params: { i: n } } : null;
    }
    if (/^SINE?\s*\(/.test(up)) { const a = args(v); return { type: "siggen", params: { wave: "sine", offset: a[0] || 0, amp: a[1] || 0, freq: a[2] || 1000, rs } }; }
    if (/^PULSE\s*\(/.test(up)) { const a = args(v); return { type: "siggen", params: { wave: "pulse", vlo: a[0] || 0, vhi: a[1] || 0, td: a[2] || 0, tr: a[3] || 1e-9, tf: a[4] || 1e-9, pw: a[5] || 1e-3, per: a[6] || 0, rs } }; }
    if (/^EXP\s*\(/.test(up)) { const a = args(v); return { type: "siggen", params: { wave: "exp", vlo: a[0] || 0, vhi: a[1] || 0, td: a[2] || 0, tau1: a[3] || 1e-4, td2: a[4] || 1e-3, tau2: a[5] || 1e-4, rs } }; }
    if (/^PWL\s*\(/.test(up)) {
      const a = args(v); if (a.length < 2 || a.some(x => x === null)) return null;
      const pts = []; for (let i = 0; i + 1 < a.length; i += 2) pts.push(`${a[i]} ${a[i + 1]}`);
      return { type: "siggen", params: { wave: "pwl", pwl: pts.join(", "), rs } };
    }
    const dc = /^(DC\s+)?[+-]?[\d.]/i.test(v) && !/\(/.test(v) ? ltValue(v.replace(/^DC\s+/i, "")) : null;
    const ac = /\bAC\s+([+-]?[\d.]\S*)/i.exec(all);
    if (dc !== null && !ac) return { type: "vdc", params: { v: dc, rs } };
    if (ac) return { type: "siggen", params: { wave: "sine", amp: ltValue(ac[1]) || 1, freq: 1000, offset: dc || 0, rs }, ac: true };
    return null;
  }

  const keyIn = (table, name) => {
    const n = String(name || "").trim().toUpperCase(); if (!n || !table) return null;
    return Object.keys(table).find(k => k.toUpperCase() === n) || null;
  };
  // the symbol's own name, without its folder, lower case: "Opamps\LT1001" → "lt1001"
  const base = n => String(n || "").split(/[\\/]/).pop().toLowerCase();

  /** An LTspice schematic as a design. files: { name: text } (the .asc, and any .asy symbols or
      model files opened with it). Returns { design: { app, version, comps, wires }, name, report } */
  // .param and .step: the parameters a schematic gives ({R} in a value), worked out to numbers.
  // .step param X a b c (or list a b …, oct/dec param X a b n) gives X its first value.
  const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan: Math.atan, pow: Math.pow, pwr: (a, b) => Math.pow(Math.abs(a), b), min: Math.min, max: Math.max, int: Math.trunc, floor: Math.floor, ceil: Math.ceil, round: Math.round, pi: Math.PI };
  function evalExpr(text, P) {
    const toks = String(text).match(/\d+\.?\d*(?:e[+-]?\d+)?[a-zµμ]*\d*|\.\d+(?:e[+-]?\d+)?[a-zµμ]*|[a-z_][\w.]*|\*\*|[-+*/^(),]|\S/gi) || [];
    const js = [];
    for (const t of toks) {
      if (/^[\d.]/.test(t)) { const v = ltValue(t); if (v === null) return null; js.push("(" + v + ")"); }
      else if (/^[a-z_]/i.test(t)) {
        const k = t.toLowerCase();
        if (P.has(k)) js.push("(" + P.get(k) + ")");
        else if (k === "pi") js.push("(" + Math.PI + ")");
        else if (FUNCS[k]) js.push("F." + k);
        else return null;
      } else if (t === "^" || t === "**") js.push("**");
      else if ("+-*/(),".includes(t)) js.push(t);
      else return null;
    }
    try { const v = Function("F", "return (" + js.join(" ") + ");")(FUNCS); return Number.isFinite(v) ? v : null; } catch (e) { return null; }
  }
  function ascParams(texts) {
    const P = new Map(), stepped = [];
    const lines = texts.filter(t => t.directive).flatMap(t => t.text.split("\n"));
    for (let pass = 0; pass < 4; pass++) lines.forEach(ln => {
      const m = /^\s*\.param\s+(.*)$/i.exec(ln);
      if (m) (m[1].match(/[a-z_][\w.]*\s*=\s*(?:\{[^}]*\}|'[^']*'|[^\s=]+(?:\s*[-+*/^]\s*[^\s=]+)*)/gi) || []).forEach(a => {
        const [, k, e] = /^([a-z_][\w.]*)\s*=\s*(.*)$/i.exec(a), v = evalExpr(e.replace(/^[{']|[}']$/g, ""), P);
        if (v !== null && !stepped.some(x => x.toLowerCase() === k.toLowerCase())) P.set(k.toLowerCase(), v);
      });
      const st = /^\s*\.step\s+(?:(?:oct|dec|lin)\s+)?param\s+([a-z_][\w.]*)\s+(?:list\s+)?(\S+)/i.exec(ln);
      if (st && pass === 0) { const v = evalExpr(st[2], P); if (v !== null) { P.set(st[1].toLowerCase(), v); stepped.push(st[1]); } }
    });
    return { P, stepped };
  }
  // {expression} in a value as its number (left as written when it cannot be worked out)
  const withParams = (text, P) => String(text).replace(/\{([^}]*)\}/g, (all, e) => { const v = evalExpr(e, P); return v === null ? all : String(+v.toPrecision(12)); });

  // a transistor or diode with no value is LTspice's default model of its kind
  const DEFAULT_MODEL = { npn: "NPN", npn2: "NPN", pnp: "PNP", pnp2: "PNP", diode: "D", schottky: "D", varactor: "D", tvsdiode: "D", zener: "D", njf: "NJF", pjf: "PJF" };
  function importAsc(files) {
    const L = root.CadLib, names = Object.keys(files || {});
    const ascName = names.find(n => /\.asc$/i.test(n));
    if (!ascName) throw new Error("no LTspice schematic (.asc) among the files");
    const A = readAsc(files[ascName]), name = ascName.split(/[\\/]/).pop().replace(/\.asc$/i, "");
    const notes = [], note = t => { if (!notes.includes(t)) notes.push(t); };
    // the schematic's parameters put into its values ({R} → 4700)
    const { P: params, stepped } = ascParams(A.texts);
    const bare = [];
    if (params.size) A.symbols.forEach(sy => ["Value", "Value2", "SpiceLine", "SpiceLine2"].forEach(k => { if (sy.attrs[k] !== undefined) sy.attrs[k] = withParams(sy.attrs[k], params); }));
    if (stepped.length) note(`LTspice steps ${stepped.join(", ")} (.step): the first value is used here; run Analyze ▾ Parameter sweep for the others.`);
    const report = { sheets: 1, parts: 0, own: 0, kept: 0, wires: 0, labels: 0, buses: 0, connectors: 0, notes, board: null, from: "LTspice", models: 0 };
    const asys = new Map(); names.filter(n => /\.asy$/i.test(n)).forEach(n => { try { asys.set(base(n.replace(/\.asy$/i, "")), readAsy(files[n])); } catch (e) { note(`${n}: ${e.message}`); } });
    // the models the schematic carries (.model / .subckt in its text) and the model files opened with it
    const modelText = A.texts.filter(t => t.directive).map(t => t.text).join("\n") + "\n" + names.filter(n => /\.(lib|sub|mod|cir|inc|txt|sp|spi|spice|model|bjt|dio|mos|jft)$/i.test(n)).map(n => files[n]).join("\n");
    const SN = root.SpiceNet, SF = root.SpiceFind;
    let modelList = [];
    try { modelList = SN ? SN.list(modelText) : []; } catch (e) { modelList = []; }
    const findModel = nm => { const n = String(nm || "").trim().toUpperCase(); if (!n || !SF) return null; const it = modelList.find(x => x.name.toUpperCase() === n); if (!it) return null; try { return SF.cut(modelText, it.name); } catch (e) { return null; } };

    const comps = [], wires = [];
    let nid = 0;
    const id = p => `${p}${++nid}_lt`;
    const addComp = (type, x, y, rot, params, label) => { const c = { id: id("c"), type, x, y, rot: rot & 3, params: params || {}, label: label || "" }; comps.push(c); return c; };
    const wire = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) wires.push({ id: id("w"), x1, y1, x2, y2 }); };
    // a symbol's point on the sheet: turned clockwise, then mirrored left-right
    const place = (s, x, y) => { let px = x, py = y; for (let r = 0; r < s.rot; r++) [px, py] = [-py, px]; return [s.x + (s.mirror ? -px : px), s.y + py]; };

    // where every pin of every symbol is; a symbol nobody knows takes the wires that end by it
    const known = s => { const b = base(s.name), full = String(s.name).toLowerCase(); return asys.get(b) ? asys.get(b).pins.map(p => [p.name || String(p.order), p.x, p.y]) : SYMS[full] || SYMS[b] || null; };
    const lists = new Map(), unknown = [];
    A.symbols.forEach(s => { const k = known(s); if (k) lists.set(s, k.map(([n, x, y]) => ({ name: n, at: place(s, x, y) }))); else unknown.push(s); });
    if (unknown.length) {
      const kk = (x, y) => x + "," + y, ends = new Map(), taken = new Set();
      A.wires.forEach(w => [[w[0], w[1]], [w[2], w[3]]].forEach(p => ends.set(kk(p[0], p[1]), (ends.get(kk(p[0], p[1])) || 0) + 1)));
      lists.forEach(l => l.forEach(p => taken.add(kk(p.at[0], p.at[1]))));
      const onWire = (x, y) => A.wires.some(w => (w[1] === w[3] ? y === w[1] && x > Math.min(w[0], w[2]) && x < Math.max(w[0], w[2]) : w[0] === w[2] && x === w[0] && y > Math.min(w[1], w[3]) && y < Math.max(w[1], w[3])));
      const loose = [...ends.entries()].filter(([k, n]) => n === 1 && !taken.has(k)).map(([k]) => k.split(",").map(Number)).filter(p => !onWire(p[0], p[1]) && !A.flags.some(f => f.x === p[0] && f.y === p[1]));
      const guess = new Map(unknown.map(s => [s, []]));
      loose.forEach(p => {
        let best = null, bd = Infinity;
        unknown.forEach(s => { const c = place(s, 48, 48), d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < bd) { bd = d; best = s; } });
        if (best && bd <= 260) guess.get(best).push(p);
      });
      unknown.forEach(s => {
        const pts = guess.get(s);
        lists.set(s, pts.map((p, i) => ({ name: String(i + 1), at: p })));
        note(`${s.attrs.InstName || base(s.name)} (${base(s.name)}): LTspice's own symbol, not opened with the schematic: its pins are taken from the ${pts.length} wire end${pts.length === 1 ? "" : "s"} by it. Open its .asy file with the schematic for the real pins.`);
      });
    }

    // the drawing on the app's grid, placed in a frame that holds it
    const xs = [], ys = [];
    A.wires.forEach(w => { xs.push(w[0], w[2]); ys.push(w[1], w[3]); });
    lists.forEach(l => l.forEach(p => { xs.push(p.at[0]); ys.push(p.at[1]); }));
    A.flags.forEach(f => { xs.push(f.x); ys.push(f.y); });
    A.texts.forEach(t => { xs.push(t.x); ys.push(t.y); });
    if (!xs.length) { xs.push(0); ys.push(0); }
    const minX = Math.min(...xs), minY = Math.min(...ys), wNeed = (Math.max(...xs) - minX) * U + 300, hNeed = (Math.max(...ys) - minY) * U + 300;
    const size = Object.keys(L.SHEETS).sort((a, b) => L.SHEETS[a][0] - L.SHEETS[b][0]).find(k => L.SHEETS[k][0] * 4 >= wNeed && L.SHEETS[k][1] * 4 >= hNeed) || "A0";
    addComp("frame", 0, 0, 0, { locked: "yes", size, orient: "landscape", title: name, date: "", rev: "A", owner: "", sheet: "", docno: "", doctype: "Circuit diagram", status: "Imported from LTspice" }).label = "";
    const fw = L.SHEETS[size][0] * 4, fh = L.SHEETS[size][1] * 4;
    const ox = Math.round(((fw - (Math.max(...xs) - minX) * U) / 2) / 10) * 10 - sc(minX), oy = Math.round(((fh - 80 - (Math.max(...ys) - minY) * U) / 2) / 10) * 10 - sc(minY);
    const to = (x, y) => [sc(x) + ox, sc(y) + oy];

    // the parts
    const stand = new Map(), rot4 = (x, y, r) => (r === 1 ? [-y, x] : r === 2 ? [-x, -y] : r === 3 ? [y, -x] : [x, y]);
    // what is already on the sheet, with the net of each thing, so that a part's pin or the short
    // wire to it lands on nothing of another net: points (wire ends, pins) and straight runs
    const par = new Map(), find = k => { if (!par.has(k)) par.set(k, k); let r = k; while (par.get(r) !== r) r = par.get(r); par.set(k, r); return r; };
    const union = (a, b) => par.set(find(a), find(b)), pk = (x, y) => x + "," + y;
    const occ = { pts: new Set(), rows: new Map(), cols: new Map(), hs: new Map(), vs: new Map() };
    const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    const addPt = (x, y) => { const k = pk(x, y); find(k); if (occ.pts.has(k)) return k; occ.pts.add(k); push(occ.rows, y, x); push(occ.cols, x, y); return k; };
    const addSeg = (x1, y1, x2, y2) => {
      const a = addPt(x1, y1), b = addPt(x2, y2); union(a, b);
      if (y1 === y2 && x1 !== x2) push(occ.hs, y1, [Math.min(x1, x2), Math.max(x1, x2), a]); else if (x1 === x2 && y1 !== y2) push(occ.vs, x1, [Math.min(y1, y2), Math.max(y1, y2), a]);
    };
    // the things at a point: a point there, or a run through it
    const at0 = (x, y) => (occ.pts.has(pk(x, y)) ? [pk(x, y)] : []).concat((occ.hs.get(y) || []).filter(q => x >= q[0] && x <= q[1]).map(q => q[2]), (occ.vs.get(x) || []).filter(q => y >= q[0] && y <= q[1]).map(q => q[2]));
    // the things a straight leg runs over (its own ends excepted): points inside it, runs along it
    const along = (x1, y1, x2, y2) => {
      const hor = y1 === y2, lo = hor ? Math.min(x1, x2) : Math.min(y1, y2), hi = hor ? Math.max(x1, x2) : Math.max(y1, y2);
      return (hor ? occ.rows.get(y1) || [] : occ.cols.get(x1) || []).filter(v => v > lo && v < hi).map(v => (hor ? pk(v, y1) : pk(x1, v)))
        .concat((hor ? occ.hs.get(y1) || [] : occ.vs.get(x1) || []).filter(q => Math.min(hi, q[1]) - Math.max(lo, q[0]) > 0).map(q => q[2]));
    };
    const foreign = (keys, net) => keys.some(k => find(k) !== net);
    const legsOf = (px, py, qx, qy, wide) => (px === qx || py === qy ? [[px, py, qx, qy]] : wide ? [[px, py, qx, py], [qx, py, qx, qy]] : [[px, py, px, qy], [px, qy, qx, qy]]);
    // two legs that touch (an end of one on the other, or running along each other)
    const onLeg = (l, x, y) => (l[1] === l[3] ? y === l[1] && x >= Math.min(l[0], l[2]) && x <= Math.max(l[0], l[2]) : x === l[0] && y >= Math.min(l[1], l[3]) && y <= Math.max(l[1], l[3]));
    const touch = (a, b) => onLeg(a, b[0], b[1]) || onLeg(a, b[2], b[3]) || onLeg(b, a[0], a[1]) || onLeg(b, a[2], a[3]);
    // LTspice's nets: its wires (a slanted one too), the pins and wire ends on a wire's run, the flags by name
    A.wires.forEach(w => { const [x1, y1] = to(w[0], w[1]), [x2, y2] = to(w[2], w[3]); if (x1 === x2 || y1 === y2) addSeg(x1, y1, x2, y2); else union(addPt(x1, y1), addPt(x2, y2)); });
    lists.forEach(l => l.forEach(p => { const [x, y] = to(p.at[0], p.at[1]); addPt(x, y); }));
    A.flags.forEach(f => { const [x, y] = to(f.x, f.y); union(addPt(x, y), "N:" + f.name.toUpperCase()); });
    occ.pts.forEach(k => { const [x, y] = k.split(",").map(Number); at0(x, y).forEach(q => union(k, q)); });
    const fit = (type, params, label, targets) => {
      // the turn and the place that put the part's pins nearest the symbol's, wires to them, with
      // no pin or short wire landing on anything of another net
      const def = L.LIB[type], full = Object.assign({}, def.defaults, params), netOf = {};
      Object.keys(targets).forEach(id => { if (targets[id]) netOf[id] = find(pk(...targets[id])); });
      let best = null;
      for (let flip = 0; flip < (def.noMirror ? 1 : 2); flip++) for (let rot = 0; rot < 4; rot++) {
        const c = { params: Object.assign({}, full, flip ? { flip: "yes" } : {}), label };
        const local = def.pins(c).filter(p => targets[p.id]).map(p => { const [x, y] = rot4(flip ? -p.x : p.x, p.y, rot); return { id: p.id, x, y }; });
        if (!local.length) continue;
        const cands = local.map(p => [targets[p.id][0] - p.x, targets[p.id][1] - p.y]);
        cands.push([Math.round(cands.reduce((s, q) => s + q[0], 0) / cands.length / 10) * 10, Math.round(cands.reduce((s, q) => s + q[1], 0) / cands.length / 10) * 10]);
        const more = []; cands.forEach(([x, y]) => [[10, 0], [-10, 0], [0, 10], [0, -10], [20, 0], [-20, 0], [0, 20], [0, -20]].forEach(([dx, dy]) => more.push([x + dx, y + dy])));
        cands.concat(more).forEach(([tx, ty], ci) => {
          let cost = ci >= cands.length ? 5 : 0;
          const mine = [];      // this placement's own pins and wires, with their nets
          local.forEach(p => {
            const px = p.x + tx, py = p.y + ty, [qx, qy] = targets[p.id], dx = Math.abs(px - qx), dy = Math.abs(py - qy), net = netOf[p.id];
            cost += dx + dy + (dx && dy ? 40 : 0);
            const legs = legsOf(px, py, qx, qy, Math.abs(p.x) >= Math.abs(p.y));
            if (dx || dy) {
              if (foreign(at0(px, py), net)) cost += 1000;
              if (legs.some(l => foreign(along(...l), net))) cost += 1000;
              if (legs.length > 1 && foreign(at0(legs[0][2], legs[0][3]), net)) cost += 1000;
            }
            (dx || dy ? legs : [[px, py, px, py]]).forEach(l => mine.push([l, net]));
          });
          for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) if (mine[i][1] !== mine[j][1] && touch(mine[i][0], mine[j][0])) cost += 1000;
          if (!best || cost < best.cost - 1e-9) best = { cost, rot, flip, tx, ty, local };
        });
      }
      if (best.cost >= 1000) report.tight = (report.tight || 0) + 1;
      const c = addComp(type, best.tx, best.ty, best.rot, Object.assign(params, best.flip ? { flip: "yes" } : {}), label);
      best.local.forEach(p => {
        const px = p.x + best.tx, py = p.y + best.ty, [qx, qy] = targets[p.id];
        union(addPt(px, py), netOf[p.id]);
        legsOf(px, py, qx, qy, Math.abs(p.x) >= Math.abs(p.y)).forEach(l => { wire(...l); addSeg(...l); });
      });
      return c;
    };
    const spicePart = (m, label, pinsAt) => {
      const r = SF.recognise(m), S = L.SPICE_SYMS[r.sym];
      if (!S || !r.map) return null;
      const params = { name: m.sub, text: m.text, sub: m.sub, sym: r.sym, pinNames: m.pins.slice(), map: r.map.slice() };
      // the model's pins in order are the symbol's pins in SPICE order
      const targets = {}; r.map.forEach((pid, i) => { if (pinsAt[i]) targets[pid] = pinsAt[i]; });
      report.models++;
      return fit("spice", params, label, targets);
    };
    const keep = (s, pins, why) => {
      // as drawn: a box with its pins where LTspice has them
      const at = pins.map(p => to(p.at[0], p.at[1]));
      if (!at.length) { note(`${s.attrs.InstName || base(s.name)} (${base(s.name)}): no pins found, left out.`); return; }
      const cx = Math.round(at.reduce((a, p) => a + p[0], 0) / at.length / 10) * 10, cy = Math.round(at.reduce((a, p) => a + p[1], 0) / at.length / 10) * 10;
      const loc = at.map(p => [p[0] - cx, p[1] - cy]);
      let x1 = Math.min(...loc.map(p => p[0])), x2 = Math.max(...loc.map(p => p[0])), y1 = Math.min(...loc.map(p => p[1])), y2 = Math.max(...loc.map(p => p[1]));
      const thinX = x2 - x1 < 20, thinY = y2 - y1 < 20;
      const bx1 = thinX ? -10 : x1 + 10, bx2 = thinX ? 10 : x2 - 10, by1 = thinY ? -10 : y1 + 10, by2 = thinY ? 10 : y2 - 10;
      const used = new Set(), sp = pins.map((p, i) => {
        const [x, y] = loc[i];
        let a = 0, l = 0;
        const side = !thinX && x === x1 ? 0 : !thinX && x === x2 ? 180 : y === y1 && !thinY ? 270 : y === y2 && !thinY ? 90 : thinX ? (y < 0 ? 270 : 90) : (x < 0 ? 0 : 180);
        a = side; l = side === 0 ? bx1 - x : side === 180 ? x - bx2 : side === 270 ? by1 - y : y - by2;
        let pid = p.name || String(i + 1); for (let k = 2; used.has(pid); k++) pid = `${p.name}#${k}`;
        used.add(pid);
        return { id: pid, num: String(i + 1), name: p.name, x, y, a, l: Math.max(0, l) };
      });
      const g = [["p", 2, bx1, by1, bx2, by1, bx2, by2, bx1, by2, bx1, by1]];
      const sym = { g, pins: sp, box: [Math.min(x1, bx1) - 2, Math.min(y1, by1) - 2, Math.max(x2, bx2) + 2, Math.max(y2, by2) + 2], pn: 2 };
      addComp("kicad", cx, cy, 0, { value: s.attrs.Value || base(s.name), footprint: "", lib: "LTspice:" + s.name, desc: why || "", sym, from: "LTspice" }, s.attrs.InstName || "");
      report.kept++;
    };

    A.symbols.forEach(s => {
      const pins = lists.get(s) || [], b = base(s.name), full = String(s.name).toLowerCase(), at = n => { const p = pins.find(q => q.name === n); return p ? to(p.at[0], p.at[1]) : null; };
      const ref = s.attrs.InstName || "", value = String(s.attrs.Value || "").trim(), value2 = String(s.attrs.Value2 || ""), line = [s.attrs.SpiceLine, s.attrs.SpiceLine2].filter(Boolean).join(" ");
      const asy = asys.get(b);
      // an LTspice hierarchy block (a symbol with a schematic of its own) or a symbol for a model
      report.parts++;
      const prefix = String(s.attrs.Prefix || (asy && asy.prefix) || "").toUpperCase();
      const want = (type, params, targets) => { report.own++; return fit(type, params, ref, targets); };
      const stood = (k, r) => { if (!stand.has(k)) stand.set(k, []); stand.get(k).push(r); };
      if ((b === "res" || b === "res2") && !asy) {
        const r = ltValue(value); if (!r) stood("", `${ref} "${value}"`);
        return want("resistor", r ? { r } : {}, { 1: at("A"), 2: at("B") });
      }
      if ((b === "cap" || b === "polcap") && !asy) {
        const c = ltValue(value); if (!c) stood("", `${ref} "${value}"`);
        return b === "polcap" ? want("electrolytic", c ? { c } : {}, { "+": at("A"), "-": at("B") }) : want("capacitor", c ? { c } : {}, { 1: at("A"), 2: at("B") });
      }
      if ((b === "ind" || b === "ind2") && !asy) {
        const l = ltValue(value); if (!l) stood("", `${ref} "${value}"`);
        return want("inductor", l ? { l } : {}, { 1: at("A"), 2: at("B") });
      }
      const devModel = (table, type, pinsInOrder) => {
        // a model the schematic carries wins (simulated as written), then the app's own part of that name
        // no value: LTspice's default model of that kind (NPN, D …: SPICE's default parameters)
        const dflt = !value && SF && DEFAULT_MODEL[b];
        const m = dflt ? (() => { try { return SF.cut(`.model ${dflt} ${dflt}()`, dflt); } catch (e) { return null; } })() : findModel(value);
        if (m && SF) { const c = spicePart(m, ref, pinsInOrder); if (c) { report.own++; if (dflt) bare.push(ref); return c; } }
        const k = keyIn(table, value);
        if (!k) stood(`${value || "(no model)"}\n${L.LIB[type].defaults.model}`, ref);
        return null;
      };
      if (["diode", "schottky", "zener", "led", "varactor", "tvsdiode"].includes(b) && !asy) {
        const t = { K: at("-"), A: at("+") };
        if (b === "led") return want("led", {}, t);
        const type = b === "zener" || keyIn(L.ZENERS, value) ? "zener" : "diode", table = type === "zener" ? L.ZENERS : L.DIODES;
        const c = devModel(table, type, [t.A, t.K]); if (c) return c;
        return want(type, { model: keyIn(table, value) || L.LIB[type].defaults.model }, t);
      }
      if (["npn", "pnp", "npn2", "pnp2"].includes(b) && !asy) {
        const t = { C: at("C"), B: at("B"), E: at("E") }, c = devModel(L.BJTS, b.slice(0, 3), [t.C, t.B, t.E]); if (c) return c;
        const k = keyIn(L.BJTS, value), type = k ? (L.BJTS[k].pol > 0 ? "npn" : "pnp") : b.slice(0, 3);
        return want(type, { model: k || L.LIB[type].defaults.model }, t);
      }
      if (["nmos", "pmos", "njf", "pjf"].includes(b) && !asy) {
        const t = { D: at("D"), G: at("G"), S: at("S") }, jf = b[1] === "j", table = jf ? L.JFETS : L.MOSFETS;
        const c = devModel(table, b, [t.D, t.G, t.S]); if (c) return c;
        return want(b, { model: keyIn(table, value) || L.LIB[b].defaults.model }, t);
      }
      if ((b === "nmos4" || b === "pmos4") && !asy) {
        const m = findModel(value); if (m && SF) { const c = spicePart(m, ref, ["D", "G", "S", "B"].map(at)); if (c) { report.own++; return c; } }
        return keep(s, pins, "a four-terminal MOSFET with no model in the schematic");
      }
      if ((b === "voltage" || b === "current") && !asy) {
        const src = sourceOf(value + (value2 ? " " + value2 : ""), line, b === "current");
        if (src) {
          if (src.ac) note(`${ref}: an AC analysis source (${value || value2}) is a 1 kHz sine of that amplitude here: the Bode window sweeps the frequency itself.`);
          // LTspice's current flows from its + pin through the source to its - pin: the app's arrow points to its + pin
          const t = b === "current" ? { "-": at("+"), "+": at("-") } : { "+": at("+"), "-": at("-") };
          return want(src.type, src.params, t);
        }
        return keep(s, pins, `a ${b} source the app has no part for: ${value}`);
      }
      // an op-amp: a model in the schematic or opened with it is simulated as written; LTspice's own (encrypted) ones are kept
      if (pins.length === 5 && (full === "opamps\\opamp2" || /^opamps\\/.test(full) || (asy && asy.pins.length === 5))) {
        const m = findModel(value) || findModel(b);
        const order = asy ? asy.pins.map(p => at(p.name || String(p.order))) : OPAMP5.map(p => at(p[0]));
        if (m && SF) { const c = spicePart(m, ref, order); if (c) { report.own++; return c; } }
        return keep(s, pins, "an LTspice op-amp: its model is LTspice's own");
      }
      if (asy) {
        const m = findModel(value) || findModel(asy.model) || findModel(b);
        if (m && SF && m.pins.length === pins.length) { const c = spicePart(m, ref, pins.map(p => to(p.at[0], p.at[1]))); if (c) { report.own++; return c; } }
      }
      return keep(s, pins, prefix ? `an LTspice ${prefix} element` : "an LTspice part");
    });

    // wires as drawn (a slanted one as two legs)
    A.wires.forEach(w => {
      const [x1, y1] = to(w[0], w[1]), [x2, y2] = to(w[2], w[3]);
      if (x1 === x2 || y1 === y2) { wire(x1, y1, x2, y2); return; }
      // the corner that lands on nothing of another net, else the one through fewer such things
      const net = find(pk(x1, y1)), ways = [[[x1, y1, x2, y1], [x2, y1, x2, y2]], [[x1, y1, x1, y2], [x1, y2, x2, y2]]];
      // then a step through a third leg, sideways or up and down, nearest the straight line first
      const lo = (a, b) => Math.min(a, b) - 40, hi = (a, b) => Math.max(a, b) + 40, mids = (a, b) => { const out = []; for (let v = Math.ceil(lo(a, b) / 10) * 10; v <= hi(a, b); v += 10) if (v !== a && v !== b) out.push(v); return out.sort((p, q) => Math.abs(p - (a + b) / 2) - Math.abs(q - (a + b) / 2)); };
      mids(x1, x2).forEach(xm => ways.push([[x1, y1, xm, y1], [xm, y1, xm, y2], [xm, y2, x2, y2]]));
      mids(y1, y2).forEach(ym => ways.push([[x1, y1, x1, ym], [x1, ym, x2, ym], [x2, ym, x2, y2]]));
      const bad = w => w.reduce((n, l, i) => n + (foreign(along(...l), net) ? 1 : 0) + (i && foreign(at0(l[0], l[1]), net) ? 2 : 0), 0);
      let way = ways.find(w => !bad(w));
      if (!way) { way = ways[0]; report.tight = (report.tight || 0) + 1; }
      way.forEach(l => { wire(...l); addSeg(...l); });
      note("Slanted wires are drawn as two straight legs.");
    });
    report.wires = A.wires.length;
    // net names: 0 is ground, any other name a net label (one sheet, so a name is one net, as in LTspice)
    A.flags.forEach(f => {
      const [x, y] = to(f.x, f.y);
      if (f.name === "0") addComp("ground", x, y, 0);
      else { addComp("netlabel", x, y, 0, { name: f.name }); report.labels++; }
    });
    // the texts: comments and SPICE commands as notes on the sheet
    const cmds = [];
    A.texts.forEach(t => {
      const [x, y] = to(t.x, t.y);
      t.text.split("\n").forEach((ln, k) => { if (ln.trim()) addComp("note", x, y + k * 16, 0, { text: ln, size: "12" }); });
      if (t.directive) t.text.split("\n").forEach(ln => { const m = /^\s*\.(tran|ac|dc|op|noise|tf|step|param|meas|measure|four)\b/i.exec(ln); if (m) cmds.push(ln.trim()); });
    });
    if (cmds.length) note(`LTspice's commands are on the sheet as text (${cmds.slice(0, 3).join("; ")}${cmds.length > 3 ? " …" : ""}): run them from Simulate and Analyze here (Transient, Bode, DC sweep, measurements).`);
    if (A.symbols.some(s => /\{[^}]*\}/.test(s.attrs.Value || ""))) note("Some values written as {expressions} could not be worked out from the schematic's .param lines: the parts that have one keep their default value.");
    if (A.drawn) note(`${A.drawn} line${A.drawn === 1 ? "" : "s"} and shape${A.drawn === 1 ? "" : "s"} drawn on the LTspice sheet are left out.`);
    if (A.buses) note("LTspice bus taps are left out: name the signals with net labels.");
    if (!A.flags.some(f => f.name === "0") && A.symbols.length) note("No ground (0) in the schematic: add a Ground symbol before simulating.");
    const few = l => l.slice(0, 12).join(", ") + (l.length > 12 ? ` and ${l.length - 12} more` : "");
    stand.forEach((refs, k) => {
      if (!k) note(`${few(refs)}: the value is not a number here, so the part has its default value: set it in the inspector.`);
      else { const [was, model] = k.split("\n"); note(`${few(refs)} (${was}): no model of this name in the schematic or the app, so ${refs.length > 1 ? "they simulate" : "it simulates"} as ${model}: pick the nearest type in the inspector, or open the model file with the schematic.`); }
    });
    if (bare.length) { report.models -= bare.length; note(`${few(bare)}: no model named, so LTspice's default one of the kind (NPN, PNP, D, NJF: SPICE's default parameters), simulated as a SPICE part.`); }
    if (report.models) note(`${report.models} part${report.models > 1 ? "s use" : " uses"} the model written in the schematic or its model file, simulated as written (a SPICE part).`);
    if (report.kept) note(`${report.kept} part${report.kept > 1 ? "s" : ""} the app has no part for ${report.kept > 1 ? "are" : "is"} kept as a box with LTspice's pins: wired and on the board, but not simulated.`);
    return { design: { app: "TubeAmpCAD", version: 2, comps, wires }, name, report };
  }

  /** The nets of an .asc straight from its wires, pins and flags (for tests): [[ref.pin, …]] joined */
  function ascNets(text, asyFiles) {
    const A = readAsc(text), kk = (x, y) => x + "," + y, par = new Map(), find = k => { if (!par.has(k)) par.set(k, k); let r = k; while (par.get(r) !== r) r = par.get(r); par.set(k, r); return r; };
    const union = (a, b) => par.set(find(a), find(b));
    const asys = new Map(Object.entries(asyFiles || {}).map(([n, t]) => [base(n.replace(/\.asy$/i, "")), readAsy(t)]));
    const pts = [];
    A.wires.forEach(w => { union(kk(w[0], w[1]), kk(w[2], w[3])); pts.push([w[0], w[1]], [w[2], w[3]]); });
    const place = (s, x, y) => { let px = x, py = y; for (let r = 0; r < s.rot; r++) [px, py] = [-py, px]; return [s.x + (s.mirror ? -px : px), s.y + py]; };
    const pinAt = [];
    A.symbols.forEach(s => { const b = base(s.name), list = asys.get(b) ? asys.get(b).pins.map(p => [p.name, p.x, p.y]) : SYMS[String(s.name).toLowerCase()] || SYMS[b]; if (!list) return; list.forEach(([n, x, y]) => { const p = place(s, x, y); pinAt.push([(s.attrs.InstName || "?") + "." + n, p]); pts.push(p); }); });
    // a point on a wire's middle joins it
    const all = pts.concat(A.flags.map(f => [f.x, f.y]));
    all.forEach(p => A.wires.forEach(w => { const on = w[1] === w[3] ? p[1] === w[1] && p[0] >= Math.min(w[0], w[2]) && p[0] <= Math.max(w[0], w[2]) : w[0] === w[2] && p[0] === w[0] && p[1] >= Math.min(w[1], w[3]) && p[1] <= Math.max(w[1], w[3]); if (on) union(kk(p[0], p[1]), kk(w[0], w[1])); }));
    A.flags.forEach(f => union(kk(f.x, f.y), "N:" + f.name.toUpperCase()));
    const m = new Map();
    pinAt.forEach(([n, p]) => { const r = find(kk(p[0], p[1])); if (!m.has(r)) m.set(r, []); m.get(r).push(n); });
    return { nets: [...m.values()].map(v => v.sort()), ground: find("N:0") };
  }

  root.LtspiceImport = { SYMS, decode, readAsc, readAsy, ltValue, sourceOf, importAsc, ascNets };
})(typeof window !== "undefined" ? window : globalThis);
