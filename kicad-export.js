/* =============================================================================
   KiCad export (no DOM, Node-testable): the board as a .kicad_pcb, the schematic as
   .kicad_sch (one file per drawing frame, under a root sheet when there are several)
   and a .kicad_pro with the net classes and design rules. KiCad 7 file formats
   (pcb 20221018, schematic 20230121), which KiCad 7, 8 and 9 open.
   - The board: footprints with their pads, silkscreen and courtyard (lib "TubeAmpCAD:<name>"),
     tracks, vias, mounting holes, texts, the outline, copper pours (outlines only: KiCad fills
     them, B) and keep-out areas. Nets carry the Board window's names.
   - The schematic: every symbol is drawn by the CAD itself into ShapeCanvas (a canvas 2D
     recorder like pdf-export's PdfCanvas) and kept as that part's own library symbol, so it
     looks as it does here; pins carry the footprint's pad numbers, and each footprint's path
     names its symbol's uuid, so KiCad's Update PCB from Schematic pairs them. Ground, rails
     and sheet connectors are power symbols (global nets by name).
   Drawing units: the CAD's 10-unit grid becomes KiCad's 2.54 mm (0.254 mm per unit).
   Depends on: board-core.js (BoardCore) for the board.
   ============================================================================= */
(function (root) {
  "use strict";
  const LIBNAME = "TubeAmpCAD", PCB_VERSION = 20221018, SCH_VERSION = 20230121, UNIT = 0.254;
  const n = v => { const r = Math.round(+v * 10000) / 10000; return Object.is(r, -0) || !Number.isFinite(r) ? "0" : String(r); };
  const q = s => '"' + String(s === undefined || s === null ? "" : s).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n") + '"';
  const xy = (x, y) => `(xy ${n(x)} ${n(y)})`;
  const ang = a => ((Math.round(a) % 360) + 360) % 360;

  // Stable uuids (the same file twice gives the same text): a 128-bit hash of a seed, as a version-4 uuid
  function uuid(seed) {
    const s = String(seed), h = [0x811c9dc5, 0x3b9aca07, 0x2545f491, 0x9e3779b9];
    for (let i = 0; i < s.length; i++) for (let k = 0; k < 4; k++) h[k] = Math.imul(h[k] ^ s.charCodeAt(i), [16777619, 2246822519, 3266489917, 668265263][k]) >>> 0;
    for (let k = 0; k < 4; k++) { let x = h[k] ^ h[(k + 1) & 3]; x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0; h[k] = (x ^ (x >>> 16)) >>> 0; }
    const hex = h.map(x => x.toString(16).padStart(8, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }
  // a name KiCad takes as a library item (no colon or slash)
  const libName = s => String(s || "?").replace(/[:/\\"\s]+/g, "_");
  // the uuid of a schematic part's symbol: its first section's id (the board knows the same ids)
  const symbolUuid = id => uuid("sym:" + id);

  // ---------------------------------------------------------------------------
  // The board
  // ---------------------------------------------------------------------------
  const PCB_LAYERS = [[0, "F.Cu", "signal"], [31, "B.Cu", "signal"], [32, "B.Adhes", "user", "B.Adhesive"], [33, "F.Adhes", "user", "F.Adhesive"],
    [34, "B.Paste", "user"], [35, "F.Paste", "user"], [36, "B.SilkS", "user", "B.Silkscreen"], [37, "F.SilkS", "user", "F.Silkscreen"],
    [38, "B.Mask", "user"], [39, "F.Mask", "user"], [40, "Dwgs.User", "user", "User.Drawings"], [41, "Cmts.User", "user", "User.Comments"],
    [42, "Eco1.User", "user", "User.Eco1"], [43, "Eco2.User", "user", "User.Eco2"], [44, "Edge.Cuts", "user"], [45, "Margin", "user"],
    [46, "B.CrtYd", "user", "B.Courtyard"], [47, "F.CrtYd", "user", "F.Courtyard"], [48, "B.Fab", "user"], [49, "F.Fab", "user"]];
  const PAPERS = [["A4", 297, 210], ["A3", 420, 297], ["A2", 594, 420], ["A1", 841, 594], ["A0", 1189, 841]];
  // the smallest landscape ISO sheet holding w × h mm with a margin, else a sheet of that size
  function paperFor(w, h, margin) {
    const m = margin === undefined ? 20 : margin, p = PAPERS.find(([, W, H]) => w + 2 * m <= W && h + 2 * m <= H);
    return p ? { size: p[0], w: p[1], h: p[2] } : { size: "User", w: Math.ceil(w + 2 * m), h: Math.ceil(h + 2 * m) };
  }
  const paperLine = p => (p.size === "User" ? `(paper "User" ${n(p.w)} ${n(p.h)})` : `(paper ${q(p.size)}${p.portrait ? " portrait" : ""})`);
  function titleBlock(meta) {
    const t = [["title", meta.title], ["date", meta.date], ["rev", meta.rev], ["company", meta.company]].filter(([, v]) => v);
    const c = (meta.comments || []).filter(Boolean).slice(0, 9).map((v, i) => `(comment ${i + 1} ${q(v)})`);
    return t.length || c.length ? `(title_block ${t.map(([k, v]) => `(${k} ${q(v)})`).join(" ")} ${c.join(" ")})` : "";
  }

  // our footprint coordinates -> KiCad's: a bottom-side part keeps its pads mirrored left to right
  // in the file and turns the other way (ours: rotate, then mirror; KiCad: the mirrored footprint, rotated)
  function fpFrame(bp) {
    const B = bp.side === "B", rot = (bp.rot || 0) & 3;
    return { B, a: ang(B ? -rot * 90 : rot * 90), X: x => (B ? -x : x), F: B ? "B" : "F",
      // a board point in the part's own coordinates (KiCad's, mirrored on the bottom)
      local(x, y) { let dx = x - bp.x, dy = y - bp.y; if (B) dx = -dx; for (let r = 0; r < rot; r++) [dx, dy] = [-dy, dx]; return [B ? -dx : dx, dy]; } };
  }
  const stroke = w => `(stroke (width ${n(w)}) (type solid))`;
  const fpFont = (h, mirror) => `(effects (font (size ${n(h)} ${n(h)}) (thickness ${n(Math.max(0.1, h * 0.15))}))${mirror ? " (justify mirror)" : ""})`;
  function padShape(p) { return p.shape === "rect" ? "rect" : Math.abs(p.w - p.h) < 1e-6 ? "circle" : "oval"; }

  // a footprint drawn to a part's own size (its part number) is a footprint of its own in the library
  const fpName = f => libName(f.name + (f.body ? "_" + Object.keys(f.body).sort().map(k => k + n(f.body[k])).join("_") : ""));
  // what a footprint holds (description, attributes, texts, silkscreen, courtyard, pads), in the
  // frame T (fpFrame: side and rotation on the board; TOP for the library); t: { ref, refAt, value, valAt, net(i) }
  function fpItems(f, T, sd, t) {
    const L = l => T.F + "." + l, X = T.X, a = T.a, it = [];
    if (f.title) it.push(`  (descr ${q(f.title)})`);
    it.push(`  (attr ${f.smd ? "smd" : "through_hole"})`);
    it.push(`  (fp_text reference ${q(t.ref)} (at ${n(t.refAt[0])} ${n(t.refAt[1])}) (layer ${q(L("SilkS"))}) ${fpFont(1.27, T.B)} (tstamp ${uuid(sd + ":ref")}))`);
    it.push(`  (fp_text value ${q(t.value)} (at ${n(t.valAt[0])} ${n(t.valAt[1])}) (layer ${q(L("Fab"))}) ${fpFont(1, T.B)} (tstamp ${uuid(sd + ":val")}))`);
    (f.silk || []).forEach((s, i) => {
      const ts = `(layer ${q(L("SilkS"))}) (tstamp ${uuid(sd + ":s" + i)})`;
      if (s.t === "line") it.push(`  (fp_line (start ${n(X(s.x1))} ${n(s.y1)}) (end ${n(X(s.x2))} ${n(s.y2)}) ${stroke(0.15)} ${ts})`);
      else if (s.t === "rect") it.push(`  (fp_rect (start ${n(X(s.x))} ${n(s.y)}) (end ${n(X(s.x + s.w))} ${n(s.y + s.h)}) ${stroke(0.15)} (fill none) ${ts})`);
      else if (s.t === "circle") {
        const a0 = s.from || 0, a1 = s.to === undefined ? 360 : s.to, P = d => [X(s.x + s.r * Math.cos(d * Math.PI / 180)), s.y + s.r * Math.sin(d * Math.PI / 180)];
        if (Math.abs(a1 - a0) >= 360 - 1e-6) it.push(`  (fp_circle (center ${n(X(s.x))} ${n(s.y)}) (end ${n(X(s.x + s.r))} ${n(s.y)}) ${stroke(0.15)} (fill none) ${ts})`);
        else { const [p0, pm, p1] = [P(a0), P((a0 + a1) / 2), P(a1)]; it.push(`  (fp_arc (start ${n(p0[0])} ${n(p0[1])}) (mid ${n(pm[0])} ${n(pm[1])}) (end ${n(p1[0])} ${n(p1[1])}) ${stroke(0.15)} ${ts})`); }
      }
    });
    const bx = f.box;
    it.push(`  (fp_rect (start ${n(X(bx[0]))} ${n(bx[1])}) (end ${n(X(bx[2]))} ${n(bx[3])}) ${stroke(0.05)} (fill none) (layer ${q(L("CrtYd"))}) (tstamp ${uuid(sd + ":crt")}))`);
    f.pads.forEach((p, i) => {
      const smd = !!p.smd || !(p.drill > 0), layers = smd ? `${q(L("Cu"))} ${q(L("Paste"))} ${q(L("Mask"))}` : `"*.Cu" "*.Mask"`;
      it.push(`  (pad ${q(p.num)} ${smd ? "smd" : "thru_hole"} ${padShape(p)} (at ${n(X(p.x))} ${n(p.y)}${a ? " " + a : ""}) (size ${n(p.w)} ${n(p.h)})${smd ? "" : ` (drill ${n(p.drill)})`} (layers ${layers})${t.net ? t.net(i) : ""}${p.name && p.name !== p.num ? ` (pinfunction ${q(p.name)})` : ""} (pintype "passive") (tstamp ${uuid(sd + ":p" + i)}))`);
    });
    (f.holes || []).forEach((h, i) => it.push(`  (pad "" np_thru_hole circle (at ${n(X(h.x))} ${n(h.y)}) (size ${n(h.d)} ${n(h.d)}) (drill ${n(h.d)}) (layers "*.Cu" "*.Mask") (tstamp ${uuid(sd + ":h" + i)}))`));
    return it;
  }
  const holeName = h => `MountingHole_${n(h.d)}mm${h.plated ? "_Pad" : ""}`;
  function holeItems(h, sd, ref, net) {
    const ring = h.plated ? root.BoardCore.holeRing(h) : h.d;
    return [`  (descr ${q(`Mounting hole Ø ${n(h.d)} mm${h.plated ? ", plated" : ""}`)})`, `  (attr exclude_from_pos_files exclude_from_bom)`,
      `  (fp_text reference ${q(ref)} (at 0 ${n(-ring / 2 - 1.2)}) (layer "F.SilkS") hide ${fpFont(1)} (tstamp ${uuid(sd + ":ref")}))`,
      `  (fp_text value ${q(holeName(h))} (at 0 ${n(ring / 2 + 1.2)}) (layer "F.Fab") ${fpFont(1)} (tstamp ${uuid(sd + ":val")}))`,
      `  (fp_circle (center 0 0) (end ${n(ring / 2 + 0.25)} 0) ${stroke(0.05)} (fill none) (layer "F.CrtYd") (tstamp ${uuid(sd + ":crt")}))`,
      h.plated ? `  (pad "1" thru_hole circle (at 0 0) (size ${n(ring)} ${n(ring)}) (drill ${n(h.d)}) (layers "*.Cu" "*.Mask")${net || ""} (tstamp ${uuid(sd + ":p")}))`
        : `  (pad "" np_thru_hole circle (at 0 0) (size ${n(h.d)} ${n(h.d)}) (drill ${n(h.d)}) (layers "*.Cu" "*.Mask") (tstamp ${uuid(sd + ":p")}))`];
  }
  const TOP = fpFrame({ x: 0, y: 0, rot: 0 });
  /** The footprints a board uses as a KiCad library: { "TubeAmpCAD.pretty/<name>.kicad_mod": text } */
  function footprintLib(model, board) {
    const out = {};
    ((board && board.holes) || []).forEach(h => { const nm = holeName(h); out[LIBNAME + ".pretty/" + nm + ".kicad_mod"] = [`(footprint ${q(nm)} (version ${PCB_VERSION}) (generator pcbnew)`, `  (layer "F.Cu")`, ...holeItems(h, "lib:" + nm, "REF**"), ")", ""].join("\n"); });
    model.parts.forEach(g => {
      const f = g.fp; if (!f || !g.place) return;
      const nm = fpName(f), file = LIBNAME + ".pretty/" + nm + ".kicad_mod"; if (out[file]) return;
      out[file] = [`(footprint ${q(nm)} (version ${PCB_VERSION}) (generator pcbnew)`, `  (layer "F.Cu")`,
        ...fpItems(f, TOP, "lib:" + nm, { ref: "REF**", refAt: [0, f.box[1] - 1.035], value: nm, valAt: [0, f.box[3] + 1.035] }), ")", ""].join("\n");
    });
    return out;
  }
  const FP_TABLE = `(fp_lib_table\n  (version 7)\n  (lib (name "${LIBNAME}")(type "KiCad")(uri "\${KIPRJMOD}/${LIBNAME}.pretty")(options "")(descr "Tube Amp CAD footprints"))\n)\n`;
  const SYM_TABLE = `(sym_lib_table\n  (version 7)\n  (lib (name "${LIBNAME}")(type "KiCad")(uri "\${KIPRJMOD}/${LIBNAME}.kicad_sym")(options "")(descr "Tube Amp CAD symbols"))\n)\n`;

  /** The board as a .kicad_pcb. model: BoardCore.model(board, netlist); conn: BoardCore.connectivity
      (gives tracks and vias their nets); meta: { title, date, rev, company, version } */
  function pcb(board, model, conn, meta) {
    const C = root.BoardCore, R = board.rules, m = meta || {}, o = board.outline;
    const nameOf = k => (k === null || k === undefined || k === "short" ? "" : model.names[k] || "N" + k);
    // rename: board names -> the names KiCad's schematic gives (a label's net is /<sheet>/<name>)
    const rn = nm => (m.rename && m.rename[nm]) || nm || "";
    const nets = new Map([["", 0]]), netNo = nm => { nm = rn(nm); if (!nets.has(nm)) nets.set(nm, nets.size); return nets.get(nm); };
    const netRef = nm => (nm ? ` (net ${netNo(nm)} ${q(rn(nm))})` : "");
    // nets of tracks and vias: what their copper touches, else the name stored with them
    const trackNet = [], viaNet = [], holeNet = [];
    ((conn && conn.items) || []).forEach(it => {
      const nm = nameOf(it.net);
      if (!nm) return;
      if (it.kind === "track" && !trackNet[it.ti]) trackNet[it.ti] = nm;
      else if (it.kind === "via") viaNet[it.vi] = nm;
      else if (it.kind === "hole") holeNet[it.hi] = nm;
    });
    model.pads.forEach(p => netNo(p.netName));
    board.tracks.forEach((t, i) => { trackNet[i] = trackNet[i] || t.net || ""; netNo(trackNet[i]); });
    board.vias.forEach((v, i) => { viaNet[i] = viaNet[i] || v.net || ""; netNo(viaNet[i]); });
    (board.holes || []).forEach((h, i) => { holeNet[i] = h.plated ? holeNet[i] || h.net || "" : ""; netNo(holeNet[i]); });
    (board.zones || []).forEach(z => netNo(z.net));

    const body = [];
    // footprints
    const padsOf = new Map();
    model.pads.forEach(p => { if (!padsOf.has(p.part)) padsOf.set(p.part, []); padsOf.get(p.part).push(p); });
    model.parts.forEach(g => {
      const bp = g.place, f = g.fp; if (!bp || !f) return;
      const T = fpFrame(bp), mp = padsOf.get(g.key) || [], sd = "fp:" + g.key;
      // the reference above the part as the board shows it (upright: a footprint text's angle is the
      // board's, not the footprint's); the value on the fab layer
      const b = C.partBox(g), ry = b.y1 - 0.4 - 0.635 < 0.5 && b.y2 + 1.1 <= o.h - 0.5 ? b.y2 + 1.035 : b.y1 - 1.035;
      const it = [`(footprint ${q(LIBNAME + ":" + fpName(f))} (layer ${q(T.F + ".Cu")})`, `  (tstamp ${uuid(sd)})`, `  (at ${n(bp.x)} ${n(bp.y)}${T.a ? " " + T.a : ""})`];
      if (g.members && g.members.length) it.push(`  (path ${q("/" + (m.sheetOf ? m.sheetOf(g.members[0].id) : "") + symbolUuid(g.members[0].id))})`);
      body.push(it.concat(fpItems(f, T, sd, { ref: g.ref, refAt: T.local((b.x1 + b.x2) / 2, ry), value: g.value || f.name, valAt: T.local((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2), net: i => netRef((mp[i] || {}).netName) }), ")").join("\n"));
    });
    // mounting holes: footprints of their own (H1, H2 …)
    (board.holes || []).forEach((h, i) => {
      const sd = "hole:" + i + ":" + h.x + ":" + h.y;
      body.push([`(footprint ${q(LIBNAME + ":" + holeName(h))} (layer "F.Cu")`, `  (tstamp ${uuid(sd)})`, `  (at ${n(h.x)} ${n(h.y)})`, ...holeItems(h, sd, "H" + (i + 1), netRef(holeNet[i])), ")"].join("\n"));
    });
    // the outline: a rectangle, its corners rounded
    const r = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2)), W = o.w, H = o.h, edge = (s, e, k) => `(gr_line (start ${n(s[0])} ${n(s[1])}) (end ${n(e[0])} ${n(e[1])}) ${stroke(0.1)} (layer "Edge.Cuts") (tstamp ${uuid("edge:" + k)}))`;
    const sides = [[[r, 0], [W - r, 0]], [[W, r], [W, H - r]], [[W - r, H], [r, H]], [[0, H - r], [0, r]]];
    sides.forEach((s, k) => { if (Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 1e-6) body.push(edge(s[0], s[1], k)); });
    if (r > 1e-6) [[W - r, r, -90], [W - r, H - r, 0], [r, H - r, 90], [r, r, 180]].forEach(([cx, cy, a0], k) => {
      const P = d => [cx + r * Math.cos(d * Math.PI / 180), cy + r * Math.sin(d * Math.PI / 180)], s = P(a0), mm = P(a0 + 45), e = P(a0 + 90);
      body.push(`(gr_arc (start ${n(s[0])} ${n(s[1])}) (mid ${n(mm[0])} ${n(mm[1])}) (end ${n(e[0])} ${n(e[1])}) ${stroke(0.1)} (layer "Edge.Cuts") (tstamp ${uuid("arc:" + k)}))`);
    });
    // texts (our size is the cap height, as KiCad's)
    (board.texts || []).forEach((t, i) => {
      const mir = /^B\./.test(t.layer), a = ang(((t.rot || 0) & 3) * 90);
      body.push(`(gr_text ${q(t.text)} (at ${n(t.x)} ${n(t.y)}${a ? " " + a : ""}) (layer ${q(t.layer)}) (tstamp ${uuid("text:" + i)}) ${fpFont(t.size || 1.5, mir)})`);
    });
    board.tracks.forEach((t, i) => {
      for (let k = 0; k + 1 < t.pts.length; k++) {
        const [a, b] = [t.pts[k], t.pts[k + 1]]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
        body.push(`(segment (start ${n(a[0])} ${n(a[1])}) (end ${n(b[0])} ${n(b[1])}) (width ${n(t.w)}) (layer ${q(t.layer)}) (net ${netNo(trackNet[i])}) (tstamp ${uuid("seg:" + i + ":" + k)}))`);
      }
    });
    board.vias.forEach((v, i) => body.push(`(via (at ${n(v.x)} ${n(v.y)}) (size ${n(v.pad || R.viaPad)}) (drill ${n(v.drill || R.viaDrill)}) (layers "F.Cu" "B.Cu") (net ${netNo(viaNet[i])}) (tstamp ${uuid("via:" + i)}))`));
    // copper pours as KiCad zones (KiCad fills them: B), keep-outs as rule areas
    const pts = P => `(polygon (pts ${P.map(p => xy(p[0], p[1])).join(" ")}))`;
    (board.zones || []).forEach((z, i) => {
      const P = C.zonePoly(board, z); if (!P || P.length < 3) return;
      const thermal = z.thermal !== false, gap = z.gap > 0 ? z.gap : 0.5, spoke = z.spoke > 0 ? z.spoke : 0.8;
      body.push(`(zone (net ${netNo(z.net)}) (net_name ${q(rn(z.net))}) (layer ${q(z.layer)}) (tstamp ${uuid("zone:" + i)}) (hatch edge 0.5)\n  (connect_pads${thermal ? "" : " yes"} (clearance ${n(R.clearance)}))\n  (min_thickness 0.25) (filled_areas_thickness no)\n  (fill (thermal_gap ${n(gap)}) (thermal_bridge_width ${n(spoke)}))\n  ${pts(P)}\n)`);
    });
    (board.keepouts || []).forEach((k, i) => {
      const L = (Array.isArray(k.layers) && k.layers.length ? k.layers : ["F.Cu", "B.Cu"]).map(q).join(" "), na = v => (v ? "not_allowed" : "allowed");
      body.push(`(zone (net 0) (net_name "") (layers ${L}) (tstamp ${uuid("keepout:" + i)})${k.name ? ` (name ${q(k.name)})` : ""} (hatch edge 0.5)\n  (connect_pads (clearance 0))\n  (min_thickness 0.25) (filled_areas_thickness no)\n  (keepout (tracks ${na(k.tracks !== false)}) (vias ${na(k.vias !== false)}) (pads allowed) (copperpour ${na(k.pour !== false)}) (footprints ${na(!!k.parts)}))\n  (fill (thermal_gap 0.5) (thermal_bridge_width 0.5))\n  ${pts(k.pts)}\n)`);
    });

    const head = [`(kicad_pcb (version ${PCB_VERSION}) (generator pcbnew)`, "", `  (general (thickness ${n((board.stackup && board.stackup.thickness) || 1.6)}))`, "",
      `  ${paperLine(paperFor(o.w, o.h))}`, `  ${titleBlock({ ...m, comments: [m.version ? "Tube Amp CAD " + m.version : "Tube Amp CAD"] })}`, "",
      "  (layers", ...PCB_LAYERS.map(([id, nm, t, user]) => `    (${id} ${q(nm)} ${t}${user ? " " + q(user) : ""})`), "  )", "",
      `  (setup (pad_to_mask_clearance ${n(R.maskExpansion || 0)}) (allow_soldermask_bridges_in_footprints no))`, "",
      ...[...nets.entries()].map(([nm, i]) => `  (net ${i} ${q(nm)})`), ""];
    return head.join("\n") + body.map(s => "  " + s.replace(/\n/g, "\n  ")).join("\n") + "\n)\n";
  }

  // ---------------------------------------------------------------------------
  // The project file: net classes (Signal / Power / HV, by name) and the board's rules
  // ---------------------------------------------------------------------------
  function project(name, board, model, hv, rename) {
    const C = root.BoardCore, R = board ? board.rules : null;
    const cls = (nm, cl) => ({ name: nm, clearance: cl.clearance, track_width: cl.track, via_diameter: R.viaPad, via_drill: R.viaDrill, microvia_diameter: 0.3, microvia_drill: 0.1,
      diff_pair_gap: 0.25, diff_pair_via_gap: 0.25, diff_pair_width: 0.2, line_style: 0, pcb_color: "rgba(0, 0, 0, 0.000)", schematic_color: "rgba(0, 0, 0, 0.000)", wire_width: 6, bus_width: 12 });
    const pro = { meta: { filename: name + ".kicad_pro", version: 1 }, board: { design_settings: {}, layer_presets: [], viewports: [] }, boards: [], libraries: { pinned_footprint_libs: [], pinned_symbol_libs: [] },
      net_settings: { classes: [], meta: { version: 3 }, net_colors: null, netclass_assignments: null, netclass_patterns: [] }, pcbnew: { last_paths: {}, page_layout_descr_file: "" },
      schematic: { legacy_lib_dir: "", legacy_lib_list: [] }, sheets: [], text_variables: {} };
    if (R && C) {
      pro.board.design_settings = { defaults: { board_outline_line_width: 0.1, copper_line_width: 0.2, copper_text_size_h: 1.5, copper_text_size_v: 1.5, silk_line_width: 0.15, silk_text_size_h: 1.27, silk_text_size_v: 1.27 },
        rules: { min_clearance: R.clearance, min_copper_edge_clearance: R.edgeClearance, min_through_hole_diameter: R.minDrill, min_track_width: R.minTrack, min_via_annular_width: R.minAnnular, min_via_diameter: +(R.minDrill + 2 * R.minAnnular).toFixed(3), solder_mask_clearance: R.maskExpansion || 0 } };
      pro.net_settings.classes = [cls("Default", C.classRule("Signal", R)), ...["Power", "HV"].map(k => cls(k, C.classRule(k, R)))];
      if (model) {
        const seen = new Set();
        Object.keys(model.names).forEach(k => {
          const nm = (rename && rename[model.names[k]]) || model.names[k], c = C.netClassOf(isNaN(+k) ? k : +k, model.names, hv, R);
          if (c !== "Signal" && !seen.has(nm)) { seen.add(nm); pro.net_settings.netclass_patterns.push({ netclass: c, pattern: nm.replace(/[*?]/g, "?") }); }
        });
      }
    }
    return JSON.stringify(pro, null, 2) + "\n";
  }

  /** The rules the net classes cannot hold, as KiCad custom rules (<name>.kicad_dru):
      clearance by the voltage between two nets (IPC-2221B, BoardCore.clearanceRules: a rule for
      each pair that needs more than its classes give), then each part's own pin spacing inside its
      courtyard (a noval socket's pins are 1.3 mm apart whatever the voltage; a TO-92's 0.22 mm)
      and the thin rings of pins on a 1.27 mm pitch, as the Board window's own check allows them.
      rename: as for pcb */
  function rules(board, model, hv, netlist, rename) {
    const C = root.BoardCore, R = board.rules, CR = C.clearanceRules(board, model, hv, netlist), out = ["(version 1)", ""];
    const nm = k => { const s = model.names[k] || "N" + k; return String((rename && rename[s]) || s).replace(/'/g, "?"); };
    const nets = [...new Set(model.pads.map(p => p.net).filter(k => k !== null && k !== undefined))];
    const base = (a, b) => Math.max(C.classRule(C.netClassOf(a, model.names, hv, R), R).clearance, C.classRule(C.netClassOf(b, model.names, hv, R), R).clearance);
    for (let i = 0; i < nets.length; i++) for (let j = i + 1; j < nets.length; j++) {
      const a = nets[i], b = nets[j], need = CR.need(a, b);
      if (!need.ipc || need.c <= base(a, b) + 1e-6) continue;
      out.push(`(rule ${q(`IPC-2221 ${nm(a)} to ${nm(b)}, ${Math.round(need.v)} V`)}`, `  (constraint clearance (min ${n(need.c)}mm))`,
        `  (condition "(A.NetName == '${nm(a)}' && B.NetName == '${nm(b)}') || (A.NetName == '${nm(b)}' && B.NetName == '${nm(a)}')"))`, "");
    }
    // a pad's copper as KiCad has it: a rectangle's edges, or a round pad's or oval's centre line, and a radius
    const shape = p => {
      if (p.shape === "rect") { const x1 = p.x - p.w / 2, x2 = p.x + p.w / 2, y1 = p.y - p.h / 2, y2 = p.y + p.h / 2; return { s: [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]], r: 0 }; }
      const r = Math.min(p.w, p.h) / 2, l = Math.max(p.w, p.h) / 2 - r; return { s: [p.w >= p.h ? [p.x - l, p.y, p.x + l, p.y] : [p.x, p.y - l, p.x, p.y + l]], r };
    };
    const padGap = (p, o) => { const a = shape(p), b = shape(o); let d = Infinity; a.s.forEach(u => b.s.forEach(v => { d = Math.min(d, C.segSeg(u, v)); })); return d - a.r - b.r; };
    model.parts.forEach(g => {
      if (!g.place || !g.fp) return;
      const ps = model.pads.filter(p => p.part === g.key), ref = String(g.ref).replace(/'/g, "?");
      // the pin spacing, for each pair of nets on the part that needs more (no net: an unused pin)
      let gap = Infinity;
      const pairs = new Map(), key = k => (k === null || k === undefined ? "" : nm(k));
      for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
        if (ps[i].net !== null && ps[i].net === ps[j].net) continue;
        gap = Math.min(gap, padGap(ps[i], ps[j]));
        const need = CR.need(ps[i].net, ps[j].net).c, [x, y] = [key(ps[i].net), key(ps[j].net)].sort();
        if (x !== y) pairs.set(x + "\u0000" + y, Math.max(pairs.get(x + "\u0000" + y) || 0, need));
      }
      if (gap > 0) [...pairs].filter(([, need]) => need > gap + 1e-6).forEach(([k]) => {
        const [x, y] = k.split("\u0000");
        out.push(`(rule ${q(`${ref} pin spacing, ${x || "no net"} to ${y || "no net"}`)}`, `  (constraint clearance (min ${n(Math.floor(gap * 1000) / 1000)}mm))`,
          `  (condition "A.insideCourtyard('${ref}') && B.insideCourtyard('${ref}') && ((A.NetName == '${x}' && B.NetName == '${y}') || (A.NetName == '${y}' && B.NetName == '${x}'))"))`, "");
      });
      const ring = ps.filter(p => p.pitchRing && p.drill > 0).map(p => (Math.min(p.w, p.h) - p.drill) / 2);
      if (ring.length && Math.min(...ring) < R.minAnnular) out.push(`(rule ${q(`${ref} rings on a 1.27 mm pitch`)}`, `  (constraint annular_width (min ${n(Math.floor(Math.min(...ring) * 1000) / 1000)}mm))`, `  (condition "A.insideCourtyard('${ref}')"))`, "");
    });
    return out.join("\n");
  }

  // ---------------------------------------------------------------------------
  // ShapeCanvas: the part of the canvas 2D context the symbols use (as PdfCanvas), recording
  // lines, filled shapes, circles and text in the coordinates of its starting transform
  // ---------------------------------------------------------------------------
  // a CSS colour as luminance: dark fills are the screen's background (paper in print)
  function dark(css) {
    if (root.PdfExport && root.PdfExport.ink) return !!root.PdfExport.ink(css);
    const m = /^#([0-9a-f]{6})/i.exec(String(css || "")); if (!m) return false;
    const v = parseInt(m[1], 16); return (0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255 < 0.2;
  }
  class ShapeCanvas {
    constructor(m) {
      this.shapes = []; this.texts = [];
      this.st = { m: m || [1, 0, 0, 1, 0, 0], lineWidth: 1, strokeStyle: "#fff", fillStyle: "#fff", font: "10px monospace", textAlign: "left", textBaseline: "alphabetic", globalAlpha: 1, dash: [] };
      this.stack = []; this.beginPath();
      ["lineWidth", "strokeStyle", "fillStyle", "font", "textAlign", "textBaseline", "lineCap", "lineJoin", "globalAlpha", "shadowColor", "shadowBlur", "globalCompositeOperation"].forEach(p =>
        Object.defineProperty(this, p, { get: () => this.st[p], set: v => { this.st[p] = v; } }));
    }
    P(x, y) { const [a, b, c, d, e, f] = this.st.m; return [a * x + c * y + e, b * x + d * y + f]; }
    scaleOf() { const [a, b, c, d] = this.st.m; return Math.sqrt(Math.abs(a * d - b * c)); }
    save() { this.stack.push({ ...this.st, m: this.st.m.slice(), dash: this.st.dash.slice() }); }
    restore() { if (this.stack.length) this.st = this.stack.pop(); }
    setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
    transform(a2, b2, c2, d2, e2, f2) { const [a, b, c, d, e, f] = this.st.m; this.st.m = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]; }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    rotate(t) { const c = Math.cos(t), s = Math.sin(t); this.transform(c, s, -s, c, 0, 0); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    setLineDash(d) { this.st.dash = (d || []).slice(); }
    getLineDash() { return this.st.dash.slice(); }
    beginPath() { this.subs = []; this.cur = null; }
    moveTo(x, y) { this.cur = { pts: [this.P(x, y)], closed: false }; this.subs.push(this.cur); this.last = [x, y]; }
    lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); this.cur.pts.push(this.P(x, y)); this.last = [x, y]; }
    closePath() { if (this.cur) { this.cur.closed = true; const p = this.cur.pts[0]; this.cur = { pts: [p], closed: false }; this.subs.push(this.cur); } }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      if (!this.cur) this.moveTo(x1, y1);
      const [x0, y0] = this.last;
      for (let k = 1; k <= 8; k++) { const t = k / 8, u = 1 - t; this.lineTo(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y); }
    }
    quadraticCurveTo(x1, y1, x, y) { const [x0, y0] = this.last || [x1, y1]; this.bezierCurveTo(x0 + 2 / 3 * (x1 - x0), y0 + 2 / 3 * (y1 - y0), x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y), x, y); }
    arc(cx, cy, r, a0, a1, ccw) {
      const TAU = 2 * Math.PI;
      let sweep = ccw ? a0 - a1 : a1 - a0;
      const full = sweep >= TAU - 1e-9 || sweep <= -(TAU - 1e-9);
      sweep = full ? TAU : ((sweep % TAU) + TAU) % TAU;
      if (ccw) sweep = -sweep;
      // a whole circle on its own (the transform keeps circles round): a circle item
      const [a, b, c, d] = this.st.m;
      if (full && Math.abs(a * a + b * b - (c * c + d * d)) < 1e-9 && Math.abs(a * c + b * d) < 1e-9 && (!this.cur || this.cur.pts.length <= 1)) {
        if (this.cur && this.cur.pts.length) this.subs.pop();
        const [X, Y] = this.P(cx, cy); this.subs.push({ circle: [X, Y, r * this.scaleOf()] }); this.cur = null; this.last = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
        return;
      }
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 12)));
      for (let k = 0; k <= steps; k++) { const t = a0 + sweep * k / steps; (k === 0 && !this.cur ? this.moveTo : this.lineTo).call(this, cx + r * Math.cos(t), cy + r * Math.sin(t)); }
    }
    ellipse(cx, cy, rx, ry, rot, a0, a1, ccw) { this.save(); this.translate(cx, cy); this.rotate(rot || 0); this.scale(rx, ry); const keep = this.cur; this.cur = keep; this.arc(0, 0, 1, a0, a1, ccw); this.restore(); }
    _emit(fill) {
      if (this.st.globalAlpha <= 0.5 || this.st.globalCompositeOperation === "destination-out") return;
      const style = fill ? this.st.fillStyle : this.st.strokeStyle;
      if (typeof style !== "string" || dark(style)) return;          // the background: paper
      this.subs.forEach(s => {
        if (s.circle) { this.shapes.push({ t: "circle", x: s.circle[0], y: s.circle[1], r: s.circle[2], fill: !!fill }); return; }
        const p = s.pts.slice(); if (s.closed && p.length > 2) p.push(p[0]);
        if (p.length >= 2 && (!fill || p.length >= 3)) this.shapes.push({ t: "poly", pts: p, fill: !!fill });
      });
    }
    stroke() { this._emit(false); }
    fill() { this._emit(true); }
    clip() {}
    fillRect(x, y, w, h) { const k = [this.subs, this.cur, this.last]; this.beginPath(); this.rect(x, y, w, h); this.fill(); [this.subs, this.cur, this.last] = k; }
    strokeRect(x, y, w, h) { const k = [this.subs, this.cur, this.last]; this.beginPath(); this.rect(x, y, w, h); this.stroke(); [this.subs, this.cur, this.last] = k; }
    clearRect() {}
    _font() { const m = String(this.st.font).match(/(bold\s+)?([\d.]+)px/); return { bold: !!(m && m[1]), size: m ? parseFloat(m[2]) : 10 }; }
    measureText(t) { return { width: String(t).length * 0.6 * this._font().size }; }
    fillText(text, x, y) {
      if (this.st.globalAlpha <= 0.5 || dark(this.st.fillStyle) || !String(text).trim()) return;
      const { bold, size } = this._font(), [X, Y] = this.P(x, y), [ux, uy] = this.P(x + 1, y);
      const angle = Math.round(Math.atan2(-(uy - Y), ux - X) * 180 / Math.PI);
      const al = this.st.textAlign, bl = this.st.textBaseline;
      this.texts.push({ x: X, y: Y, text: String(text), size: size * this.scaleOf() * 0.72, bold, angle: ang(angle),
        h: al === "center" ? "center" : al === "right" || al === "end" ? "right" : "left", v: bl === "middle" ? "center" : bl === "top" || bl === "hanging" ? "top" : "bottom" });
    }
  }

  // ---------------------------------------------------------------------------
  // The schematic. sym: { name, power, onBoard, inBom, ref, units: [{ shapes, texts, pins }] }
  // (shapes, texts and pins in mm, y down, round each unit's origin); pins: { x, y, num, name, type, hidden }.
  // A sheet: { file, name, paper, title, symbols: [{ lib, unit, x, y, uuid, ref, value, footprint,
  // props: { ref: { x, y, h, v, hide }, value: … }, pins: [num] }], wires: [[x1, y1, x2, y2]],
  // junctions: [[x, y]], labels: [{ x, y, text, angle, global }], notes: [{ x, y, text, size }] }
  // ---------------------------------------------------------------------------
  const F127 = "(effects (font (size 1.27 1.27)))";
  const justify = (h, v, hide) => { const j = [h && h !== "center" ? h : "", v && v !== "center" ? v : ""].filter(Boolean); return `(effects (font (size 1.27 1.27))${j.length ? ` (justify ${j.join(" ")})` : ""}${hide ? " hide" : ""})`; };
  function libSymbol(s, bare) {
    const nm = libName(s.name), out = [`(symbol ${q(bare ? nm : LIBNAME + ":" + nm)}${s.power ? " (power)" : ""} (pin_numbers hide) (pin_names (offset 0) hide) (in_bom ${s.inBom ? "yes" : "no"}) (on_board ${s.onBoard ? "yes" : "no"})`];
    const prop = (k, v, i, hide) => `  (property ${q(k)} ${q(v)} (at 0 0 0) ${justify("", "", hide)})`;
    out.push(prop("Reference", s.ref || "U", 0), prop("Value", s.value || nm, 1, true), prop("Footprint", s.footprint || "", 2, true), prop("Datasheet", "", 3, true));
    if (s.description) out.push(prop("ki_description", s.description, 4, true));
    s.units.forEach((u, k) => {
      const Y = v => -v;           // library symbols are drawn y up
      const g = [];
      (u.shapes || []).forEach(sh => {
        const fill = `(fill (type ${sh.fill ? "outline" : "none"}))`;
        if (sh.t === "circle") g.push(`(circle (center ${n(sh.x)} ${n(Y(sh.y))}) (radius ${n(sh.r)}) (stroke (width 0) (type default)) ${fill})`);
        else g.push(`(polyline (pts ${sh.pts.map(p => xy(p[0], Y(p[1]))).join(" ")}) (stroke (width 0) (type default)) ${fill})`);
      });
      (u.texts || []).forEach(t => {
        const j = [t.h !== "center" ? t.h : "", t.v !== "center" ? t.v : ""].filter(Boolean);
        g.push(`(text ${q(t.text)} (at ${n(t.x)} ${n(Y(t.y))} ${n(t.angle * 10)}) (effects (font (size ${n(t.size)} ${n(t.size)})${t.bold ? " bold" : ""})${j.length ? ` (justify ${j.join(" ")})` : ""}))`);
      });
      (u.pins || []).forEach(p => g.push(`(pin ${p.type || "passive"} line (at ${n(p.x)} ${n(Y(p.y))} 0) (length 0)${p.hidden ? " hide" : ""} (name ${q(p.name || "~")} ${F127}) (number ${q(p.num)} ${F127}))`));
      out.push(`  (symbol ${q(nm + "_" + (k + 1) + "_1")}\n    ${g.join("\n    ")}\n  )`);
    });
    out.push(")");
    return out.join("\n");
  }
  function placedSymbol(s, sheetPath, project) {
    const prop = (k, v, p, i) => `  (property ${q(k)} ${q(v)} (at ${n(p ? p.x : s.x)} ${n(p ? p.y : s.y)} ${n(p && p.angle ? p.angle : 0)}) ${justify(p && p.h, p && p.v, !p || p.hide)})`;
    const out = [`(symbol (lib_id ${q(LIBNAME + ":" + libName(s.lib))}) (at ${n(s.x)} ${n(s.y)} 0) (unit ${s.unit || 1})`, `  (in_bom ${s.inBom ? "yes" : "no"}) (on_board ${s.onBoard ? "yes" : "no"}) (dnp no)`, `  (uuid ${s.uuid})`,
      prop("Reference", s.ref, s.props && s.props.ref, 0), prop("Value", s.value, s.props && s.props.value, 1), prop("Footprint", s.footprint || "", null, 2), prop("Datasheet", "", null, 3)];
    (s.pins || []).forEach(p => out.push(`  (pin ${q(p)} (uuid ${uuid(s.uuid + ":pin:" + p)}))`));
    out.push(`  (instances (project ${q(project)} (path ${q(sheetPath)} (reference ${q(s.ref)}) (unit ${s.unit || 1}))))`, ")");
    return out.join("\n");
  }
  /** One schematic file. sheet: as above; sheetPath: "/<root uuid>" or "/<root uuid>/<sheet uuid>";
      children: sheet symbols for the root ({ name, file, x, y, w, h, uuid, page }) */
  function schFile(sheet, syms, opts) {
    const used = new Set(sheet.symbols.map(s => libName(s.lib)));
    const out = [`(kicad_sch (version ${SCH_VERSION}) (generator eeschema)`, "", `  (uuid ${opts.uuid})`, "", `  ${paperLine(sheet.paper)}`, "", `  ${titleBlock(sheet.title || {})}`, "",
      "  (lib_symbols", ...syms.filter(s => used.has(libName(s.name))).map(s => "    " + libSymbol(s).replace(/\n/g, "\n    ")), "  )", ""];
    const add = s => out.push("  " + s.replace(/\n/g, "\n  "));
    (sheet.junctions || []).forEach(([x, y]) => add(`(junction (at ${n(x)} ${n(y)}) (diameter 0) (color 0 0 0 0) (uuid ${uuid(opts.uuid + ":j:" + n(x) + ":" + n(y))}))`));
    (sheet.wires || []).forEach(([x1, y1, x2, y2], i) => add(`(wire (pts ${xy(x1, y1)} ${xy(x2, y2)}) (stroke (width 0) (type default)) (uuid ${uuid(opts.uuid + ":w:" + i)}))`));
    (sheet.notes || []).forEach((t, i) => add(`(text ${q(t.text)} (at ${n(t.x)} ${n(t.y)} 0) (effects (font (size ${n(t.size || 1.27)} ${n(t.size || 1.27)})) (justify left bottom)) (uuid ${uuid(opts.uuid + ":t:" + i)}))`));
    (sheet.labels || []).forEach((l, i) => {
      const a = ang(l.angle || 0), j = a === 180 ? "right" : "left";
      add(l.global ? `(global_label ${q(l.text)} (shape passive) (at ${n(l.x)} ${n(l.y)} ${a}) (fields_autoplaced) (effects (font (size 1.27 1.27)) (justify ${j})) (uuid ${uuid(opts.uuid + ":gl:" + i)})\n  (property "Intersheetrefs" "\${INTERSHEET_REFS}" (at ${n(l.x)} ${n(l.y)} 0) (effects (font (size 1.27 1.27)) hide))\n)`
        : `(label ${q(l.text)} (at ${n(l.x)} ${n(l.y)} ${a}) (fields_autoplaced) (effects (font (size 1.27 1.27)) (justify ${j} bottom)) (uuid ${uuid(opts.uuid + ":l:" + i)}))`);
    });
    sheet.symbols.forEach(s => add(placedSymbol(s, opts.path, opts.project)));
    (opts.children || []).forEach(c => add([`(sheet (at ${n(c.x)} ${n(c.y)}) (size ${n(c.w)} ${n(c.h)}) (fields_autoplaced)`, `  (stroke (width 0.1524) (type solid)) (fill (color 0 0 0 0.0000))`, `  (uuid ${c.uuid})`,
      `  (property "Sheetname" ${q(c.name)} (at ${n(c.x)} ${n(c.y - 0.7)} 0) (effects (font (size 1.27 1.27)) (justify left bottom)))`,
      `  (property "Sheetfile" ${q(c.file)} (at ${n(c.x)} ${n(c.y + c.h + 0.6)} 0) (effects (font (size 1.27 1.27)) (justify left top)))`,
      `  (instances (project ${q(opts.project)} (path ${q(opts.path)} (page ${q(String(c.page))}))))`, ")"].join("\n")));
    if (opts.root) out.push("", "  (sheet_instances", `    (path "/" (page "1"))`, "  )");
    out.push(")", "");
    return out.join("\n");
  }
  /** The schematic files: { "<name>.kicad_sch": text, … }. doc: { name, symbols (library), sheets }.
      One sheet: a flat schematic. More: a root sheet holding a sheet symbol for each. */
  function schematic(doc) {
    const name = doc.name, rootId = uuid("root:" + name), files = {};
    if (doc.sheets.length === 1) {
      files[name + ".kicad_sch"] = schFile(doc.sheets[0], doc.symbols, { uuid: rootId, path: "/" + rootId, project: name, root: true });
      return files;
    }
    const W = 60, H = 30, children = doc.sheets.map((s, i) => ({ name: s.name, file: s.file, uuid: s.uuid, page: i + 2, x: 25.4 + (i % 4) * (W + 15.24), y: 38.1 + Math.floor(i / 4) * (H + 15.24), w: W, h: H }));
    const top = { paper: { size: "A4", w: 297, h: 210 }, title: doc.title || {}, symbols: [], notes: doc.rootNotes || [] };
    files[name + ".kicad_sch"] = schFile(top, doc.symbols, { uuid: rootId, path: "/" + rootId, project: name, root: true, children });
    doc.sheets.forEach(s => { files[s.file] = schFile(s, doc.symbols, { uuid: s.uuid, path: "/" + rootId + "/" + s.uuid, project: name }); });
    return files;
  }

  /** The schematic's symbols as a KiCad symbol library (TubeAmpCAD.kicad_sym) */
  function symbolLib(symbols) {
    return [`(kicad_symbol_lib (version 20220914) (generator kicad_symbol_editor)`, ...symbols.map(s => "  " + libSymbol(s, true).replace(/\n/g, "\n  ")), ")", ""].join("\n");
  }

  root.KicadExport = { LIBNAME, UNIT, uuid, symbolUuid, libName, fpName, paperFor, pcb, footprintLib, FP_TABLE, SYM_TABLE, project, rules, schematic, symbolLib, ShapeCanvas };
})(typeof window !== "undefined" ? window : globalThis);
