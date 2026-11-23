/**
 * LTspice import against LTspice itself (not part of npm test: it needs LTspice, under Wine on Linux).
 *
 *   node tests/ltspice-oracle.mjs prepare <folder of .asc> <out folder>
 *       writes a copy of each schematic whose only analysis is .op (.tran/.ac/.step … taken out)
 *   (LTspice: LTspice.exe -netlist X.asc, then LTspice.exe -b -ascii X.net → X.net and X.raw)
 *   node tests/ltspice-oracle.mjs compare <out folder> [results.json]
 *       imports each X.asc as the app does, works out its DC operating point with the app's engine,
 *       and compares the voltage on every pin with LTspice's (X.net gives each pin's node, X.raw the
 *       node's voltage). Schematics with a part kept as a box (not simulated here) are counted apart.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { nets } from "./kicad-oracle.mjs";
import { ltPin } from "./ltspice-field.mjs";

const LT = globalThis.LtspiceImport, L = globalThis.CadLib, E = globalThis.TubeSimEngine;
E.loadWasm(readFileSync(new URL("../sim-solver.wasm", import.meta.url)));

const ANALYSIS = /^\s*\.(tran|ac|dc|noise|tf|op|step|four|meas|measure|wave|save|backanno|net|sens|pz|disto)\b/i;
/** the schematic with .op as its only analysis */
export function opCopy(text) {
  const out = [];
  text.split(/\r?\n/).forEach(ln => {
    const m = /^(TEXT\s+-?\d+\s+-?\d+\s+\S+\s+\S+\s+)!(.*)$/.exec(ln);
    if (!m) { out.push(ln); return; }
    // a stepped parameter keeps its first value (as the import takes it)
    const keep = m[2].split("\\n").map(l => { const st = /^\s*\.step\s+(?:(?:oct|dec|lin)\s+)?param\s+(\S+)\s+(?:list\s+)?(\S+)/i.exec(l); return st ? `.param ${st[1]}=${st[2]}` : l; }).filter(l => !ANALYSIS.test(l));
    if (keep.some(l => l.trim())) out.push(m[1] + "!" + keep.join("\\n"));
  });
  while (out.length && !out[out.length - 1].trim()) out.pop();
  out.push("TEXT 0 -64 Left 2 !.op");
  return out.join("\n") + "\n";
}

/** LTspice's .raw (ASCII or binary, UTF-16 or 8-bit header): Map lower-case name → value of the first point */
export function readRaw(buf) {
  const u16 = buf.length > 1 && buf[1] === 0;
  const text = u16 ? Buffer.from(buf).toString("utf16le") : Buffer.from(buf).toString("latin1");
  const names = [], vals = new Map();
  const head = text.split(/\n/);
  let i = 0, n = 0;
  for (; i < head.length; i++) {
    const ln = head[i].replace(/\r$/, "");
    const nv = /^No\. Variables:\s*(\d+)/i.exec(ln); if (nv) n = +nv[1];
    if (/^Variables:/i.test(ln)) { for (let k = 0; k < n; k++) names.push(head[++i].trim().split(/\s+/)[1].toLowerCase()); continue; }
    if (/^Values:/i.test(ln)) {
      const nums = head.slice(i + 1).join(" ").trim().split(/\s+/).slice(1, n + 1).map(Number);
      names.forEach((nm, k) => vals.set(nm, nums[k]));
      return vals;
    }
    if (/^Binary:/i.test(ln)) {
      const at = text.indexOf("Binary:") + "Binary:".length + 1, off = u16 ? at * 2 : at;
      const data = Buffer.from(buf).subarray(off), size = Math.floor(data.length / n) >= 8 ? 8 : 4;
      names.forEach((nm, k) => vals.set(nm, size === 8 ? data.readDoubleLE(k * 8) : data.readFloatLE(k * 4)));
      return vals;
    }
  }
  return vals;
}

/** LTspice's netlist: Map upper-case element name → its node names, in order */
export function readNet(buf) {
  const text = buf.length > 1 && buf[1] === 0 ? Buffer.from(buf).toString("utf16le") : Buffer.from(buf).toString("latin1");
  const lines = [], m = new Map();
  text.split(/\r?\n/).forEach(ln => { if (/^\+/.test(ln) && lines.length) lines[lines.length - 1] += " " + ln.slice(1); else lines.push(ln); });
  lines.forEach(ln => { const t = ln.trim().split(/\s+/); if (t[0] && /^[A-Za-z]/.test(t[0])) m.set(t[0].toUpperCase(), t.slice(1)); });
  return m;
}

