/**
 * Datasheet import without a model (ai-datasheet.js, koren-fit.js): the answer read into a
 * tube-database entry, and the Koren model fitted to its plate-curve points.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

globalThis.window = globalThis;
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "koren-fit.js", "ai-datasheet.js"]) runInThisContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f });
const { AiDatasheet: A, TubeSimEngine: E, TUBE_DATABASE: DB } = globalThis;

// points along a known triode's curves, as a model would read them off a datasheet
const truth = { mu: 40, kg: 800, kp: 300, kvb: 300, x: 1.35 };
const curves = [0, -1, -2, -3, -4].flatMap(vg => [50, 100, 150, 200, 250, 300].map(va => ({ vg, va, ia: +(E.Koren.triodeIa(va, vg, truth) * 1000).toFixed(3) }))).filter(p => p.ia > 0.05);
const answer = () => ({ name: "6ZZ1", kind: "Triode", type: "Medium-mu triode", socket: "Noval B9A", pinCount: 9, heater: { v: "6.3", a: 0.3 },
  ratings: { vaMax: 330, paMax: 2.5, ikMax: 20, vhkMax: 100 }, pinout: [{ pin: 1, sym: "a" }, { pin: 2, sym: "G" }, { pin: 3, sym: "K" }, { pin: 4, sym: "H" }, { pin: 5, sym: "H" }],
  curves: { points: curves }, similar: "12AU7", notes: "read by eye" });

test("read: ratings, heater, pinout roles and limits; the similar tube for the rest", () => {
  const r = A.read(answer(), DB);
  assert.equal(r.kind, "triode");
  assert.equal(r.like.commonName, "12AU7");
  const t = r.tube;
  assert.equal(t.commonName, "6ZZ1"); assert.equal(t.vaMax, 330); assert.equal(t.paMax, 2.5); assert.equal(t.ikMax, 20); assert.equal(t.vh, 6.3);
  assert.deepEqual(t.limits, { vhk: 100 });
  assert.deepEqual(t.pinout.slice(0, 3), [{ pin: 1, sym: "A", role: "Plate", isPlate: true }, { pin: 2, sym: "G", role: "Grid", isGrid: true }, { pin: 3, sym: "K", role: "Cathode", isCathode: true }]);
  assert.equal(t.custom.source, "datasheet");
  assert.deepEqual(r.problems, []);
});

test("model: the Koren fit recovers a known triode from its curves", () => {
  const r = A.read(answer(), DB), fit = A.model(r);
  assert.ok(fit.r2 > 0.999, `R² ${fit.r2}`);
  const m = r.tube.koren.Triode;
  assert.ok(Math.abs(m.mu - truth.mu) / truth.mu < 0.05, `mu ${m.mu}`);
  // the fitted tube draws what the true one draws at a typical point
  const want = E.Koren.triodeIa(200, -2, truth), got = E.Koren.triodeIa(200, -2, m);
  assert.ok(Math.abs(got - want) / want < 0.02, `${got} vs ${want}`);
  assert.equal(r.tube.custom.fit.points, curves.length);
});

test("too little to go on: problems listed, the similar tube's model and pinout used", () => {
  const j = answer(); j.curves.points = j.curves.points.slice(0, 3); delete j.pinout; delete j.ratings.paMax; j.kind = "beam tetrode"; j.similar = "nothing like it";
  const r = A.read(j, DB), fit = A.model(r);
  assert.equal(r.kind, "pentode"); assert.equal(r.like.commonName, "EL34");
  assert.equal(fit, null);
  assert.deepEqual(r.tube.koren.Pentode.mu, +DB.find(t => t.commonName === "EL34").koren.Pentode.mu.toPrecision(5));
  assert.equal(r.tube.pinout.length, DB.find(t => t.commonName === "EL34").pinout.length);
  const p = r.problems.join("\n");
  assert.match(p, /only 3 plate-curve points/); assert.match(p, /no pinout/); assert.match(p, /no screen voltage/); assert.match(p, /no Pa max/);
});
