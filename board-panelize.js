/* =============================================================================
   BOARD DESIGN — panels (no DOM, Node-testable). Several copies of a board, or several
   different boards, on one panel for the board maker: rails along the edges, the boards held
   in by tabs with mouse bites (a row of small holes to snap them out) or cut apart along
   V-score lines, fiducials for the assembly machine's camera and tooling holes, and the
   Gerber, drill and placement files of the whole panel.

   A piece is one board's manufacturing data, its corner at (0, 0), mm with y down:
     { name, w, h, layers: { "F.Cu": ops, ... }, loops: [[[x, y]...]...] (the edge and
       cut-outs, closed), drills: { pth: [[dia, pts, fn]...], npth }, pos: [rows], copper:
       ["F.Cu", ..., "B.Cu"], stackup }
   made from the board being designed (pieceOfBoard) or read back from a Gerber ZIP
   (pieceFromFiles: this program's own files, or KiCad's and most others' without aperture
   macros other than KiCad's RoundRect).
   The panel's settings live in the board document (board.panel):
     { mode: "bites" | "vscore", gap, rails: "tb" | "lr" | "frame" | "none", rail,
       tabW, tabEvery, biteD, bitePitch, biteOff, fid, fidD, fidMask, tool, toolD, inset,
       label, items: [{ src: "this" | piece id, rows, cols, rot }], pieces: { id: piece } }
   layout() places the boards (each item a grid of copies, the items side by side), finds
   the tabs by casting rays from each board's sides across the gap to the rail or the next
   board, and cuts the edges there; files() writes the panel.
   Depends on: board-core.js, board-fab.js.
   ============================================================================= */
