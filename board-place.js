/* =============================================================================
   BOARD DESIGN — placement repair for routing (no DOM, Node-testable). When Freerouting
   leaves connections unrouted, the parts near them are nudged so the next pass has room:
     movable(board, model, rats, opts)        -> [part keys]  the parts that may move
     nudge(board, model, keys, opts)          -> { moved, cost0, cost1, tried, taken }
     spread(board, model, keys, opts)         -> { moved, wire0, wire1, over, iters, failed }  the parts over the whole board
     escape(board, model, conn, rats, opts)   -> per part: can its open pins get out (max-flow), what walls them in
     passage(board, model, conn, rats, opts)  -> per open connection: is there still a way from end to end
     bridge(board, model, conn, rats, opts)   -> a track for the first open connection a grid path reaches (Lee)
     exact(board, model, conn, rats, opts)    -> a window round an open connection routed afresh by SAT (needs board-sat.js)
   nudge moves the given parts in board.parts (shift on the 1.27 mm grid, turn by 90°, swap
   two parts of one footprint) by simulated annealing (TimberWolf, Sechen and
   Sangiovanni-Vincentelli 1985) on a cost of
     wire length (half-perimeter of each net's pads, high-voltage and heater nets double)
     + congestion (RUDY, Spindler and Johannes 2007: each net's wire, its pads' spanning
       tree, spread evenly over its pads' box; the squared excess over what a cell's
       tracks can carry on the board's layers, less what its pads take)
     + ratsnest crossings between nets (each a via, or a detour, for the router)
     + how far each part went from where it was (the layout stays the user's).
   A move is taken only when it keeps the rules the design-rule check asks of a part:
   inside the outline, courtyards apart, clear of mounting holes and part keep-outs,
   electrolytics away from hot parts, pads the clearance (by voltage) from other nets'
   pads and from locked copper. Nets with a pour, and the ground with star grounding,
   reach their pads through the pour: they count little and cross nothing.
   Depends on: board-core.js
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const GRID = 1.27, CELL = 2.54;
  // parts that stay where the user put them: valves, transformers, controls, connectors, things on panels
  const FIXED = new Set(["tube", "gasreg", "neon", "eye", "opt_se", "opt_cat", "opt_pp", "ptx", "ptx_cat", "itx", "pot", "switch", "spst", "rotary", "jack", "iec", "terminal", "header", "faston", "fuse", "heater", "star"]);
  const BIG = 1200;   // mm² of courtyard: bigger parts stay too

  // a seeded random source (mulberry32): the same board and seed give the same moves
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  // distance from segment s to box b (0 when they meet)
  function segBox(s, b) {
    const C = B(), inB = (x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
    if (inB(s[0], s[1]) || inB(s[2], s[3])) return 0;
    const P = C.boxPoly(b);
    return Math.min(...P.map((p, i) => { const q = P[(i + 1) % 4]; return C.segSeg(s, [p[0], p[1], q[0], q[1]]); }));
  }
  const area = b => (b.x2 - b.x1) * (b.y2 - b.y1);
  const inside = (b, o) => [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2]].every(([x, y]) => B().edgeDist(x, y, o) >= 0.25);

  /** The parts that may move to make room for the unrouted connections (rats: the ratsnest
      lines left): on the board (or over its edge), not locked, not a valve, transformer, control or connector,
      not huge, and within opts.radius (mm, default 8) of an unrouted line or in opts.also (a Set of keys) */
  function movable(board, model, rats, opts) {
    const o = opts || {}, R = o.radius || 8, C = B();
    return model.parts.filter(g => {
      if (!g.place || !g.fp || g.place.locked || FIXED.has(g.type)) return false;
      const b = C.partBox(g);
      if (area(b) > BIG || b.x2 <= 0 || b.y2 <= 0 || b.x1 >= board.outline.w || b.y1 >= board.outline.h) return false;   // entirely off the board: waiting to be placed
      return (o.also && o.also.has(g.key)) || rats.some(r => segBox([r.x1, r.y1, r.x2, r.y2], b) <= R);
    }).map(g => g.key);
  }

  // A placement in progress and the rules a part's place must keep: the parts (on footprints), trial
  // places pl (key -> place), the parts that count (onB: on the board), each pad's copper where its
  // part now is, and legal(k): part k may stand where pl puts it. opts: as nudge's
  function placeState(board, model, o) {
    const C = B(), R = board.rules, outl = board.outline;
    const parts = model.parts.filter(g => g.place && g.fp), byKey = new Map(parts.map(g => [g.key, g]));
    const pl = new Map(parts.map(g => [g.key, { ...g.place }]));      // the trial placements
    // on the board: not entirely off it (a panel switch may hang over the edge, its pads still count)
    const onB = new Set(parts.filter(g => { const b = C.partBox(g); return b.x2 > 0 && b.y2 > 0 && b.x1 < outl.w && b.y1 < outl.h; }).map(g => g.key));
    // pads: each part's in footprint order, with their nets
    const padsOf = new Map(); model.pads.forEach(p => { if (!padsOf.has(p.part)) padsOf.set(p.part, []); padsOf.get(p.part).push(p); });
    const local = new Map(parts.map(g => [g.key, g.fp.pads]));
    const where = (k, i) => { const q = local.get(k)[i], P = pl.get(k), [x, y] = C.place([q.x, q.y], P), odd = (P.rot || 0) & 1; return { x, y, w: odd ? q.h : q.w, h: odd ? q.w : q.h, shape: q.shape }; };
    const boxOf = k => C.partBox({ fp: byKey.get(k).fp, place: pl.get(k) });
    const hot = new Map(parts.map(g => [g.key, g.type === "electrolytic" ? "cap" : C.hotWhy(g, o.netlist, R) ? "hot" : ""]));
    const heat = R.heatGap > 0 ? R.heatGap : 10, gapC = 0.25;
    const locked = [];
    if (o.conn) o.conn.items.forEach(it => { if ((it.kind === "track" && board.tracks[it.ti] && board.tracks[it.ti].locked) || (it.kind === "via" && board.vias[it.vi] && board.vias[it.vi].locked)) locked.push(it); });
    const needC = (a, b) => (o.clr ? o.clr.need(a, b).c : Math.max(R.clearance || 0.3, 0.3));
    function legal(k) {
      const b = boxOf(k), g = byKey.get(k), side = pl.get(k).side || "F";
      if (!inside(b, outl)) return false;
      for (const q of parts) {
        if (q.key === k || !onB.has(q.key)) continue;
        const c = boxOf(q.key), hk = hot.get(k), hq = hot.get(q.key), gp = (hk === "cap" && hq === "hot") || (hk === "hot" && hq === "cap") ? heat + 0.5 : (pl.get(q.key).side || "F") === side ? gapC : -1;
        if (gp >= 0 && b.x1 < c.x2 + gp && b.x2 > c.x1 - gp && b.y1 < c.y2 + gp && b.y2 > c.y1 - gp) return false;
      }
      for (const h of board.holes || []) { const r = h.d / 2 + 1.9, dx = Math.max(b.x1 - h.x, 0, h.x - b.x2), dy = Math.max(b.y1 - h.y, 0, h.y - b.y2); if (Math.hypot(dx, dy) < r) return false; }
      for (const ko of board.keepouts || []) if (ko.parts && C.polyHitsPoly(C.boxPoly(b), ko.pts)) return false;
      // pads: the edge, other parts' pads of other nets, locked copper
      const mine = (padsOf.get(k) || []).map((p, i) => { const w = where(k, i); return { net: p.net, layers: p.smd ? [side + ".Cu"] : C.COPPER, ...C.padCapsule(w), x: w.x, y: w.y, rr: Math.max(w.w, w.h) / 2 }; });
      if (mine.some(m => C.edgeDist(m.x, m.y, outl) < (R.edgeClearance || 0.5) + m.rr)) return false;
      for (const q of parts) {
        if (q.key === k || !onB.has(q.key)) continue;
        const c = boxOf(q.key); if (c.x1 > b.x2 + 6 || c.x2 < b.x1 - 6 || c.y1 > b.y2 + 6 || c.y2 < b.y1 - 6) continue;
        const qs = pl.get(q.key).side || "F";
        for (let i = 0; i < local.get(q.key).length; i++) {
          const pq = padsOf.get(q.key)[i], w = where(q.key, i), cq = C.padCapsule(w), ql = pq.smd ? [qs + ".Cu"] : C.COPPER;
          for (const m of mine) {
            if (m.net !== null && m.net === pq.net) continue;
            if (!m.layers.some(L => ql.includes(L))) continue;
            if (C.segSeg(m.s, cq.s) - m.r - cq.r < needC(m.net, pq.net) - 1e-6) return false;
          }
        }
      }
      for (const it of locked) for (const m of mine) {
        if (it.net === m.net || !m.layers.some(L => it.layers.includes(L))) continue;
        if (C.segSeg(m.s, it.s) - m.r - it.r < needC(m.net, it.net) - 1e-6) return false;
      }
      return !!g;
    }
    return { parts, byKey, pl, onB, padsOf, local, where, boxOf, legal };
  }

  /** Nudge the parts keys (in board.parts) by simulated annealing; model: BoardCore.model of the
      board as it is. opts: { clr: BoardCore.clearanceRules, hv: Set of high-voltage nets,
      netlist (for hot parts), conn: BoardCore.connectivity (locked copper), seed, moves,
      weights: { wire, crowd, cross, move }, reach: how far (mm) a part may go }. The best placement found is left in
      board.parts. Returns { moved: [{ key, ref, from, to }], cost0, cost1, tried, taken } */
  function nudge(board, model, keys, opts) {
    const C = B(), o = opts || {}, R = board.rules, outl = board.outline, rand = rng(o.seed === undefined ? 1 : o.seed);
    const W = Object.assign({ wire: 1, crowd: 0.25, cross: 4, move: 0.4 }, o.weights || {});
    const { parts, byKey, pl, onB, padsOf, local, where, boxOf, legal } = placeState(board, model, o);
    const mov = keys.map(k => byKey.get(k)).filter(Boolean);
    if (!mov.length) return { moved: [], cost0: 0, cost1: 0, tried: 0, taken: 0 };
    const start = new Map(mov.map(g => [g.key, { ...g.place }]));
    // nets: their pads (part key, index) and how much they count
    const poured = new Set((board.zones || []).map(z => z.net)), names = model.names;
    const nets = new Map();
    parts.forEach(g => (padsOf.get(g.key) || []).forEach((p, i) => { if (p.net === null || !onB.has(g.key)) return; if (!nets.has(p.net)) nets.set(p.net, []); nets.get(p.net).push([g.key, i]); }));
    [...nets.keys()].forEach(n => { if (nets.get(n).length < 2) nets.delete(n); });
    const netList = [...nets.keys()], nIdx = new Map(netList.map((n, i) => [n, i]));
    const quiet = netList.map(n => { const nm = names[n] || String(n); return poured.has(nm) || (R.ground === "star" && nm === "GND"); });
    const weight = netList.map((n, i) => (quiet[i] ? 0.2 : (o.hv && o.hv.has(n)) || C.isHeaterNet(names[n]) ? 2 : 1));
    const netsOfPart = new Map(parts.map(g => [g.key, [...new Set((padsOf.get(g.key) || []).filter(p => nIdx.has(p.net)).map(p => nIdx.get(p.net)))]]));
    // each net's shape: box, spanning tree (segments) and its length
    function shape(ni) {
      const pts = nets.get(netList[ni]).map(([k, i]) => where(k, i));
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      pts.forEach(p => { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); });
      const segs = []; let len = 0;
      if (!quiet[ni] && pts.length <= 40) {
        const inT = [0], d = pts.map((p, j) => (j ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) : Infinity)), from = pts.map(() => 0), done = pts.map((_, j) => j === 0);
        for (let s = 1; s < pts.length; s++) {
          let j = -1; for (let q = 0; q < pts.length; q++) if (!done[q] && (j < 0 || d[q] < d[j])) j = q;
          done[j] = true; inT.push(j); len += d[j]; segs.push([pts[from[j]].x, pts[from[j]].y, pts[j].x, pts[j].y]);
          for (let q = 0; q < pts.length; q++) if (!done[q]) { const e = Math.hypot(pts[q].x - pts[j].x, pts[q].y - pts[j].y); if (e < d[q]) { d[q] = e; from[q] = j; } }
        }
      }
      return { x1, y1, x2, y2, hp: (x2 - x1) + (y2 - y1), segs, len };
    }
    const shapes = netList.map((_, i) => shape(i));
    // congestion: wire demand and track capacity per cell
    const nx = Math.max(1, Math.ceil(outl.w / CELL)), ny = Math.max(1, Math.ceil(outl.h / CELL)), demand = new Float64Array(nx * ny), cap = new Float64Array(nx * ny);
    const pitch = Math.max(0.2, (R.track || 0.5) + (R.clearance || 0.3)), layers = C.COPPER.length;
    cap.fill(layers * CELL * CELL / pitch);
    function spread(ni, sign) {
      const s = shapes[ni]; if (quiet[ni] || !s.len) return;
      const bx1 = s.x1 - pitch, by1 = s.y1 - pitch, bx2 = s.x2 + pitch, by2 = s.y2 + pitch, dens = s.len / ((bx2 - bx1) * (by2 - by1));
      const i1 = Math.max(0, Math.floor(bx1 / CELL)), i2 = Math.min(nx - 1, Math.floor(bx2 / CELL)), j1 = Math.max(0, Math.floor(by1 / CELL)), j2 = Math.min(ny - 1, Math.floor(by2 / CELL));
      for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
        const ov = (Math.min(bx2, (i + 1) * CELL) - Math.max(bx1, i * CELL)) * (Math.min(by2, (j + 1) * CELL) - Math.max(by1, j * CELL));
        if (ov > 0) demand[j * nx + i] += sign * dens * ov;
      }
    }
    function block(k, sign) {
      if (!onB.has(k)) return;
      local.get(k).forEach((q, i) => {
        const p = where(k, i), ci = Math.floor(p.x / CELL), cj = Math.floor(p.y / CELL);
        if (ci < 0 || cj < 0 || ci >= nx || cj >= ny) return;
        cap[cj * nx + ci] -= sign * (q.smd ? 1 : layers) * (p.w + pitch) * (p.h + pitch) / pitch;
      });
    }
    netList.forEach((_, i) => spread(i, 1));
    parts.forEach(g => block(g.key, 1));
    const overflow = () => { let s = 0; for (let c = 0; c < demand.length; c++) { const e = demand[c] - cap[c]; if (e > 0) s += e * e; } return s; };
    // ratsnest crossings, net against net (box test first)
    const crossSeg = (a, b) => {
      const o1 = (b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0]), o2 = (b[2] - a[0]) * (a[3] - a[1]) - (b[3] - a[1]) * (a[2] - a[0]);
      const o3 = (a[0] - b[0]) * (b[3] - b[1]) - (a[1] - b[1]) * (b[2] - b[0]), o4 = (a[2] - b[0]) * (b[3] - b[1]) - (a[3] - b[1]) * (b[2] - b[0]);
      return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
    };
    function crossPair(a, b) {
      const A = shapes[a], Bs = shapes[b];
      if (!A.segs.length || !Bs.segs.length || A.x2 < Bs.x1 || Bs.x2 < A.x1 || A.y2 < Bs.y1 || Bs.y2 < A.y1) return 0;
      let n = 0; A.segs.forEach(s => Bs.segs.forEach(t => { if (crossSeg(s, t)) n++; })); return n;
    }
    function crossInvolving(set) {
      let n = 0;
      set.forEach(a => { for (let b = 0; b < netList.length; b++) if (!(set.has(b) && b <= a) && b !== a) n += crossPair(a, b); });
      return n;
    }
    let crossings = 0; for (let a = 0; a < netList.length; a++) for (let b = a + 1; b < netList.length; b++) crossings += crossPair(a, b);
    let wire = shapes.reduce((s, sh, i) => s + weight[i] * sh.hp, 0), over = overflow();
    const disp = k => { const a = start.get(k), b = pl.get(k); return a ? Math.hypot(b.x - a.x, b.y - a.y) + (((b.rot || 0) - (a.rot || 0)) & 3 ? 1 : 0) : 0; };
    let dsum = 0;
    const cost = () => W.wire * wire + W.crowd * over + W.cross * crossings + W.move * dsum;
    // apply a change to some parts' places, keeping every sum up to date; returns the undo
    function apply(changes) {
      const ks = changes.map(c => c.k), touched = new Set(ks.flatMap(k => netsOfPart.get(k) || []));
      const before = { wire, over, crossings, dsum, shapes: new Map([...touched].map(i => [i, shapes[i]])), places: changes.map(c => ({ k: c.k, p: pl.get(c.k) })) };
      crossings -= crossInvolving(touched);
      touched.forEach(i => { spread(i, -1); wire -= weight[i] * shapes[i].hp; });
      ks.forEach(k => { block(k, -1); dsum -= disp(k); });
      changes.forEach(c => pl.set(c.k, c.p));
      ks.forEach(k => { block(k, 1); dsum += disp(k); });
      touched.forEach(i => { shapes[i] = shape(i); spread(i, 1); wire += weight[i] * shapes[i].hp; });
      crossings += crossInvolving(touched);
      over = overflow();
      return () => {
        touched.forEach(i => spread(i, -1)); ks.forEach(k => block(k, -1));
        before.places.forEach(({ k, p }) => pl.set(k, p));
        before.shapes.forEach((s, i) => { shapes[i] = s; spread(i, 1); }); ks.forEach(k => block(k, 1));
        wire = before.wire; over = before.over; crossings = before.crossings; dsum = before.dsum;
      };
    }
    // a random move: shift (up to `reach` grid steps), turn about the part's middle, or swap two alike
    const snap = v => Math.round(v / GRID) * GRID;
    function propose(reach) {
      const g = mov[Math.floor(rand() * mov.length)], P = pl.get(g.key), r = rand();
      if (r < 0.15) {
        const twins = mov.filter(q => q !== g && q.fp.name === g.fp.name && (pl.get(q.key).side || "F") === (P.side || "F"));
        if (twins.length) { const q = twins[Math.floor(rand() * twins.length)], Q = pl.get(q.key); return [{ k: g.key, p: { ...P, x: Q.x, y: Q.y, rot: Q.rot } }, { k: q.key, p: { ...Q, x: P.x, y: P.y, rot: P.rot } }]; }
      }
      if (r < 0.3) {
        const b = boxOf(g.key), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rot = ((P.rot || 0) + (rand() < 0.5 ? 1 : 3)) & 3;
        const nb = C.partBox({ fp: g.fp, place: { ...P, rot } });
        return [{ k: g.key, p: { ...P, rot, x: snap(P.x + cx - (nb.x1 + nb.x2) / 2), y: snap(P.y + cy - (nb.y1 + nb.y2) / 2) } }];
      }
      const step = () => Math.round((rand() * 2 - 1) * reach) * GRID;
      let dx = step(), dy = step(); if (!dx && !dy) dx = rand() < 0.5 ? GRID : -GRID;
      return [{ k: g.key, p: { ...P, x: +(P.x + dx).toFixed(4), y: +(P.y + dy).toFixed(4) } }];
    }
    const cost0 = cost();
    const N = o.moves || Math.min(6000, Math.max(600, 250 * mov.length));
    // the starting temperature: most uphill moves taken at first
    let ups = 0, nUp = 0;
    for (let s = 0; s < 40; s++) { const ch = propose(4), c0 = cost(), undo = apply(ch); const d = cost() - c0; undo(); if (d > 0) { ups += d; nUp++; } }
    const T0 = nUp ? -(ups / nUp) / Math.log(0.6) : 1, T1 = T0 * 0.002;
    let T = T0, cur = cost(), best = cur, bestPl = new Map(mov.map(g => [g.key, pl.get(g.key)])), tried = 0, taken = 0;
    const cool = Math.pow(T1 / T0, 1 / N);
    for (let s = 0; s < N; s++, T *= cool) {
      const reach = Math.max(1, Math.round(5 * T / T0 + 0.5)), ch = propose(reach), undo = apply(ch); tried++;
      if (!ch.every(c => legal(c.k) && (!o.reach || Math.hypot(pl.get(c.k).x - start.get(c.k).x, pl.get(c.k).y - start.get(c.k).y) <= o.reach))) { undo(); continue; }
      const c = cost(), d = c - cur;
      if (d <= 0 || rand() < Math.exp(-d / T)) { cur = c; taken++; if (c < best - 1e-9) { best = c; bestPl = new Map(mov.map(g => [g.key, pl.get(g.key)])); } }
      else undo();
    }
    // the best placement goes on the board
    const moved = [];
    mov.forEach(g => {
      const a = start.get(g.key), b = bestPl.get(g.key);
      if (Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6 || ((a.rot || 0) & 3) !== ((b.rot || 0) & 3)) {
        Object.assign(board.parts[g.key], { x: b.x, y: b.y, rot: b.rot });
        moved.push({ key: g.key, ref: g.ref, from: { x: a.x, y: a.y, rot: a.rot || 0 }, to: { x: b.x, y: b.y, rot: b.rot || 0 } });
      }
    });
    return { moved, cost0, cost1: best, tried, taken };
  }

  /** "R7 2.5 mm, C3 turned 90°": what nudge moved, in words */
  function describe(moved) {
    return moved.map(m => {
      const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y), t = ((m.to.rot - m.from.rot) & 3) * 90, bits = [];
      if (d > 1e-6) bits.push(`${+d.toFixed(1)} mm`);
      if (t) bits.push(`turned ${t === 270 ? 90 : t}°`);
      return `${m.ref} ${bits.join(", ")}`;
    }).join(", ");
  }


  // ---------------------------------------------------------------------------
  // Whole-board spread (whitespace allocation). The parts given move over the whole board, as in
  // analytic placement (ePlace, Lu et al. 2015; RePlAce, Cheng et al. 2018; Cypress, Zhang et al.
  // 2025): each part's middle is a variable; the cost is wire length (the weighted-average model,
  // Hsu et al. 2011, on the pads) plus lambda times the electrostatic energy of the parts' area
  // (each part a charge, its field found by a cosine transform of the density on 2.54 mm bins), with
  // lambda raised step by step until little area is over the bins' fill. Parts in opts.inflate count
  // bigger (up to 2.5 times their area: RePlAce's cell inflation), so a part whose pins are shut in
  // claims room round them. Fixed parts, holes and keep-outs are charges that do not move. Then each
  // part is legalized, biggest first (Tetris, NTUplace3): the nearest place on the 1.27 mm grid
  // that keeps every rule of nudge, with its turn as it was.
  // ---------------------------------------------------------------------------
  // the cosine and sine tables of an n-point transform at bin middles: c[u*n+x] = cos(pi*u*(x+0.5)/n)
  function trig(n) {
    const c = new Float64Array(n * n), s = new Float64Array(n * n);
    for (let u = 0; u < n; u++) for (let x = 0; x < n; x++) { const a = Math.PI * u * (x + 0.5) / n; c[u * n + x] = Math.cos(a); s[u * n + x] = Math.sin(a); }
    return { c, s };
  }
  // the field (ex, ey) of a charge map rho (nx by ny bins of size h) by Poisson's equation, Neumann edges
  function field(rho, nx, ny, h, T) {
    const a = new Float64Array(nx * ny), tmp = new Float64Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let u = 0; u < nx; u++) { let s = 0; for (let x = 0; x < nx; x++) s += rho[y * nx + x] * T.x.c[u * nx + x]; tmp[y * nx + u] = s; }
    for (let v = 0; v < ny; v++) for (let u = 0; u < nx; u++) { let s = 0; for (let y = 0; y < ny; y++) s += tmp[y * nx + u] * T.y.c[v * ny + y]; a[v * nx + u] = s * (u ? 2 : 1) * (v ? 2 : 1) / (nx * ny); }
    const ax = new Float64Array(nx * ny), ay = new Float64Array(nx * ny);
    for (let v = 0; v < ny; v++) for (let u = 0; u < nx; u++) {
      if (!u && !v) continue;
      const wu = Math.PI * u / (nx * h), wv = Math.PI * v / (ny * h), k = a[v * nx + u] / (wu * wu + wv * wv);
      ax[v * nx + u] = k * wu; ay[v * nx + u] = k * wv;
    }
    // ex = sum ax sin(wu x) cos(wv y), ey = sum ay cos(wu x) sin(wv y)
    const ex = new Float64Array(nx * ny), ey = new Float64Array(nx * ny), tx = new Float64Array(nx * ny), ty = new Float64Array(nx * ny);
    for (let v = 0; v < ny; v++) for (let x = 0; x < nx; x++) { let sx = 0, sy = 0; for (let u = 0; u < nx; u++) { sx += ax[v * nx + u] * T.x.s[u * nx + x]; sy += ay[v * nx + u] * T.x.c[u * nx + x]; } tx[v * nx + x] = sx; ty[v * nx + x] = sy; }
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) { let sx = 0, sy = 0; for (let v = 0; v < ny; v++) { sx += tx[v * nx + x] * T.y.c[v * ny + y]; sy += ty[v * nx + x] * T.y.s[v * ny + y]; } ex[y * nx + x] = sx; ey[y * nx + x] = sy; }
    return { ex, ey };
  }

  /** Spread the parts keys over the whole board, then legalize them (see above). opts: as nudge's,
      plus inflate (Map key -> area factor, at most 2.5), target (how full a bin may be, 0..1),
      iters (at most, default 300), halo (mm round each part, default 0.6). The new places go in
      board.parts. Returns { moved, wire0, wire1, over, iters, failed } (failed: the ref of a part
      no legal place was found for; then nothing moved) */
  function spread(board, model, keys, opts) {
    const C = B(), o = opts || {}, outl = board.outline, R = board.rules;
    const { parts, byKey, pl, onB, padsOf, where, boxOf, legal } = placeState(board, model, o);
    const mov = keys.map(k => byKey.get(k)).filter(g => g && onB.has(g.key));
    const none = { moved: [], wire0: 0, wire1: 0, over: 0, iters: 0, failed: null };
    if (!mov.length) return none;
    const idx = new Map(mov.map((g, i) => [g.key, i])), n = mov.length, halo = o.halo === undefined ? 0.6 : o.halo;
    const start = new Map(mov.map(g => [g.key, { ...g.place }]));
    // each moving part: its middle (X, Y), half sizes with the halo and inflation, the place's offset from the middle
    const X = new Float64Array(n), Y = new Float64Array(n), hw = new Float64Array(n), hh = new Float64Array(n), bw = new Float64Array(n), bh = new Float64Array(n), npin = new Float64Array(n);
    const offX = [], offY = [];
    mov.forEach((g, i) => {
      const b = boxOf(g.key), P = pl.get(g.key), f = Math.sqrt(Math.min(2.5, Math.max(1, (o.inflate && o.inflate.get(g.key)) || 1)));
      X[i] = (b.x1 + b.x2) / 2; Y[i] = (b.y1 + b.y2) / 2; offX.push(P.x - X[i]); offY.push(P.y - Y[i]);
      bw[i] = (b.x2 - b.x1) / 2; bh[i] = (b.y2 - b.y1) / 2; hw[i] = (bw[i] + halo / 2) * f; hh[i] = (bh[i] + halo / 2) * f;
    });
    const inX = (i, v) => Math.min(Math.max(v, bw[i]), outl.w - bw[i]), inY = (i, v) => Math.min(Math.max(v, bh[i]), outl.h - bh[i]);
    // nets: each pin a moving part's (index, offset from its middle) or a fixed point
    const poured = new Set((board.zones || []).map(z => z.net)), names = model.names, byNet = new Map();
    parts.forEach(g => {
      if (!onB.has(g.key)) return;
      const i = idx.has(g.key) ? idx.get(g.key) : -1;
      (padsOf.get(g.key) || []).forEach((p, j) => {
        if (p.net === null) return;
        const w = where(g.key, j);
        if (!byNet.has(p.net)) byNet.set(p.net, []);
        byNet.get(p.net).push(i >= 0 ? { i, dx: w.x - X[i], dy: w.y - Y[i] } : { i: -1, x: w.x, y: w.y });
        if (i >= 0) npin[i]++;
      });
    });
    const nets = [...byNet].filter(([, ps]) => ps.length > 1 && ps.some(p => p.i >= 0)).map(([net, ps]) => {
      const nm = names[net] || String(net), quiet = poured.has(nm) || (R.ground === "star" && nm === "GND");
      return { ps, w: quiet ? 0.2 : (o.hv && o.hv.has(net)) || C.isHeaterNet(nm) ? 2 : 1 };
    });
    // weighted-average wire length of one axis and its gradient into g
    function wa(vals, gam, gOut, wt) {
      let mx = -Infinity, mn = Infinity; for (const v of vals) { if (v > mx) mx = v; if (v < mn) mn = v; }
      let sp = 0, tp = 0, sn = 0, tn = 0; const ep = vals.map(v => Math.exp((v - mx) / gam)), en = vals.map(v => Math.exp((mn - v) / gam));
      vals.forEach((v, k) => { sp += ep[k]; tp += v * ep[k]; sn += en[k]; tn += v * en[k]; });
      const fp = tp / sp, fn = tn / sn;
      if (gOut) vals.forEach((v, k) => { gOut[k] = wt * (ep[k] / sp * (1 + (v - fp) / gam) - en[k] / sn * (1 - (v - fn) / gam)); });
      return wt * (fp - fn);
    }
    const hpwl = () => nets.reduce((s, nt) => {
      const xs = nt.ps.map(p => (p.i >= 0 ? X[p.i] + p.dx : p.x)), ys = nt.ps.map(p => (p.i >= 0 ? Y[p.i] + p.dy : p.y));
      return s + nt.w * (Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys));
    }, 0);
    // bins, the fixed charge (parts that stay, holes, part keep-outs) and the room left in each
    const h = CELL, nx = Math.max(2, Math.ceil(outl.w / h)), ny = Math.max(2, Math.ceil(outl.h / h)), T = { x: trig(nx), y: trig(ny) };
    const fixedQ = new Float64Array(nx * ny);
    const addBox = (map, x1, y1, x2, y2, k) => {
      for (let j = Math.max(0, Math.floor(y1 / h)); j <= Math.min(ny - 1, Math.floor(y2 / h)); j++) for (let i = Math.max(0, Math.floor(x1 / h)); i <= Math.min(nx - 1, Math.floor(x2 / h)); i++) {
        const ov = Math.max(0, Math.min(x2, (i + 1) * h) - Math.max(x1, i * h)) * Math.max(0, Math.min(y2, (j + 1) * h) - Math.max(y1, j * h));
        if (ov > 0) map[j * nx + i] += k * ov;
      }
    };
    parts.forEach(g => { if (onB.has(g.key) && !idx.has(g.key)) { const b = boxOf(g.key); addBox(fixedQ, b.x1, b.y1, b.x2, b.y2, 1); } });
    (board.holes || []).forEach(hl => { const r = hl.d / 2 + 1.9; addBox(fixedQ, hl.x - r, hl.y - r, hl.x + r, hl.y + r, 1); });
    (board.keepouts || []).forEach(ko => { if (!ko.parts) return; const xs = ko.pts.map(p => p[0]), ys = ko.pts.map(p => p[1]); addBox(fixedQ, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 1); });
    for (let c = 0; c < fixedQ.length; c++) fixedQ[c] = Math.min(fixedQ[c], h * h);
    let movArea = 0; for (let i = 0; i < n; i++) movArea += 4 * hw[i] * hh[i];
    const target = o.target || 1;
    // a part's charge in the bins, smoothed: a part narrower than a bin is spread over one bin's width at lower density
    const ext = i => { const ew = Math.max(hw[i], h / 2), eh = Math.max(hh[i], h / 2); return { ew, eh, d: (hw[i] * hh[i]) / (ew * eh) }; };
    function density() {
      const m = new Float64Array(nx * ny);
      for (let i = 0; i < n; i++) { const e = ext(i); addBox(m, X[i] - e.ew, Y[i] - e.eh, X[i] + e.ew, Y[i] + e.eh, e.d); }
      return m;
    }
    // the share of the moving parts' area over what the bins have left beside the fixed charge
    const overflow = m => { let s = 0; for (let c = 0; c < m.length; c++) s += Math.max(0, m[c] - Math.max(0, target * h * h - fixedQ[c])); return s / Math.max(movArea, 1e-9); };
    // the force on part i: its overlap with each bin times that bin's field
    function force(i, E, out) {
      const e = ext(i), x1 = X[i] - e.ew, x2 = X[i] + e.ew, y1 = Y[i] - e.eh, y2 = Y[i] + e.eh;
      let fx = 0, fy = 0;
      for (let j = Math.max(0, Math.floor(y1 / h)); j <= Math.min(ny - 1, Math.floor(y2 / h)); j++) for (let k = Math.max(0, Math.floor(x1 / h)); k <= Math.min(nx - 1, Math.floor(x2 / h)); k++) {
        const ov = Math.max(0, Math.min(x2, (k + 1) * h) - Math.max(x1, k * h)) * Math.max(0, Math.min(y2, (j + 1) * h) - Math.max(y1, j * h));
        fx += ov * E.ex[j * nx + k]; fy += ov * E.ey[j * nx + k];
      }
      out[0] = fx * e.d; out[1] = fy * e.d;
    }
    const wireW = o.wire === undefined ? 1 : o.wire, anchor = o.anchor || 0, X0 = X.slice(), Y0 = Y.slice();
    const wire0 = hpwl(), gx = new Float64Array(n), gy = new Float64Array(n), wx = new Float64Array(n), wy = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n), f = [0, 0];
    let lambda = 0, over = overflow(density()), it = 0;
    const iters = o.iters || 300;
    for (; it < iters; it++) {
      const gam = h * Math.min(4, Math.max(0.5, 4 * over));
      for (let i = 0; i < n; i++) { wx[i] = anchor * (X[i] - X0[i]); wy[i] = anchor * (Y[i] - Y0[i]); }
      nets.forEach(nt => {
        const xs = nt.ps.map(p => (p.i >= 0 ? X[p.i] + p.dx : p.x)), ys = nt.ps.map(p => (p.i >= 0 ? Y[p.i] + p.dy : p.y)), g1 = new Array(xs.length), g2 = new Array(xs.length);
        wa(xs, gam, g1, nt.w * wireW); wa(ys, gam, g2, nt.w * wireW);
        nt.ps.forEach((p, k) => { if (p.i >= 0) { wx[p.i] += g1[k]; wy[p.i] += g2[k]; } });
      });
      const m = density(), rho = new Float64Array(nx * ny); for (let c = 0; c < m.length; c++) rho[c] = m[c] + fixedQ[c];
      const E = field(rho, nx, ny, h, T);
      // the density gradient is minus the force; lambda starts where the two pulls are alike
      let sw = 0, sd = 0;
      for (let i = 0; i < n; i++) { force(i, E, f); gx[i] = -f[0]; gy[i] = -f[1]; sw += Math.abs(wx[i]) + Math.abs(wy[i]); sd += Math.abs(gx[i]) + Math.abs(gy[i]); }
      if (!it) lambda = sd > 1e-12 ? 0.1 * sw / sd : 1;
      over = overflow(m);
      if (it >= 40 && over < 0.1) break;
      // preconditioned (Cypress: 1 / (pins + lambda * area)), normalised steps with momentum
      let rms = 0; const px = new Float64Array(n), py = new Float64Array(n);
      for (let i = 0; i < n; i++) { const pc = 1 / Math.max(1, npin[i] + lambda * 4 * hw[i] * hh[i] * (sd > 1e-12 ? 1 : 0)); px[i] = (wx[i] + lambda * gx[i]) * pc; py[i] = (wy[i] + lambda * gy[i]) * pc; rms += px[i] * px[i] + py[i] * py[i]; }
      rms = Math.sqrt(rms / n) || 1;
      const step = 0.5 * h * Math.pow(0.99, it) + 0.15;
      for (let i = 0; i < n; i++) {
        vx[i] = 0.8 * vx[i] - step * px[i] / rms; vy[i] = 0.8 * vy[i] - step * py[i] / rms;
        X[i] = inX(i, X[i] + vx[i]); Y[i] = inY(i, Y[i] + vy[i]);
      }
      lambda *= 1.06;
    }
    // legalize, biggest first: the nearest grid place that keeps the rules, among the parts placed so far
    const snap = v => Math.round(v / GRID) * GRID;
    mov.forEach(g => onB.delete(g.key));
    const order = mov.map((g, i) => i).sort((a, b) => hw[b] * hh[b] - hw[a] * hh[a]);
    const maxR = Math.ceil(Math.max(outl.w, outl.h) / GRID);
    let failed = null;
    for (const i of order) {
      const g = mov[i], P0 = pl.get(g.key), cx = snap(X[i] + offX[i]), cy = snap(Y[i] + offY[i]);
      let done = false;
      for (let r = 0; r <= maxR && !done; r++) {
        const ring = [];
        for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) if (Math.max(Math.abs(a), Math.abs(b)) === r) ring.push([a, b]);
        ring.sort((p, s) => (p[0] * p[0] + p[1] * p[1]) - (s[0] * s[0] + s[1] * s[1]));
        for (const [a, b] of ring) {
          pl.set(g.key, { ...P0, x: +(cx + a * GRID).toFixed(4), y: +(cy + b * GRID).toFixed(4) });
          if (legal(g.key)) { done = true; break; }
        }
      }
      if (!done) { failed = g.ref; break; }
      onB.add(g.key);
    }
    if (failed) { mov.forEach(g => onB.add(g.key)); return { ...none, wire0, wire1: wire0, over, iters: it, failed }; }
    const moved = [];
    mov.forEach(g => {
      const a = start.get(g.key), b = pl.get(g.key);
      if (Math.abs(a.x - b.x) > 1e-6 || Math.abs(a.y - b.y) > 1e-6) {
        Object.assign(board.parts[g.key], { x: b.x, y: b.y });
        moved.push({ key: g.key, ref: g.ref, from: { x: a.x, y: a.y, rot: a.rot || 0 }, to: { x: b.x, y: b.y, rot: b.rot || 0 } });
      }
      const k = idx.get(g.key), bb = boxOf(g.key); X[k] = (bb.x1 + bb.x2) / 2; Y[k] = (bb.y1 + bb.y2) / 2;
    });
    return { moved, wire0, wire1: hpwl(), over, iters: it, failed: null };
  }

  // ---------------------------------------------------------------------------
  // Pin escape. Whether each pin at the end of an open connection can get a track out of its
  // part's neighbourhood, as a maximum flow (escape routing as network flow; Yan and Wong,
  // "A correct network flow model for escape routing", DAC 2009). A grid of cells one track
  // plus one clearance apart covers a window round the part on each copper layer; a cell is free
  // when a track through its middle keeps the clearance (by voltage) from other nets' copper,
  // the board edge, holes and keep-outs. Each free cell carries one track (split into an in and
  // an out node of capacity 1), steps go to the four neighbours (no diagonals: two diagonal
  // steps could cross without sharing a cell), a through-hole pin starts on both layers. The
  // flow runs from the pins to the window's edge or to the pad at the other end of the open
  // connection. Less flow than pins: some pin is shut in, and the copper next to the cells the
  // pins still reach (the minimum cut) names what shuts it in.
  // ---------------------------------------------------------------------------
  // Dinic's maximum flow on a graph of n nodes; add(u, v, cap) then run(s, t)
  function flowGraph(n) {
    const head = new Int32Array(n).fill(-1), to = [], cap = [], next = [];
    const add = (u, v, c) => { to.push(v); cap.push(c); next.push(head[u]); head[u] = to.length - 1; to.push(u); cap.push(0); next.push(head[v]); head[v] = to.length - 1; return to.length - 2; };
    const level = new Int32Array(n), it = new Int32Array(n);
    function bfs(s, t) {
      level.fill(-1); level[s] = 0; const q = [s];
      for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = head[u]; e >= 0; e = next[e]) if (cap[e] > 0 && level[to[e]] < 0) { level[to[e]] = level[u] + 1; q.push(to[e]); } }
      return level[t] >= 0;
    }
    function dfs(u, t, f) {
      if (u === t) return f;
      for (; it[u] >= 0; it[u] = next[it[u]]) {
        const e = it[u], v = to[e];
        if (cap[e] > 0 && level[v] === level[u] + 1) { const d = dfs(v, t, Math.min(f, cap[e])); if (d > 0) { cap[e] -= d; cap[e ^ 1] += d; return d; } }
      }
      return 0;
    }
    function run(s, t) {
      let flow = 0;
      while (bfs(s, t)) { it.set(head); let f; while ((f = dfs(s, t, Infinity)) > 0) flow += f; }
      return flow;
    }
    // the nodes the source still reaches in the residual graph (its side of the minimum cut)
    function reach(s) {
      const seen = new Uint8Array(n), q = [s]; seen[s] = 1;
      for (let h = 0; h < q.length; h++) { const u = q[h]; for (let e = head[u]; e >= 0; e = next[e]) if (cap[e] > 0 && !seen[to[e]]) { seen[to[e]] = 1; q.push(to[e]); } }
      return seen;
    }
    // the first used edge out of u (a forward edge with its unit spent), -1 when none
    const used = u => { for (let e = head[u]; e >= 0; e = next[e]) if (!(e & 1) && cap[e] === 0) return e; return -1; };
    return { add, run, reach, used, cap, to };
  }

  // The grid for one check: cells `pitch` apart over box on each copper layer, for tracks of
  // width w on the nets in `nets`; pins: the pads the flow starts from (index = their pin),
  // far: pads it may end in; edgeSink: the window's border counts as out. Returns the max flow,
  // which pins got out, and the walls round the cells the pins still reach
  function gridFlow(board, ctx, box, pins, far, nets, w, edgeSink) {
    const C = B(), R = board.rules, outl = board.outline, L = C.COPPER, { conn, need, pinGap, part } = ctx;
    const pitch = Math.max(0.5, w + R.clearance), first = pins[0].s;
    const x0 = first[0] - Math.ceil((first[0] - box.x1) / pitch) * pitch, y0 = first[1] - Math.ceil((first[1] - box.y1) / pitch) * pitch;
    const nx = Math.ceil((box.x2 - x0) / pitch) + 1, ny = Math.ceil((box.y2 - y0) / pitch) + 1, nc = nx * ny * L.length;
    const W = { x1: x0 - 3, y1: y0 - 3, x2: x0 + nx * pitch + 3, y2: y0 + ny * pitch + 3 };
    const near = conn.items.filter(it => (ctx.copper !== false || it.kind === "pad" || it.kind === "hole") && Math.max(it.s[0], it.s[2]) + it.r > W.x1 && Math.min(it.s[0], it.s[2]) - it.r < W.x2 && Math.max(it.s[1], it.s[3]) + it.r > W.y1 && Math.min(it.s[1], it.s[3]) - it.r < W.y2);
    const src = new Int32Array(nc).fill(-1), free = new Uint8Array(nc), wall = new Int32Array(nc).fill(-1), sink = new Uint8Array(nc);
    const walls = [], wallOf = new Map(), wallIdx = (k, mk) => { if (!wallOf.has(k)) { wallOf.set(k, walls.length); walls.push(mk()); } return wallOf.get(k); };
    const pinIdx = new Map(pins.map((it, k) => [it, k])), farSet = new Set(far);
    for (let l = 0; l < L.length; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = (l * ny + j) * nx + i, cx = x0 + i * pitch, cy = y0 + j * pitch;
      let block = -1;
      if (C.edgeDist(cx, cy, outl) < (R.edgeClearance || 0.5) + w / 2 + (ctx.strict ? pitch / 2 : 0)) block = wallIdx("edge", () => ({ what: "the board edge", kind: "edge" }));
      for (const it of near) {
        if (!it.layers.includes(L[l])) continue;
        const d = C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], cx, cy);
        if (pinIdx.has(it) && d <= it.r) { src[c] = pinIdx.get(it); continue; }
        if (farSet.has(it) && d <= it.r) { sink[c] = 1; continue; }
        if (block >= 0 || (it.net !== null && nets.has(it.net))) continue;
        let gapNeed = Math.max(...[...nets].map(n => need(n, it.net === "short" ? null : it.net)));
        if (it.kind === "pad" && ctx.own.has(it.pad.part) && pinGap.has(it.pad.part)) gapNeed = Math.min(gapNeed, pinGap.get(it.pad.part));
        const D = it.r + w / 2 + gapNeed;
        if (d < (ctx.strict ? Math.sqrt(D * D + pitch * pitch / 4) : D) - 1e-6) {
          block = it.kind === "pad" ? wallIdx("p" + it.pad.part, () => ({ what: it.pad.part === part ? `${it.pad.ref}'s own pin ${it.pad.num}` : it.pad.ref, kind: "part", key: it.pad.part }))
            : it.kind === "track" ? wallIdx("t" + it.ti, () => ({ what: `a track on ${board.tracks[it.ti].layer}`, kind: "track", ti: it.ti }))
              : it.kind === "via" ? wallIdx("v" + it.vi, () => ({ what: "a via", kind: "via", vi: it.vi })) : wallIdx("h" + it.hi, () => ({ what: "a mounting hole", kind: "hole" }));
        }
      }
      if (block < 0) for (const h of board.holes || []) if (!h.plated && Math.hypot(cx - h.x, cy - h.y) < h.d / 2 + w / 2 + R.clearance) { block = wallIdx("hole", () => ({ what: "a mounting hole", kind: "hole" })); break; }
      if (block < 0) for (const k of board.keepouts || []) if (k.tracks !== false && C.koLayers(k).includes(L[l]) && C.pip(cx, cy, k.pts)) { block = wallIdx("ko" + (k.name || ""), () => ({ what: `keep-out ${k.name || ""}`.trim(), kind: "keepout" })); break; }
      if (src[c] >= 0) { free[c] = 1; sink[c] = 0; continue; }
      if (sink[c]) { free[c] = 1; continue; }
      if (block >= 0) { wall[c] = block; continue; }
      free[c] = 1;
      if (edgeSink && (i === 0 || j === 0 || i === nx - 1 || j === ny - 1)) sink[c] = 1;
    }
    // a pad smaller than the grid starts (or ends) at the cell nearest its middle, on each of its layers
    const nearest = (it, mark) => L.forEach((Ly, l) => {
      if (!it.layers.includes(Ly)) return;
      const i = Math.round((it.s[0] - x0) / pitch), j = Math.round((it.s[1] - y0) / pitch); if (i < 0 || j < 0 || i >= nx || j >= ny) return;
      mark((l * ny + j) * nx + i, l);
    });
    pins.forEach((it, k) => nearest(it, (c, l) => {
      for (let d = l * nx * ny; d < (l + 1) * nx * ny; d++) if (src[d] === k) return;
      src[c] = k; free[c] = 1; wall[c] = -1; sink[c] = 0;
    }));
    far.forEach(it => nearest(it, c => { if (src[c] < 0 && !sink[c]) { sink[c] = 1; free[c] = 1; wall[c] = -1; } }));
    // nodes: cell in (2c), cell out (2c + 1), the pins, the source and the sink
    const P0 = 2 * nc, S = P0 + pins.length, T = S + 1, G = flowGraph(T + 1);
    const pinEdge = pins.map((_, k) => G.add(S, P0 + k, 1));
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let c = 0; c < nc; c++) {
      if (!free[c]) continue;
      G.add(2 * c, 2 * c + 1, 1);
      if (src[c] >= 0) G.add(P0 + src[c], 2 * c, 1);
      if (sink[c]) G.add(2 * c + 1, T, 1);
      const i = c % nx, j = Math.floor(c / nx) % ny;
      steps.forEach(([di, dj]) => { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) return; const d = c + dj * nx + di; if (free[d] && src[d] < 0) G.add(2 * c + 1, 2 * d, 1); });
    }
    const flow = G.run(S, T), seen = G.reach(S), count = new Map();
    // the walls: blocked cells next to a cell the pins still reach (not the parts' own pins: nothing moves those)
    if (flow < pins.length) for (let c = 0; c < nc; c++) {
      if (!free[c] || !seen[2 * c]) continue;
      const i = c % nx, j = Math.floor(c / nx) % ny;
      steps.forEach(([di, dj]) => { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) return; const k = wall[c + dj * nx + di]; if (k >= 0 && !(walls[k].kind === "part" && ctx.own.has(walls[k].key))) count.set(k, (count.get(k) || 0) + 1); });
    }
    // the first pin's way out, cell by cell, when asked for (the flow's used edges from its node)
    let path = null;
    if (ctx.path && flow > 0 && G.cap[pinEdge[0]] === 0) {
      path = []; let u = P0, guard = 0;
      while (u !== T && guard++ < 4 * nc) {
        const e = G.used(u); if (e < 0) break;
        u = G.to[e]; if (u < P0 && !(u & 1)) { const c = u >> 1, l = Math.floor(c / (nx * ny)), j = Math.floor(c / nx) % ny, i = c % nx; path.push({ x: +(x0 + i * pitch).toFixed(4), y: +(y0 + j * pitch).toFixed(4), layer: L[l] }); }
      }
      if (u !== T) path = null;
    }
    return { flow, path, out: pinEdge.map(e => G.cap[e] === 0), walls: [...count].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ ...walls[k], n })) };
  }
  // what the checks share: the pads at the ends of open connections, track widths, clearances
  function checkCtx(board, model, conn, rats, o) {
    const C = B(), R = board.rules, names = model.names, amps = o.amps || {};
    const widthOf = n => (n === null || n === undefined ? R.track : Math.max(C.classRule(C.netClassOf(n, names, o.hv, R), R).track, Math.ceil(C.currentWidth(amps[n], R, board.stackup) * 20) / 20));
    const need = (a, b) => (o.clr ? o.clr.need(a, b).c : R.clearance);
    const padItem = new Map(conn.items.filter(it => it.kind === "pad").map(it => [it.pad, it]));
    const at = (x, y) => `${x.toFixed(3)},${y.toFixed(3)}`, padAt = new Map(model.pads.map(p => [at(p.x, p.y), p]));
    const ends = rats.map(r => [padAt.get(at(r.x1, r.y1)), padAt.get(at(r.x2, r.y2))]);
    // a part's own pins sit closer than any clearance: a track leaving one may pass the others as close as they are to each other
    const byPart = new Map(); padItem.forEach(it => { if (!byPart.has(it.pad.part)) byPart.set(it.pad.part, []); byPart.get(it.pad.part).push(it); });
    const pinGap = new Map();
    byPart.forEach((list, k) => { let g = Infinity; list.forEach(a => list.forEach(b => { if (a !== b && a.pad.net !== b.pad.net) g = Math.min(g, C.segSeg(a.s, b.s) - a.r - b.r); })); if (g < Infinity) pinGap.set(k, g); });
    return { conn, need, widthOf, padItem, ends, pinGap, copper: o.copper };
  }
  const boxOfPads = (items, m) => ({ x1: Math.min(...items.map(it => Math.min(it.s[0], it.s[2]) - it.r)) - m, y1: Math.min(...items.map(it => Math.min(it.s[1], it.s[3]) - it.r)) - m, x2: Math.max(...items.map(it => Math.max(it.s[0], it.s[2]) + it.r)) + m, y2: Math.max(...items.map(it => Math.max(it.s[1], it.s[3]) + it.r)) + m });

  /** For each part with a pin at the end of an open connection (rats), whether those pins can get
      out of the part's neighbourhood (opts.margin mm round it, default 6) all at once:
      [{ key, ref, pins: [{ num, net, out }], flow, ok, walls: [{ what, kind, key|ti|vi, n }] }], the
      shut-in parts first. walls: what borders the cells the pins can still reach, most first
      ("R3", "a track on B.Cu", "the board edge"…). opts: { clr, hv, amps, margin, copper (false: pads only) } */
  function escape(board, model, conn, rats, opts) {
    const o = opts || {}, C = B(), ctx = checkCtx(board, model, conn, rats, o), want = new Map();
    ctx.ends.forEach(([a, b]) => [[a, b], [b, a]].forEach(([p, q]) => { if (!p) return; if (!want.has(p.part)) want.set(p.part, new Map()); const m = want.get(p.part); if (!m.has(p)) m.set(p, []); if (q && q.part !== p.part) m.get(p).push(q); }));
    const out = [];
    want.forEach((pins, pk) => {
      const g = model.parts.find(q => q.key === pk); if (!g || !g.fp || !g.place) return;
      const list = [...pins.keys()], bx = C.partBox(g), m = o.margin || 6;
      const far = [...new Set([...pins.values()].flat())].map(q => ctx.padItem.get(q)).filter(Boolean);
      const r = gridFlow(board, { ...ctx, part: pk, own: new Set([pk]) }, { x1: bx.x1 - m, y1: bx.y1 - m, x2: bx.x2 + m, y2: bx.y2 + m }, list.map(p => ctx.padItem.get(p)), far, new Set(list.map(p => p.net)), Math.max(...list.map(p => ctx.widthOf(p.net))), true);
      out.push({ key: pk, ref: g.ref, pins: list.map((p, k) => ({ num: p.num, net: p.net, out: r.out[k] })), flow: r.flow, ok: r.flow === list.length, walls: r.walls });
    });
    return out.sort((a, b) => a.ok - b.ok);
  }

  /** For each open connection, whether one track could still run from end to end past the copper
      already there (a grid over both ends' box plus opts.margin, default 4 mm): [{ i, net, from,
      to, ok, walls }], the blocked ones first; i indexes rats. Same opts as escape */
  function passage(board, model, conn, rats, opts) {
    const o = opts || {}, ctx = checkCtx(board, model, conn, rats, o), out = [];
    ctx.ends.forEach(([a, b], i) => {
      if (!a || !b) return;
      const A = ctx.padItem.get(a), Bp = ctx.padItem.get(b); if (!A || !Bp) return;
      // the copper already on this net joins in: start from every piece of it on a's side, end on b's
      const r = gridFlow(board, { ...ctx, part: a.part, own: new Set([a.part, b.part]) }, boxOfPads([A, Bp], o.margin || 4), [A], [Bp], new Set([a.net]), ctx.widthOf(a.net), false);
      out.push({ i, net: a.net, from: `${a.ref} ${a.num}`, to: `${b.ref} ${b.num}`, ok: r.flow > 0, walls: r.walls });
    });
    return out.sort((x, y) => x.ok - y.ok);
  }

  /** A track for the first open connection a grid path can take (rats in order; skip: indexes
      to pass over): Lee's maze routing on the passage grid, kept a little further from obstacles
      than the clearance so the straight steps between cells keep it too. Returns { i, track:
      { layer, w, pts, net } } or null. The caller adds it and checks the board. Same opts as escape */
  function bridge(board, model, conn, rats, opts) {
    const o = opts || {}, ctx = checkCtx(board, model, conn, rats, o), skip = o.skip || new Set();
    for (let i = 0; i < ctx.ends.length; i++) {
      const [a, b] = ctx.ends[i]; if (skip.has(i) || !a || !b) continue;
      const A = ctx.padItem.get(a), Bp = ctx.padItem.get(b); if (!A || !Bp) continue;
      const w = ctx.widthOf(a.net);
      for (const m of [o.margin || 4, 12]) {
        const r = gridFlow(board, { ...ctx, part: a.part, own: new Set([a.part, b.part]), strict: true, path: true }, boxOfPads([A, Bp], m), [A], [Bp], new Set([a.net]), w, false);
        if (!r.path || !r.path.length) continue;
        // one layer from end to end (a through-hole pin starts on both): straight runs joined, the pads' middles at the ends
        const Ly = r.path[0].layer, pts = [[a.x, a.y]].concat(r.path.map(p => [p.x, p.y]), [[b.x, b.y]]);
        const simple = pts.filter((p, k) => { if (k === 0 || k === pts.length - 1) return true; const q = pts[k - 1], s = pts[k + 1]; return Math.abs((p[0] - q[0]) * (s[1] - p[1]) - (p[1] - q[1]) * (s[0] - p[0])) > 1e-6; })
          .filter((p, k, arr) => k === 0 || Math.hypot(p[0] - arr[k - 1][0], p[1] - arr[k - 1][1]) > 1e-6);
        return { i, track: { layer: Ly, w, pts: simple, net: model.names[a.net] } };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // The exact window router. A window round an open connection: its unlocked copper comes up
  // (tracks crossing its edge are cut there, their cut ends becoming terminals), and every
  // connection the window then needs, the open one and the ones the cut tracks made, is routed
  // at once on a grid by Boolean satisfiability (Luo and Wong, "Ordered escape routing based on
  // Boolean satisfiability", ASP-DAC 2008; Nam, Sakallah and Rutenbar 2002): each grid cell on
  // each layer holds at most one connection; a used cell has exactly two used edges, a terminal
  // exactly one; an edge joins cells of the same connection; a via is the edge between a cell's
  // two layers; cells of different nets stay their clearance apart (by voltage), vias their own.
  // The solver either finds tracks for all of them or proves this window has none.
  // ---------------------------------------------------------------------------
  // the parts of segment [a, b] outside box W and the points where it crosses W's edge
  function clipSeg(a, b, W) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, a[0] - W.x1], [dx, W.x2 - a[0]], [-dy, a[1] - W.y1], [dy, W.y2 - a[1]]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return { inside: null }; continue; }
      const r = q / p; if (p < 0) { if (r > t1) return { inside: null }; if (r > t0) t0 = r; } else { if (r < t0) return { inside: null }; if (r < t1) t1 = r; }
    }
    const at = t => [a[0] + dx * t, a[1] + dy * t];
    return { inside: [t0, t1], p0: at(t0), p1: at(t1) };
  }

  /** Route rats[i] exactly in a window round it (opts.margin mm round its ends, default 4).
      Returns null when there is nothing to do, { sat: false, pairs } when the window has no
      routing, or { sat: true, cut: { tracks: Set of track indexes, vias: Set }, add: { tracks,
      vias }, pairs }: take the cut copper off the board and put the added on. The caller checks
      the board afterwards. opts: as escape's, plus i (default 0), budget (solver conflicts) */
  function exact(board, model, conn, rats, opts) {
    const C = B(), o = opts || {}, R = board.rules, L = C.COPPER, ctx = checkCtx(board, model, conn, rats, o), names = model.names;
    const [a, b] = ctx.ends[o.i || 0] || []; if (!a || !b) return null;
    const A = ctx.padItem.get(a), Bp = ctx.padItem.get(b); if (!A || !Bp) return null;
    const m = o.margin || 4, pitch = o.pitch || Math.max(0.5, R.track + R.clearance);
    let W = boxOfPads([A, Bp], m);
    W = { x1: Math.max(W.x1, 0), y1: Math.max(W.y1, 0), x2: Math.min(W.x2, board.outline.w), y2: Math.min(W.y2, board.outline.h) };
    const nx = Math.floor((W.x2 - W.x1) / pitch) + 1, ny = Math.floor((W.y2 - W.y1) / pitch) + 1;
    if (nx * ny > 6000) return null;
    // the grid through the middle of the end with the closer pins (a track can then go straight in between them)
    const gapOf = it => (ctx.pinGap.has(it.pad.part) ? ctx.pinGap.get(it.pad.part) : Infinity), T = gapOf(Bp) < gapOf(A) ? Bp.pad : A.pad;
    const x0 = T.x - pitch * Math.floor((T.x - W.x1) / pitch + 1e-9), y0 = T.y - pitch * Math.floor((T.y - W.y1) / pitch + 1e-9);
    const G = { x1: x0, y1: y0, x2: x0 + (nx - 1) * pitch, y2: y0 + (ny - 1) * pitch };   // the grid's outer cells' middles
    const inG = (x, y) => x > G.x1 + 1e-6 && x < G.x2 - 1e-6 && y > G.y1 + 1e-6 && y < G.y2 - 1e-6;
    const poured = new Set((board.zones || []).map(z => z.net)), quiet = n => { const nm = names[n] || String(n); return poured.has(nm) || (R.ground === "star" && nm === "GND"); };
    // cut: the unlocked tracks reaching inside the grid, the unlocked vias in it
    const cutT = new Set(), cutV = new Set(), keep = [], ends = [];
    // what may come up: opts.rip { tracks, vias } (Sets of indexes) or "all"; by default this net's copper and
    // the nets of the tracks that wall in its way (passage), all of each
    let rip = o.rip === "all" ? null : o.rip;
    if (o.rip === undefined) {
      const r0 = rats[o.i || 0], pass = passage(board, model, conn, [r0], o)[0], nets = new Set([names[r0.net]]);
      rip = { tracks: new Set(), vias: new Set() };
      (pass ? pass.walls : []).slice(0, 6).forEach(w => { if (w.kind === "track") nets.add(board.tracks[w.ti].net); if (w.kind === "via") rip.vias.add(w.vi); });
      board.tracks.forEach((t, ti) => { if (nets.has(t.net)) rip.tracks.add(ti); });
      board.vias.forEach((v, vi) => { if (nets.has(v.net)) rip.vias.add(vi); });
    }
    const mayT = ti => !board.tracks[ti].locked && (!rip || rip.tracks.has(ti)), mayV = vi => !board.vias[vi].locked && (!rip || rip.vias.has(vi));
    board.tracks.forEach((t, ti) => {
      if (!mayT(ti)) return;
      const pieces = []; let cur = null, touched = false;
      for (let k = 0; k + 1 < t.pts.length; k++) {
        const p = t.pts[k], q = t.pts[k + 1], c = clipSeg(p, q, G);
        const into = c.inside && (c.inside[1] - c.inside[0] > 1e-9 || inG(c.p0[0], c.p0[1]));
        if (!into) { if (!cur) cur = [p]; cur.push(q); continue; }
        touched = true;
        if (c.inside[0] > 1e-9) { if (!cur) cur = [p]; cur.push(c.p0); pieces.push(cur); ends.push({ x: c.p0[0], y: c.p0[1], layer: t.layer, net: t.net, w: t.w, ti }); }
        else if (cur) { pieces.push(cur); }
        cur = null;
        if (c.inside[1] < 1 - 1e-9) { cur = [c.p1, q]; ends.push({ x: c.p1[0], y: c.p1[1], layer: t.layer, net: t.net, w: t.w, ti }); }
      }
      if (cur) pieces.push(cur);
      if (!touched) return;
      cutT.add(ti);
      pieces.forEach(pts => { if (pts.length > 1) keep.push({ ...t, pts: pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]) }); });
    });
    board.vias.forEach((v, vi) => { if (mayV(vi) && inG(v.x, v.y)) cutV.add(vi); });
    // the board without the window's copper: which pieces of each net still hang together
    const tmp = { ...board, tracks: board.tracks.filter((_, ti) => !cutT.has(ti)).concat(keep), vias: board.vias.filter((_, vi) => !cutV.has(vi)) };
    const c2 = C.connectivity(tmp, model.pads), base = board.tracks.length - cutT.size;
    // terminals: pads with their middle in the grid, and the cut ends (each on its kept piece); was: the
    // piece of copper each one belonged to before the cut (the open connection's two count as one)
    const terms = [], trackCl = new Map(), was = c => (c === Bp.cluster ? A.cluster : c);
    conn.items.forEach(it => { if (it.kind === "track") trackCl.set(it.ti, it.cluster); });
    c2.items.forEach(it => { if (it.kind === "pad" && it.pad.net !== null && inG(it.pad.x, it.pad.y) && !quiet(it.pad.net) && ctx.padItem.get(it.pad)) terms.push({ x: it.pad.x, y: it.pad.y, layers: it.layers, net: it.pad.net, cl: it.cluster, was: was(ctx.padItem.get(it.pad).cluster), pad: it }); });
    const nameId = new Map(Object.entries(names).map(([k, v]) => [v, +k]));
    ends.forEach(e => {
      const k = keep.findIndex(t => t.pts.some(p => Math.hypot(p[0] - e.x, p[1] - e.y) < 1e-3) && t.layer === e.layer), it = c2.items.find(q => q.kind === "track" && q.ti === base + k);
      const net = nameId.has(e.net) ? nameId.get(e.net) : it && typeof it.net === "number" ? it.net : null;
      if (it && net !== null && !quiet(net)) terms.push({ x: e.x, y: e.y, layers: [e.layer], net, cl: it.cluster, was: was(trackCl.get(e.ti)), w: e.w });
    });
    // the connections the window must make: what was joined before, joined again, and the open connection; per
    // such group its pieces joined by the shortest links (each cut end once)
    const pairs = [], used = new Set(), byNet = new Map();   // a cut end joins once; a pad may take several
    let split = false;
    terms.forEach(t => { const g = t.net + ":" + t.was; if (!byNet.has(g)) byNet.set(g, []); byNet.get(g).push(t); });
    byNet.forEach(list => {
      const cls = [...new Set(list.map(t => t.cl))]; if (cls.length < 2) return;
      const join = new Map(cls.map(c => [c, c])), f = c => { while (join.get(c) !== c) c = join.get(c); return c; };
      const links = []; list.forEach((p, i) => list.slice(i + 1).forEach(q => { if (p.cl !== q.cl) links.push([Math.hypot(p.x - q.x, p.y - q.y), p, q]); }));
      links.sort((u, v) => u[0] - v[0]).forEach(([, p, q]) => { if (f(p.cl) === f(q.cl) || used.has(p) || used.has(q)) return; join.set(f(p.cl), f(q.cl)); [p, q].forEach(t => { if (!t.pad) used.add(t); }); pairs.push({ net: p.net, ends: [p, q] }); });
      if (new Set(cls.map(f)).size > 1) split = true;
    });
    if (!pairs.length || split) return null;
    // the grid: per cell (layer l, column i, row j) the connections that may use it
    const nc = nx * ny * L.length, cx = c => x0 + (c % nx) * pitch, cy = c => y0 + (Math.floor(c / nx) % ny) * pitch, layerOf = c => Math.floor(c / (nx * ny));
    const cell = (l, i, j) => (l * ny + j) * nx + i, K = pairs.length;
    const widths = pairs.map(p => Math.max(ctx.widthOf(p.net), ...p.ends.map(e => e.w || 0))), need = ctx.need;
    const near = c2.items.filter(it => Math.max(it.s[0], it.s[2]) + it.r > G.x1 - 4 && Math.min(it.s[0], it.s[2]) - it.r < G.x2 + 4 && Math.max(it.s[1], it.s[3]) + it.r > G.y1 - 4 && Math.min(it.s[1], it.s[3]) - it.r < G.y2 + 4);
    const viaR = R.viaPad / 2;
    const allowed = Array.from({ length: nc }, () => []), viaOk = Array.from({ length: nx * ny }, () => []);
    const blocked = (x, y, Ly, k, rr, strict) => {
      const n = pairs[k].net;
      if (C.edgeDist(x, y, board.outline) < (R.edgeClearance || 0.5) + rr) return true;
      for (const it of near) {
        if (Ly && !it.layers.includes(Ly)) continue;
        if (it.net === n || (it.kind === "pad" && it.pad.net === n) || (it.kind === "track" && tmp.tracks[it.ti].net === names[n]) || (it.kind === "via" && tmp.vias[it.vi].net === names[n])) continue;
        let gp = need(n, it.net === "short" ? null : it.net);
        // entering a pad, a track may pass its footprint's other pins as close as they are to each other (not a via)
        if (Ly && it.kind === "pad" && ctx.pinGap.has(it.pad.part) && pairs[k].ends.some(e => e.pad && e.pad.pad.part === it.pad.part && C.segDist(e.pad.s[0], e.pad.s[1], e.pad.s[2], e.pad.s[3], x, y) <= e.pad.r)) gp = Math.min(gp, ctx.pinGap.get(it.pad.part));
        const D = it.r + rr + gp, d = C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y);
        if (d < (strict ? Math.sqrt(D * D + pitch * pitch / 4) : D) - 1e-6) return true;
      }
      for (const h of board.holes || []) if (!h.plated && Math.hypot(x - h.x, y - h.y) < h.d / 2 + rr + R.clearance) return true;
      for (const ko of board.keepouts || []) if (ko.tracks !== false && (!Ly || C.koLayers(ko).includes(Ly)) && C.pip(x, y, ko.pts)) return true;
      return false;
    };
    for (let l = 0; l < L.length; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = cell(l, i, j), x = cx(c), y = cy(c);
      for (let k = 0; k < K; k++) if (!blocked(x, y, L[l], k, widths[k] / 2, true)) allowed[c].push(k);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = cell(0, i, j); for (const k of allowed[c]) if (allowed[cell(1, i, j)].includes(k) && !blocked(cx(c), cy(c), null, k, viaR, false)) viaOk[j * nx + i].push(k); }
    // the terminals' cells: a pad's nearest cell on each of its layers, a cut end's nearest on its layer
    const nearestCell = (e, l) => cell(l, Math.min(nx - 1, Math.max(0, Math.round((e.x - x0) / pitch))), Math.min(ny - 1, Math.max(0, Math.round((e.y - y0) / pitch))));
    // a terminal's own cell is its connection's, whatever is near (the router's track came that close; the check afterwards judges)
    const padCells = (e, l) => { const P = e.pad, out = [nearestCell(e, l)]; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const c = cell(l, i, j); if (c !== out[0] && C.segDist(P.s[0], P.s[1], P.s[2], P.s[3], cx(c), cy(c)) <= P.r - widths[0] / 4) out.push(c); } return out; };
    const endCells = (e, l) => (!e.layers.includes(L[l]) ? [] : e.pad ? padCells(e, l) : [nearestCell(e, l)]);
    // (only a pad's cells clear of other copper, the next pin of a small part say, unless none is)
    pairs.forEach((p, k) => p.ends.forEach(e => L.forEach((Ly, l) => {
      const all = endCells(e, l), clear = all.filter(c => !blocked(cx(c), cy(c), Ly, k, widths[k] / 2, false));
      (clear.length ? clear : all.slice(0, 1)).forEach(c => { if (!allowed[c].includes(k)) allowed[c].push(k); });
    })));
    // the formula; first without vias (a via only where nothing else will do)
    function attempt(useVias) {
      const S = root.BoardSat.solver(), X = new Map(), V = (c, k) => X.get(c * K + k);
      for (let c = 0; c < nc; c++) for (const k of allowed[c]) X.set(c * K + k, S.newVar());
      const termCells = pairs.map((p, k) => p.ends.map(e => L.flatMap((Ly, l) => endCells(e, l)).filter(c => V(c, k))));
      if (termCells.some(tc => tc.some(list => !list.length))) return { sat: false, why: "terminal" };
      // edges: neighbours on a layer, and a via between a cell's two layers
      const edges = [], inc = Array.from({ length: nc }, () => []);
      const share = (c, d) => allowed[c].filter(k => V(d, k));
      for (let l = 0; l < L.length; l++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const c = cell(l, i, j);
        [[1, 0], [0, 1]].forEach(([di, dj]) => { if (i + di >= nx || j + dj >= ny) return; const d = cell(l, i + di, j + dj), ks = share(c, d); if (!ks.length) return; const e = { v: S.newVar(), c, d, ks }; edges.push(e); inc[c].push(e); inc[d].push(e); });
      }
      const vias = [];
      if (useVias) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const ks = viaOk[j * nx + i]; if (!ks.length) continue; const c = cell(0, i, j), d = cell(1, i, j), e = { v: S.newVar(), c, d, ks, via: true }; edges.push(e); vias.push(e); inc[c].push(e); inc[d].push(e); }
      // a terminal: one edge out of its cells (a cut end's or pad's own edge into the grid)
      const tEdges = [];
      termCells.forEach((tc, k) => tc.forEach(list => { const es = list.map(c => { const e = { v: S.newVar(), c, k, term: true }; inc[c].push(e); return e; }); tEdges.push(es); S.add(es.map(e => e.v)); for (let p = 0; p < es.length; p++) for (let q = p + 1; q < es.length; q++) S.add([-es[p].v, -es[q].v]); es.forEach(e => S.add([-e.v, V(e.c, e.k)])); }));
      // cells: at most one connection; used exactly when two of its edges are
      for (let c = 0; c < nc; c++) {
        const ks = allowed[c]; if (!ks.length) continue;
        for (let p = 0; p < ks.length; p++) for (let q = p + 1; q < ks.length; q++) S.add([-V(c, ks[p]), -V(c, ks[q])]);
        const u = S.newVar(); ks.forEach(k => S.add([-V(c, k), u])); S.add([-u, ...ks.map(k => V(c, k))]);
        const es = inc[c];
        es.forEach(e => S.add([-e.v, u]));
        if (!es.length) { S.add([-u]); continue; }
        for (let p = 0; p < es.length; p++) S.add([-u, ...es.filter((_, q) => q !== p).map(e => e.v)]);
        for (let p = 0; p < es.length; p++) for (let q = p + 1; q < es.length; q++) for (let r = q + 1; r < es.length; r++) S.add([-es[p].v, -es[q].v, -es[r].v]);
      }
      // an edge joins cells of one connection
      edges.forEach(e => {
        [[e.c, e.d], [e.d, e.c]].forEach(([c, d]) => allowed[c].forEach(k => S.add(e.ks.includes(k) && V(d, k) ? [-e.v, -V(c, k), V(d, k)] : [-e.v, -V(c, k)])));
      });
      // clearance between connections of different nets wider than the grid, and round vias
      const maxNeed = Math.max(...pairs.map(p => Math.max(...pairs.map(q => need(p.net, q.net))))), reach = Math.ceil((Math.max(viaR, ...widths.map(x => x / 2)) + Math.max(...widths) / 2 + maxNeed) / pitch);
      for (let c = 0; c < nc; c++) for (const ka of allowed[c]) {
        const l = layerOf(c), i = c % nx, j = Math.floor(c / nx) % ny;
        for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
          if ((!di && !dj) || i + di < 0 || j + dj < 0 || i + di >= nx || j + dj >= ny) continue;
          const d = cell(l, i + di, j + dj); if (d < c) continue;
          const dist = pitch * Math.hypot(di, dj);
          for (const kb of allowed[d]) { if (pairs[kb].net === pairs[ka].net) continue; if (dist < widths[ka] / 2 + widths[kb] / 2 + need(pairs[ka].net, pairs[kb].net) - 1e-6) S.add([-V(c, ka), -V(d, kb)]); }
        }
      }
      vias.forEach(e => {
        const i = e.c % nx, j = Math.floor(e.c / nx) % ny;
        for (let l = 0; l < L.length; l++) for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
          if ((!di && !dj) || i + di < 0 || j + dj < 0 || i + di >= nx || j + dj >= ny) continue;
          const d = cell(l, i + di, j + dj), dist = pitch * Math.hypot(di, dj);
          for (const kb of allowed[d]) for (const ka of e.ks) { if (pairs[ka].net === pairs[kb].net) continue; if (dist < viaR + widths[kb] / 2 + need(pairs[ka].net, pairs[kb].net) - 1e-6) S.add([-e.v, -V(e.c, ka), -V(d, kb)]); }
        }
      });
      const sat = S.solve({ budget: o.budget || 20000 });
      return { sat, S, tEdges, inc, termCells };
    }
    // a connection whose ends no run of its cells joins has no way, whatever the others do (said at once; the
    // solver would take long to find it out)
    const reaches = k => {
      const has = c => allowed[c].includes(k), ends = pairs[k].ends.map(e => L.flatMap((Ly, l) => endCells(e, l)).filter(has));
      if (ends.some(list => !list.length)) return false;
      const goal = new Set(ends[1]), seen = new Set(ends[0]), q = [...ends[0]];
      while (q.length) {
        const c = q.pop(); if (goal.has(c)) return true;
        const l = layerOf(c), i = c % nx, j = Math.floor(c / nx) % ny, next = [];
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([di, dj]) => { if (i + di >= 0 && j + dj >= 0 && i + di < nx && j + dj < ny) next.push(cell(l, i + di, j + dj)); });
        if (viaOk[j * nx + i].includes(k)) next.push(cell(1 - l, i, j));
        next.forEach(d => { if (!seen.has(d) && has(d)) { seen.add(d); q.push(d); } });
      }
      return false;
    };
    for (let k = 0; k < K; k++) if (!reaches(k)) return { sat: false, pairs: K, unknown: false, why: "no path" };
    let F = attempt(false);
    if (F.sat !== true && F.why !== "terminal") F = attempt(true);
    if (F.sat !== true) return { sat: false, pairs: K, unknown: F.sat === null, why: F.why };
    const { S, tEdges, inc, termCells } = F;
    // each connection's cells, walked from its first terminal's cell to the other's
    const seqs = pairs.map((p, k) => {
      const startE = tEdges.find(es => es.some(e => e.k === k && S.value(e.v) && termCells[k][0].includes(e.c)));
      if (!startE) return null;
      const s0 = startE.find(e => S.value(e.v)), ends = new Set(termCells[k][1]), seq = [s0.c];
      let prev = s0, c = s0.c, guard = 0;
      while (guard++ < nc) {
        if (ends.has(c) && inc[c].some(e => e.term && e.k === k && S.value(e.v))) return seq;
        const nxt = inc[c].find(e => e !== prev && S.value(e.v) && !e.term);
        if (!nxt) return null;
        c = nxt.c === c ? nxt.d : nxt.c; seq.push(c); prev = nxt;
      }
      return null;
    });
    if (seqs.some(q => !q)) return { sat: false, pairs: K, why: "walk" };
    // then each pulled tight in turn: the shortest way (a via counts as 6 steps, a bend as half) past the others as they now are
    const ij = c => [c % nx, Math.floor(c / nx) % ny], dOf = (ka, kb) => widths[ka] / 2 + widths[kb] / 2 + need(pairs[ka].net, pairs[kb].net);
    const viasOf = q => q.filter((c, n) => n && layerOf(c) !== layerOf(q[n - 1]));
    function tighten(k) {
      const bad = new Uint8Array(nc), badVia = new Uint8Array(nx * ny);
      seqs.forEach((q, kb) => {
        if (kb === k) return;
        const same = pairs[kb].net === pairs[k].net, vs = new Set(viasOf(q).map(c => c % (nx * ny)));
        q.forEach(c => {
          const [i, j] = ij(c), l = layerOf(c), r = same ? 0 : Math.ceil(Math.max(dOf(k, kb), viaR + widths[kb] / 2 + need(pairs[k].net, pairs[kb].net)) / pitch);
          bad[c] = 1;
          for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
            const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny || same) continue;
            const dist = pitch * Math.hypot(di, dj);
            if (dist < dOf(k, kb) - 1e-6) bad[cell(l, a, b)] = 1;
            if (dist < viaR + widths[kb] / 2 + need(pairs[k].net, pairs[kb].net) - 1e-6) badVia[b * nx + a] = 1;
            if (vs.has(cell(0, i, j)) && dist < viaR + widths[k] / 2 + need(pairs[k].net, pairs[kb].net) - 1e-6) { bad[cell(0, a, b)] = 1; bad[cell(1, a, b)] = 1; }
          }
        });
      });
      // Dijkstra over (cell, heading)
      const N = nc * 5, dist = new Float64Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), heap = [];
      const pushQ = (st, d) => { heap.push([d, st]); let x = heap.length - 1; while (x > 0) { const y = (x - 1) >> 1; if (heap[y][0] <= heap[x][0]) break; [heap[x], heap[y]] = [heap[y], heap[x]]; x = y; } };
      const popQ = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let x = 0; for (;;) { let y = 2 * x + 1; if (y >= heap.length) break; if (y + 1 < heap.length && heap[y + 1][0] < heap[y][0]) y++; if (heap[x][0] <= heap[y][0]) break; [heap[x], heap[y]] = [heap[y], heap[x]]; x = y; } } return top; };
      const ok = c => allowed[c].includes(k) && !bad[c];
      termCells[k][0].forEach(c => { if (ok(c)) { dist[c * 5 + 4] = 0; pushQ(c * 5 + 4, 0); } });
      const goal = new Set(termCells[k][1]); let end = -1;
      const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (heap.length) {
        const [d, st] = popQ(); if (d > dist[st]) continue;
        const c = Math.floor(st / 5), h = st % 5;
        if (goal.has(c)) { end = st; break; }
        const [i, j] = ij(c), l = layerOf(c);
        D4.forEach(([di, dj], nh) => {
          const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) return;
          const e = cell(l, a, b); if (!ok(e)) return;
          const nd = d + 1 + (h < 4 && h !== nh ? 0.5 : 0), ns = e * 5 + nh;
          if (nd < dist[ns] - 1e-9) { dist[ns] = nd; from[ns] = st; pushQ(ns, nd); }
        });
        const e = cell(1 - l, i, j);
        if (viaOk[j * nx + i].includes(k) && !badVia[j * nx + i] && ok(e)) { const nd = d + 6, ns = e * 5 + 4; if (nd < dist[ns] - 1e-9) { dist[ns] = nd; from[ns] = st; pushQ(ns, nd); } }
      }
      if (end < 0) return;
      const q = []; for (let st = end; st >= 0; st = from[st]) q.push(Math.floor(st / 5));
      seqs[k] = q.reverse();
    }
    for (let pass = 0; pass < 2; pass++) for (let k = 0; k < K; k++) tighten(k);
    // the tracks: one per layer run, vias between
    const add = { tracks: keep.slice(), vias: [] };
    pairs.forEach((p, k) => {
      const seq = seqs[k], net = names[p.net], w = widths[k], [ea, eb] = p.ends;
      let pts = [[ea.x, ea.y]], Ly = L[layerOf(seq[0])];
      const flush = () => { const simple = pts.filter((q, n) => n === 0 || n === pts.length - 1 || Math.abs((q[0] - pts[n - 1][0]) * (pts[n + 1][1] - q[1]) - (q[1] - pts[n - 1][1]) * (pts[n + 1][0] - q[0])) > 1e-9).filter((q, n, arr) => n === 0 || Math.hypot(q[0] - arr[n - 1][0], q[1] - arr[n - 1][1]) > 1e-6); if (simple.length > 1) add.tracks.push({ layer: Ly, w, pts: simple.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]), net }); };
      seq.forEach((c, n) => {
        const q = [cx(c), cy(c)], l2 = L[layerOf(c)];
        if (n && l2 !== Ly) { flush(); add.vias.push({ x: +q[0].toFixed(4), y: +q[1].toFixed(4), drill: R.viaDrill, pad: R.viaPad, net }); pts = [q]; Ly = l2; return; }
        pts.push(q);
      });
      pts.push([eb.x, eb.y]); flush();
    });
    return { sat: true, cut: { tracks: cutT, vias: cutV }, add, pairs: K };
  }

  /** "VT1 pin 2 (shut in by R3, a track on B.Cu)": the shut-in pins in words */
  function describeEscape(esc) {
    return esc.filter(e => !e.ok).map(e => {
      const pins = e.pins.filter(p => !p.out).map(p => p.num), by = [...new Set(e.walls.slice(0, 3).map(w => w.what))];
      return `${e.ref} pin${pins.length === 1 ? "" : "s"} ${pins.join(", ")}${by.length ? ` (shut in by ${by.join(", ")})` : ""}`;
    }).join("; ");
  }

  root.BoardPlace = { movable, nudge, spread, describe, escape, passage, bridge, exact, describeEscape, FIXED, rng };
})(typeof window !== "undefined" ? window : globalThis);
