/* Koren model fitted to measured or published plate-curve points: a Nelder–Mead simplex over
   mu, kg, kp, kvb (triode) or lam (pentode) and x, scored on the anode current. Used by the curve
   tracer's fitter and by the AI datasheet import. points: [{ va, vg, vg2?, iaMa }]. */
(function (root) {
  "use strict";
  const Koren = root.TubeSimEngine.Koren;
  function fit(points, init, kind, vg2) {
    // the 4th parameter is kvb for triodes and the plate slope lam for pentodes;
    // a pentode's knee (vk) and screen terms (kg2, ks) are kept from the library model
    const shape = kind === "pentode" ? "lam" : "kvb";
    let p = [init.mu, init.kg, init.kp, init[shape], init.x];
    const model = par => ({ ...(kind === "pentode" ? { vk: init.vk, kg2: init.kg2, ks: init.ks } : {}), mu: par[0], kg: par[1], kp: par[2], [shape]: par[3], x: par[4] });
    const pred = (pt, par) => (kind === "pentode" ? Koren.pentodeIa(pt.va, pt.vg, pt.vg2 || vg2, model(par)) : Koren.triodeIa(pt.va, pt.vg, model(par))) * 1000;
    const f = par => { if (par[0] <= 0.5 || par[1] <= 1 || par[2] <= 1 || par[3] <= 0.1 || par[4] < 1 || par[4] > 2) return 1e30; let s = 0; for (const pt of points) { const e = pred(pt, par) - pt.iaMa; s += e * e; } return s; };
    let simplex = [p.slice()];
    const step = [p[0] * 0.1, p[1] * 0.1, p[2] * 0.1, p[3] * 0.1, 0.05];
    for (let i = 0; i < 5; i++) { const v = p.slice(); v[i] += step[i]; simplex.push(v); }
    for (let iter = 0; iter < 600; iter++) {
      simplex.sort((a, b) => f(a) - f(b));
      const best = simplex[0], worst = simplex[5];
      const cen = [0, 0, 0, 0, 0]; for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) cen[j] += simplex[i][j] / 5;
      const refl = cen.map((c, j) => c + (c - worst[j]));
      if (f(refl) < f(best)) { const exp = cen.map((c, j) => c + 2 * (refl[j] - c)); simplex[5] = f(exp) < f(refl) ? exp : refl; }
      else if (f(refl) < f(simplex[4])) simplex[5] = refl;
      else { const con = cen.map((c, j) => c + 0.5 * (worst[j] - c)); if (f(con) < f(worst)) simplex[5] = con; else for (let i = 1; i <= 5; i++) simplex[i] = simplex[i].map((v, j) => best[j] + 0.5 * (v - best[j])); }
    }
    simplex.sort((a, b) => f(a) - f(b));
    const opt = simplex[0], params = model(opt);
    let ssRes = 0, ssTot = 0; const mean = points.reduce((s, q) => s + q.iaMa, 0) / points.length;
    points.forEach(pt => { const e = pt.iaMa - pred(pt, opt); ssRes += e * e; ssTot += (pt.iaMa - mean) ** 2; });
    return { params, r2: Math.max(0, 1 - ssRes / Math.max(ssTot, 1e-12)), rmse: Math.sqrt(ssRes / points.length) };
  }
  root.KorenFit = { fit };
})(typeof window !== "undefined" ? window : globalThis);