/** the app's DC operating point of an imported schematic: a function app pin → volts */
function appDC(design) {
  const N = nets(design);
  const ground = new Set(design.comps.filter(c => c.type === "ground").map(c => N.get(c.id + ":" + L.LIB.ground.pins({ params: {} })[0].id)));
  const ids = new Map(); let n = 0;
  const node = k => (k === undefined ? undefined : ground.has(k) ? 0 : (ids.has(k) ? ids.get(k) : (ids.set(k, ++n), n)));
  const els = [], rails = new Set();
  design.comps.forEach(c => {
    const d = L.LIB[c.type]; if (!d.build || ["frame", "note", "ground", "netlabel", "kicad"].includes(c.type)) return;
    const full = Object.assign({}, c, { params: Object.assign({}, d.defaults, c.params) });
    if (c.type === "rail") { const k = N.get(c.id + ":1"); if (rails.has(k)) return; rails.add(k); }
    d.build(full, pin => node(N.get(c.id + ":" + pin)), () => ++n, els);
  });
  const r = E.simulate({ nodeCount: n + 1, elements: els }, { budgetMs: 20000 });
  if (!r.ok) return { error: r.error || "no result" };
  // a run with a time-dependent source reports averages as its DC; the operating point itself (the
  // sources at t = 0, as LTspice's .op takes them) is kept as dcEstimate
  const op = r.dcEstimate || r.dc;
  return { at: (c, pin) => { const k = node(N.get(c.id + ":" + pin)); return k === undefined ? undefined : op.nodes[k]; } };
}

export function compare(ascText, netBuf, rawBuf) {
  const A = LT.readAsc(ascText), { design, report } = LT.importAsc({ "x.asc": ascText });
  const raw = readRaw(rawBuf), net = readNet(netBuf);
  if (!raw.size) return { skip: "no LTspice result" };
  const sim = appDC(design);
  if (sim.error) return { fail: "app: " + sim.error };
  const sym = new Map(A.symbols.map(s => [s.attrs.InstName, s]));
  const rows = [];
  design.comps.forEach(c => {
    const s = c.label && sym.get(c.label); if (!s) return;
    const name = String(s.name).toLowerCase(), list = LT.SYMS[name] || LT.SYMS[name.split("\\").pop()]; if (!list) return;
    const order = list.map(p => p[0]), up = c.label.toUpperCase();
    const nodes = net.get(up) || [...net.entries()].find(([k]) => k.slice(1) === up)?.[1]; if (!nodes) return;
    L.LIB[c.type].pins({ params: Object.assign({}, L.LIB[c.type].defaults, c.params), label: c.label }).forEach(p => {
      const ltp = ltPin(c, p.id, name), i = order.indexOf(ltp); if (i < 0 || !nodes[i]) return;
      const nd = nodes[i].toLowerCase(), lt = nd === "0" ? 0 : raw.get(`v(${nd})`), app = sim.at(c, p.id);
      if (lt === undefined || app === undefined || !Number.isFinite(lt)) return;
      rows.push({ pin: c.label + "." + ltp, node: nd, lt, app });
    });
  });
  const bad = rows.filter(r => !(Math.abs(r.app - r.lt) <= 0.01 * Math.max(Math.abs(r.app), Math.abs(r.lt)) + 0.01));
  return { kept: report.kept, rows: rows.length, bad, worst: rows.reduce((w, r) => Math.max(w, Math.abs(r.app - r.lt)), 0) };
}

if (process.argv[1] && process.argv[1].endsWith("ltspice-oracle.mjs")) {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === "prepare") {
    mkdirSync(b, { recursive: true });
    const files = readdirSync(a).filter(f => /\.asc$/i.test(f));
    files.forEach(f => writeFileSync(join(b, f), Buffer.from(opCopy(LT.decode(readFileSync(join(a, f)))), "latin1")));
    console.log(`${files.length} schematics written to ${b} with .op as the analysis`);
  } else if (cmd === "compare") {
    const files = readdirSync(a).filter(f => /\.asc$/i.test(f)).sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
    const out = [], tally = { same: 0, differ: 0, fail: 0, skip: 0, kept: 0 };
    for (const f of files) {
      const stem = join(a, basename(f, ".asc")), res = { file: f };
      try {
        if (!existsSync(stem + ".net") || !existsSync(stem + ".raw")) Object.assign(res, { skip: "LTspice wrote no .net/.raw" });
        else Object.assign(res, compare(LT.decode(readFileSync(join(a, f))), readFileSync(stem + ".net"), readFileSync(stem + ".raw")));
      } catch (e) { res.fail = e.stack.split("\n").slice(0, 3).join(" "); }
      const kind = res.skip ? "skip" : res.fail ? "fail" : res.kept ? "kept" : res.bad.length ? "differ" : "same";
      tally[kind]++; out.push(res);
      if (kind === "differ") console.log("DIFFER", f, res.bad.slice(0, 4).map(r => `${r.pin} LT ${r.lt.toPrecision(4)} app ${r.app.toPrecision(4)}`).join(" | "));
      else if (kind === "fail") console.log("FAIL", f, res.fail);
      else if (kind === "skip") console.log("skip", f, res.skip);
    }
    console.log(`${files.length} schematics: ${tally.same} same operating point, ${tally.differ} different, ${tally.fail} failed, ${tally.skip} left out, ${tally.kept} with parts kept as boxes (not compared)`);
    if (b) writeFileSync(b, JSON.stringify(out, null, 1));
  } else console.log("node tests/ltspice-oracle.mjs prepare <asc folder> <out> | compare <out> [results.json]");
}
