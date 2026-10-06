/* =============================================================================
   VACUUM TUBE CURVE TRACER — viewer for the circuit CAD
   Plots the plate-curve family of a tube and, when the tube is part of the CAD
   circuit, its simulated operating point and dynamic load line (trajectory).
   Depends on: tube-db.js, sim-engine.js (TubeSimEngine.Koren), cad-components.js (fmtEng)
   ============================================================================= */
(function () {
  "use strict";
  const Koren = TubeSimEngine.Koren;
  const { fmtEng, tubeKind } = CadLib;
  const CHANNEL = "tube_cad_v2";

  const S = {
    circuit: null,               // last SIM_RESULT from the CAD
    lastSeen: 0,
    view: null,                  // { source: "circuit", id } | { source: "library", name }
    filter: "all", query: "",
    vg2Preview: 250,
    opts: { traj: true, pa: true, pa70: true, bias: true },
    fit: null,                   // { points, params, r2, rmse, kind }
    hover: null
  };

  const $ = id => document.getElementById(id);
  const tubeByName = n => TUBE_DATABASE.find(t => t.commonName === n);

  // ---------------------------------------------------------------------------
  // Link to the CAD
  // ---------------------------------------------------------------------------
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  if (channel) {
    channel.onmessage = e => {
      const m = e.data || {};
      if (m.type === "SELECT_TUBE") {
        // tube selected in the CAD editor: show it, overriding a library pick
        const inCircuit = S.circuit && (S.circuit.tubes || []).some(t => t.id === m.id);
        S.view = inCircuit ? { source: "circuit", id: m.id } : { source: "library", name: m.tube, pendingId: m.id };
        renderAll();
        return;
      }
      if (m.type !== "SIM_RESULT") return;
      S.circuit = m; S.lastSeen = Date.now();
      const tubes = m.tubes || [];
      const has = id => id && tubes.some(t => t.id === id);
      const lost = S.view && S.view.source === "circuit" && !has(S.view.id);
      if (S.view && S.view.pendingId && has(S.view.pendingId)) S.view = { source: "circuit", id: S.view.pendingId };   // just-placed tube now simulated
      else if (tubes.length && (!S.view || lost || (S.view.source === "library" && !S.view.picked && !S.view.pendingId)))
        S.view = { source: "circuit", id: has(m.selectedTubeId) ? m.selectedTubeId : tubes[0].id };   // follow the circuit, preferring the CAD selection
      else if (!tubes.length && (!S.view || lost)) S.view = { source: "library", name: "12AX7" };
      renderAll();
    };
    channel.postMessage({ type: "REQUEST_STATE" });
  }
  setInterval(renderLink, 2000);

  function renderLink() {
    const el = $("link-status");
    const c = S.circuit;
    if (!c) { el.className = "link idle"; el.innerHTML = `No circuit linked — <a href="circuit_sandbox.html" target="tube_cad">open the Circuit CAD ↗</a>`; return; }
    if (c.empty) { el.className = "link idle"; el.textContent = "CAD open · empty sheet"; return; }
    if (!c.ok) { el.className = "link bad"; el.textContent = "CAD: " + (c.error || "not simulated"); return; }
    const ago = Math.round((Date.now() - c.at) / 1000);
    el.className = "link ok";
    el.textContent = `Linked to CAD · ${c.tubes.length} tube${c.tubes.length === 1 ? "" : "s"} · simulated ${ago < 2 ? "just now" : ago + " s ago"}`;
  }

  // ---------------------------------------------------------------------------
  // What is being displayed
  // ---------------------------------------------------------------------------
  function current() {
    if (S.view && S.view.source === "circuit" && S.circuit) {
      const ct = (S.circuit.tubes || []).find(t => t.id === S.view.id);
      if (ct) {
        const tube = tubeByName(ct.tube);
        return { tube, kind: ct.kind, model: ct.model, vg2: ct.kind === "pentode" ? ct.dc.vg2k : null, circuit: ct };
      }
    }
    const tube = tubeByName(S.view && S.view.name) || tubeByName("12AX7");
    const kind = tubeKind(tube) === "pentode" ? "pentode" : "triode";
    return { tube, kind, model: kind === "pentode" ? tube.koren.Pentode : tube.koren.Triode, vg2: kind === "pentode" ? S.vg2Preview : null, circuit: null };
  }
  function iaOf(d, va, vg, model) {
    const m = model || d.model;
    return d.kind === "pentode" ? Koren.pentodeIa(va, vg, d.vg2, m) : Koren.triodeIa(va, vg, m);
  }

  // ---------------------------------------------------------------------------
  // Left column: circuit tubes + library
  // ---------------------------------------------------------------------------
  function renderCircuitList() {
    const host = $("circuit-tubes");
    const tubes = S.circuit && S.circuit.ok ? S.circuit.tubes : [];
    if (!tubes.length) {
      host.innerHTML = `<p class="muted small">${S.circuit && S.circuit.ok ? "The circuit has no amplifying tubes yet." : "Build a circuit in the <a href=\"circuit_sandbox.html\" target=\"tube_cad\">Circuit CAD ↗</a> — its tubes appear here with their simulated operating point."}</p>`;
      return;
    }
    host.innerHTML = "";
    tubes.forEach(t => {
      const b = document.createElement("button");
      const active = S.view && S.view.source === "circuit" && S.view.id === t.id;
      const pa = t.dc.vak * t.dc.ia;
      b.className = "list-item" + (active ? " active" : "");
      b.innerHTML = `<span><b>${t.label}</b> ${t.tube}${t.kind === "triode" && tubeKind(tubeByName(t.tube)) === "pentode" ? " (triode)" : ""}</span><em class="${pa > t.paMax ? "bad" : ""}">${fmtEng(t.dc.vak, "V", 0)} · ${fmtEng(t.dc.ia, "A", 1)}</em>`;
      b.onclick = () => { S.view = { source: "circuit", id: t.id }; renderAll(); };
      host.appendChild(b);
    });
  }
  function renderLibrary() {
    const host = $("tube-list");
    host.innerHTML = "";
    const q = S.query.toLowerCase();
    TUBE_DATABASE.filter(t => {
      const k = tubeKind(t);
      if (k === "rectifier") return false;
      if (S.filter === "triode" && k !== "triode") return false;
      if (S.filter === "pentode" && k !== "pentode") return false;
      if (S.filter === "fav" && !t.isFavorite) return false;
      return !q || (t.commonName + " " + t.nameGost + " " + t.nameWestern + " " + t.type).toLowerCase().includes(q);
    }).forEach(t => {
      const b = document.createElement("button");
      const active = S.view && S.view.source === "library" && S.view.name === t.commonName;
      b.className = "list-item" + (active ? " active" : "");
      b.innerHTML = `<span>${t.isFavorite ? "★ " : ""}${t.commonName}</span><em>${t.type}</em>`;
      b.title = `${t.nameWestern} · ${t.nameGost}`;
      b.onclick = () => { S.view = { source: "library", name: t.commonName, picked: true }; renderAll(); };
      host.appendChild(b);
    });
  }

  // ---------------------------------------------------------------------------
  // Pinout socket (ported from the previous tracer)
  // ---------------------------------------------------------------------------
  function drawPinout(tube) {
    const cv = $("socket"), ctx = cv.getContext("2d");
    const w = cv.width, h = cv.height, cx = w / 2, cy = h / 2, radius = (Math.min(w, h) - 24) / 2;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createRadialGradient(cx, cy, 5, cx, cy, radius);
    grad.addColorStop(0, "#2c3444"); grad.addColorStop(0.85, "#161b24"); grad.addColorStop(1, "#0d1117");
    ctx.fillStyle = grad; ctx.strokeStyle = "#405068"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#0c1017"; ctx.beginPath(); ctx.arc(cx, cy, radius * 0.28, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#354457"; ctx.stroke();
    ctx.fillStyle = "#8ba0bc"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(tube.socket.split(" ")[0], cx, cy);
    const n = tube.pinCount, pins = tube.pinout || [], pr = radius * 0.68;
    for (let i = 1; i <= n; i++) {
      const pd = pins.find(p => p.pin === i) || { pin: i, sym: String(i) };
      let ang;
      if (n === 9) ang = [0, 108, 144, 180, 216, 252, 288, 324, 0, 36][i];
      else if (n === 8) ang = 112.5 + (i - 1) * 45;
      else if (n === 4) ang = [0, 135, 225, 315, 45][i];
      else ang = 115 + (i - 1) * (310 / Math.max(n - 1, 1));
      ang = ang * Math.PI / 180;
      const px = cx + pr * Math.cos(ang), py = cy + pr * Math.sin(ang);
      let fill = "#3d4b60", border = "#60728c";
      if (pd.isHeater) { fill = "#ffb300"; border = "#fff"; }
      else if (pd.isShield) { fill = tube.hasPin9Shield ? "#c62828" : "#546e7a"; }
      else if (pd.isPlate) { fill = "#d32f2f"; border = "#ff8a80"; }
      else if (pd.isGrid) { fill = "#00b0ff"; border = "#80d8ff"; }
      else if (pd.isCathode) { fill = "#00c853"; border = "#b9f6ca"; }
      else if (pd.isScreen) { fill = "#aa00ff"; border = "#ea80fc"; }
      ctx.beginPath(); ctx.arc(px, py, 11, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = border; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = pd.isHeater ? "#000" : "#fff"; ctx.font = "bold 8px monospace"; ctx.fillText(pd.sym, px, py);
      const nd = pr + 18;
      ctx.fillStyle = "#8fa6c2"; ctx.font = "7.5px sans-serif"; ctx.fillText(i, cx + nd * Math.cos(ang), cy + nd * Math.sin(ang));
    }
    $("socket-name").textContent = tube.socket;
    $("socket-note").textContent = tube.heaterWarning || "";
  }

  // ---------------------------------------------------------------------------
  // Plot
  // ---------------------------------------------------------------------------
  function niceCeil(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9))));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  function niceStep(v) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1e-9))));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }

  let plotGeom = null;
  function drawPlot() {
    const cv = $("plot"), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1119"; ctx.fillRect(0, 0, W, H);
    const d = current(), t = d.tube, ct = d.circuit;
    const traj = ct && ct.traj && S.opts.traj ? ct.traj : null;

    // axes ranges
    let vaMaxData = t.vaMax * 1.15, iaMaxData = 0;
    if (ct) { vaMaxData = Math.max(vaMaxData, ct.dc.vak * 1.3); iaMaxData = Math.max(iaMaxData, ct.dc.ia * 2.2); }
    if (traj) { vaMaxData = Math.max(vaMaxData, Math.max(...traj.vak) * 1.08); iaMaxData = Math.max(iaMaxData, Math.max(...traj.ia) * 1.2); }
    if (S.fit) S.fit.points.forEach(p => { vaMaxData = Math.max(vaMaxData, p.va * 1.05); iaMaxData = Math.max(iaMaxData, p.iaMa / 1000 * 1.1); });
    const vaMax = niceCeil(vaMaxData);
    // scale current to the tube itself: its Vg = 0 curve at 60% of the voltage axis
    iaMaxData = Math.max(iaMaxData, iaOf(d, 0.6 * vaMax, 0) * 1.05, 1.5 * t.paMax / vaMax);
    const iaMax = niceCeil(iaMaxData);

    const padL = 58, padR = 70, padT = 18, padB = 44;
    const pw = W - padL - padR, ph = H - padT - padB;
    const X = va => padL + va / vaMax * pw, Y = ia => padT + ph - ia / iaMax * ph;
    plotGeom = { padL, padT, pw, ph, vaMax, iaMax };

    // grid + labels
    ctx.font = "11px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle";
    const vStep = niceStep(vaMax / 10), iStep = niceStep(iaMax / 8);
    ctx.strokeStyle = "rgba(60,80,110,0.35)"; ctx.lineWidth = 1; ctx.fillStyle = "#6a82a0";
    for (let v = 0; v <= vaMax + 1e-9; v += vStep) { ctx.beginPath(); ctx.moveTo(X(v), padT); ctx.lineTo(X(v), padT + ph); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(String(+v.toFixed(3)), X(v), padT + ph + 14); }
    for (let i = 0; i <= iaMax + 1e-12; i += iStep) { ctx.beginPath(); ctx.moveTo(padL, Y(i)); ctx.lineTo(padL + pw, Y(i)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(String(+(i * 1000).toFixed(3)), padL - 8, Y(i)); }
    ctx.fillStyle = "#8fa6c2"; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Plate voltage Va (V)", padL + pw / 2, H - 10);
    ctx.save(); ctx.translate(16, padT + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("Plate current Ia (mA)", 0, 0); ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();

    // Pa max hyperbola + zone
    if (S.opts.pa) {
      ctx.beginPath();
      let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(px / pw * vaMax, 1); const ia = t.paMax / va; const y = Y(Math.min(ia, iaMax * 2)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.lineTo(padL + pw, padT); ctx.lineTo(padL, padT); ctx.closePath();
      ctx.fillStyle = "rgba(255,51,68,0.07)"; ctx.fill();
      ctx.beginPath(); first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(px / pw * vaMax, 1); const y = Y(Math.min(t.paMax / va, iaMax * 2)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "#ff3344"; ctx.lineWidth = 1.8; ctx.stroke();
    }
    if (S.opts.pa70) {
      ctx.beginPath(); let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(px / pw * vaMax, 1); const y = Y(Math.min(0.7 * t.paMax / va, iaMax * 2)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "rgba(255,179,0,0.7)"; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    }

    // curve family
    const cutoff = d.kind === "pentode" ? -(d.vg2 || 250) / d.model.mu : -vaMax / d.model.mu;
    const gStep = niceStep(Math.abs(cutoff) / 8);
    const labels = [];
    for (let vg = 0, k = 0; vg >= cutoff * 1.05 && k < 16; vg -= gStep, k++) {
      ctx.beginPath(); let first = true, lastY = null;
      for (let px = 0; px <= pw; px += 2) {
        const va = px / pw * vaMax, ia = iaOf(d, va, vg);
        const y = Y(ia); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; lastY = y;
      }
      ctx.strokeStyle = "rgba(41,182,246,0.85)"; ctx.lineWidth = 1.3; ctx.stroke();
      if (lastY > padT + 8 && lastY < padT + ph - 4) labels.push([vg, lastY]);
    }
    // bias curve (DC grid voltage of the circuit tube)
    if (ct && S.opts.bias) {
      const vg = ct.dc.vgk;
      ctx.beginPath(); let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = px / pw * vaMax; const y = Y(iaOf(d, va, vg)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "#3fb950"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    // fitted model + measured points
    if (S.fit) {
      const fd = { kind: S.fit.kind, vg2: S.fit.vg2 || 250, model: S.fit.params };
      const vgs = [...new Set(S.fit.points.map(p => p.vg))];
      vgs.forEach(vg => {
        ctx.beginPath(); let first = true;
        for (let px = 0; px <= pw; px += 3) { const va = px / pw * vaMax; const y = Y(iaOf(fd, va, vg)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
        ctx.strokeStyle = "rgba(186,104,200,0.9)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
      });
      ctx.fillStyle = "#b9f6ca";
      S.fit.points.forEach(p => { ctx.beginPath(); ctx.arc(X(p.va), Y(p.iaMa / 1000), 2.2, 0, Math.PI * 2); ctx.fill(); });
    }
    // dynamic load line (trajectory)
    if (traj && traj.vak && traj.vak.length > 1) {
      ctx.beginPath();
      traj.vak.forEach((v, i) => { const x = X(v), y = Y(traj.ia[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 2.4; ctx.stroke();
      // direction arrow
      const n = traj.vak.length, i0 = Math.floor(n * 0.2), i1 = Math.min(n - 1, i0 + 3);
      const ax = X(traj.vak[i1]), ay = Y(traj.ia[i1]), ang = Math.atan2(ay - Y(traj.ia[i0]), ax - X(traj.vak[i0]));
      ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.moveTo(ax, ay);
      ctx.lineTo(ax - 10 * Math.cos(ang - 0.4), ay - 10 * Math.sin(ang - 0.4)); ctx.lineTo(ax - 10 * Math.cos(ang + 0.4), ay - 10 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fill();
    }
    // Q point
    if (ct) {
      const qx = X(ct.dc.vak), qy = Y(ct.dc.ia);
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(qx, qy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#00e5ff"; ctx.beginPath(); ctx.arc(qx, qy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 11px ui-monospace, monospace"; ctx.textAlign = "left";
      const txt = `Q ${fmtEng(ct.dc.vak, "V", 1)}, ${fmtEng(ct.dc.ia, "A", 2)}`;
      ctx.fillStyle = "rgba(11,17,25,0.85)"; ctx.fillRect(qx + 10, qy - 22, ctx.measureText(txt).width + 8, 16);
      ctx.fillStyle = "#e6edf3"; ctx.fillText(txt, qx + 14, qy - 14);
    }
    ctx.restore();

    // curve labels at the right edge
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillStyle = "#29b6f6";
    labels.forEach(([vg, y]) => ctx.fillText(`${+vg.toFixed(2)} V`, padL + pw + 4, y));

    // hover crosshair
    if (S.hover) {
      const { va, ia } = S.hover;
      if (va >= 0 && va <= vaMax && ia >= 0 && ia <= iaMax) {
        ctx.strokeStyle = "rgba(230,237,243,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(va), padT); ctx.lineTo(X(va), padT + ph); ctx.moveTo(padL, Y(ia)); ctx.lineTo(padL + pw, Y(ia)); ctx.stroke();
      }
    }
    // title
    $("plot-title").textContent = `${t.commonName} · ${d.kind === "pentode" ? `pentode, Vg2 = ${fmtEng(d.vg2, "V", 0)}` : (tubeKind(t) === "pentode" ? "triode-connected" : "triode")}` + (ct ? ` · ${ct.label} in circuit` : " · library preview");
    // legend
    $("legend").innerHTML = [
      `<span><i style="background:#29b6f6"></i>Plate curves (Vg step ${+gStep.toFixed(2)} V)</span>`,
      ct && S.opts.bias ? `<span><i style="background:#3fb950"></i>Curve at circuit bias ${fmtEng(ct.dc.vgk, "V", 2)}</span>` : "",
      traj ? `<span><i style="background:#ffd54f"></i>Simulated load line</span>` : "",
      ct ? `<span><i style="background:#00e5ff"></i>Operating point</span>` : "",
      S.opts.pa ? `<span><i style="background:#ff3344"></i>Pa max ${t.paMax} W</span>` : "",
      S.fit ? `<span><i style="background:#ba68c8"></i>Fitted model</span>` : ""
    ].join("");
  }

  function onPlotMove(e) {
    if (!plotGeom) return;
    const r = $("plot").getBoundingClientRect(), g = plotGeom;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const va = (x - g.padL) / g.pw * g.vaMax, ia = (g.padT + g.ph - y) / g.ph * g.iaMax;
    if (va < 0 || va > g.vaMax || ia < 0 || ia > g.iaMax) { S.hover = null; $("plot-readout").textContent = ""; drawPlot(); return; }
    S.hover = { va, ia };
    const d = current();
    $("plot-readout").textContent = `Va ${va.toFixed(1)} V · Ia ${(ia * 1000).toFixed(2)} mA · Pa ${(va * ia).toFixed(2)} W (${Math.round(va * ia / d.tube.paMax * 100)}% of max)`;
    drawPlot();
  }

  // ---------------------------------------------------------------------------
  // Right column
  // ---------------------------------------------------------------------------
  const kv = (k, v, cls) => `<div class="kv${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`;
  function renderHud() {
    const d = current(), t = d.tube, ct = d.circuit;
    let h = "";
    if (ct) {
      const dc = ct.dc, pa = dc.vak * dc.ia;
      h += `<h3>Operating point <small>${ct.label}</small></h3>`;
      h += kv("Va (plate–cathode)", fmtEng(dc.vak, "V", 1), dc.vak > t.vaMax ? "bad" : "");
      h += kv(d.kind === "pentode" ? "Vg1 (bias)" : "Vg (bias)", fmtEng(dc.vgk, "V", 2), dc.vgk > 0 ? "warn" : "");
      if (d.kind === "pentode") h += kv("Vg2 (screen)", fmtEng(dc.vg2k, "V", 1));
      h += kv("Ia", fmtEng(dc.ia, "A", 2));
      if (d.kind === "pentode") h += kv("Ig2", fmtEng(dc.ig2, "A", 2));
      h += kv("Pa (DC)", fmtEng(pa, "W", 2), pa > t.paMax ? "bad" : (pa > 0.85 * t.paMax ? "warn" : ""));
      h += `<div class="bar"><div style="width:${Math.min(100, pa / t.paMax * 100)}%;background:${pa > t.paMax ? "#ff3344" : (pa > 0.85 * t.paMax ? "#ffb300" : "#3fb950")}"></div></div>`;
      if (ct.metrics) {
        const m = ct.metrics;
        h += `<h3>With signal</h3>`;
        h += kv("Plate swing", fmtEng(m.vakPP, "Vpp", 1)) + kv("Grid swing", fmtEng(m.vgkPP, "Vpp", 2));
        if (m.gain) h += kv("Plate / grid gain", m.gain.toFixed(1) + "×");
        if (m.thd !== null && m.thd !== undefined) h += kv("THD at plate", m.thd.toFixed(2) + " %", m.thd > 5 ? "warn" : "");
        h += kv("Average Pa", fmtEng(m.pAvg, "W", 2), m.pAvg > t.paMax ? "bad" : "");
      }
      const spk = S.circuit.speakers || [];
      if (spk.length) { h += `<h3>Circuit output</h3>`; spk.forEach(s => { h += kv(`${s.label} (${s.r} Ω)`, fmtEng(s.pAvg, "W", 2)); }); }
    } else {
      h += `<h3>Library preview</h3><p class="muted small">Not in the circuit, so no operating point. Add it in the Circuit CAD to see where it works.</p>`;
      if (d.kind === "pentode") {
        h += `<label class="row"><span>Screen voltage for curves</span><input type="number" id="vg2-preview" value="${S.vg2Preview}" min="10" max="${t.vg2Max || 600}" step="10"></label>`;
      }
    }
    h += `<h3>Ratings</h3>` + kv("Va max", t.vaMax + " V") + kv("Pa max", t.paMax + " W") + kv("Ik max", t.ikMax + " mA") + (t.vg2Max ? kv("Vg2 max", t.vg2Max + " V") : "") + kv("Heater", `${t.vh} V · ${t.ih} A`);
    const m = d.model;
    h += `<h3>Koren model (${d.kind})</h3>` + kv("µ", m.mu) + kv("kg1", m.kg) + kv("kp", m.kp) + kv("kvb", m.kvb) + kv("x", m.x) + (m.kg2 ? kv("kg2", m.kg2) : "");
    $("hud").innerHTML = h;
    const vin = $("vg2-preview");
    if (vin) vin.onchange = () => { const v = parseFloat(vin.value); if (v > 0) { S.vg2Preview = v; renderAll(); } };
  }

  // ---------------------------------------------------------------------------
  // Curve fitter (Nelder-Mead on measured points) and LTspice model export
  // ---------------------------------------------------------------------------
  function fitKoren(points, init, kind, vg2) {
    let p = [init.mu, init.kg, init.kp, init.kvb, init.x];
    const model = par => ({ mu: par[0], kg: par[1], kp: par[2], kvb: par[3], x: par[4] });
    const pred = (pt, par) => (kind === "pentode" ? Koren.pentodeIa(pt.va, pt.vg, pt.vg2 || vg2, model(par)) : Koren.triodeIa(pt.va, pt.vg, model(par))) * 1000;
    const f = par => { if (par[0] <= 0.5 || par[1] <= 1 || par[2] <= 1 || par[3] <= 0.1 || par[4] < 1 || par[4] > 2) return 1e30; let s = 0; for (const pt of points) { const e = pred(pt, par) - pt.iaMa; s += e * e; } return s; };
    let simplex = [p.slice()];
    const step = [p[0] * 0.1, p[1] * 0.1, p[2] * 0.1, p[3] * 0.1, 0.05];
    for (let i = 0; i < 5; i++) { const v = p.slice(); v[i] += step[i]; simplex.push(v); }
    for (let iter = 0; iter < 600; iter++) {
      simplex.sort((a, b) => f(a) - f(b));
      const best = simplex[0], worst = simplex[5];
      const cen = [0, 0, 0, 0, 0]; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) cen[j] += simplex[i][j] / 5;
      const refl = cen.map((c, j) => c + (c - worst[j]));
      if (f(refl) < f(best)) { const exp = cen.map((c, j) => c + 2 * (refl[j] - c)); simplex[5] = f(exp) < f(refl) ? exp : refl; }
      else if (f(refl) < f(simplex[4])) simplex[5] = refl;
      else { const con = cen.map((c, j) => c + 0.5 * (worst[j] - c)); if (f(con) < f(worst)) simplex[5] = con; else for (let i = 1; i <= 5; i++) simplex[i] = simplex[i].map((v, j) => best[j] + 0.5 * (v - best[j])); }
    }
    simplex.sort((a, b) => f(a) - f(b));
    const opt = simplex[0], params = model(opt);
    if (kind === "pentode") params.kg2 = init.kg2 || 1500;
    let ssRes = 0, ssTot = 0; const mean = points.reduce((s, q) => s + q.iaMa, 0) / points.length;
    points.forEach(pt => { const e = pt.iaMa - pred(pt, opt); ssRes += e * e; ssTot += (pt.iaMa - mean) ** 2; });
    return { params, r2: Math.max(0, 1 - ssRes / Math.max(ssTot, 1e-12)), rmse: Math.sqrt(ssRes / points.length) };
  }
  function subckt(name, kind, m, metrics) {
    const safe = name.replace(/[^A-Za-z0-9]/g, "_");
    const head = `* ${name} — Koren ${kind} model${metrics ? ` (fitted: R² ${metrics.r2.toFixed(4)}, RMSE ${metrics.rmse.toFixed(3)} mA)` : " (tube database)"}\n* Generated ${new Date().toISOString().slice(0, 10)} by the Vacuum Tube Curve Tracer\n`;
    if (kind === "pentode") return head + `.SUBCKT ${safe} A G1 G2 K
BP  A  K  I=pwr(max(V(G2,K)/${m.kp}*ln(1+exp(${m.kp}*(1/${m.mu}+V(G1,K)/max(V(G2,K),1e-3)))),0),${m.x})*${(2 / m.kg).toPrecision(6)}*atan(max(V(A,K),0)/${m.kvb})
BS  G2 K  I=pwr(max(V(G1,K)+V(G2,K)/${m.mu},0),${m.x})/${m.kg2 || 1500}
BG  G1 K  I=if(V(G1,K)>0,${(0.2 / m.kg).toPrecision(4)}*pwr(V(G1,K),1.5),0)
.ENDS ${safe}
`;
    return head + `.SUBCKT ${safe} A G K
BP  A  K  I=pwr(max(V(A,K)/${m.kp}*ln(1+exp(${m.kp}*(1/${m.mu}+V(G,K)/sqrt(${m.kvb}+V(A,K)*V(A,K))))),0),${m.x})*${(2 / m.kg).toPrecision(6)}
BG  G  K  I=if(V(G,K)>0,${(0.2 / m.kg).toPrecision(4)}*pwr(V(G,K),1.5),0)
.ENDS ${safe}
`;
  }
  function openModelModal() {
    const d = current();
    const m = S.fit && S.fit.tube === d.tube.commonName ? S.fit.params : d.model;
    $("model-text").value = subckt(d.tube.commonName, S.fit && S.fit.tube === d.tube.commonName ? S.fit.kind : d.kind, m, S.fit && S.fit.tube === d.tube.commonName ? S.fit : null);
    $("fit-status").textContent = S.fit ? `Fitted ${S.fit.tube}: R² = ${S.fit.r2.toFixed(4)} · RMSE = ${S.fit.rmse.toFixed(3)} mA · ${S.fit.points.length} points` : "Showing the database model. Upload measured points (CSV: Va, Vg, Ia_mA[, Vg2]) to fit your own tube.";
    $("model-modal").hidden = false;
  }
  function runFit(points) {
    const d = current();
    const r = fitKoren(points, d.model, d.kind, d.vg2 || 250);
    S.fit = Object.assign(r, { points, kind: d.kind, vg2: d.vg2 || 250, tube: d.tube.commonName });
    renderAll(); openModelModal();
  }
  function sampleData() {
    const d = current(), pts = [];
    const cutoff = d.kind === "pentode" ? -(d.vg2 || 250) / d.model.mu : -d.tube.vaMax / d.model.mu;
    const step = niceStep(Math.abs(cutoff) / 6);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let vg = 0; vg >= cutoff * 0.9; vg -= step)
      for (let va = d.tube.vaMax * 0.05; va <= d.tube.vaMax; va += d.tube.vaMax / 20) {
        const ia = iaOf(d, va, vg) * 1000;
        if (va * ia / 1000 > d.tube.paMax * 1.2) continue;
        pts.push({ va, vg, vg2: d.vg2 || 250, iaMa: Math.max(0, ia * (1 + (rnd() - 0.5) * 0.06)) });
      }
    return pts;
  }
  function parseCsv(text) {
    const pts = [];
    text.split(/\r?\n/).forEach(line => {
      const p = line.split(/[,;\t]/).map(s => parseFloat(s.trim()));
      if (p.length >= 3 && p.slice(0, 3).every(isFinite)) pts.push({ va: p[0], vg: p[1], iaMa: p[2], vg2: isFinite(p[3]) ? p[3] : undefined });
    });
    return pts;
  }
  function download(name, text, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: type || "text/plain" }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ---------------------------------------------------------------------------
  function renderAll() {
    const d = current();
    renderLink(); renderCircuitList(); renderLibrary(); drawPinout(d.tube); renderHud(); drawPlot();
  }

  function init() {
    $("tube-search").addEventListener("input", e => { S.query = e.target.value; renderLibrary(); });
    document.querySelectorAll(".chip").forEach(ch => ch.addEventListener("click", () => {
      S.filter = ch.dataset.f; document.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === ch)); renderLibrary();
    }));
    ["traj", "pa", "pa70", "bias"].forEach(k => { const el = $("opt-" + k); el.checked = S.opts[k]; el.addEventListener("change", () => { S.opts[k] = el.checked; drawPlot(); }); });
    $("plot").addEventListener("mousemove", onPlotMove);
    $("plot").addEventListener("mouseleave", () => { S.hover = null; $("plot-readout").textContent = ""; drawPlot(); });
    window.addEventListener("resize", drawPlot);
    $("btn-open-cad").addEventListener("click", () => window.open("circuit_sandbox.html", "tube_cad"));
    $("btn-model").addEventListener("click", openModelModal);
    $("btn-png").addEventListener("click", () => { const a = document.createElement("a"); a.href = $("plot").toDataURL("image/png"); a.download = current().tube.commonName + "-curves.png"; a.click(); });
    $("btn-modal-close").addEventListener("click", () => { $("model-modal").hidden = true; });
    $("btn-model-copy").addEventListener("click", () => { const t = $("model-text"); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand("copy"); } });
    $("btn-model-download").addEventListener("click", () => download(current().tube.commonName.replace(/[^A-Za-z0-9]/g, "_") + ".sub", $("model-text").value));
    $("btn-fit-sample").addEventListener("click", () => runFit(sampleData()));
    $("btn-fit-upload").addEventListener("click", () => $("csv-input").click());
    $("csv-input").addEventListener("change", e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { const pts = parseCsv(rd.result); if (pts.length < 6) { $("fit-status").textContent = "Need at least 6 rows of Va, Vg, Ia_mA."; return; } runFit(pts); };
      rd.readAsText(f); e.target.value = "";
    });
    $("btn-fit-clear").addEventListener("click", () => { S.fit = null; renderAll(); openModelModal(); });
    if (!S.view) S.view = { source: "library", name: "12AX7" };
    renderAll();
  }

  window.TubeTracer = { state: S, renderAll, fitKoren, current };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
