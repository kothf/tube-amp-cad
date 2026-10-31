/* =============================================================================
   BOARD DESIGN — the board's own grid router (no DOM, Node-testable): negotiated congestion
   routing, rip-up and reroute (PathFinder, McMurchie and Ebeling, FPGA 1995; the same scheme
   drives the maze routers of most FPGA and many PCB tools).
     route(board, model, conn, opts) -> { cut: { tracks, vias }, add: { tracks, vias }, open, conflicts, iters, ms }
   Every net (not the star ground; a poured net for the pads its pour does not join) is a tree on a fine grid over
   both copper layers (opts.pitch, default 0.25 mm), cells joined to their eight neighbours, a via
   between a cell's two layers. Each net's own copper keeps the clearance (by voltage) from pads,
   locked copper, holes, keep-outs and the board edge: those cells are shut to it. Other nets'
   tracks are not walls but a price: a net may run over them, paying more for each net it would
   come too close to, and more again where nets kept fighting before (the history cost). Round
   after round the nets in conflict are taken up and routed again as the price rises, until no two
   nets come too close. Copper already on the board (Freerouting's) stays as it is until a new route
   has to cross it; only the pieces in the way come up, and their nets are joined again.
   A track ends in a pad's middle by a straight tail from a cell up to 5 mm away, kept clear of all
   but the footprint's own pins, which it may pass as close as they are to each other (as the check
   allows a track entering a pad). Grid nets pay more to run within the coupling gap of anode and
   heater nets, on either side of the board.
   The caller puts the result on the board and keeps it only if the check agrees it is better.
   Depends on: board-core.js
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const SQ2 = Math.SQRT2, MARGIN = 0.05;
  // how far a via keeps off its own net's SMD pads (copper to copper, mm)
  const VIA_OFF_PAD = 0.15;
  const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1];

  // a binary min-heap of integer keys by float priority
  function heap(cap) {
    let key = new Int32Array(cap), pri = new Float64Array(cap), n = 0;
    return {
      get size() { return n; },
      clear() { n = 0; },
      push(k, p) {
        if (n === key.length) { const k2 = new Int32Array(n * 2), p2 = new Float64Array(n * 2); k2.set(key); p2.set(pri); key = k2; pri = p2; }
        let i = n++;
        while (i > 0) { const up = (i - 1) >> 1; if (pri[up] <= p) break; key[i] = key[up]; pri[i] = pri[up]; i = up; }
        key[i] = k; pri[i] = p;
      },
      pop() {
        const top = key[0], k = key[--n], p = pri[n];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && pri[c + 1] < pri[c]) c++;
          if (pri[c] >= p) break;
          key[i] = key[c]; pri[i] = pri[c]; i = c;
        }
        key[i] = k; pri[i] = p;
        return top;
      }
    };
  }

  /** opts: { clr, hv, amps, netlist (for the grid and anode nets), pitch (mm), time (ms budget, default
      20000), iters (default 40), fresh (every unlocked track of the routed nets comes up first),
      nets: Set of net ids that may be routed or moved (default every net but the star ground) }.
      cut: indexes of the board's tracks and vias to take off; add: the new ones. open: how many
      of the nets' pieces are still apart; conflicts: 0 when every net keeps clear of the others. */
  function route(board, model, conn, opts) {
    const C = B(), o = opts || {}, R = board.rules, L = C.COPPER, names = model.names, outl = board.outline, t0 = Date.now();
    const need = (a, b) => (o.clr ? o.clr.need(a, b).c : R.clearance);
    const amps = o.amps || {};
    const widthOf = n => Math.max(C.classRule(C.netClassOf(n, names, o.hv, R), R).track, Math.ceil(C.currentWidth(amps[n], R, board.stackup) * 20) / 20);
    const viaR = R.viaPad / 2;
    const nameId = new Map(Object.entries(names).map(([k, v]) => [v, isNaN(+k) ? k : +k]));
    const netOf = it => (typeof it.net === "number" ? it.net : it.kind === "track" && nameId.has(board.tracks[it.ti].net) ? nameId.get(board.tracks[it.ti].net) : it.kind === "via" && nameId.has(board.vias[it.vi].net) ? nameId.get(board.vias[it.vi].net) : null);
    const poured = new Set((board.zones || []).map(z => z.net)), star = R.ground === "star";
    // a poured net is routed too, for the pads its pour does not join (the pour fills round the tracks afterwards)
    const routable = n => n !== null && !(star && names[n] === "GND");
    // the grid
    let p = o.pitch || 0.25;
    while ((outl.w / p + 1) * (outl.h / p + 1) > 600000) p *= 1.25;
    const nx = Math.floor(outl.w / p) + 1, ny = Math.floor(outl.h / p) + 1, N = nx * ny, NL = L.length;
    const X = c => (c % nx) * p, Y = c => Math.floor(c / nx) * p;
    // the nets: their copper that may come up (keep), what stays (pads, locked copper)
    const nets = new Map();
    const netRec = n => { if (!nets.has(n)) nets.set(n, { id: n, ver: 0, w: widthOf(n), fixed: [], keep: [], paths: [], vias: [], dirty: false, groupsLeft: 0 }); return nets.get(n); };
    const may = n => routable(n) && (!o.nets || o.nets.has(n));
    const frozen = [];   // copper that stays and is a wall to every other net
    conn.items.forEach(it => {
      const n = it.kind === "pad" ? it.pad.net : netOf(it);
      const live = (it.kind === "track" && !board.tracks[it.ti].locked) || (it.kind === "via" && !board.vias[it.vi].locked);
      if (n !== null && n !== undefined && may(n)) { const r = netRec(n); (live ? r.keep : r.fixed).push(it); if (it.kind !== "pad" || !live) frozen.push({ it, net: n }); }
      else frozen.push({ it, net: n === undefined ? null : n });
    });
    // a net's copper that is not frozen (the keep) is a price to the others, not a wall
    const isKeep = new Set(); nets.forEach(r => r.keep.forEach(it => isKeep.add(it)));
    const walls = frozen.filter(f => !isKeep.has(f.it));
    // the pieces of each net and whether it needs routing
    // the pads a pour joins already (the copper the router keeps; the caller's check judges the pour afterwards)
    const pourJoined = new Set(conn.items.filter(it => it.kind === "pad" && poured.has(names[it.pad.net])));
    function groups(r) {
      const items = r.fixed.concat(r.keep), par = items.map((_, i) => i), f = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (pourJoined.has(a) && pourJoined.has(b) && a.cluster === b.cluster) { par[f(i)] = f(j); continue; }
        if (a.kind === "pad" && b.kind === "pad") continue;
        if (a.layers.some(l => b.layers.includes(l)) && C.segSeg(a.s, b.s) - a.r - b.r <= 1e-6) par[f(i)] = f(j);
      }
      const m = new Map(); items.forEach((it, i) => { const g = f(i); if (!m.has(g)) m.set(g, []); m.get(g).push(it); });
      // pieces without a pad (copper left hanging) are not to be joined
      return [...m.values()].filter(g => g.some(it => it.kind === "pad"));
    }
    // fresh: the routed nets' unlocked copper all comes up, the board routed afresh
    if (o.fresh) nets.forEach(r => { r.keep = []; });
    nets.forEach(r => { r.dirty = groups(r).length > 1; });
    // stamping round shapes into the grid: every cell whose middle lies within rad of segment s
    function stamp(s, rad, fn) {
      const i1 = Math.max(0, Math.floor((Math.min(s[0], s[2]) - rad) / p)), i2 = Math.min(nx - 1, Math.ceil((Math.max(s[0], s[2]) + rad) / p));
      const j1 = Math.max(0, Math.floor((Math.min(s[1], s[3]) - rad) / p)), j2 = Math.min(ny - 1, Math.ceil((Math.max(s[1], s[3]) + rad) / p));
      const dx = s[2] - s[0], dy = s[3] - s[1], LL = dx * dx + dy * dy, r2 = rad * rad;
      for (let j = j1; j <= j2; j++) for (let i = i1; i <= i2; i++) {
        const x = i * p, y = j * p;
        let t = LL > 0 ? ((x - s[0]) * dx + (y - s[1]) * dy) / LL : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = s[0] + t * dx - x, ey = s[1] + t * dy - y;
        if (ex * ex + ey * ey < r2) fn(j * nx + i, x, y);
      }
    }
    const li = l => L.indexOf(l);
    const SP = C.socketPads(board, model), holes = C.npHoles ? C.npHoles(board, model) : (board.holes || []).filter(h => !h.plated);
    const kos = (board.keepouts || []).filter(k => k.tracks !== false);
    const edge = new Float32Array(N); for (let c = 0; c < N; c++) edge[c] = C.edgeDist(X(c), Y(c), outl);
    const classClr = n => C.classRule(C.netClassOf(n, names, o.hv, R), R).clearance;
    // the cells shut to net r: track[l * N + c], via[c]
    const hardCache = new Map();
    function hard(r) {
      if (hardCache.has(r.id)) return hardCache.get(r.id);
      const T = new Uint8Array(NL * N), V = new Uint8Array(N), hw = r.w / 2, ec = R.edgeClearance || 0.5;
      for (let c = 0; c < N; c++) { if (edge[c] < ec + hw) { for (let l = 0; l < NL; l++) T[l * N + c] = 1; } if (edge[c] < ec + viaR) V[c] = 1; }
      walls.forEach(({ it, net }) => {
        // distance from a cell to the item's copper edge: a square pad's corners reach past its capsule
        const ext = it.box ? Math.max(0, Math.hypot(it.pad.w, it.pad.h) / 2 - it.r) : 0;
        const dEdge = (x, y) => (it.box ? C.segBox([x, y, x, y], it.box) : C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y) - it.r);
        // no via in the net's own SMD pads (solder paste runs down the hole and the joint starves):
        // the track leaves the pad and drops through just beside it, the mask web between them intact
        if (net === r.id) {
          if (it.kind === "pad" && it.pad.smd) stamp(it.s, it.r + ext + viaR + VIA_OFF_PAD + MARGIN, (c, x, y) => { if (dEdge(x, y) < viaR + VIA_OFF_PAD) V[c] = 1; });
          return;
        }
        const g = need(r.id, net), sb = it.kind === "pad" ? SP.get(it.pad) : null, gs = sb ? Math.min(g, sb.gap - 0.02) : g;
        const ls = it.layers.map(li);
        const mark = (rad, fn) => stamp(it.s, it.r + ext + rad + Math.max(g, gs), (c, x, y) => {
          if (sb && gs < g && Math.hypot(x - sb.x, y - sb.y) <= sb.r) { if (dEdge(x, y) >= rad + gs) return; }
          else if (dEdge(x, y) >= rad + g) return;
          fn(c);
        });
        mark(hw + MARGIN, c => ls.forEach(l => { T[l * N + c] = 1; }));
        mark(viaR + MARGIN, c => { V[c] = 1; });
        // a socket pin lets passing copper as near as the pins' spacing, but the track into it runs to its
        // middle and keeps the full clearance: shut the ring round the middle that track would need
        const q = it.kind === "pad" && gs < g ? nets.get(net) : null;
        if (q) {
          const sc = [it.pad.x, it.pad.y, it.pad.x, it.pad.y];
          stamp(sc, q.w / 2 + hw + g + MARGIN, c => ls.forEach(l => { T[l * N + c] = 1; }));
          stamp(sc, q.w / 2 + viaR + g + MARGIN, c => { V[c] = 1; });
        }
      });
      holes.forEach(h => {
        const g = Math.max(classClr(r.id), h.part ? 0 : o.clr && o.clr.toChassis ? o.clr.toChassis(r.id).c : 0), s = [h.x, h.y, h.x, h.y];
        stamp(s, h.d / 2 + hw + g + MARGIN, c => { for (let l = 0; l < NL; l++) T[l * N + c] = 1; });
        stamp(s, h.d / 2 + viaR + g + MARGIN, c => { V[c] = 1; });
      });
      kos.forEach(ko => {
        const xs = ko.pts.map(q => q[0]), ys = ko.pts.map(q => q[1]), ls = C.koLayers(ko).map(li).filter(l => l >= 0);
        const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        const edges = ko.pts.map((a, k) => { const b = ko.pts[(k + 1) % ko.pts.length]; return [a[0], a[1], b[0], b[1]]; });
        const inside = (x, y, rad) => C.pip(x, y, ko.pts) || edges.some(e => C.segDist(e[0], e[1], e[2], e[3], x, y) < rad);
        for (let j = Math.max(0, Math.floor((box[1] - 2) / p)); j <= Math.min(ny - 1, Math.ceil((box[3] + 2) / p)); j++) for (let i = Math.max(0, Math.floor((box[0] - 2) / p)); i <= Math.min(nx - 1, Math.ceil((box[2] + 2) / p)); i++) {
          const c = j * nx + i, x = i * p, y = j * p;
          if (inside(x, y, hw + MARGIN)) ls.forEach(l => { T[l * N + c] = 1; });
          if (inside(x, y, viaR + MARGIN)) V[c] = 1;
        }
      });
      const h = { T, V }; hardCache.set(r.id, h);
      return h;
    }
    // a net's copper as shapes: the keep (board copper) and its grid paths' straight runs
    function shapes(r) {
      const out = [];
      r.keep.forEach(it => out.push({ s: it.s, r: it.r, ls: it.layers.map(li), via: it.kind === "via", it }));
      r.paths.forEach(path => runs(path).forEach(run => out.push({ s: [X(run.a), Y(run.a), X(run.b), Y(run.b)], r: r.w / 2, ls: [run.l], via: false })));
      r.paths.forEach(path => tails(path).forEach(([P, st]) => { const sg = tailSeg(P, st); if (sg) out.push({ s: sg, r: r.w / 2, ls: [Math.floor(st / N)], via: false }); }));
      r.vias.forEach(c => out.push({ s: [X(c), Y(c), X(c), Y(c)], r: viaR, ls: L.map((_, l) => l), via: true }));
      return out;
    }
    // a path's ends that run on straight to a pad's middle: [[pad item, state]]
    const tails = path => [[path.a, path[0]], [path.b, path[path.length - 1]]].filter(([P]) => P);
    // the part of a tail outside its pad (inside, the check holds tracks only to the pads' own spacing)
    function tailSeg(P, st) {
      const x2 = X(st % N), y2 = Y(st % N), d = Math.hypot(x2 - P.pad.x, y2 - P.pad.y);
      if (d <= P.r) return null;
      return [P.pad.x + (x2 - P.pad.x) * P.r / d, P.pad.y + (y2 - P.pad.y) * P.r / d, x2, y2];
    }
    // the first cell round a tail's points (outside its pad) where another net would be too close, or -1
    function tailHitAt(P, st) {
      const x2 = X(st % N), y2 = Y(st % N), d = Math.hypot(x2 - P.pad.x, y2 - P.pad.y); if (d < 1e-9) return -1;
      const l = Math.floor(st / N), n2 = Math.ceil(d / (p / 2));
      for (let k = 0; k <= n2; k++) {
        if (d * k / n2 <= P.r) continue;
        const x = (P.pad.x + (x2 - P.pad.x) * k / n2) / p, y = (P.pad.y + (y2 - P.pad.y) * k / n2) / p;
        for (const i of [Math.floor(x), Math.ceil(x)]) for (const j of [Math.floor(y), Math.ceil(y)]) {
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const s2 = l * N + j * nx + i;
          if (!softT[s2] || (i === (st % N) % nx && j === Math.floor((st % N) / nx))) continue;
          return s2;
        }
      }
      return -1;
    }
    // a path's straight runs on one layer: [{ l, a, b }] (cells)
    function runs(path) {
      const out = [];
      let k = 0;
      while (k < path.length - 1) {
        const l = Math.floor(path[k] / N), a = path[k] % N;
        if (Math.floor(path[k + 1] / N) !== l) { k++; continue; }
        let d = path[k + 1] - path[k], m = k + 1;
        while (m + 1 < path.length && path[m + 1] - path[m] === d) m++;
        out.push({ l, a, b: path[m] % N }); k = m;
      }
      return out;
    }
    // the price map for net r: per cell, how many other nets it would come too close to (and which one last)
    const softT = new Uint8Array(NL * N), softV = new Uint8Array(N), whoT = new Int32Array(NL * N), whoV = new Int32Array(N), seenT = new Int32Array(NL * N), seenV = new Int32Array(N);
    let token = 0;
    const netIds = [...nets.keys()], idx = new Map(netIds.map((n, i) => [n, i]));
    // (each net's cells at a given distance are kept until its copper changes: q.ver)
    function cellsNear(q, eT, eV) {
      const key = eT.toFixed(3) + "/" + eV.toFixed(3);
      if (!q.near || q.near.ver !== q.ver) q.near = { ver: q.ver, m: new Map() };
      if (q.near.m.has(key)) return q.near.m.get(key);
      token++;
      const T = [], V = [];
      shapes(q).forEach(sh => {
        stamp(sh.s, sh.r + eT, c => sh.ls.forEach(l => { const k = l * N + c; if (seenT[k] !== token) { seenT[k] = token; T.push(k); } }));
        stamp(sh.s, sh.r + eV, c => { if (seenV[c] !== token) { seenV[c] = token; V.push(c); } });
      });
      const v = { T: Int32Array.from(T), V: Int32Array.from(V) }; q.near.m.set(key, v);
      return v;
    }
    // grid nets kept from running alongside anode and heater nets (on either side of the board), as the check
    // asks: the cells within its coupling gap of the other kind cost more (nearT, 1 where they do)
    const valves = {}; ((o.netlist && o.netlist.parts) || []).forEach(q => { valves[q.id] = q.type === "tube"; });
    const role = (pad, set) => (pad.pins || []).some(c => valves[c.comp] && set.has(c.pin));
    const GRID = new Set(["G", "G1"]), ANODE = new Set(["A", "A1", "A2"]), victim = new Set(), aggr = new Set();
    model.pads.forEach(q => { if (q.net !== null && role(q, ANODE)) aggr.add(q.net); });
    Object.entries(names).forEach(([n, t]) => { if (C.isHeaterNet && C.isHeaterNet(t)) aggr.add(isNaN(+n) ? n : +n); });
    model.pads.forEach(q => { if (q.net !== null && role(q, GRID) && !aggr.has(q.net) && names[q.net] !== "GND") victim.add(q.net); });
    // a pour's layer costs other nets more: tracks there cut the pour, and pads it joined come apart
    const pourLayer = new Map(); (board.zones || []).forEach(z => { const l = li(z.layer); if (l >= 0 && nameId.has(z.net)) pourLayer.set(l, nameId.get(z.net)); });
    const POUR = o.pour === undefined ? 1 : o.pour;
    const LIM = R.couplingGap > 0 ? R.couplingGap : 2, nearT = new Uint8Array(N), COUPLE = o.couple || 4;
    function soft(r) {
      softT.fill(0); softV.fill(0); nearT.fill(0);
      const hw = r.w / 2, other = victim.has(r.id) ? aggr : aggr.has(r.id) ? victim : null;
      if (other) nets.forEach(q => {
        if (q === r || !other.has(q.id)) return;
        const c = cellsNear(q, hw + LIM, 0);
        for (let k = 0; k < c.T.length; k++) nearT[c.T[k] % N] = 1;
      });
      nets.forEach(q => {
        if (q === r || (!q.keep.length && !q.paths.length)) return;
        const g = need(r.id, q.id), qi = idx.get(q.id), c = cellsNear(q, hw + g + MARGIN, viaR + g + MARGIN), tok = ++token;
        for (let k = 0; k < c.T.length; k++) { const s = c.T[k]; seenT[s] = tok; if (softT[s] < 255) softT[s]++; whoT[s] = qi; }
        for (let k = 0; k < c.V.length; k++) { const s = c.V[k]; seenV[s] = tok; if (softV[s] < 255) softV[s]++; whoV[s] = qi; }
      });
    }
    // per-shape stamping counts a net once per shape, not per net: a net's two overlapping shapes count twice.
    // that only raises the price; conflicts are judged by >0
    const histT = new Float32Array(NL * N), histV = new Float32Array(N);
    // terminal cells of a piece of copper: the cells inside it (within r - w/4), at least the nearest one
    function cellsOf(it, w) {
      const out = [], ls = it.layers.map(li).filter(l => l >= 0);
      stamp(it.s, Math.max(p * 0.75, it.r - w / 4), c => ls.forEach(l => out.push(l * N + c)));
      if (!out.length) { const i = Math.min(nx - 1, Math.max(0, Math.round(it.s[0] / p))), j = Math.min(ny - 1, Math.max(0, Math.round(it.s[1] / p))); ls.forEach(l => out.push(l * N + j * nx + i)); }
      return out;
    }
    const S2 = NL * N, SINK = S2, dist = new Float64Array(S2 + 1), from = new Int32Array(S2 + 1), stamp2 = new Int32Array(S2 + 1), goal = new Int32Array(S2 + 1), Q = heap(1 << 16);
    let run = 0;
    const VIA = o.viaCost || 3, BEND = 0.1;
    // A* from the tree's cells to any cell of the target group; returns the path (states, tree end first) or null
    // A* from the tree's cells to the target group's (a cell's start or finish cost: the tail to its pad);
    // returns the path (states, tree end first) or null
    function astar(r, H, tree, target, tb, pf) {
      run++;
      target.forEach((v, s) => { goal[s] = run; });
      const hx = (s) => { const c = s % N, i = c % nx, j = (c - i) / nx, dx = Math.max(0, tb[0] - i, i - tb[2]), dy = Math.max(0, tb[1] - j, j - tb[3]); return p * (Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy)); };
      Q.clear();
      tree.forEach((v, s) => { if (stamp2[s] === run && dist[s] <= v.c) return; stamp2[s] = run; dist[s] = v.c; from[s] = -1; Q.push(s, v.c + hx(s)); });
      let found = -1, pops = 0;
      while (Q.size) {
        const s = Q.pop(); pops++;
        if (s === SINK) { found = from[SINK]; break; }
        const ds = dist[s];
        if (goal[s] === run) { const nd = ds + target.get(s).c; if (stamp2[SINK] !== run || dist[SINK] > nd) { stamp2[SINK] = run; dist[SINK] = nd; from[SINK] = s; Q.push(SINK, nd); } }
        const l = Math.floor(s / N), c = s - l * N, i = c % nx, j = (c - i) / nx;
        const pr = from[s] >= 0 ? from[s] : -1, pdir = pr >= 0 && Math.floor(pr / N) === l ? s - pr : 0;
        for (let d = 0; d < 8; d++) {
          const a = i + DI[d], b = j + DJ[d]; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
          const c2 = b * nx + a, s2 = l * N + c2;
          if (H.T[s2] && goal[s2] !== run && !r.term.has(s2)) continue;
          const len = d < 4 ? p : p * SQ2, cost = len * (1 + histT[s2] + COUPLE * nearT[c2] + (pourLayer.has(l) && pourLayer.get(l) !== r.id ? POUR : 0)) * (1 + pf * softT[s2]) + (pdir && s2 - s !== pdir ? BEND * p : 0), nd = ds + cost;
          if (stamp2[s2] === run && dist[s2] <= nd) continue;
          stamp2[s2] = run; dist[s2] = nd; from[s2] = s; Q.push(s2, nd + hx(s2));
        }
        if (!H.V[c]) for (let l2 = 0; l2 < NL; l2++) {
          if (l2 === l) continue;
          const s2 = l2 * N + c, nd = ds + VIA * (1 + histV[c]) * (1 + pf * softV[c]);
          if (H.T[s2] && goal[s2] !== run && !r.term.has(s2)) continue;
          if (stamp2[s2] === run && dist[s2] <= nd) continue;
          stamp2[s2] = run; dist[s2] = nd; from[s2] = s; Q.push(s2, nd + hx(s2));
        }
        if (pops > 4 * S2) break;
      }
      if (found < 0) return null;
      const path = []; for (let s = found; s >= 0; s = from[s]) path.push(s);
      return path.reverse();
    }
    // what a tail costs: its length outside the pad, dearer where other nets are near
    function tailCost(P, st, pf) {
      const sg = tailSeg(P, st); if (!sg) return 0;
      const l = Math.floor(st / N), len = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]), n2 = Math.max(1, Math.ceil(len / (p / 2)));
      let c = 0;
      for (let k = 0; k < n2; k++) {
        const i = Math.round((sg[0] + (sg[2] - sg[0]) * (k + 0.5) / n2) / p), j = Math.round((sg[1] + (sg[3] - sg[1]) * (k + 0.5) / n2) / p);
        c += (len / n2) * (1 + (i >= 0 && j >= 0 && i < nx && j < ny ? pf * softT[l * N + j * nx + i] : 0));
      }
      return c * (1 + histT[st]);
    }
    const ENTRY = 5;
    const entryCache = new Map();
    function entries(r, H, P) {
      const key = r.id + ":" + P.i;
      if (!entryCache.has(key)) entryCache.set(key, entriesOf(r, H, P));
      return entryCache.get(key);
    }
    function entriesOf(r, H, P) {
      const hw = r.w / 2, out = [], ls = P.layers.map(li).filter(l => l >= 0), px = P.pad.x, py = P.pad.y;
      const near = walls.filter(({ it, net }) => net !== r.id && C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], px, py) < ENTRY + it.r + 3).map(({ it, net }) => {
        let g = need(r.id, net);
        if (it.kind === "pad" && it.pad.part === P.pad.part) g = Math.min(g, C.itemGap(P, it) - 0.02);
        const sb = it.kind === "pad" ? SP.get(it.pad) : null;
        return { it, g, sb };
      });
      stamp([px, py, px, py], ENTRY, c => {
        const x = X(c), y = Y(c), seg = [px, py, x, y];
        for (const { it, g, sb } of near) {
          let gg = g;
          const t = C.segItem(seg, it) - hw;
          if (sb && t < gg && Math.hypot(x - sb.x, y - sb.y) <= sb.r && Math.hypot(px - sb.x, py - sb.y) <= sb.r) gg = Math.min(gg, sb.gap - 0.02);
          if (t < gg + MARGIN) return;
        }
        ls.forEach(l => { if (!H.T[l * N + c]) out.push(l * N + c); });
      });
      return out;
    }
    // one net routed afresh on the grid (its keep stays as it is): the pieces joined nearest first
    function routeNet(r, pf) {
      const H = hard(r);
      r.paths = []; r.vias = []; r.ver++;
      const gs = groups(r); r.groupsLeft = 0;
      if (gs.length < 2) return;
      // a pad's cells: those a straight track from its middle reaches within the rules (the check lets the
      // segment entering a pad pass the footprint's other pins as close as the pins are to each other);
      // where there is none, the cells inside it
      // per group, its cells and what starting or finishing at each costs: { c, P } (P: the pad its tail runs to)
      const gcost = gs.map(g => {
        const m = new Map(), put = (s2, c, P) => { const v = m.get(s2); if (!v || c < v.c) m.set(s2, { c, P }); };
        g.forEach(it => {
          const e = it.kind === "pad" ? entries(r, H, it) : [];
          if (e.length) e.forEach(s2 => put(s2, tailCost(it, s2, pf), it));
          else cellsOf(it, r.w).forEach(s2 => put(s2, 0, null));
        });
        return m;
      });
      r.term = new Set(gcost.flatMap(m => [...m.keys()]));
      const boxOf = cells => { let a = Infinity, b = Infinity, c2 = -Infinity, d = -Infinity; cells.forEach(s2 => { const c = s2 % N, i = c % nx, j = (c - i) / nx; a = Math.min(a, i); b = Math.min(b, j); c2 = Math.max(c2, i); d = Math.max(d, j); }); return [a, b, c2, d]; };
      const boxes = gcost.map(m => boxOf([...m.keys()]));
      // start from the biggest piece
      let start = 0; gs.forEach((g, k) => { if (g.length > gs[start].length) start = k; });
      const tree = new Map(gcost[start]), tbox = boxes[start].slice(), left = new Set(gs.map((_, k) => k)); left.delete(start);
      const gapBox = (a, b) => Math.max(0, a[0] - b[2], b[0] - a[2]) + Math.max(0, a[1] - b[3], b[1] - a[3]);
      const failed = new Set();
      while (left.size) {
        const k = [...left].filter(q => !failed.has(q)).sort((a, b) => gapBox(boxes[a], tbox) - gapBox(boxes[b], tbox))[0];
        if (k === undefined) break;
        const path = astar(r, H, tree, gcost[k], boxes[k], pf);
        if (!path) { failed.add(k); continue; }
        left.delete(k); failed.clear();
        path.a = tree.get(path[0]).P; path.b = gcost[k].get(path[path.length - 1]).P;
        r.paths.push(path);
        for (let m = 1; m < path.length; m++) if (Math.floor(path[m] / N) !== Math.floor(path[m - 1] / N)) r.vias.push(path[m] % N);
        gcost[k].forEach((v, s2) => { const t = tree.get(s2); if (!t || v.c < t.c) tree.set(s2, v); });
        path.forEach(s2 => tree.set(s2, { c: 0, P: null }));
        const nb = boxOf(path.concat([...gcost[k].keys()])); tbox[0] = Math.min(tbox[0], nb[0]); tbox[1] = Math.min(tbox[1], nb[1]); tbox[2] = Math.max(tbox[2], nb[2]); tbox[3] = Math.max(tbox[3], nb[3]);
      }
      r.groupsLeft = left.size;
    }
    // the cells of net r's new copper that come too close to others; marks those others' keep in the way
    function conflictsOf(r, rip) {
      soft(r);
      let n = 0;
      const hit = new Map();
      const note = (qi, x, y) => { n++; if (rip) { if (!hit.has(qi)) hit.set(qi, []); hit.get(qi).push([x, y]); } };
      r.paths.forEach(path => path.forEach((s, m) => {
        if (softT[s]) { histT[s] += HINC; note(whoT[s], X(s % N), Y(s % N)); }
        if (m && Math.floor(path[m - 1] / N) !== Math.floor(s / N) && softV[s % N]) { histV[s % N] += HINC; note(whoV[s % N], X(s % N), Y(s % N)); }
      }));
      r.paths.forEach(path => tails(path).forEach(([P, st]) => { const s2 = tailHitAt(P, st); if (s2 >= 0) { histT[st] += HINC; note(whoT[s2], X(s2 % N), Y(s2 % N)); } }));
      // the keep copper of other nets a new route of this one runs over comes up (its net is joined again)
      if (rip) hit.forEach((pts, qi) => {
        const q = nets.get(netIds[qi]); if (!q || !q.keep.length) return;
        const g = need(r.id, q.id) + r.w / 2 + MARGIN, before = q.keep.length;
        q.keep = q.keep.filter(it => !pts.some(([x, y]) => C.segDist(it.s[0], it.s[1], it.s[2], it.s[3], x, y) < it.r + Math.max(g, viaR - r.w / 2 + g)));
        if (q.keep.length !== before) { q.dirty = true; q.ver++; }
      });
      return n;
    }
    const time = o.time || 20000, maxIt = o.iters || 40, HINC = o.hinc || 0.5, PFM = o.pfm || 1.6;
    let pf = 0.5, it = 0, total = 0;
    for (; it < maxIt && Date.now() - t0 < time; it++) {
      const todo = [...nets.values()].filter(r => r.dirty || (o.all && it > 2 && total && r.paths.length));
      if (!todo.length) break;
      // the nets with most to do first
      todo.sort((a, b) => b.keep.length - a.keep.length);
      todo.forEach(r => { r.dirty = false; soft(r); routeNet(r, pf); });
      // who is in conflict now: their pieces come up and they go round again
      total = 0;
      nets.forEach(r => { if (!r.paths.length) return; const n = conflictsOf(r, true); if (n) { r.dirty = true; total += n; } });
      if (o.progress) { let left = 0; nets.forEach(r => { left += r.groupsLeft; }); o.progress({ pass: it + 1, passes: maxIt, conflicts: total, left, ms: Date.now() - t0, time }); }
      if (!total && ![...nets.values()].some(r => r.dirty)) { it++; break; }
      pf *= PFM;
    }
    const tailHit = (P, st) => tailHitAt(P, st) >= 0;
    // what conflicts still: the route in most conflict is dropped, and again, until none is left
    const vias = r => { r.vias = []; r.ver++; r.paths.forEach(path => { for (let m = 1; m < path.length; m++) if (Math.floor(path[m] / N) !== Math.floor(path[m - 1] / N)) r.vias.push(path[m] % N); }); };
    for (let guard = 0; guard < 500; guard++) {
      let worst = null;
      nets.forEach(r => {
        if (!r.paths.length) return; soft(r);
        r.paths.forEach((path, pi) => {
          let n = 0; path.forEach((s, m) => { if (softT[s] || (m && Math.floor(path[m - 1] / N) !== Math.floor(s / N) && softV[s % N])) n++; });
          tails(path).forEach(([P, st]) => { if (tailHit(P, st)) n++; });
          if (n && (!worst || n > worst.n)) worst = { r, pi, n };
        });
      });
      if (!worst) break;
      if (o.debug) { const path = worst.r.paths[worst.pi]; soft(worst.r); const bad = path.filter(s => softT[s]).map(s => [X(s % N), Y(s % N), names[netIds[whoT[s]]]]); o.debug.push({ net: names[worst.r.id], n: worst.n, len: path.length, a: path.a && path.a.pad.ref + "-" + path.a.pad.num, b: path.b && path.b.pad.ref + "-" + path.b.pad.num, bad: bad.slice(0, 3), tails: tails(path).map(([P, st]) => tailHit(P, st)) }); }
      worst.r.paths.splice(worst.pi, 1); worst.r.groupsLeft++; vias(worst.r);
    }
    // stairs pulled straight: on each layer a path's cells are joined again by one straight or 45° run, or a
    // straight and a 45° one, wherever every cell of that is free of walls and of other nets' copper
    const DIR = (a, b) => (a > 0) - (a < 0);
    function legs(c1, c2, diagFirst) {
      let i = c1 % nx, j = (c1 - i) / nx; const i2 = c2 % nx, j2 = (c2 - i2) / nx, out = [];
      const dx = i2 - i, dy = j2 - j, d = Math.min(Math.abs(dx), Math.abs(dy)), sx = DIR(dx, 0), sy = DIR(dy, 0);
      const diag = () => { for (let k = 0; k < d; k++) { i += sx; j += sy; out.push(j * nx + i); } };
      const line = () => { while (i !== i2 || j !== j2) { i += i !== i2 ? sx : 0; j += j !== j2 ? sy : 0; out.push(j * nx + i); } };
      if (diagFirst) { diag(); line(); } else { const ex = Math.abs(dx) - d, ey = Math.abs(dy) - d; for (let k = 0; k < ex; k++) { i += sx; out.push(j * nx + i); } for (let k = 0; k < ey; k++) { j += sy; out.push(j * nx + i); } diag(); }
      return out;
    }
    function straighten(r) {
      const H = hard(r); soft(r);
      const free = (l, c) => !H.T[l * N + c] && !softT[l * N + c] && !nearT[c];
      let changed = false;
      // cells where another path of the net joins on (its ends) stay where they are
      const pin = new Set(); r.paths.forEach(path => { pin.add(path[0] % N); pin.add(path[path.length - 1] % N); });
      r.paths = r.paths.map(path => {
        const out = [path[0]];
        let k = 0;
        while (k < path.length - 1) {
          const l = Math.floor(path[k] / N);
          let best = null, miss = 0;
          for (let j = k + 2; j < path.length && Math.floor(path[j] / N) === l && miss < 40 && !pin.has(path[j - 1] % N); j++) {
            let got = null;
            for (const df of [true, false]) { const cs = legs(path[k] % N, path[j] % N, df); if (cs.length <= j - k && cs.every(c => free(l, c))) { got = cs; break; } }
            if (got) { best = { j, cs: got }; miss = 0; } else miss++;
          }
          if (best) { best.cs.forEach(c => out.push(l * N + c)); k = best.j; changed = true; } else { out.push(path[k + 1]); k++; }
        }
        out.a = path.a; out.b = path.b;
        return out;
      });
      if (changed) r.ver++;
    }
    nets.forEach(r => { if (r.paths.length) straighten(r); });
    // loops: a kept piece of the board's copper that the new routes made needless (a stub left at a pad beside the
    // track that now runs there, a piece of an old route the new one runs alongside) comes up too, so no
    // connection is laid twice. A piece goes only if every pad it joined stays joined without it
    nets.forEach(r => {
      if (!r.paths.length || !r.keep.length) return;
      const padGroups = () => {
        const all = r.fixed.map(it => ({ s: it.s, r: it.r, ls: it.layers.map(li), it })).concat(shapes(r)), par = all.map((_, i) => i), f = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
        for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
          const a = all[i], b = all[j], pa = a.it && a.it.kind === "pad", pb = b.it && b.it.kind === "pad";
          if (pa && pb) { if (pourJoined.has(a.it) && pourJoined.has(b.it) && a.it.cluster === b.it.cluster) par[f(i)] = f(j); continue; }
          if (a.ls.some(l => b.ls.includes(l)) && C.segSeg(a.s, b.s) - a.r - b.r <= 1e-6) par[f(i)] = f(j);
        }
        return new Set(all.map((a, i) => a.it && a.it.kind === "pad" ? f(i) : -1).filter(g => g >= 0)).size;
      };
      const pieces = [], byT = new Map();
      r.keep.forEach(it => { if (it.kind === "via") pieces.push([it]); else if (it.kind === "track") { if (!byT.has(it.ti)) byT.set(it.ti, []); byT.get(it.ti).push(it); } });
      byT.forEach(list => { list.sort((u, v) => u.k - v.k); list.forEach(it => { const last = pieces.length && pieces[pieces.length - 1]; if (last && last[0].kind === "track" && last[0].ti === it.ti && last[last.length - 1].k === it.k - 1) last.push(it); else pieces.push([it]); }); });
      const lenOf = pc => pc.reduce((a, it) => a + Math.hypot(it.s[2] - it.s[0], it.s[3] - it.s[1]), 0);
      pieces.sort((a, b) => lenOf(a) - lenOf(b));
      const base = padGroups();
      pieces.forEach(pc => {
        const was = r.keep, gone = new Set(pc);
        r.keep = was.filter(it => !gone.has(it)); r.ver++;
        if (padGroups() > base) { r.keep = was; r.ver++; }
      });
    });
    // the board's copper left hanging where pieces of it came up: a run of a track whose end meets nothing of its
    // net is cut back to where it last meets something (a segment met only in its middle is shortened, not
    // dropped, so a route joined there stays joined), and a via that meets nothing goes
    nets.forEach(r => {
      for (let pass = 0; pass < 200; pass++) {
        const all = shapes(r).concat(r.fixed.map(it => ({ s: it.s, r: it.r, ls: it.layers.map(li), it })));
        const byT = new Map(); r.keep.forEach(it => { if (it.kind === "track") { if (!byT.has(it.ti)) byT.set(it.ti, []); byT.get(it.ti).push(it); } });
        const swap = new Map();
        byT.forEach(list => {
          list.sort((u, v) => u.k - v.k);
          const runsOf = []; list.forEach(it => { const last = runsOf[runsOf.length - 1]; if (last && last[last.length - 1].k === it.k - 1) last.push(it); else runsOf.push([it]); });
          runsOf.forEach(run => {
            const own = new Set(run), ls = run[0].layers.map(li), w = run[0].r;
            const meets = (x, y, d) => all.some(q => !own.has(q.it) && q.ls.some(l => ls.includes(l)) && C.segDist(q.s[0], q.s[1], q.s[2], q.s[3], x, y) <= q.r + w + 1e-6 - (d || 0));
            // the end at (s[e], s[e+1]) of item it: how far along it the first meeting is (1: none)
            const cut = (it, fromStart) => {
              const [x1, y1, x2, y2] = fromStart ? it.s : [it.s[2], it.s[3], it.s[0], it.s[1]], L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / 0.05));
              // (cut a little into what it meets, so rounding the end leaves it touching)
              let first = 1;
              for (let k = 0; k <= n; k++) { const x = x1 + (x2 - x1) * k / n, y = y1 + (y2 - y1) * k / n; if (first === 1 && meets(x, y)) first = k / n; if (meets(x, y, 0.05)) return k / n; }
              return first;
            };
            const a = run[0], b = run[run.length - 1];
            [[a, true], [b, false]].forEach(([it, st]) => {
              const cur = swap.get(it) || it, [ex, ey] = st ? [cur.s[0], cur.s[1]] : [cur.s[2], cur.s[3]];
              if (meets(ex, ey)) return;
              const t = cut(cur, st);
              if (t >= 1 || (it === a && it === b && swap.has(it) && swap.get(it) === null)) { swap.set(it, null); return; }
              const s2 = cur.s.slice();
              if (st) { s2[0] = cur.s[0] + (cur.s[2] - cur.s[0]) * t; s2[1] = cur.s[1] + (cur.s[3] - cur.s[1]) * t; }
              else { s2[2] = cur.s[2] + (cur.s[0] - cur.s[2]) * t; s2[3] = cur.s[3] + (cur.s[1] - cur.s[3]) * t; }
              swap.set(it, Object.assign(Object.create(Object.getPrototypeOf(it)), it, { s: s2, orig: it.orig || it }));
            });
          });
        });
        const vgone = new Set();
        r.keep.forEach(it => { if (it.kind === "via" && L.some((_, l) => !all.some(q => q.it !== it && q.ls.includes(l) && C.segDist(q.s[0], q.s[1], q.s[2], q.s[3], it.s[0], it.s[1]) <= q.r + it.r + 1e-6))) vgone.add(it); });
        if (!swap.size && !vgone.size) break;
        r.keep = r.keep.filter(it => !vgone.has(it)).map(it => swap.has(it) ? swap.get(it) : it).filter(Boolean); r.ver++;
      }
    });
    // the result: the board's copper that came up, and the grid paths as tracks and vias
    const kept = new Map(); nets.forEach(r => r.keep.forEach(it => kept.set(it.orig || it, it)));
    const cutT = new Set(), cutV = new Set();
    isKeep.forEach(it => { if (kept.has(it) && kept.get(it) === it) return; if (it.kind === "track") cutT.add(it.ti); if (it.kind === "via" && !kept.has(it)) cutV.add(it.vi); });
    // a track only partly in the way (or cut back) comes up whole; the pieces of it still kept are put back as
    // tracks of their own
    const addT = [], addV = [], r4 = v => +v.toFixed(4);
    cutT.forEach(ti => {
      const t = board.tracks[ti], segs = [];
      conn.items.forEach(q => { if (q.kind === "track" && q.ti === ti && isKeep.has(q) && kept.has(q)) segs.push(kept.get(q)); });
      segs.sort((a, b) => a.k - b.k);
      let cur = null;
      segs.forEach(q => {
        const a = [r4(q.s[0]), r4(q.s[1])], b = [r4(q.s[2]), r4(q.s[3])];
        if (cur && cur.last === q.k - 1 && Math.hypot(cur.pts[cur.pts.length - 1][0] - a[0], cur.pts[cur.pts.length - 1][1] - a[1]) < 1e-6) { cur.pts.push(b); cur.last = q.k; }
        else { if (cur) addT.push(cur); cur = { pts: [a, b], last: q.k, layer: t.layer, w: t.w, net: t.net }; }
      });
      if (cur) addT.push(cur);
    });
    addT.forEach(q => { delete q.last; });
    nets.forEach(r => {
      const name = names[r.id];
      r.paths.forEach(path => {
        // each run of one layer a track; the ends inside a pad go on to its middle
        let k = 0;
        while (k < path.length) {
          const l = Math.floor(path[k] / N); let m = k;
          while (m + 1 < path.length && Math.floor(path[m + 1] / N) === l) m++;
          const cells = path.slice(k, m + 1).map(s => s % N);
          const pts = cells.map(c => [r4(X(c)), r4(Y(c))]);
          const pa = k === 0 && path.a, pb = m === path.length - 1 && path.b;
          if (pa) pts.unshift([r4(pa.pad.x), r4(pa.pad.y)]);
          if (pb) pts.push([r4(pb.pad.x), r4(pb.pad.y)]);
          const simple = pts.filter((q, z) => z === 0 || z === pts.length - 1 || Math.abs((q[0] - pts[z - 1][0]) * (pts[z + 1][1] - q[1]) - (q[1] - pts[z - 1][1]) * (pts[z + 1][0] - q[0])) > 1e-9)
            .filter((q, z, a) => z === 0 || Math.hypot(q[0] - a[z - 1][0], q[1] - a[z - 1][1]) > 1e-6);
          if (simple.length > 1) addT.push({ layer: L[l], w: r.w, pts: simple, net: name });
          k = m + 1;
        }
      });
      r.vias.forEach(c => addV.push({ x: r4(X(c)), y: r4(Y(c)), drill: R.viaDrill, pad: R.viaPad, net: name }));
    });
    let open = 0; nets.forEach(r => { open += r.groupsLeft; });
    return { cut: { tracks: cutT, vias: cutV }, add: { tracks: addT, vias: addV }, open, conflicts: total, iters: it, ms: Date.now() - t0, pitch: p };
  }

  root.BoardPathfinder = { route };
})(typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : globalThis);
