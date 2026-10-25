/* AC animation: one period of the signal, slowed to ANIM_S seconds. Each wire's current (the
   simulation's terminal currents at 120 instants, carried through the wiring as for the
   current stickers) runs as dots along it, showing only its DC or its AC, by its node's
   voltage: where the node's DC is at least its AC rms, violet dots flow steadily with the
   DC current; elsewhere pale dots swing with the current less its DC. Ground goes by its
   current, and a wire that carries next to none of the chosen part shows the other. Each
   node's AC voltage tints its wires, orange swinging up, blue swinging down. The AC is scaled
   to each wire's own peak, so the microamps at a grid move as visibly as the plate's
   milliamps; brighter dots, more current. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadAnim = function (cad) {
    const { S, fmtEng, getCtx, netDC, pinMap, render, setStatus, signalFreq, stats, topo, wireCurrents } = cad;
    const ANIM_S = 3, ANIM_DC_SPEED = 25;   // DC dots: units a second, about the AC dots' average
    S.anim = { on: false, phase: 0, last: 0, data: null, off: new Map(), raf: 0 };
    function animData() {
      const r = S.sim.result, F = r && r.tran && r.tran.frames;
      if (!F || F.cur.length < 8) return null;
      if (S.anim.data && S.anim.data.r === r) return S.anim.data;
      const T = S.sim.topo || topo(), flat = F.layout.slice(), n = F.cur.length;
      const perFrame = F.cur.map(vals => { for (let k = 0; k < vals.length; k++) flat[3 * k + 2] = vals[k]; const wc = wireCurrents(pinMap(flat)); return wc ? wc.currents : new Map(); });
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
      S.anim.data = { r, n, wires, nets, f: signalFreq() };
      return S.anim.data;
    }
    // a quantity at the animation's phase, between its frames
    const animAt = (a, phase) => { const n = a.length, f = phase * n, j = Math.floor(f) % n, u = f - Math.floor(f); return a[j] * (1 - u) + a[(j + 1) % n] * u; };
    function animTick(now) {
      if (!S.anim.on) return;
      const d = animData();
      const dt = S.anim.last ? Math.min(0.1, (now - S.anim.last) / 1000) : 0; S.anim.last = now;
      if (d) {
        S.anim.phase = (S.anim.phase + dt / ANIM_S) % 1;
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
        if (!animData()) setStatus("warn", S.sim.result ? "Nothing to animate: the circuit has no signal (add a signal generator)" : "Simulate first: the animation plays the simulated signal");
        S.anim.raf = requestAnimationFrame(animTick);
      }
      render();
    }
    // under the wires: each node's AC voltage as a tint
    function drawAnimTint(T) {
      const ctx = getCtx();
      const d = S.anim.on && animData(); if (!d) return;
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
      const d = S.anim.on && animData(); if (!d) return;
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
      const d = S.anim.on && animData(); if (!d) return;
      const x = 10, y = 10, w = 250, h = 34, ph = S.anim.phase;
      ctx.fillStyle = "rgba(10,14,20,0.88)"; ctx.fillRect(x, y, w, h); ctx.strokeStyle = "#26344a"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = "#c9d1d9"; ctx.textAlign = "left";
      ctx.fillText(`AC · ${fmtEng(d.f, "Hz")}, one cycle in ${ANIM_S} s · ${Math.round(ph * 360)}°`, x + 7, y + 13);
      // one cycle of a sine, with the moment marked
      const sx = x + 7, sw = w - 14, sy = y + 24;
      ctx.strokeStyle = "rgba(201,209,217,0.5)"; ctx.beginPath();
      for (let i = 0; i <= 60; i++) { const px = sx + sw * i / 60, py = sy - 5 * Math.sin(2 * Math.PI * i / 60); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke(); ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.arc(sx + sw * ph, sy - 5 * Math.sin(2 * Math.PI * ph), 3, 0, Math.PI * 2); ctx.fill();
    }
    return { animData, drawAnimDots, drawAnimHud, drawAnimTint, setAnim };
  };
})(window);
