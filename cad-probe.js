/* Voltmeter probe (P): a card at the pointer with the node's DC, AC and a small
   scope trace of its waveform; a click leaves the probe on that node, where it
   follows every new simulation until Esc, its × or a click on empty sheet. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadProbe = function (cad) {
    const { S, LIB, acDigits, compPins, desig, fmtEng, getCtx, hitPin, hitWire, isH, netDC, netWave, render, signalFreq, stats } = cad;
    // what the probe touches at a point: a pin, else a wire (kept by id, so it follows edits)
    function probeAt(x, y) {
      const pin = hitPin(x, y);
      if (pin) return { comp: pin.c.id, pid: pin.p.id, x: pin.p.x, y: pin.p.y };
      const w = hitWire(x, y);
      if (!w) return null;
      const px = isH(w) ? Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), x)) : w.x1;
      const py = isH(w) ? w.y1 : Math.max(Math.min(w.y1, w.y2), Math.min(Math.max(w.y1, w.y2), y));
      return { wire: w.id, x: px, y: py };
    }
    // the target on the current drawing: its net, name and anchor point, or null when it is gone
    function probeNode(t, T) {
      if (!t) return null;
      if (t.comp) {
        const c = S.comps.find(k => k.id === t.comp), p = c && compPins(c).find(q => q.id === t.pid);
        if (!p) return null;
        const name = c.type === "offsheet" || c.type === "rail" ? (c.params.name || (c.type === "rail" ? "rail" : "connector")) : `${desig(c) || LIB[c.type].name} ${p.name || p.id}`;
        return { net: T.pinNet.get(c.id + ":" + p.id), name, x: p.x, y: p.y };
      }
      const w = S.wires.find(k => k.id === t.wire);
      if (!w) return null;
      const x = isH(w) ? Math.max(Math.min(w.x1, w.x2), Math.min(Math.max(w.x1, w.x2), t.x)) : w.x1;
      const y = isH(w) ? w.y1 : Math.max(Math.min(w.y1, w.y2), Math.min(Math.max(w.y1, w.y2), t.y));
      // name the wire after a part pin on its net, so the card says where it is
      const net = T.wireNet.get(w.id);
      let name = "wire";
      for (const [k, n] of T.pinNet) if (n === net) { const [cid, pid] = k.split(":"), c = S.comps.find(q => q.id === cid); if (c && c.type !== "ground" && desig(c)) { const p = compPins(c).find(q => q.id === pid); name = `wire at ${desig(c)} ${p && p.name || pid}`; break; } }
      return { net, name, x, y };
    }
    // what the probe reads on a net (exported for the tests as TubeCAD.probeRead)
    function probeRead(net) {
      if (net === undefined) return { state: "open" };
      if (net === 0) return { state: "ground", dc: 0 };
      const dc = netDC(net);
      if (dc === null) return { state: S.sim.busy ? "busy" : "none" };
      const wave = netWave(net), st = wave ? stats(wave) : null, r = S.sim.result;
      const out = { state: "ok", dc };
      if (st) {
        Object.assign(out, { rms: st.rmsAC, pp: st.pp, min: st.min, max: st.max, mean: st.mean, wave, dt: r.tran.dt });
        if (st.pp > 1e-4) out.freq = ScopeMath.fundamental(wave, r.tran.dt) || null;
      }
      return out;
    }
    // wires of the probed nets glow yellow under the normal stroke
    function drawProbeGlow(T) {
      const ctx = getCtx();
      const nets = [S.probe.pin, S.probe.hover].map(t => { const n = probeNode(t, T); return n ? n.net : undefined; }).filter(n => n !== undefined);
      if (!nets.length) return;
      ctx.strokeStyle = "rgba(255,213,79,0.35)"; ctx.lineWidth = 8;
      S.wires.forEach(w => { if (nets.includes(T.wireNet.get(w.id))) { ctx.beginPath(); ctx.moveTo(w.x1, w.y1); ctx.lineTo(w.x2, w.y2); ctx.stroke(); } });
    }
    const probeEls = {};
    function probeCard(kind) {
      if (probeEls[kind]) return probeEls[kind];
      const el = document.createElement("div");
      el.className = "probe-card " + kind; el.id = "probe-" + kind; el.hidden = true;
      el.innerHTML = `<div class="probe-head"><span class="probe-name"></span>${kind === "pin" ? '<button class="probe-x" title="Remove the probe (Esc)" aria-label="Remove the probe">×</button>' : ""}</div><div class="probe-vals"></div><canvas class="probe-scope" width="176" height="88"></canvas><div class="probe-scale"></div>`;
      if (kind === "pin") el.querySelector(".probe-x").addEventListener("click", () => { S.probe.pin = null; render(); });
      document.getElementById("stage").appendChild(el);
      return (probeEls[kind] = el);
    }
    function drawProbes(T, W, H) {
      const ctx = getCtx();
      const items = [["pin", S.probe.pin], ["hover", S.probe.hover]];
      // hovering the node already probed: one card is enough
      const pn = probeNode(S.probe.pin, T), hn = probeNode(S.probe.hover, T);
      if (!pn) S.probe.pin = null;
      items.forEach(([kind, t]) => {
        const n = kind === "pin" ? pn : (hn && !(pn && pn.net === hn.net) ? hn : null);
        if (!n && !probeEls[kind]) return;
        const el = probeCard(kind);
        if (!n) { el.hidden = true; return; }
        // the probe tip on the sheet
        const sx = n.x * S.view.scale + S.view.ox, sy = n.y * S.view.scale + S.view.oy;
        ctx.strokeStyle = "#ff5c5c"; ctx.fillStyle = "#ff5c5c"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(sx + 3, sy - 3); ctx.lineTo(sx + 14, sy - 14); ctx.stroke();
        fillProbeCard(el, n, probeRead(n.net));
        el.hidden = false;
        // beside the tip, flipped to stay inside the sheet
        const cw = el.offsetWidth, ch = el.offsetHeight;
        let left = sx + 18, top = sy - 18 - ch;
        if (left + cw > W - 4) left = sx - 18 - cw;
        if (top < 4) top = sy + 18;
        el.style.left = Math.max(4, Math.min(W - cw - 4, left)) + "px";
        el.style.top = Math.max(4, Math.min(H - ch - 4, top)) + "px";
      });
    }
    function fillProbeCard(el, n, rd) {
      el.querySelector(".probe-name").textContent = n.name;
      const vals = el.querySelector(".probe-vals"), cv = el.querySelector(".probe-scope"), scale = el.querySelector(".probe-scale");
      const row = (k, v) => `<span class="k">${k}</span><span class="v">${v}</span>`;
      // four significant figures, like a bench meter: 147.2V, 3.215Vrms
      const f4 = (v, u) => fmtEng(v, u, Math.abs(v) >= 1e-9 ? acDigits(Math.abs(v)) + 1 : 0);
      let html = "";
      if (rd.state === "open") html = row("", "not connected");
      else if (rd.state === "ground") html = row("DC", "0 V (ground)");
      else if (rd.state === "busy") html = row("", "simulating…");
      else if (rd.state === "none") html = row("", S.sim.error ? "no result: " + S.sim.error : "simulate first (Ctrl+Enter)");
      else {
        html = row("DC", f4(rd.dc, "V"));
        if (rd.rms !== undefined && rd.pp > 1e-4) html += row("AC", f4(rd.rms, "Vrms")) + row("p-p", f4(rd.pp, "Vpp")) + (rd.freq ? row("f", f4(rd.freq, "Hz")) : "");
        else if (rd.rms !== undefined) html += row("AC", "none");
      }
      if (vals.innerHTML !== html) vals.innerHTML = html;
      const show = rd.state === "ok" && !!rd.wave;
      cv.hidden = !show; scale.hidden = !show;
      if (show) scale.textContent = drawProbeScope(cv, rd);
    }
    // the little scope: DC coupled with automatic position, triggered on the rising edge,
    // two to five periods on ten divisions (same auto-ranging as the scope parts)
    function drawProbeScope(cv, rd) {
      const SM = ScopeMath, g = cv.getContext("2d"), w = cv.width, h = cv.height;
      g.fillStyle = "#03080d"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "rgba(0,180,216,0.18)"; g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) { const x = Math.round(i * (w - 1) / 10) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let j = 0; j <= 8; j++) { const y = Math.round(j * (h - 1) / 8) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      const a = rd.wave, chn = SM.channel(a, "auto", "dc"), tdiv = SM.timebase(a, rd.dt, signalFreq()).tdiv;
      const count = Math.max(2, Math.round((10 * tdiv) / rd.dt)), start = SM.triggerIndex(a, "rising");
      g.strokeStyle = "#ffd54f"; g.lineWidth = 1.5; g.beginPath();
      for (let i = 0; i < count; i++) {
        const v = (SM.at(a, start + i) - chn.off) / chn.vdiv;
        const px = i / (count - 1) * w, py = h / 2 - Math.max(-4.2, Math.min(4.2, v)) * h / 8;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
      return `${fmtEng(chn.vdiv, "V")}/div${chn.offset ? ` · centre ${fmtEng(chn.offset, "V")}` : ""} · ${fmtEng(tdiv, "s")}/div`;
    }
    return { drawProbeGlow, drawProbes, probeAt, probeRead };
  };
})(window);
