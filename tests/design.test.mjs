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
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "ai-circuit.js", "sch-layout.js", "ai-design.js"]) runInThisContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f });
const { AiDesign: D, CadLib, SchLayout } = globalThis;

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

// the nets of a drawing as the CAD reads them: wire ends and pins at one point join, a point on
// the middle of a wire joins it, grounds join, rails / sheet connectors / net labels join by name
function netsOf(out) {
  const par = new Map(), key = (x, y) => x + "," + y;
  const find = k => { if (!par.has(k)) par.set(k, k); while (par.get(k) !== k) { par.set(k, par.get(par.get(k))); k = par.get(k); } return k; };
  const uni = (a, b) => par.set(find(a), find(b));
  const pts = [], pin = new Map();
  out.comps.forEach(c => { const s = SchLayout.shape({ type: c.type, params: c.params, ref: c.label || "" }, c.rot, c.params.flip === "yes"); s.pins.forEach(q => { const x = c.x + q.x, y = c.y + q.y; pts.push([x, y]); if (c.label) pin.set(c.label + "." + q.id, key(x, y)); }); });
  (out.wires || []).forEach(w => pts.push([w.x1, w.y1], [w.x2, w.y2]));
  (out.wires || []).forEach(w => { uni(key(w.x1, w.y1), key(w.x2, w.y2)); pts.forEach(([x, y]) => { const on = w.y1 === w.y2 ? y === w.y1 && x > Math.min(w.x1, w.x2) && x < Math.max(w.x1, w.x2) : x === w.x1 && y > Math.min(w.y1, w.y2) && y < Math.max(w.y1, w.y2); if (on) uni(key(x, y), key(w.x1, w.y1)); }); });
  const named = new Map();
  out.comps.forEach(c => { const n = c.type === "ground" ? "GND" : ["rail", "netlabel", "offsheet"].includes(c.type) ? c.params.name : null; if (n === null) return; const k = key(c.x, c.y); if (named.has(n)) uni(k, named.get(n)); else named.set(n, k); });
  return { of: ref => find(pin.get(ref)), named, find };
}
// the drawing joins exactly the pins the netlist joins
function sameNets(parts, out) {
  const N = netsOf(out), got = new Map(), seen = new Map(), errs = [];
  parts.forEach(p => Object.entries(p.pins).forEach(([id, n]) => { const k = N.of(p.ref + "." + id); if (!got.has(n)) got.set(n, k); else if (got.get(n) !== k) errs.push(`${p.ref}.${id} is not on ${n}`); }));
  got.forEach((k, n) => { if (seen.has(k)) errs.push(`${n} is joined to ${seen.get(k)}`); seen.set(k, n); });
  return errs;
}
const boxOf = c => { const s = SchLayout.shape({ type: c.type, params: c.params, ref: c.label || "" }, c.rot, c.params.flip === "yes"); return [c.x + s.box[0], c.y + s.box[1], c.x + s.box[2], c.y + s.box[3]]; };

test("layout: drawn as a person draws it: wires join the parts, rails on top, one ground line, no labels needed", () => {
  const c = D.check(stage()), out = D.layout(c, { title: "Test" });
  assert.equal(out.frame.size, "A3"); assert.equal(out.frame.title, "Test");
  assert.deepEqual(sameNets(c.parts, out), []);
  const parts = out.comps.filter(k => k.label);
  assert.equal(parts.length, 7);
  // real wires, no labels: a small stage has no far connections
  assert.equal(out.comps.filter(k => k.type === "netlabel" || k.type === "offsheet").length, 0);
  assert.ok(out.wires.length >= 8);
  // the signal runs left to right: the generator before the tube
  assert.ok(parts.find(k => k.label === "G1").x < parts.find(k => k.label === "VL1").x);
  // the anode load stands above the tube, the cathode resistor below it, both upright
  const vl = parts.find(k => k.label === "VL1"), r2 = parts.find(k => k.label === "R2"), r3 = parts.find(k => k.label === "R3");
  assert.ok(r2.y < vl.y && r3.y > vl.y && (r2.rot & 1) && (r3.rot & 1), "R2 over VL1, R3 under it, standing");
  // B+ as a rail symbol pointing up, with the voltage; the grounds on one line with one symbol
  const rails = out.comps.filter(k => k.type === "rail");
  assert.ok(rails.length >= 1 && rails.every(k => k.params.name === "B+" && k.params.v === 250 && k.rot === 0));
  assert.equal(out.comps.filter(k => k.type === "ground").length, 1);
  // every wire level or upright, none through a part
  out.wires.forEach(w => assert.ok(w.x1 === w.x2 || w.y1 === w.y2));
  parts.forEach(k => { const b = boxOf(k); out.wires.forEach(w => { const mx = (w.x1 + w.x2) / 2, my = (w.y1 + w.y2) / 2; assert.ok(!(mx > b[0] + 1 && mx < b[2] - 1 && my > b[1] + 1 && my < b[3] - 1), `a wire through ${k.label}`); }); });
});

