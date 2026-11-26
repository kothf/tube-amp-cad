/* =============================================================================
   A TRANSISTOR'S OR DIODE'S SPICE MODEL FROM ITS DATASHEET — AI ▾ → Transistor or
   diode from a datasheet. The AI reads the datasheet (SYSTEM: the part's kind, pins,
   ratings, its typical table values and points along its typical graphs); here, with no
   AI, a .MODEL is fitted to those numbers by least squares (Nelder–Mead in the
   parameters' logarithms) on the simulator's own device laws:
     diode / zener: IS, N, RS from the forward curve; BV, IBV, NBV from VZ at IZ and ZZ;
                    CJO from the capacitance, TT from the reverse recovery time
     NPN / PNP:     Gummel–Poon IS, BF, IKF, ISE, NE, RE from hFE against IC and VBE against
                    IC; VAF from the output curves; RC from VCE(sat); CJE, CJC from Cib, Cob;
                    TF from fT
     MOSFET:        LTspice's VDMOS: VTO, KP, RS from the transfer curve, RD from RDS(on),
                    LAMBDA from the output curves; CGS, CGDMIN/MAX, CJO from Ciss, Crss, Coss;
                    the body diode from VSD
     JFET:          VTO, BETA from the transfer curve (or IDSS, VGS(off), gfs); CGS, CGD
   The model's text is then built the way a SPICE part builds it (spice-net.js) and its
   curves worked out from that, so what the card shows is what the circuit simulates.
   No DOM: tests/semifit.test.mjs runs it in Node.
   Depends on: sim-engine.js (TubeSimEngine.Semi), spice-model.js, spice-net.js
   ============================================================================= */
