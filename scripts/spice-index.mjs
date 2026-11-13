/**
 * The index behind "Add part…" (spice-find.js): which file of the public KiCad-Spice-Library holds
 * the SPICE model of a part number. Names and paths only: no model text is kept here, the app
 * downloads the one file a part needs when the part is added.
 *
 *   git clone https://github.com/kicad-spice-library/KiCad-Spice-Library.git <dir>
 *   node scripts/spice-index.mjs <dir>          → spice-index.json
 *
 * Per name the best file wins: a maker's own (Models/Manufacturer), then the sorted folders, then
 * the rest; the smaller file among equals (less to download).
 * kinds: X subcircuit; D diode; N / P bipolar; M / m MOSFET n / p; V VDMOS; J / j JFET n / p.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, relative } from "node:path";

const root = process.argv[2];
if (!root) { console.error("usage: node scripts/spice-index.mjs <KiCad-Spice-Library checkout>"); process.exit(1); }
const KIND = { d: "D", npn: "N", pnp: "P", nmos: "M", pmos: "m", njf: "J", pjf: "j", vdmos: "V" };
const rank = p => (p.startsWith("Models/Manufacturer") ? 0 : p.startsWith("Models/uncategorized") ? 2 : 1);
const walk = d => readdirSync(d).sort().flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const names = new Map();
for (const p of walk(join(root, "Models"))) {
  const rel = relative(root, p).split("\\").join("/"), text = readFileSync(p, "latin1"), r = [rank(rel), text.length];
  const put = (name, kind, pins) => {
    const n = name.toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_\-+./]{2,30}$/.test(n)) return;
    const was = names.get(n);
    if (was) {
      // a lone .MODEL says what the device is (a diode, a transistor): it wins over a subcircuit of up to
      // three pins and loses to a bigger one; among equals the better folder, then the smaller file
      const lone = kind !== "X", wasLone = was.kind !== "X";
      const better = lone && !wasLone ? was.pins <= 3 : !lone && wasLone ? pins > 3 : r[0] < was.r[0] || (r[0] === was.r[0] && r[1] < was.r[1]);
      if (!better) return;
    }
    names.set(n, { file: rel, kind, pins, r });
  };
  for (const m of text.matchAll(/^[ \t]*\.subckt[ \t]+(\S+)([^\n]*)/gim)) { const t = m[2].split(/\s+/).filter(Boolean), eq = t.findIndex(x => x.includes("=") || /^params:?$/i.test(x)); put(m[1], "X", eq < 0 ? t.length : eq); }
  for (const m of text.matchAll(/^[ \t]*\.model[ \t]+(\S+)[ \t]+\(?[ \t]*([a-z]+)/gim)) { const k = KIND[m[2].toLowerCase()]; if (k) put(m[1], k, 0); }
}
const files = [...new Set([...names.values()].map(v => v.file))].sort(), at = new Map(files.map((f, i) => [f, i]));
const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
const lines = [...names.keys()].sort().map(n => { const v = names.get(n); return `${n}\t${at.get(v.file)}\t${v.kind}${v.pins || ""}`; });
writeFileSync(new URL("../spice-index.json", import.meta.url), JSON.stringify({ source: "https://github.com/kicad-spice-library/KiCad-Spice-Library", commit, files, names: lines.join("\n") }));
console.log(`${lines.length} names in ${files.length} files, commit ${commit.slice(0, 8)}`);
