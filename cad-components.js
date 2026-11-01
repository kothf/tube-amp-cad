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
    // solver round-off (e.g. 4e-16 V) reads as zero; capacitance and inductance go down to pico
    if (Math.abs(v) < (unit === "F" || unit === "H" ? 1e-15 : 1e-9)) v = 0;
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
  // Loudspeakers: typical drivers (look up your own driver's datasheet for exact values)
  // ---------------------------------------------------------------------------
  const SPEAKER_PRESETS = [
    { id: "g12-8", name: "12″ guitar speaker, 8 Ω (typical)", r: 8, re: 6.4, le: 0.5e-3, fs: 80, qms: 5.5, qes: 0.7 },
    { id: "g12-16", name: "12″ guitar speaker, 16 Ω (typical)", r: 16, re: 13.2, le: 1e-3, fs: 80, qms: 5.5, qes: 0.7 },
    { id: "g12-4", name: "12″ guitar speaker, 4 Ω (typical)", r: 4, re: 3.4, le: 0.25e-3, fs: 80, qms: 5.5, qes: 0.65 },
    { id: "g10-8", name: "10″ guitar speaker, 8 Ω (typical)", r: 8, re: 6.0, le: 0.4e-3, fs: 95, qms: 5, qes: 0.65 },
    { id: "hf8-8", name: "8″ full-range hi-fi, 8 Ω (typical)", r: 8, re: 6.2, le: 0.25e-3, fs: 50, qms: 3.5, qes: 0.45 },
    { id: "w10-8", name: "10″ hi-fi woofer, 8 Ω (typical)", r: 8, re: 5.8, le: 1.2e-3, fs: 30, qms: 4, qes: 0.4 },
    // headphones: dynamic drivers, a small impedance peak at their resonance (the impedance
    // plots of typical models: 32 Ω portable, 250 Ω and 300 Ω studio / hi-fi, 600 Ω vintage)
    { id: "hp32", name: "Headphones, 32 Ω (portable, closed)", r: 32, re: 30, le: 20e-6, fs: 100, qms: 2, qes: 6 },
    { id: "hp250", name: "Headphones, 250 Ω (studio, closed)", r: 250, re: 240, le: 0.3e-3, fs: 80, qms: 1.5, qes: 3.2 },
    { id: "hp300", name: "Headphones, 300 Ω (hi-fi, open)", r: 300, re: 300, le: 0.5e-3, fs: 95, qms: 2, qes: 2.7 },
    { id: "hp600", name: "Headphones, 600 Ω (vintage studio)", r: 600, re: 580, le: 1e-3, fs: 80, qms: 1.5, qes: 4.5 }
  ];
  /** The electrical equivalent of a Thiele–Small driver: Re, Le in series, then Res ‖ Lces ‖ Ces */
  function speakerTS(p) {
    const re = Math.max(+p.re || 0.1, 0.05), fs = Math.max(+p.fs || 50, 1), qes = Math.max(+p.qes || 0.5, 0.01), qms = Math.max(+p.qms || 5, 0.01), w = 2 * Math.PI * fs;
    return { re, le: Math.max(+p.le || 0, 0), res: re * qms / qes, lces: re / (w * qes), ces: qes / (w * re) };
  }
  /** Impedance of a speaker at f: [|Z|, phase in degrees] */
  function speakerZ(p, f) {
    if (p.model !== "ts") return [Math.max(p.r, 0.1), 0];
    const m = speakerTS(p), w = 2 * Math.PI * f;
    // motional admittance Y = 1/Res + 1/(jωL) + jωC
    const yr = 1 / m.res, yi = w * m.ces - 1 / (w * m.lces), d = yr * yr + yi * yi;
    const zr = m.re + yr / d, zi = w * m.le - yi / d;
    return [Math.hypot(zr, zi), Math.atan2(zi, zr) * 180 / Math.PI];
  }

  // ---------------------------------------------------------------------------
  // Tube catalog from the shared database
  // ---------------------------------------------------------------------------
  function tubeByName(name) {
    return (root.TUBE_DATABASE || []).find(t => t.commonName === name) || null;
  }
  // A tube's cathode warm-up for the power-on transient (sim-engine.js cathodeWarm): the time
  // constant tau (s) of its cathode's temperature, typical for its heater rather than from its
  // datasheet: a directly heated filament in a second or two, an indirectly heated cathode in
  // 5 to 10 s, slower with a bigger heater (a GZ34's or EL34's against a 12AX7's). emit: the
  // emission of the hot cathode (A), 12 times its rated cathode (or rectified) current; peak: the
  // rated peak current per anode (A), the handbook's or about 3 times the rated DC current.
  function tubeWarmup(t) {
    if (!t) return null;
    const ih = +t.ih || 0.3, dh = !!t.directlyHeated, ik = (+t.ikMax > 0 ? +t.ikMax : 50) / 1000;
    const tau = dh ? Math.min(2, Math.max(1, 0.8 + 0.25 * ih)) : Math.min(10, Math.max(5, 5 + 3 * ih));
    const bookPk = t.book && t.book.limits && +t.book.limits.i_peak_ma;
    return { tau: Math.round(tau * 10) / 10, emit: 12 * ik, rated: ik, peak: bookPk > 0 ? bookPk / 1000 : 3 * ik, peakFromBook: bookPk > 0, directly: dh };
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
  // what the 125SE drawings leave out: the leakage that puts 15 kHz 1 dB down from a 5 kΩ source into
  // 5 kΩ (optDerive.llk), and a typical winding capacitance
  const SE125 = { llk: 54e-3, cw: 200e-12 };
  const OUTPUT_TX = {};
  Object.entries(HAMMOND_SE).forEach(([k, [w, ma, rp, lp, ...rs]]) => {
    OUTPUT_TX[k] = { name: "Hammond " + k, w, ma, rp, lp, rs: { ORG: rs[0] / 1000, GRN: rs[1] / 1000, YEL: rs[2] / 1000, WHT: rs[3] / 1000 } };
  });
  const POWER_TX = {};
  Object.entries(HAMMOND).forEach(([k, [v, ma, nlv, nlvBias, iex, rp1, rp2, rhv, heaters]]) => {
    POWER_TX[k] = { name: "Hammond " + k, ma, rated: `${v}-0-${v} V ${ma} mA`, nlv: nlv / 2, nlvBias, vRef: 120, iex: iex / 1000, rp1, rp2, rHalf: rhv / 2, heaters,
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
  // the lit LEDs' colours (r,g,b)
  const LED_GLOW = { red: "255,69,58", yellow: "255,214,10", green: "48,209,88", blue: "64,156,255" };
  // the glow of a neon (orange), a gas regulator (violet) and a magic eye's target (green)
  const GAS_GLOW = { neon: "255,112,40", gasreg: "190,120,255", eye: "90,255,160" };
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

  // IEC 60617 S00700 / S00701 junction FET with envelope: the channel a solid bar, drain and source
  // leads off its ends, the gate at its middle with the arrow pointing in (N) or out (P)
  function drawJfet(ctx, c, pol) {
    ctx.beginPath(); ctx.arc(3, 0, 19, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
    line(ctx, [-30, 0, -5, 0]);
    ctx.lineWidth = 2.5; line(ctx, [-5, -12, -5, 12]); ctx.lineWidth = 2;
    line(ctx, [-5, -9, 10, -9, 10, -30]);
    line(ctx, [-5, 9, 10, 9, 10, 30]);
    if (pol > 0) arrowHead(ctx, -6, 0, 1, 0, 7, 3.5); else arrowHead(ctx, -20, 0, -1, 0, 7, 3.5);
  }
  // a three-terminal regulator: the box with IN, OUT and ADJ / GND marked at their pins, the
  // marks upright however the part is turned
  function drawReg(ctx, c) {
    const m = REGS[c.params.model] || REGS.LM317, turn = -((c.rot || 0) & 3) * Math.PI / 2;
    ctx.fillStyle = COL.fill; ctx.fillRect(-30, -20, 60, 40); ctx.strokeRect(-30, -20, 60, 40);
    line(ctx, [-40, 0, -30, 0]); line(ctx, [30, 0, 40, 0]); line(ctx, [0, 20, 0, 30]);
    ctx.font = "8px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textBaseline = "middle"; ctx.textAlign = "center";
    [["IN", -21, 0], ["OUT", 19, 0], [m.adj ? "ADJ" : "GND", 0, 12]].forEach(([t, x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(turn); ctx.fillText(t, 0, 0); ctx.restore(); });
  }
  // IEC 60617 S00661 breakdown diode, cathode up, with the reference input (a TL431)
  function drawShunt(ctx) {
    line(ctx, [0, -30, 0, -7]); line(ctx, [0, 7, 0, 30]);
    ctx.beginPath(); ctx.moveTo(-8, 7); ctx.lineTo(0, -7); ctx.lineTo(8, 7); ctx.closePath(); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
    line(ctx, [-8, -7, 8, -7]); line(ctx, [-11, -3, -8, -7]); line(ctx, [8, -7, 11, -11]);
    line(ctx, [-30, 0, -4, 0]);
  }

  // a controlled source: the diamond of a dependent source on the output pins (+ / − for a
  // voltage, the arrow of the current for a current), the control pins on the left, marked + and −
  function drawControlled(ctx, current) {
    line(ctx, [10, -30, 10, -14]); line(ctx, [10, 14, 10, 30]);
    line(ctx, [-30, -20, -16, -20]); line(ctx, [-30, 20, -16, 20]);
    ctx.beginPath(); ctx.moveTo(10, -14); ctx.lineTo(24, 0); ctx.lineTo(10, 14); ctx.lineTo(-4, 0); ctx.closePath(); ctx.stroke();
    if (current) { line(ctx, [10, 8, 10, -6]); line(ctx, [6, -2, 10, -8, 14, -2]); }
    else { line(ctx, [7, -6, 13, -6]); line(ctx, [10, -9, 10, -3]); line(ctx, [7, 6, 13, 6]); }
    ctx.fillStyle = COL.text; ctx.font = "9px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("+", -22, -13); ctx.fillText("−", -22, 13);
    ctx.textBaseline = "alphabetic";
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
    diode(ctx, c) {
      line(ctx, [-20, 0, -7, 0]); line(ctx, [7, 0, 20, 0]);
      ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, 0); ctx.lineTo(-7, 8); ctx.closePath(); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
      line(ctx, [7, -8, 7, 8]);
      // IEC 60617 S00657 Schottky diode: the cathode bar hooked at both ends
      const d = c && c.type === "diode" && DIODES[c.params.model];
      if (d && (d.kind === "schottky" || d.kind === "sic")) { line(ctx, [7, -8, 11, -8, 11, -5]); line(ctx, [7, 8, 3, 8, 3, 5]); }
    },
    bridge(ctx, c) {
      // four diodes on a diamond, all pointing to + (right); the pin marks upright however it is turned
      const turn = -((c && c.rot || 0) & 3) * Math.PI / 2;
      line(ctx, [0, -30, 0, -20]); line(ctx, [0, 20, 0, 30]); line(ctx, [-30, 0, -20, 0]); line(ctx, [20, 0, 30, 0]);
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(20, 0); ctx.lineTo(0, 20); ctx.lineTo(-20, 0); ctx.closePath(); ctx.stroke();
      // a small diode on each side, along the side, anode to cathode toward +
      const dio = (x1, y1, x2, y2) => {
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, ux = (x2 - x1) / Math.hypot(x2 - x1, y2 - y1), uy = (y2 - y1) / Math.hypot(x2 - x1, y2 - y1), px = -uy, py = ux, s = 4;
        ctx.beginPath(); ctx.moveTo(mx - ux * s + px * s, my - uy * s + py * s); ctx.lineTo(mx + ux * s, my + uy * s); ctx.lineTo(mx - ux * s - px * s, my - uy * s - py * s); ctx.closePath(); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
        line(ctx, [mx + ux * s + px * s, my + uy * s + py * s, mx + ux * s - px * s, my + uy * s - py * s]);
      };
      dio(0, -20, 20, 0); dio(0, 20, 20, 0); dio(-20, 0, 0, -20); dio(-20, 0, 0, 20);
      ctx.font = "9px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      [["+", 25, -6], ["−", -25, -6], ["~", 6, -25], ["~", 6, 25]].forEach(([t, x, y]) => { ctx.save(); ctx.translate(x, y); ctx.rotate(turn); ctx.fillText(t, 0, 0); ctx.restore(); });
    },
    zener(ctx) {
      DRAW.diode(ctx);
      // IEC 60617 S00661 breakdown diode: the cathode bar bent at its ends
      line(ctx, [3, -11, 7, -8]); line(ctx, [7, 8, 11, 11]);
    },
    led(ctx, c) {
      // lit by its simulated current (c._lit, 0 to 1, set while the sheet is drawn): the triangle
      // filled with its colour
      const lit = c && c._lit, col = LED_GLOW[c && c.params.color] || LED_GLOW.red;
      DRAW.diode(ctx);
      if (lit > 0) {
        ctx.beginPath(); ctx.moveTo(-7, -8); ctx.lineTo(7, 0); ctx.lineTo(-7, 8); ctx.closePath();
        ctx.fillStyle = `rgba(${col},${(0.25 + 0.75 * lit).toFixed(3)})`; ctx.fill(); ctx.stroke();
      }
      // IEC 60617 S00641 light-emitting diode: two arrows pointing away
      ctx.lineWidth = 1.3;
      [[0, -9], [7, -7]].forEach(([x, y]) => {
        line(ctx, [x, y, x + 7, y - 9]);
        ctx.beginPath(); ctx.moveTo(x + 7, y - 9); ctx.lineTo(x + 2.6, y - 7.2); ctx.lineTo(x + 6, y - 4.6); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      });
    },
    opamp(ctx, c) {
      // IEC 60617 S01240 amplifier: the qualifying triangle and ∞ (an operational amplifier),
      // the inputs marked + and −
      ctx.fillStyle = COL.fill; ctx.fillRect(-30, -30, 60, 60); ctx.strokeRect(-30, -30, 60, 60);
      line(ctx, [-40, -10, -30, -10]); line(ctx, [-40, 10, -30, 10]); line(ctx, [30, 0, 40, 0]); line(ctx, [0, -40, 0, -30]); line(ctx, [0, 30, 0, 40]);
      if ((OPAMPS[c.params.model] || {}).cc === 0) { line(ctx, [-20, -40, -20, -30]); line(ctx, [20, -40, 20, -30]); }
      ctx.save(); ctx.lineWidth = 1.5; line(ctx, [-6, -22, 6, -16, -6, -10, -6, -22]); ctx.restore();
      ctx.font = "12px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("∞", 8, -16); ctx.fillText("−", -26, -10); ctx.fillText("+", -26, 10);
      ctx.font = "8px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("V+", 9, -24); ctx.fillText("V−", 9, 24);
    },
    // a power amplifier IC: the op-amp's box (S01240, a triangle without ∞: a fixed-purpose
    // amplifier), with the extra pins of the LM386 (gain 1, 8; bypass) and the LM3886 (GND, mute)
    chipamp(ctx, c) {
      ctx.fillStyle = COL.fill; ctx.fillRect(-30, -30, 60, 60); ctx.strokeRect(-30, -30, 60, 60);
      line(ctx, [-40, -10, -30, -10]); line(ctx, [-40, 10, -30, 10]); line(ctx, [30, 0, 40, 0]); line(ctx, [0, -40, 0, -30]); line(ctx, [0, 30, 0, 40]);
      const k = c && c.params.model;
      if (k === "LM386") { line(ctx, [-20, -40, -20, -30]); line(ctx, [20, -40, 20, -30]); line(ctx, [20, 30, 20, 40]); }
      if (k === "LM3886") { line(ctx, [-20, 30, -20, 40]); line(ctx, [20, 30, 20, 40]); }
      ctx.save(); ctx.lineWidth = 1.5; line(ctx, [-6, -22, 6, -16, -6, -10, -6, -22]); ctx.restore();
      ctx.font = "12px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("−", -26, -10); ctx.fillText("+", -26, 10);
      ctx.font = "8px ui-monospace, monospace"; ctx.textAlign = "center";
      ctx.fillText("V+", 9, -24);
      if (k === "LM3886") { ctx.fillText("V−", 0, 23); ctx.fillText("GND", -18, 23); ctx.fillText("MUTE", 19, 23); } else ctx.fillText(k === "LM386" ? "GND" : "V−", 9, 24);
      if (k === "LM386") { ctx.fillText("G", -20, -24); ctx.fillText("G", 20, -24); ctx.fillText("BYP", 20, 16); }
      ctx.fillText("PWR", 14, 2);
    },
    npn(ctx, c) { drawBjt(ctx, c, 1); },
    pnp(ctx, c) { drawBjt(ctx, c, -1); },
    nmos(ctx, c) { drawMos(ctx, c, 1); },
    njf(ctx, c) { drawJfet(ctx, c, 1); },
    pjf(ctx, c) { drawJfet(ctx, c, -1); },
    reg: drawReg,
    tl431: drawShunt,
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
    // an on–off contact (IEC 60617 S00227 make contact): a toggle's lever, or a push button's
    // actuator (S00253) over a contact that makes (NO) or breaks (NC) as it is pushed
    spst(ctx, c) {
      const shut = (c.params.pos === "on") !== (c.params.kind === "nc");
      line(ctx, [-30, 0, -12, 0]); line(ctx, [12, 0, 30, 0]);
      if (c.params.kind === "toggle") { line(ctx, [-12, 0, 12, shut ? -2 : -11]); line(ctx, [12, 0, 12, -4]); }
      else {
        const nc = c.params.kind === "nc", y = shut ? (nc ? 0 : -1.5) : (nc ? -10 : -7), yb = nc ? (c.params.pos === "on" ? -10 : -3) : (c.params.pos === "on" ? -3 : -10);
        line(ctx, [-12, y, 12, y]); line(ctx, [-12, 0, -12, y]); line(ctx, [12, 0, 12, nc ? 4 : y]);
        if (nc) line(ctx, [12, 4, 12, 0]);
        ctx.save(); ctx.setLineDash([2, 2]); line(ctx, [0, y, 0, yb - 4]); ctx.restore(); line(ctx, [-5, yb - 4, 5, yb - 4]); line(ctx, [-5, yb - 4, -5, yb - 6]); line(ctx, [5, yb - 4, 5, yb - 6]);
      }
    },
    // a rotary selector: the wiper from the common to the way it is set to, each way a contact on an arc
    rotary(ctx, c) {
      const n = rotaryWays(c), on = Math.min(Math.max(Math.round(+c.params.pos) || 1, 1), n);
      line(ctx, [-30, 0, -14, 0]);
      ctx.beginPath(); ctx.arc(-14, 0, 2.5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
      for (let k = 1; k <= n; k++) {
        const y = 10 * (2 * k - n - 1);
        line(ctx, [8, y, 30, y]); ctx.beginPath(); ctx.arc(8, y, 1.8, 0, Math.PI * 2); ctx.stroke();
        if (k === on) { ctx.save(); ctx.lineWidth = 2.4; line(ctx, [-14, 0, 6, y]); ctx.restore(); }
      }
      ctx.font = "7px ui-monospace, monospace"; ctx.fillStyle = COL.value; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      for (let k = 1; k <= n; k++) ctx.fillText(String(k), 18, 10 * (2 * k - n - 1) - 5);
      ctx.textBaseline = "alphabetic";
    },
    // a relay (IEC 60617 S00305 coil, S00229 change-over contacts) with the contacts linked to the
    // coil by a dashed line; drawn at rest, or pulled in when the simulation has it so (c._on)
    relay(ctx, c) {
      const m = RELAYS[c.params.model] || RELAYS["G5LE-1"], on = !!(c && c._on);
      line(ctx, [-20, -30, -20, -10]); line(ctx, [-20, 10, -20, 30]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-28, -10, 16, 20); ctx.strokeRect(-28, -10, 16, 20);
      for (let k = 1; k <= m.poles; k++) {
        const x = 30 * k - 10;
        line(ctx, [x, 30, x, 10]); line(ctx, [x - 10, -30, x - 10, -10]); line(ctx, [x + 10, -30, x + 10, -10]);
        line(ctx, [x - 10, -10, x - 6, -10]);
        line(ctx, [x, 10, on ? x + 10 : x - 7, on ? -9 : -9]);
      }
      ctx.save(); ctx.setLineDash([3, 3]); ctx.lineWidth = 1; line(ctx, [-12, 0, 30 * m.poles - 10 + (on ? 5 : -3), 0]); ctx.restore();
    },
    // a vactrol (IEC 60617 S00658 optocoupler): the LED on the left, the photoresistor on the right,
    // light arrows between them, in one case; the LED fills with its colour by its current (c._lit)
    vactrol(ctx, c) {
      ctx.save(); ctx.lineWidth = 1; ctx.strokeRect(-24, -22, 48, 44); ctx.restore();
      line(ctx, [-30, -10, -14, -10, -14, -6]); line(ctx, [-30, 10, -14, 10, -14, 6]);
      const lit = c && c._lit;
      ctx.beginPath(); ctx.moveTo(-20, -6); ctx.lineTo(-8, -6); ctx.lineTo(-14, 5); ctx.closePath();
      if (lit > 0) { ctx.fillStyle = `rgba(${LED_GLOW.red},${(0.25 + 0.75 * lit).toFixed(3)})`; ctx.fill(); }
      ctx.stroke(); line(ctx, [-20, 5, -8, 5]);
      line(ctx, [30, -10, 14, -10, 14, -9]); line(ctx, [30, 10, 14, 10, 14, 9]);
      ctx.fillStyle = COL.fill; ctx.fillRect(10, -9, 8, 18); ctx.strokeRect(10, -9, 8, 18);
      ctx.lineWidth = 1.2;
      [-4, 3].forEach(y => { line(ctx, [-5, y, 6, y]); arrowHead(ctx, 8, y, 1, 0, 4, 2); });
    },
    // a guitar pickup: the bobbin with its six pole pieces, a coil winding round it
    pickup(ctx) {
      line(ctx, [0, -30, 0, -16]); line(ctx, [0, 16, 0, 30]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-9, -16, 18, 32); ctx.strokeRect(-9, -16, 18, 32);
      ctx.fillStyle = ctx.strokeStyle;
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(0, -12.5 + k * 5, 1.4, 0, Math.PI * 2); ctx.fill(); }
      ctx.lineWidth = 1; line(ctx, [-12, -10, 12, -8]); line(ctx, [-12, 8, 12, 10]);
    },
    // a phono cartridge: the record (a disc with its label) and the stylus on it
    phono(ctx) {
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; line(ctx, [16, -16, 6, 6]); line(ctx, [6, 6, 4, 9]);
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
        ctx.fillStyle = COL.text;
        if (tw > room && h * room / tw < 2.2 * MM) {
          // too long for one line at a readable size: two or three lines, words kept whole
          const words = String(val).split(/\s+/), at = h / 2.2 / MM;
          let lines = [String(val)];
          for (const n of [2, 3]) {
            const per = tw / n; lines = [""];
            words.forEach(wd => { const cur = lines[lines.length - 1]; if (cur && ctx.measureText(cur + " " + wd).width > per * 1.15 && lines.length < n) lines.push(wd); else lines[lines.length - 1] = cur ? cur + " " + wd : wd; });
            if (Math.max(...lines.map(l => ctx.measureText(l).width)) * at <= room * 1.0001 || n === 3) break;
          }
          const lh = Math.min(h, 5.2 * MM / lines.length, h * room / Math.max(...lines.map(l => ctx.measureText(l).width)));
          ctx.font = `${lh}px ui-monospace, monospace`;
          lines.forEach((l, i) => ctx.fillText(l, X(x + 1), Y(y + 3.3) + i * lh));
          return;
        }
        if (tw > room) { h = Math.max(1.6 * MM, h * room / tw); ctx.font = `${h}px ui-monospace, monospace`; }
        ctx.fillText(val || "", X(x + 1), Y(y + 3.4 + ((size || 3.5) - h / MM) / 2));
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
    // jack socket: the sleeve's long contact, the tip's spring (and the ring's), the switch contact
    // under the tip that rests on it until a plug goes in; the body on the plug's side
    jack(ctx, c) {
      const j = JACKS[c.params.kind] || JACKS["TS-SW"];
      ctx.fillStyle = COL.fill; ctx.fillRect(4, -28, 10, 56); ctx.strokeRect(4, -28, 10, 56);
      line(ctx, [-30, 20, 4, 20]);
      line(ctx, [-30, -20, -4, -20, 0, -24, 4, -20]);
      if (j.pins.includes("R")) line(ctx, [-30, 0, -4, 0, 0, -4, 4, 0]);
      if (j.pins.includes("SW")) {
        const shut = c.params.plug !== "in";
        line(ctx, [-30, -10, -10, -10, -10, shut ? -19 : -14]);
        if (!shut) { ctx.fillStyle = COL.value; ctx.font = "7px ui-monospace, monospace"; ctx.textAlign = "center"; ctx.fillText("plug", 9, 34); }
      }
    },
    // IEC inlet: a box with the three contacts, protective earth marked
    iec(ctx) {
      ctx.fillStyle = COL.fill; ctx.fillRect(-12, -28, 30, 56); ctx.strokeRect(-12, -28, 30, 56);
      line(ctx, [-30, -20, -12, -20]); line(ctx, [-30, 0, -12, 0]); line(ctx, [-30, 20, -12, 20]);
      ctx.fillStyle = COL.value; ctx.font = "8px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText("L", -8, -20); ctx.fillText("N", -8, 0);
      line(ctx, [-8, 20, -2, 20]); line(ctx, [-2, 15, -2, 25]); line(ctx, [0, 17, 0, 23]); line(ctx, [2, 19, 2, 21]);
      ctx.textBaseline = "alphabetic";
    },
    // terminal block: a terminal circle per way (IEC 60617 S00017), the outside wire's stub beyond it
    terminal(ctx, c) {
      const n = LIB.terminal.pins(c).length;
      ctx.strokeRect(-8, -8, 12, 20 * (n - 1) + 16);
      for (let i = 0; i < n; i++) { line(ctx, [-30, i * 20, -5, i * 20]); ctx.beginPath(); ctx.arc(-2, i * 20, 3, 0, Math.PI * 2); ctx.stroke(); line(ctx, [1, i * 20, 12, i * 20]); }
    },
    header(ctx, c) {
      const n = LIB.header.pins(c).length;
      ctx.strokeRect(-8, -8, 12, 20 * (n - 1) + 16);
      for (let i = 0; i < n; i++) { line(ctx, [-30, i * 20, -5, i * 20]); ctx.fillStyle = ctx.strokeStyle; ctx.fillRect(-5, i * 20 - 2.5, 6, 5); line(ctx, [1, i * 20, 12, i * 20]); }
    },
    faston(ctx) {
      line(ctx, [-20, 0, -6, 0]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-6, -4, 16, 8); ctx.strokeRect(-6, -4, 16, 8);
      ctx.beginPath(); ctx.arc(4, 0, 1.5, 0, Math.PI * 2); ctx.stroke();
    },
    // IEC 60617 S00362 fuse: the body with the fuse wire through it
    fuse(ctx) {
      line(ctx, [-30, 0, -15, 0]); line(ctx, [15, 0, 30, 0]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-15, -6, 30, 12); ctx.strokeRect(-15, -6, 30, 12);
      line(ctx, [-15, 0, 15, 0]);
    },
    // IEC 60617 S00566 resistor with inherent variability: the slanted line with its foot, "−t°"
    // (an NTC thermistor) or "U" (a voltage-dependent resistor)
    ntc(ctx) {
      DRAW.resistor(ctx, { params: {} });
      line(ctx, [-18, 10, -12, 10, 12, -10]);
      ctx.fillStyle = COL.value; ctx.font = "8px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("−t°", -6, 18);
    },
    mov(ctx) {
      DRAW.resistor(ctx, { params: {} });
      line(ctx, [-18, 10, -12, 10, 12, -10]);
      ctx.fillStyle = COL.value; ctx.font = "8px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillText("U", -2, 18);
    },
    // power rail (a one-pin supply, the usual VCC arrow): a stem with an arrowhead;
    // the rail's name and voltage are drawn upright by the app beyond the tip
    rail(ctx) {
      line(ctx, [0, 0, 0, -16]); line(ctx, [-5, -10, 0, -16, 5, -10]);
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
    timer555(ctx) {
      // an IC box (IEC 60617 binary logic element outline) with the pin functions inside and the
      // pin numbers on the leads
      ctx.fillStyle = COL.fill; ctx.fillRect(-30, -40, 60, 80); ctx.strokeRect(-30, -40, 60, 80);
      line(ctx, [-20, -50, -20, -40]); line(ctx, [20, -50, 20, -40]); line(ctx, [-20, 40, -20, 50]); line(ctx, [20, 40, 20, 50]);
      line(ctx, [-50, -20, -30, -20]); line(ctx, [-50, 0, -30, 0]); line(ctx, [-50, 20, -30, 20]); line(ctx, [30, 0, 50, 0]);
      ctx.fillStyle = COL.value; ctx.font = "7px ui-monospace, monospace"; ctx.textBaseline = "middle";
      ctx.textAlign = "center"; ctx.fillText("RST", -20, -34); ctx.fillText("VCC", 20, -34); ctx.fillText("CV", -20, 34); ctx.fillText("GND", 20, 34);
      ctx.textAlign = "left"; ctx.fillText("DIS", -27, -20); ctx.fillText("THR", -27, 0); ctx.fillText("TRG", -27, 20);
      ctx.textAlign = "right"; ctx.fillText("OUT", 27, 0);
      ctx.fillStyle = COL.text;
      ctx.textAlign = "left"; ctx.fillText("4", -17, -46); ctx.fillText("8", 23, -46); ctx.fillText("5", -17, 46); ctx.fillText("1", 23, 46);
      ctx.textAlign = "center"; ctx.fillText("7", -40, -25); ctx.fillText("6", -40, -5); ctx.fillText("2", -40, 15); ctx.fillText("3", 40, -5);
      ctx.font = "bold 9px ui-monospace, monospace"; ctx.fillText("555", 8, -14);
      ctx.textBaseline = "alphabetic";
    },
    isrc(ctx) {
      // a circle with the arrow of the current's direction, from the - pin to the + pin
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
      line(ctx, [0, 8, 0, -6]); line(ctx, [-4, -2, 0, -8, 4, -2]);
    },
    vcvs(ctx) { drawControlled(ctx, false); },
    vccs(ctx) { drawControlled(ctx, true); },
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
    itx(ctx, c) {
      DRAW.opt_se(ctx);
      if (c && c.params.ct === "yes") line(ctx, [12, 0, 40, 0]);
    },
    gasreg(ctx, c) {
      // a cold-cathode tube: the envelope with the dot of its gas fill, the anode plate above,
      // the cold cathode (an open cylinder) below; lit by its current (c._lit), the envelope glows violet
      const lit = c && c._lit;
      ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2);
      if (lit > 0) { ctx.fillStyle = `rgba(${GAS_GLOW.gasreg},${(0.2 + 0.6 * lit).toFixed(3)})`; ctx.fill(); }
      ctx.stroke();
      line(ctx, [0, -30, 0, -8]); line(ctx, [-8, -8, 8, -8]);
      line(ctx, [0, 30, 0, 12]); ctx.beginPath(); ctx.arc(0, 6, 6, 0, Math.PI); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(11, 0, 2.2, 0, Math.PI * 2); ctx.fill();
    },
    // a neon lamp (IEC 60617 S01102 glow lamp): the envelope, two electrodes facing each other and
    // the dot of the gas fill; lit by its current (c._lit) it glows orange round the electrodes
    neon(ctx, c) {
      const lit = c && c._lit;
      line(ctx, [-20, 0, -5, 0]); line(ctx, [20, 0, 5, 0]);
      ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2);
      if (lit > 0) { ctx.fillStyle = `rgba(${GAS_GLOW.neon},${(0.25 + 0.75 * lit).toFixed(3)})`; ctx.fill(); }
      ctx.stroke();
      ctx.save(); ctx.lineWidth = 2.2; line(ctx, [-5, -6, -5, 6]); line(ctx, [5, -6, 5, 6]); ctx.restore();
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(0, 7, 1.6, 0, Math.PI * 2); ctx.fill();
    },
    // a magic eye: in its envelope the target, a disc whose green fan lights round the cathode's
    // cap but for the shadow (opening upwards, 90° wide at most), and below it the triode: plate,
    // grid (dashed) and cathode. c._eye { shadow 0–1, glow 0–1 } is set while the sheet is drawn
    // from the simulation; without one the fan is drawn as an outline, its shadow at 90°
    eye(ctx, c) {
      const e = c && c._eye, cx = 0, cy = -9, r = 15;
      ctx.beginPath(); ctx.arc(0, 2, 28, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
      line(ctx, [0, -40, 0, -26]); line(ctx, [0, 40, 0, 28]); line(ctx, [-8, 28, 8, 28]);
      line(ctx, [-30, 20, -10, 20]); ctx.save(); ctx.setLineDash([3, 2.5]); line(ctx, [-10, 20, 10, 20]); ctx.restore();
      line(ctx, [-8, 10, 8, 10]); line(ctx, [8, 10, 30, 10]);
      const sh = (e ? e.shadow : 1) * Math.PI / 2, a0 = -Math.PI / 2 + sh / 2, a1 = 3 * Math.PI / 2 - sh / 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
      if (e && e.glow > 0) { ctx.fillStyle = `rgba(${GAS_GLOW.eye},${(0.25 + 0.75 * e.glow).toFixed(3)})`; ctx.fill(); }
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fillStyle = COL.fill; ctx.fill(); ctx.stroke();
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
        if (t && t.pinout && t.pinout.some(p => /^F/.test(p.sym)) && !t.pinout.some(p => /^K/.test(p.sym))) {
          // directly heated (IEC 60617): the filament is the cathode, its two legs joined at the K terminal
          line(ctx, [0, 50, 0, 44, -8, 44, -8, 36, 0, 26, 8, 36, 8, 44, 0, 44]);
          return;
        }
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
      if (c._hot > 0) { ctx.save(); ctx.fillStyle = `rgba(255,${Math.round(60 + 60 * c._hot)},40,${(0.55 + 0.45 * c._hot).toFixed(3)})`; ctx.shadowColor = "rgba(255,80,40,0.9)"; ctx.shadowBlur = 8 + 10 * c._hot; ctx.fillRect(-13, -25, 26, 6); ctx.restore(); }
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
  // 2N2907A; the 2N3904's BF taken from 416 to 300, as the distributed model
  // read 360 at 10 mA, over the datasheet's 300 maximum); the others are set to
  // the datasheet's typical gain at the usual operating current. MOSFETs: threshold vto (V; negative for depletion
  // N-channel parts) and kp (A/V²) through two points of the datasheet's typical
  // transfer curve at 25 °C (drain current against VGS), so the part conducts at
  // the gate voltage a real one does (the small ones, with no curve: vto at the
  // middle of the VGS(th) range, kp from gfs at the test current, gfs²/2Id;
  // depletion parts from Idss). Ratings:
  // v (Vceo / Vds max), i (A), p (W at 25 °C case for power parts, free air else).
  // cbe/cbc, cgs/cgd: junction and gate capacitances (F) for the transient: cbc the
  // datasheet's Cob, cgd its Crss and cgs Ciss − Crss.
  // ---------------------------------------------------------------------------
  const pf = 1e-12;
  // base-emitter (diffusion) capacitance of a germanium part: gm / 2π fT at the working current ic
  const geCbe = (ft, ic) => ic / 0.025852 / (2 * Math.PI * ft);
  const BJTS = {
    "2N2222A": { pol: 1, is: 14.34e-15, bf: 255.9, br: 6.092, vaf: 74.03, ikf: 0.2847, cbe: 25 * pf, cbc: 8 * pf, v: 40, i: 0.8, p: 0.5, pkg: "TO-18", use: "general purpose" },
    "2N3904": { pol: 1, is: 6.734e-15, bf: 300, br: 0.7371, vaf: 74.03, ikf: 0.06678, cbe: 8 * pf, cbc: 4 * pf, v: 40, i: 0.2, p: 0.625, pkg: "TO-92", use: "small signal" },
    "BC107": { pol: 1, is: 7e-15, bf: 200, br: 7.5, vaf: 63, ikf: 0.1, cbe: 9 * pf, cbc: 4.5 * pf, v: 45, i: 0.2, p: 0.3, pkg: "TO-18", use: "small signal (vintage)" },
    "BC547B": { pol: 1, is: 7e-15, bf: 290, br: 7.5, vaf: 63, ikf: 0.1, cbe: 9 * pf, cbc: 4.5 * pf, v: 45, i: 0.1, p: 0.625, pkg: "TO-92", use: "small signal, low noise" },
    // the 65 V and the high-gain (C group) members of the family: same die, other selection
    "BC546B": { pol: 1, is: 7e-15, bf: 290, br: 7.5, vaf: 63, ikf: 0.1, cbe: 9 * pf, cbc: 4.5 * pf, v: 65, i: 0.1, p: 0.625, pkg: "TO-92", use: "small signal, 65 V (input pairs on ±30 V rails)" },
    "BC549C": { pol: 1, is: 7e-15, bf: 520, br: 7.5, vaf: 63, ikf: 0.1, cbe: 9 * pf, cbc: 4.5 * pf, v: 30, i: 0.1, p: 0.5, pkg: "TO-92", use: "small signal, low noise, high gain" },
    "BD139": { pol: 1, is: 1.3e-13, bf: 150, br: 5, vaf: 100, ikf: 1, rb: 2.52, re: 0.046, cbe: 100 * pf, cbc: 30 * pf, v: 80, i: 1.5, p: 12.5, pkg: "TO-126", use: "driver, regulator pass" },
    "MPSA42": { pol: 1, is: 1e-14, bf: 120, br: 5, vaf: 200, ikf: 0.1, cbe: 50 * pf, cbc: 3 * pf, v: 300, i: 0.5, p: 0.625, pkg: "TO-92", use: "high voltage, CCS / cascode" },
    "MJE340": { pol: 1, is: 1e-13, bf: 100, br: 4, vaf: 200, ikf: 0.3, cbe: 100 * pf, cbc: 15 * pf, v: 300, i: 0.5, p: 20, pkg: "TO-126", use: "high voltage, CCS / follower" },
    "2N2907A": { pol: -1, is: 650.6e-18, bf: 231.7, br: 3.563, vaf: 115.7, ikf: 1.079, cbe: 30 * pf, cbc: 8 * pf, v: 60, i: 0.6, p: 0.4, pkg: "TO-18", use: "general purpose" },
    "2N3906": { pol: -1, is: 1.41e-15, bf: 180.7, br: 4.977, vaf: 18.7, ikf: 0.08, cbe: 10 * pf, cbc: 4.5 * pf, v: 40, i: 0.2, p: 0.625, pkg: "TO-92", use: "small signal" },
    "BC177": { pol: -1, is: 1e-14, bf: 150, br: 10, vaf: 50, ikf: 0.1, cbe: 10 * pf, cbc: 6 * pf, v: 45, i: 0.2, p: 0.3, pkg: "TO-18", use: "small signal (vintage)" },
    "BC557B": { pol: -1, is: 1e-14, bf: 250, br: 10, vaf: 50, ikf: 0.1, cbe: 10 * pf, cbc: 6 * pf, v: 45, i: 0.1, p: 0.625, pkg: "TO-92", use: "small signal, low noise" },
    "BC556B": { pol: -1, is: 1e-14, bf: 250, br: 10, vaf: 50, ikf: 0.1, cbe: 10 * pf, cbc: 6 * pf, v: 65, i: 0.1, p: 0.625, pkg: "TO-92", use: "small signal, 65 V" },
    "BC559C": { pol: -1, is: 1e-14, bf: 500, br: 10, vaf: 50, ikf: 0.1, cbe: 10 * pf, cbc: 2.5 * pf, v: 30, i: 0.1, p: 0.625, pkg: "TO-92", use: "small signal, low noise, high gain" },
    "BD140": { pol: -1, is: 2.3e-13, bf: 150, br: 5, vaf: 100, ikf: 1, re: 0.067, cbe: 100 * pf, cbc: 40 * pf, v: 80, i: 1.5, p: 12.5, pkg: "TO-126", use: "driver, regulator pass" },
    "MPSA92": { pol: -1, is: 1e-14, bf: 100, br: 5, vaf: 200, ikf: 0.1, cbe: 50 * pf, cbc: 6 * pf, v: 300, i: 0.5, p: 0.625, pkg: "TO-92", use: "high voltage, CCS / cascode" },
    "MJE350": { pol: -1, is: 1e-13, bf: 100, br: 4, vaf: 200, ikf: 0.3, cbe: 100 * pf, cbc: 20 * pf, v: 300, i: 0.5, p: 20, pkg: "TO-126", use: "high voltage, CCS / follower" },
    // drivers and power output, as complementary pairs. Fitted to the datasheets: BF the mid-current
    // hFE, IKF where it has fallen to about half, IS from VBE(on), CBC the output capacitance Cob.
    // rb, re (Ω): base and emitter resistance, so VBE rises with the current as a real part's does.
    // IS, RB and RE are fitted (least squares) to the datasheet's typical VBE(on) curve at 25 °C
    // (VBE(sat) at IC/IB = 10 where that is all it gives: MJ15003/MJ15004, 2SB649A); the model
    // follows it within 0.03 V for most parts, 0.07 V at worst (MJL21194's curve has a step at
    // 1.5 A). A large RB stands for the base drive the gain's fall at high current asks for.
    // TIP41C / TIP42C, MJL21194 / MJL21193: BF and IKF follow the typical hFE curve (TIP41C 95 at
    // 0.3 A, 70 at 1 A, 40 at 3 A; MJL21193 85 at 0.1 A falling to 45 at 5 A).
    "2SD669A": { pol: 1, is: 2.8e-12, bf: 160, br: 5, vaf: 150, ikf: 0.8, cbe: 150 * pf, cbc: 14 * pf, v: 160, i: 1.5, p: 20, pkg: "TO-126", use: "driver, VAS" },
    "2SC4793": { pol: 1, is: 9.5e-13, bf: 200, br: 5, vaf: 150, ikf: 0.5, re: 0.008, cbe: 150 * pf, cbc: 20 * pf, v: 230, i: 1, p: 20, pkg: "TO-220F", use: "driver, VAS" },
    "MJE15032": { pol: 1, is: 9.4e-13, bf: 100, br: 4, vaf: 150, ikf: 2, rb: 0.04, re: 0.016, cbe: 400 * pf, cbc: 100 * pf, v: 250, i: 8, p: 50, pkg: "TO-220", use: "driver, small power output" },
    // TIP35C / TIP36C: BF and IKF follow the typical hFE curve (NPN 250 at 0.2 A, 110 at 5 A, 45 at
    // 15 A; PNP 200 at 1 A, 92 at 5 A, 38 at 15 A); the sheet gives no VBE curve, only 2 V max at 15 A
    "TIP35C": { pol: 1, is: 3e-12, bf: 264, br: 4, vaf: 100, ikf: 3, rb: 0.5, re: 0.02, cbe: 2000 * pf, cbc: 500 * pf, v: 100, i: 25, p: 125, pkg: "TO-247", use: "power output, class A" },
    // MJL4281A / MJL4302A: fitted to the typical VBE(on) and hFE curves at 5 V (onsemi MJL4281A/D)
    "MJL4281A": { pol: 1, is: 1.0125e-11, bf: 165, br: 4, vaf: 100, ikf: 6, rb: 1, re: 0.02, cbe: 1500 * pf, cbc: 600 * pf, v: 350, i: 15, p: 230, pkg: "TO-264", use: "power output, 350 V, high gain" },
    "TIP41C": { pol: 1, is: 2.1e-12, bf: 115, br: 4, vaf: 100, ikf: 1.6, rb: 1.07, re: 0.055, cbe: 500 * pf, cbc: 100 * pf, v: 100, i: 6, p: 65, pkg: "TO-220", use: "power output, regulator" },
    "2SC5200": { pol: 1, is: 2e-12, bf: 110, br: 4, vaf: 100, ikf: 5, rb: 0.14, re: 0.018, cbe: 1500 * pf, cbc: 200 * pf, v: 230, i: 15, p: 150, pkg: "TO-264", use: "power output (Toshiba)" },
    "MJL3281A": { pol: 1, is: 2.7e-12, bf: 115, br: 4, vaf: 100, ikf: 20, rb: 3, cbe: 1500 * pf, cbc: 400 * pf, v: 260, i: 15, p: 200, pkg: "TO-264", use: "power output, linear hFE" },
    "MJL21194": { pol: 1, is: 1.7e-12, bf: 65, br: 3, vaf: 100, ikf: 20, re: 0.067, cbe: 2000 * pf, cbc: 500 * pf, v: 250, i: 16, p: 200, pkg: "TO-264", use: "power output" },
    "MJ15003": { pol: 1, is: 9.4e-13, bf: 70, br: 3, vaf: 100, ikf: 8, rb: 0.34, cbe: 2000 * pf, cbc: 1000 * pf, v: 140, i: 20, p: 250, pkg: "TO-3", use: "power output (TO-3)" },
    "MJ15024": { pol: 1, is: 1.3e-12, bf: 50, br: 3, vaf: 120, ikf: 5, rb: 0.2, re: 0.019, cbe: 2000 * pf, cbc: 500 * pf, v: 250, i: 16, p: 250, pkg: "TO-3", use: "power output (TO-3)" },
    "2N3055": { pol: 1, is: 3.9e-12, bf: 50, br: 3, vaf: 50, ikf: 3, rb: 0.81, re: 0.021, cbe: 1500 * pf, cbc: 500 * pf, v: 60, i: 15, p: 115, pkg: "TO-3", use: "power output, regulator (vintage)" },
    "2SB649A": { pol: -1, is: 3.6e-13, bf: 160, br: 5, vaf: 100, ikf: 0.8, re: 0.24, cbe: 150 * pf, cbc: 27 * pf, v: 160, i: 1.5, p: 20, pkg: "TO-126", use: "driver, VAS" },
    "2SA1837": { pol: -1, is: 4.5e-13, bf: 200, br: 5, vaf: 100, ikf: 0.5, rb: 1.17, re: 0.002, cbe: 150 * pf, cbc: 30 * pf, v: 230, i: 1, p: 20, pkg: "TO-220F", use: "driver, VAS" },
    "MJE15033": { pol: -1, is: 7.7e-13, bf: 100, br: 4, vaf: 120, ikf: 2, rb: 0.4, cbe: 400 * pf, cbc: 150 * pf, v: 250, i: 8, p: 50, pkg: "TO-220", use: "driver, small power output" },
    "TIP36C": { pol: -1, is: 3e-12, bf: 220, br: 4, vaf: 80, ikf: 3, rb: 0.5, re: 0.02, cbe: 2000 * pf, cbc: 600 * pf, v: 100, i: 25, p: 125, pkg: "TO-247", use: "power output, class A" },
    "MJL4302A": { pol: -1, is: 5.85e-12, bf: 117, br: 4, vaf: 80, ikf: 12, rb: 1.6, re: 0.02, cbe: 1500 * pf, cbc: 600 * pf, v: 350, i: 15, p: 230, pkg: "TO-264", use: "power output, 350 V, high gain" },
    "TIP42C": { pol: -1, is: 2.1e-12, bf: 115, br: 4, vaf: 80, ikf: 1.6, rb: 1.08, re: 0.055, cbe: 500 * pf, cbc: 150 * pf, v: 100, i: 6, p: 65, pkg: "TO-220", use: "power output, regulator" },
    "2SA1943": { pol: -1, is: 2.3e-12, bf: 110, br: 4, vaf: 80, ikf: 5, rb: 1.52, cbe: 1500 * pf, cbc: 360 * pf, v: 230, i: 15, p: 150, pkg: "TO-264", use: "power output (Toshiba)" },
    "MJL1302A": { pol: -1, is: 4.1e-12, bf: 115, br: 4, vaf: 80, ikf: 12, rb: 2.44, cbe: 1500 * pf, cbc: 600 * pf, v: 260, i: 15, p: 200, pkg: "TO-264", use: "power output, linear hFE" },
    "MJL21193": { pol: -1, is: 2.4e-11, bf: 85, br: 3, vaf: 80, ikf: 4.5, rb: 2.55, cbe: 2000 * pf, cbc: 500 * pf, v: 250, i: 16, p: 200, pkg: "TO-264", use: "power output" },
    "MJ15004": { pol: -1, is: 3.1e-12, bf: 70, br: 3, vaf: 80, ikf: 8, re: 0.059, cbe: 2000 * pf, cbc: 1000 * pf, v: 140, i: 20, p: 250, pkg: "TO-3", use: "power output (TO-3)" },
    "MJ15025": { pol: -1, is: 3.3e-12, bf: 50, br: 3, vaf: 100, ikf: 5, rb: 2.04, cbe: 2000 * pf, cbc: 500 * pf, v: 250, i: 16, p: 250, pkg: "TO-3", use: "power output (TO-3)" },
    "MJ2955": { pol: -1, is: 3e-12, bf: 50, br: 3, vaf: 50, ikf: 3, rb: 0.23, re: 0.094, cbe: 1500 * pf, cbc: 700 * pf, v: 60, i: 15, p: 115, pkg: "TO-3", use: "power output, regulator (vintage)" },
    // germanium, alloy junction. IS sets VBE at about a third of silicon's (0.15–0.25 V at 1 mA
    // for the small ones, 0.3–0.4 V at the rated current for the power ones), and the reverse
    // leakage it brings is of the µA order Ge parts have. BF: the middle of the datasheet's hFE
    // range; IKF where hFE has fallen to about half; VAF low, as in alloy parts. CBE from the
    // transit frequency at a typical working current (gm / 2π fT: 1 mA small-signal, 20 mA the
    // AC1xx output pairs, 0.2–0.3 A the power ones), so the Miller roll-off of the old parts shows
    // in the response. v: the datasheet's VCE max (USSR: Uкэ max), i: IC max, p: Ptot at 25 °C.
    // The USSR parts' gain is the reference books' small-signal h21э (dIC/dIB at the test point);
    // the static IC/IB reads higher by the leakage the base current carries.
    // USSR types are written in Latin letters (MP39B = МП39Б).
    // icbo: typical collector-base leakage at 25 °C (about a third of the datasheet's maximum);
    // it doubles every 10 °C (see bjtAt). The power parts leak the most.
    // USSR
    "MP39B": { ge: 1, icbo: 5e-06, pol: -1, is: 3e-7, bf: 40, br: 5, vaf: 30, ikf: 0.05, cbe: geCbe(0.5e6, 1e-3), cbc: 50 * pf, v: 15, i: 0.02, p: 0.15, pkg: "MP", use: "МП39Б, germanium small signal (USSR)" },
    "MP40A": { ge: 1, icbo: 5e-06, pol: -1, is: 3e-7, bf: 30, br: 5, vaf: 30, ikf: 0.05, cbe: geCbe(1e6, 1e-3), cbc: 50 * pf, v: 30, i: 0.02, p: 0.15, pkg: "MP", use: "МП40А, germanium small signal, 30 V (USSR)" },
    "MP41A": { ge: 1, icbo: 5e-06, pol: -1, is: 3e-7, bf: 70, br: 5, vaf: 30, ikf: 0.05, cbe: geCbe(1e6, 1e-3), cbc: 50 * pf, v: 15, i: 0.02, p: 0.15, pkg: "MP", use: "МП41А, germanium low noise, high gain (USSR)" },
    "MP42B": { ge: 1, icbo: 5e-06, pol: -1, is: 3e-7, bf: 80, br: 5, vaf: 30, ikf: 0.15, cbe: geCbe(1e6, 1e-3), cbc: 50 * pf, v: 15, i: 0.15, p: 0.2, pkg: "MP", use: "МП42Б, germanium switching, fuzz (USSR)" },
    "MP25B": { ge: 1, icbo: 1.5e-05, pol: -1, is: 4e-7, bf: 40, br: 5, vaf: 40, ikf: 0.2, cbe: geCbe(0.5e6, 1e-3), cbc: 20 * pf, v: 40, i: 0.15, p: 0.2, pkg: "MP", use: "МП25Б, germanium 40 V (USSR)" },
    "MP26B": { ge: 1, icbo: 1.5e-05, pol: -1, is: 4e-7, bf: 35, br: 5, vaf: 50, ikf: 0.2, cbe: geCbe(0.5e6, 1e-3), cbc: 15 * pf, v: 70, i: 0.15, p: 0.2, pkg: "MP", use: "МП26Б, germanium 70 V (USSR)" },
    "MP38A": { ge: 1, icbo: 5e-06, pol: 1, is: 3e-7, bf: 65, br: 5, vaf: 30, ikf: 0.05, cbe: geCbe(2e6, 1e-3), cbc: 50 * pf, v: 15, i: 0.02, p: 0.15, pkg: "MP", use: "МП38А, germanium NPN small signal (USSR)" },
    "GT402G": { ge: 1, icbo: 1e-05, pol: -1, is: 5e-7, bf: 100, br: 5, vaf: 40, ikf: 0.6, cbe: geCbe(1e6, 20e-3), cbc: 60 * pf, v: 40, i: 0.5, p: 0.6, pkg: "TO-1", use: "ГТ402Г, germanium driver / output, pairs with GT404G (USSR)" },
    "GT404G": { ge: 1, icbo: 1e-05, pol: 1, is: 5e-7, bf: 100, br: 5, vaf: 40, ikf: 0.6, cbe: geCbe(1e6, 20e-3), cbc: 60 * pf, v: 40, i: 0.5, p: 0.6, pkg: "TO-1", use: "ГТ404Г, germanium driver / output, pairs with GT402G (USSR)" },
    "P213B": { ge: 1, icbo: 0.0003, pol: -1, is: 2e-6, bf: 60, br: 3, vaf: 40, ikf: 3, cbe: geCbe(0.2e6, 0.3), cbc: 800 * pf, v: 45, i: 5, p: 10, pkg: "TO-3", use: "П213Б, germanium power output (USSR)" },
    // Western
    "AC127": { ge: 1, icbo: 3e-06, pol: 1, is: 4e-7, bf: 120, br: 5, vaf: 30, ikf: 0.6, cbe: geCbe(1.5e6, 20e-3), cbc: 60 * pf, v: 12, i: 0.5, p: 0.34, pkg: "TO-1", use: "germanium audio output, pairs with AC128" },
    "AC128": { ge: 1, icbo: 4e-06, pol: -1, is: 5e-7, bf: 95, br: 5, vaf: 30, ikf: 4, cbe: geCbe(1.5e6, 20e-3), cbc: 100 * pf, v: 16, i: 1, p: 0.26, pkg: "TO-1", use: "germanium audio output, Fuzz Face" },
    "AC187": { ge: 1, icbo: 5e-06, pol: 1, is: 5e-7, bf: 200, br: 5, vaf: 30, ikf: 1.2, cbe: geCbe(1e6, 20e-3), cbc: 80 * pf, v: 15, i: 2, p: 0.8, pkg: "TO-1", use: "germanium complementary output, pairs with AC188" },
    "AC188": { ge: 1, icbo: 5e-06, pol: -1, is: 5e-7, bf: 200, br: 5, vaf: 30, ikf: 1.2, cbe: geCbe(1e6, 20e-3), cbc: 100 * pf, v: 15, i: 2, p: 0.8, pkg: "TO-1", use: "germanium complementary output, pairs with AC187" },
    "OC71": { ge: 1, icbo: 5e-06, pol: -1, is: 2e-7, bf: 50, br: 5, vaf: 20, ikf: 0.03, cbe: geCbe(0.4e6, 1e-3), cbc: 40 * pf, v: 20, i: 0.01, p: 0.125, pkg: "glass", use: "germanium small signal (Mullard: black glass, inline leads, red dot at C), Tone Bender" },
    "NKT275": { ge: 1, icbo: 5e-06, pol: -1, is: 3e-7, bf: 100, br: 5, vaf: 25, ikf: 0.05, cbe: geCbe(1e6, 1e-3), cbc: 30 * pf, v: 18, i: 0.1, p: 0.15, pkg: "TO-1", use: "germanium small signal (Newmarket), Fuzz Face" },
    "2N404": { ge: 1, icbo: 2e-06, pol: -1, is: 2e-7, bf: 60, br: 5, vaf: 40, ikf: 0.1, cbe: geCbe(4e6, 1e-3), cbc: 20 * pf, v: 24, i: 0.1, p: 0.15, pkg: "TO-5", use: "germanium general purpose (RCA), Tone Bender" },
    "AD149": { ge: 1, icbo: 0.0001, pol: -1, is: 1e-6, bf: 70, br: 3, vaf: 40, ikf: 3, cbe: geCbe(0.3e6, 0.2), cbc: 600 * pf, v: 30, i: 3.5, p: 32, pkg: "TO-3", use: "germanium power output (Philips)" },
    "AD161": { ge: 1, icbo: 1e-05, pol: 1, is: 3e-5, bf: 150, br: 4, vaf: 40, ikf: 1.5, cbe: geCbe(1.5e6, 0.2), cbc: 150 * pf, v: 20, i: 3, p: 4, pkg: "SOT-9", use: "germanium complementary output, pairs with AD162" },
    "AD162": { ge: 1, icbo: 1e-05, pol: -1, is: 3e-5, bf: 150, br: 4, vaf: 40, ikf: 1.5, cbe: geCbe(1.5e6, 0.2), cbc: 200 * pf, v: 20, i: 3, p: 6, pkg: "SOT-9", use: "germanium complementary output, pairs with AD161" }
  };
  const MOSFETS = {
    "2N7000": { pol: 1, vto: 2.1, kp: 0.26, lambda: 0.01, cgs: 20 * pf, cgd: 5 * pf, v: 60, i: 0.2, p: 0.4, pkg: "TO-92", use: "small signal switch" },
    "BS170": { pol: 1, vto: 2.1, kp: 0.1, lambda: 0.01, cgs: 20 * pf, cgd: 5 * pf, v: 60, i: 0.5, p: 0.83, pkg: "TO-92", use: "small signal switch" },
    "IRF510": { pol: 1, vto: 3.7, kp: 1.16, lambda: 0.005, cgs: 160 * pf, cgd: 20 * pf, v: 100, i: 5.6, p: 43, pkg: "TO-220", use: "follower, regulator" },
    "IRF540": { pol: 1, vto: 3.25, kp: 9, lambda: 0.005, cgs: 1580 * pf, cgd: 120 * pf, v: 100, i: 28, p: 150, pkg: "TO-220", use: "power output, follower" },
    "IRF820": { pol: 1, vto: 3.76, kp: 1.25, lambda: 0.002, cgs: 323 * pf, cgd: 37 * pf, v: 500, i: 2.5, p: 50, pkg: "TO-220", use: "HV regulator, gyrator, follower" },
    "IRF840": { pol: 1, vto: 3.7, kp: 5, lambda: 0.002, cgs: 1180 * pf, cgd: 120 * pf, v: 500, i: 8, p: 125, pkg: "TO-220", use: "HV regulator, follower" },
    "DN2540": { pol: 1, vto: -1.5, kp: 0.28, lambda: 0.002, cgs: 190 * pf, cgd: 1 * pf, v: 400, i: 0.5, p: 15, pkg: "TO-220", use: "depletion, CCS / cascode" },
    "LND150": { pol: 1, vto: -2.0, kp: 0.001, lambda: 0.005, cgs: 7 * pf, cgd: 0.5 * pf, v: 500, i: 0.03, p: 0.74, pkg: "TO-92", use: "depletion, low-current CCS" },
    "BS250": { pol: -1, vto: -2.25, kp: 0.056, lambda: 0.01, cgs: 12 * pf, cgd: 3 * pf, v: 45, i: 0.23, p: 0.83, pkg: "TO-92", use: "small signal switch" },
    "IRF9540": { pol: -1, vto: -2.8, kp: 4.2, lambda: 0.005, cgs: 1260 * pf, cgd: 140 * pf, v: 100, i: 19, p: 150, pkg: "TO-220", use: "power output, follower" },
    "IRF9610": { pol: -1, vto: -3.85, kp: 0.5, lambda: 0.003, cgs: 155 * pf, cgd: 15 * pf, v: 200, i: 1.8, p: 20, pkg: "TO-220", use: "HV CCS, follower" },
    "IRF9640": { pol: -1, vto: -3.47, kp: 3.9, lambda: 0.003, cgs: 1120 * pf, cgd: 81 * pf, v: 200, i: 11, p: 125, pkg: "TO-220", use: "HV regulator, CCS" },
    // power output; the lateral pairs (2SK1058/2SJ162, ECX10N20/ECX10P20) start conducting near
    // 0.1 V (0.1 A at 0.55 V) and have a lower gfs, about 1.4 S at 3 A
    "IRFP240": { pol: 1, vto: 3.9, kp: 5, lambda: 0.003, cgs: 1170 * pf, cgd: 130 * pf, v: 200, i: 20, p: 150, pkg: "TO-247", use: "power output" },
    "IRFP250": { pol: 1, vto: 3.9, kp: 10, lambda: 0.003, cgs: 2550 * pf, cgd: 250 * pf, v: 200, i: 30, p: 190, pkg: "TO-247", use: "power output, high current" },
    "IRFP460": { pol: 1, vto: 3.6, kp: 12, lambda: 0.002, cgs: 3850 * pf, cgd: 350 * pf, v: 500, i: 20, p: 280, pkg: "TO-247", use: "HV follower, regulator, SE output" },
    "2SK1058": { pol: 1, vto: 0.05, kp: 0.32, lambda: 0.01, cgs: 590 * pf, cgd: 10 * pf, v: 160, i: 7, p: 100, pkg: "TO-3P", use: "lateral power output (Hitachi)" },
    "ECX10N20": { pol: 1, vto: 0.05, kp: 0.32, lambda: 0.01, cgs: 500 * pf, cgd: 10 * pf, v: 200, i: 8, p: 125, pkg: "TO-247", use: "lateral power output (Exicon)" },
    "IRFP9240": { pol: -1, vto: -3.55, kp: 3.65, lambda: 0.003, cgs: 1120 * pf, cgd: 81 * pf, v: 200, i: 12, p: 150, pkg: "TO-247", use: "power output" },
    "2SJ162": { pol: -1, vto: -0.05, kp: 0.32, lambda: 0.01, cgs: 860 * pf, cgd: 40 * pf, v: 160, i: 7, p: 100, pkg: "TO-3P", use: "lateral power output (Hitachi)" },
    "ECX10P20": { pol: -1, vto: -0.05, kp: 0.32, lambda: 0.01, cgs: 700 * pf, cgd: 10 * pf, v: 200, i: 8, p: 125, pkg: "TO-247", use: "lateral power output (Exicon)" }
  };
  // zener: breakdown bv (V) at the test current izt (A), dynamic resistance zzt (Ω), power p (W):
  // the 1 W 1N47xxA series and some 5 W 1N53xxB
  const ZENERS = {
    "1N4728A": { bv: 3.3, izt: 0.076, zzt: 10, p: 1 }, "1N4729A": { bv: 3.6, izt: 0.069, zzt: 10, p: 1 }, "1N4730A": { bv: 3.9, izt: 0.064, zzt: 9, p: 1 }, "1N4731A": { bv: 4.3, izt: 0.058, zzt: 9, p: 1 },
    "1N4732A": { bv: 4.7, izt: 0.053, zzt: 8, p: 1 }, "1N4733A": { bv: 5.1, izt: 0.049, zzt: 7, p: 1 }, "1N4734A": { bv: 5.6, izt: 0.045, zzt: 5, p: 1 }, "1N4735A": { bv: 6.2, izt: 0.041, zzt: 2, p: 1 },
    "1N4736A": { bv: 6.8, izt: 0.037, zzt: 3.5, p: 1 }, "1N4737A": { bv: 7.5, izt: 0.034, zzt: 4, p: 1 }, "1N4738A": { bv: 8.2, izt: 0.031, zzt: 4.5, p: 1 }, "1N4739A": { bv: 9.1, izt: 0.028, zzt: 5, p: 1 },
    "1N4740A": { bv: 10, izt: 0.025, zzt: 7, p: 1 }, "1N4741A": { bv: 11, izt: 0.023, zzt: 8, p: 1 }, "1N4742A": { bv: 12, izt: 0.021, zzt: 9, p: 1 }, "1N4743A": { bv: 13, izt: 0.019, zzt: 10, p: 1 },
    "1N4744A": { bv: 15, izt: 0.017, zzt: 14, p: 1 }, "1N4745A": { bv: 16, izt: 0.0155, zzt: 16, p: 1 }, "1N4746A": { bv: 18, izt: 0.014, zzt: 20, p: 1 }, "1N4747A": { bv: 20, izt: 0.0125, zzt: 22, p: 1 },
    "1N4748A": { bv: 22, izt: 0.0115, zzt: 23, p: 1 }, "1N4749A": { bv: 24, izt: 0.0105, zzt: 25, p: 1 }, "1N4750A": { bv: 27, izt: 0.0095, zzt: 35, p: 1 }, "1N4751A": { bv: 30, izt: 0.0085, zzt: 40, p: 1 },
    "1N4752A": { bv: 33, izt: 0.0075, zzt: 45, p: 1 }, "1N4753A": { bv: 36, izt: 0.007, zzt: 50, p: 1 }, "1N4754A": { bv: 39, izt: 0.0065, zzt: 60, p: 1 }, "1N4755A": { bv: 43, izt: 0.006, zzt: 70, p: 1 },
    "1N4756A": { bv: 47, izt: 0.0055, zzt: 80, p: 1 }, "1N4757A": { bv: 51, izt: 0.005, zzt: 95, p: 1 }, "1N4758A": { bv: 56, izt: 0.0045, zzt: 110, p: 1 }, "1N4759A": { bv: 62, izt: 0.004, zzt: 125, p: 1 },
    "1N4760A": { bv: 68, izt: 0.0037, zzt: 150, p: 1 }, "1N4761A": { bv: 75, izt: 0.0033, zzt: 175, p: 1 }, "1N4762A": { bv: 82, izt: 0.003, zzt: 200, p: 1 }, "1N4763A": { bv: 91, izt: 0.0028, zzt: 250, p: 1 },
    "1N4764A": { bv: 100, izt: 0.0025, zzt: 350, p: 1 },
    "1N5349B": { bv: 12, izt: 0.1, zzt: 2.5, p: 5 }, "1N5352B": { bv: 15, izt: 0.075, zzt: 2.5, p: 5 }, "1N5359B": { bv: 24, izt: 0.05, zzt: 3.5, p: 5 }, "1N5363B": { bv: 30, izt: 0.04, zzt: 8, p: 5 },
    "1N5378B": { bv: 100, izt: 0.012, zzt: 90, p: 5 }, "1N5388B": { bv: 200, izt: 0.005, zzt: 480, p: 5 }
  };
  // rectifier and signal diodes: saturation current is (A) and emission coefficient n fitted to the
  // datasheet's forward voltage, series resistance rs (Ω), transit time tt (s: the stored charge
  // tt·I that gives the reverse recovery; tt = trr / 0.45, so the datasheet's trr test, 0.5 A
  // forward, 1 A reverse, to 0.25 A, measures its trr; a 1N4148 from 10 mA to 10 mA, tt = trr / ln 2;
  // Schottky and SiC diodes store none), junction capacitance cj (F, at a few volts reverse),
  // the ratings v (VRRM) and i (average forward current, A), the package and the kind
  const DIODES = {
    "1N4001": { kind: "rectifier", is: 7e-9, n: 1.8, rs: 0.05, tt: 4.3e-6, cj: 15e-12, v: 50, i: 1, pkg: "DO-41", use: "1 A rectifier, 50 V" },
    "1N4004": { kind: "rectifier", is: 7e-9, n: 1.8, rs: 0.05, tt: 4.3e-6, cj: 15e-12, v: 400, i: 1, pkg: "DO-41", use: "1 A rectifier, 400 V" },
    "1N4007": { kind: "rectifier", is: 7e-9, n: 1.8, rs: 0.05, tt: 4.3e-6, cj: 15e-12, v: 1000, i: 1, pkg: "DO-41", use: "1 A rectifier, 1000 V" },
    "1N5404": { kind: "rectifier", is: 2.5e-8, n: 1.8, rs: 0.02, tt: 4.3e-6, cj: 30e-12, v: 400, i: 3, pkg: "DO-201AD", use: "3 A rectifier, 400 V" },
    "1N5408": { kind: "rectifier", is: 2.5e-8, n: 1.8, rs: 0.02, tt: 4.3e-6, cj: 30e-12, v: 1000, i: 3, pkg: "DO-201AD", use: "3 A rectifier, 1000 V" },
    "UF4007": { kind: "fast", is: 1.3e-8, n: 2.2, rs: 0.24, tt: 1.67e-7, cj: 17e-12, v: 1000, i: 1, pkg: "DO-41", use: "ultrafast 1 A, 1000 V, 75 ns", trr: 75e-9 },
    "UF5408": { kind: "fast", is: 4.9e-8, n: 2.2, rs: 0.108, tt: 1.67e-7, cj: 36e-12, v: 1000, i: 3, pkg: "DO-201AD", use: "ultrafast 3 A, 1000 V, 75 ns", trr: 75e-9 },
    "MUR160": { kind: "fast", is: 1e-9, n: 1.7, rs: 0.1, tt: 1.11e-7, cj: 10e-12, v: 600, i: 1, pkg: "DO-41", use: "ultrafast 1 A, 600 V, 50 ns", trr: 50e-9 },
    "MUR460": { kind: "fast", is: 4e-9, n: 1.7, rs: 0.04, tt: 1.67e-7, cj: 30e-12, v: 600, i: 4, pkg: "DO-201AD", use: "ultrafast 4 A, 600 V, 75 ns", trr: 75e-9 },
    "HER108": { kind: "fast", is: 1e-8, n: 2, rs: 0.2, tt: 1.67e-7, cj: 10e-12, v: 1000, i: 1, pkg: "DO-41", use: "high-efficiency 1 A, 1000 V, 75 ns", trr: 75e-9 },
    "FR107": { kind: "fast", is: 1e-8, n: 1.85, rs: 0.1, tt: 1.11e-6, cj: 12e-12, v: 1000, i: 1, pkg: "DO-41", use: "fast recovery 1 A, 1000 V, 500 ns", trr: 500e-9 },
    "1N4148": { kind: "signal", is: 2.5e-9, n: 1.75, rs: 0.05, tt: 5.8e-9, cj: 2e-12, v: 100, i: 0.15, pkg: "DO-35", use: "small signal, 4 ns", trr: 4e-9 },
    "BAT85": { kind: "schottky", is: 7.5e-9, n: 1.05, rs: 2, tt: 0, cj: 10e-12, v: 30, i: 0.2, pkg: "DO-35", use: "small-signal Schottky, 30 V" },
    "1N5817": { kind: "schottky", is: 3e-6, n: 1.1, rs: 0.07, tt: 0, cj: 125e-12, v: 20, i: 1, pkg: "DO-41", use: "Schottky 1 A, 20 V" },
    "1N5819": { kind: "schottky", is: 1.3e-6, n: 1.1, rs: 0.07, tt: 0, cj: 110e-12, v: 40, i: 1, pkg: "DO-41", use: "Schottky 1 A, 40 V" },
    "1N5822": { kind: "schottky", is: 5e-6, n: 1.1, rs: 0.025, tt: 0, cj: 250e-12, v: 40, i: 3, pkg: "DO-201AD", use: "Schottky 3 A, 40 V" },
    "SB1100": { kind: "schottky", is: 3e-8, n: 1.2, rs: 0.1, tt: 0, cj: 80e-12, v: 100, i: 1, pkg: "DO-41", use: "Schottky 1 A, 100 V" },
    "C3D02060A": { kind: "sic", is: 5e-14, n: 1.3, rs: 0.22, tt: 0, cj: 20e-12, v: 600, i: 2, pkg: "TO-220-2", use: "SiC Schottky 2 A, 600 V, no recovery" },
    "C3D04060A": { kind: "sic", is: 1e-13, n: 1.3, rs: 0.12, tt: 0, cj: 35e-12, v: 600, i: 4, pkg: "TO-220-2", use: "SiC Schottky 4 A, 600 V, no recovery" },
    "C4D02120A": { kind: "sic", is: 2e-14, n: 1.3, rs: 0.22, tt: 0, cj: 20e-12, v: 1200, i: 2, pkg: "TO-220-2", use: "SiC Schottky 2 A, 1200 V, no recovery" }
  };
  // bridge rectifiers: four diodes of one model (the parameters as DIODES), the ratings of the bridge
  // (v: VRRM per diode, i: average output current), the package (DIP-4, an inline SIL-4, or a
  // chassis-mounted KBPC with Faston tabs) and its pin order, pad 1 first
  const BRIDGES = {
    "DF04M": { is: 7e-9, n: 1.8, rs: 0.05, tt: 4.3e-6, v: 400, i: 1, pkg: "DIP-4", order: ["+", "-", "AC2", "AC1"], use: "1 A, 400 V, DIP-4" },
    "DF10M": { is: 7e-9, n: 1.8, rs: 0.05, tt: 4.3e-6, v: 1000, i: 1, pkg: "DIP-4", order: ["+", "-", "AC2", "AC1"], use: "1 A, 1000 V, DIP-4" },
    "B250C2300-1500A": { is: 1.5e-8, n: 1.8, rs: 0.03, tt: 4.3e-6, v: 600, i: 1.5, pkg: "SIL-4", order: ["-", "AC1", "AC2", "+"], use: "1.5 A (2.3 A on a heatsink), 600 V, inline" },
    "KBPC2510": { is: 2e-7, n: 1.8, rs: 0.008, tt: 1e-5, v: 1000, i: 25, pkg: "KBPC", order: ["+", "AC1", "-", "AC2"], use: "25 A, 1000 V, chassis mount, Faston" },
    "KBPC3510": { is: 2.5e-7, n: 1.8, rs: 0.006, tt: 1e-5, v: 1000, i: 35, pkg: "KBPC", order: ["+", "AC1", "-", "AC2"], use: "35 A, 1000 V, chassis mount, Faston" },
    "W04G": { is: 1e-8, n: 1.8, rs: 0.05, tt: 4.3e-6, v: 400, i: 1.5, pkg: "WOB", order: ["+", "AC1", "-", "AC2"], use: "1.5 A, 400 V, round (WOB)" },
    "W10G": { is: 1e-8, n: 1.8, rs: 0.05, tt: 4.3e-6, v: 1000, i: 1.5, pkg: "WOB", order: ["+", "AC1", "-", "AC2"], use: "1.5 A, 1000 V, round (WOB)" },
    "GBU4J": { is: 3e-8, n: 1.8, rs: 0.02, tt: 4.3e-6, v: 600, i: 4, pkg: "GBU", order: ["+", "AC1", "AC2", "-"], use: "4 A, 600 V, flat inline (GBU)" },
    "GBU8K": { is: 6e-8, n: 1.8, rs: 0.012, tt: 4.3e-6, v: 800, i: 8, pkg: "GBU", order: ["+", "AC1", "AC2", "-"], use: "8 A, 800 V, flat inline (GBU), on a heatsink" },
    "KBU8K": { is: 1e-7, n: 1.8, rs: 0.008, tt: 4.3e-6, v: 800, i: 8, pkg: "KBU", order: ["+", "AC1", "AC2", "-"], use: "8 A, 800 V, inline (KBU), on a heatsink" }
  };
  // Inrush current limiters (NTC thermistors, Ametherm SL series): the cold resistance r25 (Ω) and
  // the largest steady current imax (A); r100 and r50 the makers' resistance when self-heated at
  // 100 % and 50 % of imax, from which ntcLaw() gives R = k·I^−n; the disc's diameter d and
  // largest thickness w, its lead pitch p and lead diameter (mm), straight leads (Vishay datasheets)
  const NTCS = {
    "SL10 5R003": { r25: 5, imax: 3, r100: 0.5, r50: 0.7, d: 10, w: 4, p: 5.1, lead: 0.5, use: "5 Ω, 3 A" },
    "SL22 10005": { r25: 10, imax: 5, r100: 0.18, r50: 0.44, d: 22, w: 5, p: 7.8, lead: 1, use: "10 Ω, 5 A" },
    "SL22 2R510": { r25: 2.5, imax: 10, r100: 0.04, r50: 0.1, d: 22, w: 6, p: 7.8, lead: 1, use: "2.5 Ω, 10 A" },
    "SL22 5R012": { r25: 5, imax: 12, r100: 0.05, r50: 0.12, d: 22, w: 6, p: 7.8, lead: 1, use: "5 Ω, 12 A" },
    "SL32 10015": { r25: 10, imax: 15, r100: 0.05, r50: 0.11, d: 31, w: 6, p: 7.8, lead: 1, use: "10 Ω, 15 A" }
  };
  const ntcLaw = m => { const n = Math.log(m.r50 / m.r100) / Math.LN2; return { r25: m.r25, n, k: m.r100 * Math.pow(m.imax, n) }; };
  // Metal oxide varistors (TDK SIOV StandarD): the largest continuous voltages vrms and vdc, the
  // varistor voltage v1ma at 1 mA, the clamping voltage vc at the surge current ic (8/20 µs), the
  // typical capacitance at 1 kHz, the disc's diameter d and largest thickness w, its lead pitch p and
  // lead diameter (mm)
  const MOVS = {
    "S10K150": { vrms: 150, vdc: 200, v1ma: 240, vc: 395, ic: 25, c: 430e-12, d: 12, w: 4.4, p: 7.5, lead: 0.8, use: "for 120 V mains, Ø 10 mm" },
    "S07K275": { vrms: 275, vdc: 350, v1ma: 430, vc: 710, ic: 10, c: 110e-12, d: 9, w: 4.4, p: 5, lead: 0.6, use: "for 230 V mains, Ø 7 mm" },
    "S10K275": { vrms: 275, vdc: 350, v1ma: 430, vc: 710, ic: 25, c: 220e-12, d: 12, w: 5.0, p: 7.5, lead: 0.8, use: "for 230 V mains, Ø 10 mm" },
    "S14K275": { vrms: 275, vdc: 350, v1ma: 430, vc: 710, ic: 50, c: 440e-12, d: 15.5, w: 5.0, p: 7.5, lead: 0.8, use: "for 230 V mains, Ø 14 mm" },
    "S20K275": { vrms: 275, vdc: 350, v1ma: 430, vc: 710, ic: 100, c: 850e-12, d: 21.5, w: 5.4, p: 10, lead: 1, use: "for 230 V mains, Ø 20 mm" },
    "S14K385": { vrms: 385, vdc: 505, v1ma: 620, vc: 1025, ic: 50, c: 315e-12, d: 15.5, w: 5.9, p: 7.5, lead: 0.8, use: "for 230 V mains with margin, Ø 14 mm" }
  };
  // a varistor's curve as two opposed junctions: I = 1 mA at v1ma, rising α ≈ 35-fold per decade of
  // voltage around it (the slope nVt = v1ma/35), and a series resistance that brings the clamp
  // voltage at ic to vc
  const movModel = m => { const nvt = m.v1ma / 35, n = nvt / 0.025852, is = 1e-3 * Math.exp(-m.v1ma / nvt); return { n, is, rs: Math.max((m.vc - m.v1ma - nvt * Math.log(m.ic / 1e-3)) / m.ic, 0.01) }; };
  // Fuses, 5 × 20 mm (and 6.3 × 32 mm) glass cartridges: the ratings offered, and the nominal cold
  // resistance of each (Littelfuse 218 time-lag datasheet; log-log between ratings off the table)
  const FUSE_RATINGS = [0.1, 0.125, 0.16, 0.2, 0.25, 0.315, 0.4, 0.5, 0.63, 0.8, 1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10];
  function fuseCold(a) {
    const P = [[0.1, 8.95], [0.125, 4.41], [0.16, 2.44], [0.2, 1.6], [0.25, 1.05], [0.315, 0.848], [0.4, 0.535], [0.5, 0.37], [0.63, 0.275],
      [0.8, 0.073], [1, 0.055], [1.25, 0.042], [1.6, 0.032], [2, 0.029], [2.5, 0.022], [3.15, 0.017], [4, 0.013], [5, 0.01], [6.3, 0.0075], [8, 0.0059], [10, 0.0045]];
    a = Math.min(Math.max(+a || 1, P[0][0]), P[P.length - 1][0]);
    let k = 0; while (k < P.length - 2 && a > P[k + 1][0]) k++;
    const [[a0, r0], [a1, r1]] = [P[k], P[k + 1]];
    return Math.exp(Math.log(r0) + (Math.log(r1) - Math.log(r0)) * Math.log(a / a0) / Math.log(a1 / a0));
  }
  // jacks: their pins (tip +, ring R, sleeve −, the tip's switch contact SW that touches the tip
  // while no plug is in) and size
  const JACKS = {
    "TS-SW": { pins: ["+", "-", "SW"], size: "6.35", use: "6.35 mm mono, switched (guitar input)" },
    "TS": { pins: ["+", "-"], size: "6.35", use: "6.35 mm mono (speaker, line)" },
    "TRS": { pins: ["+", "R", "-"], size: "6.35", use: "6.35 mm stereo (headphones)" },
    "TRS-3.5": { pins: ["+", "R", "-"], size: "3.5", use: "3.5 mm stereo" },
    "RCA": { pins: ["+", "-"], size: "RCA", use: "RCA (phono) socket" }
  };
  // JFETs, SPICE NJF / PJF level 1: pinch-off vto (V, the gate-source voltage at which the channel
  // closes: negative N-channel, positive P-channel), beta (A/V², so IDSS = beta·vto²), lambda,
  // gate junction saturation current is (A), cgs / cgd (F) the datasheet's Ciss − Crss and Crss.
  // vto and beta from the datasheets' typical IDSS and transconductance at IDSS (gfs = 2·IDSS / |vto|):
  // the grades (2SK170 BL, 2SK30A Y) as named. v: V(BR)GSS, i: the current rating (A, the gate's forward current IGF), p: Ptot.
  const JFETS = {
    "J201": { pol: 1, vto: -0.8, beta: 1.0e-3, lambda: 2.25e-3, is: 1.1e-13, cgs: 4 * pf, cgd: 1.5 * pf, v: 40, i: 0.05, p: 0.35, pkg: "TO-92", use: "low-IDSS preamp, booster (IDSS 0.2–1 mA)" },
    "J113": { pol: 1, vto: -1.6, beta: 3.5e-3, lambda: 4e-3, is: 2e-13, cgs: 4 * pf, cgd: 3 * pf, v: 35, i: 0.05, p: 0.625, pkg: "TO-92", use: "switch, mute, current source (IDSS ≥ 2 mA)" },
    "J310": { pol: 1, vto: -4.0, beta: 2.5e-3, lambda: 3e-3, is: 2e-13, cgs: 4.3 * pf, cgd: 1.8 * pf, v: 25, i: 0.01, p: 0.35, pkg: "TO-92", use: "VHF, buffer, cascode (IDSS 24–60 mA)" },
    "2N5457": { pol: 1, vto: -2.0, beta: 0.75e-3, lambda: 2.3e-3, is: 1.8e-13, cgs: 3 * pf, cgd: 1.5 * pf, v: 25, i: 0.01, p: 0.31, pkg: "TO-92", use: "general audio, buffer (IDSS 1–5 mA)" },
    "MPF102": { pol: 1, vto: -2.5, beta: 1.0e-3, lambda: 2e-3, is: 3e-13, cgs: 4 * pf, cgd: 3 * pf, v: 25, i: 0.01, p: 0.35, pkg: "TO-92", use: "general audio, RF (IDSS 2–20 mA)" },
    "2SK170": { pol: 1, vto: -0.82, beta: 13.4e-3, lambda: 1.5e-3, is: 1e-12, cgs: 24 * pf, cgd: 6 * pf, v: 40, i: 0.01, p: 0.4, pkg: "TO-92", use: "low-noise MC / mic / phono input, BL (IDSS 6–12 mA)" },
    "LSK170B": { pol: 1, vto: -0.82, beta: 13.4e-3, lambda: 1.5e-3, is: 1e-12, cgs: 20 * pf, cgd: 5 * pf, v: 40, i: 0.01, p: 0.4, pkg: "TO-92", use: "low-noise input, 2SK170 replacement (IDSS 6–12 mA)" },
    "2SK30A": { pol: 1, vto: -2.0, beta: 0.5e-3, lambda: 5e-3, is: 1e-13, cgs: 5.6 * pf, cgd: 2.6 * pf, v: 50, i: 0.01, p: 0.1, pkg: "TO-92", use: "general audio, Y (IDSS 1.2–3 mA)" },
    "J175": { pol: -1, vto: 4.0, beta: 1.5e-3, lambda: 4e-3, is: 2e-13, cgs: 15 * pf, cgd: 5.5 * pf, v: 30, i: 0.05, p: 0.35, pkg: "TO-92", use: "P-channel switch, current source (IDSS 7–60 mA)" },
    "2N5460": { pol: -1, vto: 1.8, beta: 0.75e-3, lambda: 3e-3, is: 1.5e-13, cgs: 4 * pf, cgd: 1 * pf, v: 40, i: 0.01, p: 0.31, pkg: "TO-92", use: "P-channel general purpose (IDSS 1–5 mA)" },
    "2SJ74": { pol: -1, vto: 0.82, beta: 13.4e-3, lambda: 2e-3, is: 1e-12, cgs: 73 * pf, cgd: 32 * pf, v: 25, i: 0.01, p: 0.4, pkg: "TO-92", use: "low-noise, 2SK170 complement, BL (IDSS 6–12 mA)" }
  };
  // Three-terminal regulators (Semi.reg): adj (LM317 family: vref between OUT and ADJ, iadj out of
  // ADJ, iq the minimum load, which flows to OUT) or fixed (78xx: vref = the output, iq to GND);
  // pol −1 the negative ones. g: the error amplifier's transconductance (A/V, the output resistance
  // is 1/g); ilim: short-circuit current; vdo + vsat·atanh(I/ilim): the dropout at a current I.
  // line: the line regulation, V of output per V of input (1.25e-4: an LM317's 0.01 %/V; the ripple
  // rejection, about 66 dB, 78 dB with ADJ bypassed). vmax: the input-output (adj) or input (fixed)
  // maximum; p: Ptot on a heatsink (TO-220, 25 °C case).
  const REGS = {
    "LM317": { adj: 1, pol: 1, vref: 1.25, iadj: 50e-6, iq: 3.5e-3, line: 1.25e-4, g: 200, ilim: 2.2, vdo: 1.45, vsat: 0.5, vmax: 40, p: 15, pkg: "TO-220", use: "adjustable positive, 1.2–37 V, 1.5 A" },
    "LM317L": { adj: 1, pol: 1, vref: 1.25, iadj: 50e-6, iq: 1.5e-3, line: 1.25e-4, g: 200, ilim: 0.2, vdo: 1.2, vsat: 0.4, vmax: 40, p: 0.625, pkg: "TO-92", use: "adjustable positive, 100 mA" },
    "LM338": { adj: 1, pol: 1, vref: 1.25, iadj: 45e-6, iq: 3.5e-3, line: 1.25e-4, g: 500, ilim: 8, vdo: 1.4, vsat: 0.6, vmax: 35, p: 25, pkg: "TO-220", use: "adjustable positive, 5 A (DC heaters)" },
    "LM337": { adj: 1, pol: -1, vref: 1.25, iadj: 65e-6, iq: 2.5e-3, line: 1.25e-4, g: 200, ilim: 2.2, vdo: 1.45, vsat: 0.5, vmax: 40, p: 15, pkg: "TO-220", use: "adjustable negative, −1.2 to −37 V, 1.5 A" },
    "7805": { adj: 0, pol: 1, vref: 5, iq: 5e-3, line: 3e-4, g: 100, ilim: 2.2, vdo: 1.7, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed +5 V, 1.5 A" },
    "7809": { adj: 0, pol: 1, vref: 9, iq: 5e-3, line: 3e-4, g: 100, ilim: 2.2, vdo: 1.7, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed +9 V, 1.5 A" },
    "7812": { adj: 0, pol: 1, vref: 12, iq: 5e-3, line: 3e-4, g: 100, ilim: 2.2, vdo: 1.7, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed +12 V, 1.5 A" },
    "7815": { adj: 0, pol: 1, vref: 15, iq: 5e-3, line: 3e-4, g: 100, ilim: 2.2, vdo: 1.7, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed +15 V, 1.5 A" },
    "7824": { adj: 0, pol: 1, vref: 24, iq: 5e-3, line: 3e-4, g: 100, ilim: 2.2, vdo: 1.7, vsat: 0.4, vmax: 40, p: 15, pkg: "TO-220", use: "fixed +24 V, 1.5 A" },
    "78L05": { adj: 0, pol: 1, vref: 5, iq: 3e-3, line: 1e-3, g: 50, ilim: 0.14, vdo: 1.4, vsat: 0.3, vmax: 30, p: 0.625, pkg: "TO-92", use: "fixed +5 V, 100 mA" },
    "78L12": { adj: 0, pol: 1, vref: 12, iq: 3e-3, line: 1e-3, g: 50, ilim: 0.14, vdo: 1.4, vsat: 0.3, vmax: 35, p: 0.625, pkg: "TO-92", use: "fixed +12 V, 100 mA" },
    "7905": { adj: 0, pol: -1, vref: 5, iq: 3e-3, line: 3e-4, g: 100, ilim: 2.1, vdo: 1.1, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed −5 V, 1.5 A" },
    "7912": { adj: 0, pol: -1, vref: 12, iq: 3e-3, line: 3e-4, g: 100, ilim: 2.1, vdo: 1.1, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed −12 V, 1.5 A" },
    "7915": { adj: 0, pol: -1, vref: 15, iq: 3e-3, line: 3e-4, g: 100, ilim: 2.1, vdo: 1.1, vsat: 0.4, vmax: 35, p: 15, pkg: "TO-220", use: "fixed −15 V, 1.5 A" }
  };
  // the engine's model of a regulator; a fixed one's internal divider draws about 1 mA
  const regModel = m => ({ adj: m.adj, pol: m.pol, vref: m.vref, line: m.line, iadj: m.iadj || 0, iq: m.iq, g: m.g, ilim: m.ilim, vdo: m.vdo, vsat: m.vsat, rdiv: m.vref / 1e-3 });
  // Shunt references (Semi.shunt): vref (REF − A in regulation), gm (A/V, 1/gm the datasheet's
  // dynamic impedance |zKA|), imax: the cathode's current limit, rref: REF's bias (Iref at vref),
  // roff: K–A leakage off, v: the cathode's maximum, p: Ptot.
  const SHUNTS = {
    "TL431": { vref: 2.495, gm: 5, imax: 0.15, rref: 1.25e6, roff: 3.6e8, v: 36, p: 0.77, pkg: "TO-92", use: "adjustable shunt reference, 2.5–36 V, 1–100 mA" }
  };
  // LEDs, as used for cathode bias: forward voltage vf at 10 mA (emission coefficient 2), max current i (A)
  const LEDS = { red: { vf: 1.8, i: 0.02 }, yellow: { vf: 2.0, i: 0.02 }, green: { vf: 2.1, i: 0.02 }, blue: { vf: 3.0, i: 0.02 } };
  // the junction's share: the part's 5 Ω series resistance drops the other 50 mV at 10 mA
  const ledIs = vf => 0.01 / Math.exp((vf - 0.05) / (2 * 0.025852));
  // Op-amps, typical values from the makers' datasheets (TI, onsemi): open-loop gain a0 (V/V),
  // gain-bandwidth gbw (Hz), slew rate sr (V/s), input resistance rin (Ω), input bias current ib
  // (A, > 0 into the pins: NPN inputs, < 0 out of them: PNP), open-loop output resistance ro (Ω),
  // short-circuit current sourcing isc / sinking isk (A), output swing: within dhi of V+ and dlo
  // of V− with no load (V), supply current iq per amplifier (A), vmax: the largest V+ − V−.
  // units: amplifiers in the package (DIP-8 or DIP-14). cc: the internal Miller capacitor;
  // the LM301 has none and takes its own between pins 1 and 8 (30 pF: unity-gain stable).
  // Glow-discharge voltage regulators (sim-engine.js GLOW): maintaining voltage vm, striking
  // voltage vs (the datasheet's minimum supply for a sure start), regulation r (the rise over the
  // current range, per ampere), current range imin–imax, extinction iext; pins A 5, K 2 in both
  // bases (RCA data: B7G 0A2/0B2 also A on 1, K on 4 and 7, 3 and 6 internal, not to be used;
  // octal: a jumper 3–7 that can break the supply when the tube is pulled)
  const GASREGS = {
    "0A2": { vm: 150, vs: 185, r: 80, imin: 5e-3, imax: 30e-3, iext: 2e-3, socket: "B7G", use: "150 V, miniature" },
    "0B2": { vm: 108, vs: 133, r: 40, imin: 5e-3, imax: 30e-3, iext: 2e-3, socket: "B7G", use: "108 V, miniature" },
    "0A3": { vm: 75, vs: 105, r: 140, imin: 5e-3, imax: 40e-3, iext: 2e-3, socket: "OCTAL", use: "75 V, octal (VR75)" },
    "0C3": { vm: 108, vs: 133, r: 57, imin: 5e-3, imax: 40e-3, iext: 2e-3, socket: "OCTAL", use: "108 V, octal (VR105)" },
    "0D3": { vm: 153, vs: 185, r: 115, imin: 5e-3, imax: 40e-3, iext: 2e-3, socket: "OCTAL", use: "153 V, octal (VR150)" }
  };
  // interstage and input transformers: typical values for each use (fill in your transformer's
  // datasheet values over them). ratio: secondary to primary turns
  const ITX_PRESETS = [
    { id: "is11", name: "Interstage 1:1, gapped for 10 mA", ratio: 1, lp: 40, dcrp: 400, dcrs: 450, llk: 15e-3, cs: 150e-12, idc: 10e-3, ct: "no" },
    { id: "is12ct", name: "Interstage 1:2 centre-tapped, gapped for 15 mA (SE driver to push-pull grids)", ratio: 2, lp: 30, dcrp: 300, dcrs: 1200, llk: 20e-3, cs: 120e-12, idc: 15e-3, ct: "yes" },
    { id: "is11pp", name: "Interstage 1:1 centre-tapped, ungapped (push-pull driver)", ratio: 1, lp: 150, dcrp: 600, dcrs: 650, llk: 25e-3, cs: 150e-12, idc: 0, ct: "yes" },
    { id: "mic10", name: "Microphone input 1:10 (150 Ω : 15 kΩ)", ratio: 10, lp: 8, dcrp: 20, dcrs: 2500, llk: 0.5e-3, cs: 50e-12, idc: 0, ct: "no" },
    { id: "mc10", name: "Moving-coil step-up 1:10 (40 Ω : 4 kΩ)", ratio: 10, lp: 2, dcrp: 3, dcrs: 300, llk: 0.1e-3, cs: 80e-12, idc: 0, ct: "no" },
    { id: "line11", name: "Line input 1:1 (10 kΩ : 10 kΩ)", ratio: 1, lp: 20, dcrp: 50, dcrs: 60, llk: 2e-3, cs: 100e-12, idc: 0, ct: "no" }
  ];
  const ITX_KEYS = ["ratio", "lp", "dcrp", "dcrs", "llk", "cs", "idc", "ct"];
  const itxPreset = id => { const p = ITX_PRESETS.find(q => q.id === id); return Object.assign({}, ...ITX_KEYS.map(k => ({ [k]: p[k] }))); };
  // Output transformers from the makers' data, for the generic single-ended and push-pull parts'
  // Model field (a model fills in the fields; type your own over them). Hammond values are from each
  // part's drawing (hammfg.com/files/parts/pdf/<model>.pdf); the 1627–1640SEA inductance and DC
  // rating are Hammond's catalogue figures. Edcor publishes only power, impedance, DC rating,
  // the ±1 dB band and the insertion loss (edcorusa.com), so the rest is worked out from those
  // (optDerive). Leakage given as measured at 60 Hz, 10 V; the newer drawings' 1 kHz, 1 V figures
  // (1650E 337 mH, 1620A 550 mH) would put the treble 1 dB down at 2–4 kHz, against the 30 kHz
  // they are sold for, and are not used.
  //   single-ended: [maker, primary Ω, W, max DC mA, Lp H, leakage H (0: from the band),
  //                  primary DCR Ω, secondary DCR Ω on the 8 Ω tap (0: from the loss), −1 dB band Hz, Hz, insertion loss dB]
  //   push-pull:    [maker, plate-to-plate Ω, W, Lp H of one half, leakage H of one half (0: from the band),
  //                  DCR of one half Ω, secondary DCR Ω for 8 Ω, band Hz, Hz, insertion loss dB]
  // A push-pull half's inductance and leakage are what Hammond measures (B+ to one plate); the whole
  // primary has four times the inductance (the halves are coupled) and twice the leakage. The 16xx
  // secondaries are given for 4 and 16 Ω; their 8 Ω value is taken between the two.
  const OPT_SE_DATA = {
    "1627SEA": ["Hammond", 2500, 30, 160, 20, 0, 77.5, 0.517, 20, 20000],
    "1628SEA": ["Hammond", 5000, 30, 120, 48, 0, 171, 0.514, 20, 20000],
    "1629SEA": ["Hammond", 6500, 30, 100, 55, 0, 197, 0.517, 20, 20000],
    "1640SEA": ["Hammond", 1250, 30, 200, 14, 0, 28, 0.520, 20, 20000],
    "XSE15-5K": ["Edcor", 5000, 15, 100, 0, 0, 0, 0, 70, 18000, 0.5],
    "GXSE15-5K": ["Edcor", 5000, 15, 100, 0, 0, 0, 0, 40, 18000, 0.5],
    "CXSE25-3K": ["Edcor", 3000, 25, 200, 0, 0, 0, 0, 20, 20000, 0.5],
    "CXSE25-5K": ["Edcor", 5000, 25, 200, 0, 0, 0, 0, 20, 20000, 0.5]
  };
  const OPT_PP_DATA = {
    "1608": ["Hammond", 8000, 10, 174, 11.8e-3, 101.7, 0.42, 30, 30000],
    "1609": ["Hammond", 10000, 10, 255, 14.6e-3, 113.7, 0.42, 30, 30000],
    "1615": ["Hammond", 5000, 15, 139, 6.6e-3, 89.5, 0.23, 30, 30000],
    "1620": ["Hammond", 6600, 20, 212, 9.2e-3, 70.0, 0.39, 30, 30000],
    "1645": ["Hammond", 5000, 30, 180, 5.0e-3, 82.7, 0.34, 30, 30000],
    "1650F": ["Hammond", 7600, 25, 285, 10.4e-3, 105, 0.24, 30, 30000],
    "1650H": ["Hammond", 6600, 40, 245, 10.6e-3, 72.5, 0.21, 30, 30000],
    "1650K": ["Hammond", 3400, 50, 225, 5.98e-3, 37.3, 0.37, 30, 30000],
    "1650N": ["Hammond", 4300, 60, 134, 7.72e-3, 41.3, 0.29, 30, 30000],
    "1650P": ["Hammond", 6600, 60, 305, 11.8e-3, 80.3, 0.29, 30, 30000],
    "1650R": ["Hammond", 5000, 100, 320, 10.84e-3, 50.6, 0.35, 30, 30000],
    "1650T": ["Hammond", 1900, 120, 124, 4.3e-3, 23.6, 0.29, 30, 30000],
    "1650W": ["Hammond", 1900, 280, 122, 3.56e-3, 17.1, 0.19, 30, 30000],
    // a guitar amp's replacement (Fender Deluxe style, 2 × 6V6): the drawing gives the whole primary,
    // 21.4 H and 13.54 mH, so a half is a quarter and a half of them
    "1750H": ["Hammond", 6600, 20, 5.35, 6.77e-3, 214, 0.41, 70, 15000],
    "XPP15-8K": ["Edcor", 8000, 15, 0, 0, 0, 0, 70, 18000, 1],
    "GXPP15-8K": ["Edcor", 8000, 15, 0, 0, 0, 0, 40, 18000, 1],
    "CXPP25-6.6K": ["Edcor", 6600, 25, 0, 0, 0, 0, 20, 20000, 1],
    "CXPP30-6.6K": ["Edcor", 6600, 30, 0, 0, 0, 0, 20, 20000, 1],
    "CXPP50-5K": ["Edcor", 5000, 50, 0, 0, 0, 0, 20, 20000, 1]
  };
  // What a missing value would be for a transformer that just meets its band and loss, driven from a
  // source of its own impedance into its rated load: the primary inductance 1 dB down at the low end
  // (its reactance 0.98 Z across Z/2), the leakage 1 dB down at the top (1.02 Z in series with 2 Z),
  // and the insertion loss split evenly between the windings. A real part is usually better.
  const optDerive = {
    lp: (z, flo) => 0.983 * z / (2 * Math.PI * flo),
    llk: (z, fhi) => 1.0176 * z / (2 * Math.PI * fhi),
    dcr: (z, loss) => z * (Math.pow(10, loss / 20) - 1) / 2
  };
  // each model as the generic part's fields (zs 8 Ω; cw a typical winding capacitance, which no maker gives)
  const OPT_SE = {}, OPT_PP = {};
  Object.entries(OPT_SE_DATA).forEach(([k, [maker, zp, w, ma, lp, llk, dcrp, dcrs, flo, fhi, loss]]) => {
    const est = [];
    if (!lp) { lp = optDerive.lp(zp, flo); est.push("primary inductance"); }
    if (!llk) { llk = optDerive.llk(zp, fhi); est.push("leakage"); }
    if (!dcrp) { dcrp = optDerive.dcr(zp, loss); dcrs = dcrp * 8 / zp; est.push("winding resistances"); }
    OPT_SE[k] = { name: `${maker} ${k}`, maker, w, ma, flo, fhi, est,
      p: { zp, zs: 8, lp: +lp.toPrecision(3), llk: +llk.toPrecision(3), cw: 200e-12, dcrp: +dcrp.toPrecision(3), dcrs: +dcrs.toPrecision(3), idc: ma / 1000, pw: w, flo } };
  });
  Object.entries(OPT_PP_DATA).forEach(([k, [maker, zaa, w, lh, llkh, dcrh, dcrs, flo, fhi, loss]]) => {
    const est = [];
    let lp = 4 * lh, llk = 2 * llkh;
    if (!lh) { lp = optDerive.lp(zaa, flo); est.push("primary inductance"); }
    if (!llkh) { llk = optDerive.llk(zaa, fhi); est.push("leakage"); }
    if (!dcrh) { const r = optDerive.dcr(zaa, loss); dcrh = r / 2; dcrs = r * 8 / zaa; est.push("winding resistances"); }
    OPT_PP[k] = { name: `${maker} ${k}`, maker, w, flo, fhi, est,
      p: { zaa, zs: 8, lp: +lp.toPrecision(3), llk: +llk.toPrecision(3), cw: 300e-12, tap: 40, dcrp: +dcrh.toPrecision(3), dcrs: +dcrs.toPrecision(3), pw: w, flo } };
  });
  // the fields a model sets, and those that must match for the part to show the model's name (the
  // secondary impedance and its resistance may be changed: another tap of the same transformer)
  const OPT_KEYS = { opt_se: ["zp", "lp", "llk", "dcrp", "idc", "pw", "flo"], opt_pp: ["zaa", "lp", "llk", "tap", "dcrp", "pw", "flo"] };
  function optModel(c) {
    const cat = c.type === "opt_pp" ? OPT_PP : c.type === "opt_se" ? OPT_SE : null;
    if (!cat) return null;
    const keys = OPT_KEYS[c.type], same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
    const k = Object.keys(cat).find(id => keys.every(f => same(+cat[id].p[f], +c.params[f])));
    return k ? Object.assign({ id: k }, cat[k]) : null;
  }
  // The core's knee (sim-engine.js coreFlux): at the rated power and the lowest frequency of the band,
  // on top of the flux of the rated DC (single-ended), the core stands at 75 % of the knee, where its
  // magnetising current is 10 % above the straight line (a few % distortion in the primary current).
  // twice the voltage, or the same voltage at half the frequency, and it saturates.
  // z: the primary's impedance for that power; pw 0 or flo 0: no saturation (a linear core).
  function optSat(lp, z, pw, flo, idc) {
    if (!(+pw > 0 && +flo > 0)) return undefined;
    const lac = Math.sqrt(2 * pw * z) / (2 * Math.PI * flo), ldc = lp * Math.max(+idc || 0, 0);
    return { ls: (lac + ldc) / 0.75, p: 4, air: 0.01 };
  }
  // the inspector's line for the generic output transformers: where the bass and the treble go, and the core
  function optInfo(c) {
    const p = c.params, pp = c.type === "opt_pp", z = Math.max(+(pp ? p.zaa : p.zp) || 1, 1), m = optModel(c);
    const lp = +p.lp || 0, llk = +p.llk || 0, cw = +p.cw || 0, f = v => (v >= 1000 ? (v / 1000).toPrecision(3) + " kHz" : v.toPrecision(3) + " Hz");
    let t = m ? `${m.name}: ${m.w} W${m.ma ? `, ${m.ma} mA DC max` : ""}, ±1 dB ${f(m.flo)}–${f(m.fhi)} at full power. ` : "";
    t += `From a source of ${fmtEng(z, "Ω")} into its rated load the bass is 3 dB down at ${f(z / 2 / (2 * Math.PI * Math.max(lp, 1e-9)))} (primary inductance), ` +
      `the treble at ${f(2 * z / (2 * Math.PI * Math.max(llk, 1e-12)))} (leakage)`;
    t += cw > 0 && llk > 0 ? `, and the leakage resonates with the winding capacitance at ${f(1 / (2 * Math.PI * Math.sqrt(llk * cw)))}. ` : ". ";
    if (+p.pw > 0 && +p.flo > 0) t += `The core takes ${fmtEng(+p.pw, "W")} down to ${f(+p.flo)}${pp ? "" : ` with ${fmtEng(+p.idc || 0, "A")} DC`}; below that the power it passes before saturating falls with the square of the frequency, and past it the bass distorts and the primary current peaks${pp ? ". DC out of balance between the halves shifts the core towards saturation" : ""}. `;
    else t += "Rated power 0: the core never saturates. ";
    if (m && m.est.length) t += `Not given by ${m.maker}, worked out from the band and the insertion loss: ${m.est.join(", ")}. `;
    if (m) t += "Winding capacitance: typical (no maker gives it).";
    return t.trim();
  }
  // Guitar pickups (pickup part): the coil's EMF behind its DC resistance r and inductance l, its own
  // capacitance c across the output. Typical values of each kind (measure yours and type them over):
  // amp, a typical peak EMF for a firm strum
  const PICKUPS = [
    { id: "strat", name: "Single coil, Strat-style", r: 6e3, l: 2.4, c: 110e-12, amp: 0.15 },
    { id: "tele", name: "Single coil, Telecaster bridge", r: 7e3, l: 3, c: 120e-12, amp: 0.2 },
    { id: "p90", name: "P-90 (fat single coil)", r: 8e3, l: 7, c: 130e-12, amp: 0.3 },
    { id: "paf", name: "Humbucker, PAF-style", r: 8e3, l: 4.4, c: 150e-12, amp: 0.3 },
    { id: "hot", name: "Humbucker, high output", r: 16e3, l: 8, c: 200e-12, amp: 0.6 }
  ];
  const PICKUP_KEYS = ["r", "l", "c", "amp"];
  // Phono cartridges (phono part): mv, the output at 1 kHz and 5 cm/s (rms); r and l, the coil's
  // resistance and inductance. A moving coil's inductance is tens of µH, of no account at audio
  const CARTRIDGES = [
    { id: "mm", name: "Moving magnet, typical", mv: 5e-3, r: 1e3, l: 0.5 },
    { id: "2m-red", name: "Ortofon 2M Red (MM)", mv: 5.5e-3, r: 1.3e3, l: 0.63 },
    { id: "homc", name: "Moving coil, high output", mv: 2e-3, r: 150, l: 100e-6 },
    { id: "dl103", name: "Denon DL-103 (MC, low output)", mv: 0.3e-3, r: 40, l: 30e-6 }
  ];
  const CARTRIDGE_KEYS = ["mv", "r", "l"];
  // the RIAA recording curve (IEC 60098), as cut on a record: zeros at 3180 µs and 75 µs, a pole at
  // 318 µs, and the 3.18 µs pole that keeps the treble finite; unity at 1 kHz
  const RIAA_T = [3180e-6, 318e-6, 75e-6, 3.18e-6];
  const riaaGain = f => { const w = 2 * Math.PI * f, m = t => Math.hypot(1, w * t); return m(RIAA_T[0]) * m(RIAA_T[2]) / (m(RIAA_T[1]) * m(RIAA_T[3])); };
  const riaaRec = f => riaaGain(f) / riaaGain(1000);
  // Relays (relay part): poles; coil power pw (W, so its resistance is V²/pw); must-operate and
  // must-release voltages as shares of the rated coil voltage; operate time (max); contact
  // resistance (max). The coil's inductance is set so that its current reaches must-operate in 60 %
  // of the operate time (the armature's travel takes the rest)
  const RELAYS = {
    "G5LE-1": { poles: 1, pw: 0.4, op: 0.75, rel: 0.1, top: 10e-3, ron: 0.1, use: "SPDT power relay, 10 A at 250 V AC" },
    "G5V-2": { poles: 2, pw: 0.5, op: 0.75, rel: 0.05, top: 7e-3, ron: 0.05, use: "DPDT signal relay, 2 A at 30 V DC" }
  };
  const relayCoil = (m, v) => { const r = v * v / m.pw; return { r, l: r * 0.6 * m.top / Math.log(1 / (1 - m.op)) }; };
  // Vactrols (LED and CdS cell in one light-tight case; sim-engine.js LDR): the cell's typical
  // resistance at 1 mA and 10 mA of LED current, its dark resistance (10 s after), the turn-on
  // time (to 63 % of the final conductance) and turn-off time (to 100 kΩ from 10 mA)
  const VACTROLS = {
    VTL5C3: { r1: 10e3, r10: 1e3, rdark: 10e6, ton: 2.5e-3, toff: 35e-3, use: "tremolo, compressors" },
    VTL5C1: { r1: 20e3, r10: 600, rdark: 50e6, ton: 2.5e-3, toff: 35e-3, use: "channel switching, wide range" }
  };
  // the engine's model: gamma from the two points; the time constants from the datasheet times
  function vactrolModel(m) {
    const gamma = Math.log10(m.r1 / m.r10);
    return { rs: 1, r10: m.r10, gamma, rdark: m.rdark, ton: m.ton / -Math.log(1 - Math.pow(0.63, 1 / gamma)), toff: m.toff / (Math.log(1e5 / m.r10) / gamma) };
  }
  // Neon indicator lamps (sim-engine.js GLOW, one each way: a neon glows on either polarity):
  // typical striking voltage vs (DC), maintaining voltage vm at the design current i, the
  // rise r per ampere above vm, extinction current iext; rser: the series resistor for 230 V
  // mains at about the design current (the makers' tables)
  const NEONS = {
    "NE-2": { vs: 75, vm: 59, r: 8e3, i: 0.5e-3, iext: 30e-6, rser: 330e3, use: "standard brightness, the classic indicator" },
    "NE-2H": { vs: 110, vm: 65, r: 3e3, i: 1.9e-3, iext: 0.1e-3, rser: 100e3, use: "high brightness" },
    "ИН-3": { vs: 85, vm: 60, r: 6e3, i: 0.5e-3, iext: 30e-6, rser: 330e3, use: "IN-3, Soviet indicator" }
  };
  // Electron-ray tuning indicators ("magic eyes"): the triode (Koren's mu, kg, kp, kvb, x, fitted
  // to the plate current through the ray-control resistor rl at no grid bias and the grid bias
  // that closes the shadow, ec0), the target (a diode of perveance perv: it from the target
  // voltage vt), and the shadow: 90° with the triode's plate (the ray-control electrode) span·vt
  // below the target, closed (0°) with it at the target. pins: the base's pin numbers
  const EYES = {
    "6E5": { mu: 35, kg: 1443, kp: 800, kvb: 100, x: 1.4, perv: 4.5e-3 / Math.pow(250, 1.5), vt: 250, it: 4.5e-3, rl: 1e6, ip0: 0.24e-3, ec0: -8, span: 0.96, base: "UX6", pins: { P: "2", G: "3", T: "4", K: "5" }, heater: "pins 1 and 6", use: "sharp cutoff, closes at −8 V" },
    "6E5C": { mu: 35, kg: 1443, kp: 800, kvb: 100, x: 1.4, perv: 4.5e-3 / Math.pow(250, 1.5), vt: 250, it: 4.5e-3, rl: 1e6, ip0: 0.24e-3, ec0: -8, span: 0.96, base: "OCTAL", pins: { P: "3", G: "5", T: "4", K: "8" }, heater: "pins 2 and 7", use: "6Е5С, octal, closes at −8 V" },
    "6U5": { mu: 12, kg: 100.2e3, kp: 500, kvb: 100, x: 1.4, perv: 4e-3 / Math.pow(250, 1.5), vt: 250, it: 4e-3, rl: 1e6, ip0: 0.19e-3, ec0: -22, span: 0.76, base: "UX6", pins: { P: "2", G: "3", T: "4", K: "5" }, heater: "pins 1 and 6", use: "remote cutoff, closes at −22 V" }
  };
  // A tube's anode, cooled by radiation: P = k·(T⁴ − T0⁴), at about 400 °C at its rated dissipation
  // inside a chassis at 40 °C. It glows dull red from the Draper point (525 °C, about twice the
  // rating), cherry red by 750 °C. It warms with a time constant tau (s), longer for a bigger
  // tube: about 15 s at 1 W, half a minute at 20 W. Returns { t °C, glow 0–1, tau }
  const ANODE = { t0: 313.15, tr: 673.15, red: 798.15, full: 1023.15 };
  function anodeTemp(pa, paMax) {
    const k = paMax / (Math.pow(ANODE.tr, 4) - Math.pow(ANODE.t0, 4)), T = Math.pow(Math.max(pa, 0) / k + Math.pow(ANODE.t0, 4), 0.25);
    return { t: T - 273.15, glow: Math.min(1, Math.max(0, (T - ANODE.red) / (ANODE.full - ANODE.red))), tau: 15 * Math.pow(Math.max(paMax, 0.1), 0.25) };
  }
  // the shadow of an eye, 0 (closed) to 1 (90°), and its target's glow, 0 to 1, from the target's
  // and the ray-control electrode's voltages over the cathode
  function eyeShadow(m, vt, vp) {
    if (!(vt > 1)) return { shadow: 0, glow: 0 };
    return { shadow: Math.min(1, Math.max(0, (vt - vp) / (m.span * vt))), glow: Math.min(1, Math.sqrt(m.perv * Math.pow(vt, 1.5) / m.it)) };
  }
  const OPAMPS = {
    "LM741": { units: 1, a0: 200e3, gbw: 1e6, sr: 0.5e6, rin: 2e6, ib: 80e-9, ro: 150, isc: 25e-3, isk: 25e-3, dhi: 1, dlo: 1, iq: 1.7e-3, vmax: 36, cc: 30e-12, input: "bipolar (NPN)", use: "the classic general-purpose op-amp" },
    "LM301A": { units: 1, a0: 160e3, gbw: 1e6, sr: 0.5e6, rin: 2e6, ib: 70e-9, ro: 150, isc: 25e-3, isk: 25e-3, dhi: 1, dlo: 1, iq: 1.8e-3, vmax: 36, cc: 0, input: "bipolar (NPN)", use: "externally compensated, 30 pF between pins 1 and 8" },
    "TL071": { units: 1, a0: 200e3, gbw: 3e6, sr: 13e6, rin: 1e12, ib: 30e-12, ro: 200, isc: 25e-3, isk: 25e-3, dhi: 1.3, dlo: 1.3, iq: 1.4e-3, vmax: 36, cc: 10e-12, input: "JFET", use: "low-noise JFET input, audio" },
    "TL072": { units: 2, a0: 200e3, gbw: 3e6, sr: 13e6, rin: 1e12, ib: 30e-12, ro: 200, isc: 25e-3, isk: 25e-3, dhi: 1.3, dlo: 1.3, iq: 1.4e-3, vmax: 36, cc: 10e-12, input: "JFET", use: "dual low-noise JFET input, audio" },
    "TL074": { units: 4, a0: 200e3, gbw: 3e6, sr: 13e6, rin: 1e12, ib: 30e-12, ro: 200, isc: 25e-3, isk: 25e-3, dhi: 1.3, dlo: 1.3, iq: 1.4e-3, vmax: 36, cc: 10e-12, input: "JFET", use: "quad low-noise JFET input, audio" },
    "NE5532": { units: 2, a0: 100e3, gbw: 10e6, sr: 9e6, rin: 300e3, ib: 200e-9, ro: 50, isc: 38e-3, isk: 38e-3, dhi: 1.5, dlo: 1.5, iq: 4e-3, vmax: 44, cc: 10e-12, input: "bipolar (NPN)", use: "dual low-noise bipolar, drives 600 Ω" },
    "OPA134": { units: 1, a0: 1e6, gbw: 8e6, sr: 20e6, rin: 1e13, ib: 5e-12, ro: 50, isc: 40e-3, isk: 40e-3, dhi: 1, dlo: 1, iq: 4e-3, vmax: 36, cc: 10e-12, input: "FET", use: "low-distortion FET input, audio" },
    "OPA2134": { units: 2, a0: 1e6, gbw: 8e6, sr: 20e6, rin: 1e13, ib: 5e-12, ro: 50, isc: 40e-3, isk: 40e-3, dhi: 1, dlo: 1, iq: 4e-3, vmax: 36, cc: 10e-12, input: "FET", use: "dual low-distortion FET input, audio" },
    "LM4562": { units: 2, a0: 1e7, gbw: 55e6, sr: 20e6, rin: 30e3, ib: 10e-9, ro: 50, isc: 53e-3, isk: 42e-3, dhi: 1.4, dlo: 1.4, iq: 5e-3, vmax: 34, cc: 10e-12, input: "bipolar (NPN)", use: "dual ultra-low distortion bipolar, audio" },
    "LM324": { units: 4, a0: 100e3, gbw: 1.2e6, sr: 0.5e6, rin: 2e6, ib: -20e-9, ro: 100, isc: 40e-3, isk: 20e-3, dhi: 1.5, dlo: 0.02, iq: 0.25e-3, vmax: 32, cc: 10e-12, input: "bipolar (PNP), down to V−", use: "quad, single supply: inputs and output reach V−" }
  };
  // the pins of each amplifier in its package: IN+, IN−, OUT and the supply (pins 1 and 8 of an
  // LM301A carry its compensation)
  const OPAMP_PINS = {
    1: [{ "+": 3, "-": 2, OUT: 6 }],
    2: [{ "+": 3, "-": 2, OUT: 1 }, { "+": 5, "-": 6, OUT: 7 }],
    4: [{ "+": 3, "-": 2, OUT: 1 }, { "+": 5, "-": 6, OUT: 7 }, { "+": 10, "-": 9, OUT: 8 }, { "+": 12, "-": 13, OUT: 14 }]
  };
  const rotaryWays = c => Math.min(Math.max(Math.round(+c.params.ways) || 4, 2), 12);
  const CONTROLLED_PINS = () => [{ id: "+", x: 10, y: -30, name: "out +" }, { id: "-", x: 10, y: 30, name: "out −" }, { id: "C+", x: -30, y: -20, name: "control +" }, { id: "C-", x: -30, y: 20, name: "control −" }];
  const OPAMP_SUPPLY = { 1: { "V+": 7, "V-": 4 }, 2: { "V+": 8, "V-": 4 }, 4: { "V+": 4, "V-": 11 } };
  // Power amplifier ICs, the op-amp macromodel with the datasheets' values (TI, ST): as OPAMPS,
  // plus pmax the package's dissipation (W, on a heatsink), vmin the least supply, gmin the
  // least closed-loop gain it is stable at, pins: package pin numbers by symbol pin, and pout a
  // typical output. The LM386 has its gain network inside: 50 kΩ from each input to ground, the
  // output biased at half the supply from pin 7, the gain 20 (2 × 15 kΩ / 1.5 kΩ) or 200 with
  // pins 1 and 8 bypassed. The LM3886's mute (pin 8) lets it play once 0.5 mA is drawn from it
  // (it sits 2.6 V below GND, pin 7): a resistor to V−.
  const CHIPAMPS = {
    "LM386": { a0: 1e5, gbw: 6e6, sr: 2e6, rin: 1e12, ib: 0, ro: 1, isc: 0.5, isk: 0.5, dhi: 1, dlo: 0.6, iq: 4e-3, vmax: 12, vmin: 4, cc: 10e-12, pmax: 1.25, gmin: 20, pkg: "DIP-8",
      pins: { "+": "3", "-": "2", OUT: "5", "V+": "6", "V-": "4", G1: "1", G8: "8", BYP: "7" }, pout: "0.3 W into 8 Ω from 6 V, 0.7 W from 9 V", use: "low-voltage, gain 20–200, battery amps and headphones" },
    "TDA2050": { a0: 1e4, gbw: 3e6, sr: 8e6, rin: 500e3, ib: 0.1e-6, ro: 0.2, isc: 4, isk: 4, dhi: 2.5, dlo: 2.5, iq: 55e-3, vmax: 50, vmin: 9, cc: 10e-12, pmax: 25, gmin: 16, pkg: "TO-220-5",
      pins: { "+": "1", "-": "2", "V-": "3", OUT: "4", "V+": "5" }, pout: "about 25 W into 4 Ω from ±18 V", use: "32 W hi-fi, Pentawatt" },
    "LM3886": { a0: 5.6e5, gbw: 8e6, sr: 19e6, rin: 1e6, ib: 0.2e-6, ro: 0.1, isc: 11.5, isk: 11.5, dhi: 3.2, dlo: 3.2, iq: 50e-3, vmax: 84, vmin: 20, cc: 10e-12, pmax: 125, gmin: 10, pkg: "TO-220-11",
      pins: { "V+": "1,5", OUT: "3", "V-": "4", GND: "7", MUTE: "8", "-": "9", "+": "10" }, pout: "68 W into 4 Ω, 38 W into 8 Ω from ±28 V", use: "68 W, mute, overture series" }
  };
  // the amplifier of a dual or quad from the designation suffix: DA1.2 is the second one
  const opampUnit = c => { const m = OPAMPS[c.params.model] || OPAMPS.TL071, k = +((/\.(\d+)$/.exec(c.label || "") || [])[1] || 1); return k >= 1 && k <= m.units ? k : 1; };
  // the engine's macromodel (sim-engine.js Semi.opamp) from the datasheet values: stage two has a
  // gain of 1000, stage one the rest; with the Miller capacitor Cc, gm1 = 2π·GBW·Cc and i1 = SR·Cc.
  // Above 3 MHz stage two's gm grows with the GBW, so its pole stays as far above it
  function opampModel(m) {
    const cc = m.cc || 30e-12, gm1 = 2 * Math.PI * m.gbw * cc, k = Math.max(1, m.gbw / 3e6), gm2 = 2e-3 * k, r2 = 5e5 / k;
    return { gm1, i1: m.sr * cc, r1: m.a0 / (gm1 * gm2 * r2), gm2, i2: 2e-3 * k, r2, rin: m.rin, ib: m.ib, ro: m.ro, isc: m.isc, isk: m.isk, dhi: m.dhi, dlo: m.dlo, iq: m.iq };
  }
  // the catalog of a transistor part type, and which types are transistors (FETs: Vds, Id, Vgs)
  const isTransistor = t => /^(npn|pnp|nmos|pmos|njf|pjf)$/.test(t), isFet = t => /^(nmos|pmos|njf|pjf)$/.test(t);
  const semiTable = t => (t === "npn" || t === "pnp" ? BJTS : t === "njf" || t === "pjf" ? JFETS : MOSFETS);
  const semiRating = m => `${m.v} V, ${m.i} A, ${m.p} W, ${m.pkg}`;
  // the Type list of a transistor; a third element sorts the entry under a heading (Silicon / Germanium)
  const semiOptions = (tab, pol) => () => Object.entries(tab).filter(([, m]) => m.pol === pol).map(([k, m]) => [k, `${k} · ${m.v} V ${m.i} A ${m.p} W · ${m.use}`, tab === BJTS ? (m.ge ? "Germanium" : "Silicon") : undefined]);
  // Mirror (M), for every part that can be rotated: the inspector field is added by the CAD
  // (cad-app.js), so new parts get it without listing it here
  const FLIP_FIELD = { key: "flip", label: "Mirror (M)", kind: "select", options: [["no", "No"], ["yes", "Mirrored left–right"]] };
  // A transistor's model at junction temperature t (°C; the data are at 25 °C), as SPICE scales
  // it: IS ∝ (T/T0)³·exp(Eg/k·(1/T0 − 1/T)) with Eg 0.67 eV germanium, 1.11 eV silicon, so VBE
  // falls about 2 mV/°C; BF and BR ∝ (T/T0)^1.5; vt = kT/q. Germanium leakage doubles every 10 °C.
  const T0 = 298.15, K_Q = 8.617333e-5;
  function bjtAt(m, t) {
    const T = (isFinite(t) ? t : 25) + 273.15, r = T / T0, eg = m.ge ? 0.67 : 1.11;
    return Object.assign({}, m, { is: m.is * Math.pow(r, 3) * Math.exp(eg / K_Q * (1 / T0 - 1 / T)), bf: m.bf * Math.pow(r, 1.5), br: (m.br || 1) * Math.pow(r, 1.5),
      vt: 0.025852 * r,   // the simulator's kT/q at 25 °C, scaled
      icbo: m.icbo ? m.icbo * Math.pow(2, (T - T0) / 10) : 0, t: T - 273.15 });
  }
  // BJT and MOSFET parts: same pins (C/D up, B/G left, E/S down) for both polarities
  function bjtPart(pol) {
    const def = pol > 0 ? "2N3904" : "2N3906";
    return {
      name: pol > 0 ? "NPN transistor" : "PNP transistor", prefix: "VT", group: "Semiconductors", bbox: [-30, -30, 22, 30],
      defaults: { model: def },
      pins: () => [{ id: "C", x: 10, y: -30, name: "collector" }, { id: "B", x: -30, y: 0, name: "base" }, { id: "E", x: 10, y: 30, name: "emitter" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: semiOptions(BJTS, pol), wide: true },
        // junction temperature: the ambient, or warmer for a part that runs hot or sits by a tube
        { key: "temp", label: "Temperature", unit: "°C", kind: "number", min: -40, max: 150, dflt: 25 }],
      info: c => { const m = BJTS[c.params.model] || BJTS[def], t = isFinite(c.params.temp) ? c.params.temp : 25, a = bjtAt(m, t);
        return `${c.params.model} (${m.use}): Vceo ${m.v} V, Ic ${m.i} A, Ptot ${m.p} W, ${m.pkg}. Model: Gummel-Poon${m.ge ? " (germanium)" : ""} at ${t} °C, hFE ≈ ${Math.round(a.bf)}, Early voltage ${Math.round(m.vaf)} V${m.rb || m.re ? `, base resistance ${m.rb || 0} Ω, emitter resistance ${fmtEng(m.re || 0, "Ω")}` : ""}${m.ge ? `, leakage ICBO ${fmtEng(a.icbo, "A", 2)} (${fmtEng(m.icbo, "A", 2)} at 25 °C, doubling every 10 °C)` : ""}.`; },
      build: (c, net, alloc, out) => {
        const m = bjtAt(Object.assign({}, BJTS[c.params.model] || BJTS[def], { pol }), c.params.temp);
        // base and emitter resistance: the junctions sit on inner nodes behind them, the capacitances too
        const b = m.rb ? alloc() : net("B"), e = m.re ? alloc() : net("E");
        out.push(Object.assign({ id: c.id, kind: "BJT", nodes: [net("C"), b, e], model: { pol, is: m.is, bf: m.bf, br: m.br, vaf: m.vaf, ikf: m.ikf, nf: 1, vt: m.vt, icbo: m.icbo, t: m.t, ge: m.ge ? 1 : 0, rb: m.rb || 0, re: m.re || 0 } },
          m.rb || m.re ? { ext: [net("C"), net("B"), net("E")] } : {}));
        if (m.rb) out.push({ id: c.id + "#rb", kind: "R", nodes: [net("B"), b], r: m.rb });
        if (m.re) out.push({ id: c.id + "#re", kind: "R", nodes: [e, net("E")], r: m.re });
        out.push({ id: c.id + "#cbe", kind: "C", nodes: [b, e], c: m.cbe }, { id: c.id + "#cbc", kind: "C", nodes: [b, net("C")], c: m.cbc });
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

  // JFET parts: drain up, gate left, source down. The channel is the engine's square-law FET
  // (SPICE's JFET is the same law: KP = 2·BETA), the gate a junction diode to each end
  function jfetPart(pol) {
    const def = pol > 0 ? "2N5457" : "2N5460";
    return {
      name: pol > 0 ? "N-channel JFET" : "P-channel JFET", prefix: "VT", group: "Semiconductors", bbox: [-30, -30, 22, 30],
      defaults: { model: def },
      pins: () => [{ id: "D", x: 10, y: -30, name: "drain" }, { id: "G", x: -30, y: 0, name: "gate" }, { id: "S", x: 10, y: 30, name: "source" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: semiOptions(JFETS, pol), wide: true }],
      info: c => { const m = JFETS[c.params.model] || JFETS[def], idss = m.beta * m.vto * m.vto; return `${c.params.model} (${m.use}): V(BR)GSS ${m.v} V, Ptot ${m.p} W, ${m.pkg}. Model: SPICE JFET, IDSS ${fmtEng(idss, "A", 2)}, Vgs(off) ${m.vto} V, gfs ${fmtEng(2 * idss / Math.abs(m.vto), "S", 2)} at IDSS, gate junctions included (the gate conducts above about ${pol > 0 ? "+" : "−"}0.5 V). Real parts spread widely: IDSS and Vgs(off) vary several times between samples of one type.`; },
      build: (c, net, alloc, out) => {
        const m = JFETS[c.params.model] || JFETS[def], d = net("D"), g = net("G"), s = net("S");
        out.push({ id: c.id, kind: "MOS", nodes: [d, g, s], model: { pol, vto: m.vto, kp: 2 * m.beta, lambda: m.lambda, jf: { beta: m.beta, is: m.is } } });
        // the gate junctions (exported inside the SPICE JFET, so internal there)
        out.push({ id: c.id + "#gs", kind: "D", nodes: pol > 0 ? [g, s] : [s, g], is: m.is, n: 1, internal: true }, { id: c.id + "#gd", kind: "D", nodes: pol > 0 ? [g, d] : [d, g], is: m.is, n: 1, internal: true });
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
  // a capacitor's voltage rating: Checks warns from 80 % of it; left unset, the BOM picks one from the simulation
  const capRatingField = list => ({ key: "v", label: "Voltage rating", kind: "select", options: [["", "Not set (the BOM picks one)"]].concat(list.map(v => [String(v), v + " V"])) });
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
      defaults: { c: 0.1e-6, v: "" },
      pins: () => [{ id: "1", x: -20, y: 0 }, { id: "2", x: 20, y: 0 }],
      value: c => fmtEng(c.params.c, "F") + (+c.params.v ? " " + c.params.v + "V" : ""),
      fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "eng" }, capRatingField([50, 63, 100, 160, 250, 400, 630, 1000, 1600, 2000, 3000])],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "C", nodes: [net("1"), net("2")], c: Math.max(c.params.c, 1e-15) })
    },
    electrolytic: {
      name: "Electrolytic cap", prefix: "C", group: "Passive", bbox: [-20, -12, 20, 12],
      defaults: { c: 47e-6, v: "" },
      pins: () => [{ id: "+", x: -20, y: 0 }, { id: "-", x: 20, y: 0 }],
      value: c => fmtEng(c.params.c, "F") + (+c.params.v ? " " + c.params.v + "V" : ""),
      fields: [{ key: "c", label: "Capacitance", unit: "F", kind: "eng" }, capRatingField([6.3, 10, 16, 25, 35, 50, 63, 100, 160, 200, 250, 350, 400, 450, 500, 550])],
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
      name: "Switch (changeover)", prefix: "SA", group: "Switches & relays", bbox: [-30, -14, 30, 14],
      defaults: { pos: "A" },
      flip: c => (c.params.pos === "B" ? "A" : "B"),
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
    // an on–off switch: a toggle, or a push button that makes (NO) or breaks (NC) while pressed.
    // pos "on" / "off" is the toggle's position or whether the button is held down
    spst: {
      name: "Switch (on–off)", prefix: "SA", group: "Switches & relays", bbox: [-30, -16, 30, 8],
      defaults: { kind: "toggle", pos: "off" },
      flip: c => (c.params.pos === "on" ? "off" : "on"),
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => (c.params.kind === "toggle" ? (c.params.pos === "on" ? "on" : "off") : c.params.pos === "on" ? "pressed" : "released"),
      fields: [{ key: "kind", label: "Kind", kind: "select", options: [["toggle", "Toggle (stays where it is put)"], ["no", "Push button, normally open (makes while pressed)"], ["nc", "Push button, normally closed (breaks while pressed)"]], wide: true },
        { key: "pos", label: "Position", kind: "select", options: c => (c.params.kind === "toggle" ? [["off", "Off (open)"], ["on", "On (closed)"]] : [["off", "Released"], ["on", "Pressed"]]) }],
      // closed 10 mΩ, open 10 GΩ (as the changeover switch)
      build: (c, net, alloc, out) => { const shut = (c.params.pos === "on") !== (c.params.kind === "nc"); out.push({ id: c.id, kind: "R", nodes: [net("1"), net("2")], r: shut ? 0.01 : 1e10 }); }
    },
    // a rotary selector, one pole of n ways: the common C to way pos. Sections of one switch (SA1.1,
    // SA1.2: a 2-pole selector) turn together
    rotary: {
      name: "Rotary switch", prefix: "SA", group: "Switches & relays",
      bbox: c => { const n = rotaryWays(c); return [-30, -10 * (n - 1) - 12, 30, 10 * (n - 1) + 8]; },
      defaults: { ways: 4, pos: "1" },
      flip: c => String(+c.params.pos % rotaryWays(c) + 1),
      pins: c => { const n = rotaryWays(c); return [{ id: "C", x: -30, y: 0, name: "common (wiper)" }].concat(Array.from({ length: n }, (_, k) => ({ id: String(k + 1), x: 30, y: 10 * (2 * k - n + 1), name: "way " + (k + 1) }))); },
      value: c => `${rotaryWays(c)} ways → ${c.params.pos}`,
      fields: [{ key: "ways", label: "Ways", kind: "select", options: [2, 3, 4, 5, 6, 8, 10, 12].map(n => [String(n), n + " ways"]) },
        { key: "pos", label: "Position", kind: "select", options: c => Array.from({ length: rotaryWays(c) }, (_, k) => [String(k + 1), "Way " + (k + 1)]) }],
      build: (c, net, alloc, out) => {
        const n = rotaryWays(c), on = Math.min(Math.max(Math.round(+c.params.pos) || 1, 1), n);
        for (let k = 1; k <= n; k++) out.push({ id: k === on ? c.id : c.id + "#" + k, kind: "R", nodes: [net("C"), net(String(k))], r: k === on ? 0.01 : 1e10 });
      }
    },
    // a relay: the coil (A1–A2: its resistance, then its inductance) and the contacts of each pole,
    // COM 11 to NC 12 at rest and to NO 14 pulled in (21, 22, 24 the second pole), as EN 50005 numbers them
    relay: {
      name: "Relay", prefix: "K", group: "Switches & relays",
      bbox: c => [-30, -30, (RELAYS[c.params.model] || RELAYS["G5LE-1"]).poles > 1 ? 60 : 30, 30],
      defaults: { model: "G5LE-1", v: "12" },
      pins: c => {
        const m = RELAYS[c.params.model] || RELAYS["G5LE-1"], pins = [{ id: "A1", x: -20, y: -30, name: "coil +" }, { id: "A2", x: -20, y: 30, name: "coil −" }];
        for (let k = 1; k <= m.poles; k++) { const x = 30 * k - 10; pins.push({ id: k + "1", x, y: 30, name: `common (pole ${k})` }, { id: k + "2", x: x - 10, y: -30, name: `normally closed (pole ${k})` }, { id: k + "4", x: x + 10, y: -30, name: `normally open (pole ${k})` }); }
        return pins;
      },
      value: c => `${c.params.model} ${c.params.v} V`,
      fields: [{ key: "model", label: "Type", kind: "select", options: () => Object.entries(RELAYS).map(([k, m]) => [k, `${k} · ${m.use}`]), wide: true },
        { key: "v", label: "Coil voltage", kind: "select", options: [["5", "5 V DC"], ["12", "12 V DC"], ["24", "24 V DC"]] }],
      info: c => {
        const m = RELAYS[c.params.model] || RELAYS["G5LE-1"], v = +c.params.v || 12, k = relayCoil(m, v);
        return `Omron ${c.params.model}, ${m.use}. Coil ${v} V: ${fmtEng(k.r, "Ω")}, ${fmtEng(v / k.r, "A")} (${fmtEng(m.pw, "W")}); it pulls in at ${fmtEng(m.op * v, "V")} (${m.op * 100} %) and drops out below ${fmtEng(m.rel * v, "V")} (${m.rel * 100} %), operate time ${fmtEng(m.top, "s")} max. ` +
          `Contacts ${fmtEng(m.ron, "Ω")} closed. Simulated: the coil's resistance and inductance (${fmtEng(k.l, "H")}, so its current builds up as a real coil's does), the contacts switching on its current. Put a diode across the coil when a transistor drives it: the inductance kicks back when it lets go.`;
      },
      build: (c, net, alloc, out) => {
        const m = RELAYS[c.params.model] || RELAYS["G5LE-1"], k = relayCoil(m, +c.params.v || 12), mid = alloc(), nodes = [net("A1"), mid];
        out.push({ id: c.id + "#r", kind: "R", nodes: [net("A1"), mid], r: k.r });
        out.push({ id: c.id + "#l", kind: "L", nodes: [mid, net("A2")], l: k.l });
        for (let p = 1; p <= m.poles; p++) nodes.push(net(p + "1"), net(p + "2"), net(p + "4"));
        const v = +c.params.v || 12;
        out.push({ id: c.id, kind: "RELAY", nodes, model: { von: m.op * v, voff: m.rel * v, ron: m.ron, roff: 1e10 } });
      }
    },
    // a vactrol: an LED (A, K) lighting a CdS cell (1, 2) in one sealed case (sim-engine.js LDR)
    vactrol: {
      name: "Vactrol (LED + LDR)", prefix: "U", group: "Semiconductors", bbox: [-30, -24, 30, 24],
      defaults: { model: "VTL5C3" },
      pins: () => [{ id: "A", x: -30, y: -10, name: "LED anode" }, { id: "K", x: -30, y: 10, name: "LED cathode" }, { id: "1", x: 30, y: -10, name: "cell" }, { id: "2", x: 30, y: 10, name: "cell" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: () => Object.entries(VACTROLS).map(([k, m]) => [k, `${k} · ${m.use}`]), wide: true }],
      info: c => {
        const m = VACTROLS[c.params.model] || VACTROLS.VTL5C3;
        return `${c.params.model} (Excelitas / Xvive): the cell is ${fmtEng(m.r1, "Ω")} with 1 mA in the LED and ${fmtEng(m.r10, "Ω")} with 10 mA (typical; parts spread widely), ${fmtEng(m.rdark, "Ω")} dark. It follows the light in ${fmtEng(m.ton, "s")} brightening and ${fmtEng(m.toff, "s")} dimming (to 100 kΩ): ` +
          "that lag is what makes a vactrol tremolo throb smoothly. The LED is a red one, about 1.7 V; keep it under 40 mA. The cell is a resistor to the signal: no distortion, at any level up to its rating.";
      },
      build: (c, net, alloc, out) => {
        const m = VACTROLS[c.params.model] || VACTROLS.VTL5C3, d = vactrolModel(m), a = alloc(), k = alloc();
        out.push({ id: c.id + "#led", kind: "D", nodes: [net("A"), a], is: ledIs(LEDS.red.vf), n: 2 });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [a, k], r: 5 }, { id: c.id + "#sense", kind: "R", nodes: [k, net("K")], r: d.rs });
        out.push({ id: c.id, kind: "LDR", nodes: [net("1"), net("2"), k, net("K")], model: d });
      }
    },
    // A loudspeaker: an ideal resistor, or its Thiele–Small electrical model: the voice
    // coil (Re, Le) in series with the motional impedance, a parallel R‖L‖C resonant at fs:
    //   Res = Re·Qms/Qes, Lces = Re / (2π·fs·Qes), Ces = Qes / (2π·fs·Re)
    // Old circuits keep the resistor (the default); a speaker placed now starts as a typical driver.
    speaker: {
      name: "Speaker", prefix: "BA", group: "Passive", bbox: [-6, -20, 16, 20],
      defaults: { r: 8, model: "res", re: 6.4, le: 0.5e-3, fs: 80, qms: 5.5, qes: 0.7 },
      newDefaults: { model: "ts" },
      pins: () => [{ id: "+", x: 0, y: -20 }, { id: "-", x: 0, y: 20 }],
      value: c => fmtEng(c.params.r, "Ω") + (c.params.model === "ts" ? ` · fs ${fmtEng(c.params.fs, "Hz")}` : ""),
      fields: [
        { key: "model", label: "Model", kind: "select", options: [["ts", "Loudspeaker (Thiele–Small)"], ["res", "Resistor (ideal load)"]] },
        { key: "r", label: "Nominal impedance", unit: "Ω", kind: "eng" },
        { key: "preset", label: "Driver", kind: "select", when: c => c.params.model === "ts", options: () => [["custom", "Your datasheet values"]].concat(SPEAKER_PRESETS.map(p => [p.id, p.name])),
          get: c => (SPEAKER_PRESETS.find(p => ["r", "re", "le", "fs", "qms", "qes"].every(k => Math.abs(p[k] - c.params[k]) <= 1e-9 * Math.max(1, Math.abs(p[k])))) || { id: "custom" }).id,
          apply: (c, v) => { const p = SPEAKER_PRESETS.find(q => q.id === v); if (p) ["r", "re", "le", "fs", "qms", "qes"].forEach(k => { c.params[k] = p[k]; }); } },
        { key: "re", label: "Re (voice coil, DC)", unit: "Ω", kind: "eng", when: c => c.params.model === "ts" },
        { key: "le", label: "Le (voice coil)", unit: "H", kind: "eng", when: c => c.params.model === "ts" },
        { key: "fs", label: "fs (resonance)", unit: "Hz", kind: "eng", when: c => c.params.model === "ts" },
        { key: "qms", label: "Qms", kind: "number", min: 0.1, max: 100, when: c => c.params.model === "ts" },
        { key: "qes", label: "Qes", kind: "number", min: 0.05, max: 20, when: c => c.params.model === "ts" }
      ],
      build: (c, net, alloc, out) => {
        const p = c.params;
        if (p.model !== "ts") { out.push({ id: c.id, kind: "R", nodes: [net("+"), net("-")], r: Math.max(p.r, 0.1) }); return; }
        const m = speakerTS(p), n1 = alloc(), n2 = alloc();
        out.push({ id: c.id + "#re", kind: "R", nodes: [net("+"), n1], r: m.re });
        if (m.le > 0) out.push({ id: c.id + "#le", kind: "L", nodes: [n1, n2], l: m.le }); else out.push({ id: c.id + "#le", kind: "R", nodes: [n1, n2], r: 1e-6 });
        out.push({ id: c.id + "#res", kind: "R", nodes: [n2, net("-")], r: m.res }, { id: c.id + "#lces", kind: "L", nodes: [n2, net("-")], l: m.lces }, { id: c.id + "#ces", kind: "C", nodes: [n2, net("-")], c: m.ces });
      }
    },
    opt_se: {
      name: "Output transformer, single-ended", prefix: "T", group: "Transformers", bbox: [-40, -34, 40, 34],
      defaults: { zp: 5000, zs: 8, lp: 20, llk: 15e-3, cw: 200e-12, dcrp: 150, dcrs: 0.5, idc: 0.1, pw: 10, flo: 40 },
      pins: () => [{ id: "P1", x: -40, y: -30, name: "primary (B+)" }, { id: "P2", x: -40, y: 30, name: "primary (anode)" }, { id: "S1", x: 40, y: -30 }, { id: "S2", x: 40, y: 30 }],
      value: c => { const m = optModel(c); return (m ? m.id + " " : "") + fmtEng(c.params.zp, "") + ":" + fmtEng(c.params.zs, "Ω"); },
      fields: [
        { key: "model", label: "Model", kind: "select", wide: true, options: () => [["custom", "Your datasheet values"]].concat(Object.entries(OPT_SE).map(([k, m]) => [k, `${m.name} · ${fmtEng(m.p.zp, "Ω")}, ${m.w} W, ${m.ma} mA`])),
          get: c => (optModel(c) || { id: "custom" }).id,
          apply: (c, v) => { const m = OPT_SE[v]; if (m) Object.assign(c.params, m.p); } },
        { key: "zp", label: "Primary impedance", unit: "Ω", kind: "eng" },
        { key: "zs", label: "Secondary impedance", unit: "Ω", kind: "eng" },
        { key: "lp", label: "Primary inductance", unit: "H", kind: "eng" },
        { key: "llk", label: "Leakage inductance", unit: "H", kind: "eng" },
        { key: "cw", label: "Winding capacitance", unit: "F", kind: "eng" },
        { key: "dcrp", label: "Primary DCR", unit: "Ω", kind: "eng" },
        { key: "dcrs", label: "Secondary DCR", unit: "Ω", kind: "eng" },
        { key: "idc", label: "Max DC current", unit: "A", kind: "eng" },
        { key: "pw", label: "Rated power (0: core never saturates)", unit: "W", kind: "eng" },
        { key: "flo", label: "Full power down to", unit: "Hz", kind: "eng" }
      ],
      info: c => optInfo(c),
      build: (c, net, alloc, out) => {
        const p = c.params, zp = Math.max(+p.zp || 1, 1), n = Math.sqrt(zp / Math.max(+p.zs || 0.01, 0.01)), lp = Math.max(+p.lp || 0, 1e-3);
        const a = alloc(), s = alloc();
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), a], r: Math.max(+p.dcrp || 0, 1e-3) });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(+p.dcrs || 0, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp, k: 1, primaryTurns: 1, sat: optSat(lp, zp, +p.pw, +p.flo, +p.idc),
          windings: [{ a: a, b: net("P2"), turns: 1, leak: Math.max(+p.llk || 0, 1e-6 * lp) }, { a: s, b: net("S2"), turns: 1 / n }] });
        if (+p.cw > 0) out.push({ id: c.id + "#cw", kind: "C", nodes: [net("P1"), net("P2")], c: +p.cw });
      }
    },
    itx: {
      name: "Interstage / input transformer", prefix: "T", group: "Transformers", bbox: [-40, -34, 40, 34],
      defaults: itxPreset("is11"),
      pins: c => [{ id: "P1", x: -40, y: -30, name: "primary (start, dot)" }, { id: "P2", x: -40, y: 30, name: "primary (end)" }, { id: "S1", x: 40, y: -30, name: "secondary (start, dot)" },
        ...(c.params.ct === "yes" ? [{ id: "SC", x: 40, y: 0, name: "secondary centre tap" }] : []), { id: "S2", x: 40, y: 30, name: "secondary (end)" }],
      value: c => "1:" + fmtEng(c.params.ratio, "") + (c.params.ct === "yes" ? " CT" : ""),
      fields: [
        { key: "preset", label: "Kind", kind: "select", wide: true, options: () => [["custom", "Your datasheet values"]].concat(ITX_PRESETS.map(p => [p.id, p.name])),
          get: c => (ITX_PRESETS.find(p => ITX_KEYS.every(k => (typeof p[k] === "string" ? p[k] === c.params[k] : Math.abs(p[k] - c.params[k]) <= 1e-9 * Math.max(1, Math.abs(p[k]))))) || { id: "custom" }).id,
          apply: (c, v) => { const p = ITX_PRESETS.find(q => q.id === v); if (p) ITX_KEYS.forEach(k => { c.params[k] = p[k]; }); } },
        { key: "ratio", label: "Turns ratio, secondary : primary (1 : n)", unit: "", kind: "eng" },
        { key: "ct", label: "Secondary centre tap", kind: "select", options: [["no", "No"], ["yes", "Yes (SC pin)"]] },
        { key: "lp", label: "Primary inductance", unit: "H", kind: "eng" },
        { key: "llk", label: "Leakage inductance (primary)", unit: "H", kind: "eng" },
        { key: "cs", label: "Secondary winding capacitance", unit: "F", kind: "eng" },
        { key: "dcrp", label: "Primary DCR", unit: "Ω", kind: "eng" },
        { key: "dcrs", label: "Secondary DCR", unit: "Ω", kind: "eng" },
        { key: "idc", label: "Primary DC rating (0: ungapped)", unit: "A", kind: "eng" }
      ],
      info: c => {
        const p = c.params, n = +p.ratio || 1;
        return `A small-signal transformer, 1:${fmtEng(n, "")}${p.ct === "yes" ? " with a centre-tapped secondary (SC) for a push-pull pair's grids" : ""}. ` +
          `It steps the voltage up ${fmtEng(n, "")} times and the impedance ${fmtEng(n * n, "")} times. The bass falls where the primary inductance (${fmtEng(p.lp, "H")}) meets the source resistance; ` +
          `the treble where the leakage inductance (${fmtEng(p.llk, "H")}) resonates with the secondary's capacitance (${fmtEng(p.cs, "F")}, ${fmtEng(p.cs * n * n, "F")} seen at the primary): ` +
          `load the secondary to damp that peak. ${+p.idc > 0 ? `Gapped for ${fmtEng(p.idc, "A")} of DC in the primary (the driver's idle current, parafeed not needed).` : "Ungapped: keep DC out of the primary (parafeed through a capacitor, or a push-pull driver)."} ` +
          "Not modelled: core saturation and losses (Checks warn when the DC exceeds the rating).";
      },
      build: (c, net, alloc, out) => {
        const p = c.params, n = Math.max(+p.ratio || 1, 1e-3), lp = Math.max(+p.lp || 1, 1e-3), k = Math.min(0.99999, Math.sqrt(Math.max(0, 1 - Math.max(+p.llk || 0, 0) / lp)));
        const a = alloc(), s = alloc(), ct = p.ct === "yes", s2 = ct ? alloc() : 0, rs = Math.max(+p.dcrs || 0, 1e-3);
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), a], r: Math.max(+p.dcrp || 0, 1e-3) });
        // a centre-tapped secondary: half its resistance in each half, so the two grids see the same
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: ct ? rs / 2 : rs });
        if (ct) out.push({ id: c.id + "#rs2", kind: "R", nodes: [s2, net("S2")], r: rs / 2 });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp, k, primaryTurns: 1,
          windings: ct ? [{ a, b: net("P2"), turns: 1 }, { a: s, b: net("SC"), turns: n / 2 }, { a: net("SC"), b: s2, turns: n / 2 }]
            : [{ a, b: net("P2"), turns: 1 }, { a: s, b: net("S2"), turns: n }] });
        if (+p.cs > 0) out.push({ id: c.id + "#cs", kind: "C", nodes: [net("S1"), net("S2")], c: +p.cs });
      }
    },
    gasreg: {
      // ГОСТ 2.747: a gas-discharge voltage regulator (стабилитрон тлеющего разряда), VL like any tube
      name: "Gas voltage regulator", prefix: "VL", group: "Tubes", bbox: [-20, -30, 20, 30],
      defaults: { model: "0A2" },
      pins: () => [{ id: "A", x: 0, y: -30, name: "anode" }, { id: "K", x: 0, y: 30, name: "cathode" }],
      pinNumbers: () => ({ A: "5", K: "2" }),
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true, options: () => Object.entries(GASREGS).map(([k, m]) => [k, `${k} · ${m.vm} V, ${m.imin * 1000}–${m.imax * 1000} mA · ${m.use}`]) }],
      info: c => {
        const m = GASREGS[c.params.model] || GASREGS["0A2"];
        return `${c.params.model}: a glow-discharge regulator holding about ${m.vm} V across it at ${m.imin * 1000}–${m.imax * 1000} mA (it rises ${(m.r * (m.imax - m.imin)).toFixed(1)} V over that range). ` +
          `Feed it through a resistor from a supply that reaches its striking voltage (${m.vs} V) at power-on: until then it is dark and passes nothing. Below about ${m.iext * 1000} mA it goes out. ` +
          `Keep the capacitance across it at 0.1 µF or less: more makes it oscillate (relax). Pins: anode 5, cathode 2 (${m.socket === "B7G" ? "miniature B7G" : "octal"} socket).`;
      },
      build: (c, net, alloc, out) => {
        const m = GASREGS[c.params.model] || GASREGS["0A2"];
        out.push({ id: c.id, kind: "GLOW", nodes: [net("A"), net("K")], model: { vm: m.vm, vs: m.vs, r: m.r, iext: m.iext } });
      }
    },
    neon: {
      // HL: an indicator lamp (ГОСТ 2.732). Two glow discharges back to back, as a neon lights
      // on either polarity (on AC both electrodes glow); a 100 Ω sense resistor carries its current
      name: "Neon lamp", prefix: "HL", group: "Gas-discharge tubes", bbox: [-20, -12, 20, 12],
      defaults: { model: "NE-2" },
      pins: () => [{ id: "A", x: -20, y: 0, name: "electrode" }, { id: "K", x: 20, y: 0, name: "electrode" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true, options: () => Object.entries(NEONS).map(([k, m]) => [k, `${k} · strikes at ${m.vs} V, ${fmtEng(m.i, "A")} · ${m.use}`]) }],
      info: c => {
        const m = NEONS[c.params.model] || NEONS["NE-2"];
        return `${c.params.model} (${m.use}): dark until about ${m.vs} V across it, then it holds about ${m.vm} V and glows orange, brighter with its current (${fmtEng(m.i, "A")} design). ` +
          `It needs a series resistor: ${fmtEng(m.rser, "Ω")} on 230 V mains, about (supply − ${m.vm} V) / ${fmtEng(m.i, "A")} on DC. Below about ${fmtEng(m.iext, "A")} it goes out. ` +
          "Either way round: on AC it lights on both half-cycles. With a capacitor across it, fed through a large resistor, it flashes (a relaxation oscillator).";
      },
      build: (c, net, alloc, out) => {
        const m = NEONS[c.params.model] || NEONS["NE-2"], mid = alloc(), g = { vm: m.vm, vs: m.vs, r: m.r, iext: m.iext };
        out.push({ id: c.id, kind: "GLOW", nodes: [net("A"), mid], model: g }, { id: c.id + "#rev", kind: "GLOW", nodes: [mid, net("A")], model: g });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [mid, net("K")], r: 100 });
      }
    },
    eye: {
      // a tuning indicator (электронно-световой индикатор), VL like any tube: the target (T) with
      // its fan of green light, the triode's plate (P, inside also the ray-control electrode),
      // its grid (G) and the cathode (K). The heater is not drawn, as on the other tubes
      name: "Magic eye (tuning indicator)", prefix: "VL", group: "Gas-discharge tubes", bbox: [-30, -40, 30, 40],
      defaults: { model: "6E5" },
      pins: () => [{ id: "T", x: 0, y: -40, name: "target" }, { id: "P", x: 30, y: 10, name: "triode plate" }, { id: "G", x: -30, y: 20, name: "grid" }, { id: "K", x: 0, y: 40, name: "cathode" }],
      pinNumbers: c => Object.assign({}, (EYES[c.params.model] || EYES["6E5"]).pins),
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true, options: () => Object.entries(EYES).map(([k, m]) => [k, `${k} · ${m.use}`]) }],
      info: c => {
        const m = EYES[c.params.model] || EYES["6E5"];
        return `${c.params.model} (${m.use}): the target at ${m.vt} V draws about ${fmtEng(m.it, "A")} and glows green; the triode's plate goes to the same supply through ${fmtEng(m.rl, "Ω")}. ` +
          `With the grid at the cathode the plate sits low and the shadow opens to 90°; as the grid goes negative (the AGC of a tuned radio, a rectified signal for a level meter) the plate rises towards the target and the shadow closes, shut at about ${m.ec0} V. ` +
          `Under Animate the eye opens and closes with its grid. Pins: target ${m.pins.T}, plate ${m.pins.P}, grid ${m.pins.G}, cathode ${m.pins.K}, heater ${m.heater} (6.3 V, 0.3 A), ${m.base === "OCTAL" ? "octal" : "6-pin"} base.`;
      },
      build: (c, net, alloc, out) => {
        const m = EYES[c.params.model] || EYES["6E5"];
        out.push({ id: c.id, kind: "TRIODE", nodes: [net("P"), net("G"), net("K")], model: { mu: m.mu, kg: m.kg, kp: m.kp, kvb: m.kvb, x: m.x } });
        out.push({ id: c.id + "#t", kind: "VDIODE", nodes: [net("T"), net("K")], perveance: m.perv, part: "target" });
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
          `Turns ratio ${Math.sqrt(10000 / z).toFixed(1)}:1, so the primary sees 10 kΩ with ${z} Ω, 5 kΩ with ${z / 2} Ω, 2.5 kΩ with ${z / 4} Ω on the secondary. ` +
          `Leakage ${fmtEng(SE125.llk, "H")} (not on the drawing: 1 dB down at 15 kHz from 5 kΩ) and ${fmtEng(SE125.cw, "F")} across the primary (typical). ` +
          `The core saturates past ${m.w} W at 100 Hz with ${m.ma} mA DC (5 kΩ): below 100 Hz at full power the bass distorts, as on the real part.`;
      },
      build: (c, net, alloc, out) => {
        const m = OUTPUT_TX[c.params.model] || OUTPUT_TX["125ESE"], z = SE_TAPS[c.params.tap] || 8, n = Math.sqrt(10000 / z);
        const a = alloc(), s = alloc();
        out.push({ id: c.id + "#rp", kind: "R", nodes: [net("P1"), a], r: m.rp });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(m.rs[c.params.tap] || 0.2, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp: m.lp, k: 1, primaryTurns: 1, sat: optSat(m.lp, 5000, m.w, 100, m.ma / 1000),
          windings: [{ a: a, b: net("P2"), turns: 1, leak: SE125.llk }, { a: s, b: net("S2"), turns: 1 / n }] });
        out.push({ id: c.id + "#cw", kind: "C", nodes: [net("P1"), net("P2")], c: SE125.cw });
      }
    },
    opt_pp: {
      name: "Output transformer, push-pull / UL", prefix: "T", group: "Transformers", bbox: [-40, -44, 40, 44],
      defaults: { zaa: 8000, zs: 8, lp: 30, llk: 20e-3, cw: 300e-12, tap: 43, dcrp: 120, dcrs: 0.4, pw: 30, flo: 30 },
      pins: () => [
        { id: "P1", x: -40, y: -40, name: "anode 1" }, { id: "U1", x: -40, y: -20, name: "UL tap 1" }, { id: "CT", x: -40, y: 0, name: "centre tap (B+)" },
        { id: "U2", x: -40, y: 20, name: "UL tap 2" }, { id: "P2", x: -40, y: 40, name: "anode 2" }, { id: "S1", x: 40, y: -30 }, { id: "S2", x: 40, y: 30 }],
      value: c => { const m = optModel(c); return (m ? m.id + " " : "") + fmtEng(c.params.zaa, "") + ":" + fmtEng(c.params.zs, "Ω"); },
      fields: [
        { key: "model", label: "Model", kind: "select", wide: true, options: () => [["custom", "Your datasheet values"]].concat(Object.entries(OPT_PP).map(([k, m]) => [k, `${m.name} · ${fmtEng(m.p.zaa, "Ω")}, ${m.w} W`])),
          get: c => (optModel(c) || { id: "custom" }).id,
          apply: (c, v) => { const m = OPT_PP[v]; if (m) Object.assign(c.params, m.p); } },
        { key: "zaa", label: "Plate-to-plate Z", unit: "Ω", kind: "eng" },
        { key: "zs", label: "Secondary impedance", unit: "Ω", kind: "eng" },
        { key: "lp", label: "Primary inductance (plate to plate)", unit: "H", kind: "eng" },
        { key: "llk", label: "Leakage inductance (plate to plate)", unit: "H", kind: "eng" },
        { key: "cw", label: "Winding capacitance (plate to plate)", unit: "F", kind: "eng" },
        { key: "tap", label: "UL tap (% of half)", unit: "%", kind: "number", min: 5, max: 95 },
        { key: "dcrp", label: "DCR per half", unit: "Ω", kind: "eng" },
        { key: "dcrs", label: "Secondary DCR", unit: "Ω", kind: "eng" },
        { key: "pw", label: "Rated power (0: core never saturates)", unit: "W", kind: "eng" },
        { key: "flo", label: "Full power down to", unit: "Hz", kind: "eng" }
      ],
      info: c => optInfo(c),
      build: (c, net, alloc, out) => {
        const p = c.params, zaa = Math.max(+p.zaa || 1, 1), n = Math.sqrt(zaa / Math.max(+p.zs || 0.01, 0.01)), lp = Math.max(+p.lp || 0, 1e-3);
        const t = Math.min(Math.max(+p.tap || 0, 5), 95) / 100, lk = Math.max(+p.llk || 0, 1e-6 * lp) / 2;   // each half's leakage, shared by its two sections
        const a1 = alloc(), a2 = alloc(), s = alloc();
        out.push({ id: c.id + "#r1", kind: "R", nodes: [net("P1"), a1], r: Math.max(+p.dcrp || 0, 1e-3) });
        out.push({ id: c.id + "#r2", kind: "R", nodes: [net("P2"), a2], r: Math.max(+p.dcrp || 0, 1e-3) });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("S1"), s], r: Math.max(+p.dcrs || 0, 1e-3) });
        out.push({ id: c.id, kind: "XFMR", nodes: [], lp, k: 1, primaryTurns: 1, sat: optSat(lp, zaa, +p.pw, +p.flo, 0),
          windings: [
            { a: a1, b: net("U1"), turns: 0.5 * (1 - t), leak: lk * (1 - t) }, { a: net("U1"), b: net("CT"), turns: 0.5 * t, leak: lk * t },
            { a: net("CT"), b: net("U2"), turns: 0.5 * t, leak: lk * t }, { a: net("U2"), b: a2, turns: 0.5 * (1 - t), leak: lk * (1 - t) },
            { a: s, b: net("S2"), turns: 1 / n }] });
        if (+p.cw > 0) out.push({ id: c.id + "#cw", kind: "C", nodes: [net("P1"), net("P2")], c: +p.cw });
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
          // the symbol ties the suppressor grid (beam plates) to the cathode, and a triode-connected
          // pentode's screen to its anode: their pins join those nets on the board
          if (tp !== "T") k = k.concat(pick(["G3"]));
          if (kind === "pentode" && (c.params.connection || kind) === "triode") out.A = out.A.concat(out.G2);
        }
        out.K = k;
        if (heater.some(p => !k.includes(p))) out.H = heater;
        for (const key in out) out[key] = out[key].join(",");
        return out;
      },
      value: c => c.params.tube + (tubeKind(tubeByName(c.params.tube)) === "pentode" && c.params.connection === "triode" ? " (triode)" : ""),
      fields: [
        { key: "tube", label: "Tube type", kind: "tube" },
        { key: "connection", label: "Model", kind: "select", options: [["pentode", "Pentode / beam (A G1 G2 K)"], ["triode", "Triode-connected (A G K)"]], when: c => tubeKind(tubeByName(c.params.tube)) === "pentode" },
        // the heater's DC potential, for the heater-to-cathode check: 0 V for a grounded heater or
        // centre tap, more for a heater raised to protect cathode followers and stacked stages
        { key: "heaterV", label: "Heater DC potential", unit: "V", kind: "number", min: -1000, max: 1000, dflt: 0,
          when: c => { const t = tubeByName(c.params.tube); return !!t && !t.directlyHeated && !!t.limits && !!(t.limits.vhk || t.limits.vhkNeg); } }
      ],
      build: (c, net, alloc, out) => {
        const t = tubeByName(c.params.tube);
        if (!t) return;
        const kind = tubeKind(t), w = tubeWarmup(t), heat = { tau: w.tau, emit: w.emit };   // the power-on transient's cathode warm-up
        if (kind === "rectifier") {
          const P = (root.TubeSimEngine.RECTIFIER_PERVEANCE[t.commonName]) || 1e-3;
          out.push({ id: c.id, part: "a1", kind: "VDIODE", nodes: [net("A1"), net("K")], perveance: P, heat });
          out.push({ id: c.id, part: "a2", kind: "VDIODE", nodes: [net("A2"), net("K")], perveance: P, heat });
        } else if ((c.params.connection || kind) === "pentode" && t.koren.Pentode) {
          out.push({ id: c.id, kind: "PENTODE", nodes: [net("A"), net("G1"), net("G2"), net("K")], model: t.koren.Pentode, heat });
          // interelectrode capacitances (tube-db.js TUBE_CAPS): input to the cathode, output from it
          const C = t.caps && t.caps.pentode;
          if (C) out.push({ id: c.id + "#cin", kind: "C", nodes: [net("G1"), net("K")], c: C.cin }, { id: c.id + "#cga", kind: "C", nodes: [net("G1"), net("A")], c: C.cga }, { id: c.id + "#cout", kind: "C", nodes: [net("A"), net("K")], c: C.cout });
        } else {
          out.push({ id: c.id, kind: "TRIODE", nodes: [net("A"), net("G"), net("K")], model: t.koren.Triode || t.koren.Pentode, heat });
          const C = t.caps && t.caps.triode;
          if (C) out.push({ id: c.id + "#cgk", kind: "C", nodes: [net("G"), net("K")], c: C.cgk }, { id: c.id + "#cga", kind: "C", nodes: [net("G"), net("A")], c: C.cga }, { id: c.id + "#cak", kind: "C", nodes: [net("A"), net("K")], c: C.cak });
        }
      }
    },
    diode: {
      name: "Silicon diode", prefix: "VD", group: "Semiconductors", bbox: [-20, -9, 20, 9],
      defaults: { model: "1N4007" },
      pins: () => [{ id: "A", x: -20, y: 0, name: "anode" }, { id: "K", x: 20, y: 0, name: "cathode" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Model", kind: "select", options: () => Object.entries(DIODES).map(([k, d]) => [k, `${k} · ${d.use}`]), wide: true }],
      info: c => {
        const d = DIODES[c.params.model] || DIODES["1N4007"];
        const rec = d.tt ? `stored charge ${fmtEng(d.tt, "s")} × I (reverse recovery${d.trr ? ` ${fmtEng(d.trr, "s")}` : ""})` : "no stored charge (no reverse recovery)";
        return `${c.params.model}: ${d.use}, ${d.pkg}. VRRM ${d.v} V, ${d.i} A average. Modelled: the forward curve (Is ${d.is}, n ${d.n}, Rs ${d.rs} Ω), ${rec}, ${fmtEng(d.cj, "F")} junction capacitance. Reverse breakdown is not simulated: Checks compares the peak reverse voltage with VRRM.`;
      },
      build: (c, net, alloc, out) => {
        const m = DIODES[c.params.model] || DIODES["1N4007"], mid = alloc();
        out.push({ id: c.id, kind: "D", nodes: [net("A"), mid], is: m.is, n: m.n, tt: m.tt || 0, cj: m.cj || 0 });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [mid, net("K")], r: m.rs });
        // the junction capacitance (exported inside the SPICE diode model as CJO, so internal there)
        if (m.cj) out.push({ id: c.id + "#cj", kind: "C", nodes: [net("A"), net("K")], c: m.cj, internal: true });
      }
    },
    bridge: {
      name: "Bridge rectifier", prefix: "VD", group: "Semiconductors", bbox: [-30, -30, 30, 30],
      defaults: { model: "DF10M" },
      pins: () => [{ id: "AC1", x: 0, y: -30, name: "AC input 1" }, { id: "+", x: 30, y: 0, name: "+ output" }, { id: "AC2", x: 0, y: 30, name: "AC input 2" }, { id: "-", x: -30, y: 0, name: "− output" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Model", kind: "select", options: () => Object.entries(BRIDGES).map(([k, b]) => [k, `${k} · ${b.use}`]), wide: true }],
      info: c => { const b = BRIDGES[c.params.model] || BRIDGES.DF10M; return `${c.params.model}: ${b.use}. Four diodes, each VRRM ${b.v} V; ${b.i} A average out of the bridge. Each diode modelled like a silicon rectifier (stored charge ${fmtEng(b.tt, "s")} × I). Checks compares the peak voltage across the bridge with VRRM.`; },
      // the four diodes: AC1 → +, AC2 → +, − → AC1, − → AC2
      build: (c, net, alloc, out) => {
        const b = BRIDGES[c.params.model] || BRIDGES.DF10M;
        [["AC1", "+"], ["AC2", "+"], ["-", "AC1"], ["-", "AC2"]].forEach(([a, k], i) => {
          const mid = alloc();
          out.push({ id: `${c.id}#d${i + 1}`, kind: "D", nodes: [net(a), mid], is: b.is, n: b.n, tt: b.tt });
          out.push({ id: `${c.id}#r${i + 1}`, kind: "R", nodes: [mid, net(k)], r: b.rs });
        });
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
    njf: jfetPart(1),
    pjf: jfetPart(-1),
    reg: {
      // DA: an analogue IC (ГОСТ 2.710). Pins I, O and A (ADJ) or G (GND), as on the package
      name: "Voltage regulator", prefix: "DA", group: "Integrated circuits", bbox: [-40, -20, 40, 30],
      defaults: { model: "LM317" },
      pins: c => [{ id: "I", x: -40, y: 0, name: "input" }, { id: "O", x: 40, y: 0, name: "output" },
        (REGS[c.params.model] || REGS.LM317).adj ? { id: "A", x: 0, y: 30, name: "adjust" } : { id: "G", x: 0, y: 30, name: "ground" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true,
        options: () => Object.entries(REGS).map(([k, m]) => [k, `${k} · ${m.use} · ${m.pkg}`, m.adj ? (m.pol > 0 ? "Adjustable, positive" : "Adjustable, negative") : m.pol > 0 ? "Fixed, positive" : "Fixed, negative"]) }],
      info: c => {
        const m = REGS[c.params.model] || REGS.LM317, sg = m.pol > 0 ? "" : "−";
        return `${c.params.model} (${m.use}), ${m.pkg}. ` + (m.adj
          ? `OUT sits ${sg}${m.vref} V from ADJ: with R1 from OUT to ADJ and R2 from ADJ to ground, Vout = ${sg}${m.vref} V × (1 + R2/R1) + ${fmtEng(m.iadj, "A")} × R2. It needs ${fmtEng(m.iq, "A")} of load or more (R1 = 240 Ω takes 5 mA), or the output creeps up. `
          : `Holds OUT at ${sg}${m.vref} V from GND, drawing ${fmtEng(m.iq, "A")} into GND. `)
          + `Modelled: the error amplifier (output resistance ${fmtEng(1 / m.g, "Ω")}), the line regulation (ripple rejection about ${Math.round(-20 * Math.log10(m.line / m.vref * (m.adj ? 4 : 1)))} dB${m.adj ? " at 5 V out, more with ADJ bypassed by 10 µF" : ""}), the current limit (${fmtEng(m.ilim, "A")}), the dropout (${m.vdo} V and more with current: keep IN at least ${(m.vdo + 0.7).toFixed(1)} V beyond OUT), and the input-output maximum of ${m.vmax} V. Not modelled: the ripple rejection falling at high frequencies, the thermal shutdown.`;
      },
      build: (c, net, alloc, out) => {
        const m = REGS[c.params.model] || REGS.LM317;
        out.push({ id: c.id, kind: "REG", nodes: [net("I"), net("O"), net(m.adj ? "A" : "G")], model: regModel(m) });
      }
    },
    tl431: {
      name: "Shunt reference (TL431)", prefix: "DA", group: "Integrated circuits", bbox: [-30, -30, 14, 30],
      defaults: { model: "TL431" },
      pins: () => [{ id: "K", x: 0, y: -30, name: "cathode" }, { id: "A", x: 0, y: 30, name: "anode" }, { id: "R", x: -30, y: 0, name: "reference" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true, options: () => Object.entries(SHUNTS).map(([k, m]) => [k, `${k} · ${m.use}`]) }],
      info: c => { const m = SHUNTS[c.params.model] || SHUNTS.TL431; return `${c.params.model} (${m.use}), ${m.pkg}. The cathode sinks whatever current holds REF at ${m.vref} V above the anode: REF tied to K, it is a ${m.vref} V zener; with R1 from K to REF and R2 from REF to A, Vka = ${m.vref} V × (1 + R1/R2). Modelled: the reference, the gain (dynamic impedance ${fmtEng(1 / m.gm, "Ω")}), REF's bias current (${fmtEng(m.vref / m.rref, "A")}), the current limit, the cathode's ${m.v} V maximum. Keep at least 1 mA in the cathode for it to regulate. Not modelled: its frequency response (a TL431 can oscillate with some capacitive loads).`; },
      build: (c, net, alloc, out) => {
        const m = SHUNTS[c.params.model] || SHUNTS.TL431;
        out.push({ id: c.id, kind: "SHUNT", nodes: [net("K"), net("A"), net("R")], model: { vref: m.vref, gm: m.gm, imax: m.imax, rref: m.rref, roff: m.roff } });
      }
    },
    opamp: {
      // DA: analogue integrated circuit (ГОСТ 2.710). The sections of a dual or quad (DA1.1 …
      // DA1.4) are one package, as a dual triode's are
      name: "Op-amp", prefix: "DA", group: "Integrated circuits", bbox: [-40, -40, 40, 40],
      defaults: { model: "TL071" },
      pins: c => {
        const p = [{ id: "-", x: -40, y: -10, name: "inverting input" }, { id: "+", x: -40, y: 10, name: "non-inverting input" }, { id: "OUT", x: 40, y: 0, name: "output" },
          { id: "V+", x: 0, y: -40, name: "positive supply" }, { id: "V-", x: 0, y: 40, name: "negative supply" }];
        if ((OPAMPS[c.params.model] || {}).cc === 0) p.push({ id: "1", x: -20, y: -40, name: "compensation (pin 1)" }, { id: "8", x: 20, y: -40, name: "compensation (pin 8)" });
        return p;
      },
      // the package's pin numbers beside the leads, as drawPinNumbers in cad-app.js writes a tube's
      pinSpots: [["-", -36, -10, 0, -1], ["+", -36, 10, 0, 1], ["OUT", 36, 0, 0, -1], ["V+", 0, -36, 1, 0], ["V-", 0, 36, 1, 0], ["1", -20, -36, -1, 0], ["8", 20, -36, 1, 0]],
      pinNumbers: c => {
        const m = OPAMPS[c.params.model] || OPAMPS.TL071, out = Object.assign({}, OPAMP_PINS[m.units][opampUnit(c) - 1], OPAMP_SUPPLY[m.units]);
        if (m.cc === 0) { out["1"] = 1; out["8"] = 8; }
        for (const k in out) out[k] = String(out[k]);
        return out;
      },
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true,
        options: () => Object.entries(OPAMPS).map(([k, m]) => [k, `${k} · ${fmtEng(m.gbw, "Hz")} · ${m.sr / 1e6} V/µs · ${m.use}`, m.units === 1 ? "Single" : m.units === 2 ? "Dual" : "Quad"]) }],
      info: c => {
        const m = OPAMPS[c.params.model] || OPAMPS.TL071, u = opampUnit(c), pins = Object.assign({}, OPAMP_PINS[m.units][u - 1], OPAMP_SUPPLY[m.units]);
        return `${c.params.model} (${m.use}): gain ${Math.round(20 * Math.log10(m.a0))} dB, gain-bandwidth ${fmtEng(m.gbw, "Hz")}, slew rate ${m.sr / 1e6} V/µs${m.cc === 0 ? " with 30 pF" : ""}, ${m.input} inputs (bias ${Math.abs(m.ib) < 1e-9 ? Math.abs(m.ib) * 1e12 + " pA" : fmtEng(Math.abs(m.ib), "A")}), output to within ${m.dhi} V of V+ and ${m.dlo} V of V−, short-circuit current ${fmtEng(m.isc, "A")}, supply up to ${m.vmax} V (±${m.vmax / 2} V), ${fmtEng(m.iq, "A")} per amplifier. `
          + (m.units > 1 ? `Amplifier ${u} of ${m.units} in a DIP-${m.units === 2 ? 8 : 14}: pins ${pins["+"]} (+), ${pins["-"]} (−), ${pins.OUT} (out); name the amplifiers of one package ${c.label && c.label.includes(".") ? c.label.slice(0, c.label.lastIndexOf(".")) : c.label || "DA1"}.1 … .${m.units} to put them in one package. ` : "")
          + `Supply pins ${pins["V+"]} (V+) and ${pins["V-"]} (V−) must be wired${m.units > 1 ? " on every amplifier, to the same rails" : ""}.`
          + (m.cc === 0 ? " Without a capacitor between pins 1 and 8 it is uncompensated and oscillates at low gain: 30 pF makes it unity-gain stable (1 MHz, 0.5 V/µs), 3 pF is enough from a gain of 10 up and is ten times faster." : "");
      },
      build: (c, net, alloc, out) => {
        const m = OPAMPS[c.params.model] || OPAMPS.TL071, ext = m.cc === 0, vneg = net("V-");
        // N1, N2: the ends of the Miller capacitor; an LM301A brings them out on pins 1 and 8
        const n1 = ext ? net("1") : alloc(), n2 = ext ? net("8") : alloc();
        out.push({ id: c.id, kind: "OPAMP", nodes: [net("+"), net("-"), net("OUT"), net("V+"), vneg, n1, n2], model: opampModel(m) });
        // the LM301A's own stray Miller capacitance, about 1 pF: uncompensated it slews some 15 V/µs
        out.push({ id: c.id + "#cc", kind: "C", nodes: [n1, n2], c: ext ? 1e-12 : m.cc });
        // 1 GΩ from each supply pin to ground (the board's leakage, nanoamperes): an amplifier left
        // unwired would otherwise float as a whole, its level set by round-off alone
        out.push({ id: c.id + "#lp", kind: "R", nodes: [net("V+"), 0], r: 1e9 }, { id: c.id + "#ln", kind: "R", nodes: [vneg, 0], r: 1e9 });
        // the stray capacitance of both nodes: the second pole, well above the gain-bandwidth
        out.push({ id: c.id + "#c1", kind: "C", nodes: [n1, vneg], c: 1e-12 }, { id: c.id + "#c2", kind: "C", nodes: [n2, vneg], c: 3e-12 });
      }
    },
    vdc: {
      name: "DC supply", prefix: "G", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { v: 300, rs: 0 },
      pins: () => [{ id: "+", x: 0, y: -30 }, { id: "-", x: 0, y: 30 }],
      value: c => fmtEng(c.params.v, "V"),
      // one part for B+ and bias rails: the voltage is kept signed in params.v; the inspector
      // shows its size and a polarity switch that flips the sign
      fields: [
        { key: "pol", label: "Polarity", kind: "select", options: [["+", "Positive (B+, a positive rail)"], ["-", "Negative (grid bias, a negative rail)"]],
          get: c => (+c.params.v < 0 ? "-" : "+"), apply: (c, s) => { c.params.v = (s === "-" ? -1 : 1) * Math.abs(+c.params.v || 0); } },
        { key: "v", label: "Voltage", unit: "V", kind: "eng", magnitude: true },
        { key: "rs", label: "Internal resistance", unit: "Ω", kind: "eng" }],
      info: c => (+c.params.v < 0
        ? "A negative supply: the pin by the + mark (the long plate) goes to ground, the other is the bias rail, " + fmtEng(c.params.v, "V") + ". "
        : "The + pin is the rail, the - pin goes to ground. ")
        + (c.params.rs > 0 ? "It sags under load by its internal resistance." : "Internal resistance 0: an ideal regulated supply that never sags."),
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
        { kind: "heading", label: "Signal" },
        { key: "wave", label: "Waveform", kind: "select", options: [["sine", "Sine"], ["square", "Square"], ["triangle", "Triangle"]] },
        { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" },
        { key: "phase", label: "Phase", kind: "select", options: [["0", "0°"], ["90", "90°"], ["180", "180° (inverted)"], ["270", "270°"]] },
        { kind: "heading", label: "Level" },
        { key: "amp", label: "Amplitude", unit: "Vpk", kind: "eng" },
        // the same amplitude as RMS and as dBV (0 dBV = 1 Vrms), using the waveform's crest factor
        { key: "amp", label: "Amplitude", unit: "Vrms", kind: "level", as: "rms" },
        { key: "amp", label: "Level", unit: "dBV", kind: "level", as: "dbv" },
        { key: "offset", label: "DC offset", unit: "V", kind: "eng" },
        { kind: "heading", label: "Output" },
        { key: "rs", label: "Output impedance", unit: "Ω", kind: "eng" }
      ],
      info: () => "The + pin carries the signal, the - pin is its common (ground). The simulation window and the instruments follow its frequency.",
      build: (c, net, alloc, out) => {
        const p = c.params, mid = alloc();
        out.push({ id: c.id, kind: "VSRC", nodes: [mid, net("-")], wave: p.wave, freq: Math.max(p.freq, 0.1), amp: p.amp, offset: p.offset || 0, phase: parseFloat(p.phase) || 0 });
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("+"), mid], r: Math.max(p.rs, 1e-3) });
      }
    },
    // a guitar pickup: the strings' EMF (a generator, the simulation follows its frequency) behind the
    // coil's resistance and inductance, its own capacitance across it, and the cable's
    pickup: {
      name: "Guitar pickup", prefix: "BM", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: Object.assign({ preset: "strat", wave: "sine", freq: 110, cable: 0 }, ...PICKUP_KEYS.map(k => ({ [k]: PICKUPS[0][k] }))),
      pins: () => [{ id: "+", x: 0, y: -30, name: "hot" }, { id: "-", x: 0, y: 30, name: "ground" }],
      value: c => `${fmtEng(c.params.l, "H")} ${fmtEng(c.params.r, "Ω")}`,
      fields: [
        { key: "preset", label: "Pickup", kind: "select", wide: true, options: () => [["custom", "Your measured values"]].concat(PICKUPS.map(p => [p.id, p.name])),
          get: c => (PICKUPS.find(p => PICKUP_KEYS.every(k => Math.abs(p[k] - c.params[k]) <= 1e-9 * Math.max(1, Math.abs(p[k])))) || { id: "custom" }).id,
          apply: (c, v) => { const p = PICKUPS.find(q => q.id === v); if (p) PICKUP_KEYS.forEach(k => { c.params[k] = p[k]; }); } },
        { key: "r", label: "DC resistance", unit: "Ω", kind: "eng" },
        { key: "l", label: "Inductance", unit: "H", kind: "eng" },
        { key: "c", label: "Self-capacitance", unit: "F", kind: "eng" },
        { key: "cable", label: "Cable", kind: "select", options: [["0", "None (draw your own)"], ["300e-12", "3 m, about 300 pF"], ["600e-12", "6 m, about 600 pF"]] },
        { kind: "heading", label: "Signal" },
        { key: "wave", label: "Waveform", kind: "select", options: [["sine", "Sine"], ["square", "Square"], ["triangle", "Triangle"]] },
        { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" },
        { key: "amp", label: "EMF (peak)", unit: "Vpk", kind: "eng" }
      ],
      info: c => { const p = c.params, ct = +p.c + (+p.cable || 0); return `The pickup's coil: its EMF behind ${fmtEng(p.r, "Ω")} and ${fmtEng(p.l, "H")}, ${fmtEng(p.c, "F")} across it${+p.cable ? ` and ${fmtEng(+p.cable, "F")} of cable` : ""}. Into a high-impedance input it peaks at about ${fmtEng(1 / (2 * Math.PI * Math.sqrt(p.l * ct)), "Hz")}, which is what an amp's input, the guitar's pots and the cable shape. The values are typical of the kind: measure yours (DC resistance with a meter, inductance with an LCR meter at 120 Hz or 1 kHz).`; },
      build: (c, net, alloc, out) => {
        const p = c.params, e = alloc(), m = alloc();
        out.push({ id: c.id, kind: "VSRC", nodes: [e, net("-")], wave: p.wave, freq: Math.max(+p.freq || 110, 0.1), amp: +p.amp || 0, offset: 0, phase: 0 });
        out.push({ id: c.id + "#r", kind: "R", nodes: [e, m], r: Math.max(+p.r || 0, 1e-3) });
        out.push({ id: c.id + "#l", kind: "L", nodes: [m, net("+")], l: Math.max(+p.l || 0, 1e-9) });
        const ct = (+p.c || 0) + (+p.cable || 0);
        if (ct > 0) out.push({ id: c.id + "#c", kind: "C", nodes: [net("+"), net("-")], c: ct });
      }
    },
    // a phono cartridge playing a record: a tone at the set level (at 1 kHz), cut with the RIAA
    // curve (a passive network of two lead–lag stages, each buffered by an ideal amplifier, unity at
    // 1 kHz) so that a correct RIAA preamp plays it flat; or a flat test signal. Then the coil
    phono: {
      name: "Phono cartridge", prefix: "BS", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: Object.assign({ preset: "mm", freq: 1000, record: "riaa", cable: "150e-12" }, ...CARTRIDGE_KEYS.map(k => ({ [k]: CARTRIDGES[0][k] }))),
      pins: () => [{ id: "+", x: 0, y: -30, name: "hot" }, { id: "-", x: 0, y: 30, name: "ground" }],
      value: c => `${fmtEng(c.params.mv, "V")} ${fmtEng(c.params.freq, "Hz")}`,
      fields: [
        { key: "preset", label: "Cartridge", kind: "select", wide: true, options: () => [["custom", "Your datasheet values"]].concat(CARTRIDGES.map(p => [p.id, p.name])),
          get: c => (CARTRIDGES.find(p => CARTRIDGE_KEYS.every(k => Math.abs(p[k] - c.params[k]) <= 1e-9 * Math.max(1, Math.abs(p[k])))) || { id: "custom" }).id,
          apply: (c, v) => { const p = CARTRIDGES.find(q => q.id === v); if (p) CARTRIDGE_KEYS.forEach(k => { c.params[k] = p[k]; }); } },
        { key: "mv", label: "Output at 1 kHz, 5 cm/s (rms)", unit: "V", kind: "eng" },
        { key: "r", label: "Coil resistance", unit: "Ω", kind: "eng" },
        { key: "l", label: "Coil inductance", unit: "H", kind: "eng" },
        { key: "cable", label: "Tonearm cable", kind: "select", options: [["0", "None (draw your own)"], ["150e-12", "About 150 pF"], ["300e-12", "About 300 pF"]] },
        { kind: "heading", label: "Signal" },
        { key: "record", label: "Signal", kind: "select", options: [["riaa", "A record: cut with the RIAA curve"], ["flat", "Flat (constant velocity, a test signal)"]], wide: true },
        { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" }
      ],
      info: c => {
        const p = c.params, g = p.record === "riaa" ? riaaRec(+p.freq || 1000) : 1;
        return `A tone at ${fmtEng(p.freq, "Hz")}: ${fmtEng(p.mv * g, "V")} rms from the cartridge${p.record === "riaa" ? ` (the RIAA cut ${(20 * Math.log10(g)).toFixed(1)} dB from 1 kHz)` : ""}, behind its ${fmtEng(p.r, "Ω")} and ${fmtEng(p.l, "H")}. ` +
          (p.record === "riaa" ? "Cut as on a record, so a correct RIAA stage plays it flat: sweep it with the Bode plotter, and the preamp's output should be level within a fraction of a dB from 20 Hz to 20 kHz. " : "") +
          "Load a moving magnet with 47 kΩ and 100–300 pF in all (its treble depends on it); a moving coil with 100 Ω or more, or a step-up transformer.";
      },
      build: (c, net, alloc, out) => {
        const p = c.params, g = net("-"), src = alloc();
        out.push({ id: c.id, kind: "VSRC", nodes: [src, g], wave: "sine", freq: Math.max(+p.freq || 1000, 0.1), amp: (+p.mv || 0) * Math.SQRT2, offset: 0, phase: 0 });
        let o = src;
        if (p.record === "riaa") {
          // stage 1: 9k ‖ C into 1k (zero 3180 µs, pole 318 µs); stage 2: 10k ‖ C into R (zero 75 µs, pole 3.18 µs)
          const T = RIAA_T, r2 = 1e4 * T[3] / (T[2] - T[3]), a = alloc(), b = alloc(), d = alloc(), e = alloc();
          const k = 0.1 * r2 / (1e4 + r2), h = riaaGain(1000);
          out.push({ id: c.id + "#r1", kind: "R", nodes: [src, a], r: 9e3 }, { id: c.id + "#c1", kind: "C", nodes: [src, a], c: T[0] / 9e3 }, { id: c.id + "#r2", kind: "R", nodes: [a, g], r: 1e3 },
            { id: c.id + "#e1", kind: "E", nodes: [b, g, a, g], gain: 1 },
            { id: c.id + "#r3", kind: "R", nodes: [b, d], r: 1e4 }, { id: c.id + "#c3", kind: "C", nodes: [b, d], c: T[2] / 1e4 }, { id: c.id + "#r4", kind: "R", nodes: [d, g], r: r2 },
            { id: c.id + "#e2", kind: "E", nodes: [e, g, d, g], gain: 1 / (k * h) });
          o = e;
        }
        const m = alloc();
        out.push({ id: c.id + "#r", kind: "R", nodes: [o, m], r: Math.max(+p.r || 0, 1e-3) });
        out.push({ id: c.id + "#l", kind: "L", nodes: [m, net("+")], l: Math.max(+p.l || 0, 1e-9) });
        if (+p.cable > 0) out.push({ id: c.id + "#c", kind: "C", nodes: [net("+"), g], c: +p.cable });
      }
    },
    isrc: {
      // a Norton source: an ideal current in parallel with an output resistance, which also
      // keeps a node fed only by the source (behind a capacitor, say) solvable
      name: "Current source", prefix: "G", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { i: 0.01, rout: 10e6 },
      pins: () => [{ id: "+", x: 0, y: -30, name: "out" }, { id: "-", x: 0, y: 30, name: "in" }],
      value: c => fmtEng(c.params.i, "A"),
      fields: [{ key: "i", label: "Current", unit: "A", kind: "eng" }, { key: "rout", label: "Output resistance", unit: "Ω", kind: "eng" }],
      info: () => "A constant DC current, flowing in at the - pin and out at the + pin (the arrow). A quick stand-in for a transistor current source: a plate load, a long-tail or cathode current sink. It holds its current at any voltage, so check the voltage across it is one a real current source could stand.",
      build: (c, net, alloc, out) => {
        out.push({ id: c.id, kind: "I", nodes: [net("-"), net("+")], i: c.params.i });
        out.push({ id: c.id + "#ro", kind: "R", nodes: [net("+"), net("-")], r: Math.max(c.params.rout, 1e3) });
      }
    },
    // controlled sources (SPICE E and G): ideal building blocks for a behavioural model, the
    // control pins draw nothing
    vcvs: {
      name: "Voltage-controlled voltage source", prefix: "E", group: "Sources", bbox: [-30, -30, 26, 30],
      defaults: { gain: 10 },
      pins: CONTROLLED_PINS,
      value: c => "×" + fmtEng(c.params.gain, ""),
      fields: [{ key: "gain", label: "Gain", unit: "V/V", kind: "eng" }],
      info: () => "An ideal amplifier: the voltage between its output pins is the gain times the voltage between its control pins (+ and − on the left), at any load. The control pins draw no current. SPICE's E source: for a block diagram, a behavioural model or a stand-in for a stage you have not designed yet.",
      build: (c, net, alloc, out) => { out.push({ id: c.id, kind: "E", nodes: [net("+"), net("-"), net("C+"), net("C-")], gain: +c.params.gain || 0 }); }
    },
    vccs: {
      name: "Voltage-controlled current source", prefix: "G", group: "Sources", bbox: [-30, -30, 26, 30],
      defaults: { gm: 1e-3, rout: 10e6 },
      pins: CONTROLLED_PINS,
      value: c => fmtEng(c.params.gm, "S"),
      fields: [{ key: "gm", label: "Transconductance", unit: "S", kind: "eng" }, { key: "rout", label: "Output resistance", unit: "Ω", kind: "eng" }],
      info: () => "An ideal transconductor: the current out of its + pin (the arrow) is gm times the voltage between its control pins, at any voltage across it, with the output resistance in parallel. The control pins draw no current. SPICE's G source: an ideal tube or transistor (gm and ra), an OTA, a behavioural model.",
      build: (c, net, alloc, out) => {
        out.push({ id: c.id, kind: "G", nodes: [net("-"), net("+"), net("C+"), net("C-")], gm: +c.params.gm || 0 });
        out.push({ id: c.id + "#ro", kind: "R", nodes: [net("+"), net("-")], r: Math.max(c.params.rout, 1) });
      }
    },
    chipamp: {
      // DA: an analogue IC (ГОСТ 2.710), drawn as the op-amp it is inside; the LM386 brings its
      // gain pins (1, 8) and bypass (7) out, the LM3886 its GND (7) and mute (8)
      name: "Power amplifier IC", prefix: "DA", group: "Integrated circuits", bbox: [-40, -40, 40, 40],
      defaults: { model: "LM386" },
      pins: c => {
        const p = [{ id: "-", x: -40, y: -10, name: "inverting input" }, { id: "+", x: -40, y: 10, name: "non-inverting input" }, { id: "OUT", x: 40, y: 0, name: "output" },
          { id: "V+", x: 0, y: -40, name: "positive supply" }, { id: "V-", x: 0, y: 40, name: c.params.model === "LM386" ? "ground" : "negative supply" }];
        if (c.params.model === "LM386") p.push({ id: "G1", x: -20, y: -40, name: "gain (pin 1)" }, { id: "G8", x: 20, y: -40, name: "gain (pin 8)" }, { id: "BYP", x: 20, y: 40, name: "bypass (pin 7)" });
        if (c.params.model === "LM3886") p.push({ id: "GND", x: -20, y: 40, name: "ground (pin 7)" }, { id: "MUTE", x: 20, y: 40, name: "mute (pin 8)" });
        return p;
      },
      pinSpots: [["-", -36, -10, 0, -1], ["+", -36, 10, 0, 1], ["OUT", 36, 0, 0, -1], ["V+", 0, -36, 1, 0], ["V-", 0, 36, 1, 0], ["G1", -20, -36, -1, 0], ["G8", 20, -36, 1, 0], ["BYP", 20, 36, 1, 0], ["GND", -20, 36, -1, 0], ["MUTE", 20, 36, 1, 0]],
      pinNumbers: c => Object.assign({}, (CHIPAMPS[c.params.model] || CHIPAMPS.LM386).pins),
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", wide: true, options: () => Object.entries(CHIPAMPS).map(([k, m]) => [k, `${k} · ${m.use}`]) }],
      info: c => {
        const m = CHIPAMPS[c.params.model] || CHIPAMPS.LM386, k = c.params.model;
        const base = `${k} (${m.use}), ${m.pkg}: ${m.pout}. Supply ${m.vmin}–${m.vmax} V${k === "LM386" ? "" : ` (±${m.vmin / 2}–±${m.vmax / 2} V)`}, ${fmtEng(m.iq, "A")} quiescent, output current limit ${fmtEng(m.isc, "A")}, up to ${m.pmax} W dissipated ${k === "LM386" ? "(DIP-8, in still air)" : "on a heatsink"}. `;
        if (k === "LM386") return base + "Inside: 50 kΩ from each input to ground and the output biased at half the supply (pin 7: 10 µF to ground there quietens the supply's ripple). The gain is 20 with pins 1 and 8 open, 200 with 10 µF between them; a resistor in series with that capacitor sets it in between. Take the output through a capacitor (220 µF or more) to the speaker, and put 0.05 µF + 10 Ω from the output to ground (the Zobel) against oscillation.";
        return base + `Wire it as a non-inverting amplifier with a gain of ${m.gmin} or more (it is not stable lower): feedback from OUT to IN−, a resistor and capacitor from IN− to ground. ` +
          (k === "LM3886" ? "Draw 0.5 mA or more from the mute pin (8), or it stays silent: 10 kΩ to V− from ±28 V. Pin 7 goes to ground. Not modelled: the mute itself (the simulation plays regardless; Checks warns), the SPiKe protection, the thermal shutdown." : "Not modelled: the thermal shutdown.");
      },
      build: (c, net, alloc, out) => {
        const m = CHIPAMPS[c.params.model] || CHIPAMPS.LM386, n1 = alloc(), n2 = alloc(), vneg = net("V-");
        const amp = (inp, inn) => {
          out.push({ id: c.id, kind: "OPAMP", nodes: [inp, inn, net("OUT"), net("V+"), vneg, n1, n2], model: opampModel(m) });
          out.push({ id: c.id + "#cc", kind: "C", nodes: [n1, n2], c: m.cc }, { id: c.id + "#c1", kind: "C", nodes: [n1, vneg], c: 1e-12 }, { id: c.id + "#c2", kind: "C", nodes: [n2, vneg], c: 3e-12 });
          out.push({ id: c.id + "#lp", kind: "R", nodes: [net("V+"), 0], r: 1e9 }, { id: c.id + "#ln", kind: "R", nodes: [vneg, 0], r: 1e9 });
        };
        if (c.params.model === "LM386") {
          // the input pins over 50 kΩ to ground; the difference, raised on the bias (pin 7, half of
          // V+ through 2 × 50 kΩ), drives the amplifier, whose feedback (28.36 kΩ to pin 1, 1.35 kΩ
          // on to pin 8, 142.5 Ω to the bias) makes the datasheet's gains: 20, or 200 with pins 1 and 8 bypassed
          const p = alloc(), byp = net("BYP");
          out.push({ id: c.id + "#rip", kind: "R", nodes: [net("+"), vneg], r: 50e3 }, { id: c.id + "#rin", kind: "R", nodes: [net("-"), vneg], r: 50e3 });
          out.push({ id: c.id + "#rb1", kind: "R", nodes: [net("V+"), byp], r: 50e3 }, { id: c.id + "#rb2", kind: "R", nodes: [byp, vneg], r: 50e3 });
          out.push({ id: c.id + "#e", kind: "E", nodes: [p, byp, net("+"), net("-")], gain: 1 });
          out.push({ id: c.id + "#rf", kind: "R", nodes: [net("OUT"), net("G1")], r: 28357.5 }, { id: c.id + "#rg1", kind: "R", nodes: [net("G1"), net("G8")], r: 1350 }, { id: c.id + "#rg2", kind: "R", nodes: [net("G8"), byp], r: 142.5 });
          amp(p, net("G1"));
          return;
        }
        amp(net("+"), net("-"));
        if (c.params.model === "LM3886") {
          // the mute pin 2.6 V below GND through 1 kΩ: the current drawn from it reads as #mute's
          const g = net("GND"), mid = alloc();
          out.push({ id: c.id + "#mute", kind: "V", nodes: [g, mid], v: 2.6 }, { id: c.id + "#rm", kind: "R", nodes: [mid, net("MUTE")], r: 1e3 });
          out.push({ id: c.id + "#lg", kind: "R", nodes: [g, 0], r: 1e9 });
        }
      }
    },
    timer555: {
      // pins in pin-number order (the board's DIP-8 pads and wire pads follow it)
      name: "NE555 timer", prefix: "DA", group: "Integrated circuits", bbox: [-50, -50, 50, 50],
      defaults: { model: "NE555" },
      pins: () => [{ id: "1", x: 20, y: 50, name: "GND" }, { id: "2", x: -50, y: 20, name: "TRIG (trigger)" }, { id: "3", x: 50, y: 0, name: "OUT (output)" },
        { id: "4", x: -20, y: -50, name: "RESET" }, { id: "5", x: -20, y: 50, name: "CV (control voltage)" }, { id: "6", x: -50, y: 0, name: "THR (threshold)" },
        { id: "7", x: -50, y: -20, name: "DIS (discharge)" }, { id: "8", x: 20, y: -50, name: "VCC" }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Type", kind: "select", options: [["NE555", "NE555 · bipolar timer, 4.5–16 V, DIP-8"]], wide: true }],
      info: () => "Bipolar 555 timer, pins as on the DIP-8 package. Modelled: the 5k–5k–5k divider (CV at ⅔ VCC), the trigger (⅓ VCC) and threshold (⅔ VCC) comparators, the latch, reset below 0.7 V, the output (high: VCC − 1.4 V less 3 Ω, sourcing only; low: 8 Ω, about 120 mA at most), the discharge transistor (12 Ω), and the chip's own supply current (about 3 mA at 5 V, 10 mA at 15 V). RESET has a weak pull-up, so left open it reads high. Free-running with no source to follow, it sets the simulation's cycle: the run finds its period, however slow.",
      build: (c, net, alloc, out) => {
        const p = id => net(id), lo = alloc();
        // the latch and the transistors; nodes GND, TRIG, OUT, RESET, CV, THR, DIS, VCC and the divider's lower tap
        out.push({ id: c.id, kind: "TIMER555", nodes: [p("1"), p("2"), p("3"), p("4"), p("5"), p("6"), p("7"), p("8"), lo] });
        // inside the chip (internal: not exported as parts of the circuit)
        out.push({ id: c.id + "#div1", kind: "R", nodes: [p("8"), p("5")], r: 5e3, internal: true }, { id: c.id + "#div2", kind: "R", nodes: [p("5"), lo], r: 5e3, internal: true },
          { id: c.id + "#div3", kind: "R", nodes: [lo, p("1")], r: 5e3, internal: true },
          { id: c.id + "#iq", kind: "R", nodes: [p("8"), p("1")], r: 1.7e3, internal: true },     // supply current
          { id: c.id + "#rst", kind: "R", nodes: [p("8"), p("4")], r: 33e3, internal: true });   // reset pin: 0.4 mA out of it pulled to 0 V from 15 V
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
      name: "Ground", prefix: "GND", group: "Ground & connectors", bbox: [-12, -2, 12, 20], noLabel: true,
      defaults: {},
      pins: () => [{ id: "G", x: 0, y: 0 }],
      value: () => "",
      fields: [],
      build: () => {}
    },
    rail: {
      name: "Power rail", prefix: "", group: "Sources", noLabel: true, bbox: [-8, -30, 8, 2],
      defaults: { name: "VCC", v: 9, shown: "" },
      pins: () => [{ id: "1", x: 0, y: 0 }],
      value: c => String(c.params.shown || "").trim() || fmtEng(c.params.v, "V"),
      fields: [{ key: "name", label: "Rail name", kind: "text" }, { key: "v", label: "Voltage", unit: "V", kind: "eng" },
        { key: "shown", label: "Shown as", kind: "text" }],
      info: () => "An ideal DC supply from its pin to ground, with no ground symbol of its own to wire. Every rail and sheet connector with the same name is one net, so the supply can be drawn wherever it is needed.",
      // one ideal source per net: the CAD's netlist keeps the first rail of each net (buildNetlist)
      build: (c, net, alloc, out) => { if (net("1") !== 0) out.push({ id: c.id, kind: "V", nodes: [net("1"), 0], v: +c.params.v || 0 }); }
    },
    offsheet: {
      name: "Sheet connector", prefix: "", group: "Ground & connectors", noLabel: true,
      // the arrow plus room for the name beyond its tip (for picking)
      bbox: c => [0, -10, 26 + 7 * String(c.params.name || "").length, 10],
      defaults: { name: "+B" },
      pins: () => [{ id: "1", x: 0, y: 0 }],
      value: c => c.params.name || "",
      fields: [{ key: "name", label: "Signal name", kind: "text" }],
      info: () => "Joins every sheet connector with the same signal name, on any sheet, as if wired. Use it to carry a supply rail or a signal to another sheet; the cross-reference next to it gives the sheet and grid zone of its partners (IEC 61082-1).",
      build: () => {}
    },
    // Physical connectors: where wires from off the board land. They join their pins to nothing
    // else (a jack's switch excepted), so they cost the simulation nothing; on the board they are
    // pads in the maker's pattern.
    jack: {
      name: "Jack socket", prefix: "XS", group: "Ground & connectors", bbox: [-30, -30, 14, 30],
      defaults: { kind: "TS-SW", plug: "out" },
      pins: c => {
        const j = JACKS[c.params.kind] || JACKS["TS-SW"], at = { "+": [-30, -20, "tip"], R: [-30, 0, "ring"], "-": [-30, 20, "sleeve"], SW: [-30, -10, "tip switch (closed with no plug)"] };
        return j.pins.map(id => ({ id, x: at[id][0], y: at[id][1], name: at[id][2] }));
      },
      value: c => (JACKS[c.params.kind] || JACKS["TS-SW"]).size === "RCA" ? "RCA" : (JACKS[c.params.kind] || {}).size + " mm",
      fields: [{ key: "kind", label: "Kind", kind: "select", options: () => Object.entries(JACKS).map(([k, j]) => [k, j.use]), wide: true },
        { key: "plug", label: "Plug", kind: "select", options: [["out", "Nothing plugged in"], ["in", "A plug in"]], when: c => c.params.kind === "TS-SW" }],
      info: c => (c.params.kind === "TS-SW"
        ? "Tip +, sleeve −, and the tip's switch contact SW, which rests on the tip while nothing is plugged in (wire SW to ground and an open input is shorted, so it stays quiet). The Plug field opens it. Double-click the jack to plug in or pull out."
        : "Tip +, ring R (stereo), sleeve −. It joins the wires from its plug to the circuit; nothing of it is simulated."),
      build: (c, net, alloc, out) => {
        if (c.params.kind !== "TS-SW") return;
        // the switch contact: 10 mΩ to the tip with no plug, open (10 GΩ, so it never floats) with one
        out.push({ id: c.id + "#sw", kind: "R", nodes: [net("+"), net("SW")], r: c.params.plug === "in" ? 1e10 : 0.01 });
      }
    },
    iec: {
      name: "IEC mains inlet", prefix: "XP", group: "Ground & connectors", bbox: [-30, -30, 24, 30],
      defaults: {},
      pins: () => [{ id: "L", x: -30, y: -20, name: "line" }, { id: "N", x: -30, y: 0, name: "neutral" }, { id: "PE", x: -30, y: 20, name: "protective earth" }],
      value: () => "C14",
      fields: [],
      info: () => "IEC 60320 C14 inlet, chassis mounted: line, neutral and protective earth, wired to the board by their Faston tabs. Feed it from the AC mains part; PE goes to the chassis (and ground) for safety.",
      build: () => {}
    },
    terminal: {
      name: "Terminal block", prefix: "XT", group: "Ground & connectors",
      bbox: c => [-30, -10, 14, 20 * Math.max(2, +c.params.ways || 2) - 10],
      defaults: { ways: 2, pitch: "5.08" },
      pins: c => Array.from({ length: Math.min(Math.max(+c.params.ways || 2, 2), 8) }, (_, i) => ({ id: String(i + 1), x: -30, y: i * 20 })),
      value: c => `${c.params.ways}-way ${c.params.pitch} mm`,
      fields: [{ key: "ways", label: "Ways", kind: "select", options: [2, 3, 4, 5, 6, 8].map(n => [n, n + " ways"]) },
        { key: "pitch", label: "Pitch", kind: "select", options: [["5.08", "5.08 mm (to 250 V, 10 A)"], ["7.5", "7.5 mm (mains, HT)"]] }],
      info: () => "A screw terminal block on the board (Phoenix MKDS style): each way joins its wire from off the board to the circuit.",
      build: () => {}
    },
    header: {
      name: "Pin header", prefix: "XP", group: "Ground & connectors",
      bbox: c => [-30, -10, 14, 20 * Math.max(2, +c.params.ways || 2) - 10],
      defaults: { ways: 3 },
      pins: c => Array.from({ length: Math.min(Math.max(+c.params.ways || 2, 2), 10) }, (_, i) => ({ id: String(i + 1), x: -30, y: i * 20 })),
      value: c => `1×${c.params.ways}`,
      fields: [{ key: "ways", label: "Pins", kind: "select", options: [2, 3, 4, 5, 6, 8, 10].map(n => [n, `1 × ${n}, 2.54 mm`]) }],
      info: () => "A straight 2.54 mm pin header for a plug-on lead (heater, LED, pot or switch wiring); signal currents, 3 A at most per pin.",
      build: () => {}
    },
    faston: {
      name: "Faston tab", prefix: "XT", group: "Ground & connectors", bbox: [-20, -8, 14, 8],
      defaults: { size: "6.3" },
      pins: () => [{ id: "1", x: -20, y: 0 }],
      value: c => c.params.size + " mm",
      fields: [{ key: "size", label: "Tab", kind: "select", options: [["6.3", "6.3 mm (0.250\"), Keystone 1287"], ["4.8", "4.8 mm (0.187\"), Keystone 1285"]] }],
      info: () => "A board-mounted quick-connect tab for one wire: mains, a heater, the speaker or a chassis ground lead.",
      build: () => {}
    },
    fuse: {
      name: "Fuse", prefix: "FU", group: "Passive", bbox: [-30, -8, 30, 8],
      defaults: { a: 1, speed: "T", size: "5x20" },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => `${c.params.speed}${fmtEng(+c.params.a, "A")}`,
      fields: [{ key: "a", label: "Rating", kind: "select", options: FUSE_RATINGS.map(a => [a, fmtEng(a, "A")]) },
        { key: "speed", label: "Kind", kind: "select", options: [["T", "T, time-lag (mains, inrush)"], ["F", "F, fast-acting (HT, outputs)"]] },
        { key: "size", label: "Size", kind: "select", options: [["5x20", "5 × 20 mm"], ["6.3x32", "6.3 × 32 mm"], ["TR5", "TR5 subminiature"]] }],
      info: c => `A ${c.params.speed === "F" ? "fast-acting" : "time-lag"} ${fmtEng(+c.params.a, "A")} fuse, simulated as its typical cold resistance, ${fmtEng(fuseCold(c.params.a), "Ω")}. Checks compares its rms current with the rating: run a fuse at 75 % of it or less.`,
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "R", nodes: [net("1"), net("2")], r: fuseCold(c.params.a) })
    },
    ntc: {
      name: "Inrush limiter (NTC)", prefix: "RK", group: "Passive", bbox: [-30, -12, 30, 12],
      defaults: { model: "SL22 10005" },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Model", kind: "select", options: () => Object.entries(NTCS).map(([k, m]) => [k, `${k} · ${m.use}`]), wide: true }],
      info: c => { const m = NTCS[c.params.model] || NTCS["SL22 10005"]; return `${c.params.model}: ${fmtEng(m.r25, "Ω")} cold, ${m.imax} A at most, ${m.r100} Ω hot at ${m.imax} A. Simulated at its self-heated resistance for the current through it (R = k·I^−n from the maker's figures), so the settled supply sees it hot; the power-on transient starts it cold.`; },
      build: (c, net, alloc, out) => { const m = NTCS[c.params.model] || NTCS["SL22 10005"]; out.push({ id: c.id, kind: "R", nodes: [net("1"), net("2")], r: m.r25, ntc: ntcLaw(m) }); }
    },
    mov: {
      name: "Varistor (MOV)", prefix: "RU", group: "Passive", bbox: [-30, -12, 30, 12],
      defaults: { model: "S10K275" },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => c.params.model,
      fields: [{ key: "model", label: "Model", kind: "select", options: () => Object.entries(MOVS).map(([k, m]) => [k, `${k} · ${m.use}`]), wide: true }],
      info: c => { const m = MOVS[c.params.model] || MOVS.S10K275; return `${c.params.model}: ${m.vrms} V AC (${m.vdc} V DC) continuous, ${m.v1ma} V at 1 mA, clamps at ${m.vc} V with ${m.ic} A, ${fmtEng(m.c, "F")}. Across the mains after the fuse it takes the surges; Checks compares the voltage across it with its continuous rating.`; },
      // two opposed junctions in series with the bulk resistance, and the disc's capacitance
      build: (c, net, alloc, out) => {
        const m = MOVS[c.params.model] || MOVS.S10K275, d = movModel(m), mid = alloc();
        out.push({ id: c.id + "#rs", kind: "R", nodes: [net("1"), mid], r: d.rs });
        out.push({ id: c.id, kind: "D", nodes: [mid, net("2")], is: d.is, n: d.n });
        out.push({ id: c.id + "#r", kind: "D", nodes: [net("2"), mid], is: d.is, n: d.n });
        out.push({ id: c.id + "#c", kind: "C", nodes: [net("1"), net("2")], c: m.c });
      }
    },
    scope: {
      // its screen stays upright (no rotation), but it mirrors: the inputs then come in on the right
      name: "Oscilloscope", prefix: "P", group: "Instruments", bbox: [-80, -45, 70, 45], noRotate: true, mirror: true,
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
    { group: "Passive", items: [["resistor"], ["pot"], ["capacitor"], ["electrolytic"], ["inductor"], ["speaker"],
      ["speaker", (({ r, re, le, fs, qms, qes }) => ({ model: "ts", r, re, le, fs, qms, qes }))(SPEAKER_PRESETS.find(p => p.id === "hp300")), "Headphones (300 Ω)"],
      { sub: "Protection" }, ["fuse"], ["ntc"], ["mov"]] },
    { group: "Switches & relays", items: [["switch"], ["spst", null, "Toggle switch (on–off)"], ["spst", { kind: "no" }, "Push button (normally open)"], ["spst", { kind: "nc" }, "Push button (normally closed)"], ["rotary", null, "Rotary selector, 1 pole"],
      { sub: "Relays" }, ["relay", null, "Relay G5LE-1 (SPDT, power)"], ["relay", { model: "G5V-2" }, "Relay G5V-2 (DPDT, signal)"],
      { sub: "Optocouplers" }, ["vactrol", null, "Vactrol VTL5C3 (LED + LDR)"], ["vactrol", { model: "VTL5C1" }, "Vactrol VTL5C1"]] },
    { group: "Transformers", items: [
      { sub: "Generic: set the values yourself" },
      ["opt_se", null, "Output, single-ended"], ["opt_pp", null, "Output, push-pull / UL"], ["ptx", null, "Power, with mains"],
      ["itx", null, "Interstage 1:1"], ["itx", itxPreset("is12ct"), "Interstage 1:2 CT (to push-pull)"], ["itx", itxPreset("mic10"), "Input, microphone 1:10"], ["itx", itxPreset("mc10"), "Input, moving-coil step-up"],
      { sub: "Manufactured: Hammond catalog" },
      ["opt_cat", null, "Output 125SE"], ["ptx_cat", null, "Power 300"]] },
    { group: "Sources", items: [
      { sub: "DC supplies" },
      ["vdc"], ["rail"], ["isrc"],
      { sub: "AC sources" },
      ["siggen"], ["mains"],
      { sub: "Instruments and records" }, ["pickup", null, "Guitar pickup, single coil"], ["pickup", { preset: "paf", r: 8e3, l: 4.4, c: 150e-12, amp: 0.3 }, "Guitar pickup, humbucker"], ["phono", null, "Phono cartridge, moving magnet"], ["phono", { preset: "dl103", mv: 0.3e-3, r: 40, l: 30e-6 }, "Phono cartridge, moving coil"],
      { sub: "Controlled sources" }, ["vcvs", null, "Voltage-controlled voltage (E)"], ["vccs", null, "Voltage-controlled current (G)"]] },
    { group: "Ground & connectors", items: [["ground"], ["offsheet"],
      { sub: "Connectors" }, ["jack", null, "Jack, 6.35 mm switched"], ["jack", { kind: "RCA" }, "RCA socket"], ["iec"], ["terminal"], ["header"], ["faston"]] },
    { group: "Semiconductors", items: [["diode"], ["diode", { model: "UF4007" }, "Diode, ultrafast"], ["diode", { model: "1N5819" }, "Diode, Schottky"], ["diode", { model: "C3D02060A" }, "Diode, SiC Schottky"], ["bridge"], ["zener"], ["led"],
      { sub: "Transistors" }, ["npn"], ["pnp"], ["npn", { model: "MJE340" }, "NPN, high voltage"], ["pnp", { model: "MJE350" }, "PNP, high voltage"],
      ["pnp", { model: "AC128" }, "PNP, germanium"], ["npn", { model: "AC127" }, "NPN, germanium"], ["pnp", { model: "MP39B" }, "PNP, germanium (USSR)"],
      ["nmos", null, "N-MOSFET"], ["nmos", { model: "DN2540" }, "N-MOSFET, depletion"], ["pmos", null, "P-MOSFET"],
      ["njf", null, "N-JFET"], ["njf", { model: "2SK170" }, "N-JFET, low noise"], ["pjf", null, "P-JFET"]] },
    { group: "Integrated circuits", items: [
      { sub: "Op-amps" },
      ["opamp", { model: "TL071" }, "TL071 (JFET)"], ["opamp", { model: "TL072" }, "TL072 (dual JFET)"], ["opamp", { model: "TL074" }, "TL074 (quad JFET)"],
      ["opamp", { model: "LM741" }, "LM741"], ["opamp", { model: "LM301A" }, "LM301A (external comp.)"], ["opamp", { model: "LM324" }, "LM324 (quad, single supply)"], ["opamp", { model: "NE5532" }, "NE5532 (dual, low noise)"], ["opamp", { model: "OPA2134" }, "OPA2134 (dual FET, audio)"], ["opamp", { model: "LM4562" }, "LM4562 (dual, audio)"],
      { sub: "Power amplifiers" }, ["chipamp", null, "LM386 (low voltage, 0.5 W)"], ["chipamp", { model: "TDA2050" }, "TDA2050 (32 W)"], ["chipamp", { model: "LM3886" }, "LM3886 (68 W)"],
      { sub: "Timers" }, ["timer555", null, "NE555 timer"],
      { sub: "Regulators" }, ["reg", { model: "LM317" }, "LM317 adjustable"], ["reg", { model: "LM337" }, "LM337 adjustable, negative"],
      ["reg", { model: "7812" }, "78xx fixed"], ["reg", { model: "7912" }, "79xx fixed, negative"], ["tl431", null, "TL431 shunt reference"]] },
    { group: "Gas-discharge tubes", items: [["gasreg", null, "Voltage regulator 0A2 (150 V)"], ["gasreg", { model: "0B2" }, "Voltage regulator 0B2 (108 V)"], ["gasreg", { model: "0D3" }, "Voltage regulator 0D3 (153 V, octal)"],
      { sub: "Indicators" }, ["neon", null, "Neon lamp NE-2"], ["neon", { model: "NE-2H" }, "Neon lamp NE-2H (bright)"], ["eye", null, "Magic eye 6E5"], ["eye", { model: "6U5" }, "Magic eye 6U5 (remote cutoff)"]] },
    { group: "Instruments", items: [["scope"]] },
    { group: "Document", items: [["frame"], ["note"]] }
  ];

  // ---------------------------------------------------------------------------
  // What the CAD's inspector shows for a part, besides its fields:
  //   info(c)       a line of text under the fields (in the LIB entries above)
  //   panel(c, R)   an element under that (the loudspeaker's impedance plot, the scope's windows)
  //   readout(c, R) HTML of the live values under "Operating point", after each simulation
  // R is the CAD's view of the last simulation result for part c:
  //   R.r (the result), R.kv(label, value, cls) and R.note(text, cls) (rows and lines of the
  //   inspector), R.vAcross(pinA, pinB) (DC volts), R.pAvg(pinA, pinB, ohms), R.netDC(net),
  //   R.pinNet(pin), R.pinCurrent(pin), R.tubeData(), R.tubeLimits(), R.limitRows(),
  //   R.resistorPower(), R.speakerPower(), R.signalFreq(), R.otDcCurrent(), R.scopeChannels(),
  //   R.wave(pin) (the pin's voltage over the capture), R.stats(array). A new part gets its readout here and needs no change in cad-app.js.
  // ---------------------------------------------------------------------------
  const UI = {
    tube: {
      info: c => {
        const t = tubeByName(c.params.tube);
        if (!t) return "";
        if (t.custom && t.custom.source === "datasheet") return `From a datasheet · Koren model ${t.custom.fit ? `fitted to ${t.custom.fit.points} plate-curve points (R² ${t.custom.fit.r2})` : `of the ${t.custom.like}`} · Va max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A`;
        return t.custom
          ? `Imported SPICE model ${t.custom.sub}${t.custom.like ? ` · socket, pinout and heater of the ${t.custom.like}` : ""} · Va max ${t.vaMax} V · Pa max ${t.paMax} W`
          : `${t.nameWestern} · ${t.nameGost} · Va max ${t.vaMax} V · Pa max ${t.paMax} W · heater ${t.vh} V / ${t.ih} A · cathode warm-up τ ≈ ${tubeWarmup(t).tau} s (in the oscilloscope's Power-on run)`;
      },
      readout: (c, R) => {
        const d = R.tubeData(), kv = R.kv;
        if (!d) return R.note("No data.");
        if (d.kind === "rectifier")
          return kv("Anode 1 current", fmtEng(d.a1 ? d.a1.i : 0, "A")) + kv("Anode 2 current", fmtEng(d.a2 ? d.a2.i : 0, "A")) + R.limitRows()
            + R.note("Anode currents are averages over the settled cycle; the peak is drawn while the reservoir capacitor charges.");
        const dc = d.dc, pa = dc.vak * dc.ia, over = pa > d.paMax;
        let h = kv("Va (anode–cathode)", fmtEng(dc.vak, "V", 1), dc.vak > d.vaMax ? "bad" : "");
        h += kv(d.kind === "pentode" ? "Vg1k (bias)" : "Vgk (bias)", fmtEng(dc.vgk, "V", 2), dc.vgk > 0 ? "warn" : "");
        if (d.kind === "pentode") { const l = R.tubeLimits().find(o => o.key === "Vg2k"); h += kv("Vg2k (screen)", fmtEng(dc.vg2k, "V", 1) + (l ? ` · ${Math.round(l.share * 100)}% of ${l.lim}` : ""), l && l.share > 1 ? "bad" : ""); }
        h += kv("Ia (anode current)", fmtEng(dc.ia, "A", 2));
        if (d.kind === "pentode") h += kv("Ig2 (screen current)", fmtEng(dc.ig2, "A", 2));
        h += kv("Pa (dissipation)", `${fmtEng(pa, "W", 2)} · ${Math.round(pa / d.paMax * 100)}% of ${d.paMax} W`, over ? "bad" : (pa > 0.85 * d.paMax ? "warn" : ""));
        h += R.limitRows();
        if (d.metrics) {
          h += `<div class="insp-sub">With signal</div>`;
          h += kv("Plate swing", fmtEng(d.metrics.vakPP, "Vpp", 1)) + kv("Grid swing", fmtEng(d.metrics.vgkPP, "Vpp", 2));
          if (d.metrics.gain) h += kv("Plate/grid gain", d.metrics.gain.toFixed(1) + "×");
          if (d.metrics.thd !== null) h += kv("THD at plate", d.metrics.thd.toFixed(2) + " %", d.metrics.thd > 5 ? "warn" : "");
          h += kv("Average Pa", fmtEng(d.metrics.pAvg, "W", 2), d.metrics.pAvg > d.paMax ? "bad" : "");
        }
        // the anode's temperature from its (average) dissipation, reached after a few time constants
        const th = anodeTemp(d.metrics ? d.metrics.pAvg : pa, d.paMax);
        h += kv("Anode temperature", `about ${Math.round(th.t / 10) * 10} °C${th.glow > 0 ? " · glowing red" : ""}`, th.glow > 0 ? "bad" : th.t > 450 ? "warn" : "");
        h += R.note(`The anode warms to it over a couple of minutes (time constant about ${Math.round(th.tau)} s). From about 525 °C, twice its rated dissipation, it glows red (red-plating), drawn so on the sheet.`);
        if (dc.vgk > 0) h += R.note("Grid is positive: grid current flows.", "warn");
        return h;
      }
    },
    resistor: {
      readout: (c, R) => {
        const v = R.vAcross("1", "2"), p = R.resistorPower(), w = +c.params.w;
        // rated: share of the rating (over 60 % runs hot: derate about 2×); unrated: flag above 1 W
        return R.kv("Voltage (DC)", fmtEng(v, "V", 2)) + R.kv("Current (DC)", fmtEng(v / c.params.r, "A", 2))
          + (w ? R.kv("Power (avg)", `${fmtEng(p, "W", 2)} · ${Math.round(p / w * 100)}% of ${w} W`, p > w ? "bad" : p > 0.6 * w ? "warn" : "")
               : R.kv("Power (avg)", fmtEng(p, "W", 2), p > 1 ? "warn" : ""));
      }
    },
    pot: { readout: (c, R) => R.kv("Wiper DC", fmtEng(R.netDC(R.pinNet("W")), "V", 2)) },
    capacitor: { readout: (c, R) => R.kv("DC voltage across", fmtEng(R.vAcross("1", "2"), "V", 1)) },
    electrolytic: {
      readout: (c, R) => {
        const v = R.vAcross("+", "-");
        return R.kv("DC voltage across", fmtEng(v, "V", 1), v < -0.5 ? "bad" : "") + (v < -0.5 ? R.note("Reverse-biased electrolytic.", "warn") : "");
      }
    },
    switch: { info: () => "Double-click the switch on the sheet to flip it. Sections named like SF1.1 and SF1.2 are one switch and flip together." },
    spst: { info: c => (c.params.kind === "toggle" ? "Double-click the switch on the sheet to flip it." : "Double-click the button on the sheet to press it (it stays pressed until you double-click again). ") + " Sections named like SA1.1 and SA1.2 are one switch and move together (a DPST)." },
    rotary: { info: () => "Double-click the switch on the sheet to turn it to the next way. Sections named like SA1.1 and SA1.2 are the poles of one selector and turn together." },
    relay: {
      readout: (c, R) => {
        const d = R.r.dc.devices[c.id], q = d && d.main ? d.main.q : null, m = RELAYS[c.params.model] || RELAYS["G5LE-1"], v = +c.params.v || 12, k = relayCoil(m, v), vc = R.vAcross("A1", "A2");
        return R.kv("Contacts", q === null ? "—" : q > 0.99 ? "pulled in (COM to NO)" : q < 0.01 ? "at rest (COM to NC)" : `pulled in ${Math.round(q * 100)} % of the time`, q !== null && q > 0.01 && q < 0.99 ? "warn" : "")
          + R.kv("Coil voltage (DC)", fmtEng(vc, "V", 2), Math.abs(vc) > 1.3 * v ? "bad" : "") + R.kv("Coil current", fmtEng(vc / k.r, "A", 2));
      }
    },
    vactrol: {
      readout: (c, R) => {
        const d = R.r.dc.devices[c.id], i = R.pinCurrent("A"), m = d && d.main;
        return R.kv("LED current", fmtEng(i, "A", 2), i > 0.04 ? "bad" : "") + R.kv("Cell resistance", m ? fmtEng(m.r, "Ω", 3) : "—") + (m && R.r.dcAveraged ? R.note("Averages over the settled cycle.") : "");
      }
    },
    pickup: { readout: (c, R) => R.kv("Signal at the pins", fmtEng((R.stats(R.wave("+")) || {}).rmsAC, "Vrms", 3)) },
    phono: { readout: (c, R) => R.kv("Signal at the pins", fmtEng((R.stats(R.wave("+")) || {}).rmsAC, "Vrms", 3)) },
    inductor: { readout: (c, R) => { const v = R.vAcross("1", "2"); return R.kv("DC current", fmtEng(v / Math.max(c.params.dcr, 1e-3), "A", 2)) + R.kv("DC drop", fmtEng(v, "V", 2)); } },
    speaker: {
      panel: (c, R) => (c.params.model === "ts" ? speakerPlot(c) : null),
      readout: (c, R) => {
        const sp = R.speakerPower(), f = R.signalFreq();
        let h = sp ? R.kv("Output power", fmtEng(sp.p, "W", 2)) + R.kv("Voltage", fmtEng(sp.vrms, "Vrms", 2))
                   : R.kv("Output power", fmtEng(R.pAvg("+", "-", c.params.r), "W", 2));
        if (c.params.model === "ts" && f) { const [z, ph] = speakerZ(c.params, f); h += R.kv(`Impedance at ${fmtEng(f, "Hz")}`, `${fmtEng(z, "Ω", 3)} · ${ph >= 0 ? "+" : ""}${ph.toFixed(0)}°`); }
        return h;
      }
    },
    fuse: {
      readout: (c, R) => {
        const s = R.seriesPart(); if (!s) return R.note("No data.");
        const share = s.i / (+c.params.a || 1);
        return R.kv("Current (rms)", fmtEng(s.i, "A", 2) + ` · ${Math.round(share * 100)}%`, share > 1 ? "bad" : share > 0.75 ? "warn" : "") + R.kv("Drop (rms)", fmtEng(s.i * s.r, "V", 2));
      }
    },
    ntc: {
      readout: (c, R) => {
        const s = R.seriesPart(), m = NTCS[c.params.model]; if (!s || !m) return R.note("No data.");
        return R.kv("Current (rms)", fmtEng(s.i, "A", 2) + ` · ${Math.round(s.i / m.imax * 100)}%`, s.i > m.imax ? "bad" : "") + R.kv("Resistance, hot", fmtEng(s.r, "Ω", 2)) + R.kv("Dissipation", fmtEng(s.p, "W", 2))
          + (s.i < 0.1 * m.imax ? R.note(`Under a tenth of its ${m.imax} A it barely warms: it stays near ${fmtEng(m.r25, "Ω")} and wastes power. A smaller part suits this current.`, "warn") : "");
      }
    },
    mov: {
      readout: (c, R) => {
        const m = MOVS[c.params.model], v = R.vRms("1", "2"), w = R.wave("1"), x = R.wave("2");
        if (!m || v === null) return R.note("No data.");
        let pk = 0; if (w && x) for (let k = 0; k < w.length; k++) pk = Math.max(pk, Math.abs(w[k] - x[k]));
        return R.kv("Voltage across (rms)", fmtEng(v, "V", 1) + ` · ${Math.round(v / m.vrms * 100)}% of ${m.vrms} V`, v > m.vrms ? "bad" : "") + (pk ? R.kv("Peak", fmtEng(pk, "V", 1), pk > m.v1ma ? "bad" : "") : "");
      }
    },
    isrc: {
      readout: (c, R) => {
        const v = R.vAcross("+", "-");
        return R.kv("Voltage across (+ to -)", fmtEng(v, "V", 2), v !== null && v > 0 ? "warn" : "") + R.kv("Dissipation", fmtEng(v !== null ? -v * c.params.i : null, "W", 2))
          + (v !== null && v > 0 ? R.note("The + pin is above the - pin: the source drives current uphill and delivers power, which a transistor current source cannot.", "warn") : "");
      }
    },
    vcvs: {
      readout: (c, R) => {
        const d = (R.r.dc.devices[c.id] || {}).main;
        return R.kv("Control (C+ to C−)", fmtEng(R.vAcross("C+", "C-"), "V", 3)) + R.kv("Output (+ to −)", fmtEng(R.vAcross("+", "-"), "V", 3))
          + R.kv("Output current", fmtEng(d ? -d.i : null, "A", 3));
      }
    },
    vccs: {
      readout: (c, R) => {
        const d = (R.r.dc.devices[c.id] || {}).main;
        return R.kv("Control (C+ to C−)", fmtEng(R.vAcross("C+", "C-"), "V", 3)) + R.kv("Output current (out of +)", fmtEng(d ? d.i : null, "A", 3))
          + R.kv("Voltage across (+ to −)", fmtEng(R.vAcross("+", "-"), "V", 3));
      }
    },
    timer555: {
      readout: (c, R) => {
        const dev = R.r.dc.devices[c.id], d = dev && dev.main;
        if (!d) return R.note("No data.");
        let h = R.kv("Supply (VCC–GND)", fmtEng(d.vcc, "V", 2), d.vcc > 16 ? "bad" : d.vcc < 4.5 ? "warn" : "");
        // frequency and duty cycle from the output's edges over the captured window (a mid-level crossing)
        const tr = R.r.tran, w = tr && tr.nodes[R.pinNet("3")];
        let f = null, duty = null;
        if (w && w.length > 2) {
          let lo = Infinity, hi = -Infinity; for (const v of w) { if (v < lo) lo = v; if (v > hi) hi = v; }
          const mid = (lo + hi) / 2, at = i => i + (mid - w[i]) / (w[i + 1] - w[i]), up = [], dn = [];
          if (hi - lo > 0.5) for (let i = 0; i + 1 < w.length; i++) { if (w[i] < mid && w[i + 1] >= mid) up.push(at(i)); else if (w[i] >= mid && w[i + 1] < mid) dn.push(at(i)); }
          // the last cycles (the first may still be the start)
          if (up.length >= 2) {
            const k = up.length >= 3 ? 1 : 0, T = (up[up.length - 1] - up[k]) / (up.length - 1 - k), u0 = up[up.length - 2], d0 = dn.find(x => x > u0);
            f = 1 / (T * tr.dt); if (d0 !== undefined && d0 < up[up.length - 1]) duty = (d0 - u0) / (up[up.length - 1] - u0);
          }
        }
        if (f) h += R.kv("Output frequency", fmtEng(f, "Hz", 3)) + (duty !== null ? R.kv("Duty cycle (high)", (duty * 100).toFixed(1) + " %") : "");
        else {
          // at rest (a one-shot waiting, a latch): the output's state and load
          h += R.kv("Output", `${d.q ? "high" : "low"} · ${fmtEng(d.vout, "V", 2)}`);
          h += R.kv("Output current", fmtEng(d.iout, "A", 2), Math.abs(d.iout) > 0.2 ? "bad" : Math.abs(d.iout) > 0.1 ? "warn" : "");
          h += R.kv("Dissipation", `${fmtEng(d.pd, "W", 2)} · ${Math.round(d.pd / 0.6 * 100)}% of 0.6 W`, d.pd > 0.6 ? "bad" : d.pd > 0.4 ? "warn" : "");
        }
        if (!f) h += R.note("No full cycle in the simulation window (or a one-shot at rest): the oscilloscope's power-on run shows slower timing.");
        return h;
      }
    },
    rail: {
      readout: (c, R) => {
        // the net's one source may be another rail of the same name
        const dev = R.railDevice(), i = dev && dev.main ? -dev.main.i : null, v = R.netDC(R.pinNet("1"));
        return R.kv("Rail voltage", fmtEng(v, "V", 3)) + R.kv("Current supplied", fmtEng(i, "A", 2)) + R.kv("Power", fmtEng(i !== null && v !== null ? i * v : null, "W", 2));
      }
    },
    vdc: {
      readout: (c, R) => {
        const dev = R.r.dc.devices[c.id], i = dev && dev.main ? -dev.main.i : null;
        return R.kv("Current supplied", fmtEng(i, "A", 2)) + R.kv("Power", fmtEng(i !== null ? i * c.params.v : null, "W", 2));
      }
    },
    scope: {
      // this scope's channels in the instrument windows
      panel: c => {
        const open = document.createElement("div"); open.className = "insp-open";
        open.innerHTML = `<div class="insp-sub">Open in</div><div class="insp-actions">${[["oscilloscope.html", "Oscilloscope", "Full oscilloscope: cursors, X-Y, power-on run"], ["spectrum_analyzer.html", "Spectrum", "Spectrum analyzer: harmonics and THD"], ["bode.html", "Bode", "Bode plotter: gain and phase against frequency"]].map(([f, t, tip]) => `<button class="btn link" data-win="${f}" title="${tip}">${t} ↗</button>`).join("")}</div>`;
        open.querySelectorAll("[data-win]").forEach(b => b.addEventListener("click", () => ToolWindows.open(b.dataset.win, { scope: c.id })));
        return open;
      },
      readout: (c, R) => {
        const ch = R.scopeChannels();
        if (!ch) return R.note("No transient data (add a signal generator).");
        return [["CH1", ch.ch1], ["CH2", ch.ch2]].map(([n, a]) => {
          if (!a) return R.kv(n, "not connected");
          const s = R.stats(a); return R.kv(n, `${fmtEng(s.pp, "Vpp", 2)} · avg ${fmtEng(s.mean, "V", 2)}`);
        }).join("");
      }
    }
  };
  // transistors: the four kinds share one readout
  const semiReadout = (c, R) => {
    const dev = R.r.dc.devices[c.id], d = dev && dev.main, m = semiTable(c.type)[c.params.model], kv = R.kv;
    if (!d || !m) return R.note("No data.");
    const bip = !isFet(c.type), jf = c.type === "njf" || c.type === "pjf", vMain = bip ? d.vce : d.vds, iMain = bip ? d.ic : d.id;
    let h = kv(bip ? "Vce" : "Vds", fmtEng(vMain, "V", 2), Math.abs(vMain) > m.v ? "bad" : Math.abs(vMain) > 0.8 * m.v ? "warn" : "");
    h += kv(bip ? "Vbe" : "Vgs", fmtEng(bip ? d.vbe : d.vgs, "V", 3));
    h += kv(bip ? "Ic" : "Id", fmtEng(iMain, "A", 2), Math.abs(iMain) > m.i ? "bad" : "");
    if (bip) h += kv("Ib", fmtEng(d.ib, "A", 2)) + kv("hFE (Ic/Ib)", Math.abs(d.ib) > 1e-12 ? (d.ic / d.ib).toFixed(0) : "—");
    // germanium: the leakage at the part's temperature, and how much of Ic it makes up ((hFE + 1)·ICBO)
    if (bip && m.ge) { const a = bjtAt(m, c.params.temp), iceo = (a.bf + 1) * a.icbo; h += kv(`Leakage at ${+a.t.toFixed(1)} °C`, `ICBO ${fmtEng(a.icbo, "A", 2)} · ×hFE ≈ ${fmtEng(iceo, "A", 2)}`, Math.abs(d.ic) > 0 && iceo > 0.5 * Math.abs(d.ic) ? "warn" : ""); }
    h += kv("Dissipation", `${fmtEng(d.pd, "W", 2)} · ${Math.round(d.pd / m.p * 100)}% of ${m.p} W`, d.pd > m.p ? "bad" : d.pd > 0.6 * m.p ? "warn" : "");
    if (bip && d.vce < 0.3 && d.ic > 1e-6) h += R.note("Saturated (Vce below 0.3 V).", "warn");
    if (jf) { const idss = m.beta * m.vto * m.vto; h += kv("Id / IDSS", `${Math.round(Math.abs(iMain) / idss * 100)}% of ${fmtEng(idss, "A", 2)}`); if (d.vgs > 0.4) h += R.note("The gate is forward-biased: it conducts and draws current.", "warn"); }
    if (!bip && Math.abs(iMain) < 1e-6) h += R.note(jf ? "Off: Vgs beyond the pinch-off." : "Off: Vgs below the threshold.");
    if (m.p > 2) h += R.note(`Rated ${m.p} W with the case at 25 °C: needs a heatsink well before that.`);
    return h;
  };
  ["npn", "pnp", "nmos", "pmos", "njf", "pjf"].forEach(t => { UI[t] = { readout: semiReadout }; });
  // op-amps: the output and how close it runs to its limits, the input difference, the package's heat
  UI.opamp = {
    readout: (c, R) => {
      const dev = R.r.dc.devices[c.id], d = dev && dev.main, m = (c.type === "chipamp" ? CHIPAMPS : OPAMPS)[c.params.model], kv = R.kv;
      if (!d || !m) return R.note("No data.");
      // the clip trace: how far past its output limit the amplifier is driven at each sample
      const w = R.wave("OUT"), tr = R.r.tran && R.r.tran.devices[c.id], clipped = tr ? tr.i.some(v => Math.abs(v) > 0.05) : Math.abs(d.clip) > 0.05, stuck = Math.abs(d.clip) > 0.05;
      let h = kv("Supply (V+ − V−)", fmtEng(d.vs, "V", 2), d.vs > m.vmax ? "bad" : d.vs < 2 ? "warn" : "");
      h += kv("Output (DC)", fmtEng(d.vout, "V", 2), stuck ? "warn" : "") + kv("Output current", fmtEng(d.iout, "A", 2), Math.abs(d.iout) > 0.8 * (d.iout > 0 ? m.isc : m.isk) ? "warn" : "");
      h += kv("IN+ − IN−", fmtEng(d.vd, "V", 2));
      if (w) { const s = R.stats(w); h += kv("Output swing", `${fmtEng(s.pp, "Vpp", 2)} · ${fmtEng(s.min, "V", 2)} to ${fmtEng(s.max, "V", 2)}`, clipped ? "warn" : ""); }
      if (clipped && !stuck) h += R.note(`The output reaches its limit (${m.dhi} V below V+, ${m.dlo} V above V−, less the drop across its ${m.ro} Ω output resistance): it clips.`, "warn");
      h += kv("Dissipation", fmtEng(d.pd, "W", 2) + (m.pmax ? ` · ${m.pmax} W max` : ""), m.pmax && d.pd > m.pmax ? "bad" : "");
      if (stuck) h += R.note("The output sits at its limit: no negative feedback, or the inputs are outside what the circuit can follow.", "warn");
      if (d.vs < 2) h += R.note("No supply: wire V+ and V− to the rails.", "warn");
      return h;
    }
  };
  UI.chipamp = UI.opamp;
  // regulators: input, output and the headroom between them; the chip's heat
  UI.reg = {
    readout: (c, R) => {
      const dev = R.r.dc.devices[c.id], d = dev && dev.main, m = REGS[c.params.model], kv = R.kv;
      if (!d || !m) return R.note("No data.");
      const drop = d.vio < m.vdo + 0.5, hot = d.pd > (m.pkg === "TO-92" ? 0.6 : 2);
      let h = kv(m.adj ? "Output (OUT − ADJ)" : "Output (OUT − GND)", fmtEng(d.vout * m.pol, "V", 3));
      h += kv("Headroom (IN − OUT)", fmtEng(d.vio, "V", 2), d.vio > m.vmax ? "bad" : drop ? "warn" : "");
      h += kv("Output current", fmtEng(d.iout, "A", 2), d.iout > 0.9 * m.ilim ? "warn" : "");
      h += kv("Dissipation", fmtEng(d.pd, "W", 2), d.pd > m.p ? "bad" : hot ? "warn" : "");
      if (drop) h += R.note(`In dropout: the input is too close to the output to regulate (it needs about ${(m.vdo + 0.5).toFixed(1)} V or more; ripple troughs count).`, "warn");
      if (m.adj && d.iout < m.iq) h += R.note(`Below the minimum load (${fmtEng(m.iq, "A")}): the output rises. Lower R1 or add a load.`, "warn");
      if (hot) h += R.note(m.pkg === "TO-92" ? "A TO-92 manages about 0.6 W in still air." : "Above about 2 W a TO-220 needs a heatsink.", hot && d.pd > m.p ? "bad" : "");
      return h;
    }
  };
  UI.gasreg = {
    readout: (c, R) => {
      const d = (R.r.dc.devices[c.id] || {}).main, m = GASREGS[c.params.model];
      if (!d || !m) return R.note("No data.");
      let h = R.kv("State", d.q ? "lit (regulating)" : "dark", d.q ? "" : "warn") + R.kv("Voltage (A − K)", fmtEng(d.vd, "V", 3));
      h += R.kv("Current", fmtEng(d.i, "A", 2) + ` · range ${m.imin * 1000}–${m.imax * 1000} mA`, d.q && (d.i > m.imax ? "bad" : d.i < m.imin ? "warn" : ""));
      if (!d.q) h += R.note(`Dark: it strikes at ${m.vs} V and goes out below ${m.iext * 1000} mA.`, "warn");
      return h;
    }
  };
  UI.neon = {
    readout: (c, R) => {
      const a = (R.r.dc.devices[c.id] || {}).main, b = (R.r.dc.devices[c.id + "#rev"] || {}).main, m = NEONS[c.params.model] || NEONS["NE-2"];
      if (!a || !b) return R.note("No data.");
      const lit = a.q > 0 || b.q > 0, i = R.pinCurrent("A");
      if (R.r.dcAveraged) return R.kv("Voltage (rms)", fmtEng(R.vRms("A", "K"), "V", 3)) + R.note(lit ? "Lit over the settled cycle (on AC on both half-cycles): Animate shows it." : `Dark: it strikes at about ${m.vs} V.`, lit ? "" : "warn");
      let h = R.kv("State", lit ? "lit" : "dark", lit ? "" : "warn") + R.kv("Voltage", fmtEng(R.vAcross("A", "K"), "V", 3));
      h += R.kv("Current", fmtEng(Math.abs(i), "A", 2) + ` · design ${fmtEng(m.i, "A")}`, Math.abs(i) > 2 * m.i ? "bad" : "");
      if (!lit) h += R.note(`Dark: it strikes at about ${m.vs} V.`, "warn");
      return h;
    }
  };
  UI.eye = {
    readout: (c, R) => {
      const m = EYES[c.params.model] || EYES["6E5"], vt = R.vAcross("T", "K"), vp = R.vAcross("P", "K"), vg = R.vAcross("G", "K");
      if (vt === null || vp === null) return R.note("No data.");
      const e = eyeShadow(m, vt, vp);
      return R.kv("Target", fmtEng(vt, "V", 3), vt > 1.1 * m.vt ? "bad" : "") + R.kv("Triode plate", fmtEng(vp, "V", 3)) + R.kv("Grid", fmtEng(vg, "V", 3)) +
        R.kv("Shadow", `${Math.round(90 * e.shadow)}°${e.shadow > 0.98 ? " (fully open)" : e.shadow < 0.02 ? " (closed)" : ""}`) + (R.r.dcAveraged ? R.note("Averages over the settled cycle: Animate shows it moving.") : "");
    }
  };
  UI.tl431 = {
    readout: (c, R) => {
      const dev = R.r.dc.devices[c.id], d = dev && dev.main, m = SHUNTS[c.params.model], kv = R.kv;
      if (!d || !m) return R.note("No data.");
      let h = kv("Cathode (K − A)", fmtEng(d.vka, "V", 3), d.vka > m.v ? "bad" : "") + kv("REF − A", fmtEng(d.vref, "V", 4));
      h += kv("Cathode current", fmtEng(d.ik, "A", 2), d.ik > m.imax * 0.66 ? "warn" : "");
      h += kv("Dissipation", fmtEng(d.pd, "W", 2), d.pd > m.p ? "bad" : d.pd > 0.6 * m.p ? "warn" : "");
      if (d.ik < 1e-3 && d.vref > m.vref - 0.05) h += R.note("Less than 1 mA in the cathode: below the current it needs to regulate.", "warn");
      return h;
    }
  };
  // diodes: voltage and current; a zener's dissipation, an LED's maximum current
  const diodeReadout = (c, R) => {
    const v = R.vAcross("A", "K"), i = R.pinCurrent("A");
    let h = R.kv("Voltage (A–K)", fmtEng(v, "V", 3)) + R.kv("Current (A→K)", fmtEng(i, "A", 2));
    if (c.type === "zener") { const z = ZENERS[c.params.model], p = Math.abs(v * i); if (z) h += R.kv("Dissipation", `${fmtEng(p, "W", 2)} · ${Math.round(p / z.p * 100)}% of ${z.p} W`, p > z.p ? "bad" : p > 0.6 * z.p ? "warn" : ""); }
    if (c.type === "led") { const l = LEDS[c.params.color]; if (l && i > l.i) h += R.note(`Above the ${l.i * 1000} mA maximum.`, "warn"); }
    return h;
  };
  ["diode", "zener", "led"].forEach(t => { UI[t] = { readout: diodeReadout }; });
  // a bridge: its DC output, the current it delivers, the peak reverse voltage on its diodes
  UI.bridge = {
    readout: (c, R) => {
      const b = BRIDGES[c.params.model], v = R.vAcross("+", "-"), i = R.pinCurrent("+"), wp = R.wave("+"), wm = R.wave("-");
      let piv = v; if (wp && wm) { piv = 0; for (let k = 0; k < wp.length; k++) piv = Math.max(piv, wp[k] - wm[k]); }
      let h = R.kv("Output (+ to −)", fmtEng(v, "V", 3)) + R.kv("Output current", fmtEng(i === null ? null : -i, "A", 2), b && i !== null && -i > b.i ? "bad" : "");
      if (piv !== null && b) h += R.kv("Peak reverse voltage", `${fmtEng(piv, "V", 3)} · ${Math.round(piv / b.v * 100)}% of ${b.v} V`, piv > b.v ? "bad" : piv > 0.8 * b.v ? "warn" : "");
      return h;
    }
  };
  // output transformers: the secondary's voltage; a catalog part's primary current against its rating
  const otReadout = (c, R) => {
    let h = "";
    if (c.type === "opt_cat") {
      const i = R.otDcCurrent(), m = OUTPUT_TX[c.params.model];
      if (i !== null && m) h += R.kv("Primary DC current", `${fmtEng(i, "A", 2)} · ${Math.round(i * 1000 / m.ma * 100)}% of ${m.ma} mA`, i * 1000 > m.ma ? "bad" : i * 1000 > 0.9 * m.ma ? "warn" : "");
    }
    if (c.type === "opt_se" && +c.params.idc > 0) {
      const i = R.otDcCurrent(), ma = +c.params.idc * 1000;
      if (i !== null) h += R.kv("Primary DC current", `${fmtEng(i, "A", 2)} · ${Math.round(i * 1000 / ma * 100)}% of ${fmtEng(+c.params.idc, "A")}`, i * 1000 > ma ? "bad" : i * 1000 > 0.9 * ma ? "warn" : "");
    }
    // the core's flux at its peak over the window, against the knee (sim-engine.js coreFlux)
    const tr = R.r.tran && R.r.tran.devices[c.id];
    if (tr) {
      let pk = 0; for (let k = 0; k < tr.i.length; k++) pk = Math.max(pk, Math.abs(tr.i[k]));
      h += R.kv("Core flux, peak", `${Math.round(pk * 100)}% of saturation`, pk > 0.95 ? "bad" : pk > 0.8 ? "warn" : "");
      if (pk > 0.95) h += R.note("The core saturates: the bass distorts and the primary current peaks. Less power at this frequency, less DC (or DC in balance), or a bigger transformer.", "warn");
    }
    return h + R.kv("Secondary", fmtEng(Math.sqrt(R.pAvg("S1", "S2", 1)), "Vrms", 2));
  };
  ["opt_se", "opt_cat", "opt_pp"].forEach(t => { UI[t] = { readout: otReadout }; });
  Object.keys(UI).forEach(t => Object.keys(UI[t]).forEach(k => { if (!LIB[t][k]) LIB[t][k] = UI[t][k]; }));
  // a loudspeaker's impedance (solid) and phase (dotted) from 10 Hz to 20 kHz, the nominal value dashed
  function speakerPlot(c) {
    const wrap = document.createElement("div"); wrap.className = "spk-plot";
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 150; cv.id = "spk-plot"; wrap.appendChild(cv);
    const x = cv.getContext("2d"), W = cv.width, H = cv.height, L = 30, Rm = 28, T = 8, B = 18, f1 = 10, f2 = 20000;
    const pts = Array.from({ length: 161 }, (_, i) => { const f = f1 * Math.pow(f2 / f1, i / 160); return [f, ...speakerZ(c.params, f)]; });
    const zmax = Math.max(...pts.map(p => p[1])) * 1.1, X = f => L + (W - L - Rm) * Math.log(f / f1) / Math.log(f2 / f1), Y = z => H - B - (H - B - T) * z / zmax, P = ph => T + (H - B - T) * (90 - ph) / 180;
    x.fillStyle = "#0b0f14"; x.fillRect(0, 0, W, H); x.font = "9px ui-monospace, monospace";
    [10, 100, 1000, 10000].forEach(f => { x.strokeStyle = "#1b2430"; x.beginPath(); x.moveTo(X(f), T); x.lineTo(X(f), H - B); x.stroke(); x.fillStyle = "#6e7781"; x.fillText(f >= 1000 ? f / 1000 + "k" : String(f), X(f) - 6, H - 5); });
    [0, 0.5, 1].forEach(k => { const z = zmax / 1.1 * k; x.fillStyle = "#6e7781"; x.fillText(z.toFixed(0), 3, Y(z) + 3); });
    x.font = "9px sans-serif"; x.fillText("|Z| Ω", L + 3, T + 8); x.font = "9px ui-monospace, monospace";
    ["+90°", "0°", "−90°"].forEach((t, k) => { x.fillStyle = "#6e7781"; x.fillText(t, W - Rm + 3, T + (H - B - T) * k / 2 + 3); });
    x.strokeStyle = "#8b949e"; x.setLineDash([4, 3]); x.beginPath(); x.moveTo(L, Y(c.params.r)); x.lineTo(W - Rm, Y(c.params.r)); x.stroke(); x.setLineDash([]);
    x.strokeStyle = "#ffd54f"; x.lineWidth = 1.5; x.beginPath(); pts.forEach(([f, z], i) => (i ? x.lineTo(X(f), Y(z)) : x.moveTo(X(f), Y(z)))); x.stroke();
    x.strokeStyle = "#58a6ff"; x.lineWidth = 1; x.setLineDash([2, 2]); x.beginPath(); pts.forEach(([f, , ph], i) => (i ? x.lineTo(X(f), P(ph)) : x.moveTo(X(f), P(ph)))); x.stroke(); x.setLineDash([]);
    // the resonance peak near fs, and the lowest point between it and the voice coil's rise
    const fs = c.params.fs, near = pts.filter(p => p[0] > fs / 3 && p[0] < fs * 3), peak = (near.length ? near : pts).reduce((a, p) => (p[1] > a[1] ? p : a));
    const above = pts.filter(p => p[0] > peak[0] && p[0] < 10000), dip = above.reduce((a, p) => (p[1] < a[1] ? p : a), above[0] || peak);
    const ph = pts.reduce((a, p) => (Math.abs(p[2]) > Math.abs(a) ? p[2] : a), 0);
    const note = document.createElement("p"); note.className = "insp-help";
    note.textContent = `Impedance (yellow) and phase (blue): ${peak[1].toFixed(0)} Ω at ${peak[0].toFixed(0)} Hz, ${dip[1].toFixed(1)} Ω at ${dip[0] >= 1000 ? (dip[0] / 1000).toFixed(1) + " kHz" : dip[0].toFixed(0) + " Hz"} at the lowest above it, phase up to ${ph >= 0 ? "+" : ""}${ph.toFixed(0)}°. The tube sees this through the output transformer.`;
    wrap.appendChild(note);
    return wrap;
  }

  root.CadLib = { anodeTemp, CHIPAMPS, NEONS, EYES, eyeShadow, PICKUPS, CARTRIDGES, RIAA_T, riaaRec, RELAYS, relayCoil, VACTROLS, vactrolModel, GASREGS, ITX_PRESETS, DIODES, BRIDGES, NTCS, ntcLaw, MOVS, movModel, FUSE_RATINGS, fuseCold, JACKS, JFETS, REGS, regModel, SHUNTS, semiTable, isFet, isTransistor, bjtAt, SPEAKER_PRESETS, speakerTS, speakerZ, FLIP_FIELD, LIB, DRAW, COL, PALETTE, SHEETS, sheetGeom, MM, POWER_TX, powerTx, OUTPUT_TX, OPT_SE, OPT_PP, optModel, BJTS, MOSFETS, ZENERS, LEDS, OPAMPS, opampModel, semiRating, parseEng, fmtEng, tubeByName, tubeKind, tubeWarmup };
})(globalThis);
