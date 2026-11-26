// AI ▾ → Voicing…: a sound asked in words goes to the AI with the circuit and its harmonics; its value changes are
// checked; Hear before and after renders the Listen clip as it is (kept as Before), applies the changes and renders
// again, and Listen's A/B plays both (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  const answer = { summary: "Bright now; a smaller cathode resistor would lift the gain.", fixes: [{ part: "R10", field: "r", value: "1.2k", why: "more current, a little more gain" }, { part: "C99", field: "c", value: "1n", why: "no such part" }] };
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  if (!await cad.evaluate(() => TubeCAD.state.comps.some(k => k.label === "R10"))) {   // run on its own: example 06
    cad.once("dialog", d => d.accept().catch(() => {}));
    await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  }
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "R10") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });
  // a short clip, so the two renders are quick
  await cad.evaluate(() => { const o = TubeCAD.state.listen.opts; o.src = "riff"; o.len = 1; });
  await cad.click("#btn-ai"); await cad.click("#menu-ai-voice");
  await cad.waitForSelector("#voice-modal:not([hidden])");
  await cad.click("#voice-modal [data-voice='warmer']"); await cad.click("#voice-modal [data-voice='more bass']");
  check(await cad.evaluate(() => document.getElementById("voice-text").value === "warmer, more bass"), "the suggestions add to the words");
  await cad.click("#btn-voice-go");
  await cad.waitForFunction(() => !TubeCAD.state.voicing.busy && document.querySelector("#ai-log [data-act=vo-hear]"), null, { timeout: 60000 });
  const p = JSON.stringify(sent[0]);
  check(/How it should sound: warmer, more bass/.test(p) && /harmonics at the generator's level/.test(p) && /H2 [\d.]+ %/.test(p) && /voicing amplifiers/.test(p), "the AI gets the circuit with its values, the output's harmonics and the sound asked for");
  const fx = await cad.evaluate(() => [...document.querySelectorAll(".ai-fixes")].pop().innerText);
  check(/R10\s+Resistance\s+[\d.]+kΩ → 1.2kΩ/.test(fx) && /there is no part C99/.test(fx), "its value changes are checked against the parts");
  await cad.click("#ai-log [data-act=vo-hear]");
  await cad.waitForFunction(() => !TubeCAD.state.voicing.busy, null, { timeout: 240000 });
  const out = await cad.evaluate(() => { const L = TubeCAD.state.listen, r10 = TubeCAD.state.comps.find(c => c.label === "R10"); return { before: !!L.before, same: !!(L.before && L.take && L.before.out[0].length === L.take.out[0].length), differ: !!(L.before && L.take && L.before.rms !== L.take.rms), ab: L.ab, btn: !document.querySelector("#ls-pane [data-ab=before]").hidden, strip: !document.getElementById("ls-cv-before").hidden, r: r10.params.r, tab: !document.getElementById("ls-pane").hidden }; });
  check(out.before && out.same && out.differ && out.r === 1200, `Hear before and after: rendered as it was (Before), R10 changed to 1.2 kΩ and rendered again (${JSON.stringify(out)})`);
  check(out.tab && out.btn && out.strip && out.ab === "before", "the Listen tab shows Before beside the input and the circuit, ready to play and switch");
  await cad.evaluate(() => { TubeCAD.undo(); localStorage.removeItem("tubecad_ai"); });
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
