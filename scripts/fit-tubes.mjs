#!/usr/bin/env node
/**
 * Fit the Koren model of every amplifier tube to its datasheet points
 * (tests/datasheets.mjs) and report the result.
 *
 *   node scripts/fit-tubes.mjs           report fitted vs datasheet
 *   node scripts/fit-tubes.mjs --write   also update tube-db.js
 *   node scripts/fit-tubes.mjs EL84 6V6GT   only these tubes
 *
 * Pentodes: the pentode model is fitted to the datasheet (Ia, Ig2, gm, rp);
 * the triode-connected model (Triode) is then fitted to that pentode with
 * g2 strapped to the anode, so both modes describe the same tube. The
 * ultralinear entry uses the pentode model (UL comes from the transformer).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { DATASHEETS, datasheetFor } from "../tests/datasheets.mjs";

const DB_FILE = new URL("../tube-db.js", import.meta.url);
for (const f of ["tube-db.js", "sim-engine.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const K = globalThis.TubeSimEngine.Koren;
const DB = globalThis.TUBE_DATABASE;

// ---- model evaluation (mA, mA/V, kΩ) ---------------------------------------
export const ia = (kind, p, pt, vg = pt.vg) =>
  1e3 * (kind === "pentode" ? K.pentodeIa(pt.va, vg, pt.vg2, p) : K.triodeIa(pt.va, vg, p));
const ig2 = (p, pt, vg) => 1e3 * K.screenI(vg, pt.vg2, p);
const gm = (kind, p, pt, vg) => (ia(kind, p, pt, vg + 0.02) - ia(kind, p, pt, vg - 0.02)) / 0.04;
const rp = (kind, p, pt, vg) => {
  const h = Math.max(0.5, pt.va * 0.002);
  return (2 * h) / (ia(kind, p, { ...pt, va: pt.va + h }, vg) - ia(kind, p, { ...pt, va: pt.va - h }, vg));
};
/** Grid bias giving the datasheet current (for points whose bias is not published). */
export function solveBias(kind, p, pt) {
  let lo = -pt.va, hi = 0;
  if (ia(kind, p, pt, hi) < pt.ia) return NaN;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; ia(kind, p, pt, m) < pt.ia ? (lo = m) : (hi = m); }
  return (lo + hi) / 2;
}
/** Model values at each datasheet point. */
export function evaluate(kind, p, points) {
  return points.map(pt => {
    const vg = pt.vg === null ? solveBias(kind, p, pt) : pt.vg;
    return { vg, ia: ia(kind, p, pt, vg), gm: gm(kind, p, pt, vg), rp: rp(kind, p, pt, vg), ig2: kind === "pentode" ? ig2(p, pt, vg) : undefined };
  });
}

// ---- Nelder-Mead in log-parameter space ------------------------------------
function nelderMead(f, x0, { iters = 4000, step = 0.3 } = {}) {
  const n = x0.length;
  let simplex = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map(x => ({ x, f: f(x) }));
  for (let k = 0; k < iters; k++) {
    simplex.sort((a, b) => a.f - b.f);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    if (Math.abs(worst.f - best.f) < 1e-12 * (1 + Math.abs(best.f))) break;
    const c = Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += simplex[i].x[j] / n;
    const pt = t => c.map((v, j) => v + t * (worst.x[j] - v));
    const r = { x: pt(-1) }; r.f = f(r.x);
    if (r.f < best.f) { const e = { x: pt(-2) }; e.f = f(e.x); simplex[n] = e.f < r.f ? e : r; }
    else if (r.f < second.f) simplex[n] = r;
    else {
      const ct = { x: pt(r.f < worst.f ? -0.5 : 0.5) }; ct.f = f(ct.x);
      if (ct.f < Math.min(r.f, worst.f)) simplex[n] = ct;
      else simplex = simplex.map((s, i) => (i === 0 ? s : { x: s.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j])), f: NaN })).map(s => (Number.isNaN(s.f) ? { ...s, f: f(s.x) } : s));
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return simplex[0];
}
const minimize = (f, x0) => { let r = { x: x0 }; for (let i = 0; i < 6; i++) r = nelderMead(f, r.x, { step: i < 3 ? 0.4 : 0.1 }); return r; };

const KEYS = { triode: ["mu", "kg", "kp", "kvb", "x"], pentode: ["mu", "kg", "kp", "kvb", "x", "kg2"] };
const toVec = (kind, p) => KEYS[kind].map(k => Math.log(p[k]));
const fromVec = (kind, v) => Object.fromEntries(KEYS[kind].map((k, i) => [k, Math.exp(v[i])]));
const sq = v => v * v, lr = (a, b) => Math.log(a / b);

function datasheetCost(ds, start) {
  return v => {
    const p = fromVec(ds.kind, v);
    if (p.x < 1.1 || p.x > 1.8 || p.kg < 10) return 1e6;
    let c = 0;
    const m = evaluate(ds.kind, p, ds.points);
    ds.points.forEach((pt, i) => {
      const r = m[i];
      if (!(r.ia > 0) || Number.isNaN(r.vg)) { c += 100; return; }
      if (pt.vg !== null) c += 4 * sq(lr(r.ia, pt.ia));
      if (pt.gm) c += 2 * sq(lr(r.gm, pt.gm));
      if (pt.rp) c += 1 * sq(lr(r.rp, pt.rp));
      if (pt.ig2) c += 1 * sq(lr(r.ig2, pt.ig2));
    });
    // Weak priors keep what the data cannot pin down physically sensible:
    // a triode's µ is fixed by gm·rp when both are published; a pentode's
    // µ(g1-g2) never is. The exponent stays near Koren's typical 1.35, and a
    // pentode without published Ig2 gets the usual ~10 % of plate current.
    const pinned = ds.kind === "triode" && ds.points.some(pt => pt.gm && pt.rp);
    c += (pinned ? 0.05 : 1) * sq(lr(p.mu, ds.mu));
    c += 0.2 * sq(lr(p.x, 1.35)) + 0.002 * sq(lr(p.kvb, start.kvb)) + 0.002 * sq(lr(p.kp, start.kp));
    if (ds.kind === "pentode") ds.points.forEach((pt, i) => { if (!pt.ig2 && m[i].ig2 > 0) c += 0.3 * sq(lr(m[i].ig2, 0.1 * pt.ia)); });
    return c;
  };
}

