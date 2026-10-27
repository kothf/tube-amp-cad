/* AC animation: one period of the signal, slowed to ANIM_S seconds (a cycle of REAL_S or more, such
   as a slow 555 flasher's, plays in real time). Each wire's current (the
   simulation's terminal currents at 120 instants, carried through the wiring as for the
   current stickers) runs as dots along it, showing only its DC or its AC, by its node's
   voltage: where the node's DC is at least its AC rms, violet dots flow steadily with the
   DC current; elsewhere pale dots swing with the current less its DC. Ground goes by its
   current, and a wire that carries next to none of the chosen part shows the other. Each
   node's AC voltage tints its wires, orange swinging up, blue swinging down. The AC is scaled
   to each wire's own peak, so the microamps at a grid move as visibly as the plate's
   milliamps; brighter dots, more current.
   LEDs light up by their current: with the animation on, at its moment; otherwise by the
   settled average. So do neon lamps (orange, on either polarity) and gas regulators (violet), and a
   magic eye's shadow opens and closes with its triode's plate against its target. A free-running 555 sets its own cycle (the simulation finds its period), so a 555
   flasher animates as any other circuit. A circuit with LEDs but no cycle at all (no signal
   generator, mains or free-running 555) plays its power-on transient instead, in real time and
   looping, so the LEDs light as they would on the bench. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadAnim = function (cad) {
    const { S, buildNetlist, fmtEng, getCtx, netDC, pinCurrent, pinMap, pool, render, setStatus, signalFreq, stats, topo, wireCurrents } = cad;
    const ANIM_S = 3, REAL_S = 0.25, ANIM_DC_SPEED = 25;   // DC dots: units a second, about the AC dots' average
    // how long one cycle of the animation takes (s)
    const cycleS = d => (d.f > 0 && 1 / d.f >= REAL_S ? 1 / d.f : ANIM_S);
    // the parts that light by their current in pin A: an LED, a vactrol's LED (full brightness at
    // 10 mA), a neon (at its design current, either way) and a gas regulator (at its maximum);
    // probed at power-on across their sense resistor (c.id#rs: the gas regulator has none)
    const LED_FULL = 0.01;
    function glowSpec(c) {
      if (c.type === "led" || c.type === "vactrol") return { full: LED_FULL, min: 1e-4, probe: true };
      if (c.type === "neon") { const m = CadLib.NEONS[c.params.model] || CadLib.NEONS["NE-2"]; return { full: m.i, min: m.iext / 2, abs: true, probe: true }; }
      if (c.type === "gasreg") { const m = CadLib.GASREGS[c.params.model] || CadLib.GASREGS["0A2"]; return { full: m.imax, min: m.iext / 2 }; }
      return null;
    }
    // what the power-on playback shows: the probed glows and the magic eyes
    const powerShows = c => (glowSpec(c) || {}).probe || c.type === "eye";
    const POWER_S = 4;     // the power-on playback's length (s)
    S.anim = { on: false, phase: 0, last: 0, data: null, off: new Map(), raf: 0, power: null };
    function animData() {
      const r = S.sim.result, F = r && r.tran && r.tran.frames;
      if (!F || F.cur.length < 8) return null;
      if (S.anim.data && S.anim.data.r === r) return S.anim.data;
      const T = S.sim.topo || topo(), flat = F.layout.slice(), n = F.cur.length;
      const pinFrames = F.cur.map(vals => { for (let k = 0; k < vals.length; k++) flat[3 * k + 2] = vals[k]; return pinMap(flat); });
      const perFrame = pinFrames.map(pm => { const wc = wireCurrents(pm); return wc ? wc.currents : new Map(); });
      // each LED's (neon's, gas regulator's) current at the frames; each magic eye's target and
      // plate over its cathode
      const leds = new Map(), eyes = new Map();
      S.comps.forEach(c => { if (glowSpec(c) && pinFrames.every(pm => pm.has(c.id + ":A"))) leds.set(c.id, pinFrames.map(pm => pm.get(c.id + ":A"))); });
      S.comps.forEach(c => {
        if (c.type !== "eye") return;
        const w = pid => { const n = T.pinNet.get(c.id + ":" + pid), a = n > 0 && r.tran.nodes[n]; return n === 0 ? F.at.map(() => 0) : a ? F.at.map(k => a[k]) : null; };
        const t = w("T"), p = w("P"), k = w("K");
        if (t && p && k) eyes.set(c.id, { vt: t.map((v, j) => v - k[j]), vp: p.map((v, j) => v - k[j]) });
      });
      const acOf = (xs, m0) => { const m = m0 !== undefined ? m0 : xs.reduce((a, v) => a + v, 0) / xs.length, ac = xs.map(v => v - m); return { ac, pk: Math.max(...ac.map(Math.abs)), dc: m, rms: Math.sqrt(ac.reduce((a, v) => a + v * v, 0) / ac.length) }; };
      // DC or AC is judged over the whole settled capture, not the one signal cycle the frames
      // span: against a 1 kHz signal the 50 Hz mains barely moves in a cycle and would pass for DC
      const wc = wireCurrents(), dcW = wc ? wc.currents : new Map();
      const wires = new Map(), nets = new Map();
      S.wires.forEach(w => {
        const net = T.wireNet.get(w.id), wave = net > 0 && r.tran.nodes[net];
        if (wave && !nets.has(net)) { const a = acOf(F.at.map(k => wave[k])); if (a.pk >= 1e-3) nets.set(net, a); }
        const xs = perFrame.map(m => m.get(w.id));
        if (xs.every(v => v !== undefined && isFinite(v))) {
          const a = acOf(xs, dcW.get(w.id)), vs = wave && stats(wave), vdc = netDC(net);
          // DC or AC by the node's voltage (its DC against its AC rms); ground, with neither, by the current
          a.mode = vs && vdc !== null && (Math.abs(vdc) >= 1e-3 || vs.rmsAC >= 1e-3) ? (Math.abs(vdc) >= vs.rmsAC ? "dc" : "ac") : (Math.abs(a.dc) >= a.rms ? "dc" : "ac");
          // ...unless the wire carries next to none of that part: a filter capacitor on a DC rail passes only the ripple
          const dcI = Math.abs(a.dc);
          if (a.mode === "dc" && dcI < 0.05 * a.rms) a.mode = "ac"; else if (a.mode === "ac" && a.rms < 0.05 * dcI) a.mode = "dc";
          if ((a.mode === "dc" ? dcI : a.pk) >= 1e-6) wires.set(w.id, a);
        }
      });
      S.anim.data = { r, n, wires, nets, leds, eyes, f: signalFreq() };
      return S.anim.data;
    }
    // a quantity at the animation's phase, between its frames
    const animAt = (a, phase) => { const n = a.length, f = phase * n, j = Math.floor(f) % n, u = f - Math.floor(f); return a[j] * (1 - u) + a[(j + 1) % n] * u; };
    function animTick(now) {
      if (!S.anim.on) return;
      const d = animData();
      const dt = S.anim.last ? Math.min(0.1, (now - S.anim.last) / 1000) : 0; S.anim.last = now;
      const P = powerOn();
      if (P && P.ok) P.t = (P.t + dt) % P.tStop;
      if (d && !P) {
        S.anim.phase = (S.anim.phase + dt / cycleS(d)) % 1;
        // AC dots move at up to 40 units a second at the wire's peak AC current, with its sign; DC dots steadily with the DC
        d.wires.forEach((a, id) => S.anim.off.set(id, (S.anim.off.get(id) || 0) + dt * (a.mode === "dc" ? ANIM_DC_SPEED * Math.sign(a.dc) : 40 * animAt(a.ac, S.anim.phase) / a.pk)));
      }
      render();
      S.anim.raf = requestAnimationFrame(animTick);
    }
    function setAnim(on) {
      S.anim.on = on; S.anim.last = 0;
      const b = document.getElementById("btn-anim"); if (b) { b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); }
      cancelAnimationFrame(S.anim.raf);
      if (on) {
        if (!animData() && !powerOn()) setStatus("warn", S.sim.result ? "Nothing to animate: the circuit has no signal (add a signal generator) and no LED to blink" : "Simulate first: the animation plays the simulated signal");
        S.anim.raf = requestAnimationFrame(animTick);
      }
      render();
    }
    // the power-on playback, when the animation is on and has no cycle (no source, no free-running 555) but LEDs to light:
    // the first POWER_S seconds after switch-on, each LED's current probed across its series
    // resistance (the bins' largest, so a short blink still shows); run again when the circuit's
    // netlist changes
    function powerOn() {
      const r = S.sim.result;
      if (!S.anim.on || !S.comps.some(powerShows) || S.comps.some(c => c.type === "siggen" || c.type === "mains") || (r && r.tran && r.tran.fBase)) return null;
      if (S.anim.power && !S.anim.power.dirty) return S.anim.power;
      const netlist = buildNetlist(), key = JSON.stringify(netlist.elements), old = S.anim.power;
      if (old && old.key === key) { old.dirty = false; return old; }
      if (old && old.job) old.job.cancel();
      const leds = [], eyes = [], probes = [];
      S.comps.forEach(c => {
        const e = (glowSpec(c) || {}).probe && netlist.elements.find(x => x.id === c.id + "#rs");
        if (e) { leds.push({ id: c.id, r: e.r, k: probes.length }); probes.push([e.nodes[0], e.nodes[1]]); }
        // an eye: its target (#t: T, K) and its triode's plate (P, G, K) over the cathode
        const t = c.type === "eye" && netlist.elements.find(x => x.id === c.id + "#t"), tr = t && netlist.elements.find(x => x.id === c.id);
        if (tr) { eyes.push({ id: c.id, k: probes.length }); probes.push([t.nodes[0], t.nodes[1]], [tr.nodes[0], tr.nodes[2]]); }
      });
      const P = S.anim.power = { key, running: true, progress: 0, tStop: POWER_S, t: 0, leds: new Map(), eyes: new Map() };
      const done = res => {
        if (S.anim.power !== P) return;
        Object.assign(P, { job: null, running: false, ok: !!res.ok, error: res.ok ? null : res.error, progress: 1 });
        if (res.ok) {
          // the bins' largest current, either way (a neon on AC); an eye's voltages at the bins' middle
          P.dt = res.dt;
          leds.forEach(l => P.leds.set(l.id, Float64Array.from(res.max[l.k], (v, j) => Math.max(v, -res.min[l.k][j]) / l.r)));
          const mid = k => Float64Array.from(res.max[k], (v, j) => (v + res.min[k][j]) / 2);
          eyes.forEach(e => P.eyes.set(e.id, { vt: mid(e.k), vp: mid(e.k + 1) }));
        }
        else setStatus("error", "Power-on playback: " + res.error);
        render();
      };
      const options = { tStop: POWER_S, probes, maxPoints: 4000, budgetMs: 120000 };
      if (pool && pool.ok) P.job = pool.run({ netlist, options, kind: "startup" }, { urgent: true, onResult: done, onProgress: f => { P.progress = f; } });
      else setTimeout(() => done(TubeSimEngine.startup(netlist, options)), 0);
      return P;
    }
    // the signal cycle being animated, when the animation is on and not playing the power-on
    const cycle = () => (S.anim.on && !powerOn() ? animData() : null);
    // the circuit changed: the power-on playback is checked against it when next drawn
    function changed() { if (S.anim.power) S.anim.power.dirty = true; }
    // how brightly an LED (neon, gas regulator) shines now, 0 (dark) to 1, or null when there is
    // nothing simulated to go by
    function ledLevel(c) {
      const g = glowSpec(c); if (!g) return null;
      let i = null;
      const P = powerOn(), d = !P && cycle();
      if (P && P.ok) { const a = P.leds.get(c.id); if (a && a.length) i = a[Math.min(a.length - 1, Math.floor(P.t / P.dt))]; }
      // the brightest of the last 1.5 % of the cycle: a neon flasher's brief flash still shows
      else if (d) { const a = d.leds.get(c.id); if (a) i = Math.max(...[0, 0.005, 0.01, 0.015].map(b => { const v = animAt(a, (S.anim.phase - b + 1) % 1); return g.abs ? Math.abs(v) : v; })); }
      // settled on AC, a neon by its average current either way (the frames' mean of its size)
      if (i === null && g.abs && S.sim.result) { const a = (animData() || { leds: new Map() }).leds.get(c.id); if (a) i = a.reduce((s, v) => s + Math.abs(v), 0) / a.length; }
      if (i === null && S.sim.result) i = pinCurrent(c, "A");
      if (i === null || !isFinite(i)) return null;
      if (g.abs) i = Math.abs(i);
      return i > g.min ? Math.min(1, Math.sqrt(i / g.full)) : 0;
    }
    // a magic eye now: { shadow 0–1 (of 90°), glow 0–1 }, or null with nothing simulated
    function eyeLevel(c) {
      const m = CadLib.EYES[c.params.model] || CadLib.EYES["6E5"];
      let vt = null, vp = null;
      const P = powerOn(), d = !P && cycle(), at = (a, j) => a[Math.min(a.length - 1, j)];
      if (P && P.ok) { const e = P.eyes.get(c.id); if (e && e.vt.length) { const j = Math.floor(P.t / P.dt); vt = at(e.vt, j); vp = at(e.vp, j); } }
      else if (d) { const e = d.eyes.get(c.id); if (e) { vt = animAt(e.vt, S.anim.phase); vp = animAt(e.vp, S.anim.phase); } }
      if (vt === null && S.sim.result) {
        const T = S.sim.topo || topo(), v = pid => netDC(T.pinNet.get(c.id + ":" + pid)), k = v("K");
        if (k !== null && v("T") !== null && v("P") !== null) { vt = v("T") - k; vp = v("P") - k; }
      }
      return vt === null || !isFinite(vt) || !isFinite(vp) ? null : CadLib.eyeShadow(m, vt, vp);
    }
    // under the wires: each node's AC voltage as a tint
    function drawAnimTint(T) {
      const ctx = getCtx();
      const d = cycle(); if (!d) return;
      ctx.lineCap = "round";
      S.wires.forEach(w => {
        const a = d.nets.get(T.wireNet.get(w.id)); if (!a) return;
        const v = animAt(a.ac, S.anim.phase) / a.pk;
        ctx.strokeStyle = v >= 0 ? `rgba(255,150,60,${(0.12 + 0.5 * v).toFixed(3)})` : `rgba(70,160,255,${(0.12 - 0.5 * v).toFixed(3)})`;
        ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke();
      });
    }
    // over the wires: the current as moving dots (spaced 12 units, from x1,y1 towards x2,y2 when positive), violet DC or pale AC
    function drawAnimDots() {
      const ctx = getCtx();
      const d = cycle(); if (!d) return;
      d.wires.forEach((a, id) => {
        const w = S.wires.find(q => q.id === id); if (!w) return;
        const L = Math.hypot(w.x2 - w.x1, w.y2 - w.y1); if (L < 1) return;
        const ux = (w.x2 - w.x1) / L, uy = (w.y2 - w.y1) / L, off = (((S.anim.off.get(id) || 0) % 12) + 12) % 12;
        const dc = a.mode === "dc", bright = Math.max(0.35, Math.min(1, (Math.log10(dc ? Math.abs(a.dc) : a.pk) + 6.5) / 5));
        ctx.fillStyle = dc ? `rgba(210,168,255,${bright.toFixed(2)})` : `rgba(255,247,194,${bright.toFixed(2)})`;
        for (let s = off; s <= L; s += 12) { ctx.beginPath(); ctx.arc(w.x1 + ux * s, w.y1 + uy * s, 2.2, 0, Math.PI * 2); ctx.fill(); }
      });
    }
    // the time line, top left of the sheet
    function drawAnimHud() {
      const ctx = getCtx();
      const P = powerOn(), d = !P && cycle(); if (!d && !P) return;
      const x = 10, y = 10, w = 250, h = 34, ph = S.anim.phase;
      ctx.fillStyle = "rgba(10,14,20,0.88)"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "#26344a"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = "#c9d1d9"; ctx.textAlign = "left";
      if (P) {
        // the power-on playback: its time line, or the run's progress
        const f = P.ok ? P.t / P.tStop : P.progress || 0;
        ctx.fillText(P.running ? `Power-on: simulating ${fmtEng(P.tStop, "s")}… ${Math.floor(f * 100)} %` : P.ok ? `Power-on · ${P.t.toFixed(2)} s of ${fmtEng(P.tStop, "s")}, real time` : "Power-on playback failed", x + 7, y + 13);
        ctx.fillStyle = "rgba(201,209,217,0.25)"; ctx.fillRect(x + 7, y + 21, w - 14, 5);
        ctx.fillStyle = P.ok ? "#ffd54f" : "#58a6ff"; ctx.fillRect(x + 7, y + 21, (w - 14) * f, 5);
        return;
      }
      ctx.fillText(`AC · ${fmtEng(d.f, "Hz")}, ${cycleS(d) === ANIM_S ? `one cycle in ${ANIM_S} s` : "real time"} · ${Math.round(ph * 360)}°`, x + 7, y + 13);
      // one cycle of a sine, with the moment marked
      const sx = x + 7, sw = w - 14, sy = y + 24;
      ctx.strokeStyle = "rgba(201,209,217,0.5)"; ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const px = sx + sw * i / 60, py = sy - 5 * Math.sin(2 * Math.PI * i / 60); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.arc(sx + sw * ph, sy - 5 * Math.sin(2 * Math.PI * ph), 3, 0, Math.PI * 2); ctx.fill();
    }
    return { animData, changed, drawAnimDots, drawAnimHud, drawAnimTint, eyeLevel, ledLevel, setAnim };
  };
})(window);
