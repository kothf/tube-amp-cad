/* =============================================================================
   BOARD DESIGN — autorouting with Freerouting (no DOM, Node-testable). The board goes
   out as a Specctra DSN design and the routes come back from a Specctra SES session:
     toDsn(board, model, conn, clr, opts) -> { text, nets, skipped, stubs }
     fromSes(text, board, dsn, names)      -> { tracks, vias, nets }
   Freerouting runs on the user's computer, or one on the local network (its API
   server); the Board window posts the DSN to it (route) and adds what comes back.
   Clearances: every net gets clearance classes of its own, one for its tracks and vias
   (t<i>) and one for its pads (p<i>), and the clearance matrix holds what
   clearanceRules asks between each pair of nets: the net classes and IPC-2221B by the
   voltage between them. Two exceptions of the design-rule check are carried over:
   under a valve socket's body a track may pass the socket's pins at their own spacing
   (each such pin has a class of its own, p<i>.<k>), and a pad crowded by its
   footprint's neighbours gets an escape stub (s<i>) to where the full clearance holds.
   Units: the DSN is in µm with y up; the board is in mm with y down.
   Depends on: board-core.js
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const um = v => +(v * 1000).toFixed(1);
  const q = s => `"${String(s).replace(/"/g, "'")}"`;
  const pt = (x, y) => `${um(x)} ${um(-y)}`;
  const DEFAULT_URL = "http://127.0.0.1:37864";
  const MARGIN = 0.05;
  // Freerouting draws round copper as octagons round the circle: a stub's far end keeps a little more
  const END_MARGIN = 0.3;

  // parts entirely outside the outline (still waiting below the board) stay out of the design
  function onBoard(board, model) {
    const C = B(), keep = new Set();
    model.parts.forEach(g => {
      if (!g.place || !g.fp) return;
      const c = [[g.fp.box[0], g.fp.box[1]], [g.fp.box[2], g.fp.box[1]], [g.fp.box[0], g.fp.box[3]], [g.fp.box[2], g.fp.box[3]]].map(p => C.place(p, g.place));
      if (c.some(([x, y]) => C.edgeDist(x, y, board.outline) >= 0)) keep.add(g.key);
    });
    return keep;
  }
  // a pad's copper as a padstack: round, an oval (a path with the pad's width) or a rectangle a
  // little larger than the board's own capsule for it (the checks treat a rectangle that way).
  // layers: the copper layers it is on (an SMD pad: its side only; the name tells them apart)
  function padstack(p) {
    const r = Math.min(p.w, p.h) / 2, layers = p.layers || B().COPPER, sfx = layers.length === 1 ? (layers[0] === "B.Cu" ? "_B" : "_F") : "";
    let ps;
    if (p.shape === "rect") { const gx = p.w / 2 + 0.15 * r, gy = p.h / 2 + 0.15 * r; ps = { name: `R${um(2 * gx)}x${um(2 * gy)}`, shape: L => `(rect ${L} ${um(-gx)} ${um(-gy)} ${um(gx)} ${um(gy)})` }; }
    else if (Math.abs(p.w - p.h) < 1e-6) ps = { name: `C${um(p.w)}`, shape: L => `(circle ${L} ${um(p.w)})` };
    else { const l = Math.max(p.w, p.h) / 2 - r, hz = p.w >= p.h; ps = { name: `O${um(p.w)}x${um(p.h)}`, shape: L => `(path ${L} ${um(2 * r)} ${hz ? `${um(-l)} 0 ${um(l)} 0` : `0 ${um(-l)} 0 ${um(l)}`})` }; }
    return { name: ps.name + sfx, shape: ps.shape, layers };
  }
  // names Freerouting reads back unchanged: letters, digits and a few signs
  function namer() {
    const used = new Set();
    return s => { let b = String(s).replace(/[^A-Za-z0-9.+]/g, "") || "X", n = b, k = 2; while (used.has(n)) n = b + "." + k++; used.add(n); return n; };
  }

  /** Escape stubs. A track may enter a pad as close to the same footprint's other pads as that pad
      itself is (the checks allow it for the segment that ends in the pad), but nowhere else: a
      router keeping one clearance everywhere cannot reach a noval socket's anode pin past its
      neighbours. So each such pad of a net to route gets a short straight track of its own first,
      out from the footprint (or at an angle near that) to where the full clearance holds; the
      router starts from its end. Returns [{ layer, w, pts, netKey, pad }] */
  function escapes(board, model, conn, pads, route, widthOf, need, skip) {
    const C = B(), R = board.rules, items = conn.items, out = [];
    const capOf = p => { const r = Math.min(p.w, p.h) / 2, l = Math.max(p.w, p.h) / 2 - r, hz = p.w >= p.h; return { s: hz ? [p.x - l, p.y, p.x + l, p.y] : [p.x, p.y - l, p.x, p.y + l], r: p.shape === "rect" ? r * 1.15 : r }; };
    const gap = (a, b) => C.segSeg(a.s, b.s) - a.r - b.r;
    const byPart = new Map(); pads.forEach(p => { if (!byPart.has(p.part)) byPart.set(p.part, []); byPart.get(p.part).push(p); });
    const reached = p => { const i = model.pads.indexOf(p), it = items[i]; return !!it && items.some(x => x.kind !== "pad" && x.cluster === it.cluster); };
    byPart.forEach(list => {
      const cx = list.reduce((s, p) => s + p.x, 0) / list.length, cy = list.reduce((s, p) => s + p.y, 0) / list.length;
      list.forEach(p => {
        if (!route.has(p.net) || reached(p) || skip.has(p)) return;
        const pc = capOf(p), wd = widthOf(p.net);
        const crowd = list.filter(q => q !== p && q.net !== p.net && gap(pc, capOf(q)) < need(p.net, q.net));
        if (!crowd.length) return;
        // out from the footprint's centre; for a pad in the middle, away from its crowding neighbours
        let ux = p.x - cx, uy = p.y - cy;
        if (Math.hypot(ux, uy) < 1e-6) crowd.forEach(q => { ux += p.x - q.x; uy += p.y - q.y; });
        if (Math.hypot(ux, uy) < 1e-6) { ux = 0; uy = 1; }
        const a0 = Math.atan2(uy, ux), turns = [0, 15, -15, 30, -30, 45, -45, 60, -60, 90, -90];
        // on the bottom when it fits there, else on the top; an SMD pad's on its own layer
        let best = null;
        for (const L of p.layers && p.layers.length === 1 ? p.layers : ["B.Cu", "F.Cu"]) {
          for (const dt of turns) {
            const a = a0 + dt * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
            for (let t = pc.r; t <= pc.r + 20 && !best; t += 0.1) {
              const e = [+(p.x + dx * t).toFixed(3), +(p.y + dy * t).toFixed(3)], seg = { s: [p.x, p.y, e[0], e[1]], r: wd / 2 }, end = { s: [e[0], e[1], e[0], e[1]], r: wd / 2 };
              if (C.edgeDist(e[0], e[1], board.outline) - wd / 2 < R.edgeClearance + 0.05) break;
              let ok = true;
              for (const it of items) {
                const n = it.kind === "pad" ? it.pad.net : it.net;
                if (n === p.net || !it.layers.includes(L)) continue;
                const rq = need(p.net, n);
                if (it.kind === "pad" && it.pad.part === p.part) {
                  // the stub ends in its own pad: it may pass its neighbours as close as that pad is; its far end keeps the full clearance
                  if (gap(seg, it) < Math.min(rq, gap(pc, it) - 0.02) || gap(end, it) < rq + END_MARGIN) { ok = false; break; }
                } else if (gap(seg, it) < rq) { ok = false; break; }
              }
              if (ok) for (const st of out) if (st.layer === L && st.netKey !== p.net && gap(seg, { s: [st.pts[0][0], st.pts[0][1], st.pts[1][0], st.pts[1][1]], r: st.w / 2 }) < need(p.net, st.netKey)) { ok = false; break; }
              if (ok) best = { layer: L, w: wd, pts: [[p.x, p.y], e], netKey: p.net, pad: p.ref + "-" + p.num };
            }
            if (best) break;
          }
          if (best) break;
        }
        if (best) out.push(best);
      });
    });
    return out;
  }

  /** The board as a Specctra DSN design. conn: BoardCore.connectivity of the board (the nets of
      its tracks and vias), clr: BoardCore.clearanceRules. Nets with a copper pour, and the ground
      with star grounding, are left to the user (their pads stay as obstacles). Returns { text,
      nets: { dsn name -> net key }, skipped: [net names left out] } */
  function toDsn(board, model, conn, clr, opts) {
    const C = B(), R = board.rules, o = opts || {}, keep = onBoard(board, model), cc = C.COPPER;
    const pads = model.pads.filter(p => keep.has(p.part));
    const names = model.names, netName = n => names[n] || "N" + n;
    // the nets to route: two or more pads on the board, no pour of their own
    const poured = new Set((board.zones || []).map(z => z.net));
    const count = new Map(); pads.forEach(p => { if (p.net !== null) count.set(p.net, (count.get(p.net) || 0) + 1); });
    const skipped = [], route = new Set();
    count.forEach((n, net) => {
      const nm = netName(net);
      if (n < 2) return;
      if (poured.has(nm) || (R.ground === "star" && nm === "GND") || (o.skip && o.skip.has(nm))) { skipped.push(nm); return; }
      route.add(net);
    });
    // every net on the board (routed or not) has its clearance classes; index 0 is no net
    const nets = [...new Set(pads.map(p => p.net).concat(conn.items.filter(it => it.kind !== "pad").map(it => it.net)).filter(n => n !== null && n !== "short"))];
    const idx = new Map(nets.map((n, i) => [n, i + 1])), cls = n => (idx.has(n) ? idx.get(n) : 0), ks = [null, ...nets];
    // Freerouting keeps the clearance between its own outlines of round copper: a little more to be sure
    const need = (a, b) => +(clr.need(ks[a], ks[b]).c + MARGIN).toFixed(3);
    const nameOf = new Map(), dsnNames = {}, nm = namer();
    nets.forEach(n => { const s = nm(netName(n)); nameOf.set(n, s); dsnNames[s] = n; });
    const amps = o.amps || {};
    const widthOf = n => Math.max(C.classRule(C.netClassOf(n, names, o.hv, R), R).track, Math.ceil(C.currentWidth(amps[n], R, board.stackup) * 20) / 20);
    // valve socket pins (with the design rule on): under the socket's body a track may pass a pin as
    // close as its neighbour is; that is near the pin anyway, so each such pin gets a clearance class
    // of its own (p<net>.<k>) with that spacing as the most any track needs from it
    const sp = C.socketPads(board, model), capped = pads.filter(p => sp.has(p)).map((p, k) => ({ p, name: `p${cls(p.net)}.${k + 1}`, net: cls(p.net), cap: sp.get(p).gap - 0.02 }));
    const capOf = new Map(capped.map(c => [c.p, c]));
    const stubs = o.noStubs ? [] : escapes(board, model, conn, pads, route, widthOf, (a, b) => clr.need(a, b).c + MARGIN, sp);
    const pinClass = p => (capOf.has(p) ? capOf.get(p).name : `p${cls(p.net)}`), stubNets = new Set(stubs.map(t => cls(t.netKey)));
    const byPart = new Map(); pads.forEach(p => { if (!byPart.has(p.part)) byPart.set(p.part, []); byPart.get(p.part).push(p); });
    const out = [];
    const w = s => out.push(s);
    w(`(pcb ${q(o.title || "board")}`);
    w(`  (parser (string_quote ") (space_in_quoted_tokens on) (host_cad "Tube Amp CAD") (host_version ${q(o.version || "dev")}))`);
    w(`  (resolution um 10)`);
    w(`  (unit um)`);
    w(`  (structure`);
    cc.forEach((L, i) => w(`    (layer ${L} (type signal) (property (index ${i})))`));
    const poly = C.outlinePoly(board.outline, 0);
    w(`    (boundary (path pcb 0 ${poly.concat([poly[0]]).map(([x, y]) => pt(x, y)).join(" ")}) (clearance_class edge))`);
    // mounting holes: the screw is at chassis potential, a plated ring without a net is chassis copper
    (board.holes || []).forEach(h => {
      if (h.plated && h.net) return;
      const d = h.plated ? C.holeRing(h) : h.d;
      cc.forEach(L => w(`    (keepout "" (circle ${L} ${um(d)} ${pt(h.x, h.y)}) (clearance_class chassis))`));
    });
    (board.keepouts || []).forEach(k => {
      const P = k.pts.concat([k.pts[0]]).map(([x, y]) => pt(x, y)).join(" ");
      C.koLayers(k).forEach(L => {
        if (k.tracks !== false) w(`    (keepout ${q(k.name || "")} (polygon ${L} 0 ${P}) (clearance_class zero))`);
        else if (k.vias !== false) w(`    (via_keepout ${q(k.name || "")} (polygon ${L} 0 ${P}) (clearance_class zero))`);
      });
    });
    w(`    (via "V${um(R.viaPad)}")`);
    w(`    (rule`);
    w(`      (width ${um(R.track)})`);
    w(`      (clearance ${um(R.clearance)})`);
    // the clearance matrix: tracks to tracks, tracks to pads, the edge, the chassis, keep-outs
    for (let a = 0; a < ks.length; a++) {
      for (let b = a; b < ks.length; b++) if (a !== b || a === 0) w(`      (clearance ${um(need(a, b))} (type t${a}_t${b}))`);
      for (let b = 0; b < ks.length; b++) if (a !== b || a === 0) w(`      (clearance ${um(need(a, b))} (type t${a}_p${b}))`);
      capped.forEach(c => { if (c.net !== a || a === 0) w(`      (clearance ${um(Math.max(0, Math.min(need(a, c.net), c.cap)))} (type t${a}_${c.name}))`); });
      // escape stubs (s<net>) are fixed and checked already: only new tracks keep clear of them
      if (stubNets.has(a)) {
        for (let b = 0; b < ks.length; b++) if (a !== b) w(`      (clearance ${um(need(a, b))} (type s${a}_t${b}))`);
        for (let b = 0; b < ks.length; b++) w(`      (clearance 0 (type s${a}_p${b}))`);
        capped.forEach(c => w(`      (clearance 0 (type s${a}_${c.name}))`));
        stubNets.forEach(b => w(`      (clearance 0 (type s${a}_s${b}))`));
        w(`      (clearance ${um(R.edgeClearance)} (type edge_s${a}))`);
      }
      w(`      (clearance ${um(R.edgeClearance)} (type edge_t${a}))`);
      w(`      (clearance ${um(Math.max(R.clearance, clr.toChassis(ks[a]).c))} (type chassis_t${a}))`);
      w(`      (clearance 0 (type zero_t${a}))`);
    }
    w(`    )`);
    w(`  )`);
    // parts: each as its own image, its pads where they are on the board (rotation and side done)
    const pn = namer(), comps = [];
    byPart.forEach((list, key) => {
      const g = model.parts.find(x => x.key === key), ref = pn(g.ref || "P"), pinN = namer();
      comps.push({ ref, x: g.place.x, y: g.place.y, pins: list.map(p => ({ p, name: pinN(p.num), ps: padstack(p) })) });
    });
    const plated = (board.holes || []).map((h, i) => ({ h, i })).filter(({ h }) => h.plated && h.net);
    w(`  (placement`);
    comps.forEach(c => w(`    (component ${q("IMG_" + c.ref)} (place ${c.ref} ${pt(c.x, c.y)} front 0 (lock_type position)${c.pins.map(x => ` (pin ${x.name} (clearance_class ${pinClass(x.p)}))`).join("")}))`));
    const holeNet = h => nets.find(n => netName(n) === h.net);
    plated.forEach(({ h, i }) => w(`    (component "IMG_H${i + 1}" (place H${i + 1} ${pt(h.x, h.y)} front 0 (lock_type position) (pin 1 (clearance_class p${cls(holeNet(h))}))))`));
    w(`  )`);
    w(`  (library`);
    const stacks = new Map();
    comps.forEach(c => {
      w(`    (image ${q("IMG_" + c.ref)}`);
      c.pins.forEach(x => { stacks.set(x.ps.name, x.ps); w(`      (pin ${x.ps.name} ${x.name} ${um(x.p.x - c.x)} ${um(-(x.p.y - c.y))})`); });
      w(`    )`);
    });
    plated.forEach(({ h, i }) => { const ps = { name: `C${um(C.holeRing(h))}`, shape: L => `(circle ${L} ${um(C.holeRing(h))})` }; stacks.set(ps.name, ps); w(`    (image "IMG_H${i + 1}" (pin ${ps.name} 1 0 0))`); });
    stacks.forEach(ps => w(`    (padstack ${ps.name} ${(ps.layers || cc).map(L => `(shape ${ps.shape(L)})`).join(" ")} (attach off))`));
    w(`    (padstack "V${um(R.viaPad)}" ${cc.map(L => `(shape (circle ${L} ${um(R.viaPad)}))`).join(" ")} (attach off))`);
    w(`  )`);
    // nets and their classes: the width each net's tracks need (its class, or its DC current)
    w(`  (network`);
    const pinsOf = new Map();
    comps.forEach(c => c.pins.forEach(x => { if (route.has(x.p.net)) { if (!pinsOf.has(x.p.net)) pinsOf.set(x.p.net, []); pinsOf.get(x.p.net).push(`${c.ref}-${x.name}`); } }));
    plated.forEach(({ h, i }) => { const n = holeNet(h); if (route.has(n)) pinsOf.get(n) && pinsOf.get(n).push(`H${i + 1}-1`); });
    nets.forEach(n => w(`    (net ${q(nameOf.get(n))}${pinsOf.has(n) ? ` (pins ${pinsOf.get(n).join(" ")})` : ""})`));
    // each net's vias keep its tracks' clearances: a via of its own (V<i>) in a via rule of its own
    nets.forEach(n => w(`    (via V${cls(n)} "V${um(R.viaPad)}" t${cls(n)})`));
    nets.forEach(n => w(`    (via_rule R${cls(n)} V${cls(n)})`));
    nets.forEach(n => w(`    (class c${cls(n)} ${q(nameOf.get(n))} (clearance_class t${cls(n)}) (via_rule R${cls(n)}) (rule (width ${um(widthOf(n))})))`));
    w(`  )`);
    // what is routed already stays as it is
    w(`  (wiring`);
    const trackNet = new Map(), viaNet = new Map();
    conn.items.forEach(it => { if (it.kind === "track" && !trackNet.has(it.ti)) trackNet.set(it.ti, it.net); else if (it.kind === "via") viaNet.set(it.vi, it.net); });
    const netTag = n => (idx.has(n) ? ` (net ${q(nameOf.get(n))})` : "");
    board.tracks.forEach((t, ti) => w(`    (wire (path ${t.layer} ${um(t.w)} ${t.pts.map(([x, y]) => pt(x, y)).join(" ")})${netTag(trackNet.get(ti))} (clearance_class t${cls(trackNet.get(ti))}) (type protect))`));
    stubs.forEach(t => w(`    (wire (path ${t.layer} ${um(t.w)} ${t.pts.map(([x, y]) => pt(x, y)).join(" ")}) (net ${q(nameOf.get(t.netKey))}) (clearance_class s${cls(t.netKey)}) (type protect))`));
    board.vias.forEach((v, vi) => w(`    (via "V${um(R.viaPad)}" ${pt(v.x, v.y)}${netTag(viaNet.get(vi))} (clearance_class t${cls(viaNet.get(vi))}) (type protect))`));
    w(`  )`);
    w(`)`);
    return { text: out.join("\n") + "\n", nets: dsnNames, skipped, stubs };
  }

  // a small s-expression reader: lists of tokens (strings keep their quotes off)
  function parse(text) {
    text = String(text).replace(/\(string_quote\s+"\s*\)/g, "(string_quote dq)");   // the quote character itself, alone
    const re = /\s*(?:(\()|(\))|"((?:[^"])*)"|([^\s()"]+))/gy, stack = [[]];
    let m;
    while ((m = re.exec(text)) && m[0].length) {
      if (m[1]) stack.push([]);
      else if (m[2]) { const l = stack.pop(); if (!stack.length) break; stack[stack.length - 1].push(l); }
      else stack[stack.length - 1].push(m[3] !== undefined ? m[3] : m[4]);
    }
    return stack[0][0];
  }
  const find = (l, k) => (Array.isArray(l) ? l.find(x => Array.isArray(x) && x[0] === k) : null);
  const all = (l, k) => (Array.isArray(l) ? l.filter(x => Array.isArray(x) && x[0] === k) : []);
  const UNIT = { mm: 1, um: 1e-3, mil: 0.0254, inch: 25.4, cm: 10 };

  /** The routes of a Specctra SES session as board tracks and vias (mm, y down). Wires and vias
      the board has already (sent as protected) come back too and are left out. d: what toDsn
      returned (its net names; its escape stubs, kept where a route reaches them), names: the
      model's net names. Returns { tracks, vias, nets: Set of the net keys routed } */
  function fromSes(text, board, d, names) {
    const nets = (d && d.nets) || {}, stubs = (d && d.stubs) || [];
    const s = parse(text); if (!s || s[0] !== "session") throw new Error("Not a Specctra session (.ses) file");
    const routes = find(s, "routes"); if (!routes) throw new Error("The session has no routes");
    const res = find(routes, "resolution") || find(s, "resolution") || ["resolution", "mil", "1"];
    const k = (UNIT[String(res[1]).toLowerCase()] || 1) / (+res[2] || 1);
    const X = v => +(+v * k).toFixed(4), Y = v => +(-v * k).toFixed(4);
    const R = board.rules, tracks = [], vias = [], routed = new Set();
    const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
    const sameTrack = (t, layer, pts) => t.layer === layer && t.pts.length === pts.length && (t.pts.every((p, i) => same(p, pts[i])) || t.pts.every((p, i) => same(p, pts[pts.length - 1 - i])));
    const had = (layer, pts) => stubs.some(t => sameTrack(t, layer, pts)) || board.tracks.some(t => t.layer === layer && t.pts.length === pts.length && (t.pts.every((p, i) => same(p, pts[i])) || t.pts.every((p, i) => same(p, pts[pts.length - 1 - i]))));
    const net = find(routes, "network_out");
    all(net, "net").forEach(n => {
      const key = nets && Object.prototype.hasOwnProperty.call(nets, n[1]) ? nets[n[1]] : null, name = key === null ? undefined : (names && names[key]) || n[1];
      all(n, "wire").forEach(wi => {
        const p = find(wi, "path") || find(wi, "polyline_path"); if (!p) return;
        const nums = p.slice(3).filter(x => !Array.isArray(x)).map(Number), pts = [];
        for (let i = 0; i + 1 < nums.length; i += 2) { const q2 = [X(nums[i]), Y(nums[i + 1])]; if (!pts.length || !same(pts[pts.length - 1], q2)) pts.push(q2); }
        if (pts.length < 2 || had(p[1], pts) || (find(wi, "type") || [])[1] === "protect") return;
        tracks.push({ layer: p[1], w: X(+p[2]), pts, net: name });
        if (key !== null) routed.add(key);
      });
      all(n, "via").forEach(v => {
        const x = X(+v[2]), y = Y(+v[3]);
        if (board.vias.some(b => same([b.x, b.y], [x, y])) || (find(v, "type") || [])[1] === "protect") return;
        vias.push({ x, y, drill: R.viaDrill, pad: R.viaPad, net: name });
      });
    });
    // an escape stub stays where a new track or via of its net touches it
    const seg = (a, b) => [a[0], a[1], b[0], b[1]];
    stubs.forEach(st => {
      const name = (names && names[st.netKey]) || undefined, s0 = seg(st.pts[0], st.pts[1]);
      // how far along the stub the new copper reaches it: the stub is cut there (no dangling end)
      const L2 = (s0[2] - s0[0]) ** 2 + (s0[3] - s0[1]) ** 2, along = (x, y) => Math.max(0, Math.min(1, ((x - s0[0]) * (s0[2] - s0[0]) + (y - s0[1]) * (s0[3] - s0[1])) / L2));
      let far = -1;
      tracks.forEach(t => { if (t.net !== name || t.layer !== st.layer) return; t.pts.forEach((p, i) => { if (i && B().segSeg(s0, seg(t.pts[i - 1], p)) <= (t.w + st.w) / 2 + 1e-3) far = Math.max(far, along(p[0], p[1]), along(t.pts[i - 1][0], t.pts[i - 1][1])); }); });
      vias.forEach(v => { if (v.net === name && B().segDist(s0[0], s0[1], s0[2], s0[3], v.x, v.y) <= v.pad / 2 + st.w / 2 + 1e-3) far = Math.max(far, along(v.x, v.y)); });
      if (far < 0) return;
      const e = [+(s0[0] + (s0[2] - s0[0]) * far).toFixed(4), +(s0[1] + (s0[3] - s0[1]) * far).toFixed(4)];
      if (Math.hypot(e[0] - s0[0], e[1] - s0[1]) > 1e-3) tracks.push({ layer: st.layer, w: st.w, pts: [st.pts[0].slice(), e], net: name });
    });
    return { tracks, vias, nets: routed };
  }

  /** Freerouting leaves the wires of a connection it gave up on: new tracks with an end that
      touches nothing, and vias joining one layer only, go (again until none is left). got:
      fromSes's result, changed in place; pads: the model's pads */
  function prune(got, board, pads) {
    const C = B(), R = board.rules;
    const padIts = pads.map(p => { const r = Math.min(p.w, p.h) / 2, l = Math.max(p.w, p.h) / 2 - r, hz = p.w >= p.h; return { s: hz ? [p.x - l, p.y, p.x + l, p.y] : [p.x, p.y - l, p.x, p.y + l], r: p.shape === "rect" ? r * 1.15 : r, layers: p.layers || C.COPPER }; });
    const holeIts = (board.holes || []).filter(h => h.plated).map(h => ({ s: [h.x, h.y, h.x, h.y], r: C.holeRing(h) / 2, layers: C.COPPER }));
    const segs = (t, src) => t.pts.slice(1).map((p, i) => ({ s: [t.pts[i][0], t.pts[i][1], p[0], p[1]], r: t.w / 2, layers: [t.layer], src }));
    const viaIt = (v, src) => ({ s: [v.x, v.y, v.x, v.y], r: (v.pad || R.viaPad) / 2, layers: C.COPPER, src });
    for (let pass = 0; pass < 50; pass++) {
      const all = padIts.concat(holeIts, board.tracks.flatMap(t => segs(t, null)), board.vias.map(v => viaIt(v, null)), got.tracks.flatMap(t => segs(t, t)), got.vias.map(v => viaIt(v, v)));
      const at = (x, y, L, self, r) => all.some(it => it.src !== self && it.layers.includes(L) && C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y) <= it.r + r + 1e-6);
      const tracks = got.tracks.filter(t => [t.pts[0], t.pts[t.pts.length - 1]].every(([x, y]) => at(x, y, t.layer, t, t.w / 2)));
      const vias = got.vias.filter(v => C.COPPER.every(L => at(v.x, v.y, L, v, (v.pad || R.viaPad) / 2)));
      if (tracks.length === got.tracks.length && vias.length === got.vias.length) break;
      got.tracks = tracks; got.vias = vias;
    }
    return got;
  }

  // ---------------------------------------------------------------------------
  // Freerouting's API server on the user's computer
  // ---------------------------------------------------------------------------
  const PROFILE_KEY = "tubecad_freerouting_profile";
  function profileId() {
    let id = null;
    try { id = localStorage.getItem(PROFILE_KEY); } catch (e) { /* no storage */ }
    if (!id) { id = root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0"); try { localStorage.setItem(PROFILE_KEY, id); } catch (e) { /* no storage */ } }
    return id;
  }
  /** An address as typed (192.168.1.20, nuc:37864, http://…) as Freerouting's base URL; port 37864 unless given */
  function address(text) {
    let t = String(text || "").trim(); if (!t) return DEFAULT_URL;
    if (!/^https?:\/\//i.test(t)) t = "http://" + t;
    try { const u = new URL(t); if (!u.port && !/^https?:\/\/[^/]+:\d+/i.test(t)) u.port = "37864"; return u.origin; } catch (e) { return null; }
  }
  const base = url => address(url) || DEFAULT_URL;
  // another computer on the local network: Chrome asks the user once before a page may reach it
  const local = url => { try { return !/^(127\.|localhost$|\[::1\]$)/.test(new URL(base(url)).hostname) ? { targetAddressSpace: "local" } : {}; } catch (e) { return {}; } };
  async function within(ms, f) {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), ms || 1500);
    try { return await f(ctl && ctl.signal); } finally { if (t) clearTimeout(t); }
  }
  /** Why Freerouting does or does not answer at url, within ms: { ok, why } with why one of
      "ok", "cors" (it answers but does not allow this page: cors_origins), "status" (an answer that is not
      Freerouting's status, with code), "down" (no answer: not running, the API server off, another address,
      or the browser refused the address) */
  async function probe(url, ms) {
    const u = base(url) + "/v1/system/status";
    try {
      return await within(ms, async signal => {
        const r = await fetch(u, { signal, ...local(url) });
        let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
        return j && j.status === "OK" ? { ok: true, why: "ok" } : { ok: false, why: "status", code: r.status };
      });
    } catch (e) { /* refused, timed out or blocked by CORS: an opaque request tells them apart */ }
    try { await within(ms, signal => fetch(u, { mode: "no-cors", signal, ...local(url) })); return { ok: false, why: "cors" }; }
    catch (e) { return { ok: false, why: "down" }; }
  }
  /** true when Freerouting answers at url (its status, within ms) */
  async function available(url, ms) { return (await probe(url, ms)).ok; }
  /** Routes a DSN design: the SES text and Freerouting's report */
  async function route(url, dsn, opts) {
    const o = opts || {};
    const r = await fetch(base(url) + "/v1/autoroute", {
      method: "POST", signal: o.signal, ...local(url),
      headers: { "Content-Type": "application/json", "Freerouting-Profile-ID": profileId(), "Freerouting-Environment-Host": `TubeAmpCAD/${o.version || "dev"}` },
      body: JSON.stringify({ file_content: dsn, output_formats: ["SES", "DRC_SUMMARY"], timeout_seconds: o.timeout || 120, router_settings: { automatic_neckdown: false } })
    });
    let j = null; try { j = await r.json(); } catch (e) { /* not JSON */ }
    if (r.status === 401) throw new Error("Freerouting wants an API key: start it with --api_server.authentication.enabled=false");
    if (!r.ok && r.status !== 202) throw new Error((j && (j.error || j.message)) || `Freerouting answered ${r.status}`);
    const ses = j && j.outputs && (j.outputs.SES || j.outputs.ses);
    if (!ses) throw new Error((j && (j.message || j.error)) || "Freerouting sent no routes");
    return { ses, status: j.status, unrouted: j.unrouted_connections, violations: j.clearance_violations, seconds: j.duration_seconds, message: j.message };
  }
  /** The command that starts Freerouting's API server for this page (origin: the page's) */
  function command(origin) {
    return `java -jar freerouting.jar --gui.enabled=false --api_server.enabled=true --api_server.authentication.enabled=false --api_server.cors_origins=${origin || "https://aerocat.tech"}`;
  }
  /** The same with Freerouting's Docker image, listening on the network */
  function dockerCommand(origin) {
    return `docker run -d --name freerouting --restart unless-stopped -p 37864:37864 ghcr.io/freerouting/freerouting:latest java -jar /app/freerouting-executable.jar --gui.enabled=false --api_server.enabled=true --api_server.endpoints=http://0.0.0.0:37864 --api_server.authentication.enabled=false --api_server.cors_origins=${origin || "https://aerocat.tech"}`;
  }

  root.BoardRoute = { toDsn, fromSes, prune, parse, probe, available, route, command, dockerCommand, address, DEFAULT_URL };
})(typeof window !== "undefined" ? window : globalThis);
