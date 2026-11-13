/* =============================================================================
   The user's parts library — its data (no DOM; pages, Node tests).
   A library part is data, not code: a drawing with pins (one per unit of the package), a
   footprint, a designator letter and, when it has one, a SPICE model. A part placed on the sheet
   (cad-components.js LIB.part) carries a copy of all of it, so a circuit file opens anywhere.

   A library: { parts: [part], footprints: { name: footprint } }
   A part: { id, name, prefix, desc, keywords, datasheet, units: [sym], fp (a name in footprints,
     or ""), fpHint (what KiCad's symbol asked for), filters (KiCad's footprint filters), src }
     sym: { g: drawing, pins: [{ id, num, name, x, y, a, l }], box, pn, pm } (kicad-import.js symData)
   A footprint: { name, title, pads, silk, holes, box, smd } (board-core.js keeps the same)

   Sources: KiCad symbol libraries (.kicad_sym) and footprints (.kicad_mod), read by
   kicad-import.js; a library file of this app (toFile / fromFile).
   Depends on: kicad-import.js (reading KiCad files only)
   ============================================================================= */
(function (root) {
  "use strict";
  const FORMAT = "tubecad-library", VERSION = 1;
  const clone = o => JSON.parse(JSON.stringify(o));
  const slug = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").replace(/^-|-$/g, "") || "part";
  const empty = () => ({ parts: [], footprints: {} });
  // KiCad's reference letters as the app's designators (GOST letters, as the rest of the library)
  const PREFIX = { U: "DA", IC: "DA", Q: "VT", D: "VD", R: "R", C: "C", L: "L", J: "X", P: "X", K: "K", SW: "SA", S: "SA", F: "FU", T: "T", TR: "T", V: "VL", Y: "ZQ", X: "ZQ", LS: "BA", BT: "GB", RV: "RP", TP: "XP", FB: "L", H: "H", M: "M", A: "A" };
  const prefixOf = ref => { const r = String(ref || "").replace(/[^A-Za-z]/g, "").toUpperCase(); return PREFIX[r] || r || "U"; };

  /** Every symbol of a KiCad symbol library as [{ name, desc, pins, units, footprint, read() }]: read()
      gives the library part (the drawing is made only for the ones taken) */
  function symbols(text, file) {
    const K = root.KicadImport, src = String(file || "").replace(/^.*[\\/]/, "").replace(/\.kicad_sym$/i, "");
    return K.readSymbols(text).filter(s => !s.power).map(s => ({
      name: s.name, desc: s.desc, units: s.units, footprint: s.footprint, keywords: s.keywords,
      read() {
        const units = []; for (let u = 1; u <= s.units; u++) units.push(s.sym(u));
        return { id: "", name: s.name, prefix: /^valve/i.test(src) && /^U$/i.test(s.ref) ? "VL" : prefixOf(s.ref), desc: s.desc || "", keywords: s.keywords || "", datasheet: /^https?:/.test(s.datasheet) ? s.datasheet : "", units,
          fp: "", fpHint: s.footprint || "", filters: s.filters || "", src: src ? `KiCad: ${src}` : "KiCad" };
      }
    }));
  }
  /** A KiCad footprint file as a library footprint */
  function footprint(text, file) {
    const K = root.KicadImport, d = K.readFootprint(text);
    d.name = String(d.name || String(file || "").replace(/^.*[\\/]/, "").replace(/\.kicad_mod$/i, "") || "footprint");
    delete d.custom;
    return d;
  }
  // KiCad's footprint filter ("DIP*W7.62mm*", "TO?220*") against a footprint's name
  function glob(pattern, name) {
    const re = new RegExp("^" + String(pattern).split("").map(ch => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("") + "$", "i");
    return re.test(name);
  }
  /** The footprints of a library that fit a part, best first: the one its symbol names, the ones its
      filters allow with as many pads as it has pins, then every other with that many pads */
  function ranker(part, footprints) {
    const want = String(part.fpHint || "").split(":").pop(), filters = String(part.filters || "").split(/\s+/).filter(Boolean);
    const nums = new Set(); (part.units || []).forEach(u => (u.pins || []).forEach(p => nums.add(String(p.num || p.id))));
    const covers = f => { const have = new Set(f.pads.map(p => String(p.num))); return [...nums].every(n => have.has(n)); };
    return n => (n === want ? 0 : !covers(footprints[n]) ? 9 : filters.some(f => glob(f, n)) ? 1 : 2);
  }
  function fits(part, footprints) {
    const rank = ranker(part, footprints || {});
    return Object.keys(footprints || {}).filter(n => rank(n) < 9).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
  }
  // the one a part takes by itself: the footprint its symbol names, or one its filters allow
  function best(part, footprints) { const f = fits(part, footprints)[0]; return f && ranker(part, footprints)(f) <= 1 ? f : ""; }
  /** Pins of a part that its footprint has no pad for (their numbers) */
  function unmatched(part, fp) {
    if (!fp) return [];
    const have = new Set(fp.pads.map(p => String(p.num))), out = [];
    (part.units || []).forEach(u => (u.pins || []).forEach(p => { const n = String(p.num || p.id); if (!have.has(n) && !out.includes(n)) out.push(n); }));
    return out;
  }

  /** Add parts and footprints to a library (in place): a part of the same name is replaced and keeps
      its id and, unless the new one brings its own, its footprint and model; a part with no footprint
      takes the best that fits. Returns { parts: added or replaced, footprints: added or replaced } */
  function add(lib, parts, footprints) {
    let np = 0, nf = 0;
    Object.entries(footprints || {}).forEach(([k, f]) => { lib.footprints[k] = f; nf++; });
    const ids = new Set(lib.parts.map(p => p.id));
    (parts || []).forEach(p => {
      const q = clone(p), at = lib.parts.findIndex(o => o.name.toLowerCase() === q.name.toLowerCase());
      if (at >= 0) { const old = lib.parts[at]; q.id = old.id; if (!q.fp) q.fp = old.fp; if (!q.spice && old.spice) q.spice = old.spice; lib.parts[at] = q; }
      else { let id = q.id || slug(q.name); for (let k = 2; ids.has(id); k++) id = `${slug(q.name)}-${k}`; q.id = id; ids.add(id); lib.parts.push(q); }
      np++;
    });
    lib.parts.forEach(p => { if (p.fp && !lib.footprints[p.fp]) p.fp = ""; if (!p.fp) p.fp = best(p, lib.footprints); });
    lib.parts.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { parts: np, footprints: nf };
  }
  function remove(lib, id) { const k = lib.parts.findIndex(p => p.id === id); if (k < 0) return false; lib.parts.splice(k, 1); return true; }
  /** Footprints no part uses any more */
  function unused(lib) { const used = new Set(lib.parts.map(p => p.fp).filter(Boolean)); return Object.keys(lib.footprints).filter(k => !used.has(k)); }

  /** What a part placed on the sheet carries (LIB.part's params): unit is 1-based */
  /** How a part's model goes on its units. One unit: one instance. A package of several units:
      the units that are drawn alike (the two amplifiers of a dual op-amp) each get an instance when the
      model's pins are mapped to one of them only, the pins on other units (the supply) shared; a model
      mapped across units that are alike, or to a package with no two units alike, is the whole package's.
      Returns { pack (one instance for the package), maps: { unit number: map } } or null without a model. */
  function unitMaps(part) {
    const sp = part.spice; if (!sp || !sp.text) return null;
    const map = sp.map || [], units = part.units || [], maps = {};
    if (units.length <= 1) return { pack: false, maps: { 1: map.slice() } };
    const sig = u => (u.pins || []).map(p => `${p.x},${p.y},${p.a}`).sort().join(";"), sigs = units.map(sig);
    const home = id => units.findIndex(u => (u.pins || []).some(p => p.id === id));
    // the units the model's pins sit on that have a twin
    const twins = new Set(map.filter(m => m && m !== "0").map(home).filter(k => k >= 0 && sigs.filter(x => x === sigs[k]).length > 1));
    if (twins.size !== 1) { units.forEach((u, k) => { maps[k + 1] = map.slice(); }); return { pack: true, maps }; }
    const r = [...twins][0], ref = units[r];
    units.forEach((u, k) => {
      if (sigs[k] !== sigs[r]) return;
      const twin = id => { const p = ref.pins.find(q => q.id === id); if (!p) return id; const q = u.pins.find(t => t.x === p.x && t.y === p.y && t.a === p.a); return q ? q.id : ""; };
      maps[k + 1] = map.map(m => (m && m !== "0" ? twin(m) : m));
    });
    return { pack: false, maps };
  }
  function params(lib, part, unit) {
    const u = Math.min(Math.max(1, unit || 1), part.units.length), fp = part.fp && lib.footprints[part.fp];
    const p = { name: part.name, value: part.name, prefix: part.prefix || "U", desc: part.desc || "", lib: part.id, unit: u, units: part.units.length, syms: clone(part.units), fp: fp ? Object.assign(clone(fp), { name: part.fp }) : null, text: "", sub: "", map: [] };
    if (part.datasheet) p.datasheet = part.datasheet;
    // the model and its pins as the library has them, whatever the unit: LIB.part works out the unit's share (unitMaps)
    if (part.spice && part.spice.text) { p.text = part.spice.text; p.sub = part.spice.sub; p.map = clone(part.spice.map || []); }
    return p;
  }

  // the same data whatever the order of its keys
  const canon = o => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(q => [q, v[q]])) : v));
  /** What a part placed on a sheet (its params) no longer has as its library part has it:
      a list of "drawing", "footprint", "model", "name" (empty: up to date; null: the library has no such part).
      A model set on the sheet for a part whose library part has none is the sheet's own, not a difference. */
  function differs(lib, placed) {
    const part = placed && placed.lib ? lib.parts.find(p => p.id === placed.lib) : null;
    if (!part) return null;
    const now = params(lib, part, placed.unit), out = [];
    if (canon(now.syms) !== canon(placed.syms || [])) out.push("drawing");
    if (canon(now.fp) !== canon(placed.fp || null)) out.push("footprint");
    if (((part.spice && part.spice.text) || part.units.length > 1) && (now.text !== (placed.text || "") || now.sub !== (placed.sub || "") || canon(now.map) !== canon(placed.map || []))) out.push("model");
    if (now.name !== placed.name || now.prefix !== placed.prefix || now.desc !== (placed.desc || "")) out.push("name");
    return out;
  }
  /** The params of a placed part brought up to its library part: the drawing, footprint, name and (where the
      library has one) the model are the library's; the value typed on the sheet, the unit and every other
      field of the sheet's stay. Null when the library has no such part. */
  function refreshed(lib, placed) {
    const part = placed && placed.lib ? lib.parts.find(p => p.id === placed.lib) : null;
    if (!part) return null;
    const now = params(lib, part, placed.unit), out = Object.assign({}, placed, { name: now.name, prefix: now.prefix, desc: now.desc, unit: now.unit, units: now.units, syms: now.syms, fp: now.fp });
    if (!placed.value || placed.value === placed.name) out.value = now.name;
    if (now.datasheet) out.datasheet = now.datasheet;
    if ((part.spice && part.spice.text) || part.units.length > 1) { out.text = now.text; out.sub = now.sub; out.map = now.map; }
    return out;
  }

  // ---- drawings made here (the symbol editor, cad-symedit.js) ----
  const SIDE_ANGLE = { left: 0, right: 180, top: 270, bottom: 90 }, ANGLE_SIDE = { 0: "left", 180: "right", 270: "top", 90: "bottom" };
  /** The inner end of a pin (where it meets the body) */
  function pinEnd(p) { const a = (p.a || 0) * Math.PI / 180; return [p.x + Math.round(Math.cos(a)) * (p.l || 0), p.y - Math.round(Math.sin(a)) * (p.l || 0)]; }
  /** A drawing's box from what is in it (2 of margin, as KiCad's symbols get) */
  function bounds(sym) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    (sym.g || []).forEach(s => {
      if (s[0] === "p") for (let i = 2; i + 1 < s.length; i += 2) add(s[i], s[i + 1]);
      else if (s[0] === "c") { add(s[2] - s[4], s[3] - s[4]); add(s[2] + s[4], s[3] + s[4]); }
      else if (s[0] === "t") add(s[1], s[2]);
    });
    (sym.pins || []).forEach(p => { add(p.x, p.y); add(...pinEnd(p)); });
    if (!isFinite(x1)) return [-20, -20, 20, 20];
    return [Math.floor(x1) - 2, Math.floor(y1) - 2, Math.ceil(x2) + 2, Math.ceil(y2) + 2];
  }
  /** A drawing put in order after editing: every pin's id is its number (the name, or a count, where
      it has none; "#2" after a repeat), the box is measured again. Returns what is wrong with it. */
  function tidy(sym) {
    const used = new Set(), twice = [];
    (sym.pins || []).forEach((p, i) => {
      p.num = String(p.num === undefined || p.num === null ? "" : p.num).trim(); p.name = String(p.name || "").trim();
      const base = p.num || p.name || String(i + 1); let id = base;
      if (used.has(id)) { if (p.num && !twice.includes(p.num)) twice.push(p.num); for (let k = 2; used.has(id); k++) id = `${base}#${k}`; }
      used.add(id); p.id = id;
      p.x = Math.round(p.x / 10) * 10; p.y = Math.round(p.y / 10) * 10; p.l = Math.max(0, +p.l || 0); p.a = ANGLE_SIDE[p.a] ? p.a : 0;
    });
    sym.box = bounds(sym);
    const out = [];
    if (!(sym.pins || []).length) out.push("The drawing has no pins");
    if (twice.length) out.push(`Pin number ${twice.join(", ")} is used twice`);
    return out;
  }
  /** A box with pins on its sides: list [{ num, name, side }] (side left | right | top | bottom; without
      sides the first half goes down the left, the rest up the right, as on a DIP) */
  function boxSymbol(list) {
    const n = list.length, half = Math.ceil(n / 2), by = { left: [], right: [], top: [], bottom: [] };
    list.forEach((p, i) => { const side = SIDE_ANGLE[p.side] !== undefined ? p.side : i < half ? "left" : "right"; by[side].push(p); });
    if (!list.some(p => SIDE_ANGLE[p.side] !== undefined)) by.right.reverse();
    const chars = k => by[k].reduce((m, p) => Math.max(m, String(p.name || "").length), 0);
    const rows = Math.max(by.left.length, by.right.length, 1), cols = Math.max(by.top.length, by.bottom.length, 0);
    const hw = Math.max(30, Math.ceil(((chars("left") + chars("right")) * 5 + 16) / 20) * 10, cols * 10 + 10), hh = Math.max(20, rows * 10 + 10, by.top.length || by.bottom.length ? Math.ceil((Math.max(chars("top"), chars("bottom")) * 5 + rows * 20 + 20) / 20) * 10 : 0);
    const L = 20, pins = [], put = (k, p, x, y) => pins.push({ id: "", num: String(p.num || ""), name: String(p.name || ""), x, y, a: SIDE_ANGLE[k], l: L });
    const spread = (m, i) => (i - (m - 1) / 2) * 20, even = v => Math.round(v / 10) * 10;
    by.left.forEach((p, i) => put("left", p, -hw - L, even(spread(by.left.length, i))));
    by.right.forEach((p, i) => put("right", p, hw + L, even(spread(by.right.length, i))));
    by.top.forEach((p, i) => put("top", p, even(spread(by.top.length, i)), -hh - L));
    by.bottom.forEach((p, i) => put("bottom", p, even(spread(by.bottom.length, i)), hh + L));
    const sym = { g: [["p", 2, -hw, -hh, hw, -hh, hw, hh, -hw, hh, -hw, -hh]], pins, box: [0, 0, 0, 0], pn: 3, pm: 1 };
    tidy(sym);
    return sym;
  }
  /** Lines of text as pins: "1 IN+", "2 IN- left", "8 VCC top" (number, name, side) */
  function pinList(text) {
    return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const t = l.split(/[\s,;]+/), side = SIDE_ANGLE[String(t[t.length - 1]).toLowerCase()] !== undefined && t.length > 1 ? t.pop().toLowerCase() : undefined;
      return { num: t[0], name: t.slice(1).join(" "), side };
    });
  }
  /** A new part with a drawing made here */
  function blank(name, prefix, sym) { return { id: "", name: String(name || "New part"), prefix: prefix || "DA", desc: "", keywords: "", datasheet: "", units: [sym || boxSymbol([{ num: "1", name: "" }, { num: "2", name: "" }])], fp: "", fpHint: "", filters: "", src: "drawn here" }; }

  // ---- footprints drawn here (millimetres, the part's own coordinates, seen from the top) ----
  const r3 = v => Math.round((+v || 0) * 1000) / 1000;
  /** A footprint put in order after editing: numbers rounded, the outline box measured again
      (0.25 mm round the pads, silkscreen and holes), smd set when no pad is drilled. Returns what is wrong. */
  function fpTidy(f) {
    f.name = String(f.name || "").trim(); f.title = String(f.title || "").trim() || f.name;
    f.pads = (f.pads || []).map(p => {
      const smd = !(+p.drill > 0), q = { num: String(p.num === undefined || p.num === null ? "" : p.num).trim(), name: "", x: r3(p.x), y: r3(p.y), shape: p.shape === "rect" ? "rect" : "circle", w: Math.max(0.1, r3(p.w)), h: Math.max(0.1, r3(p.h)), drill: smd ? 0 : r3(p.drill) };
      q.name = q.num; if (smd) { q.smd = true; if (p.back) q.back = true; }
      return q;
    });
    f.silk = (f.silk || []).map(g => (g.t === "circle" ? { t: "circle", x: r3(g.x), y: r3(g.y), r: Math.max(0.05, r3(g.r)) } : { t: "line", x1: r3(g.x1), y1: r3(g.y1), x2: r3(g.x2), y2: r3(g.y2) })).filter(g => g.t === "circle" || g.x1 !== g.x2 || g.y1 !== g.y2);
    f.holes = (f.holes || []).map(h => ({ x: r3(h.x), y: r3(h.y), d: Math.max(0.2, r3(h.d)) }));
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    f.pads.forEach(p => { add(p.x - p.w / 2 - 0.25, p.y - p.h / 2 - 0.25); add(p.x + p.w / 2 + 0.25, p.y + p.h / 2 + 0.25); });
    f.silk.forEach(g => { if (g.t === "line") { add(g.x1, g.y1); add(g.x2, g.y2); } else { add(g.x - g.r, g.y - g.r); add(g.x + g.r, g.y + g.r); } });
    f.holes.forEach(h => { add(h.x - h.d / 2 - 0.25, h.y - h.d / 2 - 0.25); add(h.x + h.d / 2 + 0.25, h.y + h.d / 2 + 0.25); });
    if (!isFinite(x1)) { x1 = y1 = -1; x2 = y2 = 1; }
    f.box = [r3(x1), r3(y1), r3(x2), r3(y2)];
    if (f.pads.length && f.pads.every(p => p.smd)) f.smd = true; else delete f.smd;
    delete f.custom;
    const out = [], tight = f.pads.filter(p => p.drill && p.drill >= Math.min(p.w, p.h) - 0.19).map(p => p.num || "?");
    if (!f.name) out.push("The footprint has no name");
    if (!f.pads.length) out.push("The footprint has no pads");
    if (tight.length) out.push(`The hole of pad ${[...new Set(tight)].slice(0, 6).join(", ")} leaves no copper round it`);
    return out;
  }
  const rectSilk = (x1, y1, x2, y2) => [{ t: "line", x1, y1, x2, y2: y1 }, { t: "line", x1: x2, y1, x2, y2 }, { t: "line", x1: x2, y1: y2, x2: x1, y2 }, { t: "line", x1, y1: y2, x2: x1, y2: y1 }];
  /** The usual packages as footprints, centred on the origin, pad 1 top left, numbered anticlockwise.
      kind: dip (two drilled rows) | sip (one drilled row) | soic (two rows of surface pads) |
      quad (surface pads on four sides) | two (two pads, drilled or not).
      o: { n, pitch, row (between the rows' centres), w, h (the pad, along the row and across), drill } */
  const PATTERNS = {
    dip: { name: "Two rows, through-hole (DIP)", n: 8, pitch: 2.54, row: 7.62, w: 1.6, h: 1.6, drill: 0.8 },
    sip: { name: "One row, through-hole (header, SIP)", n: 3, pitch: 2.54, row: 0, w: 1.7, h: 1.7, drill: 1.0 },
    soic: { name: "Two rows, surface-mount (SOIC, SOT)", n: 8, pitch: 1.27, row: 5.4, w: 0.6, h: 1.55, drill: 0 },
    quad: { name: "Four sides, surface-mount (QFP)", n: 32, pitch: 0.8, row: 8.4, w: 0.5, h: 1.5, drill: 0 },
    two: { name: "Two pads (resistor, capacitor, diode)", n: 2, pitch: 10.16, row: 0, w: 1.8, h: 1.8, drill: 0.9 }
  };
  function fpPattern(kind, o, name) {
    const d = Object.assign({}, PATTERNS[kind] || PATTERNS.dip), num = (k, lo, hi) => { const v = parseFloat(String(o && o[k] !== undefined ? o[k] : d[k]).replace(",", ".")); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d[k]; };
    const pitch = num("pitch", 0.2, 100), row = num("row", 0, 200), w = num("w", 0.1, 30), h = num("h", 0.1, 30), drill = kind === "soic" || kind === "quad" ? 0 : num("drill", 0, 20);
    let n = Math.round(num("n", 1, 400));
    const pads = [], silk = [], pad = (i, x, y, pw, ph) => pads.push({ num: String(i), x, y, shape: drill ? (i === 1 ? "rect" : "circle") : "rect", w: pw, h: ph, drill });
    if (kind === "two") { pad(1, -pitch / 2, 0, w, h); pad(2, pitch / 2, 0, w, h); if (pitch - w > 1.2) silk.push({ t: "line", x1: -pitch / 2 + w / 2 + 0.3, y1: 0, x2: pitch / 2 - w / 2 - 0.3, y2: 0 }); }
    else if (kind === "sip") { for (let i = 0; i < n; i++) pad(i + 1, (i - (n - 1) / 2) * pitch, 0, w, h); const a = (n - 1) / 2 * pitch + w / 2 + 0.4, b = h / 2 + 0.4; silk.push(...rectSilk(-a, -b, a, b)); }
    else if (kind === "quad") {
      n = Math.max(4, Math.round(n / 4) * 4); const m = n / 4, at = i => (i - (m - 1) / 2) * pitch, e = row / 2;
      for (let i = 0; i < m; i++) pad(i + 1, -e, at(i), h, w);
      for (let i = 0; i < m; i++) pad(m + i + 1, at(i), e, w, h);
      for (let i = 0; i < m; i++) pad(2 * m + i + 1, e, -at(i), h, w);
      for (let i = 0; i < m; i++) pad(3 * m + i + 1, -at(i), -e, w, h);
      const b = Math.max(0.5, e - h / 2 - 0.3); silk.push(...rectSilk(-b, -b, b, b)); silk.push({ t: "circle", x: -b + 0.8, y: -b + 0.8, r: 0.3 });
    } else {
      n = Math.max(2, Math.round(n / 2) * 2); const m = n / 2, at = i => (i - (m - 1) / 2) * pitch, e = row / 2, across = kind === "soic";
      for (let i = 0; i < m; i++) pad(i + 1, -e, at(i), across ? h : w, across ? w : h);
      for (let i = 0; i < m; i++) pad(m + i + 1, e, -at(i), across ? h : w, across ? w : h);
      const bx = Math.max(0.4, e - (across ? h : w) / 2 - 0.3), by = (m - 1) / 2 * pitch + Math.max(w, 1) / 2 + 0.4;
      silk.push(...rectSilk(-bx, -by, bx, by));
      if (across) silk.push({ t: "circle", x: -bx + 0.6, y: -by + 0.6, r: 0.25 }); else silk.push({ t: "line", x1: -0.8, y1: -by, x2: -0.8, y2: -by + 0.8 }, { t: "line", x1: -0.8, y1: -by + 0.8, x2: 0.8, y2: -by + 0.8 }, { t: "line", x1: 0.8, y1: -by + 0.8, x2: 0.8, y2: -by });
    }
    const f = { name: String(name || ""), title: "", pads, silk, holes: [], box: [0, 0, 0, 0] };
    fpTidy(f);
    return f;
  }
  /** The pattern a part's pins suggest: a DIP for an even count from 4, a row otherwise */
  function fpFor(part, name) {
    const nums = new Set(); (part.units || []).forEach(u => (u.pins || []).forEach(p => nums.add(String(p.num || p.id))));
    const n = Math.max(1, nums.size), f = n === 2 ? fpPattern("two", {}, name) : n >= 4 && n % 2 === 0 ? fpPattern("dip", { n }, name) : fpPattern("sip", { n }, name);
    // pads take the part's own pin numbers where those are not 1…n
    const list = [...nums].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (list.some((v, i) => v !== String(i + 1))) f.pads.forEach((p, i) => { p.num = p.name = list[i] || p.num; });
    return f;
  }
  /** A footprint under a new name: the parts that used the old name follow */
  function fpStore(lib, f, was) {
    if (was && was !== f.name) { delete lib.footprints[was]; lib.parts.forEach(p => { if (p.fp === was) p.fp = f.name; }); }
    lib.footprints[f.name] = f;
  }

  // ---- parts made from a part number (cad-addpart.js) ----
  /** A dual or quad op-amp as a library part: an amplifier per unit and a unit for the supply, on the
      package's standard pins (dual: 1 out, 2 −, 3 +, 4 V−, 5 +, 6 −, 7 out, 8 V+; quad: V+ on 4, V− on 11),
      with a footprint of that many pads. spice: { text, sub } of ONE amplifier, its pins in the
      usual order (+, −, V+, V−, out). pkg: dip | soic. Returns { part, fp }. */
  function opampPackage(name, amps, pkg, spice) {
    const quad = amps >= 4, n = quad ? 14 : 8, vp = quad ? "4" : "8", vn = quad ? "11" : "4";
    const PINS = quad ? [["3", "2", "1"], ["5", "6", "7"], ["10", "9", "8"], ["12", "13", "14"]] : [["3", "2", "1"], ["5", "6", "7"]];
    const pin = (num, nm, x, y, a) => ({ id: num, num, name: nm, x, y, a, l: 20 });
    const units = PINS.map(([p, m, o]) => ({ g: [["p", 2, -40, -40, 40, 0, -40, 40, -40, -40], ["t", -30, -20, 10, "+"], ["t", -30, 20, 10, "−"]], pins: [pin(p, "+", -60, -20, 0), pin(m, "-", -60, 20, 0), pin(o, "", 60, 0, 180)], box: [0, 0, 0, 0], pm: 1 }));
    units.push({ g: [["p", 2, -20, -20, 20, -20, 20, 20, -20, 20, -20, -20]], pins: [pin(vp, "V+", 0, -40, 270), pin(vn, "V-", 0, 40, 90)], box: [0, 0, 0, 0], pn: 3, pm: 1 });
    units.forEach(u => tidy(u));
    const fpName = `${pkg === "soic" ? "SOIC" : "DIP"}-${n}`, fp = fpPattern(pkg === "soic" ? "soic" : "dip", { n }, fpName);
    fp.title = `${fpName}, ${quad ? "quad" : "dual"} op-amp`;
    const part = { id: "", name: String(name), prefix: "DA", desc: `${quad ? "Quad" : "Dual"} op-amp`, keywords: "op-amp", datasheet: "", units, fp: fpName, fpHint: "", filters: "", src: "its part number" };
    if (spice && spice.text) part.spice = { text: spice.text, sub: spice.sub, map: ["3", "2", vp, vn, "1"] };
    return { part, fp };
  }

  /** The library as a file's text, and back (an error names what is wrong) */
  function toFile(lib, name) { return JSON.stringify({ format: FORMAT, version: VERSION, name: name || "", parts: lib.parts, footprints: lib.footprints }); }
  function check(d) {
    if (!d || d.format !== FORMAT) throw new Error("not a parts library of this app");
    if (d.version > VERSION) throw new Error("the library was written by a newer version of the app");
    const lib = empty();
    Object.entries(d.footprints || {}).forEach(([k, f]) => { if (f && Array.isArray(f.pads) && Array.isArray(f.box)) lib.footprints[k] = f; });
    (Array.isArray(d.parts) ? d.parts : []).forEach(p => {
      if (!p || typeof p.name !== "string" || !Array.isArray(p.units) || !p.units.length || !p.units.every(u => u && Array.isArray(u.pins) && Array.isArray(u.box))) return;
      lib.parts.push(p);
    });
    return lib;
  }
  function fromFile(text) { let d; try { d = JSON.parse(text); } catch (e) { throw new Error("not a parts library of this app"); } return check(d); }

  root.PartLib = { FORMAT, VERSION, empty, symbols, footprint, fits, best, unmatched, add, remove, unused, params, unitMaps, differs, refreshed, toFile, fromFile, check, prefixOf, glob, bounds, tidy, boxSymbol, pinList, pinEnd, blank, SIDE_ANGLE, ANGLE_SIDE, fpTidy, fpPattern, fpFor, fpStore, PATTERNS, opampPackage };
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis);
