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
      stackup: { layers: 2, thickness: 1.6, copper: 35 },   // mm, µm
      rules: defaultRules(),
      parts: {},            // key -> { ref, fp, x, y, rot, side }   key: the schematic part ids, joined by "+"
      tracks: [],           // { layer, w, pts: [[x, y], ...] }
      vias: [],             // { x, y, drill, pad }
      holes: [],            // mounting holes (not plated): { x, y, d }
      texts: []             // { x, y, text, size, layer: "F.SilkS" | "B.SilkS" | "F.Cu" | "B.Cu", rot }
    };
  }
  // Design rules for valve circuits: generous widths and clearances, more for high voltage.
  // Net classes: every net is Signal, Power or HV — automatically (HV above hvVolts in the
  // simulation, GND is Power) unless netClass names a class for it.
  function defaultRules() {
    return {
      track: 1.0, power: 2.0, minTrack: 0.4,                       // widths, mm
      clearance: 0.6, hvClearance: 2.0, hvVolts: 60, edgeClearance: 0.5,
      viaDrill: 0.8, viaPad: 1.8, minDrill: 0.6, minAnnular: 0.3,
      netClass: {},                                               // net name -> "Signal" | "Power" | "HV"
      checks: { clearance: true, short: true, edge: true, unplaced: true, annular: true, drill: true, width: true, class: true, pinout: true }
    };
  }
  const CLASSES = ["Signal", "Power", "HV"];
  function netClassOf(net, names, hv, R) {
    const m = R.netClass && R.netClass[names[net]];
    if (CLASSES.includes(m)) return m;
    if (hv && hv.has(net)) return "HV";
    return names[net] === "GND" ? "Power" : "Signal";
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
      rules: { ...d.rules, ...(b.rules || {}), netClass: { ...((b.rules || {}).netClass || {}) }, checks: { ...d.rules.checks, ...((b.rules || {}).checks || {}) } },
      holes: Array.isArray(b.holes) ? b.holes : [],
      texts: Array.isArray(b.texts) ? b.texts : [],
      parts: b.parts && typeof b.parts === "object" ? b.parts : {},
      tracks: Array.isArray(b.tracks) ? b.tracks.filter(t => t && Array.isArray(t.pts) && t.pts.length >= 2 && COPPER.includes(t.layer)) : [],
      vias: Array.isArray(b.vias) ? b.vias : []
    };
  }

  // ---------------------------------------------------------------------------
  // Footprints. A footprint: { name, title, pads: [{ num, name, x, y, shape, w, h, drill }],
  // silk: [{ t: "line"|"rect"|"circle", ... }], box: [x1, y1, x2, y2] (courtyard) }
  // Through-hole only: valve amplifiers are built that way, and every pad is on both layers.
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
  const fp = (name, title, pads, silk) => ({ name, title, pads, silk, box: bbox(pads, silk, 0.5) });

  // axial: resistors, diodes, small chokes. pitch: lead spacing; body length and diameter
  const AXIAL = { 7.62: [3.6, 1.8], 10.16: [6.3, 2.5], 12.7: [9, 3.2], 15.24: [11, 4.5], 20.32: [15, 5.5], 25.4: [18, 6.5], 30.48: [22, 8], 40.64: [34, 10], 50.8: [45, 12] };
  function axial(pitch, diode) {
    const [L, D] = AXIAL[pitch], h = pitch / 2, big = pitch >= 20, d = big ? 2.2 : 1.8, dr = big ? 1.1 : 0.85;
    const silk = [{ t: "rect", x: -L / 2, y: -D / 2, w: L, h: D }, { t: "line", x1: -h + d / 2 + 0.3, y1: 0, x2: -L / 2, y2: 0 }, { t: "line", x1: L / 2, y1: 0, x2: h - d / 2 - 0.3, y2: 0 }];
    if (diode) silk.push({ t: "line", x1: -L / 2 + 0.8, y1: -D / 2, x2: -L / 2 + 0.8, y2: D / 2 });   // band at the cathode (pad 1)
    return fp(`${diode ? "DIODE" : "AXIAL"}-${pitch}`, `Axial, ${pitch} mm lead spacing${diode ? " (band at pad 1, the cathode)" : ""}`,
      [pad(1, -h, 0, d, dr, diode ? "rect" : "circle", diode ? "K" : "1"), pad(2, h, 0, d, dr, "circle", diode ? "A" : "2")], silk);
  }
  // film capacitors: a box, metric lead spacing
  const BOX = { 5: [7.2, 3.5], 7.5: [10, 4.5], 10: [13, 5], 15: [18, 7], 22.5: [26.5, 9], 27.5: [31.5, 11] };
  function box(pitch) {
    const [L, W] = BOX[pitch], h = pitch / 2;
    return fp(`BOX-${pitch}`, `Film capacitor, ${pitch} mm lead spacing`, [pad(1, -h, 0, 1.8, 0.9), pad(2, h, 0, 1.8, 0.9)], [{ t: "rect", x: -L / 2, y: -W / 2, w: L, h: W }]);
  }
  // electrolytics: radial, diameter / lead spacing; pad 1 (square) is +
  const RADIAL = [[5, 2], [6.3, 2.5], [8, 3.5], [10, 5], [12.5, 5], [16, 7.5], [18, 7.5], [22, 10], [25, 10], [30, 10], [35, 10]];
  function radial(D, P) {
    const big = D >= 22, d = big ? 2.6 : 1.8, dr = big ? 1.4 : 0.9;
    return fp(`RADIAL-D${D}-P${P}`, `Electrolytic, Ø${D} mm, ${P} mm lead spacing (+ at the square pad)`,
      [pad(1, -P / 2, 0, d, dr, "rect", "+"), pad(2, P / 2, 0, d, dr, "circle", "-")],
      [{ t: "circle", x: 0, y: 0, r: D / 2 }, { t: "line", x1: -D / 2 - 1.2, y1: -D / 2, x2: -D / 2 - 1.2, y2: -D / 2 + 2 }, { t: "line", x1: -D / 2 - 2.2, y1: -D / 2 + 1, x2: -D / 2 - 0.2, y2: -D / 2 + 1 }]);
  }
  // transistors: the order is the pins from pad 1 (e.g. "EBC"), as printed in the maker's drawing
  function to92(order) {
    return fp(`TO-92-${order}`, `TO-92, pins ${order.split("").join("-")}`, [...order].map((n, i) => pad(i + 1, (i - 1) * 1.27, 0, 1.4, 0.75, i ? "circle" : "rect", n)),
      [{ t: "line", x1: -2.4, y1: 1.6, x2: 2.4, y2: 1.6 }, { t: "circle", x: 0, y: 0, r: 2.5, from: 200, to: 340 }]);
  }
  function to18(order) {   // pins on a 2.54 mm circle, tab next to pin 1
    const pos = [[-1.27, 0], [0, -1.27], [1.27, 0]];
    return fp(`TO-18-${order}`, `TO-18 metal can, pins ${order.split("").join("-")}`, [...order].map((n, i) => pad(i + 1, pos[i][0], pos[i][1], 1.3, 0.7, i ? "circle" : "rect", n)),
      [{ t: "circle", x: 0, y: 0, r: 2.8 }, { t: "line", x1: -2.4, y1: 1.5, x2: -3.2, y2: 2.3 }]);
  }
  function inline(pkg, pitch, order, L, W, tab) {
    const n = order.length, x0 = -(n - 1) / 2 * pitch, silk = [{ t: "rect", x: -L / 2, y: -W / 2, w: L, h: W }];
    if (tab) silk.push({ t: "line", x1: -L / 2, y1: -W / 2 + 1.2, x2: L / 2, y2: -W / 2 + 1.2 });
    return fp(`${pkg}-${order}`, `${pkg}, pins ${order.split("").join("-")} (tab at the top)`, [...order].map((c, i) => pad(i + 1, x0 + i * pitch, 0, 2, 1.05, i ? "circle" : "rect", c)), silk);
  }
  const to126 = order => inline("TO-126", 2.29, order, 8, 3.2, false);
  const to220 = order => inline("TO-220", 2.54, order, 10.4, 4.6, true);
  function led5() {
    return fp("LED-5MM", "LED 5 mm (flat side and square pad: cathode)", [pad(1, -1.27, 0, 1.8, 0.9, "rect", "K"), pad(2, 1.27, 0, 1.8, 0.9, "circle", "A")],
      [{ t: "circle", x: 0, y: 0, r: 2.9 }, { t: "line", x1: -2.9, y1: -1.6, x2: -2.9, y2: 1.6 }]);
  }
  function pot16() {
    return fp("POT-16MM", "Potentiometer 16 mm, board mount (1 · wiper · 2)", [pad(1, -5, 0, 2.2, 1.2, "rect", "1"), pad(2, 0, 0, 2.2, 1.2, "circle", "W"), pad(3, 5, 0, 2.2, 1.2, "circle", "2")],
      [{ t: "rect", x: -8, y: -17, w: 16, h: 15 }, { t: "circle", x: 0, y: -9.5, r: 3.5 }]);
  }
  // Tube sockets, top (component) side. Viewed from below, the pins run clockwise from the
  // gap or key; seen from above that is counter-clockwise, so pin k sits at 90° − k·step
  // (screen angles, y down: 90° points down at the gap).
  const SOCKETS = {
    "B9A": { title: "Noval (B9A)", n: 9, dia: 11.89, step: 36, offset: 0, body: 22, drill: 1.3, padD: 2.4 },
    "B7G": { title: "Miniature 7-pin (B7G)", n: 7, dia: 9.53, step: 45, offset: 0, body: 18, drill: 1.2, padD: 2.2 },
    "B9D": { title: "Magnoval (B9D)", n: 9, dia: 17.45, step: 36, offset: 0, body: 30, drill: 1.6, padD: 2.8 },
    "OCTAL": { title: "Octal (K8A)", n: 8, dia: 17.45, step: 45, offset: -0.5, body: 34, drill: 2.0, padD: 3.4 },
    "UX4": { title: "UX4 4-pin", n: 4, dia: 22.2, step: 90, offset: -0.5, body: 38, drill: 3.4, padD: 5 }
  };
  function socket(kind, nPins) {
    const s = SOCKETS[kind] || { title: `${nPins}-pin socket`, n: nPins, dia: 15, step: 360 / (nPins + 1), offset: 0, body: 26, drill: 1.3, padD: 2.4 };
    const pads = [];
    for (let k = 1; k <= s.n; k++) {
      const a = (90 - (k + s.offset) * s.step) * Math.PI / 180;
      pads.push(pad(k, +(s.dia / 2 * Math.cos(a)).toFixed(3), +(s.dia / 2 * Math.sin(a)).toFixed(3), s.padD, s.drill, k === 1 ? "rect" : "circle"));
    }
    const silk = [{ t: "circle", x: 0, y: 0, r: s.body / 2 }, { t: "circle", x: 0, y: 0, r: s.dia / 2 - s.padD }];
    silk.push({ t: "line", x1: 0, y1: s.body / 2 - 2.5, x2: 0, y2: s.body / 2 + 0.5 });   // the gap / key, down
    return fp(SOCKETS[kind] ? `SOCKET-${kind}` : `SOCKET-${nPins}`, `Tube socket, ${s.title}, top view`, pads, silk);
  }
  // wires to a chassis-mounted part (transformer, choke, speaker, pot, jack, mains, supply)
  function wirePads(names) {
    const n = names.length, x0 = -(n - 1) / 2 * 5.08;
    return fp(`WIRE-${n}`, `${n} wire pad${n > 1 ? "s" : ""} to a chassis-mounted part`, names.map((nm, i) => pad(i + 1, x0 + i * 5.08, 0, 2.8, 1.3, i ? "circle" : "rect", nm)),
      [{ t: "rect", x: x0 - 2.3, y: -2.3, w: (n - 1) * 5.08 + 4.6, h: 4.6 }]);
  }

  /** A footprint by name ("AXIAL-10.16", "TO-92-EBC", "SOCKET-B9A", "WIRE-3" …) */
  function footprint(name, pinNames) {
    let m;
    if ((m = /^AXIAL-([\d.]+)$/.exec(name)) && AXIAL[m[1]]) return axial(+m[1], false);
    if ((m = /^DIODE-([\d.]+)$/.exec(name)) && AXIAL[m[1]]) return axial(+m[1], true);
    if ((m = /^BOX-([\d.]+)$/.exec(name)) && BOX[m[1]]) return box(+m[1]);
    if ((m = /^RADIAL-D([\d.]+)-P([\d.]+)$/.exec(name))) return radial(+m[1], +m[2]);
    if ((m = /^TO-92-([A-Z]{3})$/.exec(name))) return to92(m[1]);
    if ((m = /^TO-18-([A-Z]{3})$/.exec(name))) return to18(m[1]);
    if ((m = /^TO-126-([A-Z]{3})$/.exec(name))) return to126(m[1]);
    if ((m = /^TO-220-([A-Z]{3})$/.exec(name))) return to220(m[1]);
    if (name === "LED-5MM") return led5();
    if (name === "POT-16MM") return pot16();
    if ((m = /^SOCKET-([A-Z0-9]+)$/.exec(name))) return /^\d+$/.test(m[1]) ? socket(null, +m[1]) : socket(m[1]);
    if ((m = /^WIRE-(\d+)$/.exec(name))) return wirePads(pinNames && pinNames.length === +m[1] ? pinNames : Array.from({ length: +m[1] }, (_, i) => String(i + 1)));
    return null;
  }

  // Pin order of each transistor package, pad 1 first, from the maker's drawing. Parts marked
  // "verify" have pinouts that differ between makers: check the datasheet of the part you buy.
  const PINOUT = {
    "2N2222A": ["EBC"], "2N3904": ["EBC"], "BC107": ["EBC"], "BC547B": ["CBE"], "BD139": ["ECB"], "MPSA42": ["EBC"], "MJE340": ["ECB"],
    "2N2907A": ["EBC"], "2N3906": ["EBC"], "BC177": ["EBC"], "BC557B": ["CBE"], "BD140": ["ECB"], "MPSA92": ["EBC"], "MJE350": ["ECB"],
    "2N7000": ["SGD"], "BS170": ["DGS"], "BS250": ["DGS", "verify"], "LND150": ["SGD", "verify"], "DN2540": ["GDS"],
    "IRF510": ["GDS"], "IRF540": ["GDS"], "IRF820": ["GDS"], "IRF840": ["GDS"], "IRF9540": ["GDS"], "IRF9610": ["GDS"], "IRF9640": ["GDS"]
  };
  const AXIAL_FOR_WATTS = { "": 10.16, "0.125": 7.62, "0.25": 10.16, "0.5": 12.7, "1": 15.24, "2": 20.32, "3": 25.4, "5": 30.48, "10": 40.64, "20": 50.8 };
  const radialFor = c => { const u = c * 1e6; return u <= 4.7 ? [5, 2] : u <= 10 ? [6.3, 2.5] : u <= 47 ? [8, 3.5] : u <= 100 ? [10, 5] : u <= 220 ? [12.5, 5] : u <= 470 ? [16, 7.5] : u <= 1000 ? [18, 7.5] : [22, 10]; };
  const boxFor = c => (c <= 10e-9 ? 7.5 : c <= 100e-9 ? 10 : c <= 470e-9 ? 15 : 22.5);
  function socketFor(tube) {
    const s = (tube && tube.socket) || "";
    if (/Noval/i.test(s)) return "SOCKET-B9A";
    if (/B7G|Miniature/i.test(s)) return "SOCKET-B7G";
    if (/Magnoval|B9D/i.test(s)) return "SOCKET-B9D";
    if (/Octal|K8A/i.test(s)) return "SOCKET-OCTAL";
    if (/UX4/i.test(s)) return "SOCKET-UX4";
    return `SOCKET-${(tube && tube.pinCount) || 9}`;
  }

  // ---------------------------------------------------------------------------
  // From the schematic to physical parts. The CAD sends { parts: [{ id, type, label, params,
  // pins: [{ id, net }] }], names: { net: "GND" | connector name } }. Sections of one part
  // (VL1.1 / VL1.2, SA1.1 / SA1.2) are one physical part with one footprint.
  // ---------------------------------------------------------------------------
  const SKIP = new Set(["frame", "note", "ground", "offsheet", "scope"]);
  const OFFBOARD = new Set(["inductor", "switch", "speaker", "opt_se", "opt_cat", "opt_pp", "ptx", "ptx_cat", "mains", "vdc", "siggen"]);
  function physicalParts(netlist) {
    const L = root.CadLib, groups = new Map();
    (netlist.parts || []).forEach(p => {
      if (SKIP.has(p.type) || !L.LIB[p.type]) return;
      const lab = String(p.label || "").trim(), i = lab.lastIndexOf("."), base = i > 0 ? lab.slice(0, i) : lab;
      const k = base ? p.type + "|" + base : p.id;
      if (!groups.has(k)) groups.set(k, { ref: base || "?", type: p.type, members: [] });
      groups.get(k).members.push(p);
    });
    return [...groups.values()].map(g => {
      g.members.sort((a, b) => String(a.label).localeCompare(String(b.label), undefined, { numeric: true }));
      g.key = g.members.map(m => m.id).sort().join("+");
      const first = g.members[0], def = L.LIB[g.type];
      g.value = def.value ? def.value({ params: first.params, label: first.label }) : "";
      g.options = fpOptions(g);
      g.defaultFp = g.options[0];
      return g;
    }).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  }
  // footprints that fit a part, the default first
  function fpOptions(g) {
    const L = root.CadLib, p = g.members[0].params, t = g.type, wires = g.members.reduce((s, m) => s + m.pins.length, 0);
    const axials = Object.keys(AXIAL).map(k => "AXIAL-" + k);
    switch (t) {
      case "resistor": { const d = "AXIAL-" + (AXIAL_FOR_WATTS[String(p.w || "")] || 10.16); return [d, ...axials.filter(a => a !== d), "WIRE-2"]; }
      case "pot": return ["POT-16MM", "WIRE-3"];
      case "capacitor": { const d = "BOX-" + boxFor(p.c); return [d, ...Object.keys(BOX).map(k => "BOX-" + k).filter(a => a !== d), "WIRE-2"]; }
      case "electrolytic": { const [D, P] = radialFor(p.c), d = `RADIAL-D${D}-P${P}`; return [d, ...RADIAL.map(([a, b]) => `RADIAL-D${a}-P${b}`).filter(a => a !== d), "WIRE-2"]; }
      case "diode": { const d = p.model === "1N4148" ? "DIODE-7.62" : "DIODE-10.16"; return [d, ...["DIODE-7.62", "DIODE-10.16", "DIODE-15.24"].filter(a => a !== d)]; }
      case "zener": { const z = L.ZENERS[p.model] || {}, d = z.p >= 5 ? "DIODE-15.24" : "DIODE-10.16"; return [d, ...["DIODE-7.62", "DIODE-10.16", "DIODE-15.24"].filter(a => a !== d)]; }
      case "led": return ["LED-5MM", "WIRE-2"];
      case "npn": case "pnp": case "nmos": case "pmos": {
        const m = (t === "npn" || t === "pnp" ? L.BJTS : L.MOSFETS)[p.model] || {}, order = (PINOUT[p.model] || [t[1] === "m" ? "GDS" : "EBC"])[0];
        const pkg = /TO-220/.test(m.pkg) ? "TO-220" : /TO-126/.test(m.pkg) ? "TO-126" : /TO-18/.test(m.pkg) ? "TO-18" : "TO-92";
        const all = ["TO-92", "TO-18", "TO-126", "TO-220"].map(k => `${k}-${order}`);
        return [`${pkg}-${order}`, ...all.filter(a => a !== `${pkg}-${order}`), "WIRE-3"];
      }
      case "tube": { const d = socketFor(L.tubeByName(p.tube)); return [d, ...["SOCKET-B9A", "SOCKET-B7G", "SOCKET-B9D", "SOCKET-OCTAL", "SOCKET-UX4"].filter(a => a !== d), `WIRE-${wires}`]; }
      default: return [`WIRE-${wires}`];
    }
  }
  const isOffboard = g => OFFBOARD.has(g.type);
  // which schematic pins land on each pad: Map padNum -> [{ comp, pin }]
  function padMap(g, f) {
    const L = root.CadLib, map = new Map(), add = (num, comp, pin) => { num = String(num); if (!map.has(num)) map.set(num, []); map.get(num).push({ comp, pin }); };
    const one = g.members[0];
    if (/^WIRE-/.test(f.name)) { let k = 1; g.members.forEach(m => m.pins.forEach(p => add(k++, m.id, p.id))); return map; }
    if (g.type === "tube") {
      // pin numbers from the tube's pinout; a dual tube's sections each bring their own
      g.members.forEach(m => {
        const nums = L.LIB.tube.pinNumbers({ params: m.params, label: m.label });
        m.pins.forEach(p => String(nums[p.id] || "").split(",").filter(Boolean).forEach(n => add(n.trim(), m.id, p.id)));
      });
      return map;
    }
    const byName = {};
    f.pads.forEach(p => { byName[p.name] = p.num; });
    const SEM = { resistor: { 1: "1", 2: "2" }, capacitor: { 1: "1", 2: "2" }, electrolytic: { "+": "1", "-": "2" }, inductor: { 1: "1", 2: "2" },
      diode: { K: "1", A: "2" }, zener: { K: "1", A: "2" }, led: { K: "1", A: "2" }, pot: { 1: "1", W: "2", 2: "3" } };
    one.pins.forEach(p => {
      const num = SEM[g.type] ? SEM[g.type][p.id] : byName[p.id];
      if (num) add(num, one.id, p.id);
    });
    return map;
  }

  // net names: a sheet connector's name, GND, else Net-(REF-pad) from the lowest pad on it
  function netNames(netlist, parts, padsByPart) {
    const names = {};
    Object.entries(netlist.names || {}).forEach(([n, nm]) => { names[n] = nm; });
    parts.forEach(g => (padsByPart.get(g.key) || []).forEach(p => {
      if (p.net === null || names[p.net]) return;
      names[p.net] = `Net-(${g.ref}-${p.num})`;
    }));
    return names;
  }

  // ---------------------------------------------------------------------------
  // Synchronise the board with the schematic: new parts go to a staging row below the
  // outline, parts gone from the schematic leave the board; positions are kept by part key
  // ---------------------------------------------------------------------------
  function sync(board, netlist) {
    const parts = physicalParts(netlist), keys = new Set(parts.map(g => g.key)), added = [], removed = [];
    Object.keys(board.parts).forEach(k => { if (!keys.has(k)) { removed.push(board.parts[k].ref); delete board.parts[k]; } });
    let x = 8, y = board.outline.h + 18, rowH = 0;
    parts.forEach(g => {
      const old = board.parts[g.key];
      if (old) { old.ref = g.ref; if (!g.options.includes(old.fp)) old.fp = g.defaultFp; return; }
      const f = footprint(g.defaultFp, g.members.flatMap(m => m.pins.map(p => (g.members.length > 1 ? m.label.split(".").pop() + "." : "") + p.id)));
      const w = f.box[2] - f.box[0], h = f.box[3] - f.box[1];
      if (x + w > Math.max(board.outline.w, 160)) { x = 8; y += rowH + 6; rowH = 0; }
      board.parts[g.key] = { ref: g.ref, fp: g.defaultFp, x: snap(x - f.box[0], 1.27), y: snap(y - f.box[1], 1.27), rot: 0, side: "F" };
      x += w + 6; rowH = Math.max(rowH, h);
      added.push(g.ref);
    });
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

  /** Everything the editor needs about a board against a netlist: physical parts with
      their footprints, pads in board coordinates with nets, net names */
  function model(board, netlist) {
    const parts = physicalParts(netlist), pads = [], padsByPart = new Map(), netOf = {};
    (netlist.parts || []).forEach(p => p.pins.forEach(q => { netOf[p.id + ":" + q.id] = q.net; }));
    parts.forEach(g => {
      const bp = board.parts[g.key]; if (!bp) return;
      const pinNames = g.members.flatMap(m => m.pins.map(p => (g.members.length > 1 ? m.label.split(".").pop() + "." : "") + p.id));
      const f = footprint(bp.fp, pinNames) || footprint(g.defaultFp, pinNames);
      g.fp = f; g.place = bp;
      const map = padMap(g, f), list = [];
      f.pads.forEach(p => {
        const conns = map.get(p.num) || [], nets = [...new Set(conns.map(c => netOf[c.comp + ":" + c.pin]).filter(n => n !== undefined))];
        const [x, y] = place([p.x, p.y], bp), [w, h] = placeSize(p, bp);
        const P = { part: g.key, ref: g.ref, num: p.num, name: p.name, x, y, w, h, shape: p.shape, drill: p.drill, net: nets.length ? nets[0] : null, pins: conns, conflict: nets.length > 1 };
        list.push(P); pads.push(P);
      });
      padsByPart.set(g.key, list);
    });
    const names = netNames(netlist, parts, padsByPart);
    pads.forEach(p => { p.netName = p.net === null ? "" : names[p.net] || ("N" + p.net); });
    return { parts, pads, names };
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
  function copperItems(board, pads) {
    const items = [];
    pads.forEach((p, i) => { const c = padCapsule(p); items.push({ kind: "pad", i, layers: COPPER, s: c.s, r: c.r, pad: p }); });
    board.tracks.forEach((t, ti) => { for (let k = 0; k + 1 < t.pts.length; k++) items.push({ kind: "track", ti, k, layers: [t.layer], s: [t.pts[k][0], t.pts[k][1], t.pts[k + 1][0], t.pts[k + 1][1]], r: t.w / 2 }); });
    board.vias.forEach((v, vi) => items.push({ kind: "via", vi, layers: COPPER, s: [v.x, v.y, v.x, v.y], r: (v.pad || board.rules.viaPad) / 2 }));
    return items;
  }
  const shareLayer = (a, b) => a.layers.some(l => b.layers.includes(l));
  const gap = (a, b) => segSeg(a.s, b.s) - a.r - b.r;

  /** Copper connectivity: which items touch (union-find), what each cluster's nets are, the
      ratsnest (shortest links still missing per net), unrouted count and shorts */
  function connectivity(board, pads) {
    const items = copperItems(board, pads), n = items.length, par = items.map((_, i) => i);
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = items[i], b = items[j];
      if (a.kind === "pad" && b.kind === "pad") continue;          // pads only join through copper
      if (shareLayer(a, b) && gap(a, b) <= 1e-6) par[find(i)] = find(j);
    }
    const cl = new Map();   // root -> { nets:Set, pads:[] }
    items.forEach((it, i) => { const r = find(i); if (!cl.has(r)) cl.set(r, { nets: new Set(), pads: [], items: [] }); const c = cl.get(r); c.items.push(it); if (it.kind === "pad") { c.pads.push(it.pad); if (it.pad.net !== null) c.nets.add(it.pad.net); } });
    items.forEach((it, i) => { it.cluster = find(i); it.net = cl.get(it.cluster).nets.size === 1 ? [...cl.get(it.cluster).nets][0] : (cl.get(it.cluster).nets.size ? "short" : null); });
    // ratsnest: per net, join its clusters with the shortest pad-to-pad links (Prim over clusters)
    const byNet = new Map();
    pads.forEach((p, i) => { if (p.net === null) return; if (!byNet.has(p.net)) byNet.set(p.net, new Map()); const r = items[i].cluster, m = byNet.get(p.net); if (!m.has(r)) m.set(r, []); m.get(r).push(p); });
    const rats = []; let unrouted = 0;
    byNet.forEach((groups, net) => {
      const gs = [...groups.values()]; if (gs.length < 2) return;
      unrouted += gs.length - 1;
      const inTree = [gs[0]], rest = gs.slice(1);
      while (rest.length) {
        let best = null;
        inTree.forEach(a => rest.forEach((b, bi) => a.forEach(p => b.forEach(q => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (!best || d < best.d) best = { d, p, q, bi }; }))));
        rats.push({ net, x1: best.p.x, y1: best.p.y, x2: best.q.x, y2: best.q.y });
        inTree.push(rest[best.bi]); rest.splice(best.bi, 1);
      }
    });
    const shorts = [...cl.values()].filter(c => c.nets.size > 1).map(c => [...c.nets]);
    return { items, clusters: cl, rats, unrouted, shorts };
  }

  /** Design-rule check. Kinds: clearance (copper of different nodes closer than their net
      classes allow; holes against copper), short, edge (copper or parts over or too near the
      outline), unplaced, annular (ring around a hole too thin), drill (hole below the minimum),
      width (track below the minimum), class (track narrower than its net class), pinout
      (footprints whose pin order differs between makers). rules.checks turns kinds off. */
  function drc(board, model, conn, hvNets) {
    const out = [], R = board.rules, on = k => !R.checks || R.checks[k] !== false, items = conn.items, hv = hvNets || new Set(), o = board.outline;
    const cls = net => (net === null || net === "short" ? "Signal" : netClassOf(net, model.names, hv, R));
    if (on("clearance")) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.cluster === b.cluster || !shareLayer(a, b)) continue;
      if (a.kind === "pad" && b.kind === "pad" && a.pad.part === b.pad.part) continue;   // within a footprint: the maker's spacing
      const ca = cls(a.net), cb = cls(b.net), need = Math.max(classRule(ca, R).clearance, classRule(cb, R).clearance), g = gap(a, b);
      if (g < need - 1e-6) {
        const [x, y] = nearest(a.s, b.s), hvx = ca === "HV" || cb === "HV";
        out.push({ kind: "clearance", x, y, msg: `Clearance ${Math.max(0, g).toFixed(2)} mm < ${need} mm${hvx ? " (high voltage)" : ""}`, between: [label(a), label(b)] });
      }
    }
    // mounting holes against copper
    if (on("clearance")) (board.holes || []).forEach(hl => items.forEach(it => {
      const g = segDist(it.s[0], it.s[1], it.s[2], it.s[3], hl.x, hl.y) - it.r - hl.d / 2, need = classRule(cls(it.net), R).clearance;
      if (g < need - 1e-6) out.push({ kind: "clearance", x: hl.x, y: hl.y, msg: `Clearance ${Math.max(0, g).toFixed(2)} mm < ${need} mm to a mounting hole`, between: [label(it), "hole"] });
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
      if (worst < R.edgeClearance - 1e-6) out.push({ kind: "edge", x: wx, y: wy, msg: worst < 0 ? `A ${label(it)} runs outside the board outline` : `A ${label(it)} is ${worst.toFixed(2)} mm from the board edge (< ${R.edgeClearance} mm)` });
    });
    // holes and rings
    if (on("drill") || on("annular")) {
      const seen = new Set();
      model.pads.forEach(p => {
        if (placedOff.has(p.part)) return;
        const k = p.part + p.num, ring = (Math.min(p.w, p.h) - p.drill) / 2;
        if (on("drill") && p.drill < R.minDrill - 1e-6 && !seen.has("d" + p.part)) { seen.add("d" + p.part); out.push({ kind: "drill", x: p.x, y: p.y, msg: `${p.ref}: drill ${p.drill} mm < ${R.minDrill} mm` }); }
        if (on("annular") && ring < R.minAnnular - 1e-6 && !seen.has("a" + k)) { seen.add("a" + k); out.push({ kind: "annular", x: p.x, y: p.y, msg: `${p.ref}-${p.num}: annular ring ${ring.toFixed(2)} mm < ${R.minAnnular} mm` }); }
      });
      board.vias.forEach(v => {
        const d = v.drill || R.viaDrill, pd = v.pad || R.viaPad;
        if (on("drill") && d < R.minDrill - 1e-6) out.push({ kind: "drill", x: v.x, y: v.y, msg: `Via drill ${d} mm < ${R.minDrill} mm` });
        if (on("annular") && (pd - d) / 2 < R.minAnnular - 1e-6) out.push({ kind: "annular", x: v.x, y: v.y, msg: `Via annular ring ${((pd - d) / 2).toFixed(2)} mm < ${R.minAnnular} mm` });
      });
    }
    // track widths: the minimum, and the width of the net's class
    if (on("width") || on("class")) board.tracks.forEach((t, ti) => {
      const it = items.find(x => x.kind === "track" && x.ti === ti), p = t.pts[0];
      if (on("width") && t.w < R.minTrack - 1e-6) out.push({ kind: "width", x: p[0], y: p[1], msg: `Track ${t.w} mm narrower than the minimum ${R.minTrack} mm` });
      else if (on("class") && it && it.net !== null && it.net !== "short") {
        const c = cls(it.net), want = classRule(c, R).track;
        if (t.w < want - 1e-6) out.push({ kind: "class", x: p[0], y: p[1], msg: `Track on ${model.names[it.net] || it.net} (${c}) is ${t.w} mm; the class asks ${want} mm` });
      }
    });
    if (on("pinout")) model.parts.forEach(g => { const m = g.members[0].params.model; if (PINOUT[m] && PINOUT[m][1] === "verify" && g.place) out.push({ kind: "check", x: g.place.x, y: g.place.y, msg: `${g.ref} (${m}): pinouts differ between makers — check the ${g.fp.name} pin order against your part's datasheet` }); });
    return out;
  }
  /** Each net with its class (manual or automatic), voltage, width and clearance — for the rules window */
  function netTable(board, model, hv, volts) {
    const R = board.rules, nets = [...new Set(model.pads.filter(p => p.net !== null).map(p => p.net))];
    return nets.map(n => { const name = model.names[n] || String(n), c = netClassOf(n, model.names, hv, R), r = classRule(c, R);
      return { net: n, name, cls: c, manual: CLASSES.includes((R.netClass || {})[name]), volts: volts && volts[n] !== undefined ? volts[n] : null, track: r.track, clearance: r.clearance, pads: model.pads.filter(p => p.net === n).length }; })
      .sort((a, b) => Math.abs(b.volts || 0) - Math.abs(a.volts || 0) || a.name.localeCompare(b.name));
  }
  const label = it => (it.kind === "pad" ? `${it.pad.ref}-${it.pad.num}` : it.kind === "via" ? "via" : `track (${it.layers[0]})`);
  function nearest(a, b) {
    let best = null;
    const tryP = (px, py, s) => { const dx = s[2] - s[0], dy = s[3] - s[1], l2 = dx * dx + dy * dy, t = l2 ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / l2)) : 0, qx = s[0] + t * dx, qy = s[1] + t * dy, d = Math.hypot(px - qx, py - qy); if (!best || d < best.d) best = { d, x: (px + qx) / 2, y: (py + qy) / 2 }; };
    tryP(a[0], a[1], b); tryP(a[2], a[3], b); tryP(b[0], b[1], a); tryP(b[2], b[3], a);
    return [best.x, best.y];
  }

  /** Pack the given parts in rows inside the outline (a starting point for placement, not an
      optimiser): left to right by reference, a 3 mm gap, the next row when one is full */
  function arrange(board, mdl, keys) {
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

  root.BoardCore = { DOC_VERSION, LAYERS, COPPER, SOCKETS, PINOUT, newBoard, normaliseBoard, defaultRules, CLASSES, netClassOf, classRule, netTable, edgeDist, cornerHoles, arrange, footprint, fpOptions, physicalParts, padMap, sync, place, model, connectivity, drc, hvNets, segDist, isOffboard };
})(typeof window !== "undefined" ? window : globalThis);
