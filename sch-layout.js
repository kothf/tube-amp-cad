/* A schematic drawn the way a person draws one (no DOM, Node-testable): a netlist (parts with the
   net on each pin) placed and wired on a 10-unit grid. Used by AI ▾ → Design from a description.
   The conventions it keeps (help.html, "How the AI draws"):
   - signal flows left to right: parts one net further from the input stand further right
   - supplies at the top, ground at the bottom: rail pins face up, ground pins face down
   - a stage stands in a column: loads above the device, cathode/emitter parts below it, lined up
     so their wires are straight
   - series parts in the signal path lie flat, parts to a rail or ground stand up
   - nearby pins are joined by real wires: short, orthogonal, bending as little as they can,
     never through a part, over another net's pin, along another wire or over a part's text;
     crossings are plain (no dot) and joins are T-junctions
   - one ground line along the bottom with one ground symbol, where a pin can drop to it straight;
     a ground symbol of its own where it cannot
   - a power rail is a rail symbol over the pin (one symbol for neighbours on one rail)
   - labels only where a wire would be long or tangled (a feedback loop across the drawing, the
     oscilloscope's probes): a net label at each end
   Placement is simulated annealing over the parts' positions and turns (seeded, so the same
   netlist always draws the same), routing is A* on the grid, a net at a time, shortest first. */