(function (root) {
  "use strict";
  const VT = 0.025852;
  const KINDS = { npn: "NPN transistor", pnp: "PNP transistor", nmos: "N-channel MOSFET", pmos: "P-channel MOSFET", njf: "N-channel JFET", pjf: "P-channel JFET", diode: "Diode", zener: "Zener diode" };
  const PINS = { npn: ["C", "B", "E"], pnp: ["C", "B", "E"], nmos: ["D", "G", "S"], pmos: ["D", "G", "S"], njf: ["D", "G", "S"], pjf: ["D", "G", "S"], diode: ["A", "K"], zener: ["A", "K"] };

  const SYSTEM = `You read the datasheet of a discrete semiconductor (a bipolar transistor, a MOSFET, a JFET, a diode or a zener) so that a SPICE model can be fitted to it. Answer with JSON only, in this shape (SI units: volts, amperes, ohms, farads, seconds, hertz, watts, °C; plain numbers, no units or prefixes in the numbers):
{"kind":"npn|pnp|nmos|pmos|njf|pjf|diode|zener","name":"the part number","maker":"","package":"TO-92","pins":"EBC",
 "ratings":{"vmax":0,"imax":0,"ptot":0,"tjmax":0,"rthjc":0,"rthja":0},
 "bjt":{"hfe":[{"ic":0,"vce":0,"hfe":0}],"vbe":[{"ic":0,"vbe":0}],"vcesat":[{"ic":0,"ib":0,"v":0}],"ft":0,"ft_ic":0,"cob":0,"cob_v":0,"cib":0,"cib_v":0,"output":[{"vce":0,"ic":0,"ib":0}],
   "hfe_norm":[{"ic":0,"k":0}],"hfe_typ":0,"hfe_min":0,"hfe_max":0,"hfe_ic":0,"hfe_vce":0,"ft_min":0},
 "fet":{"transfer":[{"vgs":0,"id":0,"vds":0}],"vth":0,"vth_id":0,"rdson":0,"rdson_vgs":0,"rdson_id":0,"idss":0,"vgsoff":0,"gfs":0,"gfs_id":0,"ciss":0,"coss":0,"crss":0,"cap_vds":0,"vsd":0,"vsd_is":0,"output":[{"vds":0,"id":0,"vgs":0}],
   "rdson_max":0,"vth_min":0,"vth_max":0,"idss_min":0,"idss_max":0,"vgsoff_min":0,"vgsoff_max":0},
 "diode":{"forward":[{"vf":0,"if":0}],"ir":0,"ir_v":0,"cj":0,"cj_v":0,"trr":0,"vz":0,"iz":0,"zz":0},
 "uncertain":["what you could not read well, or guessed"],"notes":"one or two sentences: what the part is"}
Rules:
- Fill only the block of the part's kind (bjt for npn/pnp, fet for MOSFETs and JFETs, diode for diodes and zeners); leave out what the datasheet does not give. Never invent a value.
- Typical values at 25 °C only (not minimum or maximum), from the tables and the "typical characteristics" graphs.
- Read the graphs: hFE against IC (several points per decade, across the whole curve, at the VCE the graph is drawn for), VBE(on) or VBE(sat) against IC, the MOSFET's or JFET's transfer curve ID against VGS (with the VDS it is drawn for), the diode's forward curve IF against VF (from the lowest current drawn to the highest). 6 to 15 points per curve. Output curves (IC against VCE at a fixed IB, or ID against VDS at a fixed VGS) only for 2 or 3 curves, in the flat part.
- An hFE graph drawn normalized (1.0 at some current): give its points in hfe_norm (k the relative gain), and in hfe_ic, hfe_vce a current and voltage the table gives hFE at, with its typical value as hfe_typ, or only its hfe_min and hfe_max when the table has no typical. A graph of hFE in absolute values goes in hfe as it is. fT given only as a minimum: ft_min.
- A value the table gives only as a limit, with no typical and no graph to read it from: RDS(on) only as a maximum in rdson_max; Vth, IDSS or VGS(off) only as a range in vth_min/vth_max, idss_min/idss_max, vgsoff_min/vgsoff_max (with vth_id, rdson_vgs, rdson_id as their conditions).
- A P-type part (pnp, pmos, pjf): give every voltage and current as positive magnitudes.
- vmax: VCEO, VDS(max) or VRRM (a zener: leave out); imax: IC, ID or IF(AV) continuous; ptot at 25 °C ambient for small parts, at 25 °C case for power parts.
- pins: the case's pins from pin 1 on, one letter each (E B C, G D S, A K), the case as the pinout drawing shows it; a tab joined to a pin is not a pin.
- vth_id: the drain current Vth is given at; rdson_vgs, rdson_id: its test conditions; cap_vds: the VDS the capacitances are given at; cob_v the VCB of Cob; cib_v the VEB of Cib; cj_v the reverse voltage of the diode's capacitance; ft_ic the IC fT is given at.`;

  // ---------------------------------------------------------------------------
  // Reading the AI's answer: numbers checked, the kind's own block, P parts in magnitudes
  // ---------------------------------------------------------------------------
  const num = v => { if (typeof v === "number") return isFinite(v) ? v : NaN; const m = /^\s*([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([pnuµmkKM]?)/i.exec(String(v || "")); if (!m) return NaN; const k = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6 }[m[2]] || 1; return +m[1] * k; };
  const pos = v => { const x = Math.abs(num(v)); return x > 0 && isFinite(x) ? x : undefined; };
  function rows(list, keys, problems, what) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach(p => {
      const r = {}; let ok = true;
      keys.forEach(k => { const x = pos(p && p[k]); if (x === undefined && k !== "vce" && k !== "vds") ok = false; else r[k] = x; });
      if (ok) out.push(r);
    });
    if (out.length < list.length) problems.push(`${list.length - out.length} point${list.length - out.length > 1 ? "s" : ""} of the ${what} could not be read and are left out`);
    return out;
  }
  function read(j) {
    if (!j || typeof j !== "object") throw new Error("the answer is not a datasheet reading");
    const kind = String(j.kind || "").toLowerCase().replace(/^n-?channel mosfet$/, "nmos").replace(/^p-?channel mosfet$/, "pmos");
    if (!KINDS[kind]) throw new Error(`the part is read as "${j.kind || "nothing"}": only bipolar transistors, MOSFETs, JFETs, diodes and zeners are modelled here (a tube: AI ▾ → Tube from a datasheet)`);
    const problems = [], name = String(j.name || "").trim().replace(/[^\w.+-]/g, "_").slice(0, 40) || kind.toUpperCase() + "_DS";
    const R = j.ratings || {}, ratings = {};
    ["vmax", "imax", "ptot", "tjmax", "rthjc", "rthja"].forEach(k => { const x = pos(R[k]); if (x !== undefined) ratings[k] = x; });
    const r = { kind, name, maker: String(j.maker || "").slice(0, 60), package: String(j.package || "").toUpperCase().replace(/\s+/g, "").replace(/^TO(\d)/, "TO-$1").replace(/^SOT(\d)/, "SOT-$1").slice(0, 20), ratings, problems,
      uncertain: (Array.isArray(j.uncertain) ? j.uncertain : []).map(String).filter(Boolean).slice(0, 12), notes: String(j.notes || "").slice(0, 400) };
    const pins = String(j.pins || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (pins && [...pins].every(l => PINS[kind].includes(l)) && new Set(pins).size === PINS[kind].length && pins.length === PINS[kind].length) r.pins = pins;
    else if (pins) problems.push(`the pins "${j.pins}" are not one each of ${PINS[kind].join(", ")}: set them on the board`);
    if (kind === "npn" || kind === "pnp") {
      const b = j.bjt || {};
      r.bjt = { hfe: rows(b.hfe, ["ic", "vce", "hfe"], problems, "hFE curve"), vbe: rows(b.vbe, ["ic", "vbe"], problems, "VBE curve"), vcesat: rows(b.vcesat, ["ic", "ib", "v"], problems, "VCE(sat) curve"),
        output: rows(b.output, ["vce", "ic", "ib"], problems, "output curves"), ft: pos(b.ft), ftIc: pos(b.ft_ic), cob: pos(b.cob), cobV: pos(b.cob_v), cib: pos(b.cib), cibV: pos(b.cib_v) };
      // a normalized hFE curve, scaled to the table's typical value (or to the middle of its spread, by ratio)
      const norm = rows(b.hfe_norm, ["ic", "k"], problems, "normalized hFE curve").sort((p, q) => p.ic - q.ic);
      if (!r.bjt.hfe.length && norm.length >= 2) {
        const at = pos(b.hfe_ic), typ = pos(b.hfe_typ), lo = pos(b.hfe_min), hi = pos(b.hfe_max), h = typ || (lo && hi ? Math.sqrt(lo * hi) : lo ? lo * 1.5 : undefined);
        if (at && h) {
          const L = Math.log, k = norm.length, i = norm.findIndex(p => p.ic >= at), a = norm[Math.max(Math.min(i < 0 ? k - 1 : i, k - 1) - 1, 0)], c = norm[Math.min(Math.max(i < 0 ? k - 1 : i, 1), k - 1)];
          const kAt = a.k + (c.k - a.k) * (L(at) - L(a.ic)) / (L(c.ic) - L(a.ic) || 1), vce = pos(b.hfe_vce) || 5;
          r.bjt.hfe = norm.map(p => ({ ic: p.ic, vce, hfe: p.k / kAt * h }));
          r.bjt.scaled = `hFE is the datasheet's normalized curve scaled to ${typ ? "its typical" : lo && hi ? `the middle of its spread (${lo}…${hi}), ${Math.round(h)},` : `1.5 × its minimum, ${Math.round(h)},`} at ${+(at * 1000).toPrecision(3)} mA`;
        }
      }
      if (!r.bjt.ft && pos(b.ft_min)) { r.bjt.ft = pos(b.ft_min); r.bjt.ftMin = true; }
      if (!r.bjt.hfe.length) throw new Error("no hFE was read from the datasheet: without the current gain there is nothing to fit");
    } else if (kind === "diode" || kind === "zener") {
      const d = j.diode || {};
      r.diode = { forward: rows(d.forward, ["vf", "if"], problems, "forward curve"), ir: pos(d.ir), irV: pos(d.ir_v), cj: pos(d.cj), cjV: pos(d.cj_v), trr: pos(d.trr), vz: pos(d.vz), iz: pos(d.iz), zz: pos(d.zz) };
      if (kind === "zener" && !r.diode.vz) throw new Error("no zener voltage was read from the datasheet");
      if (kind === "diode" && !r.diode.forward.length) throw new Error("no forward voltage was read from the datasheet");
    } else {
      const f = j.fet || {};
      r.fet = { transfer: rows(f.transfer, ["vgs", "id", "vds"], problems, "transfer curve"), output: rows(f.output, ["vds", "id", "vgs"], problems, "output curves"),
        vth: pos(f.vth), vthId: pos(f.vth_id), rdson: pos(f.rdson), rdsonVgs: pos(f.rdson_vgs), rdsonId: pos(f.rdson_id), idss: pos(f.idss), vgsoff: pos(f.vgsoff), gfs: pos(f.gfs), gfsId: pos(f.gfs_id),
        ciss: pos(f.ciss), coss: pos(f.coss), crss: pos(f.crss), capVds: pos(f.cap_vds), vsd: pos(f.vsd), vsdIs: pos(f.vsd_is) };
      const jf = kind === "njf" || kind === "pjf", F = r.fet, lim = [];
      // limits only: the usual typical part (RDS(on) about 0.8 of its maximum, a range's geometric middle)
      const mid = (k, a, b) => { if (F[k]) return; const lo = pos(f[a]), hi = pos(f[b]); if (lo && hi) { F[k] = Math.sqrt(lo * hi); lim.push(`${k === "vth" ? "Vth" : k === "idss" ? "IDSS" : "VGS(off)"} is the middle of the datasheet's range (${+lo.toPrecision(3)}…${+hi.toPrecision(3)})`); } };
      mid("vth", "vth_min", "vth_max"); mid("idss", "idss_min", "idss_max"); mid("vgsoff", "vgsoff_min", "vgsoff_max");
      if (!F.rdson && pos(f.rdson_max)) { F.rdson = 0.8 * pos(f.rdson_max); lim.push(`RDS(on) is taken as 0.8 of its ${+pos(f.rdson_max).toPrecision(3)} Ω maximum`); }
      F.limits = lim;
      if (jf && !F.transfer.length && !(F.idss && (F.vgsoff || F.gfs))) throw new Error("neither the transfer curve nor IDSS with VGS(off) or gfs was read: there is nothing to fit");
      if (!jf && F.transfer.length + (F.vth ? 1 : 0) < 2) throw new Error("the MOSFET's transfer curve was not read: without it there is nothing to fit");
    }
    return r;
  }

  // ---------------------------------------------------------------------------
  // Nelder–Mead
  // ---------------------------------------------------------------------------
  function nelder(f, x0, step, iters) {
    const n = x0.length;
    let s = [x0.slice()];
    for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; s.push(x); }
    let fs = s.map(f);
    for (let it = 0; it < (iters || 400 * n); it++) {
      const ord = fs.map((v, i) => i).sort((a, b) => fs[a] - fs[b]);
      s = ord.map(i => s[i]); fs = ord.map(i => fs[i]);
      if (Math.abs(fs[n] - fs[0]) <= 1e-12 * (1 + Math.abs(fs[0])) && it > 20) break;
      const c = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) c[k] += s[i][k] / n;
      const at = t => c.map((v, k) => v + t * (s[n][k] - v));
      const xr = at(-1), fr = f(xr);
      if (fr < fs[0]) { const xe = at(-2), fe = f(xe); if (fe < fr) { s[n] = xe; fs[n] = fe; } else { s[n] = xr; fs[n] = fr; } }
      else if (fr < fs[n - 1]) { s[n] = xr; fs[n] = fr; }
      else {
        const xc = fr < fs[n] ? at(-0.5) : at(0.5), fc = f(xc);
        if (fc < Math.min(fr, fs[n])) { s[n] = xc; fs[n] = fc; }
        else for (let i = 1; i <= n; i++) { s[i] = s[i].map((v, k) => s[0][k] + 0.5 * (v - s[0][k])); fs[i] = f(s[i]); }
      }
    }
    const b = fs.indexOf(Math.min(...fs));
    return { x: s[b], f: fs[b] };
  }
  // a few restarts from the best so far: Nelder–Mead stalls on long valleys
  function minimise(f, x0, step, rounds) {
    let best = nelder(f, x0, step);
    for (let k = 1; k < (rounds || 3); k++) { const r = nelder(f, best.x, step.map(v => v / 2)); if (r.f < best.f) best = r; }
    return best;
  }
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const g = v => +(+v).toPrecision(4);
  // a line through (x, y) by least squares: [slope, intercept]
  function line(pts) {
    const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0), sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0), d = n * sxx - sx * sx;
    if (n < 2 || !(Math.abs(d) > 0)) return null;
    const k = (n * sxy - sx * sy) / d; return [k, (sy - k * sx) / n];
  }
  const rmsPct = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + Math.pow(Math.log(v / b[i]), 2), 0) / Math.max(a.length, 1)) * 100;
  const rms = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + Math.pow(v - b[i], 2), 0) / Math.max(a.length, 1));

  // ---------------------------------------------------------------------------
  // The device as the simulator builds it from the model's text
  // ---------------------------------------------------------------------------
  function device(text, name) {
    const N = root.SpiceNet, f = N.flatten(text, name);
    let n = f.pins.length + 1;
    const els = N.build({ text, sub: name }, f.pins.map((_, i) => i + 1), () => n++, "q", []);
    const main = els.find(e => /^(BJT|MOS|D)$/.test(e.kind) && !/#(bd|body)$/.test(e.id)), r = s => (els.find(e => e.kind === "R" && e.id.endsWith("#" + s)) || {}).r || 0;
    const d = { kind: f.kind, els, main, rs: r("rs"), rd: r("rd"), rb: r("rb"), re: r("re"), rc: r("rc") };
    const bv = els.find(e => e.id.endsWith("#bv")), bd = els.find(e => e.id.endsWith("#bd"));
    if (bv && bd) d.bv = { v: bv.v, is: bd.is, n: bd.n || 1 };
    return d;
  }
  // the diode at a forward current i (its series RS): the voltage
  const dV = (is, n, rs, i) => n * VT * Math.log(i / is + 1) + i * rs;
  // the BJT at ic and vce (forward active, Semi.bjt's law with RE and RB): { ib, vbe at the pins }
  function bjtAt(m, rb, re, ic, vce) {
    let vbe = 0.65, If = 0;
    for (let k = 0; k < 3; k++) {
      const q1 = 1 / Math.max(1 - (vbe - vce) / (m.vaf || 1e9), 0.05), c = ic * q1;
      If = c + (m.ikf ? c * c / m.ikf : 0);
      vbe = (m.nf || 1) * VT * Math.log(If / m.is + 1);
    }
    const ib = If / m.bf + (m.ise ? m.ise * (Math.exp(Math.min(vbe / ((m.ne || 1.5) * VT), 80)) - 1) : 0);
    return { ib, hfe: ic / ib, vbe: vbe + ib * rb + (ic + ib) * re };
  }
  // the FET's channel (Semi.mos's law, the engine's soft knee s) at the inner vgs, vds, magnitudes
  function fetI(m, vgs, vds) {
    const s = m.s || 0.002, a = (vgs - Math.abs(m.vto)) / s, vov = s * (a > 40 ? a : Math.log1p(Math.exp(a)));
    return (vds < vov ? m.kp * (vov - vds / 2) * vds : m.kp / 2 * vov * vov) * (1 + (m.lambda || 0) * vds);
  }
  // the drain current at the pins' vgs, vds with RS and RD (magnitudes): by bisection
  function fetAt(m, rs, rd, vgs, vds) {
    let lo = 0, hi = fetI(m, vgs, vds);
    if (!(hi > 0)) return 0;
    for (let k = 0; k < 80; k++) { const i = (lo + hi) / 2; if (fetI(m, vgs - i * rs, Math.max(vds - i * (rs + rd), 0)) > i) lo = i; else hi = i; }
    return (lo + hi) / 2;
  }
  const fetModel = (vto, kp, lambda, ks) => ({ vto: Math.abs(vto), kp, lambda, s: ks || 0.002 });

  // ---------------------------------------------------------------------------
  // Diode and zener
  // ---------------------------------------------------------------------------
  function fitDiode(r) {
    const D = r.diode, pts = D.forward.slice().sort((a, b) => a.if - b.if), P = {}, notes = [];
    let is, n, rs = 0;
    if (pts.length >= 3) {
      const a = pts[0], b = pts[Math.min(2, pts.length - 1)];
      const n0 = clamp((b.vf - a.vf) / (VT * Math.log(b.if / a.if)), 0.9, 3), is0 = a.if / Math.exp(a.vf / (n0 * VT));
      const top = pts[pts.length - 1], rs0 = Math.max((top.vf - dV(is0, n0, 0, top.if)) / top.if, 1e-4);
      const cost = x => { const [lis, nn, lrs] = x; if (nn < 0.7 || nn > 4) return 1e9; return pts.reduce((s, p) => s + Math.pow((dV(Math.exp(lis), nn, Math.exp(lrs), p.if) - p.vf) / 0.01, 2), 0); };
      const best = minimise(cost, [Math.log(is0), n0, Math.log(rs0)], [1, 0.1, 1]);
      is = Math.exp(best.x[0]); n = best.x[1]; rs = Math.exp(best.x[2]);
      if (rs < 1e-4) rs = 0;
    } else {
      // one point: the usual slope of a silicon junction
      const p = pts[0] || { vf: 0.7, if: 0.01 }; n = r.kind === "zener" ? 1 : 1.5; is = p.if / Math.exp(p.vf / (n * VT));
      notes.push(pts.length ? "Only one forward point was read: N is taken as " + n + "." : "No forward point was read: a silicon junction's is taken.");
    }
    Object.assign(P, { IS: g(is), N: g(n) }); if (rs > 0) P.RS = g(rs);
    if (D.cj) { const v = D.cjV || 0; P.CJO = g(D.cj * Math.sqrt(1 + v / 0.7)); P.VJ = 0.7; P.M = 0.5; }
    if (D.trr) P.TT = g(D.trr / Math.log(2));
    if (r.kind === "zener") {
      const iz = D.iz || 5e-3, zz = D.zz || 0;
      P.BV = g(D.vz); P.IBV = g(iz);
      const nbv = zz > rs ? clamp((zz - rs) * iz / VT, 1, 200) : 1; if (nbv > 1) P.NBV = g(nbv);
      if (!D.zz) notes.push("No ZZ was read: the zener's knee is a silicon junction's.");
    } else if (r.ratings.vmax) P.BV = g(r.ratings.vmax * 1.1);
    return { type: "D", P, notes };
  }

  // ---------------------------------------------------------------------------
  // BJT
  // ---------------------------------------------------------------------------
  function fitBjt(r) {
    const B = r.bjt, notes = [], P = {};
    if (B.scaled) notes.push(B.scaled + ".");
    if (B.ftMin) notes.push("fT is the datasheet's minimum: the typical part is faster.");
    const hp = B.hfe.map(p => ({ ic: p.ic, vce: p.vce || 5, hfe: p.hfe })), vp = B.vbe.map(p => ({ ic: p.ic, vbe: p.vbe }));
    // the Early voltage from the output curves: the slope of IC against VCE in their flat part
    let vaf = 0;
    if (B.output.length >= 2) {
      const byIb = {}; B.output.forEach(p => { (byIb[p.ib] = byIb[p.ib] || []).push(p); });
      const vs = Object.values(byIb).map(ps => { const q = ps.filter(p => p.vce >= 1.5); const l = q.length >= 2 && line(q.map(p => [p.vce, p.ic])); return l && l[0] > 0 && l[1] > 0 ? l[1] / l[0] : 0; }).filter(v => v > 1 && v < 5000);
      if (vs.length) vaf = vs.reduce((a, b) => a + b, 0) / vs.length;
    }
    if (!vaf) { vaf = 100; notes.push("No output curves were read: VAF is taken as 100 V."); }
    const hmax = Math.max(...hp.map(p => p.hfe)), icTop = Math.max(...hp.map(p => p.ic));
    const peak = hp.find(p => p.hfe === hmax), hi = hp.filter(p => p.ic > peak.ic).sort((a, b) => a.ic - b.ic);
    const half = hi.find(p => p.hfe < hmax * 0.5), ikf0 = half ? half.ic : icTop * 2;
    const v0 = vp.slice().sort((a, b) => a.ic - b.ic)[0];
    const is0 = v0 ? v0.ic / Math.exp(v0.vbe / VT) : 1e-14;
    const low = hp.slice().sort((a, b) => a.ic - b.ic)[0], ise0 = low.hfe < hmax * 0.9 ? Math.max(low.ic / low.hfe - low.ic / (hmax * 1.2), 1e-18) / Math.exp(0.55 / (1.5 * VT)) : is0 * 1e-2;
    const mk = x => ({ is: Math.exp(x[0]), bf: Math.exp(x[1]), ikf: Math.exp(x[2]), ise: Math.exp(x[3]), ne: x[4], nf: 1, vaf });
    const cost = x => {
      if (x[4] < 1 || x[4] > 4 || x[5] > Math.log(100)) return 1e9;
      const m = mk(x), re = Math.exp(x[5]);
      let s = 0;
      hp.forEach(p => { const a = bjtAt(m, 0, re, p.ic, p.vce); s += Math.pow(Math.log(a.hfe / p.hfe) / 0.03, 2); });
      vp.forEach(p => { const a = bjtAt(m, 0, re, p.ic, 5); s += Math.pow((a.vbe - p.vbe) / 0.01, 2); });
      return s;
    };
    const x0 = [Math.log(is0), Math.log(hmax * 1.3), Math.log(ikf0), Math.log(ise0), 1.6, Math.log(vp.length ? 0.2 : 1e-3)];
    const best = minimise(cost, x0, [1, 0.3, 0.7, 2, 0.3, 1.5], 4), m = mk(best.x), re = vp.length ? Math.exp(best.x[5]) : 0;
    if (!vp.length) notes.push("No VBE curve was read: IS sets VBE by the usual 0.65 V at a milliamp and RE is left out.");
    Object.assign(P, { IS: g(m.is), BF: g(m.bf), NF: 1, VAF: g(vaf), IKF: g(m.ikf), ISE: g(m.ise), NE: g(m.ne), BR: 1 });
    if (re > 1e-3) P.RE = g(re);
    // RC from the saturation voltage at the highest current: what the junctions leave of it
    const sat = B.vcesat.slice().sort((a, b) => b.ic - a.ic)[0];
    if (sat) { const rc = (sat.v - 0.05) / sat.ic - re; if (rc > 1e-3) P.RC = g(Math.min(rc, 100)); }
    if (B.cob) { P.CJC = g(B.cob * Math.pow(1 + (B.cobV || 10) / 0.75, 0.33)); P.VJC = 0.75; P.MJC = 0.33; }
    if (B.cib) { P.CJE = g(B.cib * Math.pow(1 + (B.cibV || 0.5) / 0.75, 0.33)); P.VJE = 0.75; P.MJE = 0.33; }
    if (B.ft) {
      const ic = B.ftIc || peak.ic, gm = ic / VT, cpi = gm / (2 * Math.PI * B.ft) - (P.CJC ? B.cob : 0);
      let tf = (cpi - (P.CJE ? B.cib : 0)) / gm;
      if (!(tf > 0)) { tf = 0.5 / (2 * Math.PI * B.ft); notes.push("TF is taken from fT alone (the capacitances leave nothing of it)."); }
      P.TF = g(tf);
    }
    return { type: r.kind.toUpperCase(), P, notes };
  }

  // ---------------------------------------------------------------------------
  // MOSFET (LTspice's VDMOS) and JFET
  // ---------------------------------------------------------------------------
  function fitFet(r) {
    const F = r.fet, jf = r.kind === "njf" || r.kind === "pjf", notes = (F.limits || []).map(t => t + "."), P = {};
    const pts = F.transfer.map(p => ({ vgs: p.vgs, id: p.id, vds: p.vds || (jf ? 10 : 10) }));
    // JFET: the transfer points have VGS between VGS(off) and 0 (magnitudes: the gate's reverse voltage)
    let lambda = 0;
    if (F.output.length >= 2) {
      const by = {}; F.output.forEach(p => { (by[p.vgs] = by[p.vgs] || []).push(p); });
      const ls = Object.values(by).map(ps => { const top = Math.max(...ps.map(p => p.vds)), q = ps.filter(p => p.vds >= top * 0.4); const l = q.length >= 2 && line(q.map(p => [p.vds, p.id])); return l && l[0] > 0 && l[1] > 0 ? l[0] / l[1] : 0; }).filter(v => v > 0 && v < 0.5);
      if (ls.length) lambda = ls.reduce((a, b) => a + b, 0) / ls.length;
    }
    if (!lambda) { lambda = jf ? 0.005 : 0.01; notes.push(`No output curves were read: LAMBDA is taken as ${lambda}.`); }
    if (jf) {
      // magnitudes: id = β (|vto| − vgs)² for vgs from 0 to |vto|
      if (F.idss) pts.push({ vgs: 0, id: F.idss, vds: 10 });
      const jI = (vto, beta, p) => { const v = Math.max(vto - p.vgs, 0); return beta * v * v * (1 + lambda * p.vds); };
      let vto0 = F.vgsoff || (F.idss && F.gfs ? 2 * F.idss / F.gfs : Math.max(...pts.map(p => p.vgs)) * 1.3 || 2);
      let beta0 = (F.idss || Math.max(...pts.map(p => p.id))) / (vto0 * vto0);
      if (pts.length >= 2) {
        const cost = x => pts.reduce((s, p) => { const i = jI(Math.exp(x[0]), Math.exp(x[1]), p); return s + Math.pow(Math.log(Math.max(i, 1e-15) / p.id), 2); }, 0) + (F.vgsoff ? Math.pow(Math.log(Math.exp(x[0]) / F.vgsoff) / 0.1, 2) : 0);
        const best = minimise(cost, [Math.log(vto0), Math.log(beta0)], [0.3, 0.5]);
        vto0 = Math.exp(best.x[0]); beta0 = Math.exp(best.x[1]);
      }
      Object.assign(P, { VTO: g(-vto0), BETA: g(beta0), LAMBDA: g(lambda), IS: 1e-14 });
      const v = F.capVds || 10;
      if (F.crss) P.CGD = g(F.crss * Math.sqrt(1 + v / 1));
      if (F.ciss) P.CGS = g(Math.max(F.ciss - (F.crss || 0), F.ciss * 0.2));
      if (P.CGD || P.CGS) { P.PB = 1; P.M = 0.5; }
      return { type: r.kind.toUpperCase(), P, notes };
    }
    if (F.vth) pts.push({ vgs: F.vth, id: F.vthId || 250e-6, vds: F.vth });
    const vth = F.vth || Math.min(...pts.map(p => p.vgs));
    const hiP = pts.slice().sort((a, b) => b.id - a.id)[0];
    const kp0 = Math.max(2 * hiP.id / Math.pow(Math.max(hiP.vgs - vth * 0.9, 0.3), 2), 1e-4);
    // the channel's resistance at the RDS(on) conditions, RD what is left of it
    // KSUBTHRES: the soft knee below VTO that carries the current Vth is given at
    const ron = (m, rs) => { if (!F.rdson) return 0; const vg = F.rdsonVgs || 10, id = F.rdsonId || 1, vds = id * F.rdson; return vds / Math.max(fetAt(m, rs, 0, vg, vds), 1e-12); };
    const mk = x => fetModel(x[0], Math.exp(x[1]), lambda, Math.exp(x[3]));
    const cost = x => {
      const m = mk(x), rs = Math.exp(x[2]);
      if (x[0] < 0.05 || rs > 1e3 || m.s > 1 || m.s < 1e-3) return 1e9;
      let s = pts.reduce((a, p) => a + Math.pow(Math.log(Math.max(fetAt(m, rs, 0, p.vgs, p.vds), 1e-15) / p.id) / 0.1, 2), 0);
      // the channel and RS alone may not take more than RDS(on)
      const r0 = ron(m, rs); if (F.rdson && r0 > F.rdson) s += Math.pow(Math.log(r0 / F.rdson) / 0.02, 2);
      return s;
    };
    const best = minimise(cost, [vth * 1.1, Math.log(kp0), Math.log(F.rdson ? F.rdson * 0.3 : 0.05), Math.log(F.vth ? 0.1 : 0.002)], [0.3, 0.7, 1.5, 1], 4);
    const m = mk(best.x), vto = m.vto, kp = m.kp, rs = Math.exp(best.x[2]);
    // RD: what makes the drain current at the RDS(on) conditions the datasheet's
    let rd = 0;
    if (F.rdson) {
      const vg = F.rdsonVgs || 10, id = F.rdsonId || 1, v = id * F.rdson;
      let lo = 0, hi = F.rdson;
      if (fetAt(m, rs, 0, vg, v) > id) { for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (fetAt(m, rs, mid, vg, v) > id) lo = mid; else hi = mid; } rd = (lo + hi) / 2; }
    } else notes.push("No RDS(on) was read: RD is left out.");
    const pch = r.kind === "pmos";
    Object.assign(P, pch ? { PCHAN: true } : {}, { VTO: g(pch ? -vto : vto), KP: g(kp), LAMBDA: g(lambda) });
    if (rs > 1e-5) P.RS = g(rs);
    if (m.s > 0.0021) P.KSUBTHRES = g(m.s);
    if (rd > 1e-5) P.RD = g(rd);
    const v = F.capVds || 25;
    if (F.ciss) P.CGS = g(Math.max(F.ciss - (F.crss || 0), F.ciss * 0.3));
    if (F.crss) { P.CGDMIN = g(F.crss); P.CGDMAX = g(Math.max(F.crss * 2, Math.min(F.crss * 10, (F.ciss || F.crss * 10) * 0.5))); P.A = 1; notes.push("CGDMAX (the gate-drain capacitance near VDS 0) is an estimate from Crss and Ciss."); }
    if (F.coss) P.CJO = g(Math.max(F.coss - (F.crss || 0), F.coss * 0.2) * Math.sqrt(1 + v / 0.8));
    if (P.CJO) { P.VJ = 0.8; P.M = 0.5; }
    if (F.vsd) { const n = 1.3; P.IS = g((F.vsdIs || 1) / Math.exp(F.vsd / (n * VT))); P.N = n; }
    return { type: "VDMOS", P, notes };
  }

  // the model's text: a comment of where it came from, then the .MODEL line
  function modelText(r, fit, quality) {
    const ps = Object.entries(fit.P).map(([k, v]) => (v === true ? k : `${k}=${v}`));
    const lines = []; let cur = `.MODEL ${r.name} ${fit.type}(`;
    ps.forEach((p, i) => { const add = p + (i < ps.length - 1 ? " " : ")"); if (cur.length + add.length > 90) { lines.push(cur.trimEnd()); cur = "+ "; } cur += add; });
    lines.push(cur);
    const ra = r.ratings, rate = [ra.vmax && `${r.kind === "diode" ? "VRRM" : /mos|jf/.test(r.kind) ? "VDS" : "VCEO"} ${g(ra.vmax)} V`, ra.imax && `I ${g(ra.imax)} A`, ra.ptot && `Ptot ${g(ra.ptot)} W`].filter(Boolean).join(", ");
    return `* ${r.name}${r.maker ? " (" + r.maker + ")" : ""}: ${KINDS[r.kind]}${r.package ? ", " + r.package : ""}${rate ? "; " + rate : ""}\n* fitted by TubeCAD to the datasheet's typical values${quality ? " (" + quality + ")" : ""}\n` + lines.join("\n") + "\n";
  }

  // ---------------------------------------------------------------------------
  // The fitted model's curves against the datasheet's points, from the model as simulated
  // ---------------------------------------------------------------------------
  const logspace = (a, b, n) => Array.from({ length: n }, (_, k) => a * Math.pow(b / a, k / (n - 1)));
  function curves(r, text) {
    const d = device(text, r.name), out = [], err = [];
    if (r.kind === "diode" || r.kind === "zener") {
      const e = d.main, pts = r.diode.forward;
      if (pts.length) {
        const lo = Math.min(...pts.map(p => p.if)) / 2, hi = Math.max(...pts.map(p => p.if)) * 1.5;
        out.push({ title: "Forward: IF against VF", x: "VF (V)", y: "IF (A)", logy: true, pts: pts.map(p => [p.vf, p.if]), line: logspace(lo, hi, 60).map(i => [dV(e.is, e.n, d.rs, i), i]) });
        const pv = pts.map(p => dV(e.is, e.n, d.rs, p.if));
        err.push({ what: "VF", v: rms(pv, pts.map(p => p.vf)) * 1000, unit: "mV", good: 15, fair: 40 });
      }
      if (r.kind === "zener" && d.bv) {
        const z = r.diode, iz = z.iz || 5e-3, vAt = i => d.bv.v + d.bv.n * VT * Math.log(i / d.bv.is + 1) + i * d.rs;
        const pts2 = [[z.vz, iz]];
        out.push({ title: "Reverse: IZ against VZ", x: "VZ (V)", y: "IZ (A)", logy: true, pts: pts2, line: logspace(iz / 20, iz * 5, 40).map(i => [vAt(i), i]) });
        err.push({ what: "VZ", v: Math.abs(vAt(iz) - z.vz) * 1000, unit: "mV", good: 20, fair: 60 });
        if (z.zz) err.push({ what: "ZZ", v: Math.abs(Math.log((d.bv.n * VT / iz + d.rs) / z.zz)) * 100, unit: "%", good: 10, fair: 30 });
      }
    } else if (r.kind === "npn" || r.kind === "pnp") {
      const m = d.main.model, B = r.bjt, vce = B.hfe[0].vce || 5;
      const ics = [...B.hfe.map(p => p.ic), ...B.vbe.map(p => p.ic)], lo = Math.min(...ics) / 2, hi = Math.max(...ics) * 1.5;
      out.push({ title: `hFE against IC (VCE ${g(vce)} V)`, x: "IC (A)", y: "hFE", logx: true, pts: B.hfe.map(p => [p.ic, p.hfe]), line: logspace(lo, hi, 60).map(i => [i, bjtAt(m, d.rb, d.re, i, vce).hfe]) });
      err.push({ what: "hFE", v: rmsPct(B.hfe.map(p => bjtAt(m, d.rb, d.re, p.ic, p.vce || vce).hfe), B.hfe.map(p => p.hfe)), unit: "%", good: 8, fair: 20 });
      if (B.vbe.length) {
        out.push({ title: "VBE against IC", x: "IC (A)", y: "VBE (V)", logx: true, pts: B.vbe.map(p => [p.ic, p.vbe]), line: logspace(lo, hi, 60).map(i => [i, bjtAt(m, d.rb, d.re, i, 5).vbe]) });
        err.push({ what: "VBE", v: rms(B.vbe.map(p => bjtAt(m, d.rb, d.re, p.ic, 5).vbe), B.vbe.map(p => p.vbe)) * 1000, unit: "mV", good: 15, fair: 40 });
      }
    } else {
      const m = d.main.model, F = r.fet, jf = !!m.jf, pts = F.transfer.slice();
      if (jf && F.idss) pts.push({ vgs: 0, id: F.idss, vds: 10 });
      if (!jf && F.vth) pts.push({ vgs: F.vth, id: F.vthId || 250e-6, vds: F.vth });
      const mm = { vto: Math.abs(m.vto), kp: m.kp, lambda: m.lambda, s: m.s }, vds = (F.transfer[0] && F.transfer[0].vds) || 10;
      const at = p => (jf ? fetJ(mm, p.vgs, p.vds || vds) : fetAt(mm, d.rs, d.rd, p.vgs, p.vds || vds));
      const vgs = pts.map(p => p.vgs), lo = jf ? 0 : Math.min(...vgs) * 0.9, hi = jf ? Math.abs(m.vto) : Math.max(...vgs) * 1.1;
      out.push({ title: jf ? `ID against −VGS (VDS ${g(vds)} V)` : `ID against VGS (VDS ${g(vds)} V)`, x: jf ? "|VGS| (V)" : "VGS (V)", y: "ID (A)", logy: !jf, pts: pts.map(p => [p.vgs, p.id]),
        line: Array.from({ length: 61 }, (_, k) => lo + (hi - lo) * k / 60).map(v => [v, at({ vgs: v, vds })]).filter(p => p[1] > 0) });
      err.push({ what: "ID", v: rmsPct(pts.map(at), pts.map(p => p.id)), unit: "%", good: 10, fair: 25 });
      if (!jf && F.rdson) {
        const vg = F.rdsonVgs || 10, id = F.rdsonId || 1, v = id * F.rdson, i2 = fetAt(mm, d.rs, d.rd, vg, v);
        err.push({ what: "RDS(on)", v: Math.abs(Math.log(v / i2 / F.rdson)) * 100, unit: "%", good: 5, fair: 15 });
      }
    }
    return { curves: out, err };
  }
  // the JFET as spice-net builds it: β (vto − vgs)², the gate's reverse voltage vgs a magnitude
  function fetJ(m, vgs, vds) { const v = Math.max(m.vto - vgs, 0), kp = m.kp; return kp / 2 * v * v * (1 + (m.lambda || 0) * vds); }

  function quality(err) {
    const worst = err.reduce((w, e) => Math.max(w, e.v <= e.good ? 0 : e.v <= e.fair ? 1 : 2), 0);
    return ["good", "fair", "poor"][worst];
  }
  /** The fitted model: { kind, name, P (the parameters), text (.MODEL), curves, err, quality, notes } */
  function fit(r) {
    const f = r.kind === "diode" || r.kind === "zener" ? fitDiode(r) : r.kind === "npn" || r.kind === "pnp" ? fitBjt(r) : fitFet(r);
    let text = modelText(r, f, "");
    const c = curves(r, text), q = quality(c.err);
    text = modelText(r, f, c.err.map(e => `${e.what} ±${g(e.v)} ${e.unit}`).join(", "));
    return { kind: r.kind, name: r.name, P: f.P, type: f.type, text, curves: c.curves, err: c.err, quality: q, notes: f.notes };
  }
  /** The SPICE part's params for the sheet (spice-part.js's): the model, its symbol and pins, ratings */
  function partParams(r, ft) {
    const sym = r.kind, pins = PINS[sym], p = { name: r.name, text: ft.text, sub: r.name, sym, pinNames: pins.slice(), map: pins.slice(), partno: r.name };
    const ra = r.ratings;
    if (ra.ptot) p.ptot = ra.ptot;
    if (ra.tjmax) p.tjmax = ra.tjmax;
    if (ra.rthjc) p.rjc = ra.rthjc;
    if (ra.ptot || ra.tjmax || ra.rthjc) p.tsrc = "datasheet";
    return p;
  }
  root.SemiFit = { SYSTEM, KINDS, PINS, read, fit, curves, device, partParams, nelder, bjtAt, fetAt, quality };
})(typeof window !== "undefined" ? window : globalThis);
