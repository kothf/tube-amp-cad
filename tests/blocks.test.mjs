/**
 * Reusable blocks (cad-blocks.js): a block made from parts and wires, where each copy stands,
 * values edited on one copy going to every copy (a sheet connector's name staying each copy's
 * own), and an old copy's wires taken out of wiring that was merged or split around them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-blocks.js", import.meta.url), "utf8"), { filename: "cad-blocks.js" });
const B = globalThis.CadBlocks;

const R = (id, x, y, r, extra) => Object.assign({ id, type: "resistor", x, y, rot: 0, label: id, params: { r } }, extra || {});

test("a block keeps its parts and wires relative to the grid corner of what they cover", () => {
  const def = { id: "b1", name: "Stage" };
  const { ox, oy, keys } = B.make(def, [R("R1", 125, 210, 1000), R("R2", 205, 210, 2200)], [{ x1: 125, y1: 240, x2: 205, y2: 240 }]);
  assert.equal(ox, 120); assert.equal(oy, 210);
  assert.deepEqual(def.comps.map(c => [c.m, c.x, c.y, c.params.r]), [["m1", 5, 0, 1000], ["m2", 85, 0, 2200]]);
  assert.deepEqual(def.wires, [{ x1: 5, y1: 30, x2: 85, y2: 30 }]);
  assert.equal(keys.get("R2"), "m2");
  assert.deepEqual(B.extent(def), { w: 85, h: 30 });
  // a member keeps its key when the block is made again from a copy; a new part gets the next one
  B.make(def, [R("R1", 125, 210, 1000), R("R9", 300, 210, 47)], [], c => (c.id === "R1" ? "m1" : null));
  assert.deepEqual(def.comps.map(c => c.m), ["m1", "m3"]);
});

test("a copy stands where most of its parts say, so one part moved alone does not move it", () => {
  const def = { id: "b1", comps: [{ m: "m1", x: 0, y: 0 }, { m: "m2", x: 40, y: 0 }, { m: "m3", x: 80, y: 0 }], wires: [] };
  const tag = (m, x, y) => ({ x, y, block: { i: "i2", d: "b1", m } });
  assert.deepEqual(B.origin(def, [tag("m1", 500, 300), tag("m2", 540, 300), tag("m3", 900, 900)]), { x: 500, y: 300 });
  const map = B.copies([tag("m1", 0, 0), { x: 0, y: 0 }, Object.assign(tag("m2", 0, 0), { block: { i: "i3", d: "b1", m: "m2" } })]);
  assert.deepEqual([...map.keys()], ["i2", "i3"]);
});

test("a value changed on one copy goes to every copy; a sheet connector's name stays its own", () => {
  const def = { id: "b1", comps: [{ m: "m1", type: "resistor", params: { r: 1000 } }, { m: "m2", type: "offsheet", params: { name: "IN" } }], wires: [] };
  const L1 = R("R1", 0, 0, 1000, { block: { i: "L", d: "b1", m: "m1" } }), R1 = R("R7", 0, 0, 1000, { block: { i: "R", d: "b1", m: "m1" } });
  const L2 = { id: "x1", type: "offsheet", params: { name: "IN_L" }, block: { i: "L", d: "b1", m: "m2" } };
  const R2 = { id: "x2", type: "offsheet", params: { name: "IN_R" }, block: { i: "R", d: "b1", m: "m2" } };
  const comps = [L1, R1, L2, R2];
  assert.equal(B.sync([def], comps, new Set()), 0, "connector names alone are no edit");
  R1.params.r = 4700;
  assert.equal(B.sync([def], comps, new Set(["R7"])), 1);
  assert.equal(L1.params.r, 4700); assert.equal(def.comps[0].params.r, 4700);
  assert.equal(L2.params.name, "IN_L"); assert.equal(R2.params.name, "IN_R");
  // the same values written in another key order are no change
  L1.params = { r: 4700 }; R1.params = Object.assign({}, { r: 4700 });
  assert.equal(B.sync([def], comps, new Set()), 0);
  // two copies differ: the selected one wins
  L1.params.r = 10; R1.params.r = 20;
  B.sync([def], comps, new Set(["R7"]));
  assert.equal(L1.params.r, 20);
});

test("an old copy's wires come out of wiring merged or split around them", () => {
  const wires = [
    { id: "a", x1: 0, y1: 0, x2: 200, y2: 0 },      // the copy's 50…150 merged with outside wire on both sides
    { id: "b", x1: 60, y1: 20, x2: 60, y2: 40 },     // a piece of the copy's longer vertical run (split at a junction)
    { id: "c", x1: 0, y1: 100, x2: 100, y2: 100 }    // not the copy's
  ];
  const out = B.subtract(wires, [{ x1: 50, y1: 0, x2: 150, y2: 0 }, { x1: 60, y1: 10, x2: 60, y2: 50 }]);
  assert.deepEqual(out, [
    { id: "a", x1: 0, y1: 0, x2: 50, y2: 0 },
    { id: "a_s1", x1: 150, y1: 0, x2: 200, y2: 0 },
    { id: "c", x1: 0, y1: 100, x2: 100, y2: 100 }
  ]);
});
