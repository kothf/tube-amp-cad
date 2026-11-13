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
  function params(lib, part, unit) {
    const u = Math.min(Math.max(1, unit || 1), part.units.length), fp = part.fp && lib.footprints[part.fp];
    const p = { name: part.name, value: part.name, prefix: part.prefix || "U", desc: part.desc || "", lib: part.id, unit: u, units: part.units.length, syms: clone(part.units), fp: fp ? Object.assign(clone(fp), { name: part.fp }) : null, text: "", sub: "", map: [] };
    if (part.datasheet) p.datasheet = part.datasheet;
    if (part.spice && part.spice.text && part.units.length === 1) { p.text = part.spice.text; p.sub = part.spice.sub; p.map = clone(part.spice.map || []); }
    return p;
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

  root.PartLib = { FORMAT, VERSION, empty, symbols, footprint, fits, best, unmatched, add, remove, unused, params, toFile, fromFile, check, prefixOf, glob };
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis);
