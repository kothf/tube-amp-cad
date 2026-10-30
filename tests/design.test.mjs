/**
 * The design assistant's side without a model (ai-design.js): a netlist answer checked against
 * the part library, and drawn so that every pin reaches its net through a ground, a rail or a
 * sheet connector of the net's name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

globalThis.window = globalThis;
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "ai-circuit.js", "ai-design.js"]) runInThisContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f });
const { AiDesign: D, CadLib } = globalThis;

const stage = () => ({
  title: "12AX7 stage",
  parts: [
    { ref: "G1", type: "siggen", values: { amp: "0.1", freq: "1k" }, pins: { "+": "IN", "-": "GND" } },
    { ref: "C1", type: "capacitor", values: { c: "100n" }, pins: { 1: "IN", 2: "G" } },
    { ref: "R1", type: "resistor", values: { r: "1M" }, pins: { 1: "G", 2: "0" } },
    { ref: "VL1", type: "tube", values: { tube: "12ax7" }, pins: { A: "A", G1: "G", K: "K" } },
    { ref: "R2", type: "resistor", values: { r: "100k" }, pins: { 1: "B+", 2: "A" } },
    { ref: "R3", type: "resistor", values: { r: "1.5k" }, pins: { 1: "K", 2: "GND" } },
    { ref: "C2", type: "electrolytic", values: { c: "22u" }, pins: { "+": "K", "-": "GND" } },
    { ref: "PS", type: "rail", values: { v: "250" }, pins: { 1: "B+" } }
  ]
});

test("check: values set as the inspector does, G1 taken for a triode's G, rails folded into nets", () => {
  const c = D.check(stage());
  assert.deepEqual(c.problems, []);
  assert.equal(c.parts.length, 7);
  const vl = c.parts.find(p => p.ref === "VL1");
  assert.equal(vl.params.tube, "12AX7"); assert.equal(vl.params.connection, "triode");
  assert.deepEqual(vl.pins, { A: "A", G: "G", K: "K" });
  assert.equal(c.parts.find(p => p.ref === "R1").pins[2], "GND");
  assert.equal(c.rails.get("B+"), 250);
  assert.equal(c.parts.find(p => p.ref === "R3").params.r, 1500);
});

test("check: unknown parts, pins and values, open pins and doubled refs are reported", () => {
  const d = stage();
  d.parts.push({ ref: "X1", type: "flux-capacitor", pins: {} });
  d.parts.push({ ref: "R9", type: "resistor", values: { r: "lots" }, pins: { 1: "A", 3: "GND" } });
  d.parts.push({ ref: "R2", type: "resistor", values: { r: "1k" }, pins: { 1: "A", 2: "GND" } });
  const p = D.check(d).problems.join("\n");
  assert.match(p, /X1: no part type "flux-capacitor"/);
  assert.match(p, /R9 has no pin 3/);
  assert.match(p, /R9 pin 2 is not connected/);
  assert.match(p, /R9: .*lots/);
  assert.match(p, /R2 is used twice/);
});

test("layout: every pin ends in a ground, a rail or a connector named after its net, on an A3 sheet", () => {
  const c = D.check(stage()), out = D.layout(c, { title: "Test" });
  assert.equal(out.frame.size, "A3"); assert.equal(out.frame.title, "Test");
  const LIB = CadLib.LIB, at = new Map();
  out.comps.filter(k => ["ground", "rail", "offsheet"].includes(k.type)).forEach(k => at.set(`${k.x},${k.y}`, k.type === "ground" ? "GND" : k.params.name));
  // follow the wires from each pin to the symbol at their end
  const ends = new Map();
  out.wires.forEach(w => { ends.set(`${w.x1},${w.y1}`, `${w.x2},${w.y2}`); });
  const parts = out.comps.filter(k => !["ground", "rail", "offsheet"].includes(k.type));
  assert.equal(parts.length, 7);
  parts.forEach(k => {
    const want = c.parts.find(p => p.ref === k.label).pins;
    const pins = typeof LIB[k.type].pins === "function" ? LIB[k.type].pins(k) : LIB[k.type].pins;
    pins.forEach(q => {
      let pt = `${k.x + q.x},${k.y + q.y}`, n = 0;
      while (!at.has(pt) && ends.has(pt) && n++ < 4) pt = ends.get(pt);
      assert.equal(at.get(pt), want[q.id], `${k.label} pin ${q.id}`);
    });
  });
  // the signal runs left to right: the generator before the tube
  assert.ok(parts.find(k => k.label === "G1").x < parts.find(k => k.label === "VL1").x);
  // the B+ net is drawn as rail symbols with the voltage
  assert.ok(out.comps.some(k => k.type === "rail" && k.params.name === "B+" && k.params.v === 250));
});