(function (root) {
  "use strict";
  const L = () => root.CadLib;
  const G = 10;
  const DIRV = [[1, 0], [0, 1], [-1, 0], [0, -1]];            // r d l u (a netlabel's rot)
  const rotPt = (x, y, r) => { switch (r & 3) { case 1: return [-y, x]; case 2: return [-x, -y]; case 3: return [y, -x]; default: return [x, y]; } };
  const snap = v => Math.round(v / G) * G;
  const SOURCES = /^(siggen|pickup|phono)$/;
  const SUPPLIES = /^(vdc|battery|isrc|logicsrc|mains|ptx|ptx_cat)$/;
  const INSTR = /^(scope)$/;

  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // the turns a part may take: [rot, flip]; drawn the way people draw them (tubes upright, a
  // transistor's base or gate on either side, two-pin parts any way)
  function turnsOf(p, nPins) {
    const def = L().LIB[p.type];
    if (def.noRotate) return [[0, false]];
    const mir = !def.noMirror;
    if (p.type === "tube") return mir ? [[0, false], [0, true]] : [[0, false]];
    if (L().isTransistor(p.type)) return [[0, false], [0, true], [2, true], [2, false]];
    if (/^(opamp|chipamp|logic)$/.test(p.type)) return mir ? [[0, false], [2, true]] : [[0, false]];
    if (SOURCES.test(p.type) || SUPPLIES.test(p.type) || p.type === "speaker") return [[0, false], [2, false]];
    if (nPins === 2) return [[0, false], [1, false], [2, false], [3, false]];
    return mir ? [[0, false], [0, true]] : [[0, false]];
  }

  // a part's pins, body box and text box in one turn, relative to its position
  function shape(p, rot, flip) {
    const LIB = L().LIB, def = LIB[p.type], c = { type: p.type, params: p.params, x: 0, y: 0, rot, label: p.ref };
    const raw = (typeof def.pins === "function" ? def.pins(c) : def.pins) || [];
    let b = typeof def.bbox === "function" ? def.bbox(c) : def.bbox;
    const f = flip ? -1 : 1;
    const pins = raw.map(q => {
      const lx = f * q.x, ly = q.y;
      const bx0 = flip ? -b[2] : b[0], bx2 = flip ? -b[0] : b[2];
      // the side of the body the pin is on: its wire leaves that way
      let d;
      if (lx <= bx0 + 1) d = [-1, 0]; else if (lx >= bx2 - 1) d = [1, 0]; else if (ly <= b[1] + 1) d = [0, -1]; else if (ly >= b[3] - 1) d = [0, 1];
      else d = Math.abs(lx) >= Math.abs(ly) && lx !== 0 ? [Math.sign(lx), 0] : [0, ly < 0 ? -1 : 1];
      const [x, y] = rotPt(lx, ly, rot), [dx, dy] = rotPt(d[0], d[1], rot);
      return { id: q.id, x, y, dx, dy };
    });
    if (flip) b = [-b[2], b[1], -b[0], b[3]];
    const a = rotPt(b[0], b[1], rot), e = rotPt(b[2], b[3], rot);
    const box = [Math.min(a[0], e[0]), Math.min(a[1], e[1]), Math.max(a[0], e[0]), Math.max(a[1], e[1])];
    // the designation and value, where the CAD writes them (cad-app.js drawComp)
    let val = ""; try { val = def.value ? String(def.value(c) || "") : ""; } catch (err) { val = ""; }
    const w = 7 * Math.max(String(p.ref).length, val.length) + 4;
    let text = null;
    if (def.noLabel || INSTR.test(p.type)) text = null;
    else if (p.type === "tube") { const side = ((rot & 2) ? -1 : 1) * f; text = side > 0 ? [-30 - w, -42, -30, -10] : [30, -42, 30 + w, -10]; }
    else if (L().isTransistor(p.type)) { const bp = pins.find(q => q.id === "B" || q.id === "G"); text = bp && bp.x < -5 ? [box[2] + 3, -14, box[2] + 5 + w, 14] : [box[0] - 5 - w, -14, box[0] - 3, 14]; }
    else if ((box[3] - box[1]) > (box[2] - box[0]) * 1.2) text = [box[0] - 5 - w, -14, box[0] - 3, 14];
    else text = [-w / 2, box[1] - (val ? 29 : 16), w / 2, box[1] - 2];
    return { pins, box, text };
  }

  // ---------------------------------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------------------------------
  function place(parts, kinds, opts) {
    const n = parts.length, rand = rng(opts.seed || 1);
    const pinIds = parts.map(p => Object.keys(p.pins));
    const turns = parts.map((p, i) => turnsOf(p, pinIds[i].length));
    const shapes = parts.map((p, i) => turns[i].map(([r, f]) => shape(p, r, f)));
    // the nets: the signal ones are wired (cost: their spanning tree), ground and rail pins only
    // want to face down or up
    const nets = new Map();
    parts.forEach((p, i) => Object.entries(p.pins).forEach(([id, net]) => {
      if (kinds.get(net) !== "sig" || INSTR.test(p.type)) return;
      if (!nets.has(net)) nets.set(net, []);
      nets.get(net).push({ i, id });
    }));
    const netList = [...nets.entries()].filter(([, l]) => l.length > 1).map(([name, pins]) => ({ name, pins }));
    const netsOfPart = parts.map(() => []);
    netList.forEach((nt, k) => { new Set(nt.pins.map(q => q.i)).forEach(i => netsOfPart[i].push(k)); });
    const pinIndex = parts.map((p, i) => turns[i].map((t, o) => { const m = new Map(); shapes[i][o].pins.forEach(q => m.set(q.id, q)); return m; }));

    // signal order: from each source a part at a time along the signal nets; blocks the AI named
    // go left to right in the order they came
    const depth = parts.map(() => -1), queue = [];
    parts.forEach((p, i) => { if (SOURCES.test(p.type)) { depth[i] = 0; queue.push(i); } });
    if (!queue.length && n) { const first = parts.findIndex(p => !SUPPLIES.test(p.type) && !INSTR.test(p.type)); if (first >= 0) { depth[first] = 0; queue.push(first); } }
    while (queue.length) {
      const i = queue.shift();
      netsOfPart[i].forEach(k => netList[k].pins.forEach(q => { if (depth[q.i] < 0) { depth[q.i] = depth[i] + 1; queue.push(q.i); } }));
    }
    const maxD = Math.max(0, ...depth);
    parts.forEach((p, i) => { if (depth[i] < 0) depth[i] = SUPPLIES.test(p.type) ? 0 : maxD + 1; });
    const blocks = [];
    parts.forEach(p => { if (p.block && !blocks.includes(p.block)) blocks.push(p.block); });
    const order = parts.map((p, i) => (blocks.length > 1 && p.block ? blocks.indexOf(p.block) * 1000 : 0) + depth[i]);

    // the start: columns in signal order, two-pin parts to a rail or ground standing up
    const X = new Float64Array(n), Y = new Float64Array(n), O = new Int32Array(n);
    const prev = opts.prev || null;
    const ranks = [...new Set(order)].sort((a, b) => a - b), colOf = i => ranks.indexOf(order[i]);
    const colY = [];
    parts.forEach((p, i) => {
      const kept = prev && prev[p.ref];
      if (kept && kept.o < turns[i].length) { X[i] = kept.x; Y[i] = kept.y; O[i] = kept.o; return; }
      let o = 0;
      if (pinIds[i].length === 2 && turns[i].length === 4) {
        const nets2 = pinIds[i].map(id => kinds.get(p.pins[id]));
        if (nets2.some(k => k !== "sig")) {
          // up and down: the rail end up, the ground end down
          o = turns[i].findIndex((t, k) => { const s = shapes[i][k]; return s.pins.every(q => { const kd = kinds.get(p.pins[q.id]); return kd === "gnd" || kd === "neg" ? q.dy > 0 : kd === "rail" ? q.dy < 0 : true; }); });
          if (o < 0) o = 1;
        }
      }
      const c = colOf(i);
      colY[c] = colY[c] || 0;
      X[i] = snap(c * 160); Y[i] = snap(colY[c]); O[i] = o;
      const s = shapes[i][o];
      colY[c] += (s.box[3] - s.box[1]) + 90;
    });
    // instruments stand aside: not placed with the rest
    const fixed = parts.map(p => INSTR.test(p.type));

    const pinAt = (i, id, o = O[i], x = X[i], y = Y[i]) => { const q = pinIndex[i][o].get(id); return q ? { x: x + q.x, y: y + q.y, dx: q.dx, dy: q.dy } : null; };
    const W = { len: 1, bend: 45, back: 90, side: 40, gndSide: 60, gndUp: 160, overlap: 4000, overlapA: 3, flow: 2, size: 0.35 };
    // a net's cost: its spanning tree between pins (manhattan), a bend where two pins are not in
    // line, a pin whose wire would have to turn back
    function netCost(k, ov) {
      const pts = netList[k].pins.map(q => { const o = ov && ov.i === q.i ? ov : null; return Object.assign(pinAt(q.i, q.id, o ? o.o : O[q.i], o ? o.x : X[q.i], o ? o.y : Y[q.i]), { i: q.i }); });
      const m = pts.length, inT = new Array(m).fill(false), best = new Array(m).fill(Infinity), from = new Array(m).fill(-1);
      let cost = 0; best[0] = 0;
      for (let it = 0; it < m; it++) {
        let u = -1; for (let v = 0; v < m; v++) if (!inT[v] && (u < 0 || best[v] < best[u])) u = v;
        inT[u] = true;
        if (from[u] >= 0) cost += edge(pts[from[u]], pts[u]);
        for (let v = 0; v < m; v++) if (!inT[v]) { const d = Math.abs(pts[u].x - pts[v].x) + Math.abs(pts[u].y - pts[v].y); if (d < best[v]) { best[v] = d; from[v] = u; } }
      }
      return cost;
    }
    function face(p, vx, vy) { const d = p.dx * vx + p.dy * vy; return d > 0 ? 0 : d < 0 ? W.back : (vx === 0 && vy === 0 ? 0 : W.side); }
    function edge(a, b) {
      const vx = b.x - a.x, vy = b.y - a.y;
      let c = W.len * (Math.abs(vx) + Math.abs(vy));
      if (vx !== 0 && vy !== 0) c += W.bend;
      c += face(a, vx, vy) + face(b, -vx, -vy);
      if (a.i !== b.i && order[a.i] !== order[b.i]) { const [l, r] = order[a.i] < order[b.i] ? [a, b] : [b, a]; if (r.x < l.x - 20) c += W.flow * (l.x - r.x); }
      return c;
    }
    // a part's own cost: ground pins face down, rail pins up
    function partCost(i, o) {
      let c = 0;
      shapes[i][o].pins.forEach(q => {
        const kd = kinds.get(parts[i].pins[q.id]);
        if (kd === "gnd" || kd === "neg") c += q.dy > 0 ? 0 : q.dy < 0 ? W.gndUp : W.gndSide;
        else if (kd === "rail") c += q.dy < 0 ? 0 : q.dy > 0 ? W.gndUp : W.gndSide;
      });
      return c;
    }
    // the room a part takes: its body (with a gap round it), its text, and the ground or rail
    // symbol on its pins
    const rooms = parts.map((p, i) => shapes[i].map(s => {
      const r = [[s.box[0] - 10, s.box[1] - 10, s.box[2] + 10, s.box[3] + 10]];
      if (s.text) r.push(s.text);
      s.pins.forEach(q => {
        const kd = kinds.get(p.pins[q.id]);
        if (kd === "gnd" || kd === "rail" || kd === "neg") { const ex = q.x + q.dx * 20, ey = q.y + q.dy * 20; r.push([Math.min(q.x, ex) - 14, Math.min(q.y, ey) - (kd === "rail" ? 30 : 0), Math.max(q.x, ex) + 14, Math.max(q.y, ey) + (kd === "gnd" ? 22 : kd === "neg" ? 30 : 0)]); }
        else r.push([q.x + Math.min(0, q.dx * 10) - 2, q.y + Math.min(0, q.dy * 10) - 2, q.x + Math.max(0, q.dx * 10) + 2, q.y + Math.max(0, q.dy * 10) + 2]);
      });
      return r;
    }));
    function overlap(i, oi, xi, yi, j) {
      let c = 0;
      const A = rooms[i][oi], B = rooms[j][O[j]];
      for (const a of A) for (const b of B) {
        const w = Math.min(a[2] + xi, b[2] + X[j]) - Math.max(a[0] + xi, b[0] + X[j]), h = Math.min(a[3] + yi, b[3] + Y[j]) - Math.max(a[1] + yi, b[1] + Y[j]);
        if (w > 0 && h > 0) c += W.overlap + W.overlapA * w * h;
      }
      return c;
    }
    function sizeCost(ov) {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < n; i++) {
        if (fixed[i]) continue;
        const o = ov && ov.i === i ? ov : { o: O[i], x: X[i], y: Y[i] }, b = shapes[i][o.o].box;
        x1 = Math.min(x1, o.x + b[0]); y1 = Math.min(y1, o.y + b[1]); x2 = Math.max(x2, o.x + b[2]); y2 = Math.max(y2, o.y + b[3]);
      }
      if (!isFinite(x1)) return 0;
      const w = x2 - x1, h = y2 - y1;
      return W.size * (w + h) + (h > 0.8 * w ? 0.6 * (h - 0.8 * w) : 0);
    }
    const nc = netList.map((nt, k) => netCost(k));
    const movable = []; for (let i = 0; i < n; i++) if (!fixed[i]) movable.push(i);
    function delta(i, o, x, y) {
      const ov = { i, o, x, y };
      let d = 0;
      const newNc = netsOfPart[i].map(k => netCost(k, ov));
      netsOfPart[i].forEach((k, t) => { d += newNc[t] - nc[k]; });
      d += partCost(i, o) - partCost(i, O[i]);
      for (const j of movable) if (j !== i) d += overlap(i, o, x, y, j) - overlap(i, O[i], X[i], Y[i], j);
      d += sizeCost(ov) - sizeCost(null);
      return { d, newNc };
    }
    function apply(i, o, x, y, newNc) { O[i] = o; X[i] = x; Y[i] = y; netsOfPart[i].forEach((k, t) => { nc[k] = newNc[t]; }); }

    const iters = movable.length < 2 ? 0 : Math.round((opts.effort || 1) * Math.min(70000, 1800 * movable.length));
    let T = opts.t0 || 400;
    const Tend = 1.5, k = iters ? Math.pow(Tend / T, 1 / iters) : 1;
    const step = () => { const r = rand(); return (r < 0.5 ? 1 : r < 0.8 ? 3 : 10) * (rand() < 0.5 ? -1 : 1) * G * (1 + Math.floor(rand() * 3)); };
    for (let it = 0; it < iters; it++, T *= k) {
      const i = movable[Math.floor(rand() * movable.length)];
      let o = O[i], x = X[i], y = Y[i];
      const r = rand();
      if (r < 0.15 && turns[i].length > 1) o = Math.floor(rand() * turns[i].length);
      else if (r < 0.45 && netsOfPart[i].length) {
        // line one of its pins up with a pin it is wired to
        const nt = netList[netsOfPart[i][Math.floor(rand() * netsOfPart[i].length)]];
        const mine = nt.pins.filter(q => q.i === i), other = nt.pins.filter(q => q.i !== i);
        if (mine.length && other.length) {
          const a = mine[Math.floor(rand() * mine.length)], b = other[Math.floor(rand() * other.length)];
          if (rand() < 0.3 && turns[i].length > 1) o = Math.floor(rand() * turns[i].length);
          const pa = pinIndex[i][o].get(a.id), pb = pinAt(b.i, b.id);
          if (rand() < 0.5) x = pb.x - pa.x; else y = pb.y - pa.y;
        }
      } else if (r < 0.55) {
        // trade places with another part
        const j = movable[Math.floor(rand() * movable.length)];
        if (j !== i) {
          const a = delta(i, O[i], X[j], Y[j]); const xi = X[i], yi = Y[i];
          if (a.d < Infinity) {
            const save = { o: O[i], x: X[i], y: Y[i], nc: netsOfPart[i].map(kk => nc[kk]) };
            apply(i, O[i], X[j], Y[j], a.newNc);
            const b = delta(j, O[j], xi, yi);
            if (a.d + b.d <= 0 || rand() < Math.exp(-(a.d + b.d) / T)) { apply(j, O[j], xi, yi, b.newNc); continue; }
            O[i] = save.o; X[i] = save.x; Y[i] = save.y; netsOfPart[i].forEach((kk, t) => { nc[kk] = save.nc[t]; });
          }
        }
        continue;
      } else { if (rand() < 0.5) x += step(); else y += step(); }
      x = snap(x); y = snap(y);
      if (o === O[i] && x === X[i] && y === Y[i]) continue;
      const { d, newNc } = delta(i, o, x, y);
      if (d <= 0 || rand() < Math.exp(-d / T)) apply(i, o, x, y, newNc);
    }
    return parts.map((p, i) => ({ x: X[i], y: Y[i], o: O[i], rot: turns[i][O[i]][0], flip: turns[i][O[i]][1], shape: shapes[i][O[i]] }));
  }

  // ---------------------------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------------------------
  function Grid(x1, y1, x2, y2) {
    const ox = Math.floor(x1 / G) - 1, oy = Math.floor(y1 / G) - 1, W = Math.ceil(x2 / G) - ox + 2, H = Math.ceil(y2 / G) - oy + 2, N = W * H;
    const g = { ox, oy, W, H, N,
      body: new Uint8Array(N), text: new Uint8Array(N), pin: new Int32Array(N).fill(-1), pinD: new Int8Array(N).fill(-1),
      res: new Int32Array(N).fill(-1), h: new Int32Array(N).fill(-1), v: new Int32Array(N).fill(-1), node: new Int32Array(N).fill(-1), deg: new Uint8Array(N) };
    g.at = (x, y) => { const cx = Math.round(x / G) - ox, cy = Math.round(y / G) - oy; return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cx + cy * W; };
    g.xy = c => [(c % W + ox) * G, (Math.floor(c / W) + oy) * G];
    g.rect = (arr, r, val) => { for (let y = Math.ceil(r[1] / G) * G; y <= r[3]; y += G) for (let x = Math.ceil(r[0] / G) * G; x <= r[2]; x += G) { const c = g.at(x, y); if (c >= 0) arr[c] = val; } };
    g.free = c => c >= 0 && !g.body[c] && g.res[c] === -1 && g.pin[c] < 0 && g.h[c] < 0 && g.v[c] < 0 && g.node[c] < 0;
    return g;
  }
  const dirIdx = (dx, dy) => (dx > 0 ? 0 : dy > 0 ? 1 : dx < 0 ? 2 : 3);

  // a path of cells onto the grid as net `net`: occupancy and the wires (merged straight runs)
  function lay(g, net, cells, wires) {
    const last = cells[cells.length - 1], wasMid = g.node[last] < 0 && g.pin[last] < 0 && (g.h[last] === net || g.v[last] === net);
    for (let k = 0; k < cells.length; k++) {
      const c = cells[k];
      if (k + 1 < cells.length) { const d = cells[k + 1] - c, hor = Math.abs(d) === 1; (hor ? g.h : g.v)[c] = net; (hor ? g.h : g.v)[cells[k + 1]] = net; }
    }
    const ends = [0];
    for (let k = 1; k < cells.length - 1; k++) if (cells[k] - cells[k - 1] !== cells[k + 1] - cells[k]) ends.push(k);
    ends.push(cells.length - 1);
    // a wire ending on the middle of another of its net's wires makes a T there
    const tail = last, mid = wasMid;
    ends.forEach(k => { g.node[cells[k]] = net; });
    g.deg[cells[0]]++; if (mid) g.deg[tail] = 3; else g.deg[tail]++;
    for (let t = 0; t + 1 < ends.length; t++) { const [x1, y1] = g.xy(cells[ends[t]]), [x2, y2] = g.xy(cells[ends[t + 1]]); if (x1 !== x2 || y1 !== y2) wires.push({ x1, y1, x2, y2 }); }
  }

  // the cheapest way from a pin (leaving the way it faces) to any cell of its net already drawn
  function search(g, net, start, sd, isTarget, limit) {
    const COST = { step: 1, bend: 6, cross: 14, text: 25, near: 1, beside: 3, four: 40 };
    const N = g.N, best = new Float64Array(N * 4).fill(Infinity), prev = new Int32Array(N * 4).fill(-1);
    // binary heap of [f, state]
    const heap = [], push = (f, s) => { heap.push([f, s]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const s0 = start * 4 + sd; best[s0] = 0; push(0, s0);
    const W = g.W, step = [1, W, -1, -W];
    const near = c => { for (let d = 0; d < 4; d++) { const e = c + step[d]; if (e >= 0 && e < N && g.body[e]) return true; } return false; };
    let pops = 0;
    while (heap.length) {
      const [, s] = pop(), c = s >> 2, d = s & 3, gc = best[s];
      if (++pops > 400000) break;
      if (gc > limit) break;
      if (c !== start && isTarget(c)) {
        const cells = []; let t = s; while (t >= 0) { cells.push(t >> 2); t = prev[t]; }
        return { cells: cells.reverse(), cost: gc };
      }
      for (let d2 = 0; d2 < 4; d2++) {
        if (d2 === ((d + 2) & 3)) continue;
        if (c === start && d2 !== sd) continue;
        const cx = c % W;
        if ((d2 === 0 && cx === W - 1) || (d2 === 2 && cx === 0)) continue;
        const c2 = c + step[d2]; if (c2 < 0 || c2 >= N) continue;
        let cost = COST.step;
        if (d2 !== d && c !== start) {
          // a bend: only where no other net is
          if ((g.h[c] >= 0 && g.h[c] !== net) || (g.v[c] >= 0 && g.v[c] !== net)) continue;
          cost += COST.bend;
        }
        const hor = d2 === 0 || d2 === 2, along = hor ? g.h : g.v, across = hor ? g.v : g.h;
        if (along[c2] >= 0 && along[c2] !== net) continue;
        if (isTarget(c2)) {
          // onto its own net: a pin only from the side it faces; a fourth wire at a junction costs
          if (g.pin[c2] === net && g.pinD[c2] >= 0 && g.pinD[c2] !== ((d2 + 2) & 3)) continue;
          if (g.deg[c2] >= 3 || (g.h[c2] === net && g.v[c2] === net)) cost += COST.four;
        } else {
          if (g.body[c2] || g.pin[c2] >= 0 || g.node[c2] >= 0 || (g.res[c2] !== -1 && g.res[c2] !== net)) continue;
          if (across[c2] >= 0 && across[c2] !== net) cost += COST.cross;
          if (g.text[c2]) cost += COST.text;
          if (near(c2)) cost += COST.near;
          // close beside another net's wire running the same way
          const s1 = hor ? c2 - W : c2 - 1, s2 = hor ? c2 + W : c2 + 1;
          if ((s1 >= 0 && along[s1] >= 0 && along[s1] !== net) || (s2 < N && along[s2] >= 0 && along[s2] !== net)) cost += COST.beside;
        }
        const s2i = c2 * 4 + d2, ng = gc + cost;
        if (ng < best[s2i]) { best[s2i] = ng; prev[s2i] = s; push(ng, s2i); }
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------------
  // The drawing
  // ---------------------------------------------------------------------------------------------
  // checked: { parts: [{ ref, type, params, pins: { id: net }, block? }], rails: Map(net → volts) }
  // → { comps: [{ type, params, x, y, rot, label }], wires: [{ x1, y1, x2, y2 }], places: { ref: { x, y, o } }, labels: [net] }
  function draw(checked, opts) {
    opts = opts || {};
    // a drawing that leaves a connection open (no room for a wire or labels) is drawn again from
    // another start; the best of the tries
    let best = null;
    for (let t = 0; t < (opts.prev ? 1 : 4); t++) {
      const out = drawOnce(checked, opts, t);
      if (!best || out.open.length < best.open.length || (out.open.length === best.open.length && out.labels.length < best.labels.length)) best = out;
      if (!best.open.length) break;
    }
    return best;
  }
  function drawOnce(checked, opts, attempt) {
    const { parts, rails } = checked;
    const users = new Map();
    parts.forEach(p => Object.values(p.pins).forEach(net => users.set(net, (users.get(net) || 0) + 1)));
    const kinds = new Map();
    users.forEach((cnt, net) => kinds.set(net, net === "GND" ? "gnd" : rails.has(net) ? (rails.get(net) < 0 ? "neg" : "rail") : "sig"));
    const seed = hash(parts.map(p => p.ref + ":" + p.type + ":" + Object.entries(p.pins).map(e => e.join("=")).join(",")).join(";"));
    const at = place(parts, kinds, { seed: seed + attempt * 7919, prev: opts.prev, effort: opts.effort, t0: opts.prev ? 60 : undefined });
    const out = { comps: [], wires: [], places: {}, labels: [], open: [] };

    // the oscilloscope (instruments) beside the drawing, at its top right
    let bx1 = Infinity, by1 = Infinity, bx2 = -Infinity, by2 = -Infinity;
    parts.forEach((p, i) => { if (INSTR.test(p.type)) return; const s = at[i].shape, r = [s.box].concat(s.text ? [s.text] : []); r.forEach(b => { bx1 = Math.min(bx1, at[i].x + b[0]); by1 = Math.min(by1, at[i].y + b[1]); bx2 = Math.max(bx2, at[i].x + b[2]); by2 = Math.max(by2, at[i].y + b[3]); }); });
    if (!isFinite(bx1)) { bx1 = by1 = 0; bx2 = by2 = 100; }
    let ix = snap(bx2 + 160);
    parts.forEach((p, i) => { if (!INSTR.test(p.type)) return; const s = at[i].shape; at[i].x = snap(ix - s.box[0]); at[i].y = snap(by1 + 40 - s.box[1]); ix = at[i].x + s.box[2] + 120; });

    // the grid over everything with room round it
    let gx1 = bx1, gy1 = by1, gx2 = bx2, gy2 = by2;
    parts.forEach((p, i) => { const b = at[i].shape.box; gx1 = Math.min(gx1, at[i].x + b[0]); gy1 = Math.min(gy1, at[i].y + b[1]); gx2 = Math.max(gx2, at[i].x + b[2]); gy2 = Math.max(gy2, at[i].y + b[3]); });
    const g = Grid(gx1 - 200, gy1 - 200, gx2 + 200, gy2 + 260);
    const netId = new Map(); let nid = 0;
    const idOf = net => { if (!netId.has(net)) netId.set(net, nid++); return netId.get(net); };
    const pinsOf = parts.map((p, i) => at[i].shape.pins.map(q => ({ id: q.id, x: at[i].x + q.x, y: at[i].y + q.y, dx: q.dx, dy: q.dy, net: p.pins[q.id] })).filter(q => q.net !== undefined));
    parts.forEach((p, i) => {
      const s = at[i].shape;
      g.rect(g.body, [at[i].x + s.box[0], at[i].y + s.box[1], at[i].x + s.box[2], at[i].y + s.box[3]], 1);
      if (s.text) g.rect(g.text, [at[i].x + s.text[0], at[i].y + s.text[1], at[i].x + s.text[2], at[i].y + s.text[3]], 1);
    });
    parts.forEach((p, i) => pinsOf[i].forEach(q => { const c = g.at(q.x, q.y); g.body[c] = 0; g.pin[c] = idOf(q.net); g.pinD[c] = dirIdx(q.dx, q.dy); }));
    // a pin keeps the cell in front of it for its own net
    const front = q => g.at(q.x + q.dx * G, q.y + q.dy * G);
    parts.forEach((p, i) => pinsOf[i].forEach(q => { const c = front(q); if (c >= 0 && g.pin[c] < 0) g.res[c] = g.res[c] === -1 ? idOf(q.net) : -2; }));

    const addComp = (type, params, x, y, rot, label) => { const o = { type, params, x, y, rot }; if (label) o.label = label; out.comps.push(o); return o; };
    const pathCells = (pts) => { const cells = []; for (let k = 0; k + 1 < pts.length; k++) { const [x1, y1] = pts[k], [x2, y2] = pts[k + 1], n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / G, sx = Math.sign(x2 - x1) * G, sy = Math.sign(y2 - y1) * G; for (let t = k ? 1 : 0; t <= n; t++) cells.push(g.at(x1 + sx * t, y1 + sy * t)); } return cells; };
    const clear = (cells, net, okText) => cells.every((c, k) => c >= 0 && (k === 0 || ((!g.body[c] || false) && (g.pin[c] < 0 || g.pin[c] === net) && (g.h[c] < 0 || g.h[c] === net) && (g.v[c] < 0 || g.v[c] === net) && (g.node[c] < 0 || g.node[c] === net) && (g.res[c] === -1 || g.res[c] === net) && (okText || !g.text[c]))));
    const block = r => { for (let y = Math.ceil(r[1] / G) * G; y <= r[3]; y += G) for (let x = Math.ceil(r[0] / G) * G; x <= r[2]; x += G) { const c = g.at(x, y); if (c >= 0 && g.pin[c] < 0 && g.res[c] === -1 && g.node[c] < 0 && g.h[c] < 0 && g.v[c] < 0) g.body[c] = 1; } };

    const textW = name => 7 * String(name).length + 6;
    const labelBox = (x, y, rot, name) => (rot === 2 ? [x - 3 - textW(name), y - 16, x, y - 2] : [x, y - 16, x + 3 + textW(name), y - 2]);
    const boxFree = (r, okText) => { for (let y = Math.ceil(r[1] / G) * G; y <= r[3]; y += G) for (let x = Math.ceil(r[0] / G) * G; x <= r[2]; x += G) { const c = g.at(x, y); if (c < 0 || g.body[c] || (!okText && g.text[c]) || g.pin[c] >= 0 || g.res[c] !== -1 || g.node[c] >= 0 || g.h[c] >= 0) return false; } return true; };
    // a ground or rail symbol on a pin: a short stub the way the pin faces, turning toward the
    // way the symbol points (want: [dx, dy]) when the pin faces sideways
    const symRot = (type, d) => (type === "ground" ? (d[1] < 0 ? 2 : 0) : [[0, -1], [1, 0], [0, 1], [-1, 0]].findIndex(v => v[0] === d[0] && v[1] === d[1]));
    const symRoom = (type, x, y, d) => {
      if (type === "ground") return d[1] < 0 ? [x - 12, y - 20, x + 12, y - 10] : [x - 12, y + 10, x + 12, y + 20];
      if (d[1] < 0) return [x - 30, y - 50, x + 30, y - 10];
      if (d[1] > 0) return [x - 30, y + 10, x + 30, y + 50];
      return d[0] > 0 ? [x + 10, y - 8, x + 90, y + 8] : [x - 90, y - 8, x - 10, y + 8];
    };
    // how much of a box is taken (a cell in front of a pin counts most)
    const busy = r => { let k = 0; for (let y = Math.ceil(r[1] / G) * G; y <= r[3]; y += G) for (let x = Math.ceil(r[0] / G) * G; x <= r[2]; x += G) { const c = g.at(x, y); if (c < 0) continue; if (g.res[c] !== -1) k += 20; else if (g.body[c] || g.pin[c] >= 0 || g.node[c] >= 0 || g.h[c] >= 0 || g.v[c] >= 0) k += 1; } return k; };
    function symbolAt(q, net, type, want, params) {
      const id = idOf(net), opts2 = [];
      for (const len of [20, 30, 40, 60]) {
        const ex = q.x + q.dx * len, ey = q.y + q.dy * len;
        if (q.dx * want[0] + q.dy * want[1] === 0) for (const up of [20, 30]) opts2.push({ pts: [[q.x, q.y], [ex, ey], [ex + want[0] * up, ey + want[1] * up]], d: want });
        else opts2.push({ pts: [[q.x, q.y], [ex, ey]], d: [q.dx, q.dy] });
      }
      // or pointing the way the pin faces (a rail sideways; ground only downward)
      if (q.dx && type === "rail") for (const len of [20, 40]) opts2.push({ pts: [[q.x, q.y], [q.x + q.dx * len, q.y]], d: [q.dx, 0] });
      let pick = opts2.find(o => { const e = o.pts[o.pts.length - 1]; return clear(pathCells(o.pts), id, false) && boxFree(symRoom(type, e[0], e[1], o.d), true); })
        || opts2.filter(o => clear(pathCells(o.pts), id, true)).map(o => { const e = o.pts[o.pts.length - 1]; return { o, k: busy(symRoom(type, e[0], e[1], o.d)) }; }).sort((a, b) => a.k - b.k).map(a => a.o)[0] || opts2[0];
      const e = pick.pts[pick.pts.length - 1];
      lay(g, id, pathCells(pick.pts), out.wires);
      addComp(type, params, e[0], e[1], symRot(type, pick.d));
      block(symRoom(type, e[0], e[1], pick.d));
    }

    // rails: a symbol over each pin (under it for a negative supply); neighbours on one rail at
    // one height share one
    const railPins = new Map();
    parts.forEach((p, i) => pinsOf[i].forEach(q => { if (kinds.get(q.net) === "rail" || kinds.get(q.net) === "neg") { if (!railPins.has(q.net)) railPins.set(q.net, []); railPins.get(q.net).push(q); } }));
    railPins.forEach((list, net) => {
      const id = idOf(net), done = new Set(), params = { name: net, v: rails.get(net), shown: "" }, s = kinds.get(net) === "neg" ? 1 : -1;
      const facing = list.filter(q => q.dy === s).sort((a, b) => a.x - b.x);
      facing.forEach(q => {
        if (done.has(q)) return;
        // pins in a row (same height, close, with a clear line past them) share a symbol
        const row = [q], ly = q.y + s * 20;
        facing.forEach(r => {
          const last = row[row.length - 1];
          if (r === q || done.has(r) || r.y !== q.y || r.x <= last.x || r.x - last.x > 240) return;
          if (clear(pathCells([[last.x, ly], [r.x, ly]]), id, false) && clear(pathCells([[r.x, r.y], [r.x, ly]]), id, false)) row.push(r);
        });
        if (row.length === 1 || !clear(pathCells([[q.x, q.y], [q.x, ly]]), id, false)) { done.add(q); symbolAt(q, net, "rail", [0, s], params); return; }
        row.forEach(r => done.add(r));
        row.forEach(r => lay(g, id, pathCells([[r.x, r.y], [r.x, ly]]), out.wires));
        lay(g, id, pathCells([[row[0].x, ly], [row[row.length - 1].x, ly]]), out.wires);
        // the symbol on a stem from between two of the pins (a T, not a four-way join)
        const ax = snap((row[0].x + row[1].x) / 2);
        lay(g, id, pathCells([[ax, ly], [ax, ly + s * 10]]), out.wires);
        addComp("rail", params, ax, ly + s * 10, s < 0 ? 0 : 2);
        block(symRoom("rail", ax, ly + s * 10, [0, s]));
      });
      list.filter(q => q.dy !== s).forEach(q => symbolAt(q, net, "rail", [0, s], params));
    });

    // ground: pins facing down drop straight to one line under the drawing; the rest get a symbol
    const gnd = idOf("GND"), gndPins = [];
    parts.forEach((p, i) => pinsOf[i].forEach(q => { if (q.net === "GND") gndPins.push(Object.assign({ instr: INSTR.test(p.type) }, q)); }));
    let barY = -Infinity;
    parts.forEach((p, i) => { if (INSTR.test(p.type)) return; const s = at[i].shape; barY = Math.max(barY, at[i].y + s.box[3], s.text ? at[i].y + s.text[3] : -Infinity); });
    out.comps.forEach(c => { if (c.type === "rail") barY = Math.max(barY, c.y + ((c.rot & 3) === 2 ? 50 : 0)); });
    out.wires.forEach(w => { barY = Math.max(barY, w.y1, w.y2); });
    barY = snap(barY + 30);
    const drops = gndPins.filter(q => !q.instr && q.dy > 0 && clear(pathCells([[q.x, q.y], [q.x, barY]]), gnd, false) && clear([g.at(q.x, barY)], gnd, false));
    if (drops.length >= 2) {
      const xs = drops.map(q => q.x).sort((a, b) => a - b), x1 = xs[0], x2 = xs[xs.length - 1];
      drops.forEach(q => lay(g, gnd, pathCells([[q.x, q.y], [q.x, barY]]), out.wires));
      lay(g, gnd, pathCells([[x1, barY], [x2, barY]]), out.wires);
      let mx = snap((x1 + x2) / 2); while (xs.includes(mx) && mx < x2) mx += G;
      if (mx >= x2) mx = x1;
      addComp("ground", {}, mx, barY, 0);
      block([mx - 12, barY + 10, mx + 12, barY + 20]);
      gndPins.filter(q => !drops.includes(q)).forEach(q => symbolAt(q, "GND", "ground", [0, 1], {}));
    } else gndPins.forEach(q => symbolAt(q, "GND", "ground", [0, 1], {}));

    // signal nets: each pin wired to the nearest part of its net already drawn, nets with the
    // shortest wiring first; a connection that would be long or tangled becomes two labels
    const tree = new Map();                                       // net → Set(cells)
    const sigNets = [];
    const netPins = new Map();
    parts.forEach((p, i) => pinsOf[i].forEach(q => { if (kinds.get(q.net) !== "sig") return; if (!netPins.has(q.net)) netPins.set(q.net, []); netPins.get(q.net).push(Object.assign({ instr: INSTR.test(p.type) }, q)); }));
    netPins.forEach((list, net) => {
      const wired = list.filter(q => !q.instr);
      let est = 0; for (let k = 1; k < wired.length; k++) est += Math.min(...wired.slice(0, k).map(r => Math.abs(r.x - wired[k].x) + Math.abs(r.y - wired[k].y)));
      sigNets.push({ net, pins: list, wired, est });
    });
    sigNets.sort((a, b) => a.est - b.est || (a.net < b.net ? -1 : 1));
    const labelled = new Set(), needLabel = new Set();
    // a label at a pin: a short stub the way the pin faces, the label at its end
    function pinLabel(q, net) {
      const id = idOf(net), rot = dirIdx(q.dx, q.dy);
      for (const okText of [false, true]) for (const len of [20, 30, 40, 60, 80]) {
        const ex = q.x + q.dx * len, ey = q.y + q.dy * len, cells = pathCells([[q.x, q.y], [ex, ey]]);
        const lb = labelBox(ex, ey, rot, net);
        if (clear(cells, id, okText) && boxFree(lb, okText)) { lay(g, id, cells, out.wires); addComp("netlabel", { name: net }, ex, ey, rot); g.rect(g.text, lb, 1); return true; }
      }
      return false;
    }
    // a label on a net's drawn wiring: on a level wire with room over it, or on a stub off a wire
    function treeLabel(net, cells, okText) {
      const id = idOf(net);
      let best = null;
      cells.forEach(c => {
        if (g.pin[c] >= 0 || g.deg[c] >= 3) return;
        const [x, y] = g.xy(c);
        // right on a level run (not at its end): the name over the wire
        if ((g.h[c] === id) !== (g.v[c] === id) && g.h[c] !== -1 !== (g.v[c] !== -1) && g.node[c] < 0) {
          const lb = labelBox(x, y, 0, net), r = [lb[0] + 4, lb[1], lb[2], lb[3] - 2];
          if (boxFree(r, okText)) { const score = 10 + y * 0.001; if (!best || score < best.score) best = { score, st: null, lb, x, y, d: 0 }; }
        }
        for (const len of [20, 40]) for (const d of [0, 2, 1, 3]) {
          const [dx, dy] = DIRV[d], hor = d === 0 || d === 2;
          if ((hor ? g.h[c] : g.v[c]) === id) continue;
          const st = pathCells([[x, y], [x + dx * len, y + dy * len]]);
          if (!st.slice(1).every(e => g.free(e) && (okText || !g.text[e]))) continue;
          const lb = labelBox(x + dx * len, y + dy * len, d, net);
          if (!boxFree(lb, okText)) continue;
          const score = (hor ? 0 : 30) + (d === 0 ? 0 : 5) + len + y * 0.001;
          if (!best || score < best.score) best = { score, st, lb, x: x + dx * len, y: y + dy * len, d };
        }
      });
      if (!best) return false;
      if (best.st) lay(g, id, best.st, out.wires);
      addComp("netlabel", { name: net }, best.x, best.y, best.d); g.rect(g.text, best.lb, 1);
      return true;
    }
    const LONG = opts.longWire || 900;
    sigNets.forEach(sn => {
      const id = idOf(sn.net), cells = new Set(), wired = sn.wired.slice();
      tree.set(sn.net, cells);
      if (!wired.length) return;
      // start from the pin furthest left (the driving end, usually)
      wired.sort((a, b) => a.x - b.x || a.y - b.y);
      const first = wired.shift(); cells.add(g.at(first.x, first.y));
      const isTarget = c => cells.has(c);
      while (wired.length) {
        // the pin nearest to what is drawn
        let k = 0, bd = Infinity;
        const pts = [...cells].map(c => g.xy(c));
        wired.forEach((q, t) => { const d = Math.min(...pts.map(([x, y]) => Math.abs(x - q.x) + Math.abs(y - q.y))); if (d < bd) { bd = d; k = t; } });
        const q = wired.splice(k, 1)[0], start = g.at(q.x, q.y);
        const r = bd > LONG ? null : search(g, id, start, dirIdx(q.dx, q.dy), isTarget, Math.max(120, (bd / G) * 3 + 60));
        const crosses = r ? r.cells.filter(c => (g.h[c] >= 0 && g.h[c] !== id) || (g.v[c] >= 0 && g.v[c] !== id)).length : 0;
        if (r && r.cells.length * G <= LONG && crosses <= 3) { lay(g, id, r.cells, out.wires); r.cells.forEach(c => cells.add(c)); continue; }
        // two labels: one on what is drawn of the net (once), one at the pin
        if ((labelled.has(sn.net) || hangLabel(sn, cells)) && pinLabel(q, sn.net)) { needLabel.add(sn.net); continue; }
        // no room for labels: a wire however long
        const r2 = search(g, id, start, dirIdx(q.dx, q.dy), isTarget, Infinity);
        if (r2) { lay(g, id, r2.cells, out.wires); r2.cells.forEach(c => cells.add(c)); } else out.open.push(sn.net);
      }
      // instruments' pins: always a label
      sn.pins.filter(q => q.instr).forEach(q => { if ((labelled.has(sn.net) || hangLabel(sn, cells)) && pinLabel(q, sn.net)) needLabel.add(sn.net); else out.open.push(sn.net); });
    });
    // the label on a net's drawing: on its wires, or at a pin of it with nothing in front yet
    function hangLabel(sn, cells) {
      const wiresOf = [...cells].filter(c => g.pin[c] < 0);
      let ok = treeLabel(sn.net, wiresOf, false) || treeLabel(sn.net, wiresOf, true);
      if (!ok) ok = sn.wired.some(q => cells.has(g.at(q.x, q.y)) && g.h[front(q)] < 0 && g.v[front(q)] < 0 && clear([front(q), front(q)], idOf(sn.net), false) && pinLabel(q, sn.net));
      if (ok) labelled.add(sn.net);
      return ok;
    }
    out.labels = [...needLabel];

    parts.forEach((p, i) => {
      const params = Object.assign({}, p.params);
      if (at[i].flip) params.flip = "yes"; else delete params.flip;
      addComp(p.type, params, at[i].x, at[i].y, at[i].rot, p.ref);
      out.places[p.ref] = { x: at[i].x, y: at[i].y, o: at[i].o };
    });
    return out;
  }

  root.SchLayout = { draw, shape, turnsOf };
})(typeof window !== "undefined" ? window : globalThis);
