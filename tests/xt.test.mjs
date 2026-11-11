/**
 * Amass XT power connectors (XT30, XT60, XT90; male and female; right-angle and vertical PCB,
 * solder-cup and cable versions): the part, its footprints against the makers' spec sheets, the
 * design-rule checks on a board, the 3D body, the bill of materials (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "board-core.js", "pdf-export.js", "board-fab.js", "board-3d.js", "mpn.js", "bom.js"]) runInThisContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, D3 = globalThis.Board3D, BOM = globalThis.BomLib;
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const part = (id, model, label, pins) => ({ id, type: "xt", label, params: { model }, pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });

test("XT connectors: male and female of each series, nothing simulated, XP for a plug and XS for a socket", () => {
  const out = []; L.LIB.xt.build({ id: "x", params: { model: "XT60PW-M" } }, () => 1, null, out); assert.equal(out.length, 0);
  const X = L.XTS, models = Object.keys(X);
  for (const s of ["XT30", "XT60", "XT90"]) for (const g of ["M", "F"]) assert.ok(models.some(k => X[k].s === s && X[k].g === g), `${s} ${g}`);
  assert.ok(X["XT90S-F"].spark, "XT90-S anti-spark");
  for (const k of models) {
    const c = { type: "xt", params: { model: k } };
    assert.deepEqual(L.LIB.xt.pins(c).map(p => p.id), ["+", "-"]);
    assert.equal(L.LIB.xt.prefixFor(c), X[k].g === "F" ? "XS" : "XP", k);
    assert.ok(L.LIB.xt.partNo(c).startsWith(k.split("-")[0]), k);
    assert.ok(L.LIB.xt.info(c).includes(X[k].a + " A"), k);
  }
});

test("footprints: pin pitch and holes from the spec sheets, − at the chamfered end, male and female mirrored", () => {
  const pads = n => B.footprint("AMASS-" + n).pads, at = (n, nm) => pads(n).filter(p => p.name === nm);
  const pitch = { XT30: 5, XT60: 7.2, XT90: 10.9 }, drill = { XT30PW: 1.7, XT60PW: 2.7, XT90PW: 3.9 };
  for (const n of ["XT30PW-M", "XT30PW-F", "XT60PW-M", "XT60PW-F", "XT90PW-M", "XT90PW-F", "XT30UPB-M", "XT30UPB-F", "XT60-M", "XT60-F"]) {
    const [m] = at(n, "-"), [p] = at(n, "+"), s = n.slice(0, 4);
    near(Math.abs(p.x - m.x), pitch[s], 1e-9, n + " pitch");
    assert.equal(m.y, 0); assert.equal(p.y, 0);
    if (drill[n.slice(0, 6)]) near(m.drill, drill[n.slice(0, 6)], 1e-9, n + " drill");
    pads(n).forEach(q => assert.ok(q.w - q.drill >= 0.6, `${n} pad ${q.num}: annular ring`));
  }
  // the mounting tabs: XT30PW pegs 11 mm apart, 10 (male) / 5 (female) behind the pins; XT60PW 13.5 mm, 6 mm;
  // XT90PW 18.9 mm, 9.4 (male) / 8.9 (female)
  for (const [n, w, d] of [["XT30PW-M", 11, 10], ["XT30PW-F", 11, 5], ["XT60PW-M", 13.5, 6], ["XT60PW-F", 13.5, 6], ["XT90PW-M", 18.9, 9.4], ["XT90PW-F", 18.9, 8.9]]) {
    const mp = at(n, "MP");
    assert.equal(mp.length, 2, n);
    near(Math.abs(mp[1].x - mp[0].x), w, 1e-9, n + " tabs apart"); near(mp[0].y, d, 1e-9, n + " tabs behind the pins");
  }
  // the right-angle ones mate face to face: a series' male and female have − on opposite sides
  for (const s of ["XT30", "XT60", "XT90"]) assert.equal(Math.sign(at(s + "PW-M", "-")[0].x), -Math.sign(at(s + "PW-F", "-")[0].x), s);
  // the datasheet sizes: XT60PW 15.5 mm wide, XT90PW 20.8 mm wide, 27.1 / 25.4 mm long
  const box = n => B.footprint("AMASS-" + n).xt.body.reduce((b, [x1, y1, x2, y2]) => [Math.min(b[0], x1), Math.min(b[1], y1), Math.max(b[2], x2), Math.max(b[3], y2)], [Infinity, Infinity, -Infinity, -Infinity]);
  near(box("XT60PW-M")[2] - box("XT60PW-M")[0], 15.5, 1e-9, "XT60PW width");
  near(box("XT90PW-M")[2] - box("XT90PW-M")[0], 20.8, 1e-9, "XT90PW width");
  near(box("XT90PW-M")[3] - box("XT90PW-M")[1], 27.1, 1e-9, "XT90PW-M length");
  near(box("XT90PW-F")[3] - box("XT90PW-F")[1], 25.4, 1e-9, "XT90PW-F length");
  near(B.footprint("AMASS-XT90PW-M").zHeight, 10.2, 1e-9, "XT90PW height");
});

test("board: every model on every footprint it offers, pins on their pads, a 3D body, no rule broken by the pattern itself", () => {
  for (const model of Object.keys(L.XTS)) {
    const netlist = { names: { 1: "+12V", 0: "GND" }, volts: { 1: 12, 0: 0 }, parts: [part("j", model, "XP1", { "+": 1, "-": 0 })] };
    const g = B.physicalParts(netlist)[0];
    assert.equal(g.options[g.options.length - 1], "WIRE-2", model);
    if (L.XTS[model].mount === "cable") assert.deepEqual(g.options, ["WIRE-2"], model);
    for (const name of g.options) {
      const f = B.footprint(name, ["+", "-"]);
      assert.ok(f, `${model}: ${name}`);
      const map = B.padMap(g, f), got = new Map([...map.entries()].map(([num, v]) => [v[0].pin, f.pads.find(p => p.num === num).name]));
      if (/^AMASS/.test(name)) { assert.equal(got.get("+"), "+"); assert.equal(got.get("-"), "-"); }
      else assert.equal(got.size, 2);
      const bodies = D3.partBodies({ ...g, fp: f, place: { x: 50, y: 40, rot: 0, side: "F" } }, 1.6, {});
      assert.ok(bodies.length && bodies.every(s => s.verts.every(v => v.every(Number.isFinite))), `${model} on ${name}: 3D body`);
      // on a board of its own, its pads wired: no clearance, ring, drill, silk or courtyard message
      const board = B.newBoard(); board.outline = { w: 60, h: 50, r: 0 }; B.sync(board, netlist);
      Object.values(board.parts).forEach(p => Object.assign(p, { x: 30, y: 20, fp: name }));
      const m = B.model(board, netlist), conn = B.connectivity(board, m.pads), drc = B.drc(board, m, conn, B.hvNets(netlist.volts, board.rules.hvVolts), [], netlist);
      const bad = drc.filter(d => ["clearance", "short", "annular", "drill", "silk", "courtyard", "edge"].includes(d.kind));
      assert.deepEqual(bad.map(d => d.msg), [], `${model} on ${name}`);
      // a right-angle one with its mouth flush with the board's edge is on the board
      if (/PW-/.test(name)) {
        Object.values(board.parts).forEach(p => Object.assign(p, { y: board.outline.h - Math.max(...f.xt.body.map(b => b[3])) }));
        const m2 = B.model(board, netlist), d2 = B.drc(board, m2, B.connectivity(board, m2.pads), B.hvNets(netlist.volts, board.rules.hvVolts), [], netlist);
        assert.deepEqual(d2.filter(d => d.kind === "edge").map(d => d.msg), [], `${model} flush with the edge`);
      }
    }
  }
});

test("BOM: the Amass order code as the part number unless one is typed, the rating from the spec sheet", () => {
  const circuit = { comps: [{ id: "a", type: "xt", label: "XP1", params: { model: "XT60PW-M" } }, { id: "b", type: "xt", label: "XS1", params: { model: "XT90S-F" } }, { id: "c", type: "xt", label: "XP2", params: { model: "XT30PW-M", partno: "MY-123" } }] };
  const rows = BOM.build(circuit.comps, {}), by = r => rows.find(x => x.refs === r);
  assert.equal(by("XP1").partno, "XT60PW-M30.G.Y");
  assert.match(by("XP1").desc, /Amass XT60 male, right-angle PCB/);
  assert.equal(by("XP1").rating, "35 A, 500 V DC");
  assert.match(by("XS1").desc, /XT90 female, anti-spark, cable/);
  assert.equal(by("XS1").partno, "XT90S-F.G.Y");
  assert.equal(by("XP2").partno, "MY-123");
});
