/* =============================================================================
   DIGITAL — the event-driven logic simulator inside the free transient (sim-engine.js).

   Digital nets carry a state (0, 1, X) and a strength (strong, resistive, high impedance,
   undetermined), as ngspice's XSPICE has them; a net with several drivers takes XSPICE's
   resolution table. Gates and flip-flops change their outputs after their delays, through a
   queue of events per output (a new event drops the ones pending at or after its time, XSPICE's
   transport delay). The analogue side meets them through bridges:
     ADC  an analogue node read as a level: below lo 0, above hi 1, between X (XSPICE's
          adc_bridge), or with hysteresis (hyst: holds its level between lo and hi). With rail
          nodes, lo and hi are shares of the rail's voltage (a CMOS input's thresholds).
     DAC  a level driven as a voltage: v(out) − (1 − s)·v(lo) − s·v(hi) = c. Without rails (lo = hi,
          the reference) c moves from level to level at the slopes out of t_rise and t_fall, as
          XSPICE's dac_bridge; with rails, s moves between 0 and 1 the same way (a CMOS output
          swinging rail to rail).
   The engine asks for the next event time (a breakpoint for its steps), for where an input
   crossed a threshold within a step (the step is cut there), and hands over each accepted time
   (advance), after which the DACs it drives may have started new ramps.

   Primitives: XSPICE's and, nand, or, nor, xor, xnor, buffer, inverter, open_c, open_e,
   tristate, pullup, pulldown, lut, dff, jkff, tff, srff, dlatch, srlatch, fdiv, and the
   app's own counter (a ripple binary counter), johnson (a 4017 decade counter), clock and
   pattern (sources).

   Element forms (as the netlist has them, nets as strings):
     { kind: "DIG", type, in: [net|null], out: [net|null], inv: { in: [bool], out: [bool] }, p: {…} }
     { kind: "ADC", nodes: [in] or [in, lo, hi], out: net, p: { lo, hi, rise, fall, hyst } }
     { kind: "DAC", nodes: [out, ref] or [out, lo, hi], in: net, p: { lo, hi, undef, trise, tfall } }
   ============================================================================= */
