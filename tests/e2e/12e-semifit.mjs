// AI ▾ → Transistor or diode from a datasheet…: the datasheet sent to the provider, a SPICE model fitted to
// what it read (a normalized hFE curve scaled to the table's spread), the curves on the card, and the part
// placed on the sheet with its model (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  const answer = { kind: "npn", name: "2N3904", maker: "onsemi", package: "TO-92", pins: "EBC",
    ratings: { vmax: 40, imax: 0.2, ptot: 0.625, tjmax: 150 },
    bjt: { hfe_norm: [{ ic: 1e-4, k: 0.45 }, { ic: 1e-3, k: 0.72 }, { ic: 5e-3, k: 0.95 }, { ic: 1e-2, k: 1 }, { ic: 3e-2, k: 0.72 }, { ic: 0.1, k: 0.3 }],
      hfe_min: 100, hfe_max: 300, hfe_ic: 0.01, hfe_vce: 1,
      vbe: [{ ic: 1e-3, vbe: 0.65 }, { ic: 1e-2, vbe: 0.72 }, { ic: 0.1, vbe: 0.87 }], cob: 2e-12, cob_v: 5, cib: 3.8e-12, cib_v: 0.5, ft_min: 300e6, ft_ic: 0.01 },
    uncertain: ["hFE: the table gives only minimum and maximum"], notes: "A small-signal NPN transistor." };
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(answer) }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })));
  await cad.click("#btn-ai"); await cad.click("#menu-ai-semi");
  await cad.waitForSelector("#semi-modal:not([hidden])");
  await cad.setInputFiles("#semi-file", { name: "2n3903-d.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% a stand-in\n%%EOF\n") });
  await cad.fill("#semi-name", "2N3904");
  await cad.click("#btn-semi-go");
  await cad.waitForFunction(() => !TubeCAD.state.semifit.busy && TubeCAD.state.semifit.found.length, null, { timeout: 60000 });
  const msg = sent[0].messages[0].content;
  check(msg.some(x => x.type === "document" && x.source.media_type === "application/pdf") && /The part is the 2N3904/.test(JSON.stringify(msg)) && /normalized/.test(JSON.stringify(sent[0].system)),
    "the datasheet goes to the provider as a PDF, with the part number and the instructions to read the curves");
  const out = await cad.evaluate(() => { const r = TubeCAD.state.semifit.found[0]; return { q: r.fit.quality, text: r.fit.text, charts: document.querySelectorAll("#ai-log .sf-chart").length, card: document.getElementById("ai-log").innerText }; });
  check(/\.MODEL 2N3904 NPN\(IS=/.test(out.text) && out.q !== "poor", `a Gummel-Poon model is fitted (${out.q})`);
  check(out.charts === 2 && /middle of its spread \(100…300\)/.test(out.card) && /unsure of/.test(out.card) && /E B C/.test(out.card), "the card shows the hFE and VBE curves against the points, how hFE was scaled and what the AI was unsure of");
  // placed on the sheet: a SPICE part with the model inside, the TO-92 footprint with its pins
  const n0 = await cad.evaluate(() => TubeCAD.state.comps.length);
  await cad.click("#ai-log [data-act=sf-place]");
  const box = await cad.locator("#cad").boundingBox();
  await cad.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
  await cad.keyboard.press("Escape");
  const c = await cad.evaluate(() => { const c = TubeCAD.state.comps.slice(-1)[0]; return { n: TubeCAD.state.comps.length, type: c.type, sym: c.params.sym, model: /\.MODEL 2N3904 NPN/.test(c.params.text), fp: c.params.part && c.params.part.fp, ptot: c.params.ptot }; });
  check(c.n === n0 + 1 && c.type === "spice" && c.sym === "npn" && c.model && c.fp === "TO-92-EBC" && c.ptot === 0.625, `Place puts it on the sheet as a SPICE NPN with its model, TO-92 E B C and its ratings (${JSON.stringify(c)})`);
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
  // the parts after this one start from example 06, simulated
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "BA1") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result && TubeCAD.state.sim.topo === TubeCAD.state.topo, null, { timeout: 60000 });
}
