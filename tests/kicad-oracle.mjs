/**
 * KiCad import against KiCad itself (not part of npm test: it needs kicad-cli and KiCad's demo
 * projects): node tests/kicad-oracle.mjs <project folder> [...]. Each project is imported, the
 * nets the CAD makes of it (pins on the same point or wire, connectors of a name) are compared
 * with the netlist kicad-cli exports from the same schematic.
 */
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInThisContext } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "kicad-import.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const L = globalThis.CadLib, K = globalThis.KicadImport;
const rotPt = (x, y, r) => (r === 1 ? [-y, x] : r === 2 ? [-x, -y] : r === 3 ? [y, -x] : [x, y]);
export function compPins(c) {
  const d = L.LIB[c.type], full = { ...c, params: { ...d.defaults, ...c.params } }, f = full.params.flip === "yes" ? -1 : 1;
  return d.pins(full).map(p => { const [x, y] = rotPt(f * p.x, p.y, c.rot); return { id: p.id, x: c.x + x, y: c.y + y }; });
}
/** the CAD's nets (cad-app.js computeTopology after normalizeWires): Map "compId:pin" → net id */
export function nets(design) {
  const parent = new Map(), find = k => { if (!parent.has(k)) parent.set(k, k); let r = k; while (parent.get(r) !== r) r = parent.get(r); parent.set(k, r); return r; }, union = (a, b) => parent.set(find(a), find(b));
  const key = (x, y) => x + "," + y, pts = [];
  design.wires.forEach(w => { union(key(w.x1, w.y1), key(w.x2, w.y2)); pts.push([w.x1, w.y1], [w.x2, w.y2]); });
  design.comps.forEach(c => compPins(c).forEach(p => { find(key(p.x, p.y)); pts.push([p.x, p.y]); }));
  // an end or a pin on a wire's run joins it
  const H = new Map(), V = new Map();
  design.wires.forEach(w => { if (w.y1 === w.y2) { if (!H.has(w.y1)) H.set(w.y1, []); H.get(w.y1).push(w); } else { if (!V.has(w.x1)) V.set(w.x1, []); V.get(w.x1).push(w); } });
  pts.forEach(([x, y]) => {
    (H.get(y) || []).forEach(w => { if (x > Math.min(w.x1, w.x2) && x < Math.max(w.x1, w.x2)) union(key(x, y), key(w.x1, w.y1)); });
    (V.get(x) || []).forEach(w => { if (y > Math.min(w.y1, w.y2) && y < Math.max(w.y1, w.y2)) union(key(x, y), key(w.x1, w.y1)); });
  });
  let g = null; const names = new Map();
  design.comps.forEach(c => {
    if (c.type === "ground") { const p = compPins(c)[0], k = key(p.x, p.y); if (g === null) g = k; else union(k, g); }
    if (c.type === "offsheet" || c.type === "rail") { const n = String(c.params.name || "").trim().toUpperCase(), k = key(c.x, c.y); if (!n) return; if (names.has(n)) union(k, names.get(n)); else names.set(n, k); }
  });
  const out = new Map();
  design.comps.forEach(c => compPins(c).forEach(p => out.set(c.id + ":" + p.id, find(key(p.x, p.y)))));
  return out;
}
if (process.argv[1] && process.argv[1].endsWith("kicad-oracle.mjs")) {
  let bad = 0;
  for (const dir of process.argv.slice(2)) {
    const files = {}; readdirSync(dir).filter(f => /\.kicad_(sch|pcb|pro)$/.test(f)).forEach(f => { files[f] = readFileSync(join(dir, f), "utf8"); });
    for (const pro of Object.keys(files).filter(f => f.endsWith(".kicad_pro"))) {
      const base = pro.replace(/\.kicad_pro$/, ""), set = Object.fromEntries(Object.entries(files).filter(([f]) => f.endsWith(".kicad_sch") || f.startsWith(base + ".")));
      // only this project's root: the other .kicad_pro files of the folder have roots of their own
      Object.keys(set).forEach(f => { if (f.endsWith(".kicad_sch") && f !== base + ".kicad_sch" && Object.keys(files).includes(f.replace(/\.kicad_sch$/, ".kicad_pro"))) delete set[f]; });
      if (!set[base + ".kicad_sch"]) continue;
      const t0 = Date.now(), { design, report } = K.importProject(set), N = nets(design), ms = Date.now() - t0;
      const out = join(mkdtempSync(join(tmpdir(), "kio-")), "n.net");
      execFileSync("kicad-cli", ["sch", "export", "netlist", "--format", "kicadsexpr", "-o", out, join(dir, base + ".kicad_sch")], { stdio: "pipe" });
      const net = K.parse(readFileSync(out, "utf8")), knets = net.find(x => Array.isArray(x) && x[0] === "nets").slice(1);
      // our pins by KiCad's reference and pin number
      const mine = new Map();      // "REF:num" → net id
      const refOf = c => String(c.label).replace(/\.(\d+|H)$/, "");
      design.comps.forEach(c => {
        if (["frame", "note", "ground", "offsheet", "rail"].includes(c.type)) return;
        if (c.type === "kicad") c.params.sym.pins.forEach(p => mine.set(refOf(c) + ":" + p.num, N.get(c.id + ":" + p.id)));
      });
      // parts of the app's own: by the pin map the report keeps
      (report.pinMaps || []).forEach(([ref, id, pinOf]) => Object.entries(pinOf).forEach(([num, pid]) => mine.set(ref + ":" + num, N.get(id + ":" + pid))));
      let wrong = 0, checked = 0, lost = 0; const k2m = new Map(), m2k = new Map();
      knets.forEach(n => {
        const nm = n.find(x => Array.isArray(x) && x[0] === "name")[1];
        n.filter(x => Array.isArray(x) && x[0] === "node").forEach(nd => {
          const ref = nd.find(x => x[0] === "ref")[1], pin = nd.find(x => x[0] === "pin")[1], m = mine.get(ref + ":" + pin);
          if (m === undefined) { lost++; if (process.env.V) console.log("   not here:", ref, pin, nm); return; }
          checked++;
          if (!k2m.has(nm)) k2m.set(nm, m); else if (k2m.get(nm) !== m) { wrong++; if (process.env.V) console.log("   split:", nm, ref, pin); }
          if (!m2k.has(m)) m2k.set(m, nm); else if (m2k.get(m) !== nm) { wrong++; if (process.env.V) console.log("   joined:", nm, "with", m2k.get(m), "at", ref, pin); }
        });
      });
      if (wrong) bad++;
      console.log(`${wrong ? "FAIL" : "ok  "} ${dir.split("/").pop()}/${base}: ${report.sheets} sheets, ${report.parts} parts (${report.own} own, ${report.kept} kept), ${knets.length} nets, ${checked} pins agree${wrong ? `, ${wrong} WRONG` : ""}${lost ? `, ${lost} pins of dropped units` : ""}${report.board ? `; board ${report.board.parts} parts, ${report.board.tracks} tracks` : ""} (${ms} ms)`);
      if (report.board) {
        // the board: every pad where KiCad has it, and on the net KiCad has it on
        const B = globalThis.BoardCore, board = B.normaliseBoard(design.board), skip = new Set(["frame", "note", "ground", "offsheet", "rail", "scope"]);
        const ids = new Map(); let nn = 1; const netNo = r => { if (!ids.has(r)) ids.set(r, nn++); return ids.get(r); };
        const gnd = design.comps.find(c => c.type === "ground"), g0 = gnd ? N.get(gnd.id + ":G") : null; if (g0 !== null) ids.set(g0, 0);
        const nl = { names: g0 !== null ? { 0: "GND" } : {}, parts: design.comps.filter(c => !skip.has(c.type)).map(c => ({ id: c.id, type: c.type, label: c.label, params: { ...L.LIB[c.type].defaults, ...c.params }, pins: compPins(c).map(p => ({ id: p.id, net: netNo(N.get(c.id + ":" + p.id)) })) })) };
        const model = B.model(board, B.withHeaters(nl, board.rules)), pcb = K.readPcb(files[base + ".kicad_pcb"]);
        const want = new Map();
        pcb.footprints.forEach(f => f.pads.forEach(p => { const a = f.a * Math.PI / 180; const k = f.ref + ":" + p.num; if (!want.has(k)) want.set(k, []); want.get(k).push([f.x + p.x * Math.cos(a) + p.y * Math.sin(a) - report.board.origin[0], f.y - p.x * Math.sin(a) + p.y * Math.cos(a) - report.board.origin[1], p.net]); }));
        let off = 0, pads = 0, netBad = 0, noNet = 0; const a2k = new Map(), k2a = new Map();
        model.pads.forEach(p => {
          if (/^M\d+$/.test(p.num)) return;
          const w = (want.get(p.ref + ":" + p.num) || []).find(q => Math.hypot(q[0] - p.x, q[1] - p.y) < 0.02); pads++;
          if (!w) { off++; if (process.env.V) console.log("   pad off:", p.ref, p.num, p.x, p.y, JSON.stringify(want.get(p.ref + ":" + p.num))); return; }
          if (p.net === null) { if (w[2]) { noNet++; if (process.env.V) console.log("   pad without net:", p.ref, p.num, w[2]); } return; }
          if (!w[2]) return;
          if (!a2k.has(p.net)) a2k.set(p.net, w[2]); else if (a2k.get(p.net) !== w[2]) { netBad++; if (process.env.V) console.log("   pad net:", p.ref, p.num, w[2], "vs", a2k.get(p.net)); }
          if (!k2a.has(w[2])) k2a.set(w[2], p.net); else if (k2a.get(w[2]) !== p.net) { netBad++; if (process.env.V) console.log("   pad net split:", p.ref, p.num, w[2]); }
        });
        const conn = B.connectivity(board, model.pads), shorts = (conn.shorts || []).length;
        console.log(`     board: ${pads} pads, ${off} off place, ${netBad} on another net, ${noNet} without a net, ${shorts} shorts, ${conn.unrouted} open`);
        if (off || netBad) bad++;
      }
      if (process.env.V) report.notes.forEach(n => console.log("   · " + n));
    }
  }
  process.exit(bad ? 1 : 0);
}
