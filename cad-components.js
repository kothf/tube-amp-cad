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
  // Drawing helpers (local coordinates, already rotated by the caller)
  // ---------------------------------------------------------------------------
  const COL = { body: "#58a6ff", bodySel: "#00e5ff", tube: "#e6edf3", hot: "#ff7b72", text: "#e6edf3", value: "#79c0ff", fill: "#0d1420" };
  function line(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke(); }

  const DRAW = {
    resistor(ctx) {
      line(ctx, [-30, 0, -15, 0]); line(ctx, [15, 0, 30, 0]);
      ctx.fillStyle = COL.fill; ctx.fillRect(-15, -6, 30, 12); ctx.strokeRect(-15, -6, 30, 12);
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
      line(ctx, [-20, 0, -4, 0]); line(ctx, [7, 0, 20, 0]);
      ctx.lineWidth = 2.5; line(ctx, [-4, -11, -4, 11]);
      ctx.beginPath(); ctx.arc(16, 0, 12, Math.PI * 0.78, Math.PI * 1.22); ctx.stroke();
      ctx.lineWidth = 1.2; line(ctx, [-13, -10, -9, -10]); line(ctx, [-11, -12, -11, -8]);
    },
    inductor(ctx) {
      line(ctx, [-30, 0, -20, 0]); line(ctx, [20, 0, 30, 0]);
      ctx.beginPath(); for (let i = 0; i < 4; i++) ctx.arc(-15 + i * 10, 0, 5, Math.PI, 0); ctx.stroke();
      line(ctx, [-20, -8, 20, -8]); line(ctx, [-20, -10, 20, -10]);
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
    ground(ctx) {
      line(ctx, [0, 0, 0, 8]); line(ctx, [-12, 8, 12, 8]); line(ctx, [-7, 13, 7, 13]); line(ctx, [-2, 18, 2, 18]);
    },
    vdc(ctx) {
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.5; line(ctx, [-4, -6, 4, -6]); line(ctx, [0, -10, 0, -2]); line(ctx, [-4, 6, 4, 6]);
    },
    siggen(ctx) {
      line(ctx, [0, -30, 0, -14]); line(ctx, [0, 14, 0, 30]);
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 20; i++) { const x = -8 + i * 0.8, y = -5 * Math.sin(i / 20 * Math.PI * 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
    },
    ptx(ctx) {
      // AC source + secondary with centre tap; pins on the right
      ctx.beginPath(); ctx.arc(-26, 0, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i <= 16; i++) { const x = -33 + i * 0.9, y = -4 * Math.sin(i / 16 * Math.PI * 2); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
      line(ctx, [-26, -12, -26, -30, -10, -30]); line(ctx, [-26, 12, -26, 30, -10, 30]);
      ctx.beginPath(); for (let i = 0; i < 4; i++) ctx.arc(-10, -30 + 7.5 + i * 15, 7.5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      line(ctx, [-4, -40, -4, 40]); line(ctx, [-1, -40, -1, 40]);
      ctx.beginPath(); for (let i = 0; i < 8; i++) ctx.arc(6, -40 + 5 + i * 10, 5, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      line(ctx, [6, -40, 20, -40]); line(ctx, [6, 0, 20, 0]); line(ctx, [6, 40, 20, 40]);
    },
    opt_se(ctx) {
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(-12, -30 + 5 + i * 10, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(12, -30 + 5 + i * 10, 5, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      line(ctx, [-2, -32, -2, 32]); line(ctx, [2, -32, 2, 32]);
      line(ctx, [-40, -30, -12, -30]); line(ctx, [-40, 30, -12, 30]); line(ctx, [12, -30, 40, -30]); line(ctx, [12, 30, 40, 30]);
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(-20, -24, 2, 0, Math.PI * 2); ctx.arc(20, -24, 2, 0, Math.PI * 2); ctx.fill();
    },
    opt_pp(ctx) {
      ctx.beginPath(); for (let i = 0; i < 8; i++) ctx.arc(-12, -40 + 5 + i * 10, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.arc(12, -30 + 5 + i * 10, 5, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      line(ctx, [-2, -42, -2, 42]); line(ctx, [2, -42, 2, 42]);
      line(ctx, [-40, -40, -12, -40]); line(ctx, [-40, 40, -12, 40]); line(ctx, [-40, 0, -12, 0]);
      ctx.setLineDash([2, 2]); line(ctx, [-40, -20, -12, -20]); line(ctx, [-40, 20, -12, 20]); ctx.setLineDash([]);
      line(ctx, [12, -30, 40, -30]); line(ctx, [12, 30, 40, 30]);
    },
    tube(ctx, c) {
      const t = tubeByName(c.params.tube), kind = tubeKind(t), conn = c.params.connection || kind;
      ctx.strokeStyle = c._sel ? COL.bodySel : COL.tube;
      ctx.fillStyle = COL.fill;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 1.6;
      if (kind === "rectifier") {
        line(ctx, [-20, -50, -20, -30]); line(ctx, [20, -50, 20, -30]);
        line(ctx, [-26, -14, -14, -14]); line(ctx, [14, -14, 26, -14]);
        line(ctx, [-20, -14, -20, -30]); line(ctx, [20, -14, 20, -30]);
        line(ctx, [-12, 14, 12, 14]); line(ctx, [0, 14, 0, 50]);
        return;
      }
      // anode
      line(ctx, [-12, -18, 12, -18]); line(ctx, [0, -18, 0, -50]);
      // cathode
      line(ctx, [-12, 18, 12, 18]); line(ctx, [-12, 18, -12, 22]); line(ctx, [0, 18, 0, 50]);
      ctx.setLineDash([3, 3]);
      if (conn === "pentode") {
        line(ctx, [-16, 4, 16, 4]);                       // G1
        line(ctx, [-16, -7, 16, -7]);                      // G2
        line(ctx, [-16, 11, 14, 11]);                      // G3 (tied to K)
        ctx.setLineDash([]);
        line(ctx, [-16, 4, -50, 4, -50, 0]);
        line(ctx, [16, -7, 50, -7, 50, -10]);
        line(ctx, [14, 11, 18, 11, 18, 18, 12, 18]);
      } else {
        line(ctx, [-16, 2, 16, 2]);
        ctx.setLineDash([]);
        line(ctx, [-16, 2, -50, 2, -50, 0]);
      }
      ctx.setLineDash([]);
    },
    scope(ctx) {
      ctx.fillStyle = "#101824"; ctx.fillRect(-70, -45, 140, 90); ctx.strokeRect(-70, -45, 140, 90);
      line(ctx, [-80, -30, -70, -30]); line(ctx, [-80, -10, -70, -10]); line(ctx, [-80, 30, -70, 30]);
    }
  };

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
      defaults: { r: 100e3 },
      pins: () => [{ id: "1", x: -30, y: 0 }, { id: "2", x: 30, y: 0 }],
      value: c => fmtEng(c.params.r, "Ω"),
      fields: [{ key: "r", label: "Resistance", unit: "Ω", kind: "eng" }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "R", nodes: [net("1"), net("2")], r: Math.max(c.params.r, 1e-3) })
    },
    pot: {
      name: "Potentiometer", prefix: "VR", group: "Passive", bbox: [-30, -22, 30, 10],
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
    speaker: {
      name: "Speaker", prefix: "SPK", group: "Passive", bbox: [-6, -20, 16, 20],
      defaults: { r: 8 },
      pins: () => [{ id: "+", x: 0, y: -20 }, { id: "-", x: 0, y: 20 }],
      value: c => fmtEng(c.params.r, "Ω"),
      fields: [{ key: "r", label: "Impedance", unit: "Ω", kind: "eng" }],
      build: (c, net, alloc, out) => out.push({ id: c.id, kind: "R", nodes: [net("+"), net("-")], r: Math.max(c.params.r, 0.1) })
    },
    opt_se: {
      name: "Output transformer (SE)", prefix: "T", group: "Transformers", bbox: [-40, -34, 40, 34],
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
    opt_pp: {
      name: "Output transformer (PP / UL)", prefix: "T", group: "Transformers", bbox: [-40, -44, 40, 44],
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
      name: "Power transformer (HT)", prefix: "TP", group: "Transformers", bbox: [-40, -44, 20, 44],
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
    tube: {
      name: "Vacuum tube", prefix: "V", group: "Tubes", bbox: [-50, -50, 50, 50],
      defaults: { tube: "12AX7", connection: "triode" },
      pins: c => {
        const t = tubeByName(c.params.tube), kind = tubeKind(t);
        if (kind === "rectifier") return [{ id: "A1", x: -20, y: -50, name: "anode 1" }, { id: "A2", x: 20, y: -50, name: "anode 2" }, { id: "K", x: 0, y: 50, name: "cathode" }];
        if ((c.params.connection || kind) === "pentode") return [{ id: "A", x: 0, y: -50, name: "anode" }, { id: "G1", x: -50, y: 0, name: "control grid" }, { id: "G2", x: 50, y: -10, name: "screen grid" }, { id: "K", x: 0, y: 50, name: "cathode" }];
        return [{ id: "A", x: 0, y: -50, name: "anode" }, { id: "G", x: -50, y: 0, name: "grid" }, { id: "K", x: 0, y: 50, name: "cathode" }];
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
      name: "Silicon diode", prefix: "D", group: "Semiconductors", bbox: [-20, -9, 20, 9],
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
    vdc: {
      name: "DC supply", prefix: "B", group: "Sources", bbox: [-16, -30, 16, 30],
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
      name: "Signal generator", prefix: "GEN", group: "Sources", bbox: [-16, -30, 16, 30],
      defaults: { wave: "sine", freq: 1000, amp: 1, offset: 0, phase: 0, rs: 50 },
      pins: () => [{ id: "+", x: 0, y: -30, name: "output" }, { id: "-", x: 0, y: 30, name: "common" }],
      value: c => fmtEng(c.params.amp, "Vpk") + " " + fmtEng(c.params.freq, "Hz"),
      fields: [
        { key: "wave", label: "Waveform", kind: "select", options: [["sine", "Sine"], ["square", "Square"], ["triangle", "Triangle"]] },
        { key: "freq", label: "Frequency", unit: "Hz", kind: "eng" },
        { key: "amp", label: "Amplitude", unit: "Vpk", kind: "eng" },
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
    ground: {
      name: "Ground", prefix: "GND", group: "Sources", bbox: [-12, -2, 12, 20], noLabel: true,
      defaults: {},
      pins: () => [{ id: "G", x: 0, y: 0 }],
      value: () => "",
      fields: [],
      build: () => {}
    },
    scope: {
      name: "Oscilloscope", prefix: "XSC", group: "Instruments", bbox: [-80, -45, 70, 45], noRotate: true,
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
    { group: "Passive", items: [["resistor"], ["pot"], ["capacitor"], ["electrolytic"], ["inductor"], ["speaker"]] },
    { group: "Transformers", items: [["opt_se"], ["opt_pp"], ["ptx"]] },
    { group: "Sources", items: [["vdc", { v: 300 }, "B+ supply"], ["vdc", { v: -20 }, "Bias supply"], ["siggen"], ["ground"]] },
    { group: "Semiconductors", items: [["diode"]] },
    { group: "Instruments", items: [["scope"]] }
  ];

  root.CadLib = { LIB, DRAW, COL, PALETTE, parseEng, fmtEng, tubeByName, tubeKind };
})(globalThis);
