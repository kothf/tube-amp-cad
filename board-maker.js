/* Board-maker presets (Board: Export ▾ → For the board maker…). One ZIP ready to upload to a
   chosen maker: the Gerbers and drill files under the maker's names, its BOM and placement (CPL)
   files in its columns, with rotations turned to the maker's zero; an IPC-D-356 netlist for the
   bare-board test; and a check of the board against the maker's published limits.
   The makers are data (MAKERS): another one is a new entry. Needs BoardCore and BoardFab. */
(function (root) {
  "use strict";
  const B = () => root.BoardCore, F = () => root.BoardFab;

  // ---------------------------------------------------------------------------
  // The makers and their limits (standard FR-4 service, as published on their capability pages;
  // read 2026-11-22). L: the board's copper layer count.
  // ---------------------------------------------------------------------------
  const MAKERS = {
    generic: {
      name: "Generic", note: "KiCad's file names; placement rotations at the IPC-7351 zero (KiCad's)",
      gerber: "kicad", bom: "generic", cpl: "generic", limits: null
    },
    jlcpcb: {
      name: "JLCPCB", url: "https://jlcpcb.com/capabilities/pcb-capabilities", note: "Protel file names (.GTL, .GBL…), BOM with LCSC Part #, CPL with JLCPCB's rotations",
      gerber: "protel", bom: "jlcpcb", cpl: "jlcpcb",
      limits: L => ({ track: L > 2 ? 0.09 : 0.1, gap: L > 2 ? 0.09 : 0.1, drill: L === 1 ? 0.3 : 0.15, maxDrill: 6.3, viaDrill: 0.15, viaPad: 0.25,
        ring: L > 2 ? 0.15 : 0.18, padHoleGap: 0.45, viaHoleGap: 0.2, edge: 0.2, npth: 0.5, min: [3, 3],
        max: L <= 1 ? [606, 510] : L <= 2 ? [670, 600] : L <= 4 ? [663, 593] : [656, 586], layers: 32 })
    },
    pcbway: {
      name: "PCBWay", url: "https://www.pcbway.com/capabilities.html", note: "KiCad's file names, BOM with maker and part number, centroid file",
      gerber: "kicad", bom: "pcbway", cpl: "pcbway",
      limits: L => ({ track: 0.1, gap: 0.1, drill: 0.15, maxDrill: 6.0, viaDrill: 0.15, viaPad: 0.45, ring: 0.15, padHoleGap: 0.4, viaHoleGap: 0.28, edge: 0.25, npth: 0.2,
        min: [3, 3], max: L <= 2 ? [600, 1200] : [560, 1150], layers: 14 })
    }
  };
  const limitsOf = (maker, L) => { const m = MAKERS[maker]; return m && m.limits ? m.limits(L) : null; };
  const layersOf = board => (B().copperOf ? B().copperOf(board).length : 2);

  // ---------------------------------------------------------------------------
  // Rotations. The app's SOT-23, SOT-223, SOT-89 and DPAK footprints have their pins at the
  // bottom; KiCad's (the IPC-7351 zero) have them at the left: a quarter turn apart. JLCPCB's zero
  // differs again for some packages (the rotations of JLCKicadTools' cpl_rotations_db.csv, by
  // KiCad footprint name).
  // ---------------------------------------------------------------------------
  const APP_TO_IPC = () => F().APP_TO_IPC;
  const JLC_FIX = [[/^SOT-223/, 180], [/^SOT-23/, -90], [/^SOT-89/, 180], [/^TSOT-23/, 180], [/^SOT-3[56]3/, 180], [/^SOT-143/, 180], [/^SC-74-6/, 180],
    [/^(LQFP|TQFP|TSSOP|SSOP|HTSSOP|DFN|VSON|TSOP-6|UDFN|USON)-?/, 270], [/^SOP-4_/, 0], [/^SOP-18_/, 0], [/^SOP-/, 270], [/^SOIC-/, 270], [/^SO-14/, -90],
    [/^VSSOP-8_3\.0x3\.0mm/, 270], [/^VSSOP-8_/, 180], [/^VSSOP-10_/, 270], [/^CP_EIA-/, 180], [/^CP_Elec_/, 180], [/^(.*?_|V)?QFN-/, 270], [/^TO-277/, 90]];
  // a footprint's name as KiCad calls the same package (what the makers' tables go by)
  function kicadName(fp) {
    const n = String(fp || "").replace(/^(LIB|KICAD):/, "").replace(/^.*:/, "");
    let m;
    if ((m = /^CHIP-(\d{4})$/.exec(n))) return "R_" + m[1];
    if ((m = /^LED-(\d{4})$/.exec(n))) return "LED_" + m[1];
    if ((m = /^CP-SMD-D([\d.]+)$/.exec(n))) return "CP_Elec_" + m[1] + "x";
    if ((m = /^(SOT-(?:23|223|89))(-|$)/.exec(n))) return m[1];
    if (/^DPAK(-|$)/.test(n)) return "TO-252-2";
    if (/^D2PAK(-|$)/.test(n)) return "TO-263-2";
    if (/^SMA$|^SMB$|^SMC$/.test(n)) return "D_" + n;
    return n;
  }
  // a package's short name for a BOM (0805, SOT-23, SOIC-8, TO-220)
  function packageName(fp) {
    const n = String(fp || "").replace(/^(LIB|KICAD):/, ""), k = kicadName(fp);
    let m;
    if ((m = /^(?:R|LED)_(\d{4})$/.exec(k))) return m[1];
    if ((m = /^CP_Elec_([\d.]+)x$/.exec(k))) return "SMD electrolytic D" + m[1] + "mm";
    if ((m = /^D_(SM[ABC])$/.exec(k))) return m[1];
    if (/^TO-2(52|63)/.test(k)) return k.replace(/-2$/, "");
    return n.replace(/-(BEC|BCE|CBE|ECB|EBC|CEB|GSD|GDS|DSG|SGD|KRA|RAK|IOG|IGO|OGI|GIO|GOI|OIG)$/, "");
  }
  const norm = r => ((Math.round(r) % 360) + 360) % 360;
  /** The rotation (degrees, counter-clockwise, seen from the top) a maker's placement file wants
      for a part g: the app's quarter turns, turned to the IPC zero, then to the maker's own,
      then the part's own offset (board part rotFix). A bottom part is mirrored, as in KiCad. */
  function rotationFor(g, maker, bp) {
    const P = g.place || {}, name = String(g.fp && g.fp.name || "").replace(/^(LIB|KICAD):/, "");
    const app = ((P.rot || 0) & 3) * 90 + ((APP_TO_IPC().find(([re]) => re.test(name)) || [null, 0])[1]);
    const fix = maker === "jlcpcb" ? ((JLC_FIX.find(([re]) => re.test(kicadName(name))) || [null, 0])[1]) : 0;
    const own = bp && isFinite(+bp.rotFix) ? +bp.rotFix : 0;
    const r = app + fix;
    return norm((P.side === "B" ? 360 - r : r) + own);
  }
  // the land pattern's centre (the pads' extents), as IPC-7351 puts a part's centroid, y up from the board's bottom left
  function centroid(board, g) {
    const b = g.fp.pads, ext = (k, d) => [Math.min(...b.map(p => p[k] - p[d] / 2)), Math.max(...b.map(p => p[k] + p[d] / 2))];
    if (!b.length) return [g.place.x, board.outline.h - g.place.y];
    const [x0, x1] = ext("x", "w"), [y0, y1] = ext("y", "h"), [x, y] = B().place([(x0 + x1) / 2, (y0 + y1) / 2], g.place);
    return [x, board.outline.h - y];
  }

  // ---------------------------------------------------------------------------
  // BOM and placement in each maker's columns
  // ---------------------------------------------------------------------------
  const csvq = s => { s = String(s === undefined || s === null ? "" : s); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = rows => rows.map(r => r.map(csvq).join(",")).join("\r\n") + "\r\n";
  // a value for a maker's BOM: plain ASCII, ohms as R (10R, 4k7 stays as typed)
  const value = v => F().ascii(String(v || "").replace(/([kKMG])Ω/g, "$1").replace(/(\d)Ω/g, "$1R").replace(/Ω/g, "R"));
  const refCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  /** The parts the maker assembles: "smd" the surface-mount ones, "all" every part on the board, "none" none */
  function assembled(board, model, asm) {
    if (asm === "none") return [];
    const keep = F().placedParts(board, model);
    return model.parts.filter(g => keep.has(g.key) && g.fp && g.place && (asm === "all" || g.fp.smd)).sort((a, b) => refCmp(a.ref, b.ref));
  }
  const paramsOf = g => (g.members && g.members[0] && g.members[0].params) || {};
  // one BOM line per value, package, part number and LCSC number
  function bomLines(parts) {
    const lines = new Map();
    parts.forEach(g => {
      const p = paramsOf(g), pn = String(p.partno || "").trim(), lcsc = String(p.lcsc || "").trim().toUpperCase();
      const k = [value(g.value), g.fp.name, pn, lcsc].join("\u0001");
      if (!lines.has(k)) lines.set(k, { refs: [], value: value(g.value), fp: g.fp.name, pkg: packageName(g.fp.name), pn, lcsc, smd: !!g.fp.smd, maker: (g.mpn && g.mpn.maker) || "", type: g.type });
      lines.get(k).refs.push(g.ref);
    });
    return [...lines.values()].sort((a, b) => refCmp(a.refs[0], b.refs[0]));
  }
  function bomFile(maker, parts) {
    const L = bomLines(parts);
    if (maker === "jlcpcb") return csv([["Comment", "Designator", "Footprint", "LCSC Part #"]].concat(L.map(l => [l.pn ? `${l.value} ${l.pn}` : l.value, l.refs.join(","), l.pkg, l.lcsc])));
    if (maker === "pcbway") return csv([["Item #", "Designator", "Qty", "Manufacturer", "Mfg Part #", "Description / Value", "Package/Footprint", "Type", "Your Instructions / Notes"]]
      .concat(L.map((l, i) => [i + 1, l.refs.join(","), l.refs.length, l.maker, l.pn, l.value, l.pkg, l.smd ? "SMD" : "THT", l.lcsc ? "LCSC " + l.lcsc : ""])));
    return csv([["Item", "Qty", "Designators", "Value", "Footprint", "Part number", "LCSC #", "Type"]].concat(L.map((l, i) => [i + 1, l.refs.length, l.refs.join(","), l.value, l.pkg, l.pn, l.lcsc, l.smd ? "SMD" : "THT"])));
  }
  function cplFile(maker, board, parts) {
    const f4 = v => (+v).toFixed(4);
    const rows = parts.map(g => { const [x, y] = centroid(board, g); return { g, x: f4(x), y: f4(y), r: rotationFor(g, maker, board.parts[g.key]), side: g.place.side === "B" ? "Bottom" : "Top" }; });
    if (maker === "jlcpcb") return csv([["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"]].concat(rows.map(o => [o.g.ref, value(o.g.value), packageName(o.g.fp.name), o.x, o.y, o.r, o.side])));
    if (maker === "pcbway") return csv([["Designator", "Mid X", "Mid Y", "Layer", "Rotation"]].concat(rows.map(o => [o.g.ref, o.x, o.y, o.side, o.r])));
    return csv([["Ref", "Val", "Package", "PosX", "PosY", "Rot", "Side"]].concat(rows.map(o => [o.g.ref, value(o.g.value), o.g.fp.name, o.x, o.y, o.r, o.side.toLowerCase()])));
  }

  // ---------------------------------------------------------------------------
  // IPC-D-356 netlist: fixed 80-column records, one per pad and via (317 drilled, 327 surface),
  // CUST 0 units (0.0001 inch), y up from the board's bottom left; nets longer than 14
  // characters get an NNAME alias. Read back by readIpc356 (the tests, and to check a file).
  // ---------------------------------------------------------------------------
  const IN = v => Math.round(v / 25.4 * 1e4);
  const pad = (s, n) => String(s).slice(0, n).padEnd(n);
  const num = (v, n) => String(Math.max(0, Math.min(10 ** n - 1, v))).padStart(n, "0");
  const coord = v => (v < 0 ? "-" : "+") + num(Math.abs(v), 6);
  function ipc356(board, model, meta) {
    const H = board.outline.h, L = layersOf(board), keep = F().placedParts(board, model), out = [], alias = new Map();
    const netText = n => {
      let s = F().ascii(String(n === undefined || n === null || n === "" ? "N/C" : n)).replace(/\s+/g, "_") || "N/C";
      if (s.length <= 14) return s;
      if (!alias.has(s)) alias.set(s, "NNAME" + (alias.size + 1));
      return alias.get(s);
    };
    const nameOf = net => (net === null || net === undefined || net < 0 ? "N/C" : (model.names && model.names[net]) || "N" + net);
    const rec = (kind, net, ref, pin, mid, drill, plated, access, x, y, w, h, mask) =>
      kind + pad(netText(net), 14) + "   " + pad(ref, 6) + "-" + pad(pin, 4) + (mid ? "M" : " ") +
      (drill ? "D" + num(IN(drill), 4) + (plated ? "P" : "U") : "      ") + "A" + num(access, 2) +
      "X" + coord(IN(x)) + "Y" + coord(IN(H - y)) + "X" + num(IN(w), 4) + "Y" + num(IN(h), 4) + "R000" + " " + "S" + mask;
    model.pads.forEach(p => {
      if (!keep.has(p.part)) return;
      const bottom = p.smd && p.layers && p.layers[0] === "B.Cu", net = p.netName || nameOf(p.net);
      out.push(p.smd ? rec("327", net, p.ref, p.num, false, 0, false, bottom ? L : 1, p.x, p.y, p.w, p.h, bottom ? 2 : 1)
        : rec("317", net, p.ref, p.num, false, p.drill, true, 0, p.x, p.y, p.w, p.h, 0));
    });
    const R = board.rules || {};
    board.vias.forEach(v => { const d = v.pad || R.viaPad, net = typeof v.net === "string" ? v.net : nameOf(v.net); out.push(rec("317", net, "VIA", "", true, v.drill || R.viaDrill, true, 0, v.x, v.y, d, d, R.tentVias === false ? 0 : 3)); });
    (board.holes || []).filter(h => h.plated).forEach((h, i) => out.push(rec("317", h.net || "N/C", "MH" + (i + 1), "1", false, h.d, true, 0, h.x, h.y, h.ring || h.d + 0.6, h.ring || h.d + 0.6, 0)));
    const head = [`C  IPC-D-356 netlist from Tube Amp CAD ${F().ascii((meta && meta.version) || "")}`.trimEnd(), `C  ${F().ascii((meta && meta.title) || "")}`.trimEnd(),
      `P  JOB   ${F().ascii((meta && meta.title) || (meta && meta.base) || "board")}`.slice(0, 80), "P  CODE  00", "P  UNITS CUST 0", "P  DIM   N", "P  VER   IPC-D-356", "P  IMAGE PRIMARY"];
    alias.forEach((a, full) => head.push(("P  " + pad(a, 11) + full).slice(0, 80)));
    return head.concat(["C"], out, ["999"]).join("\r\n") + "\r\n";
  }
  /** An IPC-D-356 file read back: [{ kind, net, ref, pin, drill (mm), x, y (mm, y up), access }] */
  function readIpc356(text) {
    const alias = {}, recs = [];
    text.split(/\r?\n/).forEach(l => {
      let m;
      if ((m = /^P {2}(NNAME\d+)\s+(.*)$/.exec(l))) { alias[m[1]] = m[2].trim(); return; }
      if (!/^3[12]7/.test(l)) return;
      const net = l.slice(3, 17).trim(), d = l.slice(32, 38), mm = s => +s / 1e4 * 25.4;
      recs.push({ kind: l.slice(0, 3), net: alias[net] || net, ref: l.slice(20, 26).trim(), pin: l.slice(27, 31).trim(), mid: l[31] === "M", drill: d[0] === "D" ? mm(d.slice(1, 5)) : 0,
        access: +l.slice(39, 41), x: mm(l.slice(42, 49)), y: mm(l.slice(50, 57)), w: mm(l.slice(58, 62)), h: mm(l.slice(63, 67)), mask: +l.slice(73, 74) });
    });
    return recs;
  }

  // ---------------------------------------------------------------------------
  // The check against the maker's limits: each problem with where it is on the board
  // ---------------------------------------------------------------------------
  /** { items: [{ bad (true: the maker cannot make it; false: a warning), msg, x, y }], limits } */
  function check(board, model, maker, drc) {
    const L = layersOf(board), lim = limitsOf(maker, L), items = [];
    if (!lim) return { items, limits: null };
    const nm = MAKERS[maker].name, mm = v => +(+v).toFixed(3) + " mm", R = board.rules || {}, o = board.outline;
    const add = (bad, msg, x, y) => items.push({ bad, msg, x, y });
    if (L > lim.layers) add(true, `${L} copper layers: ${nm}'s standard service makes up to ${lim.layers}`);
    const dims = [o.w, o.h].sort((a, b) => a - b), mx = lim.max.slice().sort((a, b) => a - b);
    if (dims[0] < lim.min[0] || dims[1] < lim.min[1]) add(true, `The board is ${mm(o.w)} × ${mm(o.h)}: ${nm} needs at least ${lim.min[0]} × ${lim.min[1]} mm`, o.w / 2, o.h / 2);
    if (dims[0] > mx[0] || dims[1] > mx[1]) add(true, `The board is ${mm(o.w)} × ${mm(o.h)}: ${nm}'s largest ${L}-layer board is ${lim.max[0]} × ${lim.max[1]} mm`, o.w / 2, o.h / 2);
    // the geometry: tracks, drills, rings, holes too close
    board.tracks.forEach(t => { if (t.w < lim.track - 1e-9) add(true, `Track ${mm(t.w)} wide on ${t.layer}: ${nm} makes ${mm(lim.track)} and wider`, (t.pts[0][0] + t.pts[1][0]) / 2, (t.pts[0][1] + t.pts[1][1]) / 2); });
    const keep = F().placedParts(board, model), holes = [];
    model.pads.forEach(p => {
      if (!keep.has(p.part) || p.smd || !p.drill) return;
      holes.push({ x: p.x, y: p.y, d: p.drill, via: false, what: `${p.ref} pad ${p.num}` });
      if (p.drill < lim.drill - 1e-9) add(true, `${p.ref} pad ${p.num}: drill ${mm(p.drill)}, ${nm}'s smallest is ${mm(lim.drill)}`, p.x, p.y);
      if (p.drill > lim.maxDrill + 1e-9) add(false, `${p.ref} pad ${p.num}: hole ${mm(p.drill)} is over ${nm}'s ${mm(lim.maxDrill)} drill: it is routed (may cost more)`, p.x, p.y);
      const ring = (Math.min(p.w, p.h) - p.drill) / 2;
      if (ring < lim.ring - 1e-9) add(true, `${p.ref} pad ${p.num}: annular ring ${mm(ring)}, ${nm} needs ${mm(lim.ring)}`, p.x, p.y);
    });
    board.vias.forEach(v => {
      const d = v.drill || R.viaDrill, pd = v.pad || R.viaPad;
      holes.push({ x: v.x, y: v.y, d, via: true, what: "a via" });
      if (d < lim.viaDrill - 1e-9) add(true, `Via drill ${mm(d)}: ${nm}'s smallest is ${mm(lim.viaDrill)}`, v.x, v.y);
      if (pd < lim.viaPad - 1e-9) add(true, `Via pad ${mm(pd)}: ${nm}'s smallest is ${mm(lim.viaPad)}`, v.x, v.y);
    });
    (board.holes || []).forEach(h => {
      holes.push({ x: h.x, y: h.y, d: h.d, via: false, what: `the mounting hole Ø${+h.d}` });
      if (!h.plated && h.d < lim.npth - 1e-9) add(true, `Mounting hole Ø${mm(h.d)} not plated: ${nm}'s smallest is ${mm(lim.npth)}`, h.x, h.y);
      if (h.d > lim.maxDrill + 1e-9) add(false, `Mounting hole Ø${mm(h.d)} is over ${nm}'s ${mm(lim.maxDrill)} drill: it is routed (may cost more)`, h.x, h.y);
    });
    (model.holes || []).forEach(h => { if (keep.has(h.part)) holes.push({ x: h.x, y: h.y, d: h.d, via: false, what: "a part's peg hole" }); });
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j], gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.d + b.d) / 2, need = a.via && b.via ? lim.viaHoleGap : lim.padHoleGap;
      if (gap < need - 1e-9 && gap > -Math.min(a.d, b.d) / 2) add(true, `Holes ${mm(Math.max(0, gap))} apart (${a.what} and ${b.what}): ${nm} needs ${mm(need)}`, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    // the copper gaps: the board check measures them by the design rules, so a rule below the maker's limit lets through what it cannot make
    if (R.clearance < lim.gap - 1e-9) add(false, `Design rules allow gaps of ${mm(R.clearance)}: ${nm} needs ${mm(lim.gap)}. Press Use maker's limits`);
    if (R.minTrack < lim.track - 1e-9) add(false, `Design rules allow tracks of ${mm(R.minTrack)}: ${nm} needs ${mm(lim.track)}. Press Use maker's limits`);
    if (R.edgeClearance < lim.edge - 1e-9) add(false, `Design rules allow copper ${mm(R.edgeClearance)} from the edge: ${nm} needs ${mm(lim.edge)}. Press Use maker's limits`);
    (drc || []).filter(d => ["clearance", "short", "edge", "width", "annular", "drill", "viapad"].includes(d.kind)).forEach(d => add(true, `Board check: ${d.msg}`, d.x, d.y));
    // one line per kind of problem is enough to read: past 12 of one sort, the rest counted
    const seen = new Map(), kept = [];
    items.forEach(it => { const k = it.msg.replace(/[\d.]+/g, "#").replace(/^\S+ pad \S+/, "pad"); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n <= 12) kept.push(it); else if (n === 13) kept.push({ bad: it.bad, msg: "… and more like the line above", x: it.x, y: it.y }); });
    return { items: kept, limits: lim };
  }
  /** Raise the design rules to the maker's limits where they are below them (never lowers a rule):
      the names of the rules changed */
  function useLimits(rules, maker, L) {
    const lim = limitsOf(maker, L), done = [];
    if (!lim) return done;
    [["minTrack", lim.track], ["track", lim.track], ["power", lim.track], ["clearance", lim.gap], ["edgeClearance", lim.edge], ["minDrill", lim.drill], ["minAnnular", lim.ring], ["viaDrill", lim.viaDrill], ["viaPad", Math.max(lim.viaPad, (rules.viaDrill > lim.viaDrill ? rules.viaDrill : lim.viaDrill) + 2 * lim.ring)]]
      .forEach(([k, v]) => { if (!(rules[k] >= v - 1e-9)) { rules[k] = +v.toFixed(3); done.push(k); } });
    return done;
  }

  // ---------------------------------------------------------------------------
  // The files
  // ---------------------------------------------------------------------------
  const PROTEL = { F_Cu: "GTL", B_Cu: "GBL", F_Mask: "GTS", B_Mask: "GBS", F_Silkscreen: "GTO", B_Silkscreen: "GBO", F_Paste: "GTP", B_Paste: "GBP", Edge_Cuts: "GKO" };
  const FILES = ["gerber", "drill", "bom", "cpl", "ipc", "readme", "pdf"];
  /** The ZIP's files: { name: text | bytes }. opts: { maker, asm ("none"|"smd"|"all"), files: [FILES ids], meta, fills, pdf: () => bytes } */
  function makerFiles(board, model, opts) {
    const maker = MAKERS[opts.maker] ? opts.maker : "generic", M = MAKERS[maker], want = new Set(opts.files || FILES), meta = opts.meta || {}, base = meta.base || "board";
    const fab = F().fabFiles(board, model, opts.fills || [], meta), out = {};
    Object.entries(fab).forEach(([name, text]) => {
      const sfx = name.slice(base.length + 1);
      if (/\.gbr$/.test(name)) {
        if (!want.has("gerber")) return;
        const k = sfx.replace(/\.gbr$/, ""), inner = /^In(\d+)_Cu$/.exec(k);
        out[M.gerber === "protel" ? `${base}.${inner ? "G" + inner[1] : PROTEL[k] || k}` : name] = text;
      } else if (/\.drl$/.test(name)) { if (want.has("drill")) out[name] = text; }
    });
    const parts = assembled(board, model, opts.asm || "smd");
    if (parts.length && want.has("bom")) out[`${base}-BOM-${M.name}.csv`] = bomFile(maker, parts);
    if (parts.length && want.has("cpl")) out[`${base}-${maker === "pcbway" ? "centroid" : "CPL"}-${M.name}.csv`] = cplFile(maker, board, parts);
    if (want.has("ipc")) out[`${base}.ipc`] = ipc356(board, model, meta);
    if (want.has("pdf") && opts.pdf) { try { out[`${base}-assembly.pdf`] = opts.pdf(); } catch (e) { /* no PDF writer: left out */ } }
    if (want.has("readme")) {
      const lines = String(fab[`${base}-README.txt`] || "").split("\n"), at = lines.findIndex(l => /^Files: /.test(l)), body = lines.slice(0, at < 0 ? lines.length : at);
      const asm = opts.asm === "none" || !parts.length ? "No assembly: the files are for the bare board." : `Assembly (${opts.asm === "all" ? "surface-mount and through-hole" : "surface-mount"} parts): ${parts.length} parts in ${bomLines(parts).length} BOM lines; placement rotations are ${maker === "jlcpcb" ? "turned to JLCPCB's zero for its library (check its preview)" : "at the IPC-7351 zero (KiCad's)"}. The other parts are fitted by hand.`;
      out[`${base}-README.txt`] = body.concat([`Prepared for ${M.name}${M.url ? " (" + M.url + ")" : ""}: ${M.note}.`, asm, "IPC-D-356 netlist: " + base + ".ipc, for the bare-board electrical test.", "",
        "Files: " + Object.keys(out).concat([`${base}-README.txt`]).join(", "), ""]).join("\n");
    }
    return out;
  }

  root.BoardMaker = { MAKERS, FILES, limitsOf, layersOf, kicadName, packageName, rotationFor, centroid, assembled, bomLines, bomFile, cplFile, ipc356, readIpc356, check, useLimits, makerFiles, JLC_FIX };
})(typeof window !== "undefined" ? window : globalThis);