(function (root) {
  "use strict";
  const r4 = v => +(+v).toFixed(4);
  const EDGE_W = 0.1;
  const DEFAULTS = {
    mode: "bites", gap: 2, rails: "tb", rail: 5, tabW: 5, tabEvery: 50, biteD: 0.5, bitePitch: 0.75, biteOff: 0,
    fid: true, fidD: 1, fidMask: 2, tool: true, toolD: 3, inset: 5, label: true,
    items: [{ src: "this", rows: 2, cols: 2, rot: 0 }]
  };
  const num = (v, d, lo, hi) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
  /** The panel settings with every field in range (a missing panel: the defaults) */
  function normalise(p) {
    p = p && typeof p === "object" ? p : {};
    const D = DEFAULTS;
    const items = (Array.isArray(p.items) ? p.items : D.items).filter(it => it && it.src).map(it => ({
      src: String(it.src), rows: Math.round(num(it.rows, 1, 1, 50)), cols: Math.round(num(it.cols, 1, 1, 50)), rot: Math.round(num(it.rot, 0, 0, 3)) & 3 }));
    return {
      mode: p.mode === "vscore" ? "vscore" : "bites",
      gap: num(p.gap, D.gap, 0.5, 20),
      rails: ["tb", "lr", "frame", "none"].includes(p.rails) ? p.rails : D.rails,
      rail: num(p.rail, D.rail, 2, 30),
      tabW: num(p.tabW, D.tabW, 1, 30), tabEvery: num(p.tabEvery, D.tabEvery, 10, 500),
      biteD: num(p.biteD, D.biteD, 0.2, 2), bitePitch: num(p.bitePitch, D.bitePitch, 0.3, 3), biteOff: num(p.biteOff, D.biteOff, -1, 1),
      fid: p.fid !== false, fidD: num(p.fidD, D.fidD, 0.5, 3), fidMask: num(p.fidMask, D.fidMask, 1, 6),
      tool: p.tool !== false, toolD: num(p.toolD, D.toolD, 1, 6), inset: num(p.inset, D.inset, 2, 30),
      label: p.label !== false,
      items,
      pieces: p.pieces && typeof p.pieces === "object" ? p.pieces : {}
    };
  }

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------
  function bboxOf(loops) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    loops.forEach(L => L.forEach(([x, y]) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }));
    return { x1, y1, x2, y2 };
  }
  // every point of a piece through f(x, y) → [x, y]; odd quarter turns swap a flash's width and height
  function mapOps(ops, f, swap) {
    return ops.map(op => {
      if (op.t === "flash") { const [x, y] = f(op.x, op.y); return swap && op.shape !== "C" ? { ...op, x, y, w: op.h, h: op.w } : { ...op, x, y }; }
      return { ...op, pts: op.pts.map(p => f(p[0], p[1])) };
    });
  }
  function mapPiece(pc, f, swap) {
    const layers = {};
    Object.entries(pc.layers).forEach(([l, ops]) => { layers[l] = mapOps(ops, f, swap); });
    const dr = t => t.map(([d, pts, fn]) => [d, pts.map(p => f(p[0], p[1])), fn]);
    return { ...pc, layers, loops: pc.loops.map(L => L.map(p => f(p[0], p[1]))), drills: { pth: dr(pc.drills.pth || []), npth: dr(pc.drills.npth || []) }, pos: (pc.pos || []).map(r => { const [x, y] = f(r.x, r.y); return { ...r, x, y }; }) };
  }
  // corner at (0, 0), numbers rounded
  function finish(pc) {
    const b = bboxOf(pc.loops);
    if (!Number.isFinite(b.x1)) throw new Error("the board has no outline");
    const out = mapPiece(pc, (x, y) => [r4(x - b.x1), r4(y - b.y1)], false);
    out.w = r4(b.x2 - b.x1); out.h = r4(b.y2 - b.y1);
    return out;
  }
  /** The board being designed as a piece (the same operations its own Gerbers are made of) */
  function pieceOfBoard(board, model, fills, meta) {
    const C = root.BoardCore, F = root.BoardFab, keep = F.placedParts(board, model), cu = C.copperOf(board);
    const smd = model.parts.filter(g => keep.has(g.key) && g.fp && g.fp.smd), sides = new Set(smd.map(g => (g.place.side || "F")));
    const names = cu.concat(["F.Mask", "B.Mask", "F.SilkS", "B.SilkS"], sides.has("F") ? ["F.Paste"] : [], sides.has("B") ? ["B.Paste"] : []);
    const layers = {};
    names.forEach(l => { layers[l] = F.layerOps(board, model, fills, l); });
    const loops = F.layerOps(board, model, fills, "Edge.Cuts").map(op => op.pts.slice(0, -1));
    const d = F.drills(board, model);
    const pos = smd.length ? parsePos(F.placement(board, model, keep), board.outline.h) : [];
    return finish({ name: (meta && meta.title) || "This board", layers, loops, drills: { pth: d.pth, npth: d.npth }, pos, copper: cu, stackup: board.stackup });
  }
  // a placement CSV (Ref,Val,Package,PosX,PosY,Rot,Side; y up from the board's bottom): rows with y down
  function parsePos(text, H) {
    const lines = String(text).split(/\r?\n/).filter(Boolean);
    if (!lines.length || !/^"?Ref"?,"?Val"?,"?Package"?,"?PosX"?,"?PosY"?,"?Rot"?,"?Side"?/i.test(lines[0])) return [];
    const cells = l => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
    return lines.slice(1).map(l => { const [ref, val, pkg, x, y, rot, side] = cells(l); return { ref, val, pkg, x: +x, y: (H || 0) - +y, rot: +rot || 0, side: /^b/i.test(side || "") ? "bottom" : "top" }; }).filter(r => r.ref && Number.isFinite(r.x) && Number.isFinite(r.y));
  }

  // --- reading Gerber and Excellon files back --------------------------------
  /** A Gerber file as drawing operations (mm, y down: y = −Y): { ops, func, errors } */
  function parseGerber(text) {
    const ops = [], errors = [], ap = new Map(), macros = new Set();
    let dec = 6, scale = 1, pol = "D", cur = null, x = 0, y = 0, interp = 1, region = false, poly = null, rpts = null, func = "";
    const coord = (s) => { if (s === undefined) return undefined; if (s.includes(".")) return parseFloat(s) * scale; return (parseInt(s, 10) / Math.pow(10, dec)) * scale; };
    const endLine = () => { poly = null; };
    const closeRegion = () => { if (rpts && rpts.length >= 3) ops.push({ pol, t: "region", pts: rpts }); rpts = null; };
    // the stream: %...% blocks and words ending in *
    const src = String(text).replace(/\r/g, "");
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\n" || ch === " " || ch === "\t") { i++; continue; }
      if (ch === "%") {
        const j = src.indexOf("%", i + 1); if (j < 0) break;
        const block = src.slice(i + 1, j).replace(/\n/g, ""); i = j + 1;
        block.split("*").filter(Boolean).forEach((w, k) => {
          if (k > 0 && /^AM/.test(block)) return;    // a macro's body
          let m;
          if ((m = /^FS[LT]?[AI]?X(\d)(\d)Y(\d)(\d)/.exec(w))) dec = +m[2];
          else if (w === "MOMM") scale = 1; else if (w === "MOIN") scale = 25.4;
          else if (w === "LPD" || w === "LPC") { if (region) closeRegion(); pol = w[2]; endLine(); }
          else if ((m = /^TF\.FileFunction,(.*)$/.exec(w))) func = m[1];
          else if ((m = /^AM([A-Za-z0-9_.$]+)/.exec(w))) macros.add(m[1]);
          else if ((m = /^ADD(\d+)([A-Za-z0-9_.$]+),?(.*)$/.exec(w))) {
            const d = +m[1], shape = m[2], args = m[3] ? m[3].split("X").map(Number) : [];
            if (shape === "C") ap.set(d, { shape: "C", w: args[0] * scale, h: args[0] * scale });
            else if (shape === "R" || shape === "O") ap.set(d, { shape, w: args[0] * scale, h: (args[1] || args[0]) * scale });
            else if (shape === "P") ap.set(d, { shape: "C", w: args[0] * scale, h: args[0] * scale });
            else if (/^RoundRect/i.test(shape) && args.length >= 9) {
              // KiCad's rounded pad: radius, four corners (x y), rotation: its box
              const rr = args[0], xs = [args[1], args[3], args[5], args[7]], ys = [args[2], args[4], args[6], args[8]];
              ap.set(d, { shape: "O", w: (Math.max(...xs) - Math.min(...xs) + 2 * rr) * scale, h: (Math.max(...ys) - Math.min(...ys) + 2 * rr) * scale, rr: true });
            } else if (macros.has(shape)) { errors.push(`aperture macro ${shape} drawn as a dot`); ap.set(d, { shape: "C", w: (Math.abs(args[0]) || 0.5) * scale, h: (Math.abs(args[0]) || 0.5) * scale }); }
          }
        });
        continue;
      }
      const j = src.indexOf("*", i); if (j < 0) break;
      let w = src.slice(i, j).replace(/\n/g, ""); i = j + 1;
      if (/^G0?4/.test(w)) continue;                     // comment
      if (w === "M02" || w === "M00") break;
      let m;
      while ((m = /^G(\d+)/.exec(w))) {
        const g = +m[1]; w = w.slice(m[0].length);
        if (g === 1 || g === 2 || g === 3) interp = g;
        else if (g === 36) { region = true; rpts = null; endLine(); }
        else if (g === 37) { closeRegion(); region = false; }
      }
      if ((m = /^D(\d+)$/.exec(w)) && +m[1] >= 10) { cur = ap.get(+m[1]) || null; endLine(); continue; }
      if (!w) continue;
      const X = /X([+-]?[\d.]+)/.exec(w), Y = /Y([+-]?[\d.]+)/.exec(w), I = /I([+-]?[\d.]+)/.exec(w), J = /J([+-]?[\d.]+)/.exec(w), D = /D0?([123])$/.exec(w);
      const nx = X ? coord(X[1]) : x, ny = Y ? -coord(Y[1]) : y;
      const op = D ? +D[1] : 1;
      if (op === 2) { x = nx; y = ny; if (region) { closeRegion(); rpts = [[r4(x), r4(y)]]; } else endLine(); continue; }
      if (op === 3) { x = nx; y = ny; if (cur) ops.push({ pol, t: "flash", shape: cur.shape, x: r4(x), y: r4(y), w: r4(cur.w), h: r4(cur.h) }); continue; }
      // D01: a line or an arc from (x, y)
      let path = [[nx, ny]];
      if (interp !== 1) {
        const cx = x + (I ? coord(I[1]) : 0), cy = y - (J ? coord(J[1]) : 0), r = Math.hypot(x - cx, y - cy);
        let a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(ny - cy, nx - cx);
        // G02 is clockwise with y up: counter-clockwise with y down
        const ccwDown = interp === 2;
        if (ccwDown) { while (a1 <= a0 + 1e-9) a1 += 2 * Math.PI; } else { while (a1 >= a0 - 1e-9) a1 -= 2 * Math.PI; }
        const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 18)));
        path = [];
        for (let k = 1; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; path.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
        path[path.length - 1] = [nx, ny];
      }
      if (region) { if (!rpts) rpts = [[r4(x), r4(y)]]; path.forEach(p => rpts.push([r4(p[0]), r4(p[1])])); }
      else if (cur) {
        if (!poly) { poly = { pol, t: "line", w: r4(Math.min(cur.w, cur.h)), pts: [[r4(x), r4(y)]] }; ops.push(poly); }
        path.forEach(p => poly.pts.push([r4(p[0]), r4(p[1])]));
      }
      x = nx; y = ny;
    }
    return { ops, func, errors };
  }
  /** An Excellon drill file: { tools: [[dia, pts]...], plated (true, false or null: not said), errors } */
  function parseExcellon(text) {
    const tools = new Map(), errors = [];
    let scale = 1, cur = null, plated = null, x = 0, y = 0, header = true;
    String(text).split(/\r?\n/).forEach(raw => {
      const l = raw.trim(); if (!l) return;
      let m;
      if (l[0] === ";") { if (/TF\.FileFunction,NonPlated|NPTH/i.test(l)) plated = false; else if (/TF\.FileFunction,Plated/i.test(l)) plated = true; return; }
      if (/^METRIC/.test(l)) scale = 1; else if (/^INCH/.test(l)) scale = 25.4;
      if (l === "%" || l === "M95") { header = false; return; }
      if ((m = /^T(\d+)C([\d.]+)/.exec(l))) { tools.set(+m[1], { d: +(+m[2] * scale).toFixed(3), pts: [] }); return; }
      if ((m = /^T(\d+)$/.exec(l))) { cur = tools.get(+m[1]) || null; return; }
      if (header) return;
      if (/^G85/.test(l) || /G85/.test(l)) { errors.push("slots (G85) are left out"); return; }
      if (/^(G00|G01|M15|M16)/.test(l)) { errors.push("routed paths are left out"); return; }
      const X = /X([+-]?[\d.]+)/.exec(l), Y = /Y([+-]?[\d.]+)/.exec(l);
      if (!X && !Y) return;
      const c = s => (s.includes(".") ? parseFloat(s) : parseInt(s, 10) / 1000) * scale;
      if (X) x = c(X[1]); if (Y) y = c(Y[1]);
      if (cur) cur.pts.push([r4(x), r4(-y)]);
    });
    return { tools: [...tools.values()].filter(t => t.pts.length).map(t => [t.d.toFixed(3), t.pts]), plated, errors };
  }
  // which layer a Gerber file is: from its X2 file function, else its name (KiCad, Protel endings)
  function layerOfFile(name, func, copperN) {
    let m;
    if (func) {
      if ((m = /^Copper,L(\d+),(Top|Bot|Inr)/.exec(func))) return m[2] === "Top" ? "F.Cu" : m[2] === "Bot" ? "B.Cu" : `In${+m[1] - 1}.Cu`;
      if (/^Soldermask,Top/.test(func)) return "F.Mask"; if (/^Soldermask,Bot/.test(func)) return "B.Mask";
      if (/^Legend,Top/.test(func)) return "F.SilkS"; if (/^Legend,Bot/.test(func)) return "B.SilkS";
      if (/^Paste,Top/.test(func)) return "F.Paste"; if (/^Paste,Bot/.test(func)) return "B.Paste";
      if (/^Profile/.test(func)) return "Edge.Cuts";
    }
    const n = name.toLowerCase();
    if (/f[_.]cu\b|\.gtl$/.test(n)) return "F.Cu"; if (/b[_.]cu\b|\.gbl$/.test(n)) return "B.Cu";
    if ((m = /in(\d)[_.]cu\b/.exec(n))) return `In${m[1]}.Cu`; if ((m = /\.g(\d)$/.exec(n))) return `In${m[1]}.Cu`;
    if (/f[_.]mask|\.gts$/.test(n)) return "F.Mask"; if (/b[_.]mask|\.gbs$/.test(n)) return "B.Mask";
    if (/f[_.]silk|\.gto$/.test(n)) return "F.SilkS"; if (/b[_.]silk|\.gbo$/.test(n)) return "B.SilkS";
    if (/f[_.]paste|\.gtp$/.test(n)) return "F.Paste"; if (/b[_.]paste|\.gbp$/.test(n)) return "B.Paste";
    if (/edge[_.]cuts|\.gm1$|\.gko$|outline|profile/.test(n)) return "Edge.Cuts";
    return copperN ? null : null;
  }
  // line pieces into polylines: ends that meet (within 0.02 mm) join
  function chain(lines) {
    const tol = 0.02, eq = (a, b) => Math.abs(a[0] - b[0]) < tol && Math.abs(a[1] - b[1]) < tol;
    const open = lines.map(l => l.slice()), out = [];
    while (open.length) {
      let cur = open.shift(), grew = true;
      while (grew && !eq(cur[0], cur[cur.length - 1])) {
        grew = false;
        for (let k = 0; k < open.length; k++) {
          const l = open[k], a = cur[cur.length - 1];
          if (eq(l[0], a)) cur = cur.concat(l.slice(1));
          else if (eq(l[l.length - 1], a)) cur = cur.concat(l.slice(0, -1).reverse());
          else if (eq(l[l.length - 1], cur[0])) cur = l.slice(0, -1).concat(cur);
          else if (eq(l[0], cur[0])) cur = l.slice(1).reverse().concat(cur);
          else continue;
          open.splice(k, 1); grew = true; break;
        }
      }
      if (cur.length > 2 && eq(cur[0], cur[cur.length - 1])) cur = cur.slice(0, -1);
      out.push(cur);
    }
    return out;
  }
  /** A board's Gerber, drill and placement files ({ name: text }) as a piece; throws with a reason */
  function pieceFromFiles(files, name) {
    const layers = {}, errors = [], pth = new Map(), npth = new Map();
    let edge = [], pos = [];
    Object.entries(files).forEach(([fname, text]) => {
      if (typeof text !== "string") return;
      const low = fname.toLowerCase();
      if (/\.(drl|xln|exc|txt)$/.test(low) && /^M48/m.test(text)) {
        const d = parseExcellon(text), np = d.plated === false || (d.plated === null && /npth|non.?plated/i.test(fname));
        d.tools.forEach(([dia, pts]) => { const m = np ? npth : pth, k = dia; m.set(k, (m.get(k) || []).concat(pts)); });
        d.errors.forEach(e => errors.push(`${fname}: ${e}`));
        return;
      }
      if (/\.csv$/.test(low) && /^"?Ref"?,/i.test(text)) { pos = parsePos(text, 0); return; }
      if (!/%FS|%MO|G04|%ADD/.test(text)) return;
      const g = parseGerber(text), layer = layerOfFile(fname, g.func);
      if (!layer) return;
      g.errors.forEach(e => errors.push(`${fname}: ${e}`));
      if (layer === "Edge.Cuts") edge = edge.concat(g.ops.filter(op => op.t === "line").map(op => op.pts));
      else layers[layer] = (layers[layer] || []).concat(g.ops);
    });
    if (!edge.length) throw new Error("no board outline among the files (Edge_Cuts, Profile, .gm1 or .gko)");
    if (!layers["F.Cu"] && !layers["B.Cu"]) throw new Error("no copper layers among the files");
    const inner = Object.keys(layers).filter(l => /^In\d\.Cu$/.test(l)).sort();
    const copper = ["F.Cu"].concat(inner, ["B.Cu"]);
    copper.forEach(l => { if (!layers[l]) layers[l] = []; });
    const tools = m => [...m.entries()].map(([d, pts]) => [d, pts, "ComponentDrill"]).sort((a, b) => +a[0] - +b[0]);
    const loops = chain(edge).filter(L => L.length >= 3);
    const pc = finish({ name: name || "Board", layers, loops, drills: { pth: tools(pth), npth: tools(npth) }, pos, copper, stackup: { layers: copper.length } });
    pc.warnings = errors;
    return pc;
  }
  /** The files in a ZIP (stored or deflated): Promise of { name: text } */
  async function unzip(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1; for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("not a ZIP file");
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder(), out = {};
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name.endsWith("/")) continue;
      const lo = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), data = b.subarray(lo, lo + csize);
      let raw;
      if (method === 0) raw = data;
      else if (method === 8 && typeof DecompressionStream !== "undefined") raw = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else continue;
      out[name.split("/").pop()] = dec.decode(raw);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------
  // a piece turned by quarter turns (clockwise on the screen) with its corner at (dx, dy)
  function turn(pc, k, dx, dy) {
    k &= 3; const w = pc.w, h = pc.h;
    const f = k === 0 ? (x, y) => [x, y] : k === 1 ? (x, y) => [h - y, x] : k === 2 ? (x, y) => [w - x, h - y] : (x, y) => [y, w - x];
    const out = mapPiece(pc, (x, y) => { const [a, b] = f(x, y); return [r4(a + dx), r4(b + dy)]; }, k % 2 === 1);
    out.pos = out.pos.map(r => ({ ...r, rot: ((r.side === "bottom" ? r.rot + 90 * k : r.rot - 90 * k) % 360 + 360) % 360 }));
    return out;
  }
  const polyArea = P => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; };
  const rectLoop = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  // contour helpers: cumulative lengths, the point at a length, the nearest hit of a ray
  function lengths(c) {
    const P = c.pts, n = c.closed ? P.length : P.length - 1, S = [0];
    for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % P.length]; S.push(S[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
    return S;
  }
  function rayHit(contours, ox, oy, dx, dy, maxT, ok) {
    let best = null;
    contours.forEach((c, ci) => {
      if (ok && !ok(c, ci)) return;
      const P = c.pts, n = c.closed ? P.length : P.length - 1;
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % P.length], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((a[0] - ox) * ey - (a[1] - oy) * ex) / den, u = ((a[0] - ox) * dy - (a[1] - oy) * dx) / den;
        if (t < -1e-9 || t > maxT || u < -1e-9 || u > 1 + 1e-9) continue;
        if (!best || t < best.t) best = { t, ci, seg: i, u, x: ox + dx * t, y: oy + dy * t };
      }
    });
    if (best) { const S = contours[best.ci].S, P = contours[best.ci].pts, a = P[best.seg], b = P[(best.seg + 1) % P.length]; best.s = S[best.seg] + best.u * Math.hypot(b[0] - a[0], b[1] - a[1]); }
    return best;
  }
  // a contour with stretches taken out ([s1, s2] by length; on a closed one the shorter way round)
  function cutContour(c, cuts) {
    const S = c.S, L = S[S.length - 1], P = c.pts;
    if (!cuts.length) return [c.closed ? P.concat([P[0]]) : P.slice()];
    let iv = [];
    cuts.forEach(([a, b]) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      if (c.closed && hi - lo > L / 2) { iv.push([hi, L]); iv.push([0, lo]); } else iv.push([lo, hi]);
    });
    iv.sort((p, q) => p[0] - q[0]);
    const merged = [];
    iv.forEach(v => { const m = merged[merged.length - 1]; if (m && v[0] <= m[1] + 1e-9) m[1] = Math.max(m[1], v[1]); else merged.push(v.slice()); });
    const keep = []; let at = 0;
    merged.forEach(([a, b]) => { if (a > at + 1e-6) keep.push([at, a]); at = Math.max(at, b); });
    if (at < L - 1e-6) keep.push([at, L]);
    const ptAt = s => { let i = 0; while (i < S.length - 2 && S[i + 1] < s) i++; const a = P[i], b = P[(i + 1) % P.length], seg = S[i + 1] - S[i], u = seg > 0 ? (s - S[i]) / seg : 0; return [r4(a[0] + (b[0] - a[0]) * u), r4(a[1] + (b[1] - a[1]) * u)]; };
    const piece = ([a, b]) => { const out = [ptAt(a)]; for (let i = 1; i < S.length - 1; i++) if (S[i] > a + 1e-9 && S[i] < b - 1e-9) out.push(P[i % P.length]); out.push(ptAt(b)); return out; };
    let lines = keep.map(piece);
    // a closed contour's piece through its start joins the one at its end
    if (c.closed && keep.length > 1 && keep[0][0] < 1e-6 && keep[keep.length - 1][1] > L - 1e-6) {
      const first = lines.shift(), last = lines.pop();
      lines.push(last.concat(first.slice(1)));
    }
    return lines;
  }
  /** Where everything goes: { W, H, boards, edges (polylines), tabs, bites, vscore, fids, tools,
      label, warnings, errors } */
  function layout(panel, pieces) {
    const P = normalise(panel), warnings = [], errors = [];
    const vs = P.mode === "vscore", g = vs ? 0 : P.gap, rw = P.rail;
    const railT = P.rails === "tb" || P.rails === "frame", railL = P.rails === "lr" || P.rails === "frame";
    const boards = [];
    let x = railL ? rw + g : 0, maxH = 0;
    const y0 = railT ? rw + g : 0;
    let copperKey = null;
    P.items.forEach(it => {
      const pc = pieces[it.src];
      if (!pc) { warnings.push(`A board on the panel is missing (${it.src === "this" ? "open the circuit's board" : "add its Gerbers again"}).`); return; }
      const ck = (pc.copper || []).join(",");
      if (copperKey === null) copperKey = ck; else if (ck !== copperKey) { errors.push(`${pc.name} has ${pc.copper.length} copper layers, other boards on the panel ${copperKey.split(",").length}: one panel is one layer stack.`); return; }
      const k = it.rot & 3, w = k % 2 ? pc.h : pc.w, h = k % 2 ? pc.w : pc.h;
      for (let r = 0; r < it.rows; r++) for (let c = 0; c < it.cols; c++) boards.push({ src: it.src, name: pc.name, k, x: r4(x + c * (w + g)), y: r4(y0 + r * (h + g)), w, h, pc: turn(pc, k, r4(x + c * (w + g)), r4(y0 + r * (h + g))) });
      x += it.cols * (w + g); maxH = Math.max(maxH, it.rows * (h + g) - g);
    });
    if (!boards.length) return { P, W: 0, H: 0, boards, edges: [], tabs: [], bites: [], vscore: [], fids: [], tools: [], warnings, errors: errors.length ? errors : ["Nothing on the panel yet."] };
    const W = r4(x - g + (railL ? g + rw : 0)), H = r4(y0 + maxH + (railT ? g + rw : 0));
    // the rails
    const rails = [];
    if (P.rails === "tb") rails.push(rectLoop(0, 0, W, rw), rectLoop(0, H - rw, W, H));
    else if (P.rails === "lr") rails.push(rectLoop(0, 0, rw, H), rectLoop(W - rw, 0, W, H));
    else if (P.rails === "frame") rails.push(rectLoop(0, 0, W, H), rectLoop(rw, rw, W - rw, H - rw));
    const edges = [], tabs = [], bites = [], vscore = [];
    if (vs) {
      // V-score: the boards side by side, scored along every line between them, edge to edge
      boards.forEach(b => {
        const outer = b.pc.loops.reduce((m, L) => (polyArea(L) > polyArea(m) ? L : m), b.pc.loops[0]);
        if (b.pc.loops.length > 1 || polyArea(outer) < 0.98 * b.w * b.h) warnings.push(`${b.name} is not a plain rectangle: V-score cuts straight lines, so its shape and cut-outs are routed only where the files show them; mouse bites suit it better.`);
      });
      const xs = new Set(), ys = new Set();
      boards.forEach(b => { xs.add(r4(b.x)); xs.add(r4(b.x + b.w)); ys.add(r4(b.y)); ys.add(r4(b.y + b.h)); });
      [...xs].filter(v => v > 1e-6 && v < W - 1e-6).forEach(v => {
        if (boards.some(b => b.x < v - 1e-6 && b.x + b.w > v + 1e-6)) errors.push(`A V-score line at x = ${v} mm would cut through a board: V-score needs the boards in a grid of the same sizes (or use mouse bites).`);
        vscore.push([[v, 0], [v, H]]);
      });
      [...ys].filter(v => v > 1e-6 && v < H - 1e-6).forEach(v => {
        if (boards.some(b => b.y < v - 1e-6 && b.y + b.h > v + 1e-6)) errors.push(`A V-score line at y = ${v} mm would cut through a board: V-score needs the boards in a grid of the same sizes (or use mouse bites).`);
        vscore.push([[0, v], [W, v]]);
      });
      edges.push(rectLoop(0, 0, W, H).concat([[0, 0]]));
      // cut-outs inside a board are still routed
      boards.forEach(b => { const outer = b.pc.loops.reduce((m, L) => (polyArea(L) > polyArea(m) ? L : m), b.pc.loops[0]); b.pc.loops.forEach(L => { if (L !== outer) edges.push(L.concat([L[0]])); }); });
    } else {
      // mouse bites: every contour (boards' edges and cut-outs, the rails), cut where tabs cross
      const contours = [];
      boards.forEach((b, bi) => {
        const outer = b.pc.loops.reduce((m, L) => (polyArea(L) > polyArea(m) ? L : m), b.pc.loops[0]);
        b.pc.loops.forEach(L => contours.push({ pts: L, closed: true, owner: bi, outer: L === outer }));
      });
      rails.forEach(L => contours.push({ pts: L, closed: true, owner: "rail", outer: true }));
      contours.forEach(c => { c.S = lengths(c); c.cuts = []; });
      const reach = g + 6;
      boards.forEach((b, bi) => {
        const oc = contours.findIndex(c => c.owner === bi && c.outer);
        const sides = [
          { len: b.w, at: s => [b.x + s, b.y - 0.5], dir: [0, 1] }, { len: b.w, at: s => [b.x + s, b.y + b.h + 0.5], dir: [0, -1] },
          { len: b.h, at: s => [b.x - 0.5, b.y + s], dir: [1, 0] }, { len: b.h, at: s => [b.x + b.w + 0.5, b.y + s], dir: [-1, 0] }];
        sides.forEach(sd => {
          if (sd.len < P.tabW + 2) return;
          const n = Math.max(1, Math.round(sd.len / P.tabEvery));
          for (let t = 0; t < n; t++) {
            const c0 = sd.len * (t + 0.5) / n, hits = [];
            for (const off of [-P.tabW / 2, 0, P.tabW / 2]) {
              const [ox, oy] = sd.at(c0 + off), [dx, dy] = sd.dir;
              const p = rayHit(contours, ox, oy, dx, dy, Math.max(b.w, b.h), (c, ci) => ci === oc);
              if (!p) { hits.length = 0; break; }
              const q = rayHit(contours, p.x - dx * 1e-4, p.y - dy * 1e-4, -dx, -dy, reach, c => c.owner !== bi);
              if (!q) { hits.length = 0; break; }
              hits.push({ p, q });
            }
            if (hits.length !== 3) continue;
            const [h1, h0, h2] = hits;
            // straight enough over the tab's width, and all three reach the same contour
            if (Math.abs(h1.p.t - h0.p.t) > 0.3 || Math.abs(h2.p.t - h0.p.t) > 0.3 || h1.q.ci !== h0.q.ci || h2.q.ci !== h0.q.ci || Math.abs(h1.q.t - h0.q.t) > 0.3 || Math.abs(h2.q.t - h0.q.t) > 0.3) continue;
            const other = contours[h0.q.ci].owner;
            // one set of tabs between two boards
            if (other !== "rail" && tabs.some(tb => ((tb.a === bi && tb.b === other) || (tb.a === other && tb.b === bi)) && Math.hypot(tb.cx - (h0.p.x + h0.q.x) / 2, tb.cy - (h0.p.y + h0.q.y) / 2) < P.tabW)) continue;
            contours[oc].cuts.push([h1.p.s, h2.p.s]);
            contours[h0.q.ci].cuts.push([h1.q.s, h2.q.s]);
            const ux = -sd.dir[0], uy = -sd.dir[1];   // out of the board, towards the other side
            tabs.push({ a: bi, b: other, cx: r4((h0.p.x + h0.q.x) / 2), cy: r4((h0.p.y + h0.q.y) / 2), p1: [r4(h1.p.x), r4(h1.p.y)], p2: [r4(h2.p.x), r4(h2.p.y)], q1: [r4(h1.q.x), r4(h1.q.y)], q2: [r4(h2.q.x), r4(h2.q.y)], u: [ux, uy] });
          }
        });
      });
      boards.forEach((b, bi) => { if (!tabs.some(t => t.a === bi || t.b === bi)) errors.push(`${b.name} (board ${bi + 1}) has no tab to hold it: give the panel rails on its side, or check that its edge runs straight somewhere ${P.tabW} mm long.`); });
      contours.forEach(c => cutContour(c, c.cuts).forEach(l => { if (l.length >= 2) edges.push(l); }));
      tabs.forEach(t => { edges.push([t.p1, t.q1]); edges.push([t.p2, t.q2]); });
      // the bites: a row of holes across each end of a tab, on the edge (biteOff: into the board)
      const row = (a, b, sx, sy) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.floor((L - P.biteD) / P.bitePitch) + 1), span = (n - 1) * P.bitePitch;
        for (let k = 0; k < n; k++) { const s = (L - span) / 2 + k * P.bitePitch, u = L > 0 ? s / L : 0; bites.push([r4(a[0] + (b[0] - a[0]) * u + sx), r4(a[1] + (b[1] - a[1]) * u + sy)]); }
      };
      tabs.forEach(t => { row(t.p1, t.p2, -t.u[0] * P.biteOff, -t.u[1] * P.biteOff); row(t.q1, t.q2, t.u[0] * P.biteOff, t.u[1] * P.biteOff); });
    }
    if (vs) rails.length = 0;
    // fiducials and tooling holes on the rails, the panel's name on the top one
    const fids = [], tools = [];
    let label = null;
    const along = P.rails === "lr" ? "v" : "h", has = P.rails !== "none";
    if (has) {
      const need = Math.max(P.tool ? P.toolD + 1.5 : 0, P.fid ? P.fidMask + 1 : 0);
      if (rw < need) warnings.push(`The rails are ${rw} mm wide: fiducials and tooling holes need ${need} mm, so they are left out.`);
      else {
        const c1 = rw / 2, c2 = (along === "h" ? H : W) - rw / 2, L = along === "h" ? W : H, at = (s, c) => (along === "h" ? [r4(s), r4(c)] : [r4(c), r4(s)]);
        if (P.tool) [[P.inset, c1], [L - P.inset, c1], [P.inset, c2], [L - P.inset, c2]].forEach(([s, c]) => tools.push(at(s, c)));
        if (P.fid) { const f = P.inset + (P.tool ? P.toolD / 2 + 4 : 0); [[f, c1], [L - f, c1], [f, c2]].forEach(([s, c]) => fids.push(at(s, c))); }
        if (P.label) {
          const size = Math.min(1.5, rw * 0.4), s0 = P.inset + (P.tool ? P.toolD / 2 + 4 : 0) + (P.fid ? P.fidMask / 2 + 3 : 0);
          label = { x: s0, y: c1, size, rot: along === "h" ? 0 : 1 };
        }
      }
    } else if (P.fid || P.tool) warnings.push("No rails: the panel has no room for fiducials and tooling holes (an assembly house usually wants them).");
    return { P, W, H, boards, rails, edges, tabs, bites, vscore, fids, tools, label, warnings, errors };
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  /** The panel's manufacturing files: { files: { name: text }, lay } (lay.errors: nothing written) */
  function files(panel, pieces, meta) {
    const lay = layout(panel, pieces), C = root.BoardCore, F = root.BoardFab;
    if (lay.errors.length) return { files: null, lay };
    const P = lay.P, base = ((meta && meta.base) || "board") + "-panel", title = `${(meta && meta.title) || "Board"} panel`;
    const first = lay.boards[0].pc, copper = first.copper;
    const pb = { outline: { w: lay.W, h: lay.H }, stackup: C.normaliseStackup({ ...(first.stackup || {}), layers: copper.length }) };
    const all = new Set(); lay.boards.forEach(b => Object.keys(b.pc.layers).forEach(l => all.add(l)));
    const bottomSmd = lay.boards.some(b => b.pc.layers["B.Paste"]);
    const extra = { "F.Cu": [], "F.Mask": [], "B.Mask": [], "F.SilkS": [], "B.Cu": [] };
    lay.fids.forEach(([x, y]) => {
      extra["F.Cu"].push({ pol: "D", t: "flash", shape: "C", x, y, w: P.fidD, h: P.fidD, fn: "FiducialPad,Panel" });
      extra["F.Mask"].push({ pol: "D", t: "flash", shape: "C", x, y, w: P.fidMask, h: P.fidMask });
      if (bottomSmd) { extra["B.Cu"].push({ pol: "D", t: "flash", shape: "C", x, y, w: P.fidD, h: P.fidD, fn: "FiducialPad,Panel" }); extra["B.Mask"].push({ pol: "D", t: "flash", shape: "C", x, y, w: P.fidMask, h: P.fidMask }); }
    });
    lay.tools.forEach(([x, y]) => { const d = r4(P.toolD + 0.2); extra["F.Mask"].push({ pol: "D", t: "flash", shape: "C", x, y, w: d, h: d }); extra["B.Mask"].push({ pol: "D", t: "flash", shape: "C", x, y, w: d, h: d }); });
    let labelText = "";
    if (lay.label) {
      labelText = `${title} ${lay.boards.length}x ${(meta && meta.date) || ""}`.trim();
      const st = C.strokeText(F.ascii(labelText).toUpperCase(), 0, 0, lay.label.size, lay.label.rot, false);
      // left end at the label's place
      const dx = lay.label.rot ? 0 : lay.label.x + st.width / 2, dy = lay.label.rot ? lay.label.x + st.width / 2 : 0;
      st.lines.forEach(l => extra["F.SilkS"].push({ pol: "D", t: "line", w: st.w, pts: l.map(([px, py]) => (lay.label.rot ? [r4(px + lay.label.y), r4(py + dy)] : [r4(px + dx), r4(py + lay.label.y)])) }));
    }
    const SUF = { "F.Cu": "F_Cu", "B.Cu": "B_Cu", "F.Mask": "F_Mask", "B.Mask": "B_Mask", "F.SilkS": "F_Silkscreen", "B.SilkS": "B_Silkscreen", "F.Paste": "F_Paste", "B.Paste": "B_Paste", "Edge.Cuts": "Edge_Cuts" };
    const out = {}, order = copper.concat(["F.Mask", "B.Mask", "F.Paste", "B.Paste", "F.SilkS", "B.SilkS"]).filter(l => all.has(l) || (extra[l] && extra[l].length));
    order.forEach(l => {
      const ops = [];
      lay.boards.forEach(b => (b.pc.layers[l] || []).forEach(op => ops.push(op)));
      (extra[l] || []).forEach(op => ops.push(op));
      out[`${base}-${SUF[l] || l.replace(".", "_")}.gbr`] = F.gerber(ops, l, pb, { ...meta, title });
    });
    out[`${base}-Edge_Cuts.gbr`] = F.gerber(lay.edges.map(pts => ({ pol: "D", t: "line", w: EDGE_W, pts, fn: "Profile" })), "Edge.Cuts", pb, { ...meta, title });
    if (lay.vscore.length) out[`${base}-V_Score.gbr`] = F.gerber(lay.vscore.map(pts => ({ pol: "D", t: "line", w: EDGE_W, pts })), "V-score", pb, { ...meta, title });
    // drills
    const pth = new Map(), npth = new Map(), add = (m, d, fn, pts) => { const k = (+d).toFixed(3) + "|" + fn; m.set(k, (m.get(k) || []).concat(pts)); };
    lay.boards.forEach(b => { (b.pc.drills.pth || []).forEach(([d, pts, fn]) => add(pth, d, fn, pts)); (b.pc.drills.npth || []).forEach(([d, pts, fn]) => add(npth, d, fn, pts)); });
    if (lay.bites.length) add(npth, P.biteD, "MechanicalDrill,Breakout", lay.bites);
    if (lay.tools.length) add(npth, P.toolD, "MechanicalDrill,Tooling", lay.tools);
    const sort = m => [...m.entries()].map(([k, pts]) => { const [d, fn] = k.split("|"); return [d, pts, fn]; }).sort((a, b) => +a[0] - +b[0] || a[2].localeCompare(b[2]));
    const dp = sort(pth), dn = sort(npth);
    out[`${base}-PTH.drl`] = F.excellon(dp, true, pb, { ...meta, title });
    if (dn.length) out[`${base}-NPTH.drl`] = F.excellon(dn, false, pb, { ...meta, title });
    // placement: every copy's parts, each reference with its board's number
    const rows = [];
    lay.boards.forEach((b, bi) => (b.pc.pos || []).forEach(r => rows.push({ ...r, ref: lay.boards.length > 1 ? `${r.ref}-${bi + 1}` : r.ref })));
    if (rows.length) {
      const q = s => `"${String(s).replace(/"/g, "'")}"`, f4 = v => (+v).toFixed(4);
      out[`${base}-pos.csv`] = ["Ref,Val,Package,PosX,PosY,Rot,Side"].concat(rows.map(r => [q(r.ref), q(r.val), q(r.pkg), f4(r.x), f4(lay.H - r.y), f4(r.rot), r.side].join(","))).join("\n") + "\n";
    }
    const kinds = [...new Set(lay.boards.map(b => b.name))];
    out[`${base}-README.txt`] = [`${title} — panel files from Tube Amp CAD ${(meta && meta.version) || ""}`, "",
      `Panel: ${lay.W} × ${lay.H} mm, ${lay.boards.length} board${lay.boards.length > 1 ? "s" : ""} (${kinds.map(n => `${lay.boards.filter(b => b.name === n).length} × ${n}`).join(", ")}), ${copper.length} copper layers.`,
      P.mode === "vscore"
        ? `Boards separated by V-score: ${lay.vscore.length} line${lay.vscore.length === 1 ? "" : "s"} from edge to edge, drawn in ${base}-V_Score.gbr. Score both sides, a third of the thickness each (web about 1/3).`
        : `Boards held by ${lay.tabs.length} tabs ${P.tabW} mm wide across a ${P.gap} mm routed gap; mouse bites Ø${P.biteD} mm at ${P.bitePitch} mm pitch (${lay.bites.length} holes, not plated, in ${base}-NPTH.drl).`,
      P.rails === "none" ? "No rails." : `Rails: ${{ tb: "top and bottom", lr: "left and right", frame: "all round" }[P.rails]}, ${P.rail} mm wide.`,
      lay.fids.length ? `Fiducials: ${lay.fids.length}, Ø${P.fidD} mm copper with a Ø${P.fidMask} mm mask opening, on the top${bottomSmd ? " and bottom" : ""}.` : "No fiducials.",
      lay.tools.length ? `Tooling holes: ${lay.tools.length}, Ø${P.toolD} mm not plated, ${P.inset} mm from the panel's ends.` : "No tooling holes.",
      rows.length ? `Placement file: ${base}-pos.csv, references numbered by board (R1-2 is R1 on board 2).` : "",
      "", "Files: " + Object.keys(out).concat([`${base}-README.txt`]).join(", "), ""].filter(l => l !== undefined).join("\n");
    return { files: out, lay };
  }

  root.BoardPanel = { DEFAULTS, normalise, pieceOfBoard, pieceFromFiles, parseGerber, parseExcellon, parsePos, layerOfFile, chain, unzip, turn, layout, files, cutContour, lengths, rayHit };
})(typeof window !== "undefined" ? window : globalThis);
