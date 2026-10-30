// AI ▾ → Tube from a datasheet, against a stand-in provider: the PDF goes as a document, the
// answer is reviewed with the fitted model against its points, and Add puts the tube in the library
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    const pts = await cad.evaluate(() => { const m = { mu: 40, kg: 800, kp: 300, kvb: 300, x: 1.35 }, out = [];
      [0, -1, -2, -3].forEach(vg => [50, 100, 150, 200, 250].forEach(va => out.push({ vg, va, ia: +(TubeSimEngine.Koren.triodeIa(va, vg, m) * 1000).toFixed(2) }))); return out; });
    const ans = { name: "6ZZ1", kind: "triode", socket: "Noval B9A", heater: { v: 6.3, a: 0.3 }, ratings: { vaMax: 330, paMax: 2.5 }, similar: "12AU7",
      pinout: [{ pin: 1, sym: "A" }, { pin: 2, sym: "G" }, { pin: 3, sym: "K" }, { pin: 4, sym: "H" }, { pin: 5, sym: "H" }], curves: { points: pts } };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "```json\n" + JSON.stringify(ans) + "\n```" }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.ai.render(); });

  await cad.click("#btn-ai"); await cad.click("#menu-ai-datasheet");
  check(await cad.evaluate(() => !document.getElementById("sheet-modal").hidden), "Tube from a datasheet opens its dialog");
  await cad.setInputFiles("#sheet-file", { name: "6ZZ1.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 stand-in") });
  await cad.click("#btn-sheet-go");
  await cad.waitForSelector('[data-act="ds-add"]', { timeout: 60000 });
  const doc = sent[0].messages[0].content.find(c => c.type === "document");
  check(doc && doc.source.media_type === "application/pdf" && Buffer.from(doc.source.data, "base64").toString() === "%PDF-1.4 stand-in" && /plate \(anode\) characteristic/.test(sent[0].system[0].text), "the PDF goes to the model as a document with the reading instructions");
  const card = await cad.evaluate(() => { const a = [...document.querySelectorAll(".ai-msg.answer")].pop(); return { text: a.innerText, lines: a.querySelectorAll(".ds-chart polyline").length, dots: a.querySelectorAll(".ds-chart circle").length }; });
  check(/6ZZ1 · triode/.test(card.text) && /Va 330 V · Pa 2\.5 W/.test(card.text) && /1 A · 2 G · 3 K/.test(card.text) && /R² 0\.99\d\d.*\(good\)/.test(card.text), "the review lists ratings, pinout and the fit (R² ≥ 0.99)");
  check(card.lines === 4 && card.dots === 20, `with the model's curves over the datasheet's points (${card.lines} curves, ${card.dots} points)`);
  await cad.click('[data-act="ds-add"]');
  const added = await cad.evaluate(() => { const t = TUBE_DATABASE.find(x => x.commonName === "6ZZ1"); return { ok: !!t && SpiceModel.isCustom(t), kind: t && CadLib.tubeKind(t), stored: (localStorage.getItem(SpiceModel.STORE) || "").includes("6ZZ1"), btn: document.querySelector('[data-act="ds-add"]').disabled }; });
  check(added.ok && added.kind === "triode" && added.stored && added.btn, `Add puts 6ZZ1 in the tube library, kept in this browser (${JSON.stringify(added)})`);
  await cad.evaluate(() => { SpiceModel.remove("6ZZ1"); localStorage.removeItem("tubecad_ai"); TubeCAD.ai.render(); });
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
