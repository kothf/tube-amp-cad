// AI ▾ → Design from a description, against a stand-in provider: a design with a mistake is sent
// back once, the corrected one is drawn on a new sheet and simulated, and Ctrl+Z brings back the
// circuit that was there
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const parts = bad => [
    { ref: "G1", type: "siggen", values: { amp: "0.1", freq: "1k" }, pins: { "+": "IN", "-": "GND" } },
    { ref: "C1", type: "capacitor", values: { c: "100n" }, pins: { 1: "IN", 2: "G" } },
    { ref: "R1", type: "resistor", values: { r: "1M" }, pins: { 1: "G", 2: "GND" } },
    { ref: "VL1", type: "tube", values: { tube: "12AX7" }, pins: bad ? { A: "A", G: "G", K: "K", X: "A" } : { A: "A", G: "G", K: "K" } },
    { ref: "R2", type: "resistor", values: { r: "100k" }, pins: { 1: "B+", 2: "A" } },
    { ref: "R3", type: "resistor", values: { r: "1.5k" }, pins: { 1: "K", 2: "GND" } },
    { ref: "C2", type: "electrolytic", values: { c: "22u", v: "25" }, pins: { "+": "K", "-": "GND" } },
    { ref: "C3", type: "capacitor", values: { c: "100n" }, pins: { 1: "A", 2: "OUT" } },
    { ref: "R4", type: "resistor", values: { r: "470k" }, pins: { 1: "OUT", 2: "GND" } },
    { ref: "SC1", type: "scope", pins: { CH1: "IN", CH2: "OUT", COM: "GND" } }];
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    const body = JSON.parse(route.request().postData() || "{}"); sent.push(body);
    const design = { title: "12AX7 gain stage", summary: "One 12AX7 triode, common cathode, about 1 mA.", parts: parts(sent.length === 1), rails: { "B+": 250 } };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(design) }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.ai.render(); });
  const before = await cad.evaluate(() => TubeCAD.state.comps.length);

  await cad.click("#btn-ai"); await cad.click("#menu-ai-design");
  check(await cad.evaluate(() => !document.getElementById("design-modal").hidden && document.querySelectorAll("#design-chips .ai-chip").length >= 3), "Design from a description opens its dialog with examples");
  await cad.click("#design-chips .ai-chip");
  check(/EL84/.test(await cad.inputValue("#design-text")), "an example fills the description");
  await cad.fill("#design-text", "A 12AX7 gain stage on 250 V");
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.click("#btn-design-go");
  await cad.waitForFunction(() => TubeCAD.state.design && !TubeCAD.state.design.busy && /12AX7 gain stage/.test(document.getElementById("ai-log").innerText), null, { timeout: 90000 });
  const sys = sent[0].system[0].text, first = sent[0].messages[0].content[0].text;
  check(/pins maps EVERY pin/.test(sys) && /resistor: Resistor\. Pins 1 2/.test(sys) && /12AX7 \(triode/.test(sys) && /A 12AX7 gain stage on 250 V/.test(first), "the request carries the rules, the part library, the tubes and the description");
  check(sent.length === 2 && /VL1 has no pin X/.test(sent[1].messages[2].content[0].text), "a design the CAD cannot use goes back once with its problems");
  const r = await cad.evaluate(() => { const S = TubeCAD.state, vl = S.comps.find(c => c.label === "VL1"), m = TubeCAD.measurements().find(x => x.label === "VL1 Ia");
    return { n: S.comps.filter(c => !["frame", "ground", "rail", "offsheet"].includes(c.type)).length, frame: S.comps.filter(c => c.type === "frame").map(c => c.params.size + " " + c.params.title).join(), tube: vl && vl.params.tube, ia: m && m.v, log: document.getElementById("ai-log").innerText }; });
  check(r.n === 10 && r.frame === "A3 12AX7 gain stage" && r.tube === "12AX7", `the design is drawn on a new A3 sheet (${r.n} parts, ${r.frame})`);
  check(r.ia > 0.5e-3 && r.ia < 2e-3 && /Checks find no problems/.test(r.log), `and simulated: VL1 draws ${(r.ia * 1000).toFixed(2)} mA, no problems in the Checks`);
  await cad.evaluate(() => TubeCAD.undo());
  check(await cad.evaluate(() => TubeCAD.state.comps.length) === before, "Ctrl+Z brings back the circuit that was on the sheet");
  await cad.evaluate(() => { localStorage.removeItem("tubecad_ai"); TubeCAD.ai.render(); });
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
