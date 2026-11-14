/* =============================================================================
   TUBE AMP CIRCUIT ENGINE
   Small SPICE-like solver used by the CAD (in a Web Worker) and by tests (Node).

   - Modified Nodal Analysis; node 0 is ground.
   - Newton-Raphson for nonlinear devices (vacuum tubes, diodes) with damped
     steps, gmin stepping and source stepping as DC fallbacks.
   - Transient: Gear-2 (BDF2) companions for capacitors (backward Euler for a first step); inductors and
     coupled windings (transformers) carry their branch current as an unknown,
     so they are exact shorts at DC.
   - Periodic steady state by shooting: Newton–GMRES on the one-period map finds
     the state a period maps onto itself (falling back to repeating periods,
     with vector extrapolation); then the waveform is captured.
   - Linear solves: a sparse LU (Gilbert–Peierls, minimum-degree columns,
     partial pivoting) on the pattern stamped, its numeric part as WebAssembly
     (wasm/solver.ts) when loaded.

   Netlist: { nodeCount, elements: [{ id, kind, nodes: [...], ...params }] }
   kinds: R, C, L, XFMR, V, VSRC, I, D, VDIODE, BJT, MOS, TRIODE, PENTODE, TIMER555, E, G, GLOW,
   RELAY (a latched coil with its contacts), LDR (a light-dependent resistor lit by a current),
   B (a behavioural source: a current, or a voltage, that is any expression of node voltages and of the
   currents through other sources; what an imported SPICE model's B, E, G, F, H and S elements become)
   acSweep: the small-signal frequency response, linearized at an operating point.
   loopGain: the return ratio of a feedback loop broken at a part's terminal (Middlebrook's double injection).
   noiseSweep: every noise source carried to an output by the adjoint, and the gain from a generator.
   A tube element may carry gridShift (V): its plate and screen currents as if the grid were that
   much more positive (a real tube that draws more or less than the model), grid conduction
   still from 0 V; and iScale: all its currents times that factor (a weaker or stronger tube).
   ============================================================================= */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Tube models: Norman Koren's published equations, unmodified, so parameter
  // sets are interchangeable with Koren-style SPICE models. The (1 + sgn(E1))
  // factor is 2 whenever E1 > 0. Same functions drive the curve tracer plot.
  // ---------------------------------------------------------------------------
  function softplus(x) {
    if (x > 60) return x;
    if (x < -60) return 0;
    return Math.log1p(Math.exp(x));
  }

  // 0 at no screen voltage, rising smoothly (smoothstep s²(3 − 2s)) to 1 at SCREEN_FADE volts
  const SCREEN_FADE = 2;
  function screenFade(v) { if (v >= SCREEN_FADE) return 1; if (v <= 0) return 0; const s = v / SCREEN_FADE; return s * s * (3 - 2 * s); }
  const Koren = {
    triodeIa(vak, vgk, p) {
      if (vak <= 0) return 0;
      const e1 = (vak / p.kp) * softplus(p.kp * (1 / p.mu + vgk / Math.sqrt(p.kvb + vak * vak)));
      return e1 > 0 ? (2 * Math.pow(e1, p.x)) / p.kg : 0;
    },
    // Pentode / beam tetrode. Koren's space-charge term Is sets the current
    // available; how it divides between plate and screen depends on the plate
    // voltage. tanh(Va/vk) is the knee and (1 + Va/lam) the slope above it, so
    // knee sharpness and plate resistance are independent (Koren's single
    // atan(Va/kvb) ties them together and gives far too soft a knee). Whatever
    // the plate cannot take in the knee partly goes to the screen (ks), which
    // is why real screen current rises when the plate swings low.
    // Below SCREEN_FADE volts on the screen the currents fade in (screenFade): with the grid above
    // the cathode, Koren's terms do not go to zero as Vg2k → 0 (Is tends to 2·Vgk^x/kg), and Newton
    // stalls on that jump (a cold start with a grid shift crosses it). Above it, unchanged.
    pentodeIs(vgk, vg2k, p) {
      if (vg2k <= 0) return 0;
      const e1 = (vg2k / p.kp) * softplus(p.kp * (1 / p.mu + vgk / vg2k));
      return e1 > 0 ? (2 * Math.pow(e1, p.x)) / p.kg * screenFade(vg2k) : 0;
    },
    pentodeIa(vak, vgk, vg2k, p) {
      if (vak <= 0) return 0;
      return Koren.pentodeIs(vgk, vg2k, p) * Math.tanh(vak / p.vk) * (1 + vak / p.lam);
    },
    // Screen current: Koren's (Vg1 + Vg2/mu)^x / kg2 plus the knee share
    screenI(vgk, vg2k, p, vak) {
      if (vg2k <= 0) return 0;
      const e = vgk + vg2k / p.mu;
      const base = e > 0 ? Math.pow(e, p.x) / (p.kg2 || 1500) * screenFade(vg2k) : 0;
      if (vak === undefined || !p.ks) return base;
      return base + p.ks * Koren.pentodeIs(vgk, vg2k, p) * (1 - Math.tanh(Math.max(vak, 0) / p.vk));
    },
    // Grid current (the grid as the anode of a diode, the plate or screen taking its share)
    gridI(vgk, acc, p) { return gridIJ(vgk, acc, p)[0]; }
  };

  // Grid current. The space current toward a positive grid is Child's law on the tube's own
  // perveance, 2/kg · Vg^1.5 (all of it reaches the grid when the plate is at the cathode);
  // the electrode beyond (the plate of a triode, the screen of a pentode) takes the larger share as
  // its voltage rises: Ig = 2/kg · Vg^1.5 / (1 + D·√(Vacc / (mu·Vg))), the current division law of
  // Spangenberg and Porter (the plate's field at the grid is its voltage over mu). Vg starts softly
  // below 0 V: vs·ln(1 + e^((Vgk + vc)/vs)), the electrons' own energy and the contact potential.
  // vc, vs and D are fitted to the grid current starting points (Ig = +0.3 µA) that Philips
  // publishes for the ECC83 and ECC82 amplifier tables: 36 points, within 0.14 V rms.
  const GRID = { vc: 0.1, vs: 0.3, D: 40 };
  // [ig, dIg/dVgk, dIg/dVacc]
  function gridIJ(vgk, acc, p) {
    const u = (vgk + GRID.vc) / GRID.vs, g = GRID.vs * softplus(u);
    if (!(g > 1e-12)) return [0, 0, 0];
    const dg = sigmoid(u), k = 2 / p.kg, base = k * Math.pow(g, 1.5), dbase = 1.5 * k * Math.sqrt(g) * dg;
    // the accelerating voltage, smoothed at 0 (acc²/(acc + 1)) so the square root has a slope there
    const a = acc > 0 ? acc * acc / (acc + 1) : 0, da = acc > 0 ? acc * (acc + 2) / ((acc + 1) * (acc + 1)) : 0;
    const mg = (p.mu || 1) * g, s = Math.sqrt(a / mg), den = 1 + GRID.D * s;
    const ig = base / den;
    const dsG = a > 0 ? -s / (2 * g) : 0, dsA = a > 0 ? da / (2 * Math.sqrt(a * mg)) : 0;
    return [ig, (dbase * den - base * GRID.D * dsG * dg) / (den * den), -base * GRID.D * dsA / (den * den)];
  }
  // One entry for every tube model: Koren's equations, or an imported SPICE model
  // (spice-model.js) when the parameters carry one ({ spice: { text, sub, roles } }).
  const Tube = {
    /** [ia, ig] */
    triode(vak, vgk, p) {
      if (p.spice) return root.SpiceModel.tube(p.spice).triode(vak, vgk);
      return [Koren.triodeIa(vak, vgk, p), Koren.gridI(vgk, vak, p)];
    },
    /** [ia, ig, ig2] */
    pentode(vak, vgk, vg2k, p) {
      if (p.spice) return root.SpiceModel.tube(p.spice).pentode(vak, vgk, vg2k);
      return [Koren.pentodeIa(vak, vgk, vg2k, p), Koren.gridI(vgk, vg2k, p), Koren.screenI(vgk, vg2k, p, vak)];
    },
    ia(kind, p, vak, vgk, vg2k) { return kind === "pentode" ? Tube.pentode(vak, vgk, vg2k, p)[0] : Tube.triode(vak, vgk, p)[0]; }
  };

  // Rectifier tubes: perveance per anode (A/V^1.5).
  // Soviet kenotrons: Katsnelson & Larionov 1981, from the guaranteed minimum
  // anode current (P = Ia / Ua^1.5), i.e. a worst-case tube. Each reproduces the
  // book's minimum rectified current in its own test circuit (tests/engine.test.mjs).
  // Western tubes: typical drops from the maker's datasheet.
  const RECTIFIER_PERVEANCE = {
    "5Ts3S": 3.464e-4,  // 5Ц3С  p. 72: ≥ 225 mA at 75 V
    "5Ts4S": 8.485e-4,  // 5Ц4С  p. 73: ≥ 300 mA at 50 V
    "5Ts8S": 4.619e-4,  // 5Ц8С  p. 74: ≥ 300 mA at 75 V
    "5Ts9S": 2.771e-4,  // 5Ц9С  p. 75: ≥ 180 mA at 75 V
    "6Ts4P": 4.243e-4,  // 6Ц4П  p. 75: ≥ 150 mA at 50 V
    "6Ts5S": 1.154e-4,  // 6Ц5С  p. 76: no emission test; set so the test circuit gives the printed 70 mA
    "6Ts13P": 7.826e-4, // 6Ц13П p. 77: ≥ 70 mA at 20 V (single anode)
    "5U4G": 6.4e-4,     // RCA: ~50 V @ 225 mA
    "GZ34": 3.5e-3,     // Mullard 5AR4: ~17 V @ 250 mA
    "5Y3GT": 3.31e-4,   // ~45 V @ 100 mA (the highest drop of the octal family)
    "EZ81": 1.01e-3,    // ~28 V @ 150 mA
    "6X4": 6.78e-4      // ~22 V @ 70 mA
  };

  // ---------------------------------------------------------------------------
  // Cathode warm-up (the power-on transient with opts.warmup). A tube element may carry
  // heat: { tau (s), emit (A) }: its cathode's temperature rises from the room's to its working
  // temperature as 1 − e^(−t/tau), and the electrons it can give (its emission) follow
  // Richardson's law for an oxide cathode, T²·e^(−b/T), up to emit when hot (several times the
  // tube's rated cathode current). The tube's currents are what the Koren model asks for
  // (space-charge limited) until that nears the emission; then the emission caps them, smoothly.
  // ---------------------------------------------------------------------------
  const CATHODE = { room: 293, hot: 1050, b: 11600, cold: 0.9 };   // K; b = φ/k for about 1 eV (oxide cathode); cold: below 90 % of hot
  function cathodeWarm(t, tau) {
    const T = CATHODE.room + (CATHODE.hot - CATHODE.room) * (1 - Math.exp(-Math.max(t, 0) / Math.max(tau, 1e-6)));
    return { T, frac: Math.pow(T / CATHODE.hot, 2) * Math.exp(CATHODE.b * (1 / CATHODE.hot - 1 / T)) };
  }
  // the share of a demand d (A) that a cathode with emission e._emit gives: about 1 well below it,
  // about e._emit / d well above it
  function emitShare(e, d) {
    if (e._emit === undefined || !(d > 0)) return 1;
    const r = d / Math.max(e._emit, 1e-15);
    return r > 100 ? 1 / r : Math.pow(1 + Math.pow(r, 6), -1 / 6);
  }
  // a vacuum diode's (rectifier anode's) current
  function vdiodeI(e, v) { if (!(v > 0)) return 0; const i = e.perveance * Math.pow(v, 1.5); return i * emitShare(e, i); }

  // ---------------------------------------------------------------------------
  // A tube element's currents: [ia, ig] or [ia, ig, ig2], with its gridShift and iScale
  // (and its cathode's emission, while it warms up)
  function tubeCurrents(e, vak, vgk, vg2k) {
    const sh = e.gridShift || 0, sc = e.iScale || 1, pent = e.kind === "PENTODE";
    const r = pent ? Tube.pentode(vak, vgk + sh, vg2k, e.model) : Tube.triode(vak, vgk + sh, e.model);
    const ig = sh ? (pent ? Tube.pentode(vak, vgk, vg2k, e.model) : Tube.triode(vak, vgk, e.model))[1] : r[1];
    const out = pent ? [sc * r[0], sc * ig, sc * r[2]] : [sc * r[0], sc * ig];
    if (e._emit !== undefined) { const k = emitShare(e, out.reduce((a, i) => a + Math.max(i, 0), 0)); for (let j = 0; j < out.length; j++) out[j] *= k; }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The same currents with their derivatives, worked out (not by finite differences): one
  // evaluation per Newton iteration instead of one per terminal. Koren's equations only; an
  // imported SPICE tube or a warming cathode returns null and is differenced as before.
  // Returns { I: [ia, ig(, ig2)], J: rows of d/d[vak, vgk(, vg2k)] }.
  const sigmoid = x => (x > 60 ? 1 : x < -60 ? 0 : 1 / (1 + Math.exp(-x)));
  function screenFadeD(v) { if (v >= SCREEN_FADE || v <= 0) return 0; const s = v / SCREEN_FADE; return 6 * s * (1 - s) / SCREEN_FADE; }
  // Koren's space-charge term 2·E1^x/kg and its slope in E1
  const korenPow = (e1, p) => (e1 > 0 ? [2 * Math.pow(e1, p.x) / p.kg, 2 * p.x * Math.pow(e1, p.x - 1) / p.kg] : [0, 0]);
  function tubeJacobian(e, vak, vgk, vg2k) {
    const p = e.model;
    if (p.spice || e._emit !== undefined) return null;
    const sh = e.gridShift || 0, sc = e.iScale || 1, vg = vgk + sh, pent = e.kind === "PENTODE", [ig, dig, diA] = gridIJ(vgk, pent ? vg2k : vak, p);
    if (!pent) {
      let ia = 0, da = 0, dg = 0;
      if (vak > 0) {
        const R = Math.sqrt(p.kvb + vak * vak), u = p.kp * (1 / p.mu + vg / R), sp = softplus(u), sg = sigmoid(u);
        const e1 = (vak / p.kp) * sp, [f, df] = korenPow(e1, p);
        ia = f; da = df * (sp / p.kp - vak * vak * sg * vg / (R * R * R)); dg = df * vak * sg / R;
      }
      return { I: [sc * ia, sc * ig], J: [[sc * da, sc * dg], [sc * diA, sc * dig]] };
    }
    // pentode: Is (space charge), the plate's share, the screen's
    let is = 0, isG = 0, isS = 0;
    if (vg2k > 0) {
      const u = p.kp * (1 / p.mu + vg / vg2k), sp = softplus(u), sg = sigmoid(u), e1 = (vg2k / p.kp) * sp;
      if (e1 > 0) {
        const [f, df] = korenPow(e1, p), fd = screenFade(vg2k);
        is = f * fd; isG = df * sg * fd; isS = df * (sp / p.kp - sg * vg / vg2k) * fd + f * screenFadeD(vg2k);
      }
    }
    let ia = 0, iaA = 0, iaG = 0, iaS = 0;
    if (vak > 0) {
      const th = Math.tanh(vak / p.vk), sl = 1 + vak / p.lam, k = th * sl;
      ia = is * k; iaA = is * ((1 - th * th) / p.vk * sl + th / p.lam); iaG = isG * k; iaS = isS * k;
    }
    let i2 = 0, i2A = 0, i2G = 0, i2S = 0;
    if (vg2k > 0) {
      const ee = vg + vg2k / p.mu, kg2 = p.kg2 || 1500, fd = screenFade(vg2k);
      if (ee > 0) {
        const pw = Math.pow(ee, p.x) / kg2, dpw = p.x * Math.pow(ee, p.x - 1) / kg2;
        i2 = pw * fd; i2G = dpw * fd; i2S = dpw / p.mu * fd + pw * screenFadeD(vg2k);
      }
      if (p.ks) {
        const va = Math.max(vak, 0), th = Math.tanh(va / p.vk), k = p.ks * (1 - th);
        i2 += k * is; i2G += k * isG; i2S += k * isS;
        if (vak > 0) i2A = -p.ks * is * (1 - th * th) / p.vk;
      }
    }
    return { I: [sc * ia, sc * ig, sc * i2], J: [[sc * iaA, sc * iaG, sc * iaS], [0, sc * dig, sc * diA], [sc * i2A, sc * i2G, sc * i2S]] };
  }

  // ---------------------------------------------------------------------------
  // Semiconductors. Currents into each terminal for terminal voltages V.
  // BJT (nodes C, B, E): SPICE Gummel-Poon without the low-current
  // recombination terms: IS, BF, BR, NF, VAF (Early), IKF (high-injection knee).
  // The base and emitter resistances (RB, RE) are R elements to inner nodes (the CAD's
  // build); the element's ext lists the outer C, B, E nodes for its readings.
  // vt: thermal voltage kT/q at the junction temperature (the CAD scales IS, BF
  // and BR for temperature too). icbo: the collector-base leakage of germanium,
  // a current from collector to base that saturates once the junction is a few
  // vt reverse-biased; the transistor then amplifies it, as ICEO = (hFE+1)·ICBO.
  // MOSFET (nodes D, G, S): square law (SPICE level 1: VTO, KP, LAMBDA) with the
  // overdrive smoothed over 50 mV around threshold, so the current and its
  // derivative stay continuous; drain and source swap when Vds reverses.
  // pol: +1 NPN / N-channel, -1 PNP / P-channel. The body diode of a MOSFET
  // and capacitances are separate D and C elements (see cad-components.js).
  // ---------------------------------------------------------------------------
  const VT = 0.025852;
  const EXP80 = Math.exp(80);
  // ---------------------------------------------------------------------------
  // SPICE MOSFET levels 2 and 3: the drain current (vds ≥ 0, the source the lower end; vgs, vbs from it),
  // ported from ngspice's mos3load.c (moseq3) and mos2load.c (moseq2), without their charges.
  // P: { beta, leff, weff, vbi, phi, gamma, eta, theta, vmax, us, kappa, alpha, xd, xj, ld, nfs, cox, narrow, vt, ... }
  // ---------------------------------------------------------------------------
  const Q_E = 1.6021766208e-19;
  // the threshold (von) and saturation voltage the last call worked out, for Meyer's gate capacitances
  const MOS_OUT = { von: 0, vdsat: 0 };
  // level 1, the square law with the body effect (mos1load.c)
  function mos1Id(vds, vgs, vbs, P) {
    const sarg = vbs <= 0 ? Math.sqrt(P.phi - vbs) : Math.max(0, Math.sqrt(P.phi) - vbs / (2 * Math.sqrt(P.phi)));
    // (P.s: the turn-on rounded over a few millivolts, as the 3-pin FET's, so Newton's method sees a
    // slope below the threshold: a switch in a maker's model, off in the operating point, else stalls it)
    const von = P.vbi + P.gamma * sarg, vgst = P.s ? P.s * softplus((vgs - von) / P.s) : vgs - von;
    MOS_OUT.von = von; MOS_OUT.vdsat = Math.max(vgst, 0);
    if (vgst <= 0) return 0;
    const betap = P.beta * (1 + P.lambda * vds);
    return vgst <= vds ? 0.5 * betap * vgst * vgst : betap * vds * (vgst - 0.5 * vds);
  }
  function mos3Id(vds, vgs, vbs, P) {
    const L = P.leff, eta = P.eta * 8.15e-22 / (P.cox * L * L * L);
    let phibs, sqphbs;
    if (vbs <= 0) { phibs = P.phi - vbs; sqphbs = Math.sqrt(phibs); }
    else { const sq = Math.sqrt(P.phi); sqphbs = sq / (1 + vbs / (P.phi + P.phi)); phibs = sqphbs * sqphbs; }
    let fshort = 1;
    if (P.xj !== 0 && P.xd !== 0) {
      const wps = P.xd * sqphbs, wponxj = wps / P.xj, xjonxl = P.xj / L, djonxj = P.ld / P.xj;
      const wconxj = 0.0631353 + 0.8013292 * wponxj - 0.01110777 * wponxj * wponxj;
      const arga = wconxj + djonxj, argc = wponxj / (1 + wponxj), argb = Math.sqrt(1 - argc * argc);
      fshort = 1 - xjonxl * (arga * argb - djonxj);
    }
    const gammas = P.gamma * fshort, fbodys = 0.5 * gammas / (sqphbs + sqphbs), fbody = fbodys + P.narrow / P.weff;
    const qbonco = gammas * sqphbs + P.narrow * phibs / P.weff;
    const vth = P.vbi - eta * vds + qbonco;
    let von = vth, xn = 1;
    if (P.nfs !== 0) {
      const csonco = Q_E * P.nfs * 1e4 / P.cox;
      xn = 1 + csonco + qbonco / (phibs + phibs); von = vth + P.vt * xn;
    }
    MOS_OUT.von = von; MOS_OUT.vdsat = 0;
    if (P.nfs === 0 && vgs <= von) return 0;
    const vgsx = Math.max(vgs, von);
    const fgate = 1 / (1 + P.theta * (vgsx - vth)), us = P.us * 1e-4 * fgate;
    let vdsat = (vgsx - vth) / (1 + fbody), onvdsc = 0;
    if (P.vmax > 0) {
      const vdsc = L * P.vmax / us; onvdsc = 1 / vdsc;
      const arga = (vgsx - vth) / (1 + fbody), argb = Math.sqrt(arga * arga + vdsc * vdsc);
      vdsat = arga + vdsc - argb;
    }
    MOS_OUT.vdsat = vdsat;
    const vdsx = Math.min(vds, vdsat);
    if (vdsx === 0) return 0;
    const cdo = vgsx - vth - 0.5 * (1 + fbody) * vdsx;
    let cdrain = P.beta * fgate * cdo * vdsx, fdrain = 0;
    if (P.vmax > 0) { fdrain = 1 / (1 + vdsx * onvdsc); cdrain *= fdrain; }
    // channel length modulation
    let delxl = null;
    if (vds <= vdsat) {
      if (P.vmax > 0 || P.alpha === 0) delxl = null;
      else { const r = vds / vdsat; delxl = Math.sqrt(P.kappa * P.alpha * vdsat / 8) * r * r * r * r; }
    } else if (P.vmax <= 0) {
      delxl = Math.sqrt(P.kappa * P.alpha * (vds - vdsat + vdsat / 8));
    } else if (P.alpha !== 0) {
      const cdsat = cdrain, gdsat = Math.max(1e-12, cdsat * (1 - fdrain) * onvdsc);
      const emax = P.kappa * cdsat / L / gdsat, arga = 0.5 * emax * P.alpha, argc = P.kappa * P.alpha;
      delxl = Math.sqrt(arga * arga + argc * (vds - vdsat)) - arga;
    }
    if (delxl !== null) {
      if (delxl > 0.5 * L) delxl = L - L * L / (4 * delxl);
      cdrain /= 1 - delxl / L;
    }
    if (vgs < von) cdrain *= Math.exp((vgs - von) / (xn * P.vt));
    return cdrain;
  }

  const EPSSIL = 11.7 * 8.854214871e-12;
  const MOS2_SIG1 = [1, -1, 1, -1], MOS2_SIG2 = [1, 1, -1, -1];
  function mos2Id(vds, vgs, vbs, P) {
    const L = P.leff, phi = P.phi, phiMinVbs = phi - vbs;
    const sphi = Math.sqrt(phi), sphi3 = phi * sphi;
    let sarg1, dsrgdb, barg;
    if (vbs <= 0) { sarg1 = Math.sqrt(phiMinVbs); dsrgdb = -0.5 / sarg1; }
    else { sarg1 = sphi / (1 + 0.5 * vbs / phi); dsrgdb = -0.5 * sarg1 * sarg1 / sphi3; }
    let dbrgdb;
    if (vbs - vds <= 0) { barg = Math.sqrt(phiMinVbs + vds); dbrgdb = -0.5 / barg; }
    else { barg = sphi / (1 + 0.5 * (vbs - vds) / phi); dbrgdb = -0.5 * barg * barg / sphi3; }
    const factor = P.factor, eta = 1 + factor;
    const vbin = P.vbi + factor * phiMinVbs;
    let gamasd = P.gamma, dgddvb = 0;
    if ((P.gamma > 0 || P.nsub > 0) && P.xj > 0) {
      const xwd = P.xd * barg, xws = P.xd * sarg1, t = 2 / P.xj;
      const argxs = 1 + xws * t, argxd = 1 + xwd * t, args = Math.sqrt(argxs), argd = Math.sqrt(argxd);
      const t2 = 0.5 * P.xj / L;
      gamasd = P.gamma * (1 - t2 * (args - 1) - t2 * (argd - 1));
      const dbargs = 0.5 / L * P.xd * dsrgdb / args, dbargd = 0.5 / L * P.xd * dbrgdb / argd;
      dgddvb = -P.gamma * (dbargs + dbargd);
    }
    let von = vbin + gamasd * sarg1, xn = 1, argg = 0;
    const nfs = P.nfs !== 0;
    if (nfs) {
      xn = 1 + Q_E * P.nfs * 1e4 / P.cox - (gamasd * dsrgdb + dgddvb * sarg1) + factor;
      von += P.vt * xn; argg = 1 / (P.vt * xn);
    }
    MOS_OUT.von = von; MOS_OUT.vdsat = 0;
    if (!nfs && vgs <= vbin) return 0;
    const vgst = vgs - von;
    const sarg3 = sarg1 * sarg1 * sarg1;
    let body = barg * barg * barg - sarg3;
    // mobility falling with the gate field (UCRIT, UEXP)
    let ufact = 1;
    const ucr = P.ucrit * 100 * EPSSIL / P.cox;
    if (vgst > ucr) ufact = Math.exp(P.uexp * Math.log(ucr / vgst));
    const ueff = P.us * 1e-4 * ufact;
    // saturation voltage, Grove-Frohman
    const vgsx = nfs ? Math.max(vgs, von) : vgs;
    let gammad = gamasd / eta, vdsat;
    if (gammad > 0) {
      const g2 = gammad * gammad, argv = (vgsx - vbin) / eta + phiMinVbs;
      vdsat = argv <= 0 ? 0 : Math.max(0, (vgsx - vbin) / eta + g2 * (1 - Math.sqrt(1 + 4 * argv / g2)) / 2);
    } else vdsat = Math.max(0, (vgsx - vbin) / eta);
    if (P.vmax > 0) {
      // Baum's scattering-limited velocity: the smallest valid root of a quartic
      const v1 = (vgsx - vbin) / eta + phiMinVbs, v2 = phiMinVbs, xv = P.vmax * L / ueff;
      const a1 = gammad / 0.75, b1 = -2 * (v1 + xv), c1 = -2 * gammad * xv;
      const d1 = 2 * v1 * (v2 + xv) - v2 * v2 - 4 / 3 * gammad * sarg3;
      const a = -b1, b = a1 * c1 - 4 * d1, c = -d1 * (a1 * a1 - 4 * b1) - c1 * c1;
      const r = -a * a / 3 + b, s = 2 * a * a * a / 27 - a * b / 3 + c;
      const r3 = r * r * r, s2 = s * s, p = s2 / 4 + r3 / 27, p0 = Math.abs(p), p2 = Math.sqrt(p0);
      let y3;
      if (p < 0) {
        const ro = Math.exp(Math.log(Math.sqrt(s2 / 4 + p0)) / 3), fi = Math.atan(-2 * p2 / s);
        y3 = 2 * ro * Math.cos(fi / 3) - a / 3;
      } else {
        const p3 = Math.exp(Math.log(Math.abs(-s / 2 + p2)) / 3), p4 = Math.exp(Math.log(Math.abs(-s / 2 - p2)) / 3);
        y3 = p3 + p4 - a / 3;
      }
      const a3 = Math.sqrt(a1 * a1 / 4 - b1 + y3), b3 = Math.sqrt(y3 * y3 / 4 - d1);
      const x4 = [];
      for (let i = 0; i < 4; i++) {
        const a4 = a1 / 2 + MOS2_SIG1[i] * a3, b4 = y3 / 2 + MOS2_SIG2[i] * b3, d4 = a4 * a4 / 4 - b4;
        if (d4 < 0) continue;
        const t = Math.sqrt(d4); x4.push(-a4 / 2 + t, -a4 / 2 - t);
      }
      let xvalid = null;
      for (const x of x4) {
        if (!(x > 0)) continue;
        const poly = x * x * x * x + a1 * x * x * x + b1 * x * x + c1 * x + d1;
        if (Math.abs(poly) > 1e-6) continue;
        if (xvalid === null || x < xvalid) xvalid = x;
      }
      if (xvalid !== null) vdsat = xvalid * xvalid - phiMinVbs;
    }
    MOS_OUT.vdsat = vdsat;
    // channel length modulation: LAMBDA, or from the depletion width when NSUB is given
    let xlamda = P.lambda, bsarg = 0, bodys = 0;
    if (vds !== 0) {
      bsarg = vbs - vdsat <= 0 ? Math.sqrt(vdsat + phiMinVbs) : sphi / (1 + 0.5 * (vbs - vdsat) / phi);
      bodys = bsarg * bsarg * bsarg - sarg3;
      if (P.nsub !== 0 && !(xlamda > 0)) {
        if (P.vmax <= 0) {
          const argv = (vds - vdsat) / 4, sargv = Math.sqrt(1 + argv * argv);
          xlamda = P.xd / (L * vds) * Math.sqrt(argv + sargv);
        } else {
          const xdv = P.xd / Math.sqrt(P.neff), xlv = P.vmax * xdv / (2 * ueff);
          const xls = Math.sqrt(xlv * xlv + Math.max(vds - vdsat, 0));
          xlamda = xdv / (L * vds) * (xls - xlv);
        }
      }
    }
    // channel shortening stops at punch-through
    let xwb = P.xd * Math.sqrt(P.pb);
    const xld = L - xwb;
    let clfact = 1 - xlamda * vds;
    const deltal = xlamda * vds * L;
    if (P.nsub === 0) xwb = 0.25e-6;
    if (L * clfact < xwb) clfact = xwb / (1 + (deltal - xld) / xwb) / L;
    const beta1 = P.beta * ufact / clfact;
    gammad = gamasd;
    if (vds <= 1e-10) return 0;
    if (nfs ? vgs <= von : vgs <= vbin) {
      if (!nfs) return 0;
      // weak inversion
      if (vdsat <= 0) return 0;
      const vdson = Math.min(vdsat, vds), bd = vds > vdsat ? bodys : body;
      const cdson = beta1 * ((von - vbin - eta * vdson * 0.5) * vdson - gammad * bd / 1.5);
      return cdson * Math.exp(argg * (vgs - von));
    }
    if (vds <= vdsat) return beta1 * ((vgs - vbin - eta * vds / 2) * vds - gammad * body / 1.5);
    return beta1 * ((vgs - vbin - eta * vdsat / 2) * vdsat - gammad * bodys / 1.5);
  }

  const Semi = {
    // the forward transport current If / qb (what a transit time's charge is counted from), signed as the base's
    bjtForward(V, m) {
      const p = m.pol, vbe = p * (V[1] - V[2]), vbc = p * (V[1] - V[0]), vt = m.vt || VT;
      const If = m.is * (Math.exp(Math.min(vbe / ((m.nf || 1) * vt), 80)) - 1);
      const q1 = 1 / Math.max(1 - vbc / (m.vaf || 1e9) - (m.var ? vbe / m.var : 0), 0.05), q2 = m.ikf ? Math.max(If, 0) / m.ikf : 0;
      return p * If / (q1 * (1 + Math.sqrt(1 + 4 * q2)) / 2);
    },
    // the charges a transit time stores, signed as the base's: [TF · If / qb, TR · Ir]
    bjtCharges(V, m, tf, tr) {
      const p = m.pol, vbc = p * (V[1] - V[0]), vt = m.vt || VT;
      return [tf ? tf * Semi.bjtForward(V, m) : 0, tr ? p * tr * m.is * (Math.exp(Math.min(vbc / ((m.nr || 1) * vt), 80)) - 1) : 0];
    },
    bjt(V, m) {
      const p = m.pol, vbe = p * (V[1] - V[2]), vbc = p * (V[1] - V[0]), vt = m.vt || VT;
      const If = m.is * (Math.exp(Math.min(vbe / ((m.nf || 1) * vt), 80)) - 1), Ir = m.is * (Math.exp(Math.min(vbc / ((m.nr || 1) * vt), 80)) - 1);
      const q1 = 1 / Math.max(1 - vbc / (m.vaf || 1e9) - (m.var ? vbe / m.var : 0), 0.05), q2 = m.ikf ? Math.max(If, 0) / m.ikf : 0;
      const qb = q1 * (1 + Math.sqrt(1 + 4 * q2)) / 2;
      // leakage: icbo·(1 − e^(vbc/vt)) reverse-biased, carried on linearly (same slope) when forward
      const xl = vbc / vt, lk = m.icbo ? m.icbo * (xl <= 0 ? 1 - Math.exp(xl) : -xl) : 0;
      let ib = If / m.bf + Ir / (m.br || 1) - lk, ic = (If - Ir) / qb - Ir / (m.br || 1) + lk;
      // an imported SPICE model's leakage (recombination) currents: the fall of the gain at low currents
      if (m.ise) ib += m.ise * (Math.exp(Math.min(vbe / ((m.ne || 1.5) * vt), 80)) - 1);
      if (m.isc) { const l = m.isc * (Math.exp(Math.min(vbc / ((m.nc || 2) * vt), 80)) - 1); ib += l; ic -= l; }
      return [p * ic, p * ib, -p * (ic + ib)];
    },
    // the same currents with their Jacobian (rows C, B, E; columns VC, VB, VE), worked out
    bjtJ(V, m) {
      const p = m.pol, vbe = p * (V[1] - V[2]), vbc = p * (V[1] - V[0]), vt = m.vt || VT;
      // e^a held flat past a = 80, as bjt() has it (its slope there 0)
      const xp = a => (a < 80 ? Math.exp(a) : EXP80), dxp = a => (a < 80 ? Math.exp(a) : 0);
      const jexp = (v, n) => { const a = v / (n * vt); return [m.is * (xp(a) - 1), m.is * dxp(a) / (n * vt)]; };
      const [If, dIf] = jexp(vbe, m.nf || 1), [Ir, dIr] = jexp(vbc, m.nr || 1), br = m.br || 1;
      const den = 1 - vbc / (m.vaf || 1e9) - (m.var ? vbe / m.var : 0);
      let q1 = 20, dq1e = 0, dq1c = 0;
      if (den > 0.05) { q1 = 1 / den; dq1c = q1 * q1 / (m.vaf || 1e9); dq1e = m.var ? q1 * q1 / m.var : 0; }
      const q2 = m.ikf ? Math.max(If, 0) / m.ikf : 0, dq2e = m.ikf && If > 0 ? dIf / m.ikf : 0, S = Math.sqrt(1 + 4 * q2);
      const qb = q1 * (1 + S) / 2, dqbe = dq1e * (1 + S) / 2 + q1 * dq2e / S, dqbc = dq1c * (1 + S) / 2;
      const xl = vbc / vt;
      let lk = 0, dlk = 0;
      if (m.icbo) { if (xl <= 0) { const ex = Math.exp(xl); lk = m.icbo * (1 - ex); dlk = -m.icbo * ex / vt; } else { lk = -m.icbo * xl; dlk = -m.icbo / vt; } }
      const it = If - Ir;
      let ib = If / m.bf + Ir / br - lk, ic = it / qb - Ir / br + lk;
      let ibE = dIf / m.bf, ibC = dIr / br - dlk;
      let icE = dIf / qb - it / (qb * qb) * dqbe, icC = -dIr / qb - it / (qb * qb) * dqbc - dIr / br + dlk;
      if (m.ise) { const n = (m.ne || 1.5) * vt, a = vbe / n; ib += m.ise * (xp(a) - 1); ibE += m.ise * dxp(a) / n; }
      if (m.isc) {
        const n = (m.nc || 2) * vt, a = vbc / n; let l = 0, dl = 0;
        l = m.isc * (xp(a) - 1); dl = m.isc * dxp(a) / n;
        ib += l; ic -= l; ibC += dl; icC -= dl;
      }
      // vbe = p(VB − VE), vbc = p(VB − VC); the currents p·ic, p·ib, −p·(ic + ib)
      const rc = [-icC, icE + icC, -icE], rb = [-ibC, ibE + ibC, -ibE];
      return { I: [p * ic, p * ib, -p * (ic + ib)], J: [rc, rb, rc.map((v, k) => -(v + rb[k]))] };
    },
    // a MOSFET's currents and Jacobian (rows D, G, S; columns VD, VG, VS)
    mosJ(V, m) {
      const p = m.pol;
      let vds = p * (V[0] - V[2]), vgs = p * (V[1] - V[2]), sw = 1;
      if (vds < 0) { vds = -vds; vgs = p * (V[1] - V[0]); sw = -1; }
      const s = m.s || 0.05, a = (vgs - m.vto * p) / s, vov = s * softplus(a), dvov = sigmoid(a), lam = m.lambda || 0, L = 1 + lam * vds;
      let i0, dov, dds;
      if (vds < vov) { i0 = m.kp * (vov - vds / 2) * vds; dov = m.kp * vds; dds = m.kp * (vov - vds); } else { i0 = m.kp / 2 * vov * vov; dov = m.kp * vov; dds = 0; }
      const id = i0 * L, gm = dov * dvov * L, gds = dds * L + i0 * lam;
      const rd = sw > 0 ? [gds, gm, -(gds + gm)] : [gds + gm, -gm, -gds];
      return { I: [p * sw * id, 0, -p * sw * id], J: [rd, [0, 0, 0], rd.map(v => -v)] };
    },
    // A MOSFET with its bulk (nodes D, G, S, B) by SPICE's level 2 or 3 equations, as ngspice's mos2load.c
    // and mos3load.c have them: the body effect on the threshold, mobility falling with the gate field
    // (level 3: THETA; level 2: UCRIT, UEXP), velocity saturation (VMAX), drain-induced threshold shift
    // (level 3: ETA), short-channel and narrow-width terms (XJ, DELTA), weak inversion (NFS) and channel
    // length modulation (KAPPA, or LAMBDA). The channel current only: the bulk junctions are D elements.
    // m.p holds the setup spice-net worked out (mosSetup). Returns the currents into D, G, S, B.
    mosx(V, m) {
      const p = m.pol, P = m.p;
      let vds = p * (V[0] - V[2]), vgs = p * (V[1] - V[2]), vbs = p * (V[3] - V[2]), mode = 1;
      if (vds < 0) { mode = -1; vds = -vds; vgs = p * (V[1] - V[0]); vbs = p * (V[3] - V[0]); }
      const id = (m.level === 3 ? mos3Id : m.level === 2 ? mos2Id : mos1Id)(vds, vgs, vbs, P);
      const i = p * mode * id;
      return [i, 0, -i, 0];
    },
    // its gate capacitances by Meyer's model (ngspice's DEVqmeyer, whole values, not its halves): the
    // channel's share of the oxide capacitance P.cmey (Cox·W·Leff) to source, drain and bulk by the
    // region it works in. [Cgs, Cgd, Cgb], the overlap capacitances not included (C elements of their own)
    mosMeyer(V, m) {
      const p = m.pol, P = m.p, cox = P.cmey;
      if (!(cox > 0)) return [0, 0, 0];
      let vds = p * (V[0] - V[2]), vgs = p * (V[1] - V[2]), vbs = p * (V[3] - V[2]), sw = false;
      if (vds < 0) { sw = true; vds = -vds; vgs = p * (V[1] - V[0]); vbs = p * (V[3] - V[0]); }
      (m.level === 3 ? mos3Id : m.level === 2 ? mos2Id : mos1Id)(vds, vgs, vbs, P);
      const phi = P.phi, vgst = vgs - MOS_OUT.von, vdsat = Math.max(MOS_OUT.vdsat, 0.025);
      let cgs, cgd, cgb;
      if (vgst <= -phi) { cgb = cox / 2; cgs = 0; cgd = 0; }
      else if (vgst <= -phi / 2) { cgb = -vgst * cox / (2 * phi); cgs = 0; cgd = 0; }
      else if (vgst <= 0) {
        cgb = -vgst * cox / (2 * phi); cgs = vgst * cox / (1.5 * phi) + cox / 3; cgd = 0;
        if (vds < vdsat) { const dd = 2 * vdsat - vds, d1 = vdsat - vds, d2 = dd * dd; cgd = cgs * (1 - vdsat * vdsat / d2); cgs *= 1 - d1 * d1 / d2; }
      } else if (vdsat <= vds) { cgs = cox / 3; cgd = 0; cgb = 0; }
      else { const dd = 2 * vdsat - vds, d1 = vdsat - vds, d2 = dd * dd; cgd = cox * (1 - vdsat * vdsat / d2) / 3; cgs = cox * (1 - d1 * d1 / d2) / 3; cgb = 0; }
      return sw ? [2 * cgd, 2 * cgs, 2 * cgb] : [2 * cgs, 2 * cgd, 2 * cgb];
    },
    mos(V, m) {
      const p = m.pol;
      let vds = p * (V[0] - V[2]), vgs = p * (V[1] - V[2]), sw = 1;
      if (vds < 0) { vds = -vds; vgs = p * (V[1] - V[0]); sw = -1; }
      const s = m.s || 0.05, vov = s * softplus((vgs - m.vto * p) / s);
      const id = (vds < vov ? m.kp * (vov - vds / 2) * vds : m.kp / 2 * vov * vov) * (1 + (m.lambda || 0) * vds);
      return [p * sw * id, 0, -p * sw * id];
    },
    // Op-amp (nodes IN+, IN−, OUT, V+, V−, N1, N2): a two-stage macromodel. Stage one, a
    // transconductance gm1 whose current is limited to i1 (tanh), drives N1 (r1 to the supply
    // midpoint); stage two, gm2 limited to i2, inverts N1 onto N2 (r2). The Miller capacitor
    // between N1 and N2 is a C element (the CAD's build, or an LM301's own pins 1 and 8), so the
    // open-loop gain is gm1·r1·gm2·r2, the gain-bandwidth gm1 / (2π·Cc) and the slew rate i1 / Cc.
    // The output follows N2 through ro, no closer than dhi to V+ and dlo to V− (soft limits), its
    // current limited to isc sourcing and isk sinking. N1 and N2 are clamped just outside their
    // working range, so a saturated amplifier comes back at once. Every current comes from V+ or
    // goes to V−, with the quiescent current iq between them; the inputs take the bias current ib
    // (> 0 into the pins, NPN inputs; < 0 out of them, PNP) and have rin between them. Below about
    // 2 V of supply the amplifier is off. lin (the DC operating point): both stages without their
    // current limits and the output limits with a slight slope, so Newton's method sees the
    // feedback loop wherever an iterate lands. gain: stage two's share of the gain
    // (the DC operating point's gain stepping).
    opamp(V, m, lin, gain) {
      const I = [0, 0, 0, 0, 0, 0, 0], vp = V[3], vq = V[4], vm = (vp + vq) / 2, vd = V[0] - V[1], v1 = V[5], v2 = V[6];
      const on = 1 / (1 + Math.exp(-(vp - vq - 2) / 0.3)), w = 0.05, sp = x => w * softplus(x / w);
      // a current X out of the amplifier into node k: drawn from V+ while positive, returned to V− while negative
      // (smoothly, over a nanoampere, and exactly nothing at no current: an unwired amplifier must not charge its pins)
      const src = (k, X) => { const a = X / (1 + Math.exp(Math.max(-60, Math.min(60, -X * 1e9)))); I[k] -= X; I[3] += a; I[4] -= a - X; };
      // a resistor from node k to the midpoint, half its current to each rail
      const rmid = (k, vk, r) => { const X = (vk - vm) / r; I[k] += X; I[3] -= X / 2; I[4] -= X / 2; };
      // clamps of node k: above top it conducts to V+, below bot from V−
      const clamp = (k, vk, top, bot, gc) => { const a = gc * sp(vk - top), b = gc * sp(bot - vk); I[k] += a - b; I[3] -= a; I[4] += b; };
      const ir = vd / m.rin, ib = (m.ib || 0) * on;
      I[0] += ir + ib; I[1] += ib - ir; I[ib > 0 ? 4 : 3] -= 2 * ib;
      src(5, -(lin ? m.gm1 * vd : m.i1 * Math.tanh(m.gm1 * vd / m.i1)) * on);
      rmid(5, v1, m.r1);
      const gm2 = m.gm2 * (gain === undefined ? 1 : gain);
      src(6, -(lin ? gm2 * (v1 - vm) : m.i2 * Math.tanh(gm2 * (v1 - vm) / m.i2)) * on);
      rmid(6, v2, m.r2);
      const [hi, lo] = Semi.opampLimits(V, m);
      clamp(5, v1, vm + 0.5, vm - 0.5, 1e-3);
      clamp(6, v2, hi + 0.3, lo - 0.3, 1e-2);
      const ex = lin ? 0.999 : 1, vt = v2 - ex * Semi.opampClip(V, m), io = (vt - V[2]) / m.ro;
      src(2, (io > 0 ? m.isc * Math.tanh(io / m.isc) : m.isk * Math.tanh(io / m.isk)) * on);
      I[3] += m.iq * on; I[4] -= m.iq * on;
      return I;
    },
    // the output stage's limits [high, low], and how far N2 is beyond them (> 0 above, < 0 below)
    opampLimits: (V, m) => { const vm = (V[3] + V[4]) / 2; return [Math.max(V[3] - m.dhi, vm), Math.min(V[4] + m.dlo, vm)]; },
    opampClip(V, m) { const [hi, lo] = Semi.opampLimits(V, m), w = 0.05; return w * (softplus((V[6] - hi) / w) - softplus((lo - V[6]) / w)); },
    // Three-terminal series regulator (nodes IN, OUT, REF: the ADJ pin of an LM317, the GND pin
    // of a 7805). An error amplifier of transconductance g holds OUT at vref above REF; it can
    // only source (the pass transistor), its current limited to ilim (tanh), and the pass device
    // runs out of headroom below the dropout: the current fades as IN − OUT falls under vdo
    // (over vsat volts). pol −1 mirrors it (LM337, 79xx). adj: the bias current iq flows to OUT
    // (an LM317's minimum load) and iadj out of the ADJ pin; fixed: iq flows to GND, with the
    // internal divider rdiv from OUT to GND. Below about half a volt of input the chip is off.
    // line: the line regulation (V of vref per V of IN − OUT, from 3 V up): the ripple rejection.
    // gain: the share of g (the DC operating point's gain stepping); lin: without the current
    // limit, whose flat top gives Newton's method no slope far from the solution
    reg(V, m, gain, lin) {
      const p = m.pol, vio = p * (V[0] - V[1]), vo = p * (V[1] - V[2]), sp = (x, w) => w * softplus(x / w);
      const on = 1 / (1 + Math.exp(-((m.adj ? vio : p * (V[0] - V[2])) - 0.5) / 0.1));
      const ie = sp(m.g * (gain === undefined ? 1 : gain) * (m.vref + (m.line || 0) * (vio - 3) - vo), 1e-4), ictl = (lin ? ie : m.ilim * Math.tanh(ie / m.ilim)) * on;
      const ipass = ictl * Math.tanh(sp(vio - m.vdo, 0.05) / m.vsat), iq = m.iq * on;
      if (m.adj) { const ia = m.iadj * on; return [p * (ipass + iq + ia), -p * (ipass + iq), -p * ia]; }
      const idiv = vo / m.rdiv;
      return [p * (ipass + iq), -p * (ipass - idiv), -p * (iq + idiv)];
    },
    // Shunt reference, TL431 (nodes K, A, REF): the cathode sinks a current gm·(REF − A − vref),
    // smoothly from about zero, up to imax, while K − A has a volt or more of headroom; REF draws
    // its bias current through rref, and K–A leaks through roff when the reference is off.
    shunt(V, m, gain, lin) {
      const vka = V[0] - V[1], vr = V[2] - V[1], sp = (x, w) => w * softplus(x / w), ie = sp(m.gm * (gain === undefined ? 1 : gain) * (vr - m.vref), 2e-4);
      const ik = (lin ? ie : m.imax * Math.tanh(ie / m.imax)) * Math.tanh(sp(vka - 1, 0.05) / 0.5) + vka / m.roff, ir = vr / m.rref;
      return [ik, -(ik + ir), ir];
    }
  };
  // SPICE pnjlim: limits a junction voltage step so exp() cannot run away between iterations
  // (a junction with a saturation current so large that vcrit is negative, an op-amp macromodel's clamp: only forward voltages are limited)
  function pnjlim(vnew, vold, nVt, vcrit) {
    if (vold !== undefined && vnew > vcrit && vnew > 0 && Math.abs(vnew - vold) > 2 * nVt) {
      if (vold > 0) { const arg = 1 + (vnew - vold) / nVt; vnew = arg > 0 ? vold + nVt * Math.log(arg) : vcrit; }
      else vnew = nVt * Math.log(vnew / nVt);
    }
    return vnew;
  }

  // ---------------------------------------------------------------------------
  // NE555 timer (nodes GND, TRIG, OUT, RESET, CTRL, THR, DIS, VCC, and the divider's lower tap).
  // The CAD builds the 5k–5k–5k divider, the supply current and the reset pin's pull-up as R
  // elements; this element is the latch and the output and discharge transistors. The latch is an
  // extra unknown (1 set, 0 reset), held through each Newton solve, so the shooting and the capture
  // carry it as state; between steps it follows the comparators (timerNext), and a step in which it
  // flips is cut where the comparator crossed (timerStep), so the timing does not hang on the step.
  // From the TI NE555 data (VCC 5-15 V): output high, a Darlington from VCC that only sources,
  // VCC - 1.4 V less 3 Ω, running out near 250 mA (13.3 V at 100 mA, 12.8 V at 200 mA from 15 V); output low, a saturating transistor, 8 Ω at
  // small currents and running out near 120 mA (0.1 V at 10 mA, 0.4 V at 50 mA, 2 V at 100 mA);
  // discharge while the latch is reset, 12 Ω (180 mV at 15 mA), up to 100 mA; reset below 0.7 V.
  // ---------------------------------------------------------------------------
  const NE555 = { drop: 1.4, rh: 3, ih: 0.25, rl: 8, il: 0.12, rd: 12, id: 0.1, vreset: 0.7 };
  /** currents into the GND, OUT, DIS and VCC pins (voltages V in that order) with the latch at q */
  function timerCurrents(V, q) {
    const [g, o, d, vcc] = V, m = NE555, sat = (v, r, imax) => imax * Math.tanh(v / (r * imax));
    let io = 0, idis = 0, ivcc = 0;
    if (q) { const s = 0.005; io = -m.ih * Math.tanh(s * softplus((vcc - m.drop - o) / s) / (m.rh * m.ih)); ivcc = -io; }   // out of OUT, in at VCC
    else { io = sat(o - g, m.rl, m.il); idis = sat(d - g, m.rd, m.id); }
    return [-(io + idis + ivcc), io, idis, ivcc];
  }
  // the comparators, each margin > 0 while it is on: reset (RESET below 0.7 V), trigger (TRIG
  // below the divider's lower tap, ⅓ VCC), threshold (THR above CTRL, ⅔ VCC)
  function timerMargins(e, x) { const v = k => vn(x, e.nodes[k]), g = v(0); return [NE555.vreset - (v(3) - g), v(8) - v(1), v(5) - v(4)]; }
  // the latch they leave: reset wins, then the trigger (it holds the output high whatever the
  // threshold), then the threshold; with none on it keeps its state
  const timerNext = (m, q) => (m[0] > 0 ? 0 : m[1] > 0 ? 1 : m[2] > 0 ? 0 : q);
  const latchOf = (e, x) => (x[e.latch] > 0.5 ? 1 : 0);
  // ---------------------------------------------------------------------------
  // Glow-discharge tube (nodes A, K): a gas regulator or a neon lamp. Its latch (1 lit, 0 dark) is
  // an extra unknown like a 555's: dark it leaks 10 GΩ until A−K reaches the striking voltage;
  // lit it holds the maintaining voltage vm plus r per ampere (its regulation), until its current
  // falls below the extinction current iext. The lit drop is smoothed over 50 mV so Newton's
  // method sees a slope where the current starts. Reverse, it stays dark.
  // ---------------------------------------------------------------------------
  function glowCurrents(V, m, q) {
    const v = V[0] - V[1], w = 0.05, i = v / 1e10 + (q ? w * softplus((v - m.vm) / w) / m.r : 0);
    return [i, -i];
  }
  // margins: strike (A−K above the striking voltage), extinguish (current below iext)
  function glowMargins(e, x) { const v = vn(x, e.nodes[0]) - vn(x, e.nodes[1]), m = e.model; return [v - m.vs, m.vm + m.r * m.iext - v]; }
  const glowNext = (mg, q) => (q ? (mg[1] > 0 ? 0 : 1) : (mg[0] > 0 ? 1 : 0));
  // ---------------------------------------------------------------------------
  // Relay (nodes S+, S−, then COM, NC, NO for each pole): its latch (1 pulled in) follows the coil's
  // current, sensed as the voltage S+ − S− across the coil's own resistance, so the thresholds are
  // the must-operate and must-release voltages: it pulls in once that reaches von and drops out
  // when it falls below voff (either polarity, as a relay's armature does not care). The coil's
  // inductance (another element) is what delays it. A closed contact is ron, an open one roff.
  // ---------------------------------------------------------------------------
  function relayCurrents(V, m, q) {
    const I = new Array(V.length).fill(0), gon = 1 / m.ron, goff = 1 / m.roff;
    for (let p = 2; p + 2 < V.length; p += 3) {
      const inc = (V[p] - V[p + 1]) * (q ? goff : gon), ino = (V[p] - V[p + 2]) * (q ? gon : goff);
      I[p] += inc + ino; I[p + 1] -= inc; I[p + 2] -= ino;
    }
    return I;
  }
  function relayMargins(e, x) { const v = Math.abs(vn(x, e.nodes[0]) - vn(x, e.nodes[1])), m = e.model; return [v - m.von, m.voff - v]; }
  // the latched elements (555s, glow tubes, relays) through one interface: their margins, the state
  // they leave, and the margin whose crossing makes the flip to want. A glow tube and a relay have
  // one margin each way: [0] makes it flip on, [1] off
  const LATCHED = new Set(["TIMER555", "GLOW", "RELAY"]);
  const latchMargins = (e, x) => (e.kind === "GLOW" ? glowMargins(e, x) : e.kind === "RELAY" ? relayMargins(e, x) : timerMargins(e, x));
  const latchNext = (e, mg, q) => (e.kind === "TIMER555" ? timerNext(mg, q) : glowNext(mg, q));
  // ---------------------------------------------------------------------------
  // Light-dependent resistor in a vactrol (nodes A, B, and S+, S− across the LED's sense resistor
  // rs). Its light is an extra unknown, in amperes of LED current: at DC it is the LED's current;
  // in a step it relaxes toward it, quickly as the LED brightens (ton) and slowly as it dims (toff),
  // as a CdS cell does. The cell's conductance: 1/rdark + (light / 10 mA)^gamma / r10.
  // ---------------------------------------------------------------------------
  function ldrG(m, light) {
    const u = Math.max(light, 0) / 0.01, g = 1 / m.rdark + Math.pow(u, m.gamma) / m.r10;
    return [g, u > 1e-7 ? m.gamma * Math.pow(u, m.gamma - 1) / (0.01 * m.r10) : 0];
  }
  // the first latch to flip in a step from xp to xn: { e, want, th }, th the fraction of the step
  // at which its comparator crossed (or the reset let go, when the comparator was on already)
  function timerEvent(circ, xp, xn) {
    let ev = null;
    for (const e of circ.timers) {
      const q = latchOf(e, xp), mn = latchMargins(e, xn), want = latchNext(e, mn, q);
      if (want === q) continue;
      const glow = e.kind !== "TIMER555", mp = latchMargins(e, xp), k = glow ? (want ? 0 : 1) : want ? 1 : mn[0] > 0 ? 0 : 2;
      let th = 0;
      if (mp[k] <= 0 && mn[k] > 0) th = mp[k] / (mp[k] - mn[k]);
      else if (!glow && mp[0] > 0 && mn[0] <= 0) th = mp[0] / (mp[0] - mn[0]);
      if (!ev || th < ev.th) ev = { e, want, th };
    }
    return ev;
  }
  // One transient step (step(xprev, tNext, h) of simulate or startup) with the latches: solved with
  // them held; when one flips, the step is cut where it flipped (the margins interpolated linearly),
  // the latch set there and the rest of the step run. A flip at the very start comes before the
  // step; after 8 in one step (a circuit that chatters) the latch flips at the step's end.
  function timerStep(circ, step, xp, tNext, h, n) {
    const x = step(xp, tNext, h);
    if (!x || !circ.timers.length) return x;
    const ev = timerEvent(circ, xp, x);
    if (!ev) return x;
    n = n || 0;
    // circ.onFlip(e, want, t): told of each flip and when it happened (a glow tube may strike and go out within one step)
    const told = tf => { if (circ.onFlip) circ.onFlip(ev.e, ev.want, tf); };
    if (n >= 8 || ev.th >= 1 - 1e-6) { x[ev.e.latch] = ev.want; told(tNext); return x; }
    if (ev.th <= 1e-6) { const xs = xp.slice(); xs[ev.e.latch] = ev.want; told(tNext - h); return timerStep(circ, step, xs, tNext, h, n + 1); }
    const hm = h * ev.th, xm = step(xp, tNext - h + hm, hm);
    if (!xm) return null;
    xm[ev.e.latch] = ev.want; told(tNext - h + hm);
    return timerStep(circ, step, xm, tNext, h - hm, n + 1);
  }

  // A step's local error, by its third difference over the steps before (h³·v‴, which Gear-2's
  // error follows). Past 0.25 V plus 1 % of the node's voltage, and past ¾ of the largest of those
  // steps' own changes, an edge or a sharp kink fell inside the step: it is run again as 8 steps of
  // Gear-2 (and any of those again as 8). A smooth waveform, even at a coarse step (a power-on
  // run's), has a third difference far below its first ones; an edge has its whole height in it.
  // The grid stays as it was, so a period still ends on its last step and the harmonics stay exact;
  // only the inside of a fast edge is resolved. hist: the states one, two and three steps back,
  // [x₋₃, x₋₂, x₋₁] (x₋₃ null when the run has not got it: the second difference then). Returns
  // null when the step needs nothing finer, or a finer run does not converge (its own result stands).
  // tol: { abs, rel } in place of 0.25 V and 1 % (a power-on run, whose step is set for the
  // envelope, takes 1 V and 2 %: an audio signal's kinks there are no edges to resolve)
  const REFINE_ABS = 0.25, REFINE_REL = 0.01, REFINE_SLOPE = 0.75;
  function needsRefine(circ, hist, xn, tol) {
    const abs = tol && tol.abs || REFINE_ABS, rel = tol && tol.rel || REFINE_REL;
    const [b3, b2, xp] = hist;
    for (let i = 0, nv = circ.nNodes - 1; i < nv; i++) {
      const e = Math.abs(b3 ? xn[i] - 3 * xp[i] + 3 * b2[i] - b3[i] : xn[i] - 2 * xp[i] + b2[i]);
      if (e <= abs + rel * Math.max(Math.abs(xn[i]), Math.abs(xp[i]))) continue;
      if (e > REFINE_SLOPE * Math.max(Math.abs(xn[i] - xp[i]), Math.abs(xp[i] - b2[i]), b3 ? Math.abs(b2[i] - b3[i]) : 0)) return true;
    }
    return false;
  }
  function refineStep(circ, hist, xn, tNext, hh, level, tol) {
    if (!needsRefine(circ, hist, xn, tol)) return null;
    const N = 8, hs = hh / N;
    let h3 = null, h2 = null, xs = hist[2];
    for (let k = 1; k <= N; k++) {
      const tk = tNext - hh + hs * k, r = newtonSolve(circ, xs, { h: hs, t: tk, prev: xs, prev2: h2 }, { gmin: 1e-12 });
      if (!r.ok) return null;
      const xr = level < 1 && h2 ? refineStep(circ, [h3, h2, xs], r.x, tk, hs, level + 1, tol) : null;
      h3 = h2; h2 = xs; xs = xr || r.x;
    }
    return xs;
  }
  // a time step's solver keeps x₋₃ beside its Gear history x₋₂ (xBack): good while xBack is the
  // array it was kept with (a run that changes its step rescales xBack into a new one)
  const refineHist = (hk, gear, xBack, xprev) => [gear && hk.b === xBack ? hk.b3 : null, gear ? xBack : null, xprev];
  const keepHist = (hk, gear, xBack, xprev) => { hk.b3 = gear ? xBack : null; hk.b = xprev; };

  // ---------------------------------------------------------------------------
  // Dense linear solve with partial pivoting (in place)
  // ---------------------------------------------------------------------------
  function solveLinear(A, b, n) {
    for (let k = 0; k < n; k++) {
      let piv = k, max = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(A[i * n + k]);
        if (v > max) { max = v; piv = i; }
      }
      if (max < 1e-300) return false;
      if (piv !== k) {
        for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t; }
        const t = b[k]; b[k] = b[piv]; b[piv] = t;
      }
      const akk = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / akk;
        if (f === 0) continue;
        A[i * n + k] = 0;
        for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
      b[i] = s / A[i * n + i];
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Sparse matrix and LU. The engine stamps into it (add); the positions used are remembered
  // per circuit, so each stamp finds its slot at once and the solve touches only nonzeros.
  // LU: Gilbert–Peierls (left-looking, as KLU), columns in minimum-degree order, partial pivoting.
  // ---------------------------------------------------------------------------
  // a kept pivot must stay at least this share of the largest entry below it in its column (as KLU's
  // threshold), or the matrix is factored afresh with new pivots
  const PIVOT_TOL = 1e-3;
  function SparseMatrix(n) {
    this.n = n; this.slot = new Int32Array(n * n).fill(-1);
    this.nnz = 0; this.rows = new Int32Array(64); this.cols = new Int32Array(64); this.vals = new Float64Array(64);
    this.dirty = true;
    const w = Math.max(n, 1);
    this.pinv = new Int32Array(w); this.x = new Float64Array(w); this.xi = new Int32Array(w); this.stk = new Int32Array(w); this.ps = new Int32Array(w); this.mark = new Int32Array(w);
    this.Lp = new Int32Array(w + 1); this.Up = new Int32Array(w + 1);
    this.Li = new Int32Array(256); this.Lx = new Float64Array(256); this.Ui = new Int32Array(256); this.Ux = new Float64Array(256);
  }
  const growI = (a, need) => { if (a.length >= need) return a; const b = new Int32Array(Math.max(need, a.length * 2)); b.set(a); return b; };
  const growF = (a, need) => { if (a.length >= need) return a; const b = new Float64Array(Math.max(need, a.length * 2)); b.set(a); return b; };
  SparseMatrix.prototype.add = function (r, c, v) {
    let s = this.slot[r * this.n + c];
    if (s < 0) {
      s = this.nnz++;
      if (s >= this.rows.length) { this.rows = growI(this.rows, s + 1); this.cols = growI(this.cols, s + 1); this.vals = growF(this.vals, s + 1); }
      this.slot[r * this.n + c] = s; this.rows[s] = r; this.cols[s] = c; this.vals[s] = 0; this.dirty = true;
    }
    this.vals[s] += v;
  };
  SparseMatrix.prototype.clear = function () { this.vals.fill(0, 0, this.nnz); };
  // the pattern changed: columns (CSC, rows ascending) over the slots, and the column order
  SparseMatrix.prototype.analyse = function () {
    const n = this.n, nz = this.nnz, cp = new Int32Array(n + 1), ri = new Int32Array(nz), cs = new Int32Array(nz);
    for (let s = 0; s < nz; s++) cp[this.cols[s] + 1]++;
    for (let j = 0; j < n; j++) cp[j + 1] += cp[j];
    const next = cp.slice(0, n);
    for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) { const s = this.slot[r * n + c]; if (s >= 0) { const p = next[c]++; ri[p] = r; cs[p] = s; } }
    this.cp = cp; this.ri = ri; this.cs = cs;
    // minimum degree on the pattern of A + Aᵀ
    const adj = Array.from({ length: n }, () => new Set());
    for (let s = 0; s < nz; s++) { const r = this.rows[s], c = this.cols[s]; if (r !== c) { adj[r].add(c); adj[c].add(r); } }
    const done = new Uint8Array(n), q = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      let best = -1, bd = Infinity;
      for (let v = 0; v < n; v++) if (!done[v] && adj[v].size < bd) { bd = adj[v].size; best = v; }
      done[best] = 1; q[k] = best;
      const nb = [...adj[best]];
      for (const a of nb) { adj[a].delete(best); for (const c of nb) if (c !== a) adj[a].add(c); }
    }
    this.q = q; this.dirty = false; this.layout = -1; this.factored = false;   // the WebAssembly copy of the pattern is out of date
  };
  // A x = b: b is overwritten with x; false when the matrix is singular
  SparseMatrix.prototype.solve = function (b) {
    if (this.dirty) this.analyse();
    if (wasm) return this.solveWasm(b);
    if (this.factored && this.refactorJS()) { this.substituteJS(b); return true; }
    if (this.stats) this.stats.lu++;
    this.factored = this.solveJS(b);
    return this.factored;
  };
  // the WebAssembly kernel (wasm/solver.ts): the same steps as solveJS. The arrays live in its
  // memory; the pattern's go in when it changes, the values and b on every solve.
  SparseMatrix.prototype.solveWasm = function (b) {
    const n = this.n, nz = this.nnz;
    for (;;) {
      if (wasm.owner !== this || this.layout !== wasm.layoutId) this.place();
      const L = this.lay, mem = wasm.memory.buffer, F = wasm.f64 && wasm.f64.buffer === mem ? wasm.f64 : (wasm.f64 = new Float64Array(mem)), vals = this.vals;
      F.set(vals.subarray(0, nz), L.vals >> 3);
      for (let i = 0; i < n; i++) F[(L.b >> 3) + i] = b[i];
      // the last factors' pattern and pivots again, when they hold (most Newton iterations); else afresh
      let r = this.factored ? wasm.refactor(n, L.tab, PIVOT_TOL) : -3;
      if (r === -3) { r = wasm.solve(n, L.tab); if (this.stats) this.stats.lu++; }
      this.factored = r === 1;
      if (r === 1) { for (let i = 0; i < n; i++) b[i] = F[(L.b >> 3) + i]; return true; }
      if (r === 0) return false;
      if (r === -1) this.capL *= 2; else this.capU *= 2;   // L or U needs more room: lay out again
      this.layout = -1;
    }
  };
  SparseMatrix.prototype.place = function () {
    const n = this.n, nz = this.nnz;
    this.capL = this.capL || 4 * nz + n; this.capU = this.capU || 4 * nz + n;
    // byte offsets, 8-aligned: the i32 arrays, then the f64 ones
    let off = 0; const L = {}, take = (k, count, size) => { L[k] = off; off += Math.ceil(count * size / 8) * 8; };
    take("tab", 20, 4); take("cp", n + 1, 4); take("ri", nz, 4); take("cs", nz, 4); take("q", n, 4); take("pinv", n, 4); take("xi", n, 4); take("stk", n, 4); take("ps", n, 4); take("mark", n, 4);
    take("Lp", n + 1, 4); take("Up", n + 1, 4); take("Li", this.capL, 4); take("Ui", this.capU, 4);
    take("vals", nz, 8); take("b", n, 8); take("x", n, 8); take("Lx", this.capL, 8); take("Ux", this.capU, 8);
    const mem = wasm.memory; if (mem.buffer.byteLength < off) mem.grow(Math.ceil((off - mem.buffer.byteLength) / 65536));
    const I = new Int32Array(mem.buffer);
    ["cp", "ri", "cs", "q", "vals", "b", "pinv", "x", "xi", "stk", "ps", "mark", "Lp", "Up", "Li", "Lx", "Ui", "Ux"].forEach((k, i) => { I[(L.tab >> 2) + i] = L[k]; });
    I[(L.tab >> 2) + 18] = this.capL; I[(L.tab >> 2) + 19] = this.capU;
    I.set(this.cp, L.cp >> 2); I.set(this.ri, L.ri >> 2); I.set(this.cs, L.cs >> 2); I.set(this.q, L.q >> 2);
    this.lay = L; wasm.owner = this; this.layout = wasm.layoutId = (wasm.layoutId || 0) + 1; this.factored = false;
  };
  SparseMatrix.prototype.solveJS = function (b) {
    const n = this.n, cp = this.cp, ri = this.ri, cs = this.cs, vals = this.vals, q = this.q;
    const pinv = this.pinv, x = this.x, xi = this.xi, stk = this.stk, ps = this.ps, mark = this.mark, Lp = this.Lp, Up = this.Up;
    let Li = this.Li, Lx = this.Lx, Ui = this.Ui, Ux = this.Ux;
    pinv.fill(-1); mark.fill(-1);
    let lnz = 0, unz = 0;
    for (let k = 0; k < n; k++) {
      Lp[k] = lnz; Up[k] = unz;
      const col = q[k];
      // the rows reachable from A(:, col) through the columns of L made so far, in topological order (as CSparse's cs_reach)
      let top = n;
      for (let p = cp[col]; p < cp[col + 1]; p++) {
        if (mark[ri[p]] === k) continue;
        let head = 0; stk[0] = ri[p];
        while (head >= 0) {
          const r = stk[head], c = pinv[r];
          if (mark[r] !== k) { mark[r] = k; ps[head] = c < 0 ? 0 : Lp[c]; }
          let done = true;
          const end = c < 0 ? 0 : Lp[c + 1];
          for (let pp = ps[head]; pp < end; pp++) { const rr = Li[pp]; if (mark[rr] === k) continue; ps[head] = pp + 1; stk[++head] = rr; done = false; break; }
          if (done) { head--; xi[--top] = r; }
        }
      }
      for (let p = top; p < n; p++) x[xi[p]] = 0;
      for (let p = cp[col]; p < cp[col + 1]; p++) x[ri[p]] = vals[cs[p]];
      // x = L \ x over that pattern
      for (let p = top; p < n; p++) {
        const r = xi[p], c = pinv[r]; if (c < 0) continue;
        const xr = x[r]; if (xr === 0) continue;
        for (let pp = Lp[c] + 1; pp < Lp[c + 1]; pp++) x[Li[pp]] -= Lx[pp] * xr;
      }
      // U(:, k) from the rows already pivotal; the pivot: the largest of the others
      if (unz + n - top + 1 > Ui.length) { Ui = this.Ui = growI(Ui, unz + n + 1); Ux = this.Ux = growF(Ux, unz + n + 1); }
      let ipiv = -1, amax = -1;
      for (let p = top; p < n; p++) {
        const r = xi[p];
        if (pinv[r] < 0) { const a = Math.abs(x[r]); if (a > amax) { amax = a; ipiv = r; } }
        else { Ui[unz] = pinv[r]; Ux[unz++] = x[r]; }
      }
      if (ipiv < 0 || amax < 1e-300) return false;
      const piv = x[ipiv];
      Ui[unz] = k; Ux[unz++] = piv;
      pinv[ipiv] = k;
      if (lnz + n - top + 1 > Li.length) { Li = this.Li = growI(Li, lnz + n + 1); Lx = this.Lx = growF(Lx, lnz + n + 1); }
      Li[lnz] = ipiv; Lx[lnz++] = 1;
      for (let p = top; p < n; p++) { const r = xi[p]; if (pinv[r] < 0) { Li[lnz] = r; Lx[lnz++] = x[r] / piv; } }
    }
    Lp[n] = lnz; Up[n] = unz;
    this.substituteJS(b);
    return true;
  };
  // as the WebAssembly's refactor: the numbers on the last pattern and pivots; false when a pivot is too small
  SparseMatrix.prototype.refactorJS = function () {
    const n = this.n, cp = this.cp, ri = this.ri, cs = this.cs, vals = this.vals, q = this.q, pinv = this.pinv, x = this.x, rowOf = this.xi;
    const Lp = this.Lp, Up = this.Up, Li = this.Li, Lx = this.Lx, Ui = this.Ui, Ux = this.Ux;
    for (let i = 0; i < n; i++) rowOf[pinv[i]] = i;
    for (let k = 0; k < n; k++) {
      const col = q[k], u0 = Up[k], d = Up[k + 1] - 1, l0 = Lp[k], l1 = Lp[k + 1];
      for (let p = u0; p < d; p++) x[rowOf[Ui[p]]] = 0;
      for (let p = l0; p < l1; p++) x[Li[p]] = 0;
      for (let p = cp[col]; p < cp[col + 1]; p++) x[ri[p]] = vals[cs[p]];
      for (let p = u0; p < d; p++) {
        const c = Ui[p], xr = x[rowOf[c]];
        Ux[p] = xr;
        if (xr === 0) continue;
        for (let pp = Lp[c] + 1; pp < Lp[c + 1]; pp++) x[Li[pp]] -= Lx[pp] * xr;
      }
      const piv = x[Li[l0]];
      let amax = 0;
      for (let p = l0 + 1; p < l1; p++) amax = Math.max(amax, Math.abs(x[Li[p]]));
      if (!(Math.abs(piv) > 1e-300) || Math.abs(piv) < PIVOT_TOL * amax) return false;
      Ux[d] = piv;
      for (let p = l0 + 1; p < l1; p++) Lx[p] = x[Li[p]] / piv;
    }
    return true;
  };
  SparseMatrix.prototype.substituteJS = function (b) {
    const n = this.n, q = this.q, pinv = this.pinv, x = this.x, Lp = this.Lp, Up = this.Up, Li = this.Li, Lx = this.Lx, Ui = this.Ui, Ux = this.Ux;
    // P b, then L, then U, then the column order back
    for (let i = 0; i < n; i++) x[pinv[i]] = b[i];
    for (let k = 0; k < n; k++) { const v = x[k]; if (v === 0) continue; for (let p = Lp[k] + 1; p < Lp[k + 1]; p++) x[pinv[Li[p]]] -= Lx[p] * v; }
    for (let k = n - 1; k >= 0; k--) { const d = Up[k + 1] - 1; x[k] /= Ux[d]; const v = x[k]; if (v === 0) continue; for (let p = Up[k]; p < d; p++) x[Ui[p]] -= Ux[p] * v; }
    for (let k = 0; k < n; k++) b[q[k]] = x[k];
  };

  // The sparse LU's numeric part runs as WebAssembly (wasm/solver.ts, built into sim-solver.wasm)
  // once loadWasm has the module; without it (not loaded, or no WebAssembly) solveJS does the same work.
  let wasmModule = null, wasm = null;
  function loadWasm(bytes) {
    try { wasmModule = new WebAssembly.Module(bytes); } catch (e) { wasmModule = null; }
    return useWasm(true);
  }
  function useWasm(on) {
    wasm = null;
    if (on === false || !wasmModule) return false;
    try { const ex = new WebAssembly.Instance(wasmModule, {}).exports; wasm = { solve: ex.solve, refactor: ex.refactor, memory: ex.memory, owner: null, layoutId: 0 }; } catch (e) { wasm = null; }
    return !!wasm;
  }

  function invertMatrix(M, n) {
    const A = M.slice(), I = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let k = 0; k < n; k++) {
      let piv = k;
      for (let i = k + 1; i < n; i++) if (Math.abs(A[i * n + k]) > Math.abs(A[piv * n + k])) piv = i;
      for (let j = 0; j < n; j++) {
        let t = A[k * n + j]; A[k * n + j] = A[piv * n + j]; A[piv * n + j] = t;
        t = I[k * n + j]; I[k * n + j] = I[piv * n + j]; I[piv * n + j] = t;
      }
      const d = A[k * n + k];
      for (let j = 0; j < n; j++) { A[k * n + j] /= d; I[k * n + j] /= d; }
      for (let i = 0; i < n; i++) {
        if (i === k) continue;
        const f = A[i * n + k];
        if (!f) continue;
        for (let j = 0; j < n; j++) { A[i * n + j] -= f * A[k * n + j]; I[i * n + j] -= f * I[k * n + j]; }
      }
    }
    return I;
  }

  // ---------------------------------------------------------------------------
  // Source waveforms
  // ---------------------------------------------------------------------------
  function waveValue(el, t, scale) {
    // a recording (audio()): its samples at el.rate, linear between them, silent after the end
    if (el.samples) {
      const p = t * el.rate, k = Math.floor(p), a = el.samples[k] || 0, b = el.samples[k + 1] || 0;
      return scale * ((el.offset || 0) + el.amp * (a + (b - a) * (p - k)));
    }
    const w = 2 * Math.PI * el.freq * t + (el.phase || 0) * Math.PI / 180;
    let s;
    // square: a clipped triangle, i.e. edges with a 1 % rise time like a real
    // generator. An ideal step makes each sample on an edge depend on float
    // rounding of sin() and gives two periods different edges (spurious lines).
    if (el.wave === "square") s = Math.max(-1, Math.min(1, 50 * (2 / Math.PI) * Math.asin(Math.sin(w))));
    else if (el.wave === "triangle") s = (2 / Math.PI) * Math.asin(Math.sin(w));
    else s = Math.sin(w);
    return scale * ((el.offset || 0) + el.amp * s);
  }

  // ---------------------------------------------------------------------------
  // Behavioural sources (kind B): { nodes: [a, b, …], out: "i" | "v", ast, ctl: [element ids] }.
  // The expression is a closed tree (spice-net.js makes it: parameters already numbers, functions
  // inlined): { k: "n", v } · { k: "v", a, b } (the voltage between two of the element's own nodes,
  // by their place in nodes) · { k: "i", n } (the current through the n-th element of ctl, a
  // source or an inductor) · { k: "u", op, x } · { k: "b", op, a, b } · { k: "?", c, a, b } ·
  // { k: "f", s, args } (SpiceModel's functions) · { k: "tbl", x, pts } (a table, straight lines
  // between its points, level beyond them). out "i": that current flows from node a through the
  // source to node b; out "v": v(a) − v(b) is the expression (its current a branch unknown).
  // ---------------------------------------------------------------------------
  // a capacitor's value at the voltage v across it (first node positive). A junction's (junc:
  // { vj, m, fc }, c its zero-bias value) is SPICE's depletion law, linear past fc·vj forward
  // A power MOSFET's gate-drain capacitance (vdm: { min, max, a }, v = vgd) is the VDMOS law: CGDMAX
  // with the gate above the drain, falling to CGDMIN as the drain rises past it (Miller C grows at low Vds).
  function capAt(e, v) {
    const g = e.vdm;
    if (g) { const s = (g.max - g.min) / (1 + Math.PI / 2), y = g.max - s; return v > 0 ? s * Math.tanh(g.a * v) + y : s * Math.atan(g.a * v) + y; }
    const j = e.junc; if (!j) return e.c;
    const vj = j.vj > 0 ? j.vj : 1, m = j.m >= 0 ? j.m : 0.5, fc = j.fc > 0 && j.fc < 1 ? j.fc : 0.5;
    return v < fc * vj ? e.c * Math.pow(1 - v / vj, -m) : e.c * Math.pow(1 - fc, -(1 + m)) * (1 - fc * (1 + m) + m * v / vj);
  }
  // its charge at v (0 at 0 V): the integral of capAt, so a transient that steps the charge
  // conserves it however far the voltage swings in one step (SPICE's charge-based capacitors)
  function chargeAt(e, v) {
    const g = e.vdm;
    if (g) {
      const s = (g.max - g.min) / (1 + Math.PI / 2), y = g.max - s, a = g.a, u = a * v;
      return v > 0 ? y * v + s * (Math.abs(u) > 30 ? Math.abs(u) - Math.LN2 : Math.log(Math.cosh(u))) / a : y * v + s * (v * Math.atan(u) - Math.log1p(u * u) / (2 * a));
    }
    const j = e.junc; if (!j) return e.c * v;
    const vj = j.vj > 0 ? j.vj : 1, m = j.m >= 0 ? j.m : 0.5, fc = j.fc > 0 && j.fc < 1 ? j.fc : 0.5, c = e.c;
    const qd = x => (Math.abs(1 - m) < 1e-9 ? -c * vj * Math.log(1 - x / vj) : c * vj * (1 - Math.pow(1 - x / vj, 1 - m)) / (1 - m));
    const v1 = fc * vj;
    if (v < v1) return qd(v);
    return qd(v1) + c * Math.pow(1 - fc, -(1 + m)) * ((1 - fc * (1 + m)) * (v - v1) + m * (v * v - v1 * v1) / (2 * vj));
  }
  const tableAt = (x, p) => {
    const n = p.length;
    if (!(x > p[0])) return p[1];
    if (x >= p[n - 2]) return p[n - 1];
    let k = 2; while (p[k] < x) k += 2;
    return p[k - 1] + (p[k + 1] - p[k - 1]) * (x - p[k - 2]) / ((p[k] - p[k - 2]) || 1e-300);
  };
  const BOPS = { "||": (a, b) => (a || b ? 1 : 0), "&&": (a, b) => (a && b ? 1 : 0), "==": (a, b) => (a === b ? 1 : 0), "!=": (a, b) => (a !== b ? 1 : 0), "<>": (a, b) => (a !== b ? 1 : 0),
    "<": (a, b) => (a < b ? 1 : 0), ">": (a, b) => (a > b ? 1 : 0), "<=": (a, b) => (a <= b ? 1 : 0), ">=": (a, b) => (a >= b ? 1 : 0),
    "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b, "/": (a, b) => a / b, "**": Math.pow, "^": Math.pow };
  const bFuncs = () => (root.SpiceModel && root.SpiceModel.FUNCS) || {};
  function bJs(t) {
    switch (t.k) {
      case "n": return `(${+t.v})`;
      case "v": return `(V[${t.a | 0}]-V[${t.b | 0}])`;
      case "i": return `I[${t.n | 0}]`;
      case "u": return t.op === "-" ? `(-${bJs(t.x)})` : t.op === "!" ? `(${bJs(t.x)}?0:1)` : bJs(t.x);
      case "b": {
        const a = bJs(t.a), b = bJs(t.b), op = t.op;
        if (op === "**" || op === "^") return `Math.pow(${a},${b})`;
        if (op === "+" || op === "-" || op === "*" || op === "/") return `(${a}${op}${b})`;
        if (!BOPS[op]) throw new Error("bad operator");
        return `((${a}${{ "<>": "!==", "==": "===", "!=": "!==" }[op] || op}${b})?1:0)`;
      }
      case "?": return `(${bJs(t.c)}?${bJs(t.a)}:${bJs(t.b)})`;
      case "f": if (!/^[a-z_][a-z0-9_]*$/.test(t.s) || !bFuncs()[t.s]) throw new Error(`unknown function ${t.s}()`); return `F.${t.s}(${t.args.map(bJs).join(",")})`;
      case "tbl": return `T(${bJs(t.x)},[${t.pts.map(Number).join(",")}])`;
    }
    throw new Error("bad expression");
  }
  function bClosure(t) {
    switch (t.k) {
      case "n": { const v = +t.v; return () => v; }
      case "v": { const a = t.a | 0, b = t.b | 0; return V => V[a] - V[b]; }
      case "i": { const n = t.n | 0; return (V, I) => I[n]; }
      case "u": { const x = bClosure(t.x); return t.op === "-" ? (V, I) => -x(V, I) : t.op === "!" ? (V, I) => (x(V, I) ? 0 : 1) : x; }
      case "b": { const a = bClosure(t.a), b = bClosure(t.b), f = BOPS[t.op]; if (!f) throw new Error("bad operator"); return (V, I) => f(a(V, I), b(V, I)); }
      case "?": { const c = bClosure(t.c), a = bClosure(t.a), b = bClosure(t.b); return (V, I) => (c(V, I) ? a(V, I) : b(V, I)); }
      case "f": { const f = bFuncs()[t.s], A = t.args.map(bClosure); if (!f) throw new Error(`unknown function ${t.s}()`); return (V, I) => f(...A.map(g => g(V, I))); }
      case "tbl": { const x = bClosure(t.x), p = t.pts.map(Number); return (V, I) => tableAt(x(V, I), p); }
    }
    throw new Error("bad expression");
  }
  // compiled once per expression (its JavaScript is the key: a tolerance run builds the same circuit thousands of times)
  const bCache = new Map();
  let bFast = true;
  function bCompile(ast) {
    if (!bFast) return bClosure(ast);
    const js = bJs(ast);
    let f = bCache.get(js);
    if (!f) {
      try { const g = new Function("F", "T", "V", "I", `"use strict";return ${js};`), F = bFuncs(); f = (V, I) => g(F, tableAt, V, I); }
      catch (e) { bFast = false; return bClosure(ast); }                     // a page that forbids it (CSP): closures
      bCache.set(js, f); if (bCache.size > 2000) bCache.delete(bCache.keys().next().value);
    }
    return f;
  }
  // a B element's value at the unknowns x, and what it depends on: [unknown index (−1: ground), is a current]
  function bValue(e, x) {
    const V = e._V, I = e._I, nd = e.nodes;
    for (let k = 0; k < nd.length; k++) V[k] = nd[k] === 0 ? 0 : x[nd[k] - 1];
    for (let k = 0; k < I.length; k++) I[k] = x[e.ctlIdx[k]];
    const v = e._f(V, I);
    return isFinite(v) ? v : (v > 0 ? 1e30 : v < 0 ? -1e30 : 0);
  }
  // its slopes: [[unknown index, d value / d unknown], …] at x (which is restored), by differences
  function bSlopes(e, x, f0, central) {
    const out = [], seen = e._seen;
    for (let q = 0; q < seen.length; q++) {
      const u = seen[q], cur = u >= e._nV, x0 = x[u], d = cur ? 1e-6 * Math.max(1e-3, Math.abs(x0)) : 1e-6 * Math.max(1, Math.abs(x0));
      x[u] = x0 + d; const fp = bValue(e, x);
      let J;
      if (central) { x[u] = x0 - d; J = (fp - bValue(e, x)) / (2 * d); } else J = (fp - f0) / d;
      x[u] = x0;
      if (J !== 0 && isFinite(J)) out.push([u, J]);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Circuit build: assign unknown indices
  // ---------------------------------------------------------------------------
  function buildCircuit(netlist) {
    const nNodes = netlist.nodeCount;            // includes ground (0)
    let nUnk = nNodes - 1;
    const els = netlist.elements.map(e => Object.assign({}, e));
    els.forEach(e => {
      // a transistor given as its data at Tnom (model0) and a temperature, without self-heating
      if (e.kind === "BJT" && e.model0 && e.temp !== undefined && !e.therm) e.model = Object.assign(bjtAtT(e.model0, e.temp), { pol: e.model.pol });
      if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L" || e.kind === "E" || (e.kind === "B" && e.out === "v")) e.branch = nUnk++;
      else if (LATCHED.has(e.kind)) e.latch = nUnk++;
      else if (e.kind === "LDR") e.light = nUnk++;
      else if (e.kind === "XFMR") {
        e.branches = e.windings.map(() => nUnk++);
        if (e.sat && e.sat.hys) e.plays = PLAYS.map(() => nUnk++);   // the core's hysteresis states (corePlay)
        // Inductance matrix: L_jk = AL * Nj * Nk * (j===k ? 1 : k), plus each winding's own
        // leakage inductance (w.leak, H) on the diagonal
        const W = e.windings.length;
        const AL = e.lp / Math.pow(e.primaryTurns, 2);
        e.n = e.windings.map(w => w.turns / e.primaryTurns);   // turns referred to the primary
        e.Lmat = new Array(W * W);
        for (let j = 0; j < W; j++) for (let k = 0; k < W; k++) {
          const nj = e.windings[j].turns, nk = e.windings[k].turns;
          e.Lmat[j * W + k] = AL * nj * nk * (j === k ? 1 : e.k) + (j === k ? e.windings[j].leak || 0 : 0);
        }
      }
    });
    // a 555's output and discharge pins: their transistors' currents level off a volt or so into
    // conduction, so far from the solution Newton sees no slope there and would throw the pin
    // anywhere; these nodes move at most 2 V an iteration, outside the common damping, and half as far
  // each time they turn back (newtonSolve)
    // behavioural sources: compiled, the sources whose currents they read found, the unknowns they depend on listed
    const bs = els.filter(e => e.kind === "B");
    if (bs.length) {
      const byId = new Map(els.map(e => [e.id, e]));
      bs.forEach(e => {
        e._f = bCompile(e.ast);
        e.ctlIdx = (e.ctl || []).map(id => { const c = byId.get(id); if (!c || c.branch === undefined) throw new Error(`${e.id}: no source ${id} to read the current of`); return c.branch; });
        e._V = new Float64Array(e.nodes.length); e._I = new Float64Array(e.ctlIdx.length);
        const set = new Set(); e.nodes.forEach(k => { if (k > 0) set.add(k - 1); }); e.ctlIdx.forEach(k => set.add(k));
        e._seen = [...set]; e._nV = nNodes - 1;
      });
    }
    const timers = els.filter(e => LATCHED.has(e.kind)), t555 = timers.filter(e => e.kind === "TIMER555"), capped = t555.length ? new Uint8Array(nNodes) : null;
    t555.forEach(e => [e.nodes[2], e.nodes[6]].forEach(k => { if (k > 0) capped[k - 1] = 1; }));
    // nodes no nonlinear part is on (between resistors, capacitors and linear sources: the inside
    // of a maker's macromodel is full of them, some behind a gain of a million): Newton's step
    // there needs no limit, and must not hold the other nodes' steps back
    const LINEAR = { R: 1, C: 1, L: 1, V: 1, VSRC: 1, I: 1, E: 1, G: 1 }, free = new Uint8Array(nNodes).fill(1);
    let anyFree = false;
    // (a behavioural source counts as linear here: its expressions are smooth, and a gain node of a
    // macromodel may have to travel a megavolt, 25 V an iteration would never get it there)
    els.forEach(e => { if ((LINEAR[e.kind] || e.kind === "B") && !e.ntc) return; (e.nodes || []).concat(e.windings ? e.windings.flatMap(w => [w.a, w.b]) : [], e.ext || []).forEach(k => { if (k > 0) free[k - 1] = 0; }); });
    for (let k = 0; k < nNodes - 1; k++) if (free[k]) anyFree = true;
    // stats: work counters for the benchmark (tests/bench.mjs): Newton solves at DC and in the
    // transient (one per time step, sub-steps included), their iterations, the device-model
    // evaluations the Jacobians took, and the solves that did not converge
    return { nNodes, nUnk, els, timers, capped, free: anyFree ? free : null, stats: { dc: 0, steps: 0, newton: 0, evals: 0, fails: 0, lu: 0 } };
  }

  // A transformer's saturating core (XFMR with sat: { ls, p, air }): the flux linkage λ (V·s, on the
  // primary's turns) against the magnetising current im (A, referred to the primary). Below the knee
  // it is lp·im; it bends over towards ls with sharpness p, and past it only the air's (and the gap's)
  // share of lp, air, is left:
  //   λ = (1 − air)·ls·x / (1 + |x|^p)^(1/p) + air·lp·im,  x = lp·im / ls
  // Returns [λ, dλ/dim].
  function coreFlux(e, im) {
    const s = e.sat, x = e.lp * im / s.ls, ax = Math.abs(x), q = 1 + Math.pow(ax, s.p), r = Math.pow(q, -1 / s.p);
    return [(1 - s.air) * s.ls * x * r + s.air * e.lp * im, e.lp * ((1 - s.air) * r / q + s.air)];
  }
  // Core hysteresis (sat.hys { w, h }, a Prandtl–Ishlinskii model): a share w of the flux follows the
  // magnetising current through four plays (backlash) of half-widths h·PLAYS[k] amps: a play's state p_k
  // moves only when im leaves the band p_k ± its width, so rising and falling flux take different
  // paths, a loop whose area is the core's hysteresis loss per cycle; the rest (1 − w) follows im
  // itself. The widths halve from h down, each play weighed by its width (a near-even spread of widths,
  // which gives Rayleigh's law: the loop's area grows as the cube of the swing, its distortion in
  // proportion to the swing, down to small signals). The p_k are unknowns of the circuit (e.plays), so
  // every run carries them from step to step; the steady-state search does not steer them (they close
  // their loop within a cycle of whatever drives them, and steering a play's corner slows it down).
  //   λ = (1 − w)·λcore(im) + w·Σ c_k·λcore(p_k);  returns [λ, dλ/dim, [dλ/dp_k]]
  const PLAYS = [1, 0.5, 0.25, 0.125], PLAY_W = PLAYS.map(r => r / PLAYS.reduce((a, b) => a + b, 0));
  function coreLam(e, im, ps) {
    const h = e.sat.hys, a = coreFlux(e, im);
    if (!h) return [a[0], a[1], []];
    let lam = (1 - h.w) * a[0]; const d = ps.map((p, k) => { const b = coreFlux(e, p); lam += h.w * PLAY_W[k] * b[0]; return h.w * PLAY_W[k] * b[1]; });
    return [lam, (1 - h.w) * a[1], d];
  }
  // play k's new state from its last p0 and the current im: p0 clamped into im ± its width, the
  // corners rounded over 5 % of the width for Newton; returns [p, dp/dim]
  function corePlay(e, k, p0, im) {
    const h = e.sat.hys.h * PLAYS[k], d = 0.2 * h, sp = u => (u > 30 * d ? u : d * Math.log1p(Math.exp(u / d))), sg = u => 1 / (1 + Math.exp(-u / d));
    const u1 = im - h - p0, u2 = p0 - im - h;
    return [p0 + sp(u1) - sp(u2), sg(u1) + sg(u2)];
  }
  const playsOf = (e, x) => e.plays.map(i => x[i]);
  // the magnetising current of an XFMR in the unknowns x: Σ n_j·i_j
  function magCurrent(e, x) { let im = 0; e.branches.forEach((b, j) => { im += e.n[j] * x[b]; }); return im; }
  // the small-signal inductance matrix at the operating point x: a saturating core's magnetising
  // inductance is its slope there (DC in a single-ended primary lowers it)
  // (im: the magnetising current when x holds node voltages only, a mains-fed circuit's averages)
  function xfmrIncremental(e, x, im) {
    if (!e.sat) return e.Lmat;
    const W = e.windings.length, ld = coreFlux(e, im !== undefined ? im : magCurrent(e, x))[1];
    return e.Lmat.map((v, i) => { const j = Math.floor(i / W), k = i % W; return e.n[j] * e.n[k] * ld + (j === k ? e.windings[j].leak || 0 : 0); });
  }

  // Tiny series resistance on inductive branches (ohms): a winding shorted by a
  // wiring mistake would otherwise make the DC matrix singular.
  const R_SERIES = 1e-6;

  // v(node) from the unknown vector
  function vn(x, node) { return node === 0 ? 0 : x[node - 1]; }

  // ---------------------------------------------------------------------------
  // Assemble and Newton-solve one operating point
  // mode: { dc: true } or { h, t, prev } ; srcScale for source stepping
  // ---------------------------------------------------------------------------
  // a circuit's elements split into those whose stamps do not depend on the iterate (lin) and
  // the rest (nl), for the DC operating point or a transient step
  const LINEAR_KINDS = new Set(["R", "C", "L", "V", "VSRC", "I", "E", "G", "RELAY"]);
  function linearSplit(circ, dc) {
    const key = dc ? "_splitDC" : "_splitTR";
    if (circ[key] && circ[key].n === circ.els.length) return circ[key];
    const lin = [], nl = [];
    // a junction's capacitor in the transient follows the voltage of this iterate: not linear
    circ.els.forEach(e => (((LINEAR_KINDS.has(e.kind) && !(e.kind === "C" && !dc && (e.junc || e.vdm))) || (e.kind === "XFMR" && !(e.sat && !dc))) ? lin : nl).push(e));
    return (circ[key] = { lin, nl, n: circ.els.length });
  }

  function newtonSolve(circ, x0, mode, opts) {
    circ._stuck = null;
    const n = circ.nUnk;
    const x = x0.slice();
    const A = circ.matrix && circ.matrix.n === n ? circ.matrix : (circ.matrix = new SparseMatrix(n));   // kept with the circuit: its pattern and column order
    const b = new Float64Array(n);
    const gmin = opts.gmin;
    const maxStep = mode.dc ? 25 : 15;
    const maxIter = opts.maxIter || (mode.dc ? 300 : 60);
    const srcScale = opts.srcScale === undefined ? 1 : opts.srcScale;
    const st = circ.stats;
    if (st) { if (mode.dc) st.dc++; else st.steps++; }
    A.stats = st;

    const addA = (i, j, v) => { if (i > 0 && j > 0) A.add(i - 1, j - 1, v); };
    const addB = (i, v) => { if (i > 0) b[i - 1] += v; };
    const addAu = (r, c, v) => { A.add(r, c, v); };   // raw unknown indices
    const stampG = (a, c, g) => { addA(a, a, g); addA(c, c, g); addA(a, c, -g); addA(c, a, -g); };
    // Nonlinear device: currents into each terminal I(V) linearized at V0
    // I(V) ~= I0 + J (V - V0)  ->  A += J,  b += J V0 - I0
    // dAbs: a fixed difference step (V) for exponential devices, where 1 ppm of a
    // few hundred volts would already be a coarse step
    // Every such part's currents depend only on the differences of its terminal voltages (raising
    // them all together changes nothing), so the last terminal's column is minus the sum of the
    // others: m evaluations, not m + 1
    const stampNonlinear = (nodes, fn, V0, dAbs) => {
      const I0 = fn(V0);
      const m = nodes.length, r = m - 1;
      if (st) st.evals += m;
      const rhs = I0.map(v => -v), Jr = new Float64Array(m);
      for (let s = 0; s < r; s++) {
        const d = dAbs || 1e-6 * Math.max(1, Math.abs(V0[s]));
        const Vp = V0.slice(); Vp[s] += d;
        const Ip = fn(Vp);
        for (let t = 0; t < m; t++) {
          const J = (Ip[t] - I0[t]) / d;
          if (J === 0) continue;
          addA(nodes[t], nodes[s], J);
          rhs[t] += J * (V0[s] - V0[r]);
          Jr[t] -= J;
        }
      }
      for (let t = 0; t < m; t++) { if (Jr[t] !== 0) addA(nodes[t], nodes[r], Jr[t]); addB(nodes[t], rhs[t]); }
    };

    // a part from its worked-out Jacobian (fnJ returns { I, J }, J over all its terminals)
    const stampJacobian = (nodes, fnJ, V0, model) => {
      const { I, J } = fnJ(V0, model), m = nodes.length;
      if (st) st.evals++;
      for (let t = 0; t < m; t++) {
        let rhs = -I[t];
        const row = J[t];
        // an entry the row's own rounding hides is left out, as a finite difference would find it: one below
        // 1e-14 of the row's largest, or, in a row carrying more than a kiloampere (an iterate on its way, or
        // a curve swept far past any rating), one whose current over a microvolt is below the rounding of
        // the row's current (1e-9 of it per volt). Kept there, it ties the nodes together through a current
        // known only to its rounding, and the solve wobbles at that level and never converges
        let big = 0; for (let s = 0; s < m; s++) big = Math.max(big, Math.abs(row[s]));
        const tiny = Math.abs(I[t]) > 1e3 ? Math.max(1e-14 * big, 1e-9 * Math.abs(I[t])) : 0;
        for (let s = 0; s < m; s++) { const g = row[s]; if (g === 0 || Math.abs(g) < tiny) continue; addA(nodes[t], nodes[s], g); rhs += g * V0[s]; }
        addB(nodes[t], rhs);
      }
    };
    // a tube from its worked-out Jacobian: the currents into A, G (, G2) are functions of the
    // voltages to K, the cathode's current minus their sum; false when it has none (differenced)
    const stampTube = (e, nd, V0) => {
      const m = nd.length, k = m - 1, vk = V0[k];
      const r = m === 4 ? tubeJacobian(e, V0[0] - vk, V0[1] - vk, V0[2] - vk) : tubeJacobian(e, V0[0] - vk, V0[1] - vk);
      if (!r) return false;
      if (st) st.evals++;
      let sumI = 0;
      const colK = new Float64Array(k);   // d(sum of currents)/d(each terminal voltage), for the cathode's row
      let sumK = 0;
      for (let t = 0; t < k; t++) {
        const row = r.J[t];
        let rk = 0, rhs = -r.I[t];
        for (let s = 0; s < k; s++) { const J = row[s]; if (J === 0) continue; addA(nd[t], nd[s], J); rk -= J; rhs += J * (V0[s] - vk); colK[s] += J; }
        if (rk !== 0) addA(nd[t], nd[k], rk);
        addB(nd[t], rhs);
        sumI += r.I[t]; sumK += rk;
      }
      // the cathode: −(ia + ig + ig2)
      let rhsK = sumI;
      for (let s = 0; s < k; s++) if (colK[s] !== 0) { addA(nd[k], nd[s], -colK[s]); rhsK -= colK[s] * (V0[s] - vk); }
      if (sumK !== 0) addA(nd[k], nd[k], -sumK);
      addB(nd[k], rhsK);
      return true;
    };

    // integration: backward Euler (a0 = 1, a1 = −1), or Gear's second-order BDF2 (3/2, −2, 1/2)
    // when the step before was as long as this one: second-order accurate, so resonances keep
    // their Q, and still strongly damped at high frequencies (no trapezoidal ringing at a
    // rectifier's switching)
    const P2 = !mode.dc && mode.prev2 ? mode.prev2 : null, ID0 = P2 ? 1.5 : 1, ID1 = P2 ? -2 : -1, ID2 = 0.5;
    let lastDv = null, lastDv2 = null, stall = 0;
    const capStep = circ.capped ? new Float64Array(circ.nNodes).fill(2) : null, capDir = capStep ? new Float64Array(circ.nNodes) : null;
    let limited = false;   // a junction voltage was limited: this iterate is not a solution yet
    const stampEl = e => {
      const nd = e.nodes;
      switch (e.kind) {
        case "R": stampG(nd[0], nd[1], 1 / Math.max(e.r, 1e-6)); break;
        case "C":
          if (mode.dc) break;
          if (e.junc || e.vdm) {
            // i = (a0·q(v) + a1·q₋₁ + a2·q₋₂)/h on the charge, linearized at this iterate's voltage
            const v0 = vn(x, nd[0]) - vn(x, nd[1]), q = X => chargeAt(e, vn(X, nd[0]) - vn(X, nd[1]));
            const i = (ID0 * chargeAt(e, v0) + ID1 * q(mode.prev) + (P2 ? ID2 * q(P2) : 0)) / mode.h, g = ID0 * capAt(e, v0) / mode.h;
            stampG(nd[0], nd[1], g);
            addB(nd[0], -(i - g * v0)); addB(nd[1], i - g * v0);
          } else {
            // i = C/h · (a0·v + a1·v₋₁ + a2·v₋₂): backward Euler, or Gear-2 with history
            const v1 = vn(mode.prev, nd[0]) - vn(mode.prev, nd[1]), k = e.c / mode.h;
            const hist = k * (ID1 * v1 + (P2 ? ID2 * (vn(P2, nd[0]) - vn(P2, nd[1])) : 0));
            stampG(nd[0], nd[1], ID0 * k);
            addB(nd[0], -hist); addB(nd[1], hist);
          }
          break;
        case "L": {
          // branch current i flows a -> b through the inductor
          const br = e.branch;
          if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
          if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
          addAu(br, br, -R_SERIES);   // keeps a shorted inductor solvable
          if (!mode.dc) { const k = e.l / mode.h; addAu(br, br, -ID0 * k); b[br] += k * (ID1 * mode.prev[br] + (P2 ? ID2 * P2[br] : 0)); }
          break;
        }
        case "XFMR": {
          const W = e.windings.length;
          let sat = null, im0 = 0, lam1 = 0, lam2 = 0, hysB = 0;
          const pl = e.plays;
          if (e.sat && !mode.dc) {
            im0 = magCurrent(e, x);
            if (pl) {
              sat = coreLam(e, im0, playsOf(e, x));
              lam1 = coreLam(e, magCurrent(e, mode.prev), playsOf(e, mode.prev))[0]; if (P2) lam2 = coreLam(e, magCurrent(e, P2), playsOf(e, P2))[0];
              pl.forEach((u, q) => {
                hysB += sat[2][q] * x[u];
                // each play: p = corePlay(p₋₁, im), linearized in im
                const [pv, dp] = corePlay(e, q, mode.prev[u], im0);
                addAu(u, u, 1); for (let k = 0; k < W; k++) addAu(u, e.branches[k], -dp * e.n[k]);
                b[u] += pv - dp * im0;
              });
            } else {
              sat = coreFlux(e, im0);
              lam1 = coreFlux(e, magCurrent(e, mode.prev))[0]; if (P2) lam2 = coreFlux(e, magCurrent(e, P2))[0];
            }
          } else if (pl) {
            // at DC the plays sit on the magnetising current
            pl.forEach(u => { addAu(u, u, 1); for (let k = 0; k < W; k++) addAu(u, e.branches[k], -e.n[k]); });
          }
          for (let j = 0; j < W; j++) {
            const w = e.windings[j], br = e.branches[j];
            if (w.a > 0) { addAu(w.a - 1, br, 1); addAu(br, w.a - 1, 1); }
            if (w.b > 0) { addAu(w.b - 1, br, -1); addAu(br, w.b - 1, -1); }
            addAu(br, br, -R_SERIES);
            if (!mode.dc && e.sat) {
              // v_j = n_j·dλ/dt + leak_j·di_j/dt, λ = coreFlux(im) linearised at this iterate
              const nj = e.n[j], ID = ID0 / mode.h, lk = w.leak || 0;
              for (let k = 0; k < W; k++) addAu(br, e.branches[k], -ID * (nj * e.n[k] * sat[1] + (k === j ? lk : 0)));
              if (pl) pl.forEach((u, q) => addAu(br, u, -ID * nj * sat[2][q]));
              b[br] += (nj * (ID0 * (sat[0] - sat[1] * im0 - hysB) + ID1 * lam1 + (P2 ? ID2 * lam2 : 0)) + lk * (ID1 * mode.prev[br] + (P2 ? ID2 * P2[br] : 0))) / mode.h;
            } else if (!mode.dc) {
              let hist = 0;
              for (let k = 0; k < W; k++) {
                const m = e.Lmat[j * W + k] / mode.h, bk = e.branches[k];
                addAu(br, bk, -ID0 * m);
                hist += m * (ID1 * mode.prev[bk] + (P2 ? ID2 * P2[bk] : 0));
              }
              b[br] += hist;
            }
          }
          break;
        }
        case "V": case "VSRC": {
          const br = e.branch;
          if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
          if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
          let val;
          if (e.kind === "V") val = e.v * srcScale;
          else if (mode.dc) val = (e.dcValue !== undefined ? e.dcValue : (e.offset || 0)) * srcScale;
          else val = waveValue(e, mode.t, srcScale);
          b[br] += val;
          break;
        }
        case "I": {
          // current e.i flows from node a through the source to node b: out of a, into b
          const i = e.i * srcScale;
          addB(nd[0], -i); addB(nd[1], i);
          break;
        }
        case "E": {
          // nodes out+, out−, ctl+, ctl−: v(out+) − v(out−) = gain · (v(ctl+) − v(ctl−)), its current a branch
          const br = e.branch;
          if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
          if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
          if (nd[2] > 0) addAu(br, nd[2] - 1, -e.gain);
          if (nd[3] > 0) addAu(br, nd[3] - 1, e.gain);
          break;
        }
        case "G":
          // nodes out+, out−, ctl+, ctl−: gm · (v(ctl+) − v(ctl−)) flows out of out+, through the source, into out−
          addA(nd[0], nd[2], e.gm); addA(nd[0], nd[3], -e.gm); addA(nd[1], nd[2], -e.gm); addA(nd[1], nd[3], e.gm);
          break;
        case "B": {
          // value f(u) linearized at this iterate: f ≈ f0 + Σ J·(u − u0)
          const f0 = bValue(e, x), J = bSlopes(e, x, f0);
          let k0 = f0; for (let q = 0; q < J.length; q++) k0 -= J[q][1] * x[J[q][0]];
          if (e.out === "v") {
            const br = e.branch;
            if (nd[0] > 0) { addAu(nd[0] - 1, br, 1); addAu(br, nd[0] - 1, 1); }
            if (nd[1] > 0) { addAu(nd[1] - 1, br, -1); addAu(br, nd[1] - 1, -1); }
            for (let q = 0; q < J.length; q++) addAu(br, J[q][0], -J[q][1]);
            b[br] += k0;
          } else {
            for (let q = 0; q < J.length; q++) { if (nd[0] > 0) addAu(nd[0] - 1, J[q][0], J[q][1]); if (nd[1] > 0) addAu(nd[1] - 1, J[q][0], -J[q][1]); }
            addB(nd[0], -k0); addB(nd[1], k0);
          }
          break;
        }
        case "D": {
          const Is = e.is || 2.5e-9, nVt = (e.n || 1.75) * 0.025852;
          const vcrit = nVt * Math.log(nVt / (Math.SQRT2 * Is));
          const raw = vn(x, nd[0]) - vn(x, nd[1]);
          // limited against the previous iterate (pnjlim)
          const vd = pnjlim(raw, e._vlast, nVt, vcrit);
          if (Math.abs(vd - raw) > 1e-9) limited = true;
          e._vlast = vd;
          const ex = Math.exp(Math.min(vd / nVt, 80));
          let id = Is * (ex - 1), gd = Is * ex / nVt + 1e-12;
          if (e.tt && !mode.dc) {
            // stored charge (SPICE TT): q = tt·id, its current dq/dt by the same rule as a capacitor's;
            // this is what makes a diode keep conducting backwards for a while (reverse recovery)
            const idAt = X => Is * (Math.exp(Math.min((vn(X, nd[0]) - vn(X, nd[1])) / nVt, 80)) - 1), k = e.tt / mode.h;
            id += k * (ID0 * id + ID1 * idAt(mode.prev) + (P2 ? ID2 * idAt(P2) : 0));
            gd += k * ID0 * (gd - 1e-12);
          }
          stampG(nd[0], nd[1], gd);
          const ieq = id - gd * vd;
          addB(nd[0], -ieq); addB(nd[1], ieq);
          break;
        }
        case "VDIODE": {
          const V0 = [vn(x, nd[0]), vn(x, nd[1])];
          stampNonlinear(nd, V => { const i = vdiodeI(e, V[0] - V[1]); return [i, -i]; }, V0);
          break;
        }
        case "BJT": {
          // junction voltages limited against the last iterate, the device linearized there
          const p = e.model.pol, vt = e.model.vt || VT, nVt = (e.model.nf || 1) * vt, vcrit = nVt * Math.log(nVt / (Math.SQRT2 * e.model.is));
          const V = nd.map(k => vn(x, k));
          const rbe = p * (V[1] - V[2]), rbc = p * (V[1] - V[0]);
          const vbe = pnjlim(rbe, e._vbe, nVt, vcrit), vbc = pnjlim(rbc, e._vbc, vt, vt * Math.log(vt / (Math.SQRT2 * e.model.is)));
          if (Math.abs(vbe - rbe) > 1e-9 || Math.abs(vbc - rbc) > 1e-9) limited = true;
          e._vbe = vbe; e._vbc = vbc;
          const vb = V[2] + p * vbe;
          stampJacobian(nd, Semi.bjtJ, [vb - p * vbc, vb, V[2]], e.model);
          if ((e.tf > 0 || e.tr > 0) && !mode.dc) {
            // the stored charges, stepped as a capacitor's: TF · If / qb between base and emitter and
            // TR · Ir between base and collector (turn-on delay, and the storage time of a saturated switch)
            const qs = W => Semi.bjtCharges(W, e.model, e.tf || 0, e.tr || 0), at = X => qs(nd.map(k => vn(X, k)));
            const h1 = at(mode.prev), h2 = P2 ? at(P2) : null;
            stampNonlinear(nd, W => {
              const q = qs(W), f = (ID0 * q[0] + ID1 * h1[0] + (h2 ? ID2 * h2[0] : 0)) / mode.h, r = (ID0 * q[1] + ID1 * h1[1] + (h2 ? ID2 * h2[1] : 0)) / mode.h;
              return [-r, f + r, -f];
            }, [vb - p * vbc, vb, V[2]], 1e-6);
          }
          break;
        }
        case "MOS":
          stampJacobian(nd, Semi.mosJ, nd.map(k => vn(x, k)), e.model);
          break;
        case "MOS4": {
          const V = nd.map(k => vn(x, k));
          stampNonlinear(nd, W => Semi.mosx(W, e.model), V, 1e-6);
          if (!mode.dc && e.model.p.cmey > 0) {
            // Meyer's gate capacitances, as SPICE takes them: the mean of this iterate's and the step
            // before's values, each a capacitor on the gate's voltage history (not charge-conserving)
            const C0 = Semi.mosMeyer(V, e.model), C1 = Semi.mosMeyer(nd.map(k => vn(mode.prev, k)), e.model);
            [nd[2], nd[0], nd[3]].forEach((o, j) => {
              const c = (C0[j] + C1[j]) / 2;
              if (!(c > 0) || o === nd[1]) return;
              const k = c / mode.h, hist = k * (ID1 * (vn(mode.prev, nd[1]) - vn(mode.prev, o)) + (P2 ? ID2 * (vn(P2, nd[1]) - vn(P2, o)) : 0));
              stampG(nd[1], o, ID0 * k);
              addB(nd[1], -hist); addB(o, hist);
            });
          }
          break;
        }
        case "OPAMP":
          stampNonlinear(nd, W => Semi.opamp(W, e.model, mode.dc, e._gain), nd.map(k => vn(x, k)), 1e-6);
          break;
        case "REG":
          stampNonlinear(nd, W => Semi.reg(W, e.model, e._gain, e._lin), nd.map(k => vn(x, k)), 1e-6);
          break;
        case "SHUNT":
          stampNonlinear(nd, W => Semi.shunt(W, e.model, e._gain, e._lin), nd.map(k => vn(x, k)), 1e-6);
          break;
        case "TRIODE": case "PENTODE": {
          const V0 = nd.map(k => vn(x, k));   // A, G, (G2,) K
          if (stampTube(e, nd, V0)) break;
          if (e.kind === "PENTODE") {
            stampNonlinear(nd, V => {
              const [ia, ig, ig2] = tubeCurrents(e, V[0] - V[3], V[1] - V[3], V[2] - V[3]);
              return [ia, ig, ig2, -(ia + ig + ig2)];
            }, V0);
            break;
          }
          stampNonlinear(nd, V => {
            const [ia, ig] = tubeCurrents(e, V[0] - V[2], V[1] - V[2]);
            return [ia, ig, -(ia + ig)];
          }, V0);
          break;
        }
        case "TIMER555": {
          // the latch held at its value at the start of the solve
          const q = latchOf(e, x0), tn = [nd[0], nd[2], nd[6], nd[7]];
          addAu(e.latch, e.latch, 1); b[e.latch] += q;
          stampNonlinear(tn, V => timerCurrents(V, q), tn.map(k => vn(x, k)), 1e-6);
          break;
        }
        case "GLOW": {
          const q = latchOf(e, x0);
          addAu(e.latch, e.latch, 1); b[e.latch] += q;
          stampNonlinear(nd, V => glowCurrents(V, e.model, q), nd.map(k => vn(x, k)), 1e-6);
          break;
        }
        case "RELAY": {
          // the latch held; the contacts, closed or open, are plain conductances
          const q = latchOf(e, x0), gon = 1 / e.model.ron, goff = 1 / e.model.roff;
          addAu(e.latch, e.latch, 1); b[e.latch] += q;
          for (let p = 2; p + 2 < nd.length; p += 3) { stampG(nd[p], nd[p + 1], q ? goff : gon); stampG(nd[p], nd[p + 2], q ? gon : goff); }
          break;
        }
        case "LDR": {
          // the light: x − a·max(i, 0) = (1 − a)·x₋₁, with a = 1 − e^(−h/τ) in a step and 1 at DC
          const m = e.model, l = e.light, il = (vn(x, nd[2]) - vn(x, nd[3])) / m.rs;
          let a = 1, xp = 0;
          if (!mode.dc) { xp = mode.prev[l]; a = 1 - Math.exp(-mode.h / (il > xp ? m.ton : m.toff)); }
          addAu(l, l, 1); b[l] += (1 - a) * xp;
          if (il > 0) { if (nd[2] > 0) addAu(l, nd[2] - 1, -a / m.rs); if (nd[3] > 0) addAu(l, nd[3] - 1, a / m.rs); }
          // the cell: g(light)·(vA − vB), linearized in the light too
          const xl = x[l], [g, dg] = ldrG(m, xl), vab = vn(x, nd[0]) - vn(x, nd[1]), k = dg * vab;
          stampG(nd[0], nd[1], g);
          if (nd[0] > 0) { addAu(nd[0] - 1, l, k); b[nd[0] - 1] += k * xl; }
          if (nd[1] > 0) { addAu(nd[1] - 1, l, -k); b[nd[1] - 1] -= k * xl; }
          break;
        }
      }
    };
    // The linear parts (resistors, capacitors at this step, inductors, transformers below
    // saturation, sources, controlled sources, relays held) stamp the same numbers on every
    // iteration of a solve: stamped once, kept, and copied back before the nonlinear parts stamp
    const part = linearSplit(circ, mode.dc);
    let linV = null, linB = null, linN = 0;
    const sol = new Float64Array(n);
    for (let iter = 0; iter < maxIter; iter++) {
      if (st) st.newton++;
      limited = false;
      if (!linV) {
        A.clear(); b.fill(0);
        for (let i = 1; i < circ.nNodes; i++) addA(i, i, gmin);
        // pseudo-transient (opts.pt: { g, x }): every node held to where it was by a conductance g,
        // as a capacitor C = g·h to ground holds it over a step h
        if (opts.pt) for (let i = 1; i < circ.nNodes; i++) { addA(i, i, opts.pt.g); b[i - 1] += opts.pt.g * opts.pt.x[i - 1]; }
        for (const e of part.lin) stampEl(e);
        linN = A.nnz; linV = A.vals.slice(0, linN); linB = b.slice();
      } else {
        A.vals.set(linV); if (A.nnz > linN) A.vals.fill(0, linN, A.nnz);
        b.set(linB);
      }
      for (const e of part.nl) stampEl(e);

      sol.set(b);
      if (!A.solve(sol)) return { ok: false, x, error: "singular matrix" };

      // Damped update on node voltages
      let maxDv = 0;
      const cap = circ.capped, free = circ.free;
      let limDv = 0;      // the largest step of a node a nonlinear part is on: the one the limit is for
      for (let i = 0; i < circ.nNodes - 1; i++) if (!(cap && cap[i])) { const d = Math.abs(sol[i] - x[i]); maxDv = Math.max(maxDv, d); if (!(free && free[i])) limDv = Math.max(limDv, d); }
      let scale = limDv > maxStep ? maxStep / limDv : 1;
      let conv = scale === 1;
      // an iteration that is not getting closer (bouncing across a device's
      // turn-on, say) takes half a step; so does a small one (under 10 mV) that is no
      // closer than two iterations ago (a two-step cycle, long and short updates in turn,
      // as a floating bridge's input can settle into; large swings, as gmin stepping
      // makes, are left alone)
      if (iter >= 8 && lastDv !== null && maxDv > 1e-4 && (maxDv > 0.9 * lastDv || (maxDv < 0.01 && lastDv2 !== null && maxDv > 0.9 * lastDv2))) { scale *= 0.5; conv = false; }
      for (let i = 0; i < n; i++) {
        let nx;
        if (cap && i < circ.nNodes - 1 && cap[i]) {
          const d = sol[i] - x[i];
          if (d * capDir[i] < 0) capStep[i] = Math.max(capStep[i] / 2, 1e-6);
          capDir[i] = d; nx = x[i] + Math.max(-capStep[i], Math.min(capStep[i], d));
        } else nx = x[i] + (sol[i] - x[i]) * scale;
        if (!isFinite(nx)) return { ok: false, x, error: "numerical overflow" };
        if (i < circ.nNodes - 1 && Math.abs(nx - x[i]) > 1e-6 + 1e-6 * Math.abs(nx)) conv = false;
        x[i] = nx;
      }
      if (!isFinite(maxDv)) return { ok: false, x, error: "numerical overflow" };
      let vmax = 0; for (let i = 0; i < circ.nNodes - 1; i++) vmax = Math.max(vmax, Math.abs(x[i]));
      const floor = 1e-4 + 5e-6 * Math.min(vmax, 1e3);   // (a behavioural node at a megavolt must not loosen it for all)
      if (conv && iter > 0 && !limited) return { ok: true, x, iter };
      // Round-off floor: with hundreds of volts on some nodes the solution can
      // settle into a microvolt-level wobble that never meets the 1 µV test
      // (whether it does depends on node order). An update below 100 µV (and
      // 5 ppm of the largest node voltage, up to 1 kV: a bridge's AC side, floating
      // on junctions of a few milliohms, wobbles more) that has stopped shrinking
      // for a few iterations is converged.
      if (maxDv < floor && lastDv !== null && maxDv > 0.5 * lastDv && !limited) { if (++stall >= 3) return { ok: true, x, iter }; }
      else stall = 0;
      lastDv2 = lastDv; lastDv = maxDv;
    }
    if (st) st.fails++;
    // the nodes Newton was still moving most when it gave up: where the circuit is stuck
    const far = [];
    for (let i = 0; i < circ.nNodes - 1; i++) far.push([Math.abs(sol[i] - x[i]), i + 1]);
    circ._stuck = far.sort((a, b) => b[0] - a[0]).slice(0, 3).filter(f => f[0] > 0).map(f => f[1]);
    return { ok: false, x, error: "no convergence" };
  }

  // The parts on the nodes a failed solve was stuck at, for the CAD to name and show: the ids
  // of their parts (an element's own id up to "#" or "~", its part's), devices before passives
  function stuckOf(circ) {
    const nodes = circ._stuck || [], seen = new Set(), parts = [];
    if (!nodes.length) return null;
    const on = e => (e.nodes || []).concat(e.ext || [], e.windings ? e.windings.flatMap(w => [w.a, w.b]) : []).some(k => nodes.includes(k));
    const passive = e => ["R", "C", "L", "V", "VSRC", "I"].includes(e.kind);
    circ.els.filter(e => e.id && on(e)).sort((a, b) => passive(a) - passive(b)).forEach(e => {
      const id = String(e.id).split(/[#~]/)[0];
      if (!seen.has(id)) { seen.add(id); parts.push(id); }
    });
    return { nodes, parts: parts.slice(0, 4) };
  }

  // A time step that still fails at the smallest subdivision: a long Newton run; then, as for the
  // DC operating point, gmin stepping: the step solved with a conductance from every node to ground,
  // from 1 S down to the usual 1 pS, each solve starting from the last, the steps
  // made finer where one fails (a power amplifier switched
  // on from cold has every junction swinging at once in its first microseconds)
  function lastResortStep(circ, xprev, hh, tNext) {
    const mode = { h: hh, t: tNext, prev: xprev, prev2: null };
    const r = newtonSolve(circ, xprev, mode, { gmin: 1e-12, maxIter: 400 });
    if (r.ok) return r.x;
    let x = xprev, g = 1, k = 10;
    const r0 = newtonSolve(circ, x, mode, { gmin: g, maxIter: 200 });
    if (r0.ok) {
      x = r0.x;
      while (g > 1e-12) {
        const gn = Math.max(g / k, 1e-12), rg = newtonSolve(circ, x, mode, { gmin: gn, maxIter: 200 });
        if (rg.ok) { x = rg.x; g = gn; k = Math.min(k * 2, 10); } else if ((k = Math.sqrt(k)) < 1.05) break;
      }
      if (g <= 1e-12) return x;
    }
    // then source stepping, as the DC operating point does: the sources brought up from nothing
    // within the step, each solve starting from the last (a circuit switched on from cold, its
    // supplies jumping to ±30 V across uncharged capacitors, drives every junction at once: Newton
    // from nothing then wanders off to absurd voltages, while a few hundred volts at a time it follows)
    let sc = 0, d = 0.1;
    const rs0 = newtonSolve(circ, xprev, mode, { gmin: 1e-12, maxIter: 200, srcScale: 0 });
    if (!rs0.ok) return null;
    x = rs0.x;
    while (sc < 1) {
      const sn = Math.min(1, sc + d), rs = newtonSolve(circ, x, mode, { gmin: 1e-12, maxIter: 200, srcScale: sn });
      if (rs.ok) { x = rs.x; sc = sn; d = Math.min(d * 2, 0.25); } else if ((d /= 4) < 1e-4) return null;
    }
    return x;
  }

  function dcOperatingPoint(circ) {
    let r = dcSolve(circ, new Array(circ.nUnk).fill(0));
    // a 555's latch set as its comparators find the solution, and solved again (an astable has no
    // DC state: after a few flips it keeps the last, and the transient starts it off)
    for (let k = 0; k < 4 && r.ok && circ.timers.length; k++) {
      const x = r.x.slice();
      let flipped = false;
      circ.timers.forEach(e => { const q = latchOf(e, x), n = latchNext(e, latchMargins(e, x), q); if (n !== q) { x[e.latch] = n; flipped = true; } });
      if (!flipped) break;
      const r2 = dcSolve(circ, x);
      if (!r2.ok) break;
      r = r2;
    }
    return r;
  }
  // from zero (with the 555 latches as x0 holds them). The solve leans on a 1 nS conductance from
  // every node to ground; a last Newton pass from its answer at 1 pS (as the transient uses, and
  // ngspice) takes it away: 1 nS on a grid fed through 1 MΩ at 50 V is 50 nA, 50 mV off its bias
  function dcSolve(circ, x0) {
    const r = dcSolveGmin(circ, x0);
    if (!r.ok) return r;
    const p = newtonSolve(circ, r.x, { dc: true }, { gmin: 1e-12 });
    return p.ok ? p : r;
  }
  function dcSolveGmin(circ, x0) {
    const zero = x0.map((v, i) => (circ.timers.some(e => e.latch === i) ? v : 0));
    circ.els.forEach(e => { delete e._vlast; delete e._vbe; delete e._vbc; });
    let r = newtonSolve(circ, zero, { dc: true }, { gmin: 1e-9 });
    if (r.ok) return r;
    // op-amps: a high-gain loop whose iterates bounce between the output's limits. Solved first
    // with stage two's gain cut a thousandfold (the open-loop gain a few hundred), then raised
    // step by step from each solution; regulators and shunt references the same way, by their
    // error amplifier's transconductance
    // (without their current limit, which comes back for a last solve)
    const amps = circ.els.filter(e => e.kind === "OPAMP" || e.kind === "REG" || e.kind === "SHUNT"), regs = amps.filter(e => e.kind !== "OPAMP");
    if (amps.length) {
      let xs = zero;
      regs.forEach(e => { e._lin = true; });
      for (const k of [1e-3, 1e-2, 1e-1, 1]) {
        amps.forEach(e => { e._gain = k; });
        r = newtonSolve(circ, xs, { dc: true }, { gmin: 1e-9 });
        if (!r.ok) break;
        xs = r.x;
      }
      amps.forEach(e => { delete e._gain; delete e._lin; });
      if (r.ok && regs.length) r = newtonSolve(circ, xs, { dc: true }, { gmin: 1e-9 });
      if (r.ok) return r;
    }
    // gmin stepping: from 1 S on every node down to 1 nS, the step shrinking where a solve fails
    // (a fixed tenfold ladder, giving up at the first failure, lost power amplifiers whose bias
    // spreader sits between two driver pairs: the iterates ran off past the rails)
    let x = zero, g = 1, k = 10, fails = 0;
    r = newtonSolve(circ, x, { dc: true }, { gmin: g });
    if (r.ok) {
      x = r.x;
      while (g > 1e-9 && fails < 12) {
        const gn = Math.max(g / k, 1e-9), rn = newtonSolve(circ, x, { dc: true }, { gmin: gn });
        if (rn.ok) { x = rn.x; g = gn; r = rn; k = Math.min(k * 2, 10); } else { k = Math.sqrt(k); if (++fails && k < 1.05) break; }
      }
      if (g <= 1e-9 && r.ok) return r;
    }
    // source stepping: the supplies raised from zero, the step cut to a quarter where a solve fails
    x = zero; fails = 0;
    let s = 0, ds = 0.05;
    while (s < 1) {
      const sn = Math.min(1, s + ds), rn = newtonSolve(circ, x, { dc: true }, { gmin: 1e-9, srcScale: sn });
      r = rn;
      if (rn.ok) { x = rn.x; s = sn; ds = Math.min(ds * 1.5, 0.2); } else { ds /= 4; if (ds < 1e-4 || ++fails > 40) break; }
    }
    if (r.ok) return r;
    const pt = dcPseudoTransient(circ, zero);
    return pt.ok ? pt : r;
  }
  // The last way to the operating point (ngspice's optran): a capacitor on every node to ground,
  // and the circuit let run to rest from nothing in growing steps. Each step is an easy problem (the
  // nodes held near where they were), so Newton follows the circuit where it cannot jump to the
  // answer in one go: a loop of high gain, a product of two voltages, a latch that must find its
  // side. The capacitors' conductance g = C/h starts at 1 S and falls fourfold a step (rises
  // fourfold after a step that fails); once it is below 1 nS and the nodes stop moving, a plain
  // solve from there must agree.
  function dcPseudoTransient(circ, x0) {
    let x = x0, g = 1, k = 4, steps = 0;
    const r = { ok: false, x, error: "no convergence" };
    while (steps++ < 600) {
      const rn = newtonSolve(circ, x, { dc: true }, { gmin: 1e-12, pt: { g, x } });
      if (!rn.ok) {
        // the step was too long: back to the last conductance, and a smaller stride from it
        g *= k; k = Math.sqrt(k); if (k < 1.01 || g > 1e6) break; g /= k; continue;
      }
      let dv = 0; for (let i = 0; i < circ.nNodes - 1; i++) dv = Math.max(dv, Math.abs(rn.x[i] - x[i]));
      x = rn.x;
      if (g < 1e-9 && dv < 1e-6) break;
      k = Math.min(k * 1.5, 4); g = Math.max(g / k, 1e-12);
    }
    const p = newtonSolve(circ, x, { dc: true }, { gmin: 1e-12 });
    return p.ok ? p : r;
  }

  // ---------------------------------------------------------------------------
  // Device readouts at a solution (used for the tube viewer and inspector)
  // ---------------------------------------------------------------------------
  function deviceState(e, x) {
    const v = e.nodes.map(k => vn(x, k));
    if (e.kind === "TRIODE") {
      const vak = v[0] - v[2], vgk = v[1] - v[2];
      const [ia, ig] = tubeCurrents(e, vak, vgk);
      return { vak, vgk, ia, ig };
    }
    if (e.kind === "PENTODE") {
      const vak = v[0] - v[3], vgk = v[1] - v[3], vg2k = v[2] - v[3];
      const [ia, ig, ig2] = tubeCurrents(e, vak, vgk, vg2k);
      return { vak, vgk, vg2k, ia, ig2, ig };
    }
    if (e.kind === "BJT") {
      // ext: the part's own C, B, E nodes when its base or emitter resistance puts the junctions on
      // inner nodes: the voltages read at the pins, and the dissipation of the whole part
      const [ic, ib] = Semi.bjt(v, e.model), p = e.model.pol, w = e.ext ? e.ext.map(k => vn(x, k)) : v;
      return { vce: p * (w[0] - w[2]), vbe: p * (w[1] - w[2]), ic: p * ic, ib: p * ib, pd: (w[0] - w[2]) * ic + (w[1] - w[2]) * ib };
    }
    if (e.kind === "MOS") { const [id] = Semi.mos(v, e.model), p = e.model.pol; return { vds: p * (v[0] - v[2]), vgs: p * (v[1] - v[2]), id: p * id, pd: (v[0] - v[2]) * id }; }
    if (e.kind === "MOS4") { const [id] = Semi.mosx(v, e.model), p = e.model.pol; return { vds: p * (v[0] - v[2]), vgs: p * (v[1] - v[2]), vbs: p * (v[3] - v[2]), id: p * id, pd: (v[0] - v[2]) * id }; }
    if (e.kind === "OPAMP") {
      // vd: IN+ − IN−; iout: out of the output pin; pd: the power the package dissipates
      // clip: how far the output stage is driven past its limit (V; > 0.05 is clipping)
      const I = Semi.opamp(v, e.model);
      return { vd: v[0] - v[1], vout: v[2], vs: v[3] - v[4], iout: -I[2], iq: I[3], pd: I.reduce((s, i, k) => s + i * v[k], 0), clip: Semi.opampClip(v, e.model) };
    }
    // a regulator: input − output (its headroom), output above REF, the output current and the
    // chip's dissipation; a shunt reference: K − A, REF − A, the cathode current
    if (e.kind === "REG") {
      const I = Semi.reg(v, e.model), p = e.model.pol;
      return { vin: p * (v[0] - v[2]), vout: p * (v[1] - v[2]), vio: p * (v[0] - v[1]), iout: -p * I[1], iin: p * I[0], pd: I.reduce((s, i, k) => s + i * v[k], 0) };
    }
    if (e.kind === "SHUNT") { const I = Semi.shunt(v, e.model); return { vka: v[0] - v[1], vref: v[2] - v[1], ik: I[0], pd: I.reduce((s, i, k) => s + i * v[k], 0) }; }
    if (e.kind === "VDIODE") { const vd = v[0] - v[1]; return { vd, i: vdiodeI(e, vd) }; }
    if (e.kind === "D") { const vd = v[0] - v[1]; return { vd, i: (e.is || 2.5e-9) * (Math.exp(Math.min(vd / ((e.n || 1.75) * 0.025852), 80)) - 1) }; }
    if (e.kind === "R") { const vd = v[0] - v[1]; return { vd, i: vd / e.r }; }
    if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L") return { i: x[e.branch], vd: v[0] - v[1] };
    if (e.kind === "C") return { vd: v[0] - v[1] };
    // a transformer: its magnetising current, and with a saturating core the flux as a share of the knee
    if (e.kind === "XFMR") { const im = magCurrent(e, x); return e.sat ? { im, flux: (e.plays ? coreLam(e, im, playsOf(e, x)) : coreFlux(e, im))[0] / e.sat.ls } : { im }; }
    if (e.kind === "I") return { i: e.i, vd: v[0] - v[1] };
    if (e.kind === "E") return { i: x[e.branch], vd: v[0] - v[1], vc: v[2] - v[3] };
    if (e.kind === "B") return { i: e.out === "v" ? x[e.branch] : bValue(e, x), vd: v[0] - v[1] };
    if (e.kind === "G") return { i: e.gm * (v[2] - v[3]), vd: v[0] - v[1], vc: v[2] - v[3] };
    if (e.kind === "GLOW") { const I = glowCurrents(v, e.model, latchOf(e, x)); return { q: latchOf(e, x), vd: v[0] - v[1], i: I[0] }; }
    // a relay: pulled in or not, and the voltage across the coil's resistance (its current × R)
    if (e.kind === "RELAY") return { q: latchOf(e, x), vs: v[0] - v[1] };
    // a vactrol's cell: its resistance, its light (A of LED current) and the current through it
    if (e.kind === "LDR") { const g = ldrG(e.model, x[e.light])[0]; return { r: 1 / g, light: x[e.light], vd: v[0] - v[1], i: g * (v[0] - v[1]) }; }
    if (e.kind === "TIMER555") {
      const q = latchOf(e, x), V = [v[0], v[2], v[6], v[7]], I = timerCurrents(V, q);
      return { q, vout: V[1] - V[0], iout: -I[1], idis: I[2], vcc: V[3] - V[0], pd: I.reduce((s, i, k) => s + i * V[k], 0) };
    }
    return {};
  }

  // Current flowing from each node into an element: [[node, i], ...]. Capacitors
  // carry none at DC and none on average over a settled window.
  function terminalCurrents(e, x) {
    const nd = e.nodes, v = nd.map(k => vn(x, k)), two = i => [[nd[0], i], [nd[1], -i]];
    switch (e.kind) {
      case "R": return two((v[0] - v[1]) / Math.max(e.r, 1e-6));
      case "C": return two(0);
      case "I": return two(e.i);
      case "L": case "V": case "VSRC": case "E": return two(x[e.branch]);
      case "G": return two(e.gm * (v[2] - v[3]));
      case "B": return two(e.out === "v" ? x[e.branch] : bValue(e, x));
      case "D": return two(deviceState(e, x).i);
      case "VDIODE": return two(deviceState(e, x).i);
      case "XFMR": { const out = []; e.windings.forEach((w, j) => { const i = x[e.branches[j]]; out.push([w.a, i], [w.b, -i]); }); return out; }
      case "TRIODE": { const s = deviceState(e, x); return [[nd[0], s.ia], [nd[1], s.ig], [nd[2], -(s.ia + s.ig)]]; }
      case "PENTODE": { const s = deviceState(e, x); return [[nd[0], s.ia], [nd[1], s.ig], [nd[2], s.ig2], [nd[3], -(s.ia + s.ig + s.ig2)]]; }
      case "BJT": return Semi.bjt(v, e.model).map((i, k) => [nd[k], i]);
      case "MOS": return Semi.mos(v, e.model).map((i, k) => [nd[k], i]);
      case "MOS4": return Semi.mosx(v, e.model).map((i, k) => [nd[k], i]);
      case "TIMER555": { const I = timerCurrents([v[0], v[2], v[6], v[7]], latchOf(e, x)); return [[nd[0], I[0]], [nd[2], I[1]], [nd[6], I[2]], [nd[7], I[3]]]; }
      case "OPAMP": return Semi.opamp(v, e.model).map((i, k) => [nd[k], i]);
      case "GLOW": return two(glowCurrents(v, e.model, latchOf(e, x))[0]);
      case "RELAY": return relayCurrents(v, e.model, latchOf(e, x)).map((i, k) => [nd[k], i]).slice(2);
      case "LDR": return two(ldrG(e.model, x[e.light])[0] * (v[0] - v[1]));
      case "REG": return Semi.reg(v, e.model).map((i, k) => [nd[k], i]);
      case "SHUNT": return Semi.shunt(v, e.model).map((i, k) => [nd[k], i]);
      default: return [];
    }
  }
  // flat list [id, node, i, ...] of the terminal currents of every element with an id;
  // called again with the same list, adds to it (for averaging over a window)
  function currentsOf(circ, x, out) {
    let k = 0;
    circ.els.forEach(e => {
      if (!e.id) return;
      terminalCurrents(e, x).forEach(([node, i]) => {
        if (out.length <= k) out.push(e.id, node, 0);
        out[k + 2] += i; k += 3;
      });
    });
    return out;
  }

  // the terminal currents at one instant of the transient, for the CAD's animation: as
  // currentsOf, and a capacitor's C·dV/dt from the step before (h seconds earlier)
  function instantCurrents(circ, x, xp, h, vals) {
    let k = 0;
    circ.els.forEach(e => {
      if (!e.id) return;
      const tc = e.kind === "C" ? (() => { const nd = e.nodes, i = (chargeAt(e, vn(x, nd[0]) - vn(x, nd[1])) - chargeAt(e, vn(xp, nd[0]) - vn(xp, nd[1]))) / h; return [[nd[0], i], [nd[1], -i]]; })() : terminalCurrents(e, x);
      tc.forEach(([, i]) => { vals[k++] = i; });
    });
    return vals;
  }

  // ---------------------------------------------------------------------------
  // Minimal polynomial extrapolation over period-to-period states x0..x(k+1):
  // estimates the fixed point of the period map when slow modes decay
  // geometrically (including oscillatory pairs).
  // ---------------------------------------------------------------------------
  function mpeExtrapolate(states) {
    const k = states.length - 2, n = states[0].length;
    if (k < 1) return null;
    const u = [];
    for (let j = 0; j <= k; j++) { const d = new Float64Array(n); for (let i = 0; i < n; i++) d[i] = states[j + 1][i] - states[j][i]; u.push(d); }
    // scale rows so volts and amps weigh comparably
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) { let m = 0; for (let j = 0; j <= k; j++) m = Math.max(m, Math.abs(u[j][i])); w[i] = m > 0 ? 1 / m : 0; }
    // least squares: sum_j c_j u_j = -u_k  (j < k)
    const M = new Array(k * k).fill(0), rhs = new Array(k).fill(0);
    for (let a = 0; a < k; a++) {
      for (let b2 = 0; b2 < k; b2++) { let s = 0; for (let i = 0; i < n; i++) s += u[a][i] * w[i] * u[b2][i] * w[i]; M[a * k + b2] = s; }
      let s = 0; for (let i = 0; i < n; i++) s += u[a][i] * w[i] * u[k][i] * w[i]; rhs[a] = -s;
    }
    for (let a = 0; a < k; a++) M[a * k + a] *= 1 + 1e-10;
    if (!solveLinear(M, rhs, k)) return null;
    const c = rhs.concat([1]);
    const sum = c.reduce((s, v) => s + v, 0);
    if (!isFinite(sum) || Math.abs(sum) < 1e-12) return null;
    const out = new Array(n).fill(0);
    for (let j = 0; j <= k; j++) { const g = c[j] / sum; for (let i = 0; i < n; i++) out[i] += g * states[j][i]; }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Self-heating of transistors (electro-thermal). A BJT element with therm { ta, rjc, rca, cc, sink,
  // rsa, cs } and model0 (its model at 25 °C) runs at its own junction temperature: its dissipation
  // flows through the thermal resistance junction→case rjc, and from the case either to the air
  // (rca, free air) or through 0.5 °C/W of insulator to a heatsink shared by every part with the same
  // sink name (rsa to the air), so a bias transistor on the output transistors' heatsink follows
  // their temperature. IS, hFE, VT and the leakage follow the temperature as the CAD's Temperature
  // field does (bjtAtT). ta: the ambient (the part's Temperature field).
  // ---------------------------------------------------------------------------
  // KT_SCALE: the engine's kT/q at its 25 °C (25.852 mV) is SPICE's at 27 °C, so the band gap's
  // term takes kelvins on that scale (the SPICE export writes temperatures the same way)
  const T0K = 298.15, K_Q = 8.617333e-5, KT_SCALE = 298.15 / 300.15, R_CS = 0.5, RUNAWAY = 250;
  // A Gummel-Poon model at tC (°C) from its data at tnom (25 °C unless the model says), SPICE's law:
  // IS·(T/Tnom)^XTI·e^(EG/k·(1/Tnom − 1/T)), BF and BR ·(T/Tnom)^XTB, ISE and ISC with their own
  // emission coefficients and over (T/Tnom)^XTB, VT = kT/q. The CAD's own parts leave XTI, EG and XTB
  // out: 3, 1.11 eV (0.67 germanium) and 1.5 then; an imported model carries its own (XTB 0 if unset).
  function bjtAtT(m0, tC) {
    const T = tC + 273.15, Tn = (m0.tnom === undefined ? 25 : m0.tnom) + 273.15, r = T / Tn, lr = Math.log(r);
    const eg = m0.eg !== undefined ? m0.eg : m0.ge ? 0.67 : 1.11, xti = m0.xti !== undefined ? m0.xti : 3, xtb = m0.xtb !== undefined ? m0.xtb : 1.5;
    const fl = eg / K_Q * KT_SCALE * (1 / Tn - 1 / T) + xti * lr, bfac = Math.exp(xtb * lr), vt0 = m0.vt0 || 0.025852 * Tn / T0K;
    const out = Object.assign({}, m0, { is: m0.is * Math.exp(fl), bf: m0.bf * bfac, br: (m0.br || 1) * bfac, vt: vt0 * r, icbo: m0.icbo ? m0.icbo * Math.pow(2, (T - Tn) / 10) : 0, t: tC });
    if (m0.ise) out.ise = m0.ise * Math.exp(fl / (m0.ne || 1.5)) / bfac;
    if (m0.isc) out.isc = m0.isc * Math.exp(fl / (m0.nc || 2)) / bfac;
    return out;
  }
  const heatedBjts = circ => circ.els.filter(e => e.therm && e.model0 && e.kind === "BJT");
  const setTemp = (e, tC) => { e._tj = tC; e.model = Object.assign(bjtAtT(e.model0, tC), { pol: e.model.pol }); };
  // the dissipation of each heated part at x (W, never below 0)
  const heatOf = (hot, x) => hot.map(e => Math.max(0, deviceState(e, x).pd || 0));
  // each sink's ambient, thermal resistance and capacitance: its parts' highest ambient, lowest Rsa, the sum of their sink shares
  function sinksOf(hot) {
    const S = new Map();
    hot.forEach(e => {
      const k = e.therm.sink; if (!k) return;
      const g = S.get(k) || { ta: -Infinity, rsa: Infinity, cs: 0 };
      g.ta = Math.max(g.ta, e.therm.ta); g.rsa = Math.min(g.rsa, e.therm.rsa > 0 ? e.therm.rsa : 1.5); g.cs = Math.max(g.cs, e.therm.cs || 100);
      S.set(k, g);
    });
    return S;
  }
  // the junction temperatures that powers P give in the steady state: [tj per part], and each sink's temperature
  function thermalSteady(hot, P) {
    const S = sinksOf(hot), sum = new Map();
    hot.forEach((e, i) => { if (e.therm.sink) sum.set(e.therm.sink, (sum.get(e.therm.sink) || 0) + P[i]); });
    const ts = new Map(); S.forEach((g, k) => ts.set(k, g.ta + g.rsa * (sum.get(k) || 0)));
    return { tj: hot.map((e, i) => (e.therm.sink ? ts.get(e.therm.sink) + (e.therm.rjc + R_CS) * P[i] : e.therm.ta + (e.therm.rjc + e.therm.rca) * P[i])), ts };
  }
  // The operating point with the parts at the temperatures their own dissipation gives: solved
  // again at each new set of temperatures until they move by under 0.01 °C (a damped step where
  // they swing). extra: { id: W } added to a part's dissipation (the signal's share, from the run
  // before). Returns { x, runaway: the part past 250 °C, or null } or null when a solve fails.
  function thermalDC(circ, x, extra) {
    const hot = heatedBjts(circ);
    if (!hot.length) return { x, runaway: null };
    let w = 1, last = Infinity;
    for (let k = 0; k < 80; k++) {
      const P = heatOf(hot, x).map((p, i) => p + Math.max(0, (extra && extra[hot[i].id]) || 0)), { tj } = thermalSteady(hot, P);
      let d = 0; hot.forEach((e, i) => { d = Math.max(d, e._tj === undefined ? Infinity : Math.abs(tj[i] - e._tj)); });
      const hotOne = hot.find((e, i) => tj[i] > RUNAWAY);
      if (hotOne) {
        // held at 250 °C, the hottest the models stand for: the operating point there, flagged
        hot.forEach((e, i) => setTemp(e, Math.min(tj[i], RUNAWAY)));
        let r = newtonSolve(circ, x, { dc: true }, { gmin: 1e-12 });
        if (!r.ok) r = dcSolve(circ, x);
        return r.ok ? { x: r.x, runaway: hotOne } : null;
      }
      if (d < 0.01) break;
      if (d > 0.7 * last) w = Math.max(0.2, w / 2);   // the temperatures swing or creep: smaller steps
      last = d;
      hot.forEach((e, i) => setTemp(e, e._tj === undefined ? tj[i] : e._tj + w * (tj[i] - e._tj)));
      let r = newtonSolve(circ, x, { dc: true }, { gmin: 1e-12 });
      if (!r.ok) r = dcSolve(circ, x);
      if (!r.ok) return null;
      x = r.x;
    }
    return { x, runaway: null };
  }
  // The temperatures through a power-on run: every part starts at its ambient. The junction sits
  // rjc·P above its case at once (its own capacitance is tiny); a case in free air warms toward
  // ta + rca·P with its time constant rca·cc, a heatsink toward ta + rsa·ΣP with rsa·cs (its parts'
  // cases 0.5 °C/W above it). Each step moves them exactly as a single RC would over that step.
  function thermalClock(hot) {
    const S = sinksOf(hot), ts = new Map(), tc = hot.map(e => e.therm.ta);
    S.forEach((g, k) => ts.set(k, g.ta));
    hot.forEach(e => setTemp(e, e.therm.ta));
    return (P, dt) => {
      const sum = new Map();
      hot.forEach((e, i) => { if (e.therm.sink) sum.set(e.therm.sink, (sum.get(e.therm.sink) || 0) + P[i]); });
      S.forEach((g, k) => { const tau = g.rsa * g.cs, end = g.ta + g.rsa * (sum.get(k) || 0); ts.set(k, end + (ts.get(k) - end) * Math.exp(-dt / tau)); });
      hot.forEach((e, i) => {
        let tj;
        if (e.therm.sink) tj = ts.get(e.therm.sink) + (e.therm.rjc + R_CS) * P[i];
        else {
          const tau = e.therm.rca * (e.therm.cc || 0.1), end = e.therm.ta + e.therm.rca * P[i];
          tc[i] = end + (tc[i] - end) * Math.exp(-dt / tau);
          tj = tc[i] + e.therm.rjc * P[i];
        }
        tj = Math.min(tj, RUNAWAY);
        if (Math.abs(tj - e._tj) > 0.01) setTemp(e, tj);
      });
      return ts;
    };
  }
  // the temperatures a run ended at, { id: °C }, to hand to the frequency-response analyses (opts.tj)
  const tempsOf = circ => { const o = {}; heatedBjts(circ).forEach(e => { o[e.id] = e._tj; }); return o; };
  // a netlist's heated parts set to temperatures tj ({ id: °C }): for acSweep, loopGain, noiseSweep
  function withTemps(netlist, tj) {
    if (!tj) return netlist;
    return Object.assign({}, netlist, { elements: netlist.elements.map(e => (e.therm && e.model0 && tj[e.id] !== undefined ? Object.assign({}, e, { model: Object.assign(bjtAtT(e.model0, tj[e.id]), { pol: e.model.pol }) }) : e)) });
  }

  // ---------------------------------------------------------------------------
  // Full analysis: DC operating point + periodic steady-state transient
  //   opts.warm: where the settling starts instead of the DC point, the result.warm of a run of the
  //   same circuit with other part values (tolerance runs); it changes how long the run takes, not
  //   where it settles. result.warm: the settled state at a period's start, before the capture.
  // ---------------------------------------------------------------------------
  // Inrush limiters (NTC thermistors) and lamps: an R element with ntc { r25, k, n } runs at its self-heated
  // resistance (a lamp's filament, n < 0, at R = max(r25, k·I^−n), its cold resistance r25 the floor)
  // resistance R = min(r25, k·I^−n) for its rms current I (the makers' law). The body's thermal time
  // constant (tens of seconds) is far longer than any capture, so in the steady state it holds one
  // value through the cycle: the run is repeated from its last settled state, R moved partway toward
  // that law each time, until R changes by under 1 %. result.ntc: { id: { r, i } }, the resistance
  // each ran at and its rms current. The power-on transient (startup) keeps r25: the part starts cold.
  function simulate(netlist, opts) {
    if (netlist.elements.some(e => e.therm && e.model0) && !netlist.elements.some(e => e.ntc)) return simulateHeated(netlist, opts);
    if (!netlist.elements.some(e => e.ntc)) return simulateOnce(netlist, opts);
    opts = opts || {};
    const t0 = Date.now(), budget = opts.budgetMs || 2500;
    const elements = netlist.elements.map(e => (e.ntc ? Object.assign({}, e) : e)), hot = elements.filter(e => e.ntc);
    let r = null, warm = opts.warm;
    for (let it = 0; it < 12; it++) {
      const run = w => simulateOnce(Object.assign({}, netlist, { elements }), Object.assign({}, opts, { warm: w, budgetMs: Math.max(budget - (Date.now() - t0), budget / 4), onProgress: it ? undefined : opts.onProgress }));
      r = run(warm);
      // a warm start that does not converge (a stiff rectifier caught mid-recovery) runs again from the DC point
      if (!r.ok && warm && warm !== opts.warm) r = run(opts.warm);
      if (!r.ok) return r;
      r.ntc = {};
      let moved = 0;
      hot.forEach(e => {
        // an NTC's law falls with the current, held under r25; a lamp's tungsten (n < 0) rises with it, held over its cold r25
        const i = rmsCurrent(r, e), law = e.ntc.k * Math.pow(Math.max(i, 1e-12), -e.ntc.n), want = e.ntc.n < 0 ? Math.max(e.ntc.r25, law) : Math.min(e.ntc.r25, law);
        r.ntc[e.id] = { r: e.r, i };
        // a damped step in log R: the current falls as R rises, which a full step would overshoot
        const next = Math.exp(Math.log(e.r) + 0.6 * (Math.log(want) - Math.log(e.r)));
        moved = Math.max(moved, Math.abs(Math.log(want / e.r)));
        e.r = next;
      });
      if (moved < 0.01) break;
      warm = r.warm;
    }
    return r;
  }
  // Self-heated transistors with a signal: the operating point's temperatures come from the parts'
  // idle dissipation (result.thermal[id].tjIdle); the signal adds its own (a class-AB output stage at full power runs far
  // hotter than at idle), and the temperatures follow the average over the capture, as a bench
  // amplifier's do once warm. The run is repeated from its settled state with each part's extra
  // dissipation until the temperatures move by under 1 °C (three runs at most).
  function simulateHeated(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), budget = opts.budgetMs || 2500;
    let r = simulateOnce(netlist, opts);
    const first = r;
    for (let it = 0; it < 2 && r.ok && r.thermal && r.tran; it++) {
      const extra = {}; let moved = 0;
      Object.keys(r.thermal).forEach(id => { const th = r.thermal[id]; extra[id] = Math.max(0, th.pAvg - th.p); moved = Math.max(moved, Math.abs(th.tjAvg - th.tj)); });
      if (moved < 1) break;
      const r2 = simulateOnce(netlist, Object.assign({}, opts, { warm: r.warm, thermExtra: extra, budgetMs: Math.max(budget - (Date.now() - t0), budget / 4), onProgress: undefined }));
      if (!r2.ok) break;
      r = r2;
    }
    // tjIdle: each part's temperature with no signal, from the first run
    if (r.ok && r.thermal && first.thermal) Object.keys(r.thermal).forEach(id => { r.thermal[id].tjIdle = first.thermal[id] ? first.thermal[id].tj : r.thermal[id].tj; });
    return r;
  }
  // an R element's rms current over the capture (its DC current without one)
  function rmsCurrent(r, e) {
    const [a, b] = e.nodes, T = r.tran;
    if (T && T.samples > 1) {
      const va = T.nodes[a], vb = T.nodes[b], n = T.samples - 1;
      let s = 0; for (let k = 0; k < n; k++) { const v = (a ? va[k] : 0) - (b ? vb[k] : 0); s += v * v; }
      return Math.sqrt(s / n) / e.r;
    }
    return Math.abs(r.dc.nodes[a] - r.dc.nodes[b]) / e.r;
  }

  function simulateOnce(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now();
    const budgetMs = opts.budgetMs || 2500;
    const circ = buildCircuit(netlist);
    const nodeCount = circ.nNodes;
    const result = { ok: false, nodeCount, warnings: [] };
    if (nodeCount < 2) { result.error = "Circuit is empty"; return result; }
    // readiness 0…1 for opts.onProgress: DC 5 %, settling to 88 %, the capture to 100 %;
    // never goes back, and is reported at most every 1 % and 100 ms
    let progDone = 0, progAt = 0;
    const progress = f => {
      if (!opts.onProgress || !(f > progDone)) return;
      progDone = f;
      const now = Date.now();
      if (f < 1 && now - progAt < (opts.progressMs !== undefined ? opts.progressMs : 100)) return;
      progAt = now; opts.onProgress(f);
    };

    const dc = dcOperatingPoint(circ);
    if (!dc.ok) {
      result.error = dc.error === "singular matrix"
        ? "Circuit cannot be solved: check for voltage sources wired in parallel or shorted, or a supply with no return path"
        : "DC operating point did not converge (" + dc.error + ")";
      if (dc.error !== "singular matrix") result.stuck = stuckOf(circ);
      return result;
    }
    const hotParts = heatedBjts(circ);
    if (hotParts.length) {
      const th = thermalDC(circ, dc.x, opts.thermExtra);
      if (!th) { result.error = "DC operating point did not converge with the transistors at their own temperatures"; result.stuck = stuckOf(circ); return result; }
      dc.x = th.x;
      hotParts.forEach(e => { if (e.therm.tjmax && e._tj > e.therm.tjmax && e !== th.runaway) result.warnings.push(`${e.id.split("#")[0]} runs at ${Math.round(e._tj)} °C, past its ${e.therm.tjmax} °C maximum: a bigger heatsink, or less dissipation`); });
      if (th.runaway) result.warnings.push(`Overheating: ${th.runaway.id.split("#")[0]} passes ${RUNAWAY} °C, held there (thermal runaway, its heat raising its current, or more dissipation than its cooling takes): more emitter resistance, the bias transistor on its heatsink, or a bigger heatsink`);
    }
    result.dc = { nodes: [0].concat(dc.x.slice(0, nodeCount - 1)), devices: {} };
    circ.els.forEach(e => { if (e.id) result.dc.devices[e.id] = Object.assign(result.dc.devices[e.id] || {}, { [e.kind === "VDIODE" ? e.part || "d" : "main"]: deviceState(e, dc.x) }); });
    result.dc.currents = currentsOf(circ, dc.x, []);
    progress(0.05);

    // Time base from sources
    const freqs = circ.els.filter(e => e.kind === "VSRC" && e.freq > 0 && e.amp !== 0).map(e => e.freq);
    const fMin = freqs.length ? Math.min.apply(null, freqs) : 0;
    const fMax = freqs.length ? Math.max.apply(null, freqs) : 0;
    const window = opts.window || (fMin ? Math.max(1 / fMin, 2 / fMax, 0.002) : 0.005);
    let period = fMin ? 1 / fMin : window;
    // whole number of base periods so harmonic analysis of the capture is exact
    let capture = fMin ? period * Math.max(1, Math.ceil(window / period - 1e-9)) : window;
    let h = fMax ? Math.min(1 / (fMax * 160), capture / 600) : capture / 400;
    h = Math.max(h, capture / 8000);
    let stepsPerPeriod = Math.max(1, Math.round(period / h));
    h = period / stepsPerPeriod;
    let captureSteps = Math.round(capture / h);

    let x = (opts.warm && opts.warm.length === dc.x.length ? Array.from(opts.warm) : dc.x.slice()), t = 0;
    // BDF2 history: the solution one step before x and that step's length (reset whenever
    // the step changes, the state is extrapolated, or a step had to be subdivided)
    let xBack = null, hBack = 0;
    // a step that does not converge is retried as 8 sub-steps, and each of those
    // again as 8 (h/64), before the run gives up
    const hk = {};   // x₋₃ for the step refinement
    const solveStep = (xprev, tNext, hh, depth) => {
      const gear = !depth && xBack && Math.abs(hBack - hh) <= 1e-9 * hh;
      const r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev, prev2: gear ? xBack : null }, { gmin: 1e-12 });
      if (r.ok) {
        if (depth) return r.x;
        const xr = gear && refineStep(circ, refineHist(hk, gear, xBack, xprev), r.x, tNext, hh, 0, hk.tol);
        keepHist(hk, gear, xBack, xprev); xBack = xprev; hBack = hh;
        return xr || r.x;
      }
      // the last resort: more iterations (a source that steps at t = 0, such as the mains starting at
      // its peak, charges a rectifier's reservoir through a winding: the damped Newton walks the
      // node up 15 V an iteration, and halves that once the steps stop shrinking)
      if ((depth || 0) >= 2) return lastResortStep(circ, xprev, hh, tNext);
      let xs = xprev;
      for (let k = 1; k <= 8; k++) {
        xs = solveStep(xs, tNext - hh + hh * k / 8, hh / 8, (depth || 0) + 1);
        if (!xs) return null;
      }
      if (!depth) xBack = null;
      return xs;
    };
    const step = (xprev, tNext, hh) => timerStep(circ, solveStep, xprev, tNext, hh);
    let peak = null;   // when set, each unknown's largest magnitude over the steps run
    const runPeriod = (hh, nSteps) => {
      for (let s = 0; s < nSteps; s++) {
        t += hh;
        const nx = step(x, t, hh);
        if (!nx) return false;
        x = nx;
        if (peak) for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak[i]) peak[i] = a; }
      }
      return true;
    };
    // per-node relative change (1 V floor): a node sitting near 0 V, such as an
    // output after a coupling cap, must settle to millivolts, a 400 V rail to ~0.1 V
    const periodChange = (a, b) => {
      let m = 0;
      for (let i = 0; i < nodeCount - 1; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / (Math.abs(a[i]) + 1));
      return m;
    };

    // Settle to periodic steady state. Coarse steps (the slow supply/coupling
    // dynamics need no audio resolution), and every few periods a vector
    // extrapolation (MPE, Skelboe's method) jumps over slow decays such as the
    // LC ringing of a choke-input supply.
    let settled = !freqs.length, periods = 0, extrapolations = 0;
    const maxPeriods = opts.maxPeriods || 400;
    if (freqs.length) {
      const coarseSteps = Math.max(1, Math.min(stepsPerPeriod, Math.round(period / Math.min(period / 200, 1 / (20 * fMax)))));
      const hc = period / coarseSteps;
      // Shooting: the steady state is the state s that one period maps onto itself, Φ(s) = s, found
      // by Newton's method (Newton–GMRES; Aprille and Trick, Telichevesky and Kundert). Φ's Jacobian
      // is never formed: GMRES needs it only along a few directions v, each one period from s + εv,
      // and stops once its own residual estimate is a tenth of the start. The work follows the number
      // of slow modes (coupling, cathode and filter capacitors, transformer magnetising currents), not
      // the circuit's size, and the answer does not hang on rounding as an extrapolation does. A step
      // that does not lower the residual is damped (Levenberg–Marquardt); when Newton stops gaining,
      // or the time runs short, the plain settling below carries on from the best state found.
      if (!opts.noShooting) {
        // the state: node voltages (the capacitors' charge) and inductor and winding currents; a
        // voltage source's current is no state (each step makes it anew), so it is neither moved nor compared
        const st = [];
        for (let i = 0; i < nodeCount - 1; i++) st.push(i);
        circ.els.forEach(e => { if (e.kind === "L") st.push(e.branch); else if (e.kind === "XFMR") e.branches.forEach(b => st.push(b)); else if (LATCHED.has(e.kind)) st.push(e.latch); else if (e.kind === "LDR") st.push(e.light); });
        // each part of the state weighed by its size over a period (a winding's current may pass zero
        // just as the period starts): one period run while the peaks are noted
        peak = new Float64Array(x.length);
        if (!runPeriod(hc, coarseSteps)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; }
        periods++;
        const pk = peak; peak = null;
        const nU = st.length, tB = t, target = 5e-5, D = st.map(i => (i < nodeCount - 1 ? 1 + pk[i] : 1e-3 + pk[i]));
        const base = x.slice();   // the whole solution the state goes into (voltage source currents as a first guess)
        const timeUp = () => Date.now() - t0 > budgetMs * 0.6 || periods >= maxPeriods - 2;
        // one period from state s: a function of s alone, so the period starts with a backward-Euler step
        // (which leaves slow modes a bias of the order of that step's error, as the plain settling has too)
        const phiOf = s => { x = base.slice(); st.forEach((g, i) => { x[g] = s[i]; }); xBack = null; t = tB; periods++; return runPeriod(hc, coarseSteps) ? st.map(g => x[g]) : null; };
        const resid = (ph, s) => ph.map((v, i) => (v - s[i]) / D[i]);
        const dot = (a, b) => { let v = 0; for (let i = 0; i < a.length; i++) v += a[i] * b[i]; return v; };
        const norm = v => Math.sqrt(dot(v, v));
        // the small least squares of GMRES and of the damped step: min ‖β e₁ − H y‖² + μ‖y‖²
        const lsq = (H, beta, mu) => {
          const k = H.length, M = new Float64Array(k * k), g = new Float64Array(k);
          for (let a = 0; a < k; a++) { for (let b = 0; b < k; b++) { let v = 0; for (let q = 0; q <= k; q++) v += (H[a][q] || 0) * (H[b][q] || 0); M[a * k + b] = v; } g[a] = beta * H[a][0]; }
          let dmax = 0; for (let a = 0; a < k; a++) dmax = Math.max(dmax, M[a * k + a]);
          for (let a = 0; a < k; a++) M[a * k + a] += mu * dmax + 1e-14 * dmax;
          return solveLinear(M, g, k) ? g : null;
        };
        // GMRES stops at a tenth of the residual; a step that then gains too little (a lightly damped slow
        // pair, as a push-pull amplifier's coupling capacitors, grid leaks and feedback make: its
        // (J − I) all but singular) is retried with GMRES to a hundredth before the plain settling takes over
        let gtol = 0.1;
        let s = st.map(g => x[g]), ph = phiOf(s), best = null, startRes = 0, converged = false, lastStep = Infinity;
        while (ph && !timeUp()) {
          const r = resid(ph, s), beta = norm(r);
          if (!best || beta < best.res) best = { s: s.slice(), res: beta };
          // settled: the period changes little, and so did the last Newton correction (a slow mode can change
          // little per period while far off: the distance is about the residual over (1 − λ))
          if (periodChange(ph, s) < target && (lastStep < 1e-4 || beta < 1e-9)) { converged = true; break; }
          startRes = startRes || beta;
          if (startRes > target) progress(0.05 + 0.83 * Math.max(0, Math.min(1, Math.log(startRes / beta) / Math.log(startRes / target))));
          // GMRES (Arnoldi) on (J − I) δ = −r, in the scaled units
          const V = [r.map(v => -v / beta)], H = [];
          let y = null;
          for (let j = 0; j < Math.min(nU, 60) && !timeUp(); j++) {
            const eps = 1e-4, pv = phiOf(s.map((sv, i) => sv + eps * D[i] * V[j][i]));
            if (!pv) break;
            const w = pv.map((v, i) => (v - ph[i]) / D[i] / eps - V[j][i]), h = [];
            for (let pass = 0; pass < 2; pass++) for (let q = 0; q <= j; q++) { const d = dot(V[q], w); h[q] = (h[q] || 0) + d; for (let i = 0; i < nU; i++) w[i] -= d * V[q][i]; }
            h[j + 1] = norm(w); H.push(h);
            y = lsq(H, beta, 0);
            if (!y) break;
            let rho = 0; for (let q = 0; q <= H.length; q++) { let v = q === 0 ? beta : 0; for (let a = 0; a < H.length; a++) v -= (H[a][q] || 0) * y[a]; rho += v * v; }
            if (Math.sqrt(rho) < gtol * beta || h[j + 1] < 1e-12) break;
            V.push(w.map(v => v / h[j + 1]));
          }
          if (!y) break;
          // the Newton step; damped while it does not lower the residual
          let moved = false;
          for (const mu of [0, 1e-4, 1e-3, 1e-2, 1e-1]) {
            const yy = mu ? lsq(H, beta, mu) : y;
            if (!yy || timeUp()) break;
            const sT = s.slice(); for (let a = 0; a < yy.length; a++) for (let i = 0; i < nU; i++) sT[i] += D[i] * V[a][i] * yy[a];
            const pT = phiOf(sT);
            if (pT && norm(resid(pT, sT)) < beta) { lastStep = 0; for (let i = 0; i < nU; i++) lastStep = Math.max(lastStep, Math.abs(sT[i] - s[i]) / D[i]); s = sT; ph = pT; moved = true; break; }
          }
          if (!moved || norm(resid(ph, s)) > 0.8 * beta) { if (gtol > 0.01) { gtol = 0.01; continue; } break; }   // Newton no longer gains: the plain settling takes over
        }
        // carry on from the steady state found (or the nearest to it): one more period, so that x
        // is again the whole solution, at the period's end
        const end = converged ? s : best && best.s;
        if (end) { phiOf(end); t = tB + period; }
        if (converged) settled = true;
        result.shooting = { converged, periods };
      }
      let hist = [x.slice()], lastChange = Infinity, worst = 0;
      while (!settled && periods < maxPeriods) {
        const start = x.slice();
        if (!runPeriod(hc, coarseSteps)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; }
        periods++;
        const change = periodChange(x, start);
        // distance to steady state estimated from the decay rate per period
        // (a slow coupling-cap RC can change little per period yet be far off)
        const lambda = isFinite(lastChange) && lastChange > 0 ? Math.min(change / lastChange, 0.9999) : 1;
        const remaining = lambda < 1 ? change * lambda / (1 - lambda) : Infinity;
        if (periods >= 3 && change < 1e-4 && remaining < 1e-4) { settled = true; break; }
        // settling progress: how far the per-period change has fallen, on a log scale,
        // from its largest value towards the 1e-4 target
        const off = Math.max(change, isFinite(remaining) ? remaining : change, 1e-4);
        worst = Math.max(worst, off);
        if (worst > 1e-4) progress(0.05 + 0.83 * Math.max(0, Math.min(1, Math.log(worst / off) / Math.log(worst / 1e-4))));
        hist.push(x.slice());
        if (hist.length >= 7 && !opts.noExtrapolate) {
          const xe = mpeExtrapolate(hist);
          // accept the jump only if it lands somewhere sane
          if (xe && xe.every(isFinite) && periodChange(xe, x) < 0.5) { x = xe; xBack = null; extrapolations++; }
          hist = [x.slice()];
        }
        lastChange = change;
        if (Date.now() - t0 > budgetMs * 0.75) break;
      }
      // re-settle the fast (audio) dynamics at full resolution; Gear-2's step before, on the finer
      // grid, interpolated along the last coarse step (a backward-Euler start would kick the slow modes)
      if (xBack && Math.abs(hBack - h) > 1e-9 * h) { xBack = x.map((v, i) => v + (xBack[i] - v) * h / hBack); hBack = h; }
      for (let k = 0; k < 2; k++) {
        const start = x.slice();
        if (!runPeriod(h, stepsPerPeriod)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; }
        if (periodChange(x, start) < 1e-4) break;
      }
      // a run that stopped unsettled (out of time) holds its percentage: it is not nearly done
      if (settled) progress(0.88);
      if (!settled) result.warnings.push("Not fully settled after " + periods + " cycles (large time constants); waveforms may still drift.");
      result.extrapolations = extrapolations;
      result.warm = Float64Array.from(x);
    }

    // a 555 with no source to follow runs freely, at a period of its own: the time between two falls
    // of its output (resets of the latch) after power-on, found in windows of doubling length (and
    // step) until it first falls, then on at that step until it falls again. The capture starts
    // there and holds three or more of those cycles (at least the usual 5 ms); the DC values are its
    // averages, as a meter reads them. A cycle timed in fewer than 200 steps is timed again, two falls
    // at 400 steps a cycle. A timer that never falls (a one-shot at rest) keeps the window
    // before the capture that takes it past its start.
    let fOsc = 0;
    // (relays are latched too, but no oscillator: a circuit with only those keeps its window)
    const oscs = circ.timers.filter(e => e.kind !== "RELAY");
    if (!freqs.length && oscs.length) {
      const e0 = oscs.find(e => e.kind === "TIMER555") || oscs[0], tLimit = opts.oscLimit || 30, falls = [];
      let rose = false;
      let w = window, hh = w / 400;
      const fail = () => { circ.onFlip = null; result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; };
      // on at step hh until the output has fallen n times in all, or past tEnd; false: did not converge.
      // A fall counts once the latch has risen (one before that only leaves the DC state, no whole
      // cycle before it), at the time it flipped
      circ.onFlip = (e, want, tf) => { if (e !== e0) return; if (want) rose = true; else if (rose) falls.push(tf); };
      const until = (n, tEnd) => {
        while (falls.length < n && t < tEnd && Date.now() - t0 < budgetMs * 0.5) {
          const tn = t + hh, nx = step(x, tn, hh);
          if (!nx) return false;
          x = nx; t = tn;
        }
        return true;
      };
      while (!falls.length && t < tLimit && Date.now() - t0 < budgetMs * 0.5) {
        if (!until(1, t + w)) return fail();
        if (!falls.length) { w *= 2; hh = w / 400; }
      }
      // timed from the second fall to the third: the first cycle may start from wherever the DC state left it
      if (falls.length && !until(3, tLimit)) return fail();
      // a cycle of fewer than 200 steps (a fast timer found in the first window) is timed again, finer
      for (let k = 0; k < 3 && falls.length >= 2 && falls[falls.length - 1] - falls[falls.length - 2] < 200 * hh; k++) {
        hh = (falls[falls.length - 1] - falls[falls.length - 2]) / 400;
        if (!until(falls.length + 2, tLimit)) return fail();
      }
      // a latch that flips every step or two (a glow tube that cannot keep its discharge) chatters: no cycle to time
      if (falls.length >= 2 && falls[falls.length - 1] - falls[falls.length - 2] >= 100 * hh) {
        const T = falls[falls.length - 1] - falls[falls.length - 2];
        period = T; fOsc = 1 / T;
        capture = T * Math.max(3, Math.ceil(window / T - 1e-9));
        stepsPerPeriod = 400; h = T / stepsPerPeriod; captureSteps = Math.round(capture / h);
      }
      else if (!runPeriod(h, captureSteps)) return fail();
      circ.onFlip = null;
      xBack = null;
    }

    // Capture
    const nCap = captureSteps + 1;
    const nodes = [];
    for (let i = 0; i < nodeCount; i++) nodes.push(new Float32Array(nCap));
    // (an op-amp's trace is its clip: how far past its output limit it is driven; a transistor's
    // its collector or drain current, in its own polarity: the curve tracer's load line)
    // a saturating transformer's trace is its core flux, as a share of the knee)
    const devIdx = circ.els.filter(e => e.kind === "TRIODE" || e.kind === "PENTODE" || e.kind === "VDIODE" || e.kind === "D" || e.kind === "OPAMP" || e.kind === "BJT" || e.kind === "MOS" || e.kind === "MOS4" || (e.kind === "XFMR" && e.sat));
    const devTrace = {};
    devIdx.forEach(e => { devTrace[e.id + (e.part ? "#" + e.part : "")] = { i: new Float32Array(nCap), ig2: e.kind === "PENTODE" ? new Float32Array(nCap) : null }; });
    // A circuit run from AC (a rectified supply) has no true DC solution: the
    // DC pass above only estimates it (a power transformer's halves held at 0.95
    // of their peak) or, behind AC mains, starts it from zero. Then the reported
    // DC values are the averages over the settled capture window, what a meter
    // reads; the estimate is kept as dcEstimate.
    const averaged = fOsc > 0 || circ.els.some(e => e.dcValue !== undefined || e.acMains);
    const nodeSum = new Float64Array(nodeCount), devSum = {}, curSum = [];
    // animation frames: every element's terminal currents at up to 120 instants over the window
    // (options.frameSpan: one signal period, so a slow signal in a long mains window still gets them all)
    const span = Math.max(2, Math.min(nCap - 2, opts.frameSpan > 0 ? Math.round(opts.frameSpan / h) : fOsc ? stepsPerPeriod : nCap - 2));
    const nFr = Math.min(120, span), frAt = new Set(Array.from({ length: nFr }, (_, j) => 1 + Math.round(j * span / nFr)));
    const frames = { layout: currentsOf(circ, x, []).map((v, k) => (k % 3 === 2 ? 0 : v)), at: [], cur: [] };
    let xPrev = x;
    const pSum = new Float64Array(hotParts.length);
    const record = (k) => {
      if (hotParts.length && k < nCap - 1) heatOf(hotParts, x).forEach((p, i) => { pSum[i] += p; });
      if (frAt.has(k)) { frames.at.push(k); frames.cur.push(instantCurrents(circ, x, xPrev, h, new Float32Array(frames.layout.length / 3))); }
      xPrev = x;
      for (let i = 1; i < nodeCount; i++) nodes[i][k] = x[i - 1];
      const acc = averaged && k < nCap - 1;   // the last sample repeats the first: one exact window
      if (acc) for (let i = 1; i < nodeCount; i++) nodeSum[i] += x[i - 1];
      devIdx.forEach(e => {
        const s = deviceState(e, x), tr = devTrace[e.id + (e.part ? "#" + e.part : "")];
        tr.i[k] = s.ia !== undefined ? s.ia : s.i !== undefined ? s.i : s.ic !== undefined ? s.ic : s.id !== undefined ? s.id : s.flux !== undefined ? s.flux : s.clip;
        if (tr.ig2) tr.ig2[k] = s.ig2;
      });
      if (acc) currentsOf(circ, x, curSum);
      if (acc) circ.els.forEach((e, j) => {
        if (!e.id) return;
        const s = deviceState(e, x), d = devSum[j] || (devSum[j] = { e, sum: {} });
        for (const f in s) if (typeof s[f] === "number") d.sum[f] = (d.sum[f] || 0) + s[f];
      });
    };
    record(0);
    for (let s = 1; s < nCap; s++) {
      t += h;
      const nx = step(x, t, h);
      if (!nx) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; }
      x = nx;
      record(s);
      if ((s & 63) === 0 && settled) progress(0.88 + 0.12 * s / nCap);
    }
    result.tran = { dt: h, samples: nCap, nodes, devices: devTrace, periods, settled, fBase: fMin || fOsc, frames };
    if (averaged && nCap > 1) {
      const n = nCap - 1, avg = { nodes: Array.from(nodeSum, v => v / n), devices: {}, currents: curSum.map((v, k) => (k % 3 === 2 ? v / n : v)) };
      avg.nodes[0] = 0;
      Object.values(devSum).forEach(({ e, sum }) => {
        const m = {}; for (const f in sum) m[f] = sum[f] / n;
        avg.devices[e.id] = Object.assign(avg.devices[e.id] || {}, { [e.kind === "VDIODE" ? e.part || "d" : "main"]: m });
      });
      result.dcEstimate = result.dc;
      result.dc = avg;
      result.dcAveraged = true;
    }
    if (hotParts.length) {
      // each heated part: its junction temperature and dissipation at the operating point (tj, p),
      // its average dissipation over the capture and the steady temperatures that gives (pAvg, tjAvg),
      // its heatsink's temperature (ts)
      const p0 = heatOf(hotParts, dc.x), pAvg = nCap > 1 ? Array.from(pSum, v => v / (nCap - 1)) : p0, avg = thermalSteady(hotParts, pAvg);
      const st0 = thermalSteady(hotParts, hotParts.map((e, i) => p0[i] + Math.max(0, (opts.thermExtra && opts.thermExtra[e.id]) || 0)));
      result.thermal = {};
      hotParts.forEach((e, i) => { result.thermal[e.id] = { tj: e._tj, p: p0[i], pAvg: pAvg[i], tjAvg: avg.tj[i], ts: e.therm.sink ? st0.ts.get(e.therm.sink) : null, sink: e.therm.sink || null }; });
      result.tj = tempsOf(circ);
    }
    if (settled) progress(1);
    result.ok = true;
    result.elapsedMs = Date.now() - t0; result.solver = wasm ? "wasm" : "js"; result.stats = circ.stats;
    return result;
  }

  // Behavioural-source expressions for SPICE export: the exact equations above
  const g = v => Number(v.toPrecision(6));
  const Spice = {
    // an op-amp as a subcircuit (pins IN+ IN− OUT V+ V− N1 N2) of current sources, Semi.opamp term
    // by term; the shared terms are behavioural voltages on inner nodes (a current X as X volts)
    opamp: (m, name) => {
      const sp = x => `0.05*(max((${x})/0.05,0)+ln(1+exp(-abs((${x})/0.05))))`, pos = X => `${X}/(1+exp(min(max(-${X}*1e9,-60),60)))`;
      const L = [`.subckt ${name} INP INN OUT VP VN N1 N2`, `RIN INP INN ${g(m.rin)}`,
        "BON ON 0 V=1/(1+exp(-(V(VP,VN)-2)/0.3))", "BVM VM 0 V=(V(VP)+V(VN))/2",
        `BHI HI 0 V=max(V(VP)-${g(m.dhi)},V(VM))`, `BLO LO 0 V=min(V(VN)+${g(m.dlo)},V(VM))`,
        `BX1 X1 0 V=-${g(m.i1)}*tanh(${g(m.gm1 / m.i1)}*V(INP,INN))*V(ON)`, `BX2 X2 0 V=-${g(m.i2)}*tanh(${g(m.gm2 / m.i2)}*V(N1,VM))*V(ON)`,
        `BVT VT 0 V=V(N2)-${sp("V(N2)-V(HI)")}+${sp("V(LO)-V(N2)")}`,
        `BXO XO 0 V=(${g(m.isc)}*tanh(max(V(VT,OUT),0)/${g(m.ro * m.isc)})+${g(m.isk)}*tanh(min(V(VT,OUT),0)/${g(m.ro * m.isk)}))*V(ON)`];
      let k = 0;
      const B = (a, b, i) => L.push(`B${++k} ${a} ${b} I=${i}`);
      // X out of the amplifier into node n, from V+ or back to V−; a resistor to the midpoint; clamps
      const src = (n, X) => { B("VP", n, pos(X)); B(n, "VN", `${pos(X)}-${X}`); };
      const rmid = (n, r) => { B(n, "VP", `V(${n},VM)/${g(2 * r)}`); B(n, "VN", `V(${n},VM)/${g(2 * r)}`); };
      const clamp = (n, top, bot, gc) => { B(n, "VP", `${g(gc)}*${sp(`V(${n})-${top}`)}`); B("VN", n, `${g(gc)}*${sp(`${bot}-V(${n})`)}`); };
      if (m.ib > 0) { B("INP", "VN", `${g(m.ib)}*V(ON)`); B("INN", "VN", `${g(m.ib)}*V(ON)`); }
      else if (m.ib < 0) { B("VP", "INP", `${g(-m.ib)}*V(ON)`); B("VP", "INN", `${g(-m.ib)}*V(ON)`); }
      src("N1", "V(X1)"); rmid("N1", m.r1); src("N2", "V(X2)"); rmid("N2", m.r2); src("OUT", "V(XO)");
      clamp("N1", "(V(VM)+0.5)", "(V(VM)-0.5)", 1e-3); clamp("N2", "(V(HI)+0.3)", "(V(LO)-0.3)", 1e-2);
      B("VP", "VN", `${g(m.iq)}*V(ON)`);
      L.push(".ends");
      return L;
    },
    // a series regulator (pins IN OUT REF) and a shunt reference (K A REF), Semi.reg and Semi.shunt
    // term by term
    reg: (m, name) => {
      // the voltages as the positive type sees them: V(IN,OUT) for an LM317, V(OUT,IN) for an LM337
      const sp = (x, w) => `${w}*(max((${x})/${w},0)+ln(1+exp(-abs((${x})/${w}))))`, p = m.pol, vv = (a, b) => (p > 0 ? `V(${a},${b})` : `V(${b},${a})`);
      const L = [`.subckt ${name} IN OUT REF`, `BON ON 0 V=1/(1+exp(-(${m.adj ? vv("IN", "OUT") : vv("IN", "REF")}-0.5)/0.1))`,
        `BIP IP 0 V=${g(m.ilim)}*tanh(${sp(`${g(m.g)}*(${g(m.vref)}+${g(m.line || 0)}*(${vv("IN", "OUT")}-3)-${vv("OUT", "REF")})`, 1e-4)}/${g(m.ilim)})*V(ON)*tanh(${sp(`${vv("IN", "OUT")}-${g(m.vdo)}`, 0.05)}/${g(m.vsat)})`];
      const B = (k, a, b, i) => L.push(`B${k} ${a} ${b} I=${p > 0 ? "" : "-("}${i}${p > 0 ? "" : ")"}`);
      if (m.adj) { B("P", "IN", "OUT", `V(IP)+${g(m.iq)}*V(ON)`); B("A", "IN", "REF", `${g(m.iadj)}*V(ON)`); }
      else { B("P", "IN", "OUT", "V(IP)"); B("Q", "IN", "REF", `${g(m.iq)}*V(ON)`); L.push(`RDIV OUT REF ${g(m.rdiv)}`); }
      L.push(".ends");
      return L;
    },
    // an NE555 (pins GND TRIG OUT RESET CV THR DIS VCC, as the part's 1-8) the way the engine runs it:
    // the 5k-5k-5k divider, the supply current and the reset pin's pull-up; the latch a node Q
    // (0 reset, 1 set) that a fast loop (10 ns) pulls towards what the comparators ask for (reset wins,
    // then the trigger, then the threshold; with none on, it holds), the comparators smoothed over
    // 1 mV so the transient steps through a flip; the output and discharge currents timerCurrents's.
    // (min/max, not limit(): ngspice's B sources have no limit())
    timer555: name => {
      const m = NE555, u = x => `(1/(1+exp(min(max(-(${x})/1e-3,-60),60))))`, s = 0.005;
      const sp = x => `${s}*(max((${x})/${s},0)+ln(1+exp(-abs((${x})/${s}))))`, sat = (v, r, imax) => `${g(imax)}*tanh(${v}/${g(r * imax)})`;
      // the transistors switch as Q passes ½ (a gradual hand-over would let the discharge hold THR at
      // CV against the latch); 10 pF on OUT and DIS give ngspice's step control a time constant there
      const q = "(1/(1+exp(min(max(-(V(Q)-0.5)/0.02,-60),60))))";
      return [`.subckt ${name} GND TRIG OUT RESET CV THR DIS VCC`,
        "R1 VCC CV 5k", "R2 CV LO 5k", "R3 LO GND 5k", "RIQ VCC GND 1.7k", "RRST VCC RESET 33k",
        `BR R 0 V=${u(`${m.vreset}-V(RESET,GND)`)}`, `BT T 0 V=${u("V(LO,TRIG)")}`, `BH H 0 V=${u("V(THR,CV)")}`,
        "BW W 0 V=(1-V(R))*(V(T)+(1-V(T))*(1-V(H))*(1/(1+exp(min(max(-(V(Q)-0.5)/0.05,-60),60)))))",
        "BQ 0 Q I=(V(W)-V(Q))/1k", "CQ Q 0 10p IC=0", "COUT OUT GND 10p", "CDIS DIS GND 10p",
        `BHI VCC OUT I=${q}*${g(m.ih)}*tanh(${sp(`V(VCC,OUT)-${m.drop}`)}/${g(m.rh * m.ih)})`,
        `BLO OUT GND I=(1-${q})*${sat("V(OUT,GND)", m.rl, m.il)}`,
        `BDS DIS GND I=(1-${q})*${sat("V(DIS,GND)", m.rd, m.id)}`, ".ends"];
    },
    shunt: (m, name) => {
      const sp = (x, w) => `${w}*(max((${x})/${w},0)+ln(1+exp(-abs((${x})/${w}))))`;
      return [`.subckt ${name} K A REF`, `BK K A I=${g(m.imax)}*tanh(${sp(`${g(m.gm)}*(V(REF,A)-${g(m.vref)})`, 2e-4)}/${g(m.imax)})*tanh(${sp("V(K,A)-1", 0.05)}/0.5)`,
        `ROFF K A ${g(m.roff)}`, `RREF REF A ${g(m.rref)}`, ".ends"];
    },
    // the grid current law (gridIJ), on the grid voltage and the accelerating electrode's
    grid: (m, vg, va) => {
      const G = `${g(GRID.vs)}*ln(1+exp(min((${vg}+${g(GRID.vc)})/${g(GRID.vs)},500)))`, a = `pwr(max(${va},0),2)/(max(${va},0)+1)`;
      return `${g(2 / m.kg)}*pwr(${G},1.5)/(1+${g(GRID.D)}*sqrt(${a}/(${g(m.mu)}*max(${G},1e-30))))`;
    },
    triode: m => ({
      plate: `pwr(max(V(A,K)/${g(m.kp)}*ln(1+exp(${g(m.kp)}*(1/${g(m.mu)}+V(G,K)/sqrt(${g(m.kvb)}+V(A,K)*V(A,K))))),0),${g(m.x)})*${g(2 / m.kg)}`,
      grid: Spice.grid(m, "V(G,K)", "V(A,K)")
    }),
    pentode: m => {
      // with the fade-in below SCREEN_FADE volts on the screen: s²(3 − 2s), s = Vg2k / SCREEN_FADE
      // (min/max rather than if(), so LTspice and ngspice both read it)
      const F = SCREEN_FADE, sf = `min(max(V(G2,K),0)/${F},1)`, fade = `pwr(${sf},2)*(3-2*${sf})`;
      const is = `pwr(max(V(G2,K)/${g(m.kp)}*ln(1+exp(${g(m.kp)}*(1/${g(m.mu)}+V(G1,K)/max(V(G2,K),1e-3)))),0),${g(m.x)})*${g(2 / m.kg)}*${fade}`;
      const va = "max(V(A,K),0)";
      return {
        plate: `${is}*tanh(${va}/${g(m.vk)})*(1+${va}/${g(m.lam)})`,
        screen: `pwr(max(V(G1,K)+V(G2,K)/${g(m.mu)},0),${g(m.x)})/${g(m.kg2 || 1500)}*${fade}+${g(m.ks || 0)}*${is}*(1-tanh(${va}/${g(m.vk)}))`,
        grid: Spice.grid(m, "V(G1,K)", "V(G2,K)")
      };
    }
  };

  // ---------------------------------------------------------------------------
  // Power-on transient: the circuit starts cold (every node at 0 V, capacitors
  // empty, no current in inductors) and all sources switch on at t = 0. Steps
  // through tStop and returns only the probed nodes, compressed to at most
  // maxPoints buckets, each holding the minimum and maximum of its samples, so
  // an audio signal over a second of supply settling still shows its envelope.
  //   opts: { tStop, probes: [[node, refNode]...], maxPoints, budgetMs, onProgress(f),
  //           warmup: the tubes' cathodes start cold too and warm with their heat.tau (cathodeWarm),
  //           watch: [[node, refNode]...]: node pairs whose peak voltage (and when) to report }
  //   each probe reads v(node) - v(refNode), like a scope channel against its common
  //   result.watch: [{ max, maxAt, min, minAt }] per watched pair; result.tubes: [{ id, part, kind,
  //   tau (0: hot from the start), peak, peakAt (its largest cathode current, A, and when), endPeak
  //   (the largest in the last 10 % of the run: as it settles), worst }]
  //   per tube element, worst (with warmup): the most current it passed while its cathode was still
  //   cold (below CATHODE.cold of its working temperature) and saturated (asked for 1.5 times or
  //   more what it could emit): a rectifier charging empty capacitors,
  //   { i, t, ratio (asked for / could emit), frac (emission share), T (K), v (across it) } or null
  // ---------------------------------------------------------------------------
  //   opts.warmOffset: the cathodes have been heating that long at t = 0 (a standby switch closed
  //   after the heaters: the run starts at the switch). opts.soft: { r, at }: soft start, the mains
  //   through r ohms (or the circuit's NTC inrush limiters, at their cold resistance) until a relay
  //   shorts it at t = at. opts.onPartial(snapshot): about every partialMs (500) of run time, what
  //   is new since the last one (probe and watched buckets from..to) and the running peaks, so a
  //   caller can draw the record as it grows and keep it if the run is stopped.
  function startup(netlist, opts) {
    opts = opts || {};
    if (opts.soft && opts.soft.at > 0) {
      let nodeCount = netlist.nodeCount;
      const els = netlist.elements.map(e => Object.assign({}, e)), ntc = els.filter(e => e.ntc && e.ntc.n > 0);
      if (ntc.length) ntc.forEach(e => { e.soft = true; });
      else els.filter(e => e.acMains).forEach(e => { const n = nodeCount++, a = e.nodes[0]; e.nodes = [n, e.nodes[1]]; els.push({ id: e.id + "~soft", kind: "R", nodes: [a, n], r: Math.max(0.01, +opts.soft.r || 0), soft: true }); });
      netlist = Object.assign({}, netlist, { nodeCount, elements: els });
    }
    const circ0 = buildCircuit(netlist);
    try { return startupRun(circ0, opts); } finally { circ0.els.forEach(e => { delete e._emit; }); }
  }
  function startupRun(circ, opts) {
    const t0 = Date.now(), tStop = Math.max(opts.tStop || 1, 1e-4), budgetMs = opts.budgetMs || 300000;
    const n = circ.nUnk;
    const result = { ok: false, warnings: [] };
    if (circ.nNodes < 2) { result.error = "Circuit is empty"; return result; }
    circ.els.forEach(e => { delete e._vlast; });
    const freqs = circ.els.filter(e => e.kind === "VSRC" && e.freq > 0 && e.amp !== 0).map(e => e.freq);
    const fMax = freqs.length ? Math.max.apply(null, freqs) : 0;
    // 40 steps per period of the fastest source, at least 2000 steps over the run (20000 with a
    // 555, whose own period the sources do not tell)
    let h = Math.min(fMax ? 1 / (40 * fMax) : Infinity, tStop / (circ.timers.some(e => e.kind !== "RELAY") ? 20000 : 2000));
    // a long run (the cathodes warming up over half a minute) at 600000 steps at most: an audio
    // signal then gets fewer steps a period, enough for its envelope
    if (tStop > 2) h = Math.max(h, tStop / 600000);
    const steps = Math.ceil(tStop / h); h = tStop / steps;
    const probes = (opts.probes || []).map(p => Array.isArray(p) ? p : [p, 0]).filter(([a, b]) => a >= 0 && a < circ.nNodes && b >= 0 && b < circ.nNodes);
    const nOut = Math.min(opts.maxPoints || 4000, steps), per = steps / nOut;
    const mins = probes.map(() => new Float32Array(nOut)), maxs = probes.map(() => new Float32Array(nOut));
    mins.forEach(a => a.fill(Infinity)); maxs.forEach(a => a.fill(-Infinity));
    let xBack = null, hBack = 0;          // BDF2 history, as in simulate()
    const hk = { tol: { abs: 1, rel: 0.02 } };   // x₋₃ for the step refinement, its tolerance for an envelope
    const solveStep = (xprev, tNext, hh, depth) => {
      const gear = !depth && xBack && Math.abs(hBack - hh) <= 1e-9 * hh;
      const r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev, prev2: gear ? xBack : null }, { gmin: 1e-12 });
      if (r.ok) {
        if (depth) return r.x;
        const xr = gear && refineStep(circ, refineHist(hk, gear, xBack, xprev), r.x, tNext, hh, 0, hk.tol);
        keepHist(hk, gear, xBack, xprev); xBack = xprev; hBack = hh;
        return xr || r.x;
      }
      if ((depth || 0) >= 3) return lastResortStep(circ, xprev, hh, tNext);   // as in simulate()
      let xs = xprev;
      for (let k = 1; k <= 8; k++) { xs = solveStep(xs, tNext - hh + hh * k / 8, hh / 8, (depth || 0) + 1); if (!xs) return null; }
      if (!depth) xBack = null;
      return xs;
    };
    const step = (xprev, tNext, hh) => timerStep(circ, solveStep, xprev, tNext, hh);
    let x = new Array(n).fill(0), lastProg = 0;
    const okNode = k => k >= 0 && k < circ.nNodes;
    // watched nets (every capacitor's): the peak each way, and (opts.watchPoints) a coarser
    // min/max record, for the power-on report's settling time and for plotting a capacitor unprobed
    const nW = Math.min(opts.watchPoints || 0, steps), perW = nW ? steps / nW : 1;
    const watch = (opts.watch || []).map(p => Array.isArray(p) ? p : [p, 0]).map(([a, b]) => ({ a, b, ok: okNode(a) && okNode(b), max: 0, maxAt: 0, min: 0, minAt: 0,
      lo: nW ? new Float32Array(nW).fill(Infinity) : null, hi: nW ? new Float32Array(nW).fill(-Infinity) : null }));
    const TUBE = { TRIODE: 1, PENTODE: 1, VDIODE: 1 };
    // per tube: peak, settled peak, the worst current with a cold cathode, and (with watchPoints)
    // the most it passed in each record bucket while cold and overdrawn, for the scope's lanes
    const tubes = circ.els.filter(e => TUBE[e.kind] && e.id), track = tubes.map(() => ({ peak: 0, peakAt: 0, endPeak: 0, worst: null, cold: nW ? new Float32Array(nW) : null }));
    const heated = opts.warmup ? tubes.filter(e => e.heat && e.heat.tau > 0 && e.heat.emit > 0) : [];
    const off = Math.max(0, +opts.warmOffset || 0);
    const warmTo = t => heated.forEach(e => { e._emit = e.heat.emit * cathodeWarm(t + off, e.heat.tau).frac; });
    const soft = opts.soft && opts.soft.at > 0 ? circ.els.filter(e => e.soft) : [];
    let softOn = soft.length > 0;
    // what a tube asks for (its space-charge current) and what it passes
    const demand = (e, x) => {
      if (e.kind === "VDIODE") { const v = vn(x, e.nodes[0]) - vn(x, e.nodes[1]); return { d: v > 0 ? e.perveance * Math.pow(v, 1.5) : 0, v }; }
      const em = e._emit; delete e._emit;
      const st = deviceState(e, x); if (em !== undefined) e._emit = em;
      return { d: Math.max(st.ia, 0) + Math.max(st.ig, 0) + Math.max(st.ig2 || 0, 0), v: st.vak };
    };
    const record = (s, x) => {
      const b = Math.min(nOut - 1, Math.floor(s / per));
      probes.forEach(([p, q], j) => { const v = vn(x, p) - vn(x, q); if (v < mins[j][b]) mins[j][b] = v; if (v > maxs[j][b]) maxs[j][b] = v; });
      const t = s * h;
      const bw = nW ? Math.min(nW - 1, Math.floor(s / perW)) : 0;
      watch.forEach(w => {
        if (!w.ok) return; const v = vn(x, w.a) - vn(x, w.b);
        if (v > w.max) { w.max = v; w.maxAt = t; } if (v < w.min) { w.min = v; w.minAt = t; }
        if (w.lo) { if (v < w.lo[bw]) w.lo[bw] = v; if (v > w.hi[bw]) w.hi[bw] = v; }
      });
      tubes.forEach((e, j) => {
        const { d, v } = demand(e, x), i = d * emitShare(e, d), k = track[j];
        if (i > k.peak) { k.peak = i; k.peakAt = t; }
        if (t >= 0.9 * tStop && i > k.endPeak) k.endPeak = i;
        // a cold cathode overdrawn: the most current it passed while still below CATHODE.cold of its
        // working temperature (in kelvin) with the circuit asking for more than it could emit
        if (e._emit === undefined || !(i > 0) || (!k.cold && k.worst && i <= k.worst.i)) return;
        const w = cathodeWarm(t + off, e.heat.tau);
        if (w.T >= CATHODE.cold * CATHODE.hot) return;
        const ratio = d / Math.max(e._emit, 1e-15);
        if (ratio < 1.5) return;   // the circuit takes what it would from a hot tube: normal conduction
        if (k.cold && i > k.cold[bw]) k.cold[bw] = i;
        if (k.worst && i <= k.worst.i) return;
        k.worst = { i, t, ratio, frac: w.frac, T: w.T, v };
      });
    };
    // the partial record: what is new since the last snapshot
    const partialMs = opts.partialMs || 500;
    let lastPart = Date.now(), pb = 0, pw = 0;
    const snapshot = s => {
      const b = Math.min(nOut, Math.floor(s / per)), bw = nW ? Math.min(nW, Math.floor(s / perW)) : 0;   // whole buckets so far
      const snap = { s, t: s * h, tStop, h, dt: tStop / nOut, points: nOut, watchDt: nW ? tStop / nW : 0, watchPoints: nW, from: pb, to: b, wfrom: pw, wto: bw,
        min: mins.map(a => a.slice(pb, b)), max: maxs.map(a => a.slice(pb, b)),
        watch: watch.map(w => ({ max: w.max, maxAt: w.maxAt, min: w.min, minAt: w.minAt, lo: w.lo && w.ok ? w.lo.slice(pw, bw) : null, hi: w.hi && w.ok ? w.hi.slice(pw, bw) : null })),
        tubes: tubes.map((e, j) => ({ id: e.id, part: e.part || null, kind: e.kind, tau: heated.includes(e) ? e.heat.tau : 0, peak: track[j].peak, peakAt: track[j].peakAt, endPeak: track[j].endPeak, worst: track[j].worst, cold: track[j].cold ? track[j].cold.slice(pw, bw) : null })),
        relayAt: soft.length && !softOn ? opts.soft.at : null };
      pb = b; pw = bw;
      return snap;
    };
    warmTo(0);
    record(0, x);
    // self-heated transistors start at their ambient and warm through the run (thermalClock)
    const hotB = heatedBjts(circ), clock = hotB.length ? thermalClock(hotB) : null, tjMax = hotB.map(() => -Infinity);
    for (let s = 1; s <= steps; s++) {
      warmTo(s * h);
      if (softOn && s * h >= opts.soft.at) { softOn = false; soft.forEach(e => { e.r = 0.01; delete e.ntc; }); }   // the relay closes across the soft-start resistance
      const nx = step(x, s * h, h);
      if (!nx) { result.error = "Transient did not converge at t=" + (s * h * 1000).toFixed(3) + " ms"; result.stuck = stuckOf(circ); return result; }
      x = nx; record(s, x);
      if (clock) { clock(heatOf(hotB, x), h); hotB.forEach((e, i) => { tjMax[i] = Math.max(tjMax[i], e._tj); }); }
      if (opts.onProgress && s / steps - lastProg >= 0.02) { lastProg = s / steps; opts.onProgress(lastProg); }
      if (opts.onPartial && Date.now() - lastPart >= partialMs) { lastPart = Date.now(); opts.onPartial(snapshot(s)); }
      if (Date.now() - t0 > budgetMs) { result.error = `Stopped after ${(s * h).toFixed(3)} s of circuit time: the run took longer than ${Math.round(budgetMs / 1000)} s`; return result; }
    }
    result.ok = true;
    result.tStop = tStop; result.h = h; result.steps = steps; result.stats = circ.stats; result.points = nOut; result.dt = tStop / nOut;
    result.probes = probes; result.min = mins; result.max = maxs;
    result.watch = watch.map(w => ({ max: w.max, maxAt: w.maxAt, min: w.min, minAt: w.minAt, lo: w.ok ? w.lo : null, hi: w.ok ? w.hi : null }));
    result.watchDt = nW ? tStop / nW : 0;
    result.warmOffset = off; result.relayAt = soft.length ? opts.soft.at : null; result.soft = soft.length ? (soft.some(e => e.id.endsWith("~soft")) ? "resistor" : "ntc") : null;
    result.tubes = tubes.map((e, j) => ({ id: e.id, part: e.part || null, kind: e.kind, tau: heated.includes(e) ? e.heat.tau : 0, peak: track[j].peak, peakAt: track[j].peakAt, endPeak: track[j].endPeak, worst: track[j].worst, cold: track[j].cold }));
    // each self-heated transistor: its junction temperature at the end and its highest on the way
    if (hotB.length) { result.thermal = {}; hotB.forEach((e, i) => { result.thermal[e.id] = { tj: e._tj, tjMax: tjMax[i] }; }); }
    result.elapsedMs = Date.now() - t0;
    return result;
  }

  // ---------------------------------------------------------------------------
  // Audio: the circuit playing a recording, for the CAD's Listen tab. From the settled state
  // (opts.warm: a steady-state run's result.warm, the state at the start of a mains period, so the
  // mains go on in phase; else the DC point), a plain transient at a fixed step, every sample kept.
  // A VSRC carrying samples (Float32Array) and rate plays them (waveValue), times its amp.
  //   opts: { warm, rate (output samples a second), sub (steps per sample, 2 by default), seconds,
  //           probes: [[node, refNode]...], budgetMs, onProgress(f) }
  //   returns { ok, rate, out: [Float32Array per probe], elapsedMs } or { ok: false, error, at }
  // ---------------------------------------------------------------------------
  function audio(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), rate = opts.rate || 48000, sub = Math.max(1, Math.round(opts.sub || 2)), budgetMs = opts.budgetMs || 600000;
    const circ = buildCircuit(netlist), n = circ.nUnk;
    if (circ.nNodes < 2) return { ok: false, error: "Circuit is empty" };
    circ.els.forEach(e => { delete e._vlast; });
    let x;
    if (opts.warm && opts.warm.length === n) x = Array.from(opts.warm);
    else { const dc = dcOperatingPoint(circ); if (!dc.ok) return { ok: false, error: "DC operating point did not converge (" + dc.error + ")" }; x = dc.x.slice(); }
    const h = 1 / (rate * sub), samples = Math.max(1, Math.round((opts.seconds || 1) * rate));
    const probes = (opts.probes || []).map(p => Array.isArray(p) ? p : [p, 0]).filter(([a, b]) => a >= 0 && a < circ.nNodes && b >= 0 && b < circ.nNodes);
    const out = probes.map(() => new Float32Array(samples));
    let xBack = null, hBack = 0;          // BDF2 history, as in simulate()
    const hk = {};   // x₋₃ for the step refinement
    const solveStep = (xprev, tNext, hh, depth) => {
      const gear = !depth && xBack && Math.abs(hBack - hh) <= 1e-9 * hh;
      const r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev, prev2: gear ? xBack : null }, { gmin: 1e-12 });
      if (r.ok) {
        if (depth) return r.x;
        const xr = gear && refineStep(circ, refineHist(hk, gear, xBack, xprev), r.x, tNext, hh, 0, hk.tol);
        keepHist(hk, gear, xBack, xprev); xBack = xprev; hBack = hh;
        return xr || r.x;
      }
      if ((depth || 0) >= 2) return lastResortStep(circ, xprev, hh, tNext);
      let xs = xprev;
      for (let k = 1; k <= 8; k++) { xs = solveStep(xs, tNext - hh + hh * k / 8, hh / 8, (depth || 0) + 1); if (!xs) return null; }
      if (!depth) xBack = null;
      return xs;
    };
    let lastProg = 0;
    for (let s = 0; s < samples; s++) {
      for (let k = 1; k <= sub; k++) {
        const nx = timerStep(circ, solveStep, x, (s * sub + k) * h, h);
        if (!nx) return { ok: false, error: "Transient did not converge at t=" + (((s * sub + k) * h) * 1000).toFixed(3) + " ms", at: s / rate, stuck: stuckOf(circ) };
        x = nx;
      }
      probes.forEach(([p, q], j) => { out[j][s] = vn(x, p) - vn(x, q); });
      if (opts.onProgress && (s + 1) / samples - lastProg >= 0.01) { lastProg = (s + 1) / samples; opts.onProgress(lastProg); }
      if ((s & 255) === 0 && Date.now() - t0 > budgetMs) return { ok: false, error: `Stopped after ${(s / rate).toFixed(2)} s of audio: it took longer than ${Math.round(budgetMs / 1000)} s`, at: s / rate };
    }
    return { ok: true, rate, out, elapsedMs: Date.now() - t0, stats: circ.stats };
  }

  // ---------------------------------------------------------------------------
  // Small-signal frequency response (AC analysis): every device linearized at an operating
  // point, then the complex nodal equations Y(ω) = G + jωB solved at each frequency.
  //   opts: { op: node voltages [v0 = 0, v1, …] to linearize at (the averaged steady state of
  //           a mains-fed circuit, say; without it, the DC operating point),
  //           inputs: [{ id, mag, phase (deg) }]: the sources driven (a source not listed is a
  //           short: DC supplies, mains); fStart, fStop (Hz), perDecade, probes: [[node, ref]],
  //           kFrom, kTo: only those points of the sweep (acPoints gives their number) }
  //   returns { ok, freqs, re: [node][k], im: [node][k], probes: [{ re, im }] } (node 0, ground, is zeros)
  // A rectifier linearized at its average voltage is off, so a supply reads as its reservoir
  // capacitor, as it does for audio between charging pulses.
  // ---------------------------------------------------------------------------
  // the number of points in a sweep: perDecade per decade from fStart to fStop, both ends included
  function acPoints(opts) {
    const fStart = opts.fStart || 10, fStop = opts.fStop || 100e3, per = opts.perDecade || 40;
    return Math.max(2, Math.round(Math.log10(fStop / fStart) * per) + 1);
  }
  // what acSweep's opts.opIm takes from a simulation: each transformer's (averaged) magnetising current
  function opMagnetising(result) {
    const out = {}; Object.entries(result.dc.devices).forEach(([id, d]) => { if (d.main && d.main.im !== undefined) out[id] = d.main.im; }); return out;
  }
  // The circuit linearized at an operating point: Y(ω) = G + jωB and the right-hand side of the driven
  // sources (opts.inputs), on the unknowns of buildCircuit (node i at i − 1, then the branches).
  function acLinearize(netlist, opts) {
    const circ = buildCircuit(withTemps(netlist, opts.tj)), n = circ.nUnk, nN = circ.nNodes;
    if (nN < 2) return { ok: false, error: "Circuit is empty" };
    let x;
    // self-heated transistors without their temperatures (opts.tj): at the ones their dissipation gives
    const hot = opts.tj ? [] : heatedBjts(circ);
    if (opts.op) {
      x = new Array(n).fill(0); for (let i = 1; i < nN; i++) x[i - 1] = opts.op[i] || 0;
      for (let k = 0; k < 20 && hot.length; k++) {   // the operating point is given: only the temperatures to settle
        const { tj } = thermalSteady(hot, heatOf(hot, x)); let d = 0;
        hot.forEach((e, i) => { const t = Math.min(tj[i], RUNAWAY); d = Math.max(d, Math.abs(t - (e._tj === undefined ? e.therm.ta : e._tj))); setTemp(e, t); });
        if (d < 0.01) break;
      }
    } else {
      const dc = dcOperatingPoint(circ); if (!dc.ok) return { ok: false, error: "DC operating point did not converge (" + dc.error + ")" }; x = dc.x;
      if (hot.length) { const th = thermalDC(circ, x); if (th) x = th.x; }
    }
    const Gm = new Float64Array(n * n), Bm = new Float64Array(n * n), rhs = new Float64Array(2 * n);
    const at = (i, j) => i * n + j;
    const addG = (i, j, v) => { if (i > 0 && j > 0) Gm[at(i - 1, j - 1)] += v; };
    const addB = (i, j, v) => { if (i > 0 && j > 0) Bm[at(i - 1, j - 1)] += v; };
    const stamp2 = (add, a, b, g) => { add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g); };
    const branch = (a, b, br) => { if (a > 0) { Gm[at(a - 1, br)] += 1; Gm[at(br, a - 1)] += 1; } if (b > 0) { Gm[at(b - 1, br)] -= 1; Gm[at(br, b - 1)] -= 1; } };
    // a device's currents into its terminals, differentiated at the operating point (central differences)
    const jac = (nodes, fn, d, add) => {
      const V0 = nodes.map(k => vn(x, k)), m = nodes.length;
      for (let s = 0; s < m; s++) {
        const Vp = V0.slice(), Vm = V0.slice(); Vp[s] += d; Vm[s] -= d;
        const Ip = fn(Vp), Im = fn(Vm);
        for (let t = 0; t < m; t++) { const J = (Ip[t] - Im[t]) / (2 * d); if (J) (add || addG)(nodes[t], nodes[s], J); }
      }
    };
    const inputs = new Map((opts.inputs || []).map(i => [i.id, i]));
    const drive = (e, k, sign) => { const inp = inputs.get(e.id); if (!inp) return; const ph = (inp.phase || 0) * Math.PI / 180, m = inp.mag === undefined ? 1 : inp.mag; rhs[k] += sign * m * Math.cos(ph); rhs[n + k] += sign * m * Math.sin(ph); };
    for (let i = 1; i < nN; i++) addG(i, i, 1e-12);
    for (const e of circ.els) {
      const nd = e.nodes;
      switch (e.kind) {
        case "R": stamp2(addG, nd[0], nd[1], 1 / Math.max(e.r, 1e-6)); break;
        case "C": stamp2(addB, nd[0], nd[1], e.junc || e.vdm ? capAt(e, vn(x, nd[0]) - vn(x, nd[1])) : e.c); break;
        case "L": branch(nd[0], nd[1], e.branch); Gm[at(e.branch, e.branch)] -= R_SERIES; Bm[at(e.branch, e.branch)] -= e.l; break;
        case "XFMR": {
          const W = e.windings.length, Lm = xfmrIncremental(e, x, opts.op && opts.opIm ? opts.opIm[e.id] || 0 : undefined);
          e.windings.forEach((w, j) => {
            branch(w.a, w.b, e.branches[j]); Gm[at(e.branches[j], e.branches[j])] -= R_SERIES;
            for (let k = 0; k < W; k++) Bm[at(e.branches[j], e.branches[k])] -= Lm[j * W + k];
          });
          // a small signal about the operating point: the hysteresis play follows the magnetising current
          if (e.plays) e.plays.forEach(u => { Gm[at(u, u)] = 1; e.branches.forEach((b2, k) => { Gm[at(u, b2)] -= e.n[k]; }); });
          break;
        }
        case "E":
          branch(nd[0], nd[1], e.branch);
          if (nd[2] > 0) Gm[at(e.branch, nd[2] - 1)] -= e.gain;
          if (nd[3] > 0) Gm[at(e.branch, nd[3] - 1)] += e.gain;
          break;
        case "G": addG(nd[0], nd[2], e.gm); addG(nd[0], nd[3], -e.gm); addG(nd[1], nd[2], -e.gm); addG(nd[1], nd[3], e.gm); break;
        case "B": {
          const xs = Float64Array.from(x), J = bSlopes(e, xs, 0, true);
          if (e.out === "v") { branch(nd[0], nd[1], e.branch); J.forEach(([u, j]) => { Gm[at(e.branch, u)] -= j; }); }
          else J.forEach(([u, j]) => { if (nd[0] > 0) Gm[at(nd[0] - 1, u)] += j; if (nd[1] > 0) Gm[at(nd[1] - 1, u)] -= j; });
          break;
        }
        case "V": case "VSRC": branch(nd[0], nd[1], e.branch); drive(e, e.branch, 1); break;
        // a current source is open; driven, its current flows out of node a into node b
        case "I": if (nd[0] > 0) drive(e, nd[0] - 1, -1); if (nd[1] > 0) drive(e, nd[1] - 1, 1); break;
        case "D": {
          const Is = e.is || 2.5e-9, nVt = (e.n || 1.75) * 0.025852, vd = vn(x, nd[0]) - vn(x, nd[1]), gd = Is * Math.exp(Math.min(vd / nVt, 80)) / nVt;
          stamp2(addG, nd[0], nd[1], gd + 1e-12);
          if (e.tt) stamp2(addB, nd[0], nd[1], e.tt * gd);   // diffusion capacitance
          break;
        }
        case "VDIODE": { const P = e.perveance; jac(nd, V => { const v = V[0] - V[1]; const i = v > 0 ? P * Math.pow(v, 1.5) : 0; return [i, -i]; }, 1e-3); break; }
        case "BJT":
          jac(nd, W => Semi.bjt(W, e.model), 1e-6);
          // the transit time's charge TF · If / qb sits between base and emitter and follows both
          // junctions' voltages (SPICE's diffusion capacitance and its collector term)
          if (e.tf > 0 || e.tr > 0) jac(nd, W => { const [f, r] = Semi.bjtCharges(W, e.model, e.tf || 0, e.tr || 0); return [-r, f + r, -f]; }, 1e-6, addB);
          break;
        case "MOS": jac(nd, W => Semi.mos(W, e.model), 1e-5); break;
        case "MOS4": {
          jac(nd, W => Semi.mosx(W, e.model), 1e-5);
          const C = Semi.mosMeyer(nd.map(k => vn(x, k)), e.model);
          stamp2(addB, nd[1], nd[2], C[0]); stamp2(addB, nd[1], nd[0], C[1]); stamp2(addB, nd[1], nd[3], C[2]);
          break;
        }
        case "OPAMP": jac(nd, W => Semi.opamp(W, e.model), 1e-6); break;
        case "REG": jac(nd, W => Semi.reg(W, e.model), 1e-6); break;
        case "SHUNT": jac(nd, W => Semi.shunt(W, e.model), 1e-6); break;
        case "TRIODE": jac(nd, V => { const [ia, ig] = tubeCurrents(e, V[0] - V[2], V[1] - V[2]); return [ia, ig, -(ia + ig)]; }, 1e-3); break;
        case "PENTODE": jac(nd, V => { const [ia, ig, ig2] = tubeCurrents(e, V[0] - V[3], V[1] - V[3], V[2] - V[3]); return [ia, ig, ig2, -(ia + ig + ig2)]; }, 1e-3); break;
        // a 555: its output stage as it stands at the operating point, the latch fixed
        case "TIMER555": { Gm[at(e.latch, e.latch)] = 1; const q = latchOf(e, x); jac([nd[0], nd[2], nd[6], nd[7]], V => timerCurrents(V, q), 1e-4); break; }
        case "GLOW": { Gm[at(e.latch, e.latch)] = 1; const q = latchOf(e, x); jac(nd, V => glowCurrents(V, e.model, q), 1e-4); break; }
        case "RELAY": {
          Gm[at(e.latch, e.latch)] = 1;
          const q = latchOf(e, x), gon = 1 / e.model.ron, goff = 1 / e.model.roff;
          for (let p = 2; p + 2 < nd.length; p += 3) { stamp2(addG, nd[p], nd[p + 1], q ? goff : gon); stamp2(addG, nd[p], nd[p + 2], q ? gon : goff); }
          break;
        }
        // the cell at its operating point: its light does not follow an audio-rate signal
        case "LDR": Gm[at(e.light, e.light)] = 1; stamp2(addG, nd[0], nd[1], ldrG(e.model, x[e.light])[0]); break;
      }
    }
    return { ok: true, circ, n, nN, Gm, Bm, rhs, x };
  }
  // Y(ω) solved for several right-hand sides at once (each [re, im] of length n, overwritten with
  // the solution), or with Yᵀ (transpose: the adjoint, for noise); complex Gaussian elimination
  // with partial pivoting. false: singular.
  function acSolve(sys, w, rhsList, transpose) {
    const n = sys.n, Gm = sys.Gm, Bm = sys.Bm, at = (i, j) => i * n + j;
    const Ar = sys.Ar || (sys.Ar = new Float64Array(n * n)), Ai = sys.Ai || (sys.Ai = new Float64Array(n * n));
    if (transpose) { for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { Ar[at(i, j)] = Gm[at(j, i)]; Ai[at(i, j)] = w * Bm[at(j, i)]; } }
    else for (let i = 0; i < n * n; i++) { Ar[i] = Gm[i]; Ai[i] = w * Bm[i]; }
    const R = rhsList.length;
    for (let c = 0; c < n; c++) {
      let p = c, best = 0;
      for (let r = c; r < n; r++) { const m = Ar[at(r, c)] * Ar[at(r, c)] + Ai[at(r, c)] * Ai[at(r, c)]; if (m > best) { best = m; p = r; } }
      if (!(best > 0)) return false;
      if (p !== c) {
        for (let j = 0; j < n; j++) { let t = Ar[at(c, j)]; Ar[at(c, j)] = Ar[at(p, j)]; Ar[at(p, j)] = t; t = Ai[at(c, j)]; Ai[at(c, j)] = Ai[at(p, j)]; Ai[at(p, j)] = t; }
        for (let q = 0; q < R; q++) { const [br, bi] = rhsList[q]; let t = br[c]; br[c] = br[p]; br[p] = t; t = bi[c]; bi[c] = bi[p]; bi[p] = t; }
      }
      const pr = Ar[at(c, c)], pi = Ai[at(c, c)], pm = pr * pr + pi * pi;
      for (let r = c + 1; r < n; r++) {
        const xr = Ar[at(r, c)], xi = Ai[at(r, c)];
        if (xr === 0 && xi === 0) continue;
        const fr = (xr * pr + xi * pi) / pm, fi = (xi * pr - xr * pi) / pm;   // factor = A[r][c] / A[c][c]
        for (let j = c + 1; j < n; j++) {
          const ar = Ar[at(c, j)], ai = Ai[at(c, j)];
          if (ar === 0 && ai === 0) continue;
          Ar[at(r, j)] -= fr * ar - fi * ai; Ai[at(r, j)] -= fr * ai + fi * ar;
        }
        for (let q = 0; q < R; q++) { const [br, bi] = rhsList[q]; br[r] -= fr * br[c] - fi * bi[c]; bi[r] -= fr * bi[c] + fi * br[c]; }
        Ar[at(r, c)] = 0; Ai[at(r, c)] = 0;
      }
    }
    for (let q = 0; q < R; q++) {
      const [br, bi] = rhsList[q];
      for (let c = n - 1; c >= 0; c--) {
        let sr = br[c], si = bi[c];
        for (let j = c + 1; j < n; j++) { const ar = Ar[at(c, j)], ai = Ai[at(c, j)]; if (ar === 0 && ai === 0) continue; sr -= ar * br[j] - ai * bi[j]; si -= ar * bi[j] + ai * br[j]; }
        const pr = Ar[at(c, c)], pi = Ai[at(c, c)], pm = pr * pr + pi * pi;
        br[c] = (sr * pr + si * pi) / pm; bi[c] = (si * pr - sr * pi) / pm;
      }
    }
    return true;
  }
  // the sweep's frequencies, points kFrom … kTo − 1 of the whole (workers share a sweep this way;
  // each frequency is solved on its own, so the pieces are the whole sweep's values exactly)
  function acFreqs(opts) {
    const fStart = opts.fStart || 10, fStop = opts.fStop || 100e3, KA = acPoints(opts);
    const k0 = Math.max(0, Math.min(KA, opts.kFrom || 0)), K = Math.max(0, Math.min(KA, opts.kTo === undefined ? KA : opts.kTo) - k0);
    const freqs = new Float64Array(K);
    for (let k = 0; k < K; k++) freqs[k] = fStart * Math.pow(fStop / fStart, (k0 + k) / (KA - 1));
    return freqs;
  }
  function acSweep(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), sys = acLinearize(netlist, opts);
    if (!sys.ok) return sys;
    const { n, nN, rhs } = sys, freqs = acFreqs(opts), K = freqs.length, re = [], im = [];
    for (let i = 0; i < nN; i++) { re.push(new Float64Array(K)); im.push(new Float64Array(K)); }
    // opts.currents: element ids whose branch current is wanted (a V source's: from its node a through it to b)
    const cur = (opts.currents || []).map(id => sys.circ.els.find(e => e.id === id)).map(e => ({ e, re: new Float64Array(K), im: new Float64Array(K) }));
    const br = new Float64Array(n), bi = new Float64Array(n);
    for (let k = 0; k < K; k++) {
      for (let i = 0; i < n; i++) { br[i] = rhs[i]; bi[i] = rhs[n + i]; }
      if (!acSolve(sys, 2 * Math.PI * freqs[k], [[br, bi]])) return { ok: false, error: "singular matrix at " + freqs[k].toPrecision(3) + " Hz" };
      for (let i = 1; i < nN; i++) { re[i][k] = br[i - 1]; im[i][k] = bi[i - 1]; }
      cur.forEach(c => { if (c.e && c.e.branch !== undefined) { c.re[k] = br[c.e.branch]; c.im[k] = bi[c.e.branch]; } });
    }
    // probes [[node, ref], …]: v(node) − v(ref), as a scope channel against its common
    const probes = (opts.probes || []).map(([a, b]) => { const pr = new Float64Array(K), pi = new Float64Array(K); for (let k = 0; k < K; k++) { pr[k] = re[a][k] - re[b][k]; pi[k] = im[a][k] - im[b][k]; } return { re: pr, im: pi }; });
    return { ok: true, freqs, re, im, probes, currents: cur.map(c => ({ re: c.re, im: c.im })), elapsedMs: Date.now() - t0 };
  }

  // ---------------------------------------------------------------------------
  // Loop gain (return ratio) of a feedback loop, by Middlebrook's double injection. The loop is
  // broken at one terminal of a part, opts.at = { id, pin }: that terminal moves to a node of its
  // own (the load side, y), the node it left is the driving side (x), and a 0 V source joins them.
  // A voltage injected in series gives Tv = −v(x) / v(y); a current injected into the junction
  // gives Ti = −i(x→y) / i(into the load). T = (Tv·Ti − 1) / (Tv + Ti + 2), exact for one loop
  // whatever the impedances either side. T is positive for negative feedback (closed loop 1/(1+T)).
  //   opts: as acSweep's (op, fStart, fStop, perDecade, kFrom, kTo); the other sources are shorts.
  //   returns { ok, freqs, re, im } of T
  // ---------------------------------------------------------------------------
  function loopGain(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), at = opts.at || {}, el = netlist.elements.find(e => e.id === at.id && (at.part === undefined || e.part === at.part));
    if (!el || !(at.pin >= 0 && at.pin < el.nodes.length)) return { ok: false, error: "No such break point" };
    const xN = el.nodes[at.pin], y = netlist.nodeCount;
    const elements = netlist.elements.map(e => (e === el ? Object.assign({}, e, { nodes: e.nodes.map((k, i) => (i === at.pin ? y : k)) }) : e));
    elements.push({ id: "#loop-v", kind: "V", nodes: [y, xN], v: 0 }, { id: "#loop-i", kind: "I", nodes: [0, y], i: 0 });
    const op = opts.op ? Array.from(opts.op).concat([opts.op[xN] || 0]) : null;
    const nl = { nodeCount: y + 1, elements };
    const sys = acLinearize(nl, Object.assign({}, opts, { op }));
    if (!sys.ok) return sys;
    const n = sys.n, vs = sys.circ.els.find(e => e.id === "#loop-v"), freqs = acFreqs(opts), K = freqs.length;
    const Tre = new Float64Array(K), Tim = new Float64Array(K);
    const v = [new Float64Array(n), new Float64Array(n)], c = [new Float64Array(n), new Float64Array(n)];
    const cdiv = (a, b, p, q) => { const m = p * p + q * q || 1e-300; return [(a * p + b * q) / m, (b * p - a * q) / m]; };
    for (let k = 0; k < K; k++) {
      v[0].fill(0); v[1].fill(0); c[0].fill(0); c[1].fill(0);
      v[0][vs.branch] = 1;           // v(y) − v(x) = 1
      c[0][y - 1] = 1;               // 1 A into y
      if (!acSolve(sys, 2 * Math.PI * freqs[k], [v, c])) return { ok: false, error: "singular matrix at " + freqs[k].toPrecision(3) + " Hz" };
      const vx = xN > 0 ? [v[0][xN - 1], v[1][xN - 1]] : [0, 0], vy = [v[0][y - 1], v[1][y - 1]];
      const tv = cdiv(-vx[0], -vx[1], vy[0], vy[1]);
      // the source's current runs from y through it to x: the driving side sends ix = −that into the junction,
      // the load takes ix + 1, so Ti = −ix / (ix + 1); T multiplied through by (ix + 1), which is 0 where the
      // driving side is an ideal source (Ti infinite, T = Tv): T = −(Tv·ix + ix + 1) / ((Tv + 2)(ix + 1) − ix)
      const ixr = -c[0][vs.branch], ixi = -c[1][vs.branch];
      const nr = -(tv[0] * ixr - tv[1] * ixi + ixr + 1), ni = -(tv[0] * ixi + tv[1] * ixr + ixi);
      const ar = tv[0] + 2, ai = tv[1], br = ixr + 1, bi = ixi;
      const t = cdiv(nr, ni, ar * br - ai * bi - ixr, ar * bi + ai * br - ixi);
      Tre[k] = t[0]; Tim[k] = t[1];
    }
    return { ok: true, freqs, re: Tre, im: Tim, elapsedMs: Date.now() - t0 };
  }

  // ---------------------------------------------------------------------------
  // Noise: every noise source of the linearized circuit, as a current between two nodes, carried
  // to the output by the adjoint (one solve with Yᵀ per frequency gives the transfer from a current
  // at any node to the output voltage). Sources (one-sided, A²/Hz):
  //   resistor 4kT/R; triode (anode–cathode) 4kT·Req·gm² with Req = 2.5/gm, a pentode's Req with
  //   partition noise, (Ia/Ik)(2.5/gm + 20·Ig2/gm²), times (1 + fc/f) for flicker (opts.flicker: fc in
  //   Hz); BJT collector shot 2qIc and base shot 2qIb; MOSFET/JFET channel 4kT·(2/3)gm; diode shot 2qI.
  // Op-amps, regulators and the rest are noiseless here.
  //   opts: as acSweep's, plus out: [node, ref], input: a source's id (the gain from it), tempK (300)
  //   returns { ok, freqs, total (V²/Hz at the output), gain: { re, im }, sources: [{ id, kind, psd }] }
  // ---------------------------------------------------------------------------
  function noiseSweep(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), sys = acLinearize(netlist, Object.assign({}, opts, { inputs: [] }));
    if (!sys.ok) return sys;
    const { n, x } = sys, kT = 1.380649e-23 * (opts.tempK || 300), q = 1.602176634e-19, fc = Math.max(0, opts.flicker || 0);
    const src = [];
    const add = (e, a, b, S, flick) => { if (S > 0 && isFinite(S) && a !== b) src.push({ id: e.id, kind: e.kind, a, b, S, flick: !!flick }); };
    for (const e of sys.circ.els) {
      const nd = e.nodes, V = nd.map(k => vn(x, k));
      switch (e.kind) {
        case "R": add(e, nd[0], nd[1], 4 * kT / Math.max(e.r, 1e-6)); break;
        case "TRIODE": case "PENTODE": {
          const pent = e.kind === "PENTODE", k = pent ? 3 : 2, d = 1e-3;
          const I = g => tubeCurrents(e, V[0] - V[k], V[1] - V[k] + g, pent ? V[2] - V[k] : undefined);
          const i0 = I(0), gm = (I(d)[0] - I(-d)[0]) / (2 * d);
          if (!(gm > 1e-9) || !(i0[0] > 0)) break;
          const ig2 = pent ? Math.max(0, i0[2]) : 0, req = (i0[0] / (i0[0] + ig2)) * (2.5 / gm + 20 * ig2 / (gm * gm));
          add(e, nd[0], nd[k], 4 * kT * req * gm * gm, true);
          break;
        }
        case "BJT": { const I = Semi.bjt(V, e.model); add(e, nd[0], nd[2], 2 * q * Math.abs(I[0])); add(e, nd[1], nd[2], 2 * q * Math.abs(I[1])); break; }
        case "MOS": case "MOS4": {
          const d = 1e-5, Vp = V.slice(), Vm = V.slice(), f = e.kind === "MOS4" ? Semi.mosx : Semi.mos; Vp[1] += d; Vm[1] -= d;
          const gm = Math.abs(f(Vp, e.model)[0] - f(Vm, e.model)[0]) / (2 * d);
          add(e, nd[0], nd[2], 4 * kT * (2 / 3) * gm);
          break;
        }
        case "D": { const Is = e.is || 2.5e-9, nVt = (e.n || 1.75) * 0.025852, id = Is * (Math.exp(Math.min((V[0] - V[1]) / nVt, 80)) - 1); add(e, nd[0], nd[1], 2 * q * Math.abs(id)); break; }
        case "VDIODE": { const v = V[0] - V[1]; if (v > 0) add(e, nd[0], nd[1], 2 * q * e.perveance * Math.pow(v, 1.5)); break; }
      }
    }
    const [oa, ob] = opts.out || [1, 0], inEl = opts.input ? sys.circ.els.find(e => e.id === opts.input) : null;
    const freqs = acFreqs(opts), K = freqs.length, total = new Float64Array(K), gRe = new Float64Array(K), gIm = new Float64Array(K);
    const psd = src.map(() => new Float64Array(K)), zr = new Float64Array(n), zi = new Float64Array(n);
    for (let k = 0; k < K; k++) {
      zr.fill(0); zi.fill(0);
      if (oa > 0) zr[oa - 1] += 1; if (ob > 0) zr[ob - 1] -= 1;
      if (!acSolve(sys, 2 * Math.PI * freqs[k], [[zr, zi]], true)) return { ok: false, error: "singular matrix at " + freqs[k].toPrecision(3) + " Hz" };
      const Z = i => (i > 0 ? [zr[i - 1], zi[i - 1]] : [0, 0]);
      if (inEl && inEl.branch !== undefined) { gRe[k] = zr[inEl.branch]; gIm[k] = zi[inEl.branch]; }
      let s = 0;
      src.forEach((p, j) => {
        const A = Z(p.a), B = Z(p.b), tr = A[0] - B[0], ti = A[1] - B[1];
        const v = p.S * (p.flick ? 1 + fc / freqs[k] : 1) * (tr * tr + ti * ti);
        psd[j][k] = v; s += v;
      });
      total[k] = s;
    }
    return { ok: true, freqs, total, gain: { re: gRe, im: gIm }, sources: src.map((p, j) => ({ id: p.id, kind: p.kind, psd: psd[j] })), elapsedMs: Date.now() - t0 };
  }

  const Engine = { Tube, Koren, Semi, NE555, tubeCurrents, tubeJacobian, capAt, chargeAt, dcPseudoTransient, stuckOf, cathodeWarm, CATHODE, timerCurrents, terminalCurrents, Spice, RECTIFIER_PERVEANCE, simulate, startup, audio, acSweep, acPoints, loopGain, noiseSweep, opMagnetising, coreFlux, buildCircuit, dcOperatingPoint, solveLinear, invertMatrix, SparseMatrix,
    loadWasm, useWasm, solver: () => (wasm ? "wasm" : "js") };
  root.TubeSimEngine = Engine;
})(globalThis);
