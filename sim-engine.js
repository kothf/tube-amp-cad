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
   RELAY (a latched coil with its contacts), LDR (a light-dependent resistor lit by a current)
   acSweep: the small-signal frequency response, linearized at an operating point.
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
    // Grid conduction above 0 V (Child-Langmuir), scaled with tube size
    gridI(vgk, p) {
      return vgk > 0 ? (0.2 / p.kg) * Math.pow(vgk, 1.5) : 0;
    }
  };
  // One entry for every tube model: Koren's equations, or an imported SPICE model
  // (spice-model.js) when the parameters carry one ({ spice: { text, sub, roles } }).
  const Tube = {
    /** [ia, ig] */
    triode(vak, vgk, p) {
      if (p.spice) return root.SpiceModel.tube(p.spice).triode(vak, vgk);
      return [Koren.triodeIa(vak, vgk, p), Koren.gridI(vgk, p)];
    },
    /** [ia, ig, ig2] */
    pentode(vak, vgk, vg2k, p) {
      if (p.spice) return root.SpiceModel.tube(p.spice).pentode(vak, vgk, vg2k);
      return [Koren.pentodeIa(vak, vgk, vg2k, p), Koren.gridI(vgk, p), Koren.screenI(vgk, vg2k, p, vak)];
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
  // A tube element's currents: [ia, ig] or [ia, ig, ig2], with its gridShift and iScale
  function tubeCurrents(e, vak, vgk, vg2k) {
    const sh = e.gridShift || 0, sc = e.iScale || 1, pent = e.kind === "PENTODE";
    const r = pent ? Tube.pentode(vak, vgk + sh, vg2k, e.model) : Tube.triode(vak, vgk + sh, e.model);
    const ig = sh ? (pent ? Tube.pentode(vak, vgk, vg2k, e.model) : Tube.triode(vak, vgk, e.model))[1] : r[1];
    return pent ? [sc * r[0], sc * ig, sc * r[2]] : [sc * r[0], sc * ig];
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
  const Semi = {
    bjt(V, m) {
      const p = m.pol, vbe = p * (V[1] - V[2]), vbc = p * (V[1] - V[0]), vt = m.vt || VT;
      const If = m.is * (Math.exp(Math.min(vbe / ((m.nf || 1) * vt), 80)) - 1), Ir = m.is * (Math.exp(Math.min(vbc / vt, 80)) - 1);
      const q1 = 1 / Math.max(1 - vbc / (m.vaf || 1e9), 0.05), q2 = m.ikf ? Math.max(If, 0) / m.ikf : 0;
      const qb = q1 * (1 + Math.sqrt(1 + 4 * q2)) / 2;
      // leakage: icbo·(1 − e^(vbc/vt)) reverse-biased, carried on linearly (same slope) when forward
      const xl = vbc / vt, lk = m.icbo ? m.icbo * (xl <= 0 ? 1 - Math.exp(xl) : -xl) : 0;
      const icc = (If - Ir) / qb, ib = If / m.bf + Ir / (m.br || 1) - lk, ic = icc - Ir / (m.br || 1) + lk;
      return [p * ic, p * ib, -p * (ic + ib)];
    },
    mos(V, m) {
      const p = m.pol;
      let vds = p * (V[0] - V[2]), vgs = p * (V[1] - V[2]), sw = 1;
      if (vds < 0) { vds = -vds; vgs = p * (V[1] - V[0]); sw = -1; }
      const s = 0.05, vov = s * softplus((vgs - m.vto * p) / s);
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
  function pnjlim(vnew, vold, nVt, vcrit) {
    if (vold !== undefined && vnew > vcrit && Math.abs(vnew - vold) > 2 * nVt) {
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
    this.q = q; this.dirty = false; this.layout = -1;   // the WebAssembly copy of the pattern is out of date
  };
  // A x = b: b is overwritten with x; false when the matrix is singular
  SparseMatrix.prototype.solve = function (b) {
    if (this.dirty) this.analyse();
    return wasm ? this.solveWasm(b) : this.solveJS(b);
  };
  // the WebAssembly kernel (wasm/solver.ts): the same steps as solveJS. The arrays live in its
  // memory; the pattern's go in when it changes, the values and b on every solve.
  SparseMatrix.prototype.solveWasm = function (b) {
    const n = this.n, nz = this.nnz;
    for (;;) {
      if (wasm.owner !== this || this.layout !== wasm.layoutId) this.place();
      const L = this.lay, mem = wasm.memory.buffer, F = new Float64Array(mem), vals = this.vals;
      for (let s = 0; s < nz; s++) F[(L.vals >> 3) + s] = vals[s];
      for (let i = 0; i < n; i++) F[(L.b >> 3) + i] = b[i];
      const r = wasm.solve(n, L.tab);
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
    this.lay = L; wasm.owner = this; this.layout = wasm.layoutId = (wasm.layoutId || 0) + 1;
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
    // P b, then L, then U, then the column order back
    for (let i = 0; i < n; i++) x[pinv[i]] = b[i];
    for (let k = 0; k < n; k++) { const v = x[k]; if (v === 0) continue; for (let p = Lp[k] + 1; p < Lp[k + 1]; p++) x[pinv[Li[p]]] -= Lx[p] * v; }
    for (let k = n - 1; k >= 0; k--) { const d = Up[k + 1] - 1; x[k] /= Ux[d]; const v = x[k]; if (v === 0) continue; for (let p = Up[k]; p < d; p++) x[Ui[p]] -= Ux[p] * v; }
    for (let k = 0; k < n; k++) b[q[k]] = x[k];
    return true;
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
    try { const ex = new WebAssembly.Instance(wasmModule, {}).exports; wasm = { solve: ex.solve, memory: ex.memory, owner: null, layoutId: 0 }; } catch (e) { wasm = null; }
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
  // Circuit build: assign unknown indices
  // ---------------------------------------------------------------------------
  function buildCircuit(netlist) {
    const nNodes = netlist.nodeCount;            // includes ground (0)
    let nUnk = nNodes - 1;
    const els = netlist.elements.map(e => Object.assign({}, e));
    els.forEach(e => {
      if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L" || e.kind === "E") e.branch = nUnk++;
      else if (LATCHED.has(e.kind)) e.latch = nUnk++;
      else if (e.kind === "LDR") e.light = nUnk++;
      else if (e.kind === "XFMR") {
        e.branches = e.windings.map(() => nUnk++);
        // Inductance matrix: L_jk = AL * Nj * Nk * (j===k ? 1 : k)
        const W = e.windings.length;
        const AL = e.lp / Math.pow(e.primaryTurns, 2);
        e.Lmat = new Array(W * W);
        for (let j = 0; j < W; j++) for (let k = 0; k < W; k++) {
          const nj = e.windings[j].turns, nk = e.windings[k].turns;
          e.Lmat[j * W + k] = AL * nj * nk * (j === k ? 1 : e.k);
        }
      }
    });
    // a 555's output and discharge pins: their transistors' currents level off a volt or so into
    // conduction, so far from the solution Newton sees no slope there and would throw the pin
    // anywhere; these nodes move at most 2 V an iteration, outside the common damping, and half as far
  // each time they turn back (newtonSolve)
    const timers = els.filter(e => LATCHED.has(e.kind)), t555 = timers.filter(e => e.kind === "TIMER555"), capped = t555.length ? new Uint8Array(nNodes) : null;
    t555.forEach(e => [e.nodes[2], e.nodes[6]].forEach(k => { if (k > 0) capped[k - 1] = 1; }));
    return { nNodes, nUnk, els, timers, capped };
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
  function newtonSolve(circ, x0, mode, opts) {
    const n = circ.nUnk;
    const x = x0.slice();
    const A = circ.matrix && circ.matrix.n === n ? circ.matrix : (circ.matrix = new SparseMatrix(n));   // kept with the circuit: its pattern and column order
    const b = new Float64Array(n);
    const gmin = opts.gmin;
    const maxStep = mode.dc ? 25 : 15;
    const maxIter = mode.dc ? 300 : 60;
    const srcScale = opts.srcScale === undefined ? 1 : opts.srcScale;

    const addA = (i, j, v) => { if (i > 0 && j > 0) A.add(i - 1, j - 1, v); };
    const addB = (i, v) => { if (i > 0) b[i - 1] += v; };
    const addAu = (r, c, v) => { A.add(r, c, v); };   // raw unknown indices
    const stampG = (a, c, g) => { addA(a, a, g); addA(c, c, g); addA(a, c, -g); addA(c, a, -g); };
    // Nonlinear device: currents into each terminal I(V) linearized at V0
    // I(V) ~= I0 + J (V - V0)  ->  A += J,  b += J V0 - I0
    // dAbs: a fixed difference step (V) for exponential devices, where 1 ppm of a
    // few hundred volts would already be a coarse step
    const stampNonlinear = (nodes, fn, V0, dAbs) => {
      const I0 = fn(V0);
      const m = nodes.length;
      const rhs = I0.map(v => -v);
      for (let s = 0; s < m; s++) {
        const d = dAbs || 1e-6 * Math.max(1, Math.abs(V0[s]));
        const Vp = V0.slice(); Vp[s] += d;
        const Ip = fn(Vp);
        for (let t = 0; t < m; t++) {
          const J = (Ip[t] - I0[t]) / d;
          if (J === 0) continue;
          addA(nodes[t], nodes[s], J);
          rhs[t] += J * V0[s];
        }
      }
      for (let t = 0; t < m; t++) addB(nodes[t], rhs[t]);
    };

    // integration: backward Euler (a0 = 1, a1 = −1), or Gear's second-order BDF2 (3/2, −2, 1/2)
    // when the step before was as long as this one: second-order accurate, so resonances keep
    // their Q, and still strongly damped at high frequencies (no trapezoidal ringing at a
    // rectifier's switching)
    const P2 = !mode.dc && mode.prev2 ? mode.prev2 : null, ID0 = P2 ? 1.5 : 1, ID1 = P2 ? -2 : -1, ID2 = 0.5;
    let lastDv = null, stall = 0;
    const capStep = circ.capped ? new Float64Array(circ.nNodes).fill(2) : null, capDir = capStep ? new Float64Array(circ.nNodes) : null;
    for (let iter = 0; iter < maxIter; iter++) {
      A.clear(); b.fill(0);
      let limited = false;   // a junction voltage was limited: this iterate is not a solution yet
      for (let i = 1; i < circ.nNodes; i++) addA(i, i, gmin);

      for (const e of circ.els) {
        const nd = e.nodes;
        switch (e.kind) {
          case "R": stampG(nd[0], nd[1], 1 / Math.max(e.r, 1e-6)); break;
          case "C":
            if (!mode.dc) {
              // i = C/h · (a0·v + a1·v₋₁ + a2·v₋₂): backward Euler, or Gear-2 with history
              const k = e.c / mode.h, v1 = vn(mode.prev, nd[0]) - vn(mode.prev, nd[1]);
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
            for (let j = 0; j < W; j++) {
              const w = e.windings[j], br = e.branches[j];
              if (w.a > 0) { addAu(w.a - 1, br, 1); addAu(br, w.a - 1, 1); }
              if (w.b > 0) { addAu(w.b - 1, br, -1); addAu(br, w.b - 1, -1); }
              addAu(br, br, -R_SERIES);
              if (!mode.dc) {
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
            const P = e.perveance;
            const V0 = [vn(x, nd[0]), vn(x, nd[1])];
            stampNonlinear(nd, V => { const v = V[0] - V[1]; const i = v > 0 ? P * Math.pow(v, 1.5) : 0; return [i, -i]; }, V0);
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
            stampNonlinear(nd, W => Semi.bjt(W, e.model), [vb - p * vbc, vb, V[2]], 1e-7);
            break;
          }
          case "MOS":
            stampNonlinear(nd, W => Semi.mos(W, e.model), nd.map(k => vn(x, k)), 1e-6);
            break;
          case "OPAMP":
            stampNonlinear(nd, W => Semi.opamp(W, e.model, mode.dc, e._gain), nd.map(k => vn(x, k)), 1e-6);
            break;
          case "REG":
            stampNonlinear(nd, W => Semi.reg(W, e.model, e._gain, e._lin), nd.map(k => vn(x, k)), 1e-6);
            break;
          case "SHUNT":
            stampNonlinear(nd, W => Semi.shunt(W, e.model, e._gain, e._lin), nd.map(k => vn(x, k)), 1e-6);
            break;
          case "TRIODE": {
            const V0 = nd.map(k => vn(x, k));   // A, G, K
            stampNonlinear(nd, V => {
              const [ia, ig] = tubeCurrents(e, V[0] - V[2], V[1] - V[2]);
              return [ia, ig, -(ia + ig)];
            }, V0);
            break;
          }
          case "PENTODE": {
            const V0 = nd.map(k => vn(x, k));   // A, G1, G2, K
            stampNonlinear(nd, V => {
              const [ia, ig, ig2] = tubeCurrents(e, V[0] - V[3], V[1] - V[3], V[2] - V[3]);
              return [ia, ig, ig2, -(ia + ig + ig2)];
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
      }

      const sol = Array.from(b);
      if (!A.solve(sol)) return { ok: false, x, error: "singular matrix" };

      // Damped update on node voltages
      let maxDv = 0;
      const cap = circ.capped;
      for (let i = 0; i < circ.nNodes - 1; i++) if (!(cap && cap[i])) maxDv = Math.max(maxDv, Math.abs(sol[i] - x[i]));
      let scale = maxDv > maxStep ? maxStep / maxDv : 1;
      let conv = scale === 1;
      // an iteration that is not getting closer (bouncing across a device's
      // turn-on, say) takes half a step
      if (iter >= 8 && lastDv !== null && maxDv > 0.9 * lastDv && maxDv > 1e-4) { scale *= 0.5; conv = false; }
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
      const floor = 1e-4 + 5e-6 * vmax;
      if (conv && iter > 0 && !limited) return { ok: true, x, iter };
      // Round-off floor: with hundreds of volts on some nodes the solution can
      // settle into a microvolt-level wobble that never meets the 1 µV test
      // (whether it does depends on node order). An update below 100 µV (and
      // 5 ppm of the largest node voltage: a bridge's AC side, floating on
      // junctions of a few milliohms, wobbles more) that has stopped shrinking
      // for a few iterations is converged.
      if (maxDv < floor && lastDv !== null && maxDv > 0.5 * lastDv && !limited) { if (++stall >= 3) return { ok: true, x, iter }; }
      else stall = 0;
      lastDv = maxDv;
    }
    return { ok: false, x, error: "no convergence" };
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
  // from zero (with the 555 latches as x0 holds them)
  function dcSolve(circ, x0) {
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
    // gmin stepping
    let x = zero;
    for (const g of [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7, 1e-8, 1e-9]) {
      r = newtonSolve(circ, x, { dc: true }, { gmin: g });
      if (!r.ok) break;
      x = r.x;
    }
    if (r.ok) return r;
    // source stepping
    x = zero;
    for (let s = 1; s <= 20; s++) {
      r = newtonSolve(circ, x, { dc: true }, { gmin: 1e-9, srcScale: s / 20 });
      if (!r.ok) return r;
      x = r.x;
    }
    return r;
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
    if (e.kind === "VDIODE") { const vd = v[0] - v[1]; return { vd, i: vd > 0 ? e.perveance * Math.pow(vd, 1.5) : 0 }; }
    if (e.kind === "D") { const vd = v[0] - v[1]; return { vd, i: (e.is || 2.5e-9) * (Math.exp(Math.min(vd / ((e.n || 1.75) * 0.025852), 80)) - 1) }; }
    if (e.kind === "R") { const vd = v[0] - v[1]; return { vd, i: vd / e.r }; }
    if (e.kind === "V" || e.kind === "VSRC" || e.kind === "L") return { i: x[e.branch], vd: v[0] - v[1] };
    if (e.kind === "C") return { vd: v[0] - v[1] };
    if (e.kind === "I") return { i: e.i, vd: v[0] - v[1] };
    if (e.kind === "E") return { i: x[e.branch], vd: v[0] - v[1], vc: v[2] - v[3] };
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
      case "D": return two(deviceState(e, x).i);
      case "VDIODE": return two(deviceState(e, x).i);
      case "XFMR": { const out = []; e.windings.forEach((w, j) => { const i = x[e.branches[j]]; out.push([w.a, i], [w.b, -i]); }); return out; }
      case "TRIODE": { const s = deviceState(e, x); return [[nd[0], s.ia], [nd[1], s.ig], [nd[2], -(s.ia + s.ig)]]; }
      case "PENTODE": { const s = deviceState(e, x); return [[nd[0], s.ia], [nd[1], s.ig], [nd[2], s.ig2], [nd[3], -(s.ia + s.ig + s.ig2)]]; }
      case "BJT": return Semi.bjt(v, e.model).map((i, k) => [nd[k], i]);
      case "MOS": return Semi.mos(v, e.model).map((i, k) => [nd[k], i]);
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
      const tc = e.kind === "C" ? (() => { const nd = e.nodes, i = e.c * ((vn(x, nd[0]) - vn(x, nd[1])) - (vn(xp, nd[0]) - vn(xp, nd[1]))) / h; return [[nd[0], i], [nd[1], -i]]; })() : terminalCurrents(e, x);
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
  // Full analysis: DC operating point + periodic steady-state transient
  //   opts.warm: where the settling starts instead of the DC point, the result.warm of a run of the
  //   same circuit with other part values (tolerance runs); it changes how long the run takes, not
  //   where it settles. result.warm: the settled state at a period's start, before the capture.
  // ---------------------------------------------------------------------------
  // Inrush limiters (NTC thermistors): an R element with ntc { r25, k, n } runs at its self-heated
  // resistance R = min(r25, k·I^−n) for its rms current I (the makers' law). The body's thermal time
  // constant (tens of seconds) is far longer than any capture, so in the steady state it holds one
  // value through the cycle: the run is repeated from its last settled state, R moved partway toward
  // that law each time, until R changes by under 1 %. result.ntc: { id: { r, i } }, the resistance
  // each ran at and its rms current. The power-on transient (startup) keeps r25: the part starts cold.
  function simulate(netlist, opts) {
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
        const i = rmsCurrent(r, e), want = Math.min(e.ntc.r25, e.ntc.k * Math.pow(Math.max(i, 1e-12), -e.ntc.n));
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
      return result;
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
    const solveStep = (xprev, tNext, hh, depth) => {
      const gear = !depth && xBack && Math.abs(hBack - hh) <= 1e-9 * hh;
      const r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev, prev2: gear ? xBack : null }, { gmin: 1e-12 });
      if (r.ok) { if (!depth) { xBack = xprev; hBack = hh; } return r.x; }
      if ((depth || 0) >= 2) return null;
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
        if (!runPeriod(hc, coarseSteps)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
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
            if (Math.sqrt(rho) < 0.1 * beta || h[j + 1] < 1e-12) break;
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
          if (!moved || norm(resid(ph, s)) > 0.8 * beta) break;   // Newton no longer gains: the plain settling takes over
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
        if (!runPeriod(hc, coarseSteps)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
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
        if (!runPeriod(h, stepsPerPeriod)) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
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
      const fail = () => { circ.onFlip = null; result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; };
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
    // (an op-amp's trace is its clip: how far past its output limit it is driven)
    const devIdx = circ.els.filter(e => e.kind === "TRIODE" || e.kind === "PENTODE" || e.kind === "VDIODE" || e.kind === "D" || e.kind === "OPAMP");
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
    const record = (k) => {
      if (frAt.has(k)) { frames.at.push(k); frames.cur.push(instantCurrents(circ, x, xPrev, h, new Float32Array(frames.layout.length / 3))); }
      xPrev = x;
      for (let i = 1; i < nodeCount; i++) nodes[i][k] = x[i - 1];
      const acc = averaged && k < nCap - 1;   // the last sample repeats the first: one exact window
      if (acc) for (let i = 1; i < nodeCount; i++) nodeSum[i] += x[i - 1];
      devIdx.forEach(e => {
        const s = deviceState(e, x), tr = devTrace[e.id + (e.part ? "#" + e.part : "")];
        tr.i[k] = s.ia !== undefined ? s.ia : s.i !== undefined ? s.i : s.clip;
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
      if (!nx) { result.error = "Transient did not converge at t=" + (t * 1000).toFixed(3) + " ms"; return result; }
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
    if (settled) progress(1);
    result.ok = true;
    result.elapsedMs = Date.now() - t0; result.solver = wasm ? "wasm" : "js";
    return result;
  }

  // Behavioural-source expressions for SPICE export: the exact equations above
  const g = v => Number(v.toPrecision(6));
  const Spice = {
    // an op-amp as a subcircuit (pins IN+ IN− OUT V+ V− N1 N2) of current sources, Semi.opamp term
    // by term; the shared terms are behavioural voltages on inner nodes (a current X as X volts)
    opamp: (m, name) => {
      const sp = x => `0.05*(max((${x})/0.05,0)+ln(1+exp(-abs((${x})/0.05))))`, pos = X => `${X}/(1+exp(limit(-${X}*1e9,-60,60)))`;
      const L = [`.subckt ${name} INP INN OUT VP VN N1 N2`, `RIN INP INN ${g(m.rin)}`,
        "BON ON 0 V=1/(1+exp(-(V(VP,VN)-2)/0.3))", "BVM VM 0 V=(V(VP)+V(VN))/2",
        `BHI HI 0 V=max(V(VP)-${g(m.dhi)},V(VM))`, `BLO LO 0 V=min(V(VN)+${g(m.dlo)},V(VM))`,
        `BX1 X1 0 V=-${g(m.i1)}*tanh(${g(m.gm1 / m.i1)}*V(INP,INN))*V(ON)`, `BX2 X2 0 V=-${g(m.i2)}*tanh(${g(m.gm2 / m.i2)}*V(N1,VM))*V(ON)`,
        `BVT VT 0 V=V(N2)-${sp("V(N2)-V(HI)")}+${sp("V(LO)-V(N2)")}`,
        `BXO XO 0 V=if(V(VT,OUT)>0,${g(m.isc)}*tanh(V(VT,OUT)/${g(m.ro * m.isc)}),${g(m.isk)}*tanh(V(VT,OUT)/${g(m.ro * m.isk)}))*V(ON)`];
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
    shunt: (m, name) => {
      const sp = (x, w) => `${w}*(max((${x})/${w},0)+ln(1+exp(-abs((${x})/${w}))))`;
      return [`.subckt ${name} K A REF`, `BK K A I=${g(m.imax)}*tanh(${sp(`${g(m.gm)}*(V(REF,A)-${g(m.vref)})`, 2e-4)}/${g(m.imax)})*tanh(${sp("V(K,A)-1", 0.05)}/0.5)`,
        `ROFF K A ${g(m.roff)}`, `RREF REF A ${g(m.rref)}`, ".ends"];
    },
    triode: m => ({
      plate: `pwr(max(V(A,K)/${g(m.kp)}*ln(1+exp(${g(m.kp)}*(1/${g(m.mu)}+V(G,K)/sqrt(${g(m.kvb)}+V(A,K)*V(A,K))))),0),${g(m.x)})*${g(2 / m.kg)}`,
      grid: `${g(0.2 / m.kg)}*pwr(max(V(G,K),0),1.5)`
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
        grid: `${g(0.2 / m.kg)}*pwr(max(V(G1,K),0),1.5)`
      };
    }
  };

  // ---------------------------------------------------------------------------
  // Power-on transient: the circuit starts cold (every node at 0 V, capacitors
  // empty, no current in inductors) and all sources switch on at t = 0. Steps
  // through tStop and returns only the probed nodes, compressed to at most
  // maxPoints buckets, each holding the minimum and maximum of its samples, so
  // an audio signal over a second of supply settling still shows its envelope.
  //   opts: { tStop, probes: [[node, refNode]...], maxPoints, budgetMs, onProgress(f) }
  //   each probe reads v(node) - v(refNode), like a scope channel against its common
  // ---------------------------------------------------------------------------
  function startup(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), tStop = Math.max(opts.tStop || 1, 1e-4), budgetMs = opts.budgetMs || 300000;
    const circ = buildCircuit(netlist), n = circ.nUnk;
    const result = { ok: false, warnings: [] };
    if (circ.nNodes < 2) { result.error = "Circuit is empty"; return result; }
    circ.els.forEach(e => { delete e._vlast; });
    const freqs = circ.els.filter(e => e.kind === "VSRC" && e.freq > 0 && e.amp !== 0).map(e => e.freq);
    const fMax = freqs.length ? Math.max.apply(null, freqs) : 0;
    // 40 steps per period of the fastest source, at least 2000 steps over the run (20000 with a
    // 555, whose own period the sources do not tell)
    let h = Math.min(fMax ? 1 / (40 * fMax) : Infinity, tStop / (circ.timers.some(e => e.kind !== "RELAY") ? 20000 : 2000));
    const steps = Math.ceil(tStop / h); h = tStop / steps;
    const probes = (opts.probes || []).map(p => Array.isArray(p) ? p : [p, 0]).filter(([a, b]) => a >= 0 && a < circ.nNodes && b >= 0 && b < circ.nNodes);
    const nOut = Math.min(opts.maxPoints || 4000, steps), per = steps / nOut;
    const mins = probes.map(() => new Float32Array(nOut)), maxs = probes.map(() => new Float32Array(nOut));
    mins.forEach(a => a.fill(Infinity)); maxs.forEach(a => a.fill(-Infinity));
    let xBack = null, hBack = 0;          // BDF2 history, as in simulate()
    const solveStep = (xprev, tNext, hh, depth) => {
      const gear = !depth && xBack && Math.abs(hBack - hh) <= 1e-9 * hh;
      const r = newtonSolve(circ, xprev, { h: hh, t: tNext, prev: xprev, prev2: gear ? xBack : null }, { gmin: 1e-12 });
      if (r.ok) { if (!depth) { xBack = xprev; hBack = hh; } return r.x; }
      if ((depth || 0) >= 3) return null;
      let xs = xprev;
      for (let k = 1; k <= 8; k++) { xs = solveStep(xs, tNext - hh + hh * k / 8, hh / 8, (depth || 0) + 1); if (!xs) return null; }
      if (!depth) xBack = null;
      return xs;
    };
    const step = (xprev, tNext, hh) => timerStep(circ, solveStep, xprev, tNext, hh);
    let x = new Array(n).fill(0), lastProg = 0;
    const record = (s, x) => {
      const b = Math.min(nOut - 1, Math.floor(s / per));
      probes.forEach(([p, q], j) => { const v = vn(x, p) - vn(x, q); if (v < mins[j][b]) mins[j][b] = v; if (v > maxs[j][b]) maxs[j][b] = v; });
    };
    record(0, x);
    for (let s = 1; s <= steps; s++) {
      const nx = step(x, s * h, h);
      if (!nx) { result.error = "Transient did not converge at t=" + (s * h * 1000).toFixed(3) + " ms"; return result; }
      x = nx; record(s, x);
      if (opts.onProgress && s / steps - lastProg >= 0.02) { lastProg = s / steps; opts.onProgress(lastProg); }
      if (Date.now() - t0 > budgetMs) { result.error = `Stopped after ${(s * h).toFixed(3)} s of circuit time: the run took longer than ${Math.round(budgetMs / 1000)} s`; return result; }
    }
    result.ok = true;
    result.tStop = tStop; result.h = h; result.steps = steps; result.points = nOut; result.dt = tStop / nOut;
    result.probes = probes; result.min = mins; result.max = maxs;
    result.elapsedMs = Date.now() - t0;
    return result;
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
  function acSweep(netlist, opts) {
    opts = opts || {};
    const t0 = Date.now(), circ = buildCircuit(netlist), n = circ.nUnk, nN = circ.nNodes;
    if (nN < 2) return { ok: false, error: "Circuit is empty" };
    let x;
    if (opts.op) { x = new Array(n).fill(0); for (let i = 1; i < nN; i++) x[i - 1] = opts.op[i] || 0; }
    else { const dc = dcOperatingPoint(circ); if (!dc.ok) return { ok: false, error: "DC operating point did not converge (" + dc.error + ")" }; x = dc.x; }
    const Gm = new Float64Array(n * n), Bm = new Float64Array(n * n), rhs = new Float64Array(2 * n);
    const at = (i, j) => i * n + j;
    const addG = (i, j, v) => { if (i > 0 && j > 0) Gm[at(i - 1, j - 1)] += v; };
    const addB = (i, j, v) => { if (i > 0 && j > 0) Bm[at(i - 1, j - 1)] += v; };
    const stamp2 = (add, a, b, g) => { add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g); };
    const branch = (a, b, br) => { if (a > 0) { Gm[at(a - 1, br)] += 1; Gm[at(br, a - 1)] += 1; } if (b > 0) { Gm[at(b - 1, br)] -= 1; Gm[at(br, b - 1)] -= 1; } };
    // a device's currents into its terminals, differentiated at the operating point (central differences)
    const jac = (nodes, fn, d) => {
      const V0 = nodes.map(k => vn(x, k)), m = nodes.length;
      for (let s = 0; s < m; s++) {
        const Vp = V0.slice(), Vm = V0.slice(); Vp[s] += d; Vm[s] -= d;
        const Ip = fn(Vp), Im = fn(Vm);
        for (let t = 0; t < m; t++) { const J = (Ip[t] - Im[t]) / (2 * d); if (J) addG(nodes[t], nodes[s], J); }
      }
    };
    const inputs = new Map((opts.inputs || []).map(i => [i.id, i]));
    for (let i = 1; i < nN; i++) addG(i, i, 1e-12);
    for (const e of circ.els) {
      const nd = e.nodes;
      switch (e.kind) {
        case "R": stamp2(addG, nd[0], nd[1], 1 / Math.max(e.r, 1e-6)); break;
        case "C": stamp2(addB, nd[0], nd[1], e.c); break;
        case "L": branch(nd[0], nd[1], e.branch); Gm[at(e.branch, e.branch)] -= R_SERIES; Bm[at(e.branch, e.branch)] -= e.l; break;
        case "XFMR": {
          const W = e.windings.length;
          e.windings.forEach((w, j) => {
            branch(w.a, w.b, e.branches[j]); Gm[at(e.branches[j], e.branches[j])] -= R_SERIES;
            for (let k = 0; k < W; k++) Bm[at(e.branches[j], e.branches[k])] -= e.Lmat[j * W + k];
          });
          break;
        }
        case "E":
          branch(nd[0], nd[1], e.branch);
          if (nd[2] > 0) Gm[at(e.branch, nd[2] - 1)] -= e.gain;
          if (nd[3] > 0) Gm[at(e.branch, nd[3] - 1)] += e.gain;
          break;
        case "G": addG(nd[0], nd[2], e.gm); addG(nd[0], nd[3], -e.gm); addG(nd[1], nd[2], -e.gm); addG(nd[1], nd[3], e.gm); break;
        case "V": case "VSRC": {
          branch(nd[0], nd[1], e.branch);
          const inp = inputs.get(e.id);
          if (inp) { const ph = (inp.phase || 0) * Math.PI / 180, m = inp.mag === undefined ? 1 : inp.mag; rhs[e.branch] = m * Math.cos(ph); rhs[n + e.branch] = m * Math.sin(ph); }
          break;
        }
        case "D": {
          const Is = e.is || 2.5e-9, nVt = (e.n || 1.75) * 0.025852, vd = vn(x, nd[0]) - vn(x, nd[1]), gd = Is * Math.exp(Math.min(vd / nVt, 80)) / nVt;
          stamp2(addG, nd[0], nd[1], gd + 1e-12);
          if (e.tt) stamp2(addB, nd[0], nd[1], e.tt * gd);   // diffusion capacitance
          break;
        }
        case "VDIODE": { const P = e.perveance; jac(nd, V => { const v = V[0] - V[1]; const i = v > 0 ? P * Math.pow(v, 1.5) : 0; return [i, -i]; }, 1e-3); break; }
        case "BJT": jac(nd, W => Semi.bjt(W, e.model), 1e-6); break;
        case "MOS": jac(nd, W => Semi.mos(W, e.model), 1e-5); break;
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
    const fStart = opts.fStart || 10, fStop = opts.fStop || 100e3, KA = acPoints(opts);
    // a piece of the sweep, points kFrom … kTo − 1 of the whole (workers share a sweep this way;
    // each frequency is solved on its own, so the pieces are the whole sweep's values exactly)
    const k0 = Math.max(0, Math.min(KA, opts.kFrom || 0)), K = Math.max(0, Math.min(KA, opts.kTo === undefined ? KA : opts.kTo) - k0);
    const freqs = new Float64Array(K), re = [], im = [];
    for (let i = 0; i < nN; i++) { re.push(new Float64Array(K)); im.push(new Float64Array(K)); }
    const Ar = new Float64Array(n * n), Ai = new Float64Array(n * n), br = new Float64Array(n), bi = new Float64Array(n);
    for (let k = 0; k < K; k++) {
      const f = fStart * Math.pow(fStop / fStart, (k0 + k) / (KA - 1)), w = 2 * Math.PI * f;
      freqs[k] = f;
      for (let i = 0; i < n * n; i++) { Ar[i] = Gm[i]; Ai[i] = w * Bm[i]; }
      for (let i = 0; i < n; i++) { br[i] = rhs[i]; bi[i] = rhs[n + i]; }
      // complex Gaussian elimination with partial pivoting
      for (let c = 0; c < n; c++) {
        let p = c, best = 0;
        for (let r = c; r < n; r++) { const m = Ar[at(r, c)] * Ar[at(r, c)] + Ai[at(r, c)] * Ai[at(r, c)]; if (m > best) { best = m; p = r; } }
        if (!(best > 0)) return { ok: false, error: "singular matrix at " + f.toPrecision(3) + " Hz" };
        if (p !== c) {
          for (let j = 0; j < n; j++) { let t = Ar[at(c, j)]; Ar[at(c, j)] = Ar[at(p, j)]; Ar[at(p, j)] = t; t = Ai[at(c, j)]; Ai[at(c, j)] = Ai[at(p, j)]; Ai[at(p, j)] = t; }
          let t = br[c]; br[c] = br[p]; br[p] = t; t = bi[c]; bi[c] = bi[p]; bi[p] = t;
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
          br[r] -= fr * br[c] - fi * bi[c]; bi[r] -= fr * bi[c] + fi * br[c];
          Ar[at(r, c)] = 0; Ai[at(r, c)] = 0;
        }
      }
      for (let c = n - 1; c >= 0; c--) {
        let sr = br[c], si = bi[c];
        for (let j = c + 1; j < n; j++) { const ar = Ar[at(c, j)], ai = Ai[at(c, j)]; if (ar === 0 && ai === 0) continue; sr -= ar * br[j] - ai * bi[j]; si -= ar * bi[j] + ai * br[j]; }
        const pr = Ar[at(c, c)], pi = Ai[at(c, c)], pm = pr * pr + pi * pi;
        br[c] = (sr * pr + si * pi) / pm; bi[c] = (si * pr - sr * pi) / pm;
      }
      for (let i = 1; i < nN; i++) { re[i][k] = br[i - 1]; im[i][k] = bi[i - 1]; }
    }
    // probes [[node, ref], …]: v(node) − v(ref), as a scope channel against its common
    const probes = (opts.probes || []).map(([a, b]) => { const pr = new Float64Array(K), pi = new Float64Array(K); for (let k = 0; k < K; k++) { pr[k] = re[a][k] - re[b][k]; pi[k] = im[a][k] - im[b][k]; } return { re: pr, im: pi }; });
    return { ok: true, freqs, re, im, probes, elapsedMs: Date.now() - t0 };
  }

  const Engine = { Tube, Koren, Semi, NE555, timerCurrents, terminalCurrents, Spice, RECTIFIER_PERVEANCE, simulate, startup, acSweep, acPoints, buildCircuit, dcOperatingPoint, solveLinear, invertMatrix, SparseMatrix,
    loadWasm, useWasm, solver: () => (wasm ? "wasm" : "js") };
  root.TubeSimEngine = Engine;
})(globalThis);
