/**
 * LTspice import against the .asc itself (not part of npm test: it needs a folder of LTspice
 * schematics): node tests/ltspice-field.mjs <folder|file.asc> [...]. Each schematic is imported,
 * and the nets of the circuit it gives (the app's wires, pins, net labels and grounds) are compared
 * with the nets read straight from the .asc's wires, LTspice's pin positions and its flags.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { join } from "node:path";
import { nets } from "./kicad-oracle.mjs";

for (const f of ["spice-model.js", "spice-net.js", "spice-find.js", "ltspice-import.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const LT = globalThis.LtspiceImport, L = globalThis.CadLib;

// the LTspice pin each pin of the app's part stands for
const BACK = { resistor: { 1: "A", 2: "B" }, capacitor: { 1: "A", 2: "B" }, inductor: { 1: "A", 2: "B" }, electrolytic: { "+": "A", "-": "B" },
  diode: { A: "+", K: "-" }, zener: { A: "+", K: "-" }, led: { A: "+", K: "-" }, vdc: { "+": "+", "-": "-" }, siggen: { "+": "+", "-": "-" }, isrc: { "+": "-", "-": "+" } };
function ltPin(c, pid, symName) {
  if (BACK[c.type]) return BACK[c.type][pid];
  if (["npn", "pnp", "nmos", "pmos", "njf", "pjf"].includes(c.type)) return pid;
  if (c.type === "spice") { const order = (LT.SYMS[symName] || LT.SYMS[symName.split("\\").pop()] || []).map(p => p[0]), i = c.params.map.indexOf(pid); return order[i]; }
  if (c.type === "kicad") { const p = c.params.sym.pins.find(q => q.id === pid); return p && p.name; }
  return null;
}
export function check(text) {
  const A = LT.readAsc(text), { design, report } = LT.importAsc({ "x.asc": text }), N = nets(design), want = LT.ascNets(text);
  const symOf = new Map(A.symbols.map(s => [s.attrs.InstName, String(s.name).toLowerCase()])), dup = new Set(A.symbols.map(s => s.attrs.InstName).filter((n, i, a) => a.indexOf(n) !== i));
  const mine = new Map();
  design.comps.forEach(c => { if (!c.label || dup.has(c.label) || !symOf.has(c.label)) return; L.LIB[c.type].pins({ params: Object.assign({}, L.LIB[c.type].defaults, c.params), label: c.label }).forEach(p => { const n = ltPin(c, p.id, symOf.get(c.label)); if (n) mine.set(c.label + "." + n, N.get(c.id + ":" + p.id)); }); });
  const bad = [], seen = new Map();
  want.nets.forEach(g => {
    const ids = [...new Set(g.filter(k => mine.has(k)).map(k => mine.get(k)))];
    if (ids.length > 1) bad.push("split: " + g.join(","));
    ids.forEach(i => { if (seen.has(i) && seen.get(i) !== g) bad.push("merged: " + g.join(",") + " with " + seen.get(i).join(",")); seen.set(i, g); });
  });
  return { report, bad, pins: mine.size };
}
if (process.argv[1] && process.argv[1].endsWith("ltspice-field.mjs")) {
  const files = process.argv.slice(2).flatMap(p => (statSync(p).isDirectory() ? readdirSync(p).filter(f => /\.asc$/i.test(f)).map(f => join(p, f)) : [p]));
  let ok = 0, bad = 0, err = 0, parts = 0, own = 0, kept = 0;
  for (const f of files) {
    try {
      const r = check(LT.decode(readFileSync(f)));
      parts += r.report.parts; own += r.report.own; kept += r.report.kept;
      if (r.bad.length) { bad++; console.log("NETS", f, r.bad.slice(0, 4).join(" | ")); } else ok++;
    } catch (e) { err++; console.log("ERROR", f, e.stack.split("\n").slice(0, 3).join(" ")); }
  }
  console.log(`${files.length} schematics: ${ok} same nets, ${bad} different, ${err} errors; ${parts} parts, ${own} the app's own, ${kept} kept as drawn`);
  process.exitCode = bad || err ? 1 : 0;
}
