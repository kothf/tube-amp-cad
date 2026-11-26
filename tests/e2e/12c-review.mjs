// AI ▾ → Design review: the sheet of what the CAD measured (no key needed), and the AI's review of it
// with fixes to apply (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  const answer = { summary: "A sound design; VL2 runs close to its anode rating.", findings: [
    { level: "advice", part: "", title: "No Zobel", detail: "Add one across the output." },
    { level: "critical", part: "VL2", title: "Anode near its rating", detail: "VL2 Va is near 300 V (simulated)." }],
  fixes: [{ part: "R10", field: "r", value: "1.2k", why: "less current" }, { part: "R99", field: "r", value: "1k", why: "no such part" }] };
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(answer) + "\n```" }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.removeItem("tubecad_ai"); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  if (!await cad.evaluate(() => TubeCAD.state.comps.some(k => k.label === "VL2"))) {   // run on its own: example 06, as the part before leaves it
    cad.once("dialog", d => d.accept().catch(() => {}));
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  }
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "VL2") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });

  await cad.click("#btn-ai"); await cad.click("#menu-ai-review");
  await cad.waitForFunction(() => /what the CAD measured/.test(document.getElementById("ai-log").innerText) && !TubeCAD.state.review.busy, null, { timeout: 60000 });
  const sheet = await cad.evaluate(() => document.getElementById("ai-log").innerText);
  if (process.env.E2E_DEBUG) console.log(sheet);
  check(/Ratings[\s\S]*VL2 Va[\s\S]*%/.test(sheet) && /Supply ripple/.test(sheet) && /Checks/.test(sheet), "the review's sheet lists each rating's margin, the supply ripple and the Checks");
  check(/Add an AI key/.test(sheet) && !sent.length, "without a key the sheet stands on its own and nothing is sent");

  await cad.evaluate(() => localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })));
  await cad.click("#btn-ai-more"); await cad.click("#btn-ai-review");   // the AI tab's More ▾
  await cad.waitForFunction(() => document.querySelectorAll(".rv-chip").length === 2 && !TubeCAD.state.review.busy, null, { timeout: 60000 });
  const out = await cad.evaluate(() => ({ chips: [...document.querySelectorAll(".rv-chip")].map(e => e.textContent), fixes: [...document.querySelectorAll(".ai-fixes")].pop().innerText }));
  const p = JSON.stringify(sent[0] && sent[0].messages);
  check(/Margins to ratings/.test(p) && /VL2 Va: /.test(p) && /key=value/.test(p), "the AI gets the circuit with its values and the sheet of margins");
  check(out.chips.join() === "Critical,Advice", `the findings are listed critical first (${out.chips.join(", ")})`);
  check(/R10\s+Resistance\s+[\d.]+kΩ → 1.2kΩ/.test(out.fixes) && /there is no part R99/.test(out.fixes), "its value changes are checked against the parts, ready to apply");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
