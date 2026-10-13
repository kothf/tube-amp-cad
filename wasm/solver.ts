// The circuit engine's linear solver (sim-engine.js solveLinear), compiled to WebAssembly by
// scripts/build-wasm.mjs into sim-solver.wasm (npm run build:wasm). AssemblyScript: TypeScript syntax, WebAssembly types.
// Dense LU with partial pivoting, the same steps and order as sim-engine.js solveLinear.
// The matrix A (n×n, row-major) sits at offset 0, the right-hand side b after it.
// Row updates in pairs (f64x2): each element is still a - f·b on its own, so results are bit-identical.
export function solve(n: i32): i32 {
  const A: usize = 0, B: usize = <usize>(n * n) << 3;
  for (let k = 0; k < n; k++) {
    const rk: usize = A + (<usize>(k * n) << 3);
    let piv = k, max = Math.abs(load<f64>(rk + (<usize>k << 3)));
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(load<f64>(A + (<usize>(i * n + k) << 3)));
      if (v > max) { max = v; piv = i; }
    }
    if (max < 1e-300) return 0;
    if (piv != k) {
      const rp: usize = A + (<usize>(piv * n) << 3);
      for (let j = 0; j < n; j++) { const o = <usize>j << 3; const t = load<f64>(rk + o); store<f64>(rk + o, load<f64>(rp + o)); store<f64>(rp + o, t); }
      const t = load<f64>(B + (<usize>k << 3)); store<f64>(B + (<usize>k << 3), load<f64>(B + (<usize>piv << 3))); store<f64>(B + (<usize>piv << 3), t);
    }
    const akk = load<f64>(rk + (<usize>k << 3)), bk = load<f64>(B + (<usize>k << 3));
    for (let i = k + 1; i < n; i++) {
      const ri: usize = A + (<usize>(i * n) << 3);
      const f = load<f64>(ri + (<usize>k << 3)) / akk;
      if (f == 0) continue;
      store<f64>(ri + (<usize>k << 3), 0);
      const fv = f64x2.splat(f);
      let j = k + 1;
      for (; j + 1 < n; j += 2) { const o = <usize>j << 3; v128.store(ri + o, f64x2.sub(v128.load(ri + o), f64x2.mul(fv, v128.load(rk + o)))); }
      if (j < n) { const o = <usize>j << 3; store<f64>(ri + o, load<f64>(ri + o) - f * load<f64>(rk + o)); }
      store<f64>(B + (<usize>i << 3), load<f64>(B + (<usize>i << 3)) - f * bk);
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const ri: usize = A + (<usize>(i * n) << 3);
    let s = load<f64>(B + (<usize>i << 3));
    for (let j = i + 1; j < n; j++) s -= load<f64>(ri + (<usize>j << 3)) * load<f64>(B + (<usize>j << 3));
    store<f64>(B + (<usize>i << 3), s / load<f64>(ri + (<usize>i << 3)));
  }
  return 1;
}
