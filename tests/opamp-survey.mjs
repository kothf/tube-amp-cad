#!/usr/bin/env node
/**
 * A wider survey of makers' op-amp models than tests/models.mjs runs in CI: every five-pin
 * .SUBCKT of the KiCad-Spice-Library (fetched by tests/models.mjs into MODELS_DIR), or a seeded
 * sample of SAMPLE of them, as a ×11 amplifier on ±15 V with 0.1 V in, solved here and by
 * ngspice. Counted: models ngspice cannot read, five-pin parts that are no op-amp in the usual
 * pin order (ngspice's output not near 1.1 V), and of the rest those within 2 % of ngspice, off,
 * or not solved here. Not part of CI (a few minutes for 400 models).
 *
 *   MODELS_DIR=/tmp/tubecad-spice-library-a8688952bcaa SAMPLE=400 node tests/opamp-survey.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, statSync, rmSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const set = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8"));
const dir = process.env.MODELS_DIR || join(tmpdir(), `tubecad-spice-library-${set.commit.slice(0, 12)}`), NGSPICE = process.env.NGSPICE || "ngspice";
const files = []; const walk = d => readdirSync(d).forEach(n => { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files.push(p); });
walk(join(dir, "Models"));
let list = [];
for (const file of files.sort()) {
  const text = readFileSync(file, "latin1");
  for (const m of text.matchAll(/^\.subckt\s+(\S+)\s+([^\n]*)/gim)) {
    const pins = m[2].trim().split(/\s+/); let n = 0;
    for (const p of pins) { if (p.includes("=") || /^params:?$/i.test(p)) break; n++; }
    if (n === 5 && !list.some(x => x[1].toLowerCase() === m[1].toLowerCase())) list.push([file, m[1]]);
  }
}
// a seeded shuffle, so a sample is the same from run to run
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
if (process.env.SAMPLE) list = list.slice(0, +process.env.SAMPLE);
if (process.env.ONLY) list = list.filter(x => process.env.ONLY.toLowerCase().split(",").includes(x[1].toLowerCase()));   // ONLY=TLV2461,OPA301: just those
const work = mkdtempSync(join(tmpdir(), "tubecad-survey-"));
const bench = sub => `.subckt bench inp inn out\nVp vp 0 15\nVn vn 0 -15\nVin inp 0 DC 0.1\nR1 out inn 10k\nR2 inn 0 1k\nRL out 0 10k\nX1 inp inn vp vn out ${sub}\n.ends`;
const n = { models: list.length, ngspiceCannot: 0, notOpAmp: 0, within2: 0, off: 0, notSolved: 0 }, bad = [];
for (const [file, sub] of list) {
  const lib = readFileSync(file, "latin1"), cir = join(work, "t.cir");
  writeFileSync(cir, `* b\n${lib.replace(/[\u0080-￿]/g, "?")}\n${bench(sub)}\nX0 inp inn out bench\n.op\n.control\nset noaskquit\nop\nprint v(out)\n.endc\n.end\n`, "latin1");
  let out; try { out = execFileSync(NGSPICE, ["-b", cir], { encoding: "latin1", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || ""); }
  const m = /v\(out\) = ([-+0-9.e]+)/i.exec(out);
  if (!m) { n.ngspiceCannot++; continue; }
  const ng = +m[1];
  if (Math.abs(ng - 1.1) > 0.2) { n.notOpAmp++; continue; }
  let v = null, err = "";
  try {
    const text = lib + "\n" + bench(sub), f = SN.flatten(text, "bench"); let k = f.nNodes;
    const els = SN.build({ text, sub: "bench" }, f.pins.map((_, i) => i + 1), () => k++, "U");
    const r = E.simulate({ nodeCount: k, elements: els }, { budgetMs: 20000 });
    if (r.ok) v = r.dc.nodes[f.pins.indexOf("out") + 1]; else err = r.error;
  } catch (e) { err = e.message; }
  if (v === null) { n.notSolved++; bad.push(`${sub} (${file.slice(dir.length + 1)}): ${err}`); continue; }
  if (Math.abs(v - ng) / (Math.abs(ng) + 0.01) <= 0.02) n.within2++; else { n.off++; bad.push(`${sub} (${file.slice(dir.length + 1)}): ${v.toFixed(4)} V / ngspice ${ng.toFixed(4)} V`); }
}
rmSync(work, { recursive: true, force: true });
console.log(`${n.models} five-pin models: ngspice cannot read ${n.ngspiceCannot}, ${n.notOpAmp} are no op-amp in the usual pin order; of the ${n.within2 + n.off + n.notSolved} left, ${n.within2} within 2 % of ngspice, ${n.off} off, ${n.notSolved} not solved`);
bad.forEach(b => console.log("  " + b));
process.exit(n.off + n.notSolved ? 1 : 0);
