/* =============================================================================
   BOARD DESIGN — fabrication outputs (no DOM, Node-testable). Each layer becomes a list
   of drawing operations (the same ones board-core.js makes for copper pours):
     { pol: "D" | "C", t: "flash", shape: "C" | "R" | "O", x, y, w, h }
     { pol, t: "line", w, pts: [[x, y]...] }      { pol, t: "region", pts }
   From them: Gerber RS-274X (X2 file attributes), Excellon drill files, a ZIP for the
   board maker, and PDF prints (1:1 layers, assembly drawing, drill map, toner transfer)
   through pdf-export.js. Board coordinates are mm with y down; the files have y up.
   Depends on: board-core.js; pdf-export.js for the PDFs.
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const SILK_W = 0.15, EDGE_W = 0.1, REF_H = 1.27;
  const r4 = v => +(+v).toFixed(4);

  // parts entirely outside the outline (still waiting below the board) are left out of the outputs
  function placedParts(board, model) {
    const C = B(), o = board.outline, keep = new Set();
    model.parts.forEach(g => {
      if (!g.place || !g.fp) return;
      const c = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(p => C.place(p, g.place));
      if (c.some(([x, y]) => C.edgeDist(x, y, o) >= 0)) keep.add(g.key);
    });
    return keep;
  }
  function partBox(g) {
    const C = B(), pts = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(p => C.place(p, g.place));
    return { x1: Math.min(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), x2: Math.max(...pts.map(p => p[0])), y2: Math.max(...pts.map(p => p[1])) };
  }
  /** Silkscreen of one part in board coordinates: footprint lines, rectangles and circles (as
      polylines), and its reference above it */
  function partSilk(g) {
    const C = B(), P = pt => C.place(pt, g.place).map(r4), ops = [];
    g.fp.silk.forEach(s => {
      let pts;
      if (s.t === "line") pts = [[s.x1, s.y1], [s.x2, s.y2]];
      else if (s.t === "rect") pts = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h], [s.x, s.y]];
      else if (s.t === "circle") {
        const a0 = (s.from || 0), a1 = s.to === undefined ? 360 : s.to, n = Math.max(8, Math.ceil(Math.abs(a1 - a0) / 7.5));
        pts = Array.from({ length: n + 1 }, (_, k) => { const a = (a0 + (a1 - a0) * k / n) * Math.PI / 180; return [s.x + s.r * Math.cos(a), s.y + s.r * Math.sin(a)]; });
      }
      if (pts) ops.push({ pol: "D", t: "line", w: SILK_W, pts: pts.map(P) });
    });
    const b = partBox(g), st = C.strokeText(g.ref, (b.x1 + b.x2) / 2, b.y1 - 0.4 - REF_H / 2, REF_H, 0, g.place.side === "B");
    st.lines.forEach(l => ops.push({ pol: "D", t: "line", w: st.w, pts: l }));
    return ops;
  }
  const textOps = (t, mirror) => { const st = B().strokeText(t.text, t.x, t.y, t.size, t.rot, mirror); return st.lines.map(l => ({ pol: "D", t: "line", w: st.w, pts: l })); };

  /** Drawing operations of a layer: F.Cu, B.Cu (pours, then tracks, pads, vias, text),
      F.Mask, B.Mask (openings), F.SilkS, B.SilkS, Edge.Cuts */
  function layerOps(board, model, fills, layer) {
    const C = B(), R = board.rules, keep = placedParts(board, model), ops = [];
    const pads = model.pads.filter(p => keep.has(p.part));
    if (layer === "F.Cu" || layer === "B.Cu") {
      (fills || []).filter(f => f.layer === layer).forEach(f => ops.push(...f.ops));
      board.tracks.filter(t => t.layer === layer).forEach(t => ops.push({ pol: "D", t: "line", w: t.w, pts: t.pts }));
      pads.forEach(p => ops.push({ pol: "D", ...C.flashOf(p, 0) }));
      board.vias.forEach(v => { const d = v.pad || R.viaPad; ops.push({ pol: "D", t: "flash", shape: "C", x: v.x, y: v.y, w: d, h: d }); });
      board.texts.filter(t => t.layer === layer).forEach(t => ops.push(...textOps(t, layer === "B.Cu")));
    } else if (layer === "F.Mask" || layer === "B.Mask") {
      pads.forEach(p => ops.push({ pol: "D", ...C.flashOf(p, R.maskExpansion || 0) }));
      if (!R.tentVias) board.vias.forEach(v => { const d = (v.pad || R.viaPad) + 2 * (R.maskExpansion || 0); ops.push({ pol: "D", t: "flash", shape: "C", x: v.x, y: v.y, w: r4(d), h: r4(d) }); });
    } else if (layer === "F.SilkS" || layer === "B.SilkS") {
      const side = layer[0];
      model.parts.forEach(g => { if (keep.has(g.key) && (g.place.side || "F") === side) ops.push(...partSilk(g)); });
      board.texts.filter(t => t.layer === layer).forEach(t => ops.push(...textOps(t, side === "B")));
    } else if (layer === "Edge.Cuts") {
      const P = C.outlinePoly(board.outline, 0);
      ops.push({ pol: "D", t: "line", w: EDGE_W, pts: P.concat([P[0]]) });
    }
    return ops;
  }

  // ---------------------------------------------------------------------------
  // Gerber RS-274X, 4.6 mm format, X2 attributes
  // ---------------------------------------------------------------------------
  const FUNC = {
    "F.Cu": ["Copper,L1,Top", "Positive"], "B.Cu": ["Copper,L2,Bot", "Positive"], "F.Mask": ["Soldermask,Top", "Negative"], "B.Mask": ["Soldermask,Bot", "Negative"],
    "F.SilkS": ["Legend,Top", "Positive"], "B.SilkS": ["Legend,Bot", "Positive"], "Edge.Cuts": ["Profile,NP", "Positive"]
  };
  function gerber(ops, layer, board, meta) {
    const H = board.outline.h, X = v => Math.round(v * 1e6), Y = v => Math.round((H - v) * 1e6), f6 = v => (+v).toFixed(6);
    const ap = new Map(), key = op => (op.t === "line" ? `C,${f6(op.w)}` : op.shape === "C" ? `C,${f6(op.w)}` : `${op.shape},${f6(op.w)}X${f6(op.h)}`);
    ops.forEach(op => { if (op.t !== "region" && !ap.has(key(op))) ap.set(key(op), 10 + ap.size); });
    const [func, pol] = FUNC[layer] || ["Other,Drawing", "Positive"];
    const out = [`G04 Tube Amp CAD board: ${String((meta && meta.title) || "board").replace(/[*%]/g, "")} - ${layer}*`,
      `%TF.GenerationSoftware,Tube Amp CAD,Board Design,${(meta && meta.version) || ""}*%`, `%TF.FileFunction,${func}*%`, `%TF.FilePolarity,${pol}*%`,
      "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%", "G01*"];
    ap.forEach((d, k) => { const [s, dims] = k.split(","); out.push(`%ADD${d}${s},${dims}*%`); });
    let lp = "D", cur = -1;
    ops.forEach(op => {
      const p = op.pol === "C" ? "C" : "D";
      if (p !== lp) { out.push(`%LP${p}*%`); lp = p; }
      if (op.t === "region") {
        const P = op.pts; if (P.length < 3) return;
        out.push("G36*", `X${X(P[0][0])}Y${Y(P[0][1])}D02*`);
        P.slice(1).forEach(q => out.push(`X${X(q[0])}Y${Y(q[1])}D01*`));
        out.push(`X${X(P[0][0])}Y${Y(P[0][1])}D01*`, "G37*");
        return;
      }
      const d = ap.get(key(op)); if (d !== cur) { out.push(`D${d}*`); cur = d; }
      if (op.t === "flash") out.push(`X${X(op.x)}Y${Y(op.y)}D03*`);
      else { out.push(`X${X(op.pts[0][0])}Y${Y(op.pts[0][1])}D02*`); op.pts.slice(1).forEach(q => out.push(`X${X(q[0])}Y${Y(q[1])}D01*`)); }
    });
    out.push("M02*");
    return out.join("\n") + "\n";
  }

  /** Holes: plated (pads, vias) and not plated (mounting holes), grouped by diameter */
  function drills(board, model) {
    const keep = placedParts(board, model), R = board.rules, pth = new Map(), npth = new Map();
    const add = (m, d, x, y) => { const k = (+d).toFixed(3); if (!m.has(k)) m.set(k, []); m.get(k).push([x, y]); };
    model.pads.forEach(p => { if (keep.has(p.part)) add(pth, p.drill, p.x, p.y); });
    board.vias.forEach(v => add(pth, v.drill || R.viaDrill, v.x, v.y));
    (board.holes || []).forEach(h => add(npth, h.d, h.x, h.y));
    const sort = m => [...m.entries()].sort((a, b) => +a[0] - +b[0]);
    return { pth: sort(pth), npth: sort(npth) };
  }
  function excellon(tools, plated, board, meta) {
    const H = board.outline.h, f3 = v => (+v).toFixed(3);
    const out = ["M48", `; DRILL file Tube Amp CAD ${(meta && meta.version) || ""} ${(meta && meta.title) || ""}`.trim(), "; FORMAT={-:-/ absolute / metric / decimal}",
      `; #@! TF.FileFunction,${plated ? "Plated,1,2,PTH" : "NonPlated,1,2,NPTH"}`, "FMAT,2", "METRIC"];
    tools.forEach(([d], i) => out.push(`T${i + 1}C${d}`));
    out.push("%", "G90", "G05");
    tools.forEach(([, pts], i) => { out.push(`T${i + 1}`); pts.forEach(([x, y]) => out.push(`X${f3(x)}Y${f3(H - y)}`)); });
    out.push("M30");
    return out.join("\n") + "\n";
  }

  /** All the manufacturing files: { name: text } (KiCad-style names) */
  function fabFiles(board, model, fills, meta) {
    const base = (meta && meta.base) || "board", files = {};
    const L = { "F.Cu": "F_Cu", "B.Cu": "B_Cu", "F.Mask": "F_Mask", "B.Mask": "B_Mask", "F.SilkS": "F_Silkscreen", "B.SilkS": "B_Silkscreen", "Edge.Cuts": "Edge_Cuts" };
    Object.entries(L).forEach(([layer, suffix]) => { files[`${base}-${suffix}.gbr`] = gerber(layerOps(board, model, fills, layer), layer, board, meta); });
    const d = drills(board, model);
    files[`${base}-PTH.drl`] = excellon(d.pth, true, board, meta);
    if (d.npth.length) files[`${base}-NPTH.drl`] = excellon(d.npth, false, board, meta);
    const R = board.rules, st = board.stackup, n = t => t.reduce((s, [, p]) => s + p.length, 0);
    files[`${base}-README.txt`] = [`${(meta && meta.title) || base} — manufacturing files from Tube Amp CAD ${(meta && meta.version) || ""}`, "",
      `Board: ${board.outline.w} × ${board.outline.h} mm${board.outline.r ? `, corner radius ${board.outline.r} mm` : ""}, 2 layers, ${st.thickness} mm FR-4, ${st.copper} µm copper (${st.copper >= 70 ? 2 : 1} oz)`,
      `Smallest track ${Math.min(R.minTrack, ...board.tracks.map(t => t.w))} mm, clearance ${R.clearance} mm (high voltage ${R.hvClearance} mm)`,
      `Holes: ${n(d.pth)} plated (${d.pth.map(t => t[0]).join(", ")} mm)${d.npth.length ? `, ${n(d.npth)} not plated (${d.npth.map(t => t[0]).join(", ")} mm)` : ""}`,
      `Solder mask on both sides${R.tentVias ? ", vias covered" : ""}; silkscreen on the top${board.texts.some(t => t.layer === "B.SilkS") || model.parts.some(g => g.place && g.place.side === "B") ? " and bottom" : ""}.`, "",
      "Files: " + Object.keys(files).concat([`${base}-README.txt`]).join(", "), ""].join("\n");
    return files;
  }

  // ---------------------------------------------------------------------------
  // ZIP (stored, no compression: Gerbers are small and every board maker reads it)
  // ---------------------------------------------------------------------------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const utf8 = s => (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, "utf8")));
  function zip(files, date) {
    const d = date || new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), day = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = []; let off = 0;
    const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    Object.entries(files).forEach(([name, text]) => {
      const nm = utf8(name), data = typeof text === "string" ? utf8(text) : text, crc = crc32(data);
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(day), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(time), ...u16(day), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
      parts.push(Uint8Array.from(head), nm, data); off += head.length + nm.length + data.length;
    });
    const csize = central.reduce((s, a) => s + a.length, 0), n = Object.keys(files).length;
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(csize), ...u32(off), ...u16(0)]);
    const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Painting operations on a canvas 2D context (the screen, or pdf-export's PdfCanvas).
  // clear: "erase" cuts through what is below (screen layers); a colour paints paper.
  // ---------------------------------------------------------------------------
  function paint(ctx, ops, ink, clear) {
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ops.forEach(op => {
      const c = op.pol === "C", erase = c && clear === "erase", col = c ? (erase ? "#000" : clear) : ink;
      if (erase) ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = col; ctx.strokeStyle = col;
      ctx.beginPath();
      if (op.t === "region") { op.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); }
      else if (op.t === "flash") {
        if (op.shape === "R") { ctx.rect(op.x - op.w / 2, op.y - op.h / 2, op.w, op.h); ctx.fill(); }
        else if (op.shape === "C" || Math.abs(op.w - op.h) < 1e-9) { ctx.arc(op.x, op.y, op.w / 2, 0, Math.PI * 2); ctx.fill(); }
        else { const r = Math.min(op.w, op.h) / 2, l = Math.max(op.w, op.h) / 2 - r; ctx.lineWidth = 2 * r; if (op.w >= op.h) { ctx.moveTo(op.x - l, op.y); ctx.lineTo(op.x + l, op.y); } else { ctx.moveTo(op.x, op.y - l); ctx.lineTo(op.x, op.y + l); } ctx.stroke(); }
      } else if (op.t === "line") { ctx.lineWidth = op.w; op.pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); if (op.pts.length === 1) ctx.lineTo(op.pts[0][0] + 1e-3, op.pts[0][1]); ctx.stroke(); }
      if (erase) ctx.globalCompositeOperation = "source-over";
    });
  }

  // ---------------------------------------------------------------------------
  // PDF prints. Board millimetres on the page at 1:1 when the board fits A4 or A3 (with a
  // 50 mm bar to check the printer's scale). PdfCanvas inks: a light colour prints black,
  // a dark one is paper.
  // ---------------------------------------------------------------------------
  const INK = "#ffffff", PAPER = "#000000", PT = 72 / 25.4;
  function pageFor(board) {
    const o = board.outline, sizes = [[297, 210, "A4"], [210, 297, "A4"], [420, 297, "A3"], [297, 420, "A3"]];
    for (const [w, h, n] of sizes) if (o.w + 30 <= w && o.h + 70 <= h) return { w, h, name: n, scale: 1 };
    const s = Math.min((420 - 30) / o.w, (297 - 70) / o.h);
    return { w: 420, h: 297, name: "A3", scale: s };
  }
  function pdfPages(board, model, fills, kind, meta) {
    const PdfExport = root.PdfExport, o = board.outline, pg = pageFor(board), title = (meta && meta.title) || "Board";
    const k = PT * pg.scale, mmW = pg.w / pg.scale, mmH = pg.h / pg.scale;
    const page = { widthPt: pg.w * PT, heightPt: pg.h * PT, k, ox: -(mmW - o.w) / 2, oy: -(mmH - o.h) / 2 - 8 / pg.scale };
    const d = drills(board, model);
    const sheets = kind === "toner"
      ? [["F.Cu", "Top copper — mirrored for toner transfer (toner side onto the top copper)", true], ["B.Cu", "Bottom copper — as seen through from the top, for toner transfer (toner side onto the bottom copper)", false]]
      : [["assembly", "Assembly drawing — top side"], ["F.Cu", "Top copper — seen from the top"], ["B.Cu", "Bottom copper — seen through from the top"], ["drill", "Drill map"]];
    const SYM = ["+", "×", "□", "◇", "△", "○"];
    function header(c, text) {
      c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = INK; c.font = `bold ${3.6 / pg.scale}px monospace`; c.textAlign = "left"; c.textBaseline = "alphabetic";
      const x0 = page.ox + 12 / pg.scale, y0 = page.oy + 14 / pg.scale;
      c.fillText(`${title} — ${text}`, x0, y0);
      c.font = `${2.8 / pg.scale}px monospace`;
      c.fillText(`${o.w} × ${o.h} mm · ${pg.scale === 1 ? "scale 1:1 — print at 100 %, no fit-to-page; the bar must measure 50 mm" : `scaled to ${(pg.scale * 100).toFixed(0)} % (does not fit A3)`} · Tube Amp CAD ${(meta && meta.version) || ""}`, x0, y0 + 5 / pg.scale);
      // the 50 mm check bar under the board
      const by = o.h + 10; c.strokeStyle = INK; c.lineWidth = 0.3; c.lineCap = "butt";
      c.beginPath(); c.moveTo(0, by); c.lineTo(50, by); c.moveTo(0, by - 1.5); c.lineTo(0, by + 1.5); c.moveTo(50, by - 1.5); c.lineTo(50, by + 1.5); c.stroke();
      c.font = `${2.8 / pg.scale}px monospace`; c.fillText("50 mm", 52, by + 1);
      c.restore();
    }
    const holesPaper = c => {   // drill marks: small, to centre the drill
      c.fillStyle = PAPER;
      d.pth.concat(d.npth).forEach(([dia, pts]) => pts.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, Math.min(+dia, 0.7) / 2, 0, Math.PI * 2); c.fill(); }));
    };
    const outline = c => paint(c, layerOps(board, model, fills, "Edge.Cuts"), INK, PAPER);
    function draw(c, i) {
      const [what, text, mirror] = sheets[i];
      header(c, text);
      if (what === "F.Cu" || what === "B.Cu") {
        c.save(); if (mirror) { c.translate(o.w, 0); c.scale(-1, 1); }
        paint(c, layerOps(board, model, fills, what), INK, PAPER); holesPaper(c); outline(c);
        c.restore();
      } else if (what === "assembly") {
        outline(c); paint(c, layerOps(board, model, fills, "F.SilkS"), INK, PAPER);
        c.fillStyle = INK; c.font = "1.1px monospace"; c.textAlign = "center"; c.textBaseline = "middle";
        model.parts.forEach(g => { if (!g.place || g.place.side === "B" || !placedParts(board, model).has(g.key)) return; const b = partBox(g); c.fillText(String(g.value || ""), (b.x1 + b.x2) / 2, b.y2 + 1); });
        const bottom = model.parts.filter(g => g.place && g.place.side === "B").map(g => g.ref);
        if (bottom.length) { c.textAlign = "left"; c.font = "2.4px monospace"; c.fillText(`On the bottom side: ${bottom.join(", ")}`, 0, o.h + 16); }
      } else if (what === "drill") {
        outline(c);
        const tools = d.pth.map(t => [...t, "plated"]).concat(d.npth.map(t => [...t, "not plated"]));
        c.strokeStyle = INK; c.lineWidth = 0.15; c.lineCap = "butt";
        tools.forEach(([dia, pts], ti) => pts.forEach(([x, y]) => {
          const r = Math.max(0.6, Math.min(+dia, 2) / 2 + 0.3), s = ti % 6; c.beginPath();
          if (s === 0) { c.moveTo(x - r, y); c.lineTo(x + r, y); c.moveTo(x, y - r); c.lineTo(x, y + r); }
          else if (s === 1) { c.moveTo(x - r, y - r); c.lineTo(x + r, y + r); c.moveTo(x + r, y - r); c.lineTo(x - r, y + r); }
          else if (s === 2) c.rect(x - r, y - r, 2 * r, 2 * r);
          else if (s === 3) { c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); }
          else if (s === 4) { c.moveTo(x, y - r); c.lineTo(x + r, y + r); c.lineTo(x - r, y + r); c.closePath(); }
          else { c.arc(x, y, r, 0, Math.PI * 2); }
          c.stroke();
        }));
        c.fillStyle = INK; c.font = "2.6px monospace"; c.textAlign = "left"; c.textBaseline = "alphabetic";
        let y = o.h + 18;
        c.fillText("Mark  Diameter  Count  Type", 0, y);
        tools.forEach(([dia, pts, type], ti) => { y += 3.6; c.fillText(`${(SYM[ti % 6] === "□" ? "[]" : SYM[ti % 6] === "◇" ? "<>" : SYM[ti % 6] === "△" ? "/\\" : SYM[ti % 6] === "○" ? "O" : SYM[ti % 6] === "×" ? "x" : "+").padEnd(6)}${(dia + " mm").padEnd(10)}${String(pts.length).padEnd(7)}${type}${ti >= 6 ? ` (${Math.floor(ti / 6) + 1})` : ""}`, 0, y); });
      }
    }
    return PdfExport.buildPdf(sheets.map(() => page), draw, { title: `${title} — ${kind === "toner" ? "toner transfer" : "board prints"}` });
  }

  root.BoardFab = { layerOps, gerber, drills, excellon, fabFiles, zip, crc32, paint, pdfPages, placedParts, partSilk };
})(typeof window !== "undefined" ? window : globalThis);
