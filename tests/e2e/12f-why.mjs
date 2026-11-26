// Why? on the panel's result tabs: the tab's result goes to the AI with the circuit, and the answer comes back
// in the AI tab; a tab with nothing run yet asks for a run first (a stand-in for the provider: no network, no key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "R10 sets the output tubes' bias." }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  if (!await cad.evaluate(() => TubeCAD.state.comps.some(k => k.label === "VL2"))) {   // run on its own: example 06, as the part before leaves it
    cad.once("dialog", d => d.accept().catch(() => {}));
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
    await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "VL2") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });
  }
  await cad.evaluate(() => TubeCAD.toggleBom(true, "tolerance"));
  check(await cad.evaluate(() => !document.getElementById("btn-ai-why").closest(".bom-tools").hidden), "Why? is on the result tabs");
  await cad.click("#btn-ai-why");
  check(await cad.evaluate(() => /run it first/.test(document.getElementById("status-sim").innerText)) && !sent.length, "a tab with nothing run yet asks for a run first and sends nothing");
  await cad.evaluate(() => TubeCAD.toggleBom(true, "checks"));
  await cad.click("#btn-ai-why");
  await cad.waitForFunction(() => /R10 sets the output/.test(document.getElementById("ai-log").innerText), null, { timeout: 60000 });
  const p = JSON.stringify(sent[0].messages);
  check(/The Checks tab shows:/.test(p) && /why it happens in this circuit/.test(p) && /Parts \(designator/.test(p), "the Checks tab's text goes with the circuit and the question why; the answer is in the AI tab");
  check(await cad.evaluate(() => document.getElementById("btn-ai-why").closest(".bom-tools").hidden), "the AI tab has its own tools in place of Why?");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
