/* =============================================================================
   BOARD DESIGN — a small SAT solver (no DOM, Node-testable), for the exact window router.
     const s = BoardSat.solver();  s.newVar() -> v (1, 2, …);  s.add([v, -w, …]) (a clause:
     literals are +v for v true, -v for v false);  s.solve({ budget, ms }) -> true | false | null
     (null: gave up after budget conflicts or ms milliseconds);  s.value(v) -> true | false.
     BoardSat.solver({ maxClauses }): add() throws an error with .full set once the formula would
     hold more clauses than that (so a caller stops building a formula too big for the page's memory)
   Conflict-driven clause learning (Marques-Silva and Sakallah, GRASP 1996; Moskewicz et al.,
   Chaff 2001; Eén and Sörensson, MiniSat 2003): two watched literals per clause, the first
   unique implication point's learnt clause, activity-ordered decisions that start false (so
   few wires are drawn unless needed), saved phases, and Luby restarts.
   ============================================================================= */
(function (root) {
  "use strict";
  function solver(opts) {
    const clauses = [], watch = [[], []], cap = (opts && opts.maxClauses) || Infinity;   // watch[2v + (neg ? 1 : 0)]: clauses watching that literal
    let nv = 0, ok = true;
    const lit = l => 2 * Math.abs(l) + (l < 0 ? 1 : 0);
    function newVar() { nv++; watch.push([], []); return nv; }
    function add(c) {
      if (!ok) return;
      const seen = new Set(), out = [];
      for (const l of c) { if (seen.has(-l)) return; if (!seen.has(l)) { seen.add(l); out.push(l); } }
      if (!out.length) { ok = false; return; }
      if (clauses.length >= cap) { const e = new Error(`formula over ${cap} clauses`); e.full = true; throw e; }
      clauses.push(out);
    }
    // the search state
    let val, level, reason, trail, lim, act, phase, heap, inc;
    function value(v) { return val ? val[v] === 1 : false; }
    const litVal = l => { const x = val[Math.abs(l)]; return x === 0 ? 0 : (l > 0) === (x === 1) ? 1 : -1; };
    function assign(l, r) { const v = Math.abs(l); val[v] = l > 0 ? 1 : -1; level[v] = lim.length; reason[v] = r; trail.push(l); }
    // decisions: the unassigned variable of most activity (a binary heap)
    let hpos;
    const less = (a, b) => act[a] > act[b];
    function up(i) { const v = heap[i]; while (i > 0) { const p = (i - 1) >> 1; if (!less(v, heap[p])) break; heap[i] = heap[p]; hpos[heap[i]] = i; i = p; } heap[i] = v; hpos[v] = i; }
    function down(i) { const v = heap[i], n = heap.length; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && less(heap[c + 1], heap[c])) c++; if (!less(heap[c], v)) break; heap[i] = heap[c]; hpos[heap[i]] = i; i = c; } heap[i] = v; hpos[v] = i; }
    function push(v) { if (hpos[v] >= 0) return; hpos[v] = heap.length; heap.push(v); up(heap.length - 1); }
    function pop() { const v = heap[0], last = heap.pop(); hpos[v] = -1; if (heap.length) { heap[0] = last; hpos[last] = 0; down(0); } return v; }
    function bump(v) { act[v] += inc; if (act[v] > 1e100) { for (let k = 1; k <= nv; k++) act[k] *= 1e-100; inc *= 1e-100; } if (hpos[v] >= 0) up(hpos[v]); }
    // unit propagation from trail position qhead; returns a conflicting clause or null
    let qhead;
    function propagate() {
      while (qhead < trail.length) {
        const f = -trail[qhead++], ws = watch[lit(f)];   // clauses watching f, which just became false
        let i = 0, j = 0;
        for (; i < ws.length; i++) {
          const c = ws[i];
          if (c[0] === f) { c[0] = c[1]; c[1] = f; }
          if (litVal(c[0]) === 1) { ws[j++] = c; continue; }
          let moved = false;
          for (let k = 2; k < c.length; k++) if (litVal(c[k]) !== -1) { c[1] = c[k]; c[k] = f; watch[lit(c[1])].push(c); moved = true; break; }
          if (moved) continue;
          ws[j++] = c;
          if (litVal(c[0]) === -1) { while (++i < ws.length) ws[j++] = ws[i]; ws.length = j; return c; }
          assign(c[0], c);
        }
        ws.length = j;
      }
      return null;
    }
    function backtrack(lv) {
      if (lim.length <= lv) return;
      for (let k = trail.length - 1; k >= lim[lv]; k--) { const v = Math.abs(trail[k]); phase[v] = val[v]; val[v] = 0; reason[v] = null; push(v); }
      trail.length = lim[lv]; lim.length = lv; qhead = trail.length;
    }
    // the first unique implication point: the learnt clause and the level to go back to
    function analyse(confl) {
      const seen = new Uint8Array(nv + 1), out = [0];
      let pathC = 0, p = 0, idx = trail.length - 1, c = confl;
      do {
        for (const q of c) {
          if (q === p) continue;
          const v = Math.abs(q);
          if (seen[v] || level[v] === 0) continue;
          seen[v] = 1; bump(v);
          if (level[v] === lim.length) pathC++; else out.push(q);
        }
        while (!seen[Math.abs(trail[idx])]) idx--;
        p = trail[idx--]; c = reason[Math.abs(p)]; seen[Math.abs(p)] = 0; pathC--;
      } while (pathC > 0);
      out[0] = -p;
      let bt = 0, at = 1;
      for (let k = 1; k < out.length; k++) if (level[Math.abs(out[k])] > bt) { bt = level[Math.abs(out[k])]; at = k; }
      if (out.length > 1) { const t = out[1]; out[1] = out[at]; out[at] = t; }
      return { learnt: out, bt };
    }
    // the Luby sequence 1 1 2 1 1 2 4 1 1 2 …, restart lengths
    const luby = x => { let size = 1, seq = 0; while (size < x + 1) { seq++; size = 2 * size + 1; } while (size - 1 !== x) { size = (size - 1) >> 1; seq--; x %= size; } return 1 << seq; };
    function solve(opts) {
      const o = opts || {}, budget = o.budget || 200000, until = o.ms ? Date.now() + o.ms : Infinity;
      if (!ok) return false;
      val = new Int8Array(nv + 1); level = new Int32Array(nv + 1); reason = new Array(nv + 1).fill(null);
      act = new Float64Array(nv + 1); phase = new Int8Array(nv + 1).fill(-1); hpos = new Int32Array(nv + 1).fill(-1);
      trail = []; lim = []; heap = []; inc = 1; qhead = 0;
      for (const ws of watch) ws.length = 0;
      for (let v = 1; v <= nv; v++) push(v);
      for (const c of clauses) {
        if (c.length === 1) { const x = litVal(c[0]); if (x === -1) return false; if (x === 0) assign(c[0], null); continue; }
        watch[lit(c[0])].push(c); watch[lit(c[1])].push(c);
      }
      if (propagate()) return false;
      let conflicts = 0, run = 0, restarts = 0, limit = 100 * luby(0);
      for (;;) {
        const confl = propagate();
        if (confl) {
          conflicts++; run++;
          if (!lim.length) return false;
          if (conflicts > budget || ((conflicts & 255) === 0 && Date.now() > until)) return null;
          const { learnt, bt } = analyse(confl);
          backtrack(bt);
          if (learnt.length === 1) assign(learnt[0], null);
          else { watch[lit(learnt[0])].push(learnt); watch[lit(learnt[1])].push(learnt); assign(learnt[0], learnt); }
          inc *= 1.05;
          continue;
        }
        if (run >= limit) { backtrack(0); run = 0; limit = 100 * luby(++restarts); continue; }
        let v = 0;
        while (heap.length) { const w = pop(); if (val[w] === 0) { v = w; break; } }
        if (!v) return true;
        lim.push(trail.length);
        assign(phase[v] === 1 ? v : -v, null);
      }
    }
    return { newVar, add, solve, value, get vars() { return nv; }, get size() { return clauses.length; } };
  }
  root.BoardSat = { solver };
})(typeof window !== "undefined" ? window : globalThis);
