// AI ▾ → Schematic from a picture…: a picture sent to the provider, the transcription checked,
// drawn and simulated, and the unsure values listed (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  // a common-cathode 12AX7 stage, as a provider would read it from a picture, with one value unsure
  const answer = { title: "12AX7 stage", summary: "One common-cathode stage.", rails: { "B+": 250 },
    parts: [
      { ref: "G1", type: "siggen", values: { amp: "0.1" }, pins: { "+": "IN", "-": "GND" } },
      { ref: "R1", type: "resistor", values: { r: "1M" }, pins: { 1: "IN", 2: "GND" } },
      { ref: "VL1", type: "tube", values: { tube: "12AX7" }, pins: { P: "A", G: "IN", K: "K" } },
      { ref: "R2", type: "resistor", values: { r: "100k" }, pins: { 1: "B+", 2: "A" } },
      { ref: "R3", type: "resistor", values: { r: "1.5k" }, pins: { 1: "K", 2: "GND" } },
      { ref: "R4", type: "resistor", values: { r: "470k" }, pins: { 1: "A", 2: "GND" } }],
    uncertain: [{ ref: "R3", what: "value smudged: read as 1.5k, could be 1.8k" }], added: ["G1"] };
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })));
  // a picture: a white PNG drawn by the page itself
  const png = Buffer.from(await cad.evaluate(() => { const c = document.createElement("canvas"); c.width = 300; c.height = 200; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 300, 200); g.fillText("R1 1M", 20, 20); return c.toDataURL("image/png").split(",")[1]; }), "base64");

  await cad.click("#btn-ai"); await cad.click("#menu-ai-picture");
  await cad.waitForSelector("#pic-modal:not([hidden])");
  await cad.click("#btn-pic-go");
  check(await cad.evaluate(() => !document.getElementById("pic-modal").hidden && /Choose a picture/.test(document.getElementById("pic-name").textContent)), "Read without a picture asks for one first");
  await cad.setInputFiles("#pic-file", { name: "stage.png", mimeType: "image/png", buffer: png });
  await cad.fill("#pic-notes", "the supply is 250 V");
  check(await cad.evaluate(() => !document.getElementById("pic-preview").hidden), "the picture shows in the dialog");
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.click("#btn-pic-go");
  await cad.waitForFunction(() => !TubeCAD.state.picture.busy && /from stage\.png/.test(document.getElementById("ai-log").innerText), null, { timeout: 60000 });
  const msg = sent[0].messages[0].content;
  check(msg.some(x => x.type === "image" && x.source.media_type === "image/jpeg" && x.source.data.length > 100) && msg.some(x => x.type === "text" && /the supply is 250 V/.test(x.text)) && /Transcribe it/.test(JSON.stringify(sent[0].system)),
    "the picture goes to the provider as JPEG with the notes, asking for a transcription as drawn");
  const out = await cad.evaluate(() => ({ labels: TubeCAD.state.comps.map(c => c.label).filter(Boolean), r3: TubeCAD.state.comps.find(c => c.label === "R3").params.r, text: document.getElementById("ai-log").innerText, img: !!document.querySelector(".pic-thumb") }));
  check(["VL1", "R1", "R2", "R3", "R4", "G1"].every(l => out.labels.includes(l)) && out.r3 === 1500, "the transcription is drawn on the sheet with its designators and values");
  check(out.img && /Check these against the picture/.test(out.text) && /R3\s+value smudged/.test(out.text) && /Added so it can be simulated: G1/.test(out.text), "the card shows the picture, the unsure value and what was added");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
  // the parts after this one start from example 06, simulated
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "BA1") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result && TubeCAD.state.sim.topo === TubeCAD.state.topo, null, { timeout: 60000 });
}
