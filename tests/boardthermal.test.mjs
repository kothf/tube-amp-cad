/* The board's thermal estimate (board-thermal.js): heat sources, the plate, the parts' heat paths. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
for (const f of ["tube-db.js", "sim-engine.js", "spice-model.js", "spice-net.js", "cad-components.js", "mpn.js", "board-outline.js", "board-core.js", "board-fab.js", "board-3d.js", "board-thermal.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
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
  // what it loses at its mean temperature, face by face as MöbiusCAD has it: the two upright faces and the two upright
  // edges h = 1.42·(ΔT/0.02)^¼, the top edge 1.32·(ΔT/L)^¼ and the bottom one 0.59·(ΔT/L)^¼ (L = area/perimeter, at
  // least 1 mm), and radiation ε·σ·(T²+Ta²)(T+Ta) from the two faces
  let sum = 0, cnt = 0; for (const a of [r.top, r.bottom]) for (const v of a) if (Number.isFinite(v)) { sum += v; cnt++; }
  const Tm = sum / cnt, dT = Tm - 25, x = Tm + 273.15, y = 298.15, q = Math.pow(dT, 0.25), t = s.board.stackup.thickness * 1e-3;
  const conv = 1.42 * q / Math.pow(0.02, 0.25) * (2 * 4e-4 + 2 * 0.02 * t) + (1.32 + 0.59) * q / Math.pow(1e-3, 0.25) * 0.02 * t;
  near(conv * dT + 0.9 * 5.670374e-8 * (x * x + y * y) * (x + y) * 2 * 4e-4 * dT, p.toBoard, 0.05 * p.toBoard, "the board's loss is what the part put into it");
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

test("an electrolytic's life doubles for every 10 °C under its rating, from its own two fields", () => {
  near(T.capLife(2000, 105, 105), 2000, 1e-9, "at its rating"); near(T.capLife(2000, 105, 85), 8000, 1e-6, "20 °C under"); near(T.capLife(5000, 85, 95), 2500, 1e-6, "10 °C over");
  assert.equal(T.capLife(10000, 105, 20), 130000, "no more than 15 years of running");
  const cap = (id, label, params) => part(id, "electrolytic", label, params, { "+": 1, "-": 0 });
  const s = setup(70, 50, [R("r1", "R1", "5"), cap("c1", "C1", {}), cap("c2", "C2", { temp: 85, life: 1000 })], { R1: { x: 35, y: 25 }, C1: { x: 35, y: 12 }, C2: { x: 35, y: 38 } }, { r1: 4 });
  const r = run(s), c1 = of(r, "C1"), c2 = of(r, "C2");
  assert.equal(c1.limit, 105); assert.equal(c1.lifeRated, 2000); assert.equal(c2.limit, 85); assert.equal(c2.lifeRated, 1000);
  assert.ok(c1.t > r.ambient + 3, `the capacitor is warmed by the resistor beside it: ${c1.t}`);
  near(c1.life, Math.min(130000, 2000 * 2 ** ((105 - c1.t) / 10)), 1e-6, "C1 life"); near(c2.life, 1000 * 2 ** ((85 - c2.t) / 10), 1e-6, "C2 life");
  assert.equal(of(r, "R1").life, undefined);
  assert.equal(T.lifeText(8300), "8 300 h"); assert.equal(T.lifeText(23400), "23 000 h"); assert.equal(T.lifeText(130000), "over 130 000 h");
});

test("the map's findings: a board past 105 °C, a part over its rating, an electrolytic with a short life; none on a cool board", () => {
  const cap = (id, label, params) => part(id, "electrolytic", label, params, { "+": 1, "-": 0 });
  const mk = w => setup(70, 50, [R("r1", "R1", "2"), cap("c1", "C1", { temp: 85, life: 1000 })], { R1: { x: 35, y: 25 }, C1: { x: 35, y: 15 } }, { r1: w });
  const cool = run(mk(0.2));
  assert.deepEqual(T.checks(cool, {}).filter(d => !/C1/.test(d.msg)), [], "0.2 W troubles nothing");
  const hot = run(mk(4)), list = T.checks(hot, { capLife: 50000 });
  assert.ok(list.every(d => d.kind === "thermal" && Number.isFinite(d.x) && Number.isFinite(d.y)));
  const board = list.find(d => /^The board reaches/.test(d.msg)), res = list.find(d => /^R1/.test(d.msg)), c1 = list.find(d => /^C1/.test(d.msg));
  assert.ok(hot.boardMax > 105 && board && /R1/.test(board.msg) && /105 °C/.test(board.msg), board && board.msg);
  assert.ok(res && /body \d+ °C with 4 W in it/.test(res.msg) && /over its 155 °C/.test(res.msg), res && res.msg);
  assert.ok(c1 && (/over its rating/.test(c1.msg) || /of life, under 50 000 h/.test(c1.msg)), c1 && c1.msg);
  near(res.x, 35, 1, "the note sits on the part"); near(res.y, 25, 1, "the note sits on the part");
  // the limits are the board's rules
  assert.equal(T.checks(hot, { boardTmax: 400 }).some(d => /^The board/.test(d.msg)), false);
  const mild = run(mk(0.2)), cm = of(mild, "C1");
  assert.equal(T.checks(mild, { capLife: 100 }).some(d => /^C1/.test(d.msg)), false);
  assert.equal(T.checks(mild, { capLife: cm.life * 2 }).some(d => /^C1/.test(d.msg)), true);
  assert.deepEqual(T.checks({ ok: false }, {}), []);
});

test("a hot resistor raised off the board on its leads: the board under it cools, the 3D body and the height follow", () => {
  const mk = lift => setup(70, 50, [R("r1", "R1", "5")], { R1: { x: 35, y: 25, ...(lift ? { lift } : {}) } }, { r1: 3 });
  const flat = run(mk(0)), up = run(mk(6)), f = of(flat, "R1"), u = of(up, "R1");
  assert.equal(f.mount, "lying"); assert.equal(u.mount, "raised");
  // under the body; the hottest spot is then at the pads, which take what the copper leads (385 W/m·K) bring: about the same
  const mid = r => T.at(r, 35, 25, "top");
  assert.ok(mid(up) < mid(flat) - 30 && up.boardMax <= flat.boardMax + 5, `the board under it: ${mid(flat)} → ${mid(up)}, hottest ${flat.boardMax} → ${up.boardMax}`);
  assert.ok(u.toBoard < f.toBoard * 0.75, `into the board: ${f.toBoard} → ${u.toBoard} W`);
  // the body sits 6 mm up in 3D (and so in STEP), and the height check counts it
  const s = mk(6), g = s.model.parts.find(q => q.ref === "R1"), sol = globalThis.Board3D.partBodies(g, 1.6, {}), z0 = Math.min(...sol.filter(q => q.color === globalThis.Board3D.COLORS.resistor).flatMap(q => q.verts.map(v => v[2])));
  near(z0, 1.6 + 6, 0.01, "body underside");
  assert.equal(B.liftOf(s.board.parts[g.key], g.fp.name), 6); assert.equal(B.liftOf({ fp: g.fp.name, lift: 40 }), 15);
  assert.equal(B.liftOf({ fp: g.fp.name, lift: 6, mount: "V" }), 0, "a standing part has no lift");
  s.board.rules.maxHeight = 12; const drc = B.drc(s.board, s.model, B.connectivity(s.board, s.model.pads, []), new Set(), [], s.netlist);
  assert.ok(drc.some(d => d.kind === "height" && /raised 6 mm off the board/.test(d.msg)), drc.map(d => d.msg).join("; "));
});

test("a tab case's middle lead is the tab's own: it meets the tab, and the board takes the part's heat at its pad", () => {
  const D3 = globalThis.Board3D;
  for (const [type, model, fp] of [["nmos", "IRF540", "TO-220-GDS"], ["npn", "TIP41C", "TO-247-BCE"]]) {
    const pins = type === "nmos" ? { D: 1, G: 2, S: 0 } : { C: 1, B: 2, E: 0 };
    const s = setup(80, 60, [part("q1", type, "VT1", { model }, pins)], { VT1: { x: 40, y: 30, heat: "air" } }, { q1: 1.5 }, b => { Object.values(b.parts)[0].fp = fp; });
    const g = s.model.parts.find(x => x.ref === "VT1"), sol = D3.partBodies(g, 1.6, {}), tab = sol.find(x => x.mat === "tab"), tl = sol.filter(x => x.tabLead);
    assert.equal(g.fp.name, fp); assert.equal(tl.length, 1, `${fp}: one lead is the tab's`);
    // the lead's top end lies on the tab's bottom face, inside its outline
    const top = tl[0].round.o.map((v, k) => v + tl[0].round.a[k] * tl[0].round.h), lo = k => Math.min(...tab.verts.map(v => v[k])), hi = k => Math.max(...tab.verts.map(v => v[k]));
    near(Math.max(top[2], tl[0].round.o[2]), lo(2), 1e-6, `${fp}: the lead reaches the tab's underside`);
    assert.ok(top[0] > lo(0) && top[0] < hi(0) && top[1] > lo(1) && top[1] < hi(1), `${fp}: under the tab`);
    const r = of(run(s), "VT1"), discs = (r.into || []).filter(q => q.disc);
    assert.ok(r.toBoard > 0.2, `${fp}: into the board ${r.toBoard} W`);
    // its board share enters at one pad, the tab lead's (the middle one), not shared by all three
    assert.equal(discs.length, 1, `${fp}: ${JSON.stringify(r.into)}`);
    near(discs[0].disc[0], g.place.x, 0.01, `${fp}: at the middle pad`);
  }
});

test("inner bodies: a die on the tab sized to the datasheet's Rjc, an electrolytic's winding in its can; nothing overlaps, covered faces are not cooled", () => {
  const D3 = globalThis.Board3D, M = D3.MATERIALS;
  const inside = (a, b) => { const bx = s => [0, 1, 2].map(k => [Math.min(...s.verts.map(v => v[k])), Math.max(...s.verts.map(v => v[k]))]); const A = bx(a), B2 = bx(b); return A.every(([lo, hi], k) => Math.min(hi, B2[k][1]) - Math.max(lo, B2[k][0]) > 1e-6); };
  // a TO-220 MOSFET: moulding, tab and die apart, the die inside, its junction to case the datasheet's
  const q = part("q1", "nmos", "VT1", { model: "IRF540" }, { D: 1, G: 2, S: 0 });
  const s = setup(80, 60, [q], { VT1: { x: 40, y: 30 } }, { q1: 5 }), g = s.model.parts.find(x => x.ref === "VT1"), sol = D3.partBodies(g, 1.6, {});
  const die = sol.filter(x => x.mat === "silicon"), tab = sol.find(x => x.mat === "tab"), mould = sol.filter(x => x.mat === "epoxy");
  assert.equal(die.length, 1); assert.ok(die[0].inner && die[0].heat && tab && mould.length >= 4);
  assert.ok(sol.filter(x => x.heat).every(x => x === die[0]), "the die alone makes the heat");
  for (const a of [die[0], tab, ...mould]) for (const b of [die[0], tab, ...mould]) if (a !== b) assert.ok(!inside(a, b), "no two bodies overlap");
  const side = Math.sqrt([0, 1, 2].map(k => Math.max(...die[0].verts.map(v => v[k])) - Math.min(...die[0].verts.map(v => v[k]))).sort((x, y) => x - y).slice(1).reduce((x, y) => x * y));
  near(D3.dieR(side), (150 - 25) / L.MOSFETS.IRF540.p, 0.01, "the die's Rjc is the datasheet's");
  // in free air the epoxy is its own node, joined to the tab where they touch: it runs cooler than the tab
  const fa = setup(80, 60, [part("q1", "nmos", "VT1", { model: "IRF540" }, { D: 1, G: 2, S: 0 })], { VT1: { x: 40, y: 30, heat: "air" } }, { q1: 1.5 }), qa = of(run(fa), "VT1");
  assert.equal(qa.bodies.length, 1); assert.ok(qa.bodies[0].t < qa.t - 5 && qa.bodies[0].t > 40, `moulding ${qa.bodies[0].t} °C, tab ${qa.t} °C`);
  const f = T.films(sol, [0, 0, -1]);
  assert.ok(f.area < T.films(sol.filter(x => !x.inner).map(x => ({ ...x, cover: undefined })), [0, 0, -1]).area, "faces between the bodies are not open to the air");
  // a radial electrolytic: the can round the winding and the bung, the core makes the heat; the map's core is hotter than the can
  const cap = part("c1", "electrolytic", "C1", {}, { "+": 1, "-": 0 });
  const sc = setup(70, 50, [cap], { C1: { x: 35, y: 25 } }, { c1: 0.5 }), gc = sc.model.parts.find(x => x.ref === "C1"), cs = D3.partBodies(gc, 1.6, {});
  const can = cs.find(x => x.round && x.round.holes && x.round.holes.length), core = cs.find(x => x.mat === "ecore");
  assert.ok(can && core && core.inner && core.heat && cs.some(x => x.mat === "rubber"));
  near(can.round.holes[0].r, core.round.outer[0].r, 1e-9, "the winding fills the can's bore");
  const c = of(run(sc), "C1");
  near(c.tCore, c.t + 0.5 / (4 * Math.PI * M.ecore.k * core.round.h * 1e-3), 1e-6, "the core: P / (4π·k·L) over the can");
  near(c.life, Math.min(130000, 2000 * 2 ** ((105 - c.tCore) / 10)), 1e-6, "life from the core");
});

test("small packages, metal cans and axial electrolytics are modelled inside too: a paddle and die, a die on the header, a core", () => {
  const D3 = globalThis.Board3D;
  const bodiesOf = (name, pins) => D3.partBodies({ ref: "X1", type: "npn", members: [], fp: B.footprint(name, pins), place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {});
  for (const [name, pins] of [["TO-92-EBC", ["E", "B", "C"]], ["SOT-23-BEC", ["B", "E", "C"]], ["DIP-8", ["1", "2", "3", "4", "5", "6", "7", "8"]], ["SOIC-8", ["1", "2", "3", "4", "5", "6", "7", "8"]]]) {
    const sol = bodiesOf(name, pins), die = sol.filter(x => x.mat === "silicon"), frame = sol.filter(x => x.mat === "frame");
    assert.equal(die.length, 1, name); assert.equal(frame.length, 2, `${name}: the paddle and the frame's own lead inside`);
    assert.ok(die[0].heat && die[0].inner && frame.every(f => f.main && f.inner), name);
    // the frame reaches a lead: copper all the way from the die to the board, as in the real part
    const leads = sol.filter(x => x.mat === "lead");
    assert.ok(frame.some(f => leads.some(l => T.faceContact(f, l).length)), `${name}: the frame touches its lead`);
    assert.ok(frame.some(f => T.faceContact(f, die[0]).length), `${name}: the die sits on the paddle`);
    assert.ok(sol.filter(x => x.mat === "epoxy").length >= 3, `${name}: the moulding in pieces round them`);
  }
  for (const [name, pins] of [["TO-18-EBC", ["E", "B", "C"]], ["TO-5-EBC", ["E", "B", "C"]]]) {
    const sol = bodiesOf(name, pins), head = sol.find(x => x.main);
    assert.ok(head && sol.some(x => x.mat === "silicon" && x.heat) && sol.some(x => x.round && x.round.holes && x.round.holes.length), `${name}: a header, a die and a hollow can`);
  }
  // a TO-18 with a rating: the die sits on an attach layer that makes its junction to case the datasheet's (a small
  // die on a kovar header alone conducts better than the rating says, so MöbiusCAD ran the junction cooler)
  {
    const q = part("q1", "npn", "VT1", { model: "BC107" }, { C: 1, B: 2, E: 0 }), s = setup(60, 40, [q], { VT1: { x: 30, y: 20 } }, { q1: 0.2 });
    const g = s.model.parts.find(x => x.ref === "VT1"), sol = D3.partBodies(g, 1.6, {}), j = T.junction(g);
    assert.match(g.fp.name, /^TO-18/);
    const box = x => [0, 1, 2].map(k => Math.max(...x.verts.map(v => v[k])) - Math.min(...x.verts.map(v => v[k])));
    const die = sol.find(x => x.mat === "silicon"), at = sol.find(x => x.mat === "attach"), a = box(die)[0], ta = at ? box(at)[2] : 0;
    assert.ok(at && at.inner && !at.heat && T.faceContact(at, die).length && T.faceContact(at, sol.find(x => x.main)).length, "the attach layer between the die and the header");
    near(D3.dieR(a, D3.MATERIALS.kovar.k) + ta * 1e-3 / (D3.MATERIALS.attach.k * a * a * 1e-6), j.rjc, 0.01, "die, attach and header spreading give the datasheet's Rjc");
    // with no rating there is nothing to match: no attach layer
    assert.ok(!bodiesOf("TO-18-EBC", ["E", "B", "C"]).some(x => x.mat === "attach"));
  }
  // SOT-223/DPAK: the frame runs on under the moulding to carry the die, which sits on it
  for (const name of ["SOT-89-BCE", "SOT-223-BCE", "DPAK-GDS", "D2PAK-GDS"]) {
    const fp = B.footprint(name, ["B", "C", "E"]);
    const sol = D3.partBodies({ ref: "X1", type: "npn", members: [], fp, place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {}), die = sol.find(x => x.mat === "silicon");
    assert.ok(die && die.heat && sol.some(x => x.mat === "tab" && T.faceContact(x, die).length), `${name}: the die on the frame`);
  }
  const ax = bodiesOf("ECAP-AXIAL-25.4", ["+", "-"]);
  assert.ok(ax.some(x => x.mat === "ecore" && x.heat) && ax.some(x => x.mat === "rubber") && ax.some(x => x.main && x.round.holes.length), "an axial electrolytic: can, core, bung");
  // on a board: a TO-92's paddle is the case node, its moulding cooler, its junction a little over the paddle
  const q = part("q1", "npn", "VT1", {}, { C: 1, B: 2, E: 0 }), s = setup(60, 40, [q], { VT1: { x: 30, y: 20 } }, { q1: 0.3 }), r = of(run(s), "VT1");
  assert.match(s.model.parts[0].fp.name, /^TO-92/);
  assert.ok(r.bodies && r.bodies[0].t < r.t && r.bodies[0].t > r.t - 30, `moulding ${r.bodies && r.bodies[0].t}, paddle ${r.t}`);
  assert.ok(r.tj > r.t && r.tj < r.t + 5, `junction ${r.tj} over the paddle ${r.t}`);
});

test("a part added by its part number: its die sized to its own Rθjc (DigiKey's or typical for the package), the junction checked against its Tjmax", () => {
  const D3 = globalThis.Board3D;
  const sp = (rj, extra) => Object.assign({}, L.LIB.spice.defaults, { name: "IRFZ44N", sym: "nmos", text: ".MODEL IRFZ44N NMOS(VTO=3 KP=20)", sub: "", pinNames: ["D", "G", "S"], map: ["D", "G", "S"],
    partno: "IRFZ44N", part: { no: "IRFZ44N", text: "TO-220", fp: "TO-220-GDS", source: "Add part" } }, rj, extra);
  const mk = prm => setup(80, 60, [{ id: "q1", type: "spice", label: "VT1", params: prm, pins: [{ id: "D", net: 1 }, { id: "G", net: 2 }, { id: "S", net: 0 }] }], { VT1: { x: 40, y: 30, heat: "air" } }, { q1: 1.5 });
  const dieOf = s => { const g = s.model.parts.find(x => x.ref === "VT1"), d = D3.partBodies(g, 1.6, {}).find(x => x.mat === "silicon");
    return D3.dieR(Math.sqrt([0, 1, 2].map(k => Math.max(...d.verts.map(v => v[k])) - Math.min(...d.verts.map(v => v[k]))).sort((x, y) => x - y).slice(1).reduce((x, y) => x * y))); };
  const own = mk(sp({ ptot: 94, rjc: 1.6, tjmax: 175, tsrc: "DigiKey" })), r = of(run(own), "VT1");
  near(dieOf(own), 1.6, 0.01, "the die's Rθjc is the part's");
  near(r.rjc, 1.6, 0.01, "the map's"); near(r.tj, r.t + 1.5 * r.rjc, 1e-6, "tj"); assert.equal(r.limit, 175);
  // a part saved before it had the fields: typical for its package
  const old = mk(sp({})), ro = of(run(old), "VT1");
  near(dieOf(old), 2, 0.01, "typical TO-220"); assert.equal(ro.limit, 150);
});
