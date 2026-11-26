// AI ▾ → Substitutes for the selected part: the library's tubes of the same kind, each simulated in place of
// every part of that type, listed with bias, stress, output and THD; Use puts one in (one Undo); with a key
// the AI gets the table (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "EL84 is the closest: no re-bias needed." }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.removeItem("tubecad_ai"); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  if (!await cad.evaluate(() => TubeCAD.state.comps.some(k => k.label === "VL2" && k.params.tube === "6P14P"))) {   // run on its own: example 06
    cad.once("dialog", d => d.accept().catch(() => {}));
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  }
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "VL2") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });
  await cad.evaluate(() => TubeCAD.state.sel.comps.clear());
  await cad.click("#btn-ai"); await cad.click("#menu-ai-subs");
  check(await cad.evaluate(() => /Select a tube or a transistor/.test(document.getElementById("ai-log").innerText)), "with nothing selected it asks for a tube or a transistor");
  await cad.evaluate(() => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(S.comps.find(c => c.label === "VL2").id); });
  await cad.click("#btn-ai"); await cad.click("#menu-ai-subs");
  await cad.waitForFunction(() => !TubeCAD.state.subs.busy && /Substitutes for 6P14P\n/.test(document.getElementById("ai-log").innerText), null, { timeout: 120000 });
  const t = await cad.evaluate(() => { const tab = [...document.querySelectorAll("#ai-log .sub-table")].pop(); return { rows: [...tab.querySelectorAll("tr")].slice(1).map(r => r.innerText.replace(/\s+/g, " ")), use: tab.querySelectorAll("[data-act=sub-use]").length, log: document.getElementById("ai-log").innerText }; });
  check(t.rows.length >= 5 && /^6P14P \(as drawn\)/.test(t.rows[0]) && t.rows.some(r => /^EL84 \(analog\) plugs in 6.3V/.test(r)) && t.use >= 4, `the output pentodes of the library, simulated in place, EL84 among them as a plug-in analog (${t.rows.length - 1} substitutes)`);
  check(/replaces all 2 6P14P \(VL2, VL2'\)/.test(t.log) && /Add an AI key/.test(t.log) && !sent.length, "both 6P14Ps are swapped in each run; without a key nothing is sent");
  const i = await cad.evaluate(() => [...[...document.querySelectorAll("#ai-log .sub-table")].pop().querySelectorAll("tr")].slice(1).findIndex(r => /^EL84/.test(r.innerText)) - 1);
  await cad.click(`#ai-log [data-act=sub-use][data-arg$=":${i}"]`);
  const tubes = () => cad.evaluate(() => TubeCAD.state.comps.filter(c => /^VL2/.test(c.label)).map(c => c.params.tube).join());
  check(await tubes() === "EL84,EL84", "Use puts EL84 in for both");
  await cad.evaluate(() => TubeCAD.undo());
  check(await tubes() === "6P14P,6P14P", "one Undo takes it back");
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } }));
    const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(S.comps.find(c => c.label === "VL2").id); });
  await cad.click("#btn-ai-more"); await cad.click("#btn-ai-subs");
  await cad.waitForFunction(() => /EL84 is the closest/.test(document.getElementById("ai-log").innerText), null, { timeout: 120000 });
  const p = JSON.stringify(sent[0]);
  check(/The simulated substitutes/.test(p) && /EL84 \| plugs in/.test(p) && /re-bias/.test(p), "with a key the AI gets the circuit and the simulated table, and its advice comes back in the AI tab");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
