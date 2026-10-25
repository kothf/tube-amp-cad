/* The Board window's side panels: the parts list (search, unplaced parts, the pour round the parts),
   the inspector of whatever is selected (part, track, via, text, hole, pour, keep-out, several), the
   rule-check list and the layers panel, all redrawn by renderPanels() after each change. */
(function (root) {
  "use strict";
  // app: what this part needs from board-app.js; returns what board-app.js uses of it
  root.BoardPanels = function (app) {
    const { $, B, CHECK_NAMES, LAYER_INFO, NOTE, S, alignParts, boardShape, centerOn, centreOnSheet, classOf, commit, defaultNet, deleteSel, errors, esc, fit, groundPlane, highlightNet, isLocked, isSel, kv, lockSel, lockedNote, moveOnSheet, netName, netOfTrack, onBoardKeys, onSheet, openRules, openSetup, partPreview, pourAround, render, selItems, selectPart, setLayer, showY, trackWidth } = app;
    function renderPanels() {
      const host = $("parts"), M = S.model;
      if (!M) { host.innerHTML = `<p class="help">The parts arrive from the Circuit CAD.</p>`; $("parts-count").textContent = ""; }
      else {
        const unplaced = new Set(S.drc.filter(d => d.kind === "unplaced").map(d => d.msg.split(" ")[0]));
        const row = g => `<button class="item${isSel("part", g.key) ? " active" : ""}" data-key="${esc(g.key)}" title="${esc(g.ref)} ${esc(g.value || "")} · ${esc(g.fp ? g.fp.name : "")}"><span>${esc(g.ref)}</span><em>${esc(g.value || (g.fp ? g.fp.name : ""))}</em></button>`;
        const q = (S.find || "").trim().toLowerCase(), hit = g => !q || [g.ref, g.value, g.fp && g.fp.name].some(t => String(t || "").toLowerCase().includes(q));
        // an exact reference first, then references that start with it, then anything that contains it
        const rank = g => { const r = g.ref.toLowerCase().replace(/'+$/, ""); return !q ? 0 : r === q ? 0 : r.startsWith(q) ? 1 : 2; };
        const on = M.parts.filter(g => !unplaced.has(g.ref) && hit(g)).sort((a, b) => rank(a) - rank(b)), off = M.parts.filter(g => unplaced.has(g.ref) && hit(g)).sort((a, b) => rank(a) - rank(b));
        host.innerHTML = (q && !on.length && !off.length ? `<p class="help">No part matches “${esc(S.find)}”.</p>` : "") + (off.length ? `<button class="btn" id="btn-arrange" style="width:100%;margin:2px 0 6px" title="Put the parts waiting below the board where they sit in the schematic (the schematic's extent mapped onto the board), each in the free spot nearest its place: a starting point that follows the signal">Place all on the board</button><h2>To place <small>${off.length}</small></h2>${off.map(row).join("")}` : "") + `<h2>On the board <small>${on.length}</small></h2>${on.map(row).join("")}`;
        $("parts-count").textContent = `${M.parts.length}`;
        host.querySelectorAll(".item").forEach(b => b.addEventListener("click", () => { const g = M.parts.find(x => x.key === b.dataset.key); selectPart(g); centerOn(g.place.x, g.place.y); renderPanels(); }));
        const ab = $("btn-arrange");
        if (ab) ab.onclick = () => { const left = B.arrange(S.board, M, off.map(g => g.key), S.netlist); commit(left ? `${left} part${left > 1 ? "s" : ""} did not fit: make the board larger` : `Placed ${off.length} parts where they sit in the schematic, so the signal runs across the board as on the sheet`); fit(); };
      }
      renderInspector();
      const dh = $("drc"), list = S.drc.slice().sort((a, b) => NOTE.includes(a.kind) - NOTE.includes(b.kind) || String(a.kind).localeCompare(String(b.kind)));
      $("drc-count").textContent = list.length ? String(list.length) : "";
      // grouped by kind once the list grows: errors first, then warnings
      const KN = { ...CHECK_NAMES, unplaced: "Parts not placed", check: "To check", short: "Shorts", edge: "Board edge" }, grouped = list.length > 6;
      let lastK = null;
      dh.innerHTML = list.length ? list.slice(0, 200).map((d, i) => {
        const head = grouped && d.kind !== lastK ? `<div class="drc-group"><span>${esc(KN[d.kind] || d.kind)}</span><span>${list.filter(x => x.kind === d.kind).length}</span></div>` : ""; lastK = d.kind;
        return head + `<button class="drc ${NOTE.includes(d.kind) && d.kind !== "unplaced" ? "check" : d.kind}" data-i="${i}" title="Click: show it on the board">${esc(d.msg)}${d.between ? ` <span class="help">(${esc(d.between.join(" – "))})</span>` : ""}</button>`;
      }).join("") : `<p class="help">${M ? "No problems." : ""}</p>`;
      dh.querySelectorAll(".drc").forEach(b => b.addEventListener("click", () => { const d = list[+b.dataset.i]; if (S.view.scale < 8) S.view.scale = 8; centerOn(d.x, d.y); }));
      renderLayers(); renderNets();
    }
    // nets: class, pads, connections still to route, routed length; click to highlight
    function renderNets() {
      const host = $("nets"), M = S.model;
      if (!M || !S.conn) { host.innerHTML = `<p class="help">The nets arrive from the Circuit CAD.</p>`; $("nets-count").textContent = ""; return; }
      const nets = [...new Set(M.pads.filter(p => p.net !== null).map(p => p.net))], todo = {}, len = {};
      S.conn.rats.forEach(r => { todo[r.net] = (todo[r.net] || 0) + 1; });
      S.board.tracks.forEach((t, i) => { const n = netOfTrack(i); if (n === null) return; for (let k = 0; k + 1 < t.pts.length; k++) len[n] = (len[n] || 0) + Math.hypot(t.pts[k + 1][0] - t.pts[k][0], t.pts[k + 1][1] - t.pts[k][1]); });
      const pour = new Set(S.fills.filter(f => !f.tear).map(f => f.net));
      const rows = nets.map(n => ({ n, name: netName(n), cls: classOf(n), pads: M.pads.filter(p => p.net === n).length, todo: todo[n] || 0, len: len[n] || 0, I: (S.amps || {})[n] || 0 }))
        .filter(r => (r.pads > 1 || r.len) && (!(S.find || "").trim() || r.name.toLowerCase().includes(S.find.trim().toLowerCase()))).sort((a, b) => (b.todo > 0) - (a.todo > 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
      $("nets-count").textContent = String(rows.length);
      host.innerHTML = `<p class="help">Click a net to highlight it (again: off), or point at a pad and press the key left of 1 (\`).</p>` + rows.map(r => `<button class="net${r.n === S.netHL ? " active" : ""}" data-n="${esc(r.n)}" title="${esc(r.name)}: ${r.pads} pads, ${r.len.toFixed(1)} mm of track${pour.has(r.n) ? ", copper pour" : ""}${r.I ? `, ${B.fmtA(r.I)} DC: ${B.currentWidth(r.I, S.board.rules, S.board.stackup)} mm wide at least` : ""}">
        <span class="nm">${esc(r.name)}${r.I >= 0.001 ? ` <small class="help">${B.fmtA(r.I)}</small>` : ""}</span><span class="cls cls-${r.cls}">${r.cls}</span><span class="${r.todo ? "todo" : "done"}">${r.todo ? `${r.todo} to route` : pour.has(r.n) ? "pour ✓" : "✓"}</span></button>`).join("");
      host.querySelectorAll(".net").forEach(b => b.addEventListener("click", () => { const n = isNaN(+b.dataset.n) ? b.dataset.n : +b.dataset.n; highlightNet(n); }));
    }
    // layers: colour, visibility, active copper layer (click its name), "only" shows that layer alone
    function renderLayers() {
      const lh = $("layers");
      lh.innerHTML = LAYER_INFO.map(([k, t, c]) => `<div class="layer${k === S.layer ? " active" : ""}" data-l="${k}"><input type="checkbox" ${S.show[k] ? "checked" : ""} aria-label="Show ${t}"><span class="sw" style="background:${c}"></span><span class="nm" title="${k.endsWith("Cu") ? "Make it the active layer for new tracks (V)" : t}">${t}</span>${k === S.layer ? `<span class="tag">active</span>` : "<span></span>"}<button class="solo" title="Show only this layer (again: show all)">only</button></div>`).join("");
      lh.querySelectorAll(".layer").forEach(row => {
        const k = row.dataset.l;
        row.querySelector("input").addEventListener("change", e => { S.show[k] = e.target.checked; render(); });
        row.querySelector(".nm").addEventListener("click", () => { if (k.endsWith("Cu")) { S.show[k] = true; setLayer(k); } });
        row.querySelector(".solo").addEventListener("click", () => {
          const only = LAYER_INFO.every(([j]) => S.show[j] === (j === k));
          LAYER_INFO.forEach(([j]) => { S.show[j] = only ? true : j === k; });
          if (!only && k.endsWith("Cu")) setLayer(k); else { renderLayers(); render(); }
        });
      });
    }
    function field(label, value, onSet, type) {
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<span>${label}</span>`;
      let el;
      if (Array.isArray(type)) { el = document.createElement("select"); type.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; el.appendChild(o); }); el.value = String(value); el.addEventListener("change", () => onSet(el.value)); }
      else { el = document.createElement("input"); el.value = value; el.addEventListener("change", () => { const n = type === "text" ? el.value : parseFloat(String(el.value).replace(",", ".")); if (type !== "text" && !isFinite(n)) { el.classList.add("invalid"); return; } onSet(n); }); el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); }); }
      row.appendChild(el); return row;
    }
    const lockField = o => field("Position", o.locked ? "locked" : "free", v => { if (v === "locked") o.locked = true; else delete o.locked; commit(); }, [["free", "Free"], ["locked", "Locked (L)"]]);
    // SMD: the parts' surface-mount versions (their default SMD footprint) or back to through-hole.
    // Parts that stay through-hole (valves, transformers, power cases) leave it off and greyed.
    function smdField(gs) {
      const can = gs.filter(g => g.smdFp), on = can.filter(g => B.isSmd(S.board.parts[g.key].fp));
      const row = document.createElement("div"); row.className = "row";
      row.innerHTML = `<span>SMD${gs.length > 1 && can.length ? ` <small class="help">${can.length} of ${gs.length} can be</small>` : ""}</span>`;
      const lab = document.createElement("label"), el = document.createElement("input");
      lab.style.cssText = "display:flex;align-items:center;gap:6px"; el.type = "checkbox"; el.style.width = "auto";
      el.checked = can.length > 0 && on.length === can.length; el.indeterminate = on.length > 0 && on.length < can.length; el.disabled = !can.length;
      lab.title = can.length ? "Surface-mount: pads on the part's side only (no holes), the SMD package's 3D model, paste layers and a placement file in the Gerbers" : "This part has no SMD version here: it stays through-hole";
      lab.appendChild(el); lab.appendChild(document.createTextNode(can.length ? "surface-mount" : "through-hole only"));
      el.addEventListener("change", () => {
        can.forEach(g => { const bp = S.board.parts[g.key]; if (el.checked !== B.isSmd(bp.fp)) bp.fp = el.checked ? g.smdFp : g.defaultFp; });
        commit(`${can.length > 1 ? can.length + " parts" : can[0].ref}: ${el.checked ? "SMD" : "through-hole"}${el.checked ? " — check the tracks to them: SMD pads are on the part's side only" : ""}`);
      });
      row.appendChild(lab); return row;
    }
    const delBtn = () => { const b = document.createElement("button"); b.className = "btn"; b.textContent = "Delete (Del)"; b.onclick = deleteSel; return b; };
    function renderInspector() {
      const h = $("inspector"); h.innerHTML = "";
      const R = S.board.rules, o = S.board.outline, s = S.sel;
      if (s && s.kind === "part" && S.model) {
        const g = S.model.parts.find(x => x.key === s.key); if (!g) { S.sel = null; return renderInspector(); }
        const bp = S.board.parts[g.key];
        h.innerHTML = `<div class="insp-title">${esc(g.ref)} <small class="help">${esc(g.value)}</small></div>`;
        // the footprints of the kind it is now: through-hole, or SMD (the checkbox switches)
        const smd = B.isSmd(bp.fp);
        h.appendChild(smdField([g]));
        const ff = field("Footprint", bp.fp, v => { bp.fp = v; commit(); }, g.options.filter(n => B.isSmd(n) === smd).map(n => { const f = B.footprint(n); return [n, f ? `${n} — ${f.title.replace(/^(.{0,48}).*$/, "$1")}` : n]; })); ff.classList.add("wide"); h.appendChild(ff);
        partPreview(h, g);
        h.appendChild(field("X (mm)", +bp.x.toFixed(3), v => { bp.x = v; commit(); }));
        h.appendChild(field("Y (mm)", +showY(bp.y).toFixed(3), v => { bp.y = showY(v); commit(); }));
        h.appendChild(field("Rotation", bp.rot || 0, v => { bp.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
        h.appendChild(field("Side", bp.side || "F", v => { bp.side = v; commit(); }, [["F", "Top"], ["B", "Bottom (mirrored)"]]));
        h.appendChild(lockField(bp));
        // star grounding: which ground return this part's ground pads belong to
        const gr = S.gg && S.gg.byPart.get(g.key);
        if (gr) {
          const stages = [...new Set([...S.gg.byPart.values()].map(v => v.auto).concat(S.model.parts.filter(x => x.type === "tube").map(x => x.ref)))].filter(v => !B.RETURNS.includes(v)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          h.appendChild(field("Ground return", bp.ground || "", v => { if (v) bp.ground = v; else delete bp.ground; commit(`${g.ref}'s ground goes with ${v || gr.auto + " (auto)"} to the star point`); },
            [["", `Auto: ${gr.auto}`]].concat(B.RETURNS.concat(stages).map(v => [v, /^VL/.test(v) ? `Stage ${v}` : v]))));
        }
        const pinCheck = B.PINOUT[g.members[0].params.model];
        h.insertAdjacentHTML("beforeend", `<p class="help">${esc(g.fp.title)}${B.isOffboard(g) ? " — a chassis-mounted part: wire it to these pads" : ""}.</p>` +
          (pinCheck && pinCheck[1] === "verify" ? `<p class="help warn">Check pinout: makers differ for the ${esc(g.members[0].params.model)}.</p>` : "") +
          `<h2>Pads</h2><div class="pads">${S.model.pads.filter(p => p.part === g.key).map(p => `<div><span>${esc(p.num)}${p.name !== p.num ? " " + esc(p.name) : ""}</span><span>${esc(p.netName || "—")}</span></div>`).join("")}</div>`);
        return;
      }
      if (s && s.kind === "track") {
        const t = S.board.tracks[s.i]; if (!t) { S.sel = null; return renderInspector(); }
        const it = S.conn && S.conn.items.find(x => x.kind === "track" && x.ti === s.i), net = it ? it.net : null;
        let len = 0; for (let k = 0; k + 1 < t.pts.length; k++) len += Math.hypot(t.pts[k + 1][0] - t.pts[k][0], t.pts[k + 1][1] - t.pts[k][1]);
        h.innerHTML = `<div class="insp-title">Track</div>` + kv("Net", esc(net === null ? "not connected" : netName(net)), net === "short" ? "bad" : "") + kv("Class", `${classOf(net)} · ${trackWidth(net)} mm`) + kv("Length", len.toFixed(2) + " mm");
        h.appendChild(field("Layer", t.layer, v => { t.layer = v; commit(); }, [["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
        h.appendChild(field("Width (mm)", t.w, v => { if (v > 0) { t.w = v; commit(); } }));
        const I = net !== null && net !== "short" ? (S.amps || {})[net] : 0, need = B.currentWidth(I, R, S.board.stackup);
        if (I) h.insertAdjacentHTML("beforeend", kv("DC current", `${B.fmtA(I)} · needs ${need} mm`, need > t.w ? "bad" : "ok"));
        h.appendChild(lockField(t)); h.appendChild(delBtn()); return;
      }
      if (s && s.kind === "multi") {
        const ts = s.tracks.map(i => S.board.tracks[i]).filter(Boolean), n = selItems().length, nl = selItems().filter(([k, id]) => isLocked(k, id)).length;
        const what = [[s.parts.length, "part"], [ts.length, "track"], [s.vias.length, "via"], [s.texts.length, "text"], [s.holes.length, "hole"]].filter(([c]) => c).map(([c, w]) => `${c} ${w}${c > 1 ? "s" : ""}`).join(", ");
        h.innerHTML = `<div class="insp-title">${n} selected</div><p class="help">${what}${nl ? ` · ${nl} locked` : ""}. Drag one to move them all; Space turns them, arrows nudge (Shift: ×10), L locks.</p>`;
        if (s.parts.length && S.model) { const gs = s.parts.map(k => S.model.parts.find(g => g.key === k)).filter(g => g && S.board.parts[g.key]); if (gs.length) h.appendChild(smdField(gs)); }
        if (s.parts.length >= 2) {
          h.insertAdjacentHTML("beforeend", `<h2>Align parts</h2><div class="align">${[["left", "⇤ Left"], ["hcenter", "↔ Centre"], ["right", "Right ⇥"], ["top", "⤒ Top"], ["vcenter", "↕ Middle"], ["bottom", "Bottom ⤓"]].map(([k, t]) => `<button class="btn" data-al="${k}">${t}</button>`).join("")}</div>` +
            (s.parts.length >= 3 ? `<div class="align">${[["hdist", "Spread across"], ["vdist", "Spread down"]].map(([k, t]) => `<button class="btn" data-al="${k}">${t}</button>`).join("")}</div>` : ""));
          h.querySelectorAll("[data-al]").forEach(b => { b.onclick = () => alignParts(b.dataset.al); });
          const pa = document.createElement("button"); pa.className = "btn"; pa.style.cssText = "width:100%;margin-top:4px";
          pa.textContent = `+ ${defaultNet()} pour round these parts`; pa.title = `A copper pour of ${defaultNet()} on the active layer (${S.layer}), round the selected parts 2 mm out; it keeps clear of other nets' copper by itself, so it shorts nothing`;
          pa.onclick = () => { const P = pourAround(s.parts); if (!P) return; S.board.zones.push({ net: defaultNet(), layer: S.layer, pts: P, thermal: true, gap: 0.5, spoke: 0.8 }); S.sel = { kind: "zone", i: S.board.zones.length - 1 }; commit(`${defaultNet()} pour round ${s.parts.length} parts on ${S.layer}: drag its corners to shape it`); };
          h.appendChild(pa);
        }
        if (ts.length) {
          const len = ts.reduce((a, t) => a + t.pts.slice(1).reduce((b, p, k) => b + Math.hypot(p[0] - t.pts[k][0], p[1] - t.pts[k][1]), 0), 0);
          h.insertAdjacentHTML("beforeend", kv("Track length", len.toFixed(1) + " mm") + kv("Widths", [...new Set(ts.map(t => t.w))].join(", ") + " mm"));
          h.appendChild(field("Set track width (mm)", ts[0].w, v => { if (v > 0) { ts.forEach(t => { t.w = v; }); commit(`Width ${v} mm on ${ts.length} tracks`); } }));
        }
        const row = document.createElement("div"); row.style.cssText = "display:flex;gap:6px;margin-top:8px";
        const lk = document.createElement("button"); lk.className = "btn"; lk.textContent = nl === n ? "Unlock (L)" : "Lock (L)"; lk.onclick = lockSel;
        row.appendChild(lk); row.appendChild(delBtn()); h.appendChild(row); return;
      }
      if (s && s.kind === "keepout") {
        const k = S.board.keepouts[s.i]; if (!k) { S.sel = null; return renderInspector(); }
        const L = B.koLayers(k), yes = [["yes", "Not allowed"], ["no", "Allowed"]];
        h.innerHTML = `<div class="insp-title">Keep-out area</div><p class="help">Nothing it forbids may enter it: the check reports it, routing refuses it, pours leave it empty. Typical: under a power transformer, round a mains entry, by a heater.</p>`;
        h.appendChild(field("Name", k.name || "", v => { k.name = v; commit(); }, "text"));
        h.appendChild(field("Layers", L.length === 2 ? "both" : L[0], v => { k.layers = v === "both" ? ["F.Cu", "B.Cu"] : [v]; commit(); }, [["both", "Both copper layers"], ["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
        [["tracks", "Tracks"], ["vias", "Vias"], ["pour", "Copper pour"], ["parts", "Parts"]].forEach(([key, t]) => h.appendChild(field(t, (key === "parts" ? !!k.parts : k[key] !== false) ? "yes" : "no", v => { k[key] = v === "yes"; commit(); }, yes)));
        h.insertAdjacentHTML("beforeend", `<p class="help">Drag a corner to move it; drag the <b>+</b> on an edge to add one; double-click a corner to remove it.</p>`);
        h.appendChild(lockField(k)); h.appendChild(delBtn()); return;
      }
      if (s && s.kind === "zone") {
        const z = S.board.zones[s.i]; if (!z) { S.sel = null; return renderInspector(); }
        const f = S.fills.find(x => x.zone === s.i), nets = S.model ? [...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort((a, b) => (b === "GND") - (a === "GND") || a.localeCompare(b, undefined, { numeric: true })) : [z.net];
        if (!nets.includes(z.net)) nets.unshift(z.net);
        h.innerHTML = `<div class="insp-title">Copper pour</div>` + (f ? kv("Pieces", f.pieces + (f.islands ? ` · ${f.islands} island${f.islands > 1 ? "s" : ""} removed` : "")) : "");
        h.appendChild(field("Net", z.net, v => { z.net = v; commit(); }, nets.map(n => [n, n])));
        h.appendChild(field("Layer", z.layer, v => { z.layer = v; commit(); }, [["F.Cu", "Top copper"], ["B.Cu", "Bottom copper"]]));
        h.appendChild(field("Area", z.pts ? "poly" : "board", v => { if (v === "board") { z.pts = null; } else if (!z.pts) z.pts = boardShape(); commit(); }, [["board", "The whole board (follows its size)"], ["poly", "Its own outline (drag the corners)"]]));
        if (z.pts) h.insertAdjacentHTML("beforeend", kv("Corners", z.pts.length));
        const shp = document.createElement("div"); shp.className = "align"; shp.style.gridTemplateColumns = "1fr 1fr";
        [["around", "Round the parts", "The smallest outline round every part on the board, 2 mm out; the pour keeps clear of the other nets' copper by itself"],
         ["rect", "Board rectangle", "A rectangle over the whole board, with four corners to drag"]].forEach(([k, t, tip]) => {
          const b = document.createElement("button"); b.className = "btn"; b.textContent = t; b.title = tip;
          b.onclick = () => { if (z.locked) { lockedNote(); return; } const P = k === "around" ? pourAround(onBoardKeys()) : boardShape(); if (P) { z.pts = P; commit(k === "around" ? `Pour round the parts: ${P.length} corners` : "Pour over the whole board: drag its corners"); } };
          shp.appendChild(b);
        });
        h.appendChild(shp);
        h.insertAdjacentHTML("beforeend", `<p class="help">Drag a corner to move it; drag the <b>+</b> in the middle of an edge to add a corner; double-click a corner (or drop it onto its neighbour) to remove it. Drag the outline, or inside the selected pour, to move it all.</p>`);
        h.appendChild(field("Pads of its net", z.thermal === false ? "solid" : "thermal", v => { z.thermal = v === "thermal"; commit(); }, [["thermal", "Thermal reliefs (easy to solder)"], ["solid", "Solid (more current)"]]));
        h.appendChild(field("Thermal gap (mm)", z.gap || 0.5, v => { if (v > 0) { z.gap = v; commit(); } }));
        h.appendChild(field("Spoke width (mm)", z.spoke || 0.8, v => { if (v > 0) { z.spoke = v; commit(); } }));
        h.appendChild(lockField(z));
        h.insertAdjacentHTML("beforeend", `<p class="help">Keeps each other net's clearance (by its class), the edge clearance and the mounting holes clear. Pieces that reach nothing are removed.</p>`);
        h.appendChild(delBtn()); return;
      }
      if (s && s.kind === "via") {
        const v = S.board.vias[s.i]; if (!v) { S.sel = null; return renderInspector(); }
        h.innerHTML = `<div class="insp-title">Via</div>`;
        h.appendChild(field("X (mm)", v.x, n => { v.x = n; commit(); })); h.appendChild(field("Y (mm)", showY(v.y), n => { v.y = showY(n); commit(); }));
        h.appendChild(field("Drill (mm)", v.drill || R.viaDrill, n => { if (n > 0) { v.drill = n; commit(); } })); h.appendChild(field("Pad (mm)", v.pad || R.viaPad, n => { if (n > 0) { v.pad = n; commit(); } }));
        h.appendChild(lockField(v));
        if (S.model) { const nets = [""].concat([...new Set(S.model.pads.filter(p => p.net !== null).map(p => p.netName))].sort()); h.appendChild(field("Net (stitching)", v.net || "", n => { v.net = n || undefined; commit(); }, nets.map(n => [n, n || "from its tracks"]))); }
        h.appendChild(delBtn()); return;
      }
      if (s && s.kind === "hole") {
        const hl = S.board.holes[s.i]; if (!hl) { S.sel = null; return renderInspector(); }
        h.innerHTML = `<div class="insp-title">Mounting hole</div>`;
        h.appendChild(field("X (mm)", hl.x, n => { hl.x = n; commit(); })); h.appendChild(field("Y (mm)", showY(hl.y), n => { hl.y = showY(n); commit(); }));
        h.appendChild(field("Diameter (mm)", hl.d, n => { if (n > 0) { hl.d = n; commit(); } }));
        h.appendChild(field("Plating", hl.plated ? "yes" : "no", v => { if (v === "yes") hl.plated = true; else { delete hl.plated; delete hl.pad; delete hl.net; } commit(); }, [["no", "Not plated (NPTH)"], ["yes", "Plated, with a copper ring (PTH)"]]));
        if (hl.plated) {
          h.appendChild(field("Ring Ø (mm)", B.holeRing(hl), n => { if (n > hl.d) { hl.pad = n; commit(); } }));
          const nets = S.model ? [...new Set(Object.values(S.model.names))].sort((a, b) => (a === "GND" ? -1 : b === "GND" ? 1 : a.localeCompare(b))) : [];
          h.appendChild(field("Net", hl.net || "", v => { if (v) hl.net = v; else delete hl.net; commit(); }, [["", "None (the screw only)"]].concat(nets.map(n => [n, n]))));
          h.insertAdjacentHTML("beforeend", `<p class="help">Plated: a copper ring on both sides, bare of solder mask, drilled with the plated holes. Give it a net (GND for a grounded chassis screw) and a pour of that net joins it; otherwise it keeps every net's clearance as chassis copper.</p>`);
        } else h.insertAdjacentHTML("beforeend", `<p class="help">Not plated: drilled separately (NPTH). The dashed ring is the copper clearance (the screw is at chassis potential).</p>`);
        h.appendChild(lockField(hl)); h.appendChild(delBtn()); return;
      }
      if (s && s.kind === "text") {
        const t = S.board.texts[s.i]; if (!t) { S.sel = null; return renderInspector(); }
        h.innerHTML = `<div class="insp-title">Text</div>`;
        h.appendChild(field("Text", t.text, v => { if (v) { t.text = v; commit(); } }, "text"));
        h.appendChild(field("Height (mm)", t.size, v => { if (v > 0.3) { t.size = v; commit(); } }));
        h.appendChild(field("Layer", t.layer, v => { t.layer = v; commit(); }, [["F.SilkS", "Top silkscreen"], ["B.SilkS", "Bottom silkscreen (mirrored)"], ["F.Cu", "Top copper"], ["B.Cu", "Bottom copper (mirrored)"]]));
        h.appendChild(field("Rotation", t.rot || 0, v => { t.rot = +v; commit(); }, [["0", "0°"], ["1", "90°"], ["2", "180°"], ["3", "270°"]]));
        h.appendChild(lockField(t)); h.appendChild(delBtn()); return;
      }
      const M = S.model, c = S.conn, errs = errors();
      h.innerHTML = `<div class="insp-title">Board</div>` + kv("Size", `${o.w} × ${o.h} mm${o.r ? `, r ${o.r}` : ""}`) +
        kv("Stack", `2 layers · ${S.board.stackup.thickness} mm · ${S.board.stackup.copper} µm`) +
        (M ? kv("Parts", `${M.parts.length - S.drc.filter(d => d.kind === "unplaced").length} placed of ${M.parts.length}`) + kv("Tracks · vias · holes", `${S.board.tracks.length} · ${S.board.vias.length} · ${S.board.holes.length}`) +
          kv("To route", c ? c.unrouted : "—", c && c.unrouted ? "" : "ok") + kv("Rule violations", errs, errs ? "bad" : "ok") : "") +
        `<h2>Rules in force</h2>` + kv("Clearance · HV", `${R.clearance} · ${R.hvClearance} mm`) + kv("Tracks: signal · power", `${R.track} · ${R.power} mm`) + kv(`High-voltage nets (> ${R.hvVolts} V)`, S.hv.size);
      const wrap = document.createElement("div"); wrap.style.cssText = "display:flex;gap:6px;margin-top:8px";
      const b1 = document.createElement("button"); b1.className = "btn"; b1.textContent = "Board setup…"; b1.onclick = openSetup;
      const b2 = document.createElement("button"); b2.className = "btn"; b2.textContent = "Design rules…"; b2.onclick = openRules;
      wrap.appendChild(b1); wrap.appendChild(b2); h.appendChild(wrap);
      const at = onSheet();
      if (at) {
        h.insertAdjacentHTML("beforeend", `<h2>On the sheet</h2><p class="help">Where the origin (the board's bottom-left corner) lies from the sheet's bottom-left corner. Drag the board's edge to move it; that locks the sheet.</p>`);
        h.appendChild(field("X (mm)", at[0], v => moveOnSheet(v, at[1])));
        h.appendChild(field("Y (mm)", at[1], v => moveOnSheet(at[0], v)));
        const c = document.createElement("button"); c.className = "btn"; c.textContent = "Centre on the sheet"; c.title = "Put the board back in the middle of the sheet, above the title block"; c.onclick = centreOnSheet; if ((S.board.sheet || {}).locked) h.appendChild(c);
      }
      if (M) {
        const gp = document.createElement("button"); gp.className = "btn"; gp.style.marginTop = "6px";
        gp.textContent = `+ ${defaultNet()} plane (bottom)`;
        gp.title = "A copper pour of the ground net over the whole bottom layer, with clearance to everything else and thermal reliefs on its pads";
        gp.onclick = () => groundPlane("B.Cu");
        const gr = document.createElement("button"); gr.className = "btn"; gr.style.marginTop = "6px";
        gr.textContent = `+ ${defaultNet()} pour round the parts`;
        gr.title = `A ${defaultNet()} pour on the active layer (${S.layer}) round every part on the board, 2 mm out; it keeps every other net's clearance, so it shorts nothing. Drag its corners to shape it`;
        gr.onclick = () => { const P = pourAround(onBoardKeys()); if (!P) return; S.board.zones.push({ net: defaultNet(), layer: S.layer, pts: P, thermal: true, gap: 0.5, spoke: 0.8 }); S.sel = { kind: "zone", i: S.board.zones.length - 1 }; commit(`${defaultNet()} pour round the parts on ${S.layer}: drag its corners, or the + on an edge for a new corner`); };
        const gw = document.createElement("div"); gw.style.cssText = "display:flex;flex-wrap:wrap;gap:6px"; gw.appendChild(gp); gw.appendChild(gr); h.appendChild(gw);
      }
    }
    return { renderLayers, renderNets, renderPanels };
  };
})(window);
