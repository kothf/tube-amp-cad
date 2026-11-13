/* =============================================================================
   A part's SPICE model by its part number (no DOM; pages and Node tests).
   The index (spice-index.json, made by scripts/spice-index.mjs) says which file of the public
   KiCad-Spice-Library holds the model of a name; it is read when first asked for. The model's
   file is downloaded from that project (raw.githubusercontent.com, at the index's commit) only
   when a part is added, and only the part's own text is kept (SpiceNet.extract).
   Depends on: spice-net.js (extract, list)
   ============================================================================= */
(function (root) {
  "use strict";
  const KINDS = { X: "subcircuit", D: "diode", N: "NPN transistor", P: "PNP transistor", M: "N-channel MOSFET", m: "P-channel MOSFET", V: "power MOSFET", J: "N-channel JFET", j: "P-channel JFET" };
  const norm = s => String(s || "").toUpperCase().replace(/[\s]+/g, "");
  let index = null, loading = null;

  /** The index as { commit, files, names: Map(name → { file, kind, pins }) } from its JSON */
  function read(d) {
    const names = new Map();
    String(d.names || "").split("\n").forEach(l => { const t = l.split("\t"); if (t.length === 3) names.set(t[0], { name: t[0], file: d.files[+t[1]], kind: t[2][0], pins: +t[2].slice(1) || 0 }); });
    return { source: d.source, commit: d.commit, names };
  }
  function load(url) {
    if (index) return Promise.resolve(index);
    if (!loading) loading = fetch(url || "spice-index.json").then(r => { if (!r.ok) throw new Error("the list of models could not be read"); return r.json(); }).then(d => (index = read(d))).catch(e => { loading = null; throw e; });
    return loading;
  }
  /** The models a part number may mean, best first: the name itself; the names it begins with
      (TL072CP is a TL072: the ordering letters come last), longest first; then the names that
      begin with it (TL07 → TL071, TL072 …). Each { name, file, kind, pins, why: exact | base | starts }. */
  function candidates(ix, pn, limit) {
    const q = norm(pn), out = [], seen = new Set(), add = (v, why) => { if (v && !seen.has(v.name)) { seen.add(v.name); out.push(Object.assign({ why }, v)); } };
    if (q.length < 3) return out;
    add(ix.names.get(q), "exact");
    // a maker's file names its op-amp with a dash or a slash too: LM358/NS
    for (let n = q.length - 1; n >= Math.max(4, Math.ceil(q.length * 0.55)); n--) if (!/\d/.test(q[n])) add(ix.names.get(q.slice(0, n)), "base");   // what is left out is ordering letters: an LM358N is no LM35
    if (out.length < (limit || 12)) { const more = []; for (const [k, v] of ix.names) if (k.length > q.length && k.startsWith(q)) more.push(v); more.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name)); more.slice(0, (limit || 12) - out.length).forEach(v => add(v, "starts")); }
    return out.slice(0, limit || 12);
  }
  const urlOf = (ix, c) => `https://raw.githubusercontent.com/kicad-spice-library/KiCad-Spice-Library/${ix.commit}/${c.file.split("/").map(encodeURIComponent).join("/")}`;
  /** The model's own text out of its file: { text, sub, kind, pins } (throws when the file has no such part) */
  function cut(fileText, name) {
    const SN = root.SpiceNet, items = SN.list(fileText), it = items.find(x => x.name.toUpperCase() === name.toUpperCase());
    if (!it) throw new Error(`the file has no model called ${name}`);
    const text = SN.extract(fileText, it.name);
    if (!text) throw new Error(`the model ${name} could not be taken out of its file`);
    return { text, sub: it.name, kind: it.kind, pins: it.pins.slice(), hint: it.hint || "" };
  }
  /** Download a candidate's model: { text, sub, kind, pins, url } */
  async function get(ix, c) {
    const url = urlOf(ix, c), r = await fetch(url);
    if (!r.ok) throw new Error(`the model's file could not be downloaded (${r.status})`);
    const buf = await r.arrayBuffer(), text = new TextDecoder("latin1").decode(buf);
    return Object.assign(cut(text, c.name), { url, file: c.file });
  }
  /** What a model is drawn as: a lone device its own symbol; a subcircuit of five pins an op-amp;
      one of two or three pins whose only semiconductor is a diode or one transistor, that device; else a box */
  function symFor(m) {
    const K = root.CadLib.SPICE_KIND_SYM;
    if (K[m.kind]) return K[m.kind];
    if (m.pins.length === 5) return "opamp";
    return "box";
  }
  root.SpiceFind = { KINDS, norm, read, load, candidates, urlOf, cut, get, symFor, reset() { index = null; loading = null; } };
})(typeof window !== "undefined" ? window : globalThis);
