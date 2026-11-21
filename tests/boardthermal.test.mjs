/* The board's thermal estimate (board-thermal.js): heat sources, the plate, the parts' heat paths. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-outline.js", "board-core.js", "board-fab.js", "board-3d.js", "board-thermal.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, T = globalThis.BoardThermal;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} ± ${tol}`);
const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
// a board w × h with the parts placed at [x, y] (and what else `place` says of each), heat { id: W }
function setup(w, h, parts, where, heat, edit) {
  const netlist = { names: { 0: "GND" }, volts: {}, parts, heat: Object.fromEntries(Object.entries(heat).map(([k, v]) => [k, typeof v === "number" ? { p: v } : v])) };
  const board = B.newBoard(); board.outline = { w, h, r: 0 };
  B.sync(board, netlist);
  Object.values(board.parts).forEach(bp => Object.assign(bp, where[bp.ref] || {}));
  if (edit) edit(board);
  return { board, netlist, model: B.model(board, netlist) };
}
const run = (s, opts) => T.solve(s.board, s.model, s.netlist, opts);
const R = (id, label, w, pins) => part(id, "resistor", label, { r: 1000, w }, pins || { 1: 1, 2: 2 });
const of = (r, ref) => r.parts.find(p => p.ref === ref);

test("nothing without a simulation; no heat leaves everything at the ambient", () => {
  const s = setup(60, 40, [R("r1", "R1", "5")], { R1: { x: 30, y: 20 } }, {});
  assert.equal(T.solve(s.board, s.model, { ...s.netlist, heat: undefined }).ok, false);
  const r = run(s, { ambient: 35 });
  assert.ok(r.ok); near(r.boardMax, 35, 0.01, "board"); near(of(r, "R1").t, 35, 0.01, "R1");
});

test("the heat that goes in comes out: energy balance, and each part's shares add up to what it dissipates", () => {
  const s = setup(80, 60, [R("r1", "R1", "5"), R("r2", "R2", "2", { 1: 2, 2: 3 })], { R1: { x: 25, y: 30 }, R2: { x: 55, y: 30 } }, { r1: 3, r2: 0.8 });
  const r = run(s);
  near(r.total, 3.8, 1e-9, "total");
  assert.ok(Math.abs(r.balance) < 0.005 * r.total, `balance ${r.balance}`);
  r.parts.forEach(p => near(p.toBoard + p.toAir + p.toSink + p.byRadiation, p.p + p.heater, 0.01 * Math.max(0.5, p.p), `${p.ref} shares`));
  const a = of(r, "R1"), b = of(r, "R2");
  assert.ok(a.t > b.t && b.t > r.ambient + 5, "the 3 W part is the hotter");
  assert.equal(a.limit, 155);
  // the board is hottest by the hotter part, and warmer there than in the far corner
  assert.ok(Math.hypot(r.hot.x - 25, r.hot.y - 30) < 16, `hot spot at ${r.hot.x}, ${r.hot.y}`);
  assert.ok(T.at(r, 25, 30, "top") > T.at(r, 78, 2, "top") + 3);
  assert.equal(T.at(r, -5, 10, "top"), null);
});

test("more power, a warmer ambient, a closed chassis and a face looking down all make it hotter", () => {
  const mk = p => setup(70, 50, [R("r1", "R1", "5")], { R1: { x: 35, y: 25 } }, { r1: p });
  const base = run(mk(2), { ambient: 25, enclosure: "open" }), t = r => of(r, "R1").t;
  assert.ok(t(run(mk(4), { ambient: 25, enclosure: "open" })) > t(base) + 10);
  const warm = run(mk(2), { ambient: 45, enclosure: "open" });
  assert.ok(t(warm) - t(base) > 12 && t(warm) - t(base) < 20, `20 °C more ambient gives a little under 20 °C more (radiation grows with temperature): ${t(warm) - t(base)}`);
  assert.ok(t(run(mk(2), { ambient: 25, enclosure: "closed" })) > t(base) + 2);
  assert.ok(run(mk(2), { ambient: 25, enclosure: "open", orient: "down" }).boardMax > base.boardMax);
});

test("a small board all copper is nearly isothermal, at the temperature its own surface laws give", () => {
  const s = setup(20, 20, [R("r1", "R1", "2")], { R1: { x: 10, y: 10 } }, { r1: 0.5 }, b => { b.zones.push({ net: "GND", layer: "F.Cu", pts: null }, { net: "GND", layer: "B.Cu", pts: null }); });
  const r = run(s, { ambient: 25, enclosure: "open", orient: "vertical" }), p = of(r, "R1");
  let lo = Infinity, hi = -Infinity; for (const v of r.top) if (Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi - lo < 0.25 * (hi - 25), `spread ${hi - lo} of a rise ${hi - 25}`);
  // what the two faces lose at their mean temperature: h = 1.42·(ΔT/L)^¼ + ε·σ·(T²+Ta²)(T+Ta), over 2 × 4 cm²
  let sum = 0, cnt = 0; for (const a of [r.top, r.bottom]) for (const v of a) if (Number.isFinite(v)) { sum += v; cnt++; }
  const Tm = sum / cnt, dT = Tm - 25, x = Tm + 273.15, y = 298.15, h = 1.42 * Math.pow(dT / 0.02, 0.25) + 0.9 * 5.670374e-8 * (x * x + y * y) * (x + y);
  near(h * 2 * 4e-4 * dT, p.toBoard, 0.08 * p.toBoard, "the board's loss is what the part put into it");
});

test("a resistor lying on the board and one standing on it: the same heat, different paths", () => {
  const mk = vert => setup(70, 50, [R("r1", "R1", "2")], { R1: { x: 35, y: 25 } }, { r1: 1.5 }, b => { if (vert) Object.values(b.parts)[0].mount = "V"; });
  const lie = of(run(mk(false)), "R1"), stand = of(run(mk(true)), "R1");
  assert.equal(lie.mount, "lying"); assert.equal(stand.mount, "standing");
  near(lie.toBoard + lie.toAir, 1.5, 0.02, "lying"); near(stand.toBoard + stand.toAir, 1.5, 0.02, "standing");
  assert.ok(lie.toBoard > 0.2 && stand.toBoard > 0.2 && lie.toAir > 0.2 && stand.toAir > 0.2, "both lose heat both ways");
});

test("a TO-220 over 2 W: on a heatsink by itself, hot in free air, the board's to cool when its tab lies on the copper", () => {
  const q = () => part("q1", "nmos", "VT1", { model: "IRF540" }, { D: 1, G: 2, S: 0 });
  const mk = heat => setup(80, 60, [q()], { VT1: { x: 40, y: 30 } }, { q1: 5 }, b => { const bp = Object.values(b.parts)[0]; assert.match(bp.fp, /^TO-220/); if (heat) bp.heat = heat; });
  const auto = run(mk()), air = run(mk("air")), tab = run(mk("board")), sink = run(mk("heatsink")), a = of(auto, "VT1"), f = of(air, "VT1"), t = of(tab, "VT1");
  assert.equal(a.mount, "heatsink"); assert.ok(a.assumed); assert.ok(a.toSink > 4.5, `to the heatsink ${a.toSink}`);
  near(a.t, 40 + 5 * 2, 2, "case: ambient + 5 W × (1.5 + 0.5) °C/W");
  near(a.tj, a.t + 5 * (150 - 25) / L.MOSFETS.IRF540.p, 0.5, "junction over the case by Rjc = (150 − 25)/Ptot");
  assert.equal(a.limit, 150);
  assert.ok(!f.assumed && f.t > 150 && f.tj > f.limit, `free air: ${f.t} °C`);
  assert.equal(t.mount, "tab"); assert.ok(t.toBoard > 2 && t.toBoard > 10 * a.toBoard, `into the board ${t.toBoard}`);
  assert.ok(tab.boardMax - 40 > 3 * (auto.boardMax - 40), `board ${tab.boardMax} with the tab on it, ${auto.boardMax} on the heatsink`);
  assert.equal(of(sink, "VT1").assumed, false);
  // the simulation's own heatsink temperature (the Cooling field) is kept
  const s = setup(80, 60, [q()], { VT1: { x: 40, y: 30 } }, { q1: { p: 5, tj: 96, ts: 70, sink: "hs1" } }), e = of(run(s), "VT1");
  assert.equal(e.tj, 96); near(e.t, 70 + 5 * 0.5, 1, "case: the heatsink's 70 °C through the insulator");
});

test("a valve: its heater counts once per envelope, the bulb is the hot part, the board warms round its socket", () => {
  const tube = (id, lab, pins) => part(id, "tube", lab, { tube: "12AX7" }, pins);
  const s = setup(100, 80, [tube("a", "VL1.1", { A: 1, G: 2, K: 3 }), tube("b", "VL1.2", { A: 4, G: 5, K: 6 }), R("r1", "R1", "0.5", { 1: 1, 2: 7 })], { VL1: { x: 40, y: 40 }, R1: { x: 60, y: 40 } }, { a: { p: 0.9, idle: 0.6 }, b: 0.9 });
  const t12 = L.tubeByName("12AX7"), src = T.sources(s.model, s.netlist, "sim").get(s.model.parts.find(g => g.ref === "VL1").key);
  near(src.p, 1.8, 1e-9, "both sections"); near(src.heater, t12.vh * t12.ih, 1e-9, "one heater");
  near(T.sources(s.model, s.netlist, "idle").get(s.model.parts.find(g => g.ref === "VL1").key).p, 1.5, 1e-9, "at idle");
  const r = run(s), v = of(r, "VL1"), n = of(r, "R1");
  assert.equal(v.mount, "socket"); assert.equal(v.tKind, "bulb"); assert.ok(v.t > 60 && v.t < 160, `bulb ${v.t}`);
  assert.ok(v.byRadiation > 0.05, "it radiates onto the board and its neighbour");
  assert.ok(n.t > r.ambient + 1 && n.p === 0, `the resistor beside it is warmed: ${n.t}`);
  assert.ok(T.at(r, 40, 40, "top") > T.at(r, 98, 2, "top") + 2, "the board is warmest at the socket");
});

test("a shaped board: cells outside the outline and in its cut-outs carry no temperature", () => {
  const s = setup(60, 40, [R("r1", "R1", "2")], { R1: { x: 15, y: 20 } }, { r1: 1 }, b => { b.outline = { w: 60, h: 40, r: 10 }; });
  const r = run(s);
  assert.equal(T.at(r, 0.3, 0.3, "top"), null); assert.ok(T.at(r, 30, 20, "bottom") > 40);
});

test("the colour scale runs from dark to pale, and stays inside 0–1", () => {
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  let last = -1; for (let u = 0; u <= 1.0001; u += 0.05) { const c = T.color(u); assert.ok(c.every(v => v >= 0 && v <= 1)); assert.ok(lum(c) > last); last = lum(c); }
  assert.deepEqual(T.color(-3), T.color(0)); assert.deepEqual(T.color(NaN), T.color(0));
});

test("every part of the library that goes on a board solves with 1 W in it: finite temperatures, the heat accounted for", () => {
  let n = 0;
  for (const type of Object.keys(L.LIB)) {
    const def = L.LIB[type], c = { id: "x1", type, label: "X1", params: Object.assign({}, def.defaults), rot: 0, x: 0, y: 0 }, pins = (typeof def.pins === "function" ? def.pins(c) : def.pins) || [];
    if (!pins.length) continue;
    const netlist = { names: {}, volts: {}, parts: [{ id: "x1", type, label: "X1", params: c.params, pins: pins.map((p, k) => ({ id: p.id, net: k + 1 })) }], heat: { x1: { p: 1 } } };
    const board = B.newBoard(); board.outline = { w: 90, h: 70, r: 0 }; B.sync(board, netlist);
    const bp = Object.values(board.parts)[0]; if (!bp) continue;
    bp.x = 45; bp.y = 35;
    const r = T.solve(board, B.model(board, netlist), netlist), p = r.parts[0];
    assert.ok(r.ok && p, `${type} solves`); n++;
    assert.ok(Math.abs(r.balance) < 0.01, `${type}: balance ${r.balance}`);
    assert.ok(Number.isFinite(r.boardMax) && r.boardMax >= 40 - 1e-6 && r.boardMax < 400, `${type}: board ${r.boardMax}`);
    if (p.off) { assert.equal(p.t, null); near(p.toSink, p.p + p.heater, 1e-9, `${type}: off the board`); }
    else assert.ok(p.t > 41 && p.t < 400 && p.toBoard > 0 && p.toAir > 0, `${type}: ${p.t} °C, ${p.toBoard} W into the board`);
  }
  assert.ok(n > 50, `${n} part types`);
});
