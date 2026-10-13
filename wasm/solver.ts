// The circuit engine's sparse LU (sim-engine.js SparseMatrix.solve), compiled to WebAssembly by
// scripts/build-wasm.mjs into sim-solver.wasm (npm run build:wasm). AssemblyScript: TypeScript syntax,
// WebAssembly types. The same steps in the same order as the JavaScript, so the answers are the same.
//
// Gilbert–Peierls left-looking LU (as KLU): column by column in the order q, each column's pattern
// found by a depth-first search through L, partial pivoting.
//
// The engine lays out its arrays in this module's memory and passes their byte offsets in a table at
// `tab` (i32 each, in this order):
//   cp, ri, cs, q, vals, b, pinv, x, xi, stk, ps, mark, Lp, Up, Li, Lx, Ui, Ux, capL, capU
// Returns 1 (b holds x), 0 (singular), -1 (L needs more room than capL), -2 (U needs more than capU).

@inline function I(base: usize, i: i32): i32 { return load<i32>(base + (<usize>i << 2)); }
@inline function SI(base: usize, i: i32, v: i32): void { store<i32>(base + (<usize>i << 2), v); }
@inline function F(base: usize, i: i32): f64 { return load<f64>(base + (<usize>i << 3)); }
@inline function SF(base: usize, i: i32, v: f64): void { store<f64>(base + (<usize>i << 3), v); }

export function solve(n: i32, tab: usize): i32 {
  const cp = <usize>I(tab, 0), ri = <usize>I(tab, 1), cs = <usize>I(tab, 2), q = <usize>I(tab, 3), vals = <usize>I(tab, 4), b = <usize>I(tab, 5);
  const pinv = <usize>I(tab, 6), x = <usize>I(tab, 7), xi = <usize>I(tab, 8), stk = <usize>I(tab, 9), ps = <usize>I(tab, 10), mark = <usize>I(tab, 11);
  const Lp = <usize>I(tab, 12), Up = <usize>I(tab, 13), Li = <usize>I(tab, 14), Lx = <usize>I(tab, 15), Ui = <usize>I(tab, 16), Ux = <usize>I(tab, 17);
  const capL = I(tab, 18), capU = I(tab, 19);
  for (let i = 0; i < n; i++) { SI(pinv, i, -1); SI(mark, i, -1); }
  let lnz = 0, unz = 0;
  for (let k = 0; k < n; k++) {
    SI(Lp, k, lnz); SI(Up, k, unz);
    const col = I(q, k);
    // the rows reachable from A(:, col) through the columns of L made so far, in topological order
    let top = n;
    for (let p = I(cp, col); p < I(cp, col + 1); p++) {
      if (I(mark, I(ri, p)) == k) continue;
      let head = 0; SI(stk, 0, I(ri, p));
      while (head >= 0) {
        const r = I(stk, head), c = I(pinv, r);
        if (I(mark, r) != k) { SI(mark, r, k); SI(ps, head, c < 0 ? 0 : I(Lp, c)); }
        let done = true;
        const end = c < 0 ? 0 : I(Lp, c + 1);
        for (let pp = I(ps, head); pp < end; pp++) {
          const rr = I(Li, pp); if (I(mark, rr) == k) continue;
          SI(ps, head, pp + 1); head++; SI(stk, head, rr); done = false; break;
        }
        if (done) { head--; top--; SI(xi, top, r); }
      }
    }
    for (let p = top; p < n; p++) SF(x, I(xi, p), 0);
    for (let p = I(cp, col); p < I(cp, col + 1); p++) SF(x, I(ri, p), F(vals, I(cs, p)));
    // x = L \ x over that pattern
    for (let p = top; p < n; p++) {
      const r = I(xi, p), c = I(pinv, r); if (c < 0) continue;
      const xr = F(x, r); if (xr == 0) continue;
      for (let pp = I(Lp, c) + 1; pp < I(Lp, c + 1); pp++) { const t = I(Li, pp); SF(x, t, F(x, t) - F(Lx, pp) * xr); }
    }
    // U(:, k) from the rows already pivotal; the pivot: the largest of the others
    if (unz + n - top + 1 > capU) return -2;
    let ipiv = -1, amax: f64 = -1;
    for (let p = top; p < n; p++) {
      const r = I(xi, p);
      if (I(pinv, r) < 0) { const a = Math.abs(F(x, r)); if (a > amax) { amax = a; ipiv = r; } }
      else { SI(Ui, unz, I(pinv, r)); SF(Ux, unz, F(x, r)); unz++; }
    }
    if (ipiv < 0 || amax < 1e-300) return 0;
    const piv = F(x, ipiv);
    SI(Ui, unz, k); SF(Ux, unz, piv); unz++;
    SI(pinv, ipiv, k);
    if (lnz + n - top + 1 > capL) return -1;
    SI(Li, lnz, ipiv); SF(Lx, lnz, 1); lnz++;
    for (let p = top; p < n; p++) { const r = I(xi, p); if (I(pinv, r) < 0) { SI(Li, lnz, r); SF(Lx, lnz, F(x, r) / piv); lnz++; } }
  }
  SI(Lp, n, lnz); SI(Up, n, unz);
  // P b, then L, then U, then the column order back
  for (let i = 0; i < n; i++) SF(x, I(pinv, i), F(b, i));
  for (let k = 0; k < n; k++) {
    const v = F(x, k); if (v == 0) continue;
    for (let p = I(Lp, k) + 1; p < I(Lp, k + 1); p++) { const t = I(pinv, I(Li, p)); SF(x, t, F(x, t) - F(Lx, p) * v); }
  }
  for (let k = n - 1; k >= 0; k--) {
    const d = I(Up, k + 1) - 1; SF(x, k, F(x, k) / F(Ux, d));
    const v = F(x, k); if (v == 0) continue;
    for (let p = I(Up, k); p < d; p++) { const t = I(Ui, p); SF(x, t, F(x, t) - F(Ux, p) * v); }
  }
  for (let k = 0; k < n; k++) SF(b, I(q, k), F(x, k));
  return 1;
}
