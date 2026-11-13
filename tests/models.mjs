#!/usr/bin/env node
/**
 * SPICE parts against ngspice: the same model file is solved by the simulator
 * (spice-net.js turns it into the engine's elements) and by ngspice, and the
 * operating points are compared.
 *
 *   1  the test fixtures (tests/fixtures): device models, sources, a switch, a
 *      table, a polynomial; an op-amp macromodel as a ×11 amplifier
 *   2  makers' models (tests/models.json): each op-amp as a ×11 amplifier on
 *      ±supplies with 0.1 V in. The files are not kept in this repository:
 *      they are read from the KiCad-Spice-Library project at a fixed commit,
 *      fetched into MODELS_DIR (default: a folder in the system's temporary
 *      directory). Without network access this part is skipped, and said so.
 *
 *   node tests/models.mjs            # needs ngspice on the PATH (apt install ngspice)
 *
 * NGSPICE sets the ngspice binary, MODELS_DIR the library's folder, ONLY=TL072 runs
 * the models whose name has that in it, SURVEY=1 lists every model's result.
 * An entry of models.json marked "known" is a model the simulator does not solve yet:
 * it is reported, and fails the run only when it starts to pass (so the mark is removed).
 */
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["tube-db.js", "spice-model.js", "spice-net.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const E = globalThis.TubeSimEngine, SN = globalThis.SpiceNet;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));
const NGSPICE = process.env.NGSPICE || "ngspice", ONLY = (process.env.ONLY || "").toLowerCase();
try { execFileSync(NGSPICE, ["-v"], { stdio: "ignore" }); } catch { console.log(`ngspice not found (${NGSPICE}): install it (apt install ngspice) or set NGSPICE`); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "tubecad-models-"));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "PASS" : "FAIL"} ${msg}`); if (!ok) failed++; };

// a bench subcircuit (its pins the nodes to compare) solved here: { v: { node: volts } } or { error }
function ours(lib, bench, name) {
  try {
    const text = lib + "\n" + bench, f = SN.flatten(text, name);
    let n = f.nNodes;
    const els = SN.build({ text, sub: name }, f.pins.map((_, i) => i + 1), () => n++, "U");
    const res = E.simulate({ nodeCount: n, elements: els }, {});
    if (!res.ok) return { error: res.error };
    const v = {}; f.pins.forEach((p, i) => { v[p] = res.dc.nodes[i + 1]; });
    return { v, warnings: f.warnings };
  } catch (e) { return { error: e.message || String(e) }; }
}
// the same in ngspice: { v } or { error }
function theirs(lib, bench, name, nodes) {
  const cir = join(work, "t.cir");
  // (ngspice refuses a file that is not UTF-8: old libraries' comments in other code pages go as "?")
  writeFileSync(cir, `* bench\n${lib.replace(/[^\x00-\x7f]/g, "?")}\n${bench}\nX0 ${nodes.join(" ")} ${name}\n.op\n.control\nset noaskquit\nop\nprint ${nodes.map(n => `v(${n})`).join(" ")}\n.endc\n.end\n`, "latin1");
  let out; try { out = execFileSync(NGSPICE, ["-b", cir], { encoding: "latin1", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { out = String(e.stdout || "") + String(e.stderr || ""); }
  const v = {}; nodes.forEach(n => { const m = new RegExp(`v\\(${n}\\) = ([-+0-9.e]+)`, "i").exec(out); if (m) v[n] = +m[1]; });
  return Object.keys(v).length === nodes.length ? { v } : { error: (out.match(/error[^\n]*/gi) || ["no result"]).slice(0, 2).join(" | ") };
}
// both, and the worst difference (relative, with 10 mV of floor)
function compare(lib, bench, name, nodes) {
  const a = ours(lib, bench, name), b = theirs(lib, bench, name, nodes);
  let worst = 0, at = "";
  if (a.v && b.v) nodes.forEach(n => { const err = Math.abs(a.v[n] - b.v[n]) / (Math.abs(b.v[n]) + 0.01); if (!(err <= worst)) { worst = err; at = `V(${n}) ${a.v[n].toPrecision(5)} / ngspice ${b.v[n].toPrecision(5)}`; } });
  return { a, b, worst, at };
}
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "latin1");
// an op-amp of five pins (+ − V+ V− out) as a ×11 amplifier: 0.1 V in, 10 kΩ and 1 kΩ, 10 kΩ load
const ampBench = (sub, vs) => `.subckt bench inp inn out\nVp vp 0 ${vs}\nVn vn 0 ${-vs}\nVin inp 0 0.1\nR1 out inn 10k\nR2 inn 0 1k\nRL out 0 10k\nX1 inp inn vp vn out ${sub}\n.ends`;

// --- 1: the fixtures ---
{
  const dev = fixture("devices.lib"), i = dev.search(/^\.subckt bench/m), lib = dev.slice(0, i), bench = dev.slice(i), nodes = /^\.subckt bench (.*)$/m.exec(dev)[1].trim().split(/\s+/);
  const r = compare(lib, bench, "bench", nodes);
  check(r.a.v && r.b.v && r.worst < 3e-3, `devices, sources, switch, table and polynomial: ${r.a.error || r.b.error || `${nodes.length} nodes within ${(r.worst * 100).toFixed(3)} % of ngspice (${r.at})`}`);
  const q = compare(fixture("testamp.lib"), ampBench("TESTAMP", 15), "bench", ["inp", "inn", "out"]);
  check(q.a.v && q.b.v && q.worst < 3e-3 && Math.abs(q.a.v.out - 1.1) < 0.001, `the test op-amp as a ×11 amplifier: ${q.a.error || q.b.error || `out ${q.a.v.out.toFixed(5)} V, within ${(q.worst * 100).toFixed(3)} % of ngspice`}`);
}

// --- 2: makers' models ---
{
  const set = JSON.parse(readFileSync(new URL("./models.json", import.meta.url), "utf8"));
  const dir = process.env.MODELS_DIR || join(tmpdir(), `tubecad-spice-library-${set.commit.slice(0, 12)}`);
  let have = existsSync(join(dir, "Models"));
  if (!have) {
    try {
      mkdirSync(dir, { recursive: true });
      const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "ignore", "pipe"], timeout: 600000 });
      git("init", "-q"); git("fetch", "-q", "--depth", "1", set.repository, set.commit); git("checkout", "-q", "FETCH_HEAD");
      have = existsSync(join(dir, "Models"));
    } catch (e) { rmSync(dir, { recursive: true, force: true }); console.log(`SKIP makers' models: the library could not be fetched (${String(e.stderr || e.message).trim().split("\n").pop()})`); }
  }
  if (have) {
    let ok = 0, known = 0; const list = set.models.filter(m => !ONLY || m.sub.toLowerCase().includes(ONLY));
    for (const m of list) {
      let lib; try { lib = readFileSync(join(dir, m.file), "latin1"); } catch { check(false, `${m.sub}: ${m.file} is not in the library`); continue; }
      const r = compare(lib, ampBench(m.sub, m.supply || 15), "bench", ["inp", "inn", "out"]);
      const good = !!(r.a.v && r.b.v && r.worst < 0.02), line = `${m.sub} (${m.maker}): ${r.b.error ? "ngspice: " + r.b.error : r.a.error ? r.a.error : `out ${r.a.v.out.toFixed(4)} V, ${(r.worst * 100).toFixed(2)} % from ngspice`}`;
      if (m.known) { known++; if (good) check(false, `${line}: marked "known" (${m.known}) but it passes now, take the mark off`); else console.log(`KNOWN ${line}`); continue; }
      if (good) ok++;
      if (!good || process.env.SURVEY) check(good, line);
    }
    check(ok === list.length - known, `makers' op-amp models as ×11 amplifiers: ${ok} of ${list.length - known} within 2 % of ngspice${known ? ` (${known} more known not to solve yet)` : ""}`);
  }
}
rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