test("layout: the examples' circuits redrawn from their netlists join the same pins, with few labels", () => {
  for (const f of ["01-2n3904-ce-unbypassed.json", "08-555-astable.json", "13-2a3-single-ended-1627sea.json", "14-el84-push-pull-ultralinear-1608.json"]) {
    const ex = JSON.parse(readFileSync(new URL("../examples/" + f, import.meta.url), "utf8"));
    // the example's own netlist: its drawing read as the CAD reads it
    const N = netsOf(ex), names = new Map(), rails = new Map();
    ex.comps.forEach(c => { if (c.type === "rail") { names.set(N.find(`${c.x},${c.y}`), c.params.name); rails.set(c.params.name, c.params.v); } });
    const gnd = N.named.has("GND") ? N.find(N.named.get("GND")) : null;
    const parts = ex.comps.filter(c => c.label && !["frame", "note", "ground", "rail", "offsheet", "netlabel"].includes(c.type)).map(c => {
      const s = SchLayout.shape({ type: c.type, params: c.params, ref: c.label }, c.rot, c.params.flip === "yes"), pins = {};
      s.pins.forEach(q => { const k = N.find(`${c.x + q.x},${c.y + q.y}`); pins[q.id] = k === gnd ? "GND" : names.get(k) || "N" + k; });
      const params = Object.assign({}, c.params); delete params.flip;
      return { ref: c.label, type: c.type, params, pins };
    });
    const out = D.layout({ parts, rails }, { title: f });
    assert.deepEqual(sameNets(parts, out), [], f);
    const labels = out.comps.filter(k => k.type === "netlabel").length;
    assert.ok(labels <= 6, `${f}: ${labels} labels`);
    // the same drawing every time
    assert.deepEqual(D.layout({ parts, rails }, { title: f }).wires, out.wires);
  }
});

test("partial: the parts complete so far, while the answer is written, cut anywhere", () => {
  const d = stage(); d.rails = { "B+": 250 }; d.summary = "one stage {with braces} and \"quotes\"";
  const full = "```json\n" + JSON.stringify({ title: 'A "q" stage', rails: d.rails, parts: d.parts, summary: d.summary }, null, 1) + "\n```";
  let last = -1;
  for (let n = 0; n <= full.length; n++) {
    const r = D.partial(full.slice(0, n));
    assert.ok(r.parts.length >= last, "parts only grow");
    last = r.parts.length;
    r.parts.forEach((p, k) => assert.deepEqual(p, d.parts[k]));
  }
  const r = D.partial(full);
  assert.equal(r.title, 'A "q" stage'); assert.deepEqual(r.rails, { "B+": 250 }); assert.equal(r.parts.length, d.parts.length); assert.ok(r.done);
  // drawn as it comes: the first parts already make a schematic
  const half = D.partial(full.slice(0, full.indexOf('"R2"')));
  const out = D.layout(D.check({ parts: half.parts, rails: half.rails }), { title: half.title });
  assert.ok(out.comps.some(c => c.label === "VL1") && !out.comps.some(c => c.label === "R2"));
  assert.deepEqual(D.partial("no json here").parts, []);
});
