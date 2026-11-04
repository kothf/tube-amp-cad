/**
 * Transformer models in the inspector: the Model (or Kind) picked is kept with the part, so its
 * type stays shown after a value is typed over it (marked edited), "Custom" stays custom, old
 * files are recognised by their values, and every example transformer from a catalogue shows
 * its model (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const L = globalThis.CadLib;
const field = (type, key) => L.LIB[type].fields.find(f => f.key === key);
const part = (type, params) => ({ type, params: Object.assign({}, L.LIB[type].defaults, params) });

test("a picked output transformer model stays shown when a value is typed over it", () => {
  const c = part("opt_se"), f = field("opt_se", "model");
  assert.equal(f.get(c), "custom");
  f.apply(c, "1627SEA");
  assert.equal(c.params.model, "1627SEA");
  assert.equal(f.get(c), "1627SEA");
  c.params.llk = 0.0162;
  assert.equal(f.get(c), "1627SEA");
  assert.deepEqual(L.optModel(c).edited, ["llk"]);
  assert.match(f.options(c).find(o => o[0] === "1627SEA")[1], /Hammond 1627SEA \(edited\)/);
  assert.match(L.LIB.opt_se.info(c), /Your values in place of the datasheet's: leakage 16\.2mH \(datasheet 20\.2mH\)/);
  assert.match(L.LIB.opt_se.value(c), /^1627SEA /);
  f.apply(c, "custom");
  assert.equal(f.get(c), "custom");
  assert.equal(L.optModel(c), null);
  assert.match(L.LIB.opt_se.info(c), /^Custom transformer/);
});

test("a part saved without a model is still recognised by its values", () => {
  const pp = part("opt_pp", Object.assign({}, L.OPT_PP["1608"].p));
  assert.equal(field("opt_pp", "model").get(pp), "1608");
  assert.deepEqual(L.optModel(pp).edited, []);
});

test("the interstage keeps its kind when a value is typed over it", () => {
  const c = part("itx"), f = field("itx", "preset");
  assert.equal(f.get(c), "is11");
  f.apply(c, "mic10");
  c.params.lp = 12;
  assert.equal(f.get(c), "mic10");
  assert.match(L.LIB.itx.info(c), /^Microphone input 1:10 .*with your own primary inductance\./);
  f.apply(c, "custom");
  assert.equal(f.get(c), "custom");
});

test("every example transformer from a catalogue shows its model, with the datasheet's values", () => {
  const dir = new URL("../examples/", import.meta.url), seen = {};
  for (const name of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    for (const c of JSON.parse(readFileSync(new URL(name, dir), "utf8")).comps) {
      if (c.type !== "opt_se" && c.type !== "opt_pp") continue;
      const m = L.optModel(c);
      if (!c.params.model) { assert.equal(m, null, `${name}: ${c.type} matches a model but does not name it`); continue; }
      assert.ok(m, `${name}: ${c.params.model}`);
      assert.deepEqual(m.edited, [], `${name}: ${m.id} differs from its datasheet`);
      seen[name.slice(0, 2)] = m.id;
    }
  }
  assert.deepEqual(seen, { "04": "1627SEA", 13: "1627SEA", 14: "1608", 15: "1750H" });
});
