/* =============================================================================
   KiCad import (no DOM, Node-testable): a KiCad project's schematic (.kicad_sch, with its
   hierarchical sheets) and board (.kicad_pcb) as a Tube Amp CAD design, KiCad 6 to 9 files.
   - The schematic: wires as they are drawn; labels, sheet pins and power symbols become sheet
     connectors (GND a ground symbol, +12V-style ones a power rail); every sheet of the hierarchy
     is a drawing frame, the sheets side by side. A symbol the app has a part for (resistors,
     capacitors, coils, diodes, transistors, valves, op-amps, a 555, headers and terminal blocks)
     becomes that part, so it simulates; any other symbol is kept as drawn in KiCad ("kicad", an
     imported part: its own picture, pins and footprint), so the circuit stays whole.
   - The board: the outline (its bounding rectangle), footprints as KiCad has them (board.footprints,
     which BoardCore draws and checks like its own), tracks, vias, pours, keep-outs, texts, holes.
     A board without a schematic gets one made for it: a box per footprint, its pads on net names.
   A schematic this app exported (kicad-export.js marks its symbols) comes back as its own parts.
   Depends on: cad-components.js (CadLib) for the parts; board-core.js (BoardCore) for a board.
   ============================================================================= */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // S-expressions: lists as arrays, atoms and quoted strings as strings
  // ---------------------------------------------------------------------------
  function parse(text) {
    const n = text.length, stack = [];
    let i = 0, cur = null, top = null;
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 40) { const l = []; if (cur) cur.push(l); stack.push(cur); cur = l; i++; }
      else if (ch === 41) { if (!cur) throw new Error("not a KiCad file (a bracket too many)"); const done = cur; cur = stack.pop(); i++; if (!cur) { top = done; break; } }
      else if (ch === 34) {
        let s = "", j = i + 1;
        for (; j < n; j++) {
          const c = text[j];
          if (c === "\\") { const e = text[++j]; s += e === "n" ? "\n" : e === "t" ? "\t" : e === "r" ? "" : e; }
          else if (c === '"') break;
          else s += c;
        }
        if (!cur) throw new Error("not a KiCad file");
        cur.push(s); i = j + 1;
      }
      else if (ch <= 32) i++;
      else {
        let j = i;
        for (; j < n; j++) { const c = text.charCodeAt(j); if (c <= 32 || c === 40 || c === 41) break; }
        if (!cur) throw new Error("not a KiCad file");
        cur.push(text.slice(i, j)); i = j;
      }
    }
    if (!top) throw new Error("not a KiCad file (brackets do not close)");
    return top;
  }
  const kids = (l, h) => (l || []).filter(x => Array.isArray(x) && x[0] === h);
  const kid = (l, h) => (l || []).find(x => Array.isArray(x) && x[0] === h);
  const val = (l, h, d) => { const e = kid(l, h); return e && e[1] !== undefined ? e[1] : d; };
  const prop = (l, name) => { const p = (l || []).find(x => Array.isArray(x) && x[0] === "property" && x[1] === name); return p ? String(p[2]) : ""; };
  const hidden = e => !!e && (e.includes("hide") || val(e, "hide") === "yes");
  const xyList = e => kids(kid(e, "pts"), "xy").map(p => [+p[1], +p[2]]);
  const baseOf = path => String(path || "").replace(/\\/g, "/").split("/").pop();
  const stem = path => baseOf(path).replace(/\.[^.]+$/, "");

  // ---------------------------------------------------------------------------
  // The schematic file
  // ---------------------------------------------------------------------------
  function libSymbol(s) {
    const flag = k => { const e = kid(s, k); return e ? { hide: hidden(e), offset: kid(e, "offset") ? +kid(e, "offset")[1] : undefined } : {}; };
    const o = { name: s[1], power: !!kid(s, "power"), names: flag("pin_names"), numbers: flag("pin_numbers"), units: new Map(), count: 0,
      ref: prop(s, "Reference"), desc: prop(s, "ki_description") || prop(s, "Description") };
    kids(s, "symbol").forEach(u => {
      const m = /_(\d+)_(\d+)$/.exec(u[1]); if (!m || +m[2] > 1) return;
      const k = +m[1]; o.count = Math.max(o.count, k);
      if (!o.units.has(k)) o.units.set(k, { shapes: [], pins: [] });
      const un = o.units.get(k);
      u.slice(2).forEach(e => {
        if (!Array.isArray(e)) return;
        const fill = { outline: 1, background: 2 }[val(kid(e, "fill"), "type")] || 0;
        if (e[0] === "polyline" || e[0] === "bezier") un.shapes.push({ k: "p", pts: xyList(e), fill });
        else if (e[0] === "rectangle") { const a = kid(e, "start"), b = kid(e, "end"); un.shapes.push({ k: "p", pts: [[+a[1], +a[2]], [+b[1], +a[2]], [+b[1], +b[2]], [+a[1], +b[2]], [+a[1], +a[2]]], fill }); }
        else if (e[0] === "circle") { const c = kid(e, "center"); un.shapes.push({ k: "c", x: +c[1], y: +c[2], r: +val(e, "radius", 0), fill }); }
        else if (e[0] === "arc") { const a = kid(e, "start"), m2 = kid(e, "mid"), b = kid(e, "end"); if (a && m2 && b) un.shapes.push({ k: "a", pts: [[+a[1], +a[2]], [+m2[1], +m2[2]], [+b[1], +b[2]]] }); }
        else if (e[0] === "text") { const a = kid(e, "at"), f = kid(kid(e, "effects"), "font"); un.shapes.push({ k: "t", x: +a[1], y: +a[2], text: String(e[1]), size: +(val(f, "size", 1.27)) }); }
        else if (e[0] === "pin") {
          const a = kid(e, "at"), nm = kid(e, "name"), no = kid(e, "number");
          un.pins.push({ type: e[1], x: +a[1], y: +a[2], a: +a[3] || 0, len: +val(e, "length", 0), hide: hidden(e), name: nm ? String(nm[1]) : "", num: no ? String(no[1]) : "" });
        }
      });
    });
    return o;
  }
  function readSch(text) {
    const t = parse(text);
    if (t[0] !== "kicad_sch") throw new Error("not a KiCad schematic");
    const libs = new Map();
    kids(kid(t, "lib_symbols"), "symbol").forEach(s => libs.set(s[1], libSymbol(s)));
    const paper = kid(t, "paper") || ["paper", "A4"], tb = kid(t, "title_block") || [];
    const at = e => { const a = kid(e, "at") || [0, 0, 0, 0]; return [+a[1], +a[2], +a[3] || 0]; };
    const sch = { uuid: val(t, "uuid", ""), version: +val(t, "version", 0), generator: String(val(t, "generator", "")), libs,
      paper: { size: String(paper[1]), w: +paper[2] || 0, h: +paper[3] || 0, portrait: paper.includes("portrait") },
      title: { title: val(tb, "title", ""), date: val(tb, "date", ""), rev: val(tb, "rev", ""), company: val(tb, "company", ""), mark: (kids(tb, "comment").find(c => String(c[1]) === "9" && /^TubeAmpCAD /.test(String(c[2]))) || [])[2] },
      symbols: [], wires: [], junctions: [], labels: [], sheets: [], texts: [], buses: [] };
    kids(t, "bus").forEach(e => { const p = xyList(e); for (let k = 0; k + 1 < p.length; k++) sch.buses.push([p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]]); });
    kids(t, "symbol").forEach(e => {
      const [x, y, a] = at(e), props = {}, instances = [];
      kids(e, "property").forEach(p => { props[p[1]] = String(p[2]); });
      kids(kid(e, "instances"), "project").forEach(pr => kids(pr, "path").forEach(pa => instances.push({ path: pa[1], ref: val(pa, "reference"), unit: +val(pa, "unit", 0) || 0 })));
      sch.symbols.push({ libId: String(val(e, "lib_id", "")), libName: val(e, "lib_name"), x, y, a, mirror: val(e, "mirror"), unit: +val(e, "unit", 1) || 1, props, instances, uuid: val(e, "uuid", "") });
    });
    kids(t, "wire").forEach(e => { const p = xyList(e); for (let k = 0; k + 1 < p.length; k++) sch.wires.push([p[k][0], p[k][1], p[k + 1][0], p[k + 1][1]]); });
    kids(t, "junction").forEach(e => { const a = at(e); sch.junctions.push([a[0], a[1]]); });
    [["label", "local"], ["global_label", "global"], ["hierarchical_label", "hier"]].forEach(([h, kind]) => kids(t, h).forEach(e => { const a = at(e); sch.labels.push({ kind, text: String(e[1]), x: a[0], y: a[1], a: a[2] }); }));
    kids(t, "text").forEach(e => { const a = at(e), f = kid(kid(e, "effects"), "font"); sch.texts.push({ text: String(e[1]), x: a[0], y: a[1], size: +val(f, "size", 1.27) }); });
    kids(t, "sheet").forEach(e => {
      const a = at(e), sz = kid(e, "size") || [0, 0, 0];
      sch.sheets.push({ x: a[0], y: a[1], w: +sz[1], h: +sz[2], uuid: val(e, "uuid", ""), name: prop(e, "Sheetname") || prop(e, "Sheet name"), file: prop(e, "Sheetfile") || prop(e, "Sheet file"),
        pins: kids(e, "pin").map(p => { const q = at(p); return { name: String(p[1]), x: q[0], y: q[1] }; }) });
    });
    // KiCad 6 keeps every sheet's references in the root file
    sch.symbolInstances = kids(kid(t, "symbol_instances"), "path").map(p => ({ path: p[1], ref: val(p, "reference"), unit: +val(p, "unit", 0) || 0 }));
    return sch;
  }
  // a symbol's placement as a matrix [a, b, c, d]: screen = at + (a·x + b·y, c·x + d·y) of its library
  // point (the library's y points up, the sheet's down). The mirror turns the placed symbol over.
  function matrix(angle, mirror) {
    const m = ({ 0: [1, 0, 0, -1], 90: [0, -1, -1, 0], 180: [-1, 0, 0, 1], 270: [0, 1, 1, 0] })[((Math.round(angle) % 360) + 360) % 360] || [1, 0, 0, -1];
    if (mirror === "x") return [m[0], m[1], -m[2], -m[3]];
    if (mirror === "y") return [-m[0], -m[1], m[2], m[3]];
    return m;
  }

  // ---------------------------------------------------------------------------
  // KiCad symbols as the app's parts
  // ---------------------------------------------------------------------------
  const rotPt = (x, y, r) => (r === 1 ? [-y, x] : r === 2 ? [-x, -y] : r === 3 ? [y, -x] : [x, y]);
  // "4k7", "1R5", "2M2", "10uF", "0.1µ", "47K" as a number
  function engValue(text) {
    const L = root.CadLib; let s = String(text || "").trim().split(/[\s/,;]/)[0];
    const m = /^(\d+)([RrKkMGmunpµ])(\d+)/.exec(s);
    if (m) s = `${m[1]}.${m[3]}${/[Rr]/.test(m[2]) ? "" : m[2]}`;
    s = s.replace(/^(\d*\.?\d+)[Rr]$/, "$1").replace(/^(\d*\.?\d+)\s*(?:ohms?|Ω)$/i, "$1");
    const v = L ? L.parseEng(s) : parseFloat(s);
    return Number.isFinite(v) && v > 0 ? v : null;
  }
  const keyIn = (table, name) => {
    const n = String(name || "").trim().toUpperCase(); if (!n || !table) return null;
    const keys = Object.keys(table);
    return keys.find(k => k.toUpperCase() === n) || keys.find(k => n.length >= 4 && (k.toUpperCase().startsWith(n) || n.startsWith(k.toUpperCase()))) || null;
  };
  function findTube(name) {
    const n = String(name || "").trim().toUpperCase(); if (!n) return null;
    return (root.TUBE_DATABASE || []).find(t => [t.commonName, ...String(t.nameWestern || "").split("/"), ...String(t.nameGost || "").split("/")].some(a => a.trim().toUpperCase() === n)) || null;
  }
  /** The app's part for a KiCad symbol's unit: { type, params, sec (the section, "" or ".1"), pinOf:
      KiCad pin number → the part's pin, extra: the part's pins no KiCad pin stands for }, { drop: why }
      for a unit that needs no part here (a valve's heater), or null: kept as an imported part. */
  function mapPart(s) {
    const L = root.CadLib; if (!L) return null;
    const pins = s.pins, name = s.libId.split(":").pop().toUpperCase(), lib = s.libId.includes(":") ? s.libId.split(":")[0].toUpperCase() : "";
    const value = String(s.value || "").trim(), prefix = String(s.ref || "").replace(/[\d?.]+.*$/, "").toUpperCase();
    const byName = n => pins.find(p => p.name.trim().toUpperCase() === n), sorted = pins.slice().sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
    const two = pins.length === 2 && pins[0].num !== pins[1].num, single = s.count <= 1;
    const out = (type, params, pinOf, more) => {
      const def = L.LIB[type], c = { params: Object.assign({}, def.defaults, params), label: "X" + ((more && more.sec) || "") }, want = def.pins(c).map(p => p.id), got = new Set(Object.values(pinOf));
      const extra = want.filter(id => !got.has(id));
      if (extra.length && !(more && more.extraOk)) return null;
      if (Object.values(pinOf).some(id => !want.includes(id))) return null;
      return Object.assign({ type, params, pinOf, extra, sec: "" }, more || {});
    };
    const model = (table, type) => { const k = keyIn(table, value) || keyIn(table, name); return k ? { model: k } : { model: L.LIB[type].defaults.model, _unknown: value || name }; };
    // valves: by name, each unit a section; the heater's unit is the board's business here
    const tube = findTube(value) || (lib === "VALVE" || /^(V|VL|U)$/.test(prefix) ? findTube(name) : null);
    if (tube) {
      if (pins.length && pins.every(p => /^(F|H|FIL|HEATER|FILAMENT)\d*$/i.test(p.name.trim()))) return { drop: "heater" };
      const kind = L.tubeKind(tube), params = { tube: tube.commonName, connection: kind === "pentode" ? "pentode" : "triode" };
      const def = L.LIB.tube, want = def.pins({ params }).map(p => p.id), tryOne = sec => {
        const nums = def.pinNumbers({ params, label: "X" + sec }), pinOf = {};
        for (const id of want) { const list = String(nums[id] || "").split(",").filter(Boolean), p = pins.find(q => list.includes(q.num) && !(q.num in pinOf)); if (!p) return null; pinOf[p.num] = id; }
        return pinOf;
      };
      const a = tryOne(".1"), b = tryOne(".2"), twin = JSON.stringify(def.pinNumbers({ params, label: "X.1" })) !== JSON.stringify(def.pinNumbers({ params, label: "X.2" }));
      if (a || b) return { type: "tube", params, pinOf: a || b, extra: [], sec: twin ? (a ? ".1" : ".2") : "" };
      return null;
    }
    // a library of the project's own may call anything R or D: there the value has to read as one
    const std = lib === "DEVICE" || lib === "DIODE" || lib === "LED" || /^TRANSISTOR/.test(lib), num = engValue(value);
    if (two && !/NETWORK|PACK|ARRAY|POT|VAR|TRIM|THERM|PHOTO|FUSE|SHUNT/.test(name) && ((std || num) && /^R(_|$)|^RESISTOR/.test(name) || (prefix === "R" && num))) {
      const r = engValue(value);
      return out("resistor", r ? { r } : { _unknown: value }, { [sorted[0].num]: "1", [sorted[1].num]: "2" });
    }
    if (pins.length === 3 && (/POT|TRIM/.test(name) || prefix === "RV") && !/DUAL|SWITCH/.test(name)) {
      const w = pins.find(p => /^(W|WIPER)$/i.test(p.name.trim())) || sorted[1], ends = sorted.filter(p => p !== w), r = engValue(value);
      return out("pot", r ? { r } : { _unknown: value }, { [ends[0].num]: "1", [w.num]: "W", [ends[1].num]: "2" });
    }
    if (two && !/VAR|TRIM|FEED|NETWORK|PHOTO/.test(name) && ((std || num) && (/^C(_|$)|^CP(\d|_|$)|^CAP/.test(name) || prefix === "C"))) {
      let c = engValue(value);
      // a bare number: picofarads from 1 up, microfarads below
      if (c && /^\d*\.?\d+$/.test(value.split(/[\s/]/)[0])) c *= c >= 1 ? 1e-12 : 1e-6;
      const plus = byName("+") || (/POLAR|^CP|ELECTRO|^CE/.test(name) ? sorted[0] : null), p = c ? { c } : { _unknown: value };
      if (plus) return out("electrolytic", p, { [plus.num]: "+", [pins.find(q => q !== plus).num]: "-" });
      return out("capacitor", p, { [sorted[0].num]: "1", [sorted[1].num]: "2" });
    }
    if (two && !/CORE|COUPLED|FERRITE_BEAD|TRIM/.test(name) && ((std || num) && /^L(_|$)|^INDUCTOR|CHOKE/.test(name) || (prefix === "L" && num))) {
      const l = engValue(value);
      return out("inductor", l ? { l } : { _unknown: value }, { [sorted[0].num]: "1", [sorted[1].num]: "2" });
    }
    if (two && (byName("K") && byName("A") || std && /^D(_|$)|^LED/.test(name)) && (lib === "DIODE" || lib === "LED" || /^D(_|$)|^LED|DIODE|ZENER|SCHOTTKY|^1N\d/.test(name) || prefix === "D" || prefix === "LED") && !/TVS|BRIDGE|PHOTO|LASER|CAPACITANCE|TRIAC|DIAC|x2/i.test(name)) {
      const k = byName("K") || sorted[0], a = pins.find(p => p !== k), pinOf = { [k.num]: "K", [a.num]: "A" };
      if (/LED/.test(name) || prefix === "LED") return out("led", {}, pinOf);
      if (/ZENER/.test(name) || keyIn(L.ZENERS, value)) return out("zener", model(L.ZENERS, "zener"), pinOf);
      return out("diode", model(L.DIODES, "diode"), pinOf);
    }
    if (pins.length === 3) {
      const [b, c, e, g, d, src] = ["B", "C", "E", "G", "D", "S"].map(byName);
      if (b && c && e) {
        const known = keyIn(L.BJTS, value) || keyIn(L.BJTS, name), type = /PNP/.test(name) ? "pnp" : /NPN/.test(name) ? "npn" : known ? (L.BJTS[known].pol > 0 ? "npn" : "pnp") : null;
        if (type) return out(type, known ? { model: known } : { model: L.LIB[type].defaults.model, _unknown: value || name }, { [c.num]: "C", [b.num]: "B", [e.num]: "E" });
      }
      if (g && d && src) {
        const jk = keyIn(L.JFETS, value) || keyIn(L.JFETS, name), mk = keyIn(L.MOSFETS, value) || keyIn(L.MOSFETS, name);
        const type = /NJFET|JFET_N|N_?JFET/.test(name) ? "njf" : /PJFET|JFET_P|P_?JFET/.test(name) ? "pjf" : /NMOS|N_?MOSFET|NFET/.test(name) ? "nmos" : /PMOS|P_?MOSFET|PFET/.test(name) ? "pmos"
          : jk ? (L.JFETS[jk].pol > 0 ? "njf" : "pjf") : mk ? (L.MOSFETS[mk].pol > 0 ? "nmos" : "pmos") : null;
        const k = type && (/jf/.test(type) ? jk : mk);
        if (type) return out(type, k ? { model: k } : { model: L.LIB[type].defaults.model, _unknown: value || name }, { [d.num]: "D", [g.num]: "G", [src.num]: "S" });
      }
    }
    // op-amps: an amplifier per unit, the supply pins on a unit of their own (or on a single's symbol)
    const supply = p => (/^(V|VCC|VS|VDD)?\+$|^(VCC|VDD)$/i.test(p.name.trim()) ? "V+" : /^(V|VCC|VS|VEE|VSS)?-$|^(VEE|VSS)$|^V−$/i.test(p.name.trim()) ? "V-" : null);
    if (lib === "AMPLIFIER_OPERATIONAL" || keyIn(L.OPAMPS, value)) {
      const inP = byName("+"), inN = byName("-"), o = pins.find(p => p.type === "output" && !supply(p)) || byName("~");
      const amps = s.count > 2 ? s.count - 1 : s.count === 2 ? 1 : 1, known = keyIn(L.OPAMPS, value) || keyIn(L.OPAMPS, name);
      const mdl = known && (L.OPAMPS[known].units === amps) ? known : amps === 4 ? "TL074" : amps === 2 ? "TL072" : "TL071";
      if (!inP && !inN && pins.length && pins.every(supply)) return { connect: Object.fromEntries(pins.map(p => [p.num, supply(p)])) };
      if (inP && inN && o) {
        const def = L.LIB.opamp, units = L.OPAMPS[mdl].units;
        for (let k = 1; k <= units; k++) {
          const sec = units > 1 ? "." + k : "", nums = def.pinNumbers({ params: { model: mdl }, label: "X" + sec });
          if (nums.OUT !== o.num || nums["+"] !== inP.num || nums["-"] !== inN.num) continue;
          const pinOf = { [inP.num]: "+", [inN.num]: "-", [o.num]: "OUT" };
          pins.forEach(p => { const sp = supply(p); if (sp && nums[sp] === p.num) pinOf[p.num] = sp; });
          const m = out("opamp", known === mdl ? { model: mdl } : { model: mdl, _unknown: value || name }, pinOf, { sec, extraOk: true });
          if (m && m.extra.every(id => id === "V+" || id === "V-")) return m;
        }
      }
      return null;
    }
    if (single && pins.length === 8 && /555/.test(value + " " + name) && sorted.every((p, i) => p.num === String(i + 1))) return out("timer555", {}, Object.fromEntries(sorted.map(p => [p.num, p.num])));
    if (single && /^CONNECTOR/.test(lib) && pins.length >= 2 && sorted.every((p, i) => p.num === String(i + 1)) && pins.every(p => p.x === pins[0].x)) {
      const n = pins.length, pinOf = Object.fromEntries(sorted.map(p => [p.num, p.num]));
      if (/SCREW_TERMINAL/.test(name) && [2, 3, 4, 5, 6, 8].includes(n)) return out("terminal", { ways: n }, pinOf);
      if (/^CONN_01X\d+/.test(name) && [2, 3, 4, 5, 6, 8, 10].includes(n)) return out("header", { ways: n }, pinOf);
    }
    return null;
  }

  // a symbol unit as the imported part keeps it: drawing units, y down. g: the shapes
  // (["p", fill, x, y …] a line (an arc as one), ["c", fill, x, y, r], ["t", x, y, size, text]),
  // pins: { id, num, name, x, y, a (the lead's direction, degrees, KiCad's), l (its length), h (hidden) }
  function symData(lib, unit, U) {
    const R = v => Math.round(v * U * 10) / 10, g = [], pins = [], used = new Set();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    [lib.units.get(0), lib.units.get(unit)].filter(Boolean).forEach(u => {
      u.shapes.forEach(s => {
        if (s.k === "p" && s.pts.length >= 2) { g.push(["p", s.fill, ...s.pts.flatMap(p => [R(p[0]), R(-p[1])])]); s.pts.forEach(p => add(R(p[0]), R(-p[1]))); }
        else if (s.k === "c") { g.push(["c", s.fill, R(s.x), R(-s.y), R(s.r)]); add(R(s.x - s.r), R(-s.y - s.r)); add(R(s.x + s.r), R(-s.y + s.r)); }
        else if (s.k === "a") { const pts = arcPoints(s.pts[0], s.pts[1], s.pts[2], Math.PI / 10); g.push(["p", 0, ...pts.flatMap(p => [R(p[0]), R(-p[1])])]); pts.forEach(p => add(R(p[0]), R(-p[1]))); }
        else if (s.k === "t" && s.text.trim()) g.push(["t", R(s.x), R(-s.y), R(s.size), s.text]);
      });
      u.pins.forEach(p => {
        let id = p.num || p.name || "?"; for (let k = 2; used.has(id); k++) id = `${p.num || p.name || "?"}#${k}`;
        used.add(id);
        const q = { id, num: p.num, name: p.name === "~" ? "" : p.name, x: Math.round(p.x * U), y: Math.round(-p.y * U), a: p.a, l: R(p.len) };
        if (p.hide) q.h = 1;
        pins.push(q); add(q.x, q.y);
      });
    });
    if (!isFinite(x1)) { x1 = y1 = -10; x2 = y2 = 10; }
    const d = { g, pins, box: [Math.floor(x1) - 2, Math.floor(y1) - 2, Math.ceil(x2) + 2, Math.ceil(y2) + 2] };
    if (!lib.names.hide) d.pn = Math.round((lib.names.offset === undefined ? 0.508 : lib.names.offset) * U * 10) / 10;
    if (!lib.numbers.hide) d.pm = 1;
    return d;
  }
  // a box with its pins on both sides: a part only the board knows
  function boxSym(names) {
    const n = names.length, left = Math.ceil(n / 2), h = Math.max(left, 1) * 20 + 20, w = 80, g = [["p", 2, -w / 2, -10, w / 2, -10, w / 2, h - 10, -w / 2, h - 10, -w / 2, -10]], pins = [];
    names.forEach((nm, i) => { const l = i < left, k = l ? i : i - left; pins.push({ id: nm, num: nm, name: "", x: l ? -w / 2 - 20 : w / 2 + 20, y: 10 + k * 20, a: l ? 0 : 180, l: 20 }); });
    return { g, pins, box: [-w / 2 - 22, -12, w / 2 + 22, h - 8], pm: 1 };
  }

  const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
    USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4], A5: [210, 148] };
  const GROUNDS = ["GND", "GNDREF", "GNDA", "GNDD", "0V", "EARTH", "GNDPWR", "VSS"];
  const railVolts = n => { const m = /^([+-]?)(\d+)(?:V(\d+)|\.(\d+)V|V)$/i.exec(String(n).trim()); return m ? (m[1] === "-" ? -1 : 1) * parseFloat(m[2] + "." + (m[3] || m[4] || "0")) : null; };

  // KiCad joins a wire only at its ends (and at a junction, a label anywhere along it); the app joins
  // whatever ends on a wire. Where a wire passes a pin or another wire's end without meaning it, it
  // takes a small step round the spot here. W: [[x1, y1, x2, y2]] (straight), pins and labels: [[x, y]].
  // Returns the spots where no clean step was found (they stay joined).
  function untouch(W, pins, labels) {
    const kk = (x, y) => x + "," + y, left = [], skip = new Set();
    const inside = (w, x, y) => (w[1] === w[3] ? y === w[1] && x > Math.min(w[0], w[2]) && x < Math.max(w[0], w[2]) : x === w[0] && y > Math.min(w[1], w[3]) && y < Math.max(w[1], w[3]));
    const onSeg = (w, x, y) => inside(w, x, y) || (x === w[0] && y === w[1]) || (x === w[2] && y === w[3]);
    for (let pass = 0; pass < 400; pass++) {
      const par = new Map(), find = k => { if (!par.has(k)) par.set(k, k); let r = k; while (par.get(r) !== r) r = par.get(r); par.set(k, r); return r; };
      const pts = new Map(), rows = new Map(), cols = new Map();
      W.forEach(w => { par.set(find(kk(w[0], w[1])), find(kk(w[2], w[3]))); pts.set(kk(w[0], w[1]), [w[0], w[1]]); pts.set(kk(w[2], w[3]), [w[2], w[3]]); const m = w[1] === w[3] ? rows : cols, q = w[1] === w[3] ? w[1] : w[0]; if (!m.has(q)) m.set(q, []); m.get(q).push(w); });
      pins.forEach(p => pts.set(kk(p[0], p[1]), p));
      const over = (x, y) => (rows.get(y) || []).concat(cols.get(x) || []).filter(w => inside(w, x, y));
      labels.forEach(l => over(l[0], l[1]).forEach(w => par.set(find(kk(l[0], l[1])), find(kk(w[0], w[1])))));
      let hit = null;
      for (const [k, P] of pts) { const w = over(P[0], P[1]).find(q => find(k) !== find(kk(q[0], q[1])) && !skip.has(k + "|" + q.join(","))); if (w) { hit = [w, P, k]; break; } }
      if (!hit) break;
      const [w, P, k] = hit, hor = w[1] === w[3], a = hor ? Math.min(w[0], w[2]) : Math.min(w[1], w[3]), b = hor ? Math.max(w[0], w[2]) : Math.max(w[1], w[3]), c = hor ? P[0] : P[1];
      const d = Math.min(5, Math.floor((c - a) / 2), Math.floor((b - c) / 2));
      let made = null;
      if (d >= 2) for (const side of [5, -5, 3, -3]) {
        const pt = (along, off) => (hor ? [along, w[1] + off] : [w[0] + off, along]), c1 = pt(c - d, 0), c2 = pt(c - d, side), c3 = pt(c + d, side), c4 = pt(c + d, 0);
        const legs = [[...c1, ...c2], [...c2, ...c3], [...c3, ...c4]], rest = W.filter(q => q !== w);
        const clean = [c1, c2, c3, c4].every(q => !pts.has(kk(q[0], q[1])) && !rest.some(r => onSeg(r, q[0], q[1]))) && legs.every(l => ![...pts.values()].some(q => onSeg(l, q[0], q[1])));
        if (clean) { made = [[...pt(a, 0), ...c1], ...legs, [...c4, ...pt(b, 0)]]; break; }
      }
      if (made) W.splice(W.indexOf(w), 1, ...made); else { skip.add(k + "|" + w.join(",")); if (!left.some(q => q[0] === P[0] && q[1] === P[1])) left.push(P); }
    }
    return left;
  }

  /** A KiCad project as a design. files: { name: text } (.kicad_sch, .kicad_pcb, .kicad_pro; one
      schematic or one board alone will do). Returns { design: { app, version, comps, wires, board },
      name, report: { sheets, parts, own, kept, wires, connectors, notes: [text], board: {...} | null, padNets } } */
  function importProject(files) {
    const L = root.CadLib, names = Object.keys(files || {}), ext = e => names.filter(n => n.toLowerCase().endsWith(e));
    const schNames = ext(".kicad_sch"), pcbNames = ext(".kicad_pcb"), proNames = ext(".kicad_pro");
    if (!schNames.length && !pcbNames.length) throw new Error("no KiCad schematic (.kicad_sch) or board (.kicad_pcb) among the files");
    const notes = [], note = t => { if (!notes.includes(t)) notes.push(t); }, stand = new Map();
    const schs = new Map(), sch = n => { if (!schs.has(n)) schs.set(n, readSch(files[n])); return schs.get(n); };
    const byBase = b => schNames.find(n => baseOf(n).toLowerCase() === baseOf(b).toLowerCase());
    // the root sheet: the project's own, else the one no other sheet holds
    let rootName = null;
    if (schNames.length) {
      const pro = proNames.map(stem), held = new Set();
      schNames.forEach(n => { try { sch(n).sheets.forEach(s => { const f = byBase(s.file); if (f) held.add(f); }); } catch (e) { throw new Error(baseOf(n) + ": " + e.message); } });
      rootName = schNames.find(n => pro.includes(stem(n)) && !held.has(n)) || schNames.find(n => pcbNames.map(stem).includes(stem(n)) && !held.has(n)) || schNames.find(n => !held.has(n)) || schNames[0];
    }
    const pcbName = pcbNames.find(n => rootName && stem(n) === stem(rootName)) || pcbNames[0] || null;
    const name = stem(proNames[0] || rootName || pcbName);
    const comps = [], wires = [], report = { sheets: 0, parts: 0, own: 0, kept: 0, wires: 0, connectors: 0, notes, board: null, padNets: {}, pinMaps: [] };
    let nid = 0;
    const id = p => `${p}${++nid}_k`;
    const addComp = (type, x, y, rot, params, label) => { const c = { id: id("c"), type, x, y, rot: rot & 3, params: params || {}, label: label || "" }; comps.push(c); return c; };
    const boardOnly = new Map();    // this app's own export: reference → the key of a part only the board has
    const byRef = new Map();        // reference → [{ comp, pinOf (KiCad pin number → the part's pin), kept }]
    const refPart = (ref, e) => { if (!byRef.has(ref)) byRef.set(ref, []); byRef.get(ref).push(e); };

    if (rootName) {
      // the sheets of the hierarchy, each as often as it is used
      const insts = [], rootSch = sch(rootName);
      (function walk(n, path, nm, parent, depth, uuid) {
        const s = sch(n); insts.push({ sch: s, file: n, path, name: nm, parent, sheetUuid: uuid });
        if (depth > 12) return;
        const me = insts.length - 1;
        s.sheets.forEach(sh => { const f = byBase(sh.file); if (!f) { note(`Sheet "${sh.name}" (${sh.file}) is not among the opened files: open all the project's .kicad_sch files together.`); return; } walk(f, path + "/" + sh.uuid, (nm ? nm + "/" : "") + (sh.name || stem(sh.file)), me, depth + 1, sh.uuid); });
      })(rootName, "/" + rootSch.uuid, "", -1, 0);
      const own = insts.some(I => I.sch.symbols.some(s => s.props.TubeAmpCAD));
      const U = own ? 1 / 0.254 : 1 / 0.127;
      // Net names. A label names a net on its own sheet, a global label and a power symbol on all of
      // them; a sheet's pin is the label of that name inside it, and the members of a bus (D[0..7])
      // pass through bus pins one by one. Names that are one net are joined here, and each net then
      // shows the shortest of its names (a sheet's own with the sheet's name before it when another
      // net has that name too).
      const par = new Map(), find = k => { if (!par.has(k)) par.set(k, k); let r = k; while (par.get(r) !== r) r = par.get(r); par.set(k, r); return r; };
      const LK = (i, t) => "L|" + i + "|" + t, GK = t => "G|" + t;
      const vector = t => { const m = /^(.*)\[(\d+)\.\.(\d+)\]$/.exec(String(t).trim()); if (!m) return null; const out = [], a = +m[2], b = +m[3]; for (let k = a; a <= b ? k <= b : k >= b; k += a <= b ? 1 : -1) out.push(m[1] + k); return out; };
      insts.forEach((I, i) => { I.i = i; I.childOf = new Map(); });
      insts.forEach((I, i) => { if (I.parent >= 0) insts[I.parent].childOf.set(I.sheetUuid, i); });
      insts.forEach((I, i) => {
        const S = I.sch, eps = 0.02, on = (b, x, y) => Math.abs((b[2] - b[0]) * (y - b[1]) - (b[3] - b[1]) * (x - b[0])) < eps * (Math.hypot(b[2] - b[0], b[3] - b[1]) + eps) && x >= Math.min(b[0], b[2]) - eps && x <= Math.max(b[0], b[2]) + eps && y >= Math.min(b[1], b[3]) - eps && y <= Math.max(b[1], b[3]) + eps;
        I.sch.labels.forEach(l => find(l.kind === "global" ? GK(l.text) : LK(i, l.text)));
        if (!S.buses.length) return;
        // the buses of the sheet as groups of segments that touch
        const g = S.buses.map((_, k) => k), gf = k => { while (g[k] !== k) k = g[k] = g[g[k]]; return k; };
        S.buses.forEach((a, ia) => S.buses.forEach((b, ib) => { if (ia < ib && (on(b, a[0], a[1]) || on(b, a[2], a[3]) || on(a, b[0], b[1]) || on(a, b[2], b[3]))) g[gf(ia)] = gf(ib); }));
        const ports = new Map(), port = (x, y, keys) => { const k = S.buses.findIndex(b => on(b, x, y)); if (k < 0 || !keys) return; const r = gf(k); if (!ports.has(r)) ports.set(r, []); ports.get(r).push(keys); };
        S.labels.forEach(l => { const v = vector(l.text); if (v) port(l.x, l.y, v.map(t => (l.kind === "global" ? GK(t) : LK(i, t)))); });
        S.sheets.forEach(sh => { const c = I.childOf.get(sh.uuid); if (c !== undefined) sh.pins.forEach(p => { const v = vector(p.name); if (v) port(p.x, p.y, v.map(t => LK(c, t))); }); });
        ports.forEach(list => list.slice(1).forEach(v => v.forEach((k, n) => { if (list[0][n] !== undefined) par.set(find(k), find(list[0][n])); })));
        if (S.labels.some(l => /^\{.*\}$/.test(l.text.trim()))) note("Group buses ({…}) are not followed: join their signals by labels.");
      });
      const globals = new Set();
      insts.forEach(I => { I.sch.labels.forEach(l => { if (l.kind === "global") globals.add(l.text.toUpperCase()); }); I.sch.symbols.forEach(s => { const lb = I.sch.libs.get(s.libName || s.libId); if (lb && (lb.power || /^#PWR/.test(s.props.Reference || ""))) { globals.add(String(s.props.Value || "").toUpperCase()); lb.units.forEach(u => u.pins.forEach(p => globals.add(p.name.toUpperCase()))); } }); });
      const ground = GROUNDS.find(g => globals.has(g)) || null;
      // the name each net shows: a global one first, then the sheets from the top down
      const shown = new Map(), taken = new Set(), keys = [...par.keys()];
      const rank = k => (k[0] === "G" ? -1 : insts[+k.split("|")[1]].name.split("/").filter(Boolean).length), text = k => k.split("|").slice(k[0] === "G" ? 1 : 2).join("|");
      keys.sort((a, b) => rank(a) - rank(b));
      keys.forEach(k => {
        const r = find(k); if (shown.has(r)) return;
        const I = k[0] === "G" ? null : insts[+k.split("|")[1]], t = text(k);
        let nm = t;
        if (taken.has(nm.toUpperCase()) && I && I.name) nm = I.name + "/" + t;
        for (let n = 2; taken.has(nm.toUpperCase()); n++) nm = `${t}_${n}`;
        taken.add(nm.toUpperCase()); shown.set(r, nm);
      });
      const nameOf = k => { const r = find(k); if (!shown.has(r)) { let nm = text(k); for (let n = 2; taken.has(nm.toUpperCase()); n++) nm = `${text(k)}_${n}`; taken.add(nm.toUpperCase()); shown.set(r, nm); } return shown.get(r); };
      let ox = 0;
      insts.forEach(I => {
        const S = I.sch, pp = S.paper, dims = PAPERS[pp.size] || (pp.w && pp.h ? [pp.w, pp.h] : PAPERS.A4), pw = pp.portrait ? Math.min(...dims) : dims[0], ph = pp.portrait ? Math.max(...dims) : dims[1];
        // the drawing frame the page fits (the app draws 4 units to the millimetre)
        const need = [pw * U / 4, ph * U / 4], size = own && L.SHEETS[pp.size] ? pp.size : (Object.keys(L.SHEETS).sort((a, b) => L.SHEETS[a][0] - L.SHEETS[b][0]).find(k => { const [w, h] = L.SHEETS[k]; return (need[0] >= need[1] ? w >= need[0] * 0.97 && h >= need[1] * 0.97 : h >= need[0] * 0.97 && w >= need[1] * 0.97); }) || "A0");
        const portrait = need[1] > need[0], fw = (portrait ? L.SHEETS[size][1] : L.SHEETS[size][0]) * 4;
        // a part's place on the 10-unit grid: the page moves by what its first symbol is off it
        const base0 = ox; let to0 = (x, y) => [base0 + Math.round(x * U), Math.round(y * U)], fwOwn = 0, gx = 0, gy = 0;
        const to = (x, y) => { const q = to0(x, y); return [q[0] - gx, q[1] - gy]; };
        if (I.parent < 0 && insts.length > 1 && S.sheets.length && !S.symbols.length && !S.wires.length && !S.labels.length) return;      // a root sheet that only holds the others
        let fmark = null; if (S.title.mark) { try { fmark = JSON.parse(S.title.mark.replace(/^TubeAmpCAD /, "")); } catch (e) { fmark = null; } }
        if (fmark && fmark.p && Array.isArray(fmark.o) && L.SHEETS[fmark.p.size]) {
          // this app's own sheet: its frame as it was, the drawing where it was in it
          const was = Array.isArray(fmark.at) ? fmark.at : [ox, 0], base = was[0], by = was[1], o = fmark.o;
          const fc = addComp("frame", base, by, 0, Object.assign({}, fmark.p, fmark.at ? {} : { sheet: "" })), g = L.sheetGeom({ params: Object.assign({}, L.LIB.frame.defaults, fc.params) });
          to0 = (x, y) => [base + o[0] + Math.round((x - o[2]) / 0.254), by + o[1] + Math.round((y - o[3]) / 0.254)];
          if (fmark.l !== undefined) fc.label = fmark.l;
          fwOwn = g.W; ox = Math.max(ox, base);
        } else {
          const fr = addComp("frame", ox, 0, 0, { locked: "yes", size, orient: portrait ? "portrait" : "landscape", title: (S.title.title || (I.parent < 0 ? name : "")) + (I.name ? (S.title.title ? ": " : "") + I.name : ""), date: S.title.date || "", rev: S.title.rev || "A", owner: S.title.company || "", sheet: "", docno: "", doctype: "Circuit diagram", status: "Imported from KiCad" });
          fr.label = "";
        }
        report.sheets++;
        { const s0 = S.symbols[0]; if (s0) { const q = to0(s0.x, s0.y); gx = ((q[0] % 10) + 10) % 10; gy = ((q[1] % 10) + 10) % 10; if (gx > 5) gx -= 10; if (gy > 5) gy -= 10; } }
        const conn = (nm, x, y, rot) => { report.connectors++; return addComp("offsheet", x, y, rot, { name: nm }); };
        const wire = (x1, y1, x2, y2) => { if (x1 !== x2 || y1 !== y2) wires.push({ id: id("w"), x1, y1, x2, y2 }); };
        const powerAt = (pw, x, y, rot, dir) => {
          const k = pw.toUpperCase(), nm = nameOf(GK(pw));
          if (ground && k === ground) return addComp("ground", x, y, dir ? dir.i : rot);
          const v = railVolts(nm);
          if (v !== null && dir) return addComp("rail", x, y, [2, 3, 0, 1][dir.i], { name: nm, v, shown: nm });
          return conn(nm, x, y, dir ? [1, 2, 3, 0][dir.i] : rot);
        };
        const dropped = [];        // pins of a unit the app has no part for here: what hangs on them alone goes too
        const pinPts = [];         // where KiCad's pins are, for the wires that only pass them
        S.symbols.forEach(sym => {
          const lib = S.libs.get(sym.libName || sym.libId);
          if (!lib) { note(`Symbol ${sym.props.Reference || sym.libId} has no drawing in the file (${sym.libId}): left out.`); return; }
          const inst = sym.instances.find(q => q.path === I.path) || (rootSch.symbolInstances || []).find(q => q.path === I.path + "/" + sym.uuid) || (sym.instances.length === 1 && insts.length === 1 ? sym.instances[0] : null);
          const ref = String((inst && inst.ref) || sym.props.Reference || "?"), unit = (inst && inst.unit) || sym.unit;
          const M = matrix(sym.a, sym.mirror), at = (x, y) => to(sym.x + M[0] * x + M[1] * y, sym.y + M[2] * x + M[3] * y);
          const pins = [lib.units.get(0), lib.units.get(unit)].filter(Boolean).flatMap(u => u.pins);
          const value = String(sym.props.Value || "");
          pins.forEach(p => pinPts.push(at(p.x, p.y)));
          // the way a point of the symbol lies from its pin (0 down, 1 left, 2 up, 3 right), for a power symbol's turn
          const bodyDir = p => {
            let cx = 0, cy = 0, n = 0;
            [lib.units.get(0), lib.units.get(unit)].filter(Boolean).forEach(u => u.shapes.forEach(s => (s.pts || [[s.x, s.y]]).forEach(q => { cx += q[0] - p.x; cy += q[1] - p.y; n++; })));
            if (!n || (Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6)) return null;
            const dx = M[0] * cx + M[1] * cy, dy = M[2] * cx + M[3] * cy;
            return { i: Math.abs(dy) >= Math.abs(dx) ? (dy > 0 ? 0 : 2) : (dx < 0 ? 1 : 3) };
          };
          // a mark this app's export left: the part as it was
          let mark = null;
          if (sym.props.TubeAmpCAD) { try { mark = JSON.parse(sym.props.TubeAmpCAD); } catch (e) { mark = null; } }
          if (mark && mark.skip) { pins.forEach(p => dropped.push(at(p.x, p.y))); if (mark.k) boardOnly.set(ref, String(mark.k)); return; }
          if (mark && mark.t && L.LIB[mark.t] && (lib.power || /^#/.test(ref))) { const [x, y] = at(0, 0); addComp(mark.t, x, y, mark.r || 0, mark.p || {}, ""); if (mark.t === "offsheet") report.connectors++; return; }
          if (lib.power || /^#/.test(ref)) {
            // (an old library's power symbol has no flag: its hidden supply pin names the net)
            if (!/^#FLG/.test(ref) && value !== "PWR_FLAG") pins.forEach(p => { if (p.type !== "power_in" && !lib.power || p.type === "power_out") return; const [x, y] = at(p.x, p.y); powerAt(lib.power && (S.version >= 20231120 || !p.name) ? value : p.name || value, x, y, 0, bodyDir(p)); });
            return;      // a power flag (#FLG) says nothing here
          }
          report.parts++;
          const count = lib.count, sec = count > 1 ? "." + unit : "";
          if (mark && mark.t && L.LIB[mark.t]) {
            const [x, y] = at(0, 0), c = addComp(mark.t, x, y, mark.r || 0, mark.p || {}, mark.l !== undefined ? mark.l : ref + sec);
            // which pad each of its pins is, by where the pins are (for a footprint that is not the app's own)
            const d0 = L.LIB[mark.t], full0 = Object.assign({}, c, { params: Object.assign({}, d0.defaults, c.params) }), fl = full0.params.flip === "yes" ? -1 : 1, pinOf = {};
            d0.pins(full0).forEach(q => { const [px, py] = rotPt(fl * q.x, q.y, c.rot); pins.forEach(p => { const a = at(p.x, p.y); if (a[0] === c.x + px && a[1] === c.y + py) pinOf[p.num] = q.id; }); });
            refPart(ref, { comp: c, pinOf, kept: false, own: true }); report.own++; report.pinMaps.push([ref, c.id, pinOf]);
            return;
          }
          // hidden supply pins join the net of their name
          pins.forEach(p => { if (p.hide && p.type === "power_in" && p.name) { const [x, y] = at(p.x, p.y); powerAt(p.name, x, y, 0, null); } });
          const m = mapPart({ libId: sym.libId, value, ref, pins, count });
          const heater = !!(m && m.drop);
          if (heater) note("A valve's heater unit is kept as KiCad draws it (VL1.H): the board wires these heaters as the sheet has them, not from its own heater supply.");
          if (m && m.connect) { pins.forEach(p => { const [x, y] = at(p.x, p.y); conn(`${ref}/${m.connect[p.num]}`, x, y, 0); }); return; }
          if (m && !heater) {
            const def = L.LIB[m.type], params = Object.assign({}, m.params), unknown = params._unknown; delete params._unknown;
            const full = Object.assign({}, def.defaults, params), targets = {};
            pins.forEach(p => { if (m.pinOf[p.num] && !targets[m.pinOf[p.num]]) targets[m.pinOf[p.num]] = at(p.x, p.y); });
            // the turn and the place that put the part's pins nearest the symbol's
            let best = null;
            for (let flip = 0; flip < 2; flip++) for (let rot = 0; rot < 4; rot++) {
              const c = { params: Object.assign({}, full, flip ? { flip: "yes" } : {}), label: ref + m.sec };
              const local = def.pins(c).filter(p => targets[p.id]).map(p => { const [x, y] = rotPt(flip ? -p.x : p.x, p.y, rot); return { id: p.id, x, y }; });
              const cands = local.map(p => [targets[p.id][0] - p.x, targets[p.id][1] - p.y]);
              cands.push([Math.round(cands.reduce((s2, q) => s2 + q[0], 0) / cands.length), Math.round(cands.reduce((s2, q) => s2 + q[1], 0) / cands.length)]);
              cands.forEach(([tx, ty]) => {
                let cost = 0; local.forEach(p => { const dx = Math.abs(p.x + tx - targets[p.id][0]), dy = Math.abs(p.y + ty - targets[p.id][1]); cost += dx + dy + (dx && dy ? 40 : 0); });
                if (!best || cost < best.cost - 1e-9) best = { cost, rot, flip, tx, ty, local };
              });
            }
            const c = addComp(m.type, best.tx, best.ty, best.rot, Object.assign(params, best.flip ? { flip: "yes" } : {}), ref + m.sec);
            best.local.forEach(p => {
              const px = p.x + best.tx, py = p.y + best.ty, [qx, qy] = targets[p.id];
              if (px === qx || py === qy) wire(px, py, qx, qy);
              else if (Math.abs(p.x) >= Math.abs(p.y)) { wire(px, py, qx, py); wire(qx, py, qx, qy); }
              else { wire(px, py, px, qy); wire(px, qy, qx, qy); }
            });
            // an op-amp's supply pins: on the nets of its supply unit, by name
            (m.extra || []).forEach(pid => { const p = def.pins({ params: full, label: c.label }).find(q => q.id === pid), [x, y] = rotPt(best.flip ? -p.x : p.x, p.y, best.rot); conn(`${ref}/${pid}`, x + best.tx, y + best.ty, pid === "V+" ? 3 : 1); });
            if (unknown !== undefined) {
              const passive = m.type === "resistor" || m.type === "capacitor" || m.type === "electrolytic" || m.type === "inductor" || m.type === "pot", k = passive ? "" : `${unknown}\n${params.model}`;
              if (!stand.has(k)) stand.set(k, []);
              stand.get(k).push(passive ? `${ref} "${unknown}"` : ref);
            }
            refPart(ref, { comp: c, pinOf: m.pinOf, kept: false }); report.own++; report.pinMaps.push([ref, c.id, m.pinOf]);
            return;
          }
          // kept as KiCad draws it
          const [x, y] = at(0, 0), N = [M[0], -M[1], M[2], -M[3]];
          let rot = 0, flip = 0;
          for (let f = 0; f < 2; f++) for (let r = 0; r < 4; r++) { const s1 = f ? -1 : 1, A = [[s1, 0, 0, 1], [0, -1, s1, 0], [-s1, 0, 0, -1], [0, 1, -s1, 0]][r]; if (A.every((v, k) => v === N[k])) { rot = r; flip = f; } }
          const params = { value, footprint: String(sym.props.Footprint || ""), lib: sym.libId, desc: lib.desc || "", sym: symData(lib, unit, U) };
          if (flip) params.flip = "yes";
          const c = addComp("kicad", x, y, rot, params, ref + (heater ? ".H" : sec));
          const pinOf = {}; params.sym.pins.forEach(p => { pinOf[p.num] = p.id; });
          refPart(ref, { comp: c, pinOf, kept: true }); report.kept++;
        });
        // wires; a slanted one as two legs
        const W = [];
        S.wires.forEach(w => {
          const [x1, y1] = to(w[0], w[1]), [x2, y2] = to(w[2], w[3]);
          if (x1 !== x2 && y1 !== y2) { W.push([x1, y1, x2, y1], [x2, y1, x2, y2]); note("Slanted wires are drawn as two straight legs."); } else if (x1 !== x2 || y1 !== y2) W.push([x1, y1, x2, y2]);
        });
        // a junction joins the wires that cross at it
        S.junctions.forEach(j => {
          const [x, y] = to(j[0], j[1]);
          for (let k = W.length - 1; k >= 0; k--) {
            const w = W[k], inside = w[1] === w[3] ? y === w[1] && x > Math.min(w[0], w[2]) && x < Math.max(w[0], w[2]) : x === w[0] && y > Math.min(w[1], w[3]) && y < Math.max(w[1], w[3]);
            if (inside) W.splice(k, 1, [w[0], w[1], x, y], [x, y, w[2], w[3]]);
          }
        });
        const labels = S.labels.map(l => { const [x, y] = to(l.x, l.y); return { ...l, X: x, Y: y }; });
        S.sheets.forEach(sh => sh.pins.forEach(p => pinPts.push(to(p.x, p.y))));
        const touching = untouch(W, pinPts, labels.map(l => [l.X, l.Y]));
        if (touching.length) note(`${touching.length} place${touching.length > 1 ? "s" : ""} where a wire ends on another or lies over a pin with no junction in KiCad ${touching.length > 1 ? "are" : "is"} joined here (KiCad does not join them): check the sheet there.`);
        // this app's export: the labels it wrote at pins (net classes) and the stubs of its heater boxes go
        if (own) {
          const ends = new Map(), k2 = (x, y) => x + "," + y, pinsAt = new Set();
          comps.forEach(c => { if (L.LIB[c.type] && c.type !== "frame") { try { const d = L.LIB[c.type], full = Object.assign({}, d.defaults, c.params), f = full.flip === "yes" ? -1 : 1; d.pins({ params: full, label: c.label }).forEach(p => { const [x, y] = rotPt(f * p.x, p.y, c.rot); pinsAt.add(k2(c.x + x, c.y + y)); }); } catch (e) { /* no pins */ } } });
          W.forEach((w, i) => { [k2(w[0], w[1]), k2(w[2], w[3])].forEach(k => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); }); });
          const gone = new Set();
          dropped.forEach(([x, y]) => (ends.get(k2(x, y)) || []).forEach(i => { const w = W[i], other = w[0] === x && w[1] === y ? [w[2], w[3]] : [w[0], w[1]], lab = labels.find(l => l.X === other[0] && l.Y === other[1]); if (lab && (ends.get(k2(other[0], other[1])) || []).length === 1) { gone.add(i); lab.gone = true; } }));
          labels.forEach(l => { if (pinsAt.has(k2(l.X, l.Y))) l.gone = true; });
          for (let i = W.length - 1; i >= 0; i--) if (gone.has(i)) W.splice(i, 1);
        }
        W.forEach(w => wire(w[0], w[1], w[2], w[3]));
        report.wires += W.length;
        labels.forEach(l => {
          if (l.gone) return;
          const rot = ({ 0: 0, 90: 3, 180: 2, 270: 1 })[((Math.round(l.a) % 360) + 360) % 360] || 0;
          if (vector(l.text) || /^\{.*\}$/.test(l.text.trim())) return;      // on a bus
          if (l.kind === "global") { if (ground && l.text.toUpperCase() === ground) addComp("ground", l.X, l.Y, 0); else conn(nameOf(GK(l.text)), l.X, l.Y, rot); }
          else conn(nameOf(LK(I.i, l.text)), l.X, l.Y, rot);
        });
        // a sheet of the hierarchy: its pins as connectors to that sheet's labels
        S.sheets.forEach(sh => {
          const [bx, by] = to(sh.x, sh.y);
          if (!own) addComp("note", bx + 10, by + 20, 0, { text: `Sheet: ${sh.name || stem(sh.file)}`, size: "12" });
          const ci = I.childOf.get(sh.uuid);
          if (ci !== undefined) sh.pins.forEach(p => { if (vector(p.name)) return; const [x, y] = to(p.x, p.y), rot = Math.abs(p.x - sh.x) < 0.01 ? 0 : Math.abs(p.x - sh.x - sh.w) < 0.01 ? 2 : Math.abs(p.y - sh.y) < 0.01 ? 1 : 3; conn(nameOf(LK(ci, p.name)), x, y, rot); });
        });
        S.texts.forEach(t => { const [x, y] = to(t.x, t.y), h = own ? String(Math.round(t.size / (0.254 * 0.72))) : t.size * U >= 17 ? "20" : t.size * U >= 13 ? "14" : "12"; String(t.text).split(/\r?\n/).forEach((ln, k) => { if (ln.trim()) addComp("note", x, y + k * (+h + 4), 0, { text: ln, size: h }); }); });
        if (S.buses.length) note("Buses are not drawn: their signals are joined by name, as the labels on their wires say.");
        ox += Math.ceil(((fwOwn || fw) + 240) / 10) * 10;
      });
      if (!ground && comps.some(c => c.type !== "frame")) note("No GND power symbol in the schematic: add a Ground symbol to the reference net before simulating.");
      if (!own && comps.some(c => c.type === "offsheet") && !comps.some(c => c.type === "rail" || c.type === "vdc")) note("Supply nets came in as named connectors: put a Power rail of the same name on the sheet (or a DC supply) to feed them in the simulation.");
      // the parts that stand in for a type or a value the app does not have, a line for each type
      const few = l => l.slice(0, 12).join(", ") + (l.length > 12 ? ` and ${l.length - 12} more` : "");
      stand.forEach((refs, k) => {
        if (!k) note(`${few(refs)}: the value is not a number here, so the part has its default value: set it in the inspector.`);
        else { const [was, model] = k.split("\n"); note(`${few(refs)} (${was}): the app has no model of this type, so ${refs.length > 1 ? "they simulate" : "it simulates"} as ${model}: pick the nearest type in the inspector.`); }
      });
      if (report.kept) note(`${report.kept} symbol${report.kept > 1 ? "s" : ""} the app has no part for ${report.kept > 1 ? "are" : "is"} kept as drawn in KiCad: wired and on the board, but not simulated.`);
    }

    // the board
    let board = null;
    if (pcbName && root.BoardCore) {
      const pcb = readPcb(files[pcbName]);
      if (!rootName) boardSchematic(pcb, { addComp, wires, id, refPart, report, note });
      let pro = null;
      try { const pn = proNames.find(n => stem(n) === stem(pcbName)) || proNames[0]; if (pn) pro = JSON.parse(files[pn]); } catch (e) { pro = null; }
      board = buildBoard(pcb, byRef, report, note, pro, boardOnly);
    } else if (pcbName) note("The board was not read: the board module is not loaded.");
    return { design: Object.assign({ app: "TubeAmpCAD", version: 2, comps, wires }, board ? { board } : {}), name, report };
  }

  // ---------------------------------------------------------------------------
  // The board file
  // ---------------------------------------------------------------------------
  function arcPoints(s, m, e, step) {
    // the circle through three points, as a polyline from s to e through m
    const ax = s[0], ay = s[1], bx = m[0], by = m[1], cx = e[0], cy = e[1], d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-9) return [s, e];
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d, uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r = Math.hypot(ax - ux, ay - uy), a0 = Math.atan2(ay - uy, ax - ux), a1 = Math.atan2(by - uy, bx - ux);
    let a2 = Math.atan2(cy - uy, cx - ux);
    const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), ccw = norm(a1 - a0) < norm(a2 - a0);
    let sweep = ccw ? norm(a2 - a0) : -norm(a0 - a2);
    if (Math.abs(sweep) < 1e-9) sweep = 2 * Math.PI;
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / (step || Math.PI / 8))), out = [];
    for (let k = 0; k <= n; k++) { const a = a0 + sweep * k / n; out.push([ux + r * Math.cos(a), uy + r * Math.sin(a)]); }
    out[0] = s; out[n] = e;
    return out;
  }
  function readPcb(text) {
    const t = parse(text);
    if (t[0] !== "kicad_pcb") throw new Error("not a KiCad board");
    const P = (e, h) => { const a = kid(e, h); return a ? [+a[1], +a[2]] : [0, 0]; }, layersOf = e => { const l = kid(e, "layers") || kid(e, "layer") || []; return l.slice(1).map(String); };
    const pcb = { nets: {}, footprints: [], segments: [], vias: [], zones: [], edges: [], texts: [], copperLayers: 2, generator: String(val(t, "generator", "")) };
    pcb.copperLayers = (kid(t, "layers") || []).filter(l => Array.isArray(l) && /\.Cu$/.test(String(l[1]))).length;
    kids(t, "net").forEach(n => { pcb.nets[n[1]] = String(n[2] || ""); });
    const netOf = e => { const n = kid(e, "net"); return n ? (n[2] !== undefined ? String(n[2]) : pcb.nets[n[1]] || "") : ""; };
    const shapes = (e, pre, out) => {
      kids(e, pre + "line").forEach(g => out.push({ layer: layersOf(g)[0], pts: [P(g, "start"), P(g, "end")] }));
      kids(e, pre + "rect").forEach(g => { const a = P(g, "start"), b = P(g, "end"); out.push({ layer: layersOf(g)[0], pts: [a, [b[0], a[1]], b, [a[0], b[1]], a], rect: true }); });
      kids(e, pre + "arc").forEach(g => out.push({ layer: layersOf(g)[0], pts: arcPoints(P(g, "start"), P(g, "mid"), P(g, "end")), arc: [P(g, "start"), P(g, "end")], mid: P(g, "mid") }));
      kids(e, pre + "circle").forEach(g => { const c = P(g, "center"), q = P(g, "end"), r = Math.hypot(q[0] - c[0], q[1] - c[1]); out.push({ layer: layersOf(g)[0], circle: [c[0], c[1], r], pts: [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]] }); });
      kids(e, pre + "poly").forEach(g => { const pts = xyList(g); if (pts.length > 1) out.push({ layer: layersOf(g)[0], pts: pts.concat([pts[0]]) }); });
    };
    (kids(t, "footprint").concat(kids(t, "module"))).forEach(e => {
      const a = kid(e, "at") || [0, 0, 0, 0], f = { lib: String(e[1]), layer: String(val(e, "layer", "F.Cu")), x: +a[1], y: +a[2], a: +a[3] || 0, ref: prop(e, "Reference"), value: prop(e, "Value"), path: String(val(e, "path", "")), pads: [], gfx: [], descr: String(val(e, "descr", "")) };
      kids(e, "fp_text").forEach(x => { if (x[1] === "reference") f.ref = String(x[2]); else if (x[1] === "value") f.value = String(x[2]); });
      kids(e, "pad").forEach(p => {
        const q = kid(p, "at") || [0, 0, 0, 0], sz = kid(p, "size") || [0, 1, 1], dr = kid(p, "drill") || [];
        const oval = dr[1] === "oval", d1 = +(oval ? dr[2] : dr[1]) || 0, d2 = oval ? +dr[3] || d1 : d1;
        f.pads.push({ num: String(p[1]), type: String(p[2]), shape: String(p[3]), x: +q[1], y: +q[2], a: +q[3] || 0, w: +sz[1], h: +sz[2], drill: Math.min(d1, d2), layers: layersOf(p), net: netOf(p) });
      });
      shapes(e, "fp_", f.gfx);
      pcb.footprints.push(f);
    });
    kids(t, "segment").forEach(e => pcb.segments.push({ pts: [P(e, "start"), P(e, "end")], w: +val(e, "width", 0.25), layer: layersOf(e)[0], net: netOf(e) }));
    kids(t, "arc").forEach(e => pcb.segments.push({ pts: arcPoints(P(e, "start"), P(e, "mid"), P(e, "end")), w: +val(e, "width", 0.25), layer: layersOf(e)[0], net: netOf(e) }));
    kids(t, "via").forEach(e => { const p = P(e, "at"); pcb.vias.push({ x: p[0], y: p[1], pad: +val(e, "size", 0.8), drill: +val(e, "drill", 0.4), net: netOf(e) }); });
    kids(t, "zone").forEach(e => {
      const ko = kid(e, "keepout"), not = k => val(ko, k) === "not_allowed";
      kids(e, "polygon").forEach(pg => { const pts = xyList(pg); if (pts.length >= 3) pcb.zones.push({ net: String(val(e, "net_name", "")), layers: layersOf(e), pts, name: String(val(e, "name", "")), keepout: ko ? { tracks: not("tracks"), vias: not("vias"), pour: not("copperpour"), parts: not("footprints") } : null }); });
    });
    shapes(t, "gr_", pcb.edges);
    kids(t, "gr_text").forEach(e => { const a = kid(e, "at") || [0, 0, 0, 0], f = kid(kid(e, "effects"), "font"); pcb.texts.push({ text: String(e[1]), x: +a[1], y: +a[2], a: +a[3] || 0, layer: layersOf(e)[0], size: +val(f, "size", 1.5) }); });
    return pcb;
  }
  const r4 = v => Math.round(v * 10000) / 10000;
  // a footprint of the board file as BoardCore keeps footprints (the part's own coordinates, top side)
  function fpData(f, name) {
    const B = /^B\./.test(f.layer), k = Math.round(f.a / 90), res = (f.a - k * 90) * Math.PI / 180, cs = Math.cos(res), sn = Math.sin(res);
    // what the board's quarter turns leave of the angle is turned into the footprint itself
    const loc = (x, y) => { const X = x * cs + y * sn, Y = -x * sn + y * cs; return [r4(B ? -X : X), r4(Y)]; };
    const pads = [], holes = [], silk = [];
    let n = 0, smd = true, mech = 0;
    f.pads.forEach(p => {
      const [x, y] = loc(p.x, p.y), rel = (((p.a - f.a) % 180) + 180) % 180, turned = Math.abs(rel - 90) < 1, skew = !turned && rel > 1 && rel < 179;
      let w = turned ? p.h : p.w, h = turned ? p.w : p.h;
      if (skew || Math.abs(res) > 1e-6) w = h = Math.min(w, h);
      if (p.type === "np_thru_hole") { holes.push({ x, y, d: p.drill || Math.min(w, h) }); return; }
      const tht = p.type === "thru_hole";
      if (!tht && !p.layers.some(l => /\.Cu$/.test(l))) return;      // paste or mask only
      if (tht) smd = false;
      const num = p.num || `M${++mech}`;
      pads.push(Object.assign({ num, name: num, x, y, shape: /rect|trapez|custom/.test(p.shape) ? "rect" : "circle", w: r4(w), h: r4(h), drill: tht ? p.drill || 0.8 : 0 }, tht ? {} : { smd: true }, !tht && !p.layers.some(l => l === f.layer || l === "*.Cu" || l === "F&B.Cu") ? { back: true } : {}));
      n++;
    });
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, crt = false;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    f.gfx.forEach(g => {
      if (/CrtYd$/.test(g.layer || "")) { crt = true; g.pts.forEach(p => add(...loc(p[0], p[1]))); return; }
      if (!/SilkS$|Silkscreen$/.test(g.layer || "") || silk.length > 300) return;
      if (g.circle) { const [x, y] = loc(g.circle[0], g.circle[1]); silk.push({ t: "circle", x, y, r: r4(g.circle[2]) }); return; }
      for (let i = 0; i + 1 < g.pts.length; i++) { const a = loc(g.pts[i][0], g.pts[i][1]), b = loc(g.pts[i + 1][0], g.pts[i + 1][1]); silk.push({ t: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
    });
    if (!crt) {
      pads.forEach(p => { add(p.x - p.w / 2 - 0.25, p.y - p.h / 2 - 0.25); add(p.x + p.w / 2 + 0.25, p.y + p.h / 2 + 0.25); });
      silk.forEach(s => { if (s.t === "line") { add(s.x1, s.y1); add(s.x2, s.y2); } else { add(s.x - s.r, s.y - s.r); add(s.x + s.r, s.y + s.r); } });
      holes.forEach(h => { add(h.x - h.d / 2, h.y - h.d / 2); add(h.x + h.d / 2, h.y + h.d / 2); });
    }
    if (!isFinite(x1)) { x1 = y1 = -1; x2 = y2 = 1; }
    const d = { name, title: (f.descr || f.lib.split(":").pop()).slice(0, 120) + " (from KiCad)", pads, silk, holes, box: [r4(x1), r4(y1), r4(x2), r4(y2)], custom: true };
    if (smd && n) d.smd = true;
    return d;
  }
  // a board with no schematic: a box per footprint, each pad on a connector with its net's name
  function boardSchematic(pcb, ctx) {
    let x = 200, y = 160, colW = 0;
    ctx.addComp("frame", 0, 0, 0, { locked: "yes", size: "A0", orient: "landscape", title: "Imported board", status: "Imported from KiCad" });
    ctx.report.sheets = 1;
    const seen = new Set();
    pcb.footprints.forEach(f => {
      const nums = [...new Set(f.pads.filter(p => p.type !== "np_thru_hole" && p.num && p.layers.some(l => /\.Cu$/.test(l))).map(p => p.num))];
      if (!nums.length || !f.ref || /^(REF\*\*|H\d*|MH\d*|FID\d*|G\*+|LOGO\d*)$/i.test(f.ref) && nums.length <= 1 || seen.has(f.ref)) return;
      seen.add(f.ref);
      nums.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      const sym = boxSym(nums), h = sym.box[3] - sym.box[1], nets = {};
      f.pads.forEach(p => { if (p.net && !nets[p.num]) nets[p.num] = p.net; });
      const room = Math.max(60, ...Object.values(nets).map(n => 40 + 7 * n.length)), w = 120 + 2 * room;
      if (y + h > 3200) { y = 160; x += colW + 60; colW = 0; }
      colW = Math.max(colW, w);
      const cx = Math.round((x + room + 60) / 10) * 10, c = ctx.addComp("kicad", cx, y, 0, { value: f.value, footprint: f.lib, lib: "", desc: f.descr, sym }, f.ref);
      sym.pins.forEach(p => {
        const nm = nets[p.num]; if (!nm) return;
        const left = p.x < 0, px = cx + p.x, py = y + p.y, ex = px + (left ? -20 : 20);
        ctx.wires.push({ id: ctx.id("w"), x1: px, y1: py, x2: ex, y2: py });
        if (/^\/?(GND|GNDREF|0V)$/i.test(nm)) ctx.addComp("ground", ex, py, left ? 1 : 3); else ctx.addComp("offsheet", ex, py, left ? 2 : 0, { name: nm.replace(/^\//, "") });
        ctx.report.connectors++;
      });
      const pinOf = {}; sym.pins.forEach(p => { pinOf[p.num] = p.id; });
      ctx.refPart(f.ref, { comp: c, pinOf, kept: true }); ctx.report.parts++; ctx.report.kept++;
      y += Math.ceil((h + 60) / 10) * 10;
    });
    ctx.note("The board came without a schematic, so one was made for it: a box for each footprint, its pads on connectors named for their nets.");
  }
  function buildBoard(pcb, byRef, report, note, pro, boardOnly) {
    const BC = root.BoardCore, L = root.CadLib, board = BC.newBoard(), rb = { parts: 0, tracks: 0, vias: 0, zones: 0, holes: 0, missing: [] };
    report.board = rb;
    // the outline: the rectangle round the edge cuts (round the copper without them)
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    const edges = pcb.edges.filter(g => g.layer === "Edge.Cuts");
    let plainEdge = true;
    edges.forEach(g => g.pts.forEach(p => add(p[0], p[1])));
    pcb.footprints.forEach(f => f.gfx.filter(g => g.layer === "Edge.Cuts").forEach(g => g.pts.forEach(p => { const k = f.a * Math.PI / 180; add(f.x + p[0] * Math.cos(k) + p[1] * Math.sin(k), f.y - p[0] * Math.sin(k) + p[1] * Math.cos(k)); })));
    if (!isFinite(x1)) {
      pcb.footprints.forEach(f => add(f.x, f.y)); pcb.segments.forEach(s => s.pts.forEach(p => add(p[0], p[1])));
      if (!isFinite(x1)) { x1 = y1 = 0; x2 = 100; y2 = 80; }
      x1 -= 10; y1 -= 10; x2 += 10; y2 += 10;
      note("The board has no outline (Edge.Cuts): a rectangle round its parts was drawn.");
    } else {
      const plain = edges.every(g => g.rect || (g.pts.length === 2 && (Math.abs(g.pts[0][0] - g.pts[1][0]) < 1e-6 || Math.abs(g.pts[0][1] - g.pts[1][1]) < 1e-6)) || g.arc);
      plainEdge = !(!plain || ![0, 4].includes(edges.filter(g => g.arc).length) || edges.some(g => g.pts.some(p => p[0] > x1 + 1e-3 && p[0] < x2 - 1e-3 && p[1] > y1 + 1e-3 && p[1] < y2 - 1e-3 && !g.arc)));
    }
    const arcs = edges.filter(g => g.arc).map(g => Math.hypot(g.arc[0][0] - g.arc[1][0], g.arc[0][1] - g.arc[1][1]) / Math.SQRT2);
    board.outline = { w: r4(x2 - x1), h: r4(y2 - y1), r: arcs.length === 4 && Math.max(...arcs) - Math.min(...arcs) < 0.01 ? r4(arcs[0]) : 0 };
    // an edge that is no plain rectangle: its own lines, arcs and circles chained into the board's shape
    // (cut-outs inside it too), when they close; else the rectangle round it stays, with a note
    const OL = root.BoardOutline;
    let ownShape = false;
    if (OL && edges.length && !plainEdge) {
      const ents = [];
      edges.forEach(g => {
        if (g.circle) ents.push({ t: "C", cx: g.circle[0] - x1, cy: g.circle[1] - y1, r: g.circle[2] });
        else if (g.arc) { const b = OL.bulge3(g.arc[0], g.arc[1], g.mid); ents.push({ t: b ? "A" : "L", x1: g.arc[0][0] - x1, y1: g.arc[0][1] - y1, x2: g.arc[1][0] - x1, y2: g.arc[1][1] - y1, ...(b ? { b } : {}) }); }
        else for (let k = 0; k + 1 < g.pts.length; k++) ents.push({ t: "L", x1: g.pts[k][0] - x1, y1: g.pts[k][1] - y1, x2: g.pts[k + 1][0] - x1, y2: g.pts[k + 1][1] - y1 });
      });
      const res = OL.fromEntities(ents, 0.02);
      if (!res.error && Math.abs(res.dx) < 0.01 && Math.abs(res.dy) < 0.01 && Math.abs(res.w - (x2 - x1)) < 0.01 && Math.abs(res.h - (y2 - y1)) < 0.01) { board.outline = OL.outlineOf(res); ownShape = !!board.outline.shape; }
    }
    if (isFinite(x1) && edges.length && !plainEdge && !ownShape) note("The board's outline is not a plain rectangle: the rectangle round it was taken (cut-outs and slanted edges are not kept).");
    const X = x => r4(x - x1), Y = y => r4(y - y1);
    rb.origin = [r4(x1), r4(y1)];
    if (pcb.copperLayers > 2) note(`The board has ${pcb.copperLayers} copper layers: the app's boards have two, so only the top and bottom copper came over.`);
    // footprints
    board.footprints = {};
    const sameFp = (a, b) => JSON.stringify([a.pads, a.silk, a.holes, a.box]) === JSON.stringify([b.pads, b.silk, b.holes, b.box]);
    const done = new Set();
    let turned = 0;
    pcb.footprints.forEach(f => {
      const copper = f.pads.filter(p => p.type !== "np_thru_hole" && p.layers.some(l => /\.Cu$/.test(l)));
      const list = byRef.get(f.ref);
      if (!list || done.has(f.ref)) {
        // a part this app's board added itself (a heater supply's terminal): back under its own key
        const lib0 = f.lib.split(":").pop(), key0 = !list && boardOnly && boardOnly.get(f.ref);
        if (key0 && /^TubeAmpCAD:/.test(f.lib) && BC.footprint(lib0) && !board.parts[key0]) {
          const B = /^B\./.test(f.layer), k = Math.round(f.a / 90);
          board.parts[key0] = { ref: f.ref, fp: lib0, x: X(f.x), y: Y(f.y), rot: (((B ? -k : k) % 4) + 4) % 4, side: B ? "B" : "F" }; rb.parts++;
          return;
        }
        // no part on the sheet: its holes stay as mounting holes, anything else is left out
        const k = f.a * Math.PI / 180, at = p => [X(f.x + p.x * Math.cos(k) + p.y * Math.sin(k)), Y(f.y - p.x * Math.sin(k) + p.y * Math.cos(k))];
        f.pads.forEach(p => {
          if (p.type === "np_thru_hole" && p.drill > 0) { const [x, y] = at(p); board.holes.push({ x, y, d: p.drill }); rb.holes++; }
          else if (p.type === "thru_hole" && copper.length === 1 && p.drill >= 2) { const [x, y] = at(p); board.holes.push(Object.assign({ x, y, d: p.drill, plated: true, pad: Math.max(p.w, p.h) }, p.net ? { net: p.net.replace(/^\//, "") } : {})); rb.holes++; }
        });
        if (copper.length > 1 || (copper.length === 1 && !(copper[0].type === "thru_hole" && copper[0].drill >= 2))) rb.missing.push(f.ref || f.lib);
        return;
      }
      done.add(f.ref);
      const members = list.map(e => e.comp).sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
      const key = members.map(m => m.id).sort().join("+"), B = /^B\./.test(f.layer), k = Math.round(f.a / 90);
      if (Math.abs(f.a - k * 90) > 0.01) turned++;
      const bp = { ref: f.ref, x: X(f.x), y: Y(f.y), rot: (((B ? -k : k) % 4) + 4) % 4, side: B ? "B" : "F" };
      // this app's own footprint by its name, else the footprint as the board file has it
      const lib = f.lib.split(":").pop(), mine = /^TubeAmpCAD:/.test(f.lib) && [lib, lib.replace(/_[a-z]+[\d.]+(_[a-z]+[\d.]+)*$/, "")].find(nm => BC.footprint(nm));
      if (mine && list.every(e => e.own)) bp.fp = mine;
      else {
        let nm = "KICAD:" + lib; const d = fpData(f, nm);
        for (let i = 2; board.footprints[nm] && !sameFp(board.footprints[nm], d); i++) nm = `KICAD:${lib}#${i}`;
        d.name = nm; board.footprints[nm] = d; bp.fp = nm;
        // which of the part's pins each pad is (a part with pin numbers of its own, a valve, knows)
        if (!list.every(e => e.kept) && !(L.LIB[members[0].type] && L.LIB[members[0].type].pinNumbers)) {
          bp.pins = {};
          list.forEach(e => { const mi = members.indexOf(e.comp); Object.entries(e.pinOf || {}).forEach(([num, pid]) => { (bp.pins[num] = bp.pins[num] || []).push([mi, pid]); }); });
        }
      }
      board.parts[key] = bp; rb.parts++;
      f.pads.forEach(p => { if (p.net) report.padNets[f.ref + ":" + p.num] = p.net; });
    });
    if (!Object.keys(board.footprints).length) delete board.footprints;
    if (turned) note(`${turned} footprint${turned > 1 ? "s are" : " is"} turned by an angle that is not a quarter turn: the app turns parts by 90°, so ${turned > 1 ? "they keep" : "it keeps"} the angle inside the footprint (its pads are drawn round or square).`);
    if (rb.missing.length) note(`Footprints with no symbol in the schematic were left out: ${rb.missing.slice(0, 12).join(", ")}${rb.missing.length > 12 ? " …" : ""}.`);
    // tracks: runs of segments joined end to end become one track
    let inner = 0;
    const segs = pcb.segments.filter(s => { if (s.layer === "F.Cu" || s.layer === "B.Cu") return true; inner++; return false; }).map(s => ({ layer: s.layer, w: s.w, net: s.net, pts: s.pts.map(p => [X(p[0]), Y(p[1])]) }));
    const ends = new Map(), ek = (s, p) => s.layer + "|" + p[0] + "|" + p[1];
    segs.forEach(s => [s.pts[0], s.pts[s.pts.length - 1]].forEach(p => { const k = ek(s, p); ends.set(k, (ends.get(k) || 0) + 1); }));
    const open = new Map();
    segs.forEach(s => {
      const k0 = ek(s, s.pts[0]) + "|" + s.w + "|" + s.net, prev = ends.get(ek(s, s.pts[0])) === 2 ? open.get(k0) : null;
      let t = s;
      if (prev) { prev.pts.push(...s.pts.slice(1)); t = prev; open.delete(k0); } else board.tracks.push(s);
      open.set(ek(s, t.pts[t.pts.length - 1]) + "|" + s.w + "|" + s.net, t);
    });
    board.tracks.forEach(t => { delete t.net; });
    rb.tracks = board.tracks.length;
    if (inner) note(`${inner} track segment${inner > 1 ? "s" : ""} on inner layers did not come over.`);
    pcb.vias.forEach(v => board.vias.push({ x: X(v.x), y: Y(v.y), drill: v.drill, pad: v.pad }));
    rb.vias = board.vias.length;
    pcb.zones.forEach(z => {
      const pts = z.pts.map(p => [X(p[0]), Y(p[1])]), layers = z.layers.flatMap(l => (l === "F&B.Cu" || l === "*.Cu" ? ["F.Cu", "B.Cu"] : [l])).filter(l => l === "F.Cu" || l === "B.Cu");
      if (z.keepout) { if (layers.length) board.keepouts.push({ name: z.name || "Keep-out", pts, layers, tracks: z.keepout.tracks, vias: z.keepout.vias, pour: z.keepout.pour, parts: z.keepout.parts }); return; }
      layers.forEach(layer => { if (z.net) { board.zones.push({ net: z.net, layer, pts, thermal: true }); rb.zones++; } });
    });
    // the rules the layout was drawn to, so that it passes its own check: the project's default net
    // class where the project came too, else the narrowest of what is on the board
    const R = board.rules, cls = ((((pro || {}).net_settings || {}).classes) || [])[0] || {}, dr = ((((pro || {}).board || {}).design_settings) || {}).rules || {};
    const ws = board.tracks.map(t => t.w).filter(w => w > 0), minW = ws.length ? Math.min(...ws) : R.minTrack, count = new Map();
    ws.forEach(w => count.set(w, (count.get(w) || 0) + 1));
    const usual = ws.length ? [...count.entries()].sort((a, b) => b[1] - a[1])[0][0] : R.track;
    const padsAll = Object.values(board.footprints || {}).flatMap(f => f.pads), drills = padsAll.filter(p => p.drill > 0).map(p => p.drill).concat(board.vias.map(v => v.drill)).filter(d => d > 0);
    const rings = padsAll.filter(p => p.drill > 0).map(p => (Math.min(p.w, p.h) - p.drill) / 2).concat(board.vias.map(v => (v.pad - v.drill) / 2)).filter(a => a > 0);
    if (ws.length || padsAll.length) {
      R.minTrack = r4(Math.min(R.minTrack, minW, +dr.min_track_width > 0 ? +dr.min_track_width : Infinity));
      R.track = r4(Math.min(R.track, Math.max(R.minTrack, +cls.track_width > 0 ? +cls.track_width : usual)));
      R.power = r4(Math.min(R.power, R.track));
      R.clearance = r4(Math.min(R.clearance, +cls.clearance > 0 ? +cls.clearance : 0.2));
      R.hvClearance = Math.max(R.clearance, R.hvClearance);
      if (drills.length) R.minDrill = r4(Math.min(R.minDrill, ...drills));
      if (rings.length) R.minAnnular = r4(Math.max(0.05, Math.min(R.minAnnular, ...rings)));
      if (board.vias.length) { R.viaDrill = board.vias[0].drill; R.viaPad = board.vias[0].pad; }
      R.teardrops = false;
      note(`The board's rules were set from the KiCad layout so that it passes its own check: tracks from ${R.minTrack} mm, clearance ${R.clearance} mm. For valve voltages set your own in Board ▾ → Design rules….`);
    }
    pcb.texts.forEach(t => {
      const layer = { "F.SilkS": "F.SilkS", "B.SilkS": "B.SilkS", "F.Silkscreen": "F.SilkS", "B.Silkscreen": "B.SilkS", "F.Cu": "F.Cu", "B.Cu": "B.Cu" }[t.layer];
      if (layer && !/\$\{/.test(t.text)) board.texts.push({ x: X(t.x), y: Y(t.y), text: t.text.replace(/\n/g, " "), size: t.size, layer, rot: ((Math.round(t.a / 90) % 4) + 4) % 4 });
    });
    return board;
  }

  root.KicadImport = { parse, readSch, readPcb, importProject, mapPart, matrix, engValue, findTube, symData, fpData };
})(typeof window !== "undefined" ? window : globalThis);
