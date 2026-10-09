/* =============================================================================
   CAD COMPONENT LIBRARY
   Geometry (pins on a 10 px grid), schematic symbols, inspector fields and the
   mapping of each part to solver elements (see sim-engine.js).
   Depends on: tube-db.js (TUBE_DATABASE), sim-engine.js (TubeSimEngine)
   ============================================================================= */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Engineering-notation helpers: "4.7k" <-> 4700
  // ---------------------------------------------------------------------------
  const SI = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, meg: 1e6, G: 1e9 };
  function parseEng(text) {
    if (typeof text === "number") return text;
    const s = String(text).trim().replace(",", ".").replace(/\s+/g, "");
    const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)(meg|[pnuµmkKMG])?/i);
    if (!m) return NaN;
    let v = parseFloat(m[1]);
    if (m[2]) {
      const key = m[2].toLowerCase() === "meg" ? "meg" : (m[2] === "M" ? "M" : (m[2] === "m" ? "m" : m[2]));
      v *= SI[key] !== undefined ? SI[key] : SI[key.toLowerCase()];
    }
    return v;
  }
  function fmtEng(v, unit, digits) {
    if (v === undefined || v === null || !isFinite(v)) return "—";
    if (Math.abs(v) < 1e-9) v = 0;   // solver round-off (e.g. 4e-16 V) reads as zero
    const a = Math.abs(v);
    const steps = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
    if (a === 0) return "0" + (unit || "");
    for (const [f, p] of steps) {
      if (a >= f * 0.9995) {
        const n = v / f;
        const d = digits !== undefined ? digits : (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
        return parseFloat(n.toFixed(d)) + p + (unit || "");
      }
    }
    return v.toExponential(2) + (unit || "");
  }

  // ---------------------------------------------------------------------------
  // Tube catalog from the shared database
  // ---------------------------------------------------------------------------
  function tubeByName(name) {
    return (root.TUBE_DATABASE || []).find(t => t.commonName === name) || null;
  }
  function tubeKind(t) {
    if (!t) return "triode";
    if (t.category === "rectifier") return "rectifier";
    return t.koren.Pentode ? "pentode" : "triode";
  }

  // ---------------------------------------------------------------------------
  // Real power transformers: Hammond 300 series, from each part's drawing
  // (hammfg.com/files/parts/pdf/<model>.pdf). All have two 120 V primaries
  // tapped at 100 / 110 / 120 V, a centre-tapped HV winding with a 50 V bias
  // tap, and heater windings (listed, not simulated).
  //   [rated V per HV half under load, rated mA, no-load V across the whole HV
  //    winding and from the centre tap to the bias tap (120 V on one primary,
  //    60 Hz), max excitation mA at 120 V 60 Hz, DCR of the two primaries and of
  //    the whole HV winding (Ω, 20 °C), heaters]
  // ---------------------------------------------------------------------------
  const HAMMOND = {
    "369AX": [125, 115, 270.4, 50.06, 80, 19.45, 21.36, 86.39, "6.3 V CT 2 A"],
    "369BX": [150, 86, 322.6, 50.06, 80, 19.45, 21.36, 129.9, "6.3 V CT 2 A"],
    "369EX": [190, 75, 417.7, 50.06, 80, 19.45, 21.36, 264.5, "6.3 V CT 2.5 A"],
    "369JX": [250, 69, 549.7, 50.06, 80, 19.45, 21.36, 353.4, "6.3 V CT 2.5 A"],
    "370AX": [240, 58, 520.1, 50.06, 80, 19.45, 21.36, 333.2, "6.3 V CT 2.5 A"],
    "370BX": [275, 58, 601.4, 49.96, 71, 18.26, 19.62, 434.8, "5 V CT 2 A, 6.3 V CT 2 A"],
    "370CX": [275, 75, 608.8, 50.0, 77, 14.39, 15.81, 361.3, "6.3 V CT 0.6 A, 6.3 V CT 2.5 A"],
    "370DX": [275, 104, 605.3, 50.02, 85, 11.97, 12.94, 232.8, "5 V CT 2 A, 6.3 V CT 3 A"],
    "370EX": [275, 144, 595.2, 50.06, 236.4, 5.843, 6.294, 138.1, "5 V CT 3 A, 6.3 V CT 4 A"],
    "370FX": [275, 173, 586.3, 50.13, 132, 4.541, 4.902, 106.0, "5 V CT 3 A, 6.3 V CT 5 A"],
    "370HX": [275, 230, 581.8, 51.84, 221, 3.075, 3.328, 71.2, "5 V CT 3 A, 6.3 V CT 6 A"],
    "370JX": [250, 161, 520.6, 52.44, 208, 3.124, 3.382, 64.46, "5 V CT 3 A, 6.3 V CT 6 A"],
    "370KX": [250, 322, 528.0, 52.8, 232, 2.501, 2.726, 42.43, "5 V CT 6 A, 6.3 V CT 6 A"],
    "370LX": [275, 460, 574.1, 52.35, 387, 1.118, 1.247, 26.81, "5 V CT 6 A, 6.3 V CT 9 A"],
    "372BX": [300, 115, 646.3, 50.12, 128.4, 7.915, 8.652, 208.8, "5 V CT 2 A, 6.3 V CT 3 A"],
    "372DX": [300, 144, 648.0, 50.06, 236.4, 5.843, 6.294, 121.4, "5 V CT 3 A, 6.3 V CT 4 A"],
    "372FX": [300, 173, 641.0, 50.13, 132, 4.541, 4.902, 116.4, "5 V CT 3 A, 6.3 V CT 5 A"],
    "372HX": [300, 230, 650.8, 50.0, 253.2, 3.652, 3.968, 77.16, "5 V CT 3 A, 6.3 V CT 6 A"],
    "372JX": [300, 288, 629.2, 52.17, 86.4, 1.957, 2.141, 49.74, "5 V CT 4 A, 6.3 V CT 8 A"],
    "373BX": [350, 201, 740.6, 52.19, 150, 3.687, 4.007, 89.1, "5 V CT 3 A, 6.3 V CT 5 A"],
    "373DX": [350, 104, 760.5, 50.03, 151.2, 7.533, 8.099, 229.7, "5 V CT 2 A, 6.3 V CT 3 A"],
    "373EX": [325, 345, 679.5, 52.6, 294, 1.505, 1.66, 42.11, "5 V CT 6 A, 6.3 V CT 9 A"],
    "373FX": [325, 460, 676.7, 52.46, 400, 1.05, 1.137, 28.6, "5 V CT 6 A, 6.3 V CT 9 A"],
    "374AX": [360, 138, 775.2, 50.06, 236.4, 5.843, 6.294, 146.5, "5 V CT 3 A, 6.3 V CT 3.5 A"],
    "374BX": [375, 201, 794.7, 53.34, 160, 3.8, 4.2, 104.0, "5 V CT 3 A, 6.3 V CT 6 A"]
  };
  // Real single-ended output transformers: Hammond 125SE "universal" series, from
  // each part's drawing (hammfg.com/files/parts/pdf/<model>.pdf). One primary
  // (BRN B+, BLU anode) and a secondary BLK (0) with taps ORG / GRN / YEL / WHT:
  // the tap sets the turns ratio, so the reflected impedance follows the load
  // (e.g. GRN: 8 Ω -> 10 kΩ, 4 Ω -> 5 kΩ).
  //   [rated W, max DC mA, primary DCR Ω, primary inductance H (1 kHz, 1 V),
  //    secondary DCR mΩ BLK–ORG, –GRN, –YEL, –WHT]
  const HAMMOND_SE = {
    "125ASE": [3, 25, 242, 5.0, 272, 366, 500, 700],
    "125BSE": [5, 45, 354, 4.5, 300, 400, 570, 798],
    "125CSE": [8, 60, 200, 9.28, 232, 312, 428, 595],
    "125DSE": [10, 70, 126.5, 4.48, 238, 315, 438, 600],
    "125ESE": [15, 80, 103, 5.43, 167, 225, 297, 412],
    "125FSE": [20, 90, 105, 6.41, 141, 186, 251, 342],
    "125GSE": [25, 100, 53.2, 8.23, 127, 165, 217, 294]
  };
  // turns ratio of each tap: the load (Ω) it is rated for on the 10 kΩ primary
  const SE_TAPS = { ORG: 4, GRN: 8, YEL: 16, WHT: 32 };
  const OUTPUT_TX = {};
  Object.entries(HAMMOND_SE).forEach(([k, [w, ma, rp, lp, ...rs]]) => {
    OUTPUT_TX[k] = { name: "Hammond " + k, w, ma, rp, lp, rs: { ORG: rs[0] / 1000, GRN: rs[1] / 1000, YEL: rs[2] / 1000, WHT: rs[3] / 1000 } };
  });
  const POWER_TX = {};
  Object.entries(HAMMOND).forEach(([k, [v, ma, nlv, nlvBias, iex, rp1, rp2, rhv, heaters]]) => {
    POWER_TX[k] = { name: "Hammond " + k, rated: `${v}-0-${v} V ${ma} mA`, nlv: nlv / 2, nlvBias, vRef: 120, iex: iex / 1000, rp1, rp2, rHalf: rhv / 2, heaters,
      taps: [100, 110, 120, 200, 220, 230, 240] };
  });
  // The transformer for a primary tap: two 120 V windings in series on a
  // 200-240 V tap (both at tap/2), in parallel on 100-120 V. Winding "turns" are
  // volts at no load: tap volts on the primary give nlv on each HV half.
  // Magnetizing inductance from the maximum excitation current (a lower bound).
  function powerTx(model, tap) {
    const m = POWER_TX[model] || POWER_TX["373BX"], t = +tap || 230, series = t > 150;
    const f = (series ? t / 2 : t) / m.vRef;                      // fraction of each 120 V winding in use
    const rPri = series ? (m.rp1 + m.rp2) * f : (m.rp1 * f * m.rp2 * f) / (m.rp1 * f + m.rp2 * f);
    const l120 = m.vRef / (2 * Math.PI * 60 * m.iex);             // one full 120 V winding
    const lPri = l120 * Math.pow(series ? 2 * f : f, 2);
    return { m, tap: t, series, rPri, lPri, nlv: m.nlv, nlvBias: m.nlvBias, rHalf: m.rHalf };
  }

  // ---------------------------------------------------------------------------
  // Drawing sheet (IEC 61082-1: ISO 5457 frame with a reference grid, ISO 7200
  // title block). 4 drawing units per millimetre; landscape sheets.
  // ---------------------------------------------------------------------------
  const MM = 4;
  const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
  function sheetGeom(c) {
    const [lw, lh] = SHEETS[c.params.size] || SHEETS.A2, portrait = c.params.orient === "portrait";
    const wmm = portrait ? lh : lw, hmm = portrait ? lw : lh;
    const W = wmm * MM, H = hmm * MM, L = 20 * MM, M = 10 * MM;            // filing margin left, 10 mm elsewhere
    const fx1 = L, fy1 = M, fx2 = W - M, fy2 = H - M;                        // drawing frame
    const cols = Math.max(2, Math.round((fx2 - fx1) / (50 * MM))), rows = Math.max(2, Math.round((fy2 - fy1) / (50 * MM)));
    const tbW = Math.min(180 * MM, fx2 - fx1), tbH = 36 * MM;                // title block, max 180 mm wide
    return { W, H, fx1, fy1, fx2, fy2, cols, rows, tb: { x1: fx2 - tbW, y1: fy2 - tbH, x2: fx2, y2: fy2 } };
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers (local coordinates, already rotated by the caller)
  // ---------------------------------------------------------------------------
  const COL = { body: "#58a6ff", bodySel: "#00e5ff", tube: "#e6edf3", hot: "#ff7b72", text: "#e6edf3", value: "#79c0ff", fill: "#0d1420" };
  function line(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke(); }

  // filled arrowhead with its tip at (x, y), pointing along (dx, dy)
  function arrowHead(ctx, x, y, dx, dy, len, half) {
    const l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - ux * len - uy * half, y - uy * len + ux * half); ctx.lineTo(x - ux * len + uy * half, y - uy * len - ux * half); ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle; ctx.fill();
  }
  // IEC 60617 S00687 / S00688 transistor with envelope: base bar, collector and emitter at
  // an angle, the emitter arrow pointing out (NPN) or in (PNP)
  function drawBjt(ctx, c, pol) {
    ctx.beginPath(); ctx.arc(3, 0, 19, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
    line(ctx, [-30, 0, -8, 0]);
    ctx.lineWidth = 3; line(ctx, [-8, -11, -8, 11]); ctx.lineWidth = 2;
    line(ctx, [-8, -5, 10, -15, 10, -30]);
    line(ctx, [-8, 5, 10, 15, 10, 30]);
    if (pol > 0) arrowHead(ctx, 8, 13.9, 18, 10, 7, 3.5);
    else arrowHead(ctx, -5, 6.7, -18, -10, 7, 3.5);
  }
  // IEC 60617 S00706-S00709 insulated-gate FET with envelope: gate lead on the source side,
  // channel broken (enhancement) or solid (depletion), substrate arrow in (N) or out (P), tied to the source
  function drawMos(ctx, c, pol) {
    const m = MOSFETS[c.params.model] || {}, depletion = pol > 0 ? m.vto < 0 : m.vto > 0;
    ctx.beginPath(); ctx.arc(3, 0, 19, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
    line(ctx, [-30, 10, -11, 10]); line(ctx, [-11, -10, -11, 10]);
    ctx.lineWidth = 2.5;
    if (depletion) line(ctx, [-5, -12, -5, 12]);
    else { line(ctx, [-5, -12, -5, -6]); line(ctx, [-5, -3, -5, 3]); line(ctx, [-5, 6, -5, 12]); }
    ctx.lineWidth = 2;
    line(ctx, [-5, -9, 10, -9, 10, -30]);
    line(ctx, [-5, 9, 10, 9, 10, 30]);
    line(ctx, [-5, 0, 10, 0, 10, 9]);
    if (pol > 0) arrowHead(ctx, -4, 0, -1, 0, 7, 3.5); else arrowHead(ctx, 9, 0, 1, 0, 7, 3.5);
  }

  const DRAW = {
    resistor(ctx, c) {
      line(ctx, [-30, 0, -15, 0]); line(ctx, [15, 0, 30, 0]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-15, -6, 30, 12); ctx.strokeRect(-15, -6, 30, 12);
      // rated power marked inside the body (ГОСТ 2.728-74): 0.125 W //, 0.25 W /, 0.5 W —,
      // 1 W |, 2 W ||, above that the watts in Roman numerals (III, V, X, XX)
      const w = +c.params.w, X = x => { line(ctx, [x - 3, -4, x + 3, 4]); line(ctx, [x - 3, 4, x + 3, -4]); };
      if (!w) return;
      ctx.save(); ctx.lineWidth = 1.4;
      if (w === 0.125) { line(ctx, [-6, 4, -2, -4]); line(ctx, [2, 4, 6, -4]); }
      else if (w === 0.25) line(ctx, [-2, 4, 2, -4]);
      else if (w === 0.5) line(ctx, [-8, 0, 8, 0]);
      else if (w === 1) line(ctx, [0, -4, 0, 4]);
      else if (w === 2) { line(ctx, [-3, -4, -3, 4]); line(ctx, [3, -4, 3, 4]); }
      else if (w === 3) { line(ctx, [-5, -4, -5, 4]); line(ctx, [0, -4, 0, 4]); line(ctx, [5, -4, 5, 4]); }
      else if (w === 5) line(ctx, [-4, -4, 0, 4, 4, -4]);
      else if (w === 10) X(0);
      else if (w === 20) { X(-4); X(4); }
      ctx.restore();
    },
    pot(ctx, c) {
      line(ctx, [-30, 0, -15, 0]); line(ctx, [15, 0, 30, 0]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-15, -6, 30, 12); ctx.strokeRect(-15, -6, 30, 12);
      const wx = -15 + 30 * (c.params.pos !== undefined ? c.params.pos : 0.5);
      line(ctx, [0, -20, 0, -14, wx, -14, wx, -7]);
      ctx.beginPath(); ctx.moveTo(wx - 3, -11); ctx.lineTo(wx, -7); ctx.lineTo(wx + 3, -11); ctx.stroke();
    },
    capacitor(ctx) {
      line(ctx, [-20, 0, -4, 0]); line(ctx, [4, 0, 20, 0]);
      ctx.lineWidth = 2.5; line(ctx, [-4, -11, -4, 11]); line(ctx, [4, -11, 4, 11]);
    },
    electrolytic(ctx) {
      // IEC 60617 S00571 polarized capacitor: two plates, "+" at the positive one
      line(ctx, [-20, 0, -4, 0]); line(ctx, [4, 0, 20, 0]);
      ctx.lineWidth = 2.5; line(ctx, [-4, -11, -4, 11]); line(ctx, [4, -11, 4, 11]);
      ctx.lineWidth = 1.2; line(ctx, [-14, -10, -8, -10]); line(ctx, [-11, -13, -11, -7]);
    },
    inductor(ctx) {
      line(ctx, [-30, 0, -20, 0]); line(ctx, [20, 0, 30, 0]);
      // IEC 60617 S00585 inductor with magnetic core: one line parallel to the winding
      ctx.beginPath(); for (let i = 0; i < 4; i++) ctx.arc(-15 + i * 10, 0, 5, Math.PI, 0); ctx.stroke();
      line(ctx, [-20, -9, 20, -9]);
    },
    speaker(ctx) {
      line(ctx, [0, -20, 0, -8, -4, -8]); line(ctx, [0, 20, 0, 8, -4, 8]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-4, -8, 8, 16); ctx.strokeRect(-4, -8, 8, 16);
      ctx.beginPath(); ctx.moveTo(4, -8); ctx.lineTo(14, -16); ctx.lineTo(14, 16); ctx.lineTo(4, 8); ctx.stroke();
    },
    diode(ctx) {
      line(ctx, [-20, 0, -7, 0]); line(ctx, [7, 0, 20, 0]);
      ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, 0); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
      line(ctx, [7, -8, 7, 8]);
    },
    zener(ctx) {
      DRAW.diode(ctx);
      // IEC 60617 S00661 breakdown diode: the cathode bar bent at its ends
      line(ctx, [3, -11, 7, -8]); line(ctx, [7, 8, 11, 11]);
    },
    led(ctx) {
      DRAW.diode(ctx);
      // IEC 60617 S00641 light-emitting diode: two arrows pointing away
      ctx.lineWidth = 1.3;
      [[0, -9], [7, -7]].forEach(([x, y]) => {
        line(ctx, [x, y, x + 7, y - 9]);
        ctx.beginPath(); ctx.moveTo(x + 7, y - 9); ctx.lineTo(x + 2.6, y - 7.2); ctx.lineTo(x + 6, y - 4.6); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      });
    },
    npn(ctx, c) { drawBjt(ctx, c, 1); },
    pnp(ctx, c) { drawBjt(ctx, c, -1); },
    nmos(ctx, c) { drawMos(ctx, c, 1); },
    pmos(ctx, c) { drawMos(ctx, c, -1); },
    switch(ctx, c) {
      // IEC 60617 change-over contact: common on the left, fixed contacts A (top)
      // and B (bottom) as line ends with a seat; the blade rests on the closed one
      line(ctx, [-30, 0, -12, 0]); line(ctx, [8, -10, 30, -10]); line(ctx, [8, 10, 30, 10]);
      line(ctx, [8, -10, 8, -6]); line(ctx, [8, 10, 8, 6]);
      line(ctx, [-12, 0, 8, c.params.pos === "B" ? 6 : -6]);
      ctx.font = "8px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textAlign = "center";
      ctx.fillText("A", 22, -13); ctx.fillText("B", 22, 19);
    },
    note(ctx, c) {
      ctx.fillStyle = c._sel ? COL.bodySel : COL.text; ctx.font = `${+c.params.size || 12}px ui-monospace, monospace`;
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(c.params.text || "", 0, 0);
    },
    frame(ctx, c) {
      const g = sheetGeom(c), p = c.params, z = 5 * MM;                     // reference-grid band 5 mm
      ctx.save();
      ctx.strokeStyle = c._sel ? COL.bodySel : "#8b949e"; ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 0.7; ctx.strokeRect(0, 0, g.W, g.H);                  // trimmed sheet
      ctx.lineWidth = 2.8; ctx.strokeRect(g.fx1, g.fy1, g.fx2 - g.fx1, g.fy2 - g.fy1);   // frame, 0.7 mm
      ctx.lineWidth = 0.7; ctx.strokeRect(g.fx1 + z, g.fy1 + z, g.fx2 - g.fx1 - 2 * z, g.fy2 - g.fy1 - 2 * z);
      ctx.font = `${3.5 * MM}px ui-monospace, monospace`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const cw = (g.fx2 - g.fx1) / g.cols, rh = (g.fy2 - g.fy1) / g.rows;
      for (let i = 0; i < g.cols; i++) {
        const x = g.fx1 + (i + 0.5) * cw;
        if (i) { line(ctx, [g.fx1 + i * cw, g.fy1, g.fx1 + i * cw, g.fy1 + z]); line(ctx, [g.fx1 + i * cw, g.fy2 - z, g.fx1 + i * cw, g.fy2]); }
        ctx.fillText(String(i + 1), x, g.fy1 + z / 2); ctx.fillText(String(i + 1), x, g.fy2 - z / 2);
      }
      for (let j = 0; j < g.rows; j++) {
        const y = g.fy1 + (j + 0.5) * rh, ch = "ABCDEFGHJKLMNPRSTUVWXYZ"[j] || "?";   // I and O are not used
        if (j) { line(ctx, [g.fx1, g.fy1 + j * rh, g.fx1 + z, g.fy1 + j * rh]); line(ctx, [g.fx2 - z, g.fy1 + j * rh, g.fx2, g.fy1 + j * rh]); }
        ctx.fillText(ch, g.fx1 + z / 2, y); ctx.fillText(ch, g.fx2 - z / 2, y);
      }
      // title block (ISO 7200): identification and descriptive fields
      const t = g.tb, X = v => t.x1 + v * MM, Y = v => t.y1 + v * MM;
      ctx.fillStyle = COL.fill; ctx.fillRect(t.x1, t.y1, t.x2 - t.x1, t.y2 - t.y1);
      ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2.8; ctx.strokeRect(t.x1, t.y1, t.x2 - t.x1, t.y2 - t.y1); ctx.lineWidth = 0.7;
      [[0, 9, 180, 9], [0, 18, 180, 18], [0, 27, 110, 27], [110, 0, 110, 36], [145, 18, 145, 36], [55, 27, 55, 36], [70, 0, 70, 18], [145, 0, 145, 9]].forEach(([a, b, c2, d]) => line(ctx, [X(a), Y(b), X(c2), Y(d)]));
      // each field: a small caption and its value, shrunk to fit the field width (w mm)
      const field = (x, y, w, label, val, size) => {
        ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#8b949e"; ctx.font = `${2 * MM}px ui-monospace, monospace`; ctx.fillText(label, X(x + 1), Y(y + 0.8));
        let h = (size || 3.5) * MM; ctx.font = `${h}px ui-monospace, monospace`;
        const tw = ctx.measureText(val || "").width, room = (w - 2) * MM;
        if (tw > room) { h = Math.max(1.6 * MM, h * room / tw); ctx.font = `${h}px ui-monospace, monospace`; }
        ctx.fillStyle = COL.text; ctx.fillText(val || "", X(x + 1), Y(y + 3.4 + ((size || 3.5) - h / MM) / 2));
      };
      field(0, 0, 70, "Responsible department", p.dept); field(70, 0, 40, "Technical reference", p.reference);
      field(110, 0, 35, "Document type", p.doctype); field(145, 0, 35, "Document status", p.status);
      field(0, 9, 70, "Created by", p.creator); field(70, 9, 40, "Approved by", p.approver); field(110, 9, 70, "Legal owner", p.owner);
      field(0, 18, 110, "Title", p.title, 5); field(110, 18, 35, "Identification number", p.docno, 4.2); field(145, 18, 35, "Rev.", p.rev);
      field(0, 27, 55, "Date of issue", p.date); field(55, 27, 55, "Lang.", p.lang); field(110, 27, 35, "Sheet", p.sheet); field(145, 27, 35, "Standards", "IEC 61082", 2.6);
      ctx.restore();
    },
    // sheet connector (interruption point, IEC 61082-1 6.4): conductor end with an open
    // arrow; the signal name and the cross-reference are drawn upright by the app
    offsheet(ctx) {
      line(ctx, [0, 0, 8, 0]); line(ctx, [8, -6, 20, 0, 8, 6, 8, -6]);
    },
    ground(ctx) {
      line(ctx, [0, 0, 0, 8]); line(ctx, [-12, 8, 12, 8]); line(ctx, [-7, 13, 7, 13]); line(ctx, [-2, 18, 2, 18]);
    },
    vdc(ctx, c) {
      // IEC 60617 S00898 cell: the long thin plate is the positive pole, the short thick one
      // the negative. A negative voltage (bias supply) puts the long plate at the "-" pin.
      const s = c && +c.params.v < 0 ? -1 : 1;
      line(ctx, [0, -30, 0, -4]); line(ctx, [0, 4, 0, 30]);
      line(ctx, [-14, -4 * s, 14, -4 * s]);
      ctx.save(); ctx.lineWidth = 4; line(ctx, [-7, 4 * s, 7, 4 * s]); ctx.restore();
      ctx.lineWidth = 1.2; line(ctx, [8, -12 * s, 14, -12 * s]); line(ctx, [11, -12 * s - 3, 11, -12 * s + 3]);
    },
    siggen(ctx) {
      // IEC 60617 static generator (square with G), qualified with a sine for alternating output
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-14, -14, 28, 28); ctx.strokeRect(-14, -14, 28, 28);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = "bold 11px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("G", 0, 1);
      ctx.lineWidth = 1.2; ctx.beginPath(); for (let i = 0; i <= 16; i++) { const x = -6 + i * 0.75, y = 8 - 2.5 * Math.sin(i / 16 * Math.PI * 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    },
    ptx_cat(ctx, c) {
      // primary (left), iron core, centre-tapped HV secondary (right)
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(-12, -30 + 5 + i * 10, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 8; i++) ctx.arc(12, -40 + 5 + i * 10, 5, Math.PI * 1.5, Math.PI / 2, true); ctx.stroke();
      line(ctx, [0, -42, 0, 42]);
      line(ctx, [-40, -30, -12, -30]); line(ctx, [-40, 30, -12, 30]);
      line(ctx, [12, -40, 40, -40]); line(ctx, [12, 0, 40, 0]); line(ctx, [12, 40, 40, 40]);
      if (c.params.bias === "yes") line(ctx, [12, -20, 40, -20]);
    },
    mains(ctx) {
      // IEC 60617 voltage source with the qualifying symbol for alternating current
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 20; i++) { const x = -8 + i * 0.8, y = -4 * Math.sin(i / 20 * Math.PI * 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    },
    ptx(ctx) {
      // AC source + secondary with centre tap; pins on the right
      ctx.beginPath(); ctx.arc(-26, 0, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 16; i++) { const x = -33 + i * 0.9, y = -4 * Math.sin(i / 16 * Math.PI * 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      line(ctx, [-26, -12, -26, -30, -13, -30]); line(ctx, [-26, 12, -26, 30, -13, 30]);
      ctx.beginPath(); for (let i = 0; i < 4; i++) ctx.arc(-13, -30 + 7.5 + i * 15, 7.5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      line(ctx, [-2, -40, -2, 40]);
      ctx.beginPath(); for (let i = 0; i < 8; i++) ctx.arc(6, -40 + 5 + i * 10, 5, Math.PI * 1.5, Math.PI / 2, true); ctx.stroke();
      line(ctx, [6, -40, 20, -40]); line(ctx, [6, 0, 20, 0]); line(ctx, [6, 40, 20, 40]);
    },
    opt_cat(ctx, c) { DRAW.opt_se(ctx, c); },
    opt_se(ctx) {
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(-12, -30 + 5 + i * 10, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(12, -30 + 5 + i * 10, 5, Math.PI * 1.5, Math.PI / 2, true); ctx.stroke();
      line(ctx, [0, -32, 0, 32]);
      line(ctx, [-40, -30, -12, -30]); line(ctx, [-40, 30, -12, 30]); line(ctx, [12, -30, 40, -30]); line(ctx, [12, 30, 40, 30]);
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(-20, -24, 2, 0, Math.PI * 2); ctx.arc(20, -24, 2, 0, Math.PI * 2); ctx.fill();
    },
    opt_pp(ctx) {
      ctx.beginPath(); for (let i = 0; i < 8; i++) ctx.arc(-12, -40 + 5 + i * 10, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(12, -30 + 5 + i * 10, 5, Math.PI * 1.5, Math.PI / 2, true); ctx.stroke();
      line(ctx, [0, -42, 0, 42]);
      line(ctx, [-40, -40, -12, -40]); line(ctx, [-40, 40, -12, 40]); line(ctx, [-40, 0, -12, 0]);
      line(ctx, [-40, -20, -12, -20]); line(ctx, [-40, 20, -12, 20]);
      line(ctx, [12, -30, 40, -30]); line(ctx, [12, 30, 40, 30]);
    },
    tube(ctx, c) {
      // IEC 60617: envelope S00063 (capsule), anode S00703, grids S00705 (dashed),
      // indirectly heated cathode S00696 (a hook with its lead down) and its
      // heater S00698 (an inner arc whose leads leave the envelope, not wired here);
      // pentode as S00746 with the suppressor grid tied to the cathode inside
      const t = tubeByName(c.params.tube), kind = tubeKind(t), conn = c.params.connection || kind;
      ctx.strokeStyle = c._sel ? COL.bodySel : COL.tube;
      ctx.fillStyle = COL.fill;
      ctx.beginPath(); ctx.arc(0, -8, 26, Math.PI, 2 * Math.PI); ctx.lineTo(26, 14); ctx.arc(0, 14, 26, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.6;
      const cathode = () => {
        ctx.beginPath(); ctx.moveTo(0, 50); ctx.lineTo(0, 24); ctx.arc(8, 24, 8, Math.PI, 2 * Math.PI); ctx.lineTo(16, 27); ctx.stroke();
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(6.5, 46); ctx.lineTo(6.5, 32); ctx.arc(10, 32, 3.5, Math.PI, 2 * Math.PI); ctx.lineTo(13.5, 46); ctx.stroke();
        ctx.lineWidth = 1.6;
      };
      if (kind === "rectifier") {
        line(ctx, [-24, -16, -14, -16]); line(ctx, [-20, -16, -20, -50]);
        line(ctx, [14, -16, 24, -16]); line(ctx, [20, -16, 20, -50]);
        cathode();
        return;
      }
      line(ctx, [-12, -22, 12, -22]); line(ctx, [0, -22, 0, -50]);       // anode
      cathode();
      ctx.setLineDash([3, 3]);
      if (conn === "pentode") {
        line(ctx, [-15, 0, 15, 0]);                        // G1
        line(ctx, [-15, -10, 15, -10]);                    // G2
        line(ctx, [-15, 10, 15, 10]);                      // G3
        ctx.setLineDash([]);
        line(ctx, [-50, 0, -15, 0]);
        line(ctx, [15, -10, 50, -10]);
        line(ctx, [15, 10, 18, 10, 18, 24, 16, 26]);       // G3 to the cathode
      } else {
        line(ctx, [-15, 0, 15, 0]);
        ctx.setLineDash([]);
        line(ctx, [-50, 0, -15, 0]);
      }
      ctx.setLineDash([]);
    },
    scope(ctx) {
      ctx.fillStyle = "#101824"; ctx.fillRect(-70, -45, 140, 90); ctx.strokeRect(-70, -45, 140, 90);
      line(ctx, [-80, -30, -70, -30]); line(ctx, [-80, -10, -70, -10]); line(ctx, [-80, 30, -70, 30]);
    }
  };

  // ---------------------------------------------------------------------------
  // Semiconductors used around tube amplifiers: current sources and cascodes
  // (MPSA42/92, MJE340/350, DN2540, LND150), regulators and followers (IRF820,
  // IRF840, IRF9640), bias and protection (zeners, LEDs), small-signal helpers.
  // BJTs: Gummel-Poon parameters (is A, bf, br, vaf V, ikf A) from the widely
  // distributed SPICE models where one exists (2N2222A, 2N3904, 2N3906,
  // 2N2907A); the others are set to the datasheet's typical gain at the usual
  // operating current. MOSFETs: threshold vto (V; negative for depletion
  // N-channel parts), kp (A/V²) from the datasheet's transfer curve. Ratings:
  // v (Vceo / Vds max), i (A), p (W at 25 °C case for power parts, free air else).
  // cbe/cbc, cgs/cgd: junction and gate capacitances (F) for the transient.
  // ---------------------------------------------------------------------------
  const pf = 1e-12;
  const BJTS = {
    "2N2222A": { pol: 1, is: 14.34e-15, bf: 255.9, br: 6.092, vaf: 74.03, ikf: 0.2847, cbe: 25 * pf, cbc: 8 * pf, v: 40, i: 0.6, p: 0.5, pkg: "TO-18", use: "general purpose" },
    "2N3904": { pol: 1, is: 6.734e-15, bf: 416.4, br: 0.7371, vaf: 74.03, ikf: 0.06678, cbe: 8 * pf, cbc: 4 * pf, v: 40, i: 0.2, p: 0.625, pkg: "TO-92", use: "small signal" },
    "BC547B": { pol: 1, is: 7e-15, bf: 290, br: 7.5, vaf: 63, ikf: 0.1, cbe: 9 * pf, cbc: 4.5 * pf, v: 45, i: 0.1, p: 0.5, pkg: "TO-92", use: "small signal, low noise" },
    "BD139": { pol: 1, is: 1e-13, bf: 150, br: 5, vaf: 100, ikf: 1, cbe: 100 * pf, cbc: 30 * pf, v: 80, i: 1.5, p: 12.5, pkg: "TO-126", use: "driver, regulator pass" },
    "MPSA42": { pol: 1, is: 1e-14, bf: 120, br: 5, vaf: 200, ikf: 0.1, cbe: 50 * pf, cbc: 3 * pf, v: 300, i: 0.5, p: 0.625, pkg: "TO-92", use: "high voltage, CCS / cascode" },
    "MJE340": { pol: 1, is: 1e-13, bf: 100, br: 4, vaf: 200, ikf: 0.3, cbe: 100 * pf, cbc: 15 * pf, v: 300, i: 0.5, p: 20, pkg: "TO-126", use: "high voltage, CCS / follower" },
    "2N2907A": { pol: -1, is: 650.6e-18, bf: 231.7, br: 3.563, vaf: 115.7, ikf: 1.079, cbe: 30 * pf, cbc: 8 * pf, v: 60, i: 0.6, p: 0.4, pkg: "TO-18", use: "general purpose" },
    "2N3906": { pol: -1, is: 1.41e-15, bf: 180.7, br: 4.977, vaf: 18.7, ikf: 0.08, cbe: 10 * pf, cbc: 4.5 * pf, v: 40, i: 0.2, p: 0.625, pkg: "TO-92", use: "small signal" },
    "BC557B": { pol: -1, is: 1e-14, bf: 250, br: 10, vaf: 50, ikf: 0.1, cbe: 10 * pf, cbc: 6 * pf, v: 45, i: 0.1, p: 0.5, pkg: "TO-92", use: "small signal, low noise" },
    "BD140": { pol: -1, is: 1e-13, bf: 150, br: 5, vaf: 100, ikf: 1, cbe: 100 * pf, cbc: 40 * pf, v: 80, i: 1.5, p: 12.5, pkg: "TO-126", use: "driver, regulator pass" },
    "MPSA92": { pol: -1, is: 1e-14, bf: 100, br: 5, vaf: 200, ikf: 0.1, cbe: 50 * pf, cbc: 6 * pf, v: 300, i: 0.5, p: 0.625, pkg: "TO-92", use: "high voltage, CCS / cascode" },
    "MJE350": { pol: -1, is: 1e-13, bf: 100, br: 4, vaf: 200, ikf: 0.3, cbe: 100 * pf, cbc: 20 * pf, v: 300, i: 0.5, p: 20, pkg: "TO-126", use: "high voltage, CCS / follower" }
  };
  const MOSFETS = {
    "2N7000": { pol: 1, vto: 2.1, kp: 0.17, lambda: 0.01, cgs: 20 * pf, cgd: 5 * pf, v: 60, i: 0.2, p: 0.4, pkg: "TO-92", use: "small signal switch" },
    "BS170": { pol: 1, vto: 2.1, kp: 0.2, lambda: 0.01, cgs: 20 * pf, cgd: 5 * pf, v: 60, i: 0.5, p: 0.83, pkg: "TO-92", use: "small signal switch" },
    "IRF510": { pol: 1, vto: 3.5, kp: 1.5, lambda: 0.005, cgs: 160 * pf, cgd: 20 * pf, v: 100, i: 5.6, p: 43, pkg: "TO-220", use: "follower, regulator" },
    "IRF820": { pol: 1, vto: 3.8, kp: 0.9, lambda: 0.002, cgs: 335 * pf, cgd: 25 * pf, v: 500, i: 2.5, p: 50, pkg: "TO-220", use: "HV regulator, gyrator, follower" },
    "IRF840": { pol: 1, vto: 3.9, kp: 2.5, lambda: 0.002, cgs: 1180 * pf, cgd: 120 * pf, v: 500, i: 8, p: 125, pkg: "TO-220", use: "HV regulator, follower" },
    "DN2540": { pol: 1, vto: -2.0, kp: 0.15, lambda: 0.002, cgs: 190 * pf, cgd: 10 * pf, v: 400, i: 0.5, p: 15, pkg: "TO-220", use: "depletion, CCS / cascode" },
    "LND150": { pol: 1, vto: -2.0, kp: 0.001, lambda: 0.005, cgs: 7 * pf, cgd: 0.5 * pf, v: 500, i: 0.03, p: 0.74, pkg: "TO-92", use: "depletion, low-current CCS" },
    "BS250": { pol: -1, vto: -2.5, kp: 0.1, lambda: 0.01, cgs: 25 * pf, cgd: 5 * pf, v: 45, i: 0.23, p: 0.83, pkg: "TO-92", use: "small signal switch" },
    "IRF9610": { pol: -1, vto: -3.5, kp: 0.5, lambda: 0.003, cgs: 150 * pf, cgd: 20 * pf, v: 200, i: 1.8, p: 20, pkg: "TO-220", use: "HV CCS, follower" },
    "IRF9640": { pol: -1, vto: -3.5, kp: 1.5, lambda: 0.003, cgs: 1100 * pf, cgd: 100 * pf, v: 200, i: 11, p: 125, pkg: "TO-220", use: "HV regulator, CCS" }
  };
  // zener: breakdown bv (V) at the test current izt (A), dynamic resistance zzt (Ω), power p (W)
  const ZENERS = {
    "1N4733A": { bv: 5.1, izt: 0.049, zzt: 7, p: 1 }, "1N4742A": { bv: 12, izt: 0.021, zzt: 9, p: 1 }, "1N4744A": { bv: 15, izt: 0.017, zzt: 14, p: 1 },
    "1N4750A": { bv: 27, izt: 0.0095, zzt: 35, p: 1 }, "1N4764A": { bv: 100, izt: 0.0025, zzt: 350, p: 1 },
    "1N5378B": { bv: 100, izt: 0.012, zzt: 90, p: 5 }, "1N5388B": { bv: 200, izt: 0.005, zzt: 480, p: 5 }
  };
  // LEDs, as used for cathode bias: forward voltage vf at 10 mA (emission coefficient 2), max current i (A)
  const LEDS = { red: { vf: 1.8, i: 0.02 }, yellow: { vf: 2.0, i: 0.02 }, green: { vf: 2.1, i: 0.02 }, blue: { vf: 3.0, i: 0.02 } };
  const ledIs = vf => 0.01 / Math.exp(vf / (2 * 0.025852));
  const semiRating = m => `${m.v} V, ${m.i} A, ${m.p} W, ${m.pkg}`;
  const semiOptions = (tab, pol) => () => Object.entries(tab).filter(([, m]) => m.pol === pol).map(([k, m]) => [k, `${k} · ${m.v} V ${m.i} A ${m.p} W · ${m.use}`]);
  // BJT and MOSFET parts: same pins (C/D up, B/G left, E/S down) for both polarities
  function bjtPart(pol) {
    const def = pol > 0 ? "2N3904" : "2N3906";
    return {
      name: pol > 0 ? "NPN transistor" : "PNP transistor", prefix: "VT", group: "Semiconductors", bbox: [-30, -30, 22, 30],
      defaults: { model: def },
      pins: () => [{ id: "C", x: 10, y: -30, name: "collector" }, { id: "B", x: -30, y: 0, name: "base" }, { id: "E", x: 10, y: 30, name: "emitter" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: semiOptions(BJTS, pol), wide: true }],
      info: c => { const m = BJTS[c.params.model] || BJTS[def]; return `${c.params.model} (${m.use}): Vceo ${m.v} V, Ic ${m.i} A, Ptot ${m.p} W, ${m.pkg}. Model: Gummel-Poon, hFE ≈ ${Math.round(m.bf)}, Early voltage ${Math.round(m.vaf)} V.`; },
      build: (c, net, alloc, out) => {
        const m = Object.assign({}, BJTS[c.params.model] || BJTS[def], { pol });
        out.push({ id: c.id, kind: "BJT", nodes: [net("C"), net("B"), net("E")], model: { pol, is: m.is, bf: m.bf, br: m.br, vaf: m.vaf, ikf: m.ikf, nf: 1 } });
        out.push({ id: c.id + "#cbe", kind: "C", nodes: [net("B"), net("E")], c: m.cbe }, { id: c.id + "#cbc", kind: "C", nodes: [net("B"), net("C")], c: m.cbc });
      }
    };
  }
  function mosPart(pol) {
    const def = pol > 0 ? "IRF820" : "IRF9610";
    return {
      name: pol > 0 ? "N-channel MOSFET" : "P-channel MOSFET", prefix: "VT", group: "Semiconductors", bbox: [-30, -30, 22, 30],
      defaults: { model: def },
      pins: () => [{ id: "D", x: 10, y: -30, name: "drain" }, { id: "G", x: -30, y: 10, name: "gate" }, { id: "S", x: 10, y: 30, name: "source" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: semiOptions(MOSFETS, pol), wide: true }],
      info: c => { const m = MOSFETS[c.params.model] || MOSFETS[def]; return `${c.params.model} (${m.use}): Vds ${m.v} V, Id ${m.i} A, Ptot ${m.p} W, ${m.pkg}. Model: square law, ${m.vto < 0 === pol > 0 ? "depletion, Vgs(off)" : "threshold"} ${m.vto} V, Kp ${m.kp} A/V²; body diode included.`; },
      build: (c, net, alloc, out) => {
        const m = MOSFETS[c.params.model] || MOSFETS[def], d = net("D"), g = net("G"), s = net("S");
        out.push({ id: c.id, kind: "MOS", nodes: [d, g, s], model: { pol, vto: m.vto, kp: m.kp, lambda: m.lambda } });
        out.push({ id: c.id + "#body", kind: "D", nodes: pol > 0 ? [s, d] : [d, s], is: 1e-12, n: 1.5 });
        out.push({ id: c.id + "#cgs", kind: "C", nodes: [g, s], c: m.cgs }, { id: c.id + "#cgd", kind: "C", nodes: [g, d], c: m.cgd });
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Library
  //   pins(c): [{ id, x, y, name }]           local coords, multiples of 10
  //   bbox: [x1, y1, x2, y2]                   local, for hit testing/selection
  //   fields: inspector rows { key, label, unit, kind: "eng"|"number"|"select"|"range", options }
  //   build(c, net, alloc, out): push solver elements; net(pinId) -> node index
  // ---------------------------------------------------------------------------
  const LIB = {
    resistor: {
      name: "Resistor", prefix: "R", group: "Passive", bbox: [-30, -10, 30, 10],
      defaults: { r: 100e3, w: "" },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      // the rating is marked in the body; the text repeats it from 1 W up (small ones are the usual default)
      value: c => fmtEng(c.params.r, "Ω") + (+c.params.w >= 1 ? " " + (+c.params.w) + "W" : ""),
      fields: [{ key: "r", label: "Resistance", unit: "Ω", kind: "eng" },
        { key: "w", label: "Power rating", kind: "select", options: [["", "Not specified"], ["0.125", "0.125 W"], ["0.25", "0.25 W"], ["0.5", "0.5 W"], ["1", "1 W"], ["2", "2 W"], ["3", "3 W"], ["5", "5 W"], ["10", "10 W"], ["20", "20 W"]] }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "R", nodes: [net("1"), net("2")], r: Math.max(c.params.r, 1e-3) })
    },
    pot: {
      name: "Potentiometer", prefix: "R", group: "Passive", bbox: [-30, -22, 30, 10],
      defaults: { r: 1e6, pos: 0.5, taper: "lin" },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }, { id: "W", x: 0, y: -20, name: "wiper" }],
      value: c => fmtEng(c.params.r, "Ω") + " " + Math.round(c.params.pos * 100) + "%",
      fields: [
        { key: "r", label: "Total resistance", unit: "Ω", kind: "eng" },
        { key: "taper", label: "Taper", kind: "select", options: [["lin", "Linear"], ["log", "Audio (log)"]] },
        { key: "pos", label: "Wiper position", kind: "range", min: 0, max: 1, step: 0.01, format: v => Math.round(v * 100) + "%" }
      ],
      build: (c, net, alloc, out) => {
        let f = c.params.pos;
        if (c.params.taper === "log") f = (Math.pow(10, 2 * f) - 1) / 99;   // ~10% at mid travel
        const r = Math.max(c.params.r, 1);
        out.push({ id: c.id + "#a", kind: "R", nodes: [net("1"), net("W")], r: Math.max(r * f, 0.1) });
        out.push({ id: c.id + "#b", kind: "R", nodes: [net("W"), net("2")], r: Math.max(r * (1 - f), 0.1) });
      }
    },
    capacitor: {
      name: "Capacitor", prefix: "C", group: "Passive", bbox: [-20, -12, 20, 12],
      defaults: { c: 0.1e-6 },
      pins: () => [{ id: "1", x: -20, y: 0 }, { id: "2", x: 20, y: 0 }],
      value: c => fmtEng(c.params.c, "F"),
      fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "eng" }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "C", nodes: [net("1"), net("2")], c: Math.max(c.params.c, 1e-15) })
    },
    electrolytic: {
      name: "Electrolytic cap", prefix: "C", group: "Passive", bbox: [-20, -12, 20, 12],
      defaults: { c: 47e-6 },
      pins: () => [{ id: "+", x: -20, y: 0 }, { id: "-", x: 20, y: 0 }],
      value: c => fmtEng(c.params.c, "F"),
      fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "eng" }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "C", nodes: [net("+"), net("-")], c: Math.max(c.params.c, 1e-15) })
    },
    inductor: {
      name: "Inductor / choke", prefix: "L", group: "Passive", bbox: [-30, -12, 30, 6],
      defaults: { l: 5, dcr: 100 },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => fmtEng(c.params.l, "H"),
      fields: [{ key: "l", label: "Inductance", unit: "H", kind: "eng" }, { key: "dcr", label: "DC resistance", unit: "Ω", kind: "eng" }],
      build: (c, net, alloc, out) => {
        const mid = alloc();
        out.push({ id: c.id + "#dcr", kind: "R", nodes: [net("1"), mid], r: Math.max(c.params.dcr, 1e-3) });
        out.push({ id: c.id, kind: "L", nodes: [mid, net("2")], l: Math.max(c.params.l, 1e-9) });
      }
    },
    switch: {
      name: "Switch (changeover)", prefix: "SA", group: "Passive", bbox: [-30, -14, 30, 14],
      defaults: { pos: "A" },
      pins: () => [{ id: "C", x: -30, y: 0, name: "common" }, { id: "A", x: 30, y: -10, name: "throw A" }, { id: "B", x: 30, y: 10, name: "throw B" }],
      value: c => "→ " + c.params.pos,
      fields: [{ key: "pos", label: "Position", kind: "select", options: [["A", "A (upper throw)"], ["B", "B (lower throw)"]] }],
      // the closed contact is 10 mΩ; the open one 10 GΩ, so a node left on it never floats
      build: (c, net, alloc, out) => {
        const on = c.params.pos === "B" ? "B" : "A", off = on === "A" ? "B" : "A";
        out.push({ id: c.id + "#on", kind: "R", nodes: [net("C"), net(on)], r: 0.01 });
        out.push({ id: c.id + "#off", kind: "R", nodes: [net("C"), net(off)], r: 1e10 });
      }
    },
    speaker: {
      name: "Speaker", prefix: "BA", group: "Passive", bbox: [-6, -20, 16, 20],
      defaults: { r: 8 },
      pins: () => [{ id: "+", x: 0, y: -20 }, { id: "-", x: 0, y: 20 }],
      value: c => fmtEng(c.params.r, "Ω"),
      fields: [{ key: "r", label: "Impedance", unit: "Ω", kind: "eng" }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "R", nodes: [net("+"), net("-")], r: Math.max(c.params.r, 0.1) })
    },
    opt_se: {
      name: "Output transformer, single-ended (generic)", prefix: "T", group: "Transformers", bbox: [-40, -34, 40, 34],
      defaults: { zp: 5000, zs: 8, lp: 20, dcrp: 150, dcrs: 0.5 },
      pins: () => [{ id: "P1", x: -40, y: -30, name: "primary (B+)" }, { id: "P2", x: -40, y: 30, name: "primary (anode)" }, { id: "S1", x: 40, y: -30 }, { id: "S2", x: 40, y: 30 }],
      value: c => fmtEng(c.params.zp, "") + ":" + fmtEng(c.params.zs, "Ω"),
      fields: [
        { key: "zp", label: "Primary impedance", unit: "Ω", kind: "eng" },
        { key: "zs", label: "Secondary impedance", unit: "Ω", kind: "eng" },
        { key: "lp", label: "Primary inductance", unit: "H", kind: "eng" },
        { key: "dcrp", label: "Primary DCR", unit: "Ω", kind: "eng" },
        { key: "dcrs", label: "Secondary DCR", unit: "Ω", kind: "eng" }
      ],
      build: (c, net, alloc, out) => {
        const p = c.params, n = Math.sqrt(Math.max(p.zp, 1) / Math.max(p.zs, 0.01));
        const a = alloc(), s = alloc();
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), a], r: Math.max(p.dcrp, 1e-3) });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(p.dcrs, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp: Math.max(p.lp, 1e-3), k: 0.999, primaryTurns: 1,
          windings: [{ a: a, b: net("P2"), turns: 1 }, { a: s, b: net("S2"), turns: 1 / n }] });
      }
    },
    opt_cat: {
      name: "Output transformer, single-ended (Hammond 125SE)", prefix: "T", group: "Transformers", bbox: [-40, -34, 40, 34],
      defaults: { model: "125ESE", tap: "GRN" },
      pins: () => [{ id: "P1", x: -40, y: -30, name: "primary BRN (B+)" }, { id: "P2", x: -40, y: 30, name: "primary BLU (anode)" },
        { id: "S1", x: 40, y: -30, name: "secondary tap" }, { id: "S2", x: 40, y: 30, name: "secondary BLK (0)" }],
      value: c => `${c.params.model} ${c.params.tap}`,
      fields: [
        { key: "model", label: "Model", kind: "select", options: () => Object.entries(OUTPUT_TX).map(([k, m]) => [k, `${k} · ${m.w} W, ${m.ma} mA`]), wide: true },
        { key: "tap", label: "Secondary tap", kind: "select", options: Object.entries(SE_TAPS).map(([t, z]) => [t, `${t}: ${z} Ω → 10k, ${z / 2} Ω → 5k`]), wide: true }
      ],
      info: c => {
        const m = OUTPUT_TX[c.params.model] || OUTPUT_TX["125ESE"], z = SE_TAPS[c.params.tap] || 8;
        return `${m.name}, universal single-ended: ${m.w} W, ${m.ma} mA DC max, 100 Hz–15 kHz. ` +
          `Primary BRN (B+) – BLU (anode) ${m.rp} Ω, ${m.lp} H; secondary BLK – ${c.params.tap} ${(m.rs[c.params.tap] * 1000).toFixed(0)} mΩ. ` +
          `Turns ratio ${Math.sqrt(10000 / z).toFixed(1)}:1, so the primary sees 10 kΩ with ${z} Ω, 5 kΩ with ${z / 2} Ω, 2.5 kΩ with ${z / 4} Ω on the secondary.`;
      },
      build: (c, net, alloc, out) => {
        const m = OUTPUT_TX[c.params.model] || OUTPUT_TX["125ESE"], z = SE_TAPS[c.params.tap] || 8, n = Math.sqrt(10000 / z);
        const a = alloc(), s = alloc();
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), a], r: m.rp });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(m.rs[c.params.tap] || 0.2, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp: m.lp, k: 0.999, primaryTurns: 1,
          windings: [{ a: a, b: net("P2"), turns: 1 }, { a: s, b: net("S2"), turns: 1 / n }] });
      }
    },
    opt_pp: {
      name: "Output transformer, push-pull / UL (generic)", prefix: "T", group: "Transformers", bbox: [-40, -44, 40, 44],
      defaults: { zaa: 8000, zs: 8, lp: 30, tap: 43, dcrp: 120, dcrs: 0.4 },
      pins: () => [
        { id: "P1", x: -40, y: -40, name: "anode 1" }, { id: "U1", x: -40, y: -20, name: "UL tap 1" }, { id: "CT", x: -40, y: 0, name: "centre tap (B+)" },
        { id: "U2", x: -40, y: 20, name: "UL tap 2" }, { id: "P2", x: -40, y: 40, name: "anode 2" }, { id: "S1", x: 40, y: -30 }, { id: "S2", x: 40, y: 30 }],
      value: c => fmtEng(c.params.zaa, "") + ":" + fmtEng(c.params.zs, "Ω"),
      fields: [
        { key: "zaa", label: "Plate-to-plate Z", unit: "Ω", kind: "eng" },
        { key: "zs", label: "Secondary impedance", unit: "Ω", kind: "eng" },
        { key: "lp", label: "Primary inductance", unit: "H", kind: "eng" },
        { key: "tap", label: "UL tap (% of half)", unit: "%", kind: "number", min: 5, max: 95 },
        { key: "dcrp", label: "DCR per half", unit: "Ω", kind: "eng" },
        { key: "dcrs", label: "Secondary DCR", unit: "Ω", kind: "eng" }
      ],
      build: (c, net, alloc, out) => {
        const p = c.params, n = Math.sqrt(Math.max(p.zaa, 1) / Math.max(p.zs, 0.01));
        const t = Math.min(Math.max(p.tap, 5), 95) / 100;
        const a1 = alloc(), a2 = alloc(), s = alloc();
        out.push({ id: c.id + "#r1", kind: "R", nodes: [net("P1"), a1], r: Math.max(p.dcrp, 1e-3) });
        out.push({ id: c.id + "#r2", kind: "R", nodes: [net("P2"), a2], r: Math.max(p.dcrp, 1e-3) });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(p.dcrs, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp: Math.max(p.lp, 1e-3), k: 0.999, primaryTurns: 1,
          windings: [
            { a: a1, b: net("U1"), turns: 0.5 * (1 - t) }, { a: net("U1"), b: net("CT"), turns: 0.5 * t },
            { a: net("CT"), b: net("U2"), turns: 0.5 * t }, { a: net("U2"), b: a2, turns: 0.5 * (1 - t) },
            { a: s, b: net("S2"), turns: 1 / n }] });
      }
    },
    ptx: {
      name: "Power transformer with mains (generic)", prefix: "T", group: "Transformers", bbox: [-40, -44, 20, 44],
      defaults: { vrms: 300, freq: 50, rw: 60 },
      pins: () => [{ id: "HT1", x: 20, y: -40 }, { id: "CT", x: 20, y: 0, name: "centre tap" }, { id: "HT2", x: 20, y: 40 }],
      value: c => c.params.vrms + "-0-" + c.params.vrms + "V",
      fields: [
        { key: "vrms", label: "Voltage per half", unit: "Vrms", kind: "number", min: 1 },
        { key: "freq", label: "Mains frequency", kind: "select", options: [["50", "50 Hz"], ["60", "60 Hz"]] },
        { key: "rw", label: "Winding resistance (half)", unit: "Ω", kind: "eng" }
      ],
      build: (c, net, alloc, out) => {
        const p = c.params, vpk = p.vrms * Math.SQRT2, f = parseFloat(p.freq) || 50;
        const n1 = alloc(), n2 = alloc();
        out.push({ id: c.id + "#rw1", kind: "R", nodes: [net("HT1"), n1], r: Math.max(p.rw, 1e-3) });
        out.push({ id: c.id + "#rw2", kind: "R", nodes: [net("HT2"), n2], r: Math.max(p.rw, 1e-3) });
        // DC operating point starts with both ends at peak so reservoir caps begin charged
        out.push({ id: c.id + "#a", kind: "VSRC", nodes: [n1, net("CT")], wave: "sine", freq: f, amp: vpk, dcValue: 0.95 * vpk });
        out.push({ id: c.id + "#b", kind: "VSRC", nodes: [net("CT"), n2], wave: "sine", freq: f, amp: vpk, dcValue: -0.95 * vpk });
      }
    },
    ptx_cat: {
      name: "Power transformer (Hammond 300 series)", prefix: "T", group: "Transformers", bbox: [-40, -44, 40, 44],
      defaults: { model: "373BX", tap: "230", bias: "no" },
      // primary on the left (wire an AC mains source to it), HV winding on the right
      pins: c => {
        const p = [{ id: "P1", x: -40, y: -30, name: "primary" }, { id: "P2", x: -40, y: 30, name: "primary" },
          { id: "HT1", x: 40, y: -40 }, { id: "CT", x: 40, y: 0, name: "centre tap" }, { id: "HT2", x: 40, y: 40 }];
        if (c.params.bias === "yes") p.push({ id: "B", x: 40, y: -20, name: "bias tap" });
        return p;
      },
      value: c => `${c.params.model} ${c.params.tap}V`,
      fields: [
        { key: "model", label: "Model", kind: "select", options: () => Object.entries(POWER_TX).map(([k, m]) => [k, `${k} · ${m.rated}`]), wide: true },
        { key: "tap", label: "Primary tap", kind: "select", options: c => (POWER_TX[c.params.model] || POWER_TX["373BX"]).taps.map(t => [String(t), t + (t > 150 ? " V (primaries in series)" : " V (primaries in parallel)")]), wide: true },
        { key: "bias", label: "Bias tap pin", kind: "select", options: [["no", "Hidden"], ["yes", "Shown (≈50 V)"]] }
      ],
      info: c => {
        const h = powerTx(c.params.model, c.params.tap), m = h.m;
        return `${m.name}: ${m.rated} under load, 50 V bias tap, heaters ${m.heaters} (not simulated). ` +
          `${h.tap} V on the primary gives ${h.nlv.toFixed(1)} V per HV half at no load (${(h.nlv * 2).toFixed(1)} V CT). ` +
          `DCR ${(h.rHalf).toFixed(1)} Ω per half, primary ${h.rPri.toFixed(2)} Ω; magnetizing ${h.lPri.toFixed(1)} H. Wire an AC mains source to the primary.`;
      },
      build: (c, net, alloc, out) => {
        const h = powerTx(c.params.model, c.params.tap), bias = c.params.bias === "yes";
        const pa = alloc(), h1 = alloc(), h2 = alloc();
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), pa], r: Math.max(h.rPri, 1e-3) });
        const windings = [{ a: pa, b: net("P2"), turns: h.tap }];
        if (bias) {   // the bias tap sits on the HT1 half, 50 V from the centre tap: HT1 -> B -> CT
          const fb = h.nlvBias / h.nlv, bb = alloc();
          out.push({ id: c.id + "#r1", kind: "R", nodes: [net("HT1"), h1], r: h.rHalf * (1 - fb) });
          windings.push({ a: h1, b: net("B"), turns: h.nlv - h.nlvBias });
          out.push({ id: c.id + "#rb", kind: "R", nodes: [net("B"), bb], r: h.rHalf * fb });
          windings.push({ a: bb, b: net("CT"), turns: h.nlvBias });
        } else {
          out.push({ id: c.id + "#r1", kind: "R", nodes: [net("HT1"), h1], r: h.rHalf });
          windings.push({ a: h1, b: net("CT"), turns: h.nlv });
        }
        out.push({ id: c.id + "#r2", kind: "R", nodes: [net("HT2"), h2], r: h.rHalf });
        windings.push({ a: net("CT"), b: h2, turns: h.nlv });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp: h.lPri, k: 0.999, primaryTurns: h.tap, windings });
      }
    },
    mains: {
      name: "AC mains", prefix: "G", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { vrms: 230, freq: "50", rs: 0.5 },
      pins: () => [{ id: "L", x: 0, y: -30, name: "line" }, { id: "N", x: 0, y: 30, name: "neutral" }],
      value: c => c.params.vrms + "V " + c.params.freq + "Hz",
      fields: [
        { key: "vrms", label: "Voltage", unit: "Vrms", kind: "number", min: 1, max: 480 },
        { key: "freq", label: "Frequency", kind: "select", options: [["50", "50 Hz"], ["60", "60 Hz"]] },
        { key: "rs", label: "Source resistance", unit: "Ω", kind: "eng" }
      ],
      info: () => "Feeds a power transformer's primary. The neutral is earthed, as in TN mains (bonded to ground inside the part), so the primary circuit needs no ground symbol.",
      build: (c, net, alloc, out) => {
        const p = c.params, mid = alloc();
        // starts at the voltage peak (cosine): a transformer then draws no inrush and settles at once
        out.push({ id: c.id, kind: "VSRC", nodes: [mid, net("N")], wave: "sine", freq: parseFloat(p.freq) || 50, amp: p.vrms * Math.SQRT2, phase: 90, acMains: true });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("L"), mid], r: Math.max(p.rs, 1e-3) });
        // neutral solidly earthed: a primary tied to ground only weakly leaves its common-mode
        // voltage ill-conditioned, and Newton then wobbles at round-off level
        out.push({ id: c.id + "#earth", kind: "R", nodes: [net("N"), 0], r: 1 });
      }
    },
    tube: {
      // letter code VL (electrovacuum device, ГОСТ 2.710), rectifier tubes included
      name: "Vacuum tube", prefix: "VL", group: "Tubes", bbox: [-50, -50, 50, 50],
      defaults: { tube: "12AX7", connection: "triode" },
      pins: c => {
        const t = tubeByName(c.params.tube), kind = tubeKind(t);
        if (kind === "rectifier") return [{ id: "A1", x: -20, y: -50, name: "anode 1" }, { id: "A2", x: 20, y: -50, name: "anode 2" }, { id: "K", x: 0, y: 50, name: "cathode" }];
        if ((c.params.connection || kind) === "pentode") return [{ id: "A", x: 0, y: -50, name: "anode" }, { id: "G1", x: -50, y: 0, name: "control grid" }, { id: "G2", x: 50, y: -10, name: "screen grid" }, { id: "K", x: 0, y: 50, name: "cathode" }];
        return [{ id: "A", x: 0, y: -50, name: "anode" }, { id: "G", x: -50, y: 0, name: "grid" }, { id: "K", x: 0, y: 50, name: "cathode" }];
      },
      // Pin numbers per symbol terminal, from the tube's pinout: { A, G, G1, G2, K, A1, A2, H }.
      // A dual tube's section comes from the designation suffix (VL1.2 → section 2).
      pinNumbers: c => {
        const t = tubeByName(c.params.tube);
        if (!t || !t.pinout || !t.pinout.length) return {};
        const kind = tubeKind(t), po = t.pinout, has = s => po.some(p => p.sym === s);
        const sec = (/\.(\d+)$/.exec(c.label || "") || [])[1] === "2" ? 2 : 1, q = sec === 2 ? "\"" : "'";
        const tp = has("AT") ? (/-P$/.test(t.commonName) ? "P" : "T") : null;
        const twin = kind !== "rectifier" && !tp && has("A1") && has("A2");
        const pick = cands => { for (const s of cands) { const n = po.filter(p => p.sym === s).map(p => p.pin); if (n.length) return n; } return []; };
        const filament = po.filter(p => p.isHeater && /^(F|K_H)/.test(p.sym)).map(p => p.pin);
        const heater = po.filter(p => p.isHeater).map(p => p.pin);
        const cap = /top cap/.test(t.socket) ? ["cap"] : [];
        const out = {};
        let k = pick(tp ? ["K" + tp] : twin ? ["K" + sec, "K", "K_H"] : ["K", "K_H"]);
        if (!k.length) k = filament.length ? filament : heater;
        if (kind === "rectifier") {
          out.A1 = pick(["A1", "A"]); if (!out.A1.length) out.A1 = cap;
          out.A2 = pick(["A2"]);
        } else {
          out.A = pick(tp ? ["A" + tp] : twin ? ["A" + sec] : ["A"]); if (!out.A.length) out.A = cap;
          out.G = pick(tp === "T" ? ["GT"] : twin ? ["G" + sec, "G1" + q] : ["G", "G1"]);
          out.G1 = pick(["G1" + q, "G1"]);
          out.G2 = pick(["G2" + q, "G2"]);
        }
        out.K = k;
        if (heater.some(p => !k.includes(p))) out.H = heater;
        for (const key in out) out[key] = out[key].join(",");
        return out;
      },
      value: c => c.params.tube + (tubeKind(tubeByName(c.params.tube)) === "pentode" && c.params.connection === "triode" ? " (triode)" : ""),
      fields: [
        { key: "tube", label: "Tube type", kind: "tube" },
        { key: "connection", label: "Model", kind: "select", options: [["pentode", "Pentode / beam (A G1 G2 K)"], ["triode", "Triode-connected (A G K)"]], when: c => tubeKind(tubeByName(c.params.tube)) === "pentode" }
      ],
      build: (c, net, alloc, out) => {
        const t = tubeByName(c.params.tube);
        if (!t) return;
        const kind = tubeKind(t);
        if (kind === "rectifier") {
          const P = (root.TubeSimEngine.RECTIFIER_PERVEANCE[t.commonName]) || 1e-3;
          out.push({ id: c.id, part: "a1", kind: "VDIODE", nodes: [net("A1"), net("K")], perveance: P });
          out.push({ id: c.id, part: "a2", kind: "VDIODE", nodes: [net("A2"), net("K")], perveance: P });
        } else if ((c.params.connection || kind) === "pentode" && t.koren.Pentode) {
          out.push({ id: c.id, kind: "PENTODE", nodes: [net("A"), net("G1"), net("G2"), net("K")], model: t.koren.Pentode });
        } else {
          out.push({ id: c.id, kind: "TRIODE", nodes: [net("A"), net("G"), net("K")], model: t.koren.Triode });
        }
      }
    },
    diode: {
      name: "Silicon diode", prefix: "VD", group: "Semiconductors", bbox: [-20, -9, 20, 9],
      defaults: { model: "1N4007" },
      pins: () => [{ id: "A", x: -20, y: 0, name: "anode" }, { id: "K", x: 20, y: 0, name: "cathode" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Model", kind: "select", options: [["1N4007", "1N4007 (rectifier)"], ["UF4007", "UF4007 (fast)"], ["1N4148", "1N4148 (signal)"]] }],
      build: (c, net, alloc, out) => {
        const m = { "1N4007": { is: 7e-9, n: 1.8 }, "UF4007": { is: 1e-8, n: 1.9 }, "1N4148": { is: 2.5e-9, n: 1.75 } }[c.params.model] || { is: 7e-9, n: 1.8 };
        const mid = alloc();
        out.push({ id: c.id, kind: "D", nodes: [net("A"), mid], is: m.is, n: m.n });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [mid, net("K")], r: 0.05 });
      }
    },
    zener: {
      name: "Zener diode", prefix: "VD", group: "Semiconductors", bbox: [-20, -10, 20, 10],
      defaults: { model: "1N4742A" },
      pins: () => [{ id: "A", x: -20, y: 0, name: "anode" }, { id: "K", x: 20, y: 0, name: "cathode" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: () => Object.entries(ZENERS).map(([k, z]) => [k, `${k} · ${z.bv} V ${z.p} W`]), wide: true }],
      info: c => { const z = ZENERS[c.params.model] || ZENERS["1N4742A"]; return `${c.params.model}: ${z.bv} V at ${z.izt * 1000} mA, ${z.zzt} Ω dynamic resistance, ${z.p} W. Conducts forward like a silicon diode; reverse current flows above the zener voltage.`; },
      // forward junction A -> K; breakdown path K -> rz -> junction -> offset -> A, which together
      // drop bv at izt with zzt dynamic resistance
      build: (c, net, alloc, out) => {
        const z = ZENERS[c.params.model] || ZENERS["1N4742A"], a = net("A"), k = net("K"), m1 = alloc(), m2 = alloc();
        const isb = 1e-14, vj = 0.025852 * Math.log(z.izt / isb), rz = Math.max(z.zzt - 0.025852 / z.izt, 0.1);
        out.push({ id: c.id, kind: "D", nodes: [a, k], is: 2.5e-9, n: 1.75 });
        out.push({ id: c.id + "#zz", kind: "R", nodes: [k, m1], r: rz });
        out.push({ id: c.id + "#bd", kind: "D", nodes: [m1, m2], is: isb, n: 1 });
        out.push({ id: c.id + "#bv", kind: "V", nodes: [m2, a], v: z.bv - vj - z.izt * rz });
      }
    },
    led: {
      name: "LED", prefix: "HL", group: "Semiconductors", bbox: [-20, -20, 20, 9],
      defaults: { color: "red" },
      pins: () => [{ id: "A", x: -20, y: 0, name: "anode" }, { id: "K", x: 20, y: 0, name: "cathode" }],
      value: c => c.params.color + " LED",
      fields: [{ key: "color", label: "Colour", kind: "select", options: () => Object.entries(LEDS).map(([k, l]) => [k, `${k[0].toUpperCase() + k.slice(1)} · ${l.vf} V at 10 mA`]) }],
      info: c => { const l = LEDS[c.params.color] || LEDS.red; return `${l.vf} V at 10 mA, ${l.i * 1000} mA max. In the cathode of a triode it is a low-impedance bias source (no bypass capacitor needed).`; },
      build: (c, net, alloc, out) => {
        const l = LEDS[c.params.color] || LEDS.red, mid = alloc();
        out.push({ id: c.id, kind: "D", nodes: [net("A"), mid], is: ledIs(l.vf), n: 2 });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [mid, net("K")], r: 5 });
      }
    },
    npn: bjtPart(1),
    pnp: bjtPart(-1),
    nmos: mosPart(1),
    pmos: mosPart(-1),
    vdc: {
      name: "DC supply", prefix: "G", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { v: 300, rs: 0 },
      pins: () => [{ id: "+", x: 0, y: -30 }, { id: "-", x: 0, y: 30 }],
      value: c => fmtEng(c.params.v, "V"),
      fields: [{ key: "v", label: "Voltage", unit: "V", kind: "eng" }, { key: "rs", label: "Internal resistance", unit: "Ω", kind: "eng" }],
      build: (c, net, alloc, out) => {
        if (c.params.rs > 0) {
          const mid = alloc();
          out.push({ id: c.id, kind: "V", nodes: [mid, net("-")], v: c.params.v });
          out.push({ id: c.id + "#rs", kind: "R", nodes: [net("+"), mid], r: c.params.rs });
        } else out.push({ id: c.id, kind: "V", nodes: [net("+"), net("-")], v: c.params.v });
      }
    },
    siggen: {
      name: "Signal generator", prefix: "G", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { wave: "sine", freq: 1000, amp: 1, offset: 0, phase: 0, rs: 50 },
      pins: () => [{ id: "+", x: 0, y: -30, name: "output" }, { id: "-", x: 0, y: 30, name: "common" }],
      value: c => fmtEng(c.params.amp, "Vpk") + " " + fmtEng(c.params.freq, "Hz"),
      fields: [
        { key: "wave", label: "Waveform", kind: "select", options: [["sine", "Sine"], ["square", "Square"], ["triangle", "Triangle"]] },
        { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" },
        { key: "amp", label: "Amplitude", unit: "Vpk", kind: "eng" },
        // the same amplitude as RMS and as dBV (0 dBV = 1 Vrms), using the waveform's crest factor
        { key: "amp", label: "Amplitude", unit: "Vrms", kind: "level", as: "rms" },
        { key: "amp", label: "Level", unit: "dBV", kind: "level", as: "dbv" },
        { key: "offset", label: "DC offset", unit: "V", kind: "eng" },
        { key: "phase", label: "Phase", kind: "select", options: [["0", "0°"], ["90", "90°"], ["180", "180° (inverted)"], ["270", "270°"]] },
        { key: "rs", label: "Output impedance", unit: "Ω", kind: "eng" }
      ],
      build: (c, net, alloc, out) => {
        const p = c.params, mid = alloc();
        out.push({ id: c.id, kind: "VSRC", nodes: [mid, net("-")], wave: p.wave, freq: Math.max(p.freq, 0.1), amp: p.amp, offset: p.offset || 0, phase: parseFloat(p.phase) || 0 });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("+"), mid], r: Math.max(p.rs, 1e-3) });
      }
    },
    note: {
      name: "Text note", prefix: "", group: "Document", noLabel: true, noRotate: true,
      bbox: c => { const h = +c.params.size || 12, w = Math.max(20, String(c.params.text || "").length * h * 0.62); return [0, -h, w, 3]; },
      defaults: { text: "Note", size: "12" },
      pins: () => [],
      value: () => "",
      fields: [{ key: "text", label: "Text", kind: "text" }, { key: "size", label: "Text height", kind: "select", options: [["10", "2.5 mm"], ["12", "3 mm"], ["14", "3.5 mm"], ["20", "5 mm"]] }],
      build: () => {}
    },
    frame: {
      name: "Drawing frame + title block", prefix: "", group: "Document", noLabel: true, noRotate: true,
      bbox: c => { const g = sheetGeom(c); return [0, 0, g.W, g.H]; },
      // only the frame lines and the title block pick it up, so parts inside stay clickable
      hit: (c, x, y) => {
        const g = sheetGeom(c), lx = x - c.x, ly = y - c.y, t = 6 * MM, tb = g.tb;
        const inTb = lx >= tb.x1 && lx <= tb.x2 && ly >= tb.y1 && ly <= tb.y2;
        const nearFrame = lx >= g.fx1 - t && lx <= g.fx2 + t && ly >= g.fy1 - t && ly <= g.fy2 + t &&
          !(lx > g.fx1 + t && lx < g.fx2 - t && ly > g.fy1 + t && ly < g.fy2 - t);
        return inTb || nearFrame;
      },
      defaults: { locked: "yes", size: "A2", orient: "landscape", title: "", docno: "", rev: "A", sheet: "1/1", date: "", creator: "", approver: "", owner: "", dept: "", reference: "", doctype: "Circuit diagram", status: "Released", lang: "en" },
      pins: () => [],
      value: c => c.params.size + (c.params.orient === "portrait" ? " portrait" : ""),
      fields: [
        { key: "locked", label: "Position", kind: "select", options: [["yes", "Locked (cannot be moved or deleted)"], ["no", "Unlocked"]], wide: true },
        { key: "size", label: "Sheet size", kind: "select", options: Object.keys(SHEETS).map(k => [k, `${k} (${SHEETS[k][0]} × ${SHEETS[k][1]} mm)`]) },
        { key: "orient", label: "Orientation", kind: "select", options: [["landscape", "Landscape"], ["portrait", "Portrait"]] },
        { key: "title", label: "Title", kind: "text" }, { key: "docno", label: "Identification number", kind: "text" },
        { key: "rev", label: "Revision", kind: "text" }, { key: "sheet", label: "Sheet", kind: "text" }, { key: "date", label: "Date of issue", kind: "text" },
        { key: "creator", label: "Created by", kind: "text" }, { key: "approver", label: "Approved by", kind: "text" }, { key: "owner", label: "Legal owner", kind: "text" },
        { key: "dept", label: "Responsible department", kind: "text" }, { key: "reference", label: "Technical reference", kind: "text" },
        { key: "doctype", label: "Document type", kind: "text" }, { key: "status", label: "Document status", kind: "text" }, { key: "lang", label: "Language", kind: "text" }
      ],
      info: c => { const g = sheetGeom(c); return `IEC 61082-1 sheet: ISO 5457 frame with a ${g.cols} × ${g.rows} reference grid (columns 1–${g.cols}, rows A–${"ABCDEFGHJKLMNPRSTUVWXYZ"[g.rows - 1]}) and an ISO 7200 title block. Scale: 4 drawing units per mm (a resistor body is 7.5 × 3 mm).`; },
      build: () => {}
    },
    ground: {
      name: "Ground", prefix: "GND", group: "Sources", bbox: [-12, -2, 12, 20], noLabel: true,
      defaults: {},
      pins: () => [{ id: "G", x: 0, y: 0 }],
      value: () => "",
      fields: [],
      build: () => {}
    },
    offsheet: {
      name: "Sheet connector", prefix: "", group: "Sources", noLabel: true,
      // the arrow plus room for the name beyond its tip (for picking)
      bbox: c => [0, -10, 26 + 7 * String(c.params.name || "").length, 10],
      defaults: { name: "+B" },
      pins: () => [{ id: "1", x: 0, y: 0 }],
      value: c => c.params.name || "",
      fields: [{ key: "name", label: "Signal name", kind: "text" }],
      info: () => "Joins every sheet connector with the same signal name, on any sheet, as if wired. Use it to carry a supply rail or a signal to another sheet; the cross-reference next to it gives the sheet and grid zone of its partners (IEC 61082-1).",
      build: () => {}
    },
    scope: {
      name: "Oscilloscope", prefix: "P", group: "Instruments", bbox: [-80, -45, 70, 45], noRotate: true,
      defaults: { ch1: "auto", ch2: "auto", time: "auto", coupling1: "dc", coupling2: "dc", probe: "10x" },
      pins: () => [{ id: "CH1", x: -80, y: -30 }, { id: "CH2", x: -80, y: -10 }, { id: "COM", x: -80, y: 30, name: "common" }],
      value: () => "",
      fields: [
        { key: "ch1", label: "CH1 volts/div", kind: "select", options: [["auto", "Auto"], ["0.01", "10 mV"], ["0.1", "100 mV"], ["0.5", "0.5 V"], ["1", "1 V"], ["5", "5 V"], ["10", "10 V"], ["50", "50 V"], ["100", "100 V"]] },
        { key: "coupling1", label: "CH1 coupling", kind: "select", options: [["dc", "DC"], ["ac", "AC"]] },
        { key: "ch2", label: "CH2 volts/div", kind: "select", options: [["auto", "Auto"], ["0.01", "10 mV"], ["0.1", "100 mV"], ["0.5", "0.5 V"], ["1", "1 V"], ["5", "5 V"], ["10", "10 V"], ["50", "50 V"], ["100", "100 V"]] },
        { key: "coupling2", label: "CH2 coupling", kind: "select", options: [["dc", "DC"], ["ac", "AC"]] },
        { key: "probe", label: "Probes", kind: "select", options: [["10x", "10× (10 MΩ load)"], ["1x", "1× (1 MΩ load)"]] },
        { key: "time", label: "Time/div", kind: "select", options: [["auto", "Auto (2 cycles)"], ["0.0001", "0.1 ms"], ["0.0002", "0.2 ms"], ["0.0005", "0.5 ms"], ["0.001", "1 ms"], ["0.002", "2 ms"], ["0.005", "5 ms"]] }
      ],
      build: (c, net, alloc, out) => {
        // the probes load the circuit like a real scope: 10 MΩ with 10× probes, 1 MΩ direct
        const rin = c.params.probe === "1x" ? 1e6 : 10e6;
        out.push({ id: c.id + "#in1", kind: "R", nodes: [net("CH1"), net("COM")], r: rin });
        out.push({ id: c.id + "#in2", kind: "R", nodes: [net("CH2"), net("COM")], r: rin });
      }
    }
  };

  // Palette layout
  const PALETTE = [
    { group: "Passive", items: [["resistor"], ["pot"], ["capacitor"], ["electrolytic"], ["inductor"], ["speaker"], ["switch"]] },
    { group: "Transformers", items: [
      { sub: "Generic: set the values yourself" },
      ["opt_se", null, "Output, single-ended"], ["opt_pp", null, "Output, push-pull / UL"], ["ptx", null, "Power, with mains"],
      { sub: "Manufactured: Hammond catalog" },
      ["opt_cat", null, "Output 125SE"], ["ptx_cat", null, "Power 300"]] },
    { group: "Sources", items: [["vdc", { v: 300 }, "B+ supply"], ["vdc", { v: -20 }, "Bias supply"], ["mains"], ["siggen"], ["ground"], ["offsheet"]] },
    { group: "Semiconductors", items: [["diode"], ["zener"], ["led"],
      { sub: "Transistors" }, ["npn"], ["pnp"], ["npn", { model: "MJE340" }, "NPN, high voltage"], ["pnp", { model: "MJE350" }, "PNP, high voltage"],
      ["nmos", null, "N-MOSFET"], ["nmos", { model: "DN2540" }, "N-MOSFET, depletion"], ["pmos", null, "P-MOSFET"]] },
    { group: "Instruments", items: [["scope"]] },
    { group: "Document", items: [["frame"], ["note"]] }
  ];

  root.CadLib = { LIB, DRAW, COL, PALETTE, SHEETS, sheetGeom, MM, POWER_TX, powerTx, OUTPUT_TX, BJTS, MOSFETS, ZENERS, LEDS, semiRating, parseEng, fmtEng, tubeByName, tubeKind };
})(globalThis);
