/**
 * The AI features' design knowledge (ai-skill.js, compiled from the circuit-design skill's
 * reference files): up to date with its sources, and each feature gets the sections that fit the
 * circuit on the sheet.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInThisContext } from "node:vm";

globalThis.window = globalThis;
runInThisContext(readFileSync(new URL("../ai-skill.js", import.meta.url), "utf8"), { filename: "ai-skill.js" });
const K = globalThis.AiSkill;

test("ai-skill.js is compiled from the skill's current reference files", () => {
  execFileSync(process.execPath, [new URL("../scripts/build-ai-skill.mjs", import.meta.url).pathname, "--check"], { stdio: "pipe" });
});

test("a new design gets every circuit section, not the board's", () => {
  const p = K.pack("design");
  for (const h of ["# Design method", "# Tube circuits", "# Transistor circuits", "# Op-amp", "# Power supplies", "# 555, logic", "# Feedback"]) assert.ok(p.includes(h), h);
  assert.ok(!p.includes("# Grounding, hum and board layout"));
});

test("a feature on the sheet's circuit gets the sections of its kinds", () => {
  const tube = [{ type: "tube" }, { type: "resistor" }], timer = [{ type: "timer555" }, { type: "led" }];
  const r = K.pack("review", tube);
  assert.ok(r.includes("# Tube circuits") && r.includes("# Grounding, hum and board layout") && r.includes("# Feedback"));
  assert.ok(!r.includes("# Transistor circuits") && !r.includes("# 555, logic"));
  const t = K.pack("fix", timer);
  assert.ok(t.includes("# 555, logic") && !t.includes("# Tube circuits") && !t.includes("# Feedback"));
  assert.deepEqual([...K.kinds([{ type: "npn" }, { type: "opamp" }, { type: "logic" }])].sort(), ["digital", "opamp", "semi"]);
  // passives only: the analog sections, so the AI still has the general rules
  assert.ok(K.pack("subs", [{ type: "resistor" }]).includes("# Tube circuits"));
  assert.equal(K.pack("no-such-feature", tube), "");
});

test("Settings → Design knowledge in AI prompts off leaves the prompts as they were", () => {
  globalThis.CadSettings = { get: k => (k === "aiKnowledge" ? false : undefined) };
  try { assert.equal(K.pack("design"), ""); assert.equal(K.enabled(), false); }
  finally { delete globalThis.CadSettings; }
  assert.ok(K.pack("design").length > 10000);
});
