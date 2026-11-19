/* =============================================================================
   A part's SPICE model by its part number (no DOM; pages and Node tests).
   The index (spice-index.json, made by scripts/spice-index.mjs) says which file of the public
   KiCad-Spice-Library holds the model of a name; it is read when first asked for. The model's
   file is downloaded from that project (raw.githubusercontent.com, at the index's commit) only
   when a part is added, and only the part's own text is kept (SpiceNet.extract).
   What a model that is no lone device is (recognise): its number's family and its maker's note say
   what to look for, its pin names or a test circuit (probe: the model is tried every way round in
   the simulator and the way that behaves as the part should is taken) say which pin is which.
   Depends on: spice-net.js (extract, list); for probe: sim-engine.js, cad-components.js
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
    if (m.kind === "vdmos") return /\bpchan\b/i.test(m.text || "") ? "pmos" : "nmos";
    if (K[m.kind]) return (K[m.kind] === "nmos" || K[m.kind] === "pmos") && m.pins.length === 4 ? K[m.kind] + "4" : K[m.kind];
    if (m.pins.length === 5) return "opamp";
    return lone(m) || "box";
  }
  // a subcircuit of two or three pins around one kind of device: a maker's power MOSFET or Darlington
  // (the element lines' first letters and the types of its .MODELs say which)
  function lone(m) {
    const lines = String(m.text || "").split(/\r?\n/).map(l => l.trim()), has = ch => lines.some(l => l[0] && l[0].toUpperCase() === ch);
    const types = lines.map(l => /^\.model\s+\S+\s+\(?\s*([a-z]+)/i.exec(l)).filter(Boolean).map(x => x[1].toLowerCase()), pch = lines.some(l => /^\.model\b.*\bpchan\b/i.test(l));
    if (has("X") || lines.filter(l => /^q/i.test(l)).length > 2) return null;   // a Darlington has two transistors; more is a circuit
    if (m.pins.length === 3) {
      if (has("M") && !has("Q") && !has("J")) return types.includes("pmos") || pch ? "pmos" : types.includes("nmos") || types.includes("vdmos") ? "nmos" : null;
      if (has("Q") && !has("M") && !has("J")) return types.includes("npn") && !types.includes("pnp") && !types.includes("lpnp") ? "npn" : types.includes("pnp") && !types.includes("npn") ? "pnp" : null;
      if (has("J") && !has("M") && !has("Q")) return types.includes("pjf") ? "pjf" : types.includes("njf") ? "njf" : null;
    }
    if (m.pins.length === 2 && has("D") && !has("M") && !has("Q") && !has("J")) return "diode";
    return null;
  }
  /** Which pin of the symbol each pin of the model takes: by name where the model names them
      (c b e, d g s, a k, in any order), else in the usual order of makers' files */
  function mapFor(m, symPins) {
    const short = { collector: "c", base: "b", emitter: "e", drain: "d", gate: "g", source: "s", anode: "a", cathode: "k" };
    const names = m.pins.map(p => { const t = String(p).toLowerCase(); return short[t] || t; }), want = symPins.map(p => p.toLowerCase());
    if (names.length === want.length && want.every(w => names.includes(w)) && new Set(names).size === names.length) return names.map(n => symPins[want.indexOf(n)]);
    return m.pins.map((_, i) => (i < symPins.length ? symPins[i] : ""));
  }
  // ---- regulators, references, comparators, optocouplers ----
  // the families of numbers (the maker's letters before them do not count), and the words of a maker's note
  const MAKERS = "(?:LM|LMV|LMC|LP|LF|LT|LTC|TL|TLC|TLV|UA|MC|KA|KIA|NJM|TS|AN|LD|L|AMS|AZ|AP|NCP|NCV|SPX|UC|BA|CA|AD|MAX|MCP|ZR|TST)?";
  const FAMILIES = [
    ["reg", new RegExp("^" + MAKERS + "(7[89][LMST]?\\d\\d|317|337|338|350|340|1117|108[3-6]|29[34][017]|295[01]|1763|1764|3080)(?!\\d)"), /regulator|\bldo\b/i],
    ["shunt", new RegExp("^" + MAKERS + "(431|432|1431|336|4040|4041|385|285)(?!\\d)"), /shunt|reference/i],
    ["comp", new RegExp("^" + MAKERS + "(311|211|111|339|239|139|393|293|193|290[13]|319|3302|331|397|37[24]|370[24]|101[1678]|656[1-4]|72[12]1)(?!\\d)|^MAX9\\d\\d"), /comparator/i],
    ["opto", /^(PC[1-9]\d\d|4N[23]\d|CNY\d|TLP\d|H11[A-Z]|MOC\d|6N13\d|EL[38]\d\d|LTV|SFH6|IL[DQ]?\d|TCET|K[E]?817|PS2[5-8]\d\d|HCPL|ACPL|FOD|VO[6M])/, /opto|photocoupler|phototransistor/i],
    ["zener", /^(BZ[XVTYDG]|1N47[2-6]\d|1N52[2-8]\d|1N53[3-8]\d|1N59[1-5]\d|1N7[0-5]\d|MM[SB]Z|MMSZ|1SMB59|ZP[DY]|TZM|ZMM|DZ\d|PZU|NZX|ZY\d)/, /zener/i]
  ];
  /** What a part number and a model's note say the part is: reg | shunt | comp | opto | zener, or "" */
  function family(pn, m) {
    const q = norm(pn), note = String((m && m.hint) || "");
    for (const [k, re] of FAMILIES) if (re.test(q)) return k;
    for (const [k, , words] of FAMILIES) if (words.test(note)) return k;
    return "";
  }
  // a pin of a symbol by the name a maker gave the model's pin
  const NAMED = {
    reg: { I: ["in", "vin", "input", "vi", "i"], O: ["out", "vout", "output", "vo", "o"], G: ["gnd", "vgnd", "ground", "adj", "adjust", "com", "common", "ref", "g", "a"] },
    shunt: { K: ["k", "cathode", "cat", "c"], A: ["a", "anode", "an"], R: ["r", "ref", "refin", "reference", "adj", "fb", "fdbk"] },
    opto: { A: ["a", "anode", "an", "d+", "led+"], K: ["k", "cathode", "cat", "d-", "led-"], C: ["c", "collector", "col"], E: ["e", "emitter", "emit"], B: ["b", "base"] }
  };
  function byNames(m, kind, symPins) {
    const T = NAMED[kind]; if (!T) return null;
    const map = m.pins.map(p => { const n = String(p).toLowerCase(); return symPins.find(id => T[id].includes(n)) || ""; });
    return symPins.every(id => map.filter(x => x === id).length === 1) && map.every(Boolean) ? map : null;
  }
  const perms = a => (a.length < 2 ? [a] : a.flatMap((x, i) => perms(a.filter((_, j) => j !== i)).map(r => [x, ...r])));
  // k of n places, in order: every way to give the symbol's pins `ids` to the model's n pins (the rest left open)
  function places(ids, n) {
    const out = [], go = (map, left) => { if (!left.length) { out.push(map.slice()); return; } for (let i = 0; i < n; i++) if (!map[i]) { map[i] = left[0]; go(map, left.slice(1)); map[i] = ""; } };
    go(Array(n).fill(""), ids); return out;
  }
  // the DC node voltages of the model wired as `map` says into a test circuit: wire(node) gives the
  // circuit's elements, node(id) the node of a pin of the symbol (0 ground); null when it does not solve
  function bench(m, sym, map, nodes, els) {
    const E = root.TubeSimEngine, def = root.CadLib.LIB.spice;
    try {
      const c = { id: "t", type: "spice", label: "X0", params: { name: m.sub, text: m.text, sub: m.sub, sym, pinNames: m.pins.slice(), map } }, all = els.slice();
      let n = 1 + Math.max(0, ...Object.values(nodes), ...els.flatMap(e => e.nodes)); const before = all.length;
      def.build(c, pin => nodes[pin] || 0, () => n++, all);
      if (all.length === before) return null;
      const r = E.dcOperatingPoint(E.buildCircuit({ nodeCount: n, elements: all })); return r && r.ok ? [0, ...r.x.slice(0, n - 1)] : null;
    } catch (e) { return null; }
  }
  const V = (id, a, v) => ({ id, kind: "V", nodes: [a, 0], v }), R = (id, a, b, r) => ({ id, kind: "R", nodes: [a, b], r });
  /** Does the model behave as a part of this kind with its pins taken as `map` says? null, or { adj }.
      reg: IN fed 12 then 15 V (30 and 35 V for the higher ones; both signs), the third pin grounded, 240 Ω on OUT: the
        output must stand still, between 1 V and the input (1.25 V: an adjustable one), hold from 5 to 40 mA of load, and the
        third pin must carry under 50 mA (a string of junctions stands still too, but not like that);
      shunt: REF tied to the cathode, fed through 1 kΩ from 10 then 15 V: the cathode must stand still (to 0.4 %) at 1.1 to 3 V,
        and at twice that with REF on the middle of two equal resistors from cathode to anode;
      comp: ±12 V supplies, 10 kΩ from the output to V+, the inverting input at 0 V: the output must be high with the
        other input at +1 V and low with it at −1 V;
      opto: 5 V through 330 Ω into the LED: its current must leave by its cathode; then the collector on 5 V through
        100 Ω must fall with the LED lit ({ swing }: by how much). */
  function behaves(m, kind, map) {
    if (kind === "reg") {
      for (const pol of [1, -1]) for (const [v1, v2] of [[12, 15], [30, 35]]) {
        // 1 Ω in the third pin shows its current: a regulator's is a few milliamps, whatever the load
        const out = (v, load) => { const r = bench(m, "reg", map, { I: 1, O: 2, G: 3 }, [V("v", 1, pol * v), R("r", 2, 0, load), R("g", 3, 0, 1)]); return r && Math.abs(r[3]) < 0.05 ? pol * r[2] : NaN; };
        const a = out(v1, 240); if (!(a > 1 && a < v1 - 0.4)) continue;
        const b = out(v2, 240); if (!(Math.abs(b - a) < 0.02 * a + 0.01)) continue;
        if (Math.abs(out(v2, a / 0.04) - out(v2, a / 0.005)) < 0.015 * a + 0.005) return { adj: a > 1.15 && a < 1.35 };
      }
      return null;
    }
    if (kind === "shunt") {
      const at = v => { const r = bench(m, "shunt", map, { K: 2, R: 2 }, [V("v", 1, v), R("r", 1, 2, 1000)]); return r ? r[2] : NaN; };
      // stiff: half as much current again moves it by under 0.4 % (a MOSFET with its gate on its drain sits at a few volts too, but softly)
      const a = at(10); if (!(a > 1.1 && a < 3) || !(Math.abs(at(15) - a) < 0.004 * a)) return null;
      const r = bench(m, "shunt", map, { K: 2, R: 3 }, [V("v", 1, 15), R("r", 1, 2, 1000), R("a", 2, 3, 10000), R("b", 3, 0, 10000)]);
      return r && Math.abs(r[2] - 2 * a) < 0.1 * a ? {} : null;
    }
    if (kind === "comp") {
      const sym = m.pins.length === 6 ? "comp6" : "comp";
      const at = v => { const r = bench(m, sym, map, { "+": 1, "-": 2, "V+": 3, "V-": 4, OUT: 5 }, [V("p", 3, 12), V("n", 4, -12), V("a", 1, v), V("b", 2, 0), R("l", 3, 5, 10000)]); return r ? r[5] : NaN; };
      const hi = at(1); if (!(hi > 9)) return null;
      return hi - at(-1) > 5 ? {} : null;
    }
    if (kind === "opto") {
      const at = (v, vcc) => bench(m, "opto", map, { A: 2, K: 5, C: 4 }, [V("v", 1, v), R("r", 1, 2, 330), R("k", 5, 0, 1), V("s", 3, vcc), R("l", 3, 4, 100)]);
      // the LED alone, the other side unpowered: its current must come back out of its cathode (1 Ω there shows it)
      const alone = at(5, 0); if (!alone) return null;
      const led = (5 - alone[2]) / 330; if (!(led > 1e-3 && Math.abs(alone[5] - led) < 0.05 * led)) return null;
      const dark = at(0, 5); if (!dark || !(dark[4] > 4.5)) return null;
      // lit and powered, the cathode still carries the LED's current only (a transistor's base taken for the LED would add the collector's)
      const lit = at(5, 5); if (!lit || !(Math.abs(lit[5] - (5 - lit[2]) / 330) < 0.05 * led)) return null;
      return dark[4] - lit[4] > 0.05 ? { swing: dark[4] - lit[4] } : null;
    }
    return null;
  }
  const canProbe = m => !!(root.TubeSimEngine && root.TubeSimEngine.dcOperatingPoint && root.CadLib && m && m.text);
  /** Which pin of a model is which, found by trying it in a test circuit every way round (behaves):
      { map, adj } (map: per pin of the model, the symbol's pin), or null when no way works or more than one does
      (an optocoupler: the way that pulls the collector furthest, when it is clearly the one) */
  function probe(m, kind) {
    if (!canProbe(m)) return null;
    // a model that does not solve takes long to say so: three seconds of trying, then it is left a box
    const n = m.pins.length, t0 = Date.now(), late = () => Date.now() - t0 > 3000;
    if ((kind === "reg" || kind === "shunt") && n === 3) {
      const ok = [];
      for (const map of perms(kind === "reg" ? ["I", "G", "O"] : ["K", "A", "R"])) { if (late()) return null; const r = behaves(m, kind, map); if (r) ok.push({ map, adj: !!r.adj }); }
      return ok.length === 1 ? ok[0] : null;
    }
    if (kind === "comp" && (n === 5 || n === 6)) {
      const ok = [];
      // six pins: the one left over is the output's emitter
      for (const map of (n === 5 ? perms(["+", "-", "V+", "V-", "OUT"]) : places(["+", "-", "V+", "V-", "OUT"], 6).map(x => x.map(y => y || "E")))) { if (late()) return null; if (behaves(m, kind, map)) ok.push({ map }); if (ok.length > 1) break; }
      return ok.length === 1 ? ok[0] : null;
    }
    if (kind === "opto" && (n === 4 || n === 5)) {
      const found = [];
      for (const map of places(["A", "K", "C", "E"], n)) { if (late()) return null; const r = behaves(m, "opto", map); if (r) found.push({ map, swing: r.swing }); }
      found.sort((x, y) => y.swing - x.swing);
      if (!found.length || (found[1] && found[0].swing < 1.5 * found[1].swing)) return null;
      return { map: found[0].map.map(x => x || (n === 5 ? "B" : "")) };
    }
    return null;
  }
  // the pins as the maker's note above the model lists them ("* ADJ OUT IN", "Connections: Input | Gnd | Output"):
  // every word of one line, or every longer word of the whole note, a pin's name, each pin once
  function byNote(m, kind, symPins) {
    const T = NAMED[kind], n = m.pins.length; if (!T) return null;
    const pinOf = w => symPins.find(id => T[id].includes(w)) || "", words = t => t.toLowerCase().split(/[\s,;:.()=>-]+/).filter(w => w && !/^(connections?|nodes?|pins?|pinout|order|led)$/.test(w));
    const full = map => map.length === n && map.every(Boolean) && symPins.every(id => map.filter(x => x === id).length === 1);
    const lines = String(m.hint || "").split("|").map(words);
    for (const l of lines) { const map = l.map(pinOf); if (full(map)) return map; }
    const map = lines.flat().filter(w => w.length > 1).map(pinOf).filter(Boolean);
    return full(map) ? map : null;
  }
  /** What a found model is drawn as and which of its pins is which: { sym, map, sure, how, adj }.
      how: device (a lone device, or a subcircuit around one) | usual (the usual order of makers' files) |
      names (the model's pin names, or its maker's note) | probe (found in a test circuit) |
      ask (a guess: the user must set the pins) | box */
  function recognise(m, pn) {
    const S = root.CadLib.SPICE_SYMS, base = symFor(m), fam = family(pn, m), n = m.pins.length, std = sym => ({ sym, map: mapFor(m, S[sym].pins), sure: true, how: "device" });
    const odd = fam === "reg" || fam === "shunt" || fam === "opto" || fam === "comp";
    if (base === "diode") return std(fam === "zener" ? "zener" : "diode");
    if (base !== "box" && base !== "opamp" && !(odd && m.kind === "subckt")) return std(base);
    if (fam === "comp" && (n === 5 || n === 6)) {
      // the usual order of makers' models, when the model behaves as a comparator that way; else the way that does
      const sym = n === 6 ? "comp6" : "comp", usual = S.comp6.pins.slice(0, n);
      if (!canProbe(m) || behaves(m, "comp", usual)) return { sym, map: usual, sure: true, how: "usual" };
      const p = probe(m, "comp"); if (p) return { sym, map: p.map, sure: true, how: "probe" };
      return { sym, map: usual, sure: false, how: "ask" };
    }
    if (base === "opamp" && !odd) return { sym: "opamp", map: mapFor(m, S.opamp.pins), sure: true, how: "usual" };
    // three pins: a regulator or a reference; four or five: an optocoupler. What the number says is tried first
    const fets = /^\s*[mj]/im.test(m.text || "");
    const led = /^\s*d/im.test(m.text || "") && /^\s*q/im.test(m.text || "") && !/^\s*x/im.test(m.text || "");   // four pins, a diode and a transistor inside: perhaps an optocoupler   // a model with field-effect transistors and no word of a reference is not tried as one
    const kinds = n === 3 ? (fam === "shunt" || fam === "reg" ? [fam] : fets ? ["reg"] : ["reg", "shunt"]) : (n === 4 && (fam === "opto" || (!fam && led))) || (n === 5 && fam === "opto") ? ["opto"] : [];
    for (const k of kinds) {
      const sym = k === "opto" && n === 5 ? "optob" : k, P = S[sym].pins, adj = m.pins.some(p => /^(adj|adjust)$/i.test(p)) || /\badj/i.test(m.hint || "");
      // the names say it, and the test circuit agrees (or cannot be run): no need to try every way round
      const named = byNames(m, k, P) || byNote(m, k, P);
      if (named) { const r = canProbe(m) ? behaves(m, k, named) : fam === k ? {} : null; if (r) return { sym, map: named, sure: true, how: "names", adj: r.adj === undefined ? adj : r.adj }; }
      const p = probe(m, k); if (p) return { sym, map: p.map, sure: true, how: "probe", adj: !!p.adj };
      // the names are plain but the model does not run in the test circuit (a regulator that wants more volts): the names are taken
      if (named && fam === k && byNames(m, k, P)) return { sym, map: named, sure: true, how: "names", adj };
    }
    // a regulator's or a reference's number, the pins could not be told: drawn as that, in the model's order, for the user to set
    if ((fam === "reg" || fam === "shunt") && n === 3 && FAMILIES.find(x => x[0] === fam)[1].test(norm(pn))) return { sym: fam, map: S[fam].pins.slice(), sure: false, how: "ask", adj: false };
    return { sym: "box", map: m.pins.map((_, i) => String(i + 1)), sure: true, how: "box" };
  }
  root.SpiceFind = { KINDS, norm, read, load, candidates, urlOf, cut, get, symFor, mapFor, family, behaves, probe, recognise, reset() { index = null; loading = null; } };
})(typeof window !== "undefined" ? window : globalThis);