/** Triode-strapped (g2 to anode) cathode current of a pentode model, mA. */
const strapped = (P, va, vg) => 1e3 * (K.pentodeIa(va, vg, va, P) + K.screenI(vg, va, P));

function fitStrapped(P, start, vaRef) {
  const pts = [];
  for (const va of [0.4, 0.6, 0.8, 1, 1.2, 1.4].map(f => f * vaRef)) {
    const i0 = strapped(P, va, 0);
    for (let vg = 0; vg > -va; vg -= va / 80) {
      const i = strapped(P, va, vg);
      if (i < 0.04 * i0) break;
      pts.push({ va, vg, i });
    }
  }
  const cost = v => {
    const p = fromVec("triode", v);
    if (p.x < 1.1 || p.x > 1.8) return 1e6;
    return pts.reduce((c, q) => c + sq(lr(1e3 * K.triodeIa(q.va, q.vg, p) + 1e-6, q.i)), 0) / pts.length + 0.001 * sq(lr(p.x, 1.35));
  };
  const r = minimize(cost, toVec("triode", start));
  return { p: fromVec("triode", r.x), rms: Math.sqrt(r.f) };
}

const round = (v, sig = 4) => Number(v.toPrecision(sig));
const tidy = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === "x" ? round(v, 3) : round(v, 4)]));

export function fitTube(name) {
  const ds = datasheetFor(name), t = DB.find(d => d.commonName === name);
  if (ds.kind === "triode") {
    // database values predate Koren's x2 factor: halve kg as the starting point
    const start = { ...t.koren.Triode, kg: t.koren.Triode.kg * 2 };
    const r = minimize(datasheetCost(ds, start), toVec("triode", start));
    return { Triode: tidy(fromVec("triode", r.x)) };
  }
  const start = { ...t.koren.Pentode, kg: t.koren.Pentode.kg * Math.PI };
  const r = minimize(datasheetCost(ds, start), toVec("pentode", start));
  const P = tidy(fromVec("pentode", r.x));
  const vaRef = Math.min(Math.max(...ds.points.map(p => p.va), 250), t.vg2Max || 300);
  const T = fitStrapped(P, { ...t.koren.Triode, kg: t.koren.Triode.kg * 2 }, vaRef);
  return { Pentode: P, Ultralinear: { ...P }, Triode: tidy(T.p), strapRms: T.rms };
}

function formatKoren(k) {
  const obj = p => `{ ${Object.entries(p).map(([a, b]) => `${a}: ${b}`).join(", ")} }`;
  if (!k.Pentode) return `koren: { Triode: ${obj(k.Triode)} }`;
  return `koren: {\n      Pentode: ${obj(k.Pentode)},\n      Ultralinear: ${obj(k.Ultralinear)},\n      Triode: ${obj(k.Triode)}\n    }`;
}
function writeDb(results) {
  let src = readFileSync(DB_FILE, "utf8");
  for (const [name, k] of Object.entries(results)) {
    const at = src.indexOf(`commonName: "${name}"`);
    const start = src.indexOf("koren: {", at);
    let depth = 0, end = start + "koren: ".length;
    do { if (src[end] === "{") depth++; else if (src[end] === "}") depth--; end++; } while (depth > 0);
    src = src.slice(0, start) + formatKoren(k) + src.slice(end);
  }
  writeFileSync(DB_FILE, src);
}

// ---- CLI ---------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
  const names = DB.filter(t => t.category !== "rectifier").map(t => t.commonName).filter(n => !only.length || only.includes(n));
  const missing = names.filter(n => !datasheetFor(n));
  if (missing.length) { console.error(`no datasheet entry for: ${missing.join(", ")}`); process.exit(1); }
  const results = {};
  const pct = (a, b) => `${a >= b ? "+" : ""}${((a / b - 1) * 100).toFixed(0)}%`.padStart(5);
  for (const name of names) {
    const ds = datasheetFor(name), k = fitTube(name);
    results[name] = k;
    const p = ds.kind === "pentode" ? k.Pentode : k.Triode;
    const m = evaluate(ds.kind, p, ds.points);
    const rows = ds.points.map((pt, i) => {
      const r = m[i];
      return `Ia ${r.ia.toFixed(1)}${pt.vg === null ? ` @${r.vg.toFixed(1)}V` : ` ${pct(r.ia, pt.ia)}`}` +
        (pt.gm ? ` gm ${pct(r.gm, pt.gm)}` : "") + (pt.rp ? ` rp ${pct(r.rp, pt.rp)}` : "") + (pt.ig2 ? ` Ig2 ${pct(r.ig2, pt.ig2)}` : "");
    });
    console.log(`${name.padEnd(9)} ${JSON.stringify(p)}  ${rows.join(" | ")}${k.strapRms !== undefined ? `  strap ${(k.strapRms * 100).toFixed(1)}%` : ""}`);
  }
  if (process.argv.includes("--write")) { writeDb(results); console.log(`\nupdated ${Object.keys(results).length} tubes in tube-db.js`); }
}
export { DATASHEETS };
