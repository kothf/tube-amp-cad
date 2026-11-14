/* =============================================================================
   BOARD DESIGN — push and shove for interactive routing (no DOM, Node-testable).
     shove(o) -> { moved: Map(track index -> new points), pushes } | { fail: reason, at: [x, y] }
   o = { tracks: [{ layer, w, pts, net, locked }], layer, net, segs: [[x1, y1, x2, y2]...],
         r: half the new track's width, need(netA, netB) -> clearance in mm,
         fixed(s, r, net) -> null | { x, y, what } (pads, vias, holes, keep-outs: what never moves),
         maxPush (default 60) }
   The segments being placed push the other nets' tracks on their layer aside instead of being
   refused. A pushed segment of a track keeps its two ends: the part beside the pusher steps out by
   just the clearance it lacks, with a 45° jog in and out (a bump). A bump that would run past a
   bend of the track moves that bend instead; past the track's own end (on a pad or via) it cannot.
   Pushed copper pushes in its turn (a chain), until nothing is too close, or a push would cross a
   track, move a locked one, or run into something fixed: then nothing moves and the reason comes
   back. Same deterministic answer for the same board (tracks taken in index order).
   ============================================================================= */
(function (root) {
  "use strict";
  const EPS = 1e-6, SLACK = 0.002;   // pushed copper keeps 2 µm more than the rule (rounding)
  function segDist(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }
  function crosses(a, b) {
    const d = (a[2] - a[0]) * (b[3] - b[1]) - (a[3] - a[1]) * (b[2] - b[0]); if (!d) return false;
    const t = ((b[0] - a[0]) * (b[3] - b[1]) - (b[1] - a[1]) * (b[2] - b[0])) / d, u = ((b[0] - a[0]) * (a[3] - a[1]) - (b[1] - a[1]) * (a[2] - a[0])) / d;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
  }
  function segSeg(a, b) {
    if (crosses(a, b)) return 0;
    return Math.min(segDist(a[0], a[1], a[2], a[3], b[0], b[1]), segDist(a[0], a[1], a[2], a[3], b[2], b[3]), segDist(b[0], b[1], b[2], b[3], a[0], a[1]), segDist(b[0], b[1], b[2], b[3], a[2], a[3]));
  }
  const segsOf = pts => { const out = []; for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]); return out; };
  const r4 = v => Math.round(v * 1e4) / 1e4;
  // drop repeated points and points on a straight run
  function tidy(pts) {
    const out = [];
    for (const p of pts) {
      const q = [r4(p[0]), r4(p[1])], l = out[out.length - 1];
      if (l && Math.abs(l[0] - q[0]) < EPS && Math.abs(l[1] - q[1]) < EPS) continue;
      out.push(q);
    }
    for (let k = out.length - 2; k >= 1; k--) {
      const a = out[k - 1], b = out[k], c = out[k + 1], cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cr) < 1e-7 && (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]) >= 0) out.splice(k, 1);
    }
    return out;
  }
  // segment k of pts, pushed away from the pusher segments ps (all on one side of it) to keep m
  // between centre lines (m = clearance + both half widths): the new point list, or { fail }.
  // Only the part of a pusher within m of the line needs room; the bump is the hull of those parts.
  function bump(pts, k, ps, m) {
    const A = pts[k], B = pts[k + 1], L = Math.hypot(B[0] - A[0], B[1] - A[1]), seg = [A[0], A[1], B[0], B[1]];
    if (L < EPS) return { fail: "a track too short to push", at: A };
    const e = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    let u = [-e[1], e[0]];
    const along = q => (q[0] - A[0]) * e[0] + (q[1] - A[1]) * e[1], side = q => (q[0] - A[0]) * u[0] + (q[1] - A[1]) * u[1];
    for (const p of ps) if (crosses(p, seg)) return { fail: "crosses a track", at: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] };
    // the pushers' side is -u (the first one decides): the track goes to +u
    const p0 = ps[0]; if (side([p0[0], p0[1]]) + side([p0[2], p0[3]]) > 0) u = [-u[0], -u[1]];
    let d = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const p of ps) {
      const P = [p[0], p[1]], Q = [p[2], p[3]], cp = side(P), cq = side(Q);
      if (cp > 0 || cq > 0) return { fail: "squeezed between tracks", at: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] };
      // the part of the pusher with side > -m
      let a = 0, b = 1;
      if (cp <= -m && cq <= -m) continue;
      if (cp < -m) a = (-m - cp) / (cq - cp); else if (cq < -m) b = (-m - cp) / (cq - cp);
      for (const f of [a, b]) {
        const X = [P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f], t = along(X);
        d = Math.max(d, side(X) + m); t0 = Math.min(t0, t - m); t1 = Math.max(t1, t + m);
      }
    }
    if (!(d > 0)) return { pts };
    d += SLACK;
    const at = (t, off) => [A[0] + e[0] * t + u[0] * off, A[1] + e[1] * t + u[1] * off];
    const first = k === 0, last = k + 1 === pts.length - 1;
    const out = pts.slice(0, k + 1);
    // the jog in: from t0 - d on the line to t0 out at d; past A: A itself moves (a bend), or at the
    // track's end (on a pad or via) the jog leaves the end itself, steeper than 45°; a pusher
    // reaching past the end cannot be cleared
    // a jog straight off the end E to Q keeps clear of every pusher (the end itself sits on a pad or via,
    // which the pushers already keep clear of)
    const jogOk = (E, Q) => ps.every(p => segSeg(p, [E[0], E[1], Q[0], Q[1]]) >= m - EPS);
    if (t0 - d < 0) {
      if (!first) out[k] = at(0, d);
      else { const Q = at(Math.max(t0, 0), d); if (!jogOk(A, Q)) return { fail: "would move the track's end", at: A }; out.push(Q); }
    } else { out.push(at(t0 - d, 0)); out.push(at(t0, d)); }
    if (t1 + d > L) {
      if (!last) { out.push(at(L, d)); return { pts: out.concat(pts.slice(k + 2)) }; }
      const Q = at(Math.min(t1, L), d); if (!jogOk(B, Q)) return { fail: "would move the track's end", at: B };
      out.push(Q); out.push(B); return { pts: out.concat(pts.slice(k + 2)) };
    }
    out.push(at(t1, d)); out.push(at(t1 + d, 0)); out.push(B);
    return { pts: out.concat(pts.slice(k + 2)) };
  }
  function shove(o) {
    const tracks = o.tracks, maxPush = o.maxPush || 60, moved = new Map();
    const ptsOf = i => moved.has(i) ? moved.get(i) : tracks[i].pts;
    const mine = { segs: o.segs, r: o.r, net: o.net, ti: -1 }, queue = [mine];
    const sameNet = (a, b) => a === b && a !== null && a !== undefined;
    let pushes = 0;
    while (queue.length) {
      const p = queue.shift();
      if (p.ti >= 0) p.segs = segsOf(ptsOf(p.ti));   // where that track is now
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        if (i === p.ti || t.layer !== o.layer || sameNet(t.net, p.net)) continue;
        let changed = false;
        for (let guard = 0; guard < 12; guard++) {
          const pts = ptsOf(i), segs = segsOf(pts), rt = t.w / 2, c = o.need(p.net, t.net), m = c + p.r + rt;
          // of the segments too close, the one most nearly parallel to its pusher steps aside
          // (a track running beside the new one moves sideways, not the leg it turns into)
          let k = -1, best = -1;
          for (let j = 0; j < segs.length; j++) {
            const sj = segs[j], l = Math.hypot(sj[2] - sj[0], sj[3] - sj[1]) || 1;
            for (const ps of p.segs) {
              if (segSeg(ps, sj) - p.r - rt >= c - EPS) continue;
              const pl = Math.hypot(ps[2] - ps[0], ps[3] - ps[1]) || 1;
              const par = Math.abs((sj[2] - sj[0]) * (ps[2] - ps[0]) + (sj[3] - sj[1]) * (ps[3] - ps[1])) / l / pl;
              if (par > best + 1e-9) { best = par; k = j; }
            }
          }
          if (k < 0) break;
          const near = p.segs.filter(ps => segSeg(ps, segs[k]) < m - EPS);
          if (t.locked) return { fail: "a locked track", at: [(segs[k][0] + segs[k][2]) / 2, (segs[k][1] + segs[k][3]) / 2] };
          if (++pushes > maxPush) return { fail: "too many tracks to push", at: [segs[k][0], segs[k][1]] };
          const b = bump(pts, k, near, m);
          if (b.fail) return b;
          const np = tidy(b.pts);
          if (np.length === pts.length && np.every((q, n) => q[0] === pts[n][0] && q[1] === pts[n][1])) break;
          moved.set(i, np); changed = true;
        }
        // the pushed track pushes in its turn
        if (changed && !queue.some(q => q.ti === i)) queue.push({ segs: segsOf(ptsOf(i)), r: t.w / 2, net: t.net, ti: i });
      }
    }
    // what moved must keep clear of what is fixed, of the new segments and of every other track
    for (const [i, pts] of moved) {
      const t = tracks[i], rt = t.w / 2;
      for (const s of segsOf(pts)) {
        const f = o.fixed ? o.fixed(s, rt, t.net) : null;
        if (f) return { fail: `would run into ${f.what}`, at: [f.x, f.y] };
        for (const q of o.segs) if (segSeg(q, s) - o.r - rt < o.need(o.net, t.net) - EPS) return { fail: "no room to push it", at: [s[0], s[1]] };
        for (let j = 0; j < tracks.length; j++) {
          const u = tracks[j];
          if (j === i || u.layer !== o.layer || (u.net === t.net && t.net !== null && t.net !== undefined)) continue;
          for (const s2 of segsOf(ptsOf(j))) if (segSeg(s, s2) - rt - u.w / 2 < o.need(t.net, u.net) - EPS) return { fail: "no room to push it", at: [s[0], s[1]] };
        }
      }
    }
    return { moved, pushes };
  }
  root.BoardShove = { shove, bump, tidy };
})(typeof window !== "undefined" ? window : globalThis);
