// AI ▾ → Build and power-up guide: the sheet of test points with bands, heaters and stored charge from the
// simulation, a print button; with a key, the AI's build notes (a stand-in for the provider: no network, no key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "Build the supply first and test it into a dummy load." }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.removeItem("tubecad_ai"); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  if (!await cad.evaluate(() => TubeCAD.state.comps.some(k => k.label === "R10"))) {   // run on its own: example 06
    cad.once("dialog", d => d.accept().catch(() => {}));
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  }
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "R10") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });
  await cad.click("#btn-ai"); await cad.click("#menu-ai-build");
  await cad.waitForFunction(() => /Test points/.test(document.getElementById("ai-log").innerText) && !TubeCAD.state.build.busy, null, { timeout: 60000 });
  const G = await cad.evaluate(() => { const G = TubeCAD.build.gather(); return { pts: G.pts.length, inBand: G.pts.every(p => p.lo <= p.v && p.v <= p.hi), heaters: G.heaters.length, bleed: G.bleed.length, mains: G.mains, total: G.total, log: document.getElementById("ai-log").innerText }; });
  check(G.pts > 5 && G.inBand && G.heaters > 0 && G.total > 0, `the sheet has test points with bands, the heaters and the power drawn (${G.pts} points, ${G.heaters} heaters, ${Math.round(G.total)} W)`);
  check(/Lethal voltages/.test(G.log) && /Heaters first/.test(G.log) && /Accept/.test(G.log) && /Add an AI key/.test(G.log) && !sent.length, "without a key: the safety steps and the table, and a note on what a key adds; nothing sent");
  check(await cad.evaluate(() => !!document.querySelector("#ai-log [data-act=bg-print]")), "the card has Print the sheet");
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); });
  await cad.click("#btn-ai-more"); await cad.click("#btn-ai-build");
  await cad.waitForFunction(() => /Build the supply first/.test(document.getElementById("ai-log").innerText), null, { timeout: 60000 });
  const p = JSON.stringify(sent[0]);
  check(/power-up sheet/.test(p) && /Heaters:/.test(p) && /build notes/.test(p), "with a key the AI gets the circuit and the sheet, and its build notes come back in the AI tab");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
