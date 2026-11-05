/**
 * cad-revisions.js: what changed between two designs, and the #rev= address.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-revisions.js", import.meta.url), "utf8"), { filename: "cad-revisions.js" });
const R = globalThis.CadRevisions;
const example = f => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));

test("the same design: no changes", () => {
  const d = example("06-gubin-6n23p-6p14p.json");
  const x = R.diff(d, structuredClone(d));
  assert.equal(x.none, true); assert.equal(x.text, "no changes");
});

test("parts added, removed, changed and moved, wires and the board", () => {
  const a = example("07-gubin-5ts4s-stereo.json"), b = structuredClone(a);
  const res = b.comps.filter(c => c.type === "resistor");
  res[0].params.r = 2200;
  res[1].label = "R99";
  const gone = b.comps.splice(b.comps.indexOf(res[2]), 1)[0];
  b.comps.push(Object.assign(structuredClone(res[3]), { id: "new1", label: "R100" }));
  res[4].x += 50;
  b.wires.push({ id: "w-new", x1: 0, y1: 0, x2: 10, y2: 0 });
  b.board = Object.assign({}, b.board, { touched: 1 });
  const x = R.diff(a, b);
  assert.deepEqual(x.added, ["R100"]);
  assert.deepEqual(x.removed, [gone.label]);
  assert.deepEqual(x.changed.map(c => c.part), [res[0].label, "R99"]);
  assert.match(x.changed[0].what[0], /^r .* → 2.2k$/);
  assert.deepEqual(x.moved, [res[4].label]);
  assert.deepEqual(x.wires, { added: 1, removed: 0, redrawn: false });
  assert.equal(x.board, true);
  assert.match(x.text, /added R100 · removed .* · .*r .* → 2.2k.* · moved 1 part · wires \+1 −0 · board: .*changed/);
});

test("connections: pins that now share a net with other pins, and wires only redrawn", () => {
  const a = example("08-555-astable.json"), b = structuredClone(a);
  // a stand-in for the CAD's nets: each wire end's pin by id, nets given here
  const nets = map => () => ({ net: new Map(Object.entries(map)), pins: new Map(Object.keys(map).map(k => [k, k.split(":")[1]])) });
  const [p, q, r] = a.comps.filter(c => c.type === "resistor" || c.type === "capacitor");
  const same = { [p.id + ":1"]: 1, [q.id + ":1"]: 1, [r.id + ":1"]: 2 };
  b.wires = b.wires.map(w => Object.assign({}, w, { x1: w.x1 + 10 }));
  let x = R.diff(a, b, { netsOf: d => nets(same)(d) });
  assert.equal(x.wires.redrawn, true, "the same pins together: the wires were only redrawn");
  assert.deepEqual(x.wiresAdded, []); assert.match(x.text, /wires redrawn, same connections/);
  let k = 0;
  x = R.diff(a, b, { netsOf: () => nets(k++ === 0 ? same : { [p.id + ":1"]: 1, [q.id + ":1"]: 2, [r.id + ":1"]: 2 })() });
  assert.equal(x.wires.redrawn, false);
  const qc = x.changed.find(c => c.part === q.label);
  assert.ok(qc && qc.rewired && qc.what.some(w => new RegExp(`^pin 1 now to ${r.label}\\.1, off ${p.label}\\.1$`).test(w)), JSON.stringify(x.changed));
});

test("the board: parts placed and moved, tracks and vias, the outline", () => {
  const b0 = example("07-gubin-5ts4s-stereo.json").board, b1 = structuredClone(b0);
  const ids = Object.keys(b1.parts);
  b1.parts[ids[0]].x += 3; b1.parts[ids[0]].rot = 1;
  delete b1.parts[ids[1]];
  b1.tracks.pop(); b1.vias.push({ x: 1, y: 1, drill: 0.8, pad: 1.8, net: "GND" });
  b1.outline = Object.assign({}, b1.outline, { w: 240 });
  const d = R.boardDiff(b0, b1);
  assert.equal(d.parts.find(p => p.id === ids[0]).kind, "moved");
  assert.equal(d.parts.find(p => p.id === ids[1]).kind, "taken off");
  assert.equal(d.tracksRemoved.length, 1); assert.equal(d.viasAdded.length, 1);
  assert.match(d.text, /taken off .* · .*turned 0° → 1°, moved 3 mm · tracks \+0 −1 \(−\d+ mm\) · vias \+1 −0 · outline 230×130 → 240×130 mm/);
  assert.equal(R.boardDiff(b0, structuredClone(b0)), null);
});

test("the #rev= address", () => {
  assert.deepEqual(R.fromHash("#rev=Ab3xK9_qZw.12"), { project: "Ab3xK9_qZw", n: 12 });
  assert.deepEqual(R.fromHash("#x=1&rev=Ab3xK9_qZw.3"), { project: "Ab3xK9_qZw", n: 3 });
  assert.equal(R.fromHash("#rev=short.1"), null);
  assert.equal(R.fromHash("#rev=Ab3xK9_qZw"), null);
  assert.equal(R.hashOf("Ab3xK9_qZw", 4), "#rev=Ab3xK9_qZw.4");
  assert.equal(R.base("https://aerocat.tech"), "https://aerocat.tech/api/rev");
  assert.equal(R.base("http://localhost:8080"), "http://localhost:8080/api/rev");
  assert.equal(R.base("https://kothf.github.io"), null, "another copy of the app has no store");
});
