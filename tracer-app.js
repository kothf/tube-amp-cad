/* =============================================================================
   TUBE AND TRANSISTOR CURVE TRACER — viewer for the circuit CAD
   Plots the plate-curve family of a tube, or a transistor's output, transfer and gain
   curves, and, when the part is in the CAD circuit, its simulated operating point and
   dynamic load line (trajectory).
   Depends on: tube-db.js, sim-engine.js (TubeSimEngine.Koren), cad-components.js (fmtEng),
   board-core.js (transistor pin orders), semi-curves.js (transistor curves)
   ============================================================================= */
(function () {
  "use strict";
  const { fmtEng, tubeKind } = CadLib;
  const CHANNEL = "tube_cad_v2";

  const S = {
    circuit: null,               // last SIM_RESULT from the CAD
    lastSeen: 0,
    view: null,                  // { source: "circuit", id } | { source: "library", name } | { source: "library", semi: type, name }
    filter: "all", query: "",
    lib: "tubes",                // the library listed on the left: "tubes" | "semis"
    semiFilter: "all",
    semiMode: "output",          // a transistor's plot: "output" (IC–VCE), "transfer" (IC–VBE), "gain" (hFE–IC)
    trace: { n: 8, step: null, vMax: null, vFix: null, temp: 25 },   // transistor settings; null = automatic
    vg2Preview: 250,
    opts: { traj: true, pa: true, pa70: true, bias: true },
    fit: null,                   // { points, params, r2, rmse, kind }
    zoom: null,                  // visible part of the plot { v0, v1, i0, i1 } (V, A), null = all
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
      // imported SPICE tubes the CAD uses: known here too
      if (window.SpiceModel) [m.def].concat(m.customTubes || []).forEach(t => { if (t) try { SpiceModel.register(t); } catch (err) { /* a built-in of that name */ } });
      if (m.type === "SELECT_TUBE") {
        // tube selected in the CAD editor: show it, overriding a library pick
        const inCircuit = S.circuit && circuitParts(S.circuit).some(t => t.id === m.id);
        S.view = inCircuit ? { source: "circuit", id: m.id } : m.semi ? { source: "library", semi: m.semi, name: m.model, pendingId: m.id } : { source: "library", name: m.tube, pendingId: m.id };
        renderAll();
        return;
      }
      // the CAD is simulating: show it (with its readiness) until the result arrives
      if (m.type === "SIM_STATUS") { S.cadBusy = m.busy ? { text: m.text, progress: m.progress } : null; renderLink(); return; }
      if (m.type !== "SIM_RESULT") return;
      S.circuit = m; S.lastSeen = Date.now();
      const tubes = circuitParts(m);
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
  // the circuit's tubes and transistors, in that order
  function circuitParts(m) { return (m.tubes || []).concat(m.transistors || []); }

  function renderLink() {
    const el = $("link-status");
    const c = S.circuit;
    const busy = S.cadBusy, bar = busy && typeof busy.progress === "number";
    el.style.setProperty("--progress", bar ? (busy.progress * 100).toFixed(1) + "%" : "0%");
    if (busy) { el.className = "link idle" + (bar ? " progress" : ""); el.textContent = "CAD: " + busy.text; return; }
    if (!c) { el.className = "link idle"; el.innerHTML = `No circuit linked — <a href="circuit_sandbox.html" target="tube_cad">open the Circuit CAD ↗</a>`; return; }
    if (c.empty) { el.className = "link idle"; el.textContent = "CAD open · empty sheet"; return; }
    if (!c.ok) { el.className = "link bad"; el.textContent = "CAD: " + (c.error || "not simulated"); return; }
    const ago = Math.round((Date.now() - c.at) / 1000);
    el.className = "link ok";
    const nt = (c.transistors || []).length;
    el.textContent = `Linked to CAD · ${c.tubes.length} tube${c.tubes.length === 1 ? "" : "s"}${nt ? ` · ${nt} transistor${nt === 1 ? "" : "s"}` : ""} · simulated ${ago < 2 ? "just now" : ago + " s ago"}`;
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
      const cs = (S.circuit.transistors || []).find(t => t.id === S.view.id), sv = cs && semiView(cs.type, cs.model, cs.temp, cs);
      if (sv) return sv;
    }
    if (S.view && S.view.semi) { const sv = semiView(S.view.semi, S.view.name, S.trace.temp, null); if (sv) return sv; }
    const tube = tubeByName(S.view && S.view.name) || tubeByName("12AX7");
    const kind = tubeKind(tube) === "pentode" ? "pentode" : "triode";
    return { tube, kind, model: kind === "pentode" ? tube.koren.Pentode : tube.koren.Triode || tube.koren.Pentode, vg2: kind === "pentode" ? S.vg2Preview : null, circuit: null };
  }
  function iaOf(d, va, vg, model) {
    const m = model || d.model;
    return TubeSimEngine.Tube.ia(d.kind, m, va, vg, d.vg2);
  }

  // ---------------------------------------------------------------------------
  // Left column: circuit tubes + library
  // ---------------------------------------------------------------------------
  function renderCircuitList() {
    const host = $("circuit-tubes");
    const tubes = S.circuit && S.circuit.ok ? S.circuit.tubes : [], semis = S.circuit && S.circuit.ok ? S.circuit.transistors || [] : [];
    if (!tubes.length && !semis.length) {
      host.innerHTML = `<p class="muted small">${S.circuit && S.circuit.ok ? "The circuit has no amplifying tubes or transistors yet." : "Build a circuit in the <a href=\"circuit_sandbox.html\" target=\"tube_cad\">Circuit CAD ↗</a> — its tubes and transistors appear here with their simulated operating point."}</p>`;
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
    semis.forEach(t => {
      const b = document.createElement("button"), spec = CadLib.semiTable(t.type)[t.model] || {}, bip = !CadLib.isFet(t.type);
      const active = S.view && S.view.source === "circuit" && S.view.id === t.id, dc = t.dc;
      b.className = "list-item" + (active ? " active" : "");
      b.innerHTML = `<span><b>${t.label}</b> ${t.model}</span><em class="${dc.pd > spec.p ? "bad" : ""}">${fmtEng(bip ? dc.vce : dc.vds, "V", 1)} · ${fmtEng(bip ? dc.ic : dc.id, "A", 1)}</em>`;
      b.title = `${SEMI_KIND[t.type]}${spec.ge ? ", germanium" : ""}: ${spec.use || ""}`;
      b.onclick = () => { S.view = { source: "circuit", id: t.id }; renderAll(); };
      host.appendChild(b);
    });
  }
  function renderLibrary() {
    const host = $("tube-list");
    host.innerHTML = "";
    const semis = S.lib === "semis";
    document.querySelectorAll("#lib-tabs button").forEach(b => b.classList.toggle("active", b.dataset.lib === S.lib));
    $("lib-title").textContent = semis ? "Transistor library" : "Tube library";
    $("chips-tubes").hidden = semis; $("chips-semis").hidden = !semis;
    $("tube-search").placeholder = semis ? "Search 2N3904, AC128, IRF540, J201…" : "Search 6N2P, EL34, 300B…";
    if (semis) { renderSemiLibrary(host); return; }
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
    ctx.fillText(tube.socket.split(/[ ,(:]/)[0], cx, cy);
    if (/top cap/i.test(tube.socket)) { ctx.fillStyle = "#ff8a80"; ctx.fillText("A: top cap", cx, cy + 12); }
    const n = tube.pinCount, pins = tube.pinout || [], pr = radius * 0.68;
    for (let i = 1; i <= n; i++) {
      const pd = pins.find(p => p.pin === i) || { pin: i, sym: String(i) };
      let ang;
      if (n === 9) ang = [0, 108, 144, 180, 216, 252, 288, 324, 0, 36][i];
      else if (n === 8 || n === 7) ang = 112.5 + (i - 1) * 45;   // octal; B7G: 8 places, one left out at the gap
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
    $("socket-name").textContent = `${tube.socket} · bottom view`;
    $("socket-note").textContent = tube.heaterWarning || "";
    // where the data comes from: the handbook page with its rated point and limits
    const b = tube.book, src = $("socket-source");
    if (src) {
      if (b) {
        const L = b.limits || {}, lim = [L.va && `Ua ${L.va} V`, L.vg2 && `Ug2 ${L.vg2} V`, L.pa && `Pa ${L.pa} W`, L.pg2 && `Pg2 ${L.pg2} W`, (L.ik || L.ia) && `Ik ${L.ik || L.ia} mA`, L.vkh && `Uk-h ${L.vkh} V`, L.i_rect_ma && `rectified ${L.i_rect_ma} mA`, L.v_inverse && `inverse ${L.v_inverse} V`].filter(Boolean);
        src.textContent = `${b.name}: ${b.source}, p. ${b.page}` + (b.analogs ? ` · analogs ${b.analogs.join(", ")}` : "") + (lim.length ? ` · limits ${lim.join(", ")}` : "") + (pins.length ? "" : " · pinout not entered");
      } else src.textContent = "Not in Katsnelson & Larionov 1981: maker's datasheet.";
    }
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
  // the plot geometry as shown now: redraw first if the canvas changed size since the
  // last draw (a layout shift that the resize observer has not handled yet)
  function geom() {
    const cv = $("plot");
    if (!plotGeom || plotGeom.W !== cv.clientWidth || plotGeom.H !== cv.clientHeight) drawPlot();
    return plotGeom;
  }
  function drawPlot() {
    const cv = $("plot"), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0b1119"; ctx.fillRect(0, 0, W, H);
    const d = current();
    if (d.semi) { drawSemi(ctx, W, H, d); return; }
    const t = d.tube, ct = d.circuit;
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
    // the visible window: all of it, or the zoomed part (kept inside the full range)
    const z = clampZoom(S.zoom, vaMax, iaMax); S.zoom = z;
    const v0 = z ? z.v0 : 0, v1 = z ? z.v1 : vaMax, i0 = z ? z.i0 : 0, i1 = z ? z.i1 : iaMax;
    const X = va => padL + (va - v0) / (v1 - v0) * pw, Y = ia => padT + ph - (ia - i0) / (i1 - i0) * ph;
    const vaAt = px => v0 + px / pw * (v1 - v0), iaCap = i1 + (i1 - i0);
    plotGeom = { padL, padT, pw, ph, vaMax, iaMax, v0, v1, i0, i1, X, Y, W, H };
    $("btn-zoom-reset").style.visibility = z ? "visible" : "hidden";   // keeps its place: the plot must not move

    // grid + labels
    ctx.font = "11px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle";
    const vStep = niceStep((v1 - v0) / 10), iStep = niceStep((i1 - i0) / 8);
    ctx.strokeStyle = "rgba(60,80,110,0.35)"; ctx.lineWidth = 1; ctx.fillStyle = "#6a82a0";
    for (let v = Math.ceil(v0 / vStep - 1e-9) * vStep; v <= v1 + 1e-9; v += vStep) { ctx.beginPath(); ctx.moveTo(X(v), padT); ctx.lineTo(X(v), padT + ph); ctx.stroke(); ctx.textAlign = "center"; ctx.fillText(String(+v.toFixed(3)), X(v), padT + ph + 14); }
    for (let i = Math.ceil(i0 / iStep - 1e-9) * iStep; i <= i1 + 1e-12; i += iStep) { ctx.beginPath(); ctx.moveTo(padL, Y(i)); ctx.lineTo(padL + pw, Y(i)); ctx.stroke(); ctx.textAlign = "right"; ctx.fillText(String(+(i * 1000).toFixed(3)), padL - 8, Y(i)); }
    ctx.fillStyle = "#8fa6c2"; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Plate voltage Va (V)", padL + pw / 2, H - 10);
    ctx.save(); ctx.translate(16, padT + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText("Plate current Ia (mA)", 0, 0); ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();

    // Pa max hyperbola + zone
    if (S.opts.pa) {
      ctx.beginPath();
      let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(vaAt(px), 1); const ia = t.paMax / va; const y = Y(Math.min(ia, iaCap)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.lineTo(padL + pw, padT); ctx.lineTo(padL, padT); ctx.closePath();
      ctx.fillStyle = "rgba(255,51,68,0.07)"; ctx.fill();
      ctx.beginPath(); first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(vaAt(px), 1); const y = Y(Math.min(t.paMax / va, iaCap)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "#ff3344"; ctx.lineWidth = 1.8; ctx.stroke();
    }
    if (S.opts.pa70) {
      ctx.beginPath(); let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = Math.max(vaAt(px), 1); const y = Y(Math.min(0.7 * t.paMax / va, iaCap)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "rgba(255,179,0,0.7)"; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    }

    // curve family
    const cutoff = d.kind === "pentode" ? -(d.vg2 || 250) / d.model.mu : -vaMax / d.model.mu;
    const gStep = niceStep(Math.abs(cutoff) / 8);
    const labels = [];
    for (let vg = 0, k = 0; vg >= cutoff * 1.05 && k < 16; vg -= gStep, k++) {
      ctx.beginPath(); let first = true, lastY = null;
      for (let px = 0; px <= pw; px += 2) {
        const va = vaAt(px), ia = iaOf(d, va, vg);
        const y = Y(Math.max(i0 - (i1 - i0), Math.min(ia, iaCap))); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; lastY = y;
      }
      ctx.strokeStyle = "rgba(41,182,246,0.85)"; ctx.lineWidth = 1.3; ctx.stroke();
      if (lastY > padT + 8 && lastY < padT + ph - 4) labels.push([vg, lastY]);
    }
    // bias curve (DC grid voltage of the circuit tube)
    if (ct && S.opts.bias) {
      const vg = ct.dc.vgk;
      ctx.beginPath(); let first = true;
      for (let px = 0; px <= pw; px += 2) { const va = vaAt(px); const y = Y(Math.min(iaOf(d, va, vg), iaCap)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
      ctx.strokeStyle = "#3fb950"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
    }
    // fitted model + measured points
    if (S.fit) {
      const fd = { kind: S.fit.kind, vg2: S.fit.vg2 || 250, model: S.fit.params };
      const vgs = [...new Set(S.fit.points.map(p => p.vg))];
      vgs.forEach(vg => {
        ctx.beginPath(); let first = true;
        for (let px = 0; px <= pw; px += 3) { const va = vaAt(px); const y = Y(Math.min(iaOf(fd, va, vg), iaCap)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
        ctx.strokeStyle = "rgba(186,104,200,0.9)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
      });
      ctx.fillStyle = "#b9f6ca";
      S.fit.points.forEach(p => { ctx.beginPath(); ctx.arc(X(p.va), Y(p.iaMa / 1000), 2.2, 0, Math.PI * 2); ctx.fill(); });
    }
    // dynamic load line (trajectory)
    if (traj && traj.vak && traj.vak.length > 1) {
      ctx.beginPath();
      traj.vak.forEach((v, i) => { const x = X(v), y = Y(traj.ia[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.stroke();
      // direction arrows at three points of the cycle
      const n = traj.vak.length;
      ctx.fillStyle = "#ffd54f";
      [0.12, 0.45, 0.78].forEach(fr => {
        const i0 = Math.floor(n * fr), i1 = Math.min(n - 1, i0 + 4);
        const ax = X(traj.vak[i1]), ay = Y(traj.ia[i1]), ang = Math.atan2(ay - Y(traj.ia[i0]), ax - X(traj.vak[i0]));
        if (Math.hypot(ax - X(traj.vak[i0]), ay - Y(traj.ia[i0])) < 0.5) return;
        ctx.beginPath(); ctx.moveTo(ax, ay);
        ctx.lineTo(ax - 9 * Math.cos(ang - 0.42), ay - 9 * Math.sin(ang - 0.42)); ctx.lineTo(ax - 9 * Math.cos(ang + 0.42), ay - 9 * Math.sin(ang + 0.42)); ctx.closePath(); ctx.fill();
      });
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
      if (va >= v0 && va <= v1 && ia >= i0 && ia <= i1) {
        ctx.strokeStyle = "rgba(230,237,243,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X(va), padT); ctx.lineTo(X(va), padT + ph); ctx.moveTo(padL, Y(ia)); ctx.lineTo(padL + pw, Y(ia)); ctx.stroke();
        const r = describePoint(S.hover);
        MarkerPicker.label(ctx, X(va), Y(ia) > padT + ph / 2 ? padT + 4 : padT + ph - 80, padL, padL + pw, [
          [`Va ${va.toFixed(1)} V  Ia ${(ia * 1000).toFixed(2)} mA`, "#e6edf3"],
          [`Vg ${r.vg === null ? "—" : r.vg.toFixed(2) + " V"}${S.hover.on ? `  (${S.hover.on})` : ""}`, "#29b6f6"],
          [`Pa ${r.pa.toFixed(2)} W (${Math.round(r.paPct)}% of max)`, r.paPct > 100 ? "#ff7b72" : "#8fa6c2"],
          ...(r.gm !== undefined ? [[`gm ${(r.gm * 1000).toFixed(2)} mA/V  rp ${isFinite(r.rp) ? fmtEng(r.rp, "Ω", 2) : "∞"}  µ ${r.mu.toFixed(1)}`, "#8fa6c2"]] : [])
        ]);
      }
    }
    // picked points A, B and the load line through them
    const pts = pick ? pick.list.map(pointOf) : [];
    if (pts.length === 2 && pts[0] && pts[1] && Math.abs(pts[1].va - pts[0].va) > 1e-9) {
      const k = (pts[1].ia - pts[0].ia) / (pts[1].va - pts[0].va), iaAt = va => pts[0].ia + k * (va - pts[0].va);
      ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();
      ctx.beginPath(); ctx.moveTo(X(v0), Y(iaAt(v0))); ctx.lineTo(X(v1), Y(iaAt(v1)));
      ctx.strokeStyle = "rgba(255,138,216,0.8)"; ctx.setLineDash([7, 4]); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    pts.forEach((p, i) => { if (p) MarkerPicker.draw(ctx, X(p.va), Y(p.ia), MarkerPicker.LETTERS[i], "#ff8ad8"); });
    // title
    $("plot-title").textContent = `${t.commonName} · ${d.kind === "pentode" ? `pentode, Vg2 = ${fmtEng(d.vg2, "V", 0)}` : (tubeKind(t) === "pentode" ? "triode-connected" : "triode")}` + (ct ? ` · ${ct.label} in circuit` : " · library preview");
    // legend
    // legend: one entry for everything drawn, with a swatch in the same style
    const item = (cls, c, text, tip) => `<span title="${tip}"><i class="${cls}" style="--c:${c}"></i>${text}</span>`;
    $("legend").innerHTML = [
      item("", "#29b6f6", `Plate curves, Vg step ${+gStep.toFixed(2)} V`, "Anode current against anode voltage at fixed grid voltages; each curve's grid voltage is at its right end"),
      ct && S.opts.bias ? item("dash", "#3fb950", `Curve at circuit bias ${fmtEng(ct.dc.vgk, "V", 2)}`, "The plate curve at the grid voltage the circuit actually sets") : "",
      traj ? item("", "#ffd54f", "Simulated load line, one cycle (arrows: direction)", "The path of the operating point through the last cycle of the signal; its slope is the load the tube sees, an ellipse when the load is reactive") : "",
      ct ? item("ring", "#00e5ff", "Operating point Q", "Anode voltage and current with no signal (DC bias)") : "",
      S.opts.pa ? item("", "#ff3344", `Pa max ${t.paMax} W`, "Maximum anode dissipation: Va × Ia = Pa max") : "",
      S.opts.pa ? item("area", "#ff3344", "Over Pa max", "Above the curve the anode dissipates more than its rating") : "",
      S.opts.pa70 ? item("dash", "#ffb300", `70% of Pa max (${+(0.7 * t.paMax).toFixed(1)} W)`, "A comfortable limit for long tube life") : "",
      S.fit ? item("dash", "#ba68c8", "Fitted model", "Model curves fitted to the measured points") : "",
      S.fit ? item("dot", "#b9f6ca", "Measured points", "The points the model was fitted to") : "",
      pts.some(Boolean) ? item("ring", "#ff8ad8", "Picked points A, B", "Click the plot to pick; values are shown below the plot") : "",
      pts.length === 2 && pts[0] && pts[1] ? item("dash", "#ff8ad8", "Line through A and B", "Its slope gives the load resistance; the value is shown below the plot") : ""
    ].join("");
  }

  // ---------------------------------------------------------------------------
  // Picking points: A and B, snapped to the operating point or the load line
  // ---------------------------------------------------------------------------
  const SNAP = 10;                 // px
  /** Grid voltage that puts the tube at (va, ia): the model solved for Vg. */
  function vgFor(d, va, ia) {
    if (va <= 0 || ia <= 0) return null;
    let lo = -Math.max(va, d.vg2 || 0) / d.model.mu * 4 - 20, hi = 50;
    if (iaOf(d, va, hi) < ia) return null;
    for (let n = 0; n < 80; n++) { const m = (lo + hi) / 2; if (iaOf(d, va, m) < ia) lo = m; else hi = m; }
    return (lo + hi) / 2;
  }
  /** Small-signal parameters at a point of the curves. */
  function smallSignal(d, va, vg) {
    const hv = Math.max(0.5, va * 0.005), hg = 0.01;
    const gm = (iaOf(d, va, vg + hg) - iaOf(d, va, vg - hg)) / (2 * hg);
    const ga = (iaOf(d, va + hv, vg) - iaOf(d, Math.max(0, va - hv), vg)) / (va + hv - Math.max(0, va - hv));
    const rp = ga > 1e-12 ? 1 / ga : Infinity;
    return { gm, rp, mu: gm * rp };
  }
  /** Where a marker is now (it follows the simulation for Q / load-line picks). */
  function pointOf(m) {
    if (current().semi) return pointOfSemi(m);
    const ct = current().circuit;
    if (m.q) return ct ? { va: ct.dc.vak, ia: ct.dc.ia, vg: ct.dc.vgk, on: "operating point" } : null;
    if (m.traj !== undefined) {
      const tr = ct && ct.traj; if (!tr || m.traj >= tr.vak.length) return null;
      return { va: tr.vak[m.traj], ia: tr.ia[m.traj], vg: tr.vgk ? tr.vgk[m.traj] : null, on: "load line" };
    }
    return { va: m.va, ia: m.ia, vg: null, on: null };
  }
  function snapPoint(x, y) {
    if (current().semi) return snapSemi(x, y);
    const g = geom(); if (!g) return null;
    if (x < g.padL - 6 || x > g.padL + g.pw + 6 || y < g.padT - 6 || y > g.padT + g.ph + 6) return null;
    const ct = current().circuit;
    if (ct && Math.hypot(g.X(ct.dc.vak) - x, g.Y(ct.dc.ia) - y) <= SNAP) return { q: true };
    const tr = ct && ct.traj && S.opts.traj ? ct.traj : null;
    if (tr && tr.vak) {
      let best = -1, bd = SNAP;
      for (let k = 0; k < tr.vak.length; k++) { const dd = Math.hypot(g.X(tr.vak[k]) - x, g.Y(tr.ia[k]) - y); if (dd < bd) { bd = dd; best = k; } }
      if (best >= 0) return { traj: best };
    }
    const va = Math.max(g.v0, Math.min(g.v1, g.v0 + (x - g.padL) / g.pw * (g.v1 - g.v0))), ia = Math.max(g.i0, Math.min(g.i1, g.i0 + (g.padT + g.ph - y) / g.ph * (g.i1 - g.i0)));
    return { va, ia };
  }
  /** Everything worth knowing about a point on the curves. */
  function describePoint(p) {
    const d = current();
    const vg = p.vg !== null && p.vg !== undefined ? p.vg : vgFor(d, p.va, p.ia);
    const out = { va: p.va, ia: p.ia, pa: p.va * p.ia, paPct: p.va * p.ia / d.tube.paMax * 100, vg, on: p.on };
    if (vg !== null && p.ia > 0) Object.assign(out, smallSignal(d, p.va, vg));
    return out;
  }
  const fmtPoint = r => `Va ${r.va.toFixed(1)} V · Ia ${(r.ia * 1000).toFixed(2)} mA · Vg ${r.vg === null ? "—" : r.vg.toFixed(2) + " V"} · Pa ${r.pa.toFixed(2)} W (${Math.round(r.paPct)}%)`;
  const fmtSmall = r => r.gm !== undefined ? ` · gm ${(r.gm * 1000).toFixed(2)} mA/V · rp ${isFinite(r.rp) ? fmtEng(r.rp, "Ω", 2) : "∞"} · µ ${r.mu.toFixed(1)}` : "";
  function renderPicks() {
    if (!pick) return;
    if (current().semi) { renderSemiPicks(current()); return; }
    const rs = pick.list.map(pointOf).map(p => p && describePoint(p));
    let h = "";
    rs.forEach((r, i) => { if (r) h += `<span><b>${MarkerPicker.LETTERS[i]}</b>${r.on ? ` (${r.on})` : ""}: ${fmtPoint(r)}${fmtSmall(r)}</span>`; });
    if (rs.length === 2 && rs[0] && rs[1]) {
      const dVa = rs[1].va - rs[0].va, dIa = rs[1].ia - rs[0].ia;
      let line = `<span><b>A→B</b>: ΔVa ${dVa.toFixed(1)} V · ΔIa ${(dIa * 1000).toFixed(2)} mA`;
      if (Math.abs(dIa) > 1e-12 && Math.abs(dVa) > 1e-9 && dVa * dIa < 0) {
        const R = -dVa / dIa, va0 = rs[0].va + rs[0].ia * R;
        line += ` · load line <b>${fmtEng(R, "Ω", 2)}</b> (Va ${va0.toFixed(0)} V at Ia = 0, ${fmtEng(va0 / R, "A", 2)} at Va = 0)`;
      } else if (Math.abs(dIa) > 1e-12) line += ` · slope ${fmtEng(dVa / dIa, "Ω", 2)}`;
      h += line + "</span>";
    }
    if (!h) h = `<span class="hint">Click the plot to pick point A, then B: Vg, gm, rp and µ there, and the load line through both. Points snap to the operating point and the simulated load line. Drag to move, double-click to remove.</span>`;
    else h += `<button class="btn" id="picks-clear" title="Remove the points (Esc)">Clear points</button>`;
    $("picks").innerHTML = h;
    const b = $("picks-clear"); if (b) b.onclick = () => pick.clear();
  }
  // ---------------------------------------------------------------------------
  // Zoom: mouse wheel at the pointer, Ctrl+wheel for the current axis only,
  // right-drag or Shift+drag to pan; never beyond the full plot
  // ---------------------------------------------------------------------------
  function clampZoom(z, vaMax, iaMax) {
    if (!z) return null;
    const fit = (a, b, full) => {
      let w = Math.min(b - a, full); a = Math.max(0, Math.min(full - w, a));
      return [a, a + w];
    };
    const [v0, v1] = fit(z.v0, z.v1, vaMax), [i0, i1] = fit(z.i0, z.i1, iaMax);
    return v1 - v0 >= vaMax * 0.999 && i1 - i0 >= iaMax * 0.999 ? null : { v0, v1, i0, i1 };
  }
  function initZoom() {
    const cv = $("plot");
    const view = () => { const g = geom(); return { g, z: { v0: g.v0, v1: g.v1, i0: g.i0, i1: g.i1 } }; };
    PlotZoom(cv, {
      inside: (x, y) => { const g = geom(); return g && x >= g.padL && x <= g.padL + g.pw && y >= g.padT && y <= g.padT + g.ph; },
      zoom: (x, y, k, vertical) => {
        const { g, z } = view();
        const va = g.v0 + (x - g.padL) / g.pw * (g.v1 - g.v0), ia = g.i0 + (g.padT + g.ph - y) / g.ph * (g.i1 - g.i0);
        const kv = vertical ? 1 : Math.max(k, g.vaMax / 1000 / (g.v1 - g.v0)), ki = Math.max(k, g.iaMax / 1000 / (g.i1 - g.i0));
        S.zoom = { v0: va - (va - z.v0) * kv, v1: va + (z.v1 - va) * kv, i0: ia - (ia - z.i0) * ki, i1: ia + (z.i1 - ia) * ki };
        drawPlot();
      },
      pan: (dx, dy) => {
        const { g, z } = view(), dv = -dx / g.pw * (g.v1 - g.v0), di = dy / g.ph * (g.i1 - g.i0);
        S.zoom = { v0: z.v0 + dv, v1: z.v1 + dv, i0: z.i0 + di, i1: z.i1 + di };
        drawPlot();
      }
    });
    $("btn-zoom-reset").addEventListener("click", () => { S.zoom = null; drawPlot(); });
    PlotZoom.hint(cv, [
      ["Wheel", "zoom in / out at the pointer"],
      ["Ctrl + wheel", "zoom the current axis only"],
      ["Right-drag", "move the view (or Shift + drag)"],
      ["Reset zoom", "button above the plot: the whole plot"],
      ["Click", "pick point A, then B"]]);
  }

  let pick = null;
  function initPicker() {
    pick = MarkerPicker($("plot"), {
      snap: snapPoint,
      pos: m => { const p = pointOf(m), g = geom(); return p && g ? { x: g.X(p.va), y: g.Y(p.ia) } : null; },
      hover: m => {
        const p = m && pointOf(m);
        S.hover = p || null;
        drawPlot();
      },
      change: () => { drawPlot(); renderPicks(); }
    });
  }
  // a different tube (or a library pick) starts without points
  let pickKey = null;
  // (a transistor's steps and ranges are its own too; another plot of it starts without points)
  let partKey = null;
  function syncPickKey() {
    const v = S.view || {}, part = v.source === "circuit" ? "c:" + v.id : "l:" + (v.semi || "") + ":" + v.name, key = part + ":" + S.semiMode;
    if (part !== partKey) { partKey = part; Object.assign(S.trace, { step: null, vMax: null, vFix: null }); }
    if (key !== pickKey) { pickKey = key; S.zoom = null; if (pick) pick.reset(); }
  }

  // ---------------------------------------------------------------------------
  // Transistors: output, transfer and gain curves from the simulator's own models
  // (semi-curves.js), in the part's own polarity: a PNP's −VCE and −IC, a P-channel
  // FET's −VDS, −ID and −VGS are drawn as positive numbers, as datasheets do
  // ---------------------------------------------------------------------------
  const SC = window.SemiCurves;
  const SEMI_KIND = { npn: "NPN", pnp: "PNP", nmos: "N-channel MOSFET", pmos: "P-channel MOSFET", njf: "N-channel JFET", pjf: "P-channel JFET" };
  // the library's groups, as the CAD's palette sorts them: type, heading, which catalog entries
  const SEMI_GROUPS = [["npn", "NPN, silicon", m => !m.ge], ["npn", "NPN, germanium", m => m.ge], ["pnp", "PNP, silicon", m => !m.ge], ["pnp", "PNP, germanium", m => m.ge],
    ["nmos", "N-channel MOSFET"], ["pmos", "P-channel MOSFET"], ["njf", "N-channel JFET"], ["pjf", "P-channel JFET"]];
  const polOf = t => (/^(npn|nmos|njf)$/.test(t) ? 1 : -1);
  const devCache = new Map();
  /** What is displayed for a transistor: its type, catalog entry and the engine's model (BJTs at temp °C). */
  function semiView(type, name, temp, ct) {
    if (!SC || !CadLib.semiTable(type)[name]) return null;
    const t = CadLib.isFet(type) ? null : (isFinite(temp) && temp !== null ? +temp : 25), key = type + ":" + name + ":" + t;
    if (!devCache.has(key)) devCache.set(key, SC.device(type, name, t));
    const dev = devCache.get(key);
    return dev ? { semi: true, type, name, dev, spec: dev.spec, circuit: ct || null } : null;
  }
  // the quantities' names: a P-type part's with a minus, as on its datasheet
  function semiNames(d) {
    const n = d.dev.pol < 0 ? "−" : "", b = d.dev.bip;
    return { v: n + (b ? "VCE" : "VDS"), i: n + (b ? "IC" : "ID"), c: n + (b ? "IB" : "VGS"), vc: n + (b ? "VBE" : "VGS") };
  }
  const ctlText = (d, c) => (c === null || c === undefined ? "—" : d.dev.bip ? fmtEng(c, "A", 3) : `${c.toFixed(Math.abs(c) < 10 ? 3 : 2)} V`);
  const ampScale = m => (m < 1e-3 ? [1e6, "µA"] : m < 1 ? [1e3, "mA"] : [1, "A"]);
  const siemensScale = m => (m < 1 ? [1e3, "mS"] : [1, "S"]);
  const maxOf = a => { let m = -Infinity; for (const x of a) if (x > m) m = x; return m; };
  /** The operating point in the circuit: output voltage v, current i, control c (IB or VGS), vc (VBE or VGS). */
  function semiQ(d) {
    const c = d.circuit; if (!c) return null;
    const dc = c.dc;
    return d.dev.bip ? { v: dc.vce, i: dc.ic, c: dc.ib, vc: dc.vbe, pd: dc.pd } : { v: dc.vds, i: dc.id, c: dc.vgs, vc: dc.vgs, pd: dc.pd };
  }
  // linear interpolation of column col at x in a curve sorted by its first column (null outside it)
  function interp(curve, x, col) {
    if (!curve || curve.length < 2 || x < curve[0][0] || x > curve[curve.length - 1][0]) return null;
    let lo = 0, hi = curve.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (curve[m][0] <= x) lo = m; else hi = m; }
    const a = curve[lo], b = curve[hi], t = b[0] > a[0] ? (x - a[0]) / (b[0] - a[0]) : 0;
    return a[col] + t * (b[col] - a[col]);
  }
  function semiSlope(curve, x, col) {
    const h = curve ? (curve[curve.length - 1][0] - curve[0][0]) / 400 : 0, a = interp(curve, x - h, col), b = interp(curve, x + h, col);
    return a !== null && b !== null && h > 0 ? (b - a) / (2 * h) : null;
  }
  const semiHot = d => semiView(d.type, d.name, (d.dev.temp === null ? 25 : d.dev.temp) + 25, null);

  /** The curves of the plot shown now, recomputed only when the part or a setting changes. */
  let semiCache = null;
  function semiPlot(d) {
    const dev = d.dev, mode = S.semiMode, T = S.trace, q = semiQ(d), tr = d.circuit && S.opts.traj ? d.circuit.traj : null;
    const key = [d.type, d.name, dev.temp, mode, T.n, T.step, T.vMax, T.vFix, q && q.v, q && q.i, q && q.c, tr && tr.v.length && maxOf(tr.v), tr && maxOf(tr.i)].join("|");
    if (semiCache && semiCache.key === key && semiCache.dev === dev) return semiCache;
    const rng = SC.autoRange(dev, q ? { v: q.v, i: q.i, vMax: tr ? maxOf(tr.v) : 0, iMax: tr ? maxOf(tr.i) : 0 } : null);
    const vMax = T.vMax > 0 ? T.vMax : rng.vMax;
    const st = SC.steps(dev, vMax, rng.iTop, T.n, T.step > 0 ? T.step : 0);
    const vFix = T.vFix > 0 ? T.vFix : q && q.v > 0.05 ? q.v : Math.min(dev.bip ? 5 : 10, vMax / 2);
    const out = { key, dev, mode, rng, vMax, st, vFix, q, vis: null, bias: null };
    if (mode === "output") {
      out.curves = st.values.map(c => ({ c, pts: SC.outputCurve(dev, c, SC.samples(0, vMax)) }));
      let top = 0;
      out.curves.forEach(k => k.pts.forEach(p => { top = Math.max(top, p[1]); }));
      if (q) top = Math.max(top, q.i * 1.6);
      if (tr) top = Math.max(top, maxOf(tr.i) * 1.1);
      out.x0 = 0; out.x1 = vMax; out.y1 = SC.niceCeil(Math.max(top * 1.05, 1e-9));
    } else if (mode === "transfer") {
      const iTop = Math.max(rng.iTop, q ? q.i * 1.6 : 0, tr ? maxOf(tr.i) * 1.1 : 0);
      out.curve = SC.transferCurve(dev, vFix, iTop);
      if (dev.bip) { const h = semiHot(d); out.hot = h ? SC.transferCurve(h.dev, vFix, iTop) : null; out.hotT = h ? h.dev.temp : null; }
      const top = maxOf(out.curve.map(p => p[1])), first = out.curve.find(p => p[1] >= top / 300) || out.curve[0];
      let lo = first[0], hi = out.curve[out.curve.length - 1][0];
      if (q) { lo = Math.min(lo, q.vc - 0.02); hi = Math.max(hi, q.vc + 0.02); }
      if (tr) { lo = Math.min(lo, Math.min(...tr.c)); hi = Math.max(hi, maxOf(tr.c)); }
      const g = SC.niceStep((hi - lo) / 8);
      out.x0 = Math.floor(lo / g) * g; out.x1 = Math.ceil(hi / g - 1e-9) * g;
      out.y1 = SC.niceCeil(Math.max(top, q ? q.i * 1.3 : 0) * 1.05);
    } else {
      const iMax = dev.jfet ? dev.idss : dev.bip ? Math.max(rng.iTop * 3, dev.spec.i * 1.5) : Math.max(rng.iTop, dev.spec.i);
      out.curve = SC.gainCurve(dev, vFix, iMax);
      const a = out.curve[0][0], b = out.curve[out.curve.length - 1][0];
      out.x0 = Math.floor(Math.log10(a) + 1e-9); out.x1 = Math.ceil(Math.log10(b) - 1e-9);
      if (out.x1 - out.x0 < 1) out.x1 = out.x0 + 1;
      let top = 0;
      out.curve.forEach(p => { top = Math.max(top, p[1], dev.bip ? p[2] : 0); });
      out.y1 = SC.niceCeil(top * 1.08);
    }
    semiCache = out;
    return out;
  }
  // the zoomed window, kept inside the plot's full range
  function clampRange(z, x0, x1, y0, y1) {
    if (!z) return null;
    const fit = (a, b, lo, hi) => { const w = Math.min(b - a, hi - lo); a = Math.max(lo, Math.min(hi - w, a)); return [a, a + w]; };
    const [v0, v1] = fit(z.v0, z.v1, x0, x1), [i0, i1] = fit(z.i0, z.i1, y0, y1);
    return v1 - v0 >= (x1 - x0) * 0.999 && i1 - i0 >= (y1 - y0) * 0.999 ? null : { v0, v1, i0, i1 };
  }
  /** Where the operating point sits on the plot shown now: { va, ia } in its axes. */
  function semiQPoint(d, pd) {
    const q = pd.q; if (!q) return null;
    if (pd.mode === "output") return { va: q.v, ia: q.i, c: q.c, on: "operating point" };
    if (pd.mode === "transfer") return { va: q.vc, ia: q.i, on: "operating point" };
    if (d.dev.bip) return q.c > 0 && q.i > 0 ? { va: q.i, ia: q.i / q.c, on: "operating point" } : null;
    return q.i > 0 ? { va: q.i, ia: SC.smallSignal(d.dev, q.v, q.c).gm, on: "operating point" } : null;
  }
  // a polyline through data points, its current kept within a plot height of the window
  function strokeCurve(ctx, pts, X, Y, i0, i1, xi, yi) {
    ctx.beginPath();
    let first = true;
    const lo = i0 - (i1 - i0), hi = i1 + (i1 - i0);
    for (const p of pts) {
      const x = X(p[xi || 0]), y = Y(Math.max(lo, Math.min(hi, p[yi || 1])));
      if (!isFinite(x) || !isFinite(y)) continue;
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y); first = false;
    }
  }

  function drawSemi(ctx, W, H, d) {
    const pd = semiPlot(d), dev = d.dev, spec = d.spec, mode = pd.mode, nm = semiNames(d), ct = d.circuit;
    const log = mode === "gain", tr = ct && S.opts.traj && mode !== "gain" ? ct.traj : null;
    const padL = 62, padR = 76, padT = 18, padB = 44, pw = W - padL - padR, ph = H - padT - padB;
    const z = clampRange(S.zoom, pd.x0, pd.x1, 0, pd.y1); S.zoom = z;
    const v0 = z ? z.v0 : pd.x0, v1 = z ? z.v1 : pd.x1, i0 = z ? z.i0 : 0, i1 = z ? z.i1 : pd.y1;
    const ax = v => (log ? Math.log10(Math.max(v, 1e-30)) : v);
    const X = v => padL + (ax(v) - v0) / (v1 - v0) * pw, Y = i => padT + ph - (i - i0) / (i1 - i0) * ph;
    const vAt = px => { const t = v0 + px / pw * (v1 - v0); return log ? Math.pow(10, t) : t; }, iAt = py => i0 + (padT + ph - py) / ph * (i1 - i0);
    plotGeom = { padL, padT, pw, ph, vaMax: pd.x1 - pd.x0, iaMax: pd.y1, v0, v1, i0, i1, X, Y, W, H, vAt, iAt, log, semi: true };
    $("btn-zoom-reset").style.visibility = z ? "visible" : "hidden";
    const [ik, iu] = mode === "gain" ? (dev.bip ? [1, ""] : siemensScale(i1)) : ampScale(i1);

    // grid + labels
    ctx.font = "11px ui-monospace, Menlo, monospace"; ctx.textBaseline = "middle"; ctx.lineWidth = 1;
    const vline = (x, strong) => { ctx.strokeStyle = strong ? "rgba(60,80,110,0.35)" : "rgba(60,80,110,0.16)"; ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.stroke(); };
    ctx.fillStyle = "#6a82a0"; ctx.textAlign = "center";
    if (log) {
      for (let e = Math.floor(v0); e <= Math.ceil(v1); e++) for (let k = 1; k < 10; k++) {
        const lv = e + Math.log10(k); if (lv < v0 - 1e-9 || lv > v1 + 1e-9) continue;
        const x = padL + (lv - v0) / (v1 - v0) * pw;
        vline(x, k === 1);
        if (k === 1 || (v1 - v0 < 2.2 && (k === 2 || k === 5))) ctx.fillText(fmtEng(Math.pow(10, lv), "A", 0), x, padT + ph + 14);
      }
    } else {
      const vStep = niceStep((v1 - v0) / 10);
      for (let v = Math.ceil(v0 / vStep - 1e-9) * vStep; v <= v1 + 1e-9; v += vStep) { vline(X(v), true); ctx.fillText(String(+v.toFixed(4)), X(v), padT + ph + 14); }
    }
    const iStep = niceStep((i1 - i0) / 8);
    ctx.strokeStyle = "rgba(60,80,110,0.35)"; ctx.textAlign = "right";
    for (let i = Math.ceil(i0 / iStep - 1e-9) * iStep; i <= i1 + 1e-15; i += iStep) { ctx.beginPath(); ctx.moveTo(padL, Y(i)); ctx.lineTo(padL + pw, Y(i)); ctx.stroke(); ctx.fillText(String(+(i * ik).toFixed(4)), padL - 8, Y(i)); }
    ctx.fillStyle = "#8fa6c2"; ctx.font = "12px system-ui, sans-serif"; ctx.textAlign = "center";
    const xTitle = mode === "output" ? `${dev.bip ? "Collector" : "Drain"} voltage ${nm.v} (V)` : mode === "transfer" ? `${dev.bip ? "Base" : "Gate"} voltage ${nm.vc} (V)` : `${dev.bip ? "Collector" : "Drain"} current ${nm.i} (log)`;
    const yTitle = mode === "gain" ? (dev.bip ? "Current gain hFE" : `Transconductance gm (${iu})`) : `${dev.bip ? "Collector" : "Drain"} current ${nm.i} (${iu})`;
    ctx.fillText(xTitle, padL + pw / 2, H - 10);
    ctx.save(); ctx.translate(16, padT + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yTitle, 0, 0); ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();
    const labels = [], lim = i1 + (i1 - i0), legend = [];
    const item = (cls, c, text, tip) => legend.push(`<span title="${tip}"><i class="${cls}" style="--c:${c}"></i>${text}</span>`);
    if (mode === "output") {
      // power: Ptot hyperbola and the zone over it; the voltage and current ratings
      const hyper = (p, close) => {
        ctx.beginPath(); let first = true;
        for (let px = 0; px <= pw; px += 2) { const v = Math.max(vAt(px), 1e-3), y = Y(Math.min(p / v, lim)); first ? ctx.moveTo(padL + px, y) : ctx.lineTo(padL + px, y); first = false; }
        if (close) { ctx.lineTo(padL + pw, padT); ctx.lineTo(padL, padT); ctx.closePath(); }
      };
      // (in the legend while the hyperbola is in view)
      const seen = p => p / Math.max(v1, 1e-9) < i1;
      if (S.opts.pa) {
        hyper(spec.p, true); ctx.fillStyle = "rgba(255,51,68,0.07)"; ctx.fill();
        hyper(spec.p); ctx.strokeStyle = "#ff3344"; ctx.lineWidth = 1.8; ctx.stroke();
        if (seen(spec.p)) {
          item("", "#ff3344", `Pd max ${spec.p} W`, `Maximum dissipation ${nm.v} × ${nm.i} = Ptot (${spec.p >= 5 ? "with the case at 25 °C: on a heatsink it is less" : "in free air at 25 °C"})`);
          item("area", "#ff3344", "Over Pd max", "Above the curve the part dissipates more than its rating");
        }
        if (!dev.jfet) {
          ctx.setLineDash([2, 4]); ctx.strokeStyle = "rgba(255,123,114,0.85)"; ctx.lineWidth = 1.2;
          const vr = X(spec.v), ir = Y(spec.i);
          if (spec.v < v1) { ctx.beginPath(); ctx.moveTo(vr, padT); ctx.lineTo(vr, padT + ph); ctx.stroke(); }
          if (spec.i < i1) { ctx.beginPath(); ctx.moveTo(padL, ir); ctx.lineTo(padL + pw, ir); ctx.stroke(); }
          ctx.setLineDash([]);
          ctx.font = "10px ui-monospace, monospace"; ctx.fillStyle = "#ff7b72"; ctx.textAlign = "left";
          if (spec.v < v1) ctx.fillText(`${dev.bip ? "VCEO" : "VDS max"} ${spec.v} V`, vr + 4, padT + 10);
          if (spec.i < i1) ctx.fillText(`${dev.bip ? "IC" : "ID"} max ${fmtEng(spec.i, "A")}`, padL + 6, ir - 8);
          if (spec.v < v1 || spec.i < i1) item("dash", "#ff7b72", `${dev.bip ? "VCEO" : "VDS"} ${spec.v} V, ${dev.bip ? "IC" : "ID"} ${fmtEng(spec.i, "A")} max`, "The voltage and current ratings: the safe area is left of and below these lines and under Pd max");
        }
      }
      if (S.opts.pa70) {
        hyper(0.7 * spec.p); ctx.strokeStyle = "rgba(255,179,0,0.7)"; ctx.setLineDash([5, 5]); ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
        if (seen(0.7 * spec.p)) item("dash", "#ffb300", `70% of Pd max (${+(0.7 * spec.p).toPrecision(3)} W)`, "A comfortable limit: the junction stays cooler and the part lasts");
      }
      // the family; recomputed for the window when zoomed, so it stays smooth
      let fam = pd.curves;
      if (z) {
        const k = v0 + ":" + v1;
        if (!pd.vis || pd.vis.k !== k) pd.vis = { k, curves: pd.curves.map(c => ({ c: c.c, pts: SC.outputCurve(dev, c.c, SC.samples(Math.max(0, v0), v1)) })) };
        fam = pd.vis.curves;
      }
      fam.forEach(k => {
        strokeCurve(ctx, k.pts, X, Y, i0, i1);
        ctx.strokeStyle = "rgba(41,182,246,0.85)"; ctx.lineWidth = 1.3; ctx.stroke();
        const last = k.pts[k.pts.length - 1], y = Y(last[1]);
        if (y > padT + 8 && y < padT + ph - 4) labels.push([ctlText(d, k.c), y]);
      });
      item("", "#29b6f6", `${dev.bip ? "Collector" : "Drain"} curves, ${nm.c} step ${ctlText(d, pd.st.step)}`, `${nm.i} against ${nm.v} at fixed ${dev.bip ? "base currents" : "gate voltages"}; each curve's ${nm.c} is at its right end`);
      const q = pd.q;
      if (q && S.opts.bias) {
        const k = v0 + ":" + v1 + ":" + q.c;
        if (!pd.bias || pd.bias.k !== k) pd.bias = { k, pts: SC.outputCurve(dev, q.c, SC.samples(Math.max(0, v0), v1, 200)) };
        strokeCurve(ctx, pd.bias.pts, X, Y, i0, i1);
        ctx.strokeStyle = "#3fb950"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([]);
        item("dash", "#3fb950", `Curve at circuit bias ${nm.c} ${ctlText(d, q.c)}`, `The output curve at the ${dev.bip ? "base current" : "gate voltage"} the circuit actually sets`);
      }
    } else if (mode === "transfer") {
      if (pd.hot) {
        strokeCurve(ctx, pd.hot, X, Y, i0, i1);
        ctx.strokeStyle = "rgba(255,138,101,0.85)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
        item("dash", "#ff8a65", `At ${+pd.hotT.toFixed(1)} °C`, `The same part 25 °C warmer: ${dev.ge ? "a germanium part's leakage roughly sextuples and " : ""}${nm.vc} falls about 2 mV per °C at a given current, which is why a bias needs emitter resistance or a tracking diode`);
      }
      strokeCurve(ctx, pd.curve, X, Y, i0, i1);
      ctx.strokeStyle = "rgba(41,182,246,0.95)"; ctx.lineWidth = 1.8; ctx.stroke();
      item("", "#29b6f6", `Transfer curve at ${nm.v} ${+pd.vFix.toPrecision(3)} V${dev.bip ? `, ${+dev.temp.toFixed(1)} °C` : ""}`, `${nm.i} against ${nm.vc} with the ${dev.bip ? "collector" : "drain"} held at ${+pd.vFix.toPrecision(3)} V; its slope is the transconductance gm`);
    } else {
      strokeCurve(ctx, pd.curve, X, Y, i0, i1);
      ctx.strokeStyle = "rgba(41,182,246,0.95)"; ctx.lineWidth = 1.8; ctx.stroke();
      if (dev.bip) {
        item("", "#29b6f6", `hFE = IC / IB at ${nm.v} ${+pd.vFix.toPrecision(3)} V`, "The static current gain (DC beta), what the datasheet's hFE graph shows");
        strokeCurve(ctx, pd.curve, X, Y, i0, i1, 0, 2);
        ctx.strokeStyle = "rgba(186,104,200,0.9)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.3; ctx.stroke(); ctx.setLineDash([]);
        item("dash", "#ba68c8", "h21e = dIC / dIB", `The small-signal gain${dev.ge ? ": with a germanium part's leakage it differs from hFE, and USSR books list this one" : ""}`);
      } else item("", "#29b6f6", `gm = dID / dVGS at ${nm.v} ${+pd.vFix.toPrecision(3)} V`, "The transconductance: the drain current's change per volt on the gate");
    }
    // the simulated load line: one cycle of the signal, with arrows for its direction
    if (tr && tr.v && tr.v.length > 1) {
      const xs = mode === "output" ? tr.v : tr.c;
      ctx.beginPath();
      xs.forEach((v, i) => { const x = X(v), y = Y(tr.i[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = "#ffd54f"; ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.stroke();
      const n = xs.length;
      ctx.fillStyle = "#ffd54f";
      [0.12, 0.45, 0.78].forEach(fr => {
        const a = Math.floor(n * fr), b = Math.min(n - 1, a + 4);
        const bx = X(xs[b]), by = Y(tr.i[b]), ang = Math.atan2(by - Y(tr.i[a]), bx - X(xs[a]));
        if (Math.hypot(bx - X(xs[a]), by - Y(tr.i[a])) < 0.5) return;
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.lineTo(bx - 9 * Math.cos(ang - 0.42), by - 9 * Math.sin(ang - 0.42)); ctx.lineTo(bx - 9 * Math.cos(ang + 0.42), by - 9 * Math.sin(ang + 0.42)); ctx.closePath(); ctx.fill();
      });
      item("", "#ffd54f", "Simulated load line, one cycle (arrows: direction)", `The path of the operating point through the last cycle of the signal${mode === "output" ? "; its slope is the load the part sees" : `, along the transfer curve: ${nm.vc} against ${nm.i}`}`);
    }
    // Q point
    const qp = semiQPoint(d, pd);
    if (qp) {
      const qx = X(qp.va), qy = Y(qp.ia);
      ctx.strokeStyle = "#00e5ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(qx, qy, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#00e5ff"; ctx.beginPath(); ctx.arc(qx, qy, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = "bold 11px ui-monospace, monospace"; ctx.textAlign = "left";
      const txt = mode === "output" ? `Q ${fmtEng(qp.va, "V", 2)}, ${fmtEng(qp.ia, "A", 2)}` : mode === "transfer" ? `Q ${fmtEng(qp.va, "V", 3)}, ${fmtEng(qp.ia, "A", 2)}` : `Q ${fmtEng(qp.va, "A", 2)}, ${dev.bip ? "hFE " + Math.round(qp.ia) : "gm " + fmtEng(qp.ia, "S", 2)}`;
      const tw = ctx.measureText(txt).width + 8, lx = qx + 10 + tw > padL + pw ? qx - 10 - tw : qx + 10;   // flips left at the right edge
      ctx.fillStyle = "rgba(11,17,25,0.85)"; ctx.fillRect(lx, qy - 22, tw, 16);
      ctx.fillStyle = "#e6edf3"; ctx.fillText(txt, lx + 4, qy - 14);
      item("ring", "#00e5ff", "Operating point Q", "The part's voltages and current with no signal (DC bias)");
    }
    ctx.restore();

    // curve labels at the right edge
    ctx.font = "10px ui-monospace, monospace"; ctx.textAlign = "left"; ctx.fillStyle = "#29b6f6";
    labels.forEach(([t, y]) => ctx.fillText(t, padL + pw + 4, y));

    // hover crosshair
    if (S.hover) {
      const { va, ia } = S.hover, x = X(va), y = Y(ia);
      if (x >= padL - 0.5 && x <= padL + pw + 0.5 && ia >= i0 && ia <= i1) {
        ctx.strokeStyle = "rgba(230,237,243,0.25)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + ph); ctx.moveTo(padL, y); ctx.lineTo(padL + pw, y); ctx.stroke();
        const r = describeSemi(d, S.hover), lines = semiLines(d, r);
        MarkerPicker.label(ctx, x, y > padT + ph / 2 ? padT + 4 : padT + ph - 14 * lines.length - 10, padL, padL + pw, lines);
      }
    }
    // picked points A, B and the line through them
    const pts = pick ? pick.list.map(pointOf) : [];
    if (mode !== "gain" && pts.length === 2 && pts[0] && pts[1] && Math.abs(pts[1].va - pts[0].va) > 1e-12) {
      const k = (pts[1].ia - pts[0].ia) / (pts[1].va - pts[0].va), at = v => pts[0].ia + k * (v - pts[0].va);
      ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, pw, ph); ctx.clip();
      ctx.beginPath(); ctx.moveTo(X(v0), Y(at(v0))); ctx.lineTo(X(v1), Y(at(v1)));
      ctx.strokeStyle = "rgba(255,138,216,0.8)"; ctx.setLineDash([7, 4]); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
      item("dash", "#ff8ad8", "Line through A and B", mode === "output" ? "Its slope gives the load resistance; the value is shown below the plot" : "Its slope is the transconductance between A and B; the value is shown below the plot");
    }
    pts.forEach((p, i) => { if (p) MarkerPicker.draw(ctx, X(p.va), Y(p.ia), MarkerPicker.LETTERS[i], "#ff8ad8"); });
    if (pts.some(Boolean)) legend.splice(legend.length - (mode !== "gain" && pts.length === 2 && pts[0] && pts[1] ? 1 : 0), 0, `<span title="Click the plot to pick; values are shown below the plot"><i class="ring" style="--c:#ff8ad8"></i>Picked points A, B</span>`);
    $("plot-title").textContent = `${d.name} · ${SEMI_KIND[d.type]}${dev.ge ? " germanium" : ""}${dev.bip && Math.abs(dev.temp - 25) > 1e-9 ? `, ${+dev.temp.toFixed(1)} °C` : ""}` + (ct ? ` · ${ct.label} in circuit` : "");
    $("legend").innerHTML = legend.join("");
  }

  /** Everything worth knowing about a point of the plot shown now. */
  function describeSemi(d, p) {
    const pd = semiPlot(d), dev = d.dev, spec = d.spec;
    if (pd.mode === "output") {
      const c = p.c !== undefined && p.c !== null ? p.c : p.ia > 0 ? (dev.bip ? SC.ibFor(dev, p.va, p.ia) : SC.vgsFor(dev, p.va, p.ia)) : null;
      const r = { mode: "output", v: p.va, i: p.ia, c, pd: p.va * p.ia, pdPct: p.va * p.ia / spec.p * 100, on: p.on };
      if (c !== null && p.ia > 0 && p.va >= 0) r.ss = SC.smallSignal(dev, p.va, c);
      return r;
    }
    if (pd.mode === "transfer") {
      const r = { mode: "transfer", vc: p.va, i: p.ia, on: p.on, gm: semiSlope(pd.curve, p.va, 1) };
      if (dev.bip) { const ib = interp(pd.curve, p.va, 2); r.ib = ib; r.hfe = ib > 0 ? p.ia / ib : null; }
      return r;
    }
    const r = { mode: "gain", i: p.va, g: p.ia, on: p.on };
    if (dev.bip) r.h21 = interp(pd.curve, p.va, 2);
    return r;
  }
  const fmtR = r => (isFinite(r) ? fmtEng(r, "Ω", 2) : "∞");
  /** The readout lines for the hover label: [text, colour]. */
  function semiLines(d, r) {
    const nm = semiNames(d), b = d.dev.bip, on = r.on ? `  (${r.on})` : "";
    if (r.mode === "output") {
      const out = [[`${nm.v} ${fmtEng(r.v, "V", 3)}  ${nm.i} ${fmtEng(r.i, "A", 3)}`, "#e6edf3"], [`${nm.c} ${ctlText(d, r.c)}${on}`, "#29b6f6"],
        [`Pd ${fmtEng(r.pd, "W", 2)} (${Math.round(r.pdPct)}% of max)`, r.pdPct > 100 ? "#ff7b72" : "#8fa6c2"]];
      if (r.ss) out.push([b ? `hFE ${r.ss.hfe ? Math.round(r.ss.hfe) : "—"}  gm ${fmtEng(r.ss.gm, "S", 2)}  ro ${fmtR(r.ss.ro)}` : `gm ${fmtEng(r.ss.gm, "S", 2)}  rds ${fmtR(r.ss.rds)}  µ ${r.ss.mu.toFixed(0)}`, "#8fa6c2"]);
      return out;
    }
    if (r.mode === "transfer") return [[`${nm.vc} ${fmtEng(r.vc, "V", 3)}  ${nm.i} ${fmtEng(r.i, "A", 3)}${on}`, "#e6edf3"],
      [`gm ${r.gm === null ? "—" : fmtEng(r.gm, "S", 2)}${b && r.ib ? `  ${nm.c} ${fmtEng(r.ib, "A", 3)}  hFE ${r.hfe ? Math.round(r.hfe) : "—"}` : ""}`, "#29b6f6"]];
    return [[`${nm.i} ${fmtEng(r.i, "A", 3)}${on}`, "#e6edf3"], [b ? `hFE ${Math.round(r.g)}${r.h21 !== null && r.h21 !== undefined ? `  h21e ${Math.round(r.h21)}` : ""}` : `gm ${fmtEng(r.g, "S", 3)}`, "#29b6f6"]];
  }
  const semiPickText = (d, r) => semiLines(d, r).map(l => l[0].trim().replace(/ {2,}/g, " · ")).join(" · ");
  function snapSemi(x, y) {
    const g = geom(); if (!g) return null;
    if (x < g.padL - 6 || x > g.padL + g.pw + 6 || y < g.padT - 6 || y > g.padT + g.ph + 6) return null;
    const d = current(), pd = semiPlot(d), ct = d.circuit;
    const qp = semiQPoint(d, pd);
    if (qp && Math.hypot(g.X(qp.va) - x, g.Y(qp.ia) - y) <= SNAP) return { q: true };
    const tr = pd.mode !== "gain" && ct && ct.traj && S.opts.traj ? ct.traj : null;
    if (tr) {
      const xs = pd.mode === "output" ? tr.v : tr.c;
      let best = -1, bd = SNAP;
      for (let k = 0; k < xs.length; k++) { const dd = Math.hypot(g.X(xs[k]) - x, g.Y(tr.i[k]) - y); if (dd < bd) { bd = dd; best = k; } }
      if (best >= 0) return { traj: best };
    }
    const va = g.vAt(Math.max(0, Math.min(g.pw, x - g.padL))), ia = g.iAt(Math.max(g.padT, Math.min(g.padT + g.ph, y)));
    // on the transfer and gain plots a point is a point of the curve, at the pointer's x
    if (pd.mode !== "output") { const on = interp(pd.curve, va, 1); return on === null ? null : { va, ia: on, on: "curve" }; }
    return { va, ia };
  }
  function pointOfSemi(m) {
    const d = current(), pd = semiPlot(d), ct = d.circuit;
    if (m.q) return semiQPoint(d, pd);
    if (m.traj !== undefined) {
      const tr = ct && ct.traj; if (!tr || m.traj >= tr.v.length || pd.mode === "gain") return null;
      const k = m.traj;
      return pd.mode === "output" ? { va: tr.v[k], ia: tr.i[k], c: d.dev.bip ? undefined : tr.c[k], on: "load line" } : { va: tr.c[k], ia: tr.i[k], on: "load line" };
    }
    if (m.on === "curve" && pd.mode !== "output") { const ia = interp(pd.curve, m.va, 1); return ia === null ? null : { va: m.va, ia, on: "curve" }; }
    return { va: m.va, ia: m.ia, on: m.on || null };
  }
  function renderSemiPicks(d) {
    const pd = semiPlot(d), nm = semiNames(d);
    const rs = pick.list.map(pointOf).map(p => p && describeSemi(d, p));
    let h = "";
    rs.forEach((r, i) => { if (r) h += `<span><b>${MarkerPicker.LETTERS[i]}</b>: ${semiPickText(d, r)}</span>`; });
    if (rs.length === 2 && rs[0] && rs[1] && pd.mode !== "gain") {
      const out = pd.mode === "output", dV = out ? rs[1].v - rs[0].v : rs[1].vc - rs[0].vc, dI = rs[1].i - rs[0].i;
      let line = `<span><b>A→B</b>: Δ${out ? nm.v : nm.vc} ${fmtEng(dV, "V", 3)} · Δ${nm.i} ${fmtEng(dI, "A", 3)}`;
      if (out && Math.abs(dI) > 1e-15 && Math.abs(dV) > 1e-12 && dV * dI < 0) {
        const R = -dV / dI, v0 = rs[0].v + rs[0].i * R;
        line += ` · load line <b>${fmtEng(R, "Ω", 2)}</b> (${fmtEng(v0, "V", 2)} at ${nm.i} = 0, ${fmtEng(v0 / R, "A", 2)} at ${nm.v} = 0)`;
      } else if (out && Math.abs(dI) > 1e-15) line += ` · slope ${fmtEng(dV / dI, "Ω", 2)}`;
      else if (!out && Math.abs(dV) > 1e-12) line += ` · gm <b>${fmtEng(dI / dV, "S", 3)}</b>`;
      h += line + "</span>";
    }
    if (!h) h = `<span class="hint">${pd.mode === "output" ? `Click the plot to pick point A, then B: ${nm.c}, ${d.dev.bip ? "hFE, gm and ro" : "gm, rds and µ"} there, and the load line through both. Points snap to the operating point and the simulated load line.` : "Click the curve to pick point A, then B: the values there" + (pd.mode === "transfer" ? " and the transconductance between them." : ".")} Drag to move, double-click to remove.</span>`;
    else h += `<button class="btn" id="picks-clear" title="Remove the points (Esc)">Clear points</button>`;
    $("picks").innerHTML = h;
    const b = $("picks-clear"); if (b) b.onclick = () => pick.clear();
  }

  // ---------------------------------------------------------------------------
  // Transistor library, package and readouts
  // ---------------------------------------------------------------------------
  function renderSemiLibrary(host) {
    const q = S.query.toLowerCase(), f = S.semiFilter;
    SEMI_GROUPS.forEach(([type, head, which]) => {
      if (f === "bjt" && !/npn|pnp/.test(type)) return;
      if (f === "mos" && !/mos/.test(type)) return;
      if (f === "jfet" && !/jf/.test(type)) return;
      const items = Object.entries(CadLib.semiTable(type)).filter(([k, m]) => m.pol === polOf(type) && (!which || which(m)) && (f !== "ge" || m.ge)
        && (!q || (k + " " + m.use + " " + head + " " + m.pkg).toLowerCase().includes(q)));
      if (!items.length) return;
      const sub = document.createElement("div"); sub.className = "list-sub"; sub.textContent = head; host.appendChild(sub);
      items.forEach(([k, m]) => {
        const b = document.createElement("button");
        const active = S.view && S.view.source === "library" && S.view.semi === type && S.view.name === k;
        b.className = "list-item" + (active ? " active" : "");
        b.innerHTML = `<span>${k}</span><em>${m.v} V · ${m.p} W</em>`;
        b.title = `${m.use} (${m.pkg})`;
        b.onclick = () => { S.view = { source: "library", semi: type, name: k, picked: true }; renderAll(); };
        host.appendChild(b);
      });
    });
    if (!host.children.length) host.innerHTML = `<p class="muted small">No transistor matches.</p>`;
  }
  /** The package, leads down, with the pin order of the maker's drawing (board-core.js PINOUT). */
  function drawPackage(d) {
    const cv = $("socket"), ctx = cv.getContext("2d"), w = cv.width, h = cv.height, spec = d.spec;
    ctx.clearRect(0, 0, w, h);
    const po = window.BoardCore && BoardCore.PINOUT[d.name], order = (po ? po[0] : d.dev.bip ? "EBC" : "GDS").split(""), verify = po && po[1] === "verify";
    const pkg = spec.pkg || "", can = /^TO-(18|5|39|1)$|^MP$|SOT-9/.test(pkg), to3 = /^TO-3$/.test(pkg), flat = /TO-220|TO-247|TO-3P|TO-126|TO-264/.test(pkg);
    const ROLE = { E: "emitter", B: "base", C: "collector", G: "gate", D: "drain", S: "source" }, COL = { E: "#00c853", S: "#00c853", B: "#00b0ff", G: "#00b0ff", C: "#d32f2f", D: "#d32f2f" };
    ctx.lineWidth = 2; ctx.strokeStyle = "#60728c"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const body = (fill) => { ctx.fillStyle = fill || "#1e2836"; ctx.fill(); ctx.stroke(); };
    const lead = (x, y0, y1) => { ctx.strokeStyle = "#b0bccb"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = "#60728c"; };
    const pinTag = (x, y, r, n) => {
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = COL[r] || "#3d4b60"; ctx.fill(); ctx.strokeStyle = "#e6edf3"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px monospace"; ctx.fillText(r, x, y);
      ctx.fillStyle = "#8fa6c2"; ctx.font = "9px sans-serif"; ctx.fillText(n, x, y + 21);
      ctx.lineWidth = 2; ctx.strokeStyle = "#60728c";
    };
    if (to3) {
      // a TO-3 can from below: two pins, the case is the collector
      ctx.beginPath(); ctx.ellipse(100, 92, 78, 46, 0, 0, Math.PI * 2); body("#26303e");
      ctx.beginPath(); ctx.arc(100, 92, 30, 0, Math.PI * 2); body("#1a2230");
      [[30, 92], [170, 92]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fillStyle = "#0b1119"; ctx.fill(); });
      pinTag(88, 80, order[0], 1); pinTag(112, 106, order[1], 2);
      ctx.fillStyle = "#ff8a80"; ctx.font = "10px sans-serif"; ctx.fillText(`case = ${order[2] || "C"}`, 100, 160);
      $("socket-name").textContent = `${pkg} · from below`;
    } else {
      // leads down, the marked face towards you, pin 1 left
      ctx.beginPath();
      if (can) { ctx.arc(100, 62, 40, 0, Math.PI * 2); body("#3a4656"); ctx.beginPath(); ctx.moveTo(136, 84); ctx.lineTo(146, 94); ctx.lineTo(140, 98); ctx.closePath(); ctx.fillStyle = "#8a96a6"; ctx.fill(); }
      else if (flat) { ctx.rect(48, 52, 104, 56); body(); ctx.beginPath(); ctx.rect(48, 18, 104, 34); body("#9aa5b4"); ctx.beginPath(); ctx.arc(100, 34, 8, 0, Math.PI * 2); ctx.fillStyle = "#0b1119"; ctx.fill(); }
      else { ctx.moveTo(60, 104); ctx.lineTo(60, 60); ctx.arc(100, 60, 40, Math.PI, 0); ctx.lineTo(140, 104); ctx.closePath(); body(); }
      ctx.fillStyle = "#8ba0bc"; ctx.font = "bold 10px sans-serif"; ctx.fillText(d.name, 100, can ? 62 : flat ? 80 : 84);
      const xs = [70, 100, 130], top = can ? 100 : flat ? 108 : 104;
      xs.forEach((x, i) => { lead(x, top, 138); pinTag(x, 150, order[i] || "?", i + 1); });
      $("socket-name").textContent = `${pkg} · leads down, ${can ? "tab right" : "marked face towards you"}`;
    }
    $("socket-head").textContent = "Package";
    $("socket-note").textContent = verify ? "Pinouts differ between makers: check your part's datasheet." : "";
    $("socket-source").textContent = `Pins ${(to3 ? order.slice(0, 2) : order).map((r, i) => `${i + 1} ${ROLE[r] || r}`).join(", ")}${to3 ? `, case ${ROLE[order[2]] || "collector"}` : ""} · ${spec.use}`;
  }
  const inputRow = (id, label, value, placeholder, unit, note, disabled) =>
    `<label class="row"><span>${label}${unit ? ` (${unit})` : ""}</span><input type="text" inputmode="decimal" id="${id}" value="${value === null || value === undefined ? "" : value}" placeholder="${placeholder}"${disabled ? " disabled" : ""}>${note ? `<small class="muted">${note}</small>` : ""}</label>`;
  function renderSemiHud(d) {
    const dev = d.dev, spec = d.spec, m = dev.m, nm = semiNames(d), ct = d.circuit, q = semiQ(d), pd = semiPlot(d), b = dev.bip, T = S.trace;
    let h = "";
    if (ct && q) {
      h += `<h3>Operating point <small>${ct.label}</small></h3>`;
      h += kv(nm.v, fmtEng(q.v, "V", 2), q.v > spec.v ? "bad" : "") + kv(nm.i, fmtEng(q.i, "A", 3), q.i > spec.i && !dev.jfet ? "bad" : "");
      if (b) h += kv(nm.c, fmtEng(q.c, "A", 3)) + kv(nm.vc, fmtEng(q.vc, "V", 3)) + kv("hFE (IC / IB)", q.c > 0 ? Math.round(q.i / q.c) : "—");
      else h += kv(nm.c, fmtEng(q.c, "V", 3));
      const ss = q.i > 0 && q.v > 0 ? SC.smallSignal(dev, q.v, b ? q.c : q.c) : null;
      if (ss) h += b ? kv("gm", fmtEng(ss.gm, "S", 2)) + kv("ro", fmtR(ss.ro)) : kv("gm", fmtEng(ss.gm, "S", 2)) + kv("rds", fmtR(ss.rds));
      const p = q.pd !== undefined ? Math.abs(q.pd) : q.v * q.i, share = p / spec.p;
      h += kv("Pd (DC)", fmtEng(p, "W", 2), share > 1 ? "bad" : share > 0.85 ? "warn" : "");
      h += `<div class="bar"><div style="width:${Math.min(100, share * 100)}%;background:${share > 1 ? "#ff3344" : share > 0.85 ? "#ffb300" : "#3fb950"}"></div></div>`;
      if (ct.metrics) {
        const mt = ct.metrics;
        h += `<h3>With signal</h3>` + kv(`${nm.v} swing`, fmtEng(mt.vPP, "Vpp", 2)) + kv(`${nm.i} swing`, fmtEng(mt.iPP, "App", 2)) + kv(`${nm.vc} swing`, fmtEng(mt.cPP, "Vpp", 3));
        h += kv("Average Pd", fmtEng(mt.pAvg, "W", 2), mt.pAvg > spec.p ? "bad" : "");
      }
    } else h += `<h3>Library preview</h3><p class="muted small">Not in the circuit, so no operating point. Add it in the Circuit CAD to see where it works.</p>`;
    // the trace settings: blank is automatic, the value in use shown in grey
    h += `<h3>Curves</h3>`;
    h += inputRow("tr-n", "Curves", T.n, "8", "", "");
    h += inputRow("tr-step", `${nm.c} step`, T.step ? (b ? fmtEng(T.step, "") : T.step) : "", "auto " + ctlText(d, pd.st.step).replace(/ /g, ""), b ? "A" : "V", "");
    h += inputRow("tr-vmax", `${nm.v} max`, T.vMax || "", "auto " + +pd.vMax.toPrecision(3), "V", "");
    h += inputRow("tr-vfix", `${nm.v} for ${b ? "IC–VBE, hFE" : "ID–VGS, gm"}`, T.vFix || "", "auto " + +pd.vFix.toPrecision(3), "V", ct && !T.vFix ? "auto: the operating point's" : "");
    if (b) h += inputRow("tr-temp", "Temperature", ct ? ct.temp : T.temp, "25", "°C", ct ? "the part's, set in the CAD" : dev.ge ? "germanium: leakage doubles every 10 °C" : "VBE falls about 2 mV/°C", !!ct);
    h += `<div class="hud-actions"><button class="btn" id="tr-reset" title="Automatic steps and ranges again">Automatic</button></div>`;
    h += `<h3>Ratings</h3>` + kv(b ? "VCEO" : dev.jfet ? "V(BR)GSS" : "VDS max", spec.v + " V") + kv(dev.jfet ? "IG max" : b ? "IC max" : "ID max", fmtEng(spec.i, "A")) + kv("Ptot", spec.p + " W") + kv("Package", spec.pkg);
    if (dev.jfet) h += kv("IDSS (model)", fmtEng(dev.idss, "A", 2)) + kv("VGS(off)", `${m.vto > 0 ? "+" : ""}${m.vto.toFixed(2)} V`);
    if (b) {
      h += `<h3>Gummel-Poon model${dev.ge ? " (germanium)" : ""}</h3>` + kv("IS", m.is.toExponential(3) + " A") + kv("BF", +m.bf.toPrecision(4)) + kv("BR", +(m.br || 1).toPrecision(3)) + kv("VAF (Early)", +m.vaf.toPrecision(4) + " V") + kv("IKF", fmtEng(m.ikf, "A", 3));
      if (dev.rb || dev.re) h += kv("RB", fmtR(dev.rb)) + kv("RE", fmtR(dev.re));
      if (m.icbo) h += kv("ICBO at " + +dev.temp.toFixed(1) + " °C", fmtEng(m.icbo, "A", 2));
    } else h += `<h3>${dev.jfet ? "JFET" : "MOSFET"} model (square law)</h3>` + kv(dev.jfet ? "VTO (pinch-off)" : dev.vth < 0 ? "VTO (depletion)" : "VTO (threshold)", `${m.vto} V`) + kv(dev.jfet ? "BETA" : "KP", (dev.jfet ? m.jf.beta : m.kp) + " A/V²") + kv("λ", m.lambda + " /V");
    $("hud").innerHTML = h;
    const num = (id, fn) => { const el = $(id); if (el && !el.disabled) el.onchange = () => { const t = el.value.trim(), v = t === "" ? null : CadLib.parseEng(t.replace(/\s*(V|A|°C)$/i, "")); fn(v === null || isFinite(v) ? v : undefined); renderAll(); }; };
    num("tr-n", v => { if (v > 0) S.trace.n = Math.round(v); else if (v === null) S.trace.n = 8; });
    num("tr-step", v => { if (v === null || v > 0) S.trace.step = v; });
    num("tr-vmax", v => { if (v === null || v > 0) S.trace.vMax = v; });
    num("tr-vfix", v => { if (v === null || v > 0) S.trace.vFix = v; });
    num("tr-temp", v => { if (v === null) S.trace.temp = 25; else if (v >= -55 && v <= 175) S.trace.temp = v; });
    $("tr-reset").onclick = () => { Object.assign(S.trace, { n: 8, step: null, vMax: null, vFix: null }); S.zoom = null; renderAll(); };
  }
  /** The SPICE model of the part, as the CAD's export writes it. */
  function semiModelText(d) {
    const dev = d.dev, m = dev.m, sp = d.spec, safe = d.name.replace(/[^A-Za-z0-9_]/g, "_"), head = `* ${d.name} — ${SEMI_KIND[d.type]}${dev.ge ? " germanium" : ""}: ${sp.use}\n* Ratings ${sp.v} V, ${sp.i} A, ${sp.p} W, ${sp.pkg}. Generated ${new Date().toISOString().slice(0, 10)} by the Tube Amp CAD curve tracer\n`;
    if (dev.bip) {
      const m0 = CadLib.BJTS[d.name];
      return head + `.model Q${dev.pol > 0 ? "N" : "P"}_${safe} ${dev.pol > 0 ? "NPN" : "PNP"}(IS=${m0.is} BF=${m0.bf} BR=${m0.br || 1} NF=1 VAF=${m0.vaf} IKF=${m0.ikf}${dev.rb ? ` RB=${dev.rb}` : ""}${dev.re ? ` RE=${dev.re}` : ""} CJE=${m0.cbe} CJC=${m0.cbc} EG=${dev.ge ? 0.67 : 1.11} XTI=3 XTB=1.5 TNOM=27)\n`
        + (m0.icbo ? `* germanium leakage, not in the Gummel-Poon model: ICBO ${m0.icbo} A at 25 °C from collector to base, doubling every 10 °C\n` : "");
    }
    if (dev.jfet) return head + `.model J${dev.pol > 0 ? "N" : "P"}_${safe} ${dev.pol > 0 ? "NJF" : "PJF"}(VTO=${-Math.abs(m.vto)} BETA=${m.jf.beta} LAMBDA=${m.lambda || 0} IS=${m.jf.is} CGS=${sp.cgs} CGD=${sp.cgd})\n`;
    return head + `.model M${dev.pol > 0 ? "N" : "P"}_${safe} ${dev.pol > 0 ? "NMOS" : "PMOS"}(LEVEL=1 VTO=${m.vto} KP=${m.kp} LAMBDA=${m.lambda || 0})\n* gate capacitances Cgs ${sp.cgs} F, Cgd ${sp.cgd} F; the body diode is a separate diode, source to drain\n`;
  }
  /** The plot shown now as a table. */
  function curvesCsv(d) {
    const rows = [];
    if (d.semi) {
      const pd = semiPlot(d), nm = semiNames(d);
      if (pd.mode === "output") {
        rows.push([`${nm.v} (V)`].concat(pd.curves.map(k => `${nm.i} (A) at ${nm.c} = ${d.dev.bip ? k.c : k.c + " V"}${d.dev.bip ? " A" : ""}`)));
        pd.curves[0].pts.forEach((p, j) => rows.push([p[0]].concat(pd.curves.map(k => k.pts[j][1]))));
      } else if (pd.mode === "transfer") {
        rows.push(d.dev.bip ? [`${nm.vc} (V)`, `${nm.i} (A)`, `${nm.c} (A)`] : [`${nm.vc} (V)`, `${nm.i} (A)`]);
        pd.curve.forEach(p => rows.push(p));
      } else {
        rows.push(d.dev.bip ? [`${nm.i} (A)`, "hFE", "h21e"] : [`${nm.i} (A)`, "gm (S)"]);
        pd.curve.forEach(p => rows.push(p));
      }
    } else {
      const g = geom(), vgs = [];
      const cutoff = d.kind === "pentode" ? -(d.vg2 || 250) / d.model.mu : -g.vaMax / d.model.mu, step = niceStep(Math.abs(cutoff) / 8);
      for (let vg = 0, k = 0; vg >= cutoff * 1.05 && k < 16; vg -= step, k++) vgs.push(+vg.toFixed(6));
      rows.push(["Va (V)"].concat(vgs.map(v => `Ia (A) at Vg = ${v} V`)));
      for (let k = 0; k <= 200; k++) { const va = g.vaMax * k / 200; rows.push([va].concat(vgs.map(vg => iaOf(d, va, vg)))); }
    }
    return rows.map(r => r.map(x => (typeof x === "number" ? +x.toPrecision(6) : `"${x}"`)).join(",")).join("\n") + "\n";
  }

  // ---------------------------------------------------------------------------
  // Right column
  // ---------------------------------------------------------------------------
  const kv = (k, v, cls) => `<div class="kv${cls ? " " + cls : ""}"><span>${k}</span><b>${v}</b></div>`;
  function renderHud() {
    const d = current();
    if (d.semi) { renderSemiHud(d); return; }
    const t = d.tube, ct = d.circuit;
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
    const L = t.limits || {};
    h += `<h3>Ratings</h3>` + kv("Va max", t.vaMax + " V") + kv("Pa max", t.paMax + " W") + kv("Ik max", t.ikMax + " mA") + (t.vg2Max ? kv("Vg2 max", t.vg2Max + " V") : "")
      + (L.pg2 ? kv("Pg2 max", L.pg2 + " W") : "") + (L.vhk ? kv("Vhk max", L.vhk + " V" + (L.vhkNeg && L.vhkNeg !== L.vhk ? ` (${L.vhkNeg} V cathode positive)` : "")) : "")
      + (L.rg ? kv("Rg max", (L.rg / 1e6) + " MΩ" + (L.rgFixed ? ` · ${L.rgFixed / 1e6} MΩ fixed bias` : " cathode bias")) : "") + kv("Heater", `${t.vh} V · ${t.ih} A`);
    const m = d.model;
    if (m.spice) h += `<h3>Imported SPICE model</h3>` + kv("Subcircuit", m.spice.sub) + kv("Pins", m.spice.roles.join(" · ")) + kv("µ (estimated)", m.mu) + (t.custom && t.custom.like ? kv("Socket and ratings like", t.custom.like) : "");
    else h += d.kind === "pentode"
      ? `<h3>Pentode model</h3>` + kv("µ (g1–g2)", m.mu) + kv("kg1", m.kg) + kv("kp", m.kp) + kv("x", m.x) + kv("knee vk", m.vk + " V") + kv("slope λ", m.lam + " V") + kv("kg2", m.kg2) + kv("screen share ks", m.ks)
      : `<h3>Koren model (triode)</h3>` + kv("µ", m.mu) + kv("kg1", m.kg) + kv("kp", m.kp) + kv("kvb", m.kvb) + kv("x", m.x);
    $("hud").innerHTML = h;
    const vin = $("vg2-preview");
    if (vin) vin.onchange = () => { const v = parseFloat(vin.value); if (v > 0) { S.vg2Preview = v; renderAll(); } };
  }

  // ---------------------------------------------------------------------------
  // Curve fitter (Nelder-Mead on measured points) and LTspice model export
  // ---------------------------------------------------------------------------
  const fitKoren = (points, init, kind, vg2) => KorenFit.fit(points, init, kind, vg2);   // koren-fit.js
  function subckt(name, kind, m, metrics) {
    const safe = name.replace(/[^A-Za-z0-9]/g, "_");
    const head = `* ${name} — Koren ${kind} model${metrics ? ` (fitted: R² ${metrics.r2.toFixed(4)}, RMSE ${metrics.rmse.toFixed(3)} mA)` : " (tube database)"}\n* Generated ${new Date().toISOString().slice(0, 10)} by the Vacuum Tube Curve Tracer\n`;
    if (kind === "pentode") {
      const x = TubeSimEngine.Spice.pentode(m);
      return head + `.SUBCKT ${safe} A G1 G2 K\nBP  A  K  I=${x.plate}\nBS  G2 K  I=${x.screen}\nBG  G1 K  I=${x.grid}\n.ENDS ${safe}\n`;
    }
    const x = TubeSimEngine.Spice.triode(m);
    return head + `.SUBCKT ${safe} A G K\nBP  A  K  I=${x.plate}\nBG  G  K  I=${x.grid}\n.ENDS ${safe}\n`;
  }
  function openModelModal() {
    const d = current();
    ["btn-fit-upload", "btn-fit-sample", "btn-fit-clear"].forEach(id => { $(id).hidden = !!d.semi; });
    document.querySelector("#model-modal h2").textContent = d.semi ? "Transistor model" : "Tube model & curve fitter";
    document.querySelector("#model-modal p").hidden = !!d.semi;
    if (d.semi) {
      $("model-text").value = semiModelText(d);
      $("fit-status").textContent = `The SPICE model of ${d.name} with the simulator's parameters (cad-components.js), as the CAD's SPICE export writes it. The curves are drawn from the simulator's own equations.`;
      $("model-modal").hidden = false;
      return;
    }
    const m = S.fit && S.fit.tube === d.tube.commonName ? S.fit.params : d.model;
    if (m.spice) { $("model-text").value = m.spice.text; $("fit-status").textContent = "The imported SPICE model, as it runs. Upload measured points to fit a Koren model to your tube instead."; $("model-modal").hidden = false; return; }
    $("model-text").value = subckt(d.tube.commonName, S.fit && S.fit.tube === d.tube.commonName ? S.fit.kind : d.kind, m, S.fit && S.fit.tube === d.tube.commonName ? S.fit : null);
    $("fit-status").textContent = S.fit ? `Fitted ${S.fit.tube}: R² = ${S.fit.r2.toFixed(4)} · RMSE = ${S.fit.rmse.toFixed(3)} mA · ${S.fit.points.length} points` : "Showing the database model. Upload measured points (CSV: Va, Vg, Ia_mA[, Vg2]) to fit your own tube.";
    $("model-modal").hidden = false;
  }
  function runFit(points) {
    const d = current();
    // an imported SPICE model has no Koren parameters: start from the tube it is like
    const init = d.model.spice ? ((t => t && (d.kind === "pentode" ? t.koren.Pentode : t.koren.Triode))(tubeByName(d.tube.custom && d.tube.custom.like)) || (d.kind === "pentode" ? tubeByName("EL34").koren.Pentode : tubeByName("12AX7").koren.Triode)) : d.model;
    const r = fitKoren(points, init, d.kind, d.vg2 || 250);
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
  let shownKind = null;
  function renderAll() {
    const d = current();
    syncPickKey();
    // the library on the left follows what is shown: a transistor brings up the transistors
    const kind = d.semi ? "semis" : "tubes";
    if (kind !== shownKind) { shownKind = kind; S.lib = kind; }
    const modes = $("semi-modes");
    modes.hidden = !d.semi;
    if (d.semi) {
      const lab = d.dev.bip ? { output: "IC–VCE", transfer: "IC–VBE", gain: "hFE–IC" } : { output: "ID–VDS", transfer: "ID–VGS", gain: "gm–ID" };
      modes.querySelectorAll("button").forEach(b => { b.textContent = lab[b.dataset.m]; b.classList.toggle("active", b.dataset.m === S.semiMode); });
    }
    const out = !d.semi || S.semiMode === "output";
    $("opt-pa-t").textContent = d.semi ? "Pd max" : "Pa max"; $("opt-pa70-t").textContent = d.semi ? "70% Pd" : "70% Pa";
    ["opt-bias", "opt-pa", "opt-pa70"].forEach(id => { $(id).disabled = !out; $(id).parentNode.classList.toggle("off", !out); });
    $("opt-traj").disabled = d.semi && S.semiMode === "gain"; $("opt-traj").parentNode.classList.toggle("off", d.semi && S.semiMode === "gain");
    $("btn-model").textContent = d.semi ? "Transistor model" : "Tube model & fitter";
    $("btn-model").title = d.semi ? "SPICE .model of this transistor, with the simulator's parameters" : "LTspice model of this tube; fit the model to measured points";
    $("socket-head").textContent = d.semi ? "Package" : "Socket";
    renderLink(); renderCircuitList(); renderLibrary(); if (d.semi) drawPackage(d); else drawPinout(d.tube); renderHud(); drawPlot(); renderPicks();
  }

  function init() {
    $("tube-search").addEventListener("input", e => { S.query = e.target.value; renderLibrary(); });
    document.querySelectorAll("#chips-tubes .chip").forEach(ch => ch.addEventListener("click", () => {
      S.filter = ch.dataset.f; document.querySelectorAll("#chips-tubes .chip").forEach(c => c.classList.toggle("active", c === ch)); renderLibrary();
    }));
    document.querySelectorAll("#chips-semis .chip").forEach(ch => ch.addEventListener("click", () => {
      S.semiFilter = ch.dataset.s; document.querySelectorAll("#chips-semis .chip").forEach(c => c.classList.toggle("active", c === ch)); renderLibrary();
    }));
    document.querySelectorAll("#lib-tabs button").forEach(b => b.addEventListener("click", () => { S.lib = b.dataset.lib; renderLibrary(); }));
    document.querySelectorAll("#semi-modes button").forEach(b => b.addEventListener("click", () => { S.semiMode = b.dataset.m; renderAll(); }));
    $("btn-csv").addEventListener("click", () => { const d = current(); download(`${d.semi ? d.name : d.tube.commonName}${d.semi && S.semiMode !== "output" ? "-" + S.semiMode : ""}-curves.csv`.replace(/[^A-Za-z0-9_.-]/g, "_"), curvesCsv(d), "text/csv"); });
    ["traj", "pa", "pa70", "bias"].forEach(k => { const el = $("opt-" + k); el.checked = S.opts[k]; el.addEventListener("change", () => { S.opts[k] = el.checked; drawPlot(); }); });
    initPicker();
    initZoom();
    window.addEventListener("resize", drawPlot);
    // tube list and readout widths: drag the edges (double-click resets)
    Panels.columns(document.querySelector("main"), { key: "tracer", minViewport: 1000, minCenter: 360,
      cols: [{ index: 0, side: "left", def: 250, min: 180, max: 520 }, { index: 2, side: "right", def: 270, min: 200, max: 600 }],
      template: w => `${w[0]}px 1fr ${w[1]}px` });
    // the plot also changes size when the legend below it wraps to another line: redraw,
    // so clicks map onto the plot as it is shown
    if (window.ResizeObserver) { let size = ""; new ResizeObserver(() => { const c = $("plot"), k = c.clientWidth + "x" + c.clientHeight; if (k !== size) { size = k; drawPlot(); } }).observe($("plot")); }
    $("btn-open-cad").addEventListener("click", () => ToolWindows.open("circuit_sandbox.html"));
    $("btn-model").addEventListener("click", openModelModal);
    $("btn-png").addEventListener("click", () => { const a = document.createElement("a"); a.href = $("plot").toDataURL("image/png"); const d = current(); a.download = (d.semi ? d.name : d.tube.commonName) + "-curves.png"; a.click(); });
    $("btn-modal-close").addEventListener("click", () => { $("model-modal").hidden = true; });
    $("btn-model-copy").addEventListener("click", () => { const t = $("model-text"); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand("copy"); } });
    $("btn-model-download").addEventListener("click", () => { const d = current(); download((d.semi ? d.name : d.tube.commonName).replace(/[^A-Za-z0-9]/g, "_") + (d.semi ? ".lib" : ".sub"), $("model-text").value); });
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

  window.TubeTracer = { state: S, renderAll, fitKoren, current, vgFor,
    toScreen: (va, ia) => { const g = geom(); return g && { x: g.X(va), y: g.Y(ia) }; }, view: () => { const g = geom(); return g && { v0: g.v0, v1: g.v1, i0: g.i0, i1: g.i1, vaMax: g.vaMax, iaMax: g.iaMax }; },
    // a tube's Ia at (Va, Vg); a transistor's IC at (VCE, IB) or ID at (VDS, VGS)
    iaOf: (va, vg) => { const d = current(); return d.semi ? (d.dev.bip ? SC.bjt(d.dev, va, vg).ic : SC.fet(d.dev, va, vg)) : iaOf(d, va, vg); },
    picks: () => pick.list.map(m => { const p = pointOf(m), d = current(); return p && { ...m, ...p, ...(d.semi ? describeSemi(d, p) : describePoint(p)) }; }),
    plot: () => { const d = current(); return d.semi ? semiPlot(d) : null; }, csv: () => curvesCsv(current()) };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
