/* =============================================================================
   BOARD DESIGN — core (no DOM): the PCB document, the footprint library, how the
   schematic's parts and nets map onto footprints and pads, copper connectivity,
   ratsnest and design-rule checks. The Board window (board-app.js) draws and
   edits it; Node tests load it directly.
   Depends on: cad-components.js (CadLib: part library, tube pin numbers, models)
   Units: millimetres, board coordinates with y down, origin at the outline's top left.
   ============================================================================= */
(function (root) {
  "use strict";
  const DOC_VERSION = 1;
  const LAYERS = ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "Edge.Cuts"];
  const COPPER = ["F.Cu", "B.Cu"];

  // ---------------------------------------------------------------------------
  // The board document (saved inside the circuit file as "board")
  // ---------------------------------------------------------------------------
  function newBoard() {
    return {
      app: "TubeAmpCAD-Board", version: DOC_VERSION, units: "mm",
      outline: { w: 160, h: 100, r: 0 },          // r: corner radius
      sheet: { size: "auto", orient: "landscape" },   // the drawing sheet round the board: auto | A4..A0 | none
      stackup: { layers: 2, thickness: 1.6, copper: 35 },   // mm, µm
      rules: defaultRules(),
      parts: {},            // key -> { ref, fp, x, y, rot, side }   key: the schematic part ids, joined by "+"
      tracks: [],           // { layer, w, pts: [[x, y], ...] }
      vias: [],             // { x, y, drill, pad }
      holes: [],            // mounting holes: { x, y, d, plated, pad (ring Ø when plated), net (name, when plated) }
      texts: [],            // { x, y, text, size, layer: "F.SilkS" | "B.SilkS" | "F.Cu" | "B.Cu", rot }
      zones: [],            // copper pours: { net: name, layer, pts: [[x, y]...] | null (the whole board), thermal, gap, spoke, locked }
      keepouts: []          // { name, pts, layers: ["F.Cu", "B.Cu"], tracks, vias, pour, parts (true: not allowed), locked }
    };
  }
  // Design rules for valve circuits: generous widths and clearances, more for high voltage.
  // Net classes: every net is Signal, Power or HV — automatically (HV above hvVolts in the
  // simulation, GND is Power) unless netClass names a class for it.
  function defaultRules() {
    return {
      track: 0.6, power: 1.0, minTrack: 0.4,                       // widths, mm (power nets widen further for their DC current)
      clearance: 0.4, hvClearance: 2.0, hvVolts: 60, edgeClearance: 0.5, holeEdge: 1.0,   // holeEdge: a hole's wall to the board edge
      viaDrill: 0.8, viaPad: 1.8, minDrill: 0.6, minAnnular: 0.3,
      maskExpansion: 0.05, tentVias: true,                        // solder mask: opening around pads; vias covered
      tempRise: 10,                                               // °C a track may warm up at its DC current (IPC-2221, outer layer)
      netClass: {},                                               // net name -> "Signal" | "Power" | "HV"
      ipc: "B2",                                                  // clearance by voltage: IPC-2221B table B2 | B4 | A6 | off
      heaters: true, heater126: false, shields: true,             // heater wiring on the board; 12AX7-type heaters at 12.6 V; internal shields to GND
      stopperMax: 10, couplingLen: 10, couplingGap: 2, heatGap: 10, hotWatts: 1, socketHole: 40,   // valve layout checks (mm, W)
      ground: "free",                                             // free | star (every ground return to the star point XG1)
      teardrops: true,                                            // copper fillets where tracks meet pads and vias
      socketBody: true,                                           // under a valve socket's body a track may pass its pins as close as they are to each other
      maxHeight: 0,                                               // the room under the enclosure's lid above the board's top (mm; 0: no limit)
      checks: { star: true, clearance: true, short: true, edge: true, unplaced: true, annular: true, viapad: true, drill: true, width: true, class: true, pinout: true, current: true, courtyard: true, height: true, keepout: true, silk: true, dangling: true, holeedge: true, stopper: true, coupling: true, heat: true, support: true }
    };
  }
  const CLASSES = ["Signal", "Power", "HV"];
  function netClassOf(net, names, hv, R) {
    const m = R.netClass && R.netClass[names[net]];
    if (CLASSES.includes(m)) return m;
    if (hv && hv.has(net)) return "HV";
    return names[net] === "GND" || isHeaterNet(names[net]) ? "Power" : "Signal";
  }
  /** Track width (mm) for a DC current on an outer layer: IPC-2221, I = 0.048 · ΔT^0.44 · A^0.725
      (A in mil²), copper thickness from the stack-up */
  function currentWidth(I, R, stackup) {
    const a = Math.abs(I || 0); if (!a) return 0;
    const area = Math.pow(a / (0.048 * Math.pow(R.tempRise > 0 ? R.tempRise : 10, 0.44)), 1 / 0.725), tMil = ((stackup && stackup.copper) || 35) / 25.4;
    return +(area / tMil * 0.0254).toFixed(3);
  }
  /** The DC current a net's copper must carry: the largest current into any pin on it */
  function netCurrents(netlist) {
    const out = {};
    (netlist.parts || []).forEach(p => p.pins.forEach(q => { if (q.net === undefined || q.net === null || !Number.isFinite(q.i)) return; out[q.net] = Math.max(out[q.net] || 0, Math.abs(q.i)); }));
    return out;
  }
  const classRule = (cls, R) => ({ track: cls === "Signal" ? R.track : R.power, clearance: cls === "HV" ? R.hvClearance : R.clearance });
  // signed distance from the board edge, positive inside (a rectangle with rounded corners)
  function edgeDist(x, y, o) {
    const r = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2));
    const qx = Math.abs(x - o.w / 2) - (o.w / 2 - r), qy = Math.abs(y - o.h / 2) - (o.h / 2 - r);
    return -(Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r);
  }
  // corner mounting holes: n per corner pattern, inset from the edges
  function cornerHoles(o, d, inset) { return [[inset, inset], [o.w - inset, inset], [inset, o.h - inset], [o.w - inset, o.h - inset]].map(([x, y]) => ({ x, y, d })); }

  function normaliseBoard(b) {
    const d = newBoard();
    if (!b || typeof b !== "object") return d;
    return {
      ...d, ...b,
      outline: { ...d.outline, ...(b.outline || {}) },
      stackup: { ...d.stackup, ...(b.stackup || {}) },
      sheet: { ...d.sheet, ...(b.sheet || {}) },
      rules: { ...d.rules, ...(b.rules || {}), netClass: { ...((b.rules || {}).netClass || {}) }, checks: { ...d.rules.checks, ...((b.rules || {}).checks || {}) } },
      holes: Array.isArray(b.holes) ? b.holes : [],
      texts: Array.isArray(b.texts) ? b.texts : [],
      zones: Array.isArray(b.zones) ? b.zones.filter(z => z && COPPER.includes(z.layer)) : [],
      keepouts: Array.isArray(b.keepouts) ? b.keepouts.filter(k => k && Array.isArray(k.pts) && k.pts.length >= 3) : [],
      parts: b.parts && typeof b.parts === "object" ? b.parts : {},
      tracks: Array.isArray(b.tracks) ? b.tracks.filter(t => t && Array.isArray(t.pts) && t.pts.length >= 2 && COPPER.includes(t.layer)) : [],
      vias: Array.isArray(b.vias) ? b.vias : []
    };
  }

  // ---------------------------------------------------------------------------
  // Footprints. A footprint: { name, title, pads: [{ num, name, x, y, shape, w, h, drill }],
  // silk: [{ t: "line"|"rect"|"circle", ... }], box: [x1, y1, x2, y2] (courtyard) }
  // Through-hole footprints (valve amplifiers are mostly built that way: every pad on both layers)
  // and, for the small parts, surface-mount ones (fp.smd; pads on the part's side only).
  // ---------------------------------------------------------------------------
  const pad = (num, x, y, d, drill, shape, name) => ({ num: String(num), name: name || String(num), x, y, shape: shape || "circle", w: d, h: d, drill });
  const bbox = (pads, silk, m) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); };
    pads.forEach(p => { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); });
    silk.forEach(s => {
      if (s.t === "line") { add(s.x1, s.y1); add(s.x2, s.y2); }
      else if (s.t === "rect") { add(s.x, s.y); add(s.x + s.w, s.y + s.h); }
      else if (s.t === "circle") { add(s.x - s.r, s.y - s.r); add(s.x + s.r, s.y + s.r); }
    });
    return [x1 - m, y1 - m, x2 + m, y2 + m];
  };
  // holes: the part's own non-plated holes (locating pegs, fixing screws): [{ x, y, d }]
  const fp = (name, title, pads, silk, holes) => ({ name, title, pads, silk, holes: holes || [], box: bbox(pads, silk, 0.5) });

  // axial: resistors, diodes, small chokes. pitch: lead spacing; body length and diameter
  const AXIAL = { 7.62: [3.6, 1.8], 10.16: [6.3, 2.5], 12.7: [9, 3.2], 15.24: [11, 4.5], 20.32: [15, 5.5], 25.4: [18, 6.5], 30.48: [22, 8], 40.64: [34, 10], 50.8: [45, 12] };
  // holes as KiCad's: 0.85 mm for the 0.6 mm leads of 1/8–1/2 W resistors and DO-35; 1.1 mm for a
  // DO-41's 0.8 mm (a diode on 10.16 mm or more); 1.2 mm for the 0.8–1.0 mm leads of 1 W and up
  // (DIN0411 and longer) and the 5 W zeners
  // body: the real part's { l, d, lead } (its part number, or set by hand); a thicker lead than the
  // pitch's own takes a hole 0.3 mm over it
  function axialHole(pitch, diode, b) {
    const big = pitch >= 15, do41 = diode && pitch >= 10, base = big ? 1.2 : do41 ? 1.1 : 0.85;
    const dr = Math.max(base, b.lead > 0 ? Math.ceil((b.lead + 0.3) * 20) / 20 : 0);
    return { dr, d: Math.max(big ? 2.4 : do41 ? 2.2 : 1.8, dr > base ? dr + 1 : 0) };
  }
  function axial(pitch, diode, body) {
    const b = body || {}, L = b.l > 0 ? b.l : AXIAL[pitch][0], D = b.d > 0 ? b.d : AXIAL[pitch][1], h = pitch / 2;
    const { dr, d } = axialHole(pitch, diode, b);
    const silk = [{ t: "rect", x: -L / 2, y: -D / 2, w: L, h: D }];
    if (h - d / 2 - 0.3 > L / 2) silk.push({ t: "line", x1: -h + d / 2 + 0.3, y1: 0, x2: -L / 2, y2: 0 }, { t: "line", x1: L / 2, y1: 0, x2: h - d / 2 - 0.3, y2: 0 });
    if (diode) silk.push({ t: "line", x1: -L / 2 + 0.8, y1: -D / 2, x2: -L / 2 + 0.8, y2: D / 2 });   // band at the cathode (pad 1)
    const f = fp(`${diode ? "DIODE" : "AXIAL"}-${pitch}`, `Axial, ${pitch} mm lead spacing${diode ? " (band at pad 1, the cathode)" : ""}`,
      [pad(1, -h, 0, d, dr, diode ? "rect" : "circle", diode ? "K" : "1"), pad(2, h, 0, d, dr, "circle", diode ? "A" : "2")], silk);
    f.zHeight = +(D + 0.4).toFixed(2);   // lying down: the body's diameter over a 0.4 mm stand-off (as the 3D model)
    return f;
  }
  // Vertical (standing) mounting of a 2-lead axial resistor: the body upright on pad 1, its top lead
  // bent over in a hairpin and down to pad 2. Everything comes from the body and lead sizes (the part
  // number's, set by hand, or the horizontal footprint's standard ones), no stored variants:
  //   L, D: body length and diameter; d: lead diameter; R: the lead's minimum bend radius (IPC-A-610:
  //   1 × d for leads under 0.8 mm, 1.5 × d to 1.2 mm, 2 × d over that; or set by hand as body.bend)
  //   pitch = max(D + d + 2R up to 0.05 mm, the least spacing: 2.54 mm and the pads 0.4 mm apart)
  //   Z-height = L + R + 2d (the body on a lead-diameter stand-off, the bend over it)
  // The courtyard grows with the height: a standing part soldered by hand or on a wave may lean
  // AXIAL_TILT degrees, so its top moves Z · tan(tilt) sideways.
  const AXIAL_TILT = 5, canStand = name => /^AXIAL-[\d.]+$/.test(String(name || ""));
  const r2 = v => +(+v).toFixed(2);
  function axialStand(pitch, body) {
    const b = body || {}, L = b.l > 0 ? b.l : AXIAL[pitch][0], D = b.d > 0 ? b.d : AXIAL[pitch][1];
    const d = b.lead > 0 ? b.lead : pitch >= 15 ? 0.8 : 0.6, R = b.bend > 0 ? b.bend : d < 0.8 ? d : d <= 1.2 ? 1.5 * d : 2 * d;
    const { dr, d: pd } = axialHole(pitch, false, b), least = Math.max(2.54, pd + 0.4);
    const P = Math.max(Math.ceil((D + d + 2 * R) * 20 - 1e-6) / 20, least), Z = L + R + 2 * d;
    return { L: r2(L), D: r2(D), d: r2(d), R: r2(R), P: r2(P), Z: r2(Z), least: r2(least), dr, pd, bendSet: b.bend > 0 };
  }
  function axialV(pitch, body) {
    const v = axialStand(pitch, body), x1 = -v.P / 2, x2 = v.P / 2, r = Math.max(v.D / 2, v.pd / 2 + 0.3);
    const silk = [{ t: "circle", x: x1, y: 0, r }, { t: "line", x1: x1 - r - 0.7, y1: 0, x2: x1 - r, y2: 0 }];   // the body, and pin 1's notch mark beside it
    // the hairpin lead: over from the body to pad 2, its bend round the pad's near side
    const rb = v.pd / 2 + 0.35, lx = x2 - rb;
    if (lx - (x1 + r) > 0.2) silk.push({ t: "line", x1: x1 + r, y1: 0, x2: lx, y2: 0 });
    silk.push({ t: "circle", x: x2, y: 0, r: rb, from: 110, to: 250 });
    const pads = [pad(1, x1, 0, v.pd, v.dr, "circle", "1"), pad(2, x2, 0, v.pd, v.dr, "circle", "2")];
    const f = fp(`AXIAL-V-D${v.D}-L${v.L}-P${v.P}`, `Axial, standing (vertical): ${v.P} mm lead spacing from its Ø ${v.D} × ${v.L} mm body, ${v.d} mm leads bent at R ${v.R} mm; ${v.Z} mm tall (body on pad 1)`, pads, silk);
    f.box = bbox(pads, silk, Math.max(0.5, 0.25 + v.Z * Math.tan(AXIAL_TILT * Math.PI / 180)));
    f.mount = "V"; f.vert = v; f.zHeight = v.Z;
    return f;
  }
  // film capacitors: a box, metric lead spacing
  const BOX = { 5: [7.2, 3.5], 7.5: [10, 4.5], 10: [13, 5], 15: [18, 7], 22.5: [26.5, 9], 27.5: [31.5, 11] };
  // holes as KiCad's C_Rect: 0.8 mm at 5 mm (0.5 mm leads), 1.0 at 7.5 and 10 mm, 1.2 from 15 mm (0.8–1.0 mm leads)
  function box(pitch, body) {
    const b = body || {}, L = b.l > 0 ? b.l : BOX[pitch][0], W = b.w > 0 ? b.w : BOX[pitch][1], h = pitch / 2, [d, dr] = pitch >= 15 ? [2.4, 1.2] : pitch >= 7.5 ? [2, 1] : [1.6, 0.8];
    return fp(`BOX-${pitch}`, `Film capacitor, ${pitch} mm lead spacing`, [pad(1, -h, 0, d, dr), pad(2, h, 0, d, dr)], [{ t: "rect", x: -L / 2, y: -W / 2, w: L, h: W }]);
  }
  // electrolytics: radial, diameter / lead spacing; pad 1 (square) is +
  const RADIAL = [[5, 2], [6.3, 2.5], [8, 3.5], [10, 5], [12.5, 5], [16, 7.5], [18, 7.5], [22, 10], [25, 10], [30, 10], [35, 10]];
  function radial(D, P, body) {
    // the 2 and 2.5 mm pitches take 1.6 mm pads (0.8 mm drill) as KiCad's CP_Radial do: 1.8 mm pads left 0.2 mm between them;
    // Ø10 a 1.0 mm drill and Ø12.5–18 1.2 mm for their 0.6 and 0.8 mm leads, as KiCad's
    const big = D >= 22, small = P <= 2.5, [d, dr] = big ? [2.6, 1.4] : small ? [1.6, 0.8] : D >= 12.5 ? [2.4, 1.2] : D >= 10 ? [2, 1] : [1.8, 0.9];
    const R = body && body.d > 0 ? body.d / 2 : D / 2;
    return fp(`RADIAL-D${D}-P${P}`, `Electrolytic, Ø${D} mm, ${P} mm lead spacing (+ at the square pad)`,
      [pad(1, -P / 2, 0, d, dr, "rect", "+"), pad(2, P / 2, 0, d, dr, "circle", "-")],
      [{ t: "circle", x: 0, y: 0, r: R }, { t: "line", x1: -D / 2 - 1.2, y1: -D / 2, x2: -D / 2 - 1.2, y2: -D / 2 + 2 }, { t: "line", x1: -D / 2 - 2.2, y1: -D / 2 + 1, x2: -D / 2 - 0.2, y2: -D / 2 + 1 }]);
  }
  // transistors: the order is the pins from pad 1 (e.g. "EBC"), as printed in the maker's drawing
  // oval pads 1.05 × 1.5 mm (as in KiCad's TO-92_Inline): round 1.4 mm pads on the 1.27 mm pitch would overlap.
  // pitchRing: the pitch leaves a 0.15 mm ring across the oval, so the annular-ring rule does not apply
  function to92(order) {
    return fp(`TO-92-${order}`, `TO-92, pins ${order.split("").join("-")}`, [...order].map((n, i) => ({ ...pad(i + 1, (i - 1) * 1.27, 0, 1.05, 0.75, i ? "circle" : "rect", n), h: 1.5, pitchRing: true })),
      [{ t: "line", x1: -2.4, y1: 1.6, x2: 2.4, y2: 1.6 }, { t: "circle", x: 0, y: 0, r: 2.5, from: 200, to: 340 }]);
  }
  // seen from the top, as the board is: the makers draw the cans from below, pin 1 at the left
  // with the tab beside it, so here pin 1 is at the right and the tab at the lower right
  function to18(order) {   // pins on a 2.54 mm circle, tab next to pin 1
    const pos = [[1.27, 0], [0, -1.27], [-1.27, 0]];
    return fp(`TO-18-${order}`, `TO-18 metal can, pins ${order.split("").join("-")}`, [...order].map((n, i) => pad(i + 1, pos[i][0], pos[i][1], 1.3, 0.7, i ? "circle" : "rect", n)),
      [{ t: "circle", x: 0, y: 0, r: 2.8 }, { t: "line", x1: 2.4, y1: 1.5, x2: 3.2, y2: 2.3 }]);
  }
  // larger metal cans of the germanium era: pins on a 5.08 mm circle as in TO-18's pattern.
  // TO-1 (AC128, OC71 size, Ø 6.1 mm), TO-5 (2N404, Ø 9.1 mm), MP (USSR МП39–МП42, МП25/26:
  // a flanged can, Ø 11.5 mm at the flange)
  const CANS = { "TO-1": [3.05, "TO-1 metal can"], "TO-5": [4.6, "TO-5 metal can"], "MP": [5.75, "MP flanged can (МП)"] };
  function bigCan(pkg, order) {
    const [r, what] = CANS[pkg], pos = [[2.54, 0], [0, -2.54], [-2.54, 0]];
    return fp(`${pkg}-${order}`, `${what}, pins ${order.split("").join("-")}`, [...order].map((n, i) => pad(i + 1, pos[i][0], pos[i][1], 1.5, 0.8, i ? "circle" : "rect", n)),
      [{ t: "circle", x: 0, y: 0, r }, { t: "line", x1: r * 0.86, y1: r * 0.5, x2: r * 0.86 + 0.8, y2: r * 0.5 + 0.8 }]);
  }
  function inline(pkg, pitch, order, L, W, tab, d, dr) {
    // a package with a tab stands behind its pins (the body above the pad row); one without sits over them
    const n = order.length, x0 = -(n - 1) / 2 * pitch, y0 = tab ? -W - (d || 2) / 2 - 0.4 : -W / 2, silk = [{ t: "rect", x: -L / 2, y: y0, w: L, h: W }];
    if (tab) silk.push({ t: "line", x1: -L / 2, y1: y0 + 1.2, x2: L / 2, y2: y0 + 1.2 });
    return fp(`${pkg}-${order}`, `${pkg}, pins ${order.split("").join("-")} (tab at the top)`, [...order].map((c, i) => pad(i + 1, x0 + i * pitch, 0, d || 2, dr || 1.05, i ? "circle" : "rect", c)), silk);
  }
  const to126 = order => inline("TO-126", 2.29, order, 8, 3.2, false);
  // a two-lead TO-220 (TO-220-2, a SiC diode) has its leads where a three-lead one has pins 1 and 3
  const to220 = order => inline("TO-220", order.length === 2 ? 5.08 : 2.54, order, 10.4, 4.6, true);
  // multiwatt TO-220s with staggered leads, standing (KiCad TO-220-5_P3.4x3.7mm_StaggerOdd, the
  // Pentawatt of a TDA2050; TO-220-11_P3.4x5.08mm_StaggerOdd, an LM3886T): 1.7 mm between
  // neighbours, the even pins in the row by the body, the odd ones bent the stagger further out,
  // away from the tab (ST's Pentawatt V drawing: 1, 3, 5 the long leads; TI's NDA0011B)
  function to220Stagger(n) {
    const row = n > 5 ? 5.08 : 3.7, L = n > 5 ? 20 : 10.4, x0 = -(n - 1) / 2 * 1.7, pads = [];
    for (let k = 1; k <= n; k++) pads.push(pad(k, +(x0 + (k - 1) * 1.7).toFixed(3), k % 2 ? row : 0, 1.8, 1.1, k === 1 ? "rect" : "circle"));
    const y0 = -4.6 - 1.3;
    return fp(`TO-220-${n}S`, `TO-220-${n}, staggered leads (${n > 5 ? "TO-220-11, LM3886T" : "Pentawatt, TDA2050"}), tab at the top`, pads,
      [{ t: "rect", x: -L / 2, y: y0, w: L, h: 4.6 }, { t: "line", x1: -L / 2, y1: y0 + 1.2, x2: L / 2, y2: y0 + 1.2 }]);
  }
  // DO-201AD: a 3–5 A axial rectifier (Ø 5.3 × 9.5 mm, leads Ø 1.3 mm), 15.24 mm lead spacing
  function do201() {
    const h = 7.62, L = 9.5, D = 5.3;
    return fp("DO-201AD", "DO-201AD axial rectifier, 15.24 mm lead spacing (band at pad 1, the cathode)", [pad(1, -h, 0, 3.2, 1.6, "rect", "K"), pad(2, h, 0, 3.2, 1.6, "circle", "A")],
      [{ t: "rect", x: -L / 2, y: -D / 2, w: L, h: D }, { t: "line", x1: -h + 1.7, y1: 0, x2: -L / 2, y2: 0 }, { t: "line", x1: L / 2, y1: 0, x2: h - 1.7, y2: 0 }, { t: "line", x1: -L / 2 + 1.2, y1: -D / 2, x2: -L / 2 + 1.2, y2: D / 2 }]);
  }
  // bridge rectifiers: DIP-4 (DF-M: 7.62 × 5.08 mm, + and − on one side) and the inline SIL-4 (B…C2300-1500A:
  // 5 mm pitch, − ~ ~ +, a 19 × 3.5 mm body standing over its pins); the pads named for the pins
  // The others after KiCad's patterns (Diode_Bridge_Vishay_GBU / _KBU, Diode_Bridge_Round_D9.8mm):
  // GBU and KBU flat inline at 5.08 mm, + ~ ~ −; the round WOB on a 5.08 mm square, + ~ − ~.
  const BRIDGE_PINS = { DIP4: ["+", "-", "AC2", "AC1"], SIL4: ["-", "AC1", "AC2", "+"], GBU: ["+", "AC1", "AC2", "-"], KBU: ["+", "AC1", "AC2", "-"], WOB: ["+", "AC1", "-", "AC2"] };
  function bridgeFp(kind) {
    const names = BRIDGE_PINS[kind];
    if (kind === "GBU" || kind === "KBU") {
      const [d, dr, body] = kind === "GBU" ? [3.2, 1.6, { t: "rect", x: -11.3, y: -1.85, w: 22.6, h: 4.4 }] : [2.8, 1.4, { t: "rect", x: -11.9, y: -2.3, w: 23.8, h: 7.75 }];
      return fp(`BRIDGE-${kind}`, `Bridge rectifier, ${kind} (5.08 mm pitch, ${kind === "GBU" ? "22 × 4" : "23 × 7"} mm body standing over its pins), pins + ~ ~ −`,
        names.map((n, i) => pad(i + 1, -7.62 + i * 5.08, 0, d, dr, i ? "circle" : "rect", n)), [body, { t: "line", x1: body.x + 1, y1: body.y, x2: body.x + 1, y2: body.y + body.h }]);
    }
    if (kind === "WOB") {
      const at = [[-2.54, -2.54], [-2.54, 2.54], [2.54, 2.54], [2.54, -2.54]];
      return fp("BRIDGE-WOB", "Bridge rectifier, round WOB (Ø 9.8 mm, pins on a 5.08 mm square), pins + ~ − ~", names.map((n, i) => pad(i + 1, at[i][0], at[i][1], 2, 1, i ? "circle" : "rect", n)),
        [{ t: "circle", x: 0, y: 0, r: 4.9 }, { t: "line", x1: -4.9, y1: -4.9, x2: -3.5, y2: -4.9 }, { t: "line", x1: -4.2, y1: -5.6, x2: -4.2, y2: -4.2 }]);
    }
    if (kind === "DIP4") {
      const at = [[-3.81, -2.54], [-3.81, 2.54], [3.81, 2.54], [3.81, -2.54]];
      return fp("BRIDGE-DIP4", "Bridge rectifier, DIP-4 (7.62 × 5.08 mm), pins + − ~ ~", names.map((n, i) => pad(i + 1, at[i][0], at[i][1], 1.8, 0.9, i ? "circle" : "rect", n)),
        [{ t: "rect", x: -2.5, y: -4.2, w: 5, h: 8.4 }, { t: "line", x1: -2.5, y1: -3.2, x2: -1.5, y2: -4.2 }]);
    }
    return fp("BRIDGE-SIL4", "Bridge rectifier, inline SIL-4 (5 mm pitch), pins − ~ ~ +", names.map((n, i) => pad(i + 1, -7.5 + i * 5, 0, 2.4, 1.2, i ? "circle" : "rect", n)),
      [{ t: "rect", x: -9.5, y: -1.75, w: 19, h: 3.5 }]);
  }
  const to247 = order => inline("TO-247", 5.45, order, 15.9, 5, true, 2.6, 1.4);
  const to3p = order => inline("TO-3P", 5.45, order, 15.6, 4.8, true, 2.8, 1.5);     // Toshiba TO-3P(N), Hitachi 2SK1058
  const to264 = order => inline("TO-264", 5.45, order, 19.8, 5, true, 3, 1.6);       // TO-264 / TO-3P(L): 2SC5200, MJL3281A
  function led5() {
    return fp("LED-5MM", "LED 5 mm (flat side and square pad: cathode)", [pad(1, -1.27, 0, 1.8, 0.9, "rect", "K"), pad(2, 1.27, 0, 1.8, 0.9, "circle", "A")],
      [{ t: "circle", x: 0, y: 0, r: 2.9 }, { t: "line", x1: -2.9, y1: -1.6, x2: -2.9, y2: 1.6 }]);
  }
  function led3() {
    return fp("LED-3MM", "LED 3 mm (flat side and square pad: cathode)", [pad(1, -1.27, 0, 1.6, 0.8, "rect", "K"), pad(2, 1.27, 0, 1.6, 0.8, "circle", "A")],
      [{ t: "circle", x: 0, y: 0, r: 2.4 }, { t: "line", x1: -2.4, y1: -1.2, x2: -2.4, y2: 1.2 }]);
  }
  // potentiometers, board mount, pins 1 · wiper · 2 in a row, the shaft above them
  const POTS = { "9MM": [2.5, 9.8, 10, 1.8, 1.0, 3.5, "Alpha 9 mm"], "16MM": [5, 16, 15, 2.2, 1.2, 3.5, "Alpha 16 mm"], "24MM": [7.5, 24, 22, 2.6, 1.4, 3.5, "24 mm (Alps RK27 style)"] };
  function pot(size) {
    const [P, W, H, d, dr, sh, t] = POTS[size];
    return fp(`POT-${size}`, `Potentiometer ${t}, board mount (1 · wiper · 2)`, [pad(1, -P, 0, d, dr, "rect", "1"), pad(2, 0, 0, d, dr, "circle", "W"), pad(3, P, 0, d, dr, "circle", "2")],
      [{ t: "rect", x: -W / 2, y: -H - 2, w: W, h: H }, { t: "circle", x: 0, y: -H / 2 - 2, r: sh }]);
  }
  function trim3296() {
    return fp("TRIM-3296W", "Trimmer 3296W, 9.5 × 4.8 mm, pins 2.54 mm (1 · wiper · 2)", [pad(1, -2.54, 0, 1.6, 0.8, "rect", "1"), pad(2, 0, 0, 1.6, 0.8, "circle", "W"), pad(3, 2.54, 0, 1.6, 0.8, "circle", "2")],
      [{ t: "rect", x: -4.75, y: -2.4, w: 9.5, h: 4.8 }, { t: "circle", x: -3.9, y: -1.5, r: 0.6 }]);
  }
  // ceramic disc and silver mica capacitors (the small values in valve circuits)
  function disc(pitch) {   // the 7.62 mm ones (high-voltage discs) with 0.6–0.8 mm leads a 1.0 mm drill, as KiCad's C_Disc P7.50
    const [d, dr] = pitch > 7 ? [2, 1] : [1.6, 0.8];
    return fp(`DISC-${pitch}`, `Ceramic disc / silver mica, ${pitch} mm lead spacing`, [pad(1, -pitch / 2, 0, d, dr), pad(2, pitch / 2, 0, d, dr)],
      [{ t: "rect", x: -pitch / 2 - 1.6, y: -1.4, w: pitch + 3.2, h: 2.8 }]);
  }
  // axial electrolytics (the classic can, lying down) and snap-in cans for the HT reservoir
  const ECAP_AXIAL = { 20.32: [12, 8], 25.4: [16, 10], 30.48: [20, 13], 40.64: [30, 16], 50.8: [38, 22] };
  function ecapAxial(pitch) {
    const [L, D] = ECAP_AXIAL[pitch], h = pitch / 2;
    return fp(`ECAP-AXIAL-${pitch}`, `Axial electrolytic Ø${D} × ${L} mm, ${pitch} mm lead spacing (+ at the square pad)`,
      [pad(1, -h, 0, 2.2, 1.1, "rect", "+"), pad(2, h, 0, 2.2, 1.1, "circle", "-")],
      [{ t: "rect", x: -L / 2, y: -D / 2, w: L, h: D }, { t: "line", x1: -h + 1.4, y1: 0, x2: -L / 2, y2: 0 }, { t: "line", x1: L / 2, y1: 0, x2: h - 1.4, y2: 0 }, { t: "line", x1: -L / 2 + 1.5, y1: -D / 2 + 1.5, x2: -L / 2 + 3.5, y2: -D / 2 + 1.5 }, { t: "line", x1: -L / 2 + 2.5, y1: -D / 2 + 0.5, x2: -L / 2 + 2.5, y2: -D / 2 + 2.5 }]);
  }
  const SNAPIN = [20, 22, 25, 30, 35, 40];
  function snapin(D, body) {
    return fp(`SNAPIN-D${D}`, `Snap-in electrolytic Ø${D} mm, 10 mm pin spacing (+ at the square pad)`,
      [pad(1, -5, 0, 3.2, 2.0, "rect", "+"), pad(2, 5, 0, 3.2, 2.0, "circle", "-")],
      [{ t: "circle", x: 0, y: 0, r: body && body.d > 0 ? body.d / 2 : D / 2 }, { t: "line", x1: -D / 2 + 2, y1: -3, x2: -D / 2 + 5, y2: -3 }, { t: "line", x1: -D / 2 + 3.5, y1: -4.5, x2: -D / 2 + 3.5, y2: -1.5 }]);
  }
  // screw terminal blocks: 5.08 mm, or 7.5 mm for mains; the pads take the part's pin names
  function terminal(pitch, names) {
    const n = names.length, x0 = -(n - 1) / 2 * pitch, big = pitch >= 7, d = big ? 3.0 : 2.6, dr = big ? 1.5 : 1.3, W = n * pitch, H = big ? 10 : 8;
    return fp(`TERM-${pitch}-${n}`, `Screw terminal, ${n} way, ${pitch} mm pitch (wire entry at the top)`, names.map((nm, i) => pad(i + 1, x0 + i * pitch, 0, d, dr, i ? "circle" : "rect", nm)),
      [{ t: "rect", x: -W / 2, y: -H / 2, w: W, h: H }, { t: "line", x1: -W / 2, y1: -H / 2 + 1.5, x2: W / 2, y2: -H / 2 + 1.5 }]);
  }
  // board-mount jacks: input (RCA, 3.5 mm) and speaker / input (6.35 mm); tip is +, sleeve −
  function jack(kind) {
    if (kind === "RCA") return fp("JACK-RCA", "RCA (phono) socket, board mount, front at the bottom", [pad(1, 0, 0, 2.4, 1.3, "rect", "+"), pad(2, -3.5, 5, 3, 1.8, "circle", "-")],
      [{ t: "rect", x: -6, y: -3, w: 12, h: 13 }, { t: "line", x1: -4, y1: 10, x2: -4, y2: 13 }, { t: "line", x1: 4, y1: 10, x2: 4, y2: 13 }, { t: "line", x1: -4, y1: 13, x2: 4, y2: 13 }]);
    if (kind === "3.5") return fp("JACK-3.5", "3.5 mm jack, board mount (tip +, ring unused, sleeve −), front at the bottom", [pad(1, 2.5, -2, 1.8, 1.0, "rect", "+"), pad(2, 0, 3, 1.8, 1.0, "circle", "R"), pad(3, -2.5, -2, 1.8, 1.0, "circle", "-")],
      [{ t: "rect", x: -4.5, y: -6, w: 9, h: 14 }, { t: "rect", x: -2.5, y: 8, w: 5, h: 2.5 }]);
    return fp("JACK-6.35", "6.35 mm (1/4\") jack, board mount (tip +, sleeve −, switch unused), front at the bottom", [pad(1, 5, -6, 2.6, 1.5, "rect", "+"), pad(2, -5, -6, 2.6, 1.5, "circle", "-"), pad(3, 5, 0, 2.6, 1.5, "circle", "SW")],
      [{ t: "rect", x: -8, y: -11, w: 16, h: 21 }, { t: "rect", x: -5, y: 10, w: 10, h: 3 }]);
  }
  // Neutrik NJ…FD-V 6.35 mm jacks, vertical (KiCad Jack_6.35mm_Neutrik_NJ2FD-V / NJ3FD-V /
  // NJ5FD-V): the plug goes in from above; two plastic pegs locate the body in unplated holes
  // (Ø 1.6 and Ø 2.1 mm). NJ2: tip, sleeve; NJ3: tip, ring, sleeve; NJ5: and the tip's and the
  // ring's normalling contacts, TN (the switched jack's SW) and RN
  const NJFD = { 2: [["+", 0, 0], ["-", -5.08, 5.72]], 3: [["+", 0, 0], ["R", 5.08, 5.72], ["-", -5.08, 5.72]], 5: [["+", 0, 0], ["SW", -5.08, 0.64], ["R", 5.08, 5.72], ["RN", 4.45, 10.17], ["-", -5.08, 5.72]] };
  function njfd(n) {
    const pads = NJFD[n].map(([nm, x, y], i) => pad(i + 1, x, y, nm === "+" || nm === "SW" || nm === "RN" ? 3 : 3.4, nm === "+" || nm === "SW" || nm === "RN" ? 1.2 : 1.6, i ? "circle" : "rect", nm));
    return fp(`JACK-NJ${n}FD-V`, `Neutrik NJ${n}FD-V, 6.35 mm ${n === 2 ? "mono" : n === 3 ? "stereo" : "stereo, tip and ring switched"} jack, vertical (plug from above), two locating pegs`, pads,
      [{ t: "rect", x: -7.75, y: -2.28, w: 15.5, h: 16 }], [{ x: -3.18, y: 12.07, d: 1.6 }, { x: 3.81, y: 1.91, d: 2.1 }]);
  }
  // Neutrik M-series 6.35 mm jacks, horizontal (KiCad Jack_6.35mm_Neutrik_NMJ4HCD2 / NMJ6HCD2): tip,
  // sleeve and their switch contacts in two rows 16.23 mm apart, the ferrule (the front) to the left
  function neutrik(stereo) {
    const cx = 6.395, cy = 8.115, P = (n, x, y, name) => pad(n, +(x - cx).toFixed(3), +(y - cy).toFixed(3), 3, 1.4, n === 1 ? "rect" : "circle", name);
    const pads = [P(1, 0, 0, "+"), P(2, 12.7, 0, "-"), P(3, 0, 16.23, "SW"), P(4, 12.7, 16.23, "SN")];
    if (stereo) pads.push(P(5, 6.35, 0, "R"), P(6, 6.35, 16.23, "RN"));
    return fp(stereo ? "JACK-NMJ6HCD2" : "JACK-NMJ4HCD2", `Neutrik ${stereo ? "NMJ6HCD2, 6.35 mm stereo" : "NMJ4HCD2, 6.35 mm mono"} jack, switched, horizontal (front to the left)`, pads,
      [{ t: "rect", x: -3.91 - cx, y: -1.985 - cy, w: 20.61, h: 20.2 }, { t: "rect", x: -6.83 - cx, y: 3.765 - cy, w: 2.92, h: 8.7 }]);
  }
  // straight pin headers, 2.54 mm (KiCad PinHeader_1xNN_P2.54mm_Vertical: Ø 1.7 mm pads, 1 mm drills), in a row
  function header(n) {
    const x0 = -(n - 1) / 2 * 2.54;
    return fp(`HEADER-1x${n}`, `Pin header 1 × ${n}, 2.54 mm, straight`, Array.from({ length: n }, (_, i) => pad(i + 1, x0 + i * 2.54, 0, 1.7, 1, i ? "circle" : "rect", String(i + 1))),
      [{ t: "rect", x: x0 - 1.27, y: -1.27, w: n * 2.54, h: 2.54 }]);
  }
  // board-mount quick-connect tabs, one pin each (Keystone 1287: 6.3 mm tab, 1.32 mm hole; 1285: 4.8 mm, 1.17 mm)
  function faston(size) {
    const big = size === "6.3", w = big ? 6.35 : 4.75;
    return fp(`FASTON-${size}`, `Quick-connect tab ${size} mm (Keystone ${big ? "1287" : "1285"}), board mount`, [pad(1, 0, 0, big ? 2.8 : 2.4, big ? 1.35 : 1.2, "rect", "1")],
      [{ t: "rect", x: -w / 2 - 0.8, y: -2, w: w + 1.6, h: 4 }, { t: "line", x1: -w / 2, y1: 0, x2: -2.2, y2: 0 }, { t: "line", x1: 2.2, y1: 0, x2: w / 2, y2: 0 }]);
  }
  // fuse holders: clips for 5 × 20 mm (Littelfuse 519, pins 5 mm apart, clips 20.6 mm) and 6.3 × 32 mm
  // (Littelfuse 102071, 7.6 and 34.7 mm) cartridges, each clip on two pins; a TR5 subminiature fuse
  // (Littelfuse 372/395, Ø 8.5 mm, 5.08 mm)
  const FUSES = { "5X20": [20.6, 5, 2, 1, 20, 5.2, "5 × 20 mm, Littelfuse 519 clips"], "6.3X32": [34.7, 7.6, 3, 2, 32, 6.6, "6.3 × 32 mm, Littelfuse 102071 clips"] };
  function fuseFp(kind) {
    if (kind === "TR5") return fp("FUSE-TR5", "TR5 subminiature fuse (Ø 8.5 mm), 5.08 mm, or its socket", [pad(1, -2.54, 0, 2, 1, "rect", "1"), pad(2, 2.54, 0, 2, 1, "circle", "2")], [{ t: "circle", x: 0, y: 0, r: 4.25 }]);
    const [L, P, d, dr, , D, t] = FUSES[kind], h = L / 2;
    return fp(`FUSE-${kind}`, `Fuse holder for ${t}`, [pad(1, -h, 0, d, dr, "rect", "1"), pad(2, +(-h + P).toFixed(3), 0, d, dr, "rect", "1"), pad(3, +(h - P).toFixed(3), 0, d, dr, "circle", "2"), pad(4, h, 0, d, dr, "circle", "2")],
      [{ t: "rect", x: -h - d / 2 - 0.5, y: -D / 2 - 0.3, w: L + d + 1, h: D + 0.6 }, { t: "line", x1: -h + P + d / 2 + 0.6, y1: 0, x2: h - P - d / 2 - 0.6, y2: 0 }]);
  }
  // disc parts standing on two leads, seen from above (the disc edge-on): varistors (MOV, KiCad
  // RV_Disc) and inrush thermistors (NTC); Ø d, lead pitch p, the disc's thickness w
  function discPart(kind, d, p, w, lead) {
    const dr = +(lead + 0.4).toFixed(2), pd = Math.max(1.8, dr + 0.9);
    return fp(`${kind}-D${d}-P${p}`, `${kind === "MOV" ? "Varistor" : "Inrush NTC thermistor"} disc Ø ${d} mm, ${p} mm lead pitch`, [pad(1, -p / 2, 0, pd, dr, "rect", "1"), pad(2, p / 2, 0, pd, dr, "circle", "2")],
      [{ t: "rect", x: -d / 2, y: -w / 2, w: d, h: w }]);
  }
  // relays, KiCad's Relay_THT patterns (the datasheet's pin numbers), each pad named for the part's
  // pin: coil A1 A2, poles COM 11/21, NC 12/22, NO 14/24
  const RELAY_FP = {
    "G5LE-1": { pads: [[1, 0, 0, "11"], [2, -6, 2, "A1"], [3, -6, 14.2, "14"], [4, 6, 14.2, "12"], [5, 6, 2, "A2"]], d: 2.5, dr: 1.3, box: [-8.5, -2.91, 17, 23.11], title: "Omron G5LE-1 relay, SPDT (KiCad Relay_SPDT_Omron-G5LE-1)" },
    "G5V-2": { pads: [[1, 0, 0, "A1"], [4, 0, 7.62, "11"], [6, 0, 12.7, "12"], [8, 0, 17.78, "14"], [9, 7.62, 17.78, "24"], [11, 7.62, 12.7, "22"], [13, 7.62, 7.62, "21"], [16, 7.62, 0, "A2"]], d: 1.4, dr: 0.7, box: [-1.54, -1.55, 10.64, 20.85], title: "Omron G5V-2 relay, DPDT (KiCad Relay_DPDT_Omron_G5V-2)" }
  };
  function relayFp(k) {
    const r = RELAY_FP[k];
    return fp(`RELAY-${k}`, r.title, r.pads.map(([n, x, y, nm], i) => pad(n, x, y, r.d, r.dr, i ? "circle" : "rect", nm)), [{ t: "rect", x: r.box[0], y: r.box[1], w: r.box[2], h: r.box[3] }]);
  }
  // a vactrol (KiCad OptoDevice PerkinElmer_VTL5C): the LED's leads (K pin 1, A pin 2) at one end of
  // the body, the cell's at the other
  const vtl5c = () => fp("VTL5C", "Vactrol VTL5C, axial (KiCad PerkinElmer_VTL5C)", [pad(1, 0, 0, 1.4, 0.7, "rect", "K"), pad(2, 0, 3.8, 1.4, 0.7, "circle", "A"), pad(3, 15, -0.64, 1.4, 0.7, "circle", "1"), pad(4, 15, 4.44, 1.4, 0.7, "circle", "2")],
    [{ t: "rect", x: 2.5, y: -1.6, w: 10, h: 7.2 }]);
  // a neon lamp (NE-2: a 6 mm bulb) standing on its two leads, 2.54 mm apart
  const neonFp = () => fp("NEON-T2", "Neon lamp NE-2, standing (6.4 mm bulb), leads 2.54 mm", [pad(1, 0, 0, 1.6, 0.8, "rect", "A"), pad(2, 2.54, 0, 1.6, 0.8, "circle", "K")],
    [{ t: "circle", x: 1.27, y: 0, r: 3.3 }]);
  // a 6 mm tactile push button (KiCad SW_PUSH_6mm): each side's two pads joined inside
  const push6 = () => fp("SW-PUSH-6MM", "Tactile push button 6 × 6 mm (KiCad SW_PUSH_6mm)", [pad(1, 0, 0, 2, 1.1, "rect", "1"), pad(2, 6.5, 0, 2, 1.1, "circle", "1"), pad(3, 0, 4.5, 2, 1.1, "circle", "2"), pad(4, 6.5, 4.5, 2, 1.1, "circle", "2")],
    [{ t: "rect", x: 0.25, y: -0.75, w: 6, h: 6 }, { t: "circle", x: 3.25, y: 2.25, r: 1.75 }]);
  // toggle switches, board mount: SPDT (A · C · B) or DPDT (two rows, one per section)
  function toggle(poles) {
    const pads = [];
    for (let k = 0; k < poles; k++) ["A", "C", "B"].forEach((nm, i) => pads.push(pad(pads.length + 1, (i - 1) * 4.7, (k - (poles - 1) / 2) * 4.7, 2.6, 1.6, pads.length ? "circle" : "rect", poles > 1 ? `${k + 1}.${nm}` : nm)));
    return fp(`TOGGLE-${poles > 1 ? "DPDT" : "SPDT"}`, `Toggle switch ${poles > 1 ? "DPDT" : "SPDT"}, board mount (A · common · B${poles > 1 ? ", one row per section" : ""})`, pads,
      [{ t: "rect", x: -6.5, y: -4 - (poles - 1) * 2.35, w: 13, h: 8 + (poles - 1) * 4.7 }]);
  }
  // EI-core transformers and chokes, board mount: the pin rows on the two long sides.
  // Kinds: SE (P1 P2 | S1 S2), PP (P1 U1 CT U2 P2 | S1 S2), PT (mains AC1 AC2 | HT1 CT HT2),
  // PTP (P1 P2 | HT1 CT HT2), IS (P1 P2 | S1 SC S2); CHOKE: 1 2.
  const EI = [30, 38, 42, 48, 54, 66, 76, 96];
  const XF = { SE: [["P1", "P2"], ["S1", "S2"], "single-ended output transformer"], PP: [["P1", "U1", "CT", "U2", "P2"], ["S1", "S2"], "push-pull output transformer"],
    PT: [["AC1", "AC2"], ["HT1", "CT", "HT2"], "power transformer (mains primary AC1–AC2)"], PTP: [["P1", "P2"], ["HT1", "CT", "HT2"], "power transformer"], IS: [["P1", "P2"], ["S1", "SC", "S2"], "interstage transformer, centre-tapped secondary"], CHOKE: [["1", "2"], [], "choke"] };
  function ei(size, kind) {
    const [top, bot, what] = XF[kind], W = size, D = Math.round(size * 0.85), big = size >= 54, pitch = size <= 42 ? 5.08 : 7.62;
    const d = big ? 3.0 : 2.4, dr = big ? 1.6 : 1.2, pads = [];
    [[top, -D / 2 + 3], [bot, D / 2 - 3]].forEach(([row, y]) => row.forEach((nm, i) => pads.push(pad(pads.length + 1, (i - (row.length - 1) / 2) * pitch, y, d, dr, pads.length ? "circle" : "rect", nm))));
    const name = kind === "CHOKE" ? `CHOKE-EI${size}` : `XFMR-EI${size}-${kind}`;
    return fp(name, `EI${size} ${what}, board mount, ${W} × ${D} mm`, pads,
      [{ t: "rect", x: -W / 2, y: -D / 2, w: W, h: D }, { t: "rect", x: -W * 0.3, y: -D / 2 + 6, w: W * 0.6, h: D - 12 }]);
  }
  // Tube sockets, top (component) side. Viewed from below, the pins run clockwise from the
  // gap or key; seen from above that is counter-clockwise, so pin k sits at 90° − k·step
  // (screen angles, y down: 90° points down at the gap).
  const SOCKETS = {
    "B9A": { title: "Noval (B9A)", n: 9, dia: 11.89, step: 36, offset: 0, body: 22, drill: 1.3, padD: 2.4 },
    "B7G": { title: "Miniature 7-pin (B7G)", n: 7, dia: 9.53, step: 45, offset: 0, body: 18, drill: 1.2, padD: 2.2 },
    "B9D": { title: "Magnoval (B9D)", n: 9, dia: 17.45, step: 36, offset: 0, body: 30, drill: 1.6, padD: 2.8 },
    "OCTAL": { title: "Octal (K8A)", n: 8, dia: 17.45, step: 45, offset: -0.5, body: 34, drill: 2.0, padD: 3.4 },
    "UX4": { title: "UX4 4-pin", n: 4, dia: 22.2, step: 90, offset: -0.5, body: 38, drill: 3.4, padD: 5 },
    "UX6": { title: "UX6 6-pin", n: 6, dia: 19.05, step: 60, offset: -0.5, body: 38, drill: 3.4, padD: 5 }
  };
  // A valve with its anode (or a rectifier's) on a top cap: one more pad, "cap", behind the socket
  // (away from its key) for the lead from the cap.
  function socket(kind, nPins, cap) {
    const s = SOCKETS[kind] || { title: `${nPins}-pin socket`, n: nPins, dia: 15, step: 360 / (nPins + 1), offset: 0, body: 26, drill: 1.3, padD: 2.4 };
    const pads = [];
    for (let k = 1; k <= s.n; k++) {
      const a = (90 - (k + s.offset) * s.step) * Math.PI / 180;
      pads.push(pad(k, +(s.dia / 2 * Math.cos(a)).toFixed(3), +(s.dia / 2 * Math.sin(a)).toFixed(3), s.padD, s.drill, k === 1 ? "rect" : "circle"));
    }
    const silk = [{ t: "circle", x: 0, y: 0, r: s.body / 2 }, { t: "circle", x: 0, y: 0, r: s.dia / 2 - s.padD }];
    silk.push({ t: "line", x1: 0, y1: s.body / 2 - 2.5, x2: 0, y2: s.body / 2 + 0.5 });   // the gap / key, down
    if (cap) {
      const y = -s.body / 2 - 3.5;
      pads.push(pad("cap", 0, y, 3, 1.3, "circle", "cap"));
      silk.push({ t: "circle", x: 0, y, r: 2.6 });
    }
    return fp(`${SOCKETS[kind] ? `SOCKET-${kind}` : `SOCKET-${nPins}`}${cap ? "-CAP" : ""}`, `Tube socket, ${s.title}, top view${cap ? ", with a pad for the top-cap lead" : ""}`, pads, silk);
  }
  // wires to a chassis-mounted part (transformer, choke, speaker, pot, jack, mains, supply)
  function wirePads(names) {
    const n = names.length, x0 = -(n - 1) / 2 * 5.08;
    return fp(`WIRE-${n}`, `${n} wire pad${n > 1 ? "s" : ""} to a chassis-mounted part`, names.map((nm, i) => pad(i + 1, x0 + i * 5.08, 0, 2.8, 1.3, i ? "circle" : "rect", nm)),
      [{ t: "rect", x: x0 - 2.3, y: -2.3, w: (n - 1) * 5.08 + 4.6, h: 4.6 }]);
  }

  // the star ground point: one plated hole for a solder lug or a ring terminal bolted to the chassis
  // dual in-line package, 2.54 mm pitch, rows 7.62 mm apart: pin 1 top left (square), counted
  // down the left row and up the right one (from the component side), the notch at the top
  function dip(n) {
    const h = n / 2, y0 = -(h - 1) / 2 * 2.54, L = h * 2.54 + 0.6;
    const pads = Array.from({ length: n }, (_, i) => i < h ? pad(i + 1, -3.81, y0 + i * 2.54, 1.6, 0.8, i ? "circle" : "rect") : pad(i + 1, 3.81, y0 + (n - 1 - i) * 2.54, 1.6, 0.8, "circle"));
    return fp(`DIP-${n}`, `DIP-${n}, 2.54 mm pitch, rows 7.62 mm apart (pin 1 square, the notch at the top)`, pads,
      [{ t: "rect", x: -2.6, y: -L / 2, w: 5.2, h: L }, { t: "circle", x: 0, y: -L / 2, r: 0.9, from: 0, to: 180 }]);
  }
  function starPoint(size) {
    const D = size === "M4" ? 8 : 7, drill = size === "M4" ? 4.3 : 3.4;
    return fp(`STAR-${size}`, `Star ground point: a plated ${size} hole for a solder lug or ring terminal`, [pad(1, 0, 0, D, drill, "circle", "GND")], [{ t: "circle", x: 0, y: 0, r: D / 2 + 0.5 }]);
  }

  // ---------------------------------------------------------------------------
  // Surface-mount footprints: pads on one copper layer only (the part's side), no drill. The pad
  // sizes follow IPC-7351 nominal lands as KiCad's libraries have them; fp.smd marks the footprint.
  // ---------------------------------------------------------------------------
  const smdPad = (num, x, y, w, h, name) => ({ num: String(num), name: name || String(num), x, y, shape: "rect", w, h, drill: 0, smd: true });
  // how far a rectangular pad reaches from its centre along x as the checks see it (a capsule 15 % wider than the pad)
  const reachX = p => { const r = Math.min(p.w, p.h) / 2; return p.w >= p.h ? p.w / 2 + 0.15 * r : 1.15 * r; };
  const reachY = p => { const r = Math.min(p.w, p.h) / 2; return p.h > p.w ? p.h / 2 + 0.15 * r : 1.15 * r; };
  const smdFp = (name, title, pads, silk) => ({ name, title, pads, silk, box: bbox(pads, silk, 0.25), smd: true });
  // chip resistors, capacitors and inductors (EIA inch codes): body L × W × H; pads w × h at ±x
  const CHIPS = {
    "0603": [1.6, 0.8, 0.45, 0.8, 0.95, 0.825], "0805": [2.0, 1.25, 0.5, 1.0, 1.45, 0.95], "1206": [3.2, 1.6, 0.55, 1.15, 1.8, 1.475],
    "1210": [3.2, 2.5, 0.6, 1.15, 2.7, 1.475], "1812": [4.5, 3.2, 1.1, 1.35, 3.4, 2.1], "2010": [5.0, 2.5, 0.6, 1.25, 2.65, 2.4],
    "2220": [5.7, 5.0, 1.6, 1.5, 5.3, 2.65], "2512": [6.3, 3.2, 0.6, 1.55, 3.4, 3.0]
  };
  // two-pad lands: the silkscreen above and below the body, a bar beside pad 1 (the cathode, the +) when polar
  function twoPad(name, title, xc, w, h, L, W, names, polar) {
    const yl = Math.max(h, W) / 2 + 0.2, xl = Math.max(L / 2, xc + w / 2), silk = [{ t: "line", x1: -xl, y1: -yl, x2: xl, y2: -yl }, { t: "line", x1: -xl, y1: yl, x2: xl, y2: yl }];
    if (polar) silk.push({ t: "line", x1: -xc - w / 2 - 0.5, y1: -yl, x2: -xc - w / 2 - 0.5, y2: yl });
    return smdFp(name, title, [smdPad(1, -xc, 0, w, h, names[0]), smdPad(2, xc, 0, w, h, names[1])], silk);
  }
  function chip(code, led) {
    const [L, W, , w, h, xc] = CHIPS[code];
    return twoPad(`${led ? "LED" : "CHIP"}-${code}`, led ? `SMD LED ${code} (the bar and pad 1: cathode)` : `SMD chip ${code} (${L} × ${W} mm), resistor, capacitor or inductor`, xc, w, h, L, W, led ? ["K", "A"] : ["1", "2"], led);
  }
  // diode packages, pad 1 the cathode (the band): body L × W × H, pads w × h at ±x
  const SMD_DIODES = {
    "SOD-323": [1.7, 1.25, 0.95, 0.65, 0.55, 1.15, "SOD-323"], "SOD-123": [2.7, 1.6, 1.1, 0.9, 1.2, 1.65, "SOD-123"], "MINIMELF": [3.5, 1.5, 1.5, 1.2, 1.6, 1.75, "MiniMELF (SOD-80)"],
    "SMA": [4.3, 2.6, 2.1, 2.5, 1.7, 2.0, "SMA (DO-214AC)"], "SMB": [4.3, 3.6, 2.2, 2.5, 2.3, 2.15, "SMB (DO-214AA)"], "SMC": [6.9, 5.9, 2.3, 3.3, 3.3, 3.4, "SMC (DO-214AB)"]
  };
  function smdDiode(pkg) {
    const [L, W, , w, h, xc, t] = SMD_DIODES[pkg];
    return twoPad(pkg, `${t} diode (the bar and pad 1: cathode)`, xc, w, h, L, W, ["K", "A"], true);
  }
  // SMD aluminium electrolytics (V-chip): the square plastic base, pad 1 the +; [x, w, h, can height]
  const SMD_ECAP = { 4: [1.8, 2.6, 1.6, 5.4], 5: [2.2, 3.0, 1.6, 5.4], 6.3: [2.7, 3.3, 1.6, 5.4], 8: [3.5, 4.2, 2.2, 10], 10: [4.3, 4.6, 2.5, 10], 12.5: [4.9, 5.4, 2.5, 13.5], 16: [6.4, 6.5, 3.5, 17.5], 18: [7.2, 7.0, 3.5, 17.5] };
  function smdEcap(D) {
    // the base's outline, its sides broken where the pads reach out under them
    const [xc, w, h] = SMD_ECAP[D], b = D / 2 + 0.15, c = Math.min(1.5, D * 0.25), pads = [smdPad(1, -xc, 0, w, h, "+"), smdPad(2, xc, 0, w, h, "-")], yc = reachY(pads[0]) + 0.2;
    return smdFp(`CP-SMD-D${D}`, `SMD electrolytic Ø${D} mm (V-chip; + at pad 1, the cut corners)`, pads,
      [{ t: "line", x1: -b + c, y1: -b, x2: b, y2: -b }, { t: "line", x1: b, y1: -b, x2: b, y2: -yc }, { t: "line", x1: b, y1: yc, x2: b, y2: b }, { t: "line", x1: b, y1: b, x2: -b + c, y2: b }, { t: "line", x1: -b + c, y1: b, x2: -b, y2: b - c },
        { t: "line", x1: -b, y1: b - c, x2: -b, y2: Math.min(b - c, yc) }, { t: "line", x1: -b, y1: -Math.min(b - c, yc), x2: -b, y2: -b + c }, { t: "line", x1: -b, y1: -b + c, x2: -b + c, y2: -b },
        { t: "line", x1: -b - 1.6, y1: -b - 0.4, x2: -b - 0.4, y2: -b - 0.4 }, { t: "line", x1: -b - 1, y1: -b - 1, x2: -b - 1, y2: -b + 0.2 }]);
  }
  // transistors. SOT-23: pins 1 and 2 along the bottom, 3 alone at the top; the order is the pins
  // from pad 1 (BJTs B-E-C as the MMBT3904, BC847; MOSFETs G-S-D as the 2N7002, BSS84)
  function sot23(order) {
    return smdFp(`SOT-23-${order}`, `SOT-23, pins ${order.split("").join("-")}`, [smdPad(1, -0.95, 1.14, 0.6, 1.33, order[0]), smdPad(2, 0.95, 1.14, 0.6, 1.33, order[1]), smdPad(3, 0, -1.14, 0.6, 1.33, order[2])],
      [{ t: "line", x1: -1.6, y1: -0.7, x2: -1.6, y2: 0.7 }, { t: "line", x1: 1.6, y1: -0.7, x2: 1.6, y2: 0.7 }, { t: "line", x1: -1.6, y1: -0.7, x2: -0.6, y2: -0.7 }, { t: "line", x1: 0.6, y1: -0.7, x2: 1.6, y2: -0.7 }]);
  }
  // packages with a tab: pins 1 · 2 · 3 in a row at the bottom, the tab (pin 2's electrode: the
  // collector or drain) a large pad above them. SOT-89 (LND150N8, DN2540N8), SOT-223 (BCP56),
  // DPAK / TO-252 and D²PAK / TO-263 (the middle lead cut off: the tab is pin 2)
  const TABBED = {
    "SOT-89": { pins: 3, pitch: 1.5, py: 1.9, pw: 0.9, ph: 1.3, ty: -0.6, tw: 2.0, th: 2.2, body: [4.5, 2.5, 1.5], title: "SOT-89" },
    "SOT-223": { pins: 3, pitch: 2.3, py: 3.15, pw: 1.0, ph: 2.0, ty: -3.15, tw: 3.3, th: 2.0, body: [6.5, 3.5, 1.6], title: "SOT-223" },
    "DPAK": { pins: 2, pitch: 2.28, py: 3.5, pw: 1.2, ph: 2.2, ty: -1.6, tw: 6.0, th: 5.6, body: [6.6, 6.1, 2.3], title: "DPAK (TO-252)" },
    "D2PAK": { pins: 2, pitch: 2.54, py: 5.0, pw: 1.4, ph: 3.0, ty: -1.5, tw: 10.6, th: 8.4, body: [10.2, 9.0, 4.4], title: "D²PAK (TO-263)" }
  };
  function tabbed(pkg, order) {
    const T = TABBED[pkg], pads = [smdPad(1, -T.pitch, T.py, T.pw, T.ph, order[0])];
    if (T.pins === 3) pads.push(smdPad(2, 0, T.py, T.pw, T.ph, order[1]));
    pads.push(smdPad(3, T.pitch, T.py, T.pw, T.ph, order[2]), smdPad(T.pins === 3 ? 4 : 2, 0, T.ty, T.tw, T.th, order[1]));
    // a DPAK's or D²PAK's big tab gets paste on about 70 % of it, in windowpanes: a full sheet floats
    // the part on the molten solder and traps voids (IPC-7525)
    if (T.pins === 2) pads[pads.length - 1].paste = 0.7;
    // the body's sides between the tab and the pins, clear of the pads as the checks see them
    const x = Math.max(T.body[0] / 2, ...pads.map(q => Math.abs(q.x) + reachX(q) + 0.15)), y1 = T.ty - T.th / 2, y2 = T.py - T.ph / 2 - 0.2, xm = T.pitch + reachX(pads[0]) + 0.2;
    return smdFp(`${pkg}-${order}`, `${T.title}, pins ${order.split("").join("-")} (the tab: ${order[1]})`, pads,
      [{ t: "line", x1: -x, y1, x2: -x, y2 }, { t: "line", x1: x, y1, x2: x, y2 }, { t: "line", x1: -xm, y1: T.py, x2: -xm, y2: T.py + T.ph / 2 + 0.3 }]);
  }
  // SOIC, 1.27 mm pitch, the pins numbered as a DIP's (pin 1 top left, the bevelled side)
  function soic(n) {
    const h = n / 2, y0 = -(h - 1) / 2 * 1.27, L = (h - 1) * 1.27 + 1.1;
    const pads = Array.from({ length: n }, (_, i) => (i < h ? smdPad(i + 1, -2.475, y0 + i * 1.27, 1.95, 0.6) : smdPad(i + 1, 2.475, y0 + (n - 1 - i) * 1.27, 1.95, 0.6)));
    return smdFp(`SOIC-${n}`, `SOIC-${n}, 1.27 mm pitch, 3.9 mm body (pin 1 at the top left)`, pads,
      [{ t: "line", x1: -1.95, y1: -L / 2 - 0.3, x2: 1.95, y2: -L / 2 - 0.3 }, { t: "line", x1: -1.95, y1: L / 2 + 0.3, x2: 1.95, y2: L / 2 + 0.3 }, { t: "line", x1: -3.6, y1: y0 - 0.6, x2: -3.6, y2: y0 + 0.6 }]);
  }
  // SMD trimmer, Bourns TC33X style (3 × 3 mm): 1 and 2 at the bottom, the wiper at the top
  function trimTc33() {
    return smdFp("TRIM-TC33", "Trimmer TC33X, SMD 3.8 × 3.6 mm (1 · wiper · 2); check the land against your part's datasheet",
      [smdPad(1, -1.0, 1.45, 1.2, 1.2, "1"), smdPad(2, 0, -1.5, 2.0, 1.3, "W"), smdPad(3, 1.0, 1.45, 1.2, 1.2, "2")],
      [{ t: "line", x1: -1.9, y1: -0.7, x2: -1.9, y2: 0.7 }, { t: "line", x1: 1.9, y1: -0.7, x2: 1.9, y2: 0.7 }]);
  }
  /** A footprint by name ("AXIAL-10.16", "TO-92-EBC", "SOCKET-B9A", "WIRE-3" …) */
  // body: the real part's size ({ l, d, w, h, lead } in mm, from its part number or set by hand):
  // the silkscreen outline and the holes follow it (f.body keeps it for the 3D model)
  function footprint(name, pinNames, body) {
    const f = shape(name, pinNames, body);
    if (f && body && Object.keys(body).length) f.body = body;
    return f;
  }
  function shape(name, pinNames, body) {
    let m;
    if ((m = /^AXIAL-([\d.]+)$/.exec(name)) && AXIAL[m[1]]) return axial(+m[1], false, body);
    if ((m = /^AXIAL-([\d.]+)-V$/.exec(name)) && AXIAL[m[1]]) return axialV(+m[1], body);
    if ((m = /^DIODE-([\d.]+)$/.exec(name)) && AXIAL[m[1]]) return axial(+m[1], true, body);
    if ((m = /^BOX-([\d.]+)$/.exec(name)) && BOX[m[1]]) return box(+m[1], body);
    if ((m = /^RADIAL-D([\d.]+)-P([\d.]+)$/.exec(name))) return radial(+m[1], +m[2], body);
    if ((m = /^TO-92-([A-Z]{3})$/.exec(name))) return to92(m[1]);
    if ((m = /^TO-18-([A-Z]{3})$/.exec(name))) return to18(m[1]);
    if ((m = /^(TO-1|TO-5|MP)-([A-Z]{3})$/.exec(name))) return bigCan(m[1], m[2]);
    if ((m = /^TO-126-([A-Z]{3})$/.exec(name))) return to126(m[1]);
    if ((m = /^TO-220-([A-Z]{2,3})$/.exec(name))) return to220(m[1]);
    if (name === "DO-201AD") return do201();
    if ((m = /^BRIDGE-(DIP4|SIL4|GBU|KBU|WOB)$/.exec(name))) return bridgeFp(m[1]);
    if ((m = /^JACK-NMJ(4|6)HCD2$/.exec(name))) return neutrik(m[1] === "6");
    if ((m = /^JACK-NJ(2|3|5)FD-V$/.exec(name))) return njfd(+m[1]);
    if ((m = /^HEADER-1x(\d+)$/.exec(name)) && +m[1] >= 1 && +m[1] <= 20) return header(+m[1]);
    if ((m = /^FASTON-(6\.3|4\.8)$/.exec(name))) return faston(m[1]);
    if ((m = /^FUSE-(5X20|6\.3X32|TR5)$/.exec(name))) return fuseFp(m[1]);
    if ((m = /^(MOV|NTC)-D([\d.]+)-P([\d.]+)$/.exec(name))) {
      const L = root.CadLib, t = m[1] === "MOV" ? L.MOVS : L.NTCS, part = Object.values(t).find(x => String(x.d) === m[2] && String(x.p) === m[3]);
      // a board saved before a part's size was corrected keeps the disc its name gives
      return part ? discPart(m[1], part.d, part.p, part.w || 6, part.lead) : discPart(m[1], +m[2], +m[3], 6, 1);
    }
    if ((m = /^TO-247-([A-Z]{3})$/.exec(name))) return to247(m[1]);
    if ((m = /^TO-3P-([A-Z]{3})$/.exec(name))) return to3p(m[1]);
    if ((m = /^TO-264-([A-Z]{3})$/.exec(name))) return to264(m[1]);
    if (name === "LED-5MM") return led5();
    if (name === "LED-3MM") return led3();
    if ((m = /^POT-(\w+)$/.exec(name)) && POTS[m[1]]) return pot(m[1]);
    if (name === "TRIM-3296W") return trim3296();
    if ((m = /^DISC-([\d.]+)$/.exec(name)) && ["2.54", "5.08", "7.62"].includes(m[1])) return disc(+m[1]);
    if ((m = /^ECAP-AXIAL-([\d.]+)$/.exec(name)) && ECAP_AXIAL[m[1]]) return ecapAxial(+m[1]);
    if ((m = /^SNAPIN-D(\d+)$/.exec(name)) && SNAPIN.includes(+m[1])) return snapin(+m[1], body);
    if ((m = /^TERM-([\d.]+)-(\d+)$/.exec(name)) && ["5.08", "7.5"].includes(m[1])) return terminal(+m[1], pinNames && pinNames.length === +m[2] ? pinNames : Array.from({ length: +m[2] }, (_, i) => String(i + 1)));
    if ((m = /^JACK-(RCA|3\.5|6\.35)$/.exec(name))) return jack(m[1]);
    if ((m = /^TOGGLE-(SPDT|DPDT)$/.exec(name))) return toggle(m[1] === "DPDT" ? 2 : 1);
    if ((m = /^RELAY-(G5LE-1|G5V-2)$/.exec(name))) return relayFp(m[1]);
    if (name === "VTL5C") return vtl5c();
    if (name === "NEON-T2") return neonFp();
    if (name === "TO-220-5S" || name === "TO-220-11S") return to220Stagger(name === "TO-220-5S" ? 5 : 11);
    if (name === "SW-PUSH-6MM") return push6();
    if ((m = /^XFMR-EI(\d+)-(SE|PP|PTP|PT|IS)$/.exec(name)) && EI.includes(+m[1])) return ei(+m[1], m[2]);
    if ((m = /^CHOKE-EI(\d+)$/.exec(name)) && EI.includes(+m[1])) return ei(+m[1], "CHOKE");
    if ((m = /^SOCKET-([A-Z0-9]+)(-CAP)?$/.exec(name))) return /^\d+$/.test(m[1]) ? socket(null, +m[1], !!m[2]) : socket(m[1], 0, !!m[2]);
    if ((m = /^DIP-(\d+)$/.exec(name)) && [8, 14, 16].includes(+m[1])) return dip(+m[1]);
    if ((m = /^STAR-(M3|M4)$/.exec(name))) return starPoint(m[1]);
    if ((m = /^(CHIP|LED)-(\d{4})$/.exec(name)) && CHIPS[m[2]] && (m[1] === "CHIP" || ["0805", "1206"].includes(m[2]))) return chip(m[2], m[1] === "LED");
    if (SMD_DIODES[name]) return smdDiode(name);
    if ((m = /^CP-SMD-D([\d.]+)$/.exec(name)) && SMD_ECAP[m[1]]) return smdEcap(+m[1]);
    if ((m = /^SOT-23-([A-Z]{3})$/.exec(name))) return sot23(m[1]);
    if ((m = /^(SOT-89|SOT-223|DPAK|D2PAK)-([A-Z]{3})$/.exec(name))) return tabbed(m[1], m[2]);
    if ((m = /^SOIC-(\d+)$/.exec(name)) && [8, 14, 16].includes(+m[1])) return soic(+m[1]);
    if (name === "TRIM-TC33") return trimTc33();
    if ((m = /^WIRE-(\d+)$/.exec(name))) return wirePads(pinNames && pinNames.length === +m[1] ? pinNames : Array.from({ length: +m[1] }, (_, i) => String(i + 1)));
    return null;
  }

  // ---------------------------------------------------------------------------
  // Stroke font for silkscreen and copper text: what the screen shows is what the Gerbers
  // get. Glyphs on a 4 × 6 grid (y down, the baseline at 6), strokes separated by "|".
  // ---------------------------------------------------------------------------
  const GLYPHS = {
    A: "0,6 0,2 2,0 4,2 4,6|0,3.5 4,3.5", B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3|0,0 3,0 4,1 4,2 3,3", C: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5", D: "0,0 0,6 2,6 4,4 4,2 2,0 0,0",
    E: "4,0 0,0 0,6 4,6|0,3 3,3", F: "4,0 0,0 0,6|0,3 3,3", G: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3", H: "0,0 0,6|4,0 4,6|0,3 4,3", I: "1,0 3,0|2,0 2,6|1,6 3,6",
    J: "4,0 4,5 3,6 1,6 0,5", K: "0,0 0,6|4,0 0,4|1,3 4,6", L: "0,0 0,6 4,6", M: "0,6 0,0 2,3 4,0 4,6", N: "0,6 0,0 4,6 4,0", O: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0",
    P: "0,6 0,0 3,0 4,1 4,2 3,3 0,3", Q: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|2,4 4,6", R: "0,6 0,0 3,0 4,1 4,2 3,3 0,3|2,3 4,6", S: "4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5",
    T: "0,0 4,0|2,0 2,6", U: "0,0 0,5 1,6 3,6 4,5 4,0", V: "0,0 2,6 4,0", W: "0,0 1,6 2,3 3,6 4,0", X: "0,0 4,6|4,0 0,6", Y: "0,0 2,3 4,0|2,3 2,6", Z: "0,0 4,0 0,6 4,6",
    0: "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0|0.5,5 3.5,1", 1: "1,1 2,0 2,6|1,6 3,6", 2: "0,1 1,0 3,0 4,1 4,2 0,6 4,6", 3: "0,1 1,0 3,0 4,1 4,2 3,3 4,4 4,5 3,6 1,6 0,5|1,3 3,3",
    4: "3,6 3,0 0,4 4,4", 5: "4,0 0,0 0,3 3,3 4,4 4,5 3,6 0,6", 6: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3", 7: "0,0 4,0 1,6",
    8: "1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3|1,3 0,2 0,1 1,0", 9: "0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2 1,3 4,3",
    "-": "1,3 3,3", "+": "0,3 4,3|2,1 2,5", ".": "2,5.4 2,6", ",": "2,5 1.4,7", "/": "0,6 4,0", "(": "3,0 2,1 2,5 3,6", ")": "1,0 2,1 2,5 1,6", ":": "2,1.6 2,2.2|2,4.4 2,5",
    "=": "0,2 4,2|0,4 4,4", "_": "0,6 4,6", "'": "2,0 2,1.5", "\"": "1,0 1,1.5|3,0 3,1.5", "%": "0,6 4,0|0,0 1,0 1,1 0,1 0,0|3,5 4,5 4,6 3,6 3,5", "×": "1,2 3,4|3,2 1,4",
    "·": "1.8,3 2.2,3", "µ": "0,7.5 0,2|0,5 1,6 3,6 4,5|4,2 4,6", "Ω": "0,6 1,6 1,5 0,3.5 0,1 1,0 3,0 4,1 4,3.5 3,5 3,6 4,6", "#": "1,0 1,6|3,0 3,6|0,2 4,2|0,4 4,4",
    "~": "0,3.5 1,2.5 3,3.5 4,2.5", "<": "4,1 0,3 4,5", ">": "0,1 4,3 0,5", "!": "2,0 2,4|2,5.4 2,6", "?": "0,1 1,0 3,0 4,1 4,2 2,3.5 2,4|2,5.4 2,6", "&": "4,6 0.5,2 0.5,1 1.5,0 2.5,1 2.5,2 0,4 0,5 1,6 2.5,6 4,4"
  };
  /** Text as strokes, centred on (x, y): size is the cap height; rot in 90° steps (counter-clockwise
      on screen), mirror for the bottom side. Returns { w: stroke width, lines: [[[x, y]...]...], width } */
  function strokeText(text, x, y, size, rot, mirror) {
    const u = size / 6, chars = [...String(text)].map(c => (GLYPHS[c] ? c : c.toUpperCase())), adv = 6 * u, W = Math.max(0, chars.length * adv - 2 * u), lines = [];
    const tf = (px, py) => { let X = px - W / 2, Y = py - 3 * u; for (let r = 0; r < ((rot || 0) & 3); r++) [X, Y] = [Y, -X]; if (mirror) X = -X; return [+(x + X).toFixed(4), +(y + Y).toFixed(4)]; };
    chars.forEach((ch, i) => { const g = GLYPHS[ch]; if (g) g.split("|").forEach(st => lines.push(st.split(" ").map(pt => { const [a, b] = pt.split(",").map(Number); return tf(i * adv + a * u, b * u); }))); });
    return { w: +Math.max(0.12, size / 8).toFixed(3), lines, width: W };
  }

  // Pin order of each transistor package, pad 1 first, from the maker's drawing. Parts marked
  // "verify" have pinouts that differ between makers: check the datasheet of the part you buy.
  const PINOUT = {
    "2N2222A": ["EBC"], "2N3904": ["EBC"], "BC107": ["EBC"], "BC547B": ["CBE"], "BC546B": ["CBE"], "BC549C": ["CBE"], "BD139": ["ECB"], "MPSA42": ["EBC"], "MJE340": ["ECB"],
    "2N2907A": ["EBC"], "2N3906": ["EBC"], "BC177": ["EBC"], "BC557B": ["CBE"], "BC556B": ["CBE"], "BC559C": ["CBE"], "BD140": ["ECB"], "MPSA92": ["EBC"], "MJE350": ["ECB"],
    "2N7000": ["SGD"], "BS170": ["DGS"], "BS250": ["DGS", "verify"], "LND150": ["SGD", "verify"], "DN2540": ["GDS"],
    "IRF510": ["GDS"], "IRF540": ["GDS"], "IRF820": ["GDS"], "IRF840": ["GDS"], "IRF9540": ["GDS"], "IRF9610": ["GDS"], "IRF9640": ["GDS"],
    // power pairs: pin 1 left, the leads down, the type printed towards you. A TO-3 can is the
    // collector (its case); its two pins are B and E, so it goes on wires (heatsink on the chassis)
    "2SD669A": ["ECB"], "2SB649A": ["ECB"], "2SC4793": ["BCE"], "2SA1837": ["BCE"], "MJE15032": ["BCE"], "MJE15033": ["BCE"],
    "TIP41C": ["BCE"], "TIP42C": ["BCE"], "TIP35C": ["BCE"], "TIP36C": ["BCE"], "MJL4281A": ["BCE"], "MJL4302A": ["BCE"], "2SC5200": ["BCE"], "2SA1943": ["BCE"], "MJL3281A": ["BCE"], "MJL1302A": ["BCE"],
    "MJL21194": ["BCE"], "MJL21193": ["BCE"], "MJ15003": ["BEC"], "MJ15004": ["BEC"], "MJ15024": ["BEC"], "MJ15025": ["BEC"], "2N3055": ["BEC"], "MJ2955": ["BEC"],
    // germanium: the cans' leads read E, B, C round the circle from the tab (the collector is
    // marked by a dot or the wider spacing on some makes); the USSR parts' pinouts vary by year
    "AC127": ["EBC", "verify"], "AC128": ["EBC", "verify"], "AC187": ["EBC", "verify"], "AC188": ["EBC", "verify"], "OC71": ["EBC", "verify"], "NKT275": ["EBC", "verify"], "2N404": ["EBC"],
    "AD149": ["BEC"], "AD161": ["ECB", "verify"], "AD162": ["ECB", "verify"], "P213B": ["BEC", "verify"],
    "MP39B": ["EBC", "verify"], "MP40A": ["EBC", "verify"], "MP41A": ["EBC", "verify"], "MP42B": ["EBC", "verify"], "MP25B": ["EBC", "verify"], "MP26B": ["EBC", "verify"], "MP38A": ["EBC", "verify"],
    "GT402G": ["EBC", "verify"], "GT404G": ["EBC", "verify"],
    "IRFP240": ["GDS"], "IRFP250": ["GDS"], "IRFP460": ["GDS"], "IRFP9240": ["GDS"], "2SK1058": ["GSD"], "2SJ162": ["GSD"], "ECX10N20": ["GSD"], "ECX10P20": ["GSD"],
    // JFETs: most American TO-92 parts D-S-G, but J175 D-G-S and 2N5460 S-D-G; the Toshiba types
    // (and their replacements) put the gate in the middle, so drain and source may swap without harm
    "J201": ["DSG"], "J113": ["DSG"], "J310": ["DSG", "verify"], "2N5457": ["DSG"], "MPF102": ["DSG"], "2N5460": ["SDG"], "J175": ["DGS"],
    "2SK170": ["DGS", "verify"], "LSK170B": ["DGS", "verify"], "2SJ74": ["DGS", "verify"], "2SK30A": ["SGD"],
    // regulators by their pins: I input, O output, A adjust, G ground (the TO-220 and TO-92 drawings);
    // the TL431: R reference, A anode, K cathode
    "LM317": ["AOI"], "LM317L": ["AOI"], "LM338": ["AOI"], "LM337": ["AIO"], "7805": ["IGO"], "7809": ["IGO"], "7812": ["IGO"], "7815": ["IGO"], "7824": ["IGO"],
    "78L05": ["OGI"], "78L12": ["OGI"], "7905": ["GIO"], "7912": ["GIO"], "7915": ["GIO"], "TL431": ["RAK"]
  };
  const AXIAL_FOR_WATTS = { "": 10.16, "0.125": 7.62, "0.25": 10.16, "0.5": 12.7, "1": 15.24, "2": 20.32, "3": 25.4, "5": 30.48, "10": 40.64, "20": 50.8 };
  const radialFor = c => { const u = c * 1e6; return u <= 4.7 ? [5, 2] : u <= 10 ? [6.3, 2.5] : u <= 47 ? [8, 3.5] : u <= 100 ? [10, 5] : u <= 220 ? [12.5, 5] : u <= 470 ? [16, 7.5] : u <= 1000 ? [18, 7.5] : [22, 10]; };
  const boxFor = c => (c <= 10e-9 ? 7.5 : c <= 100e-9 ? 10 : c <= 470e-9 ? 15 : 22.5);
  // The socket a valve's base fits, "-CAP" when its anode is on a top cap; null for the bases with
  // no board socket here (wire-lead subminiatures, nuvistors, the glass bases of 6С33С, ГУ-50, 6П36С,
  // the jumbo 4-pin of the 211 and 845, ГМ-70's): those go on wires to a chassis socket
  const SOCKET_OF = [[/Magnoval|B9D/i, "B9D"], [/Noval|B9A/i, "B9A"], [/B7G|^Miniature/i, "B7G"], [/Octal|K8A/i, "OCTAL"], [/UX4/i, "UX4"]];
  function socketFor(tube) {
    const s = (tube && tube.socket) || "", k = SOCKET_OF.find(([re]) => re.test(s));
    return k ? `SOCKET-${k[1]}${/top cap/i.test(s) ? "-CAP" : ""}` : null;
  }

  // ---------------------------------------------------------------------------
  // From the schematic to physical parts. The CAD sends { parts: [{ id, type, label, params,
  // pins: [{ id, net }] }], names: { net: "GND" | connector name } }. Sections of one part
  // (VL1.1 / VL1.2, SA1.1 / SA1.2) are one physical part with one footprint.
  // ---------------------------------------------------------------------------
  // not on the board: these, and the sources that stand for an instrument off it (a guitar's pickup, a turntable's cartridge)
  const SKIP = new Set(["frame", "note", "ground", "offsheet", "rail", "scope", "vcvs", "vccs", "pickup", "phono"]);
  function physicalParts(netlist) {
    const L = root.CadLib, groups = new Map();
    (netlist.parts || []).forEach(p => {
      if (SKIP.has(p.type) || (!L.LIB[p.type] && p.type !== "heater" && p.type !== "star")) return;
      const lab = String(p.label || "").trim(), i = lab.lastIndexOf("."), base = i > 0 ? lab.slice(0, i) : lab;
      const k = base ? p.type + "|" + base : p.id;
      if (!groups.has(k)) groups.set(k, { ref: base || "?", type: p.type, members: [] });
      groups.get(k).members.push(p);
    });
    return [...groups.values()].map(g => {
      g.members.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
      g.key = g.members.map(m => m.id).sort().join("+");
      const first = g.members[0], def = L.LIB[g.type];
      g.value = g.type === "heater" ? `${first.params.v} V ~ ${fmtA(first.params.i)}` : g.type === "star" ? "star ground" : def.value ? def.value({ params: first.params, label: first.label }) : "";
      g.options = fpOptions(g);
      g.defaultFp = g.options[0];
      g.smdFp = smdOptions(g)[0] || null;   // the SMD version's footprint (null: the part stays through-hole)
      partNumber(g);
      return g;
    }).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }
  // A part number (the BOM's) that names the real part: g.mpn what it says (PartNo.lookup), g.mpnFp
  // the footprint it picks (first among the options: the default of its kind, through-hole or SMD),
  // g.body its size for the silkscreen and the 3D model
  function partNumber(g) {
    const P = root.PartNo, p = g.members[0].params || {};
    g.mpn = null; g.mpnFp = null; g.body = null;
    if (!P || !String(p.partno || "").trim()) return;
    g.mpn = P.resolve(p, g.type);
    const f = P.footprintFor(g.mpn, g.options);
    if (g.mpn && g.mpn.body && g.mpn.body.kind !== "chip") { const { kind, ...size } = g.mpn.body; g.body = size; }   // eslint-disable-line no-unused-vars
    if (!f || !shape(f)) return;
    g.mpnFp = f;
    if (isSmd(f)) g.smdFp = f;
    else g.defaultFp = f;
    if (!g.options.includes(f)) g.options = [f, ...g.options];
    else if (!isSmd(f)) g.options = [f, ...g.options.filter(o => o !== f)];
  }
  /** Board parts whose part number changed since the board last saw it take the footprint it
      names (once: picking another footprint by hand afterwards stays). Returns [{ ref, fp, text }]. */
  function applyPartNumbers(board, netlist, parts) {
    const done = [], P = root.PartNo;
    (parts || physicalParts(netlist)).forEach(g => {
      const bp = board.parts[g.key]; if (!bp) return;
      const key = P ? P.norm(g.members[0].params.partno) : "";
      if ((bp.mpn || "") === key) return;
      if (key) bp.mpn = key; else delete bp.mpn;
      if (g.mpnFp && bp.fp !== g.mpnFp) { bp.fp = g.mpnFp; done.push({ ref: g.ref, fp: g.mpnFp, text: P.describe(g.mpn) }); }
    });
    return done;
  }
  // the surface-mount footprints that fit a part, the default first (none for the parts that stay
  // through-hole: valves, transformers, panel pots, jacks, power transistors in big cases)
  const SMD_R = { "": "1206", "0.125": "0805", "0.25": "1206", "0.5": "2010", "1": "2512" };
  function smdOptions(g) {
    const L = root.CadLib, p = g.members[0].params, t = g.type, first = (d, all) => [d, ...all.filter(a => a !== d)];
    switch (t) {
      case "resistor": { const d = SMD_R[String(p.w || "")]; return d ? first("CHIP-" + d, ["0603", "0805", "1206", "2010", "2512"].map(k => "CHIP-" + k)) : []; }
      case "capacitor": { const d = p.c <= 1e-9 ? "0805" : p.c <= 100e-9 ? "1206" : p.c <= 1e-6 ? "1812" : "2220"; return first("CHIP-" + d, ["0603", "0805", "1206", "1210", "1812", "2220"].map(k => "CHIP-" + k)); }
      case "electrolytic": { const D = radialFor(p.c)[0]; return SMD_ECAP[D] ? first(`CP-SMD-D${D}`, Object.keys(SMD_ECAP).sort((a, b) => a - b).map(k => `CP-SMD-D${k}`)) : []; }
      // the SMD twins: SS14 / US1M / ES1J (SMA), S3M / SS34 (SMC), the 1N4148W and BAT85 in SOD-123; SiC: none here
      case "diode": { const d = L.DIODES[p.model] || {}; return d.pkg === "DO-35" ? ["SOD-123", "SOD-323", "MINIMELF"] : d.pkg === "DO-201AD" ? ["SMC", "SMB"] : d.pkg === "TO-220-2" ? [] : ["SMA", "SMB", "SMC"]; }
      case "bridge": return [];
      case "zener": { const z = L.ZENERS[p.model] || {}; return z.p >= 5 ? ["SMC", "SMB"] : z.p >= 1 ? ["SMA", "SMB"] : ["SOD-123", "SOD-323", "MINIMELF"]; }
      case "led": return ["LED-1206", "LED-0805"];
      case "inductor": return +p.l < 0.05 ? ["CHIP-1210", "CHIP-1812"] : [];
      case "pot": return ["TRIM-TC33"];
      case "timer555": return ["SOIC-8"];
      case "chipamp": return p.model === "LM386" ? ["SOIC-8"] : [];
      case "opamp": { const m = L.OPAMPS[p.model] || {}; return [m.units === 4 ? "SOIC-14" : "SOIC-8"]; }
      // JFETs: SOT-23 D-S-G as the MMBFJ201, MMBF5457 (MMBFJ175 for the P-channel ones)
      case "njf": case "pjf": return ["SOT-23-DSG"];
      // regulators: SOT-223 / DPAK with the output (LM317) or ground (78xx) or input (79xx) on the tab,
      // the 100 mA ones SOT-89; the TL431 SOT-23 (K-REF-A, TI's DBZ) or SOT-89 (REF-A-K, the tab the anode)
      case "reg": {
        const m = L.REGS[p.model] || {}, order = (PINOUT[p.model] || ["AOI"])[0];
        return m.pkg === "TO-92" ? [`SOT-89-${order}`] : m.adj && m.pol > 0 ? [`SOT-223-${order}`, `DPAK-${order}`, `D2PAK-${order}`] : [`DPAK-${order}`, `D2PAK-${order}`];
      }
      case "tl431": return ["SOT-23-KRA", "SOT-89-RAK"];
      case "npn": case "pnp": case "nmos": case "pmos": {
        const bjt = t === "npn" || t === "pnp", m = (bjt ? L.BJTS : L.MOSFETS)[p.model] || {}, pkg = m.pkg || "TO-92";
        // the makers' SMD pinouts: SOT-23 B-E-C / G-S-D; the tabbed cases B-C-E / G-D-S (the tab the collector or drain)
        const s23 = `SOT-23-${bjt ? "BEC" : "GSD"}`, tab = bjt ? "BCE" : "GDS";
        if (/TO-92|TO-18/.test(pkg) || !m.pkg) return /^(LND150|DN2540)$/.test(p.model) ? [`SOT-89-${tab}`, s23] : [s23, `SOT-89-${tab}`];
        if (/TO-126/.test(pkg)) return [`SOT-223-${tab}`, `DPAK-${tab}`];
        if (/TO-220/.test(pkg)) return [`D2PAK-${tab}`, `DPAK-${tab}`];
        return [];
      }
      default: return [];
    }
  }
  // footprints that fit a part, the default first (the through-hole ones, then the SMD ones)
  function fpOptions(g) { return thtOptions(g).concat(smdOptions(g)); }
  /** true for a surface-mount footprint's name */
  const isSmd = name => { const f = typeof name === "string" ? footprint(name) : name; return !!(f && f.smd); };
  function thtOptions(g) {
    const L = root.CadLib, p = g.members[0].params, t = g.type, wires = g.members.reduce((s, m) => s + m.pins.length, 0);
    const axials = Object.keys(AXIAL).map(k => "AXIAL-" + k), first = (d, all) => [d, ...all.filter(a => a !== d)];
    const diodes = ["DIODE-7.62", "DIODE-10.16", "DIODE-12.7", "DIODE-15.24", "DIODE-20.32"], t2 = "TERM-5.08-2";
    const eiFor = (kind, size) => first(kind === "CHOKE" ? `CHOKE-EI${size}` : `XFMR-EI${size}-${kind}`, EI.map(s => (kind === "CHOKE" ? `CHOKE-EI${s}` : `XFMR-EI${s}-${kind}`)));
    switch (t) {
      case "resistor": { const d = "AXIAL-" + (AXIAL_FOR_WATTS[String(p.w || "")] || 10.16); return [...first(d, axials), "WIRE-2"]; }
      case "pot": return ["POT-16MM", "POT-24MM", "POT-9MM", "TRIM-3296W", "TERM-5.08-3", "WIRE-3"];
      case "capacitor": {
        const boxes = Object.keys(BOX).map(k => "BOX-" + k), discs = ["DISC-5.08", "DISC-2.54", "DISC-7.62"];
        return p.c <= 1e-9 ? [...discs, ...boxes, ...axials, "WIRE-2"] : [...first("BOX-" + boxFor(p.c), boxes), ...discs, ...axials, "WIRE-2"];
      }
      case "electrolytic": {
        const [D, P] = radialFor(p.c), d = `RADIAL-D${D}-P${P}`;
        return [...first(d, RADIAL.map(([a, b]) => `RADIAL-D${a}-P${b}`)), ...SNAPIN.map(x => `SNAPIN-D${x}`), ...Object.keys(ECAP_AXIAL).map(k => `ECAP-AXIAL-${k}`), "WIRE-2"];
      }
      case "diode": {
        const d = L.DIODES[p.model] || {};
        if (d.pkg === "TO-220-2") return ["TO-220-KA", "WIRE-2"];
        if (d.pkg === "DO-201AD") return ["DO-201AD", "WIRE-2"];
        return [...first(d.pkg === "DO-35" ? "DIODE-7.62" : "DIODE-10.16", diodes), "WIRE-2"];
      }
      // a bridge in its own package, or a chassis-mounted one (KBPC) wired by its Faston tabs
      case "bridge": { const b = L.BRIDGES[p.model] || {}, k = { "DIP-4": "DIP4", "SIL-4": "SIL4", GBU: "GBU", KBU: "KBU", WOB: "WOB" }[b.pkg]; return k ? [`BRIDGE-${k}`, "WIRE-4"] : ["WIRE-4"]; }
      // connectors: the maker's pattern, or wire pads where the part sits on the chassis
      case "jack": {
        const k = p.kind || "TS-SW";
        return k === "TS-SW" ? ["JACK-NMJ4HCD2", "JACK-NJ5FD-V", "JACK-6.35", "WIRE-3"] : k === "TS" ? ["JACK-NMJ4HCD2", "JACK-NJ2FD-V", "JACK-6.35", "WIRE-2"] : k === "TRS" ? ["JACK-NMJ6HCD2", "JACK-NJ3FD-V", "WIRE-3"] : k === "TRS-3.5" ? ["JACK-3.5", "WIRE-3"] : ["JACK-RCA", "WIRE-2"];
      }
      case "iec": return ["WIRE-3", "TERM-7.5-3"];
      case "terminal": return [`TERM-${p.pitch === "7.5" ? "7.5" : "5.08"}-${wires}`, `TERM-${p.pitch === "7.5" ? "5.08" : "7.5"}-${wires}`, `WIRE-${wires}`];
      case "header": return [`HEADER-1x${wires}`, `WIRE-${wires}`];
      case "faston": return [`FASTON-${p.size === "4.8" ? "4.8" : "6.3"}`, `FASTON-${p.size === "4.8" ? "6.3" : "4.8"}`, "WIRE-1"];
      // a fuse in board clips (or a panel holder on the chassis, wired)
      case "fuse": { const k = { "6.3x32": "FUSE-6.3X32", TR5: "FUSE-TR5" }[p.size] || "FUSE-5X20"; return first(k, ["FUSE-5X20", "FUSE-6.3X32", "FUSE-TR5"]).concat("WIRE-2"); }
      case "ntc": { const m = L.NTCS[p.model] || L.NTCS["SL22 10005"]; return [`NTC-D${m.d}-P${m.p}`, "WIRE-2"]; }
      case "mov": { const m = L.MOVS[p.model] || L.MOVS.S10K275; return [`MOV-D${m.d}-P${m.p}`, "WIRE-2"]; }
      case "zener": { const z = L.ZENERS[p.model] || {}; return first(z.p >= 5 ? "DIODE-15.24" : "DIODE-10.16", diodes); }
      case "led": return ["LED-5MM", "LED-3MM", "WIRE-2"];
      // transformers and filter chokes sit on the chassis (their weight, their field, their heat): wire pads
      // first, a board-mount EI footprint as an option
      case "inductor": { const l = +p.l || 0; return l < 0.05 ? [...first("AXIAL-15.24", axials), ...eiFor("CHOKE", 42), t2, "WIRE-2"] : ["WIRE-2", ...eiFor("CHOKE", l <= 1 ? 42 : l <= 5 ? 54 : 66), ...axials, t2]; }
      case "opt_se": case "opt_cat": return ["WIRE-4", ...eiFor("SE", 66), "TERM-5.08-4"];
      // interstage and input transformers: small cores, board mount first
      case "itx": return p.ct === "yes" ? [...eiFor("IS", 38), "WIRE-5", "TERM-5.08-5"] : [...eiFor("SE", 38), "WIRE-4", "TERM-5.08-4"];
      // a glow tube in its socket: the miniature types B7G, the octal ones octal
      case "gasreg": { const d = `SOCKET-${(L.GASREGS[p.model] || {}).socket || "B7G"}`; return [d, ...["SOCKET-B7G", "SOCKET-OCTAL"].filter(a => a !== d), "WIRE-2"]; }
      case "opt_pp": return ["WIRE-7", ...eiFor("PP", 76), "TERM-5.08-7"];
      case "ptx": return ["WIRE-3", ...eiFor("PT", 76), "TERM-5.08-3"];
      case "ptx_cat": return ["WIRE-5", ...eiFor("PTP", 76), "TERM-5.08-5"];
      case "switch": return g.members.length === 1 ? ["TOGGLE-SPDT", "TERM-5.08-3", "WIRE-3"] : g.members.length === 2 ? ["TOGGLE-DPDT", `TERM-5.08-${wires}`, `WIRE-${wires}`] : [`TERM-5.08-${wires}`, `WIRE-${wires}`];
      // a push button on the board; a toggle or a rotary selector on the panel, wired
      case "spst": return p.kind !== "toggle" && g.members.length === 1 ? ["SW-PUSH-6MM", "WIRE-2", t2] : [`WIRE-${wires}`, `TERM-5.08-${wires}`];
      case "rotary": return [`WIRE-${wires}`, `TERM-5.08-${wires}`];
      case "relay": return [`RELAY-${L.RELAYS[p.model] ? p.model : "G5LE-1"}`, `WIRE-${wires}`];
      case "vactrol": return ["VTL5C", "WIRE-4"];
      // a neon on the board or on the panel; a magic eye in its socket (often on the front panel: wired)
      case "neon": return ["NEON-T2", "WIRE-2"];
      case "eye": { const d = `SOCKET-${(L.EYES[p.model] || {}).base || "UX6"}`; return [d, "WIRE-4"]; }
      case "speaker": return [t2, "JACK-6.35", "WIRE-2"];
      case "siggen": return ["JACK-RCA", "JACK-6.35", "JACK-3.5", t2, "WIRE-2"];
      case "vdc": return [t2, "TERM-7.5-2", "WIRE-2"];
      // the ideal current source stands for a small current-source board: wired in by two terminals
      case "isrc": return [t2, "WIRE-2"];
      case "timer555": return ["DIP-8", "WIRE-8"];
      // power amplifier ICs: an LM386 in its DIP-8, the others standing at the board's edge on a heatsink
      case "chipamp": return p.model === "LM386" ? ["DIP-8", `WIRE-${wires}`] : [p.model === "LM3886" ? "TO-220-11S" : "TO-220-5S", `WIRE-${wires}`];
      case "mains": return ["TERM-7.5-2", t2, "WIRE-2"];
      case "heater": return [t2, "WIRE-2", "TERM-7.5-2"];
      case "star": return ["STAR-M3", "STAR-M4", "WIRE-1"];
      // JFETs come in TO-92 (the other small cases as options)
      case "njf": case "pjf": { const order = (PINOUT[p.model] || ["DSG"])[0]; return [`TO-92-${order}`, `TO-18-${order}`, "WIRE-3"]; }
      // a regulator in its case (a TO-220 one on the board's edge, its heatsink bolted on), or wired
      // (the other case is another part, with its own pinout: an LM317L, a 78L05)
      case "reg": { const m = L.REGS[p.model] || {}; return [`${m.pkg === "TO-92" ? "TO-92" : "TO-220"}-${(PINOUT[p.model] || ["AOI"])[0]}`, "WIRE-3"]; }
      case "tl431": return ["TO-92-RAK", "WIRE-3"];
      case "npn": case "pnp": case "nmos": case "pmos": {
        const m = (t === "npn" || t === "pnp" ? L.BJTS : L.MOSFETS)[p.model] || {}, order = (PINOUT[p.model] || [t[1] === "m" ? "GDS" : "EBC"])[0];
        const all = ["TO-92", "TO-18", "TO-126", "TO-220", "TO-247", "TO-3P", "TO-264"].map(k => `${k}-${order}`);
        // a TO-3 can sits on the chassis heatsink, wired to the board
        if (m.pkg === "TO-3" || m.pkg === "SOT-9") return ["WIRE-3", ...all];
        // germanium cans: their own pattern first, the other cans next
        if (CANS[m.pkg]) return [`${m.pkg}-${order}`, ...["TO-1", "TO-5", "MP"].filter(k => k !== m.pkg).map(k => `${k}-${order}`), ...all, "WIRE-3"];
        const pkg = /TO-220/.test(m.pkg) ? "TO-220" : /TO-126/.test(m.pkg) ? "TO-126" : /TO-18/.test(m.pkg) ? "TO-18" : /TO-264/.test(m.pkg) ? "TO-264" : /TO-3P/.test(m.pkg) ? "TO-3P" : /TO-247/.test(m.pkg) ? "TO-247" : "TO-92";
        return [`${pkg}-${order}`, ...all.filter(a => a !== `${pkg}-${order}`), "WIRE-3"];
      }
      // an op-amp's package; its amplifiers (DA1.1 … DA1.4) share it
      case "opamp": { const m = L.OPAMPS[p.model] || {}; return [m.units === 4 ? "DIP-14" : "DIP-8", `WIRE-${wires}`]; }
      case "tube": {
        const t = L.tubeByName(p.tube), d = socketFor(t), cap = t && /top cap/i.test(t.socket) ? "-CAP" : "";
        const all = ["B9A", "B7G", "B9D", "OCTAL", "UX4"].map(k => `SOCKET-${k}${cap}`);
        return d ? [d, ...all.filter(a => a !== d), `WIRE-${wires}`] : [`WIRE-${wires}`, ...all];
      }
      default: return [`WIRE-${wires}`];
    }
  }
  // wired to a chassis-mounted part (wire pads or a screw terminal) rather than soldered in
  const isOffboard = g => !!(g.fp && /^(WIRE|TERM)-/.test(g.fp.name));
  // which schematic pins land on each pad: Map padNum -> [{ comp, pin }]
  function padMap(g, f) {
    const L = root.CadLib, map = new Map(), add = (num, comp, pin) => { num = String(num); if (!map.has(num)) map.set(num, []); map.get(num).push({ comp, pin }); };
    const one = g.members[0];
    if (/^(WIRE|TERM)-/.test(f.name)) { let k = 1; g.members.forEach(m => m.pins.forEach(p => add(k++, m.id, p.id))); return map; }
    if (L.LIB[g.type] && L.LIB[g.type].pinNumbers) {
      // pin numbers from the part's pinout (a tube's, an op-amp's); the sections of a dual tube or
      // the amplifiers of a dual op-amp each bring their own
      g.members.forEach(m => {
        const nums = L.LIB[g.type].pinNumbers({ params: m.params, label: m.label });
        m.pins.forEach(p => String(nums[p.id] || p.pads || "").split(",").filter(Boolean).forEach(n => add(n.trim(), m.id, p.id)));
      });
      return map;
    }
    // a name may be on more than one pad (an SOT-223's collector: pin 2 and the tab)
    const byName = {};
    f.pads.forEach(p => { (byName[p.name] = byName[p.name] || []).push(p.num); });
    const SEM = { resistor: { 1: "1", 2: "2" }, capacitor: { 1: "1", 2: "2" }, electrolytic: { "+": "1", "-": "2" }, inductor: { 1: "1", 2: "2" },
      diode: { K: "1", A: "2" }, zener: { K: "1", A: "2" }, led: { K: "1", A: "2" }, pot: { 1: "1", W: "2", 2: "3" }, star: { 1: "1" } };
    // sections of one part (a DPDT switch) find their pads as "1.A", "2.A" …
    (SEM[g.type] ? [one] : g.members).forEach((m, k) => m.pins.forEach(p => {
      const nums = SEM[g.type] ? [SEM[g.type][p.id]] : byName[g.members.length > 1 ? `${k + 1}.${p.id}` : p.id] || [];
      nums.forEach(num => { if (num) add(num, m.id, p.id); });
    }));
    return map;
  }

  // Net names. A sheet connector's name, GND and the heater nets come with the netlist; the rest
  // are named for what they are:
  //  supply rails (a source's + terminal, or a reservoir capacitor's + with no valve on it): B+ … B+3
  //    from the highest voltage down above 60 V, else +12V, -24V;
  //  valve electrodes: VL1.1-A, VL2-G1, VL1.2-K (anode before screen, cathode, grid);
  //  the output transformer's secondary OUT, a generator's output IN;
  //  else the parts the net joins: R8_C3 (or R8-2 for a pin alone)
  // The names of earlier versions (Net-(R8-2)) are kept in legacy, so a board's stored names move over.
  const PIN_RANK = { A: 0, A1: 0, A2: 0, G2: 1, K: 2, G: 3, G1: 3 };
  function legacyNames(netlist, parts, padsByPart) {
    const names = {};
    Object.entries(netlist.names || {}).forEach(([n, nm]) => { names[n] = nm; });
    parts.forEach(g => (padsByPart.get(g.key) || []).forEach(p => {
      if (p.net === null || names[p.net]) return;
      names[p.net] = `Net-(${g.ref}-${p.num})`;
    }));
    return names;
  }
  function netNames(netlist, parts, padsByPart) {
    const L = root.CadLib, names = {}, used = new Set(), volts = netlist.volts || {}, nets = new Set();
    Object.entries(netlist.names || {}).forEach(([n, nm]) => { names[n] = nm; used.add(nm); });
    parts.forEach(g => (padsByPart.get(g.key) || []).forEach(p => { if (p.net !== null) nets.add(p.net); }));
    const on = new Map(), refOf = {};
    parts.forEach(g => g.members.forEach(m => { refOf[m.id] = g.ref; }));
    (netlist.parts || []).forEach(p => p.pins.forEach(q => { if (q.net === undefined || q.net === null) return; if (!on.has(q.net)) on.set(q.net, []); on.get(q.net).push({ p, pin: q.id }); }));
    const cat = p => { const t = p.type === "tube" && L && L.tubeByName ? L.tubeByName(p.params && p.params.tube) : null; return t ? t.category || "" : ""; };
    const valvePins = list => list.filter(e => e.p.type === "tube" && cat(e.p) !== "rectifier" && PIN_RANK[e.pin] !== undefined);
    const take = (n, nm) => { let k = nm, i = 2; while (used.has(k)) k = `${nm}_${i++}`; used.add(k); names[n] = k; };
    const todo = [...nets].filter(n => !names[n]);
    // supply rails
    const rails = todo.filter(n => { const l = on.get(n) || []; return !valvePins(l).length && l.some(e => (e.p.type === "vdc" && e.pin === "+") || (e.p.type === "electrolytic" && e.pin === "+" && Math.abs(volts[n] || 0) >= 60)); });
    const hv = rails.filter(n => Math.abs(volts[n] || 0) >= 60).sort((a, b) => (volts[b] || 0) - (volts[a] || 0));
    hv.forEach((n, i) => take(n, hv.length > 1 ? `B+${i + 1}` : "B+"));
    rails.filter(n => !hv.includes(n) && volts[n] !== undefined && Math.abs(volts[n]) >= 0.5).forEach(n => take(n, `${volts[n] < 0 ? "-" : "+"}${+Math.abs(volts[n]).toPrecision(2)}V`));
    // valve electrodes, outputs and inputs, then the parts the net joins
    todo.filter(n => !names[n]).forEach(n => {
      const l = on.get(n) || [], v = valvePins(l).sort((a, b) => PIN_RANK[a.pin] - PIN_RANK[b.pin] || String(a.p.label).localeCompare(String(b.p.label), undefined, { numeric: true }));
      if (v.length) return take(n, `${v[0].p.label || refOf[v[0].p.id]}-${v[0].pin === "A1" || v[0].pin === "A2" ? "A" : v[0].pin}`);
      if (l.some(e => /^opt_/.test(e.p.type) && /^S\d$/.test(e.pin)) && n !== 0) return take(n, "OUT");
      if (l.some(e => e.p.type === "siggen")) return take(n, "IN");
      const refs = [...new Set(l.map(e => refOf[e.p.id]).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (refs.length >= 2) return take(n, `${refs[0]}_${refs[1]}`);
      const e = l[0]; take(n, e ? `${refOf[e.p.id] || "N"}-${e.pin}` : `N${n}`);
    });
    return names;
  }
  /** Move a board's stored net names (net classes, pours, stitching vias and loose tracks) from the
      names of earlier versions to today's. Returns how many were renamed. */
  function migrateNetNames(board, model) {
    const legacy = model.legacy || {}, now = new Set(Object.values(model.names)), to = n => (n && !now.has(n) && legacy[n] !== undefined ? model.names[legacy[n]] : null);
    let k = 0;
    const R = board.rules || {};
    if (R.netClass) Object.keys(R.netClass).forEach(n => { const t = to(n); if (t) { R.netClass[t] = R.netClass[n]; delete R.netClass[n]; k++; } });
    (board.zones || []).concat(board.tracks || [], board.vias || []).forEach(o => { const t = to(o.net); if (t) { o.net = t; k++; } });
    return k;
  }

  // ---------------------------------------------------------------------------
  // Synchronise the board with the schematic: new parts go to a staging row below the
  // outline, parts gone from the schematic leave the board; positions are kept by part key
  // ---------------------------------------------------------------------------
  // only: a test on a part's reference that limits the update to those parts (the board's own XH / XG)
  function sync(board, netlist, only) {
    const ok = r => !only || only(r), parts = physicalParts(netlist), keys = new Set(parts.map(g => g.key)), added = [], removed = [];
    Object.keys(board.parts).forEach(k => { if (!keys.has(k) && ok(board.parts[k].ref)) { removed.push(board.parts[k].ref); delete board.parts[k]; } });
    let x = 8, y = board.outline.h + 18, rowH = 0;
    parts.forEach(g => {
      const old = board.parts[g.key];
      // a footprint that no longer fits (a resistor's rating changed): the default, SMD when it was SMD
      if (old) { old.ref = g.ref; if (!g.options.includes(old.fp)) old.fp = (isSmd(old.fp) && g.smdFp) || g.defaultFp; return; }
      if (!ok(g.ref)) return;
      const f = footprint(g.mpnFp || g.defaultFp, g.members.flatMap(m => m.pins.map(p => (g.members.length > 1 ? m.label.split(".").pop() + "." : "") + p.id)));
      const w = f.box[2] - f.box[0], h = f.box[3] - f.box[1];
      if (x + w > Math.max(board.outline.w, 160)) { x = 8; y += rowH + 6; rowH = 0; }
      board.parts[g.key] = { ref: g.ref, fp: g.mpnFp || g.defaultFp, x: snap(x - f.box[0], 1.27), y: snap(y - f.box[1], 1.27), rot: 0, side: "F" };
      if (g.mpn && root.PartNo) board.parts[g.key].mpn = root.PartNo.norm(g.members[0].params.partno);
      x += w + 6; rowH = Math.max(rowH, h);
      added.push(g.ref);
    });
    applyPartNumbers(board, netlist, parts.filter(g => ok(g.ref)));
    return { added, removed, parts };
  }
  const snap = (v, g) => Math.round(v / g) * g;

  // ---------------------------------------------------------------------------
  // Placement transforms: rotate (90° steps, counter-clockwise on screen) then mirror for the bottom side
  // ---------------------------------------------------------------------------
  function place(pt, part) {
    let [x, y] = pt;
    for (let r = 0; r < ((part.rot || 0) & 3); r++) [x, y] = [y, -x];
    if (part.side === "B") x = -x;
    return [part.x + x, part.y + y];
  }
  function placeSize(p, part) { return ((part.rot || 0) & 1) ? [p.h, p.w] : [p.w, p.h]; }

  // the footprint a board part uses: its name with the mounting (bp.mount "V": an axial stood up),
  // the body the part number's size with what was set by hand over it
  const mountedName = bp => (bp.mount === "V" && canStand(bp.fp) ? bp.fp + "-V" : bp.fp);
  function partFootprint(g, bp, pinNames) {
    const names = pinNames || g.members.flatMap(m => m.pins.map(p => (g.members.length > 1 ? m.label.split(".").pop() + "." : "") + p.id));
    const body = g.body || bp.body ? { ...(g.body || {}), ...(bp.body || {}) } : null;
    return footprint(mountedName(bp), names, body) || footprint(g.defaultFp, names, body);
  }
  /** Everything the editor needs about a board against a netlist: physical parts with
      their footprints, pads in board coordinates with nets, net names */
  function model(board, netlist) {
    const parts = physicalParts(netlist), pads = [], holes = [], padsByPart = new Map(), netOf = {};
    (netlist.parts || []).forEach(p => p.pins.forEach(q => { netOf[p.id + ":" + q.id] = q.net; }));
    parts.forEach(g => {
      const bp = board.parts[g.key]; if (!bp) return;
      const pinNames = g.members.flatMap(m => m.pins.map(p => (g.members.length > 1 ? m.label.split(".").pop() + "." : "") + p.id));
      // the body: the part number's size, what was set by hand over it
      const f = partFootprint(g, bp, pinNames);
      g.fp = f; g.place = bp;
      const map = padMap(g, f), list = [];
      f.pads.forEach(p => {
        const conns = map.get(p.num) || [], nets = [...new Set(conns.map(c => netOf[c.comp + ":" + c.pin]).filter(n => n !== undefined))];
        const [x, y] = place([p.x, p.y], bp), [w, h] = placeSize(p, bp);
        // an SMD pad is on the part's side only
        const P = { part: g.key, ref: g.ref, num: p.num, name: p.name, x, y, w, h, shape: p.shape, drill: p.drill, pitchRing: p.pitchRing, smd: !!p.smd, paste: p.paste, layers: p.smd ? [bp.side === "B" ? "B.Cu" : "F.Cu"] : COPPER,
          net: nets.length ? nets[0] : null, pins: conns, conflict: nets.length > 1 };
        list.push(P); pads.push(P);
      });
      (f.holes || []).forEach(h => { const [x, y] = place([h.x, h.y], bp); holes.push({ part: g.key, ref: g.ref, x, y, d: h.d }); });
      padsByPart.set(g.key, list);
    });
    const names = netNames(netlist, parts, padsByPart), old = legacyNames(netlist, parts, padsByPart), legacy = {};
    Object.entries(old).forEach(([n, nm]) => { if (names[n] !== nm) legacy[nm] = netKey(n); });
    pads.forEach(p => { p.netName = p.net === null ? "" : names[p.net] || ("N" + p.net); });
    return { parts, pads, holes, names, legacy };
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers: copper items as capsules (a segment with a radius) — pads, tracks, vias
  // ---------------------------------------------------------------------------
  function segDist(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function segSeg(a, b) {   // distance between segments a=[x1,y1,x2,y2] and b
    const inter = (() => {
      const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]); if (!d) return false;
      const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d, u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
      return t >= 0 && t <= 1 && u >= 0 && u <= 1;
    })();
    if (inter) return 0;
    return Math.min(segDist(a[0], a[1], a[2], a[3], b[0], b[1]), segDist(a[0], a[1], a[2], a[3], b[2], b[3]), segDist(b[0], b[1], b[2], b[3], a[0], a[1]), segDist(b[0], b[1], b[2], b[3], a[2], a[3]));
  }
  // a pad as a capsule: round = point; rect/oval = segment along the long side
  function padCapsule(p) {
    const r = Math.min(p.w, p.h) / 2, l = Math.max(p.w, p.h) / 2 - r, hz = p.w >= p.h;
    return { s: hz ? [p.x - l, p.y, p.x + l, p.y] : [p.x, p.y - l, p.x, p.y + l], r: p.shape === "rect" ? r * 1.15 : r };
  }
  // all copper items: { kind, layers, s: segment, r, net (pads only), ref }
  // a plated mounting hole: a copper ring on both layers (Ø 6 mm round an M3 hole unless set)
  const holeRing = h => (h.pad > h.d ? h.pad : +(h.d + 2.8).toFixed(3));
  // the non-plated holes: the board's mounting holes and, with the model, the parts' own (a part's
  // hole carries its part and ref: a locating peg, not a screw at chassis potential)
  const npHoles = (board, model) => (board.holes || []).filter(h => !h.plated).concat((model && model.holes) || []);
  function copperItems(board, pads) {
    const items = [];
    // a square pad also keeps its exact rectangle: the capsule misses its corners by up to 0.14 mm
    pads.forEach((p, i) => { const c = padCapsule(p); items.push({ kind: "pad", i, layers: p.layers || COPPER, s: c.s, r: c.r, pad: p, box: p.shape === "rect" ? [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2] : null }); });
    board.tracks.forEach((t, ti) => { for (let k = 0; k + 1 < t.pts.length; k++) items.push({ kind: "track", ti, k, layers: [t.layer], s: [t.pts[k][0], t.pts[k][1], t.pts[k + 1][0], t.pts[k + 1][1]], r: t.w / 2 }); });
    board.vias.forEach((v, vi) => items.push({ kind: "via", vi, layers: COPPER, s: [v.x, v.y, v.x, v.y], r: (v.pad || board.rules.viaPad) / 2 }));
    (board.holes || []).forEach((h, hi) => { if (h.plated) items.push({ kind: "hole", hi, layers: COPPER, s: [h.x, h.y, h.x, h.y], r: holeRing(h) / 2 }); });
    return items;
  }
  const shareLayer = (a, b) => a.layers.some(l => b.layers.includes(l));
  // distance from segment s to rectangle b = [x1, y1, x2, y2] (0 when it touches or is inside)
  function segBox(s, b) {
    const inb = (x, y) => x >= b[0] - 1e-9 && x <= b[2] + 1e-9 && y >= b[1] - 1e-9 && y <= b[3] + 1e-9;
    if (inb(s[0], s[1]) || inb(s[2], s[3])) return 0;
    return Math.min(segSeg(s, [b[0], b[1], b[2], b[1]]), segSeg(s, [b[2], b[1], b[2], b[3]]), segSeg(s, [b[2], b[3], b[0], b[3]]), segSeg(s, [b[0], b[3], b[0], b[1]]));
  }
  /** Distance from segment s (no width) to copper item it's edge: a square pad as its rectangle,
      the rest as capsules */
  const segItem = (s, it) => (it.box ? segBox(s, it.box) : segSeg(s, it.s) - it.r);
  const gap = (a, b) => {
    if (a.box && b.box) return Math.hypot(Math.max(0, a.box[0] - b.box[2], b.box[0] - a.box[2]), Math.max(0, a.box[1] - b.box[3], b.box[1] - a.box[3]));
    if (a.box) return segBox(b.s, a.box) - b.r;
    if (b.box) return segBox(a.s, b.box) - a.r;
    return segSeg(a.s, b.s) - a.r - b.r;
  };
  /** A track entering a pad may come as close to the same footprint's other pads as that pad
      itself is: the part's own pin spacing (a noval socket's pins are 1.3 mm apart, whatever the
      voltage) is a limit no layout can beat. Returns that spacing to padIt when the segment s
      ends in another pad of padIt's footprint, else null. */
  function entryGap(s, padIt, items) {
    let best = null;
    items.forEach(q => {
      if (q.kind !== "pad" || q === padIt || q.pad.part !== padIt.pad.part) return;
      const inside = (x, y) => segDist(q.s[0], q.s[1], q.s[2], q.s[3], x, y) <= q.r + 1e-6;
      if (inside(s[0], s[1]) || inside(s[2], s[3])) { const g = gap(q, padIt); best = best === null ? g : Math.max(best, g); }
    });
    return best;
  }

  /** Two tracks ending in neighbouring pads of one footprint (a TO-92's pins are 0.22 mm apart)
      are as close as those pads where they enter them. Only the parts of the tracks outside their
      pads must keep the clearance; inside, the limit is the pads' own spacing. Returns { entry:
      the pads' gap, out: the distance between the tracks' centre lines outside their pads } when
      segments sa and sb end in different pads of one footprint, else null. */
  function outsidePad(s, p) {   // the part of segment s outside pad item p; null when all of it is inside
    const inside = (x, y) => segDist(p.s[0], p.s[1], p.s[2], p.s[3], x, y) <= p.r + 1e-6;
    let [x1, y1, x2, y2] = s; const i1 = inside(x1, y1), i2 = inside(x2, y2);
    if (i1 && i2) return null;
    if (!i1 && !i2) return s;
    if (i2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
    let lo = 0, hi = 1;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (inside(x1 + (x2 - x1) * m, y1 + (y2 - y1) * m)) lo = m; else hi = m; }
    return [x1 + (x2 - x1) * hi, y1 + (y2 - y1) * hi, x2, y2];
  }
  function anchorGap(sa, sb, items) {
    const ins = (q, x, y) => segDist(q.s[0], q.s[1], q.s[2], q.s[3], x, y) <= q.r + 1e-6;
    const ends = s => items.filter(q => q.kind === "pad" && (ins(q, s[0], s[1]) || ins(q, s[2], s[3])));
    let best = null;
    for (const pa of ends(sa)) for (const pb of ends(sb)) {
      if (pa === pb || pa.pad.part !== pb.pad.part) continue;
      const ta = outsidePad(sa, pa), tb = outsidePad(sb, pb), r = { entry: gap(pa, pb), out: ta && tb ? segSeg(ta, tb) : Infinity };
      if (!best || r.out > best.out) best = r;
    }
    return best;
  }
  /** true when two tracks closer than need are excused by anchorGap */
  function anchoredOk(a, b, g, need, items) {
    const ag = anchorGap(a.s, b.s, items);
    return !!ag && g >= ag.entry - 0.02 - 1e-6 && ag.out - a.r - b.r >= need - 1e-6;
  }

  /** Copper connectivity: which items touch (union-find), what each cluster's nets are, the
      ratsnest (shortest links still missing per net), unrouted count and shorts */
  function connectivity(board, pads, fills, star) {
    const items = copperItems(board, pads), n = items.length, par = items.map((_, i) => i);
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = items[i], b = items[j];
      if (a.kind === "pad" && b.kind === "pad") continue;          // pads only join through copper
      if (shareLayer(a, b) && gap(a, b) <= 1e-6) par[find(i)] = find(j);
    }
    // a copper pour joins everything each of its pieces reaches
    (fills || []).forEach(f => f.links.forEach(list => list.forEach(i => { if (i < n) par[find(i)] = find(list[0]); })));
    const cl = new Map();   // root -> { nets:Set, pads:[] }
    items.forEach((it, i) => { const r = find(i); if (!cl.has(r)) cl.set(r, { nets: new Set(), pads: [], items: [] }); const c = cl.get(r); c.items.push(it); if (it.kind === "pad") { c.pads.push(it.pad); if (it.pad.net !== null) c.nets.add(it.pad.net); } });
    items.forEach((it, i) => { it.cluster = find(i); it.net = cl.get(it.cluster).nets.size === 1 ? [...cl.get(it.cluster).nets][0] : (cl.get(it.cluster).nets.size ? "short" : null); });
    // ratsnest: per net, join its clusters with the shortest pad-to-pad links (Prim over clusters)
    const byNet = new Map();
    pads.forEach((p, i) => { if (p.net === null) return; if (!byNet.has(p.net)) byNet.set(p.net, new Map()); const r = items[i].cluster, m = byNet.get(p.net); if (!m.has(r)) m.set(r, []); m.get(r).push(p); });
    const rats = []; let unrouted = 0;
    const prim = (gs, net, group) => {
      if (gs.length < 2) return;
      unrouted += gs.length - 1;
      const inTree = [gs[0]], rest = gs.slice(1);
      while (rest.length) {
        let best = null;
        inTree.forEach(a => rest.forEach((b, bi) => a.forEach(p => b.forEach(q => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (!best || d < best.d) best = { d, p, q, bi }; }))));
        rats.push({ net, group, x1: best.p.x, y1: best.p.y, x2: best.q.x, y2: best.q.y });
        inTree.push(rest[best.bi]); rest.splice(best.bi, 1);
      }
    };
    const si = star && star.pad ? pads.indexOf(star.pad) : -1;
    byNet.forEach((groups, net) => {
      if (si < 0 || net !== star.pad.net) return prim([...groups.values()], net);
      // star grounding: each ground return joins its own pads, then runs to the star point on its own
      const sc = items[si].cluster, by = new Map();
      pads.forEach((p, i) => {
        if (p.net !== net || i === si) return;
        const g = star.groupOf.get(p) || "Signal"; if (!by.has(g)) by.set(g, new Map([[sc, [star.pad]]]));
        const m = by.get(g), r = items[i].cluster; if (!m.has(r)) m.set(r, []); m.get(r).push(p);
      });
      by.forEach((m, g) => prim([...m.values()], net, g));
    });
    const shorts = [...cl.values()].filter(c => c.nets.size > 1).map(c => [...c.nets]);
    return { items, clusters: cl, rats, unrouted, shorts };
  }

  // ---------------------------------------------------------------------------
  // Copper pours. A pour is the zone's polygon (or the whole board inside the edge clearance)
  // minus a clearance around every copper item of another net, holes and copper text; its own
  // net's pads join through thermal reliefs (a gap and four spokes), its tracks and vias solidly.
  // A raster of the result (0.2 mm cells) finds the pieces: which items each piece reaches
  // (that is the connectivity) and the islands that reach none, which are removed.
  // The result is a list of drawing operations, the same for the screen, the Gerbers and PDFs:
  // { pol: "D" (copper) | "C" (clear), t: "region", pts } | { t: "flash", shape: "C"|"R"|"O", x, y, w, h } | { t: "line", w, pts }
  // ---------------------------------------------------------------------------
  const RES = 0.2, POUR_TRIM = 0.075;   // raster cell; how much further a pour keeps off at the end (mm)
  function pip(x, y, poly) {
    let ins = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; }
    return ins;
  }
  /** The outline as a polygon (corner arcs in steps), inset by d */
  function outlinePoly(o, d) {
    const R = Math.max(0, Math.min(o.r || 0, o.w / 2, o.h / 2)), r = Math.max(0, R - d), pts = [];
    const c = (cx, cy, a0) => { for (let k = 0; k <= (r > 0 ? 8 : 0); k++) { const a = (a0 + k * 90 / 8) * Math.PI / 180; pts.push([+(cx + r * Math.cos(a)).toFixed(4), +(cy + r * Math.sin(a)).toFixed(4)]); } };
    const m = Math.max(R, d);
    c(o.w - m, m, -90); c(o.w - m, o.h - m, 0); c(m, o.h - m, 90); c(m, m, 180);
    return pts;
  }
  // a pour's outline cut to the board inside the edge clearance (round corners too): Sutherland-Hodgman
  // against the inset outline, which is convex
  function clipConvex(P, C) {
    const cx = C.reduce((s, p) => s + p[0], 0) / C.length, cy = C.reduce((s, p) => s + p[1], 0) / C.length;
    const cr = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const side = (a, b, p) => cr(a, b, p) * Math.sign(cr(a, b, [cx, cy])) >= -1e-9;
    let out = P;
    for (let i = 0; i < C.length && out.length; i++) {
      const a = C[i], b = C[(i + 1) % C.length], inp = out; out = [];
      for (let k = 0; k < inp.length; k++) {
        const p = inp[k], q = inp[(k + 1) % inp.length], pin = side(a, b, p), qin = side(a, b, q);
        if (pin) out.push(p);
        if (pin !== qin) {
          const dx = q[0] - p[0], dy = q[1] - p[1], ex = b[0] - a[0], ey = b[1] - a[1], den = dx * ey - dy * ex;
          if (Math.abs(den) > 1e-12) { const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den; out.push([+(p[0] + t * dx).toFixed(4), +(p[1] + t * dy).toFixed(4)]); }
        }
      }
    }
    return out;
  }
  function zonePoly(board, z) {
    const o = board.outline, e = board.rules.edgeClearance, inset = outlinePoly(o, e);
    if (z.pts && z.pts.length >= 3) { const P = clipConvex(z.pts, inset); return P.length >= 3 ? P : z.pts.slice(0, 1).concat(z.pts.slice(0, 1), z.pts.slice(0, 1)); }
    return inset;
  }
  const flashOf = (p, grow) => ({ t: "flash", shape: p.shape === "rect" ? "R" : Math.abs(p.w - p.h) < 1e-6 ? "C" : "O", x: p.x, y: p.y, w: +(p.w + 2 * grow).toFixed(4), h: +(p.h + 2 * grow).toFixed(4) });
  // a copper item (capsule) grown by c, as an operation
  function itemOp(pol, it, c) {
    if (it.kind === "pad") return { pol, ...flashOf(it.pad, c) };
    const [x1, y1, x2, y2] = it.s;
    return { pol, t: "line", w: +(2 * (it.r + c)).toFixed(4), pts: [[x1, y1], [x2, y2]] };
  }
  /** Paint operations into a grid (1 = copper) */
  function rasterise(ops, nx, ny) {
    const g = new Uint8Array(nx * ny);
    const cell = (x1, y1, x2, y2, test, v) => {
      const i1 = Math.max(0, Math.floor(x1 / RES)), i2 = Math.min(nx - 1, Math.ceil(x2 / RES)), j1 = Math.max(0, Math.floor(y1 / RES)), j2 = Math.min(ny - 1, Math.ceil(y2 / RES));
      for (let j = j1; j <= j2; j++) { const y = (j + 0.5) * RES; for (let i = i1; i <= i2; i++) { const x = (i + 0.5) * RES; if (test(x, y)) g[j * nx + i] = v; } }
    };
    ops.forEach(op => {
      const v = op.pol === "C" ? 0 : 1;
      if (op.t === "region") {
        const P = op.pts;
        for (let j = 0; j < ny; j++) {
          const y = (j + 0.5) * RES, xs = [];
          for (let a = 0, b = P.length - 1; a < P.length; b = a++) { const [xa, ya] = P[a], [xb, yb] = P[b]; if ((ya > y) !== (yb > y)) xs.push(xa + (y - ya) * (xb - xa) / (yb - ya)); }
          xs.sort((p, q) => p - q);
          for (let k = 0; k + 1 < xs.length; k += 2) { const i1 = Math.max(0, Math.ceil(xs[k] / RES - 0.5)), i2 = Math.min(nx - 1, Math.floor(xs[k + 1] / RES - 0.5)); for (let i = i1; i <= i2; i++) g[j * nx + i] = v; }
        }
      } else if (op.t === "flash") {
        const { x, y, w, h } = op;
        if (op.shape === "R") cell(x - w / 2, y - h / 2, x + w / 2, y + h / 2, (px, py) => Math.abs(px - x) <= w / 2 && Math.abs(py - y) <= h / 2, v);
        else { const r = Math.min(w, h) / 2, l = Math.max(w, h) / 2 - r, s = w >= h ? [x - l, y, x + l, y] : [x, y - l, x, y + l]; cell(x - w / 2, y - h / 2, x + w / 2, y + h / 2, (px, py) => segDist(s[0], s[1], s[2], s[3], px, py) <= r, v); }
      } else if (op.t === "line") {
        const r = op.w / 2;
        for (let k = 0; k + 1 < op.pts.length; k++) { const [x1, y1] = op.pts[k], [x2, y2] = op.pts[k + 1]; cell(Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r, (px, py) => segDist(x1, y1, x2, y2, px, py) <= r, v); }
      }
    });
    return g;
  }
  /** Fill every pour. conn: the connectivity without pours (gives the items and their nets).
      Returns per zone { zone, layer, net, ops, links: [[item index...] per piece], pieces, islands, unknownNet } */
  function fillZones(board, model, conn, hv, netlist, tears) {
    const R = board.rules, zones = board.zones || [], o = board.outline;
    if (!zones.length || !model) return [];
    const byName = {}; Object.entries(model.names).forEach(([n, nm]) => { byName[nm] = isNaN(+n) ? n : +n; });
    const cls = n => (n === null || n === undefined || n === "short" ? "Signal" : netClassOf(n, model.names, hv, R));
    // an item's net: from the copper it touches, else the net stored on the track or via
    const netOf = it => {
      if (it.net !== null && it.net !== undefined) return it.net;
      const stored = it.kind === "track" ? board.tracks[it.ti].net : it.kind === "via" ? board.vias[it.vi].net : it.kind === "hole" ? board.holes[it.hi].net : null;
      return stored && byName[stored] !== undefined ? byName[stored] : null;
    };
    const nx = Math.max(1, Math.ceil(o.w / RES)), ny = Math.max(1, Math.ceil(o.h / RES)), CR = clearanceRules(board, model, hv, netlist);
    return zones.map((z, zi) => {
      const net = byName[z.net], L = z.layer, poly = zonePoly(board, z), zc = classRule(cls(net), R).clearance;
      const need = n => Math.max(zc, classRule(cls(n), R).clearance, CR.need(net, n).c), gapT = z.gap > 0 ? z.gap : 0.5, spoke = z.spoke > 0 ? z.spoke : 0.8;
      const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), bx1 = Math.min(...xs), bx2 = Math.max(...xs), by1 = Math.min(...ys), by2 = Math.max(...ys);
      const near = (s, r) => Math.max(s[0], s[2]) + r >= bx1 && Math.min(s[0], s[2]) - r <= bx2 && Math.max(s[1], s[3]) + r >= by1 && Math.min(s[1], s[3]) - r <= by2;
      const ops = [{ pol: "D", t: "region", pts: poly }], own = [], others = [];
      (board.keepouts || []).forEach(k => { if (k.pour !== false && koLayers(k).includes(L)) ops.push({ pol: "C", t: "region", pts: k.pts }); });
      conn.items.forEach(it => {
        if (!it.layers.includes(L)) return;
        const n = netOf(it);
        if (net !== undefined && n === net) { if (it.kind === "pad" && z.thermal !== false) own.push(it); return; }
        const c = need(n); others.push({ it, c });
        if (near(it.s, it.r + c)) ops.push(itemOp("C", it, c));
      });
      const hcm = Math.max(zc, CR.toChassis(net).c);
      // other nets' teardrops: the shape and the clearance round its edges
      (tears || []).forEach(td => { if (td.layer !== L || (net !== undefined && td.net === net)) return; const c = need(td.net); ops.push({ pol: "C", t: "region", pts: td.pts }); td.pts.forEach((a, i) => { const b = td.pts[(i + 1) % td.pts.length]; ops.push({ pol: "C", t: "line", w: +(2 * c).toFixed(4), pts: [a, b] }); }); });
      npHoles(board, model).forEach(h => { const hc = h.part ? zc : hcm; if (near([h.x, h.y, h.x, h.y], h.d / 2 + hc)) ops.push({ pol: "C", t: "flash", shape: "C", x: h.x, y: h.y, w: +(h.d + 2 * hc).toFixed(4), h: +(h.d + 2 * hc).toFixed(4) }); });
      (board.texts || []).filter(t => t.layer === L).forEach(t => { const st = strokeText(t.text, t.x, t.y, t.size, t.rot, L === "B.Cu"); st.lines.forEach(l => ops.push({ pol: "C", t: "line", w: +(st.w + 2 * zc).toFixed(4), pts: l })); });
      // thermal reliefs: the gap around the pad, then spokes that stay in the pour and clear of other nets
      const spokes = [];
      own.forEach(it => {
        const p = it.pad; ops.push({ pol: "C", ...flashOf(p, gapT) });
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
          const len = (dx ? p.w : p.h) / 2 + gapT + spoke, s = [p.x, p.y, +(p.x + dx * len).toFixed(4), +(p.y + dy * len).toFixed(4)];
          if (!pip(s[2], s[3], poly)) return;
          if (others.some(({ it: q, c }) => segItem(s, q) - spoke / 2 < c - 1e-6)) return;
          if (npHoles(board, model).some(h => segDist(s[0], s[1], s[2], s[3], h.x, h.y) - spoke / 2 - h.d / 2 < (h.part ? zc : hcm) - 1e-6)) return;
          spokes.push({ pol: "D", t: "line", w: spoke, pts: [[s[0], s[1]], [s[2], s[3]]] });
        });
      });
      ops.push(...spokes);
      // the pieces: flood fill the raster
      const g = rasterise(ops, nx, ny), lab = new Int32Array(nx * ny);
      let pieces = 0; const stack = [];
      for (let k = 0; k < g.length; k++) {
        if (!g[k] || lab[k]) continue;
        lab[k] = ++pieces; stack.push(k);
        while (stack.length) { const c = stack.pop(), i = c % nx, j = (c - i) / nx; [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].forEach(([a, b]) => { if (a < 0 || b < 0 || a >= nx || b >= ny) return; const q = b * nx + a; if (g[q] && !lab[q]) { lab[q] = pieces; stack.push(q); } }); }
      }
      const hit = Array.from({ length: pieces + 1 }, () => []);
      conn.items.forEach((it, idx) => {
        if (!it.layers.includes(L)) return;
        const [x1, y1, x2, y2] = it.s, m = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / RES)), seen = new Set();
        for (let k = 0; k <= m; k++) {
          const i = Math.floor((x1 + (x2 - x1) * k / m) / RES), j = Math.floor((y1 + (y2 - y1) * k / m) / RES);
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const l = lab[j * nx + i]; if (l && !seen.has(l)) { seen.add(l); hit[l].push(idx); }
        }
      });
      // islands: pieces that reach no item are removed (cleared in runs, one cell wider all round)
      let islands = 0;
      for (let l = 1; l <= pieces; l++) if (!hit[l].length) islands++;
      if (islands) for (let j = 0; j < ny; j++) {
        let i = 0;
        while (i < nx) {
          const l = lab[j * nx + i];
          if (!l || hit[l].length) { i++; continue; }
          let e = i; while (e + 1 < nx && lab[j * nx + e + 1] && !hit[lab[j * nx + e + 1]].length) e++;
          ops.push({ pol: "C", t: "flash", shape: "R", x: +((i + e + 1) / 2 * RES).toFixed(4), y: +((j + 0.5) * RES).toFixed(4), w: +((e - i + 3) * RES).toFixed(4), h: +(3 * RES).toFixed(4) });
          i = e + 1;
        }
      }
      // last, every cut grows by POUR_TRIM (and the pour's outline comes in by as much): crumbs of copper thinner
      // than twice that, which the raster cannot see (where two clearances nearly touch, or beside an island's
      // cut), go too. A board maker's check flags such slivers; they can flake off and short
      const trim = +(2 * POUR_TRIM).toFixed(4), edges = pts => pts.map((a, i) => ({ pol: "C", t: "line", w: trim, pts: [a, pts[(i + 1) % pts.length]] })), more = edges(poly);
      ops.forEach((op, k) => {
        if (!k || op.pol !== "C") return;
        if (op.t === "line") op.w = +(op.w + trim).toFixed(4);
        else if (op.t === "flash") { op.w = +(op.w + trim).toFixed(4); op.h = +(op.h + trim).toFixed(4); }
        else if (op.t === "region") more.push(...edges(op.pts));
      });
      ops.push(...more, ...spokes);
      return { zone: zi, layer: L, net: net === undefined ? null : net, ops, links: hit.filter(h => h.length > 1), pieces: pieces - islands, islands, unknownNet: net === undefined };
    });
  }

  // ---------------------------------------------------------------------------
  // A part's silkscreen in board coordinates (outline lines, circles as polylines, the reference
  // above it in the stroke font), as drawing operations; the editor, the Gerbers and the check use it
  // ---------------------------------------------------------------------------
  const SILK_W = 0.15, REF_H = 1.27;
  function partBox(g) {
    const pts = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(p => place(p, g.place));
    return { x1: Math.min(...pts.map(p => p[0])), y1: Math.min(...pts.map(p => p[1])), x2: Math.max(...pts.map(p => p[0])), y2: Math.max(...pts.map(p => p[1])) };
  }
  function partSilk(g, noRef, outline, pads) {
    const r4 = v => +(+v).toFixed(4), P = pt => place(pt, g.place).map(r4), ops = [];
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
    if (!noRef) {
      // above the part; below it when that would leave the board (a part along the top edge).
      // Given the board's pads, the first of above, below, right and left that clears every pad on
      // the part's side (and the outline): small SMD parts packed close would otherwise have their
      // references printed over their neighbours' pads, which the maker clips
      const b = partBox(g), above = b.y1 - 0.4 - REF_H / 2, below = b.y2 + 0.4 + REF_H / 2, mid = (b.x1 + b.x2) / 2, mir = g.place.side === "B";
      const y0 = outline && above - REF_H / 2 < 0.5 && below + REF_H / 2 <= outline.h - 0.5 ? below : above;
      let st = strokeText(g.ref, mid, y0, REF_H, 0, mir);
      if (pads && pads.length) {
        const side = g.place.side || "F", near = pads.filter(pd => onSide(pd, side) && pd.x > b.x1 - st.width - 6 && pd.x < b.x2 + st.width + 6 && pd.y > b.y1 - 6 && pd.y < b.y2 + 6).map(padCapsule);
        const half = st.width / 2, cy = (b.y1 + b.y2) / 2;
        const spots = [[mid, y0], [mid, y0 === above ? below : above], [b.x2 + 0.5 + half, cy], [b.x1 - 0.5 - half, cy]];
        const inside = (x, y) => !outline || (x - half > 0.5 && x + half < outline.w - 0.5 && y - REF_H / 2 > 0.5 && y + REF_H / 2 < outline.h - 0.5);
        const clear = t => t.lines.every(l => l.every((p, k) => !k || near.every(c => segSeg([l[k - 1][0], l[k - 1][1], p[0], p[1]], c.s) >= c.r + t.w / 2 + 0.05)));
        for (const [x, y] of spots) { const t = strokeText(g.ref, x, y, REF_H, 0, mir); if (inside(x, y) && clear(t)) { st = t; break; } }
      }
      st.lines.forEach(l => ops.push({ pol: "D", t: "line", w: st.w, pts: l, ref: true }));
    }
    return ops;
  }
  // does segment s cross polygon P (an end inside, or an edge crossing)?
  function segInPoly(s, P, r) {
    if (pip(s[0], s[1], P) || pip(s[2], s[3], P)) return true;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (segSeg(s, [P[j][0], P[j][1], P[i][0], P[i][1]]) <= (r || 0)) return true;
    return false;
  }
  const boxPoly = b => [[b.x1, b.y1], [b.x2, b.y1], [b.x2, b.y2], [b.x1, b.y2]];
  function polyHitsPoly(A, Bp) {
    if (A.some(p => pip(p[0], p[1], Bp)) || Bp.some(p => pip(p[0], p[1], A))) return true;
    for (let i = 0, j = A.length - 1; i < A.length; j = i++) if (segInPoly([A[j][0], A[j][1], A[i][0], A[i][1]], Bp, 0)) return true;
    return false;
  }
  const koLayers = k => (Array.isArray(k.layers) && k.layers.length ? k.layers : COPPER);

  /** Design-rule check. Kinds: clearance (copper of different nodes closer than their net
      classes allow; holes against copper), short, edge (copper or parts over or too near the
      outline), unplaced, annular (ring around a hole too thin), drill (hole below the minimum),
      width (track below the minimum), class (track narrower than its net class), pinout
      (footprints whose pin order differs between makers). rules.checks turns kinds off. */
  /** Valve sockets' pads: under the socket's body (a disc round its pins) a track may pass a pin
      as close as that pin is to its nearest neighbour; the socket fixes that spacing, and copper
      there adds no new path between the pins. Returns Map pad -> { x, y, r: the body's centre and
      radius, gap: the pin's edge-to-edge distance to its nearest neighbour } (empty when the rule
      is off) */
  function socketPads(board, model) {
    const out = new Map();
    if (board.rules.socketBody === false) return out;
    model.parts.forEach(g => {
      const m = g.fp && g.place && /^SOCKET-(.+?)(-CAP)?$/.exec(g.fp.name); if (!m) return;
      // the top cap's pad stands outside the body
      const S = SOCKETS[m[1]], pads = model.pads.filter(p => p.part === g.key && p.num !== "cap"), cap = p => padCapsule(p);
      const body = S ? S.body / 2 : Math.max(...g.fp.pads.filter(p => p.num !== "cap").map(p => Math.hypot(p.x, p.y))) + 4;
      pads.forEach(p => {
        const gp = Math.min(...pads.filter(q => q !== p).map(q => { const a = cap(p), b = cap(q); return segSeg(a.s, b.s) - a.r - b.r; }));
        out.set(p, { x: g.place.x, y: g.place.y, r: body, gap: gp });
      });
    });
    return out;
  }
  // the clearance a track or via needs from a socket's pin where it comes closest to it
  function underSocket(sp, padIt, other) {
    const b = sp.get(padIt.pad); if (!b) return null;
    const [x, y] = nearest(padIt.s, other.s);
    return Math.hypot(x - b.x, y - b.y) <= b.r ? b.gap - 0.02 : null;
  }
  // a pad has copper on that side ("F" or "B"): a through-hole pad on both
  const onSide = (p, side) => !p.layers || p.layers.includes(side + ".Cu");
  function drc(board, model, conn, hvNets, fills, netlist) {
    const out = [], R = board.rules, on = k => !R.checks || R.checks[k] !== false, items = conn.items, hv = hvNets || new Set(), o = board.outline;
    const cls = net => (net === null || net === "short" ? "Signal" : netClassOf(net, model.names, hv, R));
    const SP = socketPads(board, model), CR = clearanceRules(board, model, hv, netlist), vNote = (r, hvx) => (r.ipc ? ` (${Math.round(r.v)} V between them${r.why === "inductive" ? " at full drive" : ""}: IPC-2221B ${CR.table})` : hvx ? " (high voltage)" : "");
    if (on("clearance")) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.cluster === b.cluster || !shareLayer(a, b)) continue;
      if (a.kind === "pad" && b.kind === "pad" && a.pad.part === b.pad.part) continue;   // within a footprint: the maker's spacing
      const ca = cls(a.net), cb = cls(b.net), g = gap(a, b), rq = CR.need(a.net, b.net);
      let need = rq.c;
      if (g < need - 1e-6 && a.kind !== b.kind && (a.kind === "pad" || b.kind === "pad") && (a.kind === "track" || b.kind === "track")) {
        const [t, p] = a.kind === "track" ? [a, b] : [b, a], eg = entryGap(t.s, p, items);
        if (eg !== null) need = Math.min(need, eg - 0.02);
      }
      if (g < need - 1e-6 && a.kind !== b.kind && (a.kind === "pad" || b.kind === "pad")) {
        const [p, t] = a.kind === "pad" ? [a, b] : [b, a], us = (t.kind === "track" || t.kind === "via") ? underSocket(SP, p, t) : null;
        if (us !== null) need = Math.min(need, us);
      }
      if (g < need - 1e-6 && a.kind === "track" && b.kind === "track" && anchoredOk(a, b, g, need, items)) continue;
      if (g < need - 1e-6) {
        const [x, y] = nearest(a.s, b.s), hvx = ca === "HV" || cb === "HV";
        out.push({ kind: "clearance", x, y, msg: `Clearance ${Math.max(0, g).toFixed(2)} mm < ${+need.toFixed(2)} mm${vNote(rq, hvx)}`, between: [label(a), label(b)] });
      }
    }
    // mounting holes against copper (a part's own unplated hole: the net class's clearance, its own pads too)
    if (on("clearance")) npHoles(board, model).forEach(hl => items.forEach(it => {
      const rq = hl.part ? { c: 0 } : CR.toChassis(it.net), g = segItem([hl.x, hl.y, hl.x, hl.y], it) - hl.d / 2, need = Math.max(classRule(cls(it.net), R).clearance, rq.c);
      if (g < need - 1e-6) out.push({ kind: "clearance", x: hl.x, y: hl.y, msg: `Clearance ${Math.max(0, g).toFixed(2)} mm < ${+need.toFixed(2)} mm to ${hl.part ? `${hl.ref}'s unplated hole` : "a mounting hole (its screw is at chassis potential)"}${rq.ipc ? `; ${Math.round(rq.v)} V: IPC-2221B ${CR.table}` : ""}`, between: [label(it), hl.part ? `${hl.ref} hole` : "hole"] });
    }));
    if (on("short")) conn.clusters.forEach(c => { if (c.nets.size > 1) { const p = c.pads[0]; out.push({ kind: "short", x: p.x, y: p.y, msg: `Short between ${[...c.nets].map(n => model.names[n] || n).join(" and ")}` }); } });
    // the outline: a part entirely off the board is waiting to be placed; partly over the edge,
    // or copper closer to the edge than the edge clearance, is an error
    const ins = (x, y) => edgeDist(x, y, o) >= 0;
    const placedOff = new Set();
    model.parts.forEach(g => {
      if (!g.place || !g.fp) return;
      const c = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(pt => place(pt, g.place));
      const n = c.filter(([x, y]) => ins(x, y)).length;
      if (n === 0) { placedOff.add(g.key); if (on("unplaced")) out.push({ kind: "unplaced", x: g.place.x, y: g.place.y, msg: `${g.ref} is not on the board yet` }); }
      else if (n < 4 && on("edge")) out.push({ kind: "edge", x: g.place.x, y: g.place.y, msg: `${g.ref} reaches over the board edge` });
    });
    if (on("edge")) items.forEach(it => {
      if (it.kind === "pad" && placedOff.has(it.pad.part)) return;
      const [x1, y1, x2, y2] = it.s, n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 0.5));
      let worst = Infinity, wx = x1, wy = y1;
      for (let k = 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n, d = edgeDist(x, y, o) - it.r; if (d < worst) { worst = d; wx = x; wy = y; } }
      // a square pad's corners reach past its capsule
      if (it.box) [[it.box[0], it.box[1]], [it.box[2], it.box[1]], [it.box[0], it.box[3]], [it.box[2], it.box[3]]].forEach(([x, y]) => { const d = edgeDist(x, y, o); if (d < worst) { worst = d; wx = x; wy = y; } });
      if (worst < R.edgeClearance - 1e-6) out.push({ kind: "edge", x: wx, y: wy, msg: worst < 0 ? `A ${label(it)} runs outside the board outline` : `A ${label(it)} is ${worst.toFixed(2)} mm from the board edge (< ${R.edgeClearance} mm)` });
    });
    // holes and rings
    if (on("drill") || on("annular")) {
      const seen = new Set();
      model.pads.forEach(p => {
        if (placedOff.has(p.part) || p.smd) return;
        const k = p.part + p.num, ring = (Math.min(p.w, p.h) - p.drill) / 2;
        if (on("drill") && p.drill < R.minDrill - 1e-6 && !seen.has("d" + p.part)) { seen.add("d" + p.part); out.push({ kind: "drill", x: p.x, y: p.y, msg: `${p.ref}: drill ${p.drill} mm < ${R.minDrill} mm` }); }
        if (on("annular") && ring < R.minAnnular - 1e-6 && !p.pitchRing && !seen.has("a" + k)) { seen.add("a" + k); out.push({ kind: "annular", x: p.x, y: p.y, msg: `${p.ref}-${p.num}: annular ring ${ring.toFixed(2)} mm < ${R.minAnnular} mm` }); }
      });
      board.vias.forEach(v => {
        const d = v.drill || R.viaDrill, pd = v.pad || R.viaPad;
        if (on("drill") && d < R.minDrill - 1e-6) out.push({ kind: "drill", x: v.x, y: v.y, msg: `Via drill ${d} mm < ${R.minDrill} mm` });
        if (on("annular") && (pd - d) / 2 < R.minAnnular - 1e-6) out.push({ kind: "annular", x: v.x, y: v.y, msg: `Via annular ring ${((pd - d) / 2).toFixed(2)} mm < ${R.minAnnular} mm` });
      });
      // a via in (or touching) an SMD pad: the mask opens over it and the paste runs down the hole
      if (on("viapad")) items.forEach(v => {
        if (v.kind !== "via") return;
        const p = items.find(q => q.kind === "pad" && q.pad.smd && shareLayer(q, v) && gap(q, v) < 0.1);
        if (p) out.push({ kind: "viapad", x: v.s[0], y: v.s[1], msg: `${p.pad.ref}-${p.pad.num}: a via in its SMD pad; solder paste runs down the hole and starves the joint: move the via just off the pad` });
      });
      (board.holes || []).forEach(h => { if (h.plated && on("annular") && (holeRing(h) - h.d) / 2 < R.minAnnular - 1e-6) out.push({ kind: "annular", x: h.x, y: h.y, msg: `Plated hole: annular ring ${((holeRing(h) - h.d) / 2).toFixed(2)} mm < ${R.minAnnular} mm` }); });
    }
    // a mounting hole's wall too near the board edge: the web of board between them breaks when it is drilled or screwed down
    if (on("holeedge")) (board.holes || []).forEach(h => {
      const g = edgeDist(h.x, h.y, o) - h.d / 2, need = Number.isFinite(+R.holeEdge) ? +R.holeEdge : 1;
      if (g < need - 1e-6) out.push({ kind: "holeedge", x: h.x, y: h.y, msg: g < 0 ? `Mounting hole Ø${h.d} cuts the board edge` : `Mounting hole Ø${h.d}: its wall is ${g.toFixed(2)} mm from the board edge (< ${need} mm)` });
    });
    // a plated hole given a net (a grounded screw) that its copper does not reach
    if (on("dangling")) (board.holes || []).forEach((h, hi) => {
      if (!h.plated || !h.net) return;
      const it = items.find(x => x.kind === "hole" && x.hi === hi), want = Object.keys(model.names).find(k => model.names[k] === h.net);
      if (it && (want === undefined || String(it.net) !== String(want))) out.push({ kind: "dangling", x: h.x, y: h.y, msg: want === undefined ? `Plated hole: there is no net ${h.net}` : `Plated hole for ${h.net} is not connected to it: run a track or a ${h.net} pour to its ring` });
    });
    // track widths: the minimum, and the width of the net's class
    if (on("width") || on("class")) board.tracks.forEach((t, ti) => {
      const it = items.find(x => x.kind === "track" && x.ti === ti), p = t.pts[0];
      if (on("width") && t.w < R.minTrack - 1e-6) out.push({ kind: "width", x: p[0], y: p[1], msg: `Track ${t.w} mm narrower than the minimum ${R.minTrack} mm` });
      else if (on("class") && it && it.net !== null && it.net !== "short") {
        const c = cls(it.net), want = classRule(c, R).track;
        if (t.w < want - 1e-6) out.push({ kind: "class", x: p[0], y: p[1], msg: `Track on ${model.names[it.net] || it.net} (${c}) is ${t.w} mm; the class asks ${want} mm` });
      }
    });
    // pours: a net that is not in the schematic; pours of different nets overlapping on a layer
    (board.zones || []).forEach((z, i) => {
      const P = zonePoly(board, z);
      if (!Object.values(model.names).includes(z.net)) out.push({ kind: "check", x: P[0][0], y: P[0][1], msg: `Copper pour on ${z.layer}: net ${z.net || "(none)"} is not in the schematic` });
      (board.zones || []).slice(i + 1).forEach(z2 => {
        if (z2.layer !== z.layer || z2.net === z.net) return;
        const Q = zonePoly(board, z2), hitP = P.find(p => pip(p[0], p[1], Q)) || Q.find(q => pip(q[0], q[1], P));
        if (hitP) out.push({ kind: "clearance", x: hitP[0], y: hitP[1], msg: `Copper pours of ${z.net} and ${z2.net} overlap on ${z.layer}` });
      });
    });
    // DC current: a track narrower than its net's current needs (IPC-2221 at the allowed rise)
    const amps = netlist ? netCurrents(netlist) : {};
    if (on("current")) board.tracks.forEach((t, ti) => {
      const it = items.find(x => x.kind === "track" && x.ti === ti); if (!it || it.net === null || it.net === "short") return;
      const I = amps[it.net], need = currentWidth(I, R, board.stackup);
      if (need > t.w + 1e-6) out.push({ kind: "current", x: t.pts[0][0], y: t.pts[0][1], msg: `Track on ${model.names[it.net] || it.net} carries ${fmtA(I)}: ${t.w} mm < ${need} mm for a ${R.tempRise || 10} °C rise` });
    });
    // courtyards: parts on the same side overlapping
    const onBoard = model.parts.filter(g => g.place && g.fp && !placedOff.has(g.key)).map(g => ({ g, b: partBox(g) }));
    if (on("courtyard")) onBoard.forEach((a, i) => onBoard.slice(i + 1).forEach(b => {
      if ((a.g.place.side || "F") !== (b.g.place.side || "F")) return;
      const x1 = Math.max(a.b.x1, b.b.x1), x2 = Math.min(a.b.x2, b.b.x2), y1 = Math.max(a.b.y1, b.b.y1), y2 = Math.min(a.b.y2, b.b.y2);
      if (x2 - x1 > 0.05 && y2 - y1 > 0.05) out.push({ kind: "courtyard", x: (x1 + x2) / 2, y: (y1 + y2) / 2, msg: `${a.g.ref} and ${b.g.ref} overlap (courtyards)` });
    }));
    // Z-axis: a top-side part taller than the room under the enclosure's lid (parts whose footprint knows its height)
    if (on("height") && R.maxHeight > 0) onBoard.forEach(({ g }) => {
      const z = g.fp.zHeight; if (!(z > R.maxHeight + 1e-6) || (g.place.side || "F") !== "F") return;
      out.push({ kind: "height", x: g.place.x, y: g.place.y, msg: `${g.ref} is ${z} mm tall${g.fp.mount === "V" ? " standing (L + R + 2d)" : ""}: over the ${R.maxHeight} mm enclosure height (Z-axis clearance)` });
    });
    // mounting holes under a part: the screw head, its washer and the standoff (Ø 7 mm for M3: the
    // hole's diameter plus 3.8 mm) need the board's surface free on both sides
    if (on("courtyard")) (board.holes || []).forEach(h => onBoard.forEach(({ g, b }) => {
      const r = h.d / 2 + 1.9, dx = Math.max(b.x1 - h.x, 0, h.x - b.x2), dy = Math.max(b.y1 - h.y, 0, h.y - b.y2);
      if (Math.hypot(dx, dy) < r - 0.05) out.push({ kind: "courtyard", x: h.x, y: h.y, msg: `Mounting hole (Ø ${h.d} mm) under ${g.ref}: the screw head, washer and standoff need Ø ${+(2 * r).toFixed(1)} mm clear of parts` });
    }));
    // keep-out areas
    if (on("keepout")) (board.keepouts || []).forEach(k => {
      const P = k.pts, L = koLayers(k), nm = k.name ? `keep-out "${k.name}"` : "a keep-out area";
      if (k.tracks !== false) board.tracks.forEach(t => { if (!L.includes(t.layer)) return; for (let s = 0; s + 1 < t.pts.length; s++) { const sg = [t.pts[s][0], t.pts[s][1], t.pts[s + 1][0], t.pts[s + 1][1]]; if (segInPoly(sg, P, t.w / 2)) { out.push({ kind: "keepout", x: (sg[0] + sg[2]) / 2, y: (sg[1] + sg[3]) / 2, msg: `A track on ${t.layer} runs through ${nm}` }); break; } } });
      if (k.vias !== false) board.vias.forEach(v => { const r = (v.pad || R.viaPad) / 2; if (segInPoly([v.x, v.y, v.x, v.y], P, r)) out.push({ kind: "keepout", x: v.x, y: v.y, msg: `A via in ${nm}` }); });
      if (k.parts) onBoard.forEach(({ g, b }) => { if (polyHitsPoly(boxPoly(b), P)) out.push({ kind: "keepout", x: g.place.x, y: g.place.y, msg: `${g.ref} is in ${nm}` }); });
    });
    // silkscreen over pads (the maker clips it: a warning) — the reference and outlines of each part
    if (on("silk")) onBoard.forEach(({ g }) => {
      const side = g.place.side || "F", hit = partSilk(g, false, board.outline, model.pads.filter(pd => !placedOff.has(pd.part))).find(op => op.pts.some((p, k) => k && model.pads.some(pd => !placedOff.has(pd.part) && (op.ref || pd.part !== g.key) && onSide(pd, side) &&
        segSeg([op.pts[k - 1][0], op.pts[k - 1][1], p[0], p[1]], padCapsule(pd).s) < padCapsule(pd).r + op.w / 2)));
      if (hit) out.push({ kind: "silk", x: hit.pts[0][0], y: hit.pts[0][1], msg: `${g.ref}: ${hit.ref ? "its reference" : "silkscreen"} lies over a pad (${side === "B" ? "bottom" : "top"}); the maker clips it` });
    });
    if (on("silk")) (board.texts || []).filter(t => /SilkS$/.test(t.layer)).forEach(t => {
      const st = strokeText(t.text, t.x, t.y, t.size, t.rot, t.layer[0] === "B");
      const over = st.lines.some(l => l.some((p, k) => k && model.pads.some(pd => !placedOff.has(pd.part) && onSide(pd, t.layer[0]) && segSeg([l[k - 1][0], l[k - 1][1], p[0], p[1]], padCapsule(pd).s) < padCapsule(pd).r + st.w / 2)));
      if (over) out.push({ kind: "silk", x: t.x, y: t.y, msg: `The text "${t.text}" lies over a pad; the maker clips it` });
    });
    // track ends that touch nothing (other copper, or a pour of their net)
    if (on("dangling")) {
      const inPour = new Set(); (fills || []).forEach(f => f.links.forEach(l => l.forEach(i => inPour.add(i))));
      board.tracks.forEach((t, ti) => {
        [t.pts[0], t.pts[t.pts.length - 1]].forEach(([x, y], end) => {
          const mine = items.findIndex(it => it.kind === "track" && it.ti === ti && it.k === (end ? t.pts.length - 2 : 0));
          if (inPour.has(mine)) return;
          const touch = items.some(it => !(it.kind === "track" && it.ti === ti) && it.layers.includes(t.layer) && segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y) <= it.r + t.w / 2 + 1e-6);
          if (!touch) out.push({ kind: "dangling", x, y, msg: `A track end on ${t.layer} is not connected` });
        });
      });
      // a via should join copper on both layers (copper, or a pour of its net)
      items.forEach((v, k) => {
        if (v.kind !== "via") return;
        const on = COPPER.filter(L => inPour.has(k) && (fills || []).some(f => f.layer === L && f.links.some(l => l.includes(k))) ||
          items.some(it => it !== v && it.layers.includes(L) && gap(it, v) <= 1e-6));
        if (on.length < 2) out.push({ kind: "dangling", x: v.s[0], y: v.s[1], msg: on.length ? `A via joins copper on ${on[0]} only` : "A via is not connected" });
      });
    }
    valveChecks(board, model, conn, netlist, on, placedOff, onBoard, out);
    if (on("star") && board.rules.ground === "star") starCheck(board, model, conn, fills, netlist, out);
    if (on("pinout")) model.parts.forEach(g => { const m = g.members[0].params.model; if (PINOUT[m] && PINOUT[m][1] === "verify" && g.place) out.push({ kind: "check", x: g.place.x, y: g.place.y, msg: `${g.ref} (${m}): pinouts differ between makers — check the ${g.fp.name} pin order against your part's datasheet` }); });
    return out;
  }
  // ---------------------------------------------------------------------------
  // Teardrops: where a track meets a round pad or a via, copper widens from the track to most of
  // the pad's width over about a pad's length, so the joint survives drilling slop, heat and a
  // heavy part's leverage. One is left out where it would come closer to another net's copper
  // (or a mounting hole) than the clearance. Returns [{ layer, net, ti, pts }] (polygons).
  // ---------------------------------------------------------------------------
  function teardrops(board, conn, CR, model) {
    const out = [], items = conn.items, holes = npHoles(board, model);
    const ends = items.filter(it => (it.kind === "pad" && Math.abs(it.pad.w - it.pad.h) < 1e-6) || it.kind === "via");
    board.tracks.forEach((t, ti) => {
      const tr = items.find(it => it.kind === "track" && it.ti === ti); if (!tr || t.pts.length < 2) return;
      const net = tr.net;
      [0, t.pts.length - 1].forEach(k => {
        const P = t.pts[k], Q = t.pts[k ? k - 1 : 1];
        const at = ends.find(e => e.layers.includes(t.layer) && Math.hypot(e.s[0] - P[0], e.s[1] - P[1]) < 1e-3); if (!at) return;
        const rp = at.r, w = t.w, Ls = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
        const wp = Math.min(2 * rp * 0.8, Math.max(w, 2 * rp - 0.2)), L = Math.min(rp + 2 * rp * 0.9, Ls * 0.7);
        if (wp <= w * 1.15 || L <= rp + 0.3) return;
        const ux = (Q[0] - P[0]) / Ls, uy = (Q[1] - P[1]) / Ls, nx = -uy, ny = ux, d0 = Math.sqrt(Math.max(0, rp * rp - wp * wp / 4));
        const pt = (a, b) => [+(P[0] + ux * a + nx * b).toFixed(4), +(P[1] + uy * a + ny * b).toFixed(4)];
        // the sides: from the pad's edge curving in to the track's edges (a quadratic Bézier each)
        const side = sg => { const res = []; for (let q = 0; q <= 6; q++) { const u = q / 6, a = (1 - u) * (1 - u) * d0 + 2 * u * (1 - u) * (d0 + (L - d0) * 0.35) + u * u * L, b = (1 - u) * (1 - u) * wp / 2 + 2 * u * (1 - u) * w / 2 + u * u * w / 2; res.push(pt(a, sg * b)); } return res; };
        const left = side(1), right = side(-1).reverse(), poly = [pt(0, 0)].concat(left, right);
        // keep the clearance to every other net's copper and to the mounting holes
        const edges = poly.map((a, i) => [a[0], a[1], poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1]]);
        const bad = items.some(it => {
          if (it.net === net && net !== null && net !== "short") return false;
          if (it === at || it === tr || !it.layers.includes(t.layer)) return false;
          const need = CR ? CR.need(net, it.net).c : board.rules.clearance;
          return edges.some(e => segItem(e, it) < need - 1e-6);
        }) || holes.some(h => edges.some(e => segDist(e[0], e[1], e[2], e[3], h.x, h.y) - h.d / 2 < (CR ? CR.toChassis(net).c : board.rules.clearance) - 1e-6));
        if (!bad) out.push({ layer: t.layer, net, ti, pts: poly });
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Star grounding. Every part with a pad on GND belongs to a ground return: Supply (sources,
  // rectifiers, reservoir and filter capacitors, bleeders), Output (power valves, the output
  // transformer's secondary, the speaker), Input (the input jack), or the stage of the small-signal
  // valve it serves (VL1: its cathode resistor and bypass, its grid leak), else Signal. The board
  // part's ground field overrides it. Each return joins its own pads and runs to the star point
  // XG1 alone; copper joining two returns anywhere but there is reported.
  // ---------------------------------------------------------------------------
  const SUPPLY_TYPES = new Set(["vdc", "ptx", "ptx_cat", "mains", "diode", "bridge", "inductor"]), OUTPUT_TYPES = new Set(["opt_se", "opt_cat", "opt_pp", "speaker"]);
  const RETURNS = ["Supply", "Output", "Input", "Signal"];
  function groundGroups(board, model, netlist) {
    const L = root.CadLib, out = { star: null, groupOf: new Map(), byPart: new Map() };
    if (!netlist || !model) return out;
    const gnd = 0, volts = netlist.volts || {}, on = new Map(), refOf = {};
    model.parts.forEach(g => g.members.forEach(m => { refOf[m.id] = g; }));
    (netlist.parts || []).forEach(p => p.pins.forEach(q => { if (q.net === undefined || q.net === null) return; if (!on.has(q.net)) on.set(q.net, []); on.get(q.net).push({ p, pin: q.id }); }));
    const cat = p => { const t = p.type === "tube" && L && L.tubeByName ? L.tubeByName(p.params && p.params.tube) : null; return t ? t.category || "" : ""; };
    const supplyNet = n => { const l = on.get(n) || []; return l.some(e => SUPPLY_TYPES.has(e.p.type) || (e.p.type === "tube" && cat(e.p) === "rectifier")) ||
      (!l.some(e => e.p.type === "tube") && l.some(e => e.p.type === "electrolytic" && e.pin === "+") && Math.abs(volts[n] || 0) >= 60); };
    const stageOf = e => { const c = cat(e.p); return c === "rectifier" ? "Supply" : c === "power" ? "Output" : (refOf[e.p.id] || {}).ref || "Signal"; };
    function classify(g) {
      if (g.type === "star" || g.type === "heater") return null;
      if (SUPPLY_TYPES.has(g.type)) return "Supply";
      if (OUTPUT_TYPES.has(g.type)) return "Output";
      if (g.type === "siggen") return "Input";
      if (g.type === "tube") return stageOf({ p: g.members[0] });
      const start = [...new Set(g.members.flatMap(m => m.pins.map(q => q.net)).filter(n => n !== gnd && n !== undefined && n !== null))];
      if (start.some(supplyNet)) return "Supply";
      // the nearest valve electrode, input or output through resistors and capacitors (not through GND or a rail)
      const seen = new Set(start); let front = start;
      for (let depth = 0; depth < 3 && front.length; depth++) {
        let hit = null; const next = [];
        front.forEach(n => (on.get(n) || []).forEach(e => {
          if (hit) return;
          if (e.p.type === "tube" && PIN_RANK[e.pin] !== undefined) hit = stageOf(e);
          else if (e.p.type === "siggen") hit = "Input";
          else if (OUTPUT_TYPES.has(e.p.type)) hit = "Output";
          else if (["resistor", "capacitor", "electrolytic", "pot"].includes(e.p.type) && !g.members.includes(e.p)) e.p.pins.forEach(q => { if (q.net !== gnd && !seen.has(q.net) && !supplyNet(q.net)) { seen.add(q.net); next.push(q.net); } });
        }));
        if (hit) return hit;
        front = next;
      }
      return "Signal";
    }
    model.parts.forEach(g => {
      const pads = model.pads.filter(p => p.part === g.key && p.net === gnd);
      if (g.type === "star") { out.star = pads[0] || null; return; }
      if (!pads.length) return;
      const auto = classify(g), set = board.parts[g.key] && board.parts[g.key].ground, grp = set || auto || "Signal";
      out.byPart.set(g.key, { group: grp, auto: auto || "Signal", manual: !!set });
      pads.forEach(p => out.groupOf.set(p, grp));
    });
    return out;
  }
  // ground copper that joins two returns away from the star point
  function starCheck(board, model, conn, fills, netlist, out) {
    const gg = groundGroups(board, model, netlist); if (!gg.star) return;
    const items = conn.items, n = items.length, si = model.pads.indexOf(gg.star), par = items.map((_, i) => i);
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    const g0 = items.map((it, i) => i !== si && it.net === 0);
    for (let i = 0; i < n; i++) if (g0[i]) for (let j = i + 1; j < n; j++) {
      if (!g0[j]) continue; const a = items[i], b = items[j];
      if (a.kind === "pad" && b.kind === "pad") continue;
      if (shareLayer(a, b) && gap(a, b) <= 1e-6) par[find(i)] = find(j);
    }
    (fills || []).forEach(f => f.links.forEach(list => { const l = list.filter(i => i < n && g0[i]); l.forEach(i => { par[find(i)] = find(l[0]); }); }));
    const comp = new Map();
    model.pads.forEach((p, i) => { if (!g0[i]) return; const g = gg.groupOf.get(p); if (!g) return; const r = find(i); if (!comp.has(r)) comp.set(r, new Map()); const m = comp.get(r); if (!m.has(g)) m.set(g, p); });
    comp.forEach((m, r) => {
      if (m.size < 2) return;
      const gs = [...m.keys()], at = items.findIndex((it, i) => g0[i] && find(i) === r && it.kind !== "pad"), it = at >= 0 ? items[at] : null, p = m.get(gs[0]);
      out.push({ kind: "star", x: it ? (it.s[0] + it.s[2]) / 2 : p.x, y: it ? (it.s[1] + it.s[3]) / 2 : p.y,
        msg: `Ground returns ${gs.slice(0, -1).join(", ")} and ${gs[gs.length - 1]} share copper away from the star point ${gg.star.ref}: ${gs.includes("Supply") ? "the reservoir's charging pulses" : "one return's current"} then flows through the other's ground and hums; run each return to ${gg.star.ref} on its own` });
    });
  }

  // ---------------------------------------------------------------------------
  // Valve layout checks: what makes a valve board hum, oscillate, cook its capacitors or crack
  //  stopper: a grid stopper far from its grid pin (the track before it picks up and oscillates)
  //  coupling: a grid track running alongside an anode or heater track (feedback, hum)
  //  heat: an electrolytic close to a power valve, a rectifier or a resistor dissipating hotWatts or more
  //  support: a board-mounted valve socket with no mounting hole near it (pulling a valve flexes the board)
  // ---------------------------------------------------------------------------
  // a part that runs hot: a power valve, a rectifier, a resistor dissipating hotWatts or more (from the simulation)
  function hotWhy(g, netlist, R) {
    const L = root.CadLib, volts = (netlist && netlist.volts) || {};
    const t = g.type === "tube" && L && L.tubeByName ? L.tubeByName(g.members[0].params.tube) : null;
    if (t && (/power|rectifier/i.test(t.category || "") || (+t.paMax || 0) >= 5)) return `${g.ref} (${g.members[0].params.tube}) runs hot`;
    if (g.type === "resistor") {
      const V = n => (volts[n] !== undefined ? volts[n] : n === 0 ? 0 : undefined);   // GND is 0 V
      const p = g.members[0], [a, c] = p.pins, va = a && V(a.net), vc = c && V(c.net), i = Math.abs((a && a.i) || (c && c.i) || 0);
      const w = va !== undefined && vc !== undefined ? Math.abs(va - vc) * i : 0;
      if (w >= (R.hotWatts > 0 ? R.hotWatts : 1)) return `${g.ref} dissipates ${w.toFixed(1)} W`;
    }
    return null;
  }
  const GRID_PINS = new Set(["G", "G1"]), ANODE_PINS = new Set(["A", "A1", "A2"]);
  function valveChecks(board, model, conn, netlist, on, placedOff, onBoard, out) {
    const L = root.CadLib, R = board.rules, byId = {}, names = model.names, nm = n => names[n] || String(n);
    if (!netlist || !L) return;
    (netlist.parts || []).forEach(p => { byId[p.id] = p; });
    const role = (pad, set) => pad.pins.some(c => byId[c.comp] && byId[c.comp].type === "tube" && set.has(c.pin));
    const live = model.pads.filter(p => !placedOff.has(p.part)), partOf = {}; model.parts.forEach(g => { partOf[g.key] = g; });
    const gridPads = live.filter(p => p.net !== null && role(p, GRID_PINS)), anodePads = live.filter(p => p.net !== null && role(p, ANODE_PINS));
    const anodeNets = new Map(); anodePads.forEach(p => { if (!anodeNets.has(p.net)) anodeNets.set(p.net, `the anode of ${p.ref} (pin ${p.num})`); });
    // grid stoppers: the grid net holds the grid pin(s) and one resistor, nothing else
    if (on("stopper")) gridPads.forEach(gp => {
      // (the valve's own other pins count too: an anode of the other section direct-coupled to this grid is no stopper)
      const others = model.pads.filter(p => p.net === gp.net && p !== gp && !role(p, GRID_PINS));
      const res = [...new Set(others.map(p => p.part))];
      if (res.length !== 1 || !partOf[res[0]] || partOf[res[0]].type !== "resistor" || isOffboard(partOf[res[0]]) || placedOff.has(res[0]) || isOffboard(partOf[gp.part])) return;
      // (measured past the socket's own body: a pin deep inside a big octal socket is that far from anything outside it)
      const rp = others[0], d = Math.hypot(rp.x - gp.x, rp.y - gp.y), sb = partBox(partOf[gp.part]);
      const inset = Math.max(0, Math.min(gp.x - sb.x1, sb.x2 - gp.x, gp.y - sb.y1, sb.y2 - gp.y)), max = (R.stopperMax || 10) + inset;
      if (d > max + 1e-6) out.push({ kind: "stopper", x: rp.x, y: rp.y, msg: `${rp.ref} is the grid stopper of ${gp.ref} (pin ${gp.num}) but sits ${d.toFixed(0)} mm from it: put it right at the socket (≤ ${R.stopperMax || 10} mm from its edge, ${max.toFixed(0)} mm from the pin), or the track before it can pick up and oscillate` });
    });
    // grid tracks alongside anode or heater tracks
    if (on("coupling")) {
      const victims = new Map(); gridPads.forEach(p => { if (!anodeNets.has(p.net) && names[p.net] !== "GND" && !victims.has(p.net)) victims.set(p.net, `grid of ${p.ref} (pin ${p.num})`); });
      const aggr = new Map(anodeNets); Object.entries(names).forEach(([n, t]) => { if (isHeaterNet(t)) aggr.set(netKey(n), "the heater wiring"); });
      const tr = conn.items.filter(it => it.kind === "track" && it.net !== null && it.net !== "short");
      const vs = tr.filter(it => victims.has(it.net)), as = tr.filter(it => aggr.has(it.net)), lim = R.couplingGap > 0 ? R.couplingGap : 2, acc = new Map();
      vs.forEach(v => {
        const [x1, y1, x2, y2] = v.s, lv = Math.hypot(x2 - x1, y2 - y1); if (lv < 1e-6) return;
        const ux = (x2 - x1) / lv, uy = (y2 - y1) / lv;
        as.forEach(a => {
          if (a.net === v.net) return;
          const [ax1, ay1, ax2, ay2] = a.s, la = Math.hypot(ax2 - ax1, ay2 - ay1); if (la < 1e-6) return;
          if (Math.abs(ux * (ay2 - ay1) - uy * (ax2 - ax1)) / la > 0.26) return;          // more than 15° apart: crossing, not running alongside
          const t1 = (ax1 - x1) * ux + (ay1 - y1) * uy, t2 = (ax2 - x1) * ux + (ay2 - y1) * uy;
          const ov = Math.min(lv, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)); if (ov <= 0) return;
          const d1 = Math.abs((ax1 - x1) * uy - (ay1 - y1) * ux), d2 = Math.abs((ax2 - x1) * uy - (ay2 - y1) * ux), gap = (d1 + d2) / 2 - v.r - a.r;
          if (gap > lim) return;
          const k = v.net + "|" + a.net, r = acc.get(k) || { v: v.net, a: a.net, len: 0, gap: Infinity, x: 0, y: 0, cross: v.layers[0] !== a.layers[0] };
          r.len += ov; if (gap < r.gap) { r.gap = gap; const t = Math.max(0, Math.min(t1, t2)) + ov / 2; r.x = x1 + ux * t; r.y = y1 + uy * t; }
          acc.set(k, r);
        });
      });
      acc.forEach(r => {
        if (r.len < (R.couplingLen > 0 ? R.couplingLen : 10)) return;
        const what = aggr.get(r.a), heater = what === "the heater wiring";
        out.push({ kind: "coupling", x: r.x, y: r.y, msg: `${nm(r.v)} (${victims.get(r.v)}) runs ${r.len.toFixed(0)} mm alongside ${nm(r.a)} (${what})${r.cross ? " on the other side of the board" : ""}, ${Math.max(0, r.gap).toFixed(1)} mm apart: ${heater ? "it will pick up hum" : "the coupling can make the amplifier oscillate"}; move them apart or cross at right angles` });
      });
    }
    // heat: electrolytics near hot parts
    if (on("heat")) {
      const hot = [];
      onBoard.forEach(({ g, b }) => { const why = hotWhy(g, netlist, R); if (why) hot.push({ g, b, why }); });
      const lim = R.heatGap > 0 ? R.heatGap : 10;
      onBoard.filter(({ g }) => g.type === "electrolytic").forEach(({ g, b }) => {
        let worst = null;
        hot.forEach(h => { const dx = Math.max(0, h.b.x1 - b.x2, b.x1 - h.b.x2), dy = Math.max(0, h.b.y1 - b.y2, b.y1 - h.b.y2), d = Math.hypot(dx, dy); if (d < lim && (!worst || d < worst.d)) worst = { d, h }; });
        if (worst) out.push({ kind: "heat", x: g.place.x, y: g.place.y, msg: `${g.ref} (electrolytic) is ${worst.d.toFixed(0)} mm from ${worst.h.g.ref}: ${worst.h.why}, and every 10 °C halves a capacitor's life; keep ≥ ${lim} mm` });
      });
    }
    // socket support
    if (on("support")) onBoard.forEach(({ g }) => {
      if (g.type !== "tube" || !/^SOCKET-/.test(g.fp.name)) return;
      const lim = R.socketHole > 0 ? R.socketHole : 40, d = Math.min(Infinity, ...(board.holes || []).map(h => Math.hypot(h.x - g.place.x, h.y - g.place.y)));
      if (d > lim) out.push({ kind: "support", x: g.place.x, y: g.place.y, msg: `${g.ref}: no mounting hole within ${lim} mm of its socket${isFinite(d) ? ` (the nearest is ${d.toFixed(0)} mm away)` : ""}; pulling a valve flexes the board and cracks joints: add a hole and standoff near it` });
    });
  }
  const fmtA = I => (Math.abs(I) >= 1 ? `${Math.abs(I).toFixed(2)} A` : `${(Math.abs(I) * 1000).toPrecision(3)} mA`);
  /** Each net with its class (manual or automatic), voltage, width and clearance — for the rules window */
  function netTable(board, model, hv, volts) {
    const R = board.rules, nets = [...new Set(model.pads.filter(p => p.net !== null).map(p => p.net))];
    return nets.map(n => { const name = model.names[n] || String(n), c = netClassOf(n, model.names, hv, R), r = classRule(c, R);
      return { net: n, name, cls: c, manual: CLASSES.includes((R.netClass || {})[name]), volts: volts && volts[n] !== undefined ? volts[n] : null, track: r.track, clearance: r.clearance, pads: model.pads.filter(p => p.net === n).length }; })
      .sort((a, b) => Math.abs(b.volts || 0) - Math.abs(a.volts || 0) || a.name.localeCompare(b.name));
  }
  const label = it => (it.kind === "pad" ? `${it.pad.ref}-${it.pad.num}` : it.kind === "via" ? "via" : it.kind === "hole" ? "plated hole" : `track (${it.layers[0]})`);
  function nearest(a, b) {
    let best = null;
    const tryP = (px, py, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2)) : 0, qx = s[0] + t * dx, qy = s[1] + t * dy, d = Math.hypot(px - qx, py - qy); if (!best || d < best.d) best = { d, x: (px + qx) / 2, y: (py + qy) / 2 }; };
    tryP(a[0], a[1], b); tryP(a[2], a[3], b); tryP(b[0], b[1], a); tryP(b[2], b[3], a);
    return [best.x, best.y];
  }

  /** Place the given parts on the board where they sit in the schematic: the schematic's extent is
      mapped onto the board (3 mm in from the edges), so the signal runs across the board as it runs
      across the sheet. Big parts go first; each takes the free spot nearest its target (1 mm
      between courtyards, clear of the parts already on the board). Without schematic positions,
      rows by reference. Returns how many did not fit. */
  function arrange(board, mdl, keys, netlist) {
    const want = new Set(keys), o = board.outline, m = 3, gapM = 1, heat = board.rules.heatGap > 0 ? board.rules.heatGap : 10;
    // electrolytics keep the heat check's distance from hot parts from the start
    const kind = g => (g.type === "electrolytic" ? "cap" : hotWhy(g, netlist, board.rules) ? "hot" : "");
    const posOf = g => { const ms = g.members.filter(x => Number.isFinite(x.x) && Number.isFinite(x.y)); return ms.length ? [ms.reduce((s, x) => s + x.x, 0) / ms.length, ms.reduce((s, x) => s + x.y, 0) / ms.length] : null; };
    const sel = mdl.parts.filter(p => want.has(p.key) && p.fp);
    if (!sel.some(posOf)) return arrangeRows(board, mdl, keys);
    const rel = g => { const bp = board.parts[g.key], pts = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[3]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[1]]].map(q => place(q, { ...bp, x: 0, y: 0 }));
      return { x1: Math.min(...pts.map(q => q[0])), y1: Math.min(...pts.map(q => q[1])), x2: Math.max(...pts.map(q => q[0])), y2: Math.max(...pts.map(q => q[1])) }; };
    // the schematic's extent, from every part that has a place there
    const all = mdl.parts.map(posOf).filter(Boolean), X = all.map(p => p[0]), Y = all.map(p => p[1]);
    const sx1 = Math.min(...X), sx2 = Math.max(...X), sy1 = Math.min(...Y), sy2 = Math.max(...Y);
    const map = ([x, y]) => [m + (sx2 > sx1 ? (x - sx1) / (sx2 - sx1) : 0.5) * (o.w - 2 * m), m + (sy2 > sy1 ? (y - sy1) / (sy2 - sy1) : 0.5) * (o.h - 2 * m)];
    const taken = mdl.parts.filter(g => !want.has(g.key) && g.place && g.fp && g.place.x >= 0 && g.place.x <= o.w && g.place.y >= 0 && g.place.y <= o.h).map(g => ({ ...partBox(g), k: kind(g) }));
    const free = (b, k) => b.x1 >= 0.5 && b.y1 >= 0.5 && b.x2 <= o.w - 0.5 && b.y2 <= o.h - 0.5 && !taken.some(t => {
      const gp = (k === "cap" && t.k === "hot") || (k === "hot" && t.k === "cap") ? heat + 0.5 : gapM;
      return b.x1 < t.x2 + gp && b.x2 > t.x1 - gp && b.y1 < t.y2 + gp && b.y2 > t.y1 - gp;
    });
    const area = g => { const r = rel(g); return (r.x2 - r.x1) * (r.y2 - r.y1); };
    let left = 0;
    sel.sort((a, b) => area(b) - area(a) || a.ref.localeCompare(b.ref, undefined, { numeric: true })).forEach(g => {
      // the board's own parts (heater supply, star point) have no place in the schematic: top left
      const k = kind(g), r = rel(g), P = posOf(g), [tx, ty] = P ? map(P) : [m + (r.x2 - r.x1) / 2, m + (r.y2 - r.y1) / 2], cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2, step = 1.27, rings = Math.ceil(Math.max(o.w, o.h) / step);
      let spot = null;
      for (let ring = 0; ring <= rings && !spot; ring++) {
        // the ring steps out from the target, nearest first
        const cand = [];
        for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) if (Math.max(Math.abs(i), Math.abs(j)) === ring) cand.push([i, j]);
        cand.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
        for (const [i, j] of cand) {
          const x = snap(tx - cx + i * step, 1.27), y = snap(ty - cy + j * step, 1.27), b = { x1: x + r.x1, y1: y + r.y1, x2: x + r.x2, y2: y + r.y2 };
          if (free(b, k)) { spot = { x, y, b }; break; }
        }
      }
      if (!spot) { left++; return; }
      board.parts[g.key].x = spot.x; board.parts[g.key].y = spot.y; taken.push({ ...spot.b, k });
    });
    return left;
  }
  /** Rows inside the outline (a starting point for placement, not an optimiser): left to right by
      reference, a 3 mm gap, the next row when one is full */
  function arrangeRows(board, mdl, keys) {
    const want = new Set(keys), g = 3, o = board.outline;
    let x = g, y = g, rowH = 0, left = 0;
    mdl.parts.filter(p => want.has(p.key) && p.fp).forEach(p => {
      const bp = board.parts[p.key], pts = [[p.fp.box[0], p.fp.box[1]], [p.fp.box[2], p.fp.box[3]], [p.fp.box[0], p.fp.box[3]], [p.fp.box[2], p.fp.box[1]]].map(q => place(q, { ...bp, x: 0, y: 0 }));
      const bx1 = Math.min(...pts.map(q => q[0])), by1 = Math.min(...pts.map(q => q[1])), w = Math.max(...pts.map(q => q[0])) - bx1, h = Math.max(...pts.map(q => q[1])) - by1;
      if (x + w > o.w - g && x > g) { x = g; y += rowH + g; rowH = 0; }
      if (y + h > o.h - g) { left++; return; }
      bp.x = snap(x - bx1, 1.27); bp.y = snap(y - by1, 1.27);
      x += w + g; rowH = Math.max(rowH, h);
    });
    return left;          // parts that did not fit
  }

  /** Nets that carry high voltage (the DC level of the node above the limit in the simulation) */
  function hvNets(netVolts, limit) {
    const s = new Set(); Object.entries(netVolts || {}).forEach(([n, v]) => { if (Math.abs(v) > (limit || 60)) s.add(isNaN(+n) ? n : +n); }); return s;
  }
  const netKey = n => (isNaN(+n) ? n : +n);

  // ---------------------------------------------------------------------------
  // Heaters and internal shields. The schematic draws a valve's anode, grids and cathode only;
  // on the board its heater pins need copper too. withHeaters gives every indirectly heated valve
  // heater pins on heater nets, one pair per heater voltage (HTR6.3_A / HTR6.3_B), fed from a
  // heater-supply connector (XH1…) that carries the sum of the currents; a heater joined to its
  // cathode (GZ34, 6Ts13P) gets its own winding from its own connector. Internal shields (pin "S")
  // go to GND. Directly heated valves are left alone: their filament is the cathode.
  // ---------------------------------------------------------------------------
  function withHeaters(netlist, R) {
    const L = root.CadLib;
    if (!netlist || !L || !L.tubeByName) return netlist;
    const heaters = !R || R.heaters !== false, shields = !R || R.shields !== false, series = !!(R && R.heater126), star = !!(R && R.ground === "star");
    if (!heaters && !shields && !star) return netlist;
    const parts = (netlist.parts || []).map(p => ({ ...p, pins: p.pins.slice() })), volts = { ...(netlist.volts || {}) }, names = { ...(netlist.names || {}) };
    const groups = new Map(), done = new Set(), hasGnd = names[0] === "GND";
    const fmtV = v => String(+(+v).toFixed(2));
    const group = (key, name, v, a, b) => { if (!groups.has(key)) groups.set(key, { key, name, v, a, b, i: 0, tubes: [], hv: 0 }); return groups.get(key); };
    parts.forEach(p => {
      if (p.type !== "tube") return;
      const lab = String(p.label || "").trim(), dot = lab.lastIndexOf("."), base = dot > 0 ? lab.slice(0, dot) : lab, id = base || p.id;
      if (done.has(id)) return; done.add(id);
      const t = L.tubeByName(p.params && p.params.tube); if (!t || !t.pinout) return;
      const po = t.pinout, pins = f => po.filter(f).map(q => String(q.pin));
      if (shields && hasGnd) { const s = pins(q => q.sym === "S"); if (s.length) p.pins.push({ id: "S", name: "internal shield", net: 0, pads: s.join(",") }); }
      if (!heaters || t.directlyHeated) return;
      const hp = po.filter(q => q.isHeater && !q.isCathode), tie = po.filter(q => q.isHeater && q.isCathode);
      const vh = +t.vh || 6.3, ih = +t.ih || 0, raise = Math.abs(+(p.params || {}).heaterV || 0) ? +(p.params || {}).heaterV : 0;
      let g, ia = [], ib = [], I = ih, links = null;
      if (tie.length) {
        // the heater returns through the cathode: a winding of its own at the cathode's potential
        const k = (p.pins.find(q => q.id === "K") || {}).net;
        if (k === undefined || !hp.length) return;
        g = group("t:" + id, `HTR-${id}`, vh, "h:" + id + ":a", k);
        ia = hp.map(q => String(q.pin));
      } else if (hp.some(q => q.sym === "CT")) {
        // 12AX7 family: pins 4 and 5 joined against 9 for 6.3 V, or 4 to 5 for 12.6 V
        const h1 = pins(q => q.sym === "H1"), h2 = pins(q => q.sym === "H2"), ct = pins(q => q.sym === "CT");
        if (series) { ia = h1; ib = h2; I = ih; } else { ia = h1.concat(h2); ib = ct; I = 2 * ih; }
      } else if (hp.length === 4) {
        // a heater in two halves (6S33S: 1-2 and 6-7): in parallel at half the voltage, or in series with a link
        const h = hp.map(q => String(q.pin));
        if (series) { ia = [h[0]]; ib = [h[3]]; links = [h[1], h[2]]; I = ih; } else { ia = [h[0], h[2]]; ib = [h[1], h[3]]; I = 2 * ih; }
      } else if (hp.length >= 2) { ia = [String(hp[0].pin)]; ib = hp.slice(1).map(q => String(q.pin)); }
      else return;
      if (!g) {
        const v = (hp.some(q => q.sym === "CT") || hp.length === 4) ? (series ? vh : vh / 2) : vh, k = fmtV(v) + (raise ? "@" + raise : "");
        g = group("v:" + k, `HTR${fmtV(v)}${raise ? "_" + Math.round(raise) + "V" : ""}`, v, `h:${k}:a`, `h:${k}:b`);
      }
      g.i += I; g.tubes.push(id); if (raise) g.hv = raise;
      p.pins.push({ id: "HA", name: "heater", net: g.a, i: I, pads: ia.join(",") });
      if (ib.length) p.pins.push({ id: "HB", name: "heater", net: g.b, i: I, pads: ib.join(",") });
      if (links) { const n = "h:link:" + id; names[n] = `HTR-${id}-LINK`; p.pins.push({ id: "HL", name: "heater link", net: n, i: I, pads: links.join(",") }); }
    });
    // the shared supplies are numbered first (XH1 stays the 6.3 V one), the windings of their own after
    let k = 0;
    [...groups.values()].sort((a, b) => (typeof a.b !== "string") - (typeof b.b !== "string")).forEach(g => {
      const own = typeof g.b !== "string";      // the cathode net is the schematic's
      names[g.a] = own ? g.name : g.name + "_A"; if (!own) names[g.b] = g.name + "_B";
      const v = own ? (volts[g.b] !== undefined ? volts[g.b] : 0) : g.hv;
      volts[g.a] = v; if (!own) volts[g.b] = v;
      const I = +g.i.toPrecision(4);
      parts.push({ id: "heater:" + g.key, type: "heater", label: `XH${++k}`, params: { v: g.v, i: I, tubes: g.tubes },
        pins: [{ id: "1", name: "~", net: g.a, i: I }, { id: "2", name: "~", net: g.b, i: I }] });
    });
    // star grounding: every ground return meets at one terminal, XG1
    if (star && hasGnd) parts.push({ id: "star:gnd", type: "star", label: "XG1", params: {}, pins: [{ id: "1", name: "GND", net: 0 }] });
    const ranges = netlist.ranges ? { ...netlist.ranges } : undefined;
    return { ...netlist, parts, names, volts, ranges };
  }
  const isHeaterNet = name => /^HTR/.test(name || "");

  // ---------------------------------------------------------------------------
  // Clearance by voltage: IPC-2221B table 6-1 (mm) between two conductors, by the largest
  // voltage between them. Columns: up to 15, 30, 50, 100, 150, 170, 250, 300, 500 V, then mm per
  // volt above 500. B2: outer layer, uncoated, up to 3050 m; B4: outer layer under a permanent
  // polymer coating; A6: outer layer of an assembly with conformal coating.
  // ---------------------------------------------------------------------------
  const IPC_V = [15, 30, 50, 100, 150, 170, 250, 300, 500];
  const IPC = {
    B2: [0.1, 0.1, 0.6, 0.6, 0.6, 1.25, 1.25, 1.25, 2.5, 0.005],
    B4: [0.05, 0.05, 0.13, 0.13, 0.4, 0.4, 0.4, 0.4, 0.8, 0.00305],
    A6: [0.13, 0.25, 0.4, 0.5, 0.8, 0.8, 0.8, 0.8, 1.5, 0.00305]
  };
  function ipcClearance(V, table) {
    const t = IPC[table]; if (!t) return 0;
    const a = Math.abs(V || 0);
    for (let k = 0; k < IPC_V.length; k++) if (a <= IPC_V[k]) return t[k];
    return +(t[8] + (a - 500) * t[9]).toFixed(3);
  }
  // The voltage range of every net: the DC level, the swing in the simulation (netlist.ranges, from
  // the CAD's transient), and for an output transformer's anode ends the swing at full drive: an
  // inductive load takes the anode up to about twice its DC level
  const OPT_ENDS = { opt_se: ["P2"], opt_cat: ["P2"], opt_pp: ["P1", "P2", "U1", "U2"] };
  function netRanges(netlist) {
    const out = {}, put = (n, lo, hi, why) => { const r = out[n] || (out[n] = { lo: Infinity, hi: -Infinity, why: "" }); if (lo < r.lo) r.lo = lo; if (hi > r.hi) { r.hi = hi; if (why) r.why = why; } };
    if (!netlist) return out;
    Object.entries(netlist.volts || {}).forEach(([n, v]) => put(netKey(n), v, v));
    Object.entries(netlist.ranges || {}).forEach(([n, r]) => { if (Array.isArray(r)) put(netKey(n), r[0], r[1], "signal"); });
    (netlist.parts || []).forEach(p => (OPT_ENDS[p.type] || []).forEach(id => {
      const q = p.pins.find(x => x.id === id), v = q && (netlist.volts || {})[q.net];
      if (v > 0) put(q.net, 0, 2 * v, "inductive");
    }));
    out[0] = out[0] || { lo: 0, hi: 0, why: "" };
    return out;
  }
  /** The clearance two nets need: the larger of their classes' clearances and, with a voltage
      table chosen, IPC-2221B for the largest voltage between them. Returns { c, v, ipc } */
  function clearanceRules(board, model, hv, netlist) {
    const R = board.rules, names = (model && model.names) || {}, ranges = netRanges(netlist), table = R.ipc === undefined ? "B2" : R.ipc;
    const cls = n => (n === null || n === undefined || n === "short" ? "Signal" : netClassOf(n, names, hv, R));
    const span = n => (n === null || n === undefined || n === "short" ? null : ranges[n] || null);
    const between = (a, b) => {
      const ra = span(a), rb = span(b);
      if (!ra && !rb) return 0;
      const A = ra || { lo: 0, hi: 0 }, Bq = rb || { lo: 0, hi: 0 };
      if (a === b) return 0;
      return Math.max(Math.abs(A.hi - Bq.lo), Math.abs(Bq.hi - A.lo));
    };
    const memo = new Map();
    function need(a, b) {
      const k = a + "|" + b; if (memo.has(k)) return memo.get(k);
      const base = Math.max(classRule(cls(a), R).clearance, classRule(cls(b), R).clearance), v = between(a, b), ic = table && table !== "off" ? ipcClearance(v, table) : 0;
      const r = { c: Math.max(base, ic), v, ipc: ic > base + 1e-9, why: (span(a) || {}).why || (span(b) || {}).why || "" };
      memo.set(k, r); memo.set(b + "|" + a, r); return r;
    }
    // a mounting hole: its screw, standoff and the chassis are at 0 V
    const toChassis = n => need(n, 0);
    return { need, toChassis, ranges, table };
  }

  root.BoardCore = { segBox, segItem, itemGap: gap, canStand, axialStand, mountedName, partFootprint, socketPads, underSocket, holeRing, npHoles, padCapsule, hotWhy, boxPoly, FPDATA: { BRIDGE_PINS, FUSES, AXIAL, BOX, ECAP_AXIAL, SNAPIN, POTS, SOCKETS, EI, XF, CHIPS, SMD_DIODES, SMD_ECAP, TABBED }, currentWidth, netCurrents, fmtA, partBox, partSilk, segInPoly, polyHitsPoly, koLayers, entryGap, anchoredOk, RES, GLYPHS, strokeText, fillZones, zonePoly, outlinePoly, rasterise, pip, flashOf, segSeg, teardrops, groundGroups, RETURNS, migrateNetNames, withHeaters, isHeaterNet, ipcClearance, IPC, netRanges, clearanceRules, DOC_VERSION, LAYERS, COPPER, SOCKETS, PINOUT, newBoard, normaliseBoard, defaultRules, CLASSES, netClassOf, classRule, netTable, edgeDist, cornerHoles, arrange, footprint, fpOptions, applyPartNumbers, smdOptions, isSmd, onSide, physicalParts, padMap, sync, place, model, connectivity, drc, hvNets, segDist, isOffboard };
})(typeof window !== "undefined" ? window : globalThis);