(function (root) {
  "use strict";
  const ZERO = 0, ONE = 1, UNK = 2;
  const STRONG = 0, RESIST = 1, HIZ = 2, UNDET = 3;
  // XSPICE's resolution of two drivers (idn_digital_resolve), indexed strength·3 + state
  const RESOLVE = [
    [0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2],
    [2, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 2],
    [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    [0, 1, 2, 3, 5, 5, 3, 3, 3, 9, 11, 11],
    [0, 1, 2, 5, 4, 5, 4, 4, 4, 11, 10, 11],
    [0, 1, 2, 5, 5, 5, 5, 5, 5, 11, 11, 11],
    [0, 1, 2, 3, 4, 5, 6, 8, 8, 9, 11, 11],
    [0, 1, 2, 3, 4, 5, 8, 7, 8, 11, 10, 11],
    [0, 1, 2, 3, 4, 5, 8, 8, 8, 11, 11, 11],
    [0, 2, 2, 9, 11, 11, 9, 11, 11, 9, 11, 11],
    [2, 1, 2, 11, 10, 11, 11, 10, 11, 11, 10, 11],
    [2, 2, 2, 11, 11, 11, 11, 11, 11, 11, 11, 11]];
  const toggle = v => (v === UNK ? UNK : 1 - v);
  const D = 1e-9;   // XSPICE's default delays

  // the ports of each primitive, inputs then outputs (the SPICE line's order, spice-net.js)
  const PORTS = {
    and: [["in*"], ["out"]], nand: [["in*"], ["out"]], or: [["in*"], ["out"]], nor: [["in*"], ["out"]],
    xor: [["in*"], ["out"]], xnor: [["in*"], ["out"]], buffer: [["in"], ["out"]], inverter: [["in"], ["out"]],
    open_c: [["in"], ["out"]], open_e: [["in"], ["out"]], tristate: [["in", "enable"], ["out"]],
    pullup: [[], ["out"]], pulldown: [[], ["out"]], lut: [["in*"], ["out"]],
    dff: [["data", "clk", "set", "reset"], ["out", "Nout"]], jkff: [["j", "k", "clk", "set", "reset"], ["out", "Nout"]],
    tff: [["t", "clk", "set", "reset"], ["out", "Nout"]], srff: [["s", "r", "clk", "set", "reset"], ["out", "Nout"]],
    dlatch: [["data", "enable", "set", "reset"], ["out", "Nout"]], srlatch: [["s", "r", "enable", "set", "reset"], ["out", "Nout"]],
    fdiv: [["freq_in"], ["freq_out"]]
  };
  const GATES = new Set(["and", "nand", "or", "nor", "xor", "xnor", "buffer", "inverter", "open_c", "open_e"]);

  function create(els) {
    const nets = new Map(), devs = [], adcs = [], dacs = new Map(), outs = [];
    const netOf = key => {
      if (key === null || key === undefined) return null;
      let n = nets.get(key);
      if (!n) { n = { key, v: ZERO, s: UNDET, drv: [], fan: [], rt: [0], rv: [ZERO] }; nets.set(key, n); }
      return n;
    };
    const mkOut = (dev, k, key, inv) => {
      const net = netOf(key); if (!net) return null;
      const o = { dev, k, net, inv: !!inv, st: ZERO, sg: UNDET, pend: [] };
      net.drv.push(o); outs.push(o); return o;
    };
    els.forEach(e => {
      if (e.kind === "DIG") {
        const d = { id: e.id, type: e.type, p: Object.assign({}, e.p), ins: [], outs: [], wake: Infinity };
        (e.in || []).forEach((key, k) => { const net = netOf(key); d.ins.push(net ? { net, inv: !!(e.inv && e.inv.in && e.inv.in[k]) } : null); if (net) net.fan.push(d); });
        (e.out || []).forEach((key, k) => d.outs.push(mkOut(d, k, key, e.inv && e.inv.out && e.inv.out[k])));
        devs.push(d);
      } else if (e.kind === "ADC") {
        const p = Object.assign({ lo: 0.1, hi: 0.9, rise: D, fall: D }, e.p);
        const a = { id: e.id, type: "adc", nodes: e.nodes, rail: e.nodes.length >= 3, p, lvl: UNK, ins: [], outs: [] };
        a.outs.push(mkOut(a, 0, e.out, e.inv)); adcs.push(a); devs.push(a);
      } else if (e.kind === "DAC") {
        const p = Object.assign({ lo: 0, hi: 1, trise: D, tfall: D }, e.p);
        if (p.undef === undefined) p.undef = (p.lo + p.hi) / 2;
        const net = netOf(e.in);
        const d = { id: e.id, type: "dac", rail: e.nodes.length >= 3 && e.nodes[1] !== e.nodes[2], p, ins: [net ? { net, inv: !!e.inv } : null], outs: [], drive: UNK, t0: 0, v0: p.undef };
        if (net) net.fan.push(d);
        dacs.set(e.id, d); devs.push(d);
      }
    });
    const sim = { nets, devs, adcs, dacs, kick: false, t: 0 };
    const eps = t => Math.abs(t) * 1e-12 + 1e-21;

    // --- the queue -----------------------------------------------------------------
    const pending = new Set();
    function post(o, st, sg, t) {
      if (!o) return;
      if (o.inv && sg !== HIZ) st = toggle(st);
      while (o.pend.length && o.pend[o.pend.length - 1].t >= t) o.pend.pop();
      o.pend.push({ t, st, sg }); pending.add(o);
    }
    function resolve(net) {
      const dr = net.drv;
      if (!dr.length) return [ZERO, UNDET];
      let r = dr[0].sg * 3 + dr[0].st;
      for (let i = 1; i < dr.length; i++) r = RESOLVE[r][dr[i].sg * 3 + dr[i].st];
      return [r % 3, Math.floor(r / 3)];
    }
    const inp = (d, k) => { const q = d.ins[k]; if (!q) return null; return q.inv ? toggle(q.net.v) : q.net.v; };

    // --- the primitives --------------------------------------------------------------
    // a gate's output: changed only when its value does, after the rise or fall delay (to X: by the old value)
    function gateOut(d, val, sg, t, dc, rise, fall) {
      if (val === d.o && sg === d.os) return;
      const dl = val === ZERO ? fall : val === ONE ? rise : d.o === ZERO ? rise : fall;
      d.o = val; d.os = sg;
      post(d.outs[0], val, sg, dc ? t : t + dl);
    }
    function gate(d, t, dc) {
      const p = d.p, n = d.ins.length, rise = p.rise_delay !== undefined ? p.rise_delay : D, fall = p.fall_delay !== undefined ? p.fall_delay : D;
      let v;
      switch (d.type) {
        case "and": case "nand": v = ONE; for (let k = 0; k < n; k++) { const x = inp(d, k); if (x === ZERO) { v = ZERO; break; } if (x === UNK) v = UNK; } if (d.type === "nand") v = toggle(v); break;
        case "or": case "nor": v = ZERO; for (let k = 0; k < n; k++) { const x = inp(d, k); if (x === ONE) { v = ONE; break; } if (x === UNK) v = UNK; } if (d.type === "nor") v = toggle(v); break;
        case "xor": case "xnor": v = ZERO; for (let k = 0; k < n; k++) { const x = inp(d, k); if (x === UNK) { v = UNK; break; } if (x === ONE) v = toggle(v); } if (d.type === "xnor") v = toggle(v); break;
        case "buffer": v = inp(d, 0); break;
        case "inverter": v = toggle(inp(d, 0)); break;
        case "open_c": { v = inp(d, 0); const od = p.open_delay !== undefined ? p.open_delay : D; gateOut(d, v, v === ZERO ? STRONG : v === ONE ? HIZ : UNDET, t, dc, od, fall); return; }
        case "open_e": { v = inp(d, 0); const od = p.open_delay !== undefined ? p.open_delay : D; gateOut(d, v, v === ONE ? STRONG : v === ZERO ? HIZ : UNDET, t, dc, rise, od); return; }
      }
      gateOut(d, v, STRONG, t, dc, rise, fall);
    }
    // flip-flops and latches: XSPICE's set/reset, then clock (or enable) rules, the rise or fall
    // delay added to the clock's (set's, reset's) own
    function ffEval(d, t, dc) {
      const p = d.p, ty = d.type, ni = d.ins.length;
      const set = d.ins[ni - 2] ? inp(d, ni - 2) : ZERO, reset = d.ins[ni - 1] ? inp(d, ni - 1) : ZERO;
      const latch = ty === "dlatch" || ty === "srlatch";
      const clkK = ty === "dff" || ty === "dlatch" ? 1 : ty === "tff" ? 1 : 2, clk = inp(d, clkK);
      const pv = (k, def) => (p[k] !== undefined ? p[k] : def);
      const next = q => {
        switch (ty) {
          case "dff": case "dlatch": return inp(d, 0);
          case "tff": { const x = inp(d, 0); return x === ONE ? toggle(q) : x === ZERO ? q : UNK; }
          case "jkff": { const j = inp(d, 0), k = inp(d, 1); if (j === UNK || k === UNK) return UNK; return j ? (k ? toggle(q) : ONE) : (k ? ZERO : q); }
          default: { const s = inp(d, 0), r = inp(d, 1); if (s === UNK || r === UNK) return UNK; return s ? (r ? UNK : ONE) : (r ? ZERO : q); }   // srff, srlatch
        }
      };
      const keep = () => { d.oset = set; d.oreset = reset; d.oclk = clk; d.od0 = inp(d, 0); d.od1 = ni > 4 ? inp(d, 1) : null; };
      if (dc) {
        let q = Math.round(pv("ic", 0)); q = q === 1 ? ONE : q === 0 ? ZERO : UNK;
        if (latch && clk === ONE) q = next(q);
        if (set === ONE && reset === ZERO) q = ONE; else if (set === ZERO && reset === ONE) q = ZERO; else if (set === ONE && reset === ONE) q = UNK;
        d.q = q; post(d.outs[0], q, STRONG, t); post(d.outs[1], toggle(q), STRONG, t); keep(); return;
      }
      const old = d.q;
      let q = old, dl = 0;
      if (set !== d.oset) {
        dl = pv("set_delay", D);
        if (set === ONE) q = reset !== ONE ? ONE : UNK;
        else if (reset === ONE) q = ZERO;
      } else if (reset !== d.oreset) {
        dl = pv("reset_delay", D);
        if (reset === ONE) q = set !== ONE ? ZERO : UNK;
        else if (set === ONE) q = ONE;
      } else if (reset !== ONE && set !== ONE) {
        if (!latch) {
          if (clk !== d.oclk && clk === ONE) { q = next(old); dl = pv("clk_delay", D); }
        } else if (clk !== d.oclk) {
          if (clk === ONE) { q = next(old); dl = pv("enable_delay", D); }
        } else if (clk === ONE && (inp(d, 0) !== d.od0 || (ni > 4 && inp(d, 1) !== d.od1))) {
          q = next(old); dl = pv(ty === "dlatch" ? "data_delay" : "sr_delay", D);
        }
      }
      keep();
      if (q === old) return;
      const rise = pv("rise_delay", D), fall = pv("fall_delay", D);
      const up = q === ONE || (q === UNK && old === ZERO);
      d.q = q;
      post(d.outs[0], q, STRONG, t + dl + (up ? rise : fall));
      post(d.outs[1], toggle(q), STRONG, t + dl + (up ? fall : rise));
    }
    function evalDev(d, t, dc) {
      const p = d.p;
      if (GATES.has(d.type)) return gate(d, t, dc);
      switch (d.type) {
        case "tristate": {
          const en = inp(d, 1), sg = en === ZERO ? HIZ : en === ONE ? STRONG : UNDET, v = inp(d, 0);
          if (v === d.o && sg === d.os) return;
          d.o = v; d.os = sg; post(d.outs[0], v, sg, dc ? t : t + (p.delay !== undefined ? p.delay : D));
          return;
        }
        case "pullup": case "pulldown": if (dc) post(d.outs[0], d.type === "pullup" ? ONE : ZERO, RESIST, t); return;
        case "lut": {
          let idx = 0, v = ZERO;
          for (let k = 0; k < d.ins.length; k++) { const x = inp(d, k); if (x === UNK) { v = UNK; break; } if (x === ONE) idx += 1 << k; }
          if (v !== UNK) { const ch = String(p.table_values || "0")[idx]; v = ch === "1" ? ONE : ch === "0" ? ZERO : UNK; }
          gateOut(d, v, STRONG, t, dc, p.rise_delay !== undefined ? p.rise_delay : D, p.fall_delay !== undefined ? p.fall_delay : D);
          return;
        }
        case "dff": case "jkff": case "tff": case "srff": case "dlatch": case "srlatch": return ffEval(d, t, dc);
        case "fdiv": {
          const div = Math.round(p.div_factor || 2), high = Math.round(p.high_cycles !== undefined ? p.high_cycles : 1), x = inp(d, 0);
          if (dc) {
            let c = Math.round(p.i_count || 0);
            if (div <= c || c < 0) { c = 0; post(d.outs[0], ZERO, STRONG, t); }
            if (c > 0 && c <= high) post(d.outs[0], ONE, STRONG, t);
            d.c = c; d.oin = x; return;
          }
          if (x !== d.oin && x === ONE) {
            d.c++;
            if (d.c === div + 1 || d.c === 1) { d.c = 1; post(d.outs[0], ONE, STRONG, t + (p.rise_delay !== undefined ? p.rise_delay : D)); }
            else if (d.c === high + 1) post(d.outs[0], ZERO, STRONG, t + (p.fall_delay !== undefined ? p.fall_delay : D));
          }
          d.oin = x; return;
        }
        case "counter": {
          // a ripple binary counter: counts on the clock's falling (or rising) edge, its bits
          // following one another by stage; reset (high) clears it
          const bits = d.outs.length, clk = inp(d, 0), rst = d.ins[1] ? inp(d, 1) : ZERO, mask = Math.pow(2, bits);
          const emit = (c, dl, stage) => { for (let i = 0; i < bits; i++) { const b = Math.floor(c / Math.pow(2, i)) % 2; if (dc || b !== Math.floor(d.c / Math.pow(2, i)) % 2) post(d.outs[i], b, STRONG, dc ? t : t + dl + stage * i); } d.c = c; };
          if (dc) { d.c = 0; emit(0, 0, 0); d.oclk = clk; d.orst = rst; return; }
          if (rst === ONE) { if (d.c !== 0) emit(0, p.reset_delay !== undefined ? p.reset_delay : D, 0); }
          else if (rst === ZERO && clk !== d.oclk && (p.edge === "rise" ? clk === ONE && d.oclk === ZERO : clk === ZERO && d.oclk === ONE)) emit((d.c + 1) % mask, p.delay !== undefined ? p.delay : D, p.stage || 0);
          d.oclk = clk; d.orst = rst; return;
        }
        case "johnson": {
          // a CD4017: counts on the clock's rising edge with clock-enable low (or enable falling
          // with the clock high); one of ten outputs high, carry high for counts 0 to 4
          const clk = inp(d, 0), ce = d.ins[1] ? inp(d, 1) : ZERO, rst = d.ins[2] ? inp(d, 2) : ZERO, dl = dc ? 0 : p.delay !== undefined ? p.delay : D;
          const emit = c => { for (let i = 0; i < 10; i++) if (dc || i === c || i === d.c) post(d.outs[i], i === c ? ONE : ZERO, STRONG, t + dl); if (dc || (c < 5) !== (d.c < 5)) post(d.outs[10], c < 5 ? ONE : ZERO, STRONG, t + dl); d.c = c; };
          if (dc) { d.c = 0; emit(0); }
          else if (rst === ONE) { if (d.c !== 0) emit(0); }
          else if (rst === ZERO && ((clk === ONE && d.oclk === ZERO && ce === ZERO) || (ce === ZERO && d.oce === ONE && clk === ONE))) emit((d.c + 1) % 10);
          d.oclk = clk; d.oce = ce; return;
        }
        case "clock": {
          // high for duty·period from delay, each period
          const per = p.period, hi = per * (p.duty !== undefined ? p.duty : 0.5), t0 = p.delay || 0;
          const level = tt => { if (tt < t0 - eps(tt)) return ZERO; const ph = ((tt - t0) % per + per) % per; return ph < hi - eps(per) || per - ph < eps(per) ? ONE : ZERO; };
          const nextEdge = tt => { if (tt < t0 - eps(tt)) return t0; const k = Math.floor((tt - t0) / per + 1e-9), a = t0 + k * per + hi; return a > tt + eps(tt) ? a : t0 + (k + 1) * per; };
          post(d.outs[0], level(t), STRONG, t);
          d.wake = nextEdge(t);
          return;
        }
        case "pattern": {
          // bits one after another, tbit each, from delay (repeat: from the start again)
          const bits = String(p.bits || "0"), tb = p.tbit, t0 = p.delay || 0, n = bits.length;
          const ofs = tt => { if (tt < t0 - eps(tt)) return -1; const k = Math.floor((tt - t0) / tb + 1e-9); return p.repeat ? k % n : Math.min(k, n - 1); };
          const k = ofs(t), ch = k < 0 ? String(p.idle || "0") : bits[k];
          post(d.outs[0], ch === "1" ? ONE : ch === "0" ? ZERO : UNK, STRONG, t);
          if (t < t0 - eps(t)) d.wake = t0;
          else { const kk = Math.floor((t - t0) / tb + 1e-9) + 1; d.wake = p.repeat || kk < n ? t0 + kk * tb : Infinity; }
          return;
        }
        case "dac": {
          const v = inp(d, 0) === null ? UNK : inp(d, 0);
          if (dc) { d.drive = v; d.t0 = 0; d.v0 = dacLevel(d, v); return; }
          if (v === d.drive) return;
          d.v0 = dacAt(d, t); d.t0 = t; d.drive = v; sim.kick = true;
          return;
        }
      }
    }
    const dacLevel = (d, v) => { const p = d.rail ? { lo: 0, hi: 1, undef: 0.5 } : d.p; return v === ONE ? p.hi : v === ZERO ? p.lo : p.undef; };
    // the value the DAC drives at t: from v0 at t0 toward its level at XSPICE's slopes
    function dacAt(d, t) {
      const target = dacLevel(d, d.drive);
      if (d.v0 === target || t <= d.t0) return t <= d.t0 ? d.v0 : target;
      const span = d.rail ? 1 : d.p.hi - d.p.lo || 1, up = target > d.v0, slope = span / Math.max(up ? d.p.trise : d.p.tfall, 1e-15);
      const v = d.v0 + (up ? 1 : -1) * slope * (t - d.t0);
      return up ? Math.min(v, target) : Math.max(v, target);
    }
    function dacEnd(d) {
      const target = dacLevel(d, d.drive);
      if (d.v0 === target) return -Infinity;
      const span = d.rail ? 1 : d.p.hi - d.p.lo || 1, up = target > d.v0, slope = span / Math.max(up ? d.p.trise : d.p.tfall, 1e-15);
      return d.t0 + Math.abs(target - d.v0) / slope;
    }

    // --- the analogue side's reading of an ADC ------------------------------------------
    const vAt = (x, k) => (k > 0 ? x[k - 1] : 0);
    function adcU(a, x) {
      const v = vAt(x, a.nodes[0]);
      if (!a.rail) return v;
      const lo = vAt(x, a.nodes[1]), span = vAt(x, a.nodes[2]) - lo;
      return span > 1e-3 ? (v - lo) / span : 0;
    }
    function adcClass(a, u, last) {
      if (a.p.hyst) return u >= a.p.hi ? ONE : u <= a.p.lo ? ZERO : last === UNK ? (u >= (a.p.lo + a.p.hi) / 2 ? ONE : ZERO) : last;
      return u <= a.p.lo ? ZERO : u >= a.p.hi ? ONE : UNK;
    }
    function adcCheck(t, x, dc) {
      for (const a of adcs) {
        const v = adcClass(a, adcU(a, x), a.lvl);
        if (v === a.lvl) continue;
        const dl = dc ? 0 : v === ZERO ? a.p.fall : v === ONE ? a.p.rise : a.lvl === ONE ? a.p.fall : a.p.rise;
        a.lvl = v; post(a.outs[0], v, STRONG, t + dl);
      }
    }

    // --- running ---------------------------------------------------------------------
    // apply every event due by t, evaluate the parts they reach, until nothing more is due
    function settle(t, dc) {
      for (let it = 0; it < 2000; it++) {
        const touched = new Set(), todo = new Set();
        for (const o of pending) {
          let ev = null;
          while (o.pend.length && o.pend[0].t <= t + eps(t)) ev = o.pend.shift();
          if (!o.pend.length) pending.delete(o);
          if (ev && (ev.st !== o.st || ev.sg !== o.sg)) { o.st = ev.st; o.sg = ev.sg; touched.add(o.net); }
        }
        for (const d of devs) if (d.wake <= t + eps(t)) { d.wake = Infinity; todo.add(d); }
        for (const net of touched) {
          const [v, s] = resolve(net);
          if (v === net.v && s === net.s) continue;
          const vc = v !== net.v;
          net.v = v; net.s = s;
          if (vc) { if (net.rt[net.rt.length - 1] === t) net.rv[net.rv.length - 1] = v; else { net.rt.push(t); net.rv.push(v); } }
          net.fan.forEach(d => todo.add(d));
        }
        if (!todo.size) return true;
        for (const d of todo) evalDev(d, t, dc);
      }
      return false;   // a loop that does not settle (a ring of gates at DC)
    }
    // DC: every part at time 0, outputs at once; with the analogue solution x the ADCs read
    sim.dcInit = () => {
      nets.forEach(n => { n.v = ZERO; n.s = UNDET; n.rt = [0]; n.rv = [ZERO]; });
      outs.forEach(o => { o.st = ZERO; o.sg = UNDET; o.pend = []; });
      pending.clear();
      devs.forEach(d => { d.o = 3; d.os = -1; d.wake = Infinity; if (d.type === "adc") d.lvl = UNK; });
      devs.forEach(d => { if (d.type !== "adc") evalDev(d, 0, true); });
      settle(0, true);
      sim.t = 0;
    };
    // after an analogue solution at DC: true when a DAC now drives another level
    sim.dcUpdate = x => {
      const before = [...dacs.values()].map(d => d.drive);
      adcCheck(0, x, true);
      settle(0, true);
      // the parts with a time of their own (clock, pattern) start from their state at 0
      return [...dacs.values()].some((d, k) => d.drive !== before[k]);
    };
    sim.start = () => {
      devs.forEach(d => {
        if (d.type === "clock" || d.type === "pattern") evalDev(d, 0, false);
        if (d.type === "dac") { d.t0 = 0; d.v0 = dacLevel(d, d.drive); }
      });
      settle(0, false);
      sim.t = 0; sim.kick = false;
    };
    // the next time anything happens after t: an event, a part's own wake, a ramp's end
    sim.nextTime = t => {
      let m = Infinity;
      for (const o of pending) if (o.pend.length && o.pend[0].t < m) m = o.pend[0].t;
      for (const d of devs) if (d.wake < m) m = d.wake;
      for (const d of dacs.values()) { const e = dacEnd(d); if (e > t + eps(t) && e < m) m = e; }
      return m;
    };
    // the share of a step from xp to xn at which an ADC's input first crosses a threshold that
    // changes its level (null: none does)
    sim.crossing = (xp, xn) => {
      let best = null;
      for (const a of adcs) {
        const un = adcU(a, xn);
        if (adcClass(a, un, a.lvl) === a.lvl) continue;
        const up = adcU(a, xp);
        const ths = a.p.hyst ? [a.lvl === ONE ? a.p.lo : a.p.hi] : [a.p.lo, a.p.hi];
        for (const th of ths) {
          if ((up - th) * (un - th) > 0 || up === un) continue;
          const f = Math.max(0, Math.min(1, (th - up) / (un - up)));
          if (best === null || f < best) best = f;
        }
      }
      return best;
    };
    // an accepted time t with the analogue solution x: the ADCs read, the events due run;
    // true when a DAC started a new ramp (the analogue side takes it as a corner)
    sim.advance = (t, x) => {
      sim.kick = false; sim.t = t;
      adcCheck(t, x, false);
      settle(t, false);
      return sim.kick;
    };
    // the DAC's stamp at time t (dc: its level): { s, c } in v(out) − (1 − s)·v(lo) − s·v(hi) = c
    sim.dacStamp = (id, t, steady) => {
      const d = dacs.get(id); if (!d) return { s: 0, c: 0 };
      const v = steady ? dacLevel(d, d.drive) : dacAt(d, t);
      return d.rail ? { s: v, c: 0 } : { s: 0, c: v };
    };
    // the record of every net: its changes [t…], [state…] (0, 1, 2 = X)
    sim.record = () => {
      const out = [];
      nets.forEach(n => out.push({ name: n.key, t: Float64Array.from(n.rt), v: Uint8Array.from(n.rv) }));
      return out;
    };
    sim.state = key => { const n = nets.get(key); return n ? n.v : null; };
    return sim;
  }

  root.TubeDigital = { create, PORTS, ZERO, ONE, UNK };
})(typeof window !== "undefined" ? window : globalThis);
